// Agents: every user can create as many as they need (personal, hospital, HR, banking …).
// Each agent keeps its own name, language, voice, models, playbook, calendar switch and emergency numbers
// (tables agents + emergency_rules). Saving one agent never changes another agent or another user.
import { query, one, exec, tx, iso } from "./db.js";
import { newId } from "./auth.js";
import { appConfig } from "./config.js";
import { AGENT_TYPES } from "./playbooks.js";
import { currentAgent, currentDataUserId } from "./context.js";

const str = (v, max = 80) => String(v ?? "").trim().slice(0, max);
const modelId = (v) => (/^[a-z0-9][a-z0-9._:-]{1,79}$/i.test(String(v || "")) ? String(v) : null);
const typeOf = (t) => (AGENT_TYPES[t] ? t : "other");

async function withRules(a) {
  if (!a) return null;
  a.rules = (await query("SELECT label, number, keywords FROM emergency_rules WHERE agent_id = ? ORDER BY sort_order, id", [a.id]))
    .map((r) => ({ label: r.label, number: r.number, keywords: r.keywords || [] }));
  return a;
}

/** One agent of this user (with its emergency rules), or null. */
export async function getAgent(id, userId = currentDataUserId()) {
  if (!id) return null;
  return withRules(await one("SELECT * FROM agents WHERE id = ? AND user_id = ?", [id, userId]));
}

/** What the browser and the admin dashboard see. */
export const agentCard = (a) => ({
  id: a.id, name: a.name, type: a.agent_type, typeName: AGENT_TYPES[a.agent_type]?.name || "Custom", icon: AGENT_TYPES[a.agent_type]?.icon || "✨",
  description: a.description, language: a.language, voice: a.voice, chatModel: a.chat_model, ttsModel: a.tts_model,
  stt: a.stt_engine === "browser" ? "browser" : a.stt_model, playbookId: a.playbook_id || "", calendar: !!a.calendar_enabled,
  emergency: !!a.emergency_enabled, isDefault: !!a.is_default, createdAt: iso(a.created_at), updatedAt: iso(a.updated_at),
});

export async function listAgents(userId = currentDataUserId()) {
  return query("SELECT * FROM agents WHERE user_id = ? ORDER BY is_default DESC, created_at", [userId]);
}

