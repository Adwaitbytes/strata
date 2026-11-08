"use client";

import { Tooltip } from "radix-ui";
import { useState, type ReactNode } from "react";
import { METRICS, type MetricKey } from "@/lib/metrics";
import { cn } from "@/lib/utils";

/**
 * Definition and source for a number (PRD 12.5). Opens on hover and keyboard focus, and toggles
 * on tap so touch users can read it too.
 */
export function InfoTip({ metric, children, className, side = "top" }: { metric: MetricKey; children?: ReactNode; className?: string; side?: "top" | "bottom" }) {
  const def = METRICS[metric];
  const [open, setOpen] = useState(false);
  return (
    <Tooltip.Root open={open} onOpenChange={setOpen}>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "group inline-flex items-center gap-1 rounded-sm text-left decoration-dotted decoration-fg-subtle underline-offset-[3px] hover:underline focus-visible:underline",
            className,
          )}
        >
          {children ?? def.label}
          <span className="sr-only"> (definition)</span>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className="z-50 max-w-[300px] rounded-lg border border-border-strong bg-bg-raised px-3.5 py-3 text-left shadow-[var(--shadow-3)] data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95"
        >
          <p className="text-[13px] font-medium text-fg">{def.label}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{def.definition}</p>
          <p className="mt-2 border-t border-border pt-2 text-xs leading-relaxed text-fg-subtle">Source: {def.source}</p>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
