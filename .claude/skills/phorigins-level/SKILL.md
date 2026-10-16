---
name: phorigins-level
description: Design and build a PH Origins level or story beat end to end: canon from Lore.txt, the scene JSON and level library, the story script and cutscene timelines, lines and voices, generated materials, props, skies and sounds through Hawkes Gen, then the level's playtest. Use for "a level after The Station", "a new cutscene in B3", "lines for <beat>", "a material/prop/sky for <place>".
---

# A PH Origins level, end to end

PH Origins is a third-person story game (Babylon.js 7). A level is several kinds of data plus a little story code;
read `AGENTS.md` first ("Hard constraints", "Story play", the level you're next to under "Story / levels", "Props
and new levels") and keep every "do not regress" rule there.

## 0. Canon (strict)

`C:\Projects\phoriginsassets\Lore.txt` and your brief's canon. One night in Hawkes Tower: the board (Director Hale,
Voss, Lang: no first names, never invent them), B3 "writes back", the vat breaks, Pierce transforms, then goes home.
Pierce is Chairman; HQ is Hawkes Tower, 58th floor. Public Hawkes signage never shows B3, the vat or the creature.
What comes after The Station isn't written: a new level's beat is a proposal for J (put it in your summary and in
AGENTS.md's level list only once approved).

## 1. The pieces

| Piece | Where | Notes |
|---|---|---|
| Scene | `levels/<id>.json` | Geometry, lights, props (`assets[]`: `kind: "model"`, an `assetId` from `assets/asset-library.json`, position, rotation). Edit in Dev Tools (`/devtools.html`); reload its tab before editing a file it holds. |
| Level entry | `levels/level-library.json` | id, name, path, theme, `combat` (off for story levels), speed, arena size, reward. |
| Story | `src/story/*.ts` (the sequence), `src/story/phone.json` (calls) | Beats are code: follow the pattern of the level next to it (`?beat=` start flags for testing). |
| Cutscenes | `cutscenes/<id>.json` | Timelines: camera, anim, line (a line id), audio, fade events, `reequip`. |
| Lines | `locales/en.json` (+ voices in `locales/voices.json`) | Stable ids, speaker, text; spoken types get audio. `node tools/extract_locale.mjs` after timeline edits. |
| Sounds | `locales/sfx.json` | Prompt per effect; Dev Tools → Sound effects. |
| Missions | `src/game/missions.ts` | Main objective and side quests per level. |

## 2. Generated assets (through Hawkes Gen; presets in `hawkesgen/presets/phorigins.json`)

- Materials: `node tools/genMaterial.mjs <name> "<description>"` (albedo + normal + roughness), then the texture
  pipeline. Signs and posters: preset `sign`. Skies: `sky` (360° panorama). Screen loops: `screen-loop`. Props:
  `prop` (textured GLB; a source asset until converted and compressed: the site ships GLB only).
- Lines: Dev Tools → Story lines → Generate missing / out of date (`tools/voiceLines.mjs`, `eleven_v4`, through Gen).
  Pierce is Jackson; keep each character's voice. Sounds: `tools/soundEffects.mjs` the same way.
- For anything the game ships as a file, prefer a recipe in `hawkes.assets.json` (Studio makes what's missing and
  tracks out of date). GPU work is priced with `hawkesgen_estimate` and needs J's OK; voice and sfx are cents a line.

## 3. Check and playtest

`npm run build` (typecheck + build), then `studio_playtest` (phorigins) on `level-<n>` (each level has one; the bot
plays it to its exit) and `full` when the order of levels changed. Write `.hawkes/scenario.txt` = `level-<n>`. Criteria
to state: the level starts from the previous one's ending, every beat plays in order (cutscene and call events in the
timeline), lines have audio (no missing-clip problems), the exit is reachable by the bot, nothing in "Hard
constraints" regressed (combat off where it must be), fps no worse than the level before.
