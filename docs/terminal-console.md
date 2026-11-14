# Terminal console (index.html)

`index.html` is no longer the lore landing page: it is a full-screen, in-browser terminal: the Hawkes
Biomedical gateway box, played straight and in-world (no disclaimers, no winks that it is not real). Everything is client-side, event-driven JS: **no network, no `eval`, no polling.** Timers only
chain the lines of one command's output, and any key flushes them. The game (`play/game.html`, Vite build), the other
site pages (`about`, `characters`, `lore`, `whatsnew`, `lore/*`), `site/marketing.*` and every game playtest are
unchanged.

**Player goal:** feel like a hacker who earned root: poke around, follow the backwards-hat breadcrumbs, crack in, then
patch into LUNA-1 with `/feed`: the first live camera on the Moon, pointed at the Earth. Reference: Hackers / Mr. Robot, Hacknet's first root.

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
exactly `/feed`; `help all` still lists everything. Every step's output ends with `Next: <command>` (`nextPointer`),
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
- Root only: `/feed /status /services /logs /deploy /rollback /whoami --root` (guests: permission denied + `hint` nudge)
- Eggs: `sl cowsay fortune matrix`, `sudo make me a sandwich`, `rm -rf /`, `hack the planet`, Konami code at the prompt
  (works during boot; prints a joke and an achievement)

`theme green|amber|white`; `sound on|off` is a tiny WebAudio keyclick, off by default, the context is only created
after a key press.

## `/feed`: the first live camera on the Moon

Jaycee, 2026-11-13: "Change /build cmd to /feed. Remove the song, make it a crt style video feed of the earth from
PHOrigins." The song, its files and the three-act show (`show.js`, `dancers.js`, `banner.js`, `choreo.js`, `stage.js`,
`song.mp3`) are gone. `/build` stays as a hidden redirect: it prints that it was renamed and opens the feed.

`/feed` (root) brings the backend online the first time (`runBuild` is still the pure record of it, so
`/opt/hawkes-biomedical/` mounts as before), prints the patch-in lines (`connectScript` in `lunar.js`: camera, relay,
range and light time, site, how much of the Earth is lit, how to get back), then `ui.js` calls `openFeed` and `feed.js`
covers the console with one canvas.

- **The sky is real.** `lunar.js` (pure, tested against known dates) works out where the Sun and the Moon are at this
  minute (Astronomical Almanac low-precision formulas), so the Earth on the feed is lit and phased the way it is from
  the Moon right now, with the sub-camera point turning under it. Full Earth at a new Moon, dark at a full Moon.
- **The picture.** Raw WebGL1, two passes. Pass 1 draws the scene into a video-sized framebuffer (960 px on the long
  side): the Earth from NASA day, night-lights, cloud and water maps (`assets/feed/`, public domain, sources in
  `SOURCES.md`, fetched only when the feed opens), with sunglint on water, cloud shadows, city lights on the night side,
  a terminator band, limb haze and the thin air glow; the lunar horizon in front (a perspective height field with
  craters and rocks, lit by the same Sun); the burned-in OSD (camera id, LIVE dot, REC clock, a UTC stamp one light-time
  behind the wall clock, sub-camera point, range, delay and signal numbers). Pass 2 is the CRT: barrel curve, rounded
  corners, roll and a tear band now and then, line jitter, chromatic fringe, bloom, scanlines, aperture grille, grain,
  hum bar, flicker and vignette.
- **Closing.** Esc, q, Ctrl+C or the 44 px `disconnect` button (focused on open). Every other key, typed text and taps are
  kept from the prompt. On close the log prints how long it ran and how far the Earth turned; the GL context is
  released. No audio anywhere.
- **Phones and slow machines.** The layout (`feedLayout`) keeps the whole Earth and the horizon on screen in portrait and
  landscape, the bar sits inside the safe areas, and the OSD drops to short lines under 560 x 480. A slow device (frames
  over 24 ms) drops to 30 fps, a lower monitor resolution and a 640 px video. Reduced motion is 2 fps with no roll,
  tear or flicker. No WebGL: one still drawn on the CPU from the day map, with CSS scanlines.
- `#termFeed` carries `data-state`, `data-frames`, `data-mode` (webgl or 2d), `data-textures`, `data-lit`,
  `data-subcam`, `data-slow` and `data-calm` for the playtest.

**Test hooks.** `?feedlen=8` closes the feed by itself after 8 s; `?demo=feed` opens it once the boot ends (the phone
playtest). Neither is linked from anywhere. Gen video was not needed: it is all drawn in code.

## File tree (virtual)

`/home/guest` (README.txt, .hat_backwards, .plan, .bash_history, .achievements, notes/, loot/, site/ with page stubs
and `lore/`), `/home/ops`, `/root` (root only), `/etc` (motd, hosts, passwd, shadow and sudoers unreadable), `/srv/lore`
(board, Hawkes Biomedical, Apex Peak notes), `/usr/share/wordlists` (rockyou-lite, hawkes-staff), `/var/log`
(syslog, auth.log for ops, build.log for root), `/opt` (`.feed-me`, then `hawkes-biomedical/` after the first `/feed`).

## Canon

Names only from the public cast (Pierce Hawkes, Director Hale, Voss, Lang); no first names, nothing about B3, the vat
or the creature (public Hawkes surfaces never show them). Facts used: the 58th floor, Hawkes Biomedical, the board,
Zurich, the chapter titles, "Room for Grace".

## Looks and a11y

CRT phosphor (themes via CSS variables), scanlines and vignette as non-interactive overlays, blinking block cursor
(mirror span over a transparent real `<input>`, so keyboards, IME and paste work). Output is `role="log"
aria-live="polite"`; text is selectable; a tap anywhere refocuses the input unless text is selected. Reduced motion
(`prefers-reduced-motion`, or `?motion=off` for the playtest) prints the boot instantly, no flicker or blink.
Phone (390x844): `100dvh` plus `visualViewport` sizing when a keyboard is up, 15 px text, a tap row (help, ls, hint,
Tab, up, down, ^C, each 44 px, 8 px gap), no horizontal scroll (ASCII art hidden under 700 px, tables 36 columns).

## Checks

`npm run test:terminal` (parser, completion, filesystem permissions, puzzle order and hint monotonicity, no-root
without earlier steps, the whole documented chain, throttle, root commands, build determinism, eggs) and `feed.test.mjs`
(the Sun and Moon against known dates, the OSD and patch-in text, the layout on phone and desktop sizes, the textures and
their sources, `/feed` and the `/build` redirect with no audio, and a fake browser that runs the 2D feed and proves keys
and typed text never reach the prompt while Esc and q close it).
Playtest `terminal` and `terminal-phone` (see `src/playtest/phPlaytest.ts`); Studio runs them, nobody starts a browser
by hand.

## Root-only login and /feed (current)

- `root` is the only account that can be logged into. `su`/`login`/`ssh` to any other user (guest, admin, kali...) fail in-world; root is reached only through the three GUIDE steps (hat, scan, root), or `hint`. Root commands (`/feed /status /deploy /logs /services /rollback`) refuse in one line that names the guide's next step.
- `/feed`: the LUNA-1 camera's CRT feed of the Earth, lit as it is right now. `/build` redirects to it. No song.
