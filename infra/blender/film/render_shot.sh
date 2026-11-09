#!/usr/bin/env bash
# Render one STRATA film shot to a 1920x1080 30 fps PNG sequence, then encode the H.264 proxy
# and copy the chosen still. Usage: render_shot.sh <shot_id> <still_frame> [extra blender args]
# Example: infra/blender/film/render_shot.sh b1_terrain_open 150
set -euo pipefail

shot="$1"
still="$2"
shift 2
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
script="$repo/infra/blender/film/shot_${shot}.py"
out="$repo/film/assets/blender/$shot"

[[ -f "$script" ]] || { echo "no script: $script" >&2; exit 1; }
mkdir -p "$out"
rm -f "$out/${shot}"_[0-9][0-9][0-9][0-9].png

start=$(date +%s)
blender -b --factory-startup -P "$script" -- --mode anim "$@" 2>&1 | grep -E "Error|Traceback|Saved:" | sed -n '1p;$p' || true
frames=$(ls "$out/${shot}"_[0-9][0-9][0-9][0-9].png 2>/dev/null | wc -l | tr -d ' ')
[[ "$frames" -gt 0 ]] || { echo "render produced no frames" >&2; exit 1; }
echo "rendered $frames frames in $(( $(date +%s) - start )) s"

ffmpeg -loglevel error -y -framerate 30 -i "$out/${shot}_%04d.png" \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -tune film -movflags +faststart \
  "$out/${shot}.mp4"
cp "$out/${shot}_$(printf '%04d' "$still").png" "$out/${shot}.png"
ls -la "$out/${shot}.mp4" "$out/${shot}.png"
