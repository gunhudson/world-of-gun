// Character window (C). Tabs follow the original design references: Summary · Skills · Wardrobe · Achievements.
// Summary is the "Dashboard View" Gun sketched in 2022: ONE THING, other quests and dailies on the
// left; the rotating character in the centre; inventory and the nine % bars on the right; "My
// Party" cards along the bottom.

import { h, has, num, cap, age, dayAge, dateISO, dateOf, NO_SIGNAL, counter, fill } from "../dom.js";
import { icon } from "../icons.js";
import { pct, isDone, allQuests, act } from "../store.js";
import { tip, hide as hideTip } from "../tooltip.js";
import { bar, meterRow, ordered, METER_ORDER, VITAL_ORDER, COLORS, slotTile, slotLabel, questRow, questTip, progressText, sectionHead, nosig, stat, numTip, sparkline, emptyState, itemTip, streakTip, streakState } from "../widgets.js";
import { personCard, personChip, viewFilter, rankParty } from "../people.js";
import { createBodyTab } from "../body.js";
import { currentOutfit, outfitList, loadOutfits, setOutfit } from "../outfits.js";

// Wardrobe slot names as in the design; contract slot ids on the right. Aliases are accepted from the engine.
const LEFT = ["head", "chest", "legs", "feet", "back"];
const RIGHT = ["wrist", "finger", "mainhand", "offhand", "vehicle"];
const ALIAS = { torso: "chest", accessory: "wrist", ring: "finger", weapon: "mainhand", tool: "offhand" };
const normSlot = (s) => ALIAS[s] || s;
const RARITY_ORDER = ["legendary", "epic", "rare", "uncommon", "common"];

function equipMap(state) {
  const m = new Map();
  for (const e of state?.character?.equipment || []) if (e?.slot) m.set(normSlot(e.slot), e.item || null);
  return m;
}

