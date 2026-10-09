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
index.html                  Marketing home (hero, film, Act I, cast)
about.html                  About the game
characters.html             Cast: Pierce Hawkes, Hale, Voss, Lang
site/marketing.css          Shared marketing styles
site/marketing.js           Nav, play link, landing music, hero cycle
src/main.ts                 Boot, HUD, input, render loop
src/story/                  Act I director, phone calls, objective copy
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

### Marketing site

Home, About, and Characters share `site/marketing.css` and `site/marketing.js`. Play goes to `/game.html` on a local dev host (any port except the preview server on 4173) and `/play/index.html` elsewhere. Landing music key stays `ph-origins-landing-music`, volume **0.42**.

Public cast is the named board only: **Pierce Hawkes**, **Director Hale** (woman), **Voss** (man), **Lang** (man). Do not invent first names. The post-vat figure on Characters is concept art; Ch44 is still reserved and not swapped in.

### Important `src/game` modules

| File | Role |
|---|---|
| `playerAvatar.ts` | Mixamo avatar, clip matching, overlays, `whenReady` |
| `player.ts` | Capsule, jump (`JUMP_WINDUP` 0.1s, jump ~1.3×) |
| `pistol.ts` | `tt_pistol.glb` on Mixamo RightHand; hidden until draw |
| `autoAim.ts` | With the sidearm out, the camera snaps onto a target in front of it when no solid collider stands between. Bounding boxes only. A hard look breaks the snap. |
| `muzzleFlash.ts` | Additive flash at barrel; keep it fairly transparent |
| `npcs.ts` | Board seats → Ch* NPCs, sit/talk, departure |
| `cutscenes.ts` | Timeline player (camera/hud/line/audio/anim). `reequip` defaults true: a sidearm or flashlight that was out when the scene started is out again when it ends. Set `reequip` false to leave the hands empty (`b3-vat-break`). |
| `triggers.ts` | `enter_zone` / `cutscene` / `npc_exit` / `music` (BGM + duck) |
| `thirdPersonCamera.ts` | Follow + over-shoulder when armed |
| `menuCamera.ts` | Title camera looking at night-city skybox (+Z moon face) |
| `skybox.ts` | CubeTexture from images; skip rebuild if present; `noMipmap` |
| `modelLoader.ts` | Asset library, GLB import, `PLAYER_ASSET_ID` |
| `materials.ts` | Office materials, per-mesh UV, hologram/glass |
| `objectiveMarker.ts` | World marker for Act I objectives |
| `grade.ts` | Per-theme ACES grade, bloom, vignette, SSAO |
| `phone.ts` | Handset, flashlight, calls, texts. One hand: gun or phone |

Act I phases, elevator and vat choreography, and story inventory live in `src/story/act1.ts`. Timelines can also `mesh` (show/hide), `objective`, `avatar`, and `carry`. `main.ts` boots the canvas and calls the director.
| `clipTrims.ts` | Dev Tools clip in/out (`assets/animations/clip-trims.json`) |

`PLAYER_ASSET_ID` = `asset-ch33-hero` (Pierce). `TRANSFORM_HERO_ASSET_ID` = `asset-ch44-hero` (post-transform; reserved). Other `asset-ch*-npc` are board NPCs. B3 creature is `asset-parasite-starkie` (`parasite-starkie.glb`, Idle + Walk + Attack). Ch44 also has `RebornIdle`.

## Story / levels (current)

**Level 1 — The Apex Peak** (`levels/apex-peak.json`)

Office, boardroom, window, terminal, elevator. Combat off. Sequence in `src/story/act1.ts`: seat → board cutscene → wait-board (NPCs leave) → window VO → Voss calls → alarm → terminal → elevator ride → B3. The window monologue finishes, then `voss-meeting` in `src/story/phone.json` (Hale is furious, Pierce is short). The terminal alarm starts when that call ends, and Voss texts “Pick up the terminal.” **F** opens the phone screen. With the flashlight on, **F** only shows or hides that screen; Pierce keeps the handset and the beam. **G** raises the phone and turns the flashlight on without opening the screen. **G** again toggles the beam, and turning it off while the screen is closed puts the phone away. The sidearm and the phone share one hand. `?beat=voss` rings that call from the spawn. Chairs, the board table, Pierce’s desk, the terminal, and ceiling troffers are GLB props. Story inventory is the phone, the sidearm, and B3 clearance, not arena ammo.

