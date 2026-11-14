# The web client

The client is everything under `public/`: a three.js stage behind a DOM interface, served as
static assets through the worker. It has no build step and no framework. ES modules load straight
from `public/`, and three.js is vendored and resolved with an import map:

```html
<script type="importmap">{ "imports": {
  "three": "/vendor/three/build/three.module.min.js",
  "three/addons/": "/vendor/three/addons/" } }</script>
```

The client computes no game numbers. Everything it shows comes from the state document
(`GET /api/state`, docs/CONTRACT.md) and the live channel (`/api/live`). Routes, keys and the QC
sandbox are in docs/EVENTS.md, the visual language in docs/DESIGN.md.

Contents: files, boot, data, screens and windows, the stage API, the roster on stage, skins, biomes,
quality tiers, other stage features, offline renders and videos, sound files, the overlay route, the
QC world page, local development and dev pages.

## Files

| Path | What it is |
|---|---|
| `public/index.html` | the one page: import map, stylesheets, `<canvas id="stage">`, `<div id="ui">`, `/app/main.js` |
| `public/app/main.js` | entry: boots the stage and the interface, runs the flow (cold open, character select, world), wires the live channel, the keyboard, the squad shot and photo mode |
| `public/app/stage.js` | the 3D stage: `createStage(canvas, opts)` and its interface |
| `public/app/stage/shared.js`, `util.js` | uniforms and GLSL shared by every shader; small helpers |
| `public/app/stage/atmosphere.js` | sky, light, fog and rain from `realm.sun` and `realm.weather` |
| `public/app/stage/biomes/index.js`, `tropical-coast.js`, `dry-coast.js` | the biome registry and the two realms |
| `public/app/stage/water.js` | the sea: surface, shoreline, reflections |
| `public/app/stage/platform.js` | the dais the character stands on, with its lanterns |
| `public/app/stage/character.js` | who stands on the dais: models, stand-ins, the code-drawn companion and guild, body morphs, outfits, the squad line |
| `public/app/stage/activity.js` | the activity mirror: clips and props per activity |
| `public/app/stage/camera.js` | the camera director: one shot per mode, transitions, the ambient programme |
| `public/app/stage/globe.js` | the globe of the map mode (coastlines from `stage/data/land-110m.json`) |
| `public/app/stage/fx.js`, `life.js` | pulses and particles; birds, butterflies, leaves, spray |
| `public/app/stage/post.js` | the post pipeline: depth of field, bloom, grade, letterbox, fade |
| `public/app/stage/quality.js` | quality tiers and the automatic governor |
| `public/app/stage/snapshot.js` | portrait renders of a roster entry |
| `public/app/audio.js` | sound: Web Audio synth voices, replaced by files in `public/audio/` when present |
| `public/app/diag.js` | client diagnostics posted to `/api/clientlog` |
| `public/app/ui/store.js`, `live.js` | the state store and the live channel |
| `public/app/ui/dom.js`, `icons.js`, `widgets.js`, `tooltip.js` | DOM helpers, the icon set, bars and portraits and slots, tooltips |
| `public/app/ui/title.js`, `select.js`, `hud.js` | the three screens: cold open, character select, world HUD |
| `public/app/ui/panels.js`, `public/app/ui/panels/*.js` | the window manager and one module per window |
| `public/app/ui/menu.js`, `skin.js`, `hudmode.js` | the settings menu, skins, HUD density and ambient mode |
| `public/app/ui/journal.js`, `dayclose.js`, `toasts.js`, `minimap.js` | manual facts, the day-close card, event feedback, the minimap |
| `public/app/ui/people.js`, `connector.js`, `body.js`, `outfits.js` | party cards and the squad board, the party connector, the Body tab, outfits |
| `public/app/ui/photo.js`, `showcase.js`, `overlay.js` | photo mode, the showcase film player, the overlay route |
| `public/app/ui/stage-stub.js`, `dev.js` | a 2D stand-in for the stage; mock-mode helpers |
| `public/app/css/` | `tokens.css` (design tokens per skin), `chrome.css`, `screens.css`, `hud.css`, `panels.css`, `mobile.css`, then further sheets layered on top; the load order is in `index.html` |
| `public/dev/` | `stage.html` (stage test page), `showcase.html` and `showcase-shots.js` (film renderer), `state.mock.json` (mock state) |
| `public/models/`, `public/tex/`, `public/img/`, `public/audio/`, `public/video/` | character models and the stand-in, outfit textures and their manifest, portraits and icons, sound files, pre-rendered videos |
| `public/vendor/three/` | three.js and its addons |

