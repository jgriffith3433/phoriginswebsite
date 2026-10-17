/** iOS/Safari block AudioContext and HTMLAudio.play() until a user gesture; unlock once so later cutscene clips can play. */

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
  if (!ctx) ctx = new Ctor();
  // iOS also reports 'interrupted' after a call, a lock or a tab switch.
  if (ctx.state !== 'running') void ctx.resume().catch(() => {});
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

export const createUnlockedAudio = (url: string): HTMLAudioElement => {
  const element = pool.pop()
    ?? (silent ? (silent.cloneNode(true) as HTMLAudioElement) : new Audio());
  element.muted = false;
  element.loop = false;
  element.preload = 'auto';
  element.setAttribute('playsinline', 'true');
  element.src = url;
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
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resumeContext();
  });
};
