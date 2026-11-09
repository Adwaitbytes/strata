"""Builds film/assets/data/*.json from read-only sources. Every value carries `source` and `measuredAt`.

    python3 -I film/capture/build_data.py

Neon is queried through psql in a READ ONLY session; the connection string is read from
.secrets/neon_url and never printed. Nothing here writes to a database or a chain.
"""

from __future__ import annotations

import json
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "film" / "assets" / "data"
NEON_URL_FILE = ROOT / ".secrets" / "neon_url"
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
NEON = "Neon Postgres (production DB the API reads), read-only session"


def query(sql: str) -> object:
    """Runs one SQL statement that returns a single JSON value, in a read-only session."""
    url = NEON_URL_FILE.read_text().strip()
    script = "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;\n" + sql
    res = subprocess.run(
        ["psql", url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
        input=script,
        capture_output=True,
        text=True,
        check=False,
    )
    if res.returncode != 0:
        # psql errors can echo connection details; report only the first line without the URL.
        raise RuntimeError("psql failed: " + res.stderr.strip().splitlines()[0].replace(url, "<neon_url>"))
    out = res.stdout.strip()
    return json.loads(out) if out else None


def write(name: str, payload: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {name}")


def r(x: float | None, nd: int = 1) -> float | None:
    return None if x is None else round(x, nd)


# ---------------------------------------------------------------- baseline


BASELINE_SQL = """
with s as (
  select b.*, m.ticker, m.data->>'assetClass' as asset_class
  from book_snapshots b join markets m on m.network = b.network and m.market_id = b.market_id
  where b.network = 'mainnet' and b.provenance = 'BASELINE'
), agg as (
  select ticker, market_id, asset_class,
    count(*) as samples,
    min(at) as first_at, max(at) as last_at,
    count(*) filter (where spread_bps is not null) as two_sided,
    count(*) filter (where jsonb_array_length(bids) = 0 and jsonb_array_length(asks) = 0) as empty_book,
    count(*) filter (where spread_bps is null and (jsonb_array_length(bids) > 0 or jsonb_array_length(asks) > 0)) as one_sided,
    count(*) filter (where jsonb_array_length(bids) = 0) as no_bid_at_all,
    count(*) filter (where jsonb_array_length(asks) = 0) as no_ask_at_all,
    percentile_cont(0.5) within group (order by spread_bps) filter (where spread_bps is not null) as spread_p50,
    percentile_cont(0.9) within group (order by spread_bps) filter (where spread_bps is not null) as spread_p90,
    count(*) filter (where spread_bps is null or spread_bps > 50) as no_bid_or_ask_25,
    percentile_cont(0.5) within group (order by depth_usd_25) as depth25_p50,
    percentile_cont(0.9) within group (order by depth_usd_25) as depth25_p90,
    max(depth_usd_25) as depth25_max
  from s group by 1, 2, 3
), last as (
  select distinct on (market_id) market_id, at, mid, spread_bps, bids->0->>'price' as best_bid, asks->0->>'price' as best_ask,
    oracle_price, oracle_ts
  from s order by market_id, at desc
)
select json_agg(json_build_object(
  'ticker', a.ticker, 'marketId', a.market_id, 'assetClass', a.asset_class,
  'samples', a.samples, 'firstAt', a.first_at, 'lastAt', a.last_at,
  'twoSided', a.two_sided, 'emptyBook', a.empty_book, 'oneSided', a.one_sided,
  'noBidAtAll', a.no_bid_at_all, 'noAskAtAll', a.no_ask_at_all,
  'spreadP50', a.spread_p50, 'spreadP90', a.spread_p90, 'noBidOrAsk25', a.no_bid_or_ask_25,
  'depth25P50', a.depth25_p50, 'depth25P90', a.depth25_p90, 'depth25Max', a.depth25_max,
  'last', json_build_object('at', l.at, 'mid', l.mid, 'spreadBps', l.spread_bps, 'bestBid', l.best_bid, 'bestAsk', l.best_ask,
                            'oraclePrice', l.oracle_price, 'oracleTs', l.oracle_ts)
) order by a.spread_p50 nulls last, a.ticker)
from agg a join last l using (market_id);
"""

GAPS_SQL = """
with t as (select distinct at from book_snapshots where network = 'mainnet' and provenance = 'BASELINE'),
g as (select at, lag(at) over (order by at) as prev from t)
select json_agg(json_build_object('from', prev, 'to', at, 'minutes', round(extract(epoch from at - prev) / 60.0)) order by at)
from g where at - prev > interval '2 minutes';
"""


def baseline() -> None:
    rows = query(BASELINE_SQL) or []
    gaps = query(GAPS_SQL) or []
    markets = []
    for m in rows:
        n = m["samples"]
        markets.append(
            {
                "ticker": m["ticker"],
                "marketId": m["marketId"],
                "assetClass": m["assetClass"],
                "network": "mainnet",
                "provenance": "BASELINE",
                "sampleCount": n,
                "window": {"first": m["firstAt"], "last": m["lastAt"]},
                "twoSidedSamples": m["twoSided"],
                "emptyBookSamples": m["emptyBook"],
                "oneSidedSamples": m["oneSided"],
                "shareTwoSided": r(m["twoSided"] / n, 4),
                "shareEmptyBook": r(m["emptyBook"] / n, 4),
                "shareNoBidAtAll": r(m["noBidAtAll"] / n, 4),
                "shareNoAskAtAll": r(m["noAskAtAll"] / n, 4),
                "spreadBpsMedian": r(m["spreadP50"]),
                "spreadBpsP90": r(m["spreadP90"]),
                "spreadNote": "over two-sided samples only; null when the book was never two-sided",
                "shareNoBidOrAskWithin25Bps": r(m["noBidOrAsk25"] / n, 4),
                "depthUsdWithin25BpsMedian": r(m["depth25P50"], 2),
                "depthUsdWithin25BpsP90": r(m["depth25P90"], 2),
                "depthUsdWithin25BpsMax": r(m["depth25Max"], 2),
                "lastSample": m["last"],
            }
        )
    ranked = [m for m in markets if m["spreadBpsMedian"] is not None and m["shareTwoSided"] >= 0.5]
    best = min(ranked, key=lambda m: m["spreadBpsMedian"])
    worst = max(ranked, key=lambda m: m["spreadBpsMedian"])
    total = sum(m["sampleCount"] for m in markets)
    write(
        "baseline.json",
        {
            "source": f"{NEON}: table book_snapshots, network=mainnet, provenance=BASELINE, joined to markets for tickers",
            "measuredAt": NOW,
            "provenance": "BASELINE",
            "network": "mainnet",
            "label": "BASELINE: read-only recordings of Injective mainnet order books, no STRATA agent quoting",
            "method": {
                "sampling": "one full-book sample every 5 s per market by services/indexer (baseline recorder)",
                "spreadBps": "(best ask - best bid) / mid * 10000, mid = (best bid + best ask) / 2 (services/indexer/src/book/metrics.ts)",
                "noBidOrAskWithin25Bps": "a sample counts when the book is one-sided or empty, or spread > 50 bps (with a symmetric mid, both best quotes sit within 25 bps of mid exactly when spread <= 50 bps)",
                "depthUsdWithin25Bps": "sum of price * quantity of all bid and ask levels within 25 bps of mid; 0 when the book has no mid",
            },
            "window": {"first": min(m["window"]["first"] for m in markets), "last": max(m["window"]["last"] for m in markets)},
            "coverageGaps": gaps,
            "coverageNote": "The recorder host slept from about 2026-11-08 20:47Z to 2026-11-09 08:20Z (docs/STATUS.md 'Soak restart'); no samples exist in that gap. 2026-11-08 was a Sunday, so equity and index underlyings were closed for the first part of the window.",
            "totalSamples": total,
            "marketCount": len(markets),
            "summary": {
                "marketsWithNoBidOrAskWithin25BpsInEverySample": sum(1 for m in markets if m["shareNoBidOrAskWithin25Bps"] == 1),
                "marketsNeverTwoSided": [m["ticker"] for m in markets if m["twoSidedSamples"] == 0],
                "marketsEmptyEverySample": [m["ticker"] for m in markets if m["shareEmptyBook"] == 1],
                "medianDepthWithin25BpsAllMarketsUsd": 0 if all(m["depthUsdWithin25BpsMedian"] == 0 for m in markets) else None,
            },
            "bestVsWorst": {
                "rule": "median spread, among markets that were two-sided in at least half of their samples",
                "best": {"ticker": best["ticker"], "spreadBpsMedian": best["spreadBpsMedian"]},
                "worst": {"ticker": worst["ticker"], "spreadBpsMedian": worst["spreadBpsMedian"]},
                "ratio": r(worst["spreadBpsMedian"] / best["spreadBpsMedian"], 1),
                "eligible": [m["ticker"] for m in ranked],
            },
            "markets": markets,
        },
    )


# ---------------------------------------------------------------- markets


def markets() -> None:
    path = ROOT / "packages/config/src/generated/markets.mainnet.json"
    data = json.loads(path.read_text())
    by_class = Counter(m["assetClass"] for m in data)
    rwa = [m for m in data if m["assetClass"] != "crypto"]
    fetched = sorted({m["fetchedAt"] for m in data})
    write(
        "markets.json",
        {
            "source": "packages/config/src/generated/markets.mainnet.json (written by scripts/fetch-markets.ts from a live query of https://sentry.exchange.grpc-web.injective.network derivatives/markets, active perpetual markets only)",
            "measuredAt": datetime.fromtimestamp(fetched[-1] / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "network": "mainnet",
            "provenance": "LIVE",
            "activePerpMarkets": len(data),
            "byAssetClass": dict(by_class.most_common()),
            "rwaPerpMarkets": len(rwa),
            "rwaDefinition": "every asset class except crypto: equity, fx, commodity, index, compute (classification rules in services/agent/src/injective/markets/classify.ts)",
            "rwaByAssetClass": dict(Counter(m["assetClass"] for m in rwa).most_common()),
            "rwaExamples": {c: sorted(m["ticker"] for m in rwa if m["assetClass"] == c)[:8] for c in ("commodity", "index", "fx", "compute", "equity")},
            "note": "docs/STATUS.md line 82 says 187 active RWA perps for the local all-market baseline; this file (the same fetch, 2026-11-08 18:56Z) lists 188. Use 188 with this source, or re-fetch before the final cut.",
        },
    )


# ---------------------------------------------------------------- agents, orders, guards


AGENTS_SQL = """
select json_agg(json_build_object('agentId', a.agent_id, 'name', a.name, 'kind', a.kind, 'simulated', a.simulated,
  'status', a.status, 'injAddress', a.inj_address, 'operator', a.operator, 'erc8004Id', a.erc8004_id,
  'enrolledAt', a.enrolled_at,
  'markets', (select coalesce(json_agg(json_build_object('marketId', x.value, 'ticker', m.ticker)), '[]'::json)
              from jsonb_array_elements_text(a.market_ids) x left join markets m on m.network = a.network and m.market_id = x.value))
  order by a.agent_id)
from agents a where a.network = 'testnet';
"""

ORDERS_SQL = """
select json_build_object(
  'total', (select count(*) from agent_orders where network = 'testnet'),
  'distinctOrderHashes', (select count(distinct order_hash) from agent_orders where network = 'testnet'),
  'first', (select min(posted_at) from agent_orders where network = 'testnet'),
  'last', (select max(posted_at) from agent_orders where network = 'testnet'),
  'openRowsInTable', (select count(*) from agent_orders where network = 'testnet' and cancelled_at is null),
  'byAgent', (select json_agg(json_build_object('agentId', agent_id, 'posted', n, 'openRows', o) order by agent_id)
              from (select agent_id, count(*) n, count(*) filter (where cancelled_at is null) o from agent_orders where network = 'testnet' group by 1) z));
"""

GUARDS_SQL = """
select json_build_object(
  'byReason', (select json_agg(json_build_object('provenance', provenance, 'guard', guard, 'reason', reason, 'action', action,
                 'count', n, 'first', f, 'last', l) order by n desc)
               from (select provenance, guard, reason, action, count(*) n, min(at) f, max(at) l
                     from guard_events where network = 'testnet' group by 1, 2, 3, 4) z),
  'examples', (select json_agg(e order by e->>'reason', e->>'at')
               from (select json_build_object('id', g.id, 'agentId', g.agent_id, 'market', m.ticker, 'guard', g.guard, 'action', g.action,
                       'reason', g.reason, 'detail', g.detail, 'observed', g.observed, 'at', g.at, 'provenance', g.provenance) e
                     from (select *, row_number() over (partition by reason order by at) rn from guard_events where network = 'testnet') g
                     left join markets m on m.network = g.network and m.market_id = g.market_id
                     where g.rn <= 3) z));
"""


def agents() -> None:
    agent_rows = query(AGENTS_SQL)
    orders = query(ORDERS_SQL)
    guards = query(GUARDS_SQL)
    open_now = parse_open_orders(Path(__file__).parent / "open-orders.latest.txt")
    write(
        "agents.json",
        {
            "source": f"{NEON}: tables agents, agent_orders, guard_events (network=testnet)",
            "measuredAt": NOW,
            "network": "testnet",
            "provenance": "TESTNET",
            "agents": agent_rows,
            "agentNote": "Agents 1 to 3 are the house market makers on Injective testnet. Agent 9001 strata-options is SIMULATED (STRATA simulator, no chain orders) and is excluded from attested epochs.",
            "ordersPosted": {
                **orders,
                "source": f"{NEON}: agent_orders (one row per order posted by agents 1 to 3)",
                "note": "openRowsInTable over-counts: docs/STATUS.md notes some cancels are not closed in the table. Use openOnChain for 'open now'.",
            },
            "openOnChain": open_now,
            "guardEvents": {
                "source": f"{NEON}: guard_events",
                **guards,
                "reasonGlossary": {
                    "oracle_book_deviation": "oracle price too far from the book mid (halt), or book unhealthy so the agent widens",
                    "oracle_stale": "oracle timestamp older than the allowed age; the agent halts that market",
                    "session_closed": "underlying market closed (Session Guard); the agent stops quoting",
                    "data_unavailable": "exchange call failed or timed out; orders cancelled until state reconciles",
                    "kill_switch_api": "signed admin kill via POST /v1/admin/kill",
                    "kill_switch_telegram": "internal kill path the Telegram bot relays",
                    "kill_switch_env": "KILL_SWITCH=true environment flag at start",
                },
            },
        },
    )


def parse_open_orders(path: Path) -> dict:
    """Parses the output of `pnpm --filter @strata/agent inj:open-orders` (read-only chain query)."""
    text = path.read_text()
    per_market = []
    total = None
    at = None
    for line in text.splitlines():
        m = re.match(r"^(\S+Z) (\S+) agent=(\d+) (.+?) open=(\d+)(?: \[(.*)\])?$", line)
        if m:
            at = m.group(1)
            per_market.append({"agent": m.group(2), "agentId": int(m.group(3)), "market": m.group(4), "open": int(m.group(5)), "orders": m.group(6).split(", ") if m.group(6) else []})
        t = re.match(r"^(\S+Z) total open orders: (\d+)$", line)
        if t:
            at, total = t.group(1), int(t.group(2))
    return {
        "source": "pnpm --filter @strata/agent inj:open-orders (services/agent/src/injective/bin/open-orders.ts, read-only Injective testnet query, no keys loaded); raw output in film/capture/open-orders.latest.txt",
        "measuredAt": at,
        "total": total,
        "perMarket": per_market,
        "orderFormat": "B|S quantity@price",
    }


# ---------------------------------------------------------------- tuner


TUNER_SQL = """
select json_build_object(
  'total', (select count(*) from tuner_events where network = 'testnet'),
  'modes', (select json_object_agg(mode, n) from (select mode, count(*) n from tuner_events group by 1) z),
  'models', (select json_object_agg(model, n) from (select model, count(*) n from tuner_events group by 1) z),
  'changedSuggestions', (select count(*) from tuner_events where payload->'suggested' <> payload->'before'),
  'clamped', (select count(*) from tuner_events where jsonb_array_length(payload->'clamped') > 0),
  'rejected', (select count(*) from tuner_events where (payload->>'rejected')::boolean),
  'first', (select min(at) from tuner_events), 'last', (select max(at) from tuner_events),
  'rows', (select json_agg(json_build_object('id', t.id, 'agentId', t.agent_id, 'market', m.ticker, 'mode', t.mode, 'model', t.model,
             'at', t.at, 'rationale', t.payload->>'rationale', 'before', t.payload->'before', 'suggested', t.payload->'suggested',
             'applied', t.payload->'applied', 'clamped', t.payload->'clamped', 'rejected', t.payload->'rejected') order by t.at)
           from tuner_events t left join markets m on m.network = t.network and m.market_id = t.market_id where t.network = 'testnet'));
"""

# packages/risk/src/params.ts PARAM_BOUNDS, the hard bounds the tuner prompt is given (services/agent/src/core/tuner.ts).
TUNER_BOUNDS = {
    "gamma": {"min": 0.001, "max": 5},
    "minHalfSpreadBps": {"min": 1, "max": 500},
    "levels": {"min": 1, "max": 10, "integer": True},
    "sizeMultiplier": {"min": 0.1, "max": 5},
}


def tuner() -> None:
    t = query(TUNER_SQL)
    rows = t.pop("rows")
    changed = [x for x in rows if x["suggested"] != x["before"]]
    held = [x for x in rows if x["suggested"] == x["before"]]
    picks: list[dict] = []
    seen_agents: set[int] = set()
    for x in changed:
        if x["agentId"] not in seen_agents:
            picks.append(x)
            seen_agents.add(x["agentId"])
    for x in changed + held:
        if len(picks) >= 5:
            break
        if x not in picks and all(x["rationale"] != p["rationale"] for p in picks):
            picks.append(x)
    for p in picks:
        p["changes"] = {k: {"before": p["before"][k], "suggested": p["suggested"][k]} for k in p["before"] if p["before"][k] != p["suggested"].get(k)}
    write(
        "tuner.json",
        {
            "source": f"{NEON}: tuner_events (payload written by services/agent/src/core/tuner.ts)",
            "measuredAt": NOW,
            "network": "testnet",
            "provenance": "TESTNET",
            "mode": "shadow: the AI tuner only suggests parameter values; in shadow mode nothing is applied to live quoting, and the tuner never places orders",
            "appliedFieldNote": "payload.applied is the suggestion after the hard bounds and the 20% step limit (boundSuggestion). In shadow mode the agent keeps payload.before (services/agent/src/core/tuner.ts: next = mode === 'live' ? applied : current), which is why every later row still starts from the same 'before' values.",
            "hardBounds": {"source": "packages/risk/src/params.ts PARAM_BOUNDS", "maxStepChange": "20% per step (services/agent/src/core/tuner.ts)", "bounds": TUNER_BOUNDS},
            **t,
            "examples": picks[:5],
        },
    )


# ---------------------------------------------------------------- epochs


EPOCHS_SQL = """
select json_agg(json_build_object('network', network, 'season', season, 'epoch', epoch, 'start', start_time, 'end', end_time,
  'merkleRoot', merkle_root, 'dataUri', data_uri, 'txHash', tx_hash, 'postedAt', posted_at, 'contract', contract) order by season, epoch)
from epochs;
"""

SCORES_SQL = """
select json_agg(row_to_json(s)) from (select * from scores where network = 'testnet' order by season, epoch, agent_id) s;
"""


def epochs() -> None:
    rows = query(EPOCHS_SQL) or []
    scores = query(SCORES_SQL) or []
    skipped = []
    log = ROOT / ".run/logs/scorer-testnet.log"
    for line in log.read_text().splitlines():
        if '"epoch skipped"' in line:
            d = json.loads(line)
            skipped.append({"season": d["season"], "epoch": d["epoch"], "reason": d["reason"], "at": d["at"]})
    write(
        "epochs.json",
        {
            "source": f"{NEON}: epochs, scores; scorer log .run/logs/scorer-testnet.log for skipped epochs; tx on https://testnet.blockscout.injective.network",
            "measuredAt": NOW,
            "network": "testnet",
            "provenance": "TESTNET",
            "posted": rows,
            "postedCount": len(rows),
            "latest": rows[-1] if rows else None,
            "blockscout": [f"https://testnet.blockscout.injective.network/tx/{r['txHash']}" for r in rows if r["txHash"]],
            "epoch0Block": 147660200,
            "epoch0BlockSource": "docs/STATUS.md 'First attestation (testnet)'",
            "scores": scores,
            "skippedEpochs": skipped,
            "skippedNote": "The scorer refuses to post an epoch without enough book data; it skips with a logged reason rather than inventing scores.",
            "contracts": {
                "source": "packages/config/src/networks.ts (testnet)",
                "StrataArena": "0x2046D580f7c710bEE8C8eFE46CB34ccFD1B40870",
                "ScoreAttestor": "0xfb73da045cDc792dCb9f8Dcdc300aeE348bff4DF",
                "RewardsDistributor": "0x917DeD5aEC9B5eE1EE8430A9f179D600A321d628",
                "verified": "Blockscout shows 'Contract source code verified (exact match)' for StrataArena and ScoreAttestor (captured 2026-11-09, film/assets/screens/chain/); Sourcify exact match (docs/STATUS.md)",
            },
        },
    )


# ---------------------------------------------------------------- kill switch


KILL_SQL = """
select json_build_object(
  'command', (select row_to_json(k) from (select id, network, target_agent_id, close_positions, signer, requested_at, signature_expires_at from kill_commands) k limit 1),
  'guardEvents', (select json_agg(json_build_object('agentId', agent_id, 'reason', reason, 'action', action, 'detail', detail, 'observed', observed, 'at', at) order by at)
                  from guard_events where guard = 'kill_switch'));
"""


def killswitch() -> None:
    k = query(KILL_SQL)
    requested = datetime.fromisoformat(k["command"]["requested_at"].replace("Z", "+00:00"))
    first_ack = min(datetime.fromisoformat(g["at"].replace("Z", "+00:00")) for g in k["guardEvents"] if g["reason"] == "kill_switch_api")
    first_cancel = datetime(2026, 11, 8, 20, 0, 37, tzinfo=timezone.utc)
    internal_202 = datetime(2026, 11, 8, 20, 1, 32, tzinfo=timezone.utc)
    internal_cancel = datetime(2026, 11, 8, 20, 1, 48, tzinfo=timezone.utc)
    write(
        "killswitch.json",
        {
            "source": "docs/STATUS.md 'Kill switch test'; terminal captures deliverables/screens/killswitch/01..09*.txt; Neon kill_commands and guard_events (read-only)",
            "measuredAt": NOW,
            "testedAt": "2026-11-08 (UTC)",
            "network": "testnet",
            "provenance": "TESTNET",
            "paths": [
                {
                    "path": "signed admin API (EIP-191, POST https://strata-api-nine.vercel.app/v1/admin/kill)",
                    "target": "agent 1 strata-test-1",
                    "commandId": k["command"]["id"],
                    "signer": k["command"]["signer"],
                    "requestedAt": k["command"]["requested_at"],
                    "httpStatus": 202,
                    "agentAckAt": first_ack.isoformat().replace("+00:00", "Z"),
                    "ackLatencySec": round((first_ack - requested).total_seconds(), 2),
                    "cancelAllTxs": [
                        {"hash": "BA464D0D0445189D230D21D166A9029F79D3F6ABFF2C7731A54AB35C0892D925", "blockTime": "2026-11-08T20:00:37Z", "height": 147657579},
                        {"hash": "EEC74465762AAEF75F9FB01DB27741456FBCE35F6A0D2427B8E5E96CBA3E421C", "blockTime": "2026-11-08T20:00:41Z", "height": 147657585},
                        {"hash": "0CACA2D8ABF7F4C9C3C5B099EF321C17935A347269296C8DB0926AB676C8E320", "blockTime": "2026-11-08T20:00:44Z", "height": 147657591},
                    ],
                    "requestToFirstCancelTxSec": round((first_cancel - requested).total_seconds(), 1),
                    "openOrdersBefore": 8,
                    "openOrdersAfter": 0,
                    "openOrdersAfterCheckedAt": "2026-11-08T20:00:49Z",
                    "othersKeptQuoting": "agents 2 and 3 kept their 8 orders (target honored)",
                    "explorer": "https://testnet.injscan.com/transaction/BA464D0D0445189D230D21D166A9029F79D3F6ABFF2C7731A54AB35C0892D925/",
                },
                {
                    "path": "internal kill (the path the Telegram bot relays), localhost control port, bearer token",
                    "target": "agent 3 strata-test-3",
                    "acceptedAt": "2026-11-08T20:01:32Z",
                    "negativeChecks": {"wrongToken": 401, "malformedBody": 400},
                    "cancelAllTxs": [
                        {"hash": "E5A7D4707AA6A9FD8DCB12AEB7FBC5CEFC22EE998F53772476C00BBE945DD171", "blockTime": "2026-11-08T20:01:48Z", "height": 147657708},
                        {"hash": "80E997A349BB67F2DE66DE02234446E095299E255A30B0FD59A2C6643A98D77E", "blockTime": "2026-11-08T20:01:50Z", "height": 147657711},
                    ],
                    "requestToFirstCancelTxSec": round((internal_cancel - internal_202).total_seconds(), 1),
                    "openOrdersAfter": 0,
                    "openOrdersAfterCheckedAt": "2026-11-08T20:01:53Z",
                },
                {
                    "path": "environment flag KILL_SWITCH=true at restart (RUNBOOK 6.3)",
                    "target": "agent 2 strata-test-2",
                    "restartAt": "2026-11-08T20:02:06Z",
                    "cancelAllTxs": [
                        {"hash": "AB098999023AA7E4433D4F7D15BB87F71ED4820ED6F6A7BE4C19E18978EFC0C1", "blockTime": "2026-11-08T20:02:15Z", "height": 147657757, "note": "shutdown cancel-all"},
                        {"hash": "3573B6B5C75417649CF24A44D0F72F57AB197302FA3B38067635679C517B1C9C", "blockTime": "2026-11-08T20:02:42Z", "height": 147657806, "note": "defensive cancel-all after restart with killed: true"},
                    ],
                    "openOrdersAfter": 0,
                },
            ],
            "resume": {"clearedBy": "clear-stops --kill --confirm (human only)", "openOrdersAgain": 16, "checkedAt": "2026-11-08T20:04:56Z"},
            "latencySummary": "Latch flips within about 1 s (0.86 s measured on the API path). Request to first cancel tx in a block: about 10 s (API) and 16 s (internal); the delay is the next quoting cycle plus block inclusion.",
            "neon": k,
        },
    )


# ---------------------------------------------------------------- tests and security


def quality() -> None:
    tests = json.loads((Path(__file__).parent / "test-counts.json").read_text())
    write(
        "quality.json",
        {
            "measuredAt": NOW,
            "tests": tests,
            "security": {
                "source": "docs/SECURITY_REVIEW.md (W11 independent review, snapshot HEAD 78843ec + tree at 2026-11-09 00:30 IST) and docs/STATUS.md for fixes",
                "findings": {"critical": 0, "high": 2, "medium": 5, "low": 10, "total": 17},
                "fixedPerStatus": {
                    "H-1": "fixed (enroll binds subaccount to msg.sender, one enrollment per subaccount per season), docs/STATUS.md line 27",
                    "H-2": "fixed (risk stops, peak equity and kill latch persisted in agent_risk_state), docs/STATUS.md line 44",
                    "M-1": "fixed (EpochOutOfWindow), docs/STATUS.md line 28",
                    "M-4": "fixed: the signed admin kill reaches the agent (proven in the kill switch test), docs/STATUS.md 'Kill switch test'",
                    "L-1": "fixed by removal, docs/STATUS.md line 29",
                    "L-8": "fixed (metadataURI scheme check), docs/STATUS.md line 119",
                },
                "contractsStaticAnalysis": {"source": "docs/STATUS.md line 32", "slither": "0 High / 0 Medium", "aderyn": "0 High / 0 Medium / 1 Low accepted", "coverageSrc": "100% lines (179/179), statements, branches (50/50), functions (33/33)"},
            },
            "lighthouse": {"source": "docs/STATUS.md (Lighthouse 13.6.0 on production)", "landingDesktop": "100 / 100 / 100 / 100", "landingMobile": "100 / 100 / 100 / 100", "arenaDesktop": "98 / 100 / 100 / 100"},
        },
    )


# ---------------------------------------------------------------- references


def references() -> None:
    prd = (ROOT / "docs/PRD.md").read_text()
    url = re.search(r"Ostium exploit \(oracle lesson\): (\S+)", prd).group(1)
    write(
        "references.json",
        {
            "measuredAt": NOW,
            "ostium": {
                "claim": "Ostium lost about $18M to oracle reports with future-dated timestamps (July 2026)",
                "prdLine": "Ostium lost $18M to oracle reports with future-dated timestamps",
                "source": "docs/PRD.md section 'References' and table row 'Ostium lost $18M ...' (section 9.4 Oracle Guard, lesson from Ostium)",
                "url": url,
                "date": "2026-07-15 (from the article URL)",
                "strataResponse": "Oracle Guard in every agent: reject stale or future timestamps, cross-check sources, halt on anomaly",
            },
        },
    )


# ---------------------------------------------------------------- terminal lines


IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
SECRET_PATTERNS = [
    re.compile(r"postgres(?:ql)?://\S+", re.I),
    re.compile(r"[\w.-]+\.neon\.tech[\w:/.-]*", re.I),
    re.compile(r"(?i)bearer\s+(?!<token>|wrong\b|token\b)\S+"),
    re.compile(r"(?i)(passphrase|password|mnemonic|private[_ ]?key)\s*[=:]\s*\S+"),
]


def scrub(text: str) -> str:
    for pat in SECRET_PATTERNS:
        text = pat.sub("<redacted>", text)
    return IPV4.sub("localhost", text)


def log_lines(path: Path, wanted: dict[str, int]) -> list[dict]:
    """Up to N JSON log lines per msg, verbatim apart from scrubbing; the DB host field is dropped."""
    out, seen = [], Counter()
    for raw in path.read_text().splitlines():
        if not raw.startswith("{"):
            continue
        try:
            d = json.loads(raw)
        except json.JSONDecodeError:
            continue
        msg = d.get("msg")
        if msg not in wanted or seen[msg] >= wanted[msg]:
            continue
        seen[msg] += 1
        if "database" in d:
            d["database"] = "<redacted>"
            raw = json.dumps(d, separators=(",", ":"))
        out.append({"source": str(path.relative_to(ROOT)), "at": d.get("at") or d.get("t"), "msg": msg, "line": scrub(raw)})
    return out


GUARD_LINES_SQL = """
select json_agg(json_build_object('at', g.at, 'agent', a.name, 'guard', g.guard, 'action', g.action, 'reason', g.reason,
  'market', m.ticker, 'detail', g.detail, 'observed', g.observed) order by g.at)
from (select *, row_number() over (partition by reason, action order by at desc) rn from guard_events
      where network = 'testnet' and provenance = 'TESTNET') g
left join agents a on a.network = g.network and a.agent_id = g.agent_id
left join markets m on m.network = g.network and m.market_id = g.market_id
where g.rn <= 3;
"""


def terminal() -> None:
    logs = ROOT / ".run/logs"
    agent_logs = []
    for name in ("strata-test-1", "strata-test-2", "strata-test-3"):
        agent_logs += log_lines(logs / f"{name}.log", {"agent started": 2, "restored persisted safety state": 1, "shutdown: cancelling all orders": 1})
    scorer = log_lines(logs / "scorer-testnet.log", {"scorer starting": 1, "epoch root broadcast": 1, "epoch root confirmed": 1, "epoch skipped": 2})
    options = log_lines(logs / "strata-options.log", {"options agent started": 1, "cycle": 2})
    sessions = []
    for f in sorted((ROOT / "deliverables/screens/killswitch").glob("*.txt")):
        sessions.append({"source": str(f.relative_to(ROOT)), "lines": [scrub(l) for l in f.read_text().splitlines()]})
    quotes_file = Path(__file__).parent / "open-orders.latest.txt"
    quotes = {"source": "pnpm --filter @strata/agent inj:open-orders (read-only Injective testnet query), film/capture/open-orders.latest.txt", "lines": [scrub(l) for l in quotes_file.read_text().splitlines()]}
    guards = []
    for g in query(GUARD_LINES_SQL) or []:
        obs = " ".join(f"{k}={v}" for k, v in g["observed"].items())
        market = f" market={g['market']}" if g["market"] else ""
        guards.append({"at": g["at"], "line": scrub(f"{g['at']} {g['agent']} guard={g['guard']} action={g['action']} reason={g['reason']}{market} \"{g['detail']}\" {obs}")})
    write(
        "terminal.json",
        {
            "measuredAt": NOW,
            "scrubbed": "No keys, passphrases, DB URLs or hosts, tokens or IP addresses. Every .secrets file value is checked absent (film/capture/check_secrets.sh).",
            "network": "testnet",
            "quotes": quotes,
            "killSwitchSessions": sessions,
            "guardEvents": {"source": f"{NEON}: guard_events, formatted one per line for typesetting (values verbatim)", "lines": guards},
            "agentLogs": {"source": ".run/logs/strata-test-{1,2,3}.log (JSON lines, verbatim)", "lines": agent_logs},
            "scorerLogs": {"source": ".run/logs/scorer-testnet.log (JSON lines, verbatim, DB host redacted)", "lines": scorer},
            "optionsLogs": {"source": ".run/logs/strata-options.log (SIMULATED options writer)", "provenance": "SIMULATED", "lines": options},
        },
    )


if __name__ == "__main__":
    baseline()
    markets()
    agents()
    tuner()
    epochs()
    killswitch()
    quality()
    references()
    terminal()
