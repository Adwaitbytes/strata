# STRATA security

Status: R0, testnet release stage (D33). Started by W11 (independent review) on 2026-11-09. Findings and fixes are
tracked in `docs/SECURITY_REVIEW.md`; this file describes the model, the controls and the limitations.

## 1. Scope and assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| House agent trading keys (`strata-test-1..3`, `strata-options`; later `strata-atlas`, `strata-meridian`) | Encrypted keystores in `.secrets/keystores/` on the owner's Mac | Control the agent subaccount funds |
| Attestor key (`strata-testnet-attestor`) | Same | Anchors epoch score roots on chain |
| Deployer key (`strata-testnet-deployer`) | Same | Testnet contract owner by default |
| Contract owner (mainnet) | Owner's hardware wallet or Safe (D7, pending) | Seasons, markets, suspensions, attestor rotation |
| Database (Neon prod, TimescaleDB local) | Neon free tier, Docker on the Mac | Everything the API and site show; kill command queue |
| Service secrets (internal kill token, Telegram bot token, Anthropic key, Neon URL) | `.secrets/` (mode 700 / 600, gitignored) | Kill path, alerts, AI tuner, data |
| Score integrity | `ScoreAttestor` roots + published JSON | The product: a verifiable leaderboard |

## 2. STRIDE threat model

Trust boundaries: (A) public internet to the web app and API on Vercel; (B) API and services to the database;
(C) agents, scorer and indexer to Injective RPC / Indexer endpoints; (D) owner wallet and Telegram to the kill switch;
(E) any EVM account to the arena contracts; (F) the owner's Mac (keys, workers) to everything else.

| STRIDE | Threat | Boundary | Control in place | Gap / reference |
|---|---|---|---|---|
| Spoofing | Enroll another trader's subaccount to take its score | E | ERC-8004 `ownerOf` check on the identity only | **H-1**: subaccount not bound to caller |
| Spoofing | Forge an admin kill | A, D | EIP-191 owner signature, network-bound, 10-min expiry, single-use nonce; Telegram whitelist plus constant-time bearer token | M-4 (API kill not consumed), L-7 (no deployment domain) |
| Spoofing | Post a fake epoch root | E | Only `arena.attestor()` may post | Attestor is a hot key (M-5) |
| Spoofing | Spoof client IP to dodge rate limits | A | `trustProxy` only on Vercel, which overwrites `X-Forwarded-For` | L-10 |
| Tampering | Alter a posted score | E | Roots are write-once per (season, epoch); leaves commit to all nine fields | L-1 (`verifyLeaf` accepts nodes) |
| Tampering | Brick or pollute a season's epochs | E | Strictly increasing epochs | **M-1**: no upper bound on epoch |
| Tampering | Stale or manipulated oracle drives quotes | C | Oracle Guard on chain time: stale, future (+2 s), oracle vs book, jump vs book (own orders excluded), two-source check | M-3 (no chain-lag check), L-3 (missing reference ignored) |
| Tampering | Write rows directly to the DB | B | Credentials only in `.secrets/`; API never builds SQL strings | I-2: Neon URL passed through chat, rotate |
| Tampering | SQL injection | A, B | zod on every input, Drizzle / tagged-template bound parameters only | None found |
| Repudiation | Who killed or suspended what | D, E | Kill commands stored with signer, nonce, time; onchain events for every owner action; guard events published | Agent does not re-verify DB kill rows (M-4) |
| Information disclosure | Private key in logs, errors or git | F | `KeyHandle` cannot expose the key; errors redacted; CLI prints addresses; gitleaks clean history | I-6 (mnemonic redaction claim) |
| Information disclosure | Verbose API errors, client IPs in logs | A | Fixed error messages, headers and IPs redacted from logs, in-memory rate-limit store swept each window | None found |
| Information disclosure | Secrets in LLM prompts | C | Tuner prompt carries market data only (PRD 9.7) | Reviewed by design only |
| Denial of service | Flood API or WebSocket | A | Global rate limit, 16 KB body limit, WS connection cap, per-route kill limit | L-10 (per-instance counters) |
| Denial of service | Fill `agentCap` with sybil identities | E | `agentCap` 0 by default, `operatorCap` 1 | Identities are free; keep `agentCap` 0 or add a bond |
| Denial of service | RPC outage mid-cycle | C | Cancel-on-uncertainty, timeouts, endpoint failover, fresh process starts uncertain | L-4 (settle window shorter than tx timeout) |
| Elevation of privilege | Agent key used beyond trading | F | None in R0 (key owns funds) | M-5: use authz scoped grants before mainnet |
| Elevation of privilege | Risk limits bypassed | F | Bounded params, mainnet cap refused above `MAINNET_CAPITAL_CAP_USD` | **H-2** (stops reset on restart), L-2 (NaN), `assertMainnetCaps` not wired yet |
| Elevation of privilege | Contract owner takeover | E | `Ownable2Step`, renounce disabled, owner = Safe on mainnet (PRD 8.4) | I-3: deploy script does not enforce Safe |

## 3. Key management

