## What was wrong
1. **`floating-object` in Level 1: The Apex Peak**: `levels/apex-peak.json` placed `asset-ceiling-troffer` (`ceiling-troffer.glb`) instances whose 8 cm tall dark-black (`0.12, 0.12, 0.13`) rectangular housings hung down below the white `IS.ACOUSTIC` ceiling grid. In Hall 1 (`fixture-light-h1-a`, `fixture-light-h1-b`, `fixture-light-h1-c`), the fixtures were also unrotated (`rotation.y: 0`), spanning crosswise across the narrow corridor, and `fixture-light-h1-c` at `z = 26` hung at the Hall 1 / Hall 2 junction where the east wall opens up. `ceil-hall-1` (`y: 3.25`) was also 1 cm lower than `ceil-hall-2` (`y: 3.26`).
2. **`ugly-building` in Level 1: The Apex Peak**: `pendantBar(k, 40.5, 48.0, 32, 2.55, 3.2)` in `src/game/interior/apexPlan.ts` and `src/game/interior/furniture.ts` drew a 7.5 m long flat black bar (`0.12, 0.12, 0.13`) suspended at `y = 2.55` (65 cm below the ceiling) on two 1.2 cm rods, with its emissive face only on the `-Y` bottom face (`0b100000`). From boardroom camera angles (`y = 2.15..2.6`), its unlit side and top faces read as a flat black plank cutting across the upper room. Additionally, a 10 cm gap at `z = 40.0..40.1` between the boardroom (`maxZ: 40.0`) and Pierce's office (`minZ: 40.1`) left an unsealed strip between the two rooms.

## What changed
- **`src/game/interior/furniture.ts`**: Added `troffer()` to build a flush recessed acoustic-ceiling light panel (`1.2 cm` thin light-silver bezel `IS.METAL 0.84, 0.84, 0.82` matching the `IS.ACOUSTIC` T-bar grid, and a warm glowing diffuser quad `IS.SOLID 1.0, 0.96, 0.88, 1.65` at `ceiling - 0.008`). Updated `pendantBar()` to place flush recessed `troffer` panels at `ceiling` instead of hanging a dark black bar at `y = 2.55`.
- **`src/game/interior/apexPlan.ts`**: Extended `hide` regex to `/^(trim-|carpet-|fixture-light-|bath-troffer|bath-jamb|bath-door|bath-handle|bath-plaque)/` so all bulky black `asset-ceiling-troffer` GLB cans are hidden when runtime interior dressing is active. Placed flush recessed `troffer` panels in Hall 1 (`z = 6, 15, 24`, `alongZ = true`), Hall 2 (`x = 12, 22, 31`), Restroom (`x = 18, z = 27.35, y = 3.136`), Boardroom (`pendantBar` at `y = 3.196`), and Pierce's Office (`x = 48, z = 43.5, y = 3.196`). Extended `office` room `minZ` from `40.1` to `40.0`.
- **`levels/apex-peak.json`**: Leveled `ceil-hall-1` `y` from `3.25` to `3.26` (`min.y = 3.20`, dressed quad at `3.196`), extended `floor-office` and `ceil-office` (`z: 43.36, scale.z: 6.72`) to close the 10 cm gap at `z = 40.0`, and aligned the underlying `fixture-light-h1-a/b/c` (`y: 3.1125`, `rotation.y: π/2`, `z: 6, 15, 24`) and `bath-troffer` (`y: 3.0525`) for the undressed Dev Tools view.

## Checks
- `npm test` (`check:scene`, `check:anim`, `check:leaks`) — all passed (`apex-peak: clean`, `scene audit: clean`, `models: clean`, `anim ok`, `leak check: flat`).
- `npm run build` (`tsc && vite build`) — passed.

## Reviewer (`studio:reviewer` & `studio:fun-reviewer` passes)
- **`reviewer` verdict: merge**
  - Directly resolves both reported visual bugs at the geometry/dressing source (`src/game/interior/furniture.ts:94-120`, `src/game/interior/apexPlan.ts:58-125`, `levels/apex-peak.json:83-206,1482-1540,3727`).
  - Narrow scope: no unrelated edits, no generated `play/` build artifacts committed, and `light-h2-b` (`PointLight` used by `apexSlice.ts` flicker) remains intact.
- **`fun-reviewer` verdict: living** (Full 4/5, Breathing 4/5, Interactions 4/5, Story as experience 5/5, Soul 4/5)
  - Removing the hovering black boxes in the hallways and the suspended black plank in the boardroom keeps the 58th-floor Hawkes Biomedical executive suite cohesive with `docs/world-bible.md`.

## GPU
None ($0).
