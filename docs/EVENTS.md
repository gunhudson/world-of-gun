# World of Gun: events and the machine API

Everything the engine knows arrives as an event. Collectors push events to `POST /api/ingest`, a
phone app pushes sensor events to `POST /api/phone`, voice and keypads record manual facts with
`POST /api/act`, and edge adapters inside the worker pull a few feeds on a 5-minute tick. The
reducer (`src/reduce.js`, rules in `src/rules.js`) replays the whole log into the state document
described in `CONTRACT.md`.

This document is the contract for everything that writes to the engine or reads it without a
browser: every event type and its fields, what each event does, the machine routes, and how to
test against the QC world. The state document is in `CONTRACT.md`, the web client in `CLIENT.md`,
peering between worlds in `MULTIPLAYER.md`. Working collectors to copy from are under `examples/`.

Examples use the address `https://world.example.org` and invented people, places and numbers.

## Credentials and sign-in

| Credential | Sent as | Opens |
|---|---|---|
| Ingest key (secret `INGEST_KEY`) | header `x-world-key` | `POST /api/ingest`, `POST`/`PUT`/`DELETE /api/img/*`, `GET /api/events`, `GET /api/clientlog`, `POST /api/admin/*` |
| ACT key (secret `ACT_KEY`) | header `x-act-key` or `Authorization: Bearer` | `POST /api/act` |
| TV key (secret `TV_KEY`) | header `x-tv-key`, `Authorization: Bearer` or `?key=` | `GET /api/tv`, `/api/tv/model/*`, `/api/glance`, `/api/brief`, `/api/days`, `/api/img/*`, `/api/live`, `/api/clientlog` |
| Read token (`wogr_…`, `wogq_…`) | `Authorization: Bearer` | `GET /api/glance`, `GET /api/brief`, `GET /api/img/*` |
| Owner session | Cloudflare Access (see below) | the page and every session route |

`QC_INGEST_KEY`, `QC_ACT_KEY` and `QC_TV_KEY` are the same three keys for the QC world; they must
differ from the production keys. Set each secret with `wrangler secret put <NAME>`. A route whose
secret is not set refuses every key. In the examples the keys are shell variables: `$INGEST_KEY`,
`$ACT_KEY`, `$TV_KEY`, `$QC_INGEST_KEY`, `$QC_ACT_KEY`, `$QC_TV_KEY`.

**Owner session.** The worker has no login page, no redirect and no session cookie of its own.
An owner session comes only from Cloudflare Access in front of the worker, or from `DEV=1` on your
own machine:

- Deployed: set the vars `ACCESS_TEAM`, `ACCESS_AUD` and `OWNER_EMAIL` in `wrangler.toml`. The
  worker verifies the Access token on each request (the `Cf-Access-Jwt-Assertion` header, or the
  `CF_Authorization` cookie). The address in `OWNER_EMAIL` is the owner; anyone else Access lets
  through is answered 403 `{ "error": "forbidden" }`.
- Local: `DEV=1` in `.dev.vars` makes every request to `wrangler dev` an owner session. It also
  gives the ingest route two fixed local keys when `INGEST_KEY` / `QC_INGEST_KEY` are not set:
  `x-world-key: dev` (the local production world) and `x-world-key: qc-dev` (the local QC world).
  Never set `DEV` on a deployed worker.
- Without a session, every page and session route answers 401
  `{ "error": "sign in through Cloudflare Access" }`. When Access is not configured the 401 text
  says to set `ACCESS_TEAM` and `ACCESS_AUD` (or `DEV=1` for local play).

Session routes that write (`/api/phone`, `/api/act` with a session, `/api/seen`, `/api/token`,
`POST /api/clientlog`) refuse a request whose `Origin` header names another origin (403).

## Test against the QC world

**Production is the player's real life. Test against the QC world.** One deployment holds two
kinds of world, running the same code:

| | Production | QC world (sandbox) |
|---|---|---|
| What it is | the real event log, the real game | an empty log that only holds what you push or seed |
| Edge adapters, scheduled tick | yes | none: nothing pulls a feed into it |
| Keys | `INGEST_KEY`, `ACT_KEY`, `TV_KEY` | `QC_INGEST_KEY`, `QC_ACT_KEY`, `QC_TV_KEY` |
| Session routes | default | add `?world=qc` or the header `x-world: qc` |
| Read tokens | `wogr_…` | `wogq_…` (mint with `POST /api/token?world=qc`) |
| Says so | `state.env: "production"` | `state.env: "qc"`, `state.sandbox`, `glance.env: "qc"`, response header `x-world`, live `hello.env: "qc"` |

**Namespaces.** The sandbox has namespaces so separate pieces of work do not collide. `qc` is the
shared one. `qc-<name>` is a separate instance with its own log, images, tokens, diagnostics, seed
and reset; `<name>` is 1 to 32 characters of lowercase letters, digits and hyphens, starting and
ending with a letter or digit (for example `qc-ui` for a web client, `qc-ios` for a phone app).
A namespace exists as soon as something addresses it.

Select a namespace with the marker `?world=qc-ui` or the header `x-world: qc-ui`, on session
routes and on key routes alike (a QC key can only say "QC"; the marker says which one). A QC key
with no marker means plain `qc`. A read token minted in `qc-ui` starts with `wogq-ui_` and reads
only `qc-ui`. Answers from a sandbox carry the header `x-world: qc-ui`; the state carries
`env: "qc"` and `sandbox: "qc-ui"`; replies from `/api/ingest`, `/api/phone` and `/api/act` carry
`"world": "qc-ui"` (`"production"` otherwise).

How a request finds its world:

- **A key decides by itself.** A production key always and only reaches production. A QC key
  always and only reaches QC worlds: plain `qc` unless the marker names `qc-<name>`.
- **A read token decides by its prefix**: `wogr_` production, `wogq_` the shared `qc`,
  `wogq-<name>_` the world `qc-<name>`. It reads exactly that world.
- **An owner session** reaches production unless the request carries `?world=qc[-name]` or
  `x-world: qc[-name]`. (`world=production` is accepted and means production.)
- **A marker that disagrees with the credential is refused with 409 and nothing is done.** A
  production key with `x-world: qc` does not write to QC, and does not write to production
  either. A marker that is not a world name is refused with 400.
- **`/api/admin/qc/*` exists only in QC worlds**: it needs the QC ingest key; the marker picks
  the namespace.

**The production guard.** In production, `/api/ingest`, `/api/phone` and `/api/act` refuse test
traffic, with an error that points to this section:

- an event whose `source` has a part (between colons) that is `qc` or starts with `qc-`, `qc_`
  or `qc.` (`qc-collector`, `phone:qc-simulator`, `manual:qc`), or that contains `simulator`;
- an event whose id starts with `phone:qc` or `act:qc` in the same way, or contains `simulator`.

So name your test devices and test sources `qc-<something>`, always. Through `/api/ingest` such
an event is listed in `rejected`; `/api/phone` refuses the whole request when the `deviceId` is a
test device; `/api/act` answers 400. Withdrawing an old test event with `void: true` is always
accepted. A QC world accepts all of it.

**Reset and seed** (QC ingest key; the marker picks the namespace):

- `POST /api/admin/qc/reset` empties that world: events, derived log, feed snapshots, images,
  read tokens, client diagnostics, peers and settings. Reply `{ ok, world, removed }`.
- `POST /api/admin/qc/seed` resets, then loads a small synthetic fixture: a fictional "QC Tester"
  in "Testville", fifteen days of steps, sleep, food and workouts, four accounts (one owned by
  the guild), a main quest, tasks, belongings, contacts, and feed snapshots for `steps`, `btc`,
  `fleet` and `weather`. Every seeded event has the source `qc-seed`. `?keep=1` adds the fixture
  to what is there instead of resetting. Reply
  `{ ok, world, events, rejected, level, place, note }`. Seeded feed snapshots are frozen at seed
  time; seed again to refresh them.

```bash
# empty the sandbox, or load the synthetic fixture
curl -X POST https://world.example.org/api/admin/qc/reset -H "x-world-key: $QC_INGEST_KEY"
curl -X POST https://world.example.org/api/admin/qc/seed  -H "x-world-key: $QC_INGEST_KEY"
curl -X POST "https://world.example.org/api/admin/qc/seed?world=qc-ui" -H "x-world-key: $QC_INGEST_KEY"

# push events exactly as you would to production, with the QC key
curl -X POST https://world.example.org/api/ingest -H "x-world-key: $QC_INGEST_KEY" -H "Content-Type: application/json" \
  -d '{"events":[{"ts":"2026-11-13T09:00:00+08:00","type":"steps.day","source":"qc-test","data":{"date":"2026-11-13","steps":12000,"goal":10000}}]}'

# read it back: the state document, the glance, a briefing, the raw events
curl https://world.example.org/api/tv     -H "x-tv-key: $QC_TV_KEY"
curl https://world.example.org/api/glance -H "x-tv-key: $QC_TV_KEY"
curl "https://world.example.org/api/brief?kind=now" -H "x-tv-key: $QC_TV_KEY"
curl "https://world.example.org/api/events?source=qc-" -H "x-world-key: $QC_INGEST_KEY"

# a manual fact by voice or keypad
curl -X POST https://world.example.org/api/act -H "x-act-key: $QC_ACT_KEY" -H "Content-Type: application/json" -d '{"type":"checkin","mood":7}'

# session routes: add the marker. Locally (wrangler dev, DEV=1) no credential is needed;
# on a deployed world send the signed-in owner's Access token ($ACCESS_JWT here).
curl "http://localhost:8787/api/state?world=qc"
curl -X POST http://localhost:8787/api/phone -H "x-world: qc" -H "Content-Type: application/json" \
  -d '{"deviceId":"qc-simulator","events":[{"id":"hk:m1","ts":"2026-11-13T09:00:00+08:00","type":"mindful","data":{"minutes":5}}]}'
curl -X POST "https://world.example.org/api/token?world=qc" -H "Cookie: CF_Authorization=$ACCESS_JWT"   # -> { "token": "wogq_…", "world": "qc" }
```

**The page.** Open `https://world.example.org/?world=qc`. The worker marks the document
(`<html data-world="qc">`, `<meta name="wog-world" content="qc">`, `window.__WOG_WORLD__ === "qc"`),
puts a `#qc-world-tag` element at the top of `<body>` reading "QC WORLD" (with the namespace's
name after it for `qc-<name>`), and makes every same-origin `/api/…` fetch and the live socket
carry `world=qc`, so a QC page cannot read or write production. Image URLs in a QC state already
carry `?world=qc`.

**Native clients.** Point debug builds at a QC world and only release builds at production:
send the marker on every request (for a WebSocket, as `?world=`), use the QC keys or a token
minted with the marker, give debug and simulator devices ids that start with `qc-`, and show the
`x-world` response header (or `env` / `sandbox`) somewhere in the debug UI. A QC world has no
adapters: there is no weather, fleet or step feed unless you seed or push it.

## Pushing events: `POST /api/ingest`

```
POST https://world.example.org/api/ingest
x-world-key: <your ingest key>
Content-Type: application/json

{ "events": [ { "id": "…", "ts": "2026-11-13T09:45:00+08:00", "type": "money.balance", "source": "ledger", "data": { … } } ] }
```

The body is `{ "events": [ … ] }` or the bare array. Up to 5,000 events per call.

Reply (200): `{ ok: true, world, accepted, new, revised, unchanged, voided, rejected: [ { i, id, reason } ], logEntries }`.
`i` is the index in your array; `logEntries` is how many new log entries the push produced. A
rejected event does not fail the batch: read `rejected`. A malformed request is 400
`{ ok: false, error }`; a bad or missing key is 401.

