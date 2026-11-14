# World of Gun: multiplayer (peer worlds)

Two worlds, each run by its own owner, can show a little of each other. This document is the
design and the wire protocol. The source of truth is `src/peers.js` (pure logic: the card
allowlist, invite codes, signing and verification), the peering methods of the World object in
`src/world.js` (settings, the peer table, the fetches), the routes in `src/index.js`, and
`test/peers.test.mjs`.

Peering is off by default. Nothing leaves a world until its owner turns it on.

Examples use two owners, Ash ("World of Ash" at `https://world.example.org`) and Robin
("World of Robin" at `https://other.example.org`).

## The idea

Everyone runs their own world. A world is wired into one person's body, money, tasks, devices and
AI, and that data is private. So there is no shared server, no account system and no hosting for
friends. Each world is its own server (this repository deployed by its owner, or anything that
speaks the small protocol below), and worlds exchange one thing only: a **presence card**, signed,
curated by its owner, handed only to peers that owner invited.

A world never publishes anything. A friend who shares nothing is a name. A friend who shares
"level, activity, grade" shows up in the other world's party as exactly that, marked as coming from
their world.

## Why each world is its own server

- **Privacy is structural, not a setting.** Raw facts never leave the world that owns them. The
  protocol has no field for a weight, a balance, a step count, a coordinate, a task or a log line,
  so no bug or misconfiguration can leak one. The allowlist is the whole vocabulary.
- **Personalisation needs the owner's own data.** A hosted game would be either shallow (no feeds)
  or a single store of everyone's feeds.
- **Cost and liability stay with each owner.** Nobody hosts, stores or secures another person's
  life. A world is one Cloudflare Worker on its owner's account, or any server that implements the
  two peer routes.
- **It composes.** A world can run different rules, a different look and a different AI and still
  peer: the card is the only contract.

## Threat model

Protected: everything in a world's event log and state. Exposed by the protocol: the card fields
the owner ticked, to the peers the owner invited, while the owner keeps peering on.

| Threat | Answer |
|---|---|
| Anyone on the internet asks a world for a card | `GET /api/peer/card` needs a request signed with a per-pair secret; without it the answer is `401 {"error":"unauthorized"}`. With peering off (the default) the answer is `404 {"error":"not found"}`, the same as a route that does not exist. |
| A peer asks for more than was ticked | The card is built on the serving side from the share list stored for that peer. The request cannot name fields. |
| A leaked invite code | The code carries the pair id and the pair secret, so it is a credential. Whoever accepts it becomes the peer and shows up by name in the inviter's peer list. The inviting world does not count uses: a hello signed with that secret is accepted for as long as the peer row exists, and each one replaces the stored address. The remedy is to delete the peer (which discards the secret) and invite again. An unused code expires after 7 days. |
| Replay of a captured request | Every request carries a timestamp (5-minute window) and a 16-hex nonce the server remembers for 10 minutes. The signature covers method, path and query, timestamp, nonce and body hash. |
| A tampered response (a proxy, a hostile server) | Responses are signed with the same secret over status, timestamp and body; the puller verifies before storing. A world address must be `https` (plain `http` only on loopback, for local development). |
| A hostile peer sends junk | A received card is reduced to the allowlist and to plain values (`cleanCard`), capped at 8,000 characters, and stored as an internal event type (`peer.card`) that `/api/ingest` refuses from outside. It can only affect that peer's own party entry. |
| A peer world is compromised | The attacker learns what the owner shared with that peer and nothing else. The pair secret opens only the two peer routes. Deleting the peer ends it. |
| The owner forgets what leaves | `state.peering.peers[].card` is the exact card each peer would receive right now. |
| Peering switched on by accident | `enabled` is a stored setting, false by default, changed only through `PUT /api/share` with the owner's session. No key, token or event can flip it. |

Not covered: a friend keeping a screenshot of what they were shown, and the platform's own
storage of the world (the same as everything else in the log).

## The card

`GET /api/peer/card` (signed) returns:

