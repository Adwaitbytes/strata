# STRATA R0: final report

Release stage: **Injective testnet** (D27, D33: no mainnet capital). Status as of 2026-11-09, 17:30 IST. Soak window 1 result is below; it did not pass cleanly, and a second window runs after the fixes.

## Live links

| What | Link |
|---|---|
| Web app (testnet) | https://strata-web-ochre.vercel.app |
| Arena | https://strata-web-ochre.vercel.app/arena?network=testnet |
| API and docs | https://strata-api-nine.vercel.app (reference at `/docs`, OpenAPI at `/docs/json`) |
| GitHub (public, CI green) | https://github.com/Adwaitbytes/strata |
| Film, 3:10 | https://strata-web-ochre.vercel.app/media/strata-film.mp4 |
| Demo, 81 s (PRD 60 to 90 s) | https://strata-web-ochre.vercel.app/media/strata-demo.mp4 |
| Vertical, 15 s | https://strata-web-ochre.vercel.app/media/strata-demo-vertical.mp4 |
| Deck, 10 slides + 3 appendix | https://strata-web-ochre.vercel.app/media/STRATA-deck.pdf |
| Application answers | `deliverables/STRATA-application-answers.pdf`, `deliverables/FORM_ANSWERS.md`, `deliverables/APPLICATION.md` |
| Security | `docs/SECURITY.md`, `docs/SECURITY_REVIEW.md` |

## Contracts (testnet, chain 1439), verified on Blockscout and Sourcify

| Contract | Address |
|---|---|
| StrataArena | [0x2046D580f7c710bEE8C8eFE46CB34ccFD1B40870](https://testnet.blockscout.injective.network/address/0x2046D580f7c710bEE8C8eFE46CB34ccFD1B40870?tab=contract) |
| ScoreAttestor | [0xfb73da045cDc792dCb9f8Dcdc300aeE348bff4DF](https://testnet.blockscout.injective.network/address/0xfb73da045cDc792dCb9f8Dcdc300aeE348bff4DF?tab=contract) |
| RewardsDistributor | [0x917DeD5aEC9B5eE1EE8430A9f179D600A321d628](https://testnet.blockscout.injective.network/address/0x917DeD5aEC9B5eE1EE8430A9f179D600A321d628?tab=contract) |

## House agents (testnet)

| Agent | Arena id | ERC-8004 id | Markets | Account |
|---|---|---|---|---|
| strata-test-1 | 1 | 69 | BTC, ETH perps | [inj15dlcg...q3pdh](https://testnet.explorer.injective.network/account/inj15dlcgkplx4hvatfpy3cmfx2ykd2xnmv28q3pdh) |
| strata-test-2 | 2 | 70 | INJ, BHA perps | [inj1fn53n...rekrev](https://testnet.explorer.injective.network/account/inj1fn53nvva0t7qayhvpef0qk4thae79zsnrekrev) |
| strata-test-3 | 3 | 71 | LINK, MUN perps | [inj1wxtyz...nt5t](https://testnet.explorer.injective.network/account/inj1wxtyzazhp85x0wc2erge29dmey4ns47kghnt5t) |
| strata-options | 9001 | none | options on SICI, US500, USTECH, XAU, XAG, WTI | SIMULATED, no chain orders |

Testnet has no live RWA perps, so testnet agents quote crypto and index perps. Mainnet RWA books are recorded read-only as the BASELINE.

## Epoch attestations onchain (testnet, season 1)

| Epoch | Tx |
|---|---|
| 0 | [0xc7133de9...9d0a](https://testnet.blockscout.injective.network/tx/0xc7133de93833b909c81a1a51aa452ff58d96c46f5c8011b1e23d79db205d9d0a) |
| 13 | [0x436849ab...de1](https://testnet.blockscout.injective.network/tx/0x436849ab0cc5f77f5cf63658b66303f8cfad11797b031bb86007a897edfc0de1) |
| 14 | [0xd850e8ca...7d2](https://testnet.blockscout.injective.network/tx/0xd850e8ca8cc79511228b92d9088e36e3f82ed24a1520f2bea078c8eae75937d2) |
| 15 | [0x3cdfe8bc...64d](https://testnet.blockscout.injective.network/tx/0x3cdfe8bc1a764a59f2e96927506f189cb3713c0e4e92026e3f1f6f08c816664d) |

Epochs 1 to 12 were skipped by the scorer with a recorded reason (host asleep, no book data). Nothing was invented.

## Quality bar, as measured

- Contracts: 163 forge tests, 100% line and branch coverage, fuzz and invariant tests, Slither and Aderyn 0 high and 0 medium, immutable, no user funds.
- Agents: deterministic Avellaneda-Stoikov engine; Oracle Guard (stale, future-dated, book deviation, jump, chain lag), Session Guard, Risk Governor with persisted stops; kill switch tested on testnet by signed API, internal relay and env flag (first cancel onchain 10.1 s after the signed request). AI tuner in shadow mode, never places orders.
- Scoring: hourly epochs, merkle roots onchain, wash, self-trade, spam and data-gap flags; golden-file tests.
- UI: survey redesign, live-data terrain shader hero, GSAP ScrollTrigger, Lenis, Motion, anime.js v4, reduced-motion support; Lighthouse 100 performance and accessibility on landing and arena (desktop and mobile).
- Security review: 0 critical; H-1, H-2, M-1, M-4 fixed; M-5 (hot keys not authz-scoped, passphrase next to keystore) open and documented as a mainnet blocker.
- CI: green on GitHub (lint, typecheck, tests, forge, slither, build, gitleaks, prod audit).
- Live counts at 17:30 IST: 4,379 testnet orders recorded, 16 open, 176 guard events.

## Still open

1. **Mainnet** (contracts, agents, mainnet epoch attestation): blocked on a funded wallet. Needs about 5 to 10 INJ for gas and 20 to 50 USDC per agent, then the Section 23.3 approvals. Scripts and configs are ready.
2. **Form submission**: each of the 4 members submits the Typeform with their own personal details; the project answers are in `deliverables/STRATA-application-answers.pdf`.
3. **Telegram alerts**: the bot code is built; the owner needs to create a bot and save the token (docs/RUNBOOK.md section 5).
4. **Secret rotation**: the Neon URL, Anthropic key and Gemini keys were pasted in chat; rotate them after the event.
5. **Git history** still contains the studio name in older commits (current files are clean); rewriting it needs an owner-run force push.
6. Database integration tests are skipped in CI (they run locally against TimescaleDB).
7. The agents run on the owner's Mac under `caffeinate`; moving them to a cloud host is a config change (D25).

## Soak, window 1 (08:20 to 14:20 UTC, 9 Nov)

Agents quoted for the full 6 hours (16 open orders on chain afterwards), 3,864 orders recorded, 4 epochs attested, 136 guard events. Not clean: one agent crash on an unhandled ECONNRESET (auto-restarted in 10 s, no duplicate orders) and a 2.5 hour recording stall in the indexer and scorer after network failures. Both bugs are being fixed; a second soak window follows. Mainnet stays gated on a clean soak and on funding.
