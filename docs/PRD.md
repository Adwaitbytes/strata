# STRATA: Product Requirements Document (v1.0)

**The onchain proving ground where AI market-making agents compete to supply liquidity on Injective.**

| Field | Value |
|---|---|
| Owner | Yatharth Urmaliya (Yathu), Founder and CEO, Aarambh Labs |
| Builder | Claude Code orchestrator plus parallel subagents |
| Target | Injective Bangkok Hacker House (Dec 1 to 10, 2026), application closes **Nov 10, 2026** |
| Required stage | **Mainnet** (limited beta, team capital only) **plus Testnet** (full feature set incl. options) |
| Doc status | Final for build. Change only via the Decision Log (Section 25). |
| Date | Nov 8, 2026 |

---

## 0. READ THIS FIRST: Operating Rules for the Claude Code Orchestrator

You are the lead engineer and orchestrator. Follow these rules exactly.

1. **Read this entire document before writing any code.** Every section matters. Do not skim.
2. **Ask the owner every question in Section 23 in ONE single message, at the very start.** The owner will not be available later. After that message, make every remaining decision yourself using the defaults in this PRD, and record each decision in `docs/DECISIONS.md`. Never block on the owner again unless a step is irreversible AND not covered by this PRD (Section 23.3 lists the only allowed stop points).
3. **Work in parallel.** Split work into the workstreams in Section 20. Spawn one subagent per workstream as soon as its inputs exist. Define shared interfaces (Section 19) FIRST so streams never wait on each other.
4. **Use the strongest model available for every subagent** (Opus-class for contracts, risk engine and security review; the best available model for everything else). Do not downgrade to save cost.
5. **Load relevant skills before each stream starts** (Section 21): Injective agent skills, frontend-design, HyperFrames, and any skill that matches the task.
6. **Never invent facts.** If an Injective address, market ID, ABI, endpoint or SDK method is not verified from official docs, the Injective Docs MCP server, or a live chain query, do not hardcode it. Look it up and cite the source in a code comment. Section 4.4 lists what is verified already.
7. **Never fake data.** Every number on the website is either live from chain/indexer, or explicitly labeled `TESTNET`, `SIMULATED` or `BACKTEST`. A fake number shown as real is a selection-killing failure.
8. **Testnet first, then mainnet.** Every feature runs on Injective testnet (chain 1439, `injective-888`) end to end before it touches mainnet (chain 1776, `injective-1`).
9. **Security is not optional.** Section 16 is a hard gate. No mainnet deploy without its checklist passing.
10. **No em dashes (the long dash character) anywhere** in UI copy, docs, commit messages or comments. Use commas, colons or periods. The owner rejects AI-sounding copy: write UI text like a sharp human product team (Section 12.9).
11. **Commit early and often** with clear messages. Push to the GitHub repo from Section 23. Keep `main` deployable.
12. **Done means demoable.** At the end, produce the deliverables in Section 22 and a final report listing every live link.

---

## 1. Mission and Success Criteria

### 1.1 Mission
Get Aarambh Labs selected as one of the 20 teams for the Injective Bangkok Hacker House by submitting a **live mainnet product** that solves Injective's biggest problem: thin liquidity on its markets.

### 1.2 What "selected" requires (reviewer lens)
Reviewers are the Injective core team and HackQuest. They will:
- Open the website link. It must load fast, look world-class, and make the idea obvious in 5 seconds.
- Click through to live mainnet data. Contracts must be verified on Blockscout. Agents must be visibly quoting.
- Check fit with the program focus: RWAs, privacy, agentic apps, the new options primitive, SICI, x402, ERC-8004.
- Judge team credibility from the GitHub repo quality, docs and demo video.

### 1.3 Hard success criteria for Release 0 (submission)
| # | Criterion | Measure |
|---|---|---|
| S1 | Arena contracts live on Injective EVM **mainnet** and **testnet** | Verified on both Blockscout explorers |
| S2 | At least 2 STRATA house agents quoting live on **mainnet** RWA perp markets | Visible open orders on Injective, linked from the app |
| S3 | At least 3 agents running on **testnet** including 1 options-writing agent (if access granted) | Visible on testnet explorer and app |
| S4 | Public web app live on custom domain with Arena, Agent, Market, Join, Docs, Transparency pages | Lighthouse Performance 90+ on desktop, 80+ mobile; Accessibility 95+ |
| S5 | Onchain score attestations posted every epoch on mainnet | Events visible on Blockscout |
| S6 | Public GitHub repo with README, architecture diagram, docs | Clean history, CI green |
| S7 | 60 to 90 second demo video | MP4 1080p, made with HyperFrames |
| S8 | Pitch deck (10 slides) and filled application copy | In `deliverables/` |
| S9 | Zero critical or high security findings open | Slither, tests, manual review report |

---

## 2. Problem

Injective has excellent market infrastructure and almost no liquidity in it.

- 135 active RWA perpetual markets (equities, FX, commodities, indices), a new options primitive (testnet), the SICI GPU compute index, native USDC, x402 payments and ERC-8004 agent identity.
- But TVL is roughly $10 to 14M, stablecoin supply is small, and Helix (the flagship exchange) earned about $62 in fees over 30 days per DefiLlama in Nov 2026.
- Injective RWA perps did about $230M in a month. Hyperliquid builder markets (HIP-3) do about $1.4B per day. The difference is liquidity supply and distribution.
- Injective Options launched on testnet with whitelisted writers and a single institutional liquidity provider. No liquidity layer exists for it yet.
- Injective's own research ("Liquidity Availability") argues that usable liquidity, not TVL, is the real metric. STRATA directly improves usable liquidity.

**Root cause:** market making on Injective is done by a small number of professional firms. There is no open, measurable, permissionless way for new liquidity providers, especially AI agents, to prove themselves and get rewarded.

---

## 3. Solution

### 3.1 One-liner
STRATA is an open arena where AI market-making agents trade their own capital on Injective's order books, get scored onchain on spread, depth, uptime and risk-adjusted PnL, and earn rewards for the liquidity they add.

### 3.2 Why this shape (lessons built in)
| Known failure elsewhere | STRATA design response |
|---|---|
| Hyperliquid HLP vault took about $12M unrealized loss from the JELLY manipulation | **No pooled public vault in v1.** Agents use their own or team capital. Nothing to drain. |
| Ostium lost $18M to oracle reports with future-dated timestamps | **Oracle Guard** in every agent: reject stale or future timestamps, cross-check sources, halt on anomaly. |
| LLM trading bots mostly lose money (Alpha Arena: 6 of 32 runs profitable) | **AI never predicts price or places orders.** Deterministic quoting engine; AI only tunes risk parameters inside hard bounds. |
| Weekend and overnight gap risk on RWA perps | **Session-aware quoting**: widen, shrink, flatten before close; careful re-entry after open. |
| Mito and Upshift were closed vaults run by one team | **Open, permissionless arena** with public scoring and ERC-8004 identities. |
| SEC warnings about DeFi vaults and securities law | No pooled user funds in v1. Vault is a Phase 2 item, gated on audit and legal review. |
| Competing with Injective's Open Liquidity Program | STRATA positions as **the AI-agent lane into OLP**: it brings new, measured market makers to Injective. |

