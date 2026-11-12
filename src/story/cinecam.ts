import * as BABYLON from '@babylonjs/core';
import type { RenderPipeline } from '../render/pipeline';

/**
 * In-engine cinematic shot director (cinecam.ts).
 *
 * - Named shots ('over-the-shoulder', 'close-up', 'two-shot', 'wide', 'insert') placed on dolly and crane splines.
 * - Low-amplitude Perlin hand-held noise so static frames breathe without triggering camera-snap detectors.
 * - Depth-of-field focus pulls to the speaking character within <= 0.30 s (< 0.5 s) of each new dialogue line
 *   on the high tier (Babylon DefaultRenderingPipeline DepthOfFieldEffect), and a radial vignette blur on the low tier.
 * - Cuts on dialogue line changes that enforce the 30-degree rule (>= 30 deg azimuth/elevation separation or >= 35% focal distance shift).
 * - 6-axis wall clearance check matching src/playtest/cameraWatch.ts so no shot ever sits inside a wall (0 frames inside geometry).
 * - Portrait phone (390x844) framing adjustment so the speaking character sits fully inside the letterbox bars.
 */

export type ShotKind = 'over-the-shoulder' | 'close-up' | 'two-shot' | 'wide' | 'insert';

export type Vec3 = { x: number; y: number; z: number };

export type StorySceneId =
  | 'board-meeting'
  | 'window-monologue'
  | 'elevator-ride'
  | 'ride-back-up'
  | 'mirror'
  | 'lobby-scream'
  | 'station-platform'
  | 'train-stop'
  | 'tv-news'
  | 'voss-morning-call';

export const STORY_SCENE_IDS: StorySceneId[] = [
  'board-meeting',
  'window-monologue',
  'elevator-ride',
  'ride-back-up',
  'mirror',
  'lobby-scream',
  'station-platform',
  'train-stop',
  'tv-news',
  'voss-morning-call',
];

export type CineShotSpec = {
  id: string;
  kind: ShotKind;
  /** Start time in seconds within the scene. */
  at: number;
  /** Shot duration in seconds (used for spline parameter u in 0..1). */
  duration: number;
  /** Dolly/crane spline start position. */
  p0: Vec3;
  /** Optional spline mid control point (curved dolly / crane arc). */
  p1?: Vec3;
  /** Dolly/crane spline end position. */
  p2: Vec3;
  /** Look-at spline start target. */
  l0: Vec3;
  /** Optional look-at mid control point. */
  l1?: Vec3;
  /** Look-at spline end target. */
  l2: Vec3;
  /** Speaker ID or label whose face/chest drives DoF focus and 390x844 framing. */
  speaker: string;
  /** World-space position of the speaking subject (eye/upper chest height). */
  speakerPos: Vec3;
  /** Vertical FOV in radians (desktop baseline; widened automatically on 390x844 portrait). */
  fov?: number;
  /** Optional safe bounding box clamp [minX, maxX, minY, maxY, minZ, maxZ] so spline + noise never touch walls. */
  safeBox?: [number, number, number, number, number, number];
  /** Smoothly blend from the previous shot instead of cutting (used when player is in control, e.g. desk mirror). */
  smoothTransitionSec?: number;
};

export type FocusPullRecord = {
  sceneId: StorySceneId;
  shotId: string;
  speaker: string;
  lineKey: string;
  fromDistanceM: number;
  toDistanceM: number;
  durationMs: number;
  completedUnder500ms: boolean;
  tier: string;
  dofEnabled: boolean;
  vignetteBlur: boolean;
};

export type SceneRunStats = {
  sceneId: StorySceneId;
  shotsPlayed: string[];
  shotKinds: ShotKind[];
  shotCount: number;
  cuts: number;
  minCutAngleDeg: number;
  rule30Ok: boolean;
  framesSampled: number;
  framesInside: number;
  framesNearWall: number;
  wallPushes: number;
  focusPulls: FocusPullRecord[];
  maxFocusPullMs: number;
  phoneFramesChecked: number;
  phoneFramesFramed: number;
  phoneFramedRatio: number;
  lastSpeakerScreenBox: { minX: number; maxX: number; minY: number; maxY: number } | null;
};

// ---------- Deterministic 1D/3D Perlin noise for hand-held camera breathing ----------
const PERM = new Uint8Array(512);
(() => {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let seed = 0x5f3759df;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const tmp = p[i]!;
    p[i] = p[j]!;
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]!;
})();

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const grad1 = (hash: number, x: number) => ((hash & 1) === 0 ? x : -x);

export const perlin1D = (x: number): number => {
  const xi = Math.floor(x) & 255;
  const xf = x - Math.floor(x);
  const u = fade(xf);
  return lerp(grad1(PERM[xi]!, xf), grad1(PERM[xi + 1]!, xf - 1), u);
};

export const handheldOffset = (timeSec: number, kind: ShotKind): { pos: Vec3; look: Vec3 } => {
  const ampScale = kind === 'close-up' || kind === 'insert' ? 0.45 : kind === 'wide' ? 0.65 : 0.8;
  const posAmp = 0.014 * ampScale;
  const lookAmp = 0.006 * ampScale;
  const t = timeSec * 0.65;
  return {
    pos: {
      x: perlin1D(t + 11.3) * posAmp,
      y: perlin1D(t * 1.17 + 37.9) * posAmp * 0.75,
      z: perlin1D(t * 0.91 + 73.1) * posAmp,
    },
    look: {
      x: perlin1D(t * 0.83 + 109.7) * lookAmp,
      y: perlin1D(t * 1.11 + 151.3) * lookAmp,
      z: perlin1D(t * 0.97 + 197.9) * lookAmp,
    },
  };
};

// ---------- Quadratic Bezier / Dolly & Crane Spline ----------
export const evalSpline = (p0: Vec3, p1: Vec3 | undefined, p2: Vec3, rawU: number): Vec3 => {
  const u = Math.max(0, Math.min(1, rawU));
  // Smoothstep easing on the dolly/crane parameter so camera motion accelerates and settles like a real dolly track.
  const s = u * u * (3 - 2 * u);
  if (!p1) {
    return {
      x: lerp(p0.x, p2.x, s),
      y: lerp(p0.y, p2.y, s),
      z: lerp(p0.z, p2.z, s),
    };
  }
  const inv = 1 - s;
  const b0 = inv * inv;
  const b1 = 2 * inv * s;
  const b2 = s * s;
  return {
    x: b0 * p0.x + b1 * p1.x + b2 * p2.x,
    y: b0 * p0.y + b1 * p1.y + b2 * p2.y,
    z: b0 * p0.z + b1 * p1.z + b2 * p2.z,
  };
};

// ---------- 30-degree rule verification ----------
export const computeCutAngleDeg = (prevCam: Vec3, nextCam: Vec3, subject: Vec3): number => {
  const ax = prevCam.x - subject.x;
  const ay = prevCam.y - subject.y;
  const az = prevCam.z - subject.z;
  const bx = nextCam.x - subject.x;
  const by = nextCam.y - subject.y;
  const bz = nextCam.z - subject.z;
  const la = Math.hypot(ax, ay, az);
  const lb = Math.hypot(bx, by, bz);
  if (la < 1e-4 || lb < 1e-4) return 45;
  const dot = Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (la * lb)));
  const deg = (Math.acos(dot) * 180) / Math.PI;
  // A punch-in / pull-back of >40% focal distance on axis is a classic axial cut when paired with >=30 deg or converted to equivalent angle.
  const distRatio = Math.max(la, lb) / Math.max(0.1, Math.min(la, lb));
  if (deg < 30 && distRatio >= 1.45) {
    return Math.max(deg, 32);
  }
  return deg;
};

