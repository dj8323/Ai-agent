// TelemuneSmartAi admin dashboard (role 1 only; the server refuses everyone else).
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const state = { me: null, users: [], viewing: null, callPage: 1, logPage: 1, loginPage: 1, config: null, types: {}, typeKey: null, draft: false };

const _fetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await _fetch(...args);
  if (res.status === 401) location.href = "/login.html";
  if (res.status === 403 && String(args[0]).startsWith("/api/admin/overview")) location.href = "/"; // not an admin any more
  return res;
};
async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- helpers ----------
const fmtS = (ms) => (ms == null ? "—" : (ms / 1000).toFixed(1) + "s");
const fmtDur = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(s).padStart(2, "0")}`;
};
const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "k" : Number(n || 0).toLocaleString());
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");
const LANG = { "en-US": "English (US)", "en-IN": "English (India)", "hi-IN": "Hindi", "bn-IN": "Bengali", "ta-IN": "Tamil", "te-IN": "Telugu", "mr-IN": "Marathi", "gu-IN": "Gujarati", "es-ES": "Spanish", "fr-FR": "French", "de-DE": "German", "pt-BR": "Portuguese", "ar-SA": "Arabic", "ja-JP": "Japanese", "zh-CN": "Mandarin", "en-JM": "Jamaican Patois" };
const EMOJI = { neutral: "🙂", happy: "😊", excited: "🤩", calm: "😌", angry: "😠", frustrated: "😤", sad: "😢", stressed: "😣", anxious: "😰", confused: "😕", grateful: "🙏", curious: "🤔", worried: "😟", satisfied: "😌" };
function toast(text) {
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
const genPassword = () => {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = crypto.getRandomValues(new Uint32Array(10));
  return [...a].map((n) => chars[n % chars.length]).join("");
};

// ---------- theme ----------
const theme = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
const paintTheme = () => ($("themeBtn").textContent = theme() === "dark" ? "☀️" : "🌙");
$("themeBtn").onclick = () => { const t = theme() === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = t; try { localStorage.setItem("va-theme", t); } catch {} paintTheme(); };
paintTheme();

// ---------- dialogs ----------
const openD = (id) => $(id).classList.add("open");
const closeD = (id) => $(id).classList.remove("open");
document.querySelectorAll(".overlay").forEach((o) => {
  o.addEventListener("click", (e) => { if (e.target === o || e.target.closest("[data-close]")) o.classList.remove("open"); });
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".overlay.open").forEach((o) => o.classList.remove("open")); });

// ---------- me / menu ----------
$("userBtn").onclick = (e) => { e.stopPropagation(); $("userDrop").hidden = !$("userDrop").hidden; $("userBtn").setAttribute("aria-expanded", String(!$("userDrop").hidden)); };
document.addEventListener("click", () => { $("userDrop").hidden = true; });
$("mOut").onclick = async () => { await fetch("/api/logout", { method: "POST" }); location.href = "/login.html"; };
$("mPw").onclick = () => { $("pwForm").reset(); $("pwErr").textContent = ""; openD("pwDialog"); setTimeout(() => $("pwCur").focus(), 30); };
$("pwForm").onsubmit = async (e) => {
  e.preventDefault();
  if ($("pwNew").value !== $("pwNew2").value) return ($("pwErr").textContent = "The new passwords don't match.");
  try {
    await api("/api/me/password", { method: "POST", body: JSON.stringify({ current: $("pwCur").value, next: $("pwNew").value }) });
    closeD("pwDialog"); $("pwBanner")?.remove(); toast("✓ Password changed");
  } catch (err) { $("pwErr").textContent = err.message; }
};

async function loadMe() {
  const { user, access } = await api("/api/me");
  state.me = user; state.access = access;
  document.body.classList.toggle("is-super", user.role === 0);
  $("restartBtn").hidden = user.role !== 0;
  if (!mySections().length) document.querySelector(".wrap").insertAdjacentHTML("beforeend", '<div class="card empty">No dashboard sections are open for your account. Ask your administrator.</div>');
  $("uAv").textContent = (user.name || user.username)[0].toUpperCase();
  $("uName").textContent = user.name || user.username;
  if (user.mustChangePassword) {
    const b = document.createElement("div");
    b.id = "pwBanner"; b.className = "note-banner"; b.setAttribute("role", "status");
    b.textContent = "🔐 You're using the default admin password. Please change it now.";
    const btn = document.createElement("button"); btn.type = "button"; btn.textContent = "Change password"; btn.onclick = $("mPw").onclick;
    b.appendChild(btn); document.body.prepend(b);
  }
}

// ---------- menu: one section at a time ----------
const VIEWS = ["overview", "users", "agents", "usage", "templates", "settings", "logins", "activity", "admins", "server"];
const isSuper = () => state.me?.role === 0;
// sections this account may open (the SuperAdmin decides them for each admin)
const mySections = () => (isSuper() ? VIEWS : (state.access?.admin || []));
function route() {
  const open = mySections();
  document.querySelectorAll("#adminNav a").forEach((a) => (a.hidden = !open.includes(a.dataset.view)));
  const want = location.hash.slice(1);
  const v = open.includes(want) ? want : open[0] || "overview";
  document.querySelectorAll(".view").forEach((el) => (el.hidden = el.dataset.view !== v));
  document.querySelectorAll("#adminNav a").forEach((a) => (a.dataset.view === v ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
addEventListener("hashchange", route);

// ---------- overview: totals in groups; every tile opens its user-by-user details ----------
const PROV = { openai: "OpenAI", elevenlabs: "ElevenLabs", aws: "AWS", cartesia: "Cartesia", browser: "Browser" };
const prov = (p) => PROV[p] || p || "—";
const who = (u) => `<div class="who"><div class="av">${esc((u.name || u.username)[0].toUpperCase())}</div><div>${esc(u.name)}<small>@${esc(u.username)}</small></div></div>`;
const byCh = (u, ch) => Number(u.stats.byChannel?.[ch] || 0);
const roleName = (u) => (u.role === 0 ? "🛡 SuperAdmin" : u.role === 1 ? "👑 Admin" : "👤 User");
const roleBadge = (u) => `<span class="badge ${u.role === 0 ? "super" : u.role === 1 ? "" : "user"}">${roleName(u)}</span>`;
const creator = (u) => {
  if (u.createdBy) { const c = state.users.find((x) => x.id === u.createdBy); return c ? `${esc(c.name)} <span class="muted">@${esc(c.username)}</span>` : '<span class="muted">a removed admin</span>'; }
  return `<span class="muted">${u.signupSource === "self" ? "✍️ self sign-up" : u.signupSource === "setup" ? "⚙️ setup" : "—"}</span>`;
};

async function loadOverview() {
  const { totals: t, users, api: apiNow, sections, features } = await api("/api/admin/overview");
  state.users = users; state.totals = t; state.sections = sections || []; state.features = features || [];
  const kpi = (key, k, v, sub) => `<button type="button" class="kpi" data-kpi="${key}"><span class="more">details ›</span><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></button>`;
  const group = (title, tiles) => `<section class="kgroup"><h3>${title}</h3><div class="kpis">${tiles.join("")}</div></section>`;
  $("kpis").innerHTML = [
    group("👥 People", [kpi("users", "👥 Users", t.users, `${t.active} active · ${t.admins} admin${t.admins === 1 ? "" : "s"}`), kpi("agents", "🤖 Agents", t.agents, `${(t.agents / Math.max(1, t.users)).toFixed(1)} per user`)]),
    group("📞 Conversations", [kpi("calls", "📞 Records", fmtNum(t.calls), `${fmtNum(t.turns)} turns`), kpi("time", "⏱ Talk time", fmtDur(t.seconds), t.calls ? `avg ${fmtDur(t.seconds / t.calls)}` : "—"),
      kpi("reply", "⚡ Avg reply", fmtS(t.avgResponseMs), "time to voice"), kpi("recordings", "🎙 Recordings", t.recordings, "saved")]),
    group("🔢 AI usage", [kpi("tokens", "🔢 Tokens", fmtNum(t.tokens), "chat + summaries")]),
    group("📚 Content", [kpi("playbooks", "📘 Playbooks", t.playbooks, "users' own scripts"), kpi("events", "📅 Events", t.events, "booked meetings"),
      kpi("messages", "📨 Messages", t.messages, "new, for the owner"), kpi("templates", "🧩 Templates", t.templates, "agent scripts")]),
  ].join("");
  $("kpis").querySelectorAll("[data-kpi]").forEach((b) => (b.onclick = () => openKpi(b.dataset.kpi)));
  const line = apiNow ? `API last 24h: ${fmtNum(apiNow.requests)} requests · ${apiNow.errors} errors · avg ${apiNow.avgMs ?? "—"} ms` : "";
  $("apiLine").textContent = line; $("apiLineU").textContent = line; $("apiLine2").textContent = line;
  // most active users (by records)
  const top = [...users].sort((a, b) => b.stats.calls - a.stats.calls).slice(0, 5);
  const max = Math.max(1, ...top.map((u) => u.stats.calls));
  $("topUsers").innerHTML = top.length ? top.map((u) => `<div class="top-row" data-u="${esc(u.id)}"><div class="av" style="width:30px;height:30px;font-size:12px">${esc((u.name || u.username)[0].toUpperCase())}</div>
    <div class="grow"><b>${esc(u.name)}</b> <span class="sub">@${esc(u.username)} · ${fmtNum(u.stats.calls)} records · ${fmtDur(u.stats.totalSeconds)}</span><div class="bar"><i style="width:${(u.stats.calls / max) * 100}%"></i></div></div></div>`).join("")
    : '<div class="empty">No users yet.</div>';
  $("topUsers").querySelectorAll("[data-u]").forEach((r) => (r.onclick = () => openUser(r.dataset.u)));
  renderUsers(); renderAgents(); renderUsage(); if (isSuper()) renderAdmins();
}

// a tile, user by user (click a row to open that user)
function openKpi(key) {
  const U = state.users;
  const T = {
    users: ["👥 Users", "Every account.", ["User", "Email", "Role", "Status", "Created by", "Created", "Last sign-in"],
      (u) => [who(u), esc(u.email || "—"), roleName(u), u.disabled ? "⛔ Disabled" : "✅ Active", creator(u), fmtDate(u.createdAt), fmtDate(u.lastLoginAt)]],
    agents: ["🤖 Agents", "Every user's agents.", ["User", "Agents", "Count"],
      (u) => [who(u), u.agents.map((a) => `${esc(a.icon)} ${esc(a.name)}${a.isDefault ? " ★" : ""} <span class="muted">(${esc(a.typeName)})</span>`).join("<br>") || '<span class="muted">none</span>', `<span class="n">${u.agents.length}</span>`]],
    calls: ["📞 Records", "Calls, live chats, voice chats and WhatsApp messages per user.", ["User", "All", "📞 Calls", "💬 Chats", "🎤 Voice", "WhatsApp", "Turns", "Last"],
      (u) => [who(u), fmtNum(u.stats.calls), byCh(u, "call"), byCh(u, "chat"), byCh(u, "voice"), byCh(u, "whatsapp"), fmtNum(u.stats.turns), fmtDate(u.lastCallAt)]],
    time: ["⏱ Talk time", "How long each user's conversations ran.", ["User", "Talk time", "Records", "Average"],
      (u) => [who(u), fmtDur(u.stats.totalSeconds), fmtNum(u.stats.calls), u.stats.calls ? fmtDur(u.stats.totalSeconds / u.stats.calls) : "—"]],
    reply: ["⚡ Avg reply", "Time from the caller's last word to the agent's voice.", ["User", "Avg reply", "Records"], (u) => [who(u), fmtS(u.stats.avgResponseMs), fmtNum(u.stats.calls)]],
    recordings: ["🎙 Recordings", "Saved call recordings.", ["User", "Recordings", "Records"], (u) => [who(u), u.stats.recordings, fmtNum(u.stats.calls)]],
    tokens: ["🔢 Tokens", "OpenAI tokens per user (chat + summaries).", ["User", "Total", "Input", "Output"],
      (u) => [who(u), fmtNum(u.stats.tokens.total), fmtNum(u.stats.tokens.input || 0), fmtNum(u.stats.tokens.output || 0)]],
    playbooks: ["📘 Playbooks", "Users' own call scripts.", ["User", "Playbooks"], (u) => [who(u), u.playbooks.map((p) => esc(p.name)).join(", ") || '<span class="muted">none</span>']],
    events: ["📅 Events", "Meetings and reminders the agents booked.", ["User", "Events", "Calendar on"],
      (u) => [who(u), u.events, u.agents.filter((a) => a.calendar).map((a) => esc(a.name)).join(", ") || '<span class="muted">—</span>']],
    messages: ["📨 Messages", "New messages callers left, waiting for the owner.", ["User", "New messages"], (u) => [who(u), u.messages]],
  };
  let head, rows, lead, title;
  if (key === "templates") {
    title = "🧩 Templates"; lead = "Templates per agent type, and how many agents use them.";
    head = ["Type", "Templates", "Agents using"];
    rows = Object.values(state.types).map((t) => ({ cells: [`${esc(t.icon)} ${esc(t.name)}`, t.templates.map((x) => esc(x.name)).join(", ") || '<span class="muted">none</span>', t.templates.reduce((n, x) => n + (x.agents || 0), 0)] }));
  } else {
    const [tt, ll, hh, fn] = T[key];
    title = tt; lead = ll + " Click a user to open everything about them."; head = hh;
    rows = U.map((u) => ({ id: u.id, cells: fn(u) }));
  }
  $("kdTitle").textContent = title;
  $("kdLead").textContent = lead;
  $("kdTbl").innerHTML = `<thead><tr>${head.map((h, i) => `<th class="${i ? "n" : ""}">${h}</th>`).join("")}</tr></thead><tbody>${
    rows.map((r) => `<tr class="${r.id ? "click" : ""}" ${r.id ? `data-u="${esc(r.id)}"` : ""}>${r.cells.map((c, i) => `<td class="${i && typeof c !== "string" ? "n" : i && /^[\d.,:hmsk—M ]+$/.test(String(c)) ? "n" : ""}">${c}</td>`).join("")}</tr>`).join("") || `<tr><td class="empty" colspan="${head.length}">Nothing yet.</td></tr>`}</tbody>`;
  $("kdTbl").querySelectorAll("tr[data-u]").forEach((tr) => (tr.onclick = () => { closeD("kpiDialog"); openUser(tr.dataset.u); }));
  openD("kpiDialog");
}

// ---------- users: table with view / edit / delete ----------
function renderUsers() {
  const q = $("search").value.trim().toLowerCase(), f = $("userFilter").value;
  const list = state.users.filter((u) => (!f || (f === "admin" && u.role <= 1) || (f === "user" && u.role > 1) || (f === "off" && u.disabled))
    && (!q || [u.name, u.username, u.email, ...u.agents.map((a) => `${a.name} ${a.typeName}`)].join(" ").toLowerCase().includes(q)));
  const box = $("users");
  if (!list.length) { box.innerHTML = `<tr><td colspan="10" class="empty">${q || f ? "No users match." : "No users yet."}</td></tr>`; return; }
  box.innerHTML = "";
  for (const u of list) {
    const me = u.id === state.me.id;
    const tr = document.createElement("tr");
    tr.className = "click" + (u.disabled ? " off" : "");
    tr.innerHTML = `<td>${who(u).replace("</small>", `${me ? " · you" : ""}</small>`)}</td>
      <td>${roleBadge(u)}</td>
      <td>${u.disabled ? '<span class="badge off">⛔ Disabled</span>' : '<span class="sub">✅ Active</span>'}</td>
      <td>${creator(u)}</td>
      <td class="n">${u.agents.length}</td><td class="n">${fmtNum(u.stats.calls)}</td><td class="n">${fmtDur(u.stats.totalSeconds)}</td><td class="n">${fmtNum(u.stats.tokens.total)}</td>
      <td class="muted">${fmtDate(u.lastLoginAt)}</td>
      <td><div class="acts"><button type="button" data-act="view" title="Agents, calls and usage">👁 View</button>${canManage(u) ? '<button type="button" data-act="edit">✏️ Edit</button>' : ""}${me || !canManage(u) || u.role === 0 ? "" : '<button type="button" class="danger" data-act="delete" title="Delete">🗑</button>'}</div></td>`;
    tr.onclick = (e) => { const b = e.target.closest("[data-act]"); userAction(u, b ? b.dataset.act : "view"); };
    box.appendChild(tr);
  }
}
$("userFilter").addEventListener("change", renderUsers);

// an admin manages users (and itself); the SuperAdmin manages admins too; nobody else edits the SuperAdmin
const canManage = (u) => u.id === state.me.id || (u.role === 2) || (isSuper() && u.role === 1);

// ---------- every agent across users ----------
function renderAgents() {
  const q = $("agentSearch").value.trim().toLowerCase();
  const rows = state.users.flatMap((u) => u.agents.map((a) => ({ u, a })))
    .filter(({ u, a }) => !q || [a.name, a.typeName, a.voice, a.language, u.name, u.username].join(" ").toLowerCase().includes(q));
  $("agentsTbl").innerHTML = rows.length ? rows.map(({ u, a }) => `<tr class="click" data-u="${esc(u.id)}">
      <td><b>${esc(a.icon)} ${esc(a.name)}</b>${a.isDefault ? " ★" : ""}${a.ownerName ? `<div class="muted" style="font-size:12px">for ${esc(a.ownerName)}</div>` : ""}</td>
      <td>${esc(u.name)} <span class="muted">@${esc(u.username)}</span></td>
      <td>${esc(a.typeName)}</td>
      <td>${esc(LANG[a.language] || a.language)} · ${esc(a.voice)}</td>
      <td>${esc(prov(a.sttProvider))} · ${esc(prov(a.ttsProvider))} · ${esc(prov(a.llmProvider))} <div class="muted" style="font-size:12px">${esc(a.llm || "")}</div></td>
      <td>${a.calendar ? "📅 " : ""}${a.emergency ? `🚨${a.emergencyNumbers} ` : ""}${a.playbook ? "📘" : ""}${!a.calendar && !a.emergency && !a.playbook ? '<span class="muted">—</span>' : ""}</td>
      <td class="n">${a.events ?? 0}</td></tr>`).join("") : '<tr><td colspan="7" class="empty">No agents.</td></tr>';
  $("agentsTbl").querySelectorAll("tr[data-u]").forEach((tr) => (tr.onclick = () => openUser(tr.dataset.u)));
}
$("agentSearch").addEventListener("input", renderAgents);

// ---------- usage per user ----------
function renderUsage() {
  const rows = [...state.users].sort((a, b) => b.stats.calls - a.stats.calls);
  $("usageTbl").innerHTML = rows.map((u) => `<tr class="click" data-u="${esc(u.id)}"><td>${who(u)}</td>
    <td class="n"><b>${fmtNum(u.stats.calls)}</b></td><td class="n">${byCh(u, "call")}</td><td class="n">${byCh(u, "chat")}</td><td class="n">${byCh(u, "voice")}</td><td class="n">${byCh(u, "whatsapp")}</td>
    <td class="n">${fmtDur(u.stats.totalSeconds)}</td><td class="n">${fmtNum(u.stats.turns)}</td><td class="n">${fmtNum(u.stats.tokens.total)}</td><td class="n">${fmtS(u.stats.avgResponseMs)}</td>
    <td class="n">${u.stats.recordings}</td><td class="muted">${fmtDate(u.lastCallAt)}</td></tr>`).join("") || '<tr><td colspan="12" class="empty">No users.</td></tr>';
  $("usageTbl").querySelectorAll("tr[data-u]").forEach((tr) => (tr.onclick = () => openUser(tr.dataset.u)));
}

$("search").addEventListener("input", renderUsers);

async function userAction(u, act) {
  try {
    if (act === "view") return openUser(u.id);
    if (act === "edit") return openEdit(u);
    if (act === "reset") {
      $("resetWho").textContent = `For ${u.name} (@${u.username})`;
      $("rPass").value = genPassword(); $("rErr").textContent = "";
      state.resetting = u;
      return openD("resetDialog");
    }
    if (act === "role") {
      const to = u.role === 1 ? 2 : 1;
      if (!confirm(`${to === 1 ? "Give" : "Remove"} admin access ${to === 1 ? "to" : "from"} ${u.name}?`)) return;
      await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ role: to }) });
      toast(`✓ ${u.name} is now ${to === 1 ? "an admin" : "a user"}`);
    }
    if (act === "toggle") {
      if (!u.disabled && !confirm(`Disable ${u.name}? They'll be signed out and can't sign in until enabled again.`)) return;
      await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ disabled: !u.disabled }) });
      toast(u.disabled ? `✓ ${u.name} enabled` : `✓ ${u.name} disabled`);
    }
    if (act === "delete") {
      if (!confirm(`Delete ${u.name} (@${u.username})?\n\nThey lose access straight away. Their agent, playbooks, calls and recordings are moved to data/deleted-users/ (not erased).`)) return;
      await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
      toast(`✓ ${u.name} deleted`);
    }
    loadOverview();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- access: dashboard sections (admins, set by the SuperAdmin) and app features (set by an admin for users) ----------
const SECTION_LABELS = { overview: "📊 Overview", users: "👥 Users", agents: "🤖 Agents", usage: "📞 Calls & usage", templates: "🧩 Templates",
  settings: "⚙️ Settings", logins: "🔐 Sign-ins", activity: "📜 Activity" };
const FEATURE_GROUPS = [
  ["Talk channels", { "talk.call": "📞 Web call", "talk.chat": "💬 Live chat", "talk.voice": "🎤 Voice chat", "talk.whatsapp": "WhatsApp" }],
  ["My agents tabs", { "tab.profile": "👤 Profile", "tab.voice": "🧠 Voice & AI", "tab.availability": "🕒 Availability", "tab.tools": "🧰 Tools" }],
  ["Inside Tools", { "tool.calendar": "📅 Calendar", "tool.emergency": "🚨 Emergency", "tool.playbook": "📘 Playbook", "tool.summaries": "📨 Call summaries delivery" }],
  ["Other", { dashboard: "📊 Dashboard", history: "📚 Call summaries list", "agents.create": "＋ Create agents", "agents.delete": "🗑 Delete agents" }],
];
const featureOn = (u, f) => !(u.permissions?.app && u.permissions.app[f] === false);
const myFeature = (f) => isSuper() || state.access?.app?.[f] !== false;
function renderAccess(u) {
  const box = $("eAccess");
  box.innerHTML = "";
  if (u.role === 0 || u.id === state.me.id || !canManage(u)) return; // nobody sets their own access
  const group = (title, items, cls) => `<div class="acc-group ${cls}"><h5>${title}<button type="button" data-all>all</button><button type="button" data-none>none</button></h5><div class="acc-chips">${items}</div></div>`;
  if (u.role === 1) {
    const secs = u.permissions?.admin || state.sections;
    box.insertAdjacentHTML("beforeend", group("Dashboard sections this admin can open", state.sections.map((k) =>
      `<label><input type="checkbox" data-sec="${k}" ${secs.includes(k) ? "checked" : ""} />${SECTION_LABELS[k] || k}</label>`).join(""), "secs"));
  }
  const who = u.role === 1 ? "this admin (and the most they can give their users)" : "this user";
  // agent types and playbook types: only those this account (the one editing) has itself
  const typeGroup = (which, title, mine) => {
    const keys = Object.keys(mine || {});
    const cur = u.permissions?.[which];
    const on = (k) => !cur || cur.includes(k);
    return group(`${title} · <span class="type-count" data-count="${which}"></span>`, keys.map((k) =>
      `<label><input type="checkbox" data-${which}="${esc(k)}" ${on(k) ? "checked" : ""} />${esc(mine[k].icon || "")} ${esc(mine[k].name)}</label>`).join("") || '<span class="sub">none</span>', "types");
  };
  box.insertAdjacentHTML("beforeend", typeGroup("agentTypes", "Agent types they can pick", state.myAgentTypes));
  box.insertAdjacentHTML("beforeend", typeGroup("playbookTypes", "Playbook types they can add", state.myPbTypes));
  const count = () => ["agentTypes", "playbookTypes"].forEach((w) => {
    const all = box.querySelectorAll(`[data-${w}]`).length, on = box.querySelectorAll(`[data-${w}]:checked`).length;
    const el = box.querySelector(`[data-count="${w}"]`); if (el) el.textContent = `${on} of ${all}`;
  });
  box.addEventListener("change", count);
  setTimeout(count);
  box.insertAdjacentHTML("beforeend", FEATURE_GROUPS.map(([title, items]) => group(`${title} · for ${who}`, Object.entries(items).map(([f, label]) => {
    const lock = !myFeature(f);
    return `<label class="${lock ? "locked" : ""}" title="${lock ? "You don't have this yourself, so you can't give it" : ""}"><input type="checkbox" data-feat="${f}" ${featureOn(u, f) && !lock ? "checked" : ""} ${lock ? "disabled" : ""} />${label}</label>`;
  }).join(""), "feats")).join(""));
  box.querySelectorAll("[data-all],[data-none]").forEach((b) => (b.onclick = () => { b.closest(".acc-group").querySelectorAll("input:not(:disabled)").forEach((i) => (i.checked = b.hasAttribute("data-all"))); box.dispatchEvent(new Event("change")); }));
  box.dataset.before = JSON.stringify(readAccess(u, true));
}
function readAccess(u, raw) {
  const box = $("eAccess");
  if (!box.children.length) return null;
  const app = {};
  box.querySelectorAll("[data-feat]").forEach((i) => (app[i.dataset.feat] = i.checked));
  const out = { app };
  if (u.role === 1) out.admin = [...box.querySelectorAll("[data-sec]:checked")].map((i) => i.dataset.sec);
  for (const w of ["agentTypes", "playbookTypes"]) {
    const boxes = [...box.querySelectorAll(`[data-${w}]`)];
    if (!boxes.length) continue;
    const on = boxes.filter((i) => i.checked).map((i) => i.getAttribute(`data-${w.toLowerCase()}`) ?? i.dataset[w]);
    out[w] = on.length === boxes.length && !state.myLimits?.[w] ? null : on; // every box ticked = all types (new ones too)
  }
  if (raw) return out;
  return JSON.stringify(out) === box.dataset.before ? null : out; // unchanged: don't send
}

// ---------- edit any user's details ----------
function openEdit(u) {
  state.editing = u;
  $("edTitle").textContent = `✏️ Edit ${u.name}`;
  $("eName").value = u.name || ""; $("eUser").value = u.username; $("eEmail").value = u.email || "";
  $("eRole").value = String(u.role === 1 ? 1 : 2); $("eStatus").value = u.disabled ? "off" : "on";
  const me = u.id === state.me.id;
  $("eRole").disabled = me || !isSuper() || u.role === 0; // only the SuperAdmin changes roles; never its own
  $("eStatus").disabled = me;
  renderAccess(u);
  $("eMeta").textContent = `Created ${fmtDate(u.createdAt)} · last sign-in ${fmtDate(u.lastLoginAt)}${u.signupSource === "self" ? " · signed up by themselves" : ""}${me ? " · this is you" : ""}`;
  $("eErr").textContent = "";
  openD("editDialog");
  setTimeout(() => $("eName").focus(), 30);
}
$("eReset").onclick = () => { closeD("editDialog"); userAction(state.editing, "reset"); };
$("editForm").onsubmit = async (e) => {
  e.preventDefault();
  const u = state.editing, ch = {};
  if ($("eName").value.trim() !== (u.name || "")) ch.name = $("eName").value.trim();
  if ($("eUser").value.trim().toLowerCase() !== u.username) ch.username = $("eUser").value.trim().toLowerCase();
  if ($("eEmail").value.trim() !== (u.email || "")) ch.email = $("eEmail").value.trim();
  if (!$("eRole").disabled && Number($("eRole").value) !== (u.role === 1 ? 1 : 2)) ch.role = Number($("eRole").value);
  if (!$("eStatus").disabled && ($("eStatus").value === "off") !== !!u.disabled) ch.disabled = $("eStatus").value === "off";
  const acc = readAccess(u);
  if (acc) ch.permissions = acc;
  if (!Object.keys(ch).length) return closeD("editDialog");
  if (ch.disabled && !confirm(`Disable ${u.name}? They'll be signed out and can't sign in until enabled again.`)) return;
  try {
    await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify(ch) });
    closeD("editDialog");
    toast(`✓ ${ch.name || u.name} saved`);
    loadOverview(); loadLog();
  } catch (err) { $("eErr").textContent = err.message; }
};

// ---------- add user / reset password ----------
$("addUserBtn").onclick = () => openAdd(2);
function openAdd(role) {
  $("addForm").reset();
  $("aRole").querySelector('[value="1"]').hidden = !isSuper();
  $("aRole").value = String(isSuper() ? role : 2);
  $("addTitle").textContent = role === 1 ? "＋ Add admin" : "＋ Add user";
  $("aPass").value = genPassword(); $("aErr").textContent = ""; openD("addDialog"); setTimeout(() => $("aName").focus(), 30);
}
$("aGen").onclick = () => ($("aPass").value = genPassword());
$("rGen").onclick = () => ($("rPass").value = genPassword());
$("aName").addEventListener("input", () => {
  if ($("aUser").dataset.touched) return;
  $("aUser").value = $("aName").value.trim().toLowerCase().replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, "").slice(0, 32);
});
$("aUser").addEventListener("input", () => ($("aUser").dataset.touched = "1"));
$("addForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const u = await api("/api/admin/users", { method: "POST", body: JSON.stringify({ name: $("aName").value, username: $("aUser").value, email: $("aEmail").value.trim(), password: $("aPass").value, role: Number($("aRole").value) }) });
    closeD("addDialog");
    await navigator.clipboard?.writeText(`Username: ${u.username}\nPassword: ${$("aPass").value}`).catch(() => {});
    toast(`✓ ${u.name} added. Sign-in details copied; share them privately.`);
    delete $("aUser").dataset.touched;
    loadOverview();
  } catch (err) { $("aErr").textContent = err.message; }
};
$("resetForm").onsubmit = async (e) => {
  e.preventDefault();
  const u = state.resetting;
  try {
    await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ password: $("rPass").value }) });
    closeD("resetDialog");
    await navigator.clipboard?.writeText($("rPass").value).catch(() => {});
    toast(`✓ Password reset for ${u.name}. New password copied.`);
  } catch (err) { $("rErr").textContent = err.message; }
};

// ---------- one user's agent, playbooks and calls ----------
async function openUser(id) {
  const u = await api(`/api/admin/users/${id}`);
  state.viewing = u; state.callPage = 1;
  $("udTitle").textContent = `${u.name} · @${u.username}`;
  const agentBox = (a) => `<div class="agent-box">
      <div class="t">${esc(a.icon)} ${esc(a.name)}${a.isDefault ? ' <span class="chip">★ default</span>' : ""}</div>
      <div class="s ellipsis" style="color:var(--muted);font-size:12px">${esc(a.typeName)}${a.description ? " · " + esc(a.description) : ""}</div>
      <div class="chips">
        <span class="chip">🌐 ${esc(LANG[a.language] || a.language)}</span><span class="chip">🗣 ${esc(a.voice)}</span>
        <span class="chip">🧠 ${esc(a.llm)}</span><span class="chip">👂 ${esc(a.stt)}</span><span class="chip">🔊 ${esc(a.tts)}</span>
        <span class="chip">📘 ${esc(a.playbook || "Default")}</span>
        <span class="chip ${a.calendar ? "on" : ""}">📅 ${a.calendar ? "On" : "Off"}</span>
        <span class="chip ${a.emergency ? "on" : ""}">🚨 ${a.emergency ? `${a.emergencyNumbers} numbers` : "Off"}</span>
      </div></div>`;
  $("udBody").innerHTML = `
    <div class="detail-grid">
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="box"><h4>🤖 Agents (${u.agents.length})</h4>${u.agents.map(agentBox).join("") || '<div class="empty">No agents</div>'}
          <div class="s" style="color:var(--muted);font-size:12px;margin-top:8px">📅 ${u.events} calendar events${u.email ? ` · ✉️ ${esc(u.email)}` : ""}</div></div>
        <div class="box"><h4>📘 Playbooks (${u.playbooks.length})</h4><div class="list">${
          u.playbooks.length ? u.playbooks.map((p) => `<div class="row" style="cursor:default"><div class="grow"><div class="t">${esc(p.name)}</div><div class="s ellipsis">${esc(p.goal)}</div></div></div>`).join("") : '<div class="empty">No playbooks</div>'
        }</div></div>
        <div class="box"><h4>📊 Usage</h4><div class="kv">
          <span>Calls</span><span>${fmtNum(u.stats.calls)} (${fmtNum(u.stats.turns)} turns)</span>
          <span>Talk time</span><span>${fmtDur(u.stats.totalSeconds)}</span>
          <span>Tokens</span><span>${fmtNum(u.stats.tokens.total)}</span>
          <span>Avg reply</span><span>${fmtS(u.stats.avgResponseMs)}</span>
          <span>Recordings</span><span>${u.stats.recordings}</span>
        </div></div>
      </div>
      <div class="box"><h4>📞 Calls</h4><div class="list" id="udCalls"></div><div class="pager" id="udPager"></div></div>
    </div>`;
  openD("userDialog");
  loadUserCalls();
}

async function loadUserCalls() {
  const u = state.viewing;
  const data = await api(`/api/calls?as=${u.id}&page=${state.callPage}`);
  const box = $("udCalls");
  box.innerHTML = data.items.length ? "" : '<div class="empty">No calls yet.</div>';
  for (const c of data.items) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "row";
    const outcome = /Outcome:\s*(.+)/i.exec(c.summary || "")?.[1] || (c.summary || "No summary").split("\n")[0];
    b.innerHTML = `<div>${esc(c.playbook?.icon || "💬")}</div><div class="grow"><div class="t">${c.agentName ? esc(c.agentName) + " · " : ""}${esc(c.playbook?.name || "Default agent")} · ${fmtDate(c.startedAt)}</div><div class="s ellipsis">${esc(outcome)}</div></div><div class="s">${esc(c.duration)}${c.recording ? " · 🎙" : ""}</div>`;
    b.onclick = () => openCall(c.id);
    box.appendChild(b);
  }
  const pager = $("udPager");
  pager.innerHTML = "";
  if (data.pages > 1) {
    const prev = document.createElement("button"); prev.className = "btn btn-ghost"; prev.textContent = "← Prev"; prev.disabled = data.page <= 1;
    const next = document.createElement("button"); next.className = "btn btn-ghost"; next.textContent = "Next →"; next.disabled = data.page >= data.pages;
    const label = document.createElement("span"); label.textContent = `Page ${data.page} of ${data.pages}`;
    prev.onclick = () => { state.callPage--; loadUserCalls(); };
    next.onclick = () => { state.callPage++; loadUserCalls(); };
    pager.append(prev, label, next);
  }
}

async function openCall(callId) {
  const u = state.viewing;
  const c = await api(`/api/calls/${callId}?as=${u.id}`);
  const st = c.stats || {};
  $("cdTitle").textContent = `${c.playbook?.icon || "💬"} ${c.playbook?.name || "Default agent"} · ${u.name} · ${fmtDate(c.startedAt)}`;
  const lines = (c.transcript || []).map((t) => {
    const chips = t.role === "caller"
      ? [t.intent && `🎯 ${t.intent}`, t.mood && `${EMOJI[t.mood] || "💬"} ${t.mood}`, t.lang && `🌐 ${t.lang}`, t.responseMs != null && `⏱ reply ${fmtS(t.responseMs)}`, t.emergency && `🚨 ${t.emergency}`, t.calendar && `📅 ${t.calendar}`]
      : (t.emotions || []);
    return `<div class="tline"><b>${t.role === "caller" ? "Caller:" : "Agent:"}</b>${esc(t.text)}<div class="chips">${chips.filter(Boolean).map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div></div>`;
  }).join("");
  $("cdBody").innerHTML = `
    <p class="sub">⏱ ${esc(c.duration)} · ${st.turns ?? 0} turns · avg reply ${esc(st.avgResponse || "—")} · 🌐 ${esc(st.languages || c.language || "—")} · 💬 ${esc(st.moodPath || "—")} · 🔢 ${fmtNum(st.tokens?.total || 0)} tokens · 📴 ${esc(c.endedBy)}</p>
    <pre class="summary">${esc(c.summary || "No summary was written for this call.")}</pre>
    ${c.recording ? `<h4 style="margin:14px 0 6px">🎙 Recording</h4><audio controls preload="none" style="width:100%" src="/api/calls/${c.id}/recording?as=${u.id}"></audio>` : ""}
    <h4 style="margin:14px 0 6px">Transcript</h4>${lines || '<div class="empty">No transcript.</div>'}
    <div class="form-actions" style="justify-content:flex-start">
      <a class="btn btn-ghost" href="/api/calls/${c.id}/summary?as=${u.id}" download>⬇ Summary file</a>
      ${c.recording ? `<a class="btn btn-ghost" href="/api/calls/${c.id}/recording?as=${u.id}" download="call-${c.id}">⬇ Recording</a>` : ""}
    </div>`;
  openD("callDialog");
}

// ---------- 🛡 Admins (SuperAdmin) ----------
$("addAdminBtn").onclick = () => openAdd(1);
function renderAdmins() {
  const admins = state.users.filter((u) => u.role <= 1);
  $("adminCards").innerHTML = admins.map((a) => {
    const made = state.users.filter((u) => u.createdBy === a.id);
    const secs = a.role === 0 ? ["everything"] : (a.permissions?.admin || state.sections).map((k) => SECTION_LABELS[k] || k);
    const offFeats = a.role === 0 ? [] : Object.entries(a.permissions?.app || {}).filter(([, v]) => v === false).map(([k]) => k);
    return `<article class="acard">
      <div class="top">${who(a)}<span style="margin-left:auto">${roleBadge(a)}</span></div>
      <div class="sub">${esc(a.email || "no email")} · ${a.disabled ? "⛔ disabled" : "✅ active"} · last sign-in ${fmtDate(a.lastLoginAt)} · created by ${creator(a)}</div>
      <div><div class="sub" style="margin-bottom:4px">Dashboard sections</div><div class="chips">${secs.map((x) => `<span class="chip on">${esc(x)}</span>`).join("") || '<span class="chip">none</span>'}</div></div>
      ${offFeats.length ? `<div class="sub">Switched off in the app: ${offFeats.map(esc).join(", ")}</div>` : ""}
      <div class="sub">Agent types: <b>${a.role === 0 || !a.permissions?.agentTypes ? "all" : a.permissions.agentTypes.length}</b> · Playbook types: <b>${a.role === 0 || !a.permissions?.playbookTypes ? "all" : a.permissions.playbookTypes.length}</b> of ${Object.keys(state.myAgentTypes || {}).length}</div>
      <details class="made"><summary>👥 Users created: ${made.length}</summary>${made.length ? `<ul>${made.map((u) => `<li>${esc(u.name)} @${esc(u.username)} · ${roleName(u)}${u.disabled ? " · disabled" : ""}</li>`).join("")}</ul>` : '<div class="sub">None yet.</div>'}</details>
      <div class="u-actions">${a.role === 0 ? "" : `<button class="btn btn-ghost" data-edit="${esc(a.id)}">✏️ Edit &amp; access</button>`}<button class="btn btn-ghost" data-view="${esc(a.id)}">👁 View</button></div>
    </article>`;
  }).join("") || '<div class="empty">No admins yet.</div>';
  $("adminCards").querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openEdit(state.users.find((u) => u.id === b.dataset.edit))));
  $("adminCards").querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => openUser(b.dataset.view)));
}

// ---------- 🗄 Server configuration (SuperAdmin): .env / keys.env and app_config ----------
async function loadServer() {
  const { files } = await api("/api/super/server-config");
  $("serverFiles").innerHTML = "";
  for (const f of files) {
    const el = document.createElement("div");
    el.className = "cfg-file";
    el.innerHTML = `<h3>📄 ${esc(f.file)} <span class="sub">${f.exists ? `${f.entries.length} settings` : "not created yet"}</span><button class="btn btn-grad" type="button" data-save>💾 Save ${esc(f.file)}</button></h3>
      ${f.entries.map((e) => `<div class="cfg-row"><div><code>${esc(e.key)}</code>${e.comment ? `<small>${esc(e.comment)}</small>` : ""}</div>
        <input type="${e.secret ? "password" : "text"}" data-key="${esc(e.key)}" data-orig="${e.secret ? "" : esc(e.value)}" value="${e.secret ? "" : esc(e.value)}"
          placeholder="${e.secret ? (e.set ? "•••••••• (set) · type to replace" : "(empty) · type a value") : ""}" autocomplete="off" spellcheck="false" /></div>`).join("")}
      <div class="cfg-add"><input type="text" data-newkey placeholder="New setting name (e.g. LOG_LEVEL)" /><input type="text" data-newval placeholder="Value" /></div>`;
    el.querySelectorAll("input[data-key]").forEach((i) => i.addEventListener("input", () => i.classList.toggle("changed", i.value !== i.dataset.orig)));
    el.querySelector("[data-save]").onclick = async () => {
      const changes = {};
      el.querySelectorAll("input[data-key]").forEach((i) => { if (i.value !== i.dataset.orig && !(i.type === "password" && i.value === "")) changes[i.dataset.key] = i.value; });
      const nk = el.querySelector("[data-newkey]").value.trim();
      if (nk) changes[nk] = el.querySelector("[data-newval]").value;
      if (!Object.keys(changes).length) return toast("Nothing changed");
      if (!confirm(`Save ${Object.keys(changes).length} change(s) to ${f.file}?\n\n${Object.keys(changes).join(", ")}\n\nThey apply after Restart.`)) return;
      try {
        await api("/api/super/server-config", { method: "PUT", body: JSON.stringify({ file: f.file, changes }) });
        toast(`✓ ${f.file} saved · restart to apply`);
        loadServer(); loadLog();
      } catch (err) { toast("⚠ " + err.message); }
    };
    $("serverFiles").appendChild(el);
  }
  // app_config (database): one JSON editor per section
  const { config, sections } = await api("/api/admin/config");
  $("dbConfig").innerHTML = "";
  for (const sec of Object.keys(config)) {
    const d = document.createElement("details");
    d.className = "tpl dbsec";
    d.innerHTML = `<summary>🗃 ${esc(sec)} <span class="s">${esc((sections && sections[sec]) || "")}</span></summary><textarea spellcheck="false"></textarea>
      <div class="form-actions"><span class="form-error"></span><button class="btn btn-grad" type="button">💾 Save ${esc(sec)}</button></div>`;
    d.querySelector("textarea").value = JSON.stringify(config[sec], null, 2);
    d.querySelector("button").onclick = async () => {
      let v;
      try { v = JSON.parse(d.querySelector("textarea").value); } catch (e) { d.querySelector(".form-error").textContent = "Not valid JSON: " + e.message; return; }
      d.querySelector(".form-error").textContent = "";
      try { await api(`/api/admin/config/${encodeURIComponent(sec)}`, { method: "PUT", body: JSON.stringify(v) }); toast(`✓ ${sec} saved`); loadLog(); loadSettings(); }
      catch (err) { d.querySelector(".form-error").textContent = err.message; }
    };
    $("dbConfig").appendChild(d);
  }
}
async function restartBackend() {
  if (!confirm("Restart the backend now? Calls in progress are cut off. It takes about 10–20 seconds.")) return;
  try {
    await api("/api/super/restart", { method: "POST" });
    toast("🔄 Restarting… this page reloads when it's back");
    await new Promise((r) => setTimeout(r, 4000));
    for (let i = 0; i < 90; i++) {
      if (await _fetch("/api/health").then((x) => x.ok).catch(() => false)) return location.reload();
      await new Promise((r) => setTimeout(r, 1000));
    }
    alert("The backend didn't come back. Check voice_ai_backend/logs/restart.log and error.log.");
  } catch (err) { alert("Couldn't restart: " + err.message); }
}
$("restartBtn").onclick = restartBackend;
$("restartBtn2").onclick = restartBackend;
addEventListener("hashchange", () => { if (location.hash === "#server" && isSuper()) loadServer().catch((e) => ($("serverFiles").innerHTML = `<div class="empty">${esc(e.message)}</div>`)); });

// ---------- app settings (MySQL app_config) ----------
async function loadSettings() {
  const { config } = await api("/api/admin/config");
  state.config = config;
  $("setSignup").checked = !!config.auth.allowSignup;
  $("setHours").value = config.auth.sessionHours;
  $("setDays").value = config.auth.rememberDays;
  $("setAgents").value = config.agent.maxAgentsPerUser;
  $("setSilence").value = config.conversation.silenceRetrySeconds ?? 8;
  $("setRetries").value = config.conversation.silenceRetries ?? 2;
  renderThemes();
}

// ---------- 🎨 site theme (branding.theme {name, motion}; themes.js has the list and applies it) ----------
function renderThemes() {
  const T = window.TSA_THEME; if (!T || !state.config) return;
  const cur = state.config.branding?.theme || {};
  const name = T.list.some((t) => t.id === cur.name) ? cur.name : "violet";
  $("thMotion").checked = cur.motion !== false;
  const t0 = T.list.find((t) => t.id === name);
  $("thNow").textContent = `Now: ${t0.name}`;
  $("thGrid").innerHTML = T.list.map((t) => `<button type="button" class="th-card" role="radio" aria-checked="${t.id === name}" data-theme-id="${t.id}">
      <span class="th-strip"><i style="background:${t.c[0]}"></i><i style="background:${t.c[1]}"></i><i style="background:${t.c[2]}"></i><i style="background:${t.dark[0]}"></i><i style="background:${t.light[0]}"></i></span>
      <b>${esc(t.name)}</b><small><span>${esc(t.note)}</span><span>${esc(T.motions[t.motion])}</span></small></button>`).join("");
}
async function saveTheme(patch, label) {
  const theme = { ...(state.config.branding?.theme || {}), ...patch };
  window.TSA_THEME.apply(theme); // show it at once
  await saveSection("branding", { theme }, label);
  renderThemes();
}
$("thGrid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-theme-id]"); if (!b) return;
  const t = window.TSA_THEME.list.find((x) => x.id === b.dataset.themeId);
  saveTheme({ name: t.id }, `Theme “${t.name}”`);
});
$("thMotion").onchange = () => saveTheme({ motion: $("thMotion").checked }, $("thMotion").checked ? "Moving background on" : "Moving background off");
async function saveSection(section, patch, label) {
  try {
    const { value } = await api(`/api/admin/config/${section}`, { method: "PUT", body: JSON.stringify({ ...state.config[section], ...patch }) });
    state.config[section] = value;
    toast(`✓ ${label} saved`);
    loadLog();
  } catch (err) {
    toast("⚠ " + err.message);
    loadSettings();
  }
}
const num = (id, min, max) => Math.min(max, Math.max(min, Math.round(Number($(id).value) || min)));
$("setSignup").onchange = () => saveSection("auth", { allowSignup: $("setSignup").checked }, $("setSignup").checked ? "Sign-up opened" : "Sign-up closed");
$("setHours").onchange = () => saveSection("auth", { sessionHours: num("setHours", 1, 168) }, "Session length");
$("setDays").onchange = () => saveSection("auth", { rememberDays: num("setDays", 1, 365) }, "Keep me signed in");
$("setAgents").onchange = () => saveSection("agent", { maxAgentsPerUser: num("setAgents", 1, 200) }, "Agents per user");
const num0 = (id, max) => Math.min(max, Math.max(0, Math.round(Number($(id).value) || 0)));
$("setSilence").onchange = () => saveSection("conversation", { silenceRetrySeconds: num0("setSilence", 60) }, "Re-ask after silence");
$("setRetries").onchange = () => saveSection("conversation", { silenceRetries: num0("setRetries", 10) }, "Re-asks before hanging up");

// ---------- activity log ----------
const ACTIONS = {
  "auth.login": "🔓 signed in", "auth.logout": "🔒 signed out", "auth.login_failed": "⚠ sign-in failed", "auth.signup": "✍️ signed up",
  "auth.password_change": "🔑 changed password", "user.create": "👤 added user", "user.update": "👤 updated user", "user.delete": "🗑 deleted user",
  "agent.create": "🤖 created agent", "agent.update": "🤖 edited agent", "agent.delete": "🗑 deleted agent", "agent.settings": "⚙️ agent setup",
  "playbook.add": "📘 added playbook", "playbook.delete": "📘 removed playbook", "call.save": "📞 call saved", "call.delete": "🗑 call deleted",
  "calendar.add": "📅 event added", "calendar.delete": "📅 event removed", "config.update": "⚙️ app settings",
  "message.add": "📨 message taken", "message.done": "📨 message done", "message.new": "📨 message reopened", "message.delete": "🗑 message deleted",
  "type.create": "🧩 added type", "type.update": "🧩 edited type", "template.create": "🧩 added template", "template.update": "🧩 edited template",
  "template.delete": "🗑 removed template",
  "server.config": "🗄 server settings", "server.restart": "🔄 restarted backend", "whatsapp.send": "🟢 WhatsApp sent", "emergency.alert": "🚨 emergency alert",
  "playbook.update": "📘 edited playbook",
};
state.logKind = "user"; state.logUser = "";
$("logKind").addEventListener("click", (e) => {
  const b = e.target.closest("[data-kind]");
  if (!b) return;
  state.logKind = b.dataset.kind; state.logPage = 1;
  $("logKind").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  loadLog();
});
$("logUser").addEventListener("change", () => { state.logUser = $("logUser").value; state.logPage = 1; loadLog(); });
async function loadRecent() { // overview: the latest things people did in the app (not sign-ins)
  if (!mySections().includes("activity")) return;
  const r = await api("/api/admin/logs?page=1&kind=user");
  $("recentLog").innerHTML = r.items.slice(0, 6).map((l) => `<div class="lrow"><span class="w"><b>${esc(l.username || "—")}</b> ${esc(ACTIONS[l.action] || l.action)} <span class="muted">${esc(l.target || "")}</span></span><span class="m">${esc(fmtDate(l.at))}</span></div>`).join("") || '<div class="empty">Nothing yet.</div>';
}
async function loadLog() {
  if (!mySections().includes("activity")) return;
  const data = await api(`/api/admin/logs?page=${state.logPage}${state.logKind ? `&kind=${state.logKind}` : ""}${state.logUser ? `&user=${encodeURIComponent(state.logUser)}` : ""}`);
  loadRecent().catch(() => {});
  const sel = $("logUser"), keep = sel.value; // the user filter lists every account
  if (sel.options.length <= 1 && state.users.length) { for (const u of state.users) sel.add(new Option(`${u.name} @${u.username}`, u.id)); sel.value = keep; }
  $("log").innerHTML = data.items.length ? data.items.map((l) => `
    <div class="log-row">
      <span class="when">${esc(fmtDate(l.at))}</span>
      <span class="who">${esc(l.username || "—")}</span>
      <span class="act ${l.action.endsWith("failed") ? "fail" : ""}" title="${esc(l.action)}">${esc(ACTIONS[l.action] || l.action)}</span>
      <span class="what" title="${esc(l.target)}${l.details ? " " + esc(JSON.stringify(l.details)) : ""}">${esc(l.target)}${l.ip && !/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(l.ip) ? ` · ${esc(l.ip.replace("::ffff:", ""))}` : ""}</span>
    </div>`).join("") : '<div class="empty">Nothing logged yet.</div>';
  const pager = $("logPager");
  pager.innerHTML = "";
  if (data.pages > 1) {
    const prev = document.createElement("button"); prev.className = "btn btn-ghost"; prev.textContent = "← Newer"; prev.disabled = data.page <= 1;
    const next = document.createElement("button"); next.className = "btn btn-ghost"; next.textContent = "Older →"; next.disabled = data.page >= data.pages;
    const label = document.createElement("span"); label.textContent = `Page ${data.page} of ${data.pages}`;
    prev.onclick = () => { state.logPage--; loadLog(); };
    next.onclick = () => { state.logPage++; loadLog(); };
    pager.append(prev, label, next);
  }
}

// ---------- sign-in attempts (login_attempts) ----------
async function loadLogins() {
  const data = await api(`/api/admin/logins?page=${state.loginPage}`);
  $("logins").innerHTML = data.items.length ? data.items.map((l) => `
    <div class="lrow">
      <span class="w"><b>${esc(l.username || "—")}</b> · <span class="${l.success ? "ok" : "bad"}">${l.success ? "✓" : "✕"} ${esc(l.reason)}</span></span>
      <span class="m">${esc(fmtDate(l.at))}${l.ip && !/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1|0:0:0:0:0:0:0:1)$/.test(l.ip) ? ` · ${esc(l.ip.replace("::ffff:", ""))}` : ""}</span>
    </div>`).join("") : '<div class="empty">No sign-ins yet.</div>';
  const pager = $("loginPager");
  pager.innerHTML = "";
  if (data.pages > 1) {
    const prev = document.createElement("button"); prev.className = "btn btn-ghost"; prev.textContent = "← Newer"; prev.disabled = data.page <= 1;
    const next = document.createElement("button"); next.className = "btn btn-ghost"; next.textContent = "Older →"; next.disabled = data.page >= data.pages;
    const label = document.createElement("span"); label.textContent = `${data.page} / ${data.pages}`;
    prev.onclick = () => { state.loginPage--; loadLogins(); };
    next.onclick = () => { state.loginPage++; loadLogins(); };
    pager.append(prev, label, next);
  }
}

// ---------- agent types & templates (agent_types / agent_templates) ----------
// Same placeholder rules as the backend, for the live preview.
function renderTpl(text, v) {
  const fb = { agent: "the assistant", owner: "the person you work for", org: "the company" };
  return String(text || "")
    .replace(/\[\[([\s\S]*?)\]\]/g, (_, inner) => ([...inner.matchAll(/\{(agent|owner|org)\}/g)].every((m) => v[m[1]]) ? inner : ""))
    .replace(/\{(agent|owner|org)\}/g, (_, k) => v[k] || fb[k]).replace(/[ \t]{2,}/g, " ").trim();
}
const SAMPLE = { agent: "Brown", owner: "DJ", org: "Telemune" };

async function loadTemplates(keepKey) {
  const { types } = await api("/api/admin/templates");
  state.types = types;
  if (!keepKey || !types[state.typeKey]) state.typeKey = state.typeKey && types[state.typeKey] ? state.typeKey : Object.keys(types)[0];
  renderTypeList();
  renderTypeEditor();
}

function renderTypeList() {
  const box = $("typeList");
  box.innerHTML = "";
  for (const [key, t] of Object.entries(state.types)) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "row"; b.setAttribute("aria-pressed", String(key === state.typeKey));
    b.innerHTML = `<span class="ic" aria-hidden="true">${esc(t.icon)}</span><span class="grow"><span class="t ellipsis" style="display:block">${esc(t.name)}</span>
      <span class="s">${t.templates.length} template${t.templates.length === 1 ? "" : "s"}${t.needsOwner ? " · works for a person" : ""}</span></span>${t.active ? "" : '<span class="off-tag">off</span>'}`;
    b.onclick = () => { state.typeKey = key; state.draft = false; renderTypeList(); renderTypeEditor(); };
    box.appendChild(b);
  }
}

const sw = (id, label, on) => `<label><span class="sw"><input type="checkbox" id="${id}" ${on ? "checked" : ""} /><span></span></span>${label}</label>`;

function renderTypeEditor() {
  const t = state.types[state.typeKey];
  const box = $("typeEditor");
  if (!t) { box.innerHTML = '<div class="empty">Pick a type.</div>'; return; }
  box.innerHTML = `
    <form class="box" id="typeForm">
      <h4>${esc(t.icon)} Agent type · <code>${esc(t.key)}</code></h4>
      <div class="f2"><div><label for="tyName">Name</label><input type="text" id="tyName" maxlength="60" value="${esc(t.name)}" required /></div>
        <div><label for="tyIcon">Icon</label><input type="text" id="tyIcon" maxlength="16" value="${esc(t.icon)}" /></div></div>
      <label for="tyDesc">Description (shown when creating an agent)</label><input type="text" id="tyDesc" maxlength="300" value="${esc(t.description)}" />
      <label for="tyRole">Persona when no template is picked</label><textarea id="tyRole" maxlength="300" rows="2">${esc(t.role)}</textarea>
      <label for="tyGreet">Greeting (first line of every call, unless the template or agent has its own)</label><textarea id="tyGreet" maxlength="400" rows="2">${esc(t.greeting)}</textarea>
      <div class="preview-line" id="tyPreview"></div>
      <div class="switches">${sw("tyOwner", "Ask “works for whom?” (required)", t.needsOwner)}${sw("tyCal", "Calendar on for new agents", t.defaultCalendar)}${sw("tyActive", "Available to users", t.active)}</div>
      <div class="form-actions"><button class="btn btn-grad" type="submit">💾 Save type</button></div>
    </form>
    <div id="tplList"></div>`;
  const preview = () => ($("tyPreview").textContent = `Example: “${renderTpl($("tyGreet").value, SAMPLE)}”`);
  $("tyGreet").oninput = preview;
  preview();
  $("typeForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/api/admin/types/${encodeURIComponent(t.key)}`, { method: "PUT", body: JSON.stringify({
        name: $("tyName").value, icon: $("tyIcon").value, description: $("tyDesc").value, role: $("tyRole").value, greeting: $("tyGreet").value,
        needsOwner: $("tyOwner").checked, defaultCalendar: $("tyCal").checked, active: $("tyActive").checked }) });
      toast("✓ Type saved");
      await loadTemplates(true);
      loadLog();
    } catch (err) { toast("⚠ " + err.message); }
  };
  const list = $("tplList");
  const items = state.draft ? [{ id: null, name: "", role: "", greeting: "", goal: "", steps: [], rules: [], summary: "", isDefault: false, active: true, agents: 0 }, ...t.templates] : t.templates;
  if (!items.length) list.innerHTML = '<div class="empty">No templates yet for this type. Add one with ＋ New template.</div>';
  for (const tp of items) list.appendChild(templateForm(t, tp));
}