Every file sits behind the same sign-in as the page (the worker runs first for assets).

## Boot

1. `index.html` applies the overlay class and the saved skin before first paint, and renames the
   page from the worker's meta tags (see "Page meta tags").
2. `main.js` checks `?overlay=1`. With it, only `ui/overlay.js` runs (no stage, no audio).
   Otherwise `boot()` runs.
3. `boot()` creates a stage proxy at once. Calls made before the real stage exists are queued, and
   a stage method that throws never breaks the interface. The stage (`/app/stage.js`) and the state
   (`GET /api/state`) load in parallel; a veil ("Reaching the realm") lifts when the state has
   answered, with a document or with an error.
4. If `/app/stage.js` cannot be imported or `createStage` throws, `ui/stage-stub.js` takes its
   place (a 2D sky and silhouette with the same interface) and a "Stage stub" tag is shown. If
   WebGL itself is unavailable, `createStage` returns a stage that draws nothing and whose promises
   still resolve.
5. The first screen is the cold open (`title`), unless this browser was already in the game today:
   then it returns to the last screen and window (`localStorage` `wog.last`). `?screen=title|select|world`
   forces one; `?screen=world&panel=<id>&tab=<tab>` opens a window directly.
6. The live channel connects, and the store's subscribers push each new state into the stage:
   `setRealm(state.realm)`, `setRoster(state.characters)`, `setVitals(...)` (a map of
   `character.vitals` by id), `setPlaces(state.world)`, `setActivity(character.activity.name)`,
   `setBody(...)` from `character.body`. Each is sent only when its value changed.

## Data

### The state document

`ui/store.js` holds one document, the last good answer of `GET /api/state`, and the one before it.
`store.status` is `boot`, `ok`, `error` or `auth`.

- The request is same-origin with credentials, never follows a redirect, and times out after 12
  seconds.
- A 401, a 403 or a redirect means there is no owner session: status `auth`. The cold open then
  reads "Session expired" with a "Sign in again" button (a reload, which sends the browser back
  through the sign-in in front of the worker).
- Any other failure is status `error`: "No signal from the realm" with "Try again".
- Other reads go through the same helper and return null when they cannot be read:
  `/api/brief?kind=`, `/api/days?limit=`, `/api/log?limit=&cursor=`, `/api/tasks`.
- Writes: `POST /api/act` (the journal and other manual facts, `channel: "web"`), `POST /api/seen`
  (the day-close card was shown), `/api/share` and `/api/peers*` (the Squad & Sharing window,
  docs/MULTIPLAYER.md), `POST /api/clientlog` (diagnostics).

### No signal

The client never invents a value.

- A null in the state is drawn as an empty bar, slot or line labelled "no signal" (`nosig()` and
  the bar widgets in `ui/widgets.js`). It never becomes a zero or a default.
- When the state itself cannot be fetched, the screens say so and keep the last good document on
  screen. The mock file is never a fallback.
- A tooltip on a number ends with its source and age, taken from the state.
- The Signals window lists every entry of `state.signals[]` as live, stale or off, and shows how the
  page itself is connected: Live (socket open), Polling (socket down, state refetched), No signal
  (the state route is not answering) or Mock.
- Stored images (`/api/img/*`) answer GET only. A portrait or photo URL is probed once; a miss is
  remembered for six hours (`wog.img.miss`).

### The live channel

`ui/live.js` opens a WebSocket at `/api/live` (same host, `wss` on https). Messages are JSON:

| Message | What the client does |
|---|---|
| `{ "type": "hello", ... }` | sent once by the engine on connect; ignored |
| `{ "type": "event", "event": {...} }` | adds the entry to the combat log, plays its feedback (below), then refetches the state |
| `{ "type": "activity", "activity": {...} }` | the activity mirror changed ahead of the state: the stage moves at once and `character.activity` is patched |
| `{ "type": "state" }` | refetches the state (a message carrying `state` replaces it directly) |

