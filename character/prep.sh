#!/bin/bash
# Image half of the pipeline. See README.md.
#   ./prep.sh cut     cut every sheet image off its grey backdrop (no dependencies)
#   ./prep.sh align   register the painted side/back views to the clay renders they were painted over
#                     (needs work/build.json from step 1 and work/clay/*_mask.png from step 2)
# CHAR=<name> works on a second character instead of the main one: sheets and work under
# $WOG_PEOPLE/<name>/ (default work/people), config people/<name>/config.json.
set -euo pipefail
cd "$(dirname "$0")"
PY="uv run -q --with numpy --with pillow --with scipy python"
if [ -n "${CHAR:-}" ]; then
  BASE="${WOG_PEOPLE:-$PWD/work/people}/$CHAR"; SHEETS="$BASE/sheets"; WORK="$BASE/work"; CFG="people/$CHAR/config.json"
else
  SHEETS=sheets; WORK=work; CFG=config.json
fi
mkdir -p "$WORK/prep"
SHEET_LIST=$(python3 -c "import json; c=json.load(open('$CFG')); print(' '.join(c.get('sheets', ['body_front','body_back','bust_front','head_R','head_L','head_B','body_R','body_L'])))")
VIEW_LIST=$(python3 -c "import json; c=json.load(open('$CFG')); print(' '.join(c.get('views', ['head_R','head_L','head_B','body_R','body_L'])))")
if [ "${1:-cut}" = "cut" ]; then
  for n in $SHEET_LIST; do
    if [ ! -f "$SHEETS/$n.png" ]; then echo "prep: no $n.png yet (painted later)"; continue; fi
    $PY scripts/prep_images.py "$SHEETS/$n.png" "$WORK/prep/$n"
  done
else
  # head views: compare silhouettes above the chin only (painted clothes drift); body views: whole figure
  ROW=$(python3 -c "
import json
B=json.load(open('$WORK/build.json')); f=B['bust_front']
print((B['chin_z']-f['bz'])/f['az']-15)")
  for k in $VIEW_LIST; do
    case $k in head_*) R=$ROW;; *) R=0;; esac
    $PY scripts/align_views.py "$WORK/clay/${k}_mask.png" "$WORK/prep/${k}_mask.png" "$R" "$WORK/prep/${k}_align.json"
  done
fi
