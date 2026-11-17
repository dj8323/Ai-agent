// App settings. Layers, last wins:
//   DEFAULTS (below) ← MySQL app_config (shared settings, one JSON per section) ← the active agent's own setup
//   (agents + emergency_rules tables) ← env overrides.
// config.json is only the seed for app_config on first start, plus server.port (read at start-up, before the DB).
// Optional env overrides: PORT, OPENAI_MODEL, OPENAI_TTS_MODEL, OPENAI_REASONING_EFFORT.
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query, exec } from "./db.js";
import { currentAgent } from "./context.js";

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
  agent: { defaultName: "Aria", defaultLanguage: "en-US", defaultVoice: "marin", defaultPlaybookId: "", maxReplyWords: 25, maxAgentsPerUser: 20 },
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
  auth: { allowSignup: true, sessionHours: 12, rememberDays: 30 },
};
// Sections kept in the app_config table (server.port stays in config.json: it's needed before the DB connects).
export const DB_SECTIONS = Object.keys(DEFAULTS).filter((k) => k !== "server");

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}

function readConfigFile() {
  try {
    return JSON.parse(fsSync.readFileSync(CONFIG_FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") console.warn("config.json is invalid, using defaults:", err.message);
    return {};
  }
}

/** Port to listen on (config.json server.port or PORT env). */
export function bootPort() {
  return Number(process.env.PORT) || Number(readConfigFile().server?.port) || DEFAULTS.server.port;
}

/** First start: copy config.json (over defaults) into app_config for any section that isn't there yet. */
export async function seedAppConfig() {
  const seed = merge(DEFAULTS, readConfigFile());
  for (const s of DB_SECTIONS) {
    await exec("INSERT IGNORE INTO app_config (section, value) VALUES (?, ?)", [s, JSON.stringify(seed[s])]);
  }
  invalidateConfig();
}

// app_config is cached for a moment (many reads per request); writes clear the cache.
let cache = null;
export const invalidateConfig = () => { cache = null; };
export async function appConfig() {
  if (cache && Date.now() - cache.at < 3000) return cache.cfg;
  const rows = await query("SELECT section, value FROM app_config");
  const fromDb = Object.fromEntries(rows.map((r) => [r.section, r.value]));
  const cfg = merge(DEFAULTS, fromDb);
  cfg.server = { port: bootPort() };
  cache = { at: Date.now(), cfg };
  return cfg;
}

/** Admin: replace one section of the shared settings. */
export async function saveAppSection(section, value, userId) {
  if (!DB_SECTIONS.includes(section)) throw new Error(`Unknown settings section "${section}".`);
  if (!isObj(value)) throw new Error("Settings must be a JSON object.");
  await exec("INSERT INTO app_config (section, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)",
    [section, JSON.stringify(value), userId || null]);
  invalidateConfig();
  return (await appConfig())[section];
}

/** The agent's own setup as config sections (an agent row plus its emergency rules). */
export function agentOverlay(a) {
  if (!a) return {};
  const o = {
    agent: { defaultName: a.name, defaultLanguage: a.language, defaultVoice: a.voice, defaultPlaybookId: a.playbook_id || "" },
    models: {},
    speechToText: {},
    calendar: { enabled: !!a.calendar_enabled },
    emergency: { enabled: !!a.emergency_enabled, rules: a.rules || [] },
  };
  if (a.chat_model) o.models.chat = a.chat_model;
  if (a.tts_model) o.models.tts = a.tts_model;
  if (a.stt_engine) o.speechToText.engine = a.stt_engine;
  if (a.stt_model) o.speechToText.model = a.stt_model;
  return o;
}

/** Full settings for this request: shared settings + the active agent's setup + env overrides. */
export async function getConfig(agent = currentAgent()) {
  const cfg = merge(await appConfig(), agentOverlay(agent));
  const env = process.env;
  if (env.OPENAI_MODEL) cfg.models.chat = env.OPENAI_MODEL;
  if (env.OPENAI_TTS_MODEL) cfg.models.tts = env.OPENAI_TTS_MODEL;
  if (env.OPENAI_REASONING_EFFORT) cfg.models.reasoningEffort = env.OPENAI_REASONING_EFFORT;
  // Older chat models (non gpt-5 / o-series) reject reasoning_effort.
  if (!/^(gpt-5|o\d)/.test(cfg.models.chat)) cfg.models.reasoningEffort = "";
  return cfg;
}

// The part of the config the browser is allowed to see (no secrets live in it anyway).
export function publicConfig(cfg, agent = currentAgent()) {
  return {
    branding: cfg.branding,
    agent: cfg.agent,
    currentAgent: agent ? { id: agent.id, name: agent.name, type: agent.agent_type, description: agent.description, isDefault: !!agent.is_default } : null,
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
