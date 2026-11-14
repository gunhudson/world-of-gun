// Scoped read tokens for native widgets (scope world:read). Pure logic over a small store
// interface, so the same code runs in the Durable Object over SQLite and in the Node tests.
//   store: { get(hash) -> row | undefined, put(row), del(hash), all() -> rows }
//   row:   { hash, scope, label, sid, created, expires, lastUsed }
// The token itself is never stored: only its SHA-256. `sid` is the session that minted it, so an
// owner can list or revoke "the tokens I made here". A token lives until it expires or is revoked.
export const TOKEN_RE = /^(?:wogr|wogq(?:-[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?)?)_[a-f0-9]{64}$/;   // wogr_ = minted in production, wogq_ / wogq-<name>_ = minted in a QC world (src/worlds.js)
export const TOKEN_SCOPE = "world:read";
export const TOKEN_TTL_MS = 30 * 86400000;
export const MAX_TOKENS = 20;

/** The only requests a read token opens. Everything else ignores it. */
export function tokenRoute(method, path) {
  return method === "GET" && (path === "/api/glance" || path === "/api/brief" || path.startsWith("/api/img/"));
}
export function mintToken(store, hash, sid, label, now) {
  for (const r of store.all()) if (r.expires <= now) store.del(r.hash);
  const live = store.all().sort((a, b) => a.created - b.created);
  for (const r of live.slice(0, Math.max(0, live.length - (MAX_TOKENS - 1)))) store.del(r.hash);        // keep at most MAX_TOKENS, oldest out first
  store.put({ hash, scope: TOKEN_SCOPE, label: label || null, sid: sid || null, created: now, expires: now + TOKEN_TTL_MS, lastUsed: null });
  return { id: hash.slice(0, 12), expires: now + TOKEN_TTL_MS };
}
/** -> null (unknown or expired), or { sid }. */
export function checkToken(store, hash, now) {
  const r = store.get(hash);
  if (!r) return null;
  if (r.expires <= now) { store.del(hash); return null; }
  if (!r.lastUsed || now - r.lastUsed > 60000) store.put({ ...r, lastUsed: now });
  return { sid: r.sid };
}
/** by: { hash } | { id } (first 12 hex of the hash) | { sid } (every token that session minted) | { all: true } */
export function revokeTokens(store, by) {
  let n = 0;
  for (const r of store.all()) {
    if (by.all || (by.hash && r.hash === by.hash) || (by.id && r.hash.slice(0, 12) === by.id) || (by.sid && r.sid === by.sid)) { store.del(r.hash); n++; }
  }
  return { ok: true, revoked: n };
}
export function listTokens(store, now, sid) {
  return store.all().filter(r => r.expires > now).sort((a, b) => b.created - a.created).map(r => ({ id: r.hash.slice(0, 12), scope: r.scope, label: r.label,
    createdAt: new Date(r.created).toISOString(), expiresAt: new Date(r.expires).toISOString(), lastUsedAt: r.lastUsed ? new Date(r.lastUsed).toISOString() : null, thisSession: !!sid && r.sid === sid }));
}
