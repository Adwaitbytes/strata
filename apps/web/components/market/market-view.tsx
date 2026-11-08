"use client";

import type { MarketDetailResponse, SessionState } from "@strata/sdk";
import { Skeleton } from "@strata/ui/data";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { SpreadChart } from "@/components/charts/spread-chart";
import { InfoTip } from "@/components/data/info-tip";
import { DataLabels } from "@/components/data/labels";
import { LiveIndicator } from "@/components/data/live-indicator";
import { PageHeader, Panel } from "@/components/data/page-header";
import { Stat, StatSkeleton } from "@/components/data/stat";
import { EmptyState, ErrorState } from "@/components/data/states";
import { useLiveQuery } from "@/hooks/use-live-query";
import { useNetwork } from "@/hooks/use-network";
import { api } from "@/lib/api/client";
import { dominantProvenance } from "@/lib/api/provenance";
import { formatAge, formatBps, formatPct, formatPrice, formatUsd, formatUtc } from "@/lib/format";
import { hasStrataDepth } from "@/lib/liquidity";
import { cn } from "@/lib/utils";
import { DepthLadder } from "./depth-ladder";

const SESSION: Record<SessionState, { label: string; tone: string; note: string }> = {
  open: { label: "Open", tone: "text-bid", note: "Underlying market is trading. Agents quote normally." },
  closing: { label: "Closing", tone: "text-warn", note: "Close is near. Agents widen spreads and cut size." },
  closed: { label: "Closed", tone: "text-halt", note: "Underlying market is closed. Agents do not quote." },
  reopening: { label: "Reopening", tone: "text-warn", note: "Cooldown after the open. Quotes ramp back in." },
  always_open: { label: "Always open", tone: "text-bid", note: "This asset trades around the clock." },
  unknown: { label: "Session unknown", tone: "text-fg-muted", note: "No session calendar is recorded for this market yet." },
};

const SESSION_ORDER: SessionState[] = ["open", "closing", "closed", "reopening"];

function ShareBar({ share }: { share: number }) {
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-border" role="img" aria-label={`STRATA provides ${formatPct(share)} of book depth within 25 bps`}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${share * 100}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-accent" /> STRATA agents
        </span>
        <span className="inline-flex items-center gap-1.5">
          Rest of book <span aria-hidden className="size-2 rounded-full bg-border-strong" />
        </span>
      </div>
    </div>
  );
}

