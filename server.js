// TelemuneSmartAi backend.
// - Streams OpenAI chat replies over Server-Sent Events, tagged with caller intent, mood, language and per-sentence emotion.
// - Speaks each sentence with OpenAI TTS in the matching emotion.
// - Stores user-added playbooks; with none selected the agent runs in default mode.
// Speech-to-text runs in the browser (Web Speech API).
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI, { toFile } from "openai";
import { AGENT_TYPES, listPlaybooks, getPlaybook, addPlaybook, removePlaybook, playbookPrompt } from "./playbooks.js";
import { getConfig, publicConfig, saveAgentSettings, CONFIG_PATH } from "./config.js";
import { requestContext, asUser } from "./context.js";
import {
  ensureSetup, login, logout, sessionFrom, sessionCookie, clearCookie, listUsers, getUser, createUser, updateUser,
  deleteUser, changeOwnPassword, publicUser, ROLE_ADMIN,
} from "./auth.js";
import { listEvents, addEvent, removeEvent, toIcs } from "./calendar.js";
import { listCalls, getCall, saveCall, saveRecording, readRecording, deleteCall, callStats, readSummaryFile } from "./calls.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");
// All tunable settings (port, models, timings, branding...) come from config.json via getConfig().
const PORT = getConfig().server.port; // read once at startup

// Detect "server is older than its code": the page files are read fresh from disk, but server code only loads at
// start. If any server file changed since start, /api/config reports stale=true and the page asks for a restart.
const SERVER_FILES = ["server.js", "config.js", "calls.js", "calendar.js", "playbooks.js", "auth.js", "context.js"].map((f) => path.join(here, f));
const codeStamp = async () => (await Promise.all(SERVER_FILES.map((f) => fs.stat(f).then((st) => st.mtimeMs, () => 0)))).join(",");
const BOOT_STAMP = await codeStamp();
const BRAND = () => getConfig().branding.appName;

// Reads OPENAI_API_KEY from the environment. Created lazily so the server still starts without a key.
let client;
const getClient = () => (client ??= new OpenAI());

// The 10 most-used OpenAI assistant voices (all support emotional delivery via instructions).
const VOICES = {
  marin: "Marin — natural, warm (female)",
  cedar: "Cedar — natural, grounded (male)",
  alloy: "Alloy — neutral, balanced",
  coral: "Coral — bright, friendly (female)",
  shimmer: "Shimmer — soft, gentle (female)",
  sage: "Sage — calm, wise (female)",
  ballad: "Ballad — expressive, melodic (male)",
  ash: "Ash — clear, confident (male)",
  echo: "Echo — smooth, steady (male)",
  verse: "Verse — lively, dynamic (male)",
};

// Every emotion the agent can speak with, and how the voice should deliver it.
const EMOTIONS = {
  neutral: "Speak in a natural, clear, friendly tone at a normal pace.",
  happy: "Sound genuinely happy and warm, with a light smile in your voice.",
  excited: "Sound excited and energetic, slightly faster with upbeat intonation.",
  cheerful: "Sound cheerful and bright, playful and positive.",
  calm: "Speak slowly and calmly, soothing and relaxed, with gentle pauses.",
  empathetic: "Sound caring and empathetic, soft and understanding, unhurried.",
  sad: "Sound gently sad and sympathetic, softer and slower, never dramatic.",
  apologetic: "Sound sincerely apologetic and humble, soft and considerate.",
  encouraging: "Sound encouraging and supportive, warm and motivating.",
  confident: "Sound confident and assured, steady and clear.",
  serious: "Sound serious and focused, measured pace, no playfulness.",
  curious: "Sound curious and interested, with rising, inquisitive intonation.",
  surprised: "Sound pleasantly surprised, with lively, expressive intonation.",
  thoughtful: "Sound thoughtful and reflective, slightly slower, as if considering.",
  concerned: "Sound concerned and attentive, careful and caring.",
  reassuring: "Sound reassuring and comforting, steady and warm.",
  grateful: "Sound grateful and appreciative, warm and sincere.",
  playful: "Sound playful and witty, light and fun.",
  urgent: "Sound alert and urgent but composed, a bit faster and crisp.",
  proud: "Sound proud and celebratory, warm and uplifting.",
};

