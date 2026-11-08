# How STRATA scores market makers

Every hour, STRATA measures how much real liquidity each enrolled agent provided, turns that into a
score from 0 to 10,000, and posts a merkle root of all scores to the `ScoreAttestor` contract. Anyone
can take an agent's published numbers, rebuild its leaf, and check it against that root onchain.

This page is the full specification. The code that implements it lives in `services/scorer`, and the
leaf and tree code is shared with the contracts and the web app through `packages/sdk/src/merkle.ts`.

## Seasons and epochs

- A season is started onchain by `StrataArena.startSeason(startTime, endTime, epochSeconds)`. Seasons
  are numbered from 1. The scorer reads the current season and its epoch length from the contract, so
  there is one source of truth. The default epoch length is 1 hour.
- Epoch `e` covers `[startTime + e * epochSeconds, startTime + (e + 1) * epochSeconds)`. The last epoch
  of a season is cut short at the season's end time.
- An epoch is scored once it has ended and a settle delay has passed (default 120 seconds). The delay
  lets 60 second markouts and indexer lag catch up.
- Epochs are posted strictly in order. `ScoreAttestor` rejects an epoch number that is not higher than
  the last one posted for the season.

## What data is used

All inputs come from the STRATA database, which the indexer fills from Injective.

| Table | Used for |
|---|---|
| `book_snapshots` | Public book every 5 seconds: mid, spread, total USD depth within 25 bps |
| `agent_orders` | Each agent order: side, price, size, when it was posted and when it left the book |
| `agent_fills` | Each agent fill: price, size, fee, counterparty subaccount |
| `agents` | Operator, subaccount, enrolled markets, status |

Only rows labeled `LIVE`, `TESTNET` or `BASELINE` describe the real book. Rows labeled `MOCK`,
`SIMULATED` or `BACKTEST` never affect a score. Simulated agents are not scored or attested.

Arena markets and their uptime spread limit (`maxSpreadBps`) come from `packages/config`, which is
generated from a live Injective Indexer query.

An agent is scored in an epoch when its status is active, halted or suspended, it was enrolled before
the epoch ended, and it is enrolled in at least one arena market. Withdrawn and pending agents are not
scored.

## Sampling

Samples sit on a fixed 5 second grid from the start of the epoch: `start, start + 5s, ...`, end
excluded. A one hour epoch has 720 samples per market.

A sample is **valid** for a market when there is a book snapshot younger than 15 seconds at that
moment with a mid price. Invalid samples are left out of every average. Because the grid is uniform,
"time-weighted" below means the plain average over samples.

An order counts at sample time `t` when it was posted at or before `t`, has not left the book by
`t`, and still has size left after the fills recorded up to `t`.

**Flicker quotes:** an order that lived less than 1 second never counts toward any book metric.

## Metrics

All metrics are computed per agent per market, then combined per agent.

| Metric | Definition |
|---|---|
| `quotedSpreadBps` | Average of `(best ask - best bid) / mid * 10000` over the samples where the agent had both a bid and an ask live. If the agent was never two-sided, it is reported as 0 and the spread term of the score is 0. |
| `depthUsd25` | Average over valid samples of the USD notional (`price * remaining size`) of the agent's orders within 25 bps of mid, both sides. |
| `uptimeBps` | Share of valid samples where the agent was two-sided with a spread no wider than the market's `maxSpreadBps`. 10000 means 100%. |
| `bookShare` | Average over valid samples of agent depth within 25 bps divided by total book depth within 25 bps, capped at 1. |
| `markout60s` | For every eligible fill in the epoch: `side * (mid 60 seconds later - fill price) * size`, where side is +1 for a buy and -1 for a sell. The sum is divided by the total fill notional and reported in bps. Positive means the agent was not picked off. Fills against the agent's own or linked accounts are excluded. |
| `pnlUsd` | Season-to-date PnL at the end of the epoch: cash from every fill since the season started (buys spend, sells receive, fees subtract, rebates add, funding adds) plus open positions marked to the latest mid. |
| `maxDrawdownUsd` | Largest drop from a running peak on that same equity curve, which starts at 0. Equity is evaluated after every fill and every mark. Marks are one per minute before the current epoch and every 5 seconds within it. |
| `spreadImprovementBps` | The market's baseline spread minus the average public book spread over the samples where the agent was two-sided. Positive means the book is tighter than before STRATA. The baseline is the average spread of the market's `BASELINE` snapshots taken before the first STRATA agent order in that market. Reported as 0 when no baseline exists. This metric is published, not scored. |
| `samples` | Valid samples across the agent's markets. |

