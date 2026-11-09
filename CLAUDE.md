# STRATA repo rules (all workstreams)

Source of truth: `../STRATA_PRD.md` (copied to `docs/PRD.md`). Decisions: `docs/DECISIONS.md`. Status: `docs/STATUS.md`.

## Hard rules
- **Never invent Injective addresses, market IDs, ABIs, denoms or endpoints.** Verify from official docs
  (https://docs.injective.network, append `.md` to a page URL for raw markdown), the Injective Docs MCP
  (`https://docs.injective.network/mcp`, tool `SearchInjectiveDocs`), the vendored skills in `.claude/skills/injective-*`,
  the official `@injectivelabs/*` packages, or a live chain/indexer query. Cite the source in a code comment.
- **Never show fake numbers.** Every number carries `network` + `provenance` (`LIVE`, `TESTNET`, `SIMULATED`, `BACKTEST`, `BASELINE`, `MOCK`). `MOCK` never reaches production views.
- **No em dashes** (the long dash) anywhere: code, comments, docs, UI, commits. No hype words (revolutionary, game-changing, seamless, unleash, supercharge, empower). No emoji in UI.
- **Never log, print, commit or paste private keys or mnemonics.** Keys come from the `KeySource` interface (see D16). `.env` is gitignored; only `.env.example` is committed.
- **Testnet first.** Nothing touches mainnet (chain 1776, `injective-1`) without the orchestrator's explicit go-ahead. Do NOT deploy contracts to mainnet or place mainnet orders yourself.
- Never claim partnerships. Do not name any company or team anywhere (owner instruction, D41).
- **Git identity:** every commit is authored by the owner's global git config (AdwaitBytes <adwaitkeshari289@gmail.com>). Never run `git config user.*` and never pass `-c user.name=`/`-c user.email=`.

## Engineering
- TypeScript strict (see `tsconfig.base.json`), no `any`, ESM, Node 22+. zod at every boundary.
- Shared contracts are in `packages/sdk` (types, API schemas, merkle, ABIs), `packages/config` (networks, markets), `packages/db` (Drizzle schema + SQL migrations). Do not change their shapes without writing a note in `docs/STATUS.md`; prefer additive changes.
- Each workstream owns its folder. Do not edit another stream's folder without a note in `docs/STATUS.md`.
- Tests ship with the feature (vitest for TS, forge for Solidity). Run your package's typecheck + tests before reporting done.
- `pnpm install` is shared: if it fails on a lockfile race, wait a few seconds and rerun. Add deps only to your own package.
- Commit your own folder with clear messages (`git add <your paths>`; never `git add -A`). Do not push; the orchestrator pushes.

## Network constants (verified, PRD 4.3)
Mainnet EVM 1776 / `injective-1`, RPC https://sentry.evm-rpc.injective.network/, explorer https://blockscout.injective.network/.
Testnet EVM 1439 / `injective-888`, RPC https://k8s.testnet.json-rpc.injective.network/, explorer https://testnet.blockscout.injective.network/.
Bank precompile 0x...64, Exchange precompile 0x...65. Legacy tx type 0, gasPrice 160e6. Never use chain 2525.
