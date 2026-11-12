import { busInput, getSharedAudioContext } from './audioUnlock';
import { playClip, preloadClips } from './sfxMix';

/**
 * Title card input and feedback: arrow / W S keys and a gamepad (d-pad, left stick, A, B) move focus between the card's
 * buttons, and hover, focus and press each make a soft tick on the effects bus (so Settings' Effects slider and Sound
 * switch apply). Nothing here starts the game: A and Enter just click the focused button.
 */
const FOCUSABLE = 'button:not(:disabled):not([hidden]), a[href]';

const tick = (freq: number, length: number, level: number) => {
  const ctx = getSharedAudioContext();
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.7, now + length);
  gain.gain.setValueAtTime(level, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
  osc.connect(gain);
  gain.connect(busInput(ctx, 'sfx'));
  osc.start(now);
  osc.stop(now + length + 0.02);
};


/**
 * Menu sounds (Hawkes Gen takes in assets/audio/sfx/ui): hover, three selects that rotate (never the same one twice in
 * a row), back. A file that will not play falls back to the old synthesized tick.
 */
const UI = '/assets/audio/sfx/ui/';
const SELECTS = [`${UI}select-1.mp3`, `${UI}select-2.mp3`, `${UI}select-3.mp3`];
const BACK_IDS = new Set(['closeLevelSelect', 'settingsDoneBtn', 'resumeBtn']);
let lastSelect = -1;
let uiPlays = 0;
let lastKind = '';

/** Probe: how many menu sounds have started, and the last kind (hover / select / back). */
export const menuSoundLog = () => ({ plays: uiPlays, last: lastKind });

export const playUi = (kind: 'hover' | 'select' | 'back') => {
  let url = `${UI}hover.mp3`;
  let volume = 0.4;
  if (kind === 'select') {
    lastSelect = (lastSelect + 1 + Math.floor(Math.random() * (SELECTS.length - 1))) % SELECTS.length;
    url = SELECTS[lastSelect];
    volume = 0.7;
  } else if (kind === 'back') {
    url = `${UI}back.mp3`;
    volume = 0.6;
  }
  uiPlays += 1;
  lastKind = kind;
  const fallback = () => (kind === 'hover' ? tick(1500, 0.05, 0.03) : tick(kind === 'back' ? 420 : 620, 0.12, 0.07));
  if (!playClip(url, volume, { rate: kind === 'hover' ? 1 : 0.97 + Math.random() * 0.06, onError: fallback })) fallback();
};

export const installMenuSounds = (card: HTMLElement) => {
  preloadClips([`${UI}hover.mp3`, `${UI}back.mp3`, ...SELECTS]);
  card.addEventListener('pointerenter', (event) => {
    const el = (event.target as HTMLElement).closest?.('button:not(:disabled)');
    if (el && event.pointerType === 'mouse') playUi('hover');
  }, true);
  card.addEventListener('focusin', (event) => {
    if ((event.target as HTMLElement).matches?.(':focus-visible')) playUi('hover');
  });
  card.addEventListener('click', (event) => {
    const el = (event.target as HTMLElement).closest?.<HTMLElement>('button:not(:disabled)');
    if (!el) return;
    playUi(BACK_IDS.has(el.id) || el.dataset.ui === 'back' ? 'back' : 'select');
  }, true);
};

export const installMenuNav = (card: HTMLElement) => {
  const visible = (el: HTMLElement) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
  const items = () => [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
  const open = () => !card.classList.contains('hidden');

  const move = (step: number) => {
    const list = items();
    if (!list.length) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
    list[next].focus();
  };

  card.addEventListener('keydown', (event) => {
    if (event.repeat && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const down = event.key === 'ArrowDown' || event.key === 's' || event.key === 'S';
    const up = event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W';
    if (!down && !up) return;
    event.preventDefault();
    event.stopPropagation();
    move(down ? 1 : -1);
  });

  installMenuSounds(card);

  // Gamepad: edge-triggered, polled only while the card is up.
  let held = false;
  let heldB = false;
  let lastMove = 0;
  const poll = () => {
    requestAnimationFrame(poll);
    if (!open()) return;
    const pad = (navigator.getGamepads?.() ?? []).find((p) => p && p.connected);
    if (!pad) return;
    const axis = pad.axes[1] ?? 0;
    const dir = pad.buttons[13]?.pressed || axis > 0.6 ? 1 : pad.buttons[12]?.pressed || axis < -0.6 ? -1 : 0;
    const now = performance.now();
    if (dir && now - lastMove > 220) {
      lastMove = now;
      move(dir);
    }
    const a = !!pad.buttons[0]?.pressed;
    const focused = document.activeElement as HTMLElement | null;
    if (a && !held && focused && card.contains(focused)) focused.click();
    held = a;
    const b = !!pad.buttons[1]?.pressed;
    if (b && !heldB) card.querySelector<HTMLElement>('#closeLevelSelect:not(.hidden)')?.click();
    heldB = b;
  };
  requestAnimationFrame(poll);

  // Keep a button focused so keys and the pad always have a place to start.
  const focusFirst = () => {
    if (!open() || card.contains(document.activeElement)) return;
    card.querySelector<HTMLElement>('#startBtn:not(:disabled)')?.focus({ preventScroll: true });
  };
  new MutationObserver(focusFirst).observe(card, { attributes: true, attributeFilter: ['class', 'disabled', 'style'], subtree: true });
};
