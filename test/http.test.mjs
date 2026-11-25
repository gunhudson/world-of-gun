// HTTP security headers, cache policies, conditional ETags, streaming bounded reads, safe decoding,
// and per-isolate rate limiting (src/http.js).
import * as H from "../src/http.js";
import { assert, test, done } from "./helpers.mjs";

const atest = async (name, fn) => { const err = await fn().then(() => null, e => e); test(name, () => { if (err) throw err; }); };

test("cacheControlFor sets private caching by asset class, no-cache for unhashed app JS/CSS and HTML", () => {
  const vendor = H.cacheControlFor("/vendor/three/build/three.module.min.js", "text/javascript", false);
  assert.equal(vendor, "private, max-age=86400, stale-while-revalidate=604800");
  const vendorDev = H.cacheControlFor("/vendor/three/build/three.module.min.js", "text/javascript", true);
  assert.equal(vendorDev, "private, no-cache");
  const model = H.cacheControlFor("/models/gun.glb", "model/gltf-binary", false);
  assert.equal(model, "private, max-age=86400, stale-while-revalidate=604800");
  const audio = H.cacheControlFor("/audio/theme.mp3", "audio/mpeg", false);
  assert.equal(audio, "private, max-age=86400, stale-while-revalidate=604800");
  const texImg = H.cacheControlFor("/tex/gun_body_base.jpg", "image/jpeg", false);
  assert.equal(texImg, "private, max-age=86400, stale-while-revalidate=604800");
  const texJson = H.cacheControlFor("/tex/outfits.json", "application/json", false);
  assert.equal(texJson, "private, no-cache");
  const appProd = H.cacheControlFor("/app/main.js", "text/javascript", false);
  assert.equal(appProd, "private, no-cache");
  assert.equal(H.cacheControlFor("/", "text/html; charset=utf-8", false), "private, no-cache");
  assert.equal(H.cacheControlFor("/dev/stage.html", "text/html", false), "private, no-cache");
  for (const cc of [vendor, vendorDev, model, audio, texImg, texJson, appProd]) {
    assert.ok(cc.startsWith("private,"), "auth-gated asset must be private: " + cc);
  }
});

test("applySecurityHeaders sets CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy, and frame protections", () => {
  const htmlH = H.applySecurityHeaders(new Headers(), { isHtml: true, isApi: false, isHttps: true });
  assert.equal(htmlH.get("X-Content-Type-Options"), "nosniff");
  assert.equal(htmlH.get("Strict-Transport-Security"), "max-age=31536000; includeSubDomains");
  assert.equal(htmlH.get("Referrer-Policy"), "same-origin");
  assert.equal(htmlH.get("X-Frame-Options"), "SAMEORIGIN");
  assert.equal(htmlH.get("Permissions-Policy"), H.PERMISSIONS_POLICY);
  assert.ok(htmlH.get("Content-Security-Policy").includes("'wasm-unsafe-eval'"));
  assert.ok(htmlH.get("Content-Security-Policy").includes("worker-src 'self' blob:"));
  assert.ok(htmlH.get("Content-Security-Policy").includes("manifest-src 'self' blob:"));
  assert.ok(htmlH.get("Content-Security-Policy").includes("frame-ancestors 'self'"));

  const apiH = H.applySecurityHeaders(new Headers(), { isHtml: false, isApi: true, isHttps: true });
  assert.equal(apiH.get("Content-Security-Policy"), H.API_CSP);
  assert.equal(apiH.get("Referrer-Policy"), "no-referrer");
  assert.equal(apiH.get("X-Frame-Options"), "DENY");
  assert.equal(apiH.get("Strict-Transport-Security"), "max-age=31536000; includeSubDomains");

  const httpH = H.applySecurityHeaders(new Headers(), { isHtml: true, isApi: false, isHttps: false });
  assert.equal(httpH.get("Strict-Transport-Security"), null);
});

test("etagMatches handles exact, weak, comma-separated, wildcard, and mismatched ETags", () => {
  const tag = H.jsonEtag("r1", { a: 1, b: [2, 3] });
  assert.match(tag, /^"r1-[0-9a-f]{16}"$/);
  assert.equal(H.etagMatches(tag, tag), true);
  assert.equal(H.etagMatches("W/" + tag, tag), true);
  assert.equal(H.etagMatches('"other", ' + tag, tag), true);
  assert.equal(H.etagMatches("*", tag), true);
  assert.equal(H.etagMatches('"wrong"', tag), false);
  assert.equal(H.etagMatches("", tag), false);
});

test("safeDecode decodes valid segments and returns null on malformed percent-encoding", () => {
  assert.equal(H.safeDecode("item-abc%201"), "item-abc 1");
  assert.equal(H.safeDecode("%E0%A4%A"), null);
});

test("RateLimiter enforces sliding-window caps and evicts expired entries", () => {
  const rl = new H.RateLimiter({ windowMs: 1000, maxKeys: 3 });
  assert.equal(rl.take("a", 2, 100).ok, true);
  assert.equal(rl.take("a", 2, 200).ok, true);
  const hit = rl.take("a", 2, 300);
  assert.equal(hit.ok, false);
  assert.equal(hit.retryAfterSec, 1);
  assert.equal(rl.blocked("a", 2, 300).blocked, true);
  assert.equal(rl.blocked("a", 2, 1101).blocked, false);
  assert.equal(rl.take("a", 2, 1101).ok, true);
  rl.take("b", 2, 1200); rl.take("c", 2, 1200); rl.take("d", 2, 1200);
  assert.ok(rl.buckets.size <= 3);
});

async function runAsync() {
  await atest("readBoundedText streams and rejects oversized Content-Length, multi-byte UTF-8, and chunked streams early", async () => {
    const bigHeader = new Request("https://world.example.org/api/act", { method: "POST", headers: { "Content-Length": "999999" }, body: "{}" });
    const r1 = await H.readBoundedText(bigHeader, 1000);
    assert.equal(r1.ok, false); assert.equal(r1.status, 413);

    const utf8Req = new Request("https://world.example.org/api/act", { method: "POST", body: "🔥".repeat(400) });
    const rUtf8 = await H.readBoundedText(utf8Req, 1000);
    assert.equal(rUtf8.ok, false); assert.equal(rUtf8.status, 413);

    let pulled = 0;
    const stream = new ReadableStream({
      pull(ctrl) {
        pulled++;
        if (pulled > 10) { ctrl.close(); return; }
        ctrl.enqueue(new Uint8Array(600));
      },
    });
    const streamReq = new Request("https://world.example.org/api/act", { method: "POST", body: stream, duplex: "half" });
    const rStream = await H.readBoundedBytes(streamReq, 1000);
    assert.equal(rStream.ok, false); assert.equal(rStream.status, 413);
    assert.ok(pulled <= 3, "should abort stream early, pulled=" + pulled);

    const okReq = new Request("https://world.example.org/api/act", { method: "POST", body: '{"type":"note","text":"hi"}' });
    const r3 = await H.readBoundedText(okReq, 1000);
    assert.equal(r3.ok, true); assert.equal(JSON.parse(r3.text).type, "note");
  });
  done("http helpers");
}
runAsync();
