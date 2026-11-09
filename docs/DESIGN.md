# STRATA design system

Owner: W8. Concept: **the order book as a geological survey** (PRD 12.1, "liquidity as terrain", redesign D40). Every market is a ridge on a surveyed field, its height is live depth, and the depth STRATA agents add is a luminous stratum along the crest. Data reads like an instrument on a survey sheet: contour lines, a survey grid, measured rules, legends that say where each number came from.

Source of truth for every value below is code: `packages/ui/src/tokens.ts` (typed), mirrored in `packages/ui/src/theme.css` (CSS variables + Tailwind v4 `@theme`). `packages/ui/src/tokens.test.ts` fails if the two drift, if any text pair drops below WCAG AA, if two semantic colors collapse into one, or if the terrain colors leave the palette.

## 1. Research: eight patterns adopted

References reviewed Nov 9, 2026: lusion.co, activetheory.net, stripe.com/sessions, linear.app, vercel.com/ship, rauno.me, teenage.engineering, Awwwards and Godly finance listings, Hyperliquid, and cartographic sources (USGS topographic conventions, the Grand Canyon geologic cross section). Nothing was copied: no assets, layouts or copy.

| # | Pattern seen | Where | How STRATA uses it, and why |
|---|---|---|---|
| 1 | One immersive WebGL object carries the brand; everything else stays quiet. | Lusion, Active Theory | The live terrain is the single expressive element. Type, panels and chrome stay flat and disciplined so the land is the focal point. |
| 2 | The object is the product's own data, not decoration. | Linear (real UI as hero), Hyperliquid (numbers first) | Ridge height is `/v1/stats` depth per market. Labels on the crests name the market and its depth. With no data the field renders flat and the legend says so. |
| 3 | Index contours: every fifth line heavier, so the eye reads elevation without numbers. | USGS topographic maps | The shader draws contours from `fract(height)` with a heavier index line every fifth interval, and the market page's depth chart uses dashed iso-depth lines at quarters of the deepest side. |
| 4 | Map margins carry the legend, scale and provenance. | Survey sheets, title blocks | A terrain legend sits in the hero margin with network and provenance badges; the footer is a ruled title block; page headers end in a measured rule with ticks every 24 and 120 px. |
| 5 | Cross sections and core samples explain strata better than area charts. | Geologic cross sections | Proof is drawn as core samples per market (BASELINE bed, with-STRATA bed). The scoring formula is a stratigraphic column with lithology patterns, bed thickness equal to weight. |
| 6 | Scroll paces a single camera move through a sequence of stops. | Stripe Sessions, Vercel Ship | Five survey stations. Each station tweens one shared camera state; the terrain erodes (thin books), receives deposits (agents), shows a fault (guards), turns to section (proof) and to plan view (join). |
| 7 | Instrument typography: a precise mono for readouts, small technical labels, tight grids. | Teenage Engineering | Martian Mono (narrowed on its width axis) for every value that updates and for coordinates; sentence-case labels, never all caps body labels. |
| 8 | Detail in the last 5 percent: registration marks, hairlines, magnetic targets. | rauno.me, Linear | Instrument panels carry corner registration ticks; primary calls to action lean toward a fine pointer; rank changes and digits roll instead of jumping. |

## 2. Identity

- **Name:** kept in one constant, `BRAND` in `packages/ui/src/brand.ts` (D22).
- **Wordmark:** unchanged geometry, original outlines with a horizontal seam cut through every letter (the stratum line). `<Wordmark />`, `packages/ui/assets/wordmark-*.svg`.
- **Studio line:** none; no company or team name (D41). "Built on Injective" plus an explicit "not affiliated with or endorsed by" line; no Injective logo.

## 3. Color

Dark is basalt: a warm mineral dark with a faint green-grey bias and chalk text. Light is survey paper: pale celadon map stock with iron-gall ink. One survey color, ochre, marks STRATA depth, active stations, focus and the primary hover. Bids are malachite, asks are oxide; both sit at the same lightness so neither side looks stronger.

| Role | Dark | Light | Use |
|---|---|---|---|
| bg | `#0D0F0E` | `#ECEEE7` | Canvas, and the terrain fog |
| bgRaised / surface | `#121513` / `#161917` | `#F7F8F3` / `#F7F8F3` | Panels, popovers |
| border / borderStrong | `#262B28` / `#373D39` | `#D2D6CB` / `#B5BBAE` | Hairlines, survey rules |
| fg / fgMuted / fgSubtle | `#ECE8DF` / `#B4AFA3` / `#8E897E` | `#141613` / `#474C45` / `#5A5F57` | Text tiers |
| accent (ochre) | `#E9A94B` | `#8A560E` | STRATA depth, survey marks. The only accent. |
| bid (malachite) | `#7CC9A0` | `#1D6A47` | Bids |
| ask (oxide) | `#EA8A6A` | `#A6432A` | Asks |
| warn (sulfur / olive) | `#E2D25E` | `#5A5F00` | Real warnings only, never network labels |
| halt | `#F0656E` | `#B0222F` | Halts, the fault line |
| baseline | `#9AA39C` | `#535B55` | BASELINE provenance data |

