import { describe, expect, it } from "vitest";
import { ScoreFlag } from "@strata/sdk";
import { DEFAULT_ANTI_GAMING_PARAMS, detectAbuse, flagNames, subaccountOwner, type AbuseInput } from "./antiGaming.js";
import type { AgentRecord, FillRecord, OrderRecord } from "./model.js";

const MKT = "0x" + "11".repeat(32);
const T0 = 1_700_000_000_000;
const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const sub = (n: number, nonce = 0) => addr(n) + nonce.toString(16).padStart(24, "0");

function agent(agentId: number, trader: number, operator: number, p: Partial<AgentRecord> = {}): AgentRecord {
  return { agentId, operator: addr(operator), subaccountId: sub(trader), status: "active", marketIds: [MKT], simulated: false, enrolledAt: 0, ...p };
}

function fill(id: string, agentId: number, counterparty: string | null): FillRecord {
  return { id, agentId, marketId: MKT, orderHash: "o", side: "buy", price: 1, quantity: 1, feeUsd: 0, isMaker: true, counterpartySubaccountId: counterparty, executedAt: T0 };
}

function input(p: Partial<AbuseInput>): AbuseInput {
  return {
    agents: [],
    fills: [],
    orders: [],
    fundingEdges: [],
    coverage: new Map(),
    params: DEFAULT_ANTI_GAMING_PARAMS,
    ...p,
  };
}

describe("subaccountOwner", () => {
  it("takes the 20-byte trader address prefix, lowercased", () => {
    expect(subaccountOwner("0xAB" + "00".repeat(19) + "00".repeat(11) + "01")).toBe("0xab" + "00".repeat(19));
  });
});

