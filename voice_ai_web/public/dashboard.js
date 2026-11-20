// 📊 Insights (#dashboard): the user's start page (#dashboard; the page with no hash when it's open for the account).
// Data: GET /api/dashboard?days=7|30|90&agent=all|<id>&tz=<minutes east of UTC> (DashboardController). Loaded after app.js and
// uses its helpers ($, state, allowed, route, openCall). Charts are plain SVG; colours come from the theme (--c1) and the
// channel colours (--ch-call/-chat/-voice/-wa, validated categorical slots 1-4). Every chart has a hover tooltip.
(() => {
  const D = { days: 30, agent: "all", data: null, loading: false, again: false, w: 0 };
  const CH = [
    { k: "call", name: "Web call", icon: "📞", v: "--ch-call" },
    { k: "chat", name: "Live chat", icon: "💬", v: "--ch-chat" },
    { k: "voice", name: "Voice chat", icon: "🎤", v: "--ch-voice" },
    { k: "whatsapp", name: "WhatsApp", icon: "🟢", v: "--ch-wa" },
  ];
  const ENDS = { "caller said goodbye": "Caller said goodbye", user: "Ended from the page", "live chat": "Live chat closed", "voice chat": "Voice chat closed",
    silence: "No answer after re-asks", "no response": "No answer after re-asks", agent: "Agent ended it" };
  const e = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString();
  const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : "");
  const total = (r) => r.call + r.chat + r.voice + r.whatsapp;
  const day = (iso) => new Date(iso + "T00:00:00");
  const dShort = (iso) => day(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const dur = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} m` : s >= 60 ? `${Math.floor(s / 60)} m ${s % 60} s` : `${s} s`);
  const ago = (iso) => {
    if (!iso) return "—";
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24); return d === 1 ? "yesterday" : `${d} days ago`;
  };

  // ---------- tooltip ----------
  const tip = document.createElement("div");
  tip.className = "db-tip"; tip.hidden = true; tip.setAttribute("role", "status");
  document.body.appendChild(tip);
  const showTip = (ev, html) => { tip.innerHTML = html; tip.hidden = false; tip.style.left = Math.min(innerWidth - 90, Math.max(90, ev.clientX)) + "px"; tip.style.top = ev.clientY + "px"; };
  const hideTip = () => (tip.hidden = true);

  // ---------- load ----------
  async function load() {
    if (D.loading) { D.again = true; return; }
    D.loading = true;
    try {
      const q = new URLSearchParams({ days: D.days, agent: D.agent, tz: -new Date().getTimezoneOffset() });
      const r = await fetch(`/api/dashboard?${q}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Couldn't load the dashboard.");
      D.data = data;
      render();
    } catch (err) {
      $("dbHeadline").textContent = "⚠ " + err.message;
    } finally {
      D.loading = false;
      if (D.again) { D.again = false; load(); }
    }
  }
  window.loadDashboard = () => {
    const h = new Date().getHours(), me = state.me;
    const first = me ? cap((me.name || me.username).trim().split(/\s+/)[0]) : "";
    $("dbHello").textContent = `${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}${first ? ", " + first : ""}`;
    $("dbInCall").hidden = !(state.inCall || state.session);
    fillAgents();
    load();
  };
  function fillAgents() {
    const sel = $("dbAgent"), list = state.agents || [];
    const want = ["all", ...list.map((a) => a.id)].join();
    if (sel.dataset.ids !== want) {
      sel.innerHTML = '<option value="all">All agents</option>' + list.map((a) => `<option value="${e(a.id)}">${e(a.name)}</option>`).join("");
      sel.dataset.ids = want;
    }
    if (D.agent !== "all" && !list.some((a) => a.id === D.agent)) D.agent = "all";
    sel.value = D.agent;
    sel.hidden = list.length < 2;
  }

  // ---------- render ----------
  function render() {
    const d = D.data; if (!d) return;
    const t = d.totals, who = D.agent === "all" ? "Your agents" : (state.agents || []).find((a) => a.id === D.agent)?.name || "This agent";
    $("dbHeadline").innerHTML = t.conversations
      ? `${e(who)} handled <b>${fmt(t.conversations)}</b> conversation${t.conversations === 1 ? "" : "s"} in the last ${d.days} days`
      : d.agentCount ? `No conversations in the last ${d.days} days yet. Start one from 💬 Conversations.` : "Create your first agent on 💬 Conversations to see your numbers here.";
    D.w = $("dbActivity").clientWidth;
    tiles(d); activity(d.daily); mix(d.daily); reply(d.daily, t); heat(d.heat);
    hbars("dbTopics", d.intents.map((x) => [cap(x.label), x.count]), "No intents yet: they come from new conversations.");
    hbars("dbEnds", d.ends.map((x) => [ENDS[x.label] || cap(x.label), x.count]), "No conversations yet.");
    agents(d); lists(d);
    requestAnimationFrame(() => $("dashView").classList.add("db-ready")); // cards come in once, not on every redraw
  }

  function spark(vals, w, h, pad = 2) {
    if (vals.length < 2) return "";
    const max = Math.max(...vals), min = Math.min(...vals), span = max - min || 1;
    return vals.map((v, i) => `${i ? "L" : "M"}${(pad + i * (w - pad * 2) / (vals.length - 1)).toFixed(1)},${(h - pad - (v - min) / span * (h - pad * 2)).toFixed(1)}`).join("");
  }
  function tiles(d) {
    const t = d.totals, p = d.previous, daily = d.daily;
    const pct = (a, b) => (b ? Math.round((a - b) / b * 100) : null);
    const reply = (x) => (x.avgReplyMs == null ? null : x.avgReplyMs / 1000);
    const T = [
      { lab: "💬 Conversations", val: fmt(t.conversations), d: pct(t.conversations, p.conversations), s: daily.map(total) },
      { lab: "⏱ Talk time", val: dur(t.seconds), d: pct(t.seconds, p.seconds), s: daily.map((r) => r.seconds) },
      { lab: "⚡ Avg reply", val: reply(t) == null ? "—" : `${reply(t).toFixed(1)} s`, d: reply(t) && reply(p) ? -pct(reply(t), reply(p)) : null,
        s: daily.filter((r) => r.avgReplyMs != null).map((r) => -r.avgReplyMs), faster: true },
      { lab: "📅 Meetings booked", val: fmt(t.meetings), d: pct(t.meetings, p.meetings) },
      { lab: "📨 Messages taken", val: fmt(t.messages), d: pct(t.messages, p.messages) },
      { lab: "🔢 AI tokens", val: t.tokens >= 1e6 ? (t.tokens / 1e6).toFixed(2) + " M" : t.tokens >= 1000 ? Math.round(t.tokens / 1000) + " k" : fmt(t.tokens),
        d: pct(t.tokens, p.tokens), s: daily.map((r) => r.tokens), neutral: true },
    ];
    $("dbTiles").innerHTML = T.map((x, i) => {
      let delta = `<span>no earlier data to compare</span>`;
      if (x.d != null) {
        const up = x.d >= 0, word = x.faster ? (up ? "faster" : "slower") : x.neutral ? (up ? "more" : "less") : up ? "more" : "fewer";
        delta = `${up ? "▲" : "▼"} ${Math.abs(x.d)}% ${word} <span class="db-muted" style="font-weight:500">vs previous ${d.days} days</span>`;
        delta = `<span class="${x.neutral ? "" : up ? "up" : "down"}">${delta}</span>`;
      }
      const path = x.s && x.s.some((v) => v) ? spark(x.s, 120, 26) : "";
      return `<div class="db-tile" style="animation-delay:${i * 50}ms"><div class="lab">${x.lab}</div><div class="val" title="${e(x.val)}">${e(x.val)}</div>
        <div class="delta${x.d == null ? "" : x.d >= 0 && !x.neutral ? " up" : x.d < 0 && !x.neutral ? " down" : ""}">${delta}</div>
        ${path ? `<svg viewBox="0 0 120 26" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" fill="none" stroke="var(--c1)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>` : ""}</div>`;
    }).join("");
  }

  // stacked bars per day, coloured by channel; 2px surface gap between segments, rounded top
  function activity(rows) {
    const el = $("dbActivity");
    $("dbLegend").innerHTML = CH.map((c) => `<span><i style="background:var(${c.v})"></i>${c.name}</span>`).join("");
    $("dbActivityTable").innerHTML = `<table class="db-table"><thead><tr><th>Day</th>${CH.map((c) => `<th class="r">${c.name}</th>`).join("")}<th class="r">Total</th></tr></thead><tbody>` +
      rows.slice().reverse().map((r) => `<tr><td>${dShort(r.date)}</td>${CH.map((c) => `<td class="r">${r[c.k]}</td>`).join("")}<td class="r"><b>${total(r)}</b></td></tr>`).join("") + "</tbody></table>";
    if (!rows.some(total)) { el.innerHTML = '<div class="db-empty">No conversations in this period yet.</div>'; return; }
    const W = Math.max(280, el.clientWidth), H = 230, m = { t: 8, r: 6, b: 24, l: 30 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = Math.max(...rows.map(total)), top = Math.max(4, Math.ceil(max / 4) * 4); // whole-number ticks
    const step = iw / rows.length, bw = Math.max(3, Math.min(24, step * 0.66)), y = (v) => m.t + ih - v / top * ih;
    let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Conversations per day by channel">`;
    for (let i = 0; i <= 4; i++) { const v = top / 4 * i; s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--db-grid)"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`; }
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--db-axis)"/>`;
    const every = Math.ceil(rows.length / Math.max(2, Math.floor(iw / 64))), last = rows.length - 1;
    rows.forEach((r, i) => {
      const x = m.l + i * step + (step - bw) / 2, segs = CH.filter((c) => r[c.k] > 0);
      let acc = 0;
      segs.forEach((c, j) => {
        const h = r[c.k] / top * ih, gap = j < segs.length - 1 ? 2 : 0, yy = y(acc + r[c.k]), hh = Math.max(0, h - gap), rr = Math.min(4, bw / 2, hh);
        acc += r[c.k];
        if (j === segs.length - 1) s += `<path d="M${x},${yy + hh} V${yy + rr} Q${x},${yy} ${x + rr},${yy} H${x + bw - rr} Q${x + bw},${yy} ${x + bw},${yy + rr} V${yy + hh} Z" fill="var(${c.v})"/>`;
        else s += `<rect x="${x}" y="${yy + gap}" width="${bw}" height="${hh}" fill="var(${c.v})"/>`;
      });
      if ((i % every === 0 && last - i >= every * 0.7) || i === last) s += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${dShort(r.date)}</text>`;
      s += `<rect class="hit" data-i="${i}" x="${m.l + i * step}" y="${m.t}" width="${step}" height="${ih}" fill="transparent"/>`;
    });
    s += `<line class="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" stroke="var(--db-axis)" stroke-dasharray="3 3" visibility="hidden"/></svg>`;
    el.innerHTML = s;
    const cross = el.querySelector(".cross");
    el.querySelectorAll(".hit").forEach((h) => {
      h.addEventListener("pointermove", (ev) => {
        const i = +h.dataset.i, r = rows[i], cx = m.l + (i + 0.5) * step;
        cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
        showTip(ev, `<b>${day(r.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · ${total(r)} total</b>` +
          CH.slice().reverse().map((c) => `<div><span><i style="background:var(${c.v})"></i>${c.name}</span><span>${r[c.k]}</span></div>`).join(""));
      });
      h.addEventListener("pointerleave", () => { hideTip(); cross.setAttribute("visibility", "hidden"); });
    });
  }

  function mix(rows) {
    const tot = CH.map((c) => rows.reduce((s, r) => s + r[c.k], 0)), all = tot.reduce((a, b) => a + b, 0);
    $("dbMixSub").textContent = `${fmt(all)} in ${D.data.days} days`;
    $("dbMixBar").innerHTML = all ? CH.map((c, i) => (tot[i] ? `<i style="flex-grow:${tot[i]};background:var(${c.v})" data-i="${i}"></i>` : "")).join("") : "";
    $("dbMixBar").querySelectorAll("i").forEach((el) => {
      el.addEventListener("pointermove", (ev) => { const i = +el.dataset.i; showTip(ev, `<b>${CH[i].name}</b><div><span>${fmt(tot[i])} conversations</span><span>${Math.round(tot[i] / all * 100)}%</span></div>`); });
      el.addEventListener("pointerleave", hideTip);
    });
    $("dbMixList").innerHTML = CH.map((c, i) => `<li><i style="background:var(${c.v})"></i><span>${c.icon} ${c.name}</span><b>${fmt(tot[i])}</b><small>${all ? Math.round(tot[i] / all * 100) : 0}%</small></li>`).join("");
  }

  // one line: the average reply per day, with the 3.5 s goal
  function reply(rows, t) {
    const el = $("dbReply"), pts = rows.map((r, i) => ({ i, r, v: r.avgReplyMs == null ? null : r.avgReplyMs / 1000 })).filter((p) => p.v != null);
    $("dbReplyBig").textContent = t.avgReplyMs == null ? "—" : `${(t.avgReplyMs / 1000).toFixed(1)} s`;
    if (pts.length < 2) { el.innerHTML = `<div class="db-empty">${pts.length ? "One day so far: the line starts with the second." : "No replies timed yet."}</div>`; return; }
    const W = Math.max(220, el.clientWidth), H = 110, m = { t: 10, r: 8, b: 8, l: 26 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const lo = Math.floor(Math.min(2, ...pts.map((p) => p.v))), hi = Math.ceil(Math.max(5, ...pts.map((p) => p.v)));
    const x = (i) => m.l + i * iw / Math.max(1, rows.length - 1), y = (v) => m.t + ih - (v - lo) / (hi - lo) * ih;
    const line = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    const area = line + `L${x(pts[pts.length - 1].i)},${y(lo)}L${x(pts[0].i)},${y(lo)}Z`;
    let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Average reply time per day"><defs><linearGradient id="dbRg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--c1)" stop-opacity=".22"/><stop offset="1" stop-color="var(--c1)" stop-opacity="0"/></linearGradient></defs>`;
    const stepV = hi - lo > 4 ? 2 : 1;
    for (let v = lo; v <= hi; v += stepV) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--db-grid)"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    if (3.5 > lo && 3.5 < hi) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(3.5)}" y2="${y(3.5)}" stroke="var(--db-axis)" stroke-dasharray="4 4"/><text x="${m.l + 4}" y="${y(3.5) - 5}">goal 3.5 s</text>`;
    const lp = pts[pts.length - 1];
    s += `<path d="${area}" fill="url(#dbRg)"/><path d="${line}" fill="none" stroke="var(--c1)" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${x(lp.i)}" cy="${y(lp.v)}" r="4.5" fill="var(--c1)" stroke="var(--panel)" stroke-width="2"/>
      <circle class="dot" r="4" fill="var(--c1)" stroke="var(--panel)" stroke-width="2" visibility="hidden"/>
      <rect class="hit" x="${m.l}" y="0" width="${iw}" height="${H}" fill="transparent"/></svg>`;
    el.innerHTML = s;
    const dot = el.querySelector(".dot"), hit = el.querySelector(".hit");
    hit.addEventListener("pointermove", (ev) => {
      const b = el.querySelector("svg").getBoundingClientRect(), px = (ev.clientX - b.left) / b.width * W;
      const p = pts.reduce((best, q) => (Math.abs(x(q.i) - px) < Math.abs(x(best.i) - px) ? q : best), pts[0]);
      dot.setAttribute("cx", x(p.i)); dot.setAttribute("cy", y(p.v)); dot.setAttribute("visibility", "visible");
      showTip(ev, `<b>${dShort(p.r.date)}</b><div><span>Avg reply</span><span>${p.v.toFixed(1)} s</span></div>`);
    });
    hit.addEventListener("pointerleave", () => { hideTip(); dot.setAttribute("visibility", "hidden"); });
  }

  // weekday × hour, one hue light → dark (the theme colour)
  function heat(grid) {
    const el = $("dbHeat"), days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const max = Math.max(0, ...grid.flat());
    if (!max) { el.innerHTML = '<div class="db-empty">No conversations in this period yet.</div>'; $("dbHeatLegend").innerHTML = ""; return; }
    // show 7:00–22:00, or the whole day if anything happened outside it
    const outside = grid.some((r) => r.some((v, h) => v && (h < 7 || h > 21)));
    const hours = outside ? [...Array(24).keys()] : [...Array(15).keys()].map((h) => h + 7);
    const W = Math.max(300, el.clientWidth), m = { t: 2, r: 2, b: 20, l: 36 }, gap = 3, cw = (W - m.l - m.r) / hours.length, ch = 26, H = m.t + 7 * ch + m.b;
    let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Conversations by weekday and hour">`;
    grid.forEach((row, di) => {
      s += `<text x="${m.l - 8}" y="${m.t + di * ch + ch / 2 + 4}" text-anchor="end">${days[di]}</text>`;
      hours.forEach((h, hi) => {
        const v = row[h], p = v ? Math.round(18 + v / max * 82) : 0;
        s += `<rect data-d="${di}" data-h="${h}" x="${m.l + hi * cw + gap / 2}" y="${m.t + di * ch + gap / 2}" width="${Math.max(1, cw - gap)}" height="${ch - gap}" rx="4" fill="${v ? `color-mix(in srgb, var(--c1) ${p}%, var(--panel-2))` : "var(--panel-2)"}"/>`;
      });
    });
    const lab = (h) => (h === 0 ? "12a" : h < 12 ? h + "a" : h === 12 ? "12p" : h - 12 + "p");
    const every = cw < 22 ? 3 : 2;
    hours.forEach((h, hi) => { if (hi % every === 0) s += `<text x="${m.l + hi * cw + cw / 2}" y="${H - 5}" text-anchor="middle">${lab(h)}</text>`; });
    el.innerHTML = s + "</svg>";
    el.querySelectorAll("rect").forEach((r) => {
      r.addEventListener("pointermove", (ev) => { const di = +r.dataset.d, h = +r.dataset.h;
        showTip(ev, `<b>${days[di]} ${lab(h)}–${lab((h + 1) % 24)}</b><div><span>Conversations</span><span>${grid[di][h]}</span></div>`); r.setAttribute("stroke", "var(--text)"); });
      r.addEventListener("pointerleave", () => { hideTip(); r.removeAttribute("stroke"); });
    });
    $("dbHeatSub").textContent = `by weekday and hour (${Intl.DateTimeFormat().resolvedOptions().timeZone || "your time"})`;
    $("dbHeatLegend").innerHTML = `<span>Fewer</span>` + [18, 40, 60, 80, 100].map((p) => `<i style="width:22px;height:10px;background:color-mix(in srgb, var(--c1) ${p}%, var(--panel-2))"></i>`).join("") + `<span>More (busiest hour: ${max})</span>`;
  }

  function hbars(id, items, empty) {
    if (!items.length) { $(id).innerHTML = `<div class="db-empty" style="padding:10px">${empty}</div>`; return; }
    const max = Math.max(...items.map((i) => i[1])) || 1;
    $(id).innerHTML = items.map(([t, v], i) => `<div class="db-hbar"><span class="t" title="${e(t)}">${e(t)}</span><span class="track"><span class="fill" style="width:${v / max * 100}%;animation-delay:${i * 60}ms"></span></span><b>${v}</b></div>`).join("");
  }

  function agents(d) {
    $("dbAgentsSub").textContent = `${d.agentCount} agent${d.agentCount === 1 ? "" : "s"}`;
    if (!d.agents.length) { $("dbAgents").innerHTML = '<tbody><tr><td class="db-empty">No agents yet. Create one on 💬 Conversations.</td></tr></tbody>'; return; }
    $("dbAgents").innerHTML = `<thead><tr><th>Agent</th><th>Type</th><th class="r">Conversations</th><th>Last ${d.days} days</th><th class="r">Avg reply</th><th class="r">Meetings</th><th>Last conversation</th></tr></thead><tbody>` +
      d.agents.map((a) => {
        const p = a.spark.some((v) => v) ? spark(a.spark, 110, 26) : "";
        const sub = [a.owner && `for ${a.owner}`, a.organization].filter(Boolean).join(" · ");
        return `<tr><td><div class="db-agent"><span class="db-av">${e((a.name || "?")[0].toUpperCase())}</span><div><b>${e(a.name)}</b>${a.isDefault ? ' <span class="db-badge">☆ Default</span>' : ""}${sub ? `<div class="db-muted" style="font-size:12px">${e(sub)}</div>` : ""}</div></div></td>
          <td><span class="db-badge">${e(a.icon)} ${e(a.type)}</span></td><td class="r"><b>${fmt(a.conversations)}</b></td>
          <td>${p ? `<svg class="db-spark" viewBox="0 0 110 26" preserveAspectRatio="none" aria-hidden="true"><path d="${p}" fill="none" stroke="var(--c1)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>` : '<span class="db-muted">—</span>'}</td>
          <td class="r">${a.avgReplyMs == null ? "—" : (a.avgReplyMs / 1000).toFixed(1) + " s"}</td><td class="r">${fmt(a.meetings)}</td><td class="db-muted">${ago(a.lastAt)}</td></tr>`;
      }).join("") + "</tbody>";
  }

  function lists(d) {
    $("dbMeetings").innerHTML = d.upcoming.length ? d.upcoming.map((m) => {
      const at = new Date(m.startAt);
      return `<li><span class="db-when"><b>${at.getDate()}</b>${at.toLocaleDateString(undefined, { month: "short" })}</span><span class="t"><div>${e(m.title)}</div>
        <small>${at.toLocaleDateString(undefined, { weekday: "short" })} ${at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · ${m.minutes} min${m.agent ? " · booked by " + e(m.agent) : ""}</small></span><span></span></li>`;
    }).join("") : '<li><span></span><span class="t db-muted">Nothing booked. Agents with the calendar on add meetings here.</span><span></span></li>';
    $("dbMsgSub").textContent = d.newMessages ? `${d.newMessages} new` : "";
    $("dbMessages").innerHTML = d.messages.length ? d.messages.map((m) => {
      const tag = m.urgency === "urgent" ? '<span class="db-tag urgent">⚠ Urgent</span>' : m.status === "new" ? '<span class="db-tag new">New</span>' : "<span></span>";
      const name = m.callerName || m.callerNumber || "A caller";
      return `<li><span class="db-av">${e(name[0].toUpperCase())}</span><span class="t"><div>${e(name)}</div><small title="${e(m.message)}">${e(m.message)} · ${ago(m.at)}</small></span>${tag}</li>`;
    }).join("") : '<li><span></span><span class="t db-muted">No messages. When a caller leaves one, it shows here.</span><span></span></li>';
    const ch = Object.fromEntries(CH.map((c) => [c.k, c]));
    $("dbRecent").innerHTML = d.recent.length ? d.recent.map((c) => {
      const k = ch[c.channel] || CH[0], at = new Date(c.at);
      const what = c.channel === "whatsapp" ? `WhatsApp ${c.endedBy === "sent" ? "sent" : "not sent"}` : `${k.name} with ${e(c.agent || "your agent")}`;
      const sub = c.channel === "whatsapp" ? (c.agent ? `from ${e(c.agent)}` : "") : [dur(c.seconds), `${c.turns} turn${c.turns === 1 ? "" : "s"}`, c.intent && e(c.intent)].filter(Boolean).join(" · ");
      return `<li class="click" data-call="${e(c.id)}" tabindex="0" role="button" aria-label="Open ${e(what)}"><span class="db-ch">${k.icon}</span><span class="t"><div>${what}</div><small>${sub}</small></span>
        <span class="db-muted" style="font-size:12px;font-variant-numeric:tabular-nums">${at.toDateString() === new Date().toDateString() ? at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : at.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span></li>`;
    }).join("") : '<li><span></span><span class="t db-muted">No conversations yet.</span><span></span></li>';
    $("dbRecent").querySelectorAll("[data-call]").forEach((li) => {
      const open = () => typeof openCall === "function" && openCall(li.dataset.call);
      li.addEventListener("click", open);
      li.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); } });
    });
  }

  // ---------- controls ----------
  document.querySelectorAll(".db-seg [data-days]").forEach((b) => b.addEventListener("click", () => {
    D.days = +b.dataset.days;
    document.querySelectorAll(".db-seg [data-days]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    load();
  }));
  $("dbAgent").addEventListener("change", () => { D.agent = $("dbAgent").value; load(); });
  $("dbTblBtn").addEventListener("click", () => {
    const show = $("dbActivityTable").hidden;
    $("dbActivityTable").hidden = !show; $("dbActivity").hidden = show;
    $("dbTblBtn").textContent = show ? "Show as chart" : "Show as table";
  });
  document.querySelector("#dashView [data-go-call]").addEventListener("click", () => (location.hash = "call"));
  // redraw the charts when their width changes (window, rotation); no new request
  let rt;
  new ResizeObserver(() => {
    if (document.body.dataset.view !== "dashboard" || !D.data) return;
    const w = $("dbActivity").clientWidth;
    if (Math.abs(w - D.w) < 4) return;
    clearTimeout(rt); rt = setTimeout(render, 120);
  }).observe($("dashView"));
  if (state.view === "dashboard") window.loadDashboard();
})();
