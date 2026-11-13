# QA gate: `full-run`

One scenario plays PH Origins from the first chapter card to the credits and fails with **level, run time and reason**.
It is the scenario the milestone playtest runs (`.hawkes/scenario.txt`), once on desktop and once at 390x844 touch
(`options.phone`, or any viewport 500 px wide or less: the page is laid out as a phone and every press is a tap on the
touch controls or a stick drag; keys become taps through `TOUCH_KEY` in `phPlaytest.ts`).

## What it does

`full-run` (src/playtest/phPlaytest.ts) presses Start on level 1, plays levels 1-8 with `playLevel` / `trainStoryRun` /
`morningRun` (the same code as `full` and `smoke-l1..8`), presses Continue on each card, and ends at The Morning's
credits. **Skip is never pressed**: `press()` refuses any Skip in this scenario, so every cutscene and scripted scene
plays to its end.

## What fails it

Every failure is a row `{check, level, levelName, at (s), reason}`; the first three below also stop the run.

| check | fails when |
|---|---|
| `stuck` (stops) | no progress for 45 s (new objective/phase, scene, call, card, line, or 3 m moved) |
| `cutscene-end` (stops) | a timeline or scripted scene runs past 1.25x its length + 8 s (scripted scenes: 150 s) |
| `voice-never-ends` (stops) | one voice line sounds for over 45 s (`sound().voiceNow`) |
| `cutscene-start` | a walk-up press (Join meeting, Look outside, Examine monitor, Ride Elevator, Look in mirror, End Level on 1/3/5/6) shows no cutscene within 3 s |
| `camera-inside`, `camera-jitter` | cameraWatch sees the lens inside or behind geometry, or the turn flips four frames running |
| `anim-foot-slide`, `anim-glide`, `anim-jump-pose`, `anim-walk-in-place` | the existing animation trace (rule 5), a planted foot over 3 cm per level, or a scene's walk clip with no movement |
| `anim-tpose`, `anim-pop` | no clip while Pierce is under control for 1.5 s; the clip flips 6 times in a second |
| `voice-overlap`, `voice-cut` | a voice clip began under another, or was stopped early (phone callers stopped by a chosen reply are by design) |
| `console-error` | `console.error`, an uncaught error or an unhandled rejection |

## The report

At the end: events `gate-fail` (each row), `gate-row` (one per level: PASS/FAIL, seconds, rows), `gate-table` (the text
table, also the run's note), metrics `gateFailures`, `gateL<n>Seconds`, `gate.<check>`, `cameraInside`, `cameraJitter`,
and the frame-trace hitch metrics. The run's outcome is `won` only with zero rows.

## Adding a new level

1. Add the level as the playable rows in `levels/level-library.json` and `FALLBACK_LIBRARY` (see AGENTS.md "New level"), plus
   `LEVELS` / `LEVEL_NAMES` in `phPlaytest.ts`.
2. Give it a run: `playLevel(n)` handles marker-walkable levels (its objective must show a marker and end on End Level);
   a story level that is not marker-walkable gets a `<name>Run(arrived)` like `trainStoryRun` / `morningRun`, with
   `arrived = true` meaning "Continue already started it". Never press Skip in it: call `press(probe.skipButton, 'Skip')`
   only as the old runs do (the gate refuses it).
3. In the `full-run` branch change `levelsTotal`, the loop bound (`n <= 8`) and the `n === ...` dispatch, and
   `checks`/`LEVEL_NAMES` if you add a check.
4. If a walk-up button starts a cutscene, add its label to `CUT_PRESS` so its 3 s start is checked.
5. Budget: a new timeline's `duration` is the budget (x1.25 + 8 s); a scripted scene without a timeline file gets
   `SCRIPTED_LIMIT` (150 s). Raise the scenario's `seconds` (now 3000) if the level adds minutes.
6. Run `full-run` on desktop and with `{"phone":true}`; fix the rows it reports, don't loosen a check. A true exception
   (a deliberate fast camera cut) calls `hawkesPlaytest.cut()` / `cw.cut()` where it happens.

Check that the gate bites: make any cutscene voice never end (a clip that is never decoded to its end) and `full-run`
stops with `voice-never-ends` / `cutscene-end` naming that level.
