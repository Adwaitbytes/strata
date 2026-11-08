/**
 * RWA classification of Injective derivative tickers.
 *
 * The Indexer market record has no asset-class field, and Pyth Pro oracle bases are numeric feed
 * IDs, so classification is by ticker symbol. The symbol sets below were built from the live
 * mainnet + testnet market lists returned by IndexerGrpcDerivativesApi.fetchMarkets
 * (marketStatus "active") on 2026-11-09. They are labels, not identifiers: market IDs always
 * come from the live fetch. Symbols that are ambiguous between a token and a stock (A, H, SPX,
 * CC, PONS, SKYD, SPCX) are left unclassified and are not recorded as RWA.
 */
import type { AssetClass } from "@strata/sdk";

const EQUITIES = new Set(
  (
    "AAPL ABNB ADBE AFRM AI AMC AMD AMGN AMT AMZN ANET APO ARM ASML AVGO AXP AZN BA BABA BAC BE BIDU " +
    "BIIB BILI BKNG BLK BX BYND C CCI CHTR CMG CME COF COIN COST CRCL CRDO CRM CRWD CRWV DELL DIS DKNG " +
    "DLR EDU ENPH EQIX FIS FLUT FSLR GD GILD GLXY GME GOOGL GRAB GS HIMS HOOD HPE IBM ICE INTC IREN " +
    "ISRG JD JPM KKR KO LI LLY LMT LULU LVS LYV MA MCD MELI META MGM MNST MO MRK MRNA MRVL MS MSFT MSTR " +
    "MU NBIS NEE NFLX NIO NKE NOC NOW NU NVDA NVO O OKLO ONTO ORCL PANW PDD PEP PFE PLD PLTR PM PSA " +
    "PYPL QCOM RBLX REGN RIO RIVN RKLB RTX SAP SBUX SCHW SMCI SNAP SNDK SNOW SOFI SPG SPGI SPOT STRC " +
    "TAP TEM TGT TKO TME TMO TSLA TSM TTD TTWO UBER UPST V VALE VOD VRT VRTX VST WFC WMT WYNN XOM XPEV"
  ).split(" "),
);
/** Broad indices, index ETFs and fund products. */
const INDICES = new Set("USTECH US500 DIA TLT ARKK ARKB IBIT BITB GBTC EVINDEX TRUCPI".split(" "));
const COMMODITIES = new Set("XAU XAG XPD XPT XAUT PAXG GLD GOLD BRENT WTI COPPER NATGAS".split(" "));
/** SICI: Injective GPU compute index perp (PRD 4.2). */
const COMPUTE = new Set(["SICI"]);
const FX_CCY = new Set("USD EUR GBP JPY AUD NZD CAD CHF HKD NOK SEK SGD".split(" "));

export type RwaClass = Exclude<AssetClass, "crypto">;

/** Base symbol of a derivative ticker: "XAU/USDC PERP" -> "XAU", "LIV-PERP" -> "LIV". */
export function baseSymbol(ticker: string): string {
  const head = ticker.trim().split(/[/\s]/)[0] ?? "";
  return head.replace(/-PERP$/i, "").toUpperCase();
}

export function isFxPair(symbol: string): boolean {
  if (!/^[A-Z]{6}$/.test(symbol)) return false;
  const a = symbol.slice(0, 3);
  const b = symbol.slice(3);
  return a !== b && FX_CCY.has(a) && FX_CCY.has(b) && (a === "USD" || b === "USD");
}

export function classifyRwa(ticker: string): RwaClass | null {
  const s = baseSymbol(ticker);
  if (COMPUTE.has(s)) return "compute";
  if (COMMODITIES.has(s)) return "commodity";
  if (INDICES.has(s)) return "index";
  if (isFxPair(s)) return "fx";
  if (EQUITIES.has(s)) return "equity";
  return null;
}
