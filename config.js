// Loads config.json (all tunable settings) merged over safe defaults, then the signed-in user's own agent setup.
// Layers: DEFAULTS ← config.json (global; defaults for every user) ← data/users/<id>/settings.json (that user's
// agent, models, speechToText, calendar, emergency) ← env overrides.
// Read fresh on every call, so most edits apply on the next request / page load.
// Exception: server.port is only read at startup (restart to change it).
// Optional env overrides: PORT, OPENAI_MODEL, OPENAI_TTS_MODEL, OPENAI_REASONING_EFFORT.
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentDataUserId, userDataDir } from "./context.js";

const CONFIG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "config.json");

export const DEFAULTS = {
  server: { port: 8323 },
  branding: {
    appName: "TelemuneSmartAi",
    tagline: "Talk naturally, get things done ⚡",
    logo: "telemune-mark.png", // shape only: shown filled with the theme gradient
    favicon: "telemune-logo.svg",
    footer: "Powered by Telemune © 2027 · Designed by DJ",
    theme: { primary: "#7c3aed", secondary: "#ec4899", tertiary: "#06b6d4" },
  },
  agent: { defaultName: "Aria", defaultLanguage: "en-US", defaultVoice: "marin", defaultPlaybookId: "", maxReplyWords: 25 },
  models: { chat: "gpt-5.5", tts: "gpt-4o-mini-tts", reasoningEffort: "low", maxReplyTokens: 1024, maxSummaryTokens: 2048 },
  speechToText: { engine: "openai", model: "gpt-4o-transcribe", vadThreshold: 0.015, minSpeechMs: 250, maxUtteranceSeconds: 60 },
  conversation: { responseDelayMs: 2000, hangupDelayMs: 800, historyTurnsSentToModel: 30 },
  history: { pageSize: 5, maxRecordingMB: 100 },
  calendar: { enabled: false, defaultDurationMin: 30 },
  emergency: {
    enabled: true,
    rules: [
      { label: "All emergencies", number: "112", keywords: ["emergency", "help me", "bachao", "danger"] },
      { label: "Ambulance", number: "108", keywords: ["ambulance", "heart attack", "chest pain", "accident", "bleeding", "unconscious", "can't breathe"] },
      { label: "Police", number: "100", keywords: ["police", "robbery", "thief", "attack", "kidnap", "chor"] },
      { label: "Fire", number: "101", keywords: ["fire", "smoke", "aag", "burning", "gas leak"] },
      { label: "Women helpline", number: "1091", keywords: ["harassment", "women helpline", "stalking", "domestic violence"] },
      { label: "Mental health helpline", number: "14416", keywords: ["suicide", "kill myself", "self harm", "want to die"] },
    ],
  },
};

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}

// The parts of the config that each user sets for their own agent.
export const USER_KEYS = ["agent", "models", "speechToText", "calendar", "emergency"];

let warned = false;
export function getConfig() {
  let file = {};
  try {
    file = JSON.parse(fsSync.readFileSync(CONFIG_FILE, "utf8"));
    warned = false;
  } catch (err) {
    if (err.code !== "ENOENT" && !warned) console.warn("config.json is invalid, using defaults:", err.message);
    warned = true;
  }
  let cfg = merge(DEFAULTS, file);
  const uid = currentDataUserId();
  if (uid) {
    try {
      const mine = JSON.parse(fsSync.readFileSync(path.join(userDataDir(uid), "settings.json"), "utf8"));
      const allowed = Object.fromEntries(Object.entries(mine).filter(([k]) => USER_KEYS.includes(k)));
      cfg = merge(cfg, allowed);
    } catch { /* new user: global defaults */ }
  }
  const env = process.env;
  if (env.PORT) cfg.server.port = Number(env.PORT);
  if (env.OPENAI_MODEL) cfg.models.chat = env.OPENAI_MODEL;
  if (env.OPENAI_TTS_MODEL) cfg.models.tts = env.OPENAI_TTS_MODEL;
  if (env.OPENAI_REASONING_EFFORT) cfg.models.reasoningEffort = env.OPENAI_REASONING_EFFORT;
  // Older chat models (non gpt-5 / o-series) reject reasoning_effort.
  if (!/^(gpt-5|o\d)/.test(cfg.models.chat)) cfg.models.reasoningEffort = "";
  return cfg;
}

