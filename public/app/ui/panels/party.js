// Party and Guild (O): the companion (the AI and its hosts), the guild (the shared group and its
// treasury), and the party. With a long list, it defaults to the people in touch recently,
// strongest bond first, with a search box and view filters.

import { h, has, num, money, cap, age, NO_SIGNAL, fill } from "../dom.js";
import { icon } from "../icons.js";
import { tip } from "../tooltip.js";
import { bar, portrait, sectionHead, nosig, emptyState, chip, COLORS, numTip, kindOf } from "../widgets.js";
import { personCard, viewFilter, rankParty, squadBoard } from "../people.js";
import { createConnector } from "../connector.js";

const PAGE = 36;

function create(app) {
  let view = "bonded", query = "", shown = PAGE, allAccounts = false, connector = false;
  const conn = createConnector(app);
  const TOP = 5;
  const guildAccounts = (g) => { const l = g.accounts.slice().sort((a, b) => Math.abs(b.value || 0) - Math.abs(a.value || 0)); return allAccounts ? l : l.slice(0, TOP); };
  return {
    // openPanel("party", { connector: questId }) lands on the connector with that quest picked
    onOpen(opts) { if (opts?.connector) { connector = true; conn.open(opts.connector === true ? null : opts.connector); } },
    render(root, s, ctx) {
      if (!s) { fill(root, emptyState(NO_SIGNAL, "No party data has arrived from the engine.")); return; }
      const co = s.companion, party = s.party || [], g = s.guild;
      const guildChar = (s.characters || []).find((c) => kindOf(c) === "guild");
      const compChar = (s.characters || []).find((c) => kindOf(c) === "companion");
      const tone = { ok: "good", warn: "warn", down: "bad" };
      const statsSrc = co ? { source: co.statsSource ?? co.source, asOf: co.statsAsOf ?? co.asOf } : null;

      const companion = h("section.ccard", { data: { status: co?.status || "unknown" } },
        h("div.ccard__head", portrait({ ...(compChar || {}), kind: "companion" }, "ccard__portrait"),
          h("div", h("div.ccard__kicker", "Companion"), h("div.ccard__name", co?.name || compChar?.name || "Companion"),
            co?.status ? chip({ ok: "All well", warn: "Degraded", down: "Down" }[co.status] || co.status, tone[co.status]) : nosig())),
        compChar?.status || co?.headline ? h("p.ccard__status", compChar?.status || co.headline) : null,
        co ? [
          h("div.stats3",
            statCell("Skills", has(co.skills) ? num(co.skills) : null, statsSrc, s),
            statCell("Automations", has(co.automations) ? num(co.automations) : null, statsSrc, s, co.automationRuns ? [["Runs ok", co.automationRuns.ok], ["Runs failed", co.automationRuns.fail]] : null),
            statCell("Sessions today", has(co.sessionsToday) ? num(co.sessionsToday) : null, statsSrc, s)),
          (() => { const el = h("div.ccard__mana", h("span", icon("drop"), "Mana"), bar({ key: "co:mana", value: co.mana?.value, color: COLORS.mana, size: "md", label: "Mana" }), h("span", has(co.mana?.value) ? Math.round(co.mana.value) + "%" : ""));
            tip(el, () => ({ title: "Mana", value: has(co.mana?.value) ? Math.round(co.mana.value) + "%" : undefined, lines: [co.mana?.detail], source: co.mana?.source ?? co.source ?? null, asOf: co.mana?.asOf ?? co.asOf ?? s.asOf ?? null, nosignal: !has(co.mana?.value) }), { focusable: true }); return el; })(),
          h("div.ccard__hostlist", (co.hosts || []).map((x) => { const el = h("div.hostrow", { data: { state: x.state } }, h("i"), h("b", x.name), h("span", x.detail || x.where || ""));
            tip(el, () => ({ kicker: "Host", title: x.name, value: cap(x.state || ""), lines: [x.where, x.detail, x.lastSeen ? ["Last seen", age(x.lastSeen)] : null, ...Object.entries(x.metrics || {}).filter(([, v]) => has(v)).slice(0, 6).map(([k, v]) => [k.replace(/_/g, " "), v])], source: x.source ?? co.source ?? null, asOf: x.asOf ?? co.asOf ?? s.asOf ?? null }), { focusable: true }); return el; })),
          co.office ? h("div.kv", h("span.kv__k", co.office.label || "Office"), h("span.kv__v", has(co.office.tempC) ? `${co.office.tempC}° · ${co.office.humidity}%` : nosig())) : null,
        ] : h("div.none", nosig()));

      const total = g?.total ?? guildChar?.treasury ?? null, cur = g?.currency || "USD";
      const vault = h("div.vault", { class: has(total) ? (g?.stale ? "is-stale" : "") : "is-null" },
        h("div.vault__label", icon("treasury"), "Guild treasury"),
        h("div.vault__value", has(total) ? money(total, cur) : h("span.nosig", NO_SIGNAL)),
        h("div.vault__detail", g?.detail || (has(total) ? "" : "No company balance has arrived."), g?.asOf ? " · " + age(g.asOf) : ""));
      tip(vault, () => ({ title: "Guild treasury", value: has(total) ? money(total, cur) : undefined, lines: [g?.detail, (g?.staleAccounts || []).length ? ["Stale accounts", g.staleAccounts.length] : null], note: has(total) ? null : "Company accounts are counted apart from the player's own gold. Empty until the collector sends them.", source: g?.source ?? null, asOf: g?.asOf ?? null, stale: !!g?.stale && has(total), nosignal: !has(total) }), { focusable: true });
      const guild = h("section.ccard",
        h("div.ccard__head", portrait({ ...(guildChar || {}), kind: "guild" }, "ccard__portrait"),
          h("div", h("div.ccard__kicker", "Guild"), h("div.ccard__name", g?.name || guildChar?.name || "Guild"), guildChar?.location ? h("span.dim", guildChar.location) : null)),
        guildChar?.status ? h("p.ccard__status", guildChar.status) : null,
        vault,
        (g?.accounts || []).length ? h("div.accs", guildAccounts(g).map((a) => { const el = h("div.acc", { data: { kind: a.kind } }, h("span.acc__ico", icon(a.kind === "crypto" ? "trinket" : a.kind === "debt" ? "warning" : "coin")), h("span.acc__name", a.name), h("span.acc__kind", a.institution || ""), h("span.acc__val", { class: has(a.value) && a.value < 0 ? "is-neg" : "" }, has(a.value) ? money(a.value, cur) : nosig()));
          tip(el, numTip(a.name, has(a.value) ? money(a.value, cur) : null, { source: a.source ?? g.source, asOf: a.asOf ?? g.asOf, stale: a.stale }, s, { kicker: a.institution || "Guild account" }), { focusable: true }); return el; })) : null,
        (g?.accounts || []).length > TOP ? h("button.lbtn", { type: "button", onClick: () => { allAccounts = !allAccounts; ctx.rerender(); } }, allAccounts ? "Largest only" : `All ${g.accounts.length} accounts`, icon(allAccounts ? "up" : "down")) : null,
        h("button.lbtn", { type: "button", onClick: () => { view = partyHas(party, "company") ? "company" : partyHas(party, "clients") ? "clients" : "all"; query = ""; shown = PAGE; ctx.rerender(); } }, "Show guild members", icon("right")));

      // Other worlds (docs/MULTIPLAYER.md): the card is shown once peering is on or a peer exists; production ships with it off,
      // so until then only the way in (the Squad & Sharing window) is drawn.
      const pe = s.peering, sq = s.squad;
      const squad = pe && (pe.enabled || (pe.peers || []).length) ? h("section.ccard.squad",
        h("div.squad__head", h("div.ccard__kicker", "Squad across worlds"), h("div.squad__title", h("span.ccard__name", pe.name || "This world"), chip(pe.enabled ? "Peering on" : "Peering off", pe.enabled ? "good" : "warn"))),
        h("p.ccard__status", pe.enabled ? `Sharing ${pe.fields.length ? pe.fields.length + " field" + (pe.fields.length > 1 ? "s" : "") : "nothing"} by default` + (pe.status ? ` · “${pe.status}”` : "") : "Nothing leaves this world."),
        (pe.peers || []).length ? h("div.ccard__hostlist", pe.peers.map((x) => { const el = h("div.hostrow", { data: { state: x.status === "active" ? (x.enabled ? "ok" : "warn") : "unknown" } }, h("i"), h("b", x.name || "Invited"), h("span", x.status === "active" ? (x.enabled ? `sharing ${(x.card?.fields || x.share || []).length}` : "paused") : "invite pending" + (x.lastError ? " · " + x.lastError : "")));
          tip(el, () => ({ kicker: "Peer world", title: x.name || "Invited", lines: [["Status", x.status], ["Sharing to them", x.enabled ? (x.card?.fields || x.share || []).join(", ") || "nothing" : "off"], ["Received from them", x.received ? x.received.fields.join(", ") : null], ["Last pull", x.lastPullAt ? age(x.lastPullAt) : null], x.lastError ? ["Last error", x.lastError] : null], source: "peer settings", asOf: x.lastPullAt ?? pe.asOf ?? null }), { focusable: true }); return el; })) : h("div.none", "No peer worlds yet."),
        squadBoard(sq),
        h("button.lbtn", { type: "button", onClick: () => app.openPanel("share") }, "Squad & Sharing", icon("right")),
      ) : h("button.lbtn.pp__share", { type: "button", onClick: () => app.openPanel("share") }, icon("connection"), "Squad & Sharing", icon("right"));
      const grid = h("div.pp__grid.scroll", { data: { scroll: "pp-grid" } });
      const count = h("span.pp__count");
      // party members whose 3D character is built stand with him in the squad shot and can take the dais alone
      const bodies = new Set((s.characters || []).filter((c) => !c.playable && c.model && (c.class === "Squad" || c.class === "Party")).map((c) => c.id));
      const squadBtn = h("button.lbtn.pp__squad", { type: "button", disabled: bodies.size ? null : "", "aria-disabled": String(!bodies.size), onClick: () => { if (bodies.size) app.showcaseStart("squad"); } }, icon("party"), "Squad shot");
      tip(squadBtn, () => ({ kicker: "Squad shot", title: bodies.size ? `${bodies.size} of the party stand with him` : "No party bodies yet", lines: [bodies.size ? "Everyone whose 3D character is built, together on the dais. Any key or tap returns." : "A member joins the shot once their 3D character is built from your photos .", bodies.size ? ["With him", [...bodies].map((id) => (s.characters || []).find((c) => c.id === id)?.name || id).join(", ")] : null], source: "deployed character files", asOf: s.asOf ?? null }), { focusable: true });
      const paintGrid = () => {
        const list = rankParty(party, view, query);
        count.textContent = query ? `${list.length} found` : `${list.length} of ${party.length}`;
        fill(grid, list.length ? [list.slice(0, shown).map((p) => personCard(p, s, bodies.has(p.id) ? { onStage: (id) => app.showcaseStart("member", id) } : {})),
          list.length > shown ? h("button.lbtn.pp__more", { type: "button", onClick: () => { shown += PAGE; paintGrid(); } }, `Show ${Math.min(PAGE, list.length - shown)} more of ${list.length - shown}`, icon("down")) : null]
          : h("div.none", query ? "Nobody matches that search." : view === "bonded" ? "No contact seen in the last 30 days." : "Nobody in this view."));
      };
      const search = h("input.search__input", { type: "search", placeholder: "Search " + party.length + " people", value: query, "aria-label": "Search the party", enterkeyhint: "search", autocomplete: "off", spellcheck: "false" });
      search.addEventListener("input", () => { query = search.value; shown = PAGE; paintGrid(); grid.scrollTop = 0; });
      search.addEventListener("keydown", (e) => { if (e.key === "Escape" && query) { query = ""; search.value = ""; paintGrid(); } e.stopPropagation(); });
      paintGrid();
      // the connector (Gun's 2022 sketch: "design complementary parties for X quests") replaces the card grid while it is on
      const connBtn = h("button.lbtn.pp__conn", { type: "button", class: connector ? "is-on" : "", "aria-pressed": String(connector), onClick: () => { connector = !connector; app.audio.tick(); ctx.rerender(); } }, icon("link"), connector ? "Party cards" : "Connector");
      const main = h("div.pp__main", { class: connector ? "is-connector" : "" },
        h("div.pp__head", h("span.sec__title", connector ? "Connector" : "My Party"), connector ? null : h("label.search", icon("search"), search), connector ? h("span.pp__count", "a party for a quest") : count, squadBtn, connBtn));
      if (connector) conn.render(main, s, ctx);
      else main.append(party.length ? viewFilter(party, view, (v) => { view = v; query = ""; shown = PAGE; app.audio.tick(); ctx.rerender(); }) : null, party.length ? grid : emptyState("No party records", "People arrive from the CRM."));
      fill(root, h("div.pp",
        h("div.pp__side.scroll", { data: { scroll: "pp-side" } }, companion, squad, guild),
        main,
      ));
    },
  };
}
const partyHas = (party, v) => party.some((p) => (p.views || []).includes(v));
function statCell(label, value, parent, s, lines) {
  const el = h("div.stat", h("div.stat__label", label), h("div.stat__value", has(value) ? value : nosig()));
  tip(el, numTip(label, value, parent, s, lines ? { lines } : {}), { focusable: true });
  return el;
}

export default { id: "party", title: "Party and guild", icon: "party", mode: "party", create };
