/**
 * Verify-my-score (PRD 12.4). Two independent checks, both run in the browser:
 *
 * 1. Local: rebuild the leaf from the published score fields with @strata/sdk, compare it to
 *    the published leaf, then walk the merkle proof to the epoch root the API published.
 * 2. Onchain: call ScoreAttestor.verifyScore on the agent's network with the same fields and
 *    proof (D18), which checks against the root the attestor posted. No wallet, no signature.
 */
import { encodeLeaf, scoreAttestorAbi, toLeafInput, verifyProof, type EpochScore, type NetworkName } from "@strata/sdk";
import { createPublicClient, http, type Hex, type PublicClient } from "viem";
import { CHAINS } from "./chains";

export type CheckResult =
  | { status: "pass"; detail: string }
  | { status: "fail"; detail: string }
  | { status: "unavailable"; detail: string };

export function leafFor(score: EpochScore): Hex {
  return encodeLeaf(
    toLeafInput({
      season: score.season,
      epoch: score.epoch,
      agentId: score.agentId,
      score: score.score,
      quotedSpreadBps: score.metrics.quotedSpreadBps,
      depthUsd25: score.metrics.depthUsd25,
      uptimeBps: score.metrics.uptimeBps,
      pnlUsd: score.metrics.pnlUsd,
      flags: score.flags,
    }),
  );
}

export function verifyLocally(score: EpochScore, root: Hex): CheckResult {
  const leaf = leafFor(score);
  if (leaf.toLowerCase() !== score.leaf.toLowerCase()) {
    return { status: "fail", detail: "The published leaf does not match a leaf rebuilt from the published score fields." };
  }
  if (!verifyProof(leaf, score.proof as Hex[], root)) {
    return { status: "fail", detail: "The merkle proof does not lead to the published epoch root." };
  }
  return { status: "pass", detail: `Leaf rebuilt and proof checked against root ${root.slice(0, 10)}…` };
}

export async function verifyOnchain(
  score: EpochScore,
  network: NetworkName,
  attestor: Hex | null,
  client: Pick<PublicClient, "readContract"> = createPublicClient({ chain: CHAINS[network], transport: http() }),
): Promise<CheckResult> {
  if (score.provenance === "MOCK") {
    return { status: "unavailable", detail: "MOCK scores are development data and are never posted onchain." };
  }
  if (!attestor || /^0x0{40}$/i.test(attestor)) {
    return { status: "unavailable", detail: `ScoreAttestor is not deployed on ${network} yet, so there is no onchain root to check.` };
  }
  const leaf = toLeafInput({
    season: score.season,
    epoch: score.epoch,
    agentId: score.agentId,
    score: score.score,
    quotedSpreadBps: score.metrics.quotedSpreadBps,
    depthUsd25: score.metrics.depthUsd25,
    uptimeBps: score.metrics.uptimeBps,
    pnlUsd: score.metrics.pnlUsd,
    flags: score.flags,
  });
  try {
    const ok = await client.readContract({
      address: attestor,
      abi: scoreAttestorAbi,
      functionName: "verifyScore",
      args: [
        leaf.season,
        leaf.epoch,
        leaf.agentId,
        leaf.score,
        leaf.spreadCentiBps,
        leaf.depthUsd,
        leaf.uptimeBps,
        leaf.pnlUsdCents,
        leaf.flags,
        score.proof as Hex[],
      ],
    });
    return ok
      ? { status: "pass", detail: `ScoreAttestor ${attestor.slice(0, 10)}… on ${network} returned true.` }
      : { status: "fail", detail: `ScoreAttestor ${attestor.slice(0, 10)}… on ${network} returned false.` };
  } catch (err) {
    return { status: "unavailable", detail: `Could not reach the ${network} RPC: ${err instanceof Error ? err.message.split("\n")[0] : "unknown error"}` };
  }
}