Rules for every event:

- `type`: one of the types below. Anything else is rejected with `unknown type`. Nobody can push
  `xp`, `quest.done`, `level.up` or `achievement` (the engine derives those), nor the two types
  the engine writes for itself (`engine.mark`, `peer.card`).
- `source`: required, up to 120 characters. The real origin of the fact (`ledger`, `bank-feed`,
  `task-list`, `tracker`). Input a person typed or said uses `manual` or `manual:<channel>`
  (`manual:voice`, `manual:keypad`); see "Manual sources" for what that changes.
- `ts`: required. ISO 8601 with offset, or epoch milliseconds. Not more than 36 hours in the
  future.
- `data`: an object, at most 60,000 characters when serialised. Day-keyed events carry `date`
  (`YYYY-MM-DD`, the player's date for that day). Fields the engine does not know are stored and
  ignored.
- `id`: the idempotency key, at most 300 characters.
  - Types marked **keyed** get their id from `data` (shown below as `type:key`). Whatever `id`
    you send is ignored, so two collectors can never count the same fact twice.
  - Other types must send their own stable `id` (the transaction id, the message id).
- Same id, same `data` = no-op, however often it is pushed (`unchanged`). The comparison ignores
  key order and `ts`. Push whole snapshots; do not diff.
- Same id, different `data` = the fact is revised in place (`revised`, `rev` + 1). The first `ts`
  is kept as the fact's birth (`ts0`); no earlier payload is kept.
- **`contact.upsert` merges.** It is the one type whose revision keeps every field it does not
  mention, because several sources describe one person: a CRM collector knows name and role, a
  photo pass adds `img`, `likeness` and `wardrobe`. Send a field as `null` to clear it. `views` is
  kept per source and served as the union of what every source last sent for that person; a
  source that sends `views: null` clears its own share only. So a collector that resends its own
  list on every run cannot erase a tag another source set. Every other keyed type is a snapshot:
  a revision replaces the whole `data`.
- To withdraw a fact (a task re-opened, a row deleted), send its id with `void: true`; `data` and
  `ts` are not needed:
  `{ "id": "task.done:task-0001", "type": "task.done", "source": "task-list", "void": true }`.
  A voided fact stays in the table (`void: true`, `rev` + 1) and is ignored by the reducer: its
  XP, meter movement and log lines disappear on the next recompute. Voiding twice, or an unknown
  id, changes nothing. Pushing the same id again with data restores it.
- Numbers are numbers, money is USD unless a field says otherwise, `null` means "not measured".
  Never send 0 for "no reading".
- Account identifiers in `data` are masked before the event is stored (see "Account identifiers").

### Images: `/api/img/<imgId>`

Item photos and portraits. `POST` (or `PUT`) `/api/img/<imgId>` with `x-world-key`, the bytes as
the body and `Content-Type: image/webp|png|jpeg|avif|gif`, 1.5 MB at most (send a resized webp).
Reply `{ ok, id, bytes, url }`. `DELETE /api/img/<imgId>` removes it (`{ ok, deleted }`).
`imgId`: 1 to 120 characters of `A-Z a-z 0-9 . _ -`.

Reference an image as `"img": "<imgId>"` in `item.upsert` or `contact.upsert`. The state then
carries the URL `/api/img/<imgId>`, served to the owner's session, the TV key and read tokens,
never as a static file. An `img` that names no stored image appears as `null` in the state, so
upload the image first:

```bash
curl -X POST https://world.example.org/api/img/item-0123456789ab -H "x-world-key: $INGEST_KEY" \
  -H "Content-Type: image/webp" --data-binary @watch.webp
```

## Which fact wins, and which day it belongs to

### One source of truth per metric

Where two event types report the same thing, the first one with a value for the date wins; the
second only fills dates the first does not cover.

| Metric | Truth | Fills gaps only | Why |
|---|---|---|---|
| Steps | `steps.day` | `health.day.steps` | the step counter's own daily total is minutes fresh |
| Sleep | `health.day.sleepHours` / `deepSleepHours` | `sleep.night` | the health record has hours asleep and deep sleep; `sleep.night` is the in-bed span until it catches up |
| Food | `meal.day` | `health.day.kcal` / `proteinG` | the diary carries the day's target |
| Weight, body fat, lean mass | `health.day.weightKg` … | `weigh` | the reconciled scale record; a direct reading fills in until it lands |
| Resting HR, HRV, active energy, exercise minutes | `health.day` | | only source |

For steps and food the gap-filler only supplies finished days, never the current one (the two
sources may cut days differently, so mixing them inside one day would count twice). The step goal
is stored on each `steps.day`.

### One workout per day

A day earns the workout once (40 XP, +10 with a gym check-in), whichever form reports it. The
calendar form decides a day when it has an entry. A recorded session counts the day (credited to
the game day it started in) only when the calendar has none, and only if it ran 20 minutes or
more and its `kind` is not walking (walking is paid in steps). When both exist, the sessions add
kind, minutes and kcal to the same log line and nothing is paid twice. A session with
`inProgress: true` earns nothing; it only makes the activity mirror say `training` until the same
id arrives with an `end` (or 4 hours pass).

### Which day an event belongs to

An event with `data.date` belongs to that date. An event without one (a task done, a message, a
note, a focus block) is filed by its `ts` under the game day running at that instant:

- **Calendar days** (the default): the local calendar date, in the time zone of the place the
  player was in at that instant (from `place.arrive` / `place.stay`), else the zone on the newest
  `steps.day`, else UTC.
- **Sleep days**: when `day.start` events are in the log, a day ends when the player sleeps, not
  at midnight. Each `day.start` says "the game day `date` began at `at`". From that instant until
  the next `day.start` (or for 36 hours when there is none) every undated event belongs to that
  `date`, so something done at 02:00 still counts for the day being lived. An instant before the
  first boundary, or after the last one has run out, uses the calendar.

The state reports which is in force as `day.basis`: `"calendar"` or
`"sleep-day (day.start events)"`. Send real timestamps and let the engine place them.

## Event types

In the tables, **keyed** means the id is built from `data` as shown; **own id** means you must
send a stable `id`. `?` marks an optional field.

### Body

| Type | Id | `data` |
|---|---|---|
| `day.start` | keyed `date` | `date`, `at` (ISO instant that game day began); `basis?`, `tz?` are stored for reference |
| `steps.day` | keyed `date` | `date`, `steps`, `goal?`, `provisional?`, `tz?` (IANA zone of the device) |
| `sleep.night` | keyed `date` (the wake date) | `date`, `hours`, `deepHours?`, `start?`, `end?`, `approx?` (true = an in-bed span, not measured sleep) |
| `meal.day` | keyed `date` | `date`, `rows` (diary rows that day), `kcal`, `protein`, `carbs`, `fat`, `target: { name, kcal, protein, carbs, fat } \| null` |
| `workout` (calendar form) | keyed `date` | `date`, `status` (`"done"` earns XP), `gym: { ts, source } \| null` (a door or check-in record), `kind?`, `name?`, `minutes?` |
| `workout` (session form) | own id | `start`, `end`, `kind?`, `name?`, `minutes?` (else end minus start), `kcal?`; or `start` + `inProgress: true` with no `end` while it is happening. No `date`. |
| `weigh` | own id | `weightKg`, `bodyFatPct?`, `leanMassKg?`, `bmi?`, `date?` |
| `health.day` | keyed `date` | `date`, `weightKg`, `bodyFatPct`, `bmi`, `leanMassKg`, `steps`, `sleepHours`, `deepSleepHours`, `restingHr`, `hrvMs`, `activeEnergyKcal`, `exerciseMin`, `kcal`, `proteinG`, `carbsG`, `fatG` (all nullable) |
| `body.goal` | keyed (single: `body.goal:current`) | `weightKg` (goal weight), `bodyFatPct` (goal body fat); each is reached at or below |
| `focus.block` | own id | `minutes`, `label?`, `running?` (true = it started at `ts` and is planned for `minutes`: it counts the minutes elapsed so far and shows as working until it runs out) |
| `activity` | own id | `name` (`idle` \| `walking` \| `training` \| `sleeping` \| `working` \| `eating`), `minutes?` or `until?` (how long it stands; defaults: training 75, eating 30, working 90, walking 30, sleeping 480 minutes), `note?` |
| `mindful` | own id | `minutes`, `kind?` (meditation, breathwork) |
| `learn` | own id | `minutes`, `topic?`, `kind?` (reading, course, practice) |
| `checkin` | own id | `mood` (1 to 10), `note?` |

`activity` is what the player is doing right now, said by the player (`manual:…`) or reported by
a device. `idle` ends whatever was stated before. It feeds the activity mirror only: no XP, no
workout, no meter.

```json
{ "ts": "2026-11-13T09:43:00+08:00", "type": "health.day", "source": "health-db",
  "data": { "date": "2026-11-12", "weightKg": 84.2, "bodyFatPct": 22, "bmi": 27.5, "leanMassKg": 65.7, "steps": 11000,
            "sleepHours": 7.5, "deepSleepHours": 1.5, "restingHr": 60, "hrvMs": 50, "activeEnergyKcal": 500, "exerciseMin": 30,
            "kcal": null, "proteinG": null, "carbsG": null, "fatG": null } }
{ "ts": "2026-11-13T20:00:00+08:00", "type": "steps.day", "source": "steps", "data": { "date": "2026-11-13", "steps": 8800, "goal": 10000, "tz": "Etc/GMT-8" } }
{ "ts": "2026-11-13T19:00:00+08:00", "type": "meal.day", "source": "food-diary",
  "data": { "date": "2026-11-13", "rows": 6, "kcal": 2000, "protein": 150, "carbs": 200, "fat": 60, "target": { "name": "Daily", "kcal": 2200, "protein": 160, "carbs": 220, "fat": 70 } } }
{ "ts": "2026-11-13T10:00:00+08:00", "type": "workout", "source": "workout-calendar",
  "data": { "date": "2026-11-13", "status": "done", "gym": { "ts": "2026-11-13T09:05:00+08:00", "source": "gym-door" }, "name": "Upper body" } }
{ "ts": "2026-11-13T04:10:00+08:00", "type": "day.start", "source": "sleep-tracker", "data": { "date": "2026-11-13", "at": "2026-11-13T04:10:00+08:00" } }
{ "ts": "2026-11-13T13:30:00+08:00", "type": "body.goal", "source": "health-goals", "data": { "weightKg": 80, "bodyFatPct": 18 } }
{ "id": "checkin:2026-11-13T21:02", "ts": "2026-11-13T21:02:00+08:00", "type": "checkin", "source": "manual:voice", "data": { "mood": 7, "note": "good session" } }
{ "id": "learn:reader:2026-11-13", "ts": "2026-11-13T23:00:00+08:00", "type": "learn", "source": "reading-log", "data": { "minutes": 35, "topic": "A book about habits", "kind": "reading" } }
```

**Body goal.** One event, pushed whenever the goal on file changes (the id is fixed, so it
revises). It appears as `character.body.goal { weightKg, bodyFatPct, source, asOf }`, drives the
"Body goal" need, and the achievements "Fighting weight" (weight at or under the goal) and
"Carved" (body fat at or under the goal).

### Money

| Type | Id | `data` |
|---|---|---|
| `money.balance` | keyed `account:date` | `account` (stable id), `name`, `kind` (`cash` \| `crypto` \| `debt` \| `asset`; default `cash`), `value` (USD; debt as a positive or negative number), `date`, `currency?`, `native?` (amount in `currency`), `institution?`, `owner?` |
| `money.txn` | own id (the bank or chain id) | `amount` (USD, signed: income positive, spend negative), `kind?` (`income` \| `expense` \| `transfer`; default from the sign), `date?`, `merchant?` or `name?`, `category?`, `account?`, `owner?` |
| `money.burn` | keyed `date` | `date`, `perDay` (USD), `method?`, `windowDays?`: a collector's own computed burn, used when dated within 7 days |
| `money.budget` | keyed (single: `money.budget:current`) | `incomePerFortnight`, `fixedPerMonth`, `incomeName?`, `currency?`: the budget on file |
| `quest.progress` | keyed `quest:date` | `quest` (`"main"`, the default), `date`, `cur`, `target`, `unit`, `title?`, `text?`, `period?`, `due?`, `anchors: [ { date, target, label? } ]` |

```json
{ "ts": "2026-11-13T09:45:00+08:00", "type": "money.balance", "source": "ledger",
  "data": { "account": "bank:checking", "name": "Checking", "kind": "cash", "value": 5000, "date": "2026-11-13", "institution": "Example Bank" } }
{ "ts": "2026-11-13T09:45:00+08:00", "type": "money.balance", "source": "ledger",
  "data": { "account": "wallet:main", "name": "Main wallet", "kind": "crypto", "value": 1000, "date": "2026-11-13", "currency": "BTC", "native": 0.01 } }
{ "ts": "2026-11-13T09:45:00+08:00", "type": "money.balance", "source": "ledger",
  "data": { "account": "guild:operating", "name": "Operating account", "kind": "cash", "value": 10000, "date": "2026-11-13", "owner": "guild" } }
{ "id": "bank:txn:0001", "ts": "2026-11-12T03:10:00Z", "type": "money.txn", "source": "bank-feed",
  "data": { "amount": 2000, "kind": "income", "name": "Salary", "account": "bank:checking", "date": "2026-11-12" } }
{ "id": "bank:txn:0002", "ts": "2026-11-12T08:31:00Z", "type": "money.txn", "source": "bank-feed",
  "data": { "amount": -50, "kind": "expense", "merchant": "Example Cafe", "category": "Food", "date": "2026-11-12" } }
{ "ts": "2026-11-13T09:50:00+08:00", "type": "money.burn", "source": "ledger", "data": { "date": "2026-11-13", "perDay": 95, "method": "30-day outflow", "windowDays": 30 } }
{ "ts": "2026-11-13T09:50:00+08:00", "type": "money.budget", "source": "ledger", "data": { "incomePerFortnight": 2000, "fixedPerMonth": 2450 } }
```

**Gold, burn, runway.** Gold = cash + crypto minus debt over each account's latest snapshot;
`asset` is listed but not counted. An account silent for more than 4 days drops out of gold and
is listed as stale. Burn per day: a `money.burn` dated within 7 days, else expense transactions
over the last 30 days (once 14 days of transactions exist), else
`money.budget.fixedPerMonth / 30.44`. Runway = gold / burn. Income per month comes from income
transactions on the same window, else `money.budget.incomePerFortnight × 26 / 12`.

**Whose money (`owner`).** `owner` says whose account or transaction it is.

- Absent or `"gun"` (the player's fixed id): the player's own. Only this money is gold, runway,
  the money meter, the income lines, income XP and "The treasury grows".
- `"guild"`: the guild (a company, a team, a household; named by the var `GUILD_NAME`). Its
  balances roll up into `state.guild { id: "guild", name, total, accounts, … }` (total = cash +
  crypto minus debt) and the `guild` roster entry. They are never part of the player's gold.
- Any other value: stored, and shown nowhere.

An account belongs to the owner on its newest snapshot. Transactions that are not the player's
own never grant XP.

#### Account identifiers are masked at ingest

Before an event is stored, the engine replaces account identifiers in its `data` with four dots
and the last four characters, so the payload at rest, the canonical id, the state, the log,
`/api/tv`, `/api/events` and the live channel never carry one:
`"Example Bank (GB29 NWBK 6016 1331 9268 19)"` becomes `"Example Bank (•••• 6819)"`.

- **Strict**, for `money.*` events, every string field: IBAN-shaped strings, any run of 8 or
  more digits (spaces and dashes allowed), `0x…` addresses of 16 or more hex digits, and any
  token of 26 or more characters that mixes letters and digits. A numeric `account` is treated as
  a string. Amounts (`value`, `amount`, `native`) are numbers and are never touched. If `account`
  itself holds an identifier, the masked form becomes the account id (stable from push to push).
- **Safe**, for every other event, any string field: only strings that are certainly
  identifiers. IBANs with a valid checksum, card numbers of 13 to 19 digits that pass the Luhn
  check (`4242 4242 4242 4242` becomes `•••• 4242`), `0x` addresses of exactly 40 hex digits,
  bech32 addresses and mixed-case base58 addresses. Id fields (`id`, `img`, `url`, `hash`,
  `entry`, `eventId`, `taskId`, `itemId`, `contactId`, `placeId`, `questId`, `inside`) and
  strings that are a URL are left alone.
- In both: URLs, UUIDs, ISO dates and times are never altered.

A collector that masks first and one that sends the raw string land on the same stored row. The
reducer applies the strict masking again to money names, institutions and account ids on the way
out.

#### The main quest: `quest.progress`

The main quest is whatever the newest `quest.progress` event says it is. Push one snapshot a day
from wherever the number lives (a scoreboard, a spreadsheet, a ledger):

```json
{ "ts": "2026-11-13T06:00:00+08:00", "type": "quest.progress", "source": "scoreboard",
  "data": { "quest": "main", "date": "2026-11-13", "cur": 1800, "target": 9000, "unit": "USD",
            "title": "Build the Rainy-Day Fund", "text": "Six months of living costs in a separate account.",
            "period": "2027-H1", "due": "2027-06-30",
            "anchors": [ { "date": "2027-01-15", "target": 3000, "label": "first anchor" }, { "date": "2027-03-12", "target": 5000 },
                         { "date": "2027-05-07", "target": 7000 }, { "date": "2027-06-30", "target": 9000 } ] } }
```

- `title` and `text` become `quests.main.title` and `quests.main.text`. Without them the quest
  reads "Main quest" and a sentence saying to report it with `quest.progress` events. The quest
  id is always `"main"`, its giver "The realm", its area Wealth.
- `cur`, `target` and `unit` become `quests.main.progress`. `main.oneThing.title` is `title`,
  else the target as a number; `period` and `due` are passed through.
- `anchors` are dated milestones. An anchor counts as reached when a snapshot dated on or before
  the anchor's date has `cur >= target`: 500 XP each, once. Anchors with a target of 0 or less are
  ignored. The anchor list is read from the newest snapshot.
- The quest completes (5,000 XP) the first time a snapshot has `cur >= target`.
- With no event the progress is null. The quest is marked stale when the newest snapshot is more
  than 2 days old.

### Tasks

| Type | Id | `data` |
|---|---|---|
| `task.open` | keyed `taskId` | `taskId`, `title`, `area?` (one of the ten attribute names, any case), `priority?` (text), `oneThing?` (bool), `doDate?`, `dueDate?`, `world?` (a label for the list or workspace; shown as the quest giver), `url?` |
| `task.done` | keyed `taskId` | same fields + `completedAt?` (ISO; defaults to `ts`) |
| `checklist.day` | keyed `date` | `date`, `items: [ { title, done } ]`: the One Thing day checklist |
| `calendar.event` | keyed `eventId` | `eventId`, `title`, `start`, `end?`, `calendar?`: shown as `agenda` (up to 20 events that started in the last hour or start within 36 hours), no XP |

`priority` is free text from the task list; it is carried to `quests.side[].priority` (null when
the task has none) and decides the XP, first match wins: text containing `One Thing` (any case)
or a star (U+2B50), or `oneThing: true`, 60; `urgent`, `highest`, `high`, `p0`, `p1` 30;
`medium`, `normal`, `p2` 20; `low`, `p3`, `someday` 10; anything else, or none, 15. The ten areas
are Strategy, Body, Mind, Things, People, Joy, Wealth, Connection, Growth, Impact; a task with no
recognised area pays into Strategy.

A task that is done pushes `task.done` (keep pushing `task.open` or not: done wins). Re-opened:
void the `task.done`. Deleted or cancelled: void the `task.open`. A collector only sees a done
task while it is still in the source list: a task completed and then archived or deleted between
two runs is never seen as done, so it earns nothing. `task.done` events already in the log stay.

The state carries the first 100 open tasks as side quests, in priority order; the whole list is
at `GET /api/tasks`.

```json
{ "ts": "2026-11-13T08:00:00+08:00", "type": "task.open", "source": "task-list",
  "data": { "taskId": "task-0001", "title": "Send November invoices", "area": "Wealth", "priority": "High", "doDate": "2026-11-13", "world": "work", "url": "https://tasks.example.org/task-0001" } }
{ "ts": "2026-11-13T14:22:00+08:00", "type": "task.done", "source": "task-list",
  "data": { "taskId": "task-0001", "title": "Send November invoices", "area": "Wealth", "priority": "High", "completedAt": "2026-11-13T14:22:00+08:00" } }
{ "ts": "2026-11-13T18:00:00+08:00", "type": "checklist.day", "source": "task-list",
  "data": { "date": "2026-11-13", "items": [ { "title": "Outreach block", "done": true }, { "title": "Scoreboard reviewed", "done": false } ] } }
```

### Places

| Type | Id | `data` |
|---|---|---|
| `place.arrive` | own id (for example `tracker:visit:<id>`) | `lat`, `lon` (required), `place?` (name), `city?`, `country?` (ISO-2), `tz?` (IANA), `kind?` (`home` \| `city` \| `gym` …), `placeId?` (stable key; defaults to the name), `lastSeen?` (ISO: the newest point that still puts the player there), `accuracy?` (metres) |
| `place.stay` | keyed `from:lat,lon` | `place`, `city`, `country`, `lat`, `lon`, `tz`, `from`, `to`, `kind?`, `placeId?`: history; bulk-load years of these |
| `place.alias` | keyed by its match (`city:<name>` or `geo:<lat>,<lon>`) | `match: { city }` (the geocoder's city or place name, any case) or `match: { lat, lon, radiusKm? }` (default 1 km), `name` (what to show), `city?` (display city, defaults to `name`), `kind?` |
| `visa` | keyed `country:validUntil` | `country`, `validUntil` (date), `kind?` |
| `need.ok` | own id | `need` (`water` \| `food-supply` \| `air` \| `gym` \| `accommodation` \| `visa` \| `internet` \| `laundry`), `state?` (`ok` \| `warn` \| `bad`, default `ok`), `detail?`, `place?` (city) |
| `room.climate` | keyed `room` | `room`, `label?`, `tempC`, `humidity?`, `place?`: a sensor where the player is; shown as `realm.room` |

```json
{ "id": "tracker:visit:1001", "ts": "2026-10-18T09:00:00+08:00", "type": "place.arrive", "source": "tracker",
  "data": { "place": "Seabrook", "city": "Seabrook", "country": "XA", "lat": 10, "lon": 120, "tz": "Etc/GMT-8", "kind": "home", "lastSeen": "2026-11-13T09:30:00+08:00" } }
{ "ts": "2026-03-01T00:00:00Z", "type": "place.stay", "source": "tracker",
  "data": { "place": "Old Quay", "city": "Rivermouth", "country": "XB", "lat": 20, "lon": 100, "tz": "Etc/GMT-7", "from": "2026-03-01T10:00:00+07:00", "to": "2026-08-29T22:00:00+07:00", "kind": "city" } }
{ "id": "need:laundry:2026-10-20", "ts": "2026-10-20T11:00:00+08:00", "type": "need.ok", "source": "manual:voice", "data": { "need": "laundry", "detail": "Laundromat two streets away", "place": "Seabrook" } }
```

**Where the player is.** The stay in force is the one the newest `place.arrive` belongs to; the
realm, sun, weather and air follow it. `realm.stale` and the Location signal are judged on
`lastSeen` (stale after 72 hours without a point); when the event has no `lastSeen` they go stale
72 hours after the arrival itself, so send it on every run. Push one event per stay with a fixed
`id` and `ts`, and push it again with a newer `lastSeen` as points arrive.

**Same stay.** An arrival in the same `city` + `country` as the current stay, or within 5 km of
where that stay began, belongs to the same stay, whatever the two sources call the spot: no
place-need reset, and the stay keeps its original start. The report with the newest `lastSeen`
supplies the name, coordinates and freshness. An arrival within 5 km of the previous arrival is
also not "new ground", and is one place on the map. Anything else starts a new stay.

**Place needs.** A new stay resets the eight place needs to unknown and issues them as rebuild
quests in pyramid order. They settle from data, 20 XP each:

- `food-supply`: the food diary kept on 2 days there;
- `gym`: a workout there;
- `accommodation`: the place is `kind: "home"`, or 3 nights of sleep recorded there;
- `visa`: a `visa` event for the country (valid 14 days or more ok, under 14 warn, expired bad).

or from a `need.ok` event (also accepted: a `note` with `need`), which settles the need without
XP. A `need.ok` applies to the stay its `ts` falls in; when it carries `place`, that must be the
stay's city. `water`, `internet` and `laundry` have no data source and are settled only that way. The
`air` need shown in `needs[]` follows the weather adapter's air-quality reading (US AQI up to
100 ok, up to 150 warn, above that bad); its rebuild quest is closed by a `need.ok`.

`place.stay` feeds the map, countries, distance, and first-visit XP dated when the stay began.

**Aliases.** `place.alias` renames a place for display: the realm, the world map, the roster
location, the log and the rebuild quests all use `name`; `realm.placeRaw` keeps the geocoder's
own name. The newest matching alias wins, places that end up with the same name merge into one,
and nothing is renamed without an alias event (void it to undo). One alias with a lat/lon radius
covers every source's name for the same spot (a tracker may call a home "Ward Seven" while a
phone calls it "Eastfield"):

```json
{ "ts": "2026-11-13T12:40:00+08:00", "type": "place.alias", "source": "manual:keypad",
  "data": { "match": { "lat": 10, "lon": 120, "radiusKm": 2 }, "name": "Seabrook", "kind": "home" } }
{ "ts": "2026-11-13T11:00:00+08:00", "type": "place.alias", "source": "manual:keypad",
  "data": { "match": { "city": "Ward Seven" }, "name": "Seabrook", "kind": "home" } }
```

### Belongings

| Type | Id | `data` |
|---|---|---|
| `item.upsert` | keyed `itemId` | `itemId`, `name`, `cat?` (clothes, tools, device …), `slot?` (`head`, `chest`, `legs`, `feet`, `wrist`, `finger`, `back`, `neck`, `mainhand`, `offhand`, `trinket1`, `trinket2`, `vehicle`), `equipped?` (bool), `assumed?` (bool: `equipped` is a guess, not an observation), `brand?`, `size?`, `location?`, `bag?` (the container's name), `inside?` (the container's `itemId`), `valueUsd?` (replacement value), `rarity?` (else from value: 50 uncommon, 200 rare, 800 epic, 2,500 legendary), `qty?`, `img?` (image id), `status?` (`owned` default; `sold` \| `donated` \| `given` \| `discarded` \| `gone` \| `lost`), `legacy?` (bool: an old record), `detail?` |
| `item.equip` | own id | `itemId`, `slot?` (defaults to the item's slot), `equipped?` (default true): a confirmation of what the player is wearing or carrying, said by the player (`manual:…`) or reported by a sensor |
| `item.wish` | keyed `slot` | `slot`, and at least one of `name` (the item wanted), `quest` (text), `questId` (`task:<taskId>`); `detail?`, `valueUsd?`, `url?`: a slot waiting on a quest |

```json
{ "ts": "2026-11-13T10:00:00+08:00", "type": "item.upsert", "source": "inventory",
  "data": { "itemId": "item-0123456789ab", "name": "Field watch", "cat": "device", "slot": "wrist", "equipped": true, "assumed": true,
            "brand": "Example", "location": "On me", "valueUsd": 300, "img": "item-0123456789ab" } }
{ "id": "equip:watch:2026-11-13T10:02", "ts": "2026-11-13T10:02:00+08:00", "type": "item.equip", "source": "manual:voice", "data": { "itemId": "item-0123456789ab", "slot": "wrist", "equipped": true } }
{ "ts": "2026-11-13T10:05:00+08:00", "type": "item.wish", "source": "manual:voice", "data": { "slot": "finger", "name": "Smart ring", "quest": "Reach the next anchor" } }
```

**Equipped, assumed, confirmed.** `equipped: true` on `item.upsert` puts the item on the paper
doll. If that is a guess, send `assumed: true` with it: the flag travels to
`character.equipment[].item.assumed` and `inventory.bags[].items[].assumed` so the screen can
mark it. An `item.equip` event is the confirmation path: the newest one per item sets or clears
its equipped state without the flag, and a confirmed item displaces a guessed one in the same
slot. One item per slot.

**Containers.** `inside` (the container's `itemId`) or `bag` (the container's name; several names
joined by " / " are tried in order) places an item in a bag. A bag that is itself an item carries
`itemId`; if that container sits inside another container its bag has `parent` (the outer bag's
id); the container item carries `bagId` (the bag it opens). Items with only a `location` go in
that location's bag; the rest in "Unsorted".

**Locked slots.** A slot with nothing equipped shows the wish declared for it:
`{ slot, item: { quest, detail, wish, questId, questDone, valueUsd, url, source, asOf } }` (no
`name`, so it reads as locked). `quest` is the text given, else the title of the task named by
`questId`, else "Get " and the item's name. The engine never invents a wish, and a real equipped
item always replaces it.

**Leaving.** A `status` other than `owned` takes the item out of the bags. `sold`, `donated`,
`given`, `discarded` and `gone` earn the "let go" XP; `lost` does not.

### People

| Type | Id | `data` |
|---|---|---|
| `contact.upsert` | keyed `contactId` | `contactId`, `name`, `role` (`partner` \| `family` \| `close` \| `friend` \| `team` \| `client`), `views?` (array of free tags: `family`, `squad`, `company`, `clients`, `party`, `bookclub` …), `location?`, `lastContact?` (ISO), `lastPosted?` (ISO, group recency), `strengths?`, `weaknesses?`, `supportThem?`, `supportMe?`, `img?`, `wardrobe?`, `likeness?` |
| `contact.touch` | own id (the message or call id, or `touch:<contactId>:<date>`) | `contactId`, `name?`, `role?`, `channel?` (message, call, in-person), `direction?`, `date?` |
| `support.given` | own id | `name?`, `contactId?`, `kind?` (intro, advice, money, time), `minutes?`, `amountUsd?`, `note?` |

```json
{ "ts": "2026-11-13T09:00:00+08:00", "type": "contact.upsert", "source": "crm",
  "data": { "contactId": "ines-park", "name": "Ines Park", "role": "friend", "views": ["squad", "bookclub"], "location": "Pinehill", "lastContact": "2026-11-10T19:30:00+08:00" } }
{ "ts": "2026-11-13T09:00:00+08:00", "type": "contact.upsert", "source": "crm",
  "data": { "contactId": "robin", "name": "Robin Vale", "role": "partner", "views": ["party"] } }
{ "ts": "2026-11-14T10:00:00+08:00", "type": "contact.upsert", "source": "photos",
  "data": { "contactId": "ines-park", "img": "party-ines-park",
            "likeness": { "assumed": true, "basis": "generated from 5 photos in the owner's library", "generated": "2026-11-14" } } }
{ "id": "messages:msg:0001", "ts": "2026-11-13T11:05:00+08:00", "type": "contact.touch", "source": "messages",
  "data": { "contactId": "kai", "name": "Kai", "role": "friend", "channel": "message", "direction": "out" } }
{ "id": "support:2026-11-13:omar", "ts": "2026-11-13T16:00:00+08:00", "type": "support.given", "source": "manual:voice", "data": { "name": "Omar", "kind": "intro" } }
```

**Touches.** One touch per person per day counts (more are ignored), and the first six people of
a day earn XP. Touches with `partner`, `family` and `close` roles pay into Connection, everyone
else into People.

**Who is on the roster.** There is no built-in partner. A contact whose `role` is `partner` (at
most three) joins the character roster under its own contact id, between the companion and the
guild, and leads `party[]`. With no such contact there is no partner entry anywhere. A contact in
the `squad` view that has a stored portrait also joins the roster, after the guild. `party[]`
holds only the contacts that were sent, plus peer cards (`MULTIPLAYER.md`).

**Bond** is shown only on positive evidence: it is built from the days the player was in touch
with the person in the last 30 (60% recency, 40% frequency against 8 days). With no touch in that
window it is null (no signal), never a low number: silence on the channels a collector can see
proves nothing. `lastContact` stays as a dated fact. For `role: "partner"` both `bond` and
`lastContact` are always null: messages are not how people who live together keep in touch
(their touches still count for XP, the social meter and "Reach out").

**Wardrobe.** `wardrobe` is an array of at most 40 entries
`{ name, cat?, slot?, seen?, last?, assumed? }`: what the person was seen wearing in the player's
own photos, garments and accessories only. Every entry is a guess, so `assumed` defaults to true.
Strings are cut to 80 characters. It is passed through to `party[].wardrobe` and is absent when
not sent.

#### Portraits of other people

A person's `img` is an id in the image store (`POST /api/img/party-<contactId>`, a 512 px webp;
`party-<contactId>-sm` for a 256 px copy). It is served to the owner's session, the TV key and
read tokens only, never as a static file.

A portrait generated from photos is a guess until the player confirms it, so it travels with its
provenance in `likeness`: `assumed` (bool, default true), `basis` (what it was made from, 200
characters at most), `generated` (`YYYY-MM-DD`). The engine keeps exactly those three fields on
`party[].likeness`, and a client can mark the card as an assumed likeness. Send `assumed: false`
once the player has confirmed it; omit `likeness` on a later upsert to leave it as it is. No
`likeness` means a real photo or no portrait.

### Companion and system

| Type | Id | `data` |
|---|---|---|
| `companion.stats` | keyed `date` | `date`, `skills`, `automations`, `automationRuns: { ok, fail }`, `sessions` (AI sessions that day), `planUsagePct?` (mana = 100 minus this), `lastActiveAt?` (ISO: the player's own most recent input in any AI session, not agent output), `activeSessions?` (sessions with such input in the last 10 minutes) |
| `system.status` | own id | `label`, `state` (`green` \| `amber` \| `red`, or `ok` \| `warn` \| `bad` \| `down`), `headline`, `severity?`: a line in the log. The fleet adapter writes one on a fleet state change; a collector may add its own |
| `profile.set` | keyed (single: `profile.set:gun`) | `name?` (the player's name; else the var `OWNER_NAME`), `birthDate?` (`YYYY-MM-DD`; gives `realm.dayOfLife`) |
| `note` | own id | `text`, `need?` + `state?` + `place?` (settles a place need), `area?`: a line in the log, never XP |

```json
{ "ts": "2026-11-13T23:55:00+08:00", "type": "companion.stats", "source": "companion-counter",
  "data": { "date": "2026-11-13", "skills": 10, "automations": 20, "automationRuns": { "ok": 100, "fail": 1 }, "sessions": 3, "planUsagePct": 25,
            "lastActiveAt": "2026-11-13T23:52:00+08:00", "activeSessions": 1 } }
{ "ts": "2026-11-13T09:00:00+08:00", "type": "profile.set", "source": "profile", "data": { "name": "Ash Example", "birthDate": "1990-01-01" } }
```

`companion.stats` is dated with the wall-calendar date of the machine that counted. The newest
one is used while it is at most 2 days old. `lastActiveAt` is what lets the activity mirror say
`working`: it is read as "the player was at the keyboard then" and stands for 10 minutes. A
session count alone says nothing about now, so without this field AI work never shows as
working. Send it on every run.

The companion's name is the var `COMPANION_NAME`. Its status, `hosts[]` and `office` come from
the `fleet` feed snapshot, not from events (see "Edge adapters").

### Written by the engine only

| Type | Id | What it is |
|---|---|---|
| `engine.mark` | keyed `entry` | the time the engine first saw a derived log entry (see "Derived by the engine") |
| `peer.card` | keyed `peerId` | a presence card pulled from a peer world (`MULTIPLAYER.md`) |

Both are refused by `/api/ingest` like any unknown type.

## What each event does

| Event | XP (before the readiness multiplier) | Also feeds |
|---|---|---|
| `steps.day` | 1 per 1,000 steps, max 20 → Body | stamina, Walk the realm, The long road, streaks |
| sleep (`health.day` / `sleep.night`) | 2 per hour up to 8 h, +4 for 1.5 h deep → Body | energy, readiness multiplier, Rest at the inn, Sleep bank |
| `meal.day` | 5 for a kept diary (3 or more rows), 1 per 20 g protein up to the day's target (max 10) → Body | fuel, Feed the warrior, Hold the line, Fuel discipline |
| `workout` (calendar form) | 40 done, +10 gym check-in → Body | Iron week, care, place need "gym" |
| `workout` (session form) | counts as the day's workout when the calendar has none (40 → Body) | Iron week, care, place need "gym"; `inProgress` → activity training |
| weight (`health.day` / `weigh`) | 5 per day weighed → Body | body, Know your weight, care |
| `health.day` heart fields | 1 per 10 exercise minutes, max 6 → Body | health, energy, readiness |
| `task.done` | One Thing 60, High 30, Medium 20, Low 10, none 15 → the task's area (Strategy if none) | The One Thing, Clear a quest, Ship it, Esteem |
| `checklist.day` | 8 per ticked item, max 40 → Strategy | The One Thing |
| `money.txn` income (the player's own) | 1 per $100, max 150 per payment → Wealth | money meter, income |
| `money.balance` / `burn` / `budget` | none | gold, runway, The treasury grows (60 → Wealth); owner `guild` → guild treasury |
| `quest.progress` | 500 per anchor reached on time, 5,000 on completion → Wealth | main quest %, Safety tier |
| `place.arrive` / `place.stay` | 20 first time at a place → Joy; 100 first time in a country → Growth | realm, map, New ground, rebuild quests (20 each when settled from data) |
| `item.upsert` | 2 on record, +1 photo, +1 value; 5 when let go → Things | bags, paper doll, Aesthetic tier |
| `contact.touch` | 4 per person per day (max 6 people), +10 after 30 days of silence → Connection or People | social meter, bond, Reach out, Tend the network |
| `focus.block` | 1 per 10 min, max 18 a day → Mind | focus bar, Cognitive tier; `running: true` → activity working |
| `mindful` | 1 per 5 min, max 6 a day → Mind | self meter |
| `learn` | 1 per 10 min, max 12 a day → Growth | learning meter |
| `support.given` | 15 each, max 2 a day → Impact | giving meter |
| `activity` | none | `character.activity` |
| `item.equip`, `item.wish`, `place.alias` | none | paper doll (confirmed gear, locked slots), display names |
| `checkin`, `note`, `need.ok`, `visa`, `calendar.event`, `companion.stats`, `system.status`, `room.climate`, `profile.set`, `body.goal`, `day.start` | none | happiness meter, log, place needs, agenda, companion, realm, goals, the game day |

Quests pay on top of this when they complete: daily quests 10 to 30 XP, weekly quests 20 to 60,
rebuild quests 20, main-quest anchors 500. The full tables, with every number, are served at
`GET /api/rules`.

**Caps come before the multiplier.** Each rule's cap ("max 150 per payment", "max 20 a day") is
on the base XP. The day's readiness multiplier (×0.75 to ×1.25) is applied afterwards to the
capped base, so a logged grant can read above the cap on a strong day: a $15,000 payment is 150
base and "+153" at ×1.02, and at most +188 at ×1.25. A grant is never less than 1. Each log entry
shows the arithmetic: `grants[].base` (after the cap), `mult`, and `xp.amount`. `GET /api/rules`
lists every rule's `cap` and `capAtFullReadiness`.

### Manual sources

An event whose `source` is `manual` or starts with `manual:` is something a person said or
typed. It moves bars, needs and the log like any other event. What it pays:

- Everything `/api/act` can record (`checkin`, `mindful`, `learn`, `support.given`,
  `focus.block`, `activity`, `note`, `need.ok`, `item.equip`) grants no XP, ever. A place need
  settled by `need.ok` closes its rebuild quest with 0 XP.
- Pushed through `/api/ingest` with a manual source, these rules pay nothing: `task.done`,
  `checklist.day`, `money.txn` income, first visits (`place.arrive` / `place.stay`),
  `item.upsert`, `contact.touch`, `focus.block`, `mindful`, `learn`, `support.given`, and a
  `visa` settles its need without XP.
- The day-keyed body facts (`steps.day`, `sleep.night`, `meal.day`, `health.day`, `workout`,
  `weigh`) and `quest.progress` are scored whatever their `source` says, and quests are evaluated
  on the day's facts whatever their source. These types are meant to come from a device or a
  record; do not push them with a manual source for something that was not measured.
- `checkin` and `note` never grant XP, whatever their source.

## Derived by the engine (never pushed)

| Log entry | Id | When | Carries |
|---|---|---|---|
| `quest` | `quest.done:daily:<quest>:<date>`, `quest.done:weekly:<quest>:<monday>`, `quest.done:main:anchor:<date>`, `quest.done:main`, `quest.done:rebuild:…` | a daily, weekly, main-quest or rebuild quest completes | `title`, `xp`, `grants` |
| `level` | `level.up:<n>` | the character gains a level | `level` (number), `title` (rank at that level) |
| `attribute` | `level.up:<area>:<n>` | one of the ten attributes gains a level | `level` (number), `area`, `title` |
| `achievement` | `achievement:<id>` | a trophy is earned | `title`, `achievement { id, title, detail, rarity }` |
| `day` | `day.close:<date>` | a game day ends | `day { date, grade, xp, xpByArea, readiness, multiplier, questsDone, questsTotal, quests[], streaks[], notable[] }` |

Every log entry is `{ id, ts, type, text, xp: { area, amount } | null, icon, source }`, plus
`mult` and `grants: [ { rule, area, base, amount } ]` when it pays. Item entries carry
`item { id, name, rarity, img }`; system entries carry `severity` (`bad` | `warn`).

Each is its own log entry and its own live message. A bulk change (a backfill, a rules replay:
more than 40 new entries at once) is not broadcast entry by entry; clients get the `state` nudge
only.

**Completion times are fixed.** The first time the engine sees a quest completion, level-up or
achievement on the current or the previous game day, it records that time in the log as an
`engine.mark` event (`{ entry, at, date }`, id `engine.mark:<entry id>`, source `engine`). From
then on the entry keeps that `ts`, whatever arrives later that day and across replays. If the
fact that completed it is withdrawn, the entry and its mark go; a later completion gets its own
time.

**Day close.** When a game day ends the engine writes one `day` entry: the grade, XP by
attribute, which daily quests completed, what happened to each streak that day (`started`, `kept`
with its `length`, `broken` with the length it ended at in `was`; weekly streaks report on the
day their week closes) and up to eight notable events (achievements, level-ups, weekly and
main-quest completions, new places, workouts). A day on which nothing was measured has no entry.
The last 400 are at `GET /api/days`.

**Streaks** (`streaks[]` in the state: `id, label, unit, period, current, best, bestEnded,
lastDate, hitThisPeriod, alive, rule`):

| Id | Counts | Hit when |
|---|---|---|
| `steps-goal` | days | steps at or over the goal |
| `protein` | days | protein at 90% or more of the day's target |
| `diary` | days | 3 or more rows in the food diary (or totals on record) |
| `sleep` | nights | 7 hours or more |
| `workouts-week` | weeks | 3 or more workouts in the week |
| `weigh-ins` | weeks | on the scale 3 or more days in the week |

A run is consecutive days or weeks (Monday to Sunday) each with a confirmed hit; a day with no
data ends it. The day or week in progress never breaks a run.

## Manual facts: `POST /api/act`

Records one fact that no sensor can see, from voice, a keypad, a ring or a watch.

- **Auth**: the ACT key (`x-act-key` or `Authorization: Bearer <key>`), or the owner session
  from the same origin. Neither: 401 `{ "error": "x-act-key or an owner session is required" }`.
- `Content-Type` must be `application/json` (else 415).
- Each fact becomes an ordinary event with `source: "manual:<channel>"`. `channel` comes from the
  body (1 to 24 characters of `a-z 0-9 -`); the default is `voice` with the key and `web` with a
  session. It moves meters and needs and grants no XP.

| `type` (also accepted) | Body | Becomes | Moves |
|---|---|---|---|
| `checkin` (`mood`, `check-in`) | `mood` 1 to 10, `note?` | `checkin` | happiness |
| `mindful` (`meditate`, `meditation`, `breathwork`) | `minutes`, `kind?` | `mindful` | self |
| `learn` (`learning`, `read`, `study`) | `minutes`, `what?`, `kind?` | `learn` | learning |
| `support.given` (`support`, `gave`, `helped`) | `who?`, `what?` (one of the two is required), `kind?`, `contactId?` | `support.given` | giving |
| `focus.block` (`focus`, `deep-work`) | `minutes`, `label?`, `running?` (true = starting now) | `focus.block` | focus; with `running` also activity working |
| `activity` (`doing`, `status`) | `name` (idle, walking, training, sleeping, working, eating; also understood: gym, workout, lifting, run, running, eat, meal, breakfast, lunch, dinner, work, sleep, bed, asleep, walk, rest, resting, nothing, done, stop), `minutes?` (1 to 720), `note?` | `activity` | `character.activity` |
| `note` | `text`, `area?` | `note` | log only |
| `need.ok` (`need`) | `need` (water, food-supply, air, gym, accommodation, visa, internet, laundry), `place?` (default: the current city), `state?`, `detail?` | `need.ok` | place needs, rebuild quests |
| `item.equip` (`equip`, `wear`, `unequip`) | `itemId` or `item` (name; must match one item), `slot?`, `equipped?` | `item.equip` | paper doll |

`minutes` is 1 to 600 for `mindful`, `learn` and `focus.block`.

Optional on all: `ts` (within the last 7 days, at most 5 minutes ahead), `id` (a request id, 1 to
100 characters of `A-Z a-z 0-9 . _ : -`: a retry with the same id is the same fact; it is stored
as `act:<id>`), `channel`.

Reply (200):
`{ ok: true, world, duplicate, event: { id, ts, type, source, data }, meters: [ { id, bar, label, before, after, display, unchanged? } ], xp: 0, note, speech }`.
`duplicate` is true when this exact fact was already on record. `meters` always includes the bar
that kind of fact feeds (happiness for a check-in, self for mindful, learning, giving, focus);
when the fact did not move it, `before` equals `after` and `unchanged` is true, so a client can
still show where it stands. Other bars appear only if they moved; `bar` is `meter` or `vital`.
`speech` is one plain sentence to say back. The reply adds `activity` for an `activity` (and for
a running focus block), `need` for a `need.ok` and `equipment` (the slot) for an `item.equip`.

Errors are `{ ok: false, error }` with status 400. An unknown `type` also returns `types` (each
type and its fields); an item name that matches more than one item returns `candidates`
(`[ { itemId, name, slot } ]`).

```bash
curl -X POST https://world.example.org/api/act -H "x-act-key: $ACT_KEY" -H "Content-Type: application/json" \
  -d '{"type":"checkin","mood":7,"note":"good session","channel":"voice"}'
```
```json
{ "ok": true, "world": "production", "duplicate": false,
  "event": { "id": "act:checkin:1794564000000:fbefe4a8", "ts": "2026-11-13T10:00:00.000Z", "type": "checkin", "source": "manual:voice", "data": { "mood": 7, "note": "good session" } },
  "meters": [ { "id": "happiness", "bar": "meter", "label": "Happiness", "before": null, "after": 70, "display": "7 / 10" } ],
  "xp": 0, "note": "manual facts move meters and needs and grant no XP",
  "speech": "Logged. Mood 7 out of 10. Happiness is at 70 percent." }
```

## The phone as a sensor: `POST /api/phone`

For a phone app, which holds the owner's session and not the ingest key. Sensor facts only: they
are not manual, so they earn XP under the normal rules.

```
POST https://world.example.org/api/phone
Content-Type: application/json
(the owner's session)

{ "deviceId": "phone-main", "events": [ { "id": "…", "ts": "…", "type": "…", "data": { … } } ] }
```

- **Auth**: an owner session. No session: 401; not the owner: 403. No CORS headers are sent
  (native client). `Content-Type` must be `application/json` (else 415). Body up to 2 MB (else
  413), up to 1,000 events per call.
- **`deviceId`**: 1 to 64 characters of `A-Z a-z 0-9 . _ -`, stable per device. The engine stamps
  every event `source: "phone:<deviceId>"`; a `source` in the request is ignored.
- **`id`**: required per event, 1 to 160 characters of `A-Z a-z 0-9 . _ : -`, stable for the
  real-world fact (the health sample's UUID; for location, a stay id). Stored as
  `phone:<deviceId>:<id>`. Same id + same data = no-op; same id + different data = the fact is
  revised; `{ "id": "…", "type": "…", "void": true }` withdraws it (a sample deleted on the
  phone).
- **`ts`**: required, ISO 8601 with offset or epoch milliseconds, at most 10 minutes in the
  future.
- **Types**: only the four below. Any other type is rejected. Fields not listed are dropped.
- **Reply** (200): `{ ok: true, world, deviceId, source, accepted, new, revised, unchanged, voided, rejected: [ { i, id, reason } ], logEntries, activity }`.
  `i` is the index in your `events` array. A rejected event does not fail the batch. `activity`
  is `character.activity` after the write. A malformed request (no `deviceId`, `events` not an
  array, too many) is 400 `{ ok: false, error }`. Retry on network errors and 5xx with the same
  ids; never on 4xx.

| `type` | `ts` should be | `data` |
|---|---|---|
| `place.arrive` | when the player arrived at this place (keep it fixed for the stay) | `lat` (required, −90..90), `lon` (required, −180..180), `place?` (name, as reverse-geocoded on the device), `city?`, `country?` (ISO 3166-1 alpha-2), `tz?` (IANA, for example `Etc/GMT-8`), `accuracy?` (metres), `lastSeen?` (ISO: the newest fix that still puts the player there), `kind?` (`home` …), `placeId?` |
| `mindful` | the end of the session | `minutes` (more than 0, up to 600; or omit and send both `start` and `end`), `start?`, `end?` (ISO), `kind?` |
| `workout` | the end (or the start, while in progress) | finished: `start`, `end` (ISO, required; at most 24 h apart), `kind?` (the health platform's activity type name, for example `traditionalStrengthTraining`, `running`, `walking`), `name?`, `minutes?` (else end minus start), `kcal?` (active energy). In progress: `start` and `inProgress: true`, no `end`. |
| `activity` | when it began | `name` (`idle` \| `walking` \| `training` \| `sleeping` \| `working` \| `eating`), `minutes?` (1..720) or `until?` (ISO), `note?` |

What each does:

- **`place.arrive`** is where the player is (see "Places"). Send one event per stay with a fixed
  `id` and `ts`, and send it again with a newer `lastSeen` as fixes arrive (every 15 minutes is
  plenty). Start a new `id` when the player has moved more than 5 km and stayed. First time at a
  place 20 XP (Joy), first time in a country 100 XP (Growth).
- **`mindful`** adds to the self meter (minutes over 7 days against 70) and earns 1 Mind XP per
  5 minutes, up to 6 a day.
- **`workout`**: see "One workout per day". Send the in-progress form when a workout starts
  (`character.activity` becomes `training` at once and a live `activity` message goes out), then
  the finished form **with the same `id`** when it ends. A finished session shows as `training`
  for 20 more minutes.
- **`activity`** is a device report of what the player is doing (for example a sleep mode
  turning on: `sleeping` with `until`). It shows with the basis "reported by phone:<deviceId>"
  and is not marked inferred. No XP.

```json
{ "deviceId": "phone-main", "events": [
  { "id": "stay:2026-11-13T09:12", "ts": "2026-11-13T09:12:00+08:00", "type": "place.arrive",
    "data": { "place": "Eastfield", "city": "Harlow District", "country": "XA", "lat": 10, "lon": 120, "tz": "Etc/GMT-8", "accuracy": 18, "lastSeen": "2026-11-13T11:40:00+08:00" } },
  { "id": "hk:mindful:12345678-1234-4123-8123-123456789abc", "ts": "2026-11-13T07:32:00+08:00", "type": "mindful",
    "data": { "minutes": 12, "start": "2026-11-13T07:20:00+08:00", "end": "2026-11-13T07:32:00+08:00" } },
  { "id": "hk:workout:12345678-1234-4123-8123-123456789abd", "ts": "2026-11-13T10:05:00+08:00", "type": "workout",
    "data": { "kind": "traditionalStrengthTraining", "start": "2026-11-13T10:05:00+08:00", "inProgress": true } }
] }
```
The same workout finished (same `id`):
```json
{ "deviceId": "phone-main", "events": [
  { "id": "hk:workout:12345678-1234-4123-8123-123456789abd", "ts": "2026-11-13T10:57:00+08:00", "type": "workout",
    "data": { "kind": "traditionalStrengthTraining", "start": "2026-11-13T10:05:00+08:00", "end": "2026-11-13T10:57:00+08:00", "minutes": 52, "kcal": 310 } }
] }
```
Reply:
```json
{ "ok": true, "world": "production", "deviceId": "phone-main", "source": "phone:phone-main", "accepted": 1, "new": 0, "revised": 1, "unchanged": 0, "voided": 0, "rejected": [], "logEntries": 1,
  "activity": { "name": "training", "since": "2026-11-13T02:05:00.000Z", "until": "2026-11-13T03:17:00.000Z", "basis": "workout ended just now (traditionalStrengthTraining, 52 min)", "source": "phone:phone-main", "asOf": "2026-11-13T02:57:00.000Z", "inferred": false } }
```
A rejection (the other fields as above):
```json
{ "ok": true, "accepted": 0, "new": 0, "rejected": [ { "i": 0, "id": "x1", "reason": "type \"money.balance\" is not accepted from the phone; one of: place.arrive, mindful, workout, activity" } ] }
```

## Activity mirror (`character.activity`)

`{ name, since, until, basis, source, asOf, inferred }`. `name` is `idle`, `walking`, `training`,
`sleeping`, `working`, `eating`, `celebrating`, or null when nothing can be said. It is read from
the most direct evidence first; `basis` is a plain sentence saying which.

| # | `name` | Evidence | Stands for |
|---|---|---|---|
| 1 | `celebrating` | the engine saw a character level-up or a main-quest anchor | 150 s from that moment |
| 2 | (stated) | the newest `activity` event, while it runs | its `minutes` / `until` |
| 3 | `training` | a `workout` with `inProgress: true` | until it ends, 4 h at most |
| 4 | `walking` | the `steps` feed snapshot: steps arriving between two polls at 60 or more a minute (100 or more steps), samples reaching into the last 10 minutes | while that holds |
| 5 | `training` | a session that ended in the last 20 minutes; a gym check-in in the last 90; a calendar workout marked done in the last 20 | those windows |
| 6 | `eating` | the `food` feed snapshot: a row put into the food diary in the last 20 minutes | 20 minutes |
| 7 | `working` | a `focus.block` with `running: true` still inside its minutes; or `companion.stats.lastActiveAt` in the last 10 minutes | those windows |
| 8 | `sleeping`, `inferred: true` | the `steps` feed snapshot: inside the usual sleep window (the sleep-day boundary, plus or minus half the average night and 1 h), no steps for 45 minutes before the phone's last check-in, and that check-in under 4 h old | while that holds |
| 9 | `idle` | the `steps` feed answered within 15 minutes, the phone checked in within the hour, and none of the above | |
| 10 | null | no `steps` feed, or it has not answered for 15 minutes, or the phone has not checked in for an hour | |

Rows 1, 2, 3, 5 and 7 need nothing but events. Rows 4, 8 and 9 need a `steps` feed snapshot and
row 6 a `food` feed snapshot. Those snapshots come only from optional edge adapters with those
ids, and none is bundled (see "Edge adapters"). Without them the mirror says only what is stated,
recorded or running, and is null the rest of the time (`basis: "no step feed"`).

What the mirror reads from the snapshots:

- `steps`: `observedThrough` (ISO: how far the device's samples reach), `lastContactAt` and
  `updatedAt` (ISO: when the phone last checked in), `recent: [ { day, steps, observed } ]` (the
  last polls in order: the day's running total and, in epoch milliseconds, how far the samples
  reached at that poll), and for inferred sleep `dayMode.enabled`, `boundaryStart`,
  `boundaryEnd` (ISO: the sleep-day boundaries around now). The feed itself must have succeeded
  within the last 15 minutes.
- `food`: `lastRowAddedAt` (ISO).

`sleeping` without `inferred` only comes from a stated or device-reported `activity`. Inferred
sleep also needs 3 nights of sleep on record in the last 7 days. Step data reaches the edge when
the phone uploads, usually minutes late, so `walking` lags and can be missed on a short walk.

When `name` (or `inferred`) changes, the live channel sends
`{ "type": "activity", "activity": { …, "was": "<previous name>" } }` before the `state` nudge.
The engine re-evaluates on every tick, on every write, and when the current activity's `until`
passes.

## Edge adapters

An edge adapter is a feed the worker pulls for itself on the tick (every 5 minutes, production
only), as opposed to events a collector pushes. Adapters live in `src/adapters.js`: one async
function each, and one row in the `ADAPTERS` list (`{ id, everyMin, run }`).

```js
async function myFeed(env, c) { … return { events?, voids?, snapshot?, meta?, note?, skip?, keep? }; }
```

What an adapter is given:

| | |
|---|---|
| `env` | the worker's bindings, vars and secrets (`wrangler.toml`) |
| `c.now` | this tick, epoch ms |
| `c.tz` | the world's current time zone (IANA), `"UTC"` until one is known |
| `c.today` | today's date in that zone, `YYYY-MM-DD` |
| `c.place` | `{ lat, lon }` of the newest `place.arrive` event, or null |
| `c.snapshot` | what this adapter returned as `snapshot` last time (null on the first run) |
| `c.meta` | what it returned as `meta` last time: its own private bookkeeping |

What it may return:

| | |
|---|---|
| `events` | ordinary events (`{ id, type, source, ts, data }`), written to the log exactly as if they had been pushed: same validation, same ids, same idempotency. Deeds go here. |
| `voids` | ids of events to withdraw |
| `snapshot` | the latest reading of something that is state, not a deed (weather, the health of your machines). The reducer reads it as the feed's snapshot. It never grants XP. |
| `meta` | anything the adapter wants back next time (cursors, what it has already seen) |
| `note` | one line for the Signals panel |
| `skip: true` | nothing to do this tick; with `keep: true` the last snapshot stays as it is |

An adapter may throw. The tick then keeps the last good snapshot and meta, records the error on
the feed (it shows on the Signals panel and in `GET /api/signals`) and tries again on the next
tick. Each run is limited to 25 seconds. An adapter is due when it has never succeeded, when its
last run failed, or when `everyMin` minutes have passed.

- The var `NO_ADAPTERS = "1"` switches every adapter off; pushed events still work.
- `POST /api/admin/tick` (ingest key) runs every adapter now; `?feed=<id>` runs one. Reply
  `{ ok, ran: [ids], report: { <id>: { ok, new, revised, voided, rejected } | { ok: false, error } | "cached" | "skipped: …" }, logEntries, activity }`.
  In a QC world the reply is `{ skipped: true, world, reason }`: a QC world runs no adapters.

### Bundled: `weather`

Weather and air quality at the current place, from open-meteo.com (no key, no setup). It waits
for a `place.arrive` event, then refetches every 15 minutes or as soon as the place moves. It
writes no events. Its snapshot
`{ lat, lon, tz, tempC, feelsC, humidity, code, label, windKph, precipMm, isDay, asOf, fetchedAt, air: { usAqi, pm25, pm10, asOf } }`
becomes `realm.weather` and `realm.air`, supplies the realm's time zone when the place event has
none, and sets the state of the `air` place need.

### Bundled: `fleet` (the worked example)

The health of your own machines, read from a status page of your own. It shows the whole contract
in a few lines: configuration from `env`, a snapshot the reducer reads, an event written only
when something changed, and the previous snapshot used to tell.

Set the var `FLEET_STATUS_URL` to an https address that answers with JSON like this, and, if that
address wants a credential, the secret `FLEET_STATUS_KEY` (sent as `Authorization: Bearer`):

```json
{ "generated_at": "2026-11-13T09:58:00.000Z",
  "fleet": { "state": "green", "headline": "all systems healthy", "healthy": 2, "total": 2 },
  "hosts": [
    { "id": "companion", "name": "Main host", "where": "Northgate · server room", "state": "green", "headline": "all good", "last_seen_iso": "2026-11-13T09:57:00.000Z", "metrics": null },
    { "id": "spare", "name": "Spare host", "where": "Northgate", "state": "green", "headline": "all good", "last_seen_iso": "2026-11-13T09:50:00.000Z", "metrics": null } ],
  "climate": { "label": "Office", "temp_c": 21.5, "humidity": 40, "last_seen_iso": "2026-11-13T09:55:00.000Z", "stale": false } }
```

`state` is `green`, `amber` or `red`, for the fleet and for each host. `fleet` and `hosts` are
required; `climate` may be null.

- The snapshot feeds `state.companion`: `status` (`ok` / `warn` / `down`), `headline`, `hosts[]`,
  and `office` from `climate` (`office.label` is `climate.label`, default "Office").
- A host with the id `companion` gives the companion its `location` on the character roster: the
  part of its `where` before " · ".
- The "Systems" need follows `fleet.state` (green ok, amber warn, red bad).
- When `fleet.state` differs from the previous snapshot's, the adapter writes one event:
  `{ "id": "system.status:fleet:<generated_at>", "type": "system.status", "source": "fleet", "data": { "label": "Fleet", "state", "headline", "was", "notOk": [host names] } }`.
- Without `FLEET_STATUS_URL` the adapter does nothing and the companion has no status.

### Optional feed snapshots (no adapter bundled)

There are no bundled adapters for steps, sleep, food, workouts, a scale or BTC. Those facts
arrive as pushed events (`steps.day`, `sleep.night`, `meal.day`, `workout`, `weigh`, `health.day`,
`day.start`) through `/api/ingest`. The reducer still reads feed snapshots with the ids below, so
a fork can write adapters against services of its own to switch on what they feed:

| Feed id | Snapshot | Switches on |
|---|---|---|
| `steps` | `{ goal, tz, currentDay, updatedAt, lastContactAt, observedThrough, boundaryStart, boundaryEnd, dayMode: { enabled, … }, recent: [ { at, day, steps, observed, seen } ] }` | the activity mirror's walking, idle and inferred sleeping; the device time zone when no place has one; the current step goal; `day.endsAt` on a sleep day (`boundaryEnd`, when `currentDay` is the game day) |
| `food` | `{ lastRowAddedAt }` | the activity mirror's eating |
| `btc` | `{ price, prevClose, change24hPct, ath, athDate, drawdownPct, phase ("bull" \| "bear"), phaseDays, daysSinceTop, daysToNextHalving, mayer, onchain, asOf, source? }` | `treasury.btc` and the two BTC buffs ("Bull run", "Crypto winter") |

An adapter with the id `steps` runs before the others on each tick. Feeds with the ids `workouts`
and `scale` carry no snapshot the reducer reads; a successful run only counts toward the
freshness of the Workouts and Scale signals.

Without these adapters `treasury.btc` is null, and the activity mirror says only what is stated,
recorded or running. The QC seed writes synthetic snapshots for `steps`, `btc`, `fleet` and
`weather`.

Each entry of `state.signals[]` says how its feed arrives in `via`: `edge` (an adapter), `push`
(`/api/ingest`, `/api/phone`, `/api/act`) or `edge+push` (either).

## Read tokens for native widgets

A widget should not hold the owner's session. The app, which does hold it, mints a narrow token
and hands that to the widget.

`POST /api/token` (owner session; optional JSON body `{ "label": "ios-widget" }`) →
```json
{ "token": "wogr_<64 hex>", "scope": "world:read", "world": "production", "expiresAt": "2026-12-13T04:30:00.000Z", "id": "0123456789ab", "label": "ios-widget",
  "routes": ["/api/glance", "/api/brief", "/api/img/*"] }
```
- The token is shown once. The engine stores only its SHA-256. It lives 30 days; mint a new one
  before `expiresAt` (minting does not revoke the old one). At most 20 exist; the oldest goes
  first.
- Use: `Authorization: Bearer wogr_…` on `GET /api/glance`, `GET /api/brief?kind=…` and
  `GET /api/img/<id>`. Nowhere else: on any other route or method the token is ignored and the
  request is answered as if it had no credentials.
- A token is not tied to the life of the session that minted it: it works until it expires or is
  revoked. The minting session is recorded only so the owner can list or revoke "the tokens made
  here".
- `GET /api/token` (owner session) →
  `{ tokens: [ { id, scope, label, createdAt, expiresAt, lastUsedAt, thisSession } ] }` (never
  the token or its hash).
- `DELETE /api/token`:
  - with `Authorization: Bearer wogr_…`: revokes that token (a widget can retire its own);
  - with the owner session and no body: revokes every token this session minted;
  - with the owner session and `{ "id": "<id>" }`, `{ "token": "wogr_…" }` or `{ "all": true }`:
    revokes that one, or all of them.

  Reply `{ ok: true, revoked: <n> }`.
- A missing, malformed, expired or revoked token gets the same 401 as a request with no session.

## Glance: `GET /api/glance`

The small document for widgets, a watch and the lock screen (about 1 KB, always under 2 KB).
Auth: read token, owner session, or TV key. Every value is copied from the state document, so a
missing signal is `null`, never a number.

```json
{ "v": 1, "asOf": "2026-11-13T10:00:00.000Z",
  "name": "Ash Example", "level": 17, "title": "Adventurer", "xp": 128, "xpNext": 740, "xpToday": 76,
  "health": 80, "energy": 65,
  "meters": [ { "id": "money", "value": 53 }, { "id": "energy", "value": 64 }, { "id": "sleep", "value": 84 }, { "id": "social", "value": 38 },
              { "id": "care", "value": 100 }, { "id": "happiness", "value": null }, { "id": "self", "value": null }, { "id": "giving", "value": null }, { "id": "learning", "value": null } ],
  "main": { "title": "Build the Rainy-Day Fund", "pct": 20, "cur": 1800, "target": 9000, "unit": "USD",
            "next": { "date": "2027-01-15", "target": 3000, "label": "first anchor" } },
  "closest": { "id": "walk", "title": "Walk the realm", "pct": 88, "left": "1,200 steps to go" },
  "quests": { "done": 2, "total": 7 }, "grade": "D",
  "streaks": [ { "id": "diary", "label": "Food diary kept", "current": 41, "unit": "days", "secured": true },
               { "id": "steps-goal", "label": "Step goal", "current": 40, "unit": "days", "secured": false },
               { "id": "protein", "label": "Protein target", "current": 40, "unit": "days", "secured": false } ],
  "activity": { "name": "idle", "inferred": false },
  "realm": { "place": "Seabrook", "stale": false },
  "day": { "date": "2026-11-13", "endsAt": null } }
```
- `level`, `title` (rank), `xp` / `xpNext` (into the current level / size of the level),
  `xpToday`.
- `health`, `energy`: the two vitals, 0..100 or null.
- `meters`: always nine, in this order; `value` 0..100 or null.
- `main`: the main quest. `title` is "Main quest" until a `quest.progress` event names it; `pct`,
  `cur`, `target`, `unit` and `next` (the next anchor not yet reached) are null until one
  reports.
- `closest`: the open daily quest nearest to done that can still be moved now (null when there
  is none); `left` is the remaining amount in words.
- `quests`: daily quests done and total (only those with a signal). `grade`: the day's grade so
  far (S A B C D F), null until something is done.
- `streaks`: up to three running streaks, daily ones first, longest first. `secured` says whether
  today's mark is already reached (null for weekly streaks).
- `activity`: `name` is idle, walking, training, sleeping, working, eating, celebrating or null;
  `inferred: true` means "probably".
- `realm.stale`: true when there is no place, or the location has not been confirmed for 72
  hours.
- `day.endsAt`: the instant the game day ends, when the engine knows it (a sleep day whose end is
  on record); null on calendar days.
- In a QC world the document also carries `env: "qc"` and `sandbox`.
- Headers: `ETag` and `Cache-Control: private, max-age=60`. Send `If-None-Match` with the last
  ETag exactly as received (it may arrive as a weak tag, `W/"g1-…"`; both forms are accepted); an
  unchanged glance answers 304 with no body. The ETag covers everything except `asOf`, so `asOf`
  (when the engine last recomputed) may be older than a minute while nothing changed.

## Briefings: `GET /api/brief`

`GET /api/brief?kind=morning|now|evening` (read token, owner session or TV key; `now` when `kind`
is absent or unknown) returns a structured object plus `speech`: two or three plain sentences
built only from the state, with no symbols, written to be read aloud.

Every kind carries `kind`, `asOf` and `day { date, calendarDate, basis, endsAt, minutesLeft }`
(`endsAt` and `minutesLeft` are null when the end of the day is not on record).

- `morning`: `sleep { hours, display, source } | null`, `readiness { score, multiplier, energy }`,
  `quests[]` (each with `state`), `main { title, oneThing, cur, target, unit, pct, next } | null`.
- `now`: `activity`, `closest[]` (up to two open quests nearest to done), `atRisk[]` (daily
  streaks of 2 or more not yet secured today, the sleep streak excepted:
  `{ kind: "streak", id, label, current, unit, left? }`), `open[]`, `done[]` (ids), `xp`.
- `evening`: `grade`, `xp`, `questsDone`, `questsTotal`, `completed[]`, `carriesOver[]`,
  `openTasks`, `weekly[]`.

Quest lines in a brief are `{ id, title, pct?, left? }`. `left` is what remains in words, counted
from the quest's own progress in the right number ("9 tasks to go", "1 task to go", "4 people to
reach", "1 weigh in to go", "1,200 steps to go", "480 calories short of the range", "averaging
7.1 of 7 hours a night, it settles when the week ends", "target reached, it settles when the day
ends"). `left` and `pct` are left out of the object when there is no reading or nothing that can
be done now changes it (last night's sleep); speak a line without `left` as its title alone,
never as zero.

```json
{ "kind": "now", "asOf": "2026-11-13T10:00:00.000Z",
  "day": { "date": "2026-11-13", "calendarDate": "2026-11-13", "basis": "calendar", "endsAt": null, "minutesLeft": null },
  "activity": { "name": "idle", "since": "2026-11-13T09:30:00.000Z", "until": null, "basis": "no recent activity (no steps since 17:30, phone seen 4 min ago)", "source": "steps", "asOf": "2026-11-13T09:56:00.000Z", "inferred": false },
  "closest": [ { "id": "walk", "title": "Walk the realm", "pct": 88, "left": "1,200 steps to go" }, { "id": "protein", "title": "Feed the warrior", "pct": 83, "left": "24 grams of protein to go" } ],
  "atRisk": [ { "kind": "streak", "id": "steps-goal", "label": "Step goal", "current": 40, "unit": "days", "left": "1,200 steps to go" },
              { "kind": "streak", "id": "protein", "label": "Protein target", "current": 40, "unit": "days", "left": "24 grams of protein to go" } ],
  "open": [ { "id": "walk", "title": "Walk the realm", "pct": 88, "left": "1,200 steps to go" }, { "id": "rest", "title": "Rest at the inn", "pct": 97 },
            { "id": "protein", "title": "Feed the warrior", "pct": 83, "left": "24 grams of protein to go" }, { "id": "kcal", "title": "Hold the line", "pct": 68, "left": "480 calories short of the range" },
            { "id": "one-thing", "title": "The One Thing", "pct": 0, "left": "still open" } ],
  "done": ["clear-a-quest", "reach-out"], "xp": 76,
  "speech": "Closest right now is Walk the realm, 1,200 steps to go, then Feed the warrior, 24 grams of protein to go. At risk is your 40 day step goal streak, 1,200 steps to go, and 1 other streak." }
```

## Raw events: `GET /api/events`

`GET /api/events?source=<prefix>&type=<type>&since=<iso>&limit=<n>&cursor=<next>` (ingest key)
lists stored events whose `source` starts with the prefix (empty = every source), newest first,
voided ones included:

```
{ source, type, since, total, totalLive, count, live, next,
  bySource: { "<source>": { total, live, voided, types } },
  events: [ { id, type, source, ts, receivedAt, updatedAt, rev, void, data } ] }
```

`total` and `totalLive` count every match; `count`, `live` and `bySource` describe this page.
When `next` is not null pass it back as `cursor` for the following page, with the same other
parameters, until it is null: that walks a whole history however long it is. `data` is what is
stored, which is already masked. `source=phone:` is everything the phones sent; `source=phone:qc-`
one family of devices; `source=manual:` everything said or typed. Default limit 500, at most
2,000.

To void, push the stored `id` back through `/api/ingest` with `void: true`; this works for any
id, including `phone:<deviceId>:…` and `act:…`:

```bash
curl -s "https://world.example.org/api/events?source=phone:qc-&since=2026-11-13T00:00:00Z" -H "x-world-key: $INGEST_KEY" \
 | jq '{events: [.events[] | select(.void | not) | {id, type, source: "void:test-traffic", void: true}]}' \
 | curl -s -X POST https://world.example.org/api/ingest -H "x-world-key: $INGEST_KEY" -H "Content-Type: application/json" -d @-
```

## Client diagnostics: `/api/clientlog`

What a real device saw, so a failure on someone's phone is not invisible. This is not life data:
it is kept beside the event log (newest 500 per world), never enters it, and never feeds state,
XP or the combat log.

**Write**: `POST /api/clientlog` with the owner session, same origin, `Content-Type:
application/json`. It works in every world (`?world=qc-ui` / `x-world: qc-ui` stores in that
world). Body: one entry or an array of entries:
```json
{ "kind": "model", "detail": { … }, "ua": "<navigator.userAgent>", "build": "<client build id>", "t": 1794564000000 }
```
- `kind`: required, `a-z 0-9 . _ -`, up to 40 characters, starting with a letter or digit
  (`model`, `boot`, …).
- `detail`: any JSON value; stored as sent after credential-shaped strings are stripped (read
  tokens, JWTs, bearer tokens, `key=` / `token=` / `cookie=` values, hex strings of 32 or more
  characters, account identifiers). Over 2,000 characters it is replaced by
  `{ truncated: true, bytes, text }` holding the first 1,900 characters.
- `ua` (up to 300 characters), `build` (up to 80), `t` (client time, epoch ms or ISO; dropped if
  more than 7 days from server time): all optional.
- The answer is always `204` with no body, straight away, for any owner request. Bad JSON, a body
  over 100,000 characters, an entry with no valid `kind`, entries past the twentieth of a batch
  and entries over the rate limit (60 a minute per session) are dropped silently. Only a missing
  session (401), a session that is not the owner's (403) or a cross-origin post (403) answer
  otherwise. Post with `fetch(…, { method: "POST", keepalive: true })` and ignore the result.

The server adds `receivedAt`, `device` (the request's user-agent family only, for example
`"iPhone · iOS 18.1 · in-app web view"`) and `colo` (the Cloudflare location that served it).

Shapes the web client posts:
```json
{ "kind": "model", "t": 1794564000000, "build": "stage-1.0.3", "ua": "Mozilla/5.0 (iPhone; …)",
  "detail": { "url": "/models/gun.glb", "stage": "fetch | parse | decode | texture | compile | timeout", "httpStatus": 200,
              "bytesReceived": 4000000, "bytesDeclared": 18000000, "error": "RangeError: Array buffer allocation failed", "attempt": 2,
              "limits": { "maxTextureSize": 4096, "maxRenderbufferSize": 4096, "maxVertexUniformVectors": 256, "webgl2": true } } }
{ "kind": "boot", "t": 1794564000000, "build": "stage-1.0.3",
  "detail": { "quality": "low | mid | high", "renderer": "Apple GPU", "maxTextureSize": 4096, "deviceMemory": null, "connection": "wifi",
              "viewport": { "w": 390, "h": 844, "dpr": 3 }, "standalone": false, "inApp": true } }
```

**Read**: `GET /api/clientlog?since=<iso>&kind=<kind>&limit=<n>` with the ingest key
(`x-world-key`) or the TV key (`x-tv-key`); QC keys read QC worlds (add `x-world: qc-ios` for a
namespace). Newest first, `limit` up to 500 (default 100):
```json
{ "world": "production", "total": 12, "count": 1, "entries": [
  { "id": 12, "receivedAt": "2026-11-13T06:02:11.412Z", "kind": "model", "detail": { … }, "ua": "…", "build": "…", "t": "2026-11-13T06:02:10.000Z",
    "device": "iPhone · iOS 18.1 · in-app web view", "colo": "AMS" } ] }
```
```bash
curl -s "https://world.example.org/api/clientlog?limit=50" -H "x-world-key: $INGEST_KEY"                              # production
curl -s "https://world.example.org/api/clientlog?kind=model" -H "x-world-key: $QC_INGEST_KEY" -H "x-world: qc-ios"    # a QC namespace
```

## Admin routes

All are `POST` with the ingest key (`x-world-key`); the key decides the world, as everywhere.

| Route | Does |
|---|---|
| `/api/admin/tick[?feed=<id>]` | runs the edge adapters now, then recomputes (see "Edge adapters") |
| `/api/admin/recompute` | replays the whole log through the current rules: `{ ok, log, newEntries }`. Use it after retuning `src/rules.js` |
| `/api/admin/events?type=<type>&limit=<n>` | raw events of one type, newest first, as an array (default 50, at most 1,000) |
| `/api/admin/debug` | feed state (last ok, last try, error, fail count, note), event counts per type, log size, images, open sockets, database size, last tick and next alarm |
| `/api/admin/scan-identifiers` | counts of identifier-shaped strings per stored table (kinds and last four characters only, never an identifier) |
| `/api/admin/purge-identifiers[?dry=0]` | rewrites in place any stored event that still holds an identifier; a dry run unless `dry=0`. Reply `{ ok, dry, events, byType }` |
| `/api/admin/qc/reset`, `/api/admin/qc/seed[?keep=1]` | QC ingest key only: empty the QC world; load the synthetic fixture (see "Test against the QC world") |

## Other endpoints

| Route | Auth | Returns |
|---|---|---|
| `GET /api/state` | owner session | the contract document (`CONTRACT.md`) |
| `GET /api/tv` | TV key | the same document |
| `GET /api/tv/model/<file>.glb\|.usdz` | TV key | a model file from the deployment's static models, for a native screen |
| `GET /api/live` | owner session, or TV key (as `?key=`) | WebSocket: `{ type: "hello", env, world?, asOf, computedAt }`, then `{ type: "event", event }` (a log entry), `{ type: "activity", activity }` and `{ type: "state" }` (refetch). Send `ping` for `pong`. |
| `GET /api/log?limit=<n>&cursor=<next>` | owner session | the full derived log, newest first: `{ total, entries, next }`; pass `next` back as `cursor` (or `before=<iso>` to start below a time). Default 100, at most 500 |
| `GET /api/days?limit=<n>` | owner session or TV key | day-close summaries, newest first, up to 400: `{ count, days: [ { …day, closedAt, text } ] }` |
| `GET /api/tasks` | owner session | every open task in list order: `{ total, tasks: [ { id, title, priority, world, area, xp, doDate, dueDate, oneThing, url, source, asOf } ] }` |
| `GET /api/rules` | owner session | the rules tables as JSON |
| `GET /api/signals` | owner session | the same report as `/api/admin/debug` |
| `POST /api/seen` | owner session | body `{ date? }`: marks `day.lastClose` as seen (default: the last close); `{ "seen": false }` clears the mark. Returns `{ ok, lastClose }` |
| `GET /api/img/<id>` | owner session, TV key or read token | image bytes |
| `GET /healthz` | none | `ok` |
| `/api/share`, `/api/peers…`, `/api/peer/…` | see `MULTIPLAYER.md` | peering between worlds |
