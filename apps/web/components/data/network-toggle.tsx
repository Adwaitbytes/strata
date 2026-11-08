"use client";

import type { NetworkName } from "@strata/sdk";
import { useNetwork } from "@/hooks/use-network";
import { cn } from "@/lib/utils";

const OPTIONS: { value: NetworkName; label: string }[] = [
  { value: "testnet", label: "Testnet" },
  { value: "mainnet", label: "Mainnet" },
];

export function NetworkToggle({ className }: { className?: string }) {
  const [network, setNetwork] = useNetwork();
  return (
    <div role="radiogroup" aria-label="Network" className={cn("inline-flex rounded-lg border border-border bg-bg-sunken p-0.5", className)}>
      {OPTIONS.map((o) => {
        const active = o.value === network;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setNetwork(o.value)}
            className={cn(
              "h-7 rounded-md px-3 text-[13px] font-medium transition-colors",
              active ? "bg-surface text-fg shadow-[var(--shadow-1)]" : "text-fg-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
