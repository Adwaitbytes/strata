/**
 * Cross-check against the vectors W1 verifies in forge (packages/contracts/test/generated/MerkleGoldenVectors.sol).
 * If the scorer's leaf and tree code ever drift from what ScoreAttestor verifies onchain, this fails.
 * Also writes the scorer golden epoch as a vector file that a forge test can consume.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildTree, encodeLeaf, type LeafInput } from "@strata/sdk";

const SOL = fileURLToPath(new URL("../../../packages/contracts/test/generated/MerkleGoldenVectors.sol", import.meta.url));
const GOLDEN = fileURLToPath(new URL("./golden/epoch-s1-e2.json", import.meta.url));
const VECTORS_OUT = fileURLToPath(new URL("./golden/epoch-s1-e2.vectors.json", import.meta.url));

function parseVectors(src: string) {
  const root = /bytes32 internal constant ROOT = (0x[0-9a-f]{64});/.exec(src)?.[1];
  const leafRe = /if \(i == (\d+)\) return ScoreLeaf\(\{([^}]*)\}\);/g;
  const leaves: { index: number; input: LeafInput }[] = [];
  for (const m of src.matchAll(leafRe)) {
    const fields = Object.fromEntries(m[2]!.split(",").map((kv) => kv.split(":").map((x) => x.trim()) as [string, string]));
    const big = (k: string) => BigInt(fields[k]!);
    leaves.push({
      index: Number(m[1]),
      input: {
        season: big("season"),
        epoch: big("epoch"),
        agentId: big("agentId"),
        score: big("score"),
        spreadCentiBps: big("spreadCentiBps"),
        depthUsd: big("depthUsd"),
        uptimeBps: big("uptimeBps"),
        pnlUsdCents: big("pnlUsdCents"),
        flags: big("flags"),
      },
    });
  }
  const hashRe = /if \(i == (\d+)\) return (0x[0-9a-f]{64});/g;
  const hashes = new Map([...src.matchAll(hashRe)].map((m) => [Number(m[1]), m[2]!]));
  return { root, leaves: leaves.sort((a, b) => a.index - b.index), hashes };
}

describe("forge vector cross-check", () => {
  it.skipIf(!existsSync(SOL))("rebuilds W1's leaf hashes and root with the same code the scorer uses", () => {
    const { root, leaves, hashes } = parseVectors(readFileSync(SOL, "utf8"));
    expect(leaves.length).toBeGreaterThan(1);
    const computed = leaves.map((l) => encodeLeaf(l.input));
    computed.forEach((h, i) => expect(h).toBe(hashes.get(i)));
    expect(buildTree(computed).root).toBe(root);
  });

  it("exports the scorer golden epoch as a forge-consumable vector file", () => {
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as {
      merkleRoot: string;
      document: { scores: { season: number; epoch: number; agentId: number; score: number; flags: number; leaf: string; proof: string[]; metrics: { quotedSpreadBps: number; depthUsd25: number; uptimeBps: number; pnlUsd: number } }[] };
    };
    const vectors = {
      source: "services/scorer/test/golden.test.ts",
      root: golden.merkleRoot,
      leaves: golden.document.scores.map((s) => ({
        season: String(s.season),
        epoch: String(s.epoch),
        agentId: String(s.agentId),
        score: String(s.score),
        spreadCentiBps: String(Math.round(s.metrics.quotedSpreadBps * 100)),
        depthUsd: String(Math.floor(s.metrics.depthUsd25)),
        uptimeBps: String(s.metrics.uptimeBps),
        pnlUsdCents: String(Math.round(s.metrics.pnlUsd * 100)),
        flags: String(s.flags),
        leaf: s.leaf,
        proof: s.proof,
      })),
    };
    for (const v of vectors.leaves) {
      const leaf = encodeLeaf({
        season: BigInt(v.season),
        epoch: BigInt(v.epoch),
        agentId: BigInt(v.agentId),
        score: BigInt(v.score),
        spreadCentiBps: BigInt(v.spreadCentiBps),
        depthUsd: BigInt(v.depthUsd),
        uptimeBps: BigInt(v.uptimeBps),
        pnlUsdCents: BigInt(v.pnlUsdCents),
        flags: BigInt(v.flags),
      });
      expect(leaf).toBe(v.leaf);
    }
    const serialized = JSON.stringify(vectors, null, 2) + "\n";
    if (!existsSync(VECTORS_OUT) || process.env.UPDATE_GOLDEN === "1") writeFileSync(VECTORS_OUT, serialized);
    expect(readFileSync(VECTORS_OUT, "utf8")).toBe(serialized);
  });
});
