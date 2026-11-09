import type { Quote } from "@strata/sdk";

export interface QuoteLadder {
  readonly marketId: string;
  /** Null when the market list has not loaded or does not include this market. */
  readonly ticker: string | null;
  readonly quotes: readonly Quote[];
  readonly levels: readonly number[];
  readonly maxQty: number;
  readonly mid: number | null;
  readonly spreadBps: number | null;
}

/**
 * One ladder per market. Mid and spread come only from that market's own best bid and ask:
 * an agent quoting BTC and ETH must never show a mid or spread computed across the two books.
 */
export function buildQuoteLadders(quotes: readonly Quote[], tickers: ReadonlyMap<string, string>): QuoteLadder[] {
  const byMarket = new Map<string, Quote[]>();
  for (const q of quotes) {
    if (q.cancelledAt != null) continue;
    const list = byMarket.get(q.marketId);
    if (list) list.push(q);
    else byMarket.set(q.marketId, [q]);
  }
  return [...byMarket.entries()]
    .map(([marketId, live]) => {
      const bestBid = Math.max(...live.filter((q) => q.side === "buy").map((q) => Number(q.price)));
      const bestAsk = Math.min(...live.filter((q) => q.side === "sell").map((q) => Number(q.price)));
      const mid = Number.isFinite(bestBid) && Number.isFinite(bestAsk) ? (bestBid + bestAsk) / 2 : null;
      return {
        marketId,
        ticker: tickers.get(marketId) ?? null,
        quotes: live,
        levels: [...new Set(live.map((q) => q.level))].sort((a, b) => a - b),
        maxQty: Math.max(...live.map((q) => Number(q.quantity)), 0),
        mid,
        spreadBps: mid ? ((bestAsk - bestBid) / mid) * 10_000 : null,
      };
    })
    .sort((a, b) => (a.ticker ?? a.marketId).localeCompare(b.ticker ?? b.marketId));
}
