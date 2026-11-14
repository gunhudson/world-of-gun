#!/usr/bin/env node
// Runs every collector as its own child process with its own timeout, one after another, so one failure or hang never
// stops the next. Writes $WOG_HOME/status.json (latest outcome per collector) and appends to $WOG_HOME/collectors.log.
// Nothing here alerts: a failed collector is simply retried by the next scheduled run, and the world itself shows
// "no signal" when nothing has arrived.
//
//   node examples/collectors/run.mjs [name ...] [--dry] [--force]
//
// Add your own collector: put a script next to these, add a line to COLLECTORS (name, file, timeout in seconds).
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOME } from "./lib/wog.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// [name, script, timeout seconds]. Order is priority: put the sources the world needs first at the top.
const COLLECTORS = [
  ["places", "places.mjs", 120],
  ["body", "body.mjs", 60],
  ["money", "money.mjs", 120],
  ["tasks", "tasks.mjs", 120],
];
const args = process.argv.slice(2);
const flags = args.filter((a) => a === "--dry" || a === "--force");
const only = args.filter((a) => !a.startsWith("--"));
const dry = flags.includes("--dry");
const LOG = join(HOME, "collectors.log"), STATUS = join(HOME, "status.json");
try { if (statSync(LOG).size > 5e6) renameSync(LOG, LOG + ".1"); } catch {}
if (!dry) mkdirSync(HOME, { recursive: true });
const out = (s) => { if (dry) process.stdout.write(s); else appendFileSync(LOG, s); };
let status = {}; try { status = JSON.parse(readFileSync(STATUS, "utf8")); } catch {}

const runOne = ([name, script, timeoutSec]) => new Promise((resolve) => {
  const t0 = Date.now(); let buf = "";
  const p = spawn(process.execPath, [join(HERE, script), ...flags], { cwd: HERE, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const timer = setTimeout(() => { buf += `\n[runner] timeout after ${timeoutSec}s, killing\n`; p.kill("SIGKILL"); }, timeoutSec * 1000);
  p.stdout.on("data", (d) => (buf += d)); p.stderr.on("data", (d) => (buf += d));
  p.on("error", (e) => { buf += "[runner] spawn error " + e + "\n"; });
  p.on("close", (code, sig) => {
    clearTimeout(timer);
    const ms = Date.now() - t0, ok = code === 0, tail = buf.trim().split("\n");
    out(`--- ${new Date().toISOString()} ${name} ${ok ? "ok" : "FAIL code=" + code + (sig ? " sig=" + sig : "")} ${ms}ms\n${tail.slice(-25).join("\n")}\n`);
    const prev = status[name] || {};
    status[name] = { ok, code, ms, at: new Date().toISOString(), lastOkAt: ok ? new Date().toISOString() : prev.lastOkAt || null, consecutiveFails: ok ? 0 : (prev.consecutiveFails || 0) + 1, tail: tail.slice(-3).join(" | ").slice(0, 400) };
    resolve(ok);
  });
});

out(`=== run start ${new Date().toISOString()}\n`);
let failed = 0;
for (const c of COLLECTORS) { if (only.length && !only.includes(c[0])) continue; if (!(await runOne(c))) failed++; }
status._lastRun = new Date().toISOString();
if (!dry) writeFileSync(STATUS, JSON.stringify(status, null, 1));
out(`=== run end ${new Date().toISOString()} (${failed} failed)\n`);
