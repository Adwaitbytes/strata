import type { BookSnapshot } from "@strata/sdk";

/**
 * Cumulative depth profile of an order book, the cross-section the market page draws as a
 * contour chart. Pure so it is unit tested; prices and sizes stay in the book's own units.
 */
export interface ProfilePoint {
  price: number;
  cumulative: number;
  strataCumulative: number;
}

export interface DepthProfile {
  bids: ProfilePoint[];
  asks: ProfilePoint[];
  minPrice: number;
  maxPrice: number;
  maxCumulative: number;
  /** Iso-depth lines (contours) at fixed fractions of the deepest side. */
  contours: number[];
}

const CONTOUR_FRACTIONS = [0.25, 0.5, 0.75, 1] as const;

function cumulate(levels: BookSnapshot["bids"], rows: number): ProfilePoint[] {
  let total = 0;
  let strata = 0;
  const out: ProfilePoint[] = [];
  for (const l of levels.slice(0, rows)) {
    const price = Number(l.price);
    const qty = Number(l.quantity);
    if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
    total += qty;
    strata += Math.min(qty, Number(l.strataQuantity) || 0);
    out.push({ price, cumulative: total, strataCumulative: strata });
  }
  return out;
}

export function buildDepthProfile(book: Pick<BookSnapshot, "bids" | "asks">, rows = 20): DepthProfile | null {
  const bids = cumulate(book.bids, rows);
  const asks = cumulate(book.asks, rows);
  if (bids.length === 0 && asks.length === 0) return null;
  const prices = [...bids, ...asks].map((p) => p.price);
  const maxCumulative = Math.max(bids.at(-1)?.cumulative ?? 0, asks.at(-1)?.cumulative ?? 0);
  return {
    bids,
    asks,
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    maxCumulative,
    contours: maxCumulative > 0 ? CONTOUR_FRACTIONS.map((f) => f * maxCumulative) : [],
  };
}
