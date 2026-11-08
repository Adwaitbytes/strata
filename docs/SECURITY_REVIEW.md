# STRATA security and QA review (W11)

Reviewer: W11, independent of every stream that wrote the code. Snapshot: `HEAD 78843ec` plus the uncommitted
work in the tree at 2026-11-09 00:30 IST. Several services (Injective adapter, agent kill-command consumer,
indexer subaccount map) are still in progress, so findings against them describe the gap as it stands.

**No Critical findings.** The top finding (H-1) becomes Critical as soon as `RewardsDistributor` pays tokens of
real value or the leaderboard decides anything with money attached.

**H-1 (High): anyone can enroll a subaccount they do not control and take over its score.** See below.

## Findings table

| ID | Severity | Title | Location | Status |
|---|---|---|---|---|
| H-1 | High | Enrollment does not bind `subaccountId` to the caller; duplicate subaccounts allowed | `packages/contracts/src/StrataArena.sol:71-109`, `services/indexer/src/arena/project.ts:56-69`, `services/indexer/src/live/mappers.ts:61` | PoC passes |
| H-2 | High (latent, mainnet) | Risk Governor stops (daily loss, season drawdown) are in memory only; any restart clears them | `services/agent/src/core/loop.ts:102`, `packages/risk/src/riskGovernor.ts:40-47` | Verified by reading |
| M-1 | Medium | Attestor can brick a season (`epoch = 2^64-1`) and post far-future epochs or epochs for ended seasons | `packages/contracts/src/ScoreAttestor.sol:34-55` | PoC passes |
| M-2 | Medium | Kill and risk "close positions" run one reduce-only IOC and never retry; a partial fill on a thin book leaves a position open | `services/agent/src/core/loop.ts:452-455`, `:475-478` | Verified by reading |
| M-3 | Medium | No check that chain time is current: a lagging node gives a self-consistent stale view that passes every oracle check | `packages/risk/src/oracleGuard.ts:62-100`, `services/agent/src/core/loop.ts:335` | Verified by reading |
| M-4 | Medium | Signed admin kill (`POST /v1/admin/kill`) reaches no agent; API and agent sign different messages | `apps/api/src/admin/kill.ts:21-30`, `services/agent/src/core/killSwitch.ts:98-107`, `packages/db/migrations/0003_kill_commands.sql` | Verified by grep |
| M-5 | Medium | Agent hot keys have full account authority (no authz scope) and each keystore's passphrase sits next to it | `packages/keys/src/keystore.ts:43-55`, `infra/compose/stack.yml:118-199`, `services/agent/src/injective/tx.ts` | Known limitation (D16, D25) |
| L-1 | Low | `verifyLeaf` and sdk `verifyProof` accept an internal node or the root as a leaf | `packages/contracts/src/ScoreAttestor.sol:78-84`, `packages/sdk/src/merkle.ts:122-126` | PoC passes |
| L-2 | Low | NaN mark price or margin ratio silently skips gross, net and margin checks; `marginRatio: null` is treated as healthy | `packages/risk/src/riskGovernor.ts:137-187` | Verified by reading |
| L-3 | Low | Two-source oracle check is skipped when the reference is missing, stale or future-dated | `packages/risk/src/oracleGuard.ts:95` | Verified by reading |
| L-4 | Low | Settle window (6 s) is shorter than the Cosmos tx timeout (40 blocks), so a lost tx can land after reconciliation | `services/agent/src/core/loop.ts:255`, `services/agent/src/injective/tx.ts:44` | Verified by reading |
| L-5 | Low | Market-hours calendar ends in 2026 and nothing fails closed after it | `packages/risk/src/data/calendar.json`, `packages/risk/src/sessionGuard.ts:310` | Verified |
| L-6 | Low (QA) | `init-secrets.sh` runs `chmod 600` on the `keystores/` directory and makes every keystore unreadable | `infra/scripts/init-secrets.sh:47` | Observed on disk (`drw-------`) |
| L-7 | Low | Kill signatures are not bound to a deployment; agent nonce store is in memory | `services/agent/src/core/killSwitch.ts:115-128`, `apps/api/src/admin/kill.ts:21` | Verified by reading |
| L-8 | Low | `metadataURI` has no scheme check onchain or in the API schema | `StrataArena.sol:221-224`, `packages/sdk/src/types.ts:85` | Verified by reading |
| L-9 | Low | Keychain passphrase passed on the `security` command line (visible in `ps`) | `packages/keys/src/keystore.ts:72-75` | Verified by reading |
| L-10 | Low | Rate limits are per process (per Vercel instance); `TRUST_PROXY=true` off Vercel trusts a client-supplied `X-Forwarded-For` | `apps/api/src/create-app.ts:84-91`, `apps/api/src/config.ts:73` | Verified by reading |
| I-1 | Info | Git history clean of real secrets; gitleaks hits are false positives | see below | gitleaks run |
| I-2 | Info | Neon URL and Anthropic key were pasted in chat (D34): rotate | `.secrets/` | Owner action |
| I-3 | Info | Mainnet deploy does not check that OWNER is a contract (Safe) or that OWNER != ATTESTOR | `scripts/deploy-contracts.sh:43-45` | Verified by reading |
| I-4 | Info | ERC-8004 registry is an Injective-controlled upgradeable proxy | `StrataArena.sol:87` | Dependency risk |
| I-5 | Info | Onchain verify must take the ScoreAttestor address from `packages/config`, never from the API | `apps/web/lib/verify.ts:46` | Not wired yet |
| I-6 | Info | `redact.ts` says it strips mnemonics; it only strips 32-byte hex | `packages/keys/src/redact.ts:1-9` | Doc mismatch |
| I-7 | Info (QA) | Scorer has one failing test | `services/scorer/src/epoch.test.ts` | `vitest run` |

