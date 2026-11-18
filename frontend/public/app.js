// TelemuneSmartAi front end.
// Browser speech recognition in → OpenAI chat (intent / mood / language / emotion tags) → OpenAI TTS out.

const LANGS = [
  ["en-US", "English (US)", "Hi! I'm {name}. How can I help you today?"],
  ["en-IN", "English (India)", "Hi! I'm {name}. How can I help you today?"],
  ["hi-IN", "हिन्दी (Hindi)", "नमस्ते! मैं {name} हूँ। मैं आपकी क्या मदद कर सकती हूँ?"],
  ["bn-IN", "বাংলা (Bengali)", "নমস্কার! আমি {name}। আমি কীভাবে সাহায্য করতে পারি?"],
  ["ta-IN", "தமிழ் (Tamil)", "வணக்கம்! நான் {name}. நான் எப்படி உதவலாம்?"],
  ["te-IN", "తెలుగు (Telugu)", "నమస్కారం! నేను {name}. నేను ఎలా సహాయం చేయగలను?"],
  ["mr-IN", "मराठी (Marathi)", "नमस्कार! मी {name}. मी तुम्हाला कशी मदत करू?"],
  ["gu-IN", "ગુજરાતી (Gujarati)", "નમસ્તે! હું {name}. હું તમારી કેવી રીતે મદદ કરી શકું?"],
  ["es-ES", "Español (Spanish)", "¡Hola! Soy {name}. ¿En qué te puedo ayudar?"],
  ["fr-FR", "Français (French)", "Bonjour ! Je suis {name}. Comment puis-je vous aider ?"],
  ["de-DE", "Deutsch (German)", "Hallo! Ich bin {name}. Wie kann ich helfen?"],
  ["pt-BR", "Português (Portuguese)", "Olá! Eu sou {name}. Como posso ajudar?"],
  ["ar-SA", "العربية (Arabic)", "مرحباً! أنا {name}. كيف يمكنني مساعدتك؟"],
  ["ja-JP", "日本語 (Japanese)", "こんにちは！{name}です。何をお手伝いしましょうか？"],
  ["zh-CN", "中文 (Mandarin)", "你好！我是{name}。有什么可以帮你的吗？"],
  ["en-JM", "Jamaican Patois 🇯🇲", "Wah gwaan! A {name} dis. How mi can help yuh today?"],
];

// Speech-recognition locale to try for each language, then fallbacks if the browser doesn't support it.
// Chrome has no Patois model, so Jamaican English is tried first, then plain English.
const SR_LANGS = { "en-JM": ["en-JM", "en-US"] };
const srLang = () => { const list = SR_LANGS[lang()] || [lang()]; return list[Math.min(state.srFallback || 0, list.length - 1)]; };

const EMOJI = {
  neutral: "🙂", happy: "😊", excited: "🤩", cheerful: "😄", calm: "😌", empathetic: "🤗", sad: "😢",
  apologetic: "🙏", encouraging: "💪", confident: "😎", serious: "🧐", curious: "🤔", surprised: "😮",
  thoughtful: "💭", concerned: "😟", reassuring: "🫶", grateful: "🙏", playful: "😜", urgent: "⚡", proud: "🥳",
  stressed: "😣", anxious: "😰", frustrated: "😤", angry: "😠", confused: "😕", tired: "😴", bored: "🥱",
  worried: "😟", lonely: "🥺", hopeful: "🤞", upset: "😞", overwhelmed: "😵", nervous: "😬", disappointed: "😔",
  relieved: "😮‍💨", impatient: "⏳", annoyed: "😒", satisfied: "😌",
};

// Avatar / visualizer colour for each emotion.
const EMO_COLOR = {
  neutral: "#8b5cf6", happy: "#f59e0b", excited: "#f97316", cheerful: "#eab308", calm: "#14b8a6", empathetic: "#ec4899",
  sad: "#6366f1", apologetic: "#a78bfa", encouraging: "#22c55e", confident: "#3b82f6", serious: "#64748b", curious: "#06b6d4",
  surprised: "#f43f5e", thoughtful: "#8b5cf6", concerned: "#f97316", reassuring: "#10b981", grateful: "#f472b6",
  playful: "#d946ef", urgent: "#ef4444", proud: "#eab308",
};

const $ = (id) => document.getElementById(id);

// Any API call that comes back "not signed in" (session expired, signed out elsewhere) goes to the login page.
const _fetch = window.fetch.bind(window);
// Every API call says which of the user's agents it is for (X-Agent-Id), so settings, chat, voice and saved calls
// all belong to the agent picked in "My agents".
window.fetch = async (...args) => {
  const url = String(args[0]?.url || args[0] || "");
  if (url.startsWith("/api/") && state.agentId) {
    const opts = { ...(args[1] || {}) };
    const headers = new Headers(opts.headers || {});
    if (!headers.has("X-Agent-Id")) headers.set("X-Agent-Id", state.agentId);
    opts.headers = headers;
    args[1] = opts;
  }
  const res = await _fetch(...args);
  if (res.status === 401 && url.startsWith("/api/")) location.href = "/login.html";
  return res;
};
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

// Settings from config.json via /api/config (these defaults apply until it loads).
const CONFIG = { responseDelayMs: 2000, hangupDelayMs: 800 };
const SETTINGS = { agent: { defaultName: "Aria", defaultLanguage: "en-US", defaultVoice: "marin" } };

const state = {
  inCall: false, muted: false, phase: "idle", // idle | listening | thinking | speaking
  history: [], speakQueue: [], streamDone: true, abort: null, recognition: null,
  timerId: null, startedAt: 0, audio: null, playing: false, speechGen: 0,
  micStream: null, ctx: null, recDest: null, analyser: null, recorder: null, recChunks: [],
  types: {}, saved: [], playbookId: "", voices: null, rules: [], savedSnapshot: "",
  turns: [], // per caller turn: { intent, mood, lang, firstText, firstVoice, total }
  emotion: "neutral",
  pendingCalendar: [], pendingMessages: [], utter: null, vadTimer: null, micAnalyser: null, srDisabled: false, pendingHangup: false, historyPage: 1,
  callTokens: { input: 0, output: 0, total: 0 },
  agents: [], agentId: "", agentTypes: {}, me: null,
};

// ---------- theme ----------
function currentTheme() {
  return document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
function paintThemeBtn() { $("themeBtn").textContent = currentTheme() === "dark" ? "☀️" : "🌙"; }
$("themeBtn").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  store.set("va-theme", next);
  paintThemeBtn();
});
paintThemeBtn();

// ---------- basic settings ----------
// Agent name, language, voice, playbook, models, calendar and emergency rules all come from config.json.
// Changes in the Agent setup panel apply to the next call straight away and are kept for good with 💾 Save agent.
for (const [code, label] of LANGS) $("lang").add(new Option(label, code));
const lang = () => $("lang").value;
const agentName = () => $("nameInput").value.trim() || SETTINGS.agent.defaultName;

function refreshName() {
  $("agentName").textContent = agentName();
  $("avatar").textContent = agentName()[0].toUpperCase();
  $("miniAvatar").textContent = agentName()[0].toUpperCase();
  renderSummary();
}

// ---------- main page: the agent for this call, basic information only (edit it under 🤖 My agents) ----------
function setDd(id, text) {
  $(id).textContent = text || "Not set";
  $(id).classList.toggle("none", !text);
}
function renderSummary() {
  if (!state.agents.length) return; // still starting up
  const a = SETTINGS.currentAgent || currentAgentCard() || {};
  const tpl = (typeOf(a.type).templates || []).find((t) => t.id === $("pTemplate").value);
  $("sIcon").textContent = a.icon || "✨";
  $("sName").textContent = agentName();
  $("sType").textContent = [a.typeName, tpl?.name].filter(Boolean).join(" · ");
  setDd("sOwner", $("pOwner").value.trim());
  setDd("sOrg", $("pOrg").value.trim());
  setDd("sAvail", availabilityText());
  const voice = ($("voice").selectedOptions[0]?.text || $("voice").value || "").split(" — ")[0];
  setDd("sLang", [$("lang").selectedOptions[0]?.text, voice].filter(Boolean).join(" · "));
  setDd("sModels", [$("llmSel").value || SETTINGS.models?.chat, $("sttSel").value === "browser" ? "browser captions" : $("sttSel").value || SETTINGS.models?.stt, $("ttsSel").value || SETTINGS.models?.tts].filter(Boolean).join(" · "));
  const feats = $("sFeats");
  feats.innerHTML = "";
  const feat = (text, cls, tab) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "feat" + (cls ? " " + cls : ""); b.textContent = text;
    b.onclick = () => (location.hash = `agents/${tab}`);
    feats.appendChild(b);
  };
  feat($("calToggle").checked ? "📅 Calendar on" : "📅 Calendar off", $("calToggle").checked ? "on" : "", "calendar");
  feat($("emgToggle").checked ? `🚨 Emergency on · ${state.rules.length}` : "🚨 Emergency off", $("emgToggle").checked ? "on" : "", "emergency");
}
$("nameInput").addEventListener("input", () => { refreshName(); markDirty(); });
refreshName();
$("lang").addEventListener("change", () => { state.srFallback = 0; markDirty(); });
$("voice").addEventListener("change", markDirty);

// Banner shown when the running server is older than the code on disk.
function showStaleServer() {
  if ($("staleBanner")) return;
  const b = document.createElement("div");
  b.id = "staleBanner";
  b.className = "stale-banner";
  b.setAttribute("role", "alert");
  b.innerHTML = `<b>⚠ The server is running an older version of the app.</b> Settings can't be saved until it restarts.
    Stop it (Ctrl+C in its terminal) and run <code>./runScript.sh</code>, then reload this page.`;
  document.body.prepend(b);
}

async function loadConfig() {
  const c = await fetch("/api/config").then((r) => r.json());
  setupUserMenu(c.me);
  if (c.stale || !c.settings?.calendar) showStaleServer();
  state.voices = c.voices;
  const cfg = c.settings || {};
  Object.assign(SETTINGS, cfg);
  Object.assign(CONFIG, cfg.conversation || {});
  applyBranding(cfg.branding || {});
  $("modelInfo").textContent = `${cfg.models.chat} · ${cfg.models.stt} · ${cfg.models.tts}`;
  if (!$("voice").options.length) for (const [id, label] of Object.entries(c.voices)) $("voice").add(new Option(label, id));
  return cfg;
}

// ---------- persona & greeting (template from the DB, plus who the agent works for) ----------
// Same rules as the backend: {agent} {owner} {org} are filled in; a [[ … ]] part is dropped when a value inside is empty.
function renderTpl(text, v) {
  const fb = { agent: "the assistant", owner: "the person you work for", org: "the company" };
  return String(text || "")
    .replace(/\[\[([\s\S]*?)\]\]/g, (_, inner) => ([...inner.matchAll(/\{(agent|owner|org)\}/g)].every((m) => v[m[1]]) ? inner : ""))
    .replace(/\{(agent|owner|org)\}/g, (_, k) => v[k] || fb[k])
    .replace(/[ \t]{2,}/g, " ").trim();
}
const personaAgent = () => SETTINGS.currentAgent || currentAgentCard() || {};
const typeOf = (key) => state.agentTypes?.[key] || {};

function showPreview(el, label, text) {
  el.textContent = "";
  if (!text) return;
  const b = document.createElement("b");
  b.textContent = label + " ";
  el.append(b, `“${text}”`);
}

function fillPersona() {
  const a = personaAgent();
  const type = typeOf(a.type);
  const tSel = $("pType");
  tSel.innerHTML = "";
  for (const [key, t] of Object.entries(state.agentTypes || {})) tSel.add(new Option(`${t.icon} ${t.name}`, key));
  if (a.type && !state.agentTypes?.[a.type]) tSel.add(new Option(`${a.icon || "✨"} ${a.typeName || a.type} (switched off)`, a.type));
  tSel.value = a.type || "";
  tSel.disabled = state.inCall;
  const sel = $("pTemplate");
  sel.innerHTML = "";
  sel.add(new Option("No template: free conversation", ""));
  for (const t of type.templates || []) sel.add(new Option(t.name + (t.isDefault ? " ★" : ""), t.id));
  if (a.templateId && ![...sel.options].some((o) => o.value === a.templateId)) sel.add(new Option(`${a.templateName || a.templateId} (switched off)`, a.templateId));
  sel.value = a.templateId || "";
  $("pOwner").value = a.ownerName || "";
  $("pOrg").value = a.organization || "";
  $("pDesc").value = a.description || "";
  $("pGreeting").value = a.greeting || "";
  fillAvailability(a);
  $("pOwnerLabel").innerHTML = type.needsOwner ? 'Works for <span class="req">*</span>' : "Works for";
  renderPersonaPreview();
}

