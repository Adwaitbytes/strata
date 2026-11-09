/**
 * Options-writer cycle (PRD 9.8). Reads underlying oracle prices, settles expired options, marks the
 * book to market, runs the Risk Governor, honors the kill switch, then writes new covered calls and
 * cash-secured puts against simulated buyers. No chain orders are ever sent: the whole book is
 * SIMULATED (decision D9) and every record carries that label. Prices are real oracle reads.
 */
import { evaluateRisk, evaluateSession, recordOrders, type GuardDecision, type RiskParams, type RiskState, type SessionClass } from "@strata/risk";
import type { GuardEvent, NetworkName } from "@strata/sdk";
import type { KillSwitch } from "../core/killSwitch.js";
import type { OptionsBook, SimPosition, Underlying } from "./book.js";
import { black76, type OptionKind } from "./pricing.js";
import { EwmaVol, YEAR_MS, buildQuote, buyerAccepts, nextExpiry, type StrategyParams } from "./strategy.js";

export interface UnderlyingSpec {
  readonly underlying: Underlying;
  /** Mainnet perp whose oracle prices and settles the simulated option (docs/INJECTIVE.md section 2). */
  readonly marketId: string;
  readonly sessionClass: SessionClass;
}

export interface PriceReading {
  readonly price: number;
  readonly timestampMs: number;
  readonly source: string;
}

export interface PriceSource {
  read(spec: UnderlyingSpec): Promise<PriceReading>;
}

export type QuoteOutcome = "written" | "not_taken" | "rejected_collateral" | "rejected_limit";

export interface QuoteRecord {
  readonly network: NetworkName;
  readonly provenance: "SIMULATED";
  readonly agentId: number;
  readonly quoteId: string;
  readonly underlying: Underlying;
  readonly underlyingMarketId: string;
  readonly kind: OptionKind;
  readonly strike: number;
  readonly expiryMs: number;
  readonly spot: number;
  readonly spotSource: string;
  readonly spotTs: number;
  readonly size: number;
  readonly delta: number;
  readonly realizedVol: number;
  readonly sigmaFair: number;
  readonly impliedVol: number;
  /** USD for the whole quote size. */
  readonly fairValue: number;
  readonly premium: number;
  readonly collateral: number;
  readonly outcome: QuoteOutcome;
  readonly at: number;
}

export interface BookSnapshot {
  readonly network: NetworkName;
  readonly provenance: "SIMULATED";
  readonly agentId: number;
  readonly at: number;
  readonly cash: number;
  readonly lockedCollateral: number;
  readonly freeCash: number;
  readonly premiumCollected: number;
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly equity: number;
  readonly openPositions: number;
}

export interface OptionsStore {
  loadPositions(network: NetworkName, agentId: number): Promise<SimPosition[]>;
  writeQuote(q: QuoteRecord): Promise<void>;
  writePosition(network: NetworkName, agentId: number, p: SimPosition): Promise<void>;
  writeBook(s: BookSnapshot): Promise<void>;
}

export class MemoryOptionsStore implements OptionsStore {
  readonly quotes: QuoteRecord[] = [];
  readonly books: BookSnapshot[] = [];
  readonly #positions = new Map<string, SimPosition>();
  get positions(): SimPosition[] {
    return [...this.#positions.values()];
  }
  async loadPositions(): Promise<SimPosition[]> {
    return this.positions;
  }
  async writeQuote(q: QuoteRecord): Promise<void> {
    this.quotes.push(q);
  }
  async writePosition(_n: NetworkName, _a: number, p: SimPosition): Promise<void> {
    this.#positions.set(p.id, p);
  }
  async writeBook(s: BookSnapshot): Promise<void> {
    this.books.push(s);
  }
}

export interface OptionsRunnerParams {
  readonly strategy: StrategyParams;
  readonly maxOracleAgeSec: number;
  readonly minTenorMs: number;
  /** Open options per (underlying, kind). */
  readonly maxOpenPerSeries: number;
  readonly maxCollateralPerUnderlyingUsd: number;
  /** Buyback premium over fair value for an early close. */
  readonly closeSpread: number;
  readonly ewmaHalfLifeSec: number;
  readonly minReturns: number;
}

export interface OptionsRunnerDeps {
  readonly identity: { readonly agentId: number; readonly agentName: string; readonly network: NetworkName; readonly provenance: "SIMULATED" };
  readonly specs: readonly UnderlyingSpec[];
  readonly prices: PriceSource;
  readonly store: OptionsStore;
  readonly sink: { guard(e: GuardEvent): void };
  readonly killSwitch: KillSwitch;
  readonly book: OptionsBook;
  readonly params: OptionsRunnerParams;
  readonly riskParams: RiskParams;
  readonly initialRisk: RiskState | null;
  readonly now: () => number;
  readonly ids: () => string;
  readonly onRiskChange?: (s: RiskState) => void;
}

export interface CycleReport {
  readonly written: number;
  readonly settled: number;
  readonly closed: number;
  readonly equity: number;
  readonly pricesRead: number;
}

/**
 * With no option liability the coverage ratio is unbounded; this finite stand-in keeps the Risk
 * Governor's fail-closed NaN check satisfied without implying a measured value.
 */
const NO_LIABILITY_COVERAGE = 1e6;

export class OptionsRunner {
  readonly #d: OptionsRunnerDeps;
  readonly #vols = new Map<Underlying, EwmaVol>();
  readonly #lastReading = new Map<Underlying, PriceReading>();
  readonly #activeGuards = new Set<string>();
  #risk: RiskState;