When the socket opens the state is refetched once to catch up. When it drops, the client reconnects
with backoff (1, 2, 4, 8, 15, 30 seconds, with jitter) and refetches the state every 60 seconds
until the socket is back. It also refetches when the tab becomes visible and when the browser comes
online.

Event feedback, by the log entry's `type` (`main.js`, `handleEvent`; a dotted type is read by its
first word):

| Entry type | Stage pulse | Interface |
|---|---|---|
| `level` | `level` | the full-screen level-up moment |
| `attribute` (an area levelled) | `attribute` | a skill banner |
| `quest` | `quest` | "Quest complete" banner |
| `achievement` | `quest` | the same banner, labelled Achievement |
| `item` | `loot` | a loot line |
| `day` | none | a notice line; the day-close card follows from `day.lastClose` |
| any other entry with severity `bad` or `down` | `damage` | a warning line |
| any other entry with XP | `xp` | a floating XP gain |
| anything else | none | a notice line |

A streak whose `hitThisPeriod` turns true while the world is on screen gets a `streak` pulse and a
line.

### Mock data

All demo values are invented sample data: the places, people, money, body numbers, belongings, dates and tasks in the mock are made up and describe nobody's real life.

`?mock=1` loads `/dev/state.mock.json` instead of the API, with every timestamp shifted so the
document reads as current. `?mock=sparse` loads the same file with a set of metrics nulled, to
judge the "no signal" layouts. Mock mode sends nothing to the engine, shows a "Mock data" tag, and
exposes `window.WOG` (`fire(kind)` simulates an event; `?demo=<kind>` fires one after load). It is
for layout work only.

## Screens and windows

| Screen | What it is | Keys |
|---|---|---|
| `title` | the cold open: a letterboxed title card over the realm fly-over, with place, local time and day of life | any key, click or tap continues; it continues by itself after a short hold |
| `select` | character select: the roster on the right, the chosen entry on the stage, "Enter World" for the playable one, a summary card for the others | arrows choose, Enter enters, Esc opens the menu |
| `world` | the game: the character in the realm, the HUD, the windows | below |

World keys:

| Key | Action |
|---|---|
| `C` `B` `L` `M` `T` `O` `N` `H` `S` | toggle a window (table below) |
| `J` | the journal: mood, mindful minutes, learning, a focus block, sent through `POST /api/act` |
| `A` | ambient mode on or off |
| `P` | photo mode: save a picture of the stage (when no window or menu is open) |
| `Esc` | close the open sheet, journal, menu or window (a window may step back first); with nothing open, the settings menu |

Keys are ignored while typing in a field and with a modifier held. Nothing in the interface is
hover-only (tooltips also open on focus and tap), and it uses no `alert()` or `confirm()`, so the
same page works in a touch browser and inside an app's web view.

### HUD

`ui/hud.js`: the unit frame and buffs top-left, the minimap top-right, the quest tracker down the
right, the combat log bottom-left, the action bar bottom-centre, the XP bar along the bottom edge.

`ui/hudmode.js` keeps the density:

- **Full**: the dense layout. The default on a desktop.
- **Calm**: the character and the realm own the screen and everything else is one tap away. The
  default on a screen 700 px wide or less.
- **Ambient** (key `A`): everything hidden but a level and objective line, for a second screen. The
  stage runs its ambient camera programme.

Each device class remembers its own choice (`wog.hud.desk`, `wog.hud.phone`, `wog.ambient`).
`?hud=full|calm|ambient` forces one.

The minimap is drawn from vendored coastlines (`ui/data/land-50m.json`), centred on the realm's
position. It loads no tiles and makes no third-party request.

### Windows

One window is open at a time. Opening one sets the matching stage mode and passes the stage the
rectangle left free (`opts.clear`).

| Window id | Key | Title | Stage mode | Tabs |
|---|---|---|---|---|
| `character` | `C` | Character | `sheet` | Summary, Skills, Wardrobe, Body, Achievements |
| `bags` | `B` | Bags | `bags` | |
| `quests` | `L` | Quest log | `quests` | |
| `map` | `M` | Map | `map` | |
| `treasury` | `T` | Treasury | `treasury` | |
| `party` | `O` | Party and guild | `party` | |
| `needs` | `N` | Needs | `needs` | |
| `chronicle` | `H` | Chronicle | `quests` | Days, Combat log |
| `signals` | `S` | Signals | `world` | |
| `share` | none | Squad & Sharing | `party` | |

