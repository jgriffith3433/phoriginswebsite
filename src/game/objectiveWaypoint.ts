import * as BABYLON from '@babylonjs/core';

/**
 * Objective waypoint: a small diamond with the live objective's name and distance, drawn over the objective's world
 * position as a DOM element. It follows the same marker as the 3D diamond and the Return to objective work. Off screen
 * or behind the camera it is clamped to an inset of the screen with an arrow toward the objective. `update()` runs
 * from the render loop; it allocates nothing and writes the DOM only when the text or the pixel position changes.
 */

export type WaypointState = {
  /** The game is playing: running, no cutscene, card, scripted scene or pause; the objective is up. */
  active: boolean;
  /** World position of the marker (a live reference, not copied). */
  world: BABYLON.Vector3 | null;
  name: string;
  /** Metres from Pierce to the objective. */
  distance: number;
};

/** Side inset: the label (up to 150 px wide) hangs centred under the diamond and must stay on screen. */
const EDGE = 86;
/** Below the health row and the Pause button. */
const TOP = 64;
/** The label hangs this far under the diamond. */
const LABEL_H = 52;
/** Touch portrait: clear of the right-hand hotkey column (buttons start about 125 px from the edge). */
const TOUCH_RIGHT = 130;

export const createObjectiveWaypoint = (
  root: HTMLElement,
  engine: BABYLON.Engine,
  scene: BABYLON.Scene,
  camera: BABYLON.Camera,
  read: (out: WaypointState) => void,
) => {
  const el = document.getElementById('objectiveWaypoint') as HTMLDivElement | null;
  const nameEl = el?.querySelector('.waypoint-name') as HTMLElement | null;
  const distEl = el?.querySelector('.waypoint-dist') as HTMLElement | null;
  const arrowEl = el?.querySelector('.waypoint-arrow') as HTMLElement | null;

  const missionsHud = document.getElementById('missionsHud');
  const missionsPanel = document.getElementById('missionsPanel');
  const info: WaypointState = { active: false, world: null, name: '', distance: 0 };
  const projected = new BABYLON.Vector3();
  const identity = BABYLON.Matrix.Identity();
  const viewport = new BABYLON.Viewport(0, 0, 1, 1);
  const probe = { onScreen: false, clamped: false, x: 0, y: 0, angle: 0 };

  let safeInsetTop = 0;
  const readSafe = () => { safeInsetTop = parseFloat(getComputedStyle(root).getPropertyValue('--safe-top')) || 0; };
  readSafe();
  window.addEventListener('resize', readSafe);

  let shown = false;
  let lastName = '';
  let lastDist = -1;
  let lastX = NaN;
  let lastY = NaN;
  let lastAngle = NaN;
  let lastClamped: boolean | null = null;

  const hide = () => {
    if (!el || !shown) return;
    shown = false;
    el.classList.remove('on');
    probe.onScreen = false;
  };

  /** Bottom inset: clear of the touch sticks and buttons on a phone, the hint row on a desktop. */
  const bottomInset = (h: number) => {
    const mobile = document.body.dataset.device === 'mobile' || document.body.dataset.device === 'tablet';
    // The touch sticks and buttons end here (the inventory sits on the same line).
    if (!mobile) return 110 + LABEL_H;
    // Portrait: the Missions button sits at 228 px and is 44 px tall, so the label must end above it.
    const base = (h > root.clientWidth ? 280 : 176) + LABEL_H;
    // An open Missions panel covers the left and centre; stay above its top edge.
    if (missionsHud?.classList.contains('open') && missionsPanel) {
      const top = missionsPanel.getBoundingClientRect().top - root.getBoundingClientRect().top;
      return Math.max(base, h - top + LABEL_H + 8);
    }
    return base;
  };

  /** Right reserve on touch portrait: the hotkey column (Sidearm ... Inventory) is about 120 px wide. */
  const rightInset = (h: number) => {
    const mobile = document.body.dataset.device === 'mobile' || document.body.dataset.device === 'tablet';
    return mobile && h > root.clientWidth ? TOUCH_RIGHT : EDGE;
  };

  const update = () => {
    if (!el || !nameEl || !distEl || !arrowEl) return;
    read(info);
    if (!info.active || !info.world) {
      hide();
      return;
    }
    const rw = engine.getRenderWidth();
    const rh = engine.getRenderHeight();
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (!rw || !rh || !w || !h) {
      hide();
      return;
    }
    viewport.width = rw;
    viewport.height = rh;
    BABYLON.Vector3.ProjectToRef(info.world, identity, scene.getTransformMatrix(), viewport, projected);
    // Behind the camera: the projection mirrors through the centre, so the side is wrong. Flip it.
    const view = camera.getViewMatrix();
    const m = view.m;
    const zView = info.world.x * m[2] + info.world.y * m[6] + info.world.z * m[10] + m[14];
    const behind = zView <= 0.01;
    let x = (projected.x / rw) * w;
    let y = (projected.y / rh) * h;
    const cx = w / 2;
    const cy = h / 2;
    if (behind) {
      x = cx - (x - cx);
      y = cy - (y - cy);
    }
    const safeLeft = EDGE;
    const safeRight = w - rightInset(h);
    const safeTop = TOP + safeInsetTop;
    const safeBottom = h - bottomInset(h);
    const inside = !behind && x >= safeLeft && x <= safeRight && y >= safeTop && y <= safeBottom;
    let angle = 0;
    if (!inside) {
      let dx = x - cx;
      let dy = y - cy;
      if (behind && Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1;
      if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dx = 1e-3;
      // Scale the vector from the centre of the clamp rect out to its edge.
      const rx = (safeRight - safeLeft) / 2;
      const ry = (safeBottom - safeTop) / 2;
      const rcx = (safeLeft + safeRight) / 2;
      const rcy = (safeTop + safeBottom) / 2;
      dx = x - rcx;
      dy = y - rcy;
      const k = Math.max(Math.abs(dx) / rx, Math.abs(dy) / ry, 1e-6);
      x = rcx + dx / k;
      y = rcy + dy / k;
      angle = Math.atan2(dy, dx);
    }
    const px = Math.round(x);
    const py = Math.round(y);
    const ang = Math.round(angle * 57.2958);
    const dist = Math.round(info.distance);
    if (!shown) {
      shown = true;
      el.classList.add('on');
    }
    if (info.name !== lastName) {
      lastName = info.name;
      nameEl.textContent = info.name;
    }
    if (dist !== lastDist) {
      lastDist = dist;
      distEl.textContent = `${dist} m`;
    }
    const clamped = !inside;
    if (clamped !== lastClamped) {
      lastClamped = clamped;
      el.classList.toggle('edge', clamped);
      el.dataset.edge = clamped ? 'true' : 'false';
    }
    if (px !== lastX || py !== lastY) {
      lastX = px;
      lastY = py;
      el.style.transform = `translate3d(${px}px, ${py}px, 0)`;
    }
    if (clamped && ang !== lastAngle) {
      lastAngle = ang;
      arrowEl.style.transform = `rotate(${ang}deg)`;
    }
    probe.onScreen = true;
    probe.clamped = clamped;
    probe.x = px;
    probe.y = py;
    probe.angle = ang;
  };

  /** Playtest probe: what is drawn, and where, in the HUD's own pixels. */
  const view = () => {
    const rect = el?.getBoundingClientRect();
    return {
      shown,
      clamped: probe.clamped,
      x: probe.x,
      y: probe.y,
      angle: probe.angle,
      name: lastName,
      distance: lastDist,
      rect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
    };
  };

  return { update, hide, view };
};

export type ObjectiveWaypoint = ReturnType<typeof createObjectiveWaypoint>;
