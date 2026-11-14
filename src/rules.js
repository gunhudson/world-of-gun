// World of Gun: the rules of the game, as tables. Pure data and small pure functions only.
// src/reduce.js applies these to the event log. Retune here, then replay the log
// (POST /api/admin/recompute); history is re-scored with the new numbers.
//
// Rule zero (docs/CONTRACT.md): reality is the only input. Every number below is applied to a
// fact that came from a device, an account or a record. Nothing here invents a value, and a
// missing fact always yields null, never a default.

export const RULES_VERSION = "1.0";          // bump when a table below changes: clients can tell a replayed history from a live one

// ---------------------------------------------------------------------------------------------
// Attributes: the ten areas of life. A task names its area; XP rules name theirs.
// ---------------------------------------------------------------------------------------------
export const AREAS = [
  { id: "strategy",   label: "Strategy" },
  { id: "body",       label: "Body" },
  { id: "mind",       label: "Mind" },
  { id: "things",     label: "Things" },
  { id: "people",     label: "People" },
  { id: "joy",        label: "Joy" },
  { id: "wealth",     label: "Wealth" },
  { id: "connection", label: "Connection" },
  { id: "growth",     label: "Growth" },
  { id: "impact",     label: "Impact" },
];
export const AREA_IDS = AREAS.map(a => a.id);

// ---------------------------------------------------------------------------------------------
// Level curve. XP needed to go from level L to L+1 = base + step * (L - 1).
// Character: 100, 140, 180 ... Level 10 at 2,340 XP, 20 at 8,740, 30 at 19,140, 60 at 74,340.
// A full real day (sleep, steps, food, a workout, a few tasks, the dailies) is worth roughly
// 200 to 250 XP, so level 60 is about a year of days lived well.
// ---------------------------------------------------------------------------------------------
export const CURVES = {
  character: { base: 100, step: 40 },
  attribute: { base: 50, step: 25 },
};
export function xpToNext(level, curve) { return curve.base + curve.step * (level - 1); }
export function levelFor(total, curve) {
  let level = 1, floor = 0;
  for (;;) {
    const need = xpToNext(level, curve);
    if (total < floor + need) return { level, into: total - floor, need, floor };
    floor += need; level++;
  }
}

// Title by character level; class by the attribute with the most XP. Derived, never typed in.
export const TITLES = [
  [1, "Initiate"], [5, "Wanderer"], [10, "Adventurer"], [20, "Journeyman"],
  [30, "Veteran"], [40, "Champion"], [50, "Master"], [60, "The Legend of Gun"],
];
export const CLASSES = {
  strategy: "Strategist", body: "Warrior", mind: "Sage", things: "Artificer", people: "Diplomat",
  joy: "Bard", wealth: "Merchant", connection: "Guardian", growth: "Seeker", impact: "Paladin",
};

// ---------------------------------------------------------------------------------------------
// One source of truth per metric. Where two feeds report the same thing, the first one that has
// a value for the date wins; the second only fills dates the first does not cover. With
// fallbackClosedDaysOnly the second source never supplies the current day (the two sources cut
// days differently, sleep-day against calendar, so mixing them today would count steps twice).
// ---------------------------------------------------------------------------------------------
export const TRUTH = {
  steps:  { order: ["steps.day", "health.day"],   fallbackClosedDaysOnly: true, why: "The step counter's own daily total is minutes fresh; the health database only fills older dates." },
  sleep:  { order: ["health.day", "sleep.night"], why: "The health database has hours asleep and deep sleep; sleep.night is only the last night's in-bed span, used until the database catches up." },
  food:   { order: ["meal.day", "health.day"],    fallbackClosedDaysOnly: true, why: "The food diary is where meals are logged and carries the day's target; the health database only fills older dates." },
  weight: { order: ["health.day", "weigh"],       why: "The health database is the reconciled scale record (weight, body fat, lean mass); a direct scale reading fills in until it lands." },
  workout: { order: ["workout (calendar form: date + status, gym check-in)", "workout (a recorded session: start, end, kind)"],
            why: "A day earns the workout once. The calendar form decides when it has an entry; a recorded session (from the phone) counts the day when there is none, and adds kind, minutes and kcal to the same line when both exist." },
  heart:  { order: ["health.day"],                why: "Resting HR, HRV, active energy and exercise minutes exist only in the health database." },
};

// ---------------------------------------------------------------------------------------------
// Readiness. The resource model: health is a multiplier on the ability to use every other
// resource. So the day's readiness scales every XP grant earned that day.
// Components (each 0..100), weighted over whichever are present:
//   sleep  : hours last night, 4 h = 0, 6 h = 50 (neutral), 8 h = 100; with deep sleep known,
//            80% hours + 20% deep sleep against 1.5 h
//   hrv    : today's HRV against the player's own 30-day median (+25% = 100, -25% = 0)
//   rhr    : today's resting HR against the player's own 30-day median (5 bpm lower = 100, 5 higher = 0)
// Every component is neutral at 50 (six hours, HRV and RHR on baseline), so an ordinary day is x1.
// No component present = readiness null and the multiplier is exactly 1 (nothing is modified).
// ---------------------------------------------------------------------------------------------
export const READINESS = {
  weights: { sleep: 0.5, hrv: 0.3, rhr: 0.2 },
  sleepZeroH: 4, sleepFullH: 8, deepTargetH: 1.5, deepShare: 0.2,
  baselineDays: 30, baselineMin: 5,
  hrvSpan: 0.25,          // +-25% of baseline maps to 100 / 0
  rhrSpanBpm: 5,          // -+5 bpm from baseline maps to 100 / 0
  multMin: 0.75, multMax: 1.25,   // readiness 0 -> x0.75, 50 -> x1.00, 100 -> x1.25
};
export function readinessMultiplier(score) {
  if (score == null) return 1;
  return Math.round((READINESS.multMin + (READINESS.multMax - READINESS.multMin) * score / 100) * 100) / 100;
}

// ---------------------------------------------------------------------------------------------
// Caps and the multiplier. Every rule's `cap` is the most its base XP can be, and it is applied
// BEFORE the readiness multiplier. The multiplier (x0.75 to x1.25) then scales the capped base,
// so a logged grant can exceed the cap by up to 25% on a strong day and fall below it on a weak
// one: a 15,000 dollar payment is 150 base, and "+153" on a day at x1.02. That is the resource
// model at work (readiness multiplies what everything else yields), not a missed cap.
// Each log entry carries `grants[].base` (after the cap) and `mult`, so the arithmetic is visible.
export const XP_CAPS = { appliedTo: "base XP, before the readiness multiplier", multiplierMin: 0.75, multiplierMax: 1.25 };
// ---------------------------------------------------------------------------------------------
// XP table. Volume-based: these pay for how much was done. Thresholds (hit the goal, hit the
// target) are quests, further down, so nothing is paid twice.
// `fact` is what the rule reads, `xp(f)` the base amount before the readiness multiplier.
// ---------------------------------------------------------------------------------------------
const n = v => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export const TASK_PRIORITY_XP = [
  // matched against the task's priority text, first hit wins
  { match: /one thing|⭐/i, xp: 60, label: "⭐ One Thing" },
  { match: /urgent|highest|p0|p1|high/i, xp: 30, label: "High" },
  { match: /medium|normal|p2/i, xp: 20, label: "Medium" },
  { match: /low|p3|someday/i, xp: 10, label: "Low" },
  { match: /.*/, xp: 15, label: "(no priority)" },
];
export function taskXp(t) {
  if (t.oneThing) return TASK_PRIORITY_XP[0].xp;
  const p = String(t.priority || "");
  if (!p) return 15;
  return TASK_PRIORITY_XP.find(r => r.match.test(p)).xp;
}
export const CONNECTION_ROLES = ["partner", "family", "close"]; // touches with these go to Connection, others to People

