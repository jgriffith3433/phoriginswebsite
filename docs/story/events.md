# Chapter ending events

The end-of-chapter crawls (`src/story/credits.ts`, `credit.*` in `locales/en.json`) used to carry canon nobody heard.
Pressing **End Level** on chapters 1, 3, 5, 6 and 8 now plays one short in-world event first
(`cutscenes/finale-N.json`, under 8 s, the normal cinematic: HUD and touch controls fade, letterbox, one caption line,
**Skip**), then the Level Complete card. Every card's crawl is at most three lines (a role and two names).
Levels 2, 4 and 7 keep their playable beats and only had their crawl cut.

Mechanism: `main.ts` `confirmStoryAction` starts `finale-<level>` instead of `presentLevelEnd`; `endCutscene` (or a
failed load) then calls `presentLevelEnd`. Timelines may use `camera` with `rel: true` (offsets from Pierce) and a
`world` event (`tower-cut`, `board-stop`, `tv-report`) that `main.ts` `runFinaleWorld` routes to the level's scene.
Playtest: `world-events` (phone layout), and `level-N` / `smoke-lN` log `world-event`, `world-event-caption`, `crawl-lines`.

Voices are Hawkes Gen cast voices (voices.json); the eleven `dialogue.finale-*` takes are NOT made yet (no ogg under `assets/audio/cutscenes/finale-N/`; Dev Tools shows them as Needs clip). Make them with `npm run audio:missing -- --only <ids>` once Gen is reachable. Sound is reused: troffer flicker, glass tick, PA chime, screen
tap clacks, TV static and news sting, elevator beep, phone hang-up.

| Level | Event (length) | Crawl facts moved | Where they are now |
|---|---|---|---|
| 1 Apex Peak | `finale-1` (7.4 s) in the cab at B3: the boardroom is still open on the intercom, the cab light drops, silence | Lang only needed a date, Zurich a promise; the charter asked for a seal and an end to B3; the board debated without looking down | Lang "I need a date. Zurich needs a promise." and Hale "The charter wants B3 sealed." on the intercom; Pierce "Nobody in that room looked down." Already played: Hale feared B3 coming to light (`room-for-grace` 04), Voss called first then messaged, the terminal showed something moving (`apex-terminal`), Pierce took the ride down (the cab) |
| 3 The Return | `finale-3` (7.2 s) at the mirror: the dead practicals come on one by one | Hale already with the other investors; the investors would not hear what rode the elevator; the hall was brighter than any lamp he remembered | Hale "He walked out. That is all they hear."; Pierce "Not what rode the elevator."; the lights. Already played: `hale-walkout` call, `return-walk` lines, `elevator-up` |
| 5 Going Home | `finale-5` (7.0 s) from the stairs: the Apex tower's floors go dark from the top down | Police were given a floor and a description the directory could not match; the tower stayed lit behind him on a floor he was done with; he went down instead of in | Police radio "Tower says the 58th floor is empty."; Pierce "Down, then."; the facade (`towerCut` uniform, `goingHome.setTowerCut`). Already played: the receptionist's lines, `shout.street.police` |
| 6 The Station | `finale-6` (7.2 s) on the platform: the departure board flips to a stop with no name, boarding now | The train sat with a door open on nothing he could name; the phone had nothing left to ring for; the tower kept its meeting | Board row "NEXT STOP ........" (`stationDress.setBoardStop`), PA "Uptown six, now boarding. Stand clear.", Pierce "Nobody left to ring." Already played: `hale-board` call (the board "turned out well", the tower keeps its meeting) |
| 8 The Morning | `finale-8` (7.6 s) at the TV: it switches itself on to the Hawkes Tower report | The board voted in the dark and called it stable; the anchor read his name over a face he did not recognize; Voss called first and kept the tape | Anchor "Hawkes Tower: the board voted. Called it stable." over the still of the old face (`theMorning.tvReport`); Pierce "Stable." Already played: the seven `news` captions and `voss-morning` call |
| 2, 4, 7 | none (crawl cut to three lines) | the creature was going home; the mirror's answer; the other one never turned around | B3 vat break and hunt; `the-desk` mirror; The Train stop scene |
