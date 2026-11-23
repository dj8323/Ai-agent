// TelemuneSmartAi front end.
// Browser speech recognition in → OpenAI chat (intent / mood / language / emotion tags) → OpenAI TTS out.

// [code, label, preview line, speakers worldwide (millions, approx.)]. The Voice & AI tab ranks them by speakers and
// shows only the ones both chosen speech providers support (providers' language lists come from /api/config).
const LANGS = [
  ["en-US", "English (US)", "Hi! I'm {name}. How can I help you today?", 1500],
  ["zh-CN", "中文 (Mandarin)", "你好！我是{name}。有什么可以帮你的吗？", 1140],
  ["hi-IN", "हिन्दी (Hindi)", "नमस्ते! मैं {name} हूँ। मैं आपकी क्या मदद कर सकती हूँ?", 610],
  ["es-ES", "Español (Spanish)", "¡Hola! Soy {name}. ¿En qué te puedo ayudar?", 560],
  ["fr-FR", "Français (French)", "Bonjour ! Je suis {name}. Comment puis-je vous aider ?", 310],
  ["ar-SA", "العربية (Arabic)", "مرحباً! أنا {name}. كيف يمكنني مساعدتك؟", 275],
  ["bn-IN", "বাংলা (Bengali)", "নমস্কার! আমি {name}। আমি কীভাবে সাহায্য করতে পারি?", 274],
  ["en-IN", "English (India)", "Hi! I'm {name}. How can I help you today?", 265],
  ["pt-BR", "Português (Portuguese)", "Olá! Eu sou {name}. Como posso ajudar?", 264],
  ["ru-RU", "Русский (Russian)", "Здравствуйте! Я {name}. Чем могу помочь?", 255],
  ["ur-PK", "اردو (Urdu)", "السلام علیکم! میں {name} ہوں۔ میں آپ کی کیا مدد کر سکتی ہوں؟", 230],
  ["id-ID", "Bahasa Indonesia", "Halo! Saya {name}. Ada yang bisa saya bantu?", 200],
  ["de-DE", "Deutsch (German)", "Hallo! Ich bin {name}. Wie kann ich helfen?", 135],
  ["ja-JP", "日本語 (Japanese)", "こんにちは！{name}です。何をお手伝いしましょうか？", 125],
  ["pa-IN", "ਪੰਜਾਬੀ (Punjabi)", "ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਮੈਂ {name} ਹਾਂ। ਮੈਂ ਤੁਹਾਡੀ ਕਿਵੇਂ ਮਦਦ ਕਰ ਸਕਦੀ ਹਾਂ?", 113],
  ["mr-IN", "मराठी (Marathi)", "नमस्कार! मी {name}. मी तुम्हाला कशी मदत करू?", 99],
  ["te-IN", "తెలుగు (Telugu)", "నమస్కారం! నేను {name}. నేను ఎలా సహాయం చేయగలను?", 96],
  ["tr-TR", "Türkçe (Turkish)", "Merhaba! Ben {name}. Size nasıl yardımcı olabilirim?", 90],
  ["ta-IN", "தமிழ் (Tamil)", "வணக்கம்! நான் {name}. நான் எப்படி உதவலாம்?", 86],
  ["yue-HK", "粵語 (Cantonese)", "你好！我係{name}。有咩可以幫到你？", 86],
  ["vi-VN", "Tiếng Việt (Vietnamese)", "Xin chào! Tôi là {name}. Tôi có thể giúp gì cho bạn?", 85],
  ["ko-KR", "한국어 (Korean)", "안녕하세요! 저는 {name}입니다. 무엇을 도와드릴까요?", 82],
  ["ms-MY", "Bahasa Melayu (Malay)", "Helo! Saya {name}. Boleh saya bantu?", 77],
  ["it-IT", "Italiano (Italian)", "Ciao! Sono {name}. Come posso aiutarti?", 68],
  ["gu-IN", "ગુજરાતી (Gujarati)", "નમસ્તે! હું {name}. હું તમારી કેવી રીતે મદદ કરી શકું?", 62],
  ["fa-IR", "فارسی (Persian)", "سلام! من {name} هستم. چطور می‌توانم کمک کنم؟", 62],
  ["th-TH", "ไทย (Thai)", "สวัสดีค่ะ! ฉันชื่อ{name} มีอะไรให้ช่วยไหมคะ?", 61],
  ["kn-IN", "ಕನ್ನಡ (Kannada)", "ನಮಸ್ಕಾರ! ನಾನು {name}. ನಾನು ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?", 59],
  ["pl-PL", "Polski (Polish)", "Cześć! Jestem {name}. Jak mogę pomóc?", 41],
  ["ml-IN", "മലയാളം (Malayalam)", "നമസ്കാരം! ഞാൻ {name}. എങ്ങനെ സഹായിക്കാം?", 38],
  ["uk-UA", "Українська (Ukrainian)", "Вітаю! Я {name}. Чим можу допомогти?", 33],
  ["fil-PH", "Filipino", "Kumusta! Ako si {name}. Paano kita matutulungan?", 28],
  ["nl-NL", "Nederlands (Dutch)", "Hallo! Ik ben {name}. Waarmee kan ik helpen?", 25],
  ["ro-RO", "Română (Romanian)", "Bună! Sunt {name}. Cu ce vă pot ajuta?", 24],
  ["sv-SE", "Svenska (Swedish)", "Hej! Jag heter {name}. Hur kan jag hjälpa dig?", 13],
  ["el-GR", "Ελληνικά (Greek)", "Γεια σας! Είμαι η {name}. Πώς μπορώ να βοηθήσω;", 13],
  ["hu-HU", "Magyar (Hungarian)", "Szia! {name} vagyok. Miben segíthetek?", 13],
  ["cs-CZ", "Čeština (Czech)", "Dobrý den! Jsem {name}. Jak vám mohu pomoci?", 11],
  ["en-JM", "Jamaican Patois 🇯🇲", "Wah gwaan! A {name} dis. How mi can help yuh today?", 3],
];
const langBase = (code) => { const c = String(code || "").toLowerCase(); return c.startsWith("yue") ? "yue" : c.startsWith("fil") ? "fil" : c.split("-")[0]; };

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
  pendingCalendar: [], pendingChecks: [], calNote: null, calWaiting: false, calChain: 0, pendingMessages: [], utter: null, vadTimer: null, micAnalyser: null, srDisabled: false, pendingHangup: false, historyPage: 1,
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
for (const [code, label] of LANGS) $("lang").add(new Option(label, code)); // narrowed by renderLangs() once the providers are known
const lang = () => $("lang").value;
const agentName = () => $("nameInput").value.trim() || SETTINGS.agent.defaultName;

// ---------- speaking speed (per agent, saved in MySQL; applied as the playback rate of every sentence) ----------
const speed = () => Math.min(2, Math.max(0.5, Number($("speedRange").value) || 1));
function renderSpeed() {
  const v = speed();
  $("speedVal").textContent = `${v.toFixed(2)}×`;
  $("speedRange").style.setProperty("--fill", `${((v - 0.5) / 1.5) * 100}%`);
  if (state.audio) state.audio.playbackRate = v; // takes effect even mid-sentence
}
$("speedRange").addEventListener("input", () => { renderSpeed(); markDirty(); });

function refreshName() {
  $("agentName").textContent = agentName();
  $("avatar").setAttribute("aria-label", agentName());
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
  setDd("sLang", [$("lang").selectedOptions[0]?.text, voice, speed() !== 1 ? `${speed().toFixed(2)}× speed` : ""].filter(Boolean).join(" · "));
  // STT / TTS / LLM with the provider (admins also see the model on hover)
  const prov = (id) => $(id).selectedOptions[0]?.text?.replace(/\s*\(.*\)\s*$/, "") || "OpenAI";
  const mods = [["STT", $("sttSel").value === "browser" ? "Browser" : prov("sttProv"), $("sttSel").value || SETTINGS.models?.stt],
    ["TTS", prov("ttsProv"), $("ttsSel").value || SETTINGS.models?.tts], ["LLM", prov("llmProv"), $("llmSel").value || SETTINGS.models?.chat]];
  const isAdm = document.body.classList.contains("is-admin");
  $("sModels").innerHTML = `<span class="mtags">${mods.map(([k, p, m]) => `<span class="mtag"${isAdm && m ? ` title="${String(m).replace(/"/g, "&quot;")}"` : ""}><b>${k}</b>${p.replace(/</g, "&lt;")}</span>`).join("")}</span>`;
  const feats = $("sFeats");
  feats.innerHTML = "";
  const feat = (text, cls, tab) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "feat" + (cls ? " " + cls : ""); b.textContent = text;
    b.onclick = () => (location.hash = `agents/${tab}`);
    feats.appendChild(b);
  };
  if (allowed("tool.calendar")) feat($("calToggle").checked ? "📅 Calendar on" : "📅 Calendar off", $("calToggle").checked ? "on" : "", "calendar");
  if (allowed("tool.emergency")) feat($("emgToggle").checked ? `🚨 Emergency on · ${state.rules.length}` : "🚨 Emergency off", $("emgToggle").checked ? "on" : "", "emergency");
  // playbook: the same kind of chip; it opens Agent studio → Tools → Playbook (pick or ＋ Add one there)
  if (allowed("tool.playbook")) {
    const pb = (state.saved || []).find((p) => p.id === state.playbookId);
    feat(pb ? `📘 Playbook · ${pb.name}` : "📘 ＋ Add a playbook", pb ? "on" : "add", "playbooks");
  }
}
$("nameInput").addEventListener("input", () => { refreshName(); markDirty(); });
refreshName();
$("lang").addEventListener("change", () => { state.srFallback = 0; if ($("ttsProv").value === "aws") renderVoices($("voice").value); markDirty(); });
$("voice").addEventListener("change", markDirty);

// Banner shown when the running server is older than the code on disk.
function showStaleServer() {
  if ($("staleBanner")) return;
  const b = document.createElement("div");
  b.id = "staleBanner";
  b.className = "stale-banner";
  b.setAttribute("role", "alert");
  b.innerHTML = `<b>⚠ The server is running an older version of the app.</b> Settings can't be saved until it restarts.
    Restart voice_ai_backend (Ctrl+C in its terminal, then <code>./run.sh</code>), then reload this page.`;
  document.body.prepend(b);
}

async function loadConfig() {
  const c = await fetch("/api/config").then((r) => r.json());
  setupUserMenu(c.me);
  if (c.stale || !c.settings?.calendar) showStaleServer();
  state.voices = c.voices;
  state.providers = c.providers;
  state.channels = c.channels || {};
  state.countryCodes = (c.countryCodes || []).map((x, i) => ({ ...x, sort: i }));
  fillCc($("waCc")); fillCc($("nfWaCc")); fillEmgCc($("emgCc"), $("emgVia").value);
  fillHolidayCountries($("avHolCountry"), $("avHolCountry").value || "IN"); fillHolidayCountries($("naHolCountry"), "IN");
  const cfg = c.settings || {};
  Object.assign(SETTINGS, cfg);
  Object.assign(CONFIG, cfg.conversation || {});
  applyBranding(cfg.branding || {});
  $("modelInfo").textContent = `${cfg.models.chat} · ${cfg.models.stt} · ${cfg.models.tts}`;
  if (!$("voice").options.length) for (const [id, label] of Object.entries(c.voices)) $("voice").add(new Option(label, id));
  fillProviders();
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
  else $("pPreview").textContent = "";
  $("pTemplateHint").textContent = tpl ? `🎯 ${renderTpl(tpl.goal, v)}` : `${type.icon || "✨"} ${type.name || "Agent"}: no fixed script, it helps with whatever the caller needs.`;
  $("personaNote").textContent = p.ownerName ? `for ${p.ownerName}` : p.organization || "";
  $("personaNote").classList.toggle("on", !!(p.ownerName || p.organization));
}
$("pTemplate").addEventListener("change", () => { renderPersonaPreview(); markDirty(); });

// Confirmation before a type change: it lists what goes back to the new type's defaults and what is kept.
function askTypeChange(cur, t, tpl) {
  return new Promise((resolve) => {
    const old = typeOf(cur.type);
    $("tdLead").textContent = `"${cur.name}" changes from ${old.icon || ""} ${old.name || cur.typeName} to ${t.icon} ${t.name}. A new type is a new job, so its setup starts again from that type's defaults.`;
    const li = (list, items) => { list.innerHTML = ""; for (const x of items) { const el = document.createElement("li"); el.textContent = x; list.appendChild(el); } };
    li($("tdReset"), [
      `Template → ${tpl ? tpl.name : "free conversation"}`, "Greeting → the template's", "Description → the type's",
      "Works for, organization, availability → cleared", "Playbook → none",
      `Calendar → ${t.defaultCalendar || SETTINGS.calendar?.enabled ? "on" : "off"}, default meeting length`, "Emergency detection and contacts → app defaults",
    ]);
    li($("tdKeep"), ["Name", "Language and voice", "AI models (LLM, STT, TTS)", "Past calls and messages"]);
    const done = (ok) => {
      $("typeDialog").classList.remove("open");
      ["tdOk", "tdCancel", "tdClose"].forEach((id) => ($(id).onclick = null));
      resolve(ok);
    };
    $("tdOk").onclick = () => done(true);
    $("tdCancel").onclick = $("tdClose").onclick = () => done(false);
    $("typeDialog").onclick = (e) => { if (e.target === $("typeDialog")) done(false); };
    const onKey = (e) => { if (e.key === "Escape") { document.removeEventListener("keydown", onKey); done(false); } };
    document.addEventListener("keydown", onKey);
    $("typeDialog").classList.add("open");
    $("tdCancel").focus();
  });
}

// Change the agent's type (e.g. Personal Assistant → Call Assistant). Saved in MySQL straight away (PATCH /api/agents/:id):
// the type's pre-selected template comes with it, and the form reloads from the database.
$("pType").addEventListener("change", async () => {
  const cur = currentAgentCard();
  const key = $("pType").value;
  if (!cur || key === cur.type) return;
  const t = typeOf(key);
  const tpl = (t.templates || []).find((x) => x.isDefault);
  if (state.inCall || !(await askTypeChange(cur, t, tpl))) {
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
const av = { days: [], allDay: false, offDates: [] };
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
  if (av.allDay) setAllDay(false);
  av.days = b.dataset.days ? b.dataset.days.split(",").map(Number) : [];
  renderAvailability(); markDirty();
}));
// 🌐 24×7: every day, all day (From/To locked); press again to go back to office hours
function setAllDay(on) {
  av.allDay = on;
  if (on) { av.days = [1, 2, 3, 4, 5, 6, 7]; $("avFrom").value = "00:00"; $("avTo").value = "23:59"; }
  else if ($("avFrom").value === "00:00" && $("avTo").value === "23:59") { $("avFrom").value = "09:00"; $("avTo").value = "18:00"; }
}
$("av247").addEventListener("click", () => { setAllDay(!av.allDay); renderAvailability(); markDirty(); });
// 🎉 public holidays of a country (the agent knows the main ones and today's date) and 🏖 single days off
function fillHolidayCountries(sel, iso) {
  if (sel.options.length <= 1) { sel.innerHTML = ""; for (const c of state.countryCodes || []) sel.add(new Option(`${c.flag} ${c.name}`, c.iso2)); }
  if (iso && [...sel.options].some((o) => o.value === iso)) sel.value = iso;
}
$("avHol").addEventListener("change", () => { fillHolidayCountries($("avHolCountry"), $("avHolCountry").value || "IN"); renderAvailability(); markDirty(); });
$("avHolCountry").addEventListener("change", () => { renderAvailability(); markDirty(); });
$("avOffAdd").addEventListener("click", () => {
  const d = $("avOffDate").value;
  if (!d) return $("avOffDate").focus();
  if (!av.offDates.includes(d)) av.offDates = [...av.offDates, d].sort();
  $("avOffDate").value = "";
  renderAvailability(); markDirty();
});
const todayIso = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local
const fmtDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const countryName = (iso) => (state.countryCodes || []).find((c) => c.iso2 === iso)?.name || iso;
// one plan → the text the agent reads (also used by the new agent wizard)
function planToText(p) {
  if (!p) return "";
  const when = p.allDay ? `Available 24×7 (any day, any time; ${p.tz.replace(/_/g, " ")})`
    : p.days.length ? `${dayRanges(p.days)}, ${fmtClock(p.from)}–${fmtClock(p.to)} (${p.tz.replace(/_/g, " ")})` : "";
  const hol = p.holidays?.on && p.holidays.country ? `Not available on public holidays in ${countryName(p.holidays.country)}: don't offer meetings on them, suggest the next working day` : "";
  const off = (p.offDates || []).filter((d) => d >= todayIso());
  return [when, hol, off.length ? `Days off: ${off.map(fmtDay).join(", ")}` : "", p.note].filter(Boolean).join(". ");
}
["avFrom", "avTo", "avTz"].forEach((id) => $(id).addEventListener("change", () => { renderAvailability(); markDirty(); }));
$("avNote").addEventListener("input", () => { renderAvailability(); markDirty(); });
$("avClear").addEventListener("click", () => {
  setAllDay(false); av.days = []; av.offDates = []; $("avNote").value = ""; $("avHol").checked = false;
  renderAvailability(); markDirty();
});

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
  const holidays = { on: $("avHol").checked, country: $("avHolCountry").value || "IN" };
  const offDates = av.offDates.filter((d) => d >= todayIso());
  if (!av.days.length && !note && !holidays.on && !offDates.length) return null;
  return { days: av.days, from: $("avFrom").value || "09:00", to: $("avTo").value || "18:00", tz: $("avTz").value, note, allDay: av.allDay, holidays, offDates };
}
function availabilityText() { return planToText(availabilityPlan()); }
function fillAvailability(a) {
  const p = a.availabilityPlan;
  av.days = Array.isArray(p?.days) ? p.days.map(Number) : [];
  $("avFrom").value = p?.from || "09:00";
  $("avTo").value = p?.to || "18:00";
  if (p?.tz && ![...$("avTz").options].some((o) => o.value === p.tz)) $("avTz").add(new Option(p.tz, p.tz));
  $("avTz").value = p?.tz || localTz;
  $("avNote").value = p ? p.note || "" : a.availability || ""; // older agents only had a text
  av.allDay = !!p?.allDay;
  av.offDates = Array.isArray(p?.offDates) ? [...p.offDates] : [];
  $("avHol").checked = !!p?.holidays?.on;
  fillHolidayCountries($("avHolCountry"), p?.holidays?.country || "IN");
  renderAvailability();
}
function renderAvailability() {
  $("avDays").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(av.days.includes(Number(b.dataset.day)))));
  $("av247").setAttribute("aria-pressed", String(av.allDay));
  document.querySelectorAll(".av-quick [data-days]").forEach((b) => b.setAttribute("aria-pressed", String(!av.allDay && b.dataset.days !== "" && b.dataset.days === av.days.join(","))));
  document.querySelector(".tab-panel[data-panel=availability] .av-row").classList.toggle("locked", av.allDay);
  $("avHolWrap").hidden = !$("avHol").checked;
  const offBox = $("avOffList");
  offBox.innerHTML = "";
  for (const d of av.offDates.filter((x) => x >= todayIso())) {
    const chip = document.createElement("span");
    chip.className = "kw";
    chip.textContent = fmtDay(d);
    const x = document.createElement("button");
    x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", `Remove ${d}`);
    x.onclick = () => { av.offDates = av.offDates.filter((y) => y !== d); renderAvailability(); markDirty(); };
    chip.appendChild(x);
    offBox.appendChild(chip);
  }
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
  $("ttsProv").value = SETTINGS.models?.ttsProvider || "openai";
  $("sttProv").value = SETTINGS.models?.sttProvider || "openai";
  if ($("ttsProv").selectedOptions[0]?.disabled || !$("ttsProv").value) $("ttsProv").value = "openai"; // its keys were removed
  if ($("sttProv").selectedOptions[0]?.disabled || !$("sttProv").value) $("sttProv").value = "openai";
  fillSttModels(SETTINGS.models?.stt === "browser" ? "browser" : SETTINGS.models?.sttModel);
  fillTtsModels(SETTINGS.models?.tts);
  renderLangs(a.defaultLanguage || "en-US");
  if (ttsProv() === "openai") {
    if (!$("voice").options.length || $("voice").options[0].value === "") renderVoices(a.defaultVoice);
    else if (a.defaultVoice && state.voices?.[a.defaultVoice]) $("voice").value = a.defaultVoice;
  } else renderVoices(a.defaultVoice);
  $("speedRange").value = String(a.speechSpeed ?? 1);
  renderSpeed();
  state.playbookId = state.saved.some((p) => p.id === a.defaultPlaybookId) ? a.defaultPlaybookId : "";
  renderPlaybooks();
  setSelect($("llmSel"), SETTINGS.models.chat);
  $("calToggle").checked = !!SETTINGS.calendar?.enabled;
  $("emgToggle").checked = !!SETTINGS.emergency?.enabled;
  state.rules = structuredClone(SETTINGS.emergency?.rules || []);
  renderRules();
  fillNotify(SETTINGS.currentAgent?.notify);
  fillPersona();
  state.savedSnapshot = formSnapshot();
  state.calApp = SETTINGS.calendar?.app || "";
  state.calNowMin = SETTINGS.currentAgent?.calendarImmediateMin ?? null;
  renderCalApp();
  loadCalAccount();
  renderNotes();
  renderSummary();
  prepareGreeting();
}