export const XP_RULES = [
  // ---- Body
  { id: "steps", cap: 20,     fact: "steps",    area: "body", rule: "1 XP per 1,000 steps, max 20 a day",
    xp: f => Math.min(20, Math.floor(n(f.steps) / 1000)) },
  { id: "sleep", cap: 16,     fact: "sleep",    area: "body", rule: "2 XP per hour asleep, counted up to 8 h (max 16)",
    xp: f => Math.floor(Math.min(8, n(f.hours)) * 2) },
  { id: "deep", cap: 4,      fact: "sleep",    area: "body", rule: "+4 XP for 1.5 h or more of deep sleep",
    xp: f => (n(f.deepHours) >= 1.5 ? 4 : 0) },
  { id: "food-log", cap: 5,  fact: "food",     area: "body", rule: "5 XP for a day with the food diary kept (3+ rows, or totals on record)",
    xp: f => ((f.rows == null ? n(f.kcal) > 0 : f.rows >= 3) ? 5 : 0) },
  { id: "protein", cap: 10,   fact: "food",     area: "body", rule: "1 XP per 20 g protein, counted up to the day's target (150 g if no target), max 10",
    xp: f => Math.min(10, Math.floor(Math.min(n(f.protein), n(f.target && f.target.protein) || 150) / 20)) },
  { id: "workout", cap: 40,   fact: "workout",  area: "body", rule: "40 XP for a workout marked done; a gym check-in on its own also counts",
    xp: f => (f.status === "done" || f.gym ? 40 : 0) },
  { id: "gym", cap: 10,       fact: "workout",  area: "body", rule: "+10 XP when the gym door logged the visit",
    xp: f => (f.gym ? 10 : 0) },
  { id: "weigh", cap: 5,     fact: "weight",   area: "body", rule: "5 XP for stepping on the scale that day",
    xp: () => 5 },
  { id: "exercise", cap: 6,  fact: "heart",    area: "body", rule: "1 XP per 10 exercise minutes (watch), max 6",
    xp: f => Math.min(6, Math.floor(n(f.exerciseMin) / 10)) },
  // ---- Mind
  { id: "focus", cap: 18,     fact: "focus",    area: "mind", rule: "1 XP per 10 minutes of timed focus, max 18 a day",
    xp: f => Math.min(18, Math.floor(n(f.minutes) / 10)) },
  { id: "mindful", cap: 6,   fact: "mindful",  area: "mind", rule: "1 XP per 5 mindful minutes (device or app record), max 6 a day",
    xp: f => Math.min(6, Math.floor(n(f.minutes) / 5)) },
  { id: "learn", cap: 12,     fact: "learn",    area: "growth", rule: "1 XP per 10 minutes of reading, course or practice on record, max 12 a day",
    xp: f => Math.min(12, Math.floor(n(f.minutes) / 10)) },
  { id: "support", cap: 30,   fact: "support",  area: "impact", rule: "15 XP for support given to someone, on record (max 2 a day)",
    xp: f => 15 * Math.min(2, n(f.count)) },
  // ---- Tasks (area = the task's own Area; Strategy when it has none)
  { id: "task", cap: 60,      fact: "task",     area: null,   rule: "Task done: ⭐ One Thing 60, High 30, Medium 20, Low 10, no priority 15. XP goes to the task's Area",
    xp: f => taskXp(f) },
  { id: "checklist", cap: 40, fact: "checklist", area: "strategy", rule: "8 XP per item ticked on the One Thing day checklist, max 40",
    xp: f => Math.min(40, 8 * n(f.done)) },
  // ---- Wealth
  { id: "income", cap: 150,    fact: "income",   area: "wealth", rule: "1 XP per $100 of income received, max 150 per payment",
    xp: f => Math.min(150, Math.floor(n(f.amountUsd) / 100)) },
  // ---- World
  { id: "new-place", cap: 20,   fact: "newPlace",   area: "joy",    rule: "20 XP the first time a place is reached",
    xp: () => 20 },
  { id: "new-country", cap: 100, fact: "newCountry", area: "growth", rule: "100 XP the first time a country is entered",
    xp: () => 100 },
  // ---- Things
  { id: "item", cap: 4,      fact: "item",     area: "things", rule: "2 XP for a belonging put on record, +1 with a photo, +1 with a value",
    xp: f => 2 + (f.img ? 1 : 0) + (f.valueUsd != null ? 1 : 0) },
  { id: "item-out", cap: 5,  fact: "itemOut",  area: "things", rule: "5 XP when a belonging is sold, given away or let go",
    xp: () => 5 },
  // ---- People and Connection
  { id: "touch", cap: 4,     fact: "touch",    area: null,   rule: "4 XP per person in touch with that day (max 6 people); partner / family / close go to Connection, others to People",
    xp: () => 4 },
  { id: "reconnect", cap: 10, fact: "touch",    area: null,   rule: "+10 XP when it is the first contact with that person in 30 days or more",
    xp: f => (f.gapDays != null && f.gapDays >= 30 ? 10 : 0) },
];
// Manual input: an event whose `source` is "manual" or starts with "manual:" (voice, ring note,
// keypad) moves meters, needs and the log, and grants no XP under the rules for tasks, the
// checklist, income, places, items, contacts, focus, mindful minutes, learning and support.
// The body rules (steps, sleep, food, workout, weight, exercise) read sensor facts and score them
// whatever their source; /api/act cannot create those. A mood check-in and a note never grant XP.
// BTC price, weather, fleet health and balances are state, not deeds: no XP.
export const isManual = source => /^manual(:|$)/i.test(String(source || ""));

