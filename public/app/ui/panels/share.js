// Squad & Sharing: the in-game face of docs/MULTIPLAYER.md. What leaves this world (the share profile and the exact
// card a peer would receive), the peers, invites, and the squad board. Every write is an owner-session call to
// /api/share or /api/peers*; the engine decides everything, this window only shows and asks. Nothing is invented:
// the preview is the engine's own card, an empty list says what is empty, an API error is shown word for word.

import { h, has, age, fill, dateOf } from "../dom.js";
import { icon } from "../icons.js";
import { store, refresh } from "../store.js";
import { sectionHead, nosig, emptyState, chip } from "../widgets.js";
import { peerValue, squadBoard } from "../people.js";

// The allowlist as src/peers.js has it, in its order, with what leaving the world means in plain words. The engine's own
// list (state.peering.allowlist) is the one drawn when present; this mirror orders it and adds the one-liners.
const PLAIN = {
  name: ["Name", "The character's name, as typed. Nothing else about who you are."],
  level: ["Level", "The level number only, never XP or what earned it."],
  title: ["Title", "The rank title (Initiate, Operative…), derived from level."],
  class: ["Class", "The class name, nothing behind it."],
  place: ["Place", "City only, never coordinates."],
  activity: ["Activity", "One word: idle, walking, training… No times, no basis."],
  streaks: ["Streaks", "Streak counts in days, not steps, hours or grams."],
  grade: ["Grade", "Today's letter grade. One letter."],
  stepsGoal: ["Steps goal", "Hit or not hit today, never the count."],
  status: ["Status line", "A line you wrote for peers. Nothing derived."],
  lastSeen: ["Last seen", "The hour a device last reported, floored to the hour."],
};
const ORDER = Object.keys(PLAIN);
const STEPS = [
  "Run your own world: fork the repo and deploy it to your own Cloudflare account (the free tier is enough). It starts empty and honest.",
  "In your world open Squad & Sharing, switch Peering on and give the world a name.",
  "Paste this code under “Accept an invite” there. Your world tells mine where it lives, signed; nothing is published anywhere.",
  "Done: each of us pulls the other's card. Change what you share, pause, or leave at any time.",
];

// One call to the owner-only peering routes. Never throws; a failure is { ok: false, error } with the engine's words.
async function api(path, method = "GET", body) {
  try {
    const res = await fetch(path, { method, credentials: "same-origin", redirect: "manual", cache: "no-store",
      headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined });
    const out = await res.json().catch(() => null);
    if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) return { ok: false, error: out?.error || "session expired" };
    if (!out) return { ok: false, error: "the engine did not answer (" + res.status + ")" };
    if (typeof out.ok !== "boolean") return res.ok ? { ok: true, ...out } : { ok: false, error: out.error || "HTTP " + res.status };
    return out;
  } catch (e) { return { ok: false, error: e?.name === "TimeoutError" ? "the engine did not answer in time" : "network unreachable" }; }
}