**Design (D16, D28).** Every key is generated locally by `pnpm --filter @strata/keys new-testnet-key <name>`: a fresh random
secp256k1 key encrypted as a Web3 Secret Storage v3 keystore (scrypt N = 2^17) under a random 32-byte passphrase.
The keystore goes to `.secrets/keystores/<name>.json` and the passphrase to `.secrets/<name>.pass` (or the macOS Keychain
with `--keychain`), both created mode 600 with no-overwrite. `.secrets/` is mode 700 and gitignored. Services load keys only
through the `KeySource` interface; the returned `KeyHandle` signs digests and legacy EVM txs and never exposes the key
(closure-held, frozen, redacted `toJSON` / `inspect` / `toString`). Errors leaving the package pass through
`redactSecrets`. The CLI prints addresses only. Agents never generate mainnet keys; the owner creates and funds them (D7).
A different `KeySource` (AWS KMS, Secrets Manager) can replace the keystore backend without touching callers.

**Runtime (D25).** Long-running workers run in Docker on the owner's Mac with `restart: always`. Each container gets only its
own keystore and passphrase as read-only bind mounts; other secrets are Docker secrets under `/run/secrets/`; nothing secret is
an env var or baked into an image. Published ports bind to `127.0.0.1`.

**Contract roles.** Testnet: owner = attestor = deployer hot key, acceptable for testnet only. Mainnet: owner must be the
owner's hardware wallet or Safe (PRD 8.4, D7, pending), attestor a separate key that can only post epochs. Mainnet deploy is
refused without `STRATA_ALLOW_MAINNET=yes`; `RewardsDistributor` is never deployed to mainnet in R0.

**Limitations (accepted for R0, must change before mainnet capital).**
- Keys live on one personal Mac, not in an HSM or KMS. No AWS account exists (D16).
- The `.pass` file sits next to the keystore, so anyone who can read the user's home directory has the keys; encryption at
  rest only protects copies of the keystore alone. Use `--keychain` for mainnet keys (M-5).
- Agent hot keys own their funds; there is no Injective authz scoping yet (PRD 16.1 prefers it). A compromised agent
  process can transfer the balance, not only trade (M-5).
- The Mac must stay on and patched; disk encryption (FileVault), a screen lock and no cloud sync of the repo folder are
  required controls.
- The Neon connection string and the Anthropic API key were pasted in chat (D34). **Rotate both** after the hackathon.
  Rotate any secret that ever appears in a chat, a screenshot, a log or a PR.

## 4. Static analysis (contracts)

Source: `docs/security/slither.txt`, `docs/security/aderyn.md` (W1, 2026-11-09).

| Tool | High | Medium | Low / Info | Disposition |
|---|---|---|---|---|
| Slither 0.11.6 (102 detectors) | 0 | 0 | 5 `timestamp` | Accepted: comparisons of `block.timestamp` against season end and the 30-day claim window; validator drift is seconds, windows are hours to days |
| Aderyn 0.6.8 | 0 | 0 | 1 (L-1 centralization) | Accepted: owner powers are by design and mitigated by a Safe owner on mainnet |

Static analysis does not flag the logic issues found in manual review (H-1, M-1, L-1). Those need contract changes and
new tests by W1 before the mainnet deploy.

## 5. Test coverage (measured 2026-11-09 by W11)

| Package | Result | Coverage |
|---|---|---|
| `packages/contracts` (forge) | 142 passed, 0 failed (unit, fuzz 1024 runs, invariants 256 x 64, deploy script) | 100% lines, statements, branches, functions on `src/` (W1 `forge coverage`) |
| `packages/risk` (vitest) | 95 passed | 100% lines, 97.5% branches (`coverage/coverage-summary.json`) |
| `packages/keys` | 16 passed | not measured |
| `packages/sdk` | 3 passed (merkle) | not measured; golden vectors also checked in forge |
| `services/agent` | 78 passed | not measured |
| `services/scorer` | 89 passed, 1 failed, 3 skipped | not measured (I-7) |
| `services/indexer` | 30 passed | not measured |
| `apps/api` | 66 passed, 2 skipped (DB integration, needs a database) | not measured |
| `apps/web` | 57 passed | not measured |

Not yet present (PRD 17): 6-hour testnet agent soak, chaos tests (kill RPC / DB mid-cycle), kill-switch end-to-end test on
testnet with a recorded clip, reduce-only close path on testnet, Playwright E2E, 200-client WS load result.

## 6. Known limitations

1. Release stage is testnet (D33). Mainnet steps are prepared, not executed, and are blocked on the owner's funded wallet,
   the owner Safe address, and the High and Medium fixes in `docs/SECURITY_REVIEW.md`.
2. Key custody on the owner's Mac (section 3).
3. Workers depend on one Mac staying online (D25). If it sleeps, agents stop quoting (fail-safe) and scoring pauses.
4. The ERC-8004 identity registry is an Injective-owned upgradeable proxy; its behavior can change underneath the arena.
5. Identities are free to mint, so enrollment is sybil-cheap. Scores, not enrollment, carry weight; keep `agentCap` 0 or
   add a bond before any reward has real value.
6. Scoring trusts the database and the scorer host. The onchain root proves the published leaderboard was not changed after
   posting; it does not prove the inputs were honest.
7. Rate limiting is per serverless instance.
8. Market-hours calendar data covers 2026 only (L-5).
9. `RewardsDistributor` roots are write-once: a wrong root cannot be fixed, only swept after 30 days.
