// Account identifiers never rest in the engine or leave it in full. Pure.
//   maskAccountText("Example Bank (GB29 NWBK 6016 1331 9268 19)") -> "Example Bank (•••• 6819)"
// Two strengths:
//   strict (money events and money text): IBAN-shaped strings, any run of 8 or more digits
//     (spaces and dashes allowed), 0x addresses, and any 26+ character alphanumeric token that
//     mixes letters and digits (wallet addresses).
//   safe (every other event): only strings that are certainly identifiers: IBANs with a valid
//     checksum, card numbers that pass the Luhn check, 0x addresses of 40 hex digits, bech32
//     addresses, and mixed-case base58 addresses. Ids, URLs and ordinary numbers are untouched.
// Kept in both: UUIDs (internal ids, not account numbers), ISO dates, URLs, amounts.
const PROTECT = /https?:\/\/[^\s"'<>)]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?\b/gi;
const alnum = m => m.replace(/[^A-Za-z0-9]/g, "");
export const last4 = m => alnum(m).slice(-4);
const tail = m => "•••• " + last4(m);
const IBAN_SHAPE = /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{2,4}){2,8}\b/g;
function ibanValid(m) {
  const s = alnum(m).toUpperCase(); if (s.length < 15 || s.length > 34) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let mod = 0; for (const ch of r) mod = (mod * 10 + +ch) % 97;
  return mod === 1;
}
function luhn(m) {
  const d = m.replace(/\D/g, ""); if (d.length < 13 || d.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
}
// [kind, pattern, is this match an identifier?]
const STRICT = [
  ["iban", IBAN_SHAPE, m => alnum(m).length >= 14],
  ["address", /\b0x[0-9a-fA-F]{16,}\b/g, () => true],
  ["address", /\b[A-Za-z0-9]{26,}\b/g, m => /\d/.test(m) && /[A-Za-z]/.test(m)],
  ["number", /\b\d(?:[ -]?\d){7,}\b/g, () => true],
];
const SAFE = [
  ["iban", IBAN_SHAPE, ibanValid],
  ["address", /\b0x[0-9a-fA-F]{40}\b/g, () => true],
  ["address", /\bbc1[a-z0-9]{25,62}\b/g, () => true],
  ["address", /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, m => /[A-Z]/.test(m) && /[a-z]/.test(m) && /\d/.test(m)],
  ["number", /\b\d(?:[ -]?\d){12,18}\b/g, luhn],
];
function run(s, rules, hits) {
  const part = t => { for (const [kind, re, ok] of rules) t = t.replace(re, m => (ok(m) ? (hits && hits.push({ kind, last4: last4(m) }), tail(m)) : m)); return t; };
  let out = "", last = 0;
  for (const m of s.matchAll(PROTECT)) { out += part(s.slice(last, m.index)) + m[0]; last = m.index + m[0].length; }
  return out + part(s.slice(last));
}
export function maskAccountText(s) { return typeof s === "string" && s ? run(s, STRICT, null) : s; }
export function maskSafeText(s) { return typeof s === "string" && s && !/^https?:\/\//i.test(s) ? run(s, SAFE, null) : s; }
/** Identifier-shaped strings in a text: [{ kind, last4 }]. Never returns the identifier itself. */
export function findIdentifiers(s, strict) {
  if (typeof s !== "string" || !s || (!strict && /^https?:\/\//i.test(s))) return [];
  const hits = []; run(s, strict ? STRICT : SAFE, hits); return hits;
}
const ID_KEY = /^(id|img|url|hash|entry|eventId|taskId|itemId|contactId|placeId|questId|inside)$/;
const isMoney = type => String(type).startsWith("money.");
/** Walk every string in a value. visit(string, strict, path) -> replacement string. Keys that hold ids are left alone outside money events. */
function walk(v, strict, visit, path) {
  if (typeof v === "string") return visit(v, strict, path);
  if (Array.isArray(v)) return v.map((x, i) => walk(x, strict, visit, path + "[" + i + "]"));
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = !strict && ID_KEY.test(k) ? v[k] : walk(v[k], strict, visit, path ? path + "." + k : k);
    return o;
  }
  return v;
}
/** What is stored for an event: the same data with every identifier masked. Applied at ingest, to every event from every source. */
export function maskEventData(type, data) {
  if (!data || typeof data !== "object") return data;
  const strict = isMoney(type);
  const d = strict && typeof data.account === "number" ? { ...data, account: String(data.account) } : data;
  return walk(d, strict, (s, st) => (st ? maskAccountText(s) : maskSafeText(s)), "");
}
/** Identifier-shaped strings anywhere in a JSON value: [{ path, kind, last4 }]. strictAt(path) says where the strict rules apply. */
export function scanValue(v, strictAt) {
  const out = [];
  const go = (x, path, key) => {
    if (typeof x === "string") { const strict = strictAt(path, key); if (!strict && ID_KEY.test(key || "")) return; for (const h of findIdentifiers(x, strict)) out.push({ path, ...h }); }
    else if (Array.isArray(x)) x.forEach((y, i) => go(y, path + "[]", key));
    else if (x && typeof x === "object") for (const k of Object.keys(x)) go(x[k], path ? path + "." + k : k, k);
  };
  go(v, "", ""); return out;
}
export const moneyType = isMoney;