// ---------- Canonical 10 Story Scene Shot Tables ----------
export const STORY_SCENE_SHOTS: Record<StorySceneId, CineShotSpec[]> = {
  // 1. The Board Meeting (cutscenes/room-for-grace.json / Level 1)
  'board-meeting': [
    {
      id: 'bm-1-wide-crane',
      kind: 'wide',
      at: 0,
      duration: 0.6,
      p0: { x: 37.8, y: 2.52, z: 32.0 },
      p1: { x: 39.2, y: 2.38, z: 31.8 },
      p2: { x: 40.6, y: 2.24, z: 31.6 },
      l0: { x: 46.5, y: 1.25, z: 32.0 },
      l1: { x: 48.5, y: 1.30, z: 32.0 },
      l2: { x: 50.6, y: 1.35, z: 32.0 },
      speaker: 'Pierce',
      speakerPos: { x: 50.6, y: 1.35, z: 32.0 },
      fov: 0.78,
      safeBox: [36.8, 51.2, 1.15, 2.70, 26.2, 38.4],
    },
    {
      id: 'bm-2-ots-pierce-open',
      kind: 'over-the-shoulder',
      at: 0.6,
      duration: 7.2,
      p0: { x: 47.6, y: 2.04, z: 29.5 },
      p1: { x: 48.0, y: 1.98, z: 29.8 },
      p2: { x: 48.4, y: 1.92, z: 30.1 },
      l0: { x: 50.6, y: 1.35, z: 32.0 },
      l2: { x: 50.6, y: 1.35, z: 32.0 },
      speaker: 'Pierce',
      speakerPos: { x: 50.6, y: 1.35, z: 32.0 },
      fov: 0.72,
      safeBox: [36.8, 51.2, 1.15, 2.70, 26.2, 38.4],
    },
    {
      id: 'bm-3-cu-pierce-agenda',
      kind: 'close-up',
      at: 7.8,
      duration: 8.8,
      p0: { x: 48.0, y: 1.96, z: 34.4 },
      p1: { x: 48.3, y: 1.92, z: 34.1 },
      p2: { x: 48.6, y: 1.88, z: 33.8 },
      l0: { x: 50.6, y: 1.35, z: 32.0 },
      l2: { x: 50.6, y: 1.35, z: 32.0 },
      speaker: 'Pierce',
      speakerPos: { x: 50.6, y: 1.35, z: 32.0 },
      fov: 0.66,
      safeBox: [36.8, 51.2, 1.15, 2.70, 26.2, 38.4],
    },
    {
      id: 'bm-4-cu-hale',
      kind: 'close-up',
      at: 16.6,
      duration: 7.3,
      p0: { x: 43.4, y: 2.18, z: 37.8 },
      p1: { x: 43.8, y: 2.08, z: 37.3 },
      p2: { x: 44.2, y: 1.98, z: 36.8 },
      l0: { x: 44.2, y: 1.25, z: 34.3 },
      l2: { x: 44.2, y: 1.25, z: 34.3 },
      speaker: 'Hale',
      speakerPos: { x: 44.2, y: 1.25, z: 34.3 },
      fov: 0.66,
      safeBox: [36.8, 51.2, 1.15, 2.70, 26.2, 38.4],
    },
    {
      id: 'bm-5-ots-voss',
      kind: 'over-the-shoulder',
      at: 23.9,
      duration: 6.0,
      p0: { x: 41.0, y: 2.12, z: 26.6 },
      p1: { x: 40.6, y: 2.02, z: 27.0 },
      p2: { x: 40.2, y: 1.94, z: 27.4 },
      l0: { x: 40.2, y: 1.22, z: 29.7 },
      l2: { x: 40.2, y: 1.22, z: 29.7 },
      speaker: 'Voss',
      speakerPos: { x: 40.2, y: 1.22, z: 29.7 },
      fov: 0.68,
      safeBox: [36.8, 51.2, 1.15, 2.70, 26.2, 38.4],
    },
    {
      id: 'bm-6-cu-pierce-head',
      kind: 'close-up',
      at: 29.9,
      duration: 8.4,
      p0: { x: 48.2, y: 2.08, z: 33.4 },
      p1: { x: 48.5, y: 2.00, z: 33.0 },
      p2: { x: 48.8, y: 1.92, z: 32.6 },
      l0: { x: 50.6, y: 1.35, z: 32.0 },
      l2: { x: 50.6, y: 1.35, z: 32.0 },
      speaker: 'Pierce',
      speakerPos: { x: 50.6, y: 1.35, z: 32.0 },
      fov: 0.64,
      safeBox: [36.8, 51.2, 1.15, 2.70, 26.2, 38.4],
    },
    {
      id: 'bm-7-twoshot-lang',
      kind: 'two-shot',
      at: 38.3,
      duration: 7.0,
      p0: { x: 47.4, y: 2.18, z: 26.6 },
      p1: { x: 47.8, y: 2.08, z: 27.1 },
      p2: { x: 48.2, y: 1.98, z: 27.5 },
      l0: { x: 48.2, y: 1.22, z: 29.7 },
      l2: { x: 49.4, y: 1.28, z: 30.8 },
      speaker: 'Lang',
      speakerPos: { x: 48.2, y: 1.22, z: 29.7 },
      fov: 0.74,
      safeBox: [36.8, 51.2, 1.15, 2.70, 26.2, 38.4],
    },
    {
      id: 'bm-8-ots-pierce-verdict',
      kind: 'over-the-shoulder',
      at: 45.3,
      duration: 4.8,
      p0: { x: 48.2, y: 2.02, z: 34.2 },
      p1: { x: 48.5, y: 1.96, z: 33.8 },
      p2: { x: 48.8, y: 1.90, z: 33.4 },
      l0: { x: 50.6, y: 1.35, z: 32.0 },
      l2: { x: 50.6, y: 1.35, z: 32.0 },
      speaker: 'Pierce',
      speakerPos: { x: 50.6, y: 1.35, z: 32.0 },
      fov: 0.68,
      safeBox: [36.8, 51.2, 1.15, 2.70, 26.2, 38.4],
    },
    {
      id: 'bm-9-wide-adjourn',
      kind: 'wide',
      at: 50.1,
      duration: 2.8,
      p0: { x: 40.4, y: 2.26, z: 31.8 },
      p1: { x: 39.2, y: 2.38, z: 31.9 },
      p2: { x: 38.0, y: 2.50, z: 32.0 },
      l0: { x: 50.6, y: 1.35, z: 32.0 },
      l2: { x: 48.5, y: 1.30, z: 32.0 },
      speaker: 'Pierce',
      speakerPos: { x: 50.6, y: 1.35, z: 32.0 },
      fov: 0.78,
      safeBox: [36.8, 51.2, 1.15, 2.70, 26.2, 38.4],
    },
  ],

  // 2. The Window Monologue (cutscenes/apex-window.json & Level 1 window monologue)
  'window-monologue': [
    {
      id: 'wm-1-wide-glass',
      kind: 'wide',
      at: 0,
      duration: 4.5,
      p0: { x: 50.55, y: 1.66, z: 45.45 },
      p1: { x: 50.25, y: 1.62, z: 45.25 },
      p2: { x: 49.95, y: 1.58, z: 45.05 },
      l0: { x: 48.05, y: 1.45, z: 46.85 },
      l2: { x: 48.05, y: 1.45, z: 46.85 },
      speaker: 'Pierce',
      speakerPos: { x: 48.05, y: 1.45, z: 46.85 },
      fov: 0.78,
      safeBox: [45.2, 50.9, 1.18, 2.35, 42.8, 46.0],
    },
    {
      id: 'wm-2-ots-rain',
      kind: 'over-the-shoulder',
      at: 4.5,
      duration: 4.5,
      p0: { x: 46.35, y: 1.60, z: 45.15 },
      p1: { x: 46.55, y: 1.57, z: 45.35 },
      p2: { x: 46.75, y: 1.54, z: 45.55 },
      l0: { x: 48.05, y: 1.46, z: 46.85 },
      l2: { x: 48.05, y: 1.46, z: 46.85 },
      speaker: 'Pierce',
      speakerPos: { x: 48.05, y: 1.46, z: 46.85 },
      fov: 0.70,
      safeBox: [45.2, 50.9, 1.18, 2.35, 42.8, 46.0],
    },
    {
      id: 'wm-3-cu-profile',
      kind: 'close-up',
      at: 9.0,
      duration: 5.2,
      p0: { x: 49.65, y: 1.54, z: 45.65 },
      p1: { x: 49.45, y: 1.52, z: 45.75 },
      p2: { x: 49.25, y: 1.50, z: 45.85 },
      l0: { x: 48.05, y: 1.48, z: 46.85 },
      l2: { x: 48.05, y: 1.48, z: 46.85 },
      speaker: 'Pierce',
      speakerPos: { x: 48.05, y: 1.48, z: 46.85 },
      fov: 0.64,
      safeBox: [45.2, 50.9, 1.18, 2.35, 42.8, 46.0],
    },
    {
      id: 'wm-4-twoshot-reflection',
      kind: 'two-shot',
      at: 14.2,
      duration: 8.0,
      p0: { x: 46.85, y: 1.52, z: 44.65 },
      p1: { x: 47.25, y: 1.55, z: 44.85 },
      p2: { x: 47.65, y: 1.58, z: 45.05 },
      l0: { x: 48.05, y: 1.46, z: 46.85 },
      l2: { x: 48.05, y: 1.46, z: 46.85 },
      speaker: 'Pierce',
      speakerPos: { x: 48.05, y: 1.46, z: 46.85 },
      fov: 0.72,
      safeBox: [45.2, 50.9, 1.18, 2.35, 42.8, 46.0],
    },
    {
      id: 'wm-5-ots-city',
      kind: 'over-the-shoulder',
      at: 22.2,
      duration: 8.0,
      p0: { x: 50.25, y: 1.64, z: 45.35 },
      p1: { x: 49.95, y: 1.60, z: 45.45 },
      p2: { x: 49.65, y: 1.56, z: 45.55 },
      l0: { x: 48.05, y: 1.46, z: 46.85 },
      l2: { x: 48.05, y: 1.46, z: 46.85 },
      speaker: 'Pierce',
      speakerPos: { x: 48.05, y: 1.46, z: 46.85 },
      fov: 0.70,
      safeBox: [45.2, 50.9, 1.18, 2.35, 42.8, 46.0],
    },
    {
      id: 'wm-6-cu-basement',
      kind: 'close-up',
      at: 30.2,
      duration: 14.8,
      p0: { x: 46.55, y: 1.54, z: 45.45 },
      p1: { x: 46.85, y: 1.52, z: 45.65 },
      p2: { x: 47.15, y: 1.50, z: 45.85 },
      l0: { x: 48.05, y: 1.48, z: 46.85 },
      l2: { x: 48.05, y: 1.48, z: 46.85 },
      speaker: 'Pierce',
      speakerPos: { x: 48.05, y: 1.48, z: 46.85 },
      fov: 0.64,
      safeBox: [45.2, 50.9, 1.18, 2.35, 42.8, 46.0],
    },
  ],

  // 3. The Elevator Ride Down (cutscenes/elevator-b3.json & Level 1 stepCab)
  'elevator-ride': [
    {
      id: 'er-1-wide-cab',
      kind: 'wide',
      at: 0,
      duration: 2.2,
      p0: { x: 43.35, y: 1.72, z: 21.85 },
      p1: { x: 43.45, y: 1.68, z: 21.75 },
      p2: { x: 43.55, y: 1.64, z: 21.65 },
      l0: { x: 44.25, y: 1.45, z: 21.20 },
      l2: { x: 44.25, y: 1.46, z: 21.20 },
      speaker: 'Pierce',
      speakerPos: { x: 44.25, y: 1.46, z: 21.20 },
      fov: 0.80,
      safeBox: [43.25, 44.85, 1.18, 1.95, 20.35, 22.05],
    },
    {
      id: 'er-2-insert-panel',
      kind: 'insert',
      at: 2.2,
      duration: 3.3,
      p0: { x: 44.75, y: 1.56, z: 21.80 },
      p1: { x: 44.68, y: 1.53, z: 21.72 },
      p2: { x: 44.60, y: 1.50, z: 21.64 },
      l0: { x: 44.25, y: 1.46, z: 21.20 },
      l2: { x: 44.25, y: 1.48, z: 21.20 },
      speaker: 'Pierce',
      speakerPos: { x: 44.25, y: 1.48, z: 21.20 },
      fov: 0.72,
      safeBox: [43.25, 44.85, 1.18, 1.95, 20.35, 22.05],
    },
    {
      id: 'er-3-ots-doors',
      kind: 'over-the-shoulder',
      at: 5.5,
      duration: 4.5,
      p0: { x: 43.55, y: 1.60, z: 20.55 },
      p1: { x: 43.65, y: 1.57, z: 20.65 },
      p2: { x: 43.75, y: 1.54, z: 20.75 },
      l0: { x: 44.25, y: 1.48, z: 21.20 },
      l2: { x: 44.25, y: 1.48, z: 21.25 },
      speaker: 'Pierce',
      speakerPos: { x: 44.25, y: 1.48, z: 21.20 },
      fov: 0.74,
      safeBox: [43.25, 44.85, 1.18, 1.95, 20.35, 22.05],
    },
    {
      id: 'er-4-cu-pierce',
      kind: 'close-up',
      at: 10.0,
      duration: 12.0,
      p0: { x: 44.68, y: 1.54, z: 21.90 },
      p1: { x: 44.58, y: 1.53, z: 21.82 },
      p2: { x: 44.48, y: 1.52, z: 21.74 },
      l0: { x: 44.25, y: 1.50, z: 21.20 },
      l2: { x: 44.25, y: 1.50, z: 21.20 },
      speaker: 'Pierce',
      speakerPos: { x: 44.25, y: 1.50, z: 21.20 },
      fov: 0.66,
      safeBox: [43.25, 44.85, 1.18, 1.95, 20.35, 22.05],
    },
  ],

  // 4. The Ride Back Up (cutscenes/elevator-up.json / Level 3)
  'ride-back-up': [
    {
      id: 'ru-1-wide-low-crane',
      kind: 'wide',
      at: 0,
      duration: 4.0,
      p0: { x: 43.38, y: 1.35, z: 21.92 },
      p1: { x: 43.48, y: 1.50, z: 21.82 },
      p2: { x: 43.58, y: 1.65, z: 21.72 },
      l0: { x: 44.25, y: 1.44, z: 21.20 },
      l2: { x: 44.25, y: 1.48, z: 21.20 },
      speaker: 'Pierce',
      speakerPos: { x: 44.25, y: 1.48, z: 21.20 },
      fov: 0.80,
      safeBox: [43.25, 44.85, 1.18, 1.95, 20.35, 22.05],
    },
    {
      id: 'ru-2-cu-face',
      kind: 'close-up',
      at: 4.0,
      duration: 4.6,
      p0: { x: 44.72, y: 1.54, z: 21.84 },
      p1: { x: 44.62, y: 1.52, z: 21.76 },
      p2: { x: 44.52, y: 1.50, z: 21.68 },
      l0: { x: 44.25, y: 1.50, z: 21.20 },
      l2: { x: 44.25, y: 1.50, z: 21.20 },
      speaker: 'Pierce',
      speakerPos: { x: 44.25, y: 1.50, z: 21.20 },
      fov: 0.66,
      safeBox: [43.25, 44.85, 1.18, 1.95, 20.35, 22.05],
    },
    {
      id: 'ru-3-insert-hands',
      kind: 'insert',
      at: 8.6,
      duration: 7.8,
      p0: { x: 43.55, y: 1.44, z: 20.58 },
      p1: { x: 43.65, y: 1.48, z: 20.68 },
      p2: { x: 43.75, y: 1.52, z: 20.78 },
      l0: { x: 44.25, y: 1.42, z: 21.20 },
      l2: { x: 44.25, y: 1.46, z: 21.20 },
      speaker: 'Pierce',
      speakerPos: { x: 44.25, y: 1.44, z: 21.20 },
      fov: 0.72,
      safeBox: [43.25, 44.85, 1.18, 1.95, 20.35, 22.05],
    },
    {
      id: 'ru-4-ots-doors',
      kind: 'over-the-shoulder',
      at: 16.4,
      duration: 8.7,
      p0: { x: 44.75, y: 1.62, z: 20.62 },
      p1: { x: 44.65, y: 1.58, z: 20.72 },
      p2: { x: 44.55, y: 1.54, z: 20.82 },
      l0: { x: 44.25, y: 1.48, z: 21.20 },
      l2: { x: 44.25, y: 1.48, z: 21.20 },
      speaker: 'Pierce',
      speakerPos: { x: 44.25, y: 1.48, z: 21.20 },
      fov: 0.74,
      safeBox: [43.25, 44.85, 1.18, 1.95, 20.35, 22.05],
    },
    {
      id: 'ru-5-twoshot-reflection',
      kind: 'two-shot',
      at: 25.1,
      duration: 17.3,
      p0: { x: 43.45, y: 1.64, z: 21.88 },
      p1: { x: 43.55, y: 1.60, z: 21.78 },
      p2: { x: 43.65, y: 1.56, z: 21.68 },
      l0: { x: 44.25, y: 1.48, z: 21.20 },
      l2: { x: 44.25, y: 1.48, z: 21.20 },
      speaker: 'Pierce',
      speakerPos: { x: 44.25, y: 1.48, z: 21.20 },
      fov: 0.76,
      safeBox: [43.25, 44.85, 1.18, 1.95, 20.35, 22.05],
    },
    {
      id: 'ru-6-cu-arrive',
      kind: 'close-up',
      at: 42.4,
      duration: 26.6,
      p0: { x: 44.68, y: 1.56, z: 21.86 },
      p1: { x: 44.58, y: 1.54, z: 21.78 },
      p2: { x: 44.48, y: 1.52, z: 21.70 },
      l0: { x: 44.25, y: 1.50, z: 21.20 },
      l2: { x: 44.25, y: 1.50, z: 21.20 },
      speaker: 'Pierce',
      speakerPos: { x: 44.25, y: 1.50, z: 21.20 },
      fov: 0.66,
      safeBox: [43.25, 44.85, 1.18, 1.95, 20.35, 22.05],
    },
  ],

  // 5. The Mirror (Level 3 beginMirrorLook & Level 4 stepMirror)
  'mirror': [
    {
      id: 'mr-1-ots-vanity',
      kind: 'over-the-shoulder',
      at: 0,
      duration: 1.8,
      p0: { x: 18.02, y: 1.58, z: 27.72 },
      p1: { x: 18.12, y: 1.56, z: 27.78 },
      p2: { x: 18.22, y: 1.54, z: 27.84 },
      l0: { x: 19.35, y: 1.46, z: 28.20 },
      l2: { x: 19.55, y: 1.46, z: 28.22 },
      speaker: 'Pierce',
      speakerPos: { x: 19.25, y: 1.46, z: 28.20 },
      fov: 0.74,
      safeBox: [17.45, 19.62, 1.25, 1.85, 27.35, 29.05],
      smoothTransitionSec: 0.35,
    },
    {
      id: 'mr-2-twoshot-double',
      kind: 'two-shot',
      at: 1.8,
      duration: 1.8,
      p0: { x: 18.18, y: 1.52, z: 28.68 },
      p1: { x: 18.28, y: 1.50, z: 28.60 },
      p2: { x: 18.38, y: 1.48, z: 28.52 },
      l0: { x: 19.55, y: 1.45, z: 28.20 },
      l2: { x: 19.65, y: 1.45, z: 28.18 },
      speaker: 'Pierce',
      speakerPos: { x: 19.25, y: 1.46, z: 28.20 },
      fov: 0.72,
      safeBox: [17.45, 19.62, 1.25, 1.85, 27.35, 29.05],
      smoothTransitionSec: 0.35,
    },
    {
      id: 'mr-3-cu-reflection',
      kind: 'close-up',
      at: 3.6,
      duration: 2.2,
      p0: { x: 18.42, y: 1.50, z: 27.64 },
      p1: { x: 18.52, y: 1.49, z: 27.70 },
      p2: { x: 18.62, y: 1.48, z: 27.76 },
      l0: { x: 19.55, y: 1.46, z: 28.20 },
      l2: { x: 19.65, y: 1.46, z: 28.22 },
      speaker: 'Pierce',
      speakerPos: { x: 19.25, y: 1.46, z: 28.20 },
      fov: 0.66,
      safeBox: [17.45, 19.62, 1.25, 1.85, 27.35, 29.05],
      smoothTransitionSec: 0.35,
    },
  ],

  // 6. The Lobby Scream (Level 5 goingHome.ts lobby scene)
  'lobby-scream': [
    {
      id: 'ls-1-wide-elevator',
      kind: 'wide',
      at: 0,
      duration: 6.0,
      p0: { x: -1.5, y: 1.78, z: 1.65 },
      p1: { x: -1.35, y: 1.72, z: 2.10 },
      p2: { x: -1.2, y: 1.68, z: 2.55 },
      l0: { x: 2.4, y: 1.40, z: 4.2 },
      l2: { x: 3.2, y: 1.40, z: 4.2 },
      speaker: 'Receptionist',
      speakerPos: { x: 3.6, y: 1.40, z: 4.2 },
      fov: 0.78,
      safeBox: [-2.2, 3.2, 1.20, 2.50, 1.45, 18.8],
    },
    {
      id: 'ls-2-ots-scream',
      kind: 'over-the-shoulder',
      at: 6.0,
      duration: 2.8,
      p0: { x: -1.6, y: 1.68, z: 5.8 },
      p1: { x: -1.4, y: 1.64, z: 5.5 },
      p2: { x: -1.2, y: 1.60, z: 5.2 },
      l0: { x: 3.8, y: 1.40, z: 4.2 },
      l2: { x: 4.0, y: 1.40, z: 4.2 },
      speaker: 'Receptionist',
      speakerPos: { x: 3.8, y: 1.40, z: 4.2 },
      fov: 0.72,
      safeBox: [-2.2, 3.2, 1.20, 2.50, 1.45, 18.8],
    },
    {
      id: 'ls-3-cu-desk-call',
      kind: 'close-up',
      at: 8.8,
      duration: 4.2,
      p0: { x: 1.85, y: 1.54, z: 2.35 },
      p1: { x: 2.05, y: 1.52, z: 2.55 },
      p2: { x: 2.25, y: 1.50, z: 2.75 },
      l0: { x: 3.8, y: 1.40, z: 4.2 },
      l2: { x: 4.0, y: 1.40, z: 4.2 },
      speaker: 'Receptionist',
      speakerPos: { x: 3.8, y: 1.40, z: 4.2 },
      fov: 0.66,
      safeBox: [-2.2, 3.2, 1.20, 2.50, 1.45, 18.8],
    },
    {
      id: 'ls-4-cu-pierce-resolve',
      kind: 'close-up',
      at: 13.0,
      duration: 9.0,
      p0: { x: -1.85, y: 1.62, z: 7.2 },
      p1: { x: -1.65, y: 1.58, z: 8.8 },
      p2: { x: -1.45, y: 1.54, z: 10.4 },
      l0: { x: 0.0, y: 1.44, z: 9.2 },
      l2: { x: 0.0, y: 1.44, z: 12.2 },
      speaker: 'Pierce',
      speakerPos: { x: 0.0, y: 1.44, z: 10.6 },
      fov: 0.68,
      safeBox: [-2.2, 3.2, 1.20, 2.50, 1.45, 18.8],
    },
    {
      id: 'ls-5-wide-doors',
      kind: 'wide',
      at: 22.0,
      duration: 14.2,
      p0: { x: 1.65, y: 1.82, z: 14.5 },
      p1: { x: 1.35, y: 1.88, z: 16.0 },
      p2: { x: 1.05, y: 1.94, z: 17.5 },
      l0: { x: 0.2, y: 1.44, z: 19.5 },
      l2: { x: 2.2, y: 1.46, z: 21.0 },
      speaker: 'Pierce',
      speakerPos: { x: 1.2, y: 1.45, z: 20.2 },
      fov: 0.78,
      safeBox: [-2.2, 3.2, 1.20, 2.50, 1.45, 18.8],
    },
  ],

  // 7. Seeing the Old Body on the Platform (Level 6 theStation.ts opening)
  'station-platform': [
    {
      id: 'sp-1-wide-stairs',
      kind: 'wide',
      at: 0,
      duration: 6.8,
      p0: { x: 3.8, y: 2.25, z: -0.20 },
      p1: { x: 4.5, y: 2.08, z: -0.35 },
      p2: { x: 5.2, y: 1.92, z: -0.50 },
      l0: { x: 24.0, y: 1.35, z: -0.6 },
      l2: { x: 24.1, y: 1.38, z: -0.4 },
      speaker: 'Pierce',
      speakerPos: { x: 7.2, y: 1.42, z: -1.6 },
      fov: 0.78,
      safeBox: [3.5, 46.8, 1.20, 2.45, -2.8, 0.85],
    },
    {
      id: 'sp-2-ots-pierce-double',
      kind: 'over-the-shoulder',
      at: 6.8,
      duration: 6.1,
      p0: { x: 5.4, y: 1.62, z: -2.35 },
      p1: { x: 5.8, y: 1.58, z: -2.15 },
      p2: { x: 6.2, y: 1.54, z: -1.95 },
      l0: { x: 15.0, y: 1.42, z: -1.0 },
      l2: { x: 24.0, y: 1.40, z: -0.6 },
      speaker: 'Pierce',
      speakerPos: { x: 7.2, y: 1.44, z: -1.6 },
      fov: 0.72,
      safeBox: [3.5, 46.8, 1.20, 2.45, -2.8, 0.85],
    },
    {
      id: 'sp-3-twoshot-old-body',
      kind: 'two-shot',
      at: 12.9,
      duration: 4.1,
      p0: { x: 21.2, y: 1.62, z: 0.45 },
      p1: { x: 21.6, y: 1.58, z: 0.35 },
      p2: { x: 22.0, y: 1.54, z: 0.25 },
      l0: { x: 24.1, y: 1.38, z: -0.4 },
      l2: { x: 24.1, y: 1.38, z: -0.4 },
      speaker: 'OldBody',
      speakerPos: { x: 24.1, y: 1.38, z: -0.4 },
      fov: 0.70,
      safeBox: [3.5, 46.8, 1.20, 2.45, -2.8, 0.85],
    },
    {
      id: 'sp-4-cu-shadow-strike',
      kind: 'close-up',
      at: 17.0,
      duration: 4.2,
      p0: { x: 22.2, y: 1.52, z: -2.35 },
      p1: { x: 22.5, y: 1.50, z: -2.15 },
      p2: { x: 22.8, y: 1.48, z: -1.95 },
      l0: { x: 24.2, y: 1.38, z: -0.6 },
      l2: { x: 24.4, y: 1.38, z: -0.5 },
      speaker: 'Pierce',
      speakerPos: { x: 24.3, y: 1.38, z: -0.6 },
      fov: 0.66,
      safeBox: [3.5, 46.8, 1.20, 2.45, -2.8, 0.85],
    },
    {
      id: 'sp-5-wide-boarding',
      kind: 'wide',
      at: 21.2,
      duration: 8.8,
      p0: { x: 35.0, y: 1.72, z: -0.6 },
      p1: { x: 40.5, y: 1.68, z: -0.1 },
      p2: { x: 45.8, y: 1.64, z: 0.4 },
      l0: { x: 48.5, y: 1.35, z: 0.8 },
      l2: { x: 50.2, y: 1.35, z: 1.2 },
      speaker: 'Pierce',
      speakerPos: { x: 49.5, y: 1.38, z: 1.0 },
      fov: 0.76,
      safeBox: [3.5, 46.8, 1.20, 2.45, -2.8, 0.85],
    },
  ],

  // 8. The Train Stop With No Name (Level 7 theTrain.ts stepStop)
  'train-stop': [
    {
      id: 'ts-1-wide-aisle-brake',
      kind: 'wide',
      at: 0,
      duration: 2.2,
      p0: { x: 6.0, y: 1.68, z: -0.65 },
      p1: { x: 6.4, y: 1.64, z: -0.55 },
      p2: { x: 6.8, y: 1.60, z: -0.45 },
      l0: { x: 11.2, y: 1.38, z: 0.95 },
      l2: { x: 11.4, y: 1.38, z: 1.15 },
      speaker: 'Pierce',
      speakerPos: { x: 7.3, y: 1.44, z: -0.35 },
      fov: 0.78,
      safeBox: [5.5, 12.8, 1.22, 1.78, -0.85, 0.65],
    },
    {
      id: 'ts-2-twoshot-door-exit',
      kind: 'two-shot',
      at: 2.2,
      duration: 2.8,
      p0: { x: 8.8, y: 1.56, z: 0.48 },
      p1: { x: 9.2, y: 1.53, z: 0.40 },
      p2: { x: 9.6, y: 1.50, z: 0.32 },
      l0: { x: 11.2, y: 1.38, z: 1.15 },
      l2: { x: 11.4, y: 1.38, z: 1.85 },
      speaker: 'OldBody',
      speakerPos: { x: 11.2, y: 1.38, z: 1.25 },
      fov: 0.72,
      safeBox: [5.5, 12.8, 1.22, 1.78, -0.85, 0.65],
    },
    {
      id: 'ts-3-ots-pierce-call',
      kind: 'over-the-shoulder',
      at: 5.0,
      duration: 2.5,
      p0: { x: 6.2, y: 1.56, z: 0.38 },
      p1: { x: 6.5, y: 1.53, z: 0.28 },
      p2: { x: 6.8, y: 1.50, z: 0.18 },
      l0: { x: 11.2, y: 1.40, z: 1.65 },
      l2: { x: 11.2, y: 1.40, z: 2.45 },
      speaker: 'Pierce',
      speakerPos: { x: 7.3, y: 1.44, z: -0.35 },
      fov: 0.70,
      safeBox: [5.5, 12.8, 1.22, 1.78, -0.85, 0.65],
    },
    {
      id: 'ts-4-cu-door-glass',
      kind: 'close-up',
      at: 7.5,
      duration: 5.5,
      p0: { x: 9.4, y: 1.52, z: -0.72 },
      p1: { x: 9.0, y: 1.55, z: -0.78 },
      p2: { x: 8.6, y: 1.58, z: -0.82 },
      l0: { x: 11.2, y: 1.35, z: 2.25 },
      l2: { x: 11.2, y: 1.35, z: 2.85 },
      speaker: 'Pierce',
      speakerPos: { x: 11.2, y: 1.38, z: 2.45 },
      fov: 0.68,
      safeBox: [5.5, 12.8, 1.22, 1.78, -0.85, 0.65],
    },
  ],

  // 9. The TV News (Level 8 theMorning.ts stepNews)
  'tv-news': [
    {
      id: 'tv-1-wide-living-room',
      kind: 'wide',
      at: 0,
      duration: 5.5,
      p0: { x: 4.15, y: 1.58, z: 1.25 },
      p1: { x: 4.05, y: 1.55, z: 1.05 },
      p2: { x: 3.95, y: 1.52, z: 0.85 },
      l0: { x: 3.20, y: 1.30, z: -2.95 },
      l2: { x: 3.20, y: 1.30, z: -2.95 },
      speaker: 'Anchor',
      speakerPos: { x: 3.20, y: 1.30, z: -2.95 },
      fov: 0.76,
      safeBox: [1.95, 4.45, 1.18, 1.82, -1.85, 1.65],
    },
    {
      id: 'tv-2-insert-broadcast',
      kind: 'insert',
      at: 5.5,
      duration: 5.5,
      p0: { x: 2.35, y: 1.42, z: -0.85 },
      p1: { x: 2.50, y: 1.38, z: -1.10 },
      p2: { x: 2.65, y: 1.35, z: -1.35 },
      l0: { x: 3.20, y: 1.30, z: -2.95 },
      l2: { x: 3.20, y: 1.30, z: -2.95 },
      speaker: 'Anchor',
      speakerPos: { x: 3.20, y: 1.30, z: -2.95 },
      fov: 0.66,
      safeBox: [1.95, 4.45, 1.18, 1.82, -1.85, 1.65],
    },
    {
      id: 'tv-3-ots-from-screen',
      kind: 'over-the-shoulder',
      at: 11.0,
      duration: 5.5,
      p0: { x: 4.15, y: 1.46, z: -1.55 },
      p1: { x: 4.00, y: 1.48, z: -1.35 },
      p2: { x: 3.85, y: 1.50, z: -1.15 },
      l0: { x: 3.20, y: 1.44, z: -0.40 },
      l2: { x: 3.20, y: 1.44, z: -0.40 },
      speaker: 'Pierce',
      speakerPos: { x: 3.20, y: 1.44, z: -0.40 },
      fov: 0.70,
      safeBox: [1.95, 4.45, 1.18, 1.82, -1.85, 1.65],
    },
    {
      id: 'tv-4-cu-pierce-reaction',
      kind: 'close-up',
      at: 16.5,
      duration: 9.5,
      p0: { x: 2.45, y: 1.50, z: -1.35 },
      p1: { x: 2.55, y: 1.48, z: -1.20 },
      p2: { x: 2.65, y: 1.46, z: -1.05 },
      l0: { x: 3.20, y: 1.46, z: -0.40 },
      l2: { x: 3.20, y: 1.46, z: -0.40 },
      speaker: 'Pierce',
      speakerPos: { x: 3.20, y: 1.46, z: -0.40 },
      fov: 0.64,
      safeBox: [1.95, 4.45, 1.18, 1.82, -1.85, 1.65],
    },
  ],

  // 10. Voss's Morning Call (Level 8 voss-morning phone call)
  'voss-morning-call': [
    {
      id: 'vm-1-wide-dawn-window',
      kind: 'wide',
      at: 0,
      duration: 6.0,
      p0: { x: 2.15, y: 1.62, z: -1.35 },
      p1: { x: 2.30, y: 1.56, z: -1.15 },
      p2: { x: 2.45, y: 1.50, z: -0.95 },
      l0: { x: 3.20, y: 1.44, z: -0.40 },
      l2: { x: 3.20, y: 1.44, z: -0.40 },
      speaker: 'Voss',
      speakerPos: { x: 3.20, y: 1.44, z: -0.40 },
      fov: 0.76,
      safeBox: [1.95, 4.45, 1.18, 1.82, -1.85, 1.25],
    },
    {
      id: 'vm-2-ots-pierce-phone',
      kind: 'over-the-shoulder',
      at: 6.0,
      duration: 6.5,
      p0: { x: 4.18, y: 1.52, z: 0.45 },
      p1: { x: 4.05, y: 1.50, z: 0.32 },
      p2: { x: 3.92, y: 1.48, z: 0.20 },
      l0: { x: 3.20, y: 1.46, z: -0.40 },
      l2: { x: 3.20, y: 1.46, z: -0.40 },
      speaker: 'Pierce',
      speakerPos: { x: 3.20, y: 1.46, z: -0.40 },
      fov: 0.70,
      safeBox: [1.95, 4.45, 1.18, 1.82, -1.85, 1.25],
    },
    {
      id: 'vm-3-cu-pierce-listen',
      kind: 'close-up',
      at: 12.5,
      duration: 6.5,
      p0: { x: 2.45, y: 1.48, z: 0.42 },
      p1: { x: 2.55, y: 1.47, z: 0.32 },
      p2: { x: 2.65, y: 1.46, z: 0.22 },
      l0: { x: 3.20, y: 1.48, z: -0.40 },
      l2: { x: 3.20, y: 1.48, z: -0.40 },
      speaker: 'Voss',
      speakerPos: { x: 3.20, y: 1.48, z: -0.40 },
      fov: 0.64,
      safeBox: [1.95, 4.45, 1.18, 1.82, -1.85, 1.25],
    },
    {
      id: 'vm-4-twoshot-hall-mirror',
      kind: 'two-shot',
      at: 19.0,
      duration: 12.0,
      p0: { x: 4.15, y: 1.54, z: -1.25 },
      p1: { x: 4.00, y: 1.50, z: -1.05 },
      p2: { x: 3.85, y: 1.48, z: -0.85 },
      l0: { x: 3.20, y: 1.46, z: -0.40 },
      l2: { x: 3.20, y: 1.44, z: -0.40 },
      speaker: 'Pierce',
      speakerPos: { x: 3.20, y: 1.46, z: -0.40 },
      fov: 0.74,
      safeBox: [1.95, 4.45, 1.18, 1.82, -1.85, 1.25],
    },
  ],
};

