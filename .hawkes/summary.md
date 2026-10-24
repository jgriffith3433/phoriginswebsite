**Task:** raise the PH Origins main menu (title card) to Dose Of Destruction's polish bar, in its own look.

**What I did** (first part, all CSS/data, no GPU):
- `game.html`: new scoped `.message` block. Cold pharma glass panel with a thin gold top edge, light-weight tracked uppercase title with a drawn rule, gold eyebrow line, stacked full-width action buttons (gold primary, steel-glass secondaries), hover / focus-visible / pressed states, Mission Select rows restyled to match. Atmosphere: a faint floor-grid drifting behind the card and a slow fluorescent light sweep, plus a vignette. Animated entrance (panel rises, children stagger). Phones: full-width card, 50px buttons; short landscape: two-column buttons. `prefers-reduced-motion` turns the motion off.
- `src/game/menuNav.ts` (new, wired in `main.ts`): arrows / W / S and gamepad (d-pad, stick, A confirm, B closes Mission Select) move focus; Start is focused when it becomes ready; soft synthesized tick on hover, keyboard focus and press, through the effects bus (so Settings applies).
- `locales/en.json`: `ui.menu.eyebrow` "Hawkes Biomedical · One night". No B3, vat or creature in the copy.
- Button ids, the `PH Origins` title text and `startBtn` are untouched, so the playtest contract (`phPlaytest.ts` presses `startBtn`) is unchanged. Pause and Settings cards keep their old look.

**Checked:** `npx tsc --noEmit` passes; `vite build` compiles (I reverted the `play/` output it touched). Not viewed in a browser (none allowed here): please ask for a playtest at desktop and phone sizes to judge the look.

**Left for later:** other menu labels (Start, Reset, Load Level, Settings) are still hard-coded in `game.html`/`main.ts`, not in locales; a real UI sound (generated) instead of the synthesized tick; matching the Tap to play screen and Pause/Settings cards. No GPU needed for any of it, so no estimate.
