// Bags (B), in the manner of a classic MMO bag screen: a bag bar with one slot per
// real container or location, each bag opening as its own titled grid window beside the others,
// totals at the bottom. Loot loop: one equipped item per slot; selecting an unequipped item of an
// occupied slot shows it beside the equipped one.

import { h, has, num, money, cap, age, NO_SIGNAL, isNarrow, fill } from "../dom.js";
import { icon, iconName } from "../icons.js";
import { tip } from "../tooltip.js";
import { act } from "../store.js";
import { slotTile, slotLabel, itemGlyph, corners, nosig, emptyState } from "../widgets.js";

const LS = "wog.bags.open";
const ALIAS = { torso: "chest", accessory: "wrist", ring: "finger", weapon: "mainhand", tool: "offhand" };
const normSlot = (s) => (s ? ALIAS[s] || s : null);
const EQUIP_SLOTS = ["head", "chest", "legs", "feet", "back", "wrist", "finger", "mainhand", "offhand", "vehicle"];

function bagIcon(b) {
  if (b.icon && iconName(b.icon, null)) return b.icon;
  if (b.kind === "unsorted") return "box";
  const t = `${b.name || ""}`.toLowerCase();
  if (/person|worn|wearing/.test(t)) return "person";
  if (/wardrobe|closet|clothes/.test(t)) return "chest";
  if (/desk|office/.test(t)) return "laptop";
  if (/gym|sport/.test(t)) return "dumbbell";
  if (/storage|garage|unit/.test(t)) return "box";
  if (/pouch|pack|bag|case|suitcase/.test(t)) return "back";
  if (b.kind === "location") return "pin";
  return b.parent || b.kind === "container" ? "back" : "home";
}

