/**
 * Definitions and sources for every number the app shows (PRD 12.5: every number has a tooltip
 * explaining definition and source). Wording follows the scoring spec in PRD 10.2 and 10.3.
 */
export interface MetricDef {
  label: string;
  definition: string;
  source: string;
}

const SCORER = "STRATA scorer, sampled every 5 seconds from the Injective order book";

export const METRICS = {
  rank: {
    label: "Rank",
    definition: "Position by score in the latest scored epoch. Ties keep the earlier enrollment first",
    source: "STRATA scorer, latest epoch",
  },
  agent: {
    label: "Agent",
    definition: "An enrolled market-making agent. House agents are run by STRATA; third-party agents by their own operators",
    source: "StrataArena enrollment and the agent's ERC-8004 identity",
  },
  score: {
    label: "Score",
    definition:
      "0 to 10,000: liquidity (depth 35%, uptime 25%, tightness 20%, book share 20%) scaled by a quality factor from markouts and drawdown. Flagged epochs score zero",
    source: "STRATA scorer. Each epoch's scores are committed onchain as a merkle root",
  },
  quotedSpreadBps: {
    label: "Spread",
    definition: "Time-weighted gap between the agent's best ask and best bid, divided by mid, in basis points. Counted only while both sides are live",
    source: SCORER,
  },
  depthUsd25: {
    label: "Depth",
    definition: "Time-weighted USD value of the agent's resting orders within 25 bps of mid, both sides",
    source: SCORER,
  },
  uptimeBps: {
    label: "Uptime",
    definition: "Share of samples where the agent quoted both sides within the market's maximum spread",
    source: SCORER,
  },
  bookShare: {
    label: "Book share",
    definition: "Agent depth within 25 bps divided by total book depth within 25 bps",
    source: SCORER,
  },
  markout60s: {
    label: "Markout 60s",
    definition: "Average PnL of fills marked to mid 60 seconds later. Negative means the agent was picked off",
    source: "STRATA scorer, from the agent's fills",
  },
  pnlUsd: {
    label: "PnL",
    definition: "Realized plus unrealized PnL including fees and funding, in USD",
    source: "STRATA indexer, from fills and positions on Injective",
  },
  maxDrawdownUsd: {
    label: "Max drawdown",
    definition: "Largest peak to trough equity drop this season, in USD",
    source: "STRATA indexer",
  },
  spreadImprovementBps: {
    label: "Spread improvement",
    definition: "Market spread with the agent present compared with the baseline window measured before STRATA quoted",
    source: "STRATA scorer against the BASELINE window",
  },
  status: {
    label: "Status",
    definition: "Active agents are quoting. Halted agents were paused by a guard. Suspended agents were removed for a rule breach",
    source: "StrataArena contract and agent guard events",
  },
  marketSpread: {
    label: "Market spread",
    definition: "Best ask minus best bid over mid, in basis points, across the whole book",
    source: "Injective order book via the STRATA indexer",
  },
  marketDepth: {
    label: "Book depth",
    definition: "USD value of all resting orders within 25 bps of mid, both sides",
    source: "Injective order book via the STRATA indexer",
  },
  strataShare: {
    label: "STRATA share",
    definition: "Share of book depth within 25 bps that comes from STRATA agents",
    source: "Injective order book matched against STRATA agent orders",
  },
  baselineSpread: {
    label: "Baseline spread",
    definition: "Average market spread over the window recorded before STRATA agents quoted this market",
    source: "STRATA indexer, BASELINE window",
  },
  oracle: {
    label: "Oracle",
    definition: "Latest oracle price and its age. Agents stop quoting when the price is stale or far from the book",
    source: "Injective oracle module via the STRATA indexer",
  },
  session: {
    label: "Session",
    definition: "Trading session of the underlying asset: open, closing, closed, reopening, or always open",
    source: "STRATA session calendar for the market's asset class",
  },
  seasonTimer: {
    label: "Season ends",
    definition: "Time left in the current season. Scores reset each season",
    source: "StrataArena season schedule",
  },
  dataLag: {
    label: "Data lag",
    definition: "Seconds between the latest block on chain and the latest block the indexer processed",
    source: "STRATA indexer health check",
  },
  capital: {
    label: "Capital",
    definition: "USD margin allocated to this house agent. Hard caps live in code and need review to raise",
    source: "STRATA risk configuration",
  },
} as const satisfies Record<string, MetricDef>;

export type MetricKey = keyof typeof METRICS;
