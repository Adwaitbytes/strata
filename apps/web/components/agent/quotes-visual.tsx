import type { Quote } from "@strata/sdk";
import { formatBps, formatPrice } from "@/lib/format";

/**
 * The agent's resting ladder as stacked layers: bids grow left from the mid, asks grow right,
 * one layer per level. Width is quantity relative to the largest order shown.
 */
export function QuotesVisual({ quotes }: { quotes: Quote[] }) {
  const live = quotes.filter((q) => q.cancelledAt == null);
  const levels = [...new Set(live.map((q) => q.level))].sort((a, b) => a - b);
  const maxQty = Math.max(...live.map((q) => Number(q.quantity)), 0);
  const bestBid = Math.max(...live.filter((q) => q.side === "buy").map((q) => Number(q.price)));
  const bestAsk = Math.min(...live.filter((q) => q.side === "sell").map((q) => Number(q.price)));
  const mid = Number.isFinite(bestBid) && Number.isFinite(bestAsk) ? (bestBid + bestAsk) / 2 : null;
  const spreadBps = mid ? ((bestAsk - bestBid) / mid) * 10_000 : null;

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between text-xs text-fg-muted">
        <span>
          Mid <span className="num text-fg">{mid ? mid.toFixed(4) : "n/a"}</span>
        </span>
        <span>
          Quoted spread <span className="num text-fg">{formatBps(spreadBps)}</span>
        </span>
      </div>
      <div className="grid grid-cols-[1fr_1px_1fr] gap-x-3" role="table" aria-label="Live quotes by level">
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
    </div>
  );
}