function create(app) {
  let view = "bonded", partyOpen = false, ghost = false;
  const bodyTab = createBodyTab(app);
  const toggleGhost = () => { const shown = app.stage.query("setGhost", !ghost); ghost = shown === undefined ? false : !!shown; app.audio.tick(); hideTip(); rerenderFn(); };
  // The goal body: offered only when the stage says the model can morph and a goal exists.
  const canGhost = (s) => {
    if (!s?.character?.body?.goal) return false;
    const info = app.stage.query("getModelInfo") || app.stage.query("getInfo") || {};
    return (info.morphTargets?.length || info.morphs?.length || 0) > 0;
  };
  try { partyOpen = localStorage.getItem("wog.party.open") === "1"; } catch {}

  // ---- centre: the stage shows through here ---------------------------------------------------
  function centre(s, tab) {
    const c = s?.character;
    const cls = s?.characters?.find((x) => x.id === c?.id)?.class;
    const p = has(c?.xp) && has(c?.xpNext) && c.xpNext > 0 ? (c.xp / c.xpNext) * 100 : null;
    const plate = h("div.char__plate",
      h("div.char__name", c?.name || NO_SIGNAL),
      c?.title ? h("div.char__title", c.title) : null,
      h("div.char__meta", has(c?.level) ? "Level " + c.level : h("span.nosig", "level: no signal"), cls ? " · " + cls : null),
      tab === "body" && bodyTab.selectedBody(s) ? h("div.char__asof", icon("clock"), "Body as on " + bodyTab.selectedBody(s).d + " · " + bodyTab.selectedBody(s).w.toFixed(1) + " kg") : null);
    const goal = c?.body?.goal;
    const goalBtn = canGhost(s) ? h("button.lbtn.char__goal", { type: "button", class: ghost ? "is-on" : "", "aria-pressed": String(ghost), onClick: toggleGhost }, icon("target"), ghost ? "Goal shown" : "Goal") : null;
    if (goalBtn) tip(goalBtn, () => ({ kicker: "Goal body", title: "Show the goal beside him", lines: [["Goal weight", has(goal.weightKg) ? goal.weightKg + " kg" : null], ["Goal body fat", has(goal.bodyFatPct) ? goal.bodyFatPct + "%" : null], ["Goal lean mass", has(goal.leanMassKg ?? goal.leanKg) ? (goal.leanMassKg ?? goal.leanKg) + " kg" : null]], source: goal.source ?? c.body.source ?? null, asOf: goal.asOf ?? null }), { tap: false, place: "top" });
    const foot = h("div.char__edge",
      h("span.char__hint", icon("refresh"), h("span.char__hinttext", "Drag to turn"), goalBtn),
      h("span.char__xptext", p == null ? nosig("experience: no signal") : `${num(c.xp)} / ${num(c.xpNext)} XP`),
      bar({ key: "xp:sheet", value: p, color: "var(--v-xp)", size: "xs", label: "Experience" }));
    const kids = [plate];
    if (tab === "wardrobe") {
      const eq = equipMap(s);
      const col = (slots, side) => h("div.char__slots.char__slots--" + side, slots.map((slot) => slotCard(slot, eq.get(slot), side)));
      kids.push(col(LEFT, "l"), col(RIGHT, "r"));
    }
    kids.push(foot);
    return h("div.char__centre", { data: { tab } }, kids);
  }

  function slotCard(slot, item, side) {
    const locked = item && !item.name && item.quest;
    const real = item && item.name ? item : null;
    const tile = locked
      ? h("div.slot.is-locked", { "aria-label": slotLabel(slot) + ": locked" }, icon("lock", "slot__ghost"))
      : slotTile(real, { slot, tip: { where: "Equipped" } });
    const card = h("div.scell", { class: (locked ? "is-locked " : "") + (!real && !locked ? "is-empty " : ""), data: { side, rarity: real?.rarity || null } },
      tile,
      h("div.scell__text",
        h("span.scell__slot", slotLabel(slot)),
        real ? h("span.scell__name.rar", { data: { rarity: real.rarity || "common" } }, real.name)
          : locked ? h("span.scell__quest", "Quest: " + item.quest)
          : h("span.scell__none", "Empty")));
    if (real?.assumed) {
      card.classList.add("is-assumed");
      const go = (equipped) => async (e) => { e.stopPropagation(); app.audio.tick(); const r = await act({ type: "item.equip", itemId: real.id, slot, equipped }); app.toasts.notice(r?.ok ? r.speech || (equipped ? "Confirmed." : "Removed.") : "Not saved: " + (r?.error || "no answer"), r?.ok ? null : "bad", r?.ok ? "check" : "warning"); };
      card.querySelector(".scell__text").append(h("span.scell__assumed", "Unconfirmed"));
      card.append(h("span.scell__acts",
        h("button.mini", { type: "button", "aria-label": `Confirm ${real.name} as ${slotLabel(slot)}`, onClick: go(true) }, icon("check")),
        h("button.mini.mini--no", { type: "button", "aria-label": `Remove ${real.name} from ${slotLabel(slot)}`, onClick: go(false) }, icon("close"))));
    }
    if (locked) tip(card, { kicker: "Locked slot", title: slotLabel(slot), lines: ["Filled by completing: " + item.quest, item.detail], source: item.source ?? "engine", asOf: s_asOf }, { focusable: true });
    return card;
  }
  let s_asOf = null, rerenderFn = () => {}, lastState = null;
  // the Goal toggle depends on the model's morph targets, which arrive after the model loads
  let modelTimer = null;
  app.stage.on("model", (m) => { if (m && m.progress != null && m.progress < 1) return; clearTimeout(modelTimer); modelTimer = setTimeout(() => { if (app.panel === "character") rerenderFn(); }, 400); });

  // ---- summary --------------------------------------------------------------------------------
  function summaryLeft(s) {
    const qs = s?.quests, main = qs?.main;
    const kids = [];
    if (main) {
      const p = pct(main.progress), next = (main.steps || []).find((x) => !x.done);
      const stepsDone = (main.steps || []).filter((x) => x.done).length;
      const box = h("button.onething", { type: "button", onClick: () => app.openPanel("quests", { focus: main.id }) },
        h("span.onething__kicker", "One thing", h("i", "current quest")),
        h("span.onething__title", main.title),
        main.text ? h("span.onething__text", main.text) : null,
        h("span.onething__bar", bar({ key: "q:one:" + main.id, value: p, color: "var(--accent)", size: "lg", label: main.title }), h("b", p == null ? "" : Math.round(p) + "%")),
        h("span.onething__meta",
          progressText(main.progress) ? h("span", progressText(main.progress)) : h("span"),
          main.steps?.length ? h("span", `${stepsDone}/${main.steps.length} steps`) : null),
        next ? h("span.onething__next", icon("right"), next.title) : null);
      tip(box, questTip({ ...main, kind: "main" }, { asOf: s?.asOf }), { tap: false });
      kids.push(box);
    } else kids.push(h("div.onething.is-null", h("span.onething__kicker", "One thing", h("i", "current quest")), nosig(), h("span.onething__text", "No main quest has arrived from the engine.")));

    const openQ = (q) => () => app.openPanel("quests", { focus: q.id });
    const side = (qs?.side || []).map((q) => ({ ...q, kind: q.kind || "side" }));
    const open = (l) => l.filter((q) => !isDone(q));
    const others = [...(qs?.weekly || []).map((q) => ({ ...q, kind: "weekly" })), ...side];
    const sorted = [...open(side.filter((q) => q.kind === "rebuild" && q.next)), ...open((qs?.weekly || []).map((q) => ({ ...q, kind: "weekly" }))), ...open(side.filter((q) => q.kind === "rebuild" && !q.next)), ...open(side.filter((q) => q.kind !== "rebuild"))];
    const SHOW = (qs?.daily || []).length > 6 ? 2 : 3;
    kids.push(sectionHead("Other quests", others.length ? `${others.filter(isDone).length}/${others.length}` : null));
    kids.push(sorted.length ? h("div.qlist", sorted.slice(0, SHOW).map((q) => questRow(q, { onClick: openQ(q), asOf: s?.asOf })),
      sorted.length > SHOW ? h("button.lbtn.qlist__more", { type: "button", onClick: () => app.openPanel("quests") }, `${sorted.length - SHOW} more in the quest log`, icon("right")) : null) : h("div.none", nosig(s ? "none open" : NO_SIGNAL)));
    const daily = (qs?.daily || []).map((q) => ({ ...q, kind: "daily" }));
    kids.push(sectionHead("Daily quests", daily.length ? `${daily.filter(isDone).length}/${daily.length}` : null));
    kids.push(daily.length ? h("div.qlist", daily.map((q) => questRow(q, { onClick: openQ(q), asOf: s?.asOf }))) : h("div.none", nosig(s ? "none today" : NO_SIGNAL)));
    return kids;
  }

  function summaryRight(s) {
    const inv = s?.inventory, eqIds = new Set((s?.character?.equipment || []).map((e) => e.item?.id).filter(Boolean));
    const seen = new Set(), items = [];
    for (const b of inv?.bags || []) for (const it of b.items || []) { if (seen.has(it.id)) continue; seen.add(it.id); items.push({ it, bag: b }); }
    items.sort((a, b) => (eqIds.has(b.it.id) - eqIds.has(a.it.id)) || RARITY_ORDER.indexOf(a.it.rarity || "common") - RARITY_ORDER.indexOf(b.it.rarity || "common"));
    const N = 18, shown = items.slice(0, N);
    const grid = h("div.invprev", shown.map(({ it, bag }) => slotTile(it, { onClick: () => app.openPanel("bags", { focus: it.id }), tip: { where: bag.name }, class: eqIds.has(it.id) ? "is-equipped" : "" })),
      Array.from({ length: Math.max(0, N - shown.length) }, () => slotTile(null)));
    const open = h("button.lbtn", { type: "button", onClick: () => app.openPanel("bags") }, has(inv?.count) ? `${num(inv.count)} items` : "Open bags", icon("right"));
    const meters = ordered(s?.character?.meters, METER_ORDER);
    return [
      sectionHead("Inventory", open),
      inv ? grid : h("div.invprev.is-null", Array.from({ length: N }, () => slotTile(null)), h("span.invprev__nosig", NO_SIGNAL)),
      sectionHead("Money / Energy / Sleep …", null),
      h("div.meters", meters.map((m) => meterRow(m, { keyPrefix: "m", size: "md", tip: { kicker: "Quick glance" } }))),
    ];
  }

  function partyStrip(s, ctx) {
    const party = s?.party || [];
    const list = rankParty(party, view);
    const toggle = () => { partyOpen = !partyOpen; try { localStorage.setItem("wog.party.open", partyOpen ? "1" : "0"); } catch {} app.audio.tick(); ctx.rerender(); };
    const openParty = () => app.openPanel("party");
    return h("section.char__party.pane", { class: partyOpen ? "is-open" : "" },
      h("div.char__party-head", h("span.sec__title", "My Party"), party.length ? viewFilter(party, view, (v) => { view = v; app.audio.tick(); ctx.rerender(); }) : null,
        h("button.lbtn", { type: "button", "aria-expanded": String(partyOpen), onClick: toggle }, partyOpen ? "Collapse" : "Cards", icon(partyOpen ? "down" : "up")),
        h("button.lbtn", { type: "button", onClick: openParty }, `All ${party.length || ""}`.trim(), icon("right"))),
      party.length
        ? h("div.char__party-row.scroll", { data: { scroll: "party" } }, list.length
          ? [list.slice(0, partyOpen ? 14 : 24).map((p) => (partyOpen ? personCard(p, s, { compact: true }) : personChip(p, openParty))), list.length > (partyOpen ? 14 : 24) ? h("button.pchip.pchip--more", { type: "button", onClick: openParty }, `+${list.length - (partyOpen ? 14 : 24)} more`) : null]
          : h("div.none", "Nobody in this view."))
        : h("div.none", nosig(s ? "no party records" : NO_SIGNAL)));
  }

  // ---- skills ---------------------------------------------------------------------------------
  function skillsLeft(s) {
    const c = s?.character, d = s?.day, qs = allQuests(s);
    const done = qs.filter(isDone).length;
    const kinds = [["Daily", "daily"], ["Weekly", "weekly"], ["Rebuild", "rebuild"], ["Tasks", "task"], ["Side", "side"]].filter(([, k]) => qs.some((q) => q.kind === k));
    const streaks = s?.streaks || [];
    const src = { source: "engine (derived from the event log)", asOf: s?.asOf };
    return [
      sectionHead("Game experience"),
      h("div.kvs",
        kvRow("Level", has(c?.level) ? counter("sk:lvl", c.level) : null, numTip("Level", c?.level, null, s, src)),
        kvRow("Experience", has(c?.xp) && has(c?.xpNext) ? `${num(c.xp)} / ${num(c.xpNext)}` : null, numTip("Experience", has(c?.xp) ? num(c.xp) : null, null, s, src)),
        kvRow("XP today", has(c?.xpToday) ? "+" + num(c.xpToday) : null, numTip("XP today", c?.xpToday, null, s, src)),
        kvRow("Day grade", d?.grade ?? null, numTip("Day grade", d?.grade, null, s, src)),
        kvRow("Day of life", has(s?.realm?.dayOfLife) ? num(s.realm.dayOfLife) : null, numTip("Day of life", s?.realm?.dayOfLife, s?.realm, s))),
      sectionHead("Quest progression", qs.length ? `${done}/${qs.length}` : null),
      qs.length ? h("div.kvs", kinds.map(([label, kind]) => {
        const list = qs.filter((q) => q.kind === kind), n = list.filter(isDone).length;
        return h("div.kvbar", h("span.kv__k", label), bar({ key: "sk:q:" + kind, value: list.length ? (n / list.length) * 100 : null, color: "var(--accent)", size: "xs", label }), h("span.kv__v", list.length ? `${n} / ${list.length}` : nosig("none")));
      })) : h("div.none", nosig()),
      sectionHead("Streaks", streaks.length ? `${streaks.filter((x) => x.current > 0 && x.alive !== false).length} alive` : null),
      streaks.length ? h("div.strk", streaks.map((st) => {
        const state = streakState(st);
        const el = h("div.strk__row", { data: { state } }, h("span.strk__ico", icon("flame")), h("span.strk__label", st.label),
          h("span.strk__best", has(st.best) ? "best " + st.best : ""), h("span.strk__cur", has(st.current) ? String(st.current) : "–", h("small", " " + (st.unit || ""))),
          h("span.strk__state", { hit: "secured", risk: "not yet " + (st.period === "week" ? "this week" : "today"), dead: "broken", null: "no signal" }[state]));
        tip(el, streakTip(st, s), { focusable: true });
        return el;
      })) : h("div.none", nosig(s ? "no streaks yet" : NO_SIGNAL)),
    ];
  }
  const kvRow = (k, v, tipData) => { const el = h("div.kv", h("span.kv__k", k), h("span.kv__v", has(v) ? v : nosig())); if (tipData) tip(el, tipData, { focusable: true }); return el; };

  function skillsRight(s) {
    const attrs = s?.character?.attributes || [];
    if (!attrs.length) return [sectionHead("Skills"), emptyState(NO_SIGNAL, "The ten areas have not arrived from the engine.")];
    const total = attrs.reduce((a, x) => a + (has(x.level) ? x.level : 0), 0);
    return [
      sectionHead("Skills", attrs.every((a) => has(a.level)) ? "Total " + total : null),
      h("div.skills", attrs.map((a) => {
        const p = has(a.xp) && has(a.xpNext) && a.xpNext > 0 ? (a.xp / a.xpNext) * 100 : null;
        const cell = h("div.skill", { class: has(a.level) ? "" : "is-null" },
          h("span.skill__ico", icon(a.icon || a.id)),
          h("span.skill__label", a.label || cap(a.id)),
          h("span.skill__lvl", has(a.level) ? String(a.level) : "–"),
          bar({ key: "attr:" + a.id, value: p, color: "var(--v-xp)", size: "xs", label: a.label }),
          h("span.skill__foot", h("span.skill__xp", p == null ? nosig() : `${num(a.xp)} / ${num(a.xpNext)}`),
            h("span.skill__7d", has(a.xp7d) && a.xp7d > 0 ? "+" + num(a.xp7d) + " this week" : "")));
        tip(cell, () => ({ kicker: "Skill", title: a.label || cap(a.id), value: has(a.level) ? "Level " + a.level : undefined,
          lines: [["XP", p == null ? null : `${num(a.xp)} / ${num(a.xpNext)}`], ["Last 7 days", has(a.xp7d) ? "+" + num(a.xp7d) : null], ...(a.top || []).map((t) => "· " + t)],
          source: a.source ?? "engine (derived from the event log)", asOf: a.asOf ?? s?.asOf ?? null, nosignal: !has(a.level) }), { focusable: true });
        return cell;
      })),
    ];
  }

  // ---- wardrobe -------------------------------------------------------------------------------
  // "Looks" (Lvl 3, "dress me"): outfits built from items in the wardrobe, baked as texture sets for the 3D body
  // (public/tex/outfits.json). The chosen look dresses the character everywhere; remembered on this device.
  function itemIndex(s) {
    const m = new Map();
    for (const b of s?.inventory?.bags || []) for (const it of b.items || []) m.set(it.id, { ...it, bagName: b.name });
    return (id) => m.get(id) || m.get("qc-" + id) || null;      // a test world carries the same items under qc- ids
  }
  function looks(s) {
    const list = outfitList();
    if (!list) { loadOutfits().then(() => rerenderFn?.()); return h("div.none", "Loading looks…"); }
    if (!list.length) return h("div.none", nosig("no looks built yet"));
    const cur = currentOutfit(), find = itemIndex(s);
    const chip = (ref) => {
      const it = find(ref.id), name = it?.name || ref.name || ref.id, photo = !it || !!it.assumed || /photo/i.test(it.source || "");
      const el = h("span.look__chip", { class: (it ? "" : "is-missing ") + (photo ? "is-assumed" : ""), data: { rarity: it?.rarity || "common" } }, name, photo ? h("span.look__q", "?") : null);
      tip(el, it ? itemTip({ ...it }, { where: it.bagName }) : { kicker: "Wardrobe item", title: name, lines: ["Not in your bags on this world yet."], note: "The look still works; the item name comes from the look itself." }, { focusable: true });
      return el;
    };
    return h("div.looks", list.map((o) => {
      const on = o.id === cur, unconfirmed = !!o.assumed || (o.items || []).some((r) => { const it = find(r.id); return !it || it.assumed; });
      const btn = h("button.look", { type: "button", class: on ? "is-on" : "", "aria-pressed": on ? "true" : "false", onClick: () => { if (o.id === currentOutfit()) return; app.audio.tick(); setOutfit(o.id); rerenderFn?.(); } },
        h("div.look__head", h("span.look__name", o.name), on ? h("span.look__on", icon("check"), " Wearing") : h("span.look__wear", "Wear")),
        o.items?.length ? h("div.look__items", o.items.map(chip)) : h("div.look__items", h("span.look__chip", "The modelled look")),
        o.also?.length ? h("div.look__also", "Also worn: " + o.also.map((r) => find(r.id)?.name || r.name || r.id).join(", ")) : null,
        unconfirmed && o.id !== "base" ? h("div.look__flag", "Unconfirmed items: not confirmed by you") : null,
        o.approx ? h("div.look__approx", o.approx) : null);
      tip(btn, { kicker: "Look", title: o.name, lines: [o.note || null].filter(Boolean), note: o.id === "base" ? "The character was modelled in this outfit." : "Painted on the same body: the cut stays, the look changes (character/outfits.sh)." }, { focusable: false });
      return btn;
    }));
  }
  function wardrobeLeft(s) {
    const eq = equipMap(s);
    const worn = [...LEFT, ...RIGHT].map((slot) => [slot, eq.get(slot)]).filter(([, it]) => it?.name);
    const extra = [...eq.entries()].filter(([slot, it]) => ![...LEFT, ...RIGHT].includes(slot) && it?.name);
    const line = ([slot, it]) => { const el = h("div.kv", h("span.kv__k", slotLabel(slot)), h("span.kv__v.rar", { data: { rarity: it.rarity || "common" } }, it.name)); tip(el, itemTip({ ...it, slot }, { where: "Equipped", asOf: s?.asOf }), { focusable: true }); return el; };
    const curLook = (outfitList() || []).find((o) => o.id === currentOutfit());
    return [
      sectionHead("Looks", curLook ? curLook.name : null),
      looks(s),
      h("p.note", "Dress me: a look paints real items from your wardrobe onto the character, everywhere it appears. Remembered on this device."),
      sectionHead("Outfit", worn.length ? `${worn.length}/${LEFT.length + RIGHT.length} slots` : null),
      worn.length ? h("div.kvs", worn.map(line)) : h("div.none", nosig(s ? "nothing equipped" : NO_SIGNAL)),
      extra.length ? sectionHead("Also carried") : null,
      extra.length ? h("div.carried", extra.map(([slot, it]) => h("div.scell", { data: { rarity: it.rarity || null } }, slotTile(it, { slot, tip: { where: "Equipped" } }), h("div.scell__text", h("span.scell__slot", slotLabel(slot)), h("span.scell__name.rar", { data: { rarity: it.rarity || "common" } }, it.name))))) : null,
      h("p.note", "One item per slot. Slots fill from real belongings; a locked slot names the quest that fills it."),
      h("button.lbtn", { type: "button", onClick: () => app.openPanel("bags") }, "Open bags to compare", icon("right")),
    ];
  }
  let ctx_setTab = () => {};
  function wardrobeRight(s) {
    const b = s?.character?.body, vit = ordered(s?.character?.vitals, VITAL_ORDER);
    const hist = (b?.history || []).filter((p) => has(p.w));
    return [
      sectionHead("Body", b?.asOf ? age(b.asOf) : null),
      h("div.stats3",
        stat("Weight", has(b?.weightKg) ? [counter("body:w", b.weightKg, (v) => v.toFixed(1)), h("small", " kg")] : null, numTip("Weight", has(b?.weightKg) ? b.weightKg + " kg" : null, b?.prov?.weightKg ?? b, s, { lines: [b?.weighedOn ? ["Weighed on", b.weighedOn] : null, has(b?.leanMassKg) ? ["Lean mass", b.leanMassKg + " kg"] : null, has(b?.bmi) ? ["BMI", b.bmi] : null] })),
        stat("Body fat", has(b?.bodyFatPct) ? [String(b.bodyFatPct), h("small", " %")] : null, numTip("Body fat", has(b?.bodyFatPct) ? b.bodyFatPct + "%" : null, b?.prov?.bodyFatPct ?? b, s)),
        stat("Resting HR", has(b?.rhr) ? [String(b.rhr), h("small", " bpm")] : null, numTip("Resting heart rate", has(b?.rhr) ? b.rhr + " bpm" : null, b?.prov?.rhr ?? b, s, { lines: [has(b?.hrv) ? ["HRV", b.hrv + " ms"] : null, b?.heartOn ? ["Measured on", b.heartOn] : null] }))),
      h("div.sparkbox", h("div.sparkbox__cap", h("span", "Weight"), hist.length > 1 ? h("span", `${hist.length} days · ${hist[0].w} → ${hist[hist.length - 1].w} kg`) : null), sparkline(b?.history, "w", "var(--v-health)")),
      h("button.lbtn", { type: "button", onClick: () => ctx_setTab("body") }, "Body over time", icon("right")),
      sectionHead("Vitals"),
      h("div.meters", vit.map((m) => meterRow(m, { keyPrefix: "v", size: "md" }))),
    ];
  }

  // ---- achievements ---------------------------------------------------------------------------
  function achLeft(s) {
    const list = s?.achievements || [];
    return [
      sectionHead("Achievements", list.length ? String(list.length) : null),
      list.length ? h("div.achs", list.map((a) => {
        const el = h("div.ach", { data: { rarity: a.rarity || "common" } }, h("span.ach__ico", icon("crown")), h("span.ach__title.rar", { data: { rarity: a.rarity || "common" } }, a.title), h("span.ach__detail", a.detail || ""), h("span.ach__date", a.date ? dateOf(dateISO(a.date), s?.realm?.tz) : ""));
        tip(el, () => ({ kicker: cap(a.rarity || "common") + " achievement", rarity: a.rarity, title: a.title, lines: [a.detail], source: a.source ?? "engine (derived from the event log)", asOf: a.date ? dateISO(a.date) : null }), { focusable: true });
        return el;
      })) : emptyState(s ? "Nothing earned yet" : NO_SIGNAL, "Achievements are granted by the engine from real events."),
    ];
  }
  function achRight(s) {
    const list = s?.achievements || [];
    const marks = (s?.log || []).filter((e) => e.type === "level" || e.type === "quest").slice(0, 8);
    return [
      sectionHead("By rarity"),
      h("div.kvs", RARITY_ORDER.map((r) => { const n = list.filter((a) => (a.rarity || "common") === r).length; return h("div.kv", h("span.kv__k.rar", { data: { rarity: r } }, cap(r)), h("span.kv__v", s ? String(n) : nosig())); })),
      sectionHead("Recent milestones"),
      marks.length ? h("div.kvs", marks.map((e) => h("div.kv", h("span.kv__k", e.text), h("span.kv__v", age(e.ts))))) : h("div.none", nosig(s ? "none in the log" : NO_SIGNAL)),
    ];
  }

  return {
    tab: "summary",
    render(root, s, ctx) {
      s_asOf = s?.asOf ?? null; rerenderFn = ctx.rerender; lastState = s; ctx_setTab = ctx.setTab;
      const tab = ctx.tab || "summary";
      if (tab !== "body") bodyTab.leave(s);
      const [left, right] = tab === "skills" ? [skillsLeft(s), skillsRight(s)] : tab === "wardrobe" ? [wardrobeLeft(s), wardrobeRight(s)] : tab === "body" ? bodyTab.render(s, ctx, { can: canGhost(s), on: ghost, toggle: toggleGhost }) : tab === "achievements" ? [achLeft(s), achRight(s)] : [summaryLeft(s), summaryRight(s)];
      fill(root, 
        h("div.char", { data: { tab } },
          h("div.char__left.pane.scroll", { data: { scroll: "cl-" + tab } }, left),
          centre(s, tab),
          h("div.char__right.pane.scroll", { data: { scroll: "cr-" + tab } }, right)),
        tab === "summary" ? partyStrip(s, ctx) : null);
    },
    key(k) { const i = "1234".indexOf(k); if (i >= 0) return; },
    onClose() { bodyTab.leave(lastState); },
  };
}

export default {
  id: "character", title: "Character", icon: "character", mode: "sheet",
  tabs: [{ id: "summary", label: "Summary" }, { id: "skills", label: "Skills" }, { id: "wardrobe", label: "Wardrobe" }, { id: "body", label: "Body" }, { id: "achievements", label: "Achievements" }],
  create,
};
