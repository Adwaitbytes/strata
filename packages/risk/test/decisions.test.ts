import { describe, expect, it } from "vitest";
import { GuardEvent } from "@strata/sdk";
import { mostSevere, toGuardEvent, type GuardDecision } from "../src/decisions.js";

const MARKET = `0x${"ab".repeat(32)}`;

describe("decisions", () => {
  const decision: GuardDecision = {
    guard: "oracle",
    action: "halt",
    reason: "oracle_stale",
    detail: "Oracle report is 41 s old, limit is 30 s.",
    observed: { oracleAgeSec: 41, limit: 30 },
  };

  it("maps a decision to a schema-valid GuardEvent", () => {
    const event = toGuardEvent(decision, {
      network: "testnet",
      provenance: "TESTNET",
      agentId: 7,
      marketId: MARKET,
      id: "evt-1",
      at: 1_700_000_000_000,
    });
    expect(GuardEvent.parse(event)).toEqual(event);
    expect(event).toMatchObject({ guard: "oracle", action: "halt", reason: "oracle_stale", agentId: 7, marketId: MARKET });
  });

  it("orders actions by severity", () => {
    expect(mostSevere([])).toBe("ok");
    expect(mostSevere(["ok", "widen", "reduce"])).toBe("reduce");
    expect(mostSevere(["flatten", "halt", "widen"])).toBe("halt");
    expect(mostSevere(["resume", "ok"])).toBe("resume");
    expect(mostSevere(["resume", "widen"])).toBe("widen");
  });
});
