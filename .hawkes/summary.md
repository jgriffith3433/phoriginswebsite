## What was wrong
The world bible marks **The Apex Peak** as the first vertical-slice area. Halls were dressed but quiet between set pieces: no hall life, few optional interactions, and no playtest measuring the 10-second gap rule.

## What changed
- **`src/story/apexSlice.ts`** (level 1 only): night cleaner walks hall 2 (pauses mid-hall, greets when a Gen take exists, leaves a cart that settles later); hall practicals flicker; ambient SFX when the floor goes quiet; **Sit** / **Read papers** / **Tap screen**; quiet-gap log + `maxQuietSeconds` / `textOnlyBeats`.
- **`src/main.ts`**: mount/dispose/step/action/confirm/probe.
- Playtest **`apex-slice`**: walks the route, reports `quality.maxQuietSeconds`, `quality.textOnlyBeats`, `feel.coyoteMs`.
- Locale + sfx catalog; placeholder files + **soundFallback** until Gen takes land. Subtitles withheld until `audioText` is set (no text-only beats).
- Sofa on the office west wall (x 44.2, z 44.6). World bible + `AGENTS.md` updated.
- `.hawkes/scenario.txt`: `apex-slice`.

## Fun review
First pass **thin** (fake quiet marks, hardcoded textOnly). Fixed. Second pass **living**, do not block merge.

## Left / GPU
- Gen voice + apex SFX takes: Gen MCP had no project access this session. Placeholders play via fallbacks; Dev Tools → Generate (or `npm run audio:missing -- --only bark.apex.cleaner,bark.apex.papers,sfx.apex.sofa,...`) when Gen is up. Cents each, no GPU.
- Optional cart GLB (`prop` preset): Gen estimate blocked (no project access). Approve a small GPU budget later if a polished cart is wanted; procedural cart ships now.
- Bible leftover: sconce dip when the elevator moves.

## Checks
- `npm ci && npm run build` — passed.
