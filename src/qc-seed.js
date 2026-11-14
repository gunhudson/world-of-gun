// A small synthetic fixture for the QC world: clearly fictional place, people and numbers, so
// clients have something to render. Pure: seedEvents(now) and seedFeeds(now). Every event has
// source "qc-seed". Nothing here describes a real person, place or account.
const DAY = 86400000, MIN = 60000;
const day = (now, i) => new Date(now - i * DAY).toISOString().slice(0, 10);
const TZ = "Etc/UTC", SRC = "qc-seed";

export function seedEvents(now) {
  const ev = [], add = (type, data, ts, id) => ev.push({ ...(id ? { id } : {}), ts: ts ?? now - 5 * MIN, type, source: SRC, data });
  const noon = i => Date.parse(day(now, i) + "T12:00:00Z"), today = day(now, 0);
  add("profile.set", { name: "QC Tester", birthDate: "2000-01-01" });
  add("body.goal", { weightKg: 70, bodyFatPct: 15 });
  add("place.arrive", { place: "Testville", city: "Testville", country: "ZZ", lat: 0, lon: 0, tz: TZ, kind: "home", lastSeen: new Date(now - 10 * MIN).toISOString() }, now - 20 * DAY, "qc-seed:stay:testville");
  add("place.stay", { place: "Sampleton", city: "Sampleton", country: "ZZ", lat: 1, lon: 1, tz: TZ, from: new Date(now - 60 * DAY).toISOString(), to: new Date(now - 21 * DAY).toISOString(), kind: "city" }, now - 60 * DAY);
  add("visa", { country: "ZZ", validUntil: day(now, -200), kind: "QC visa" });
  for (let i = 14; i >= 0; i--) {
    const d = day(now, i), t = i === 0 ? now - 30 * MIN : noon(i) + 8 * 3600000;
    add("steps.day", { date: d, steps: i === 0 ? 5000 : i % 5 === 0 ? 4000 : 11000, goal: 10000, tz: TZ }, t);
    add("health.day", { date: d, sleepHours: i % 4 === 0 ? 6 : 7.5, deepSleepHours: 1.5, restingHr: 60, hrvMs: 50, weightKg: i % 3 === 0 ? 72 - i * 0.1 : null, bodyFatPct: i % 3 === 0 ? 18 : null, activeEnergyKcal: 500, exerciseMin: 30 }, t);
    if (i > 0 || true) add("meal.day", { date: d, rows: i === 0 ? 3 : 6, kcal: i === 0 ? 1000 : 2000, protein: i === 0 ? 75 : 150, carbs: 200, fat: 60, target: { name: "QC target", kcal: 2000, protein: 150, carbs: 200, fat: 60 } }, t);
    if (i % 2 === 1) add("workout", { date: d, status: "done", gym: null }, noon(i));
  }
  for (const [id, name, kind, value, owner] of [["qc:checking", "QC Checking", "cash", 1000, null], ["qc:savings", "QC Savings", "cash", 5000, null], ["qc:card", "QC Card", "debt", 500, null], ["qc:guild", "QC Guild Account", "cash", 10000, "guild"]]) {
    for (const i of [8, 1, 0]) add("money.balance", { account: id, name, kind, value: value + (i === 8 ? -100 : 0), date: day(now, i), institution: "QC Bank", ...(owner ? { owner } : {}) }, noon(i));
  }
  add("money.budget", { incomePerFortnight: 1000, fixedPerMonth: 1500, incomeName: "QC salary" });
  add("money.txn", { amount: 1000, kind: "income", name: "QC salary", date: day(now, 3) }, noon(3), "qc-seed:txn:1");
  add("quest.progress", { quest: "main", date: today, cur: 1000, target: 10000, unit: "USD/mo", title: "QC objective: 10,000 a month", text: "A fictional objective for the sandbox.", period: "QC", due: day(now, -60),
    anchors: [{ date: day(now, -7), target: 2500, label: "QC anchor one" }, { date: day(now, -30), target: 5000, label: "QC anchor two" }, { date: day(now, -60), target: 10000, label: "QC goal" }] });
  [["High", "Wealth"], ["⭐ One Thing", "Strategy"], [null, "Things"], ["Low", "Joy"], ["Medium", "Growth"]].forEach(([priority, area], k) => add("task.open", { taskId: "qc-task-" + (k + 1), title: "QC task " + (k + 1), priority, area, world: "qc" }, now - DAY));
  add("task.done", { taskId: "qc-task-0", title: "QC task zero", priority: "High", area: "Strategy" }, noon(1) + 3600000);
  add("item.upsert", { itemId: "qc-watch", name: "QC Watch", cat: "device", slot: "wrist", equipped: true, valueUsd: 300, location: "On me" }, now - 10 * DAY);
  add("item.upsert", { itemId: "qc-backpack", name: "QC Backpack", cat: "bag", slot: "back", equipped: true, assumed: true, valueUsd: 100, location: "On me" }, now - 10 * DAY);
  add("item.upsert", { itemId: "qc-pouch", name: "QC Pouch", cat: "bag", bag: "QC Backpack", valueUsd: 20 }, now - 10 * DAY);
  add("item.upsert", { itemId: "qc-cable", name: "QC Cable", cat: "electronics", inside: "qc-pouch", valueUsd: 10 }, now - 10 * DAY);
  add("item.upsert", { itemId: "qc-relic", name: "QC Relic", cat: "other", valueUsd: 3000, location: "Testville vault" }, now - 10 * DAY);
  add("item.wish", { slot: "finger", name: "QC Ring", quest: "Finish QC task 2" });
  add("contact.upsert", { contactId: "qc-partner", name: "QC Partner", role: "partner", views: ["party"] });
  for (const [id, name, role, views, last] of [["qc-friend-one", "QC Friend One", "friend", ["squad"], 0], ["qc-friend-two", "QC Friend Two", "close", ["squad", "family"], 2], ["qc-client", "QC Client", "client", ["clients"], 40]]) {
    add("contact.upsert", { contactId: id, name, role, views, location: "Testville" });
    add("contact.touch", { contactId: id, name, role, channel: "qc" }, noon(last) + 2 * 3600000, "qc-seed:touch:" + id);
  }
  add("companion.stats", { date: today, skills: 10, automations: 20, automationRuns: { ok: 100, fail: 1 }, sessions: 3, planUsagePct: 25 });
  add("checkin", { mood: 7, note: "QC check-in" }, now - 60 * MIN, "qc-seed:checkin:1");
  add("mindful", { minutes: 10 }, now - 90 * MIN, "qc-seed:mindful:1");
  add("learn", { minutes: 30, topic: "QC handbook" }, now - 120 * MIN, "qc-seed:learn:1");
  add("support.given", { name: "QC Friend One", kind: "advice" }, now - 150 * MIN, "qc-seed:support:1");
  return ev;
}
export function seedFeeds(now) {
  const iso = t => new Date(t).toISOString(), today = day(now, 0);
  return {
    steps: { goal: 10000, tz: TZ, labelTz: TZ, currentDay: today, updatedAt: iso(now - 4 * MIN), lastContactAt: iso(now - 4 * MIN), observedThrough: iso(now - 30 * MIN), dayMode: { enabled: false }, devices: 1, recent: [] },
    btc: { price: 10000, candle: today, prevClose: 9900, change24hPct: 1.01, ath: 12500, athDate: "2020-01-01", drawdownPct: -20, phase: "bull", phaseDays: 100, daysSinceTop: 100, daysToNextHalving: 500, mayer: 1, onchain: null, asOf: iso(now - 3600000), rows: 0 },
    fleet: { generated_at: iso(now), climate: null,
      fleet: { total: 2, healthy: 2, degraded: 0, down: 0, state: "green", headline: "all systems healthy (QC)" },
      hosts: [{ id: "qc-host-a", name: "QC Host A", where: "Testville · sandbox", state: "green", healthy: true, headline: "all good", last_seen_iso: iso(now - 2 * MIN), metrics: null, issues: [] },
        { id: "qc-host-b", name: "QC Host B", where: "Testville · sandbox", state: "green", healthy: true, headline: "all good", last_seen_iso: iso(now - 3 * MIN), metrics: null, issues: [] }] },
    weather: { lat: 0, lon: 0, tz: TZ, tempC: 20, feelsC: 20, humidity: 50, code: 0, label: "Clear", windKph: 10, precipMm: 0, isDay: true, asOf: iso(now - 10 * MIN), fetchedAt: iso(now), air: { usAqi: 10, pm25: 2, pm10: 5, asOf: iso(now - 10 * MIN) } },
  };
}
