// World of Gun: worker entry. An owner session (Cloudflare Access, or DEV=1 on your own machine)
// for everything a person opens; keys for machines (x-world-key for collectors, the ACT key for
// voice and keypads, the TV key for a read-only screen, read tokens for widgets). The engine
// itself is the World Durable Object (src/world.js), in two kinds of instance: production (the
// owner's real events) and the QC sandbox (for testing). Which one a request reaches: src/worlds.js.
export { World } from "./world.js";
import { TOKEN_RE, TOKEN_SCOPE, tokenRoute } from "./tokens.js";
import { PROD, QC, isQcWorld, askedWorld, decideWorld, tokenWorld, tokenPrefix } from "./worlds.js";
import { uaFamily } from "./clientlog.js";
import { accessConfigured, accessSession } from "./access.js";
import { applySecurityHeaders, cacheControlFor, clientKey, etagMatches, jsonEtag, RateLimiter, readBoundedBytes, readBoundedText, safeDecode } from "./http.js";

const J = (obj, status = 200, extra) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(extra || {}) } });
const authLimiter = new RateLimiter({ windowMs: 60_000, maxKeys: 512 });
const writeLimiter = new RateLimiter({ windowMs: 60_000, maxKeys: 512 });
const AUTH_FAIL_LIMIT = 30;
const WRITE_LIMIT = 120;
const MAX_INGEST_BYTES = 5_000_000;
const MAX_IMG_BYTES = 1_600_000;
const MAX_SMALL_JSON_BYTES = 64_000;
let rulesCache = null;
export const _resetWorkerState = () => { authLimiter.clear(); writeLimiter.clear(); rulesCache = null; };

// Where the owner's session comes from: the Cloudflare Access token in front of the worker (vars ACCESS_TEAM + ACCESS_AUD,
// src/access.js), or DEV=1 in .dev.vars for local play. Nothing else makes a session: with neither, every page and
// session route answers 401.
const DEV_SESSION = { email: "dev@localhost", role: "owner", name: "Dev", sid: "dev" };
async function getSession(req, env) {
  if (env.DEV === "1") return DEV_SESSION;
  return accessConfigured(env) ? accessSession(req, env) : null;
}
const signInHint = env => (accessConfigured(env) ? "sign in through Cloudflare Access" : "no sign-in is configured for this world: set ACCESS_TEAM and ACCESS_AUD in wrangler.toml (or DEV=1 in .dev.vars for local play)");
const sha256hex = async t => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(x => x.toString(16).padStart(2, "0")).join("");
const bearerOf = req => { const b = (req.headers.get("Authorization") || "").match(/^Bearer (\S+)$/); return b ? b[1] : ""; };
async function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const p = new Uint8Array(x), q = new Uint8Array(y); let d = 0;
  for (let i = 0; i < p.length; i++) d |= p[i] ^ q[i];
  return d === 0;
}
/** Which world a presented key belongs to: the production secret, the QC secret, or neither. The two secrets are different values, so a key matches one at most. */
async function keyWorld(given, prodSecret, qcSecret) {
  if (!given) return null;
  if (prodSecret && await sameSecret(given, prodSecret)) return PROD;
  if (qcSecret && await sameSecret(given, qcSecret)) return QC;
  return null;
}
const secrets = (env, name) => [env[name] || (env.DEV === "1" ? "dev" : ""), env["QC_" + name] || (env.DEV === "1" ? "qc-dev" : "")];
const ingestWorld = (req, env) => keyWorld(req.headers.get("x-world-key") || "", ...secrets(env, "INGEST_KEY"));
const actWorld = (req, env) => keyWorld(req.headers.get("x-act-key") || bearerOf(req), env.ACT_KEY || "", env.QC_ACT_KEY || "");
const tvWorldOf = (req, env, url) => keyWorld(req.headers.get("x-tv-key") || bearerOf(req) || url.searchParams.get("key") || "", env.TV_KEY || "", env.QC_TV_KEY || "");

