// One-time import of the old JSON storage (data/users.json, data/sessions.json, data/users/<id>/*.json) into MySQL.
// Runs at start-up only when the users table is empty and data/users.json exists. Before removing the JSON files it
// copies the whole data/ folder to backups/pre-mysql-<date>/. Recordings stay where they are (data/users/<id>/recordings).
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { tx, one, toDate } from "./db.js";
import { DATA_DIR } from "./context.js";

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
};
const toSeconds = (d) => String(d || "0:0").split(":").reduce((acc, n) => acc * 60 + (Number(n) || 0), 0);
const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

export async function importJsonData() {
  const usersFile = path.join(DATA_DIR, "users.json");
  if (!fsSync.existsSync(usersFile)) return null;
  if ((await one("SELECT COUNT(*) AS n FROM users")).n) return null;
  const users = await readJson(usersFile, []);
  const sessions = await readJson(path.join(DATA_DIR, "sessions.json"), {});
  const report = { users: 0, agents: 0, playbooks: 0, calls: 0, events: 0, sessions: 0 };

  await tx(async (t) => {
    for (const u of users) {
      await t.exec(
        `INSERT INTO users (id, username, name, role_id, password_hash, must_change_password, disabled, signup_source, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'import', ?, ?)`,
        [u.id, u.username, u.name || u.username, u.role === 1 ? 1 : 2, u.passwordHash, u.mustChangePassword ? 1 : 0, u.disabled ? 1 : 0,
          toDate(u.createdAt), u.lastLoginAt ? toDate(u.lastLoginAt) : null],
      );
      report.users++;
      const dir = path.join(DATA_DIR, "users", u.id);
      const s = await readJson(path.join(dir, "settings.json"), {});
      const playbooks = await readJson(path.join(dir, "playbooks.json"), []);
      for (const p of playbooks) {
        await t.exec(
          "INSERT INTO playbooks (id, user_id, agent_type, name, role, goal, steps, rules, summary_focus, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [p.id, u.id, p.type || "other", p.name, p.role || "", p.goal || "", JSON.stringify(p.steps || []), JSON.stringify(p.rules || []), p.summary || "", toDate(p.createdAt)],
        );
        report.playbooks++;
      }
      // Their one agent setup becomes their first (default) agent.
      const agentId = u.id.slice(0, 4) + Math.random().toString(16).slice(2, 6);
      const pbId = s.agent?.defaultPlaybookId && playbooks.some((p) => p.id === s.agent.defaultPlaybookId) ? s.agent.defaultPlaybookId : null;
      await t.exec(
        `INSERT INTO agents (id, user_id, name, agent_type, language, voice, chat_model, tts_model, stt_engine, stt_model, playbook_id,
                             calendar_enabled, emergency_enabled, is_default)
         VALUES (?, ?, ?, 'personal', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [agentId, u.id, String(s.agent?.defaultName || "Aria").slice(0, 24), s.agent?.defaultLanguage || "en-US", s.agent?.defaultVoice || "marin",
          s.models?.chat || null, s.models?.tts || null, s.speechToText?.engine || null, s.speechToText?.model || null, pbId,
          s.calendar?.enabled ? 1 : 0, s.emergency?.enabled ? 1 : 0],
      );
      for (const [i, r] of (s.emergency?.rules || []).entries()) {
        await t.exec("INSERT INTO emergency_rules (agent_id, label, number, keywords, sort_order) VALUES (?, ?, ?, ?, ?)",
          [agentId, r.label, r.number, JSON.stringify(r.keywords || []), i]);
      }
      report.agents++;
      for (const c of await readJson(path.join(dir, "calls.json"), [])) {
        const st = c.stats || {};
        const tk = st.tokens || {};
        const avg = st.avgResponseMs ?? (parseFloat(st.avgResponse) * 1000 || null);
        await t.exec(
          `INSERT INTO calls (id, user_id, agent_id, agent_name, started_at, ended_at, duration, duration_seconds, ended_by, playbook, language, voice,
                              turns, tokens_input, tokens_output, tokens_total, avg_response_ms, stats, transcript, recording_file, recording_type, recording_bytes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [c.id, u.id, agentId, String(s.agent?.defaultName || "").slice(0, 40), toDate(c.startedAt), toDate(c.endedAt || c.startedAt), c.duration || "00:00",
            toSeconds(c.duration), c.endedBy || "user", c.playbook ? JSON.stringify(c.playbook) : null, c.language || "", c.voice || "",
            num(st.turns), num(tk.input), num(tk.output), num(tk.total), avg == null ? null : num(avg), JSON.stringify(st),
            JSON.stringify(c.transcript || []), c.recording?.file || null, c.recording?.type || null, c.recording?.bytes || null],
        );
        const fullText = await fs.readFile(path.join(dir, "summaries", `${c.id}.txt`), "utf8").catch(() => c.summary || "");
        await t.exec("INSERT INTO call_summaries (call_id, summary, full_text) VALUES (?, ?, ?)", [c.id, c.summary || "", fullText]);
        report.calls++;
      }
      for (const e of await readJson(path.join(dir, "calendar.json"), [])) {
        await t.exec(
          "INSERT INTO calendar_events (id, user_id, agent_id, title, start_at, duration_min, notes, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [e.id, u.id, agentId, e.title, toDate(e.start), e.durationMin || 30, e.notes || "", e.source || "agent", toDate(e.createdAt)],
        );
        report.events++;
      }
    }
    for (const [hash, s] of Object.entries(sessions)) {
      if (s.expires > Date.now() && users.some((u) => u.id === s.userId)) {
        await t.exec("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
          [hash, s.userId, new Date(s.created || Date.now()), new Date(s.expires)]);
        report.sessions++;
      }
    }
  });

  // Keep a full copy, then remove the JSON files that now live in MySQL (recordings stay).
  const backup = path.join(DATA_DIR, "..", "backups", `pre-mysql-${new Date().toISOString().slice(0, 10)}`, "data");
  await fs.cp(DATA_DIR, backup, { recursive: true, force: false, errorOnExist: false });
  await fs.rm(usersFile, { force: true });
  await fs.rm(path.join(DATA_DIR, "sessions.json"), { force: true });
  for (const u of users) {
    const dir = path.join(DATA_DIR, "users", u.id);
    for (const f of ["settings.json", "playbooks.json", "calls.json", "calendar.json"]) await fs.rm(path.join(dir, f), { force: true });
    await fs.rm(path.join(dir, "summaries"), { recursive: true, force: true });
  }
  report.backup = path.relative(path.join(DATA_DIR, ".."), backup);
  return report;
}
