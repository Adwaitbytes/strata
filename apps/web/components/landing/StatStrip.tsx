import { NetworkBadge, ProvenanceBadge } from "./Badges";
import type { StatStrip as StatStripModel } from "./model";
import { StatValue } from "./StatValue";

const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false });

/**
 * Hero readout: the arena's live numbers as one instrument panel. Every value carries its
 * definition, source, network and provenance.
 */
export function StatStrip({ strip }: { strip: StatStripModel }) {
  return (
    <section aria-labelledby="stat-strip-title" className="readout">
      <div className="readout-head">
        <h2 id="stat-strip-title" className="text-[13px] font-medium text-fg">
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
            "Numbers appear here once agents start quoting"
          )}
        </span>
      </div>
      <dl className="readout-grid">
        {strip.cells.map((cell) => (
          <div key={cell.id} className="readout-cell">
            <dt className="flex items-start gap-1.5 text-sm leading-snug text-fg-muted">
              {cell.label}
              {/* Native popover: no JS, light-dismiss and Escape built in. Anchored where CSS
                  anchor positioning exists, centered as a small dialog elsewhere. */}
              <button
                type="button"
                popoverTarget={`stat-def-${cell.id}`}
                className="-mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-fg-subtle transition-colors duration-150 hover:bg-surface-hover hover:text-fg"
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
                className="stat-popover w-72 rounded-sm border border-border-strong bg-bg-raised p-4 text-sm font-normal shadow-3"
                style={{ positionAnchor: `--stat-${cell.id}` }}
              >
                <p className="text-fg">{cell.definition}</p>
                <p className="mt-3 text-micro text-fg-subtle">Source: {cell.source}</p>
              </div>
            </dt>
            <dd className="num flex items-baseline text-[clamp(1.625rem,1.1rem+1.6vw,2.5rem)] leading-none tracking-[-0.03em]">
              {cell.value !== null ? (
                <>
                  <StatValue cell={{ ...cell, value: cell.value }} />
                  {cell.unit ? (
                    <span className="ml-1.5 font-sans text-[0.42em] tracking-normal text-fg-subtle">{cell.unit}</span>
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
    <div role="status" aria-busy="true" aria-label="Loading arena data" className="readout">
      <div className="readout-head">
        <span className="h-4 w-28 rounded-xs bg-surface" />
        <span className="h-5 w-16 rounded-xs bg-surface" />
      </div>
      <div className="readout-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="readout-cell">
            <span className="h-4 w-24 rounded-xs bg-surface" />
            <span className="h-8 w-20 animate-pulse rounded-xs bg-surface" />
          </div>
        ))}
      </div>
    </div>
  );
}