function personaPayload() {
  return { templateId: $("pTemplate").value, ownerName: $("pOwner").value.trim(), organization: $("pOrg").value.trim(),
    description: $("pDesc").value.trim(), availability: availabilityText(), availabilityPlan: availabilityPlan(), greeting: $("pGreeting").value.trim() };
}

function renderPersonaPreview() {
  const a = personaAgent();
  const type = typeOf(a.type);
  const p = personaPayload();
  const tpl = (type.templates || []).find((t) => t.id === p.templateId);
  const v = { agent: agentName(), owner: p.ownerName, org: p.organization };
  $("pGreeting").placeholder = renderTpl(tpl?.greeting || type.greeting || "", v);
  const greet = p.greeting || tpl?.greeting || type.greeting || "";
  if (type.needsOwner && !p.ownerName && /\{owner\}/.test(greet)) $("pPreview").textContent = "⚠ Fill in Works for: the greeting and the script use that name.";
  else showPreview($("pPreview"), "First line:", renderTpl(greet, v));
  $("pTemplateHint").textContent = tpl ? `🎯 ${renderTpl(tpl.goal, v)}` : `${type.icon || "✨"} ${type.name || "Agent"}: no fixed script, it helps with whatever the caller needs.`;
  $("personaNote").textContent = p.ownerName ? `for ${p.ownerName}` : p.organization || "";
  $("personaNote").classList.toggle("on", !!(p.ownerName || p.organization));
}
$("pTemplate").addEventListener("change", () => { renderPersonaPreview(); markDirty(); });

// Change the agent's type (e.g. Personal Assistant → Call Assistant). Saved in MySQL straight away (PATCH /api/agents/:id):
// the type's pre-selected template comes with it, and the form reloads from the database.
$("pType").addEventListener("change", async () => {
  const cur = currentAgentCard();
  const key = $("pType").value;
  if (!cur || key === cur.type) return;
  const t = typeOf(key);
  const tpl = (t.templates || []).find((x) => x.isDefault);
  if (state.inCall || !confirm(`Change "${cur.name}" to ${t.name}?\nIts template becomes ${tpl ? `"${tpl.name}"` : "free conversation"}. Name, voice, models, availability and emergency contacts stay.`)) {
    $("pType").value = cur.type;
    return;
  }
  try {
    if (state.savedSnapshot && formSnapshot() !== state.savedSnapshot) { clearTimeout(state.saveTimer); await autoSave(); }
    setSaveStatus("Saving…");
    const updated = await agentRequest(`/api/agents/${cur.id}`, "PATCH", { type: key });
    Object.assign(cur, updated);
    state.savedSnapshot = "";
    await loadConfig();
    fillForm();
    renderAgents();
    setSaveStatus(`✓ Now a ${updated.typeName}`);
    clearTimeout(state.saveFade);
    state.saveFade = setTimeout(() => setSaveStatus(""), 2500);
    if (t.needsOwner && !$("pOwner").value.trim()) $("pOwner").focus();
  } catch (e) {
    $("pType").value = cur.type;
    setSaveStatus("⚠ " + e.message, "err");
  }
});
["pOwner", "pOrg", "pDesc", "pGreeting"].forEach((id) => $(id).addEventListener("input", () => { renderPersonaPreview(); renderAvailability(); markDirty(); }));

// ---------- availability: days + hours + time zone (the agent only offers meeting times inside them) ----------
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const av = { days: [] };
const localTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();
[...new Set([localTz, "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "Europe/Berlin",
  "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney", "UTC"])].forEach((z) => $("avTz").add(new Option(z.replace(/_/g, " "), z)));
DAY_NAMES.forEach((d, i) => {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = d; b.dataset.day = String(i + 1);
  b.onclick = () => { const n = i + 1; av.days = av.days.includes(n) ? av.days.filter((x) => x !== n) : [...av.days, n].sort(); renderAvailability(); markDirty(); };
  $("avDays").appendChild(b);
});
document.querySelectorAll("[data-days]").forEach((b) => (b.onclick = () => {
  av.days = b.dataset.days ? b.dataset.days.split(",").map(Number) : [];
  renderAvailability(); markDirty();
}));
["avFrom", "avTo", "avTz"].forEach((id) => $(id).addEventListener("change", () => { renderAvailability(); markDirty(); }));
$("avNote").addEventListener("input", () => { renderAvailability(); markDirty(); });
$("avClear").addEventListener("click", () => { av.days = []; $("avNote").value = ""; renderAvailability(); markDirty(); });

function dayRanges(days) {
  if (days.length === 7) return "Every day";
  const runs = [];
  for (const d of days) {
    const last = runs.at(-1);
    if (last && d === last[1] + 1) last[1] = d; else runs.push([d, d]);
  }
  return runs.map(([a, b]) => (b - a >= 2 ? `${DAY_NAMES[a - 1]}–${DAY_NAMES[b - 1]}` : a === b ? DAY_NAMES[a - 1] : `${DAY_NAMES[a - 1]}, ${DAY_NAMES[b - 1]}`)).join(", ");
}
const fmtClock = (hhmm) => { const [h, m] = String(hhmm || "0:0").split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
function availabilityPlan() {
  const note = $("avNote").value.trim();
  if (!av.days.length && !note) return null;
  return { days: av.days, from: $("avFrom").value || "09:00", to: $("avTo").value || "18:00", tz: $("avTz").value, note };
}
function availabilityText() {
  const p = availabilityPlan();
  if (!p) return "";
  const when = p.days.length ? `${dayRanges(p.days)}, ${fmtClock(p.from)}–${fmtClock(p.to)} (${p.tz.replace(/_/g, " ")})` : "";
  return [when, p.note].filter(Boolean).join(". ");
}
function fillAvailability(a) {
  const p = a.availabilityPlan;
  av.days = Array.isArray(p?.days) ? p.days.map(Number) : [];
  $("avFrom").value = p?.from || "09:00";
  $("avTo").value = p?.to || "18:00";
  if (p?.tz && ![...$("avTz").options].some((o) => o.value === p.tz)) $("avTz").add(new Option(p.tz, p.tz));
  $("avTz").value = p?.tz || localTz;
  $("avNote").value = p ? p.note || "" : a.availability || ""; // older agents only had a text
  renderAvailability();
}
function renderAvailability() {
  $("avDays").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(av.days.includes(Number(b.dataset.day)))));
  const owner = $("pOwner").value.trim();
  $("avWho").textContent = owner || "the owner";
  const text = availabilityText();
  showPreview($("avPreview"), `${owner || "Available"}:`, text);
  if (!text) $("avPreview").textContent = "No availability set: the agent asks the caller for a time and takes it as a request.";
  $("availNote").textContent = text ? "Set" : "";
  $("availNote").className = "sec-note" + (text ? " on" : "");
}
$("nameInput").addEventListener("input", () => renderPersonaPreview());

// Put the saved configuration into the form.
function fillForm() {
  const a = SETTINGS.agent || {};
  $("nameInput").value = a.defaultName || "Aria";
  refreshName();
  if (a.defaultLanguage) $("lang").value = a.defaultLanguage;
  if (a.defaultVoice && state.voices?.[a.defaultVoice]) $("voice").value = a.defaultVoice;
  state.playbookId = state.saved.some((p) => p.id === a.defaultPlaybookId) ? a.defaultPlaybookId : "";
  renderPlaybooks();
  setSelect($("llmSel"), SETTINGS.models.chat);
  setSelect($("ttsSel"), SETTINGS.models.tts);
  setSelect($("sttSel"), SETTINGS.speechToText?.engine === "browser" ? "browser" : SETTINGS.models.sttModel);
  $("calToggle").checked = !!SETTINGS.calendar?.enabled;
  const len = String(SETTINGS.calendar?.defaultDurationMin || 30);
  if (![...$("calLen").options].some((o) => o.value === len)) $("calLen").add(new Option(`${len} minutes`, len));
  $("calLen").value = len;
  $("emgToggle").checked = !!SETTINGS.emergency?.enabled;
  state.rules = structuredClone(SETTINGS.emergency?.rules || []);
  renderRules();
  fillPersona();
  state.savedSnapshot = formSnapshot();
  $("calendarCard").hidden = !SETTINGS.calendar?.enabled;
  renderNotes();
  renderSummary();
}

const warnings = [];
if (!SR && !window.MediaRecorder) warnings.push("This browser can't capture speech. Use Chrome or Edge for voice, or type messages below.");
if (!window.isSecureContext) warnings.push("The microphone needs https or localhost. Open this page at http://localhost.");
if (warnings.length) { $("warn").style.display = "block"; $("warn").textContent = warnings.join(" "); }

function applyBranding(b) {
  const t = b.theme || {};
  const root = document.documentElement.style;
  if (t.primary) root.setProperty("--c1", t.primary);
  if (t.secondary) root.setProperty("--c2", t.secondary);
  if (t.tertiary) root.setProperty("--c3", t.tertiary);
  if (b.appName) { document.title = b.appName; $("brandName").textContent = b.appName; }
  if (b.tagline) $("brandTagline").textContent = b.tagline;
  if (b.footer) $("brandFooter").textContent = b.footer;
  if (b.logo) $("brandLogo").style.setProperty("--logo-url", `url("${b.logo}")`);
  if (b.favicon) document.querySelector('link[rel="icon"]')?.setAttribute("href", b.favicon);
}

// ---------- playbooks: list, select, remove ----------
$("pbPick").addEventListener("change", () => { state.playbookId = $("pbPick").value; renderPlaybooks(); markDirty(); });

async function loadPlaybooks() {
  const data = await fetch("/api/playbooks").then((r) => r.json());
  state.types = data.types;
  state.saved = data.saved;
  if (state.playbookId && !state.saved.some((p) => p.id === state.playbookId)) state.playbookId = "";
  renderPlaybooks();
}

const activePlaybook = () => state.saved.find((p) => p.id === state.playbookId) || null;

function renderPlaybooks() {
  const pick = $("pbPick");
  pick.innerHTML = "";
  pick.add(new Option("Default: the agent's template", ""));
  for (const pb of state.saved) pick.add(new Option(`${state.types[pb.type]?.icon || "📘"} ${pb.name}`, pb.id));
  pick.value = state.playbookId;
  pick.disabled = state.inCall;
  const list = $("pbList");
  list.innerHTML = "";
  // Default shows only while no playbook is selected. Click the selected playbook again to go back to default.
  const items = state.playbookId ? state.saved : [{ id: "", name: "Default (no playbook)", type: null }, ...state.saved];
  for (const pb of items) {
    const t = pb.type ? state.types[pb.type] : null;
    const row = document.createElement("div");
    row.className = "pb-item" + (pb.id === state.playbookId ? " selected" : "") + (state.inCall ? " disabled" : "");
    row.innerHTML = `<div class="pb-icon"></div><div class="pb-text"><div class="pb-name"></div><div class="pb-type"></div></div>`;
    row.querySelector(".pb-icon").textContent = t ? t.icon : "💬";
    row.querySelector(".pb-name").textContent = pb.name;
    row.querySelector(".pb-type").textContent = t ? `${t.name} · ${pb.goal}` : "General helpful agent, no script";
    if (pb.id && pb.id === state.playbookId) row.title = "Selected · click again to switch back to the default agent";
    row.addEventListener("click", () => {
      if (state.inCall) return;
      state.playbookId = pb.id && pb.id === state.playbookId ? "" : pb.id;
      renderPlaybooks();
      markDirty();
    });
    if (pb.id) {
      const rm = document.createElement("button");
      rm.className = "pb-remove"; rm.title = "Remove playbook"; rm.textContent = "🗑";
      rm.setAttribute("aria-label", `Remove ${pb.name}`);
      rm.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (state.inCall || !confirm(`Remove the "${pb.name}" playbook?`)) return;
        await fetch(`/api/playbooks/${pb.id}`, { method: "DELETE" });
        if (state.playbookId === pb.id) { state.playbookId = ""; markDirty(); }
        await loadPlaybooks();
      });
      row.appendChild(rm);
    }
    list.appendChild(row);
  }
}

// ---------- add-playbook dialog: type → template or custom → edit & save ----------
const dlg = { step: "types", type: null };

