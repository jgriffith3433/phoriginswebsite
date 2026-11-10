# Merge beta: summary conflict only

## What was wrong
Studio restart-looped during the earlier conflict pass on this branch. The chapter-card → fade-in work was already correct and is on beta as #151 (`83df5d3` / c_91f7227e8e71): Start routes through `startAtLevel`, follow camera snaps behind Pierce before reveal, the card holds until world luma ≥ 0.03 after snap + 2 frames, 0.6 s crossfade, HUD/pause only after the fade, `transition` playtest for levels 1–8 on desktop and 844×390.

## What changed
- Merged `origin/beta` into this task branch.
- Sole conflict: modify/delete on `.hawkes/summary.md` (this branch kept the level-start + beta-build note; beta's go-live had deleted the file). Kept both intents: the level-start transition note from this change, and beta's #151 / warm / floating-object work already in the tree.
- Did **not** redo the chapter-card → fade-in code.

## Checks
- `npm ci && npm run build` (re-run after the merge).

## GPU
None needed.
