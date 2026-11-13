/**
 * Background people look alive (every NPC in all eight chapters; Pierce, his doubles and the creature are not).
 *
 * - Idle style: `createCharacterAvatar` gives each person a variant (still / shift / scan), a random start phase
 *   and a rate, handed out in a golden-ratio sequence so two neighbours never idle in step (`nextIdleStyle`).
 *   The rigs ship one Idle and one SitIdle clip, so the variants differ in rate, start frame and a small
 *   procedural bone layer (breath, weight shift, head scan).
 * - Look-at: inside 4 m the head (and a little neck) turns to Pierce, fully inside ~0.4 s. Rigs that faceTalk
 *   already drives (board, hall, cleaner) keep their look-at there; the layers below still apply.
 * - Reaction: Pierce inside 1.5 m, or `npcStartle()` (the monster beat), plays a short glance, torso turn or
 *   flinch (lean back, the step back of a person who stays put). Walkers only glance.
 * - Bones are written after the clip each frame on top of the evaluated pose (`layer`), never accumulated.
 * Probe: `npcLifeSnapshot()` (look angles, delays, neighbour sync, bind-pose and restart counts).
 */
import * as BABYLON from '@babylonjs/core';

import type { AvatarAnimState, PlayerAvatar } from './playerAvatar';

export type IdleStyle = { variant: 0 | 1 | 2; name: 'still' | 'shift' | 'scan'; phase: number; rate: number };

const VARIANTS: IdleStyle['name'][] = ['still', 'shift', 'scan'];
const RATES = [1, 0.9, 1.08];
const frac = (v: number) => v - Math.floor(v);

let styleCounter = Math.floor(Math.random() * 3);
let phaseSeed = Math.random();

/** Variant cycles, phase walks the golden ratio: consecutive people differ in both. */
export const nextIdleStyle = (): IdleStyle => {
  styleCounter += 1;
  phaseSeed = frac(phaseSeed + 0.381966 + (Math.random() - 0.5) * 0.06);
  const variant = (styleCounter % 3) as 0 | 1 | 2;
  return {
    variant,
    name: VARIANTS[variant],
    phase: phaseSeed,
    rate: Number((RATES[variant] + (Math.random() - 0.5) * 0.05).toFixed(3)),
  };
};

export const LOOK_RANGE = 4;
const LOOK_HOLD_RANGE = 4.5;
export const REACT_RANGE = 1.5;
const REACT_COOLDOWN = 8;
const YAW_CAP = (70 * Math.PI) / 180;
const PITCH_CAP = (28 * Math.PI) / 180;
const LOOK_RATE = 9;
const LOOK_OK = 0.35;
const ACTIVE_RANGE = 30;
const FAR_LAYER_RANGE = 14;

export type ReactionKind = 'glance' | 'turn' | 'flinch';

type Layer = {
  node: BABYLON.TransformNode;
  base: BABYLON.Quaternion;
  written: BABYLON.Quaternion;
  has: boolean;
};

type Entry = {
  id: string;
  avatar: PlayerAvatar;
  style: IdleStyle;
  bound: boolean;
  head: Layer | null;
  neck: Layer | null;
  hips: Layer | null;
  spine: Layer | null;
  spine1: Layer | null;
  spine2: Layer | null;
  clock: number;
  lookYaw: number;
  lookPitch: number;
  scanYaw: number;
  scanPitch: number;
  scanIn: number;
  dist: number;
  looking: boolean;
  nearSince: number;
  lookDelay: number;
  reacted: ReactionKind | null;
  reactT: number;
  reactDur: number;
  reactSide: number;
  cooldown: number;
  wasNear: boolean;
  moving: boolean;
  state: AvatarAnimState | null;
  residual: number;
  bindFrames: number;
};

const entries = new Map<string, Entry>();
const tally = { glance: 0, turn: 0, flinch: 0, startles: 0, lookDelays: [] as number[] };
let lastPierce: { x: number; y: number; z: number } | null = null;

const qDelta = BABYLON.Quaternion.Identity();
const mInv = new BABYLON.Matrix();
const vTmp = new BABYLON.Vector3();
const vLocal = new BABYLON.Vector3();
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const damp = (cur: number, next: number, rate: number, dt: number) => cur + (next - cur) * (1 - Math.exp(-rate * dt));

const makeLayer = (node: BABYLON.TransformNode | null): Layer | null => {
  if (!node) return null;
  if (!node.rotationQuaternion) node.rotationQuaternion = BABYLON.Quaternion.FromEulerVector(node.rotation);
  return { node, base: node.rotationQuaternion.clone(), written: node.rotationQuaternion.clone(), has: false };
};

