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
      <div className="rounded-lg border border-border bg-bg-raised p-5 shadow-1 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div role="group" aria-label="Metric" className="relative grid grid-cols-2 rounded-md border border-border p-0.5">
            {/* Sliding pill: a CSS transform, so the landing ships no animation library up front. */}
            <span
              aria-hidden
              className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-sm bg-surface-hover shadow-1 transition-transform duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ transform: metric === "depth" ? "translateX(100%)" : "none" }}
            />
            {METRICS.map((x) => (
              <button
                key={x.id}
                type="button"
                aria-pressed={metric === x.id}
                onClick={() => setMetric(x.id)}
                className="relative h-8 rounded-sm px-4 text-sm text-fg-muted transition-colors duration-150 aria-pressed:text-fg"
              >
                {x.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4 text-micro text-fg-muted">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-3 rounded-[2px] bg-baseline/60" /> Baseline
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-3 rounded-[2px] bg-accent" /> With agents
            </span>
            <span className="text-fg-subtle">{current?.better}</span>
          </div>
        </div>

        <table className="mt-6 w-full border-collapse text-sm">
          <caption className="sr-only">
            {current?.label} per market, baseline window versus now with STRATA agents quoting.
          </caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Market</th>
              <th scope="col">Baseline</th>
              <th scope="col">With agents</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = pick(r, metric);
              return (
                <tr key={r.marketId} className="border-t border-border first:border-t-0">
                  <th scope="row" className="w-28 py-3 pr-4 text-left align-top font-normal text-fg sm:w-36">
                    {r.symbol}
                  </th>
                  <td className="py-3" colSpan={2}>
                    <div className="grid gap-1.5">
                      {(["before", "after"] as const).map((k) => {
                        const v = p[k];
                        return (
                          <div key={k} className="flex items-center gap-3">
                            <div className="h-2.5 flex-1">
                              <div
                                className={`h-full origin-left rounded-[2px] transition-transform duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${k === "before" ? "bg-baseline/60" : "bg-accent"}`}
                                style={{ transform: `scaleX(${(v ?? 0) / max})` }}
                              />
                            </div>
                            <span className="num w-20 text-right text-micro text-fg-muted">
                              <span className="sr-only">{k === "before" ? "Baseline " : "With agents "}</span>
                              {fmt(metric, v)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
  );
}