function openDialog() { dlg.step = "types"; dlg.type = null; renderDialog(); $("pbDialog").classList.add("open"); }
function closeDialog() { $("pbDialog").classList.remove("open"); }
$("addPbBtn").addEventListener("click", openDialog);
$("dlgClose").addEventListener("click", closeDialog);
$("pbDialog").addEventListener("click", (e) => { if (e.target === $("pbDialog")) closeDialog(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDialog(); });
$("dlgBack").addEventListener("click", () => {
  dlg.step = dlg.step === "form" && dlg.type !== "other" ? "templates" : "types";
  renderDialog();
});

function tile(icon, name, desc, onClick, extraClass = "") {
  const b = document.createElement("button");
  b.type = "button"; b.className = "tile " + extraClass;
  b.innerHTML = `<div class="t-icon"></div><div class="t-name"></div><div class="t-desc"></div>`;
  b.querySelector(".t-icon").textContent = icon;
  b.querySelector(".t-name").textContent = name;
  b.querySelector(".t-desc").textContent = desc;
  b.addEventListener("click", onClick);
  return b;
}

function renderDialog() {
  const body = $("dlgBody");
  body.innerHTML = "";
  $("dlgBack").style.visibility = dlg.step === "types" ? "hidden" : "visible";

  if (dlg.step === "types") {
    $("dlgTitle").textContent = "Add a playbook";
    body.insertAdjacentHTML("beforeend", `<p class="lead">What type of agent is this? Pick one to see ready-made playbooks, or choose Other to write your own.</p>`);
    const grid = document.createElement("div"); grid.className = "grid";
    for (const [id, t] of Object.entries(state.types)) {
      grid.appendChild(tile(t.icon, t.name, t.description, () => {
        dlg.type = id;
        if (t.templates.length) { dlg.step = "templates"; renderDialog(); } else openForm(null);
      }));
    }
    body.appendChild(grid);
  }

  if (dlg.step === "templates") {
    const t = state.types[dlg.type];
    $("dlgTitle").textContent = `${t.icon} ${t.name}`;
    body.insertAdjacentHTML("beforeend", `<p class="lead">Pick a ready-made playbook (you can edit it before saving), or write a custom one.</p>`);
    const grid = document.createElement("div"); grid.className = "grid";
    for (const tpl of t.templates) grid.appendChild(tile("📘", tpl.name, tpl.goal, () => openForm(tpl)));
    grid.appendChild(tile("✏️", "Custom", `Write your own ${t.name.toLowerCase()} playbook from scratch.`, () => openForm(null), "custom"));
    body.appendChild(grid);
  }

  if (dlg.step === "form") {
    const t = state.types[dlg.type];
    const tpl = dlg.template;
    $("dlgTitle").textContent = tpl ? `${t.icon} ${tpl.name}` : `${t.icon} Custom ${t.name === "Other / Custom" ? "agent" : t.name}`;
    const form = document.createElement("form");
    form.innerHTML = `
      <label for="f-name">Playbook name</label><input type="text" id="f-name" maxlength="60" required />
      <label for="f-role">Agent role (who it is)</label><input type="text" id="f-role" maxlength="200" />
      <label for="f-goal">Goal (what the call should achieve)</label><input type="text" id="f-goal" maxlength="400" required />
      <label for="f-steps">Call steps (one per line)</label><textarea id="f-steps"></textarea>
      <label for="f-rules">Rules (one per line, optional)</label><textarea id="f-rules" style="min-height:60px"></textarea>
      <label for="f-summary">Summary should capture (optional)</label><input type="text" id="f-summary" maxlength="300" />
      <div class="form-error" id="f-error"></div>
      <div class="form-actions"><button type="button" class="btn btn-ghost" id="f-cancel">Cancel</button><button type="submit" class="btn btn-primary">Save playbook</button></div>`;
    body.appendChild(form);
    $("f-name").value = tpl?.name || "";
    $("f-role").value = t.role;
    $("f-goal").value = tpl?.goal || "";
    $("f-steps").value = (tpl?.steps || []).join("\n");
    $("f-rules").value = (tpl?.rules || []).join("\n");
    $("f-summary").value = tpl?.summary || "";
    $("f-steps").placeholder = "Greet and ask what they need\nCollect name and phone number\nConfirm details back";
    $("f-cancel").addEventListener("click", closeDialog);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        type: dlg.type, name: $("f-name").value, role: $("f-role").value, goal: $("f-goal").value,
        steps: $("f-steps").value, rules: $("f-rules").value, summary: $("f-summary").value,
      };
      const res = await fetch("/api/playbooks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) { $("f-error").textContent = data.error || "Couldn't save."; return; }
      state.playbookId = data.id;
      markDirty();
      closeDialog();
      await loadPlaybooks();
    });
    setTimeout(() => (tpl ? $("f-goal") : $("f-name")).focus(), 30);
  }
}

function openForm(template) { dlg.step = "form"; dlg.template = template; renderDialog(); }

// ---------- UI helpers ----------
function setPhase(phase, text) {
  state.phase = phase;
  const labels = { idle: "Ready to call", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…" };
  $("status").textContent = text || (state.muted && phase === "listening" ? "Muted" : labels[phase]);
  if (phase !== "speaking") setEmotion(null);
}

function setEmotion(emotion) {
  state.emotion = emotion || "neutral";
  $("avatar").style.setProperty("--emo", EMO_COLOR[emotion] || EMO_COLOR.neutral);
  $("emoBadge").textContent = emotion ? EMOJI[emotion] || "🙂" : "";
  $("emoBadge").classList.toggle("show", !!emotion);
}

function addMsg(role, text) {
  $("empty")?.remove();
  const el = document.createElement("div");
  el.className = "msg " + role;
  el.appendChild(document.createTextNode(text));
  if (role !== "error") {
    el.insertAdjacentHTML("beforeend", `<div class="chips"></div><div class="timing"></div><div class="meta"></div>`);
    el.querySelector(".meta").textContent = (role === "user" ? "You" : agentName()) + " · " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  $("msgs").appendChild(el);
  scrollDown();
  return el;
}

function scrollDown() { $("msgs").scrollTop = $("msgs").scrollHeight; }
function setMsgText(el, text) { el.firstChild.nodeValue = text; scrollDown(); }

function addChip(el, text, key = text) {
  const chips = el?.querySelector(".chips");
  if (!chips || chips.querySelector(`[data-k="${CSS.escape(key)}"]`)) return;
  const c = document.createElement("span");
  c.className = "chip"; c.dataset.k = key; c.textContent = text;
  chips.appendChild(c);
}

function addDivider(text) {
  $("empty")?.remove();
  const d = document.createElement("div");
  d.className = "divider"; d.textContent = text;
  $("msgs").appendChild(d);
  scrollDown();
}

const fmtS = (ms) => (ms == null ? "—" : (ms / 1000).toFixed(1) + "s");

function updateInsights() {
  const t = state.turns.filter((x) => !x.hidden);
  const last = t.at(-1);
  $("stIntent").textContent = last?.intent || "—";
  $("stIntent").title = last?.intent || "";
  $("stMood").textContent = last?.mood ? `${EMOJI[last.mood] || ""} ${last.mood}` : "—";
  $("stLang").textContent = last?.lang || "—";
  const times = t.map((x) => x.firstVoice ?? x.firstText).filter((x) => x != null);
  $("stTime").textContent = times.length ? fmtS(times.reduce((a, b) => a + b, 0) / times.length) : "—";
  $("stTurns").textContent = t.length;
  const ml = $("metaLine");
  ml.innerHTML = "";
  if (last?.mood) ml.insertAdjacentHTML("beforeend", `<span>Mood <b></b></span>`), (ml.lastChild.querySelector("b").textContent = `${last.mood} ${EMOJI[last.mood] || ""}`);
  if (last?.intent) ml.insertAdjacentHTML("beforeend", `<span>Intent <b></b></span>`), (ml.lastChild.querySelector("b").textContent = last.intent);
}

function tickTimer() {
  const s = Math.floor((Date.now() - state.startedAt) / 1000);
  $("status").dataset.time = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  if (state.inCall && state.phase === "listening") $("status").textContent = `${state.muted ? "Muted" : "Listening…"} · ${$("status").dataset.time}`;
}

// Strip <intent:..><mood:..><lang:..> and [emotion] tags (also half-streamed ones) for display and speech.
const stripTags = (t) => t.replace(/<[a-z]+:[^>]*>/gi, "").replace(/<[^>]*$/, "").replace(/\[[a-z]*\]?/gi, "").replace(/\s{2,}/g, " ").trimStart();

// ---------- speech output (OpenAI TTS, one request per sentence, fetched ahead) ----------
async function fetchSpeech(text, emotion) {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, emotion, voice: $("voice").value, lang: lang() }),
  });
  if (!res.ok) throw new Error(await res.text());
  return URL.createObjectURL(await res.blob());
}

function enqueueSpeech(text, emotion = "neutral", turn = null) {
  text = text.trim();
  if (!text || !/[\p{L}\p{N}]/u.test(text)) return;
  const item = { text, emotion, turn, url: fetchSpeech(text, emotion).catch((e) => { console.warn("TTS failed:", e); return null; }) };
  state.speakQueue.push(item);
  if (!state.playing) speakNext();
}

async function speakNext() {
  if (!state.inCall) { state.playing = false; return; }
  const item = state.speakQueue.shift();
  if (!item) {
    state.playing = false;
    if (state.streamDone) afterAgentTurn();
    return;
  }
  const gen = state.speechGen;
  state.playing = true;
  setPhase("speaking", `Speaking · ${item.emotion}`);
  setEmotion(item.emotion);
  const url = await item.url;
  if (gen !== state.speechGen) { if (url) URL.revokeObjectURL(url); return; }
  markVoiceStart(item.turn);
  if (!url) return fallbackSpeak(item, gen);
  const audio = new Audio(url);
  state.audio = audio;
  routeToMixer(audio);
  const done = () => { URL.revokeObjectURL(url); if (gen === state.speechGen) speakNext(); };
  audio.onended = done;
  audio.onerror = done;
  audio.play().catch(done);
}

// Agent finished talking: hang up if the caller said goodbye, otherwise listen again.
function afterAgentTurn() {
  if (!state.inCall) return;
  if (state.pendingHangup) {
    setPhase("idle", "Ending call…");
    setTimeout(() => endCall("caller said goodbye"), CONFIG.hangupDelayMs);
    return;
  }
  startListening();
}

function markVoiceStart(turn) {
  if (!turn || turn.firstVoice != null) return;
  turn.firstVoice = Math.round(performance.now() - turn.t0);
  renderTiming(turn);
  updateInsights();
}

// If OpenAI TTS fails, read the sentence with the browser's voice so the call keeps going.
function fallbackSpeak(item, gen) {
  if (!window.speechSynthesis) return speakNext();
  const u = new SpeechSynthesisUtterance(item.text);
  u.lang = lang();
  u.onend = u.onerror = () => { if (gen === state.speechGen) speakNext(); };
  speechSynthesis.speak(u);
}

function stopSpeaking() {
  state.speechGen++;
  for (const item of state.speakQueue) item.url.then((u) => u && URL.revokeObjectURL(u));
  state.speakQueue = [];
  if (state.audio) { state.audio.pause(); state.audio = null; }
  window.speechSynthesis?.cancel();
  state.playing = false;
}

$("previewBtn").addEventListener("click", async () => {
  const btn = $("previewBtn");
  btn.disabled = true; btn.textContent = "…";
  try {
    const greeting = LANGS.find((l) => l[0] === lang())[2].replace("{name}", agentName());
    const url = await fetchSpeech(greeting, "cheerful");
    const a = new Audio(url);
    a.onended = () => URL.revokeObjectURL(url);
    await a.play();
  } catch (e) {
    addMsg("error", "Voice preview failed: " + e.message);
  } finally {
    btn.disabled = false; btn.textContent = "▶";
  }
});

// ---------- speech input ----------
// How listening works (fixes missed words and lets the transcript correct itself):
// 1. While listening, the mic is recorded (MediaRecorder) from the very first moment, and its loudness is
//    watched (voice activity detection). Browser speech recognition runs alongside only to show live words.
// 2. When the caller has been quiet for responseDelayMs after speaking, the whole recording goes to OpenAI
//    speech-to-text, which hears far more accurately. The live bubble is then replaced with the corrected text.
// 3. If OpenAI STT is switched off in config.json or fails, the browser's own text is used.
const sttOn = () => (SETTINGS.speechToText?.engine || "openai") === "openai" && !!window.MediaRecorder && !!state.micStream;
const now = () => performance.now();

function makeRecognition() {
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;
  r.lang = srLang();
  // Chrome ends recognition sessions on its own now and then; keep what earlier sessions heard.
  r.onstart = () => { if (state.utter) state.utter.srBase = state.utter.srText; };
  r.onresult = (e) => {
    const u = state.utter;
    if (!u || u.committing || state.phase !== "listening") return;
    let session = "";
    for (let i = 0; i < e.results.length; i++) session += e.results[i][0].transcript;
    u.srText = `${u.srBase} ${session}`.replace(/\s+/g, " ").trim();
    u.lastVoiceAt = now();
    showLive(u.srText);
  };
  r.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      if (sttOn()) { state.srDisabled = true; return; } // live captions off, OpenAI STT still hears everything
      addMsg("error", "Microphone access was blocked. Allow the mic for this site and try again.");
      endCall("microphone blocked");
    } else if (e.error === "network") {
      if (!sttOn()) addMsg("error", "Speech recognition needs an internet connection (Chrome sends audio to its speech service).");
    } else if (e.error === "language-not-supported") {
      const list = SR_LANGS[lang()] || [lang()];
      if ((state.srFallback || 0) < list.length - 1) {
        state.srFallback = (state.srFallback || 0) + 1; // try the next locale; onend restarts it
      } else {
        state.srDisabled = true;
        if (!sttOn()) addMsg("error", "This browser can't recognise speech in the selected language. Try another language or type below.");
      }
    }
  };
  // Restart straight away so no words are lost between sessions.
  r.onend = () => { if (state.inCall && state.phase === "listening" && !state.muted && !state.srDisabled) safeStart(); };
  return r;
}

