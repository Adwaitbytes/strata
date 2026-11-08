import type { GuardEvent } from "@strata/sdk";
import { Activity, Clock, Gauge, Power } from "lucide-react";
import { formatUtc } from "@/lib/format";
import { cn } from "@/lib/utils";

const GUARD = {
  oracle: { label: "Oracle guard", Icon: Gauge },
  session: { label: "Session guard", Icon: Clock },
  risk: { label: "Risk governor", Icon: Activity },
  kill_switch: { label: "Kill switch", Icon: Power },
} as const;

const ACTION_TONE: Record<GuardEvent["action"], string> = {
  ok: "text-fg-muted bg-surface-hover",
  resume: "text-bid bg-bid-soft",
  widen: "text-warn bg-warn-soft",
  reduce: "text-warn bg-warn-soft",
  flatten: "text-halt bg-halt-soft",
  halt: "text-halt bg-halt-soft",
};

export function GuardTimeline({ events, showAgent }: { events: GuardEvent[]; showAgent?: boolean }) {
  const sorted = [...events].sort((a, b) => b.at - a.at);
  return (
    <ol className="relative flex flex-col">
      {sorted.map((e, i) => {
        const g = GUARD[e.guard];
        return (
          <li key={e.id} className="relative grid grid-cols-[28px_1fr] gap-3 pb-5 last:pb-0">
            {i < sorted.length - 1 ? <span aria-hidden className="absolute left-[13.5px] top-8 bottom-1 w-px bg-border" /> : null}
            <span className="mt-0.5 flex size-7 items-center justify-center rounded-full border border-border bg-bg-raised text-fg-muted">
              <g.Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-medium text-fg">{g.label}</span>
                <span className={cn("rounded px-1.5 py-px text-[11px] font-medium capitalize", ACTION_TONE[e.action])}>{e.action}</span>
                {showAgent ? <span className="text-fg-subtle">Agent #{e.agentId}</span> : null}
                <time className="ml-auto text-xs text-fg-subtle" dateTime={new Date(e.at).toISOString()}>
                  {formatUtc(e.at)}
                </time>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-fg-muted">{e.detail}</p>
              {Object.keys(e.observed).length > 0 ? (
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {Object.entries(e.observed).map(([k, v]) => (
                    <div key={k} className="flex gap-1.5">
                      <dt className="text-fg-subtle">{k}</dt>
                      <dd className="num text-fg">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