const warnings = [];
if (!SR && !window.MediaRecorder) warnings.push("This browser can't capture speech. Use Chrome or Edge for voice, or type messages below.");
if (!window.isSecureContext) warnings.push("The microphone needs https or localhost. Open the https address shown when the app starts (e.g. https://<server IP>:8443).");
if (warnings.length) { $("warn").style.display = "block"; $("warn").textContent = warnings.join(" "); }

function applyBranding(b) {
  const t = b.theme || {};
  window.TSA_THEME?.apply(t); // the site theme the admin picked (themes.js)
  if (t.name === "custom") { // own brand colours instead of a ready-made theme
    const root = document.documentElement.style;
    if (t.primary) root.setProperty("--c1", t.primary);
    if (t.secondary) root.setProperty("--c2", t.secondary);
    if (t.tertiary) root.setProperty("--c3", t.tertiary);
  }
  if (b.appName) { document.title = b.appName; $("brandName").textContent = b.appName; }
  if (b.tagline) $("brandTagline").textContent = b.tagline;
  if (b.footer) $("brandFooter").textContent = b.footer;
  if (b.logo) $("brandLogo").style.setProperty("--logo-url", `url("${b.logo}")`);
  if (b.favicon) document.querySelector('link[rel="icon"]')?.setAttribute("href", b.favicon);
}

// ---------- playbooks: list, select, remove ----------
$("pbPick").addEventListener("change", () => { state.playbookId = $("pbPick").value; renderPlaybooks(); markDirty(); });
// ✕ next to the call page's playbook picker: back to the agent's own template
$("pbClear").addEventListener("click", () => { if (state.inCall) return; state.playbookId = ""; renderPlaybooks(); markDirty(); });

async function loadPlaybooks() {
  const data = await fetch("/api/playbooks").then((r) => r.json());
  state.types = data.types;
  state.saved = data.saved;
  if (state.playbookId && !state.saved.some((p) => p.id === state.playbookId)) state.playbookId = "";
  renderPlaybooks();
}

const activePlaybook = () => state.saved.find((p) => p.id === state.playbookId) || null;

function renderPlaybooks() {
  queueMicrotask(() => renderSummary()); // the 📘 chip on the agent card follows the chosen playbook
  const pick = $("pbPick");
  pick.innerHTML = "";
  pick.add(new Option("Default: the agent's template", ""));
  for (const pb of state.saved) pick.add(new Option(`${state.types[pb.type]?.icon || "📘"} ${pb.name}`, pb.id));
  pick.value = state.playbookId;
  pick.disabled = state.inCall;
  $("pbClear").hidden = !state.playbookId;
  $("pbClear").disabled = state.inCall;
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
  showTyping(phase === "thinking" && (state.inCall || !!state.session));
}

// Typing dots in the conversation while the agent is thinking (styles in motion.css).
function showTyping(on) {
  const t = $("typing");
  if (!on) { t?.remove(); return; }
  if (t) { $("msgs").appendChild(t); scrollDown(); return; }
  const el = document.createElement("div");
  el.id = "typing"; el.className = "typing"; el.setAttribute("aria-label", "Agent is typing");
  el.innerHTML = "<i></i><i></i><i></i>";
  $("msgs").appendChild(el);
  scrollDown();
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
  const typing = $("typing");
  if (role === "assistant") typing?.remove();
  if (typing && role !== "assistant") $("msgs").insertBefore(el, typing); // keep the dots last
  else $("msgs").appendChild(el);
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

// The summary box at the top of the Conversation card. Live: 🎯 latest intent (one line). Ended: 📋 the AI summary in up
// to 3 lines, and "More ▾" opens the full summary, its stats and the downloads (opts = {full, stats, links}).
function setConvSum(icon, text, turns, done, opts = {}) {
  const box = $("convSum");
  box.classList.toggle("idle", !text);
  box.classList.toggle("done", !!done);
  if (!done || opts.full != null) {
    $("convSumPre").textContent = opts.full || "";
    $("convSumStats").textContent = opts.stats || "";
    $("convSumActions").replaceChildren(...(opts.links || []));
    $("convSumMore").hidden = !opts.full;
    toggleConvSum(false);
  }
  $("convSumIco").textContent = icon;
  $("convSumText").textContent = text || "A short summary appears here as you talk.";
  $("convSumText").title = text || "";
  $("convSumTurns").textContent = turns ? `${turns} turn${turns === 1 ? "" : "s"}` : "";
}
function toggleConvSum(open) {
  $("convSum").classList.toggle("open", open);
  $("convSumFull").hidden = !open;
  $("convSumMore").textContent = open ? "Less ▴" : "More ▾";
  $("convSumMore").setAttribute("aria-expanded", String(open));
}
$("convSumMore").addEventListener("click", () => toggleConvSum(!$("convSum").classList.contains("open")));

// Conversation zoom: − / 100% / + scale the messages (zoom out = see more older messages at once). Kept per browser.
const ZOOM = { min: 0.6, max: 1.6, step: 0.1 };
function setChatZoom(z) {
  z = Math.round(Math.min(ZOOM.max, Math.max(ZOOM.min, z)) * 10) / 10;
  $("msgs").style.setProperty("--chat-zoom", z);
  $("zoomReset").textContent = Math.round(z * 100) + "%";
  $("zoomOut").disabled = z <= ZOOM.min;
  $("zoomIn").disabled = z >= ZOOM.max;
  try { localStorage.setItem("tsa-chat-zoom", String(z)); } catch {}
  state.chatZoom = z;
}
$("zoomOut").addEventListener("click", () => setChatZoom(state.chatZoom - ZOOM.step));
$("zoomIn").addEventListener("click", () => setChatZoom(state.chatZoom + ZOOM.step));
$("zoomReset").addEventListener("click", () => setChatZoom(1));
setChatZoom((() => { try { return parseFloat(localStorage.getItem("tsa-chat-zoom")) || 1; } catch { return 1; } })());

// The AI summary in a few lines (its "Summary:" line, else the outcome).
const shortSummary = (s) => {
  const line = /Summary:\s*(.+)/i.exec(s || "")?.[1] || /Outcome:\s*(.+)/i.exec(s || "")?.[1] || (s || "").split("\n")[0];
  return line.length > 400 ? line.slice(0, 397) + "…" : line;
};

function updateInsights() {
  const t = state.turns.filter((x) => !x.hidden);
  const last = t.at(-1);
  // One short line: what the caller wants (latest intent) while it runs; summarizeCall() puts the AI summary here at the end.
  const intent = [...t].reverse().find((x) => x.intent)?.intent;
  setConvSum(intent ? "🎯" : "📝", intent ? intent[0].toUpperCase() + intent.slice(1) : t.length ? "Listening to what the caller needs…" : "", t.length);
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
// the model's hidden markers: <intent:…> and, when it slips, the same in square brackets [intent:…]; never shown or spoken
const META_BRACKET = /\[(?:intent|mood|lang|user|hangup|calendar-check|calendar|message):[^\]]*(?:\]|$)/gi;
const stripTags = (t) => t.replace(META_BRACKET, "").replace(/<[a-z-]+:[^>]*>/gi, "").replace(/<[^>]*$/, "").replace(/\[[a-z]*\]?/gi, "").replace(/\s{2,}/g, " ").trimStart();

// ---------- speech output (OpenAI TTS, one request per sentence, fetched ahead) ----------
async function fetchSpeech(text, emotion, { voice = $("voice").value, language = lang(), provider = ttsProv(), model = $("ttsSel").value } = {}) {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, emotion, voice, lang: language, provider, model }),
  });
  if (!res.ok) throw new Error(await res.text());
  return URL.createObjectURL(await res.blob());
}

// Live replies are streamed: the <audio> element points at /api/tts/stream and starts playing while the mp3 is still
// arriving. Creating it starts the download, so sentences further down the queue load while this one plays.
const streamUrl = (text, emotion) => `/api/tts/stream?${new URLSearchParams({ text, emotion, voice: $("voice").value, lang: lang(), provider: ttsProv(), model: $("ttsSel").value, agentId: state.agentId || "" })}`;
function enqueueSpeech(text, emotion = "neutral", turn = null) {
  text = text.trim();
  if (!text || !/[\p{L}\p{N}]/u.test(text)) return;
  const audio = new Audio();
  audio.preload = "auto";
  audio.src = streamUrl(text, emotion);
  state.speakQueue.push({ text, emotion, turn, audio });
  if (!state.playing) speakNext();
}

async function speakNext() {
  if (!state.inCall && !voiceMode()) { state.playing = false; return; }
  const item = state.speakQueue.shift();
  if (!item) {
    state.playing = false;
    if (state.streamDone && state.calNote) { const n = state.calNote; state.calNote = null; sendUserText(n, { hidden: true }); return; } // the calendar answer
    if (!state.inCall) { if (state.streamDone) setPhase("idle", "Hold to talk"); return; } // voice chat: wait for the next hold
    if (state.streamDone) afterAgentTurn();
    return;
  }
  const gen = state.speechGen;
  state.playing = true;
  setPhase("speaking", `Speaking · ${item.emotion}`);
  setEmotion(item.emotion);
  startBargeWatch();
  let audio = item.audio, blobUrl = null;
  if (!audio) { // a prepared clip (the greeting): a blob URL
    blobUrl = await item.url;
    if (gen !== state.speechGen) { if (blobUrl) URL.revokeObjectURL(blobUrl); return; }
    if (!blobUrl) return fallbackSpeak(item, gen);
    audio = new Audio(blobUrl);
  }
  audio.preservesPitch = true;
  audio.playbackRate = speed();
  state.audio = audio;
  routeToMixer(audio);
  let started = false, finished = false;
  audio.onplaying = () => { if (!started) { started = true; markVoiceStart(item.turn); } };
  const finish = (failed) => {
    if (finished) return;
    finished = true;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    if (gen !== state.speechGen) return;
    if (failed && !started) fallbackSpeak(item, gen); // speech service failed: read it with the browser voice
    else speakNext();
  };
  audio.onended = () => finish(false);
  audio.onerror = () => finish(true);
  audio.play().catch(() => finish(true));
}

// Agent finished talking: hang up if the caller said goodbye, otherwise listen again.
function afterAgentTurn() {
  if (!state.inCall) return;
  if (state.calWaiting || state.calNote) return; // a calendar check is running; its answer continues the call
  if (state.pendingHangup || state.silenceEnding) {
    setPhase("idle", "Ending call…");
    const reason = state.silenceEnding ? "no answer from the caller" : "caller said goodbye";
    setTimeout(() => endCall(reason), CONFIG.hangupDelayMs);
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
  u.rate = speed();
  u.onend = u.onerror = () => { if (gen === state.speechGen) speakNext(); };
  speechSynthesis.speak(u);
}

function stopSpeaking() {
  state.speechGen++;
  for (const item of state.speakQueue) {
    if (item.audio) { item.audio.removeAttribute("src"); item.audio.load(); } // stop downloading
    else item.url?.then((u) => u && URL.revokeObjectURL(u));
  }
  state.speakQueue = [];
  if (state.audio) { state.audio.pause(); state.audio.removeAttribute("src"); state.audio.load(); state.audio = null; }
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
    a.preservesPitch = true;
    a.playbackRate = speed();
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
//    watched (voice activity detection). Browser speech recognition runs alongside only to write live captions.
// 2. When the caller has been quiet for responseDelayMs after speaking, the whole recording goes to OpenAI
//    speech-to-text, which hears far more accurately; it replaces the live words in the caller's bubble.
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
  liveBubble(u);
  setLiveWords(u.bubble, text);
}

// ---------- the caller's live bubble (styles in motion.css) ----------
// It appears as soon as the caller starts talking: 🎙 with ripples (they grow with the voice) + "Listening…",
// the live captions write in word by word, and when the caller stops the accurate transcript replaces them
// in place (finalizeBubble): words that changed flash softly. No "corrected" chip.
function liveBubble(u) {
  if (u.bubble) return u.bubble;
  const el = addMsg("user", "");
  el.firstChild.remove();
  el.classList.add("live");
  el.insertAdjacentHTML("afterbegin", `<div class="live-head"><span class="live-mic" aria-hidden="true">🎙</span>Listening…</div><div class="txt"></div>`);
  u.bubble = el;
  scrollDown();
  return el;
}

function setLiveWords(el, text) {
  const txt = el?.querySelector(".txt");
  if (!txt) return;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const have = [...txt.children].map((s) => s.textContent.trim());
  if (!have.every((w, i) => w === words[i])) { txt.textContent = ""; have.length = 0; } // the captions changed earlier words
  for (const w of words.slice(have.length)) {
    const s = document.createElement("span");
    s.className = "w"; s.textContent = w + " ";
    txt.appendChild(s);
  }
  scrollDown();
}

function finalizeBubble(el, draft, text) {
  const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const before = new Set((draft || "").split(/\s+/).map(norm));
  el.querySelector(".live-head")?.remove();
  const txt = el.querySelector(".txt");
  txt.textContent = "";
  text.split(/\s+/).forEach((w, i) => {
    if (i) txt.appendChild(document.createTextNode(" "));
    const s = document.createElement("span");
    s.textContent = w;
    if (draft && !before.has(norm(w))) s.className = "fix";
    txt.appendChild(s);
  });
  el.classList.remove("live");
  el.classList.add("settle");
  el.style.removeProperty("--lv");
  scrollDown();
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
  const lvl = micLevel();
  if (lvl > (stt.vadThreshold ?? 0.015)) {
    u.speechMs += 50; u.lastVoiceAt = t;
    if (u.spec) u.spec.after += 50; // speech after the early transcription started
  }
  const spoke = u.speechMs >= (stt.minSpeechMs ?? 250) || !!u.srText;
  if (spoke) liveBubble(u).style.setProperty("--lv", Math.min(1, lvl * 12).toFixed(2)); // 🎙 grows with the voice
  // After a short pause, start transcribing what was said so far; if the caller stays quiet, the text is ready when
  // the reply wait ends. Speaking again throws it away.
  if (u.spec && u.spec.after >= 150) u.spec = null; // they really spoke again (a short noise doesn't count): transcribe again later
  if (spoke && u.lastVoiceAt && !u.spec && u.recorder && sttOn() && t - u.lastVoiceAt >= 400) startEarlyTranscribe(u);
  // Nobody has said anything for conversation.silenceRetrySeconds: the agent checks in (or hangs up after the re-asks).
  const retryS = Number(CONFIG.silenceRetrySeconds) || 0;
  if (retryS > 0 && !spoke && state.listenSince && t - state.listenSince >= retryS * 1000) return silencePrompt(retryS);
  if (spoke && u.lastVoiceAt && t - u.lastVoiceAt >= CONFIG.responseDelayMs) return commitUtterance();
  if (t - u.startedAt > (stt.maxUtteranceSeconds ?? 60) * 1000) {
    if (spoke) return commitUtterance();
    stopRecorder(u); startUtterance(); // long silence: start a fresh recording so it stays small
  }
}

function startEarlyTranscribe(u) {
  const r = u.recorder;
  const spec = { voiceAt: u.lastVoiceAt, after: 0 };
  spec.promise = new Promise((resolve) => {
    const go = () => resolve(u.chunks.length ? transcribe(new Blob(u.chunks, { type: r.mimeType })).catch(() => null) : null);
    if (r.state !== "recording") return go();
    const prev = r.ondataavailable;
    r.ondataavailable = (e) => { prev(e); r.ondataavailable = prev; go(); };
    try { r.requestData(); } catch { r.ondataavailable = prev; go(); } // flush the last few hundred ms first
  });
  u.spec = spec;
}

// The caller stayed silent: ask the agent to check in ("[no response]"), or, after conversation.silenceRetries
// check-ins, to say goodbye and hang up ("[no response, end call]"). Both settings live in MySQL (app_config).
function silencePrompt(seconds) {
  state.silenceCount = (state.silenceCount || 0) + 1;
  const retries = Number.isFinite(Number(CONFIG.silenceRetries)) ? Number(CONFIG.silenceRetries) : 2;
  const last = state.silenceCount > retries;
  stopListening();
  state.silenceEnding = last; // hang up after this goodbye even if the model forgets <hangup:yes>
  addDivider(last ? `🔇 Still no answer · ending the call` : `🔇 No answer for ${seconds} s · checking in (${state.silenceCount} of ${retries})`);
  sendUserText(last ? "[no response, end call]" : "[no response]", { hidden: true });
}

function startListening() {
  if (!state.inCall) return;
  state.listenSince = now();
  clearInterval(state.vadTimer);
  discardUtterance(); // the barge-in recording made while the agent spoke (nobody talked over it)
  setPhase("listening");
  if (state.muted) return;
  startUtterance();
  safeStart();
  clearInterval(state.vadTimer);
  state.vadTimer = setInterval(vadTick, 50);
}

// ---------- barge-in: the caller can talk over the agent ----------
// While the agent speaks, the mic keeps recording and its level is watched. Loud enough for long enough (well above
// the agent's own echo, which the browser's echo cancellation mostly removes) → the agent stops at once and listens.
// The recording already holds the caller's first words, so nothing they said is lost.
function startBargeWatch() {
  if (state.barge || !state.inCall || state.muted || !state.micAnalyser || CONFIG.bargeIn === false) return;
  startUtterance();
  state.utter.barge = true;
  state.barge = { loud: 0, floor: 0 };
  clearInterval(state.vadTimer);
  state.vadTimer = setInterval(bargeTick, 50);
}
function bargeTick() {
  const b = state.barge;
  if (!b || state.muted || !state.playing || state.phase !== "speaking") return;
  const level = micLevel();
  const trigger = Math.max(Number(CONFIG.bargeInLevel) || 0.035, b.floor * 3, (SETTINGS.speechToText?.vadThreshold ?? 0.015) * 2.5);
  if (level > trigger) b.loud += 50;
  else { b.loud = Math.max(0, b.loud - 25); b.floor = b.floor * 0.9 + level * 0.1; } // echo and room noise level
  if (b.loud >= (Number(CONFIG.bargeInMs) || 300)) bargeIn();
}
function bargeIn() {
  const u = state.utter;
  state.barge = null;
  const turn = [...state.turns].reverse().find((t) => t.bubble);
  if (turn?.bubble) addChip(turn.bubble, "✋ interrupted", "interrupted");
  if (state.abort) state.abort.abort(); // stop the reply that is still being written (what was said stays in the history)
  stopSpeaking();
  state.streamDone = true;
  state.pendingHangup = false;
  state.silenceEnding = false; // they spoke after all: keep the call going
  setPhase("listening");
  if (u) { u.barge = false; u.speechMs = Number(CONFIG.bargeInMs) || 300; u.lastVoiceAt = now(); }
  else startUtterance();
  safeStart();
  clearInterval(state.vadTimer);
  state.vadTimer = setInterval(vadTick, 50);
}
function discardUtterance() {
  const u = state.utter;
  state.barge = null;
  if (!u?.barge) return;
  state.utter = null;
  if (u.recorder && u.recorder.state !== "inactive") { try { u.recorder.stop(); } catch {} }
}

// Stop listening and throw away anything not yet sent.
function stopListening() {
  state.barge = null;
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

// AWS Transcribe takes raw PCM: decode the recording and resample it to 16 kHz mono 16-bit WAV.
async function toWav16k(blob) {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.ceil(decoded.duration * 16000);
    const off = new OfflineAudioContext(1, Math.max(1, frames), 16000);
    const src = off.createBufferSource();
    src.buffer = decoded; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
    const w = (o, str) => [...str].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true);
    v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
    return new Blob([buf], { type: "audio/wav" });
  } finally {
    ctx.close();
  }
}

async function transcribe(blob) {
  const lastAgent = [...state.history].reverse().find((m) => m.role === "assistant");
  const provider = sttProv();
  if (provider === "aws") { try { blob = await toWav16k(blob); } catch (e) { console.warn("Couldn't convert to WAV for AWS:", e); } }
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio: await blobToBase64(blob), mime: blob.type, lang: lang(), provider, context: lastAgent ? stripTags(lastAgent.content) : "" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Transcription failed");
  return data.text;
}

