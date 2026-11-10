# Content for PH Origins

You are making content for PH Origins (PH Origins: a Vite/TypeScript web game (built into play/) with its lore site, published from the repo root to GitHub Pages (phorigins.com).): story, places, characters, dialogue or art.


## What J asked for

Using the hitch detector's named causes, move first-use costs behind the chapter card for each level: compile shaders/effects for every mesh with a material including hidden/disabled ones (avatars, phone handset, TV, cutscene-only props; see m_92123196702f in main.ts meshShadersReady), upload textures, preload and decode the level's audio, instantiate pooled props, and pre-create particle systems. Spread remaining work across frames (idle-callback style chunks, no polling), avoid per-frame allocations in the render loop hot paths. Check: smoke-l1..l8 detector numbers before/after; Level 1 clip around the boardroom, doors and phone call.

Work out what that means in this project (read the story doc and AGENTS.md), make it well, and keep it consistent with
the product's tone and style. If it's too big for one change, do a solid first part and say what's left in the summary.

## GPU budget: none

Nothing here was approved for GPU generation (images, video, music, 3D on the fleet). Do everything that needs no GPU
(design, data, specs, Claude-only steps, voice and sound effects are fine: cents each), price the GPU part with
`hawkesgen_estimate`, and end with that estimate in your summary so J can approve it. Never start a GPU server.

## Acceptance criteria (how this is judged)

The change is ready once your checks pass and its pull request is open; after it is merged into beta, beta's playtest
judges these, and the work is done only when every one of them passes there:
1. Level 1 plays from spawn to the board table with no frame over 100 ms after the first second
2. Opening doors, the phone call and the first cutscene play without a freeze in a desktop clip
3. Phone-size runs of levels 1, 4 and 8 show no hitch over 150 ms
4. The chapter card is not held noticeably longer than today (under +1.5 s on desktop)

Where the game implements the playtest contract (`window.hawkesPlaytest`: see this project's AGENTS.md, and the spec
at `hawkesstudio/docs/playtest.md` next to this repository), add or extend a scenario that plays to what the criteria
describe (through real input, no teleporting; named setup shortcuts are fine) and logs events or checks that show each
one, so the review can judge them from the footage and the timeline. Write that scenario's name (one line, e.g.
`checkout`) in `.hawkes/scenario.txt`: beta's playtest plays it (and this change's, when J asks for one). To play specific content
(a new stage, level or enemy), add a second line with the scenario's options as JSON, e.g. `{"stage":"neon-pit"}`. Without a contract, make
sure each criterion can be seen when the page is played.





## This kind of work (content)

- Canon first: read the story doc and `docs/world-bible.md`; names, tone and facts match them, and what you add goes
  into the world bible.
- Dense, not sparse: every area you touch is dressed, has a landmark, life and ambient sound, and a player never goes
  more than about 10 seconds without something to see, hear or do.
- Tell it through play: events, in-game cutscenes, Hawkes Gen voice lines and sound effects. On-screen text is a last
  resort, one line at most.

## Other agents on PH Origins

Up to 2 agents work on PH Origins at once, each on its own branch from beta. Another agent may merge into beta
while you work, so keep your change narrow: touch only the files your task needs, and don't reformat, rename or move
shared files. None is running beside you right now, but one may start while you work.

## Game quality rules (every game, every change)

These hold for every change to a game, whatever the task says. Breaking one fails the change: Studio scans what you
touched before your pull request opens and sends you back with what it found, and a playtest that shows a broken rule
fails, so the change doesn't merge and the game doesn't go live. The full guide, with probes and fixes for Unity and
the web, is the game-quality skill (load it before building anything a player sees).

