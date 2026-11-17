// Call history per user: calls.json, each summary also as summaries/<id>.txt, recordings/<id>.<ext>.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { userDataDir } from "./context.js";

// Everything is per user: data/users/<userId>/{calls.json, summaries/, recordings/} (user from the request context).
const USER_DIR = () => userDataDir();
const CALLS_FILE = () => path.join(USER_DIR(), "calls.json");
const REC_DIR = () => path.join(USER_DIR(), "recordings");
const SUM_DIR = () => path.join(USER_DIR(), "summaries");
const REC_TYPES = { "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg" };

async function readCalls() {
  try {
    return JSON.parse(await fs.readFile(CALLS_FILE(), "utf8"));
  } catch {
    return [];
  }
}

async function writeCalls(list) {
  await fs.mkdir(USER_DIR(), { recursive: true });
  await fs.writeFile(CALLS_FILE(), JSON.stringify(list, null, 2));
}

export async function listCalls(page = 1, pageSize = 5) {
  const all = await readCalls();
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  // List view leaves out the transcript to stay light.
  const items = all.slice((p - 1) * pageSize, p * pageSize).map(({ transcript, ...rest }) => rest);
  return { items, page: p, pages, total: all.length, pageSize };
}

export async function getCall(id) {
  return (await readCalls()).find((c) => c.id === id) || null;
}

export async function saveCall(input) {
  const call = {
    id: crypto.randomUUID().slice(0, 8),
    startedAt: String(input.startedAt || new Date().toISOString()),
    endedAt: new Date().toISOString(),
    duration: String(input.duration || "00:00").slice(0, 12),
    endedBy: String(input.endedBy || "user").slice(0, 40),
    playbook: input.playbook ? { name: String(input.playbook.name).slice(0, 60), icon: String(input.playbook.icon || "").slice(0, 8), type: String(input.playbook.type || "").slice(0, 30) } : null,
    language: String(input.language || "").slice(0, 40),
    voice: String(input.voice || "").slice(0, 20),
    stats: input.stats && typeof input.stats === "object" ? input.stats : {},
    summary: String(input.summary || "").slice(0, 8000),
    transcript: Array.isArray(input.transcript) ? input.transcript.slice(0, 300) : [],
    recording: null,
  };
  const all = await readCalls();
  all.unshift(call); // newest first
  await writeCalls(all);
  await fs.mkdir(SUM_DIR(), { recursive: true });
  await fs.writeFile(path.join(SUM_DIR(), `${call.id}.txt`), summaryText(call));
  return call;
}

// The permanent, human-readable summary file for one call.
function summaryText(c) {
  const st = c.stats || {};
  const tk = st.tokens || {};
  const fmt = (ms) => (ms == null ? "?" : (ms / 1000).toFixed(1) + "s");
  const lines = (c.transcript || []).map((t) => t.role === "caller"
    ? `Caller: ${t.text}\n   [intent: ${t.intent || "?"} | mood: ${t.mood || "?"} | language: ${t.lang || "?"} | reply: ${fmt(t.responseMs)}]` +
      (t.emergency ? `\n   🚨 EMERGENCY: ${t.emergency}` : "") + (t.calendar ? `\n   📅 Calendar: ${t.calendar}` : "")
    : `Agent: ${t.text}${t.emotions?.length ? `  (${t.emotions.join(", ")})` : ""}`);
  return [
    "TelemuneSmartAi · Call summary",
    `Call ID: ${c.id}`,
    `Started: ${new Date(c.startedAt).toLocaleString()}`,
    `Playbook: ${c.playbook?.name || "Default agent"}`,
    `Duration: ${c.duration} · Turns: ${st.turns ?? 0} · Avg reply: ${st.avgResponse || "?"} · Ended: ${c.endedBy}`,
    `Language: ${st.languages || c.language || "?"} · Mood: ${st.moodPath || "?"}`,
    `Tokens: ${tk.total ?? 0} (input ${tk.input ?? 0}, output ${tk.output ?? 0})`,
    ...(st.emergencies?.length ? [`🚨 Emergencies: ${st.emergencies.join(", ")}`] : []),
    ...(st.calendarEvents?.length ? [`📅 Calendar events added: ${st.calendarEvents.join(", ")}`] : []),
    "",
    c.summary || "No summary.",
    "",
    "--- Transcript ---",
    ...lines,
    "",
  ].join("\n");
}

export async function readSummaryFile(id) {
  if (!/^[a-z0-9-]+$/i.test(id)) return null;
  try {
    return await fs.readFile(path.join(SUM_DIR(), `${id}.txt`), "utf8");
  } catch {
    const call = await getCall(id); // older calls saved before summary files existed: write theirs now
    if (!call) return null;
    const text = summaryText(call);
    await fs.mkdir(SUM_DIR(), { recursive: true });
    await fs.writeFile(path.join(SUM_DIR(), `${id}.txt`), text);
    return text;
  }
}

const toSeconds = (d) => String(d || "0:0").split(":").reduce((acc, n) => acc * 60 + (Number(n) || 0), 0);

export async function callStats() {
  const all = await readCalls();
  const sum = (f) => all.reduce((a, c) => a + (Number(f(c)) || 0), 0);
  // Older calls only stored "4.0s"; parse that when the number is missing.
  const replies = all.map((c) => c.stats?.avgResponseMs ?? (parseFloat(c.stats?.avgResponse) * 1000 || null)).filter((x) => typeof x === "number");
  return {
    calls: all.length,
    totalSeconds: sum((c) => toSeconds(c.duration)),
    tokens: { input: sum((c) => c.stats?.tokens?.input), output: sum((c) => c.stats?.tokens?.output), total: sum((c) => c.stats?.tokens?.total) },
    avgResponseMs: replies.length ? Math.round(replies.reduce((a, b) => a + b, 0) / replies.length) : null,
    recordings: all.filter((c) => c.recording).length,
    turns: sum((c) => c.stats?.turns),
  };
}

export async function saveRecording(id, contentType, buffer) {
  const all = await readCalls();
  const call = all.find((c) => c.id === id);
  if (!call) return null;
  const ext = REC_TYPES[(contentType || "").split(";")[0]] || "webm";
  await fs.mkdir(REC_DIR(), { recursive: true });
  const file = `${id}.${ext}`;
  await fs.writeFile(path.join(REC_DIR(), file), buffer);
  call.recording = { file, type: (contentType || "audio/webm").split(";")[0], bytes: buffer.length };
  await writeCalls(all);
  return call.recording;
}

export async function readRecording(id) {
  const call = await getCall(id);
  if (!call?.recording) return null;
  return { ...call.recording, data: await fs.readFile(path.join(REC_DIR(), call.recording.file)) };
}

export async function deleteCall(id) {
  const all = await readCalls();
  const call = all.find((c) => c.id === id);
  if (!call) return false;
  if (call.recording) await fs.rm(path.join(REC_DIR(), call.recording.file), { force: true });
  await fs.rm(path.join(SUM_DIR(), `${id}.txt`), { force: true });
  await writeCalls(all.filter((c) => c.id !== id));
  return true;
}