function create(app) {
  let open = null;        // Set of open bag ids
  let selected = null;    // item id
  try { const saved = JSON.parse(localStorage.getItem(LS) || "null"); if (Array.isArray(saved)) open = new Set(saved); } catch {}
  const save = () => { try { localStorage.setItem(LS, JSON.stringify([...open])); } catch {} };

  function index(s) {
    const raw = s?.inventory?.bags || [], bags = [];
    const kids = (id) => raw.filter((b) => b.parent === id);
    const walk = (b, depth) => { if (bags.includes(b)) return; b = Object.assign(b, { depth }); bags.push(b); kids(b.id).forEach((k) => walk(k, depth + 1)); };
    const top = raw.filter((b) => !b.parent || !raw.some((x) => x.id === b.parent));
    const order = (b) => (b.kind === "unsorted" ? 3 : /^(with |on person|on me|carried)/i.test(b.name || "") ? -1 : b.kind === "location" ? 0 : 1); // what the player carries comes first
    top.slice().sort((a, b) => order(a) - order(b) || (b.items || []).length - (a.items || []).length).forEach((b) => walk(b, 0));
    const equipped = new Map(); // slot -> item (from the paper doll)
    for (const e of s?.character?.equipment || []) if (e?.item?.name) equipped.set(normSlot(e.slot), { ...e.item, slot: normSlot(e.slot) });
    const eqIds = new Set([...equipped.values()].map((i) => i.id).filter(Boolean));
    const where = new Map(); // item id -> bag
    for (const b of bags) for (const it of b.items || []) {
      if (!where.has(it.id)) where.set(it.id, b);
      if (it.equipped && it.slot && !equipped.has(normSlot(it.slot))) { equipped.set(normSlot(it.slot), it); eqIds.add(it.id); }
    }
    return { bags, equipped, eqIds, where };
  }
  const findItem = (ix, id) => { for (const b of ix.bags) for (const it of b.items || []) if (it.id === id) return { it, bag: b }; return null; };

  function toggleBag(id, ctx, force) {
    const want = force ?? !open.has(id);
    want ? open.add(id) : open.delete(id);
    save(); app.audio.tick(); ctx.rerender();
  }

  async function equip(it, slot, equipped) {
    app.audio.tick();
    const r = await act({ type: "item.equip", itemId: it.id, slot, equipped });
    app.toasts.notice(r?.ok ? r.speech || (equipped ? "Confirmed." : "Removed.") : "Not saved: " + (r?.error || "no answer"), r?.ok ? null : "bad", r?.ok ? "check" : "warning");
  }
  function itemCard(it, bag, label, s) {
    return h("div.icard", { data: { rarity: it.rarity || "common" } },
      h("div.icard__label", label),
      h("div.icard__top", slotTile(it, { tip: { where: bag?.name } }),
        h("div", h("div.icard__name.rar", { data: { rarity: it.rarity || "common" } }, it.name), h("div.icard__kicker", [cap(it.rarity || "common"), it.slot ? slotLabel(normSlot(it.slot)) : null, it.cat ? cap(it.cat) : null].filter(Boolean).join(" · ")))),
      it.detail ? h("p.icard__detail", it.detail) : null,
      h("div.kvs",
        h("div.kv", h("span.kv__k", "Value"), h("span.kv__v", has(it.valueUsd) ? money(it.valueUsd) : nosig())),
        it.qty > 1 ? h("div.kv", h("span.kv__k", "Quantity"), h("span.kv__v", String(it.qty))) : null,
        h("div.kv", h("span.kv__k", "Stored"), h("span.kv__v", bag ? bag.name : nosig())),
        h("div.kv", h("span.kv__k", "Source"), h("span.kv__v", it.source || s?.inventory?.source || "not reported"))));
  }

  function inspect(s, ix, ctx) {
    const hit = selected ? findItem(ix, selected) : null;
    if (!hit) return null;
    const { it, bag } = hit;
    const slot = normSlot(it.slot);
    const isEq = ix.eqIds.has(it.id);
    const worn = slot ? ix.equipped.get(slot) : null;
    const compare = worn && !isEq && worn.id !== it.id;
    const wornBag = worn ? ix.where.get(worn.id) : null;
    return h("section.inspect.frame.hit", { class: compare ? "is-compare" : "" }, corners(),
      h("header.frame__head", h("span.frame__title", compare ? "Compare · " + slotLabel(slot) : "Item"),
        h("button.xbtn", { type: "button", "aria-label": "Close", onClick: () => { selected = null; ctx.rerender(); } }, icon("close"))),
      h("div.inspect__body",
        compare ? itemCard(worn, wornBag, "Equipped", s) : null,
        itemCard(it, bag, compare ? "In bags" : isEq ? "Equipped" : slot ? slotLabel(slot) + " · slot is empty" : "In bags", s)),
      compare ? h("p.note", "One equipped item per slot. The swap happens in the real world; the paper doll follows the catalogue.") : null,
      isEq && it.assumed ? h("div.inspect__assumed", h("span", icon("question"), "Assumed from inventory, not confirmed."),
        h("button.lbtn", { type: "button", onClick: () => equip(it, slot, true) }, icon("check"), "Confirm"), h("button.lbtn", { type: "button", onClick: () => equip(it, slot, false) }, icon("close"), "Remove")) : null,
      it.bagId && ix.bags.some((b) => b.id === it.bagId) ? h("button.lbtn", { type: "button", onClick: () => toggleBag(it.bagId, ctx, true) }, "Open this bag", icon("right")) : null);
  }

  function bagWindow(b, s, ix, ctx) {
    const items = b.items || [];
    const cols = isNarrow() ? 6 : items.length > 60 ? 8 : items.length > 24 ? 6 : items.length > 12 ? 5 : 4;
    const pad = Math.max(2, Math.ceil(items.length / cols)) * cols - items.length;
    const parent = b.parent ? ix.bags.find((x) => x.id === b.parent) : null;
    const win = h("section.bagwin.frame.hit", { style: { "--cols": cols }, data: { bag: b.id } }, corners(),
      h("header.bagwin__head",
        h("span.bagwin__ico", icon(bagIcon(b))),
        h("span.bagwin__title", h("b", b.name), h("small", parent ? "in " + parent.name : b.location && b.location !== b.name ? b.location : b.kind === "location" ? "Location" : "")),
        h("button.xbtn", { type: "button", "aria-label": "Close " + b.name, onClick: () => toggleBag(b.id, ctx, false) }, icon("close"))),
      h("div.bagwin__grid" + (items.length > 48 ? ".scroll" : ""), { data: items.length > 48 ? { scroll: "bag-" + b.id } : null },
        items.map((it) => slotTile(it, {
          class: (ix.eqIds.has(it.id) ? "is-equipped " : "") + (selected === it.id ? "is-selected " : "") + (it.bagId ? "is-bag " : ""),
          tip: { where: b.name, source: s?.inventory?.source, asOf: s?.inventory?.asOf ?? s?.asOf },
          onClick: () => { selected = selected === it.id ? null : it.id; app.audio.tick(); if (it.bagId && ix.bags.some((x) => x.id === it.bagId)) open.add(it.bagId), save(); ctx.rerender(); },
        })),
        Array.from({ length: Math.max(0, pad) }, () => slotTile(null))),
      h("footer.bagwin__foot", h("span", ((n) => `${n} item${n === 1 ? "" : "s"}`)(items.reduce((a, i) => a + (i.qty || 1), 0)))));
    return win;
  }

  return {
    onOpen(opts) { if (opts?.focus) selected = opts.focus; },
    render(root, s, ctx) {
      const ix = index(s);
      const inv = s?.inventory;
      if (!ix.bags.length) {
        fill(root, h("section.bagbar.frame.hit", corners(), h("header.frame__head", h("span.frame__title", icon("bags"), "Bags"), ctx.closeBtn()),
          emptyState(s ? "No bags recorded" : NO_SIGNAL, "Bags are real containers and locations. None have arrived from the engine.")));
        return;
      }
      if (!open || (open.size && [...open].every((id) => !ix.bags.some((b) => b.id === id)))) {
        // first visit: what the player carries and the main containers, never the unsorted pile
        const pickable = ix.bags.filter((b) => b.kind !== "unsorted" && (b.items || []).length);
        open = new Set(pickable.slice(0, isNarrow() ? 2 : 5).map((b) => b.id));
      }
      if (selected) { const hit = findItem(ix, selected); if (hit) open.add(hit.bag.id); else selected = null; }

      const bar = h("section.bagbar.frame.hit", corners(),
        h("header.frame__head", h("span.frame__title", icon("bags"), "Bags"), ctx.closeBtn()),
        h("div.bagbar__label", "Equipped"),
        h("div.bagbar__equip", EQUIP_SLOTS.map((slot) => {
          const it = ix.equipped.get(slot);
          return it ? slotTile(it, { slot, class: (selected === it.id ? "is-selected " : ""), tip: { where: ix.where.get(it.id)?.name || "Equipped" }, onClick: () => { selected = selected === it.id ? null : it.id; app.audio.tick(); ctx.rerender(); } }) : slotTile(null, { slot });
        })),
        h("div.bagbar__label", "Bag slots"),
        h("div.bagbar__slots", ix.bags.map((b) => {
          const btn = h("button.bagslot", { type: "button", class: (open.has(b.id) ? "is-open " : "") + (b.parent ? "is-nested" : ""), data: { kind: b.kind || null }, "aria-pressed": String(open.has(b.id)), "aria-label": b.name, onClick: () => toggleBag(b.id, ctx) },
            h("span.bagslot__ico", icon(bagIcon(b)), h("span.bagslot__n", String((b.items || []).length))), h("span.bagslot__name", b.name));
          tip(btn, () => ({ kicker: b.parent ? "Bag inside a bag" : "Bag", title: b.name, lines: [b.kind ? ["Kind", cap(b.kind)] : null, ["Location", b.location || null], b.parent ? ["Inside", ix.bags.find((x) => x.id === b.parent)?.name] : null, ["Items", (b.items || []).length]], source: b.source ?? inv?.source ?? null, asOf: b.asOf ?? inv?.asOf ?? s?.asOf ?? null }), { tap: false, place: "bottom" });
          return btn;
        })),
        h("div.bagbar__tools",
          h("button.lbtn", { type: "button", onClick: () => { open = new Set(ix.bags.map((b) => b.id)); save(); ctx.rerender(); } }, "Open all"),
          h("button.lbtn", { type: "button", onClick: () => { open = new Set(); save(); ctx.rerender(); } }, "Close all")),
        (() => { const foot = h("footer.bagbar__foot",
            h("span", has(inv?.count) ? [h("b", num(inv.count)), " items"] : nosig("count: no signal")),
            h("span.bagbar__gold", icon("coin"), has(inv?.value) ? h("b", money(inv.value)) : nosig("value: no signal")));
          tip(foot, () => ({ title: "Belongings", lines: [["Items", has(inv?.count) ? num(inv.count) : null], ["Catalogued value", has(inv?.value) ? money(inv.value) : null], ["Bags", ix.bags.length]], source: inv?.source ?? null, asOf: inv?.asOf ?? s?.asOf ?? null }), { focusable: true });
          return foot; })());

      const wins = ix.bags.filter((b) => open.has(b.id)).map((b) => bagWindow(b, s, ix, ctx));
      fill(root, h("div.bagsui",
        h("div.bagsui__side", bar, inspect(s, ix, ctx)),
        h("div.bagsui__wins.scroll", { data: { scroll: "bagwins" } }, wins.length ? wins : h("div.bagsui__none.hit", "All bags are closed. Pick one from the bag bar."))));
    },
    back(rerender) { if (selected) { selected = null; rerender(); return true; } return false; },
  };
}

export default { id: "bags", title: "Bags", icon: "bags", mode: "bags", frameless: true, create };