// The caller finished speaking: get the accurate text, put it in the caller's bubble, and reply.
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

  let text = u.srText, sttMs = null, unchecked = false;
  const early = u.spec ? u.spec.promise : null; // started during the silence, still covers everything that was said
  const blob = await stopRecorder(u);
  if (blob && sttOn()) {
    // the early result if it has words; else the whole recording; one retry if the service fails
    let heard = early ? await early : null;
    for (let attempt = 0; !(heard && heard.trim()) && attempt < 2; attempt++) {
      try { heard = await transcribe(blob); }
      catch (e) { console.warn(`Transcription failed (try ${attempt + 1}):`, e); heard = null; if (!attempt) await new Promise((r) => setTimeout(r, 400)); }
    }
    sttMs = Math.round(now() - t0);
    if (heard && heard.trim()) text = heard;
    else unchecked = !!(text && text.trim()); // only the browser's live captions: shown, but marked
  }
  text = (text || "").trim();
  if (!state.inCall) { u.bubble?.remove(); return; }
  if (!text || !/[\p{L}\p{N}]/u.test(text)) { u.bubble?.remove(); startListening(); return; } // just noise
  if (u.bubble) finalizeBubble(u.bubble, u.srText, text);
  else u.bubble = addMsg("user", text);
  if (sttMs != null) u.bubble.querySelector(".timing").textContent = `🎙 transcribed in ${fmtS(sttMs)}`;
  if (unchecked) addChip(u.bubble, "⚠ not double-checked (live captions only)", "unchecked");
  sendUserText(text, { bubble: u.bubble, t0 });
}

// ---------- talking to the backend ----------
const SENTENCE_END = /([.!?।॥。！？؟\n])\s*/;
// The first chunk of a reply may end at a comma (at least two words), so the agent starts talking sooner.
const CLAUSE_END = /[,;:–—،、，]\s+/g;
function firstClause(text) {
  CLAUSE_END.lastIndex = 0;
  let m;
  while ((m = CLAUSE_END.exec(text))) {
    const words = stripTags(text.slice(0, m.index)).trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return m;
  }
  return null;
}

function renderTiming(turn) {
  if (!turn.bubble) return;
  // Agent bubbles show just "Name · time · ⏱ reply time" (how long until the caller heard the agent).
  const meta = turn.bubble.querySelector(".meta");
  if (!meta.dataset.base) meta.dataset.base = meta.textContent;
  const took = turn.firstVoice ?? turn.firstText;
  meta.textContent = meta.dataset.base + (took != null ? ` · ⏱ ${fmtS(took)}` : "");
  meta.title = `First words ${fmtS(turn.firstText)} · voice ${fmtS(turn.firstVoice)} · full reply ${fmtS(turn.total)}`;
}

async function sendUserText(text, { hidden = false, bubble = null, t0 = null } = {}) {
  if (!hidden) { state.silenceCount = 0; state.silenceEnding = false; } // the caller spoke: start the silence count again
  state.listenSince = 0;
  stopListening();
  stopSpeaking();
  if (state.abort) state.abort.abort();

  const userBubble = hidden ? null : bubble || addMsg("user", text);
  state.history.push({ role: "user", content: text });
  setPhase("thinking");

  const emergency = hidden ? null : detectEmergency(text);
  if (emergency) showEmergency(emergency);
  state.pendingCalendar = [];
  state.pendingChecks = [];
  state.pendingMessages = [];
  if (!hidden) state.calChain = 0;
  const calTurn = !hidden || text.startsWith("[calendar"); // the agent may book after the app's calendar note
  const turn = { t0: t0 ?? performance.now(), hidden, emergency, bubble: null, firstText: null, firstVoice: null, total: null };
  state.turns.push(turn);
  const controller = new AbortController();
  state.abort = controller;
  state.streamDone = false;
  let raw = "", pending = "", emotion = "neutral";

  // Pull <intent:..><mood:..><lang:..> out of the stream as soon as each is complete.
  const readMeta = () => {
    const meta = (_, k, v) => {
      k = k.toLowerCase() === "user" ? "mood" : k.toLowerCase();
      if (k === "calendar-check") {
        if (calTurn && SETTINGS.calendar?.enabled) state.pendingChecks.push(v);
        return "";
      }
      if (k === "calendar") {
        if (calTurn && SETTINGS.calendar?.enabled) state.pendingCalendar.push(v);
        return "";
      }
      if (k === "message") {
        if (!hidden) state.pendingMessages.push(v);
        return "";
      }
      if (k === "hangup") {
        if (/^y/i.test(v.trim()) && (!hidden || text.startsWith("[no response"))) { turn.hangup = true; state.pendingHangup = state.inCall; }
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
    };
    pending = pending.replace(/<(intent|mood|lang|user|hangup|calendar-check|calendar|message):([^>]*)>/gi, meta)
      .replace(/\[(intent|mood|lang|user|hangup|calendar-check|calendar|message):([^\]]*)\]/gi, meta);
  };

  // Speak one finished sentence in the emotion tagged in front of it.
  const flushSentence = (chunk) => {
    const tags = [...chunk.matchAll(/\[([a-z]+)\]/gi)];
    if (tags.length) emotion = tags.at(-1)[1].toLowerCase();
    const clean = stripTags(chunk).trim();
    if (!clean) return false;
    if (state.inCall || voiceMode()) enqueueSpeech(clean, emotion, turn);
    return true;
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
        if (/<[^>]*$/.test(pending) || /\[(intent|mood|lang|user|hangup|calendar-check|calendar|message):[^\]]*$/i.test(pending)) continue; // wait until a tag is complete before splitting sentences
        let m;
        while ((m = SENTENCE_END.exec(pending)) || (!turn.firstChunk && (m = firstClause(pending)))) {
          const cut = m.index + m[0].length;
          if (flushSentence(pending.slice(0, cut))) turn.firstChunk = true;
          pending = pending.slice(cut);
        }
      }
    }
    readMeta();
    flushSentence(pending);
    turn.total = Math.round(performance.now() - turn.t0);
    renderTiming(turn);
    const booking = state.pendingCalendar[0], check = state.pendingChecks[0];
    state.pendingCalendar = []; state.pendingChecks = [];
    if (booking) addCalendarEvent(booking, turn);
    else if (check) checkCalendarSlot(check, turn);
    else if (state.calOffer && !state.calOffer.nudged && /\b(booked|all set|scheduled|confirmed|done)\b/i.test(stripTags(raw))) {
      // safety net: the agent said it's booked but wrote no booking tag, so nothing was booked; ask it to add the tag now
      state.calOffer.nudged = true;
      sendCalendarNote(`[calendar: nothing is booked yet: your last reply had no booking tag. If the caller said yes, reply with only a very short line like "Done." `
        + `and the tag <calendar:TITLE|${state.calOffer.local}|${state.calOffer.minutes}|EMAIL>.]`);
    }
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
      if (!state.inCall && !state.playing && !state.speakQueue.length) setPhase("idle", state.mode === "chat" ? "Ready to chat" : undefined);
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

// ---------- instant greeting ----------
// The first line is known before the call (the agent's greeting), so it is fetched with its audio as soon as the agent
// is selected or saved, and Start call speaks it at once instead of waiting for the LLM and TTS.
const greetKey = () => [state.agentId, lang(), $("voice").value, agentName(), JSON.stringify(personaPayload())].join("|");
function prepareGreeting() {
  if (state.inCall || !state.agentId) return null;
  const key = greetKey();
  if (state.greet?.key === key) return state.greet;
  const g = { key };
  g.ready = (async () => {
    const res = await fetch("/api/greeting", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: lang(), assistantName: agentName() }) });
    const d = await res.json();
    if (!res.ok || !d.text) throw new Error(d.error || "No greeting");
    g.text = d.text; g.language = d.language; g.emotion = d.emotion || "cheerful";
    g.url = await fetchSpeech(d.text, g.emotion);
    return g;
  })();
  g.ready.catch(() => { if (state.greet === g) state.greet = null; });
  state.greet = g;
  return g;
}
async function speakGreeting(g) {
  let ready = null;
  try { ready = await Promise.race([g.ready, new Promise((r) => setTimeout(() => r(null), 6000))]); } catch {}
  if (!state.inCall) return;
  state.greet = null; // its audio is played (and released) now
  if (!ready?.url) return sendUserText("[call connected]", { hidden: true }); // not ready: let the LLM greet
  const turn = { t0: performance.now(), hidden: true, emergency: null, bubble: null, firstText: 0, firstVoice: null, total: 0 };
  state.turns.push(turn);
  state.history.push({ role: "user", content: "[call connected]" });
  state.history.push({ role: "assistant", content: `<intent:call start><mood:neutral><lang:${ready.language}>[${ready.emotion}] ${ready.text}` });
  turn.bubble = addMsg("assistant", ready.text);
  state.streamDone = true;
  state.speakQueue.push({ text: ready.text, emotion: ready.emotion, turn, url: Promise.resolve(ready.url) });
  if (!state.playing) speakNext();
}

// ---------- call controls ----------
async function startCall() {
  if (!state.agentId) { openAgentDialog(); return; } // no agent yet: create one first
  if (state.mode !== "call" || state.session) await setTalkMode("call"); // ends a running chat first
  state.alerted = new Set(); // emergency contacts alerted during this call
  const greet = prepareGreeting(); // usually ready already; if not, it loads while the mic opens
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
  state.silenceCount = 0;
  state.silenceEnding = false;
  state.srFallback = 0;
  state.inCall = true; renderAgents(); renderTalk();
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
  // The agent greets first: the prepared greeting plays at once (the LLM greets only if it isn't ready).
  if (greet) speakGreeting(greet);
  else sendUserText("[call connected]", { hidden: true });
}

async function endCall(endedBy = "ended by you") {
  if (!state.inCall) return;
  state.inCall = false; renderAgents(); renderTalk();
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
  setTimeout(() => prepareGreeting(), 500); // ready for the next call
}

// ---------- call summary ----------
async function summarizeCall(duration, recording, endedBy) {
  // Snapshot what belongs to this call: the page may already be on the next chat (or cleared) while this is saved.
  const startedAt = state.callStartedAt, tokens = { ...state.callTokens }, playbookId = state.playbookId;
  const turns = state.history.filter((m) => !/^\[(call connected|no response[^\]]*)\]$/.test(m.content)); // app markers, not the caller's words
  const callerTurns = state.turns.filter((t) => !t.hidden);
  const pb = activePlaybook();
  const times = callerTurns.map((t) => t.firstVoice ?? t.firstText).filter((x) => x != null);
  const avg = times.length ? fmtS(times.reduce((a, b) => a + b, 0) / times.length) : "—";
  const langs = [...new Set(callerTurns.map((t) => t.lang).filter(Boolean))].join(", ") || "—";
  const moods = callerTurns.map((t) => t.mood).filter(Boolean);
  const moodPath = moods.length ? [...new Set([moods[0], moods.at(-1)])].join(" → ") : "—";
  const statsLine = `${pb ? pb.name : "Default agent"} · ${duration} · ${callerTurns.length} turns · avg response ${avg} · ${langs} · mood ${moodPath}`;

  // The summary goes in the box at the top of the Conversation card (not as a card in the chat).
  const links = recording ? [downloadLink(recording.url, recording.name, "⬇ Recording")] : [];
  if (!callerTurns.length) {
    setConvSum("📋", "Ended before the caller said anything.", 0, true, { full: "", stats: statsLine, links });
    $("convSumMore").hidden = !links.length;
    return;
  }
  setConvSum("⏳", "Writing the summary…", callerTurns.length, true, { full: "", stats: statsLine, links });
  let summaryText = "";
  try {
    const res = await fetch("/api/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: turns, playbookId, lang: lang(), duration }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Summary failed");
    summaryText = data.summary;
    if (data.usage) { tokens.input += data.usage.input || 0; tokens.output += data.usage.output || 0; tokens.total += data.usage.total || 0; }

    let i = 0;
    const transcript = turns.map((m) => {
      if (m.role === "user") {
        const t = callerTurns[i++] || {};
        return `Caller: ${m.content}\n   [intent: ${t.intent || "?"} | mood: ${t.mood || "?"} | language: ${t.lang || "?"} | response: ${fmtS(t.firstVoice ?? t.firstText)}]`;
      }
      return `${agentName()}: ${stripTags(m.content)}`;
    }).join("\n");
    const file = `CALL SUMMARY\n${statsLine}\n${startedAt?.toLocaleString() || ""}\n\n${data.summary}\n\n--- Transcript ---\n${transcript}\n`;
    const url = URL.createObjectURL(new Blob([file], { type: "text/plain" }));
    links.push(downloadLink(url, `call-summary-${localStamp()}.txt`, "⬇ Summary + transcript"));
    setConvSum("📋", shortSummary(data.summary), callerTurns.length, true, { full: data.summary, stats: statsLine, links });
  } catch (e) {
    setConvSum("⚠️", "Couldn't write the summary: " + e.message, callerTurns.length, true, { full: "", stats: statsLine, links });
  }

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
        startedAt: startedAt?.toISOString(), duration, endedBy,
        channel: endedBy === "live chat" ? "chat" : endedBy === "voice chat" ? "voice" : "call",
        playbook: pb ? { name: pb.name, icon: t?.icon, type: t?.name } : null,
        language: $("lang").selectedOptions[0]?.text, voice: $("voice").value, agentName: agentName(),
        stats: {
          turns: callerTurns.length, avgResponse: avg, languages: langs, moodPath,
          avgResponseMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
          intents: [...new Set(callerTurns.map((x) => x.intent).filter(Boolean))],
          tokens: { ...tokens },
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
    card.querySelector(".stats").textContent += ` · ${tokens.total.toLocaleString()} tokens · saved to call summaries`;
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

// ---------- the agent on the call card ----------
const freq = new Uint8Array(128);
let smoothLevel = 0;

// The cartoon agent (agent-face.js: a woman for female voices, a man for male voices) follows the call: phase, the emotion of the sentence being spoken, and the
// loudness of the voice (the agent's while speaking, the caller's while listening) for the lip-sync and the glow.
AgentFace.mount($("avatar"));

function drawViz(ts) {
  let level = 0;
  if (state.analyser && (state.phase === "speaking" || state.phase === "listening")) {
    state.analyser.getByteFrequencyData(freq);
    for (let i = 0; i < 64; i++) level += freq[i];
    level = level / (64 * 255);
  }
  if (!state.analyser && state.phase === "speaking") level = Math.max(0, Math.sin(ts / 85) * .22 + Math.sin(ts / 37) * .13 + Math.sin(ts / 211) * .1);
  smoothLevel += (level - smoothLevel) * 0.25;
  const lv = Math.min(1, smoothLevel * 2.2);
  $("avatar").style.setProperty("--level", lv.toFixed(3));
  // female or male character from the voice's label in the backend's voice list, e.g. "… (male)" (no-op when unchanged)
  AgentFace.setCharacter($("voice").selectedOptions[0]?.text);
  AgentFace.frame(ts, { phase: state.phase, emotion: state.emotion, level: lv, muted: state.muted });
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

// ---------- how to talk: 📞 Web call (default) · 💬 Live chat · 🎤 Voice chat · WhatsApp ----------
// Live chat and Voice chat are "sessions": they start with the agent's greeting, use the same agent brain (/api/chat),
// and End & save writes them to Call summaries like a call (summary, WhatsApp/email delivery). Voice chat records while
// the button is held, transcribes with the agent's speech-to-text provider and the agent answers out loud.
state.mode = "call";
const voiceMode = () => state.mode === "voice";
function renderTalk() {
  document.querySelectorAll("#talkModes button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.talk === state.mode)));
  document.querySelectorAll(".talk-pane").forEach((p) => (p.hidden = p.dataset.talk !== state.mode));
  $("chatEnd").hidden = !(state.session?.kind === "chat");
  $("voiceEnd").hidden = !(state.session?.kind === "voice");
  if (!state.inCall && !state.session && state.phase !== "thinking" && !state.playing)
    setPhase("idle", { call: "Ready to call", chat: "Ready to chat", voice: "Hold to talk", whatsapp: "Ready to send" }[state.mode]);
}
// Choosing another way to talk ends what's running first: a call is hung up, a chat is saved (End & save).
const TALK_NAMES = { call: "Web call", chat: "Live chat", voice: "Voice chat", whatsapp: "WhatsApp" };
async function setTalkMode(m) {
  if (m === state.mode) return;
  if (state.holding) await holdEnd();
  if (state.inCall) await endCall(`switched to ${TALK_NAMES[m]}`);
  if (state.session) await endSession();
  stopSpeaking();
  clearChat(); // the next channel starts with an empty conversation (the previous one is saved in Call summaries)
  if (state.mode === "voice" && m !== "voice") { state.vcStream?.getTracks().forEach((t) => t.stop()); state.vcStream = null; state.vcMuted = false; renderVcMute(); }
  state.mode = m;
  renderTalk();
}
$("talkModes").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-talk]");
  if (!b || b.dataset.talk === state.mode) return;
  await setTalkMode(b.dataset.talk);
  if (state.mode === "chat") setTimeout(() => $("chatIn").focus(), 30);
  if (state.mode === "whatsapp") setTimeout(() => ($("waTo").value ? $("waText") : $("waTo")).focus(), 30);
});

