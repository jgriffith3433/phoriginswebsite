/**
 * First-use warm-up behind the chapter card: shaders are already forced under the title
 * card (`warmStartState`); this pass covers texture upload, particle systems, pooled-prop
 * instantiate, and decoding the level's audio (level JSON, cutscenes, phone scripts).
 *
 * Work is chunked with requestIdleCallback (rAF fallback) — no setInterval polling.
 * Named hitch causes are pushed via `__phFrameMark` so smoke / hitch-board can say why.
 */
import type { AbstractMesh, ParticleSystem, Scene } from '@babylonjs/core';
import phoneCopy from '../story/phone.json';
import { lineAudio, storyLine, storyLines } from './locale';
import { APEX_BOARD, APEX_STAFF, PLACE_SFX } from '../story/placeVoices';
import { TOUCH_SOUNDS } from './touchables';
import { warmPropSources } from './modelLoader';
import { preloadClips, preloadClipsReady } from './sfxMix';

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
  const script = (phoneCopy as { calls?: Record<string, { lines?: { line?: string; audio?: string }[] }> }).calls?.[callId];
  for (const entry of script?.lines ?? []) {
    if (entry.audio) out.add(entry.audio);
    if (entry.line) {
      const audio = lineAudio(entry.line) || storyLine(entry.line)?.audio;
      if (audio) out.add(audio);
    }
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
    const docs = await Promise.all(
      [...ids].map((id) => fetch(`/cutscenes/${id}.json`).then((r) => r.json()).catch(() => null)),
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
  if (performance.now() < deadline) done += await preloadClipsReady(phoneAll, deadline);
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
    if (performance.now() >= deadline) break;
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
    if (performance.now() >= deadline) break;
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
  return warmPropSources(scene, deadline);
};

/** Force-compile every mesh with a material that is not ready yet (hidden ones included). */
const warmShaders = async (scene: Scene, deadline: number): Promise<number> => {
  let shaders = 0;
  for (const mesh of scene.meshes) {
    if (performance.now() >= deadline) break;
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
 * Full first-use warm while the chapter card is up. Caps at `deadline` so the card does not
 * hang more than about +1.5 s past its natural close. Marked as level-setup so hitchFailOver100
 * does not count warm frames as play hitches.
 */
export const warmLevelFirstUse = async (scene: Scene, levelPath: string, deadline: number) => {
  const started = performance.now();
  frameSetup(true, 'chapter-warm');
  try {
    const audio = await warmLevelAudio(levelPath, deadline);
    await idleChunk(8);
    const textures = await warmTextures(scene, deadline);
    await idleChunk(8);
    const particles = await warmParticles(scene, deadline);
    await idleChunk(8);
    const props = await warmProps(scene, deadline);
    // First pass for meshes already in the scene (handset, TV, cutscene props).
    let shaders = await warmShaders(scene, deadline);
    // A late avatar (night cleaner) may finish its GLB after the first pass — give it one more.
    await idleChunk(16);
    shaders += await warmShaders(scene, deadline);
    return {
      ms: Math.round(performance.now() - started),
      audio,
      textures,
      particles,
      props,
      shaders,
    };
  } finally {
    frameSetup(false);
  }
};
