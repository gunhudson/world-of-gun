# World of Gun: design

## What it is

A game client whose server is real life. The world on screen is where the player is (the place,
the local sun, the weather). The character is the player. Bars move because a body, a bank
balance and a task list moved. Playing means doing the thing in the physical world; the
interface only shows state, offers the next quest, and celebrates what the sensors saw.

It is an MMORPG interface over one person's own data: character select with a 3D character,
clothes and belongings as equipment and bags, tasks as quests, health and money as bars.
It is not a different game to play instead of living. It is the screen for the game already
being played.

## Origin: a thread from February 2022

The design starts from a public thread by Gun Hudson, 24 February 2022
(https://x.com/gunhudson/status/1496782040007540737):

> Q: if you were to design a 'computer game' for your life… what would your dashboard include?

The thread carries a handwritten "Dashboard View" sketch. Its layout is the one this project
honours:

- Left: a **ONE THING (current Q)** box with a progress bar; a list of other quests with % bars;
  daily quests with % bars; categories of quests (Health, Wealth, Relationships, Spiritual,
  Hobbies, Learning / Skills).
- Centre: a **rotating 3D character** of the player. "Lvl 2: recapture weekly to see body
  progress… real-life 3-d model so I can see my body → inspire 'health upgrades'". "Lvl 3: can
  interact & dress me / choose outfits", with the player's own clothes.
- Right: an **Inventory** grid (clothes, tools), then the **% bars**, in this order: money
  (cashflow), energy, sleep, social / interactions cup, personal care, happiness,
  self-connection, giving / support (karma), learning / expansion.
- Bottom: **"Tie → My CRM to 'My Party' for X Quests"**: person cards, grouped in views (family,
  squad, company, clients, and so on). Stats per person: Strengths, Weaknesses, Location, Last
  Contacted, Support → Them? → Me?. "This view is to both view my party, but also to design
  complimentary parties [connector]".

Other parts of the thread, and what they became here:

- "online Virtual Assistant team who are supporting me to 'play the game with my character'…
  ideas: camera glasses? earpiece? AirPods? MVP: phone voice notes". Today that role is the AI
  companion on the roster, with voice and small devices as its inputs (`POST /api/act`).
- "heads-up display of my 'game of life' into glasses? upon reflection I prefer to play life
  without the heads-up display". So the interface is somewhere to go and look, plus light
  ambient surfaces (a widget, a watch face). It does not nag.
- "an instagram / Snapchat filter that auto-adds your stats… or a YouTube channel with the
  dashboard overlay". That is the transparent stream-overlay route of the client.
- On a picture of the needs pyramid: "to help me rebuild all my needs whenever I travel… an
  effective tool to know what quests / systems to build out in what order". So the Needs screen
  resets on arrival in a new place and issues the rebuild quests in order.

The Character screen is that Dashboard View, built as a game screen.

## Principles

- **Reality is the only input.** Every number comes from a device, an account or a record, and
  carries its source and time. No signal is shown as "no signal", never as zero. There is no
  button that grants XP. (docs/CONTRACT.md, "Rule zero".)
- **Readiness multiplies everything.** Health is treated as a multiplier on the ability to use
  every other resource, so the day's readiness (sleep, HRV, resting heart rate against the
  player's own baseline) scales every XP grant earned that day.
- **Needs unlock upward.** The needs hierarchy is a locked progression: growth needs unlock once
  deficiency needs are handled, and a need with no signal has not been shown to be handled.
- **Ten areas of life** are the attributes: Strategy, Body, Mind, Things, People, Joy, Wealth,
  Connection, Growth, Impact. A task names its area; XP goes there.
- **One main quest.** The one objective that matters most right now, with dated anchors. Its
  title, text and numbers come from `quest.progress` events.
- **A loot loop, not a hoard.** One equipped item per slot. An upgrade means compare, swap, and
  let the old one go; letting go earns XP too. An empty slot can show the quest that would fill it.
- **Skins are a toggle.** A skin changes the interface chrome and the stage accents, never the
  layout or the data. Default **Operative** (black, gold, sleek, restrained). Also **Pandora**
  (bioluminescent teal and magenta) and **Azeroth** (ornate, warm frames).
- **The sandbox is part of the product.** Every deployment has a QC world beside the real one, so
  clients and collectors are tested against fictional data and never against a real life
  (docs/EVENTS.md, "Test against the QC world").

## Screens

1. **Cold open, then Character Select.** A letterboxed fly-in over the realm (the real location,
   the real sky), the title, then the select screen: the character on a stage, name / level /
   class / location on the right, the realm name at the bottom, ENTER WORLD.
   Roster: the player (playable), the AI companion (with the real status of the machines it runs
   on), a partner if there is one, the guild, then squad members. Non-playable entries open
   their own sheet.
2. **World (HUD).** The character in the realm. Unit frame top-left (portrait, level, bars), buffs
   under it, minimap top-right (real position), quest tracker on the right, combat log
   bottom-left (real events), action bar at the bottom, XP bar along the bottom edge.
3. **Character (C).** Paper doll: the 3D character in the centre, equipment slots on both sides
   filled from real belongings, attributes, body stats.
4. **Bags (B).** Bag grids, one bag per real location or container. Rarity borders.
5. **Quest log (L).** Main quest, dailies, weekly, side quests (tasks).
6. **Map (M).** A globe with every place visited, the current position, items stored elsewhere.
7. **Treasury (T).** Gold, runway, income, BTC.
8. **Party / Guild (O).** People and the guild.
9. **Needs (N).** The hierarchy as a locked / unlocked progression.
10. **Signals.** Which devices and feeds are live.

Windows, keys and the stage are specified in docs/CLIENT.md.

## Art direction

- Cinematic first. Slow camera, depth of field, bloom, film grain, vignette, letterbox on
  cinematic beats. 60 fps on a recent laptop and a recent phone; degrade gracefully.
- The realm is rendered as a stylised world in a biome chosen in the settings. Two example
  biomes ship with the project: a tropical coast (ocean, palms, a volcano on the horizon, rice
  terraces) and a dry coast (a river mouth, pale sand, a city across the water). Both are lit by
  the sun position for the realm's coordinates and time, with bioluminescence after dark.
- The interface is MMO frames in a modern material: dark glass panels, thin engraved gold borders,
  corner ornaments, rarity colours (grey / green / blue / purple / orange). Display type: a
  Didone serif with a web fallback; body: Inter; tabular numerals.
- Palette: night indigo #0a0d1c, deep teal #0e3a44, bioluminescent cyan #5ff3e0, magenta #c86bff,
  gold #d4b06a, parchment white #f3ead8, health green #5fd38d, warning amber #f0b34a, danger #e4574f.
- Sound: an ambient bed, interface ticks and a main theme. Off until the first user gesture.
- App icon and favicon: a gold rotating globe.
- Honest states: a metric with no signal shows an empty engraved bar with "no signal", not zero.

## Engine

- One Cloudflare Worker. Sign-in is Cloudflare Access in front of it; one address owns the world.
- A Durable Object (SQLite) holds the event log and the derived state. A five-minute tick runs
  the edge adapters and recomputes. Collectors and phones only push events; the edge owns the
  schedule, the state and delivery.
- `GET /api/state`, `POST /api/ingest`, `GET /api/live` (WebSocket). The state document is in
  docs/CONTRACT.md, events and the machine routes in docs/EVENTS.md, peering between worlds in
  docs/MULTIPLAYER.md.

## Surfaces

The web client (also installable as an app) is in this repository. The same state document and
the small `GET /api/glance` document are meant for native surfaces as well: a phone app with
widgets, a watch, a TV screen, voice. Rings, scales, keypads and room sensors are inputs.