A window module (`ui/panels/<id>.js`) exports `{ id, title, icon, mode, tabs?, frameless?, create(app) }`.
`create` returns a view with `render(root, state, ctx)` and optionally `key(k)`, `back()`,
`focusPlace(id)`, `onOpen(opts)`, `onClose()`, `modeOpts()`. To add a window, write the module and
list it in `DEFS` in `ui/panels.js`.

What some of them do beyond listing the state:

- **Character, Body tab** (`ui/body.js`): a timeline of `character.body.history` that can be
  scrubbed or played. The selected day's reading goes to `stage.setBody(...)`, so the figure on the
  dais takes that day's shape; leaving the tab or closing the window puts the current body back. A
  day without a body-fat reading carries the last one forward and says so.
- **Character, Wardrobe tab**: the Looks list offers outfits from `/tex/outfits.json`. Choosing one
  calls `stage.setOutfit(id)`. The choice is kept on the device (`wog.outfit`); it is not an event.
- **Party and guild**: the companion, the guild and the party. The Connector lays every party
  member against a chosen quest by plain word overlap between the quest and the contact's own
  fields; nobody is scored. The five picks per quest stay on the device (`wog.connector.<questId>`).
  "Squad shot" and "On the dais" are described under "The squad shot".
- **Needs**: where the player has arrived, the pyramid with the held tier marked (`needsFocus`), and
  the place's rebuild quests inside the tier each serves.
- **Chronicle**: finished days as a grid of grades (`GET /api/days`) and the full log with paging
  (`GET /api/log`).
- **Squad & Sharing**: the interface to peering (docs/MULTIPLAYER.md).

### Settings menu

`ui/menu.js` (Esc with nothing open): skin; in the world, HUD density, Ambient and Squad & Sharing;
sound on or off; the showcase film; Character select and "Replay the cold open".

### Day close

When `day.lastClose.seen` is false, `ui/dayclose.js` shows the day-close card on the next visit to
the world (not in ambient mode). Dismissing it calls `POST /api/seen`.

## Stage API

The stage owns one full-viewport `<canvas>` behind the DOM. It reads the network only for model
and texture files; all data arrives through these calls.

```js
import { createStage } from "/app/stage.js";
const stage = await createStage(canvas, { quality: "auto" });   // "low" | "mid" | "high" | "auto"

stage.setRealm(state.realm);          // place, country, sun { altitude, azimuth, phase }, weather
stage.setRoster(state.characters);    // the roster (see "The roster on stage")
stage.setCharacter(id);               // which roster entry stands on the dais
stage.setVitals({ health: 82, energy: 40 });   // 0..100 or null, by vital id; drives mood (aura, colour, particles)
stage.setPlaces(state.world);         // places for the globe
stage.setActivity(name);              // idle | walking | training | sleeping | working | eating | celebrating
stage.setBody({ weightKg, bodyFatPct, leanKg, goal });   // body morphs of the player's model
stage.setOutfit(id);                  // an outfit's texture set; "base" is the model's own
stage.setSkin(id);                    // operative | pandora | azeroth: accent colours and grade
stage.setAmbient(on);                 // the ambient camera programme
stage.setAudioSource(fn);             // fn() -> 0..1 sound level; lanterns and particles follow it
stage.setMode(mode, opts);            // Promise: resolves when the camera move ends (false when superseded)
stage.pulse(kind);                    // xp | level | quest | loot | damage | attribute | streak
stage.snapshot(id, { size, framing });   // Promise<data URL | null>: a portrait render ("portrait" | "full")
stage.capture({ scale, maxPixels });  // Promise<Blob | null>: a PNG still of the current picture
stage.setGhost(on);                   // the goal body beside the character in sheet mode; returns whether it is shown
stage.squadAvailable();               // whether anyone could stand in the squad shot
stage.getInfo(); stage.getModelInfo(); stage.getModelLog(); stage.getLetterbox();
stage.on(type, fn); stage.off(type, fn);
stage.resize(); stage.setQuality(q); stage.dispose();
```