const qcMarked = new Set();
/** The Durable Object for a world: production, "qc" or "qc-<name>". A QC object is told once per isolate that it is a sandbox (it then runs no adapters). */
async function stubFor(env, name) {
  const qc = isQcWorld(name), stub = env.WORLD.get(env.WORLD.idFromName(qc ? name : PROD));
  if (qc && !qcMarked.has(name)) { await stub.markQC(name); qcMarked.add(name); }
  return stub;
}

/** A scoped read token (world:read). Its prefix says which world minted it, and that is the only world it reads. */
async function readTokenWorld(req, env) {
  const t = bearerOf(req); if (!TOKEN_RE.test(t)) return null;
  const name = tokenWorld(t); if (!name) return null;
  const w = await stubFor(env, name), row = await w.checkToken(await sha256hex(t), Date.now());
  return row ? name : null;
}
// When the page is opened in the QC world (?world=qc): mark the document, show a tag, and make every same-origin /api/ call
// and the live socket carry the marker, so a QC page can never read or write production.
const qcPageScript = w => `(function(){var N=${JSON.stringify(w)};window.__WOG_WORLD__=N;var f=window.fetch;window.fetch=function(i,o){try{var u=new URL(typeof i==="string"?i:i.url,location.href);if(u.origin===location.origin&&u.pathname.indexOf("/api/")===0){u.searchParams.set("world",N);i=typeof i==="string"?u.href:new Request(u.href,i)}}catch(e){}return f.call(this,i,o)};var W=window.WebSocket;var Q=function(u,p){try{var x=new URL(u,location.href);if(x.host===location.host&&x.pathname.indexOf("/api/")===0){x.searchParams.set("world",N);u=x.href}}catch(e){}return p===undefined?new W(u):new W(u,p)};Q.prototype=W.prototype;Q.CONNECTING=0;Q.OPEN=1;Q.CLOSING=2;Q.CLOSED=3;window.WebSocket=Q})();`;
const qcPageTag = w => `<div id="qc-world-tag" data-world="${w}" role="status" style="position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483647;padding:4px 14px;font:700 12px/1.4 system-ui,sans-serif;letter-spacing:.14em;color:#1a1200;background:#f0b34a;border-radius:0 0 8px 8px;pointer-events:none">QC WORLD${w === QC ? "" : " · " + w.slice(3).toUpperCase()}</div>`;
// A world names and styles itself from its vars: WORLD_NAME is the page title and the peering display name, DEFAULT_SKIN the
// skin a fresh browser starts with, DEFAULT_BIOME the realm the stage draws.
function stylePage(res, env) {
  if (res.status !== 200) return res;
  const name = typeof env.WORLD_NAME === "string" && env.WORLD_NAME.trim() ? env.WORLD_NAME.trim().slice(0, 60) : null;
  const skin = typeof env.DEFAULT_SKIN === "string" && /^[a-z]{2,20}$/.test(env.DEFAULT_SKIN) ? env.DEFAULT_SKIN : null;
  const biome = typeof env.DEFAULT_BIOME === "string" && /^[a-z][a-z-]{1,24}$/.test(env.DEFAULT_BIOME) ? env.DEFAULT_BIOME : null;
  if ((!name && !skin && !biome) || !/text\/html/.test(res.headers.get("Content-Type") || "")) return res;
  const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let rw = new HTMLRewriter();
  if (name) rw = rw.on("title", { element(e) { e.setInnerContent(name); } });
  rw = rw.on("head", { element(e) { e.prepend((name ? `<meta name="wog-name" content="${esc(name)}">` : "") + (skin ? `<meta name="wog-skin" content="${skin}">` : "") + (biome ? `<meta name="wog-biome" content="${biome}">` : ""), { html: true }); } });
  return rw.transform(res);
}
function qcPage(res, w) {
  if (res.status !== 200 || !/text\/html/.test(res.headers.get("Content-Type") || "")) return res;
  return new HTMLRewriter()
    .on("html", { element(e) { e.setAttribute("data-world", w); } })
    .on("head", { element(e) { e.prepend(`<meta name="wog-world" content="${w}"><script>${qcPageScript(w)}</script>`, { html: true }); } })
    .on("body", { element(e) { e.prepend(qcPageTag(w), { html: true }); } })
    .transform(res);
}