function safeStart() {
  if (!state.recognition || state.srDisabled) return;
  try { state.recognition.lang = srLang(); state.recognition.start(); } catch { /* already running */ }
}

function showLive(text) {
  const u = state.utter;
  if (!u || !text) return;
  $("interim").textContent = text;
  if (!u.bubble) { u.bubble = addMsg("user", text); u.bubble.classList.add("live"); }
  else setMsgText(u.bubble, text);
}

function micLevel() {
  const a = state.micAnalyser;
  if (!a) return 0;
  const buf = state.micBuf || (state.micBuf = new Float32Array(a.fftSize));
  a.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

function startUtterance() {
  const u = { startedAt: now(), speechMs: 0, lastVoiceAt: 0, srText: "", srBase: "", chunks: [], bubble: null, recorder: null, committing: false };
  if (sttOn()) {
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
    try {
      u.recorder = new MediaRecorder(state.micStream, type ? { mimeType: type } : undefined);
      u.recorder.ondataavailable = (e) => e.data.size && u.chunks.push(e.data);
      u.recorder.start(250);
    } catch (e) { console.warn("Mic recorder unavailable:", e); u.recorder = null; }
  }
  state.utter = u;
}

function stopRecorder(u) {
  return new Promise((resolve) => {
    const r = u?.recorder;
    if (!r || r.state === "inactive") return resolve(u?.chunks?.length ? new Blob(u.chunks, { type: r?.mimeType }) : null);
    r.onstop = () => resolve(u.chunks.length ? new Blob(u.chunks, { type: r.mimeType }) : null);
    r.stop();
  });
}

function vadTick() {
  const u = state.utter;
  if (!u || u.committing || state.phase !== "listening" || state.muted) return;
  const t = now();
  const stt = SETTINGS.speechToText || {};
  if (micLevel() > (stt.vadThreshold ?? 0.015)) { u.speechMs += 50; u.lastVoiceAt = t; }
  const spoke = u.speechMs >= (stt.minSpeechMs ?? 250) || !!u.srText;
  if (spoke && u.lastVoiceAt && t - u.lastVoiceAt >= CONFIG.responseDelayMs) return commitUtterance();
  if (t - u.startedAt > (stt.maxUtteranceSeconds ?? 60) * 1000) {
    if (spoke) return commitUtterance();
    stopRecorder(u); startUtterance(); // long silence: start a fresh recording so it stays small
  }
}

function startListening() {
  if (!state.inCall) return;
  setPhase("listening");
  if (state.muted) return;
  startUtterance();
  safeStart();
  clearInterval(state.vadTimer);
  state.vadTimer = setInterval(vadTick, 50);
}

// Stop listening and throw away anything not yet sent.
function stopListening() {
  clearInterval(state.vadTimer);
  state.vadTimer = null;
  if (state.recognition) { try { state.recognition.abort(); } catch {} }
  const u = state.utter;
  state.utter = null;
  if (u && !u.committing) {
    if (u.recorder && u.recorder.state !== "inactive") { try { u.recorder.stop(); } catch {} }
    u.bubble?.remove();
  }
  $("interim").textContent = "";
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function transcribe(blob) {
  const lastAgent = [...state.history].reverse().find((m) => m.role === "assistant");
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio: await blobToBase64(blob), mime: blob.type, lang: lang(), context: lastAgent ? stripTags(lastAgent.content) : "" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Transcription failed");
  return data.text;
}

// The caller finished speaking: get the accurate text, correct the live bubble, and reply.
async function commitUtterance() {
  const u = state.utter;
  if (!u || u.committing) return;
  u.committing = true;
  state.utter = null;
  clearInterval(state.vadTimer);
  if (state.recognition) { try { state.recognition.abort(); } catch {} }
  setPhase("thinking", "Got it…");
  $("interim").textContent = "";
  const t0 = now();
  if (!u.bubble) { u.bubble = addMsg("user", "…"); u.bubble.classList.add("live"); }

  let text = u.srText, sttMs = null, corrected = false;
  const blob = await stopRecorder(u);
  if (blob && sttOn()) {
    try {
      const heard = await transcribe(blob);
      sttMs = Math.round(now() - t0);
      if (heard) { corrected = !!u.srText && heard.trim().toLowerCase() !== u.srText.trim().toLowerCase(); text = heard; }
    } catch (e) {
      console.warn("OpenAI transcription failed, using browser text:", e);
    }
  }
  text = (text || "").trim();
  if (!state.inCall) { u.bubble.remove(); return; }
  if (!text || !/[\p{L}\p{N}]/u.test(text)) { u.bubble.remove(); startListening(); return; } // just noise
  setMsgText(u.bubble, text);
  u.bubble.classList.remove("live");
  if (corrected) { addChip(u.bubble, "✏️ corrected", "corrected"); u.bubble.querySelector('[data-k="corrected"]').title = `Live captions heard: "${u.srText}"`; }
  if (sttMs != null) u.bubble.querySelector(".timing").textContent = `🎙 transcribed in ${fmtS(sttMs)}`;
  sendUserText(text, { bubble: u.bubble, t0 });
}

// ---------- talking to the backend ----------
const SENTENCE_END = /([.!?।॥。！？؟\n])\s*/;

function renderTiming(turn) {
  if (!turn.bubble) return;
  const parts = [`first words ${fmtS(turn.firstText)}`];
  if (turn.firstVoice != null) parts.push(`voice ${fmtS(turn.firstVoice)}`);
  if (turn.total != null) parts.push(`full reply ${fmtS(turn.total)}`);
  turn.bubble.querySelector(".timing").textContent = "⏱ " + parts.join(" · ");
}

async function sendUserText(text, { hidden = false, bubble = null, t0 = null } = {}) {
  stopListening();
  stopSpeaking();
  if (state.abort) state.abort.abort();

  const userBubble = hidden ? null : bubble || addMsg("user", text);
  state.history.push({ role: "user", content: text });
  setPhase("thinking");

  const emergency = hidden ? null : detectEmergency(text);
  if (emergency) showEmergency(emergency);
  state.pendingCalendar = [];
  state.pendingMessages = [];
  const turn = { t0: t0 ?? performance.now(), hidden, emergency, bubble: null, firstText: null, firstVoice: null, total: null };
  state.turns.push(turn);
  const controller = new AbortController();
  state.abort = controller;
  state.streamDone = false;
  let raw = "", pending = "", emotion = "neutral";

  // Pull <intent:..><mood:..><lang:..> out of the stream as soon as each is complete.
  const readMeta = () => {
    pending = pending.replace(/<(intent|mood|lang|user|hangup|calendar|message):([^>]*)>/gi, (_, k, v) => {
      k = k.toLowerCase() === "user" ? "mood" : k.toLowerCase();
      if (k === "calendar") {
        if (!hidden && SETTINGS.calendar?.enabled) state.pendingCalendar.push(v);
        return "";
      }
      if (k === "message") {
        if (!hidden) state.pendingMessages.push(v);
        return "";
      }
      if (k === "hangup") {
        if (/^y/i.test(v.trim()) && !hidden) { turn.hangup = true; state.pendingHangup = state.inCall; }
        return "";
      }
      v = v.trim();
      if (k === "mood") v = v.toLowerCase();
      turn[k] = v;
      if (userBubble) {
        if (k === "intent") addChip(userBubble, `${/^end call/i.test(v) ? "📴" : "🎯"} ${v}`, "intent");
        if (k === "mood") addChip(userBubble, `${EMOJI[v] || "💬"} ${v}`, "mood");
        if (k === "lang") addChip(userBubble, `🌐 ${v}`, "lang");
      }
      updateInsights();
      return "";
    });
  };

  // Speak one finished sentence in the emotion tagged in front of it.
  const flushSentence = (chunk) => {
    const tags = [...chunk.matchAll(/\[([a-z]+)\]/gi)];
    if (tags.length) emotion = tags.at(-1)[1].toLowerCase();
    const clean = stripTags(chunk).trim();
    if (!clean) return;
    addChip(turn.bubble, `${EMOJI[emotion] || "•"} ${emotion}`, emotion);
    if (state.inCall) enqueueSpeech(clean, emotion, turn);
  };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: state.history, lang: lang(), assistantName: agentName(), playbookId: state.playbookId,
        emergency: emergency ? { label: emergency.label, number: emergency.number } : null,
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(await res.text() || "Request failed");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const ev = /^event: (.*)$/m.exec(block)?.[1];
        const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] || "{}");
        if (ev === "error") throw new Error(data.message);
        if (ev === "usage") { addTokens(data); turn.tokens = data; continue; }
        if (ev !== "delta") continue;

        raw += data.text; pending += data.text;
        readMeta();
        const shown = stripTags(raw);
        if (shown.trim()) {
          if (!turn.bubble) {
            turn.bubble = addMsg("assistant", shown);
            turn.firstText = Math.round(performance.now() - turn.t0);
            renderTiming(turn);
            updateInsights();
          } else setMsgText(turn.bubble, shown);
        }
        if (/<[^>]*$/.test(pending)) continue; // wait until a tag is complete before splitting sentences
        let m;
        while ((m = SENTENCE_END.exec(pending))) {
          const cut = m.index + m[0].length;
          flushSentence(pending.slice(0, cut));
          pending = pending.slice(cut);
        }
      }
    }
    readMeta();
    flushSentence(pending);
    turn.total = Math.round(performance.now() - turn.t0);
    renderTiming(turn);
    for (const v of state.pendingCalendar.splice(0)) addCalendarEvent(v, turn);
    for (const v of state.pendingMessages.splice(0)) saveCallerMessage(v, turn);
    if (raw.trim()) state.history.push({ role: "assistant", content: raw.trim() });
  } catch (err) {
    if (err.name === "AbortError") {
      if (raw.trim()) state.history.push({ role: "assistant", content: raw.trim() + " …" });
      return;
    }
    if (state.history.at(-1)?.role === "user") state.history.pop();
    state.turns.pop();
    addMsg("error", err.message || "Something went wrong.");
  } finally {
    if (state.abort === controller) {
      state.abort = null;
      state.streamDone = true;
      if (state.inCall && !state.playing && !state.speakQueue.length && state.phase !== "listening") afterAgentTurn();
      if (!state.inCall) setPhase("idle");
    }
    updateInsights();
  }
}

function addTokens(u) {
  if (!u) return;
  state.callTokens.input += u.input || 0;
  state.callTokens.output += u.output || 0;
  state.callTokens.total += u.total || 0;
}

