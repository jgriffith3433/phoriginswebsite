import * as BABYLON from '@babylonjs/core';

/**
 * Context prompt: an icon, a key and one or two words (four at most), hung on the thing a power is used on, or on the
 * touch button that uses it. It shows only while the power can be used right now. Drawn after each frame like the
 * objective waypoint; it allocates nothing and writes the DOM only when the text or the pixel changes.
 */
export type PowerPromptState = {
  active: boolean;
  icon: string;
  key: string;
  label: string;
  /** Button the prompt belongs to on touch (and on desktop when there is no world target). */
  button: 'shadow' | 'fire' | 'ability' | 'interact';
  /** Optional picture for the icon (a WebP in assets/textures/ui/icons). */
  iconUrl?: string;
  /** Hang on the world target even on touch (a use prompt rides the object; a power prompt rides its button). */
  preferTarget?: boolean;
  world: BABYLON.Vector3 | null;
};

const BUTTON_IDS = { shadow: 'shadowHint', fire: 'fireBtn', ability: 'abilityHint', interact: 'interactBtn' } as const;
const W = 132;
const H = 34;

export const createPowerPrompt = (
  root: HTMLElement,
  engine: BABYLON.Engine,
  scene: BABYLON.Scene,
  read: (out: PowerPromptState) => void,
  elementId = 'powerPrompt',
) => {
  const el = document.getElementById(elementId) as HTMLDivElement | null;
  const iconEl = el?.querySelector('.pp-icon') as HTMLElement | null;
  const keyEl = el?.querySelector('.pp-key') as HTMLElement | null;
  const labelEl = el?.querySelector('.pp-label') as HTMLElement | null;
  const info: PowerPromptState = { active: false, icon: '', key: '', label: '', button: 'fire', world: null, iconUrl: undefined };
  const projected = new BABYLON.Vector3();
  const identity = BABYLON.Matrix.Identity();
  const viewport = new BABYLON.Viewport(0, 0, 1, 1);
  let shown = false;
  let lastText = '';
  let lastX = NaN;
  let lastY = NaN;
  let lastOn: string | null = null;
  const seen = { text: '', on: '', x: 0, y: 0, shown: false };

  const hide = () => {
    if (!el || !shown) return;
    shown = false;
    el.classList.remove('on');
    seen.shown = false;
  };

  const update = () => {
    if (!el || !iconEl || !keyEl || !labelEl) return;
    info.iconUrl = undefined;
    info.preferTarget = false;
    read(info);
    if (!info.active) { hide(); return; }
    const w = root.clientWidth;
    const h = root.clientHeight;
    const rw = engine.getRenderWidth();
    const rh = engine.getRenderHeight();
    if (!w || !h || !rw || !rh) { hide(); return; }
    const rootRect = root.getBoundingClientRect();
    const touch = document.body.dataset.device === 'mobile' || document.body.dataset.device === 'tablet';
    let x = 0;
    let y = 0;
    let on = 'button';
    const button = document.getElementById(BUTTON_IDS[info.button]);
    const onButton = (touch && !info.preferTarget) || !info.world;
    if (onButton && button && !button.hidden) {
      const r = button.getBoundingClientRect();
      // Above the button, centred on it, never under another control: touch buttons sit low, the prompt rides over them.
      x = r.left - rootRect.left + r.width / 2;
      y = r.top - rootRect.top - H / 2 - 6;
      // A prompt for a button on the right edge slides left so it stays whole.
      x = Math.min(w - W / 2 - 8, Math.max(W / 2 + 8, x));
    } else if (info.world) {
      viewport.width = rw;
      viewport.height = rh;
      BABYLON.Vector3.ProjectToRef(info.world, identity, scene.getTransformMatrix(), viewport, projected);
      x = (projected.x / rw) * w;
      y = (projected.y / rh) * h - 6;
      on = 'target';
      if (projected.z < 0 || projected.z > 1) { hide(); return; }
      x = Math.min(w - W / 2 - 8, Math.max(W / 2 + 8, x));
      y = Math.min(h - 140, Math.max(90, y));
    } else { hide(); return; }
    const text = `${info.icon}|${info.iconUrl ?? ''}|${info.key}|${info.label}|${touch ? 't' : 'd'}`;
    if (text !== lastText) {
      lastText = text;
      iconEl.textContent = info.iconUrl ? '' : info.icon;
      iconEl.style.backgroundImage = info.iconUrl ? `url(${info.iconUrl})` : '';
      iconEl.classList.toggle('pp-img', Boolean(info.iconUrl));
      keyEl.textContent = info.key;
      labelEl.textContent = info.label;
    }
    if (on !== lastOn) { lastOn = on; el.dataset.on = on; }
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (rx !== lastX || ry !== lastY) {
      lastX = rx;
      lastY = ry;
      el.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
    }
    if (!shown) { shown = true; el.classList.add('on'); }
    seen.text = `${info.key} ${info.label}`;
    seen.on = on;
    seen.x = rx;
    seen.y = ry;
    seen.shown = true;
  };

  /** Probe: what the prompt says and where it sits (screen box), for the playtest. */
  const view = () => {
    const r = el?.getBoundingClientRect();
    return {
      shown: seen.shown && shown,
      text: seen.shown ? seen.text : '',
      on: seen.on,
      words: seen.shown ? seen.text.split(/\s+/).filter(Boolean).length : 0,
      rect: r && shown ? { x: r.left, y: r.top, w: r.width, h: r.height } : null,
    };
  };

  return { update, view };
};
