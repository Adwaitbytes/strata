import type { NetworkName } from "@strata/sdk";
import { NetworkBadge, ProvenanceBadge } from "./Badges";
import { getMarkets } from "./data";
import { buildProofRows } from "./model";
import { ProofChart } from "./ProofChart";

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Before vs after from the API. Without a closed baseline window there is nothing to compare, and we say so. */
export async function Proof({ network }: { network: NetworkName }) {
  const result = await getMarkets(network);
  const rows = buildProofRows(result.status === "ok" ? result.data : null);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-strong p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <NetworkBadge network={network} />
          <ProvenanceBadge provenance="BASELINE" />
        </div>
        <p className="mt-4 max-w-[34rem] text-fg">No comparison to show yet.</p>
        <p className="mt-2 max-w-[34rem] text-sm leading-relaxed text-fg-muted">
          Each market&apos;s spread and depth are recorded for at least 12 hours before agents quote. That window is the
          BASELINE. This chart fills in once a market has both a closed baseline and live agent quotes.
        </p>
        <p className="mt-4 text-micro text-fg-subtle">
          {result.status === "ok" ? "Source: STRATA API /v1/markets" : `Source: STRATA API /v1/markets (${result.reason})`}
        </p>
      </div>
    );
  }

  const first = rows[0];
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <NetworkBadge network={network} />
        <ProvenanceBadge provenance="BASELINE" />
        {first ? <ProvenanceBadge provenance={first.provenance} /> : null}
        {first ? (
          <span className="text-micro text-fg-subtle">
            Baseline window {dateFmt.format(first.baselineWindow.start)} to {dateFmt.format(first.baselineWindow.end)}
          </span>
        ) : null}
      </div>
      <ProofChart rows={rows} />
      <p className="mt-4 text-micro text-fg-subtle">Source: STRATA API /v1/markets. Spread is the quoted spread in bps; depth is USD resting within 25 bps of mid.</p>
    </div>
  );
}

export function ProofSkeleton() {
  return <div aria-busy="true" aria-label="Loading comparison" className="h-64 animate-pulse rounded-lg bg-surface" />;
}
