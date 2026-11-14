// Quest log (L): the main quest and its One Thing, dailies, weekly, the rebuild quests for the
// current place, then open tasks. Tasks sort One Thing first, then due date, then do date, and
// page so a long list stays readable. List on the left, the selected quest on the right.

import { h, has, num, cap, dayAge, dateISO, dateOf, NO_SIGNAL, isNarrow, fill } from "../dom.js";
import { icon } from "../icons.js";
import { pct, isDone, allQuests, getTasks } from "../store.js";
import { bar, questRow, progressText, sectionHead, nosig, emptyState } from "../widgets.js";
import { sourceRows } from "../tooltip.js";

const GROUPS = [["main", "Main quest"], ["daily", "Daily"], ["weekly", "Weekly"], ["rebuild", "Rebuild"], ["task", "Tasks"], ["side", "Side quests"]];
const PAGE = 15;
const far = "9999-12-31";

// Priority is text as the task source sends it ("⭐ One Thing", "High", "Medium", "Low"); the order mirrors the engine's.
const prText = (q) => String(q.priority ?? "");
const prRank = (q) => (q.oneThing === true || /one thing|⭐/i.test(prText(q)) ? 0 : typeof q.priority === "number" ? 5 - q.priority : /high|urgent/i.test(prText(q)) ? 1 : /medium/i.test(prText(q)) ? 2 : /low/i.test(prText(q)) ? 4 : 3);
const prLabel = (q) => (q.oneThing === true ? null : prText(q).replace(/[^\w ]/g, "").trim() || null);
function sortTasks(list) {
  return list.slice().sort((a, b) => (isDone(a) - isDone(b)) || (prRank(a) - prRank(b))
    || String(a.dueDate || far).localeCompare(String(b.dueDate || far)) || String(a.doDate || far).localeCompare(String(b.doDate || far)) || String(a.title).localeCompare(String(b.title)));
}

