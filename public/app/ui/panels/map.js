// Map (M): place list beside the globe. Clicking a place flies the globe to it.

import { h, has, num, cap, dayAge, dateISO, dateOf, NO_SIGNAL, fill } from "../dom.js";
import { icon } from "../icons.js";
import { tip } from "../tooltip.js";
import { sectionHead, nosig, emptyState, stat, numTip } from "../widgets.js";

const placeId = (p) => p.id || p.name;

function create(app) {
  let selected = null;

  function fly(p) {
    selected = placeId(p);
    app.audio.tick();
    app.stage.setMode("map", { focus: { lat: p.lat, lon: p.lon }, clear: app.panels?.clearRect?.() || null });
  }

  return {
    modeOpts() {
      const w = app.store.state?.world, c = w?.current;
      return c && has(c.lat) ? { focus: { lat: c.lat, lon: c.lon } } : {};
    },
    render(root, s, ctx) {
      const w = s?.world;
      if (!w) { fill(root, emptyState(NO_SIGNAL, "No places have arrived from the engine.")); return; }
      const cur = w.current, places = [...(w.places || [])].sort((a, b) => String(b.last || "").localeCompare(String(a.last || "")));
      const bags = s?.inventory?.bags || [];
      const stored = (p) => bags.filter((b) => b.location && p.name && (b.location.toLowerCase().includes(p.name.toLowerCase().split(",")[0]) || p.name.toLowerCase().includes(b.location.toLowerCase().split(",")[0])));
      if (!selected && cur) selected = cur.name;
      fill(root, 
        h("div.mapp__stats",
          stat("Places", places.length ? num(places.length) : null, numTip("Places", places.length || null, w, s)),
          stat("Countries", has(w.countries) ? num(w.countries) : null, numTip("Countries", w.countries, w, s)),
          stat("Distance", has(w.distanceKm) ? [num(w.distanceKm), h("small", " km")] : null, numTip("Distance travelled", has(w.distanceKm) ? num(w.distanceKm) + " km" : null, w, s))),
        cur ? h("button.mapp__here", { type: "button", class: selected === cur.name ? "is-sel" : "", onClick: () => { fly(cur); ctx.rerender(); } },
          h("i.mapp__pulse"), h("span", h("small", "You are here"), h("b", cur.name)), has(cur.lat) ? h("span.mapp__coord", `${cur.lat.toFixed(2)}, ${cur.lon.toFixed(2)}`) : null)
          : h("div.mapp__here.is-null", nosig("current position: no signal")),
        sectionHead("Places", places.length ? String(places.length) : null),
        h("div.mapp__list.scroll", { data: { scroll: "places" } }, places.length ? places.map((p) => {
          const here = cur && p.name === cur.name, st = stored(p), items = st.reduce((a, b) => a + (b.items || []).length, 0);
          const row = h("button.place", { type: "button", class: (selected === placeId(p) ? "is-sel " : "") + (here ? "is-here" : ""), data: { kind: p.kind || "city" }, onClick: () => { fly(p); ctx.rerender(); } },
            h("span.place__ico", icon(p.kind === "home" ? "home" : p.kind === "country" ? "flag" : "pin")),
            h("span.place__name", p.name),
            h("span.place__meta", [has(p.visits) ? `${p.visits} visit${p.visits === 1 ? "" : "s"}` : null, p.last ? (dayAge(p.last) === "today" ? "here today" : "last " + dayAge(p.last)) : null].filter(Boolean).join(" · ") || nosig()),
            st.length ? h("span.place__bags", icon("bags"), String(items)) : null);
          tip(row, () => ({ kicker: cap(p.kind || "place"), title: p.name, lines: [["Visits", p.visits ?? null], ["First", p.first ? dateOf(dateISO(p.first)) : null], ["Last", p.last ? dateOf(dateISO(p.last)) : null], st.length ? ["Stored here", st.map((b) => b.name).join(", ")] : null], source: p.source ?? w.source ?? null, asOf: p.asOf ?? w.asOf ?? s.asOf ?? null }), { tap: false });
          return row;
        }) : h("div.none", nosig("no places recorded"))),
      );
    },
    focusPlace(id, rerender) { selected = id; rerender(); const row = document.querySelector(".place.is-sel"); row?.scrollIntoView({ block: "nearest" }); },
  };
}

export default { id: "map", title: "Map", icon: "map", mode: "map", create };
