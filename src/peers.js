// Peering: how two worlds, each run by its own owner, share a little with each other.
// Pure logic (no storage, no network): the card allowlist, invite codes, request signing and
// verification. The Durable Object (src/world.js) owns the peer table, the settings and the
// fetches; src/index.js routes requests here. Design: docs/MULTIPLAYER.md.
//
// Shape of the idea: a world never publishes anything. It hands a signed, owner-curated "presence
// card" to the peers its owner invited, and only the fields the owner ticked for that peer.
// Default: nothing. Everything about peering ships OFF (peering.enabled = false).

export const PEER_VERSION = 1;
export const INVITE_PREFIX = "wogp1_";
export const INVITE_TTL_MS = 7 * 86400000;
export const SIG_WINDOW_MS = 5 * 60000;          // a signed request is good for five minutes either side
export const NONCE_TTL_MS = 10 * 60000;          // nonces remembered for ten minutes (twice the window)
export const MAX_PEERS = 50;
export const CARD_MAX_BYTES = 8000;

const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const subtle = () => globalThis.crypto.subtle;
export const randomHex = n => hex(globalThis.crypto.getRandomValues(new Uint8Array(n)));
export async function sha256(s) { return hex(await subtle().digest("SHA-256", enc.encode(s))); }
export async function hmac(secret, msg) {
  const k = await subtle().importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await subtle().sign("HMAC", k, enc.encode(msg)));
}
/** Constant-time equality of two hex strings (lengths compared first; a length mismatch reveals nothing a peer does not know). */
export function sameHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || !a.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---------------------------------------------------------------- the card: the allowlist of what a world may share
// Every field is coarse by design. There is no field for a number that measures the player (weight, money, steps, sleep),
// no coordinates, no task, no log entry, no account, no contact. `pick(state, settings)` reads the field from the
// state document; a field that is shared but has no signal is null (rule zero: never a default).
const hourFloor = t => { const ms = Date.parse(t || ""); return Number.isFinite(ms) ? new Date(Math.floor(ms / 3600000) * 3600000).toISOString() : null; };
export const CARD_FIELDS = {
  name:      { label: "Name",           note: "the character's name",                                 pick: s => s.character.name || null },
  level:     { label: "Level",          note: "character level only, not XP",                         pick: s => s.character.level ?? null },
  title:     { label: "Title",          note: "the rank title (Initiate, Operative …)",               pick: s => s.character.title || null },
  class:     { label: "Class",          note: "the class name",                                       pick: s => s.character.class || null },
  place:     { label: "Place",          note: "city level only (never coordinates)",                  pick: s => (s.realm && (s.realm.city || s.realm.place)) || null },
  activity:  { label: "Activity",       note: "the activity name (idle, walking, training …)",        pick: s => (s.character.activity && s.character.activity.name) || null },
  streaks:   { label: "Streaks",        note: "current streak lengths for steps, sleep, protein",     pick: s => s.character.streaks ? { ...s.character.streaks } : null },
  grade:     { label: "Grade",          note: "today's letter grade",                                 pick: s => (s.day && s.day.grade) || null },
  stepsGoal: { label: "Steps goal",     note: "whether today's step goal is hit (yes/no, no count)",  pick: s => { const x = (s.streaks || []).find(v => v.id === "steps-goal"); return x ? !!x.hitThisPeriod : null; } },
  status:    { label: "Status line",    note: "one line the owner wrote for peers",                   pick: (s, o) => (o && o.status) || null },
  lastSeen:  { label: "Last seen",      note: "the hour the world last heard from its devices",       pick: s => hourFloor((s.realm && s.realm.lastSeen) || s.computedAt || null) },
};
export const CARD_FIELD_IDS = Object.keys(CARD_FIELDS);
export const cleanFields = list => (Array.isArray(list) ? [...new Set(list.map(x => String(x)).filter(f => CARD_FIELD_IDS.includes(f)))] : []);

