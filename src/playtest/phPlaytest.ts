import type * as BABYLON from '@babylonjs/core';
import { installPlaytest, type RunOptions, type Outcome, type Tracker } from '../hawkes-playtest.js';
import { missingClip, storyLines } from '../game/locale';
import type { TrainStory } from '../story/trainDress';

/**
 * Hawkes playtest contract v1 (spec: C:\Projects\hawkesstudio\docs\playtest.md).
 *
 * The bot plays through the same input a player uses: key events on the page (WASD, E, F, Q, R, H, C, Tab,
 * Space), clicks on the canvas, touch drags for the camera, and the title / card / Skip buttons. It reads the
 * game through a read-only probe from main.ts and never moves Pierce or edits story state. The one shortcut is
 * `setupLevel`, which starts a level directly (the same call as Continue) so `level-2` … `level-6` can begin
 * there. The save cookie is put back when a run ends, so a run never changes a player's progress.
 */

export type PhProbe = {
  ready: () => boolean;
  running: () => boolean;
  level: () => { id: number; libraryId: string; name: string };
  player: () => {
    x: number; y: number; z: number; yaw: number;
    health: number; clip: number; ammo: number; medkits: number; weaponDrawn: boolean;
  };
  cameraYaw: () => number;
  objective: () => { target: { x: number; z: number } | null; title: string; text: string; visible: boolean };
  action: () => string | null;
  phase: () => string;
  cutscene: () => { id: string; time: number; duration: number } | null;
  scripted: () => string | null;
  phone: () => { incoming: boolean; busy: boolean; speaker: string; line: string };
  menu: () => { open: boolean; title: string; text: string; start: string | null; startEnabled: boolean; newGame: boolean };
  subtitle: () => { speaker: string; text: string };
  creature: () => { x: number; y: number; z: number } | null;
  aimLocked: () => boolean;
  shadow: () => { controls: boolean; on: boolean; handsOut: boolean; linked: boolean; ability: string; lessonStarted: boolean };
  people: () => { x: number; z: number; kind: string }[];
  pickups: () => { x: number; z: number; item: string }[];
  scene: BABYLON.Scene;
  canvas: HTMLCanvasElement;
  startButton: HTMLButtonElement;
  newGameButton: HTMLButtonElement;
  skipButton: HTMLButtonElement | null;
  /** Test shortcut for setup: start a level directly, as Continue does. */
  setupLevel: (id: number) => Promise<void>;
  /** Test shortcut (`train`): start a hidden (`comingSoon`) level by library id, as `?beat=train` does. */
  setupHidden: (libraryId: string) => Promise<void>;
  /** The rows Load Level shows, as rendered into its list (titles only). */
  levelRows: () => string[];
  /** The train car kit while level 7 is dressed, else null. */
  train: () => {
    seats: number; poles: number; ads: number; windows: number; lampsPassed: number; speed: number; roll: number;
    /** The stop: how far the platform shows in the north windows and the side door is open (0..1). */
    platform: number; door: number;
    /** Level 7's script (theTrain.ts): its beat, the car, where the old body is and which way he faces. */
    story: TrainStory | null;
  } | null;
  /** The ending song playing on the Level Complete card, or null. Level 7 reuses ending-6. */
  ending: () => string | null;
  /** Test setup (`load-error`): the next level load fails, as a missing level file ('error') or one that never ends ('hang'). */
  failNextLoad: (kind: 'error' | 'hang') => void;
  /** Test shortcut (`b3-retry`): Pierce's health drops to zero, as a bite would. False while he cannot be hurt. */
  forceDefeat: () => boolean;
  /** What the scene holds right now, for leak checks (also in hawkesPlaytest.state().counts). */
  counts: () => SceneCounts;
  /** Test setup: lay the page out as a 390x844 phone (for a desktop viewport). */
  phoneFrame: (on: boolean) => void;
  /** Tap to play, the AudioContext, Pause and Settings (studio sound standard). */
  sound: () => {
    prompt: boolean; context: string; paused: boolean; settingsOpen: boolean;
    settings: { on: boolean; music: number; sfx: number };
  };
};

export type SceneCounts = {
  meshes: number; materials: number; textures: number; skeletons: number; animationGroups: number;
  particleSystems: number; lights: number; transformNodes: number; renderTargets: number;
  /** <audio> elements playing, iOS gain routes made for elements, and live Web Audio clips. */
  audioElements: number; audioRouted: number; audioClips: number;
  fps: number;
};

/** Counts that must come back to the same number after a Defeat -> Start retry. */
const FLAT_COUNTS = ['meshes', 'materials', 'textures', 'skeletons', 'animationGroups', 'particleSystems', 'lights', 'transformNodes', 'renderTargets', 'audioRouted'] as const;
const RETRIES = 5;

const LEVELS = [
  { n: 1, lib: 'apex-peak', name: 'Level 1: The Apex Peak' },
  { n: 2, lib: 'b3-basement', name: 'Level 2: B3' },
  { n: 3, lib: 'the-return', name: 'Level 3: The Return' },
  { n: 4, lib: 'the-desk', name: 'Level 4: The Desk' },
  { n: 5, lib: 'going-home', name: 'Level 5: Going Home' },
  { n: 6, lib: 'the-station', name: 'Level 6: The Station' },
];

/** Usual timeline lengths, seconds. A scripted scene (lobby, desk, station opening) has no timeline file. */
const SCRIPTED_LIMIT = 150;
/** In `full`, these long rides are skipped after this many seconds so the whole story fits in about ten minutes. */
const FULL_SKIP_AFTER: Record<string, number> = { 'elevator-b3': 16, 'elevator-up': 16 };

const B3_DEN = { x: 7.5, z: 25 };
const HOME_STAIRS = { x: 163.5, z: 21.2 };
const STREET_LANE_Z = 22.6;

// Same doorway links the hunt grid adds in act1.ts, where B3 floor slabs do not meet.
const B3_LINKS: Rect[] = [
  { minX: 15.6, maxX: 18.6, minZ: 36.2, maxZ: 39.8 },
  { minX: 20, maxX: 40, minZ: 39.6, maxZ: 41.4 },
  { minX: 45.4, maxX: 47.8, minZ: 36.2, maxZ: 40.8 },
  { minX: 41.2, maxX: 46.8, minZ: 36.1, maxZ: 37.4 },
];

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
type Grid = { step: number; ox: number; oz: number; cols: number; rows: number; open: Uint8Array };
type Point = { x: number; z: number };

const STEP = 0.2;
const PAD = 0.4; // player ellipsoid radius
const TAU = Math.PI * 2;
const wrap = (a: number) => {
  let v = (a + Math.PI) % TAU;
  if (v < 0) v += TAU;
  return v - Math.PI;
};
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const RAW_KEY = /\b[a-z][a-z0-9]*(?:\.[a-z0-9-]+){2,}\b|\{[a-z]+\}|\bundefined\b|\bNaN\b/;

// ---------------------------------------------------------------- walk grid

const buildGrid = (scene: BABYLON.Scene, libraryId: string): Grid | null => {
  const floors: Rect[] = [];
  const blocks: Rect[] = [];
  for (const mesh of scene.meshes) {
    if (!mesh.isEnabled()) continue;
    const meta = mesh.metadata as { assetKind?: string; pickup?: unknown } | null;
    const box = mesh.getBoundingInfo().boundingBox;
    const r = { minX: box.minimumWorld.x, maxX: box.maximumWorld.x, minZ: box.minimumWorld.z, maxZ: box.maximumWorld.z };
    const sx = r.maxX - r.minX;
    const sz = r.maxZ - r.minZ;
    if (!Number.isFinite(sx) || !Number.isFinite(sz)) continue;
    if (meta?.assetKind === 'ground') {
      // Low slabs are trenches and pits, not floor to walk on.
      if (sx >= 1 && sz >= 1 && box.maximumWorld.y > -0.2 && box.maximumWorld.y < 0.6) floors.push(r);
      continue;
    }
    if (!mesh.checkCollisions || meta?.pickup) continue;
    if (/trigger|ceil|creature|skybox|playerCollider|impact|decal|floor|ground/i.test(mesh.name)) continue;
    if (box.maximumWorld.y < 0.35 || box.minimumWorld.y > 1.7) continue;
    if (sx > 24 && sz > 24) continue;
    if (sx < 0.02 && sz < 0.02) continue;
    blocks.push(r);
  }
  if (libraryId === 'b3-basement' || libraryId === 'the-return') floors.push(...B3_LINKS);
  if (!floors.length) return null;
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const f of floors) {
    minX = Math.min(minX, f.minX); maxX = Math.max(maxX, f.maxX);
    minZ = Math.min(minZ, f.minZ); maxZ = Math.max(maxZ, f.maxZ);
  }
  if ((maxX - minX) * (maxZ - minZ) > 400 * 400) return null;
  const cols = Math.ceil((maxX - minX) / STEP) + 1;
  const rows = Math.ceil((maxZ - minZ) / STEP) + 1;
  const open = new Uint8Array(cols * rows);
  for (const f of floors) {
    // Inclusive edges, so a cell on the seam between two slabs stays open.
    const c0 = Math.max(0, Math.ceil((f.minX - 0.02 - minX) / STEP));
    const c1 = Math.min(cols - 1, Math.floor((f.maxX + 0.02 - minX) / STEP));
    const r0 = Math.max(0, Math.ceil((f.minZ - 0.02 - minZ) / STEP));
    const r1 = Math.min(rows - 1, Math.floor((f.maxZ + 0.02 - minZ) / STEP));
    for (let r = r0; r <= r1; r++) open.fill(1, r * cols + c0, r * cols + c1 + 1);
  }
  for (const b of blocks) {
    const c0 = Math.max(0, Math.ceil((b.minX - PAD - minX) / STEP));
    const c1 = Math.min(cols - 1, Math.floor((b.maxX + PAD - minX) / STEP));
    const r0 = Math.max(0, Math.ceil((b.minZ - PAD - minZ) / STEP));
    const r1 = Math.min(rows - 1, Math.floor((b.maxZ + PAD - minZ) / STEP));
    if (c1 < c0 || r1 < r0) continue;
    for (let r = r0; r <= r1; r++) open.fill(0, r * cols + c0, r * cols + c1 + 1);
  }
  return { step: STEP, ox: minX, oz: minZ, cols, rows, open };
};

const cellOf = (g: Grid, p: Point) => ({ c: Math.round((p.x - g.ox) / g.step), r: Math.round((p.z - g.oz) / g.step) });
const isOpen = (g: Grid, c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.open[r * g.cols + c] === 1;
const worldOf = (g: Grid, c: number, r: number): Point => ({ x: g.ox + c * g.step, z: g.oz + r * g.step });

const nearestOpen = (g: Grid, p: Point, maxMeters: number) => {
  const { c, r } = cellOf(g, p);
  if (isOpen(g, c, r)) return { c, r };
  const maxR = Math.ceil(maxMeters / g.step);
  for (let rad = 1; rad <= maxR; rad++) {
    let best: { c: number; r: number } | null = null;
    let bestD = Infinity;
    for (let dc = -rad; dc <= rad; dc++) {
      for (let dr = -rad; dr <= rad; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad || !isOpen(g, c + dc, r + dr)) continue;
        const d = dc * dc + dr * dr;
        if (d < bestD) { bestD = d; best = { c: c + dc, r: r + dr }; }
      }
    }
    if (best) return best;
  }
  return null;
};

