/**
 * First-use warm-up behind the chapter card, and under Tap to play before the cold open:
 * shaders are already forced at load (`warmStartState`); this pass covers texture upload,
 * particle systems, pooled-prop instantiate, fade-variant compiles, the B3 corridor and
 * creature (cold open), and decoding the level's audio (level JSON, cutscenes, phone, creature SFX).
 *
 * Work is chunked with requestIdleCallback (rAF fallback) — no setInterval polling.
 * Named hitch causes are pushed via `__phFrameMark` so smoke / hitch-board / first-five can say why.
 */
import type { AbstractMesh, AnimationGroup, Effect, Material, ParticleSystem, Scene, TransformNode } from '@babylonjs/core';
import { isFadeCandidate } from './cameraVolumes';
import phoneCopy from '../story/phone.json';
import { lineAudio, storyLine, storyLines } from './locale';
import { APEX_BOARD, APEX_STAFF, PLACE_SFX } from '../story/placeVoices';
import { TOUCH_SOUNDS } from './touchables';
import { warmPropSources } from './modelLoader';
import { preloadClips, preloadClipsReady } from './sfxMix';
import { loadCutsceneTimeline } from './cutscenes';

const frameMark = (cause: string, detail?: string) => {
  try {
    (window as unknown as { __phFrameMark?: (c: string, d?: string) => void }).__phFrameMark?.(cause, detail);
  } catch { /* playtest not installed */ }
};

const frameSetup = (on: boolean, detail?: string) => {
  try {
    (window as unknown as { __phFrameSetup?: (on: boolean, detail?: string) => void })
      .__phFrameSetup?.(on, detail);
  } catch { /* playtest not installed */ }
};