```jsonc
{ "v": 1,
  "world": { "name": "World of Ash" },
  "fields": ["name", "level", "activity", "grade"],
  "values": { "name": "Ash Example", "level": 7, "activity": "training", "grade": null },
  "at": "2026-11-13T02:00:00.000Z" }
```

- `v` is the protocol version, `1`.
- `world.name` is the serving world's display name (null when it has none).
- `fields` lists exactly the fields shared with this peer; `values` has one key per listed field.
- A shared field with no signal is `null`, never a default. A field the owner did not tick is
  absent. The receiver shows absent as "not shared" and null as "no signal".
- `at` is the `asOf` of the state the card was read from.

### The allowlist

| Field | Value | Why it is safe to share |
|---|---|---|
| `name` | the character's name (string) | self-declared |
| `level` | character level (integer) | derived and coarse; never XP |
| `title` | the rank title (string) | derived from level |
| `class` | the class name (string) | derived |
| `place` | `realm.city`, else `realm.place` (string) | a city-level name, never coordinates |
| `activity` | the activity name: `idle`, `walking`, `training`, `sleeping`, `working`, `eating`, `celebrating` | one word, no times, no basis |
| `streaks` | `{ steps, sleep, protein }`, current streak lengths in days | counts of days, not the numbers behind them |
| `grade` | today's letter grade (string) | one letter |
| `stepsGoal` | whether today's step goal is hit (boolean) | a yes or no, not a count |
| `status` | one line the owner typed for peers (string, at most 200 characters) | authored |
| `lastSeen` | when the world last heard from its devices, floored to the hour (ISO time) | coarse liveness |

`CARD_FIELDS` in `src/peers.js` is the only place a field can be added. There is deliberately no
field for weight, body fat, heart rate, sleep hours, step counts, food, money (balances, runway,
income, accounts), coordinates, home or place history, tasks and quests, the log, contacts, items,
achievements or photos.

### What a receiver keeps

A received card is passed through `cleanCard` before it is stored. A compatible receiver should do
the same:

- `v` must be `1`, otherwise the card is rejected.
- `fields` is filtered to allowlisted ids, without duplicates. Values for anything else are dropped.
- `streaks`: an object keeping only `steps`, `sleep` and `protein` where they are finite numbers,
  rounded and floored at 0; anything else becomes null.
- `stepsGoal`: a boolean, otherwise null.
- `level`: a finite number, rounded, otherwise null.
- Every other field: a string cut to 80 characters (`status`: 200), otherwise null.
- `world.name`: a string cut to 60 characters, otherwise null. `at`: a parseable time, re-emitted
  as ISO, otherwise null.

## Pairing

Each side keeps one row per peer: the pair id, the other world's display name, its address (`url`
plus an optional sandbox `world` marker), the secret, its own share list for that peer, `enabled`,
`status` (`invited` or `active`), and timestamps (created, accepted, last pull, last seen), the
last pull error and the invite expiry. The secret is stored in the world's own SQLite beside the
log and never appears in a route answer, the state or the log. A world holds at most 50 peers.

1. **Ash turns peering on.** `PUT /api/share { "enabled": true, "name": "World of Ash", "fields": ["name", "level", "activity", "grade"] }`.
   `fields` is the default share list for new peers. `status` is the optional status line. `url` is
   the world's public address, needed only when the request origin is not it (local development, a
   proxy). When no name is stored, the `WORLD_NAME` var is used.
2. **Ash invites.** `POST /api/peers/invite { "name": "Robin", "share": [...], "enabled": true }`
   creates a peer row with status `invited`, a fresh pair id (16 hex characters) and a fresh secret
   (64 hex characters), and returns a one-time **invite code**. `name` is a label for the row until
   the other world names itself. `share` defaults to the world's default list. `enabled` defaults
   to false: sharing to the new peer stays off until the owner enables it. Ash hands the code to
   Robin out of band (a message, in person). Nothing is published anywhere.