/** The card a world hands to one peer: exactly `fields`, each read from the state now. */
export function buildCard(state, fields, settings = {}) {
  const f = cleanFields(fields), values = {};
  for (const id of f) { try { values[id] = CARD_FIELDS[id].pick(state, settings); } catch { values[id] = null; } if (values[id] === undefined) values[id] = null; }
  return { v: PEER_VERSION, world: { name: (settings && settings.name) || null }, fields: f, values, at: new Date(state.asOf || Date.now()).toISOString() };
}
/** What a received card may contain: only allowlisted fields, only plain values. Anything else is dropped; a bad card is null. */
export function cleanCard(raw) {
  if (!raw || typeof raw !== "object" || raw.v !== PEER_VERSION) return null;
  const fields = cleanFields(raw.fields), values = {};
  const vals = raw.values && typeof raw.values === "object" ? raw.values : {};
  for (const id of fields) {
    const v = vals[id];
    if (id === "streaks") values[id] = v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k, n]) => ["steps", "sleep", "protein"].includes(k) && Number.isFinite(n)).map(([k, n]) => [k, Math.max(0, Math.round(n))])) : null;
    else if (id === "stepsGoal") values[id] = typeof v === "boolean" ? v : null;
    else if (id === "level") values[id] = Number.isFinite(v) ? Math.round(v) : null;
    else values[id] = typeof v === "string" ? v.slice(0, id === "status" ? 200 : 80) : v == null ? null : null;
  }
  const name = raw.world && typeof raw.world.name === "string" ? raw.world.name.slice(0, 60) : null;
  const at = typeof raw.at === "string" && Number.isFinite(Date.parse(raw.at)) ? new Date(Date.parse(raw.at)).toISOString() : null;
  return { v: PEER_VERSION, world: { name }, fields, values, at };
}

