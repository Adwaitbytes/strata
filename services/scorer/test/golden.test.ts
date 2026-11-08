/**
 * Golden-file test (PRD 17): fixed fixture in, exact metrics, scores, merkle root and document hash out.
 * Hand-derived values for agents 1 and 2 are asserted directly; the full output is pinned in
 * test/golden/epoch-s1-e2.json. Regenerate only on an intentional formula change:
 *   UPDATE_GOLDEN=1 pnpm --filter @strata/scorer test
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyProof, type EpochScore } from "@strata/sdk";
import { canonicalEpochDocument, canonicalJson, computeEpoch, documentHash } from "../src/epoch.js";
import { DEFAULT_PARAMS } from "../src/params.js";
import { ATTESTOR_CONTRACT, EPOCH, FIXTURE, SEASON } from "./fixtures/epochFixture.js";

const GOLDEN_PATH = fileURLToPath(new URL("./golden/epoch-s1-e2.json", import.meta.url));
const GOLDEN_ROOT = "0xdd4f9e94db975b5d21af83f6d1fdfcf6a833621676c80020fedf81d79280f3a9";

function run() {
  const r = computeEpoch(FIXTURE, DEFAULT_PARAMS);
  if (r.kind !== "scored") throw new Error(`fixture skipped: ${r.reason}`);
  const docInput = {
    network: FIXTURE.network,
    season: SEASON.season,
    epoch: EPOCH,
    startTime: FIXTURE.window.startMs,
    endTime: FIXTURE.window.endMs,
    merkleRoot: r.merkleRoot,
    contract: ATTESTOR_CONTRACT,
    scores: r.scores,
  };
  return { r, document: canonicalEpochDocument(docInput), documentHash: documentHash(docInput) };
}

describe("golden epoch", () => {
  const { r, document, documentHash: hash } = run();
  const by = new Map<number, EpochScore>(r.scores.map((s) => [s.agentId, s]));

  it("matches hand-derived metrics for agent 1", () => {
    const m = by.get(1)!.metrics;
    expect(m.depthUsd25).toBeCloseTo(7_200.32 + 6_000, 6);
    expect(m.quotedSpreadBps).toBeCloseTo(((8 + (0.08 / 100.2) * 10_000) / 2 * 60 + 4 * 50) / 110, 9);
    expect(m.uptimeBps).toBe(10_000);
    expect(m.bookShare).toBeCloseTo(((7_200.32 / 20_000) * 60 + 0.4 * 50) / 110, 9);
    expect(m.markout60s).toBeCloseTo((0.4 / 999.6) * 10_000, 9);
    expect(m.pnlUsd).toBeCloseTo(2.45, 9);
    expect(m.maxDrawdownUsd).toBe(0);
    expect(m.samples).toBe(110);
    expect(by.get(1)!.score).toBe(10_000);
  });

  it("matches hand-derived metrics for agent 2, with flicker orders excluded", () => {
    const m = by.get(2)!.metrics;
    expect(m.depthUsd25).toBeCloseTo((20 * 4_000 + 10 * 3_499.5) / 60, 9);
    expect(m.quotedSpreadBps).toBeCloseTo(20, 9);
    expect(m.uptimeBps).toBe(5_000);
    expect(m.markout60s).toBeCloseTo((-0.5 / 500.5) * 10_000, 9);
    expect(m.pnlUsd).toBeCloseTo(-0.48, 9);
    expect(m.maxDrawdownUsd).toBeCloseTo(1, 9);
    expect(m.spreadImprovementBps).toBeCloseTo(18 - 6, 9);
  });

  it("flags the same-operator pair as WASH with score 0, and scores the idle agent 0", () => {
    expect(by.get(3)!.flagNames).toEqual(["WASH"]);
    expect(by.get(4)!.flagNames).toEqual(["WASH"]);
    expect(by.get(3)!.score).toBe(0);
    expect(by.get(4)!.score).toBe(0);
    expect(by.get(5)!.flags).toBe(0);
    expect(by.get(5)!.score).toBe(0);
  });

  it("scores agent 2 by the PRD 10.3 formula", () => {
    const depthN = ((20 * 4_000 + 10 * 3_499.5) / 60) / (7_200.32 + 6_000);
    const a1Spread = ((8 + (0.08 / 100.2) * 10_000) / 2 * 60 + 4 * 50) / 110;
    const spreadN = (1 / 20) / (1 / a1Spread);
    const a1Share = ((7_200.32 / 20_000) * 60 + 0.4 * 50) / 110;
    const shareN = ((20 * 4_000 + 10 * 3_499.5) / 60 / 20_000) / a1Share;
    const liquidity = 0.35 * depthN + 0.25 * 0.5 + 0.2 * spreadN + 0.2 * shareN;
    const quality = 0.5 + 0 - 0.5 * (1 / 150);
    expect(by.get(2)!.score).toBe(Math.round(10_000 * liquidity * (0.7 + 0.3 * quality)));
  });

  it("every proof verifies against the root", () => {
    for (const s of r.scores) expect(verifyProof(s.leaf as `0x${string}`, s.proof as `0x${string}`[], r.merkleRoot)).toBe(true);
  });

  it("reproduces the pinned golden file and root exactly", () => {
    const actual = { merkleRoot: r.merkleRoot, documentHash: hash, document, evidence: r.evidence };
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN_PATH, JSON.stringify(JSON.parse(canonicalJson(actual)), null, 2) + "\n");
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as typeof actual;
    expect(canonicalJson(actual)).toBe(canonicalJson(golden));
    expect(r.merkleRoot).toBe(GOLDEN_ROOT);
  });
});
