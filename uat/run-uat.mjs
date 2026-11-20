#!/usr/bin/env node
// TelemuneSmartAi UAT: repeatable acceptance tests against a running backend (8324) and web app (8323).
// Each run creates its own tester accounts and agents (uat.*.<run>), tests every area through the real API,
// writes a report to uat/reports/, and deletes everything it created (unless --keep).
//
//   node uat/run-uat.mjs                 # run all free tests (no OpenAI cost, no WhatsApp/email sent)
//   node uat/run-uat.mjs --ai            # also one short greeting + TTS (costs a few OpenAI tokens)
//   node uat/run-uat.mjs --keep          # keep the tester accounts afterwards (prints their sign-ins once)
//   node uat/run-uat.mjs --cleanup <run> # remove the testers a --keep run left (<run> from their names, or "all" for every uat.* account)
//   UAT_SUPER_USER=… UAT_SUPER_PASS=… node uat/run-uat.mjs   # also the SuperAdmin cases
//   UAT_BACKEND=http://host:8324 UAT_WEB=http://host:8323 node uat/run-uat.mjs
//
// Needs: Node 22+, the `mysql` command-line client, and voice_ai_backend/.env (MySQL settings, read locally, never printed).
// Run it from the server that runs the backend. It never changes other people's data; the one shared setting it touches
// (the site theme) is put back at once.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = new Set(process.argv.slice(2));
const BACKEND = (process.env.UAT_BACKEND || "http://127.0.0.1:8324").replace(/\/$/, "");
const WEB = (process.env.UAT_WEB || "http://127.0.0.1:8323").replace(/\/$/, "");
const RUN = new Date().toISOString().slice(0, 16).replace(/\D/g, "").slice(4) + randomBytes(2).toString("hex"); // MMDDhhmm + 4 hex
const PASS = process.env.UAT_PASSWORD || `Uat-${randomBytes(6).toString("hex")}-9!`;

// ---------- MySQL (only for setup the API can't do: making a tester an admin, checks, clean-up) ----------
function readEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const ENV = readEnv(join(ROOT, "voice_ai_backend/.env"));
function sql(q) {
  const args = ["-h", ENV.MYSQL_HOST || "127.0.0.1", "-P", ENV.MYSQL_PORT || "3306", "-u", ENV.MYSQL_USER || "root", "-N", "-B", ENV.MYSQL_DATABASE || "ai-agent", "-e", q];
  return execFileSync("mysql", args, { env: { ...process.env, MYSQL_PWD: ENV.MYSQL_PASSWORD || "" }, encoding: "utf8" }).trim();
}
const lit = (s) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

// ---------- HTTP with a cookie per tester ----------
class Session {
  constructor(name) { this.name = name; this.cookie = ""; }
  async req(method, path, body, headers = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let payload;
    if (body instanceof Uint8Array) { payload = body; h["content-type"] ||= "application/octet-stream"; }
    else if (body !== undefined) { payload = JSON.stringify(body); h["content-type"] = "application/json"; }
    const base = path.startsWith("http") ? "" : BACKEND;
    const r = await fetch(base + path, { method, headers: h, body: payload, redirect: "manual" });
    const set = r.headers.getSetCookie?.() || [];
    for (const c of set) {
      const m = /^tsa_session=([^;]*)/.exec(c);
      if (m) this.cookie = m[1] ? `tsa_session=${m[1]}` : "";
    }
    const type = r.headers.get("content-type") || "";
    const raw = Buffer.from(await r.arrayBuffer());
    let json = null;
    if (type.includes("json")) { try { json = JSON.parse(raw.toString("utf8")); } catch { /* not json */ } }
    return { status: r.status, json, text: type.includes("json") || type.startsWith("text") ? raw.toString("utf8") : "", raw, headers: r.headers };
  }
  get(p, h) { return this.req("GET", p, undefined, h); }
  post(p, b, h) { return this.req("POST", p, b ?? {}, h); }
  patch(p, b, h) { return this.req("PATCH", p, b, h); }
  put(p, b, h) { return this.req("PUT", p, b, h); }
  del(p, h) { return this.req("DELETE", p, undefined, h); }
}

// ---------- test runner ----------
const results = [];
let area = "";
const section = (a) => { area = a; console.log(`\n▸ ${a}`); };
class Skip extends Error {}
const skip = (why) => { throw new Skip(why); };
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
async function test(id, title, fn) {
  const t0 = Date.now();
  let status = "PASS", detail = "";
  try { detail = (await fn()) || ""; }
  catch (e) { if (e instanceof Skip) { status = "SKIP"; detail = e.message; } else { status = "FAIL"; detail = e.message; } }
  results.push({ id, area, title, status, detail: String(detail).slice(0, 220), ms: Date.now() - t0 });
  console.log(`  ${status === "PASS" ? "✓" : status === "SKIP" ? "–" : "✗"} ${id} ${title}${detail ? `  (${String(detail).slice(0, 120)})` : ""}`);
}

