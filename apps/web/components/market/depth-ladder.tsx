import type { BookLevel, BookSnapshot } from "@strata/sdk";
import { formatPrice } from "@/lib/format";

interface Row {
  level: BookLevel;
  cumulative: number;
}

function cumulate(levels: BookLevel[]): Row[] {
  let total = 0;
  return levels.map((level) => {
    total += Number(level.quantity);
    return { level, cumulative: total };
  });
}

/**
 * Order book ladder. The pale band is cumulative depth; the solid inner band is the share of
 * each level resting from STRATA agents, so the "layers" read directly off the book.
 */
export function DepthLadder({ book, rows = 10 }: { book: BookSnapshot; rows?: number }) {
  const asks = cumulate(book.asks.slice(0, rows));
  const bids = cumulate(book.bids.slice(0, rows));
  const max = Math.max(asks[asks.length - 1]?.cumulative ?? 0, bids[bids.length - 1]?.cumulative ?? 0, 1e-9);

  const render = (r: Row, side: "bid" | "ask") => {
    const qty = Number(r.level.quantity);
    const strata = Number(r.level.strataQuantity);
    const tone = side === "bid" ? "bg-bid" : "bg-ask";
    return (
      <tr key={`${side}-${r.level.price}`} className="relative">
        <td className={`num relative py-[5px] pl-3 text-[13px] ${side === "bid" ? "text-bid" : "text-ask"}`}>
          <span aria-hidden className={`absolute inset-y-[2px] right-0 ${tone} opacity-[0.09]`} style={{ width: `${(r.cumulative / max) * 100}%` }} />
          <span aria-hidden className={`absolute inset-y-[7px] right-0 ${tone} opacity-60`} style={{ width: `${(strata / max) * 100}%` }} />
          <span className="relative">{formatPrice(r.level.price)}</span>
        </td>
        <td className="num relative py-[5px] text-right text-[13px] text-fg">{qty.toFixed(3)}</td>
        <td className="num relative py-[5px] text-right text-[13px] text-accent">{strata > 0 ? strata.toFixed(3) : <span className="text-fg-subtle">0</span>}</td>
        <td className="num relative py-[5px] pr-3 text-right text-[13px] text-fg-muted">{r.cumulative.toFixed(3)}</td>
      </tr>
    );
  };

  return (
    <div>
      <table className="w-full border-collapse">
        <caption className="sr-only">Order book: {rows} best asks above the spread, {rows} best bids below. STRATA column is quantity resting from STRATA agents.</caption>
        <thead>
          <tr className="text-[11px] text-fg-subtle">
            <th scope="col" className="w-[46%] pb-2 pl-3 text-left font-normal">Price</th>
            <th scope="col" className="pb-2 text-right font-normal">Size</th>
            <th scope="col" className="pb-2 text-right font-normal">STRATA</th>
            <th scope="col" className="pb-2 pr-3 text-right font-normal">Total</th>
          </tr>
        </thead>
        <tbody>{[...asks].reverse().map((r) => render(r, "ask"))}</tbody>
        <tbody>
          <tr>
            <td colSpan={4} className="border-y border-border py-2 pl-3 text-xs text-fg-muted">
              Mid <span className="num text-fg">{formatPrice(book.mid)}</span>
              <span className="ml-4">
                Spread <span className="num text-fg">{book.spreadBps == null ? "n/a" : `${book.spreadBps.toFixed(1)} bps`}</span>
              </span>
            </td>
          </tr>
        </tbody>
        <tbody>{bids.map((r) => render(r, "bid"))}</tbody>
      </table>
    </div>
  );
}
