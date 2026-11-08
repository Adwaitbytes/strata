# Workstream Status

Each stream appends dated entries under its heading: what is done (with evidence), what is blocked, and any cross-folder notes.

## Orchestrator
- 2026-11-08: Monorepo scaffolded. Section 19 interfaces committed: `packages/sdk` (types, api, merkle, mocks, abis), `packages/config`, `packages/db` (schema + 0001), contract interfaces.

## W1 Contracts
## W2 Risk + Quoting engine
## W3 Injective integration
- 2026-11-09: CROSS-FOLDER NOTE for W2: W3 added deps to `services/agent/package.json` (`@injectivelabs/sdk-ts`, `@injectivelabs/networks`, `@injectivelabs/utils`, `@injectivelabs/core-proto-ts-v2`, `@strata/keys`) and `inj:*` + `fetch-markets` scripts. Please merge rather than overwrite this file. W3 code lives only in `services/agent/src/injective/**`.
- 2026-11-09: **NEEDS FAUCET** (testnet only, injective-888 / EVM 1439). Keystores created with `pnpm --filter @strata/keys new-testnet-key` (encrypted, `.secrets/keystores/`). The Injective faucet page uses hCaptcha/Turnstile and the documented lambda API (`https://jsbqfdd4yk.execute-api.us-east-1.amazonaws.com/v1/faucet`, docs.injective.network/developers-defi/testnet-faucet-integration) returns 404, so please fund via Chrome:
  1. https://testnet.faucet.injective.network/ : paste the **0x** address (1 INJ + test USDT, new accounts only). Fallback: https://cloud.google.com/application/web3/faucet/injective/testnet with the **inj1** address.
  2. https://faucet.circle.com/ : network "Injective Testnet", paste the **0x** address (testnet USDC, EVM `0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d`). Priority: strata-test-1 first (W3 integration test needs it), then test-2, test-3, strata-options.

  | name | 0x | inj1 | needs |
  |---|---|---|---|
  | strata-test-1 | 0xa37F84583F356EcEAd212471B49944b35469ed8A | inj15dlcgkplx4hvatfpy3cmfx2ykd2xnmv28q3pdh | INJ + USDC |
  | strata-test-2 | 0x4cE919B19D7afc0e92EC0E52f05aAbbF73E28A13 | inj1fn53nvva0t7qayhvpef0qk4thae79zsnrekrev | INJ + USDC |
  | strata-test-3 | 0x719641745709e867bB0AC8d19515BBC92b3857d6 | inj1wxtyzazhp85x0wc2erge29dmey4ns47kghnt5t | INJ + USDC |
  | strata-options | 0xc82EDAB6e2047964DD08c82d69FD0EbfE5C6b536 | inj1eqhd4dhzq3ukfhggeqkknlgwhljuddfk7yrvwg | INJ + USDC |
  | strata-testnet-attestor | 0xdc83322EE104526f473AfC4f8a01e2d57676A953 | inj1mjpnythpq3fx73e6l38c5q0z64m8d22nvhankl | INJ only (gas for epoch posts) |
## W4 Indexer + DB + baseline
- 2026-11-09 00:20 IST: **Baseline recorder (PRD 10.4) running** since 2026-11-08 18:48 UTC, two supervised processes (`services/indexer/scripts/run-baseline.sh`, restarts on exit, logs in `services/indexer/logs/`, gitignored):
  - Production (Neon, what the API reads): `DATABASE_URL_FILE=$PWD/.secrets/neon_url LOG_NAME=baseline-neon BASELINE_MAX_MARKETS=12 nohup services/indexer/scripts/run-baseline.sh &`. 5 s samples, 12 mainnet story markets (SICI, XAU, EURUSD, USTECH, US500, XAG, WTI, BRENT, GBPUSD, USDJPY, NVDA, AAPL) + 3 testnet RWA perps (GOLD/USDT, EVINDEX/USDT, TRUCPI/USDT). First count after 1 min: mainnet 144 rows / 12 markets, testnet 36 rows / 3 markets, 0 errors, sample latency ~600 ms.
  - Local full coverage (all 187 active mainnet RWA perps, for market picking): `DATABASE_URL_FILE=$PWD/.secrets/local_db_url LOG_NAME=baseline-local-all BASELINE_INTERVAL_MS=15000 nohup services/indexer/scripts/run-baseline.sh &`. First count: 2244 rows / 187 markets.
  - Check counts: `cd services/indexer && DATABASE_URL_FILE=../../.secrets/neon_url npx tsx src/bin/baseline-counts.ts`. Stop: `kill $(cat services/indexer/logs/baseline-neon.pid)` then the child node process.
  - Rows: `book_snapshots` provenance `BASELINE`, `network` mainnet|testnet, mid/spread/depth@25bps from the full book every sample, oracle price + publish time from the Indexer oracle stream (polled price with null `oracle_ts` until a stream tick arrives; testnet `pricefeed` markets have no stream ticks so far). Stored `bids`/`asks`: top 5 levels per side on minute boundaries, top of book otherwise (Neon free tier is 0.5 GB). `strata_depth_usd_25` = 0 (no agents yet). **`session_state` = `"unknown"`**: the Indexer market record carries no session calendar; W6/W7 must map it (sdk `SessionState` has no `unknown`; additive enum change requested from the orchestrator).
  - Observed live: most mainnet RWA books are empty or one-sided right now (Sunday evening UTC). Example: SICI 0 bids / 0 asks, XAU 2 stale bids / 0 asks, EURUSD 1 bid / 0 asks. These are real values (mid null, depth 0), not a bug.
  - Testnet has no SICI market (active testnet perps on 2026-11-09: 18, RWA-like: GOLD, EVINDEX, TRUCPI only).
  - Neon storage estimate: ~70 MB/day at this config. Needs a downsampling/retention job before ~6 days of runtime (W4 follow-up).
- Live API limits found (cite in code): `fetchOrderbooksV2` max 100 market IDs per call; `StreamPricesByMarkets` max 40 market IDs per stream.
- `packages/db` (owned by W4, D19): added `migrate` (ordered `migrations/*.sql`, `strata_migrations` ledger with sha256, advisory lock, adopts a pre-applied 0001). Applied to Neon: adopted 0001, applied 0002 (W4) and 0003 (W6). `DATABASE_URL` or `DATABASE_URL_FILE` is the single switch; Neon pooler URLs disable prepared statements. Migration 0002 is additive: `arena_events`, `indexer_cursors`, `agent_positions`, indexes on trades/agents subaccount.
## W5 Scorer + attestations
## W6 API
## W7 Frontend data pages
- 2026-11-09: apps/web scaffolded (Next.js 16.4.5 App Router, React 19.3, TS strict, Tailwind v4, shadcn base config, ESLint). `pnpm --filter @strata/web build` and `lint` pass. Interim theme tokens in `apps/web/styles/theme.css` (CSS variables) for W8 to replace with packages/ui tokens. Landing placeholder at `app/(marketing)/page.tsx` for W8 to overwrite. Root layout `app/layout.tsx` stays W7's; its fonts are interim (Geist via next/font) until W8 lands brand fonts.
## W8 Landing + 3D + motion
## W9 DevOps + security tooling
## W10 Docs, video, deck, application
## W11 Security + QA review