// ---------- call controls ----------
async function startCall() {
  try {
    state.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    addMsg("error", "Microphone permission is needed for the call. You can still type messages.");
    return;
  }
  state.srDisabled = !SR;
  state.recognition = SR ? makeRecognition() : null;
  setupMixer();
  clearChat();
  state.pendingHangup = false;
  state.srFallback = 0;
  state.inCall = true; renderAgents();
  state.muted = false;
  state.history = [];
  state.turns = [];
  state.callTokens = { input: 0, output: 0, total: 0 };
  state.callStartedAt = new Date();
  updateInsights();
  $("muteBtn").disabled = false; $("muteBtn").classList.remove("active");
  $("recBtn").disabled = !state.recDest;
  $("lang").disabled = true; $("addPbBtn").disabled = true;
  $("callBtn").className = "btn btn-end";
  $("callBtn").querySelector("span").textContent = "End call";
  state.startedAt = Date.now(); tickTimer();
  state.timerId = setInterval(tickTimer, 1000);
  renderPlaybooks();
  const pb = activePlaybook();
  addDivider(`📞 Call started · ${pb ? pb.name : "Default agent"} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  // The agent greets first, in the selected language and playbook.
  sendUserText("[call connected]", { hidden: true });
}

async function endCall(endedBy = "ended by you") {
  if (!state.inCall) return;
  state.inCall = false; renderAgents();
  state.pendingHangup = false;
  if (state.abort) state.abort.abort();
  stopSpeaking();
  stopListening();
  clearInterval(state.timerId);
  const duration = $("status").dataset.time || "00:00";
  $("muteBtn").disabled = true; $("muteBtn").classList.remove("active");
  $("lang").disabled = false; $("addPbBtn").disabled = false;
  $("callBtn").className = "btn btn-call";
  $("callBtn").querySelector("span").textContent = "Start call";
  setPhase("idle", "Call ended");
  renderPlaybooks();
  const recording = await stopRecording();
  teardownMixer();
  addDivider(`Call ended · ${duration} · ${endedBy}`);
  summarizeCall(duration, recording, endedBy);
}

// ---------- call summary ----------
async function summarizeCall(duration, recording, endedBy) {
  const turns = state.history.filter((m) => m.content !== "[call connected]");
  const callerTurns = state.turns.filter((t) => !t.hidden);
  const pb = activePlaybook();
  const times = callerTurns.map((t) => t.firstVoice ?? t.firstText).filter((x) => x != null);
  const avg = times.length ? fmtS(times.reduce((a, b) => a + b, 0) / times.length) : "—";
  const langs = [...new Set(callerTurns.map((t) => t.lang).filter(Boolean))].join(", ") || "—";
  const moods = callerTurns.map((t) => t.mood).filter(Boolean);
  const moodPath = moods.length ? [...new Set([moods[0], moods.at(-1)])].join(" → ") : "—";
  const statsLine = `${pb ? pb.name : "Default agent"} · ${duration} · ${callerTurns.length} turns · avg response ${avg} · ${langs} · mood ${moodPath}`;

  const card = document.createElement("div");
  card.className = "summary";
  card.innerHTML = `<h3>📋 Call summary</h3><div class="stats"></div><pre>Writing summary…</pre><div class="actions"></div>`;
  card.querySelector(".stats").textContent = statsLine;
  $("msgs").appendChild(card);
  scrollDown();
  const pre = card.querySelector("pre"), actions = card.querySelector(".actions");
  if (recording) actions.appendChild(downloadLink(recording.url, recording.name, "⬇ Recording"));

  if (!callerTurns.length) { pre.textContent = "The call ended before the caller said anything."; return; }
  let summaryText = "";
  try {
    const res = await fetch("/api/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: turns, playbookId: state.playbookId, lang: lang(), duration }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Summary failed");
    pre.textContent = data.summary;
    summaryText = data.summary;
    addTokens(data.usage);

    let i = 0;
    const transcript = turns.map((m) => {
      if (m.role === "user") {
        const t = callerTurns[i++] || {};
        return `Caller: ${m.content}\n   [intent: ${t.intent || "?"} | mood: ${t.mood || "?"} | language: ${t.lang || "?"} | response: ${fmtS(t.firstVoice ?? t.firstText)}]`;
      }
      return `${agentName()}: ${stripTags(m.content)}`;
    }).join("\n");
    const file = `CALL SUMMARY\n${statsLine}\n${state.callStartedAt?.toLocaleString() || ""}\n\n${data.summary}\n\n--- Transcript ---\n${transcript}\n`;
    const url = URL.createObjectURL(new Blob([file], { type: "text/plain" }));
    actions.appendChild(downloadLink(url, `call-summary-${localStamp()}.txt`, "⬇ Summary + transcript"));
  } catch (e) {
    pre.textContent = "Couldn't write the summary: " + e.message;
  }
  scrollDown();

  // Save to call history (summary, annotated transcript, stats, recording).
  try {
    let j = 0;
    const transcript = turns.map((m) => {
      if (m.role === "user") {
        const t = callerTurns[j++] || {};
        return {
          role: "caller", text: m.content, intent: t.intent, mood: t.mood, lang: t.lang, responseMs: t.firstVoice ?? t.firstText ?? null,
          ...(t.emergency ? { emergency: `${t.emergency.label} ${t.emergency.number}` } : {}),
          ...(t.calendar ? { calendar: `${t.calendar.title} @ ${new Date(t.calendar.start).toLocaleString()}` } : {}),
          ...(t.message ? { message: msgLine(t.message) } : {}),
        };
      }
      const emotions = [...new Set([...m.content.matchAll(/\[([a-z]+)\]/gi)].map((x) => x[1].toLowerCase()))];
      return { role: "agent", text: stripTags(m.content), emotions };
    });
    const t = activePlaybook() ? state.types[activePlaybook().type] : null;
    const saved = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startedAt: state.callStartedAt?.toISOString(), duration, endedBy,
        playbook: pb ? { name: pb.name, icon: t?.icon, type: t?.name } : null,
        language: $("lang").selectedOptions[0]?.text, voice: $("voice").value, agentName: agentName(),
        stats: {
          turns: callerTurns.length, avgResponse: avg, languages: langs, moodPath,
          avgResponseMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
          intents: [...new Set(callerTurns.map((x) => x.intent).filter(Boolean))],
          tokens: { ...state.callTokens },
          emergencies: callerTurns.filter((x) => x.emergency).map((x) => `${x.emergency.label} ${x.emergency.number}`),
          calendarEvents: callerTurns.filter((x) => x.calendar).map((x) => x.calendar.title),
          messages: callerTurns.filter((x) => x.message).map((x) => msgLine(x.message)),
        },
        summary: summaryText, transcript,
      }),
    }).then((r) => r.json());
    if (recording?.blob) {
      await fetch(`/api/calls/${saved.id}/recording`, { method: "PUT", headers: { "Content-Type": recording.blob.type }, body: recording.blob });
    }
    card.querySelector(".stats").textContent += ` · ${state.callTokens.total.toLocaleString()} tokens · saved to call summaries`;
    state.historyPage = 1;
    loadHistory();
  } catch (e) {
    console.warn("Couldn't save call:", e);
  }
}

function localStamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

function downloadLink(url, name, label) {
  const a = document.createElement("a");
  a.href = url; a.download = name; a.textContent = label;
  return a;
}

// ---------- audio mixer: recording (mic + agent voice) and the visualizer ----------
function setupMixer() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    state.ctx = new Ctx();
    state.ctx.resume();
    state.analyser = state.ctx.createAnalyser();
    state.analyser.fftSize = 256;
    state.analyser.smoothingTimeConstant = 0.75;
    if (window.MediaRecorder) state.recDest = state.ctx.createMediaStreamDestination();
    if (state.micStream) {
      const mic = state.ctx.createMediaStreamSource(state.micStream);
      mic.connect(state.analyser);
      // Separate analyser on the mic only, for voice activity detection.
      state.micAnalyser = state.ctx.createAnalyser();
      state.micAnalyser.fftSize = 1024;
      mic.connect(state.micAnalyser);
      if (state.recDest) mic.connect(state.recDest);
    }
  } catch (e) {
    console.warn("Audio mixer unavailable:", e);
    state.ctx = state.recDest = state.analyser = state.micAnalyser = null;
  }
}

function routeToMixer(audio) {
  if (!state.ctx) return;
  try {
    const src = state.ctx.createMediaElementSource(audio);
    src.connect(state.ctx.destination);
    src.connect(state.analyser);
    if (state.recDest) src.connect(state.recDest);
  } catch (e) { console.warn(e); }
}

function teardownMixer() {
  state.micStream?.getTracks().forEach((t) => t.stop());
  state.micStream = null;
  state.ctx?.close();
  state.ctx = state.recDest = state.analyser = state.micAnalyser = null;
  $("recBtn").disabled = true;
}

function startRecording() {
  if (!state.recDest) return;
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
  state.recChunks = [];
  state.recorder = new MediaRecorder(state.recDest.stream, type ? { mimeType: type } : undefined);
  state.recorder.ondataavailable = (e) => e.data.size && state.recChunks.push(e.data);
  state.recorder.start(1000);
  $("recBtn").classList.add("rec");
  $("recLabel").textContent = "● Recording";
}

function stopRecording() {
  return new Promise((resolve) => {
    const r = state.recorder;
    $("recBtn").classList.remove("rec");
    $("recLabel").textContent = "";
    if (!r || r.state === "inactive") return resolve(null);
    r.onstop = () => {
      const ext = r.mimeType.includes("mp4") ? "m4a" : "webm";
      const blob = new Blob(state.recChunks, { type: r.mimeType });
      state.recorder = null;
      resolve({ blob, url: URL.createObjectURL(blob), name: `call-recording-${localStamp()}.${ext}` });
    };
    r.stop();
  });
}

$("recBtn").addEventListener("click", async () => {
  if (state.recorder) {
    const rec = await stopRecording();
    if (rec) {
      const note = addMsg("assistant", "Recording saved.");
      note.querySelector(".chips").appendChild(downloadLink(rec.url, rec.name, "⬇ Download recording"));
    }
  } else startRecording();
});

// ---------- visualizer: frequency ring that reacts to voices, coloured by phase / emotion ----------
const viz = $("viz"), vctx = viz.getContext("2d");
(function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  viz.width = 240 * dpr; viz.height = 240 * dpr;
  vctx.scale(dpr, dpr);
})();
const freq = new Uint8Array(128);
let smoothLevel = 0;

function phaseColor() {
  if (state.phase === "speaking") return EMO_COLOR[state.emotion] || EMO_COLOR.neutral;
  if (state.phase === "listening") return state.muted ? "#94a3b8" : getComputedStyle(document.documentElement).getPropertyValue("--green").trim();
  if (state.phase === "thinking") return getComputedStyle(document.documentElement).getPropertyValue("--amber").trim();
  return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
}

function drawViz(ts) {
  const W = 240, cx = 120, cy = 120, base = 68;
  vctx.clearRect(0, 0, W, W);
  const color = phaseColor();
  let level = 0;
  const bars = 64;

  if (state.analyser && (state.phase === "speaking" || state.phase === "listening")) {
    state.analyser.getByteFrequencyData(freq);
    for (let i = 0; i < 64; i++) level += freq[i];
    level = level / (64 * 255);
  }
  smoothLevel += (level - smoothLevel) * 0.25;
  $("avatar").style.setProperty("--level", Math.min(1, smoothLevel * 2.2).toFixed(3));

  vctx.lineCap = "round";
  if (state.phase === "thinking") {
    // orbiting dots
    for (let i = 0; i < 3; i++) {
      const a = ts / 380 + (i * Math.PI * 2) / 3;
      vctx.beginPath();
      vctx.fillStyle = color;
      vctx.globalAlpha = 0.9 - i * 0.2;
      vctx.arc(cx + Math.cos(a) * (base + 14), cy + Math.sin(a) * (base + 14), 6 - i, 0, Math.PI * 2);
      vctx.fill();
    }
    vctx.globalAlpha = 1;
  } else {
    for (let i = 0; i < bars; i++) {
      const a = (i / bars) * Math.PI * 2 - Math.PI / 2;
      let v;
      if (state.analyser && (state.phase === "speaking" || state.phase === "listening")) {
        const bin = Math.floor((i < bars / 2 ? i : bars - i) * 1.4) + 2; // mirrored so the ring looks symmetric
        v = freq[bin] / 255;
      } else {
        v = 0.08 + 0.05 * Math.sin(ts / 700 + i / 3); // gentle idle breathing
      }
      const len = 4 + v * 40;
      vctx.strokeStyle = color;
      vctx.globalAlpha = 0.35 + v * 0.65;
      vctx.lineWidth = 3;
      vctx.beginPath();
      vctx.moveTo(cx + Math.cos(a) * (base + 4), cy + Math.sin(a) * (base + 4));
      vctx.lineTo(cx + Math.cos(a) * (base + 4 + len), cy + Math.sin(a) * (base + 4 + len));
      vctx.stroke();
    }
    vctx.globalAlpha = 1;
  }
  requestAnimationFrame(drawViz);
}
requestAnimationFrame(drawViz);

// ---------- buttons ----------
$("callBtn").addEventListener("click", () => (state.inCall ? endCall("ended by you") : startCall()));

$("muteBtn").addEventListener("click", () => {
  state.muted = !state.muted;
  $("muteBtn").classList.toggle("active", state.muted);
  if (state.muted) stopListening();
  if (state.inCall && state.phase === "listening") { if (state.muted) setPhase("listening"); else startListening(); }
});

// tap avatar to interrupt (barge in)
$("avatar").addEventListener("click", () => {
  if (!state.inCall) return;
  if (state.abort) state.abort.abort();
  stopSpeaking();
  state.streamDone = true;
  startListening();
});

$("typer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("typed").value.trim();
  if (!text) return;
  $("typed").value = "";
  sendUserText(text);
});

function clearChat() {
  if (state.abort) state.abort.abort();
  stopSpeaking();
  state.history = [];
  state.turns = [];
  updateInsights();
  $("msgs").innerHTML = '<div class="empty" id="empty">Your conversation will appear here.</div>';
}
$("clearBtn").addEventListener("click", clearChat);

// ---------- call history (paginated) ----------
const fmtDate = (iso) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const outcomeOf = (summary) => /Outcome:\s*(.+)/i.exec(summary || "")?.[1] || (summary || "No summary").split("\n")[0];

const fmtDuration = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s2 = Math.round(sec % 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(s2).padStart(2, "0")}`;
};
const fmtTokens = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "k" : n.toLocaleString());

