# PH Origins — camera baselines

Detector: `src/playtest/cameraWatch.ts`, run per frame from `onAfterRenderObservable` (push only, no polling). Scenarios `explore-cam-l1` … `explore-cam-l8` start the level with the setup shortcut, then walk A* routes on the real walk grid to wall-hugging spots, doorways and corners, turning with the look drag and backing into corners.

Counts per run (metrics `cameraInside`, `cameraNear`, `cameraBlocked`, `cameraNearWall`, `cameraSnaps`, `cameraJitter`, `cameraMaxCoverage`):
- inside: lens inside a collider; near: lens within 0.25 m of geometry
- blocked: solid between Pierce's eye and the lens
- nearWall: 5x5 ray fan with 50% or more stopping within 0.5 m
- snaps: yaw or pitch change over 30 degrees in one frame; jitter: turn direction flipping four frames running
Cutscenes, menus, scripted scenes and Pierce moving over 3 m in a frame are not judged. The worst five frames keep a screenshot (`camera-screenshot` events, `report().cameraWatch`).

## Baseline

Not measured yet: no browser was run when this was written. The first beta run of each scenario fills this table.

| Level | inside | near | blocked | nearWall | snaps | jitter |
|---|---|---|---|---|---|---|
| 1 The Apex Peak | – | – | – | – | – | – |
| 2 B3 | – | – | – | – | – | – |
| 3 The Return | – | – | – | – | – | – |
| 4 The Desk | – | – | – | – | – | – |
| 5 Going Home | – | – | – | – | – | – |
| 6 The Station | – | – | – | – | – | – |
| 7 The Train | – | – | – | – | – | – |
| 8 The Morning | – | – | – | – | – | – |
