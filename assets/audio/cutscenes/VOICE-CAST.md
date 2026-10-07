# Cutscene voice cast (ElevenLabs)

All spoken `prompt`s are the cutscene line only. Model: `eleven_multilingual_v2`. One take per line (`generations_count: 1`). Library search used `voice_category: professional`, `languages: ['en']`.

Skipped (not speech): ambience, alarm, hum, beep, doors, rumble.

| Character | Voice name | voice_id | Why | Files |
|---|---|---|---|---|
| **Pierce Hawkes** | Jackson (generation metadata: Peter) | `ZthjuvLPty3kTMaNKVKb` | Male professional, confident/serious/deep American narrator. Same voice for board pitch, window monologue, terminal B3 reaction, and elevator “B3.” | `room-for-grace/01-pierce-appreciate.wav`, `02-pierce-dominance.wav`, `03-pierce-comfortable.wav`, `05-pierce-ceiling.wav`, `07-pierce-patients.wav`, `09-pierce-zurich.wav`, `10-pierce-dismiss.wav`, `11-pierce-grace.wav`; `apex-window/01-pierce-file-out.wav` through `07-pierce-interrupted.wav`; `apex-terminal/01-pierce-b3-screen.wav`; `elevator-b3/01-pierce-b3.wav`, `02-pierce-doors.wav`, `03-pierce-monitor.wav`, `04-pierce-creature.wav`, `05-pierce-dominance.wav`, `06-pierce-writing.wav`, `07-pierce-tape.wav`, `08-pierce-lights.wav` |
| **Director Hale** | Annie K - Calm, Grounded Narrator | `XW70ikSsadUbinwLMZ5w` | Professional female English: steady, clear, corporate. Recast because Hale is a woman on screen; previous W. L. Oxley was male. Board risk/valuation, not a swap of Voss’s old id. | `room-for-grace/04-hale-b3.wav` |
| **Voss** | David Castlemore - Newsreader and Educator | `XjLkpWUlnhS8i7gGz3lZ` | Professional male English: middle-aged American newsreader, formal/serious. Recast because Voss is a man on screen; previous Alexandra was female. Distinct from Pierce Jackson `ZthjuvLPty3kTMaNKVKb` and Lang Hugh `2UMI2FME0FFUFMlUoRER`; not a swap of Hale’s old id. | `room-for-grace/06-voss-ethics.wav` |
| **Lang** | Hugh – Natural Conversational Agent | `2UMI2FME0FFUFMlUoRER` | British middle-aged male, calm authority. Third board voice for Zurich/timeline. | `room-for-grace/08-lang-timeline.wav` |

No unnamed speakers. All `line` events had named speakers.

Paths match `cutscenes/*.json` `audio` fields under `/assets/audio/cutscenes/...`. Game loader is `HTMLAudio` (`src/game/cutscenes.ts` `playFile`); wav is used as specified.
