/**
 * Simulated options book and collateral accounting (docs/OPTIONS.md, PRD 9.8). STRATA's model of
 * the published Injective Options design, not Injective's contract logic. Fully collateralized:
 * each written option locks size x maxPayoutPerUnit of USDC until it settles or closes, and a write
 * whose collateral exceeds free cash is rejected, so the writer can never owe more than it locked.
 */
import type { OptionKind } from "./pricing.js";

export const UNDERLYINGS = ["SICI", "US500", "USTECH", "XAU", "XAG", "WTI"] as const;
export type Underlying = (typeof UNDERLYINGS)[number];

export type PositionStatus = "open" | "settled" | "closed_early";

export interface WriteRequest {
  readonly id: string;
  readonly underlying: Underlying;
  readonly underlyingMarketId: string;
  readonly kind: OptionKind;
  readonly strike: number;
  readonly expiryMs: number;
  readonly size: number;
  /** USDC received by the writer at open. */
  readonly premium: number;
  readonly openedAt: number;
}

export interface SimPosition extends WriteRequest {
  readonly collateralUsd: number;
  readonly status: PositionStatus;
  /** Paid to the holder at settlement or early close. */
  readonly payoutUsd: number | null;
  readonly settlementPrice: number | null;
  readonly settledOnStaleOracle: boolean;
  readonly closedAt: number | null;
}

export interface BookConfig {
  /** Starting SIMULATED USDC. */
  readonly cashUsd: number;
  /** Call payoff cap as a multiple of strike (docs/OPTIONS.md default 1.0). */
  readonly callCapMultiple: number;
}

export type WriteResult =
  | { readonly ok: true; readonly position: SimPosition }
  | { readonly ok: false; readonly reason: "insufficient_collateral"; readonly requiredUsd: number; readonly freeUsd: number }
  | { readonly ok: false; readonly reason: "invalid"; readonly detail: string };

export interface CloseResult {
  readonly position: SimPosition;
  readonly payoutUsd: number;
  readonly writerPnlUsd: number;
  readonly settledOnStaleOracle: boolean;
}

export function maxPayoutPerUnit(kind: OptionKind, strike: number, callCapMultiple: number): number {
  return kind === "call" ? strike * callCapMultiple : strike;
}

export function payoffPerUnit(kind: OptionKind, strike: number, callCapMultiple: number, settlement: number): number {
  const raw = kind === "call" ? Math.max(settlement - strike, 0) : Math.max(strike - settlement, 0);
  return Math.min(raw, maxPayoutPerUnit(kind, strike, callCapMultiple));
}

export function collateralFor(kind: OptionKind, strike: number, size: number, callCapMultiple: number): number {
  return size * maxPayoutPerUnit(kind, strike, callCapMultiple);
}

const positive = (v: number): boolean => Number.isFinite(v) && v > 0;

export class OptionsBook {
  readonly #cfg: BookConfig;
  readonly #positions = new Map<string, SimPosition>();
  /** Total SIMULATED USDC owned (free + locked). */
  #cashUsd: number;

  constructor(cfg: BookConfig) {
    if (!(Number.isFinite(cfg.cashUsd) && cfg.cashUsd >= 0) || !positive(cfg.callCapMultiple)) throw new Error("invalid book config");
    this.#cfg = cfg;
    this.#cashUsd = cfg.cashUsd;
  }

  /** Rebuilds the book from persisted rows: cash = start + premiums - payouts. */
  static restore(cfg: BookConfig, rows: readonly SimPosition[]): OptionsBook {
    const book = new OptionsBook(cfg);
    for (const p of rows) {
      book.#positions.set(p.id, p);
      book.#cashUsd += p.premium - (p.payoutUsd ?? 0);
    }
    return book;
  }