### 3.3 What STRATA is NOT (v1 non-goals)
- Not a public deposit vault. Do not build deposit or withdraw for public users in R0.
- Not a directional AI trading bot. No price prediction marketing.
- Not a custodian. STRATA never holds third-party keys or funds.
- Not available to US persons for any trading feature (geo-notice plus terms).

---

## 4. Ecosystem Facts (verified) and What to Look Up

### 4.1 Program facts
- Hacker House: Dec 1 to 10, 2026, Bangkok. 20 teams. Demo Day Dec 9. Focus: RWAs, privacy, agentic apps; builds on SICI and the new options primitive are encouraged.
- Partners: AWS, Animoca Brands, SMBC Nikko, OpenTensor (Bittensor), Ninja Labs, Gulf Labs (GULF Group, Thailand), HackQuest, LG CNS (RWA mentor).

### 4.2 Injective primitives STRATA uses
| Primitive | Status (Nov 2026) | STRATA use |
|---|---|---|
| Exchange module (on-chain order book, spot + perps) | Mainnet | Agents quote here |
| RWA perps (135 markets, USDC margined) | Mainnet | Primary arena markets |
| SICI (GPU compute index) perps | Mainnet since Oct 26, 2026 | Featured arena market |
| Injective Options | **Testnet only**, whitelisted writers | Options-writer agent on testnet |
| Native USDC + CCTP | Mainnet since May 2026 | Quote currency, agent capital |
| Injective EVM (MultiVM) | Mainnet | Arena contracts |
| ERC-8004 agent identity (agents.injective.com) | Mainnet | Agent identity |
| x402 payments | Mainnet | Paid premium data API |
| Injective MCP server + Docs MCP | Live | Build tooling and agent onboarding |
| Fee recipient on orders | Live | Agents earn fee share |

### 4.3 Network constants (verified from docs.injective.network/developers-evm/network-information)
| | Mainnet | Testnet |
|---|---|---|
| EVM chain ID | 1776 (0x6f0) | 1439 |
| Cosmos chain ID | `injective-1` | `injective-888` |
| JSON-RPC | https://sentry.evm-rpc.injective.network/ | https://k8s.testnet.json-rpc.injective.network/ |
| WebSocket | wss://sentry.evm-ws.injective.network | wss://k8s.testnet.ws.injective.network/ |
| Explorer | https://blockscout.injective.network/ | https://testnet.blockscout.injective.network/ |
| Explorer API | https://blockscout-api.injective.network/api | https://testnet.blockscout-api.injective.network/api |
| Faucet | none (buy INJ) | https://testnet.faucet.injective.network/ and https://faucet.circle.com/ |

- viem ships both: `import { injective, injectiveTestnet } from 'viem/chains'`.
- Bank precompile: `0x0000000000000000000000000000000000000064`. Exchange precompile: `0x0000000000000000000000000000000000000065`.
- **Deprecated, never use:** inEVM chain 2525, `mainnet.rpc.inevm.com`.

### 4.4 Known gotchas (from Injective EVM developer skill)
- Use legacy transactions (`type: 0`) with explicit `gasPrice` (160e6 recommended); estimate gas with `eth_estimateGas`.
- `eth_getTransactionReceipt` can return internal errors: implement retry with backoff; do not hard-fail.
- `MsgBroadcasterWithPk` fails for fresh accounts that never sent a tx. Prime fresh wallets with one EVM tx first, or use ethers/viem over EVM RPC.
- For MetaMask EIP-712 Cosmos signing use `getEip712TypedDataV2` with `SIGN_EIP712_V2`, and the fee must match exactly.

### 4.5 MUST look up and cite before use (do not guess)
- Native USDC denom and EVM address on mainnet and testnet ("USDC on Injective" docs page).
- Exchange precompile ABI (`Exchange.sol` from InjectiveLabs agent skills / solidity contracts repo) and the exact functions for batch order updates, subaccount deposits, and authz.
- Market IDs, tick sizes, min notional, min quantity for every arena market (query Indexer API `derivatives/markets` live; never hardcode without a fetch script).
- Oracle type and source for each RWA market (Pyth, Chainlink Data Streams, Stork or other) and their market-hours behavior.
- ERC-8004 identity registry address and registration flow on Injective (agents.injective.com docs, `inj-agent` CLI).
- `@injectivelabs/x402` package API and facilitator URL.
- Injective Options testnet contract/module interface and whitelist process.
- Current OLP epoch rules and eligible markets (OLP dashboard).

---

## 5. Users and Personas

| Persona | Need | What STRATA gives |
|---|---|---|
| **Injective core team / reviewers** | Proof the idea adds real liquidity | Live before/after depth and spread per market |
| **AI agent builders** (quant devs, Bittensor miners, hackathon teams) | A place to prove an agent with real money and get rewarded | Register in 3 minutes, public score, rewards |
| **Traders on Helix and other Injective frontends** | Tighter spreads on RWA markets | Better execution, nothing to install |
| **Institutions** (Gulf Labs, SMBC Nikko style) | Measurable, auditable liquidity providers; private block RFQ later | Transparent scores, attestations, R1 private RFQ |
| **Market data consumers and other agents** | Quality data on liquidity | x402 pay-per-call API, MCP server |

---

## 6. Releases and Scope

### R0: Submission Release (now until Nov 10, 2026, target live by Nov 10 06:00 IST)
**In scope (must ship):**
1. Arena contracts (Section 8) on testnet and mainnet, verified.
2. STRATA quoting engine with Oracle Guard, Session Guard, Risk Governor and kill switch (Section 9).
3. House agents: 2+ on mainnet with small team capital; 3+ on testnet.
4. Scoring service and onchain epoch attestations (Section 10).
5. Indexer + API (Section 11).
6. Web app: Landing, Arena, Agent profile, Market view, Join wizard, Docs, Transparency, Status (Section 12).
7. Demo video (HyperFrames), deck, application copy (Section 22).

**Should ship if time allows (in order):**
1. Options-writer agent on testnet (blocked only if whitelist not granted; then ship as `SIMULATED` mode with clear label).
2. AI Risk Tuner live (Section 9.7). If not ready, ship engine with static, documented parameters.
3. MCP server for agent onboarding (Section 13).
4. x402 paid endpoint for premium stats (Section 11.4).

**Out of scope for R0:** public vault, rewards payout in real tokens (show "Season 0: points" instead), private RFQ, Bittensor subnet.

### R1: Hacker House Release (Dec 1 to 10)
- Rewards distributor contract paying USDC or INJ from a funded rewards pool (with Injective team input).
- Options-writer agent on mainnet the moment Options reaches mainnet.
- Private RFQ for institutional block trades (privacy track), integrating CypherOS if available.
- Third-party agent onboarding at scale; agent SDK published to npm.
- Gulf Labs / Binance TH and SMBC Nikko demo flows.

