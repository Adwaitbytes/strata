# STRATA film brief

The one film that gets STRATA into the Injective Bangkok Hacker House. About 3 minutes. It must look like a top motion studio made it (think Apple product films, Stripe Sessions, Linear and Vercel launch films, ManvsMachine, Buck), and it must not look or sound AI-made.

Reference the owner liked: `/Users/adwaitkeshari/Downloads/Preflight-demo.mp4` (181.5 s, HyperFrames). Its full project is at `/Users/adwaitkeshari/Desktop/bittensor/preflight/videos/preflight-demo/` (read `SPEC.md`, `KIT.md`, `SCRIPT.txt`, `cues.json`, `compositions/`). Keep what made it good:
- data as the hero (its galaxy was 28,771 real seats)
- one giant real number on screen at a time
- real product screens pushed in full-bleed, never tilted, never a small window in a void
- paper interludes for proof
- one accent word per title
- text that lands on the exact spoken word
- a calm narrator
Beat it on what it lacked:
- too many near-empty dark frames
- dim, small product screens
- one 3D object only
- plain transitions
- a thin sound mix

## Output
- `deliverables/strata-film.mp4`: about 180 s, 1920x1080, 30 fps, H.264 + AAC, captions burned in, loudness about -16 LUFS integrated.
- `deliverables/strata-demo.mp4`: a 60 to 90 s cut of the same film (PRD 22, used in the application).
- `deliverables/strata-demo-vertical.mp4`: a 15 s 1080x1920 cut.
- Source project lives in `film/` (outside the pnpm workspace on purpose). Big renders and media caches stay gitignored; commit sources, small assets, and the final MP4s.

