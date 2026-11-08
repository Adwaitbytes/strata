/**
 * Per-market quoting cycle (PRD 9.2) over an injected ExchangeAdapter:
 *   state -> guards (kill, oracle, session, risk) -> quotes -> diff desired vs live -> one batchUpdate.
 *
 * Safety rules:
 * - Cancel-on-uncertainty: any adapter error (or timeout) means the order state is unknown. The
 *   quoter cancels all, creates nothing for `settleMs`, then reconciles from getOpenOrders and only
 *   resumes once the market shows no open orders. A batch that was broadcast but whose response
 *   was lost can still land during the settle window; it is cancelled at reconciliation instead of
 *   being duplicated.
 * - Live orders are re-read from the exchange every cycle; local state never decides what is live.
 * - One cycle at a time per market; at most one batchUpdate per cycle.
 * - A fresh process starts uncertain, so orders left by a previous process are reconciled first.
 */
import { Decimal } from "decimal.js";
import type { Fill, NetworkName, Provenance, SessionState } from "@strata/sdk";
import {
  INITIAL_ORACLE_STATE,
  assessBook,
  INITIAL_RISK_STATE,
  computeFairValue,
  computeQuotes,
  estimateKappa,
  evaluateOracle,
  evaluateRisk,
  evaluateSession,
  externalBook,
  recordOrders,
  sigmaBps,
  toGuardEvent,
  updateKappa,
  updateVolatility,
  type GuardDecision,
  type KappaState,
  type MarketRiskMode,
  type MarketSpec,
  type OracleGuardState,
  type PositionExposure,
  type QuoteLevel,
  type QuoteMode,
  type RiskParams,
  type RiskResult,
  type RiskState,
  type SessionClass,
  type VolState,
} from "@strata/risk";
import type { BatchResult, ExchangeAdapter, FillEvent, LiveOrder, MarketState, NewOrder } from "./exchange.js";
import type { KillSwitch } from "./killSwitch.js";
import type { EventSink } from "./recorder.js";
import { MarkoutTracker } from "./tuner.js";

export interface MarketRuntime {
  readonly marketId: string;
  readonly ticker: string;
  readonly sessionClass: SessionClass;
  readonly spec: MarketSpec;
}

export interface AgentIdentity {
  readonly agentId: number;
  readonly agentName: string;
  readonly network: NetworkName;
  readonly provenance: Provenance;
}

export interface LoopMetrics {
  observeCycle(marketId: string, seconds: number, outcome: CycleOutcome): void;
  txResult(marketId: string, ok: boolean): void;
  halt(marketId: string, reason: string): void;
  inventory(marketId: string, base: number, usd: number): void;
  equity(usd: number, pnlUsd: number): void;
  marginRatio(ratio: number | null): void;
}

export const NOOP_METRICS: LoopMetrics = {
  observeCycle: () => undefined,
  txResult: () => undefined,
  halt: () => undefined,
  inventory: () => undefined,
  equity: () => undefined,
  marginRatio: () => undefined,
};

export type CycleOutcome = "quoted" | "unchanged" | "halted" | "uncertain" | "killed" | "skipped";

export interface CycleReport {
  readonly outcome: CycleOutcome;
  readonly created: number;
  readonly cancelled: number;
  readonly nextDelayMs: number;
  readonly mode?: QuoteMode;
}

/** Compact per-market statistics for the AI Risk Tuner snapshot. */
export interface QuoterStats {
  readonly sigmaBps: number;
  readonly fair: number | null;
  readonly inventoryBase: number;
  readonly sessionState: SessionState | null;
  readonly fundingRateHourly: number | null;
  readonly fills: { readonly buy: number; readonly sell: number };
  readonly markoutsBps: { readonly s1: number | null; readonly s10: number | null; readonly s60: number | null } | null;
  readonly recentGuardReasons: readonly string[];
}

/* ------------------------------ agent-wide risk ------------------------------ */

interface MarketExposure {
  readonly position: PositionExposure;
  readonly marginUsd: number;
  readonly upnlUsd: number;
}

