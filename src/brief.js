// Briefings for voice and the watch. Pure: brief(state, kind, now) reads the state document and
// nothing else, so every sentence is backed by a number that is on screen. `speech` is two or
// three plain sentences with no symbols, written to be read aloud.
import { parseTs } from "./lib/time.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const int = v => String(Math.round(Math.abs(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const plural = (n, one, many) => (n === 1 ? "1 " + one : int(n) + " " + (many || one + "s"));
const spokenDate = d => (d ? MONTHS[+d.slice(5, 7) - 1] + " " + +d.slice(8, 10) : null);
const dayGap = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
function hoursMinutes(h) {
  const m = Math.round(h * 60), hh = Math.floor(m / 60), mm = m % 60;
  return hh === 0 ? plural(mm, "minute") : plural(hh, "hour") + (mm ? " " + plural(mm, "minute") : "");
}
function listOf(items, max = 3) {
  const a = items.slice(0, max), more = items.length - a.length;
  const head = a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
  return more > 0 ? a.join(", ") + " and " + plural(more, "more", "more") : head;
}
/** Only letters, digits, spaces, commas, full stops and apostrophes reach the voice. */
export function speakable(s) {
  return String(s).replace(/&/g, " and ").replace(/[^A-Za-z0-9 ,.']+/g, " ").replace(/\s+/g, " ").replace(/ ([,.])/g, "$1").trim();
}
const unitWords = unit => (/usd|\$/i.test(unit || "") ? " dollars" : "") + (/\/mo/i.test(unit || "") ? " a month" : "");
const money = (v, unit) => int(v) + unitWords(unit);

// How each progress unit is counted aloud: [singular, plural, what follows the count].
const COUNT_WORDS = {
  steps: ["step", "steps", "to go"], g: ["gram of protein", "grams of protein", "to go"], tasks: ["task", "tasks", "to go"],
  people: ["person", "people", "to reach"], workouts: ["workout", "workouts", "to go"], "weigh-ins": ["weigh in", "weigh ins", "to go"],
  days: ["day", "days", "to go"], places: ["place", "places", "to go"],
};
const isNum = v => typeof v === "number" && Number.isFinite(v);
const oneDp = v => String(Math.round(v * 10) / 10);
/**
 * What is still missing on a quest, in words, counted from its own progress (max minus cur).
 * Returns null when there is no progress reading, or when nothing done now can change it:
 * callers leave the phrase out, so a missing number is never spoken as zero.
 */
export function remaining(q) {
  const p = q && q.progress;
  if (!p || !isNum(p.cur) || !isNum(p.max)) return null;
  const settles = q.week || /week/.test(q.note || "") ? "it settles when the week ends" : "it settles when the day ends";
  const unit = String(p.unit || "");
  if (unit === "h") return null;                           // last night's sleep is already written
  if (unit === "h avg") return "averaging " + oneDp(p.cur) + " of " + oneDp(p.max) + " hours a night, " + settles;
  if (unit === "kcal") {
    const lo = p.max * 0.9, hi = p.max * 1.1;
    if (p.cur < lo) return plural(Math.ceil(lo - p.cur), "calorie") + " short of the range";
    if (p.cur > hi) return plural(Math.ceil(p.cur - hi), "calorie") + " over the range";
    return "calories in range, " + settles;
  }
  if (/^usd/i.test(unit)) return p.cur > 0 ? "up " + plural(p.cur, "dollar") + ", " + settles : p.cur < 0 ? "down " + plural(-p.cur, "dollar") + ", " + settles : "level so far, " + settles;
  const left = Math.ceil(p.max - p.cur - 1e-9);
  if (left <= 0) return "target reached, " + settles;      // met but not yet closed: never "0 to go"
  const w = COUNT_WORDS[unit];
  if (w) return plural(left, w[0], w[1]) + " " + w[2];
  return p.max === 1 ? "still open" : int(left) + " to go";
}
/** A quest line for the structured part: `pct` and `left` are left out when there is nothing to say. */
function line(q, withLeft = true) {
  const o = { id: q.id, title: q.title }, pct = q.progress && isNum(q.progress.pct) ? q.progress.pct : null, left = withLeft ? remaining(q) : null;
  if (pct != null) o.pct = pct;
  if (left != null) o.left = left;
  return o;
}
const titleOf = q => q.title;
/** Open daily quests that can still be moved today, nearest to done first, as quest lines. */
export function closestDailies(state) {
  const open = state.quests.daily.filter(q => q.state === "active");
  return open.filter(q => remaining(q) != null && !/it settles when/.test(remaining(q))).sort((a, b) => (b.progress.pct || 0) - (a.progress.pct || 0));
}
export function closestDaily(state) { const q = closestDailies(state)[0]; return q ? line(q) : null; }

export function brief(state, kind = "now", now = Date.now()) {
  const S = state, C = S.character, D = S.day, Q = S.quests;
  const daily = Q.daily.filter(q => q.state !== "nosignal"), open = daily.filter(q => q.state === "active"), done = daily.filter(q => q.state === "done");
  const endsAt = parseTs(D.endsAt), minsLeft = endsAt && endsAt > now ? Math.round((endsAt - now) / 60000) : null;
  const main = Q.main, mp = main.progress, next = main.oneThing && main.oneThing.next;
  const base = { kind, asOf: S.asOf, day: { date: D.date, calendarDate: D.calendarDate, basis: D.basis, endsAt: D.endsAt, minutesLeft: minsLeft } };
  const sentences = [];

  if (kind === "morning") {
    const sleepMeter = C.meters.find(m => m.id === "sleep"), energy = C.vitals.find(v => v.id === "energy");
    const sleepH = sleepMeter && typeof sleepMeter.hours === "number" ? sleepMeter.hours : null;
    const r = C.readiness;
    const tone = r.score == null ? null : r.score >= 70 ? "a strong day, so everything you do pays extra" : r.score >= 45 ? "an ordinary day" : "a low day, so go easy, experience pays a little less";
    sentences.push((sleepH != null ? "You slept " + hoursMinutes(sleepH) : "I have no sleep reading for last night") +
      (r.score != null ? (sleepH != null ? " and" : ", and") + " readiness is " + r.score + ", " + tone + "." : (sleepH != null ? ", and" : " and") + " there is no readiness reading yet."));
    sentences.push(open.length ? plural(open.length, "quest is", "quests are") + " open today, " + (open.length > 3 ? "including " + listOf(open.slice(0, 3).map(titleOf)) : listOf(open.map(titleOf))) + "." : daily.length ? "Every quest with a signal is already done." : "No quest has a signal yet today.");
    if (mp) {
      const gap = next ? dayGap(D.calendarDate || D.date, next.date) : null;
      sentences.push("The main objective, " + main.title.toLowerCase() + ", stands at " + int(mp.cur) + " of " + money(mp.max, mp.unit) +
        (next ? ", and the next anchor is " + money(next.target, mp.unit) + " by " + spokenDate(next.date) + (gap != null ? ", " + (gap === 0 ? "today" : gap < 0 ? plural(-gap, "day") + " ago" : plural(gap, "day") + " away") : "") : "") + ".");
    } else sentences.push("The main quest has no reading yet.");
    return finish({ ...base,
      sleep: sleepH != null ? { hours: Math.round(sleepH * 100) / 100, display: sleepMeter.display, source: sleepMeter.source } : null,
      readiness: { score: r.score, multiplier: r.multiplier, energy: energy ? energy.value : null },
      quests: daily.map(q => ({ ...line(q, q.state === "active"), state: q.state })),
      main: mp ? { title: main.title, oneThing: main.oneThing && main.oneThing.title, cur: mp.cur, target: mp.max, unit: mp.unit, pct: mp.pct, next: next || null } : null }, sentences);
  }

  if (kind === "evening") {
    sentences.push(D.grade ? "Day's end, grade " + D.grade + ", with " + int(D.xp) + " experience earned." : "Day's end, no grade yet, with " + int(D.xp) + " experience earned.");
    sentences.push(done.length ? "You completed " + listOf(done.map(titleOf), 4) + "." : "No quest completed today.");
    const carry = open.map(titleOf), tasks = Q.openTasks || 0;
    sentences.push(carry.length || tasks ? "Carrying over " + (carry.length + (tasks ? 1 : 0) > 1 ? "are " : "is ") + [carry.length ? listOf(carry) : null, tasks ? plural(tasks, "open task") : null].filter(Boolean).join(", plus ") + "." : "Nothing carries over.");
    return finish({ ...base, grade: D.grade, xp: D.xp, questsDone: D.questsDone, questsTotal: D.questsTotal,
      completed: done.map(q => ({ id: q.id, title: q.title })), carriesOver: open.map(q => line(q)),
      openTasks: tasks, weekly: Q.weekly.filter(q => q.state === "active").map(q => line(q)) }, sentences);
  }

  // ---- now: what is closest, what is at risk
  const closest = closestDailies(S).slice(0, 2);
  const streaks = (S.streaks || []).filter(s => s.period === "day" && s.current >= 2 && !s.hitThisPeriod && s.id !== "sleep");
  const questFor = { "steps-goal": "walk", protein: "protein", diary: null };
  const risks = streaks.map(s => { const q = Q.daily.find(x => x.id === questFor[s.id]), left = q && q.state === "active" ? remaining(q) : null; return { kind: "streak", id: s.id, label: s.label, current: s.current, unit: s.unit, ...(left != null ? { left } : {}) }; });
  if (!daily.length) sentences.push("No quest has a signal yet today.");
  else if (!open.length) sentences.push("Every quest with a signal is done for today.");
  else if (closest.length) sentences.push("Closest right now is " + closest[0].title + ", " + remaining(closest[0]) + (closest[1] ? ", then " + closest[1].title + ", " + remaining(closest[1]) : "") + ".");
  else sentences.push(plural(open.length, "quest is", "quests are") + " open and waiting on the day to close.");
  sentences.push(risks.length ? "At risk is your " + risks[0].current + " " + risks[0].unit.replace(/s$/, "") + " " + risks[0].label.toLowerCase() + " streak" + (risks[0].left ? ", " + risks[0].left : "") +
    (risks.length > 1 ? ", and " + plural(risks.length - 1, "other streak") : "") + "." : "No streak is at risk right now.");
  if (minsLeft != null) sentences.push("The day ends in " + (minsLeft >= 90 ? "about " + plural(Math.round(minsLeft / 60), "hour") : plural(minsLeft, "minute")) + ".");
  return finish({ ...base, activity: C.activity || null, closest: closest.map(q => line(q)), atRisk: risks,
    open: open.map(q => line(q)), done: done.map(q => q.id), xp: D.xp }, sentences);
}
/** The evening brief for a day that has already closed, from its day-close summary (state.day.lastClose.speech). */
export function closeSpeech(d) {
  const done = d.quests.filter(q => q.done).map(q => q.title), missed = d.quests.filter(q => !q.done).map(q => q.title);
  const kept = d.streaks.filter(x => x.state === "kept"), broke = d.streaks.filter(x => x.state === "broken");
  const out = ["Your last day closed" + (d.grade ? " at grade " + d.grade : " with no grade") + ", with " + int(d.xp) + " experience earned."];
  out.push(done.length ? "You completed " + listOf(done, 4) + (missed.length ? ", and missed " + listOf(missed, 3) : "") + "." : d.quests.length ? "No quest was completed, and " + listOf(missed, 3) + " went unfinished." : "No quest had a signal that day.");
  if (broke.length) out.push("Your " + broke[0].label.toLowerCase() + " streak ended at " + plural(broke[0].was, broke[0].unit.replace(/s$/, ""), broke[0].unit) + (broke.length > 1 ? ", along with " + plural(broke.length - 1, "other streak") : "") + ".");
  else if (kept.length) { const best = [...kept].sort((a, b) => b.length - a.length)[0]; out.push("Your " + best.label.toLowerCase() + " streak is now " + plural(best.length, best.unit.replace(/s$/, ""), best.unit) + (kept.length > 1 ? ", and " + plural(kept.length - 1, "other streak is", "other streaks are") + " still running" : "") + "."); }
  return speakable(out.join(" "));
}
function finish(obj, sentences) { return { ...obj, speech: speakable(sentences.join(" ")) }; }
