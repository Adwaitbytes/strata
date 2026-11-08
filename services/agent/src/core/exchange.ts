/**
 * Boundary between the deterministic agent core (W2, services/agent/src/core) and the
 * Injective integration (W3, services/agent/src/injective). The core never imports Injective
 * SDKs directly; W3 implements this interface; tests use an in-memory simulator.
 *
 * All prices/quantities are human-unit decimal strings (see @strata/sdk conventions).
 * Every method may throw; the core treats any error or timeout as "state unknown" and
 * moves to cancel-on-uncertainty (PRD 26, RPC instability).
 */
import type { Side } from "@strata/sdk";

export interface L2Level {
  price: string;
  quantity: string;
}

export interface OraclePoint {
  price: string;
  /** Oracle report timestamp in ms. Compared against chainTimeMs by Oracle Guard. */
  timestampMs: number;
  source: string;
}

export interface PositionState {
  /** Signed base quantity, positive = long. */
  quantity: string;
  entryPrice: string | null;
  margin: string;
  unrealizedPnl: string;
}

export interface MarketState {
  marketId: string;
  bids: L2Level[];
  asks: L2Level[];
  oracle: OraclePoint;
  /** Optional independent reference (e.g. Pyth Hermes) for the two-source check. */
  reference: OraclePoint | null;
  markPrice: string | null;
  /** Latest block time in ms, from the chain, not the local clock. */
  chainTimeMs: number;
  position: PositionState;
  /** Subaccount available quote balance (USD). */
  availableQuote: string;
  /** Hourly funding rate as a decimal string, null if unknown. */
  fundingRate: string | null;
  /** Account margin ratio (equity / maintenance requirement), null if no position. */
  marginRatio: number | null;
}

export interface LiveOrder {
  orderHash: string;
  side: Side;
  price: string;
  quantity: string;
  filled: string;
  createdAtMs: number;
}

export interface NewOrder {
  side: Side;
  price: string;
  quantity: string;
  /** Post-only (maker) where the exchange supports it. */
  postOnly: boolean;
  reduceOnly: boolean;
  /** Client-side id for idempotency and logging. */
  cid: string;
}

export interface BatchUpdate {
  marketId: string;
  cancelOrderHashes: string[];
  create: NewOrder[];
  /** Fee recipient set to the agent's own address (PRD 9.2 step 5). */
  feeRecipient: string;
}

export interface BatchResult {
  txHash: string;
  createdOrderHashes: string[];
  /** Orders the chain rejected, with reasons. */
  rejected: { cid: string; reason: string }[];
}

export interface FillEvent {
  marketId: string;
  orderHash: string;
  tradeId: string;
  txHash: string;
  eventIndex: number;
  side: Side;
  price: string;
  quantity: string;
  fee: string;
  isMaker: boolean;
  counterpartySubaccountId: string | null;
  executedAtMs: number;
}

export interface ExchangeAdapter {
  readonly network: "mainnet" | "testnet";
  readonly subaccountId: string;
  readonly address: string;
  getMarketState(marketId: string): Promise<MarketState>;
  getOpenOrders(marketId: string): Promise<LiveOrder[]>;
  /** One tx: cancels + creates (MsgBatchUpdateOrders or exchange precompile equivalent). */
  batchUpdate(update: BatchUpdate): Promise<BatchResult>;
  /** Cancel every open order on the market. Must be safe to call repeatedly. */
  cancelAll(marketId: string): Promise<void>;
  /** Close the position with reduce-only IOC order(s). */
  closePositionReduceOnly(marketId: string): Promise<void>;
  /** Push fills to the core. Returns an unsubscribe function. */
  onFill(handler: (fill: FillEvent) => void): () => void;
}
