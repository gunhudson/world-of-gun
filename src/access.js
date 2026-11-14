// Sign-in. Put Cloudflare Access (Zero Trust, free for a handful of users) in front of the worker; the worker then
// trusts nothing but the Access JWT it verifies here: RS256 against the team's published keys, audience = the Access
// application, issuer = the team, not expired.
// Vars: ACCESS_TEAM (the <team> in https://<team>.cloudflareaccess.com), ACCESS_AUD (the application audience tag),
// OWNER_EMAIL (the one address that is the owner; anyone else Access lets through is a "user" and is refused with 403).
// Pure: the certificate fetch is injected so it can be tested with a local key pair.

const b64u = s => { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const dec = new TextDecoder();
const certsCache = new Map();          // team -> { at, keys }
export const CERTS_TTL_MS = 10 * 60000;

export function accessConfigured(env) { return !!(env && typeof env.ACCESS_TEAM === "string" && env.ACCESS_TEAM && typeof env.ACCESS_AUD === "string" && env.ACCESS_AUD); }
export const certsUrl = team => `https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`;

async function fetchKeys(team, fetchImpl) {
  const c = certsCache.get(team);
  if (c && Date.now() - c.at < CERTS_TTL_MS) return c.keys;
  const r = await fetchImpl(certsUrl(team));
  if (!r.ok) throw new Error("Access certs: HTTP " + r.status);
  const doc = await r.json();
  const keys = Array.isArray(doc.keys) ? doc.keys.filter(k => k.kty === "RSA" && k.kid) : [];
  certsCache.set(team, { at: Date.now(), keys });
  return keys;
}

/** The Access JWT a request carries: the header Access sets, or its cookie. */
export function tokenOf(req) {
  const h = req.headers.get("Cf-Access-Jwt-Assertion"); if (h) return h;
  const m = (req.headers.get("Cookie") || "").match(/CF_Authorization=([^;]+)/); return m ? m[1] : null;
}

/**
 * Verify one Access token. Returns { ok, email, sub, exp } or { ok: false, error }.
 * `opts.fetch` replaces the certificate fetch (tests); `opts.now` the clock.
 */
export async function verifyAccessToken(token, team, aud, opts = {}) {
  try {
    if (typeof token !== "string") return { ok: false, error: "no token" };
    const parts = token.split("."); if (parts.length !== 3) return { ok: false, error: "not a JWT" };
    const header = JSON.parse(dec.decode(b64u(parts[0]))), claims = JSON.parse(dec.decode(b64u(parts[1])));
    if (header.alg !== "RS256" || !header.kid) return { ok: false, error: "unexpected algorithm" };
    const keys = await fetchKeys(team, opts.fetch || fetch);
    const jwk = keys.find(k => k.kid === header.kid); if (!jwk) return { ok: false, error: "unknown signing key" };
    const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    if (!good) return { ok: false, error: "bad signature" };
    const now = Math.floor((opts.now || Date.now()) / 1000);
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(aud)) return { ok: false, error: "wrong audience" };
    if (typeof claims.exp !== "number" || claims.exp < now - 30) return { ok: false, error: "expired" };
    if (typeof claims.nbf === "number" && claims.nbf > now + 30) return { ok: false, error: "not yet valid" };
    if (typeof claims.iss === "string" && claims.iss !== `https://${team}.cloudflareaccess.com`) return { ok: false, error: "wrong issuer" };
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : null;
    if (!email) return { ok: false, error: "no email in token" };
    return { ok: true, email, sub: typeof claims.sub === "string" ? claims.sub : null, exp: claims.exp };
  } catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 120) }; }
}

/** The session src/index.js wants, from an Access-fronted request: owner when the email is OWNER_EMAIL, else "user". */
export async function accessSession(req, env, opts = {}) {
  const t = tokenOf(req); if (!t) return null;
  const v = await verifyAccessToken(t, env.ACCESS_TEAM, env.ACCESS_AUD, opts);
  if (!v.ok) return null;
  const owner = typeof env.OWNER_EMAIL === "string" && env.OWNER_EMAIL.trim().toLowerCase() === v.email;
  return { email: v.email, role: owner ? "owner" : "user", name: "", sid: "access:" + (v.sub || v.email) };
}
export const _resetCertsCache = () => certsCache.clear();