const created = { users: new Set(), names: new Set() };
const S = {}; // sessions
const D = {}; // ids
const iso = (daysAgo, hour = 10) => { const d = new Date(Date.now() - daysAgo * 864e5); d.setUTCHours(hour, 5, 0, 0); return d.toISOString(); };
const userId = (u) => sql(`SELECT id FROM users WHERE username = ${lit(u)} AND deleted_at IS NULL`);

async function signup(key, label) {
  const username = `uat.${key}.${RUN}`;
  const s = new Session(label);
  const r = await s.post("/api/signup", { name: label, username, password: PASS, confirm: PASS });
  if (r.status !== 200 && r.status !== 201) throw new Error(`sign-up of ${username} failed: ${r.status} ${r.text.slice(0, 120)}`);
  created.names.add(username); created.users.add(r.json.user.id);
  return { s, username, id: r.json.user.id };
}

async function main() {
  console.log(`TelemuneSmartAi UAT · run ${RUN} · backend ${BACKEND} · web ${WEB}`);
  const health = await fetch(BACKEND + "/api/health").then((r) => r.ok).catch(() => false);
  if (!health) { console.error("✗ The backend isn't answering at " + BACKEND + "/api/health. Start it first."); process.exit(2); }
  try { sql("SELECT 1"); } catch (e) { console.error("✗ Can't reach MySQL with the `mysql` client and voice_ai_backend/.env: " + e.message.split("\n")[0]); process.exit(2); }
  const themeBefore = sql("SELECT value FROM app_config WHERE section = 'branding'");

  // =====================================================================
  section("1. Public pages and sign-in");
  await test("AUTH-01", "Health check answers without signing in", async () => {
    const r = await new Session().get("/api/health"); eq(r.status, 200, "status"); ok(r.json?.ok === true, "ok flag missing");
  });
  await test("AUTH-02", "Sign-in options are public and include the site theme", async () => {
    const r = await new Session().get("/api/auth-options"); eq(r.status, 200, "status");
    ok("allowSignup" in r.json && r.json.theme && "name" in r.json.theme, "allowSignup/theme missing");
    return `theme ${r.json.theme.name}, sign-up ${r.json.allowSignup ? "open" : "closed"}`;
  });
  await test("AUTH-03", "Signed-out API calls get 401", async () => {
    for (const p of ["/api/me", "/api/agents", "/api/dashboard", "/api/calls", "/api/admin/overview"]) eq((await new Session().get(p)).status, 401, p);
  });
  await test("AUTH-04", "Self sign-up creates a user (role 2) and signs in", async () => {
    const u = await signup("user", "UAT User");
    Object.assign(S, { user: u.s }); Object.assign(D, { userName: u.username, userId: u.id });
    const me = await u.s.get("/api/me"); eq(me.status, 200, "me"); eq(me.json.user.role, 2, "role"); ok(me.json.access?.app, "access missing");
  });
  await test("AUTH-05", "New accounts start with no agents", async () => {
    const r = await S.user.get("/api/agents"); eq(r.status, 200, "status"); eq(r.json.agents.length, 0, "agents");
  });
  await test("AUTH-06", "Wrong password is refused", async () => {
    const r = await new Session().post("/api/login", { username: D.userName, password: "wrong-" + PASS });
    ok(r.status >= 400 && r.status < 500, "expected 4xx, got " + r.status);
  });
  await test("AUTH-07", "Correct password signs in", async () => {
    const s = new Session(); const r = await s.post("/api/login", { username: D.userName, password: PASS });
    eq(r.status, 200, "status"); ok(s.cookie, "no session cookie");
  });
  await test("AUTH-08", "5 wrong passwords lock the account for a while", async () => {
    const u = await signup("lock", "UAT Lock");
    const s = new Session();
    for (let i = 0; i < 5; i++) await s.post("/api/login", { username: u.username, password: "nope-" + i });
    const r = await s.post("/api/login", { username: u.username, password: PASS });
    ok(r.status >= 400, "the right password still worked after 5 failures");
    return r.json?.error || "";
  });
  await test("AUTH-09", "A change from another site (Origin) is blocked", async () => {
    const r = await S.user.post("/api/agents", { name: "X", type: "personal" }, { origin: "http://evil.example" });
    eq(r.status, 403, "status");
  });

  // =====================================================================
  section("2. Agents and Agent studio");
  await test("AGT-01", "Agent types and templates are listed", async () => {
    const r = await S.user.get("/api/templates"); eq(r.status, 200, "status");
    const n = Object.keys(r.json.types || {}).length; ok(n >= 5, "only " + n + " types");
    D.types = Object.keys(r.json.types); return `${n} types`;
  });
  await test("AGT-02", "Create a Call Assistant agent that works for someone", async () => {
    const r = await S.user.post("/api/agents", { name: "UAT Brown", type: "secretary", ownerName: "DJ", organization: "Telemune" });
    ok(r.status === 200 || r.status === 201, "status " + r.status + " " + r.text.slice(0, 100)); D.brown = r.json.id || r.json.agent?.id; ok(D.brown, "no id");
  });
  await test("AGT-03", "Create a Support agent and an Appointment agent", async () => {
    const a = await S.user.post("/api/agents", { name: "UAT Riya", type: "support" });
    const b = await S.user.post("/api/agents", { name: "UAT Max", type: D.types.includes("appointment") ? "appointment" : "personal" });
    D.riya = a.json?.id; D.max = b.json?.id; ok(D.riya && D.max, `create failed ${a.status}/${b.status}`);
  });
  await test("AGT-04", "The agent list has all three", async () => {
    const r = await S.user.get("/api/agents"); eq(r.json.agents.length, 3, "agents");
  });
  await test("AGT-05", "Make an agent the default", async () => {
    const r = await S.user.patch(`/api/agents/${D.riya}`, { isDefault: true }); eq(r.status, 200, "status");
    eq(sql(`SELECT is_default FROM agents WHERE id = ${lit(D.riya)}`), "1", "is_default");
  });
  await test("AGT-06", "Auto-save the profile, availability and calendar (POST /api/settings)", async () => {
    const r = await S.user.post("/api/settings", {
      persona: { ownerName: "Dhananjay", organization: "Telemune", availability: "Mon–Fri 10:00–18:00", greeting: "Hello, this is {agent}, {owner}'s assistant." },
      calendar: { enabled: true }, agent: { speechSpeed: 1.2 },
    }, { "x-agent-id": D.brown });
    eq(r.status, 200, "status");
    const row = sql(`SELECT owner_name, organization, calendar_enabled, speech_speed FROM agents WHERE id = ${lit(D.brown)}`).split("\t");
    eq(row[0], "Dhananjay", "owner"); eq(row[2], "1", "calendar"); ok(Math.abs(Number(row[3]) - 1.2) < 0.01, "speed " + row[3]);
  });
  await test("AGT-07", "A user can't pick AI models (they go back to the defaults)", async () => {
    await S.user.post("/api/settings", { models: { chat: "gpt-4o", tts: "tts-1" } }, { "x-agent-id": D.brown });
    eq(sql(`SELECT COALESCE(chat_model, '') FROM agents WHERE id = ${lit(D.brown)}`), "", "chat_model");
  });
  await test("AGT-08", "Changing the agent type resets its profile", async () => {
    const r = await S.user.patch(`/api/agents/${D.max}`, { type: "support" }); eq(r.status, 200, "status " + r.text.slice(0, 80));
    eq(sql(`SELECT agent_type FROM agents WHERE id = ${lit(D.max)}`), "support", "type");
  });
  await test("AGT-09", "The page config has voices, languages, providers and country codes", async () => {
    const r = await S.user.get("/api/config", { "x-agent-id": D.brown }); eq(r.status, 200, "status");
    ok(r.json.voices && r.json.languages && r.json.providers && r.json.countryCodes?.length, "missing parts");
    eq(r.json.settings?.currentAgent?.id, D.brown, "X-Agent-Id agent");
  });

  // =====================================================================
  section("3. Tools: playbooks, calendar, emergency, messages");
  await test("TOOL-01", "Add, list and delete a playbook", async () => {
    const t = await S.user.get("/api/playbooks"); const type = Object.keys(t.json.types)[0];
    const a = await S.user.post("/api/playbooks", { type, name: "UAT script", goal: "Book a meeting", steps: ["Greet", "Ask the time"], rules: ["Be short"] });
    eq(a.status, 201, "add"); D.pb = a.json.id;
    ok((await S.user.get("/api/playbooks")).json.saved.some((p) => p.id === D.pb), "not listed");
  });
  await test("TOOL-02", "Put the playbook on an agent", async () => {
    const r = await S.user.post("/api/settings", { agent: { defaultPlaybookId: D.pb } }, { "x-agent-id": D.brown }); eq(r.status, 200, "status");
    eq(sql(`SELECT COALESCE(playbook_id, '') FROM agents WHERE id = ${lit(D.brown)}`), D.pb, "playbook_id");
  });
  await test("TOOL-03", "Book a calendar event (calendar on) and export it", async () => {
    const start = new Date(Date.now() + 2 * 864e5).toISOString();
    const r = await S.user.post("/api/calendar", { title: "UAT meeting", start, durationMin: 30, source: "uat" }, { "x-agent-id": D.brown });
    eq(r.status, 201, "add " + r.text.slice(0, 80)); D.event = r.json.id;
    const ics = await S.user.get("/api/calendar/calendar.ics"); ok(ics.text.includes("BEGIN:VCALENDAR") && ics.text.includes("UAT meeting"), "ics");
  });
  await test("TOOL-04", "Calendar off refuses new events", async () => {
    eq((await S.user.post("/api/settings", { calendar: { enabled: false } }, { "x-agent-id": D.riya })).status, 200, "switch off");
    const r = await S.user.post("/api/calendar", { title: "nope", start: new Date(Date.now() + 864e5).toISOString(), durationMin: 15 }, { "x-agent-id": D.riya });
    eq(r.status, 403, "status");
  });
  await test("TOOL-05", "Emergency contacts save with keywords", async () => {
    const r = await S.user.post("/api/settings", { emergency: { enabled: true, rules: [{ label: "Doctor", type: "phone", number: "+91 90000 00000", keywords: ["chest pain", "accident"] }] } }, { "x-agent-id": D.brown });
    eq(r.status, 200, "status");
    ok(Number(sql(`SELECT COUNT(*) FROM emergency_rules WHERE agent_id = ${lit(D.brown)}`)) >= 1, "no rule stored");
  });
  await test("TOOL-06", "A caller's message: add, list, mark done, delete", async () => {
    const a = await S.user.post("/api/messages", { callerName: "UAT Caller", callerNumber: "+91 90000 00001", urgency: "urgent", message: "Please call back" }, { "x-agent-id": D.brown });
    eq(a.status, 201, "add"); D.msg = a.json.id;
    ok((await S.user.get("/api/messages?scope=all")).json.items?.some((m) => m.id === D.msg) ?? true, "not listed");
    eq((await S.user.patch(`/api/messages/${D.msg}`, { status: "done" })).json.status, "done", "status");
  });

  // =====================================================================
  section("4. Conversations and call summaries (every channel)");
  const seed = [
    ["call", 0, 9, "caller said goodbye", ["book a meeting"]], ["call", 1, 11, "user", ["billing question"]], ["chat", 2, 15, "live chat", ["billing question"]],
    ["voice", 3, 10, "voice chat", ["leave a message"]], ["call", 12, 16, "caller said goodbye", ["book a meeting", "end call"]], ["call", 40, 10, "user", ["plan upgrade"]],
  ];
  await test("CALL-01", "Save conversations on every channel (call, live chat, voice chat)", async () => {
    D.calls = [];
    for (const [ch, ago, hour, endedBy, intents] of seed) {
      const r = await S.user.post("/api/calls", { startedAt: iso(ago, hour), duration: "02:00", endedBy, channel: ch, agentName: "UAT Brown", language: "English", voice: "marin",
        stats: { turns: 4, avgResponseMs: 3200, intents, tokens: { input: 600, output: 200, total: 800 } }, summary: "Summary: UAT test.\nOutcome: done", transcript: [{ role: "caller", text: "hi" }] },
        { "x-agent-id": D.brown });
      eq(r.status, 201, "save " + ch); D.calls.push(r.json.id);
    }
    return `${D.calls.length} saved`;
  });
  await test("CALL-02", "Call summaries filter by channel", async () => {
    const r = await S.user.get("/api/calls?channel=chat&pageSize=50"); eq(r.status, 200, "status");
    ok(r.json.items.length >= 1 && r.json.items.every((c) => c.channel === "chat"), "chat filter");
  });
  await test("CALL-03", "Totals per channel add up", async () => {
    const r = await S.user.get("/api/calls/stats"); eq(r.json.calls, seed.length, "calls");
    eq(r.json.byChannel.call, 4, "call"); eq(r.json.byChannel.chat, 1, "chat"); eq(r.json.byChannel.voice, 1, "voice");
  });
  await test("CALL-04", "Open one conversation with its summary and transcript", async () => {
    const r = await S.user.get(`/api/calls/${D.calls[0]}`); eq(r.status, 200, "status"); ok(r.json.summary && r.json.transcript, "parts missing");
  });
  await test("CALL-05", "Store and play back a recording", async () => {
    const bytes = new Uint8Array([26, 69, 223, 163, 1, 2, 3, 4, 5]);
    const p = await S.user.put(`/api/calls/${D.calls[0]}/recording`, bytes, { "content-type": "audio/webm" }); eq(p.status, 200, "upload " + p.text.slice(0, 80));
    const g = await S.user.get(`/api/calls/${D.calls[0]}/recording`); eq(g.status, 200, "download"); eq(g.raw.length, bytes.length, "size");
  });
  await test("CALL-06", "Delete a conversation", async () => {
    const id = D.calls.pop(); eq((await S.user.del(`/api/calls/${id}`)).status, 200, "delete"); eq((await S.user.get(`/api/calls/${id}`)).status, 404, "still there");
  });

  // =====================================================================
  section("5. 📊 Insights (dashboard)");
  await test("DASH-01", "30 days: totals, previous period, channels, heat, intents", async () => {
    const r = await S.user.get("/api/dashboard?days=30&agent=all&tz=330"); eq(r.status, 200, "status " + r.text.slice(0, 80));
    const d = r.json; eq(d.days, 30, "days"); eq(d.totals.conversations, 5, "conversations in 30 days"); eq(d.daily.length, 30, "daily rows");
    eq(d.heat.length, 7, "heat rows"); eq(d.heat.flat().reduce((a, b) => a + b, 0), 5, "heat total");
    ok(d.intents.length && !d.intents.some((i) => i.label === "end call"), "intents (and no 'end call')");
    ok(d.agents.length === 3 && d.upcoming.some((e) => e.title === "UAT meeting"), "agents/upcoming");
    return `top intent "${d.intents[0].label}" ×${d.intents[0].count}`;
  });
  await test("DASH-02", "7 days and 90 days change the numbers", async () => {
    const a = (await S.user.get("/api/dashboard?days=7&tz=330")).json, b = (await S.user.get("/api/dashboard?days=90&tz=330")).json;
    eq(a.totals.conversations, 4, "7 days"); eq(b.totals.conversations, 6 - 1, "90 days (one was deleted)");
  });
  await test("DASH-03", "One agent only", async () => {
    const r = await S.user.get(`/api/dashboard?days=30&agent=${D.riya}&tz=330`); eq(r.status, 200, "status");
    eq(r.json.totals.conversations, 0, "Riya had none"); eq(r.json.agents.length, 1, "one agent row");
  });
  await test("DASH-04", "Someone else's agent id is refused", async () => {
    eq((await S.user.get("/api/dashboard?agent=nope1234")).status, 404, "status");
  });

  // =====================================================================
  section("6. Privacy between accounts");
  await test("PRIV-01", "Another user can't open my conversation", async () => {
    const other = await signup("other", "UAT Other"); S.other = other.s; D.otherId = other.id;
    eq((await S.other.get(`/api/calls/${D.calls[0]}`)).status, 404, "status");
  });
  await test("PRIV-02", "Another user's X-Agent-Id doesn't give my agent", async () => {
    await S.other.post("/api/agents", { name: "UAT Own", type: "personal" });
    const r = await S.other.get("/api/config", { "x-agent-id": D.brown }); ok(r.json.settings?.currentAgent?.id !== D.brown, "got someone else's agent");
  });
  await test("PRIV-03", "A user can't use the admin API", async () => {
    eq((await S.user.get("/api/admin/overview")).status, 403, "status");
  });

  // =====================================================================
  section("7. Admin dashboard");
  await test("ADM-01", "Make a tester admin (role 1) and sign in", async () => {
    const a = await signup("admin", "UAT Admin"); S.admin = a.s; D.adminId = a.id; D.adminName = a.username;
    sql(`UPDATE users SET role_id = 1 WHERE id = ${lit(a.id)}`);
    eq((await S.admin.get("/api/me")).json.user.role, 1, "role");
  });
  await test("ADM-02", "Overview lists the users, never the SuperAdmin", async () => {
    const r = await S.admin.get("/api/admin/overview"); eq(r.status, 200, "status");
    ok(r.json.users.some((u) => u.id === D.userId), "tester missing"); ok(!r.json.users.some((u) => u.role === 0), "SuperAdmin visible");
    return `${r.json.users.length} users seen`;
  });
  await test("ADM-03", "Open one user's details (👁 View)", async () => {
    const r = await S.admin.get(`/api/admin/users/${D.userId}`); eq(r.status, 200, "status"); eq(r.json.agents.length, 3, "agents");
  });
  await test("ADM-04", "Read a user's data read-only (?as=)", async () => {
    const r = await S.admin.get(`/api/calls/stats?as=${D.userId}`); eq(r.json.calls, 5, "their calls");
  });
  await test("ADM-05", "Limit the admin to 2 agent types, then it creates a user", async () => {
    sql(`UPDATE users SET permissions = ${lit(JSON.stringify({ agentTypes: ["secretary", "support"], playbookTypes: null }))} WHERE id = ${lit(D.adminId)}`);
    const r = await S.admin.post("/api/admin/users", { name: "UAT Made", username: `uat.made.${RUN}`, password: PASS, role: 2,
      permissions: { agentTypes: ["secretary", "support", "hospital"], app: {} } });
    eq(r.status, 201, "create " + r.text.slice(0, 100)); D.madeId = r.json.id; created.users.add(D.madeId); created.names.add(`uat.made.${RUN}`);
  });
  await test("ADM-06", "The new user never gets more types than the admin", async () => {
    const s = new Session(); await s.post("/api/login", { username: `uat.made.${RUN}`, password: PASS }); S.made = s;
    const types = Object.keys((await s.get("/api/agents")).json.types);
    ok(!types.includes("hospital") && types.length <= 2, "types: " + types.join(","));
    eq((await s.post("/api/agents", { name: "X", type: "hospital" })).status, 403, "hospital agent");
    return types.join(", ");
  });
  await test("ADM-07", "An admin can't create admins or change roles", async () => {
    const r = await S.admin.post("/api/admin/users", { name: "x", username: `uat.x.${RUN}`, password: PASS, role: 1 }); eq(r.status, 403, "create admin");
    eq((await S.admin.patch(`/api/admin/users/${D.madeId}`, { role: 1 })).status, 403, "change role");
  });
  await test("ADM-08", "Switch 📊 Insights off for a user: the server refuses it", async () => {
    eq((await S.admin.patch(`/api/admin/users/${D.madeId}`, { permissions: { app: { dashboard: false } } })).status, 200, "patch");
    eq((await S.made.get("/api/dashboard")).status, 403, "dashboard");
    eq((await S.made.get("/api/me")).json.access.app.dashboard, false, "access flag");
  });
  await test("ADM-09", "Activity log: user activity, sign-ins, admin changes", async () => {
    for (const k of ["user", "auth", "admin"]) eq((await S.admin.get(`/api/admin/logs?kind=${k}`)).status, 200, k);
    const u = await S.admin.get(`/api/admin/logs?kind=user&user=${D.userId}`); ok(u.json.items.some((i) => i.action === "call.save"), "call.save missing");
    eq((await S.admin.get("/api/admin/logins")).status, 200, "logins");
  });
  await test("ADM-10", "The SuperAdmin can't be found by an admin", async () => {
    const sup = sql("SELECT id FROM users WHERE role_id = 0 AND deleted_at IS NULL LIMIT 1");
    if (!sup) skip("no SuperAdmin on this server");
    eq((await S.admin.get(`/api/admin/users/${sup}`)).status, 404, "GET"); eq((await S.admin.patch(`/api/admin/users/${sup}`, { name: "x" })).status, 404, "PATCH");
    eq((await S.admin.get("/api/super/server-config")).status, 404, "super API");
    const lr = await S.admin.get("/api/admin/logs?kind=all"); eq(lr.status, 200, "activity log " + lr.text.slice(0, 120));
    ok(!(lr.json.items || []).some((l) => l.userId === sup), "SuperAdmin in activity");
  });
  await test("ADM-11", "Site theme: change it, the public options follow, put it back", async () => {
    const cfg = (await S.admin.get("/api/admin/config")).json.config.branding;
    const was = cfg.theme?.name || "violet", to = was === "rose" ? "ocean" : "rose";
    eq((await S.admin.put("/api/admin/config/branding", { ...cfg, theme: { ...cfg.theme, name: to } })).status, 200, "save");
    await new Promise((r) => setTimeout(r, 3200)); // config cache is 3 s
    const seen = (await new Session().get("/api/auth-options")).json.theme.name;
    await S.admin.put("/api/admin/config/branding", cfg);
    eq(seen, to, "theme"); return `${was} → ${to} → ${was}`;
  });
  await test("ADM-12", "Limit the admin's sections: others are refused", async () => {
    sql(`UPDATE users SET permissions = ${lit(JSON.stringify({ admin: ["overview", "users"] }))} WHERE id = ${lit(D.adminId)}`);
    eq((await S.admin.get("/api/admin/overview")).status, 200, "overview");
    eq((await S.admin.get("/api/admin/logs")).status, 403, "activity"); eq((await S.admin.get("/api/admin/config")).status, 403, "settings");
  });
  await test("ADM-13", "Delete a user: it can't sign in any more", async () => {
    eq((await S.admin.del(`/api/admin/users/${D.madeId}`)).status, 200, "delete");
    eq((await new Session().post("/api/login", { username: `uat.made.${RUN}`, password: PASS })).status >= 400, true, "still signs in");
  });

  // =====================================================================
  section("8. SuperAdmin (only with UAT_SUPER_USER / UAT_SUPER_PASS)");
  await test("SUP-01", "Server settings show, with secrets masked", async () => {
    if (!process.env.UAT_SUPER_USER) skip("no SuperAdmin sign-in given");
    const s = new Session(); const l = await s.post("/api/login", { username: process.env.UAT_SUPER_USER, password: process.env.UAT_SUPER_PASS });
    eq(l.status, 200, "sign-in"); S.super = s;
    const r = await s.get("/api/super/server-config"); eq(r.status, 200, "status");
    const secrets = r.json.files.flatMap((f) => f.entries).filter((e) => e.secret);
    ok(secrets.length && secrets.every((e) => !("value" in e)), "a secret value was sent");
    return `${secrets.length} secrets masked`;
  });
  await test("SUP-02", "The SuperAdmin sees the admins", async () => {
    if (!S.super) skip("no SuperAdmin sign-in given");
    const r = await S.super.get("/api/admin/overview"); ok(r.json.users.some((u) => u.id === D.adminId), "tester admin missing");
  });

  // =====================================================================
  section("9. Web app (pages, files, proxy)");
  await test("WEB-01", "Signed out, the main page goes to the login page", async () => {
    const r = await new Session().get(WEB + "/"); ok([301, 302, 303, 307].includes(r.status) && /login/.test(r.headers.get("location") || ""), `got ${r.status} ${r.headers.get("location")}`);
  });
  await test("WEB-02", "Login page and the shared scripts load", async () => {
    for (const p of ["/login.html", "/themes.js", "/motion.js", "/motion.css", "/dashboard.js", "/app.js", "/admin.js"]) eq((await new Session().get(WEB + p)).status, 200, p);
  });
  await test("WEB-03", "The API works through the web app (same origin)", async () => {
    const s = new Session(); s.cookie = S.user.cookie;
    eq((await s.get(WEB + "/api/me")).status, 200, "/api/me");
  });
  await test("WEB-04", "A user is sent away from the admin page", async () => {
    const s = new Session(); s.cookie = S.user.cookie; const r = await s.get(WEB + "/admin.html");
    ok(r.status >= 300 && r.status < 400, "status " + r.status);
  });
  await test("WEB-05", "An admin opens the admin page", async () => {
    sql(`UPDATE users SET permissions = NULL WHERE id = ${lit(D.adminId)}`);
    const s = new Session(); s.cookie = S.admin.cookie; eq((await s.get(WEB + "/admin.html")).status, 200, "status");
  });

  // =====================================================================
  section("10. AI (only with --ai; costs a few OpenAI tokens)");
  await test("AI-01", "Greeting text for an agent", async () => {
    if (!ARGS.has("--ai")) skip("run with --ai");
    const r = await S.user.post("/api/greeting", {}, { "x-agent-id": D.brown }); eq(r.status, 200, "status"); ok(r.json.text, "no text"); return r.json.text.slice(0, 60);
  });
  await test("AI-02", "Text to speech returns audio", async () => {
    if (!ARGS.has("--ai")) skip("run with --ai");
    const r = await S.user.post("/api/tts", { text: "Hello from the UAT.", voice: "marin" }, { "x-agent-id": D.brown });
    eq(r.status, 200, "status"); ok((r.headers.get("content-type") || "").includes("audio") && r.raw.length > 1000, "no audio");
  });

  // =====================================================================
  section("11. Account");
  await test("ACC-01", "Change my password: the old one stops working", async () => {
    const next = PASS + "x";
    eq((await S.user.post("/api/me/password", { current: PASS, next })).status, 200, "change");
    ok((await new Session().post("/api/login", { username: D.userName, password: PASS })).status >= 400, "old password works");
    eq((await new Session().post("/api/login", { username: D.userName, password: next })).status, 200, "new password");
  });
  await test("ACC-02", "Sign out ends the session", async () => {
    eq((await S.user.post("/api/logout")).status, 200, "logout"); eq((await S.user.get("/api/me")).status, 401, "me");
  });

  // put the theme back exactly as it was (in case a step failed half-way)
  if (sql("SELECT value FROM app_config WHERE section = 'branding'") !== themeBefore) sql(`UPDATE app_config SET value = ${lit(themeBefore)} WHERE section = 'branding'`);
}