export function MarketView({ id }: { id: string }) {
  const [network] = useNetwork();
  const q = useLiveQuery<MarketDetailResponse>({
    queryKey: ["market", network, id],
    network,
    fetcher: ({ signal, tick }) => api.market(network, id, { signal, tick }),
    channel: `book:${id}` as `book:${string}`,
    apply: (prev, msg) => (msg.type === "book" ? { ...prev, book: msg.data } : prev),
  });

  if (q.isPending) return <MarketSkeleton />;
  if (q.isError && !q.data) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const { summary, book, history, oracle } = q.data;
  const m = summary.market;
  const now = summary.now;
  const base = summary.baseline;
  const provenance = dominantProvenance([...(now ? [now.provenance] : []), ...(book ? [book.provenance] : [])]);
  const session = book?.sessionState ?? now?.sessionState ?? null;
  // Only a STRATA effect when STRATA agents have depth on the book now; otherwise no comparison is claimed.
  const strataQuoting = hasStrataDepth(now);
  const improvement = strataQuoting && now?.spreadBps != null && base?.spreadBps != null ? base.spreadBps - now.spreadBps : null;

  return (
    <div className="flex flex-col gap-8">
      <BackLink />
      <PageHeader
        meta={
          <>
            <DataLabels network={network} provenance={now || book ? provenance : null} />
            <LiveIndicator network={network} className="ml-1" />
          </>
        }
        title={m.ticker}
        description={
          <span>
            <span className="capitalize">{m.assetClass}</span> perpetual. Max spread for scoring {m.maxSpreadBps} bps. Market data fetched from{" "}
            <a className="text-accent underline underline-offset-4" href={m.source} rel="noopener noreferrer" target="_blank">
              the Injective indexer
            </a>
            .
          </span>
        }
      />

      <section aria-label="Market metrics" className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-border bg-border lg:grid-cols-4">
        <div className="bg-surface p-5">
          <Stat
            metric="marketSpread"
            value={formatBps(now?.spreadBps)}
            footnote={
              base?.spreadBps != null
                ? `Baseline ${formatBps(base.spreadBps)}${improvement != null ? `, ${improvement >= 0 ? "down" : "up"} ${formatBps(Math.abs(improvement))} with STRATA` : strataQuoting ? "" : ". No STRATA quotes yet"}`
                : "No baseline recorded"
            }
          />
        </div>
        <div className="bg-surface p-5">
          <Stat metric="marketDepth" value={formatUsd(now?.depthUsd25)} footnote={base ? `Baseline ${formatUsd(base.depthUsd25)}` : "No baseline recorded"} />
        </div>
        <div className="bg-surface p-5">
          <Stat metric="strataShare" value={formatPct(now?.strataBookShare)} footnote={`${formatUsd(now?.strataDepthUsd25)} from STRATA agents`} />
        </div>
        <div className="bg-surface p-5">
          <Stat
            metric="oracle"
            value={formatPrice(oracle.price, 4)}
            footnote={
              <span className={cn("inline-flex items-center gap-1.5", oracle.healthy ? "text-fg-subtle" : "text-halt")}>
                <span aria-hidden className={cn("size-1.5 rounded-full", oracle.healthy ? "bg-bid" : "bg-halt")} />
                {oracle.healthy ? "Healthy" : "Unhealthy"}, updated {formatAge(oracle.ageSec)} ago
              </span>
            }
          />
        </div>
      </section>

      <Panel
        title="Spread over time"
        id="spread"
        aside={base ? <span className="text-xs text-fg-subtle">Baseline window {formatUtc(base.windowStart)} to {formatUtc(base.windowEnd)}, {base.samples} samples</span> : null}
      >
        {history.some((s) => s.spreadBps != null) ? (
          <SpreadChart history={history} baselineSpreadBps={base?.spreadBps ?? null} network={network} />
        ) : (
          <EmptyState title="No spread samples yet" detail="Samples are recorded every 5 seconds once the indexer follows this market." className="border-0 p-0" />
        )}
      </Panel>

      <div className="grid items-start gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Panel title="Depth ladder" id="ladder" aside={book ? <span className="text-xs text-fg-subtle">As of {formatUtc(book.at)}</span> : null}>
          {book && (book.bids.length || book.asks.length) ? (
            <DepthLadder book={book} />
          ) : (
            <EmptyState title="Book is empty" detail="No resting orders were seen on this market in the latest snapshot." className="border-0 p-0" />
          )}
        </Panel>
        <div className="flex flex-col gap-6 lg:sticky lg:top-24">
          <Panel title={<InfoTip metric="strataShare">STRATA share of book</InfoTip>} id="share">
            {now ? (
              <>
                <p className="num mb-4 text-[32px] font-medium leading-none text-fg">{formatPct(now.strataBookShare)}</p>
                <ShareBar share={now.strataBookShare} />
              </>
            ) : (
              <EmptyState title="No live measurement" detail="Share appears once STRATA agents quote this market." className="border-0 p-0" />
            )}
          </Panel>
          <Panel title={<InfoTip metric="session">Session state</InfoTip>} id="session">
            {session ? (
              <div>
                <p className={cn("text-lg font-medium", SESSION[session].tone)}>{SESSION[session].label}</p>
                <p className="mt-1 text-sm text-fg-muted">{SESSION[session].note}</p>
                {SESSION_ORDER.includes(session) ? (
                  <ol className="mt-4 grid grid-cols-4 gap-1" aria-label="Session cycle">
                    {SESSION_ORDER.map((s) => (
                      <li key={s} aria-current={s === session ? "step" : undefined} className="flex flex-col gap-1.5">
                        <span className={cn("h-1 rounded-full", s === session ? "bg-accent" : "bg-border")} />
                        <span className={cn("text-[11px]", s === session ? "text-fg" : "text-fg-subtle")}>{SESSION[s].label}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-fg-muted">Unknown</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/arena" className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
      <ArrowLeft className="size-4" aria-hidden /> Arena
    </Link>
  );
}

export function MarketSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading market">
      <Skeleton style={{ height: 20, width: 64 }} />
      <div className="flex flex-col gap-3">
        <Skeleton style={{ height: 20, width: 160 }} />
        <Skeleton style={{ height: 44, width: 320 }} />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-border bg-border lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="bg-surface p-5">
            <StatSkeleton />
          </div>
        ))}
      </div>
      <Skeleton style={{ height: 380, borderRadius: 14 }} />
    </div>
  );
}
