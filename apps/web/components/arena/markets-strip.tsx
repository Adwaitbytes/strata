"use client";

import type { MarketSummary, NetworkName } from "@strata/sdk";
import Link from "next/link";
import { InfoTip } from "@/components/data/info-tip";
import { formatBps, formatPct } from "@/lib/format";

export function MarketsStrip({ markets, network }: { markets: MarketSummary[]; network: NetworkName }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {markets.map(({ market, now, baseline }) => (
        <li key={market.marketId}>
          <Link
            href={`/markets/${market.marketId}${network === "mainnet" ? "?network=mainnet" : ""}`}
            className="group flex h-full flex-col gap-4 rounded-xl border border-border bg-bg-raised p-4 transition-colors hover:border-border-strong hover:bg-surface"
            data-testid="market-card"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate font-medium text-fg">{market.ticker}</span>
              <span className="text-xs capitalize text-fg-subtle">{market.assetClass}</span>
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
                <dd className="num mt-0.5 text-accent">{formatPct(now?.strataBookShare)}</dd>
              </div>
            </dl>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function MarketsHeading() {
  return (
    <h2 className="text-sm font-medium text-fg">
      <InfoTip metric="marketSpread">Markets</InfoTip>
    </h2>
  );
}
