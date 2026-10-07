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
  if (ctx.state === 'suspended') void ctx.resume();
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
};

export const createUnlockedAudio = (url: string): HTMLAudioElement => {
  const element = silent
    ? (silent.cloneNode(true) as HTMLAudioElement)
    : new Audio();
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
};