async function handle(request, env, ctx, rq) {
  const url = new URL(request.url), p = url.pathname, method = request.method;
  if (p === "/healthz") return new Response("ok", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const ip = clientKey(request);
  const tooMany = sec => J({ error: "too many requests" }, 429, { "Retry-After": String(sec) });
  const checkAuthBlock = scope => { const b = authLimiter.blocked(ip + ":" + scope, AUTH_FAIL_LIMIT); return b.blocked ? tooMany(b.retryAfterSec) : null; };
  const authFail = (scope, msg) => { authLimiter.take(ip + ":" + scope, AUTH_FAIL_LIMIT); return J({ error: msg }, 401); };
  const checkWriteRate = bucket => { const r = writeLimiter.take(ip + ":" + bucket, WRITE_LIMIT); return r.ok ? null : tooMany(r.retryAfterSec); };
  const readJson = async (maxBytes, errMsg, allowEmpty = false) => {
    const r = await readBoundedText(request, maxBytes);
    if (!r.ok) return { err: J({ error: r.error }, r.status) };
    if (allowEmpty && !r.text.trim()) return { data: {} };
    try { return { data: JSON.parse(r.text) }; } catch { return { err: J({ error: errMsg }, 400) }; }
  };
  const asked = askedWorld(url.searchParams.get("world"), request.headers.get("x-world"));
  /** Settle the world for this request from its credential and the explicit marker. -> stub, or a Response refusing it. */
  const enter = async credWorld => {
    const d = decideWorld(credWorld, asked);
    if (d.error) return J({ error: d.error }, d.status);
    rq.world = d.world;
    return stubFor(env, d.world);
  };
  const refused = x => x instanceof Response;

  // ---- machines: collectors push events and images with the ingest key
  if (p === "/api/ingest") {
    if (method !== "POST") return J({ error: "POST required" }, 405);
    const blk = checkAuthBlock("ingest"); if (blk) return blk;
    const kw = await ingestWorld(request, env); if (!kw) return authFail("ingest", "bad or missing x-world-key");
    const W = await enter(kw); if (refused(W)) return W;
    const { data: body, err } = await readJson(MAX_INGEST_BYTES, "body must be JSON: { events: [...] }");
    if (err) return err;
    const out = await W.ingest(Array.isArray(body) ? body : body && body.events);
    return J(out, out.ok ? 200 : 400);
  }
  if (p.startsWith("/api/img/") && (method === "POST" || method === "PUT")) {
    const blk = checkAuthBlock("ingest"); if (blk) return blk;
    const kw = await ingestWorld(request, env); if (!kw) return authFail("ingest", "bad or missing x-world-key");
    const W = await enter(kw); if (refused(W)) return W;
    const imgId = safeDecode(p.slice(9)); if (imgId == null) return J({ error: "malformed image id" }, 400);
    const body = await readBoundedBytes(request, MAX_IMG_BYTES);
    if (!body.ok) return J({ error: "image over limit" }, 413);
    const out = await W.putImage(imgId, (request.headers.get("Content-Type") || "").split(";")[0].trim(), body.bytes.buffer);
    return J(out, out.ok ? 200 : 400);
  }
  if (p.startsWith("/api/img/") && method === "DELETE") {
    const blk = checkAuthBlock("ingest"); if (blk) return blk;
    const kw = await ingestWorld(request, env); if (!kw) return authFail("ingest", "bad or missing x-world-key");
    const W = await enter(kw); if (refused(W)) return W;
    const imgId = safeDecode(p.slice(9)); if (imgId == null) return J({ error: "malformed image id" }, 400);
    return J(await W.deleteImage(imgId));
  }
  // ---- raw events by source (ingest key): verify a history, find test traffic, then void it through /api/ingest
  if (p === "/api/events") {
    if (method !== "GET") return J({ error: "GET required" }, 405);
    const blk = checkAuthBlock("ingest"); if (blk) return blk;
    const kw = await ingestWorld(request, env); if (!kw) return authFail("ingest", "bad or missing x-world-key");
    const W = await enter(kw); if (refused(W)) return W;
    const since = url.searchParams.get("since"), t = since ? Date.parse(since) : 0;
    if (since && !Number.isFinite(t)) return J({ error: "since is not a time" }, 400);
    const out = await W.listEvents(url.searchParams.get("source") || "", t, Number(url.searchParams.get("limit")) || 500, url.searchParams.get("cursor"), url.searchParams.get("type"));
    return J(out, out.error ? 400 : 200);
  }
  if (p.startsWith("/api/admin/")) {
    if (method !== "POST") return J({ error: "POST required" }, 405);
    const blk = checkAuthBlock("ingest"); if (blk) return blk;
    const kw = await ingestWorld(request, env); if (!kw) return authFail("ingest", "bad or missing x-world-key");
    if (p.startsWith("/api/admin/qc/")) {                  // sandbox maintenance: the QC ingest key, and only that; the marker picks which QC world
      if (kw !== QC) return J({ error: "this route exists only in the QC world: use the QC ingest key" }, 401);
      const W = await enter(QC); if (refused(W)) return W;
      if (p === "/api/admin/qc/reset") return J(await W.qcReset());
      if (p === "/api/admin/qc/seed") return J(await W.qcSeed(url.searchParams.get("keep") === "1"));
      return J({ error: "not found" }, 404);
    }
    const W = await enter(kw); if (refused(W)) return W;
    if (p === "/api/admin/tick") return J(await W.tick(true, url.searchParams.get("feed")));
    if (p === "/api/admin/recompute") return J(await W.replay());
    if (p === "/api/admin/debug") return J(await W.getDebug());
    if (p === "/api/admin/scan-identifiers") return J(await W.scanIdentifiers());
    if (p === "/api/admin/purge-identifiers") return J(await W.purgeIdentifiers(url.searchParams.get("dry") !== "0"));
    if (p === "/api/admin/events") return J(await W.getEvents(url.searchParams.get("type") || "", Number(url.searchParams.get("limit")) || 50));
    return J({ error: "not found" }, 404);
  }

  // ---- manual facts from voice / keypad / watch: ACT key, or the owner's session (same-origin only)
  if (p === "/api/act") {
    if (method !== "POST") return J({ error: "POST required" }, 405);
    const blk = checkAuthBlock("act"); if (blk) return blk;
    const kw = await actWorld(request, env);
    if (!kw) {
      const sess = await getSession(request, env);
      if (!sess || sess.role !== "owner") return authFail("act", "x-act-key or an owner session is required");
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return J({ error: "cross-origin writes denied" }, 403);
    }
    const wr = checkWriteRate("act"); if (wr) return wr;
    const W = await enter(kw); if (refused(W)) return W;
    if (!/^application\/json/.test(request.headers.get("Content-Type") || "")) return J({ error: "Content-Type must be application/json" }, 415);
    const { data: body, err } = await readJson(MAX_SMALL_JSON_BYTES, "body must be JSON");
    if (err) return err;
    const out = await W.act(body, (body && body.channel) || (kw ? "voice" : "web"));
    return J(out, out.ok ? 200 : 400);
  }

  // ---- a phone app as a sensor: owner session only (it holds the session, not the ingest key)
  if (p === "/api/phone") {
    if (method !== "POST") return J({ error: "POST required" }, 405);
    const sess = await getSession(request, env);
    if (!sess) return J({ error: signInHint(env) }, 401);
    if (sess.role !== "owner") return J({ error: "forbidden" }, 403);
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return J({ error: "cross-origin writes denied" }, 403);
    const W = await enter(null); if (refused(W)) return W;
    if (!/^application\/json/.test(request.headers.get("Content-Type") || "")) return J({ error: "Content-Type must be application/json" }, 415);
    const { data: body, err } = await readJson(2_000_000, "body must be JSON: { deviceId, events: [...] }");
    if (err) return err;
    const out = await W.phone(body);
    return J(out, out.ok ? 200 : 400);
  }

  // ---- the client has shown the last day close
  if (p === "/api/seen") {
    if (method !== "POST") return J({ error: "POST required" }, 405);
    const sess = await getSession(request, env);
    if (!sess) return J({ error: signInHint(env) }, 401);
    if (sess.role !== "owner") return J({ error: "forbidden" }, 403);
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return J({ error: "cross-origin writes denied" }, 403);
    const W = await enter(null); if (refused(W)) return W;
    const r = await readBoundedText(request, MAX_SMALL_JSON_BYTES);
    if (!r.ok) return J({ error: r.error }, r.status);
    let body = {}; try { body = r.text ? JSON.parse(r.text) : {}; } catch { body = {}; }
    const out = await W.markSeen(body && body.date, !(body && body.seen === false));
    return J(out, out.ok ? 200 : 400);
  }

  // ---- client diagnostics: what a real device saw. Beside the log, never in it. Posting never fails the page (always 204).
  if (p === "/api/clientlog") {
    if (method === "POST") {
      const sess = await getSession(request, env);
      if (!sess) return J({ error: signInHint(env) }, 401);
      if (sess.role !== "owner") return J({ error: "forbidden" }, 403);
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return J({ error: "cross-origin writes denied" }, 403);
      const W = await enter(null); if (refused(W)) return W;
      const done = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      let text = ""; try { const r = await readBoundedText(request, 100_000); text = r.ok ? r.text : ""; } catch { text = ""; }
      if (!text) return done;
      let body; try { body = JSON.parse(text); } catch { return done; }
      const meta = { sess: (await sha256hex(sess.sid || "")).slice(0, 16), device: uaFamily(request.headers.get("User-Agent")), colo: (request.cf && request.cf.colo) || null };
      ctx.waitUntil(Promise.resolve().then(() => W.clientLogPut(body, meta)).catch(() => {}));       // stored after the reply: the page never waits on it
      return done;
    }
    if (method === "GET") {
      const blk = checkAuthBlock("clientlog"); if (blk) return blk;
      const kw = (await ingestWorld(request, env)) || (await tvWorldOf(request, env, url));
      if (!kw) return authFail("clientlog", "the ingest key (x-world-key) or the TV key (x-tv-key) is required");
      const W = await enter(kw); if (refused(W)) return W;
      const since = url.searchParams.get("since"), t = since ? Date.parse(since) : 0;
      if (since && !Number.isFinite(t)) return J({ error: "since is not a time" }, 400);
      return J(await W.clientLogGet(t, (url.searchParams.get("kind") || "").toLowerCase(), Number(url.searchParams.get("limit")) || 100));
    }
    return J({ error: "POST or GET" }, 405);
  }

  // ---- another world calling this one (docs/MULTIPLAYER.md). No session, no key: the request is signed with the pair's secret and
  // the World object checks it. The marker alone picks the world (a sandbox peer says ?world=qc-…; production has no marker). With
  // peering off (the default) the answer is 404; unknown or unsigned, 401 with nothing in it.
  if (p === "/api/peer/hello" || p === "/api/peer/card") {
    const route = p.slice("/api/peer/".length);
    if ((route === "hello" && method !== "POST") || (route === "card" && method !== "GET")) return J({ error: "not found" }, 404);
    const wr = checkWriteRate("peer"); if (wr) return wr;
    const W = await enter(null); if (refused(W)) return W;
    let text = ""; try { const r = await readBoundedText(request, 20_000); text = r.ok ? r.text : null; } catch { text = null; }
    if (text === null) return J({ error: "unauthorized" }, 401);
    const hdr = {}; for (const n of ["x-peer-id", "x-peer-ts", "x-peer-nonce", "x-peer-sig"]) hdr[n] = request.headers.get(n) || "";
    const r = await W.peerRequest({ method, route, path: url.pathname + url.search, headers: hdr, body: text });
    return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(r.headers || {}) } });
  }

  // ---- a read-only screen (a TV app, a wall display): same state document, key-gated (the key decides the world)
  if (p === "/api/tv" || p.startsWith("/api/tv/model/")) {
    const blk = checkAuthBlock("tv"); if (blk) return blk;
    const tvWorld = await tvWorldOf(request, env, url);
    if (!tvWorld) return authFail("tv", "bad or missing key");
    if (p === "/api/tv") {
      const W = await enter(tvWorld); if (refused(W)) return W;
      return J(await W.getState());
    }
    // Model files for a native screen (read-only): GET /api/tv/model/<file>.usdz|.glb serves public/models/<file>
    // to the TV key, so a new export of the character reaches the app without an app release.
    if (method !== "GET" && method !== "HEAD") return J({ error: "GET required" }, 405);
    const name = safeDecode(p.slice("/api/tv/model/".length));
    if (!name || !/^[a-z0-9][a-z0-9_-]*\.(usdz|glb)$/i.test(name)) return J({ error: "not found" }, 404);
    const h = new Headers();
    const inm = request.headers.get("If-None-Match"); if (inm) h.set("If-None-Match", inm);
    const r = await env.ASSETS.fetch(new Request(new URL("/models/" + name, url.origin), { method, headers: h }));
    if (r.status !== 200 && r.status !== 304) return J({ error: "not found" }, 404);
    const out = new Headers(r.headers);
    out.set("Cache-Control", "private, no-cache");
    if (name.toLowerCase().endsWith(".usdz")) out.set("Content-Type", "model/vnd.usdz+zip");
    return new Response(r.status === 304 ? null : r.body, { status: r.status, headers: out });
  }
  const tvWorld = await tvWorldOf(request, env, url), tvOk = !!tvWorld;

  // ---- people: the owner's session
  const session = await getSession(request, env);
  const isApi = p.startsWith("/api/");

  // ---- scoped read tokens for native widgets (scope world:read)
  if (p === "/api/token") {
    const owner = session && session.role === "owner";
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return J({ error: "cross-origin requests denied" }, 403);
    if (method === "POST") {
      if (!owner) return J({ error: session ? "forbidden" : signInHint(env) }, session ? 403 : 401);
      const wr = checkWriteRate("token"); if (wr) return wr;
      const W = await enter(null); if (refused(W)) return W;
      const r0 = await readBoundedText(request, MAX_SMALL_JSON_BYTES);
      if (!r0.ok) return J({ error: r0.error }, r0.status);
      let body = {}; try { body = r0.text ? JSON.parse(r0.text) : {}; } catch { body = {}; }
      const label = body && typeof body.label === "string" ? body.label.trim().slice(0, 60) : null;
      const token = tokenPrefix(rq.world) + [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, "0")).join("");
      const r = await W.mintToken(await sha256hex(token), session.sid, label, Date.now());
      return J({ token, scope: TOKEN_SCOPE, world: isQcWorld(rq.world) ? rq.world : "production", expiresAt: new Date(r.expires).toISOString(), id: r.id, label, routes: ["/api/glance", "/api/brief", "/api/img/*"] });
    }
    if (method === "GET") {
      if (!owner) return J({ error: session ? "forbidden" : signInHint(env) }, session ? 403 : 401);
      const W = await enter(null); if (refused(W)) return W;
      return J(await W.listTokens(Date.now(), session.sid));
    }
    if (method === "DELETE") {
      const t = bearerOf(request);
      if (TOKEN_RE.test(t)) { const wr = checkWriteRate("token"); if (wr) return wr; const W = await enter({ exact: tokenWorld(t) }); if (refused(W)) return W; return J(await W.revokeTokens({ hash: await sha256hex(t) })); }   // a token may always revoke itself
      if (!owner) return J({ error: "a read token (Authorization: Bearer) or an owner session is required" }, 401);
      const wr = checkWriteRate("token"); if (wr) return wr;
      const W = await enter(null); if (refused(W)) return W;
      const r0 = await readBoundedText(request, MAX_SMALL_JSON_BYTES);
      if (!r0.ok) return J({ error: r0.error }, r0.status);
      let body = {}; try { body = r0.text ? JSON.parse(r0.text) : {}; } catch { body = {}; }
      if (body && typeof body.token === "string" && TOKEN_RE.test(body.token)) return J(await W.revokeTokens({ hash: await sha256hex(body.token) }));
      if (body && typeof body.id === "string") return J(await W.revokeTokens({ id: body.id }));
      if (body && body.all === true) return J(await W.revokeTokens({ all: true }));
      return J(await W.revokeTokens({ sid: session.sid }));                                        // default: every token this session minted
    }
    return J({ error: "POST, GET or DELETE" }, 405);
  }
  // ---- peering (owner session only): the share settings, the peer list, invites, accepts and the pull. docs/MULTIPLAYER.md
  if (p === "/api/share" || p === "/api/peers" || p.startsWith("/api/peers/")) {
    const owner = session && session.role === "owner";
    if (!owner) return J({ error: session ? "forbidden" : signInHint(env) }, session ? 403 : 401);
    const origin = request.headers.get("Origin");
    if (method !== "GET" && origin && origin !== url.origin) return J({ error: "cross-origin writes denied" }, 403);
    const W = await enter(null); if (refused(W)) return W;
    const readBody = async () => {
      const r = await readBoundedText(request, MAX_SMALL_JSON_BYTES);
      if (!r.ok) return { err: J({ error: r.error }, r.status) };
      try { return { data: r.text ? JSON.parse(r.text) : {} }; } catch { return { data: {} }; }
    };
    const reply = out => J(out, out.ok ? 200 : 400);
    if (p === "/api/share") {
      if (method === "GET") return J({ ok: true, ...(await W.peerList()) });
      if (method === "PUT" || method === "POST") { const { data, err } = await readBody(); return err || reply(await W.peeringSet(data)); }
      return J({ error: "GET or PUT" }, 405);
    }
    if (p === "/api/peers") {
      if (method === "GET") return J(await W.peerList());
      if (method === "POST") { const { data: b, err } = await readBody(); if (err) return err; if (!b || typeof b.id !== "string") return J({ error: "id required" }, 400); return reply(await W.peerUpdate(b.id, b)); }
      if (method === "DELETE") { const { data: b, err } = await readBody(); if (err) return err; const id = (b && b.id) || url.searchParams.get("id"); if (typeof id !== "string") return J({ error: "id required" }, 400); return reply(await W.peerDelete(id)); }
      return J({ error: "GET, POST or DELETE" }, 405);
    }
    if (method !== "POST") return J({ error: "POST required" }, 405);
    if (p === "/api/peers/invite") { const { data, err } = await readBody(); return err || reply(await W.peerInvite(data, url.origin)); }
    if (p === "/api/peers/accept") { const { data, err } = await readBody(); return err || reply(await W.peerAccept(data, url.origin)); }
    if (p === "/api/peers/refresh") { const { data: b, err } = await readBody(); return err || reply(await W.peerRefresh(b && typeof b.id === "string" ? b.id : null)); }
    return J({ error: "not found" }, 404);
  }
  // Read tokens open exactly three GET routes. Anywhere else a token is ignored and the request falls through to the session check.
  const isOwner = !!(session && session.role === "owner");
  const tokWorld = tokenRoute(method, p) && !tvOk && !isOwner ? await readTokenWorld(request, env) : null;
  const tvReadable = !!tokWorld || (tvOk && (p === "/api/live" || p === "/api/brief" || p === "/api/glance" || p === "/api/days" || p.startsWith("/api/img/")));
  if (!tvReadable) {
    if (!session) return J({ error: signInHint(env) }, 401);
    if (!isOwner) return isApi ? J({ error: "forbidden" }, 403) : new Response("forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  // The credential that opened this request settles the world: a token or TV key its own; an owner session follows the marker.
  const cred = tokWorld ? { exact: tokWorld } : tvReadable && tvOk ? tvWorld : null;
  if (isApi) {
    const W = await enter(cred); if (refused(W)) return W;
    if (p === "/api/live") {
      if (request.headers.get("Upgrade") !== "websocket") return J({ error: "WebSocket upgrade required" }, 426);
      return W.fetch(request);
    }
    if (method !== "GET") return J({ error: "GET required" }, 405);
    if (p === "/api/state") return J(await W.getState());
    if (p === "/api/log") return J(await W.getLog(url.searchParams.get("cursor"), Number(url.searchParams.get("limit")) || 100, Date.parse(url.searchParams.get("before") || "") || null));
    if (p === "/api/glance") {
      const g = await W.getGlance(), h = { ETag: g.etag, "Cache-Control": "private, max-age=60, stale-while-revalidate=120" };
      if (etagMatches(request.headers.get("If-None-Match"), g.etag)) return new Response(null, { status: 304, headers: h });
      return J(g.body, 200, h);
    }
    if (p === "/api/brief") return J(await W.getBrief(url.searchParams.get("kind") || "now"));
    if (p === "/api/tasks") return J(await W.getTasks());
    if (p === "/api/days") return J(await W.getDays(Number(url.searchParams.get("limit")) || 400));
    if (p === "/api/rules") {
      if (!rulesCache) { const doc = await W.getRules(); rulesCache = { doc, etag: jsonEtag("r1", doc) }; }
      const h = { ETag: rulesCache.etag, "Cache-Control": "private, max-age=300, stale-while-revalidate=3600" };
      if (etagMatches(request.headers.get("If-None-Match"), rulesCache.etag)) return new Response(null, { status: 304, headers: h });
      return J(rulesCache.doc, 200, h);
    }
    if (p === "/api/signals") return J(await W.getDebug());
    if (p.startsWith("/api/img/")) {
      const imgId = safeDecode(p.slice(9));
      if (!imgId) return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
      const img = await W.getImage(imgId);
      if (!img) return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
      const etag = '"' + img.at + '"', h = { "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800", ETag: etag };
      if (etagMatches(request.headers.get("If-None-Match"), etag)) return new Response(null, { status: 304, headers: h });
      return new Response(img.bytes, { headers: { "Content-Type": img.type, ...h } });
    }
    return J({ error: "not found" }, 404);
  }
  // ---- the page. Opened with ?world=qc it is the QC world: tagged, and its API calls carry the marker.
  if (asked === null) return new Response("unknown world", { status: 400, headers: { "Cache-Control": "no-store" } });
  const rawAsset = await env.ASSETS.fetch(request);
  const ct = rawAsset.headers.get("Content-Type") || "";
  let page = stylePage(rawAsset, env);
  if (isQcWorld(asked)) { rq.world = asked; page = qcPage(page, asked); }
  const ah = new Headers(page.headers);
  if (page.status === 200 || page.status === 206 || page.status === 304) {
    ah.set("Cache-Control", cacheControlFor(p, ct, env.DEV === "1"));
  } else {
    ah.set("Cache-Control", "no-store");
  }
  const nullBody = page.status === 204 || page.status === 304;
  return new Response(nullBody ? null : page.body, { status: page.status, statusText: page.statusText, headers: ah });
}

export default {
  async fetch(request, env, ctx) {
    const rq = { world: null };
    const url = new URL(request.url), isApi = url.pathname.startsWith("/api/"), isHttps = url.protocol === "https:";
    let res;
    try {
      res = await handle(request, env, ctx, rq);
    } catch (e) {
      console.log("fetch failed: " + String((e && e.message) || e).slice(0, 200));
      res = isApi
        ? J({ error: "internal error" }, 500)
        : new Response("internal error", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    }
    if (res.status === 101 || res.webSocket) return res;
    const h = new Headers(res.headers);
    const isHtml = /text\/html/i.test(h.get("Content-Type") || "");
    applySecurityHeaders(h, { isHtml, isApi, isHttps });
    if (isQcWorld(rq.world)) h.set("x-world", rq.world);       // every answer from a sandbox says so, and which one
    const nullBody = res.status === 204 || res.status === 304;
    return new Response(nullBody ? null : res.body, { status: res.status, statusText: res.statusText, headers: h });
  },

  // Every 5 minutes, production only. The Durable Object also keeps its own alarm; whichever fires first runs
  // the tick and the other one is a no-op, so a missed cron or a lost alarm repairs itself. The QC world has no tick.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(stubFor(env, PROD).then(w => w.tick(false)).catch(e => console.log("tick failed: " + ((e && e.message) || e))));
  },
};
