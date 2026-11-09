#!/bin/zsh
# Rebuild every assets/video/<slot>.mp4 the film plays, from the Blender PNG sequences (gitignored) and tools/.
# Real renders: b1, b2, b3, b4, b6 (b6 gets a baked grade: cooler shadows, more contrast).
# Dropped by the render queue, made here instead: b5 (B1 graded from dusk to night, labelled illustration in the film)
# and b7 (a 2D survey merkle tree rendered from tools/b7-fallback).
set -e
cd "$(dirname "$0")/.."
tools/ingest_blender.sh b1_terrain_open b1 240
tools/ingest_blender.sh b2_canyon_cut b2 150
tools/ingest_blender.sh b3_strata_rise b3 270
tools/ingest_blender.sh b4_fault_halt b4 120
ffmpeg -loglevel error -y -ss 2.2 -i assets/video/b4.mp4 -frames:v 1 -q:v 2 assets/video/b4-freeze.jpg
ffmpeg -loglevel error -y -framerate 30 -start_number 1 -i assets/blender/b6_golden_wide/b6_golden_wide_%04d.png -frames:v 210 \
  -vf "eq=contrast=1.12:saturation=0.92:gamma=0.97,colorbalance=rs=-0.05:gs=-0.01:bs=0.07:rm=-0.02:bm=0.02:rh=0.02:bh=-0.02,format=yuv420p" \
  -c:v libx264 -preset slow -crf 14 -g 15 -movflags +faststart assets/video/b6.mp4
ffmpeg -loglevel error -y -framerate 30 -start_number 41 -i assets/blender/b1_terrain_open/b1_terrain_open_%04d.png -frames:v 180 \
  -vf "eq=brightness='-0.16*t/6':saturation='1-0.45*t/6':gamma='1-0.12*t/6':eval=frame,colorbalance=bs=0.05:bm=0.03:rh=-0.03,format=yuv420p" \
  -c:v libx264 -preset slow -crf 15 -g 15 assets/video/b5.mp4
npx --yes hyperframes@0.9.26 render tools/b7-fallback -o assets/video/b7.mp4 --quality delivery --quiet
echo "video slots rebuilt"
