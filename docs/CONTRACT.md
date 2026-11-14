# World of Gun: state contract (v1)

One JSON document, `GET /api/state`, is what every client renders: the web client, a phone app,
a TV screen, a watch, widgets, voice. The engine derives it from an append-only log of real
events (`docs/EVENTS.md`) by replaying the log through the rules in `src/rules.js`. No client
computes a game number itself.

This file is the reference for that document (version 1), for the routes of the worker and for
the live channel. The code that builds the document is `reduce()` in `src/reduce.js`; where this
file and the code disagree, the code is right and this file has a bug.

## Rule zero: reality is the only input

- Nothing in the state is invented. Every metric says where it came from (`source`) and how old
  it is (`asOf`).
- No signal is `null` plus `stale: true`. Clients render that as "no signal", never as zero and
  never as a default number. A bar that has data which has grown old keeps its last value with
  `stale: true`; `null` means there is no data at all.
- XP is only ever granted by an event that came from a device, an account or a record. There is
  no way to claim XP: no button, no route, no event type.
- Manual input exists only where no sensor can see (voice, a keypad, a ring note). It is stored
  with a `source` of `manual` or `manual:<channel>`. Manual facts move meters, needs and the log
  and grant no XP.

## Conventions

- Instants are ISO 8601 in UTC with milliseconds (`"2026-11-13T10:00:00.000Z"`). Dates are
  `YYYY-MM-DD`. `realm.localTime` is the one value written with a local offset.
- A game day has a `date`. It is the wall-calendar date unless "sleep days" are in use (see `day`).
- `img` fields (`inventory.bags[].items[].img`, `equipment[].item.img`, `party[].img`, the log's
  `item.img`) are a URL (`/api/img/<id>`) only when that image is stored in this world, and
  `null` otherwise.
- Ids of the player, the companion and the guild are fixed: `gun`, `companion`, `guild`. The
  player's id stays `gun` whatever the player is called.
- Level numbers: `xp` is XP into the current level and `xpNext` is the size of that level, so
  `xp / xpNext` is the bar. `xpTotal` is lifetime XP. The curves, titles and classes are in
  `GET /api/rules`.
- Money is in USD (`treasury.currency`).

## Top level

| Key | What it is |
|---|---|
| `v` | `1`. |
| `env` | `"production"` or `"qc"` (the sandbox, see "The QC world"). |
| `sandbox` | Present only when `env` is `"qc"`: the sandbox's name (`"qc"`, `"qc-ui"`). |
| `asOf` | When this response was read. |
| `computedAt` | When the reducer last ran. The engine recomputes on every change, and on a read when the cached state is older than 90 seconds. |
| `rules` | The rules version string (`RULES_VERSION` in `src/rules.js`). |
| `realm` | Where the player is, the time there, sun, weather, air, room. |
| `characters` | The character select screen: the roster. |
| `character` | The player's character sheet. |
| `quests` | Main, daily, weekly and side quests. |
| `inventory` | Belongings, in bags. |
| `treasury` | The player's own money. |
| `guild` | The guild's money. |
| `world` | Places visited. |
| `party` | People: contacts, then peer worlds. |
| `companion` | The AI companion and the machines it runs on. |
| `needs`, `needsFocus` | The needs hierarchy and its lowest tier that is not ok. |
| `streaks` | Six streaks with their current and best runs. |
| `agenda` | Calendar events for the next 36 hours. |
| `log`, `logTotal` | The newest 120 log entries, and how many exist. |
| `achievements` | Trophies earned. |
| `day` | The game day in progress, the last one that closed, yesterday. |
| `signals` | Every feed and how fresh it is. |
| `peering`, `squad` | Sharing with peer worlds (`docs/MULTIPLAYER.md`). |

`asOf`, `computedAt`, `realm.localTime` and `realm.sun` are refreshed on every read
(`getState()` in `src/world.js`); everything else is as of `computedAt`.

## `realm`

```jsonc
"realm": {
  "place": "Seabrook", "city": "Seabrook",
  "placeRaw": "Ward Seven",        // the geocoder's name, only when a place.alias event renamed it; else null
  "kind": "home",                  // the kind on the place event or its alias, else null
  "country": "XA", "lat": 10, "lon": 120,
  "tz": "Etc/GMT-8", "tzSource": "place",        // place | open-meteo | device | null
  "localTime": "2026-11-13T18:00:00+08:00",
  "sun": { "altitude": -6.8, "azimuth": 252.8, "phase": "night" },   // night | dawn | day | golden | dusk
  "weather": { "tempC": 29, "feelsC": 33, "humidity": 78, "code": 2, "label": "Partly cloudy",
               "windKph": 10, "isDay": false, "asOf": "2026-11-13T09:50:00.000Z", "stale": false,
               "source": "open-meteo.com" },
  "air": { "usAqi": 40, "pm25": 9, "pm10": 15, "asOf": "2026-11-13T09:50:00.000Z", "source": "open-meteo.com" },
  "room": { "tempC": 26.5, "humidity": 60, "label": "Bedroom", "asOf": "2026-11-13T09:55:00.000Z",
            "stale": false, "source": "room-sensor" },
  "lastSeen": "2026-11-13T09:52:00.000Z", "accuracyM": 12,
  "dayOfLife": 13346,
  "source": "tracker", "since": "2026-11-02T00:00:00.000Z",
  "asOf": "2026-11-13T09:52:00.000Z", "stale": false
}
```

- The current place is the current stay: consecutive `place.arrive` events in the same city, or
  within 5 km of each other, are one stay. `since` is when the stay began. When several reports
  describe one stay, the freshest one supplies `place`, the coordinates, `source` and `accuracyM`.
- `lastSeen` is the newest `lastSeen` among the stay's reports (the tracker's last point there),
  or `null` when none was sent. `asOf` equals it when present, else `since`. `stale` is true
  when there is no place, or when that time is more than 72 hours old.
- With no `place.arrive` event, `place`, `city`, `placeRaw`, `kind`, `country`, `lat`, `lon`,
  `sun`, `weather`, `air`, `lastSeen`, `accuracyM`, `source`, `since` and `asOf` are `null` and
  `stale` is true. `tz` then comes from the device (the `tz` of `steps.day` events, or of a
  `steps` feed snapshot), and is `null` when that is missing too.
- `tzSource`: `place` (the place event carried a zone), `open-meteo` (taken from the weather
  feed), `device`, or `null`.
- `weather` and `air` come from the bundled weather adapter and are `null` until its snapshot is
  for the current place. `weather.stale` is true after 2 hours.
- `room` is the newest `room.climate` reading that names the current city or no place at all
  (any reading when there is no current place), `null` when none exists. `room.stale` is true
  after 2 hours.
- `dayOfLife` counts days since the `birthDate` of the `profile.set` event, `null` without one.

## `characters`

The roster for the character select screen. Exactly one entry is playable.

```jsonc
"characters": [
  { "id": "gun", "kind": "person", "name": "Ash Example", "title": "Initiate", "class": "Seeker",
    "level": 3, "location": "Seabrook", "playable": true,
    "model": "/models/gun.glb", "modelLite": "/models/gun-lite.glb", "portrait": "/img/gun.webp",
    "status": "+72 XP today" },
  { "id": "companion", "kind": "ai", "name": "Companion", "title": "AI companion", "class": "Companion",
    "level": null, "location": null, "playable": false, "status": "2/2 hosts healthy", "state": "ok" },
  { "id": "robin", "kind": "person", "name": "Robin Vale", "title": "Party member", "class": "Party",
    "level": null, "location": null, "playable": false, "status": null },
  { "id": "guild", "kind": "guild", "name": "Guild", "title": "Guild", "class": "Guild",
    "level": null, "location": null, "playable": false, "status": "Treasury $10,000 · 1 accounts",
    "treasury": 10000 },
  { "id": "ines-park", "kind": "person", "name": "Ines Park", "title": "Squad member", "class": "Squad",
    "level": null, "location": "Pinehill", "playable": false,
    "portrait": "/api/img/party-ines-park", "status": "last contact 4 h ago" }
]
```

