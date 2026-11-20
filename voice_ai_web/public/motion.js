// TelemuneSmartAi motion theme: the moving background behind every page (styles in motion.css, themes in themes.js).
// The style comes from <html data-motion>: network (dots joined by lines that move away from the mouse), waves, aurora,
// calm, fireflies, stars, grid, bubbles, or off. Colours follow the theme (--c1/--c2/--c3, --net-dot).
// Stops while the tab is hidden; one still frame with "reduce motion".
(() => {
  const start = () => {
    if (document.querySelector(".net-bg")) return;
    const root = document.documentElement;
    const cv = document.createElement("canvas");
    cv.className = "net-bg";
    cv.setAttribute("aria-hidden", "true");
    document.body.prepend(cv);
    const ctx = cv.getContext("2d");
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1, pts = [], kind = "", col = {}, shoot = null;
    const mouse = { x: -9999, y: -9999 };
    const rnd = (a, b) => a + Math.random() * (b - a);

    // any CSS colour → "#rrggbb", so alpha can be added for gradients
    const norm = (c, fallback) => { ctx.fillStyle = "#000"; ctx.fillStyle = c || fallback; const v = ctx.fillStyle; return v.startsWith("#") ? v : fallback; };
    const a = (hex, x) => hex + Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0");
    const isDark = () => root.dataset.theme === "dark" || (root.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    function colours() {
      const css = getComputedStyle(root);
      col = { c1: norm(css.getPropertyValue("--c1").trim(), "#7c3aed"), c2: norm(css.getPropertyValue("--c2").trim(), "#ec4899"),
        c3: norm(css.getPropertyValue("--c3").trim(), "#06b6d4"), dot: norm(css.getPropertyValue("--net-dot").trim(), "#7c3aed"),
        alpha: parseFloat(css.getPropertyValue("--net-alpha")) || 0.55, dark: isDark() };
    }
    function seed() {
      const area = W * H;
      const n = { network: Math.max(24, Math.min(90, area / 14000)), fireflies: area / 14000, stars: area / 5000, bubbles: area / 30000 }[kind] || 0;
      pts = Array.from({ length: Math.min(220, Math.round(n)) }, () => ({ x: rnd(0, W), y: rnd(0, H), vx: rnd(-0.25, 0.25), vy: rnd(-0.25, 0.25), r: rnd(1, 3), p: rnd(0, 6.28), s: rnd(0.3, 1) }));
      if (kind === "bubbles") pts.forEach((b) => { b.r = rnd(8, 34); b.vy = -rnd(0.2, 0.6); });
      if (kind === "fireflies") pts.forEach((b) => { b.vy = -rnd(0.15, 0.5); });
    }
    function size() {
      dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }
    function setKind() {
      const k = root.dataset.motion || "network";
      colours();
      if (k !== kind) { kind = k; seed(); }
      cv.hidden = kind === "off";
      if (still) draw(0);
    }

    function draw(t) {
      ctx.clearRect(0, 0, W, H);
      if (kind === "off") return;
      const k = col.dark ? 1 : 0.7;
      if (kind === "network") {
        const R = 140;
        ctx.fillStyle = col.dot; ctx.strokeStyle = col.dot; ctx.lineWidth = 1;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          ctx.globalAlpha = col.alpha; ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, 7); ctx.fill();
          for (let j = i + 1; j < pts.length; j++) {
            const q = pts[j], d = Math.hypot(p.x - q.x, p.y - q.y);
            if (d < R) { ctx.globalAlpha = (1 - d / R) * col.alpha * 0.6; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
          }
        }
        ctx.globalAlpha = 1;
      } else if (kind === "waves") {
        [[col.c3, 0.10, 60, 0.0009, 0], [col.c1, 0.13, 42, 0.0013, 2], [col.c2, 0.12, 28, 0.0018, 4]].forEach(([c, al, amp, sp, ph], i) => {
          ctx.fillStyle = a(c, al * (col.dark ? 1.4 : 1)); ctx.beginPath(); ctx.moveTo(0, H);
          for (let x = 0; x <= W; x += 12) ctx.lineTo(x, H * (0.62 + i * 0.1) + Math.sin(x * 0.006 + t * sp + ph) * amp + Math.sin(x * 0.013 + t * sp * 1.7) * amp * 0.4);
          ctx.lineTo(W, H); ctx.fill();
        });
      } else if (kind === "aurora" || kind === "calm") {
        const slow = kind === "calm" ? 0.00006 : 0.00018, al = kind === "calm" ? 0.16 : 0.3;
        [[col.c1, 0.25, 0.3, 0], [col.c2, 0.75, 0.35, 2], [col.c3, 0.5, 0.8, 4]].forEach(([c, fx, fy, ph]) => {
          const x = W * (fx + Math.sin(t * slow + ph) * 0.15), y = H * (fy + Math.cos(t * slow * 1.3 + ph) * 0.12), r = Math.max(W, H) * 0.45;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, a(c, al * k)); g.addColorStop(1, a(c, 0));
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        });
      } else if (kind === "fireflies") {
        for (const p of pts) {
          const f = 0.5 + 0.5 * Math.sin(t * 0.003 * p.s + p.p), r = p.r * 9, c = p.s > 0.65 ? col.c2 : col.c1;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); g.addColorStop(0, a(c, 0.6 * f * k)); g.addColorStop(1, a(c, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
        }
      } else if (kind === "stars") {
        const star = col.dark ? "#ffffff" : col.c3;
        for (const p of pts) { const f = 0.35 + 0.65 * Math.abs(Math.sin(t * 0.0012 * p.s + p.p)); ctx.fillStyle = a(star, f * (col.dark ? 0.8 : 0.45)); ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.6, 0, 7); ctx.fill(); }
        if (shoot) {
          const x1 = shoot.x - (shoot.l - 12) * 9, y1 = shoot.y + (shoot.l - 12) * 4.5, x2 = shoot.x - shoot.l * 9, y2 = shoot.y + shoot.l * 4.5;
          const g = ctx.createLinearGradient(x1, y1, x2, y2); g.addColorStop(0, a(col.c1, 0)); g.addColorStop(1, a(col.c1, 0.9));
          ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
      } else if (kind === "grid") {
        const hy = H * 0.55, off = (t * 0.04) % 40;
        const g = ctx.createLinearGradient(0, hy - 80, 0, hy + 40); g.addColorStop(0, a(col.c2, 0)); g.addColorStop(0.7, a(col.c2, 0.18 * k)); g.addColorStop(1, a(col.c2, 0));
        ctx.fillStyle = g; ctx.fillRect(0, hy - 80, W, 120);
        ctx.strokeStyle = a(col.c1, 0.28 * k); ctx.lineWidth = 1;
        for (let i = 0; i < 18; i++) { const z = (i * 40 + off) / 720, y = hy + (H - hy) * z * z * 1.6; if (y > H) break; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
        for (let i = -14; i <= 14; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 18, hy); ctx.lineTo(W / 2 + i * 140, H); ctx.stroke(); }
        ctx.fillStyle = a(col.c1, 0.05 * k); ctx.fillRect(0, (t * 0.08) % H, W, 3);
      } else if (kind === "bubbles") {
        for (const p of pts) {
          const c = p.s > 0.6 ? col.c2 : col.c1;
          ctx.strokeStyle = a(c, 0.35 * k); ctx.fillStyle = a(p.s > 0.6 ? col.c2 : col.c3, 0.07 * k); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); ctx.stroke();
          ctx.fillStyle = a("#ffffff", 0.35 * k); ctx.beginPath(); ctx.arc(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.18, 0, 7); ctx.fill();
        }
      }
    }
    function step(t) {
      if (kind === "network") {
        for (const p of pts) {
          p.x += p.vx; p.y += p.vy;
          if (p.x < 0 || p.x > W) p.vx *= -1;
          if (p.y < 0 || p.y > H) p.vy *= -1;
          const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy);
          if (d < 140 && d > 0) { p.x += dx / d * 1.5; p.y += dy / d * 1.5; }
        }
      } else if (kind === "fireflies" || kind === "bubbles") {
        const sway = kind === "bubbles" ? 0.0008 : 0.001;
        for (const p of pts) {
          p.y += p.vy; p.x += Math.sin(t * sway + p.p) * 0.3;
          if (p.y < -p.r * 9) { p.y = H + p.r * 2; p.x = rnd(0, W); }
        }
      } else if (kind === "stars") {
        if (!shoot && Math.random() < 0.004) shoot = { x: rnd(W * 0.2, W), y: rnd(0, H * 0.4), l: 0 };
        if (shoot && ++shoot.l > 60) shoot = null;
      }
    }
    function tick(t) {
      if (!document.hidden && kind !== "off") { step(t); draw(t); }
      requestAnimationFrame(tick);
    }

    size();
    setKind();
    addEventListener("resize", () => { size(); if (still) draw(0); });
    addEventListener("mousemove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
    addEventListener("mouseout", () => { mouse.x = mouse.y = -9999; });
    addEventListener("tsa-theme", setKind);
    new MutationObserver(setKind).observe(root, { attributes: true, attributeFilter: ["data-theme", "data-motion", "data-site-theme", "style"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", setKind);
    if (!still) requestAnimationFrame(tick);
  };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
