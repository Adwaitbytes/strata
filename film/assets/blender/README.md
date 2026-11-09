# Blender shots (B1 to B7)

Rendered in Blender 5.2.1 (EEVEE, AgX Medium High Contrast, 1920x1080, 30 fps) from the
scripts in `infra/blender/film/`. Every shot is a 1920x1080 PNG sequence in its own folder
(gitignored), an H.264 proxy `<id>.mp4` (committed) and one still `<id>.png` for layout
(local only, PNGs here are gitignored). No text is rendered into any frame.

## The data

- **Market:** NVDA/USDC PERP, Injective mainnet, market id
  `0xb9d9202c588e860382c96aee096f9655fce339f6b51833a939a37d2437080c17`.
- **Provenance:** BASELINE (read-only order book recordings, Neon table `book_snapshots`).
- **Window:** 2026-11-08 18:48:25 UTC to 20:47:45 UTC (1,361 snapshots, every 5 s), the longest
  continuous stretch of the recording (the recorder then paused until 2026-11-09 08:20 UTC).
- **Grid:** `film/assets/data/heightfield_nvda.json`, 239 time bins of 30 s x 181 price bins of
  4 bps (-360 to +360 bps from mid). Each cell is the cumulative resting depth in USD from mid
  out to that distance, averaged over the snapshots in the bin. Exported by
  `infra/blender/film/export_heightfield.py`.
- **Why NVDA:** of the 12 recorded RWA markets it is the only book with a real shape over time.
  XAU held two static quotes for the whole window, USTECH, US500 and SICI were empty, and the
  FX books had one side only. NVDA has a $500 bid bank, a $49,113 ask wall that comes and goes
  (present in 38% of bins), a median spread of 105.7 bps, and a real widening at the end of the
  window (about 150 bps at 20:15 UTC, 450.9 bps at 20:39:25 UTC).

### Mapping into the land

- X: 10 bps of price distance per metre, bids at negative X, asks at positive X.
- Y: 60 s of recording time per metre (the window is 119.5 m long).
- Z: sqrt(cumulative depth USD), scaled so $49,122 (the deepest cell) is 7 m. The spread has
  no depth, so it is a real canyon; the $500 bid bank stands 0.7 m, the ask wall 7 m.
- Rendering only (not data): Gaussian smoothing of 2 cells in price and 2 bins in time, a low
  talus apron at cliff feet, ledges on steep slopes (flat ground keeps its exact data height),
  edges eroded by a domain warp (at most 0.55 m in price, about 5 bps; at most 2 m in time,
  about 2 minutes, 1.4 m at the 99th percentile), 0.1 m of rock texture, and
  scenery hills well outside the window. Past both ends of the window the land fades to a plain.
- Contour lines are drawn every 0.32 m of height, with an index line every fifth.

### Illustrations (label them on screen)

- **Deposits (B3, B6):** STRATA depth added to the real land as resting USD on both sides of mid:
  $3,000 at 44 bps, $6,000 at 34 bps, $10,000 at 25 bps, then $5,000 at 15 bps (ochre, the STRATA
  stratum). The surface is the recomputed sqrt(cumulative depth), so the canyon narrows the way
  a deeper book would. Amounts are illustrative, not measured.
- **Fault (B4)** and **night (B5)** are illustrations of a guard halt and a session close over
  the real land.
- **Merkle tree (B7)** has the real shape of testnet season 1 epoch 0 (three leaves); the
  crystals are art.

## Shots

| ID | Frames | Duration | Proxy |
|---|---|---|---|
| `b1_terrain_open` | 240 | 8.0 s | `b1_terrain_open/b1_terrain_open.mp4` |
| `b2_canyon_cut` | 210 | 7.0 s | `b2_canyon_cut/b2_canyon_cut.mp4` |
| `b3_strata_rise` | 270 | 9.0 s | `b3_strata_rise/b3_strata_rise.mp4` |
| `b4_fault_halt` | 150 | 5.0 s | `b4_fault_halt/b4_fault_halt.mp4` |
| `b5_night_close` | 180 | 6.0 s | `b5_night_close/b5_night_close.mp4` |
| `b6_golden_wide` | 300 | 10.0 s | `b6_golden_wide/b6_golden_wide.mp4` |
| `b7_merkle_root` | 180 | 6.0 s | `b7_merkle_root/b7_merkle_root.mp4` |

### B1 `terrain_open` (8 s)
A slow dusk glide forward in time along the canyon, 18:48 to about 19:50 UTC of the window. The
low bank on the left is the bids, the stepped mesas on the right are the $49,113 ask wall where
it stood on the book, the dark floor between them is the spread. Sky is clear in the upper
third for "NVDA/USDC perp, Injective mainnet, 8 Nov, BASELINE". Data: the full heightfield.

### B2 `canyon_cut` (7 s)
Starts high over the intact land, then the land splits at 2026-11-08 19:30:25 UTC: the near half
slides back and sinks while the camera drops into the gap and ends square to the cut face. The
cut face is the real depth profile at that moment: bids left ($500, malachite tinted beds), the
canyon (107.3 bps spread), asks right ($49,113, oxide tinted beds). Upper 40 percent is sky for
labels. Data: row 84 of the heightfield and the land beyond it.

### B3 `strata_rise` (9 s)
The same cut, seen from above and in front. Four deposits condense out of the air and drop onto
the land one by one (frames 54, 102, 150, 204), each landing hard and settling. Each is paler
than the old basalt and has a dark parting at its base, so the section reads as layers. The
canyon narrows from a 107 bps gap to a stepped V; the last layer is the ochre STRATA stratum,
which glows faintly along both crests and in the section. Data: real land; deposits illustrative.

### B4 `fault_halt` (5 s)
Low over the land near 20:20 UTC, dust drifting in the evening air. A halt red hairline races
across the land and up through the ask wall (frames 34 to 56), the far side drops 0.8 m (56 to
61), and from frame 61 nothing moves: camera, dust and the grit kicked up along the fault all
hold still to the end. Data: real land; fault illustrative.

### B5 `night_close` (6 s)
Looking forward in time to the end of the window, where the real spread widened (about 150 bps
at 20:15 UTC to 450.9 bps at 20:39:25 UTC), so the canyon opens up ahead. The sun sets, the sky
goes to night and the survey contours come up as the light on the land. Data: real land; the
light change is illustrative.

### B6 `golden_wide` (10 s)
The whole land after the deposits, at golden hour, on a slow 12 degree orbit. The narrowed canyon
runs away as a gilded line, the stepped ask mesas take the low side light, and the upper third is
clear sky for the end title. Data: real land with the B3 deposits (illustrative).

### B7 `merkle_root` (6 s)
Three leaf crystals (one per scored agent in testnet season 1 epoch 0, 19:22 to 20:22 UTC) rise
from the bid bank; leaves 1 and 2 grow filaments to a node, leaf 3 is promoted unchanged, and the
node and leaf 3 join in the ochre root (`0x117a7ecd...6ada77`, posted in tx
`0xc7133de93833b909c81a1a51aa452ff58d96c46f5c8011b1e23d79db205d9d0a`). Data: tree shape from
Neon `scores` and `packages/sdk/src/merkle.ts`; the land behind is the BASELINE heightfield.

## Re-render

```bash
python3 infra/blender/film/export_heightfield.py --ticker "NVDA/USDC PERP"   # read-only SQL
infra/blender/film/render_shot.sh b1_terrain_open 150                          # frames + proxy + still
blender -b -P infra/blender/film/shot_b3_strata_rise.py -- --mode still --frame 240 --res 50
```
