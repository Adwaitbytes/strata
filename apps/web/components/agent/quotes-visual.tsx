import type { Quote } from "@strata/sdk";
import { formatBps, formatPrice, shortHex } from "@/lib/format";
import { buildQuoteLadders, type QuoteLadder } from "./quote-ladders";

/**
 * The agent's resting orders, one ladder per market so no mid or spread ever mixes two books.
 */
export function QuotesVisual({ quotes, tickers }: { quotes: Quote[]; tickers: ReadonlyMap<string, string> }) {
  const ladders = buildQuoteLadders(quotes, tickers);
  return (
    <div className="flex flex-col gap-6">
      {ladders.map((ladder) => (
        <Ladder key={ladder.marketId} ladder={ladder} />
      ))}
    </div>
  );
}

/**
 * Stacked layers: bids grow left from the mid, asks grow right, one layer per level.
 * Width is quantity relative to the largest order in this market.
 */
function Ladder({ ladder }: { ladder: QuoteLadder }) {
  const { quotes: live, levels, maxQty, mid, spreadBps } = ladder;
  const name = ladder.ticker ?? shortHex(ladder.marketId, 8, 4);
  return (
    <section aria-label={`Live quotes, ${name}`}>
      <h3 className="num mb-2 text-xs font-medium text-fg" title={ladder.marketId}>
        {name}
      </h3>
      <div className="mb-4 flex items-baseline justify-between text-xs text-fg-muted">
        <span>
          Mid <span className="num text-fg">{mid ? mid.toFixed(4) : "n/a"}</span>
        </span>
        <span>
          Quoted spread <span className="num text-fg">{formatBps(spreadBps)}</span>
        </span>
      </div>
      <div className="grid grid-cols-[1fr_1px_1fr] gap-x-3" role="table" aria-label={`Live quotes by level, ${name}`}>
        <div role="row" className="contents">
          <span role="columnheader" className="pb-2 text-right text-[11px] text-bid">
            Bids
          </span>
          <span aria-hidden />
          <span role="columnheader" className="pb-2 text-[11px] text-ask">
            Asks
          </span>
        </div>
        {levels.map((level) => {
          const bid = live.find((q) => q.level === level && q.side === "buy");
          const ask = live.find((q) => q.level === level && q.side === "sell");
          return (
            <div role="row" key={level} className="contents">
              <div role="cell" className="relative flex h-8 items-center justify-end overflow-hidden rounded-l-md">
                {bid ? (
                  <>
                    <span aria-hidden className="absolute inset-y-1 right-0 rounded-l-[4px] bg-bid-soft ring-1 ring-inset ring-bid/25" style={{ width: `${(Number(bid.quantity) / maxQty) * 100}%`, opacity: 1 - level * 0.18 }} />
                    <span className="num relative pr-2 text-xs text-fg">
                      {formatPrice(bid.price)} <span className="text-fg-muted">x {bid.quantity}</span>
                    </span>
                  </>
                ) : null}
              </div>
              <span aria-hidden className="bg-border-strong" />
              <div role="cell" className="relative flex h-8 items-center overflow-hidden rounded-r-md">
                {ask ? (
                  <>
                    <span aria-hidden className="absolute inset-y-1 left-0 rounded-r-[4px] bg-ask-soft ring-1 ring-inset ring-ask/25" style={{ width: `${(Number(ask.quantity) / maxQty) * 100}%`, opacity: 1 - level * 0.18 }} />
                    <span className="num relative pl-2 text-xs text-fg">
                      {formatPrice(ask.price)} <span className="text-fg-muted">x {ask.quantity}</span>
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
