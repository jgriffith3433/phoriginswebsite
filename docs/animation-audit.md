# Locomotion audit (Pierce and the Shadow form)

`docs/animation-audit.md` did not exist when this pass began; this is the baseline and the fixes.

## What was already in place (#220)
Foot IK on stairs and slopes (`footIk.ts`), clip speed matched to the root's smoothed ground speed (`stride.ts`
`strideRatio`, `playerAvatar.setStride`), 0.1 s clip blends, StartWalk/Stop/Turn90/Turn180/StairsUp picked by `locoState`.

## Gaps found
- Full-stick walk is 3.05 m/s over a 1.72 m/s walk clip: the walk loop ran at 1.77x, outside the 0.6-1.45x band. Only
  Shadow Shift picked the run clip.
- No per-frame measure of slide or pose pops; `footSlide` only reports plant drift.

## Changes
- `stride.ts` `RUN_ON_MPS` 2.5 / `RUN_OFF_MPS` 2.1; `playerAvatar.ts` `updateSpeedRun` swaps walk to run by real ground
  speed with hysteresis (clips stay 0.6x-1.45x for speeds 1.0-5 m/s). 40 percent stick (~1.2 m/s) is walk at 0.71x.
  Below ~1.0 m/s the ratio falls under 0.6 (no slower clip exists; clips are not rebuilt), down to the 0.25 floor.
- `main.ts` `probe.locoAudit('start'|'stop')`: per frame, a **slide frame** is a walking clip whose speed
  (`STRIDE_MPS x rate`) is off the root speed by over 30 percent, or a walk clip with the stick released while still
  moving over 0.6 m/s; a **pop frame** is a foot jumping across the body (body frame) more than `4.5 dt + 0.12` m in
  one frame while moving, `turnPop` counting those while the body yaws.
- Scenario `pierce-loco-60` (`{"phone":true}` for the touch stick at 390x844): levels 1-8, walk, stop, 180 turn, then a 40
  percent stick leg; fails on any slide or pop frame. Idle breathing uses the looping Idle clip, which keeps its phase
  (no restart on stop) because `playLoop` only restarts from a walk.

## Not measured here
The audit could not be run in this pass (no browser). Baseline numbers come from beta's first run of `pierce-loco-60`.

## Prop contact: seated poses (seat anchors)
`docs/animation-audit.md` had no prop-contact results when this pass began, so the measure was added (`seatAnchor.ts`).
- **Seat anchor** (`src/game/seatAnchor.ts`): each seated person has a seat top from the prop's real top (`SEAT_TOPS`:
  office chair 0.50, train bench 0.45 from `trainDress` `SEAT_TOP`) and the rig is lifted by `seatLift(top)` so SitIdle's
  hips joint sits `SEAT_HIPS_RISE` (0.15 m) above it. The old shared `SIT_LIFT` was only right for 0.50 m.
- **Sit-down / get-up**: `createSeatBlend` eases the pelvis over 0.9 s with the clip change (no snap). Board departure
  now gets up that way before walking; a possessed or panicking train rider stands first. The rigs have no baked
  sit-down/stand-up clips (only SitIdle / SitTalk), so the ease is procedural until Mixamo ones are baked.
- **Train riders without an aisle spot now sit** on the nearest bench span (they stood through the bench before).
- **Probe** `seats()` and scenario `seat-contact` (levels 1 and 7, option `phone`): fail when hips are over 3 cm off.
- Not done: the Morning bed (`stepSleep`), Apex sofa Sit, the Desk, the Station benches and Pierce's own board seat
  still use their own heights; the Level 6 bed is change c_3f0739676f2a's.
