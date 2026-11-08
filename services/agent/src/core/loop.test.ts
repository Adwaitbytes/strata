import { describe, expect, it, vi } from "vitest";
import type { Fill, GuardEvent, Quote, TunerEvent } from "@strata/sdk";
import { DEFAULT_PARAMS, zonedTimeToUtc, type RiskParams, type RiskState, type SessionClass } from "@strata/risk";
import { SimExchange } from "./sim/simExchange.js";
import { AgentRisk, AgentRunner, MarketQuoter, diffOrders, quoteCid, type AgentIdentity } from "./loop.js";
import { KillSwitch } from "./killSwitch.js";
import type { CancelRecord, EventSink } from "./recorder.js";
import type { ExchangeAdapter, LiveOrder } from "./exchange.js";

const M = `0x${"a".repeat(64)}`;
const T0 = zonedTimeToUtc(2026, 11, 11, 11, 0); // Wednesday 11:00 New York
const identity: AgentIdentity = { agentId: 1, agentName: "strata-test-1", network: "testnet", provenance: "SIMULATED" };

class MemorySink implements EventSink {
  quotes: Quote[] = [];
  cancels: CancelRecord[] = [];
  fills: Fill[] = [];
  guards: GuardEvent[] = [];
  tuners: TunerEvent[] = [];
  quote(q: Quote) {
    this.quotes.push(q);
  }
  cancel(c: CancelRecord) {
    this.cancels.push(c);
  }
  fill(f: Fill) {
    this.fills.push(f);
  }
  guard(e: GuardEvent) {
    this.guards.push(e);
  }
  tuner(e: TunerEvent) {
    this.tuners.push(e);
  }
  reasons(): string[] {
    return this.guards.map((g) => g.reason);
  }
}

interface SetupOpts {
  params?: Partial<RiskParams>;
  sessionClass?: SessionClass;
  chainTimeMs?: number;
  startUncertain?: boolean;
  sim?: SimExchange;
  adapter?: ExchangeAdapter;
  callTimeoutMs?: number;
  initialRisk?: RiskState | null;
}

function setup(opts: SetupOpts = {}) {
  const chainTimeMs = opts.chainTimeMs ?? T0;
  const sim =
    opts.sim ??
    new SimExchange({
      chainTimeMs,
      markets: [{ marketId: M, bids: [{ price: "99.9", quantity: "10" }], asks: [{ price: "100.1", quantity: "10" }], oraclePrice: "100" }],
    });
  let local = 1_000_000;
  let wallClockSkewMs = 0;
  const now = () => local;
  const sink = new MemorySink();
  const killSwitch = new KillSwitch({ agentId: identity.agentId, agentName: identity.agentName });
  const params: RiskParams = { ...DEFAULT_PARAMS, ...opts.params };
  let n = 0;
  const ids = () => `evt-${++n}`;
  const risk = new AgentRisk(identity, sink, ids, now, undefined, opts.initialRisk ?? null);
  const quoter = new MarketQuoter({
    adapter: opts.adapter ?? sim,
    market: { marketId: M, ticker: "TEST/USDC PERP", sessionClass: opts.sessionClass ?? "always_open", spec: { tickSize: "0.01", minQuantity: "0.001", minNotional: "1" } },
    identity,
    getParams: () => params,
    risk,
    sink,
    killSwitch,
    now,
    ids,
    wallClock: () => sim.chainTimeMs + wallClockSkewMs,
    settleMs: 6_000,
    startUncertain: opts.startUncertain ?? false,
    ...(opts.callTimeoutMs !== undefined ? { callTimeoutMs: opts.callTimeoutMs } : {}),
  });
  let oracle = "100";
  let freshOracle = true;
  const ctl = {
    sim,
    sink,
    killSwitch,
    quoter,
    risk,
    params,
    setOraclePrice(p: string) {
      oracle = p;
      sim.setOracle(M, p, sim.chainTimeMs - 500);
    },
    stopOracle() {
      freshOracle = false;
    },
    setWallClockSkew(ms: number) {
      wallClockSkewMs = ms;
    },
    /** Advance local and chain time together, refresh the oracle, run one cycle. */
    async tick(ms = 1_000) {
      local += ms;
      sim.advance(ms);
      if (freshOracle) sim.setOracle(M, oracle, sim.chainTimeMs - 500);
      return quoter.runCycle();
    },
    open(): LiveOrder[] {
      return sim.openOrders(M);
    },
  };
  return ctl;
}

