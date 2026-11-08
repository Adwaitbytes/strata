import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import { verifyProof } from "@strata/sdk";
import {
  buildDataUri,
  canonicalEpochDocument,
  canonicalJson,
  computeEpoch,
  epochWindow,
  lastClosedEpoch,
  parseDataUri,
  type EpochData,
  type SeasonInfo,
} from "./epoch.js";
import { DEFAULT_PARAMS } from "./params.js";

const season: SeasonInfo = { season: 1, startMs: 1_000_000, endMs: 1_000_000 + 3.5 * 3_600_000, epochSeconds: 3_600, active: true };

describe("epoch windows", () => {
  it("splits the season into epochSeconds windows and truncates the last one at the season end", () => {
    expect(epochWindow(season, 0)).toEqual({ season: 1, epoch: 0, startMs: 1_000_000, endMs: 1_000_000 + 3_600_000 });
    expect(epochWindow(season, 3)).toEqual({ season: 1, epoch: 3, startMs: 1_000_000 + 3 * 3_600_000, endMs: season.endMs });
    expect(() => epochWindow(season, 4)).toThrow();
  });

  it("returns the newest epoch whose end plus the settle delay has passed", () => {
    const settle = 120_000;
    expect(lastClosedEpoch(season, season.startMs + 3_600_000 + settle - 1, settle)).toBeNull();
    expect(lastClosedEpoch(season, season.startMs + 3_600_000 + settle, settle)).toBe(0);
    expect(lastClosedEpoch(season, season.startMs + 2.5 * 3_600_000, settle)).toBe(1);
    expect(lastClosedEpoch(season, season.endMs + settle, settle)).toBe(3);
    expect(lastClosedEpoch(season, season.endMs + 99 * 3_600_000, settle)).toBe(3);
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every level and drops whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: "x" } })).toBe('{"a":{"c":"x","d":[2,{"y":2,"z":1}]},"b":1}');
  });
  it("rejects values JSON cannot represent exactly", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson({ a: 1n })).toThrow();
  });
});

describe("data URI", () => {
  it("points at the API mirror and carries the keccak256 of the canonical document", () => {
    const hash = keccak256(toBytes("{}"));
    const uri = buildDataUri("https://api.example.test/", "testnet", 1, 7, hash);
    expect(uri).toBe(`https://api.example.test/v1/epochs/1/7?network=testnet#keccak256=${hash}`);
    expect(parseDataUri(uri)).toEqual({ url: "https://api.example.test/v1/epochs/1/7?network=testnet", contentHash: hash });
  });
});

describe("computeEpoch", () => {
  const window = epochWindow(season, 0);
  const empty: EpochData = {
    network: "testnet",
    window,
    agents: [],
    markets: [],
    book: new Map(),
    baselineSpreadBps: new Map(),
    orders: [],
    fills: [],
    funding: [],
    marks: new Map(),
    fundingEdges: [],
  };
  const MKT = "0x" + "11".repeat(32);
  const agent = {
    agentId: 1,
    operator: "0x" + "10".repeat(20),
    subaccountId: "0x" + "10".repeat(20) + "00".repeat(12),
    status: "active" as const,
    marketIds: [MKT],
    simulated: false,
    enrolledAt: 0,
  };

  it("skips an epoch with no eligible agents", () => {
    const r = computeEpoch(empty, DEFAULT_PARAMS);
    expect(r).toEqual({ kind: "skip", reason: "no eligible agents: none enrolled before the epoch ended with an arena market" });
  });

  it("skips simulated, withdrawn and late agents", () => {
    const r = computeEpoch(
      {
        ...empty,
        markets: [{ marketId: MKT, maxSpreadBps: 50 }],
        agents: [
          { ...agent, agentId: 1, simulated: true },
          { ...agent, agentId: 2, status: "withdrawn" },
          { ...agent, agentId: 3, enrolledAt: window.endMs },
          { ...agent, agentId: 4, marketIds: ["0x" + "99".repeat(32)] },
        ],
      },
      DEFAULT_PARAMS,
    );
    expect(r.kind).toBe("skip");
  });

  it("skips an epoch with no book data at all", () => {
    const r = computeEpoch({ ...empty, markets: [{ marketId: MKT, maxSpreadBps: 50 }], agents: [agent] }, DEFAULT_PARAMS);
    expect(r).toEqual({ kind: "skip", reason: "no book data for any arena market in the epoch window" });
  });

  it("skips an epoch where every agent lacks enough book coverage", () => {
    const sparse = [{ at: window.startMs, mid: 100, spreadBps: 5, depthUsd25: 10_000 }];
    const r = computeEpoch({ ...empty, markets: [{ marketId: MKT, maxSpreadBps: 50 }], agents: [agent], book: new Map([[MKT, sparse]]) }, DEFAULT_PARAMS);
    expect(r.kind).toBe("skip");
    if (r.kind === "skip") expect(r.reason).toMatch(/^book data too sparse: best agent coverage 0\.4%/);
  });

  it("scores eligible agents and every proof verifies against the root", () => {
    const book = [];
    for (let t = window.startMs - 5_000; t < window.endMs + 75_000; t += 5_000) book.push({ at: t, mid: 100, spreadBps: 5, depthUsd25: 10_000 });
    const r = computeEpoch(
      {
        ...empty,
        markets: [{ marketId: MKT, maxSpreadBps: 50 }],
        agents: [agent, { ...agent, agentId: 2, subaccountId: "0x" + "20".repeat(20) + "00".repeat(12), operator: "0x" + "20".repeat(20) }],
        book: new Map([[MKT, book]]),
        orders: [
          { agentId: 1, marketId: MKT, orderHash: "b", side: "buy", price: 99.95, quantity: 5, postedAt: window.startMs - 1, cancelledAt: null },
          { agentId: 1, marketId: MKT, orderHash: "a", side: "sell", price: 100.05, quantity: 5, postedAt: window.startMs - 1, cancelledAt: null },
        ],
      },
      DEFAULT_PARAMS,
    );
    if (r.kind !== "scored") throw new Error("expected scored");
    expect(r.scores.map((s) => s.agentId)).toEqual([1, 2]);
    expect(r.scores[0]!.score).toBe(10_000);
    expect(r.scores[1]!.score).toBe(0);
    expect(r.scores[0]!.provenance).toBe("TESTNET");
    for (const s of r.scores) expect(verifyProof(s.leaf as `0x${string}`, s.proof as `0x${string}`[], r.merkleRoot)).toBe(true);
    const doc = canonicalEpochDocument({
      network: "testnet",
      season: 1,
      epoch: 0,
      startTime: window.startMs,
      endTime: window.endMs,
      merkleRoot: r.merkleRoot,
      contract: "0x" + "AB".repeat(20),
      scores: r.scores,
    });
    expect(doc.contract).toBe("0x" + "ab".repeat(20));
    expect(Object.keys(doc.scores[0]!.metrics).sort()).toEqual(
      ["bookShare", "depthUsd25", "markout60s", "maxDrawdownUsd", "pnlUsd", "quotedSpreadBps", "samples", "spreadImprovementBps", "uptimeBps"],
    );
  });
});