function create(app) {
  let peers = null;          // last GET /api/peers answer: the settings plus peers[] (no secrets)
  let loading = false, loadErr = null;
  const msg = {};            // per section: { text, tone }
  const busy = new Set();    // keys of in-flight writes
  let draft = null;          // { name, url, status } while the profile is being edited
  let invite = null;         // last successful invite: { code, expiresAt, peer }
  let inviteName = "", inviteShare = true, acceptCode = "", acceptShare = true, confirmRemove = null;
  const openLists = new Set();   // peer ids whose "what they see" editor is unfolded
  let pending = false, rerender = () => {};

  async function load() {
    if (store.mock || loading) return;
    loading = true; loadErr = null;
    const out = await api("/api/peers");
    loading = false;
    if (out.ok) peers = out; else loadErr = out.error;
    rerender();
  }
  // A write, then the fresh list and a fresh state document (the preview and the board come from the state).
  async function write(key, section, fn, after) {
    if (busy.has(key)) return;
    busy.add(key); for (const k of Object.keys(msg)) msg[k] = null; rerender();   // one message at a time: the latest action's
    const out = await fn();
    busy.delete(key);
    if (!out.ok) msg[section] = { text: out.error || "the engine refused without saying why", tone: "bad" };
    else if (after) after(out);
    app.audio.tick();
    await Promise.all([load(), store.mock ? null : refresh("share").catch(() => {})]);
    rerender();
  }
  const putShare = (section, patch, after) => write("share", section, () => api("/api/share", "PUT", patch), after);

  // Inputs keep the typed text across the store's re-renders: while one has focus the window is not rebuilt.
  function input(tag, props) {
    const el = h(tag + ".shinput", { autocomplete: "off", spellcheck: "false", ...props });
    el.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && tag === "input" && props.onEnter) { e.preventDefault(); props.onEnter(); } });
    // catch up on a skipped store update once no input has focus; a beat later, so a click that caused the blur lands on the button it aimed at
    el.addEventListener("blur", () => { setTimeout(() => { if (pending && !el.closest(".win__body")?.querySelector("input:focus, textarea:focus")) { pending = false; rerender(); } }, 320); });
    return el;
  }
  const sw = (on) => h("i.switch", { class: on ? "is-on" : "" });
  function row(label, note, on, onClick, extra = {}) {
    return h("button.shrow", { type: "button", class: (on ? "is-on " : "") + (extra.class || ""), role: "switch", "aria-checked": String(!!on), disabled: extra.disabled || null, onClick },
      h("span", h("b", label), note ? h("small", note) : null), sw(on));
  }
  const message = (section) => (msg[section] ? h("div.shmsg", { data: { tone: msg[section].tone }, role: "status" }, msg[section].text) : null);
  async function copy(text, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    if (!ok) { const ta = h("textarea", { style: { position: "fixed", opacity: 0 } }); ta.value = text; document.body.append(ta); ta.select(); try { ok = document.execCommand("copy"); } catch {} ta.remove(); }
    const was = btn.textContent; fill(btn, icon(ok ? "check" : "warning"), ok ? "Copied" : "Select and copy"); setTimeout(() => { if (btn.isConnected) fill(btn, icon("doc"), was); }, 1800);
    app.audio.tick();
  }

  // ---- what leaves my world --------------------------------------------------------------------------------------
  function profile(pe, set) {
    const on = !!set.enabled, fields = set.fields || [];
    const d = draft || { name: set.name || "", url: set.url || "", status: set.status || "" };
    const isDirty = () => !!draft && (draft.name !== (set.name || "") || draft.url !== (set.url || "") || draft.status !== (set.status || ""));
    const dirty = isDirty();
    // typing does not rebuild the window (the text would be lost), so the Save button is switched by hand and the rest catches up on blur
    const saveBtn = h("button.lbtn", { type: "button", disabled: !dirty || busy.has("share") || null, onClick: () => save() }, icon("check"), "Save profile");
    const edit = (k) => (e) => { draft = { ...(draft || d), [k]: e.target.value }; saveBtn.disabled = !isDirty() || busy.has("share"); };
    const save = () => { if (!isDirty()) return; const p = { name: draft.name, status: draft.status, url: draft.url.trim() }; putShare("profile", p, () => { draft = null; msg.profile = { text: "Saved.", tone: "good" }; }); };
    const addr = set.url || location.origin;
    const allow = pe?.allowlist && typeof pe.allowlist === "object" ? pe.allowlist : null;
    const ids = allow ? [...ORDER.filter((k) => k in allow), ...Object.keys(allow).filter((k) => !ORDER.includes(k))] : ORDER;
    const toggle = (id) => putShare("fields", { fields: fields.includes(id) ? fields.filter((f) => f !== id) : [...fields, id] });

    return [
      // wrapped in a div: Chromium sizes a <button> that is a direct grid item of the column to its min-height only
      h("div.shmaster", row("Peering", on ? "On. Peers you invited can pull the card below, signed with their pair secret." : "Off. Nothing leaves this world; the peer routes answer 404.", on,
        () => putShare("profile", { enabled: !on }), { class: "shrow--master " + (on ? "" : "is-off") })),
      message("profile"),
      on ? row("Pull peers' cards automatically", set.autoPull ? "On. About every five minutes, while peers are active; the same pull as Refresh, nothing is pushed." : "Off. Cards arrive only when you press Refresh.", !!set.autoPull,
        () => putShare("profile", { autoPull: !set.autoPull }), { disabled: busy.has("share") }) : null,
      h("div.shform",
        h("label.shfield", h("span", "World name"), input("input", { type: "text", value: d.name, placeholder: "How peers see this world", maxlength: 60, "aria-label": "World name", onInput: edit("name"), onEnter: save })),
        h("label.shfield", h("span", "Address"), input("input", { type: "url", value: d.url, placeholder: addr, maxlength: 200, "aria-label": "World address", onInput: edit("url"), onEnter: save })),
        h("label.shfield", h("span", "Status line"), input("input", { type: "text", value: d.status, placeholder: "One line for peers (shared only when ticked below)", maxlength: 200, "aria-label": "Status line", onInput: edit("status"), onEnter: save })),
        h("div.shacts",
          saveBtn,
          dirty ? h("button.lbtn", { type: "button", onClick: () => { draft = null; rerender(); } }, "Discard") : null,
          h("span.shhint", set.url ? "Peers reach this world at " + set.url : "Address left blank: peers reach this world at " + addr))),
      sectionHead("Fields in the card", `${fields.length} of ${ids.length}`),
      h("div.shfields", ids.map((id) => { const [label, plain] = PLAIN[id] || [allow?.[id]?.label || id, allow?.[id]?.note || ""]; return row(allow?.[id]?.label || label, plain, fields.includes(id), () => toggle(id)); })),
      message("fields"),
      sectionHead("The card a peer would receive now"),
      preview(pe, set),
    ];
  }
  // The engine builds the exact card per peer (state.peering.peers[].card). Draw the one for the default share list when a
  // peer has it, else the first active peer's and say whose; with no peer yet there is no card to show, and that is said.
  function preview(pe, set) {
    const fields = set.fields || [], list = (pe?.peers || []).filter((p) => p.card);
    const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    const owner = list.find((p) => same(p.card.fields, fields)) || list[0] || null;
    if (!set.enabled) return h("div.shcard.is-null", h("div.shcard__kicker", "Peering is off"), h("div.shcard__note", "No card leaves this world. Switch Peering on to see what a peer would receive."));
    if (!owner) return h("div.shcard.is-null", h("div.shcard__kicker", "No card built yet"),
      h("div.shcard__note", fields.length ? "The engine builds the exact card when the first peer is paired. It would carry: " + fields.map((f) => (PLAIN[f] || [f])[0].toLowerCase()).join(", ") + "." : "Nothing is ticked: the card would carry only the world name."));
    const c = owner.card;
    return h("div.shcard",
      h("div.shcard__kicker", icon("globe"), " Presence card"),
      h("div.shcard__name", c.world?.name || set.name || h("span.nosig", "unnamed world")),
      h("div.shcard__rows", c.fields.length ? c.fields.map((f) => h("div.shcard__row", h("span", (PLAIN[f] || [f])[0]), h("span", peerValue(f, c.values?.[f]) ?? nosig()))) : h("div.none", "No fields: only the world name leaves.")),
      h("div.shcard__foot", `As sent to ${owner.name || "a peer"}` + (same(c.fields, fields) ? "" : " (their own share list, not the default)") + (c.at ? ` · built ${age(c.at)}` : "")));
  }

  // ---- peers -----------------------------------------------------------------------------------------------------
  function peerRow(p, pe) {
    const st = pe?.peers?.find((x) => x.id === p.id) || p, active = p.status === "active";
    const state = p.lastError ? "bad" : !active || !p.enabled ? "warn" : "ok";
    const key = "peer:" + p.id, removing = confirmRemove === p.id;
    return h("article.peer", { data: { state } },
      h("div.peer__top", h("span.peer__name", p.name || (active ? "A peer world" : "Invited, not yet named")),
        chip(active ? (p.enabled ? "Active" : "Paused") : "Invite pending", active ? (p.enabled ? "good" : "warn") : "warn")),
      p.url ? h("div.peer__addr", icon("link"), p.url + (p.world ? " · " + p.world : "")) : h("div.peer__addr", h("span.nosig", "address unknown until they accept")),
      h("div.peer__meta",
        active ? h("span", `Sharing ${p.share?.length ?? 0} field${(p.share?.length ?? 0) === 1 ? "" : "s"} to them`) : h("span", p.inviteExpiresAt ? "Code expires " + dateOf(p.inviteExpiresAt, null, { day: "numeric", month: "short" }) : "Code pending"),
        st.received ? h("span", `Received ${st.received.fields.length} field${st.received.fields.length === 1 ? "" : "s"} ${age(st.received.at)}`) : active ? h("span", "Nothing received yet") : null,
        h("span", "Last refresh: " + (p.lastPullAt ? age(p.lastPullAt) : "never"))),
      p.lastError ? h("div.peer__err", icon("warning"), " Last error: " + p.lastError) : null,
      peerLists(p, st, pe, key),
      h("div.peer__acts",
        row("Share with them", null, !!p.enabled, () => write(key, "peers", () => api("/api/peers", "POST", { id: p.id, enabled: !p.enabled })), { disabled: busy.has(key) }),
        active ? h("button.lbtn", { type: "button", disabled: busy.has(key) || !p.enabled || !pe?.enabled || null, title: !p.enabled ? "Paused" : null, onClick: () => write(key, "peers", () => api("/api/peers/refresh", "POST", { id: p.id }), (o) => { const r = o.report?.[p.id]; msg.peers = r && !r.ok ? { text: `${p.name || "Peer"}: ${r.error}`, tone: "bad" } : { text: `Pulled ${p.name || "the peer"}'s card.`, tone: "good" }; }) }, icon("refresh"), "Refresh now") : null,
        removing ? [h("span.shhint", "Forget this peer and the card they sent?"),
          h("button.lbtn.is-danger", { type: "button", onClick: () => { confirmRemove = null; write(key, "peers", () => api("/api/peers", "DELETE", { id: p.id }), () => { msg.peers = { text: `${p.name || "The peer"} removed. Their world keeps its own row until they remove it too.`, tone: "good" }; }); } }, icon("check"), "Yes, remove"),
          h("button.lbtn", { type: "button", onClick: () => { confirmRemove = null; rerender(); } }, "Keep")]
          : h("button.lbtn", { type: "button", disabled: busy.has(key) || null, onClick: () => { confirmRemove = p.id; rerender(); } }, icon("close"), "Remove")));
  }
  // What this one peer gets: their own share list (the same allowlist, per peer) and the exact card the engine builds for them.
  // A list that differs from the default says so; "Use my default list" copies the default over it.
  function peerLists(p, st, pe, key) {
    const share = Array.isArray(p.share) ? p.share : [], dflt = (peers?.fields || pe?.fields || []);
    const allow = pe?.allowlist && typeof pe.allowlist === "object" ? pe.allowlist : null;
    const ids = allow ? [...ORDER.filter((k) => k in allow), ...Object.keys(allow).filter((k) => !ORDER.includes(k))] : ORDER;
    const same = share.length === dflt.length && share.every((f) => dflt.includes(f));
    const who = p.name || "this peer", open = openLists.has(p.id);
    const setShare = (list) => write(key, "peers", () => api("/api/peers", "POST", { id: p.id, share: list }));
    const head = h("button.shrow.shrow--fold", { type: "button", "aria-expanded": String(open), onClick: () => { if (open) openLists.delete(p.id); else openLists.add(p.id); rerender(); } },
      h("span", h("b", `What ${who} sees`), h("small", p.status === "active" ? (share.length ? `${share.length} field${share.length === 1 ? "" : "s"}` + (same ? ", your default list" : ", their own list") : "Only the world name") : "Set now; applies once they accept")),
      h("i.fold", { class: open ? "is-open" : "" }, icon("right")));
    if (!open) return h("div.peer__lists", head);
    const c = st?.card || null;
    return h("div.peer__lists", head,
      h("div.shfields.shfields--peer", ids.map((id) => { const [label, plain] = PLAIN[id] || [allow?.[id]?.label || id, allow?.[id]?.note || ""]; return row(allow?.[id]?.label || label, plain, share.includes(id), () => setShare(share.includes(id) ? share.filter((f) => f !== id) : [...share, id]), { disabled: busy.has(key) }); })),
      h("div.shacts", same ? h("span.shhint", "This is your default list.") : h("button.lbtn", { type: "button", disabled: busy.has(key) || null, onClick: () => setShare(dflt) }, icon("refresh"), "Use my default list"),
        h("span.shhint", "Changes apply to the next card they pull.")),
      c ? h("div.shcard.shcard--peer",
        h("div.shcard__kicker", icon("globe"), ` The card ${who} receives now`),
        h("div.shcard__name", c.world?.name || h("span.nosig", "unnamed world")),
        h("div.shcard__rows", c.fields.length ? c.fields.map((f) => h("div.shcard__row", h("span", (PLAIN[f] || [f])[0]), h("span", peerValue(f, c.values?.[f]) ?? nosig()))) : h("div.none", "No fields: only the world name leaves.")),
        h("div.shcard__foot", c.at ? `Built ${age(c.at)}; rebuilt on every pull.` : null))
      : h("div.shcard.is-null", h("div.shcard__kicker", "No card for them yet"), h("div.shcard__note", p.status !== "active" ? "The engine builds it once they accept the invite." : !p.enabled ? "Sharing to them is paused: they get nothing." : !pe?.enabled ? "Peering is off: nothing leaves." : "The engine has not built it yet.")));
  }
  function peersSection(pe, set) {
    const list = peers?.peers || pe?.peers || [];
    const actives = list.filter((p) => p.status === "active" && p.enabled);
    return [
      sectionHead("Peers", actives.length && set.enabled ? h("button.lbtn", { type: "button", disabled: busy.has("refresh") || null, onClick: () => write("refresh", "peers", () => api("/api/peers/refresh", "POST", {}), (o) => { const bad = Object.entries(o.report || {}).filter(([, r]) => !r.ok); msg.peers = bad.length ? { text: bad.map(([id, r]) => `${list.find((p) => p.id === id)?.name || id}: ${r.error}`).join(" · "), tone: "bad" } : { text: `Pulled ${o.pulled} card${o.pulled === 1 ? "" : "s"}.`, tone: "good" }; }) }, icon("refresh"), "Refresh all") : `${list.length} peer${list.length === 1 ? "" : "s"}`),
      loadErr ? h("div.shmsg", { data: { tone: "bad" } }, "Could not read the peer list: " + loadErr) : null,
      message("peers"),
      list.length ? h("div.peerlist", list.map((p) => peerRow(p, pe))) : h("div.none", loading && !peers ? "Reading the peer list…" : "No peers yet. Invite a friend below, or accept a code they sent you."),
    ];
  }
  function inviteSection(set) {
    return [
      sectionHead("Invite a friend"),
      h("p.shlede", "A friend runs their own world and peers with yours. You hand them a one-time code out of band; nothing is published anywhere."),
      h("div.shform",
        h("label.shfield", h("span", "Their name"), input("input", { type: "text", value: inviteName, placeholder: "Who the code is for (shown on their row)", maxlength: 60, "aria-label": "Friend's name", onInput: (e) => { inviteName = e.target.value; } })),
        row("Share my card with them", "Once they accept. Off: they peer, but get nothing until you switch it on.", inviteShare, () => { inviteShare = !inviteShare; rerender(); }),
        h("div.shacts", h("button.lbtn", { type: "button", disabled: busy.has("invite") || null, onClick: () => write("invite", "invite", () => api("/api/peers/invite", "POST", { name: inviteName.trim() || undefined, enabled: inviteShare }), (o) => { invite = o; inviteName = ""; }) }, icon("sparkle"), busy.has("invite") ? "Minting…" : "Make an invite code"),
          !set.enabled ? h("span.shhint", "Peering is off: the engine will refuse until it is on.") : null)),
      message("invite"),
      invite ? h("div.shcard.shcard--code",
        h("div.shcard__kicker", "Invite code for " + (invite.peer?.name || "a friend")),
        (() => { const ta = input("textarea", { readonly: true, rows: 3, "aria-label": "Invite code" }); ta.value = invite.code; ta.addEventListener("focus", () => ta.select()); return ta; })(),
        h("div.shacts", (() => { const b = h("button.lbtn", { type: "button" }, icon("doc"), "Copy code"); b.addEventListener("click", () => copy(invite.code, b)); return b; })(),
          h("span.shhint", "Good once" + (invite.expiresAt ? ", until " + dateOf(invite.expiresAt, null, { day: "numeric", month: "short" }) : "") + ". Send it in a message or in person."),
          h("button.lbtn", { type: "button", onClick: () => { invite = null; rerender(); } }, "Done")),
        h("div.shcard__kicker", "What your friend does"),
        h("ol.shsteps", STEPS.map((s) => h("li", s)))) : null,
    ];
  }
  function acceptSection(set) {
    const acceptBtn = h("button.lbtn", { type: "button", disabled: busy.has("accept") || !acceptCode.trim() || null, onClick: () => write("accept", "accept", () => api("/api/peers/accept", "POST", { code: acceptCode.trim(), enabled: acceptShare }), (o) => { acceptCode = ""; msg.accept = { text: `Paired with ${o.peer?.name || "the inviting world"}${o.peer?.url ? " at " + o.peer.url : ""}. Pull their card with Refresh.`, tone: "good" }; }) }, icon("link"), busy.has("accept") ? "Saying hello…" : "Accept");
    return [
      sectionHead("Accept an invite"),
      h("p.shlede", "A code a friend sent you. Your world tells theirs where it lives, signed; then each side pulls the other's card."),
      h("div.shform",
        (() => { const ta = input("textarea", { rows: 2, placeholder: "wogp1_…", "aria-label": "Invite code from a friend", onInput: (e) => { acceptCode = e.target.value; acceptBtn.disabled = busy.has("accept") || !acceptCode.trim(); } }); ta.value = acceptCode; return ta; })(),
        row("Share my card with them", "Off: you see their card, they get nothing until you switch it on.", acceptShare, () => { acceptShare = !acceptShare; rerender(); }),
        h("div.shacts", acceptBtn,
          !set.enabled ? h("span.shhint", "Peering is off: the engine will refuse until it is on.") : null)),
      message("accept"),
    ];
  }

  return {
    onOpen() { load(); },
    render(root, s, ctx) {
      rerender = ctx.rerender;
      if (root.querySelector("input:focus, textarea:focus")) { pending = true; return; }   // keep what is being typed
      const pe = s?.peering || null;
      if (!pe && !peers) {
        fill(root, store.mock ? emptyState("Nothing is shared", "This mock state carries no share profile. In the game, peering ships off: nothing leaves this world until you switch it on here.")
          : loadErr ? emptyState("Sharing settings could not be read", loadErr)
          : emptyState("Reading the share profile", "The engine has not sent its peering settings yet."));
        return;
      }
      const set = peers || pe;   // the API answer after a write; the state document otherwise
      fill(root, h("div.sh",
        h("div.sh__col.scroll", { data: { scroll: "sh-left" } },
          h("p.shlede", "Everyone runs their own world. Yours hands a signed presence card to the peers you invited, and only the fields you tick here. There is no field for weight, money, steps, sleep, coordinates, tasks or the log."),
          profile(pe, set)),
        h("div.sh__col.scroll", { data: { scroll: "sh-right" } },
          peersSection(pe, set),
          inviteSection(set),
          acceptSection(set),
          sectionHead("Squad board", s?.squad?.members?.length ? `${s.squad.members.length} member${s.squad.members.length === 1 ? "" : "s"}` : null),
          squadBoard(s?.squad, { head: true }) || h("div.none", "No squad yet. The board fills when a peer's card arrives."),
          s?.squad?.members?.length && s.squad.note ? h("div.shhint", s.squad.note) : null)));
    },
  };
}

export default { id: "share", title: "Squad & Sharing", icon: "connection", mode: "party", create };
