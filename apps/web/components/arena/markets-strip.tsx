"use client";

import type { MarketSummary, NetworkName } from "@strata/sdk";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { formatBps, formatPct } from "@/lib/format";

export function MarketsStrip({ markets, network }: { markets: MarketSummary[]; network: NetworkName }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {markets.map(({ market, now, baseline }) => {
        const share = now?.strataBookShare ?? 0;
        return (
          <li key={market.marketId}>
            <Link
              href={`/markets/${market.marketId}${network === "mainnet" ? "?network=mainnet" : ""}`}
              className="group flex h-full flex-col gap-4 rounded-[var(--radius-md)] border border-border bg-bg-raised p-4 transition-colors hover:border-border-strong hover:bg-surface focus-visible:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              data-testid="market-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="block truncate font-medium text-fg">{market.ticker}</span>
                  <span className="text-xs capitalize text-fg-subtle">{market.assetClass}</span>
                </div>
                <ArrowUpRight aria-hidden className="size-4 shrink-0 text-fg-subtle transition-[color,transform] duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fg" />
              </div>
              <dl className="grid grid-cols-3 gap-3 text-[13px]">
                <div>
                  <dt className="text-xs text-fg-subtle">Spread</dt>
                  <dd className="num mt-0.5 text-fg">{formatBps(now?.spreadBps)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-subtle">Baseline</dt>
                  <dd className="num mt-0.5 text-fg-muted">{formatBps(baseline?.spreadBps)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-subtle">STRATA share</dt>
                  <dd className="num mt-0.5 text-fg-muted">{formatPct(now?.strataBookShare)}</dd>
                </div>
              </dl>
              <span aria-hidden className="mt-auto block h-[2px] overflow-hidden rounded-full bg-border">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
