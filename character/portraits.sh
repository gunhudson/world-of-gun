#!/bin/bash
# Render work/out/gun.webp (512, head and shoulders) and gun-full.webp (760x1280) from work/out/gun.glb through
# verify/index.html on a static server of the repo root (default port 8793: `python3 -m http.server 8793 --bind 127.0.0.1`
# from the repo root). publish.sh ships them to public/img/.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-8793}"
TMP="$(mktemp -d)"
node scripts/shots.mjs "$PORT" "$TMP" "gun|clip=idle&t=0.4&cam=0.22,1.64,1.3&look=0,1.6,0&bg=0&hud=0&fov=22&dpr=2|512x512" "gun-full|clip=idle&t=0.4&view=front&bg=0&hud=0&fov=24&cam=0,1.0,4.6&look=0,0.95,0&dpr=2|760x1280" >/dev/null
for n in gun gun-full; do
  magick "$TMP/$n.png" -quality 86 -define webp:alpha-quality=90 "work/out/$n.webp"
  echo "work/out/$n.webp $(wc -c < "work/out/$n.webp" | tr -d " ") bytes"
done
rm -r "$TMP"
