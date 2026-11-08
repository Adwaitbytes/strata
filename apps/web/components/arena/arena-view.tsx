"use client";

import type { LeaderboardResponse } from "@strata/sdk";
import { Skeleton } from "@strata/ui/data";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DataLabels } from "@/components/data/labels";
import { LiveIndicator } from "@/components/data/live-indicator";
import { NetworkToggle } from "@/components/data/network-toggle";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState, ErrorState } from "@/components/data/states";
import { useLiveQuery } from "@/hooks/use-live-query";
import { useNetwork } from "@/hooks/use-network";
import { api } from "@/lib/api/client";
import { dominantProvenance } from "@/lib/api/provenance";
import { Leaderboard, LeaderboardSkeleton } from "./leaderboard";
import { MarketsHeading, MarketsStrip } from "./markets-strip";
import { SeasonTimer } from "./season-timer";

const ALL = "all";

export function ArenaView() {
  const [network] = useNetwork();
  const [market, setMarket] = useState<string>(ALL);

  const board = useLiveQuery<LeaderboardResponse>({
    queryKey: ["leaderboard", network],
    network,
    fetcher: ({ signal, tick }) => api.leaderboard(network, { signal, tick }),
    channel: "leaderboard",
    apply: (prev, msg) => (msg.type === "leaderboard" ? { ...prev, rows: msg.data, at: Date.now() } : prev),
  });
  const markets = useQuery({ queryKey: ["markets", network], queryFn: ({ signal }) => api.markets(network, { signal }) });

  const rows = useMemo(() => {
    const all = board.data?.rows ?? [];
    return market === ALL ? all : all.filter((r) => r.marketIds.includes(market));
  }, [board.data, market]);

  const provenance = board.data ? dominantProvenance(board.data.rows.map((r) => r.provenance)) : null;
  const marketOptions = markets.data?.markets ?? [];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        meta={
          <>
            <DataLabels network={network} provenance={provenance} />
            <LiveIndicator network={network} className="ml-1" />
          </>
        }
        title="Arena"
        description="Agents quote real Injective order books and are scored every hour on depth, uptime, spread and fill quality. Scores are committed onchain so anyone can check them."
        actions={<NetworkToggle />}
      />

      <div className="flex flex-col gap-6 rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-[var(--shadow-1)] sm:flex-row sm:items-end sm:justify-between">
        {board.data ? (
          <SeasonTimer season={board.data.season} endsAt={board.data.seasonEndsAt} />
        ) : (
          <div className="flex flex-col gap-1">
            <Skeleton style={{ height: 16, width: 140 }} />
            <Skeleton style={{ height: 22, width: 120 }} />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-fg-muted">Latest scored epoch</span>
          <span className="num text-[22px] font-medium leading-none text-fg">
            {board.data ? (board.data.epoch == null ? "None yet" : `#${board.data.epoch}`) : <Skeleton style={{ height: 22, width: 48 }} />}
          </span>
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] text-fg-muted">
          Market
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            className="h-9 min-w-[200px] rounded-lg border border-border-strong bg-bg-sunken px-3 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus"
          >
            <option value={ALL}>All markets</option>
            {marketOptions.map((m) => (
              <option key={m.market.marketId} value={m.market.marketId}>
                {m.market.ticker}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section aria-labelledby="leaderboard-title" aria-busy={board.isPending}>
        <h2 id="leaderboard-title" className="sr-only">
          Leaderboard
        </h2>
        {board.isPending ? (
          <LeaderboardSkeleton />
        ) : board.isError && !board.data ? (
          <ErrorState error={board.error} onRetry={() => void board.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={market === ALL ? `No agents scored on ${network} yet` : "No agents quote this market"}
            detail={
              market === ALL
                ? network === "mainnet"
                  ? "STRATA runs on testnet today. Mainnet agents appear here once the arena is funded and the first epoch is attested."
                  : "Agents appear after their first scored epoch, about an hour after they start quoting."
                : "Pick another market or show all markets."
            }
            action={
              <Link href="/join" className="text-sm font-medium text-accent underline-offset-4 hover:underline">
                Enroll an agent
              </Link>
            }
          />
        ) : (
          <Leaderboard rows={rows} network={network} pageProvenance={provenance} />
        )}
      </section>

      {marketOptions.length > 0 ? (
        <section aria-labelledby="markets-title" className="flex flex-col gap-4">
          <div id="markets-title">
            <MarketsHeading />
          </div>
          <MarketsStrip markets={marketOptions} network={network} />
        </section>
      ) : null}
    </div>
  );
}
