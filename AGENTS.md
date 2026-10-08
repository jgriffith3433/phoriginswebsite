# PH Origins — agent notes

Cursor still reads this file. Keep it current when you change architecture, asset IDs, or hard constraints.

The owner is **J** (software engineer). Work in code. Do not commit unless asked. Do not dump agent instructions into ElevenLabs / VO prompts.

## What this repo is

Third-person web game + landing page + in-browser level editor. **Babylon.js 7**, **Vite**, **TypeScript**. No React, no Unity.

Sibling source-asset repo (FBX, raw textures): `C:\Projects\phoriginsassets`. **Runtime on the website is GLB / WebP / audio only.** Do not check FBX into this repo or serve `.fbx` from Vite.

`play/` is **build output** (`npm run build` → `outDir: play`). Edit `src/`, `levels/`, `cutscenes/`, `assets/`, `game.html`, `index.html`, `devtools.html`. Do not treat `play/` as source of truth.

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

| URL | What |
|---|---|
| `/` or `index.html` | Landing page (BGM + background stills) |
| `/game.html` | Game |
| `/devtools.html` | Level editor |

Build: `npm run build`. Preview: `npm run preview` (port 4173).

## Hard constraints (do not regress)

- **GLB-only** in this website. Convert FBX with Blender tools, then reference the GLB.
- **Do not reintroduce Mixamo JSON retarget / mixamorig rewrite.** That caused T-pose from bone-name collisions. Bake clips in Blender onto `mixamorigN`, load GLB, `glTF` `animationStartMode` none, stop clips without resetting every group to the last pistol pose.
- **Combat off** on Apex Peak and B3 (`combat: false` in `levels/level-library.json`). Do not spawn wave enemies there.
- **Level 3** (`arctic-rift`) is **Coming soon**.
- Unlock audio on first gesture (`src/game/audioUnlock.ts`). Mobile needs this.
- Invert mouse Y is intentional (`thirdPersonCamera.ts`).
- Start stays disabled until `gameReady` (player + NPCs `whenReady`). Characters stay hidden until idle/sit is playing — avoids T-pose on early Start.

## Layout

```
src/main.ts                 Game loop, HUD, Act I sequence, input, audio bus
src/game/                   Runtime systems
src/editor/                 Dev Tools (devtools.html)
levels/                     Scene JSON + level-library.json
cutscenes/                  Timeline JSON (fetched live, cache: no-store)
assets/models/              Runtime GLBs (ch33, ch44, NPCs, tt_pistol, props)
assets/textures/            WebP/PNG + materials.json + tt_pistol maps
assets/audio/               BGM, SFX, cutscene VO
assets/asset-library.json   IDs the editor and loader use
tools/                      Blender convert, bake anims, texture pipeline
```

### Important `src/game` modules

| File | Role |
|---|---|
| `playerAvatar.ts` | Mixamo avatar, clip matching, overlays, `whenReady` |
| `player.ts` | Capsule, jump (`JUMP_WINDUP` 0.1s, jump ~1.3×) |
| `pistol.ts` | `tt_pistol.glb` on Mixamo RightHand; hidden until draw |
| `muzzleFlash.ts` | Additive flash at barrel; keep it fairly transparent |
| `npcs.ts` | Board seats → Ch* NPCs, sit/talk, departure |
| `cutscenes.ts` | Timeline player (camera/hud/line/audio/anim) |
| `triggers.ts` | `enter_zone` / `cutscene` / `npc_exit` / `music` (BGM + duck) |
| `thirdPersonCamera.ts` | Follow + over-shoulder when armed |
| `menuCamera.ts` | Title camera looking at night-city skybox (+Z moon face) |
| `skybox.ts` | CubeTexture from images; skip rebuild if present; `noMipmap` |
| `modelLoader.ts` | Asset library, GLB import, `PLAYER_ASSET_ID` |
| `materials.ts` | Office materials, per-mesh UV, hologram/glass |
| `objectiveMarker.ts` | World marker for Act I objectives |
| `clipTrims.ts` | Dev Tools clip in/out (`assets/animations/clip-trims.json`) |

`PLAYER_ASSET_ID` = `asset-ch33-hero` (Pierce). `TRANSFORM_HERO_ASSET_ID` = `asset-ch44-hero` (post-transform; reserved). Other `asset-ch*-npc` are board NPCs.

## Story / levels (current)

**Level 1 — The Apex Peak** (`levels/apex-peak.json`)

Office, boardroom, window, terminal, elevator. Combat off. Sequence in `src/main.ts` (`sequencePhase`): seat → board cutscene → wait-board (NPCs leave) → window VO → alarm → terminal → elevator ride → B3.

Cutscenes: `room-for-grace`, `apex-window`, `apex-terminal`, `elevator-b3`.

Board seats: Pierce `chair-head`; Voss `chair-s-1`; Lang `chair-s-3`; Hale `chair-n-2`. Map in `npcs.ts` `BOARD_NPC_BY_SEAT`.

Music trigger: `/assets/audio/room-tone.mp3`, volume **0.28**, ducks to **0.18** during cutscenes. Hale VO in `room-for-grace` is volume **1**. Do not crank level BGM back to 1.

