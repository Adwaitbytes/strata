#!/usr/bin/env python3
"""Cut the 60 to 90 s application demo from the finished film: whole scenes, hard video cuts, short audio crossfades.
Scenes come from cues.json, so a retime never breaks the cut. Usage: cut_demo.py <film.mp4> <out.mp4>"""
import json, pathlib, subprocess, sys
FILM = pathlib.Path(__file__).resolve().parents[1]
SCENES = ["open", "gap", "measure", "reveal", "proof", "close"]
src, dst = sys.argv[1], sys.argv[2]
cues = {s["scene"]: s for s in json.loads((FILM / "cues.json").read_text())["scenes"]}
parts, filt, n = [], [], 0
for name in SCENES:
    s = cues[name]
    a, b = s["start"], round(s["start"] + s["duration"], 3)
    parts += ["-ss", str(a), "-to", str(b), "-i", src]
    filt.append(f"[{n}:v]setpts=PTS-STARTPTS[v{n}];[{n}:a]asetpts=PTS-STARTPTS,afade=t=in:d=0.06,afade=t=out:st={round(b - a - 0.12, 3)}:d=0.12[a{n}]")
    n += 1
concat = "".join(f"[v{i}][a{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=1[v][a]"
cmd = ["ffmpeg", "-loglevel", "error", "-y", *parts, "-filter_complex", ";".join(filt) + ";" + concat, "-map", "[v]", "-map", "[a]",
       "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", dst]
subprocess.run(cmd, check=True)
print(dst, sum(cues[x]["duration"] for x in SCENES), "s")