const fmtDur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
async function startSession(kind) {
  if (state.session) return;
  if (!state.agentId) { openAgentDialog(); throw new Error("no agent"); }
  clearChat();
  state.session = { kind, startedAt: Date.now() };
  state.history = []; state.turns = [];
  state.callTokens = { input: 0, output: 0, total: 0 };
  state.callStartedAt = new Date();
  updateInsights();
  const pb = activePlaybook();
  addDivider(`${kind === "chat" ? "💬 Live chat" : "🎤 Voice chat"} started · ${pb ? pb.name : "Default agent"} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  renderTalk();
  // the agent greets first (the prepared greeting; spoken in Voice chat)
  let g = null;
  if (kind === "voice") { // spoken: use the prepared greeting (text + audio) when it's ready in time
    try { g = await Promise.race([prepareGreeting()?.ready, new Promise((r) => setTimeout(() => r(null), 4000))]); } catch {}
  }
  if (!g?.text) { // text only (Live chat, or the audio isn't ready): just the greeting's words
    try {
      const r = await fetch("/api/greeting", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: lang(), assistantName: agentName() }) });
      const d = await r.json();
      if (r.ok && d.text) g = { text: d.text, language: d.language, emotion: d.emotion || "cheerful" };
    } catch {}
  }
  if (!g?.text || !state.session) return;
  const turn = { t0: performance.now(), hidden: true, emergency: null, bubble: null, firstText: 0, firstVoice: null, total: 0 };
  state.turns.push(turn);
  state.history.push({ role: "user", content: "[call connected]" });
  state.history.push({ role: "assistant", content: `<intent:call start><mood:neutral><lang:${g.language}>[${g.emotion}] ${g.text}` });
  turn.bubble = addMsg("assistant", g.text);
  if (kind === "voice") { state.streamDone = true; enqueueSpeech(g.text, g.emotion, turn); }
  state.greet = null;
}
async function endSession() {
  const ses = state.session;
  if (!ses) return;
  if (state.abort) state.abort.abort();
  stopSpeaking();
  state.session = null;
  const duration = fmtDur(Date.now() - ses.startedAt);
  addDivider(`${ses.kind === "chat" ? "Live chat" : "Voice chat"} ended · ${duration}`);
  renderTalk();
  summarizeCall(duration, null, ses.kind === "chat" ? "live chat" : "voice chat");
  setTimeout(() => prepareGreeting(), 500);
}
$("chatEnd").addEventListener("click", endSession);
$("voiceEnd").addEventListener("click", endSession);

// 💬 Live chat
$("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("chatIn").value.trim();
  if (!text) return;
  $("chatIn").value = "";
  try { await startSession("chat"); } catch { return; }
  sendUserText(text);
});

// 🎤 Voice chat: hold to record, let go to send
async function voiceStream() {
  if (state.vcStream?.active) return state.vcStream;
  state.vcStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  return state.vcStream;
}
// 🔇 mute in Voice chat: the mic is off and holding does nothing until unmuted
state.vcMuted = false;
function renderVcMute() {
  $("vcMute").setAttribute("aria-pressed", String(state.vcMuted));
  $("vcMute").title = state.vcMuted ? "Unmute microphone" : "Mute microphone";
  $("vcMute").setAttribute("aria-label", $("vcMute").title);
  $("holdBtn").disabled = state.vcMuted;
  $("holdHint").innerHTML = state.vcMuted ? "🔇 <b>Muted.</b> Unmute to talk." : "<b>Hold</b> to talk, <b>let go</b> to send. The agent answers out loud.";
  if (state.mode === "voice" && !state.session && !state.playing) setPhase("idle", state.vcMuted ? "Muted" : "Hold to talk");
}
$("vcMute").addEventListener("click", async () => {
  state.vcMuted = !state.vcMuted;
  if (state.vcMuted && state.holding) { const h = state.holding; state.holding = null; $("holdBtn").classList.remove("rec"); try { h.rec.stop(); } catch {} } // drop what was being said
  state.vcStream?.getAudioTracks().forEach((t) => (t.enabled = !state.vcMuted));
  renderVcMute();
  if (state.vcMuted && state.session) setPhase("idle", "Muted");
});

async function holdStart(e) {
  e.preventDefault();
  if (state.holding || state.inCall || state.vcMuted) return;
  stopSpeaking(); if (state.abort) state.abort.abort();
  let stream;
  try { stream = await voiceStream(); } catch {
    $("holdHint").textContent = "⚠ Allow the microphone to use Voice chat (or use Live chat).";
    return;
  }
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
  state.holding = { rec, chunks, at: Date.now(), done: new Promise((r) => (rec.onstop = r)) };
  rec.start();
  $("holdBtn").classList.add("rec");
  setPhase("listening", "Listening… let go to send");
  renderTalk();
}
async function holdEnd() {
  const h = state.holding;
  if (!h) return;
  state.holding = null;
  $("holdBtn").classList.remove("rec");
  if (h.rec.state !== "inactive") h.rec.stop();
  await h.done;
  renderTalk();
  if (Date.now() - h.at < 400) { setPhase("idle", "Hold the button while you talk"); return; }
  const blob = new Blob(h.chunks, { type: h.rec.mimeType || "audio/webm" });
  setPhase("thinking", "Hearing you…");
  $("holdBtn").disabled = true;
  try {
    await startSession("voice");
    const t0 = performance.now();
    const text = (await transcribe(blob)).trim();
    if (!text || !/[\p{L}\p{N}]/u.test(text)) { setPhase("idle", "Didn't catch that, try again"); return; }
    const bubble = addMsg("user", text);
    addChip(bubble, "🎤 voice", "voice");
    sendUserText(text, { bubble, t0 });
  } catch (err) {
    if (String(err?.message) !== "no agent") addMsg("error", "Voice chat: " + (err?.message || err));
    setPhase("idle");
  } finally {
    $("holdBtn").disabled = state.vcMuted;
  }
}
$("holdBtn").addEventListener("pointerdown", holdStart);
["pointerup", "pointerleave", "pointercancel"].forEach((ev) => $("holdBtn").addEventListener(ev, holdEnd));
$("holdBtn").addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) holdStart(e); });
$("holdBtn").addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") holdEnd(); });
renderTalk();
renderVcMute();

// WhatsApp: send a typed message to a number (through the Telemune WhatsApp gateway)
// ---------- mobile numbers: country code (from the country_codes table) + national number ----------
const ccOf = (iso) => (state.countryCodes || []).find((c) => c.iso2 === iso);
function fillCc(sel, iso = sel.value || "IN") {
  if (!sel.options.length) for (const c of state.countryCodes || []) sel.add(new Option(`${c.flag} +${c.dial}`, c.iso2));
  if ([...sel.options].some((o) => o.value === iso)) sel.value = iso;
  sel.title = ccOf(sel.value)?.name || "";
}
// full number in digits (country code + national number without a leading 0), or an error text
function fullNumber(sel, input) {
  const c = ccOf(sel.value), local = input.value.replace(/[^\d]/g, "").replace(/^0+/, "");
  if (!c) return { error: "Pick a country code." };
  if (!local) return { error: "Enter the mobile number." };
  if (c.digits && local.length !== c.digits) return { error: `${c.name} mobile numbers have ${c.digits} digits (you typed ${local.length}).` };
  if (local.length < 6) return { error: "That number looks too short." };
  return { number: c.dial + local };
}
// a stored full number → country + national number (longest matching code; India before the US/Canada "1")
function splitNumber(digits) {
  digits = String(digits || "").replace(/[^\d]/g, "");
  const list = [...(state.countryCodes || [])].sort((a, b) => b.dial.length - a.dial.length || a.sort - b.sort);
  const c = list.find((x) => digits.startsWith(x.dial) && (!x.digits || digits.length - x.dial.length === x.digits)) || list.find((x) => digits.startsWith(x.dial));
  return c ? { iso: c.iso2, local: digits.slice(c.dial.length) } : { iso: "IN", local: digits };
}
["waCc", "nfWaCc"].forEach((id) => $(id).addEventListener("change", () => { $(id).title = ccOf($(id).value)?.name || ""; }));

$("waSend").addEventListener("click", async () => {
  const message = $("waText").value.trim();
  const num = fullNumber($("waCc"), $("waTo"));
  if (num.error) { $("waHint").textContent = "⚠ " + num.error; $("waTo").focus(); return; }
  const to = num.number, digits = to;
  if (!message) { $("waHint").textContent = "⚠ Write a message first."; $("waText").focus(); return; }
  $("waSend").disabled = true;
  $("waSend").querySelector("span").textContent = "Sending…";
  $("empty")?.remove();
  const el = document.createElement("div");
  el.className = "msg wa";
  el.innerHTML = `<div class="wa-head">${$("waSend").querySelector("svg").outerHTML}<span></span></div><div class="wa-text"></div><div class="chips"></div><div class="meta"></div>`;
  el.querySelector(".wa-head span").textContent = `WhatsApp to …${digits.slice(-4)}`;
  el.querySelector(".wa-text").textContent = message;
  el.querySelector(".meta").textContent = `${agentName()} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  $("msgs").appendChild(el); scrollDown();
  try {
    const r = await fetch("/api/whatsapp/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, message }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.error || "WhatsApp refused the message."); // {ok:false} = refused (HTTP 200)
    addChip(el, "✓ sent", "sent");
    loadHistory().catch(() => {});
    $("waHint").textContent = `✓ Sent to …${digits.slice(-4)} · saved in Call summaries.`;
    $("waText").value = "";
  } catch (err) {
    addChip(el, "⚠ not sent", "fail");
    loadHistory().catch(() => {});
    $("waHint").textContent = "⚠ " + err.message;
  } finally {
    $("waSend").disabled = false;
    $("waSend").querySelector("span").textContent = "Send on WhatsApp";
  }
});

// shown until the first call or chat: a small looping chat (CSS .chat-demo); removed by the first message
const EMPTY_CHAT = $("msgs").innerHTML.includes("chat-demo") ? $("msgs").innerHTML : '<div class="empty" id="empty">Start a call or a chat. Your conversation shows up here.</div>';
function clearChat() {
  if (state.abort) state.abort.abort();
  stopSpeaking();
  state.history = [];
  state.turns = [];
  updateInsights();
  $("msgs").innerHTML = EMPTY_CHAT;
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
  const bc = t.byChannel || {};
  $("hcAll").textContent = t.calls; $("hcCall").textContent = bc.call || 0; $("hcChat").textContent = bc.chat || 0;
  $("hcVoice").textContent = bc.voice || 0; $("hcWa").textContent = bc.whatsapp || 0;
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
  $("toggleHistory").textContent = open ? "Hide ▴" : "Show all ▾";
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

// Every channel is kept here: 📞 calls, 💬 live chats, 🎤 voice chats and WhatsApp messages (filter at the top).
const CHANNEL = {
  call: { icon: "📞", label: "Call", empty: "calls" }, chat: { icon: "💬", label: "Live chat", empty: "live chats" },
  voice: { icon: "🎤", label: "Voice chat", empty: "voice chats" }, whatsapp: { icon: "", label: "WhatsApp", empty: "WhatsApp messages" },
};
const waMini = () => document.querySelector("#histFilter .wa-mini").outerHTML;
state.histChannel = "";
$("histFilter").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-ch]");
  if (!b) return;
  state.histChannel = b.dataset.ch;
  state.historyPage = 1;
  $("histFilter").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  loadHistory();
});

