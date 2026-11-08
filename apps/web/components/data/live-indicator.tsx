"use client";

import type { NetworkName } from "@strata/sdk";
import { useStreamState } from "@/hooks/use-live-query";
import { cn } from "@/lib/utils";

const LABELS = {
  open: { text: "Live", tone: "bg-bid", pulse: true },
  connecting: { text: "Connecting", tone: "bg-warn", pulse: true },
  reconnecting: { text: "Reconnecting", tone: "bg-warn", pulse: true },
  closed: { text: "Offline", tone: "bg-halt", pulse: false },
  idle: { text: "Connecting", tone: "bg-fg-subtle", pulse: false },
  polling: { text: "Refreshing every 15s", tone: "bg-fg-subtle", pulse: false },
  mock: { text: "Simulated feed", tone: "bg-fg-subtle", pulse: false },
} as const;

export function LiveIndicator({ network, className }: { network: NetworkName; className?: string }) {
  const state = useStreamState(network);
  const l = LABELS[state];
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs text-fg-muted", className)} role="status" aria-live="polite">
      <span aria-hidden className={cn("size-1.5 rounded-full", l.tone)} style={l.pulse ? { animation: "strata-pulse 2s ease-in-out infinite" } : undefined} />
      {l.text}
    </span>
  );
}
