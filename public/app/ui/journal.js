// Journal: the manual facts no sensor can see, through POST /api/act. A quick popover over the
// action bar. These move the nine meters and never grant XP. The same facts can be sent by voice.

import { h, has, fill } from "./dom.js";
import { icon } from "./icons.js";
import { act } from "./store.js";
import { corners } from "./widgets.js";

const ROWS = [
  { id: "mood", label: "Mood", icon: "sparkle", meter: "Happiness", chips: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], body: (v) => ({ type: "checkin", mood: v }) },
  { id: "mindful", label: "Mindful", icon: "leaf", meter: "Self-connection", unit: "min", chips: [5, 10, 20, 30], body: (v) => ({ type: "mindful", minutes: v }) },
  { id: "learn", label: "Learning", icon: "offhand", meter: "Learning", unit: "min", chips: [15, 30, 60], body: (v) => ({ type: "learn", minutes: v }) },
  { id: "focus", label: "Focus block", icon: "eye", meter: "Focus", unit: "min", chips: [25, 50, 90], body: (v) => ({ type: "focus.block", minutes: v }) },
];

export function createJournal(app) {
  const body = h("div.journal__body"), result = h("div.journal__result", { "aria-live": "polite" });
  const box = h("div.journal.frame.hit", { role: "dialog", "aria-label": "Journal" }, corners(),
    h("header.frame__head", h("span.frame__title", icon("quill"), "Journal"), h("span.journal__rule", "Moves the meters. Grants no XP."),
      h("button.xbtn", { type: "button", "aria-label": "Close", onClick: () => close() }, icon("close"))),
    body, result);
  const el = h("div.journal-layer", h("div.journal__scrim.hit", { onClick: () => close() }), box);
  let open = false, busy = false, who = "";

  async function send(payload, label) {
    if (busy) return;
    busy = true; app.audio.tick();
    fill(result, h("span.journal__wait", "Logging " + label + "…"));
    const r = await act(payload);
    busy = false;
    if (!r?.ok) { fill(result, h("span.journal__err", icon("warning"), "Not logged: " + (r?.error || "no answer"))); return; }
    fill(result,
      h("span.journal__ok", icon("check"), r.speech || "Logged."),
      (r.meters || []).map((m) => (m.unchanged || m.before === m.after
        ? h("span.journal__meter", (m.label || m.id) + ": ", h("b", has(m.after) ? Math.round(m.after) + "%" : "no signal"), " (unchanged)")
        : h("span.journal__meter", (m.label || m.id) + ": ", has(m.before) ? Math.round(m.before) + "%" : "no signal", " → ", h("b", has(m.after) ? Math.round(m.after) + "%" : "no signal")))),
      h("span.journal__xp", "0 XP"));
  }

  function paint() {
    const input = h("input.journal__input", { type: "text", placeholder: "Who, and what (optional)", maxlength: "120", value: who, "aria-label": "Support given: who and what", enterkeyhint: "done" });
    input.addEventListener("input", () => { who = input.value; });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") give(); e.stopPropagation(); });
    const give = () => { const t = who.trim(); send({ type: "support.given", ...(t ? { what: t } : {}) }, "support given"); who = ""; input.value = ""; };
    fill(body,
      ROWS.map((r) => h("div.jrow", h("span.jrow__label", icon(r.icon), h("span", r.label), h("small", "→ " + r.meter)),
        h("div.jrow__chips", { data: { row: r.id } }, r.chips.map((v) => h("button.jchip", { type: "button", "aria-label": `${r.label} ${v}${r.unit ? " " + r.unit : ""}`, onClick: () => send(r.body(v), `${r.label.toLowerCase()} ${v}${r.unit ? " " + r.unit : ""}`) }, String(v), r.unit ? h("small", r.unit) : null))))),
      h("div.jrow", h("span.jrow__label", icon("heart"), h("span", "Support given"), h("small", "→ Giving")), h("div.jrow__chips", input, h("button.jchip.jchip--go", { type: "button", onClick: give }, "Log"))));
  }
  function show() { open = true; paint(); fill(result, h("span.journal__hint", "Moves the meters, grants no XP. One tap logs it; voice does the same.")); el.classList.add("is-on"); app.audio.tick(); }
  function close() { if (!open) return; open = false; el.classList.remove("is-on"); }
  return { el, open: show, close, toggle: () => (open ? close() : show()), isOpen: () => open };
}