Cutscenes: `room-for-grace`, `apex-window`, `apex-terminal`, `elevator-b3`. A timeline `fade` event sets the black veil (`src/game/fade.ts`): `to` is 0 clear through 1 black, over `duration` seconds. Subtitles and the level card stay above it. `apex-window` snaps to black, fades the office up, and fades out on the last line. Level Complete fades the view to black under the card, then the next level fades back in. Behind that card, two credit columns (`src/story/credits.ts`) crawl the left and right edges for about **82s**. The right column starts **7s** later. Small titles, large name lines, scaled with `--ui-scale` and the viewport. The lines are the unspoken leftovers (Hale stayed, Voss is mad, the vat was home), not a recap of the beats. Apex Peak is level 1. B3 is level 2.

Board seats: Pierce `chair-head`; Voss `chair-s-1`; Lang `chair-s-3`; Hale `chair-n-2`. Map in `npcs.ts` `BOARD_NPC_BY_SEAT`.

Music trigger: `/assets/audio/room-tone.mp3`, volume **0.28**, ducks to **0.18** during cutscenes. Hale VO in `room-for-grace` is volume **1**. Do not crank level BGM back to 1. Level `ambient` is **1.55** (hemispheric fill, applied after the theme). The board table, its hologram, the office desk, the terminal, and the office chairs block the player. `chair-office` sits on the south side of Pierce’s desk, facing the terminal. The alarm waypoint and the walk-up are on that chair (within **1.35**). The terminal cutscene stands him beside the chair, facing the monitor. An ammo box sits in the northwest corner of the office (`office-pickup-ammo`, about x 44, z 46.2). It stays hidden until `room-for-grace` ends. Pierce starts with an empty magazine and no spare boxes. The monitor flashes red during the alarm and returns to the material it had before.

**Level 2 — B3** (`levels/b3-basement.json`)

