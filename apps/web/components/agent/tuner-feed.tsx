import type { TunableParams, TunerEvent } from "@strata/sdk";
import { DataBadge } from "@strata/ui/data";
import { formatUtc } from "@/lib/format";
import { tunerOutcome } from "./tuner-status";

const PARAM_LABEL: Record<keyof TunableParams, string> = {
  gamma: "Inventory aversion",
  minHalfSpreadBps: "Min half spread (bps)",
  levels: "Levels",
  sizeMultiplier: "Size multiplier",
  offHoursQuoting: "Off-hours quoting",
};

function changed(e: TunerEvent): (keyof TunableParams)[] {
  return (Object.keys(e.before) as (keyof TunableParams)[]).filter((k) => e.before[k] !== e.suggested[k]);
}

export function TunerFeed({ events }: { events: TunerEvent[] }) {
  const sorted = [...events].sort((a, b) => b.at - a.at);
  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((e) => {
        const outcome = tunerOutcome(e);
        return (
          <li key={e.id} className="rounded-lg border border-border bg-bg-raised p-4">
            <div className="flex flex-wrap items-center gap-2">
              <DataBadge tone={e.mode === "live" ? "accent" : "neutral"} title={e.mode === "shadow" ? "Logged only, never applied to quotes" : undefined}>
                {e.mode.toUpperCase()}
              </DataBadge>
              {outcome === "rejected" ? <DataBadge tone="halt">REJECTED</DataBadge> : outcome === "applied" ? <DataBadge tone="bid">APPLIED</DataBadge> : null}
              <span className="text-xs text-fg-subtle">{e.model}</span>
              <time className="ml-auto text-xs text-fg-subtle" dateTime={new Date(e.at).toISOString()}>
                {formatUtc(e.at)}
              </time>
            </div>
            <p className="mt-2.5 text-sm leading-relaxed text-fg">{e.rationale}</p>
            {outcome === "suggested" ? <p className="mt-3 text-[11px] font-medium text-fg-muted">Suggested, not applied</p> : null}
            <dl className="mt-3 flex flex-col gap-1 text-xs">
              {changed(e).map((k) => (
                <div key={k} className="flex flex-wrap items-baseline gap-2">
                  <dt className="min-w-[150px] text-fg-muted">{PARAM_LABEL[k]}</dt>
                  <dd className="num text-fg">
                    {String(e.before[k])} <span className="text-fg-subtle">to</span> {String(e.suggested[k])}
                    {e.clamped.includes(k) ? <span className="ml-2 text-warn">clamped to bounds</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
            {e.rejected && e.rejectReason ? <p className="mt-2 text-xs text-halt">Rejected: {e.rejectReason}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