// The part of the config the browser is allowed to see (no secrets live in config.json anyway).
export function publicConfig(cfg = getConfig()) {
  return {
    branding: cfg.branding,
    agent: cfg.agent,
    conversation: { responseDelayMs: cfg.conversation.responseDelayMs, hangupDelayMs: cfg.conversation.hangupDelayMs },
    history: { pageSize: cfg.history.pageSize },
    speechToText: {
      engine: cfg.speechToText.engine, vadThreshold: cfg.speechToText.vadThreshold,
      minSpeechMs: cfg.speechToText.minSpeechMs, maxUtteranceSeconds: cfg.speechToText.maxUtteranceSeconds,
    },
    models: { chat: cfg.models.chat, tts: cfg.models.tts, stt: cfg.speechToText.engine === "openai" ? cfg.speechToText.model : "browser", sttModel: cfg.speechToText.model },
    calendar: cfg.calendar,
    emergency: cfg.emergency,
  };
}

// ---------- saving from the "Agent setup" panel ----------
// Only these fields can be changed from the browser; everything else in config.json is left untouched.
const str = (v, max = 80) => String(v ?? "").trim().slice(0, max);
const modelId = (v) => (/^[a-z0-9][a-z0-9._:-]{1,79}$/i.test(String(v || "")) ? String(v) : null);

// Saves run one at a time (no two requests rewriting config.json together), and each write goes to a temp
// file that is then renamed into place, so a reader never sees a half-written config.json.
let saveQueue = Promise.resolve();
export const CONFIG_PATH = CONFIG_FILE;
export function saveAgentSettings(input) {
  const run = saveQueue.then(() => writeAgentSettings(input));
  saveQueue = run.catch(() => {});
  return run;
}

async function writeAgentSettings(input) {
  // Saved per user (data/users/<id>/settings.json); config.json stays the shared default.
  const target = path.join(userDataDir(), "settings.json");
  let file = {};
  try {
    file = JSON.parse(await fs.readFile(target, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw new Error("Your saved settings file is damaged; ask the admin.");
  }
  file.agent ??= {}; file.models ??= {}; file.speechToText ??= {}; file.calendar ??= {}; file.emergency ??= {};
  const a = input.agent || {};
  if (a.defaultName) file.agent.defaultName = str(a.defaultName, 24);
  if (a.defaultLanguage) file.agent.defaultLanguage = str(a.defaultLanguage, 10);
  if (a.defaultVoice) file.agent.defaultVoice = str(a.defaultVoice, 20);
  if ("defaultPlaybookId" in a) file.agent.defaultPlaybookId = str(a.defaultPlaybookId, 20);
  const m = input.models || {};
  if (modelId(m.chat)) file.models.chat = m.chat;
  if (modelId(m.tts)) file.models.tts = m.tts;
  if (m.stt === "browser") file.speechToText.engine = "browser";
  else if (modelId(m.stt)) { file.speechToText.engine = "openai"; file.speechToText.model = m.stt; }
  if (input.calendar) file.calendar.enabled = !!input.calendar.enabled;
  if (input.emergency) {
    file.emergency.enabled = !!input.emergency.enabled;
    file.emergency.rules = (Array.isArray(input.emergency.rules) ? input.emergency.rules : [])
      .map((r) => ({
        label: str(r.label, 40),
        number: str(r.number, 20).replace(/[^\d+*# -]/g, ""),
        keywords: [...new Set((Array.isArray(r.keywords) ? r.keywords : []).map((k) => str(k, 40).toLowerCase()).filter(Boolean))].slice(0, 30),
      }))
      .filter((r) => r.label && r.number && r.keywords.length)
      .slice(0, 20);
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(file, null, 2) + "\n");
  await fs.rename(tmp, target);
  return getConfig();
}
