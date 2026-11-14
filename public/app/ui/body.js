// Body tab of the Character window ("Lvl 2" in docs/DESIGN.md: recapture weekly to see body progress).
// A timeline of the player's scale readings (up to 180 days from the engine) that can be scrubbed or
// played; the character on the dais morphs to the body of the chosen day through the rig's lean / heavy /
// muscular targets (the gentle mapping in character/README.md), with the goal physique as the ghost
// figure when the data carries a goal. Nothing here is invented: every number is a reading, and a
// body-fat value carried forward from an earlier weigh-in says so.

import { h, has, age, NO_SIGNAL } from "./dom.js";
import { icon } from "./icons.js";
import { tip, hide as hideTip } from "./tooltip.js";
import { sectionHead, nosig, stat, numTip, chip } from "./widgets.js";

// The date (YYYY-MM-DD) the character sheets that drive the current body were generated (see character/README.md).
// Set it when you build your own character; while it is null the screen says the date is not recorded.
const LAST_CAPTURE = null;
const PLAY_MS = 5200;

export function createBodyTab(app) {
  let idx = null;          // selected history index; null = today (live body)
  let playing = null;      // interval handle
  let scrubbed = false;    // the stage body was overridden by the scrubber
  let rerender = () => {};

  const points = (s) => (s?.character?.body?.history || []).filter((p) => p && has(p.w));
  // the reading for an index: body fat carried forward from the last weigh-in that had one (flagged)
  function reading(pts, i) {
    const p = pts[i]; if (!p) return null;
    let bf = has(p.bf) ? p.bf : null, bfFrom = null;
    if (bf == null) for (let j = i - 1; j >= 0; j--) if (has(pts[j].bf)) { bf = pts[j].bf; bfFrom = pts[j].d; break; }
    const lean = bf != null ? Math.round(p.w * (1 - bf / 100) * 10) / 10 : null;
    return { d: p.d, w: p.w, bf, bfFrom, lean };
  }
  const liveBody = (b) => ({ weightKg: b?.weightKg ?? null, bodyFatPct: b?.bodyFatPct ?? null, leanKg: b?.leanMassKg ?? b?.leanKg ?? null, goal: b?.goal ? { weightKg: b.goal.weightKg ?? null, bodyFatPct: b.goal.bodyFatPct ?? null, leanKg: b.goal.leanMassKg ?? b.goal.leanKg ?? null } : null });

  function pushBody(s) {
    const b = s?.character?.body, pts = points(s);
    if (idx == null || !pts[idx]) { if (scrubbed) { app.stage.setBody(liveBody(b)); scrubbed = false; } return; }
    const r = reading(pts, idx);
    app.stage.setBody({ weightKg: r.w, bodyFatPct: r.bf, leanKg: r.lean, goal: liveBody(b).goal });
    scrubbed = true;
  }
  function stop() { clearInterval(playing); playing = null; }
  function restore(s) { stop(); idx = null; pushBody(s); }
  function select(s, i, opts = {}) {
    const n = points(s).length;
    idx = i == null || i >= n - 1 ? null : Math.max(0, i);
    if (!opts.keepPlaying) stop();
    pushBody(s);
    rerender();
  }
  function play(s) {
    const pts = points(s); if (pts.length < 2) return;
    if (playing) { stop(); rerender(); return; }
    const steps = pts.length - 1, every = Math.max(45, PLAY_MS / steps), stride = Math.max(1, Math.round(steps / (PLAY_MS / every)));
    let i = idx == null ? 0 : idx; select(s, i, { keepPlaying: true });
    playing = setInterval(() => { i += stride; if (i >= steps) { stop(); select(s, null); return; } select(s, i, { keepPlaying: true }); }, every);
    rerender();
  }

  // ---- the chart: weight line, body-fat line on its own scale, goal line, playhead -------------
  function chart(s, pts, goal) {
    const W = 320, H = 118, L = 30, R = 8, T = 10, B = 22;
    const ws = pts.map((p) => p.w);
    let lo = Math.min(...ws), hi = Math.max(...ws);
    const gw = has(goal?.weightKg) ? goal.weightKg : null;
    if (gw != null && gw > lo - 6 && gw < hi + 6) { lo = Math.min(lo, gw); hi = Math.max(hi, gw); }
    const pad = Math.max(0.4, (hi - lo) * 0.12); lo -= pad; hi += pad;
    const x = (i) => L + (pts.length > 1 ? (i / (pts.length - 1)) * (W - L - R) : (W - L - R) / 2);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const line = ws.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
    const area = `${line} L${x(pts.length - 1).toFixed(1)} ${H - B} L${x(0).toFixed(1)} ${H - B} Z`;
    const bfs = pts.map((p, i) => [i, p.bf]).filter(([, v]) => has(v));
    let bfLine = "";
    if (bfs.length > 1) {
      const blo = Math.min(...bfs.map((b) => b[1])) - 0.5, bhi = Math.max(...bfs.map((b) => b[1])) + 0.5;
      const by = (v) => T + (1 - (v - blo) / (bhi - blo)) * (H - T - B);
      bfLine = bfs.map(([i, v], k) => (k ? "L" : "M") + x(i).toFixed(1) + " " + by(v).toFixed(1)).join(" ");
    }
    const sel = idx == null ? pts.length - 1 : idx;
    const ticks = [0, Math.floor((pts.length - 1) / 2), pts.length - 1].filter((v, i, a) => a.indexOf(v) === i);
    const gid = "bg" + Math.random().toString(36).slice(2, 8);
    const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--v-health)" stop-opacity=".30"/><stop offset="1" stop-color="var(--v-health)" stop-opacity="0"/></linearGradient></defs>
      <g class="bt__grid">${[lo + pad, hi - pad].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${L - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${v.toFixed(1)}</text>`).join("")}</g>
      ${gw != null && gw >= lo && gw <= hi ? `<line class="bt__goal" x1="${L}" x2="${W - R}" y1="${y(gw).toFixed(1)}" y2="${y(gw).toFixed(1)}"/><text class="bt__goaltxt" x="${W - R}" y="${(y(gw) - 3).toFixed(1)}" text-anchor="end">goal ${gw} kg</text>` : ""}
      <path d="${area}" fill="url(#${gid})"/>
      ${bfLine ? `<path class="bt__bf" d="${bfLine}"/>` : ""}
      <path class="bt__w" d="${line}"/>
      <g class="bt__ticks">${ticks.map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"}">${shortDate(pts[i].d)}</text>`).join("")}</g>
      <g class="bt__head"><line x1="${x(sel).toFixed(1)}" x2="${x(sel).toFixed(1)}" y1="${T}" y2="${H - B}"/><circle cx="${x(sel).toFixed(1)}" cy="${y(ws[sel]).toFixed(1)}" r="3.4"/></g>
    </svg>`;
    const el = h("div.bt__chart", { html: svg, role: "img", "aria-label": `Weight over ${pts.length} days` });
    // drag or tap anywhere on the chart to scrub
    const pick = (e) => { const r = el.getBoundingClientRect(); const fx = (e.clientX - r.left) / r.width * W; const i = Math.round(((fx - L) / (W - L - R)) * (pts.length - 1)); select(s, Math.max(0, Math.min(pts.length - 1, i))); };
    let down = false;
    el.addEventListener("pointerdown", (e) => { down = true; el.setPointerCapture?.(e.pointerId); pick(e); });
    el.addEventListener("pointermove", (e) => { if (down) pick(e); });
    el.addEventListener("pointerup", () => { down = false; });
    el.addEventListener("pointercancel", () => { down = false; });
    return el;
  }
  const shortDate = (d) => { const [, m, day] = String(d).split("-"); return `${Number(day)} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1] || m}`; };
  const delta = (a, b, unit, digits = 1) => { if (!has(a) || !has(b)) return null; const d = a - b; return (d > 0 ? "+" : d < 0 ? "−" : "±") + Math.abs(d).toFixed(digits) + " " + unit; };

  function left(s) {
    const b = s?.character?.body, pts = points(s), goal = b?.goal;
    const n = pts.length, sel = idx == null ? n - 1 : idx, r = n ? reading(pts, sel) : null;
    const today = n ? reading(pts, n - 1) : null;
    const src = { source: b?.source ?? null, asOf: b?.asOf ?? null };
    const kids = [
      sectionHead("Body today", b?.asOf ? age(b.asOf) : null),
      h("div.stats3",
        stat("Weight", has(b?.weightKg) ? [b.weightKg.toFixed(1), h("small", " kg")] : null, numTip("Weight", has(b?.weightKg) ? b.weightKg + " kg" : null, b?.prov?.weightKg ?? b, s, { lines: [b?.weighedOn ? ["Weighed on", b.weighedOn] : null, has(b?.bmi) ? ["BMI", b.bmi] : null] })),
        stat("Body fat", has(b?.bodyFatPct) ? [String(b.bodyFatPct), h("small", " %")] : null, numTip("Body fat", has(b?.bodyFatPct) ? b.bodyFatPct + "%" : null, b?.prov?.bodyFatPct ?? b, s)),
        stat("Lean mass", has(b?.leanMassKg) ? [String(b.leanMassKg), h("small", " kg")] : null, numTip("Lean mass", has(b?.leanMassKg) ? b.leanMassKg + " kg" : null, b?.prov?.leanMassKg ?? b, s))),
      sectionHead("Timeline", n ? `${n} weigh-ins` : null),
    ];
    if (n < 2) {
      kids.push(h("div.none", nosig(s ? (n === 1 ? "one reading only; the timeline needs two" : "no scale readings yet") : NO_SIGNAL)));
      return kids;
    }
    const playBtn = h("button.lbtn.bt__play", { type: "button", "aria-label": playing ? "Pause" : "Play the timeline", onClick: () => { app.audio.tick(); play(s); } }, icon(playing ? "pause" : "play"), playing ? "Pause" : "Play");
    const todayBtn = h("button.lbtn", { type: "button", disabled: idx == null ? "" : null, onClick: () => { app.audio.tick(); select(s, null); } }, "Today");
    const range = h("input.bt__range", { type: "range", min: 0, max: n - 1, step: 1, value: sel, "aria-label": "Day on the timeline", "aria-valuetext": r ? `${shortDate(r.d)}: ${r.w} kg` : "" });
    range.addEventListener("input", () => select(s, Number(range.value)));
    kids.push(
      chart(s, pts, goal),
      h("div.bt__scrub", range),
      h("div.bt__ctl", playBtn, todayBtn,
        h("span.bt__legend", h("i.bt__sw.bt__sw--w"), "weight", pts.some((p) => has(p.bf)) ? [h("i.bt__sw.bt__sw--bf"), "body fat"] : null, has(goal?.weightKg) ? [h("i.bt__sw.bt__sw--goal"), "goal"] : null)),
      idx == null
        ? h("div.bt__day.is-today",
          h("div.bt__date", "Today", b?.weighedOn ? h("span.bt__ago", " · weighed " + shortDate(b.weighedOn)) : null),
          h("div.bt__vals",
            h("span", has(b?.weightKg) ? [h("b", b.weightKg.toFixed(1)), " kg"] : h("span.nosig", "weight: no reading")),
            h("span", has(b?.bodyFatPct) ? [h("b", String(b.bodyFatPct)), " %"] : h("span.nosig", "body fat: no reading")),
            has(b?.leanMassKg) ? h("span", h("b", String(b.leanMassKg)), " kg lean") : null))
        : h("div.bt__day",
          h("div.bt__date", shortDate(r.d) + " " + r.d.slice(0, 4), today ? h("span.bt__ago", " · " + daysBetween(r.d, today.d) + " days ago") : null),
          h("div.bt__vals",
            h("span", h("b", r.w.toFixed(1)), " kg", today ? h("small", " " + delta(today.w, r.w, "kg") + " since") : null),
            h("span", r.bf != null ? [h("b", String(r.bf)), " %", r.bfFrom ? h("small", " carried from " + shortDate(r.bfFrom)) : null] : h("span.nosig", "body fat: no reading")),
            r.lean != null ? h("span", h("b", String(r.lean)), " kg lean", h("small", " derived")) : null)),
      h("p.note", "Scrubbing moves the character on the dais to the body of that day, through the rig's lean, heavy and muscular targets, from the scale readings alone. Gentle by design: the full range of each target is never reached."),
    );
    return kids;
  }

  function right(s, canGhost, ghostOn, toggleGhost) {
    const b = s?.character?.body, pts = points(s), goal = b?.goal, n = pts.length;
    const first = n ? pts[0] : null, last = n ? pts[n - 1] : null;
    const back30 = n ? pts.slice().reverse().find((p) => daysBetween(p.d, last.d) >= 28) : null;
    const back7 = n ? pts.slice().reverse().find((p) => daysBetween(p.d, last.d) >= 6) : null;
    const trendRow = (k, v, tipTitle) => { const el = h("div.kv", h("span.kv__k", k), h("span.kv__v", has(v) ? v : nosig())); tip(el, numTip(tipTitle || k, v, b, s, { source: "scale readings (" + (b?.source || "engine") + ")" }), { focusable: true }); return el; };
    const kids = [
      sectionHead("Trend", n ? `${shortDate(first.d)} → ${shortDate(last.d)}` : null),
      n ? h("div.kvs",
        trendRow("Last 7 days", back7 ? delta(last.w, back7.w, "kg") : null, "Weight change, last 7 days"),
        trendRow("Last 30 days", back30 ? delta(last.w, back30.w, "kg") : null, "Weight change, last 30 days"),
        trendRow("Whole timeline", delta(last.w, first.w, "kg"), "Weight change over the timeline"),
        trendRow("Body fat, timeline", (() => { const a = pts.find((p) => has(p.bf)), z = pts.slice().reverse().find((p) => has(p.bf)); return a && z && a !== z ? delta(z.bf, a.bf, "pts") : null; })(), "Body fat change over the timeline"),
        trendRow("Weigh-ins", `${n} in ${daysBetween(first.d, last.d) + 1} days`)) : h("div.none", nosig()),
      sectionHead("Goal physique", goal?.asOf ? age(goal.asOf) : null),
    ];
    if (goal && (has(goal.weightKg) || has(goal.bodyFatPct))) {
      const gl = has(goal.leanMassKg ?? goal.leanKg) ? (goal.leanMassKg ?? goal.leanKg) : has(goal.weightKg) && has(goal.bodyFatPct) ? Math.round(goal.weightKg * (1 - goal.bodyFatPct / 100) * 10) / 10 : null;
      const gbtn = canGhost ? h("button.lbtn", { type: "button", class: ghostOn ? "is-on" : "", "aria-pressed": String(ghostOn), onClick: toggleGhost }, icon("target"), ghostOn ? "Goal shown beside the figure" : "Show goal beside the figure") : h("span.note", "The ghost figure needs the rig's body targets (not on this tier).");
      kids.push(h("div.stats3",
        stat("Weight", has(goal.weightKg) ? [String(goal.weightKg), h("small", " kg")] : null, numTip("Goal weight", has(goal.weightKg) ? goal.weightKg + " kg" : null, goal, s, { lines: [has(b?.weightKg) && has(goal.weightKg) ? ["To go", delta(goal.weightKg, b.weightKg, "kg")] : null] })),
        stat("Body fat", has(goal.bodyFatPct) ? [String(goal.bodyFatPct), h("small", " %")] : null, numTip("Goal body fat", has(goal.bodyFatPct) ? goal.bodyFatPct + "%" : null, goal, s, { lines: [has(b?.bodyFatPct) && has(goal.bodyFatPct) ? ["To go", delta(goal.bodyFatPct, b.bodyFatPct, "pts")] : null] })),
        stat("Lean mass", gl != null ? [String(gl), h("small", " kg")] : null, numTip("Goal lean mass", gl != null ? gl + " kg" : null, goal, s, { lines: [has(gl) && has(b?.leanMassKg) ? ["To go", delta(gl, b.leanMassKg, "kg")] : null, has(goal.leanMassKg ?? goal.leanKg) ? null : "Derived from goal weight and body fat."] }))),
        h("div.bt__goalrow", gbtn, goal.source ? h("span.dim", "from " + goal.source) : null));
    } else kids.push(h("div.none", nosig(s ? "no goal recorded (set one in your goals)" : NO_SIGNAL)));

    kids.push(
      sectionHead("Weekly recapture", "Lvl 2"),
      h("div.recap",
        h("div.recap__row", h("span.recap__k", "Last capture"), LAST_CAPTURE ? h("span.recap__v", shortDate(LAST_CAPTURE) + " " + LAST_CAPTURE.slice(0, 4), h("small", " · character sheets from photos")) : h("span.recap__v", h("span.nosig", "not recorded"))),
        h("div.recap__row", h("span.recap__k", "Weekly recapture"), h("span.recap__v", h("span.nosig", "none yet"))),
        h("p.recap__text", "The ritual: one front and one back full-body photo, A-pose, against a plain wall, phone at chest height, same light each week. The pipeline redraws the body from those two pictures and keeps the head; about ten minutes on a desktop (character/README.md, “Weekly recapture”)."),
        h("div.recap__slots", ["Front", "Back"].map((k) => h("div.recap__slot", icon("camera", "recap__ico"), h("span", k), h("small", "no photo yet")))),
        h("p.note", "Progress photos will sit here by date once a recapture has been done. None exist in the game yet; nothing is shown that was not captured.")),
    );
    return kids;
  }
  const daysBetween = (a, b) => Math.round(Math.abs(Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

  return {
    render(s, ctx, ghost) { rerender = ctx.rerender; return [left(s), right(s, ghost.can, ghost.on, ghost.toggle)]; },
    leave(s) { if (idx != null || playing || scrubbed) restore(s); },
    selectedBody(s) { const pts = points(s); return idx != null && pts[idx] ? reading(pts, idx) : null; },
    isPlaying: () => !!playing,
  };
}
