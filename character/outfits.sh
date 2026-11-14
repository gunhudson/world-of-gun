#!/bin/bash
# Outfits: alternate looks for the same body, baked as texture sets. See README.md.
#   ./outfits.sh gen <outfit>      repaint the four body views with the image model (front, back, L, R; a paid API call each)
#   ./outfits.sh bake <outfit>     cut + align the painted views, bake colour against the current mesh (work/stage1.blend),
#                                  bake the lite maps too (work/stage3.blend), publish public/tex/gun_body_<outfit>*.jpg
#   ./outfits.sh all               bake + publish every outfit that has painted views (run after a mesh rebuild)
# Painted views live in work/outfits/<outfit>/ (git-ignored); prompts in prompts/outfits/ (scripts/outfit_prompts.py);
# the manifest the client reads is public/tex/outfits.json. Outfits are defined in outfits.json (see outfits.example.json); outfit_prompts.py writes the prompts.
set -euo pipefail
cd "$(dirname "$0")"
B="${BLENDER:-blender}"
PY="uv run -q --with numpy --with pillow --with scipy python"
CUT="${CUTOUTS:-refs/cutouts}"      # one photo per wardrobe item, named as in prompts/outfits/refs.json (README, Outfits)
cmd="${1:-}"; name="${2:-}"
gen() {
  local o=$1 d=work/outfits/$1; mkdir -p "$d"
  for v in front back L R; do
    [ -s "$d/body_$v.png" ] && { echo "have $d/body_$v.png"; continue; }
    local which=other; [ "$v" = front ] && which=front
    local refs; refs=$(python3 -c "import json,sys; print(' '.join(json.load(open('prompts/outfits/refs.json'))[sys.argv[1]][sys.argv[2]]))" "$o" "$which")
    local files=(); for r in $refs; do files+=("$CUT/$r.jpg"); done
    local extra=(); [ "$v" != front ] && extra=("$d/body_front.png")
    echo "== gen $o $v"
    python3 scripts/gen_image.py openai "${IMAGE_MODEL:-gpt-image-1}" "$d/body_$v.png" "prompts/outfits/${o}_$v.txt" 1024x1536 high "sheets/body_$v.png" ${extra[@]+"${extra[@]}"} "${files[@]}"
  done
}
run() { local log; log=$("$B" -b "$@" 2>&1) || true; echo "$log" | grep -E "Traceback|^  File|Error:|^fill|baked|^outfit|^lite" || true; if echo "$log" | grep -q Traceback; then echo "step failed"; exit 1; fi; }
bake() {
  local o=$1 d=work/outfits/$1
  for v in front back L R; do [ -s "$d/body_$v.png" ] || { echo "missing $d/body_$v.png (run: ./outfits.sh gen $o)"; exit 1; }; done
  mkdir -p "$d/prep"
  for v in front back L R; do HEM_SOLID=1 $PY scripts/prep_images.py "$d/body_$v.png" "$d/prep/body_$v"; done   # HEM_SOLID: grow only solid dark garments, not heather fibres
  for k in body_R body_L; do $PY scripts/align_views.py work/clay/${k}_mask.png "$d/prep/${k}_mask.png" 0 "$d/prep/${k}_align.json"; done
  echo "== bake $o (full)"; OUTFIT="$o" run work/stage1.blend --python scripts/blender/03_texture.py
  echo "== bake $o (lite)"; OUTFIT="$o" run work/stage3.blend --python scripts/blender/07_export_lite.py
  mkdir -p ../public/tex
  $PY scripts/outfit_publish.py "$o"
}
case "$cmd" in
  gen) gen "$name" ;;
  bake) bake "$name" ;;
  all) for d in work/outfits/*/; do bake "$(basename "$d")"; done ;;
  *) sed -n 2,8p "$0"; exit 1 ;;
esac
