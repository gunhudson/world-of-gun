// Sign-in: the Cloudflare Access JWT in front of the worker is verified against the
// team's published keys; audience, expiry, issuer and signature all have to be right; the owner is OWNER_EMAIL only.
import * as A from "../src/access.js";
import { assert, test, done } from "./helpers.mjs";

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = s => b64u(new TextEncoder().encode(s));
const atest = async (name, fn) => { const err = await fn().then(() => null, e => e); test(name, () => { if (err) throw err; }); };

async function all() {
  const team = "example-team", aud = "a".repeat(64), nowS = Math.floor(Date.now() / 1000);
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const certs = { keys: [{ kid: "k1", kty: "RSA", alg: "RS256", use: "sig", n: pub.n, e: pub.e }] };
  const fetchCerts = async url => { assert.equal(url, A.certsUrl(team)); return { ok: true, json: async () => certs }; };
  const sign = async (claims, key = pair.privateKey, header = { alg: "RS256", kid: "k1", typ: "JWT" }) => {
    const h = enc(JSON.stringify(header)), c = enc(JSON.stringify(claims));
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(h + "." + c));
    return h + "." + c + "." + b64u(sig);
  };
  const good = { aud: [aud], email: "Friend@example.org", exp: nowS + 3600, iat: nowS, nbf: nowS - 5, iss: `https://${team}.cloudflareaccess.com`, sub: "sub-1" };
  const opts = { fetch: fetchCerts };

  await atest("a valid Access token verifies: email lower-cased, sub and exp through", async () => {
    A._resetCertsCache();
    const v = await A.verifyAccessToken(await sign(good), team, aud, opts);
    assert.deepEqual(v, { ok: true, email: "friend@example.org", sub: "sub-1", exp: good.exp });
  });
  await atest("wrong audience, expired, wrong issuer, another key, a tampered body, no email: all refused", async () => {
    assert.equal((await A.verifyAccessToken(await sign({ ...good, aud: ["b".repeat(64)] }), team, aud, opts)).error, "wrong audience");
    assert.equal((await A.verifyAccessToken(await sign({ ...good, exp: nowS - 120 }), team, aud, opts)).error, "expired");
    assert.equal((await A.verifyAccessToken(await sign({ ...good, iss: "https://evil.cloudflareaccess.com" }), team, aud, opts)).error, "wrong issuer");
    assert.equal((await A.verifyAccessToken(await sign(good, other.privateKey), team, aud, opts)).error, "bad signature");
    assert.equal((await A.verifyAccessToken(await sign(good, pair.privateKey, { alg: "RS256", kid: "k9" }), team, aud, opts)).error, "unknown signing key");
    assert.equal((await A.verifyAccessToken(await sign(good, pair.privateKey, { alg: "HS256", kid: "k1" }), team, aud, opts)).error, "unexpected algorithm");
    const t = await sign(good); const [h, , s] = t.split(".");
    assert.equal((await A.verifyAccessToken(h + "." + enc(JSON.stringify({ ...good, email: "owner@example.org" })) + "." + s, team, aud, opts)).error, "bad signature");
    assert.equal((await A.verifyAccessToken(await sign({ ...good, email: undefined }), team, aud, opts)).error, "no email in token");
    assert.equal((await A.verifyAccessToken("nonsense", team, aud, opts)).error, "not a JWT");
  });
  await atest("the session: OWNER_EMAIL is the owner, anyone else Access lets through is a user; no token = no session", async () => {
    const env = { ACCESS_TEAM: team, ACCESS_AUD: aud, OWNER_EMAIL: "Friend@example.org" };
    assert.equal(A.accessConfigured(env), true); assert.equal(A.accessConfigured({ ACCESS_TEAM: team }), false);
    const req = t => ({ headers: new Headers(t ? { "Cf-Access-Jwt-Assertion": t } : {}) });
    const s = await A.accessSession(req(await sign(good)), env, opts);
    assert.deepEqual(s, { email: "friend@example.org", role: "owner", name: "", sid: "access:sub-1" });
    const u = await A.accessSession(req(await sign({ ...good, email: "someone@example.org", sub: "sub-2" })), env, opts);
    assert.equal(u.role, "user");
    assert.equal(await A.accessSession(req(null), env, opts), null);
    assert.equal(await A.accessSession(req(await sign({ ...good, exp: nowS - 999 })), env, opts), null);
    const viaCookie = await A.accessSession({ headers: new Headers({ Cookie: "CF_Authorization=" + (await sign(good)) + "; other=1" }) }, env, opts);
    assert.equal(viaCookie.role, "owner");
  });
  done("access");
}
all();