Events (`stage.on`): `progress` (loading, 0..1), `pick` (`{ kind: "character", id }` or
`{ kind: "place", id, name, lat, lon }`), `mode` (`{ mode, prev }`), `quality`
(`{ tier, scale, auto, reason?, frameMs?, pixelRatio? }`), `model` (`{ id, progress, standin, kind }`),
`modeldiag` (one record per model load attempt), `contextlost`, `contextrestored`.

Modes, and where the interface needs clear space:

| Mode | Shot | Interface occupies |
|---|---|---|
| `title` | a wide establishing fly-over of the realm, letterboxed | centre title |
| `select` | the character full body on the dais, slow orbit; drag rotates the character | right third (roster), bottom centre (button) |
| `world` | three-quarter shot of the character in the realm, with the activity | top-left, top-right, right edge, bottom |
| `sheet` | the character centred, closer, neutral light | left and right columns |
| `bags` | the character pushed to the left third | right two thirds |
| `map` | the globe; `opts.focus = { lat, lon }` flies to a place | left column |
| `treasury`, `quests`, `party`, `needs` | one shared shot: the world, dimmed and blurred | centre panel |
| `squad` | the character with the party members who have a body, facing a slow group camera | bottom centre line |

An unknown mode falls back to `world`. `opts.clear = { x, y, w, h }` (CSS pixels) on `select`,
`sheet`, `bags`, `map` and `world` frames the subject whole inside that rectangle; it is kept as
viewport fractions, so a resize re-frames by itself. `setMode("title", { instant: true })` skips to
the settled frame. In `select`, `sheet` and `bags` a drag rotates the character and the wheel or a
pinch zooms; in `map` they turn and zoom the globe.

## The roster on stage

`setRoster` takes `state.characters` as it is. The fields the client uses:

| Field | Meaning |
|---|---|
| `id` | `gun` (the player), `companion`, `guild`, or a contact id for a partner or squad member |
| `kind` | `person`, `ai` or `guild` |
| `name`, `title`, `class`, `level`, `location`, `status` | shown on the select screen and in portraits |
| `playable` | true for the player only: the entry that can enter the world |
| `model`, `modelLite` | paths of the 3D body; present only when the file is deployed |
| `portrait` | path of a portrait image; present only when the file is deployed or stored |
| `color` | optional accent for the aura |

How an entry is drawn:

- **person with `model`**: that file, rigged, playing its `idle` clip. On tiers below `high` the
  stage tries `modelLite` first and falls back to `model`.
- **the playable person without `model`**: the stage tries `/models/<id>.glb`.
- **any other person without `model`**: no file is requested. The figure is the stand-in
  (`/models/standin.glb`) presented as an unrevealed silhouette.
- **`ai`** (the companion): an orb-and-gimbal construct built in code.
- **`guild`**: a standard with a banner and a crest built in code.

When `kind` is missing the stage falls back to the id (`companion`, `guild`), then to the class
text, then to `person`. A model that is missing, half-written or unparsable falls back to the
stand-in without an error on screen and is tried again later (and whenever the page becomes
visible, comes online or regains focus); the real model then replaces the stand-in with no code
change. Every attempt is recorded (`getModelLog()`, the `modeldiag` event) and reaches the engine
through `diag.js`.

Only the playable character mirrors the activity (`setActivity`): the clip of that name if the rig
has it, else a close relative, else the idle clip re-timed, with props and particles either way. A
non-playable entry chosen on the select screen idles. The body morphs (`lean`, `heavy`, `muscular`)
and the outfit texture sets apply to the player's own model only.

Portraits (`ui/widgets.js`, `portrait()`): the entry's `portrait` image when it loads; otherwise,
for an entry with a `model` or the playable one, a render from `stage.snapshot(id)`; otherwise a
glyph for its kind.

## Skins

Three skins: `operative` (the default), `pandora`, `azeroth`. A skin changes chrome only (colours,
borders, ornament, type), never layout or data. All chrome reads CSS custom properties set per skin
in `css/tokens.css` through the `data-skin` attribute on `<html>`. The stage follows with
`setSkin`: accent colours (rim light, dais inlay, aura, particles, globe) and the film grade of
shadows and highlights.

