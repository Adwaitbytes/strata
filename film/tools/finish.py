#!/usr/bin/env python3
"""Loudness-normalise a rendered MP4 to -16 LUFS integrated, -1.5 dBTP (two-pass loudnorm), video stream copied.
Usage: finish.py <in.mp4> <out.mp4>"""
import json, re, subprocess, sys
src, dst = sys.argv[1], sys.argv[2]
probe = subprocess.run(["ffmpeg", "-hide_banner", "-i", src, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
m = json.loads(re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", probe, re.S).group(0))
af = (f"loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
      f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,aresample=48000")
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-c:v", "copy", "-af", af, "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", dst], check=True)
check = subprocess.run(["ffmpeg", "-hide_banner", "-i", dst, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
summary = check[check.rfind("Summary:"):]
print("in:", m["input_i"], "LUFS,", m["input_tp"], "dBTP")
print(" ".join(summary.split()))