// ---------------------------------------------------------------------------------------------
// Vitals. Each bar is 0..100, or null with stale:true when its inputs are missing.
// Formulas live in src/reduce.js (vitalsAt); the numbers they use are here.
// ---------------------------------------------------------------------------------------------
export const VITALS = {
  health: {
    label: "Health",
    how: "Seven-day picture: sleep (avg hours / 8), HRV and resting HR against the 30-day medians, movement (avg steps / goal), fuel (share of logged days at 90%+ of protein target). Weighted mean of the parts that have data; needs two or more.",
    weights: { sleep: 0.25, hrv: 0.2, rhr: 0.15, move: 0.2, fuel: 0.2 }, windowDays: 7, minParts: 2, staleAfterH: 48,
  },
  energy: {
    label: "Energy",
    how: "Today's readiness: last night's sleep (50%), today's HRV (30%) and resting HR (20%) against the player's own baseline. Needs last night's sleep or today's HRV.",
    staleAfterH: 30,
  },
  stamina: {
    label: "Stamina",
    how: "Steps today / step goal.", staleAfterH: 6,
  },
  fuel: {
    label: "Fuel",
    how: "Today against the day's food target: 60% protein (protein / target, capped) + 40% calories (kcal / target up to the target; each 1% over costs 2%). Null when no target is set for the day.",
    proteinShare: 0.6, staleAfterH: 30,
  },
  focus: {
    label: "Focus",
    how: "Timed focus minutes today / 180.", targetMin: 180, staleAfterH: 30,
  },
  gold: {
    label: "Gold",
    how: "Runway in days (liquid gold / burn per day) against 180 days.", fullRunwayDays: 180, staleAfterH: 48,
  },
};

// ---------------------------------------------------------------------------------------------
// Meters: the nine quick-glance % bars of the original sketch (docs/DESIGN.md), in its order. Same honesty rule:
// value 0..100, or null with stale:true until a real input exists.
// Formulas in src/reduce.js (metersAt); numbers here.
// ---------------------------------------------------------------------------------------------
export const METERS = [
  { id: "money",     label: "Money",     detail: "cashflow",
    how: "Cashflow health: 60% income against burn (monthly income / monthly burn, 1.5x or better = full) + 40% runway (days / 180). Uses whichever part has data.",
    cashflowShare: 0.6, cashflowFull: 1.5, runwayFullDays: 180, staleAfterH: 48 },
  { id: "energy",    label: "Energy",    detail: "readiness",
    how: "Today's HRV (50%) and resting HR (30%) against the 30-day medians, plus yesterday's active energy against its 30-day median (20%). Weighted over the parts present.",
    weights: { hrv: 0.5, rhr: 0.3, active: 0.2 }, staleAfterH: 30 },
  { id: "sleep",     label: "Sleep",     detail: "last night",
    how: "Hours slept last night as a share of an 8 h need.", needH: 8, staleAfterH: 30 },
  { id: "social",    label: "Social",    detail: "interactions cup",
    how: "70% how many different people the player was in touch with in the last 7 days (7 = full) + 30% recency (full today, empty after 3 days).",
    peopleFull: 7, recencyDays: 3, staleAfterH: 96 },
  { id: "care",      label: "Personal care", detail: "body upkeep",
    how: "Last 7 days: weigh-ins (3 = full), workouts (3 = full), days at 90%+ protein (5 = full), days within 10% of calories (5 = full). Mean of the parts that have a live feed.",
    weighFull: 3, workoutFull: 3, proteinFull: 5, kcalFull: 5, staleAfterH: 96 },
  { id: "happiness", label: "Happiness", detail: "mood check-ins",
    how: "Average mood (1 to 10) of `checkin` events over the last 3 days, x10.", windowDays: 3, staleAfterH: 72 },
  { id: "self",      label: "Self",      detail: "connection with self",
    how: "Mindful minutes (`mindful` events) over the last 7 days against 70.", fullMin: 70, staleAfterH: 96 },
  { id: "giving",    label: "Giving",    detail: "support given",
    how: "`support.given` events over the last 30 days against 4.", full: 4, staleAfterH: 24 * 30 },
  { id: "learning",  label: "Learning",  detail: "expansion",
    how: "Learning minutes (`learn` events) over the last 7 days against 210.", fullMin: 210, staleAfterH: 96 },
];

// ---------------------------------------------------------------------------------------------
// Place needs. "To help me rebuild all my needs whenever I travel... to know what quests /
// systems to build out in what order." (docs/DESIGN.md) When a place.arrive puts the player in a different city, these
// reset to unknown for that city and are issued as rebuild quests in this (pyramid) order.
// `auto` names the data that completes one without anyone typing anything; every one of them
// can also be settled by a `need.ok` event (or a `note` carrying `need`), which is manual and
// therefore completes the quest without XP.
// ---------------------------------------------------------------------------------------------
export const PLACE_NEEDS = [
  { id: "water",         tier: 1, label: "Drinking water", quest: "Secure drinking water",     area: "body",     auto: null },
  { id: "food-supply",   tier: 1, label: "Food supply",    quest: "Set up the food supply",     area: "body",     auto: "food diary kept on 2 days since arriving" },
  { id: "air",           tier: 1, label: "Air quality",    quest: "Check the air",              area: "body",     auto: "open-meteo air quality at the place: US AQI up to 100 ok, up to 150 warn, above bad" },
  { id: "gym",           tier: 1, label: "Gym",            quest: "Find a place to train",      area: "body",     auto: "a workout logged since arriving" },
  { id: "accommodation", tier: 2, label: "Accommodation",  quest: "Settle the base",            area: "things",   auto: "the place is marked home, or 3 nights of sleep recorded since arriving" },
  { id: "visa",          tier: 2, label: "Visa",           quest: "Sort the visa",              area: "strategy", auto: "a `visa` event for the country: valid 14+ days ok, under 14 warn, expired bad" },
  { id: "internet",      tier: 2, label: "Internet",       quest: "Get reliable internet",      area: "strategy", auto: null },
  { id: "laundry",       tier: 2, label: "Laundry",        quest: "Find laundry",               area: "things",   auto: null },
];
export const PLACE_NEED_XP = 20;   // per rebuild quest completed from data (not from a manual need.ok)
export const AQI_BANDS = { ok: 100, warn: 150 };
export const VISA_WARN_DAYS = 14;

// Quest categories of the original sketch (docs/DESIGN.md), by area.
export const QUEST_CATEGORY = {
  body: "Health", wealth: "Wealth", people: "Relationships", connection: "Relationships",
  impact: "Spiritual", growth: "Learning / Skills", mind: "Learning / Skills", strategy: "Wealth",
  joy: "Hobbies", things: "Hobbies",
};

// How many open tasks ride in the state document as side quests (the rest: GET /api/tasks).
export const SIDE_TASKS_MAX = 100;

// Treasury numbers.
export const TREASURY = {
  liquidKinds: ["cash", "crypto"],   // gold = cash + crypto - debt; `asset` is shown but not counted as gold
  balanceStaleDays: 4,               // an account with no snapshot for this long drops out of gold (and gold goes stale)
  burnWindowDays: 30,                // burn from transactions = expenses over the last 30 days / 30
  burnMinTxnDays: 14,                // ...only once there are 14 days of transactions; before that the budget's fixed costs are used
  burnOrder: ["money.burn event (collector's own figure)", "expense transactions, last 30 days", "money.budget fixed costs per month / 30.44"],
};

