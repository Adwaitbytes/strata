/**
 * Live market fetch (PRD 4.5: market IDs and params come from a fetch script, never by hand).
 *
 * Sources, all queried live:
 *  1. Injective Indexer `derivatives/markets` via `IndexerGrpcDerivativesApi.fetchMarkets`
 *     (endpoint from `@injectivelabs/networks` getNetworkEndpoints). This is the market list.
 *  2. Chain exchange v2 params via the chain REST gateway `/injective/exchange/v2/derivative/markets`
 *     on the same official endpoint bundle. These are human-readable and authoritative; the fetch
 *     cross-checks the Indexer's chain-format tick and min notional against them.
 *  3. Chain oracle module (see ../oracle.ts) for oracle freshness at fetch time.
 *  4. Pyth Pro symbols metadata `https://pyth.dourolabs.app/v1/symbols` (documented in
 *     https://docs.pyth.network/llms-price-feeds-pro.txt, "History API ... GET /symbols, no auth")
 *     for asset type and market-hours schedule of pythpro feeds.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IndexerGrpcDerivativesApi } from "@injectivelabs/sdk-ts";
import { Market } from "@strata/sdk";
import type { AssetClass, NetworkName } from "@strata/sdk";
import { z } from "zod";
import { getEndpointSet, withFailover } from "../endpoints.js";
import { readOracle } from "../oracle.js";
import { dec, plain, scaleDown } from "../units.js";
import { baseSymbol, classifyMarket } from "./classify.js";
import type { PythSymbolMeta } from "./classify.js";

export const PYTH_SYMBOLS_URL = "https://pyth.dourolabs.app/v1/symbols";
const CHAIN_MARKETS_PATH = "/injective/exchange/v2/derivative/markets?status=Active";

/**
 * Arena candidates per network (PRD 9.9). Matched by ticker against the live list, so a missing
 * market is reported, never invented.
 */
export const MAINNET_ARENA_TICKERS = ["SICI/USDC PERP", "XAU/USDC PERP", "EURUSD/USDC PERP", "USTECH/USDC PERP"] as const;
/** Testnet: up to 8 USDC-margined perps with a fresh oracle, preferring non-crypto (RWA) markets. */
export const TESTNET_ARENA_MAX = 8;
export const TESTNET_ARENA_MIN = 5;
/** An oracle older than this at fetch time is treated as dead for testnet arena selection. */
export const TESTNET_MAX_ORACLE_AGE_SEC = 15 * 60;
/**
 * Second tier used only to reach TESTNET_ARENA_MIN: non-crypto provider feeds that update in
 * hours, not seconds (the testnet N10Labs index perps). The Oracle Guard still halts them when stale.
 */
export const TESTNET_SLOW_ORACLE_MAX_AGE_SEC = 6 * 60 * 60;

/** STRATA arena policy (not chain facts): spread cap for uptime and minimum depth, by asset class. */
const ARENA_POLICY: Record<AssetClass, { maxSpreadBps: number; minDepthUsd: number }> = {
  crypto: { maxSpreadBps: 50, minDepthUsd: 1_000 },
  fx: { maxSpreadBps: 20, minDepthUsd: 1_000 },
  commodity: { maxSpreadBps: 50, minDepthUsd: 1_000 },
  index: { maxSpreadBps: 50, minDepthUsd: 1_000 },
  equity: { maxSpreadBps: 75, minDepthUsd: 500 },
  compute: { maxSpreadBps: 100, minDepthUsd: 500 },
};
const TESTNET_MIN_DEPTH_USD = 100;

const ChainMarket = z.object({
  market: z.object({
    ticker: z.string(),
    market_id: z.string(),
    quote_denom: z.string(),
    quote_decimals: z.number().int(),
    oracle_type: z.string(),
    oracle_base: z.string(),
    oracle_quote: z.string(),
    initial_margin_ratio: z.string(),
    maintenance_margin_ratio: z.string(),
    maker_fee_rate: z.string(),
    taker_fee_rate: z.string(),
    min_price_tick_size: z.string(),
    min_quantity_tick_size: z.string(),
    min_notional: z.string(),
    isPerpetual: z.boolean(),
    status: z.string(),
  }),
  mark_price: z.string().optional(),
});
const ChainMarkets = z.object({ markets: z.array(ChainMarket) });
type ChainMarket = z.infer<typeof ChainMarket>;

