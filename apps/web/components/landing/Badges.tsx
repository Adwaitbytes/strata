import type { NetworkName, Provenance } from "@strata/sdk";
import { cn } from "@/lib/utils";

const PROVENANCE_TONE: Record<Provenance, string> = {
  LIVE: "text-accent border-accent/35 bg-accent-soft",
  TESTNET: "text-fg-muted border-border-strong bg-surface",
  SIMULATED: "text-warn border-warn/35 bg-warn-soft",
  BACKTEST: "text-warn border-warn/35 bg-warn-soft",
  BASELINE: "text-baseline border-baseline/40 bg-baseline-soft",
  MOCK: "text-halt border-halt/40 bg-halt-soft",
};

const base =
  "inline-flex h-5 items-center rounded-xs border px-1.5 font-mono text-[0.6875rem] leading-none font-medium tracking-[0.04em] tabular-nums";

/** Network label required on every data view (PRD 12.5). */
export function NetworkBadge({ network, className }: { network: NetworkName; className?: string }) {
  return (
    <span className={cn(base, "border-border-strong text-fg-muted", className)} title={`Data from Injective ${network}`}>
      {network === "mainnet" ? "MAINNET" : "TESTNET"}
    </span>
  );
}

export function ProvenanceBadge({ provenance, className }: { provenance: Provenance; className?: string }) {
  return <span className={cn(base, PROVENANCE_TONE[provenance], className)}>{provenance}</span>;
}
