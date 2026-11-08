import type { NetworkName } from "@strata/sdk";
import { getHeroStats } from "./data";
import { buildStatStrip, buildStrataLayout } from "./model";
import { StatStrip, StatStripSkeleton } from "./StatStrip";
import { StrataCaption, StrataStage } from "./StrataStage";

/** Fetches /v1/stats once; the same response sizes the 3D strata and fills the stat strip. */
export async function HeroStrata({ network }: { network: NetworkName }) {
  const result = await getHeroStats(network);
  return <StrataStage layout={buildStrataLayout(result.status === "ok" ? result.data : null)} />;
}

export async function HeroStats({ network }: { network: NetworkName }) {
  const result = await getHeroStats(network);
  return <StatStrip strip={buildStatStrip(result.status === "ok" ? result.data : null, network)} />;
}

export function HeroStrataFallback() {
  return <StrataCaption live={false} text="Loading live depth" />;
}

export { StatStripSkeleton as HeroStatsFallback };
