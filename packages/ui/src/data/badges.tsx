import type { CSSProperties, ReactNode } from "react";

/**
 * Data labels required on every data view (PRD 12.5): the network a number came from and,
 * when it is not LIVE, where it came from. These are data, so they render as short uppercase
 * codes in the mono face, matching what the API returns.
 */
export type BadgeTone = "accent" | "neutral" | "warn" | "halt" | "baseline" | "bid";

const toneVars: Record<BadgeTone, { fg: string; bg: string }> = {
  accent: { fg: "var(--accent)", bg: "var(--accent-soft)" },
  neutral: { fg: "var(--fg-muted)", bg: "var(--surface-hover)" },
  warn: { fg: "var(--warn)", bg: "var(--warn-soft)" },
  halt: { fg: "var(--halt)", bg: "var(--halt-soft)" },
  baseline: { fg: "var(--baseline)", bg: "var(--baseline-soft)" },
  bid: { fg: "var(--bid)", bg: "var(--bid-soft)" },
};

export interface DataBadgeProps {
  tone: BadgeTone;
  children: ReactNode;
  title?: string | undefined;
  className?: string | undefined;
}

export function DataBadge({ tone, children, title, className }: DataBadgeProps) {
  const t = toneVars[tone];
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 20,
    padding: "0 7px",
    borderRadius: 5,
    fontFamily: "var(--font-mono)",
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: "0.06em",
    lineHeight: 1,
    color: t.fg,
    background: t.bg,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${t.fg} 22%, transparent)`,
    whiteSpace: "nowrap",
  };
  return (
    <span className={className} style={style} title={title}>
      {children}
    </span>
  );
}

export type NetworkLabel = "mainnet" | "testnet";

export function NetworkBadge({ network, className }: { network: NetworkLabel; className?: string | undefined }) {
  return (
    <DataBadge
      tone="neutral"
      className={className}
      title={network === "mainnet" ? "Injective mainnet (chain 1776)" : "Injective testnet (chain 1439). Testnet funds have no value."}
    >
      <span
        aria-hidden="true"
        style={{ width: 5, height: 5, background: network === "mainnet" ? "var(--bid)" : "var(--accent)", transform: "rotate(45deg)" }}
      />
      {network === "mainnet" ? "MAINNET" : "TESTNET"}
    </DataBadge>
  );
}

export type ProvenanceLabel = "LIVE" | "TESTNET" | "SIMULATED" | "BACKTEST" | "BASELINE" | "MOCK";

const provenanceInfo: Record<Exclude<ProvenanceLabel, "LIVE">, { tone: BadgeTone; title: string }> = {
  TESTNET: { tone: "neutral", title: "Measured on Injective testnet. Not real liquidity." },
  SIMULATED: { tone: "warn", title: "Produced by the simulator, not by orders on a live book." },
  BACKTEST: { tone: "neutral", title: "Replayed against historical data." },
  BASELINE: { tone: "baseline", title: "Measured before STRATA agents quoted this market." },
  MOCK: { tone: "halt", title: "Development mock data. Never shown in production." },
};

/** Renders nothing for LIVE: only live numbers may appear unlabeled. */
export function ProvenanceBadge({ provenance, className }: { provenance: ProvenanceLabel; className?: string | undefined }) {
  if (provenance === "LIVE") return null;
  const info = provenanceInfo[provenance];
  return (
    <DataBadge tone={info.tone} title={info.title} className={className}>
      {provenance}
    </DataBadge>
  );
}
