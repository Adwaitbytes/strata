# AI Risk Tuner

The tuner is a small, bounded use of a language model. It reads a summary of recent market conditions and suggests adjustments to five quoting parameters, with a one-sentence reason. It never predicts prices, never places or cancels orders, and never sees keys. This page is the policy for how it runs (PRD 9.7).

## Why it is built this way

LLM trading bots mostly lose money: in the Alpha Arena runs cited in the PRD, 6 of 32 were profitable (PRD 3.2, 27). STRATA does not ask a model to trade. Quotes come from a deterministic engine (PRD 9.3) that can be tested and replayed. The model gets a narrower job that a reader can audit: "given the last 15 minutes, should this agent quote a bit wider, a bit tighter, or the same?"

## What it can change

Exactly the fields in `TunableParams` (`packages/sdk/src/types.ts`):

| Parameter | Meaning |
|---|---|
| `gamma` | Risk aversion in the reservation price; higher means stronger inventory skew |
| `minHalfSpreadBps` | Floor on the half spread |
| `levels` | Number of ladder levels per side |
| `sizeMultiplier` | Scales order size at every level |
| `offHoursQuoting` | Whether to quote at all while the underlying market is closed |

Everything else is out of reach: guard thresholds, risk limits, the market-hours calendar, the kill switch, capital, markets, keys. See `docs/GUARDS.md`.

## The loop

Every 5 to 15 minutes, per agent and market:

1. Build a compact snapshot: realized volatility, fill rates, markouts at 1 s, 10 s and 60 s, inventory, session state, recent guard events, funding, and the current parameters.
2. Send it to Claude through the Anthropic API (model from `ANTHROPIC_MODEL`) with a strict JSON schema. The response must be the five parameters plus a rationale of at most 280 characters.
3. Validate the response with zod. Anything that does not parse is rejected and logged with `rejected: true` and a `rejectReason`.
4. Clamp each value to its bounds in `packages/risk`, then clamp the change to **at most 20% per parameter per step**. Every clamped field is listed in `clamped`.
5. Write a `TunerEvent` with `before`, `suggested`, `applied` (or `null` in shadow mode) and the rationale.

The Agent page shows these events as a public feed: "Why the agent changed its spread". Rejected and clamped suggestions are shown too.

## Modes

| Mode | Behavior |
|---|---|
| `static` | No model calls. The engine runs on the documented static parameters. |
| `shadow` | The model is called and every suggestion is logged and shown, but **nothing is applied**. |
| `live` | Validated, clamped suggestions are applied. |

### Shadow mode policy

- The tuner starts in `shadow` and stays there unless `ANTHROPIC_API_KEY` is present in the secrets store (D10, D29). Without a key it runs `static`.
- While in shadow, suggestions are scored against what the static parameters did over the same window (markout and spread capture over the next interval).
- Live tuning is enabled only after shadow results are non-negative against static over the first N hours, and the comparison is written up in this file with the date and the numbers, labeled with network and provenance.
- If a live tuner underperforms static over a later window, it goes back to shadow. That switch is a config change and is logged in `docs/DECISIONS.md`.

**Current status:** shadow mode. No live tuning results exist yet, so none are claimed here.

## What goes into a prompt

Only market and agent state that is already public or derived from public chain data:

- market symbol and session state
- realized volatility, spread, depth and book imbalance summaries
- the agent's own fill rate, markouts, inventory, funding and recent guard event codes
- the current values and bounds of the five parameters

## What never goes into a prompt

- private keys, mnemonics, keystore files or passphrases
- API keys, database URLs, Telegram tokens or any other secret
- third-party wallet addresses or anything that links an address to a person (PRD 16.3)
- user data of any kind (STRATA collects none in R0)
- raw logs, which may contain any of the above

Requirement for the snapshot builder (`services/agent`): it builds the prompt from an allow-list of fields, and a test asserts that a snapshot built from fixture state contains only those fields. That way a new field added to agent state cannot leak into prompts by accident.

## Failure handling

| Failure | Result |
|---|---|
| API error, timeout or rate limit | Keep current parameters, log the failure, try next interval |
| Response does not match the schema | Reject, log `rejectReason`, keep current parameters |
| Value outside bounds | Clamp to bound, list it in `clamped` |
| Change larger than 20% | Clamp to 20%, list it in `clamped` |
| Model asks for anything outside the five fields | Ignored; the schema has no place for it |

The engine never waits on the tuner. A slow or broken model leaves the agent quoting on its last good parameters, behind the same guards.