Which skin applies, first match wins: `?skin=<id>`, the saved choice (`wog.skin`), the world's
default (`<meta name="wog-skin">`), `operative`.

## Biomes

A biome is the realm the stage draws. `stage/biomes/index.js` lists them (`tropical-coast`,
`dry-coast`). Which one is drawn is an explicit setting and is never guessed from a place name: on
every `setRealm` the stage uses `realm.biome` when the realm carries one (the engine does not set
it; the dev pages do), else the world's default (`<meta name="wog-biome">`, from `DEFAULT_BIOME`),
else `tropical-coast`. A change of biome happens under a dip to black; the dais, character and
camera move with it.

A biome module exports `id`, `label`, `heading` (compass azimuth of local -Z),
`moon`, an optional `sky` and `create(ctx)`, which returns
`{ group, anchor, titlePath, titlePathTall?, heightAt, update(dt, time, camera, atmosphere), setQuality(tier), dispose() }`.
To add one, write `stage/biomes/<name>.js` with that shape and list it in `BIOMES`.

The sky is not part of the biome: sun position, phase and weather come from `realm.sun` and
`realm.weather` (`stage/atmosphere.js`), and weather changes cross-fade over several seconds.

### Page meta tags

The worker writes three optional tags into the page head from its vars (`src/index.js`):

| Tag | From | Used by |
|---|---|---|
| `<meta name="wog-name">` (and `<title>`) | `WORLD_NAME` | `index.html`: the document title, the install title and the web manifest name |
| `<meta name="wog-skin">` | `DEFAULT_SKIN` | `ui/skin.js`: the skin a fresh browser starts with |
| `<meta name="wog-biome">` | `DEFAULT_BIOME` | `stage/biomes/index.js`: the realm drawn while there is no realm, and the fallback |

## Quality tiers

`stage/quality.js`:

| Tier | Max DPR | Scale | Pixel cap | MSAA | Bloom levels | DoF | Light shafts | Shadow map | Particles | Near water | Reflections |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `low` | 1.25 | 0.8 | 1.3 MP | 0 | 4 | no | no | none | 0.35 | no | no |
| `mid` | 1.6 | 1.0 | 2.2 MP | 2 | 5 | yes | yes | 1024 | 0.7 | yes | no |
| `high` | 2.0 | 1.0 | 2.6 MP | 4 | 6 | yes | yes | 1024 | 1.0 | yes | yes |
| `ultra` | 2.0 | 1.0 | none | 4 | 6 | yes | yes | 2048 | 1.0 | yes | yes |

`ultra` is for offline rendering only; `auto` never picks it. The pixel cap limits the internal
HDR render size, and the composite pass scales it to the canvas. On a dense display the live tiers
use at most two MSAA samples.

`quality: "auto"` (the default; `?quality=low|mid|high|auto` on the page):

- **Start**: `mid` on a touch device or a small screen; otherwise `high` with 8 or more cores, else
  `mid`. On battery, where the browser reports it, `high` starts as `mid`.
- **The governor** reads frame intervals in windows of 120 frames. After two slow windows in a row
  (median over 19.5 ms, or the 90th percentile over 30 ms) it steps down: a desktop gives up render
  scale first (1.0, 0.85, 0.7) unless it is far over budget, a phone gives up a tier first. After
  about ten calm seconds it tries one step back up; a step up that does not hold becomes the
  ceiling for the session. It pauses around model loads, shader compiles and biome swaps.
- A display locked to 30 Hz is recognised: after two steps that change nothing the governor returns
  to the starting tier and stops.
- A phone always gets a drawing buffer of up to 2x and never renders below 1.5x CSS pixels; effects
  go first.
- In ambient mode, after three minutes untouched, the stage runs one tier down until a pointer
  touches the canvas or ambient ends. While the showcase film plays, the stage runs at `low`.

`stage.getInfo()` reports the tier, scale, pixel ratio, frame time, draw calls and the GL renderer.
`diag.js` posts one `boot` record per page load, a `quality` record whenever the governor changes
tier, and a `model` record for a model load that failed or needed a retry (docs/EVENTS.md, client
diagnostics).

## Other stage features

### The ambient programme

