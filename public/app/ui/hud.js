// World HUD: unit frame and buffs top-left, minimap top-right, quest tracker down the right,
// combat log bottom-left, action bar bottom-centre, XP bar along the bottom edge.

import { h, has, num, clockIn, timeOf, age, shortSpan, cap, NO_SIGNAL, isNarrow, counter, fill } from "./dom.js";
import { icon, weatherIcon } from "./icons.js";
import { store, pct, isDone, linkState, getBrief } from "./store.js";
import { tip } from "./tooltip.js";
import { bar, meterRow, portrait, ordered, VITAL_ORDER, METER_ORDER, METER_ICONS, COLORS, metricTip, metricDisplay, questRow, questTip, progressText, nosig, corners, streakTip, streakState, sectionHead } from "./widgets.js";
import { createMinimap } from "./minimap.js";
import { onSkin } from "./skin.js";
import { getHud, setHud, isAmbient, setAmbient } from "./hudmode.js";

export const ACTIONS = [
  { id: "character", label: "Character", short: "Hero", key: "C", icon: "character" },
  { id: "bags", label: "Bags", short: "Bags", key: "B", icon: "bags" },
  { id: "quests", label: "Quest log", short: "Quests", key: "L", icon: "quests" },
  { id: "map", label: "Map", short: "Map", key: "M", icon: "map" },
  { id: "treasury", label: "Treasury", short: "Gold", key: "T", icon: "treasury" },
  { id: "party", label: "Party and guild", short: "Party", key: "O", icon: "party" },
  { id: "needs", label: "Needs", short: "Needs", key: "N", icon: "needs" },
  { id: "chronicle", label: "Chronicle", short: "Days", key: "H", icon: "chronicle" },
  { id: "signals", label: "Signals", short: "Signal", key: "S", icon: "signals" },
];

// On a phone the bar shows five; the rest sit under "More".
const PRIMARY = ["character", "quests", "bags"];
const ACTIVITY = { walking: ["Walking", "boot"], training: ["Training", "dumbbell"], sleeping: ["Asleep", "moon"], working: ["Working", "laptop"], eating: ["Eating", "bowl"], celebrating: ["Celebrating", "sparkle"], idle: ["At rest", "leaf"] };
export function activityLabel(a) { if (!a?.name) return null; return a.name === "sleeping" && a.inferred ? "Probably asleep" : (ACTIVITY[a.name] || [cap(a.name)])[0]; }
const firstSentence = (t) => { const m = String(t || "").match(/^.*?[.!?](?=\s|$)/); return m ? m[0] : String(t || ""); };

const STREAK_ICONS = { "steps-goal": "boot", protein: "bowl", diary: "doc", sleep: "moon", "workouts-week": "dumbbell", "weigh-ins": "scale" };

