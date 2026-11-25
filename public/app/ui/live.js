// Live channel. WebSocket at /api/live with reconnect and backoff; while the socket is down the
// state is refetched every 60 s. Messages: { type: "event", event }, { type: "state" } and
// { type: "activity", activity } (what he is doing changed).

import { store, refresh, setLink } from "./store.js";

const POLL_MS = 60_000;
const BACKOFF = [1000, 2000, 4000, 8000, 15000, 30000];

let ws = null, attempt = 0, retryTimer = null, pollTimer = null, handlers = {}, stopped = false;

export function connectLive(h = {}) {
  handlers = h;
  if (store.mock) { setLink("mock"); return; }
  open();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    refresh("visible");
    if (!ws || ws.readyState > 1) { clearTimeout(retryTimer); open(); }
  });
  window.addEventListener("online", () => { clearTimeout(retryTimer); attempt = 0; open(); refresh("online"); });
}

function open() {
  if (stopped || (typeof document !== "undefined" && document.hidden)) return;
  try {
    const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/live";
    ws = new WebSocket(url);
  } catch { return down(); }
  const sock = ws;
  sock.addEventListener("open", () => {
    attempt = 0;
    stopPolling();
    setLink("live");
    refresh("live-open"); // catch up on anything missed while disconnected
  });
  sock.addEventListener("message", (m) => {
    let msg; try { msg = JSON.parse(m.data); } catch { return; }
    if (msg?.type === "event" && msg.event) handlers.onEvent?.(msg.event, msg.state || null);
    else if (msg?.type === "state") handlers.onState?.(msg.state || null);
    else if (msg?.type === "activity" && msg.activity) handlers.onActivity?.(msg.activity);
  });
  const lost = () => { if (ws === sock) { ws = null; down(); } };
  sock.addEventListener("close", lost);
  sock.addEventListener("error", () => { try { sock.close(); } catch {} });
}

function down() {
  startPolling();
  setLink(store.status === "ok" ? "polling" : "off");
  clearTimeout(retryTimer);
  if (typeof document !== "undefined" && document.hidden) return;
  const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)] * (0.75 + Math.random() * 0.5);
  attempt++;
  retryTimer = setTimeout(open, delay);
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (document.hidden) return;
    refresh("poll").then(() => { if (!ws) setLink(store.status === "ok" ? "polling" : "off"); });
  }, POLL_MS);
}
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

export function disconnectLive() {
  stopped = true; clearTimeout(retryTimer); stopPolling();
  try { ws?.close(); } catch {}
}
