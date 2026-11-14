#!/bin/bash
# Encodes the rendered WAVs (.render/audio/*.wav, from render.mjs) to public/audio/<name>.mp3 at the target loudness:
# loops (theme, ambient-*) measured with ebur128 and gained to -23 LUFS integrated; effects keep their -6 dBFS peak.
# Prints a table of LUFS, duration and size. Needs ffmpeg with libmp3lame (brew's 9.x does).
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC="${1:-${WOG_WORK:-.render}/audio}"; DST=public/audio; mkdir -p "$DST"
lufs() { ffmpeg -hide_banner -nostats -i "$1" -af ebur128 -f null - 2>&1 | awk '/Integrated loudness/{f=1} f&&/I:/{print $2; exit}'; }
printf "%-16s %8s %8s %8s %8s\n" file target wavLUFS mp3LUFS size
for w in "$SRC"/*.wav; do
  n=$(basename "$w" .wav); out="$DST/$n.mp3"
  case "$n" in
    theme) target=-23; br=96k ;;
    ambient-*) target=-24; br=96k ;;
    *) target=""; br=96k ;;
  esac
  if [ -n "$target" ]; then
    cur=$(lufs "$w"); gain=$(python3 -c "print(round($target - ($cur), 2))")
    ffmpeg -hide_banner -loglevel error -y -i "$w" -af "volume=${gain}dB" -c:a libmp3lame -b:a $br -joint_stereo 1 "$out"
  else
    ffmpeg -hide_banner -loglevel error -y -i "$w" -c:a libmp3lame -b:a $br -joint_stereo 1 "$out"
    cur=$(lufs "$w")
  fi
  printf "%-16s %8s %8s %8s %8s\n" "$n" "${target:-peak}" "$cur" "$(lufs "$out")" "$(du -k "$out" | cut -f1)K"
done
du -sh "$DST"
