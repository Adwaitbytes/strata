import { describe, expect, it } from "vitest";
import { buildTree, encodeLeaf, toLeafInput, verifyProof } from "./merkle.js";

const leafFor = (agentId: number, score: number) =>
  encodeLeaf(toLeafInput({ season: 0, epoch: 1, agentId, score, quotedSpreadBps: 4.25, depthUsd25: 12345.9, uptimeBps: 9876, pnlUsd: -12.34, flags: 0 }));

describe("merkle", () => {
  it("every proof verifies against the root for 1..9 leaves", () => {
    for (let n = 1; n <= 9; n++) {
      const leaves = Array.from({ length: n }, (_, i) => leafFor(i + 1, 1000 + i));
      const { root, proofs } = buildTree(leaves);
      leaves.forEach((l, i) => expect(verifyProof(l, proofs[i]!, root)).toBe(true));
    }
  });
  it("a tampered score fails verification", () => {
    const leaves = [leafFor(1, 5000), leafFor(2, 4000), leafFor(3, 3000)];
    const { root, proofs } = buildTree(leaves);
    expect(verifyProof(leafFor(1, 5001), proofs[0]!, root)).toBe(false);
  });
  it("rejects an empty tree", () => {
    expect(() => buildTree([])).toThrow();
  });
});
