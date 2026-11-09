#!/usr/bin/env python3
"""Read-only sweep of every mainnet real-world-asset perp on Injective (public LCD).

For each market: mark price, best bid and ask, two-sided spread, and USD depth within 25 bps of mark.
Writes film/assets/data/rwa-sweep.json. Market list: packages/config/src/generated/markets.mainnet.json.
"""
import json, pathlib, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parents[2]
LCD = "https://sentry.lcd.injective.network/injective/exchange/v2/derivative"
markets = [m for m in json.loads((ROOT / "packages/config/src/generated/markets.mainnet.json").read_text())
           if m["isPerpetual"] and m["assetClass"] != "crypto"]

def get(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                return json.load(r)
        except Exception as e:  # retry transient LCD errors, then surface them
            last = e
            time.sleep(1 + attempt)
    raise last

def sweep(m):
    mid = m["marketId"]
    mk = get(f"{LCD}/markets/{mid}")["market"]
    status = mk["market"]["status"]
    mark = float(mk["mark_price"])
    ob = get(f"{LCD}/orderbook/{mid}?limit=200")
    bids = [(float(l["p"]), float(l["q"])) for l in ob.get("buys_price_level", [])]
    asks = [(float(l["p"]), float(l["q"])) for l in ob.get("sells_price_level", [])]
    bb = max((p for p, _ in bids), default=None)
    ba = min((p for p, _ in asks), default=None)
    band = 0.0025 * mark
    bid_d = sum(p * q for p, q in bids if p >= mark - band)
    ask_d = sum(p * q for p, q in asks if p <= mark + band)
    spread = (ba - bb) / ((ba + bb) / 2) * 1e4 if bb and ba and ba > bb else None
    return {"ticker": m["ticker"], "symbol": m["symbol"], "assetClass": m["assetClass"], "marketId": mid,
            "status": status, "mark": mark, "bestBid": bb, "bestAsk": ba, "spreadBps": spread,
            "bidDepthUsd25": bid_d, "askDepthUsd25": ask_d, "bidLevels": len(bids), "askLevels": len(asks)}

t0 = time.time()
with ThreadPoolExecutor(8) as ex:
    rows = list(ex.map(sweep, markets))
at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
active = [r for r in rows if r["status"] == "Active"]
summary = {
    "at": at, "network": "mainnet", "provenance": "BASELINE", "source": LCD,
    "markets": len(rows), "active": len(active),
    "noBidWithin25bps": sum(1 for r in active if r["bidDepthUsd25"] == 0),
    "noAskWithin25bps": sum(1 for r in active if r["askDepthUsd25"] == 0),
    "noBidOrNoAskWithin25bps": sum(1 for r in active if r["bidDepthUsd25"] == 0 or r["askDepthUsd25"] == 0),
    "bothSidesWithin25bps": sum(1 for r in active if r["bidDepthUsd25"] > 0 and r["askDepthUsd25"] > 0),
    "emptyBook": sum(1 for r in active if r["bidLevels"] == 0 and r["askLevels"] == 0),
    "oneSided": sum(1 for r in active if (r["bidLevels"] == 0) != (r["askLevels"] == 0)),
    "byClass": {},
    "seconds": round(time.time() - t0, 1),
}
for r in active:
    c = summary["byClass"].setdefault(r["assetClass"], {"n": 0, "bothSidesWithin25bps": 0})
    c["n"] += 1
    c["bothSidesWithin25bps"] += int(r["bidDepthUsd25"] > 0 and r["askDepthUsd25"] > 0)
import sys
out = ROOT / "film/assets/data" / (sys.argv[1] if len(sys.argv) > 1 else "rwa-sweep.json")
out.write_text(json.dumps({"summary": summary, "rows": rows}, indent=1))
print(json.dumps(summary, indent=1))
