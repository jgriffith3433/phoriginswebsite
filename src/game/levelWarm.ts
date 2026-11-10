/**
 * First-use warm-up behind the chapter card: shaders are already forced under the title
 * card (`warmStartState`); this pass covers texture upload, particle systems, pooled-prop
 * instantiate, and decoding the level's audio (level JSON, cutscenes, phone scripts).
 *
 * Work is chunked with requestIdleCallback (rAF fallback) — no setInterval polling.
 */
import type { AbstractMesh, ParticleSystem, Scene } from '@babylonjs/core';
import phoneCopy from '../story/phone.json';
import { lineAudio, storyLine } from './locale';
import { warmPropSources } from './modelLoader';
import { preloadClips } from './sfxMix';

const frameMark = (cause: string, detail?: string) => {
  try {
    (window as unknown as { __phFrameMark?: (c: string, d?: string) => void }).__phFrameMark?.(cause, detail);
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

/** Fetch + decode the level's one-shots, cutscene VO, and phone scripts (best effort). */
export const warmLevelAudio = async (path: string): Promise<number> => {
  const urls = new Set<string>();
  const ids = new Set<string>();
  try {
    collectAudio(await (await fetch(path)).json(), urls, ids);
    const docs = await Promise.all(
      [...ids].map((id) => fetch(`/cutscenes/${id}.json`).then((r) => r.json()).catch(() => null)),
    );
    for (const doc of docs) collectAudio(doc, urls, ids);
  } catch {
    /* warming is best effort */
  }
  collectPhoneAudio(urls);
  if (urls.size) {
    frameMark('audio-decode', `warm ${urls.size}`);
    preloadClips(urls);
  }
  return urls.size;
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

/**
 * Full first-use warm while the chapter card is up. Caps at `deadline` so the card does not
 * hang more than about +1.5 s past its natural close.
 */
export const warmLevelFirstUse = async (scene: Scene, levelPath: string, deadline: number) => {
  const started = performance.now();
  const audio = await warmLevelAudio(levelPath);
  await idleChunk(8);
  const textures = await warmTextures(scene, deadline);
  await idleChunk(8);
  const particles = await warmParticles(scene, deadline);
  await idleChunk(8);
  const props = await warmProps(scene, deadline);
  // Any mesh still missing an effect (TV, cutscene-only, handset) — force compile in idle chunks.
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
  return {
    ms: Math.round(performance.now() - started),
    audio,
    textures,
    particles,
    props,
    shaders,
  };
};
