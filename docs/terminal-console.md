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

1. **Log flood.** `floodScript(events, seed)` (build.js) puts a burst of filler lines (`cc`, `LD`, `PASS`, `lint`,
   `sign`, `stage ... %`, across all ten modules) in front of every real event, about 5,000 lines. They play at
   `FLOOD_RATE` 1,600 lines a second, batched per frame (capped at 2,500 a frame), so over 300 lines show in the first
   3 s even on a slow frame rate. The DOM stays cheap: one `<pre>`, the visible rows only, one `textContent` write a
   frame. The stages, progress bars, test counters and the two auto-fixed warnings are in the stream.
2. **The song.** After the flood an `<audio>` plays `song.mp3` from the site root, resolved against `document.baseURI`
   (works under GitHub Pages). If the file is missing, errors, or `play()` is rejected, the animation runs on its own
   clock and the HUD prints `(song.mp3 not found, playing silent)` (also in the log afterwards), with no thrown error.
   The code never assumes the length: it reads `audio.currentTime` and `audio.duration`, and ends on `ended`.
   Silent runs stop after 30 s. **M** or the 44 px `sound: on/off` button mutes; **Esc**, **Ctrl+C**, any other key or a
   tap anywhere else stops song and animation.
3. **The text flipbook.** `flipbook.js` is data plus a rasteriser. Two articulated skeletons (torso, head, two arms,
   two legs, tapered capsules, a tilted fedora on the dancer, a ball and jersey/shorts on the player) are posed from 8
   key poses each (dancer: point up, hat tip, moonwalk, spin, toe stand, the lean, arms wide, hat brim crouch; player:
   dribble crouch, drive, the Jumpman leap, dunk, fadeaway, landing, triple threat, pivot), eased between every 2 beats
   at 112 BPM, with a small bounce on each beat, and rasterised to a character grid (cell aspect measured, each figure
   fitted to its own half, so a 390x844 phone shows both side by side). The mask is filled with the scrolling build log
   (a space inside a silhouette shows a dot, so the shape has no holes); the same text sits behind it, dim. A frame is
   flipped at 16 fps; the beat comes from the audio clock when there is audio. Silhouettes only: poses, hat, jersey
   outline, no faces. Left figure `#flipL` (bright), right figure `#flipR` (amber), overlay `#termShow`, which carries
   `data-act` (flood, flip), `data-lines`, `data-frames`, `data-audio` (pending, playing, silent, ended), `data-nl` and
   `data-nr` (cells in each half) for the playtest. Text is 10 px on a phone, up to 14 px on a wide screen.

When the song ends, or on any skip, the show hides and the real log prints at once (stages, bars, counters, table,
banner) ending in BUILD SUCCESSFUL, and `/opt/hawkes-biomedical` is there (the build is recorded when `/build` starts).

**Reduced motion** (`prefers-reduced-motion` or `?motion=off`): no flood, no flipbook, no autoplay. The short normal log
prints, then one still frame of both silhouettes (`staticFrame`) and `play song`. The `song` command (also `play song`,
`song stop`) plays `song.mp3` alone.

**Swapping in the real song.** Replace `song.mp3` at the repo root; nothing else changes (the length is read from the
file). The one in the repo is a **placeholder**: 240 s, mono, 22.05 kHz, 64 kbps (about 1.9 MB), a synthesised 112 BPM
A-minor groove from `tools/genPlaceholderSong.mjs` (then `ffmpeg -i song.wav -ac 1 -ar 22050 -b:a 64k song.mp3`). GitHub
Pages publishes the repo root, so `/song.mp3` is served from the site root with the other root files; Vite builds only
`game.html`. The flipbook beat is 112 BPM (`BPM` in flipbook.js); change it to the real song's tempo.

**Test hooks.** `?songlen=8` ends the song after 8 s (the playtest does not wait four minutes). `?demo=show` starts the
show once the boot ends (the phone playtest looks at the flipbook this way). Neither is linked from anywhere.

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
without earlier steps, the whole documented chain, throttle, root commands, build determinism and timing, the flood, the rasteriser (a left and a right blob in every pose on 40x20, 80x24, 40x60, left centre left of right centre, frames differ in small steps), eggs).
Playtest `terminal` and `terminal-phone` (see `src/playtest/phPlaytest.ts`); Studio runs them, nobody starts a browser
by hand.

## Root-only login and the /build show (current)

- `root` is the only account that can be logged into. `su`/`login`/`ssh` to any other user (guest, admin, kali...) fail in-world; root is reached only through the three GUIDE steps (hat, scan, root), or `hint`. Root commands (`/build /status /deploy /logs /services /rollback`) refuse in one line that names the guide's next step.
- `/build`: log flood (1,600+ lines/s) -> `song.mp3` -> flipbook at 16 fps: Michael Jackson silhouette (fedora, glove, moonwalk/lean/spin) on the left, Michael Jordan (Jumpman leap, dunk at a hoop, crossover) on the right, dense glyph fill, tight crop on a portrait phone. Screenshots: `docs/terminal-shots/`.