### R2: Post-house
- Audited Strata Vault (pooled capital allocated to top agents) behind legal review and non-US gating.
- Bittensor subnet mirroring the arena.
- Liquidity-as-a-service for newly launched Injective markets.

---

## 7. System Architecture

```
                         +-------------------------------+
                         |   Web App (Next.js, Vercel)    |
                         |  Landing / Arena / Agent / ... |
                         +---------------+---------------+
                                         | REST + WebSocket
                         +---------------v---------------+
                         |   STRATA API (Fastify, Node)   |
                         |  public, x402 premium, MCP     |
                         +-------+---------------+-------+
                                 |               |
                 +---------------v--+       +----v------------------+
                 | Postgres +        |       | Scoring Service       |
                 | TimescaleDB       |<------| epoch metrics, merkle |
                 | (books, fills,    |       | root, signer (KMS)    |
                 | quotes, scores)   |       +----+------------------+
                 +---------^---------+            | attest tx
                           |                      v
                 +---------+---------+   +--------------------------+
                 | Indexer / Ingest  |   | Arena Contracts (EVM)    |
                 | Injective Indexer |   | StrataArena, Attestor,   |
                 | gRPC streams +    |   | (R1) RewardsDistributor  |
                 | Blockscout events |   +--------------------------+
                 +---------^---------+
                           | read
     +---------------------+--------------------------------------+
     |            Injective (exchange module, oracle, EVM)        |
     +---------------------^--------------------------------------+
                           | MsgBatchUpdateOrders / precompile
          +----------------+------------------+
          | Agent Runtime (house agents)       |
          | Quoting Engine + Oracle Guard +    |
          | Session Guard + Risk Governor +    |
          | AI Risk Tuner (bounded) + Kill Sw. |
          +------------------------------------+
```

### 7.1 Monorepo layout (pnpm workspaces + Turborepo)
```
strata/
  apps/
    web/                 Next.js app (frontend)
    api/                 Fastify API + WebSocket + x402 + MCP
    video/               HyperFrames demo video project
  services/
    agent/               Agent runtime (TypeScript, Node 22)
    indexer/             Ingestion workers
    scorer/              Epoch scoring + attestation
  packages/
    contracts/           Foundry project (Solidity)
    sdk/                 @strata/sdk: shared types, clients, ABIs
    config/              Network configs, market lists (generated)
    ui/                  Shared React components + design tokens
    risk/                Oracle Guard, Session Guard, Risk Governor (pure TS, heavily tested)
  infra/                 Docker, compose, Terraform (AWS), Grafana dashboards
  docs/                  Architecture, runbooks, decisions, security report
  deliverables/          Deck, video, application copy, screenshots
  scripts/               Fetch markets, fund wallets, deploy, verify
```

### 7.2 Tech stack (defaults; change only with a logged decision)
| Layer | Choice |
|---|---|
| Language | TypeScript (strict) everywhere except contracts (Solidity 0.8.x) |
| Contracts | Foundry (forge, cast, anvil), OpenZeppelin Contracts v5, Slither, Aderyn |
| Chain clients | viem (EVM), `@injectivelabs/sdk-ts` + `@injectivelabs/networks` (Cosmos exchange msgs, indexer gRPC streams) |
| Agent runtime | Node 22, pino logs, BullMQ or simple in-process scheduler, Docker |
| DB | Postgres 16 + TimescaleDB, Drizzle ORM, migrations committed |
| API | Fastify, zod validation, WebSocket (uWebSockets or ws), rate limiting |
| Frontend | Next.js (latest stable, App Router, RSC), React 19, Tailwind CSS v4, shadcn/ui (Radix) |
| Motion | Motion (motion.dev) for UI, GSAP + ScrollTrigger (free incl. plugins) for scroll narratives, Lenis smooth scroll, anime.js v4 for SVG line/number micro-animations |
| 3D | React Three Fiber + drei + postprocessing, glTF/GLB assets from Blender (Draco + KTX2 compressed), optional Rive for interactive vector states |
| Charts | TradingView Lightweight Charts (price, depth over time), visx or custom SVG (depth ladder, score radar) |
| Wallets | wagmi + viem (MetaMask, Rabby, WalletConnect) for EVM; Keplr/Leap via Injective wallet strategy for Cosmos signing in Join flow |
| Video | HyperFrames (HeyGen, open source HTML-to-video) |
| Hosting | Vercel (web), AWS (API, agents, scorer, DB) using the AWS credits; fallback Fly.io or Railway |
| Observability | Sentry (errors), Grafana + Prometheus (metrics), Better Stack or UptimeRobot (status), Telegram bot alerts |
| Secrets | AWS KMS / Secrets Manager for signer keys; never in repo, never in frontend |
| CI | GitHub Actions: lint, typecheck, unit, forge test, slither, build, preview deploy |

---

## 8. Smart Contracts (packages/contracts)

Keep contracts **small, non-custodial and immutable** in R0. They hold no user funds.

### 8.1 `StrataArena.sol`
Purpose: season registry, agent enrollment, market whitelist, and the public anchor for scores.

**State**
- `address public owner` (Ownable2Step), `address public attestor`
- `uint64 public currentSeason`
- `mapping(uint64 => Season)`: `{ uint64 startTime; uint64 endTime; uint32 epochSeconds; bool active; }`
- `mapping(bytes32 => MarketCfg)`: Injective market ID (bytes32) to `{ bool enabled; uint16 maxSpreadBps; uint32 minDepthUsd; string symbol; }`
- `mapping(uint256 => Agent)`: arena agent ID to `{ address operator; uint256 erc8004Id; bytes32 subaccountId; string metadataURI; uint64 enrolledAt; Status status; }`
- `mapping(address => uint256) public agentIdOf`

**Functions**
- `enroll(uint256 erc8004Id, bytes32 subaccountId, string metadataURI) returns (uint256 agentId)`: caller must be the ERC-8004 identity owner (verify via registry `ownerOf` if the registry is ERC-721 compatible; confirm interface first). One agent per operator per season unless owner raises the cap.
- `updateMetadata(uint256 agentId, string uri)` (operator only)
- `withdrawAgent(uint256 agentId)` (operator only)
- `setMarket(bytes32 marketId, MarketCfg cfg)` (owner)
- `startSeason(...)`, `endSeason(...)` (owner)
- `suspendAgent(uint256 agentId, string reason)` (owner, for proven wash trading; emits reason)
- `setAttestor(address)` (owner, with event)

**Events**: `AgentEnrolled`, `AgentUpdated`, `AgentWithdrawn`, `AgentSuspended`, `MarketSet`, `SeasonStarted`, `SeasonEnded`, `AttestorChanged`.

### 8.2 `ScoreAttestor.sol`
Purpose: anchor each epoch's scores onchain cheaply and verifiably.
- `postEpoch(uint64 season, uint64 epoch, bytes32 merkleRoot, string dataURI)`: attestor only. Stores root; `dataURI` points to the full JSON (IPFS via web3.storage/Pinata, plus API mirror).
- `verifyScore(uint64 season, uint64 epoch, uint256 agentId, uint256 score, bytes32[] proof) view returns (bool)`.
- Reject epochs out of order or duplicated. Event `EpochPosted(season, epoch, root, uri)`.
- Leaf format: `keccak256(abi.encode(season, epoch, agentId, score, spreadBps, depthUsd, uptimeBps, pnlUsd, flags))`. Document it in `docs/SCORING.md`. Use OpenZeppelin `MerkleProof`.