const LANGUAGE_NAMES = {
  "en-US": "English", "en-IN": "Indian English", "hi-IN": "Hindi", "bn-IN": "Bengali",
  "ta-IN": "Tamil", "te-IN": "Telugu", "mr-IN": "Marathi", "gu-IN": "Gujarati",
  "es-ES": "Spanish", "fr-FR": "French", "de-DE": "German", "pt-BR": "Portuguese",
  "ar-SA": "Arabic", "ja-JP": "Japanese", "zh-CN": "Mandarin Chinese",
  "en-JM": "Jamaican Patois",
};

// Extra guidance for languages that need more than "reply in X".
const LANGUAGE_STYLE = {
  "en-JM": {
    reply: `Reply in Jamaican Patois (Jamaican Creole), written the way Jamaicans naturally write it, e.g. "Wah gwaan", "Mi deh yah fi help yuh", "Yuh good?", "Nuh worry yuhself", "Mi soon sort it out". Keep it warm, friendly and easy to follow. If the caller speaks standard English, still answer in light Patois, but switch to clear standard English if they ask or seem confused. Never mock or exaggerate the language. Numbers and important details (phone numbers, amounts, dates) must stay crystal clear.`,
    voice: "Speak Jamaican Patois with a natural, authentic Jamaican accent and rhythm, relaxed and warm, like a friendly person from Kingston. Pronounce names and numbers clearly.",
  },
};

function calendarPrompt(cfg) {
  if (!cfg.calendar?.enabled) return "";
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `
Calendar (switched on): you can add events to the caller's calendar.
- When the caller wants something scheduled (appointment, meeting, reminder, follow-up) and the date and time are clear and confirmed, add ONE tag right after the other tags: <calendar:TITLE|YYYY-MM-DDTHH:MM|MINUTES>
  e.g. <calendar:Dental cleaning|2026-11-21T18:30|30>. Times are local (${tz}). Use ${cfg.calendar.defaultDurationMin || 30} minutes if no length is given.
- Then tell them in a few words that it's added to their calendar. Only add it once; never add a tag for something not yet confirmed.
`;
}

function emergencyPrompt(cfg) {
  const e = cfg.emergency;
  if (!e?.enabled || !e.rules?.length) return "";
  return `
Emergencies (top priority, overrides your playbook):
${e.rules.map((r) => `- ${r.label}: call ${r.number} (signs: ${r.keywords.join(", ")})`).join("\n")}
- If the caller describes an emergency like these, in ANY language, immediately and calmly tell them the right number first and urge them to call it now, then ask if they are safe. Use the intent "emergency: <label>". Say the number digit by digit.
`;
}

