"use client";

import { NETWORKS } from "@strata/config";
import type { AgentDetailResponse, EpochScore } from "@strata/sdk";
import { Skeleton } from "@strata/ui/data";
import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusPill } from "@/components/arena/status-pill";
import { ScoreHistory } from "@/components/charts/score-history";
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
import { explorerUrl } from "@/lib/chains";
import { formatBps, formatPct, formatScore, formatUptime, formatUsd, formatUsdSigned, formatUtc, shortHex } from "@/lib/format";
import { GuardTimeline } from "./guard-timeline";
import { QuotesVisual } from "./quotes-visual";
import { TunerFeed } from "./tuner-feed";
import { VerifyScore } from "./verify-score";

function series(scores: EpochScore[], pick: (s: EpochScore) => number): number[] {
  return [...scores].sort((a, b) => a.epoch - b.epoch).slice(-24).map(pick);
}

function IdentityRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="min-w-0 truncate text-sm text-fg">{children}</dd>
    </div>
  );
}

export function AgentView({ id }: { id: number }) {
  const [network] = useNetwork();
  const q = useLiveQuery<AgentDetailResponse>({
    queryKey: ["agent", network, id],
    network,
    fetcher: ({ signal, tick }) => api.agent(network, id, { signal, tick }),
    channel: `agent:${id}`,
    apply: (prev, msg) => (msg.type === "agent" ? { ...prev, liveQuotes: msg.data.quotes, recentFills: [...msg.data.fills, ...prev.recentFills].slice(0, 50) } : prev),
  });

  if (q.isPending) return <AgentSkeleton />;
  if (q.isError && !q.data) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const d = q.data;
  const a = d.agent;
  const latest = [...d.scores].sort((x, y) => y.epoch - x.epoch)[0];
  const provenance = dominantProvenance([...d.scores.map((s) => s.provenance), ...d.liveQuotes.map((x) => x.provenance)]);
  const registry = NETWORKS[network].contracts.identityRegistry;

  return (
    <div className="flex flex-col gap-8">
      <BackLink />
      <PageHeader
        meta={
          <>
            <DataLabels network={network} provenance={d.scores.length || d.liveQuotes.length ? provenance : null} />
            {a.simulated ? <DataLabels network={network} provenance="SIMULATED" /> : null}
            <LiveIndicator network={network} className="ml-1" />
          </>
        }
        title={a.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusPill status={a.status} />
            {a.statusReason ? <span className="text-fg-muted">{a.statusReason}</span> : null}
            <span className="text-fg-subtle">{a.kind === "house" ? "House agent" : "Third-party agent"}</span>
          </span>
        }
      />

      <Panel title="Identity" id="identity">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <IdentityRow label="Arena ID">
            <span className="num">#{a.agentId}</span>
          </IdentityRow>
          <IdentityRow label="ERC-8004 identity">
            {a.erc8004Id == null ? (
              <span className="text-fg-muted">Not linked</span>
            ) : registry ? (
              <a className="inline-flex items-center gap-1 text-accent hover:underline" href={`${explorerUrl(network, "address", registry)}?tab=inventory`} target="_blank" rel="noopener noreferrer">
                <span className="num">#{a.erc8004Id}</span> <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : (
              <span title="The ERC-8004 registry address on Injective is pending verification, so there is no explorer link yet.">
                <span className="num">#{a.erc8004Id}</span> <span className="text-xs text-fg-subtle">registry link pending</span>
              </span>
            )}
          </IdentityRow>
          <IdentityRow label="Operator">
            <a className="num inline-flex items-center gap-1 text-accent hover:underline" href={explorerUrl(network, "address", a.operator)} target="_blank" rel="noopener noreferrer">
              {shortHex(a.operator)} <ExternalLink className="size-3" aria-hidden />
            </a>
          </IdentityRow>
          <IdentityRow label="Enrolled">{formatUtc(a.enrolledAt)}</IdentityRow>
          <IdentityRow label="Injective address">
            <span className="num" title={a.injAddress}>
              {shortHex(a.injAddress, 8, 6)}
            </span>
          </IdentityRow>
          <IdentityRow label="Subaccount">
            <span className="num" title={a.subaccountId}>
              {shortHex(a.subaccountId, 8, 6)}
            </span>
          </IdentityRow>
          <div className="flex flex-col gap-0.5 sm:col-span-2">
            <dt className="text-xs text-fg-subtle">Markets</dt>
            <dd className="flex flex-wrap gap-1.5">
              {a.marketIds.map((m) => (
                <Link key={m} href={`/markets/${m}${network === "mainnet" ? "?network=mainnet" : ""}`} className="num rounded-md border border-border px-2 py-0.5 text-xs text-fg-muted hover:border-border-strong hover:text-fg">
                  {shortHex(m, 8, 4)}
                </Link>
              ))}
            </dd>
          </div>
        </dl>
      </Panel>

      <section aria-label="Metrics, latest epoch" className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-border bg-border lg:grid-cols-4">
        {latest ? (
          (
            [
              ["score", formatScore(latest.score), (s: EpochScore) => s.score],
              ["quotedSpreadBps", formatBps(latest.metrics.quotedSpreadBps), (s: EpochScore) => s.metrics.quotedSpreadBps],
              ["depthUsd25", formatUsd(latest.metrics.depthUsd25), (s: EpochScore) => s.metrics.depthUsd25],
              ["uptimeBps", formatUptime(latest.metrics.uptimeBps), (s: EpochScore) => s.metrics.uptimeBps],
              ["bookShare", formatPct(latest.metrics.bookShare), (s: EpochScore) => s.metrics.bookShare],
              ["markout60s", formatUsdSigned(latest.metrics.markout60s), (s: EpochScore) => s.metrics.markout60s],
              ["pnlUsd", formatUsdSigned(latest.metrics.pnlUsd), (s: EpochScore) => s.metrics.pnlUsd],
              ["maxDrawdownUsd", formatUsd(latest.metrics.maxDrawdownUsd), (s: EpochScore) => s.metrics.maxDrawdownUsd],
            ] as const
          ).map(([k, v, pick]) => (
            <div key={k} className="bg-surface p-5">
              <Stat metric={k} value={v} spark={series(d.scores, pick)} sparkLabel={`Last ${Math.min(24, d.scores.length)} epochs`} />
            </div>
          ))
        ) : (
          <div className="col-span-full bg-surface p-5">
            <EmptyState title="No scored epochs yet" detail="Metrics appear after this agent's first hourly epoch is scored." className="border-0 p-0" />
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <Panel title="Live quotes" id="quotes" aside={<span className="text-xs text-fg-subtle">{d.liveQuotes.length} orders resting</span>}>
          {d.liveQuotes.length ? (
            <QuotesVisual quotes={d.liveQuotes} />
          ) : (
            <EmptyState title="Not quoting right now" detail={a.status === "active" ? "The agent has no resting orders at this moment." : `The agent is ${a.status}.`} className="border-0 p-0" />
          )}
        </Panel>
        <Panel title="Verify my score" id="verify">
          <VerifyScore scores={d.scores} network={network} />
        </Panel>
      </div>

      <Panel title={<InfoTip metric="score">Score history</InfoTip>} id="history">
        {d.scores.length ? <ScoreHistory scores={d.scores} /> : <EmptyState title="No history yet" detail="One bar appears per scored epoch." className="border-0 p-0" />}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Guard events" id="guards">
          {d.guardEvents.length ? (
            <GuardTimeline events={d.guardEvents} />
          ) : (
            <EmptyState title="No guard events" detail="Oracle, session and risk guards have not intervened for this agent." className="border-0 p-0" />
          )}
        </Panel>
        <Panel title="AI Risk Tuner" id="tuner" aside={<span className="text-xs text-fg-subtle">Suggestions are bounded and never place trades</span>}>
          {d.tunerEvents.length ? (
            <TunerFeed events={d.tunerEvents} />
          ) : (
            <EmptyState title="No tuner suggestions" detail="The tuner has not proposed parameter changes for this agent." className="border-0 p-0" />
          )}
        </Panel>
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

export function AgentSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading agent">
      <Skeleton style={{ height: 20, width: 64 }} />
      <div className="flex flex-col gap-3">
        <Skeleton style={{ height: 20, width: 160 }} />
        <Skeleton style={{ height: 44, width: 280 }} />
        <Skeleton style={{ height: 18, width: 220 }} />
      </div>
      <Skeleton style={{ height: 170, borderRadius: 14 }} />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-border bg-border lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="bg-surface p-5">
            <StatSkeleton withSpark />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <Skeleton style={{ height: 260, borderRadius: 14 }} />
        <Skeleton style={{ height: 260, borderRadius: 14 }} />
      </div>
    </div>
  );
}