async function loadTotals() {
  const t = await fetch("/api/calls/stats").then((r) => r.json());
  $("tCalls").textContent = t.calls;
  $("tTurns").textContent = `${t.turns} turns`;
  $("tTime").textContent = fmtDuration(t.totalSeconds);
  $("tAvgCall").textContent = t.calls ? `avg ${fmtDuration(t.totalSeconds / t.calls)} / call` : "—";
  $("tTokens").textContent = fmtTokens(t.tokens.total);
  $("tTokSplit").textContent = t.tokens.total ? `${fmtTokens(t.tokens.input)} in · ${fmtTokens(t.tokens.output)} out` : "—";
  $("tReply").textContent = t.avgResponseMs != null ? fmtS(t.avgResponseMs) : "—";
  $("tRecs").textContent = t.recordings;
}

function setHistoryOpen(open) {
  $("historyList").hidden = !open;
  $("toggleHistory").textContent = open ? "Hide calls ▴" : "Show calls ▾";
  $("toggleHistory").setAttribute("aria-expanded", String(open));
  store.set("va-history-open", open ? "1" : "0");
}
$("toggleHistory").addEventListener("click", () => setHistoryOpen($("historyList").hidden));
document.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => setHistoryOpen(true)));
setHistoryOpen(store.get("va-history-open") === "1");

async function deleteCall(c) {
  const when = fmtDate(c.startedAt);
  if (!confirm(`Delete the ${c.playbook?.name || "Default agent"} call from ${when}? Its summary file and recording are deleted too.`)) return false;
  await fetch(`/api/calls/${c.id}`, { method: "DELETE" });
  await loadHistory();
  return true;
}

async function loadHistory() {
  loadTotals().catch(() => {});
  const data = await fetch(`/api/calls?page=${state.historyPage}`).then((r) => r.json());
  state.historyPage = data.page;
  const box = $("calls");
  box.innerHTML = "";
  if (!data.items.length && data.page > 1) { state.historyPage = data.page - 1; return loadHistory(); }
  if (!data.items.length) {
    box.innerHTML = '<div class="empty">No calls yet. Finished calls and their summaries show up here.</div>';
  }
  for (const c of data.items) {
    const row = document.createElement("button");
    row.type = "button"; row.className = "call-row";
    row.innerHTML = `<div class="c-icon"></div><div><div class="c-title"></div><div class="c-sub"></div></div><div class="c-outcome"></div><div class="c-meta"></div>`;
    row.querySelector(".c-icon").textContent = c.playbook?.icon || "💬";
    const title = row.querySelector(".c-title");
    if (c.agentName) { const a = document.createElement("span"); a.className = "call-agent"; a.textContent = c.agentName; title.appendChild(a); }
    title.append(c.playbook?.name || "Default agent");
    row.querySelector(".c-sub").textContent = `${fmtDate(c.startedAt)} · ${c.duration} · ${c.stats?.turns ?? 0} turns`;
    row.querySelector(".c-outcome").textContent = outcomeOf(c.summary);
    const meta = row.querySelector(".c-meta");
    const chip = (t) => { const s = document.createElement("span"); s.className = "chip"; s.textContent = t; meta.appendChild(s); };
    if (c.stats?.moodPath && c.stats.moodPath !== "—") chip(`💬 ${c.stats.moodPath}`);
    if (c.stats?.avgResponse && c.stats.avgResponse !== "—") chip(`⏱ ${c.stats.avgResponse}`);
    if (c.recording) chip("🎙 recording");
    row.addEventListener("click", () => openCall(c.id));
    const wrap = document.createElement("div");
    wrap.className = "call-row-wrap";
    const del = document.createElement("button");
    del.type = "button"; del.className = "row-del"; del.textContent = "🗑";
    del.title = "Delete this call"; del.setAttribute("aria-label", "Delete this call");
    del.addEventListener("click", () => deleteCall(c));
    wrap.append(row, del);
    box.appendChild(wrap);
  }
  const pager = $("pager");
  pager.innerHTML = "";
  if (data.pages > 1) {
    const prev = document.createElement("button"); prev.textContent = "← Prev"; prev.disabled = data.page <= 1;
    const next = document.createElement("button"); next.textContent = "Next →"; next.disabled = data.page >= data.pages;
    const label = document.createElement("span"); label.textContent = `Page ${data.page} of ${data.pages}`;
    prev.onclick = () => { state.historyPage--; loadHistory(); };
    next.onclick = () => { state.historyPage++; loadHistory(); };
    pager.append(prev, label, next);
  }
}

async function openCall(id) {
  const c = await fetch(`/api/calls/${id}`).then((r) => r.json());
  $("callTitle").textContent = `${c.playbook?.icon || "💬"} ${c.agentName ? c.agentName + " · " : ""}${c.playbook?.name || "Default agent"} · ${fmtDate(c.startedAt)}`;
  const body = $("callBody");
  body.innerHTML = `<div class="stats"></div><pre></pre><div class="rec"></div><h4>Transcript</h4><div class="lines"></div><div class="actions"></div>`;
  const st = c.stats || {};
  body.querySelector(".stats").textContent = [
    `⏱ ${c.duration}`, `${st.turns ?? 0} turns`, `avg reply ${st.avgResponse || "—"}`, `🌐 ${st.languages || c.language || "—"}`,
    `💬 ${st.moodPath || "—"}`, `🔢 ${(st.tokens?.total ?? 0).toLocaleString()} tokens`, `📴 ${c.endedBy}`,
  ].join(" · ");
  body.querySelector("pre").textContent = c.summary || "No summary was written for this call.";
  if (c.recording) {
    body.querySelector(".rec").innerHTML = `<h4>Recording</h4><audio controls preload="none"></audio>`;
    body.querySelector("audio").src = `/api/calls/${c.id}/recording`;
  }
  const lines = body.querySelector(".lines");
  for (const t of c.transcript || []) {
    const div = document.createElement("div");
    div.className = "tline";
    div.innerHTML = `<span class="who"></span><span class="txt"></span><div class="chips"></div>`;
    div.querySelector(".who").textContent = t.role === "caller" ? "Caller:" : "Agent:";
    div.querySelector(".txt").textContent = t.text;
    const chips = div.querySelector(".chips");
    const chip = (x) => { const s = document.createElement("span"); s.className = "chip"; s.textContent = x; chips.appendChild(s); };
    if (t.role === "caller") {
      if (t.intent) chip(`🎯 ${t.intent}`);
      if (t.mood) chip(`${EMOJI[t.mood] || "💬"} ${t.mood}`);
      if (t.lang) chip(`🌐 ${t.lang}`);
      if (t.responseMs != null) chip(`⏱ reply ${fmtS(t.responseMs)}`);
      if (t.emergency) chip(`🚨 ${t.emergency}`);
      if (t.calendar) chip(`📅 ${t.calendar}`);
    } else for (const e of t.emotions || []) chip(`${EMOJI[e] || "•"} ${e}`);
    lines.appendChild(div);
  }
  const actions = body.querySelector(".actions");
  actions.appendChild(downloadLink(`/api/calls/${c.id}/summary`, `call-summary-${c.id}.txt`, "⬇ Summary file"));
  if (c.recording) actions.appendChild(downloadLink(`/api/calls/${c.id}/recording`, `call-recording-${c.id}.${c.recording.file.split(".").pop()}`, "⬇ Recording"));
  const del = document.createElement("button");
  del.className = "danger"; del.textContent = "🗑 Delete call";
  del.onclick = async () => { if (await deleteCall(c)) closeCall(); };
  actions.appendChild(del);
  $("callDialog").classList.add("open");
}

function closeCall() { $("callDialog").classList.remove("open"); }
$("callClose").addEventListener("click", closeCall);
$("callDialog").addEventListener("click", (e) => { if (e.target === $("callDialog")) closeCall(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCall(); });

loadHistory().catch((e) => console.warn("Couldn't load call history:", e));

// ---------- Agent setup: models, calendar, emergency, save ----------
function setSelect(sel, value) {
  if (!value) return;
  if (![...sel.options].some((o) => o.value === value)) sel.add(new Option(value, value));
  sel.value = value;
}

async function loadModels() {
  const m = await fetch("/api/models").then((r) => r.json());
  const fill = (sel, list, extra = []) => {
    const keep = sel.value;
    sel.innerHTML = "";
    for (const [v, l] of extra) sel.add(new Option(l, v));
    for (const id of list) sel.add(new Option(id, id));
    if (keep) setSelect(sel, keep);
  };
  fill($("llmSel"), m.chat);
  fill($("sttSel"), m.stt, [["browser", "Browser captions only (free, less accurate)"]]);
  fill($("ttsSel"), m.tts);
  for (const id of ["llmSel", "sttSel", "ttsSel"]) $(id).title = $(id).value;
  $("modelsHint").textContent = m.source === "account" ? "Lists show the models your OpenAI account can use." : "Couldn't reach OpenAI; showing common models.";
}
["llmSel", "sttSel", "ttsSel"].forEach((id) => $(id).addEventListener("change", () => { $(id).title = $(id).value; markDirty(); }));
$("calToggle").addEventListener("change", () => { renderNotes(); markDirty(); });
$("calLen").addEventListener("change", markDirty);
$("emgToggle").addEventListener("change", () => { renderRules(); markDirty(); if ($("emgToggle").checked) $("emgType").focus(); });

// Keywords offered in the "pick a keyword" list (anyone can also type their own).
const KEYWORD_SUGGESTIONS = [
  "emergency", "help me", "bachao", "danger", "ambulance", "heart attack", "chest pain", "accident", "bleeding",
  "unconscious", "can't breathe", "stroke", "snake bite", "poison", "police", "robbery", "thief", "attack", "kidnap",
  "chor", "fire", "smoke", "aag", "gas leak", "burning", "flood", "earthquake", "harassment", "stalking",
  "domestic violence", "suicide", "kill myself", "self harm", "want to die",
];

function renderNotes() {
  $("emgAdd").hidden = !$("emgToggle").checked;
  $("emgCount").textContent = `${state.rules.length}`;
  const on = $("emgToggle").checked, cal = $("calToggle").checked;
  $("emgNote").textContent = on ? `On · ${state.rules.length}` : "Off";
  $("emgNote").className = "sec-note" + (on ? " on" : "");
  $("calNote").textContent = cal ? "On" : "Off";
  $("calNote").className = "sec-note" + (cal ? " on" : "");
  renderSummary();
}

function renderRules() {
  renderNotes();
  const box = $("emgRules");
  box.innerHTML = "";
  box.classList.toggle("off", !$("emgToggle").checked);
  state.rules.forEach((r, i) => {
    const el = document.createElement("div");
    el.className = "rule";
    el.innerHTML = `
      <div class="rule-top">
        <input type="text" class="r-label" placeholder="Service, e.g. Ambulance" maxlength="40" aria-label="Emergency service name" />
        <select class="r-type" aria-label="Contact by"><option value="phone">📞 Phone</option><option value="email">✉️ Email</option></select>
        <input type="text" class="r-num" placeholder="Number" maxlength="120" inputmode="tel" aria-label="Emergency number or email" />
        <button type="button" class="rule-del" title="Remove this emergency number" aria-label="Remove">🗑</button>
      </div>
      <div class="kw-list"></div>
      <div class="kw-add">
        <select aria-label="Pick a keyword"><option value="">＋ Pick keyword…</option></select>
        <input type="text" placeholder="or type a keyword + Enter" maxlength="40" aria-label="Type a keyword" />
      </div>`;
    el.querySelector(".r-label").value = r.label;
    el.querySelector(".r-num").value = r.number;
    el.querySelector(".r-type").value = r.type === "email" ? "email" : "phone";
    el.querySelector(".r-num").placeholder = r.type === "email" ? "name@example.com" : "Number";
    el.querySelector(".r-type").addEventListener("change", (e) => { r.type = e.target.value; renderRules(); markDirty(); });
    el.querySelector(".r-label").addEventListener("input", (e) => { r.label = e.target.value; markDirty(); });
    el.querySelector(".r-num").addEventListener("input", (e) => { r.number = e.target.value; markDirty(); });
    el.querySelector(".rule-del").addEventListener("click", () => { state.rules.splice(i, 1); renderRules(); markDirty(); });
    const list = el.querySelector(".kw-list");
    r.keywords.forEach((k, j) => {
      const chip = document.createElement("span");
      chip.className = "kw";
      chip.textContent = k;
      const x = document.createElement("button");
      x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", `Remove keyword ${k}`);
      x.onclick = () => { r.keywords.splice(j, 1); renderRules(); markDirty(); };
      chip.appendChild(x);
      list.appendChild(chip);
    });
    const addKw = (k) => {
      k = k.trim().toLowerCase();
      if (k && !r.keywords.includes(k)) { r.keywords.push(k); renderRules(); markDirty(); }
    };
    const pick = el.querySelector("select");
    for (const k of KEYWORD_SUGGESTIONS.filter((k) => !r.keywords.includes(k))) pick.add(new Option(k, k));
    pick.addEventListener("change", () => addKw(pick.value));
    const typed = el.querySelector(".kw-add input");
    typed.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addKw(typed.value); } });
    typed.addEventListener("blur", () => typed.value && addKw(typed.value));
    box.appendChild(el);
  });
}
// ---------- "Add emergency number" form (shown when Emergency is switched on) ----------
// Pick what it's related to, the number fills in (editable), then pick suggested keywords or type your own.
const EMERGENCY_TYPES = {
  "Ambulance": { icon: "🚑", number: "108", keywords: ["ambulance", "heart attack", "chest pain", "accident", "bleeding", "unconscious", "can't breathe", "stroke"] },
  "Police": { icon: "🚓", number: "100", keywords: ["police", "robbery", "thief", "attack", "kidnap", "chor", "fight"] },
  "Fire": { icon: "🔥", number: "101", keywords: ["fire", "smoke", "aag", "burning", "gas leak"] },
  "Women helpline": { icon: "👩", number: "1091", keywords: ["harassment", "stalking", "domestic violence", "eve teasing", "women helpline"] },
  "Mental health helpline": { icon: "💚", number: "14416", keywords: ["suicide", "kill myself", "self harm", "want to die", "depressed"] },
  "Child helpline": { icon: "🧒", number: "1098", keywords: ["child abuse", "missing child", "child labour", "lost child"] },
  "Disaster management": { icon: "🌊", number: "1078", keywords: ["flood", "earthquake", "cyclone", "landslide"] },
  "All emergencies": { icon: "🆘", number: "112", keywords: ["emergency", "help me", "bachao", "danger"] },
  "Other": { icon: "✏️", number: "", keywords: [] },
};
const emgForm = { picked: [] };