async function loadHistory() {
  loadTotals().catch(() => {});
  const data = await fetch(`/api/calls?page=${state.historyPage}${state.histChannel ? `&channel=${state.histChannel}` : ""}`).then((r) => r.json());
  state.historyPage = data.page;
  const box = $("calls");
  box.innerHTML = "";
  if (!data.items.length && data.page > 1) { state.historyPage = data.page - 1; return loadHistory(); }
  if (!data.items.length) {
    box.innerHTML = `<div class="empty">No ${state.histChannel ? CHANNEL[state.histChannel].empty : "records"} yet. Finished calls, chats and WhatsApp messages show up here.</div>`;
  }
  for (const c of data.items) {
    const row = document.createElement("button");
    row.type = "button"; row.className = "call-row";
    row.innerHTML = `<div class="c-icon"></div><div><div class="c-title"></div><div class="c-sub"></div></div><div class="c-outcome"></div><div class="c-meta"></div>`;
    const ch = CHANNEL[c.channel] ? c.channel : "call";
    row.querySelector(".c-icon").textContent = c.playbook?.icon || "💬";
    if (ch === "whatsapp") row.querySelector(".c-icon").innerHTML = waMini().replace("wa-mini", "wa-mini wa-row");
    const title = row.querySelector(".c-title");
    const badge = document.createElement("span");
    badge.className = "ch-badge";
    badge.innerHTML = ch === "whatsapp" ? waMini() : "";
    badge.append(`${CHANNEL[ch].icon} ${CHANNEL[ch].label}`.trim());
    title.appendChild(badge);
    if (c.agentName) { const a = document.createElement("span"); a.className = "call-agent"; a.textContent = c.agentName; title.appendChild(a); }
    title.append(ch === "whatsapp" ? "Message" : c.playbook?.name || "Default agent");
    row.querySelector(".c-sub").textContent = ch === "whatsapp"
      ? `${fmtDate(c.startedAt)} · to +${c.stats?.to || "?"} · ${c.stats?.status === "sent" ? "✓ sent" : "⚠ not sent"}`
      : `${fmtDate(c.startedAt)} · ${c.duration} · ${c.stats?.turns ?? 0} turns`;
    row.querySelector(".c-outcome").textContent = ch === "whatsapp" ? (c.summary || "").split("\n\n").slice(1).join(" ").slice(0, 140) : outcomeOf(c.summary);
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
    del.title = "Delete"; del.setAttribute("aria-label", "Delete");
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
  const chn = CHANNEL[c.channel] || CHANNEL.call;
  $("callTitle").textContent = `${chn.icon ? chn.icon + " " : ""}${chn.label} · ${c.agentName ? c.agentName + " · " : ""}${c.channel === "whatsapp" ? "Message" : c.playbook?.name || "Default agent"} · ${fmtDate(c.startedAt)}`;
  const body = $("callBody");
  body.innerHTML = `<div class="stats"></div><pre></pre><div class="rec"></div><h4>Transcript</h4><div class="lines"></div><div class="actions"></div>`;
  const st = c.stats || {};
  body.querySelector(".stats").textContent = c.channel === "whatsapp"
    ? [`📱 to +${st.to || "?"}`, st.status === "sent" ? "✓ sent" : `⚠ not sent${st.error ? ": " + st.error : ""}`, st.messageId ? `id ${st.messageId}` : ""].filter(Boolean).join(" · ")
    : [
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
  del.className = "danger"; del.textContent = `🗑 Delete ${c.channel === "whatsapp" ? "record" : (CHANNEL[c.channel] || CHANNEL.call).label.toLowerCase()}`;
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

// ---------- speech providers (Voice & AI tab) ----------
// Speech-to-text: OpenAI, ElevenLabs Scribe, AWS Transcribe. Text-to-speech: OpenAI, AWS Polly, ElevenLabs, Cartesia.
// The backend says which are set up (keys.env) and which languages each supports (/api/config → providers). Models:
// OpenAI's from /api/models, the others' from the provider list. Voices: OpenAI's from /api/config, the others' from
// /api/voices (labels end with "(male)" / "(female)", which also picks the cartoon agent).
const ttsProv = () => $("ttsProv").value || "openai";
const sttProv = () => $("sttProv").value || "openai";
const provInfo = (kind, p) => state.providers?.[kind]?.[p] || { label: p, ready: p === "openai", models: [], langs: ["*"] };

function fillProviders() {
  for (const [kind, sel] of [["tts", $("ttsProv")], ["stt", $("sttProv")]]) {
    const keep = sel.value;
    sel.innerHTML = "";
    for (const [id, p] of Object.entries(state.providers?.[kind] || { openai: { label: "OpenAI", ready: true } })) {
      const o = new Option(p.ready ? p.label : `${p.label} · not set up`, id);
      o.disabled = !p.ready;
      sel.add(o);
    }
    sel.value = keep && [...sel.options].some((o) => o.value === keep && !o.disabled) ? keep : "openai";
  }
}

function fillModelSel(sel, list, keep, extra = []) {
  sel.innerHTML = "";
  for (const [v, l] of extra) sel.add(new Option(l, v));
  for (const id of list) sel.add(new Option(id, id));
  if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
  sel.title = sel.value;
}
function fillSttModels(keep = $("sttSel").value) {
  if (sttProv() === "openai") fillModelSel($("sttSel"), state.openaiModels?.stt || ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"], keep,
    [["browser", "Browser captions only (less accurate, never corrected)"]]);
  else fillModelSel($("sttSel"), provInfo("stt", sttProv()).models, keep);
}
function fillTtsModels(keep = $("ttsSel").value) {
  if (ttsProv() === "openai") fillModelSel($("ttsSel"), state.openaiModels?.tts || ["gpt-4o-mini-tts", "tts-1-hd", "tts-1"], keep);
  else fillModelSel($("ttsSel"), provInfo("tts", ttsProv()).models, keep);
}

// Languages both providers support, most-spoken first.
const supports = (langs, code) => !langs || langs.includes("*") || langs.includes(langBase(code));
function renderLangs(keep = $("lang").value) {
  const t = provInfo("tts", ttsProv()).langs, sttBrowser = $("sttSel").value === "browser", st = sttBrowser ? ["*"] : provInfo("stt", sttProv()).langs;
  const ok = [...LANGS].sort((a, b) => b[3] - a[3]).filter(([c]) => supports(t, c) && supports(st, c));
  const sel = $("lang");
  sel.innerHTML = "";
  ok.forEach(([c, label]) => sel.add(new Option(label, c)));
  const gone = !!keep && !ok.some(([c]) => c === keep);
  sel.value = !gone && keep ? keep : ok[0]?.[0] || "en-US";
  const names = `${provInfo("stt", sttProv()).label}${sttBrowser ? " (browser)" : ""} + ${provInfo("tts", ttsProv()).label}`;
  $("langHint").textContent = `(${ok.length}, most spoken first)`;
  $("provHint").textContent = gone
    ? `⚠ ${LANGS.find((l) => l[0] === keep)?.[1] || keep} isn't available with ${names}, so the language was set to ${sel.selectedOptions[0]?.text}.`
    : `${ok.length} languages work with ${names}.`;
  return gone;
}

// Voices of the TTS provider (cached per provider + language; Polly voices depend on the language).
async function renderVoices(keep = $("voice").value) {
  const p = ttsProv(), sel = $("voice");
  let list;
  if (p === "openai") list = Object.entries(state.voices || {}).map(([id, label]) => ({ id, label }));
  else {
    const key = `${p}|${p === "aws" ? lang() : ""}`;
    state.voiceLists ||= {};
    if (!state.voiceLists[key]) {
      sel.innerHTML = ""; sel.add(new Option("Loading voices…", ""));
      try {
        const r = await fetch(`/api/voices?provider=${encodeURIComponent(p)}&lang=${encodeURIComponent(lang())}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Couldn't load voices");
        state.voiceLists[key] = d.voices || [];
      } catch (e) {
        sel.innerHTML = ""; sel.add(new Option("⚠ " + e.message, ""));
        $("provHint").textContent = "⚠ " + e.message;
        return;
      }
    }
    list = state.voiceLists[key];
    if (ttsProv() !== p) return; // the provider changed while loading
  }
  sel.innerHTML = "";
  for (const v of list) sel.add(new Option(v.label, v.id));
  if (!list.length) sel.add(new Option(p === "aws" ? "No Polly voice for this language" : "No voices", ""));
  sel.value = keep && list.some((v) => v.id === keep) ? keep : list[0]?.id || "";
  if (state.savedSnapshot && sel.value !== keep) markDirty();
  renderSummary();
}

$("ttsProv").addEventListener("change", async () => {
  fillTtsModels(""); renderLangs(); await renderVoices(""); prepareGreeting(); markDirty();
});
$("sttProv").addEventListener("change", () => { fillSttModels(""); if (renderLangs() && ttsProv() === "aws") renderVoices(); markDirty(); });
$("sttSel").addEventListener("change", () => { if (renderLangs() && ttsProv() === "aws") renderVoices(); });

async function loadModels() {
  const m = await fetch("/api/models").then((r) => r.json());
  state.openaiModels = m;
  fillModelSel($("llmSel"), m.chat, $("llmSel").value || SETTINGS.models?.chat);
  fillSttModels($("sttSel").value || (SETTINGS.models?.stt === "browser" ? "browser" : SETTINGS.models?.sttModel));
  fillTtsModels($("ttsSel").value || SETTINGS.models?.tts);
  $("modelsHint").textContent = m.source === "account" ? "The LLM list shows the models your OpenAI account can use." : "Couldn't reach OpenAI; showing common models.";
}
["llmSel", "sttSel", "ttsSel"].forEach((id) => $(id).addEventListener("change", () => { $(id).title = $(id).value; markDirty(); }));
const CAL_APPS = { google: "Google Calendar", outlook: "Outlook", yahoo: "Yahoo Calendar", apple: "Apple Calendar", other: "Other (.ics)" };
// 📅 Connect a calendar: Google / Microsoft sign in (OAuth); Yahoo, iCloud, Zoho, other = CalDAV with an app password.
// The connection belongs to the active agent (GET/POST/DELETE /api/calendar-accounts…); calendar.app keeps the one-click add links.
const CAL_PROVIDERS = {
  google: { name: "Google Calendar", kind: "oauth", app: "google", logo: ["g", "G"] },
  microsoft: { name: "Outlook / Microsoft 365", kind: "oauth", app: "outlook", logo: ["o", "O"] },
  yahoo: { name: "Yahoo Calendar", kind: "dav", app: "yahoo", logo: ["y", "Y!"], url: "https://caldav.calendar.yahoo.com",
    help: "In Yahoo: Account info → Account security → Generate app password (choose “Other app”). Use your Yahoo email as the user name.", link: "https://login.yahoo.com/account/security" },
  icloud: { name: "iCloud Calendar", kind: "dav", app: "apple", logo: ["a", "🍎"], url: "https://caldav.icloud.com",
    help: "At account.apple.com: Sign-In and Security → App-Specific Passwords → create one. Use your Apple Account email as the user name.", link: "https://account.apple.com/account/manage" },
  zoho: { name: "Zoho Calendar", kind: "dav", app: "other", logo: ["z", "Z"], url: "https://calendar.zoho.com/caldav/",
    help: "In Zoho Calendar: Settings → Calendars → your calendar → CalDAV shows its address. Make an app password at accounts.zoho.com → Security → App Passwords.", link: "https://accounts.zoho.com/home#security/app_password" },
  other: { name: "CalDAV calendar", kind: "dav", app: "other", logo: ["x", "⋯"], url: "",
    help: "Any CalDAV calendar (Fastmail, Nextcloud, Synology…): paste its CalDAV address, your user name and an app password." },
};
const calKey = (acc) => (acc?.provider === "caldav" ? acc.label : acc?.provider) || "";
async function loadCalAccount() {
  if (!state.agentId || !allowed("tool.calendar")) { state.calAccount = null; renderCalApp(); return; }
  try { const r = await fetch("/api/calendar-accounts"); state.calAccount = r.ok ? await r.json() : null; } catch { state.calAccount = null; }
  renderCalApp();
}
function calMsg(text, err = false) { const m = $("cdMsg"); m.hidden = !text; m.textContent = text || ""; m.classList.toggle("err", err); }
function renderCalApp() {
  const acc = state.calAccount, on = $("calToggle").checked;
  $("calAppBtn").hidden = !on;
  $("calAppBtn").textContent = acc?.connected ? `${acc.status === "error" ? "⚠" : "✅"} ${acc.name} · meetings ›` : "Connect a calendar ›";
  // connected card
  $("cdStatus").hidden = !acc?.connected;
  if (acc?.connected) {
    const pv = CAL_PROVIDERS[calKey(acc)] || CAL_PROVIDERS.other;
    $("cdStatusLogo").className = "cd-logo " + pv.logo[0]; $("cdStatusLogo").textContent = pv.logo[1];
    $("cdStatusName").textContent = `${acc.status === "error" ? "⚠ " : "✅ Connected · "}${acc.name}`;
    $("cdStatusAcc").textContent = acc.status === "error" ? acc.lastError || "Connect it again." : `${acc.account || ""} · checks free time and books into it`;
    $("cdStatus").classList.toggle("err", acc.status === "error");
  }
  const pick = state.calPick || calKey(acc);
  document.querySelectorAll("#cdApps .cd-app").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.app === pick)));
  const pv = CAL_PROVIDERS[state.calPick];
  const fresh = state.calPick && (!acc?.connected || state.calPick !== calKey(acc) || acc.status === "error");
  $("cdOauth").hidden = !(fresh && pv?.kind === "oauth");
  $("cdDav").hidden = !(fresh && pv?.kind === "dav");
  if (fresh && pv?.kind === "oauth") {
    const ready = acc?.providers?.[state.calPick];
    const who = state.calPick === "google" ? "Google" : "Microsoft";
    $("cdOauthText").textContent = ready
      ? `You'll go to ${who} to sign in and allow calendar access, then come straight back here.${acc?.connected ? " This replaces the calendar connected now." : ""}`
      : `${who} sign-in isn't set up on this server yet. Ask your SuperAdmin to add the ${who} keys (calendar setup guide).`;
    $("cdOauthBtn").textContent = `Sign in with ${who}`;
    $("cdOauthBtn").disabled = !ready;
  }
  if (fresh && pv?.kind === "dav") {
    $("cdDavHelp").innerHTML = "";
    $("cdDavHelp").append(pv.help + " ");
    if (pv.link) { const a = document.createElement("a"); a.href = pv.link; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Open it ↗"; $("cdDavHelp").append(a); }
    if (!$("cdDavUrl").dataset.for || $("cdDavUrl").dataset.for !== state.calPick) { $("cdDavUrl").value = pv.url; $("cdDavUrl").dataset.for = state.calPick; }
    $("cdDavUrl").closest(".field").hidden = !!pv.url && state.calPick !== "zoho";
  }
  const im = SETTINGS.calendar?.immediateMinutes;
  if (document.activeElement !== $("calNowMin")) $("calNowMin").value = state.calNowMin ?? (im ?? "");
  $("calNowMin").placeholder = String(acc?.immediateMinutes ?? 5);
}
function openCalDialog() {
  state.calPick = "";
  calMsg("");
  renderCalApp();
  $("calDialog").classList.add("open");
  loadCalendar();
  loadCalAccount();
}
const closeCalDialog = () => $("calDialog").classList.remove("open");
$("calToggle").addEventListener("change", () => { renderNotes(); renderCalApp(); markDirty(); if ($("calToggle").checked) openCalDialog(); });
$("calAppBtn").addEventListener("click", openCalDialog);
$("cdApps").addEventListener("click", (e) => {
  const b = e.target.closest(".cd-app");
  if (!b) return;
  state.calPick = b.dataset.app;
  const app = CAL_PROVIDERS[state.calPick]?.app;
  if (app && app !== state.calApp) { state.calApp = app; markDirty(); } // the one-click "add" links follow the provider
  $("cdDavErr").textContent = ""; calMsg("");
  renderCalApp(); loadCalendar();
  (state.calPick && CAL_PROVIDERS[state.calPick].kind === "dav" ? $("cdDavUser") : $("cdOauthBtn")).focus({ preventScroll: true });
});
$("cdOauthBtn").addEventListener("click", async () => {
  $("cdOauthBtn").disabled = true;
  try {
    clearTimeout(state.saveTimer); if (formSnapshot() !== state.savedSnapshot) await autoSave(); // keep "calendar on" before leaving the page
    const r = await fetch(`/api/calendar-accounts/oauth/${state.calPick}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: location.origin }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    location.href = d.url; // Google / Microsoft sign-in, then back to /?cal=…#agents/calendar
  } catch (err) { calMsg("⚠ " + err.message, true); $("cdOauthBtn").disabled = false; }
});
$("cdDav").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("cdDavErr").textContent = ""; $("cdDavBtn").disabled = true; $("cdDavBtn").textContent = "Connecting…";
  try {
    const r = await fetch("/api/calendar-accounts/caldav", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: state.calPick, url: $("cdDavUrl").value.trim(), username: $("cdDavUser").value.trim(), password: $("cdDavPass").value }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    $("cdDavPass").value = ""; state.calAccount = d; state.calPick = "";
    calMsg(`✅ ${d.name} connected. The agent now checks it before booking.`);
    renderCalApp(); renderSummary();
  } catch (err) { $("cdDavErr").textContent = err.message; }
  finally { $("cdDavBtn").disabled = false; $("cdDavBtn").textContent = "Connect"; }
});
$("cdDisconnect").addEventListener("click", async () => {
  const acc = state.calAccount;
  const r = await fetch("/api/calendar-accounts", { method: "DELETE" });
  if (r.ok) { state.calAccount = await r.json(); calMsg(`${acc?.name || "The calendar"} is disconnected. Meetings are kept in the app's own calendar.`); renderCalApp(); }
});
$("calNowMin").addEventListener("input", () => { state.calNowMin = $("calNowMin").value === "" ? null : Math.max(0, Math.min(240, Number($("calNowMin").value) || 0)); markDirty(); });
["cdClose", "cdDone"].forEach((id) => $(id).addEventListener("click", closeCalDialog));
$("calDialog").addEventListener("click", (e) => { if (e.target === $("calDialog")) closeCalDialog(); });
// back from Google / Microsoft: /?cal=connected|error&msg&agent#agents/calendar
async function calendarReturn() {
  const q = new URLSearchParams(location.search);
  if (!q.get("cal")) return;
  history.replaceState(null, "", location.pathname + location.hash);
  if (q.get("agent") && q.get("agent") !== state.agentId && state.agents.some((a) => a.id === q.get("agent"))) await switchAgent(q.get("agent"));
  location.hash = "agents/calendar";
  openCalDialog();
  if (q.get("cal") === "connected") calMsg(`✅ ${CAL_PROVIDERS[q.get("provider")]?.name || "Calendar"} connected. The agent now checks it for free time and books into it.`);
  else calMsg("⚠ " + (q.get("msg") || "The calendar couldn't be connected."), true);
}
// one-click "add to" link for a booked meeting in the chosen calendar app (no account link needed)
function calAddLink(app, e) {
  const st = new Date(e.start), en = new Date(st.getTime() + (e.durationMin || 30) * 60000);
  const z = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const q = (o) => new URLSearchParams(o).toString();
  const details = `Booked by your TelemuneSmartAi agent${e.notes ? ": " + e.notes : ""}`;
  if (app === "google") return `https://calendar.google.com/calendar/render?${q({ action: "TEMPLATE", text: e.title, dates: `${z(st)}/${z(en)}`, details })}`;
  if (app === "outlook") return `https://outlook.live.com/calendar/0/deeplink/compose?${q({ path: "/calendar/action/compose", rru: "addevent", subject: e.title, startdt: st.toISOString(), enddt: en.toISOString(), body: details })}`;
  if (app === "yahoo") return `https://calendar.yahoo.com/?${q({ v: "60", title: e.title, st: z(st), et: z(en), desc: details })}`;
  return "";
}
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
  const nfOn = ["nfWa", "nfMail"].filter((id) => $(id).checked).length;
  $("nfNote").textContent = nfOn ? `On · ${nfOn}` : "Off";
  $("nfNote").className = "sec-note" + (nfOn ? " on" : "");
  const parts = [cal && "📅", on && "🚨", state.playbookId && "📘", nfOn && "📨"].filter(Boolean);
  $("toolsNote").textContent = parts.join("");
  $("toolsNote").className = "sec-note" + (parts.length ? " on" : "");
  renderSummary();
}

function renderRules() {
  renderNotes();
  const box = $("emgRules");
  box.innerHTML = "";
  box.classList.toggle("off", !$("emgToggle").checked);
  if (!state.rules.length) { box.innerHTML = '<div class="emg-empty">No contacts yet. Saved ones show here.</div>'; return; }
  state.rules.forEach((r, i) => {
    const type = ["email", "whatsapp"].includes(r.type) ? r.type : "phone";
    const el = document.createElement("div");
    el.className = "emg-card " + type;
    el.style.animationDelay = `${i * 0.05}s`;
    el.innerHTML = `<span class="ec-ico"></span><div class="ec-body"><div class="ec-name"></div><div class="ec-num"></div><div class="ec-kw"></div></div>
      <div class="ec-act"><button type="button" class="ec-edit" title="Edit" aria-label="Edit">✎</button><button type="button" class="ec-del" title="Remove" aria-label="Remove">🗑</button></div>`;
    el.querySelector(".ec-ico").textContent = type === "email" ? "✉️" : type === "whatsapp" ? "💬" : "📞";
    el.querySelector(".ec-name").textContent = r.label;
    el.querySelector(".ec-num").textContent = r.number;
    for (const k of r.keywords) el.querySelector(".ec-kw").appendChild(Object.assign(document.createElement("span"), { textContent: k }));
    el.querySelector(".ec-del").onclick = () => { state.rules.splice(i, 1); renderRules(); markDirty(); };
    // ✎ puts it back into the form on the left; saving with the same name updates it
    el.querySelector(".ec-edit").onclick = () => {
      const known = EMERGENCY_TYPES[r.label] ? r.label : "Other";
      $("emgType").value = known;
      $("emgCustomWrap").hidden = known !== "Other";
      if (known === "Other") $("emgCustom").value = r.label;
      setEmgVia(type);
      const plus = String(r.number).trim().startsWith("+");
      if (type !== "email" && plus) { const sp = splitNumber(r.number); fillEmgCc($("emgCc"), type, sp.iso); $("emgNumber").value = sp.local; }
      else { fillEmgCc($("emgCc"), type, type === "whatsapp" ? "IN" : ""); $("emgNumber").value = r.number; }
      emgForm.picked = [...r.keywords];
      renderEmgForm();
      emgMsg(`Editing ${r.label}: change it and click Save contact.`, "ok");
      $("emgNumber").focus();
    };
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
// Emergency contact number: 📞 phone = country code + number, or "Local" for short numbers like 108;
// 💬 WhatsApp = country code + mobile number (codes from the country_codes table); ✉️ email = an address, no code.
function fillEmgCc(sel, via, iso) {
  if (!sel.options.length) sel.add(new Option("☎ Local", ""));
  if (sel.options.length === 1) for (const c of state.countryCodes || []) sel.add(new Option(`${c.flag} +${c.dial}`, c.iso2)); // once the codes have loaded
  sel.options[0].hidden = via !== "phone";
  sel.hidden = via === "email";
  if (iso != null) sel.value = iso;
  if (via === "whatsapp" && !sel.value) sel.value = "IN";
  sel.title = sel.value ? ccOf(sel.value)?.name || "" : "Local number (no country code)";
}
function emgNumberValue(sel, input, via) {
  const raw = input.value.trim();
  if (via === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw) ? { number: raw } : { error: "Enter a valid email address." };
  if (!sel.value) return /^[\d*#]{2,15}$/.test(raw.replace(/[\s-]/g, "")) ? { number: raw.replace(/[\s-]/g, "") } : { error: "Enter a valid number." };
  if (via === "whatsapp") { const r = fullNumber(sel, input); return r.error ? r : { number: "+" + r.number }; }
  const local = raw.replace(/[^\d]/g, "").replace(/^0+/, "");
  return local.length >= 3 && local.length <= 14 ? { number: `+${ccOf(sel.value).dial} ${local}` } : { error: "Enter a valid number." };
}
function setEmgVia(via) {
  $("emgVia").value = via;
  $("emgNumberLabel").textContent = via === "email" ? "Email" : via === "whatsapp" ? "WhatsApp number" : "Number";
  $("emgNumber").placeholder = via === "email" ? "e.g. help@company.com" : via === "whatsapp" ? "e.g. 98765 43210" : "e.g. 108";
  $("emgNumber").inputMode = via === "email" ? "email" : "tel";
  fillEmgCc($("emgCc"), via);
}
$("emgCc").addEventListener("change", () => fillEmgCc($("emgCc"), $("emgVia").value));
$("emgVia").addEventListener("change", () => { setEmgVia($("emgVia").value); $("emgNumber").value = ""; $("emgNumber").focus(); });
function resetEmgForm() {
  const t = EMERGENCY_TYPES[$("emgType").value];
  setEmgVia("phone");
  fillEmgCc($("emgCc"), "phone", t.number ? "" : "IN"); // the usual services are local short numbers
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
  const via = $("emgVia").value;
  if (!label) return emgMsg("Give it a name.", "err");
  const nv = emgNumberValue($("emgCc"), $("emgNumber"), via);
  if (nv.error) return emgMsg(nv.error, "err");
  const number = nv.number;
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
    agent: { defaultName: agentName(), defaultLanguage: lang(), defaultVoice: $("voice").value, defaultPlaybookId: state.playbookId, speechSpeed: speed() },
    models: { chat: $("llmSel").value, stt: $("sttSel").value, tts: $("ttsSel").value, ttsProvider: ttsProv(), sttProvider: sttProv() },
    calendar: { enabled: $("calToggle").checked, app: state.calApp || "", immediateMin: state.calNowMin ?? "" },
    emergency: { enabled: $("emgToggle").checked, rules: state.rules },
    persona: personaPayload(),
    notify: notifyPayload(),
  };
}
const formSnapshot = () => JSON.stringify(formPayload());

// ---------- call summaries: send after every call by WhatsApp / email (Flash SMS later) ----------
function notifyPayload() {
  const wa = $("nfWaTo").value.trim() ? fullNumber($("nfWaCc"), $("nfWaTo")) : { number: "" };
  return { whatsapp: { on: $("nfWa").checked, to: wa.number || "" }, email: { on: $("nfMail").checked, to: $("nfMailTo").value.trim() },
    sms: { on: false, to: "" } };
}
function renderNotify() {
  for (const [sw, to, st, ch] of [["nfWa", "nfWaRow", "nfWaState", "whatsapp"], ["nfMail", "nfMailTo", "nfMailState", "email"]]) {
    $(to).hidden = !$(sw).checked;
    const ready = state.channels?.[ch] !== false;
    $(st).textContent = ready ? "" : "not set up on the server yet";
    $(sw).disabled = !ready && !$(sw).checked;
  }
  renderNotes();
}
function fillNotify(n) {
  n ||= {};
  const wa = splitNumber(n.whatsapp?.to);
  $("nfWa").checked = !!n.whatsapp?.on; fillCc($("nfWaCc"), wa.iso); $("nfWaTo").value = wa.local;
  $("nfMail").checked = !!n.email?.on; $("nfMailTo").value = n.email?.to || "";
  renderNotify();
}
["nfWa", "nfMail"].forEach((id) => $(id).addEventListener("change", () => {
  renderNotify(); markDirty();
  const to = $(id === "nfWa" ? "nfWaTo" : "nfMailTo");
  if ($(id).checked && !to.value) to.focus();
}));
["nfWaTo", "nfMailTo"].forEach((id) => $(id).addEventListener("input", markDirty));
$("nfWaCc").addEventListener("change", markDirty);

// Every change in Agent setup is saved to config.json automatically (no Save button).
// Selects and switches save almost at once; typing saves after a short pause.
function markDirty() {
  if (!state.savedSnapshot || !state.agentId) return; // still filling the form on start-up, or no agent yet
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
    prepareGreeting(); // the greeting may have changed (name, voice, language, persona)
    if (data.agent) {
      const i = state.agents.findIndex((a) => a.id === data.agent.id);
      if (i >= 0) state.agents[i] = data.agent;
      SETTINGS.currentAgent = data.agent;
      renderAgents();
    }
    if (SETTINGS.calendar?.enabled && isOpen("calDialog")) loadCalendar();
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
  const email = rule.type === "email", wa = rule.type === "whatsapp";
  el.querySelector(".s").textContent = `Heard “${rule.keyword}”. ${email || wa ? "Contact now" : "Call now"}:`;
  const a = el.querySelector("a");
  a.href = email ? `mailto:${rule.number}` : wa ? `https://wa.me/${rule.number.replace(/[^\d]/g, "")}` : `tel:${rule.number.replace(/\s/g, "")}`;
  if (wa) { a.target = "_blank"; a.rel = "noopener"; }
  a.textContent = `${email ? "✉️" : wa ? "💬" : "📞"} ${rule.number}`;
  $("msgs").appendChild(el);
  scrollDown();
  // WhatsApp / email contacts are also alerted by the server, once per contact per call
  if ((email || wa) && state.inCall) {
    state.alerted ||= new Set();
    if (!state.alerted.has(rule.label)) {
      state.alerted.add(rule.label);
      fetch("/api/emergency/alert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: rule.label, keyword: rule.keyword }) })
        .then((r) => r.json()).then((d) => { if (d.channel === "whatsapp" || d.channel === "email") addChip(el, `${wa ? "💬" : "✉️"} ${rule.label} alerted`, "alerted"); })
        .catch(() => {});
    }
  }
}

// ---------- calendar: check the slot, then book (the agent's <calendar-check:…> and <calendar:…> tags) ----------
// The result goes back to the agent as a hidden note ([calendar check: …]) once it has finished saying "let me check".
function sendCalendarNote(note) {
  if (++state.calChain > 6) { state.calWaiting = false; return; } // never loop
  if (state.playing || state.speakQueue.length) { state.calNote = note; return; } // sent by speakNext when the speech ends
  sendUserText(note, { hidden: true });
}
const calSay = (d) => `${d.say} (${d.local})`;
function calOptions(d) {
  return d.suggestions?.length ? d.suggestions.map(calSay).join("; ") : "none in the next two weeks; offer to take a message instead";
}
async function checkCalendarSlot(raw, turn) {
  const [when, minutes] = raw.split("|").map((x) => x.trim());
  if (!when) return;
  state.calWaiting = true;
  addChip(turn.bubble, "🔎 checking the calendar…", "calchk");
  let note;
  try {
    const res = await fetch("/api/calendar/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ when, minutes: Number(minutes) || undefined }) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    turn.calCheck = d;
    state.calOffer = d.free ? { local: d.local, minutes: d.minutes } : null; // the slot the caller is being offered (safety net above)
    if (d.free) {
      addChip(turn.bubble, `✅ free · ${d.say}`, "calres");
      note = `[calendar check: FREE. ${calSay(d)} for ${d.minutes} minutes is free in ${d.calendar}${d.immediate ? " (the soonest time for a right-now booking)" : ""}. `
        + `Tell the caller this exact time, get their email for the invitation if you don't have it, confirm, and when they say yes your reply must contain <calendar:TITLE|${d.local}|${d.minutes}|EMAIL>.]`;
    } else {
      addChip(turn.bubble, `⛔ ${d.reason} · ${d.suggestions?.length || 0} free option${d.suggestions?.length === 1 ? "" : "s"}`, "calres");
      note = `[calendar check: BUSY. ${calSay(d)} doesn't work: ${d.reason}. Free options: ${calOptions(d)}.]`;
    }
    if (d.calendarError) addChip(turn.bubble, `⚠ couldn't read ${d.calendar}: checked the app's own calendar`, "calerr");
  } catch (e) {
    note = `[calendar check: couldn't check the calendar (${e.message}). Take the preferred day and time as a message instead.]`;
  }
  state.calWaiting = false;
  sendCalendarNote(note);
}
async function addCalendarEvent(raw, turn) {
  const [title, start, minutes, attendee] = raw.split("|").map((x) => x.trim());
  if (!title || !start) return;
  state.calWaiting = true;
  try {
    const res = await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, when: start, durationMin: Number(minutes) || undefined, attendee: attendee || undefined, source: activePlaybook()?.name || "Default agent" }),
    });
    const ev = await res.json();
    state.calWaiting = false;
    if (res.status === 409) { // taken after all (or outside hours): the agent offers the free times
      addChip(turn.bubble, `⛔ not booked: ${ev.reason}`, "calres");
      sendCalendarNote(`[calendar booking failed: ${calSay(ev)} ${ev.reason}. Free options: ${calOptions(ev)}.]`);
      return;
    }
    if (!res.ok) throw new Error(ev.error);
    turn.calendar = ev;
    state.calOffer = null;
    addChip(turn.bubble, `📅 booked${ev.inCalendar ? " in " + ev.calendar : ""}: ${ev.title}, ${ev.say}`, "cal-" + ev.id);
    if (ev.calendarError) addChip(turn.bubble, `⚠ saved in the app only: ${ev.calendarError}`, "calerr");
    if (ev.attendee) addChip(turn.bubble, ev.invite === "none" ? `⚠ no invitation sent to ${ev.attendee} (email isn't set up)` : `✉ invitation sent to ${ev.attendee}`, "calinv");
    else if (ev.attendeeInvalid) addChip(turn.bubble, "⚠ the email didn't look right, so no invitation was sent", "calinv");
    loadCalendar();
    if (state.inCall && !state.playing && !state.speakQueue.length && state.streamDone) afterAgentTurn();
  } catch (e) {
    state.calWaiting = false;
    console.warn("Couldn't add calendar event:", e);
    if (state.inCall && !state.playing && state.streamDone) afterAgentTurn();
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
    el.innerHTML = `<div class="cal-date"><div class="d"></div><div class="m"></div></div><div><div class="cal-title"></div><div class="cal-when"></div></div><div class="cal-actions"><a class="cal-add" target="_blank" rel="noopener" hidden></a><a title="Add to your calendar app">⬇ .ics</a><button type="button" title="Delete event" aria-label="Delete event">🗑</button></div>`;
    el.querySelector(".d").textContent = d.getDate();
    el.querySelector(".m").textContent = d.toLocaleString([], { month: "short" });
    el.querySelector(".cal-title").textContent = e.title;
    el.querySelector(".cal-when").textContent = `${d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} · ${e.durationMin} min · ${e.source}`;
    const a = el.querySelector("a:not(.cal-add)");
    a.href = `/api/calendar/${e.id}.ics`; a.download = `event-${e.id}.ics`;
    const IN = { google: "Google Calendar", microsoft: "Outlook", caldav: state.calAccount?.name || "your calendar" };
    const link = e.externalProvider ? "" : calAddLink(state.calApp, e);
    if (e.externalProvider) Object.assign(el.querySelector(".cal-add"), { hidden: false, textContent: `✓ in ${IN[e.externalProvider] || "your calendar"}`, title: "Already in the connected calendar" });
    if (e.externalProvider) { const a = el.querySelector(".cal-add"); a.removeAttribute("href"); a.classList.add("in-cal"); }
    if (link) Object.assign(el.querySelector(".cal-add"), { href: link, hidden: false, textContent: `＋ ${CAL_APPS[state.calApp].split(" ")[0]}`, title: `Add to ${CAL_APPS[state.calApp]}` });
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

// ---------- access: what this account may see (set by its admin, or by the SuperAdmin for admins) ----------
const ACCESS_CLASSES = { "talk.call": "no-talk-call", "talk.chat": "no-talk-chat", "talk.voice": "no-talk-voice", "talk.whatsapp": "no-talk-whatsapp",
  "tab.profile": "no-tab-profile", "tab.voice": "no-tab-voice", "tab.availability": "no-tab-availability", "tab.tools": "no-tab-tools",
  "tool.calendar": "no-tool-calendar", "tool.emergency": "no-tool-emergency", "tool.playbook": "no-tool-playbook", "tool.summaries": "no-tool-summaries",
  "history": "no-history", "agents.create": "no-agents-create", "agents.delete": "no-agents-delete", "dashboard": "no-dashboard" };
function applyAccess(access) {
  const app = access?.app || {};
  state.access = app;
  for (const [f, cls] of Object.entries(ACCESS_CLASSES)) document.body.classList.toggle(cls, app[f] === false);
  // the first talk channel that is allowed
  const ch = ["call", "chat", "voice", "whatsapp"].find((m) => app[`talk.${m}`] !== false);
  if (ch && app[`talk.${state.mode}`] === false) setTalkMode(ch);
}
const allowed = (f) => state.access?.[f] !== false;

// ---------- signed-in user ----------
function setupUserMenu(me) {
  if (!me) return;
  state.me = me;
  $("userMenu").hidden = false;
  $("uAv").textContent = (me.name || me.username)[0].toUpperCase();
  $("uName").textContent = me.name || me.username;
  const staff = typeof me.role === "number" && me.role <= 1; // 0 = SuperAdmin, 1 = admin
  $("uRole").textContent = me.role === 0 ? "🛡 SuperAdmin" : me.role === 1 ? "👑 Admin" : "👤 User";
  $("mDash").hidden = !staff;
  $("mRestart").hidden = me.role !== 0;
  document.body.classList.toggle("is-admin", staff); // AI model pickers are for admins; users run on the defaults
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
  document.body.classList.toggle("no-agents", !state.agents.length); // new accounts start with no agents
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


// ---------- 📚 Tutorials: guided tours you do yourself, step by step, on the real page ----------
// A step points at an element (target: selector, list of selectors, or a function returning one) and says what to do.
//   done()  → the tour moves on by itself as soon as it returns true (you clicked / switched on / created it).
//   ready() → for typing steps: Next is enabled once it returns true.
//   next    → an explanation step: just press Next.
//   before() opens what the step needs (a tab, the call page); "Show me again" runs it again.
// Each tour: needsAgent (start "Create your first agent" first if there is none).
const goTab = (tab) => () => { if (location.hash !== `#agents/${tab}`) location.hash = `agents/${tab}`; };
const goDash = () => { if (state.view !== "dashboard") location.hash = "dashboard"; };
const goCall = () => { if (state.view !== "call" || location.hash !== "#call") location.hash = "call"; };
const isOpen = (id) => $(id).classList.contains("open");

const TOURS = [
  { id: "first-agent", icon: "＋", needs: ["agents.create"], title: "Create your first agent", desc: "Step by step, like the Agent studio tabs: profile, voice & AI, availability, tools, then create.",
    steps: [
      { target: () => (state.agents.length ? "#sumNew" : "#firstAgentBtn"), before: goCall, title: "Open the new agent form",
        text: () => (state.agents.length ? "👉 Click **＋** next to \"Agent for this call\"." : "👉 Click **＋ Create my first agent**."), done: () => isOpen("agentDialog") },
      { target: "#naSteps", title: "Five short steps", text: "Creating an agent follows the same tabs as **🤖 Agent studio**: **Profile → Voice & AI → Availability → Tools → Review**. The bar shows how far you are.", next: true },
      { target: "#naType", title: "1 · What is it for?", text: "👉 Pick the **Agent type**. To answer calls for someone who is busy, choose **Call Assistant (for a person)**. The list shows the types your admin has opened for you.",
        next: true },
      { target: "#naTemplate", title: "Its script", text: "The template the agent follows: what it asks and in which order. Keep the suggested one or pick another.", next: true },
      { target: "#naName", title: "Give it a name", text: "👉 Type a name for your agent, for example **Brown**.", ready: () => !!$("naName").value.trim() },
      { target: "#naOwner", title: "Who does it work for?", text: "Type the person it answers for, for example **DJ**. A Call Assistant needs this; for other types it's optional.",
        ready: () => !typeOf(na.type).needsOwner || !!$("naOwner").value.trim() },
      { target: "#naNext", title: "Next step", text: "👉 Click **Next →**.", done: () => NA_STEPS[na.step] === "voice", warn: () => $("naErr").textContent },
      { target: "#naVoice", title: "2 · Voice & AI", text: "Pick the speech providers, the language it speaks and its voice.", next: true },
      { target: ".na-step[data-step=voice] .speed-bar", title: "Speaking speed", text: "Drag the **⏩ Speed** bar to make it talk slower or faster.", next: true },
      { target: "#naListen", title: "Listen to it", text: "👉 Click **▶ Play** to hear the voice at that speed. Then click **Next →**.", done: () => NA_STEPS[na.step] === "availability" },
      { target: "#naDays", title: "3 · Availability (optional)", text: "When the person can take meetings: pick days and hours. The agent only offers times inside them. Skip it if you like. 👉 **Next →**",
        done: () => NA_STEPS[na.step] === "tools", warn: () => $("naErr").textContent },
      { target: "label[for=naCal]", title: "4 · Tools: Calendar", text: "Switch it on and the agent books confirmed meetings into its calendar.", next: true },
      { target: "label[for=naEmg]", title: "Emergency contacts (optional)", text: "Pick 📞 phone, 💬 WhatsApp or ✉️ email, the country code and number (or the email), and the words that trigger it.", next: true },
      { target: "#naPbs", title: "Playbook (optional)", text: "Pick a saved playbook (a ready script for one job), or keep **No playbook** to use the agent's template. Playbooks your other agents already use aren't listed.", next: true },
      { target: "label[for=naNfWa]", title: "Call summaries (optional)", text: "Send the AI summary of every call by 💬 WhatsApp and/or ✉️ email. 👉 Then click **Next →**.",
        done: () => NA_STEPS[na.step] === "review", warn: () => $("naErr").textContent },
      { target: "#naReview", title: "5 · Review", text: "Everything in one place. **Edit** jumps back to that step.", next: true },
      { target: "#naCreate", title: "Create it", text: "👉 Click **✨ Create agent** and watch the progress bar.", done: () => !isOpen("agentDialog") && state.agents.length > tourCtx.agents,
        warn: () => $("naErr").textContent },
      { target: ".phone .stage", before: goCall, title: "🎉 Your agent is ready", text: "It's set up and selected for calls. Fine-tune it any time in **🤖 Agent studio**. Next, try a call!", next: true },
    ], then: "call" },
  { id: "dashboard", icon: "📊", needs: ["dashboard"], title: "Your insights", needsAgent: true, desc: "Your start page: conversations, channels, reply speed, busy hours, agents, meetings and messages.",
    steps: [
      { target: "#navDash", before: goDash, title: "📊 Insights", text: "Your start page. It opens after you sign in.", next: true },
      { target: ".db-filters", title: "Pick a period", text: "7, 30 or 90 days, for all agents or one. Everything below follows it.", next: true },
      { target: "#dbTiles", title: "The totals", text: "Conversations, talk time, reply speed, meetings, messages and AI tokens, with the change against the period before.", next: true },
      { target: "#dbActivity", title: "Every day", text: "Conversations per day by channel. Hover a day for the numbers, or use **Show as table**.", next: true },
      { target: "#dbHeat", title: "Busiest times", text: "Darker squares are busier hours, in your time zone.", next: true },
      { target: "#dbAgents", title: "Your agents", text: "How each agent is doing, with its trend line.", next: true },
      { target: "#dbRecent", title: "Recent conversations", text: "Click one to open its summary and transcript.", next: true },
    ] },
  { id: "call", icon: "🎙", needs: ["talk.call"], title: "Make a web call", needsAgent: true, desc: "Start a call, talk to your agent, follow the summary at the top, and end it.",
    steps: [
      { target: "#agentPick", before: goCall, title: "Pick the agent", text: "This is the agent you'll talk to. You can change it here any time.", next: true },
      { target: "#talkModes", before: () => { goCall(); if (state.mode !== "call") setTalkMode("call"); }, title: "Web call is selected", text: "The buttons under the conversation pick how you talk. **📞 Web call** is the live voice call.", next: true },
      { target: "#callBtn", title: "Start the call", text: "👉 Click **Start call**. The first time, allow the microphone.", done: () => state.inCall },
      { target: ".phone .stage", title: "Talk to it", text: "The agent greets you. 👉 Say something, like **\"Hi, what can you do?\"** It answers after you pause for a second. To interrupt, just start talking. The cartoon agent listens, thinks and speaks with you.",
        done: () => state.turns.some((t) => !t.hidden), next: true, nextLabel: "Skip" },
      { target: "#convSum", title: "Summary at the top", text: "This line shows what the caller wants while you talk. When the call ends it shows the AI summary in a few lines; **More ▾** opens the full summary and the downloads.", next: true },
      { target: ".zoom", title: "Zoom the conversation", text: "**−** makes the messages smaller so you see more of the older ones, **+** makes them bigger, **100%** resets.", next: true },
      { target: "#callBtn", title: "End the call", text: "👉 Click **End call** when you're done (or say goodbye and the agent hangs up).", done: () => !state.inCall },
      { target: ".card.history", title: "It's saved", text: "Every call is saved in **Call summaries** with its AI summary, transcript and the recording (if you pressed ●).", next: true },
    ] },
  { id: "channels", icon: "💬", title: "Live chat, voice chat & WhatsApp", needsAgent: true, desc: "The other ways to talk: type, hold-to-talk, or send a WhatsApp message.",
    needsAny: ["talk.chat", "talk.voice", "talk.whatsapp"],
    steps: [
      { target: "#talkModes", before: goCall, title: "Pick how to talk", text: "Switching channel ends what's running (it's saved first) and clears the conversation.", next: true },
      { target: '#talkModes [data-talk="chat"]', feature: "talk.chat", title: "💬 Live chat", text: "Type and the agent answers in text straight away. No microphone needed. **End chat** saves it with a summary.", next: true },
      { target: '#talkModes [data-talk="voice"]', feature: "talk.voice", title: "🎤 Voice chat", text: "**Hold** the mic button to talk and **let go** to send; the agent answers out loud. Mute and End are next to it.", next: true },
      { target: '#talkModes [data-talk="whatsapp"]', feature: "talk.whatsapp", title: "WhatsApp", text: "Pick the country code, type the mobile number, then the message and **Send on WhatsApp**. It's sent from your business number and saved in Call summaries.", next: true },
    ] },
  { id: "persona", icon: "👤", needs: ["tab.profile"], title: "Profile & greeting", needsAgent: true, desc: "The agent's job, who it works for, anything else it should know, and its first line.",
    steps: [
      { target: "#pType", before: goTab("profile"), title: "Agent type", text: "The agent's job. Changing it resets its setup, so it asks you first.", next: true },
      { target: "#pTemplate", before: goTab("profile"), title: "Template", text: "Its script. Pick one for this type, or free conversation.", next: true },
      { target: "#pOwner", before: goTab("profile"), title: "Works for", text: "👉 Type the person it answers for. It introduces itself as their assistant.", next: true },
      { target: "#pOrg", before: goTab("profile"), title: "Organization", text: "The company or place it answers for.", next: true },
      { target: "#pDesc", before: goTab("profile"), title: "Others", text: "Anything else the agent should know, for example **Answers DJ's calls during meetings**.", next: true },
      { target: "#pGreeting", before: goTab("profile"), title: "First line", text: "Leave it empty to use the template's greeting, or write your own. {agent}, {owner} and {org} are filled in for you. Changes save by themselves (✓ Saved at the top).", next: true },
    ] },
  { id: "voice", icon: "🧠", needs: ["tab.voice"], title: "Voice & AI", needsAgent: true, desc: "Who hears, speaks and thinks, the language, the voice and how fast it talks.",
    steps: [
      { target: ".va-grid", before: goTab("voice"), title: "Hears, speaks, thinks", text: "**Speech-to-text** hears the caller (OpenAI, ElevenLabs or AWS). **Text-to-speech** is the agent's voice (OpenAI, AWS Polly, ElevenLabs or Cartesia). **LLM** thinks and replies (OpenAI).", next: true },
      { target: () => (state.me?.role <= 1 ? "#llmSel" : "#llmProv"), before: goTab("voice"), title: "Models",
        text: () => (state.me?.role <= 1 ? "As an admin you also pick the models. **gpt-4.1-mini** answers fastest. Users' agents always use the default models." : "You pick the providers; the models are the defaults your admin set."), next: true },
      { target: "#lang", before: goTab("voice"), title: "Language", text: "Only languages both providers support are listed, the most spoken first. It also follows callers who mix languages.", next: true },
      { target: "#voice", before: goTab("voice"), title: "Voice", text: "The chosen provider's voices. The cartoon agent on the Conversations page follows: a man for male voices, a woman for the others.", next: true },
      { target: ".tab-panel[data-panel=voice] .speed-bar", before: goTab("voice"), title: "Speaking speed", text: "Drag the **⏩ Speed** bar (0.5× to 2×).", next: true },
      { target: "#previewBtn", before: goTab("voice"), title: "Hear it", text: "👉 Click **▶ Play** to hear the voice at that speed.", clickIn: "#previewBtn", next: true, nextLabel: "Skip" },
    ] },
  { id: "availability", icon: "🕒", needs: ["tab.availability"], title: "Availability", needsAgent: true, desc: "When meetings can be booked: 24×7 or office hours, public holidays and days off.",
    steps: [
      { target: ".av-quick", before: goTab("availability"), title: "Quick picks", text: "**🌐 24×7** = every day, all day. Or **Weekdays** / **Every day**, then set the hours.", next: true },
      { target: "#avDays", before: goTab("availability"), title: "Days", text: "👉 Tap the days the person is available.", ready: () => av.days.length > 0 },
      { target: "#avFrom", before: goTab("availability"), title: "Hours and time zone", text: "From, To and the time zone of those hours.", next: true },
      { target: "label[for=avHol]", before: goTab("availability"), title: "🎉 Public holidays", text: "Switch it on and pick the country: the agent won't offer meetings on its national holidays and suggests the next working day.", next: true },
      { target: "#avOffDate", before: goTab("availability"), title: "🏖 Days off", text: "Pick a date and **＋ Add day** for leave or office closures. Past days drop off by themselves.", next: true },
      { target: "#avPreview", before: goTab("availability"), title: "What the agent reads", text: "This is exactly what the agent is told. It only offers times inside it.", next: true },
    ] },
  { id: "calendar", icon: "📅", needs: ["tab.tools", "tool.calendar"], title: "Calendar", needsAgent: true, desc: "Let the agent book meetings, and add them to Google, Outlook, Yahoo or Apple.",
    steps: [
      { target: "label[for=calToggle]", before: goTab("calendar"), title: "Switch it on", text: "👉 Switch on **📅 Calendar**. A window opens to connect your calendar.", ready: () => $("calToggle").checked, auto: true },
      { target: "#calAppBtn", before: goTab("calendar"), title: "Connect your calendar", text: "👉 Click it to connect **Google, Outlook / Microsoft 365, Yahoo, iCloud, Zoho or any CalDAV** calendar.", done: () => isOpen("calDialog"), next: true, nextLabel: "Skip" },
      { target: () => (isOpen("calDialog") ? "#cdApps" : "#calAppBtn"), title: "How the agent books", text: "Google and Outlook: **Sign in with…**. Yahoo, iCloud, Zoho, other: an **app password**. Then the agent asks the caller for a day and time, **checks it is free**, books it into this calendar, and offers other times when it's taken. \"Right now\" means in the minutes you set here.", next: true },
    ] },
  { id: "emergency", icon: "🚨", needs: ["tab.tools", "tool.emergency"], title: "Emergency contacts", needsAgent: true, desc: "Give callers the right number, WhatsApp or email in an emergency.",
    steps: [
      { target: "label[for=emgToggle]", before: goTab("emergency"), title: "Switch it on", text: "👉 Switch on **🚨 Emergency contacts**.", ready: () => $("emgToggle").checked, auto: true },
      { target: "#emgType", before: goTab("emergency"), title: "Related to", text: "What the contact is for: Ambulance, Police, Fire, a helpline, or Other.", next: true },
      { target: "#emgVia", before: goTab("emergency"), title: "Phone, WhatsApp or email", text: "How to reach it. WhatsApp and email contacts also get an alert from the server when the word is heard.", next: true },
      { target: "#emgNumber", before: goTab("emergency"), title: "Number or email", text: "Pick the country code (☎ Local for short numbers like 108) and type the number, or type the email address.", next: true },
      { target: "#emgSuggest", before: goTab("emergency"), title: "Keywords", text: "Words that trigger it. Tap suggestions or type your own below.", next: true },
      { target: "#emgAddBtn", before: goTab("emergency"), title: "Save it", text: "👉 Click **＋ Save contact**. It appears on the right.", done: () => state.rules.length > tourCtx.rules, warn: () => $("emgMsg").classList.contains("err") ? $("emgMsg").textContent : "" },
      { target: "#emgRules", before: goTab("emergency"), title: "Saved contacts", text: "✎ edits a contact, 🗑 removes it. During a call, a matching word shows a red banner and the agent tells the caller first.", next: true },
    ] },
  { id: "playbook", icon: "📘", needs: ["tab.tools", "tool.playbook"], title: "Playbooks", needsAgent: true, desc: "Write your own call script and use it on a call.",
    steps: [
      { target: "#addPbBtn", before: goTab("playbooks"), title: "New playbook", text: "👉 Click **＋ Add**.", done: () => isOpen("pbDialog") },
      { target: "#pbDialog .dialog", title: "Build the script", text: "👉 Pick a type, then a ready-made script or **Custom**, edit it and save.", done: () => !isOpen("pbDialog") && state.saved.length > tourCtx.playbooks },
      { target: "#pbList", before: goTab("playbooks"), title: "Use it", text: "Click a playbook to use it for this agent (✓ shows the chosen one).", next: true },
      { target: "#sFeats", before: goCall, title: "On the Conversations page too", text: "The **📘 Playbook** chip on the agent card shows the playbook in use; click it to come back here and change it.", next: true },
    ] },
  { id: "delivery", icon: "📨", needs: ["tab.tools", "tool.summaries"], title: "Summaries by WhatsApp & email", needsAgent: true, desc: "Get the AI summary of every call on WhatsApp or by email.",
    steps: [
      { target: ".nf-grid", before: goTab("summaries"), title: "Where to send it", text: "👉 Switch on **WhatsApp** and/or **Email**; the card lights up. Flash SMS comes later.", next: true },
      { target: "#toolSummaries", before: goTab("summaries"), title: "Number or email", text: "Type the WhatsApp number (with the country code) or the email address. After every call the summary is sent there, and it always stays in Call summaries too.", next: true },
    ] },
  { id: "summaries", icon: "📚", needs: ["history"], title: "Call summaries", desc: "Find past calls, chats and WhatsApp messages with their summaries.",
    steps: [
      { target: ".card.history", before: goCall, title: "Everything is kept", text: "Calls, live chats, voice chats and WhatsApp messages, with totals: records, talk time, tokens, reply speed and recordings.", next: true },
      { target: "#toggleHistory", before: goCall, title: "Show the list", text: "👉 Click **Show all**.", done: () => !$("historyList").hidden },
      { target: "#histFilter", title: "Filter by type", text: "**All · 📞 Calls · 💬 Live chat · 🎤 Voice chat · WhatsApp**, each with its count.", next: true },
      { target: "#calls", title: "Open one", text: "👉 Click a row to open it. (Nothing yet? Make a call first, then come back.)", done: () => isOpen("callDialog"), next: true, nextLabel: "Skip" },
      { target: "#callDialog .dialog", title: "Everything about it", text: "The AI summary, the full transcript with mood and intent, the recording, and downloads.", next: true },
    ] },
  { id: "account", icon: "🔑", title: "Your account", desc: "Password, sign out, light or dark theme (and the admin dashboard for admins).",
    steps: [
      { target: "#userBtn", before: goCall, title: "Your menu", text: "👉 Click your name.", done: () => !$("userDrop").hidden },
      { target: "#userDrop", title: "Account options", text: () => (state.me?.role === 0 ? "Admin dashboard, 🔄 Restart backend, change your password or sign out." : state.me?.role === 1 ? "Admin dashboard, change your password or sign out." : "Change your password or sign out here."), next: true },
      { target: "#themeBtn", title: "Theme", text: "Switch between light and dark.", next: true },
    ] },
];

const tourCtx = { tour: null, i: 0, timer: null, wasReady: false, lostSince: 0, clicked: false };
const tourKey = () => `tsa-tours-${state.me?.id || ""}`;
const toursDone = () => { try { return JSON.parse(store.get(tourKey()) || "[]"); } catch { return []; } };

function tourTarget(step) {
  let sel = typeof step.target === "function" ? step.target() : step.target;
  for (const s of [].concat(sel)) {
    for (const el of document.querySelectorAll(s)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
    }
  }
  return null;
}

function startTour(id) {
  let t = TOURS.find((x) => x.id === id);
  if (!t) return;
  if (t.needsAgent && !state.agents.length) t = TOURS[0]; // nothing to show yet: create an agent first
  if (!tourAllowed(t)) return;
  t = { ...t, steps: t.steps.filter((st) => !st.feature || allowed(st.feature)) }; // skip steps for switched-off features
  endTour(true);
  if (location.hash.startsWith("#learn")) location.hash = "call";
  Object.assign(tourCtx, { tour: t, i: -1, agents: state.agents.length, rules: state.rules.length, playbooks: state.saved.length });
  if (!$("tourRing")) {
    document.body.insertAdjacentHTML("beforeend", '<div class="tour-ring" id="tourRing" aria-hidden="true"></div><div class="tour-card" id="tourCard" role="dialog" aria-live="polite" aria-label="Guided tour"></div>');
    document.addEventListener("click", (e) => { // a click on the element a step asked for
      const st = tourCtx.tour?.steps[tourCtx.i];
      if (st?.clickIn && e.target.closest(st.clickIn)) tourCtx.clicked = true;
    }, true);
  }
  setTimeout(() => tourGo(0), 150);
}

function tourGo(i) {
  const t = tourCtx.tour;
  if (!t) return;
  if (i >= t.steps.length) return finishTour();
  tourCtx.i = Math.max(0, i);
  const step = t.steps[tourCtx.i];
  tourCtx.clicked = false; tourCtx.lostSince = 0;
  step.before?.();
  tourCtx.wasReady = step.ready ? !!step.ready() : false;
  renderTourCard();
  setTimeout(() => tourTarget(step)?.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
  clearInterval(tourCtx.timer);
  tourCtx.timer = setInterval(tourTick, 200);
}

function renderTourCard() {
  const t = tourCtx.tour, step = t.steps[tourCtx.i], last = tourCtx.i === t.steps.length - 1;
  const waiting = step.done || step.clickIn || step.auto;
  $("tourCard").innerHTML = `
    <div class="tc-kicker">${tutEsc(t.icon)} ${tutEsc(t.title)} · step ${tourCtx.i + 1} of ${t.steps.length}</div>
    <div class="tc-bar"><i style="width:${Math.round(((tourCtx.i + 1) / t.steps.length) * 100)}%"></i></div>
    <h4>${tutEsc(step.title)}</h4><p>${tutText(typeof step.text === "function" ? step.text() : step.text)}</p>
    ${waiting ? '<div class="tc-wait">⏳ Waiting for you…</div>' : ""}
    <div class="tc-warn" hidden></div>
    <div class="tc-actions">
      <button type="button" class="tc-skip" data-tc="skip">Skip tour</button><span class="grow"></span>
      <button type="button" class="tc-skip" data-tc="again" hidden>Show me again</button>
      ${tourCtx.i > 0 ? '<button type="button" class="btn btn-ghost btn-small" data-tc="back">Back</button>' : ""}
      ${step.next || step.ready ? `<button type="button" class="btn btn-primary btn-small" data-tc="next">${last ? "Finish" : tutEsc(step.nextLabel || "Next")}</button>` : ""}
    </div>`;
  $("tourCard").querySelector('[data-tc="skip"]').onclick = () => endTour();
  $("tourCard").querySelector('[data-tc="again"]').onclick = () => { step.before?.(); tourCtx.lostSince = 0; };
  $("tourCard").querySelector('[data-tc="back"]')?.addEventListener("click", () => tourGo(tourCtx.i - 1));
  $("tourCard").querySelector('[data-tc="next"]')?.addEventListener("click", () => tourGo(tourCtx.i + 1));
  tourTick();
}

function tourTick() {
  const t = tourCtx.tour;
  if (!t) return;
  const step = t.steps[tourCtx.i];
  // Did the user do it?
  const ready = step.ready ? !!step.ready() : true;
  if ((step.done && step.done()) || (step.clickIn && tourCtx.clicked) || (step.auto && ready && !tourCtx.wasReady)) {
    clearInterval(tourCtx.timer);
    setTimeout(() => tourGo(tourCtx.i + 1), 450);
    return;
  }
  const nextBtn = $("tourCard").querySelector('[data-tc="next"]');
  if (nextBtn && step.ready) nextBtn.disabled = !ready;
  const warn = step.warn?.() || "";
  const w = $("tourCard").querySelector(".tc-warn");
  w.hidden = !warn; w.textContent = warn;
  // Place the ring around the element and the card next to it.
  const el = tourTarget(step), ring = $("tourRing"), card = $("tourCard");
  const vw = innerWidth, vh = innerHeight, cw = card.offsetWidth, ch = card.offsetHeight;
  if (!el) {
    ring.classList.add("lost");
    if (!tourCtx.lostSince) tourCtx.lostSince = performance.now();
    card.querySelector('[data-tc="again"]').hidden = !(step.before && performance.now() - tourCtx.lostSince > 900);
    card.style.left = `${(vw - cw) / 2}px`; card.style.top = `${Math.max(12, (vh - ch) / 2)}px`;
    return;
  }
  tourCtx.lostSince = 0;
  card.querySelector('[data-tc="again"]').hidden = true;
  const r = el.getBoundingClientRect(), pad = 6;
  ring.classList.remove("lost");
  ring.classList.toggle("act", !!(step.done || step.clickIn || step.auto || step.ready));
  Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  let top = r.bottom + 14, left = Math.min(Math.max(12, r.left), vw - cw - 12);
  if (top + ch > vh - 12) top = r.top - ch - 14;                     // no room below: above
  if (top < 12) {                                                    // no room above either
    if (r.right + 14 + cw < vw) { left = r.right + 14; top = Math.min(Math.max(12, r.top), vh - ch - 12); }        // beside it, right
    else if (r.left - cw - 14 > 0) { left = r.left - cw - 14; top = Math.min(Math.max(12, r.top), vh - ch - 12); } // beside it, left
    else { left = vw - cw - 12; top = vh - ch - 12; }                // it fills the screen: bottom-right corner, out of the way
  }
  card.style.left = `${left}px`; card.style.top = `${top}px`;
}

function finishTour() {
  const t = tourCtx.tour;
  const done = toursDone();
  if (!done.includes(t.id)) { done.push(t.id); store.set(tourKey(), JSON.stringify(done)); }
  endTour();
  const next = t.then && TOURS.find((x) => x.id === t.then);
  if (next) {
    $("tourCard")?.remove(); $("tourRing")?.remove();
    document.body.insertAdjacentHTML("beforeend", `<div class="tour-card" id="tourDone" role="dialog" style="left:50%;top:50%;transform:translate(-50%,-50%)">
      <h4>🎉 Well done!</h4><p>You finished <b>${tutEsc(t.title)}</b>. Next up: <b>${tutEsc(next.title)}</b>.</p>
      <div class="tc-actions"><button type="button" class="tc-skip" id="tdLater">Later</button><span class="grow"></span>
      <button type="button" class="btn btn-primary btn-small" id="tdNext">Start: ${tutEsc(next.title)}</button></div></div>`);
    $("tdLater").onclick = () => $("tourDone").remove();
    $("tdNext").onclick = () => { $("tourDone").remove(); startTour(next.id); };
  }
}

function endTour(silent) {
  clearInterval(tourCtx.timer);
  tourCtx.tour = null;
  $("tourRing")?.remove(); $("tourCard")?.remove();
  if (!silent) $("tourDone")?.remove();
}

const tutEsc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tutText = (t) => tutEsc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

// The 📚 Tutorials pop-up lists the tours (✓ = finished before).
// a tour shows only when this account has its features (an admin can switch parts of the app off)
const tourAllowed = (t) => (t.needs || []).every(allowed) && (!t.needsAny || t.needsAny.some(allowed));
function showTutorial() {
  const done = toursDone();
  const grid = $("tourGrid");
  grid.innerHTML = "";
  for (const t of TOURS) {
    if (!tourAllowed(t)) continue;
    const el = document.createElement("div");
    el.className = "tour-tile";
    el.innerHTML = `<div class="tt-top"><span class="tt-icon" aria-hidden="true">${t.icon}</span><div><b>${tutEsc(t.title)}</b><div class="tt-meta">${t.steps.length} steps · about ${Math.max(1, Math.round(t.steps.length / 3))} min</div></div></div>
      <p>${tutEsc(t.desc)}</p>${done.includes(t.id) ? '<span class="tt-done">✓ Done</span>' : ""}`;
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn btn-primary btn-small"; b.textContent = done.includes(t.id) ? "↻ Do it again" : "▶ Start";
    b.onclick = () => startTour(t.id);
    el.appendChild(b);
    grid.appendChild(el);
  }
  if (state.me?.role <= 1) {
    const el = document.createElement("div");
    el.className = "tour-tile";
    el.innerHTML = `<div class="tt-top"><span class="tt-icon" aria-hidden="true">👑</span><div><b>Admin dashboard</b><div class="tt-meta">${state.me?.role === 0 ? "for the SuperAdmin" : "for admins"}</div></div></div>
      <p>${state.me?.role === 0 ? "Everything below, plus 🛡 Admins (create admins, choose what each sees) and 🗄 Server (server settings, restart)." : "The sections opened for you:"} overview with clickable totals, users (edit, access), all agents, calls &amp; usage, templates, settings, sign-ins and activity.</p>`;
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn btn-small"; b.textContent = "Open the dashboard";
    b.onclick = () => (location.href = "/admin.html");
    el.appendChild(b);
    grid.appendChild(el);
  }
}
$("lrClose").addEventListener("click", () => (location.hash = backPage()));
$("learnModal").addEventListener("click", (e) => { if (e.target === $("learnModal")) location.hash = backPage(); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !$("learnModal").classList.contains("open")) return;
  if ([...document.querySelectorAll(".overlay.open")].some((o) => o !== $("learnModal"))) return;
  location.hash = backPage();
});
document.querySelectorAll("[data-tour]").forEach((b) => (b.onclick = () => startTour(b.dataset.tour)));
$("firstAgentBtn").addEventListener("click", () => openAgentDialog());
// 🔄 Restart backend (SuperAdmin): POST /api/super/restart, then wait until the API answers again
async function restartBackend() {
  if (!confirm("Restart the backend now? Calls in progress are cut off. It takes about 10–20 seconds.")) return;
  const veil = Object.assign(document.createElement("div"), { className: "restart-veil" });
  veil.innerHTML = "🔄 Restarting the backend…<small>This page reloads when it's back.</small>";
  document.body.appendChild(veil);
  try {
    const r = await fetch("/api/super/restart", { method: "POST" });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 4000));
    for (let i = 0; i < 90; i++) {
      if (await fetch("/api/health").then((x) => x.ok).catch(() => false)) return location.reload();
      await new Promise((res) => setTimeout(res, 1000));
    }
    veil.innerHTML = "⚠ The backend didn't come back.<small>Check voice_ai_backend/logs/restart.log and error.log.</small>";
  } catch (e) {
    veil.remove();
    alert("Couldn't restart: " + e.message);
  }
}
$("mRestart").addEventListener("click", restartBackend);
$("firstAgentLearn").addEventListener("click", () => startTour("first-agent"));

// ---------- menu: 🎙 Call (main page) · 🤖 My agents (editor, in tabs) · 📚 Tutorials ----------
const TABS = ["profile", "voice", "availability", "tools"];
// Calendar, Emergency and Playbooks now live in 🧰 Tools: their old links open Tools at that section.
const TOOL_SECTIONS = { calendar: "toolCalendar", emergency: "toolEmergency", playbooks: "toolPlaybooks", summaries: "toolSummaries" };
function showTab(tab) {
  const section = TOOL_SECTIONS[tab];
  state.tab = section ? "tools" : TABS.includes(tab) ? tab : "profile";
  if (!allowed(`tab.${state.tab}`)) state.tab = TABS.find((t) => allowed(`tab.${t}`)) || state.tab; // a tab switched off for this account
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
  document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.dataset.panel !== state.tab));
  if (section) requestAnimationFrame(() => {
    const el = $(section);
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
    // put the keyboard on that section's first control (＋ Add, the switch…) without jumping
    el.querySelector("button:not([hidden]):not(:disabled), input:not([type=hidden]):not(:disabled), select:not(:disabled)")?.focus({ preventScroll: true });
  });
}
// 📊 Dashboard is the start page (no hash) when it's open for this account and the user has an agent; else 🎙 Call.
const backPage = () => state.lastPage || startView();
const startView = () => (allowed("dashboard") && (!state.agents || state.agents.length) ? "dashboard" : "call");
function route() {
  let [view, tab] = location.hash.replace(/^#/, "").split("/");
  if (!view || (view === "dashboard" && !allowed("dashboard"))) view = startView();
  const agents = view === "agents", learn = view === "learn", dash = view === "dashboard";
  state.view = dash ? "dashboard" : agents || learn ? view : "call";
  if (!agents && !learn) state.lastPage = state.view; // where ✕ on My agents / Tutorials goes back to
  document.body.dataset.view = agents ? "agents" : learn ? "learn" : dash ? "dashboard" : "call";
  $("agentsModal").classList.toggle("open", agents);
  $("learnModal").classList.toggle("open", learn);
  if (learn) showTutorial();
  $("navDash").setAttribute("aria-current", dash ? "page" : "false");
  if (dash && typeof loadDashboard === "function") loadDashboard();
  $("navCall").setAttribute("aria-current", agents || learn || dash ? "false" : "page");
  $("navAgents").setAttribute("aria-current", agents ? "page" : "false");
  $("navLearn").setAttribute("aria-current", learn ? "page" : "false");
  if (agents) {
    showTab(tab || state.tab);
    if (state.tab === "tools" && SETTINGS.calendar?.enabled) loadCalendar().catch(() => {});
  }
}
document.querySelectorAll(".tabs [data-tab]").forEach((b) => (b.onclick = () => (location.hash = `agents/${b.dataset.tab}`)));
document.querySelectorAll(".topnav [data-go]").forEach((b) => (b.onclick = () => (location.hash = b.dataset.go)));
// My agents is a pop-up window over the call page: ✕, Escape or a click outside closes it.
$("mgClose").addEventListener("click", () => (location.hash = backPage()));
$("agentsModal").addEventListener("click", (e) => { if (e.target === $("agentsModal")) location.hash = backPage(); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !$("agentsModal").classList.contains("open")) return;
  if ([...document.querySelectorAll(".overlay.open")].some((o) => o !== $("agentsModal"))) return; // a dialog on top closes first
  location.hash = backPage();
});
window.addEventListener("hashchange", route);
route();

async function switchAgent(id) {
  if (id === state.agentId || state.inCall) return;
  if (state.session) await endSession(); // a chat with the previous agent is saved first
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
    if (next) await switchAgent(next.id);
    else { SETTINGS.currentAgent = null; state.greet = null; renderAgents(); setSaveStatus(""); } // that was the last one
  } catch (e) { setSaveStatus("⚠ " + e.message, "err"); }
});

// ---------- New agent: a step-by-step wizard ----------
// Profile → Voice → Availability → Calendar → Emergency → Playbook → Review. "Create agent" then makes the agent (POST /api/agents
// with the profile), opens it, applies the other steps through the normal auto-save (POST /api/settings) and prepares
// its greeting, with a progress bar. The type and template list come from the DB (agent_types / agent_templates).
const NA_STEPS = ["profile", "voice", "availability", "tools", "review"]; // the same as the My agents tabs
const na = { type: "personal", step: 0, days: [], rules: [], busy: false, playbookId: "" };

function openAgentDialog() {
  if (state.inCall) return;
  Object.assign(na, { type: "personal", step: 0, days: [], rules: [], busy: false, calTouched: false, created: null, playbookId: "", allDay: false });
  $("naForm").reset();
  $("naErr").textContent = "";
  // Voice step starts from the agent in use (or the app's defaults): providers, language, voice
  $("naTtsProv").innerHTML = $("ttsProv").innerHTML; $("naTtsProv").value = ttsProv();
  $("naSttProv").innerHTML = $("sttProv").innerHTML; $("naSttProv").value = sttProv();
  naLangs($("lang").value);
  $("naVoice").innerHTML = $("voice").innerHTML;
  $("naVoice").value = $("voice").value;
  $("naSpeed").value = "1";
  // Availability step
  if (!$("naTz").options.length) for (const o of $("avTz").options) $("naTz").add(new Option(o.text, o.value));
  $("naTz").value = localTz;
  $("naProgress").hidden = true;
  $("naProgress").className = "na-progress";
  renderAgentTypes();
  renderNaTemplates();
  renderNaSpeed(); renderNaDays(); renderNaRules(); renderNaPlaybooks();
  naGo(0);
  $("agentDialog").classList.add("open");
  setTimeout(() => $("naName").focus(), 30);
}
function closeAgentDialog() { if (!na.busy) $("agentDialog").classList.remove("open"); }

// agent type: a dropdown (with its description underneath) to keep the first step short
function renderAgentTypes() {
  const sel = $("naType");
  if (sel.options.length !== Object.keys(state.agentTypes).length) {
    sel.innerHTML = "";
    for (const [id, t] of Object.entries(state.agentTypes)) sel.add(new Option(`${t.icon || ""} ${t.name}`.trim(), id));
  }
  sel.value = na.type;
  $("naTypeDesc").textContent = typeOf(na.type).description || "";
}
$("naType").addEventListener("change", () => {
  na.type = $("naType").value;
  renderAgentTypes(); renderNaTemplates();
  const t = typeOf(na.type);
  if (t.needsOwner && !$("naOwner").value) $("naOwner").focus();
});
function renderNaTemplates() {
  const t = typeOf(na.type);
  const sel = $("naTemplate");
  sel.innerHTML = "";
  sel.add(new Option("No template: free conversation", ""));
  for (const tp of t.templates || []) sel.add(new Option(tp.name, tp.id));
  sel.value = (t.templates || []).find((x) => x.isDefault)?.id || "";
  $("naOwnerLabel").innerHTML = t.needsOwner ? 'Works for <span class="req">*</span>' : "Works for (optional)";
  if (!na.calTouched) $("naCal").checked = !!t.defaultCalendar; // the type decides until the user flips it
  renderNaPreview();
}
function renderNaPreview() {
  const t = typeOf(na.type);
  const tp = (t.templates || []).find((x) => x.id === $("naTemplate").value);
  const v = { agent: $("naName").value.trim() || "…", owner: $("naOwner").value.trim(), org: $("naOrg").value.trim() };
  showPreview($("naPreview"), "It will answer:", renderTpl(tp?.greeting || t.greeting || "", v));
}
$("naTemplate").addEventListener("change", renderNaPreview);
["naName", "naOwner", "naOrg"].forEach((id) => $(id).addEventListener("input", () => { renderNaPreview(); $("naErr").textContent = ""; }));

// speed
const naSpeed = () => Math.min(2, Math.max(0.5, Number($("naSpeed").value) || 1));
function renderNaSpeed() {
  $("naSpeedVal").textContent = `${naSpeed().toFixed(2)}×`;
}
$("naSpeed").addEventListener("input", renderNaSpeed);

// providers in the wizard: same rules as the Voice & AI tab (languages both support, the provider's voices)
function naLangs(keep = $("naLang").value) {
  const t = provInfo("tts", $("naTtsProv").value).langs, st = provInfo("stt", $("naSttProv").value).langs;
  const ok = [...LANGS].sort((a, b) => b[3] - a[3]).filter(([c]) => supports(t, c) && supports(st, c));
  $("naLang").innerHTML = "";
  ok.forEach(([c, label]) => $("naLang").add(new Option(label, c)));
  $("naLang").value = ok.some(([c]) => c === keep) ? keep : ok[0]?.[0] || "en-US";
  $("naLangHint").textContent = `(${ok.length}, most spoken first)`;
}
async function naVoices() {
  const p = $("naTtsProv").value, sel = $("naVoice");
  let list;
  if (p === "openai") list = Object.entries(state.voices || {}).map(([id, label]) => ({ id, label }));
  else {
    const key = `${p}|${p === "aws" ? $("naLang").value : ""}`;
    state.voiceLists ||= {};
    if (!state.voiceLists[key]) {
      sel.innerHTML = ""; sel.add(new Option("Loading voices…", ""));
      try {
        const r = await fetch(`/api/voices?provider=${encodeURIComponent(p)}&lang=${encodeURIComponent($("naLang").value)}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Couldn't load voices");
        state.voiceLists[key] = d.voices || [];
      } catch (e) { sel.innerHTML = ""; sel.add(new Option("⚠ " + e.message, "")); return; }
    }
    list = state.voiceLists[key];
  }
  if ($("naTtsProv").value !== p) return;
  sel.innerHTML = "";
  for (const v of list) sel.add(new Option(v.label, v.id));
  if (!list.length) sel.add(new Option("No voice for this language", ""));
}
$("naTtsProv").addEventListener("change", () => { naLangs(); naVoices(); });
$("naSttProv").addEventListener("change", () => { const was = $("naLang").value; naLangs(); if ($("naTtsProv").value === "aws" && $("naLang").value !== was) naVoices(); });
$("naLang").addEventListener("change", () => { if ($("naTtsProv").value === "aws") naVoices(); });

// ▶ listen: a short hello in the chosen language and voice, at the chosen speed
$("naListen").addEventListener("click", async () => {
  const btn = $("naListen");
  btn.disabled = true; btn.textContent = "…";
  try {
    const sample = (LANGS.find((l) => l[0] === $("naLang").value) || LANGS[0])[2].replace("{name}", $("naName").value.trim() || "your agent");
    const model = $("naTtsProv").value === ttsProv() ? $("ttsSel").value : provInfo("tts", $("naTtsProv").value).models?.[0] || "";
    const url = await fetchSpeech(sample, "cheerful", { voice: $("naVoice").value, language: $("naLang").value, provider: $("naTtsProv").value, model });
    const a = new Audio(url);
    a.preservesPitch = true;
    a.playbackRate = naSpeed();
    a.onended = () => URL.revokeObjectURL(url);
    await a.play();
    $("naErr").textContent = "";
  } catch (e) {
    $("naErr").textContent = "Couldn't play the voice: " + e.message;
  } finally {
    btn.disabled = false; btn.textContent = "▶";
  }
});

// playbook: none (the agent's own template) or one of the user's saved playbooks
function renderNaPlaybooks() {
  const list = $("naPbs");
  list.innerHTML = "";
  const inUse = new Set(state.agents.map((a) => a.playbookId).filter(Boolean)); // already used by one of your agents
  const free = state.saved.filter((pb) => !inUse.has(pb.id));
  if (na.playbookId && !free.some((pb) => pb.id === na.playbookId)) na.playbookId = "";
  const items = [{ id: "", name: "No playbook: use the agent's template", type: null }, ...free];
  for (const pb of items) {
    const t = pb.type ? state.types[pb.type] : null;
    const row = document.createElement("div");
    row.className = "pb-item" + (pb.id === na.playbookId ? " selected" : "");
    row.setAttribute("role", "button"); row.tabIndex = 0;
    row.setAttribute("aria-pressed", String(pb.id === na.playbookId));
    row.innerHTML = `<div class="pb-icon"></div><div class="pb-text"><div class="pb-name"></div><div class="pb-type"></div></div>`;
    row.querySelector(".pb-icon").textContent = t ? t.icon : "💬";
    row.querySelector(".pb-name").textContent = pb.name;
    row.querySelector(".pb-type").textContent = t ? `${t.name} · ${pb.goal}` : "Follows the type and template chosen in Profile";
    const pick = () => { na.playbookId = pb.id; renderNaPlaybooks(); };
    row.addEventListener("click", pick);
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    list.appendChild(row);
  }
  $("naPbHint").textContent = !state.saved.length ? "You have no saved playbooks yet. Add them later in Agent studio → Tools → Playbook."
    : !free.length ? "All your playbooks are already used by your other agents. Add a new one later in Agent studio → Tools → Playbook."
    : inUse.size ? `${state.saved.length - free.length} playbook(s) already used by your other agents are hidden.` : "";
}

// availability (same plan format as My agents → Availability)
DAY_NAMES.forEach((d, i) => {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = d; b.dataset.day = String(i + 1);
  b.onclick = () => { const n = i + 1; na.days = na.days.includes(n) ? na.days.filter((x) => x !== n) : [...na.days, n].sort(); renderNaDays(); };
  $("naDays").appendChild(b);
});
document.querySelectorAll("[data-na-days]").forEach((b) => (b.onclick = () => { naAllDay(false); na.days = b.dataset.naDays ? b.dataset.naDays.split(",").map(Number) : []; renderNaDays(); }));
function naAllDay(on) {
  na.allDay = on;
  if (on) { na.days = [1, 2, 3, 4, 5, 6, 7]; $("naFrom").value = "00:00"; $("naTo").value = "23:59"; }
  else if ($("naFrom").value === "00:00" && $("naTo").value === "23:59") { $("naFrom").value = "09:00"; $("naTo").value = "18:00"; }
}
$("na247").addEventListener("click", () => { naAllDay(!na.allDay); renderNaDays(); });
$("naHol").addEventListener("change", () => { fillHolidayCountries($("naHolCountry"), $("naHolCountry").value || "IN"); renderNaDays(); });
$("naHolCountry").addEventListener("change", renderNaDays);
["naFrom", "naTo", "naTz"].forEach((id) => $(id).addEventListener("change", renderNaDays));
$("naAvNote").addEventListener("input", renderNaDays);
function naPlan() {
  const note = $("naAvNote").value.trim();
  const holidays = { on: $("naHol").checked, country: $("naHolCountry").value || "IN" };
  if (!na.days.length && !note && !holidays.on) return null;
  return { days: na.days, from: $("naFrom").value || "09:00", to: $("naTo").value || "18:00", tz: $("naTz").value, note, allDay: !!na.allDay, holidays, offDates: [] };
}
function naPlanText() { return planToText(naPlan()); }
function renderNaDays() {
  $("naDays").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(na.days.includes(Number(b.dataset.day)))));
  $("na247").setAttribute("aria-pressed", String(!!na.allDay));
  $("na247").classList.toggle("on", !!na.allDay);
  $("naHolWrap").hidden = !$("naHol").checked;
  const owner = $("naOwner").value.trim();
  $("naAvWho").textContent = owner || "the owner";
  const text = naPlanText();
  if (text) showPreview($("naAvPreview"), `${owner || "Available"}:`, text);
  else $("naAvPreview").textContent = "No availability set: the agent asks the caller for a time and takes it as a request.";
}

// calendar
$("naCal").addEventListener("change", () => { na.calTouched = true; });

// emergency contacts
$("naEmg").addEventListener("change", () => { $("naEmgBox").hidden = !$("naEmg").checked; if ($("naEmg").checked) $("naEmgLabel").focus(); });
function naEmgVia() {
  const via = $("naEmgType").value, mail = via === "email", wa = via === "whatsapp";
  $("naEmgNumberLabel").textContent = mail ? "Email" : wa ? "WhatsApp number" : "Number";
  $("naEmgNumber").placeholder = mail ? "e.g. help@company.com" : wa ? "e.g. 98765 43210" : "e.g. 108";
  $("naEmgNumber").inputMode = mail ? "email" : "tel";
  fillEmgCc($("naEmgCc"), via);
}
$("naEmgType").addEventListener("change", naEmgVia);
$("naEmgCc").addEventListener("change", () => fillEmgCc($("naEmgCc"), $("naEmgType").value));
function naAddRule() {
  const label = $("naEmgLabel").value.trim(), typed = $("naEmgNumber").value.trim();
  const keywords = $("naEmgWords").value.split(",").map((w) => w.trim()).filter(Boolean);
  if (!label && !typed && !keywords.length) return true; // nothing typed
  if (!label || !typed || !keywords.length) { $("naErr").textContent = "Fill in the name, the number (or email) and at least one word for this contact."; return false; }
  const nv = emgNumberValue($("naEmgCc"), $("naEmgNumber"), $("naEmgType").value);
  if (nv.error) { $("naErr").textContent = nv.error; $("naEmgNumber").focus(); return false; }
  const number = nv.number;
  na.rules.push({ label, type: $("naEmgType").value, number, keywords });
  ["naEmgLabel", "naEmgNumber", "naEmgWords"].forEach((id) => ($(id).value = ""));
  $("naErr").textContent = "";
  renderNaRules();
  return true;
}
$("naEmgAdd").addEventListener("click", () => { if (naAddRule()) $("naEmgLabel").focus(); });
function renderNaRules() {
  const list = $("naEmgList");
  list.innerHTML = "";
  na.rules.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "na-item";
    const t = document.createElement("span");
    t.textContent = `${r.type === "email" ? "✉" : r.type === "whatsapp" ? "💬" : "📞"} ${r.label} · ${r.number} — when the caller says: ${r.keywords.join(", ")}`;
    const del = document.createElement("button");
    del.type = "button"; del.className = "link"; del.textContent = "Remove";
    del.onclick = () => { na.rules.splice(i, 1); renderNaRules(); };
    row.append(t, del);
    list.appendChild(row);
  });
}

// call summaries (WhatsApp / email after every call), the same switches as My agents → Tools
function renderNaNotify() {
  for (const [sw, to, st, ch] of [["naNfWa", "naNfWaRow", "naNfWaState", "whatsapp"], ["naNfMail", "naNfMailTo", "naNfMailState", "email"]]) {
    $(to).hidden = !$(sw).checked;
    const ready = state.channels?.[ch] !== false;
    $(st).textContent = ready ? "" : "not set up on the server yet";
    $(sw).disabled = !ready && !$(sw).checked;
  }
  fillCc($("naNfWaCc"));
}
["naNfWa", "naNfMail"].forEach((id) => $(id).addEventListener("change", () => {
  renderNaNotify();
  const to = $(id === "naNfWa" ? "naNfWaTo" : "naNfMailTo");
  if ($(id).checked && !to.value) to.focus();
}));

// stepping
function naCheck(step) {
  const t = typeOf(na.type);
  if (step === "profile") {
    if (!$("naName").value.trim()) { $("naErr").textContent = "Give your agent a name."; $("naName").focus(); return false; }
    if (t.needsOwner && !$("naOwner").value.trim()) { $("naErr").textContent = "Who does this agent work for? Add their name."; $("naOwner").focus(); return false; }
  }
  if (step === "availability" && na.days.length && $("naFrom").value >= $("naTo").value) {
    $("naErr").textContent = "The end time must be after the start time."; $("naTo").focus(); return false;
  }
  if (step === "tools") {
    if ($("naEmg").checked && !naAddRule()) return false; // a contact still being typed is added (or explained) first
    if ($("naNfWa").checked) {
      const r = fullNumber($("naNfWaCc"), $("naNfWaTo"));
      if (r.error) { $("naErr").textContent = "Call summaries by WhatsApp: " + r.error; $("naNfWaTo").focus(); return false; }
    }
    if ($("naNfMail").checked && !/^[^\s@,]+@[^\s@,]+\.[^\s@,]{2,}(\s*,\s*[^\s@,]+@[^\s@,]+\.[^\s@,]{2,})*$/.test($("naNfMailTo").value.trim())) {
      $("naErr").textContent = "Call summaries by email: enter a valid email address."; $("naNfMailTo").focus(); return false;
    }
  }
  return true;
}
function naGo(n) {
  na.step = Math.max(0, Math.min(NA_STEPS.length - 1, n));
  const step = NA_STEPS[na.step];
  document.querySelectorAll("#naForm .na-step").forEach((sec) => (sec.hidden = sec.dataset.step !== step));
  $("naSteps").querySelectorAll("li").forEach((li, i) => {
    li.classList.toggle("done", i < na.step);
    li.classList.toggle("current", i === na.step);
  });
  $("naFill").style.width = `${(na.step / (NA_STEPS.length - 1)) * 100}%`;
  $("naBack").style.visibility = na.step ? "visible" : "hidden";
  $("naNext").hidden = step === "review";
  $("naCreate").hidden = step !== "review";
  $("naErr").textContent = "";
  if (step === "availability") renderNaDays();
  if (step === "tools") { $("naEmgBox").hidden = !$("naEmg").checked; naEmgVia(); renderNaPlaybooks(); renderNaNotify(); }
  if (step === "review") renderNaReview();
}
$("naNext").addEventListener("click", () => { if (naCheck(NA_STEPS[na.step])) naGo(na.step + 1); });
$("naBack").addEventListener("click", () => { if (!na.busy) naGo(na.step - 1); });
// the step list at the top: jump back to any earlier step, or forward when the steps in between are fine
$("naSteps").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li || na.busy) return;
  const to = NA_STEPS.indexOf(li.dataset.step);
  for (let k = na.step; k < to; k++) if (!naCheck(NA_STEPS[k])) return naGo(k);
  naGo(to);
});
// Enter in a field = Next (not submit) until the last step
$("naForm").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("input") && NA_STEPS[na.step] !== "review") { e.preventDefault(); $("naNext").click(); }
});

function renderNaReview() {
  const t = typeOf(na.type);
  const tp = (t.templates || []).find((x) => x.id === $("naTemplate").value);
  const voiceText = $("naVoice").selectedOptions[0]?.text || $("naVoice").value;
  const rows = [
    ["Name", $("naName").value.trim(), 0],
    ["Type", `${t.icon || ""} ${t.name}`, 0],
    ["Template", tp ? tp.name : "Free conversation", 0],
    ["Works for", [$("naOwner").value.trim(), $("naOrg").value.trim()].filter(Boolean).join(" · ") || "—", 0],
    ["What it's for", $("naDesc").value.trim() || "—", 0],
    ["Speech", `hears with ${provInfo("stt", $("naSttProv").value).label} · speaks with ${provInfo("tts", $("naTtsProv").value).label}`, 1],
    ["Language · voice", `${$("naLang").selectedOptions[0]?.text} · ${voiceText.split(" — ")[0]}`, 1],
    ["Speaking speed", `${naSpeed().toFixed(2)}×`, 1],
    ["Availability", naPlanText() || "Not set (asks the caller)", 2],
    ["Calendar", $("naCal").checked ? "On" : "Off", 3],
    ["Emergency", $("naEmg").checked && na.rules.length ? na.rules.map((r) => `${r.label} (${r.number})`).join(", ") : "Off", 3],
    ["Playbook", state.saved.find((p) => p.id === na.playbookId)?.name || "None (the agent's template)", 3],
    ["Call summaries", [$("naNfWa").checked && "WhatsApp", $("naNfMail").checked && "email"].filter(Boolean).join(" + ") || "Off", 3],
  ];
  const dl = $("naReview");
  dl.innerHTML = "";
  for (const [k, v, step] of rows) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    const edit = document.createElement("button");
    edit.type = "button"; edit.className = "link na-edit"; edit.textContent = "Edit";
    edit.onclick = () => naGo(step);
    dd.appendChild(edit);
    dl.append(dt, dd);
  }
  const greet = document.createElement("dd");
  dl.append(Object.assign(document.createElement("dt"), { textContent: "First line" }), greet);
  showPreview(greet, "", renderTpl(tp?.greeting || t.greeting || "", { agent: $("naName").value.trim(), owner: $("naOwner").value.trim(), org: $("naOrg").value.trim() }));
}

function naProgress(pct, text, cls = "") {
  $("naProgress").hidden = false;
  $("naProgress").className = "na-progress" + (cls ? " " + cls : "");
  $("naBar").style.width = pct + "%";
  $("naBarText").textContent = text;
}

$("naForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (na.busy || NA_STEPS[na.step] !== "review") return;
  for (const st of NA_STEPS.slice(0, -1)) if (!naCheck(st)) return naGo(NA_STEPS.indexOf(st));
  na.busy = true;
  ["naCreate", "naBack", "naCancel"].forEach((id) => ($(id).disabled = true));
  try {
    naProgress(15, "Creating the agent…");
    // made already on an earlier try that failed later on: don't make a second one
    const a = na.created || (na.created = await agentRequest("/api/agents", "POST", {
      name: $("naName").value.trim(), type: na.type, description: $("naDesc").value.trim(), templateId: $("naTemplate").value,
      ownerName: $("naOwner").value.trim(), organization: $("naOrg").value.trim(), availability: naPlanText(),
    }));
    if (!state.agents.some((x) => x.id === a.id)) state.agents.push(a);

    naProgress(40, "Opening it…");
    await switchAgent(a.id);

    naProgress(65, "Saving voice, availability and tools (calendar, emergency, playbook, call summaries)…");
    $("ttsProv").value = $("naTtsProv").value; $("sttProv").value = $("naSttProv").value;
    fillTtsModels(""); fillSttModels("");
    renderLangs($("naLang").value);
    await renderVoices($("naVoice").value);
    $("speedRange").value = String(naSpeed()); renderSpeed();
    state.playbookId = state.saved.some((p) => p.id === na.playbookId) ? na.playbookId : ""; renderPlaybooks();
    av.days = [...na.days]; $("avFrom").value = $("naFrom").value; $("avTo").value = $("naTo").value;
    if (![...$("avTz").options].some((o) => o.value === $("naTz").value)) $("avTz").add(new Option($("naTz").value, $("naTz").value));
    $("avTz").value = $("naTz").value; $("avNote").value = $("naAvNote").value.trim();
    av.allDay = !!na.allDay; av.offDates = [];
    $("avHol").checked = $("naHol").checked; fillHolidayCountries($("avHolCountry"), $("naHolCountry").value || "IN");
    renderAvailability();
    $("calToggle").checked = $("naCal").checked;
    $("emgToggle").checked = $("naEmg").checked && na.rules.length > 0;
    state.rules = $("naEmg").checked ? structuredClone(na.rules) : [];
    $("nfWa").checked = $("naNfWa").checked; fillCc($("nfWaCc"), $("naNfWaCc").value); $("nfWaTo").value = $("naNfWa").checked ? $("naNfWaTo").value.trim() : "";
    $("nfMail").checked = $("naNfMail").checked; $("nfMailTo").value = $("naNfMail").checked ? $("naNfMailTo").value.trim() : "";
    renderNotify();
    renderRules(); renderNotes();
    clearTimeout(state.saveTimer);
    await autoSave();
    if (formSnapshot() !== state.savedSnapshot) throw new Error("Couldn't save the agent's settings. Open Agent studio to check them.");

    naProgress(90, "Preparing its greeting…");
    await Promise.race([Promise.resolve(prepareGreeting()), new Promise((r) => setTimeout(r, 4000))]);

    naProgress(100, `✓ ${a.name} is ready!`, "ok");
    await new Promise((r) => setTimeout(r, 900));
    na.busy = false;
    closeAgentDialog();
    location.hash = "call";
  } catch (err) {
    naProgress(100, "⚠ " + err.message, "err");
    $("naErr").textContent = err.message;
  } finally {
    na.busy = false;
    ["naCreate", "naBack", "naCancel"].forEach((id) => ($(id).disabled = false));
  }
});
$("naClose").addEventListener("click", closeAgentDialog);
$("naCancel").addEventListener("click", closeAgentDialog);
$("agentDialog").addEventListener("click", (e) => { if (e.target === $("agentDialog")) closeAgentDialog(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAgentDialog(); });

// ---------- start-up ----------
(async () => {
  try {
    const meRes = await fetch("/api/me").then((r) => r.json());
    state.me = meRes.user;
    applyAccess(meRes.access);
    state.agentId = store.get(agentKey()) || ""; // the agent this user had open last time
    await loadAgents();
    route(); // now we know the access and whether there are agents (start page, admin topic in tutorials)
    await loadConfig();
    if (SETTINGS.currentAgent && SETTINGS.currentAgent.id !== state.agentId) { state.agentId = SETTINGS.currentAgent.id; renderAgents(); }
    await loadPlaybooks();
    fillForm(); // show the saved settings right away
    // The model list comes from OpenAI and can take a few seconds; fill the dropdowns when it arrives.
    loadModels().then(() => { state.savedSnapshot = formSnapshot(); renderSummary(); }).catch(() => {});
    loadCalendar().catch(() => {});
    calendarReturn().catch(() => {});
    // No agents yet (new account): show how to create one instead of making one for them.
    if (!state.agents.length && !location.hash.replace("#", "") && allowed("agents.create")) startTour("first-agent");
    } catch (e) {
    addMsg("error", "Couldn't load settings: " + e.message);
  }
})();