const PythSymbol = z.object({
  pyth_lazer_id: z.number().int(),
  symbol: z.string(),
  asset_type: z.string(),
  schedule: z.string().nullable().optional(),
  hermes_id: z.string().nullable().optional(),
});

/** Session and oracle metadata written next to the market list for the Session and Oracle guards. */
export const MarketSessionMeta = z.object({
  network: z.enum(["mainnet", "testnet"]),
  marketId: z.string(),
  ticker: z.string(),
  assetClass: z.string(),
  classificationRule: z.string(),
  oracleType: z.string(),
  oracleBase: z.string(),
  oracleQuote: z.string(),
  /** Pyth Pro symbol and market-hours schedule string when the oracle is pythpro. */
  pythSymbol: z.string().nullable(),
  pythSchedule: z.string().nullable(),
  /** Pyth Hermes price id for an independent reference read (PRD 9.4 two-source check). */
  hermesId: z.string().nullable(),
  /** Oracle report timestamp and age at fetch time; null when not read. */
  oracleTimestampMs: z.number().nullable(),
  oracleAgeSecAtFetch: z.number().nullable(),
  oraclePriceAtFetch: z.string().nullable(),
  markPriceAtFetch: z.string().nullable(),
  arenaEnabled: z.boolean(),
  arenaReason: z.string(),
  fetchedAt: z.number(),
});
export type MarketSessionMeta = z.infer<typeof MarketSessionMeta>;

export interface FetchResult {
  network: NetworkName;
  markets: Market[];
  sessions: MarketSessionMeta[];
  warnings: string[];
  arenaTickers: string[];
  missingArenaTickers: string[];
}

async function fetchJson(url: string, timeoutMs = 20_000): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchPythSymbols(): Promise<Map<number, PythSymbolMeta>> {
  const raw = z.array(z.unknown()).parse(await fetchJson(PYTH_SYMBOLS_URL, 30_000));
  const out = new Map<number, PythSymbolMeta>();
  for (const item of raw) {
    const parsed = PythSymbol.safeParse(item);
    if (!parsed.success) continue;
    const s = parsed.data;
    out.set(s.pyth_lazer_id, { id: s.pyth_lazer_id, symbol: s.symbol, assetType: s.asset_type, schedule: s.schedule ?? null, hermesId: s.hermes_id ?? null });
  }
  return out;
}

function pythFor(oracleType: string, oracleBase: string, pyth: Map<number, PythSymbolMeta>): PythSymbolMeta | null {
  if (oracleType.toLowerCase() !== "pythpro" || !/^\d+$/.test(oracleBase)) return null;
  return pyth.get(Number(oracleBase)) ?? null;
}