function systemPrompt(lang, name, pb, cfg) {
  const language = LANGUAGE_NAMES[lang] || "English";
  return `You are ${name || "Aria"}, talking to someone on a live phone call. You sound like a real person, not a bot.

${playbookPrompt(pb)}

How to talk:
- ${LANGUAGE_STYLE[lang]?.reply || `Reply in ${language}, in its native script. If the caller clearly speaks a different language or mixes (like Hinglish), match how they speak.`}
- Keep it SHORT: one or two short sentences, around ${cfg.agent.maxReplyWords} words. Never more than three sentences.
- Talk like a human on the phone: casual, warm, contractions, small natural reactions like "oh no", "got it", "nice", "hmm, okay".
- Ask only one question at a time, then stop.
- Never say "As an AI", "I'd be happy to assist", "Great question", or "Is there anything else I can help you with". Don't repeat their question back. No lists.
- Your words are read aloud: no markdown, emojis, URLs or symbols. Say numbers and times the way people say them.
- Answer what they actually asked. If what they want is unclear, ask a quick clarifying question instead of guessing.
- Speech recognition can mishear words. If something looks garbled, go with the most sensible meaning from context, or briefly check ("Sorry, did you say Friday?").
- If the caller corrects something they said earlier ("no, I meant Friday", "my number is actually ..."), the correction wins: use the corrected detail from then on and confirm it in a few words.

Reading the caller (do this carefully every turn, using the whole conversation, not just the last words):
- intent: what the caller wants to achieve with this message, specific and in 2 to 6 English words, e.g. "refund for caller tune charge", "book dental cleaning", "check data balance", "complain about late delivery", "say goodbye". Short replies like "yes", "ok" or a number get the intent of what they're answering, e.g. "confirm deactivation", "give mobile number".
- mood: one English word for how they feel right now (e.g. neutral, happy, excited, relieved, curious, confused, stressed, anxious, frustrated, angry, sad, tired, worried, grateful, impatient).
- lang: the language they actually spoke, in English (e.g. English, Hindi, Hinglish, Tamil).
- Match your tone to their mood: soft when upset, upbeat when happy, calm and clear when confused.

Output format (the app reads and strips these tags before speaking):
- Start with exactly: <intent:...><mood:...><lang:...>
- Hanging up: if the caller wants to end the call (says bye, "that's all", "thanks, done", "disconnect", "cut the call", "rakhta hoon", "bas itna hi", or the same in any language), use the intent "end call", say one short warm goodbye, and add <hangup:yes> right after the tags. Only do this when they clearly want to leave, not for a plain "thank you" in the middle of a task.
- Then begin EVERY sentence with the emotion to say it in, as [EMOTION], one of: ${Object.keys(EMOTIONS).join(", ")}.
- Example: <intent:refund for wrong charge><mood:frustrated><lang:English>[empathetic] Oh no, that's annoying. [curious] Which number was charged?
- Hang-up example: <intent:end call><mood:satisfied><lang:English><hangup:yes>[grateful] Glad I could help, take care, bye!

${calendarPrompt(cfg)}${emergencyPrompt(cfg)}
If the caller's message is "[call connected]", the call has just started: use <intent:call start><mood:neutral><lang:${language}> and greet them in one short line that fits your role, then ask how you can help.
Today is ${new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}.`;
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

async function readBody(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 300_000) throw new Error("Request too large");
  }
  return JSON.parse(data || "{}");
}

async function readRaw(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Recording too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sse(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

const usageOf = (u) => ({ input: u?.prompt_tokens || 0, output: u?.completion_tokens || 0, total: u?.total_tokens || 0 });

function friendlyError(err) {
  if (err instanceof OpenAI.AuthenticationError || /OPENAI_API_KEY|apiKey/i.test(err?.message || "")) return "Server is missing a valid OPENAI_API_KEY.";
  if (err instanceof OpenAI.RateLimitError) return "Rate limited or out of credit. Check your OpenAI billing and try again.";
  if (err instanceof OpenAI.NotFoundError) return `A model in config.json ("models") isn't available on your OpenAI account.`;
  if (err instanceof OpenAI.APIError) return `API error: ${err.message}`;
  return "Something went wrong talking to the agent.";
}

function cleanTurns(raw) {
  const messages = (Array.isArray(raw) ? raw : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-(Number(getConfig().conversation.historyTurnsSentToModel) || 30));
  if (messages.length && messages[0].role === "assistant") messages.unshift({ role: "user", content: "[call connected]" });
  return messages;
}

async function handleChat(req, res) {
  const cfg = getConfig();
  let body;
  try {
    body = await readBody(req);
  } catch {
    return res.writeHead(400).end("Bad JSON");
  }
  const messages = cleanTurns(body.messages);
  if (!messages.length || messages.at(-1).role !== "user") return res.writeHead(400).end("Last message must be from the user");
  const pb = await getPlaybook(body.playbookId);

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    const stream = await getClient().chat.completions.create(
      {
        model: cfg.models.chat,
        stream: true,
        stream_options: { include_usage: true }, // last chunk carries token usage
        max_completion_tokens: cfg.models.maxReplyTokens,
        ...(cfg.models.reasoningEffort ? { reasoning_effort: cfg.models.reasoningEffort } : {}),
        messages: [
          { role: "system", content: systemPrompt(body.lang, body.assistantName || cfg.agent.defaultName, pb, cfg) },
          ...messages,
          // The browser spotted an emergency keyword in this message: make sure the reply leads with the number.
          ...(body.emergency?.number ? [{ role: "system", content: `EMERGENCY DETECTED (${String(body.emergency.label).slice(0, 40)}). Your reply must start by telling the caller to call ${String(body.emergency.number).slice(0, 20)} right now.` }] : []),
        ],
      },
      { signal: controller.signal },
    );
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) sse(res, "delta", { text });
      if (chunk.usage) sse(res, "usage", usageOf(chunk.usage));
    }
    sse(res, "done", {});
  } catch (err) {
    if (!res.writableEnded && !controller.signal.aborted) {
      console.error(err);
      sse(res, "error", { message: friendlyError(err) });
    }
  } finally {
    res.end();
  }
}