function assertNoDuplicates(orders: readonly LiveOrder[]) {
  const keys = orders.map((o) => `${o.side}@${o.price}`);
  expect(new Set(keys).size).toBe(keys.length);
  expect(orders.filter((o) => o.side === "buy").length).toBeLessThanOrEqual(DEFAULT_PARAMS.levels);
  expect(orders.filter((o) => o.side === "sell").length).toBeLessThanOrEqual(DEFAULT_PARAMS.levels);
}

describe("MarketQuoter happy path", () => {
  it("posts a 3 x 3 ladder in one batch, then leaves it alone while nothing changes", async () => {
    const c = setup();
    const r1 = await c.tick();
    expect(r1).toMatchObject({ outcome: "quoted", created: 6, cancelled: 0, mode: "normal" });
    expect(c.sim.calls.batchUpdate).toBe(1);
    expect(c.sim.landed[0]!.create.every((o) => o.postOnly)).toBe(true);
    expect(c.sim.landed[0]!.feeRecipient).toBe(c.sim.address);
    expect(c.sink.quotes).toHaveLength(6);
    expect(c.sink.quotes.every((q) => q.provenance === "SIMULATED" && q.network === "testnet")).toBe(true);
    const r2 = await c.tick();
    expect(r2.outcome).toBe("unchanged");
    expect(c.sim.calls.batchUpdate).toBe(1);
    assertNoDuplicates(c.open());
  });

  it("requotes with cancels and creates in a single batch when fair value moves", async () => {
    const c = setup();
    await c.tick();
    c.sim.setBook(M, [{ price: "100.9", quantity: "10" }], [{ price: "101.1", quantity: "10" }]);
    c.setOraclePrice("101");
    const r = await c.tick();
    expect(r.outcome).toBe("quoted");
    expect(r.cancelled).toBe(6);
    expect(r.created).toBe(6);
    expect(c.sim.calls.batchUpdate).toBe(2);
    expect(c.sink.cancels).toHaveLength(6);
    assertNoDuplicates(c.open());
  });

  it("skips a cycle that starts while another is running", async () => {
    const c = setup();
    const [a, b] = await Promise.all([c.quoter.runCycle(), c.quoter.runCycle()]);
    expect([a.outcome, b.outcome].sort()).toEqual(["quoted", "skipped"]);
  });

  it("caps creates by the order-rate budget, lowest levels first", async () => {
    const c = setup({ params: { maxOrdersPerMinute: 4 } });
    const r = await c.tick();
    expect(r.created).toBe(4);
    expect(c.sim.landed[0]!.create.length).toBe(4);
    expect(new Set(c.sink.quotes.map((q) => q.level))).toEqual(new Set([0, 1]));
  });

  it("cycles faster when volatility is high", async () => {
    const c = setup();
    const calm = await c.tick();
    expect(calm.nextDelayMs).toBeGreaterThan(2_500);
    c.sim.setBook(M, [{ price: "101.9", quantity: "10" }], [{ price: "102.1", quantity: "10" }]);
    c.setOraclePrice("102");
    const hot = await c.tick();
    expect(hot.nextDelayMs).toBeLessThan(calm.nextDelayMs);
  });
});

