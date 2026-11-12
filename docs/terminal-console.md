# Terminal console (index.html)

`index.html` is no longer the lore landing page: it is a full-screen, in-browser terminal: the Hawkes
Biomedical gateway box, played straight and in-world (no disclaimers, no winks that it is not real). Everything is client-side, event-driven JS: **no network, no `eval`, no polling.** Timers only
chain the lines of one command's output, and any key flushes them. The game (`play/game.html`, Vite build), the other
site pages (`about`, `characters`, `lore`, `whatsnew`, `lore/*`), `site/marketing.*` and every game playtest are
unchanged.

**Player goal:** feel like a hacker who earned root: poke around, follow the backwards-hat breadcrumbs, crack in, then
watch `/build` assemble the whole medical backend. Reference: Hackers / Mr. Robot, Hacknet's first root.

## Where it lives and why

| Path | Role |
|---|---|
| `index.html` | Shell of the page (aria-live log, real `<input>`, tap bar, footer credits, Hawkes Analytics tags, the front-page playtest hand-off, now also listing `terminal` and `terminal-phone`). |
| `site/terminal/*.js` | Plain ES modules (no build): `util`, `parser`, `fs`, `content`, `puzzle`, `build`, `shell` (all commands), `complete`, `ui`, `main`, `terminal.css`. |
| `site/terminal/test/terminal.test.mjs` | Unit tests: `npm run test:terminal` (node's test runner). |
| `src/playtest/phPlaytest.ts` | Scenarios `terminal` and `terminal-phone` (the page in an overlay, real key and tap events). |

Why plain modules, not `src/`: GitHub Pages publishes the repo root as it is (`pages.yml` copies tracked files, then
`play/` is built). Vite only builds `game.html`, so a Vite-only page would 404 its script on Pages. Reused: the
Hawkes Analytics tags and `play/hawkes-build.js`, `site/hawkes-release.js`, the playtest hand-off block, the dev-host
`[data-play]` swap (same rule as `site/marketing.js`), the footer credits (`data-hawkes-credit`, `p.site-privacy`).
New: everything under `site/terminal/`. Caching headers are untouched.

## The puzzle chain (3 steps, strictly ordered, no password)

State machine: `puzzle.js`. A step completes only when every earlier step is done; a saved game with a gap keeps only
its unbroken prefix. Old five-step saves are mapped on load (`OLD_STEP_MAP` in `content.js`): hat -> hat, scan / loot /
crack -> scan, root -> root. Nobody finds, reads, cracks or types a password (J's call: "make it easier").

| # | Step id | Command (the `Next:` line) | Result |
|---|---|---|---|
| 1 | `hat` | `rev ~/.hat_backwards` | Names the host `gw.hawkes.lan`. |
| 2 | `scan` | `nmap gw.hawkes.lan` | Lists the open doors, ssh account ops. (Also completes step 1 if skipped.) |
| 3 | `root` | `ssh ops@gw.hawkes.lan` | **ACCESS GRANTED**, prompt `root@ph-origins:/#` turns red. |

`hint` / `/hint` runs every remaining step and grants root in one go. `su` and `login` to anyone, and `ssh` as any user
but ops, fail in-world; there is no password prompt anywhere. `curl` of the backup still works after the scan, as flavour
(no step). `john` and the wordlists are gone.

## Login guide (the path is signposted)

`GUIDE` / `STEPS` in `content.js` are the single source. Guest `/help` is the **LOGIN GUIDE** (`guideLines`:
`Step N of 3`, `Type:  <command>`, what it does) plus `hint`, `ls`, `cat`, `help all`. Root `/help` and `help` print
exactly `/build`; `help all` still lists everything. Every step's output ends with `Next: <command>` (`nextPointer`),
and Tab on an empty line completes the next command (`complete.js`). Root-only commands refuse until root. Banned in output: "simulation", "no real system",
"BACKWARDS (as expected)", "ground truth" (unit test).

## Commands

Bare or slash style (`/help` = `help`; `/etc/motd` stays a path). Aliases: `?`, `ll`, `la`, `l`, `cls`, `quit`, `more`,
`wget`, `play`, `crack`, `hashcrack`. Unknown: "did you mean". Tab completes commands and paths (and modules, themes).
Up/down history, Ctrl+L, Ctrl+C. A pipe works into `grep head tail wc sort rev cat`.

- Look around: `ls cd pwd cat less tree grep head tail wc sort echo`
- System: `whoami id uname hostname date ps top history clear exit`
- Network toys (all simulated): `ping nmap curl ssh strings rev su sudo`
- Console: `hint progress man theme sound about credits reset`; site: `game`/`play`, `open <page>` (about, characters,
  lore, whatsnew, lore/&lt;chapter&gt;), and `~/site/*.html` stubs
- Root only: `/build /status /services /logs /deploy /rollback /whoami --root` (guests: permission denied + `hint` nudge)
- Eggs: `sl cowsay fortune matrix`, `sudo make me a sandwich`, `rm -rf /`, `hack the planet`, Konami code at the prompt
  (works during boot; prints a joke and an achievement)

`theme green|amber|white`; `sound on|off` is a tiny WebAudio keyclick, off by default, the context is only created
after a key press.

## `/build`: a show in three acts

`build.js` is a pure function `runBuild({ seed, only, verbose })` returning timed events (no timers), so tests run it
with a seeded clock: resolve dependencies (a scripted TLS warning, auto-fixed), ten module stages each with compile and
test progress bars and counters (a second warning, a duplicate LOINC code, auto-fixed), integration suites, packaging,
then a summary table, build hash and the BUILD SUCCESSFUL banner. The result mounts `/opt/hawkes-biomedical/`
(`README.md`, `BUILD.txt`, `manifest.json`, `bin/`, `modules/<id>/`); `game` then notes "backend online". Fully
fictional: no PHI, no network, no real build. `/deploy` and `/rollback` ask `[y/N]` and do nothing real.
`/build status` reports; `/build <module>` builds one module the quiet way (about 5 s, no show).

A **full** `/build` is played by `show.js` (the shell marks the `seq` effect with `show`). Everything is client-side:
`requestAnimationFrame` only while the show runs, no fetches, no polling timers.

**The show cannot be skipped** (J, 2026-11-12). No key, click, tap, Escape or Ctrl+C ends it: there is no skip function in
`show.js`, the only listener on the show is the 44 px `sound: on/off` button (M also mutes), and `ui.js` swallows every
key while it plays, clears anything a soft keyboard or paste puts in the prompt (`input.readOnly` too), ignores taps and
the quick-key buttons, and prints nothing under the show. The prompt comes back, clean, only when the show ends. It ends
when `song.mp3` ends (the `ended` event), or on its own fixed timer when there is no song: `SILENT_SECONDS` (60 s) if the
file fails, errors, never loads in 15 s or autoplay is blocked, and a wall-clock cap of the song's length plus 30 s if it
stalls. `?songlen=N` (a test hook) shortens the song to N seconds.

1. **Log flood** (unchanged). `floodScript(events, seed)` (build.js) puts a burst of filler lines (`cc`, `LD`, `PASS`, `lint`,
   `sign`, `stage ... %`, across all ten modules) in front of every real event, about 5,000 lines. They play at
   `FLOOD_RATE` 1,600 lines a second, batched per frame (capped at 2,500 a frame), so over 300 lines show in the first
   3 s even on a slow frame rate. One `<pre>`, the visible rows only, one `textContent` write a frame.
2. **The song.** After the flood an `<audio>` plays `song.mp3` from the site root, resolved against `document.baseURI`
   (works under GitHub Pages). If the file is missing, errors, or `play()` is rejected, the show runs on its own clock for
   `SILENT_SECONDS` and the HUD prints `(song.mp3 not found, playing silent)` (also in the log afterwards), with no thrown
   error. The clock is the audio's `currentTime` (extrapolated between its updates). If the browser lets us (an audio
   context that is really running) an `AnalyserNode` taps the element and the equalizer follows the real spectrum;
   otherwise the beat clock drives it. It never wires the element into a suspended context, which would silence it.
3. **The dance.** One `<canvas id="showCanvas">`, redrawn every frame (the DOM is a handful of nodes, so a phone holds
   60 fps; if drawing takes over 12 ms the glow turns off and the canvas drops to 1x, over 24 ms it drops to 30 fps).
   Four modules, all plain data and pure functions with tests:
   - `dancers.js`: 17 hand-drawn ASCII frames for **Jackson** (stand, point, hat tip, four moonwalk frames, four spin
     frames, toe stand, the 45 degree lean (two), sparkle glove (two), freeze, hip) and 14 for **Jordan** (ready, dribble,
     crossover, drive, gather, jump shot, release, leap, dunk, hang time with the tongue out, land, shrug, Jumpman,
     pivot), 16 rows tall, plus the hoop and backboard in three wobble frames. `flip()` mirrors a frame (the jersey number
     keeps reading 23).
   - `banner.js`: a 4x5 block-letter font (A-Z, x, !). A banner is laid out letter by letter, on double-width pixels when
     the stage is wide enough (square pixels), single when not, wrapped to the stage width.
   - `choreo.js`: the beat clock (`BPM` 118, `BEAT_OFFSET` 0.31 s, both measured from the song with onset
     autocorrelation), `buildTimeline(duration)` and the scenes. The timeline stretches every scene in proportion to the
     song (258 s is 127 bars; the solos run their sequence again from the other side) and squeezes by priority for a short
     song (8 s keeps intro, Jackson, the outro...). Scene boundaries sit on bar lines.
   - `stage.js`: one frame into a grid of cells (character, colour, glow flag); `show.js` paints it. Banner pixels and the
     spotlight's shading are block characters that the painter draws as translucent or solid cell rectangles, the way a
     terminal does; everything else is ASCII text.

   Scenes (nominal bars at 118 BPM, about 2 s a bar): `intro` SHOWTIME (2, countdown, both walk on), `king` THE KING OF
   POP (4, Jackson solo under the banner), `jackson` (12: moonwalk glide, spin, toe stand, hat tip, 45 degree lean,
   sparkle glove wave, freeze), `air` AIR JORDAN (4), `jordan` (12: dribble crossover, jump shot with a SWISH, slam dunk
   with a leap across the screen to the backboard and hoop and a shaking rim, hang time with the tongue out, shrug),
   `mirror` (8: eight mirrored pairs of poses), `callresponse` (8: OW! / SWISH!), `battle` (8: the floor changes hands every
   two beats, a spotlight follows whoever has it, a score), `names` JACKSON x JORDAN (4), `finale` (6: a run to centre,
   the last pose together held for the last bar and a half, confetti), `outro` (4: the credits scroll, BUILD SUCCESSFUL).

   Text effects, all in time with the beat: a per-letter colour that cycles round the rainbow, a ripple that bounces a few
   letters on every beat and a white flash of the whole banner on the beat; a screen flash (a tint, at most 0.35 alpha, under
   3 Hz) and a shake on the beat and harder on a hit (the dunk, the freeze, the finale pose); falling sparkles and confetti
   characters; two sweeping spotlights; an equalizer row; two scrolling marquees; the stage floor, a row of tiles that
   step with the beat, with the dancers' reflections shimmering under it; speech bubbles; a caption naming the move; a
   credits-style outro.

   Layout: the text size is chosen so the stage is at least 46 columns by 34 rows (a 390 px phone gets 14 px text, 46
   columns; a laptop gets 18 px, 118 columns), so the figures keep their size and the choreography spreads around them.
   Left alone on a phone there is no horizontal scroll.

   `#termShow` carries `data-act` (flood, flip), `data-lines`, `data-frames`, `data-audio` (pending, playing, silent,
   ended), `data-scene`, `data-scenes` (distinct scenes drawn), `data-jframes` / `data-dframes` (distinct frames drawn per
   dancer), `data-flashes`, `data-shakes`, `data-beats`, `data-nl` / `data-nr` (marks in each dancer's current frame),
   `data-cols`, `data-rows`, `data-px` and `data-calm` for the playtest.

When the song ends the show hides and the real log prints at once (stages, bars, counters, table, banner) ending in BUILD
SUCCESSFUL, and `/opt/hawkes-biomedical` is there (the build is recorded when `/build` starts).

**Reduced motion** (`prefers-reduced-motion` or `?motion=off`): the calm version, also unskippable. No flood, no sound (as
before: `play song` plays it), a fixed `CALM_SECONDS` (48 s) timeline of the same scenes at 5 frames a second, no flash, no
shake, no falling confetti, no ripple, static marquees. The short normal log prints after it.

**Swapping in the real song.** Replace `song.mp3` at the repo root. The length is read from the file and the timeline
fits it. The tempo is `BPM` in choreo.js (118 for the song in the repo; `BEAT_OFFSET` is where the first beat falls).

**Test hooks.** `?songlen=8` ends the song after 8 s (the playtest does not wait four minutes). `?demo=show` starts the
show once the boot ends (the phone playtest looks at it this way). Neither is linked from anywhere.

## File tree (virtual)

`/home/guest` (README.txt, .hat_backwards, .plan, .bash_history, .achievements, notes/, loot/, site/ with page stubs
and `lore/`), `/home/ops`, `/root` (root only), `/etc` (motd, hosts, passwd, shadow and sudoers unreadable), `/srv/lore`
(board, Hawkes Biomedical, Apex Peak notes), `/usr/share/wordlists` (rockyou-lite, hawkes-staff), `/var/log`
(syslog, auth.log for ops, build.log for root), `/opt` (`.build-me`, then `hawkes-biomedical/` after a build).

## Canon

Names only from the public cast (Pierce Hawkes, Director Hale, Voss, Lang); no first names, nothing about B3, the vat
or the creature (public Hawkes surfaces never show them). Facts used: the 58th floor, Hawkes Biomedical, the board,
Zurich, the chapter titles, "Room for Grace".

## Looks and a11y

CRT phosphor (themes via CSS variables), scanlines and vignette as non-interactive overlays, blinking block cursor
(mirror span over a transparent real `<input>`, so keyboards, IME and paste work). Output is `role="log"
aria-live="polite"`; text is selectable; a tap anywhere refocuses the input unless text is selected. Reduced motion
(`prefers-reduced-motion`, or `?motion=off` for the playtest) prints the boot and build instantly, no flicker or blink.
Phone (390x844): `100dvh` plus `visualViewport` sizing when a keyboard is up, 15 px text, a tap row (help, ls, hint,
Tab, up, down, ^C, each 44 px, 8 px gap), no horizontal scroll (ASCII art hidden under 700 px, tables 36 columns).

## Checks

`npm run test:terminal` (parser, completion, filesystem permissions, puzzle order and hint monotonicity, no-root
without earlier steps, the whole documented chain, throttle, root commands, build determinism and timing, the flood, eggs) and `show.test.mjs` (the ASCII frames, the banner font, the timeline for songs from 3 s to 10 min, the choreography on phone and desktop grids, beat effects, the calm version, and a fake browser that proves no key, tap, soft-keyboard text or button ends the show).
Playtest `terminal` and `terminal-phone` (see `src/playtest/phPlaytest.ts`); Studio runs them, nobody starts a browser
by hand.

## Root-only login and the /build show (current)

- `root` is the only account that can be logged into. `su`/`login`/`ssh` to any other user (guest, admin, kali...) fail in-world; root is reached only through the three GUIDE steps (hat, scan, root), or `hint`. Root commands (`/build /status /deploy /logs /services /rollback`) refuse in one line that names the guide's next step.
- `/build`: log flood (1,600+ lines/s) -> `song.mp3` -> a choreographed hand-drawn ASCII dance for Jackson and Jordan on one canvas, synced to the song; it cannot be skipped. Screenshots: `docs/terminal-shots/`.
