# Collectors

A collector is a small script that reads something you really have (a spreadsheet, a database, an API, a text file)
and pushes what it finds to the world as events. The world has no connectors of its own: everything it knows arrives
this way, or by voice, keypad and phone (see `docs/EVENTS.md` for every event type and its fields).

## Rules

1. **The engine owns state. Collectors only push facts.** A collector never computes XP, levels, quests or
   achievements, and cannot: the ingest endpoint refuses those types. It says "this happened, from this source" and the
   engine's reducer decides what it is worth.
2. **Nothing is ever invented.** No default values, no estimates presented as readings, no 0 for "not measured"
   (send `null`), no timestamp the source did not give you (use the moment you saw it and say so). If the source has
   nothing, send nothing; the world shows "no signal" and that is the correct picture.
3. **Name the real source.** `source` is required on every event (`body.csv`, `my-bank-export`). Things a person typed
   or said use `manual` or `manual:<channel>`; those events move needs and the log but earn no XP.
4. **Push whole snapshots, idempotently.** The same id with the same data is a no-op, so re-pushing the entire file
   every run is correct and there is nothing to diff. Same id with new data revises the fact in place. Types marked
   "keyed" in `docs/EVENTS.md` get their id from their data; the others need a stable id you provide (a bank
   transaction id, never a random one).
5. **Withdraw what disappeared.** A deleted or re-opened row is a void: `{ "id": "...", "type": "...", "source": "...", "void": true }`.
   `tasks.mjs` shows the pattern (`withVoids` in `lib/wog.mjs`).
6. **A failed run is retried by the next scheduled run.** Collectors exit non-zero on any failure and alert nobody.

## What is here

| File | Source (`sample-data/`) | Events |
|---|---|---|
| `body.mjs` | `body.csv`, daily body measurements | `health.day` |
| `money.mjs` | `accounts.json` balances, `transactions.csv` | `money.balance`, `money.txn` |
| `tasks.mjs` | `tasks.json`, a task list | `task.open`, `task.done` (and voids) |
| `places.mjs` | `places.json`, a hand-kept place file | `place.arrive`, `place.stay` |
| `run.mjs` | | runs the four above, one after another |
| `lib/wog.mjs` | | push, key lookup, CSV and JSON readers, timestamps, state, dry run |

The sample files are fictional. Point a collector at your own file with `COLLECTOR_DATA=/path/to/your/folder` (same file
names), or copy a collector and change what it reads. Each is about 30 lines: read, map every row to an event, `push()`.

## Run one

```bash
node examples/collectors/body.mjs --dry     # prints the first events and a count; sends nothing, writes nothing
WORLD_URL=http://localhost:8787 WORLD_INGEST_KEY=your-key node examples/collectors/body.mjs
node examples/collectors/run.mjs            # all of them, each in its own process with its own timeout
node examples/collectors/run.mjs money --dry
```

`--force` ignores a collector's throttle (`throttle(name, minutes)` in `lib/wog.mjs`, for slow sources).

## Configuration

| Variable | Meaning |
|---|---|
| `WORLD_URL` | base URL of your world (default `http://localhost:8787`, what `wrangler dev` serves) |
| `WORLD_INGEST_KEY` or `WORLD_INGEST_KEY_FILE` | the ingest key (`wrangler secret put INGEST_KEY`); default file `$WOG_HOME/ingest-key`. Keep the file mode 0600 |
| `WORLD_SANDBOX` | optional sandbox world name such as `qc-collectors`: sent as the `x-world` header. Use it to test against a throwaway log |
| `WORLD_SANDBOX_KEY` or `WORLD_SANDBOX_KEY_FILE` | the sandbox's key (default file `$WOG_HOME/sandbox-ingest-key`) |
| `WOG_HOME` | where status, log, state and key files live (default `~/.config/world-of-gun`) |
| `COLLECTOR_DATA` | folder the example collectors read (default `examples/collectors/sample-data`) |
| `WORLD_TZ` | IANA zone used to stamp dates that carry no time (default: this machine's zone) |

The runner writes `$WOG_HOME/status.json` (per collector: ok, duration, last success, consecutive failures, last output
lines) and `$WOG_HOME/collectors.log`. Keys are read at run time and never written anywhere by these scripts.

## Schedule the runner

Run it every 15 minutes; collectors that need less often use a throttle. Replace the paths with yours (use absolute paths
to `node`: schedulers start with a bare environment).

**cron**

```cron
*/15 * * * * WORLD_URL=https://your-world.example.workers.dev WORLD_INGEST_KEY_FILE=/path/to/ingest-key /path/to/node /path/to/world-of-gun/examples/collectors/run.mjs
```

**macOS launchd** (`~/Library/LaunchAgents/org.example.world-collectors.plist`, then `launchctl load` it)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>org.example.world-collectors</string>
  <key>ProgramArguments</key><array>
    <string>/path/to/node</string>
    <string>/path/to/world-of-gun/examples/collectors/run.mjs</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>WORLD_URL</key><string>https://your-world.example.workers.dev</string>
    <key>WORLD_INGEST_KEY_FILE</key><string>/path/to/ingest-key</string>
    <key>PATH</key><string>/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>900</integer>
  <key>StandardOutPath</key><string>/tmp/world-collectors.out.log</string>
  <key>StandardErrorPath</key><string>/tmp/world-collectors.err.log</string>
</dict></plist>
```

A scheduler running on a laptop only pushes while the laptop is awake. The world shows how old each signal is, so a gap
reads as a gap. If a source must keep flowing while your machine is off, move that collector to something always on
(a Worker cron, a small server) that pushes the same events to the same endpoint.

## Write your own

1. Pick one source and one event type from `docs/EVENTS.md`. Copy the closest example.
2. Map each row to `{ id?, ts, type, source, data }`. `ts` is ISO 8601 with an offset (use `stamp(date, time, tz)`).
3. `node yourcollector.mjs --dry` and check the printed events against the field table.
4. Push to a sandbox world first (`WORLD_SANDBOX=qc-yourname`), read the state back, then push to your own world.
5. Add a line to `COLLECTORS` in `run.mjs`.
