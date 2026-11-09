#!/usr/bin/env python3
"""Place every sound effect from a list of (id, file, global event time, volume[, media_start, duration]).

Each hit is placed so its loudest sample lands one frame after the picture event (light before sound).
Writes the effects list into sfx.json; build_index.py turns it into <audio> clips.
"""
import json, pathlib, struct, subprocess

FILM = pathlib.Path(__file__).resolve().parents[1]
FRAME = 1 / 30

def peak_and_len(path):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(FILM / path), "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], capture_output=True).stdout
    a = struct.unpack(f"<{len(raw) // 2}h", raw)
    pk = max(range(len(a)), key=lambda i: abs(a[i]))
    return pk / 8000, len(a) / 8000

S = lambda scene, local: SCENES[scene] + local
cues = json.loads((FILM / "cues.json").read_text())
SCENES = {s["scene"]: s["start"] for s in cues["scenes"]}

EVENTS = [
    # open, gap, measure (times from the builder's report)
    *[],
    # thin: blur swap paper to basalt
    ("thin-swap", "assets/sfx/whoosh-short.mp3", S("thin", 3.5), 0.10),
    # reveal: last 4 s of the riser crest into the wordmark, then one soft low hit as it lands
    ("reveal-rise", "assets/sfx/riser.mp3", None, 0.14, 0.0, 3.1, S("reveal", 4.84) - 3.04 + 0.03),
    ("reveal-mark", "assets/sfx/impact-bass-1.mp3", S("reveal", 4.88), 0.22),
    # how: ladder snaps, merkle root, check mark
    ("how-asks", "assets/sfx/click-soft.mp3", S("how", 2.16), 0.16),
    ("how-bids", "assets/sfx/key-press.mp3", S("how", 2.68), 0.14),
    ("how-root", "assets/sfx/pop.mp3", S("how", 9.78), 0.12),
    ("how-check", "assets/sfx/click-soft.mp3", S("how", 11.72), 0.14),
    # agent: the four real orders snapping to their ticks, the pan to the tuner
    ("agent-o1", "assets/sfx/key-press.mp3", S("agent", 0.60), 0.13),
    ("agent-o2", "assets/sfx/click-soft.mp3", S("agent", 0.78), 0.13),
    ("agent-o3", "assets/sfx/key-press.mp3", S("agent", 0.96), 0.12),
    ("agent-o4", "assets/sfx/click-soft.mp3", S("agent", 1.14), 0.12),
    ("agent-pan", "assets/sfx/whoosh.mp3", S("agent", 12.2), 0.08),
    # oracle: $18M lands, dip into the fault, the freeze (muted thud)
    ("oracle-18m", "assets/sfx/pop.mp3", S("oracle", 3.8), 0.12),
    ("oracle-card", "assets/sfx/click-soft.mp3", S("oracle", 8.75), 0.12),
    ("oracle-dip", "assets/sfx/whoosh-short.mp3", S("oracle", 14.53), 0.10),
    ("oracle-halt", "assets/sfx/impact-bass-2.mp3", S("oracle", 15.933), 0.30),
    # kill: each resting order pulled, then the measured 10.1 s
    *[(f"kill-r{i}", "assets/sfx/click-soft.mp3" if i % 2 else "assets/sfx/key-press.mp3", S("kill", 3.72 + 0.11 * i), 0.10) for i in range(8)],
    ("kill-move", "assets/sfx/whoosh-short.mp3", S("kill", 5.1), 0.07),
    ("kill-10s", "assets/sfx/pop.mp3", S("kill", 7.9), 0.12),
    # proof: zoom through the root into the tx page, whip to the contract, the two Passed checks
    ("proof-zoom", "assets/sfx/whoosh.mp3", S("proof", 4.85), 0.12),
    ("proof-whip", "assets/sfx/whoosh-short.mp3", S("proof", 8.80), 0.10),
    ("proof-pass1", "assets/sfx/click-soft.mp3", S("proof", 12.62), 0.15),
    ("proof-pass2", "assets/sfx/key-press.mp3", S("proof", 13.05), 0.14),
    # live: whip to the network switch, the dive into Enroll
    ("live-whip", "assets/sfx/whoosh.mp3", S("live", 8.41), 0.09),
    ("live-dive", "assets/sfx/whoosh-short.mp3", S("live", 11.95), 0.09),
    # close: the wordmark lands on the end card
    ("close-mark", "assets/sfx/impact-bass-1.mp3", S("close", 8.75), 0.16),
]

extra_path = FILM / "tools/sfx_extra.json"
if extra_path.exists():
    for e in json.loads(extra_path.read_text()):
        EVENTS.append((e["id"], e["file"], S(e["scene"], e["local"]), e["volume"]))

# mix trims after a blind mix review of the first delivery render: clicks and pops -2.5 dB, impacts -3 dB, whooshes -2 dB
TRIM = {"click-soft": 0.75, "key-press": 0.75, "pop": 0.8, "impact-bass-1": 0.7, "impact-bass-2": 0.8, "whoosh": 0.8, "whoosh-short": 0.8, "riser": 0.7}
effects = []
for ev in EVENTS:
    if len(ev) == 4:
        eid, f, t, vol = ev
        pk, length = peak_and_len(f)
        start = t + FRAME - pk
        vol = round(vol * TRIM.get(f.split("/")[-1].rsplit(".", 1)[0], 1), 3)
        effects.append({"id": eid, "src": f, "start": round(start, 3), "duration": round(length, 3), "volume": vol})
    else:
        eid, f, _, vol, ms, dur, start = ev
        vol = round(vol * TRIM.get(f.split("/")[-1].rsplit(".", 1)[0], 1), 3)
        effects.append({"id": eid, "src": f, "start": round(start, 3), "duration": dur, "volume": vol, "media_start": ms})
sfx = json.loads((FILM / "sfx.json").read_text())
sfx["effects"] = sorted(effects, key=lambda e: e["start"])
(FILM / "sfx.json").write_text(json.dumps(sfx, indent=1))
print(len(effects), "effects placed")
