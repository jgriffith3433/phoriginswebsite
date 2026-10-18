import catalog from '../../locales/sfx.json';
import { busInput, getSharedAudioContext } from './audioUnlock';
import type { SoundBus } from './soundSettings';

/**
 * `volume` on a sound effect is its full playback level. Preview plays that.
 * Calls still pass the level they were written at (`peak`). Hearing is
 * `volume * (requested / peak)`, so a slider left on the shipped level
 * does not change the mix, and a distance fade still scales.
 */
const PEAKS: Record<string, number> = {
  '/assets/audio/sfx/pistol-shot.ogg': 0.78,
  '/assets/audio/sfx/pistol-draw.ogg': 0.55,
  '/assets/audio/sfx/pistol-holster.ogg': 0.55,
  '/assets/audio/sfx/jump.ogg': 0.42,
  '/assets/audio/sfx/hurt.ogg': 0.45,
  '/assets/audio/sfx/reload.ogg': 0.5,
  '/assets/audio/sfx/walk.ogg': 0.28,
  '/assets/audio/sfx/start.ogg': 0.7,
  '/assets/audio/sfx/objective.ogg': 0.55,
  '/assets/audio/sfx/level-complete.ogg': 0.55,
  '/assets/audio/sfx/flashlight.ogg': 0.4,
  '/assets/audio/sfx/flashlight-off.ogg': 0.4,
  '/assets/audio/sfx/phone-out.ogg': 0.45,
  '/assets/audio/sfx/phone-away.ogg': 0.45,
  '/assets/audio/sfx/punch.ogg': 0.55,
  '/assets/audio/sfx/kick.ogg': 0.55,
  '/assets/audio/sfx/phone/dial.wav': 0.42,
  '/assets/audio/sfx/phone/ringback.wav': 0.4,
  '/assets/audio/sfx/phone/busy.wav': 0.42,
  '/assets/audio/sfx/phone/hangup.wav': 0.45,
  '/assets/audio/sfx/phone/ring.wav': 0.5,
  '/assets/audio/sfx/phone/connect.wav': 0.4,
  '/assets/audio/sfx/street/shadow-on.wav': 0.4,
  '/assets/audio/sfx/street/shadow-off.wav': 0.4,
  '/assets/audio/sfx/street/shock.wav': 0.5,
  '/assets/audio/sfx/street/possess.wav': 0.4,
  '/assets/audio/sfx/street/consume.wav': 0.46,
  '/assets/audio/sfx/street/death.wav': 0.42,
  '/assets/audio/sfx/street/car-pass.wav': 0.2,
  '/assets/audio/sfx/street/shop-bell.wav': 0.32,
  '/assets/audio/sfx/street/shadow-run.ogg': 0.4,
  '/assets/audio/sfx/street/scream-woman.ogg': 0.72,
  '/assets/audio/sfx/street/scream-man.ogg': 0.72,
  '/assets/audio/sfx/street/scream-man-b.ogg': 0.72,
  '/assets/audio/sfx/street/scream-police.ogg': 0.72,
  '/assets/audio/cutscenes/elevator-b3/hum.wav': 0.3,
  '/assets/audio/cutscenes/elevator-b3/beep.wav': 0.7,
  '/assets/audio/cutscenes/elevator-b3/doors.wav': 0.65,
  '/assets/audio/cutscenes/elevator-b3/rumble.wav': 0.38,
  '/assets/audio/cutscenes/apex-window/alarm.wav': 0.46,
  '/assets/audio/sfx/creature/skitter.wav': 0.3,
  '/assets/audio/sfx/creature/scrape.wav': 0.37,
  '/assets/audio/sfx/creature/hiss.wav': 0.58,
  '/assets/audio/sfx/creature/shriek.wav': 0.78,
  '/assets/audio/sfx/creature/cry.wav': 0.2,
  '/assets/audio/sfx/creature/heartbeat.wav': 0.55,
  '/assets/audio/sfx/creature/snarl.wav': 0.7,
  '/assets/audio/sfx/creature/wound.wav': 0.62,
  '/assets/audio/sfx/creature/tick.wav': 0.24,
  '/assets/audio/sfx/creature/knock.wav': 0.16,
  '/assets/audio/sfx/creature/chitter.wav': 0.26,
  '/assets/audio/sfx/glass-tick.ogg': 0.5,
  '/assets/audio/cutscenes/b3-door-reveal/creature-breath.wav': 0.38,
  '/assets/audio/cutscenes/b3-door-reveal/creature-run.wav': 0.55,
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

const clean = (url: string) => url.split('?')[0];

const levels = new Map<string, number>();
for (const effect of catalog.effects as { audio?: string; volume?: number }[]) {
  if (!effect.audio || typeof effect.volume !== 'number') continue;
  levels.set(effect.audio, effect.volume);
}

export const mixVolume = (url: string, requested: number) => {
  const set = levels.get(clean(url));
  if (set == null) return clamp(requested);
  const peak = PEAKS[clean(url)];
  if (peak == null || peak <= 0) return clamp(requested * set);
  return clamp(set * (requested / peak));
};

export type LoopHandle = {
  setVolume: (volume: number) => void;
  stop: () => void;
};

/**
 * Decoded clips, one per URL. A buffer plays through Web Audio at any time once the shared context is running
 * (the Tap to play prompt starts it), so on a phone a clip no longer needs a finger on the screen the way a fresh
 * <audio> element does. Long music beds stay on elements (triggers.ts, the ending song); this cache is bounded.
 */
type BufferEntry = { pending: Promise<AudioBuffer>; bytes: number };
const buffers = new Map<string, BufferEntry>();
const BUFFER_BUDGET = 48 * 1024 * 1024;
let bufferBytes = 0;

const trimBuffers = () => {
  for (const [url, entry] of buffers) {
    if (bufferBytes <= BUFFER_BUDGET) return;
    if (!entry.bytes) continue;
    bufferBytes -= entry.bytes;
    buffers.delete(url);
  }
};

const loadBuffer = (url: string, ctx: AudioContext) => {
  const known = buffers.get(url);
  if (known) {
    // Most recently used goes last; the oldest is trimmed first.
    buffers.delete(url);
    buffers.set(url, known);
    return known.pending;
  }
  const entry: BufferEntry = { pending: Promise.resolve() as unknown as Promise<AudioBuffer>, bytes: 0 };
  entry.pending = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.arrayBuffer();
    })
    .then((data) => new Promise<AudioBuffer>((resolve, reject) => {
      // Older Safari only has the callback form.
      const result = ctx.decodeAudioData(data.slice(0), resolve, reject);
      if (result && typeof result.then === 'function') result.then(resolve, reject);
    }))
    .then((buffer) => {
      if (buffers.get(url) === entry) {
        entry.bytes = buffer.length * buffer.numberOfChannels * 4;
        bufferBytes += entry.bytes;
        trimBuffers();
      }
      return buffer;
    })
    .catch((error) => {
      if (buffers.get(url) === entry) buffers.delete(url);
      throw error;
    });
  buffers.set(url, entry);
  return entry.pending;
};