Basement / lab. Wave combat stays off. Cutscenes: `b3-door-reveal`, `b3-vat-break`. Pierce finds the lab door, the reveal plays his shock, and the creature flees on that timeline (Idle until 9.1s, Attack and a shriek through 13.8s, then Walk through 20.2s, out the south door into decon). Pierce’s line there is “Oh my god! What is that thing?!” For that whole timeline his flashlight stays in his hand, tipped up, and the beam tracks the creature's head, including the flee. Control then returns in a `hunt` phase: the parasite breaks into the rooms, paths along the floors, and only rushes in bursts. The hunt grid is the floors with walls, crates, and other solid colliders cut out, so it routes through doorways instead of sliding through them. It chases at about **3.2** m/s along the nav grid, including diagonals, and the path keeps a waypoint when a shortcut would cut a corner. If a chase step stops making progress, it steps off the wall onto an open cell and picks a new path. It jumps the last few meters when that line is clear, and it keeps coming until a bite lands. A bite is 22 health inside **1.8** m. Then it roams away on a crooked path at about **1.5** m/s for **5–15** seconds before it commits again. A miss keeps the chase going. Hunt SFX live in `assets/audio/sfx/creature/`: skitter and scrape while it walks, chitter when it waits, a distant cry and a pipe knock, breath within about 15 m, a hiss inside 4.6 m. A rush plays shriek **0.62**, the run clip under it at **0.26**, and an electrical tick **0.24**. Heartbeat is **0.55** inside 3.2 m and **0.28** farther out during a rush. A bite is snarl **0.7** plus wound **0.4**. A hit is wound **0.52** and a hiss, or a shriek on the last hit. The rush dips nearby practicals (intensity only — the phone spot stays enabled), stutters the flashlight, tightens a red vignette, and adds a short camera shake. A red edge flash lasts under half a second at the start of a rush. A hit makes it scatter unless it is already on you. Four torso hits drop it. It runs to the vat glass, not the southwest corner. `b3-vat-break` is about **40s**. Pierce walks up. The creature plays `Attack` at the glass. Pierce backs away on `WalkBack` while the glass cracks. At **14.4s** the glass goes, `FallingDown` plays, acid hits him, and he screams. Ch44 swaps at **18.6s** and plays `RebornIdle`. The line after that is “What happened to me…”. `reequip` stays false. Fill, sun, and the vat practicals come up for the shot; his flashlight stays aimed at the vat. The hunt loads a full clip of 8 and one ammo box. Ammo boxes cap at **4**, medkits at **3**. **E** takes the nearest supply when that stack has room; a full stack stays in the world (`Ammo box — E` / `Ammo full`). **H** spends a medkit for 40 health. Boxes and medkits sit in the pipe hall, chem stores, containment, decon, control, service, and the transformation wing. **Q** draws or holsters. **R** spends one box to refill the clip. An empty clip shows “Reload — press R”. No boxes, no reload. Shots stamp a mark on the surface they hit (`src/game/impacts.ts`). `G` is the flashlight; that beam is how the halls read. Level `ambient` is **0.05**. Theme sun is **0.015**, fog starts at 5 and ends at 32, grade exposure is **0.78**. Practicals stay colored and use standard falloff, scaled down (halls ~0.34×, vat and cell ~0.48×) with 1.5× range so the pools are wide and dim. Do not raise `maxSimultaneousLights`. Signs are emissive plates (`b3-sign-*`, including `LIVE DRIPS`). Pipe drips mount from `src/game/drips.ts` on this level only. Layout is still the Sector 4 blueprint: pipe hall, containment, chem stores, decon, control, transformation wing, utility, plus crates, drums, puddles, and caution stripes. Reveal and vat-break VO is Pierce (Jackson). Creature breath and run, plus vat glass and splash, live on those timelines.

**Level 3** — coming soon.

## Player animation

Clips matched by **exact name tail** in `findClip` (not fuzzy “idle” hitting `PistolIdle`):

`Idle` `Walk` `WalkBack` `Jump` `FallingDown` `SitIdle` `SitTalk` `PistolIdle` `PistolWalk` `PistolJump` `Draw` `Holster` `PistolAim` `Shoot`

Some Mixamo **filenames lied**: treat runtime tails as source of truth. Draw/holster play at speed 4; shoot at 3. Blend ~0.1s. Armed walk+jump blend 50/50. Shoot is **wrists/hands overlay**, not full-body. Crosshair only when gun is drawn.

Bake pipeline: Mixamo FBX in `phoriginsassets` → `npm run bake:anims` / `tools/blenderConvert.mjs` / `tools/build_character_glb.py` → GLB here. Editor can import FBX via `/api` during `npm run dev` (needs Blender on PATH).

Blender MCP (`.cursor/mcp.json`) is for new static props. Dev Tools → **Link Blender** installs the addon if it is missing, starts Blender if it is closed, and waits until `localhost:9876` is listening. It does not close a Blender that is already open. The addon server has to be up in the GUI before Cursor can drive it. Save the `.blend` in `C:\Projects\phoriginsassets`, export GLB to `assets/models/`, and register an id in `assets/asset-library.json`. Place the prop in level JSON or Dev Tools so it loads through `modelLoader.ts`. Pierce, the pistol, and the parasite stay on the headless bake scripts. Do not rebake them through the addon, and do not run a headless bake while that file is open in the GUI. A `.blend` under `assets/` is copied into `play/`. Babylon’s Node Material, geometry, and particle MCP servers are not wired up; this game loads glTF PBR, not those node graphs.

## Pistol