for (const [name, t] of Object.entries(EMERGENCY_TYPES)) $("emgType").add(new Option(`${t.icon} ${name}`, name));

function renderEmgForm() {
  const type = EMERGENCY_TYPES[$("emgType").value];
  $("emgCustomWrap").hidden = $("emgType").value !== "Other";
  const sug = $("emgSuggest");
  sug.innerHTML = "";
  for (const k of type.keywords) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = k;
    b.className = emgForm.picked.includes(k) ? "on" : "";
    b.setAttribute("aria-pressed", String(emgForm.picked.includes(k)));
    b.onclick = () => { toggleKw(k); };
    sug.appendChild(b);
  }
  const picked = $("emgPicked");
  picked.innerHTML = "";
  for (const k of emgForm.picked) {
    const chip = document.createElement("span");
    chip.className = "kw"; chip.textContent = k;
    const x = document.createElement("button");
    x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", `Remove keyword ${k}`);
    x.onclick = () => toggleKw(k);
    chip.appendChild(x);
    picked.appendChild(chip);
  }
}
function toggleKw(k) {
  k = k.trim().toLowerCase();
  if (!k) return;
  emgForm.picked = emgForm.picked.includes(k) ? emgForm.picked.filter((x) => x !== k) : [...emgForm.picked, k];
  renderEmgForm();
}
function setEmgVia(via) {
  $("emgVia").value = via;
  $("emgNumberLabel").textContent = via === "email" ? "Email" : "Number";
  $("emgNumber").placeholder = via === "email" ? "e.g. help@company.com" : "e.g. 108";
  $("emgNumber").inputMode = via === "email" ? "email" : "tel";
}
$("emgVia").addEventListener("change", () => { setEmgVia($("emgVia").value); $("emgNumber").value = ""; $("emgNumber").focus(); });
function resetEmgForm() {
  const t = EMERGENCY_TYPES[$("emgType").value];
  setEmgVia("phone");
  $("emgNumber").value = t.number;
  $("emgCustom").value = "";
  emgForm.picked = [...t.keywords.slice(0, 3)]; // start with the most common ones picked
  renderEmgForm();
}
$("emgType").addEventListener("change", resetEmgForm);
$("emgKwInput").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  for (const k of $("emgKwInput").value.split(",")) if (k.trim() && !emgForm.picked.includes(k.trim().toLowerCase())) toggleKw(k);
  $("emgKwInput").value = "";
});
function emgMsg(text, cls = "") { $("emgMsg").textContent = text; $("emgMsg").className = "emg-msg" + (cls ? " " + cls : ""); }
$("emgAddBtn").addEventListener("click", () => {
  const typed = $("emgKwInput").value.trim();
  if (typed) { toggleKw(typed); $("emgKwInput").value = ""; }
  const label = $("emgType").value === "Other" ? $("emgCustom").value.trim() : $("emgType").value;
  const number = $("emgNumber").value.trim();
  const via = $("emgVia").value;
  if (!label) return emgMsg("Give it a name.", "err");
  if (via === "email" ? !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(number) : !/^[\d+*# -]{2,20}$/.test(number)) return emgMsg(via === "email" ? "Enter a valid email address." : "Enter a valid number.", "err");
  if (!emgForm.picked.length) return emgMsg("Pick or type at least one keyword.", "err");
  // Same service again: update its number and add the new keywords instead of making a duplicate.
  const existing = state.rules.find((r) => r.label.toLowerCase() === label.toLowerCase());
  if (existing) {
    existing.number = number;
    existing.type = via;
    existing.keywords = [...new Set([...existing.keywords, ...emgForm.picked])];
  } else {
    state.rules.push({ label, type: via, number, keywords: [...emgForm.picked] });
  }
  renderRules();
  markDirty();
  emgMsg(existing ? `✓ Updated ${label}` : `✓ Added ${label} · ${number}`, "ok");
  setTimeout(() => emgMsg(""), 3000);
  resetEmgForm();
});
resetEmgForm();

function formPayload() {
  return {
    agent: { defaultName: agentName(), defaultLanguage: lang(), defaultVoice: $("voice").value, defaultPlaybookId: state.playbookId },
    models: { chat: $("llmSel").value, stt: $("sttSel").value, tts: $("ttsSel").value },
    calendar: { enabled: $("calToggle").checked, defaultDurationMin: Number($("calLen").value) || 30 },
    emergency: { enabled: $("emgToggle").checked, rules: state.rules },
    persona: personaPayload(),
  };
}
const formSnapshot = () => JSON.stringify(formPayload());

// Every change in Agent setup is saved to config.json automatically (no Save button).
// Selects and switches save almost at once; typing saves after a short pause.
function markDirty() {
  if (!state.savedSnapshot) return; // still filling the form on start-up
  if (formSnapshot() === state.savedSnapshot) return;
  setSaveStatus("Saving…");
  renderSummary();
  clearTimeout(state.saveTimer);
  const typing = document.activeElement?.matches?.('input[type="text"], textarea');
  state.saveTimer = setTimeout(autoSave, typing ? 700 : 150);
}

function setSaveStatus(text, cls = "") {
  $("saveStatus").textContent = text;
  $("saveStatus").className = "autosave" + (cls ? " " + cls : "");
}

async function autoSave() {
  const payload = formPayload();
  // An emergency number still being filled in stays on screen and is saved once it has a name, number and keyword.
  const complete = payload.emergency.rules.filter((r) => r.label.trim() && r.number.trim() && r.keywords.length);
  const pending = payload.emergency.rules.length - complete.length;
  payload.emergency = { ...payload.emergency, rules: complete };
  const snapshot = formSnapshot();
  try {
    const res = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => null);
    // An empty or non-JSON reply means the running server predates this page: it needs a restart.
    if (!data || res.status === 404 || res.status === 405) { showStaleServer(); throw new Error("Restart the server to save"); }
    if (!res.ok) throw new Error(data.error || "Couldn't save");
    for (const k of Object.keys(SETTINGS)) delete SETTINGS[k];
    Object.assign(SETTINGS, data.settings);
    Object.assign(CONFIG, data.settings.conversation || {});
    $("modelInfo").textContent = `${SETTINGS.models.chat} · ${SETTINGS.models.stt} · ${SETTINGS.models.tts}`;
    state.savedSnapshot = snapshot;
    if (data.agent) {
      const i = state.agents.findIndex((a) => a.id === data.agent.id);
      if (i >= 0) state.agents[i] = data.agent;
      SETTINGS.currentAgent = data.agent;
      renderAgents();
    }
    const calWasHidden = $("calendarCard").hidden;
    $("calendarCard").hidden = !SETTINGS.calendar?.enabled;
    if (calWasHidden && SETTINGS.calendar?.enabled) loadCalendar();
    setSaveStatus(pending ? "✓ Saved · finish the new number" : "✓ Saved");
    clearTimeout(state.saveFade);
    if (!pending) state.saveFade = setTimeout(() => setSaveStatus(""), 2500);
    if (formSnapshot() !== snapshot) markDirty(); // more edits arrived while saving
  } catch (e) {
    setSaveStatus("⚠ " + e.message, "err");
  }
}

// ---------- emergency detection ----------
function detectEmergency(text) {
  const e = SETTINGS.emergency;
  if (!e?.enabled) return null;
  const lower = ` ${text.toLowerCase()} `;
  let best = null;
  for (const r of e.rules || []) {
    for (const k of r.keywords) {
      const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const hit = /^[\x00-\x7f]+$/.test(k) ? new RegExp(`(^|[^\\p{L}])${esc}([^\\p{L}]|$)`, "u").test(lower) : lower.includes(k);
      if (hit && (!best || k.length > best.keyword.length)) best = { ...r, keyword: k };
    }
  }
  return best;
}

function showEmergency(rule) {
  $("empty")?.remove();
  const el = document.createElement("div");
  el.className = "emg-alert";
  el.setAttribute("role", "alert");
  el.innerHTML = `<div class="big">🚨</div><div><div class="t"></div><div class="s"></div></div><a></a>`;
  el.querySelector(".t").textContent = `Emergency: ${rule.label}`;
  const email = rule.type === "email";
  el.querySelector(".s").textContent = `Heard “${rule.keyword}”. ${email ? "Contact now" : "Call now"}:`;
  const a = el.querySelector("a");
  a.href = email ? `mailto:${rule.number}` : `tel:${rule.number.replace(/\s/g, "")}`;
  a.textContent = `${email ? "✉️" : "📞"} ${rule.number}`;
  $("msgs").appendChild(el);
  scrollDown();
}

// ---------- calendar ----------
async function addCalendarEvent(raw, turn) {
  const [title, start, minutes] = raw.split("|").map((x) => x.trim());
  if (!title || !start) return;
  try {
    const res = await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, start: new Date(start).toISOString(), durationMin: Number(minutes) || undefined, source: activePlaybook()?.name || "Default agent" }),
    });
    const ev = await res.json();
    if (!res.ok) throw new Error(ev.error);
    turn.calendar = ev;
    addChip(turn.bubble, `📅 added: ${ev.title}, ${new Date(ev.start).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`, "cal-" + ev.id);
    loadCalendar();
  } catch (e) {
    console.warn("Couldn't add calendar event:", e);
  }
}

async function loadCalendar() {
  if (!SETTINGS.calendar?.enabled) return;
  const events = await fetch("/api/calendar").then((r) => r.json());
  const box = $("calList");
  box.innerHTML = "";
  if (!events.length) { box.innerHTML = '<div class="empty">No events yet. Ask the agent to book or remind you of something.</div>'; return; }
  const nowIso = new Date().toISOString();
  const ordered = [...events.filter((e) => e.start >= nowIso), ...events.filter((e) => e.start < nowIso).reverse()];
  for (const e of ordered) {
    const d = new Date(e.start);
    const el = document.createElement("div");
    el.className = "cal-item" + (e.start < nowIso ? " past" : "");
    el.innerHTML = `<div class="cal-date"><div class="d"></div><div class="m"></div></div><div><div class="cal-title"></div><div class="cal-when"></div></div><div class="cal-actions"><a title="Add to your calendar app">⬇ .ics</a><button type="button" title="Delete event" aria-label="Delete event">🗑</button></div>`;
    el.querySelector(".d").textContent = d.getDate();
    el.querySelector(".m").textContent = d.toLocaleString([], { month: "short" });
    el.querySelector(".cal-title").textContent = e.title;
    el.querySelector(".cal-when").textContent = `${d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} · ${e.durationMin} min · ${e.source}`;
    const a = el.querySelector("a");
    a.href = `/api/calendar/${e.id}.ics`; a.download = `event-${e.id}.ics`;
    el.querySelector("button").onclick = async () => {
      if (!confirm(`Delete "${e.title}" from the calendar?`)) return;
      await fetch(`/api/calendar/${e.id}`, { method: "DELETE" });
      loadCalendar();
    };
    box.appendChild(el);
  }
}

// ---------- messages callers leave (<message:NAME|NUMBER|URGENCY|TEXT> in a reply) ----------
const msgLine = (m) => `${m.callerName || "Caller"}${m.callerNumber ? ` (${m.callerNumber})` : ""}${m.urgency === "urgent" ? " [urgent]" : ""}: ${m.message}`;

