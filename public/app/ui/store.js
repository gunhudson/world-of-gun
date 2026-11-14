// State store. One document, GET /api/state (docs/CONTRACT.md). The UI computes no game numbers.
// ?mock=1 loads /dev/state.mock.json for layout work; it is never used as a fallback.
// ?mock=sparse loads the same file with a set of metrics nulled, to judge "no signal" layouts.

const q = new URLSearchParams(location.search);
const mockParam = q.get("mock");

export const store = {
  state: null,        // last good state document
  prev: null,         // the one before it
  status: "boot",     // boot | ok | error | auth
  error: null,
  lastOk: 0,
  mock: mockParam === "1" || mockParam === "sparse" ? mockParam : null,
  link: "off",        // live | polling | off | mock   (set by live.js)
  subs: new Set(),
};

export function subscribe(fn) { store.subs.add(fn); return () => store.subs.delete(fn); }
function emit(reason) { for (const fn of store.subs) { try { fn(store.state, store.prev, reason); } catch (e) { console.error("[ui] render failed", e); } } }

// What the signals indicator shows: the socket state only counts while the state itself is arriving.
export function linkState() {
  if (store.mock) return "mock";
  if (store.status !== "ok") return "off";
  return store.link === "live" ? "live" : "polling";
}

export function setLink(link) { if (store.link !== link) { store.link = link; emit("link"); } }

let inflight = null;
export function refresh(reason = "refresh") {
  if (inflight) return inflight;
  inflight = load().then((doc) => {
    store.prev = store.state; store.state = doc; store.status = "ok"; store.error = null; store.lastOk = Date.now();
  }, (err) => {
    store.status = err.auth ? "auth" : "error"; store.error = err.message || String(err);
  }).finally(() => { inflight = null; emit(reason); });
  return inflight;
}

// Apply a small change that arrived on the live channel ahead of the next state document.
export function patchState(fn, reason = "patch") { if (!store.state) return; try { fn(store.state); } catch {} emit(reason); }

// Replace the state directly (mock event simulator only).
export function replaceState(doc, reason = "refresh") {
  store.prev = store.state; store.state = doc; store.status = "ok"; store.lastOk = Date.now(); emit(reason);
}

async function load() {
  if (store.mock) {
    const res = await fetch("/dev/state.mock.json", { cache: "no-store" });
    if (!res.ok) throw new Error("mock file missing (" + res.status + ")");
    const { rebase, sparse } = await import("./dev.js");
    let doc = rebase(await res.json());
    if (store.mock === "sparse") doc = sparse(doc);
    return doc;
  }
  let res;
  try {
    res = await fetch("/api/state", { cache: "no-store", credentials: "same-origin", redirect: "manual", headers: { accept: "application/json" }, signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined });
  } catch (e) {
    throw new Error(e?.name === "TimeoutError" ? "state endpoint timed out" : "network unreachable");
  }
  if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) {
    const err = new Error("session expired"); err.auth = true; throw err;
  }
  if (!res.ok) throw new Error("state endpoint returned " + res.status);
  const type = res.headers.get("content-type") || "";
  if (!type.includes("json")) throw new Error("state endpoint did not return JSON");
  const doc = await res.json();
  if (!doc || typeof doc !== "object") throw new Error("state document is empty");
  return doc;
}

// ---- small readers used across the UI ------------------------------------------------------

export const S = () => store.state || {};
export const byId = (arr, id) => (Array.isArray(arr) ? arr.find((x) => x && x.id === id) : undefined);
export function vitalsMap(state) {
  const out = {};
  for (const v of state?.character?.vitals || []) out[v.id] = v.value ?? null;
  return out;
}
export function allQuests(state) {
  const qs = state?.quests || {};
  return [
    ...(qs.main ? [{ ...qs.main, kind: "main" }] : []),
    ...(qs.daily || []).map((x) => ({ ...x, kind: "daily" })),
    ...(qs.weekly || []).map((x) => ({ ...x, kind: "weekly" })),
    ...(qs.side || []).map((x) => ({ ...x, kind: x.kind === "rebuild" || x.kind === "task" ? x.kind : "side" })),
  ];
}
// How full a progress bar is: the engine's own pct when it sends one. null when there are no numbers.
export function pct(progress) {
  if (!progress) return null;
  if (typeof progress.pct === "number") return Math.max(0, Math.min(100, progress.pct));
  if (progress.cur == null || !progress.max) return null;
  return Math.max(0, Math.min(100, (progress.cur / progress.max) * 100));
}
export const isDone = (quest) => quest?.state === "done" || quest?.state === "complete" || quest?.state === "completed";

// ---- other read routes (docs/EVENTS.md). Each returns null when it cannot be read. ------------
async function getJSON(path) {
  try {
    const res = await fetch(path, { cache: "no-store", credentials: "same-origin", redirect: "manual", headers: { accept: "application/json" }, signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) return null;
    return await res.json();
  } catch { return null; }
}
export async function getBrief(kind = "now") {
  if (store.mock) return store.state?.brief?.[kind] || null;
  return getJSON("/api/brief?kind=" + encodeURIComponent(kind));
}
export async function getDays(limit = 400) {
  if (store.mock) return (await import("./dev.js")).mockDays(store.state, limit);
  const r = await getJSON("/api/days?limit=" + limit);
  return r ? r.days || [] : null;
}
export async function getLog(cursor = null, limit = 60) {
  if (store.mock) return (await import("./dev.js")).mockLog(store.state, cursor, limit);
  return getJSON(`/api/log?limit=${limit}` + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
}

// One manual fact through POST /api/act. It moves meters and never grants XP.
// In mock mode nothing is sent anywhere: the reply is simulated and says so.
export async function act(body) {
  if (store.mock) return (await import("./dev.js")).mockAct(body, store.state);
  try {
    const res = await fetch("/api/act", { method: "POST", credentials: "same-origin", redirect: "manual", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ channel: "web", id: "web-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8), ...body }) });
    if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) return { ok: false, error: "session expired" };
    const out = await res.json().catch(() => null);
    if (!out) return { ok: false, error: "the engine did not answer (" + res.status + ")" };
    if (out.ok) refresh("act");
    return out;
  } catch { return { ok: false, error: "network unreachable" }; }
}

// Mark day.lastClose as seen (POST /api/seen). Mock mode sends nothing.
export async function markSeen(date) {
  if (store.mock) return { ok: true, mock: true };
  try {
    const res = await fetch("/api/seen", { method: "POST", credentials: "same-origin", redirect: "manual", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(date ? { date } : {}) });
    const out = res.ok ? await res.json().catch(() => null) : null;
    if (out?.ok) refresh("seen");
    return out || { ok: false };
  } catch { return { ok: false }; }
}
// Every open task (GET /api/tasks), for when quests.sideCut says the state left some out.
export async function getTasks() {
  if (store.mock) return null;
  const r = await getJSON("/api/tasks");
  return r && Array.isArray(r.tasks) ? r.tasks : null;
}