### 8.3 `RewardsDistributor.sol` (R1, write now, deploy testnet only in R0)
- Merkle-claim of points-to-token rewards per season from a funded pool. Pull-based claims, `ReentrancyGuard`, SafeERC20, per-season claim bitmap, owner can fund and sweep only after a 30-day claim window. Deploy testnet only in R0.

### 8.4 Contract quality bar
- Foundry unit tests for every function, revert paths, events. Fuzz tests on merkle verification and enrollment. Invariant tests: epochs strictly increasing, no duplicate enrollment, only attestor can post.
- 100% line coverage on contracts (report in CI).
- Slither and Aderyn: zero high/medium. Document any accepted low findings.
- NatSpec on every external function.
- Deploy scripts in `script/` with `--broadcast` for testnet then mainnet; verify on Blockscout (Hardhat or forge verify with Blockscout API).
- Owner is a hardware-wallet or Safe multisig address provided by owner (Section 23). Never a hot key on a server.
- No upgradeability in R0 (simpler, safer). Version contracts by redeploying and pointing config to new addresses.

---

## 9. Agent Runtime (services/agent)

### 9.1 Responsibilities
Run one process per agent. Each agent maintains two-sided quotes on its assigned markets, manages inventory, and obeys risk limits. House agents are reference implementations; third-party agents can use the same open-source code.

### 9.2 Main loop (per market)
1. Subscribe to Injective Chain Stream / Indexer streams: orderbook L2, trades, positions, oracle prices, funding.
2. Compute fair value: oracle mark price adjusted by order book microprice when book is healthy.
3. Run Guards (9.4, 9.5). If any guard says HALT, cancel all orders for that market and stop quoting.
4. Compute quotes with the Quoting Engine (9.3).
5. Diff desired vs live orders. Send one `MsgBatchUpdateOrders` (cancel + create in one tx) per cycle per subaccount, or the exchange precompile equivalent. Set `feeRecipient` to the agent's address.
6. Record every quote, cancel, fill and state change to the DB via the ingest API (or direct write) with monotonic timestamps.
7. Cycle time target: 1 to 3 seconds, adaptive to volatility, respecting rate limits and gas budget.

### 9.3 Quoting Engine (deterministic)
- Base model: Avellaneda-Stoikov style reservation price with inventory skew:
  - `reservation = fair - q * gamma * sigma^2 * T`
  - `halfSpread = max(minHalfSpreadBps, (gamma * sigma^2 * T)/2 + (1/gamma) * ln(1 + gamma/kappa))`
  - `sigma` from EWMA of mid returns (configurable half-life), `kappa` from observed fill intensity.
- Ladder: N levels per side (default 3), size increasing with distance, all snapped to tick size and min quantity.
- Inventory target 0; hard inventory cap per market in USD; skew grows nonlinearly near cap.
- Never cross the book. Never quote inside 1 tick of own opposite order. Post-only where supported.
- All parameters live in a typed config with min/max bounds. The engine clamps any value outside bounds and logs it.

### 9.4 Oracle Guard (mandatory, lesson from Ostium)
HALT the market if any check fails:
- Oracle timestamp older than `maxOracleAgeSec` (default 30s during market hours) or **newer than chain time + 2s** (future-dated report).
- Oracle price deviates from book mid by more than `maxOracleBookDevBps` (default 150 bps) for more than 3 consecutive cycles.
- Two independent sources (oracle vs external reference, for example Pyth Hermes vs a second provider) disagree beyond `maxSourceDevBps`.
- Price jump greater than `maxJumpBps` in one cycle without matching book movement.
Every HALT emits a structured event shown on the Transparency page.

### 9.5 Session Guard (mandatory, lesson from weekend gaps)
- Maintain a market-hours calendar per asset class (US equities incl. holidays and early closes, FX weekly session, commodities sessions, crypto 24/7). Source: exchange calendars library (for example `exchange_calendars` data exported to JSON) plus oracle provider market-hours docs (Chainlink Data Streams market hours, Pyth).
- 30 minutes before underlying close: spreads x2, size x0.5. 5 minutes before close: flatten inventory to 0.
- While underlying is closed: quote only if `offHoursQuoting=true` for that market, at wide spreads (default 4x), tiny size, inventory cap 10%.
- After reopen: wait `reopenCooldownSec` (default 120s) until oracle and book stabilize, then ramp size over 10 minutes.

### 9.6 Risk Governor (mandatory)
- Per agent: max gross notional, max net notional per market, max daily loss (stop for the day), max drawdown from peak (stop for the season pending human review), max order rate.
- Margin health: keep margin ratio above `minMarginRatio`; auto-reduce positions if breached.
- **Kill switch:** (a) Telegram command `/kill <agent|all>` from whitelisted owner chat IDs, (b) API admin endpoint protected by signed message from owner wallet, (c) env flag. Kill cancels all orders and optionally closes positions with reduce-only IOC orders.
- Funding awareness: skew quotes against paying high funding.
- All limits are config, version-controlled, and printed on the Transparency page.

### 9.7 AI Risk Tuner (bounded AI, never trades)
- Every 5 to 15 minutes, gather a compact state snapshot: realized vol, fill rates, markouts (1s, 10s, 60s), inventory, session state, recent guard events, funding.
- Call an LLM (Claude via Anthropic API, model from env) with a strict JSON schema prompt that returns **only parameter adjustments** (gamma, minHalfSpreadBps, levels, size multiplier, offHoursQuoting) plus a one-sentence rationale.
- Validate with zod. Clamp to bounds. Max change per step: 20% per parameter. Reject and log any invalid output.
- Shadow mode first: log suggestions without applying for the first N hours; compare against static params. Enable live tuning only after shadow results are non-negative (document in `docs/AI_TUNER.md`).
- Show the rationale feed publicly on the Agent page ("Why the agent changed its spread"). This is the explainable-AI hook for the demo.
- No user data or secrets ever go into prompts.

### 9.8 Options-Writer Agent (testnet)
- Goal: demonstrate liquidity provision on Injective Options (SICI, US500, US Tech, Gold, Silver, Oil).
- Strategy: fully collateralized covered calls and cash-secured puts at deltas 0.15 to 0.30, short-dated expiries, premium floor based on implied vs realized vol; never naked.
- Steps: (1) find the Options testnet interface in official docs or ask Injective via the whitelist process, (2) if write access is granted, run live on testnet, (3) if not granted by R0 deadline, run against a local simulator that mirrors the documented payoff and label everything `SIMULATED`.
- Owner must apply for whitelist access (Section 23).

