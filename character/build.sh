#!/bin/bash
# Re-run the pipeline from the sheet images to work/out/gun.glb + gun.usdz. See README.md.
# Nothing in public/ is touched; run ./publish.sh after verifying.
#   ./build.sh [from_step]   1 mesh, 2 clay guides + view alignment, 3 textures, 4 rig + clips + morphs, 5 export
# CHAR=<name> ./build.sh [from_step]   builds a second character instead (config people/<name>/config.json, work
#   under $WOG_PEOPLE/<name>/work, outputs <name>.glb and <name>-lite.glb there; no USDZ). The main character's build
#   is unchanged when CHAR is unset.
# Needs config.json (copy config.example.json and fill in your own pixel picks) and the source sheets in sheets/ (README).
set -euo pipefail
cd "$(dirname "$0")"
B="${BLENDER:-blender}"      # path to the Blender executable (5.x), or a bpy wrapper (README, Requirements)
FROM="${1:-1}"
ACTIVITY_CLIPS="sleeping working eating training walking celebrating"
# NAME is the id the client looks up: public/models/<NAME>.glb (the engine's internal id for the player's character is "gun")
if [ -n "${CHAR:-}" ]; then W="${WOG_PEOPLE:-$PWD/work/people}/$CHAR/work"; NAME="$CHAR"; else W=work; NAME=gun; fi
if [ -z "${CHAR:-}" ] && [ ! -f config.json ]; then echo "config.json is missing: cp config.example.json config.json and fill in your own pixel picks (README, Landmarks)"; exit 1; fi
export CHAR="${CHAR:-}"
run() {
  echo "== blender $*"
  local log; log=$("$B" -b "$@" 2>&1) || true
  echo "$log" | grep -E "Traceback|^  File|Error:|^clip|^skin|^morph|^tris|^fill|^class|baked|low tris|exported|body-only" || true
  if echo "$log" | grep -q "Traceback"; then echo "step failed"; exit 1; fi
}
if [ "$FROM" -le 1 ]; then ./prep.sh cut; run --factory-startup --python scripts/blender/01_build_mesh.py; fi
if [ "$FROM" -le 2 ]; then run "$W/stage1.blend" --python scripts/blender/02_clay_views.py; if [ "${PAINT_STOP:-}" = 1 ]; then echo "clay views written: paint them, then ./build.sh 3 (PAINT_STOP)"; exit 0; fi; ./prep.sh align; fi
if [ "$FROM" -le 3 ]; then ./prep.sh cut; ./prep.sh align; run "$W/stage1.blend" --python scripts/blender/03_texture.py; fi
if [ "$FROM" -le 4 ]; then
  # face landmarks off the bust sheet (mediapipe) for the blink / smile / brow morph targets (a second character has no bust sheet)
  if [ -z "${CHAR:-}" ] || [ "${CHAR:-}" = gun ]; then
    [ -f "$W/face_landmarks.json" ] || uv run -q --with mediapipe --with pillow python scripts/face_landmarks.py sheets/bust_front.png "$W/face_landmarks.json" 2>&1 | grep -E "^(tasks|solutions)|Traceback"
  fi
  run "$W/stage2.blend" --python scripts/blender/04_rig.py
fi
if [ "$FROM" -le 5 ]; then
  mkdir -p "$W/out"
  run "$W/stage3.blend" --python scripts/blender/05_export.py -- "$W/out/$NAME.glb"
  if [ -z "$CHAR" ]; then run "$W/stage3.blend" --python scripts/blender/06_export_usdz.py; fi
  # phone-tier model: decimated, 1K textures, activity clips only; then quantized + meshopt-compressed
  run "$W/stage3.blend" --python scripts/blender/07_export_lite.py -- "$W/out/$NAME-lite.raw.glb"
  if npx -y gltfpack@1.3.0 -i "$W/out/$NAME-lite.raw.glb" -o "$W/out/$NAME-lite.glb.tmp.glb" -cc -kn -km -ke >/dev/null 2>&1; then
    mv -f "$W/out/$NAME-lite.glb.tmp.glb" "$W/out/$NAME-lite.glb"
  else
    echo "gltfpack unavailable: shipping the uncompressed lite model"; cp "$W/out/$NAME-lite.raw.glb" "$W/out/$NAME-lite.glb"
  fi
  if [ -z "$CHAR" ]; then
    # one USDZ per activity clip for the Apple TV app (USD has one time line per file); 1K textures
    for c in $ACTIVITY_CLIPS; do
      run work/stage3.blend --python scripts/blender/06_export_usdz.py -- "$c" "work/out/gun-$c.usdz" 1024
    done
  fi
fi
python3 scripts/inspect_glb.py "$W/out/$NAME.glb"
ls -la "$W/out/$NAME-lite.glb" | awk -v n="$NAME" '{printf "%s-lite.glb %.2f MB\n", n, $5/1e6}'
if [ -z "$CHAR" ]; then
  usdchecker --arkit work/out/gun.usdz | tail -1
  for f in work/out/gun.usdz work/out/gun-*.usdz; do usdchecker --arkit "$f" 2>/dev/null | tail -1 | tr '\n' ' '; ls -la "$f" | awk '{printf "%s %.2f MB\n", $9, $5/1e6}'; done
fi
