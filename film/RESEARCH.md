# Research: ten techniques this film uses

Timeboxed pass on 9 Nov 2026. Sources reviewed: Motionographer's breakdown of Apple's "Don't Blink" (type and rhythm), Abduzeedo on Mat Voyce's kinetic type with mass, motion-sound guides on hierarchy and sync, the measured craft notes in the HyperFrames skills (taken frame by frame from shipped launch films), and the owner's reference film (`Preflight-demo.mp4`, 181.5 s), watched as contact sheets every 3 s. Studio credits for Stripe Sessions and Linear launch films are not published, so those films were studied for what is on screen, not for who made them.

What the reference got right and what it lacked is in `BRIEF.md`. The ten techniques below are the ones STRATA takes, each with the exact place it is used.

| # | Technique | Where it comes from | Where STRATA uses it |
|---|---|---|---|
| 1 | **One statement per beat.** A short sentence carries a whole scene; type holds still once it lands and the camera or the world moves instead. | Apple event recaps ("Don't Blink"), Preflight | Every title: one line, max six words, one accent word in ochre or italic. Titles never drift after landing (`SPEC.md` MOTION). |
| 2 | **Animate the signified.** The motion acts out the word: "re-engineered" rebuilds itself. | Motionographer on "Don't Blink" | "canyon" opens the gap on the survey section; "narrows" closes it; "halts" freezes the drift; "flatten" flattens the position bar; "pulls every order" removes the ladder rungs one by one. |
| 3 | **Time as a character.** Build, then stop dead. The silence is the punchline. | "Don't Blink" (the AirPods stop) | The Oracle Guard halt: score drops to near silence for 0.6 s, everything freezes on one frame of B4, a single low thud, then the real `oracle_stale` line types in. Used once. |
| 4 | **Data is the hero, at survey scale.** The object on screen is the measurement itself, not a decoration of it. | Preflight's 28,771-seat galaxy; USGS survey sheets | 188 markets as a measured strip on survey paper, each tick a real market from the live sweep; the Blender terrain is the real NVDA BASELINE book; the ladder is the real BTC quotes. |
| 5 | **One giant real number at a time**, earned by a scene, then made physical. | Preflight ("256 / 256"), Stripe's data-first stage graphics | "3 of 188" (the payoff of the measurement scene), "105.7 bps" on the canyon, "58,999.81 s" on the stale oracle, "about 10 s" on the kill. Never two hero numbers in one frame. |
| 6 | **Real UI pushed full-bleed, never tilted, never small.** Establish the page, isolate the part at 1.6 to 2x, return to the page. | Linear and Vercel launch films (real product as hero), HyperFrames launch notes | The leaderboard, Verify my score, Blockscout epoch tx, Join wizard. Every capture is a 2x still; pushes stop at 2.0x so text stays sharp. Rebuilt panels copy capture text and values exactly. |
| 7 | **Worlds entered through an object.** Terrain, survey paper and product are three worlds; each cut is caused by something on screen. | Story craft in shipped launch films | Canyon cut face becomes the paper strip (colour flood); the ochre stratum becomes the wordmark seam (match cut); a merkle leaf becomes the tx hash on Blockscout (object becomes the world); the halt line becomes the night (B5). |
| 8 | **Kinetic type with mass.** Words settle with inertia, not a stock ease. Blur-in per word at 0.13 to 0.18 s, 70 to 90 ms apart; arrivals on long-tail eases, exits 40 to 50 percent shorter. | Abduzeedo on Voyce, HyperFrames motion craft | All titles and captions. `expo.out` arrivals, `power3.in` exits, `power2.inOut` camera. |
| 9 | **Sound hierarchy: voice, then a few exact accents, then the bed.** Every effect has a visible cause and peaks one frame after its picture. Rotate takes so no whoosh repeats. | Motion sound guides; HyperFrames sound notes | Voice at full level, score ducked under it with a carve; under ten accents in the whole film: data ticks on the strip, one thud on the halt, soft whooshes on the two camera dives, one rise into the reveal. |
| 10 | **Contrast speeds.** The process runs fast, the payoff plays at normal speed with a short hold before it. Something new every 2 to 4 s. | HyperFrames measured rhythm, Preflight pacing | The how-it-works flow steps every 3 to 4 s; holds of 0.4 to 0.7 s before "3 of 188", the wordmark, and the epoch root; the end card holds 3 s. |

Beyond the reference: transitions are varied on purpose (dive, colour flood, match cut, object becomes the world, whip, freeze), and no frame is a near-empty dark void: dark frames always carry terrain, a product screen at 1.6x or more, or a full-height type composition.

Sources:
- [Motionographer: 4 ways "Don't Blink" is a masterclass of type and rhythm](https://motionographer.com/2016/09/14/4-ways-dont-blink-is-a-masterclass-of-type-and-rhythm/)
- [Abduzeedo: Mat Voyce's Think Different, kinetic typography with mass](https://www.abduzeedo.com/mat-voyces-think-different-kinetic-typography-mass)
- [Cursa: Audio and final rhythm, using sound to support motion](https://cursa.app/en/page/audio-and-final-rhythm-using-sound-to-support-motion)
- [Overseer: sound hierarchy and removing sounds you cannot explain](https://www.overseeros.com/blog/youtube-sound-design)
- [Unison: ducking with sidechain compression](https://unison.audio/audio-ducking/)
- Owner's reference: `/Users/adwaitkeshari/Downloads/Preflight-demo.mp4` and its project `SPEC.md`, `KIT.md`.