  all(): SimPosition[] {
    return [...this.#positions.values()];
  }

  open(): SimPosition[] {
    return this.all().filter((p) => p.status === "open");
  }

  get(id: string): SimPosition | undefined {
    return this.#positions.get(id);
  }

  lockedCollateralUsd(): number {
    return this.open().reduce((s, p) => s + p.collateralUsd, 0);
  }

  freeCashUsd(): number {
    return this.#cashUsd - this.lockedCollateralUsd();
  }

  totalCashUsd(): number {
    return this.#cashUsd;
  }

  premiumCollectedUsd(): number {
    return this.all().reduce((s, p) => s + p.premium, 0);
  }

  realizedPnlUsd(): number {
    return this.all()
      .filter((p) => p.status !== "open")
      .reduce((s, p) => s + p.premium - (p.payoutUsd ?? 0), 0);
  }

  /** The most the book can be asked to pay: every open option at its cap. */
  worstCaseLiabilityUsd(): number {
    return this.open().reduce((s, p) => s + p.size * maxPayoutPerUnit(p.kind, p.strike, this.#cfg.callCapMultiple), 0);
  }

  write(req: WriteRequest): WriteResult {
    if (!positive(req.strike) || !positive(req.size) || !(Number.isFinite(req.premium) && req.premium >= 0)) {
      return { ok: false, reason: "invalid", detail: "strike and size must be positive and premium non-negative" };
    }
    if (this.#positions.has(req.id)) return { ok: false, reason: "invalid", detail: `duplicate id ${req.id}` };
    const requiredUsd = collateralFor(req.kind, req.strike, req.size, this.#cfg.callCapMultiple);
    const freeUsd = this.freeCashUsd();
    if (!(requiredUsd <= freeUsd)) return { ok: false, reason: "insufficient_collateral", requiredUsd, freeUsd };
    const position: SimPosition = { ...req, collateralUsd: requiredUsd, status: "open", payoutUsd: null, settlementPrice: null, settledOnStaleOracle: false, closedAt: null };
    this.#positions.set(req.id, position);
    this.#cashUsd += req.premium;
    return { ok: true, position };
  }

  /** European cash settlement on the oracle report at or after expiry (stale flag when older). */
  settle(id: string, oracle: { readonly price: number; readonly timestampMs: number }, nowMs: number): CloseResult {
    const p = this.#requireOpen(id);
    if (nowMs < p.expiryMs) throw new Error(`cannot settle ${id} before expiry`);
    if (!(Number.isFinite(oracle.price) && oracle.price >= 0)) throw new Error(`invalid settlement price for ${id}`);
    const payoutUsd = Math.min(p.size * payoffPerUnit(p.kind, p.strike, this.#cfg.callCapMultiple, oracle.price), p.collateralUsd);
    const stale = oracle.timestampMs < p.expiryMs;
    return this.#close(p, { status: "settled", payoutUsd, settlementPrice: oracle.price, settledOnStaleOracle: stale, closedAt: nowMs });
  }

  /** Buys the option back at `pricePerUnit`; the payout can never exceed the locked collateral. */
  closeEarly(id: string, pricePerUnit: number, nowMs: number): CloseResult {
    const p = this.#requireOpen(id);
    if (!(Number.isFinite(pricePerUnit) && pricePerUnit >= 0)) throw new Error(`invalid buyback price for ${id}`);
    const payoutUsd = Math.min(p.size * pricePerUnit, p.collateralUsd);
    return this.#close(p, { status: "closed_early", payoutUsd, settlementPrice: null, settledOnStaleOracle: false, closedAt: nowMs });
  }

  #requireOpen(id: string): SimPosition {
    const p = this.#positions.get(id);
    if (p === undefined || p.status !== "open") throw new Error(`no open position ${id}`);
    return p;
  }

  #close(p: SimPosition, patch: Pick<SimPosition, "status" | "payoutUsd" | "settlementPrice" | "settledOnStaleOracle" | "closedAt">): CloseResult {
    const next: SimPosition = { ...p, ...patch };
    this.#positions.set(p.id, next);
    const payoutUsd = patch.payoutUsd ?? 0;
    this.#cashUsd -= payoutUsd;
    return { position: next, payoutUsd, writerPnlUsd: p.premium - payoutUsd, settledOnStaleOracle: patch.settledOnStaleOracle };
  }
}
