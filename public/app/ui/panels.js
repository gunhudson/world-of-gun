// Panel windows. One panel is open at a time; opening one sets the matching stage mode.
// Each panel module exports { id, title, icon, mode, tabs?, frameless?, create(app) -> view }.
// A view has render(root, state, ctx) and may have key(k), back(), focusPlace(id).

import { h, fill } from "./dom.js";
import { icon } from "./icons.js";
import { store } from "./store.js";
import { corners } from "./widgets.js";
import { hide as hideTip, prune as pruneTip } from "./tooltip.js";
import character from "./panels/character.js";
import bags from "./panels/bags.js";
import quests from "./panels/quests.js";
import map from "./panels/map.js";
import treasury from "./panels/treasury.js";
import party from "./panels/party.js";
import needs from "./panels/needs.js";
import signals from "./panels/signals.js";
import chronicle from "./panels/chronicle.js";
import share from "./panels/share.js";

const DEFS = { character, bags, quests, map, treasury, party, needs, signals, chronicle, share };

export function createPanels(app) {
  const el = h("div.panels");
  const views = {};
  let cur = null; // { id, def, view, win, body, tab }

  function build(id, opts) {
    const def = DEFS[id];
    const view = (views[id] ||= def.create(app));
    const body = h("div.win__body");
    const tabsEl = h("nav.win__tabs", { role: "tablist" });
    const close = h("button.xbtn", { type: "button", "aria-label": "Close (Esc)", onClick: () => app.closePanel() }, icon("close"));
    let win;
    if (def.frameless) {
      win = h("section.win.win--" + id + ".win--bare", { "aria-label": def.title }, body);
    } else {
      win = h("section.win.frame.hit.win--" + id, { role: "dialog", "aria-label": def.title }, corners(),
        h("header.win__head", h("span.win__title", icon(def.icon), h("span", def.title)), tabsEl, close), body);
    }
    cur = { id, def, view, win, body, tabsEl, tab: opts.tab && def.tabs?.some((t) => t.id === opts.tab) ? opts.tab : view.tab || def.tabs?.[0]?.id || null };
    view.tab = cur.tab;
    view.onOpen?.(opts);
    return win;
  }

  function paintTabs() {
    if (!cur?.def.tabs) return;
    fill(cur.tabsEl, ...cur.def.tabs.map((t) =>
      h("button.tab", { type: "button", role: "tab", class: t.id === cur.tab ? "is-on" : "", "aria-selected": String(t.id === cur.tab), onClick: () => setTab(t.id) }, t.label)));
  }
  function setTab(id) {
    if (!cur || cur.tab === id) return;
    cur.tab = cur.view.tab = id;
    app.audio.tick();
    hideTip();
    render();
    if (cur.def.mode && window.innerWidth <= 700) app.stage.setMode(cur.def.mode, { ...(cur.view.modeOpts?.() || {}), clear: clearRect() });
    cur.body.classList.remove("is-swap"); void cur.body.offsetWidth; cur.body.classList.add("is-swap");
  }

  function render() {
    if (!cur) return;
    const keep = [...cur.win.querySelectorAll("[data-scroll]")].map((n) => [n.dataset.scroll, n.scrollTop, n.scrollLeft]);
    paintTabs();
    cur.win.dataset.tab = cur.tab || "";
    try {
      cur.view.render(cur.body, store.state, { tab: cur.tab, setTab, rerender: render, close: () => app.closePanel(), closeBtn: () => h("button.xbtn", { type: "button", "aria-label": "Close (Esc)", onClick: () => app.closePanel() }, icon("close")) });
    } catch (e) {
      console.error("[panel] " + cur.id + " failed to render", e);
      fill(cur.body, h("div.empty", h("div.empty__title", "This window could not be drawn"), h("div.empty__text", String(e.message || e))));
    }
    pruneTip();
    for (const [key, top, left] of keep) { const n = cur.win.querySelector(`[data-scroll="${key}"]`); if (n) { n.scrollTop = top; n.scrollLeft = left; } }
  }

  // Where the stage shows through while this panel is open, in CSS pixels. Passed to
  // stage.setMode as opts.clear so the stage can frame its subject inside it (optional for the stage).
  function clearRect() {
    if (!cur) return null;
    const vw = window.innerWidth, vh = window.innerHeight, r = cur.win.getBoundingClientRect();
    const box = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
    if (cur.id === "character") { const c = cur.win.querySelector(".char__centre")?.getBoundingClientRect(); return c ? box(c.left, c.top, c.width, c.height - 12) : null; }
    if (cur.id === "bags") return vw <= 700 ? null : box(0, 0, r.left, vh);
    if (cur.id === "map") return vw <= 700 ? box(0, 0, vw, r.top) : box(r.right, 0, vw - r.right, vh);
    return null;
  }

  return {
    el,
    clearRect,
    has: (id) => !!DEFS[id],
    open(id, opts = {}) {
      if (cur?.id === id) { // already open: a deep link into it
        if (opts.tab) setTab(opts.tab);
        cur.view.onOpen?.(opts); render();
        return;
      }
      const old = cur?.win;
      if (old) { old.classList.add("is-out"); setTimeout(() => old.remove(), 220); }
      const win = build(id, opts);
      el.append(win);
      render();
      requestAnimationFrame(() => win.classList.add("is-on"));
      app.stage.setMode(cur.def.mode || "world", { ...(cur.view.modeOpts?.() || {}), clear: clearRect() });
    },
    close() {
      if (!cur) return;
      const old = cur.win; try { cur.view.onClose?.(); } catch {} cur = null;
      old.classList.remove("is-on"); old.classList.add("is-out");
      setTimeout(() => old.remove(), 240);
    },
    update() { if (cur) render(); },
    key(k, e) { cur?.view.key?.(k, e, render); },
    back() { return !!cur?.view.back?.(render); },
    focusPlace(id) { cur?.view.focusPlace?.(id, render); },
  };
}
