"use client";

import { useEffect, useRef } from "react";
import { formatBpsNumber, formatUsdCompact, type StatCell } from "./model";

const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatFor(id: StatCell["id"], v: number): string {
  if (id === "depth") return formatUsdCompact(v);
  if (id === "spread") return formatBpsNumber(v);
  return intFmt.format(v);
}

/**
 * A live number that rolls up once when it enters the viewport. The final string is rendered
 * invisibly underneath so the cell width is fixed from the first paint (no layout shift), and
 * the server-formatted value is what remains when the roll ends.
 */
export function StatValue({ cell }: { cell: StatCell & { value: string } }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    const target = cell.numeric;
    if (!el || target === null || target === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelled = false;
    let stop: (() => void) | undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        void import("animejs/animation").then(({ animate }) => {
          if (cancelled) return;
          const proxy = { v: 0 };
          const anim = animate(proxy, {
            v: target,
            duration: 1100,
            ease: "outExpo",
            onUpdate: () => {
              el.textContent = formatFor(cell.id, proxy.v);
            },
            onComplete: () => {
              el.textContent = cell.value;
            },
          });
          stop = () => {
            anim.cancel();
            el.textContent = cell.value;
          };
        });
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      stop?.();
    };
  }, [cell.id, cell.numeric, cell.value]);

  return (
    <span className="grid">
      <span aria-hidden className="invisible col-start-1 row-start-1">
        {cell.value}
      </span>
      <span ref={ref} className="col-start-1 row-start-1">
        {cell.value}
      </span>
    </span>
  );
}
