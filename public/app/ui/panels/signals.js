// Signals: which devices and feeds are live, stale or off, so nothing is silently dead.

import { h, age, cap, NO_SIGNAL, fill } from "../dom.js";
import { icon } from "../icons.js";
import { tip } from "../tooltip.js";
import { store, refresh, linkState } from "../store.js";
import { nosig, emptyState, sectionHead } from "../widgets.js";

const ORDER = { live: 0, stale: 1, off: 2 };
const LINK = {
  live: ["Live", "WebSocket open. Events arrive within seconds."],
  polling: ["Polling", "The socket is down. The state is refetched every 60 seconds."],
  off: ["No signal", "The state endpoint is not answering."],
  mock: ["Mock data", "Layout file. No live channel, no real numbers."],
};

function create(app) {
  return {
    render(root, s) {
      const list = [...(s?.signals || [])].sort((a, b) => (ORDER[a.state] ?? 3) - (ORDER[b.state] ?? 3));
      const n = { live: 0, stale: 0, off: 0 };
      for (const x of list) n[x.state] = (n[x.state] || 0) + 1;
      const link = linkState();
      const [linkName, linkText] = LINK[link] || LINK.off;
      fill(root, h("div.sg",
        h("div.sg__link", { data: { link } },
          h("i.sg__dot"), h("div", h("b", linkName), h("span", linkText),
            h("span.sg__meta", store.lastOk ? "State last received " + age(new Date(store.lastOk).toISOString()) : "State never received", store.error ? " · " + store.error : "", s?.asOf ? " · document as of " + age(s.asOf) : "")),
          store.mock ? null : h("button.lbtn", { type: "button", onClick: () => { app.audio.tick(); refresh("manual"); } }, icon("refresh"), "Refetch")),
        h("div.sg__counts", ["live", "stale", "off"].map((k) => h("div.sg__count", { data: { state: k } }, h("b", s ? String(n[k]) : "–"), h("span", cap(k))))),
        sectionHead("Feeds", list.length ? String(list.length) : null),
        list.length ? h("div.sg__list.scroll", { data: { scroll: "sg" } }, list.map((x) => {
          const el = h("div.feed", { data: { state: x.state } }, h("i.feed__dot"), h("span.feed__label", x.label || x.id), h("span.feed__device", x.device || nosig("device not reported")), h("span.feed__age", x.asOf ? age(x.asOf) : nosig(x.state === "off" ? "never" : "age unknown")), h("span.feed__state", cap(x.state || "off")));
          tip(el, () => ({ kicker: "Feed", title: x.label || x.id, value: cap(x.state), lines: [["Device", x.device ?? null], x.via ? ["Via", x.via] : null, x.checkedAt ? ["Last checked", age(x.checkedAt)] : null, x.state === "off" ? "Wired in the contract, not reporting. Metrics that depend on it show no signal." : x.state === "stale" ? "Older than expected. Metrics that depend on it are marked stale." : null], source: x.device ?? null, asOf: x.asOf ?? null, nosignal: x.state === "off" }), { focusable: true });
          return el;
        })) : emptyState(s ? "No feeds listed" : NO_SIGNAL, s ? "The engine reported no signals." : "The state document has not arrived, so no feed can be shown."),
        app.stage.ready && app.stage.isStub ? h("p.note", "The 3D stage is running on its stub.") : null,
      ));
    },
  };
}

// The contract lists no stage mode for this window; it stays on the world shot.
export default { id: "signals", title: "Signals", icon: "signals", mode: "world", create };