const AUDIO_URL = /^\/?assets\/audio\/[^"]+\.(?:wav|ogg|mp3)$/;
/** Beds stay on <audio>; warming them here fights the music trigger. */
const SKIP_BED = /\/(?:ambient|ending-)|room-tone|drone|rumble/;

const PHONE_TONES = [
  '/assets/audio/sfx/phone/dial.wav',
  '/assets/audio/sfx/phone/ringback.wav',
  '/assets/audio/sfx/phone/busy.wav',
  '/assets/audio/sfx/phone/hangup.wav',
  '/assets/audio/sfx/phone/ring.wav',
  '/assets/audio/sfx/phone/connect.wav',
  '/assets/audio/sfx/phone-out.ogg',
  '/assets/audio/sfx/phone-away.ogg',
  '/assets/audio/sfx/flashlight.ogg',
  '/assets/audio/sfx/flashlight-off.ogg',
];

/** First-play one-shots that live in story code, not level JSON (doors, apex slice, UI). */
const COMMON_EXTRA = [
  '/assets/audio/sfx/start.ogg',
  '/assets/audio/sfx/objective.ogg',
  ...(['carpet', 'tile', 'concrete', 'train'] as const).flatMap((k) => [1, 2, 3, 4].map((i) => `/assets/audio/sfx/step/${k}-${i}.ogg`)),
  '/assets/audio/sfx/jump.ogg',
  '/assets/audio/cutscenes/elevator-b3/doors.wav',
  '/assets/audio/cutscenes/elevator-b3/beep.wav',
  '/assets/audio/cutscenes/elevator-b3/hum.wav',
];

/** Locale lines a level's story code plays by id (not named in its JSON or timelines): first play must not decode. */
const lineAudioWithPrefix = (prefixes: string[], out: Set<string>) => {
  for (const row of storyLines()) {
    if (row.audio && prefixes.some((prefix) => row.id.startsWith(prefix))) out.add(row.audio.startsWith('/') ? row.audio : `/${row.audio}`);
  }
};

const APEX_EXTRA = [
  '/assets/audio/sfx/apex/sofa-creak.ogg',
  '/assets/audio/sfx/apex/cart-wheels.ogg',
  '/assets/audio/sfx/apex/screen-tap.ogg',
  '/assets/audio/sfx/apex/skyline.ogg',
  '/assets/audio/sfx/apex/troffer-flicker.ogg',
];

/** Level 1's scenes (the board meeting, the window, the terminal, the ride down). */
const APEX_CUTSCENES = ['room-for-grace', 'apex-window', 'apex-terminal', 'elevator-b3'];

/** B3 story scenes: the lab door reveal and the vat break (also feed the cold open's scream). */
const B3_CUTSCENES = ['b3-door-reveal', 'b3-vat-break'];

/**
 * Cold-open / hunt one-shots live in story code, not level JSON. Without these the first skitter,
 * doorway breath and rush shriek decode mid-chase (2–5 fps on a phone).
 */
const B3_CREATURE_SFX = [
  '/assets/audio/sfx/creature/skitter.wav',
  '/assets/audio/sfx/creature/scrape.wav',
  '/assets/audio/sfx/creature/hiss.wav',
  '/assets/audio/sfx/creature/shriek.wav',
  '/assets/audio/sfx/creature/cry.wav',
  '/assets/audio/sfx/creature/heartbeat.wav',
  '/assets/audio/sfx/creature/snarl.wav',
  '/assets/audio/sfx/creature/wound.wav',
  '/assets/audio/sfx/creature/tick.wav',
  '/assets/audio/sfx/creature/knock.wav',
  '/assets/audio/sfx/creature/chitter.wav',
  '/assets/audio/cutscenes/b3-door-reveal/creature-breath.wav',
  '/assets/audio/cutscenes/b3-door-reveal/creature-run.wav',
  '/assets/audio/cutscenes/b3-vat-break/04-pierce-scream.ogg',
  '/assets/audio/sfx/glass-tick.ogg',
];

/**
 * Set once the level is running: warming then would compile shaders / upload textures on the render thread
 * mid-play (multi-second frames on slow GPUs). Every loop below stops at the next step.
 */
let stopped = false;
export const stopLevelWarm = () => { stopped = true; };
const over = (deadline: number) => stopped || performance.now() >= deadline;

/** Yield until the browser is idle (or the next frame). No polling. */
export const idleChunk = (budgetMs = 16): Promise<void> =>
  new Promise((resolve) => {
    const ric = (window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (typeof ric === 'function') {
      ric(() => resolve(), { timeout: Math.max(8, budgetMs) });
      return;
    }
    requestAnimationFrame(() => resolve());
  });

const collectAudio = (node: unknown, out: Set<string>, cutsceneIds: Set<string>) => {
  if (typeof node === 'string') {
    if (AUDIO_URL.test(node) && !SKIP_BED.test(node)) out.add(node.startsWith('/') ? node : `/${node}`);
    // Locale / phone line ids: "dialogue.room-for-grace.01", "phone.voss-late.01".
    else if (/^(?:dialogue|phone|bark|shout|hud)\./.test(node)) {
      const audio = lineAudio(node);
      if (audio) out.add(audio);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectAudio(v, out, cutsceneIds);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'cutscene' && typeof v === 'string') cutsceneIds.add(v);
      if (k === 'line' && typeof v === 'string') {
        const audio = lineAudio(v);
        if (audio) out.add(audio);
      }
      collectAudio(v, out, cutsceneIds);
    }
  }
};

const collectPhoneAudio = (out: Set<string>) => {
  for (const tone of PHONE_TONES) out.add(tone);
  const calls = (phoneCopy as { calls?: Record<string, { lines?: { line?: string; audio?: string }[] }> }).calls;
  if (!calls) return;
  for (const script of Object.values(calls)) {
    for (const entry of script.lines ?? []) {
      if (entry.audio) out.add(entry.audio);
      if (entry.line) {
        const audio = lineAudio(entry.line) || storyLine(entry.line)?.audio;
        if (audio) out.add(audio);
      }
    }
  }
};

const addCallLines = (callId: string, out: Set<string>) => {
  type Row = { line?: string; audio?: string; answer?: string; alt?: Row[] };
  type Script = { lines?: Row[]; replies?: { options?: Row[]; silence?: Row }[] };
  const script = (phoneCopy as { calls?: Record<string, Script> }).calls?.[callId];
  const add = (id?: string) => {
    if (!id) return;
    const audio = lineAudio(id) || storyLine(id)?.audio;
    if (audio) out.add(audio);
  };
  for (const entry of script?.lines ?? []) {
    if (entry.audio) out.add(entry.audio);
    add(entry.line);
    for (const alt of entry.alt ?? []) add(alt.line);
  }
  // Reply moments: each option's Pierce line and answer, and the silence answer.
  for (const moment of script?.replies ?? []) {
    for (const option of moment.options ?? []) {
      add(option.line);
      add(option.answer);
    }
    add(moment.silence?.answer);
  }
};

const addExtras = (path: string, out: Set<string>) => {
  for (const url of COMMON_EXTRA) out.add(url);
  if (/apex-peak/i.test(path)) {
    for (const url of APEX_EXTRA) out.add(url);
    const cleaner = lineAudio('bark.apex.cleaner') || storyLine('bark.apex.cleaner')?.audio;
    if (cleaner) out.add(cleaner);
    const papers = lineAudio('bark.apex.papers') || storyLine('bark.apex.papers')?.audio;
    if (papers) out.add(papers);
    // Rings the moment Level 1 starts — must decode under the card, not on first ring.
    addCallLines('voss-late', out);
    // The board's talk, the guard and staff remarks, and what Interact answers with.
    for (const id of [...APEX_BOARD, ...APEX_STAFF]) {
      const audio = lineAudio(id);
      if (audio) out.add(audio);
    }
    for (const url of TOUCH_SOUNDS) out.add(url);
    out.add('/assets/audio/sfx/home/door-open.ogg');
  } else if (/the-desk|the-return/i.test(path)) {
    for (const url of APEX_EXTRA) out.add(url);
    if (/the-desk/i.test(path)) {
      lineAudioWithPrefix(['dialogue.desk.', 'bark.desk.'], out);
      out.add('/assets/audio/sfx/home/door-open.ogg');
    }
  } else if (/the-morning/i.test(path)) {
    addCallLines('voss-morning', out);
    lineAudioWithPrefix(['dialogue.morning.', 'news.morning.'], out);
    for (const url of Object.values(PLACE_SFX)) out.add(url);
    out.add('/assets/audio/train/rumble.ogg');
    out.add('/assets/audio/train/brakes.ogg');
    out.add('/assets/audio/train/doors-open.ogg');
  } else if (/the-train/i.test(path)) {
    addCallLines('hale-train', out);
  } else if (/the-station/i.test(path)) {
    addCallLines('hale-board', out);
  } else if (/b3-basement/i.test(path)) {
    for (const url of B3_CREATURE_SFX) out.add(url);
    lineAudioWithPrefix(['dialogue.b3-', 'bark.b3.', 'shout.b3.'], out);
  }
};

/** Fetch + decode the level's one-shots, cutscene VO, and phone scripts (awaits decode up to deadline). */
export const warmLevelAudio = async (path: string, deadline = Infinity): Promise<number> => {
  // Priority: level + cutscene VO first (spawn→board), then tones/extras, then every phone script.
  const primary = new Set<string>();
  const secondary = new Set<string>();
  const ids = new Set<string>();
  try {
    collectAudio(await (await fetch(path)).json(), primary, ids);
    // Apex's story scenes start from walk-ups, not always from a trigger in the level file: name them too.
    if (/apex-peak/i.test(path)) for (const id of APEX_CUTSCENES) ids.add(id);
    // Cold open and the hunt play creature SFX from code; the reveal/vat timelines hold the rest of the VO.
    if (/b3-basement/i.test(path)) for (const id of B3_CUTSCENES) ids.add(id);
    // `loadCutsceneTimeline` caches the parsed timeline, so a scene starting mid-walk does no fetch or JSON parse.
    const docs = await Promise.all(
      [...ids].map((id) => loadCutsceneTimeline(id).catch(() => null)),
    );
    for (const doc of docs) collectAudio(doc, primary, ids);
  } catch {
    /* warming is best effort */
  }
  for (const tone of PHONE_TONES) secondary.add(tone);
  addExtras(path, secondary);
  const phoneAll = new Set<string>();
  collectPhoneAudio(phoneAll);
  // Tones already in secondary; drop them from the bulk phone set.
  for (const tone of PHONE_TONES) phoneAll.delete(tone);

  const total = primary.size + secondary.size + phoneAll.size;
  if (!total) return 0;
  frameMark('audio-decode', `warm ${total}`);
  let done = await preloadClipsReady(primary, deadline);
  done += await preloadClipsReady(secondary, deadline);
  // Bulk phone scripts: await what fits, fire the rest so decode starts under the card.
  if (!over(deadline)) done += await preloadClipsReady(phoneAll, deadline);
  else preloadClips(phoneAll);
  return done;
};

/**
 * Touch every loaded texture so the GPU upload happens under the chapter card, not mid-walk.
 * Chunked so a big office level does not stall one frame.
 */
export const warmTextures = async (scene: Scene, deadline: number): Promise<number> => {
  let done = 0;
  const textures = scene.textures.slice();
  for (let i = 0; i < textures.length; i += 1) {
    if (over(deadline)) break;
    const texture = textures[i];
    if (!texture) continue;
    try {
      if (!texture.isReady()) continue;
      // Reading the internal texture forces the engine to finish the GPU upload.
      texture.getInternalTexture?.();
      done += 1;
    } catch { /* ignore */ }
    if (i % 8 === 7) await idleChunk(12);
  }
  return done;
};

/**
 * Start (or briefly advance) every particle system so its effect compiles now.
 * Systems that were already running stay running.
 */
export const warmParticles = async (scene: Scene, deadline: number): Promise<number> => {
  const systems = (scene.particleSystems ?? []) as ParticleSystem[];
  let done = 0;
  for (const system of systems) {
    if (over(deadline)) break;
    try {
      const wasStarted = system.isStarted?.() ?? false;
      if (!wasStarted) system.start();
      // One animate tick builds buffers / compiles the particle effect.
      system.animate?.(true);
      if (!wasStarted) system.stop();
      const emitter = system.emitter as AbstractMesh | null | undefined;
      if (emitter && typeof emitter === 'object' && 'material' in emitter && emitter.material) {
        await emitter.material.forceCompilationAsync?.(emitter).catch(() => undefined);
      }
      done += 1;
    } catch { /* ignore */ }
    await idleChunk(8);
  }
  return done;
};

/** Instantiate (then dispose) one copy of each cached static-prop GLB so the first mid-level spawn is cheap. */
export const warmProps = async (scene: Scene, deadline: number): Promise<number> => {
  frameMark('asset-load', 'warm-props');
  return warmPropSources(scene, deadline, () => stopped);
};

/** Force-compile every mesh with a material that is not ready yet (hidden ones included). */
const warmShaders = async (scene: Scene, deadline: number): Promise<number> => {
  let shaders = 0;
  for (const mesh of scene.meshes) {
    if (over(deadline)) break;
    if (mesh.getTotalVertices() === 0 || !mesh.material) continue;
    if (mesh.isReady(true)) continue;
    frameMark('shader-compile', mesh.name);
    await mesh.material.forceCompilationAsync(mesh).catch(() => undefined);
    shaders += 1;
    await idleChunk(8);
  }
  return shaders;
};

/**
 * Cold open: Pierce walks the B3 long hall while the creature crosses the lit doorway, then rushes.
 * Force-compile that corridor and the creature (including walk/attack clips) so the first show does
 * not compile mid-chase. The creature starts enabled under the Tap to play veil; beginColdOpen hides it.
 */
const COLD_HALL = { minX: 10, maxX: 46, minZ: 32, maxZ: 44 };
const clipByTail = (groups: AnimationGroup[] | undefined, tail: string) =>
  groups?.find((group) => group.name.toLowerCase().endsWith(tail.toLowerCase()) || new RegExp(tail, 'i').test(group.name));

const warmCorridorAndCreature = async (scene: Scene, deadline: number): Promise<number> => {
  let done = 0;
  const creatureRoots = scene.transformNodes.filter((node): node is TransformNode => {
    const id = (node.metadata as { sceneAssetId?: string } | undefined)?.sceneAssetId;
    return id === 'b3-creature' || /^b3-creature/i.test(node.name);
  });
  for (const root of creatureRoots) {
    if (over(deadline)) break;
    const wasEnabled = root.isEnabled();
    root.setEnabled(true);
    const groups = (root.metadata as { clipGroups?: AnimationGroup[] } | undefined)?.clipGroups;
    const idle = clipByTail(groups, 'idle');
    const walk = clipByTail(groups, 'walk');
    const attack = clipByTail(groups, 'attack');
    // Scrub the chase clips once so their pose buffers exist before the doorway pass.
    for (const clip of [walk, attack]) {
      if (!clip || over(deadline)) break;
      try {
        for (const other of groups ?? []) if (other !== clip && other.isPlaying) other.stop();
        clip.speedRatio = 1;
        clip.stop();
        clip.start(false);
        clip.stop();
      } catch { /* best effort */ }
    }
    if (idle) {
      try {
        idle.speedRatio = 1;
        idle.start(true);
      } catch { /* ignore */ }
    }
    for (const mesh of root.getChildMeshes(true)) {
      if (over(deadline)) break;
      if (mesh.getTotalVertices() === 0 || !mesh.material) continue;
      frameMark('shader-compile', mesh.name || 'creature');
      await mesh.material.forceCompilationAsync(mesh).catch(() => undefined);
      done += 1;
      await idleChunk(8);
    }
    if (!wasEnabled) root.setEnabled(false);
  }
  // Long hall walls, floors, the lab door frame and the practical that fails — first camera look.
  for (const mesh of scene.meshes) {
    if (over(deadline)) break;
    if (mesh.getTotalVertices() === 0 || !mesh.material) continue;
    const p = mesh.getAbsolutePosition();
    if (p.x < COLD_HALL.minX || p.x > COLD_HALL.maxX || p.z < COLD_HALL.minZ || p.z > COLD_HALL.maxZ) continue;
    if (mesh.isReady(true)) continue;
    frameMark('shader-compile', mesh.name || 'hall');
    await mesh.material.forceCompilationAsync(mesh).catch(() => undefined);
    done += 1;
    await idleChunk(8);
  }
  return done;
};

/**
 * The camera's occlusion fader dims a wall, door frame or prop by lowering `mesh.visibility`. Below 1 the mesh draws in
 * the alpha-blend pass and its material compiles a second shader (`ALPHABLEND` is a define), so the first time a wall
 * fades mid-walk the render thread compiled it: a 100+ ms frame. Compile that variant now: each candidate's material is
 * asked for a ready effect with visibility briefly 0.99 (synchronously, then restored), and we wait for those effects.
 */
const FADE_PROBE_VISIBILITY = 0.99;
const NO_IGNORE = new Set<AbstractMesh>();
const warmFadeVariants = async (scene: Scene, deadline: number): Promise<number> => {
  const seen = new Set<Material>();
  const effects = new Set<Effect>();
  let probed = 0;
  for (const mesh of scene.meshes) {
    if (over(deadline)) break;
    if (mesh.getTotalVertices() === 0 || !mesh.material) continue;
    // Hidden meshes can fade later too, so do not require `isEnabled()` for the material key; the candidate test does.
    if (!isFadeCandidate(mesh, NO_IGNORE)) continue;
    const before = mesh.visibility;
    mesh.visibility = FADE_PROBE_VISIBILITY;
    try {
      for (const sub of mesh.subMeshes ?? []) {
        const material = sub.getMaterial();
        if (!material || seen.has(material)) continue;
        seen.add(material);
        // Each probe starts a synchronous compile (tens of ms on a phone): one per idle slice, never four in a task.
        if (++probed > 1) await idleChunk(8);
        try {
          material.isReadyForSubMesh(mesh, sub, !!mesh.hasInstances);
        } catch { /* best effort */ }
        if (sub.effect) effects.add(sub.effect);
      }
    } finally {
      mesh.visibility = before;
    }
  }
  if (effects.size === 0) return 0;
  frameMark('shader-compile', `fade variants ${effects.size}`);
  let timer = 0;
  await Promise.race([
    Promise.all([...effects].map((effect) => new Promise<void>((resolve) => effect.executeWhenCompiled(() => resolve())))),
    new Promise<void>((resolve) => { timer = window.setTimeout(resolve, Math.max(0, deadline - performance.now())); }),
  ]);
  window.clearTimeout(timer);
  return effects.size;
};

/**
 * Full first-use warm while the chapter card is up (or under Tap to play before the cold open).
 * Caps at `deadline` so Start / the hall is not held long. Marked as level-setup so hitchFailOver100
 * does not count warm frames as play hitches.
 */
export const warmLevelFirstUse = async (scene: Scene, levelPath: string, deadline: number) => {
  const started = performance.now();
  stopped = false;
  const cold = /b3-basement/i.test(levelPath);
  frameSetup(true, cold ? 'cold-warm' : 'chapter-warm');
  try {
    // Shaders first: a compile on the render thread is the hitch a player sees, while audio decode and texture
    // upload cost little when late. On a slow GPU the deadline can cut this pass short, so the order matters.
    // Decode runs off the main thread: start it now, await it last.
    const audioDone = warmLevelAudio(levelPath, deadline);
    let shaders = await warmShaders(scene, deadline);
    // Cold open: corridor + creature walk/attack before control, so the doorway pass does not compile mid-chase.
    if (cold) shaders += await warmCorridorAndCreature(scene, deadline);
    // The alpha-blend variant the occlusion fader switches to, so the first wall that fades does not compile.
    shaders += await warmFadeVariants(scene, deadline);
    await idleChunk(8);
    const textures = await warmTextures(scene, deadline);
    await idleChunk(8);
    const particles = await warmParticles(scene, deadline);
    await idleChunk(8);
    const props = await warmProps(scene, deadline);
    // Props just instantiated and late avatars (night cleaner) may add meshes: one more shader pass.
    await idleChunk(16);
    shaders += await warmShaders(scene, deadline);
    const audio = await audioDone;
    return {
      ms: Math.round(performance.now() - started),
      audio,
      textures,
      particles,
      props,
      shaders,
      cold: cold || undefined,
    };
  } finally {
    frameSetup(false);
  }
};
