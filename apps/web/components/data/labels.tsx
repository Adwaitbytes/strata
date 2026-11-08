import type { NetworkName, Provenance } from "@strata/sdk";
import { NetworkBadge, ProvenanceBadge } from "@strata/ui/data";

/** The two labels every data view carries (PRD 12.5). */
export function DataLabels({ network, provenance }: { network: NetworkName; provenance?: Provenance | null | undefined }) {
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="data-labels">
      <NetworkBadge network={network} />
      {provenance ? <ProvenanceBadge provenance={provenance} /> : null}
    </span>
  );
}
