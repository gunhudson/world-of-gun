// Needs (N): the hierarchy as a place the player visits. Gun's 2022 note on the Maslow image: "to help me rebuild all
// my needs whenever I travel… an effective tool to know what quests / systems to build out in what order".
// So the window opens on the arrival (where the player is, since when), the pyramid as a lit structure with the
// tier he is held at marked, and the rebuild quests the engine issued for this place listed inside the
// tier they serve, in order. A tier renders locked when the engine says it is not unlocked; tiers above
// an unmet one stay locked. Every line comes from the state document; an absent fact is named as absent.

import { h, cap, has, age, dayAge, NO_SIGNAL, fill } from "../dom.js";
import { icon } from "../icons.js";
import { tip } from "../tooltip.js";
import { nosig, emptyState, questTip } from "../widgets.js";
import { isDone, pct } from "../store.js";

const STATE = { ok: ["Met", "check"], warn: ["At risk", "warning"], bad: ["Unmet", "close"], unknown: ["No signal", "nosignal"] };

function create(app) {
  return {
    render(root, s, ctx) {
      const tiers = [...(s?.needs || [])].sort((a, b) => b.tier - a.tier);
      if (!tiers.length) { fill(root, emptyState(s ? "No needs defined" : NO_SIGNAL, "The hierarchy arrives from the engine.")); return; }
      const lowestUnmet = [...tiers].reverse().find((t) => t.unlocked && (t.items || []).some((i) => i.state === "bad"));
      const focus = s?.needsFocus || null;
      // where he is held: the engine's own frontier when it names one, else the lowest unlocked tier with an unmet need, else the highest unlocked tier
      const heldTier = focus?.tier ?? lowestUnmet?.tier ?? [...tiers].reverse().filter((t) => t.unlocked).pop()?.tier ?? null;
      const rebuild = (s?.quests?.side || []).filter((q) => q.kind === "rebuild").sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
      const r = s?.realm;
      const handled = tiers.filter((t) => t.unlocked && (t.items || []).length && (t.items || []).every((i) => i.state === "ok")).length;

      // ---- the arrival: this place, since when, what the realm asked him to rebuild here
      const arrive = h("section.arrive",
        h("div.arrive__where", icon(r?.kind === "home" ? "home" : "pin", "arrive__ico"),
          h("div", h("div.arrive__kicker", r?.kind === "home" ? "Home base" : r?.kind ? cap(r.kind) : "Where you are"),
            h("div.arrive__place", r?.place || nosig("no place on record")),
            h("div.arrive__since", r?.since ? "Arrived " + dayAge(r.since) + (r.stale ? " · last seen " + age(r.lastSeen || r.asOf) : "") : r ? nosig("arrival date: no signal") : nosig()))),
        h("div.arrive__stats",
          cell("Rebuild quests", rebuild.length ? `${rebuild.filter(isDone).length} / ${rebuild.length}` : null, rebuild.length ? "issued for this place, in order" : "none issued for this place"),
          cell("Tiers handled", `${handled} / ${tiers.length}`, "every need met in the tier"),
          cell("Held at", heldTier != null ? `Tier ${heldTier}` : null, heldTier != null ? (tiers.find((t) => t.tier === heldTier)?.label || "") : "nothing holds you")),
        h("p.arrive__lede", "The pyramid resets when you arrive somewhere new: the realm issues rebuild quests for the lowest tiers first, and growth needs unlock once the deficiency needs are handled.", lowestUnmet ? h("b", ` Held at tier ${lowestUnmet.tier}: ${lowestUnmet.label}.`) : null));
      if (r) tip(arrive.querySelector(".arrive__where"), () => ({ kicker: "Realm", title: r.place || "No place", lines: [r.placeRaw ? ["Raw place", r.placeRaw] : null, r.since ? ["Since", dayAge(r.since)] : null, r.lastSeen ? ["Last seen", age(r.lastSeen)] : null, r.country ? ["Country", r.country] : null], source: r.source ?? null, asOf: r.asOf ?? s.asOf ?? null, stale: !!r.stale }), { focusable: true });

      const stack = h("div.needs__stack", { data: { held: heldTier ?? "" } }, tiers.map((t, idx) => {
        const locked = t.unlocked !== true;
        const items = t.items || [];
        const worst = items.some((i) => i.state === "bad") ? "bad" : items.some((i) => i.state === "warn") ? "warn" : items.length && items.every((i) => i.state === "ok") ? "ok" : "unknown";
        const here = heldTier === t.tier;
        const mine = rebuild.filter((q) => q.tier === t.tier);
        return h("section.tier", { class: (locked ? "is-locked " : "") + (here ? "is-here " : ""), data: { state: locked ? "locked" : worst, tier: t.tier }, style: { "--w": 62 + ((tiers.length - 1 - idx) / Math.max(1, tiers.length - 1)) * 38 + "%" } },
          here ? h("span.tier__here", icon("pin"), "You are here") : null,
          h("header.tier__head",
            h("span.tier__n", h("b", String(t.tier))),
            h("span.tier__label", t.label),
            locked ? h("span.tier__lock", icon("lock"), "Locked") : h("span.tier__state", { data: { state: worst } }, icon(STATE[worst][1]), worst === "ok" ? "Handled" : worst === "bad" ? "Unmet" : worst === "warn" ? "At risk" : "No signal")),
          h("div.tier__items", items.map((i) => {
            const st = STATE[i.state] ? i.state : "unknown";
            const el = h("div.need", { data: { state: st } }, h("span.need__ico", icon(STATE[st][1])), h("span.need__label", i.label), h("span.need__detail", st === "unknown" ? nosig() : i.detail || ""));
            tip(el, () => ({ kicker: `Tier ${t.tier} · ${t.label}`, title: i.label, value: STATE[st][0], lines: [i.detail, locked ? "This tier is locked until the tiers below are handled." : null], source: i.source ?? null, asOf: i.asOf ?? s.asOf ?? null, nosignal: st === "unknown" }), { focusable: true });
            return el;
          })),
          mine.length ? h("div.tier__quests", mine.map((q) => {
            const done = isDone(q), p = pct(q.progress);
            const el = h("button.tq", { type: "button", class: done ? "is-done" : "", onClick: () => app.openPanel("quests", { focus: q.id }) },
              h("span.tq__n", has(q.order) ? String(q.order) : "·"), h("span.tq__ico", icon(done ? "check" : "quests")), h("span.tq__title", q.title), h("span.tq__state", done ? "done" : p != null ? Math.round(p) + "%" : cap(q.state || "open")));
            tip(el, questTip({ ...q, kind: "rebuild" }, { asOf: s?.asOf }), { tap: false });
            return el;
          })) : null,
          locked ? h("div.tier__chain", icon("lock")) : null);
      }));
      fill(root, h("div.needs.needs--place", arrive, h("div.needs__scroll.scroll", { data: { scroll: "needs" } }, h("div.needs__glow", { "aria-hidden": "true" }), stack)));
    },
  };
}
const cell = (k, v, sub) => h("div.arrive__cell", h("span.arrive__k", k), h("span.arrive__v", has(v) ? v : nosig()), sub ? h("span.arrive__sub", sub) : null);

export default { id: "needs", title: "Needs", icon: "needs", mode: "needs", create };
