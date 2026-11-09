#!/usr/bin/env python3
"""Copy the carve's attributes from index.html's #bgm into sfx.json and set the hand-drawn volume lane.

build_index.py regenerates index.html from sfx.json, so the carve (written by hyperframes-audio carve.mjs)
must live in sfx.json too. The volume lane is ours: it drops the bed to near silence for the oracle halt.
"""
import json, pathlib, sys
from html.parser import HTMLParser

FILM = pathlib.Path(__file__).resolve().parents[1]
attrs = {}
class P(HTMLParser):
    def handle_starttag(self, tag, a):
        a = dict(a)
        if tag == "audio" and a.get("id") == "bgm":
            attrs.update(a)
P().feed((FILM / "index.html").read_text())
sfx = json.loads((FILM / "sfx.json").read_text())
keep = {k: attrs[k] for k in ("data-fx-carve", "data-fx-chain", "data-automation") if k in attrs}
auto = json.loads(keep.get("data-automation", '{"version":1,"lanes":[]}'))
auto["lanes"] = [l for l in auto["lanes"] if l["target"] != "volume"]
# halt at global ~120.95 s (oracle scene start 104.9 + word "stops" 16.05); the bed starts at 0, so t is global
halt = float(sys.argv[1]) if len(sys.argv) > 1 else 120.95
auto["lanes"].append({"target": "volume", "points": [
    {"t": 0, "v": 1}, {"t": round(halt - 0.6, 2), "v": 1}, {"t": round(halt + 0.05, 2), "v": 0.05},
    {"t": round(halt + 1.6, 2), "v": 0.05}, {"t": round(halt + 3.2, 2), "v": 1}]})
keep["data-automation"] = json.dumps(auto, separators=(",", ":"))
sfx["bgm"]["attrs"] = {"data-audio-group": "music", **keep}
(FILM / "sfx.json").write_text(json.dumps(sfx, indent=1))
print("persisted", list(keep), "lanes:", [l["target"] for l in auto["lanes"]])