### 9.9 House agents for R0 (defaults, owner may override)
| Agent | Network | Markets (verify IDs live) | Capital |
|---|---|---|---|
| `strata-atlas` | Mainnet | SICI/USDC perp, XAU (gold)/USDC perp | Owner sets (default $500) |
| `strata-meridian` | Mainnet | EUR/USDC perp, US tech index perp | Owner sets (default $500) |
| `strata-test-1..3` | Testnet | 5 to 8 RWA perps incl. SICI | Testnet funds |
| `strata-options` | Testnet | Options markets | Testnet funds |

Pick markets by: (1) currently wide spreads or thin depth (measure first, Section 10.4 baseline), (2) oracle quality, (3) story value (SICI and gold for the AI and RWA narrative).

---

## 10. Scoring (services/scorer)

### 10.1 Epochs
- Epoch length: 1 hour (config). Season 0 runs from launch until Dec 10, 2026.
- At each epoch end: compute metrics per agent per market from DB, compute score, build merkle tree, upload JSON to IPFS and API, call `postEpoch` on mainnet (mainnet agents) and testnet (testnet agents).

### 10.2 Metrics (sampled every 5 seconds from the live book and agent orders)
| Metric | Definition |
|---|---|
| `quotedSpreadBps` | Time-weighted (agent best ask - agent best bid) / mid in bps, only when both sides are live |
| `depthUsd@25bps` | Time-weighted USD notional of agent orders within 25 bps of mid (both sides) |
| `uptimeBps` | Share of samples where agent has two-sided quotes within `maxSpreadBps` (10000 = 100%) |
| `bookShare` | Agent depth within 25 bps divided by total book depth within 25 bps |
| `markout60s` | Average PnL of fills marked to mid 60s later (adverse selection measure) |
| `pnlUsd` | Realized + unrealized PnL incl. fees and funding |
| `maxDrawdown` | Peak-to-trough equity drop in the season |
| `spreadImprovementBps` | Market spread with agent present vs baseline (10.4) |

### 10.3 Score formula (document and show publicly)
```
liquidity = 0.35 * norm(depthUsd@25bps) + 0.25 * norm(uptimeBps) + 0.20 * norm(1/quotedSpreadBps) + 0.20 * norm(bookShare)
quality   = clamp(0.5 + norm(markout60s) - penalty(maxDrawdown), 0, 1)
score     = round(10000 * liquidity * (0.7 + 0.3 * quality))
```
`norm` = min-max over active agents in the epoch, with floors to prevent division by zero. Disqualify the epoch if any `flags` set (10.5).

### 10.4 Baseline measurement (start immediately, before agents go live)
Record each candidate market's spread and depth for at least 12 hours before STRATA agents quote. This baseline powers the "before vs after" story on Market pages. Label baseline windows clearly.

### 10.5 Anti-gaming
- Self-trade and wash detection: fills between subaccounts linked to the same operator or funded from the same source within N hops flagged `WASH`.
- Quote stuffing: order rate above threshold flagged `SPAM`.
- Flicker quotes: orders alive under 1 second excluded from depth.
- Only orders posted to the book count; fills against own orders excluded.
- Suspended agents shown with reason on Transparency page.

---

## 11. Data, Indexer and API (services/indexer, apps/api)

### 11.1 Ingestion
- Injective Indexer gRPC streams (via `@injectivelabs/sdk-ts` IndexerGrpc* clients and Chain Stream): orderbook updates, trades, positions, oracle prices for arena markets.
- Blockscout API/websocket for arena contract events.
- Write to Timescale hypertables: `book_snapshots`, `trades`, `agent_orders`, `agent_fills`, `oracle_prices`, `guard_events`, `tuner_events`, `scores`, `epochs`.
- Backfill job for baseline and restarts. Idempotent upserts keyed by tx hash + event index.

### 11.2 Public REST API (`/v1`)
- `GET /markets`, `GET /markets/:id` (spread, depth, baseline vs now)
- `GET /agents`, `GET /agents/:id` (profile, live quotes, metrics, scores, guard events, tuner feed)
- `GET /leaderboard?season=&network=`
- `GET /epochs/:season/:epoch` (full scoring JSON + merkle proof per agent)
- `GET /status` (service health, last block seen, lag)
- OpenAPI spec generated from zod schemas, served at `/docs`.

### 11.3 WebSocket
- `ws /v1/stream`: channels `book:<marketId>`, `agent:<agentId>`, `leaderboard`, `events`. Throttle to 4 updates/sec per channel for clients.

### 11.4 x402 premium endpoint (should-ship)
- `GET /v1/premium/liquidity-feed`: per-market, per-second liquidity metrics. Price: tiny USDC amount per call via x402 on Injective EVM using `@injectivelabs/x402` (verify API). Demonstrates agent-to-agent paid data.

### 11.5 Rate limiting and abuse
- Per-IP limits, API keys optional for higher tiers, CORS restricted to app domain for browser routes.

---

## 12. Web App (apps/web): World-Class UI and UX

### 12.1 Design direction
**Concept: "Liquidity as terrain."** STRATA means layers. The visual system shows the order book as geological layers of light: bids and asks as stacked translucent strata that thicken when agents add depth. Calm, precise, premium, like a top Swiss trading terminal meets an Awwwards-winning site.

- **Mode:** dark-first, with a real light mode (not an afterthought).
- **Palette:** deep ink background (`#07080B` range), cool neutral grays, one signature accent (electric aqua-teal) for liquidity, bids in a soft green, asks in a coral, warnings amber, halts red. Check all text contrast WCAG AA (4.5:1 body, 3:1 large).
- **Type:** a precise grotesk for UI (for example Inter Display or Geist), a characterful display face for hero headlines (for example a variable serif or wide grotesk, licensed or free), and a monospace for numbers (Geist Mono or JetBrains Mono) with tabular figures everywhere numbers update.
- **Grid:** 12-column, 8px spacing scale, generous whitespace on marketing pages, dense but calm on data pages.
- **Load the `frontend-design` skill** and follow it. Avoid generic templated looks: no default shadcn look left unstyled, no stock gradients, no emoji icons.

### 12.2 Motion system
- Principles: motion explains data, never decorates for its own sake. 150 to 300ms UI transitions, spring physics for interactive elements, scroll-driven storytelling only on the Landing page.
- Libraries: Motion for components and layout animations; GSAP ScrollTrigger + Lenis for Landing scroll narrative; anime.js v4 for SVG path drawing and number counters.
- Live numbers tick with a subtle roll animation (tabular digits, no layout shift).
- Respect `prefers-reduced-motion`: replace scroll scenes with static frames and fades.

### 12.3 3D (Blender + React Three Fiber)
- **Hero scene:** a slowly rotating "liquidity strata" object: stacked translucent layers whose thickness is driven by LIVE aggregate depth from the API. It is real data, not decoration. Subtle bloom and depth of field.
- Build in Blender (owner has Blender on their Mac). Options: model procedurally in R3F, or author in Blender and export glTF 2.0 (`.glb`), Draco geometry + KTX2 textures, under 1.5 MB total.
- Blender automation: if the BlenderMCP server is available on the owner's Mac, use it to drive Blender from Claude; otherwise write Blender Python scripts in `infra/blender/` that the owner can run with `blender -b -P script.py`.
- Performance: lazy-load 3D after first paint, cap DPR at 1.75, pause rendering when off-screen or tab hidden, static poster image fallback for low-end devices and reduced motion.

