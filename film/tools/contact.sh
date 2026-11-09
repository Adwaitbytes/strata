#!/bin/zsh
# Contact sheets of a rendered MP4: one frame every N seconds (default 2), 5 x 4 per sheet, labelled with the time.
# Usage: tools/contact.sh <video.mp4> <out_dir> [every_seconds]
set -e
v=$1; out=$2; every=${3:-2}
mkdir -p $out/frames
rm -f $out/frames/*.jpg(N) $out/sheet-*.jpg(N)
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $v)
i=0
for t in $(python3 -c "import math; print(' '.join(f'{x*$every:.2f}' for x in range(int(float('$dur')//$every)+1)))"); do
  ffmpeg -loglevel error -y -ss $t -i $v -frames:v 1 -vf scale=480:-1 -q:v 4 $out/frames/$(printf %04d $i)_${t}s.jpg
  i=$((i+1))
done
F=/System/Library/Fonts/Supplemental/Arial.ttf
files=($out/frames/*.jpg)
n=1
for ((k=1; k<=${#files}; k+=20)); do
  magick montage -font $F -label '%t' ${files[@]:$((k-1)):20} -geometry 480x270+3+3 -tile 5x4 -pointsize 14 -background '#222' -fill white $out/sheet-$(printf %02d $n).jpg
  n=$((n+1))
done
ls $out/sheet-*.jpg