function cleanup() {
  const ids = [...created.users];
  for (const n of created.names) { const id = sql(`SELECT id FROM users WHERE username = ${lit(n)} OR username LIKE ${lit(n + "~deleted-%")}`); if (id) id.split("\n").forEach((x) => ids.push(x)); }
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return 0;
  const list = uniq.map(lit).join(",");
  sql(`DELETE FROM activity_logs WHERE user_id IN (${list}); DELETE FROM api_logs WHERE user_id IN (${list}); DELETE FROM login_attempts WHERE username LIKE ${lit(`uat.%.${RUN}%`)};
       UPDATE app_config SET updated_by = NULL WHERE updated_by IN (${list}); DELETE FROM users WHERE id IN (${list});`);
  for (const id of uniq) { const dir = join(ROOT, "voice_ai_backend/data/users", id); if (/^[a-z0-9]{6,16}$/i.test(id) && existsSync(dir)) rmSync(dir, { recursive: true, force: true }); }
  return uniq.length;
}

function report() {
  const n = (s) => results.filter((r) => r.status === s).length;
  const lines = [`# TelemuneSmartAi UAT report`, ``, `Run **${RUN}** · ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC · backend ${BACKEND} · web ${WEB}`, ``,
    `**${n("PASS")} passed · ${n("FAIL")} failed · ${n("SKIP")} skipped** (of ${results.length})`, ``, `| ID | Area | Test | Result | Notes |`, `|---|---|---|---|---|`,
    ...results.map((r) => `| ${r.id} | ${r.area.replace(/^\d+\.\s*/, "")} | ${r.title} | ${r.status === "PASS" ? "✅ PASS" : r.status === "FAIL" ? "❌ FAIL" : "⏭ SKIP"} | ${r.detail.replace(/\|/g, "/")} |`)];
  mkdirSync(join(ROOT, "uat/reports"), { recursive: true });
  const file = join(ROOT, `uat/reports/UAT-${RUN}.md`);
  writeFileSync(file, lines.join("\n") + "\n");
  return { file, pass: n("PASS"), fail: n("FAIL"), skip: n("SKIP") };
}

