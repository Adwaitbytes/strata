#!/usr/bin/env python3
"""Build compositions/captions.html (burned-in captions) from cues.json.

Groups of 3 to 7 words, broken at sentence ends, commas with a pause, or 44 characters. Each group is a
timed clip from just before its first word to just after its last word (or the next group's start).
"""
import html, json, pathlib, re

FILM = pathlib.Path(__file__).resolve().parents[1]
cues = json.loads((FILM / "cues.json").read_text())
words = []
for s in cues["scenes"]:
    for w in s["words"]:
        words.append({"w": w["w"], "t": s["start"] + w["t"], "end": s["start"] + w["end"], "line": w["line"]})

text_plan = json.loads((FILM / "tools/captions_text.json").read_text())
by_line = {}
for w in words:
    by_line.setdefault(w["line"], []).append(w)
groups = []
for lid, phrases in text_plan.items():
    lw = by_line[lid]
    i = 0
    for ph in phrases:
        disp, _, n = ph.partition("|")
        n = int(n) if n else len(disp.split())
        g = lw[i:i + n]
        assert len(g) == n, (lid, ph)
        groups.append({"words": g, "text": disp})
        i += n
    assert i == len(lw), (lid, i, len(lw), " ".join(x["w"] for x in lw[i:]))
S = {s["scene"]: (s["start"], s["start"] + s["duration"]) for s in cues["scenes"]}
PAPER = [(S["gap"][0] + 6.9, S["measure"][1]), (S["thin"][0], S["thin"][0] + 3.6), S["how"]]
on_paper = lambda t: any(a <= t < b for a, b in PAPER)
items = []
for k, grp in enumerate(groups):
    g = grp["words"]
    start = max(0.1, g[0]["t"] - 0.08)
    end = g[-1]["end"] + 0.25
    if k + 1 < len(groups):
        end = min(end, groups[k + 1]["words"][0]["t"] - 0.1)
    end = max(end, start + 0.6)
    if k + 1 < len(groups):
        end = min(end, groups[k + 1]["words"][0]["t"] - 0.1)
    text = grp["text"]
    items.append((k, round(start, 2), round(end - start, 2), text, on_paper(start)))

clips = "\n".join(
    f'    <div id="cap-{k}" class="clip cap{" cap-paper" if pp else ""}" data-start="{s}" data-duration="{d}" data-track-index="1"><span class="cap-t">{html.escape(t)}</span></div>'
    for k, s, d, t, pp in items)
tweens = "\n".join(
    f'    tl.fromTo("#cap-{k} .cap-t", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.12, ease: "power2.out" }}, {s});\n'
    f'    tl.to("#cap-{k} .cap-t", {{ opacity: 0, duration: 0.1, ease: "power2.in" }}, {round(s + d - 0.1, 2)});'
    for k, s, d, t, pp in items)
total = cues["duration"]
doc = f'''<template>
  <style>
    @font-face {{ font-family: "Schibsted Grotesk"; src: url("assets/fonts/SchibstedGrotesk-latin.woff2") format("woff2"); font-weight: 400 900; font-style: normal; }}
    #root {{ position: absolute; inset: 0; overflow: visible; pointer-events: none; }}
    .cap {{ position: absolute; left: 0; right: 0; bottom: 64px; text-align: center; }}
    .cap-t {{ display: inline-block; font-family: "Schibsted Grotesk", sans-serif; font-weight: 500; font-size: 40px; line-height: 1.25;
      letter-spacing: -0.005em; color: #ECE8DF; background: rgba(13, 15, 14, 0.84); padding: 8px 20px 10px; border-radius: 6px; opacity: 0; }}
    .cap-paper .cap-t {{ color: #141613; background: #F7F8F3; box-shadow: 0 0 0 1px #B5BBAE; border-radius: 4px; }}
  </style>
  <div id="root" data-composition-id="captions" data-width="1920" data-height="1080" data-duration="{total}" data-layout-allow-caption-zone>
{clips}
  </div>
  <script>
    const tl = gsap.timeline({{ paused: true }});
{tweens}
    window.__timelines["captions"] = tl;
  </script>
</template>
'''
(FILM / "compositions/captions.html").write_text(doc)
print(len(items), "caption groups; longest", max(len(it[3]) for it in items), "chars")
for k, s, d, t, pp in items[:12]:
    print(f"{s:7.2f} {d:5.2f} {t}")
