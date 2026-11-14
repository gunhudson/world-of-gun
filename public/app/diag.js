// Client diagnostics: what this device saw, posted to /api/clientlog (docs/EVENTS.md, "Client diagnostics").
// Fire and forget. Nothing here may throw into the page or wait on the network.
const BUILD = "stage-1.0";
const queue = [];
let timer = 0;
function flush() {
  timer = 0;
  if (!queue.length) return;
  const batch = queue.splice(0, 20);
  try {
    const world = new URLSearchParams(location.search).get("world");
    fetch("/api/clientlog" + (world ? "?world=" + encodeURIComponent(world) : ""), { method: "POST", keepalive: true, credentials: "same-origin",
      headers: { "content-type": "application/json" }, body: JSON.stringify(batch) }).catch(() => {});
  } catch {}
  if (queue.length) timer = setTimeout(flush, 1500);
}
export function post(kind, detail) {
  try { queue.push({ kind, detail, ua: String(navigator.userAgent).slice(0, 300), build: BUILD, t: Date.now() }); if (!timer) timer = setTimeout(flush, 400); } catch {}
}
const STAGE_NAME = { ok: "ok", fetch: "fetch", decode: "decode", parse: "parse", texture: "texture", timeout: "timeout" };
export function attachDiag(stage) {
  try {
    if (!stage || stage.__diag || typeof stage.on !== "function") return;
    stage.__diag = true;
    try { window.__stageDiag = () => { try { return { model: stage.getModelInfo?.(), info: stage.getInfo?.() }; } catch { return null; } }; } catch {}
    const info = () => { try { return stage.getInfo?.() || {}; } catch { return {}; } };
    const model = (d) => {
      if (!d || /standin\.glb$/.test(d.url || "") && d.ok) return;
      if (d.ok && d.attempt < 2 && !d.fallback) return;                       // a clean first load is not news
      const gl = info().gl || {};
      post("model", { url: d.url, stage: STAGE_NAME[d.stage] || d.stage, ok: d.ok, httpStatus: d.httpStatus, bytesReceived: d.bytesReceived, bytesDeclared: d.bytesDeclared,
        contentLength: d.contentLength, error: d.error, attempt: d.attempt, ms: d.ms, textures: d.textures, fallback: d.fallback || null, online: d.online, hidden: d.hidden,
        limits: { maxTextureSize: gl.maxTextureSize ?? null, maxRenderbufferSize: gl.maxRenderbufferSize ?? null, maxVertexUniformVectors: gl.maxVertexUniformVectors ?? null, webgl2: gl.webgl2 ?? null } });
    };
    const seen = new Set();
    const once = (d) => { const k = d.url + "#" + d.attempt; if (seen.has(k)) return; seen.add(k); model(d); };
    try { for (const d of stage.getModelLog?.() || []) once(d); } catch {}
    stage.on("modeldiag", (d) => { try { once(d); } catch {} });
    stage.on("quality", (e) => { try { if (e && e.reason) post("quality", { tier: e.tier, scale: e.scale, pixelRatio: e.pixelRatio ?? null, frameMs: e.frameMs ?? null, reason: e.reason, battery: !!e.battery, ambient: !!e.ambient }); } catch {} });
    // one boot entry, late enough to carry a measured frame time
    setTimeout(() => {
      try {
        const i = info(), gl = i.gl || {}, ua = navigator.userAgent || "", mi = (() => { try { return stage.getModelInfo?.() || {}; } catch { return {}; } })();
        const ios = /iPhone|iPad|iPod/.test(ua);
        post("boot", { quality: i.tier ?? null, auto: i.auto ?? null, scale: i.scale ?? null, pixelRatio: i.pixelRatio ?? null, frameMs: i.frameMs != null ? +i.frameMs.toFixed(1) : null, p95: i.p95 != null ? +i.p95.toFixed(1) : null,
          render: i.render || null, renderer: gl.renderer ?? null, maxTextureSize: gl.maxTextureSize ?? null, maxVertexUniformVectors: gl.maxVertexUniformVectors ?? null,
          deviceMemory: navigator.deviceMemory ?? null, connection: navigator.connection?.effectiveType ?? navigator.connection?.type ?? null, cores: navigator.hardwareConcurrency ?? null,
          viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
          standalone: navigator.standalone === true || (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches),
          inApp: ios ? !/Safari\//.test(ua) : /; wv\)/.test(ua), hidden: document.hidden, supported: stage.supported !== false,
          model: mi.standin ? "standin" : mi.kind || null, modelRetrying: !!mi.retrying, lastModelError: mi.lastFailure ? mi.lastFailure.stage + ": " + mi.lastFailure.error : null });
      } catch {}
    }, 8000);
  } catch {}
}