function templateForm(t, tp) {
  const d = document.createElement("details");
  d.className = "tpl";
  d.open = !tp.id;
  const uid = tp.id ? tp.id.replace(/[^\w-]/g, "") : "new";
  d.innerHTML = `
    <summary>${tp.id ? esc(tp.name) : "＋ New template"}${tp.isDefault ? " ★" : ""}${tp.active ? "" : ' <span class="off-tag">off</span>'}
      <span class="s">${tp.id ? `${tp.agents} agent${tp.agents === 1 ? "" : "s"} using it` : "not saved yet"}</span></summary>
    <form>
      <label>Name</label><input type="text" name="name" maxlength="60" required value="${esc(tp.name)}" />
      <label>Persona (who the agent is) <span style="text-transform:none;letter-spacing:0;font-weight:500">empty = the type's</span></label>
      <textarea name="role" maxlength="300" rows="2" placeholder="${esc(t.role)}">${esc(tp.role)}</textarea>
      <label>Greeting <span style="text-transform:none;letter-spacing:0;font-weight:500">empty = the type's</span></label>
      <textarea name="greeting" maxlength="400" rows="2" placeholder="${esc(t.greeting)}">${esc(tp.greeting)}</textarea>
      <div class="preview-line"></div>
      <label>Goal</label><textarea name="goal" maxlength="400" rows="2" required>${esc(tp.goal)}</textarea>
      <div class="f2b">
        <div><label>Steps (one per line)</label><textarea name="steps" rows="6">${esc(tp.steps.join("\n"))}</textarea></div>
        <div><label>Rules (one per line)</label><textarea name="rules" rows="6">${esc(tp.rules.join("\n"))}</textarea></div>
      </div>
      <label>Summary should cover</label><input type="text" name="summary" maxlength="300" value="${esc(tp.summary)}" />
      <div class="switches">${sw(`d-${uid}`, "Pre-selected for new agents of this type", tp.isDefault)}${sw(`a-${uid}`, "Available to users", tp.active)}</div>
      <div class="form-actions">
        ${tp.id ? '<button class="btn btn-ghost danger" type="button" data-del>🗑 Delete</button>' : '<button class="btn btn-ghost" type="button" data-cancel>Cancel</button>'}
        <button class="btn btn-grad" type="submit">💾 ${tp.id ? "Save template" : "Add template"}</button>
      </div>
    </form>`;
  const f = d.querySelector("form");
  const prev = d.querySelector(".preview-line");
  const preview = () => (prev.textContent = `Example: “${renderTpl(f.elements.greeting.value || t.greeting, SAMPLE)}”`);
  f.elements.greeting.oninput = preview;
  preview();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = { type: t.key, name: f.elements.name.value, role: f.elements.role.value, greeting: f.elements.greeting.value, goal: f.elements.goal.value, steps: f.elements.steps.value, rules: f.elements.rules.value,
      summary: f.elements.summary.value, isDefault: $(`d-${uid}`).checked, active: $(`a-${uid}`).checked };
    try {
      await api(tp.id ? `/api/admin/templates/${encodeURIComponent(tp.id)}` : "/api/admin/templates", { method: tp.id ? "PUT" : "POST", body: JSON.stringify(body) });
      toast(tp.id ? "✓ Template saved" : "✓ Template added");
      state.draft = false;
      await loadTemplates(true);
      loadLog();
    } catch (err) { toast("⚠ " + err.message); }
  };
  d.querySelector("[data-cancel]")?.addEventListener("click", () => { state.draft = false; renderTypeEditor(); });
  d.querySelector("[data-del]")?.addEventListener("click", async () => {
    const using = tp.agents ? ` ${tp.agents} agent${tp.agents === 1 ? " uses" : "s use"} it and will go back to free conversation.` : "";
    if (!confirm(`Delete the template "${tp.name}"?${using}`)) return;
    try {
      await api(`/api/admin/templates/${encodeURIComponent(tp.id)}`, { method: "DELETE" });
      toast("✓ Template deleted");
      await loadTemplates(true);
      loadLog();
    } catch (err) { toast("⚠ " + err.message); }
  });
  return d;
}

