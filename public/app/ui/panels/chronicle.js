// Chronicle (H): the finished game days as a heat-grid of grades (GET /api/days), a day's summary
// on tap, and the full combat log with paging (GET /api/log).

import { h, has, num, cap, timeOf, dateOf, NO_SIGNAL, fill, isNarrow } from "../dom.js";
import { icon } from "../icons.js";
import { tip } from "../tooltip.js";
import { getDays, getLog } from "../store.js";
import { sectionHead, nosig, emptyState, stat } from "../widgets.js";

const GRADES = ["S", "A", "B", "C", "D", "F"];
const iso = (d) => d.toISOString().slice(0, 10);

function create(app) {
  let days = undefined, daysAt = 0, selected = null, rerender = () => {};
  let log = { entries: [], next: null, total: null, loading: false, loaded: false };

  function loadDays() {
    if (days === undefined || Date.now() - daysAt > 5 * 60e3) {
      daysAt = Date.now();
      const first = days === undefined;
      if (first) days = null;
      getDays(400).then((d) => { days = d === null ? false : d; if (!selected && days && days.length) selected = days[0].date; rerender(); });
    }
  }
  function loadLog(more) {
    if (log.loading || (log.loaded && !more) || (more && !log.next)) return;
    log.loading = true;
    getLog(more ? log.next : null, 80).then((r) => {
      log.loading = false; log.loaded = true;
      if (r) { const seen = new Set(log.entries.map((e) => e.id)); log.entries.push(...(r.entries || []).filter((e) => !seen.has(e.id))); log.next = r.next || null; log.total = r.total ?? null; } else log.failed = true;
      rerender();
    });
    rerender();
  }

  function grid(byDate) {
    const end = new Date(); end.setUTCHours(12, 0, 0, 0);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - 370); start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // back to a Monday
    const weeks = [], months = [];
    for (let d = new Date(start), w = null; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if ((d.getUTCDay() + 6) % 7 === 0) { w = []; weeks.push(w); if (d.getUTCDate() <= 7) months.push([weeks.length - 1, d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })]); }
      const key = iso(d), rec = byDate.get(key);
      const cell = h("button.hcell", { type: "button", class: (key === selected ? "is-sel " : "") + (rec ? "" : "is-none"), data: { g: rec?.grade || null, date: key }, "aria-label": key + (rec ? `: grade ${rec.grade ?? "none"}, ${rec.xp ?? 0} XP` : ": no record") });
      w.push(cell);
    }
    const el = h("div.heat", { style: { "--weeks": weeks.length } },
      h("div.heat__months", months.map(([i, m]) => h("span", { style: { gridColumn: i + 1 } }, m))),
      h("div.heat__grid", weeks.map((w) => h("div.heat__col", w))));
    el.addEventListener("click", (e) => { const c = e.target.closest(".hcell"); if (!c) return; selected = c.dataset.date; app.audio.tick(); rerender(); });
    return el;
  }

  function dayCard(rec, key, tz) {
    if (!key) return emptyState("Pick a day", "Tap a square for that day's summary.");
    const title = dateOf(key + "T12:00:00Z", "UTC", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (!rec) return [h("div.dayc__date", title), emptyState("No record", "No game day was closed on this date.")];
    const areas = Object.entries(rec.xpByArea || {}).sort((a, b) => b[1] - a[1]);
    return [
      h("div.dayc__head", h("span.dayc__grade", { data: { g: rec.grade || null } }, rec.grade ?? "–"), h("div", h("div.dayc__date", title), h("div.dayc__text", rec.text || ""))),
      h("div.stats3", stat("XP", has(rec.xp) ? "+" + num(rec.xp) : null), stat("Quests", has(rec.questsDone) ? `${rec.questsDone} / ${rec.questsTotal}` : null), stat("Readiness", has(rec.readiness) ? [String(rec.readiness), has(rec.multiplier) ? h("small", " ×" + rec.multiplier) : null] : null)),
      areas.length ? [sectionHead("XP by attribute"), h("div.kvs", areas.map(([a, v]) => h("div.kv", h("span.kv__k", icon(a), " ", cap(a)), h("span.kv__v.xpv", "+" + num(v)))))] : null,
      rec.quests?.length ? [sectionHead("Quests", `${rec.questsDone}/${rec.questsTotal}`), h("div.dayc__quests", rec.quests.map((q) => h("span.dq", { class: q.done ? "is-done" : "" }, icon(q.done ? "check" : "diamondo"), q.title)))] : null,
      rec.streaks?.length ? [sectionHead("Streaks"), h("div.dayc__quests", rec.streaks.map((s) => h("span.dq", { class: s.state === "kept" || s.state === "started" ? "is-done" : "is-broken" }, icon("flame"), `${s.label}: ${s.state}${has(s.length) ? " · " + s.length + " " + (s.unit || "") : ""}`)))] : null,
      rec.notable?.length ? [sectionHead("Notable"), h("div.kvs", rec.notable.map((n) => h("div.kv", h("span.kv__k", typeof n === "string" ? n : n.text || n.title || cap(n.type || "")), h("span.kv__v", n.ts ? timeOf(n.ts, tz) : ""))))] : null,
      h("p.note", "Source: engine day close" + (rec.closedAt ? " · closed " + dateOf(rec.closedAt, tz, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "")),
    ];
  }

  function logList(s) {
    const tz = s?.realm?.tz;
    if (!log.loaded && !log.entries.length) return h("div.none", nosig(log.loading ? "reading the log" : NO_SIGNAL));
    if (log.failed && !log.entries.length) return emptyState(NO_SIGNAL, "The log route did not answer.");
    let last = "";
    const rows = [];
    for (const e of log.entries) {
      const dayKey = dateOf(e.ts, tz, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
      if (dayKey !== last) { rows.push(h("div.clogday", dayKey)); last = dayKey; }
      const row = h("div.cline", { data: { type: e.type } }, h("span.cline__t", timeOf(e.ts, tz)), h("span.cline__i", icon(e.icon || e.type, null, "diamondo")),
        h("span.cline__x", e.text, e.xp?.amount ? h("b.cline__xp", ` +${num(e.xp.amount)}${e.xp.area ? " " + cap(e.xp.area) : ""} XP`) : null));
      tip(row, () => ({ kicker: cap(e.type), title: e.text, lines: [e.xp?.amount ? ["XP", `+${num(e.xp.amount)} ${e.xp.area ? cap(e.xp.area) : ""}`] : null, has(e.mult) && e.mult !== 1 ? ["Multiplier", "×" + e.mult] : null, ...(e.grants || []).map((g) => [g.rule, `+${g.amount} ${cap(g.area || "")}`])], source: e.source ?? null, asOf: e.ts }), { focusable: true });
      rows.push(row);
    }
    return [h("div.chron__loglist", rows),
      log.next ? h("button.lbtn.chron__more", { type: "button", onClick: () => loadLog(true) }, log.loading ? "Reading…" : "Load older entries", icon("down")) : h("div.none", "The beginning of the log.")];
  }

  return {
    tab: "days",
    onOpen() { daysAt = Math.min(daysAt, Date.now() - 4 * 60e3); },
    render(root, s, ctx) {
      rerender = ctx.rerender;
      if (ctx.tab === "log") {
        loadLog(false);
        fill(root, h("div.chron.chron--log",
          h("div.chron__loghead", sectionHead("Combat log", has(log.total) ? `${num(log.entries.length)} of ${num(log.total)}` : has(s?.logTotal) ? num(s.logTotal) + " entries" : null)),
          h("div.chron__logbody.scroll", { data: { scroll: "chron-log" } }, logList(s))));
        return;
      }
      loadDays();
      if (days === null) { fill(root, h("div.none", nosig("reading the chronicle"))); return; }
      if (days === false) { fill(root, emptyState(NO_SIGNAL, "The day history did not answer.")); return; }
      if (!days.length) { fill(root, emptyState("No finished days yet", "A day appears here when the engine closes it.")); return; }
      const byDate = new Map(days.map((d) => [d.date, d]));
      const counts = Object.fromEntries(GRADES.map((g) => [g, days.filter((d) => d.grade === g).length]));
      const g = grid(byDate);
      fill(root, h("div.chron",
        h("div.chron__main",
          sectionHead("Day grades, last year", `${days.length} days on record`),
          h("div.heat__wrap.scroll", { data: { scroll: "heat" } }, g),
          h("div.heat__legend", GRADES.map((x) => h("span", h("i.hcell", { data: { g: x } }), x, h("b", String(counts[x])))), h("span", h("i.hcell.is-none"), "no record")),
          sectionHead("Recent days"),
          h("div.recent.scroll", { data: { scroll: "recent" } }, days.slice(0, 21).map((d) => h("button.rday", { type: "button", class: d.date === selected ? "is-sel" : "", onClick: () => { selected = d.date; app.audio.tick(); rerender(); } },
            h("i.hcell", { data: { g: d.grade || null } }), h("span.rday__date", dateOf(d.date + "T12:00:00Z", "UTC", { weekday: "short", day: "numeric", month: "short" })), h("b.rday__grade", d.grade ?? "–"),
            h("span.rday__q", has(d.questsDone) ? `${d.questsDone}/${d.questsTotal} quests` : ""), h("span.rday__xp", has(d.xp) ? "+" + num(d.xp) + " XP" : ""))))),
        h("div.chron__day.scroll", { data: { scroll: "chron-day" } }, dayCard(byDate.get(selected), selected, s?.realm?.tz))));
      // show the newest weeks first on a narrow screen
      const wrap = root.querySelector(".heat__wrap");
      if (wrap && !wrap.dataset.done) { wrap.scrollLeft = wrap.scrollWidth; }
      void isNarrow;
    },
  };
}

// The contract lists no stage mode for this window; it uses the dimmed "quests" shot.
export default { id: "chronicle", title: "Chronicle", icon: "chronicle", mode: "quests", tabs: [{ id: "days", label: "Days" }, { id: "log", label: "Combat log" }], create };