**Level 2 — B3** (`levels/b3-basement.json`)

Basement / lab. Combat off. Cutscenes: `b3-door-reveal`, `b3-vat-break`. Layout follows the Sector 4 blueprint around the existing elevator → Hallway B → vat-door anchors: pipe hall, containment glass, two chemical stores, decon, control, transformation wing, utility. Dark plate / diamond / wired-glass (`mat-b3-*`). Practicals are colored point lights (cyan halls, green vat and cell). Do not flatten those intensities on arrival. VO is still thin.

**Level 3** — coming soon.

## Player animation

Clips matched by **exact name tail** in `findClip` (not fuzzy “idle” hitting `PistolIdle`):

`Idle` `Walk` `Jump` `SitIdle` `SitTalk` `PistolIdle` `PistolWalk` `PistolJump` `Draw` `Holster` `PistolAim` `Shoot`

Some Mixamo **filenames lied**: treat runtime tails as source of truth. Draw/holster play at speed 4; shoot at 3. Blend ~0.1s. Armed walk+jump blend 50/50. Shoot is **wrists/hands overlay**, not full-body. Crosshair only when gun is drawn.

Bake pipeline: Mixamo FBX in `phoriginsassets` → `npm run bake:anims` / `tools/blenderConvert.mjs` / `tools/build_character_glb.py` → GLB here. Editor can import FBX via `/api` during `npm run dev` (needs Blender on PATH).

## Pistol

- Mesh: `assets/models/tt_pistol.glb` (+ `assets/textures/tt_pistol/`).
- Albedo is **RGBA**; keep `hasAlpha = false` or the gun vanishes (alpha clip).
- Show mesh at **start** of draw; hide when holster **finishes**.
- Grip/muzzle offsets live in `pistol.ts` (`GRIP_IN_MESH`, `MUZZLE_IN_MESH`, `HAND_ROTATION`). Tweak there, not by re-importing unless the FBX origin changed.
- SFX: `assets/audio/sfx/` (`pistol-shot`, `pistol-draw`, `pistol-holster`, `jump`, `walk`). Walk loop: play **once**, do not reset `currentTime` every frame.

## Editor (Dev Tools)

`devtools.html` + `src/editor/`. File System Access + Vite `/api` to write `levels/`, import models/textures. Hierarchy search exists. Tools menu needs high z-index (already fixed once). Clip trim UI writes `clip-trims.json`.

Texture pipeline: sources in `phoriginsassets/textures` (or `assets/textures/source`) → `npm run textures` → WebP + `materials.json`. Soft office look: tile UV on floors independently of walls.

## UI / controls

- **Start** gated until load. **WASD**, mouse look (Y inverted), **Space** jump, **I** inventory, click weapon slot or inventory to draw/holster, **P** also starts (gated).
- Score / Best / Level HUD hidden; health bar kept.
- Inventory open exits pointer lock; closing restores it.

## Audio mix (as of last pass)

- Level BGM (Apex Peak music trigger): **0.28**, duck **0.18** in cutscenes (`triggers.ts` + `main.ts`).
- Hale line `cutscenes/room-for-grace.json`: **volume 1**.
- Cutscene beds in JSON are ~0.20–0.22. VO lines ~0.85–1.0.
- Landing BGM: `index.html` ~0.42.
- UI one-shots: `assets/audio/sfx/start.ogg` (Start, **0.7**), `assets/audio/sfx/level-complete.ogg` (Level Complete / Mission Clear, **0.72**), `assets/audio/sfx/objective.ogg` (new objective, **0.55**).
- Office terminal alarm: looping `assets/audio/cutscenes/apex-window/alarm.wav` at **0.46**, from 42.3s in the window cutscene until the terminal beat.
- Elevator ride (`cutscenes/elevator-b3.json`): cab hum loop **0.3**, door slide, floor chime (`beep.wav`), descent rumble loop **0.38**. Passing floors reuse the chime at **0.34**; arrival uses the timeline chime only.

## Known pitfalls

- **T-pose**: clips not ready, wrong clip tail (`PistolIdle` vs `Idle`), glTF autoplaying all groups, Mixamo bone collisions. Gate on `whenReady`; hide mesh until locomotion applied.
- **Invisible pistol**: albedo alpha. Flash without mesh = same bug or `setVisible` timing.
- **WebGL texImage2D / generateMipmap**: disposing a CubeTexture while faces still load. `skybox.ts` skips rebuild; create with `noMipmap`.
- **Walk SFX inaudible**: was `play()` spam while paused. Loop once at ~0.62.
- **Stuck idle**: locomotion not resumed after cinematic/weapon; `resumeLocomotion`.
- Editing `play/cutscenes` or `play/levels` does nothing in `npm run dev`.

## Nearby leftovers (not blockers)

Gun grip may still need a millimeter tweak. Real Mixamo Shoot/Equip FBXs would beat `PistolAim` fallback. B3 needs more art + VO. Landing stills are placeholders. Combat systems exist but story levels do not use them.

When you change IDs, clip names, sequence phases, or these constraints, **update this file**.