$("newTplBtn").onclick = () => { state.draft = true; renderTypeEditor(); $("tplList").querySelector("input")?.focus(); };
$("newTypeBtn").onclick = async () => {
  const name = prompt("Name of the new agent type (e.g. School Office):");
  if (!name?.trim()) return;
  try {
    const t = await api("/api/admin/types", { method: "POST", body: JSON.stringify({ name: name.trim(), icon: "✨" }) });
    state.typeKey = t.key;
    toast("✓ Type added. Fill in its persona and greeting.");
    await loadTemplates(true);
    loadLog();
  } catch (err) { toast("⚠ " + err.message); }
};

// ---------- start ----------
(async () => {
  try {
    await loadMe();
    route();
    const [tt, pb] = await Promise.all([api("/api/templates").catch(() => ({})), api("/api/playbooks").catch(() => ({}))]);
    state.myAgentTypes = tt.types || {}; state.myPbTypes = pb.types || {};
    state.myLimits = { agentTypes: state.access?.agentTypes, playbookTypes: state.access?.playbookTypes };
    const can = (v) => mySections().includes(v);
    if (can("settings")) loadSettings().catch(() => {});
    if (can("activity")) loadLog().catch(() => {});
    if (can("logins")) loadLogins().catch(() => {});
    if (can("templates")) loadTemplates().catch((err) => ($("typeList").innerHTML = `<div class="empty">${esc(err.message)}</div>`));
    if (isSuper() && location.hash === "#server") loadServer().catch(() => {});
    await loadOverview();
  } catch (err) {
    $("users").innerHTML = `<tr><td colspan="10" class="empty">Couldn't load the dashboard: ${esc(err.message)}</td></tr>`;
  }
})();
