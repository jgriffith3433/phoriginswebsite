/** iOS/Safari block AudioContext and HTMLAudio.play() until a user gesture; unlock once so later cutscene clips can play. */

import { busLevel, onSoundSettings, type SoundBus } from './soundSettings';

const SILENCE_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

let unlocked = false;
let silent: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
let installed = false;

const AudioCtor = (): (typeof AudioContext) | undefined =>
  window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

const resumeContext = () => {
  const Ctor = AudioCtor();
  if (!Ctor) return;
  if (!ctx) {
    // game.html's Tap to play prompt starts a context itself when the tap beats this module.
    const early = (window as typeof window & { __phTap?: { ctx?: AudioContext | null } }).__phTap?.ctx;
    ctx = early ?? new Ctor();
    // iOS marks the context 'interrupted' after a call, Siri or a lock, and it can drop back to 'suspended'.
    // Once the player has tapped, take it back as soon as the page is in front again.
    ctx.addEventListener('statechange', () => {
      if (unlocked && !document.hidden && ctx && ctx.state !== 'running') void ctx.resume().catch(() => {});
    });
  }
  // iOS also reports 'interrupted' after a call, a lock or a tab switch.
  if ((ctx.state as string) !== 'running') void ctx.resume().catch(() => {});
};

/**
 * iOS only lets an HTMLAudio element play outside a touch if that element was started during one.
 * Prime a pool on every gesture; createUnlockedAudio hands them out, so a cutscene voice line can start
 * while the player's thumbs are off the screen.
 */
const POOL_SIZE = 32;
const pool: HTMLAudioElement[] = [];
let priming = 0;

const primePool = () => {
  while (pool.length + priming < POOL_SIZE) {
    const element = new Audio(SILENCE_WAV);
    element.preload = 'auto';
    element.muted = true;
    element.setAttribute('playsinline', 'true');
    priming += 1;
    const done = (ok: boolean) => {
      priming -= 1;
      element.pause();
      element.currentTime = 0;
      if (ok) pool.push(element);
    };
    const play = element.play();
    if (play && typeof play.then === 'function') {
      void play.then(() => done(true), () => done(false));
    } else {
      done(true);
    }
  }
};

const unlockHtmlAudio = () => {
  if (!silent) {
    silent = new Audio(SILENCE_WAV);
    silent.preload = 'auto';
    silent.muted = true;
    silent.setAttribute('playsinline', 'true');
  }
  silent.currentTime = 0;
  const play = silent.play();
  if (play && typeof play.then === 'function') {
    void play.then(() => {
      silent?.pause();
      if (silent) silent.currentTime = 0;
      unlocked = true;
    }).catch(() => {});
  } else {
    silent.pause();
    silent.currentTime = 0;
    unlocked = true;
  }
};

const unlockBuffer = () => {
  if (!ctx) return;
  try {
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // Ignore — gesture may still have resumed the context.
  }
};

export const isAudioUnlocked = () => unlocked;

/** 'running' once a tap has unlocked sound; 'none' when the browser has no Web Audio. */
export const audioContextState = (): string => ctx?.state ?? 'none';

export const getSharedAudioContext = (): AudioContext | undefined => {
  resumeContext();
  return ctx ?? undefined;
};

export const unlockAudio = () => {
  resumeContext();
  unlockBuffer();
  unlockHtmlAudio();
  primePool();
};

export const createUnlockedAudio = (url: string, bus: SoundBus = 'sfx'): HTMLAudioElement => {
  const element = pool.pop()
    ?? (silent ? (silent.cloneNode(true) as HTMLAudioElement) : new Audio());
  element.muted = false;
  element.loop = false;
  element.preload = 'auto';
  element.setAttribute('playsinline', 'true');
  element.src = url;
  trackAudio(element, bus);
  return element;
};

export const installAudioUnlock = () => {
  if (installed) return;
  installed = true;
  const onGesture = () => unlockAudio();
  window.addEventListener('pointerdown', onGesture, { capture: true });
  window.addEventListener('touchstart', onGesture, { capture: true, passive: true });
  window.addEventListener('click', onGesture, { capture: true });
  window.addEventListener('keydown', onGesture, { capture: true });
  // Lifting a finger is a gesture too, and it keeps the context and the pool topped up on a phone.
  window.addEventListener('touchend', onGesture, { capture: true, passive: true });
  const back = () => {
    if (!document.hidden && unlocked) resumeContext();
  };
  document.addEventListener('visibilitychange', back);
  window.addEventListener('pageshow', back);
  window.addEventListener('focus', back);
};

// ---------------------------------------------------------------- Music and Effects buses

