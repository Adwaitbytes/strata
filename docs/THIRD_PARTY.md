# Third-party services, scripts and images

Every external service, script, image and hosted tool STRATA depends on, and why. PRD 16.2: the web app loads no third-party script that is not listed here. Constraint: no paid services (D23 to D30); everything below is free or free tier.

Keep this file current: adding a dependency that talks to the network, or a script tag, means adding a row here in the same change.

## Browser (apps/web)

The site loads **no third-party scripts, fonts, analytics, trackers or cookies** at runtime. All JavaScript is first-party bundles served from the Vercel deployment. The CSP (`apps/web/proxy.ts`, per-request nonce) blocks anything else.

| What | Contacted from the browser | Why |
|---|---|---|
| STRATA API (`strata-api` on Vercel) | `connect-src` | Arena, agent and score data |
| Injective EVM JSON-RPC (testnet `k8s.testnet.json-rpc.injective.network`, mainnet `sentry.evm-rpc.injective.network`) | `connect-src` | Wallet reads and transactions (wagmi + viem) |
| The user's own wallet extension (injected EIP-1193 provider) | none (in page) | Signing. Only the `injected` connector is configured, so no WalletConnect relay is contacted |
| Blockscout explorer links | plain links, not loaded | Users can verify transactions and contracts |

Bundled open source libraries (served first-party, no runtime calls): Next.js, React, Tailwind CSS, Radix, Motion, GSAP, Lenis, anime.js, three.js / React Three Fiber / drei / postprocessing, TradingView Lightweight Charts, TanStack Query, wagmi, viem, zod, lucide-react.

## Hosting and data

| Service | Plan | Used for | Why this one |
|---|---|---|---|
| Vercel | Hobby (free) | Hosting `apps/web` and `apps/api` | Owner approved host (D25) |
| Neon | Free tier | Production Postgres (D26) | Free, owner provided |
| GitHub (`Adwaitbytes/strata`, private) | Free | Source, Actions CI | D24 |
| Docker Desktop on the owner's Mac | Free personal use | Agents, indexer, scorer, bot, monitoring (D25) | No paid VM budget |

## Chain and market data (server side)

| Service | Used by | Why |
|---|---|---|
| Injective EVM JSON-RPC (testnet and mainnet, PRD 4.3) | agents, scorer | Contract calls, epoch posts |
| Injective Indexer gRPC-web (`testnet.sentry.exchange.grpc-web.injective.network`, `sentry.exchange.grpc-web.injective.network`) | agents, indexer | Order books, trades, oracle prices, order placement |
| Blockscout API (`testnet.blockscout-api.injective.network`, `blockscout-api.injective.network`) | indexer | Arena contract events |
| Injective testnet faucet | setup scripts | Testnet funds (D8) |
| Injective Docs MCP (`docs.injective.network/mcp`) | development only | Verifying addresses and endpoints (D17) |

## Alerts and AI

| Service | Used by | Why |
|---|---|---|
| Telegram Bot API (`api.telegram.org`) | `packages/alerts`, all services, `telegram-bot` container | Owner alerts and `/kill` (D11, D30). Plain text only, no PII; agent names and numbers only |
| Anthropic API | agent AI risk tuner | Bounded parameter suggestions. Shadow mode until `.secrets/anthropic_api_key` is set (D10, D29). Prompts carry market data only (PRD 16.3) |

## Container images (pinned)

| Image | Why |
|---|---|
| `node:22.23.4-bookworm-slim` | Base for every Node service (`infra/docker/service.Dockerfile`) |
| `timescale/timescaledb:2.17.2-pg16` | Local dev database (`infra/compose/db.yml`) |
| `prom/prometheus:v3.5.0` | Metrics |
| `grafana/grafana-oss:12.0.2` | Dashboards. Usage reporting, update checks and news feed are turned off in compose |
| `ghcr.io/gitleaks/gitleaks:v8.28.0` | CI secret scan |
| `rhysd/actionlint:1.7.7` | CI workflow lint |

## CI actions (`.github/workflows/ci.yml`)

| Action | Why |
|---|---|
| `actions/checkout@v5`, `actions/setup-node@v5`, `actions/upload-artifact@v4` | GitHub official |
| `pnpm/action-setup@v4` | pnpm at the version in `package.json#packageManager` |
| `foundry-rs/foundry-toolchain@v1` | forge build, test, coverage |
| `crytic/slither-action@v0.4.1` | Static analysis of contracts (PRD 16.6) |

## Developer tools (local, not shipped)

gitleaks (pre-commit hook), shellcheck, Foundry, Slither and Aderyn (security review), Vercel CLI (orchestrator deploys), Blender (asset scripts, D31), HyperFrames (demo video).

## Not used, on purpose

- No analytics, session replay, A/B testing or tag managers. If privacy-friendly analytics is added later (PRD 16.3: Plausible or Vercel Web Analytics without cookies), list it here first.
- No Sentry yet. PRD 7.2 names it; adding it needs a free-tier account by the owner, PII scrubbing on, and a row here.
- No WalletConnect: needs a project id from a third-party account; the injected connector covers MetaMask and Rabby.
- No AWS (D4, D16).
