// Day-close card: shown on the first visit after a game day closed (day.lastClose.seen === false).
// Grade large, what completed, what was missed, streaks, and the companion's words; dismissing it
// marks the close as seen (POST /api/seen).

import { h, has, num, dateOf, fill } from "./dom.js";
import { icon } from "./icons.js";
import { store, markSeen } from "./store.js";
import { corners, portrait, nosig } from "./widgets.js";

const title = (x) => (typeof x === "string" ? x : x?.title || x?.label || x?.text || x?.id || "");

export function createDayClose(app) {
  const card = h("section.dclose.frame.hit", { role: "dialog", "aria-label": "Day closed" });
  const el = h("div.dclose-layer", h("div.dclose__scrim.hit", { onClick: () => dismiss() }), card);
  let open = null;                 // the date on show
  const done = new Set();          // dates dismissed in this page (covers a failed POST)
  const demo = new URLSearchParams(location.search).get("demo") === "close";

  function paint(lc, s) {
    const ent = s?.characters?.find((c) => c.kind === "ai" || c.id === "companion") || { id: "companion" };
    const chips = (list, cls, ico) => h("div.dclose__chips", list.map((x) => h("span.dq", { class: cls }, icon(ico), title(x))));
    const completed = lc.completed || [], missed = lc.missed || [], streaks = lc.streaks || [];
    fill(card, corners(),
      h("div.dclose__kicker", "Day closed"),
      h("div.dclose__head",
        h("span.dayc__grade.dclose__grade", { data: { g: lc.grade || null } }, lc.grade ?? "–"),
        h("div", h("div.dclose__date", lc.date ? dateOf(lc.date + "T12:00:00Z", "UTC", { weekday: "long", day: "numeric", month: "long" }) : ""),
          h("div.dclose__nums", h("b", has(lc.xp) ? "+" + num(lc.xp) + " XP" : nosig("xp: no signal")), has(lc.questsDone) && has(lc.questsTotal) ? h("span", `${lc.questsDone} of ${lc.questsTotal} quests`) : null))),
      lc.speech ? h("div.dclose__say", portrait({ ...ent, kind: "companion" }, "dclose__portrait"), h("p", lc.speech)) : lc.text ? h("p.dclose__text", lc.text) : null,
      completed.length ? [h("div.dclose__label", "Completed"), chips(completed, "is-done", "check")] : null,
      missed.length ? [h("div.dclose__label", "Missed"), chips(missed, "", "diamondo")] : null,
      streaks.length ? [h("div.dclose__label", "Streaks"), h("div.dclose__chips", streaks.map((x) => h("span.dq", { class: x.state === "broken" ? "is-broken" : "is-done" }, icon("flame"), `${x.label || x.id}${x.state ? ": " + x.state : ""}${has(x.length) ? " · " + x.length + " " + (x.unit || "") : ""}`)))] : null,
      h("div.dclose__foot", h("span", "Source: engine day close"), h("button.lbtn.dclose__go", { type: "button", onClick: () => dismiss() }, "Continue", icon("right"))));
  }

  function dismiss() {
    if (!open) return false;
    const date = open; open = null; done.add(date);
    el.classList.remove("is-on");
    app.audio.panelClose();
    markSeen(date);
    return true;
  }

  return {
    el,
    isOpen: () => !!open,
    dismiss,
    // Called on every state update while in the world.
    check(s) {
      const lc = s?.day?.lastClose;
      if (!lc || lc.seen !== false || !lc.date || done.has(lc.date)) return;
      if (store.mock && !demo) return;                 // layout runs stay clear of it
      if (app.screen !== "world") return;
      if (open === lc.date) { paint(lc, s); return; }
      open = lc.date; paint(lc, s);
      el.classList.add("is-on");
      app.audio.panelOpen();
    },
  };
}
