"use client";

import { useSyncExternalStore } from "react";
import { NetworkBadge, ProvenanceBadge } from "./Badges";
import type { TerrainField } from "./model";
import { getTerrainMode, subscribeTerrainMode } from "./survey-store";

/**
 * The terrain's map legend. It says what the land means and where its numbers come from, and it
 * says plainly when the visitor is looking at a still image rather than the live survey.
 */
export function TerrainLegend({ field }: { field: TerrainField }) {
  const mode = useSyncExternalStore(subscribeTerrainMode, getTerrainMode, () => "poster" as const);
  return (
    <div className="terrain-legend">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium text-fg">Depth survey</span>
        {field.network ? <NetworkBadge network={field.network} /> : null}
        {field.provenance ? <ProvenanceBadge provenance={field.provenance} /> : null}
      </div>
      <p className="mt-2 text-[13px] leading-snug text-fg-muted">
        {mode === "live" ? field.caption : "Still image of the survey terrain, not live data"}
      </p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-fg-subtle" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-px w-4 bg-bid" /> Bids, left of mid
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-px w-4 bg-ask" /> Asks, right of mid
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-[3px] w-4 bg-accent" /> STRATA depth
        </li>
      </ul>
    </div>
  );
}