async function handleSummary(req, res) {
  const cfg = getConfig();
  let body;
  try {
    body = await readBody(req);
  } catch {
    return res.writeHead(400).end("Bad JSON");
  }
  const turns = cleanTurns(body.messages)
    .filter((m) => m.content !== "[call connected]")
    .map((m) => `${m.role === "user" ? "Caller" : "Agent"}: ${m.content.replace(/<[a-z]+:[^>]*>|\[[a-z]+\]/gi, "").trim()}`)
    .join("\n");
  const pb = await getPlaybook(body.playbookId);
  const focus = pb?.summary || "The caller's requests, important details mentioned, and anything promised.";
  try {
    const out = await getClient().chat.completions.create({
      model: cfg.models.chat,
      max_completion_tokens: cfg.models.maxSummaryTokens,
      ...(cfg.models.reasoningEffort ? { reasoning_effort: cfg.models.reasoningEffort } : {}),
      messages: [
        {
          role: "system",
          content: `You write short call summaries for a voice agent${pb ? ` running the "${pb.name}" playbook` : ""}. Write in English, plain text, no markdown symbols like # or *.
Use exactly these sections, each starting on its own line:
Summary: two or three sentences on what happened.
Caller intent: the main thing the caller wanted.
Caller mood: how they felt at the start and at the end.
Key details: ${focus} Use "- " lines; skip anything not mentioned.
Action items: "- " lines, or "- None".
Outcome: one line.`,
        },
        { role: "user", content: `Call duration: ${body.duration || "unknown"}\n\nTranscript:\n${turns}` },
      ],
    });
    json(res, 200, { summary: out.choices[0]?.message?.content?.trim() || "No summary.", usage: usageOf(out.usage) });
  } catch (err) {
    console.error(err);
    json(res, 502, { error: friendlyError(err) });
  }
}

async function handleTts(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return res.writeHead(400).end("Bad JSON");
  }
  const text = String(body.text || "").trim().slice(0, 1500);
  if (!text) return res.writeHead(400).end("No text");
  const voice = VOICES[body.voice] ? body.voice : "marin";
  const emotion = EMOTIONS[body.emotion] ? body.emotion : "neutral";
  const language = LANGUAGE_NAMES[body.lang] || "English";
  const ttsModel = getConfig().models.tts;
  const legacy = /^tts-1/.test(ttsModel); // tts-1 / tts-1-hd: no emotion instructions, older voice set
  const LEGACY_VOICES = ["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"];
  try {
    const audio = await getClient().audio.speech.create({
      model: ttsModel,
      voice: legacy && !LEGACY_VOICES.includes(voice) ? "alloy" : voice,
      input: text,
      ...(legacy ? {} : { instructions: `You are a voice agent on a phone call. ${LANGUAGE_STYLE[body.lang]?.voice || `Speak ${language} with a natural native accent.`} ${EMOTIONS[emotion]}` }),
      response_format: "mp3",
    });
    const buf = Buffer.from(await audio.arrayBuffer());
    res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": buf.length, "Cache-Control": "no-store" });
    res.end(buf);
  } catch (err) {
    console.error(err);
    res.writeHead(502, { "Content-Type": "text/plain" }).end(friendlyError(err));
  }
}

