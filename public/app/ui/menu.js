// Small settings menu: skin, sound, and the way back to character select or the cold open.

import { h, fill } from "./dom.js";
import { icon } from "./icons.js";
import { SKINS, getSkin, setSkin } from "./skin.js";
import { corners } from "./widgets.js";
import { getHud, setHud, isAmbient, setAmbient } from "./hudmode.js";

export function createMenu(app) {
  const body = h("div.menu__body");
  const box = h("div.menu.frame.hit", { role: "dialog", "aria-label": "Settings" }, corners(),
    h("header.frame__head", h("span.frame__title", "Settings"),
      h("button.xbtn", { type: "button", "aria-label": "Close", onClick: () => close() }, icon("close"))),
    body);
  const el = h("div.menu-layer", h("div.menu__scrim.hit", { onClick: () => close() }), box);
  let open = false, page = "settings";

  function paint() {
    const skin = getSkin(), muted = app.audio.muted;
    fill(body, 
      h("div.menu__label", "Skin"),
      h("div.menu__skins", SKINS.map((s) =>
        h("button.skinbtn", { type: "button", class: s.id === skin ? "is-on" : "", "aria-pressed": String(s.id === skin), onClick: () => { setSkin(s.id); app.audio.tick(); paint(); } },
          h("span.skinbtn__sw", s.swatch.map((c) => h("i", { style: { background: c } }))),
          h("span.skinbtn__name", s.name), h("span.skinbtn__note", s.note)))),
      app.screen === "world" ? [h("div.menu__label", "Heads-up display"),
        h("div.seg", [["calm", "Calm", "The realm owns the screen"], ["full", "Full HUD", "Everything at once"]].map(([id, name, note]) =>
          h("button.seg__btn", { type: "button", class: getHud() === id ? "is-on" : "", "aria-pressed": String(getHud() === id), onClick: () => { setHud(id); app.audio.tick(); paint(); } }, h("b", name), h("small", note)))),
        h("button.menu__row", { type: "button", "aria-pressed": String(isAmbient()), onClick: () => { close(); setAmbient(!isAmbient()); } }, icon("moon"), h("span", "Ambient", h("small.menu__key", " key A")), h("i.switch", { class: isAmbient() ? "is-on" : "" }))] : null,
      app.screen === "world" ? [h("div.menu__label", "World"),
        h("button.menu__row", { type: "button", onClick: () => { close(); app.openPanel("share"); } }, icon("connection"), h("span", "Squad & Sharing", h("small.menu__key", " peer worlds")), icon("right"))] : null,
      h("div.menu__label", "Sound"),
      h("button.menu__row", { type: "button", "aria-pressed": String(!muted), onClick: () => { app.audio.toggleMute(); app.audio.tick(); paint(); } },
        icon(muted ? "mute" : "sound"), h("span", muted ? "Sound is off" : "Sound is on"), h("i.switch", { class: muted ? "" : "is-on" })),
      h("div.menu__label", "Showcase"),
      h("button.menu__row", { type: "button", onClick: () => { close(); app.showcase?.open(); } }, icon("screen"), h("span", "Showcase film", h("small.menu__key", " rendered offline")), icon("right")),
      h("div.menu__label", "Session"),
      app.screen === "world" ? h("button.menu__row", { type: "button", onClick: () => { close(); app.go("select"); } }, icon("exit"), h("span", "Character select")) : null,
      h("button.menu__row", { type: "button", onClick: () => { close(); app.go("title"); } }, icon("globe"), h("span", "Replay the cold open")),
    );
  }
  function show(p = "settings") { open = true; page = p; paint(); el.classList.add("is-on"); app.audio.tick(); }
  function close() { if (!open) return; open = false; el.classList.remove("is-on"); }
  app.audio.onChange(() => { if (open) paint(); });

  return { el, open: show, close, toggle: () => (open ? close() : show()), isOpen: () => open, update() { if (open) paint(); } };
}