### Combining markets

An agent quoting several markets gets one set of numbers:

- `depthUsd25` is the **sum** across markets, because depth in two books is twice the liquidity.
- `quotedSpreadBps` and `spreadImprovementBps` are averages **weighted by two-sided samples**.
- `uptimeBps` and `bookShare` are averages **weighted by valid samples**. A market the agent enrolled
  in but never quoted pulls both down.
- `markout60s` pools every eligible fill across markets, weighted by notional.
- `pnlUsd` and `maxDrawdownUsd` come from one equity curve across all markets.

## Score formula

This is PRD section 10.3, implemented exactly:

```
liquidity = 0.35 * norm(depthUsd25) + 0.25 * norm(uptimeBps) + 0.20 * norm(1 / quotedSpreadBps) + 0.20 * norm(bookShare)
quality   = clamp(0.5 + norm(markout60s) - penalty(maxDrawdownUsd), 0, 1)
score     = round(10000 * liquidity * (0.7 + 0.3 * quality))
```

### Normalization

`norm(x) = (x - min) / (max - min)`, where min and max are taken over the **active agents** of the
epoch: scored agents with no flags. Flagged agents are left out so a disqualified outlier cannot
squash everyone else.

When `max - min` is below a small floor, min-max is undefined. That happens with a single agent or
when every agent has the same value. Then:

| Term | Floor | Value when the range is too small |
|---|---|---|
| depth | $1 | 1 if the agent's value is at least the floor, else 0 |
| uptime | 1 bps | same rule |
| 1 / spread | 0.000001 | same rule |
| bookShare | 0.000001 | same rule |
| markout | 0.01 bps | 0.5 (neutral) |

So a lone agent that quoted two-sided all hour scores 10,000, and a lone agent that never quoted
scores 0. Scores are relative: they rank agents against each other in the same epoch.

Spread is floored at 0.1 bps before taking `1 / spread`, so a zero-width quote cannot divide by zero.
An agent that was never two-sided gets `1 / spread = 0`.

### Drawdown penalty

```
penalty(maxDrawdownUsd) = 0.5 * clamp(maxDrawdownUsd / 150, 0, 1)
```

The penalty grows linearly with drawdown and reaches its cap of 0.5 at $150, which is the house
agents' maximum season drawdown (decision D6). With the worst markout in the epoch and a drawdown of
$150 or more, quality is 0 and the score keeps 70% of its liquidity value.

## Flags

Any flag sets the agent's score to 0 for the epoch. The flags are a bitmask, stored in the leaf,
defined in `ScoreFlag` in `@strata/sdk`:

| Bit | Name | Raised when |
|---|---|---|
| 1 | `WASH` | A fill's counterparty is linked to the agent without being the same trader: the agent's operator wallet, another agent with the same operator, or an address that shares a funding source with the agent within 2 hops of bank transfers. Funders that sent to more than 25 addresses (faucets, bridges, exchanges) and funders on an ignore list do not create links. |
| 2 | `SPAM` | More than 1,200 orders posted inside any rolling 60 second window. |
| 4 | `SELF_TRADE` | A fill's counterparty subaccount belongs to the agent's own trader address (any subaccount nonce). An Injective subaccount ID is the 20-byte trader address followed by a 12-byte nonce. |
| 8 | `SUSPENDED` | The arena owner suspended the agent onchain. The reason is on the Transparency page. |
| 16 | `DATA_GAP` | The scorer had a fresh book for less than 50% of the agent's samples, so the epoch cannot be judged fairly. |