/** Aggregates every market of one agent for the Risk Governor and emits agent-wide guard events once. */
export class AgentRisk {
  #state: RiskState;
  #availableQuote = 0;
  readonly #listeners = new Set<(s: RiskState) => void>();
  #marginRatio: number | null = null;
  #startEquity: number | null = null;
  readonly #exposures = new Map<string, MarketExposure>();
  readonly #active = new Set<string>();
  #last: RiskResult | null = null;

  constructor(
    private readonly identity: AgentIdentity,
    private readonly sink: EventSink,
    private readonly ids: () => string,
    private readonly now: () => number,
    private readonly metrics: LoopMetrics = NOOP_METRICS,
    /** Persisted state from a previous run (review H-2); stops and peak equity carry over. */
    initial: RiskState | null = null,
  ) {
    this.#state = initial ?? INITIAL_RISK_STATE;
  }

  /** Called whenever a persisted field (day, peaks, stops) changes. */
  onChange(listener: (s: RiskState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get state(): RiskState {
    return this.#state;
  }

  update(marketId: string, s: MarketState): void {
    const qty = Number(s.position.quantity);
    const mark = Number(s.markPrice ?? s.oracle.price);
    this.#exposures.set(marketId, {
      position: { marketId, quantityBase: qty, markPrice: mark },
      marginUsd: Number(s.position.margin),
      upnlUsd: Number(s.position.unrealizedPnl),
    });
    this.#availableQuote = Number(s.availableQuote);
    this.#marginRatio = s.marginRatio;
    this.metrics.inventory(marketId, qty, qty * mark);
    this.metrics.marginRatio(s.marginRatio);
  }