const lineOpen = (g: Grid, a: Point, b: Point) => {
  const n = Math.max(1, Math.ceil(dist(a, b) / (g.step * 0.5)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const { c, r } = cellOf(g, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    if (!isOpen(g, c, r)) return false;
  }
  return true;
};

/** A* over the grid, 8 neighbours, no corner cutting. Returns smoothed waypoints, or null when unreachable. */
const findPath = (g: Grid, from: Point, to: Point): Point[] | null => {
  const s = nearestOpen(g, from, 2.5);
  const e = nearestOpen(g, to, 4);
  if (!s || !e) return null;
  const n = g.cols * g.rows;
  const start = s.r * g.cols + s.c;
  const goal = e.r * g.cols + e.c;
  const gScore = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap: [number, number][] = [];
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  const h = (i: number) => {
    const c = i % g.cols;
    const r = (i - c) / g.cols;
    const dc = Math.abs(c - e.c);
    const dr = Math.abs(r - e.r);
    return Math.max(dc, dr) + 0.414 * Math.min(dc, dr);
  };
  gScore[start] = 0;
  push(h(start), start);
  let found = false;
  let guard = 0;
  while (heap.length && guard++ < 400000) {
    const [, i] = pop();
    if (closed[i]) continue;
    if (i === goal) { found = true; break; }
    closed[i] = 1;
    const c = i % g.cols;
    const r = (i - c) / g.cols;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (!isOpen(g, nc, nr)) continue;
        if (dc && dr && (!isOpen(g, c + dc, r) || !isOpen(g, c, r + dr))) continue;
        const j = nr * g.cols + nc;
        if (closed[j]) continue;
        const cost = gScore[i] + (dc && dr ? 1.414 : 1);
        if (cost >= gScore[j]) continue;
        gScore[j] = cost;
        came[j] = i;
        push(cost + h(j), j);
      }
    }
  }
  if (!found) return null;
  const cells: Point[] = [];
  for (let i = goal; i !== -1; i = came[i]) {
    const c = i % g.cols;
    cells.push(worldOf(g, c, (i - c) / g.cols));
  }
  cells.reverse();
  const out: Point[] = [];
  let anchor = 0;
  for (let i = 2; i < cells.length; i++) {
    if (!lineOpen(g, cells[anchor], cells[i])) {
      out.push(cells[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(cells[cells.length - 1]);
  return out;
};

// ---------------------------------------------------------------- the bot

export const installPhPlaytest = (probe: PhProbe) => {
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    // Dev only: an ASCII map of the walk grid ('#' blocked, '.' open, '@' Pierce) for debugging routes.
    (window as unknown as Record<string, unknown>).__phWalkGrid = (x0: number, z0: number, x1: number, z1: number, step = 0.4) => {
      const g = buildGrid(probe.scene, probe.level().libraryId);
      if (!g) return 'no grid';
      const p = probe.player();
      const rows: string[] = [];
      for (let z = z1; z >= z0; z -= step) {
        let row = `${z.toFixed(1).padStart(6)} `;
        for (let x = x0; x <= x1; x += step) {
          const { c, r } = cellOf(g, { x, z });
          row += Math.hypot(p.x - x, p.z - z) < step * 0.7 ? '@' : isOpen(g, c, r) ? '.' : '#';
        }
        rows.push(row);
      }
      return rows.join('\n');
    };
    (window as unknown as Record<string, unknown>).__phProbe = probe;
    (window as unknown as Record<string, unknown>).__phBlocks = (x: number, z: number) => probe.scene.meshes
      .filter((m) => m.isEnabled() && m.checkCollisions)
      .filter((m) => { const b = m.getBoundingInfo().boundingBox; return x >= b.minimumWorld.x - PAD && x <= b.maximumWorld.x + PAD && z >= b.minimumWorld.z - PAD && z <= b.maximumWorld.z + PAD && b.maximumWorld.y > 0.35 && b.minimumWorld.y < 1.7; })
      .map((m) => { const b = m.getBoundingInfo().boundingBox; return `${m.name} [${b.minimumWorld.x.toFixed(2)},${b.maximumWorld.x.toFixed(2)}]x[${b.minimumWorld.z.toFixed(2)},${b.maximumWorld.z.toFixed(2)}] y${b.minimumWorld.y.toFixed(2)}-${b.maximumWorld.y.toFixed(2)}`; });
  }
  let token = 0;
  const held = new Set<string>();
  let lookSens = 0; // radians per pixel of touch drag, measured on first use

  const codeFor = (key: string) => (key === ' ' ? 'Space' : key === 'Tab' ? 'Tab' : key === 'Shift' ? 'ShiftLeft' : `Key${key.toUpperCase()}`);
  const sendKey = (type: 'keydown' | 'keyup', key: string) => {
    document.body.dispatchEvent(new KeyboardEvent(type, { key, code: codeFor(key), bubbles: true, cancelable: true }));
  };
  const setHeld = (keys: string) => {
    const want = new Set(keys.split(''));
    for (const k of [...held]) if (!want.has(k)) { held.delete(k); sendKey('keyup', k); }
    for (const k of want) if (!held.has(k)) { held.add(k); sendKey('keydown', k); }
  };
  const releaseAll = () => setHeld('');

  /** A short drag on the canvas: the touch-look path a phone player uses. */
  const dragLook = (dx: number) => {
    const canvas = probe.canvas;
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + rect.width * 0.62;
    const y = rect.top + rect.height * 0.5;
    const touch = (cx: number) => new Touch({ identifier: 41, target: canvas, clientX: cx, clientY: y });
    const fire = (type: string, cx: number, live: boolean) => {
      const t = touch(cx);
      canvas.dispatchEvent(new TouchEvent(type, {
        touches: live ? [t] : [], targetTouches: live ? [t] : [], changedTouches: [t], bubbles: true, cancelable: true,
      }));
    };
    fire('touchstart', x, true);
    fire('touchmove', x + dx, true);
    fire('touchend', x + dx, false);
  };

  const clickCanvas = () => {
    const canvas = probe.canvas;
    const rect = canvas.getBoundingClientRect();
    const init = { pointerType: 'mouse', pointerId: 1, button: 0, buttons: 1, bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    canvas.dispatchEvent(new PointerEvent('pointerdown', init));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
  };

  const input = (action: string, down: boolean) => {
    const map: Record<string, string> = { forward: 'w', back: 's', left: 'a', right: 'd', jump: ' ', interact: 'e', phone: 'f', weapon: 'q', shadow: 'c', ability: 'Tab', reload: 'r', medkit: 'h' };
    const key = map[action] ?? action;
    if (action === 'fire') { if (down) clickCanvas(); return; }
    if (down) { held.add(key); sendKey('keydown', key); } else { held.delete(key); sendKey('keyup', key); }
  };

  const api = installPlaytest({
    product: 'phorigins',
    scenarios: [
      { id: 'smoke', title: 'Boot, title, start level 1, answer the call, walk, open the board scene', seconds: 50, tags: ['smoke'] },
      ...LEVELS.map((l) => ({ id: `level-${l.n}`, title: `${l.name} to its exit${l.n > 1 ? ` (starts at level ${l.n})` : ''}`, seconds: [330, 170, 200, 100, 200, 110][l.n - 1], tags: ['level'] })),
      { id: 'full', title: 'Levels 1–6 in order, cutscenes included (long rides skipped after 16 s)', seconds: 760, tags: ['full'] },
      {
        id: 'sound-settings',
        title: 'Tap to play unlocks sound, Settings from the title and from Pause, a setting that survives a reload',
        description: 'Shows the Tap to play prompt, taps it with a pointer press on the spot (hit-tested, so a covered prompt fails) and checks the AudioContext is running. Opens Settings from the title, turns Sound off and Music to 40%, reloads the page (the run carries on after the reload through ?playtest=sound-settings), checks the prompt and the saved choice are back, then opens Settings again from Pause in level 1. The player\'s own hawkes.sound is put back at the end.',
        seconds: 120,
        tags: ['menus', 'sound'],
      },
      {
        id: 'load-error',
        title: "A level that fails to load shows Couldn't start the game and Retry; Retry reloads to START",
        description: 'Checks a normal load reaches the START card with no error. Then makes the next level load fail (setup; options.fail "hang" (default) never finishes, so the stall timeout (20 s with nothing loading) shows, "error" fails at once), presses Start, and times the error card with its Retry button. Presses Retry: the page really reloads (the run carries on after it through ?playtest=load-error), and the title card reaches START again; Start enters level 1.',
        seconds: 90,
        tags: ['menus'],
      },
      {
        id: 'phone-b3',
        title: 'Phone title card and buttons, About beat 01, then B3 with the creature downed before decon',
        description: 'On a desktop viewport the page is laid out as a 390x844 phone for the title and button checks. Then the About page shows in an overlay, then level 2: stand still for the way hints, shoot it from the lab before entering decon, and finish the level.',
        seconds: 260,
        tags: ['menus'],
      },
      {
        id: 'b3-retry',
        title: 'B3: die and press Start five times; meshes, materials, textures, skeletons, clips and lights stay flat',
        description: `Starts level 2 (test shortcut), waits for the scene to settle and reads the scene counts (also in hawkesPlaytest.state().counts). Then ${RETRIES} times: Pierce is downed (test shortcut, as a bite would), Defeat shows, Start retries the level, the scene settles, and the counts are read again. Metrics: each count after the first retry and after the last, and their growth. A count that keeps growing across retries is a bug. Headless WebGL is about 1 fps, so each stage reports progress.`,
        seconds: 420,
        tags: ['level', 'perf'],
      },
      {
        id: 'analytics',
        title: 'Hawkes Analytics: level 1 played to its card, the events going out (debug log), the feedback card after the level',
        description: 'Reloads once with ?hawkes-analytics-debug=1 when the page was opened without it (the run carries on through ?playtest=analytics). Logs the build, env and product the SDK reports, then plays level 1 as level-1 does and logs each analytics event as it is made and sent (game_ready, screen, level_start, progress, video, feature, death, level_end, stuck, feedback). After the Level Complete card it checks the feedback card ("How was level 1…?") is on screen. Problems: no build, a standard event missing, no feedback card.',
        seconds: 360,
        tags: ['level', 'analytics'],
      },
      {
        id: 'train',
        title: 'Level 7: the subway car. Seats, poles, ads, tunnel lights, sway; seats and poles block; listed on Load Level; fps vs The Station',
        description: 'Checks Load Level lists level 7, The Train. Starts The Station (test shortcut), skips its opening scene and samples the frame rate for 8 s standing still. Then enters level 7 (test shortcut, as ?beat=train): logs what the car is made of (benches, poles, ads, windows), turns to the north windows and counts the tunnel lamps going past and the sway (camera roll) for 5 s, samples the frame rate the same way, then walks into the north bench, the south bench and a center pole (real input; each logs how close Pierce got), and walks the length of the car to the front end door. Metrics: fpsStation, fpsTrain, lampsPerSecond, swayDegrees, carWalkMeters. Problems: level 7 missing from Load Level, a missing part of the car, no lamps moving, no sway, Pierce inside a seat or a pole, train fps more than 10% under the station.',
        seconds: 200,
        tags: ['level', 'perf'],
      },
      {
        id: 'level-7-release',
        title: 'The Station Continue enters The Train; End Level only after the story, then the station song and level 7 credits; Exit only; Load Level lists it',
        description: 'Starts The Station (test shortcut), skips its opening, and plays to the Level Complete card. Checks Continue is on that card, checks Load Level\'s list includes Level 7: The Train as Play, and presses Continue. Level 7 must start. Plays the train through real input (opening, Next car, the stop, Hale, the door). End Level must not appear before the story\'s last beat. Pressing it plays ending-6 and rolls the level 7 credits (Preferred A Man, Went Uptown; not The Station\'s "Open On Nothing"). The card then shows Exit only, with Continue hidden.',
        seconds: 480,
        tags: ['level'],
      },
      {
        id: 'level-7',
        title: 'Level 7, The Train: the opening scene voiced and in order, Skip, the old body one car ahead, the stop, Shadow mode, the door, then the end song and credits',
        description: 'Starts level 7 (test shortcut, as ?beat=train) and lets the opening scene play: logs each subtitle with its speaker and checks the four opening lines come in order, that each spoken train line has a clip, and that the old body (the untransformed Pierce) is in the car and walks out through the front end door. Then starts the level again and presses Skip 3 s into the opening: control and the objective must be back within 2 s. Plays on with real input: walks to the objective marker, presses E (Next car) at the front end door, sees the old body one car ahead walk away; in car 2 turns Shadow mode on (C), checks the ability readout and Tab, shadow-runs a moment (Shift) and turns it off. In car 3 the train slows into a stop (platform in the windows), the stop scene plays: the door opens, he says "This is me", the commuter says "Night", and he steps out through the door facing away from Pierce (checks he never turns toward him). Answers Hale\'s call, walks to the open door (the end trigger), watches the doors close and presses End Level. End Level must be on the finished beat. The press plays ending-6, rolls the level 7 credits, and the card is Exit only. Checks combat stays off (library row, no hostiles) and no missing clips. Metrics: trainOpeningSeconds, trainCars, trainSeconds.',
        seconds: 240,
        tags: ['level'],
      },
      {
        id: 'site-links',
        title: 'Powered by HAWKES GEN on every site page, Hawkes Biomedical on Home, About lists levels 1-7 playable, the game screen unchanged',
        description: 'Taps to play, then shows Home, About, Characters and What\'s new in an overlay one after another. On About it first scrolls to "What you can play" and checks a Playable card for each of levels 1-7 (outlined gold, red when wrong), and that the "still being built out" line is gone. Then it scrolls each page to its footer and checks a visible "Powered by HAWKES GEN" link to https://hawkesgen.com (outlined in gold), plus a Hawkes Biomedical link to https://hawkesbiomedical.com on Home. Then checks the game page itself carries no credit link.',
        seconds: 60,
        tags: ['menus', 'site'],
      },
    ],
    isReady: () => probe.ready(),
    stallSeconds: 75,
    input,
    stop: () => { token++; releaseAll(); },
    async start(id: string, options: RunOptions, t: Tracker) {
      const my = ++token;
      const saved = snapshotSave();
      const watch = watchProblems(t);
      try {
        await run(id, options, t, my);
      } finally {
        watch();
        releaseAll();
        restoreSave(saved);
      }
    },
  });

  // state() also carries the scene counts, so a watcher sees a leak while a run is going.
  const baseState = api.state.bind(api);
  api.state = () => {
    let counts: SceneCounts | null = null;
    try { counts = probe.counts(); } catch { /* scene not up yet */ }
    return { ...baseState(), counts };
  };

  // ------------------------------------------------------------ run

  const run = async (id: string, options: RunOptions, t: Tracker, my: number) => {
    const alive = () => { if (my !== token) throw new Error('playtest stopped'); };
    const frame = () => new Promise<void>((resolve) => {
      let done = false;
      const go = () => { if (!done) { done = true; resolve(); } };
      requestAnimationFrame(go);
      setTimeout(go, 60); // keeps going in a background tab
    }).then(alive);
    const sleep = async (ms: number) => {
      const until = performance.now() + ms;
      while (performance.now() < until) await frame();
    };
    const tap = async (key: string, label?: string) => {
      sendKey('keydown', key);
      await sleep(70);
      sendKey('keyup', key);
      t.add('interactions');
      if (label) t.log(`press ${key === ' ' ? 'Space' : key.toUpperCase()} (${label})`);
    };
    const press = (button: HTMLButtonElement, label: string) => {
      button.click();
      t.add('interactions');
      t.log(`click ${label}`);
    };
    const full = id === 'full';
    const speed = Math.max(1, Number(options.speed) || 1);
    let rng = (Number(options.seed) || 1) >>> 0 || 1;
    const random = () => { rng ^= rng << 13; rng >>>= 0; rng ^= rng >> 17; rng ^= rng << 5; rng >>>= 0; return rng / 4294967296; };

    // ---- what the bot watches every frame
    let lastLine = '';
    let lastPhone = '';
    let scene: { id: string; t0: number; limit: number; skipAt: number; last: number; skipped: boolean } | null = null;
    let lastPos: { x: number; z: number; y: number } | null = null;
    let fallen = false;
    let levelIndex = 0;
    let levelsTotal = 1;
    let levelSteps = 0;
    const seenRaw = new Set<string>();

    const mark = () => t.progress((levelIndex + Math.min(0.92, levelSteps * 0.08)) / levelsTotal);

    const checkCopy = (where: string, text: string) => {
      if (!text) return;
      const m = RAW_KEY.exec(text);
      if (!m || seenRaw.has(m[0])) return;
      seenRaw.add(m[0]);
      t.problem('bug', `missing locale string? "${m[0]}" shown in ${where}: "${text.slice(0, 90)}"`);
    };

    const controllable = () => probe.running() && !probe.cutscene() && !probe.scripted() && !probe.menu().open;

    const observe = () => {
      const sub = probe.subtitle();
      const line = sub.text.trim();
      if (line && line !== lastLine) {
        t.add('dialogueLines');
        t.event('dialogue', `${sub.speaker || '—'}: ${line.slice(0, 100)}`);
        checkCopy('subtitle', `${sub.speaker} ${line}`);
        mark();
      }
      lastLine = line;
      const ph = probe.phone();
      const pline = ph.line.trim();
      if (pline && pline !== lastPhone && ph.busy) {
        t.add('dialogueLines');
        t.event('dialogue', `phone ${ph.speaker || '—'}: ${pline.slice(0, 100)}`);
        checkCopy('phone', `${ph.speaker} ${pline}`);
        mark();
      }
      lastPhone = pline;
      const obj = probe.objective();
      if (obj.visible) {
        checkCopy('objective', `${obj.title} ${obj.text}`);
        if (!obj.text.trim()) {
          const key = `empty-objective-${probe.level().libraryId}-${obj.title}`;
          if (!seenRaw.has(key)) { seenRaw.add(key); t.problem('warning', `objective "${obj.title}" shows with no text on ${probe.level().name}`); }
        }
      }
      const label = probe.action();
      if (label) checkCopy('action button', label);
      const menu = probe.menu();
      if (menu.open) checkCopy('card', `${menu.title} ${menu.text}`);

      // Cutscenes: timeline scenes and the scripted ones (lobby, desk, station opening).
      const cut = probe.cutscene();
      const scripted = probe.scripted();
      const nowId = cut?.id ?? scripted ?? '';
      if (nowId && (!scene || scene.id !== nowId)) {
        if (scene) endScene();
        const limit = cut ? cut.duration * 1.25 + 8 : SCRIPTED_LIMIT;
        const skipAfter = full ? FULL_SKIP_AFTER[nowId] : undefined;
        const bySpeed = speed > 1 && cut ? cut.duration / speed : undefined;
        scene = { id: nowId, t0: performance.now(), limit, skipAt: Math.min(skipAfter ?? Infinity, bySpeed ?? Infinity), last: -1, skipped: false };
        t.add('cutscenes');
        t.event('cutscene-start', nowId);
        levelSteps += 1;
        mark();
      } else if (!nowId && scene) {
        endScene();
      }
      if (scene) {
        const secs = (performance.now() - scene.t0) / 1000;
        const time = cut?.time ?? secs;
        if (time > scene.last + 0.5) { scene.last = time; mark(); }
        if (!scene.skipped && secs > scene.skipAt) {
          scene.skipped = true;
          t.event('cutscene-skip', `${scene.id} at ${secs.toFixed(0)} s`);
          if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        } else if (!scene.skipped && secs > scene.limit) {
          scene.skipped = true;
          t.problem('bug', `cutscene "${scene.id}" never ended (${secs.toFixed(0)} s, expected about ${Math.round(scene.limit)} s)`);
          if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        }
      }

      // Falls and knockbacks (a car on the street throws him to the curb).
      const p = probe.player();
      if (controllable()) {
        if (lastPos) {
          const jump = Math.hypot(p.x - lastPos.x, p.z - lastPos.z);
          if (jump > 1.5 && jump < 40) {
            // On the street that is a car throwing him to the curb. Elsewhere the collider pushed him out of something.
            const kind = probe.level().libraryId === 'going-home' ? 'knockback' : 'snap';
            t.add(kind === 'knockback' ? 'knockbacks' : 'positionSnaps');
            t.event(kind, `${jump.toFixed(1)} m at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
          }
        }
        if (p.y < -2 && !fallen) {
          fallen = true;
          t.add('falls');
          t.event('fall', `${probe.level().name} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}), y ${p.y.toFixed(1)}`);
          t.problem('bug', `Pierce fell through the floor on ${probe.level().name} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
        }
        if (p.y > -1) fallen = false;
        lastPos = { x: p.x, z: p.z, y: p.y };
      } else lastPos = null;
    };

    const endScene = () => {
      if (!scene) return;
      const secs = (performance.now() - scene.t0) / 1000;
      t.event('cutscene-end', `${scene.id} after ${secs.toFixed(1)} s${scene.skipped ? ' (skipped)' : ''}`);
      t.metric(`cutscene:${scene.id}`, Math.round(secs * 10) / 10);
      scene = null;
      mark();
    };

    const tick = async () => { await frame(); observe(); };

    // ---- camera and walking
    const measureLook = async () => {
      if (lookSens) return;
      const before = probe.cameraYaw();
      dragLook(12);
      await frame();
      await frame();
      const moved = wrap(probe.cameraYaw() - before);
      if (Math.abs(moved) > 1e-4) {
        lookSens = moved / 12;
        dragLook(-12);
      }
    };

    const face = (heading: number) => {
      const err = wrap(heading - probe.cameraYaw());
      if (Math.abs(err) < 0.04 || !lookSens) return err;
      const px = Math.max(-14, Math.min(14, err / lookSens));
      if (Math.abs(px) >= 0.5) dragLook(px);
      return err;
    };

    const OCTANTS: Record<number, string> = { 0: 'w', 1: 'wd', 2: 'd', 3: 'sd', 4: 's', [-4]: 's', [-1]: 'wa', [-2]: 'a', [-3]: 'sa' };
    const steer = (to: Point, turn = true) => {
      const p = probe.player();
      const heading = Math.atan2(to.x - p.x, to.z - p.z);
      if (turn) face(heading);
      const rel = wrap(heading - probe.cameraYaw());
      setHeld(OCTANTS[Math.round(rel / (Math.PI / 4))] ?? 'w');
    };

    type Nav = { key: string; goal: Point; path: Point[] | null; grid: Grid | null; built: number; best: number; bestAt: number; wpBest: number; wpAt: number; recover: number; reported: boolean; direct: boolean };
    let nav: Nav | null = null;
    const unreachableSince = new Map<string, number>();

    const streetRoute = (from: Point, goal: Point): Point[] => {
      // Going Home: the south sidewalk of the main avenue runs from the tower to the stairs.
      const pts: Point[] = [];
      if (Math.abs(from.z - STREET_LANE_Z) > 1.2) pts.push({ x: from.x + 1.5, z: STREET_LANE_Z });
      if (goal.x - from.x > 6) pts.push({ x: goal.x - 4, z: STREET_LANE_Z });
      pts.push(goal);
      return pts;
    };

    const plan = (goal: Point, key: string) => {
      const lib = probe.level().libraryId;
      const here = probe.player();
      const grid = buildGrid(probe.scene, lib);
      let path: Point[] | null = null;
      let direct = false;
      if (grid && nearestOpen(grid, here, 2.5)) path = findPath(grid, here, goal);
      if (!path) {
        direct = true;
        const onGrid = !!(grid && nearestOpen(grid, here, 2.5));
        const waitedK = `unreachable-${lib}-${key}`;
        const waited = performance.now() - (unreachableSince.get(waitedK) ?? performance.now());
        // On a grid level, hold still first: the goal is often behind a door that opens on its own.
        path = lib === 'going-home' ? streetRoute(here, goal) : onGrid && waited < 8000 ? [] : [goal];
        const k = `unreachable-${lib}-${key}`;
        const first = unreachableSince.get(k) ?? performance.now();
        unreachableSince.set(k, first);
        // Doors open on their own (the B3 cab), so only report a goal that stays cut off.
        if (grid && nearestOpen(grid, here, 2.5) && lib !== 'going-home' && performance.now() - first > 8000) {
          if (!seenRaw.has(k)) {
            seenRaw.add(k);
            t.problem('bug', `no walkable path to "${key}" at (${goal.x.toFixed(1)}, ${goal.z.toFixed(1)}) on ${probe.level().name} from (${here.x.toFixed(1)}, ${here.z.toFixed(1)}); trying a straight line`);
          }
        }
      }
      const now = performance.now();
      const d = dist(here, goal);
      // A re-plan for the same goal keeps the stuck clock running.
      const same = nav && nav.key === key && dist(nav.goal, goal) <= 0.5 ? nav : null;
      nav = {
        key, goal, path, grid, built: now, best: same ? Math.min(same.best, d) : d, bestAt: same?.bestAt ?? now,
        wpBest: Infinity, wpAt: now, recover: same?.recover ?? 0, reported: same?.reported ?? false, direct,
      };
      t.log(`route to ${key}: ${path.length} waypoints${direct ? ' (direct)' : ''}, ${d.toFixed(1)} m`);
    };

    /** One frame of walking toward goal. Returns true once within `arrive` metres. */
    const walkTo = async (goal: Point, key: string, arrive = 0.55): Promise<boolean> => {
      const here = probe.player();
      const d = dist(here, goal);
      if (d <= arrive) { releaseAll(); return true; }
      if (!nav || nav.key !== key || dist(nav.goal, goal) > 0.5 || (nav.direct && performance.now() - nav.built > 3000)) plan(goal, key);
      const n = nav!;
      const now = performance.now();
      if (d < n.best - 0.5) { n.best = d; n.bestAt = now; n.recover = 0; levelSteps += 0.02; mark(); }
      // Drop reached waypoints.
      if (n.grid && probe.level().libraryId !== 'going-home' && !nearestOpen(n.grid, here, 1.6)) {
        const k = `outside-${probe.level().libraryId}`;
        if (!seenRaw.has(k)) {
          seenRaw.add(k);
          t.problem('bug', `Pierce is outside the walkable area on ${probe.level().name} at (${here.x.toFixed(1)}, ${here.z.toFixed(1)}): through a wall?`);
        }
      }
      while (n.path && n.path.length > 1 && dist(here, n.path[0]) < 0.5) { n.path.shift(); n.wpBest = Infinity; }
      if (n.path && !n.path.length) { releaseAll(); n.wpAt = now; return false; } // waiting for a way through
      const wp = n.path?.[0] ?? goal;
      const wd = dist(here, wp);
      if (wd < n.wpBest - 0.2) { n.wpBest = wd; n.wpAt = now; }
      if (now - n.wpAt > 2600) {
        // No closer to the next waypoint: hop, sidestep, plan again.
        n.recover += 1;
        t.add('stuckRecoveries');
        t.log(`stuck near (${here.x.toFixed(1)}, ${here.z.toFixed(1)}) going to ${key}, recovery ${n.recover}`);
        const side = random() < 0.5 ? 'a' : 'd';
        setHeld(side);
        await tap(' ');
        await sleep(450);
        setHeld('s');
        await sleep(250);
        releaseAll();
        plan(goal, key);
        return false;
      }
      if (now - n.bestAt > 30000 && !n.reported) {
        n.reported = true;
        t.problem('bug', `stuck: no movement toward "${key}" for 30 s on ${probe.level().name} at (${here.x.toFixed(1)}, ${here.z.toFixed(1)}), ${d.toFixed(1)} m away`);
      }
      if (now - n.bestAt > 45000) throw new Error(`timed out walking to ${key}`);
      t.note(`walking to ${key.slice(0, 40)}: ${d.toFixed(1)} m, at (${here.x.toFixed(1)}, ${here.z.toFixed(1)})`);
      steer(wp);
      return false;
    };

    // ---- menus
    const waitControl = async (what: string, ms = 90000) => {
      const until = performance.now() + ms;
      while (!(probe.running() && !probe.menu().open)) {
        if (performance.now() > until) throw new Error(`timed out waiting for ${what}`);
        await tick();
      }
    };

    const enterLevel = async (n: number) => {
      const menu = probe.menu();
      const lvl = probe.level();
      if (n === 1 && menu.open && lvl.id === 1 && menu.start && /start/i.test(menu.start)) {
        press(probe.startButton, menu.start);
      } else if (n === 1 && menu.open && menu.newGame) {
        press(probe.newGameButton, 'New Game');
      } else {
        t.event('setup', `start at level ${n} directly (test shortcut)`);
        await probe.setupLevel(n);
      }
      const until = performance.now() + 90000;
      while (!(probe.running() && probe.level().id === n)) {
        if (performance.now() > until) throw new Error(`timed out waiting for level ${n} to start`);
        await tick();
      }
    };

    // ---- per level special play
    let lastShot = 0;
    let huntDownAt = 0;
    let huntNudged = false;
    let lastKey: Record<string, number> = {};
    const once = async (key: string, gapMs: number, label: string) => {
      const now = performance.now();
      if ((lastKey[key] ?? 0) + gapMs > now) return false;
      lastKey[key] = now;
      await tap(key, label);
      return true;
    };

    const huntStep = async () => {
      const p = probe.player();
      if (!p.weaponDrawn) { releaseAll(); await once('q', 1800, 'draw sidearm'); return; }
      if (p.health < 45 && p.medkits > 0) await once('h', 2000, 'medkit');
      if (p.clip <= 0) {
        if (p.ammo > 0) { releaseAll(); await once('r', 2200, 'reload'); return; }
        const box = probe.pickups().filter((k) => k.item === 'ammo').sort((a, b) => dist(p, a) - dist(p, b))[0];
        if (box) {
          if (await walkTo(box, 'ammo box', 0.9)) await once('e', 900, 'take ammo');
          return;
        }
      }
      const beast = probe.creature();
      if (!beast) {
        // Dropped: it runs for the vat and the vat scene starts on its own. Follow the marker like a player.
        if (!huntDownAt) huntDownAt = performance.now();
        const waited = performance.now() - huntDownAt;
        const goal = probe.objective().target;
        if (waited < 14000 && goal) {
          if (await walkTo(goal, 'vat (creature down)', 2)) releaseAll();
          return;
        }
        if (!huntNudged) {
          huntNudged = true;
          t.problem('bug', 'B3 softlock: the creature went down before Pierce entered decon, and it never ran for the vat. stepHunt returns while huntWaiting is true, so the retreat timer never runs until he walks into the den (act1.ts).');
        }
        await walkTo(B3_DEN, 'decon (unstick the vat run)', 1.2);
        return;
      }
      const d = dist(p, beast);
      const heading = Math.atan2(beast.x - p.x, beast.z - p.z);
      const locked = probe.aimLocked();
      if ((locked && d < 15) || d < 3.2) {
        // Stand, turn to it, fire. Up close a shot lands without the snap when he faces it.
        releaseAll();
        const err = face(heading);
        if ((locked || Math.abs(err) < 0.18) && performance.now() - lastShot > 380) {
          lastShot = performance.now();
          clickCanvas();
          t.add('shots');
          t.add('interactions');
        }
        return;
      }
      // Not in sight yet: walk in (it waits in decon until Pierce enters, then hunts him).
      await walkTo(beast, 'creature', 2.6);
    };

    let lesson = { started: 0, gaveUp: false };
    const streetLessonStep = async (): Promise<boolean> => {
      // Going Home teaches Shadow mode: use Shadow Shock and Possess on passersby. Returns false when it is done.
      if (lesson.gaveUp) return false;
      if (!lesson.started) { lesson.started = performance.now(); t.event('tutorial-start', 'street powers'); }
      if (performance.now() - lesson.started > 70000) {
        lesson.gaveUp = true;
        t.problem('warning', 'bot could not finish the street powers tutorial in 70 s (Shadow Shock, then Possess on a passerby)');
        return false;
      }
      const sh = probe.shadow();
      if (!sh.controls) return true;
      if (!sh.on) { releaseAll(); await once('c', 1200, 'Shadow mode'); return true; }
      if (sh.linked) { releaseAll(); await once('Tab', 1200, 'release link'); return true; }
      const p = probe.player();
      const crowd = probe.people().filter((x) => x.kind === 'person' || x.kind === 'hostile');
      const target = crowd.sort((a, b) => dist(p, a) - dist(p, b))[0];
      const wantPossess = sh.lessonStarted;
      if (wantPossess && sh.ability !== 'possess') { releaseAll(); await once('Tab', 900, 'switch to Possess'); return true; }
      if (wantPossess && !sh.handsOut) { releaseAll(); await once('q', 1200, 'raise hands'); return true; }
      if (!target) { setHeld('w'); return true; }
      const d = dist(p, target);
      if (!wantPossess) {
        if (d < 2.2) { releaseAll(); face(Math.atan2(target.x - p.x, target.z - p.z)); await sleep(120); clickCanvas(); t.add('interactions'); t.log('click Shadow Shock'); await sleep(900); return true; }
        steer(target);
        return true;
      }
      if (d < 4.5) {
        releaseAll();
        const err = face(Math.atan2(target.x - p.x, target.z - p.z));
        if (probe.aimLocked() || Math.abs(err) < 0.25) {
          clickCanvas();
          t.add('interactions');
          t.log('click Possess');
          await sleep(700);
        }
        return true;
      }
      steer(target);
      return true;
    };

    // ---- one level, start to the Level Complete card
    const playLevel = async (n: number): Promise<Outcome> => {
      const info = LEVELS[n - 1];
      const t0 = performance.now();
      levelSteps = 0;
      nav = null;
      lesson = { started: 0, gaveUp: false };
      t.scene(info.name);
      t.event('level-start', info.name);
      mark();
      let endPressed = false;
      let defeats = 0;
      let lastAction = '';
      await measureLook();
      for (;;) {
        await tick();
        const menu = probe.menu();
        if (menu.open) {
          if (menu.title === 'Defeat') {
            releaseAll();
            defeats += 1;
            t.add('respawns');
            t.event('defeat', `${info.name}, try ${defeats}`);
            if (defeats > 4) return 'lost';
            await sleep(1200);
            if (menu.start) press(probe.startButton, 'Start (retry)');
            await waitControl('retry');
            nav = null;
            continue;
          }
          if (endPressed) break;
          continue;
        }
        if (!probe.running()) continue;
        if (probe.cutscene() || probe.scripted()) { releaseAll(); continue; }
        if (!lookSens) await measureLook();
        const phone = probe.phone();
        if (phone.incoming) { releaseAll(); await once('f', 1500, 'answer call'); t.event('call', phone.speaker || 'incoming'); continue; }
        if (phone.busy) { releaseAll(); continue; }
        const label = probe.action();
        if (label) {
          releaseAll();
          if (await once('e', 1200, label)) {
            if (label !== lastAction) t.event('action', label);
            lastAction = label;
            levelSteps += 1;
            mark();
            if (label === 'End Level') endPressed = true;
          }
          continue;
        }
        const lib = probe.level().libraryId;
        const phase = probe.phase();
        if (lib === 'b3-basement' && phase === 'hunt') {
          await huntStep();
          continue;
        }
        const obj = probe.objective();
        if (lib === 'going-home' && !obj.target && probe.shadow().controls && (await streetLessonStep())) continue;
        // A possess link steers the other body, so let go before walking on.
        if (probe.shadow().linked && (await once('Tab', 1200, 'release link'))) continue;
        let goal = obj.target;
        if (!goal && lib === 'going-home' && probe.shadow().controls) goal = HOME_STAIRS;
        if (!goal) { releaseAll(); continue; }
        // While the board walks out, wait in the room instead of standing in their doorway.
        const arrive = phase === 'wait-board' ? 4 : lib === 'the-station' ? 0.25 : 0.45;
        const there = await walkTo(goal, `${obj.title || 'objective'}: ${obj.text.slice(0, 40)}`, arrive);
        if (there && phase !== 'wait-board') {
          // At the mark and no action yet: inch to the exact point (walk-ups test the trigger radius).
          const p = probe.player();
          if (dist(p, goal) > 0.12) steer(goal, false);
          else releaseAll();
        }
      }
      releaseAll();
      const secs = (performance.now() - t0) / 1000;
      t.metric(`level${n}Seconds`, Math.round(secs));
      t.event('level-end', `${info.name} in ${secs.toFixed(0)} s`);
      return 'won';
    };

    // ---- phone-b3: the phone title card and buttons, About beat 01, B3 with the creature downed early
    const shown = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 ? r : null;
    };
    const box = (r: DOMRect) => `${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`;
    const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const HUD_PARTS: [string, string][] = [['touch controls', '.controls .stick-ring'], ['action buttons', '#jumpBtn'], ['health bar', '#healthBar'], ['objective card', '#objectiveHud']];
    const hudShowing = () => HUD_PARTS.filter(([, sel]) => shown(document.querySelector(sel))).map(([name]) => name);
    const cardOpacity = () => {
      const el = document.getElementById('messageBox');
      return el && !el.classList.contains('hidden') ? +getComputedStyle(el).opacity : 0;
    };

    const phoneChecks = async () => {
      const framed = window.innerWidth > 600;
      if (framed) {
        t.event('setup', `phone layout 390x844 (the viewport is ${window.innerWidth}x${window.innerHeight})`);
        probe.phoneFrame(true);
      }
      t.scene('Phone title card');
      t.progress(0.05);
      await sleep(1200);
      const early = hudShowing();
      t.event('title-card', `card up, level running: ${probe.running()}, HUD showing: ${early.join(', ') || 'none'}`);
      if (early.length) t.problem('bug', `phone: ${early.join(', ')} show around the title card before Start`);
      await sleep(2500);
      if (probe.running()) t.problem('bug', 'phone: the level is running behind the title card before Start was tapped');
      else t.event('check', 'level waits for Start: not running after 3.7 s on the title card');

      const menu = probe.menu();
      press(probe.startButton, menu.start ?? 'Start');
      const t0 = performance.now();
      let goneAt = 0;
      let runAt = 0;
      let hudAt = 0;
      let reported = false;
      while (performance.now() - t0 < 20000 && !(goneAt && runAt && hudAt)) {
        await tick();
        const opacity = cardOpacity();
        const hud = hudShowing();
        const ms = Math.round(performance.now() - t0);
        if (!goneAt && opacity === 0) { goneAt = ms; t.event('card-gone', `${ms} ms after Start`); }
        if (!runAt && probe.running()) { runAt = ms; t.event('level-running', `${ms} ms after Start`); }
        if (!hudAt && hud.length) { hudAt = ms; t.event('hud-shown', `${ms} ms after Start: ${hud.join(', ')}`); }
        if (!reported && opacity > 0 && (hud.length || probe.running())) {
          reported = true;
          t.problem('bug', `phone: ${probe.running() ? 'the level runs' : `${hud.join(', ')} show`} while the title card is still on screen (opacity ${opacity.toFixed(2)})`);
        }
      }
      if (!reported && goneAt) t.event('check', `title card gone first (${goneAt} ms), then the level (${runAt} ms) and HUD (${hudAt} ms)`);
      t.progress(0.15);
      await waitControl('level 1 after Start');
      await sleep(3000);

      t.scene('Phone action buttons');
      t.progress(0.2);
      const frame = document.getElementById('game-root')!.getBoundingClientRect();
      const screen = framed ? frame : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      const scale = framed ? frame.width / 390 : 1;
      const buttons = ['#phoneBtn', '#fireBtn', '#jumpBtn'].map((sel) => [sel, shown(document.querySelector(sel))] as const);
      const stick = shown(document.querySelector('#rightStickZone .stick-ring'));
      const badge = shown(document.getElementById('perfMonitor'));
      for (const [sel, r] of buttons) {
        if (!r) { t.problem('bug', `phone: action button ${sel} is not visible`); continue; }
        const inside = r.left >= screen.left - 0.5 && r.right <= screen.right + 0.5 && r.top >= screen.top - 0.5 && r.bottom <= screen.bottom + 0.5;
        const size = Math.round(r.width / scale);
        t.event('phone-button', `${sel} ${size} px, ${inside ? 'inside' : 'OUTSIDE'} the screen (${box(r)}; screen ${box(screen)})`);
        if (!inside) t.problem('bug', `phone: action button ${sel} is clipped by the screen edge (${box(r)}; screen ${box(screen)})`);
        if (size > 64 || size < 56) t.problem('warning', `phone: action button ${sel} is ${size} px (asked for 56-64)`);
        if (badge && overlaps(r, badge)) t.problem('bug', `phone: the FPS badge covers ${sel} (badge ${box(badge)}; button ${box(r)})`);
      }
      t.event('fps-badge', badge ? `shown at ${box(badge)} (debug build)` : 'hidden');
      const top = Math.min(...buttons.map(([, r]) => r?.top ?? Infinity));
      if (stick && Number.isFinite(top)) {
        const gap = Math.round((top - stick.bottom) / scale);
        t.event('look-stick-gap', `${gap} px between the look stick and the buttons`);
        if (gap < 12) t.problem('bug', `phone: only ${gap} px between the look joystick and the action buttons`);
      }
      await sleep(3000);
      if (framed) {
        probe.phoneFrame(false);
        t.event('setup', 'phone layout off');
      }
    };

    const aboutCheck = async () => {
      t.scene('About page');
      const url = new URL(location.pathname.includes('/play/') ? '../about.html' : './about.html', location.href);
      const frame = document.createElement('iframe');
      frame.src = url.href;
      Object.assign(frame.style, { position: 'fixed', inset: '4%', width: '92%', height: '92%', zIndex: '9999', border: '2px solid #d4b483', background: '#05080c' });
      document.body.appendChild(frame);
      try {
        const until = performance.now() + 20000;
        while (!frame.contentDocument?.querySelector('#basement') && performance.now() < until) await sleep(200);
        await sleep(600);
        const doc = frame.contentDocument;
        if (!doc) { t.problem('warning', `About page did not load in the overlay (${url.href})`); return; }
        const beat = doc.getElementById('board');
        beat?.scrollIntoView({ block: 'center' });
        await sleep(600);
        const read = (id: string) => {
          const lede = doc.querySelector(`#${id} .lede`);
          const r = lede?.getBoundingClientRect();
          const cs = lede ? frame.contentWindow!.getComputedStyle(lede) : null;
          const visible = !!(r && r.height > 0 && cs && cs.visibility !== 'hidden' && +cs.opacity > 0.05);
          return { visible, text: (lede?.textContent ?? '').trim().replace(/\s+/g, ' ') };
        };
        for (const [n, id] of [['01', 'board'], ['02', 'glass'], ['03', 'basement']] as const) {
          const got = read(id);
          t.event('about-beat', `${n} ${got.visible ? 'shows' : 'NO'} paragraph${got.text ? `: ${got.text.slice(0, 80)}…` : ''}`);
          if (!got.visible || got.text.length < 40) t.problem('bug', `About: beat ${n} shows its heading but no paragraph`);
        }
        await sleep(3500);
      } finally {
        frame.remove();
      }
    };

    /** About's "What you can play": a Playable card for levels 1-7, no "still being built out". */
    const aboutLevelsCheck = async (doc: Document, frame: HTMLIFrameElement) => {
      const grid = doc.querySelector('.levels');
      if (!grid) { t.problem('bug', 'About page: no "What you can play" level cards'); return; }
      grid.scrollIntoView({ block: 'center', behavior: 'instant' });
      await sleep(900);
      const cards = [...grid.querySelectorAll<HTMLElement>('.level')];
      const text = (el: Element | null) => (el?.textContent ?? '').trim().replace(/\s+/g, ' ');
      for (let n = 1; n <= 7; n++) {
        const card = cards.find((c) => new RegExp(`^Level ${n}\\b`).test(text(c.querySelector('.kicker'))));
        const kicker = text(card?.querySelector('.kicker') ?? null);
        const r = card?.getBoundingClientRect();
        const cs = card ? frame.contentWindow!.getComputedStyle(card) : null;
        const visible = !!(r && r.width > 0 && r.height > 0 && cs && cs.visibility !== 'hidden' && cs.display !== 'none');
        const ok = !!card && visible && /playable/i.test(kicker);
        if (card) card.style.outline = `2px solid ${ok ? '#d4b483' : '#ff4d4d'}`;
        t.event('about-level', `${ok ? 'shows' : 'NO'} level ${n}${card ? `: "${kicker}" ${text(card.querySelector('h3'))}` : ''}`);
        if (!ok) t.problem('bug', `About page: level ${n} should show a Playable card (got ${card ? `"${kicker}"${visible ? '' : ', hidden'}` : 'none'})`);
      }
      const stale = /still being built out/i.test(text(doc.body));
      t.event('about-stale', stale ? 'the "still being built out" line is still on the page' : 'no "still being built out" line');
      if (stale) t.problem('bug', 'About page still says the rooms are "still being built out"');
      await sleep(3000); // hold the cards for the footage
    };

    /** Each site page in an overlay: the footer's Powered by HAWKES GEN link, and Hawkes Biomedical on Home. */
    const siteLinksCheck = async () => {
      const pages: [string, string][] = [['index.html', 'Home'], ['about.html', 'About'], ['characters.html', 'Characters'], ['whatsnew.html', 'What\'s new']];
      const want: [string, string, RegExp, string][] = [
        ['gen', 'https://hawkesgen.com', /powered by\s+hawkes gen/i, 'Powered by HAWKES GEN'],
        ['parent', 'https://hawkesbiomedical.com', /hawkes biomedical/i, 'Hawkes Biomedical'],
      ];
      for (const [i, [file, name]] of pages.entries()) {
        t.scene(`${name} page`);
        const url = new URL((location.pathname.includes('/play/') ? '../' : './') + file, location.href);
        const frame = document.createElement('iframe');
        frame.src = url.href;
        Object.assign(frame.style, { position: 'fixed', inset: '4%', width: '92%', height: '92%', zIndex: '9999', border: '2px solid #d4b483', background: '#05080c' });
        document.body.appendChild(frame);
        try {
          const until = performance.now() + 20000;
          while (!frame.contentDocument?.querySelector('footer') && performance.now() < until) await sleep(200);
          await sleep(600);
          const doc = frame.contentDocument;
          const footer = doc?.querySelector('footer');
          if (!doc || !footer) { t.problem('bug', `${name} page did not load in the overlay (${url.href})`); continue; }
          if (file === 'about.html') await aboutLevelsCheck(doc, frame);
          footer.scrollIntoView({ block: 'end', behavior: 'instant' });
          await sleep(900);
          for (const [kind, href, text, label] of want) {
            if (kind === 'parent' && file !== 'index.html') continue;
            const match = (root: ParentNode) => [...root.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) => a.href.replace(/\/$/, '') === href);
            const links = match(footer).length ? match(footer) : match(doc);
            const link = links.find((a) => text.test(a.textContent ?? '')) ?? links[0];
            const r = link?.getBoundingClientRect();
            const cs = link ? frame.contentWindow!.getComputedStyle(link) : null;
            const visible = !!(r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < frame.clientHeight && cs && cs.visibility !== 'hidden' && +cs.opacity > 0.05);
            const shown = (link?.textContent ?? '').trim().replace(/\s+/g, ' ');
            if (link) link.style.outline = '2px solid #d4b483';
            t.event('site-link', `${name}: ${visible && text.test(shown) ? 'shows' : 'NO'} "${label}" → ${href}${link ? ` (text "${shown}", ${visible ? 'visible' : 'not visible'})` : ''}`);
            if (!link) t.problem('bug', `${name} page: no link to ${href}`);
            else if (!visible || !text.test(shown)) t.problem('bug', `${name} page: the ${href} link is not a visible "${label}" (text "${shown}", ${visible ? 'visible' : 'hidden'})`);
          }
          await sleep(2500);
        } finally {
          frame.remove();
        }
        t.progress(0.15 + (0.65 * (i + 1)) / pages.length);
      }
      // The game screen stays as it was: no credit on the title card or in the HUD.
      t.scene('Game screen');
      await sleep(400);
      const inGame = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) => /hawkesgen\.com|hawkesbiomedical\.com/.test(a.href) || a.hasAttribute('data-hawkes-credit'));
      t.event('game-screen', inGame.length ? `credit links on the game page: ${inGame.map((a) => a.href).join(', ')}` : 'unchanged: no credit links on the game page');
      if (inGame.length) t.problem('bug', `the game page shows ${inGame.length} credit link(s); the credit belongs on the site pages only`);
      await sleep(2000);
    };

    /** Stand still until the objective changes to a hint that matches. */
    const waitHint = async (what: string, test: RegExp, ms: number) => {
      releaseAll();
      const t0 = performance.now();
      t.event('stand-still', `${what}: waiting for a way hint`);
      while (performance.now() - t0 < ms) {
        await tick();
        const obj = probe.objective();
        if (test.test(obj.text)) {
          const secs = ((performance.now() - t0) / 1000).toFixed(0);
          t.event('way-hint', `${what} after ${secs} s: ${obj.title} - ${obj.text}${obj.target ? ` (marker at ${obj.target.x.toFixed(1)}, ${obj.target.z.toFixed(1)})` : ''}`);
          levelSteps += 1;
          mark();
          return true;
        }
        if (Math.round(performance.now() - t0) % 5000 < 70) { levelSteps += 0.05; mark(); }
      }
      t.problem('bug', `B3: no way hint ${what} after ${Math.round(ms / 1000)} s without progress (objective still "${probe.objective().text}")`);
      return false;
    };

    const SHOOT_FROM = { x: 7.2, z: 32.6 }; // inside the lab, by the south door; decon starts at z 30.6
    const earlyDownB3 = async (): Promise<Outcome> => {
      levelIndex = 1;
      await enterLevel(2);
      mark();
      t.scene(LEVELS[1].name);
      t.event('level-start', `${LEVELS[1].name} (creature downed before decon)`);
      await measureLook();
      await waitControl('B3 arrival');
      while (probe.phase() === 'arrive') await tick();
      await waitHint('toward the lab door', /ACID VAT/i, 32000);

      // To the lab door and the reveal, like a player.
      for (;;) {
        await tick();
        if (probe.cutscene()) { releaseAll(); continue; }
        if (probe.phase() === 'hunt') break;
        const phone = probe.phone();
        if (phone.incoming) { releaseAll(); await once('f', 1500, 'answer call'); continue; }
        if (phone.busy) { releaseAll(); continue; }
        const label = probe.action();
        if (label) { releaseAll(); if (await once('e', 1200, label)) t.event('action', label); continue; }
        const goal = probe.objective().target;
        if (goal) await walkTo(goal, 'lab door', 0.45);
      }
      while (probe.cutscene()) await tick();
      await waitHint('after it fled into decon', /decon/i, 32000);

      // Shoot it from the lab without stepping into decon.
      t.scene('B3: down before decon');
      const t0 = performance.now();
      let downAt: { x: number; z: number } | null = null;
      let placed = false;
      let warned = false;
      while (performance.now() - t0 < 60000) {
        await tick();
        const p = probe.player();
        if (!warned && p.z < 30.6 && p.x < 16) { warned = true; t.problem('warning', 'bot stepped into decon before the creature went down'); }
        const beast = probe.creature();
        if (!beast) { downAt = { x: p.x, z: p.z }; break; }
        // Walk toward the south door, stopping short of decon (or where the route ends).
        if (!placed && (dist(p, SHOOT_FROM) < 1.2 || p.z < 31.6 || performance.now() - t0 > 20000)) {
          placed = true;
          t.event('shoot-from', `(${p.x.toFixed(1)}, ${p.z.toFixed(1)}), ${dist(p, beast).toFixed(1)} m from it`);
        }
        if (!placed) { await walkTo(SHOOT_FROM, 'lab, by the south door', 0.45); continue; }
        releaseAll();
        if (!p.weaponDrawn) { await once('q', 1800, 'draw sidearm'); continue; }
        if (p.clip <= 0) { if (p.ammo > 0) await once('r', 2200, 'reload'); continue; }
        const err = face(Math.atan2(beast.x - p.x, beast.z - p.z));
        if ((probe.aimLocked() || Math.abs(err) < 0.12) && performance.now() - lastShot > 420) {
          lastShot = performance.now();
          clickCanvas();
          t.add('shots');
          t.add('interactions');
        }
      }
      if (!downAt) { t.problem('warning', 'bot could not down the creature from the lab in 60 s'); return 'stuck'; }
      t.event('creature-down-early', `Pierce at (${downAt.x.toFixed(1)}, ${downAt.z.toFixed(1)}), outside decon`);
      levelSteps += 2;
      mark();
      const runT0 = performance.now();
      while (!probe.cutscene() && performance.now() - runT0 < 16000) await tick();
      const cut = probe.cutscene();
      if (cut?.id === 'b3-vat-break') t.event('vat-run', `it ran for the vat; vat scene after ${((performance.now() - runT0) / 1000).toFixed(1)} s`);
      else t.problem('bug', 'B3 softlock: the creature went down before Pierce entered decon and never ran for the vat');
      return playLevel(2);
    };

    /**
     * A press on the spot where a player would put a finger or the mouse: whatever is on top there gets it, so a
     * covered control fails. On a touch layout the game's own pointerup handler clicks the button, as on a phone.
     */
    const tapAt = async (el: HTMLElement | null, label: string) => {
      if (!el) throw new Error(`${label} is not on the page`);
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const target = (document.elementFromPoint(x, y) as HTMLElement | null) ?? el;
      if (!el.contains(target)) t.problem('bug', `${label} is covered: a press on it lands on ${target.id ? `#${target.id}` : target.tagName.toLowerCase()}`);
      const touch = document.body.dataset.device === 'mobile' || document.body.dataset.device === 'tablet';
      const init = { pointerType: touch ? 'touch' : 'mouse', pointerId: touch ? 51 : 1, isPrimary: true, button: 0, buttons: 1, bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y };
      target.dispatchEvent(new PointerEvent('pointerdown', init));
      await sleep(60);
      target.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
      if (!touch || !target.closest('button')) target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
      t.add('interactions');
      t.log(`tap ${label}`);
      await sleep(120);
    };
    const tapToPlay = async () => {
      await tapAt(document.getElementById('tapToPlay'), 'Tap to play');
      await t.until(() => !probe.sound().prompt, 5000, 'the Tap to play prompt to go');
      t.event('tap-to-play', 'prompt tapped');
    };

    // ---- b3-retry: Defeat -> Start five times, scene counts stay flat
    const b3RetryRun = async () => {
      levelsTotal = 1;
      const stages = RETRIES + 1;
      // A level keeps loading GLBs after Start is live. Wait until the counts hold still for 3 s (max 90 s).
      const settle = async (what: string) => {
        const until = performance.now() + 90000;
        let last = JSON.stringify(flat(probe.counts()));
        let since = performance.now();
        while (performance.now() < until) {
          await sleep(500);
          const next = JSON.stringify(flat(probe.counts()));
          if (next !== last) {
            last = next;
            since = performance.now();
          } else if (performance.now() - since >= 3000) {
            return probe.counts();
          }
        }
        t.log(`${what}: counts still moving after 90 s`);
        return probe.counts();
      };
      const flat = (c: SceneCounts) => FLAT_COUNTS.map((key) => c[key]);
      const control = async (what: string) => {
        const until = performance.now() + 120000;
        while (!controllable()) {
          if (performance.now() > until) throw new Error(`timed out waiting for ${what}`);
          if (probe.cutscene() && probe.skipButton && !probe.skipButton.hidden) {
            press(probe.skipButton, 'Skip');
            await sleep(800);
          }
          if (probe.phone().incoming) await once('f', 1500, 'answer call');
          await tick();
        }
      };
      const report = (label: string, c: SceneCounts) => {
        t.log(`${label}: ${FLAT_COUNTS.map((key) => `${key} ${c[key]}`).join(', ')}, audio ${c.audioElements}/${c.audioClips}, fps ${c.fps}`);
        t.note(`${label}: meshes ${c.meshes}, materials ${c.materials}, textures ${c.textures}, skeletons ${c.skeletons}`);
      };

      t.scene(LEVELS[1].name);
      await enterLevel(2);
      await control('B3 control');
      const entry = await settle('entry');
      report('entry', entry);
      t.progress(1 / (stages + 1));
      const after: SceneCounts[] = [];
      for (let n = 1; n <= RETRIES; n++) {
        releaseAll();
        await control(`control before death ${n}`);
        if (!probe.forceDefeat()) throw new Error(`could not down Pierce on try ${n}`);
        t.event('defeat', `try ${n} (test shortcut)`);
        const until = performance.now() + 30000;
        while (probe.menu().title !== 'Defeat' || !probe.menu().start) {
          if (performance.now() > until) throw new Error(`no Defeat card on try ${n}`);
          await tick();
        }
        await sleep(800);
        press(probe.startButton, 'Start (retry)');
        t.add('respawns');
        await waitControl(`retry ${n}`, 120000);
        await control(`retry ${n} control`);
        const counts = await settle(`retry ${n}`);
        after.push(counts);
        report(`retry ${n}`, counts);
        t.event('retry', { n, ...counts });
        t.progress((n + 1) / (stages + 1));
      }
      const first = after[0];
      const last = after[after.length - 1];
      for (const key of FLAT_COUNTS) {
        t.metric(`${key}Entry`, entry[key]);
        t.metric(`${key}First`, first[key]);
        t.metric(`${key}Last`, last[key]);
        const growth = last[key] - first[key];
        t.metric(`${key}Growth`, growth);
        // The first retry may still fill a shared cache; after that each retry must come back the same.
        const rising = after.slice(1).every((c, i) => c[key] >= after[i][key]) && growth > 0;
        if (rising && growth >= RETRIES - 1) {
          t.problem('bug', `B3 retry leaks ${key}: ${first[key]} after the first retry, ${last[key]} after ${RETRIES} (${after.map((c) => c[key]).join(' -> ')})`);
        }
      }
      t.metric('audioElementsLast', last.audioElements);
      t.metric('audioClipsLast', last.audioClips);
      t.metric('fpsLast', last.fps);
      t.progress(1);
      t.finish('done');
    };

    // ---- train: level 7's car (hidden level)
    const trainRun = async (): Promise<Outcome> => {
      levelsTotal = 1;
      const deg = (r: number) => (r * 180) / Math.PI;
      // Load Level lists level 7 now that it is released.
      const rows = probe.levelRows();
      const listed = rows.some((row) => /level 7/i.test(row) && /train/i.test(row));
      t.event('check', `Load Level lists ${rows.length} levels: ${rows.join(' | ')}`);
      if (!listed) t.problem('bug', `Load Level does not list level 7, The Train: ${rows.join(' | ')}`);
      t.progress(0.05);

      const sampleFps = async (what: string, ms: number) => {
        releaseAll();
        await sleep(2000); // let the level settle
        const got: number[] = [];
        const until = performance.now() + ms;
        while (performance.now() < until) {
          await sleep(500);
          got.push(probe.counts().fps);
        }
        const avg = got.reduce((a, b) => a + b, 0) / Math.max(1, got.length);
        t.event('fps', `${what}: ${avg.toFixed(1)} fps average, worst ${Math.min(...got).toFixed(1)} (${got.length} samples standing still)`);
        return avg;
      };

      // 4: the baseline, The Station, sampled the same way.
      let fpsStation = 0;
      if (options.compare !== false) {
        await enterLevel(6);
        t.scene(LEVELS[5].name);
        t.event('level-start', `${LEVELS[5].name} (frame rate baseline)`);
        const until = performance.now() + 150000;
        let skipped = false;
        while (probe.scripted() || !probe.running()) {
          if (performance.now() > until) throw new Error('timed out waiting for the station opening to end');
          if (!skipped && probe.scripted() && probe.skipButton && !probe.skipButton.hidden) {
            await sleep(2500);
            press(probe.skipButton, 'Skip');
            skipped = true;
          }
          await tick();
        }
        fpsStation = await sampleFps('The Station', 8000);
        t.metric('fpsStation', Math.round(fpsStation * 10) / 10);
      }
      t.progress(0.3);

      // 1: enter the car.
      t.event('setup', 'start level 7, The Train, directly (test shortcut, as ?beat=train)');
      await probe.setupHidden('the-train');
      await t.until(() => probe.running() && probe.level().libraryId === 'the-train' && !probe.menu().open, 90000, 'level 7 to start');
      t.scene('Level 7: The Train');
      t.event('level-start', 'Level 7: The Train (hidden)');
      // The level opens on a scene: Skip it, the car is what this run looks at.
      await t.until(() => !!probe.scripted() || controllable(), 15000, 'the opening scene or control');
      if (probe.scripted()) {
        await sleep(1500);
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        await t.until(() => controllable(), 10000, 'control after the opening');
      }
      await measureLook();
      const car = probe.train();
      if (!car) {
        t.problem('bug', 'level 7 started but the train car kit is not mounted');
        return 'error';
      }
      const start = probe.player();
      t.event('car', `${car.seats} benches, ${car.poles} poles, ${car.ads} ads, ${car.windows} windows; Pierce at (${start.x.toFixed(1)}, ${start.z.toFixed(1)})`);
      if (car.seats < 8 || car.poles < 4 || car.ads < 4 || car.windows < 8) t.problem('bug', `the car is missing parts: ${JSON.stringify(car)}`);

      // Look out of the north windows: lamps going past, and the sway.
      face(0);
      await sleep(600);
      face(0);
      const lamps0 = probe.train()?.lampsPassed ?? 0;
      let rollMin = Infinity;
      let rollMax = -Infinity;
      const t0 = performance.now();
      while (performance.now() - t0 < 5000) {
        await tick();
        const r = probe.train()?.roll ?? 0;
        rollMin = Math.min(rollMin, r);
        rollMax = Math.max(rollMax, r);
      }
      const secs = (performance.now() - t0) / 1000;
      const now = probe.train();
      const lamps = (now?.lampsPassed ?? 0) - lamps0;
      t.event('tunnel', `${lamps} tunnel lamps went past the windows in ${secs.toFixed(1)} s at ${now?.speed ?? 0} m/s`);
      t.metric('lampsPerSecond', Math.round((lamps / secs) * 100) / 100);
      if (lamps < 2) t.problem('bug', `the tunnel is not moving past the windows (${lamps} lamps in ${secs.toFixed(1)} s)`);
      const sway = deg(rollMax - rollMin);
      t.event('sway', `the car rolls between ${deg(rollMin).toFixed(2)}° and ${deg(rollMax).toFixed(2)}° (${sway.toFixed(2)}° swing)`);
      t.metric('swayDegrees', Math.round(sway * 100) / 100);
      if (sway < 0.3) t.problem('bug', `no visible sway: ${sway.toFixed(2)}° of roll in ${secs.toFixed(1)} s`);
      if (sway > 4) t.problem('warning', `the sway is more than slight: ${sway.toFixed(2)}° of roll`);
      face(Math.PI / 2);
      t.progress(0.45);

      // 4: the frame rate in the car, sampled like the station.
      const fpsTrain = await sampleFps('The Train', 8000);
      t.metric('fpsTrain', Math.round(fpsTrain * 10) / 10);
      if (fpsStation > 0) {
        t.event('check', `frame rate: train ${fpsTrain.toFixed(1)} vs station ${fpsStation.toFixed(1)} fps`);
        if (fpsTrain < fpsStation * 0.9) t.problem('bug', `the train runs slower than The Station: ${fpsTrain.toFixed(1)} vs ${fpsStation.toFixed(1)} fps`);
      }
      t.progress(0.55);

      // 2: the seats and poles block. Walk into each with real input and see how close he gets.
      const arrive = async (goal: Point, key: string) => {
        const until = performance.now() + 30000;
        while (!(await walkTo(goal, key, 0.35))) {
          if (performance.now() > until) throw new Error(`timed out walking to ${key}`);
          await tick();
        }
        releaseAll();
        await sleep(300);
      };
      /** Hold the walk toward a point; closest is to `watch` (the thing walked into). */
      const push = async (toward: Point, ms: number, watch: Point = toward) => {
        let closest = Infinity;
        let far = -Infinity;
        const until = performance.now() + ms;
        while (performance.now() < until) {
          steer(toward, true);
          await tick();
          const p = probe.player();
          closest = Math.min(closest, dist(p, watch));
          far = Math.max(far, Math.abs(p.z));
        }
        releaseAll();
        return { closest, far, at: probe.player() };
      };
      for (const side of [1, -1]) {
        const name = side > 0 ? 'north' : 'south';
        await arrive({ x: 4.5, z: 0 }, `aisle by the ${name} bench`);
        const got = await push({ x: 4.5, z: side * 1.4 }, 2500);
        const stopped = got.far < 1.0;
        t.event('blocked-seat', `walked into the ${name} bench for 2.5 s: stopped at z ${got.at.z.toFixed(2)} (bench front at ${(side * 1.04).toFixed(2)})${stopped ? '' : ' (INSIDE the bench)'}`);
        if (!stopped) t.problem('bug', `Pierce walked into the ${name} bench: z ${got.far.toFixed(2)}`);
      }
      const pole = { x: 6.8, z: 0 };
      await arrive({ x: 5.4, z: 0 }, 'aisle behind the center pole');
      // The walk target is past the pole; what matters is how close he ever came to the pole itself.
      const hit = await push({ x: 8.4, z: 0 }, 2500, pole);
      const near = hit.closest;
      const poleOk = near >= 0.3;
      t.event('blocked-pole', `walked straight at the center pole by the second door for 2.5 s: never closer than ${near.toFixed(2)} m, ended at (${hit.at.x.toFixed(2)}, ${hit.at.z.toFixed(2)})`);
      if (!poleOk) t.problem('bug', `Pierce walked through the center pole at x ${pole.x}: ${near.toFixed(2)} m from it`);
      t.progress(0.7);

      // 2: the length of the car, back to front, around the poles.
      await arrive({ x: 17.0, z: 0 }, 'front of the car');
      const end = probe.player();
      const walked = end.x - start.x;
      t.event('walked', `the length of the car: from x ${start.x.toFixed(1)} to x ${end.x.toFixed(1)} (${walked.toFixed(1)} m)`);
      t.metric('carWalkMeters', Math.round(walked * 10) / 10);
      if (walked < 14) t.problem('bug', `Pierce did not reach the front of the car (${walked.toFixed(1)} m walked)`);
      await sleep(1500);
      return 'done';
    };

    // ---- level-7: The Train, the story. `arrived` means Continue from The Station already started it.
    const trainStoryRun = async (arrived = false): Promise<Outcome> => {
      if (!arrived) levelsTotal = 1;
      const t0 = performance.now();
      const story = () => probe.train()?.story ?? null;
      const enter = async (why: string) => {
        t.event('setup', `start level 7, The Train, directly (test shortcut, as ?beat=train)${why}`);
        await probe.setupHidden('the-train');
        await t.until(() => probe.running() && probe.level().libraryId === 'the-train' && !probe.menu().open, 90000, 'level 7 to start');
      };

      // 4: combat is off in the library row.
      try {
        const lib = await (await fetch(new URL('levels/level-library.json', location.href).href, { cache: 'no-store' })).json() as { levels?: { id: string; combat?: boolean }[] };
        const row = (lib.levels ?? []).find((r) => r.id === 'the-train');
        t.event('check', `level library: the-train combat ${row?.combat}`);
        if (row?.combat !== false) t.problem('bug', `level 7 has combat on in levels/level-library.json (${row?.combat})`);
      } catch {
        t.event('check', 'level library not readable from this page; combat checked from the scene instead');
      }

      // 1: the opening, played through. Continue from The Station has already started it.
      if (!arrived) await enter('');
      t.scene('Level 7: The Train');
      t.event('level-start', arrived ? 'Level 7: The Train (from The Station Continue)' : 'Level 7: The Train');
      const want = ['dialogue.train.there', 'dialogue.train.pole', 'dialogue.train.turn', 'dialogue.train.next'];
      const lines = storyLines();
      const textOf = (id: string) => lines.find((row) => row.id === id)?.text ?? id;
      for (const row of lines.filter((r) => /^(dialogue|bark)\.train\.|^phone\.(hale-train|stop\.hale)\./.test(r.id))) {
        if (!row.audio.trim()) t.problem('bug', `train line ${row.id} has no clip`);
      }
      const heard: string[] = [];
      let sawBody = false;
      let bodyLeft = false;
      const opening0 = performance.now();
      await t.until(() => probe.scripted() === 'train-opening', 10000, 'the opening scene');
      if (!probe.skipButton || probe.skipButton.hidden) t.problem('bug', 'no Skip button during the train opening');
      while (probe.scripted() === 'train-opening') {
        if (performance.now() - opening0 > 60000) throw new Error('the train opening ran past 60 s');
        const sub = probe.subtitle().text.trim();
        if (sub && heard[heard.length - 1] !== sub) heard.push(sub);
        const s = story();
        if (s?.oldBody) sawBody = true;
        if (sawBody && s && !s.oldBody) bodyLeft = true;
        await tick();
      }
      const openingSecs = (performance.now() - opening0) / 1000;
      t.metric('trainOpeningSeconds', Math.round(openingSecs * 10) / 10);
      const order = want.map((id) => heard.indexOf(textOf(id)));
      const inOrder = order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]));
      t.event('check', `opening: ${heard.length} subtitles in ${openingSecs.toFixed(1)} s; the four lines ${inOrder ? 'in order' : `OUT OF ORDER or missing (${order.join(', ')})`}`);
      if (!inOrder) t.problem('bug', `the train opening lines did not play in order: ${heard.join(' | ')}`);
      t.event('check', `opening: the old body ${sawBody ? 'stood at the front of the car' : 'was NOT seen'}${bodyLeft ? ' and walked out through the front end door' : ''}`);
      if (!sawBody || !bodyLeft) t.problem('bug', 'the old body was not seen leaving car 1 in the opening');
      t.progress(arrived ? 0.5 : 0.2);

      // Skip, on the direct start only. Continue already spent the opening.
      if (!arrived) {
        await enter(' again, to press Skip in the opening');
        await t.until(() => probe.scripted() === 'train-opening', 10000, 'the opening scene again');
        await sleep(3000);
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        const skip0 = performance.now();
        try {
          await t.until(() => controllable() && probe.objective().visible, 2000, 'control after Skip');
          t.event('check', `Skip: control and the objective back in ${((performance.now() - skip0) / 1000).toFixed(1)} s (${probe.objective().text})`);
        } catch {
          t.problem('bug', 'Skip in the train opening did not hand control back within 2 s');
        }
      }
      await measureLook();
      t.progress(arrived ? 0.55 : 0.3);

      // 2-4: play to the end with real input.
      let endPressed = false;
      let endBeat = '';
      let shadowDone = false;
      let lastCar = story()?.car ?? 1;
      let stopSeen = false;
      let facedAway = true;
      let stepped = false;
      const lastAction = { label: '' };
      for (;;) {
        await tick();
        if (performance.now() - t0 > 230000) return 'stuck';
        const menu = probe.menu();
        if (menu.open) {
          if (endPressed) break;
          continue;
        }
        const s = story();
        if (s && s.car !== lastCar) {
          lastCar = s.car;
          t.event('car', `car ${s.car}: the old body ${s.oldBody ? `is ahead at x ${s.oldBody.x.toFixed(1)}` : 'is not in sight'}; ${s.riders} riders`);
          mark();
        }
        if (s && s.beat === 'cars' && s.car === 2 && s.oldBody && (s.leftCar ?? 0) < 2) {
          // He keeps one car ahead: never close enough to touch.
          const p = probe.player();
          if (Math.abs(p.x - s.oldBody.x) < 0.6 && Math.abs(p.z - s.oldBody.z) < 0.6) t.problem('bug', 'Pierce caught up with the old body in car 2');
        }
        if (probe.cutscene() || probe.scripted()) {
          releaseAll();
          if (s?.beat === 'stop') {
            if (!stopSeen) {
              stopSeen = true;
              const car = probe.train();
              t.event('stop', `the stop scene: train at ${car?.speed ?? 0} m/s, platform ${car?.platform ?? 0}`);
            }
            if (s.oldBody && s.oldBody.z > 1.0) stepped = true;
            // Pierce is behind him (south-west); facing back would point south (|yaw| > 90°).
            if (s.oldBody && s.oldBodyFacing !== null && Math.abs(((s.oldBodyFacing + 540) % 360) - 180) > 90) facedAway = false;
            const car = probe.train();
            if (car && car.door > 0.9 && !seenRaw.has('door-open')) { seenRaw.add('door-open'); t.event('stop', `the north door is open (train ${car.speed} m/s, platform ${car.platform})`); }
          }
          continue;
        }
        if (!probe.running()) continue;
        const phone = probe.phone();
        if (phone.incoming) { releaseAll(); await once('f', 1500, 'answer call'); t.event('call', phone.speaker || 'incoming'); continue; }
        if (phone.busy) { releaseAll(); continue; }
        // 4: Shadow mode as at the station, once, in car 2.
        if (!shadowDone && s?.car === 2 && s.beat === 'cars') {
          shadowDone = true;
          releaseAll();
          const before = probe.shadow();
          t.event('shadow', `controls ${before.controls}, ability ${before.ability}`);
          await tap('c', 'Shadow mode');
          await sleep(500);
          const on = probe.shadow();
          await tap('Tab', 'switch ability');
          await sleep(400);
          const switched = probe.shadow().ability;
          setHeld('w');
          sendKey('keydown', 'Shift');
          await sleep(900);
          sendKey('keyup', 'Shift');
          releaseAll();
          await tap('c', 'Shadow mode off');
          await sleep(500);
          const off = probe.shadow();
          t.event('shadow', `C: on ${on.on} (ability ${on.ability}), Tab: ${switched}, C again: on ${off.on}`);
          if (!before.controls || !on.on || off.on || switched === on.ability) t.problem('bug', `Shadow mode on the train does not work as at the station: controls ${before.controls}, on ${on.on}, Tab ${on.ability} -> ${switched}, off ${!off.on}`);
          const hostile = probe.people().filter((x) => x.kind === 'hostile' || x.kind === 'enemy').length;
          if (hostile) t.problem('bug', `combat is on in level 7: ${hostile} hostiles`);
          continue;
        }
        const label = probe.action();
        if (label) {
          releaseAll();
          if (await once('e', 1200, label)) {
            if (label !== lastAction.label) t.event('action', label);
            lastAction.label = label;
            levelSteps += 1;
            mark();
            if (label === 'End Level') {
              if (!endBeat) {
                endBeat = story()?.beat ?? '';
                t.event('end-level', `offered on beat ${endBeat || 'unknown'}`);
                if (endBeat !== 'done') t.problem('bug', `End Level showed before the story finished (beat ${endBeat || 'none'})`);
              }
              endPressed = true;
            }
          }
          continue;
        }
        if (probe.shadow().linked && (await once('Tab', 1200, 'release link'))) continue;
        const obj = probe.objective();
        if (!obj.target) { releaseAll(); continue; }
        const there = await walkTo(obj.target, `${obj.title || 'objective'}: ${obj.text.slice(0, 40)}`, 0.3);
        if (there) {
          const p = probe.player();
          if (dist(p, obj.target) > 0.12) steer(obj.target, false);
          else releaseAll();
        }
      }
      releaseAll();
      const s = story();
      t.event('check', `the old body got off: ${stepped ? 'stepped out through the north door' : 'NOT seen stepping out'}, ${facedAway ? 'never turned toward Pierce' : 'TURNED toward Pierce'}; Hale called: ${s?.hale}`);
      if (!stopSeen) t.problem('bug', 'the stop scene did not play');
      if (!stepped) t.problem('bug', 'the old body did not get off at the stop');
      if (!facedAway) t.problem('bug', 'the old body looked back as he got off');
      t.metric('trainCars', lastCar);
      const secs = (performance.now() - t0) / 1000;
      t.metric('trainSeconds', Math.round(secs));
      t.event('level-end', `Level 7: The Train in ${secs.toFixed(0)} s`);
      if (!endPressed) {
        t.problem('bug', 'level 7 ended without End Level');
        return 'stuck';
      }
      await sleep(700);
      const menu = probe.menu();
      const exitBtn = document.getElementById('loadModelBtn');
      const credits = document.getElementById('levelCredits');
      const crawl = (credits?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const song = probe.ending() ?? '';
      const showing = !!credits && !credits.hidden && crawl.length > 40;
      const own = /Preferred A Man/.test(crawl) && /Went Uptown/.test(crawl) && !/Open On Nothing/.test(crawl);
      const exitOnly = menu.title === 'Level Complete' && menu.start == null && /exit/i.test(exitBtn?.textContent ?? '');
      t.scene('Level 7 complete');
      t.event('ending', `song ${/ending-6\.mp3/.test(song) ? 'ending-6' : (song || 'none')}; credits ${showing && own ? 'level 7' : 'wrong'}; continue ${menu.start ?? 'hidden'}; button ${(exitBtn?.textContent ?? '').trim()}`);
      if (!/ending-6\.mp3/.test(song)) t.problem('bug', `level 7 did not play The Station's end song (got ${song || 'nothing'})`);
      if (!showing || !own) t.problem('bug', `level 7 credits did not roll ("${crawl.slice(0, 160)}")`);
      if (!exitOnly) t.problem('bug', `level 7's card should be Exit only (continue ${menu.start ?? 'hidden'}, title ${menu.title}, other ${(exitBtn?.textContent ?? '').trim()})`);
      await sleep(3500);
      return 'won';
    };

    /** The Station's card, Continue into level 7, then the train through to Exit only. */
    const releaseRun = async (): Promise<Outcome> => {
      levelsTotal = 2;
      levelIndex = 0;
      await enterLevel(6);
      const openUntil = performance.now() + 20000;
      while (!probe.scripted() && !(probe.running() && !probe.menu().open && !probe.cutscene()) && performance.now() < openUntil) await tick();
      if (probe.scripted()) {
        await sleep(1200);
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        await t.until(() => probe.running() && !probe.scripted() && !probe.menu().open, 15000, 'control after Skip on The Station');
      }
      const station = await playLevel(6);
      if (station !== 'won') return station;
      const card = probe.menu();
      t.event('station-card', `The Station complete: continue ${card.start ?? 'none'}`);
      if (card.title !== 'Level Complete' || card.start !== 'Continue') {
        t.problem('bug', `The Station's card did not offer Continue (title ${card.title}, start ${card.start ?? 'none'})`);
        return 'error';
      }
      const detail = probe.levelRows().length
        ? [...document.querySelectorAll('#levelList .level-item')].map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
        : [];
      t.event('load-level', detail.join(' | '));
      const row = detail.find((line) => /level 7/i.test(line) && /train/i.test(line));
      if (!row) t.problem('bug', `Load Level does not list level 7, The Train: ${detail.join(' | ')}`);
      else if (!/play/i.test(row)) t.problem('bug', `Load Level lists level 7 locked after The Station: ${row}`);
      press(probe.startButton, 'Continue');
      await t.until(() => probe.running() && probe.level().libraryId === 'the-train' && !probe.menu().open, 90000, 'Continue from The Station into level 7');
      t.event('continue', `The Station's Continue entered ${probe.level().name} (${probe.level().libraryId})`);
      if (probe.level().id !== 7) t.problem('bug', `Continue entered level ${probe.level().id}, not level 7`);
      levelIndex = 1;
      return trainStoryRun(true);
    };

    // ---- scenarios
    if (id === 'analytics' && !window.hawkesAnalytics.config().debug) {
      // The SDK reads its debug switch when the page loads: reload once with it, and carry the run on through the URL.
      const url = new URL(location.href);
      url.searchParams.set('hawkes-analytics-debug', '1');
      url.searchParams.set('playtest', 'analytics');
      url.searchParams.set('seed', String(options.seed ?? 1));
      url.searchParams.set('speed', String(options.speed ?? 1));
      t.event('reload', 'the page reloads with ?hawkes-analytics-debug=1; the run carries on after it');
      location.assign(url.toString());
      await new Promise(() => {}); // the page is going away
      return;
    }
    await t.until(() => probe.ready(), 90000, 'game ready');
    if (id === 'sound-settings') {
      await soundSettingsRun(t, tapAt, tapToPlay, sleep, enterLevel, options);
      return;
    }
    if (id === 'load-error') {
      await loadErrorRun(t, tapAt, tapToPlay, sleep, options);
      return;
    }
    if (probe.sound().prompt) await tapToPlay();
    t.scene('Title');
    t.event('title', probe.menu().title);
    await sleep(600);

    if (id === 'smoke') {
      levelsTotal = 1;
      await enterLevel(1);
      t.scene(LEVELS[0].name);
      t.event('level-start', LEVELS[0].name);
      await measureLook();
      const until = performance.now() + 54000;
      let menusChecked = false;
      let sceneSeen = 0;
      while (performance.now() < until) {
        await tick();
        if (probe.cutscene()) {
          if (!sceneSeen) sceneSeen = performance.now();
          if (performance.now() - sceneSeen > 5000) {
            if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
            await sleep(800);
            observe();
            break;
          }
          continue;
        }
        if (!probe.running() || probe.menu().open) continue;
        if (!lookSens) await measureLook();
        const phone = probe.phone();
        if (phone.incoming) { releaseAll(); await once('f', 1500, 'answer call'); t.event('call', phone.speaker || 'incoming'); continue; }
        if (phone.busy) { releaseAll(); continue; }
        if (!menusChecked) {
          menusChecked = true;
          releaseAll();
          await tap('o', 'Missions');
          await sleep(500);
          await tap('o', 'Missions');
          await tap('i', 'Inventory');
          await sleep(600);
          // hold it open so the footage shows the panel, and check it is clear of the HUD around it
          t.event('inventory open');
          const rect = (sel: string) => {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && +cs.opacity > 0.05 ? r : null;
          };
          const panel = rect('#inventoryPanel');
          if (!panel) t.problem('bug', 'Inventory did not open: the panel is not visible after pressing I');
          else {
            const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
            for (const [name, sel] of [['objective card', '#objectiveHud'], ['health bar', '#healthBar']] as const) {
              const other = rect(sel);
              if (other && hit(panel, other)) t.problem('bug', `the open Inventory panel overlaps the ${name} (panel ${Math.round(panel.left)},${Math.round(panel.top)}-${Math.round(panel.right)},${Math.round(panel.bottom)}; ${name} ${Math.round(other.left)},${Math.round(other.top)}-${Math.round(other.right)},${Math.round(other.bottom)})`);
            }
          }
          await sleep(2500);
          await tap('i', 'Inventory');
          t.event('inventory closed');
          await sleep(300);
          continue;
        }
        const label = probe.action();
        if (label) { releaseAll(); if (await once('e', 1500, label)) t.event('action', label); continue; }
        const goal = probe.objective().target;
        if (goal) await walkTo(goal, 'seat');
      }
      releaseAll();
      if (!sceneSeen) t.problem('bug', 'smoke: the board scene did not start within 54 s of Start');
      t.progress(1);
      t.finish(sceneSeen ? 'done' : 'stuck');
      return;
    }

    if (id === 'full') {
      levelsTotal = 6;
      await enterLevel(1);
      for (let n = 1; n <= 6; n++) {
        levelIndex = n - 1;
        const outcome = await playLevel(n);
        if (outcome !== 'won') { t.finish(outcome); return; }
        if (n < 6) {
          await sleep(2500);
          const menu = probe.menu();
          if (!menu.start) throw new Error(`no Continue on the level ${n} card`);
          press(probe.startButton, menu.start);
          const until = performance.now() + 90000;
          while (!(probe.running() && probe.level().id === n + 1)) {
            if (performance.now() > until) throw new Error(`timed out waiting for level ${n + 1} after Continue`);
            await tick();
          }
        }
      }
      t.progress(1);
      t.finish('won');
      return;
    }

    if (id === 'site-links') {
      t.progress(0.15);
      await siteLinksCheck();
      t.progress(1);
      t.finish('done');
      return;
    }

    if (id === 'b3-retry') {
      await b3RetryRun();
      return;
    }

    if (id === 'analytics') {
      levelsTotal = 1;
      const ha = window.hawkesAnalytics;
      const cfg = ha.config();
      const build = cfg.build ?? {};
      t.event('analytics', `product ${cfg.product}, env ${cfg.env}, build ${build.version ?? '?'} ${build.commit ?? '?'} ${build.date ?? ''}, debug ${cfg.debug}`);
      if (!build.version || !build.commit) t.problem('bug', `analytics: the build is incomplete (${JSON.stringify(build)}); window.HAWKES_BUILD should come from the real build`);
      const counts: Record<string, number> = {};
      let logged = 0;
      const brief = (props: Record<string, unknown> | undefined) => Object.entries(props ?? {})
        .filter(([, v]) => v != null && typeof v !== 'object')
        .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
        .join(' ');
      const drain = () => {
        const log = ha.debugLog;
        for (; logged < log.length; logged++) {
          const e = log[logged];
          counts[e.name] = (counts[e.name] ?? 0) + 1;
          if (e.name === 'perf' || e.name === 'exit') continue;
          t.event(`analytics:${e.name}`, `${brief(e.props)}${e.ctx?.level ? ` [level ${e.ctx.level}]` : ''}`);
        }
        const sent = log.filter((e) => e.sent).length;
        t.metric('analyticsEvents', log.length);
        t.metric('analyticsSent', sent);
      };
      const timer = window.setInterval(drain, 1000);
      let outcome: Outcome;
      try {
        await enterLevel(1);
        t.scene(LEVELS[0].name);
        outcome = await playLevel(1);
        await t.until(() => !!document.querySelector('[data-hawkes-ask]'), 10000, 'the feedback card').catch(() => undefined);
        const card = document.querySelector('[data-hawkes-ask]');
        const question = card?.shadowRoot?.querySelector('.ha-q')?.textContent ?? '';
        if (card) {
          t.scene('Level Complete + feedback card');
          t.event('feedback-card', question || card.getAttribute('data-hawkes-ask') || 'shown');
        } else {
          t.problem('bug', 'analytics: no feedback card after the level 1 Level Complete card');
        }
        await sleep(4000); // hold it for the footage
        ha.flush();
        await sleep(600);
      } finally {
        window.clearInterval(timer);
        drain();
      }
      for (const name of ['game_ready', 'level_start', 'progress', 'video', 'level_end']) {
        if (!counts[name]) t.problem('bug', `analytics: no ${name} event in level 1`);
      }
      t.metric('analyticsProgress', counts.progress ?? 0);
      t.metric('analyticsVideo', counts.video ?? 0);
      t.progress(1);
      t.finish(outcome);
      return;
    }

    if (id === 'level-7') {
      const outcome = await trainStoryRun();
      t.progress(1);
      t.finish(outcome);
      return;
    }

    if (id === 'level-7-release') {
      const outcome = await releaseRun();
      t.progress(1);
      t.finish(outcome);
      return;
    }

    if (id === 'train') {
      const outcome = await trainRun();
      t.progress(1);
      t.finish(outcome);
      return;
    }

    if (id === 'phone-b3') {
      // Progress: phone checks, About, then B3 as the second half.
      levelsTotal = 2;
      await phoneChecks();
      t.progress(0.3);
      await aboutCheck();
      t.progress(0.45);
      const outcome = await earlyDownB3();
      t.progress(1);
      t.finish(outcome);
      return;
    }

    const m = /^level-(\d)$/.exec(id);
    if (m) {
      const n = Number(m[1]);
      levelsTotal = 1;
      await enterLevel(n);
      const outcome = await playLevel(n);
      t.progress(1);
      t.finish(outcome);
    }
  };

  // ------------------------------------------------------------ sound-settings

  const soundSettingsRun = async (
    t: Tracker,
    tapAt: (el: HTMLElement | null, label: string) => Promise<void>,
    tapToPlay: () => Promise<void>,
    sleep: (ms: number) => Promise<void>,
    enterLevel: (n: number) => Promise<void>,
    options: RunOptions,
  ) => {
    const byId = (id: string) => document.getElementById(id);
    const saved = () => {
      try { return JSON.parse(localStorage.getItem(SOUND_KEY) ?? 'null') as { on: boolean; music: number; sfx: number } | null; } catch { return null; }
    };
    const carried = (() => {
      try { return JSON.parse(sessionStorage.getItem(SOUND_RUN_KEY) ?? 'null') as { original: string | null; events: { type: string; detail?: string }[] } | null; } catch { return null; }
    })();
    const checkPrompt = (where: string) => {
      const prompt = byId('tapToPlay');
      if (!probe.sound().prompt || !prompt) { t.problem('bug', `no Tap to play prompt ${where}`); return; }
      const r = prompt.getBoundingClientRect();
      if (r.width < innerWidth - 1 || r.height < innerHeight - 1) t.problem('bug', `the Tap to play prompt does not fill the screen ${where} (${Math.round(r.width)}x${Math.round(r.height)} of ${innerWidth}x${innerHeight})`);
      t.event('prompt-shown', `${where}, ${innerWidth}x${innerHeight} ${innerWidth > innerHeight ? 'landscape' : 'portrait'}`);
    };
    const checkRunning = async (where: string) => {
      try {
        await t.until(() => probe.sound().context === 'running', 5000, 'the AudioContext to run');
        t.event('audio-running', `AudioContext ${probe.sound().context} ${where}`);
      } catch {
        t.problem('bug', `the AudioContext is "${probe.sound().context}" after the tap ${where}`);
      }
    };
    const slide = (input: HTMLInputElement, percent: number, label: string) => {
      // A range input has no drag a page can fake; set it as a drag ends and send the same events.
      input.value = String(percent);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      t.add('interactions');
      t.log(`slide ${label} to ${percent}%`);
    };

    if (!carried) {
      t.scene('Tap to play');
      checkPrompt('on load');
      await sleep(1200);
      await tapToPlay();
      await checkRunning('after the first tap');
      t.progress(0.15);

      t.scene('Title');
      await sleep(500);
      await tapAt(byId('settingsBtn'), 'Settings (title)');
      await t.until(() => probe.sound().settingsOpen, 3000, 'Settings to open from the title');
      t.scene('Settings');
      t.event('settings-open', 'from the title');
      const original = localStorage.getItem(SOUND_KEY);
      if (!probe.sound().settings.on) await tapAt(byId('soundSwitch'), 'Sound on');
      await sleep(400);
      await tapAt(byId('soundSwitch'), 'Sound off');
      slide(byId('musicVolume') as HTMLInputElement, 40, 'Music');
      await sleep(800);
      const now = saved();
      if (!now || now.on !== false || Math.abs(now.music - 0.4) > 0.001) t.problem('bug', `hawkes.sound did not save Sound off and Music 40%: ${JSON.stringify(now)}`);
      else t.event('setting-saved', JSON.stringify(now));
      if (probe.sound().settings.on !== false) t.problem('bug', 'Sound off did not apply right away');
      t.progress(0.35);
      await tapAt(byId('settingsDoneBtn'), 'Done');
      await sleep(400);

      sessionStorage.setItem(SOUND_RUN_KEY, JSON.stringify({ original, events: [{ type: 'setting-saved', detail: JSON.stringify(now) }] }));
      t.event('reload', 'the page reloads; the run carries on after it');
      const url = new URL(location.href);
      url.searchParams.set('playtest', 'sound-settings');
      url.searchParams.set('seed', String(options.seed ?? 1));
      url.searchParams.set('speed', String(options.speed ?? 1));
      await sleep(300);
      location.replace(url.toString());
      await new Promise(() => {}); // the page is going away
      return;
    }

    sessionStorage.removeItem(SOUND_RUN_KEY);
    for (const e of carried.events) t.event(`before-reload:${e.type}`, e.detail);
    t.scene('Tap to play (after reload)');
    checkPrompt('after the reload');
    await sleep(1000);
    await tapToPlay();
    await checkRunning('after the reload');
    t.progress(0.5);

    const back = probe.sound().settings;
    if (back.on !== false || Math.abs(back.music - 0.4) > 0.001) t.problem('bug', `the setting did not survive the reload: ${JSON.stringify(back)}`);
    else t.event('setting-survived-reload', JSON.stringify(back));
    t.scene('Title');
    await tapAt(byId('settingsBtn'), 'Settings (title)');
    await t.until(() => probe.sound().settingsOpen, 3000, 'Settings to open after the reload');
    t.scene('Settings (after reload)');
    const shows = `${byId('soundSwitch')?.textContent} / Music ${(byId('musicVolume') as HTMLInputElement).value}%`;
    if (shows !== 'Off / Music 40%') t.problem('bug', `Settings shows "${shows}" after the reload, not Off / Music 40%`);
    else t.event('settings-shows-saved', shows);
    await sleep(1500);
    await tapAt(byId('soundSwitch'), 'Sound on');
    slide(byId('musicVolume') as HTMLInputElement, 100, 'Music');
    if (saved()?.on !== true) t.problem('bug', 'Sound on did not save');
    await tapAt(byId('settingsDoneBtn'), 'Done');
    t.progress(0.65);

    await enterLevel(1);
    t.scene(LEVELS[0].name);
    await sleep(3000);
    await t.until(() => !(byId('pauseBtn') as HTMLButtonElement).hidden, 20000, 'the Pause button');
    await tapAt(byId('pauseBtn'), 'Pause');
    await t.until(() => probe.sound().paused, 3000, 'Pause');
    t.scene('Paused');
    t.event('paused');
    await sleep(800);
    await tapAt(byId('pauseSettingsBtn'), 'Settings (pause)');
    await t.until(() => probe.sound().settingsOpen, 3000, 'Settings to open from Pause');
    t.scene('Settings (pause)');
    t.event('settings-open', 'from pause');
    slide(byId('sfxVolume') as HTMLInputElement, 70, 'Effects & voice');
    if (Math.abs((saved()?.sfx ?? 0) - 0.7) > 0.001) t.problem('bug', 'Effects & voice did not save from Pause');
    else t.event('setting-saved', JSON.stringify(saved()));
    await sleep(1200);
    await tapAt(byId('settingsDoneBtn'), 'Done');
    await tapAt(byId('resumeBtn'), 'Resume');
    await t.until(() => !probe.sound().paused, 3000, 'Resume');
    t.event('resumed');
    t.progress(0.95);
    await sleep(1500);

    if (carried.original === null) localStorage.removeItem(SOUND_KEY);
    else localStorage.setItem(SOUND_KEY, carried.original);
    t.progress(1);
    t.finish('done');
  };

  // ------------------------------------------------------------ load-error

  const loadErrorRun = async (
    t: Tracker,
    tapAt: (el: HTMLElement | null, label: string) => Promise<void>,
    tapToPlay: () => Promise<void>,
    sleep: (ms: number) => Promise<void>,
    options: RunOptions,
  ) => {
    const ERROR_TITLE = "Couldn't start the game";
    const carried = (() => {
      try { return JSON.parse(sessionStorage.getItem(LOAD_ERROR_RUN_KEY) ?? 'null') as { events: { type: string; detail?: string }[] } | null; } catch { return null; }
    })();
    const errorFlag = () => document.documentElement.getAttribute('data-load-error');
    /** The title card is at START (or Continue, with a save) and shows no error. */
    const checkStartCard = (where: string) => {
      const menu = probe.menu();
      const ok = menu.open && menu.title === 'PH Origins' && !!menu.start && /^(start|continue)$/i.test(menu.start) && menu.startEnabled && !errorFlag();
      if (!ok) t.problem('bug', `the title card is not at START ${where}: "${menu.title}" / "${menu.start}"${errorFlag() ? ` (load error: ${errorFlag()})` : ''}`);
      else t.event('start-card', `${where}: ${menu.start}, no error`);
      return ok;
    };
    const play = async () => {
      await tapAt(probe.startButton, probe.menu().start ?? 'Start');
      await t.until(() => probe.running() && !probe.menu().open, 60000, 'the level to start');
      t.scene(probe.level().name);
      t.event('level-start', probe.level().name);
      await sleep(2500);
    };

    if (!carried) {
      if (probe.sound().prompt) await tapToPlay();
      t.scene('Title (normal load)');
      await sleep(800);
      checkStartCard('on a normal load');
      t.progress(0.2);

      const kind = options.fail === 'error' ? 'error' : 'hang';
      probe.failNextLoad(kind);
      t.event('setup', `the next level load fails (${kind === 'hang' ? 'never finishes' : 'level file missing'}; test shortcut)`);
      const pressedAt = performance.now();
      await tapAt(probe.startButton, probe.menu().start ?? 'Start');
      t.scene('Loading (forced failure)');
      try {
        await t.until(() => probe.menu().title === ERROR_TITLE && probe.menu().start === 'Retry' && probe.menu().startEnabled, 30000, 'the error card');
      } catch {
        t.problem('bug', `no "${ERROR_TITLE}" card with Retry within 30 s of Start: "${probe.menu().title}" / "${probe.menu().start}"`);
        t.finish('stuck');
        return;
      }
      const seconds = (performance.now() - pressedAt) / 1000;
      t.metric('errorCardSeconds', Math.round(seconds * 10) / 10);
      t.scene('Error card');
      t.event('error-card', `${probe.menu().title}: ${probe.menu().text} (${seconds.toFixed(1)} s after Start)`);
      if (seconds > 28) t.problem('bug', `the error card took ${seconds.toFixed(1)} s to show (about 20 s expected)`);
      t.progress(0.5);
      await sleep(2500);

      sessionStorage.setItem(LOAD_ERROR_RUN_KEY, JSON.stringify({ events: [{ type: 'error-card', detail: `${seconds.toFixed(1)} s` }] }));
      // Retry reloads the page itself; keep the run in the URL so it carries on after the reload.
      const url = new URL(location.href);
      url.searchParams.set('playtest', 'load-error');
      url.searchParams.set('seed', String(options.seed ?? 1));
      url.searchParams.set('speed', String(options.speed ?? 1));
      history.replaceState(history.state, '', url.toString());
      t.event('retry', 'Retry pressed; the page reloads and the run carries on after it');
      await tapAt(probe.startButton, 'Retry');
      await new Promise(() => {}); // the page is going away
      return;
    }

    sessionStorage.removeItem(LOAD_ERROR_RUN_KEY);
    for (const e of carried.events) t.event(`before-reload:${e.type}`, e.detail);
    t.event('reloaded', 'the page reloaded after Retry');
    if (probe.sound().prompt) await tapToPlay();
    t.scene('Title (after Retry)');
    await sleep(800);
    const ok = checkStartCard('after Retry');
    t.progress(0.8);
    if (ok) await play();
    t.progress(1);
    t.finish(ok ? 'done' : 'stuck');
  };

  // ------------------------------------------------------------ problems the page can see

  const watchProblems = (t: Tracker) => {
    const missing = storyLines().filter(missingClip);
    if (missing.length) {
      t.problem('polish', `${missing.length} spoken line${missing.length === 1 ? ' has' : 's have'} no audio clip: ${missing.slice(0, 6).map((row) => row.id).join(', ')}${missing.length > 6 ? '…' : ''}`);
    }
    const seen = new Set<string>();
    const report = (url: string, status: number) => {
      const path = url.replace(location.origin, '');
      if (seen.has(path)) return;
      seen.add(path);
      const kind = /\.(glb|gltf)(\?|$)/i.test(path) ? 'model' : /\.(png|jpe?g|webp|ktx2?|env|dds)(\?|$)/i.test(path) ? 'texture' : /\.(wav|ogg|mp3|m4a)(\?|$)/i.test(path) ? 'audio' : 'file';
      t.problem('bug', `missing ${kind}: ${path}${status ? ` (${status})` : ''}`);
    };
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          const status = (entry as PerformanceResourceTiming & { responseStatus?: number }).responseStatus ?? 0;
          if (status >= 400) report(entry.name, status);
        }
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch { observer = null; }
    const original = console.error;
    console.error = (...args: unknown[]) => {
      try {
        const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
        const url = /(\/assets\/[^\s"'()]+)/.exec(text)?.[1];
        if (url && /unable to load|failed|error|404/i.test(text)) report(url, 0);
        else t.log(`console.error ${text.slice(0, 200)}`);
      } catch { /* never break the page */ }
      original.apply(console, args as []);
    };
    const onMediaError = (event: Event) => {
      const el = event.target as HTMLMediaElement | null;
      if (el && 'currentSrc' in el && el.currentSrc) report(el.currentSrc, 0);
    };
    window.addEventListener('error', onMediaError, true);
    return () => {
      observer?.disconnect();
      if (console.error !== original) console.error = original;
      window.removeEventListener('error', onMediaError, true);
    };
  };
};

// ---------------------------------------------------------------- save cookie

const SAVE_KEY = 'ph-origins-save';
const SOUND_KEY = 'hawkes.sound';
const SOUND_RUN_KEY = 'hawkes.playtest.sound-settings';
const LOAD_ERROR_RUN_KEY = 'hawkes.playtest.load-error';

const snapshotSave = () => {
  const cookie = document.cookie.split('; ').find((row) => row.startsWith(`${SAVE_KEY}=`)) ?? null;
  let stored: string | null = null;
  try { stored = localStorage.getItem(SAVE_KEY); } catch { stored = null; }
  return { cookie, stored };
};

const restoreSave = (saved: ReturnType<typeof snapshotSave>) => {
  if (saved.cookie) document.cookie = `${saved.cookie}; path=/; max-age=${60 * 60 * 24 * 400}; SameSite=Lax`;
  else document.cookie = `${SAVE_KEY}=; path=/; max-age=0`;
  try {
    if (saved.stored === null) localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, saved.stored);
  } catch { /* storage blocked */ }
};
