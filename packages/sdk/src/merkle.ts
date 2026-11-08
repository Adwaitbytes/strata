/**
 * Score merkle leaves and tree (PRD 8.2). Shared by services/scorer (build + post root),
 * apps/web (verify-my-score in the browser) and packages/contracts tests (golden vectors).
 *
 * Leaf = keccak256(abi.encode(
 *   uint64 season, uint64 epoch, uint256 agentId, uint256 score,
 *   uint256 spreadCentiBps, uint256 depthUsd, uint256 uptimeBps, int256 pnlUsdCents, uint256 flags))
 *
 * Integer encodings (no floats onchain):
 * - spreadCentiBps = round(quotedSpreadBps * 100)
 * - depthUsd       = floor(depthUsd25) whole dollars
 * - pnlUsdCents    = round(pnlUsd * 100), signed
 *
 * A single keccak over a 288-byte preimage cannot collide with a 64-byte internal node preimage,
 * so the classic second-preimage attack on merkle leaves does not apply.
 * Internal nodes use sorted-pair hashing to match OpenZeppelin MerkleProof.verify.
 */
import { encodeAbiParameters, keccak256, concat, type Hex } from "viem";

export interface LeafInput {
  season: bigint;
  epoch: bigint;
  agentId: bigint;
  score: bigint;
  spreadCentiBps: bigint;
  depthUsd: bigint;
  uptimeBps: bigint;
  pnlUsdCents: bigint;
  flags: bigint;
}

const LEAF_ABI = [
  { type: "uint64" },
  { type: "uint64" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "int256" },
  { type: "uint256" },
] as const;

export function encodeLeaf(l: LeafInput): Hex {
  return keccak256(
    encodeAbiParameters(LEAF_ABI, [
      l.season,
      l.epoch,
      l.agentId,
      l.score,
      l.spreadCentiBps,
      l.depthUsd,
      l.uptimeBps,
      l.pnlUsdCents,
      l.flags,
    ]),
  );
}

export function toLeafInput(args: {
  season: number;
  epoch: number;
  agentId: number;
  score: number;
  quotedSpreadBps: number;
  depthUsd25: number;
  uptimeBps: number;
  pnlUsd: number;
  flags: number;
}): LeafInput {
  return {
    season: BigInt(args.season),
    epoch: BigInt(args.epoch),
    agentId: BigInt(args.agentId),
    score: BigInt(args.score),
    spreadCentiBps: BigInt(Math.round(args.quotedSpreadBps * 100)),
    depthUsd: BigInt(Math.floor(args.depthUsd25)),
    uptimeBps: BigInt(args.uptimeBps),
    pnlUsdCents: BigInt(Math.round(args.pnlUsd * 100)),
    flags: BigInt(args.flags),
  };
}

function hashPair(a: Hex, b: Hex): Hex {
  return a.toLowerCase() < b.toLowerCase() ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

export interface MerkleTree {
  root: Hex;
  /** Proof per leaf, in the same order as the input leaves. */
  proofs: Hex[][];
}

/**
 * Builds a tree over leaves in the given order. Odd nodes are promoted unchanged.
 * Empty input is rejected: an epoch with no scored agents is not attested.
 */
export function buildTree(leaves: readonly Hex[]): MerkleTree {
  if (leaves.length === 0) throw new Error("buildTree: no leaves");
  const proofs: Hex[][] = leaves.map(() => []);
  let level: { hash: Hex; members: number[] }[] = leaves.map((hash, i) => ({ hash, members: [i] }));
  while (level.length > 1) {
    const next: { hash: Hex; members: number[] }[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1];
      if (!right) {
        next.push(left);
        continue;
      }
      for (const m of left.members) proofs[m]!.push(right.hash);
      for (const m of right.members) proofs[m]!.push(left.hash);
      next.push({ hash: hashPair(left.hash, right.hash), members: [...left.members, ...right.members] });
    }
    level = next;
  }
  return { root: level[0]!.hash, proofs };
}

export function verifyProof(leaf: Hex, proof: readonly Hex[], root: Hex): boolean {
  let computed = leaf;
  for (const p of proof) computed = hashPair(computed, p);
  return computed.toLowerCase() === root.toLowerCase();
}