// Speech-to-text for one caller utterance. Body: { audio: base64, mime, lang, context }.
// The context (agent's last line) and language hint help the model hear names, numbers and mixed languages right.
async function handleTranscribe(req, res) {
  const cfg = getConfig();
  let body;
  try {
    body = JSON.parse((await readRaw(req, 25 * 1024 * 1024)).toString("utf8") || "{}");
  } catch {
    return json(res, 400, { error: "Bad request" });
  }
  const audio = Buffer.from(String(body.audio || ""), "base64");
  if (audio.length < 1000) return json(res, 200, { text: "" }); // too short to contain speech
  const mime = String(body.mime || "audio/webm").split(";")[0];
  const ext = { "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg", "audio/wav": "wav", "audio/mpeg": "mp3" }[mime] || "webm";
  const language = LANGUAGE_NAMES[body.lang] || "English";
  const hint = [
    `Phone call with a voice assistant. The caller usually speaks ${language}${body.lang === "en-JM" ? " (write it in natural Patois spelling as spoken)" : ""}, and may mix in English or other languages; transcribe exactly what they say, in the language they say it.`,
    body.context ? `The assistant just said: "${String(body.context).slice(0, 300)}"` : "",
  ].filter(Boolean).join(" ");
  try {
    const out = await getClient().audio.transcriptions.create({
      file: await toFile(audio, `speech.${ext}`, { type: mime }),
      model: cfg.speechToText.model,
      prompt: hint,
    });
    json(res, 200, { text: (out.text || "").trim() });
  } catch (err) {
    console.error(err);
    json(res, 502, { error: friendlyError(err) });
  }
}

