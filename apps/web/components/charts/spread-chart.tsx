"use client";

import type { LiquiditySample, NetworkName, Provenance } from "@strata/sdk";
import { ProvenanceBadge, Skeleton } from "@strata/ui/data";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useThemeTokens, withAlpha } from "@/hooks/use-theme-tokens";
import { formatBps, formatUtc } from "@/lib/format";
import { classifySample, noStrataLabel, type SampleKind } from "@/lib/liquidity";
import { splitSpreadSeries } from "./spread-series";

interface Props {
  history: LiquiditySample[];
  baselineSpreadBps: number | null;
  network: NetworkName;
  height?: number;
}

interface Hover {
  at: number;
  spread: number;
  label: string;
}

/**
 * Market spread over time (TradingView Lightweight Charts, loaded on demand). Samples recorded
 * before STRATA quoted are drawn as a muted BASELINE band; the dashed line is the baseline
 * average. The accent line is drawn only where STRATA agents had depth on the book; later
 * samples without STRATA depth get a neutral dashed line labeled by provenance and network. A data table carries the same values for
 * screen readers and for anyone who prefers numbers.
 */
export function SpreadChart({ history, baselineSpreadBps, network, height = 280 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const tokens = useThemeTokens();
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);

  const points = useMemo(
    () =>
      history
        .filter((s): s is LiquiditySample & { spreadBps: number } => s.spreadBps != null)
        .map((s) => ({ time: Math.floor(s.at / 1000) as UTCTimestamp, value: s.spreadBps, kind: classifySample(s), provenance: s.provenance })),
    [history],
  );
  // Name the no-STRATA line after the provenance its samples actually carry.
  const noStrataProvenance: Provenance = points.find((p) => p.kind === "no_strata")?.provenance ?? (network === "mainnet" ? "LIVE" : "TESTNET");
  const noStrataName = noStrataLabel(noStrataProvenance, network);
  const labelFor = (kind: SampleKind) => (kind === "baseline" ? "Before STRATA" : kind === "strata" ? "With STRATA" : noStrataName);

  useEffect(() => {
    const el = ref.current;
    if (!el || !tokens || points.length === 0) return;
    let disposed = false;
    let ro: ResizeObserver | null = null;
    void import("lightweight-charts").then(({ createChart, AreaSeries, LineSeries, LineStyle, CrosshairMode }) => {
      if (disposed) return;
      const chart = createChart(el, {
        height,
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: tokens["--fg-subtle"], fontFamily: tokens["--font-mono-face"] || "ui-monospace, monospace", fontSize: 11, attributionLogo: true },
        grid: { vertLines: { visible: false }, horzLines: { color: tokens["--border"] } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
        crosshair: {
          mode: CrosshairMode.Magnet,
          vertLine: { color: tokens["--fg-subtle"], labelBackgroundColor: tokens["--surface"], style: LineStyle.Dotted },
          horzLine: { color: tokens["--fg-subtle"], labelBackgroundColor: tokens["--surface"], style: LineStyle.Dotted },
        },
        handleScroll: false,
        handleScale: false,
      });
      chartRef.current = chart;
      const fmt = { type: "custom" as const, formatter: (p: number) => `${p.toFixed(1)}`, minMove: 0.1 };

      const { baseline: baselinePts, strata, noStrata } = splitSpreadSeries(points);
      // A series is added only when it has data: a price line on an empty series throws "Value is null".
      const area =
        baselinePts.length > 0
          ? chart.addSeries(AreaSeries, {
              lineColor: tokens["--baseline"],
              topColor: withAlpha(tokens["--baseline"], 0.28),
              bottomColor: withAlpha(tokens["--baseline"], 0.04),
              lineWidth: 2,
              priceFormat: fmt,
              lastValueVisible: false,
              priceLineVisible: false,
            })
          : null;
      area?.setData(baselinePts.map(({ time, value }) => ({ time, value })));
      const muted =
        noStrata.length > 0
          ? chart.addSeries(LineSeries, { color: tokens["--fg-subtle"], lineWidth: 2, lineStyle: LineStyle.Dashed, priceFormat: fmt, priceLineVisible: false, lastValueVisible: strata.length === 0 })
          : null;
      muted?.setData(noStrata);
      const line =
        strata.length > 0
          ? chart.addSeries(LineSeries, { color: tokens["--accent"], lineWidth: 2, priceFormat: fmt, priceLineVisible: false })
          : null;
      line?.setData(strata);
      const priceLineHost = line ?? muted ?? area;
      if (baselineSpreadBps != null && priceLineHost) {
        priceLineHost.createPriceLine({
          price: baselineSpreadBps,
          color: tokens["--baseline"],
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          axisLabelVisible: true,
          title: "Baseline avg",
        });
      }
      chart.timeScale().fitContent();
      chart.subscribeCrosshairMove((param) => {
        if (!param.time) return setHover(null);
        const t = (param.time as number) * 1000;
        const p = points.find((x) => x.time === param.time);
        if (p) setHover({ at: t, spread: p.value, label: labelFor(p.kind) });
      });
      ro = new ResizeObserver(() => chart.timeScale().fitContent());
      ro.observe(el);
      setReady(true);
    });
    return () => {
      disposed = true;
      ro?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      setReady(false);
    };
    // labelFor only reads noStrataName, which is derived from points and network.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, tokens, height, baselineSpreadBps, noStrataName]);

  const withStrata = points.filter((p) => p.kind === "strata");
  const strataAvg = withStrata.length ? withStrata.reduce((a, b) => a + b.value, 0) / withStrata.length : null;
  const kinds = new Set(points.map((p) => p.kind));
  const summary =
    points.length === 0
      ? "No spread samples yet."
      : `Market spread over the last ${Math.round((points[points.length - 1]!.time - points[0]!.time) / 3600)} hours. ${
          baselineSpreadBps != null ? `Baseline average ${formatBps(baselineSpreadBps)}. ` : ""
        }${strataAvg != null ? `Average while STRATA had depth on the book ${formatBps(strataAvg)}.` : "STRATA agents had no depth on the book in this window."}`;

  return (
    <figure className="m-0">
      <div className="mb-3 flex min-h-6 flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fg-muted">
        {kinds.has("strata") ? (
          <span className="inline-flex items-center gap-2" data-testid="legend-strata">
            <span aria-hidden className="h-0.5 w-4 rounded-full bg-accent" /> With STRATA
          </span>
        ) : null}
        {kinds.has("no_strata") ? (
          <span className="inline-flex items-center gap-2" data-testid="legend-no-strata">
            <span aria-hidden className="w-4 border-t-2 border-dashed border-fg-subtle" /> {noStrataName}
          </span>
        ) : null}
        {kinds.has("baseline") ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-4 rounded-sm bg-baseline-soft ring-1 ring-baseline/60" /> Before STRATA
            <ProvenanceBadge provenance="BASELINE" />
          </span>
        ) : null}
        <span className="num ml-auto text-fg" aria-live="off">
          {hover ? `${formatUtc(hover.at)}  ${formatBps(hover.spread)}  ${hover.label}` : ""}
        </span>
      </div>
      <div className="relative" style={{ height }}>
        {!ready && points.length > 0 ? <Skeleton style={{ position: "absolute", inset: 0, borderRadius: 8 }} /> : null}
        <div ref={ref} className="absolute inset-0" />
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
      <details className="mt-3 text-xs text-fg-muted">
        <summary className="cursor-pointer select-none hover:text-fg">Show data table</summary>
        <div className="mt-2 max-h-56 overflow-auto rounded-md border border-border">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-surface">
              <tr>
                <th className="px-3 py-1.5 font-normal">Time</th>
                <th className="px-3 py-1.5 text-right font-normal">Spread</th>
                <th className="px-3 py-1.5 font-normal">Label</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={`${p.time}-${i}`} className="border-t border-border">
                  <td className="px-3 py-1">{formatUtc(p.time * 1000)}</td>
                  <td className="num px-3 py-1 text-right text-fg">{formatBps(p.value)}</td>
                  <td className="px-3 py-1">{labelFor(p.kind)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
