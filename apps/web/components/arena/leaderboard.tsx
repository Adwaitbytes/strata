"use client";

import type { LeaderboardRow, NetworkName } from "@strata/sdk";
import { NumberRoll, ProvenanceBadge, Skeleton } from "@strata/ui/data";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
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

export function agentHref(agentId: number, network: NetworkName) {
  return network === "testnet" ? `/agents/${agentId}` : `/agents/${agentId}?network=${network}`;
}

/**
 * Whole row or card navigates on click, while the name link stays the only focusable element
 * (keyboard and screen readers use the link). Clicks on interactive children, modified clicks
 * and text selections are left alone.
 */
function useRowNavigation(href: string) {
  const router = useRouter();
  return (e: MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("a, button, input, select, label")) return;
    if (window.getSelection()?.toString()) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      window.open(href, "_blank", "noopener");
      return;
    }
    router.push(href);
  };
}

function ScoreBar({ score, leader }: { score: number; leader: boolean }) {
  return (
    <span aria-hidden className="ml-auto mt-1.5 block h-[3px] w-16 overflow-hidden rounded-full bg-border">
      <span className={cn("block h-full rounded-full transition-[width] duration-500 ease-out", leader ? "bg-fg" : "bg-fg-muted/70")} style={{ width: `${score / 100}%` }} />
    </span>
  );
}

function AgentName({ row, network, pageProvenance, top }: { row: LeaderboardRow; network: NetworkName; pageProvenance: string | null; top: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Link href={agentHref(row.agentId, network)} className={cn("truncate text-fg underline-offset-4 hover:underline", top ? "font-semibold" : "font-medium")}>
        {row.name}
      </Link>
      <span className="shrink-0 rounded border border-border px-1.5 py-px text-[11px] text-fg-subtle">{row.kind === "house" ? "House" : "Third party"}</span>
      {row.provenance !== pageProvenance ? <ProvenanceBadge provenance={row.provenance} /> : null}
    </div>
  );
}

function TableRow({ row, network, pageProvenance, transition }: { row: LeaderboardRow; network: NetworkName; pageProvenance: string | null; transition: object }) {
  const onClick = useRowNavigation(agentHref(row.agentId, network));
  const top = row.rank <= 3;
  return (
    <motion.tr
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={transition}
      onClick={onClick}
      data-testid="leaderboard-row"
      className="group cursor-pointer transition-colors hover:bg-surface-hover/60 focus-within:bg-surface-hover/60"
    >
      <td className="border-b border-border px-4 py-3.5 align-middle">
        <div className="flex items-center gap-2">
          <span className={cn("num w-6 text-[15px]", top ? "font-semibold text-fg" : "text-fg-muted")}>{row.rank}</span>
          <RankDelta rank={row.rank} previous={row.previousRank} />
        </div>
      </td>
      <td className="max-w-[280px] border-b border-border px-4 py-3.5">
        <AgentName row={row} network={network} pageProvenance={pageProvenance} top={top} />
      </td>
      <td className="w-[128px] border-b border-border px-4 py-3.5 text-right">
        <NumberRoll value={formatScore(row.score)} className={cn("num text-[15px] text-fg", top ? "font-semibold" : "font-medium")} />
        <ScoreBar score={row.score} leader={row.rank === 1} />
      </td>
      <td className="border-b border-border px-4 py-3.5 text-right">
        <NumberRoll value={formatBps(row.quotedSpreadBps)} className="num text-fg-muted" />
      </td>
      <td className="border-b border-border px-4 py-3.5 text-right">
        <NumberRoll value={formatUsd(row.depthUsd25)} className="num text-fg-muted" />
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
  );
}

function Card({ row, network, pageProvenance, transition }: { row: LeaderboardRow; network: NetworkName; pageProvenance: string | null; transition: object }) {
  const onClick = useRowNavigation(agentHref(row.agentId, network));
  const top = row.rank <= 3;
  return (
    <motion.li
      layout="position"
      transition={transition}
      onClick={onClick}
      data-testid="leaderboard-card"
      className="cursor-pointer rounded-[var(--radius-md)] border border-border bg-bg-raised px-3.5 py-3 transition-colors hover:border-border-strong hover:bg-surface focus-within:border-border-strong focus-within:ring-2 focus-within:ring-focus/40"
    >
      <div className="flex items-center gap-2.5">
        <span className={cn("num w-5 text-[15px]", top ? "font-semibold text-fg" : "text-fg-muted")}>{row.rank}</span>
        <div className="min-w-0 flex-1">
          <AgentName row={row} network={network} pageProvenance={pageProvenance} top={top} />
        </div>
        <StatusPill status={row.status} className="shrink-0" />
      </div>
      <dl className="mt-2.5 grid grid-cols-4 gap-x-3 text-[12px]">
        <div>
          <dt className="text-fg-subtle">Score</dt>
          <dd className="num mt-0.5 font-medium text-fg">{formatScore(row.score)}</dd>
        </div>
        {(
          [
            ["Spread", formatBps(row.quotedSpreadBps)],
            ["Depth", formatUsd(row.depthUsd25)],
            ["PnL", formatUsdSigned(row.pnlUsd)],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-fg-subtle">{k}</dt>
            <dd className="num mt-0.5 text-fg-muted">{v}</dd>
          </div>
        ))}
      </dl>
    </motion.li>
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
                  className={cn("border-b border-border px-4 pb-3 pt-1 text-[12px] font-normal text-fg-muted", c.align === "right" ? "text-right" : "text-left", c.className)}
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
                <TableRow key={row.agentId} row={row} network={network} pageProvenance={pageProvenance} transition={transition} />
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      <ol className="flex flex-col gap-2 md:hidden" aria-label={`Arena leaderboard on ${network}`}>
        <AnimatePresence initial={false}>
          {rows.map((row) => (
            <Card key={row.agentId} row={row} network={network} pageProvenance={pageProvenance} transition={transition} />
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
      <div className="flex flex-col gap-2 md:hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} style={{ height: 92, borderRadius: 10 }} />
        ))}
      </div>
    </div>
  );
}
