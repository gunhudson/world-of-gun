// Overlay route (/?overlay=1): his stats on a transparent page, no stage, no audio, for a stream or
// video overlay (his 2022 note: "a YouTube channel with the dashboard overlay"). Everything the HUD
// shows, in his order: the character (portrait, level, title, class), where he is and what he is doing,
// experience, the nine bars, the vitals, the day so far, streaks alive, the current quest.
// Options: &pos=tl|tr|bl|br (default bl), &scale=1.25, &show=head,xp,meters,vitals,day,streaks,quest
// (default all), &compact=1 (head, xp, quest), &mock=1, &skin=operative|pandora|azeroth.

import { h, has, num, cap, NO_SIGNAL, clockIn, fill } from "./dom.js";
import { icon } from "./icons.js";
import { store, subscribe, refresh, replaceState, pct } from "./store.js";
import { connectLive } from "./live.js";
import { bar, meterRow, ordered, METER_ORDER, VITAL_ORDER, METER_ICONS, corners, nosig, progressText, portrait } from "./widgets.js";

const PARTS = ["head", "xp", "meters", "vitals", "day", "streaks", "quest"];
const activityLabel = (a) => (!a?.name ? null : a.name === "sleeping" && a.inferred ? "Probably asleep" : cap(a.name));

export function startOverlay(root) {
  const q = new URLSearchParams(location.search);
  const pos = ["tl", "tr", "bl", "br"].includes(q.get("pos")) ? q.get("pos") : "bl";
  const scale = Math.max(0.5, Math.min(3, parseFloat(q.get("scale")) || 1));
  const compact = q.get("compact") === "1";
  const want = new Set(compact ? ["head", "xp", "quest"] : (q.get("show") || "").split(",").map((x) => x.trim()).filter((x) => PARTS.includes(x)));
  const show = (k) => want.size === 0 || want.has(k);
  const card = h("div.ovl.frame", { data: { pos, compact: compact ? "1" : null }, style: { "--scale": scale } });
  root.append(card);

  function paint(s) {
    const c = s?.character, main = s?.quests?.main, r = s?.realm, d = s?.day;
    const me = s?.characters?.find((x) => x.id === c?.id) || s?.characters?.[0] || null;
    const cls = me?.class;
    const p = pct(main?.progress);
    const xp = has(c?.xp) && has(c?.xpNext) && c.xpNext > 0 ? (c.xp / c.xpNext) * 100 : null;
    const alive = (s?.streaks || []).filter((st) => has(st.current) && st.current > 0 && st.alive !== false);
    const act = activityLabel(c?.activity);
    fill(card, ...corners(),
      show("head") ? h("header.ovl__head",
        me?.portrait || me?.img ? portrait({ ...me, kind: "player" }, "ovl__portrait") : h("span.ovl__lvl", h("b", has(c?.level) ? String(c.level) : "–")),
        h("div.ovl__id",
          h("b", c?.name || NO_SIGNAL),
          h("span.ovl__sub", [has(c?.level) ? "Level " + c.level : null, cls, c?.title].filter(Boolean).join(" · ") || "no signal"),
          h("span.ovl__where", r?.place ? [icon("pin"), r.place] : nosig("no place"), act ? [" · ", h("i", act)] : null)),
        h("div.ovl__right", me?.portrait || me?.img ? h("span.ovl__lvlsm", "Lv ", h("b", has(c?.level) ? String(c.level) : "–")) : null, h("span.ovl__time", clockIn(r?.tz)))) : null,
      show("xp") ? h("div.ovl__xp", bar({ key: "ovl:xp", value: xp, color: "var(--v-xp)", size: "xs", label: "Experience" }), h("span.ovl__xptext", xp == null ? nosig() : `${num(c.xp)} / ${num(c.xpNext)} XP`, has(c?.xpToday) ? h("small", " +" + num(c.xpToday) + " today") : null)) : null,
      show("meters") ? h("div.ovl__meters", ordered(c?.meters, METER_ORDER).map((m) => meterRow(m, { keyPrefix: "ovl", size: "sm" }))) : null,
      show("vitals") ? h("div.ovl__vitals", ordered(c?.vitals, VITAL_ORDER).map((v) => h("span.ovl__vital", { data: { id: v.id, stale: v.stale ? "1" : null } }, icon(METER_ICONS[v.id] || v.icon || v.id), h("b", has(v.display) ? v.display : has(v.value) ? String(Math.round(v.value)) : "–"), h("small", v.label || cap(v.id))))) : null,
      show("day") && d ? h("div.ovl__day",
        h("span", icon("sun"), "Day ", h("b", has(d.n) ? num(d.n) : "–")),
        h("span", "Grade ", h("b", d.grade || "–")),
        h("span", h("b", has(d.questsDone) && has(d.questsTotal) ? `${d.questsDone}/${d.questsTotal}` : "–"), " quests"),
        has(d.readiness) ? h("span", "Ready ", h("b", d.readiness + "%")) : null) : null,
      show("streaks") && alive.length ? h("div.ovl__streaks", alive.slice(0, 4).map((st) => h("span.ovl__streak", icon("flame"), h("b", String(st.current)), " ", st.label))) : null,
      show("quest") ? h("div.ovl__quest", { class: main ? "" : "is-null" },
        h("span.ovl__kicker", icon("crown"), "Current quest"),
        main ? [h("b", main.title), h("div.ovl__qbar", bar({ key: "ovl:q", value: p, color: "var(--accent)", size: "sm", label: main.title, nosigText: true }), h("span", p == null ? "" : Math.round(p) + "%")), progressText(main.progress) ? h("small", progressText(main.progress)) : null] : nosig()) : null,
      store.mock ? h("span.ovl__mock", "Mock data") : null,
    );
  }

  subscribe((s) => paint(s));
  paint(null);
  refresh("boot");
  connectLive({ onEvent: (ev, doc) => (doc ? replaceState(doc, "event") : refresh("event")), onState: (doc) => (doc ? replaceState(doc, "push") : refresh("push")) });
  setInterval(() => paint(store.state), 30000);
}