3. **Robin accepts.** On Robin's world, with peering on and a name set:
   `POST /api/peers/accept { "code": "wogp1_...", "share": [...], "enabled": true }`. Robin's world
   decodes the code, sends a signed hello to Ash's world (below) so that Ash learns where Robin's
   world lives, verifies the signed answer, and only then stores the pairing as `active`. If the
   hello fails, nothing is stored.
4. **Either side pulls.** `POST /api/peers/refresh` (optionally `{ "id": "<pair id>" }`) sends a
   signed card request to every peer that is `active` and `enabled`, verifies each answer, cleans
   the card and stores it. Nothing is ever pushed. With `autoPull` on, the world repeats the pull by
   itself (see "Automatic pull").
5. **Switching off.** `PUT /api/share { "enabled": false }` makes both peer routes answer 404 at
   once. `POST /api/peers { "id": "...", "enabled": false }` pauses one peer: its pulls get a signed
   `403 {"error":"sharing is off for this peer"}`, so the other side knows it is deliberate.
   `DELETE /api/peers { "id": "..." }` forgets the pairing and voids the card received from that
   peer. The other world keeps its own row until its owner deletes it too; its pulls then fail and
   the reason is kept on that row (`lastError`).

To rotate a secret, delete the peer and invite again.

### Invite code

```
wogp1_<base64url(JSON), no padding>
```

The JSON object:

| Key | Value |
|---|---|
| `v` | `1` |
| `pair` | the pair id: 16 lowercase hex characters |
| `secret` | the pair secret: 64 lowercase hex characters |
| `url` | the inviting world's address (an origin, see "World addresses") |
| `world` | the inviting world's sandbox marker (`qc` or `qc-<name>`), or null for a production world |
| `name` | the inviting world's display name, or null |
| `exp` | expiry, epoch milliseconds (7 days after minting) |

The JSON text is UTF-8, base64 encoded with `-` for `+` and `_` for `/`, trailing `=` removed.

A decoder refuses the code with one of these errors: `not an invite code` (wrong prefix),
`invite code is damaged` (not base64 JSON), `invite code is not valid` (wrong version, pair or
secret format), `invite names a bad world address: <reason>`, `invite code has expired`. A `world`
value that is not a sandbox name is read as null.

On the inviting side, an `invited` row that is past its expiry is deleted the next time the world
reads its peer list (a state recompute, `GET /api/share`, `GET /api/peers`).

### World addresses

A world address is an origin: `https://host[:port]` with no credentials, path, query or fragment
(a single trailing `/` is accepted and removed). Plain `http` is accepted only for `localhost`,
`127.0.0.1` and `[::1]`. Anything else is refused (`https required`, `no credentials in a world
address`, `a world address is an origin only`, `not a URL`).

A QC sandbox (see docs/EVENTS.md) is addressed by the same origin plus its marker: peer requests to
it carry `?world=qc-<name>` in the path, and that query is part of what is signed. A production
world has no marker.

## The peer protocol

Two routes, called by another world. There is no session and no key: the pair signature is the
credential, checked inside the World object. The world marker alone selects a sandbox.

### Signatures

HMAC-SHA256, hex output, both directions. The key is the pair secret as text: the 64 hex
characters encoded as UTF-8, not the 32 bytes they would decode to. Hashes are SHA-256 of the body
text as UTF-8, in lowercase hex; an empty body hashes the empty string.

Request headers:

| Header | Value |
|---|---|
| `x-peer-id` | the pair id (16 lowercase hex) |
| `x-peer-ts` | the sender's clock, epoch milliseconds, as a decimal string |
| `x-peer-nonce` | 16 lowercase hex characters, fresh per request |
| `x-peer-sig` | `HMAC(secret, canonical request)` in lowercase hex |

Canonical request, five lines joined with `\n` (no trailing newline):

```
<METHOD in upper case>
<path with query, exactly as sent, e.g. /api/peer/card or /api/peer/card?world=qc-ash>
<x-peer-ts>
<x-peer-nonce>
<sha256 hex of the request body>
```