/** Fetch and decode ahead of time, so the first play of a cutscene line or a footstep starts on cue. */
export const preloadClips = (urls: Iterable<string>) => {
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  for (const url of urls) {
    if (url) void loadBuffer(clean(url), ctx).catch(() => {});
  }
};

export type ClipHandle = {
  setVolume: (volume: number, ramp?: number) => void;
  stop: (fade?: number) => void;
  /** True once it finished, was stopped, or failed to load. */
  done: () => boolean;
};

type LiveClip = {
  ctx: AudioContext;
  buffer: AudioBuffer | null;
  loop: boolean;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  startedAt: number;
  offset: number;
  held: boolean;
  stopping: boolean;
  finished: boolean;
  onEnded?: () => void;
};

const liveClips = new Set<LiveClip>();
let clipsHeld = false;

const disconnect = (node: AudioNode | null) => {
  try { node?.disconnect(); } catch { /* already */ }
};

const finish = (clip: LiveClip, ended: boolean) => {
  if (clip.finished) return;
  clip.finished = true;
  liveClips.delete(clip);
  disconnect(clip.source);
  disconnect(clip.gain);
  clip.source = null;
  clip.buffer = null;
  if (ended) clip.onEnded?.();
};

const startSource = (clip: LiveClip) => {
  if (!clip.buffer || clip.finished) return;
  const source = clip.ctx.createBufferSource();
  source.buffer = clip.buffer;
  source.loop = clip.loop;
  source.connect(clip.gain);
  const offset = clip.loop ? clip.offset % clip.buffer.duration : clip.offset;
  if (!clip.loop && offset >= clip.buffer.duration) {
    finish(clip, true);
    return;
  }
  source.onended = () => {
    if (clip.source !== source || clip.held) return;
    finish(clip, true);
  };
  clip.source = source;
  clip.startedAt = clip.ctx.currentTime - offset;
  source.start(0, offset);
};

