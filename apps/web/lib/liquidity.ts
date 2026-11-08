/**
 * Honest before/after labels for liquidity samples. A sample counts as "with STRATA" only when
 * STRATA agents actually had depth on the book (strataDepthUsd25 > 0). Samples recorded after
 * the BASELINE window but with no STRATA depth are neither baseline nor STRATA: they are labeled
 * by their own provenance and network, for example "Testnet, no STRATA quotes".
 */
import type { NetworkName, Provenance } from "@strata/sdk";

export type SampleKind = "baseline" | "strata" | "no_strata";

export function classifySample(s: { provenance: Provenance; strataDepthUsd25: number }): SampleKind {
  if (s.provenance === "BASELINE") return "baseline";
  return s.strataDepthUsd25 > 0 ? "strata" : "no_strata";
}

const PROVENANCE_WORD: Record<Provenance, string> = {
  LIVE: "Live",
  TESTNET: "Testnet",
  SIMULATED: "Simulated",
  BACKTEST: "Backtest",
  BASELINE: "Baseline",
  MOCK: "Mock",
};

/** Label for samples with no STRATA depth, named by where they came from. */
export function noStrataLabel(provenance: Provenance, network: NetworkName): string {
  const where = provenance === "LIVE" ? (network === "mainnet" ? "Mainnet" : "Testnet") : PROVENANCE_WORD[provenance];
  return `${where}, no STRATA quotes`;
}

export function sampleLabel(s: { provenance: Provenance; strataDepthUsd25: number }, network: NetworkName): string {
  switch (classifySample(s)) {
    case "baseline":
      return "Before STRATA";
    case "strata":
      return "With STRATA";
    case "no_strata":
      return noStrataLabel(s.provenance, network);
  }
}

/** A "now versus baseline" comparison is only a STRATA effect when STRATA has depth now. */
export function hasStrataDepth(now: { strataDepthUsd25: number } | null | undefined): boolean {
  return !!now && now.strataDepthUsd25 > 0;
}
