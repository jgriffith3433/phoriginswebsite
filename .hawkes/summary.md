## What was wrong
Studio discovers scenarios from the front-page hand-off in root `index.html` (`window.hawkesPlaytest.scenarios()`), not from `src/playtest/phPlaytest.ts`. Beta only listed `smoke`, so every `apex-slice` run skipped with `has no scenario "apex-slice". It has: smoke`. The slice itself (PR #143) was already on beta; discovery was the gap.

## What changed
Restored and rebased the known fix onto current beta (`1063b10`):
- **`index.html`**: Front-page contract lists all 37 game scenarios next to `smoke`, including `apex-slice`. `start()` rejects unknown ids. No `scenarioAliases` (not a rename).
- **`src/playtest/phPlaytest.ts`**: Sit-loop guard so the bot does not re-press Sit forever; desk-papers target cleared of the desk collider. Slice content (`apexSlice.ts`) untouched.
- **`.hawkes/scenario.txt`**: restored to `apex-slice` (beta rebase had overwritten it with the chapter-card scenario `transition`).
- Rebased onto beta after #144/#146 landed. Tip is `df2f57f` (discovery commit `b04b7f8` + scenario restore). PR #145 is open and needs Studio to re-push this tip (rewrote `94d31f7`).

## Checks
- Node parse of `index.html` `scenarios()`: 37 ids, includes `smoke` and `apex-slice`.
- `npm ci && npm run build` — passed (before and after rebase).
- Studio `apex-slice@local` `r_ec176ec1f1be`: started (not a discovery skip). Metrics reported: `quality.maxQuietSeconds` 10.6, `quality.textOnlyBeats` 0. That local runner played beta `e52b92c` (pre-Sit-guard), so the run ended `lost`; the Sit-loop fix in this PR is what beta will get after merge.
- Smoke `r_186109a1db2b`: done in 1 min 20 s (still runnable; 2 problems on current beta content, not a discovery skip).

## Reviewer (studio:reviewer pass)
Verdict: **merge** (after Studio re-pushes the rebased tip).
- Criteria: `index.html` scenarios array includes `apex-slice` next to `smoke` (front-page discovery); game still metrics `quality.maxQuietSeconds` / `quality.textOnlyBeats`; smoke@local still completes.
- Scope: only the discovery hand-off, Sit-loop guard, and `.hawkes` scenario/docs — no slice content redo, no CI/deploy/secrets.
- Cause: Studio reads `/` not `phPlaytest.ts`; listing only in the game was the skip. Sit-loop was a real follow-on so the gated run can finish.
- Playtest caveat: Studio `where=local` still drove published beta for these runs; discovery on beta is what merges unlock.

## GPU
None ($0).
