## What was wrong
Studio discovers scenarios from the front-page hand-off in root `index.html` (`window.hawkesPlaytest.scenarios()`), not from `src/playtest/phPlaytest.ts`. Beta only listed `smoke`, so every `apex-slice` run skipped with `has no scenario "apex-slice". It has: smoke`. The slice itself (PR #143) was already on beta; discovery was the gap.

## What changed
Restored and rebased the known fix onto current beta (`1063b10`):
- **`index.html`**: Front-page contract lists all 37 game scenarios next to `smoke`, including `apex-slice`. `start()` rejects unknown ids. No `scenarioAliases` (not a rename).
- **`src/playtest/phPlaytest.ts`**: Sit-loop guard so the bot does not re-press Sit forever; desk-papers target cleared of the desk collider. Slice content (`apexSlice.ts`) untouched.
- **`.hawkes/scenario.txt`**: `apex-slice`.
- Rebased onto beta after #144/#146 (chapter-card sequence) landed; HEAD is `b04b7f8`. PR #145 already open (needs Studio re-push of the rebased tip).

## Checks
- Node parse of `index.html` `scenarios()`: 37 ids, includes `smoke` and `apex-slice`.
- `npm ci && npm run build` — passed (before and after rebase).
- Studio `apex-slice@local` `r_ec176ec1f1be`: started (not a discovery skip). Metrics reported: `quality.maxQuietSeconds` 10.6, `quality.textOnlyBeats` 0. That local runner played beta `e52b92c` (pre-Sit-guard), so the run ended `lost`; the Sit-loop fix in this PR is what beta will get after merge.
- Smoke `r_186109a1db2b`: done in 1 min 20 s (still runnable; 2 problems on current beta content, not a discovery skip).

## Reviewer
Discovery-only fix plus Sit-loop guard; no new player-facing content. Scope matches the brief. Verdict: merge once Studio re-pushes the rebased tip and beta playtest confirms no "has no scenario" skip.

## GPU
None ($0).
