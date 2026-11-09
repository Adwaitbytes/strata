#!/usr/bin/env python3
"""Write index.html (the root composition) from cues.json and sfx.json: scene hosts, narration, score, effects, captions host."""
import json, pathlib

FILM = pathlib.Path(__file__).resolve().parents[1]
cues = json.loads((FILM / "cues.json").read_text())
sfx_path = FILM / "sfx.json"
sfx = json.loads(sfx_path.read_text()) if sfx_path.exists() else {"bgm": None, "effects": []}
total = cues["duration"]

hosts, voices = [], []
for i, s in enumerate(cues["scenes"]):
    hosts.append(
        f'      <div id="{s["scene"]}" data-composition-id="{s["scene"]}" data-composition-src="compositions/{s["scene"]}.html" '
        f'data-start="{s["start"]}" data-duration="{s["duration"]}" data-track-index="{i % 2}" data-track-kind="graphics" '
        f'data-width="1920" data-height="1080" style="z-index:{i + 1}"></div>')
    for l in s["lines"]:
        voices.append(
            f'      <audio id="vo-{l["id"]}" class="clip" src="assets/voice/{l["id"]}.wav" data-start="{l["global_start"]}" '
            f'data-duration="{l["duration"]}" data-track-index="10" data-volume="1" data-audio-group="voiceover"></audio>')
effects = []
for e in sfx["effects"]:
    effects.append(
        f'      <audio id="sfx-{e["id"]}" class="clip" src="{e["src"]}" data-start="{e["start"]}" data-duration="{e["duration"]}" '
        f'data-track-index="12" data-volume="{e["volume"]}"' + (f' data-media-start="{e["media_start"]}"' if "media_start" in e else "") + ' data-audio-group="sfx"></audio>')
bgm = ""
if sfx.get("bgm"):
    b = sfx["bgm"]
    extra = " ".join(f"{k}='{v}'" if isinstance(v, str) and '"' in v else f'{k}="{v}"' for k, v in b.get("attrs", {}).items())
    bgm = (f'      <audio id="bgm" class="clip" src="{b["src"]}" data-start="0" data-duration="{total}" data-track-index="11" '
           f'data-volume="{b["volume"]}" data-fade-in="0.6" data-fade-out="2.5" {extra}></audio>')

html = f'''<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      @font-face {{ font-family: "Bricolage Grotesque"; src: url("assets/fonts/BricolageGrotesque-latin.woff2") format("woff2"); font-weight: 200 800; font-stretch: 75% 100%; font-style: normal; }}
      @font-face {{ font-family: "Schibsted Grotesk"; src: url("assets/fonts/SchibstedGrotesk-latin.woff2") format("woff2"); font-weight: 400 900; font-style: normal; }}
      @font-face {{ font-family: "Martian Mono"; src: url("assets/fonts/MartianMono-latin.woff2") format("woff2"); font-weight: 100 800; font-stretch: 75% 112.5%; font-style: normal; }}
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #0D0F0E; }}
      body {{ font-family: "Schibsted Grotesk", sans-serif; -webkit-font-smoothing: antialiased; }}
      #root {{ position: relative; width: 1920px; height: 1080px; overflow: hidden; background: #0D0F0E; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{total}" data-width="1920" data-height="1080">
{chr(10).join(hosts)}
      <div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="{total}" data-track-index="5" data-track-kind="captions" data-width="1920" data-height="1080" style="z-index:50"></div>
{chr(10).join(voices)}
{bgm}
{chr(10).join(effects)}
    </div>
    <script>
      window.__timelines = window.__timelines || {{}};
      window.__timelines["main"] = gsap.timeline({{ paused: true }});
    </script>
  </body>
</html>
'''
(FILM / "index.html").write_text(html)
print("index.html:", len(cues["scenes"]), "scenes,", len(voices), "voice lines,", len(effects), "effects, total", total)