/** Create an agent. Its setup starts from the app defaults; the type decides its role (e.g. hospital front desk). */
export async function createAgent(input, userId = currentDataUserId()) {
  const cfg = await appConfig();
  const count = (await one("SELECT COUNT(*) AS n FROM agents WHERE user_id = ?", [userId])).n;
  if (count >= (Number(cfg.agent.maxAgentsPerUser) || 20)) throw new Error(`You can have up to ${cfg.agent.maxAgentsPerUser} agents.`);
  const type = typeOf(input.type);
  const name = str(input.name, 24) || cfg.agent.defaultName;
  const id = newId();
  const emergencyRules = Array.isArray(input.rules) ? input.rules : cfg.emergency.rules || [];
  await tx(async (t) => {
    await t.exec(
      `INSERT INTO agents (id, user_id, name, agent_type, description, language, voice, playbook_id, calendar_enabled, emergency_enabled, is_default,
                           chat_model, tts_model, stt_engine, stt_model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, name, type, str(input.description, 300) || AGENT_TYPES[type]?.description || "",
        str(input.language, 10) || cfg.agent.defaultLanguage, str(input.voice, 20) || cfg.agent.defaultVoice,
        str(input.playbookId, 16) || null, (input.calendar ?? cfg.calendar.enabled) ? 1 : 0,
        (input.emergency ?? cfg.emergency.enabled) ? 1 : 0, count === 0 || input.isDefault ? 1 : 0,
        modelId(input.chatModel), modelId(input.ttsModel), input.sttEngine === "browser" ? "browser" : input.sttEngine === "openai" ? "openai" : null,
        modelId(input.sttModel)],
    );
    if (input.isDefault && count) await t.exec("UPDATE agents SET is_default = 0 WHERE user_id = ? AND id <> ?", [userId, id]);
    await writeRules(t, id, emergencyRules);
  });
  return getAgent(id, userId);
}

/** Make sure a user has at least one agent (a personal assistant). Returns their default agent. */
export async function ensureDefaultAgent(userId = currentDataUserId()) {
  const a = await one("SELECT * FROM agents WHERE user_id = ? ORDER BY is_default DESC, created_at LIMIT 1", [userId]);
  if (a) return withRules(a);
  return createAgent({ type: "personal" }, userId);
}

/** The agent a request is for: the one the page asked for (if it's theirs), else their default agent. */
export async function resolveAgent(userId, requestedId) {
  if (requestedId && /^[a-z0-9-]{1,16}$/i.test(requestedId)) {
    const a = await getAgent(requestedId, userId);
    if (a) return a;
  }
  return ensureDefaultAgent(userId);
}

/** Rename / describe / change type / make default. */
export async function updateAgentInfo(id, input, userId = currentDataUserId()) {
  const a = await getAgent(id, userId);
  if (!a) throw new Error("Agent not found.");
  const set = {};
  if (input.name !== undefined) set.name = str(input.name, 24) || a.name;
  if (input.description !== undefined) set.description = str(input.description, 300);
  if (input.type !== undefined) set.agent_type = typeOf(input.type);
  if (Object.keys(set).length) await exec("UPDATE agents SET ? WHERE id = ?", [set, id]);
  if (input.isDefault) {
    await exec("UPDATE agents SET is_default = (id = ?) WHERE user_id = ?", [id, userId]);
  }
  return getAgent(id, userId);
}

export async function deleteAgent(id, userId = currentDataUserId()) {
  const a = await getAgent(id, userId);
  if (!a) throw new Error("Agent not found.");
  if ((await one("SELECT COUNT(*) AS n FROM agents WHERE user_id = ?", [userId])).n <= 1) throw new Error("You need at least one agent.");
  await exec("DELETE FROM agents WHERE id = ?", [id]); // calls and events keep their history (agent_id → NULL)
  if (a.is_default) await exec("UPDATE agents SET is_default = 1 WHERE user_id = ? ORDER BY created_at LIMIT 1", [userId]);
  return a;
}

async function writeRules(t, agentId, rules) {
  await t.exec("DELETE FROM emergency_rules WHERE agent_id = ?", [agentId]);
  const clean = (Array.isArray(rules) ? rules : [])
    .map((r) => ({
      label: str(r.label, 40),
      number: str(r.number, 20).replace(/[^\d+*# -]/g, ""),
      keywords: [...new Set((Array.isArray(r.keywords) ? r.keywords : []).map((k) => str(k, 40).toLowerCase()).filter(Boolean))].slice(0, 30),
    }))
    .filter((r) => r.label && r.number && r.keywords.length)
    .slice(0, 20);
  for (const [i, r] of clean.entries()) {
    await t.exec("INSERT INTO emergency_rules (agent_id, label, number, keywords, sort_order) VALUES (?, ?, ?, ?, ?)",
      [agentId, r.label, r.number, JSON.stringify(r.keywords), i]);
  }
}

// Saves from the Agent setup card run one at a time per agent, so two quick edits can't interleave.
const queues = new Map();
export function saveAgentSettings(input, agent = currentAgent()) {
  if (!agent) return Promise.reject(new Error("No agent selected."));
  const prev = queues.get(agent.id) || Promise.resolve();
  const run = prev.then(() => writeAgentSettings(agent.id, agent.user_id, input));
  queues.set(agent.id, run.catch(() => {}));
  return run;
}

async function writeAgentSettings(agentId, userId, input) {
  const set = {};
  const a = input.agent || {};
  if (a.defaultName) set.name = str(a.defaultName, 24);
  if (a.defaultLanguage) set.language = str(a.defaultLanguage, 10);
  if (a.defaultVoice) set.voice = str(a.defaultVoice, 20);
  if ("defaultPlaybookId" in a) {
    const pb = str(a.defaultPlaybookId, 16);
    set.playbook_id = pb && (await one("SELECT id FROM playbooks WHERE id = ? AND user_id = ?", [pb, userId])) ? pb : null;
  }
  const m = input.models || {};
  if (modelId(m.chat)) set.chat_model = m.chat;
  if (modelId(m.tts)) set.tts_model = m.tts;
  if (m.stt === "browser") set.stt_engine = "browser";
  else if (modelId(m.stt)) { set.stt_engine = "openai"; set.stt_model = m.stt; }
  if (input.calendar) set.calendar_enabled = input.calendar.enabled ? 1 : 0;
  if (input.emergency) set.emergency_enabled = input.emergency.enabled ? 1 : 0;
  await tx(async (t) => {
    if (Object.keys(set).length) await t.exec("UPDATE agents SET ? WHERE id = ? AND user_id = ?", [set, agentId, userId]);
    if (input.emergency) await writeRules(t, agentId, input.emergency.rules);
  });
  return getAgent(agentId, userId);
}
