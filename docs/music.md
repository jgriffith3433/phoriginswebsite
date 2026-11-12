# Music director

One score under the game, on the music bus (`busInput(ctx, 'music')`, so Settings → Music and Sound off govern it).
Code: `src/game/musicDirector.ts`. Probe: `sound().music` (state, `stateLog`, `events`, `duckDepthDb`, `stems`, `streaming`).
Playtest: `music-director`.

## How it works

- **Key and tempo.** Every stem is D minor, 72 bpm, 12 bars = 40 s, ogg ~96 kbps, `assets/audio/music/ch<N>-<calm|tension|peak>.ogg`
  (registered in `locales/sfx.json`, group `music`). The three stems of a chapter start on the same audio-clock instant and
  run together; a state is only a gain on each (calm 1/0/0, tension .55/1/0, peak .3/.8/1).
- **Bar lines.** A change is scheduled on the audio clock at the next bar (3.33 s). A rise to peak, or any rise, takes the next
  beat (0.83 s) so the score answers inside a second.
- **Ducking.** Any voice line (spoken locale lines, cutscene and phone voice files) ducks the whole score −7 dB: 150 ms attack,
  600 ms release (`setVoiceHook` in `sfxMix.ts`, started and ended by the clip itself).
- **Events only.** Chapter start/end, objective change, cutscene start/end, creature distance, pursuit lead, Shadow mode, voice
  start/end. No timers. The creature and the train lead are read per frame but the director acts only when a band is crossed.
- **Phone.** The score starts on the existing Tap to play (shared AudioContext). On the low memory tier (`body[data-memory=low]`)
  stems stream from `<audio>` elements through the same graph instead of being decoded; on standard they are decoded buffers, freed on level change.
- **Missing files.** Until the stems are generated the director tracks state, ducks and logs as normal and the level's own bed plays.

## Creature bands (B3 hunt, `stepDread` in `act1.ts`)

| Distance | Band | Score |
|---|---|---|
| under 8 m (leaves above 10.5) | close | peak |
| under 16 m (leaves above 19) | near | tension |
| further, or no hunt | far | calm |

The train's old-body lead uses the same bands at 3 m and 8 m, driving the Station/Train rail percussion. Shadow mode lifts to at least tension.

## Chapters

| Ch | Calm | Tension | Peak | Deliberate silence |
|---|---|---|---|---|
| 1 Apex Peak | whole motif, sparse low piano | board plot, alarm | — | cutscene starts thin to calm |
| 2 B3 | motif, detuned hum | creature within 16 m | hunt pulse, creature within 8 m | cold open (no score), the vat break |
| 3 The Return | detuned motif | Hale's call | — | mirror look |
| 4 The Desk | detuned motif alone | the desk sweep | — | |
| 5 Going Home | street, soft kick | Shadow mode on | shock/possess | |
| 6 The Station | rail percussion | Shadow mode, commuters | pursuit | |
| 7 The Train | rail percussion | pursuit within 8 m | within 3 m | the stop with no name |
| 8 The Morning | near silence | — | — | the whole chapter; the motif once at the door objective |

Every chapter ends with `chapterEnd`: the score falls away for the ending song. The title card and Defeat stop it.

## Leitmotifs (theme layer)

Two looping layers sit beside the stems, through the same `mix` -> duck -> music bus, so Settings and voice ducking govern them.
All files are Hawkes Gen `audio.music` takes, looped with `audio.music-loop` and levelled with `audio.process` (music target).

| Layer | File | When |
|---|---|---|
| Pierce, human | `pierce-theme.ogg` (low solo piano and cello, 4-bar motif, ~90 s) | Chapter 1 whole, including the window monologue |
| Pierce, corrupted | `pierce-corrupt.ogg` (same motif, detuned piano, bowed metal, sub drone) | From the end of `b3-vat-break` in chapter 2, and every chapter 3-8 |
| Voss | `voss-motif.ogg` (muted strings) | In when a Voss call connects, out when it ends (`music.voss`, `phone.ts` `onConnected` / `onCallEnded`) |

The theme level follows the state (calm .7, tension .5, peak .3, silence 0). **Rot per chapter** (`ROT`): ch2 0, ch3 .15, ch4 .3,
ch5 .5, ch6 .7, ch7 .9, ch8 1. Rot lowers a low-pass from 7 kHz to 600 Hz, detunes the loop up to -120 cents and takes up to 45 % off its level,
so the instrumentation thins and darkens each chapter. On the low memory tier the layers stream and are not detuned.
Probe `sound().music.theme` / `.voss`. Playtest `music-director` checks variant per level.

**Deliberate silences (theme):** the B3 cold open and the vat break (no theme until the glass has gone), chapter 8 until the door objective, every chapter end for the ending song.

## The stingers (8, 4-8 s)

| Id | Fires | Where |
|---|---|---|
| `desk-papers` | first paper or the terminal leaves the desk | `theDesk.ts` |
| `lobby-scream` | the receptionist's scream clip starts | voice line `going-home/01-receptionist-scream` |
| `voss-last` | Voss's last line, `voss-morning-07` (and its alt takes) | voice line |

Stingers 1-5 below, plus the three above, are the eight.

## The first five stingers

| Id | Fires | Where |
|---|---|---|
| `vat-break` | 3.3 s into `b3-vat-break`, before the glass goes | `beginNamedCutscene` |
| `mirror` | "That's me. I'm not seeing things." starts | voice line `return-mirror/01-pierce-thats-me` |
| `is-that-me` | "Wait. Is that me?" on the platform | voice line `station-shadow/01-pierce-is-that-me` |
| `no-stop` | "This isn't a stop I know." | voice line `cutscenes/train/06-*` |
| `tv-news` | the TV switches to the morning programme | world event `tv-report` |

Each is logged as an `events` entry of kind `stinger`, and ducks under voice like the stems.

## Open

Stems are still not generated. Theme (90 s), corrupted theme (90 s), Voss motif (30 s) and the 8 stingers (6.5 s, faded) are in `assets/audio/music/` as Ogg Vorbis, made with Gen `audio.music`, looped with `audio.music-loop` and levelled with `audio.process`.
Beat checks the director cannot make itself: playtest B3 hunt rise within 1 s needs a hunt run.