Fills that raise `WASH` or `SELF_TRADE` are also removed from the markout, so fills against your own
orders never help. Each flag is stored with a plain sentence of evidence in `epoch_runs.detail`.

## Epochs that are not attested

The scorer skips an epoch, and records why in `epoch_runs.reason`, when:

- no agent is eligible,
- there is no book data at all for any arena market in the window,
- no agent reaches 50% book coverage (the data gap is ours, so all-zero scores would mislead),
- the chain already holds this epoch with a different root, or has already moved past it.

## Leaf format

One leaf per scored agent, matching `IScoreAttestor.sol` and `packages/sdk/src/merkle.ts` exactly:

```
leaf = keccak256(abi.encode(
  uint64  season,
  uint64  epoch,
  uint256 agentId,
  uint256 score,
  uint256 spreadCentiBps,   // round(quotedSpreadBps * 100)
  uint256 depthUsd,         // floor(depthUsd25), whole dollars
  uint256 uptimeBps,
  int256  pnlUsdCents,      // round(pnlUsd * 100), signed
  uint256 flags
))
```

The preimage is 288 bytes and hashed once. Internal nodes hash the sorted pair of children
(`keccak256(min(a, b) || max(a, b))`), the same as OpenZeppelin `MerkleProof`. Leaves are ordered by
`agentId` ascending. When a level has an odd node, it moves up unchanged.

## Published document and dataURI

For each attested epoch the scorer writes the `epochs` and `scores` rows, and the public API serves
them at `GET /v1/epochs/:season/:epoch?network=<network>`.

The `dataURI` posted onchain points at that API route and carries a content hash in its fragment:

```
https://<api>/v1/epochs/1/42?network=testnet#keccak256=0x...
```

The hash is `keccak256` of the UTF-8 bytes of the canonical JSON of this document:

```
{
  "version": 1,
  "network", "season", "epoch", "startTime", "endTime",   // from the API attestation
  "merkleRoot", "contract",                               // lowercase hex
  "scores": [ { network, provenance, season, epoch, agentId, score, metrics, flags, flagNames, leaf, proof } ]
}
```

- `scores` is sorted by `agentId`. `leaf`, `proof`, `merkleRoot` and `contract` are lowercase hex.
- `metrics` holds exactly the nine `EpochMetrics` fields listed above.
- Canonical JSON means object keys sorted alphabetically at every level, no whitespace, and numbers
  written the way JavaScript's `JSON.stringify` writes them.
- `dataURI`, `txHash` and `postedAt` are not part of the document: they are not known when it is hashed.

The reference implementation is `canonicalEpochDocument` and `documentHash` in
`services/scorer/src/epoch.ts`. IPFS pinning is not used yet (decision D36).

## How to verify a score

You need the season, epoch and agent ID.

1. **Read the posted root.** Call `ScoreAttestor.getEpoch(season, epoch)` on Blockscout or with any RPC.
   You get `merkleRoot`, `postedAt` and `dataURI`.
2. **Fetch the published numbers.** Open the URL in `dataURI` (everything before `#`). Find your agent
   in `scores`.
3. **Optional: check the document.** Rebuild the canonical document from the response as described
   above, hash it with keccak256, and compare with the hash after `#keccak256=` in the `dataURI`.
4. **Rebuild the leaf.** Convert the metrics with the integer rules in the leaf format above and hash
   them. It must equal the published `leaf`.
5. **Check it onchain.** Call `ScoreAttestor.verifyScore(season, epoch, agentId, score, spreadCentiBps,
   depthUsd, uptimeBps, pnlUsdCents, flags, proof)`. It returns `true` only if the leaf is in the posted
   tree. `verifyLeaf(season, epoch, leaf, proof)` does the same from a precomputed leaf.

With `@strata/sdk` in TypeScript:

```ts
import { encodeLeaf, toLeafInput, verifyProof } from "@strata/sdk";

const s = response.scores.find((x) => x.agentId === 7)!;
const leaf = encodeLeaf(toLeafInput({ ...s, ...s.metrics }));
console.log(leaf === s.leaf, verifyProof(leaf, s.proof, response.attestation.merkleRoot));
```

With Foundry:

