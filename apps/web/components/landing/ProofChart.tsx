"use client";

import { useState } from "react";
import { formatBps, formatUsdCompact, type ProofRow } from "./model";

type Metric = "spread" | "depth";

const METRICS: { id: Metric; label: string; better: string }[] = [
  { id: "spread", label: "Spread", better: "Lower is better" },
  { id: "depth", label: "Depth", better: "Higher is better" },
];

function pick(row: ProofRow, metric: Metric): { before: number | null; after: number | null } {
  return metric === "spread"
    ? { before: row.baselineSpreadBps, after: row.nowSpreadBps }
    : { before: row.baselineDepthUsd, after: row.nowDepthUsd };
}

function fmt(metric: Metric, v: number | null): string {
  if (v === null) return "No reading";
  return metric === "spread" ? formatBps(v).replace("+", "") : formatUsdCompact(v);
}

export function ProofChart({ rows }: { rows: ProofRow[] }) {
  const [metric, setMetric] = useState<Metric>("spread");
  const max = Math.max(
    1e-9,
    ...rows.flatMap((r) => {
      const p = pick(r, metric);
      return [p.before ?? 0, p.after ?? 0];
    }),
  );
  const current = METRICS.find((x) => x.id === metric);

  return (
    <div className="instrument p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div role="group" aria-label="Metric" className="relative grid grid-cols-2 rounded-sm border border-border p-0.5">
          {/* Sliding marker: a CSS transform, so the landing ships no animation library up front. */}
          <span
            aria-hidden
            className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-xs bg-surface-hover shadow-1 transition-transform duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ transform: metric === "depth" ? "translateX(100%)" : "none" }}
          />
          {METRICS.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={metric === x.id}
              onClick={() => setMetric(x.id)}
              className="relative h-8 rounded-xs px-4 text-sm text-fg-muted transition-colors duration-150 aria-pressed:text-fg"
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 text-micro text-fg-muted">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="core-key core-bed-baseline" /> Baseline
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="core-key core-bed-strata" /> With STRATA
          </span>
          <span className="text-fg-subtle">{current?.better}</span>
        </div>
      </div>

      <div className="cores mt-6" aria-hidden>
        {rows.map((r) => {
          const p = pick(r, metric);
          return (
            <div key={r.marketId} className="core core-pair">
              <div className="flex h-full items-end gap-1.5">
                <div className="core-tube">
                  <span className="core-bed core-bed-baseline" style={{ height: `${((p.before ?? 0) / max) * 100}%` }} />
                </div>
                <div className="core-tube">
                  <span className="core-bed core-bed-strata" style={{ height: `${((p.after ?? 0) / max) * 100}%` }} />
                </div>
              </div>
              <span className="core-label text-fg">{r.symbol}</span>
              <span className="core-value num">
                {fmt(metric, p.before)} / {fmt(metric, p.after)}
              </span>
            </div>
          );
        })}
      </div>

      <table className="sr-only">
        <caption>{current?.label} per market, baseline window versus now with STRATA agents quoting.</caption>
        <thead>
          <tr>
            <th scope="col">Market</th>
            <th scope="col">Baseline</th>
            <th scope="col">With STRATA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const p = pick(r, metric);
            return (
              <tr key={r.marketId}>
                <th scope="row">{r.symbol}</th>
                <td>{fmt(metric, p.before)}</td>
                <td>{fmt(metric, p.after)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
