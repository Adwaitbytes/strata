/**
 * Trade backfill (PRD 11.1): walks the Indexer trade history newest-first from `untilMs` back to
 * `sinceMs` for the given markets, writing trades and attributed agent fills idempotently.
 * Restart-safe: re-running any window inserts nothing new.
 */
import type { Db } from "@strata/db";
import type { NetworkName } from "@strata/sdk";
import type { InjectiveReader, RawDerivativeMarket } from "../injective/reader.js";
import { insertTrades } from "../store/live.js";
import { mapTrade, type FillRow, type TradeRow } from "./mappers.js";

export interface BackfillResult {
  pages: number;
  seen: number;
  insertedTrades: number;
  insertedFills: number;
  oldestMs: number | null;
}

export async function backfillTrades(args: {
  network: NetworkName;
  reader: InjectiveReader;
  db: Db;
  markets: readonly RawDerivativeMarket[];
  agentBySubaccount: ReadonlyMap<string, number>;
  sinceMs: number;
  untilMs: number;
  pageSize?: number;
  maxPages?: number;
}): Promise<BackfillResult> {
  const byId = new Map(args.markets.map((m) => [m.marketId.toLowerCase(), m]));
  const ids = [...byId.keys()];
  const limit = args.pageSize ?? 100;
  const res: BackfillResult = { pages: 0, seen: 0, insertedTrades: 0, insertedFills: 0, oldestMs: null };
  if (ids.length === 0) return res;
  let endTime = args.untilMs;
  const seenIds = new Set<string>();
  while (res.pages < (args.maxPages ?? 1_000)) {
    const page = await args.reader.fetchTrades({ marketIds: ids, startTime: args.sinceMs, endTime, limit });
    res.pages += 1;
    const trades: TradeRow[] = [];
    const fills: FillRow[] = [];
    let fresh = 0;
    for (const t of page) {
      if (seenIds.has(t.tradeId)) continue;
      seenIds.add(t.tradeId);
      fresh += 1;
      const m = byId.get(t.marketId.toLowerCase());
      if (!m) continue;
      const r = mapTrade(t, args.network, m.quoteDecimals, args.agentBySubaccount);
      trades.push(r.trade);
      if (r.fill) fills.push(r.fill);
      res.oldestMs = res.oldestMs === null ? t.executedAt : Math.min(res.oldestMs, t.executedAt);
    }
    res.seen += fresh;
    const w = await insertTrades(args.db, trades, fills);
    res.insertedTrades += w.trades;
    res.insertedFills += w.fills;
    // The next page ends at the oldest timestamp seen (inclusive, so same-ms trades are not
    // skipped; seenIds removes the overlap). A full page with nothing new means one millisecond
    // holds a whole page of trades: step 1 ms back so paging cannot stall.
    if (page.length < limit || res.oldestMs === null || res.oldestMs <= args.sinceMs) break;
    endTime = fresh === 0 ? Math.min(endTime, res.oldestMs) - 1 : res.oldestMs;
  }
  return res;
}
