#!/usr/bin/env python3
"""Word timings for every narration line.

whisper-cli (large-v3-turbo, word-level) transcribes each assets/voice/<id>.wav; the script's own words
are then aligned to the transcript so cues carry the script spelling with whisper's times. Script words
whisper did not hear as such (numbers it wrote as digits) get times interpolated between neighbours.
Writes .vo/words.json: {line_id: [{w, t, end}]} in seconds from the start of that line's WAV.
"""
import difflib, json, pathlib, re, subprocess, sys

FILM = pathlib.Path(__file__).resolve().parents[1]
MODEL = pathlib.Path.home() / ".cache/whisper/ggml-large-v3-turbo.bin"
if not MODEL.exists():
    MODEL = pathlib.Path.home() / ".cache/hyperframes/whisper/models/ggml-large-v3.bin"
TX = FILM / ".vo/tx"
TX.mkdir(parents=True, exist_ok=True)
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())

script = {}
for raw in (FILM / "SCRIPT.txt").read_text().strip().splitlines():
    i, t = raw.split(": ", 1)
    script[i] = t.split()

only = set(sys.argv[1:])
out_path = FILM / ".vo/words.json"
result = json.loads(out_path.read_text()) if out_path.exists() else {}
for lid, words in script.items():
    if only and lid not in only:
        continue
    wav = FILM / f"assets/voice/{lid}.wav"
    if not wav.exists():
        print("missing", lid); continue
    w16 = TX / f"{lid}.16k.wav"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-ar", "16000", "-ac", "1", str(w16)], check=True)
    subprocess.run(["whisper-cli", "-m", str(MODEL), "-f", str(w16), "-l", "en", "-ml", "1", "-sow", "-oj", "-of", str(TX / lid), "-np"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    segs = json.loads((TX / f"{lid}.json").read_text())["transcription"]
    heard = []
    for s in segs:
        txt = s["text"].strip()
        if not txt:
            continue
        heard.append({"w": txt, "t": s["offsets"]["from"] / 1000, "end": s["offsets"]["to"] / 1000})
    a = [norm(w) for w in words]
    b = [norm(h["w"]) for h in heard]
    times = [None] * len(words)
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                times[i1 + k] = (heard[j1 + k]["t"], heard[j1 + k]["end"])
        elif j2 > j1:  # replaced span: spread the heard span evenly over the script words
            t0, t1 = heard[j1]["t"], heard[j2 - 1]["end"]
            n = i2 - i1
            for k in range(n):
                times[i1 + k] = (t0 + (t1 - t0) * k / n, t0 + (t1 - t0) * (k + 1) / n)
    for k in range(len(times)):  # words whisper skipped entirely: interpolate
        if times[k] is None:
            prev = next((times[j][1] for j in range(k - 1, -1, -1) if times[j]), 0.0)
            nxt = next((times[j][0] for j in range(k + 1, len(times)) if times[j]), prev + 0.3)
            times[k] = (prev, max(prev, nxt))
    result[lid] = [{"w": w, "t": round(t0, 2), "end": round(t1, 2)} for w, (t0, t1) in zip(words, times)]
    ratio = difflib.SequenceMatcher(a=a, b=b).ratio()
    print(f"{lid}: {len(words)} words, match {ratio:.2f}, heard: {' '.join(h['w'] for h in heard)}")
out_path.write_text(json.dumps(result, indent=1))
