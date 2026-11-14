// The worker entry (src/index.js) under Node: who gets in. The Workers runtime module is replaced by a stub and the
// World object by a recorder, so only routing and credentials are exercised here.
import { register } from "node:module";
import { assert, test, done } from "./helpers.mjs";

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec !== "cloudflare:workers") return next(spec, ctx);
  return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
}`));
const worker = (await import("../src/index.js")).default;

const atest = async (name, fn) => { const err = await fn().then(() => null, e => e); test(name, () => { if (err) throw err; }); };
/** A stand-in for the Durable Object namespace: every call is recorded with the world it was addressed to. */
function fakeEnv(vars = {}) {
  const calls = [], tokens = new Set();
  const stub = name => new Proxy({}, { get: (_, method) => method === "then" ? undefined : async (...args) => {
    calls.push({ world: name, method, args });
    if (method === "getState") return { v: 1, world: name };
    if (method === "getGlance") return { body: { v: 1, world: name }, etag: '"g1-test"' };
    if (method === "checkToken") return tokens.has(args[0]) ? { sid: "dev" } : null;
    if (method === "mintToken") { tokens.add(args[0]); return { id: args[0].slice(0, 12), expires: args[3] + 1000 }; }
    if (method === "ingest") return { ok: true, accepted: args[0].length };
    if (method === "act") return { ok: true, channel: args[1] };
    return { ok: true };
  } });
  return { calls, env: { WORLD: { idFromName: n => n, get: stub }, ASSETS: { fetch: async () => new Response("<html></html>", { headers: { "Content-Type": "text/plain" } }) }, ...vars } };
}
const call = async (env, path, init = {}) => { const r = await worker.fetch(new Request("https://world.example.org" + path, init), env, { waitUntil() {} }); return { status: r.status, headers: r.headers, body: await r.text().then(t => { try { return JSON.parse(t); } catch { return t; } }) }; };
const json = body => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function all() {
  await atest("with no sign-in configured every page and session route answers 401 and says how to set one up", async () => {
    const { env, calls } = fakeEnv();
    for (const path of ["/", "/api/state", "/api/log", "/api/glance", "/api/tasks"]) { const r = await call(env, path); assert.equal(r.status, 401, path); assert.match(r.body.error, /ACCESS_TEAM and ACCESS_AUD/); }
    for (const path of ["/api/phone", "/api/seen", "/api/token", "/api/peers/invite"]) assert.equal((await call(env, path, json({}))).status, 401, path);
    assert.equal((await call(env, "/api/act", json({ type: "checkin", mood: 7 }))).status, 401);
    assert.equal((await call(env, "/healthz")).body, "ok");
    assert.equal(calls.length, 0);                                                          // nothing reached the world
  });
  await atest("DEV=1 is an owner session for local play; production is the default world and ?world=qc reaches the sandbox", async () => {
    const { env, calls } = fakeEnv({ DEV: "1" });
    const r = await call(env, "/api/state"); assert.equal(r.status, 200); assert.equal(r.body.world, "gun"); assert.equal(r.headers.get("x-world"), null);
    const q = await call(env, "/api/state?world=qc-ui"); assert.equal(q.body.world, "qc-ui"); assert.equal(q.headers.get("x-world"), "qc-ui");
    assert.ok(calls.some(c => c.world === "qc-ui" && c.method === "markQC"));
    assert.equal((await call(env, "/")).status, 200);
    const a = await call(env, "/api/act", json({ type: "checkin", mood: 7 })); assert.equal(a.status, 200); assert.equal(a.body.channel, "web");
    assert.equal((await call(env, "/api/act", { ...json({}), headers: { "Content-Type": "application/json", Origin: "https://elsewhere.example.org" } })).status, 403);
  });
  await atest("with Cloudflare Access configured a request without a valid Access token has no session", async () => {
    const { env, calls } = fakeEnv({ ACCESS_TEAM: "example-team", ACCESS_AUD: "a".repeat(64), OWNER_EMAIL: "owner@example.org" });
    const r = await call(env, "/api/state"); assert.equal(r.status, 401); assert.equal(r.body.error, "sign in through Cloudflare Access");
    assert.equal((await call(env, "/api/state", { headers: { "Cf-Access-Jwt-Assertion": "not.a.token" } })).status, 401);
    assert.equal(calls.length, 0);
  });
  await atest("machine keys: the ingest key writes, the wrong key does not, and a key decides the world by itself", async () => {
    const { env, calls } = fakeEnv({ INGEST_KEY: "prod-key-example", QC_INGEST_KEY: "qc-key-example", TV_KEY: "tv-key-example" });
    assert.equal((await call(env, "/api/ingest", json({ events: [] }))).status, 401);
    assert.equal((await call(env, "/api/ingest", { ...json({ events: [] }), headers: { "Content-Type": "application/json", "x-world-key": "nope" } })).status, 401);
    const ok = await call(env, "/api/ingest", { ...json({ events: [{}, {}] }), headers: { "Content-Type": "application/json", "x-world-key": "prod-key-example" } });
    assert.equal(ok.status, 200); assert.equal(ok.body.accepted, 2); assert.equal(calls.at(-1).world, "gun");
    await call(env, "/api/ingest", { ...json({ events: [{}] }), headers: { "Content-Type": "application/json", "x-world-key": "qc-key-example" } });
    assert.equal(calls.at(-1).world, "qc");
    const crossed = await call(env, "/api/ingest?world=qc", { ...json({ events: [] }), headers: { "Content-Type": "application/json", "x-world-key": "prod-key-example" } });
    assert.equal(crossed.status, 409);                                                      // a production key never writes to a sandbox
    assert.equal((await call(env, "/api/tv", { headers: { "x-tv-key": "tv-key-example" } })).status, 200);
    assert.equal((await call(env, "/api/tv")).status, 401);
    assert.equal((await call(env, "/api/admin/qc/reset", { method: "POST", headers: { "x-world-key": "prod-key-example" } })).status, 401);
  });
  await atest("a read token opens the glance and nothing else, and lives until it is revoked or expires", async () => {
    const { env, calls } = fakeEnv({ DEV: "1" });
    const minted = await call(env, "/api/token", json({ label: "widget" }));
    assert.equal(minted.status, 200); assert.match(minted.body.token, /^wogr_[a-f0-9]{64}$/); assert.equal(minted.body.world, "production");
    const bare = { ...env, DEV: undefined }, auth = { headers: { Authorization: "Bearer " + minted.body.token } };
    const g = await call(bare, "/api/glance", auth); assert.equal(g.status, 200); assert.equal(g.body.world, "gun");
    assert.equal((await call(bare, "/api/state", auth)).status, 401);                       // a token is ignored everywhere else
    assert.equal((await call(bare, "/api/glance", { headers: { Authorization: "Bearer wogr_" + "0".repeat(64) } })).status, 401);
    assert.ok(!calls.some(c => c.method === "tokenSessionOk"));                             // no session store is consulted
  });
  done("worker entry");
}
await all();