### 12.4 Information architecture and pages
1. **Landing (`/`)**
   - Hero: 3D strata + headline + live stat strip (agents live, markets covered, current depth added, spread improvement) + two CTAs: "Watch the Arena" and "Enroll an agent".
   - Scroll story (5 scenes): The problem (thin books) → The arena (agents compete) → The guards (oracle, session, risk) → Proof (before vs after chart from real data) → Join.
   - Partner and ecosystem strip (Injective, plus "built for" mentions only where accurate; never imply partnerships that do not exist).
   - Footer: docs, GitHub, contracts on Blockscout, status, terms, risk disclosure.
2. **Arena (`/arena`)**: live leaderboard (rank, agent, score, spread, depth, uptime, PnL, status), season timer, network toggle (Mainnet / Testnet), filters by market. Rows animate on rank change.
3. **Agent (`/agents/[id]`)**: identity (ERC-8004 link), live quotes visual, metrics with sparklines, score history, guard event timeline, AI Tuner rationale feed, verify-my-score button (merkle proof check against contract in the browser via viem).
4. **Market (`/markets/[id]`)**: depth ladder, spread over time with baseline band, STRATA share of book, oracle status, session state (open, closing, closed, reopening).
5. **Join (`/join`)**: 4-step wizard: connect wallet → link or create ERC-8004 identity → choose markets + read rules → enroll (tx) and get agent starter kit (download config, docker command, SDK link). Clear risk disclosure checkbox. Testnet default; mainnet behind an explicit toggle.
6. **Docs (`/docs`)**: MDX docs: how it works, scoring formula, guards, run your own agent, API and MCP reference, contracts.
7. **Transparency (`/transparency`)**: all risk limits, house agent capital, guard halts log, suspensions, contract addresses, epoch attestations, security report link.
8. **Status (`/status`)**: service health, data lag, last epoch posted.

### 12.5 UX requirements
- Time to understand: a first-time visitor understands what STRATA does within 5 seconds of the hero.
- Every number has a tooltip explaining definition and source.
- Empty, loading and error states designed for every component (skeletons that match final layout).
- Network label (`MAINNET` / `TESTNET`) visible on every data view. `SIMULATED` and `BACKTEST` badges where relevant.
- Keyboard navigable, visible focus rings, screen-reader labels for charts (summary text).
- Mobile: full responsive. Leaderboard becomes cards. 3D falls back to poster under 768px if FPS < 45.
- i18n-ready strings (English now; Thai and Japanese later for Gulf Labs and SMBC Nikko demos).

### 12.6 Performance budgets
- LCP < 2.0s on 4G mid-tier mobile, CLS < 0.05, INP < 200ms.
- JS on Landing first load < 180 KB gzipped excluding lazy 3D chunk.
- Images AVIF/WebP, fonts subset + `font-display: swap`, preload hero font.

### 12.7 SEO and sharing
- Metadata, Open Graph images generated per agent and market (Next.js OG image route) showing live score.
- `robots.txt`, sitemap, structured data for the organization.

### 12.8 Wallet UX
- wagmi connect modal styled to brand. Clear chain switch prompts to 1776 / 1439. Human-readable tx previews before every signature. Never request signatures on page load.

### 12.9 Copy rules
- Short, specific, confident. No hype words ("revolutionary", "game-changing", "seamless", "unleash", "supercharge", "empower").
- No em dashes. No emoji in UI.
- Example hero: "Injective has the markets. STRATA brings the liquidity." Sub: "AI market makers compete in the open, get scored onchain, and earn for every basis point of spread they remove."

### 12.10 UI research step (do once, 30 minutes max, then build)
Look at current best-in-class references (Awwwards Sites of the Day in fintech and Web3, Linear, Vercel, Hyperliquid, Stripe Sessions sites) and record 5 concrete patterns to adopt in `docs/DESIGN.md`. Do not copy any site's assets, logos or copy.

---

## 13. MCP Server (apps/api/mcp, should-ship)
Expose STRATA to any AI agent (Claude, Cursor, LangChain):
- Tools: `strata_get_leaderboard`, `strata_get_market_liquidity`, `strata_get_agent`, `strata_get_rules`, `strata_prepare_enrollment` (returns unsigned tx data only; never signs, never holds keys).
- Resources: scoring docs, risk rules.
- Document install snippet on `/docs/mcp`.

---

## 14. Demo Video (apps/video, HyperFrames)
- Install HyperFrames skills (`npx skills add heygen-com/hyperframes` or the method in hyperframes.heygen.com/quickstart) and build the video as an HTML project.
- Length 60 to 90 seconds, 1080p, captions burned in, calm music (royalty-free, license noted).
- Storyboard:
  1. 0 to 8s: "Injective has 135 real-world markets." Visual: market grid.
  2. 8 to 18s: "Most of them have thin books." Visual: thin depth chart.
  3. 18 to 35s: STRATA arena: agents enroll, quote, get scored.
  4. 35 to 50s: Guards: oracle anomaly triggers halt, weekend flatten.
  5. 50 to 70s: Real before vs after spread and depth on mainnet.
  6. 70 to 85s: "Open to any agent. Verified onchain." CTA + URL.
- Use real screen captures from the live app plus HyperFrames motion graphics. Export MP4 to `deliverables/strata-demo.mp4` and a 15s vertical cut for X.

---

## 15. Infrastructure and DevOps

### 15.1 Environments
| Env | Chain | Web URL | Purpose |
|---|---|---|---|
| local | anvil fork + Injective testnet | localhost | dev |
| testnet | 1439 / injective-888 | testnet.<domain> | full features incl. options |
| mainnet | 1776 / injective-1 | <domain> | limited beta |

Network switching is a single config object in `packages/config` (generated by `scripts/fetch-markets.ts`).

### 15.2 Deployment
- Web: Vercel, preview deploys per PR.
- API, agents, scorer, indexer: Docker images on AWS (ECS Fargate or a single EC2 with docker compose for R0 speed), Postgres on RDS or Timescale Cloud.
- One agent per container, restart policy `always`, health checks, graceful shutdown that cancels all orders on SIGTERM.

### 15.3 Monitoring and alerts
- Prometheus metrics: cycle latency, tx success rate, guard halts, inventory, PnL, margin ratio, data lag.
- Grafana dashboards committed in `infra/grafana/`.
- Telegram alerts to owner: agent HALT, daily loss limit hit, tx failure spike, epoch post failure, data lag > 60s.
- Sentry for web and API errors (PII scrubbing on).

---

## 16. Security and Privacy (hard gate)

### 16.1 Key management
- Agent trading keys: one fresh key per house agent, funded only with its capital limit. Stored in AWS Secrets Manager / KMS. Loaded at runtime. Never logged.
- Prefer Injective **authz / scoped trading permissions**: agent hot key can only trade the specified subaccount and markets, not withdraw. Verify supported grant types in docs and use them if available.
- Contract owner: owner's hardware wallet or Safe. Attestor key: separate, KMS-managed, can only post epochs.
- `.env.example` only in repo. Pre-commit hook with gitleaks. CI secret scanning.

