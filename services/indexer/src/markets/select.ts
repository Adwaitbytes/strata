/**
 * Baseline candidate selection (PRD 10.4). Active RWA perps plus every market listed in
 * @strata/config (W3's live-fetched arena list). An optional cap keeps the story markets first;
 * the production DB is Neon free tier (D26), so the cap matters there.
 */
import type { AssetClass, Market, NetworkName } from "@strata/sdk";
import type { RawDerivativeMarket } from "../injective/reader.js";
import { baseSymbol, classifyRwa } from "./classify.js";

export interface CandidateMarket {
  network: NetworkName;
  marketId: string;
  ticker: string;
  /** null when the ticker is not a recognised RWA but W3 listed it as an arena market. */
  assetClass: AssetClass | null;
  quoteDecimals: number;
  oracleType: string;
  oracleBase: string;
  oracleQuote: string;
  oracleScaleFactor: number;
  raw: RawDerivativeMarket;
}

/** Story-first order used when a cap is set (PRD 9.9: SICI, gold, EUR, US tech first). */
const PRIORITY = ["SICI", "XAU", "EURUSD", "USTECH", "US500", "XAG", "WTI", "BRENT", "GBPUSD", "USDJPY", "NVDA", "AAPL", "TSLA", "GOLD", "EVINDEX", "TRUCPI"];

function rank(m: CandidateMarket, configured: ReadonlySet<string>): number {
  if (configured.has(m.marketId)) return -1;
  const i = PRIORITY.indexOf(baseSymbol(m.ticker));
  if (i >= 0) return i;
  return m.assetClass === null ? 10_000 : 1_000;
}

export function selectBaselineMarkets(
  network: NetworkName,
  markets: readonly RawDerivativeMarket[],
  configured: readonly Pick<Market, "marketId">[] = [],
  maxMarkets = Number.POSITIVE_INFINITY,
): CandidateMarket[] {
  const configuredIds = new Set(configured.map((m) => m.marketId));
  const picked: CandidateMarket[] = [];
  for (const m of markets) {
    if (m.marketStatus !== "active" || !m.isPerpetual) continue;
    const assetClass = classifyRwa(m.ticker);
    if (assetClass === null && !configuredIds.has(m.marketId)) continue;
    picked.push({
      network,
      marketId: m.marketId,
      ticker: m.ticker,
      assetClass,
      quoteDecimals: m.quoteDecimals,
      oracleType: m.oracleType,
      oracleBase: m.oracleBase,
      oracleQuote: m.oracleQuote,
      oracleScaleFactor: m.oracleScaleFactor,
      raw: m,
    });
  }
  return picked
    .sort((a, b) => rank(a, configuredIds) - rank(b, configuredIds) || a.ticker.localeCompare(b.ticker))
    .slice(0, maxMarkets);
}