  constructor(deps: OptionsRunnerDeps) {
    this.#d = deps;
    this.#risk = deps.initialRisk ?? { dayKey: null, dayStartEquityUsd: null, peakEquityUsd: null, stoppedForDay: false, stoppedForSeason: false, orderTimesMs: [] };
    for (const s of deps.specs) this.#vols.set(s.underlying, new EwmaVol({ halfLifeSec: deps.params.ewmaHalfLifeSec, minReturns: deps.params.minReturns }));
  }

  get riskState(): RiskState {
    return this.#risk;
  }

  realizedVol(u: Underlying): number | null {
    return this.#vols.get(u)?.sigma() ?? null;
  }

  async cycle(opts: { quote: boolean }): Promise<CycleReport> {
    const d = this.#d;
    const now = d.now();
    const raised = new Set<string>();
    const readings = new Map<Underlying, PriceReading>();
    for (const spec of d.specs) {
      try {
        const r = await d.prices.read(spec);
        if (!(Number.isFinite(r.price) && r.price > 0)) throw new Error("invalid price");
        readings.set(spec.underlying, r);
        this.#lastReading.set(spec.underlying, r);
        this.#vols.get(spec.underlying)?.update(r.price, r.timestampMs);
      } catch {
        this.#guard(raised, `data:${spec.underlying}`, spec, {
          guard: "oracle",
          action: "halt",
          reason: "data_unavailable",
          detail: `Oracle price for ${spec.underlying} could not be read; no new options are written on it.`,
          observed: { underlying: spec.underlying },
        });
      }
    }

    // 1. European settlement at or after expiry.
    let settled = 0;
    for (const p of d.book.open()) {
      if (now < p.expiryMs) continue;
      const r = readings.get(p.underlying);
      if (r === undefined) continue;
      const res = d.book.settle(p.id, r, now);
      await d.store.writePosition(d.identity.network, d.identity.agentId, res.position);
      settled++;
    }

