# Guards

Every STRATA agent runs three guards and a kill switch between "compute a fair price" and "send orders". They are not optional and they are not tunable by the AI. This page explains what each one does, why it exists, and what you will see when it fires.

The code lives in `packages/risk` (pure TypeScript, no network calls, tested with fixtures and property tests). Event shapes live in `packages/sdk/src/types.ts` (`GuardName`, `GuardAction`, `GuardReason`, `GuardEvent`). PRD references are given as section numbers.

## How guards fit in the loop

Each cycle, per market (PRD 9.2):

1. Read book, oracle price, position, margin, funding.
2. Compute fair value.
3. **Run the guards.** Each returns an action: `ok`, `widen`, `reduce`, `flatten`, `halt` or `resume`.
4. If any guard says `halt`, cancel every order on that market and skip quoting until the condition clears.
5. Otherwise apply the strictest adjustment (wider spread, smaller size, lower inventory cap) and quote.

The strictest answer wins. A guard can only make the agent more careful, never less.

Every non-`ok` decision is written as a `GuardEvent` with the measured values that caused it, for example `{ oracleAgeSec: 41, limit: 30 }`, and a plain sentence. Those events appear on the Agent page timeline and the Transparency page log. If the data a guard needs is missing, the event reason is `data_unavailable` and the action is `halt`: not knowing counts as unsafe.

## 1. Oracle Guard (PRD 9.4)

**The lesson.** In July 2026 Ostium lost about $18M when its oracle accepted price reports with timestamps in the future (PRD 27, CoinDesk). A market maker that trusts its price feed blindly will quote around a wrong price and get picked off. Oracle Guard treats the feed as something to check, not something to believe.

The agent halts quoting on a market when any of these is true:

| Check | Default | Reason code |
|---|---|---|
| Oracle report older than the allowed age | 30 s during market hours | `oracle_stale` |
| Oracle report **newer** than chain time plus 2 s | 2 s tolerance | `oracle_future_timestamp` |
| Oracle price differs from book mid for more than 3 cycles in a row | 150 bps | `oracle_book_deviation` |
| Two independent sources disagree (oracle against an external reference) | `maxSourceDevBps` | `oracle_source_divergence` |
| Price jumps in one cycle without the book moving with it | `maxJumpBps` | `oracle_jump` |

The future-timestamp check compares against **chain time** (the latest block time), never the machine clock, so a drifting server clock cannot hide a bad report or cause a false alarm.

## 2. Session Guard (PRD 9.5)

**The lesson.** RWA perps trade 24/7 on Injective, but the assets underneath them do not. US equities close at 4 pm New York time and over the weekend; FX pauses on weekends; commodities have their own sessions. While the underlying is closed the oracle price barely moves, then reopens wherever the real market went. A maker holding inventory into that gap can lose a week of spread in one print (PRD 27, SEDA on session-aware oracles).

Session Guard keeps a market-hours calendar per asset class (US equities with holidays and early closes, FX weekly session, commodities sessions, crypto 24/7) and changes behavior on a schedule:

| When | What the agent does | Reason code |
|---|---|---|
| 30 min before the underlying closes | Spreads x2, size x0.5 | `session_pre_close` |
| 5 min before close | Flatten inventory to zero | `session_flatten` |
| While closed | Quote only if `offHoursQuoting` is on for that market: 4x spreads, tiny size, 10% inventory cap. Otherwise no quotes. | `session_closed` |
| After reopen | Wait `reopenCooldownSec` (default 120 s) for oracle and book to settle | `session_reopen_cooldown` |
| After the cooldown | Ramp size back up over 10 minutes | `session_ramp` |

The Market page shows the current session state (open, closing, closed, reopening) next to the book.

## 3. Risk Governor (PRD 9.6)

The Risk Governor enforces limits on the agent as a whole, across markets.

| Limit | Action when hit | Reason code |
|---|---|---|
| Max gross notional | Stop adding exposure | `risk_gross_notional` |
| Max net notional per market | Quote only the side that reduces it | `risk_net_notional` |
| Max daily loss | Stop for the rest of the day | `risk_daily_loss` |
| Max drawdown from peak | Stop for the season until a human reviews it | `risk_max_drawdown` |
| Max order rate | Throttle | `risk_order_rate` |
| Margin ratio below `minMarginRatio` | Reduce positions | `risk_margin_ratio` |

It also skews quotes away from paying high funding.

For mainnet, the owner-level defaults are $1,000 total capital, $50 max daily loss and $150 max season drawdown (D6), with a hard ceiling `MAINNET_CAPITAL_CAP_USD = 1000` in code. Raising it needs a code change and a review. Mainnet capital is $0 today (D27), so these limits apply the day a wallet is funded, not before.

All limits are config files under version control, and the Transparency page prints them.

## 4. Kill switch (PRD 9.6, 16.4)

Three independent ways to stop an agent or all agents:

| Path | Who can use it | Reason code |
|---|---|---|
| Telegram `/kill <agent or all>` | Whitelisted owner chat IDs only | `kill_switch_telegram` |
| Admin API call | A message signed by the owner wallet, with a nonce and an expiry | `kill_switch_api` |
| Environment flag `KILL_SWITCH=true` | Whoever runs the container | `kill_switch_env` |

Kill cancels every open order. It can also close positions with reduce-only IOC orders. Agents also cancel all orders on SIGTERM, so stopping a container is safe.

The kill switch is tested on testnet before any mainnet order, and the test is recorded (PRD 16.4).

## 5. Why the AI cannot touch any of this

The AI Risk Tuner (see `docs/AI_TUNER.md`) can suggest five quoting parameters. It has no access to guard thresholds, risk limits, the calendar or the kill switch, and its suggestions pass through the same clamps as any config value. A bad model response can make the agent quote a little wider or a little tighter. It cannot turn a guard off.

## 6. Testing

Per PRD 17, `packages/risk` ships unit tests with fixtures for each failure (stale oracle, future timestamp, deviation, jump, market close, reopen gap, margin breach) plus property-based tests, targeting 95% coverage or more. The chaos tests cover killing the RPC mid-cycle, killing the database and restarting the agent; in each case the agent must cancel or hold safely and never duplicate orders.