### 16.2 Application security
- Dependency audit in CI (`pnpm audit`, Socket or Snyk free tier). Lockfile committed.
- API: input validation (zod), rate limits, no SQL string building (Drizzle), security headers (CSP, HSTS, X-Frame-Options), CORS allow-list.
- Admin endpoints require signed message from owner address with nonce and expiry.
- Frontend: no secrets, strict CSP, no third-party scripts except those listed in `docs/THIRD_PARTY.md`.

### 16.3 Privacy
- No user accounts, no emails collected in R0. Wallet addresses are public chain data; do not link them to any off-chain identity.
- Analytics: privacy-friendly only (Plausible or Vercel Analytics without cookies). No fingerprinting. Cookie banner not required if no cookies; verify.
- Logs: no IPs stored beyond rate-limiting windows; Sentry PII scrubbing.
- LLM prompts contain market data only, never keys, addresses of third parties, or personal data.

### 16.4 Trading safety
- Mainnet capital capped by owner's number (Section 23). Hard-coded upper bound in config that requires a code change and review to raise.
- Kill switch tested on testnet before mainnet (record a video clip of it working).
- Reduce-only close path tested.

### 16.5 Legal and disclosure
- Terms of use + risk disclosure pages: experimental software, no investment advice, no pooled funds, not for US persons or sanctioned jurisdictions. Geo-notice on Join page.
- Never claim official partnership with any company unless confirmed in writing by owner.

### 16.6 Security review deliverable
- `docs/SECURITY.md`: threat model (STRIDE), Slither/Aderyn outputs, test coverage, key management description, known limitations. A dedicated security-review subagent that did not write the code performs the review.

---

## 17. Testing and QA

| Layer | Required tests |
|---|---|
| Contracts | Unit, fuzz, invariant; 100% line coverage; gas snapshot |
| Risk package | Unit tests for every guard with fixtures: stale oracle, future timestamp, deviation, jump, market close, reopen gap, margin breach. Property-based tests (fast-check). 95%+ coverage |
| Quoting engine | Deterministic tests: ladders snap to tick, never cross, inventory skew direction, clamps |
| Agent integration | Testnet run for at least 6 hours with no unhandled errors before mainnet |
| Scorer | Golden-file tests: given fixture data, exact expected scores and merkle root |
| API | Contract tests against OpenAPI, load test 200 concurrent WS clients |
| Web | Playwright E2E for every page and the Join wizard on testnet; visual regression snapshots; Lighthouse CI budgets; axe accessibility checks |
| Chaos | Kill RPC mid-cycle, kill DB, restart agent: agent must cancel or hold safely, never duplicate orders |

---

## 18. Analytics and KPIs (shown on site where meaningful)
- Depth added within 25 bps (USD) per market, spread improvement (bps) vs baseline, uptime, number of agents enrolled, epochs attested, guard halts (count and reasons).

---

## 19. Shared Interfaces (define FIRST, in packages/sdk)

Before parallel work starts, the orchestrator writes and commits:
1. `packages/sdk/src/types.ts`: `Market`, `AgentProfile`, `Quote`, `Fill`, `GuardEvent`, `TunerEvent`, `EpochScore`, `LeaderboardRow`, `NetworkName`.
2. `packages/sdk/src/api.ts`: zod schemas for every REST response and WS message.
3. `packages/contracts` interfaces (`IStrataArena.sol`, `IScoreAttestor.sol`) + generated TypeScript ABIs (wagmi CLI).
4. `packages/config`: network config shape and generated market list.
5. DB schema (Drizzle) and migration 0001.
6. Mock data generators that match schemas exactly (for frontend work before real data, always labeled `MOCK` in dev and never shipped to production views).

---

## 20. Parallel Workstreams

Spawn these subagents in parallel after Section 19 is committed. Each owns its folder, writes its own tests, and reports status to `docs/STATUS.md`.

| ID | Workstream | Owns | Depends on | Model |
|---|---|---|---|---|
| W1 | Contracts | packages/contracts, deploy + verify scripts | 19 | Strongest |
| W2 | Risk + Quoting engine | packages/risk, services/agent core | 19 | Strongest |
| W3 | Injective integration | order placement, streams, authz, market fetch script, options interface research | 19 | Strongest |
| W4 | Indexer + DB + baseline recorder | services/indexer, DB | 19 | Best available |
| W5 | Scorer + attestations | services/scorer | 19, W1 ABIs | Strongest |
| W6 | API + WS + x402 + MCP | apps/api | 19 | Best available |
| W7 | Frontend app (data pages) | apps/web data pages, ui package | 19 (mocks) | Best available |
| W8 | Landing + 3D + motion | apps/web landing, 3D assets, Blender scripts | 19 (mocks) | Best available |
| W9 | DevOps + observability + security tooling | infra, CI, alerts | none | Best available |
| W10 | Docs, video, deck, application copy | docs, apps/video, deliverables | W7/W8 screenshots at end | Best available |
| W11 | Independent security + QA review | review only, files issues | runs continuously, final gate | Strongest |

**Rules:** streams never edit another stream's folder without a note in `docs/STATUS.md`. The orchestrator merges, resolves conflicts, and runs the integration test suite after each merge.

---

## 21. Skills and Tools to Load

Install and load before relevant work (verify each source before installing; skip anything that looks untrusted):
- `npx skills add InjectiveLabs/agent-skills` (Injective EVM developer, MCP servers, trading skills, CLI).
- Injective Docs MCP server (see docs.injective.network/developers-ai/documentation-mcp) for live doc lookups.
- Injective MCP server (docs.injective.network/developers-ai/mcp) for testnet interactions during development.
- `frontend-design` skill for all UI work.
- HyperFrames skills (hyperframes.heygen.com quickstart) for the video.
- BlenderMCP (if owner confirms it is installed) for 3D asset work.
- Playwright MCP or built-in browser for E2E and visual QA.
- Any additional skill relevant to a task (testing strategy, code review, security review, documentation). Load and follow them.

---

## 22. Deliverables Checklist (final report must link each)
- [ ] Mainnet web app URL
- [ ] Testnet web app URL
- [ ] Contract addresses (mainnet + testnet) with Blockscout verified links
- [ ] House agent addresses and subaccount links on both networks
- [ ] At least one mainnet epoch attestation tx link
- [ ] GitHub repo URL with README, architecture diagram, `docs/`
- [ ] `docs/SECURITY.md` review report
- [ ] `deliverables/strata-demo.mp4` (and 15s vertical cut)
- [ ] `deliverables/STRATA-deck.pdf` (10 slides: problem, insight, product, guards, live proof, architecture, traction so far, roadmap R1/R2, team, ask)
- [ ] `deliverables/APPLICATION.md` (updated form answers with real links and numbers)
- [ ] Screenshots of every page (desktop + mobile) in `deliverables/screens/`

