// Event feedback in the game's idiom: floating XP gains, a "Quest complete" banner, a
// full-screen level-up moment, loot and notice lines.

import { h, num, has, cap, wait } from "./dom.js";
import { icon } from "./icons.js";

export function createToasts(app) {
  const floats = h("div.toasts__floats");
  const banners = h("div.toasts__banners");
  const lines = h("div.toasts__lines");
  const el = h("div.toasts", floats, banners, lines);
  let bannerBusy = Promise.resolve();

  let moment = Promise.resolve();      // the full-screen level-up, if one is on
  let current = null;                  // the small banner on show
  let floating = 0;
  function xp(x, delay = 0) {
    if (!x || !has(x.amount)) return;
    // several gains at once (a burst of events) rise one after another instead of on top of each other
    const stagger = floating * 260; floating++;
    setTimeout(() => {
      const f = h("div.xpfloat", h("b", "+" + num(x.amount)), h("span", (x.area ? cap(x.area) + " " : "") + "XP"));
      f.style.setProperty("--dx", Math.round(Math.random() * 60 - 30) + "px");
      floats.append(f);
      setTimeout(() => { f.remove(); floating = Math.max(0, floating - 1); }, 2400);
    }, delay + stagger);
  }
  // Small banners run one at a time and stand aside while a level-up moment is on.
  function banner(build, hold, done) {
    bannerBusy = bannerBusy.then(async () => {
      for (;;) {
        await moment;
        const b = build(); if (!b) break;
        current = b; banners.append(b);
        const cut = await Promise.race([wait(hold).then(() => false), new Promise((r) => (b._cut = () => r(true)))]);
        b.classList.add("is-out"); await wait(450); b.remove(); if (current === b) current = null;
        if (!cut) break;           // cut short by a level-up: it comes back once the moment has passed
      }
      done?.();
    });
  }

  function quest(title, x, kicker = "Quest complete") {
    banner(() => h("div.qbanner",
      h("div.qbanner__rule", h("i"), icon("diamond"), h("i")),
      h("div.qbanner__kicker", kicker),
      h("div.qbanner__title", title || ""),
      x && has(x.amount) ? h("div.qbanner__xp", "+" + num(x.amount) + (x.area ? " " + cap(x.area) : "") + " XP") : null,
      h("div.qbanner__rule", h("i"), icon("diamond"), h("i"))), 3600);
  }

  // The character's own level: full screen, at once. Whatever small banner is up steps aside.
  function levelUp(level, name, rank) {
    const prev = moment;
    moment = (async () => {
      await prev;
      current?._cut?.();
      app.letterbox(true);
      el.parentNode?.classList.add("is-moment");
      const m = h("div.levelup",
        h("div.levelup__rays"),
        h("div.levelup__ring"),
        h("div.levelup__card",
          h("div.levelup__kicker", "Level up"),
          h("div.levelup__num", has(level) ? String(level) : ""),
          rank ? h("div.levelup__rank", rank) : null,
          h("div.levelup__name", name ? `${name} has reached ${has(level) ? "level " + level : "a new level"}` : "")));
      el.append(m);
      await wait(3900);
      m.classList.add("is-out");
      el.parentNode?.classList.remove("is-moment");
      if (app.screen === "world" || app.screen === "select") app.letterbox(false);
      await wait(700);
      m.remove();
    })();
  }

  // An attribute (one of the ten areas) levelled: a compact banner. Several levels in one area arriving
  // together (one large event) show once, at the highest level.
  const skills = new Map();   // area -> the banner queued or on show for it
  function skill(area, level, text) {
    const key = area || text || "skill";
    const had = skills.get(key);
    if (had) {
      if (!has(had.level) || (has(level) && level >= had.level)) {
        had.level = level; had.text = text;
        if (had.el?.isConnected) { const l = had.el.querySelector(".sbanner__lvl"), t = had.el.querySelector(".sbanner__text"); if (l && has(level)) l.textContent = String(level); if (t && text) t.textContent = text; }
      }
      return false;
    }
    const rec = { level, text, el: null };
    skills.set(key, rec);
    banner(() => (rec.el = h("div.sbanner", h("span.sbanner__ico", icon(area || "levelup")),
      h("div", h("div.sbanner__kicker", "Skill up"), h("div.sbanner__title", area ? cap(area) : rec.text || "Skill"), rec.text && area ? h("div.sbanner__text", rec.text) : null),
      has(rec.level) ? h("span.sbanner__lvl", String(rec.level)) : null)), 3000, () => skills.delete(key));
    return true;
  }
  function line(node, tone) {
    const l = h("div.tline", { data: { tone: tone || null } }, node);
    lines.append(l);
    while (lines.children.length > 4) lines.firstChild.remove();
    setTimeout(() => { l.classList.add("is-out"); setTimeout(() => l.remove(), 450); }, 4200);
  }
  function loot(name, rarity) {
    line([icon("bags"), h("span", "Catalogued "), h("b.rar", { data: { rarity: rarity || "common" } }, "[" + (name || "item") + "]")], "loot");
  }
  function notice(text, tone, ico) { line([icon(ico || "diamondo"), h("span", text)], tone); }

  return { el, xp, quest, levelUp, skill, loot, notice };
}