## Hard rules
- **Never fake a number.** Every number on screen is real, dated, and sourced from the live system (Neon read-only, the API https://strata-api-nine.vercel.app, chain/explorer). Anything illustrative is labeled on screen ("Illustration", "TESTNET", "BASELINE", "SIMULATED"). STRATA runs on Injective testnet today; say so plainly. Mainnet RWA markets appear only as the measured BASELINE (read-only order book recordings since 2026-11-08 18:48 UTC).
- **No AI look.** No AI-generated images or video of anything, no stock footage, no glowing brain or robot imagery, no lens flares, no fake UI. Visuals come from: the real product, real chain pages, real data, Blender renders of our own data, and clean kinetic type.
- **No AI voice of the script.** Plain spoken English, like a sharp founder explaining it to a friend over coffee. Contractions. Short and medium sentences mixed. No: delve, unlock, seamless, leverage, empower, revolutionize, game-changing, landscape, "in today's world", "not just X but Y", "introducing", rule-of-three lists, rhetorical questions stacked in a row. No em dashes anywhere.
- Never claim partnerships. "Built on Injective" only. Team: Aarambh Labs.
- Secrets: Gemini key at `.secrets/gemini_api_key` (and spares in `.secrets/gemini_api_keys`, one per line). Read from file in scripts, never print, never commit.
- Git: never set git identity; global config is correct. Commit explicit paths; `git pull --rebase` before push; never force-push.

## Look (STRATA brand, see `docs/DESIGN.md` and `packages/ui`)
- Worlds:
  - **Terrain**: dark basalt ground `#0D0F0E`, chalk text `#ECE8DF`, ochre accent `#E9A94B` for STRATA depth only, malachite for bids, oxide for asks. Pull exact values from `packages/ui/src/tokens.ts`.
  - **Survey paper** (proof, numbers): ground `#ECEEE7`, ink near-black, light-mode ochre `#8A560E`.
  - **Product**: real 2x captures.
- Type:
  - **Bricolage Grotesque** for display (one accent word per title in italic or in the ochre colour)
  - **Schibsted Grotesk** for body
  - **Martian Mono** for every number and label
  - Self-host the same font files the web app uses. Text never below 28 px. Keep content inside the title-safe area.
- Concept: liquidity as terrain. The order book is land. A thin market is a canyon (the spread) between two low plateaus (bids, asks). Agents deposit layers of liquidity; the canyon narrows. Guards are fault lines that stop movement.

## Story (about 180 s; the director may refine words and timing but keep the shape and the 3D slots)
1. **Cold open, 0 to 8 s.** Blender B1: a slow dusk glide over dark mineral terrain. The narrator says this is a real order book. On screen it says "XAU/USDC perp, Injective mainnet, 8 Nov, BASELINE", or whichever real market the data supports best.
2. **The gap, 8 to 20 s.** Blender B2: the camera drops into a cross-section, and a canyon splits the land. Survey labels on the cut: the real spread in bps, bids left and asks right. Line: every trade crosses this gap, and the wider it is, the more you pay just to get in and out.
3. **The measurement, 20 to 38 s.** Paper. A dot grid or strip plot from our real BASELINE recordings, for example: share of time a market had no bid within 0.25% of price, and the best vs worst market as a "same day, an Nx gap" moment. Then the scale: 187 real-world perp markets on Injective (gold, oil, the Nasdaq, the euro, GPU compute) and most of them are thin most of the day.
4. **Why it's thin, 38 to 55 s.** Market making is a closed job, done by a few firms you can't see or measure. AI agents could do it. They need a fair, safe place to prove it.
5. **Reveal, 55 to 68 s.** Blender B3: strata layers rise and settle as the canyon narrows. Cut to the STRATA wordmark. "An open arena for AI market makers."
6. **How it works, 68 to 88 s.** Paper flow, Position-deck style:
   - agent posts both sides on Injective's order book
   - measured every 5 seconds
   - scored every hour on spread, depth, uptime and PnL
   - the score's merkle root posted onchain
   - anyone can check it
7. **Inside an agent, 88 to 108 s.** A real quote ladder snapping to ticks around fair price: 2 bids and 2 asks, the inventory skew. Line: it doesn't guess where price goes, it quotes both sides and manages risk. The AI only turns knobs inside hard limits. Show the real shadow-mode tuner rationale lines with bounds bars, and say it never places an order.
8. **The guards, 108 to 135 s.**
   - **Oracle Guard:** the Ostium lesson (July 2026, about $18M lost to price reports stamped in the future). A timestamp from the future flashes, and the agent halts. Use a real `oracle_stale` or `session_closed` guard event from Neon.
   - **Session Guard:** Blender B5, light falling to night as the US market closes. Spreads widen, then the position flattens before close.
   - **Kill switch:** a real signed request, and every order is gone in about 10 s. Show the real cancel tx hash and the measured latency from `docs/STATUS.md`.
   - Blender B4, a fault line freezing the land, can carry the halt moment.
9. **Proof onchain, 135 to 155 s.** Blender B7 (optional): the merkle tree grows to a root. Then the real Blockscout page of the epoch attestation tx `0xc7133de93833b909c81a1a51aa452ff58d96c46f5c8011b1e23d79db205d9d0a`, pushed in on the root. Then "verify my score" in the browser, using the real UI.
10. **Live now, honest, 155 to 170 s.**
    - the real arena leaderboard on testnet
    - real explorer pages of the agent accounts with open orders
    - "Today: Injective testnet, three house agents, an options writer in simulation. Mainnet the day we fund it."
    - the Join wizard: any agent can enter with its own code and capital
11. **Close, 170 to 182 s.** Blender B6: the terrain filled in at golden light, slow orbit. "Injective has the markets. STRATA brings the liquidity." End card: wordmark, `strata-web-ochre.vercel.app`, `github.com/Adwaitbytes/strata`.

## Sound
- **Voice:** Gemini TTS (`gemini-3.8-flash-tts` or `gemini-2.5-pro-preview-tts`). Audition at least 5 voices on the same two lines with a style prompt along the lines of "calm, warm, unhurried, a product designer talking to a friend, not an announcer". Pick the most human one.
  - Word-level timings go in `film/cues.json`. Every on-screen word lands 0 to 0.15 s before it is spoken.
- **Score:** Lyria 3.5 (`models/lyria-3.5`), original and instrumental: warm, minimal, analog synth and felt piano, a soft pulse, building at the reveal and resolving at the close. Generate 2 or 3 and pick the best.
  - Duck the score under the voice (hyperframes-audio).
- **SFX:** subtle and sparse, made or licensed clean (soft ticks for data, low whoosh on camera moves, a muted thud on the halt).

## Blender shots (owner: Blender agent; renders to `film/assets/blender/<id>/` as 1920x1080 30 fps PNG sequences plus an H.264 proxy MP4)
All shots are built from our real data where it says so. No text inside renders. EEVEE (or Cycles with Metal if fast enough), AgX view transform, subtle depth of field, about 15 minutes of render each at most.

| ID | What | Length |
|---|---|---|
| B1 `terrain_open` | Dusk glide over terrain whose heightfield comes from real BASELINE book depth (bids one side, asks the other, time as the long axis) | 8 s |
| B2 `canyon_cut` | Camera descends; the land splits into a cross-section; strata visible on the cut face, malachite-tinted bid side, oxide-tinted ask side, the canyon in the middle | 7 s |
| B3 `strata_rise` | Layers of liquidity deposit one by one with weight and settle; the canyon narrows; ochre layer marks STRATA depth | 9 s |
| B4 `fault_halt` | A fault line cracks across the land and all motion freezes (dust hangs) | 5 s |
| B5 `night_close` | Light falls from late day to night over the land, a session closing | 6 s |
| B6 `golden_wide` | Filled-in terrain, golden light, slow orbit, sky space for the end title | 10 s |
| B7 `merkle_root` (optional) | Leaves to a single root rising as a quiet crystalline structure | 6 s |

## Captures (owner: capture agent; to `film/assets/screens/` and `film/assets/clips/`, plus `film/assets/data/*.json`)
- **Stills** of the live site at 1920x1080, DPR 2 (3840x2160 PNG) with a `boxes.json` of key element boxes in CSS px:
  - landing hero
  - arena
  - agent 1
  - market ETH
  - transparency
  - status
  - join steps 1 to 4
  - docs scoring
  - verify-score result
- **Clips** at 1920x1080 30 fps of the live 3D hero terrain (10 s), the landing scroll story (30 s) and the arena.
- **Chain pages:**
  - Blockscout epoch tx
  - StrataArena contract
  - Sourcify verified page
  - testnet explorer agent accounts with open orders
- **Data JSON:**
  - baseline stats per market (spread median/p90 bps, share of samples without a bid or ask within 25 bps, depth within 25 bps)
  - the heightfield export for Blender
  - agents, orders and guard events by reason
  - tuner rationale lines (shadow mode)
  - epoch root and tx
  - kill-switch timings
  - test and security counts (see `docs/STATUS.md`, `docs/SECURITY_REVIEW.md`)
- **Real terminal and log lines** (agent quoting, kill switch), scrubbed of anything secret, as JSON for the director to typeset.

## Quality bar (director owns)
- Contact sheets every 2 s of each render, viewed and fixed: no overflow, no empty frames, nothing below 28 px, no layout jumps.
- `hyperframes check` clean.
- A design-critic subagent review of frames, with its top fixes applied.
- A final watch-through of the full MP4 by extracting frames around every cut.
