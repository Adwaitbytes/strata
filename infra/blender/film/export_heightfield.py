"""Export a real BASELINE order book recording as a terrain heightfield for the STRATA film.

Read-only: one SELECT against Neon through psql. Run from the repo root with system python3:

    python3 infra/blender/film/export_heightfield.py --ticker "NVDA/USDC PERP"

Mapping (film/BRIEF.md, Blender shots):
  X  price distance from mid in basis points, bids negative, asks positive
  Y  time across the longest continuous stretch of the recording
  Z  cumulative resting depth in USD from mid outward to |X|, averaged over each time bin.
     Blender takes sqrt(Z), so the empty middle (the spread) is a real canyon.

The grid stores raw USD (not sqrt) so anyone can re-derive heights. Nothing is smoothed here;
the render scripts state their own smoothing in film/assets/blender/README.md.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
MARKETS_FILE = REPO / "packages/config/src/generated/markets.mainnet.json"
OUT_DIR = REPO / "film/assets/data"

# A gap longer than this ends a continuous stretch (the recorder samples every 5 s).
MAX_GAP_S = 120.0


def market_id_for(ticker: str) -> str:
    markets = json.loads(MARKETS_FILE.read_text())
    for m in markets:
        if m["ticker"] == ticker:
            return m["marketId"]
    raise SystemExit(f"ticker not found in {MARKETS_FILE.name}: {ticker}")


def fetch_rows(neon_url: str, market_id: str) -> list[dict]:
    if not all(c in "0123456789abcdefx" for c in market_id):
        raise SystemExit(f"unexpected market id: {market_id}")
    sql = (
        "select coalesce(json_agg(json_build_object("
        "'at', at, 'mid', mid, 'spread_bps', spread_bps, 'bids', bids, 'asks', asks) order by at), '[]') "
        "from book_snapshots where network = 'mainnet' and provenance = 'BASELINE' "
        f"and market_id = '{market_id}'"
    )
    out = subprocess.run(
        ["psql", neon_url, "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", "set default_transaction_read_only = on", "-c", sql],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    payload = out.strip().splitlines()[-1]
    return json.loads(payload)


def parse_at(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s)


def longest_continuous(rows: list[dict]) -> list[dict]:
    best: list[dict] = []
    cur: list[dict] = []
    prev: dt.datetime | None = None
    for r in rows:
        t = parse_at(r["at"])
        if prev is not None and (t - prev).total_seconds() > MAX_GAP_S:
            if len(cur) > len(best):
                best = cur
            cur = []
        cur.append(r)
        prev = t
    return cur if len(cur) > len(best) else best


def cumulative_profile(levels: list[dict], mid: float, side: str, edges_bps: list[float]) -> list[float]:
    """Cumulative USD resting from mid out to each distance in edges_bps (distances are >= 0)."""
    dists_usd = []
    for lv in levels:
        price = float(lv["price"])
        qty = float(lv["quantity"])
        dist = (mid - price) / mid * 1e4 if side == "bid" else (price - mid) / mid * 1e4
        dists_usd.append((max(dist, 0.0), price * qty))
    dists_usd.sort()
    out = []
    for e in edges_bps:
        out.append(sum(usd for d, usd in dists_usd if d <= e))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", default="NVDA/USDC PERP")
    ap.add_argument("--range-bps", type=float, default=360.0)
    ap.add_argument("--bin-bps", type=float, default=4.0)
    ap.add_argument("--bin-seconds", type=float, default=30.0)
    args = ap.parse_args()

    neon_url = (REPO / ".secrets/neon_url").read_text().strip()
    market_id = market_id_for(args.ticker)
    rows = fetch_rows(neon_url, market_id)
    if not rows:
        raise SystemExit("no BASELINE rows for that market")
    seg = [r for r in longest_continuous(rows) if r["mid"] is not None]
    t0 = parse_at(seg[0]["at"])
    t1 = parse_at(seg[-1]["at"])

    n_half = int(round(args.range_bps / args.bin_bps))
    x_bps = [(i - n_half) * args.bin_bps for i in range(2 * n_half + 1)]
    pos_edges = [i * args.bin_bps for i in range(n_half + 1)]
    n_t = int(math.floor((t1 - t0).total_seconds() / args.bin_seconds)) + 1

    sums = [[0.0] * len(x_bps) for _ in range(n_t)]
    counts = [0] * n_t
    mids: list[list[float]] = [[] for _ in range(n_t)]
    spreads: list[list[float]] = [[] for _ in range(n_t)]
    for r in seg:
        k = int((parse_at(r["at"]) - t0).total_seconds() // args.bin_seconds)
        mid = float(r["mid"])
        bid = cumulative_profile(r["bids"], mid, "bid", pos_edges)
        ask = cumulative_profile(r["asks"], mid, "ask", pos_edges)
        row = list(reversed(bid[1:])) + [0.0] + ask[1:]
        for i, v in enumerate(row):
            sums[k][i] += v
        counts[k] += 1
        mids[k].append(mid)
        if r["spread_bps"] is not None:
            spreads[k].append(float(r["spread_bps"]))

    grid: list[list[float]] = []
    filled: list[int] = []
    last: list[float] | None = None
    for k in range(n_t):
        if counts[k]:
            last = [round(v / counts[k], 2) for v in sums[k]]
        else:
            # A resting book persists between samples, so an empty bin repeats the last observed one.
            filled.append(k)
        if last is None:
            raise SystemExit("first time bin is empty")
        grid.append(last)

    def mean_or_none(v: list[float]) -> float | None:
        return round(sum(v) / len(v), 4) if v else None

    ticker_slug = args.ticker.split("/")[0].lower()
    doc = {
        "kind": "strata.film.heightfield",
        "version": 1,
        "network": "mainnet",
        "provenance": "BASELINE",
        "market": {"ticker": args.ticker, "marketId": market_id},
        "source": "Neon table book_snapshots (read-only), recorder services/indexer/src/baseline, up to 10 levels per side",
        "window": {
            "start": t0.isoformat().replace("+00:00", "Z"),
            "end": t1.isoformat().replace("+00:00", "Z"),
            "snapshots": len(seg),
            "note": "Longest continuous stretch of the BASELINE recording (no gap over 120 s).",
            "recordingStart": parse_at(rows[0]["at"]).isoformat().replace("+00:00", "Z"),
            "recordingEnd": parse_at(rows[-1]["at"]).isoformat().replace("+00:00", "Z"),
        },
        "axes": {
            "x": {"meaning": "price distance from mid", "units": "bps", "bidsNegative": True, "values": x_bps},
            "y": {"meaning": "time bin start offset from window start", "units": "s", "binSeconds": args.bin_seconds, "count": n_t},
            "z": {
                "meaning": "cumulative resting depth from mid out to |x| on that side, mean over the snapshots in the time bin",
                "units": "USD (price x quantity)",
                "renderHeight": "sqrt(USD), scaled to scene units in infra/blender/film/strata_scene.py",
            },
        },
        "rowStats": {
            "mid": [mean_or_none(m) for m in mids],
            "spreadBps": [mean_or_none(s) for s in spreads],
            "snapshotsPerBin": counts,
            "carriedForwardBins": filled,
        },
        "summary": {
            "maxDepthUsd": max(max(r) for r in grid),
            "medianSpreadBps": sorted(s for r in spreads for s in r)[len([s for r in spreads for s in r]) // 2],
        },
        "grid": grid,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"heightfield_{ticker_slug}.json"
    out.write_text(json.dumps(doc, separators=(",", ":")))
    print(f"wrote {out.relative_to(REPO)}: {n_t} x {len(x_bps)} grid, {len(seg)} snapshots, {doc['window']['start']} to {doc['window']['end']}")


if __name__ == "__main__":
    sys.exit(main())
