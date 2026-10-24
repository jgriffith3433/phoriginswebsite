**What was wrong:** the Level 7 (The Train) Gaussian splats seen through the windows were blurry. Opaque surface splats (tunnel wall, tiles, station) were wider than their grid spacing, so neighbours smeared together.

**Changed:** `tools/genTrainSplats.mjs` now scales opaque splats (alpha >= 128) by 0.68. Faint glow halos keep their size. I regenerated `assets/splats/train-{tunnel,station,car}.splat` with that script (same counts and layout).

**Checked:** `npx tsc --noEmit` passes and the generator runs. I did not look at it in a browser (none allowed here), so how it looks is unchecked. Please ask for a playtest of level 7 (`?beat=` train) to judge it. If it is too sparse or speckly, change `SHARPEN` (0.68) and rerun `node tools/genTrainSplats.mjs`.