/**
 * Multiply a delta onto the pose the clip just wrote. When the clip did not rewrite the bone since our last
 * write (a hidden or stopped rig) the bone is put back first, so nothing ever accumulates.
 */
const layer = (l: Layer | null, yaw: number, pitch: number, roll: number) => {
  if (!l) return;
  const q = l.node.rotationQuaternion!;
  if (l.has && q.equals(l.written)) q.copyFrom(l.base);
  else l.base.copyFrom(q);
  if (yaw === 0 && pitch === 0 && roll === 0) {
    l.has = false;
    return;
  }
  BABYLON.Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, qDelta);
  q.multiplyInPlace(qDelta);
  l.written.copyFrom(q);
  l.has = true;
};

const bind = (e: Entry) => {
  if (e.bound || !e.avatar.isReady()) return;
  e.head = makeLayer(e.avatar.findJoint('Head'));
  e.neck = makeLayer(e.avatar.findJoint('Neck'));
  e.hips = makeLayer(e.avatar.findJoint('Hips'));
  e.spine = makeLayer(e.avatar.findJoint('Spine'));
  e.spine1 = makeLayer(e.avatar.findJoint('Spine1'));
  e.spine2 = makeLayer(e.avatar.findJoint('Spine2'));
  e.bound = !!e.head;
};

export const registerNpcLife = (id: string, avatar: PlayerAvatar, style: IdleStyle) => {
  let key = id;
  for (let n = 2; entries.has(key); n += 1) key = `${id}#${n}`;
  const e: Entry = {
    id: key, avatar, style, bound: false,
    head: null, neck: null, hips: null, spine: null, spine1: null, spine2: null,
    clock: Math.random() * 40, lookYaw: 0, lookPitch: 0, scanYaw: 0, scanPitch: 0, scanIn: 1 + Math.random() * 4,
    dist: 99, looking: false, nearSince: -1, lookDelay: -1,
    reacted: null, reactT: 0, reactDur: 0, reactSide: 1, cooldown: Math.random() * 2, wasNear: false,
    moving: false, state: null, residual: 0, bindFrames: 0,
  };
  entries.set(key, e);
  avatar.whenReady(() => bind(e));
};

export const unregisterNpcLife = (avatar: PlayerAvatar) => {
  for (const [key, e] of entries) if (e.avatar === avatar) entries.delete(key);
};

export const clearNpcLife = () => entries.clear();

const startReaction = (e: Entry, kind: ReactionKind, dur: number) => {
  e.reacted = kind;
  e.reactT = 0;
  e.reactDur = dur;
  e.reactSide = Math.random() < 0.5 ? -1 : 1;
  tally[kind] += 1;
};

/** The monster beat: everyone on screen flinches and looks. `from` is where it happened (default Pierce). */
export const npcStartle = (from?: { x: number; z: number }) => {
  tally.startles += 1;
  const at = from ?? lastPierce;
  for (const e of entries.values()) {
    if (!e.bound || !e.state?.shown || e.reacted) continue;
    if (at) {
      const p = e.avatar.group.getAbsolutePosition();
      if (Math.hypot(p.x - at.x, p.z - at.z) > 40) continue;
    }
    startReaction(e, e.moving ? 'glance' : 'flinch', 1.5 + Math.random() * 0.5);
    e.cooldown = REACT_COOLDOWN;
  }
};

const worldYawTo = (e: Entry, tx: number, ty: number, tz: number) => {
  const head = e.head!.node.getAbsolutePosition();
  const model = e.avatar.group.getChildTransformNodes(true)[0] ?? e.avatar.group;
  model.getWorldMatrix().invertToRef(mInv);
  vTmp.set(tx - head.x, ty - head.y, tz - head.z);
  BABYLON.Vector3.TransformNormalToRef(vTmp, mInv, vLocal);
  const flat = Math.hypot(vLocal.x, vLocal.z) || 1;
  const yaw = Math.atan2(vLocal.x, vLocal.z);
  const pitch = -Math.atan2(vLocal.y, flat);
  return { yaw, pitch, dist: Math.hypot(vTmp.x, vTmp.y, vTmp.z) };
};