// Models available on this OpenAI account, grouped for the Agent setup dropdowns (cached 10 minutes).
const MODEL_FALLBACK = {
  chat: ["gpt-5.5", "gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
  stt: ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"],
  tts: ["gpt-4o-mini-tts", "tts-1-hd", "tts-1"],
};
let modelCache = null;
async function handleModels(req, res) {
  if (modelCache && Date.now() - modelCache.at < 10 * 60 * 1000) return json(res, 200, modelCache.data);
  try {
    const ids = [];
    for await (const m of getClient().models.list()) ids.push(m.id);
    const pick = (re, not) => ids.filter((id) => re.test(id) && !(not && not.test(id))).sort();
    const data = {
      // Leave out realtime/live models (they need a different API), dated snapshots and non-chat models.
      chat: pick(/^(gpt-|o\d|chatgpt)/, /(audio|realtime|live|tts|transcribe|image|embedding|search|instruct|moderation|diarize|codex|-\d{4}-\d{2}-\d{2})/),
      stt: pick(/(transcribe|whisper)/, /(diarize|realtime|live|-\d{4}-\d{2}-\d{2})/),
      tts: pick(/tts/, /(realtime|live|audio-preview|-\d{4}-\d{2}-\d{2}|-\d{4}$)/),
      source: "account",
    };
    for (const k of ["chat", "stt", "tts"]) if (!data[k].length) data[k] = MODEL_FALLBACK[k];
    modelCache = { at: Date.now(), data };
    json(res, 200, data);
  } catch (err) {
    console.warn("Couldn't list models, using defaults:", err.message);
    json(res, 200, { ...MODEL_FALLBACK, source: "fallback" });
  }
}

async function handleSettings(req, res) {
  try {
    const cfg = await saveAgentSettings(await readBody(req));
    json(res, 200, { ok: true, settings: publicConfig(cfg) });
  } catch (err) {
    json(res, 400, { error: err.message });
  }
}

async function handleCalendar(req, res, url) {
  const id = url.pathname.split("/")[3];
  try {
    if (req.method === "GET" && id === "calendar.ics") {
      res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="telemunesmartai-calendar.ics"' });
      return res.end(await toIcs());
    }
    if (req.method === "GET" && id && url.pathname.endsWith(".ics")) {
      const evId = id.replace(/\.ics$/, "");
      res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="event-${evId}.ics"` });
      return res.end(await toIcs(evId));
    }
    if (req.method === "GET" && !id) return json(res, 200, await listEvents());
    if (req.method === "POST" && !id) {
      if (!getConfig().calendar.enabled) return json(res, 403, { error: "Calendar is switched off in Agent setup." });
      return json(res, 201, await addEvent(await readBody(req)));
    }
    if (req.method === "DELETE" && id) return json(res, (await removeEvent(id)) ? 200 : 404, { ok: true });
  } catch (err) {
    return json(res, 400, { error: err.message });
  }
  res.writeHead(405).end();
}

async function handlePlaybooks(req, res, url) {
  const id = url.pathname.split("/")[3];
  if (req.method === "GET" && !id) return json(res, 200, { types: AGENT_TYPES, saved: await listPlaybooks() });
  if (req.method === "POST" && !id) {
    try {
      return json(res, 201, await addPlaybook(await readBody(req)));
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }
  if (req.method === "DELETE" && id) return json(res, (await removePlaybook(id)) ? 200 : 404, { ok: true });
  res.writeHead(405).end();
}

async function handleCalls(req, res, url) {
  const [, , , id, sub] = url.pathname.split("/"); // /api/calls/:id/recording
  try {
    if (req.method === "GET" && !id) {
      return json(res, 200, await listCalls(Number(url.searchParams.get("page")) || 1, Number(getConfig().history.pageSize) || 5));
    }
    if (req.method === "GET" && id === "stats") return json(res, 200, await callStats());
    if (req.method === "POST" && !id) return json(res, 201, await saveCall(await readBody(req)));
    if (sub === "summary" && req.method === "GET") {
      const file = await readSummaryFile(id);
      if (!file) return res.writeHead(404).end("No summary");
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="call-summary-${id}.txt"` });
      return res.end(file);
    }
    if (req.method === "GET" && id && !sub) {
      const call = await getCall(id);
      return call ? json(res, 200, call) : json(res, 404, { error: "Not found" });
    }
    if (req.method === "DELETE" && id && !sub) return json(res, (await deleteCall(id)) ? 200 : 404, { ok: true });
    if (sub === "recording" && req.method === "PUT") {
      const rec = await saveRecording(id, req.headers["content-type"], await readRaw(req, getConfig().history.maxRecordingMB * 1024 * 1024));
      return rec ? json(res, 200, rec) : json(res, 404, { error: "Not found" });
    }
    if (sub === "recording" && req.method === "GET") {
      const rec = await readRecording(id);
      if (!rec) return res.writeHead(404).end("No recording");
      res.writeHead(200, { "Content-Type": rec.type, "Content-Length": rec.data.length, "Content-Disposition": `inline; filename="call-${id}.${rec.file.split(".").pop()}"` });
      return res.end(rec.data);
    }
  } catch (err) {
    console.error(err);
    return json(res, 400, { error: err.message });
  }
  res.writeHead(405).end();
}

// ---------- sign-in ----------
async function handleLogin(req, res) {
  try {
    const body = await readBody(req);
    const ip = req.socket.remoteAddress || "";
    const { token, maxAge, user } = await login(body.username, body.password, !!body.remember, ip);
    res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": sessionCookie(token, maxAge) });
    res.end(JSON.stringify({ ok: true, user, next: user.role === ROLE_ADMIN ? "/admin.html" : "/" }));
  } catch (err) {
    json(res, err.status || 400, { error: err.message });
  }
}

