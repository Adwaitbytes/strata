/**
 * Plain in-memory records the scoring core works on. The store (store.ts) maps database rows
 * into these shapes; everything downstream of the store is pure and deterministic, which is what
 * makes golden-file tests and public re-verification possible.
 *
 * Units: prices and quantities are human units (already divided by decimals) as JS numbers,
 * timestamps are integer milliseconds UTC, USD values assume a USD-pegged quote asset (USDC).
 */
import type { AgentStatus, Side } from "@strata/sdk";

export interface EpochWindow {
  season: number;
  epoch: number;
  /** Inclusive. */
  startMs: number;
  /** Exclusive. */
  endMs: number;
}

export interface MarketParams {
  marketId: string;
  /** Two-sided quotes wider than this do not count toward uptime (StrataArena MarketCfg). */
  maxSpreadBps: number;
}

export interface AgentRecord {
  agentId: number;
  /** EVM operator address from StrataArena. */
  operator: string;
  /** Injective subaccount: 0x + 20-byte trader address + 12-byte nonce. */
  subaccountId: string;
  status: AgentStatus;
  marketIds: readonly string[];
  simulated: boolean;
  enrolledAt: number;
}

/** One public book sample (book_snapshots row). */
export interface BookSample {
  at: number;
  mid: number | null;
  spreadBps: number | null;
  /** Total book depth within 25 bps of mid, both sides, USD. */
  depthUsd25: number;
}

export interface OrderRecord {
  agentId: number;
  marketId: string;
  orderHash: string;
  side: Side;
  price: number;
  quantity: number;
  postedAt: number;
  /** When the order left the book for any reason (cancel, full fill, expiry). Null while resting. */
  cancelledAt: number | null;
}

export interface FillRecord {
  /** `${txHash}:${eventIndex}`, unique per fill. */
  id: string;
  agentId: number;
  marketId: string;
  orderHash: string;
  side: Side;
  price: number;
  quantity: number;
  /** Positive is a cost, negative is a rebate. */
  feeUsd: number;
  isMaker: boolean;
  counterpartySubaccountId: string | null;
  executedAt: number;
}

/** Funding payment for a position. Positive means the agent received USD. */
export interface FundingRecord {
  agentId: number;
  marketId: string;
  amountUsd: number;
  at: number;
}

export interface MarkPoint {
  at: number;
  mid: number;
}

/** A bank transfer between two addresses (EVM hex, lowercase), used for funding-source linking. */
export interface FundingEdge {
  from: string;
  to: string;
  at: number;
}