const pauseSource = (clip: LiveClip) => {
  if (!clip.source) return;
  clip.offset = clip.ctx.currentTime - clip.startedAt;
  const source = clip.source;
  clip.source = null;
  try { source.stop(); } catch { /* not started */ }
  disconnect(source);
};

/**
 * Plays a clip through Web Audio on a sound bus. `volume` is the level after mixVolume. Returns null when the
 * browser has no Web Audio; onError fires when the file is missing or will not decode, so the caller can fall
 * back. Everything it made is disconnected when it ends or stops.
 */
export const playClip = (
  url: string,
  volume: number,
  options: { loop?: boolean; bus?: SoundBus; onEnded?: () => void; onError?: () => void } = {},
): ClipHandle | null => {
  const ctx = getSharedAudioContext();
  if (!ctx) return null;
  const gain = ctx.createGain();
  gain.gain.value = clamp(volume);
  gain.connect(busInput(ctx, options.bus ?? 'sfx'));
  const clip: LiveClip = {
    ctx,
    buffer: null,
    loop: options.loop === true,
    gain,
    source: null,
    startedAt: 0,
    offset: 0,
    held: clipsHeld,
    stopping: false,
    finished: false,
    onEnded: options.onEnded,
  };
  liveClips.add(clip);
  loadBuffer(clean(url), ctx).then((buffer) => {
    if (clip.finished) return;
    clip.buffer = buffer;
    if (!clip.held) startSource(clip);
  }, () => {
    if (clip.finished) return;
    finish(clip, false);
    options.onError?.();
  });
  return {
    setVolume: (next, ramp = 0) => {
      if (clip.finished) return;
      const value = clamp(next);
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      if (ramp > 0) {
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(value, now + ramp);
      } else {
        gain.gain.value = value;
      }
    },
    stop: (fade = 0) => {
      if (clip.finished) return;
      if (fade > 0 && clip.source) {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.linearRampToValueAtTime(0.0001, now + fade);
        const source = clip.source;
        clip.stopping = true;
        try { source.stop(now + fade + 0.01); } catch { /* already */ }
        source.onended = () => {
          disconnect(source);
          finish(clip, false);
        };
        return;
      }
      pauseSource(clip);
      finish(clip, false);
    },
    done: () => clip.finished,
  };
};

/** Pause holds every Web Audio clip where it is; release picks each one up from there. */
export const holdClips = () => {
  clipsHeld = true;
  for (const clip of [...liveClips]) {
    if (clip.stopping) {
      pauseSource(clip);
      finish(clip, false);
      continue;
    }
    if (clip.held) continue;
    clip.held = true;
    pauseSource(clip);
  }
};

export const releaseClips = () => {
  clipsHeld = false;
  for (const clip of [...liveClips]) {
    if (!clip.held) continue;
    clip.held = false;
    startSource(clip);
  }
};

/** Live Web Audio clips (the playtest's audio counts). */
export const liveClipCount = () => liveClips.size;

/** Sample-locked loop. An element loop leaves a gap in a cab hum. */
export const startGaplessLoop = async (url: string, volume: number): Promise<LoopHandle | null> => {
  const ctx = getSharedAudioContext();
  if (!ctx) return null;
  try {
    await loadBuffer(clean(url), ctx);
  } catch {
    return null;
  }
  const handle = playClip(url, volume, { loop: true });
  if (!handle) return null;
  return {
    setVolume: (next) => handle.setVolume(next, 0.18),
    stop: () => handle.stop(0.12),
  };
};
