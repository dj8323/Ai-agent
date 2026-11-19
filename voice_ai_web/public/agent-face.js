// Ava — the cartoon agent on the call card (a person with a headset, plain SVG, theme colours).
//
//   AgentFace.mount(el)                        draw her inside el (the #avatar element)
//   AgentFace.frame(ts, { phase, emotion, level, muted })   call every animation frame (app.js drawViz)
//
// phase:   idle (breathes, blinks, glances around) · listening (leans in, brows up, sound waves at the ear;
//          eyes down when muted) · thinking (tilts, looks up, thought bubbles) · speaking (mouth follows the voice)
// emotion: the [emotion] tag of the sentence being spoken (20 agent emotions; caller moods fall back to a close one)
// level:   0..1 loudness of the agent's voice (speaking) or the caller's (listening) from the audio analyser
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const MOUTH = { x: 120, y: 152, w: 30, h: 18 };

  // smile -1 (sad) … 1 (big smile) · brow lift (- = up) · tilt (+ = inner ends up: sorry/worried, - = frown)
  // oneUp: right brow higher (curious) · cheek blush 0..1 · eye size · mouth width
  const FACE = {
    neutral:     { smile: .25, brow: 0,  tilt: 0,   oneUp: 0, cheek: 0,  eye: 1,    w: 1 },
    happy:       { smile: .9,  brow: -2, tilt: 0,   oneUp: 0, cheek: .7, eye: .95,  w: 1.1 },
    excited:     { smile: 1,   brow: -6, tilt: 0,   oneUp: 0, cheek: 1,  eye: 1.15, w: 1.15 },
    cheerful:    { smile: .85, brow: -3, tilt: 0,   oneUp: 0, cheek: .8, eye: 1,    w: 1.1 },
    calm:        { smile: .35, brow: 1,  tilt: 0,   oneUp: 0, cheek: .2, eye: .85,  w: .95 },
    empathetic:  { smile: .2,  brow: -2, tilt: 8,   oneUp: 0, cheek: .3, eye: 1,    w: .95 },
    sad:         { smile: -.7, brow: -1, tilt: 14,  oneUp: 0, cheek: 0,  eye: .9,   w: .9 },
    apologetic:  { smile: -.4, brow: -2, tilt: 12,  oneUp: 0, cheek: .2, eye: .95,  w: .95 },
    encouraging: { smile: .8,  brow: -4, tilt: 0,   oneUp: 0, cheek: .5, eye: 1.05, w: 1.1 },
    confident:   { smile: .6,  brow: 1,  tilt: -4,  oneUp: 0, cheek: 0,  eye: .95,  w: 1.05 },
    serious:     { smile: 0,   brow: 2,  tilt: -6,  oneUp: 0, cheek: 0,  eye: .95,  w: .9 },
    curious:     { smile: .3,  brow: -2, tilt: 0,   oneUp: 6, cheek: 0,  eye: 1.1,  w: .95 },
    surprised:   { smile: .1,  brow: -8, tilt: 0,   oneUp: 0, cheek: .2, eye: 1.25, w: .8 },
    thoughtful:  { smile: .1,  brow: -1, tilt: 0,   oneUp: 4, cheek: 0,  eye: .9,   w: .9 },
    concerned:   { smile: -.3, brow: -2, tilt: 10,  oneUp: 0, cheek: 0,  eye: 1,    w: .9 },
    reassuring:  { smile: .55, brow: -2, tilt: 4,   oneUp: 0, cheek: .4, eye: .95,  w: 1 },
    grateful:    { smile: .85, brow: -3, tilt: 6,   oneUp: 0, cheek: .9, eye: .9,   w: 1.05 },
    playful:     { smile: .9,  brow: -3, tilt: 0,   oneUp: 5, cheek: .8, eye: 1.05, w: 1.1 },
    urgent:      { smile: -.1, brow: -4, tilt: -8,  oneUp: 0, cheek: 0,  eye: 1.15, w: .95 },
    proud:       { smile: .8,  brow: -1, tilt: 0,   oneUp: 0, cheek: .6, eye: .9,   w: 1.1 },
  };
  // caller moods that may reach here → the nearest agent face
  const ALIAS = { satisfied: "happy", relieved: "calm", hopeful: "encouraging", worried: "concerned", anxious: "concerned",
    nervous: "concerned", stressed: "concerned", upset: "sad", disappointed: "sad", lonely: "sad", tired: "calm",
    confused: "curious", frustrated: "serious", angry: "serious", annoyed: "serious", impatient: "urgent",
    overwhelmed: "concerned", bored: "neutral" };
  const faceOf = (e) => FACE[e] || FACE[ALIAS[e]] || FACE.neutral;

  const SVG = `
  <g class="af-char">
    <ellipse cx="120" cy="226" rx="62" ry="8" fill="#00000014"/>
    <path d="M58 226 Q60 186 120 182 Q180 186 182 226 Z" fill="var(--c1)"/>
    <path d="M104 182 L120 200 L136 182 Z" fill="#fff"/>
    <rect x="108" y="160" width="24" height="26" rx="10" fill="var(--af-skin-2)"/>
    <path d="M62 112 Q60 40 120 38 Q180 40 178 112 L178 150 Q170 120 166 96 L74 96 Q70 120 62 150 Z" fill="var(--af-hair)"/>
    <ellipse cx="120" cy="116" rx="52" ry="58" fill="var(--af-skin)"/>
    <path d="M68 100 Q80 56 128 58 Q170 62 172 100 Q150 76 120 80 Q92 80 68 100 Z" fill="var(--af-hair)"/>
    <ellipse class="af-cheek" cx="88" cy="136" rx="9" ry="6" fill="#ff8fab"/><ellipse class="af-cheek" cx="152" cy="136" rx="9" ry="6" fill="#ff8fab"/>
    <g class="af-eyes">
      <g class="af-eyeball"><ellipse cx="98" cy="116" rx="9" ry="11" fill="#fff"/><ellipse cx="142" cy="116" rx="9" ry="11" fill="#fff"/></g>
      <g class="af-pupils"><circle cx="98" cy="117" r="5.5" fill="var(--af-ink)"/><circle cx="142" cy="117" r="5.5" fill="var(--af-ink)"/>
        <circle cx="100" cy="114" r="1.8" fill="#fff"/><circle cx="144" cy="114" r="1.8" fill="#fff"/></g>
      <g class="af-lids"><rect x="86" y="102" width="24" height="28" fill="var(--af-skin)"/><rect x="130" y="102" width="24" height="28" fill="var(--af-skin)"/></g>
    </g>
    <path class="af-brow af-brow-l" d="M86 97 Q98 91 108 96" stroke="var(--af-hair)" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path class="af-brow af-brow-r" d="M132 96 Q142 91 154 97" stroke="var(--af-hair)" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M118 124 Q120 134 124 133" stroke="var(--af-skin-2)" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path class="af-mouth" fill="#7a2335" stroke="#7a2335" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M64 116 Q62 60 120 58 Q178 60 176 116" stroke="var(--af-ink)" stroke-width="5" fill="none"/>
    <rect x="54" y="104" width="16" height="28" rx="7" fill="var(--c2)"/><rect x="170" y="104" width="16" height="28" rx="7" fill="var(--c2)"/>
    <path d="M62 130 Q66 160 100 160" stroke="var(--af-ink)" stroke-width="3" fill="none"/><circle class="af-mic" cx="102" cy="160" r="4.5" fill="var(--c2)"/>
    <g class="af-ear"><path d="M190 108 q8 10 0 20" stroke="var(--c3)" stroke-width="3" fill="none"/><path d="M198 102 q12 16 0 32" stroke="var(--c3)" stroke-width="3" fill="none"/></g>
  </g>
  <g class="af-thought"><circle cx="186" cy="58" r="6" fill="var(--c1)"/><circle cx="200" cy="44" r="8" fill="var(--c2)"/><circle cx="218" cy="26" r="11" fill="var(--c3)"/></g>`;

  let root = null, el = {}, open = 0, look = [0, 0], blinkUntil = 0, nextBlink = 0, cur = { ...FACE.neutral };

  function mount(host) {
    host.textContent = "";
    root = document.createElementNS(NS, "svg");
    root.setAttribute("viewBox", "0 0 240 240");
    root.setAttribute("class", "agent-face");
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = SVG;
    host.appendChild(root);
    const q = (s) => root.querySelector(s);
    el = { char: q(".af-char"), mouth: q(".af-mouth"), pupils: q(".af-pupils"), eyeball: q(".af-eyeball"), lids: q(".af-lids"),
      browL: q(".af-brow-l"), browR: q(".af-brow-r"), cheeks: root.querySelectorAll(".af-cheek"), host };
  }

  // Mouth between two curves: open 0..1, smile -1..1, width factor
  function mouthPath(o, smile, wf) {
    const w = MOUTH.w * wf, l = MOUTH.x - w / 2, r = MOUTH.x + w / 2, y = MOUTH.y - smile * 3;
    const top = MOUTH.y + smile * 7 - o * 3, bottom = MOUTH.y + smile * 9 + o * MOUTH.h;
    return `M${l} ${y} Q${MOUTH.x} ${top} ${r} ${y} Q${MOUTH.x} ${bottom} ${l} ${y} Z`;
  }

  function frame(ts, { phase = "idle", emotion = "neutral", level = 0, muted = false } = {}) {
    if (!root) return;
    const target = faceOf(phase === "speaking" ? emotion : phase === "thinking" ? "thoughtful" : "neutral");
    for (const k in target) cur[k] += (target[k] - cur[k]) * 0.12; // ease between faces

    // mouth: follows the voice while speaking, closed otherwise
    const want = phase === "speaking" ? Math.min(1, level * 1.6) : 0;
    open += (want - open) * (want > open ? 0.6 : 0.35);
    el.mouth.setAttribute("d", mouthPath(open, cur.smile, cur.w));

    // body: breathe · lean in (listening) · tilt (thinking) · bob with the voice (speaking)
    let tf = `translateY(${(Math.sin(ts / 900) * 2).toFixed(2)}px)`;
    if (phase === "listening" && !muted) tf += ` rotate(${(4 + Math.sin(ts / 500) * 1.5 + level * 3).toFixed(2)}deg)`;
    if (phase === "thinking") tf += " rotate(-5deg)";
    if (phase === "speaking") tf += ` translateY(${(-open * 3).toFixed(2)}px) rotate(${(Math.sin(ts / 400) * 2).toFixed(2)}deg)`;
    el.char.style.transform = tf;

    // eyes: wander a little; up-right when thinking; toward the caller when listening; down when muted
    let lx = Math.sin(ts / 2300) * 2, ly = 0;
    if (phase === "thinking") { lx = 4; ly = -5; }
    else if (phase === "listening") { lx = muted ? 0 : 3; ly = muted ? 4 : 1; }
    look[0] += (lx - look[0]) * 0.15; look[1] += (ly - look[1]) * 0.15;
    const es = cur.eye;
    el.pupils.style.transform = `translate(${look[0].toFixed(2)}px, ${look[1].toFixed(2)}px) scale(${es.toFixed(3)})`;
    el.eyeball.style.transform = `scale(${es.toFixed(3)})`;

    // blink every few seconds (sometimes twice)
    if (ts > nextBlink) { blinkUntil = ts + 130; nextBlink = ts + (Math.random() < .25 ? 280 : 2200 + Math.random() * 2600); }
    el.lids.style.transform = `scaleY(${ts < blinkUntil ? 1 : 0})`;

    // brows: emotion + listening (raised) + thinking (one up)
    const lift = cur.brow + (phase === "listening" && !muted ? -3 : 0) + (phase === "thinking" ? -2 : 0);
    el.browL.style.transform = `translateY(${lift.toFixed(2)}px) rotate(${(-cur.tilt).toFixed(2)}deg)`;
    el.browR.style.transform = `translateY(${(lift - cur.oneUp).toFixed(2)}px) rotate(${cur.tilt.toFixed(2)}deg)`;
    const blush = Math.max(cur.cheek, phase === "speaking" ? .2 : 0).toFixed(2);
    el.cheeks.forEach((c) => (c.style.opacity = blush));

    el.host.dataset.phase = muted && phase === "listening" ? "muted" : phase;
  }

  window.AgentFace = { mount, frame, faceOf };
})();
