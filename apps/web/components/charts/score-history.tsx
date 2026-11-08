"use client";

import type { EpochScore } from "@strata/sdk";
import { useState } from "react";
import { formatScore } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Score per epoch as thin bars anchored to the baseline. Flagged epochs score zero and show a
 * halt-colored tick plus the flag name, so a disqualification is never color alone.
 */
export function ScoreHistory({ scores }: { scores: EpochScore[] }) {
  const [active, setActive] = useState<number | null>(null);
  const sorted = [...scores].sort((a, b) => a.epoch - b.epoch).slice(-48);
  const H = 140;
  const current = active != null ? sorted.find((s) => s.epoch === active) : sorted[sorted.length - 1];
  const summary = sorted.length
    ? `Score history over ${sorted.length} epochs, from ${formatScore(sorted[0]!.score)} in epoch ${sorted[0]!.epoch} to ${formatScore(sorted[sorted.length - 1]!.score)} in epoch ${sorted[sorted.length - 1]!.epoch}.`
    : "No scored epochs yet.";
  return (
    <figure className="m-0">
      <div className="mb-3 flex items-baseline justify-between text-xs text-fg-muted">
        <span>{current ? `Epoch #${current.epoch}` : ""}</span>
        <span className="num text-sm text-fg">
          {current ? formatScore(current.score) : ""}
          {current && current.flagNames.length ? <span className="ml-2 text-halt">{current.flagNames.join(", ")}</span> : null}
        </span>
      </div>
      <div role="img" aria-label={summary} className="flex items-end gap-[3px]" style={{ height: H }} onMouseLeave={() => setActive(null)}>
        {sorted.map((s) => {
          const h = Math.max(2, (s.score / 10_000) * H);
          const flagged = s.flags !== 0;
          return (
            <button
              key={s.epoch}
              type="button"
              aria-label={`Epoch ${s.epoch}: score ${formatScore(s.score)}${flagged ? `, flagged ${s.flagNames.join(", ")}` : ""}`}
              onMouseEnter={() => setActive(s.epoch)}
              onFocus={() => setActive(s.epoch)}
              onBlur={() => setActive(null)}
              className="group relative flex h-full flex-1 items-end justify-center outline-none"
            >
              <span
                className={cn(
                  "block w-full max-w-[14px] rounded-t-[3px] transition-colors",
                  flagged ? "bg-halt" : active === s.epoch ? "bg-accent-strong" : "bg-accent/70 group-hover:bg-accent",
                  "group-focus-visible:ring-2 group-focus-visible:ring-focus",
                )}
                style={{ height: flagged ? 3 : h }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between border-t border-border pt-2 text-[11px] text-fg-subtle num">
        <span>{sorted[0] ? `#${sorted[0].epoch}` : ""}</span>
        <span>{sorted.length ? `#${sorted[sorted.length - 1]!.epoch}` : ""}</span>
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
