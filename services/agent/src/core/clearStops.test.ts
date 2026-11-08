import { describe, expect, it } from "vitest";
import { INITIAL_RISK_STATE } from "@strata/risk";
import { clearStops, parseClearStopsArgs } from "./clearStops.js";
import { MemoryAgentStateStore, persistable } from "./persistence.js";

describe("clear-stops (human-only resume, review H-2)", () => {
  it("parses arguments and requires --confirm", () => {
    expect(parseClearStopsArgs(["--network", "testnet", "--agent-id", "3", "--confirm", "--kill", "--season"])).toEqual({ network: "testnet", agentId: 3, kill: true, season: true, day: false });
    expect(() => parseClearStopsArgs(["--network", "testnet", "--agent-id", "3", "--season"])).toThrow(/--confirm/);
    expect(() => parseClearStopsArgs(["--network", "devnet", "--agent-id", "3", "--confirm", "--season"])).toThrow();
    expect(() => parseClearStopsArgs(["--network", "testnet", "--agent-id", "3", "--confirm"])).toThrow(/at least one/);
  });

  it("clears only the requested stops and re-baselines the peak after a season stop", async () => {
    const store = new MemoryAgentStateStore();
    await store.save("testnet", 3, persistable({ ...INITIAL_RISK_STATE, stoppedForSeason: true, stoppedForDay: true, peakEquityUsd: 900 }, { killed: true, closePositions: true, source: "telegram", at: 1 }));
    const before = await clearStops(store, { network: "testnet", agentId: 3, kill: false, season: true, day: false }, 5);
    expect(before.risk.stoppedForSeason).toBe(true);
    const after = (await store.load("testnet", 3))!;
    expect(after.risk).toMatchObject({ stoppedForSeason: false, stoppedForDay: true, peakEquityUsd: null });
    expect(after.kill.killed).toBe(true);
    await clearStops(store, { network: "testnet", agentId: 3, kill: true, season: false, day: true }, 6);
    expect((await store.load("testnet", 3))!).toMatchObject({ kill: { killed: false, source: null }, risk: { stoppedForDay: false } });
  });

  it("fails when there is no stored state", async () => {
    await expect(clearStops(new MemoryAgentStateStore(), { network: "testnet", agentId: 9, kill: true, season: false, day: false }, 0)).rejects.toThrow(/no stored state/);
  });
});
