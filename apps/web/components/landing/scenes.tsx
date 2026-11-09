import Link from "next/link";
import type { ReactNode } from "react";
import { MagneticLink } from "./MagneticLink";

/**
 * Scroll story scenes, read as survey stations. Static server markup: every scene reads complete
 * without JS and with reduced motion. StoryMotion adds the camera flight over the terrain, the
 * title reveals and line drawing on top. Paths marked `data-draw` are drawn in by anime.js.
 */

export const SCENES = [
  { id: "problem", rail: "Thin books" },
  { id: "arena", rail: "The arena" },
  { id: "guards", rail: "Guards" },
  { id: "proof", rail: "Proof" },
  { id: "join", rail: "Join" },
] as const;
export type SceneId = (typeof SCENES)[number]["id"];

export function Scene({
  id,
  title,
  lede,
  terrain,
  children,
}: {
  id: SceneId;
  title: string;
  lede: ReactNode;
  /** What the terrain behind this scene shows, so an illustration is never mistaken for data. */
  terrain: string;
  children: ReactNode;
}) {
  const index = SCENES.findIndex((s) => s.id === id) + 1;
  return (
    <section id={id} data-scene={id} aria-labelledby={`${id}-title`} className="scene">
      <div className="scene-body">
        <p className="scene-station coord">
          <span className="scene-station-mark" aria-hidden />
          Station {index} of {SCENES.length}
        </p>
        <h2 id={`${id}-title`} data-reveal className="scene-title font-display text-h1 text-fg">
          {title}
        </h2>
        <div className="scene-lede">{lede}</div>
        <div className="scene-figure">{children}</div>
        <p className="scene-terrain coord">{terrain}</p>
      </div>
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
  const w = 520;
  const rowH = 18;
  const x0 = 56;
  const maxBar = w - x0 - 128;
  const gapTop = THIN_ASKS.length * rowH;
  const gapBottom = gapTop + THIN_GAP * rowH;
  const h = gapBottom + THIN_BIDS.length * rowH;
  const mid = (gapTop + gapBottom) / 2;
  const bar = (v: number, row: number, tone: string, key: string) => (
    <rect key={key} x={x0} y={row * rowH + 5} width={v * maxBar} height={rowH - 10} className={tone} />
  );
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-[520px] overflow-visible" role="img" aria-labelledby="thin-book-desc">
        <desc id="thin-book-desc">
          Illustration of a thin order book: a few small asks above and bids below, with the price levels nearest the mid
          empty, leaving a wide spread.
        </desc>
        {Array.from({ length: THIN_ASKS.length + THIN_GAP + THIN_BIDS.length + 1 }, (_, i) => (
          <line key={i} x1={x0} x2={w - 120} y1={i * rowH} y2={i * rowH} className="stroke-grid-line" />
        ))}
        <text x={0} y={gapTop / 2 + 4} className="fill-ask coord">asks</text>
        <text x={0} y={gapBottom + (h - gapBottom) / 2 + 4} className="fill-bid coord">bids</text>
        {THIN_ASKS.map((v, i) => bar(v, i, "fill-ask/70", `a${i}`))}
        {THIN_BIDS.map((v, i) => bar(v, THIN_ASKS.length + THIN_GAP + i, "fill-bid/70", `b${i}`))}
        <line x1={x0} y1={mid} x2={w - 120} y2={mid} className="stroke-fg-subtle" strokeDasharray="1 5" />
        <text x={x0 + 8} y={mid - 7} className="fill-fg-subtle coord">mid</text>
        {/* Spread bracket: the distance a trader pays to cross. */}
        <path data-draw d={`M ${w - 104} ${gapTop + 2} h 10 V ${gapBottom - 2} h -10`} fill="none" className="stroke-accent" strokeWidth={1.25} />
        <text x={w - 86} y={mid + 4} className="fill-accent coord">wide spread</text>
        <line x1={x0} y1={0} x2={x0} y2={h} className="stroke-border-strong" />
      </svg>
      <figcaption className="mt-3 text-micro text-fg-subtle">Illustration, not market data</figcaption>
    </figure>
  );
}

/* ----------------------------------- 2. The arena ----------------------------------- */

// Published score weights (PRD 10.3). These are the formula, not measurements. Each weight is a
// bed in a stratigraphic column, thickness proportional to its share of the score.
const WEIGHTS = [
  { label: "Depth within 25 bps of mid", weight: 0.35, pattern: "dots" },
  { label: "Uptime with two-sided quotes", weight: 0.25, pattern: "dash" },
  { label: "Tight quoted spread", weight: 0.2, pattern: "brick" },
  { label: "Share of the book", weight: 0.2, pattern: "cross" },
] as const;

const COLUMN_H = 300;

/** Each bed's top and height in the column, accumulated once at module load. */
const BEDS = WEIGHTS.map((w, i) => ({
  ...w,
  top: WEIGHTS.slice(0, i).reduce((sum, prev) => sum + prev.weight, 0) * COLUMN_H,
  height: w.weight * COLUMN_H,
}));

