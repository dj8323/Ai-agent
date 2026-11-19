// TelemuneSmartAi motion theme: the "Network" background behind every page (styles in motion.css).
// Dots drift slowly, nearby dots are joined by lines, and dots move away from the mouse.
// Colour follows the theme (--net-dot / --net-alpha); stops while the tab is hidden; still with "reduce motion".
(() => {
  const start = () => {
    if (document.querySelector(".net-bg")) return;
    const cv = document.createElement("canvas");
    cv.className = "net-bg";
    cv.setAttribute("aria-hidden", "true");
    document.body.prepend(cv);
    const ctx = cv.getContext("2d");
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1, pts = [];
    const mouse = { x: -9999, y: -9999 };

    function size() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = cv.width = innerWidth * dpr; H = cv.height = innerHeight * dpr;
      const n = Math.max(24, Math.min(90, Math.round(innerWidth * innerHeight / 14000)));
      pts = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5 }));
    }
    function draw() {
      const css = getComputedStyle(document.documentElement);
      const col = css.getPropertyValue("--net-dot").trim() || "#7c3aed";
      const alpha = parseFloat(css.getPropertyValue("--net-alpha")) || 0.55;
      const R = 140 * dpr;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = dpr;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.arc(a.x, a.y, 2.2 * dpr, 0, 7); ctx.fill();
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < R) { ctx.globalAlpha = (1 - d / R) * alpha * 0.6; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        }
      }
    }
    function step() {
      const R = 140 * dpr;
      for (const p of pts) {
        p.x += p.vx * dpr; p.y += p.vy * dpr;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy);
        if (d < R && d > 0) { p.x += dx / d * 1.5; p.y += dy / d * 1.5; }
      }
    }
    function tick() {
      if (!document.hidden) { step(); draw(); }
      requestAnimationFrame(tick);
    }

    size();
    addEventListener("resize", () => { size(); if (still) draw(); });
    addEventListener("mousemove", (e) => { mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr; }, { passive: true });
    addEventListener("mouseout", () => { mouse.x = mouse.y = -9999; });
    if (still) {
      draw();
      new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    } else tick();
  };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
