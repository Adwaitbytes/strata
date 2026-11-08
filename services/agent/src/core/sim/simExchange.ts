/**
 * In-memory ExchangeAdapter for deterministic tests and SIMULATED runs. It models the parts of the
 * chain the core depends on: an external L2 book, our resting orders (post-only, reduce-only),
 * maker fills, oracle feeds, chain time, and the failure modes that matter for safety:
 *
 * - `throw`: the call fails and nothing happens on chain.
 * - `apply_then_throw`: the tx lands but the response is lost (timeout after broadcast).
 * - `land_later`: the call fails now and the tx lands on chain later (slow inclusion).
 *
 * Every number it emits is SIMULATED; nothing here touches a network.
 */
import { Decimal } from "decimal.js";
import type { Side } from "@strata/sdk";
import type {
  BatchResult,
  BatchUpdate,
  ExchangeAdapter,
  FillEvent,
  L2Level,
  LiveOrder,
  MarketState,
  OraclePoint,
} from "../exchange.js";

export type SimMethod = "getMarketState" | "getOpenOrders" | "batchUpdate" | "cancelAll" | "closePositionReduceOnly";
export type FaultMode = "throw" | "apply_then_throw" | "land_later";

export interface SimMarketInit {
  readonly marketId: string;
  readonly bids: readonly L2Level[];
  readonly asks: readonly L2Level[];
  readonly oraclePrice: string;
  readonly fundingRate?: string | null;
}

interface SimOrder {
  readonly orderHash: string;
  readonly marketId: string;
  readonly side: Side;
  readonly price: Decimal;
  readonly quantity: Decimal;
  filled: Decimal;
  readonly reduceOnly: boolean;
  readonly createdAtMs: number;
}

interface SimMarket {
  bids: L2Level[];
  asks: L2Level[];
  oracle: OraclePoint;
  reference: OraclePoint | null;
  fundingRate: string | null;
  position: Decimal;
  entryPrice: Decimal | null;
  realizedPnl: Decimal;
}

export class SimExchange implements ExchangeAdapter {
  readonly network = "testnet" as const;
  readonly subaccountId = `0x${"5".repeat(64)}`;
  readonly address = `0x${"6".repeat(40)}`;

  chainTimeMs: number;
  availableQuote: Decimal;
  /** Fixed margin ratio override; when null it is computed from equity and a 2.5% maintenance margin. */
  marginRatio: number | null = null;
  /** Fraction of the position a reduce-only close fills per call (thin books fill partly). */
  closeFillFraction = 1;
  /** Max time after broadcast a lost tx can still land, if the scenario sets one. */
  txTimeoutMs?: number;

  readonly #markets = new Map<string, SimMarket>();
  readonly #orders = new Map<string, SimOrder>();
  readonly #faults: { method: SimMethod; mode: FaultMode; landAfterMs: number }[] = [];
  readonly #pending: { update: BatchUpdate; landAtMs: number; seq: number }[] = [];
  readonly #fillHandlers = new Set<(f: FillEvent) => void>();
  #seq = 0;
  #tradeSeq = 0;

  /** Every batch that actually landed, in order. */
  readonly landed: BatchUpdate[] = [];
  /** Count of calls per method, including failed ones. */
  readonly calls: Record<SimMethod, number> = {
    getMarketState: 0,
    getOpenOrders: 0,
    batchUpdate: 0,
    cancelAll: 0,
    closePositionReduceOnly: 0,
  };
  /** Highest number of simultaneously open orders observed per market. */
  readonly maxOpenOrders = new Map<string, number>();

