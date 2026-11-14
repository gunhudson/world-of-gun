// Treasury (T): gold, runway as a bar, accounts, income, BTC.

import { h, has, num, money, cap, age, NO_SIGNAL, counter, fill } from "../dom.js";
import { icon } from "../icons.js";
import { tip } from "../tooltip.js";
import { bar, sectionHead, nosig, emptyState, stat, numTip, sparkline, COLORS } from "../widgets.js";
import { byId } from "../store.js";

const KIND = { cash: ["Cash", "coin"], crypto: ["Crypto", "trinket"], debt: ["Debt", "warning"], asset: ["Assets", "box"] };

function create() {
  let showZero = false;
  return {
    render(root, s, ctx) {
      const t = s?.treasury;
      if (!t) { fill(root, emptyState(NO_SIGNAL, "No treasury data has arrived from the engine.")); return; }
      const cur = t.currency || "USD", g = t.gold || {}, r = t.runway || {};
      const vital = byId(s.character?.vitals, "gold");
      const goldTip = () => ({ title: "Gold", value: has(g.value) ? money(g.value, cur) : undefined, lines: [g.detail], source: g.source ?? null, asOf: g.asOf ?? null, stale: !!g.stale, nosignal: !has(g.value) });
      const hero = h("div.tr__hero",
        (() => { const el = h("div.tr__gold", { class: has(g.value) ? (g.stale ? "is-stale" : "") : "is-null" },
            h("div.tr__label", icon("coin"), "Gold"),
            h("div.tr__value", has(g.value) ? counter("tr:gold", g.value, (v) => money(Math.round(v), cur), { fromZero: true, ms: 1200 }) : h("span.nosig", NO_SIGNAL)),
            h("div.tr__detail", g.detail || "", g.asOf ? h("span", " · " + age(g.asOf)) : null));
          tip(el, goldTip, { focusable: true }); return el; })(),
        (() => { const el = h("div.tr__runway",
            h("div.tr__label", icon("hourglass"), "Runway"),
            h("div.tr__rvalue", has(r.days) ? [counter("tr:days", r.days, (v) => num(Math.round(v))), h("small", " days")] : h("span.nosig", NO_SIGNAL)),
            bar({ key: "tr:runway", value: vital?.value ?? null, color: COLORS.gold, size: "lg", label: "Runway", stale: vital?.stale }),
            h("div.tr__detail", has(r.burnPerDay) ? `Burn ${money(r.burnPerDay, cur)} a day` : nosig("burn: no signal"), vital?.detail && has(vital.value) ? h("span", " · bar from the Gold vital, " + Math.round(vital.value) + "%") : null));
          tip(el, () => ({ title: "Runway", value: has(r.days) ? num(r.days) + " days" : undefined, lines: [["Burn per day", has(r.burnPerDay) ? money(r.burnPerDay, cur) : null], ["Bar", has(vital?.value) ? Math.round(vital.value) + "% (Gold vital)" : null], vital?.detail], source: r.source ?? vital?.source ?? g.source ?? null, asOf: r.asOf ?? vital?.asOf ?? g.asOf ?? null, nosignal: !has(r.days) }), { focusable: true }); return el; })());

      const all = (t.accounts || []).slice().sort((a, b) => Math.abs(b.value || 0) - Math.abs(a.value || 0));
      const zero = all.filter((a) => has(a.value) && Math.round(a.value) === 0);
      const accounts = showZero ? all : all.filter((a) => !zero.includes(a));
      const accRow = (a) => { const el = h("div.acc", { data: { kind: a.kind } }, h("span.acc__ico", icon(KIND[a.kind]?.[1] || "coin")), h("span.acc__name", a.name), h("span.acc__kind", KIND[a.kind]?.[0] || cap(a.kind || "")), h("span.acc__val", { class: has(a.value) && a.value < 0 ? "is-neg" : "" }, has(a.value) ? money(a.value, cur) : nosig()));
        tip(el, numTip(a.name, has(a.value) ? money(a.value, cur) : null, { source: a.source ?? g.source, asOf: a.asOf ?? g.asOf, stale: a.stale }, s, { kicker: [KIND[a.kind]?.[0], a.institution].filter(Boolean).join(" · "), lines: [a.native && a.currency && a.currency !== cur ? ["Native", `${a.native} ${a.currency}`] : null] }), { focusable: true }); return el; };
      const income = t.income || [];
      const btc = t.btc;
      fill(root, h("div.tr",
        hero,
        h("div.tr__cols",
          h("div.tr__col.scroll", { data: { scroll: "tr-a" } },
            sectionHead("Accounts", all.length ? String(all.length) : null),
            accounts.length ? h("div.accs", accounts.map(accRow)) : h("div.none", nosig(all.length ? "every account is at zero" : "no accounts connected")),
            zero.length ? h("button.lbtn.tr__zero", { type: "button", onClick: () => { showZero = !showZero; ctx.rerender(); } }, showZero ? "Hide the empty ones" : `${zero.length} at zero`, icon(showZero ? "up" : "down")) : null),
          h("div.tr__col.scroll", { data: { scroll: "tr-b" } },
            sectionHead("Income"),
            income.length ? h("div.accs", income.map((i) => { const el = h("div.acc", h("span.acc__ico", icon("trendup")), h("span.acc__name", i.name), h("span.acc__kind", /^(last|this|past)/i.test(i.period || "") ? i.period : "per " + (i.period || "period")), h("span.acc__val.is-pos", has(i.value) ? money(i.value, cur) : nosig()));
              tip(el, numTip(i.name, has(i.value) ? money(i.value, cur) + " per " + (i.period || "period") : null, { source: i.source ?? g.source, asOf: i.asOf ?? g.asOf }, s, { kicker: "Income", lines: [has(i.payments) ? ["Payments", i.payments] : null] }), { focusable: true }); return el; })) : h("div.none", nosig("no income recorded")),
            sectionHead("Gold, last " + ((t.history || []).length || "") + " days"),
            h("div.sparkbox", sparkline(t.history, "gold", "var(--v-gold)")),
            sectionHead("Bitcoin"),
            btc ? (() => { const el = h("div.btc",
                stat("Price", has(btc.price) ? money(btc.price, "USD") : null),
                stat("From the high", has(btc.drawdownPct) ? [String(btc.drawdownPct), h("small", " %")] : null, null, has(btc.drawdownPct) && btc.drawdownPct < 0 ? "is-neg" : ""),
                stat("Phase", btc.phase || null));
              tip(el, () => ({ title: "Bitcoin", lines: [["Price", has(btc.price) ? money(btc.price, "USD") : null], ["Drawdown", has(btc.drawdownPct) ? btc.drawdownPct + "%" : null], ["Phase", btc.phase ?? null]], source: btc.source ?? null, asOf: btc.asOf ?? s.asOf ?? null }), { focusable: true }); return el; })() : h("div.none", nosig()),
          ))));
    },
  };
}

export default { id: "treasury", title: "Treasury", icon: "treasury", mode: "treasury", create };
