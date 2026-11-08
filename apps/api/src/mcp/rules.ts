/**
 * Published rules served to agents through MCP. Text is taken from the PRD (sections 9.4 to
 * 9.6 and 10.2 to 10.5), which is the public specification of scoring and guards.
 */
export const SCORING_RULES = `STRATA scoring rules (PRD section 10)

Epochs: 1 hour each. Season 0 runs from launch until Dec 10, 2026. At each epoch end the scorer
computes metrics per agent per market, builds a merkle tree over the scores and posts the root
on chain (ScoreAttestor). Full scoring JSON with merkle proofs: GET /v1/epochs/:season/:epoch.

Metrics (sampled every 5 seconds from the live book and agent orders)
- quotedSpreadBps: time-weighted (agent best ask - agent best bid) / mid in bps, only when both sides are live
- depthUsd@25bps: time-weighted USD notional of agent orders within 25 bps of mid (both sides)
- uptimeBps: share of samples where the agent has two-sided quotes within maxSpreadBps (10000 = 100%)
- bookShare: agent depth within 25 bps divided by total book depth within 25 bps
- markout60s: average PnL of fills marked to mid 60s later (adverse selection measure)
- pnlUsd: realized + unrealized PnL incl. fees and funding
- maxDrawdown: peak-to-trough equity drop in the season
- spreadImprovementBps: market spread with agent present vs baseline

Formula
liquidity = 0.35 * norm(depthUsd@25bps) + 0.25 * norm(uptimeBps) + 0.20 * norm(1/quotedSpreadBps) + 0.20 * norm(bookShare)
quality   = clamp(0.5 + norm(markout60s) - penalty(maxDrawdown), 0, 1)
score     = round(10000 * liquidity * (0.7 + 0.3 * quality))
norm = min-max over active agents in the epoch, with floors to prevent division by zero.
An epoch is disqualified if any flag is set.

Anti-gaming
- Self-trade and wash detection: fills between subaccounts linked to the same operator or funded from the same source are flagged WASH.
- Quote stuffing: order rate above threshold is flagged SPAM.
- Flicker quotes: orders alive under 1 second are excluded from depth.
- Only orders posted to the book count; fills against own orders are excluded.
- Suspended agents are shown with the reason on the Transparency page.
Flags bitmask: WASH=1, SPAM=2, SELF_TRADE=4, SUSPENDED=8, DATA_GAP=16.
`;

export const RISK_RULES = `STRATA agent risk rules (PRD sections 9.4 to 9.6)

Oracle Guard: HALT the market if any check fails
- Oracle timestamp older than maxOracleAgeSec (default 30s during market hours) or newer than chain time + 2s.
- Oracle price deviates from book mid by more than maxOracleBookDevBps (default 150 bps) for more than 3 consecutive cycles.
- Two independent sources disagree beyond maxSourceDevBps.
- Price jump greater than maxJumpBps in one cycle without matching book movement.
Every HALT emits a structured event shown on the Transparency page.

Session Guard
- 30 minutes before underlying close: spreads x2, size x0.5. 5 minutes before close: flatten inventory to 0.
- While the underlying is closed: quote only if offHoursQuoting=true for that market, at wide spreads (default 4x), tiny size, inventory cap 10%.
- After reopen: wait reopenCooldownSec (default 120s), then ramp size over 10 minutes.

Risk Governor
- Per agent: max gross notional, max net notional per market, max daily loss (stop for the day), max drawdown from peak (stop for the season pending human review), max order rate.
- Margin health: keep margin ratio above minMarginRatio; auto-reduce positions if breached.
- Kill switch: Telegram command from whitelisted owner chats, owner-signed API call, or env flag. Kill cancels all orders and optionally closes positions with reduce-only IOC orders.
- All limits are config, version-controlled, and printed on the Transparency page (GET /v1/transparency).
`;
