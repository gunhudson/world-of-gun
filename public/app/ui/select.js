// Character select: roster on the right, the chosen character on the stage, ENTER WORLD for the
// playable one, a summary card for the others, realm line at the bottom.

import { h, has, num, money, clockIn, age, cap, NO_SIGNAL, fill } from "./dom.js";
import { icon, weatherIcon } from "./icons.js";
import { store, byId } from "./store.js";
import { portrait, kindOf, bar, COLORS, nosig, chip, corners } from "./widgets.js";
import { tip } from "./tooltip.js";
import { likenessLine } from "./people.js";

const KIND_LABEL = { player: "Playable", companion: "Companion", party: "Party", guild: "Guild" };

export function createSelect(app) {
  const list = h("div.roster__list");
  const plate = h("div.select__plate");
  const realmLine = h("div.select__realm");
  const el = h("section.select", { "aria-label": "Character select" },
    h("div.select__brand", h("span.select__brand-over", "World of"), h("span.select__brand-name", "Gun")),
    h("aside.roster.frame.hit", corners(), h("header.frame__head", h("span.frame__title", "Characters")), list),
    h("div.select__centre.hit", plate),
    h("footer.select__foot.hit", realmLine,
      h("div.select__tools",
        h("button.rbtn", { type: "button", "aria-label": "Settings", onClick: () => app.menu.toggle() }, icon("gear")),
      )),
  );
  let chosen = null, on = false, clock = null;

  function chars() { return store.state?.characters || []; }

  function choose(id, quiet) {
    if (!byId(chars(), id)) return;
    const changed = chosen !== id;
    chosen = id;
    if (changed && on) { app.stage.setCharacter(id); if (!quiet) app.audio.tick(); }
    paint();
    if (changed && on) app.selectLayoutChanged?.();   // a summary card is taller than the name plate
  }

  function row(c) {
    const kind = kindOf(c);
    const b = h("button.rchar", { type: "button", class: c.id === chosen ? "is-on" : "", data: { kind }, "aria-pressed": c.id === chosen ? "true" : "false", onClick: () => choose(c.id) },
      portrait(c, "rchar__portrait"),
      h("span.rchar__body",
        h("span.rchar__name", c.name || "Unnamed"),
        h("span.rchar__class", [has(c.level) ? "Level " + num(c.level) : null, c.class].filter(Boolean).join(" · ") || nosig()),
        h("span.rchar__loc", icon("pin"), c.location || nosig("location: no signal")),
      ),
      h("span.rchar__kind", c.class === "Squad" ? "Squad" : KIND_LABEL[kind] || cap(kind)),
    );
    b.addEventListener("pointerenter", () => app.audio.hover());
    return b;
  }

  function summary(c) {
    const s = store.state, kind = kindOf(c);
    const head = h("div.scard__head", h("span.scard__kind", KIND_LABEL[kind]), h("span.scard__name", c.name), c.title ? h("span.scard__title", c.title) : null);
    const body = h("div.scard__body");
    if (c.status) body.append(h("p.scard__status", c.status));
    if (kind === "companion" && s.companion) {
      const co = s.companion;
      const tone = { ok: "good", warn: "warn", down: "bad" }[co.status];
      body.append(
        h("div.scard__stats",
          kv("Status", co.status ? chip(co.status === "ok" ? "All well" : co.status === "warn" ? "Degraded" : "Down", tone) : nosig()),
          kv("Skills", has(co.skills) ? num(co.skills) : nosig()),
          kv("Automations", has(co.automations) ? num(co.automations) : nosig()),
          kv("Sessions today", has(co.sessionsToday) ? num(co.sessionsToday) : nosig()),
        ),
        h("div.scard__hosts", (co.hosts || []).map((x) => h("span.host", { data: { state: x.state } }, h("i"), x.name))),
        h("div.scard__bar", h("span", "Mana"), bar({ key: "sel:mana", value: co.mana?.value, color: COLORS.mana, size: "sm", label: "Mana", nosigText: true }), h("span", has(co.mana?.value) ? Math.round(co.mana.value) + "%" : "")),
      );
    } else if (kind === "party") {
      const p = byId(s.party, c.id);
      if (p) body.append(
        h("div.scard__stats",
          kv("Role", cap(p.role)),
          kv("Location", p.location || nosig()),
          kv("Last contact", p.lastContact ? age(p.lastContact) : nosig()),
        ),
        h("div.scard__bar", h("span", "Bond"), bar({ key: "sel:bond:" + p.id, value: p.bond, color: COLORS.bond, size: "sm", label: "Bond", nosigText: true }), h("span", has(p.bond) ? Math.round(p.bond) + "%" : "")),
        likenessLine(p) ? h("p.scard__note", icon("sparkle"), likenessLine(p)) : null,
      );
    } else if (kind === "guild") {
      const g = s.guild, total = g?.total ?? c.treasury ?? null;
      body.append(
        h("div.scard__vault", { class: has(total) ? "" : "is-null" }, h("span", "Guild treasury"), h("b", has(total) ? money(total, g?.currency || "USD") : nosig()),
          h("small", g?.detail || (has(total) ? "" : "No company balance has arrived."), g?.asOf ? " · " + age(g.asOf) : "")),
        h("div.scard__stats", kv("Accounts", (g?.accounts || []).length ? num(g.accounts.length) : nosig()), kv("Location", c.location || nosig())));
    }
    const open = { companion: ["party", "Open the companion sheet"], party: ["party", "Open the party"], guild: ["party", "Open the guild"] }[kind];
    const el = h("div.scard.frame", corners(), head, body,
      h("div.scard__foot", h("span", "Not playable"), open ? h("button.lbtn", { type: "button", onClick: async () => { await app.go("world"); app.openPanel(open[0]); } }, open[1], icon("right")) : null));
    return el;
  }
  const kv = (k, v) => h("div.kv", h("span.kv__k", k), h("span.kv__v", v));

  function paint() {
    const s = store.state, cs = chars();
    if (!chosen || !byId(cs, chosen)) chosen = cs.find((c) => c.playable)?.id || cs[0]?.id || null;
    fill(list, ...(cs.length ? cs.map(row) : [h("div.roster__empty", icon("nosignal"), h("div", NO_SIGNAL), h("p", store.status === "auth" ? "Session expired. Reload to sign in." : "The roster has not arrived. " + (store.error || "")))]));
    const c = byId(cs, chosen);
    fill(plate);
    if (c && c.playable) {
      plate.append(
        h("div.nameplate",
          h("div.nameplate__name", c.name),
          c.title ? h("div.nameplate__title", c.title) : null,
          h("div.nameplate__meta", [has(c.level) ? "Level " + num(c.level) : null, c.class, c.location].filter(Boolean).join("  ·  ")),
        ),
        h("button.enter", { type: "button", onClick: enterWorld }, h("span.enter__label", "Enter World"), h("i.enter__shine")),
      );
    } else if (c) plate.append(summary(c));
    else if (!cs.length) plate.append(h("button.enter.enter--ghost", { type: "button", onClick: enterWorld }, h("span.enter__label", "Enter anyway")));

    const r = s?.realm;
    fill(realmLine, 
      h("span.caps", "Realm"),
      r?.place ? h("b", r.place) : nosig("place: no signal"),
      h("span", clockIn(r?.tz)),
      r?.weather ? h("span.select__wx", icon(weatherIcon(r.weather.code, r.sun?.phase)), has(r.weather.tempC) ? Math.round(r.weather.tempC) + "°" : "", " ", r.weather.label || "") : null,
      has(r?.dayOfLife) ? h("span", "Day " + num(r.dayOfLife)) : null,
    );
    if (r) tip(realmLine, { title: r.place || "Realm", lines: [["Local time", clockIn(r.tz)], ["Timezone", r.tz], ["Sun", r.sun?.phase], r.room ? [r.room.label || "Room", `${r.room.tempC}° · ${r.room.humidity}%`] : null], source: r.source ?? null, asOf: r.asOf ?? null });
  }

  function enterWorld() { app.audio.panelOpen(); app.go("world"); }

  return {
    el,
    current: () => chosen || chars().find((c) => c.playable)?.id || null,
    // The part of the screen the roster and the button leave free, for stage.setMode opts.clear.
    // Call prepare() first so the name plate (or summary card) is laid out; entrance transforms are taken out.
    prepare() { paint(); },
    clearRect() {
      const vw = window.innerWidth, vh = window.innerHeight;
      const settled = (node) => { const r = node.getBoundingClientRect(); let dx = 0, dy = 0; try { const m = new DOMMatrixReadOnly(getComputedStyle(node).transform); dx = m.m41; dy = m.m42; } catch {} return { left: r.left - dx, top: r.top - dy, height: r.height }; };
      const r = settled(el.querySelector(".roster")), p = settled(plate);
      const plateTop = p.height > 0 ? p.top : vh * 0.7;
      return vw <= 700 ? { x: 0, y: 0, w: vw, h: Math.round(r.top) } : { x: 0, y: 0, w: Math.round(r.left), h: Math.round(plateTop) };
    },
    choose,
    enter() { on = true; paint(); el.classList.add("is-on"); if (chosen) app.stage.setCharacter(chosen); clock = setInterval(() => { if (!document.hidden) paint(); }, 20000); },
    leave() { on = false; clearInterval(clock); el.classList.remove("is-on"); },
    update() { if (on) paint(); },
    key(k, e) {
      const cs = chars(), i = cs.findIndex((c) => c.id === chosen);
      if (k === "ArrowDown" || k === "ArrowRight") { choose(cs[(i + 1) % cs.length]?.id); e.preventDefault(); }
      else if (k === "ArrowUp" || k === "ArrowLeft") { choose(cs[(i - 1 + cs.length) % cs.length]?.id); e.preventDefault(); }
      else if (k === "Enter") { const c = byId(cs, chosen); if (!c || c.playable) enterWorld(); e.preventDefault(); }
      else if (k === "Escape") app.menu.toggle();
    },
  };
}
