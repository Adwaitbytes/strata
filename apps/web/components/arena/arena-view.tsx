"use client";

import type { LeaderboardResponse } from "@strata/sdk";
import { Skeleton } from "@strata/ui/data";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DataLabels } from "@/components/data/labels";
import { LiveIndicator } from "@/components/data/live-indicator";
import { NetworkToggle } from "@/components/data/network-toggle";
import { PageHeader, SectionTitle } from "@/components/data/page-header";
import { Select } from "@/components/data/select";
import { EmptyState, ErrorState } from "@/components/data/states";
import { useLiveQuery } from "@/hooks/use-live-query";
import { useNetwork } from "@/hooks/use-network";
import { api } from "@/lib/api/client";
import { dominantProvenance } from "@/lib/api/provenance";
import { Leaderboard, LeaderboardSkeleton } from "./leaderboard";
import { MarketsStrip } from "./markets-strip";
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
        description="Agents quote real Injective order books and get scored every hour on depth, uptime, spread and fill quality, with every score committed onchain for anyone to check"
        actions={<NetworkToggle />}
      />

      <dl className="flex flex-wrap gap-x-14 gap-y-5 border-y border-border py-5">
        <div>
          <dt className="sr-only">Season</dt>
          <dd>
            {board.data ? (
              <SeasonTimer season={board.data.season} endsAt={board.data.seasonEndsAt} />
            ) : (
              <div className="flex flex-col gap-2">
                <Skeleton style={{ height: 16, width: 140 }} />
                <Skeleton style={{ height: 28, width: 160 }} />
              </div>
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-2">
          <dt className="text-[13px] text-fg-muted">Latest scored epoch</dt>
          <dd className="num text-[28px] font-medium leading-none text-fg">
            {board.data ? (board.data.epoch == null ? "None yet" : `#${board.data.epoch}`) : <Skeleton style={{ height: 28, width: 56 }} />}
          </dd>
        </div>
        <div className="flex flex-col gap-2">
          <dt className="text-[13px] text-fg-muted">Agents ranked</dt>
          <dd className="num text-[28px] font-medium leading-none text-fg">{board.data ? board.data.rows.length : <Skeleton style={{ height: 28, width: 32 }} />}</dd>
        </div>
      </dl>

      <section aria-labelledby="leaderboard-title" aria-busy={board.isPending} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <SectionTitle id="leaderboard-title">Leaderboard</SectionTitle>
            {board.data ? (
              <span className="num text-[13px] text-fg-subtle" aria-live="polite" data-testid="row-count">
                {rows.length} of {board.data.rows.length}
              </span>
            ) : null}
          </div>
          <label className="flex items-center gap-2.5 text-[13px] text-fg-muted">
            Market
            <Select value={market} onChange={(e) => setMarket(e.target.value)} className="min-w-[220px]">
              <option value={ALL}>All markets</option>
              {marketOptions.map((m) => (
                <option key={m.market.marketId} value={m.market.marketId}>
                  {m.market.ticker}
                </option>
              ))}
            </Select>
          </label>
        </div>
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
                  ? "STRATA runs on testnet today, so mainnet agents show up once the arena is funded and the first epoch is attested"
                  : "Agents appear after their first scored epoch, about an hour after they start quoting"
                : "Pick another market or show all of them"
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
          <SectionTitle id="markets-title">Markets</SectionTitle>
          <MarketsStrip markets={marketOptions} network={network} />
        </section>
      ) : null}
    </div>
  );
}
