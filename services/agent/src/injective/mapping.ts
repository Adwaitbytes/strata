/**
 * Pure mappings from Injective records to the core ExchangeAdapter types, kept out of adapter.ts
 * so they are unit-tested without network access.
 */
import type { Market, Side } from "@strata/sdk";
import type { FillEvent, PositionState } from "../core/exchange.js";
import { dec, plain, scaleDown } from "./units.js";

export interface ChainPosition {
  isLong: boolean;
  quantity: string;
  entryPrice: string;
  margin: string;
}

export interface PositionView {
  position: PositionState;
  /** Equity / maintenance requirement; never null while a position is open (review L-2). */
  marginRatio: number | null;
}

const FLAT: PositionState = { quantity: "0", entryPrice: null, margin: "0", unrealizedPnl: "0" };

/**
 * Builds the core position view. While a position is open the margin ratio is always a number:
 * mark price is preferred, entry price is the fallback when the mark is missing or zero, so the
 * risk governor never halts on an unknown ratio for a valid position.
 */
export function positionView(pos: ChainPosition | null, markPrice: string | null, maintenanceMarginRatio: string): PositionView {
  if (pos === null || !dec(pos.quantity).gt(0)) return { position: FLAT, marginRatio: null };
  const signed = pos.isLong ? dec(pos.quantity) : dec(pos.quantity).neg();
  const mark = markPrice !== null && dec(markPrice).gt(0) ? dec(markPrice) : dec(pos.entryPrice);
  const upnl = mark.minus(pos.entryPrice).mul(signed);
  const position: PositionState = { quantity: plain(signed), entryPrice: pos.entryPrice, margin: pos.margin, unrealizedPnl: plain(upnl) };
  const maintenance = dec(pos.quantity).mul(mark).mul(maintenanceMarginRatio);
  const equity = dec(pos.margin).plus(upnl);
  // A zero maintenance requirement (zero price or zero ratio) means nothing can be liquidated.
  const marginRatio = maintenance.gt(0) ? equity.div(maintenance).toNumber() : equity.gt(0) ? Number.MAX_SAFE_INTEGER : 0;
  return { position, marginRatio };
}

export interface IndexerTrade {
  tradeId: string;
  marketId: string;
  orderHash: string;
  tradeDirection: string;
  executionPrice: string;
  executionQuantity: string;
  fee: string;
  executionSide: string;
  executedAt: number;
  subaccountId: string;
}

/**
 * Indexer trade to FillEvent. The trade ID is "<blockHeight>_<eventIndex>" (observed on mainnet
 * 2026-11-09). The Indexer record carries no tx hash, so the trade ID doubles as `txHash`, the same
 * convention services/indexer uses for agent_fills; both writers then dedupe on one primary key.
 * Indexer v1 prices and fees are x10^quoteDecimals, quantities human (units.ts).
 */
export function fillFromTrade(t: IndexerTrade, spec: Pick<Market, "quoteDecimals">): FillEvent {
  const eventIndex = Number(/_(\d+)$/.exec(t.tradeId)?.[1] ?? "0");
  const side: Side = t.tradeDirection === "buy" || t.tradeDirection === "long" ? "buy" : "sell";
  return {
    marketId: t.marketId,
    orderHash: t.orderHash,
    tradeId: t.tradeId,
    txHash: t.tradeId,
    eventIndex: Number.isFinite(eventIndex) ? eventIndex : 0,
    side,
    price: scaleDown(t.executionPrice, spec.quoteDecimals),
    quantity: plain(dec(t.executionQuantity)),
    fee: scaleDown(t.fee, spec.quoteDecimals),
    isMaker: t.executionSide === "maker",
    counterpartySubaccountId: null,
    executedAtMs: t.executedAt,
  };
}