- Mesh: `assets/models/tt_pistol.glb` (+ `assets/textures/tt_pistol/`).
- Albedo is **RGBA**; keep `hasAlpha = false` or the gun vanishes (alpha clip).
- Show mesh at **start** of draw; hide when holster **finishes**.
- Grip/muzzle offsets live in `pistol.ts` (`GRIP_IN_MESH`, `MUZZLE_IN_MESH`, `HAND_ROTATION`). Tweak there, not by re-importing unless the FBX origin changed.
- SFX: `assets/audio/sfx/` (`pistol-shot`, `pistol-draw`, `pistol-holster`, `jump`, `walk`). Walk loop: play **once**, do not reset `currentTime` every frame.

## Editor (Dev Tools)

`devtools.html` + `src/editor/`. File System Access + Vite `/api` to write `levels/`, import models/textures. Hierarchy search exists. Tools menu needs high z-index (already fixed once). Clip trim UI writes `clip-trims.json`. The inspector Ambient slider writes `ambient` on the level (hemispheric fill, 0–2.5). The game applies it after the theme. Omit the field to keep the theme intensity.

Texture pipeline: sources in `phoriginsassets/textures` (or `assets/textures/source`) → `npm run textures` → WebP + `materials.json`. Soft office look: tile UV on floors independently of walls.

## UI / controls

- **Start** gated until load. A progress cookie (`ph-origins-save`, `{ unlocked, level, sound }`) makes the title ask **Continue** (saved level) or **New Game** (level 1). Progress counts once `unlocked` or `level` is above 1. **Load Level** stays grey until that cookie exists. Mission select only offers levels at or under `unlocked`. **Reset** clears that cookie. **Level Complete** offers **Continue** into the next playable level and **Exit** back to `/`. After B3 the next slot is still coming soon, so that card is Exit only. **WASD**, mouse look (Y inverted), **Space** jump, **I** inventory, **Q** or the weapon slot draws/holsters, **G** raises the phone and turns the flashlight on without the phone screen. **F** opens that screen, and with the beam already on it only shows or hides the screen. **Q** Sidearm, **G** Light, **H** Medkit, **F** Phone, and **I** Inventory are buttons on the right edge. On mobile the key caps are hidden. **R** reloads from an ammo box, **E** picks up a nearby supply if that stack has room. Those prompts are buttons, and on mobile the key letters stay hidden. **H** uses a medkit (40 health), **P** also starts (gated). With the sidearm drawn, the camera snaps onto a target in front of it only when the line to it is clear. A hard shove on the look stick, or a mouse flick, breaks that snap. The wheel does not zoom. Drawing the pistol or turning on the phone flashlight pulls the camera in (`equippedDistance` 1.55, shoulder offset **0.55**). Holstering both returns the follow distance.
- Score / Best / Level HUD hidden; health bar kept. A bottom-center readout shows FPS and JS heap (`performance.memory`, Chromium). It refreshes four times a second. Other browsers show memory as n/a.
- **Start**, **Continue**, and **New Game** lock and hide the mouse. Inventory open exits pointer lock; closing restores it. Mobile keeps touch look.

## Audio mix (as of last pass)

