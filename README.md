# PH Origins

Third-person browser game for **PH Origins**: Pierce Hawkes, the Apex Peak boardroom, and what is locked on basement **B3**.

Built with [Babylon.js](https://www.babylonjs.com/) 7, Vite, and TypeScript. Play it in the browser — no install, no Unity player.

## Play locally

```bash
npm install
npm run dev
```

Then open:

- [http://127.0.0.1:5173/](http://127.0.0.1:5173/) — landing page
- [http://127.0.0.1:5173/game.html](http://127.0.0.1:5173/game.html) — game
- [http://127.0.0.1:5173/devtools.html](http://127.0.0.1:5173/devtools.html) — level editor

```bash
npm run build      # writes static site into play/
npm run preview    # serve the build (port 4173)
```

## Controls

| Input | Action |
|---|---|
| WASD | Move |
| Mouse | Look (Y axis inverted) |
| Space | Jump |
| I | Inventory (pistol draw / holster from the weapon slot) |
| Click | Fire when the pistol is drawn |
| Start | Begin once loading finishes |

On a phone or tablet, on-screen sticks and buttons appear.

## What’s in the game right now

**The Apex Peak (Level 1)** — Hawkes Tower, 58th floor. Sit the board meeting, watch it fall apart, take the window, the terminal, then the elevator to B3. No combat.

**B3 (Level 2)** — Basement lab. Door reveal and vat beats are in; art and voice-over are still being filled in. No combat.

**Level 3** — listed as Coming soon.

The title screen looks out over a night-city skybox until you press Start (the button stays on **Loading…** until Pierce and the board are actually animated — no T-pose flash).

## Repo map

| Path | Purpose |
|---|---|
| `src/main.ts` | Game loop, story sequence, HUD, input |
| `src/game/` | Player, camera, NPCs, cutscenes, weapons, scene load |
| `src/editor/` | Dev Tools editor |
| `levels/` | Level JSON (`apex-peak.json`, `b3-basement.json`, library) |
| `cutscenes/` | Timed dialogue / camera / audio scripts |
| `assets/` | Runtime models (GLB), textures, audio |
| `game.html` | Game shell + HUD CSS |
| `index.html`, `about.html`, `characters.html` | Marketing site (home, story, cast) |
| `devtools.html` | Editor shell |
| `tools/` | FBX→GLB, animation bake, texture compress |
| `play/` | **Build output** — do not edit by hand |

Character and prop **FBX sources** live in the sibling folder `phoriginsassets` (not this repo). This site only ships converted GLBs and compressed textures.

### Useful npm scripts

| Script | Does |
|---|---|
| `npm run dev` | Vite + editor import APIs |
| `npm run build` | Typecheck and emit `play/` |
| `npm run textures` | Compress / register materials |
| `npm run bake:anims` | Bake Mixamo clips into character GLBs (needs Blender) |
| `npm run convert:fbx` | FBX → GLB helper |

## Content notes

Board VO and SFX are under `assets/audio/`. Mix volumes live in cutscene JSON and in the level’s **music** trigger (`room-tone.mp3` on Apex Peak). Dialogue should stay louder than the bed.

Characters are Mixamo-derived GLBs. Pierce is `ch33`; a later transform uses `ch44` (not swapped in yet). Board NPCs are the other `ch*` models.

## Contributing (this project)

- Prefer small, playable changes; verify in `/game.html`, not only a screenshot.
- Keep combat off on story levels unless design says otherwise.
- If you change how loads, clips, or asset IDs work, update [`AGENTS.md`](./AGENTS.md) so the next editor session stays oriented.

[`AGENTS.md`](./AGENTS.md) is the longer brief for coding agents (architecture, pitfalls, clip names, Act I flow).