    // 2. Mark to market and run the Risk Governor on delta-equivalent exposure.
    const mtm = this.#markToMarket(now);
    const open = d.book.open();
    const exposures = d.specs
      .map((s) => ({ spec: s, spot: this.#lastReading.get(s.underlying)?.price ?? Number.NaN, qty: mtm.deltaByUnderlying.get(s.underlying) ?? 0 }))
      .filter((e) => open.some((p) => p.underlying === e.spec.underlying))
      .map((e) => ({ marketId: e.spec.marketId, quantityBase: e.qty, markPrice: e.spot }));
    const coverage = open.length === 0 ? null : mtm.liability > 0 ? d.book.totalCashUsd() / mtm.liability : NO_LIABILITY_COVERAGE;
    const { result, state } = evaluateRisk({ nowMs: now, equityUsd: mtm.equity, positions: exposures, marginRatio: coverage }, this.#risk, d.riskParams);
    this.#setRisk(state);
    for (const sd of result.decisions) {
      const spec = d.specs.find((s) => s.marketId === sd.marketId) ?? null;
      this.#guard(raised, `risk:${sd.decision.reason}:${sd.marketId ?? "all"}`, spec, sd.decision);
    }

    // 3. Kill switch, then risk-driven closes.
    let closed = 0;
    const kill = d.killSwitch.decision();
    if (kill !== null) this.#guard(raised, "kill", null, kill);
    if ((kill !== null && d.killSwitch.state.closePositions) || result.closePositions) closed += await this.#closeWhere(() => true, now);
    for (const s of d.specs) {
      if (result.markets[s.marketId] === "flatten") closed += await this.#closeWhere((p) => p.underlying === s.underlying, now);
    }

    // 4. New writes.
    let written = 0;
    if (opts.quote && kill === null && !result.haltAll) {
      let budget = result.orderBudget;
      for (const spec of d.specs) {
        if ((result.markets[spec.marketId] ?? "normal") !== "normal") continue;
        const r = readings.get(spec.underlying);
        if (r === undefined || !this.#canWrite(spec, r, now, raised)) continue;
        const expiryMs = nextExpiry(spec.sessionClass, now, d.params.minTenorMs);
        if (expiryMs === null) continue;
        for (const kind of ["call", "put"] as const) {
          if (budget <= 0) break;
          const series = d.book.open().filter((p) => p.underlying === spec.underlying && p.kind === kind);
          if (series.length >= d.params.maxOpenPerSeries) continue;
          const outcome = await this.#quoteAndWrite(spec, kind, r, expiryMs, now, raised);
          if (outcome === "written") {
            written++;
            budget--;
            this.#setRisk(recordOrders(this.#risk, 1, now));
          }
        }
      }
    }

    // Conditions that cleared this cycle can be reported again when they return.
    for (const k of [...this.#activeGuards]) if (!raised.has(k)) this.#activeGuards.delete(k);

    const after = this.#markToMarket(now);
    await d.store.writeBook({
      network: d.identity.network,
      provenance: "SIMULATED",
      agentId: d.identity.agentId,
      at: now,
      cash: d.book.totalCashUsd(),
      lockedCollateral: d.book.lockedCollateralUsd(),
      freeCash: d.book.freeCashUsd(),
      premiumCollected: d.book.premiumCollectedUsd(),
      realizedPnl: d.book.realizedPnlUsd(),
      unrealizedPnl: d.book.open().reduce((s, p) => s + p.premium, 0) - after.liability,
      equity: after.equity,
      openPositions: d.book.open().length,
    });
    return { written, settled, closed, equity: after.equity, pricesRead: readings.size };
  }

  #canWrite(spec: UnderlyingSpec, r: PriceReading, now: number, raised: Set<string>): boolean {
    const session = evaluateSession(spec.sessionClass, now, this.#d.riskParams);
    const restrictive = session.decision !== null && session.decision.action !== "ok" && session.decision.action !== "resume";
    if (!session.quote || session.flatten || restrictive) {
      if (session.decision !== null) this.#guard(raised, `session:${spec.underlying}`, spec, session.decision);
      return false;
    }
    const ageSec = (now - r.timestampMs) / 1000;
    if (ageSec > this.#d.params.maxOracleAgeSec) {
      this.#guard(raised, `stale:${spec.underlying}`, spec, {
        guard: "oracle",
        action: "halt",
        reason: "oracle_stale",
        detail: `Oracle for ${spec.underlying} is ${Math.round(ageSec)} s old, above the ${this.#d.params.maxOracleAgeSec} s limit; no new options are written.`,
        observed: { underlying: spec.underlying, oracleAgeSec: Math.round(ageSec), limitSec: this.#d.params.maxOracleAgeSec },
      });
      return false;
    }
    return true;
  }

  async #quoteAndWrite(spec: UnderlyingSpec, kind: OptionKind, r: PriceReading, expiryMs: number, now: number, raised: Set<string>): Promise<QuoteOutcome | null> {
    const d = this.#d;
    const p = d.params.strategy;
    const q = buildQuote({ kind, spot: r.price, realizedVol: this.realizedVol(spec.underlying), nowMs: now, expiryMs }, p);
    if (q.kind === "skip") return null;
    const quoteId = d.ids();
    const fairValue = q.size * q.fairValuePerUnit;
    const locked = d.book.open().filter((x) => x.underlying === spec.underlying).reduce((s, x) => s + x.collateralUsd, 0);
    let outcome: QuoteOutcome;
    if (locked + q.collateralUsd > d.params.maxCollateralPerUnderlyingUsd) {
      outcome = "rejected_limit";
    } else if (!buyerAccepts(quoteId, q.premiumUsd, fairValue, p)) {
      outcome = "not_taken";
    } else {
      const res = d.book.write({ id: quoteId, underlying: spec.underlying, underlyingMarketId: spec.marketId, kind, strike: q.strike, expiryMs, size: q.size, premium: q.premiumUsd, openedAt: now });
      if (res.ok) {
        outcome = "written";
        await d.store.writePosition(d.identity.network, d.identity.agentId, res.position);
      } else {
        outcome = "rejected_collateral";
        const observed: GuardDecision["observed"] =
          res.reason === "insufficient_collateral"
            ? { check: "full_collateral", underlying: spec.underlying, requiredUsd: round2(res.requiredUsd), freeUsd: round2(res.freeUsd) }
            : { check: "full_collateral", underlying: spec.underlying, invalid: res.detail };
        this.#guard(raised, `collateral:${spec.underlying}`, spec, {
          guard: "risk",
          action: "reduce",
          reason: "risk_gross_notional",
          detail: `A ${spec.underlying} ${kind} needs more collateral than the free USDC; the write was refused (never naked).`,
          observed,
        });
      }
    }
    await d.store.writeQuote({
      network: d.identity.network,
      provenance: "SIMULATED",
      agentId: d.identity.agentId,
      quoteId,
      underlying: spec.underlying,
      underlyingMarketId: spec.marketId,
      kind,
      strike: q.strike,
      expiryMs,
      spot: r.price,
      spotSource: r.source,
      spotTs: r.timestampMs,
      size: q.size,
      delta: q.delta,
      realizedVol: q.realizedVol,
      sigmaFair: q.sigmaFair,
      impliedVol: q.impliedVol,
      fairValue,
      premium: q.premiumUsd,
      collateral: q.collateralUsd,
      outcome,
      at: now,
    });
    return outcome;
  }

  /** Fair value per unit at the current spot and vol; null when the underlying has no price yet. */
  #fairPerUnit(p: SimPosition, now: number): { value: number; delta: number } | null {
    const r = this.#lastReading.get(p.underlying);
    if (r === undefined) return null;
    const sigma = Math.max(this.realizedVol(p.underlying) ?? this.#d.params.strategy.volFloor, this.#d.params.strategy.volFloor);
    const g = black76({ kind: p.kind, forward: r.price, strike: p.strike, years: Math.max(p.expiryMs - now, 0) / YEAR_MS, sigma });
    return { value: g.price, delta: g.delta };
  }

  #markToMarket(now: number): { liability: number; equity: number; deltaByUnderlying: Map<Underlying, number> } {
    const book = this.#d.book;
    let liability = 0;
    const deltaByUnderlying = new Map<Underlying, number>();
    for (const p of book.open()) {
      const f = this.#fairPerUnit(p, now);
      // Unknown price: assume the worst case, the full collateral.
      liability += f === null ? p.collateralUsd : Math.min(p.size * f.value, p.collateralUsd);
      // The writer is short the option, so its exposure is minus the option delta.
      deltaByUnderlying.set(p.underlying, (deltaByUnderlying.get(p.underlying) ?? 0) - p.size * (f?.delta ?? Number.NaN));
    }
    return { liability, equity: book.totalCashUsd() - liability, deltaByUnderlying };
  }

  async #closeWhere(pred: (p: SimPosition) => boolean, now: number): Promise<number> {
    let n = 0;
    for (const p of this.#d.book.open().filter(pred)) {
      const f = this.#fairPerUnit(p, now);
      // Without a price the buyback is at the cap, which the collateral already covers.
      const perUnit = f === null ? p.collateralUsd / p.size : f.value * (1 + this.#d.params.closeSpread);
      const res = this.#d.book.closeEarly(p.id, perUnit, now);
      await this.#d.store.writePosition(this.#d.identity.network, this.#d.identity.agentId, res.position);
      n++;
    }
    return n;
  }

  #setRisk(s: RiskState): void {
    const changed = s.stoppedForDay !== this.#risk.stoppedForDay || s.stoppedForSeason !== this.#risk.stoppedForSeason || s.dayKey !== this.#risk.dayKey || s.peakEquityUsd !== this.#risk.peakEquityUsd;
    this.#risk = s;
    if (changed) this.#d.onRiskChange?.(s);
  }

  /** Emits a guard event when a condition first appears; repeats are suppressed until it clears. */
  #guard(raised: Set<string>, key: string, spec: UnderlyingSpec | null, decision: GuardDecision): void {
    raised.add(key);
    if (this.#activeGuards.has(key)) return;
    this.#activeGuards.add(key);
    const d = this.#d;
    // marketId stays null: the underlying perp is a mainnet market and this agent reports on testnet.
    const observed = spec === null ? { ...decision.observed } : { ...decision.observed, underlying: spec.underlying, underlyingMarketId: spec.marketId };
    d.sink.guard({
      network: d.identity.network,
      provenance: "SIMULATED",
      id: d.ids(),
      agentId: d.identity.agentId,
      marketId: null,
      guard: decision.guard,
      action: decision.action,
      reason: decision.reason,
      detail: decision.detail,
      observed,
      at: d.now(),
    });
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