```sh
cast call <ScoreAttestor> "verifyScore(uint64,uint64,uint256,uint256,uint256,uint256,uint256,int256,uint256,bytes32[])(bool)" \
  <season> <epoch> <agentId> <score> <spreadCentiBps> <depthUsd> <uptimeBps> <pnlUsdCents> <flags> "[<proof...>]" \
  --rpc-url https://k8s.testnet.json-rpc.injective.network/
```

## Test vectors

- `services/scorer/test/golden/epoch-s1-e2.json`: a fixed five-agent, two-market epoch with every
  metric, score, flag, leaf and proof. Its merkle root is
  `0xdd4f9e94db975b5d21af83f6d1fdfcf6a833621676c80020fedf81d79280f3a9`.
- `services/scorer/test/golden/epoch-s1-e2.vectors.json`: the same epoch as integer leaf fields and
  proofs, ready for a forge test.
- The scorer tests also rebuild the contract team's vectors in
  `packages/contracts/test/generated/MerkleGoldenVectors.sol`, so the scorer and the contract cannot
  drift apart.

## Known limitations

- **Funding payments** are not stored by the indexer yet, so `pnlUsd` includes realized PnL, unrealized
  PnL and fees, and funding is 0 until a funding table exists.
- **Funding-source wash linking** is implemented but has no bank transfer history to read yet. Until
  the indexer stores transfers, `WASH` is raised only through operator links.
- **Order exit time:** `cancelled_at` is treated as the moment an order left the book for any reason
  (cancel, full fill, expiry). Remaining size after partial fills comes from `agent_fills`.
- **USD values** assume a USD-pegged quote asset (USDC or USDT perps).
- Scores are relative within an epoch. A lone agent's score shows presence and steadiness, not how it
  compares with competitors.

## Running the scorer

One process per network. It needs the database, the contract addresses and, to post, the attestor key.

| Variable | Default | Meaning |
|---|---|---|
| `STRATA_NETWORK` | required | `testnet` or `mainnet` |
| `DATABASE_URL` or `DATABASE_URL_FILE` | required | Postgres connection, or a file that holds it |
| `SCORER_API_BASE` | required | Public API base used in the `dataURI` (https, or http for localhost) |
| `STRATA_ARENA_ADDRESS`, `STRATA_SCORE_ATTESTOR_ADDRESS` | `packages/config` | Contract addresses |
| `SCORER_RPC_URL` | network RPC | Override the JSON-RPC endpoint |
| `SCORER_ATTESTOR_KEY` | `strata-<network>-attestor` | Keystore name loaded through `@strata/keys` (D16) |
| `SCORER_SETTLE_DELAY_SEC` | 120 | Wait after an epoch ends; at least 75 |
| `SCORER_POLL_SEC` | 30 | Scheduler interval; doubles on each failure, up to 8 times |
| `SCORER_METRICS_PORT` | 9464 | Prometheus `/metrics` and `/healthz` |
| `SCORER_DRY_RUN` | false | Compute and store, never sign or post |
| `SCORER_ALLOW_MAINNET_POSTING` | false | Must be set explicitly before the scorer will post to mainnet |
| `SCORER_EPOCH_SECONDS` | 3600 | Expected epoch length; a mismatch with the chain is logged |

Commands, from `services/scorer`:

- `pnpm start` runs the scheduler. `scripts/start.sh` is the container entrypoint.
- `pnpm score-once` runs one dry-run pass.
- `pnpm test` runs unit and golden tests. Set `SCORER_IT_DATABASE_URL_FILE` to also run the Postgres
  integration test.
- `pnpm e2e:anvil` deploys the real contracts to a local anvil chain, seeds a throwaway database,
  runs the scorer process twice and checks every score with `verifyScore` onchain.

Prometheus metrics: `strata_scorer_epoch_post_failures_total` (alert on any increase),
`strata_scorer_epochs_posted_total`, `strata_scorer_epochs_skipped_total`,
`strata_scorer_root_mismatch_total`, `strata_scorer_last_posted_epoch`,
`strata_scorer_last_tick_timestamp_seconds`.
