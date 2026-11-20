// TelemuneSmartAi site themes: 8 colour sets (light + dark), each with its own moving background (motion.js) and the way
// cards come in (motion.css). The admin picks one in Admin → Settings → Theme (app_config branding.theme {name, motion});
// every page (login, call, admin) loads this file in <head>, applies the last theme at once (no flash) and then asks the
// backend (GET /api/auth-options → theme). Theme "violet" is the original look: it changes nothing.
// Root attributes: data-site-theme = theme id, data-motion = background style or "off". Event "tsa-theme" on change.
(() => {
  // surfaces: [bg, panel, panel-2, text, muted, border]
  const THEMES = [
    { id: "violet", name: "Telemune Violet", note: "The original look", motion: "network", enter: "tsa-rise", c: ["#7c3aed", "#ec4899", "#06b6d4"],
      light: ["#faf7ff", "#ffffffd9", "#f4f0ff", "#1b1433", "#6b6488", "#e7e0fb"], dark: ["#0c0718", "#160f2bd9", "#20173d", "#f3efff", "#a79fc7", "#2f2552"] },
    { id: "ocean", name: "Ocean Breeze", note: "Calm, fresh", motion: "waves", enter: "tsa-slide", c: ["#0891b2", "#0d9488", "#2563eb"],
      light: ["#f2fbfc", "#ffffffd9", "#e6f6f8", "#0b2530", "#52707a", "#cfe9ee"], dark: ["#06161c", "#0b2229d9", "#103039", "#e6fbff", "#8db4bd", "#1c4450"] },
    { id: "sunset", name: "Sunset Coral", note: "Warm, friendly", motion: "aurora", enter: "tsa-zoom", c: ["#ea580c", "#e11d48", "#f59e0b"],
      light: ["#fff8f3", "#ffffffd9", "#fff0e6", "#2b1510", "#7d5a4e", "#fbe0d2"], dark: ["#1a0b07", "#26120cd9", "#331a12", "#fff1ea", "#c49a8a", "#4a2619"] },
    { id: "emerald", name: "Emerald Grove", note: "Health, finance", motion: "fireflies", enter: "tsa-rise", c: ["#059669", "#4d7c0f", "#0d9488"],
      light: ["#f4fbf6", "#ffffffd9", "#e8f6ed", "#0f2418", "#557263", "#d3ecdc"], dark: ["#07150e", "#0d2117d9", "#132d20", "#e8fbef", "#8fb8a0", "#1f4231"] },
    { id: "gold", name: "Midnight Gold", note: "Premium", motion: "stars", enter: "tsa-blur", c: ["#b8860b", "#a16207", "#92400e"],
      light: ["#fbf8f0", "#ffffffd9", "#f6efdc", "#221a08", "#6f6447", "#ece2c6"], dark: ["#0b0a08", "#15130ed9", "#1e1b14", "#f7f0dc", "#b3a785", "#3a3322"] },
    { id: "corporate", name: "Corporate Blue", note: "Clean, quiet", motion: "calm", enter: "tsa-blur", c: ["#2563eb", "#1e40af", "#0ea5e9"],
      light: ["#f5f7fb", "#ffffffe6", "#eef2f8", "#0f172a", "#5b6578", "#dde3ee"], dark: ["#0b1120", "#111a2ee6", "#17223a", "#e8eefb", "#93a0b8", "#24324f"] },
    { id: "neon", name: "Neon Pulse", note: "Bold, techy", motion: "grid", enter: "tsa-tilt", c: ["#0891b2", "#9333ea", "#db2777"],
      light: ["#f7f7fc", "#ffffffd9", "#efedf8", "#12101f", "#625e7a", "#e2dff0"], dark: ["#05040d", "#0d0b1ad9", "#151229", "#f2f0ff", "#9b96bd", "#2a2547"] },
    { id: "rose", name: "Rose Quartz", note: "Soft, playful", motion: "bubbles", enter: "tsa-bounce", c: ["#db2777", "#c026d3", "#f43f5e"],
      light: ["#fff6fa", "#ffffffd9", "#fdebf3", "#2a0f1d", "#7d5568", "#f6d9e6"], dark: ["#17070f", "#230d18d9", "#2e1220", "#ffeef6", "#c693ab", "#4a1d33"] },
  ];
  const MOTIONS = { network: "Network lines", waves: "Flowing waves", aurora: "Aurora glow", fireflies: "Rising fireflies",
    stars: "Twinkling stars", calm: "Soft drift", grid: "Neon grid", bubbles: "Floating bubbles" };
  const ENTERS = { "tsa-rise": "Rise up", "tsa-slide": "Slide in", "tsa-zoom": "Zoom in", "tsa-blur": "Blur fade", "tsa-tilt": "Tilt in", "tsa-bounce": "Pop" };

  const vars = (t, s, dark) => `--c1:${t.c[0]};--c2:${t.c[1]};--c3:${t.c[2]};--bg:${s[0]};--panel:${s[1]};--panel-2:${s[2]};--text:${s[3]};--muted:${s[4]};--border:${s[5]};`
    + `--agent-bubble:${s[2]};--summary-bg:color-mix(in srgb,var(--c3) ${dark ? 12 : 8}%,${s[0]});--summary-border:color-mix(in srgb,var(--c3) ${dark ? 35 : 30}%,${s[0]});`
    + `--net-dot:${dark ? `color-mix(in srgb,${t.c[0]} 55%,white)` : t.c[0]};`;
  // light on [data-site-theme] (beats the pages' :root); dark one step stronger (beats the pages' dark blocks)
  let css = "";
  for (const t of THEMES) {
    const sel = `:root[data-site-theme="${t.id}"]`;
    css += `${sel}{--tsa-enter:${t.enter};}`;
    if (t.id === "violet") continue; // the pages' own colours
    css += `${sel}{${vars(t, t.light, false)}}`
      + `@media (prefers-color-scheme: dark){${sel}:not([data-theme="light"]){${vars(t, t.dark, true)}}}`
      + `${sel}[data-theme="dark"]{${vars(t, t.dark, true)}}`;
  }
  const style = document.createElement("style");
  style.id = "tsa-themes";
  style.textContent = css;
  document.head.appendChild(style);

  const root = document.documentElement;
  const KEY = "tsa-site-theme";
  let current = null;
  function apply(theme) {
    const want = theme && typeof theme === "object" ? theme : {};
    const t = THEMES.find((x) => x.id === want.name) || THEMES[0];
    const motion = want.motion === false ? "off" : t.motion;
    const same = current && current.name === t.id && current.motion === motion;
    current = { name: t.id, motion };
    root.dataset.siteTheme = t.id;
    root.dataset.motion = motion;
    try { localStorage.setItem(KEY, JSON.stringify({ name: t.id, motion: motion !== "off" })); } catch {}
    if (!same) dispatchEvent(new CustomEvent("tsa-theme", { detail: current }));
    return t;
  }
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
  apply(cached);
  // the admin's choice from the server (public, so the login page gets it too)
  fetch("/api/auth-options", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((o) => { if (o && o.theme) apply(o.theme); }).catch(() => {});

  window.TSA_THEME = { list: THEMES, motions: MOTIONS, enters: ENTERS, apply, current: () => current };
})();
