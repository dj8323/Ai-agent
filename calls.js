// Call history (MySQL tables: calls + call_summaries). Recordings stay on disk: data/users/<userId>/recordings/.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { query, one, exec, tx, iso, toDate } from "./db.js";
import { currentDataUserId, currentAgent, userDataDir } from "./context.js";

const REC_DIR = (uid) => path.join(userDataDir(uid), "recordings");
const REC_TYPES = { "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg" };
const toSeconds = (d) => String(d || "0:0").split(":").reduce((acc, n) => acc * 60 + (Number(n) || 0), 0);
const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

const fromRow = (r, withTranscript = true) => ({
  id: r.id,
  agentId: r.agent_id,
  agentName: r.agent_name,
  startedAt: iso(r.started_at),
  endedAt: iso(r.ended_at),
  duration: r.duration,
  endedBy: r.ended_by,
  playbook: r.playbook || null,
  language: r.language,
  voice: r.voice,
  stats: r.stats || {},
  summary: r.summary || "",
  ...(withTranscript ? { transcript: r.transcript || [] } : {}),
  recording: r.recording_file ? { file: r.recording_file, type: r.recording_type, bytes: r.recording_bytes } : null,
});

const SELECT = "SELECT c.*, s.summary FROM calls c LEFT JOIN call_summaries s ON s.call_id = c.id";

export async function listCalls(page = 1, pageSize = 5, { agentId = null, userId = currentDataUserId() } = {}) {
  const where = agentId ? "c.user_id = ? AND c.agent_id = ?" : "c.user_id = ?";
  const args = agentId ? [userId, agentId] : [userId];
  const total = (await one(`SELECT COUNT(*) AS n FROM calls c WHERE ${where}`, args)).n;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const rows = await query(`${SELECT} WHERE ${where} ORDER BY c.started_at DESC LIMIT ? OFFSET ?`, [...args, pageSize, (p - 1) * pageSize]);
  // The list leaves out transcripts to stay light.
  return { items: rows.map((r) => fromRow(r, false)), page: p, pages, total, pageSize };
}

export async function getCall(id, userId = currentDataUserId()) {
  const r = await one(`${SELECT} WHERE c.id = ? AND c.user_id = ?`, [String(id).slice(0, 16), userId]);
  return r ? fromRow(r) : null;
}

export async function saveCall(input, userId = currentDataUserId(), agent = currentAgent()) {
  const stats = input.stats && typeof input.stats === "object" ? input.stats : {};
  const tk = stats.tokens || {};
  const call = {
    id: crypto.randomUUID().slice(0, 8),
    agentId: agent?.id || null,
    agentName: String(input.agentName || agent?.name || "").slice(0, 40),
    startedAt: toDate(input.startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    duration: String(input.duration || "00:00").slice(0, 12),
    endedBy: String(input.endedBy || "user").slice(0, 40),
    playbook: input.playbook ? { name: String(input.playbook.name).slice(0, 60), icon: String(input.playbook.icon || "").slice(0, 8), type: String(input.playbook.type || "").slice(0, 30) } : null,
    language: String(input.language || "").slice(0, 40),
    voice: String(input.voice || "").slice(0, 20),
    stats,
    summary: String(input.summary || "").slice(0, 8000),
    transcript: Array.isArray(input.transcript) ? input.transcript.slice(0, 300) : [],
    recording: null,
  };
  const avg = stats.avgResponseMs ?? (parseFloat(stats.avgResponse) * 1000 || null);
  await tx(async (t) => {
    await t.exec(
      `INSERT INTO calls (id, user_id, agent_id, agent_name, started_at, ended_at, duration, duration_seconds, ended_by, playbook, language, voice,
                          turns, tokens_input, tokens_output, tokens_total, avg_response_ms, stats, transcript)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [call.id, userId, call.agentId, call.agentName, new Date(call.startedAt), new Date(call.endedAt), call.duration, toSeconds(call.duration),
        call.endedBy, call.playbook ? JSON.stringify(call.playbook) : null, call.language, call.voice,
        num(stats.turns), num(tk.input), num(tk.output), num(tk.total), avg == null ? null : num(avg),
        JSON.stringify(stats), JSON.stringify(call.transcript)],
    );
    await t.exec("INSERT INTO call_summaries (call_id, summary, full_text) VALUES (?, ?, ?)", [call.id, call.summary, summaryText(call)]);
  });
  return call;
}

// The permanent, human-readable summary for one call (the ⬇ .txt download).
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
    `Agent: ${c.agentName || "?"}`,
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

export async function readSummaryFile(id, userId = currentDataUserId()) {
  const r = await one("SELECT s.full_text FROM call_summaries s JOIN calls c ON c.id = s.call_id WHERE c.id = ? AND c.user_id = ?", [String(id).slice(0, 16), userId]);
  if (r) return r.full_text;
  const call = await getCall(id, userId);
  return call ? summaryText(call) : null;
}

export async function callStats(userId = currentDataUserId()) {
  const r = await one(
    `SELECT COUNT(*) AS calls, COALESCE(SUM(duration_seconds),0) AS totalSeconds, COALESCE(SUM(tokens_input),0) AS ti,
            COALESCE(SUM(tokens_output),0) AS tout, COALESCE(SUM(tokens_total),0) AS tt, AVG(avg_response_ms) AS avgMs,
            COALESCE(SUM(recording_file IS NOT NULL),0) AS recordings, COALESCE(SUM(turns),0) AS turns
       FROM calls WHERE user_id = ?`, [userId]);
  return {
    calls: Number(r.calls), totalSeconds: Number(r.totalSeconds),
    tokens: { input: Number(r.ti), output: Number(r.tout), total: Number(r.tt) },
    avgResponseMs: r.avgMs == null ? null : Math.round(Number(r.avgMs)),
    recordings: Number(r.recordings), turns: Number(r.turns),
  };
}

export async function saveRecording(id, contentType, buffer, userId = currentDataUserId()) {
  const call = await getCall(id, userId);
  if (!call) return null;
  const type = (contentType || "audio/webm").split(";")[0];
  const file = `${id}.${REC_TYPES[type] || "webm"}`;
  await fs.mkdir(REC_DIR(userId), { recursive: true });
  await fs.writeFile(path.join(REC_DIR(userId), file), buffer);
  await exec("UPDATE calls SET recording_file = ?, recording_type = ?, recording_bytes = ? WHERE id = ?", [file, type, buffer.length, id]);
  return { file, type, bytes: buffer.length };
}

export async function readRecording(id, userId = currentDataUserId()) {
  const call = await getCall(id, userId);
  if (!call?.recording) return null;
  return { ...call.recording, data: await fs.readFile(path.join(REC_DIR(userId), call.recording.file)) };
}

export async function deleteCall(id, userId = currentDataUserId()) {
  const call = await getCall(id, userId);
  if (!call) return null;
  if (call.recording) await fs.rm(path.join(REC_DIR(userId), call.recording.file), { force: true });
  await exec("DELETE FROM calls WHERE id = ? AND user_id = ?", [id, userId]); // summary row goes with it
  return call;
}