// The fixed roster: the player ("gun": the id stays whatever the player is called, the name comes from OWNER_NAME or a
// profile.set event), the AI companion and the guild. A contact whose role is "partner" joins the roster under its own
// contact id (at most MAX_PARTNERS), and so do squad members with a stored portrait (src/reduce.js).
// Each entry may have static files. A field appears in state only when the file is actually deployed (src/world.js
// checks the static assets); an entry without a model simply has none.
export const PLAYER_ID = "gun", COMPANION_ID = "companion", GUILD_ID = "guild";
export const ROSTER_IDS = [PLAYER_ID, COMPANION_ID, GUILD_ID];
export const MAX_PARTNERS = 3;
export const ROSTER_DEFAULTS = { player: "Player", companion: "Companion", guild: "Guild" };
export const rosterAssets = id => ({ model: "/models/" + id + ".glb", modelLite: "/models/" + id + "-lite.glb", portrait: "/img/" + id + ".webp", portraitFull: "/img/" + id + "-full.webp" });

// Item rarity when the record does not carry one: by replacement value in USD.
export const RARITY_BY_VALUE = [
  [2500, "legendary"], [800, "epic"], [200, "rare"], [50, "uncommon"], [0, "common"],
];
export const EQUIP_SLOTS = ["head", "chest", "legs", "feet", "wrist", "finger", "back", "neck", "mainhand", "offhand", "trinket1", "trinket2", "vehicle"];

// ---------------------------------------------------------------------------------------------
// Buffs and debuffs. `when` is evaluated on today's facts; each returns null (not active)
// or { detail, since?, until? }. See src/reduce.js `buffsAt` for the context object.
// ---------------------------------------------------------------------------------------------
export const BUFFS = [
  { id: "well-rested", kind: "buff", label: "Well rested", icon: "moon", rule: "7.5 h or more last night",
    when: c => c.sleep && c.sleep.hours >= 7.5 && { detail: c.fmtH(c.sleep.hours) + " last night" } },
  { id: "deep-recovery", kind: "buff", label: "Deep recovery", icon: "wave", rule: "1.5 h or more deep sleep last night",
    when: c => c.sleep && c.sleep.deepHours >= 1.5 && { detail: c.fmtH(c.sleep.deepHours) + " deep sleep" } },
  { id: "sleep-debt", kind: "debuff", label: "Sleep debt", icon: "moon-low", rule: "under 6 h last night, or under 6.5 h average over the last 3 nights",
    when: c => (c.sleep && c.sleep.hours < 6 && { detail: c.fmtH(c.sleep.hours) + " last night" }) ||
               (c.sleep3 != null && c.sleep3 < 6.5 && { detail: c.fmtH(c.sleep3) + " average, last 3 nights" }) },
  { id: "primed", kind: "buff", label: "Primed", icon: "bolt", rule: "readiness 80 or more: all XP today is multiplied up",
    when: c => c.readiness != null && c.readiness >= 80 && { detail: "Readiness " + c.readiness + " · XP ×" + c.mult.toFixed(2) } },
  { id: "drained", kind: "debuff", label: "Drained", icon: "bolt-low", rule: "readiness under 45: all XP today is multiplied down",
    when: c => c.readiness != null && c.readiness < 45 && { detail: "Readiness " + c.readiness + " · XP ×" + c.mult.toFixed(2) } },
  { id: "on-the-move", kind: "buff", label: "On the move", icon: "boot", rule: "step goal reached today",
    when: c => c.steps && c.steps.goal && c.steps.steps >= c.steps.goal && { detail: c.int(c.steps.steps) + " steps" } },
  { id: "momentum", kind: "buff", label: "Momentum", icon: "flame", rule: "step goal reached 3 or more days running",
    when: c => c.stepStreak >= 3 && { detail: c.stepStreak + " days at goal in a row" } },
  { id: "sedentary", kind: "debuff", label: "Sedentary", icon: "chair", rule: "under 5,000 steps on each of the last 2 finished days",
    when: c => c.lowStepDays >= 2 && { detail: "Under 5,000 steps " + c.lowStepDays + " days running" } },
  { id: "pumped", kind: "buff", label: "Pumped", icon: "dumbbell", rule: "trained today or yesterday",
    when: c => c.daysSinceWorkout != null && c.daysSinceWorkout <= 1 && { detail: c.daysSinceWorkout === 0 ? "Trained today" : "Trained yesterday" } },
  { id: "rusty", kind: "debuff", label: "Rusty", icon: "rust", rule: "no workout for 7 days or more",
    when: c => c.daysSinceWorkout != null && c.daysSinceWorkout >= 7 && { detail: c.daysSinceWorkout + " days since the last workout" } },
  { id: "well-fed", kind: "buff", label: "Well fed", icon: "meat", rule: "protein at 90%+ of target today or yesterday",
    when: c => c.proteinHit && { detail: c.proteinHit } },
  { id: "running-on-empty", kind: "debuff", label: "Running on empty", icon: "bowl", rule: "after 15:00 local with nothing in today's food diary (only while the diary is in use)",
    when: c => c.foodLive && !c.food && c.localHour >= 15 && { detail: "Nothing logged today" } },
  { id: "explorer", kind: "buff", label: "Explorer", icon: "compass", rule: "reached a new place in the last 72 hours",
    when: c => c.newPlaceHours != null && c.newPlaceHours <= 72 && { detail: "New ground: " + c.newPlaceName } },
  { id: "jet-lag", kind: "debuff", label: "Jet lag", icon: "plane", rule: "changed time zone by 3 hours or more in the last 3 days",
    when: c => c.tzShiftHours != null && Math.abs(c.tzShiftHours) >= 3 && c.tzShiftDays <= 3 && { detail: (c.tzShiftHours > 0 ? "+" : "") + c.tzShiftHours + " h time zone shift" } },
  { id: "flush", kind: "buff", label: "War chest", icon: "coins", rule: "runway of 180 days or more",
    when: c => c.runwayDays != null && c.runwayDays >= 180 && { detail: Math.round(c.runwayDays) + " days of runway" } },
  { id: "low-runway", kind: "debuff", label: "Thin purse", icon: "coins-low", rule: "runway under 60 days",
    when: c => c.runwayDays != null && c.runwayDays < 60 && { detail: Math.round(c.runwayDays) + " days of runway" } },
  { id: "crypto-winter", kind: "debuff", label: "Crypto winter", icon: "snow", rule: "BTC in a bear phase (world effect)",
    when: c => c.btc && c.btc.phase === "bear" && { detail: "BTC " + c.btc.drawdownPct + "% from its high · bear " + c.btc.phaseDays + " d" } },
  { id: "bull-run", kind: "buff", label: "Bull run", icon: "sun", rule: "BTC in a bull phase (world effect)",
    when: c => c.btc && c.btc.phase === "bull" && { detail: "BTC bull " + c.btc.phaseDays + " d" } },
];