`setAmbient(true)` (or `setMode("world", { ambient: true, orbit: true })`) runs a programme of
composed set-ups in the world that cross-dissolve: wide establishing, three-quarter front, close on
the upper body, over the shoulder out to sea, low through the grass, a long lens, a close portrait
orbit, a crane, and the squad. Each holds about half a minute. The squad set-up is taken only while
at least one party body exists.

### The squad shot

`setMode("squad", { ids, standins, clear })`: the character stays in the middle of the dais and the
roster's other persons that carry a `model` (or `opts.ids`) stand either side, each with its own
idle and a name plate, facing a slow group camera. Members whose file is missing are left out
unless `opts.standins`. The line is capped at 2 extra bodies on phones and on `low`, 3 on `mid`, 4
on `high`. Activity clips and props pause for the shot.

In the interface (`main.js`): the Party window's "Squad shot" button, enabled once a member's body
is deployed, and "On the dais" on a member's card (that member alone, in the `sheet` shot). Both
hide the HUD and windows and show one line naming what is on screen (`app.showcaseStart(kind, id)`,
`app.showcaseEnd()`, `#ui[data-stageshow]`). Any key or tap returns to the world.

### Photo mode

`stage.capture({ scale = 2, maxPixels = 16e6 })` renders one still of whatever the stage shows at
up to twice the drawing buffer, through the post stack at the `high` settings for that one frame,
and returns a PNG blob. Sizes and quality are restored at once, so the running picture pays a
single frame. `ui/photo.js` captions it (the wordmark bottom-left, the date bottom-right) and, on a
touch device that can share files, opens the share sheet with `world-of-gun-<kind>-<date>.png`;
otherwise it downloads the file. Nothing leaves the device unless a share target is picked. Key `P`
in the world, or the camera button in the squad line. A stage that cannot capture returns null and
the interface says so.

### Sound-reactive stage

`audio.level()` (a 0..1 level read after the master gain, so mute reads as silence) reaches the
stage through `setAudioSource`, wired once in `main.js`. The lanterns brighten and the idle
particles thicken with it. Nothing changes while sound is off.

## Offline renders and videos

`createStage(canvas, { quality: "ultra", offline: true })` is a deterministic mode for rendering,
not for the page: no animation-frame loop and no governor. `stage.step(dt)` advances the stage clock
by exactly `dt` seconds, updates everything and renders one frame; read the canvas back in the same
task. `stage._internal.director.cine = (shot, t, mode, director) => boolean` lets a render script
rework the composed shot each frame.

Two sets of pre-rendered files in `public/video/` are made this way. Both are optional; the client
works without them.

- **The cold open**: `scripts/cinematic/render.mjs` drives `/dev/stage.html` and writes
  `cold-open-<day|golden|night>.mp4` with a poster `.jpg`, plus `-tall` versions for an upright
  phone. `ui/title.js` plays the variant for `realm.sun.phase` under the title while the live stage
  sits on its settled title frame, then cross-fades into the live canvas. It plays only when the
  realm is drawn in the biome the videos were rendered from (`tropical-coast`), and never with `?nocine=1`,
  with the browser's data-saver on, or when the video is not playing within 1.5 seconds: in each of
  those cases the live fly-over runs instead. The video is a cinematic of the realm, never data.
- **The showcase film**: `scripts/cinematic/showcase.mjs` drives `/dev/showcase.html` with the shot
  list in `public/dev/showcase-shots.js` and writes `showcase.mp4` and `showcase-tall.mp4`
  (`scripts/cinematic/score.mjs` generates the score). `ui/showcase.js` plays it full screen from
  the settings menu: Esc closes, Space or a tap pauses, an upright phone gets the tall file. When
  the file is missing the player says the film is not available in this build.

Each script's header lists its options.

## Sound files

`audio.js` synthesises every sound with the Web Audio API. A file at `/audio/<name>.mp3` replaces
the synth voice for that name when it exists: `tick`, `panel-open`, `panel-close`,
`quest-complete`, `level-up`, `coin`, `ambient-day`, `ambient-night`, `theme`. The files in
`public/audio/` are rendered from code by `scripts/audio/render.mjs` and encoded by
`scripts/audio/encode.sh`.

- Nothing sounds before the first user gesture. Mute persists (`wog.muted`).
- The theme plays on the cold open and character select, the ambience in the world. A sun phase
  crossing into or out of the night swaps the ambience bed under a fade (`audio.ambientPhase`).