Every entry has `id`, `kind` (`person` | `ai` | `guild`), `name`, `title`, `class`, `level`,
`location`, `playable` and `status` (one line of real status, or `null`). The order is fixed:

1. `gun`, the player. `name` comes from a `profile.set` event, else from the `OWNER_NAME` var
   (default "Player"). `title` is the rank for the level, `class` follows the attribute with the
   most XP (`null` before any XP). The only entry with `playable: true` and a numeric `level`.
2. `companion`, the AI companion. `name` is the `COMPANION_NAME` var. `location` is the `where`
   of the fleet host whose id is `companion`. It adds `state` (`ok` | `warn` | `down` | `null`,
   the same value as `companion.status`).
3. Partners: each contact whose `role` is `partner` (at most 3, by contact id) joins under its
   own contact id, with `title: "Party member"` and `class: "Party"`. With no such contact there
   is no partner entry.
4. `guild`. `name` is the `GUILD_NAME` var. It adds `treasury` (the same number as
   `guild.total`, `null` until a guild balance arrives).
5. The squad: contacts in the `squad` view that have a stored portrait (at most 12, in `party`
   order), with `title: "Squad member"` and `class: "Squad"`. A squad contact without a stored
   portrait stays in `party[]` only.

File fields appear only when the file is in the deployed static assets; otherwise the key is
omitted, not `null`:

| Field | File |
|---|---|
| `model` | `/models/<id>.glb` |
| `modelLite` | `/models/<id>-lite.glb` |
| `portrait` | `/img/<id>.webp` |
| `portraitFull` | `/img/<id>-full.webp` |