describe("guards in the loop", () => {
  it("halts and cancels on a stale oracle, recording the event once (stale oracle fixture)", async () => {
    const c = setup();
    await c.tick();
    expect(c.open()).toHaveLength(6);
    c.stopOracle();
    await c.tick(31_000);
    const r = await c.tick();
    await c.tick();
    expect(r.outcome).toBe("halted");
    expect(c.open()).toHaveLength(0);
    expect(c.sink.reasons().filter((x) => x === "oracle_stale")).toHaveLength(1);
    expect(c.sink.guards[0]).toMatchObject({ guard: "oracle", action: "halt", marketId: M, agentId: 1 });
  });

  it("halts on a future-dated oracle report", async () => {
    const c = setup();
    await c.tick();
    c.stopOracle();
    c.sim.setOracle(M, "100", c.sim.chainTimeMs + 10_000);
    expect((await c.tick()).outcome).toBe("halted");
    expect(c.sink.reasons()).toContain("oracle_future_timestamp");
    expect(c.open()).toHaveLength(0);
  });

  it("does not quote while the underlying market is closed (weekend fixture)", async () => {
    const c = setup({ sessionClass: "us_equity", chainTimeMs: zonedTimeToUtc(2026, 11, 14, 12, 0) });
    const r = await c.tick();
    expect(r.outcome).toBe("halted");
    expect(c.sim.calls.batchUpdate).toBe(0);
    expect(c.sink.reasons()).toContain("session_closed");
  });

  it("flattens inventory with one reduce-only order five minutes before close", async () => {
    const c = setup({ sessionClass: "us_equity", chainTimeMs: zonedTimeToUtc(2026, 11, 9, 15, 56) });
    await c.sim.batchUpdate({ marketId: M, cancelOrderHashes: [], create: [{ side: "buy", price: "99.5", quantity: "0.4", postOnly: true, reduceOnly: false, cid: "seed" }], feeRecipient: c.sim.address });
    c.sim.takerTrade(M, "sell", "0.4");
    const r = await c.tick();
    expect(r).toMatchObject({ outcome: "quoted", mode: "flatten", created: 1 });
    expect(c.sim.landed.at(-1)!.create).toEqual([expect.objectContaining({ side: "sell", quantity: "0.4", reduceOnly: true, postOnly: true })]);
    expect(c.sink.reasons()).toContain("session_flatten");
  });

  it("stops for the day and closes positions on max daily loss", async () => {
    const c = setup();
    await c.tick();
    await c.sim.batchUpdate({ marketId: M, cancelOrderHashes: [], create: [{ side: "buy", price: "99.5", quantity: "0.3", postOnly: true, reduceOnly: false, cid: "seed" }], feeRecipient: c.sim.address });
    c.sim.takerTrade(M, "sell", "0.3");
    c.sim.availableQuote = c.sim.availableQuote.minus(60);
    const r = await c.tick();
    expect(r.outcome).toBe("halted");
    expect(c.sim.calls.closePositionReduceOnly).toBe(1);
    expect(c.open()).toHaveLength(0);
    await c.tick();
    expect(c.sim.calls.closePositionReduceOnly).toBe(1);
    expect(c.sink.guards.find((g) => g.reason === "risk_daily_loss")).toMatchObject({ marketId: null, guard: "risk" });
  });

  it("goes reduce-only above max net notional", async () => {
    const c = setup({ params: { maxNetNotionalUsd: 30, inventoryCapUsd: 200 } });
    await c.sim.batchUpdate({ marketId: M, cancelOrderHashes: [], create: [{ side: "buy", price: "99.5", quantity: "0.5", postOnly: true, reduceOnly: false, cid: "seed" }], feeRecipient: c.sim.address });
    c.sim.takerTrade(M, "sell", "0.5");
    const r = await c.tick();
    expect(r.mode).toBe("reduce_only");
    const created = c.sim.landed.at(-1)!.create;
    expect(created.every((o) => o.side === "sell" && o.reduceOnly)).toBe(true);
  });
});

describe("fills", () => {
  it("records fills, updates kappa and skews the next quotes against the new inventory", async () => {
    const c = setup();
    await c.tick();
    const before = c.sink.quotes.find((q) => q.side === "sell" && q.level === 0)!.price;
    const kappaBefore = c.quoter.kappa;
    const unsub = c.sim.onFill((f) => c.quoter.handleFill(f));
    c.sim.takerTrade(M, "sell", "1.187"); // sweeps all three bids
    unsub();
    expect(c.sink.fills).toHaveLength(3);
    expect(c.sink.fills[0]).toMatchObject({ side: "buy", isMaker: true, agentId: 1, provenance: "SIMULATED" });
    expect(c.quoter.kappa).not.toBe(kappaBefore);
    await c.tick();
    const after = c.sim.openOrders(M).filter((o) => o.side === "sell").map((o) => Number(o.price));
    expect(Math.min(...after)).toBeLessThan(Number(before));
  });
});

describe("fill keys", () => {
  it("uses the trade ID as the fill key when the adapter has no tx hash (indexer convention)", () => {
    const c = setup();
    c.quoter.handleFill({ marketId: M, orderHash: "0xabc", tradeId: "147700000_3", txHash: "", eventIndex: 3, side: "buy", price: "100", quantity: "0.1", fee: "0.01", isMaker: true, counterpartySubaccountId: null, executedAtMs: T0 });
    expect(c.sink.fills[0]).toMatchObject({ tradeId: "147700000_3", txHash: "147700000_3", eventIndex: 3 });
  });
});

