# PH Origins — interior camera

## Design

The follow camera is driven by **authored volumes** on each level (`cameraVolumes` in the level JSON), not by stacking
clearance patches. Each volume picks a profile; the live pose blends over about **0.4 s** with damping.

| Profile | Boom | FOV | Framing |
|---|---|---|---|
| `open` | 5.6 m | 0.9 rad (~52°) | Current open-room boom |
| `hallway` | 2.85 m | 1.15 rad (~66°, in 60–75°) | Shorter boom, over-shoulder toward the open side |
| `doorway` | 3.35 m | 1.05 rad | Brief lift and centred while crossing a threshold |

Idle look settles back behind Pierce after about **2 s** (`idleRecenterDelay`). While walking, recentre is sooner
(~0.45 s); a squeezed boom at a corner still swings immediately.

**Occlusion fade:** discrete door GLBs and props on the eye→lens line fade to about **25%** via **mesh visibility**
(never shared `material.alpha`). The merged `interior-dress` kit is one mesh for a whole floor — it is not faded
(hallway boom framing owns plaster walls). The boom treats a faded mesh as see-through. **Boom collision and a light
near-plane shove are last resort only** — do not grow `clearancePush` reach again (that was the forbidden shortcut).

Volumes are authored from room bounds (Apex, B3, Station, Train, Morning). Doorway slabs sit on thresholds and win on
priority. Going Home stays on the open profile outdoors; occluder fade still runs on props.

Runtime: `src/game/cameraVolumes.ts`, `src/game/thirdPersonCamera.ts`. Probe: `camera()` → `{ profile, faded, volumes }`.

## Detector

`src/playtest/cameraWatch.ts`, run per frame from `onAfterRenderObservable` (push only, no polling). Scenarios
`explore-cam-l1` … `explore-cam-l8` start the level with the setup shortcut, then walk A* routes on the real walk grid
to wall-hugging spots, doorways and corners, turning with the look drag and backing into corners. They are listed on
the front-page playtest contract (`index.html`) and tagged `smoke` so Studio can schedule them (without that list,
beta skips with "has no scenario").

`interior-cam` walks Level 1 halls (hallway profile + fade) and Level 8's apartment on desktop and at 844×390.

Daily beta still plays `smoke` only. Smoke ends with a short Level 1 hall wall-hug under the same detector so a
smoke-only run still reports `cameraInside` / `cameraBlocked` / `cameraSnaps` and attaches worst-frame screenshots.

Counts per run (metrics `cameraInside`, `cameraNear`, `cameraBlocked`, `cameraNearWall`, `cameraSnaps`, `cameraJitter`,
`cameraMaxCoverage`, plus `cameraFadedPeak`, `cameraHallwayFrames`):
- inside: lens inside a collider; near: lens within 0.25 m of geometry
- blocked: solid between Pierce's eye and the lens (**faded occluders do not count**)
- nearWall: 5x5 ray fan with 50% or more stopping within 0.5 m
- snaps: yaw or pitch change over 30 degrees in one frame; jitter: turn direction flipping four frames running

Cutscenes, menus, scripted scenes and Pierce moving over 3 m in a frame are not judged. The worst five frames keep a
screenshot (`camera-screenshot` events, `report().cameraWatch`).

## Baseline

Patch-era estimates (clearance-stack camera, before volumes). Acceptance: explore-cam `cameraInside` and
`cameraBlocked` on every level must be **≤ 10%** of these (a 90% drop). Replace with measured beta numbers when the
pre-volume builds are gone.

| Level | inside | near | blocked | nearWall | snaps | jitter |
|---|---|---|---|---|---|---|
| 1 The Apex Peak | 120 | 200 | 280 | 160 | 8 | 4 |
| 2 B3 | 100 | 180 | 240 | 140 | 8 | 4 |
| 3 The Return | 110 | 190 | 260 | 150 | 8 | 4 |
| 4 The Desk | 100 | 180 | 240 | 140 | 8 | 4 |
| 5 Going Home | 40 | 80 | 60 | 50 | 6 | 3 |
| 6 The Station | 80 | 140 | 180 | 100 | 6 | 3 |
| 7 The Train | 60 | 100 | 120 | 80 | 6 | 3 |
| 8 The Morning | 50 | 90 | 100 | 70 | 4 | 2 |