// --cleanup <run|all>: remove testers a --keep run left behind, then stop
if (ARGS.has("--cleanup")) {
  const which = process.argv[process.argv.indexOf("--cleanup") + 1] || "";
  if (!/^(all|[0-9a-f]{8,16})$/.test(which)) { console.error("Give the run id (from the tester names, e.g. uat.user.<run>) or 'all'."); process.exit(2); }
  const pattern = which === "all" ? "uat.%" : `uat.%.${which}%`;
  const ids = sql(`SELECT id FROM users WHERE username LIKE ${lit(pattern)}`).split("\n").filter(Boolean);
  if (ids.length) {
    const list = ids.map(lit).join(",");
    sql(`DELETE FROM activity_logs WHERE user_id IN (${list}); DELETE FROM api_logs WHERE user_id IN (${list}); DELETE FROM login_attempts WHERE username LIKE ${lit(pattern)};
         UPDATE app_config SET updated_by = NULL WHERE updated_by IN (${list}); DELETE FROM users WHERE id IN (${list});`);
    for (const id of ids) { const dir = join(ROOT, "voice_ai_backend/data/users", id); if (/^[a-z0-9]{6,16}$/i.test(id) && existsSync(dir)) rmSync(dir, { recursive: true, force: true }); }
  }
  console.log(`Removed ${ids.length} tester account(s) matching ${pattern} and their data.`);
  process.exit(0);
}

let exit = 0;
try { await main(); }
catch (e) { console.error("\n✗ The run stopped: " + e.message); exit = 2; }
finally {
  const out = report();
  if (ARGS.has("--keep")) {
    console.log(`\nTester accounts kept (password, shown only here): ${PASS}`);
    for (const n of created.names) console.log("  " + n);
  } else {
    try { console.log(`\nCleaned up ${cleanup()} tester accounts and their data.`); } catch (e) { console.error("Clean-up failed: " + e.message); exit = exit || 2; }
  }
  console.log(`\n${out.pass} passed · ${out.fail} failed · ${out.skip} skipped → ${out.file.replace(ROOT + "/", "")}`);
  process.exit(exit || (out.fail ? 1 : 0));
}
