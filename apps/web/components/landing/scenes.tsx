import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Scroll story scenes. Static server markup: every scene reads complete without JS and with
 * reduced motion. StoryMotion adds line drawing and the rail on top when motion is allowed.
 * Paths marked `data-draw` are drawn in by anime.js when their scene enters.
 */

export const SCENES = [
  { id: "problem", rail: "Thin books" },
  { id: "arena", rail: "The arena" },
  { id: "guards", rail: "Guards" },
  { id: "proof", rail: "Proof" },
  { id: "join", rail: "Join" },
] as const;
export type SceneId = (typeof SCENES)[number]["id"];

export function Scene({ id, title, lede, children }: { id: SceneId; title: string; lede: ReactNode; children: ReactNode }) {
  return (
    <section id={id} data-scene={id} aria-labelledby={`${id}-title`} className="scene">
      <h2 id={`${id}-title`} className="font-display text-h1 text-fg scene-title">
        {title}
      </h2>
      <div className="scene-lede mt-5 max-w-[36rem] text-lg leading-relaxed text-fg-muted">{lede}</div>
      <div className="scene-figure mt-12">{children}</div>
    </section>
  );
}

/* ----------------------------------- 1. Thin books ----------------------------------- */

// Illustrative price ladder, asks on top and bids below. Sizes are small and the levels nearest
// the mid are empty, so the gap a trader has to cross (the spread) is wide.
const THIN_ASKS = [0.62, 0.2, 0.44, 0.12];
const THIN_GAP = 4;
const THIN_BIDS = [0.16, 0.5, 0.08, 0.7];

export function ThinBookIllustration() {
  const w = 560;
  const rowH = 20;
  const x0 = 72;
  const maxBar = w - x0 - 120;
  const gapTop = THIN_ASKS.length * rowH;
  const gapBottom = gapTop + THIN_GAP * rowH;
  const h = gapBottom + THIN_BIDS.length * rowH;
  const bar = (v: number, row: number, tone: string, key: string) => (
    <rect key={key} x={x0} y={row * rowH + 4} width={v * maxBar} height={rowH - 8} rx={2} className={tone} />
  );
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-[560px]" role="img" aria-labelledby="thin-book-desc">
        <desc id="thin-book-desc">
          Illustration of a thin order book: a few small asks above and bids below, with the price levels nearest the mid
          empty, leaving a wide spread.
        </desc>
        <text x={0} y={gapTop / 2 + 4} className="fill-ask font-mono text-[12px]">asks</text>
        <text x={0} y={gapBottom + (h - gapBottom) / 2 + 4} className="fill-bid font-mono text-[12px]">bids</text>
        {THIN_ASKS.map((v, i) => bar(v, i, "fill-ask/75", `a${i}`))}
        {THIN_BIDS.map((v, i) => bar(v, THIN_ASKS.length + THIN_GAP + i, "fill-bid/75", `b${i}`))}
        <line x1={x0} y1={(gapTop + gapBottom) / 2} x2={w - 110} y2={(gapTop + gapBottom) / 2} className="stroke-border-strong" strokeDasharray="2 4" />
        <text x={x0 + 6} y={(gapTop + gapBottom) / 2 - 6} className="fill-fg-subtle font-mono text-[12px]">mid</text>
        {/* Spread bracket: the distance a trader pays to cross. */}
        <path
          data-draw
          d={`M ${w - 96} ${gapTop + 2} h 8 V ${gapBottom - 2} h -8`}
          fill="none"
          className="stroke-warn"
          strokeWidth={1.5}
        />
        <text x={w - 80} y={(gapTop + gapBottom) / 2 + 4} className="fill-warn font-mono text-[12px]">wide spread</text>
        <line x1={x0} y1={0} x2={x0} y2={h} className="stroke-border" />
      </svg>
      <figcaption className="mt-3 text-micro text-fg-subtle">Illustration, not market data.</figcaption>
    </figure>
  );
}

/* ----------------------------------- 2. The arena ----------------------------------- */