- A file that is absent is remembered for six hours (`wog.audio.miss`), so a world without files
  does not ask for nine of them on every load.

## The overlay route

`/?overlay=1` draws the player's stats on a transparent page with no stage and no audio, for a
stream or video overlay: portrait, name, level, class and title, place and activity, XP with
today's gain, the meters, the vitals, the day (number, grade, quests, readiness), streaks alive and
the current quest. It reads the same state and live channel.

| Parameter | Values |
|---|---|
| `pos` | `tl`, `tr`, `bl` (default), `br` |
| `scale` | 0.5 to 3 |
| `show` | a comma list of `head`, `xp`, `meters`, `vitals`, `day`, `streaks`, `quest` (default: all) |
| `compact=1` | `head`, `xp` and `quest` only |
| `skin`, `mock` | as on the main page |

## The QC world page

The QC sandbox (docs/EVENTS.md) has its own page: `/?world=qc` or `/?world=qc-<name>`. The client
has no sandbox code of its own. The worker (`src/index.js`) rewrites the page so that it cannot
touch production:

- `<html data-world="qc-<name>">` and `<meta name="wog-world" content="qc-<name>">`.
- An inline script sets `window.__WOG_WORLD__` and wraps `fetch` and `WebSocket`, so every
  same-origin `/api/` call and the live socket carry `world=qc-<name>`.
- A `#qc-world-tag` element ("QC WORLD", plus the sandbox name) is added to the body. The client's
  stylesheet draws a striped border around any page with `data-world^="qc"` and moves its own tags
  out of the way.
- Every answer from a sandbox carries the `x-world` header.

`diag.js` passes the `world` query parameter on to `/api/clientlog` by itself.

## Local development

- `wrangler dev` with `DEV=1` in `.dev.vars` makes every request an owner session, so the page
  opens without a sign-in. Never set `DEV` on a deployed worker.
- Page parameters: `?mock=1`, `?mock=sparse`, `?demo=<kind>` (mock only), `?stage=stub`,
  `?quality=`, `?screen=`, `?panel=` and `?tab=`, `?hud=`, `?skin=`, `?nocine=1`, `?overlay=1`,
  `?world=qc[-name]`.
- Check a change at a desktop size (1440x900) and a phone size (390x844, touch, safe areas).
- For screenshots, `playwright` is a dev dependency. Launch headless Chromium with WebGL enabled
  (for example `--enable-webgl --ignore-gpu-blocklist`, plus `--use-angle=metal` on macOS).
  `scripts/smoke.mjs` is a ready example.

### `/dev/stage.html`

The stage alone, with a control panel for modes, sun phases, weather, roster entries, pulses,
activities, realms, quality and skins. `window.stage` is the stage, and `window.stage._internal`
exposes the director and the characters for scripted checks. Parameters:

| Parameter | Meaning |
|---|---|
| `mode` | the mode to open in (default `title`) |
| `char` | the roster entry on the dais |
| `realm` | `tropical-coast` or `dry-coast`: a test realm for each biome |
| `phase`, `weather`, `sun=alt,az` | the sky |
| `act` | the activity |
| `skin`, `q` or `quality` | skin and tier |
| `offline=1` | offline stepping (`stage.step`) |
| `ui=0` | hide the control panel |
| `squad=<ids>`, `standins=1` | add roster entries with `/models/<id>.glb` for the squad shot (no such bodies ship with the repo; add your own); stand-ins for missing files |
| `outfit=<id>` | an outfit texture set |
| `bw`, `bf`, `ghost=1` | body weight and body fat for the morphs; the goal ghost |
| `t=1`, `dur`, `focus=lat,lon` | instant mode entry, a move duration, a map focus |
| `guides=1` | draw the interface's clear-space guides |

### `/dev/showcase.html`

The renderer page for the showcase film. `window.show.setup(name)` builds the stage for one shot,
`window.show.frame(dt)` advances and returns a frame; `?tall=1` lays the shot out for the upright
version.

### `/dev/state.mock.json`

The mock state for `?mock=1`. It follows docs/CONTRACT.md. All demo values are invented sample data: the places, people, money, body numbers, belongings, dates and tasks in the mock are made up and describe nobody's real life.