// ---------------------------------------------------------------- invites
/** The code the inviting owner hands to a friend (out of band). Carries the pair id, the shared secret and where the inviter's world lives. */
export function encodeInvite(o) {
  const body = JSON.stringify({ v: PEER_VERSION, pair: o.pair, secret: o.secret, url: o.url, world: o.world || null, name: o.name || null, exp: o.exp });
  return INVITE_PREFIX + btoa(unescape(encodeURIComponent(body))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeInvite(code, now = Date.now()) {
  if (typeof code !== "string" || !code.startsWith(INVITE_PREFIX)) return { ok: false, error: "not an invite code" };
  let o; try { const b = code.slice(INVITE_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/"); o = JSON.parse(decodeURIComponent(escape(atob(b + "=".repeat((4 - b.length % 4) % 4))))); } catch { return { ok: false, error: "invite code is damaged" }; }
  if (!o || o.v !== PEER_VERSION || !/^[a-f0-9]{16}$/.test(o.pair || "") || !/^[a-f0-9]{64}$/.test(o.secret || "")) return { ok: false, error: "invite code is not valid" };
  const url = cleanUrl(o.url); if (!url.ok) return { ok: false, error: "invite names a bad world address: " + url.error };
  if (!(Number.isFinite(o.exp) && o.exp > now)) return { ok: false, error: "invite code has expired" };
  return { ok: true, pair: o.pair, secret: o.secret, url: url.url, world: cleanWorld(o.world), name: typeof o.name === "string" ? o.name.slice(0, 60) : null, exp: o.exp };
}
/** A peer's base address: https only, no credentials, no path, no query. Plain http is allowed for loopback (local development). */
export function cleanUrl(u) {
  let x; try { x = new URL(String(u || "")); } catch { return { ok: false, error: "not a URL" }; }
  const loop = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(x.hostname);
  if (x.protocol !== "https:" && !(x.protocol === "http:" && loop)) return { ok: false, error: "https required" };
  if (x.username || x.password) return { ok: false, error: "no credentials in a world address" };
  if ((x.pathname !== "/" && x.pathname !== "") || x.search || x.hash) return { ok: false, error: "a world address is an origin only" };
  return { ok: true, url: x.origin };
}
export const cleanWorld = w => (typeof w === "string" && /^qc(?:-[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?)?$/.test(w) ? w : null);

// ---------------------------------------------------------------- signed requests between worlds
// Headers: x-peer-id (the pair id), x-peer-ts (epoch ms), x-peer-nonce (16 hex), x-peer-sig (HMAC-SHA256 hex).
// The string signed: method, path with query, ts, nonce and the SHA-256 of the body, newline-separated. The secret is the
// pair's: either side can sign and verify, nothing else can. Responses are signed the same way over status, ts and body.
export function canonicalRequest(method, pathWithQuery, ts, nonce, bodyHash) { return [String(method).toUpperCase(), pathWithQuery, String(ts), nonce, bodyHash].join("\n"); }
export function canonicalResponse(status, ts, bodyHash) { return ["RESPONSE", String(status), String(ts), bodyHash].join("\n"); }
export async function signRequest(secret, pair, method, pathWithQuery, body = "", now = Date.now()) {
  const nonce = randomHex(8), bodyHash = await sha256(body || "");
  const sig = await hmac(secret, canonicalRequest(method, pathWithQuery, now, nonce, bodyHash));
  return { "x-peer-id": pair, "x-peer-ts": String(now), "x-peer-nonce": nonce, "x-peer-sig": sig };
}
export async function signResponse(secret, status, body, now = Date.now()) {
  const sig = await hmac(secret, canonicalResponse(status, now, await sha256(body || "")));
  return { "x-peer-ts": String(now), "x-peer-sig": sig };
}
/**
 * Verify an inbound signed request. `headers` is a getter (name -> value), `nonces` a Map(nonce -> ts) this verifier may prune.
 * -> { ok: true } or { ok: false, error }. The error text is for the log; the route answers a bare 401 either way.
 */
export async function verifyRequest(secret, headers, method, pathWithQuery, body = "", nonces, now = Date.now()) {
  const ts = Number(headers("x-peer-ts")), nonce = String(headers("x-peer-nonce") || ""), sig = String(headers("x-peer-sig") || "");
  if (!Number.isFinite(ts) || Math.abs(now - ts) > SIG_WINDOW_MS) return { ok: false, error: "timestamp outside the window" };
  if (!/^[a-f0-9]{16}$/.test(nonce)) return { ok: false, error: "bad nonce" };
  if (nonces) { for (const [n, t] of nonces) if (now - t > NONCE_TTL_MS) nonces.delete(n); if (nonces.has(nonce)) return { ok: false, error: "nonce replayed" }; }
  const want = await hmac(secret, canonicalRequest(method, pathWithQuery, ts, nonce, await sha256(body || "")));
  if (!sameHex(sig, want)) return { ok: false, error: "bad signature" };
  if (nonces) nonces.set(nonce, now);
  return { ok: true };
}
export async function verifyResponse(secret, headers, status, body = "", now = Date.now()) {
  const ts = Number(headers("x-peer-ts")), sig = String(headers("x-peer-sig") || "");
  if (!Number.isFinite(ts) || Math.abs(now - ts) > SIG_WINDOW_MS) return { ok: false, error: "response timestamp outside the window" };
  const want = await hmac(secret, canonicalResponse(status, ts, await sha256(body || "")));
  return sameHex(sig, want) ? { ok: true } : { ok: false, error: "bad response signature" };
}

// ---------------------------------------------------------------- settings and peer rows, as the state shows them
export const DEFAULT_SETTINGS = { enabled: false, name: null, status: null, fields: [], url: null, autoPull: false };
export const AUTO_PULL_MS = 5 * 60000;           // with autoPull on, the world pulls its peers' cards about every five minutes
export function cleanSettings(cur, patch) {
  const o = { ...DEFAULT_SETTINGS, ...(cur || {}) }, p = patch && typeof patch === "object" ? patch : {};
  if ("enabled" in p) o.enabled = p.enabled === true;
  if ("name" in p) o.name = typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 60) : null;
  if ("status" in p) o.status = typeof p.status === "string" && p.status.trim() ? p.status.trim().slice(0, 200) : null;
  if ("fields" in p) o.fields = cleanFields(p.fields);
  if ("url" in p) { const u = cleanUrl(p.url); o.url = u.ok ? u.url : null; }      // this world's own public address, when the request origin is not it (local dev, a proxy)
  if ("autoPull" in p) o.autoPull = p.autoPull === true;                             // off by default: pulls happen when the owner presses Refresh
  return o;
}
/** The peer-facing path for a world: its origin plus the world marker when it is a sandbox. */
export const peerPath = (path, world) => path + (world ? "?world=" + world : "");
/** A peer row as the owner sees it (never the secret). */
export const publicPeer = r => ({ id: r.id, name: r.name || null, url: r.url || null, world: r.world || null, status: r.status, enabled: !!r.enabled, share: cleanFields(JSON.parse(r.share || "[]")),
  createdAt: new Date(r.created).toISOString(), acceptedAt: r.accepted ? new Date(r.accepted).toISOString() : null, lastPullAt: r.last_pull ? new Date(r.last_pull).toISOString() : null,
  lastError: r.last_error || null, lastSeenAt: r.last_seen ? new Date(r.last_seen).toISOString() : null, inviteExpiresAt: r.invite_exp ? new Date(r.invite_exp).toISOString() : null });
