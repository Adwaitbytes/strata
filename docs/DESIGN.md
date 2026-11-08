# STRATA design system

Owner: W8. Concept: **Liquidity as terrain** (PRD 12.1). The order book is drawn as geological layers of light: each market is a stratum, and the depth STRATA agents add is a brighter layer on top of it. Calm, precise, data first.

Source of truth for every value below is code: `packages/ui/src/tokens.ts` (typed), mirrored in `packages/ui/src/theme.css` (CSS variables + Tailwind v4 `@theme`). `packages/ui/src/tokens.test.ts` fails if the two drift or if any text pair drops below WCAG AA.

## 1. Research: five patterns adopted (PRD 12.10)

References reviewed Nov 9, 2026: Linear, Vercel, Stripe Sessions, Hyperliquid, and recent Awwwards fintech and Web3 entries. Nothing was copied: no assets, logos, layouts or copy.

| # | Pattern seen | Where | How STRATA uses it |
|---|---|---|---|
| 1 | One focal object per hero, product truth over decoration. Linear leads with real product UI, not illustration. | Linear | The hero object is a data view: layer thickness is live `/v1/stats` depth. With no data it shows a labeled neutral state instead of a pretty fake. |
| 2 | Live figures sit directly under the headline, and placeholders are honest when data is missing. Hyperliquid shows dashes until values load. | Hyperliquid | Stat strip under the hero: four cells, each with a definition popover, source, network and provenance badge. Missing values read "Not live yet" or "Not measured yet", never zero. |
| 3 | Numbers inside sentences and short, verb-led sections rather than metric-card grids. | Vercel, Linear | Story scenes lead with a two-line claim and a plain paragraph; the only numbers in the story are the published score weights and the BASELINE comparison from the API. |
| 4 | A single orchestrated motion moment, with scroll used to pace a narrative instead of animating every block. | Stripe Sessions, Awwwards SOTD fintech entries | One hero entrance (headline layers settle, 3D cross-fades in). The scroll story uses a sticky "core sample" rail whose active layer thickens, plus SVG line drawing; content itself does not fade-slide. |
| 5 | Hairline structure and restrained color: grids made of 1px dividers, one accent reserved for the brand's core idea. | Linear, Vercel | Cells and guard cards are separated by 1px gaps on a border-colored ground. Aqua-teal appears only where liquidity is meant: STRATA layers in the 3D object and "with agents" bars. The primary button is ink on paper (fg on bg), and the rail, guard icons and score fills use neutral tones. |

## 2. Identity

- **Name:** kept in one constant, `BRAND` in `packages/ui/src/brand.ts` (D22). Metadata, header, footer and OG all read it.
- **Wordmark:** original geometry, outlined from Archivo (SIL OFL 1.1) at width 125 and then modified: both A forms are open peaks (no crossbar), and a horizontal **seam** cuts every letter at 60 to 66.5 percent of cap height. The seam is the stratum line of the identity. Component: `<Wordmark />`; static files: `packages/ui/assets/wordmark-dark.svg`, `wordmark-light.svg`.
- **Monogram:** the seamed S, used for favicon and avatar slots. `<Monogram />`, `packages/ui/assets/icon.svg` (ink tile, accent glyph).
- **Studio line:** Aarambh Labs only (D14). Ecosystem strip says "Built on Injective" plus an explicit "not affiliated with or endorsed by" line; no Injective logo is used.

## 3. Color

Dark is the default and the design reference. Light is a full palette (data-theme="light"), checked to the same bar.

| Role | Dark | Light | Use |
|---|---|---|---|
| bg | `#07080B` | `#F4F6F9` | Page canvas (ink / cool paper) |
| bgRaised / surface | `#0D0F14` / `#11141A` | `#FFFFFF` / `#FFFFFF` | Panels, popovers |
| border / borderStrong | `#1F242D` / `#2D343F` | `#DFE3EA` / `#C6CDD7` | Hairlines |
| fg / fgMuted / fgSubtle | `#ECEEF2` / `#A6AEBC` / `#808A9B` | `#0A0C10` / `#434B59` / `#5A6373` | Text tiers |
| accent | `#3EE6D4` | `#006E66` | Liquidity. The only accent. |
| bid | `#5CD69A` | `#11713F` | Bids, soft green |
| ask | `#FF8170` | `#B83525` | Asks, coral |
| warn | `#F2B544` | `#875500` | Warnings, amber |
| halt | `#FF5C66` | `#B81D2A` | Halts, red |
| baseline | `#8C95A8` | `#576074` | BASELINE provenance data |

### WCAG AA contrast (computed by `contrastRatio`, enforced in tests)

Body text needs 4.5:1. Every text role passes on every surface in both themes.

#### Dark

