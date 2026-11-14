# Setup

Your own world from this repository. It is one Cloudflare Worker with one Durable Object; the free plan runs it.

## 1. Play locally

```bash
git clone https://github.com/gunhudson/world-of-gun.git my-world && cd my-world
npm install
cp .dev.vars.example .dev.vars          # DEV=1: an owner session on your own machine only
npx wrangler dev                         # http://localhost:8787
npm test                                 # engine tests
```

A fresh world is empty and honest: every bar says "no signal" until something real feeds it.
Open `http://localhost:8787/?mock=1` to see every screen filled with demo data. All demo values are invented sample data: the places, people, money, body numbers, belongings, dates and tasks in the mock are made up and describe nobody's real life.

To start from a renamed copy with your name and style set, and without the demo character's files:

```bash
scripts/new-world.sh ~/world-of-ash --name "World of Ash" --player Ash --owner ash@example.org --skin pandora --biome tropical-coast
cd ~/world-of-ash && npm install && npx wrangler dev
```

## 2. Identity and style (`wrangler.toml`, `[vars]`)

| Variable | What it sets |
|---|---|
| `WORLD_NAME` | Page title, and the name peer worlds see |
| `OWNER_NAME` | The character's name until a `profile.set` event supplies one |
| `COMPANION_NAME` | The AI companion on the character select screen |
| `GUILD_NAME` | The guild: a company, a team or a household. Balances pushed with owner `guild` roll up here |
| `DEFAULT_SKIN` | `operative` (black and gold), `pandora` (bioluminescent teal), `azeroth` (ornate, warm) |
| `DEFAULT_BIOME` | `tropical-coast` or `dry-coast`: the realm the stage draws. It is a setting, not derived from where you are |

## 3. Sign-in

The worker has no login page of its own. A deployed world answers 401 on every page and session
route until you put Cloudflare Access (Zero Trust, free for up to 50 users) in front of it:

1. Zero Trust dashboard > Access > Applications > Add > Self-hosted. Domain: your worker's
   `workers.dev` address or your own domain. Policy: Allow, include Emails = your address.
   A one-time PIN by email is enough as the identity method.
2. Copy the application's Audience (AUD) tag from its Overview. Your team name is the `<team>`
   in `https://<team>.cloudflareaccess.com`.
3. In `wrangler.toml` set `ACCESS_TEAM`, `ACCESS_AUD` and `OWNER_EMAIL`, then deploy.

The worker verifies the Access token on every request (`src/access.js`) and makes an owner session
for `OWNER_EMAIL`; anyone else Access lets through gets 403. Locally, `DEV=1` in `.dev.vars` is an
owner session. Never set `DEV` on a deployed worker.

Secrets are optional and set with `npx wrangler secret put <NAME>`:
`INGEST_KEY` (collectors push events), `ACT_KEY` (manual facts from voice or a keypad),
`TV_KEY` (a read-only screen), and the three `QC_` equivalents for the sandbox world.

## 4. Deploy

```bash
npx wrangler login                        # or set CLOUDFLARE_API_TOKEN
npx playwright install chromium           # once, for the smoke test
npm run deploy                            # snapshot, tests, browser smoke test, deploy only if both pass
npm run deploy:check                      # the same without deploying
```

## 5. Feed it real data

The world knows only what you push. Three ways in, all documented in `docs/EVENTS.md`:

- `POST /api/ingest` with `x-world-key`: collectors on your own machines. Start from
  `examples/collectors/` (body measurements, balances, tasks, places from plain files).
- `POST /api/phone` with your session: a phone app posting location, mindful minutes and workouts.
- `POST /api/act` with `x-act-key`: facts no sensor can see (a mood, minutes read), said by voice or pressed on a keypad.

Test against a sandbox first: add `?world=qc-yourname` (or the header `x-world`) and use the QC keys.
Rule zero: the world never invents a number. A missing signal shows as missing.

## 6. Your own character

Without a model the client shows the stand-in figure. `character/README.md` describes the pipeline
that built the demo character from photos; it ships without source images, so you bring your own.
Finished files go in `public/models/` and `public/img/`.

## 7. Peering with a friend

`docs/MULTIPLAYER.md` is the whole protocol; in the game it is the Squad & Sharing window.
Each person runs their own world. You switch peering on, tick the few fields you are willing to
share, and exchange a one-time invite code. Each world then pulls the other's signed card.
Nothing is published anywhere, and sharing is off until you turn it on.