function create(app) {
  let selected = null, detailOpen = false, filter = "all", shown = PAGE, category = "all";
  let allTasks = null, loadingAll = false;   // from GET /api/tasks when quests.sideCut is true
  const asQuest = (t) => ({ ...t, id: String(t.id).startsWith("task:") ? t.id : "task:" + t.id, kind: "task", giver: t.world || "Tasks", text: [t.priority, t.world].filter(Boolean).join(" · ") || null, progress: { cur: 0, max: 1, unit: "", pct: 0 }, state: "active" });

  function detail(q, s) {
    if (!q) return emptyState("No quest selected", "Pick a quest from the list.");
    const p = pct(q.progress), done = isDone(q), one = q.kind === "main" ? q.oneThing : null;
    return [
      h("div.qd__kicker", { data: { kind: q.kind } }, icon(q.kind === "main" ? "crown" : "diamondo"), (GROUPS.find(([k]) => k === q.kind)?.[1] || cap(q.kind)).replace(/s$/, "") + (q.kind === "main" ? "" : " quest"),
        q.oneThing === true ? h("span.chip", "One Thing") : null,
        q.kind === "task" && prLabel(q) ? h("span.chip", { data: { tone: prRank(q) === 1 ? "warn" : null } }, prLabel(q)) : null,
        done ? h("span.chip", { data: { tone: "good" } }, "Complete") : q.state && q.state !== "active" ? h("span.chip", q.state === "nosignal" ? "No signal" : cap(q.state)) : null,
        q.next ? h("span.chip", { data: { tone: "warn" } }, "Next") : null),
      h("h3.qd__title", q.title),
      q.text && q.text !== q.title ? h("p.qd__text", q.text) : null,
      one ? h("div.qd__one", h("span.qd__one-k", "One Thing"), h("b", one.title), h("span", [one.period, one.due ? "due " + dateOf(dateISO(one.due)) : null].filter(Boolean).join(" · ")),
        one.next ? h("span.qd__one-next", icon("right"), `${one.next.label || "Next anchor"}${one.next.date ? " by " + dateOf(dateISO(one.next.date), undefined, { day: "numeric", month: "short" }) : ""}`) : null) : null,
      h("div.qd__prog",
        bar({ key: "qd:" + q.id, value: p, color: done ? "var(--green)" : "var(--accent)", size: "lg", label: q.title }),
        h("div.qd__nums", h("b", p == null ? "" : Math.round(p) + "%"), h("span", progressText(q.progress) || ""))),
      q.steps?.length ? [sectionHead("Steps", `${q.steps.filter((x) => x.done).length}/${q.steps.length}`),
        h("ol.qd__steps", q.steps.map((st) => h("li", { class: st.done ? "is-done" : st.missed ? "is-missed" : "" }, h("i", icon(st.done ? "check" : st.missed ? "close" : "diamondo")), h("span", st.title, st.missed ? h("small", " missed") : null))))] : null,
      sectionHead("Details"),
      h("div.kvs",
        h("div.kv", h("span.kv__k", "Given by"), h("span.kv__v", q.giver || nosig("not recorded"))),
        q.category ? h("div.kv", h("span.kv__k", "Category"), h("span.kv__v", q.category)) : null,
        q.world ? h("div.kv", h("span.kv__k", "World"), h("span.kv__v", cap(q.world))) : null,
        h("div.kv", h("span.kv__k", "Area"), h("span.kv__v", q.area ? [icon(q.area), " ", cap(q.area)] : nosig("none"))),
        q.kind === "task" ? h("div.kv", h("span.kv__k", "Do date"), h("span.kv__v", q.doDate ? `${dateOf(dateISO(q.doDate))} · ${dayAge(q.doDate)}` : nosig("none"))) : null,
        q.kind === "task" ? h("div.kv", h("span.kv__k", "Due"), h("span.kv__v", q.dueDate ? dateOf(dateISO(q.dueDate)) : nosig("none"))) : null,
        h("div.kv", h("span.kv__k", "Reward"), h("span.kv__v", has(q.xp) && q.xp ? h("b.xpv", "+" + num(q.xp) + " XP") : nosig("none")))),
      q.url ? h("a.lbtn.qd__link", { href: q.url, target: "_blank", rel: "noopener noreferrer" }, "Open the task", icon("right")) : null,
      // Gun's 2022 sketch: "design complementary parties for X quests" (the Party window's connector)
      h("button.lbtn.qd__party", { type: "button", onClick: () => app.openPanel("party", { connector: q.id }) }, icon("party"), "Design a party for this quest", icon("right")),
      h("div.qd__src", sourceRows({ source: q.source ?? null, asOf: q.asOf ?? s?.asOf ?? null })),
      h("p.note", q.kind === "rebuild" ? "Rebuild quests settle by voice or from a place event. There is no button to claim one." : "Quests complete from data. There is no button to claim one."),
    ];
  }

  return {
    onOpen(opts) { if (opts?.focus) { selected = opts.focus; detailOpen = true; } },
    render(root, s, ctx) {
      let qs = allQuests(s);
      if (allTasks && s?.quests?.sideCut) { const have = new Set(qs.map((q) => q.id)); qs = [...qs, ...allTasks.map(asQuest).filter((q) => !have.has(q.id))]; }
      if (!qs.length) { fill(root, emptyState(s ? "No quests" : NO_SIGNAL, "The quest log fills from the engine. Nothing has arrived.")); return; }
      if (!selected || !qs.some((q) => q.id === selected)) selected = qs[0].id;
      const cur = qs.find((q) => q.id === selected);
      const narrow = isNarrow();
      const pick = (q) => () => { selected = q.id; detailOpen = true; app.audio.tick(); ctx.rerender(); };
      const by = (k) => qs.filter((q) => q.kind === k);
      const groups = GROUPS.filter(([k]) => by(k).length);
      const row = (q) => questRow(q, { class: (q.id === selected && !narrow ? "is-sel " : "") + (q.oneThing === true ? "is-one " : "") + (q.next ? "is-next " : "") + (q.kind === "task" && prRank(q) === 1 ? "is-high" : ""), raw: q.kind !== "main" && q.kind !== "task", onClick: pick(q) });
      const chips = h("div.vfilter.ql__filter", [["all", "All", qs.length], ...groups.filter(([k]) => k !== "main").map(([k, label]) => [k, label, by(k).filter((q) => !isDone(q)).length])].map(([id, label, n]) =>
        h("button.vchip", { type: "button", class: id === filter ? "is-on" : "", "aria-pressed": String(id === filter), onClick: () => { filter = id; shown = PAGE; category = "all"; app.audio.tick(); ctx.rerender(); } }, label, h("b", String(n)))));

      const sections = [];
      for (const [kind, label] of groups) {
        if (filter !== "all" && filter !== kind && !(kind === "main" && filter === "all")) continue;
        let items = by(kind);
        if (kind === "rebuild") items = items.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
        if (kind === "task" || kind === "side") {
          const cats = [...new Set(items.map((q) => q.category).filter(Boolean))];
          if (filter === kind && cats.length > 1) sections.push(h("div.vfilter.ql__cats", ["all", ...cats].map((c) => h("button.vchip", { type: "button", class: c === category ? "is-on" : "", onClick: () => { category = c; shown = PAGE; ctx.rerender(); } }, c === "all" ? "Every category" : c))));
          if (filter === kind && category !== "all") items = items.filter((q) => q.category === category);
          items = sortTasks(items);
          const limit = filter === "all" ? 5 : shown;
          const openN = items.filter((q) => !isDone(q)).length;
          const total = kind === "task" && has(s?.quests?.openTasks) && s.quests.openTasks > openN && category === "all" ? ` of ${s.quests.openTasks}` : "";
          sections.push(sectionHead(label, `${openN}${total} open`), h("div.qlist", items.slice(0, limit).map(row)),
            items.length > limit ? h("button.lbtn.qlist__more", { type: "button", onClick: () => { if (filter === "all") { filter = kind; shown = PAGE; } else shown += PAGE; ctx.rerender(); } }, filter === "all" ? `All ${items.length} ${label.toLowerCase()}` : `Show ${Math.min(PAGE, items.length - limit)} more of ${items.length - limit}`, icon(filter === "all" ? "right" : "down")) : null);
          if (kind === "task" && s?.quests?.sideCut && !allTasks) sections.push(h("button.lbtn.quests__cut", { type: "button", onClick: () => { if (loadingAll) return; loadingAll = true; ctx.rerender(); getTasks().then((t) => { loadingAll = false; allTasks = t || []; ctx.rerender(); }); } },
            loadingAll ? "Reading…" : `The state carries ${s.quests.openTasksShown ?? items.length} of ${s.quests.openTasks ?? "all"} tasks. Load the rest`, icon("down")));
          continue;
        }
        sections.push(sectionHead(label, kind === "main" ? null : `${items.filter(isDone).length}/${items.length}`), h("div.qlist", items.map(row)));
      }
      const d = s?.day;
      const head = h("div.ql__day",
        h("div.stat", h("div.stat__label", "Today"), h("div.stat__value", has(d?.questsDone) ? `${d.questsDone} / ${d.questsTotal}` : nosig())),
        h("div.stat", h("div.stat__label", "XP today"), h("div.stat__value", has(d?.xp) ? "+" + num(d.xp) : nosig())),
        h("div.stat", h("div.stat__label", "Open tasks"), h("div.stat__value", has(s?.quests?.openTasks) ? num(s.quests.openTasks) : nosig())));
      const det = h("div.ql__detail.scroll", { data: { scroll: "qd" } },
        narrow ? h("button.lbtn.ql__back", { type: "button", onClick: () => { detailOpen = false; ctx.rerender(); } }, icon("right"), "All quests") : null,
        detail(cur, s));
      fill(root, h("div.ql", { class: narrow && detailOpen ? "is-detail" : "" }, h("div.ql__left", head, chips, h("div.ql__list.scroll", { data: { scroll: "ql-" + filter } }, sections)), det));
    },
    back(rerender) { if (isNarrow() && detailOpen) { detailOpen = false; rerender(); return true; } return false; },
  };
}

export default { id: "quests", title: "Quest log", icon: "quests", mode: "quests", create };
