#!/bin/bash
# Copy the verified build into public/ atomically: write next to the target under a temp name, then
# rename (rename is atomic on the same volume), so a reader never sees a half-written file.
set -euo pipefail
cd "$(dirname "$0")"
put() { local src="$1" dst="$2" tmp; tmp="$(dirname "$dst")/.$(basename "$dst").tmp.$$"; cp "$src" "$tmp"; mv -f "$tmp" "$dst"; echo "published $dst ($(wc -c < "$dst" | tr -d " ") bytes)"; }
python3 scripts/inspect_glb.py work/out/gun.glb >/dev/null           # refuses a broken GLB
put work/out/gun.glb ../public/models/gun.glb
[ -f work/out/gun-lite.glb ] && put work/out/gun-lite.glb ../public/models/gun-lite.glb
put work/out/gun.usdz ../public/models/gun.usdz
for f in work/out/gun-*.usdz; do [ -f "$f" ] && put "$f" "../public/models/$(basename "$f")"; done
[ -f work/out/gun.webp ] && put work/out/gun.webp ../public/img/gun.webp
[ -f work/out/gun-full.webp ] && put work/out/gun-full.webp ../public/img/gun-full.webp
