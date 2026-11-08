"use client";

import type { LeaderboardRow, NetworkName } from "@strata/sdk";
import { NumberRoll, ProvenanceBadge, Skeleton } from "@strata/ui/data";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { InfoTip } from "@/components/data/info-tip";
import { formatBps, formatScore, formatUptime, formatUsd, formatUsdSigned } from "@/lib/format";
import type { MetricKey } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { RankDelta } from "./rank-delta";
import { StatusPill } from "./status-pill";

const COLUMNS: { key: MetricKey; label: string; align: "left" | "right"; className?: string }[] = [
  { key: "rank", label: "Rank", align: "left", className: "w-[72px]" },
  { key: "agent", label: "Agent", align: "left" },
  { key: "score", label: "Score", align: "right" },
  { key: "quotedSpreadBps", label: "Spread", align: "right" },
  { key: "depthUsd25", label: "Depth", align: "right" },
  { key: "uptimeBps", label: "Uptime", align: "right" },
  { key: "pnlUsd", label: "PnL", align: "right" },
  { key: "status", label: "Status", align: "left", className: "w-[132px]" },
];

const spring = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } as const;

function agentHref(row: LeaderboardRow, network: NetworkName) {
  return network === "testnet" ? `/agents/${row.agentId}` : `/agents/${row.agentId}?network=${network}`;
}

function ScoreBar({ score }: { score: number }) {
  return (
    <span aria-hidden className="mt-1.5 block h-[3px] w-full overflow-hidden rounded-full bg-border">
      <span className="block h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${score / 100}%` }} />
    </span>
  );
}

function AgentCell({ row, network, pageProvenance }: { row: LeaderboardRow; network: NetworkName; pageProvenance: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Link
        href={agentHref(row, network)}
        className="truncate font-medium text-fg underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
      >
        {row.name}
      </Link>
      <span className="shrink-0 rounded border border-border px-1.5 py-px text-[11px] text-fg-subtle">{row.kind === "house" ? "House" : "Third party"}</span>
      {row.provenance !== pageProvenance ? <ProvenanceBadge provenance={row.provenance} className="relative z-10" /> : null}
    </div>
  );
}

/** `pageProvenance` is the label already shown in the page header; rows only repeat a different one. */
export function Leaderboard({ rows, network, pageProvenance }: { rows: LeaderboardRow[]; network: NetworkName; pageProvenance: string | null }) {
  const reduce = useReducedMotion();
  const transition = reduce ? { duration: 0 } : spring;
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">Arena leaderboard on {network}, ranked by score in the latest epoch</caption>
          <thead>
            <tr>
              {COLUMNS.map((c, i) => (
                <th
                  key={`${c.label}-${i}`}
                  scope="col"
                  className={cn(
                    "border-b border-border px-4 pb-3 pt-1 text-[12px] font-normal text-fg-muted",
                    c.align === "right" ? "text-right" : "text-left",
                    c.className,
                  )}
                >
                  <InfoTip metric={c.key} side="bottom">
                    {c.label}
                  </InfoTip>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {rows.map((row) => (
                <motion.tr
                  key={row.agentId}
                  layout="position"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={transition}
                  data-testid="leaderboard-row"
                  className="group relative transition-colors hover:bg-surface-hover/60"
                >
                  <td className="border-b border-border px-4 py-3.5 align-middle">
                    <div className="flex items-center gap-2">
                      <span className="num w-6 text-[15px] text-fg">{row.rank}</span>
                      <RankDelta rank={row.rank} previous={row.previousRank} />
                    </div>
                  </td>
                  <td className="relative max-w-[280px] border-b border-border px-4 py-3.5">
                    <AgentCell row={row} network={network} pageProvenance={pageProvenance} />
                  </td>
                  <td className="w-[128px] border-b border-border px-4 py-3.5 text-right">
                    <NumberRoll value={formatScore(row.score)} className="num text-[15px] font-medium text-fg" />
                    <ScoreBar score={row.score} />
                  </td>
                  <td className="border-b border-border px-4 py-3.5 text-right">
                    <NumberRoll value={formatBps(row.quotedSpreadBps)} className="num text-fg-muted" />
                  </td>
                  <td className="border-b border-border px-4 py-3.5 text-right">
                    <NumberRoll value={formatUsd(row.depthUsd25)} className="num text-fg" />
                  </td>
                  <td className="border-b border-border px-4 py-3.5 text-right">
                    <NumberRoll value={formatUptime(row.uptimeBps)} className="num text-fg-muted" />
                  </td>
                  <td className="border-b border-border px-4 py-3.5 text-right">
                    <NumberRoll value={formatUsdSigned(row.pnlUsd)} className={cn("num", row.pnlUsd < 0 ? "text-ask" : row.pnlUsd > 0 ? "text-bid" : "text-fg-muted")} />
                  </td>
                  <td className="border-b border-border px-4 py-3.5">
                    <StatusPill status={row.status} />
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      <ol className="flex flex-col gap-2.5 md:hidden" aria-label={`Arena leaderboard on ${network}`}>
        <AnimatePresence initial={false}>
          {rows.map((row) => (
            <motion.li
              key={row.agentId}
              layout="position"
              transition={transition}
              data-testid="leaderboard-card"
              className="relative rounded-xl border border-border bg-bg-raised p-4"
            >
              <div className="flex items-center gap-3">
                <span className="num text-lg text-fg">{row.rank}</span>
                <RankDelta rank={row.rank} previous={row.previousRank} />
                <div className="min-w-0 flex-1">
                  <AgentCell row={row} network={network} pageProvenance={pageProvenance} />
                </div>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-xs text-fg-muted">Score</span>
                <NumberRoll value={formatScore(row.score)} className="num text-xl font-medium text-fg" />
              </div>
              <ScoreBar score={row.score} />
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                {(
                  [
                    ["Spread", formatBps(row.quotedSpreadBps)],
                    ["Depth", formatUsd(row.depthUsd25)],
                    ["Uptime", formatUptime(row.uptimeBps)],
                    ["PnL", formatUsdSigned(row.pnlUsd)],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-fg-muted">{k}</dt>
                    <dd className="num text-fg">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 border-t border-border pt-3">
                <StatusPill status={row.status} />
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </>
  );
}

export function LeaderboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading leaderboard">
      <div className="hidden md:block">
        <div className="flex gap-4 border-b border-border px-4 pb-3 pt-1">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} style={{ height: 12, width: i === 1 ? 160 : 64 }} />
          ))}
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex h-[57px] items-center gap-4 border-b border-border px-4">
            <Skeleton style={{ height: 14, width: 32 }} />
            <Skeleton style={{ height: 14, width: 200 }} />
            <span className="ml-auto flex gap-8">
              {Array.from({ length: 5 }, (_, j) => (
                <Skeleton key={j} style={{ height: 14, width: 64 }} />
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2.5 md:hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} style={{ height: 196, borderRadius: 12 }} />
        ))}
      </div>
    </div>
  );
}