export async function fetchMarkets(network: NetworkName, now: () => number = Date.now): Promise<FetchResult> {
  const set = getEndpointSet(network);
  const warnings: string[] = [];

  const { indexerMarkets, indexerUrl } = await withFailover(set, async (e) => ({
    indexerMarkets: await new IndexerGrpcDerivativesApi(e.indexer).fetchMarkets(),
    indexerUrl: e.indexer,
  }));
  const chainMarkets = await withFailover(set, async (e) => ChainMarkets.parse(await fetchJson(`${e.rest}${CHAIN_MARKETS_PATH}`)).markets);
  const pyth = await fetchPythSymbols().catch((err: unknown) => {
    warnings.push(`Pyth symbols unavailable (${String(err)}); pythpro classification falls back to ticker rules`);
    return new Map<number, PythSymbolMeta>();
  });
  const fetchedAt = now();
  const chainById = new Map<string, ChainMarket>(chainMarkets.map((m) => [m.market.market_id.toLowerCase(), m]));

  interface Draft {
    market: Market;
    meta: MarketSessionMeta;
    chain: ChainMarket;
  }
  const drafts: Draft[] = [];

  for (const m of indexerMarkets) {
    // DerivativeMarket is a union (perpetual | expiry | binary options); only perpetuals carry isPerpetual=true.
    if (!("isPerpetual" in m) || m.isPerpetual !== true || !("oracleBase" in m)) continue;
    const im = m;
    if (im.marketStatus !== "active") continue;
    const cm = chainById.get(im.marketId.toLowerCase());
    if (cm === undefined) {
      warnings.push(`${im.ticker} ${im.marketId}: in Indexer but not in chain v2 active list, skipped`);
      continue;
    }
    const c = cm.market;
    // Cross-check: Indexer chain-format tick / 10^quoteDecimals must equal the chain v2 human tick.
    const idxTick = scaleDown(im.minPriceTickSize, c.quote_decimals);
    if (!dec(idxTick).eq(c.min_price_tick_size)) {
      warnings.push(`${c.ticker}: indexer tick ${idxTick} != chain tick ${plain(dec(c.min_price_tick_size))}, using chain`);
    }
    const p = pythFor(im.oracleType, im.oracleBase, pyth);
    const cls = classifyMarket({ ticker: c.ticker, oracleType: im.oracleType, oracleBase: im.oracleBase, oracleQuote: im.oracleQuote, pyth: p });
    const policy = ARENA_POLICY[cls.assetClass];
    const market = Market.parse({
      network,
      marketId: c.market_id,
      ticker: c.ticker,
      symbol: baseSymbol(c.ticker),
      assetClass: cls.assetClass,
      quoteDenom: c.quote_denom,
      quoteDecimals: c.quote_decimals,
      oracleType: im.oracleType,
      oracleBase: im.oracleBase,
      oracleQuote: im.oracleQuote,
      minPriceTickSize: plain(dec(c.min_price_tick_size)),
      minQuantityTickSize: plain(dec(c.min_quantity_tick_size)),
      minNotional: plain(dec(c.min_notional)),
      makerFeeRate: plain(dec(c.maker_fee_rate)),
      takerFeeRate: plain(dec(c.taker_fee_rate)),
      initialMarginRatio: plain(dec(c.initial_margin_ratio)),
      maintenanceMarginRatio: plain(dec(c.maintenance_margin_ratio)),
      isPerpetual: c.isPerpetual,
      arenaEnabled: false,
      maxSpreadBps: policy.maxSpreadBps,
      minDepthUsd: network === "testnet" ? TESTNET_MIN_DEPTH_USD : policy.minDepthUsd,
      fetchedAt,
      source: `${indexerUrl}#derivatives/markets`,
    });
    const meta: MarketSessionMeta = {
      network,
      marketId: market.marketId,
      ticker: market.ticker,
      assetClass: cls.assetClass,
      classificationRule: cls.rule,
      oracleType: im.oracleType,
      oracleBase: im.oracleBase,
      oracleQuote: im.oracleQuote,
      pythSymbol: p?.symbol ?? null,
      pythSchedule: p?.schedule ?? null,
      hermesId: p?.hermesId ?? null,
      oracleTimestampMs: null,
      oracleAgeSecAtFetch: null,
      oraclePriceAtFetch: null,
      markPriceAtFetch: cm.mark_price === undefined ? null : plain(dec(cm.mark_price)),
      arenaEnabled: false,
      arenaReason: "not a candidate",
      fetchedAt,
    };
    drafts.push({ market, meta, chain: cm });
  }

  const readFreshness = async (d: Draft): Promise<void> => {
    try {
      const r = await withFailover(set, (e) => readOracle(e.grpc, d.market));
      d.meta.oracleTimestampMs = r.timestampMs;
      d.meta.oracleAgeSecAtFetch = Math.round((fetchedAt - r.timestampMs) / 1000);
      d.meta.oraclePriceAtFetch = r.price;
    } catch (err) {
      warnings.push(`${d.market.ticker}: oracle read failed: ${String(err)}`);
    }
  };

  const arenaTickers: string[] = [];
  const missingArenaTickers: string[] = [];
  if (network === "mainnet") {
    for (const ticker of MAINNET_ARENA_TICKERS) {
      const d = drafts.find((x) => x.market.ticker === ticker);
      if (d === undefined) {
        missingArenaTickers.push(ticker);
        continue;
      }
      await readFreshness(d);
      d.market.arenaEnabled = true;
      d.meta.arenaEnabled = true;
      d.meta.arenaReason = "PRD 9.9 mainnet house-agent market";
      arenaTickers.push(ticker);
    }
  } else {
    if (!drafts.some((d) => d.market.symbol.toUpperCase() === "SICI")) missingArenaTickers.push("SICI/USDC PERP");
    await Promise.all(drafts.map(readFreshness));
    const eligible = drafts
      .filter((d) => d.market.quoteDenom.toLowerCase().startsWith("erc20:"))
      .filter((d) => d.meta.oracleAgeSecAtFetch !== null && d.meta.oracleAgeSecAtFetch <= TESTNET_MAX_ORACLE_AGE_SEC)
      .filter((d) => !d.market.symbol.startsWith("qa"));
    // Non-crypto first (RWA story), then crypto by ticker for determinism.
    eligible.sort((a, b) => {
      const ra = a.market.assetClass === "crypto" ? 1 : 0;
      const rb = b.market.assetClass === "crypto" ? 1 : 0;
      return ra - rb || a.market.ticker.localeCompare(b.market.ticker);
    });
    for (const d of eligible.slice(0, TESTNET_ARENA_MAX)) {
      d.market.arenaEnabled = true;
      d.meta.arenaEnabled = true;
      d.meta.arenaReason = `testnet: native USDC quote, oracle age ${d.meta.oracleAgeSecAtFetch}s at fetch`;
      arenaTickers.push(d.market.ticker);
    }
    if (arenaTickers.length < TESTNET_ARENA_MIN) {
      const slow = drafts
        .filter((d) => !d.meta.arenaEnabled && d.market.assetClass !== "crypto")
        .filter((d) => d.market.quoteDenom.toLowerCase().startsWith("erc20:"))
        .filter((d) => d.meta.oracleAgeSecAtFetch !== null && d.meta.oracleAgeSecAtFetch <= TESTNET_SLOW_ORACLE_MAX_AGE_SEC)
        .sort((a, b) => (a.meta.oracleAgeSecAtFetch ?? 0) - (b.meta.oracleAgeSecAtFetch ?? 0));
      for (const d of slow.slice(0, TESTNET_ARENA_MAX - arenaTickers.length)) {
        d.market.arenaEnabled = true;
        d.meta.arenaEnabled = true;
        d.meta.arenaReason = `testnet slow-oracle tier: native USDC quote, oracle age ${d.meta.oracleAgeSecAtFetch}s at fetch (updates hourly, not per block)`;
        arenaTickers.push(d.market.ticker);
      }
    }
    if (arenaTickers.length < TESTNET_ARENA_MIN) {
      warnings.push(`only ${arenaTickers.length} testnet markets have a native USDC quote and a fresh oracle (wanted ${TESTNET_ARENA_MIN})`);
    }
    for (const d of drafts) {
      if (d.meta.arenaEnabled) continue;
      if (!d.market.quoteDenom.toLowerCase().startsWith("erc20:")) d.meta.arenaReason = "quote is not native USDC";
      else if (d.market.symbol.startsWith("qa")) d.meta.arenaReason = "QA test market";
      else if (d.meta.oracleAgeSecAtFetch === null) d.meta.arenaReason = "oracle unreadable";
      else if (d.meta.oracleAgeSecAtFetch > TESTNET_MAX_ORACLE_AGE_SEC) d.meta.arenaReason = `oracle stale (${d.meta.oracleAgeSecAtFetch}s)`;
    }
  }

  drafts.sort((a, b) => a.market.ticker.localeCompare(b.market.ticker));
  return {
    network,
    markets: drafts.map((d) => Market.parse(d.market)),
    sessions: drafts.map((d) => MarketSessionMeta.parse(d.meta)),
    warnings,
    arenaTickers,
    missingArenaTickers,
  };
}

export async function writeMarkets(result: FetchResult, outDir: string): Promise<{ marketsPath: string; sessionsPath: string }> {
  await mkdir(outDir, { recursive: true });
  const marketsPath = join(outDir, `markets.${result.network}.json`);
  const sessionsPath = join(outDir, `market-sessions.${result.network}.json`);
  await writeFile(marketsPath, JSON.stringify(result.markets, null, 2) + "\n");
  await writeFile(sessionsPath, JSON.stringify(result.sessions, null, 2) + "\n");
  return { marketsPath, sessionsPath };
}
