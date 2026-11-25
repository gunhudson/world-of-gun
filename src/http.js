// HTTP helpers: security headers, cache policies, conditional ETags, streaming bounded reads,
// safe URI decoding, and lightweight per-isolate rate limiting.
// Pure and dependency-free so every policy is unit-tested in Node (test/http.test.mjs).
import { fnv } from "./ingest.js";

// CSP compatible with Three.js r170, Draco/Meshopt WASM + blob workers, inline boot/importmap/QC scripts,
// inline UI styles, SVG data URIs (--corner), snapshot data URLs, photo/manifest blobs, audio/video media, and live WebSockets.
// (Note: current GLBs use EXT_meshopt_compression; if KTX2/basis_transcoder.js is ever used, its Emscripten embind needs 'unsafe-eval'.)
export const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "manifest-src 'self' blob:",
  "connect-src 'self' ws: wss: data: blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

export const API_CSP = "default-src 'none'; frame-ancestors 'none'";
export const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";

/**
 * Cache-Control policy for auth-gated static assets and HTML.
 * Always `private` because assets are session-gated.
 * Unhashed `/app/*` and HTML use `no-cache` (fast ETag 304 on CF Assets, never mixes ES module versions across deploys).
 * Large binary/media/vendor assets use 24h max-age + 7d SWR (eliminates repeat downloads while still allowing updates).
 */
export function cacheControlFor(pathname, contentType = "", isDev = false) {
  const p = String(pathname || "");
  if (/text\/html/i.test(contentType) || p === "/" || p.endsWith(".html") || p.startsWith("/dev/")) {
    return "private, no-cache";
  }
  if (p.startsWith("/vendor/")) {
    return isDev ? "private, no-cache" : "private, max-age=86400, stale-while-revalidate=604800";
  }
  if (p.startsWith("/models/") || p.startsWith("/audio/") || p.startsWith("/video/") || p.startsWith("/img/")
      || p.startsWith("/app/stage/data/") || p.startsWith("/app/ui/data/")) {
    return "private, max-age=86400, stale-while-revalidate=604800";
  }
  if (p.startsWith("/tex/")) {
    return p.endsWith(".json") ? "private, no-cache" : "private, max-age=86400, stale-while-revalidate=604800";
  }
  if (p.startsWith("/app/")) {
    return "private, no-cache";
  }
  return "private, no-cache";
}

/** Apply baseline security headers to any HTTP response. */
export function applySecurityHeaders(headers, { isHtml = false, isApi = false, isHttps = false } = {}) {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Permissions-Policy", PERMISSIONS_POLICY);
  if (isHttps) headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (isHtml) {
    headers.set("Content-Security-Policy", HTML_CSP);
    headers.set("Referrer-Policy", "same-origin");
    headers.set("X-Frame-Options", "SAMEORIGIN");
  } else if (isApi) {
    headers.set("Content-Security-Policy", API_CSP);
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Frame-Options", "DENY");
  } else {
    headers.set("Referrer-Policy", "same-origin");
  }
  return headers;
}

/** RFC 9110 If-None-Match check (supports weak tags, comma lists, and `*`). */
export function etagMatches(ifNoneMatch, etag) {
  if (!ifNoneMatch || !etag) return false;
  const clean = s => s.trim().replace(/^W\//i, "");
  const want = clean(etag);
  for (const part of String(ifNoneMatch).split(",")) {
    const t = clean(part);
    if (t === "*" || t === want) return true;
  }
  return false;
}

/** Strong content ETag for a JSON-serialisable document. */
export function jsonEtag(prefix, obj) {
  return '"' + prefix + "-" + fnv(JSON.stringify(obj)) + '"';
}

/** Decode a URL path segment safely; returns null on malformed percent-encoding. */
export function safeDecode(segment) {
  try { return decodeURIComponent(segment); } catch { return null; }
}

/**
 * Stream-read a request body into a Uint8Array with a strict byte cap.
 * Cancels immediately if chunked transfers exceed `maxBytes` without buffering the whole payload.
 * Returns { ok: true, bytes } or { ok: false, status: 413, error }.
 */
export async function readBoundedBytes(request, maxBytes) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: "body exceeds " + maxBytes + " bytes" };
  }
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        return { ok: false, status: 413, error: "body exceeds " + maxBytes + " bytes" };
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return { ok: true, bytes: out };
}

const utf8Dec = new TextDecoder();

/**
 * Stream-read a request body as UTF-8 text with a strict byte cap (never buffers unbounded chunked bodies).
 * Returns { ok: true, text } or { ok: false, status: 413, error }.
 */
export async function readBoundedText(request, maxBytes) {
  const r = await readBoundedBytes(request, maxBytes);
  if (!r.ok) return r;
  return { ok: true, text: utf8Dec.decode(r.bytes) };
}

/** Client IP key for per-isolate rate limiting. */
export function clientKey(request) {
  const ip = request.headers.get("CF-Connecting-IP") || (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim();
  return ip || "local";
}

/**
 * Bounded per-isolate sliding-window rate limiter.
 * Protects auth and write routes against brute-force or runaway client loops without touching storage.
 */
export class RateLimiter {
  constructor({ windowMs = 60_000, maxKeys = 512 } = {}) {
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.buckets = new Map();
  }
  /** Consume 1 hit for `key` under limit `max`. Returns { ok, remaining, retryAfterSec }. */
  take(key, max, now = Date.now()) {
    const cut = now - this.windowMs;
    const prev = this.buckets.get(key);
    const list = prev ? prev.filter(t => t > cut) : [];
    if (list.length >= max) {
      this.buckets.set(key, list);
      const retryAfterSec = Math.max(1, Math.ceil((list[0] + this.windowMs - now) / 1000));
      return { ok: false, remaining: 0, retryAfterSec };
    }
    list.push(now);
    this.buckets.set(key, list);
    if (this.buckets.size > this.maxKeys) {
      for (const [k, v] of this.buckets) {
        if (!v.some(t => t > cut)) this.buckets.delete(k);
        if (this.buckets.size <= this.maxKeys) break;
      }
      if (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value);
    }
    return { ok: true, remaining: max - list.length, retryAfterSec: 0 };
  }
  /** Peek current count without incrementing (used to block already-throttled auth attackers before crypto). */
  blocked(key, max, now = Date.now()) {
    const prev = this.buckets.get(key);
    if (!prev) return { blocked: false, retryAfterSec: 0 };
    const cut = now - this.windowMs;
    const list = prev.filter(t => t > cut);
    if (list.length !== prev.length) {
      if (list.length) this.buckets.set(key, list); else this.buckets.delete(key);
    }
    if (list.length >= max) {
      return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((list[0] + this.windowMs - now) / 1000)) };
    }
    return { blocked: false, retryAfterSec: 0 };
  }
  clear() { this.buckets.clear(); }
}
