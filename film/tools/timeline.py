#!/usr/bin/env python3
"""Lock the film timeline from the narration: scene durations, line placement and per-word cues.

Each scene: (id, [(line, local lead-in seconds)], tail seconds after the last line, minimum duration).
Writes cues.json: scenes with global start/duration, lines with global and local start, and every
spoken word in the scene's LOCAL seconds.
"""
import json, pathlib, subprocess

FILM = pathlib.Path(__file__).resolve().parents[1]
PLAN = [
    ("open",    [("l01", 1.0)], 0.5, 8.2),
    ("gap",     [("l02", 0.4)], 0.5, 0),
    ("measure", [("l03", 0.4)], 1.2, 0),
    ("thin",    [("l04", 0.3)], 0.3, 0),
    ("reveal",  [("l05", 3.0)], 1.3, 12.0),
    ("how",     [("l06", 0.3)], 0.5, 0),
    ("agent",   [("l07", 0.3)], 0.4, 0),
    ("oracle",  [("l08", 0.3)], 0.8, 0),
    ("session", [("l09", 0.3)], 0.5, 0),
    ("kill",    [("l10", 0.2)], 1.0, 0),
    ("proof",   [("l11", 0.6)], 0.6, 0),
    ("live",    [("l12", 0.3)], 0.4, 0),
    ("close",   [("l13", 2.4)], 5.0, 12.5),
]
dur = lambda f: float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)]))
words = json.loads((FILM / ".vo/words.json").read_text())
t = 0.0
scenes = []
for sid, lines, tail, minimum in PLAN:
    local = 0.0
    out_lines, out_words = [], []
    for lid, lead in lines:
        d = dur(FILM / f"assets/voice/{lid}.wav")
        start = local + lead
        out_lines.append({"id": lid, "global_start": round(t + start, 2), "local_start": round(start, 2), "duration": round(d, 2)})
        out_words += [{"line": lid, "w": w["w"], "t": round(start + w["t"], 2), "end": round(start + w["end"], 2)} for w in words[lid]]
        local = start + d
    d_scene = round(max(minimum, local + tail), 1)
    scenes.append({"scene": sid, "start": round(t, 2), "duration": d_scene, "lines": out_lines, "words": out_words})
    t = round(t + d_scene, 2)
(FILM / "cues.json").write_text(json.dumps({"duration": round(t, 2), "fps": 30, "scenes": scenes}, indent=1))
for s in scenes:
    print(f"{s['scene']:8s} {s['start']:7.2f} {s['duration']:5.1f}  " + " ".join(f"{l['id']}@{l['global_start']}" for l in s["lines"]))
print("total", t)