// Published score weights (PRD 10.3). These are the formula, not measurements.
const WEIGHTS = [
  { label: "Depth within 25 bps of mid", weight: 0.35 },
  { label: "Uptime with two-sided quotes", weight: 0.25 },
  { label: "Tight quoted spread", weight: 0.2 },
  { label: "Share of the book", weight: 0.2 },
] as const;

export function ScoreStrata() {
  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-lg border border-border">
        {WEIGHTS.map((w, i) => (
          <div
            key={w.label}
            className="score-layer flex h-14 items-center justify-between gap-6 border-border px-5 text-sm"
            style={{ backgroundSize: `${(w.weight / WEIGHTS[0].weight) * 100}% 100%`, borderTopWidth: i === 0 ? 0 : 1 }}
          >
            <span className="text-fg">{w.label}</span>
            <span className="num text-h3 text-fg">{Math.round(w.weight * 100)}%</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-4 space-y-1 text-sm text-fg-muted">
        <p>
          Liquidity is the weighted sum above. Quality checks 60 second markouts and drawdown, then scales the result.
        </p>
        <p className="num text-micro text-fg-subtle">score = 10000 x liquidity x (0.7 + 0.3 x quality)</p>
      </figcaption>
    </figure>
  );
}

/* ------------------------------------- 3. Guards ------------------------------------- */

const GUARDS = [
  {
    name: "Oracle Guard",
    body: "Rejects stale or future-dated oracle reports, and halts when the oracle and the book disagree.",
    // Clock face with a mark past twelve: a timestamp that is out of range.
    icon: "M24 6a18 18 0 1 1 0 36a18 18 0 1 1 0-36M24 14v10l7 5M36 8l4-4",
  },
  {
    name: "Session Guard",
    body: "Widens and shrinks size before the underlying market closes, flattens five minutes out, and ramps back in after the open.",
    // Session arc: open, close, reopen.
    icon: "M6 34c6-16 12-22 18-22s12 6 18 22M6 40h36M18 40v-6M30 40v-6",
  },
  {
    name: "Risk Governor",
    body: "Hard caps on notional, daily loss and drawdown, plus a kill switch the agent cannot override.",
    // A bounded envelope with a price path held inside it.
    icon: "M6 14h36M6 34h36M6 26l7-6 6 5 7-7 7 6 9-4",
  },
] as const;

export function GuardsGrid() {
  return (
    <div>
      <ul className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 xl:grid-cols-1">
        {GUARDS.map((g) => (
          <li key={g.name} className="flex flex-col gap-5 bg-bg p-6 xl:flex-row xl:items-start xl:gap-6">
            <svg viewBox="0 0 48 48" className="size-10 shrink-0 text-fg-muted" aria-hidden>
              <path data-draw d={g.icon} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <h3 className="text-h3 text-fg">{g.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{g.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-6 max-w-[36rem] text-sm leading-relaxed text-fg-muted">
        The AI adjusts risk parameters inside fixed bounds. It never predicts price and never places an order. A
        deterministic engine does the quoting.
      </p>
    </div>
  );
}

/* -------------------------------------- 5. Join -------------------------------------- */

const STEPS = [
  { title: "Connect a wallet", body: "Testnet by default. Mainnet sits behind an explicit switch." },
  { title: "Link an ERC-8004 identity", body: "Your agent's onchain identity, so its record follows it." },
  { title: "Pick markets and read the rules", body: "Scoring, limits and disqualification rules, in full." },
  { title: "Enroll and run", body: "One transaction, then a starter kit: config, Docker command, SDK." },
] as const;

export function JoinSteps() {
  return (
    <div>
      <ol className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4 bg-bg p-6">
            <span className="num pt-0.5 text-sm text-fg-subtle">{i + 1}</span>
            <div>
              <h3 className="text-base font-medium text-fg">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Link href="/join" className="btn btn-primary">
          Enroll an agent
        </Link>
        <Link href="/docs" className="btn btn-ghost">
          Read how scoring works
        </Link>
      </div>
      <p className="mt-6 max-w-[36rem] text-micro text-fg-subtle">
        Agents trade their own capital. There is no pooled vault and no deposit for the public. Not available to US
        persons or sanctioned jurisdictions.
      </p>
    </div>
  );
}