1. **In-world text reads the right way round.** Unity's 3D text reads correctly only when it faces away from the camera. Pointing it straight at the camera, or giving it a negative scale, mirrors it.
   - A billboard sign copies the camera's rotation (transform.rotation = camera.transform.rotation); it never calls LookAt(camera) on text.
   - Never use a negative scale on text, or on anything that holds text.
   - Checked by: Text (TextMesh, TextMeshPro) whose scale, or a parent's, mirrors it. (Studio's scan, before your pull request) A script on text that calls LookAt on the camera without turning it round. (Studio's scan, before your pull request) A screenshot of every in-world sign: each one reads left to right. (the playtest)
2. **No z-fighting and no models clipping through each other.** Agents stack separate walls, floors and ceilings so two surfaces sit in exactly the same place, and a tiny camera near distance makes even slightly separated surfaces flicker.
   - Rooms snap to a grid: walls sit on top of the floor and meet at corners without overlapping; no two surfaces share a plane.
   - The camera's near distance is 0.05 or more (Unity nearClipPlane, Babylon minZ, three.js near); 0.1 to 0.3 for a third-person camera.
   - Props and characters never overlap other meshes; colliders match the visible shape.
   - Checked by: A camera near distance under 0.05. (Studio's scan, before your pull request) Two copies of the same mesh at the same position, rotation and scale. (Studio's scan, before your pull request) Two frames from a slightly moved camera: surfaces that swap or flicker. (the playtest) Models poking through each other, the player or the camera inside a wall or floor. A hard limit: one sighting fails. (the playtest)
3. **No inside-out models.** AI-made 3D models often come out with faces flipped, and mirroring with a negative scale or mixing up glTF and Unity axes flips them too, so you see the back of each face.
   - Every model goes through one cleanup step on import (and Hawkes Gen's 3D export) that points normals outward and bakes in any mirroring.
   - Mirror a model by making a mirrored copy of the mesh, never with a negative scale on its object.
   - Checked by: A glTF or GLB model whose faces mostly point inward. (Studio's scan, before your pull request) A mesh object (Unity scene or prefab, glTF node) with a mirroring negative scale. (Studio's scan, before your pull request) A model that looks inside out on screen. (the playtest)
4. **Buildings and props sit on the ground.** Agents drop models at guessed coordinates without checking the ground height or where the model's base really is, so buildings sink into the ground and props float.
   - Every building and prop is placed by finding the ground below it (a raycast or the terrain's height) and lining up the bottom of the model's bounds, not its center or pivot.
   - Placement runs again whenever the terrain changes.
   - Checked by: A ground-contact scan of every scene: anything sunk more than 5 cm into the ground, or floating more than 2 cm above it. (the playtest) Buildings or props that look sunk or floating on screen. (the playtest)
5. **Animation holds up over time.** Playtests that take snapshots miss what goes wrong between frames: a landing decided only when falling speed hits zero never happens on a slope, and walk and run animations played at a fixed speed slide on the ground.
   - Landing uses a ground check that allows for slopes (a short spherecast or the controller's isGrounded), and every animation state has a way back out.
   - Measure how fast each walk and run animation really moves and match playback speed (or a blend) to the character's actual speed.
   - The playtest scenario jumps onto slopes of 10 to 40 degrees and ramps walk to run and back, logging state, grounded, speed and foot movement every frame.
   - Checked by: The character stays in a jump or fall state while on the ground for more than 0.3 seconds. (the playtest) A planted foot slides along the ground. (the playtest)
6. **A game is a full, living world with soul, not a demo.** A game is an entire world: it needs character and soul, very little empty space, room to breathe and many kinds of interaction. Story is told through gameplay, real in-game events, cutscenes, sound and voice, not text.
   - Plan before building: each game has a world bible (docs/world-bible.md) covering its areas, landmarks, who lives there, what happens in each place, and the story beats as events, and it is checked before any code.
   - Build a vertical slice first: one area finished to the full bar (dressed, a landmark, life, ambient sound, several kinds of interaction, a story beat told as an event) before widening.
   - Full world: a player never walks more than about 10 seconds without something to see, hear or do. Every area has dressing, a landmark, life, ambient sound and several kinds of interaction.
   - Breathing: things move and change on their own, like characters' routines, weather, wind and reactions to the player.
   - Story as experience: every story beat happens through gameplay, in-game cutscenes with real events, sound effects and Hawkes Gen voice lines. On-screen text is a last resort, one line at most; a beat told only in text fails.
   - Checked by: A world bible that is added or changed has every section: Areas, Landmarks, Who lives here, What happens, Story beats. (Studio's scan, before your pull request) The playtest walks each area and times the gaps between things to see, hear or do: none longer than 10 seconds. (the playtest) Story text counted against voiced and acted beats: no beat told only in text. (the playtest) How empty each area looks: bare floors, nothing alive, nothing to do. (the playtest) The fun reviewer's verdict on a played build: a living world, or a demo. (the fun review of a played build)
7. **The camera and controls feel right.** What makes a game feel cheap is mostly felt, not seen in a still: a camera that clips into walls, snaps or shakes, controls that answer late, a jump that fails just after the edge, stutters. The numbers here are industry starting values; each game tunes its own and reports them.
   - Input to a visible response in under 100 ms: movement and actions start on the frame the input arrives, never after an animation finishes.
   - Jumping games: coyote time of 80 to 150 ms (a jump still works just after running off an edge) and a jump buffer of 100 to 150 ms (a jump pressed just before landing happens on landing).
   - Combat games: hit-stop of 50 to 100 ms on heavy hits, with short, small screen shake.
   - The camera never clips: it pulls in ahead of walls (a sphere cast from the target to the camera, radius at least the near distance) and never shows the inside of geometry.
   - The camera never snaps or jitters: smooth, critically damped follow with a capped turn rate. An intended cut, respawn or teleport tells the playtest (hawkesPlaytest.cut()).
   - No frame over 250 ms during play: load and stream content off the main thread.
   - Report the tuned values as playtest metrics, e.g. run.metric('feel.coyoteMs', 120), run.metric('feel.jumpBufferMs', 120), run.metric('feel.hitStopMs', 70); the feel sensor measures input latency, camera clipping and hitches itself.
   - Checked by: The camera inside or behind a wall or floor (the feel sensor's camera-blocked). A hard limit: one sighting fails. (the playtest) The camera snaps, jumps or shakes between frames outside an intended cut. A hard limit: one sighting fails. (the playtest) The player or camera jitters back and forth, or collision shoves the player. (the playtest) Input to visible movement, measured by the feel sensor: under 100 ms. (the playtest) Frame hitches during play: no frame over 250 ms. Loading, title and menu screens and a scene's first seconds are load stutter, a note, not a fail. (the playtest) Stutters the recording shows (the review's video freezes): none over 250 ms. Advisory: the recorder can stall on its own, so it is a note unless the game's own frame timings agree (the hitch check). (the fun review of a played build) Jumping games report their coyote time: at least 80 ms. (the playtest) Jumping games report their jump buffer: at least 80 ms. (the playtest) Combat games report their hit-stop: at least 40 ms on heavy hits. (the playtest) The explore bot (hugging walls, jumping edges) never falls through or out of the world. A hard limit: one spot fails. (the playtest) The explore bot never gets stuck on geometry it can't escape by sliding, jumping or backing out. (the playtest)

Before feature or content work: read `docs/world-bible.md` and build to it (add to it when your work adds an area, a
character or a story beat). No world bible yet and your task adds areas, characters or story: write it first (the
game-quality skill has the template), commit it, then build. Before you finish work a player will see, ask the
studio:fun-reviewer subagent to look at what you made against these rules, and fix what it calls a demo.

## Studio's tools, and Talk

You have Studio's own tools, the same ones Talk has (the `hawkesstudio` MCP server): the backlog, reports, playtests,
previews, the roadmap, the other projects, deploy plans. Read whatever helps. `studio_task` starts work in another
project (up to 3; work you start can't start more). Going live, rollbacks and Approve cards stay the owner's.
To tell the owner something while you work (a result, a question you can carry on without), use `studio_tell`: it goes
to Talk, which passes it on. A question you can't go on without still goes in `.hawkes/question.md` (see above).
GitHub: `studio_github_api` makes REST calls to any of this Studio's repos with Studio's own token (issues, pull
requests, Actions runs and logs, search, branches of your own). There is no GitHub token in your shell, so use it
instead of `gh` or `curl`. Merging and approving stay with Studio's gates.

## Files from Hawkes Gen

To put a file from Hawkes Gen into this repo (an image, a sound, a model), call `studio_gen_import` with its asset id
(`a_...`) and the path in the repo; give `width`/`height`/`format`/`quality` to resize or convert an image (Gen does it,
free). It writes the file for you: no download, key or converter needed. Then commit it.
It takes files from this Studio's own Gen library and from its owners' own hawkesgen.ai libraries.

## The Studio's other repositories (read-only)

Shallow clones of the other projects' repositories, to read (not to change: a change there is that project's own task):
- `jgriffith3433/theplacedepartmentwebsite`: `../c_567609defe5e.repos/theplacedepartmentwebsite`
- `jgriffith3433/hawkesstudio`: `../c_567609defe5e.repos/hawkesstudio`
- `jgriffith3433/breakingthrough`: `../c_567609defe5e.repos/breakingthrough`
- `jgriffith3433/icanbeaiwebsite`: `../c_567609defe5e.repos/icanbeaiwebsite`
- `jgriffith3433/hawkesbiomedical`: `../c_567609defe5e.repos/hawkesbiomedical`
- `jgriffith3433/imaginelivetvwebsite`: `../c_567609defe5e.repos/imaginelivetvwebsite`
- `jgriffith3433/doseofdestructionwebsite`: `../c_567609defe5e.repos/doseofdestructionwebsite`
- `jgriffith3433/YoobaLandGame`: `../c_567609defe5e.repos/YoobaLandGame`
- `jgriffith3433/sickofitgame-unity`: `../c_567609defe5e.repos/sickofitgame-unity`
- `jgriffith3433/hawkesnet`: `../c_567609defe5e.repos/hawkesnet`
- `jgriffith3433/hawkesnet-js`: `../c_567609defe5e.repos/hawkesnet-js`
- `jgriffith3433/hawkesnet-babylon`: `../c_567609defe5e.repos/hawkesnet-babylon`
- `jgriffith3433/hawkesnet-unity`: `../c_567609defe5e.repos/hawkesnet-unity`
- `jgriffith3433/sickofitgamewebsite`: `../c_567609defe5e.repos/sickofitgamewebsite`
- `jgriffith3433/hawkes-analytics`: `../c_567609defe5e.repos/hawkes-analytics`
- `jgriffith3433/hawkesgen`: `../c_567609defe5e.repos/hawkesgen`
- `jgriffith3433/YoobaLand`: `../c_567609defe5e.repos/YoobaLand`
- `jgriffith3433/hawkesgenwebsite`: `../c_567609defe5e.repos/hawkesgenwebsite`

## What the studio already knows (shared memory)

Earlier agents, J and Talk learned these; follow decisions and preferences, respect canon, and use the lessons
(unconfirmed ones are an earlier agent's notes: check them). More: memory_search, if you have the tool.
- [decision] Replace all GPU-off stand-ins with Gen art: Place Department (Unity), Yooba Land, Hawkes Games: 2026-11-07: J approved all three stand-in replacement items, including GPU budgets (cap about $84 total across 16 tasks, per-task budgets set from hawkesgen_estimate incl. idle tail). Items: i_8935d13bf43e (place-department-unity: kit textures, skies, portraits, UI, Registrar/Plated Alpha, then other bosses/lodgers/~10 landmark kit pieces; keep the other ~150 kit pieces code-built for triangle/te… (m_142d9f54d4cf)
- [decision] No polling: use server push or on-demand fetches: In every product (Studio, Gen, sites, games): never add setInterval/setTimeout loops that fetch. Use a server push stream (SSE: Studio's /api/stream, Gen's /v1/events) or fetch on page open, user action or event. An idle page makes zero requests. Polling through the Cloudflare edge workers burned 100k requests on 2026-11-01. A poll that truly can't be avoided needs a written reason in the PR. (m_4f6d1382b804)
- [decision] Agents must do quality work: design spec first, un-cheatable criteria, vertical slices, forbidden shortcuts, playtest of the experience: After the Place Department campaign came out as the wave game with a text intro, J approved the whole quality plan: (1) a design-spec step (docs/*.md, player fantasy, structure, new vs reused, distinct layouts) before any big build; (2) acceptance criteria a reskin can't pass (observable: different map, no wave timer, explore/talk/pickup before combat); (3) vertical slices (one playable slice, re… (m_7a31fee7272a)
- [preference] Roadmap planning: go deep, aim AAA, don't ask first: For roadmap and milestone planning J wants depth and AAA ambition on story and polish, and no confirmation questions first. Plan and add; report afterwards. 2026-11-06: 19 milestones and 95 items added (5 per project) from backlog findings, memory and project descriptions. (m_7f0b957f00bf)
- [preference] No caching changes for now (Jaycee, Nov 1): Jaycee said on 2026-11-01: "I don't want you to mess with caching right now." Don't add or change Cache-Control, edge/Worker caching or CDN cache rules in any product until they lift this. Internal services must not go through Cloudflare. Gen task k_36c3244487d8 (edge cache for the dashboard) was parked as idea on 2026-11-07 for this reason. (m_92901cfcc7df)
- [lesson] shader precompile must include hidden meshes: `meshShadersReady` (main.ts) skipped disabled meshes, so avatars/handset compiled on first show and hitched with a black frame; check all meshes with material. (m_92123196702f)
- [lesson] Black frame after the veil lifts: Babylon skips meshes whose shader isn't compiled, so revealing before `scene.isReady()` shows clear-colour black on slow GPUs. #107 made `revealFromBlack` wait (8 s cap), but the black after the chapter card persisted; compile under the title card (`whenShadersCompiled` in main.ts, #116) instead of lengthening the veil. (m_b1489738c5ad)
- [lesson] Camera squeeze at corners: a short boom into a wall behind the player needs a fast yaw swing to his heading (thirdPersonCamera.ts squeeze), not just shortening; the wall-probe fixes only moved the lens. (m_0a28c8ba0672)
- [lesson] Start rebuilds the Apex bathroom mirror: `onLevelReady` and `onStart` both ran `mountMirror`, so its materials and 512 px render target were made after the title-card compile pass; compile after `onLevelReady`, and mount once. (m_62e036f3c111)

## How to work

1. Read `AGENTS.md` (and any docs it points to) before changing anything. Follow its rules.
2. Read the story doc and the world bible, then the scenes and data this touches. Plan what goes where, then make it.
3. Keep to this request. Don't refactor unrelated code, don't touch generated output or build folders, don't change secrets, CI, or deploy scripts.
4. Run the project's checks:
- `npm ci && npm run build` (in the repo root)
   If .hawkes/beta-build.md is in your worktree, beta's build was red when Studio last looked: read it first, keep your change from adding to those errors, and say in the PR what you saw.
   Before the pull request, also run the project's build or compile check where you can, and say in the PR description which you ran and which you could not (and why).
   Build `site`: run `export HAWKES_BUILD_COMMIT=$(git rev-parse --short=12 HEAD)&&git ls-files -z|grep -zvE '^(\.github|play|videos)/'>.hsf&&rm -rf .git videos&&npm ci&&npm run build&&rm -rf node_modules&&mkdir _site&&xargs -0a .hsf cp -l --parents -t _site&&cp -al play _site/` if it can run here.
5. Commit your change with a clear message (`Content: ...`). Don't push; Studio does. Studio stops a pass after
   240 minutes: commit as you go (after each working piece or finished batch), so a stop loses nothing.
   A third-party error from a Gen job (ElevenLabs payment_issue, a 401 or 402) is not yours to retry: test ONE line
   first for voice work, and on that error stop at once, write `.hawkes/stuck.md` naming the service, and end.
6. Write `.hawkes/summary.md`: what was wrong, what you changed (files), how you checked it, and anything J should
   look at. If you couldn't fix it, explain why there instead, and don't commit.
   Two approaches, then stop: when two different approaches haven't worked (the checks still fail, or you can't find
   the cause), don't keep iterating. Write `.hawkes/stuck.md` (what you tried, what happened, where you think the cause
   is) and commit nothing that doesn't work: Studio gives the next attempt a bigger model, with your notes.
7. Write `.hawkes/try.md`: how J tries it on the beta site, in two to five short steps a player would follow (where to
   go, what to press, what he should see).
8. If you can't go on without a decision that the request, the criteria and the thread don't settle (a real direction
   choice, not a detail you can decide well yourself), write ONE clear question to `.hawkes/question.md` (the options
   you see and the one you'd pick), commit nothing, and stop. Studio gets you the answer and you continue in this same
   session.
9. Before you finish, write `.hawkes/learned.md`: what the next agent working on this project should know that
   isn't obvious from the code (at most 5 lines, only real knowledge: a trap you hit and how you got past it, how a part of
   the codebase really works, a check that matters). One per line, in this form:
   - lesson: <short title> — <what broke or misled you, and the fix>
   - convention: <short title> — <how this codebase does it>
   Write nothing there if you learned nothing new. Studio keeps these in the shared memory for the next agent.

## The product's story (for tone and intent)


