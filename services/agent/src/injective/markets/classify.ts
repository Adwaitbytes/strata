/**
 * Asset-class heuristic for Injective derivative markets. Documented in docs/INJECTIVE.md.
 *
 * Order of rules (first match wins):
 *  1. Compute: base symbol SICI (Super Intelligence Compute Index), or a Pyth Pro feed whose
 *     asset_type is "compute".
 *  2. Index: Injective's broad US index perps (US500, USTECH; their Pyth Pro feeds are the SPY and
 *     QQQ ETFs, which Pyth labels "equity"), any provider symbol ending in ".INDEX", and the
 *     testnet price-feed indices EVINDEX and TRUCPI.
 *  3. Pyth Pro metadata (asset_type from the Pyth Lazer symbols API) when the oracle is pythpro.
 *  4. Commodity symbols on provider / pricefeed oracles (WTI, BRENT, NATGAS, COPPER, GOLD, ...).
 *  5. FX pairs: two ISO 4217 codes concatenated (EURUSD, USDJPY, ...).
 *  6. Everything else is crypto. Chainlink Data Streams feeds on Injective are crypto feeds only
 *     (observed in the live market list on 2026-11-09).
 */
import type { AssetClass } from "@strata/sdk";

export interface PythSymbolMeta {
  id: number;
  symbol: string;
  assetType: string;
  /** Pyth market-hours schedule string, e.g. "America/New_York;0930-1600,...". */
  schedule: string | null;
  hermesId: string | null;
}

export interface ClassificationInput {
  ticker: string;
  oracleType: string;
  oracleBase: string;
  oracleQuote: string;
  pyth: PythSymbolMeta | null;
}

export interface Classification {
  assetClass: AssetClass;
  /** Name of the rule that matched, stored next to the market for auditability. */
  rule: string;
}

const INDEX_TICKERS = new Set(["US500", "USTECH", "EVINDEX", "TRUCPI"]);
const COMMODITY_SYMBOLS = new Set(["WTI", "BRENT", "NATGAS", "COPPER", "GOLD", "SILVER", "XAU", "XAG", "XPT", "XPD"]);
const ISO_CURRENCIES = new Set([
  "USD", "EUR", "JPY", "GBP", "AUD", "NZD", "CAD", "CHF", "HKD", "SGD", "NOK", "SEK", "DKK", "CNH", "CNY",
  "MXN", "ZAR", "TRY", "INR", "KRW", "BRL", "PLN", "THB", "IDR", "TWD",
]);

/** "XAU/USDC PERP" -> "XAU", "LIV-PERP" -> "LIV", "qaBTC/USDC PERP" -> "qaBTC". */
export function baseSymbol(ticker: string): string {
  const head = ticker.split("/")[0] ?? ticker;
  return head.replace(/[-\s]PERP$/i, "").trim();
}

export function isFxPair(symbol: string): boolean {
  if (!/^[A-Z]{6}$/.test(symbol)) return false;
  return ISO_CURRENCIES.has(symbol.slice(0, 3)) && ISO_CURRENCIES.has(symbol.slice(3));
}

function fromPythAssetType(assetType: string): AssetClass | null {
  switch (assetType) {
    case "equity":
      return "equity";
    case "fx":
      return "fx";
    case "metal":
    case "commodity":
      return "commodity";
    case "compute":
      return "compute";
    case "crypto":
    case "crypto-index":
    case "crypto-redemption-rate":
      return "crypto";
    case "interest-rate":
    case "macro":
    case "nav":
      return "index";
    default:
      return null;
  }
}

export function classifyMarket(input: ClassificationInput): Classification {
  const base = baseSymbol(input.ticker);
  const upper = base.toUpperCase();
  const oracleType = input.oracleType.toLowerCase();

  if (upper === "SICI" || input.pyth?.assetType === "compute") return { assetClass: "compute", rule: "compute-sici" };
  if (INDEX_TICKERS.has(upper)) return { assetClass: "index", rule: "index-ticker" };
  if (oracleType === "provider" && input.oracleBase.toUpperCase().endsWith(".INDEX")) {
    return { assetClass: "index", rule: "index-provider-symbol" };
  }
  if (oracleType === "pythpro" && input.pyth !== null) {
    const mapped = fromPythAssetType(input.pyth.assetType);
    if (mapped !== null) return { assetClass: mapped, rule: `pyth-asset-type:${input.pyth.assetType}` };
  }
  if (COMMODITY_SYMBOLS.has(upper)) return { assetClass: "commodity", rule: "commodity-symbol" };
  if (isFxPair(upper)) return { assetClass: "fx", rule: "fx-iso-pair" };
  if (oracleType === "chainlinkdatastreams") return { assetClass: "crypto", rule: "chainlink-data-streams-crypto" };
  return { assetClass: "crypto", rule: "default-crypto" };
}