const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/** Per frame (render loop, before the animation pass): who looks, reacts, scans. */
export const updateNpcLife = (dt: number, pierce: { x: number; y: number; z: number } | null) => {
  if (dt <= 0) return;
  lastPierce = pierce;
  const now = performance.now() / 1000;
  for (const e of entries.values()) {
    if (!e.bound) {
      bind(e);
      if (!e.bound) continue;
    }
    const state = e.avatar.animState();
    e.state = state;
    if (state.ready && state.shown && !state.playing && e.avatar.group.isEnabled()) e.bindFrames += 1;
    if (!state.shown || !e.avatar.group.isEnabled()) continue;
    e.clock += dt;
    e.cooldown = Math.max(0, e.cooldown - dt);
    e.moving = state.clip === 'walk' || state.clip === 'run' || state.clip === 'pistolwalk';

    let tYaw = 0;
    let tPitch = 0;
    let near = false;
    if (pierce) {
      const p = e.avatar.group.getAbsolutePosition();
      e.dist = Math.hypot(p.x - pierce.x, p.z - pierce.z);
      near = e.dist <= (e.looking ? LOOK_HOLD_RANGE : LOOK_RANGE);
    } else e.dist = 99;
    if (e.dist > ACTIVE_RANGE) continue;

    if (near && pierce) {
      const aim = worldYawTo(e, pierce.x, pierce.y + 1.55, pierce.z);
      tYaw = clamp(aim.yaw, -YAW_CAP, YAW_CAP);
      tPitch = clamp(aim.pitch, -PITCH_CAP, PITCH_CAP);
      if (!e.looking) {
        e.looking = true;
        e.nearSince = now;
        e.lookDelay = -1;
      }
    } else if (e.looking) {
      e.looking = false;
      e.nearSince = -1;
    } else if (e.style.variant === 2 && !e.moving) {
      // Scanners look around the room now and then.
      e.scanIn -= dt;
      if (e.scanIn <= 0) {
        e.scanIn = 2.5 + Math.random() * 4.5;
        e.scanYaw = (Math.random() - 0.5) * 1.1;
        e.scanPitch = (Math.random() - 0.4) * 0.18;
      }
      tYaw = e.scanYaw;
      tPitch = e.scanPitch;
    }

    const rate = e.reacted ? LOOK_RATE * 1.8 : LOOK_RATE;
    e.lookYaw = damp(e.lookYaw, tYaw, rate, dt);
    e.lookPitch = damp(e.lookPitch, tPitch, rate, dt);

    if (e.looking) {
      const residual = Math.abs(wrap(tYaw - e.lookYaw));
      e.residual = residual;
      if (e.lookDelay < 0 && residual < LOOK_OK) {
        e.lookDelay = now - e.nearSince;
        tally.lookDelays.push(Number(e.lookDelay.toFixed(2)));
        if (tally.lookDelays.length > 80) tally.lookDelays.shift();
      }
    }

    // Reactions: Pierce passes within 1.5 m (rising edge, cooldown), or a startle.
    const close = !!pierce && e.dist <= REACT_RANGE;
    if (close && !e.wasNear && !e.reacted && e.cooldown <= 0) {
      const sitting = state.clip === 'sit' || state.clip === 'sittalk';
      const kind: ReactionKind = e.moving ? 'glance'
        : sitting ? (Math.random() < 0.5 ? 'glance' : 'turn')
          : (['glance', 'turn', 'flinch'] as const)[Math.floor(Math.random() * 3)];
      startReaction(e, kind, kind === 'glance' ? 1.1 : 1.6);
      e.cooldown = REACT_COOLDOWN;
    }
    e.wasNear = close;
    if (e.reacted) {
      e.reactT += dt;
      if (e.reactT >= e.reactDur) e.reacted = null;
    }
  }
};

/** Envelope 0..1 for a reaction: 0.18 s in, hold, 0.5 s out. */
const envelope = (e: Entry) => {
  if (!e.reacted) return 0;
  const t = e.reactT;
  const out = e.reactDur - t;
  return clamp(Math.min(t / 0.18, out / 0.5, 1), 0, 1);
};

/** After the clips each frame (`scene.onAfterAnimationsObservable`, after faceTalk's `applyFaces`). */
export const applyNpcLife = (isFaceDriven: (avatar: PlayerAvatar) => boolean) => {
  for (const e of entries.values()) {
    if (!e.bound || !e.state?.shown || e.dist > ACTIVE_RANGE) continue;
    const idleLike = !e.moving && !!e.state.clip && e.state.clip !== 'jump';
    const far = e.dist > FAR_LAYER_RANGE;
    const t = e.clock;
    const ph = e.style.phase * Math.PI * 2;
    const env = envelope(e);

    // Idle personality (small bone layers).
    let breath = 0;
    let hipRoll = 0;
    let headRoll = 0;
    if (idleLike && !far) {
      breath = 0.012 * Math.sin(t * 1.55 + ph);
      if (e.style.variant === 1) {
        hipRoll = 0.04 * Math.sin(t * 0.7 + ph);
        headRoll = 0.03 * Math.sin(t * 0.7 + ph + 1.1);
      }
    }

    // Reaction layers.
    let spineYaw = 0;
    let lean = 0;
    let extraHeadYaw = 0;
    if (env > 0 && e.reacted) {
      if (e.reacted === 'turn') spineYaw = e.lookYaw * 0.5 * env;
      if (e.reacted === 'flinch') {
        lean = -0.16 * env;
        hipRoll += 0.05 * env * e.reactSide;
        extraHeadYaw = 0.12 * env * e.reactSide;
      }
      if (e.reacted === 'glance') extraHeadYaw = e.lookYaw * 0.25 * env;
    }

    const faceDriven = isFaceDriven(e.avatar);
    const headYaw = faceDriven ? 0 : e.lookYaw * 0.55 + extraHeadYaw;
    const headPitch = faceDriven ? 0 : e.lookPitch * 0.55;
    layer(e.head, headYaw, headPitch + (lean ? -lean * 0.5 : 0), headRoll);
    layer(e.neck, faceDriven ? 0 : e.lookYaw * 0.4, faceDriven ? 0 : e.lookPitch * 0.3, 0);
    layer(e.hips, 0, lean * 0.3, hipRoll);
    layer(e.spine, spineYaw * 0.3, lean * 0.3 + breath * 0.3, -hipRoll * 0.5);
    layer(e.spine1, spineYaw * 0.35, lean * 0.35 + breath, 0);
    layer(e.spine2, spineYaw * 0.35, lean * 0.35 + breath * 0.6, 0);
  }
};