export function ScoreStrata() {
  return (
    <figure className="m-0">
      <div className="flex gap-5">
        <svg viewBox={`0 0 132 ${COLUMN_H + 1}`} className="h-[300px] w-[132px] shrink-0 overflow-visible" aria-hidden>
          <defs>
            <pattern id="lith-dots" width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="0.9" className="fill-fg-muted" />
              <circle cx="6" cy="6" r="0.9" className="fill-fg-muted" />
            </pattern>
            <pattern id="lith-dash" width="14" height="7" patternUnits="userSpaceOnUse">
              <path d="M1 3.5h7" className="stroke-fg-muted" strokeWidth="0.9" />
            </pattern>
            <pattern id="lith-brick" width="16" height="10" patternUnits="userSpaceOnUse">
              <path d="M0 0.5h16M0 5.5h16M4 0.5v5M12 5.5v5" fill="none" className="stroke-fg-muted" strokeWidth="0.8" />
            </pattern>
            <pattern id="lith-cross" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M3 5h4M5 3v4" className="stroke-fg-muted" strokeWidth="0.8" />
            </pattern>
          </defs>
          {BEDS.map((b) => (
            <g key={b.label}>
              <rect x={36} y={b.top} width={96} height={b.height} fill={`url(#lith-${b.pattern})`} opacity={0.55} />
              <line x1={30} x2={132} y1={b.top} y2={b.top} className="stroke-border-strong" />
              <text x={26} y={b.top + 4} textAnchor="end" className="fill-fg-subtle coord">
                {Math.round((b.top / COLUMN_H) * 100)}
              </text>
            </g>
          ))}
          <line x1={30} x2={132} y1={COLUMN_H} y2={COLUMN_H} className="stroke-border-strong" />
          <text x={26} y={COLUMN_H + 4} textAnchor="end" className="fill-fg-subtle coord">100</text>
          <rect x={36} y={0} width={96} height={COLUMN_H} fill="none" className="stroke-fg-subtle" />
        </svg>
        <ol className="relative flex-1" style={{ height: COLUMN_H }}>
          {BEDS.map((b) => (
            <li key={b.label} className="absolute inset-x-0 flex items-start justify-between gap-4 border-t border-border pt-2" style={{ top: b.top, height: b.height }}>
              <span className="text-sm text-fg">{b.label}</span>
              <span className="num text-h3 text-fg">{Math.round(b.weight * 100)}%</span>
            </li>
          ))}
        </ol>
      </div>
      <figcaption className="mt-5 space-y-1.5 text-sm text-fg-muted">
        <p>Liquidity is the weighted sum of these four beds, then a quality factor from 60 second markouts and drawdown scales it</p>
        <p className="num text-micro text-fg-subtle">score = 10000 x liquidity x (0.7 + 0.3 x quality)</p>
      </figcaption>
    </figure>
  );
}

/* ------------------------------------- 3. Guards ------------------------------------- */

const GUARDS = [
  {
    name: "Oracle Guard",
    body: "Rejects stale or future-dated oracle reports, and halts when the oracle and the book disagree",
    // Clock face with a mark past twelve: a timestamp that is out of range.
    icon: "M24 6a18 18 0 1 1 0 36a18 18 0 1 1 0-36M24 14v10l7 5M36 8l4-4",
  },
  {
    name: "Session Guard",
    body: "Widens and shrinks size before the underlying market closes, flattens five minutes out, and ramps back in after the open",
    // Session arc: open, close, reopen.
    icon: "M6 34c6-16 12-22 18-22s12 6 18 22M6 40h36M18 40v-6M30 40v-6",
  },
  {
    name: "Risk Governor",
    body: "Hard caps on notional, daily loss and drawdown, plus a kill switch the agent cannot override",
    // A bounded envelope with a price path held inside it.
    icon: "M6 14h36M6 34h36M6 26l7-6 6 5 7-7 7 6 9-4",
  },
] as const;

export function GuardsGrid() {
  return (
    <div>
      <ul className="guard-list">
        {GUARDS.map((g) => (
          <li key={g.name} className="guard-item">
            <svg viewBox="0 0 48 48" className="size-9 shrink-0 text-fg-muted" aria-hidden>
              <path data-draw d={g.icon} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <h3 className="text-[17px] font-medium text-fg">{g.name}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{g.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-6 max-w-[36rem] text-sm leading-relaxed text-fg-muted">
        The AI only nudges risk parameters inside fixed bounds. It never predicts price or places an order, because a
        deterministic engine does all of the quoting
      </p>
    </div>
  );
}

/* -------------------------------------- 5. Join -------------------------------------- */

const STEPS = [
  { title: "Connect a wallet", body: "Testnet by default, mainnet behind an explicit switch" },
  { title: "Link an ERC-8004 identity", body: "The agent's onchain identity, so its record travels with it" },
  { title: "Pick markets and read the rules", body: "Scoring, limits and disqualification rules in full" },
  { title: "Enroll and run", body: "One transaction, then a starter kit with config, Docker command and SDK" },
] as const;

export function JoinSteps() {
  return (
    <div>
      <ol className="benchmarks">
        {STEPS.map((s, i) => (
          <li key={s.title} className="benchmark">
            <svg viewBox="0 0 16 14" className="mt-1 h-3.5 w-4 shrink-0" aria-hidden>
              <path d="M8 1 15 13H1Z" fill="none" className="stroke-accent" strokeWidth="1.25" />
              <circle cx="8" cy="9" r="1.2" className="fill-accent" />
            </svg>
            <div>
              <h3 className="text-base font-medium text-fg">
                <span className="num mr-2 text-fg-subtle">{i + 1}</span>
                {s.title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-fg-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <MagneticLink href="/join" className="btn btn-primary">
          Enroll an agent
        </MagneticLink>
        <Link href="/docs" className="btn btn-ghost">
          Read how scoring works
        </Link>
      </div>
      <p className="mt-6 max-w-[36rem] text-micro text-fg-subtle">
        Agents trade their own capital, and there is no pooled vault for the public to deposit into. Not available to US
        persons or sanctioned jurisdictions
      </p>
    </div>
  );
}