Network and TESTNET provenance badges are neutral with a small diamond (ochre on testnet), so the palette keeps one accent.

### WCAG AA contrast (computed by `contrastRatio`, enforced in tests)

Body text needs 4.5:1. Every text role passes on every surface in both themes.

#### Dark (basalt)

| Role | Hex | on bg (#0D0F0E) | on bgRaised (#121513) | on surface (#161917) | on surfaceHover (#1C201E) |
|---|---|---|---|---|---|
| fg | `#ECE8DF` | 15.73 | 15.03 | 14.49 | 13.47 |
| fgMuted | `#B4AFA3` | 8.79 | 8.40 | 8.10 | 7.53 |
| fgSubtle | `#8E897E` | 5.52 | 5.28 | 5.09 | 4.73 |
| accent | `#E9A94B` | 9.38 | 8.96 | 8.64 | 8.03 |
| bid | `#7CC9A0` | 9.82 | 9.38 | 9.04 | 8.41 |
| ask | `#EA8A6A` | 7.64 | 7.30 | 7.04 | 6.54 |
| warn | `#E2D25E` | 12.47 | 11.92 | 11.48 | 10.68 |
| halt | `#F0656E` | 6.22 | 5.95 | 5.73 | 5.33 |
| baseline | `#9AA39C` | 7.41 | 7.08 | 6.83 | 6.35 |

accentFg `#1C1205` on accent: 9.00. Focus ring `#F4C47A` on bg: 11.93.

#### Light (survey paper)

| Role | Hex | on bg (#ECEEE7) | on bgRaised (#F7F8F3) | on surface (#F7F8F3) | on surfaceHover (#E4E7DF) |
|---|---|---|---|---|---|
| fg | `#141613` | 15.56 | 17.05 | 17.05 | 14.55 |
| fgMuted | `#474C45` | 7.52 | 8.24 | 8.24 | 7.03 |
| fgSubtle | `#5A5F57` | 5.59 | 6.13 | 6.13 | 5.23 |
| accent | `#8A560E` | 5.25 | 5.76 | 5.76 | 4.91 |
| bid | `#1D6A47` | 5.60 | 6.14 | 6.14 | 5.24 |
| ask | `#A6432A` | 5.19 | 5.69 | 5.69 | 4.86 |
| warn | `#5A5F00` | 5.84 | 6.41 | 6.41 | 5.47 |
| halt | `#B0222F` | 5.76 | 6.31 | 6.31 | 5.39 |
| baseline | `#535B55` | 5.99 | 6.57 | 6.57 | 5.61 |

accentFg `#FFFFFF` on accent: 6.14. Focus ring `#8A560E` on bg: 5.25.

## 4. Type

All faces are SIL OFL 1.1, self-hosted by `next/font` (Latin subset, `font-display: swap`, metric-adjusted fallbacks). Definitions: `packages/ui/src/fonts.ts`. Banned as cliches for this project: Inter, Geist, Space Grotesk, Instrument Serif, Playfair, Poppins, DM Sans, Manrope.

| Role | Face | Notes |
|---|---|---|
| Display | Bricolage Grotesque | opsz 96, wdth 92, weight 480. Hero tracking -0.027em, leading 0.95. Ink-trap detail gives the headline a stamped, surveyed quality at size. Loaded by the marketing and app layouts, preloaded per route. |
| Text and UI | Schibsted Grotesk | Body 16/1.6, small 14/1.5, micro 12/1.4. A sturdy news grotesk that stays crisp at 13 px in tables. |
| Readouts | Martian Mono | `num` utility: wdth 87.5, tabular figures, slashed zero. `coord` utility for 11 px coordinates and axis labels. Not preloaded. |

Three pairings were tested on the hero with live numbers (Bricolage + Schibsted + Martian Mono; Fraunces + Familjen Grotesk + JetBrains Mono; Newsreader + Schibsted + IBM Plex Mono; Unbounded + Schibsted + Martian Mono). Bricolage won: Fraunces read as the high-contrast serif template, Newsreader as editorial rather than instrument, Unbounded too soft for a trading product.

Fluid scale (375 to 1440 px): display 44 to 112 px (hero 42 to 88 px), h1 34 to 60 px, h2 26 to 38 px, h3 20 px.

## 5. Texture, space, radius, motion

- **Texture:** hairline survey grid (`survey-grid` utility: 24 px minor, 120 px major lines, pure CSS), SVG turbulence grain (`grain` utility, a few hundred bytes inline), contour lines drawn in code (shader and SVG), lithology patterns as SVG `<pattern>`. No raster stock.
- **Instrument panels:** `instrument` utility, a 1 px box with registration ticks at two corners. `Panel` uses it on every data page.
- **Spacing:** 8 px scale (0, 8, 16, 24, 32, 40, 48, 64, 80, 96, 128, 160).
- **Radius:** xs 2, sm 3, md 4, lg 6, xl 10. Machined, not pillowy.
- **Motion:** UI 120 / 180 / 240 / 320 ms, scene 640 ms, ease-out `cubic-bezier(0.22, 1, 0.36, 1)`. Camera flights 2.1 s `power3.inOut`. Springs for interactive elements (stiffness 420, damping 38).
- **Libraries:** GSAP ScrollTrigger + SplitText + Lenis (landing scroll, title line reveals), anime.js v4 (SVG line drawing, number counters), Motion (`motion/mini` magnetic calls to action, leaderboard layout animations), CSS for the hero entrance and View Transitions on full page loads.
- **Reduced motion:** no WebGL (poster only), no Lenis, no ScrollTrigger, no camera flight, no line drawing or rolls; transitions collapse to near zero globally.

## 6. The survey terrain

- **Rendering:** procedural, in shader (`apps/web/components/three/terrain-shader.ts`). No glTF, no Blender asset, no decoder: the 3D chunk is three.js + R3F + about 9 KB of code. A plane of 260 x 168 segments (150 x 96 on phones) is displaced in the vertex stage.
- **Data mapping** (`buildTerrainField`, unit tested): up to six markets with depth, one ridge each. Height is square-root scaled against the deepest market. The ridge profile across the price axis (bids at negative x, asks at positive x, an empty valley at mid for the spread) is schematic, and the legend says so. STRATA share of depth glows along the crest in ochre. No data, or no depth anywhere, renders a flat survey with the caption "Flat survey: live depth not available yet".
- **Fragment stage:** contour lines from `fract(height * 13)` with `fwidth` antialiasing, index contour every fifth line, contour color tinted toward malachite on the bid side and oxide on the ask side, survey grid on the ground plane, derivative normals for lambert shading, rim light, exponential fog into the page color, edge fade. Glow is drawn in shader (no postprocessing pass).
- **Story uniforms:** `erode` (thin books), `deposit` (agents add depth near mid, illustration), `fault` (guard engaged: one side drops and the drift freezes), `plan` (top-down survey sheet). Each illustrative station states "Illustration, not market data" in its own caption.
- **Labels:** HTML labels projected from ridge positions every frame, shown only over the hero and only right of the copy column.
- **Runtime:** fixed stage behind the page; DPR capped at 1.75; a frame-rate monitor drops DPR on the second slow second and hands phones back to the poster under 45 fps; render loop stops when the tab is hidden or the reader has passed the story. The WebGL chunk loads on first interaction (or after 4.5 s on capable desktops), never during first paint.
- **Poster:** rendered from the real scene by `apps/web/scripts/capture-poster.mjs` (Playwright + ImageMagick): dark 17.9 KB AVIF / 28.3 KB WebP, light 8.9 KB / 12.7 KB. It is a CSS background, so only the active theme's image loads, and the legend reads "Still image of the survey terrain, not live data" until the live scene is up.

## 7. Landing structure

Fixed terrain stage; hero (headline, sub, two calls to action, instrument readout of live arena numbers with definitions, terrain legend); five stations with a sticky station rail: thin books (labeled illustration of a book ladder), the arena (score weights as a stratigraphic column), guards (oracle, session, risk), proof (core samples from `/v1/markets`: before/after when a closed BASELINE window and live STRATA depth exist, BASELINE cores with "With STRATA: not measured yet" otherwise), join (four survey benchmarks). Then the ecosystem line and the title-block footer.

## 8. Data pages

Same header and footer as the Landing. Survey grid ground with grain, fading down the sheet. Page headers end in a measured rule. Panels are instruments. Live numbers roll digit by digit (`NumberRoll`), leaderboard rows animate on rank change (Motion layout), the market page adds a contour depth chart above the ladder (`buildDepthProfile`, unit tested). Every number keeps its network and provenance badge; honest before/after labels come from `apps/web/lib/liquidity.ts`.

## 9. Budgets and results (local `next build && next start`, Nov 9, 2026)

- Landing first-load JS: 188 KB gzip (excluding the nomodule polyfill modern browsers skip and the lazy 3D chunk). Budget 200 KB.
- Lighthouse `/`: desktop 100 / 100 / 100 / 100, LCP 0.29 s, CLS 0.006; mobile 100 / 100 / 100 / 100, LCP 1.05 s, CLS 0. `/arena`: desktop and mobile performance 100, accessibility 100 after the loading-region fix.

## 10. Copy rules

Short, specific, sentence case. No em dashes, no hype words, no emoji. Every number on the page has a source, a network badge and a provenance badge, or an explicit empty state. Illustrations say they are illustrations.