Proof-of-concept tests for H-1, M-1 and L-1 live outside the repo (the reviewer does not edit W1's folder). To reproduce,
copy `packages/contracts/{foundry.toml,src,lib,test/mocks}` to a scratch directory, add the test in the appendix, and run
`forge test --match-contract W11Poc`. Result: 4 of 4 pass, which confirms every behavior described below.

---

## H-1: Enrollment does not bind `subaccountId` to the caller

**Where.** `StrataArena.enroll` (lines 71-109) checks only that the caller owns the ERC-8004 identity. `subaccountId`
is any non-zero `bytes32`. Nothing stops two agents from claiming the same subaccount. The indexer then copies
`subaccountId` from the `AgentEnrolled` event into `agents.subaccount_id` (`project.ts:64-66`) and attributes trades with
`agentBySubaccount.get(subaccountId)` (`mappers.ts:61`), a map keyed by subaccount, so one subaccount maps to exactly one
agent: whichever row lands in the map last.

**Exploit.**
1. Attacker calls ERC-8004 `register()` (permissionless per the ERC-8004 identity registry design) and gets identity N for free.
2. House agent `strata-test-1` trades from subaccount `0xa37f...ed8a000000000000000000000000` (address + nonce 0, public in
   `docs/STATUS.md` and on chain).
3. Attacker calls `enroll(N, <that subaccount>, "ipfs://x")`. It succeeds (PoC `test_poc_enrollVictimSubaccount`).
4. Depending on map order, the attacker's agent receives the house agent's fills, depth and uptime, or both agents score
   on the same activity. The scorer builds a leaf for the attacker, the attestor anchors it on chain, and
   "verify my score" returns true. When `RewardsDistributor` is used, the attacker claims the victim's reward.
   Cost: one identity mint and one enroll tx.

The same attack copies any profitable third-party market maker on Injective, not only house agents.

**Fix (contract).** Injective subaccount IDs are the 20-byte trader address followed by a 12-byte nonce, and the EVM
and `inj1` forms share those 20 bytes. Require the caller to be that trader and keep subaccounts unique per season:

```solidity
error SubaccountNotOwned();
error SubaccountTaken();
mapping(uint64 season => mapping(bytes32 subaccountId => bool)) public subaccountEnrolled;

// in enroll(), after the ZeroSubaccount check:
if (address(bytes20(subaccountId)) != msg.sender) revert SubaccountNotOwned();
if (subaccountEnrolled[season][subaccountId]) revert SubaccountTaken();
// in the effects block:
subaccountEnrolled[season][subaccountId] = true;
```

If operators must be able to enroll a trader wallet different from the identity holder, add an EIP-712 consent signature
from `address(bytes20(subaccountId))` over `(arena, chainid, season, erc8004Id, operator)` rather than dropping the check.

**Fix (off chain, defense in depth).** In the indexer, ignore an `AgentEnrolled` whose subaccount owner is not the operator
and refuse to build `agentBySubaccount` if a subaccount appears twice (fail loudly). Add a unique index
`agents (network, subaccount_id) WHERE status = 'active'`. Add forge tests for both new reverts.

---

## H-2: Risk Governor stops are lost on restart

**Where.** `AgentRisk` starts from `INITIAL_RISK_STATE` (`loop.ts:102`) and never persists it. `stoppedForSeason`,
`stoppedForDay`, `peakEquityUsd` and `dayStartEquityUsd` live only in process memory. The containers run with
`restart: always` on the owner's Mac (D25).

**Exploit / failure scenario.** A mainnet agent loses $150 and hits `maxDrawdownUsd`. The governor closes positions and
halts "pending human review". Any of these resumes trading with the peak re-based to the current, already reduced, equity:
an unhandled exception that crashes the process, a Docker or Mac restart, an OOM kill, or `docker compose up` after an
image rebuild. Each restart grants a fresh $150 drawdown and a fresh $50 daily loss, so the D6 season limit is not a limit.
No attacker is needed; RPC instability that crashes the process is enough. Latent today because mainnet is blocked (D27, D33).

**Fix.** Persist `RiskState` (and the kill latch) in the database on every change, load it at boot, and refuse to quote if
it cannot be loaded:

```ts
// packages/db: CREATE TABLE agent_risk_state (network network, agent_id int, state jsonb NOT NULL,
//   updated_at timestamptz NOT NULL, PRIMARY KEY (network, agent_id));
const saved = await riskStore.load(identity);          // throws -> process exits, nothing quoted
const risk = new AgentRisk(identity, sink, ids, now, metrics, saved ?? INITIAL_RISK_STATE);
// after each evaluate(): if (changed(prev, next)) await riskStore.save(identity, next);
```

`stoppedForSeason` must only be cleared by an owner-signed admin action (the same signature scheme as kill), never by
restart. Seed `peakEquityUsd` from the stored value, not from the first observation. Add a test that kills and
re-creates `AgentRisk` after a drawdown stop and asserts it stays halted.

---

## M-1: Attestor can brick a season and post out-of-window epochs

**Where.** `ScoreAttestor.postEpoch` only requires `epoch > lastEpoch` and `1 <= season <= currentSeason`.

**Exploit.** The attestor key is a hot key on the owner's Mac (D16, D25). Whoever holds it can:
- post `epoch = type(uint64).max` once; every later post for that season reverts `EpochOutOfOrder` forever, and the
  contract is immutable (PoC `test_poc_attestorBricksSeason`);
- post epochs for a season that already ended, or epoch numbers far past `endTime` (PoC `test_poc_postAfterSeasonEnd`),
  which the indexer projects into `epochs` and the site shows as attested.

The owner can rotate the attestor, but cannot undo a bricked season.

**Fix.** Bound the epoch by the season clock:

```solidity
IStrataArena.Season memory s = a.seasons(season); // add a getter to IStrataArena if needed
uint256 epochEnd = uint256(s.startTime) + (uint256(epoch) + 1) * s.epochSeconds;
if (epochEnd > block.timestamp || epochEnd > uint256(s.endTime) + s.epochSeconds) revert EpochOutOfWindow(season, epoch);
```

This makes an epoch postable only after it has ended and only inside its season, so a single bad post can no longer
jump to `2^64-1`. Add fuzz coverage for the bound.

---

## M-2: Close-positions is attempted once and never retried

**Where.** `#halt` sets `#riskClosed = true` after one `closePositionReduceOnly` call (`loop.ts:452-455`), and
`#handleKill` sets `#killClosed = true` the same way (`:475-478`).

**Scenario.** RWA books on Injective are often empty or one-sided (STATUS W4: SICI 0 bids / 0 asks, XAU 2 stale bids).
A reduce-only IOC on such a book fills partly or not at all, the call resolves without throwing, and the agent never tries
again. The dashboard says "positions closed" (`killSwitch.ts:75`) while inventory remains, exposed to the next gap.

**Fix.** Make "closed" a property of the position, not of the call:

```ts
const pos = await withTimeout(adapter.getMarketState(id), t, "getMarketState");
if (new Decimal(pos.position.quantity).abs().gte(spec.minQuantityTick)) {
  await withTimeout(adapter.closePositionReduceOnly(id), t, "closePositionReduceOnly");
  // do not latch; next cycle re-reads the position and tries again
}
```

Emit a guard event each time a close attempt leaves a residual, and alert after N failed attempts. Only report
"positions closed" once the position reads zero.

---

## M-3: No chain-lag check

**Where.** Oracle Guard compares the oracle timestamp only to `chainTimeMs` (`oracleGuard.ts:79-100`), and
`chainTimeMs` comes from the same node or Indexer that served the oracle and the book.

**Scenario.** A sentry falls 60 s behind (PRD 26 lists RPC instability). It returns an old block, an oracle report a few
seconds older than that block, and the book as of that block. Every check passes: age is small relative to the stale
chain time, oracle and book agree. The agent quotes 60 s old prices, and its batch may be broadcast through a healthy node
and fill at stale levels. The guard is designed to stop exactly this (the Ostium lesson), but it measures "stale" against a
clock that is itself stale.

**Fix.** Add `maxChainLagSec` (default 10) to `RiskParams` and halt with a new `chain_lag` reason when
`wallClockMs - chainTimeMs > maxChainLagSec * 1000` (use the host's NTP clock only for this comparison). Fixture test:
oracle 1 s old relative to chain, chain 60 s behind wall clock, expect halt.

---

## M-4: Signed admin kill reaches no agent

**Where.** `POST /v1/admin/kill` verifies the owner signature and inserts into `kill_commands` with a `pg_notify`
(`apps/api/src/repo/drizzle.ts:384-404`). No code in `services/` reads `kill_commands` or listens on `strata_kill`
(grep, 2026-11-09). Separately, the API signs `"STRATA admin kill\n..."` (`apps/api/src/admin/kill.ts:23`) while the agent's
own endpoint expects `"STRATA kill request\n..."` (`services/agent/src/core/killSwitch.ts:100`), although the agent's
comment says the API must build exactly the agent's string.

**Impact.** PRD 9.6 (b) and 16.4 require the signed kill to work and be tested before mainnet. Today the owner gets a
`202 accepted` and the agents keep quoting. That is worse than an error.

**Fix.** Move the canonical message builder into `packages/sdk` and import it from both sides. Store the signature in
`kill_commands` and have each agent poll or `LISTEN` and re-verify the signature itself before latching, so DB write
access alone (see I-2) cannot forge a kill or suppress one silently. Add an end-to-end test: sign, POST, agent halts.

---

## M-5: Hot keys with full authority; passphrase stored beside the keystore

**Where.** `filePassphrase` reads `<secretsDir>/<name>.pass` from the same directory as `keystores/<name>.json`; compose
bind-mounts both into each container. `CosmosSigner` signs any message with the agent key, and the key owns the
subaccount funds (no authz grant).

**Scenario.** Anyone who can read the owner's home directory (malware, a stolen unlocked laptop, a backup synced to a cloud
drive) gets every key; the scrypt encryption adds nothing because the passphrase is next to it. A compromised agent process
can `MsgSend` or withdraw the whole balance, not only trade.

**Fix (before mainnet).** Use Injective authz: the funded granter key stays offline (hardware wallet) and grants the agent
hot key a `GenericAuthorization` for `MsgBatchUpdateOrders` (and the cancel and create messages) only, with an expiry.
Verify the supported authorization types in the Injective docs first, as PRD 16.1 says. Store passphrases in the macOS
Keychain (`--keychain` already exists) instead of `.pass` files for every mainnet key. Documented as a known limitation in
`docs/SECURITY.md`.

---

## Low

**L-1 `verifyLeaf` accepts internal nodes.** D20 says leaf (288-byte preimage) and node (64-byte preimage) cannot collide.
That holds for `verifyScore`, which builds the leaf itself. `verifyLeaf(season, epoch, leaf, proof)` and the sdk
`verifyProof(leaf, proof, root)` take the leaf as a raw hash, so any internal node with a shorter proof, or the root with an
empty proof, returns true (PoC `test_poc_verifyLeafAcceptsInternalNode`). Any integrator that treats
`verifyLeaf == true` as "this agent has a score" can be fooled. The web app is safe today because it rebuilds the leaf from
fields. Fix: delete `verifyLeaf`, or rename it `verifyNode` with NatSpec that it proves membership of a hash, not of a
score; in the sdk, export a `verifyScore(fields, proof, root)` that always rebuilds the leaf.

**L-2 NaN and null skip risk checks.** `gross > limit`, `net > limit` and `marginRatio < min` are all false when the value is
NaN, so one market with a NaN mark price disables gross and net limits for the whole agent. `marginRatio: null` skips both
margin checks even when a position is open. Fix: at the top of `evaluateRisk`, halt with `data_unavailable` when any
`quantityBase` or `markPrice` is not finite, or when `marginRatio` is null while any position is non-zero.

**L-3 Reference check silently skipped.** If `reference` is null, stale or future-dated, the two-source check does not run
and nothing is reported. Fix: when a market is configured with a reference source, treat a missing or stale reference as
`oracle_source_unavailable` (halt or widen, configurable) and apply the same future-skew check as the primary.

**L-4 Settle window vs tx timeout.** `settleMs` is 6 s; `CosmosSigner` sets `timeoutHeight = height + 40`. A broadcast that
timed out client-side can be included after reconciliation sees an empty book, so the quoter posts a second ladder. The next
cycle's diff cancels the extras (post-only, one cycle), so impact is small. Fix: record the last broadcast's
`timeoutHeight` and stay uncertain until chain height passes it.

**L-5 Calendar validity.** US equity, FX and CME holidays stop at 2026-12-25. On 2027-01-01 the guard treats closed markets as
open. Fix: add `validUntil` to `calendar.json` and halt every non-crypto market with `session_calendar_expired` after it.

**L-6 Keystore directory permissions.** `chmod 600 "$DIR"/* ` also hits `keystores/`, removing the execute bit
(observed: `.secrets/keystores` is `drw-------`, listing is denied). Key loading, `scripts/deploy-contracts.sh` and compose
bind mounts then fail. Fix: `find "$DIR" -type d -exec chmod 700 {} + ; find "$DIR" -type f -exec chmod 600 {} +`.

**L-7 Kill signature scope.** Messages bind `network` but not the deployment, and the agent's `MemoryNonceStore` is cleared
on restart. An observed request can be replayed within its 10-minute expiry to a restarted agent or to a second deployment
(staging and production sharing an owner). Impact is limited to an unwanted kill (fail-safe). Fix: add `domain:
<API origin>` and the arena address to the signed text, and persist consumed nonces (the `admin_nonces` table already
exists).

**L-8 `metadataURI` scheme.** Any string up to 512 bytes is accepted on chain and returned by the API. A
`javascript:` or `data:` URI rendered as a link or image becomes a stored XSS or phishing vector. React 19 blocks
`javascript:` in `href` and the CSP blocks inline script, so this is defense in depth. Fix: in the sdk schema accept only
`ipfs://` and `https://`, render anything else as plain text, and never fetch it server side without an allow-list
(SSRF).

**L-9 Keychain argv.** `security add-generic-password ... -w <passphrase>` exposes the passphrase to other local users via
`ps` for the life of the process. Fix: pass it through a Keychain binding (for example `keytar`) or a helper that reads
stdin.

**L-10 Rate limiting.** The in-memory store is per Vercel instance, so the effective limit scales with instance count. On
Vercel the platform overwrites `X-Forwarded-For`, so `trustProxy` is safe there; anywhere else `TRUST_PROXY=true` lets a
client pick its own rate-limit key. Fix: document that `TRUST_PROXY` must only be set behind a proxy that overwrites the
header, and move to a shared store (Postgres or Upstash free tier) if abuse shows up.

## Info

**I-1 Git history.** `git log -p` over all 11 commits, plus `gitleaks git --redact`: 4 hits, all false positives. The secp256k1
scalar-1 test vector in `packages/keys/src/keys.test.ts:21` (commit `e2d1e9d`) is built at runtime and is a public test key.
`.claude/skills/injective-trading-bridge/SKILL.md:55,82,84` (commit `ef57787`) are public token contract addresses. The
first `.env.example` (commit `ef57787`) contained a local development database password that is the literal default, is
not the current `.secrets/db_password`, and binds to `127.0.0.1` only. No private keys, mnemonics, `sk-ant` keys or Neon
`npg_` passwords appear anywhere in history. `.secrets/` is gitignored and mode 700 / 600.

**I-2 Secrets pasted in chat.** Per D34 the Neon connection string and the Anthropic API key passed through a chat
transcript. Rotate both after the hackathon (Neon: reset role password; Anthropic: revoke key). The Neon URL grants write
access to every table the API serves, so until rotation it can forge leaderboard rows and kill commands (see M-4).

**I-3 Mainnet deploy guard.** `deploy-contracts.sh` requires `OWNER` and `ATTESTOR` on mainnet but does not check that `OWNER`
has code (a Safe) or that `OWNER != ATTESTOR`. Add `[[ "$(cast code "$OWNER" --rpc-url "$RPC_URL")" != "0x" ]]` and an
inequality check before the mainnet broadcast. Testnet defaults (owner = attestor = deployer hot key) are acceptable for testnet.

**I-4 ERC-8004 registry is upgradeable** by Injective (W1 note). An upgrade could change `ownerOf` semantics. Accept and monitor.

**I-5 Onchain verify address source.** `verifyOnchain` takes the attestor address as an argument. Wire it from
`packages/config` (static, reviewed) and never from an API response; otherwise a compromised API can point the browser at a
contract that always returns true.

**I-6** `redact.ts` comment claims mnemonic redaction; only 32-byte hex is stripped. Either implement or fix the comment.

**I-7** `services/scorer`: `epoch.test.ts > computeEpoch > skips an epoch where every agent lacks enough book coverage` fails
(89 pass, 1 fail, 3 skipped). Work in progress at review time.

## What was checked and found sound

- Access control on all three contracts: every owner function is `onlyOwner`, `Ownable2Step`, renounce disabled, no
  proxy, no payable, no `receive`. Only `arena.attestor()` can post. Invariant suite covers these.
- Reentrancy: `ownerOf` and arena reads compile to `STATICCALL`. `RewardsDistributor` is `nonReentrant`, effects before
  interactions, exact-balance check rejects fee-on-transfer tokens, per-season accounting stops cross-season drain, claim
  bitmap prevents double claims, sweep only after the window and only once. No rounding surface (amounts are whole token units in leaves).
- Merkle: contract `computeLeaf` and sdk `encodeLeaf` match (golden vectors), sorted-pair nodes match OZ `MerkleProof`.
  `RewardsDistributor` uses the double-hashed OZ StandardMerkleTree leaf.
- Epoch ordering: duplicates and regressions revert; gaps allowed by design.
- Keys: `KeyHandle` never exposes the key (closure, frozen, custom `toJSON` and `inspect`), errors pass through
  `redactSecrets`, the CLI prints addresses only, new keystores and passphrase files are created `0600` with `wx`
  (no overwrite). No logging of key material anywhere in `services/` or `packages/`.
- Kill switch (agent side): EIP-191 signature checked with viem, network bound, expiry bounded to 10 minutes, nonce
  consumed only after the signature verifies, internal token compared in constant time, kill latch never reverses.
- Cancel-on-uncertainty: any adapter error or timeout cancels all and blocks creates until open orders read empty;
  a fresh process starts uncertain; live orders are re-read every cycle.
- Oracle Guard uses chain time, catches future-dated (> +2 s) and stale (> 30 s) reports, takes the oldest of base and quote
  timestamps, and fails closed on unit mix-ups. Fair value uses the book without the agent's own orders, so the agent cannot
  confirm its own oracle jump.
- `MAINNET_CAPITAL_CAP_USD = 1000` in `packages/config`, and `assertMainnetCaps` refuses (does not clamp) a mainnet config
  above it. It is not called anywhere yet: the agent bootstrap must call it before loading a mainnet key.
- API: zod on every input, Drizzle bound parameters only, fixed error messages (no stack traces), helmet with
  `default-src 'none'` CSP, HSTS, `frame-ancestors 'none'`, exact-match CORS allow-list (empty list allows nothing), 16 KB
  body limit, IPs and headers redacted from logs, kill nonce consumed atomically with the insert, `ALLOW_MOCK` refused in
  production.
- Web: per-request nonce CSP with `strict-dynamic`, no `unsafe-inline` scripts, no third-party script origins,
  `frame-ancestors 'none'`, HSTS, `nosniff`, COOP. The only `dangerouslySetInnerHTML` uses are a nonce'd static script and
  JSON-LD with `<` escaped.

## Appendix: PoC test (`test/W11Poc.t.sol`, run in a scratch copy)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Test} from "forge-std/Test.sol";
import {StrataArena} from "../src/StrataArena.sol";
import {ScoreAttestor} from "../src/ScoreAttestor.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";

contract W11Poc is Test {
    StrataArena arena; ScoreAttestor sa; MockIdentityRegistry reg;
    address owner = makeAddr("owner"); address attestor = makeAddr("attestor");
    address victim = makeAddr("houseAgent"); address attacker = makeAddr("attacker");
    uint64 constant T0 = 1_800_000_000;

    function setUp() public {
        vm.warp(T0);
        reg = new MockIdentityRegistry();
        arena = new StrataArena(owner, attestor, address(reg));
        sa = new ScoreAttestor(address(arena));
        reg.mint(victim, 1); reg.mint(attacker, 2);
        vm.prank(owner); arena.startSeason(T0, T0 + 7 days, 3600);
    }
    function _sub(address a, uint96 n) internal pure returns (bytes32) { return bytes32((uint256(uint160(a)) << 96) | n); }
    function _h(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function test_poc_enrollVictimSubaccount() public {
        bytes32 victimSub = _sub(victim, 0);
        vm.prank(victim); uint256 v = arena.enroll(1, victimSub, "ipfs://house");
        vm.prank(attacker); uint256 a = arena.enroll(2, victimSub, "ipfs://attacker");
        assertEq(arena.getAgent(v).subaccountId, arena.getAgent(a).subaccountId);
    }
    function test_poc_verifyLeafAcceptsInternalNode() public {
        bytes32 n01 = _h(keccak256("l0"), keccak256("l1")); bytes32 n23 = _h(keccak256("l2"), keccak256("l3"));
        bytes32 root = _h(n01, n23);
        vm.prank(attestor); sa.postEpoch(1, 0, root, "ipfs://e0");
        bytes32[] memory p = new bytes32[](1); p[0] = n23;
        assertTrue(sa.verifyLeaf(1, 0, n01, p));
        assertTrue(sa.verifyLeaf(1, 0, root, new bytes32[](0)));
    }
    function test_poc_attestorBricksSeason() public {
        vm.prank(attestor); sa.postEpoch(1, type(uint64).max, bytes32(uint256(1)), "x");
        vm.prank(attestor); vm.expectRevert(); sa.postEpoch(1, 1, bytes32(uint256(2)), "x");
    }
    function test_poc_postAfterSeasonEnd() public {
        vm.prank(owner); arena.endSeason();
        vm.warp(T0 + 365 days);
        vm.prank(attestor); sa.postEpoch(1, 999_999, bytes32(uint256(3)), "x");
    }
}
```