  constructor(opts: { chainTimeMs: number; availableQuote?: string; markets: readonly SimMarketInit[] }) {
    this.chainTimeMs = opts.chainTimeMs;
    this.availableQuote = new Decimal(opts.availableQuote ?? "1000");
    for (const m of opts.markets) {
      this.#markets.set(m.marketId, {
        bids: [...m.bids],
        asks: [...m.asks],
        oracle: { price: m.oraclePrice, timestampMs: opts.chainTimeMs - 1_000, source: "sim" },
        reference: null,
        fundingRate: m.fundingRate ?? null,
        position: new Decimal(0),
        entryPrice: null,
        realizedPnl: new Decimal(0),
      });
    }
  }

  /* ------------------------------ scripting ------------------------------ */

  injectFault(method: SimMethod, mode: FaultMode, landAfterMs = 0): void {
    this.#faults.push({ method, mode, landAfterMs });
  }

  setOracle(marketId: string, price: string, timestampMs = this.chainTimeMs - 1_000): void {
    this.#market(marketId).oracle = { price, timestampMs, source: "sim" };
  }

  setReference(marketId: string, ref: OraclePoint | null): void {
    this.#market(marketId).reference = ref;
  }

  setBook(marketId: string, bids: readonly L2Level[], asks: readonly L2Level[]): void {
    const m = this.#market(marketId);
    m.bids = [...bids];
    m.asks = [...asks];
  }

  /** Advance chain time; delayed transactions whose time has come land now. */
  advance(ms: number): void {
    this.chainTimeMs += ms;
    const due = this.#pending.filter((p) => p.landAtMs <= this.chainTimeMs).sort((a, b) => a.seq - b.seq);
    for (const p of due) {
      this.#pending.splice(this.#pending.indexOf(p), 1);
      this.#apply(p.update);
    }
  }

  get pendingCount(): number {
    return this.#pending.length;
  }

  openOrders(marketId: string): LiveOrder[] {
    return [...this.#orders.values()]
      .filter((o) => o.marketId === marketId && o.filled.lt(o.quantity))
      .map((o) => ({
        orderHash: o.orderHash,
        side: o.side,
        price: o.price.toFixed(),
        quantity: o.quantity.toFixed(),
        filled: o.filled.toFixed(),
        createdAtMs: o.createdAtMs,
      }));
  }

  position(marketId: string): string {
    return this.#market(marketId).position.toFixed();
  }

  /** An external taker sends a market order that sweeps our resting orders, best price first. */
  takerTrade(marketId: string, takerSide: Side, quantity: string): FillEvent[] {
    const makerSide: Side = takerSide === "buy" ? "sell" : "buy";
    const book = [...this.#orders.values()]
      .filter((o) => o.marketId === marketId && o.side === makerSide && o.filled.lt(o.quantity))
      .sort((a, b) => (makerSide === "sell" ? a.price.cmp(b.price) : b.price.cmp(a.price)) || a.createdAtMs - b.createdAtMs);
    let left = new Decimal(quantity);
    const fills: FillEvent[] = [];
    for (const o of book) {
      if (left.lte(0)) break;
      const qty = Decimal.min(left, o.quantity.minus(o.filled));
      o.filled = o.filled.plus(qty);
      left = left.minus(qty);
      this.#applyFill(marketId, makerSide, o.price, qty);
      const fill: FillEvent = {
        marketId,
        orderHash: o.orderHash,
        tradeId: `sim-trade-${++this.#tradeSeq}`,
        txHash: `0x${this.#tradeSeq.toString(16).padStart(64, "0")}`,
        eventIndex: 0,
        side: makerSide,
        price: o.price.toFixed(),
        quantity: qty.toFixed(),
        fee: "0",
        isMaker: true,
        counterpartySubaccountId: null,
        executedAtMs: this.chainTimeMs,
      };
      fills.push(fill);
      for (const h of this.#fillHandlers) h(fill);
    }
    return fills;
  }

  /* ------------------------------ ExchangeAdapter ------------------------------ */

  async getMarketState(marketId: string): Promise<MarketState> {
    this.calls.getMarketState++;
    this.#maybeFail("getMarketState", null);
    const m = this.#market(marketId);
    const own = this.openOrders(marketId);
    const merge = (levels: readonly L2Level[], side: Side): L2Level[] => {
      const map = new Map<string, Decimal>();
      for (const l of levels) map.set(new Decimal(l.price).toFixed(), new Decimal(l.quantity));
      for (const o of own.filter((x) => x.side === side)) {
        const k = new Decimal(o.price).toFixed();
        map.set(k, (map.get(k) ?? new Decimal(0)).plus(new Decimal(o.quantity).minus(o.filled)));
      }
      return [...map.entries()]
        .map(([price, q]) => ({ price, quantity: q.toFixed() }))
        .sort((a, b) => (side === "buy" ? new Decimal(b.price).cmp(a.price) : new Decimal(a.price).cmp(b.price)));
    };
    const mark = new Decimal(m.oracle.price);
    const upnl = m.entryPrice === null ? new Decimal(0) : mark.minus(m.entryPrice).times(m.position);
    return {
      marketId,
      bids: merge(m.bids, "buy"),
      asks: merge(m.asks, "sell"),
      oracle: { ...m.oracle },
      reference: m.reference === null ? null : { ...m.reference },
      markPrice: m.oracle.price,
      chainTimeMs: this.chainTimeMs,
      position: {
        quantity: m.position.toFixed(),
        entryPrice: m.entryPrice === null ? null : m.entryPrice.toFixed(),
        margin: m.position.abs().times(mark).div(5).toFixed(),
        unrealizedPnl: upnl.toFixed(),
      },
      availableQuote: this.availableQuote.plus(m.realizedPnl).toFixed(),
      fundingRate: m.fundingRate,
      marginRatio: this.#marginRatioFor(m, mark),
    };
  }

  async getOpenOrders(marketId: string): Promise<LiveOrder[]> {
    this.calls.getOpenOrders++;
    this.#maybeFail("getOpenOrders", null);
    return this.openOrders(marketId);
  }

  async batchUpdate(update: BatchUpdate): Promise<BatchResult> {
    this.calls.batchUpdate++;
    const seq = ++this.#seq;
    this.#maybeFail("batchUpdate", { update, seq });
    return this.#apply(update, seq);
  }

  async cancelAll(marketId: string): Promise<void> {
    this.calls.cancelAll++;
    const cancel: BatchUpdate = { marketId, cancelOrderHashes: this.openOrders(marketId).map((o) => o.orderHash), create: [], feeRecipient: this.address };
    this.#maybeFail("cancelAll", { update: cancel, seq: ++this.#seq });
    for (const o of this.#orders.values()) if (o.marketId === marketId) this.#orders.delete(o.orderHash);
  }

  async closePositionReduceOnly(marketId: string): Promise<void> {
    this.calls.closePositionReduceOnly++;
    this.#maybeFail("closePositionReduceOnly", null);
    const m = this.#market(marketId);
    if (m.position.isZero()) return;
    const side: Side = m.position.gt(0) ? "sell" : "buy";
    const qty = m.position.abs().times(this.closeFillFraction).toDecimalPlaces(8, Decimal.ROUND_DOWN);
    if (qty.gt(0)) this.#applyFill(marketId, side, new Decimal(m.oracle.price), qty);
  }

  onFill(handler: (fill: FillEvent) => void): () => void {
    this.#fillHandlers.add(handler);
    return () => this.#fillHandlers.delete(handler);
  }

  /* ------------------------------ internals ------------------------------ */

  #marginRatioFor(m: SimMarket, mark: Decimal): number | null {
    if (this.marginRatio !== null) return this.marginRatio;
    if (m.position.isZero()) return null;
    const equity = this.availableQuote.plus(m.realizedPnl);
    return equity.div(m.position.abs().times(mark).times(0.025)).toNumber();
  }

  #market(marketId: string): SimMarket {
    const m = this.#markets.get(marketId);
    if (m === undefined) throw new Error(`sim: unknown market ${marketId}`);
    return m;
  }

  #maybeFail(method: SimMethod, tx: { update: BatchUpdate; seq: number } | null): void {
    const idx = this.#faults.findIndex((f) => f.method === method);
    if (idx < 0) return;
    const [fault] = this.#faults.splice(idx, 1);
    if (fault!.mode === "apply_then_throw" && tx !== null) this.#apply(tx.update, tx.seq);
    if (fault!.mode === "land_later" && tx !== null) this.#pending.push({ update: tx.update, landAtMs: this.chainTimeMs + fault!.landAfterMs, seq: tx.seq });
    throw new Error(`sim: injected ${fault!.mode} on ${method}`);
  }

  #apply(update: BatchUpdate, seq = ++this.#seq): BatchResult {
    const m = this.#market(update.marketId);
    for (const h of update.cancelOrderHashes) {
      const o = this.#orders.get(h);
      if (o !== undefined && o.marketId === update.marketId) this.#orders.delete(h);
    }
    const created: string[] = [];
    const rejected: { cid: string; reason: string }[] = [];
    const bestAsk = m.asks.length ? Decimal.min(...m.asks.map((l) => new Decimal(l.price))) : null;
    const bestBid = m.bids.length ? Decimal.max(...m.bids.map((l) => new Decimal(l.price))) : null;
    update.create.forEach((n, i) => {
      const price = new Decimal(n.price);
      const crosses = n.side === "buy" ? bestAsk !== null && price.gte(bestAsk) : bestBid !== null && price.lte(bestBid);
      if (n.postOnly && crosses) {
        rejected.push({ cid: n.cid, reason: "post-only order would cross" });
        return;
      }
      const hash = `0x${seq.toString(16).padStart(32, "0")}${i.toString(16).padStart(32, "0")}`;
      this.#orders.set(hash, {
        orderHash: hash,
        marketId: update.marketId,
        side: n.side,
        price,
        quantity: new Decimal(n.quantity),
        filled: new Decimal(0),
        reduceOnly: n.reduceOnly,
        createdAtMs: this.chainTimeMs,
      });
      created.push(hash);
    });
    this.landed.push(update);
    const open = this.openOrders(update.marketId).length;
    this.maxOpenOrders.set(update.marketId, Math.max(this.maxOpenOrders.get(update.marketId) ?? 0, open));
    return { txHash: `0x${seq.toString(16).padStart(64, "0")}`, createdOrderHashes: created, rejected };
  }

  #applyFill(marketId: string, makerSide: Side, price: Decimal, qty: Decimal): void {
    const m = this.#market(marketId);
    const signed = makerSide === "buy" ? qty : qty.neg();
    const next = m.position.plus(signed);
    if (m.position.isZero() || m.position.isNeg() === signed.isNeg()) {
      const prevNotional = m.entryPrice === null ? new Decimal(0) : m.entryPrice.times(m.position.abs());
      m.entryPrice = prevNotional.plus(price.times(qty)).div(next.abs());
    } else {
      const closed = Decimal.min(qty, m.position.abs());
      const pnlPerUnit = m.position.gt(0) ? price.minus(m.entryPrice!) : m.entryPrice!.minus(price);
      m.realizedPnl = m.realizedPnl.plus(pnlPerUnit.times(closed));
      if (next.isZero()) m.entryPrice = null;
      else if (next.isNeg() !== m.position.isNeg()) m.entryPrice = price;
    }
    m.position = next;
  }
}
