# Review: STRATA film

Deliverables (all H.264 + AAC, captions burned in, two-pass loudnorm):
- `deliverables/strata-film.mp4`: 189.7 s, 1920 x 1080, 30 fps, 54 MB, -16.0 LUFS integrated, true peak -1.3 dBTP.
- `deliverables/strata-demo.mp4`: 81.5 s (scenes open, gap, measure, reveal, proof, close, cut on scene boundaries), -16.0 LUFS, -1.5 dBTP.
- `deliverables/strata-demo-vertical.mp4`: 15.0 s, 1080 x 1920 (`vertical/`): the `3 of 188` payoff, the reveal on B3 and the end card, -16.0 LUFS, -1.5 dBTP.

## Creative calls
- Storyline: "the order book is land". One real book (NVDA/USDC PERP, Injective mainnet, BASELINE) carries the film from the cold open through the canyon to the measured payoff `3 of 188`, then STRATA deposits liquidity on that same land and the close returns to it in golden light.
- Three worlds only: terrain (Blender renders of our own data), survey paper (measurement and the explainer), the real product and chain (pushed captures, never tilted). Every scene opens on its object; titles carry one ochre accent word.
- Voice: Gemini `gemini-3.8-flash-tts`, voice **Achird**, picked from 8 auditions (Despina, Sulafat, Achird, Umbriel, Algieba, Iapetus, Zubenelgenubi, Callirrhoe) on the same two lines and style prompt; a blind audio-model listen ranked Achird first twice with the clips reordered. `gemini-2.5-pro-preview-tts` returned 429 (free tier limit 0) and could not be auditioned.
- Score: Lyria 3.5 (`models/lyria-3.5`) and Lyria 3 Pro/Clip returned 429 (free tier limit 0 on every key), so the score is an original **Lyria RealTime** (`lyria-realtime-exp`) take, steered section by section to the locked cue sheet (dusk, pulse, reveal lift at 55.5 s, steady, tension, near silence for night, rebuild, golden resolution). Three takes; take A chosen on measured envelope and a blind listen. Carved under the voice (hyperframes-audio carve, strength 0.8), bed volume 0.25, a hand-drawn dip to near silence on the oracle halt freeze.
- SFX: 42 sparse hits from the bundled Pixabay-licensed set (click-soft, key-press, pop, whoosh, whoosh-short, impact-bass, riser), each placed one frame after its picture event; rotated takes, no chimes.
- Numbers: every number traces to `SPEC.md` DATA. The `3 of 188` sweep was taken read-only from Injective chain REST at 2026-11-09 08:42:45 UTC (`assets/data/rwa-sweep.json`); a confirmation sweep at 09:11:06 UTC found 4 of 188 (`assets/data/rwa-sweep-check.json`). The film shows the dated 08:42 value.

## Storylines not built
- "A number lands" without terrain: the sweep as kinetic type only.
- "A day on call": one agent's day from quote to halt to kill, told on the product screens.

## Measured
- `hyperframes check --json` on the final project: ok; 0 errors; runtime, layout, motion, contrast and audio clean (lint keeps 26 warnings: file size, caption track density, sparse keyframes in two clips). Craft warnings kept on purpose: rolling digits flagged mid-roll; the oracle halt event line holds 2.5 s (pinned between "stops quoting" and the cut); the shadow rationale holds 4.75 s; the open date line holds 2.4 s.
- Contact sheets every 2 s of each render, plus a design-critic pass on the first full draft; its P0/P1 fixes were applied (no empty frame at the kill climax, digit-roll clipping, captions off product data, a clean Mainnet frame, the gold book held, stacked titles, paper-style captions on paper, a tight `3 of 188`, objects at frame 0).
- Three render passes (draft, delivery, final delivery), contact sheets every 2 s of each, and frames 0.1 s either side of every scene cut on the final file. A blind mix review of two 45 s excerpts led to -1.6 dB on the score and 2 to 3 dB off the clicks, pops and impacts.

## Not checked by ear
The voice, the score and the effects were measured (loudness, envelope, transcript) and blind-ranked by an audio model, not heard by a person.

## Weakest shots and what I would change with more time
- The session close (123 to 129 s) uses B1 graded to night because the B5 render was dropped; a real B5 would read better.
- The proof's Verify panel is a 2x capture upscaled to 3.3x: readable but slightly soft. A DPR 3 recapture of the settled Passed state would fix it.
- B3 is flatter and more olive than B1's rim-lit dusk.
