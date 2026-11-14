// Ingest: validation, canonical ids and the idempotency rule. Pure (no Workers APIs), so the
// same code runs in the Durable Object over SQLite and in the Node tests over a Map.
import { EVENT_TYPES } from "./rules.js";
import { parseTs } from "./lib/time.js";
import { maskEventData } from "./lib/mask.js";

export function stable(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  return "{" + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
}
export function fnv(s) { let a = 0x811c9dc5, b = 0x1b873593; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x85ebca6b) + a | 0; } return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0"); }

/** Validate and normalise one pushed event. Returns { ok, event } or { ok:false, reason }. Pure. */
export function normaliseEvent(raw, now = Date.now(), opts = {}) {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not an object" };
  const type = String(raw.type || "");
  const def = EVENT_TYPES[type];
  if (!def || (def.internal && !opts.internal)) return { ok: false, reason: "unknown type " + JSON.stringify(type) };
  const source = String(raw.source || "").trim();
  if (!source) return { ok: false, reason: "source is required (rule zero: every fact names where it came from)" };
  // The production world refuses test traffic (opts.refuse: src/worlds.js isQcTraffic). Withdrawing is always allowed.
  if (opts.refuse && raw.void !== true && opts.refuse(source, raw.id)) return { ok: false, reason: opts.refuseReason || "refused" };
  // Identifiers are masked before anything else happens: the canonical id, the hash and the stored payload are all built from the
  // masked data, so a raw account number, IBAN or wallet address is never stored, whatever a collector sends.
  const data = raw.data && typeof raw.data === "object" && !Array.isArray(raw.data) ? maskEventData(type, raw.data) : null;
  const isVoid = raw.void === true;
  if (!data && !isVoid) return { ok: false, reason: "data object is required" };
  let id = null;
  if (def.key && data) { const k = def.key(data); if (k != null && k !== "") id = type + ":" + k; }
  if (!id) id = typeof raw.id === "string" && raw.id ? raw.id : null;
  if (!id) return { ok: false, reason: def.key ? "missing key fields for " + type : "id is required for " + type };
  if (id.length > 300) return { ok: false, reason: "id too long" };
  const ts = parseTs(raw.ts);
  if (ts == null && !isVoid) return { ok: false, reason: "ts is required (ISO 8601 or epoch ms)" };
  if (ts != null && ts > now + 36 * 3600000) return { ok: false, reason: "ts is in the future" };
  const body = data ? stable(data) : "{}";
  if (body.length > 60000) return { ok: false, reason: "data too large" };
  return { ok: true, merge: !!def.merge, event: { id, ts: ts ?? now, type, source: source.slice(0, 120), data: data || {}, body, void: isVoid } };
}

/**
 * Apply pushed events to a store. Idempotent by event id:
 *   unknown id            -> inserted (new)
 *   same id, same data    -> nothing happens (unchanged), however often it is pushed
 *   same id, new data     -> the fact is revised in place (rev + 1); ts0 keeps the first ts
 *   { void: true }        -> the fact is withdrawn (kept in the table, ignored by the reducer)
 * store: { get(id) -> { hash, void } | undefined, insert(e, hash), update(e, hash), void(id) }
 */
export function ingestInto(store, list, now = Date.now(), opts = {}) {
  const res = { accepted: 0, new: 0, revised: 0, unchanged: 0, voided: 0, rejected: [], changed: [] };
  const types = new Set();
  for (let i = 0; i < list.length; i++) {
    const n = normaliseEvent(list[i], now, opts);
    if (!n.ok) { res.rejected.push({ i, id: list[i] && list[i].id, reason: n.reason }); continue; }
    if (n.merge && n.event.data && "viewsBySource" in n.event.data) { const { viewsBySource: _vb, ...rest } = n.event.data; n.event.data = rest; n.event.body = stable(rest); }   // engine-written only
    const e = n.event, hash = fnv(e.type + "|" + e.body);
    res.accepted++; types.add(e.type);
    const old = store.get(e.id);
    if (e.void) {
      if (old && !old.void) { store.void(e.id); res.voided++; res.changed.push(e); } else res.unchanged++;
      continue;
    }
    if (!old) {
      // a merge type's first record already carries its views per source, so the same push again is "unchanged"
      let first = e, h0 = hash;
      if (n.merge && Array.isArray(e.data.views)) { const data = { ...e.data, viewsBySource: { [e.source]: e.data.views.filter(v => typeof v === "string") } }; const body = stable(data); first = { ...e, data, body }; h0 = fnv(e.type + "|" + body); }
      store.insert(first, h0); res.new++; res.changed.push(first); continue;
    }
    // merge types (rules.js `merge`): a revision keeps every field it does not mention, so a collector that knows
    // name and role never erases a portrait or wardrobe another source added; send a field as null to clear it
    let ev = e, h = hash;
    const oldBody = typeof old.data === "string" ? old.data : typeof old.body === "string" ? old.body : null;
    if (n.merge && !old.void && oldBody) {
      let prev = null; try { prev = JSON.parse(oldBody); } catch { prev = null; }
      if (prev && typeof prev === "object") {
        const merged = { ...prev, ...e.data };
        // views are kept per source and served as their union, so a collector that resends its own list every refresh
        // cannot erase the view another source added (a squad tag from a group chat); null clears that source's
        // share only.
        if ("views" in e.data) {
          const clean = o => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([k, v]) => typeof k === "string" && Array.isArray(v)).map(([k, v]) => [k, v.filter(x => typeof x === "string")]));
          // lists stored before this rule count as the previous writer's (the store names it; else the current writer's)
          const by = clean(prev.viewsBySource || (Array.isArray(prev.views) ? { [old.source || e.source]: prev.views } : {}));
          if (Array.isArray(e.data.views)) by[e.source] = e.data.views.filter(v => typeof v === "string"); else delete by[e.source];
          merged.viewsBySource = by; merged.views = [...new Set(Object.values(by).flat())];
        }
        for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
        const body = stable(merged);
        ev = { ...e, data: merged, body }; h = fnv(e.type + "|" + body);
      }
    }
    if (old.hash !== h || old.void) { store.update(ev, h); res.revised++; res.changed.push(ev); }
    else res.unchanged++;
  }
  return { res, types };
}