export function createHud(app) {
  const unit = h("div.unit.hit");
  const buffs = h("div.buffs.hit");
  const glance = h("div.glance.hit");
  const streaks = h("div.streaks.hit");
  const briefEl = h("div.brief.hit");
  const mmSeen = h("div.mm__seen");
  // calm layout: one objective line, a place chip that expands the minimap, a "Today" pull-up, sheets
  const objline = h("button.objline.hit", { type: "button" });
  const chip = h("button.pchipbar.hit", { type: "button", onClick: () => { mmOpen = !mmOpen; app.audio.tick(); el.classList.toggle("is-mm", mmOpen); if (mmOpen) requestAnimationFrame(() => minimap.redraw()); } });
  const todayBtn = h("button.todaybtn.hit", { type: "button", onClick: () => toggleSheet("today") });
  const sheetBody = h("div.hsheet__body.scroll"), sheetTitle = h("span.frame__title");
  const sheet = h("div.hsheet-layer", h("div.hsheet__scrim.hit", { onClick: () => closeSheet() }),
    h("section.hsheet.frame.hit", { role: "dialog" }, corners(), h("header.frame__head", sheetTitle, h("button.xbtn", { type: "button", "aria-label": "Close", onClick: () => closeSheet() }, icon("close"))), sheetBody));
  const ambline = h("div.ambline");
  const ambCatch = h("button.amb__catch.hit", { type: "button", "aria-label": "Leave ambient mode", onClick: () => setAmbient(false) });
  let mmOpen = false, sheetKind = null;
  const mmTitle = h("div.mm__title");
  const mmClock = h("button.mm__clock", { type: "button" });
  const mmWx = h("div.mm__wx");
  const minimap = createMinimap({ size: 164 });
  const mmDisc = h("button.mm__disc", { type: "button", "aria-label": "Open the map", onClick: () => app.openPanel("map") }, minimap.el, h("i.mm__me"), h("i.mm__n", "N"));
  const sig = h("button.sig", { type: "button", onClick: () => app.togglePanel("signals") });
  const btnSound = h("button.rbtn.mm__btn.mm__btn--a", { type: "button", onClick: () => { app.audio.toggleMute(); app.audio.tick(); } });
  const btnMenu = h("button.rbtn.mm__btn.mm__btn--b", { type: "button", "aria-label": "Settings", onClick: () => app.menu.toggle() }, icon("gear"));
  const mm = h("div.mm.hit", mmTitle, h("div.mm__ring", mmDisc, btnSound, btnMenu, mmWx, mmClock), mmSeen, sig);
  const tracker = h("div.tracker.hit");
  const logList = h("div.clog__list.scroll");
  let logFilter = "all", logOpen = false;
  const logTabs = h("div.clog__tabs");
  const clog = h("div.clog.hit", corners(), h("header.clog__head", logTabs, h("button.clog__grow", { type: "button", "aria-label": "Expand the log", onClick: () => { logOpen = !logOpen; clog.classList.toggle("is-open", logOpen); } }, icon("up"))), logList);
  const dayPlate = h("div.dayplate.hit");
  const abar = h("nav.abar.hit", { "aria-label": "Panels" });
  const xp = h("div.xpbar.hit");
  const el = h("section.hud", { "aria-label": "World" },
    h("div.hud__tl", unit, objline, buffs, glance, streaks),
    h("div.hud__tr", chip, mm, tracker),
    h("div.hud__bl", briefEl, clog),
    h("div.hud__bc", todayBtn, dayPlate, abar),
    xp, sheet, ambCatch, ambline);
  const calm = () => getHud() === "calm";

  let on = false, clock = null;
  const extra = [];            // live events not yet present in state.log
  const seen = new Map();      // log id -> when it first appeared (new ones animate in)
  let firstLog = true;

  // ---- unit frame ---------------------------------------------------------------------------
  function paintUnit(s) {
    const c = s?.character, roster = s?.characters?.find((x) => x.id === c?.id) || s?.characters?.find((x) => x.playable);
    const vit = ordered(c?.vitals, VITAL_ORDER);
    const big = vit.slice(0, 2), small = vit.slice(2);
    const bigBar = (m, size) => {
      const b = bar({ key: "v:" + m.id, value: m.value, color: COLORS[m.id], size, stale: m.stale, label: m.label, showLabel: true, text: has(m.value) ? (m.display ?? Math.round(m.value)) : null });
      tip(b, metricTip(m), { focusable: true });
      return b;
    };
    const lvl = h("span.unit__lvl", has(c?.level) ? String(c.level) : "–");
    tip(lvl, () => ({ title: "Level", value: has(c?.level) ? c.level : undefined, lines: [["XP", has(c?.xp) && has(c?.xpNext) ? `${num(c.xp)} / ${num(c.xpNext)}` : null], ["Today", has(c?.xpToday) ? "+" + num(c.xpToday) : null]], source: "engine (derived from the event log)", asOf: s?.asOf ?? null, nosignal: !has(c?.level) }));
    const face = h("button.unit__face", { type: "button", "aria-label": "Open the character window", onClick: (e) => { e.stopPropagation(); calm() ? toggleSheet("vitals") : app.openPanel("character"); } }, portrait({ ...(roster || {}), kind: "player" }, "unit__portrait"), lvl);
    const a = c?.activity, actText = a?.name && a.name !== "idle" ? activityLabel(a) : null;
    const act = actText ? h("div.unit__act", { class: a.inferred ? "is-inferred" : "", data: { act: a.name } }, icon((ACTIVITY[a.name] || [])[1] || "diamondo"), h("span", actText)) : null;
    if (act) tip(act, () => ({ kicker: "Activity", title: actText, lines: [a.basis, a.inferred ? "Inferred from the pattern, not reported." : null, a.since ? ["Since", age(a.since)] : null, a.until ? ["Evidence runs out", age(a.until)] : null], source: a.source ?? null, asOf: a.asOf ?? null }), { focusable: true });
    unit.onclick = () => { if (calm()) toggleSheet("vitals"); };
    unit.dataset.tiptap = calm() ? "off" : "on";
    fill(unit, 
      ...corners(),
      face,
      h("div.unit__body",
        h("div.unit__name", h("b", c?.name || roster?.name || NO_SIGNAL), c?.title ? h("span", c.title) : null),
        bigBar(big[0], "lg"), bigBar(big[1], "md"), act),
      h("div.unit__minor", small.map((m) => meterRow(m, { keyPrefix: "v", size: "xs", noLabel: false }))),
    );
  }

  // ---- buffs --------------------------------------------------------------------------------
  function remaining(b) {
    if (!b.until) return null;
    const ms = Date.parse(b.until) - Date.now();
    return Number.isNaN(ms) ? null : ms;
  }
  function paintBuffs(s) {
    const list = (s?.character?.buffs || []).filter((b) => { const r = remaining(b); return r == null || r > 0; });
    fill(buffs, ...list.map((b) => {
      const debuff = b.kind === "debuff", left = remaining(b);
      const total = b.since && b.until ? Date.parse(b.until) - Date.parse(b.since) : null;
      const el = h("div.buff", { class: debuff ? "is-debuff" : "", style: { "--p": total && left != null ? Math.max(0, Math.min(1, left / total)) : 1 } },
        h("span.buff__ico", icon(b.icon, null, debuff ? "skull" : "star")),
        h("span.buff__time", left != null ? shortSpan(left) : "∞"));
      tip(el, () => { const l = remaining(b); return {
        kicker: debuff ? "Debuff" : "Buff", title: b.label, lines: [b.detail, ["Remaining", l != null ? (l > 0 ? shortSpan(l).replace(/([mhd])$/, " $1") : "ended") : "until it changes"], b.since ? ["Since", age(b.since)] : null],
        source: b.source ?? null, asOf: b.since ?? null }; }, { focusable: true });
      return el;
    }));
  }

  // ---- the nine meters, as a compact strip ---------------------------------------------------
  function paintGlance(s) {
    const meters = ordered(s?.character?.meters, METER_ORDER);
    fill(glance, h("span.glance__cap", "Quick glance"), h("div.glance__row", meters.map((m) => {
      const nil = !has(m.value);
      const cell = h("div.gcell", { class: nil ? "is-null" : m.stale ? "is-stale" : "", style: { "--c": COLORS[m.id] || "var(--accent)" } },
        icon(METER_ICONS[m.id] || m.id),
        bar({ key: "g:" + m.id, value: m.value, color: COLORS[m.id], size: "xs", label: m.label, stale: m.stale }));
      tip(cell, metricTip(m, { kicker: "Quick glance" }), { focusable: true });
      return cell;
    })));
  }

  // ---- streaks: a compact row; the full list is on the Character window ----------------------
  function paintStreaks(s) {
    const list = s?.streaks || [];
    streaks.hidden = !list.length;
    fill(streaks, list.length ? h("span.glance__cap", "Streaks") : null, h("div.streaks__row", list.map((st) => {
      const state = streakState(st);
      const cell = h("button.streak", { type: "button", data: { state }, "aria-label": `${st.label}: ${st.current} ${st.unit || ""}`, onClick: () => app.openPanel("character", { tab: "skills" }) },
        icon(STREAK_ICONS[st.id] || "flame"), h("b", has(st.current) ? String(st.current) : "–"));
      tip(cell, streakTip(st, s), { tap: false });
      return cell;
    })));
  }

  // ---- the companion's line (GET /api/brief) --------------------------------------------------
  let brief = null, briefKey = "", briefAt = 0, briefHidden = "", briefKind = "now", briefBusy = false;
  const material = (s) => [s?.day?.date, s?.day?.questsDone, s?.character?.level, (s?.streaks || []).map((x) => (x.hitThisPeriod ? 1 : 0)).join("")].join("|");
  async function loadBrief(kind, key) {
    if (briefBusy) return;
    briefBusy = true;
    const b = await getBrief(kind);
    briefBusy = false; briefAt = Date.now(); briefKey = key; briefKind = kind;
    brief = b && b.speech ? b : null;
    if (on) paintBrief(store.state);
  }
  const LS_M = "wog.brief.morning", LS_E = "wog.brief.evening";
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  function wantBrief(s, forceKind) {
    if (!s) return;
    const key = material(s), date = s.day?.date, yday = s.day?.yesterday?.date;
    let kind = forceKind || "now";
    if (!forceKind) {
      // the engine's flag when it sends one, else: yesterday's close has not been shown on this device
      // the day-close card (day.lastClose, dayclose.js) carries the evening words when the engine sends it
      const hasClose = !!s.day && "lastClose" in s.day;
      if (!hasClose && yday && lsGet(LS_E) !== yday) { kind = "evening"; lsSet(LS_E, yday); }
      else if (date && lsGet(LS_M) !== date) { kind = "morning"; lsSet(LS_M, date); }
    } else if (forceKind === "evening" && date) lsSet(LS_E, date);
    if (forceKind || kind !== "now" || key !== briefKey || Date.now() - briefAt > 15 * 60e3) loadBrief(kind, key);
  }
  function paintBrief(s) {
    const co = s?.companion, ent = s?.characters?.find((c) => c.kind === "ai" || c.id === "companion") || { id: "companion" };
    const show = brief && briefHidden !== briefKey + briefKind;
    briefEl.hidden = !show;
    if (!show) { fill(briefEl); return; }
    const label = { morning: "Morning brief", evening: "Day closed", now: "Right now" }[briefKind] || "Right now";
    fill(briefEl, portrait({ ...ent, kind: "companion" }, "brief__portrait"),
      h("div.brief__body", h("div.brief__who", h("b", co?.name || "Companion"), h("span", label)), h("p.brief__text", { onClick: () => briefEl.classList.toggle("is-full") }, h("span.brief__one", firstSentence(brief.speech)), h("span.brief__rest", brief.speech.slice(firstSentence(brief.speech).length)))),
      h("button.brief__x", { type: "button", "aria-label": "Dismiss", onClick: (e) => { e.stopPropagation(); const wasEvening = briefKind === "evening"; briefHidden = briefKey + briefKind; app.audio.tick(); paintBrief(store.state); if (wasEvening) wantBrief(store.state); } }, icon("close")));
    briefEl.classList.remove("is-full");
    tip(briefEl, () => ({ kicker: "Companion", title: label, lines: ["Built only from the state document, by the engine."], source: "engine /api/brief", asOf: brief.asOf ?? s?.asOf ?? null }), { tap: false, place: "top" });
  }

  // ---- minimap ------------------------------------------------------------------------------
  function paintMap(s) {
    const r = s?.realm;
    minimap.set(r, s?.world);
    fill(mmTitle, r?.place ? h("span", r.place) : nosig("no position"));
    tip(mmTitle, () => ({ title: r?.place || "Realm", lines: [r?.placeRaw && r.placeRaw !== r.place ? ["Geocoder name", r.placeRaw] : null, r?.stale ? "Last known position, not current." : null, r?.country ? ["Country", r.country] : null, has(r?.lat) ? ["Position", `${r.lat.toFixed(3)}, ${r.lon.toFixed(3)}`] : null, has(r?.dayOfLife) ? ["Day of life", num(r.dayOfLife)] : null, ["Map range", minimap.range + " km"]], source: r?.source ?? null, asOf: r?.asOf ?? null, stale: !!r?.stale, nosignal: !r?.place }));
    mmDisc.classList.toggle("is-null", !minimap.hasFix());
    // a stale realm: say how old the last position is instead of implying it is current
    const staleRealm = !!(r && r.stale && minimap.hasFix());
    mmDisc.classList.toggle("is-stale", staleRealm);
    mmSeen.hidden = !staleRealm;
    fill(mmSeen, staleRealm ? [icon("clock"), "Last seen " + (r.lastSeen || r.asOf ? age(r.lastSeen || r.asOf) : "unknown")] : null);
    if (staleRealm) tip(mmSeen, () => ({ title: "Position is stale", lines: ["The phone has not reported a position since then. The map shows the last known place.", ["Place", r.place], r.placeRaw && r.placeRaw !== r.place ? ["Geocoder name", r.placeRaw] : null, r.since ? ["Stay began", age(r.since)] : null], source: r.source ?? null, asOf: r.asOf ?? null, stale: true }), { focusable: true });
    fill(mmClock, icon(r?.sun?.phase === "night" ? "moon" : "sun"), h("span", clockIn(r?.tz)));
    tip(mmClock, () => ({ title: "Local time", value: clockIn(r?.tz), lines: [["Timezone", r?.tz], ["Sun", r?.sun?.phase ? `${cap(r.sun.phase)}${has(r.sun.altitude) ? " · " + Math.round(r.sun.altitude) + "° up" : ""}` : null]], source: r?.tz ? "device clock, shown in the realm's timezone" : "device clock and device timezone (realm timezone: no signal)", asOf: r?.asOf ?? null }), { tap: true });
    const w = r?.weather;
    fill(mmWx, icon(weatherIcon(w?.code, r?.sun?.phase)), has(w?.tempC) ? h("span", Math.round(w.tempC) + "°") : nosig("–"));
    mmWx.classList.toggle("is-null", !w);
    tip(mmWx, () => ({ title: "Weather", value: w ? `${has(w.tempC) ? Math.round(w.tempC) + "°C" : ""} ${w.label || ""}` : undefined, lines: [w && has(w.humidity) ? ["Humidity", w.humidity + "%"] : null, r?.room ? [r.room.label || "Room", `${r.room.tempC}°C · ${r.room.humidity}%`] : null], source: w ? (w.source ?? r?.source ?? null) : null, asOf: w?.asOf ?? r?.asOf ?? null, nosignal: !w }), { focusable: true });
    fill(btnSound, icon(app.audio.muted ? "mute" : "sound"));
    btnSound.setAttribute("aria-label", app.audio.muted ? "Sound is off. Turn on" : "Sound is on. Turn off");
    btnSound.classList.toggle("is-off", app.audio.muted);
  }

  function paintSig(s) {
    const list = s?.signals || [];
    const n = { live: 0, stale: 0, off: 0 };
    for (const x of list) n[x.state] = (n[x.state] || 0) + 1;
    const link = linkState();
    const linkText = { live: "Live", polling: "Polling", off: "No signal", mock: "Mock" }[link] || "No signal";
    sig.dataset.link = link;
    sig.classList.toggle("is-on", app.panel === "signals");
    fill(sig, 
      h("span.sig__link", h("i"), linkText),
      list.length ? h("span.sig__counts", h("b.is-live", String(n.live)), h("b.is-stale", String(n.stale)), h("b.is-off", String(n.off))) : null,
    );
    sig.setAttribute("aria-label", `Signals: ${linkText}. ${n.live} live, ${n.stale} stale, ${n.off} off.`);
    tip(sig, () => ({ title: "Signals", lines: [
      ["Link", { live: "WebSocket open", polling: "Socket down, refetching every 60 s", off: "State endpoint not answering", mock: "Mock file, no live channel" }[link]],
      ["Feeds live", n.live], ["Feeds stale", n.stale], ["Feeds off", n.off],
      store.error ? ["Last error", store.error] : null,
    ], source: "this client and state.signals", asOf: s?.asOf ?? null, nosignal: !s }), { tap: false });
  }

  // ---- quest tracker ------------------------------------------------------------------------
  function paintTracker(s) {
    const qs = s?.quests, top = [], kids = [];
    const openQ = (id) => () => app.openPanel("quests", { focus: id });
    const main = qs?.main;
    if (main) {
      const p = pct(main.progress), next = (main.steps || []).filter((x) => !x.done);
      const card = h("button.objective", { type: "button", onClick: openQ(main.id) },
        ...corners(),
        h("span.objective__kicker", icon("crown"), "Active objective"),
        h("span.objective__title", main.title),
        next[0] ? h("span.objective__step", icon("diamondo"), next[0].title) : null,
        h("span.objective__prog", bar({ key: "q:" + main.id, value: p, color: "var(--accent)", size: "sm", label: main.title, nosigText: true }),
          h("span.objective__pct", p == null ? "" : Math.round(p) + "%")),
        progressText(main.progress) ? h("span.objective__raw", progressText(main.progress)) : null,
      );
      tip(card, questTip({ ...main, kind: "main" }, { asOf: s?.asOf }), { tap: false });
      top.push(card);
    } else top.push(h("div.objective.is-null", ...corners(), h("span.objective__kicker", icon("crown"), "Active objective"), nosig()));

    const group = (title, list, kind, max) => {
      if (!list?.length) return;
      const done = list.filter(isDone).length;
      const open = list.filter((x) => !isDone(x)), shown = [...open, ...list.filter(isDone)].slice(0, max);
      kids.push(h("div.tracker__head", h("span", title), h("b", `${done}/${list.length}`)));
      for (const x of shown) kids.push(questRow({ ...x, kind }, { onClick: openQ(x.id), raw: true, asOf: s?.asOf }));
      if (list.length > shown.length) kids.push(h("button.tracker__more", { type: "button", onClick: () => app.openPanel("quests") }, `${list.length - shown.length} more`));
    };
    const narrow = isNarrow();
    group("Daily", qs?.daily, "daily", narrow ? 3 : 6);
    if (!narrow) group("Weekly", qs?.weekly, "weekly", 3);
    fill(tracker, ...top, kids.length ? h("div.tracker__list", kids) : null);
  }

  // ---- combat log ---------------------------------------------------------------------------
  function logEntries(s) {
    const base = s?.log || [];
    const ids = new Set(base.map((e) => e.id));
    for (let i = extra.length - 1; i >= 0; i--) if (ids.has(extra[i].id)) extra.splice(i, 1);
    return [...extra, ...base].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  }
  function paintLog(s) {
    const tz = s?.realm?.tz;
    let list = logEntries(s);
    if (logFilter === "xp") list = list.filter((e) => e.xp?.amount);
    fill(logTabs, ...[["all", "Combat log"], ["xp", "XP"]].map(([id, label]) =>
      h("button.clog__tab", { type: "button", class: id === logFilter ? "is-on" : "", onClick: () => { logFilter = id; paintLog(store.state); } }, label)));
    if (!list.length) {
      fill(logList, h("div.clog__empty", nosig(s ? "no events yet" : NO_SIGNAL)));
      return;
    }
    const today = new Date().toDateString();
    const rows = list.slice(0, 60).map((e) => {
      if (!seen.has(e.id)) seen.set(e.id, firstLog ? 0 : performance.now());
      const born = seen.get(e.id), lived = performance.now() - born;
      const fresh = born > 0 && lived < 1600;
      const t = new Date(Date.parse(e.ts));
      const stamp = t.toDateString() === today ? timeOf(e.ts, tz) : age(e.ts).replace(" ago", "");
      const row = h("div.cline", { class: fresh ? "is-new" : "", style: fresh ? { animationDelay: -Math.round(lived) + "ms" } : null, data: { type: e.type } },
        h("span.cline__t", stamp),
        h("span.cline__i", icon(e.icon || e.type, null, "diamondo")),
        h("span.cline__x", e.text, e.xp?.amount ? h("b.cline__xp", ` +${num(e.xp.amount)}${e.xp.area ? " " + cap(e.xp.area) : ""} XP`) : null));
      tip(row, () => ({ kicker: cap(e.type), title: e.text, lines: [e.xp?.amount ? ["XP", `+${num(e.xp.amount)} ${e.xp.area ? cap(e.xp.area) : ""}`] : null], source: e.source ?? null, asOf: e.ts }), { focusable: true });
      return row;
    });
    firstLog = false;
    // newest at the bottom, like a chat frame
    fill(logList, ...rows.reverse());
    logList.scrollTop = logList.scrollHeight;
  }

  // ---- action bar, day plate, XP bar ----------------------------------------------------------
  function actionBtn(a) {
    const b = h("button.abtn", { type: "button", class: app.panel === a.id ? "is-on" : "", "aria-label": `${a.label} (${a.key})`, "aria-pressed": String(app.panel === a.id), onClick: () => { closeSheet(); app.togglePanel(a.id); } },
      icon(a.icon), h("kbd.abtn__key", a.key), h("span.abtn__label", a.short));
    b.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") app.audio.hover(); });
    tip(b, { title: a.label, lines: [["Key", a.key]] }, { tap: false, place: "top" });
    return b;
  }
  function journalBtn() {
    const b = h("button.abtn.abtn--journal", { type: "button", class: app.journal?.isOpen() ? "is-on" : "", "aria-label": "Journal (J)", onClick: () => { closeSheet(); app.journal.toggle(); } }, icon("quill"), h("kbd.abtn__key", "J"), h("span.abtn__label", "Journal"));
    tip(b, { title: "Journal", lines: [["Key", "J"], "Mood, mindful, learning, support, focus. Moves the meters, grants no XP."] }, { tap: false, place: "top" });
    return b;
  }
  function paintBar() {
    if (isNarrow()) {
      // one row of five: three panels, the journal, and everything else under "More"
      const rest = ACTIONS.filter((a) => !PRIMARY.includes(a.id));
      const moreOn = sheetKind === "more" || rest.some((a) => a.id === app.panel);
      fill(abar, ACTIONS.filter((a) => PRIMARY.includes(a.id)).sort((a, b) => PRIMARY.indexOf(a.id) - PRIMARY.indexOf(b.id)).map(actionBtn), journalBtn(),
        h("button.abtn.abtn--more", { type: "button", class: moreOn ? "is-on" : "", "aria-label": "More", "aria-expanded": String(sheetKind === "more"), onClick: () => toggleSheet("more") }, icon("down", "abtn__moreico"), h("span.abtn__label", "More")));
      return;
    }
    fill(abar, h("i.abar__cap.abar__cap--l"), ...ACTIONS.map(actionBtn), h("i.abar__sep"), journalBtn(), h("i.abar__cap.abar__cap--r"));
  }

  // ---- calm layout pieces ---------------------------------------------------------------------
  function paintCalm(s) {
    const c = s?.character, main = s?.quests?.main, r = s?.realm, d = s?.day, p = pct(main?.progress);
    // one line for the active objective
    fill(objline, icon("crown"), h("span.objline__title", main ? main.title : nosig("objective: no signal")),
      main ? h("b.objline__pct", p == null ? nosig() : Math.round(p) + "%") : null,
      bar({ key: "q:line:" + (main?.id || "none"), value: main ? p : null, color: "var(--accent)", size: "xs", label: main?.title || "Objective" }));
    objline.onclick = () => (main ? app.openPanel("quests", { focus: main.id }) : app.openPanel("quests"));
    objline.setAttribute("aria-label", main ? `Active objective: ${main.title}${p == null ? "" : ", " + Math.round(p) + " percent"}` : "Active objective: no signal");
    // place chip: place, local time, weather; a dot for the link; expands the minimap
    const link = linkState(), w = r?.weather, stale = !!(r && r.stale);
    fill(chip, h("i.pchipbar__dot", { data: { link } }), h("span.pchipbar__place", r?.place || h("span.nosig", "no position")),
      stale ? h("span.pchipbar__stale", age(r.lastSeen || r.asOf).replace(" ago", "")) : null,
      h("span.pchipbar__time", clockIn(r?.tz)), w && has(w.tempC) ? h("span.pchipbar__wx", icon(weatherIcon(w.code, r?.sun?.phase)), Math.round(w.tempC) + "°") : null, icon(mmOpen ? "up" : "down", "pchipbar__chev"));
    chip.setAttribute("aria-expanded", String(mmOpen));
    chip.setAttribute("aria-label", `${r?.place || "No position"}${stale ? ", last seen " + age(r.lastSeen || r.asOf) : ""}, ${clockIn(r?.tz)}. Show the minimap`);
    // "Today" pull-up handle
    fill(todayBtn, icon("up"), h("b", "Today"),
      h("span", has(d?.questsDone) && has(d?.questsTotal) ? `${d.questsDone}/${d.questsTotal} quests` : nosig("quests: no signal")),
      has(d?.xp) ? h("span", "+" + num(d.xp) + " XP") : null, has(d?.grade) ? h("span.todaybtn__grade", d.grade) : null);
    todayBtn.setAttribute("aria-expanded", String(sheetKind === "today"));
    // ambient line: level and objective, nothing else
    fill(ambline, h("span.ambline__lvl", has(c?.level) ? String(c.level) : "–"), h("span.ambline__name", c?.name || ""),
      main ? [h("i"), h("span.ambline__obj", main.title), p == null ? null : h("b", Math.round(p) + "%")] : null, h("span.ambline__hint", "A"));
  }

  function toggleSheet(kind) { sheetKind === kind ? closeSheet() : openSheet(kind); }
  function openSheet(kind) { sheetKind = kind; app.journal?.close(); app.audio.tick(); sheet.classList.add("is-on"); sheet.dataset.kind = kind; paintSheet(store.state); paintBar(); paintCalm(store.state); sheetBody.scrollTop = 0; }
  function closeSheet() { if (!sheetKind) return false; sheetKind = null; sheet.classList.remove("is-on"); if (on) { paintBar(); paintCalm(store.state); } return true; }
  function paintSheet(s) {
    if (!sheetKind) return;
    const c = s?.character;
    if (sheetKind === "more") {
      sheetTitle.textContent = "More";
      const full = getHud() === "full";
      fill(sheetBody, h("div.moregrid", ACTIONS.filter((a) => !PRIMARY.includes(a.id)).map(actionBtn)),
        h("button.menu__row", { type: "button", "aria-pressed": String(full), onClick: () => { setHud(full ? "calm" : "full"); app.audio.tick(); closeSheet(); } }, icon("signals"), h("span", "Full HUD"), h("i.switch", { class: full ? "is-on" : "" })),
        h("button.menu__row", { type: "button", onClick: () => { app.audio.toggleMute(); app.audio.tick(); paintSheet(store.state); } }, icon(app.audio.muted ? "mute" : "sound"), h("span", app.audio.muted ? "Sound is off" : "Sound is on"), h("i.switch", { class: app.audio.muted ? "" : "is-on" })),
        h("button.menu__row", { type: "button", onClick: () => { closeSheet(); app.menu.open(); } }, icon("gear"), h("span", "Settings")));
      return;
    }
    if (sheetKind === "vitals") {
      sheetTitle.textContent = "Vitals";
      const a = c?.activity, list = (c?.buffs || []).filter((b) => { const r = remaining(b); return r == null || r > 0; });
      fill(sheetBody,
        a?.name ? h("div.kv", h("span.kv__k", "Activity"), h("span.kv__v", activityLabel(a))) : null,
        a?.basis ? h("p.note", a.basis) : null,
        h("div.meters", ordered(c?.vitals, VITAL_ORDER).map((m) => meterRow(m, { keyPrefix: "sv", size: "md" }))),
        sectionHead("Buffs and debuffs", list.length ? String(list.length) : null),
        list.length ? h("div.kvs", list.map((b) => { const left = remaining(b); const row = h("div.kv", { class: b.kind === "debuff" ? "is-debuff" : "" }, h("span.kv__k", icon(b.icon, null, b.kind === "debuff" ? "skull" : "star"), " ", b.label), h("span.kv__v", left != null ? shortSpan(left) + " left" : "ongoing"));
          tip(row, { kicker: b.kind === "debuff" ? "Debuff" : "Buff", title: b.label, lines: [b.detail], source: b.source ?? null, asOf: b.since ?? null }, { focusable: true }); return row; })) : h("div.none", nosig(s ? "none active" : NO_SIGNAL)),
        h("button.lbtn", { type: "button", onClick: () => { closeSheet(); app.openPanel("character"); } }, "Character window", icon("right")));
      return;
    }
    sheetTitle.textContent = "Today";
    const qs = s?.quests, daily = (qs?.daily || []).map((q) => ({ ...q, kind: "daily" })), weekly = (qs?.weekly || []).filter((q) => !isDone(q)).map((q) => ({ ...q, kind: "weekly" }));
    const openQ = (id) => () => { closeSheet(); app.openPanel("quests", { focus: id }); };
    const log = logEntries(s).slice(0, 6), tz = s?.realm?.tz;
    fill(sheetBody,
      sectionHead("Daily quests", daily.length ? `${daily.filter(isDone).length}/${daily.length}` : null),
      daily.length ? h("div.qlist", daily.map((q) => questRow(q, { onClick: openQ(q.id), raw: true, class: "qrow--wide" }))) : h("div.none", nosig(s ? "none today" : NO_SIGNAL)),
      weekly.length ? [sectionHead("This week", String(weekly.length) + " open"), h("div.qlist", weekly.slice(0, 4).map((q) => questRow(q, { onClick: openQ(q.id), raw: true, class: "qrow--wide" })))] : null,
      (s?.streaks || []).length ? [sectionHead("Streaks"), h("div.streaks__row.streaks__row--sheet", s.streaks.map((st) => { const cell = h("div.streak", { data: { state: streakState(st) } }, icon(STREAK_ICONS[st.id] || "flame"), h("b", has(st.current) ? String(st.current) : "–"), h("span", st.label)); tip(cell, streakTip(st, s), { focusable: true }); return cell; }))] : null,
      sectionHead("Quick glance"),
      h("div.meters", ordered(c?.meters, METER_ORDER).map((m) => meterRow(m, { keyPrefix: "st", size: "md", tip: { kicker: "Quick glance" } }))),
      sectionHead("Combat log", has(s?.logTotal) ? num(s.logTotal) : null),
      log.length ? h("div.hsheet__log", log.map((e) => h("div.cline", { data: { type: e.type } }, h("span.cline__t", timeOf(e.ts, tz)), h("span.cline__i", icon(e.icon || e.type, null, "diamondo")), h("span.cline__x", e.text, e.xp?.amount ? h("b.cline__xp", ` +${num(e.xp.amount)} XP`) : null)))) : h("div.none", nosig(s ? "no events yet" : NO_SIGNAL)),
      h("button.lbtn", { type: "button", onClick: () => { closeSheet(); app.openPanel("chronicle", { tab: "log" }); } }, "Chronicle", icon("right")));
  }

  function paintDay(s) {
    const d = s?.day;
    const bits = [
      h("span", has(s?.realm?.dayOfLife) ? "Day " + num(s.realm.dayOfLife) : has(d?.n) && d.n ? "Day " + num(d.n) : nosig("day: no signal")),
      h("span", has(d?.questsDone) && has(d?.questsTotal) ? `${d.questsDone}/${d.questsTotal} quests` : nosig("quests: no signal")),
      h("span", has(d?.xp) ? ["+", counter("day:xp", d.xp), " XP today"] : nosig("xp: no signal")),
      has(d?.grade) ? h("span.dayplate__grade", "Grade ", h("b", d.grade)) : null,
    ].filter(Boolean);
    fill(dayPlate, ...bits.flatMap((b, i) => (i ? [h("i"), b] : [b])));
    tip(dayPlate, () => ({ title: "Today", lines: [["Date", d?.date], ["Quests done", has(d?.questsDone) ? `${d.questsDone} of ${d.questsTotal}` : null], ["XP today", has(d?.xp) ? num(d.xp) : null], ["Grade", d?.grade ?? null]], source: "engine (derived from the event log)", asOf: s?.asOf ?? null, nosignal: !d }), { focusable: true });
  }
  function paintXp(s) {
    const c = s?.character;
    const p = has(c?.xp) && has(c?.xpNext) && c.xpNext > 0 ? (c.xp / c.xpNext) * 100 : null;
    fill(xp, 
      h("span.xpbar__lvl", has(c?.level) ? String(c.level) : "–"),
      bar({ key: "xp", value: p, color: "var(--v-xp)", size: "xp", segments: true, label: "Experience" }),
      h("span.xpbar__lvl", has(c?.level) ? String(c.level + 1) : "–"),
      h("span.xpbar__text", p == null ? nosig("experience: no signal") : [counter("xp:cur", c.xp), " / " + num(c.xpNext) + " XP", has(c.xpToday) ? h("em", `  +${num(c.xpToday)} today`) : null]),
    );
    tip(xp, () => ({ title: "Experience", value: p == null ? undefined : `${num(c.xp)} / ${num(c.xpNext)}`, lines: [["Level", c?.level ?? null], ["To next level", p == null ? null : num(c.xpNext - c.xp) + " XP"], ["Today", has(c?.xpToday) ? "+" + num(c.xpToday) : null], "XP is only granted by events from a device, an account or a record."], source: "engine (derived from the event log)", asOf: s?.asOf ?? null, nosignal: p == null }), { focusable: true, place: "top" });
  }

  function paint(s) {
    el.dataset.hud = isAmbient() ? "ambient" : getHud();
    paintUnit(s); paintCalm(s); paintSheet(s); paintBuffs(s); paintGlance(s); paintStreaks(s); paintBrief(s); wantBrief(s); paintMap(s); paintSig(s); paintTracker(s); paintLog(s); paintBar(); paintDay(s); paintXp(s);
  }

  app.audio.onChange(() => { if (on) paintMap(store.state); });
  onSkin(() => requestAnimationFrame(() => minimap.redraw()));
  window.addEventListener("resize", () => { if (on) { paintTracker(store.state); paintBar(); } });

  return {
    el,
    enter() {
      on = true; paint(store.state); el.classList.add("is-on");
      clearInterval(clock);
      clock = setInterval(() => { if (document.hidden) return; const s = store.state; paintMap(s); paintBuffs(s); }, 20000);
    },
    leave() { on = false; clearInterval(clock); el.classList.remove("is-on"); },
    update(s) { if (on) paint(s); },
    setPanel(id) { if (id) closeSheet(); el.classList.toggle("is-paneled", !!id); el.dataset.panel = id || ""; if (on) { paintBar(); paintSig(store.state); } },
    brief: (kind) => wantBrief(store.state, kind),
    closeSheets: () => closeSheet(),
    setAmbient(v) { el.dataset.hud = v ? "ambient" : getHud(); if (v) closeSheet(); },
    pushLog(ev) { extra.unshift(ev); if (extra.length > 40) extra.pop(); if (on) paintLog(store.state); },
    redrawMap: () => minimap.redraw(),
  };
}