/**
 * Settings (soundSettings.ts) scale every clip by its bus. Web Audio sounds connect to busInput(); a clip from
 * createUnlockedAudio keeps the volume its caller asks for, and hears volume x bus. iOS ignores
 * HTMLMediaElement.volume, so there a clip between full and silent is routed through a gain node instead, and
 * Sound off (or a bus at 0) mutes it.
 */
const busNodes = new Map<SoundBus, GainNode>();

export const busInput = (audioContext: AudioContext, bus: SoundBus): AudioNode => {
  if (audioContext !== ctx) return audioContext.destination;
  let node = busNodes.get(bus);
  if (!node) {
    node = audioContext.createGain();
    node.gain.value = busLevel(bus);
    node.connect(audioContext.destination);
    busNodes.set(bus, node);
  }
  return node;
};

type Tracked = { bus: SoundBus; volume: number; muted: boolean; gain: GainNode | null };
const VOLUME = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
const MUTED = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
const trackedState = new WeakMap<HTMLAudioElement, Tracked>();
const tracked = new Set<HTMLAudioElement>();
const live = new Set<HTMLAudioElement>();

let volumeLocked: boolean | null = null;
const isVolumeLocked = () => {
  if (volumeLocked === null) {
    try {
      const test = new Audio();
      VOLUME?.set?.call(test, 0.5);
      volumeLocked = Math.abs((VOLUME?.get?.call(test) as number) - 0.5) > 0.01;
    } catch {
      volumeLocked = false;
    }
  }
  return volumeLocked;
};

const apply = (element: HTMLAudioElement) => {
  const state = trackedState.get(element);
  if (!state) return;
  const level = busLevel(state.bus);
  if (!state.gain && isVolumeLocked() && level > 0 && level < 1 && ctx) {
    try {
      // Safari 17: play through the media session so the ringer switch treats it like the clips it already plays.
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session && session.type !== 'playback') session.type = 'playback';
      const source = ctx.createMediaElementSource(element);
      state.gain = ctx.createGain();
      source.connect(state.gain);
      state.gain.connect(ctx.destination);
    } catch {
      state.gain = null;
    }
  }
  if (state.gain) {
    VOLUME?.set?.call(element, 1);
    state.gain.gain.value = state.volume * level;
    MUTED?.set?.call(element, state.muted);
    return;
  }
  VOLUME?.set?.call(element, Math.max(0, Math.min(1, state.volume * level)));
  MUTED?.set?.call(element, state.muted || level <= 0);
};

/** Puts a clip on a bus. Its volume and muted read back what the caller set; what plays is scaled by Settings. */
export const trackAudio = (element: HTMLAudioElement, bus: SoundBus = 'sfx') => {
  const known = trackedState.get(element);
  if (known) {
    known.bus = bus;
    tracked.add(element);
    apply(element);
    return element;
  }
  if (!VOLUME?.get || !VOLUME.set || !MUTED?.get || !MUTED.set) return element;
  const state: Tracked = {
    bus,
    volume: VOLUME.get.call(element) as number,
    muted: MUTED.get.call(element) as boolean,
    gain: null,
  };
  trackedState.set(element, state);
  tracked.add(element);
  Object.defineProperty(element, 'volume', {
    configurable: true,
    get: () => state.volume,
    set: (value: number) => {
      state.volume = Math.max(0, Math.min(1, Number(value) || 0));
      apply(element);
    },
  });
  Object.defineProperty(element, 'muted', {
    configurable: true,
    get: () => state.muted,
    set: (value: boolean) => {
      state.muted = Boolean(value);
      apply(element);
    },
  });
  element.addEventListener('play', () => {
    tracked.add(element);
    live.add(element);
    apply(element);
  });
  element.addEventListener('pause', () => live.delete(element));
  const drop = () => {
    tracked.delete(element);
    live.delete(element);
  };
  element.addEventListener('ended', drop);
  element.addEventListener('emptied', drop);
  element.addEventListener('error', drop);
  apply(element);
  return element;
};

onSoundSettings(() => {
  for (const [bus, node] of busNodes) node.gain.value = busLevel(bus);
  for (const element of tracked) apply(element);
});

// ---------------------------------------------------------------- pause

const heldByPause = new Set<HTMLAudioElement>();

/** Pause holds every clip that is playing; resume picks them up where they were. */
export const holdAllAudio = () => {
  for (const element of [...live]) {
    if (element.paused) continue;
    heldByPause.add(element);
    element.pause();
  }
};

export const releaseAllAudio = () => {
  for (const element of heldByPause) void element.play().catch(() => {});
  heldByPause.clear();
};