| Role | Hex | on bg (#07080B) | on bgRaised (#0D0F14) | on surface (#11141A) | on surfaceHover (#171B23) |
|---|---|---|---|---|---|
| fg | `#ECEEF2` | 17.24 | 16.50 | 15.87 | 14.85 |
| fgMuted | `#A6AEBC` | 8.97 | 8.58 | 8.26 | 7.72 |
| fgSubtle | `#808A9B` | 5.75 | 5.50 | 5.29 | 4.95 |
| accent | `#3EE6D4` | 12.85 | 12.30 | 11.83 | 11.07 |
| bid | `#5CD69A` | 11.01 | 10.53 | 10.13 | 9.48 |
| ask | `#FF8170` | 8.23 | 7.87 | 7.57 | 7.09 |
| warn | `#F2B544` | 10.94 | 10.47 | 10.07 | 9.42 |
| halt | `#FF5C66` | 6.65 | 6.37 | 6.12 | 5.73 |
| baseline | `#8C95A8` | 6.66 | 6.37 | 6.13 | 5.73 |

accentFg `#04201D` on accent: 10.96. Focus ring `#7FF0E3` on bg: 14.76.

#### Light

| Role | Hex | on bg (#F4F6F9) | on bgRaised (#FFFFFF) | on surface (#FFFFFF) | on surfaceHover (#F0F2F6) |
|---|---|---|---|---|---|
| fg | `#0A0C10` | 18.08 | 19.57 | 19.57 | 17.46 |
| fgMuted | `#434B59` | 8.12 | 8.79 | 8.79 | 7.84 |
| fgSubtle | `#5A6373` | 5.59 | 6.06 | 6.06 | 5.40 |
| accent | `#006E66` | 5.67 | 6.14 | 6.14 | 5.47 |
| bid | `#11713F` | 5.61 | 6.07 | 6.07 | 5.42 |
| ask | `#B83525` | 5.43 | 5.88 | 5.88 | 5.24 |
| warn | `#875500` | 5.83 | 6.31 | 6.31 | 5.63 |
| halt | `#B81D2A` | 5.97 | 6.47 | 6.47 | 5.77 |
| baseline | `#576074` | 5.82 | 6.31 | 6.31 | 5.63 |

accentFg `#FFFFFF` on accent: 6.14. Focus ring `#006E66` on bg: 5.67.

## 4. Type

All faces are SIL OFL 1.1, self-hosted by `next/font` (Latin subset, `font-display: swap`, metric-adjusted fallbacks). Definitions: `packages/ui/src/fonts.ts`.

| Role | Face | Notes |
|---|---|---|
| UI | Geist | Body 16/1.6, small 14/1.5, micro 12/1.4 |
| Display | Archivo, variable width axis | Hero at `wdth` 120, weight 460, tracking -0.032em, leading 0.98; section titles `wdth` 108. Same cut the wordmark was drawn from, so headline and logo read as one family. Loaded only in the marketing layout. |
| Numbers | Geist Mono | `num` utility: tabular figures and slashed zero everywhere a value updates |

Fluid scale (375 to 1440px): display 44 to 104px (hero capped at 72px), h1 34 to 56px, h2 26 to 36px, h3 20px. Line length stays under about 70 characters.

## 5. Space, radius, depth, motion

- **Spacing:** 8px scale (0, 8, 16, 24, 32, 40, 48, 64, 80, 96, 128, 160). Tailwind's 4px base stays; layouts use even steps only.
- **Grid:** 12 columns at 1280px max, gutters 16 to 48px fluid. Landing hero is a 1.08fr / 1fr split.
- **Radius:** xs 4, sm 6, md 10, lg 14, xl 20. Smaller radii on dense data, larger on marketing panels.
- **Shadows:** layered (hairline top highlight, tight contact shadow, soft ambient), separate sets for dark and light; `shadow-accent` for the primary button hover.
- **Motion:** durations 120 / 180 / 240 / 320 ms for UI, 640 ms for scene changes; ease-out `cubic-bezier(0.22, 1, 0.36, 1)`. Springs for interactive elements in app pages (Motion, stiffness 420, damping 38).
- **Reduced motion:** no WebGL (poster only), no Lenis, no ScrollTrigger, no line drawing, no number roll; transitions collapse to near zero globally.

## 6. The 3D hero

- **Authoring:** `infra/blender/strata_hero.py`, run headless with Blender 5.2.1 (`blender -b -P infra/blender/strata_hero.py`). Seven slabs with a superellipse footprint and deterministic Perlin terrain on the top face, each at unit thickness so the web scales Y only. Glass material (Principled BSDF, transmission, coat) exported in the glb. The same script renders the poster with EEVEE (transparent background) and encodes WebP and AVIF.
- **Assets:** `apps/web/public/models/strata_hero.glb` 70.2 KB (Draco, no textures, so no KTX2 step), Draco decoder wasm 192.4 KB + wrapper 58.5 KB (self-hosted, CSP friendly), poster 31.5 KB WebP / 21.0 KB AVIF. Total 373.6 KB, under the 1.5 MB budget.
- **Data mapping** (`buildStrataLayout`, unit tested): up to six markets by depth; thickness grows with the square root of `depthUsd25`, and the `strataDepthUsd25` share rides on top as an accent slab. No data, or no depth, shows seven equal neutral slabs with the caption "Neutral state: live depth not available yet".
- **Runtime:** R3F + drei + postprocessing (bloom; depth of field on desktop dark only). DPR capped at 1.75, `PerformanceMonitor` drops DPR and effects under 45 fps; on screens under 768px a sustained drop hands back to the poster. Render loop stops when off-screen or the tab is hidden. The WebGL chunk loads on first interaction (or after 4.5 s on capable desktops), never during first paint.

## 7. Landing structure

Hero (headline, sub, CTAs, live stat strip, strata object) then a five-scene scroll story with a sticky rail: thin books (labeled illustration), the arena (published score weights), guards (oracle, session, risk), proof (BASELINE vs now from `/v1/markets`, empty state when no window has closed), join (four steps). Then "Built on Injective", then footer with docs, GitHub, contracts on Blockscout (via Transparency), status, terms and risk disclosure.

## 8. Copy rules

Short, specific, sentence case. No em dashes, no hype words, no emoji. Every number on the page has a source, a network badge and a provenance badge, or an explicit empty state.
