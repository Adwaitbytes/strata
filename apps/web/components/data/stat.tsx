import { NumberRoll, ProvenanceBadge, Skeleton, Sparkline, type ProvenanceLabel } from "@strata/ui/data";
import type { ReactNode } from "react";
import type { MetricKey } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { InfoTip } from "./info-tip";

export interface StatProps {
  metric: MetricKey;
  value: string;
  provenance?: ProvenanceLabel | undefined;
  spark?: readonly number[] | undefined;
  sparkLabel?: string | undefined;
  sparkColor?: string | undefined;
  footnote?: ReactNode;
  /** Secondary metrics render muted so the page's focal number stays the brightest. */
  tone?: "fg" | "muted";
  className?: string;
}

export function Stat({ metric, value, provenance, spark, sparkLabel, sparkColor, footnote, tone = "fg", className }: StatProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex items-center gap-2 text-[13px] text-fg-muted">
        <InfoTip metric={metric} />
        {provenance ? <ProvenanceBadge provenance={provenance} /> : null}
      </div>
      <div className="flex items-end justify-between gap-3">
        <NumberRoll value={value} className={cn("num text-[26px] font-medium leading-none tracking-tight", tone === "fg" ? "text-fg" : "text-fg-muted")} />
        {spark ? <Sparkline values={spark} label={sparkLabel ?? "Trend"} color={sparkColor} className="hidden shrink-0 sm:block" /> : null}
      </div>
      {footnote ? <div className="text-xs text-fg-subtle">{footnote}</div> : null}
    </div>
  );
}

export function StatSkeleton({ withSpark }: { withSpark?: boolean }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <Skeleton style={{ height: 16, width: 88 }} />
      <div className="flex items-end justify-between">
        <Skeleton style={{ height: 26, width: 112 }} />
        {withSpark ? <Skeleton style={{ height: 28, width: 96 }} /> : null}
      </div>
    </div>
  );
}