const frameOf = (e: Entry) => {
  const at = e.avatar.group.getAbsolutePosition();
  return {
  id: e.id,
  x: Number(at.x.toFixed(2)),
  z: Number(at.z.toFixed(2)),
  variant: e.style.name,
  rate: e.style.rate,
  startPhase: Number(e.style.phase.toFixed(3)),
  phase: e.state ? Number(e.state.phase.toFixed(3)) : -1,
  clip: e.state?.clip ?? null,
  dist: Number(e.dist.toFixed(2)),
  looking: e.looking,
  lookYaw: Number(e.lookYaw.toFixed(3)),
  lookPitch: Number(e.lookPitch.toFixed(3)),
  /** Remaining head-yaw error to Pierce (radians) while he is inside 4 m. */
  lookError: e.looking ? Number(e.residual.toFixed(3)) : null,
  lookDelay: e.lookDelay,
  reaction: e.reacted,
  moving: e.moving,
  shown: !!e.state?.shown,
  reshows: e.state?.reshows ?? 0,
  restarts: e.state?.restarts ?? 0,
  bindFrames: e.bindFrames,
  };
};

export const npcLifeSnapshot = () => {
  const people = [...entries.values()].filter((e) => e.bound).map(frameOf);
  const live = people.filter((p) => p.shown && !p.moving && p.clip && p.phase >= 0);
  const pos = new Map<string, { x: number; z: number }>();
  for (const e of entries.values()) {
    const p = e.avatar.group.getAbsolutePosition();
    pos.set(e.id, { x: p.x, z: p.z });
  }
  let neighbourPairs = 0;
  let syncedPairs = 0;
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const a = pos.get(live[i].id)!;
      const b = pos.get(live[j].id)!;
      if (Math.hypot(a.x - b.x, a.z - b.z) > 3) continue;
      neighbourPairs += 1;
      const d = Math.abs(live[i].phase - live[j].phase);
      const same = live[i].clip === live[j].clip && live[i].variant === live[j].variant;
      if (same && Math.min(d, 1 - d) < 0.06) syncedPairs += 1;
    }
  }
  const variants: Record<string, number> = { still: 0, shift: 0, scan: 0 };
  for (const p of people) variants[p.variant] += 1;
  const near = people.filter((p) => p.dist <= LOOK_RANGE && p.shown);
  const delays = tally.lookDelays;
  return {
    count: people.length,
    shown: people.filter((p) => p.shown).length,
    variants,
    variantKinds: Object.values(variants).filter((n) => n > 0).length,
    neighbourPairs,
    syncedPairs,
    near: near.length,
    nearLooking: near.filter((p) => p.looking && p.lookError !== null && p.lookError < LOOK_OK).length,
    maxLookError: near.reduce((m, p) => Math.max(m, p.lookError ?? 0), 0),
    lookDelays: delays.slice(-20),
    maxLookDelay: delays.length ? Math.max(...delays) : 0,
    reactions: { glance: tally.glance, turn: tally.turn, flinch: tally.flinch, startles: tally.startles },
    bindFrames: people.reduce((n, p) => n + p.bindFrames, 0),
    restarts: people.reduce((n, p) => n + p.restarts, 0),
    reshows: people.reduce((n, p) => n + p.reshows, 0),
    people: people.slice(0, 60),
  };
};

export const resetNpcLifeStats = () => {
  tally.glance = 0;
  tally.turn = 0;
  tally.flinch = 0;
  tally.startles = 0;
  tally.lookDelays.length = 0;
  for (const e of entries.values()) e.bindFrames = 0;
};