async function handleMe(req, res, session) {
  if (req.method === "GET") return json(res, 200, { user: session.user });
  if (req.method === "POST" && new URL(req.url, "http://x").pathname === "/api/me/password") {
    try {
      const body = await readBody(req);
      await changeOwnPassword(session.user.id, body.current, body.next);
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }
  res.writeHead(405).end();
}

// ---------- admin (role 1) ----------
const toSeconds = (d) => String(d || "0:0").split(":").reduce((a, n) => a * 60 + (Number(n) || 0), 0);

async function userSnapshot(u) {
  return asUser(u.id, async () => {
    const cfg = getConfig();
    const [stats, playbooks, events, recent] = await Promise.all([
      callStats(), listPlaybooks(), listEvents().catch(() => []), listCalls(1, 1),
    ]);
    const pb = playbooks.find((p) => p.id === cfg.agent.defaultPlaybookId);
    return {
      ...u,
      agent: {
        name: cfg.agent.defaultName, language: cfg.agent.defaultLanguage, voice: cfg.agent.defaultVoice,
        playbook: pb ? pb.name : null, llm: cfg.models.chat,
        stt: cfg.speechToText.engine === "openai" ? cfg.speechToText.model : "browser", tts: cfg.models.tts,
        calendar: !!cfg.calendar?.enabled, emergency: !!cfg.emergency?.enabled, emergencyNumbers: cfg.emergency?.rules?.length || 0,
      },
      playbooks: playbooks.map((p) => ({ id: p.id, name: p.name, type: p.type, goal: p.goal })),
      events: events.length,
      stats,
      lastCallAt: recent.items[0]?.startedAt || null,
    };
  });
}

async function handleAdmin(req, res, url, session) {
  const [, , , what, id] = url.pathname.split("/"); // /api/admin/<what>/<id>
  try {
    if (req.method === "GET" && what === "overview") {
      const users = await Promise.all((await listUsers()).map(userSnapshot));
      const sum = (f) => users.reduce((a, u) => a + (Number(f(u)) || 0), 0);
      const replies = users.map((u) => u.stats.avgResponseMs).filter((x) => typeof x === "number");
      return json(res, 200, {
        totals: {
          users: users.length, admins: users.filter((u) => u.role === ROLE_ADMIN).length, active: users.filter((u) => !u.disabled).length,
          calls: sum((u) => u.stats.calls), seconds: sum((u) => u.stats.totalSeconds), turns: sum((u) => u.stats.turns),
          tokens: sum((u) => u.stats.tokens.total), recordings: sum((u) => u.stats.recordings), playbooks: sum((u) => u.playbooks.length),
          events: sum((u) => u.events), avgResponseMs: replies.length ? Math.round(replies.reduce((a, b) => a + b, 0) / replies.length) : null,
        },
        users,
      });
    }
    if (what === "users") {
      if (req.method === "POST" && !id) return json(res, 201, await createUser(await readBody(req)));
      if (req.method === "GET" && id) {
        const u = await getUser(id);
        return u ? json(res, 200, await userSnapshot(publicUser(u))) : json(res, 404, { error: "User not found." });
      }
      if (req.method === "PATCH" && id) return json(res, 200, await updateUser(id, await readBody(req), session.user.id));
      if (req.method === "DELETE" && id) return json(res, 200, { ok: await deleteUser(id, session.user.id) });
    }
  } catch (err) {
    return json(res, 400, { error: err.message });
  }
  return json(res, 404, { error: "Unknown admin route" });
}

// ---------- routing ----------
function redirect(res, to) {
  res.writeHead(302, { Location: to, "Cache-Control": "no-store" });
  res.end();
}

async function routeApi(req, res, url) {
  if (url.pathname.startsWith("/api/calls")) return handleCalls(req, res, url);
  if (url.pathname.startsWith("/api/playbooks")) return handlePlaybooks(req, res, url);
  if (url.pathname.startsWith("/api/calendar")) return handleCalendar(req, res, url);
  if (req.method === "GET" && url.pathname === "/api/models") return handleModels(req, res);
  if (req.method === "POST" && url.pathname === "/api/settings") return handleSettings(req, res);
  if (req.method === "POST" && url.pathname === "/api/chat") return handleChat(req, res);
  if (req.method === "POST" && url.pathname === "/api/tts") return handleTts(req, res);
  if (req.method === "POST" && url.pathname === "/api/transcribe") return handleTranscribe(req, res);
  if (req.method === "POST" && url.pathname === "/api/summary") return handleSummary(req, res);
  if (req.method === "GET" && url.pathname === "/api/config") {
    const cfg = getConfig();
    return json(res, 200, { stale: (await codeStamp()) !== BOOT_STAMP, me: requestContext.getStore()?.user, model: cfg.models.chat, ttsModel: cfg.models.tts, sttModel: publicConfig(cfg).models.stt, languages: LANGUAGE_NAMES, voices: VOICES, emotions: Object.keys(EMOTIONS), settings: publicConfig(cfg) });
  }
  return json(res, 404, { error: `Unknown API route ${url.pathname}` });
}

const PROTECTED_PAGES = new Set(["/", "/index.html", "/admin.html"]);

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // Public: sign in / out.
  if (p === "/api/login" && req.method === "POST") return handleLogin(req, res);
  if (p === "/api/logout" && req.method === "POST") {
    const s = await sessionFrom(req);
    if (s) await logout(s.token);
    res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": clearCookie() });
    return res.end(JSON.stringify({ ok: true }));
  }

  const session = await sessionFrom(req);

  if (p.startsWith("/api/")) {
    if (!session) return json(res, 401, { error: "Please sign in." });
    // Block cross-site requests that change data.
    const origin = req.headers.origin;
    if (req.method !== "GET" && origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: "Cross-site request blocked." });
    if (p === "/api/me" || p === "/api/me/password") return handleMe(req, res, session);
    if (p.startsWith("/api/admin/")) {
      if (session.user.role !== ROLE_ADMIN) return json(res, 403, { error: "Admins only." });
      return requestContext.run({ user: session.user, dataUserId: session.user.id }, () => handleAdmin(req, res, url, session));
    }
    // Admin may read (GET only) another user's data with ?as=<userId>.
    let dataUserId = session.user.id;
    const as = url.searchParams.get("as");
    if (as && session.user.role === ROLE_ADMIN && req.method === "GET") {
      if (!(await getUser(as))) return json(res, 404, { error: "User not found." });
      dataUserId = as;
    }
    return requestContext.run({ user: session.user, dataUserId }, () => routeApi(req, res, url));
  }

  // Pages
  if (p === "/login.html" && session) return redirect(res, session.user.role === ROLE_ADMIN ? "/admin.html" : "/");
  if (PROTECTED_PAGES.has(p)) {
    if (!session) return redirect(res, "/login.html");
    if (p === "/admin.html" && session.user.role !== ROLE_ADMIN) return redirect(res, "/");
  }
  if (req.method !== "GET") return res.writeHead(405).end();

  const file = path.normalize(path.join(PUBLIC_DIR, p === "/" ? "index.html" : p));
  if (!file.startsWith(PUBLIC_DIR)) return res.writeHead(403).end();
  try {
    const content = await fs.readFile(file);
    const headers = { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" };
    if (file.endsWith(".html")) headers["Cache-Control"] = "no-store"; // pages depend on who is signed in
    res.writeHead(200, headers);
    res.end(content);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: "Server error" });
    else res.end();
  });
});

// First start with accounts: create admin/admin@123 and move existing data into the admin's account.
const setup = await ensureSetup(CONFIG_PATH);
if (setup) console.log(`Created admin account "admin" (password admin@123, change it after signing in). Moved into it: ${setup.moved.join(", ") || "nothing"}.`);

server.listen(PORT, () => {
  const cfg = getConfig();
  console.log(`${BRAND()} running at http://localhost:${PORT}  (chat: ${cfg.models.chat}, voice: ${cfg.models.tts})`);
  if (!process.env.OPENAI_API_KEY) console.warn("Warning: OPENAI_API_KEY is not set — calls will fail until you add it to .env");
});
