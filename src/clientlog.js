// Client diagnostics: what a real device saw (a model that would not load, the boot summary).
// Not life data: it is kept beside the event log, never enters it, and never feeds state, XP or
// the combat log. Pure helpers here; storage in src/world.js (newest 500 per world).
import { maskSafeText } from "./lib/mask.js";

export const CLIENTLOG_KEEP = 500, CLIENTLOG_MAX_BATCH = 20, CLIENTLOG_ENTRY_BYTES = 2000, CLIENTLOG_PER_MINUTE = 60;

/** Remove anything shaped like a credential: session cookies, bearer tokens, keys in query strings, long hex, JWTs. */
export function scrub(s) {
  if (typeof s !== "string") return s;
  return maskSafeText(s
    .replace(/\bwog[rq](?:-[a-z0-9-]+)?_[A-Za-z0-9]{8,}/g, "[token]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{6,}/gi, "$1 [redacted]")
    .replace(/\b(cf_authorization|sid|session|sessionid|token|access_token|api[_-]?key|key|secret|password|passwd|authorization|cookie|x-[a-z-]*key)(["']?\s*[=:]\s*["']?)[^\s"'&;,}\])]{4,}/gi, "$1$2[redacted]")
    .replace(/\b[a-fA-F0-9]{32,}\b/g, "[hex]"));
}
const scrubDeep = v => (typeof v === "string" ? scrub(v) : Array.isArray(v) ? v.slice(0, 50).map(scrubDeep) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).slice(0, 60).map(([k, x]) => [scrub(String(k)).slice(0, 60), /^(cookie|authorization|password|secret|token|cf_authorization)$/i.test(k) ? "[redacted]" : scrubDeep(x)])) : v);

/** The request's user agent reduced to a family: device, OS version, and what kind of browser it is. Never the full string. */
export function uaFamily(ua) {
  const s = String(ua || ""); if (!s) return null;
  const v = m => (m ? m[1].replace(/_/g, ".").split(".").slice(0, 2).join(".") : null);
  let device = /AppleTV|tvOS/i.test(s) ? "Apple TV" : /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Watch/.test(s) ? "Apple Watch" : /Android/.test(s) ? "Android" : /Macintosh|Mac OS X/.test(s) ? "Mac" : /Windows/.test(s) ? "Windows" : /Linux/.test(s) ? "Linux" : "other";
  const os = /iPhone|iPad|iPod/.test(s) ? "iOS " + (v(/OS (\d+[_.]\d+)/.exec(s)) || "?") : /Android/.test(s) ? "Android " + (v(/Android (\d+(?:\.\d+)?)/.exec(s)) || "?") : /Mac OS X/.test(s) ? "macOS " + (v(/Mac OS X (\d+[_.]\d+)/.exec(s)) || "?") : null;
  const apple = /iPhone|iPad|iPod|Macintosh/.test(s);
  const browser = /CriOS|Chrome\//.test(s) && !/Edg\//.test(s) ? "Chrome" : /FxiOS|Firefox\//.test(s) ? "Firefox" : /Edg\//.test(s) ? "Edge"
    : apple && /AppleWebKit/.test(s) && !/Safari\//.test(s) ? "in-app web view" : /Safari\//.test(s) ? "Safari" : /curl|node|undici/i.test(s) ? "script" : "other";
  return [device, os, browser].filter(Boolean).join(" · ");
}
const KIND = /^[a-z0-9][a-z0-9._-]{0,39}$/;
/** Body -> stored entries (at most 20). Anything malformed is dropped, never an error: the page must not fail on diagnostics. */
export function cleanEntries(body, now = Date.now()) {
  const list = Array.isArray(body) ? body : body && typeof body === "object" ? [body] : [];
  const out = [];
  for (const e of list.slice(0, CLIENTLOG_MAX_BATCH)) {
    if (!e || typeof e !== "object") continue;
    const kind = String(e.kind || "").toLowerCase(); if (!KIND.test(kind)) continue;
    let detail = e.detail === undefined ? null : scrubDeep(e.detail), json = JSON.stringify(detail);
    if (json.length > CLIENTLOG_ENTRY_BYTES) { detail = { truncated: true, bytes: json.length, text: json.slice(0, CLIENTLOG_ENTRY_BYTES - 100) }; }
    const t = typeof e.t === "number" && Number.isFinite(e.t) ? e.t : typeof e.t === "string" && Number.isFinite(Date.parse(e.t)) ? Date.parse(e.t) : null;
    out.push({ kind, detail, ua: typeof e.ua === "string" ? scrub(e.ua).slice(0, 300) : null, build: typeof e.build === "string" || typeof e.build === "number" ? scrub(String(e.build)).slice(0, 80) : null,
      t: t != null && Math.abs(t - now) < 7 * 86400000 ? new Date(t).toISOString() : null });
  }
  return out;
}
/** Sliding minute per session: how many of `n` new entries may be stored. buckets: Map(sessionKey -> [timestamps]). */
export function allowEntries(buckets, sessionKey, n, now) {
  const recent = (buckets.get(sessionKey) || []).filter(t => now - t < 60000), room = Math.max(0, CLIENTLOG_PER_MINUTE - recent.length), take = Math.min(room, n);
  for (let i = 0; i < take; i++) recent.push(now);
  buckets.set(sessionKey, recent);
  if (buckets.size > 200) for (const [k, v] of buckets) if (!v.some(t => now - t < 60000)) buckets.delete(k);
  return take;
}
