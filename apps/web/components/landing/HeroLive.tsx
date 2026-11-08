import type { NetworkName } from "@strata/sdk";
import { getHeroStats } from "./data";
import { buildStatStrip, buildTerrainField } from "./model";
import { StatStrip, StatStripSkeleton } from "./StatStrip";
import { SurveyStage } from "./SurveyStage";
import { TerrainLegend } from "./TerrainLegend";

/**
 * /v1/stats is fetched once per request (Next dedupes the cached fetch); the same response shapes
 * the terrain, labels its legend and fills the stat strip.
 */
export async function HeroTerrain({ network }: { network: NetworkName }) {
  const result = await getHeroStats(network);
  return <SurveyStage field={buildTerrainField(result.status === "ok" ? result.data : null)} />;
}

export async function HeroLegend({ network }: { network: NetworkName }) {
  const result = await getHeroStats(network);
  return <TerrainLegend field={buildTerrainField(result.status === "ok" ? result.data : null)} />;
}

export async function HeroStats({ network }: { network: NetworkName }) {
  const result = await getHeroStats(network);
  return <StatStrip strip={buildStatStrip(result.status === "ok" ? result.data : null, network)} />;
}

/** The poster alone: identical to the stage before WebGL, so streaming in the stage never shifts it. */
export function HeroTerrainFallback() {
  return (
    <div className="survey-stage" aria-hidden>
      <div className="survey-poster" />
    </div>
  );
}

export { StatStripSkeleton as HeroStatsFallback };
