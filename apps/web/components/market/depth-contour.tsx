import type { BookSnapshot } from "@strata/sdk";
import { formatPrice } from "@/lib/format";
import { buildDepthProfile, type ProfilePoint } from "./depth-profile";

const W = 600;
const H = 200;
const PAD = { l: 8, r: 8, t: 14, b: 22 };

/**
 * The book in section: cumulative size stepping away from the mid, bids on the left in
 * malachite, asks on the right in oxide, with dashed iso-depth contours at quarters of the
 * deeper side and the STRATA share drawn as an ochre bed along the floor.
 */
export function DepthContour({ book }: { book: BookSnapshot }) {
  const p = buildDepthProfile(book);
  if (!p || p.maxCumulative <= 0) return null;
  // Each side's last step runs out to the frame edge, so a one-level book still reads as a bed.
  const edge = Math.max((p.maxPrice - p.minPrice) * 0.12, p.maxPrice * 0.0004, 1e-9);
  const lo = p.minPrice - edge;
  const hi = p.maxPrice + edge;
  const x = (price: number) => PAD.l + ((price - lo) / (hi - lo)) * (W - PAD.l - PAD.r);
  const y = (q: number) => H - PAD.b - (q / p.maxCumulative) * (H - PAD.t - PAD.b);
  const floor = H - PAD.b;

  // Stepped outline from the inside (best price) outward, closed to the floor.
  const step = (pts: ProfilePoint[], key: "cumulative" | "strataCumulative", outer: number) => {
    if (pts.length === 0) return "";
    let d = `M ${x(pts[0]!.price).toFixed(1)} ${floor}`;
    pts.forEach((pt, i) => {
      const next = pts[i + 1]?.price ?? outer;
      d += ` V ${y(pt[key]).toFixed(1)} H ${x(next).toFixed(1)}`;
    });
    return `${d} V ${floor} Z`;
  };
  const mid = book.mid != null ? Number(book.mid) : null;
  const hasStrata = (p.bids.at(-1)?.strataCumulative ?? 0) + (p.asks.at(-1)?.strataCumulative ?? 0) > 0;

  return (
    <figure className="m-0 mb-5">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby="depth-contour-desc">
        <desc id="depth-contour-desc">
          Cumulative depth: {p.bids.length} bid levels down to {formatPrice(String(p.minPrice))} and {p.asks.length} ask levels up to{" "}
          {formatPrice(String(p.maxPrice))}, deepest side {p.maxCumulative.toFixed(3)} in base units.
          {hasStrata ? " STRATA agents provide part of this size." : " No size from STRATA agents."}
        </desc>
        {p.contours.map((c, i) => (
          <g key={c}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(c)} y2={y(c)} className={i === p.contours.length - 1 ? "stroke-border-strong" : "stroke-border"} strokeDasharray="2 4" />
            <text x={W - PAD.r} y={y(c) - 4} textAnchor="end" className="fill-fg-subtle coord">
              {c.toFixed(c >= 100 ? 0 : 3)}
            </text>
          </g>
        ))}
        <path d={step(p.bids, "cumulative", lo)} className="fill-bid/12 stroke-bid" strokeWidth={1.25} />
        <path d={step(p.asks, "cumulative", hi)} className="fill-ask/12 stroke-ask" strokeWidth={1.25} />
        {hasStrata ? (
          <>
            <path d={step(p.bids, "strataCumulative", lo)} className="fill-accent/40 stroke-accent" strokeWidth={1} />
            <path d={step(p.asks, "strataCumulative", hi)} className="fill-accent/40 stroke-accent" strokeWidth={1} />
          </>
        ) : null}
        <line x1={PAD.l} x2={W - PAD.r} y1={floor} y2={floor} className="stroke-border-strong" />
        {mid !== null && Number.isFinite(mid) && mid >= lo && mid <= hi ? (
          <g>
            <line x1={x(mid)} x2={x(mid)} y1={PAD.t} y2={floor} className="stroke-fg-subtle" strokeDasharray="1 3" />
            <text x={x(mid)} y={H - 6} textAnchor="middle" className="fill-fg-muted coord">
              mid {formatPrice(String(mid))}
            </text>
          </g>
        ) : null}
        <text x={PAD.l} y={H - 6} className="fill-bid coord">bids</text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-ask coord">asks</text>
      </svg>
      <figcaption className="mt-2 text-xs text-fg-subtle">Cumulative size per side, dashed contours at quarters of the deeper side.</figcaption>
    </figure>
  );
}