// ---------------------------------------------------------------------------------------------
// Quests. All complete automatically from data. `eval(day)` returns null when the day has no
// signal for that quest, else { cur, max, unit, done? }. done defaults to cur >= max.
// tier = the needs tier the quest serves (see NEEDS).
// ---------------------------------------------------------------------------------------------
// The main quest is whatever the newest `quest.progress` event says it is: its `title`, its `text` and its numbers.
// `title` and `text` below stand in until an event supplies them. No event = progress null.
export const MAIN_QUEST = {
  id: "main",
  title: "Main quest",
  text: "The one objective that matters most right now. Name it and report its progress with quest.progress events.",
  giver: "The realm",
  area: "wealth", tier: 2,
  anchorXp: 500,        // each anchor reached on or before its date
  completeXp: 5000,     // target reached
};

const r1 = v => Math.round(v * 10) / 10;
export const DAILY_QUESTS = [
  { id: "walk", title: "Walk the realm", text: "Reach the step goal.", area: "body", tier: 1, xp: 15, signal: "steps",
    eval: d => d.steps && d.steps.goal ? { cur: d.steps.steps, max: d.steps.goal, unit: "steps" } : null },
  { id: "rest", title: "Rest at the inn", text: "Sleep 7 hours or more.", area: "body", tier: 1, xp: 15, signal: "sleep",
    eval: d => d.sleep ? { cur: r1(d.sleep.hours), max: 7, unit: "h" } : null },
  { id: "protein", title: "Feed the warrior", text: "Reach 90% of the day's protein target.", area: "body", tier: 1, xp: 15, signal: "food",
    eval: d => d.food && d.food.target && d.food.target.protein ? { cur: Math.round(d.food.protein), max: Math.round(d.food.target.protein * 0.9), unit: "g" } : null },
  { id: "kcal", title: "Hold the line", text: "Finish the day within 10% of the calorie target.", area: "body", tier: 1, xp: 10, signal: "food", closesWithDay: true,
    eval: d => d.food && d.food.target && d.food.target.kcal
      ? { cur: Math.round(d.food.kcal), max: Math.round(d.food.target.kcal), unit: "kcal", done: Math.abs(d.food.kcal - d.food.target.kcal) <= 0.1 * d.food.target.kcal } : null },
  { id: "one-thing", title: "The One Thing", text: "Finish today's ⭐ One Thing, or tick the whole day checklist.", area: "strategy", tier: 2, xp: 30, signal: "tasks",
    eval: d => d.tasksLive ? { cur: (d.tasksDone.some(t => t.oneThing) || (d.checklist && d.checklist.total > 0 && d.checklist.done >= d.checklist.total)) ? 1 : 0, max: 1, unit: "" } : null },
  { id: "clear-a-quest", title: "Clear a quest", text: "Complete any task.", area: "strategy", tier: 4, xp: 10, signal: "tasks",
    eval: d => d.tasksLive ? { cur: d.tasksDone.length, max: 1, unit: "tasks" } : null },
  { id: "reach-out", title: "Reach out", text: "Be in touch with someone who matters.", area: "connection", tier: 3, xp: 10, signal: "contacts",
    eval: d => d.contactsLive ? { cur: d.touches.length, max: 1, unit: "people" } : null },
];

// Weekly quests run Monday to Sunday (local date). `eval(week)` gets the week's days in order.
const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
export const WEEKLY_QUESTS = [
  { id: "iron-week", title: "Iron week", text: "Train 3 times this week.", area: "body", tier: 1, xp: 60, signal: "workouts",
    eval: w => w.workoutsLive ? { cur: w.days.filter(d => d.workout && (d.workout.status === "done" || d.workout.gym)).length, max: 3, unit: "workouts" } : null },
  { id: "long-road", title: "The long road", text: "Walk 7 days' worth of step goal this week.", area: "body", tier: 1, xp: 50, signal: "steps",
    eval: w => w.goal && w.days.some(d => d.steps) ? { cur: sum(w.days, d => d.steps && d.steps.steps), max: 7 * w.goal, unit: "steps" } : null },
  { id: "sleep-bank", title: "Sleep bank", text: "Average 7 hours or more over at least 5 recorded nights.", area: "body", tier: 1, xp: 40, signal: "sleep", closesWithWeek: true,
    eval: w => { const s = w.days.filter(d => d.sleep); if (!s.length) return null; const avg = sum(s, d => d.sleep.hours) / s.length;
      return { cur: r1(avg), max: 7, unit: "h avg", done: s.length >= 5 && avg >= 7 }; } },
  { id: "fuel-discipline", title: "Fuel discipline", text: "Reach 90% of the protein target on 5 days.", area: "body", tier: 1, xp: 40, signal: "food",
    eval: w => w.days.some(d => d.food && d.food.target) ? { cur: w.days.filter(d => d.food && d.food.target && d.food.target.protein && d.food.protein >= 0.9 * d.food.target.protein).length, max: 5, unit: "days" } : null },
  { id: "on-the-scale", title: "Know your weight", text: "Step on the scale 3 days this week.", area: "body", tier: 1, xp: 20, signal: "weight",
    eval: w => w.weightLive ? { cur: w.days.filter(d => d.weight).length, max: 3, unit: "weigh-ins" } : null },
  { id: "treasury-grows", title: "The treasury grows", text: "End the week with more gold than it started with.", area: "wealth", tier: 2, xp: 60, signal: "money", closesWithWeek: true,
    eval: w => w.goldStart != null && w.goldEnd != null ? { cur: Math.round(w.goldEnd - w.goldStart), max: 1, unit: "USD", done: w.goldEnd > w.goldStart } : null },
  { id: "ship-it", title: "Ship it", text: "Complete 10 tasks this week.", area: "strategy", tier: 4, xp: 60, signal: "tasks",
    eval: w => w.tasksLive ? { cur: sum(w.days, d => d.tasksDone.length), max: 10, unit: "tasks" } : null },
  { id: "tend-the-network", title: "Tend the network", text: "Be in touch with 5 different people this week.", area: "people", tier: 3, xp: 40, signal: "contacts",
    eval: w => w.contactsLive ? { cur: new Set(w.days.flatMap(d => d.touches.map(t => t.contactId))).size, max: 5, unit: "people" } : null },
  { id: "new-ground", title: "New ground", text: "Set foot somewhere new this week.", area: "joy", tier: 6, xp: 30, signal: "place",
    eval: w => w.placesLive ? { cur: sum(w.days, d => d.newPlaces.length), max: 1, unit: "places" } : null },
];