async function saveCallerMessage(raw, turn) {
  const [callerName = "", callerNumber = "", urgency = "", ...rest] = raw.split("|").map((x) => x.trim());
  const message = rest.join(" | ").trim();
  if (!message) return;
  try {
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callerName, callerNumber, urgency, message }),
    });
    const m = await res.json();
    if (!res.ok) throw new Error(m.error);
    turn.message = m;
    addChip(turn.bubble, `📨 message saved${m.forName ? ` for ${m.forName}` : ""}${m.urgency === "urgent" ? " · urgent" : ""}`, "msg-" + m.id);
  } catch (e) {
    console.warn("Couldn't save the message:", e);
  }
}

// ---------- signed-in user ----------
function setupUserMenu(me) {
  if (!me) return;
  state.me = me;
  $("userMenu").hidden = false;
  $("uAv").textContent = (me.name || me.username)[0].toUpperCase();
  $("uName").textContent = me.name || me.username;
  $("uRole").textContent = me.role === 1 ? "👑 Admin" : "👤 User";
  $("mDash").hidden = me.role !== 1;
  if (me.mustChangePassword && !$("pwBanner")) {
    const b = document.createElement("div");
    b.id = "pwBanner"; b.className = "note-banner"; b.setAttribute("role", "status");
    b.textContent = "🔐 You're using a temporary password. Please set your own.";
    const btn = document.createElement("button");
    btn.type = "button"; btn.textContent = "Change password"; btn.onclick = openPw;
    b.appendChild(btn);
    document.body.prepend(b);
  }
}
$("userBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const open = $("userDrop").hidden;
  $("userDrop").hidden = !open;
  $("userBtn").setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", () => { $("userDrop").hidden = true; $("userBtn").setAttribute("aria-expanded", "false"); });
$("mOut").addEventListener("click", async () => {
  if (state.inCall && !confirm("End the call and sign out?")) return;
  if (state.inCall) await endCall("signed out");
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login.html";
});
function openPw() {
  $("pwForm").reset(); $("pwErr").textContent = "";
  $("pwDialog").classList.add("open");
  setTimeout(() => $("pwCur").focus(), 30);
}
$("mPw").addEventListener("click", openPw);
$("pwClose").addEventListener("click", () => $("pwDialog").classList.remove("open"));
$("pwDialog").addEventListener("click", (e) => { if (e.target === $("pwDialog")) $("pwDialog").classList.remove("open"); });
$("pwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ($("pwNew").value !== $("pwNew2").value) { $("pwErr").textContent = "The new passwords don't match."; return; }
  const res = await fetch("/api/me/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current: $("pwCur").value, next: $("pwNew").value }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { $("pwErr").textContent = data.error || "Couldn't change the password."; return; }
  $("pwDialog").classList.remove("open");
  $("pwBanner")?.remove();
  setSaveStatus("✓ Password changed");
  setTimeout(() => setSaveStatus(""), 2500);
});

// ---------- My agents: each user can have many agents, each with its own setup ----------
const agentKey = () => `tsa-agent-${state.me?.id || ""}`;
const currentAgentCard = () => state.agents.find((a) => a.id === state.agentId) || null;

async function loadAgents() {
  const data = await fetch("/api/agents").then((r) => r.json());
  state.agents = data.agents;
  state.agentTypes = data.types;
  if (!state.agents.some((a) => a.id === state.agentId)) state.agentId = data.currentId;
  renderAgents();
}

function renderAgents() {
  const box = $("agentChips");
  box.innerHTML = "";
  for (const a of state.agents) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "agent-item"; b.setAttribute("role", "listitem");
    b.setAttribute("aria-current", String(a.id === state.agentId));
    b.disabled = state.inCall && a.id !== state.agentId;
    b.innerHTML = `<span class="i" aria-hidden="true"></span><span class="grow"><span class="t"></span><span class="s"></span></span>`;
    b.querySelector(".i").textContent = a.icon;
    b.querySelector(".t").textContent = a.name + (a.isDefault ? " ★" : "");
    b.querySelector(".s").textContent = a.ownerName ? `${a.typeName} · for ${a.ownerName}` : a.typeName;
    b.title = a.description || a.typeName;
    b.addEventListener("click", () => switchAgent(a.id));
    box.appendChild(b);
  }
  $("mgNew").disabled = $("sumNew").disabled = state.inCall;
  $("agentCount").textContent = `${state.agents.length} agent${state.agents.length === 1 ? "" : "s"}`;
  const pick = $("agentPick");
  pick.innerHTML = "";
  for (const a of state.agents) pick.add(new Option(`${a.icon} ${a.name}${a.ownerName ? ` · for ${a.ownerName}` : ` · ${a.typeName}`}`, a.id));
  pick.value = state.agentId;
  pick.disabled = state.inCall;
  const cur = currentAgentCard();
  $("agentDesc").textContent = cur ? `${cur.icon} ${cur.typeName}${cur.ownerName ? ` · works for ${cur.ownerName}` : ""}${cur.organization ? ` · ${cur.organization}` : ""}` : "";
  $("agentDefault").textContent = cur?.isDefault ? "★ Default" : "☆ Default";
  $("agentDefault").disabled = !!cur?.isDefault;
  $("agentDelete").hidden = state.agents.length <= 1;
  $("agentDelete").disabled = state.inCall;
  renderSummary();
}
$("agentPick").addEventListener("change", () => switchAgent($("agentPick").value));
$("sumNew").addEventListener("click", openAgentDialog);
$("mgNew").addEventListener("click", openAgentDialog);
$("sumEdit").addEventListener("click", () => (location.hash = "agents/profile"));
$("agentCallBtn").addEventListener("click", () => (location.hash = "call"));

// ---------- menu: 🎙 Call (main page) · 🤖 My agents (editor, in tabs) · 📨 Messages ----------
const TABS = ["profile", "voice", "availability", "calendar", "emergency", "playbooks"];
function showTab(tab) {
  state.tab = TABS.includes(tab) ? tab : "profile";
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
  document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.dataset.panel !== state.tab));
}
function route() {
  const [view, tab] = location.hash.replace(/^#/, "").split("/");
  const agents = view === "agents";
  document.body.dataset.view = agents ? "agents" : "call";
  $("navCall").setAttribute("aria-current", agents ? "false" : "page");
  $("navAgents").setAttribute("aria-current", agents ? "page" : "false");
  if (agents) {
    showTab(tab || state.tab);
    if (state.tab === "calendar" && SETTINGS.calendar?.enabled) loadCalendar().catch(() => {});
  }
  window.scrollTo({ top: 0 });
}
document.querySelectorAll(".tabs [data-tab]").forEach((b) => (b.onclick = () => (location.hash = `agents/${b.dataset.tab}`)));
document.querySelectorAll(".topnav [data-go]").forEach((b) => (b.onclick = () => (location.hash = b.dataset.go)));
window.addEventListener("hashchange", route);
route();

async function switchAgent(id) {
  if (id === state.agentId || state.inCall) return;
  // Save any unsaved change to the agent we're leaving first.
  if (state.savedSnapshot && formSnapshot() !== state.savedSnapshot) { clearTimeout(state.saveTimer); await autoSave(); }
  state.agentId = id;
  store.set(agentKey(), id);
  state.savedSnapshot = "";
  renderAgents();
  await loadConfig();
  fillForm();
  setSaveStatus(`Switched to ${agentName()}`);
  clearTimeout(state.saveFade);
  state.saveFade = setTimeout(() => setSaveStatus(""), 2000);
  if (SETTINGS.calendar?.enabled) loadCalendar().catch(() => {});
}

async function agentRequest(url, method, body) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

$("agentDefault").addEventListener("click", async () => {
  const cur = currentAgentCard();
  if (!cur) return;
  try {
    await agentRequest(`/api/agents/${cur.id}`, "PATCH", { isDefault: true });
    for (const a of state.agents) a.isDefault = a.id === cur.id;
    renderAgents();
  } catch (e) { setSaveStatus("⚠ " + e.message, "err"); }
});
$("agentDelete").addEventListener("click", async () => {
  const cur = currentAgentCard();
  if (!cur || state.inCall) return;
  if (!confirm(`Delete the agent "${cur.name}"? Its setup and emergency numbers are removed; its past calls stay in Call summaries.`)) return;
  try {
    await agentRequest(`/api/agents/${cur.id}`, "DELETE");
    state.agents = state.agents.filter((a) => a.id !== cur.id);
    state.agentId = "";
    await loadAgents(); // picks the default agent
    const next = state.agents.find((a) => a.isDefault) || state.agents[0];
    state.agentId = "";
    await switchAgent(next.id);
  } catch (e) { setSaveStatus("⚠ " + e.message, "err"); }
});

// New agent dialog: pick a type (call assistant, hospital, banking, HR …) and a template (both from the DB),
// say who it works for, give it a name.
const na = { type: "personal" };
function openAgentDialog() {
  if (state.inCall) return;
  na.type = "personal";
  $("naForm").reset();
  $("naErr").textContent = "";
  renderAgentTypes();
  renderNaTemplates();
  $("agentDialog").classList.add("open");
  setTimeout(() => $("naName").focus(), 30);
}
function closeAgentDialog() { $("agentDialog").classList.remove("open"); }
function renderAgentTypes() {
  const grid = $("naTypes");
  grid.innerHTML = "";
  for (const [id, t] of Object.entries(state.agentTypes)) {
    const b = tile(t.icon, t.name, t.description, () => { na.type = id; renderAgentTypes(); renderNaTemplates(); (t.needsOwner && !$("naOwner").value ? $("naOwner") : $("naName")).focus(); });
    b.classList.toggle("picked", id === na.type);
    b.setAttribute("aria-pressed", String(id === na.type));
    grid.appendChild(b);
  }
}
function renderNaTemplates() {
  const t = typeOf(na.type);
  const sel = $("naTemplate");
  sel.innerHTML = "";
  sel.add(new Option("No template: free conversation", ""));
  for (const tp of t.templates || []) sel.add(new Option(tp.name, tp.id));
  sel.value = (t.templates || []).find((x) => x.isDefault)?.id || "";
  $("naOwnerLabel").innerHTML = t.needsOwner ? 'Works for <span class="req">*</span>' : "Works for (optional)";
  $("naOwner").required = !!t.needsOwner;
  $("naAvailWrap").hidden = !(t.needsOwner || t.defaultCalendar);
  renderNaPreview();
}
function renderNaPreview() {
  const t = typeOf(na.type);
  const tp = (t.templates || []).find((x) => x.id === $("naTemplate").value);
  const v = { agent: $("naName").value.trim() || "…", owner: $("naOwner").value.trim(), org: $("naOrg").value.trim() };
  showPreview($("naPreview"), "It will answer:", renderTpl(tp?.greeting || t.greeting || "", v));
}
$("naTemplate").addEventListener("change", renderNaPreview);
["naName", "naOwner", "naOrg"].forEach((id) => $(id).addEventListener("input", renderNaPreview));
$("naClose").addEventListener("click", closeAgentDialog);
$("naCancel").addEventListener("click", closeAgentDialog);
$("agentDialog").addEventListener("click", (e) => { if (e.target === $("agentDialog")) closeAgentDialog(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAgentDialog(); });
$("naForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("naName").value.trim();
  if (!name) { $("naErr").textContent = "Give your agent a name."; return; }
  const t = typeOf(na.type);
  if (t.needsOwner && !$("naOwner").value.trim()) { $("naErr").textContent = "Who does this agent work for? Add their name."; $("naOwner").focus(); return; }
  $("naCreate").disabled = true;
  try {
    const a = await agentRequest("/api/agents", "POST", {
      name, type: na.type, description: $("naDesc").value.trim(), templateId: $("naTemplate").value,
      ownerName: $("naOwner").value.trim(), organization: $("naOrg").value.trim(), availability: $("naAvail").value.trim(),
    });
    state.agents.push(a);
    closeAgentDialog();
    await switchAgent(a.id);
    location.hash = "agents/profile";
  } catch (err) {
    $("naErr").textContent = err.message;
  } finally {
    $("naCreate").disabled = false;
  }
});

// ---------- start-up ----------
(async () => {
  try {
    state.me = (await fetch("/api/me").then((r) => r.json())).user;
    state.agentId = store.get(agentKey()) || ""; // the agent this user had open last time
    await loadAgents();
    await loadConfig();
    if (SETTINGS.currentAgent && SETTINGS.currentAgent.id !== state.agentId) { state.agentId = SETTINGS.currentAgent.id; renderAgents(); }
    await loadPlaybooks();
    fillForm(); // show the saved settings right away
    // The model list comes from OpenAI and can take a few seconds; fill the dropdowns when it arrives.
    loadModels().then(() => { state.savedSnapshot = formSnapshot(); renderSummary(); }).catch(() => {});
    loadCalendar().catch(() => {});
    } catch (e) {
    addMsg("error", "Couldn't load settings: " + e.message);
  }
})();
