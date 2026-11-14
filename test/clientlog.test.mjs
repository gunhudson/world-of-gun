// Client diagnostics: cleaning, credential scrubbing, size cap, device family, rate limit.
import { cleanEntries, scrub, uaFamily, allowEntries, CLIENTLOG_PER_MINUTE } from "../src/clientlog.js";
import { reduce } from "../src/reduce.js";
import { EVENT_TYPES } from "../src/rules.js";
import { normaliseEvent } from "../src/ingest.js";
import { assert, test, done, NOW, feedsFresh } from "./helpers.mjs";

const model = { kind: "model", detail: { url: "/models/gun.glb", stage: "decode", httpStatus: 200, bytesReceived: 4812345, bytesDeclared: 18233112, error: "RangeError: Array buffer allocation failed", attempt: 2, limits: { maxTextureSize: 4096, maxVertexUniformVectors: 256 } },
  ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148", build: "app-24", t: NOW - 1500 };
test("a model failure and a boot summary are stored as sent, with the client time as ISO", () => {
  const boot = { kind: "boot", detail: { quality: "mid", renderer: "Apple GPU", maxTextureSize: 4096, deviceMemory: null, connection: "wifi", viewport: [390, 844, 3], standalone: false, inApp: true }, t: new Date(NOW - 900).toISOString() };
  const out = cleanEntries([model, boot], NOW);
  assert.equal(out.length, 2); assert.deepEqual(out[0].detail, model.detail); assert.equal(out[0].kind, "model"); assert.equal(out[0].build, "app-24"); assert.equal(out[0].t, new Date(NOW - 1500).toISOString());
  assert.deepEqual(out[1].detail, boot.detail); assert.equal(out[1].t, new Date(NOW - 900).toISOString()); assert.equal(out[1].ua, null);
  assert.deepEqual(cleanEntries(model, NOW).length, 1);                                         // a single object is accepted too
});
test("at most 20 per request; malformed entries are dropped without an error", () => {
  assert.equal(cleanEntries(new Array(45).fill(model), NOW).length, 20);
  for (const bad of [null, undefined, "text", 5, [], [null, 3, "x", {}], { detail: "no kind" }, { kind: "Has Space" }, { kind: "x".repeat(60) }, { kind: "../etc" }]) assert.deepEqual(cleanEntries(bad, NOW), [], JSON.stringify(bad));
  assert.equal(cleanEntries({ kind: "boot", t: "not a time" }, NOW)[0].t, null); assert.equal(cleanEntries({ kind: "boot", t: 5 }, NOW)[0].t, null);   // a wild client clock is not recorded
  assert.equal(cleanEntries({ kind: "MODEL" }, NOW)[0].kind, "model"); assert.equal(cleanEntries({ kind: "model" }, NOW)[0].detail, null);
});
test("anything shaped like a credential is stripped before storing", () => {
  const hex64 = "0123456789abcdef".repeat(4);
  const e = cleanEntries({ kind: "model", ua: "x CF_Authorization=abcdef1234567890 y", build: "wogr_" + hex64, detail: { url: "https://world.example.org/api/img/x?key=" + hex64 + "&world=qc", error: "401 with Authorization: Bearer wogq-ui_" + hex64 + " and cookie CF_Authorization=s3cr3tvalue; token=abc12345",
    headers: { cookie: "CF_Authorization=zzz", Authorization: "Bearer abc.def.ghi", "x-world-key": hex64 }, note: "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c", ok: "model gun.glb 18233112 bytes", nested: [{ password: "hunter22" }] } }, NOW)[0];
  const text = JSON.stringify(e);
  for (const secret of [hex64, "abcdef1234567890", "s3cr3tvalue", "abc12345", "zzz", "abc.def.ghi", "hunter22", "SflKxwRJSMeKKF2QT4fw", "wogq-ui_0123"]) assert.ok(!text.includes(secret), "kept: " + secret);
  assert.ok(text.includes("model gun.glb 18233112 bytes")); assert.ok(text.includes("world=qc")); assert.equal(e.detail.headers.cookie, "[redacted]"); assert.equal(e.build, "[token]");
  assert.equal(scrub("plain message, status 404, 12 ms"), "plain message, status 404, 12 ms");
});
test("an entry is capped at about 2 KB", () => {
  const big = cleanEntries({ kind: "model", detail: { error: "x".repeat(50000), stack: ["y".repeat(9000)] } }, NOW)[0];
  assert.equal(big.detail.truncated, true); assert.ok(JSON.stringify(big).length < 2300, JSON.stringify(big).length); assert.ok(big.detail.bytes > 50000);
  assert.ok(JSON.stringify(cleanEntries({ kind: "boot", ua: "u".repeat(5000), build: "b".repeat(500) }, NOW)[0]).length < 600);
});
test("the device hint is a family, never the full user agent", () => {
  assert.equal(uaFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"), "iPhone · iOS 18.1 · in-app web view");
  assert.equal(uaFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"), "iPhone · iOS 18.1 · Safari");
  assert.equal(uaFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 ExampleApp/24"), "iPhone · iOS 18.1 · in-app web view");
  assert.equal(uaFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"), "Mac · macOS 10.15 · Chrome");
  assert.equal(uaFamily("Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1"), "iPad · iOS 17.6 · Safari");
  assert.equal(uaFamily("curl/8.7.1"), "other · script"); assert.equal(uaFamily(""), null);
  assert.ok(uaFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148").length < 50);
});
test("rate limit: 60 entries a minute per session, then quietly dropped; other sessions are unaffected", () => {
  const b = new Map();
  assert.equal(allowEntries(b, "s1", 20, NOW), 20); assert.equal(allowEntries(b, "s1", 20, NOW + 1000), 20); assert.equal(allowEntries(b, "s1", 20, NOW + 2000), 20);
  assert.equal(allowEntries(b, "s1", 20, NOW + 3000), 0); assert.equal(allowEntries(b, "s1", 1, NOW + 59000), 0);
  assert.equal(allowEntries(b, "s2", 20, NOW + 3000), 20);
  assert.equal(allowEntries(b, "s1", 20, NOW + 61500), 20); assert.equal(CLIENTLOG_PER_MINUTE, 60);          // the first batch has aged out
  assert.equal(allowEntries(new Map(), "s3", 75, NOW), 60);
});
test("diagnostics are not life data: there is no event type for them and they cannot reach state", () => {
  assert.equal(EVENT_TYPES.clientlog, undefined); assert.equal(EVENT_TYPES["client.log"], undefined);
  assert.equal(normaliseEvent({ id: "x", ts: NOW, type: "clientlog", source: "phone:x", data: model }, NOW).ok, false);
  const s = reduce([], feedsFresh, NOW).state; assert.ok(!("clientlog" in s)); assert.equal(s.character.xpTotal, 0);
});
done("client diagnostics");
