# Hacker House form: copy-paste answers

Form: https://xsxo494365r.typeform.com/to/zeKuqtdg (one form per person; all 4 team members submit their own with the same project answers below).

## Per person (each member fills their own)
- Full name, email, Telegram handle, X handle (optional), GitHub profile, LinkedIn (optional)
- Your role: pick one of Founder / Co-founder, Developer / Engineer, AI / ML Engineer, Designer, Product Manager, Growth / Marketing
- Where are you based?
- Attend in person Dec 1 to 10: **Yes, I can attend all 10 days.**
- Visa for Thailand: your own answer
- Consent and terms: read them yourself before ticking

## Same for all 4

**Team size:** 4

**How many would attend in person?** 4

**Project name:** STRATA

**Briefly describe what your project does (250 max):**
STRATA is an open arena where AI market-making agents add liquidity to Injective's perp markets, RWAs first. Agents trade their own capital, get scored onchain every hour on spread, depth and uptime, and earn points for the liquidity they add.

**Category:** AI & agents

**Stage:** Testnet

**What have you shipped so far?**
Live on Injective testnet: arena and score attestation contracts verified on Blockscout and Sourcify, three house agents quoting behind oracle, session and risk guards with a tested kill switch, hourly score attestations onchain (4 so far, latest https://testnet.blockscout.injective.network/tx/0x3cdfe8bc1a764a59f2e96927506f189cb3713c0e4e92026e3f1f6f08c816664d), a public leaderboard, and an options writer in a labeled simulator. We measured mainnet: on 9 Nov only 3 of 188 real-world perps had a bid and an ask within 0.25% of price.

**Website:** https://strata-web-ochre.vercel.app

**Demo:** https://strata-web-ochre.vercel.app/media/strata-demo.mp4

**Repo:** https://github.com/Adwaitbytes/strata

**Deck:** https://strata-web-ochre.vercel.app/media/STRATA-deck.pdf

**What do you want to build or ship during the 10 days?**
Take STRATA to mainnet on Injective's real-world perps with funded house agents, then open the arena to outside agents. Concretely: a rewards distributor and Season 1 incentives designed with the Injective team, the options writer moved from our simulator onto Injective Options once we have writer access, private RFQ for institutional block trades, and a public agent SDK plus MCP onboarding so a new agent can enroll in minutes. Everything stays scored onchain every hour so anyone can check it.

**Where do you need the most help? (up to 3):** Injective Integration; Tokenomics & DeFi Design; Ecosystem Partnerships

**Anything else you'd like us to know?**
Watch the 3 minute film: https://strata-web-ochre.vercel.app/media/strata-film.mp4. Every number in it is real and dated, and anything illustrative is labeled. The full code, security review and test suite are public in the repo.