- Level BGM (Apex Peak music trigger): **0.28**, duck **0.18** in cutscenes (`triggers.ts` + `main.ts`).
- Hale line `cutscenes/room-for-grace.json`: **volume 1**.
- Cutscene beds in JSON are ~0.20–0.22. VO lines ~0.85–1.0.
- Landing BGM: `index.html` ~0.42.
- UI one-shots: `assets/audio/sfx/start.ogg` (Start, **0.7**), `assets/audio/sfx/objective.ogg` (new objective, **0.55**). Level Complete plays `assets/audio/ending-{level}.mp3` once at **0.7** (`ending-1` after Apex Peak, `ending-2` after B3) and stops the level bed. The song stops when the next level starts.
- Office terminal alarm: looping `assets/audio/cutscenes/apex-window/alarm.wav` at **0.46**, starting when the Voss call ends, until the terminal beat.
- Voss call (`src/story/phone.json`): Voss **0.92**, Pierce **0.92**. Lines in `assets/audio/phone/`.
- Elevator ride (`cutscenes/elevator-b3.json`): cab hum loop **0.3**, door slide, floor chime (`beep.wav`), descent rumble loop **0.38**. Passing floors reuse the chime at **0.34**; arrival uses the timeline chime only.
- B3 reveal (`cutscenes/b3-door-reveal.json`): Pierce “Oh my god! What is that thing?!” **0.92** (`02-pierce-what-is-that.wav`, Jackson) at 5.8s, creature breath **0.38** at 5.8s, shriek **0.78** at 9.4s with the Attack, creature run **0.55** from 13.8s (matches the Walk flee). Door slide reuses the elevator door clip.
- B3 vat break (`cutscenes/b3-vat-break.json`): about **40s**. Pierce “It ran…” **0.92** as he starts backing away, scream **1** (`04-pierce-scream.wav`, Jackson) when the acid hits, then after the body changes “What happened to me…” **0.92** (`05-pierce-what-happened.wav`, Jackson, about 19s). Glass **0.86** and splash **0.78** at **14.4s**. Creature shrieks at **4.2s** and **11.2s** while the glass cracks. Avatar event swaps to Ch44 at **18.6s** onto `RebornIdle`. Timeline ends at **39.6s**, then Level Complete.

## Known pitfalls

- **T-pose**: clips not ready, wrong clip tail (`PistolIdle` vs `Idle`), glTF autoplaying all groups, Mixamo bone collisions. Gate on `whenReady`; hide mesh until locomotion applied.
- **Invisible pistol**: albedo alpha. Flash without mesh = same bug or `setVisible` timing.
- **WebGL texImage2D / generateMipmap**: disposing a CubeTexture while faces still load. `skybox.ts` skips rebuild; create with `noMipmap`.
- **Walk SFX inaudible**: was `play()` spam while paused. Loop once at ~0.62.
- **Stuck idle**: locomotion not resumed after cinematic/weapon; `resumeLocomotion`.
- **B3 untextured / dark, `GL_MAX_VERTEX_UNIFORM_BUFFERS (12)`**: glTFLoader raises every material's `maxSimultaneousLights` to `scene.lights.length` (hemi + sun + 23 practicals = 25). Each light is a vertex uniform block. `capSimultaneousLights` in `modelLoader.ts` puts the cap back to 4 after every GLB import. Do not remove that.
- **Phone flashlight**: materials only shade 4 lights, and the scene list is creation order, so a late practical (the office light) never used to get a slot. `phone.ts` rebuilds each mesh's list as fill, sun, then the nearest practicals, with the spot fixed in the last slot. Leave the spot enabled at intensity 0 when the beam is off. Disabling it, or giving it `renderPriority`, swaps a shader slot and the first frame draws with a uniform buffer that is too small (skybox flash, room lights drop out). Do not parent the handset or the spot to the Mixamo bone: its 0.01 scale turns the slab into a wedge, and a parented spot loses the mirrored finger axis and aims backward. Pose the handset from the bone's world +Y. The spot stays at the hand. With the beam on and no call, it aims along the camera so a dark hall reads. A call keeps the finger axis. The cone is angle **0.5**, exponent **8**, intensity **30**, range **14** — a tighter beam, with the rim faded before the cutoff.
- Editing `play/cutscenes` or `play/levels` does nothing in `npm run dev`.

## Nearby leftovers (not blockers)

Gun grip may still need a millimeter tweak. Real Mixamo Shoot/Equip FBXs would beat `PistolAim` fallback. Lab consoles also sit in chem, decon, containment, and the transformation wing. The rest of the basement is still boxes. Landing stills are placeholders. Arena combat code still exists and stays off on story levels. Opaque level materials are PBR (albedo, normal, roughness). Do not assign `scene.environmentTexture`; characters and props use the flat probe in `assets/textures/probe/`.

When you change IDs, clip names, sequence phases, or these constraints, **update this file**.