  evaluate(chainTimeMs: number, params: RiskParams): RiskResult {
    let equity = this.#availableQuote;
    for (const e of this.#exposures.values()) equity += e.marginUsd + e.upnlUsd;
    this.#startEquity ??= equity;
    this.metrics.equity(equity, equity - this.#startEquity);
    const { result, state } = evaluateRisk(
      { nowMs: chainTimeMs, equityUsd: equity, positions: [...this.#exposures.values()].map((e) => e.position), marginRatio: this.#marginRatio },
      this.#state,
      params,
    );
    const prev = this.#state;
    this.#state = state;
    if (
      prev.dayKey !== state.dayKey ||
      prev.dayStartEquityUsd !== state.dayStartEquityUsd ||
      prev.peakEquityUsd !== state.peakEquityUsd ||
      prev.stoppedForDay !== state.stoppedForDay ||
      prev.stoppedForSeason !== state.stoppedForSeason
    ) {
      for (const l of this.#listeners) l(state);
    }
    const now = new Set<string>();
    for (const d of result.decisions) {
      if (d.marketId !== null) continue;
      const key = `${d.decision.reason}:${d.decision.action}`;
      now.add(key);
      if (!this.#active.has(key)) this.#emit(d.decision);
    }
    this.#active.clear();
    for (const k of now) this.#active.add(k);
    this.#last = result;
    return result;
  }

  get last(): RiskResult | null {
    return this.#last;
  }

  recordOrders(count: number, atMs: number): void {
    this.#state = recordOrders(this.#state, count, atMs);
  }

  #emit(decision: GuardDecision): void {
    const { network, provenance, agentId } = this.identity;
    this.sink.guard(toGuardEvent(decision, { network, provenance, agentId, marketId: null, id: this.ids(), at: this.now() }));
  }
}

/* ------------------------------ diff ------------------------------ */

export interface OrderDiff {
  readonly keep: readonly LiveOrder[];
  readonly cancel: readonly string[];
  readonly create: readonly QuoteLevel[];
}

/** Keep a live order when side and price match and its remaining size is 50% to 105% of the desired size. */
export function diffOrders(desired: readonly QuoteLevel[], live: readonly LiveOrder[], createBudget: number): OrderDiff {
  const unmatched = [...live];
  const keep: LiveOrder[] = [];
  const create: QuoteLevel[] = [];
  for (const q of desired) {
    const want = new Decimal(q.quantity);
    const idx = unmatched.findIndex((o) => {
      if (o.side !== q.side || !new Decimal(o.price).eq(q.price)) return false;
      const remaining = new Decimal(o.quantity).minus(o.filled);
      return remaining.gte(want.times(0.5)) && remaining.lte(want.times(1.05));
    });
    if (idx >= 0) keep.push(...unmatched.splice(idx, 1));
    else create.push(q);
  }
  const budgeted = [...create].sort((a, b) => a.level - b.level).slice(0, Math.max(0, createBudget));
  return { keep, cancel: unmatched.map((o) => o.orderHash), create: budgeted };
}

/* ------------------------------ quoter ------------------------------ */

export interface QuoterDeps {
  readonly adapter: ExchangeAdapter;
  readonly market: MarketRuntime;
  readonly identity: AgentIdentity;
  readonly getParams: () => RiskParams;
  readonly risk: AgentRisk;
  readonly sink: EventSink;
  readonly killSwitch: KillSwitch;
  /** Monotonic local ms, used for timeouts, settle windows and recorded timestamps. */
  readonly now: () => number;
  /** Host wall clock (NTP) for the chain-lag check only (review M-3). Defaults to Date.now. */
  readonly wallClock?: () => number;
  readonly ids: () => string;
  readonly metrics?: LoopMetrics;
  /** How long to hold after an adapter error before reconciling. Covers block inclusion of a lost tx. */
  readonly settleMs?: number;
  readonly callTimeoutMs?: number;
  /** Start in the uncertain state (default true) so a restart reconciles before quoting. */
  readonly startUncertain?: boolean;
}

class TimeoutError extends Error {}

/** Injective cids are 1 to 36 chars of [A-Za-z0-9_-] (see injective/orders.ts). */
const MAX_CID_LENGTH = 36;

/**
 * Client order ID for a quote. The `-L<level>-` segment is how the indexer recovers the quote level
 * from the chain order record (services/indexer/src/live/mappers.ts levelFromCid). The cycle
 * sequence is base 36 so the ID stays under the 36 char limit for billions of cycles.
 */
export function quoteCid(agentName: string, marketId: string, level: number, seq: number, index: number): string {
  const tail = `-${marketId.slice(2, 8)}-L${level}-${seq.toString(36)}-${index}`;
  const head = agentName.slice(0, Math.max(1, MAX_CID_LENGTH - tail.length)).replace(/-+$/, "");
  const cid = `${head}${tail}`;
  if (cid.length > MAX_CID_LENGTH) throw new Error(`cid ${cid} exceeds ${MAX_CID_LENGTH} chars`);
  return cid;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

const BPS = 1e4;
const MAX_CLOSE_ATTEMPTS = 20;

export class MarketQuoter {
  readonly #d: QuoterDeps;
  readonly #metrics: LoopMetrics;
  readonly #baseSettleMs: number;
  readonly #timeoutMs: number;
  #running = false;

  /** Stay uncertain at least as long as a lost tx can still be included (review L-4). */
  get #settleMs(): number {
    return Math.max(this.#baseSettleMs, (this.#d.adapter.txTimeoutMs ?? 0) + 2_000);
  }

  #uncertainUntil: number | null;
  #oracleState: OracleGuardState = INITIAL_ORACLE_STATE;
  #vol: VolState | null = null;
  #kappa: KappaState | null = null;
  #lastFair: number | null = null;
  #cycleSeq = 0;
  #killCancelled = false;
  readonly #closeAttempts = { risk: 0, kill: 0 };
  readonly #gaveUp = { risk: false, kill: false };
  readonly #active = new Set<string>();
  readonly #postedFair = new Map<string, number>();
  readonly #markouts = new MarkoutTracker();
  #fillLog: { side: "buy" | "sell"; at: number }[] = [];
  #guardLog: { reason: string; at: number }[] = [];
  #inventoryBase = 0;
  #sessionState: SessionState | null = null;
  #fundingRate: number | null = null;

  constructor(deps: QuoterDeps) {
    this.#d = deps;
    this.#metrics = deps.metrics ?? NOOP_METRICS;
    this.#baseSettleMs = deps.settleMs ?? 6_000;
    this.#timeoutMs = deps.callTimeoutMs ?? 8_000;
    this.#uncertainUntil = deps.startUncertain === false ? null : deps.now() + this.#settleMs;
  }

  get marketId(): string {
    return this.#d.market.marketId;
  }

  get uncertain(): boolean {
    return this.#uncertainUntil !== null;
  }

  get kappa(): number {
    return estimateKappa(this.#kappa, this.#d.getParams());
  }

  async runCycle(): Promise<CycleReport> {
    if (this.#running) return { outcome: "skipped", created: 0, cancelled: 0, nextDelayMs: this.#d.getParams().minCycleMs };
    this.#running = true;
    const started = this.#d.now();
    try {
      const report = await this.#cycle();
      this.#metrics.observeCycle(this.marketId, (this.#d.now() - started) / 1_000, report.outcome);
      return report;
    } finally {
      this.#running = false;
    }
  }

  /** Fill pushed by the adapter: update kappa and record it. */
  handleFill(fill: FillEvent): void {
    const fair = this.#postedFair.get(fill.orderHash) ?? this.#lastFair;
    if (fair !== null && fair > 0) this.#kappa = updateKappa(this.#kappa, (Math.abs(Number(fill.price) - fair) / fair) * BPS);
    const now = this.#d.now();
    this.#markouts.addFill(fill.side, Number(fill.price), now);
    this.#fillLog.push({ side: fill.side, at: now });
    const { network, provenance, agentId } = this.#d.identity;
    const record: Fill = {
      network,
      provenance,
      agentId,
      marketId: fill.marketId,
      orderHash: fill.orderHash,
      tradeId: fill.tradeId,
      // Injective Indexer trades carry no tx hash; the indexer stores the trade ID there, so the
      // agent does the same and both writers hit the same agent_fills primary key.
      txHash: fill.txHash === "" ? fill.tradeId : fill.txHash,
      eventIndex: fill.eventIndex,
      side: fill.side,
      price: fill.price,
      quantity: fill.quantity,
      feeUsd: Number(fill.fee),
      isMaker: fill.isMaker,
      counterpartySubaccountId: fill.counterpartySubaccountId,
      executedAt: fill.executedAtMs,
    };
    this.#d.sink.fill(record);
  }

  stats(windowMs: number): QuoterStats {
    const now = this.#d.now();
    this.#fillLog = this.#fillLog.filter((f) => now - f.at <= windowMs);
    this.#guardLog = this.#guardLog.filter((g) => now - g.at <= windowMs);
    return {
      sigmaBps: sigmaBps(this.#vol, this.#d.getParams()),
      fair: this.#lastFair,
      inventoryBase: this.#inventoryBase,
      sessionState: this.#sessionState,
      fundingRateHourly: this.#fundingRate,
      fills: { buy: this.#fillLog.filter((f) => f.side === "buy").length, sell: this.#fillLog.filter((f) => f.side === "sell").length },
      markoutsBps: this.#markouts.summary(now, windowMs),
      recentGuardReasons: [...new Set(this.#guardLog.map((g) => g.reason))],
    };
  }

  /* ------------------------------ cycle ------------------------------ */

  async #cycle(): Promise<CycleReport> {
    const params = this.#d.getParams();
    const { adapter } = this.#d;
    const id = this.marketId;

    if (this.#d.killSwitch.state.killed) return this.#handleKill(params);

    if (this.#uncertainUntil !== null) {
      const blocked = await this.#resolveUncertainty(params);
      if (blocked !== null) return blocked;
    }

    let state: MarketState;
    let live: LiveOrder[];
    try {
      [state, live] = await Promise.all([
        withTimeout(adapter.getMarketState(id), this.#timeoutMs, "getMarketState"),
        withTimeout(adapter.getOpenOrders(id), this.#timeoutMs, "getOpenOrders"),
      ]);
    } catch (err) {
      return this.#enterUncertainty(params, err);
    }

    const chainTime = state.chainTimeMs;
    const oraclePrice = Number(state.oracle.price);
    const ownResting = live.map((o) => ({ side: o.side, price: o.price, quantity: new Decimal(o.quantity).minus(o.filled).toFixed() }));
    const ext = externalBook(state.bids, state.asks, ownResting);
    // Only in-band, external depth counts: stale far-away orders must not move fair value or the cross-check.
    const health = assessBook(oraclePrice, ext.bids, ext.asks, params);
    const fv = computeFairValue({ oraclePrice, bids: health.bids, asks: health.asks }, params);

    const oracle = evaluateOracle(
      {
        oracle: { price: oraclePrice, timestampMs: state.oracle.timestampMs },
        reference: state.reference === null ? null : { price: Number(state.reference.price), timestampMs: state.reference.timestampMs },
        chainTimeMs: chainTime,
        wallClockMs: (this.#d.wallClock ?? Date.now)(),
        bookMid: health.mid,
        bookHealthy: health.healthy,
        bookDiagnostics: { reason: health.reason, bidDepthUsd: Math.round(health.bidDepthUsd * 100) / 100, askDepthUsd: Math.round(health.askDepthUsd * 100) / 100 },
      },
      this.#oracleState,
      params,
    );
    this.#oracleState = oracle.state;
    const session = evaluateSession(this.#d.market.sessionClass, chainTime, params);
    this.#sessionState = session.state;
    this.#inventoryBase = Number(state.position.quantity);
    this.#fundingRate = state.fundingRate === null ? null : Number(state.fundingRate);
    if (fv.mid !== null) this.#markouts.observeMid(fv.mid, this.#d.now());
    this.#d.risk.update(id, state);
    const risk = this.#d.risk.evaluate(chainTime, params);
    const riskMode: MarketRiskMode = risk.markets[id] ?? "normal";

    const decisions: GuardDecision[] = [...oracle.decisions];
    if (session.decision !== null) decisions.push(session.decision);
    for (const d of risk.decisions) if (d.marketId === id) decisions.push(d.decision);
    this.#emitTransitions(decisions);

    const halted = oracle.action === "halt" || !session.quote || risk.haltAll || riskMode === "halt";
    if (halted) {
      const reason = decisions.find((d) => d.action === "halt")?.reason ?? (risk.haltAll ? "risk" : "halt");
      this.#metrics.halt(id, reason);
      const closeReason = risk.decisions.find((d) => d.decision.action === "halt" || d.decision.action === "flatten")?.decision.reason ?? "risk_daily_loss";
      return this.#halt(params, live, risk.closePositions ? closeReason : null, Number(state.position.quantity));
    }
    this.#closeAttempts.risk = 0;

    if (oraclePrice > 0) {
      this.#vol = updateVolatility(this.#vol, fv.mid ?? oraclePrice, chainTime, params);
    }
    const sigma = sigmaBps(this.#vol, params);
    const mode: QuoteMode = session.flatten || riskMode === "flatten" ? "flatten" : riskMode === "reduce_only" ? "reduce_only" : "normal";
    const plan = computeQuotes(
      {
        fair: fv.fair,
        sigmaBps: sigma,
        kappa: estimateKappa(this.#kappa, params),
        inventoryBase: Number(state.position.quantity),
        fundingRateHourly: state.fundingRate === null ? null : Number(state.fundingRate),
        bids: state.bids,
        asks: state.asks,
        ownOrders: ownResting,
        market: this.#d.market.spec,
        session: { ...session.multipliers, spreadMultiplier: session.multipliers.spreadMultiplier * oracle.spreadMultiplier },
        mode,
      },
      params,
    );
    this.#lastFair = fv.fair;

    const diff = diffOrders(plan.quotes, live, risk.orderBudget);
    const nextDelayMs = this.#adaptiveDelay(params, sigma);
    if (diff.cancel.length === 0 && diff.create.length === 0) {
      return { outcome: "unchanged", created: 0, cancelled: 0, nextDelayMs, mode };
    }
    return this.#sendBatch(params, diff, fv.fair, nextDelayMs, mode);
  }

  async #sendBatch(params: RiskParams, diff: OrderDiff, fair: number, nextDelayMs: number, mode: QuoteMode): Promise<CycleReport> {
    const seq = ++this.#cycleSeq;
    const creates: NewOrder[] = diff.create.map((q, i) => ({
      side: q.side,
      price: q.price,
      quantity: q.quantity,
      postOnly: true,
      reduceOnly: q.reduceOnly,
      cid: quoteCid(this.#d.identity.agentName, this.marketId, q.level, seq, i),
    }));
    let result: BatchResult;
    try {
      result = await withTimeout(
        this.#d.adapter.batchUpdate({ marketId: this.marketId, cancelOrderHashes: [...diff.cancel], create: creates, feeRecipient: this.#d.adapter.address }),
        this.#timeoutMs,
        "batchUpdate",
      );
    } catch (err) {
      this.#metrics.txResult(this.marketId, false);
      return this.#enterUncertainty(params, err);
    }
    this.#metrics.txResult(this.marketId, true);
    const now = this.#d.now();
    this.#d.risk.recordOrders(creates.length, now);
    this.#recordCancels(diff.cancel, now);

    const rejectedCids = new Set(result.rejected.map((r) => r.cid));
    const accepted = diff.create.filter((_, i) => !rejectedCids.has(creates[i]!.cid));
    accepted.forEach((q, i) => {
      const hash = result.createdOrderHashes[i];
      if (hash === undefined) return;
      this.#postedFair.set(hash, fair);
      const { network, provenance, agentId } = this.#d.identity;
      this.#d.sink.quote({ network, provenance, agentId, marketId: this.marketId, orderHash: hash, side: q.side, price: q.price, quantity: q.quantity, level: q.level, postedAt: now, cancelledAt: null });
    });
    return { outcome: "quoted", created: accepted.length, cancelled: diff.cancel.length, nextDelayMs, mode };
  }

  #recordCancels(hashes: readonly string[], at: number): void {
    for (const h of hashes) {
      this.#postedFair.delete(h);
      this.#d.sink.cancel({ network: this.#d.identity.network, orderHash: h, cancelledAt: at });
    }
  }

  async #halt(params: RiskParams, live: readonly LiveOrder[], closeReason: GuardDecision["reason"] | null, positionQty: number): Promise<CycleReport> {
    try {
      if (live.length > 0) {
        await withTimeout(this.#d.adapter.cancelAll(this.marketId), this.#timeoutMs, "cancelAll");
        this.#recordCancels(live.map((o) => o.orderHash), this.#d.now());
      }
      if (closeReason !== null) await this.#closeUntilFlat("risk", positionQty, { guard: "risk", reason: closeReason });
    } catch (err) {
      return this.#enterUncertainty(params, err);
    }
    return { outcome: "halted", created: 0, cancelled: live.length, nextDelayMs: params.maxCycleMs };
  }

  async #handleKill(params: RiskParams): Promise<CycleReport> {
    const killDecision = this.#d.killSwitch.decision();
    if (killDecision !== null) this.#emitTransitions([killDecision]);
    const { adapter } = this.#d;
    try {
      if (!this.#killCancelled) {
        await withTimeout(adapter.cancelAll(this.marketId), this.#timeoutMs, "cancelAll");
        this.#killCancelled = true;
      } else {
        // Late landings of a tx that was in flight when the kill arrived.
        const live = await withTimeout(adapter.getOpenOrders(this.marketId), this.#timeoutMs, "getOpenOrders");
        if (live.length > 0) await withTimeout(adapter.cancelAll(this.marketId), this.#timeoutMs, "cancelAll");
      }
      const ks = this.#d.killSwitch.state;
      if (ks.closePositions && !this.#gaveUp.kill) {
        const st = await withTimeout(adapter.getMarketState(this.marketId), this.#timeoutMs, "getMarketState");
        await this.#closeUntilFlat("kill", Number(st.position.quantity), { guard: "kill_switch", reason: `kill_switch_${ks.source ?? "env"}` });
      }
    } catch {
      // Retried next cycle; the agent stays killed either way.
    }
    return { outcome: "killed", created: 0, cancelled: 0, nextDelayMs: params.maxCycleMs };
  }

  /**
   * "Closed" is a property of the position, not of one call (review M-2): every halted cycle
   * re-reads the position and sends another reduce-only close until it is below the minimum
   * quantity, reporting each residual, and stops after MAX_CLOSE_ATTEMPTS asking for a human.
   */
  async #closeUntilFlat(kind: "risk" | "kill", positionQty: number, tag: Pick<GuardDecision, "guard" | "reason">): Promise<void> {
    const minQty = Number(this.#d.market.spec.minQuantity);
    const size = Math.abs(positionQty);
    if (!Number.isFinite(size) || size < minQty) return;
    const attempts = this.#closeAttempts[kind];
    if (attempts >= MAX_CLOSE_ATTEMPTS) {
      if (!this.#gaveUp[kind]) {
        this.#gaveUp[kind] = true;
        this.#emitDirect({ ...tag, action: "halt", detail: `Reduce-only close failed ${attempts} times with ${size} still open; manual action needed.`, observed: { attempts, residual: size } });
      }
      return;
    }
    if (attempts > 0) {
      this.#emitDirect({ ...tag, action: "flatten", detail: `Reduce-only close attempt ${attempts} left ${size} open; retrying.`, observed: { attempts, residual: size } });
    }
    this.#closeAttempts[kind] = attempts + 1;
    await withTimeout(this.#d.adapter.closePositionReduceOnly(this.marketId), this.#timeoutMs, "closePositionReduceOnly");
  }

  #emitDirect(d: GuardDecision): void {
    const { network, provenance, agentId } = this.#d.identity;
    this.#d.sink.guard(toGuardEvent(d, { network, provenance, agentId, marketId: this.marketId, id: this.#d.ids(), at: this.#d.now() }));
  }

  async #enterUncertainty(params: RiskParams, err: unknown): Promise<CycleReport> {
    const first = this.#uncertainUntil === null;
    this.#uncertainUntil = this.#d.now() + this.#settleMs;
    if (first) {
      this.#emitTransitions([
        {
          guard: "risk",
          action: "halt",
          reason: "data_unavailable",
          detail: "Exchange call failed or timed out; orders cancelled until state is reconciled.",
          observed: { error: err instanceof Error ? err.message.slice(0, 200) : "unknown error" },
        },
      ]);
    }
    try {
      await withTimeout(this.#d.adapter.cancelAll(this.marketId), this.#timeoutMs, "cancelAll");
    } catch {
      // Still uncertain; the next cycle tries again.
    }
    return { outcome: "uncertain", created: 0, cancelled: 0, nextDelayMs: params.minCycleMs };
  }

  /** Returns a report when the market must stay blocked, or null when it is safe to quote again. */
  async #resolveUncertainty(params: RiskParams): Promise<CycleReport | null> {
    const blocked: CycleReport = { outcome: "uncertain", created: 0, cancelled: 0, nextDelayMs: params.minCycleMs };
    const { adapter } = this.#d;
    try {
      if (this.#d.now() < this.#uncertainUntil!) {
        await withTimeout(adapter.cancelAll(this.marketId), this.#timeoutMs, "cancelAll");
        return blocked;
      }
      const live = await withTimeout(adapter.getOpenOrders(this.marketId), this.#timeoutMs, "getOpenOrders");
      if (live.length > 0) {
        await withTimeout(adapter.cancelAll(this.marketId), this.#timeoutMs, "cancelAll");
        this.#recordCancels(live.map((o) => o.orderHash), this.#d.now());
        this.#uncertainUntil = this.#d.now() + this.#settleMs;
        return blocked;
      }
    } catch {
      this.#uncertainUntil = this.#d.now() + this.#settleMs;
      return blocked;
    }
    this.#uncertainUntil = null;
    this.#active.delete("risk:data_unavailable:halt");
    return null;
  }

  #adaptiveDelay(params: RiskParams, sigma: number): number {
    const frac = Math.min(1, Math.max(0, sigma / params.highVolSigmaBps));
    return Math.round(params.maxCycleMs - (params.maxCycleMs - params.minCycleMs) * frac);
  }

  /** Record a guard event only when a (guard, reason, action) appears; clear ones that went away. */
  #emitTransitions(decisions: readonly GuardDecision[]): void {
    const now = new Set<string>();
    for (const d of decisions) {
      const key = `${d.guard}:${d.reason}:${d.action}`;
      now.add(key);
      if (this.#active.has(key)) continue;
      this.#guardLog.push({ reason: d.reason, at: this.#d.now() });
      const { network, provenance, agentId } = this.#d.identity;
      this.#d.sink.guard(toGuardEvent(d, { network, provenance, agentId, marketId: this.marketId, id: this.#d.ids(), at: this.#d.now() }));
    }
    this.#active.clear();
    for (const k of now) this.#active.add(k);
  }
}

/* ------------------------------ runner ------------------------------ */

export interface RunnerDeps {
  readonly adapter: ExchangeAdapter;
  readonly quoters: readonly MarketQuoter[];
  readonly killSwitch: KillSwitch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly onCycleError?: (marketId: string, err: unknown) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

/** Runs one loop per market, routes fills, and guarantees cancel-all on shutdown and kill. */
export class AgentRunner {
  readonly #d: RunnerDeps;
  readonly #sleep: (ms: number) => Promise<void>;
  #stopped = false;
  #loops: Promise<void>[] = [];
  #unsubFill: (() => void) | null = null;
  #unsubKill: (() => void) | null = null;

  constructor(deps: RunnerDeps) {
    this.#d = deps;
    this.#sleep = deps.sleep ?? defaultSleep;
  }

  start(): void {
    const byMarket = new Map(this.#d.quoters.map((q) => [q.marketId, q]));
    this.#unsubFill = this.#d.adapter.onFill((f) => byMarket.get(f.marketId)?.handleFill(f));
    this.#unsubKill = this.#d.killSwitch.onKill(() => void this.cancelEverything());
    this.#loops = this.#d.quoters.map((q) => this.#loop(q));
  }

  async #loop(q: MarketQuoter): Promise<void> {
    while (!this.#stopped) {
      let delay = 3_000;
      try {
        delay = (await q.runCycle()).nextDelayMs;
      } catch (err) {
        this.#d.onCycleError?.(q.marketId, err);
      }
      if (this.#stopped) break;
      await this.#sleep(delay);
    }
  }

  /** Best-effort cancel on every market, retried; never throws. */
  async cancelEverything(attempts = 3): Promise<string[]> {
    const failed: string[] = [];
    await Promise.all(
      this.#d.quoters.map(async (q) => {
        for (let i = 0; i < attempts; i++) {
          try {
            await this.#d.adapter.cancelAll(q.marketId);
            return;
          } catch {
            // retry
          }
        }
        failed.push(q.marketId);
      }),
    );
    return failed;
  }

  /** Stop loops, wait for in-flight cycles, then cancel all orders. Throws if any market could not be cancelled. */
  async shutdown(): Promise<void> {
    this.#stopped = true;
    await Promise.allSettled(this.#loops);
    this.#unsubFill?.();
    this.#unsubKill?.();
    const failed = await this.cancelEverything();
    if (failed.length > 0) throw new Error(`cancelAll failed on ${failed.length} market(s) during shutdown`);
  }
}