describe("quoteCid", () => {
  it("tags the quote level as -L<n>- and fits the 36 char Injective cid limit", () => {
    const cid = quoteCid("strata-test-1", M, 2, 123_456, 4);
    expect(cid).toMatch(/-L2-/);
    expect(cid).toMatch(/^[A-Za-z0-9_-]{1,36}$/);
    expect(cid.startsWith("strata-test-1-aaaaaa-")).toBe(true);
  });

  it("stays within 36 chars for long names and huge sequence numbers", () => {
    const cid = quoteCid("a-very-long-agent-name-that-overflows", M, 11, Number.MAX_SAFE_INTEGER, 9);
    expect(cid.length).toBeLessThanOrEqual(36);
    expect(cid).toMatch(/-L11-/);
  });

  it("is what the quoter sends, so every created order carries its level", async () => {
    const c = setup();
    const spy = vi.spyOn(c.sim, "batchUpdate");
    await c.tick();
    const cids = spy.mock.calls.flatMap(([u]) => u.create.map((o) => o.cid));
    expect(cids.length).toBeGreaterThan(0);
    for (const cid of cids) expect(cid).toMatch(/-L\d+-/);
  });
});

describe("chaos: cancel-on-uncertainty and no duplicate orders", () => {
  it("tx lands but the response is lost: cancels, waits, reconciles, never duplicates", async () => {
    const c = setup();
    await c.tick();
    c.sim.setBook(M, [{ price: "100.4", quantity: "10" }], [{ price: "100.6", quantity: "10" }]);
    c.setOraclePrice("100.5");
    c.sim.injectFault("batchUpdate", "apply_then_throw");
    const r = await c.tick();
    expect(r.outcome).toBe("uncertain");
    expect(c.open()).toHaveLength(0);
    expect(c.sink.reasons()).toContain("data_unavailable");
    const batchesBefore = c.sim.calls.batchUpdate;
    for (let i = 0; i < 5; i++) expect((await c.tick()).outcome).toBe("uncertain");
    expect(c.sim.calls.batchUpdate).toBe(batchesBefore);
    const resumed = await c.tick(1_500);
    expect(resumed.outcome).toBe("quoted");
    expect(c.open()).toHaveLength(6);
    expect(c.sim.maxOpenOrders.get(M)).toBeLessThanOrEqual(6);
    assertNoDuplicates(c.open());
    expect(c.sink.reasons().filter((x) => x === "data_unavailable")).toHaveLength(1);
  });

  it("tx lands late inside the settle window: the late orders are cancelled, never doubled", async () => {
    const c = setup();
    await c.tick();
    c.sim.setBook(M, [{ price: "100.4", quantity: "10" }], [{ price: "100.6", quantity: "10" }]);
    c.setOraclePrice("100.5");
    c.sim.injectFault("batchUpdate", "land_later", 3_500);
    expect((await c.tick()).outcome).toBe("uncertain");
    const outcomes: string[] = [];
    for (let i = 0; i < 8; i++) {
      outcomes.push((await c.tick()).outcome);
      assertNoDuplicates(c.open());
    }
    expect(c.sim.pendingCount).toBe(0);
    expect(outcomes).toContain("quoted");
    expect(c.sim.maxOpenOrders.get(M)).toBeLessThanOrEqual(6);
    assertNoDuplicates(c.open());
  });

  it("a tx that lands after the settle window is removed by the next diff", async () => {
    const c = setup();
    await c.tick();
    c.sim.setBook(M, [{ price: "100.4", quantity: "10" }], [{ price: "100.6", quantity: "10" }]);
    c.setOraclePrice("100.5");
    c.sim.injectFault("batchUpdate", "land_later", 9_000);
    await c.tick();
    for (let i = 0; i < 12; i++) await c.tick();
    assertNoDuplicates(c.open());
    expect(c.open()).toHaveLength(6);
  });

  it("market state read fails: cancels all and recovers after settle", async () => {
    const c = setup();
    await c.tick();
    c.sim.injectFault("getMarketState", "throw");
    expect((await c.tick()).outcome).toBe("uncertain");
    expect(c.open()).toHaveLength(0);
    for (let i = 0; i < 6; i++) await c.tick();
    expect(c.open()).toHaveLength(6);
    assertNoDuplicates(c.open());
  });

  it("stays uncertain while cancelAll itself keeps failing", async () => {
    const c = setup();
    await c.tick();
    c.sim.injectFault("getOpenOrders", "throw");
    c.sim.injectFault("cancelAll", "throw");
    expect((await c.tick()).outcome).toBe("uncertain");
    c.sim.injectFault("cancelAll", "throw");
    expect((await c.tick()).outcome).toBe("uncertain");
    for (let i = 0; i < 7; i++) await c.tick();
    expect(c.open()).toHaveLength(6);
    assertNoDuplicates(c.open());
  });

  it("restart: a new process reconciles orders left by the old one before quoting", async () => {
    const first = setup();
    await first.tick();
    expect(first.open()).toHaveLength(6);
    // the old process dies; a new one starts against the same exchange
    const restarted = setup({ sim: first.sim, startUncertain: true });
    expect(restarted.quoter.uncertain).toBe(true);
    expect((await restarted.tick()).outcome).toBe("uncertain");
    expect(restarted.open()).toHaveLength(0);
    for (let i = 0; i < 6; i++) await restarted.tick();
    expect(restarted.open()).toHaveLength(6);
    expect(first.sim.maxOpenOrders.get(M)).toBeLessThanOrEqual(6);
    assertNoDuplicates(restarted.open());
  });

  it("treats a hung adapter call as uncertainty via the call timeout", async () => {
    const sim = new SimExchange({
      chainTimeMs: T0,
      markets: [{ marketId: M, bids: [{ price: "99.9", quantity: "10" }], asks: [{ price: "100.1", quantity: "10" }], oraclePrice: "100" }],
    });
    const hung: ExchangeAdapter = {
      network: sim.network,
      subaccountId: sim.subaccountId,
      address: sim.address,
      getMarketState: () => new Promise(() => undefined),
      getOpenOrders: (id) => sim.getOpenOrders(id),
      batchUpdate: (u) => sim.batchUpdate(u),
      cancelAll: (id) => sim.cancelAll(id),
      closePositionReduceOnly: (id) => sim.closePositionReduceOnly(id),
      onFill: (h) => sim.onFill(h),
    };
    const c = setup({ sim, adapter: hung, callTimeoutMs: 20 });
    expect((await c.quoter.runCycle()).outcome).toBe("uncertain");
    expect(sim.calls.cancelAll).toBe(1);
  });

  it("property-style soak: random faults never produce more than one order per side and price", async () => {
    const c = setup();
    const faults = ["throw", "apply_then_throw", "land_later"] as const;
    const methods = ["batchUpdate", "getMarketState", "getOpenOrders", "cancelAll"] as const;
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let i = 0; i < 200; i++) {
      if (rnd() < 0.15) c.sim.injectFault(methods[Math.floor(rnd() * methods.length)]!, faults[Math.floor(rnd() * faults.length)]!, Math.floor(rnd() * 4_000));
      if (rnd() < 0.3) {
        const mid = 100 + (rnd() - 0.5) * 0.6;
        c.sim.setBook(M, [{ price: (mid - 0.1).toFixed(2), quantity: "10" }], [{ price: (mid + 0.1).toFixed(2), quantity: "10" }]);
        c.setOraclePrice(mid.toFixed(2));
      }
      await c.tick();
      const open = c.open();
      const keys = open.map((o) => `${o.side}@${o.price}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("kill switch in the loop", () => {
  it("cancels all, closes reduce-only, and never quotes again", async () => {
    const c = setup();
    await c.tick();
    await c.sim.batchUpdate({ marketId: M, cancelOrderHashes: [], create: [{ side: "buy", price: "99.5", quantity: "0.2", postOnly: true, reduceOnly: false, cid: "seed" }], feeRecipient: c.sim.address });
    c.sim.takerTrade(M, "sell", "0.2");
    c.killSwitch.trigger({ target: "all", closePositions: true, source: "api", at: 1 });
    const r = await c.tick();
    expect(r.outcome).toBe("killed");
    expect(c.open()).toHaveLength(0);
    expect(c.sim.position(M)).toBe("0");
    const batches = c.sim.calls.batchUpdate;
    await c.tick();
    await c.tick();
    expect(c.sim.calls.batchUpdate).toBe(batches);
    expect(c.sink.reasons().filter((x) => x === "kill_switch_api")).toHaveLength(1);
  });

  it("cancels orders from a tx that lands after the kill", async () => {
    const c = setup();
    await c.tick();
    c.sim.setBook(M, [{ price: "100.4", quantity: "10" }], [{ price: "100.6", quantity: "10" }]);
    c.setOraclePrice("100.5");
    c.sim.injectFault("batchUpdate", "land_later", 1_500);
    await c.tick();
    c.killSwitch.trigger({ target: "all", closePositions: false, source: "telegram", at: 1 });
    for (let i = 0; i < 4; i++) await c.tick();
    expect(c.open()).toHaveLength(0);
    expect(c.sim.calls.closePositionReduceOnly).toBe(0);
  });

  it("retries the kill cancel when it fails", async () => {
    const c = setup();
    await c.tick();
    c.killSwitch.trigger({ target: "all", closePositions: false, source: "env", at: 1 });
    c.sim.injectFault("cancelAll", "throw");
    expect((await c.tick()).outcome).toBe("killed");
    expect(c.open()).toHaveLength(6);
    await c.tick();
    expect(c.open()).toHaveLength(0);
  });
});

describe("diffOrders", () => {
  const live = (hash: string, side: "buy" | "sell", price: string, quantity: string, filled = "0"): LiveOrder => ({ orderHash: hash, side, price, quantity, filled, createdAtMs: 0 });
  const want = (side: "buy" | "sell", price: string, quantity: string, level = 0) => ({ side, price, quantity, level, reduceOnly: false });

  it("keeps matching orders, cancels the rest, creates the missing ones", () => {
    const d = diffOrders(
      [want("buy", "99.9", "1"), want("sell", "100.1", "1"), want("sell", "100.2", "1.5", 1)],
      [live("a", "buy", "99.90", "1"), live("b", "sell", "100.1", "3"), live("c", "buy", "99.8", "1")],
      10,
    );
    expect(d.keep.map((o) => o.orderHash)).toEqual(["a"]);
    expect([...d.cancel].sort()).toEqual(["b", "c"]);
    expect(d.create.map((q) => q.price)).toEqual(["100.1", "100.2"]);
  });

  it("replaces a mostly-filled order and cancels duplicates at the same price", () => {
    const d = diffOrders([want("buy", "99.9", "1")], [live("a", "buy", "99.9", "1", "0.7"), live("b", "buy", "99.9", "1"), live("c", "buy", "99.9", "1")], 10);
    expect(d.keep.map((o) => o.orderHash)).toEqual(["b"]);
    expect([...d.cancel].sort()).toEqual(["a", "c"]);
  });

  it("respects a zero budget", () => {
    expect(diffOrders([want("buy", "1", "1")], [], 0).create).toEqual([]);
  });
});

describe("AgentRunner", () => {
  it("runs loops, routes fills, and cancels everything on shutdown", async () => {
    const c = setup();
    let sleeps = 0;
    const runner = new AgentRunner({
      adapter: c.sim,
      quoters: [c.quoter],
      killSwitch: c.killSwitch,
      sleep: async () => {
        sleeps++;
        await new Promise((r) => setImmediate(r));
      },
    });
    runner.start();
    await vi.waitFor(() => expect(c.open()).toHaveLength(6));
    c.sim.takerTrade(M, "sell", "0.1");
    expect(c.sink.fills).toHaveLength(1);
    await runner.shutdown();
    expect(sleeps).toBeGreaterThan(0);
    expect(c.open()).toHaveLength(0);
    c.sim.takerTrade(M, "sell", "0.1");
    expect(c.sink.fills).toHaveLength(1);
  });

  it("cancels every market immediately when the kill switch fires", async () => {
    const c = setup();
    await c.tick();
    const runner = new AgentRunner({ adapter: c.sim, quoters: [c.quoter], killSwitch: c.killSwitch, sleep: () => new Promise(() => undefined) });
    runner.start();
    c.killSwitch.trigger({ target: "all", closePositions: false, source: "telegram", at: 1 });
    await vi.waitFor(() => expect(c.open()).toHaveLength(0));
  });

  it("reports markets it could not cancel on shutdown and survives cycle errors", async () => {
    const c = setup();
    await c.tick();
    const errors: string[] = [];
    const broken = { ...c.sim, cancelAll: async () => Promise.reject(new Error("down")), onFill: () => () => undefined } as unknown as ExchangeAdapter;
    const quoter = Object.assign(Object.create(Object.getPrototypeOf(c.quoter)), c.quoter) as MarketQuoter;
    vi.spyOn(quoter, "runCycle").mockRejectedValue(new Error("boom"));
    Object.defineProperty(quoter, "marketId", { value: M });
    let calls = 0;
    const runner = new AgentRunner({
      adapter: broken,
      quoters: [quoter],
      killSwitch: c.killSwitch,
      sleep: async () => {
        calls++;
        await new Promise((r) => setImmediate(r));
      },
      onCycleError: (_m, e) => errors.push((e as Error).message),
    });
    runner.start();
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
    await expect(runner.shutdown()).rejects.toThrow(/cancelAll failed on 1 market/);
    expect(calls).toBeGreaterThan(0);
  });
});

describe("quoter stats for the tuner", () => {
  it("reports volatility, inventory, fills, markouts and recent guard reasons", async () => {
    const c = setup();
    expect(c.quoter.stats(60_000)).toMatchObject({ fair: null, sessionState: null, markoutsBps: null, fills: { buy: 0, sell: 0 } });
    await c.tick();
    const unsub = c.sim.onFill((f) => c.quoter.handleFill(f));
    c.sim.takerTrade(M, "sell", "0.25");
    unsub();
    await c.tick(2_000);
    c.stopOracle();
    await c.tick(31_000);
    const s = c.quoter.stats(15 * 60_000);
    expect(s.fills).toEqual({ buy: 1, sell: 0 });
    expect(s.inventoryBase).toBeCloseTo(0.25, 10);
    expect(s.sessionState).toBe("always_open");
    expect(s.markoutsBps?.s1).not.toBeNull();
    expect(s.recentGuardReasons).toContain("oracle_stale");
    expect(s.sigmaBps).toBeGreaterThan(0);
  });
});

describe("security review fixes in the loop", () => {
  it("halts when the node's chain time lags the wall clock (M-3)", async () => {
    const c = setup();
    await c.tick();
    c.setWallClockSkew(60_000);
    const r = await c.tick();
    expect(r.outcome).toBe("halted");
    expect(c.open()).toHaveLength(0);
    expect(c.sink.guards.find((g) => g.reason === "data_unavailable")).toMatchObject({ guard: "oracle", observed: { chainLagSec: 60 } });
  });

  it("widens spreads when the reference policy is widen and no reference arrives (L-3)", async () => {
    const base = setup({ params: { levels: 1 } });
    await base.tick();
    const widened = setup({ params: { levels: 1, referencePolicy: "widen" } });
    await widened.tick();
    const spread = (c: ReturnType<typeof setup>) => {
      const o = c.open();
      return Number(o.find((x) => x.side === "sell")!.price) - Number(o.find((x) => x.side === "buy")!.price);
    };
    expect(spread(widened)).toBeGreaterThan(spread(base) * 1.8);
    expect(widened.sink.reasons()).toContain("oracle_source_divergence");
  });

  it("keeps the market uncertain for at least the adapter's tx timeout (L-4)", async () => {
    const c = setup();
    c.sim.txTimeoutMs = 20_000;
    await c.tick();
    c.sim.injectFault("batchUpdate", "apply_then_throw");
    c.sim.setBook(M, [{ price: "100.4", quantity: "10" }], [{ price: "100.6", quantity: "10" }]);
    c.setOraclePrice("100.5");
    expect((await c.tick()).outcome).toBe("uncertain");
    for (let i = 0; i < 20; i++) expect((await c.tick()).outcome).toBe("uncertain");
    for (let i = 0; i < 3; i++) await c.tick();
    expect(c.open()).toHaveLength(6);
  });

  it("retries the kill close until the position is flat on a thin book (M-2)", async () => {
    const c = setup();
    await c.tick();
    c.sim.closeFillFraction = 0.5;
    await c.sim.batchUpdate({ marketId: M, cancelOrderHashes: [], create: [{ side: "buy", price: "99.5", quantity: "0.8", postOnly: true, reduceOnly: false, cid: "seed" }], feeRecipient: c.sim.address });
    c.sim.takerTrade(M, "sell", "0.8");
    c.killSwitch.trigger({ target: "all", closePositions: true, source: "api", at: 1 });
    for (let i = 0; i < 12; i++) await c.tick();
    expect(Number(c.sim.position(M))).toBeLessThan(0.001);
    const attempts = c.sim.calls.closePositionReduceOnly;
    expect(attempts).toBeGreaterThan(1);
    expect(c.sink.guards.filter((g) => g.detail.includes("left")).length).toBeGreaterThan(0);
    await c.tick();
    expect(c.sim.calls.closePositionReduceOnly).toBe(attempts);
  });

  it("gives up after the attempt limit and says manual action is needed (M-2)", async () => {
    const c = setup();
    await c.tick();
    c.sim.closeFillFraction = 0;
    await c.sim.batchUpdate({ marketId: M, cancelOrderHashes: [], create: [{ side: "buy", price: "99.5", quantity: "0.3", postOnly: true, reduceOnly: false, cid: "seed" }], feeRecipient: c.sim.address });
    c.sim.takerTrade(M, "sell", "0.3");
    c.sim.availableQuote = c.sim.availableQuote.minus(60);
    for (let i = 0; i < 30; i++) await c.tick();
    expect(c.sim.calls.closePositionReduceOnly).toBe(20);
    expect(c.sink.guards.some((g) => /manual/i.test(g.detail))).toBe(true);
  });

  it("a restarted agent restores a season stop and stays halted (H-2)", async () => {
    const c = setup();
    await c.tick();
    c.sim.availableQuote = c.sim.availableQuote.minus(200);
    expect((await c.tick()).outcome).toBe("halted");
    expect(c.risk.state.stoppedForSeason).toBe(true);
    c.sim.availableQuote = c.sim.availableQuote.plus(500);
    const restarted = setup({ sim: c.sim, initialRisk: { ...c.risk.state } });
    for (let i = 0; i < 8; i++) expect((await restarted.tick()).outcome).not.toBe("quoted");
    expect(restarted.open()).toHaveLength(0);
  });

  it("notifies on every risk state change so it can be persisted (H-2)", async () => {
    const changes: RiskState[] = [];
    const c = setup();
    c.risk.onChange((s) => changes.push(s));
    await c.tick();
    expect(changes).toHaveLength(1);
    await c.tick();
    expect(changes).toHaveLength(1);
    c.sim.availableQuote = c.sim.availableQuote.minus(60);
    await c.tick();
    expect(changes.at(-1)!.stoppedForDay).toBe(true);
  });
});

describe("unhealthy testnet books", () => {
  const staleBook = () => ({ bids: [{ price: "60", quantity: "5" }], asks: [{ price: "250", quantity: "5" }] });

  it("widen: keeps quoting at double spread and records one widen event, not one per cycle", async () => {
    const base = setup({ params: { levels: 1 } });
    await base.tick();
    const c = setup({ params: { levels: 1, unhealthyBookPolicy: "widen" } });
    const b = staleBook();
    c.sim.setBook(M, b.bids, b.asks);
    for (let i = 0; i < 5; i++) expect(["quoted", "unchanged"]).toContain((await c.tick()).outcome);
    const spread = (x: ReturnType<typeof setup>) => {
      const o = x.open();
      return Number(o.find((q) => q.side === "sell")!.price) - Number(o.find((q) => q.side === "buy")!.price);
    };
    expect(spread(c)).toBeGreaterThan(spread(base) * 1.8);
    const widen = c.sink.guards.filter((g) => g.reason === "oracle_book_deviation");
    expect(widen).toHaveLength(1);
    expect(widen[0]).toMatchObject({ action: "widen", observed: { reason: "no_bids_in_band", bookHealthy: false } });
    expect(c.sink.guards.some((g) => g.action === "halt")).toBe(false);
  });

  it("halt (mainnet default): pulls quotes on the same book", async () => {
    const c = setup({ params: { levels: 1 } });
    const b = staleBook();
    c.sim.setBook(M, b.bids, b.asks);
    expect((await c.tick()).outcome).toBe("halted");
    expect(c.open()).toHaveLength(0);
  });

  it("stale far-away levels do not move fair value when a healthy band exists", async () => {
    const c = setup({ params: { levels: 1 } });
    c.sim.setBook(M, [{ price: "99.9", quantity: "10" }, { price: "40", quantity: "500" }], [{ price: "100.1", quantity: "10" }, { price: "400", quantity: "500" }]);
    expect((await c.tick()).outcome).toBe("quoted");
    const o = c.open();
    expect(Number(o.find((q) => q.side === "buy")!.price)).toBeCloseTo(99.9, 1);
  });
});