// ---------------------------------------------------------------------------------------------
// Streaks. `hit(day)` for daily ones, `hit(weekDays)` for weekly ones (Monday to Sunday).
// A run is consecutive days (or weeks) that each have a confirmed hit; a day with no data ends
// the run, because it cannot be confirmed. The day (or week) in progress never breaks a run: it
// extends it once the mark is reached. `metric` feeds the matching achievements.
// ---------------------------------------------------------------------------------------------
const trained = d => !!(d.workout && (d.workout.status === "done" || d.workout.gym));
export const STREAKS = [
  { id: "steps-goal",    label: "Step goal",             period: "day",  unit: "days",  metric: "stepStreak",
    rule: "steps at or over the goal", hit: d => !!(d.steps && d.steps.goal && d.steps.steps >= d.steps.goal) },
  { id: "protein",       label: "Protein target",        period: "day",  unit: "days",  metric: "proteinStreak",
    rule: "protein at 90% or more of the day's target", hit: d => !!(d.food && d.food.target && d.food.target.protein && d.food.protein >= 0.9 * d.food.target.protein) },
  { id: "diary",         label: "Food diary kept",       period: "day",  unit: "days",
    rule: "3 or more rows in the diary (or totals on record)", hit: d => !!(d.food && (d.food.rows == null ? d.food.kcal > 0 : d.food.rows >= 3)) },
  { id: "sleep",         label: "Sleep target",          period: "day",  unit: "nights", metric: "sleepStreak",
    rule: "7 hours or more", hit: d => !!(d.sleep && d.sleep.hours >= 7) },
  { id: "workouts-week", label: "Three workouts a week", period: "week", unit: "weeks",
    rule: "3 or more workouts in the week", hit: w => w.filter(trained).length >= 3 },
  { id: "weigh-ins",     label: "Three weigh-ins a week", period: "week", unit: "weeks",
    rule: "on the scale 3 or more days in the week", hit: w => w.filter(d => d.weight).length >= 3 },
];

// Bond with a person: shown only on positive evidence. It is built from the days the player was
// in touch with them over the last 30; with none in that window it is null (no signal), never a
// low number, because silence on the channels a collector can see proves nothing. A partner's
// bond and last contact are always null: messages are not how people who live together keep in touch.
export const BOND = { windowDays: 30, recencyShare: 0.6, fullTouchDays: 8, noSignalRoles: ["partner"] };

// ---------------------------------------------------------------------------------------------
// Activity mirror: what the player is doing right now, for the character in the world view. Read from
// the most direct evidence first; `basis` always says which. Nothing here grants XP.
//   1 celebrating  a character level-up or a main-quest anchor, for a couple of minutes after the engine saw it
//   2 stated       an `activity` event still running (said by the player, or reported by a device)
//   3 training     a recorded workout in progress right now (the phone)
//   4 walking      steps arriving in the last few minutes at a walking cadence (the steps feed's snapshot)
//   5 training     a gym check-in within the last 90 minutes, or a workout finished or marked done in the last 20
//   6 eating       a row added to today's food diary in the last 20 minutes
//   7 working      a focus block that is running, or the player's own activity in an AI session in the last 10 minutes
//   8 sleeping     inferred only: inside the usual sleep window with no steps since the phone last checked in
//   9 idle         the phone has checked in recently and none of the above holds
//  10 null         the feeds are too old to say anything
// ---------------------------------------------------------------------------------------------
export const ACTIVITY = {
  names: ["idle", "walking", "training", "sleeping", "working", "eating", "celebrating"],
  stated: ["idle", "walking", "training", "sleeping", "working", "eating"],          // what an `activity` event may say
  statedMinutes: { training: 75, eating: 30, working: 90, walking: 30, sleeping: 480 }, // how long a stated activity stands when no `minutes` is given
  celebrateSec: 150,
  walkCadence: 60, walkMinSteps: 100, walkFreshMin: 10,   // steps per minute over the newly observed span; samples must reach into the last 10 minutes
  gymMin: 90, loggedMin: 20, eatMin: 20, workMin: 10,
  feedFreshMin: 15,          // the steps adapter must have polled this recently for anything to be said from steps
  seenFreshMin: 60,          // "idle" needs the phone to have checked in within the hour
  sleepStillMin: 45,         // no steps for at least this long before the phone's last check-in
  sleepSeenMaxMin: 240,      // ...and that check-in is at most this old
  sleepMarginH: 1,           // the usual sleep window = the average night around the day boundary (mid-sleep), plus this margin each side
  sleepMinNights: 3,
};

// A recorded workout session (from the phone's health data) counts as the day's workout when it ran
// 20 minutes or more and is not a walk (walking is already paid in steps).
export const WORKOUT = { minMinutes: 20, notTraining: ["walking", "walk", "wheelchair walk pace"], inProgressMaxH: 4 };
export const countsAsWorkout = s => (s.minutes || 0) >= WORKOUT.minMinutes && !WORKOUT.notTraining.includes(String(s.kind || "").toLowerCase());
// Two place.arrive events closer than this are the same stay, whatever each geocoder calls the spot
// (a phone and a location tracker name places differently): no new city, no place-need reset, no second "new ground".
export const PLACE = { sameStayKm: 5 };

// Day grade: share of the day's quests that had a signal and were completed.
// Today has no grade until something is done (an unfinished morning is not an F).
export const GRADES = [
  { grade: "S", min: 1.0, minQuests: 4 },   // every quest, and at least four of them had a signal
  { grade: "A", min: 0.8 },
  { grade: "B", min: 0.6 },
  { grade: "C", min: 0.4 },
  { grade: "D", min: 0.01 },
  { grade: "F", min: 0 },
];
export function gradeFor(done, total) {
  if (!total) return null;
  const share = done / total;
  for (const g of GRADES) if (share >= g.min && (!g.minQuests || total >= g.minQuests)) return g.grade;
  return "F";
}

