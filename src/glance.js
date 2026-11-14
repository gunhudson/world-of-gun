// GET /api/glance: the small document for widgets, the watch and the lock screen. Pure:
// glance(state) reads the contract document and nothing else. Target: under 2 KB.
// Every value is copied from state, so nulls stay null (no signal is never a number).
import { closestDaily } from "./brief.js";
import { fnv } from "./ingest.js";

export function glance(state) {
  const S = state, C = S.character, Q = S.quests, D = S.day, M = Q.main, R = S.realm;
  const vital = id => { const v = C.vitals.find(x => x.id === id); return v ? v.value : null; };
  const next = M.oneThing && M.oneThing.next ? { date: M.oneThing.next.date, target: M.oneThing.next.target, label: M.oneThing.next.label || null } : null;
  const c = closestDaily(S);
  const streaks = (S.streaks || []).filter(s => s.current > 0).sort((a, b) => (b.period === "day") - (a.period === "day") || b.current - a.current).slice(0, 3)
    .map(s => ({ id: s.id, label: s.label, current: s.current, unit: s.unit, secured: s.period === "day" ? !!s.hitThisPeriod : null }));
  const a = C.activity || null;
  return {
    v: 1, ...(S.env === "qc" ? { env: "qc", sandbox: S.sandbox } : {}), asOf: S.computedAt || S.asOf,
    name: C.name, level: C.level, title: C.title, xp: C.xp, xpNext: C.xpNext, xpToday: C.xpToday,
    health: vital("health"), energy: vital("energy"),
    meters: C.meters.map(m => ({ id: m.id, value: m.value })),
    main: { title: M.title, pct: M.progress ? M.progress.pct : null, cur: M.progress ? M.progress.cur : null, target: M.progress ? M.progress.max : null, unit: M.progress ? M.progress.unit : null, next },
    closest: c ? { id: c.id, title: c.title, pct: c.pct ?? null, left: c.left ?? null } : null,
    quests: { done: D.questsDone, total: D.questsTotal }, grade: D.grade,
    streaks,
    activity: a ? { name: a.name, inferred: !!a.inferred } : null,
    realm: { place: R.place, stale: !!R.stale },
    day: { date: D.date, endsAt: D.endsAt },
  };
}
/** ETag over everything except `asOf`, so an unchanged glance is a 304 however often the engine recomputes. */
export function glanceEtag(g) { const { asOf, ...rest } = g; return '"g1-' + fnv(JSON.stringify(rest)) + '"'; }