- The player, the companion, the guild and partners may have all four.
- A partner's `portrait` is the contact's stored image (the contact's `img`, an id in this
  world's image store) when it exists. It wins over a static file.
- A squad member's `portrait` is always the stored image. `model` and `modelLite` ride along
  when `/models/<contactId>.glb` and `-lite.glb` are deployed; the engine looks for them for
  contacts whose stored portrait is named `party-<contactId>` (up to 24). A static portrait is
  never named for a squad member.
- The engine checks the static assets when it starts after a deploy and at most every 5 minutes
  after that. `modelLite` is a lighter build of the same model for small devices. An entry with
  no `model` has none: the client draws its own stand-in.

## `character`

```jsonc
"character": {
  "id": "gun", "name": "Ash Example", "title": "Initiate", "class": "Seeker",
  "level": 3, "xp": 42, "xpNext": 180, "xpTotal": 282, "xpToday": 72,
  "readiness": { "score": 92, "multiplier": 1.21, "parts": { "sleep": 92, "hrv": null, "rhr": null } },
  "activity": { ... }, "vitals": [ ... ], "meters": [ ... ], "attributes": [ ... ],
  "buffs": [ ... ], "equipment": [ ... ], "body": { ... },
  "streaks": { "steps": 1, "sleep": 1, "protein": 0 }
}
```

`xpToday` counts everything since the game day began. `streaks` holds the current length of the
step-goal, sleep and protein streaks (the full list is the top-level `streaks`).

### `readiness`

`{ score, multiplier, parts: { sleep, hrv, rhr } }`. `score` is 0..100 or `null`; each part is
0..100 or `null`. `multiplier` is the day's XP multiplier, x0.75 at 0, x1 at 50, x1.25 at 100,
and exactly 1 when `score` is `null`. XP caps apply to base XP, before the multiplier
(`GET /api/rules`: `xp[].cap`, `xp[].capAtFullReadiness`, `xpCaps`).

### `activity`

The activity mirror: what the player is doing right now, for the character on the stage.

```jsonc
"activity": { "name": "walking", "since": "2026-11-13T09:40:00.000Z", "until": null,
              "basis": "620 steps at about 95 a minute, samples up to 17:52",
              "source": "steps", "asOf": "2026-11-13T09:52:00.000Z", "inferred": false }
```

- `name`: `idle` | `walking` | `training` | `sleeping` | `working` | `eating` | `celebrating`,
  or `null` when the feeds are too old to say anything. The object is always present.
- `basis` is a plain sentence naming the evidence. `until` is when the current evidence runs
  out (`null` when open-ended).
- `inferred` is true only on `sleeping` deduced from the sleep pattern plus stillness. Show it
  as "probably asleep".
- The order of evidence and the thresholds are in `docs/EVENTS.md` (activity mirror) and
  `ACTIVITY` in `src/rules.js`. Without the optional `steps` and `food` feed snapshots the
  mirror says only what is stated, recorded or running.

### `vitals[]`

Six bars, in this order: `health`, `energy`, `stamina`, `fuel`, `focus`, `gold`.

```jsonc
{ "id": "stamina", "label": "Stamina", "value": 74, "cur": 7400, "max": 10000, "unit": "steps",
  "display": "7,400", "detail": "goal 10,000 · 7-day avg 9,800", "trend": "flat",
  "source": "steps", "asOf": "2026-11-13T09:52:00.000Z", "stale": false }
```

`value` is 0..100 or `null`. `cur` and `max` are the raw numbers behind it, `display` and
`detail` are ready-made text, `trend` is `up` | `down` | `flat`. With no data: `value`, `cur`,
`display`, `source` and `asOf` are `null` and `stale` is true (`max`, `unit` and `detail` may
still be set). A bar can have raw numbers and still no value (fuel on a day without a target,
gold without a burn figure): `value` is then `null` and `stale` is true.

| id | `value` | `cur` / `max` / `unit` | Extra |
|---|---|---|---|
| `health` | Seven-day picture of sleep, HRV, resting HR, movement and fuel; needs two parts | value / 100 / "" | `parts { sleep, hrv, rhr, move, fuel }` |
| `energy` | Today's readiness score | value / 100 / "" | `parts { sleep, hrv, rhr }` |
| `stamina` | Steps today against the step goal | steps / goal / "steps" | |
| `fuel` | Today against the food target (`null` when the day has no target) | kcal / target kcal / "kcal" | |
| `focus` | Timed focus minutes today against 180 | minutes / 180 / "min" | |
| `gold` | Runway in days against 180 | runway days / 180 / "days" | `display` leads with the gold amount |

### `meters[]`

Nine quick-glance percentage bars, always in this order: `money`, `energy`, `sleep`, `social`,
`care`, `happiness`, `self`, `giving`, `learning`. Same shape as a vital, with `cur` equal to
`value`, `max: 100`, `unit: "%"` and `trend: "flat"`.

```jsonc
{ "id": "sleep", "label": "Sleep", "value": 95, "cur": 95, "max": 100, "unit": "%",
  "display": "7h 36m", "detail": "7h 36m of 8h · 1h 36m deep", "trend": "flat",
  "source": "health-db", "asOf": "2026-11-13T10:00:00.000Z", "stale": false,
  "hours": 7.6, "deepHours": 1.6 }
```

With no data a meter has `value: null`, `display: null`, `source: null`, `asOf: null`,
`stale: true`, and `detail` holds the meter's caption (for example `"cashflow"`). The `sleep`
meter adds `hours` and `deepHours`; the `care` meter adds `parts { weigh, workout, protein, kcal }`.
Formulas and numbers: `meters` in `GET /api/rules`.

### `attributes[]`

Ten slow stats, the areas of life, in this order: `strategy`, `body`, `mind`, `things`,
`people`, `joy`, `wealth`, `connection`, `growth`, `impact`.

```jsonc
{ "id": "body", "label": "Body", "level": 3, "xp": 40, "xpNext": 100, "xpTotal": 165, "xp7d": 120,
  "top": ["Workout done", "11,200 steps · goal reached"],
  "source": "xp ledger", "asOf": "2026-11-13T09:30:00.000Z" }
```

`xp7d` is the XP earned in the area over the last 7 days, `top` the texts of up to three of
that week's largest grants, `asOf` the time of the last XP in the area (`null` when none).

### `buffs[]`

Active buffs and debuffs, evaluated on today's facts.

```jsonc
{ "id": "well-rested", "kind": "buff", "label": "Well rested", "detail": "7h 36m last night",
  "icon": "moon", "since": null, "until": "2026-11-13T15:59:59.000Z",
  "source": "engine: 7.5 h or more last night" }
```

`kind` is `buff` | `debuff`. `until` is the end of the game day unless the rule sets its own;
`since` is `null` unless the rule sets one. The full list (ids, labels, icons, rules) is `buffs`
in `GET /api/rules`. The two BTC buffs (`bull-run`, `crypto-winter`) need a `btc` feed.

### `equipment[]`

The paper doll: always thirteen entries, in this order: `head`, `chest`, `legs`, `feet`,
`wrist`, `finger`, `back`, `neck`, `mainhand`, `offhand`, `trinket1`, `trinket2`, `vehicle`.

```jsonc
"equipment": [
  { "slot": "wrist", "item": { "id": "item-0123456789ab", "name": "Field watch", "img": null,
      "cat": "device", "slot": "wrist", "rarity": "rare", "qty": 1, "valueUsd": 300,
      "brand": null, "size": null, "detail": null, "equipped": true, "assumed": false,
      "bagId": null, "legacy": false, "source": "inventory", "asOf": "2026-11-03T10:00:00.000Z",
      "equipSource": "manual:voice", "equipAsOf": "2026-11-12T01:00:00.000Z" } },
  { "slot": "vehicle", "item": { "quest": "Send the quarterly report", "detail": "Touring bicycle",
      "wish": "Touring bicycle", "questId": "task:task-0001", "questDone": false,
      "valueUsd": null, "url": null, "source": "inventory", "asOf": "2026-11-13T01:00:00.000Z" } },
  { "slot": "head", "item": null }
]
```

`item` is one of three things:

- A real item, in the inventory item shape (below) plus `equipSource` and `equipAsOf`.
  An `item.equip` event (a confirmation, manual or from a sensor) decides what is worn; without
  one, the record's own `equipped` flag stands and `assumed` is true when the record said so.
  One item per slot: a confirmed item displaces a guess.
- A locked slot waiting on a quest, from an `item.wish` event: `{ quest, detail, wish, questId,
  questDone, valueUsd, url, source, asOf }`. It has no `id` and no `name`, which is how a client
  tells it from an item. `questDone` is `null` when `questId` names no known task.
- `null`: nothing there, and nothing declared. The engine never invents a wish.

### `body`

```jsonc
"body": {
  "weightKg": 84.2, "bodyFatPct": 22, "leanMassKg": null, "bmi": null, "weighedOn": "2026-11-13",
  "rhr": 56, "hrv": 62, "heartOn": "2026-11-13",
  "goal": { "weightKg": 80, "bodyFatPct": 18, "source": "manual:keypad", "asOf": "2026-11-01T01:00:00.000Z" },
  "source": "health-db", "asOf": "2026-11-13T10:00:00.000Z",
  "prov": { "weightKg": { "source": "health-db", "asOf": "2026-11-13T10:00:00.000Z" },
            "bodyFatPct": { "source": "health-db", "asOf": "2026-11-13T10:00:00.000Z" },
            "leanMassKg": null, "bmi": null,
            "rhr": { "source": "health-db", "asOf": "2026-11-13T10:00:00.000Z" },
            "hrv": { "source": "health-db", "asOf": "2026-11-13T10:00:00.000Z" } },
  "history": [ { "d": "2026-11-13", "w": 84.2, "bf": 22 } ]
}
```

Each number is the newest reading on record (`weighedOn` and `heartOn` say from which day), or
`null`. `goal` is the `body.goal` event, `null` without one. `prov` gives the source and time of
each number separately (`null` where the number is `null`). `history` holds up to 180 days that
have a weight, oldest first; `bf` is `null` on days without body fat.

## `quests`

```jsonc
"quests": {
  "main": { ... }, "daily": [ ... ], "weekly": [ ... ], "side": [ ... ],
  "openTasks": 5, "openTasksShown": 5, "sideTotal": 13, "sideShown": 13, "sideCut": false
}
```

Every quest has `id`, `title`, `text`, `giver`, `area`, `category`, `xp`, `state`, `source` and
`progress`: `{ cur, max, unit, pct }` with `pct` 0..100, or `null`. Engine quests also have
`tier` (the needs tier they serve). `state` is `active` | `done` | `nosignal`; `nosignal` means
the feed that would complete the quest is missing, and `progress` is then `null`.

### `main`

```jsonc
"main": {
  "id": "main", "title": "Build the Rainy-Day Fund", "text": "Six months of living costs in a separate account.",
  "giver": "The realm", "area": "wealth", "category": "Wealth", "tier": 2,
  "oneThing": { "title": "Build the Rainy-Day Fund", "period": "2027-H1", "due": "2027-06-30",
                "next": { "date": "2027-01-15", "target": 3000, "label": null } },
  "progress": { "cur": 1800, "max": 9000, "unit": "USD", "pct": 20 },
  "steps": [ { "title": "$3,000 by 2027-01-15", "done": false, "date": "2027-01-15", "target": 3000, "missed": false },
             { "title": "$5,000 by 2027-03-12", "done": false, "date": "2027-03-12", "target": 5000, "missed": false }
             /* then 7,000 and 9,000 */ ],
  "state": "active", "xp": 5000, "source": "scoreboard", "asOf": "2026-11-13", "stale": false
}
```

- `id` is always `"main"`. `title` and `text` come from the newest `quest.progress` event; until
  one supplies them they are "Main quest" and a sentence saying to report it with
  `quest.progress` events.
- `oneThing` and `progress` are `null`, and `steps` is empty, until a `quest.progress` event
  arrives. `oneThing.title` is the event's `title`, else the target as a number. `oneThing.next`
  is the next anchor not yet reached (`null` when none is left).
- `steps[]` are the anchors: `done` when the anchor's target was reached on or before its date,
  `missed` when the date has passed without it. Each anchor reached is worth 500 XP; `xp` is the
  5,000 XP for reaching the target.
- `state` is `active` or `done`. `asOf` is the date of the newest progress event; `stale` is
  true when there is none or it is more than 2 days old.

### `daily[]`

Seven quests that complete from data: `walk`, `rest`, `protein`, `kcal`, `one-thing`,
`clear-a-quest`, `reach-out`.

```jsonc
{ "id": "walk", "title": "Walk the realm", "text": "Reach the step goal.", "giver": "The realm",
  "area": "body", "category": "Health", "tier": 1, "xp": 15, "source": "engine",
  "progress": { "cur": 7400, "max": 10000, "unit": "steps", "pct": 74 },
  "state": "active", "note": null, "xpNow": 18, "signal": "steps" }
```

`xp` is the base reward and `xpNow` what it pays at today's readiness multiplier. `signal`
names the kind of data the quest reads. `note` is set on a quest that only settles when the day
ends (`kcal`), `null` otherwise.

### `weekly[]`

Nine quests, Monday to Sunday: `iron-week`, `long-road`, `sleep-bank`, `fuel-discipline`,
`on-the-scale`, `treasury-grows`, `ship-it`, `tend-the-network`, `new-ground`. Same shape as a
daily quest without `xpNow`, plus `week` (the Monday) and `ends` (the Sunday).

### `side[]`

Rebuild quests first, then open tasks.

```jsonc
{ "id": "rebuild:water:seabrook|XA:2026-11-02", "kind": "rebuild", "title": "Secure drinking water",
  "text": "Drinking water in Seabrook. Settle it with a need.ok event (voice).", "giver": "Seabrook",
  "area": "body", "category": "Health", "tier": 1, "order": 1,
  "progress": { "cur": 0, "max": 1, "unit": "", "pct": 0 }, "state": "active", "detail": null,
  "xp": 20, "source": "engine", "next": true },

{ "id": "task:task-0001", "kind": "task", "title": "Send the quarterly report", "text": "High · Work",
  "priority": "High", "world": "Work", "giver": "Work", "area": "wealth", "category": "Wealth",
  "progress": { "cur": 0, "max": 1, "unit": "", "pct": 0 }, "state": "active", "xp": 30,
  "doDate": null, "dueDate": "2026-11-16", "oneThing": false, "url": null, "source": "task-list" }
```

- `kind: "rebuild"`: the eight place needs of the current stay (water, food supply, air, gym,
  accommodation, visa, internet, laundry), in that order (`order` 1..8). They exist only while
  there is a current place. `state` is `active` or `done`; the first one not done carries
  `next: true` (the key is absent on the others). `xp` is 20 when the need completes from data
  and 0 when it was settled by a manual `need.ok`.
- `kind: "task"`: open tasks, in priority order (the One Thing, then high, medium, the rest;
  then by do or due date). `priority` and `world` are the task's own fields or `null`; `giver`
  is the task's `world`, else "Tasks"; `area` and `category` are `null` when the task names no
  area. Task entries have no `tier`.

### Counters

| Key | Meaning |
|---|---|
| `openTasks` | Every open task. |
| `openTasksShown` | Open tasks carried in `side` (at most 100). |
| `sideTotal` | Rebuild quests plus every open task. |
| `sideShown` | `side.length`. |
| `sideCut` | True when there are more than 100 open tasks. The lowest-priority ones are left out of `side`; `GET /api/tasks` has them all. |

## `inventory`

```jsonc
"inventory": {
  "count": 5, "value": 3430,
  "bags": [
    { "id": "travel-backpack", "name": "Travel backpack", "location": "On me", "parent": null,
      "itemId": "item-0123456789ab", "kind": "container",
      "items": [ { "id": "item-0123456789ac", "name": "Cable pouch", "img": "/api/img/item-0123456789ac",
                   "cat": "bag", "slot": null, "rarity": "common", "qty": 1, "valueUsd": 20,
                   "brand": null, "size": null, "detail": null, "equipped": false, "assumed": false,
                   "bagId": "cable-pouch", "legacy": false, "source": "inventory",
                   "asOf": "2026-11-03T10:00:00.000Z" } ] }
  ]
}
```

- `count` is the number of things (quantities summed). `value` is their total value in USD,
  `null` until at least one item has a value. Items whose status is sold, donated, given,
  discarded, gone or lost are not in the inventory.
- A bag: `id`, `name`, `location`, `items[]`, and
  - `kind`: `container` (a bag that is itself an item, or one named by the items in it),
    `location` (items grouped by where they are) or `unsorted`;
  - `itemId`: the container item, when the bag is one, else `null`;
  - `parent`: the id of the outer bag, for a container inside a container, else `null`.
- An item: `id`, `name`, `img`, `cat`, `slot` (one of the equipment slots or `null`), `rarity`
  (`common` | `uncommon` | `rare` | `epic` | `legendary`; the record's own, else by value),
  `qty`, `valueUsd`, `brand`, `size`, `detail`, `equipped` (true when it is the item in its
  slot), `assumed` (worn, but only on the record's say-so), `bagId` (the bag this item opens,
  when it is a container), `legacy`, `source`, `asOf`. A worn item adds `equipSource` and
  `equipAsOf`.

## `treasury`

The player's own money: balances and transactions with no `owner`, or `owner: "gun"`.

```jsonc
"treasury": {
  "currency": "USD",
  "gold": { "value": 5200, "detail": "1 accounts", "source": "money.balance",
            "asOf": "2026-11-13T01:45:00.000Z", "stale": false },
  "runway": { "days": 65, "burnPerDay": 80.49, "method": "budget on file: fixed costs $2,450 a month",
              "incomePerMonth": 4333.33, "incomeMethod": "budget on file: $2,000 a fortnight" },
  "budget": { "incomePerFortnight": 2000, "fixedPerMonth": 2450, "source": "ledger" },
  "accounts": [ { "id": "•••• 6819", "name": "Example Bank (•••• 6819)", "kind": "cash", "value": 5200,
                  "currency": "USD", "native": null, "institution": "Example Bank",
                  "asOf": "2026-11-13", "stale": false, "source": "bank-feed" } ],
  "income": [ { "name": "Salary (budget on file)", "period": "fortnight", "value": 2000,
                "source": "ledger", "asOf": "2026-11-13T01:45:00.000Z" },
              { "name": "Client payment", "period": "last 30 days", "value": 1500, "payments": 1,
                "source": "bank-feed", "asOf": "2026-11-10T04:00:00.000Z" } ],
  "btc": null,
  "history": [ { "d": "2026-11-13", "gold": 5200 } ]
}
```

- `gold.value` is cash plus crypto minus debt, over accounts that are not stale; `null` (with
  `stale: true`) until a balance arrives. `gold.stale` is also true when the newest money event
  is more than 48 hours old.
- `runway`: `days` is `null` until there is both gold and a burn figure; `burnPerDay` and
  `incomePerMonth` are `null` until a figure exists. `method` and `incomeMethod` say in words
  where the numbers come from.
- `budget` is the `money.budget` event, `null` without one.
- `accounts[]`: `kind` is `cash` | `crypto` | `debt` | `asset` (an `asset` is shown and not
  counted as gold). `value` is in USD; `currency` and `native` are the account's own currency
  and the amount in it, as sent. `asOf` is the date of the newest snapshot; `stale` is true when
  it is more than 4 days old, and the account then drops out of gold.
- `income[]`: the budget's income (`period: "fortnight"`), then one entry per income name
  received in the last 30 days, with `payments` (how many).
- `btc` is `null` unless a `btc` feed adapter exists (none is bundled). With one:
  `{ price, drawdownPct, phase, phaseDays, ath, athDate, change24hPct, mayer, daysSinceTop,
  onchain, source, asOf, stale }`, `phase` being `bull` | `bear`.
- `history[]`: gold per day for the last 90 days, oldest first, days without a figure left out.

## `guild`

The guild (a company, a team, a household): `money.balance` events with `owner: "guild"`. It is
never part of the player's gold, runway or income XP. Balances with any other `owner` are
stored and shown nowhere.

```jsonc
"guild": { "id": "guild", "name": "Guild", "currency": "USD", "total": 10000,
           "accounts": [ { ...same shape as treasury.accounts[]... } ], "staleAccounts": [],
           "detail": "1 accounts", "source": "money.balance (owner guild)",
           "asOf": "2026-11-13T04:00:00.000Z", "stale": false }
```

`total` is `null` until a guild balance arrives. `staleAccounts` lists the names of accounts
left out because their newest snapshot is too old.

## `world`

```jsonc
"world": {
  "current": { "name": "Seabrook", "lat": 10, "lon": 120, "country": "XA", "since": "2026-11-02T00:00:00.000Z" },
  "places": [ { "name": "Seabrook", "city": "Seabrook", "country": "XA", "lat": 10, "lon": 120,
                "kind": "home", "visits": 1, "first": "2026-11-02T00:00:00.000Z",
                "last": "2026-11-02T00:00:00.000Z", "nights": 0 },
              { "name": "Rivermouth", "city": "Rivermouth", "country": "XB", "lat": 20, "lon": 100,
                "kind": "city", "visits": 1, "first": "2026-09-14T03:00:00.000Z",
                "last": "2026-10-01T03:00:00.000Z", "nights": 17 } ],
  "countries": 2, "distanceKm": 2415
}
```

`current` is `null` with no place. `places` is every place on record, most recently visited
first; `nights` counts the nights of stays that have an end (`place.stay` events). `distanceKm`
is the straight-line distance between consecutive different places, `null` until there are two.

## `party`

People. The order is: partners (contacts whose `role` is `partner`, at most 3), then every
other contact that was sent (most recent contact first, at most 300), then peer worlds (by
name). Nobody is assumed: with no contacts and no peers the list is empty.

```jsonc
"party": [
  { "id": "robin", "name": "Robin Vale", "role": "partner", "views": ["party"], "bond": null,
    "location": null, "lastContact": null, "lastPosted": null, "strengths": null, "weaknesses": null,
    "supportThem": null, "supportMe": null, "img": null, "likeness": null, "source": "crm",
    "asOf": null, "touchDays30": null },

  { "id": "ines-park", "name": "Ines Park", "role": "friend", "views": ["squad", "bookclub"], "bond": 70,
    "location": "Pinehill", "lastContact": "2026-11-13T06:00:00.000Z", "lastPosted": null,
    "strengths": null, "weaknesses": null, "supportThem": null, "supportMe": null,
    "img": "/api/img/party-ines-park",
    "likeness": { "assumed": true, "basis": "4 photos", "generated": "2026-11-10" },
    "source": "crm", "asOf": "2026-11-13T06:00:00.000Z", "touchDays30": 2,
    "wardrobe": [ { "name": "Green rain jacket", "cat": "clothes", "slot": "chest", "seen": 3,
                    "last": "2026-11-09", "assumed": true } ] },

  { "id": "peer:0123456789abcdef", "name": "Kai", "role": "peer", "views": ["squad"], "bond": null,
    "location": "Rivermouth", "lastContact": null, "lastPosted": null, "strengths": null,
    "weaknesses": null, "supportThem": null, "supportMe": null, "img": null,
    "source": "peer.card", "asOf": "2026-11-13T09:50:00.000Z", "touchDays30": null,
    "peer": { "id": "0123456789abcdef", "world": "Kai", "url": "https://kai.example.org", "sandbox": null,
              "receivedAt": "2026-11-13T09:50:00.000Z", "cardAt": "2026-11-13T09:49:00.000Z",
              "fields": ["name", "level", "place", "stepsGoal"] },
    "shared": { "name": "Kai", "level": 7, "place": "Rivermouth", "stepsGoal": null } }
]
```

Contact entries (from `contact.upsert` and `contact.touch` events):

- `role` is the contact's role in lowercase, or `null`. `views` are the lists the person is in
  (a person can be in several).
- `lastContact` is the newest of the last `contact.touch` and the `lastContact` the contact
  record carried. `asOf` is the same time. `touchDays30` is the number of days in touch in the
  last 30.
- `bond` is 0..100, built only from days actually in touch in the last 30 (recency and
  frequency). With none in that window it is `null`, never a low number.
- Partner rule: for `role: "partner"`, `bond`, `lastContact`, `asOf` and `touchDays30` are
  always `null`. Message recency is not a signal for people who live together.
- `likeness` is `null`, or `{ assumed, basis, generated }` when the portrait was generated: a
  guess until the owner confirms it (`assumed: false`), what it was made from, and the date.
- `wardrobe` is present only when the `contact.upsert` carried one: at most 40 entries of
  `{ name, cat, slot, seen, last, assumed }` (`slot` is an equipment slot or `null`, `seen` a
  count, `last` a date, `assumed` true unless the sender said otherwise). The engine passes it
  through sanitised and never derives it. Outfits painted on the player's 3D body are a
  client-side feature and are not part of the state.

Peer entries (a presence card received from another world):

- `id` is `peer:<pair id>`, `role` is `peer`, `views` is `["squad"]`, `source` is `peer.card`.
  There is no `likeness` key.
- `peer`: `{ id, world, url, sandbox, receivedAt, cardAt, fields }`, where the card came from
  and which fields it carried.
- `shared` holds exactly the fields the other owner shared. A field that is present and `null`
  was shared and has no signal there; an absent field was not shared.
- `name` is the shared name, else the peer world's name. `location` is set only when `place`
  was shared.

## `companion`

```jsonc
"companion": {
  "name": "Companion", "status": "ok", "headline": "all systems healthy",
  "hosts": [ { "id": "companion", "name": "Home server", "where": "Seabrook · closet", "state": "ok",
               "detail": "all good", "lastSeen": "2026-11-13T09:58:00.000Z", "metrics": null,
               "source": "fleet", "asOf": "2026-11-13T09:58:00.000Z" } ],
  "statsSource": "companion", "statsAsOf": "2026-11-13T09:55:00.000Z",
  "office": { "label": "Office", "tempC": 24, "humidity": 55, "asOf": "2026-11-13T09:55:00.000Z", "stale": false },
  "skills": 10, "automations": 20, "automationRuns": { "ok": 100, "fail": 1 }, "sessionsToday": 3,
  "mana": { "value": 75, "detail": "plan usage 25%" },
  "source": "fleet", "asOf": "2026-11-13T10:00:00.000Z", "stale": false
}
```

- `name` is the `COMPANION_NAME` var.
- `status` (`ok` | `warn` | `down`), `headline`, `hosts[]` and `office` come from the snapshot
  of the `fleet` adapter (a status page of your own, `FLEET_STATUS_URL`). Without it `status`
  and `headline` are `null`, `hosts` is empty, `office` is `null` and `stale` is true. `stale`
  is also true when the status page's own timestamp is more than 30 minutes old.
- `office` is the status page's climate block; `label` defaults to "Office".
- `skills`, `automations`, `automationRuns`, `sessionsToday` and `mana` come from
  `companion.stats` events (`statsSource`, `statsAsOf`), and are `null` when there is none from
  the last two days. `sessionsToday` is set only when the stats are dated `day.calendarDate`.
  `mana.value` is 100 minus the plan usage percentage.

## `needs`, `needsFocus`

The needs hierarchy: eight tiers, deficiency needs first, growth needs after.

```jsonc
"needs": [
  { "tier": 1, "label": "Biological", "kind": "deficiency", "unlocked": true, "status": "warn",
    "items": [ { "label": "Sleep", "state": "ok", "detail": "7h 04m average, 7 nights", "source": "sleep" },
               { "label": "Drinking water", "state": "unknown", "detail": null, "source": null,
                 "place": "Seabrook", "need": "water" } ] }
],
"needsFocus": { "tier": 1, "label": "Biological", "status": "warn" }
```

- Tiers: 1 Biological, 2 Safety and Freedom, 3 Love and Belonging, 4 Esteem (`deficiency`);
  5 Cognitive, 6 Aesthetic, 7 Self-Actualisation, 8 Transcendence (`growth`).
- An item's `state` is `ok` | `warn` | `bad` | `unknown`. The place needs of the current stay
  are added to tiers 1 and 2 and carry `place` (the city) and `need` (the need's id).
- A tier's `status` is `ok` | `warn` | `bad` | `unknown`: `bad` if any item is bad, `warn` if
  any is warn or a place need is still unknown, `unknown` when no item has a signal.
- `unlocked` is true only when every tier below is `ok` or `warn`. Unknown does not unlock.
- `needsFocus` is the lowest tier whose status is not `ok`, or `null` when all are.

## `streaks`

Six entries: `steps-goal`, `protein`, `diary`, `sleep` (daily), `workouts-week`, `weigh-ins`
(weekly, Monday to Sunday).

```jsonc
{ "id": "steps-goal", "label": "Step goal", "unit": "days", "period": "day", "current": 4, "best": 4,
  "bestEnded": "2026-11-12", "lastDate": "2026-11-12", "hitThisPeriod": false, "alive": true,
  "rule": "steps at or over the goal" }
```

`current` is the run in progress, `best` the longest and `bestEnded` the last day (or week
start) of it. `hitThisPeriod` says whether today (or this week) already counts. The day or week
in progress never breaks a run; a finished day with no data does.

## `agenda`

`[ { id, title, start, end, calendar } ]`: `calendar.event` events that start between one hour
ago and 36 hours from now, soonest first, at most 20.

## `log`, `logTotal`

The combat log: real events and what the engine derived from them, newest first. The state
carries the newest 120 entries; `logTotal` is how many exist. The rest is paged at
`GET /api/log?limit=<n>&cursor=<next>` (`{ total, entries, next }`, `limit` up to 500).

```jsonc
{ "id": "log:sleep:2026-11-13", "ts": "2026-11-13T01:30:00.000Z", "type": "sleep",
  "text": "Slept 7h 36m · 1h 36m deep", "xp": { "area": "body", "amount": 23 }, "icon": "moon",
  "source": "health-db", "mult": 1.21,
  "grants": [ { "rule": "sleep", "area": "body", "base": 15, "amount": 18 },
              { "rule": "deep", "area": "body", "base": 4, "amount": 5 } ] }
```

Every entry has `id`, `ts`, `type`, `text`, `xp`, `icon` and `source`. `xp` is `null`, or
`{ area, amount }` where `amount` is the entry's total and `area` the area of its largest grant.
An entry with XP also carries `mult` (the day's readiness multiplier) and `grants[]`
(`{ rule, area, base, amount }`, `base` being after the cap and before the multiplier). There
are no separate XP entries: XP is on the entry that earned it.

| `type` | `id` | Extra fields |
|---|---|---|
| `steps`, `sleep`, `meal`, `workout`, `weigh` | `log:<type>:<date>` | A workout's `text` may name the recorded sessions (kind, minutes, kcal). |
| `health` | `log:exercise:<date>` | Exercise minutes. |
| `focus`, `mindful`, `learn` | `log:<type>:<date>` | |
| `giving` | `log:support:<date>` | |
| `checkin` | `log:checkin:<event id>` | Never XP. |
| `task` | `log:task:<taskId>`, `log:checklist:<date>` | |
| `money` | `log:income:<event id>` | Income received by the player. |
| `travel` | `log:arrive:<event id>`, `log:place:<place>`, `log:country:<code>` | |
| `item` | `log:item:<itemId>`, `log:item-out:<itemId>` | `item { id, name, rarity, img }` on a new item. |
| `contact` | `log:touch:<date>:<contactId>` | At most six a day. |
| `note` | `log:note:<event id>` | Never XP. |
| `system` | `log:system:<event id>` | `severity` (`warn` | `bad`) when the status is not ok. |
| `quest` | `quest.done:daily:<quest>:<date>`, `quest.done:weekly:<quest>:<monday>`, `quest.done:main:anchor:<date>`, `quest.done:main`, `quest.done:rebuild:...` | `title`. |
| `level` | `level.up:<n>` | `level` (a number), `title` (the rank). |
| `attribute` | `level.up:<area>:<n>` | `level`, `area`, `title` (the area's label). |
| `achievement` | `achievement:<id>` | `title`, `achievement { id, title, detail, rarity }`. |
| `day` | `day.close:<date>` | `title` ("Day closed"), `day` (the summary below). |

- The log is in time order. Quest completions, level-ups and achievements keep the time the
  engine first saw them.
- A `day` entry is written for each finished game day on which something was measured. Its
  `day` field is `{ date, grade, xp, xpByArea, readiness, multiplier, questsDone, questsTotal,
  quests: [ { id, title, done } ], streaks: [ ... ], notable: [ ... ] }`. A `streaks` entry is
  `{ id, label, state, unit }` with `state` `started` | `kept` | `broken`, plus `length` (the
  run now) or, when broken, `was` (the run that ended). `GET /api/days` lists these summaries.

## `achievements`

`[ { id, title, detail, date, rarity } ]`, newest first. Trophies only: no XP. The full list
and what each watches is `achievements` in `GET /api/rules`.

## `day`

```jsonc
"day": {
  "date": "2026-11-13", "calendarDate": "2026-11-13", "basis": "calendar", "endsAt": null,
  "n": 12, "xp": 72, "questsDone": 2, "questsTotal": 5, "grade": "C",
  "readiness": 92, "xpMultiplier": 1.21,
  "lastClose": {
    "date": "2026-11-12", "grade": "C", "xp": 26, "questsDone": 1, "questsTotal": 2,
    "completed": ["Walk the realm"], "missed": ["Reach out"],
    "streaks": [ { "id": "steps-goal", "label": "Step goal", "state": "started", "length": 1, "unit": "days" } ],
    "notable": ["Achievement: First steps · The first day of steps on record"],
    "closedAt": "2026-11-12T15:59:59.500Z", "text": "Day closed: grade C · 26 XP · 1 of 2 quests",
    "speech": "Your last day closed at grade C, with 26 experience earned. You completed Walk the realm, and missed Reach out.",
    "seen": false, "seenAt": null },
  "yesterday": { "date": "2026-11-12", "questsDone": 1, "questsTotal": 2, "grade": "C", "xp": 26 }
}
```

- `basis` is `"calendar"` or `"sleep-day (day.start events)"`. With sleep days the game day
  ends when the player sleeps, not at midnight: `date` is the game day's label, `calendarDate`
  the wall-calendar date, and `endsAt` the known end of the game day (`null` on calendar days
  and when the end is not known yet). The boundaries are `day.start` events in the log.
- `n` is the number of days since the first day on record (`null` with an empty log). `xp` is
  everything earned since the game day began. `questsTotal` counts the daily quests that have a
  signal today.
- `grade` is `S` | `A` | `B` | `C` | `D` | `F`, and `null` until something is done today.
- `lastClose` is the most recent finished game day, `null` before any day has closed. `speech`
  is that day's evening brief in plain words. `seen` is false until the client calls
  `POST /api/seen` (optional body `{ "date": "YYYY-MM-DD" }`), and false again once the next day
  closes; `{ "seen": false }` clears the mark. The mark is UI state kept beside the log, not an
  event.
- `yesterday` is `null` when the previous game day has no record.

## `signals`

What feeds exist and how fresh each is, so nothing is silently dead.

```jsonc
{ "id": "steps", "label": "Steps", "state": "live", "asOf": "2026-11-13T09:56:00.000Z",
  "checkedAt": "2026-11-13T10:00:00.000Z", "device": "step counter (watch or phone)", "via": "edge+push" }
```

- `state`: `live` | `stale` | `off`. `off` means the feed has never delivered (or its only
  facts were withdrawn); `weather` and `air` are `off` until a place is known. `asOf` is the
  newest datum; `checkedAt` the last successful poll or push.
- `via`: `edge` (an adapter inside the worker, `src/adapters.js`), `push` (events sent to
  `/api/ingest`, `/api/phone` or `/api/act`), or `edge+push` (live from either).
- `device` is a plain description of the source. Change the texts in `SIGNALS` (`src/rules.js`)
  to name your own.
- A failing adapter adds `error` and `fails`. An adapter may add `note`; `weather` and `air`
  carry a note while they wait for a first place.
- Ids, in order: `steps`, `sleep`, `food`, `workouts`, `scale`, `health`, `weight`, `btc`,
  `fleet`, `office`, `place`, `weather`, `room`, `money`, `mainquest`, `tasks`, `calendar`,
  `inventory`, `contacts`, `companion`, `focus`, `air`, `mood`, `mindful`, `giving`, `learning`,
  `placeneeds`, `profile`.

## `peering`, `squad`

Sharing with other worlds, each run by its own owner. Design, handshake and routes:
`docs/MULTIPLAYER.md`. Peering is off by default; both keys are always present.

```jsonc
"peering": {
  "enabled": false, "name": "World of Gun", "status": null, "fields": [], "url": null, "autoPull": false,
  "allowlist": { "name": { "label": "Name", "note": "the character's name" }, "level": { ... } },
  "peers": [ { "id": "0123456789abcdef", "name": "Kai", "url": "https://kai.example.org", "world": null,
               "status": "active", "enabled": true, "share": ["name", "level"],
               "createdAt": "2026-11-10T02:00:00.000Z", "acceptedAt": "2026-11-10T03:00:00.000Z",
               "lastPullAt": "2026-11-13T09:50:00.000Z", "lastError": null,
               "lastSeenAt": "2026-11-13T09:45:00.000Z", "inviteExpiresAt": null,
               "card": { "v": 1, "world": { "name": "World of Gun" }, "fields": ["name", "level"],
                         "values": { "name": "Ash Example", "level": 3 }, "at": "2026-11-13T10:00:00.000Z" },
               "received": { "at": "2026-11-13T09:50:00.000Z", "fields": ["name", "level", "place", "stepsGoal"] } } ],
  "source": "peers (settings beside the log)", "asOf": "2026-11-13T10:00:00.000Z"
},
"squad": {
  "members": [ { "id": "gun", "name": "Ash Example", "self": true, "shared": { "level": 3, ... } },
               { "id": "peer:0123456789abcdef", "name": "Kai", "self": false, "world": "Kai",
                 "receivedAt": "2026-11-13T09:50:00.000Z", "shared": { "name": "Kai", "level": 7 } } ],
  "note": "only fields each owner chose to share; a missing field is 'not shared', never zero"
}
```

- `peering.name` is the name peers see (the `WORLD_NAME` var until the owner sets one),
  `status` a line the owner wrote for peers, `fields` the default share list, `url` this world's
  own address when it differs from the request origin, `autoPull` whether the world pulls its
  peers' cards by itself about every five minutes.
- `allowlist` names every field that can be shared, with a label and a note: `name`, `level`,
  `title`, `class`, `place`, `activity`, `streaks`, `grade`, `stepsGoal`, `status`, `lastSeen`.
- `peers[]`: `status` is `invited` | `active`; `share` is the list for that peer; `world` is the
  peer's sandbox name when it is one. `card` is the exact card that peer would receive now
  (`null` unless the peer is active and enabled and peering is on). `received` is what last
  arrived from them (`null` when nothing has). No secret ever appears here.
- `squad.members` is empty until a peer card exists. Then the first member is the player
  (`self: true`) and the rest are the peer entries of `party[]`.

## Account identifiers

Account identifiers are masked everywhere the engine stores or emits: IBANs, account and card
numbers and wallet addresses become four dots plus the last four characters.

- At ingest, in every event type, before the event is stored: `"Example Bank (GB29 NWBK 6016
  1331 9268 19)"` is stored as `"Example Bank (•••• 6819)"`, and a card number in a note as
  `"•••• 4242"`. Money events are masked strictly; other events only where a string is
  certainly an identifier. The rules are in `docs/EVENTS.md`.
- Again at reduce time, for every owner: account `id`, `name` and `institution`, transaction
  and income names.
- So the state, the log, `/api/tv`, `/api/events` and live messages never carry a full
  identifier.

## Routes

### Credentials

- Owner session. It comes only from Cloudflare Access in front of the worker (the
  `Cf-Access-Jwt-Assertion` header or the `CF_Authorization` cookie, verified against the vars
  `ACCESS_TEAM` and `ACCESS_AUD`; the owner is `OWNER_EMAIL`), or from `DEV=1` in `.dev.vars`
  for local play. The worker has no session cookie of its own, no login page and no redirect.
  Without a session every page and session route answers
  `401 { "error": "sign in through Cloudflare Access" }`, or, when Access is not configured, a
  401 whose text says to set `ACCESS_TEAM` and `ACCESS_AUD`. Anyone else Access lets through
  gets 403. Session writes from another origin are refused (403).
- Ingest key: header `x-world-key` (secret `INGEST_KEY`).
- Act key: header `x-act-key` or `Authorization: Bearer` (secret `ACT_KEY`).
- TV key: header `x-tv-key`, `Authorization: Bearer`, or `?key=` (secret `TV_KEY`).
- Read token: `Authorization: Bearer wogr_...`, scope `world:read`, minted at `POST /api/token`.
  A token lasts 30 days, is stored only as its SHA-256, and a world keeps at most 20. It is not
  tied to a session: it lives until it expires or is revoked.
- Pair signature: a request from a peer world, signed with the pair's secret
  (`docs/MULTIPLAYER.md`).

Each key and token belongs to one world: the production secrets reach production, the `QC_`
secrets and `wogq_` tokens reach the sandbox (see "The QC world"). A route whose secret is not
set refuses every key.

### Table

| Method | Route | Credential | Purpose |
|---|---|---|---|
| GET | `/healthz` | none | Answers `ok`. |
| GET | `/` and static files | owner session | The client. |
| GET | `/api/state` | owner session | The state document. |
| GET | `/api/tv` | TV key | The same state document, for a read-only screen. |
| GET, HEAD | `/api/tv/model/<file>.glb` or `.usdz` | TV key | A model file from `public/models/`, for a native screen. |
| GET (WebSocket) | `/api/live` | owner session, TV key | The live channel. |
| GET | `/api/log` | owner session | The log, paged: `limit`, `cursor`, `before`. |
| GET | `/api/tasks` | owner session | Every open task: `{ total, tasks }`. |
| GET | `/api/days` | owner session, TV key | Day-close summaries, newest first. |
| GET | `/api/rules` | owner session | The rules as JSON. |
| GET | `/api/signals` | owner session | Feed diagnostics: last poll, errors, event counts. |
| GET | `/api/glance` | owner session, read token, TV key | The small document for widgets. `ETag`, `Cache-Control: private, max-age=60`. |
| GET | `/api/brief` | owner session, read token, TV key | A spoken briefing: `kind=morning`, `now` or `evening`. |
| GET | `/api/img/<id>` | owner session, read token, TV key | A stored image. |
| POST, PUT | `/api/img/<id>` | ingest key | Store an image. |
| DELETE | `/api/img/<id>` | ingest key | Remove an image. |
| POST | `/api/ingest` | ingest key | Push events. |
| GET | `/api/events` | ingest key | Stored (masked) events by source, cursor-paged. |
| POST | `/api/admin/tick` | ingest key | Run the adapters now (`?feed=<id>` for one). |
| POST | `/api/admin/recompute` | ingest key | Replay the log through the rules. |
| POST | `/api/admin/debug` | ingest key | The same diagnostics as `/api/signals`. |
| POST | `/api/admin/events` | ingest key | The newest stored events of a type. |
| POST | `/api/admin/scan-identifiers` | ingest key | Report stored payloads that still hold an identifier. |
| POST | `/api/admin/purge-identifiers` | ingest key | Rewrite them masked (a dry run unless `dry=0`). |
| POST | `/api/admin/qc/reset` | QC ingest key | Empty a sandbox. |
| POST | `/api/admin/qc/seed` | QC ingest key | Load the synthetic fixture into a sandbox. |
| POST | `/api/act` | act key, or owner session | One manual fact from voice, a keypad or a watch. |
| POST | `/api/phone` | owner session | A phone app as a sensor. |
| POST | `/api/seen` | owner session | Mark the last day close as shown. |
| POST | `/api/clientlog` | owner session | Client diagnostics from a device. Always 204. |
| GET | `/api/clientlog` | ingest key, TV key | Read those diagnostics. |
| POST | `/api/token` | owner session | Mint a read token. |
| GET | `/api/token` | owner session | List read tokens. |
| DELETE | `/api/token` | read token (itself), or owner session | Revoke tokens. |
| GET, PUT | `/api/share` | owner session | Read or change the peering settings. |
| GET, POST, DELETE | `/api/peers` | owner session | List, update or remove peers. |
| POST | `/api/peers/invite`, `/api/peers/accept`, `/api/peers/refresh` | owner session | Invite a peer, accept an invite, pull cards. |
| POST | `/api/peer/hello` | pair signature | A peer world announcing itself (404 while peering is off). |
| GET | `/api/peer/card` | pair signature | A peer world fetching its card (404 while peering is off). |

A read token opens exactly three routes (`GET /api/glance`, `GET /api/brief`,
`GET /api/img/*`) and is ignored everywhere else.

Specified elsewhere:

- `docs/EVENTS.md`: event types and their `data` fields, `/api/ingest`, `/api/events`,
  `/api/act`, `/api/phone`, `/api/brief`, `/api/glance`, `/api/days`, read tokens, client
  diagnostics, edge adapters and the QC world (keys, seed, reset, examples).
- `docs/MULTIPLAYER.md`: peering, the card, the handshake and its routes.

## Live channel: `GET /api/live`

A WebSocket. An open screen reacts within seconds of the real-world action. The request must be
a WebSocket upgrade (426 otherwise) and carry an owner session or the TV key (as `?key=` where
a client cannot set headers).

Messages from the engine, each one JSON text:

| Message | When |
|---|---|
| `{ "type": "hello", "env": "production", "asOf": "...", "computedAt": "..." }` | Once, on connect. In a sandbox `env` is `"qc"` and `world` names it (`"world": "qc-ui"`). |
| `{ "type": "event", "event": { ... } }` | A new log entry, in the shape of a `log[]` entry. |
| `{ "type": "activity", "activity": { ... } }` | `character.activity` changed its `name` or `inferred`. The object has the activity's fields plus `was` (the previous name, or `null`). |
| `{ "type": "state" }` | Something changed: fetch the state again. |

One change produces its `event` messages, then `activity` if the activity changed, then
`state`. A client may send the text `state` and gets `{ "type": "state" }` back.

What is not broadcast entry by entry:

- A bulk change is not news: the first fill of an empty log, a backfill or a rules replay that
  yields more than 40 new entries sends only the `state` message.
- At most the last 25 new entries of one change are sent as `event` messages.
- Only entries that are new to the log are sent. An entry that was revised, and any change that
  adds no log entry (a new balance, a feed snapshot, the seen mark, peering settings), is
  announced by `state` alone.

## The QC world

The QC world is a sandbox: a second instance of the same engine with its own log, images and
tokens, no edge adapters and no scheduled tick. It exists so that clients and collectors can be
tested without touching production. Sandboxes are named: `qc` (shared) and `qc-<name>`
(lowercase letters, digits, hyphens), each one separate. How to use it, with examples, is in
`docs/EVENTS.md`.

Which world a request reaches:

- A key decides by the secret it matches: production keys reach production only, QC keys reach
  sandboxes only (plain `qc` unless the request names another).
- A read token decides by its prefix: `wogr_` production, `wogq_` the shared sandbox,
  `wogq-<name>_` the sandbox `qc-<name>`.
- An owner session reaches production unless the request says `?world=qc` (or `qc-<name>`) or
  sends the header `x-world: qc`. The query wins over the header.
- A marker that disagrees with the credential is refused with 409 and nothing is done. An
  unknown world name is refused with 400.

How it shows:

- The state has `env: "qc"` and `sandbox` (the exact name). Production has `env: "production"`
  and no `sandbox` key. The glance carries `env` and `sandbox` only in a sandbox.
- Every response from a sandbox has the header `x-world` with the sandbox's name.
- The live channel's `hello` message carries `env` and `world`.
- Image URLs in a sandbox's state end in `?world=<name>` (`/api/img/party-ines-park?world=qc-ui`).
- Replies to writes (`/api/ingest`, `/api/phone`, `/api/act`) and `POST /api/token` carry
  `world`: the sandbox's name, or `"production"`.
- Production refuses test traffic: `/api/ingest`, `/api/phone` and `/api/act` reject events
  whose source or device id starts with `qc` or names a simulator.

### Page hooks

When the page is opened with `?world=qc` (or `qc-<name>`) on an owner session, the worker
rewrites the HTML:

- `<html data-world="qc">`;
- `<meta name="wog-world" content="qc">` at the top of `<head>`;
- a script that sets `window.__WOG_WORLD__ = "qc"` and wraps `fetch` and `WebSocket`, so that
  every same-origin `/api/` call and the live socket carry `world=qc`. A sandbox page cannot
  read or write production;
- `<div id="qc-world-tag" data-world="qc">QC WORLD</div>` at the top of `<body>`, inline-styled
  so it is visible unstyled (restyle it by id). In a named sandbox the text adds the name
  (`QC WORLD · UI`).

All four carry the exact sandbox name. `state.env === "qc"` confirms it from the data.

Every HTML page also carries what the deployment's vars say (`stylePage` in `src/index.js`):

| Var | Hook |
|---|---|
| `WORLD_NAME` | Replaces the page `<title>`, and adds `<meta name="wog-name" content="...">`. |
| `DEFAULT_SKIN` | `<meta name="wog-skin" content="...">`: the skin a new browser starts with. |
| `DEFAULT_BIOME` | `<meta name="wog-biome" content="...">`: the realm the stage draws (`tropical-coast` or `dry-coast`). |

A var that is empty or malformed adds nothing.