// ---------------------------------------------------------------------------------------------
// Achievements. Each watches a running counter in the replay and is dated the day it is first
// reached. Trophies only: no XP.
// ---------------------------------------------------------------------------------------------
export const ACHIEVEMENTS = [
  { id: "first-steps",   metric: "stepDays",      at: 1,        rarity: "common",    title: "First steps",          detail: "The first day of steps on record" },
  { id: "steps-10k",     metric: "dayStepsMax",   at: 10000,    rarity: "common",    title: "Ten thousand",         detail: "A 10,000-step day" },
  { id: "steps-20k",     metric: "dayStepsMax",   at: 20000,    rarity: "rare",      title: "Twenty thousand",      detail: "A 20,000-step day" },
  { id: "steps-30k",     metric: "dayStepsMax",   at: 30000,    rarity: "epic",      title: "Thirty thousand",      detail: "A 30,000-step day" },
  { id: "steps-1m",      metric: "stepsTotal",    at: 1000000,  rarity: "uncommon",  title: "A million steps",      detail: "1,000,000 steps on record" },
  { id: "steps-3m",      metric: "stepsTotal",    at: 3000000,  rarity: "rare",      title: "Three million steps",  detail: "3,000,000 steps on record" },
  { id: "steps-10m",     metric: "stepsTotal",    at: 10000000, rarity: "epic",      title: "Ten million steps",    detail: "10,000,000 steps on record" },
  { id: "streak-7",      metric: "stepStreak",    at: 7,        rarity: "uncommon",  title: "Seven-day march",      detail: "Step goal 7 days running" },
  { id: "streak-30",     metric: "stepStreak",    at: 30,       rarity: "rare",      title: "Thirty-day march",     detail: "Step goal 30 days running" },
  { id: "streak-100",    metric: "stepStreak",    at: 100,      rarity: "epic",      title: "Hundred-day march",    detail: "Step goal 100 days running" },
  { id: "workouts-10",   metric: "workouts",      at: 10,       rarity: "common",    title: "Ten sessions",         detail: "10 workouts on record" },
  { id: "workouts-50",   metric: "workouts",      at: 50,       rarity: "rare",      title: "Fifty sessions",       detail: "50 workouts on record" },
  { id: "workouts-100",  metric: "workouts",      at: 100,      rarity: "epic",      title: "Hundred sessions",     detail: "100 workouts on record" },
  { id: "sleep-7",       metric: "sleepStreak",   at: 7,        rarity: "uncommon",  title: "A week of sleep",      detail: "7 nights of 7 h or more in a row" },
  { id: "protein-7",     metric: "proteinStreak", at: 7,        rarity: "uncommon",  title: "A week well fed",      detail: "Protein target 7 days running" },
  { id: "weighins-30",   metric: "weighIns",      at: 30,       rarity: "common",    title: "Thirty weigh-ins",     detail: "30 days on the scale" },
  { id: "goal-weight",   metric: "goalWeight",    at: 1,        rarity: "epic",      title: "Fighting weight",      detail: "Goal weight reached" },
  { id: "goal-bodyfat",  metric: "goalBodyFat",   at: 1,        rarity: "legendary", title: "Carved",               detail: "Goal body fat reached" },
  { id: "perfect-day",   metric: "perfectDays",   at: 1,        rarity: "rare",      title: "Perfect day",          detail: "An S-grade day" },
  { id: "perfect-10",    metric: "perfectDays",   at: 10,       rarity: "epic",      title: "Ten perfect days",     detail: "10 S-grade days" },
  { id: "tasks-100",     metric: "tasksDone",     at: 100,      rarity: "uncommon",  title: "Hundred quests",       detail: "100 tasks completed" },
  { id: "tasks-1000",    metric: "tasksDone",     at: 1000,     rarity: "epic",      title: "Thousand quests",      detail: "1,000 tasks completed" },
  { id: "places-10",     metric: "places",        at: 10,       rarity: "common",    title: "Cartographer",         detail: "10 places reached" },
  { id: "countries-5",   metric: "countries",     at: 5,        rarity: "uncommon",  title: "Five flags",           detail: "5 countries entered" },
  { id: "countries-10",  metric: "countries",     at: 10,       rarity: "rare",      title: "Ten flags",            detail: "10 countries entered" },
  { id: "countries-25",  metric: "countries",     at: 25,       rarity: "epic",      title: "Twenty-five flags",    detail: "25 countries entered" },
  { id: "items-100",     metric: "items",         at: 100,      rarity: "uncommon",  title: "Quartermaster",        detail: "100 belongings on record" },
  { id: "anchor-1",      metric: "anchors",       at: 1,        rarity: "rare",      title: "First anchor",         detail: "A main-quest anchor reached on time" },
  { id: "main-quest",    metric: "mainQuestDone", at: 1,        rarity: "legendary", title: "Stable ground",        detail: "Main quest complete" },
  { id: "level-10",      metric: "level",         at: 10,       rarity: "common",    title: "Level 10",             detail: "Reached level 10" },
  { id: "level-20",      metric: "level",         at: 20,       rarity: "uncommon",  title: "Level 20",             detail: "Reached level 20" },
  { id: "level-30",      metric: "level",         at: 30,       rarity: "rare",      title: "Level 30",             detail: "Reached level 30" },
  { id: "level-40",      metric: "level",         at: 40,       rarity: "epic",      title: "Level 40",             detail: "Reached level 40" },
  { id: "level-50",      metric: "level",         at: 50,       rarity: "epic",      title: "Level 50",             detail: "Reached level 50" },
  { id: "level-60",      metric: "level",         at: 60,       rarity: "legendary", title: "The Legend of Gun",    detail: "Reached level 60" },
];

// ---------------------------------------------------------------------------------------------
// Needs hierarchy: growth needs unlock once deficiency needs are handled.
// A tier is ok / warn / bad from its items, or unknown when none of its items has a signal.
// Tier N is unlocked only when every tier below it is ok or warn. Unknown does not unlock:
// a need with no signal has not been shown to be handled.
// Item checks live in src/reduce.js (needItems); thresholds are here. The place needs (PLACE_NEEDS)
// for the current city are added to tiers 1 and 2; one that is still unknown there holds its
// tier at warn until it is rebuilt.
// ---------------------------------------------------------------------------------------------
export const NEEDS = [
  { tier: 1, label: "Biological",         kind: "deficiency", items: ["sleep", "food", "movement", "recovery"] },
  { tier: 2, label: "Safety and Freedom", kind: "deficiency", items: ["runway", "income", "systems"] },
  { tier: 3, label: "Love and Belonging", kind: "deficiency", items: ["partner", "circle"] },
  { tier: 4, label: "Esteem",             kind: "deficiency", items: ["momentum", "body-goal"] },
  { tier: 5, label: "Cognitive",          kind: "growth",     items: ["deep-work", "learning"] },
  { tier: 6, label: "Aesthetic",          kind: "growth",     items: ["geared", "joy"] },
  { tier: 7, label: "Self-Actualisation", kind: "growth",     items: ["one-thing", "growth"] },
  { tier: 8, label: "Transcendence",      kind: "growth",     items: ["impact"] },
];
export const NEED_THRESHOLDS = {
  sleep:    { okH: 7, warnH: 6 },                 // 7-night average
  food:     { okShare: 0.7, warnShare: 0.4 },     // share of the last 7 days logged and at 90%+ protein
  movement: { okShare: 0.9, warnShare: 0.6 },     // 7-day average steps / goal
  recovery: { okScore: 50, warnScore: 35 },       // 7-day HRV + RHR score against baseline
  runway:   { okDays: 180, warnDays: 60 },
  income:   { okShare: 1.0, warnShare: 0.5 },     // main-quest revenue against the next anchor
  partner:  { okDays: 2, warnDays: 7 },           // days since last contact with the partner
  circle:   { okPeople: 5, warnPeople: 2 },       // distinct people in touch with, last 14 days
  momentum: { okTasks: 10, warnTasks: 3 },        // tasks done, last 7 days
  areaXp:   { ok: 60, warn: 15 },                 // XP in the tier's area over the last 7 days (learning, joy, growth, impact)
  deepWork: { okMin: 600, warnMin: 180 },         // focus minutes, last 7 days
  geared:   { okSlots: 10, warnSlots: 5 },        // equipment slots filled, of 13
};

