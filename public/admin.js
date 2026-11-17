// TelemuneSmartAi admin dashboard (role 1 only; the server refuses everyone else).
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const state = { me: null, users: [], viewing: null, callPage: 1 };

const _fetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await _fetch(...args);
  if (res.status === 401) location.href = "/login.html";
  if (res.status === 403 && String(args[0]).startsWith("/api/admin")) location.href = "/";
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
  const { user } = await api("/api/me");
  state.me = user;
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

// ---------- overview ----------
async function loadOverview() {
  const { totals: t, users } = await api("/api/admin/overview");
  state.users = users;
  const kpi = (k, v, s) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  $("kpis").innerHTML = [
    kpi("👥 Users", t.users, `${t.active} active · ${t.admins} admin${t.admins === 1 ? "" : "s"}`),
    kpi("📞 Calls", fmtNum(t.calls), `${fmtNum(t.turns)} turns`),
    kpi("⏱ Talk time", fmtDur(t.seconds), t.calls ? `avg ${fmtDur(t.seconds / t.calls)} / call` : "—"),
    kpi("🔢 Tokens", fmtNum(t.tokens), "chat + summaries"),
    kpi("⚡ Avg reply", fmtS(t.avgResponseMs), "time to voice"),
    kpi("📘 Playbooks", t.playbooks, `${t.events} calendar events`),
    kpi("🎙 Recordings", t.recordings, "saved"),
  ].join("");
  renderUsers();
}

function renderUsers() {
  const q = $("search").value.trim().toLowerCase();
  const list = state.users.filter((u) => !q || [u.name, u.username, u.agent.name, u.agent.llm, u.agent.playbook].join(" ").toLowerCase().includes(q));
  const box = $("users");
  if (!list.length) { box.innerHTML = `<div class="empty">${q ? "No users match your search." : "No users yet."}</div>`; return; }
  box.innerHTML = "";
  for (const u of list) {
    const me = u.id === state.me.id;
    const el = document.createElement("article");
    el.className = "ucard" + (u.disabled ? " off" : "");
    el.innerHTML = `
      <div class="u-top">
        <div class="av">${esc((u.name || u.username)[0].toUpperCase())}</div>
        <div><div class="u-name">${esc(u.name)}${me ? " (you)" : ""}</div><div class="u-handle">@${esc(u.username)}</div></div>
        <span class="badge ${u.disabled ? "off" : u.role === 1 ? "" : "user"}">${u.disabled ? "⛔ Disabled" : u.role === 1 ? "👑 Admin" : "👤 User"}</span>
      </div>
      <div class="agent-line">
        <span class="chip">🤖 ${esc(u.agent.name)}</span>
        <span class="chip">🧠 ${esc(u.agent.llm)}</span>
        <span class="chip">🌐 ${esc(LANG[u.agent.language] || u.agent.language)}</span>
        <span class="chip">📘 ${esc(u.agent.playbook || "Default")}</span>
        <span class="chip ${u.agent.calendar ? "on" : ""}">📅 ${u.agent.calendar ? "On" : "Off"}</span>
        <span class="chip ${u.agent.emergency ? "on" : ""}">🚨 ${u.agent.emergency ? `${u.agent.emergencyNumbers} numbers` : "Off"}</span>
      </div>
      <div class="u-stats">
        <div class="u-stat"><div class="k">Calls</div><div class="v">${fmtNum(u.stats.calls)}</div></div>
        <div class="u-stat"><div class="k">Time</div><div class="v">${fmtDur(u.stats.totalSeconds)}</div></div>
        <div class="u-stat"><div class="k">Tokens</div><div class="v">${fmtNum(u.stats.tokens.total)}</div></div>
        <div class="u-stat"><div class="k">Playbooks</div><div class="v">${u.playbooks.length}</div></div>
      </div>
      <div class="last">Last call: ${fmtDate(u.lastCallAt)} · Last sign-in: ${fmtDate(u.lastLoginAt)}</div>
      <div class="u-actions">
        <button class="btn btn-ghost" data-act="view">👁 View agent &amp; calls</button>
        <button class="btn btn-ghost" data-act="reset">🔑 Reset password</button>
        ${me ? "" : `<button class="btn btn-ghost" data-act="role">${u.role === 1 ? "Make user" : "Make admin"}</button>
        <button class="btn btn-ghost" data-act="toggle">${u.disabled ? "✅ Enable" : "⛔ Disable"}</button>
        <button class="btn btn-ghost danger" data-act="delete">🗑 Delete</button>`}
      </div>`;
    el.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => userAction(u, b.dataset.act)));
    box.appendChild(el);
  }
}
$("search").addEventListener("input", renderUsers);

async function userAction(u, act) {
  try {
    if (act === "view") return openUser(u.id);
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

// ---------- add user / reset password ----------
$("addUserBtn").onclick = () => { $("addForm").reset(); $("aPass").value = genPassword(); $("aErr").textContent = ""; openD("addDialog"); setTimeout(() => $("aName").focus(), 30); };
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
    const u = await api("/api/admin/users", { method: "POST", body: JSON.stringify({ name: $("aName").value, username: $("aUser").value, password: $("aPass").value, role: Number($("aRole").value) }) });
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
  const a = u.agent;
  $("udBody").innerHTML = `
    <div class="detail-grid">
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="box"><h4>🤖 Agent</h4><div class="kv">
          <span>Name</span><span>${esc(a.name)}</span>
          <span>Language</span><span>${esc(LANG[a.language] || a.language)}</span>
          <span>Voice</span><span>${esc(a.voice)}</span>
          <span>LLM</span><span class="ellipsis">${esc(a.llm)}</span>
          <span>STT</span><span class="ellipsis">${esc(a.stt)}</span>
          <span>TTS</span><span class="ellipsis">${esc(a.tts)}</span>
          <span>Playbook</span><span>${esc(a.playbook || "Default")}</span>
          <span>Calendar</span><span>${a.calendar ? `On · ${u.events} events` : "Off"}</span>
          <span>Emergency</span><span>${a.emergency ? `On · ${a.emergencyNumbers} numbers` : "Off"}</span>
        </div></div>
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
    b.innerHTML = `<div>${esc(c.playbook?.icon || "💬")}</div><div class="grow"><div class="t">${esc(c.playbook?.name || "Default agent")} · ${fmtDate(c.startedAt)}</div><div class="s ellipsis">${esc(outcome)}</div></div><div class="s">${esc(c.duration)}${c.recording ? " · 🎙" : ""}</div>`;
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

// ---------- start ----------
(async () => {
  try {
    await loadMe();
    await loadOverview();
  } catch (err) {
    $("users").innerHTML = `<div class="empty">Couldn't load the dashboard: ${esc(err.message)}</div>`;
  }
})();
