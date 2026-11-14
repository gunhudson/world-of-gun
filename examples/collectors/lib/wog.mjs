// Shared helpers for collectors: configuration, the push to /api/ingest, per-collector state, dry runs.
// A collector reads a source the owner really has, turns each fact into an event (docs/EVENTS.md) and calls push().
// Nothing here invents data, and no secret lives in this file.
//
// Configuration (environment variables):
//   WORLD_URL              base URL of the world (default http://localhost:8787, the `wrangler dev` default)
//   WORLD_INGEST_KEY       the ingest key, or
//   WORLD_INGEST_KEY_FILE  a file holding it (default $WOG_HOME/ingest-key)
//   WORLD_SANDBOX          optional sandbox world name (for example qc-collectors): sent as the x-world header
//   WORLD_SANDBOX_KEY(_FILE)  the sandbox's ingest key (default file $WOG_HOME/sandbox-ingest-key)
//   WOG_HOME               state directory: status, log, per-collector state, key files (default ~/.config/world-of-gun)
//   COLLECTOR_DATA         folder the example collectors read their files from (default ./sample-data)
//   WORLD_TZ               IANA time zone used to stamp dates that carry no time (default: this machine's zone)
// Flags every collector understands: --dry (print sample events, send nothing, write nothing), --force (ignore throttles).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const HOME = resolve(process.env.WOG_HOME || join(homedir(), ".config", "world-of-gun"));
export const BASE = (process.env.WORLD_URL || "http://localhost:8787").replace(/\/+$/, "");
export const SANDBOX = process.env.WORLD_SANDBOX || "";
export const DATA = resolve(process.env.COLLECTOR_DATA || join(HERE, "..", "sample-data"));
export const DRY = process.argv.includes("--dry");
export const FORCE = process.argv.includes("--force");
export const TZ = process.env.WORLD_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Ingest key: environment variable first, then a key file. Throws a readable error when neither exists. */
export function key() {
  const env = SANDBOX ? process.env.WORLD_SANDBOX_KEY : process.env.WORLD_INGEST_KEY;
  if (env) return env.trim();
  const file = (SANDBOX ? process.env.WORLD_SANDBOX_KEY_FILE : process.env.WORLD_INGEST_KEY_FILE) || join(HOME, SANDBOX ? "sandbox-ingest-key" : "ingest-key");
  try { return readFileSync(file, "utf8").trim(); }
  catch { throw new Error(`no ingest key: set ${SANDBOX ? "WORLD_SANDBOX_KEY" : "WORLD_INGEST_KEY"} or put it in ${file}`); }
}
const worldHeader = () => (SANDBOX ? { "x-world": SANDBOX } : {});

// ---- reading the owner's files -------------------------------------------------------------
export const dataFile = (name) => join(DATA, name);
export const readJson = (name) => JSON.parse(readFileSync(dataFile(name), "utf8"));
/** Minimal CSV reader: header row, comma separated, optional double quotes. Returns an array of objects of strings. */
export function readCsv(name) {
  const split = (line) => { const out = []; let cur = "", q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((s) => s.trim()); };
  const lines = readFileSync(dataFile(name), "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  const head = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}
/** A number, or null for an empty or unreadable cell. "Not measured" is null, never 0. */
export const num = (v) => { if (v === "" || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// ---- time -----------------------------------------------------------------------------------
/** "+08:00" style offset of `tz` on the given calendar date (at noon). */
function offsetOn(date, tz) {
  const p = new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date(date + "T12:00:00Z")).find((x) => x.type === "timeZoneName").value;
  return p === "GMT" ? "+00:00" : p.replace("GMT", "");
}
/** ISO timestamp with offset for a local date and time (in `tz`, default WORLD_TZ). Never later than now (the engine refuses the future). */
export function stamp(date, time = "12:00", tz = TZ) {
  const iso = `${date}T${time.length === 5 ? time + ":00" : time}${offsetOn(date, tz)}`;
  return Date.parse(iso) > Date.now() ? new Date().toISOString() : iso;
}

// ---- state kept between runs ---------------------------------------------------------------
const stateFile = (n) => join(HOME, "state", n + ".json");
export const readState = (n) => { try { return JSON.parse(readFileSync(stateFile(n), "utf8")); } catch { return {}; } };
export const writeState = (n, o) => { if (DRY) return; mkdirSync(join(HOME, "state"), { recursive: true }); writeFileSync(stateFile(n), JSON.stringify(o)); };
/** Quietly exit 0 when this collector succeeded less than `minutes` ago (unless --force or --dry). */
export function throttle(name, minutes) {
  if (FORCE || DRY) return;
  const s = readState(name);
  if (s.okAt && Date.now() - s.okAt < minutes * 60000) { log(`${name}: ran ${Math.round((Date.now() - s.okAt) / 60000)} min ago, skipping (every ${minutes} min)`); process.exit(0); }
}
export const markOk = (name, extra = {}) => writeState(name, { ...readState(name), ...extra, okAt: Date.now() });

// ---- pushing --------------------------------------------------------------------------------
/** Push whole snapshots in batches of 1000. Same id and same data is a no-op on the server, so re-pushing is safe.
 *  Throws when any batch fails or any event is rejected, so the runner records the failure and the next run retries. */
export async function push(source, events) {
  const sum = { sent: events.length, new: 0, revised: 0, unchanged: 0, voided: 0, rejected: 0 };
  if (DRY) { console.log(JSON.stringify(events.slice(0, 3), null, 1)); console.log(`${source}: ${events.length} events (dry run, nothing sent)`); return sum; }
  if (!events.length) { console.log(`${source}: nothing to send`); return sum; }
  const k = key(); let bad = 0;
  for (let i = 0; i < events.length; i += 1000) {
    const r = await fetch(BASE + "/api/ingest", { method: "POST", signal: AbortSignal.timeout(60000), headers: { "Content-Type": "application/json", "x-world-key": k, ...worldHeader() }, body: JSON.stringify({ events: events.slice(i, i + 1000) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { bad++; console.error(`ingest failed: HTTP ${r.status} ${JSON.stringify(j).slice(0, 300)}`); continue; }
    for (const f of ["new", "revised", "unchanged", "voided"]) sum[f] += j[f] || 0;
    const rej = j.rejected || [];
    sum.rejected += rej.length;
    if (rej.length) { bad++; console.error("rejected: " + JSON.stringify(rej.slice(0, 5))); }
  }
  console.log(`${source}: ${JSON.stringify(sum)}`);
  if (bad) throw new Error(`${source}: ${bad} batch problem(s)`);
  return sum;
}

/** Void ids pushed on a previous run that are gone from the source now (a task re-opened, a row deleted).
 *  Keeps the list of pushed ids in state under `stateName`. */
export function withVoids(stateName, events, source) {
  const now = new Set(events.map((e) => e.id));
  const prev = readState(stateName).ids || [];
  const voids = prev.filter((id) => !now.has(id)).map((id) => ({ id, ts: new Date().toISOString(), type: id.split(":")[0], source, void: true }));
  return { events: [...events, ...voids], remember: () => writeState(stateName, { ids: [...now], at: new Date().toISOString() }) };
}

/** Run a collector's main function: exit 0 on success, 1 on any failure, never hang. */
export function main(name, fn) {
  fn().then(() => process.exit(0), (e) => { console.error(`${name}: FAILED ${(e && e.stack) || e}`); process.exit(1); });
}
