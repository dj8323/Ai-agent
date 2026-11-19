// The cartoon agent on the call card: a person with a headset (plain SVG, theme colours).
// Two characters (CAST below): a man for voices labelled "(male)" in the backend's voice list, a woman for all others.
// They share one face rig, so every state and emotion works the same for both.
//
//   AgentFace.mount(el, voiceLabel)            draw the character for this voice inside el (the #avatar element)
//   AgentFace.frame(ts, { phase, emotion, level, muted })   call every animation frame (app.js drawViz)
//   AgentFace.setCharacter(voiceLabel)         switch character when the agent's voice changes (no-op if the same)
//   AgentFace.create(el, voiceLabel)           another, independent face (returns { frame, setCharacter })
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

  // ---------- two characters: a woman (female voices) and a man (male voices); same face rig for both ----------
  const H = (d) => `    <path d="${d}" fill="var(--af-hair)"/>\n`;
  const CAST = {
    female: { label: "Female agent", skin: ["#ffd9b8", "#f4b98f"], hair: "#3b2a5a", face: "round", lashes: 1, outfit: "blouse",
      // long hair down to the shoulders, side-swept fringe
      back: H("M58 112 Q56 38 120 34 Q184 38 182 112 L186 188 Q172 200 158 188 L160 124 L80 124 L82 188 Q68 200 54 188 Z"),
      front: H("M66 106 Q70 54 126 54 Q174 58 174 106 Q164 82 140 74 Q124 94 88 94 Q74 98 66 106 Z") },
    male: { label: "Male agent", skin: ["#ffd9b8", "#f4b98f"], hair: "#3b2a5a", face: "jaw", lashes: 0, outfit: "tie",
      // short spiky hair with sideburns
      back: H("M64 110 Q60 56 104 46 Q122 40 140 46 Q180 56 176 110 Q170 90 160 82 Q120 70 80 82 Q70 90 64 110 Z"),
      front: H("M68 100 Q62 64 92 52 Q96 36 112 44 Q122 30 136 42 Q150 34 154 52 Q178 62 172 100 Q166 84 154 80 Q146 70 128 74 Q112 64 96 76 Q80 78 72 92 Z")
        + `    <rect x="66" y="96" width="7" height="20" rx="3" fill="var(--af-hair)"/><rect x="167" y="96" width="7" height="20" rx="3" fill="var(--af-hair)"/>\n` },
  };
  // Which character a voice gets is not fixed here: it is read from the voice's label in the backend's voice list
  // (Prompts.VOICES, e.g. "Cedar — natural, grounded (male)"). A label marked "(male)" → male; anything else
  // (female, neutral, unmarked, a voice added later) → female, the common default.
  const characterFor = (label) => (/\(\s*male\s*\)/i.test(String(label || "")) ? "male" : "female");
  const castOf = (key) => CAST[key] || CAST[characterFor(key)];
  const CHARACTERS = Object.keys(CAST);

  const FACE_ROUND = `    <ellipse cx="120" cy="116" rx="52" ry="58" fill="var(--af-skin)"/>\n`;
  const FACE_JAW = `    <path d="M66 112 Q66 56 120 56 Q174 56 174 112 Q174 150 154 166 Q138 176 120 176 Q102 176 86 166 Q66 150 66 112 Z" fill="var(--af-skin)"/>\n`;
  const LASHES = `    <path d="M89 107 l-6 -4 M92 104 l-4 -6 M151 107 l6 -4 M148 104 l4 -6" stroke="var(--af-ink)" stroke-width="2.2" stroke-linecap="round"/>\n`;
  const OUTFIT = {
    blouse: `    <path d="M104 182 L120 200 L136 182 Z" fill="#fff"/>\n`,
    tie: `    <path d="M100 182 L120 196 L140 182 L134 200 L120 196 L106 200 Z" fill="#fff"/>\n    <path d="M115 196 L125 196 L128 222 L120 226 L112 222 Z" fill="var(--c2)"/>\n`,
  };

  const svgFor = (key) => {
    const c = castOf(key);
    const p = { back: c.back, front: c.front, face: c.face === "jaw" ? FACE_JAW : FACE_ROUND, lashes: c.lashes ? LASHES : "",
      collar: OUTFIT[c.outfit] || "", brow: c.lashes ? 3.5 : 6 };
    return `
  <g class="af-char">
    <ellipse cx="120" cy="226" rx="62" ry="8" fill="#00000014"/>
    <path d="M58 226 Q60 186 120 182 Q180 186 182 226 Z" fill="var(--c1)"/>
${p.collar}    <rect x="108" y="160" width="24" height="26" rx="10" fill="var(--af-skin-2)"/>
${p.back}${p.face}${p.front}    <ellipse class="af-cheek" cx="88" cy="136" rx="9" ry="6" fill="#ff8fab"/><ellipse class="af-cheek" cx="152" cy="136" rx="9" ry="6" fill="#ff8fab"/>
${p.lashes}    <g class="af-eyes">
      <g class="af-eyeball"><ellipse cx="98" cy="116" rx="9" ry="11" fill="#fff"/><ellipse cx="142" cy="116" rx="9" ry="11" fill="#fff"/></g>
      <g class="af-pupils"><circle cx="98" cy="117" r="5.5" fill="var(--af-ink)"/><circle cx="142" cy="117" r="5.5" fill="var(--af-ink)"/>
        <circle cx="100" cy="114" r="1.8" fill="#fff"/><circle cx="144" cy="114" r="1.8" fill="#fff"/></g>
      <g class="af-lids"><rect x="86" y="102" width="24" height="28" fill="var(--af-skin)"/><rect x="130" y="102" width="24" height="28" fill="var(--af-skin)"/></g>
    </g>
    <path class="af-brow af-brow-l" d="M86 97 Q98 91 108 96" stroke="var(--af-brow)" stroke-width="${p.brow}" fill="none" stroke-linecap="round"/>
    <path class="af-brow af-brow-r" d="M132 96 Q142 91 154 97" stroke="var(--af-brow)" stroke-width="${p.brow}" fill="none" stroke-linecap="round"/>
    <path d="M118 124 Q120 134 124 133" stroke="var(--af-skin-2)" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path class="af-mouth" fill="#7a2335" stroke="#7a2335" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M64 116 Q62 60 120 58 Q178 60 176 116" stroke="var(--af-ink)" stroke-width="5" fill="none"/>
    <rect x="54" y="104" width="16" height="28" rx="7" fill="var(--c2)"/><rect x="170" y="104" width="16" height="28" rx="7" fill="var(--c2)"/>
    <path d="M62 130 Q66 160 100 160" stroke="var(--af-ink)" stroke-width="3" fill="none"/><circle class="af-mic" cx="102" cy="160" r="4.5" fill="var(--c2)"/>
    <g class="af-ear"><path d="M190 108 q8 10 0 20" stroke="var(--c3)" stroke-width="3" fill="none"/><path d="M198 102 q12 16 0 32" stroke="var(--c3)" stroke-width="3" fill="none"/></g>
  </g>
  <g class="af-thought"><circle cx="186" cy="58" r="6" fill="var(--c1)"/><circle cx="200" cy="44" r="8" fill="var(--c2)"/><circle cx="218" cy="26" r="11" fill="var(--c3)"/></g>`;
  };
  // colours of a character as CSS variables on its <svg>
  const colorsFor = (key) => { const c = castOf(key); return `--af-skin:${c.skin[0]};--af-skin-2:${c.skin[1]};--af-hair:${c.hair};--af-brow:${c.hair}`; };

  // Mouth between two curves: open 0..1, smile -1..1, width factor
  function mouthPath(o, smile, wf) {
    const w = MOUTH.w * wf, l = MOUTH.x - w / 2, r = MOUTH.x + w / 2, y = MOUTH.y - smile * 3;
    const top = MOUTH.y + smile * 7 - o * 3, bottom = MOUTH.y + smile * 9 + o * MOUTH.h;
    return `M${l} ${y} Q${MOUTH.x} ${top} ${r} ${y} Q${MOUTH.x} ${bottom} ${l} ${y} Z`;
  }

  function create(host, character = "female") {
    let root = null, el = {}, open = 0, look = [0, 0], blinkUntil = 0, nextBlink = performance.now() + 600 + Math.random() * 2500;
    const cur = { ...FACE.neutral };

    function setCharacter(c) {
      character = CAST[c] ? c : characterFor(c);
      host.textContent = "";
      root = document.createElementNS(NS, "svg");
      root.setAttribute("viewBox", "0 0 240 240");
      root.setAttribute("class", "agent-face");
      root.setAttribute("aria-hidden", "true");
      root.setAttribute("style", colorsFor(character));
      root.innerHTML = svgFor(character);
      host.appendChild(root);
      host.dataset.character = character;
      const q = (x) => root.querySelector(x);
      el = { char: q(".af-char"), mouth: q(".af-mouth"), pupils: q(".af-pupils"), eyeball: q(".af-eyeball"), lids: q(".af-lids"),
        browL: q(".af-brow-l"), browR: q(".af-brow-r"), cheeks: root.querySelectorAll(".af-cheek") };
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

      host.dataset.phase = muted && phase === "listening" ? "muted" : phase;
    }

    setCharacter(character);
    return { frame, setCharacter: (c) => { if ((CAST[c] ? c : characterFor(c)) !== character) setCharacter(c); }, get character() { return character; } };
  }

  // The call card's face (app.js): AgentFace.mount / frame / setCharacter
  let main = null;
  window.AgentFace = {
    CHARACTERS, CAST, characterFor, faceOf, create,
    mount(host, character) { main = create(host, character); return main; },
    frame(ts, opts) { main?.frame(ts, opts); },
    setCharacter(c) { main?.setCharacter(c); },
  };
})();
