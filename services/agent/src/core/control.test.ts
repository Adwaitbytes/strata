import { describe, expect, it, vi } from "vitest";
import type { GuardEvent } from "@strata/sdk";
import { DEFAULT_PARAMS, INITIAL_RISK_STATE } from "@strata/risk";
import { KillSwitch } from "./killSwitch.js";
import { HeartbeatWriter, KillCommandPoller, heartbeatDetail } from "./control.js";
import { MemoryAgentStateStore, StatePersister, persistable, riskStateFrom } from "./persistence.js";
import type { KillCommandFeed, KillCommandRow } from "./persistence.js";

const identity = { agentId: 7, agentName: "strata-test-1", network: "testnet" as const, provenance: "TESTNET" as const };

describe("KillCommandPoller", () => {
  function make(rows: KillCommandRow[]) {
    const feed: KillCommandFeed = { pending: vi.fn(async () => rows.filter((r) => !acked.has(r.id))) };
    const acked = new Set<string>();
    const guards: GuardEvent[] = [];
    const ks = new KillSwitch(identity);
    const poller = new KillCommandPoller({
      feed,
      killSwitch: ks,
      identity,
      sink: {
        guard: (e) => {
          guards.push(e);
          acked.add(String(e.observed["killCommandId"]));
        },
      },
      now: () => 1_000,
      ids: () => `id-${guards.length}`,
      intervalMs: 1_000,
    });
    return { feed, guards, ks, poller };
  }

  it("latches the kill switch and acknowledges each command once with a kill_switch_api guard event", async () => {
    const { guards, ks, poller } = make([
      { id: "k1", targetAgentId: null, closePositions: false, requestedAt: 1 },
      { id: "k2", targetAgentId: 7, closePositions: true, requestedAt: 2 },
    ]);
    expect(await poller.pollOnce()).toBe(2);
    expect(ks.state).toMatchObject({ killed: true, source: "api", closePositions: true });
    expect(guards.map((g) => [g.reason, g.observed["killCommandId"], g.guard, g.action])).toEqual([
      ["kill_switch_api", "k1", "kill_switch", "halt"],
      ["kill_switch_api", "k2", "kill_switch", "halt"],
    ]);
    expect(await poller.pollOnce()).toBe(0);
  });

  it("ignores commands for other agents even if the feed returns them", async () => {
    const { ks, guards, poller } = make([{ id: "k3", targetAgentId: 99, closePositions: false, requestedAt: 1 }]);
    await poller.pollOnce();
    expect(ks.state.killed).toBe(false);
    expect(guards).toHaveLength(0);
  });

  it("polls on an interval, reports feed errors, and never overlaps polls", async () => {
    vi.useFakeTimers();
    try {
      const errors: unknown[] = [];
      const ks = new KillSwitch(identity);
      let calls = 0;
      const poller = new KillCommandPoller({
        feed: {
          pending: async () => {
            calls++;
            if (calls === 1) throw new Error("db down");
            await new Promise((r) => setTimeout(r, 5_000));
            return [];
          },
        },
        killSwitch: ks,
        identity,
        sink: { guard: () => undefined },
        now: () => 0,
        ids: () => "x",
        intervalMs: 1_000,
      });
      poller.start((e) => errors.push(e));
      poller.start();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(errors).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(calls).toBe(2);
      poller.notify();
      poller.stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("heartbeat", () => {
  it("publishes scalar limits and capital for the transparency page (W6 contract)", () => {
    const d = heartbeatDetail({
      name: "strata-test-1",
      capitalUsd: 1000,
      params: DEFAULT_PARAMS,
      tickers: ["BTC/USDC PERP"],
      killed: false,
      risk: INITIAL_RISK_STATE,
      tunerMode: "shadow",
      provenance: "TESTNET",
    });
    expect(d.capitalUsd).toBe(1000);
    expect(d.limits).toMatchObject({ maxDailyLossUsd: 50, maxDrawdownUsd: 150, referencePolicy: "none", offHoursQuoting: false });
    for (const v of Object.values(d.limits)) expect(["number", "string", "boolean"]).toContain(typeof v);
    expect(d).toMatchObject({ markets: ["BTC/USDC PERP"], stoppedForSeason: false, tunerMode: "shadow" });
  });

  it("writes agent:<id> on an interval and reports failures", async () => {
    vi.useFakeTimers();
    try {
      const writes: [string, string][] = [];
      const errors: unknown[] = [];
      let fail = true;
      const hb = new HeartbeatWriter({
        sink: {
          write: async (network, service) => {
            if (fail) {
              fail = false;
              throw new Error("db");
            }
            writes.push([network, service]);
          },
        },
        network: "testnet",
        agentId: 7,
        now: () => 5,
        detail: () => ({ ok: true }),
        intervalMs: 15_000,
      });
      hb.start((e) => errors.push(e));
      hb.start();
      await vi.advanceTimersByTimeAsync(1);
      expect(errors).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(writes).toEqual([["testnet", "agent:7"]]);
      hb.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(writes).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("persistence", () => {
  it("round-trips risk and kill state", async () => {
    const store = new MemoryAgentStateStore();
    const state = persistable({ ...INITIAL_RISK_STATE, stoppedForSeason: true, peakEquityUsd: 1200, orderTimesMs: [1, 2] }, { killed: true, closePositions: false, source: "telegram", at: 3 });
    await store.save("testnet", 7, state, 0);
    const loaded = await store.load("testnet", 7);
    expect(loaded).toEqual(state);
    expect(riskStateFrom(loaded!)).toMatchObject({ stoppedForSeason: true, peakEquityUsd: 1200, orderTimesMs: [] });
    expect(await store.load("mainnet", 7)).toBeNull();
  });

  it("StatePersister writes only changes, serializes writes and retries after a failure", async () => {
    const saves: string[] = [];
    let failNext = false;
    const errors: unknown[] = [];
    const store = {
      load: async () => null,
      save: async (_n: string, _a: number, s: { risk: { peakEquityUsd: number | null } }) => {
        await new Promise((r) => setImmediate(r));
        if (failNext) {
          failNext = false;
          throw new Error("db down");
        }
        saves.push(String(s.risk.peakEquityUsd));
      },
    };
    const base = persistable(INITIAL_RISK_STATE, { killed: false, closePositions: false, source: null, at: null });
    const p = new StatePersister(store, "testnet", 7, () => 0, (e) => errors.push(e), base);
    p.update(base);
    await p.flush();
    expect(saves).toEqual([]);
    p.update({ ...base, risk: { ...base.risk, peakEquityUsd: 1 } });
    p.update({ ...base, risk: { ...base.risk, peakEquityUsd: 2 } });
    await p.flush();
    expect(saves).toEqual(["1", "2"]);
    failNext = true;
    p.update({ ...base, risk: { ...base.risk, peakEquityUsd: 3 } });
    await p.flush();
    expect(errors).toHaveLength(1);
    await p.flush();
    expect(saves).toEqual(["1", "2", "3"]);
    const fresh = new StatePersister(store, "testnet", 7, () => 0, () => undefined, null);
    fresh.update(base);
    await fresh.flush();
    expect(saves).toHaveLength(4);
  });
});

describe("kill switch restore", () => {
  it("starts latched from persisted state and does not fire listeners again", () => {
    const ks = new KillSwitch(identity, { killed: true, closePositions: true, source: "telegram", at: 5 });
    const l = vi.fn();
    ks.onKill(l);
    ks.trigger({ target: "all", closePositions: false, source: "api", at: 9 });
    expect(l).not.toHaveBeenCalled();
    expect(ks.state).toMatchObject({ killed: true, source: "telegram", at: 5 });
    expect(ks.decision()!.detail).not.toMatch(/positions closed/);
  });
});