// ---------------------------------------------------------------------------------------------
// Signals: every feed, where it comes from, and when it counts as stale.
// via: "edge" = an adapter inside this worker (src/adapters.js); "push" = events sent to
// /api/ingest, /api/phone or /api/act. A signal with both `feed` and `types` is live from either.
// fresh: "data" = stale is judged on the newest datum the source itself reports; otherwise on
// the last successful poll or push (a diary nobody wrote in today is still a live feed).
// `device` is a plain description for the Signals panel; change it to name your own sources.
// ---------------------------------------------------------------------------------------------
export const SIGNALS = [
  { id: "steps",     label: "Steps",                 fresh: "data", via: "edge+push", feed: "steps", types: ["steps.day"], staleAfterH: 6, device: "step counter (watch or phone)" },
  { id: "sleep",     label: "Sleep",                 fresh: "data", via: "edge+push", feed: "steps", types: ["health.day", "sleep.night"], staleAfterH: 36, device: "sleep tracking (watch or phone)" },
  { id: "food",      label: "Food diary",            via: "edge+push", feed: "food", types: ["meal.day"], staleAfterH: 26, device: "food diary" },
  { id: "workouts",  label: "Workouts",              via: "edge+push", feed: "workouts", types: ["workout"], staleAfterH: 24 * 8, device: "workout calendar or recorded sessions" },
  { id: "scale",     label: "Scale (direct readings)", via: "edge+push", feed: "scale", types: ["weigh"], staleAfterH: 24 * 8, device: "smart scale" },
  { id: "health",    label: "Health database",       via: "push", types: ["health.day"], staleAfterH: 26, device: "health data export" },
  { id: "weight",    label: "Weight",                via: "push", types: ["health.day", "weigh"], staleAfterH: 26, device: "smart scale" },
  { id: "btc",       label: "BTC",                   fresh: "data", via: "edge", feed: "btc",      staleAfterH: 36,  device: "a btc adapter (none bundled)" },
  { id: "fleet",     label: "Fleet",                 fresh: "data", via: "edge", feed: "fleet",    staleAfterH: 0.5, device: "your status page (FLEET_STATUS_URL)" },
  { id: "office",    label: "Office climate",        fresh: "data", via: "edge", feed: "fleet",    staleAfterH: 2,   device: "room sensor on the status page" },
  { id: "place",     label: "Location",              fresh: "data", via: "push", types: ["place.arrive", "place.stay"], staleAfterH: 72, device: "location tracker or phone" },
  { id: "weather",   label: "Weather",               fresh: "data", via: "edge", feed: "weather",  staleAfterH: 2,   device: "open-meteo.com" },
  { id: "room",      label: "Room sensor",           via: "push", types: ["room.climate"], staleAfterH: 2, device: "local sensor" },
  { id: "money",     label: "Money",                 via: "push", types: ["money.balance", "money.txn", "money.burn", "money.budget"], staleAfterH: 36, device: "ledger, bank and wallet collectors" },
  { id: "mainquest", label: "Main quest scoreboard", via: "push", types: ["quest.progress"], staleAfterH: 36, device: "goal scoreboard" },
  { id: "tasks",     label: "Tasks",                 via: "push", types: ["task.open", "task.done", "checklist.day"], staleAfterH: 24, device: "task list" },
  { id: "calendar",  label: "Calendar",              via: "push", types: ["calendar.event"], staleAfterH: 24, device: "calendar" },
  { id: "inventory", label: "Belongings",            via: "push", types: ["item.upsert"], staleAfterH: 24 * 14, device: "inventory list" },
  { id: "contacts",  label: "People",                via: "push", types: ["contact.touch", "contact.upsert"], staleAfterH: 72, device: "contacts and messages" },
  { id: "companion", label: "Companion stats",       via: "push", types: ["companion.stats"], staleAfterH: 36, device: "the AI companion's own counters" },
  { id: "focus",     label: "Focus timer",           via: "push", types: ["focus.block"], staleAfterH: 72, device: "keypad / ring" },
  { id: "air",       label: "Air quality",           fresh: "data", via: "edge", feed: "weather",  staleAfterH: 3,   device: "open-meteo.com" },
  { id: "mood",      label: "Mood check-ins",        via: "push", types: ["checkin"], staleAfterH: 72, device: "voice / ring" },
  { id: "mindful",   label: "Mindful minutes",       via: "push", types: ["mindful"], staleAfterH: 96, device: "phone health data / voice" },
  { id: "giving",    label: "Support given",         via: "push", types: ["support.given"], staleAfterH: 24 * 30, device: "voice / record" },
  { id: "learning",  label: "Learning",              via: "push", types: ["learn"], staleAfterH: 96, device: "reading / course record, voice" },
  { id: "placeneeds", label: "Place needs",          via: "push", types: ["need.ok", "visa"], staleAfterH: null, device: "voice / record" },
  { id: "profile",   label: "Profile",               via: "push", types: ["profile.set", "body.goal"], staleAfterH: null, device: "record" },
];

// Event types the ingest accepts. `key` builds the canonical id for facts that have a natural
// key, so the same fact pushed by two collectors (or with a different id) can never count twice.
// Types without `key` must carry their own stable id.
export const EVENT_TYPES = {
  "day.start":       { key: d => d.date },
  "steps.day":       { key: d => d.date },
  "sleep.night":     { key: d => d.date },
  "meal.day":        { key: d => d.date },
  "health.day":      { key: d => d.date },
  "workout":         { key: d => d.date },
  "weigh":           {},
  "money.balance":   { key: d => d.account && d.date ? d.account + ":" + d.date : null },
  "money.txn":       {},
  "money.burn":      { key: d => d.date },
  "money.budget":    { key: () => "current" },
  "quest.progress":  { key: d => (d.quest || "main") + ":" + d.date },
  "task.open":       { key: d => d.taskId },
  "task.done":       { key: d => d.taskId },
  "checklist.day":   { key: d => d.date },
  "calendar.event":  { key: d => d.eventId },
  "focus.block":     {},
  "place.arrive":    {},
  "place.stay":      { key: d => d.from && d.lat != null ? d.from + ":" + Number(d.lat).toFixed(3) + "," + Number(d.lon).toFixed(3) : null },
  "item.upsert":     { key: d => d.itemId },
  "item.equip":      {},
  "item.wish":       { key: d => (d.slot ? String(d.slot).toLowerCase() : null) },
  "place.alias":     { key: d => { const m = d.match || {}; return m.city ? "city:" + String(m.city).toLowerCase() : m.lat != null && m.lon != null ? "geo:" + Number(m.lat).toFixed(3) + "," + Number(m.lon).toFixed(3) : null; } },
  "contact.touch":   {},
  "contact.upsert":  { key: d => d.contactId, merge: true },   // merge: a revision keeps the fields it does not mention (several sources describe one person)
  "companion.stats": { key: d => d.date },
  "room.climate":    { key: d => d.room || "room" },
  "profile.set":     { key: () => PLAYER_ID },
  "body.goal":       { key: () => "current" },
  "activity":        {},
  "checkin":         {},
  "mindful":         {},
  "learn":           {},
  "support.given":   {},
  "need.ok":         {},
  "visa":            { key: d => d.country ? d.country + ":" + (d.validUntil || "") : null },
  "system.status":   {},
  "note":            {},
  // written by the engine itself (src/marks.js), never accepted from outside
  "engine.mark":     { key: d => d.entry, internal: true },
  // a presence card received from a peer world (src/peers.js); written by the engine's own pull, never accepted from outside
  "peer.card":       { key: d => d.peerId, internal: true },
};
export const DERIVED_TYPES = ["quest.done", "level.up", "achievement"];