Response headers: `x-peer-ts` (the responder's clock, epoch milliseconds) and `x-peer-sig`.
Canonical response, four lines joined with `\n`:

```
RESPONSE
<HTTP status as a decimal number>
<x-peer-ts>
<sha256 hex of the response body>
```

Both sides hash the body text exactly as it travelled. Do not parse and re-serialise before
verifying.

The server verifies in this order, and answers `401 {"error":"unauthorized"}` (unsigned) on any
failure:

1. `x-peer-id` is 16 hex characters and names a stored peer row.
2. `x-peer-ts` is a number within 5 minutes of the server's clock, either side.
3. `x-peer-nonce` is 16 lowercase hex characters.
4. The nonce has not been seen. Nonces are remembered for 10 minutes, per world, in the World
   object's memory; older ones are pruned on each check.
5. The signature matches, compared in constant time. Only then is the nonce recorded.

The caller verifies a response the same way: timestamp within 5 minutes of its own clock, then the
signature over the status it received and the body text. Responses carry no nonce.

HMAC is used rather than a public-key scheme because both sides already share a secret through the
invite, the same code signs and verifies, and it is available in every runtime (Web Crypto, no
dependency).

### `POST /api/peer/hello`

Sent by the accepting world to the inviting world. Body (JSON):

```json
{ "v": 1, "url": "https://other.example.org", "world": null, "name": "World of Robin" }
```

`url` is the accepting world's address, `world` its sandbox marker or null, `name` its display
name. The inviting world stores the address and marker, takes `name` as the peer's display name
(keeping its own label when `name` is empty), marks the pair `active`, clears the invite expiry and
answers, signed:

```json
{ "ok": true, "v": 1, "name": "World of Ash" }
```

The accepting world uses that `name` as the peer's display name, falling back to the name in the
invite code.

### `GET /api/peer/card`

Sent by either world to the other, with no body. The answer, signed, is the card built from the
share list stored for this pair (see "The card").

### Status codes

| Situation | Status | Body | Signed |
|---|---|---|---|
| Wrong method for the route | 404 | `{"error":"not found"}` | no |
| Unknown world marker | 400 | an error naming the valid forms | no |
| Request body over 20,000 bytes | 401 | `{"error":"unauthorized"}` | no |
| Peering is off in the addressed world | 404 | `{"error":"not found"}` | no |
| Unknown pair, bad timestamp, bad or replayed nonce, bad signature | 401 | `{"error":"unauthorized"}` | no |
| Hello: the body is not JSON | 400 | `{"error":"bad body"}` | yes |
| Hello: `url` is not a world address | 400 | `{"error":"bad url: <reason>"}` | yes |
| Hello accepted | 200 | `{"ok":true,"v":1,"name":...}` | yes |
| Card: the pair is still `invited` | 403 | `{"error":"pairing not completed"}` | yes |
| Card: the owner has this peer disabled | 403 | `{"error":"sharing is off for this peer"}` | yes |
| Card served | 200 | the card | yes |

All answers are `application/json` with `Cache-Control: no-store`. An answer from a sandbox also
carries the `x-world` header.

### What the caller does with the answers

Accepting (`POST /api/peers/accept`): the hello answer must be status 200 and its signature must
verify, otherwise the accept fails and nothing is stored.

Pulling (`POST /api/peers/refresh`, or the automatic pull): per peer, the request times out after
15 seconds; the answer must be status 200, at most 8,000 characters, correctly signed, valid JSON,
and a card that survives `cleanCard`. A card that passes is written as a `peer.card` event (one per
peer, revised in place) and the peer's stored name follows `world.name` when the card has one. Any
failure is recorded on the peer row as `lastError` (for example `HTTP 404`, `HTTP 403`,
`card too large`, `bad response signature`, `response timestamp outside the window`, `not a card`,
`timed out after 15 s`) and changes nothing else.

## Owner routes

Owner session only (Cloudflare Access in front of the worker, or `DEV=1` locally). Without a
session the answer is 401; a session that is not the owner gets `403 {"error":"forbidden"}`. A
write whose `Origin` header names another origin gets `403 {"error":"cross-origin writes denied"}`.
Like every session route they honour the world marker (`?world=qc-<name>` or the `x-world` header).
A refused call answers 400 with `{ "ok": false, "error": "..." }`.

| Route | What it does | Answer |
|---|---|---|
| `GET /api/share` | the settings and the peer list | `{ ok, world, enabled, name, status, fields, url, autoPull, peers[] }` |
| `PUT /api/share` (`POST` is accepted too) | patch the settings; only the keys sent change | `{ ok, peering: { ...settings }, world }` |
| `GET /api/peers` | the same document as `GET /api/share` | as above |
| `POST /api/peers { id, share?, enabled?, name? }` | change one peer's share list, switch or label | `{ ok, peer }` |
| `DELETE /api/peers { id }` (or `?id=`) | forget a peer and void the card it sent | `{ ok, deleted }` |
| `POST /api/peers/invite { name?, share?, enabled? }` | mint an invite code | `{ ok, world, peer, code, expiresAt, note }` |
| `POST /api/peers/accept { code, share?, enabled? }` | accept a code (sends the hello) | `{ ok, world, peer }` |
| `POST /api/peers/refresh { id? }` | pull cards now, from one peer or all | `{ ok, world, pulled, changed, report }` |

`world` in an answer is `"production"` or the sandbox name. `report` maps each pulled pair id to
`{ ok: true, fields }` or `{ ok: false, error }`.

### Settings

| Key | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | false | the one switch for the whole feature; only a literal `true` turns it on |
| `name` | string, at most 60 characters | null (then `WORLD_NAME`) | the display name peers see |
| `status` | string, at most 200 characters | null | the value of the `status` card field |
| `fields` | array of allowlist ids | `[]` | the default share list for new invites and accepts |
| `url` | world address | null | this world's own public address when the request origin is not it; an invalid value is stored as null |
| `autoPull` | boolean | false | pull peers' cards automatically; only a literal `true` turns it on |

Unknown field ids in `fields` or in a peer's `share` are dropped silently.

### A peer row, as the owner sees it

```jsonc
{ "id": "0123456789abcdef", "name": "World of Robin", "url": "https://other.example.org", "world": null,
  "status": "active", "enabled": true, "share": ["name", "level", "activity", "grade"],
  "createdAt": "2026-11-13T01:00:00.000Z", "acceptedAt": "2026-11-13T01:05:00.000Z",
  "lastPullAt": "2026-11-13T02:00:00.000Z", "lastError": null,
  "lastSeenAt": "2026-11-13T02:00:00.000Z", "inviteExpiresAt": null }
```

`lastSeenAt` moves when the peer's world calls this one (a hello or a served card request) and when
a pull from it succeeds. `inviteExpiresAt` is set on the inviting side while the row is `invited`.

### Errors from the owner routes

| Route | Error text |
|---|---|
| invite, accept | `peering is off for this world; turn it on first (PUT /api/share { enabled: true })` |
| invite, accept | `give this world a display name first (PUT /api/share { name })` |
| invite, accept | `this world's own address (<address>) is not shareable: <reason>; set it with PUT /api/share { url }` |
| invite, accept | `at most 50 peers` |
| accept | the invite decoding errors listed under "Invite code" |
| accept | `this invite was already accepted here` |
| accept | `a world cannot peer with itself` |
| accept | `could not reach the inviting world: <reason>` |
| accept | `the inviting world refused the hello (HTTP <status>)` |
| accept | `the inviting world's answer did not verify: <reason>` |
| refresh | `peering is off for this world` |
| `POST /api/peers` | `id required`, `no such peer` |
| `DELETE /api/peers` | `id required` |

## What appears in the state

### `peer.card` events

A pulled card is stored as an event with id `peer.card:<pair id>`, type `peer.card`, source
`peer:<pair id>` and data
`{ peerId, world: { name, url, world }, fields, values, cardAt, receivedAt }`. The type is
internal: `/api/ingest` answers "unknown type" for it. Deleting the peer voids the event.

### `party[]`

Each stored card becomes one party entry, after the contacts, sorted by name:

```jsonc
{ "id": "peer:0123456789abcdef", "name": "Robin", "role": "peer", "views": ["squad"], "bond": null,
  "location": "Pinehill", "lastContact": null, "lastPosted": null, "img": null,
  "strengths": null, "weaknesses": null, "supportThem": null, "supportMe": null, "touchDays30": null,
  "source": "peer.card", "asOf": "2026-11-13T02:00:00.000Z",
  "peer": { "id": "0123456789abcdef", "world": "World of Robin", "url": "https://other.example.org",
            "sandbox": null, "receivedAt": "2026-11-13T02:00:00.000Z", "cardAt": "2026-11-13T01:59:00.000Z",
            "fields": ["name", "level", "place", "grade"] },
  "shared": { "name": "Robin", "level": 10, "place": "Pinehill", "grade": null } }
```

- `shared` has exactly the fields received: a shared field with no signal is null, a field that was
  not shared is absent.
- `name` is the shared name, else the peer world's display name, else "A peer world". It is never
  invented.
- `location` is set only when `place` was shared.
- A card already received stays in the party while peering is off or the peer is paused. It goes
  when the peer is deleted.

### `peering`

```jsonc
{ "enabled": true, "name": "World of Ash", "status": null, "fields": ["name", "level"], "url": null, "autoPull": false,
  "allowlist": { "name": { "label": "Name", "note": "the character's name" }, "level": { "label": "Level", "note": "character level only, not XP" } },
  "peers": [ { "id": "0123456789abcdef", "name": "World of Robin", "status": "active", "enabled": true,
               "share": ["name", "level", "activity"],
               "card": { "v": 1, "world": { "name": "World of Ash" }, "fields": ["name", "level", "activity"],
                         "values": { "name": "Ash Example", "level": 7, "activity": "idle" }, "at": "2026-11-13T02:00:00.000Z" },
               "received": { "at": "2026-11-13T02:00:00.000Z", "fields": ["name", "level", "place", "grade"] } } ],   // plus the other row keys
  "source": "peers (settings beside the log)", "asOf": "2026-11-13T02:00:00.000Z" }
```

- The settings, at the top level.
- `allowlist`: every card field with its `label` and `note` (the example shows two of the eleven).
- `peers[]`: each peer row (as above, never a secret) plus `card`, the exact card that peer would
  receive now (null unless peering is on and the peer is `active` and `enabled`), and `received`,
  what came from them and when (null when no card is stored).
- `source` and `asOf` say where the block comes from and when it was computed.

### `squad`

```jsonc
{ "members": [
    { "id": "gun", "name": "Ash Example", "self": true,
      "shared": { "level": 7, "title": "Wanderer", "class": "Warrior", "place": "Seabrook", "activity": "idle",
                  "streaks": { "steps": 3, "sleep": 0, "protein": 1 }, "grade": "B", "stepsGoal": true,
                  "lastSeen": "2026-11-13T02:00:00.000Z" } },
    { "id": "peer:0123456789abcdef", "name": "Robin", "self": false, "world": "World of Robin",
      "receivedAt": "2026-11-13T02:00:00.000Z", "shared": { "name": "Robin", "level": 10, "place": "Pinehill", "grade": null } } ],
  "note": "only fields each owner chose to share; a missing field is 'not shared', never zero" }
```

`members` is empty (and `note` is "no peer worlds yet") until at least one card has been received.
The first member is this world's own player with every board field read from its own state; the
rest are the peer party entries with their `shared` fields. A client draws a missing field as "not
shared".

## Automatic pull

`autoPull` is off by default. While it is on, the World object's alarm runs the same pull as
`POST /api/peers/refresh` at most every five minutes (`AUTO_PULL_MS`), the first one within seconds
of the conditions being met. It runs only while peering is on and at least one peer is `active` and
`enabled`. The time of the last automatic pull is kept beside the settings. Nothing is pushed: a
peer that has peering off answers 404 and the row records it. Sandbox worlds run it too.

## In the client

The **Squad & Sharing** window (`public/app/ui/panels/share.js`, opened from the settings menu or
the Party window, or with `?screen=world&panel=share`) is the interface to the owner routes: the peering switch
and the automatic pull switch, the world name, address and status line, the default share list as
switches, the peer list with pause, refresh and remove, a per-peer share list with the exact card
the engine builds for that peer (`peering.peers[].card`), invite codes, accepting a code, and the
squad board. Errors from the routes are shown word for word. The Party window shows peer entries
and a squad card once peering is on or a peer exists.

## Try it locally

`scripts/peer-demo.sh` runs a scripted pairing between two sandbox worlds on one local dev server;
its header says how to start it.

By hand, with `wrangler dev` running (`.dev.vars` with `DEV=1`, so every request is an owner
session) and two QC sandboxes as the two worlds:

```bash
BASE=http://localhost:8787
J='Content-Type: application/json'

# 1. both owners turn peering on (url is set because the address is a local one)
curl -s -X PUT "$BASE/api/share?world=qc-ash" -H "$J" \
  -d '{"enabled":true,"url":"'$BASE'","name":"World of Ash","fields":["name","level","activity","grade"]}'
curl -s -X PUT "$BASE/api/share?world=qc-robin" -H "$J" \
  -d '{"enabled":true,"url":"'$BASE'","name":"World of Robin","fields":["name","level","place"]}'

# 2. Ash invites; copy "code" from the answer
curl -s -X POST "$BASE/api/peers/invite?world=qc-ash" -H "$J" -d '{"name":"Robin","enabled":true}'

# 3. Robin accepts (this sends the signed hello to Ash's world)
curl -s -X POST "$BASE/api/peers/accept?world=qc-robin" -H "$J" -d '{"code":"wogp1_...","enabled":true}'

# 4. both pull, then look
curl -s -X POST "$BASE/api/peers/refresh?world=qc-ash"
curl -s -X POST "$BASE/api/peers/refresh?world=qc-robin"
curl -s "$BASE/api/state?world=qc-ash"   # party[] has a role "peer" entry; peering and squad are filled
```

Open `$BASE/?world=qc-ash&screen=world&panel=share` and the same address with `world=qc-robin` to
see both sides in the client. `POST /api/admin/qc/reset?world=qc-ash` with the QC ingest key (`x-world-key: qc-dev`
under `DEV=1`) clears a sandbox, its peers and its peering settings included.

Two separate instances work the same way: run a second copy of the repository with
`wrangler dev --port 8788`, use `http://localhost:8787` and `http://localhost:8788` as the two
addresses, and leave the world marker out.

## Running your own world to peer with someone

1. Deploy your own world: fork this repository (or stamp a renamed copy with `scripts/new-world.sh`)
   and `wrangler deploy` it on your own Cloudflare account with your own secrets. An empty world
   works: every metric reads "no signal" until a feed is wired. Any server that implements
   `/api/peer/hello` and `/api/peer/card` with the signature scheme above is also a world.
2. In your world: `PUT /api/share { "enabled": true, "name": "<your world>", "fields": [what you are happy to show] }`.
3. Ask the other owner for an invite code and `POST /api/peers/accept { "code": "...", "enabled": true }`.
   Your world tells theirs where it lives, signed. They pull your card, you pull theirs.
4. Change your mind at any time: edit `fields` or the peer's `share`, set `enabled: false` on the
   peer, or delete it. The other world keeps the last card it pulled until its owner deletes the
   peer or pulls a new one.

## Not part of the protocol

- Pushing a card. Peers pull.
- Portraits or any image on a card.
- Quests shared between worlds.
- A directory of worlds. There is none, by design.