describe("detectAbuse", () => {
  const a1 = agent(1, 0x10, 0x10);
  const a2 = agent(2, 0x20, 0x20);

  it("flags nothing for an arms-length fill against an unrelated account", () => {
    const r = detectAbuse(input({ agents: [a1, a2], fills: [fill("f1", 1, sub(0x99))], coverage: new Map([[1, 1], [2, 1]]) }));
    expect(r.flags.get(1)).toBe(0);
    expect(r.excludedFillIds.size).toBe(0);
  });

  it("flags SELF_TRADE and excludes the fill when the counterparty is another subaccount of the same trader", () => {
    const r = detectAbuse(input({ agents: [a1], fills: [fill("f1", 1, sub(0x10, 3))], coverage: new Map([[1, 1]]) }));
    expect(r.flags.get(1)).toBe(ScoreFlag.SELF_TRADE);
    expect(r.excludedFillIds.has("f1")).toBe(true);
    expect(r.evidence[0]!.flag).toBe("SELF_TRADE");
  });

  it("flags WASH when two agents share an operator and trade with each other", () => {
    const b1 = agent(1, 0x10, 0x77);
    const b2 = agent(2, 0x20, 0x77);
    const r = detectAbuse(input({ agents: [b1, b2], fills: [fill("f1", 1, b2.subaccountId), fill("f2", 2, b1.subaccountId)], coverage: new Map([[1, 1], [2, 1]]) }));
    expect(r.flags.get(1)).toBe(ScoreFlag.WASH);
    expect(r.flags.get(2)).toBe(ScoreFlag.WASH);
    expect([...r.excludedFillIds].sort()).toEqual(["f1", "f2"]);
  });

  it("flags WASH when the counterparty is the operator wallet itself", () => {
    const b1 = agent(1, 0x10, 0x77);
    const r = detectAbuse(input({ agents: [b1], fills: [fill("f1", 1, sub(0x77, 1))], coverage: new Map([[1, 1]]) }));
    expect(r.flags.get(1)).toBe(ScoreFlag.WASH);
  });

  it("flags WASH when both sides were funded from the same source within N hops", () => {
    const fundingEdges = [
      { from: addr(0x500), to: addr(0x501), at: 0 },
      { from: addr(0x501), to: addr(0x10), at: 1 },
      { from: addr(0x500), to: addr(0x99), at: 2 },
    ];
    const r = detectAbuse(input({ agents: [a1], fills: [fill("f1", 1, sub(0x99))], fundingEdges, coverage: new Map([[1, 1]]) }));
    expect(r.flags.get(1)).toBe(ScoreFlag.WASH);
    const tooFar = detectAbuse(
      input({ agents: [a1], fills: [fill("f1", 1, sub(0x99))], fundingEdges, coverage: new Map([[1, 1]]), params: { ...DEFAULT_ANTI_GAMING_PARAMS, fundingHops: 1 } }),
    );
    expect(tooFar.flags.get(1)).toBe(0);
  });

  it("does not link accounts through a hub funder such as a faucet", () => {
    const hub = addr(0xfa);
    const fundingEdges = Array.from({ length: 30 }, (_, i) => ({ from: hub, to: addr(0x1000 + i), at: i }));
    fundingEdges.push({ from: hub, to: addr(0x10), at: 99 }, { from: hub, to: addr(0x99), at: 100 });
    const r = detectAbuse(input({ agents: [a1], fills: [fill("f1", 1, sub(0x99))], fundingEdges, coverage: new Map([[1, 1]]) }));
    expect(r.flags.get(1)).toBe(0);
    const ignored = detectAbuse(
      input({
        agents: [a1],
        fills: [fill("f1", 1, sub(0x99))],
        fundingEdges: [{ from: addr(0xfb), to: addr(0x10), at: 0 }, { from: addr(0xfb), to: addr(0x99), at: 0 }],
        coverage: new Map([[1, 1]]),
        params: { ...DEFAULT_ANTI_GAMING_PARAMS, ignoredFunders: new Set([addr(0xfb)]) },
      }),
    );
    expect(ignored.flags.get(1)).toBe(0);
  });

  it("flags SPAM when more orders than the limit are posted inside any 60 s window", () => {
    const limit = DEFAULT_ANTI_GAMING_PARAMS.spamMaxOrdersPerMinute;
    const mk = (i: number, gapMs: number): OrderRecord => ({
      agentId: 1, marketId: MKT, orderHash: `h${i}`, side: "buy", price: 1, quantity: 1, postedAt: T0 + i * gapMs, cancelledAt: null,
    });
    const atLimit = Array.from({ length: limit }, (_, i) => mk(i, 10));
    expect(detectAbuse(input({ agents: [a1], orders: atLimit, coverage: new Map([[1, 1]]) })).flags.get(1)).toBe(0);
    const over = Array.from({ length: limit + 1 }, (_, i) => mk(i, 10));
    expect(detectAbuse(input({ agents: [a1], orders: over, coverage: new Map([[1, 1]]) })).flags.get(1)).toBe(ScoreFlag.SPAM);
    const spread = Array.from({ length: limit + 1 }, (_, i) => mk(i, 60_000 / limit + 1));
    expect(detectAbuse(input({ agents: [a1], orders: spread, coverage: new Map([[1, 1]]) })).flags.get(1)).toBe(0);
  });

  it("flags SUSPENDED agents and DATA_GAP when coverage is below the minimum", () => {
    const s = agent(3, 0x30, 0x30, { status: "suspended" });
    const r = detectAbuse(input({ agents: [a1, s], coverage: new Map([[1, 0.49], [3, 1]]) }));
    expect(r.flags.get(1)).toBe(ScoreFlag.DATA_GAP);
    expect(r.flags.get(3)).toBe(ScoreFlag.SUSPENDED);
  });

  it("combines several flags into one bitmask", () => {
    const s = agent(1, 0x10, 0x10, { status: "suspended" });
    const r = detectAbuse(input({ agents: [s], fills: [fill("f1", 1, s.subaccountId)], coverage: new Map([[1, 0]]) }));
    expect(r.flags.get(1)).toBe(ScoreFlag.SELF_TRADE | ScoreFlag.SUSPENDED | ScoreFlag.DATA_GAP);
  });
});

describe("flagNames", () => {
  it("lists set flags in bit order", () => {
    expect(flagNames(ScoreFlag.SPAM | ScoreFlag.WASH)).toEqual(["WASH", "SPAM"]);
    expect(flagNames(0)).toEqual([]);
  });
});
