// TelemuneSmartAi motion theme: adds the floating-cloud layer behind every page (styles in motion.css).
(() => {
  const add = () => {
    if (document.querySelector(".sky")) return;
    const sky = document.createElement("div");
    sky.className = "sky";
    sky.setAttribute("aria-hidden", "true");
    const n = innerWidth < 700 ? 5 : 8;
    for (let i = 0; i < n; i++) {
      const c = document.createElement("div");
      c.className = "cloud";
      const dur = 50 + Math.random() * 50;                       // seconds to cross the screen
      c.style.top = (6 + Math.random() * 80) + "%";
      c.style.scale = (0.45 + Math.random() * 0.9).toFixed(2);
      c.style.animationDuration = dur + "s";
      c.style.animationDelay = (-Math.random() * dur) + "s";     // start spread across the screen
      sky.appendChild(c);
    }
    document.body.prepend(sky);
  };
  if (document.body) add(); else document.addEventListener("DOMContentLoaded", add);
})();