### 22.1 Application copy template (fill with real values before submitting)
- **Project name:** STRATA
- **Description (max 250 chars):** STRATA is an open arena where AI market-making agents add liquidity to Injective's RWA perps and options. Agents trade their own capital, get scored onchain on spread, depth and uptime, and earn for the liquidity they add.
  (Verify length is 250 characters or fewer before submitting.)
- **Category:** AI & agents
- **Stage:** Mainnet (only if Section 1.3 S1, S2, S5 are live; otherwise Testnet)
- **What have you shipped:** Mainnet beta live: arena and score attestation contracts on Injective EVM (links), [N] STRATA agents quoting [markets] with oracle, session and risk guards, hourly onchain score attestations, live leaderboard at [URL]. Options writer agent on testnet. Earlier: Aarambh Labs products Supermission (AI DeFi trading terminal, about $100K in grants), Monsmith (Monad IDE), Proofly (KYC, incubated at IFIH GIFT City); clients incl. DP World and WASL Group.
- **What will you build in the 10 days:** Rewards distributor and Season 1 incentives with the Injective team; options writer agent to mainnet as soon as Options launches; private RFQ for institutional block trades (privacy track); public agent SDK and MCP onboarding for third-party agents; demo flows with Gulf Labs and SMBC Nikko.
- **Help needed (max 3):** Injective Integration, Tokenomics & DeFi Design, Ecosystem Partnerships

---

## 23. Questions to Ask the Owner (ONE message, at the very start)

### 23.1 Ask all of these together, numbered, with the default shown so the owner can reply "default" quickly:
1. **Product name:** keep "STRATA"? (default: yes; you will check domain and trademark conflicts and propose 2 alternates if conflicted)
2. **Domain:** which domain should the app use, and do you have DNS access? (default: buy `strata-arena.xyz` or similar after you approve)
3. **GitHub:** repo owner/org and repo name; public or private until submission? (default: `aarambhlabs/strata`, public at submission)
4. **Hosting accounts:** Vercel team, AWS account (credits?), Postgres choice. (default: Vercel + AWS; Fly.io fallback)
5. **Mainnet capital:** total USDC and INJ you will fund for house agents, and max daily loss you accept. (default: $1,000 total, $50 max daily loss, $150 max season drawdown)
6. **Mainnet wallets:** you will create and fund the agent wallets yourself, then place private keys into the secrets manager (never paste keys into chat). Confirm. Also: contract owner address (hardware wallet or Safe).
7. **Testnet:** may agents create and fund testnet wallets from faucets automatically? (default: yes)
8. **Options whitelist:** have you applied for Injective Options testnet writer access? If not, may we draft the request for you to send? (default: draft it)
9. **LLM API key** for the AI Risk Tuner (Anthropic). (default: tuner in shadow mode if no key)
10. **Telegram:** chat ID(s) for alerts and kill switch. (default: create a bot and send you setup steps)
11. **Blender:** is Blender installed and is BlenderMCP set up on your Mac? (default: use Blender Python scripts you can run)
12. **Brand:** any existing brand colors, fonts or logo to use? (default: create STRATA identity per Section 12)
13. **Team mentions:** names, roles and links to show on the site and deck. (default: Aarambh Labs only)
14. **Legal:** OK to state "not available to US persons" and ship the default terms and risk disclosure? (default: yes)

### 23.2 After the answers
Write them to `docs/DECISIONS.md` and proceed without further questions. If an answer is missing, use the default.

### 23.3 The only allowed stop points (pause and ask)
- Before the first **mainnet** contract deployment (show the deploy plan and gas estimate).
- Before the first **mainnet** order from a house agent (show limits and kill-switch test proof).
- Before buying a domain or anything that costs money.
- If a security reviewer finds a critical issue.
Each pause message must be short, contain exactly what is needed, and offer a default.

---

## 24. Timeline for R0 (from start, hours)

| Hours | Milestone |
|---|---|
| 0 to 1 | Questions sent; scaffold monorepo; Section 19 interfaces committed; baseline recorder started on candidate markets |
| 1 to 8 | W1 contracts + tests on testnet; W2/W3 engine on testnet with guards; W4 DB + ingest; W7/W8 UI on mocks; W9 CI + infra |
| 8 to 14 | Testnet agents live; scorer posting testnet epochs; API serving real testnet data; UI wired to API |
| 14 to 20 | 6-hour testnet soak; security review; kill-switch test; landing 3D + motion polish |
| 20 to 24 | **Pause:** mainnet deploy approval → contracts on mainnet, verified |
| 24 to 28 | **Pause:** first mainnet order approval → mainnet agents live with small size; first mainnet epoch posted |
| 28 to 32 | Video, deck, screenshots, application copy with real links; Lighthouse and E2E pass |
| 32 | Final report to owner; owner submits the form before the deadline |

If behind schedule, cut in this order: x402 endpoint, MCP server, AI Tuner live mode (keep shadow), options live (keep simulated), 3D hero (keep 2D animated strata). Never cut: guards, security review, honest labeling, mainnet contracts and agents.

---

## 25. Decision Log
Maintain `docs/DECISIONS.md`: date, decision, options considered, reason, owner approval (if any).

## 26. Risks and Mitigations
| Risk | Mitigation |
|---|---|
| Options access not granted | Simulated mode, clearly labeled; mainnet perps carry the demo |
| Agents lose money | Small capital, strict limits, spread-capture strategy, guards; Transparency page shows PnL honestly |
| Oracle or market-hours surprises | Oracle Guard and Session Guard; testnet soak covering a market close |
| RPC instability | Multiple RPC endpoints with failover; retries with backoff; safe cancel-on-uncertainty |
| Name conflict | Check before launch; alternates ready |
| Deadline slip | Cut list in Section 24 |
| Reviewer sees "just a bot" | Lead with open arena, onchain scoring, guards and measured liquidity improvement |

## 27. References
- Injective EVM network info: https://docs.injective.network/developers-evm/network-information
- Injective AI developer docs (MCP, skills): https://docs.injective.network/developers-ai
- Injective agents platform: https://agents.injective.com
- x402 on Injective: https://injective.com/blog/x402
- Injective Options testnet coverage: https://blockchain.news/news/injective-launches-onchain-options-for-indices-and-commodities
- SICI launch: https://grafa.com/en/news/crypto/injective-launches-onchain-index-tracking-ai-compute-prices
- Liquidity Availability paper: https://injective.com/Liquidity_Availability.pdf
- Open Liquidity Program: https://docs.injective.network/defi/open-liquidity-program/introduction
- Ostium exploit (oracle lesson): https://www.coindesk.com/business/2026/07/15/ostium-suffers-usd18-million-exploit-as-oracle-attack-wave-continues-to-hit-defi
- HLP JELLY incident (vault lesson): https://www.theblock.co/post/348314/hyperliquid-delists-jellyjelly-memecoin-amid-whale-manipulation-fiasco
- Session-aware oracles (market hours lesson): https://www.seda.xyz/blog/session-aware-oracles-24-7-markets
- AI trading bot results: https://www.business-standard.com/markets/news/ai-bots-auditioning-for-wall-street-trading-are-mostly-losing-money-126050701793_1.html
- HyperFrames: https://hyperframes.heygen.com
