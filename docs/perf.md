# PH Origins — frame-time baselines

Measured by the `frame-trace` playtest scenario (`src/playtest/phPlaytest.ts`): each level is started with the playtest setup shortcut, the first second is grace, then a few seconds of real WASD play. Duration is **Babylon render work time** (`onBeforeRender` → `onAfterRender`), not the wall-clock gap between frames — a headless ~1 fps tab would otherwise look like every frame was a hitch. Hitches over 50 ms are tagged with a push cause (`shader-compile`, `asset-load`, `gc`, `level-setup`, `audio-decode`, or `unknown`). Frames during an open level-setup mark and the first second after reset do not count toward the 100 ms fail.

Probe: `hawkesPlaytest.state().frames` and `hawkesPlaytest.report().frameTrace` (`over50`, `over100`, `failOver100`, `worst[]` with `ms`, `cause`, `level`, `objective`).

Smoke scenarios `smoke-l1` … `smoke-l8` and `full` publish the same hitch metrics and fail when `hitchFailOver100 > 0`.

## How to refresh

```text
npm run dev
# desktop + phone sample of all eight levels:
open /game.html?playtest=frame-trace
# then in the console:
copy(JSON.stringify(hawkesPlaytest.report().frameTrace, null, 2))
```

Or Studio: playtest scenario `frame-trace` (product `ph-origins`), desktop and the phone step.

Replace the tables below with the run's `hitchL{n}WorstMs` / cause events and the phone variants.

## Desktop

| Level | Name | Worst hitch (ms) | Cause | Objective / note | Over 50 | Over 100 |
|---|---|---|---|---|---|---|
| 1 | The Apex Peak | — | — | pending `frame-trace` run | — | — |
| 2 | B3 | — | — | pending | — | — |
| 3 | The Return | — | — | pending | — | — |
| 4 | The Desk | — | — | pending | — | — |
| 5 | Going Home | — | — | pending | — | — |
| 6 | The Station | — | — | pending | — | — |
| 7 | The Train | — | — | pending | — | — |
| 8 | The Morning | — | — | pending | — | — |

## Phone (390×844 via `phoneFrame`)

| Level | Name | Worst hitch (ms) | Cause | Objective / note | Over 50 | Over 100 |
|---|---|---|---|---|---|---|
| 1 | The Apex Peak | — | — | pending `frame-trace` run | — | — |
| 2 | B3 | — | — | pending | — | — |
| 3 | The Return | — | — | pending | — | — |
| 4 | The Desk | — | — | pending | — | — |
| 5 | Going Home | — | — | pending | — | — |
| 6 | The Station | — | — | pending | — | — |
| 7 | The Train | — | — | pending | — | — |
| 8 | The Morning | — | — | pending | — | — |

## Notes

- Trace cost: one after-render callback, mark rings only on hitch or mark events. No `setInterval` sampler.
- Acceptance: normal play fps within 2 of the prior baseline; post-grace frames must stay under 100 ms outside level setup.
- First-use warm (`src/game/levelWarm.ts`) runs while the chapter card is up: **await** decode of level + cutscene + phone + apex/door extras (locale line ids resolved), upload textures, tick particle systems, instantiate pooled props once, force-compile leftover meshes (two passes for late avatars). Idle-chunked (`requestIdleCallback` / rAF). Marked `level-setup` so warm frames do not fail hitchFailOver100. Cap after the card: +1.5 s. Scenario `hitch-board` (and smoke's L1 board leg) resets the frame trace once Pierce can walk, then judges spawn→board (desktop ≤100 ms) and phone L1/4/8 (≤150 ms).
- Cold open (first visit, B3 hall): the same warm runs under **Tap to play** before control (`cold-warm`), including creature SFX decode, corridor + creature walk/attack shader pass, and fade variants. Cap after the tap: +1.5 s, then `stopLevelWarm`. Scenario `first-five` resets the frame trace once in control, publishes `hitchFailOver100` / `coldWarmMs`, and on phone checks no horizontal scroll and 44 px targets.

- Attempt 3 (what the wall-clock feel sensor still saw after #160): things built or loaded *after* the warm, at Start or on the first steps. Now under the card: Apex's night cleaner, guard, reader, cooler analyst and caller are awaited (`apex.ready()`, `apexLife.ready()`) before the shader pass; The Desk's mirror (render target) and papers (`desk.prepare()`) and The Morning's room, TV texture and materials (`morning.prepare()`) are built at level load, and `onStart` keeps them. Audio decode also covers the Apex board and staff barks, the touchables' sounds, The Desk's lines and radio, and The Morning's lines, news reads and place sounds; clips load four at a time (`PRELOAD_LANES`). The Apex city view no longer allocates three objects per frame.

- Attempt 4 (the wall-clock feel sensor still saw a 150 ms frame at Level 1's start and 133 ms mid-walk after #164): three named causes. (1) The chapter card's lit-canvas check drew the whole canvas into a 2D canvas and read it back (a full-frame GPU to CPU copy per check); it now reads forty 4x4 patches with `engine.readPixels` and only a frame that reads dark gets the old whole-canvas check (`worldLitShare` in `main.ts`). (2) The camera's occlusion fader lowers `mesh.visibility`, which makes the material compile an `ALPHABLEND` variant the first time a wall or door frame fades; the warm now compiles that variant for every fade candidate (`warmFadeVariants` in `levelWarm.ts`). (3) Cutscene timelines for Level 1 (`room-for-grace`, `apex-window`, `apex-terminal`, `elevator-b3`) are parsed into the cutscene cache under the card (`loadCutsceneTimeline`), so the board scene starts with no fetch. The phone's per-frame avatar mesh walk no longer allocates an array each frame (`syncExcluded`). Not covered yet: the office terminal's security feed (creature GLB, render target and a point light) is still built when the window monologue ends.

