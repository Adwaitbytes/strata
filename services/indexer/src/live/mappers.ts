/** Pure mapping from Indexer records to DB rows (trades, agent_fills, agent_orders, agent_positions). */
import type { agentFills, agentOrders, agentPositions, trades } from "@strata/db";
import type { NetworkName, Provenance } from "@strata/sdk";
import { fromFixed18, shiftDown, toFixed18, toNumber } from "../lib/decimal.js";
import type { IndexerOrder, IndexerPosition, IndexerTrade } from "./records.js";

export type TradeRow = typeof trades.$inferInsert;
export type FillRow = typeof agentFills.$inferInsert;
export type OrderRow = typeof agentOrders.$inferInsert;
export type PositionRow = typeof agentPositions.$inferInsert;

export function liveProvenance(network: NetworkName): Provenance {
  return network === "mainnet" ? "LIVE" : "TESTNET";
}

export function chainToHuman(value: string, quoteDecimals: number): string {
  return fromFixed18(shiftDown(toFixed18(value), quoteDecimals));
}

/**
 * Injective trade IDs are "<blockHeight>_<eventIndex>" (observed on mainnet, e.g. "190908174_5").
 * The Indexer trade record carries no EVM tx hash, so agent_fills uses the trade ID itself in
 * `tx_hash` and the parsed event index in `event_index`; the pair is unique per chain and keeps
 * fills idempotent across streams, restarts and backfills.
 */
export function tradeEventIndex(tradeId: string): number {
  const m = /_(\d+)$/.exec(tradeId);
  return m ? Number(m[1]) : 0;
}

/** Quote level from the agent's client order ID ("...-L2-..." / "l2_..."); 0 when absent. */
export function levelFromCid(cid: string): number {
  const m = /(?:^|[-_])l(\d{1,2})(?:[-_]|$)/i.exec(cid);
  return m ? Number(m[1]) : 0;
}

export function mapTrade(
  t: IndexerTrade,
  network: NetworkName,
  quoteDecimals: number,
  agentBySubaccount: ReadonlyMap<string, number>,
): { trade: TradeRow; fill: FillRow | null } {
  const executedAt = new Date(t.executedAt);
  const price = chainToHuman(t.executionPrice, quoteDecimals);
  const quantity = fromFixed18(toFixed18(t.executionQuantity));
  const fee = chainToHuman(t.fee, quoteDecimals);
  const subaccountId = t.subaccountId.toLowerCase();
  const isMaker = t.executionSide === "maker";
  const trade: TradeRow = {
    network,
    marketId: t.marketId.toLowerCase(),
    tradeId: t.tradeId,
    executedAt,
    price,
    quantity,
    side: t.tradeDirection,
    subaccountId,
    isMaker,
    fee,
  };
  const agentId = agentBySubaccount.get(subaccountId);
  const fill: FillRow | null =
    agentId === undefined
      ? null
      : {
          network,
          agentId,
          marketId: trade.marketId,
          orderHash: t.orderHash.toLowerCase(),
          tradeId: t.tradeId,
          txHash: t.tradeId,
          eventIndex: tradeEventIndex(t.tradeId),
          side: t.tradeDirection,
          price,
          quantity,
          // Quote is USDC/USDT, reported 1:1 as USD.
          feeUsd: toNumber(toFixed18(fee)),
          isMaker,
          counterpartySubaccountId: null,
          executedAt,
          provenance: liveProvenance(network),
        };
  return { trade, fill };
}

export function mapOrder(o: IndexerOrder, network: NetworkName, quoteDecimals: number, agentId: number): OrderRow {
  return {
    network,
    agentId,
    marketId: o.marketId.toLowerCase(),
    orderHash: o.orderHash.toLowerCase(),
    side: o.orderSide.startsWith("sell") ? "sell" : "buy",
    price: chainToHuman(o.price, quoteDecimals),
    quantity: fromFixed18(toFixed18(o.quantity)),
    level: levelFromCid(o.cid),
    postedAt: new Date(o.createdAt),
    // cancelled_at marks "left the book" for every terminal state (cancel, fill, expiry), which is
    // what the scorer's resting-depth and uptime metrics need.
    cancelledAt: isOpenOrder(o) ? null : new Date(o.updatedAt || Date.now()),
    provenance: liveProvenance(network),
  };
}

/** Indexer order states that rest on the book. Anything else (canceled, filled, expired, ...) is closed. */
const OPEN_STATES = new Set(["booked", "partial_filled", "unfilled"]);

export function isOpenOrder(o: IndexerOrder): boolean {
  return OPEN_STATES.has(o.state);
}

export function mapPosition(p: IndexerPosition, network: NetworkName, quoteDecimals: number, agentId: number, at: Date): PositionRow {
  return {
    network,
    agentId,
    marketId: p.marketId.toLowerCase(),
    at,
    direction: p.direction,
    quantity: fromFixed18(toFixed18(p.quantity)),
    entryPrice: chainToHuman(p.entryPrice, quoteDecimals),
    margin: chainToHuman(p.margin, quoteDecimals),
    markPrice: p.markPrice ? chainToHuman(p.markPrice, quoteDecimals) : null,
    provenance: liveProvenance(network),
  };
}

/** Aggregates open agent orders into per-side human price -> unfilled quantity maps. */
export function strataBookMaps(
  orders: Iterable<IndexerOrder>,
  marketId: string,
  quoteDecimals: number,
): { bids: Map<string, string>; asks: Map<string, string> } {
  const acc = { bids: new Map<string, bigint>(), asks: new Map<string, bigint>() };
  for (const o of orders) {
    if (o.marketId.toLowerCase() !== marketId.toLowerCase() || !isOpenOrder(o)) continue;
    const side = o.orderSide.startsWith("sell") ? acc.asks : acc.bids;
    const price = chainToHuman(o.price, quoteDecimals);
    side.set(price, (side.get(price) ?? 0n) + toFixed18(o.unfilledQuantity));
  }
  const conv = (m: Map<string, bigint>) => new Map([...m].map(([k, v]) => [k, fromFixed18(v)]));
  return { bids: conv(acc.bids), asks: conv(acc.asks) };
}