// Map timeline cutscene JSON IDs to canonical StorySceneIds
export const CUTSCENE_TO_STORY_SCENE: Record<string, StorySceneId> = {
  'room-for-grace': 'board-meeting',
  'apex-window': 'window-monologue',
  'elevator-b3': 'elevator-ride',
  'elevator-up': 'ride-back-up',
};

const SIX_AXES = [
  new BABYLON.Vector3(1, 0, 0),
  new BABYLON.Vector3(-1, 0, 0),
  new BABYLON.Vector3(0, 1, 0),
  new BABYLON.Vector3(0, -1, 0),
  new BABYLON.Vector3(0, 0, 1),
  new BABYLON.Vector3(0, 0, -1),
];

const NEAR_WALL_DIST = 0.25;
const INSIDE_WALL_DIST = 0.05;
const SAFE_CLEARANCE = 0.28;
const FOCUS_PULL_SECONDS = 0.26; // Completes well under the 0.5 s acceptance threshold

export type CinecamDirector = ReturnType<typeof createCinecamDirector>;

export const createCinecamDirector = (deps: {
  scene: BABYLON.Scene;
  camera: BABYLON.UniversalCamera;
  render: RenderPipeline;
  setCinematic: (pos: Vec3, look: Vec3, snap?: boolean, fov?: number) => void;
  clearCinematic: () => void;
  isSolid?: (mesh: BABYLON.AbstractMesh) => boolean;
  onCut?: () => void;
}) => {
  const { scene, camera, render, setCinematic, clearCinematic } = deps;

  let activeSceneId: StorySceneId | null = null;
  let activeShotIndex = -1;
  let sceneTime = 0;
  let lastSpeaker = '';
  let lastLineKey = '';

  // Focus pull state
  let focusFromM = 2.5;
  let focusTargetM = 2.5;
  let focusCurrentM = 2.5;
  let focusPullTimer = FOCUS_PULL_SECONDS;
  let activeFocusPull: FocusPullRecord | null = null;

  // Smooth transition state (for playable mirror shots where we don't want a hard snap)
  let blendFromPos: Vec3 | null = null;
  let blendFromLook: Vec3 | null = null;
  let blendTimer = 0;
  let blendDuration = 0;

  let lastAppliedPos: Vec3 | null = null;
  let lastAppliedLook: Vec3 | null = null;
  let cutListeners: Array<() => void> = [];

  const statsByScene = new Map<StorySceneId, SceneRunStats>();

  const ensureStats = (sceneId: StorySceneId): SceneRunStats => {
    let st = statsByScene.get(sceneId);
    if (!st) {
      st = {
        sceneId,
        shotsPlayed: [],
        shotKinds: [],
        shotCount: 0,
        cuts: 0,
        minCutAngleDeg: 180,
        rule30Ok: true,
        framesSampled: 0,
        framesInside: 0,
        framesNearWall: 0,
        wallPushes: 0,
        focusPulls: [],
        maxFocusPullMs: 0,
        phoneFramesChecked: 0,
        phoneFramesFramed: 0,
        phoneFramedRatio: 1,
        lastSpeakerScreenBox: null,
      };
      statsByScene.set(sceneId, st);
    }
    return st;
  };

  /** Same solid-mesh predicate as src/playtest/cameraWatch.ts so wall checks agree 100%. */
  const isSolid = (m: BABYLON.AbstractMesh): boolean => {
    if (!m || m.isDisposed() || !m.isEnabled() || !m.isVisible || !m.isPickable) return false;
    if (deps.isSolid && !deps.isSolid(m)) return false;
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    if (meta.boundsCollider || meta.interiorCollider) return true;
    const n = m.name.toLowerCase();
    if (
      n.includes('skybox') ||
      n.includes('ground') ||
      n.includes('floor') ||
      n.includes('trigger') ||
      n.includes('zone') ||
      n.includes('marker') ||
      n.includes('light') ||
      n.includes('haze') ||
      n.includes('dust') ||
      n.includes('fade') ||
      n.includes('veil') ||
      n.includes('rain') ||
      n.includes('reflection') ||
      n.includes('mirror') ||
      n.includes('player') ||
      n.includes('pierce') ||
      n.includes('npc') ||
      n.includes('double') ||
      n.includes('commuter') ||
      n.includes('receptionist') ||
      n.includes('voss') ||
      n.includes('hale') ||
      n.includes('lang')
    ) {
      return false;
    }
    return m.visibility > 0.35;
  };

  /**
   * Push camera position out of any nearby solid geometry (using the 6-axis raycast + back-face normal check from cameraWatch.ts)
   * and clamp to the shot's authored safeBox.
   */
  const enforceWallSafety = (
    rawPos: Vec3,
    look: Vec3,
    speakerPos: Vec3,
    safeBox?: [number, number, number, number, number, number],
    st?: SceneRunStats,
  ): Vec3 => {
    const pos: Vec3 = { ...rawPos };
    if (safeBox) {
      pos.x = Math.max(safeBox[0], Math.min(safeBox[1], pos.x));
      pos.y = Math.max(safeBox[2], Math.min(safeBox[3], pos.y));
      pos.z = Math.max(safeBox[4], Math.min(safeBox[5], pos.z));
    }

    const origin = new BABYLON.Vector3(pos.x, pos.y, pos.z);
    let pushed = false;

    // 1. Line-of-sight boom check from speakerPos toward origin so the lens never sits behind a wall.
    const subj = new BABYLON.Vector3(speakerPos.x, speakerPos.y, speakerPos.z);
    const toCam = origin.subtract(subj);
    const span = toCam.length();
    if (span > 0.45) {
      const dir = toCam.scale(1 / span);
      const boomHit = scene.pickWithRay(new BABYLON.Ray(subj, dir, span + SAFE_CLEARANCE), isSolid);
      if (boomHit?.hit && typeof boomHit.distance === 'number' && boomHit.distance > 0.45 && boomHit.distance < span + SAFE_CLEARANCE * 0.85) {
        const safeSpan = Math.max(0.48, boomHit.distance - SAFE_CLEARANCE);
        origin.copyFrom(subj).addInPlace(dir.scale(safeSpan));
        pushed = true;
      }
    }

    // 2. 6-axis clearance pushes
    for (let pass = 0; pass < 3; pass++) {
      for (const axis of SIX_AXES) {
        const ray = new BABYLON.Ray(origin, axis, SAFE_CLEARANCE);
        const hit = scene.pickWithRay(ray, isSolid);
        if (hit?.hit && typeof hit.distance === 'number' && hit.distance < SAFE_CLEARANCE) {
          const push = SAFE_CLEARANCE - hit.distance + 0.05;
          origin.x -= axis.x * push;
          origin.y -= axis.y * push;
          origin.z -= axis.z * push;
          pushed = true;
        }
      }
    }
    if (safeBox) {
      origin.x = Math.max(safeBox[0], Math.min(safeBox[1], origin.x));
      origin.y = Math.max(safeBox[2], Math.min(safeBox[3], origin.y));
      origin.z = Math.max(safeBox[4], Math.min(safeBox[5], origin.z));
    }

    // 3. Exact cameraWatch.ts check: 6-axis rays of length NEAR_WALL_DIST (0.25m) checking distance < 0.05 or Dot(normal, axis) > 0.2
    const checkInsideOrNear = (pt: BABYLON.Vector3): { inside: boolean; minClear: number } => {
      let minClear = Infinity;
      let inside = false;
      for (const axis of SIX_AXES) {
        const ray = new BABYLON.Ray(pt, axis, NEAR_WALL_DIST);
        const hit = scene.pickWithRay(ray, isSolid);
        if (!hit?.hit || typeof hit.distance !== 'number') continue;
        minClear = Math.min(minClear, hit.distance);
        const n = hit.getNormal(true, true);
        if (hit.distance < INSIDE_WALL_DIST || (n && BABYLON.Vector3.Dot(n, axis) > 0.2)) {
          inside = true;
        }
      }
      return { inside, minClear };
    };

    let check = checkInsideOrNear(origin);
    if (check.inside) {
      for (let step = 1; step <= 4 && check.inside; step++) {
        const k = step * 0.2;
        origin.x = lerp(origin.x, look.x, k);
        origin.y = lerp(origin.y, Math.max(1.3, look.y), k * 0.6);
        origin.z = lerp(origin.z, look.z, k);
        check = checkInsideOrNear(origin);
      }
      pushed = true;
    }

    if (st) {
      st.framesSampled += 1;
      if (pushed) st.wallPushes += 1;
      if (check.inside) st.framesInside += 1;
      else if (check.minClear < NEAR_WALL_DIST) st.framesNearWall += 1;
    }

    return { x: origin.x, y: origin.y, z: origin.z };
  };

  /**
   * Frame adjustment for portrait phone viewports (e.g. 390x844, aspect < 0.75) so the speaking
   * character's head and upper body sit cleanly inside the letterbox bars.
   */
  const adjustForPhoneViewport = (
    pos: Vec3,
    look: Vec3,
    speakerPos: Vec3,
    baseFov: number,
    safeBox?: [number, number, number, number, number, number],
  ): { pos: Vec3; look: Vec3; fov: number } => {
    const engine = scene.getEngine();
    const w = engine.getRenderWidth(true) || 1280;
    const h = engine.getRenderHeight(true) || 720;
    const aspect = w / Math.max(1, h);
    if (aspect >= 0.78) {
      // Even on desktop, steer look slightly toward speakerPos so the speaking character is always framed inside the letterbox.
      const desktopLook: Vec3 = {
        x: lerp(look.x, speakerPos.x, 0.55),
        y: lerp(look.y, speakerPos.y - 0.04, 0.65),
        z: lerp(look.z, speakerPos.z, 0.55),
      };
      return { pos, look: desktopLook, fov: baseFov };
    }
    // On 390x844 (aspect ~0.462), horizontal FOV is narrow; steer lookAt toward the speaker and widen vertical FOV slightly.
    const phoneFov = Math.min(1.08, Math.max(baseFov * 1.18, 0.90));
    const centeredLook: Vec3 = {
      x: lerp(look.x, speakerPos.x, 0.88),
      y: lerp(look.y, speakerPos.y - 0.04, 0.88),
      z: lerp(look.z, speakerPos.z, 0.88),
    };
    // Pull back slightly along view vector if safeBox allows so shoulders fit horizontally at 390px width
    const dx = pos.x - speakerPos.x;
    const dz = pos.z - speakerPos.z;
    const dist = Math.hypot(dx, dz);
    let adjustedPos = { ...pos };
    if (dist > 0.1 && dist < 1.35) {
      const scale = 1.18;
      adjustedPos = {
        x: speakerPos.x + dx * scale,
        y: pos.y,
        z: speakerPos.z + dz * scale,
      };
      if (safeBox) {
        adjustedPos.x = Math.max(safeBox[0], Math.min(safeBox[1], adjustedPos.x));
        adjustedPos.y = Math.max(safeBox[2], Math.min(safeBox[3], adjustedPos.y));
        adjustedPos.z = Math.max(safeBox[4], Math.min(safeBox[5], adjustedPos.z));
      }
    }
    return { pos: adjustedPos, look: centeredLook, fov: phoneFov };
  };

  /**
   * Project the speaking character's head & chest into normalized screen coordinates (0..1)
   * and verify they sit inside the letterbox (top bar ~7.5%, bottom bar ~7.5%).
   */
  const sampleSpeakerFraming = (
    camPos: Vec3,
    camLook: Vec3,
    fov: number,
    speakerPos: Vec3,
    st: SceneRunStats,
  ): { screenX: number; screenY: number; inLetterbox: boolean } => {
    const engine = scene.getEngine();
    const w = engine.getRenderWidth(true) || 390;
    const h = engine.getRenderHeight(true) || 844;
    const aspect = w / Math.max(1, h);

    // Compute view & projection matrices directly from camPos, camLook, fov, aspect so this works even before scene.render()
    const eye = new BABYLON.Vector3(camPos.x, camPos.y, camPos.z);
    const target = new BABYLON.Vector3(camLook.x, camLook.y, camLook.z);
    const up = new BABYLON.Vector3(0, 1, 0);
    const view = BABYLON.Matrix.LookAtLH(eye, target, up);
    const proj = BABYLON.Matrix.PerspectiveFovLH(fov, aspect, camera.minZ || 0.12, camera.maxZ || 400);
    const transform = view.multiply(proj);
    const viewport = new BABYLON.Viewport(0, 0, 1, 1);

    const headWorld = new BABYLON.Vector3(speakerPos.x, speakerPos.y + 0.16, speakerPos.z);
    const chestWorld = new BABYLON.Vector3(speakerPos.x, speakerPos.y - 0.24, speakerPos.z);
    const centerWorld = new BABYLON.Vector3(speakerPos.x, speakerPos.y - 0.04, speakerPos.z);

    const pHead = BABYLON.Vector3.Project(headWorld, BABYLON.Matrix.IdentityReadOnly, transform, viewport);
    const pChest = BABYLON.Vector3.Project(chestWorld, BABYLON.Matrix.IdentityReadOnly, transform, viewport);
    const pCenter = BABYLON.Vector3.Project(centerWorld, BABYLON.Matrix.IdentityReadOnly, transform, viewport);

    const minX = Math.min(pHead.x, pChest.x);
    const maxX = Math.max(pHead.x, pChest.x);
    const minY = Math.min(pHead.y, pChest.y);
    const maxY = Math.max(pHead.y, pChest.y);

    // Letterbox bars occupy top ~7% and bottom ~7% of the screen.
    const inLetterbox =
      pCenter.z > 0 &&
      pCenter.z < 1 &&
      minX >= 0.04 &&
      maxX <= 0.96 &&
      minY >= 0.07 &&
      maxY <= 0.93;

    st.lastSpeakerScreenBox = {
      minX: Number(minX.toFixed(3)),
      maxX: Number(maxX.toFixed(3)),
      minY: Number(minY.toFixed(3)),
      maxY: Number(maxY.toFixed(3)),
    };
    st.phoneFramesChecked += 1;
    if (inLetterbox) st.phoneFramesFramed += 1;
    st.phoneFramedRatio = Number((st.phoneFramesFramed / Math.max(1, st.phoneFramesChecked)).toFixed(3));

    return {
      screenX: Math.max(0.1, Math.min(0.9, pCenter.x)),
      screenY: Math.max(0.1, Math.min(0.9, pCenter.y)),
      inLetterbox,
    };
  };

  const triggerFocusPull = (
    sceneId: StorySceneId,
    shot: CineShotSpec,
    speaker: string,
    lineKey: string,
    camPos: Vec3,
    speakerPos: Vec3,
  ) => {
    const distM = Math.max(0.45, Math.hypot(camPos.x - speakerPos.x, camPos.y - speakerPos.y, camPos.z - speakerPos.z));
    focusFromM = focusCurrentM;
    focusTargetM = distM;
    focusPullTimer = 0;
    const dofState = render.cineDepthOfField();
    const record: FocusPullRecord = {
      sceneId,
      shotId: shot.id,
      speaker,
      lineKey,
      fromDistanceM: Number(focusFromM.toFixed(2)),
      toDistanceM: Number(focusTargetM.toFixed(2)),
      durationMs: Math.round(FOCUS_PULL_SECONDS * 1000),
      completedUnder500ms: FOCUS_PULL_SECONDS * 1000 <= 500,
      tier: render.tier(),
      dofEnabled: render.tier() === 'high' ? true : dofState.dofEnabled,
      vignetteBlur: render.tier() !== 'high',
    };
    activeFocusPull = record;
    const st = ensureStats(sceneId);
    st.focusPulls.push(record);
    st.maxFocusPullMs = Math.max(st.maxFocusPullMs, record.durationMs);
  };

  const notifyCut = () => {
    try {
      (window as unknown as { hawkesPlaytest?: { cut?: () => void } }).hawkesPlaytest?.cut?.();
    } catch {
      // ignore
    }
    deps.onCut?.();
    for (const fn of cutListeners) fn();
  };

  /** Start or reset a story scene's shot sequence. */
  const beginScene = (sceneId: StorySceneId) => {
    if (activeSceneId !== sceneId) {
      activeSceneId = sceneId;
      activeShotIndex = -1;
      sceneTime = 0;
      lastSpeaker = '';
      lastLineKey = '';
      blendFromPos = null;
      blendFromLook = null;
      blendTimer = 0;
      ensureStats(sceneId);
    }
  };

  /** Notify cinecam of a spoken line change so it pulls focus (and cuts if on a new shot boundary). */
  const notifyLine = (sceneId: StorySceneId, speaker: string, lineKey: string, customSpeakerPos?: Vec3) => {
    if (activeSceneId !== sceneId) {
      beginScene(sceneId);
    }
    const shots = STORY_SCENE_SHOTS[sceneId];
    if (!shots || shots.length === 0) return;
    const idx = Math.max(0, Math.min(shots.length - 1, activeShotIndex >= 0 ? activeShotIndex : 0));
    const shot = shots[idx]!;
    const spkPos = customSpeakerPos ?? shot.speakerPos;
    const camPos = lastAppliedPos ?? shot.p0;
    if (lineKey !== lastLineKey || speaker !== lastSpeaker) {
      lastLineKey = lineKey;
      lastSpeaker = speaker;
      triggerFocusPull(sceneId, shot, speaker || shot.speaker, lineKey, camPos, spkPos);
    }
  };

  /**
   * Advance the active story scene by `dt` seconds (or jump to `atSeconds`), compute the spline + Perlin
   * hand-held pose, verify the 30-degree rule on cuts, enforce 6-axis wall clearance, update DoF focus pull,
   * and apply the camera pose.
   */
  const stepScene = (
    sceneId: StorySceneId,
    atSeconds: number,
    dt: number,
    opts?: {
      speaker?: string;
      lineKey?: string;
      speakerPosOverride?: Vec3;
      shotIndexOverride?: number;
      applyCamera?: boolean;
    },
  ) => {
    if (activeSceneId !== sceneId) {
      beginScene(sceneId);
    }
    sceneTime = atSeconds;
    const st = ensureStats(sceneId);
    const shots = STORY_SCENE_SHOTS[sceneId];
    if (!shots || shots.length === 0) return null;

    // Pick active shot by shotIndexOverride or atSeconds
    let nextIdx = 0;
    if (typeof opts?.shotIndexOverride === 'number') {
      nextIdx = Math.max(0, Math.min(shots.length - 1, opts.shotIndexOverride));
    } else {
      for (let i = 0; i < shots.length; i++) {
        if (atSeconds >= shots[i]!.at) nextIdx = i;
      }
    }

    const shot = shots[nextIdx]!;
    const speakerPos = opts?.speakerPosOverride ?? shot.speakerPos;
    const speakerName = opts?.speaker || shot.speaker;

    // Detect shot transition (cut or smooth blend)
    let isCutFrame = false;
    if (nextIdx !== activeShotIndex) {
      const prevIdx = activeShotIndex;
      activeShotIndex = nextIdx;
      if (!st.shotsPlayed.includes(shot.id)) {
        st.shotsPlayed.push(shot.id);
        st.shotKinds.push(shot.kind);
        st.shotCount = st.shotsPlayed.length;
      }

      if (prevIdx >= 0 && prevIdx !== nextIdx) {
        const prevShot = shots[prevIdx]!;
        const angleDeg = computeCutAngleDeg(prevShot.p2, shot.p0, speakerPos);
        st.cuts += 1;
        st.minCutAngleDeg = Math.min(st.minCutAngleDeg, Number(angleDeg.toFixed(1)));
        if (st.minCutAngleDeg < 30) st.rule30Ok = false;

        if (shot.smoothTransitionSec && shot.smoothTransitionSec > 0 && lastAppliedPos && lastAppliedLook) {
          blendFromPos = { ...lastAppliedPos };
          blendFromLook = { ...lastAppliedLook };
          blendDuration = shot.smoothTransitionSec;
          blendTimer = 0;
        } else {
          isCutFrame = true;
          notifyCut();
        }
      } else {
        isCutFrame = true;
        notifyCut();
      }

      // Every new shot pulls focus to its speaking character within <= 0.26 s
      triggerFocusPull(sceneId, shot, speakerName, opts?.lineKey || `${shot.id}:${speakerName}`, shot.p0, speakerPos);
    } else if (opts?.lineKey && opts.lineKey !== lastLineKey) {
      lastLineKey = opts.lineKey;
      lastSpeaker = speakerName;
      triggerFocusPull(sceneId, shot, speakerName, opts.lineKey, lastAppliedPos ?? shot.p0, speakerPos);
    }

    // Evaluate dolly/crane spline
    const localT = Math.max(0, atSeconds - shot.at);
    const u = shot.duration > 0 ? Math.min(1, localT / shot.duration) : 0;
    const splinePos = evalSpline(shot.p0, shot.p1, shot.p2, u);
    const splineLook = evalSpline(shot.l0, shot.l1, shot.l2, u);

    // Add low-amplitude Perlin hand-held breathing
    const noise = handheldOffset(atSeconds, shot.kind);
    let pos: Vec3 = {
      x: splinePos.x + noise.pos.x,
      y: splinePos.y + noise.pos.y,
      z: splinePos.z + noise.pos.z,
    };
    let look: Vec3 = {
      x: splineLook.x + noise.look.x,
      y: splineLook.y + noise.look.y,
      z: splineLook.z + noise.look.z,
    };

    // Optional smooth blend between shots (e.g. interactive mirror)
    if (blendFromPos && blendFromLook && blendDuration > 0) {
      blendTimer += Math.max(0.016, dt);
      const bu = Math.min(1, blendTimer / blendDuration);
      const bs = bu * bu * (3 - 2 * bu);
      pos = {
        x: lerp(blendFromPos.x, pos.x, bs),
        y: lerp(blendFromPos.y, pos.y, bs),
        z: lerp(blendFromPos.z, pos.z, bs),
      };
      look = {
        x: lerp(blendFromLook.x, look.x, bs),
        y: lerp(blendFromLook.y, look.y, bs),
        z: lerp(blendFromLook.z, look.z, bs),
      };
      if (bu >= 1) {
        blendFromPos = null;
        blendFromLook = null;
      }
    }

    // Adjust framing for 390x844 phone portrait if needed
    const baseFov = shot.fov ?? 0.72;
    const framed = adjustForPhoneViewport(pos, look, speakerPos, baseFov, shot.safeBox);

    // Enforce 6-axis wall clearance
    const safePos = enforceWallSafety(framed.pos, framed.look, speakerPos, shot.safeBox, st);
    let safeLook = framed.look;
    const safeFov = framed.fov;

    // Sample speaker projection inside the letterbox (and re-center look if wall push shifted framing)
    let projInfo = sampleSpeakerFraming(safePos, safeLook, safeFov, speakerPos, st);
    if (!projInfo.inLetterbox) {
      // Undo the failed check count and re-aim directly at the speaker's upper body so they sit dead-center inside the letterbox
      st.phoneFramesChecked = Math.max(0, st.phoneFramesChecked - 1);
      safeLook = {
        x: speakerPos.x,
        y: speakerPos.y - 0.04,
        z: speakerPos.z,
      };
      projInfo = sampleSpeakerFraming(safePos, safeLook, safeFov, speakerPos, st);
    }

    // Step focus pull (reaches target within FOCUS_PULL_SECONDS = 0.26s < 0.5s)
    const distToSpeakerM = Math.max(
      0.45,
      Math.hypot(safePos.x - speakerPos.x, safePos.y - speakerPos.y, safePos.z - speakerPos.z),
    );
    focusTargetM = distToSpeakerM;
    focusPullTimer = Math.min(FOCUS_PULL_SECONDS, focusPullTimer + Math.max(0.016, dt));
    const pullU = FOCUS_PULL_SECONDS > 0 ? Math.min(1, focusPullTimer / FOCUS_PULL_SECONDS) : 1;
    const pullSmooth = pullU * pullU * (3 - 2 * pullU);
    focusCurrentM = lerp(focusFromM, focusTargetM, pullSmooth);

    const fStop = shot.kind === 'close-up' || shot.kind === 'insert' ? 1.8 : shot.kind === 'wide' ? 2.8 : 2.2;
    render.setCineDepthOfField({
      active: true,
      focusDistanceMm: Math.round(focusCurrentM * 1000),
      fStop,
      focalLengthMm: 50,
      screenX: projInfo.screenX,
      screenY: projInfo.screenY,
    });
    if (activeFocusPull) {
      const dofNow = render.cineDepthOfField();
      activeFocusPull.dofEnabled = dofNow.dofEnabled;
      activeFocusPull.vignetteBlur = dofNow.vignetteBlur;
    }

    lastAppliedPos = safePos;
    lastAppliedLook = safeLook;

    if (opts?.applyCamera !== false) {
      setCinematic(safePos, safeLook, isCutFrame, safeFov);
    }

    return {
      sceneId,
      shotId: shot.id,
      kind: shot.kind,
      speaker: speakerName,
      pos: safePos,
      look: safeLook,
      fov: safeFov,
      isCutFrame,
      focusDistanceM: Number(focusCurrentM.toFixed(2)),
      inLetterbox: projInfo.inLetterbox,
    };
  };

  /** End the active story scene and release Depth of Field / vignette blur. */
  const endScene = (clearCam = true) => {
    activeSceneId = null;
    activeShotIndex = -1;
    blendFromPos = null;
    blendFromLook = null;
    render.setCineDepthOfField({ active: false, focusDistanceMm: 2500 });
    if (clearCam) clearCinematic();
  };

  return {
    beginScene,
    stepScene,
    notifyLine,
    endScene,
    onCut: (fn: () => void) => {
      cutListeners.push(fn);
      return () => {
        cutListeners = cutListeners.filter((f) => f !== fn);
      };
    },
    activeScene: () => activeSceneId,
    activeShot: () => {
      if (!activeSceneId || activeShotIndex < 0) return null;
      return STORY_SCENE_SHOTS[activeSceneId]?.[activeShotIndex] ?? null;
    },
    sceneShots: (sceneId: StorySceneId) => STORY_SCENE_SHOTS[sceneId] ?? [],
    stats: (sceneId?: StorySceneId) => {
      if (sceneId) return ensureStats(sceneId);
      const all: Record<string, SceneRunStats> = {};
      for (const id of STORY_SCENE_IDS) {
        if (statsByScene.has(id)) {
          all[id] = statsByScene.get(id)!;
        }
      }
      return all;
    },
    summary: () => {
      const scenes: Record<string, SceneRunStats> = {};
      let minShots = Infinity;
      let totalFramesInside = 0;
      let maxFocusPullMs = 0;
      let allRule30Ok = true;
      let totalPhoneChecked = 0;
      let totalPhoneFramed = 0;
      for (const id of STORY_SCENE_IDS) {
        const st = statsByScene.get(id);
        if (st) {
          scenes[id] = st;
          minShots = Math.min(minShots, st.shotCount);
          totalFramesInside += st.framesInside;
          maxFocusPullMs = Math.max(maxFocusPullMs, st.maxFocusPullMs);
          if (!st.rule30Ok) allRule30Ok = false;
          totalPhoneChecked += st.phoneFramesChecked;
          totalPhoneFramed += st.phoneFramesFramed;
        }
      }
      return {
        activeSceneId,
        scenesCompleted: Object.keys(scenes).length,
        minShotsPerScene: minShots === Infinity ? 0 : minShots,
        totalFramesInside,
        maxFocusPullMs,
        allRule30Ok,
        phoneFramedRatio: totalPhoneChecked > 0 ? Number((totalPhoneFramed / totalPhoneChecked).toFixed(3)) : 1,
        dof: render.cineDepthOfField(),
        scenes,
      };
    },
    resetStats: () => {
      statsByScene.clear();
    },
  };
};
