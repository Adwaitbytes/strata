# STRATA demo film: spec

GOAL: a reviewer who has never heard of STRATA understands in 85 s that agents add liquidity to thin Injective books, that guards stop them before damage, and that scores are checkable onchain. They leave with the URL.

OUTPUT: HyperFrames, 1920 x 1080, 30 fps, MP4 H.264. Storyboard from PRD 14. Release stage is TESTNET (D33).

TIME: 85 s x 30 fps = 2550 frames. Music bed "Clean Soul" (Kevin MacLeod, CC BY 4.0), about 66 BPM, no beat-locked cuts: the bed is calm and the captions are the clock.

LOOK (brand from `packages/ui`, W8):
- Ground `#07080B` with the brand material: horizontal strata lines every 48 px at 2% white, and liquidity drawn as stacked translucent bands. This is the product's own terrain, not a void: every shot fills at least 60% of the frame with book, grid or bands.
- Ink `#E8EBF0`, muted `#9AA3B2`. Accent `#3EE6D4` only on liquidity (agent quotes, depth added, the wordmark seam line) and at most one word per caption.
- Bids `#5FD49A`, asks `#FF7D6B`, warning `#F2B84B`, halt `#FF4D5E`, baseline `#8B93A7`.
- Display: Archivo at width 125, weight 700, 96 to 120 px, tracking -2.5%. Body: Geist 500. Numbers: Geist Mono 500, tabular.
- Placeholders for real data: amber `#F2B84B` on a dashed amber box with the token name in brackets, for example `[SPREAD_BPS]`. Impossible to mistake for a real number.

OBJECTS:
- Order book: two staircases meeting at a mid line, bids green on the left, asks coral on the right, x axis in bps from mid. A thin book has a wide gap at the mid and short steps.
- Agent quote: a translucent aqua band stacked on a book level. More agents, thicker strata.
- Oracle feed: a mono readout pair, "chain time" and "oracle report", with the difference in seconds.
- Session clock: a mono clock with "US equities close" countdown.
- Epoch attestation: a merkle root (hex, truncated) landing on a contract row with "EpochPosted".
- Screen capture slot: a browser frame with a dashed amber interior and the route it expects (`/arena`, `/markets/[id]`). Replaced by the orchestrator's recording.

MOTION:
- Enter: `expo.out` 0.6 to 0.9 s. Move: `power2.inOut` 0.8 s. Exit: `power3.in` 0.3 s (about half the entrance).
- Bands grow from the mid line outward, 40 to 80 ms stagger. Titles land with an 8 px blur-in in 0.18 s and then hold dead still.
- Halt: quotes collapse to zero width in 0.25 s `power3.in`, red rule draws across in 0.2 s. No shake, no flash.

SHOTS:
1. 0 to 8 s, markets: a 15 x 9 grid of 135 tiles fills from the top left, 4 ms stagger; tiles tint by asset class. Caption: "Injective lists 135 real-world markets." Hands off by the grid collapsing into one tile that becomes the book.
2. 8 to 18 s, thin book: staircase depth chart, gap at mid widens, "spread" bracket draws. Caption: "Most of those books are thin." Hands off: aqua bands start to fill the gap.
3. 18 to 35 s, arena: three agent rows enroll (`strata-test-1..3`), their aqua bands stack onto the book near mid, score counters roll, a merkle root lands on `ScoreAttestor` with `EpochPosted`. Then the browser frame slides in with the `/arena` capture slot (27 to 35 s).
4. 35 to 50 s, guards: oracle readout shows a report 5 s ahead of chain time, the row goes red, HALT, bands collapse. Then a session clock reaches 15:55 ET and the inventory bar slides to zero. Labeled "Simulated event".
5. 50 to 70 s, proof: TESTNET badge, baseline band (grey) against agents live (aqua) over time, two placeholder metrics, then the `/markets/[id]` capture slot.
6. 70 to 85 s, end: wordmark with the seam line drawing across, "Open to any agent. Verified onchain.", app URL placeholder, repo, Aarambh Labs, music credit.

Captions: one line at a time, 96 px from the bottom, Geist 500 44 px, inside title safe. They carry the story (no voiceover).

BANNED: everything listed in the HyperFrames spec defaults, plus: any number that looks real but is not (every unknown is an amber placeholder); glow and bloom on bands; the logo docked in a corner during the film; three cards in a row; words like revolutionary, seamless, unleash; em dashes; partner logos; "mainnet live".

QA frames: 4 s (grid full, caption), 13 s (thin book with spread bracket), 24 s (bands stacked, scores), 31 s (capture slot), 39 s (HALT), 45 s (flatten), 58 s (proof with placeholders and TESTNET), 78 s (end card).

## Slots the orchestrator fills

| Slot | Where | How |
|---|---|---|
| `/arena` screen recording | `compositions/s3-arena.html`, the dashed `#s3-capture` box inside `#s3-browser` (shows 30.8 to 35 s) | Record about 5 s at 1920 x 1080, save as `assets/capture/arena.mp4`. Replace the inner markup of `#s3-capture` with `<video id="s3-capture-video" src="assets/capture/arena.mp4" muted playsinline style="width:100%;height:100%;object-fit:cover"></video>`, then remove the dashed border and stripes from `.s3-slot`. |
| `/markets/[id]` screen recording | `compositions/s5-proof.html`, `#s5-capture` inside `#s5-browser` (61 to 70 s) | Same, about 9 s, `assets/capture/market.mp4`, id `s5-capture-video` |
| Market, spread change, depth added | `s5-proof` host `data-variable-values` in `index.html` (`market`, `spreadBps`, `depthUsd`) | Real testnet values from the API. Then drop the `ph` class on those spans so they render as normal text. |
| `[SPREAD_SERIES]` chart | `#s5-data` in `compositions/s5-proof.html` | Replace with the real spread series (or delete it if the capture covers it) |
| Epoch root | `s3-arena` host `data-variable-values`, `epochRoot` | First 8 to 12 hex chars of a real testnet `EpochPosted` root |
| App URL | `s6-cta` host `data-variable-values`, `appUrl`; also the `[TESTNET_APP_URL]` text in both browser bars | Vercel URL |

After filling: `pnpm --filter @strata/video check`, then `pnpm --filter @strata/video render` writes `deliverables/strata-demo.mp4`. No placeholder may remain in the final render: `grep -rn "\[[A-Z_]*\]" apps/video/index.html apps/video/compositions` must print nothing. The 15 s vertical cut (PRD 14) is not built yet.

Captions and every scene file are plain HTML; edit them directly.
