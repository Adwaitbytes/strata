#!/bin/zsh
# Encode a finished Blender PNG sequence into the film's video slot: assets/video/<slot>.mp4 (30 fps, H.264, CRF 14, keyframe every 0.5 s).
# Usage: tools/ingest_blender.sh <shot_dir_name e.g. b1_terrain_open> <slot e.g. b1> <expected_frames>
set -e
d=assets/blender/$1; slot=$2; want=$3
n=$(ls $d/*.png 2>/dev/null | wc -l | tr -d ' ')
if [ "$n" -lt "$want" ]; then echo "$1: $n of $want frames, not ready"; exit 2; fi
first=$(ls $d/*.png | head -1); pat=$(echo $first | sed -E 's/_[0-9]{4}\.png$/_%04d.png/')
start=$(basename $first .png | grep -oE '[0-9]{4}$')
ffmpeg -loglevel error -y -framerate 30 -start_number $((10#$start)) -i $pat -frames:v $want -c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p -g 15 -movflags +faststart assets/video/$slot.mp4
echo "$slot <- $1: $(ffprobe -v error -show_entries format=duration -of csv=p=0 assets/video/$slot.mp4) s"
