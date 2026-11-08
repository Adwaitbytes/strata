# STRATA: Hacker House application copy

Form: Injective Bangkok Hacker House (Dec 1 to 10, 2026). Closes **Nov 10, 2026**. Template: PRD 22.1.

## Fill before submitting

Nothing below in square brackets is real yet. Do not submit with a bracket left in.

- [x] Stage is **Testnet** (D33: no mainnet capital). Variant A below is the copy to submit. Variant B is kept only in case a wallet is funded and S1, S2 and S5 go live before the deadline.
- [ ] `[TESTNET_APP_URL]`: testnet web app (Vercel URL, D23)
- [ ] `[TESTNET_ARENA_URL]`: the `/arena` leaderboard page
- [x] Testnet contracts filled (Sourcify verified; Blockscout verifier down since 2026-11-05)
- [ ] `[TESTNET_EPOCH_TX_URL]`: one `EpochPosted` attestation tx on testnet Blockscout
- [ ] `[N_TESTNET_AGENTS]`: agents quoting at submission time, counted from the app
- [x] Testnet markets: BTC, ETH, INJ, LINK and index perps (testnet has no live RWA perps)
- [ ] `[N_EPOCHS]`: epochs attested so far, from the Transparency page
- [ ] `[OPTIONS_STATUS]`: either "live on testnet" (whitelist granted) or "running in a labeled simulator while we wait for writer access" (D9)
- [ ] Make the repo public before submitting (it is private until submission, D24)
- [ ] `[VIDEO_URL]`: demo video
- [ ] `[DECK_URL]`: `deliverables/STRATA-deck.pdf` hosted somewhere reviewers can open
- [ ] Owner confirms the "Earlier" sentence (grants figure, clients, incubation) is accurate and OK to state publicly
- [ ] Any number added from the app keeps its label if it is testnet (say "on testnet")
- [ ] Re-run the character count if the description changes (command at the bottom)

---

## Project name

STRATA

## Description (max 250 characters)

STRATA is an open arena where AI market-making agents add liquidity to Injective's perp markets, RWAs first. Agents trade their own capital, get scored onchain every hour on spread, depth and uptime, and earn points for the liquidity they add.

**Character count: 243 / 250** (counted with Python `len()`, no em dashes).

Changes from the PRD draft, and why:
- Dropped "and options": the options writer is testnet only and may be simulated (D9). Mention it in "What have you shipped" with its real status instead.
- "earn points" instead of "earn": Season 0 pays points, not tokens (PRD 6, R0 out of scope).
- Added "every hour": it is specific and true (1 hour epochs, PRD 10.1).
- "perp markets, RWAs first" instead of "RWA perps": testnet agents quote crypto and index perps because testnet has no live RWA perps; RWAs are the mainnet target.

## Category

AI & agents

## Stage

**Testnet** (D27, D33). Mainnet contracts and agents are built and wait on a funded wallet.

## What have you shipped

### Variant A: Testnet (submit this one)

Live on Injective testnet: arena and score attestation contracts on Injective EVM (StrataArena https://repo.sourcify.dev/1439/0x2046D580f7c710bEE8C8eFE46CB34ccFD1B40870, ScoreAttestor https://repo.sourcify.dev/1439/0xfb73da045cDc792dCb9f8Dcdc300aeE348bff4DF; source verified on Sourcify because the Blockscout verifier has been down network-wide since Nov 5). [N_TESTNET_AGENTS] STRATA agents quoting BTC, ETH, INJ, LINK and index perps behind oracle, session and risk guards with a kill switch (testnet has no live RWA perps). We have recorded a read-only baseline on 12 mainnet RWA perp markets since Nov 8; mainnet agents quote there once funded. Hourly onchain score attestations ([N_EPOCHS] so far, latest: [TESTNET_EPOCH_TX_URL]) and a public leaderboard at [TESTNET_ARENA_URL]. Options writer agent: [OPTIONS_STATUS]. Mainnet contracts and agents are built and tested, waiting on a funded wallet. Earlier: Aarambh Labs shipped Supermission (AI DeFi trading terminal, about $100K in grants), Monsmith (Monad IDE) and Proofly (KYC, incubated at IFIH GIFT City); clients include DP World and WASL Group.

### Variant B: Mainnet (not in use; only if a wallet is funded and S1, S2 and S5 go live)

Mainnet beta live: arena and score attestation contracts on Injective EVM, verified on Blockscout ([MAINNET_ARENA_CONTRACT_URL], [MAINNET_ATTESTOR_CONTRACT_URL]). [N_MAINNET_AGENTS] STRATA agents quoting [MAINNET_MARKETS] with team capital, behind oracle, session and risk guards with a kill switch. Hourly onchain score attestations (latest: [MAINNET_EPOCH_TX_URL]) and a live leaderboard at [MAINNET_ARENA_URL]. Full feature set on testnet, including the options writer agent ([OPTIONS_STATUS]). Earlier: Aarambh Labs shipped Supermission (AI DeFi trading terminal, about $100K in grants), Monsmith (Monad IDE) and Proofly (KYC, incubated at IFIH GIFT City); clients include DP World and WASL Group.

## What will you build in the 10 days

A rewards distributor and Season 1 incentives, designed with input from the Injective team. The options writer agent on mainnet as soon as Options launches there. Private RFQ for institutional block trades (privacy track). A public agent SDK and MCP onboarding so third-party agents can enroll in minutes. Demo flows for the institutional teams in the program.

Note: the PRD draft named Gulf Labs and SMBC Nikko here. They are program partners, not ours, so naming them as if we had flows agreed reads like a partnership claim. Use the generic wording above unless the owner has a written agreement (CLAUDE.md, PRD 16.5).

## Help needed (max 3)

1. Injective Integration
2. Tokenomics & DeFi Design
3. Ecosystem Partnerships

## Links

| Field | Value |
|---|---|
| Website | [TESTNET_APP_URL] |
| GitHub | https://github.com/Adwaitbytes/strata (public at submission) |
| Demo video | [VIDEO_URL] |
| Deck | [DECK_URL] |

## Team

Aarambh Labs. Owner and contact: Yatharth Urmaliya (Founder and CEO), per the PRD owner line (D14).

---

### Re-count the description

```bash
python3 -c "s=open('deliverables/APPLICATION.md').read().split('## Description (max 250 characters)')[1].strip().split('\n')[0]; print(len(s), s)"
```
