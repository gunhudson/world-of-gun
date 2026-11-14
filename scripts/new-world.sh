#!/bin/bash
# Stamp out a renamed copy of this repository for your own world: the stand-in figure instead of the demo character,
# your worker name, owner and style in wrangler.toml, and a fresh git repository.
#
#   scripts/new-world.sh <target-dir> [--name "World of Ash"] [--player "Ash"] [--worker world-of-ash]
#                        [--owner ash@example.org] [--skin operative|pandora|azeroth] [--biome tropical-coast|dry-coast]
#
# Left out of the copy: the demo character (its models, portraits, outfit textures), the cold-open videos, git history,
# node_modules and local state. Kept: engine, client, tests, scripts, docs, examples and the character pipeline
# (character/), which you use to build your own figure (character/README.md). Then see docs/SETUP.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"; [ -n "$TARGET" ] || { echo "usage: $0 <target-dir> [--name ..] [--player ..] [--worker ..] [--owner ..] [--skin ..] [--biome ..]"; exit 1; }
shift
NAME="My World"; PLAYER="You"; WORKER=""; OWNER="you@example.org"; SKIN="operative"; BIOME="tropical-coast"
while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;; --player) PLAYER="$2"; shift 2 ;; --worker) WORKER="$2"; shift 2 ;; --owner) OWNER="$2"; shift 2 ;;
    --skin) SKIN="$2"; shift 2 ;; --biome) BIOME="$2"; shift 2 ;;
    *) echo "unknown option $1"; exit 1 ;;
  esac
done
case "$SKIN" in operative|pandora|azeroth) ;; *) echo "skin must be operative, pandora or azeroth"; exit 1 ;; esac
case "$BIOME" in tropical-coast|dry-coast) ;; *) echo "biome must be tropical-coast or dry-coast"; exit 1 ;; esac
[ -n "$WORKER" ] || WORKER="$(echo "$NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
[ -n "$WORKER" ] || { echo "could not derive a worker name from \"$NAME\": pass --worker"; exit 1; }
if [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then echo "$TARGET exists and is not empty"; exit 1; fi
mkdir -p "$TARGET"; TARGET="$(cd "$TARGET" && pwd)"

# 1. everything except the demo character, build output and local state
rsync -a \
  --exclude .git --exclude node_modules --exclude .wrangler --exclude .dev.vars --exclude .env --exclude .render --exclude qc \
  --exclude 'character/work' --exclude 'character/refs' --exclude 'character/sheets' --exclude 'character/people' --exclude 'character/config.json' \
  --exclude 'public/models/gun*' --exclude 'public/img/gun*' --exclude 'public/tex/gun_body_*' --exclude 'public/video/*' \
  "$ROOT/" "$TARGET/"
[ -f "$TARGET/public/models/standin.glb" ] || { echo "public/models/standin.glb is missing from $ROOT"; exit 1; }

# 2. the outfit manifest keeps only the base look (the demo character's wardrobe stays behind)
mkdir -p "$TARGET/public/tex"
cat > "$TARGET/public/tex/outfits.json" <<'JSON'
{ "outfits": [ { "id": "base", "name": "As modelled", "tex": null, "assumed": false, "note": "The look the character was built in.", "items": [] } ] }
JSON

# 3. your name, owner and style in wrangler.toml and package.json (edits the existing lines; adds a missing [vars] key)
WORKER="$WORKER" NAME="$NAME" PLAYER="$PLAYER" OWNER="$OWNER" SKIN="$SKIN" BIOME="$BIOME" TARGET="$TARGET" node --input-type=module -e '
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const e = process.env, t = e.TARGET;
const q = (v) => JSON.stringify(v);
let toml = readFileSync(t + "/wrangler.toml", "utf8");
toml = /^name\s*=.*$/m.test(toml) ? toml.replace(/^name\s*=.*$/m, "name = " + q(e.WORKER)) : "name = " + q(e.WORKER) + "\n" + toml;
const vars = { WORLD_NAME: e.NAME, DEFAULT_SKIN: e.SKIN, DEFAULT_BIOME: e.BIOME, OWNER_EMAIL: e.OWNER, OWNER_NAME: e.PLAYER };
for (const [k, v] of Object.entries(vars)) {
  const re = new RegExp("^" + k + "\\s*=.*$", "m");
  if (re.test(toml)) toml = toml.replace(re, k + " = " + q(v));
  else toml = /^\[vars\]\s*$/m.test(toml) ? toml.replace(/^\[vars\]\s*$/m, "[vars]\n" + k + " = " + q(v)) : toml + "\n[vars]\n" + k + " = " + q(v) + "\n";
}
writeFileSync(t + "/wrangler.toml", toml);
if (existsSync(t + "/package.json")) { const p = JSON.parse(readFileSync(t + "/package.json", "utf8")); p.name = e.WORKER; writeFileSync(t + "/package.json", JSON.stringify(p, null, 2) + "\n"); }
'
printf 'DEV=1\n' > "$TARGET/.dev.vars"     # local play: an implicit owner session, on your own machine only

# 4. a fresh repository
( cd "$TARGET" && git init -q && git add -A && git -c user.name="new-world" -c user.email="new-world@localhost" commit -q -m "A new world: $NAME" )

echo "$NAME -> $TARGET (worker $WORKER, player $PLAYER, skin $SKIN, biome $BIOME, owner $OWNER)"
echo "next: cd $TARGET && npm install && npx wrangler dev      # local play on http://localhost:8787"
echo "then: docs/SETUP.md (sign-in, deploy, collectors, your own character)"
