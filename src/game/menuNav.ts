import { busInput, getSharedAudioContext } from './audioUnlock';

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

  card.addEventListener('pointerenter', (event) => {
    const el = (event.target as HTMLElement).closest?.('button:not(:disabled)');
    if (el && event.pointerType === 'mouse') tick(1500, 0.05, 0.03);
  }, true);
  card.addEventListener('focusin', (event) => {
    if ((event.target as HTMLElement).matches?.(':focus-visible')) tick(1500, 0.05, 0.03);
  });
  card.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest?.('button:not(:disabled)')) tick(620, 0.12, 0.07);
  }, true);

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
