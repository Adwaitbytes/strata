import { NetworkBadge, ProvenanceBadge } from "./Badges";
import type { StatStrip as StatStripModel } from "./model";
import { StatValue } from "./StatValue";

// Hairlines between cells: a 2x2 grid on small screens, one row from lg up.
const CELL_EDGES = [
  "",
  "border-l pl-4 lg:pl-6",
  "border-t lg:border-t-0 lg:border-l lg:pl-6",
  "border-l border-t pl-4 lg:border-t-0 lg:pl-6",
];

const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false });

/** Hero stat strip. Every value carries its definition, source, network and provenance. */
export function StatStrip({ strip }: { strip: StatStripModel }) {
  return (
    <section aria-labelledby="stat-strip-title" className="relative">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-4">
        <h2 id="stat-strip-title" className="text-sm text-fg-muted">
          {strip.live ? "Arena right now" : "Arena data"}
        </h2>
        <NetworkBadge network={strip.network} />
        {strip.provenance ? <ProvenanceBadge provenance={strip.provenance} /> : null}
        <span className="text-micro text-fg-subtle">
          {strip.asOf ? (
            <>
              Updated <time dateTime={new Date(strip.asOf).toISOString()}>{timeFmt.format(strip.asOf)} UTC</time>
            </>
          ) : (
            "Agents have not started quoting. Numbers appear here when they do."
          )}
        </span>
      </div>
      <dl className="grid grid-cols-2 border-t border-border lg:grid-cols-4">
        {strip.cells.map((cell, i) => (
          <div
            key={cell.id}
            className={`flex min-h-28 flex-col justify-between gap-4 border-border py-5 pr-4 ${CELL_EDGES[i] ?? ""}`}
          >
            <dt className="flex items-start gap-1.5 text-sm leading-snug text-fg-muted">
              {cell.label}
              {/* Native popover: no JS, light-dismiss and Escape built in. Anchored where CSS
                  anchor positioning exists, centered as a small dialog elsewhere. */}
              <button
                type="button"
                popoverTarget={`stat-def-${cell.id}`}
                className="-mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-fg-subtle transition-colors duration-150 hover:bg-surface-hover hover:text-fg"
                style={{ anchorName: `--stat-${cell.id}` }}
                aria-label={`What ${cell.label.toLowerCase()} means`}
              >
                <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
                  <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.25" />
                  <path d="M8 7.25v4M8 4.75v.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              <div
                id={`stat-def-${cell.id}`}
                popover="auto"
                role="note"
                className="stat-popover w-72 rounded-md border border-border-strong bg-bg-raised p-4 text-sm font-normal shadow-3"
                style={{ positionAnchor: `--stat-${cell.id}` }}
              >
                <p className="text-fg">{cell.definition}</p>
                <p className="mt-3 text-micro text-fg-subtle">Source: {cell.source}</p>
              </div>
            </dt>
            <dd className="num flex items-baseline text-[clamp(1.75rem,1.2rem+1.8vw,2.75rem)] leading-none tracking-[-0.02em]">
              {cell.value !== null ? (
                <>
                  <StatValue cell={{ ...cell, value: cell.value }} />
                  {cell.unit ? (
                    <span className="ml-1.5 font-sans text-[0.45em] tracking-normal text-fg-subtle">{cell.unit}</span>
                  ) : null}
                </>
              ) : (
                <span className="text-base font-sans tracking-normal text-fg-subtle">{cell.emptyLabel}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function StatStripSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading arena data">
      <div className="flex items-center gap-3 pb-4">
        <span className="h-4 w-28 rounded-xs bg-surface" />
        <span className="h-5 w-16 rounded-xs bg-surface" />
      </div>
      <div className="grid grid-cols-2 border-t border-border lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex min-h-28 flex-col justify-between gap-4 py-5">
            <span className="h-4 w-24 rounded-xs bg-surface" />
            <span className="h-8 w-20 animate-pulse rounded-xs bg-surface" />
          </div>
        ))}
      </div>
    </div>
  );
}
