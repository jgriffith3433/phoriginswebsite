/**
 * On-screen speakers talk with a face: analyser-driven lip flap, blinks, head/eye
 * look-at, and upper-body dialogue gestures. Mixamo rigs rarely ship a Jaw bone or
 * mouth morphs, so the mouth is Head pitch (+ Jaw when present) driven from the
 * live voice meter in sfxMix. Gestures prefer Gen clips (GestureExplain / Lean /
 * Cross / Nod / Shake / Point baked onto the seat GLB via tools/bakeLocoClips.mjs);
 * when a clip is missing the same moves are procedural bone layers. Phone: lip-sync
 * + gaze stay on; cost stays under ~2 ms.
 */
import * as BABYLON from '@babylonjs/core';

import type { PlayerAvatar } from './playerAvatar';
import { sampleVoiceMeter } from './sfxMix';

export type FaceGesture =
  | 'explain'
  | 'lean'
  | 'cross'
  | 'nod'
  | 'shake'
  | 'point';

const GESTURES: FaceGesture[] = ['explain', 'lean', 'cross', 'nod', 'shake', 'point'];

/** Board seats keep their own gesture flavour so the meeting does not look like one carousel. */
const GESTURE_PREF: Record<string, FaceGesture[]> = {
  'chair-head': ['nod', 'lean', 'explain', 'point'], // Pierce: terse, still
  'chair-s-1': ['explain', 'lean', 'nod', 'point'], // Voss: open-hand
  'chair-n-2': ['cross', 'lean', 'shake', 'point'], // Hale: steel
  'chair-s-3': ['nod', 'point', 'shake', 'lean'], // Lang: clipped calendar
};

export type FaceSpeakerSnapshot = {
  id: string;
  speaking: boolean;
  mouth: number;
  shape: 'closed' | 'open' | 'wide' | 'round';
  blinks: number;
  lookYaw: number;
  lookPitch: number;
  gesture: FaceGesture | null;
  gestures: FaceGesture[];
};

type BonePose = {
  node: BABYLON.TransformNode;
  rest: BABYLON.Quaternion;
};

type FaceRig = {
  id: string;
  avatar: PlayerAvatar;
  ready: boolean;
  jaw: BonePose | null;
  head: BonePose | null;
  neck: BonePose | null;
  spine: BonePose | null;
  spine1: BonePose | null;
  leftArm: BonePose | null;
  rightArm: BonePose | null;
  leftFore: BonePose | null;
  rightFore: BonePose | null;
  leftEye: BonePose | null;
  rightEye: BonePose | null;
  mouth: number;
  shape: FaceSpeakerSnapshot['shape'];
  blinks: number;
  blinkIn: number;
  blinkT: number;
  lookYaw: number;
  lookPitch: number;
  gesture: FaceGesture | null;
  gestureT: number;
  gestureAge: number;
  gesturesSeen: FaceGesture[];
  /** True while a baked Gesture* AnimationGroup is driving the upper body. */
  gestureClip: boolean;
  speaking: boolean;
  speakUrl: string;
};

const gestureClipKeyword = (g: FaceGesture): string =>
  `gesture${g.charAt(0).toUpperCase()}${g.slice(1)}`;

const HEAD_YAW_CAP = (60 * Math.PI) / 180;
const HEAD_PITCH_CAP = (28 * Math.PI) / 180;
const MOUTH_MAX = 0.22;
const BLINK_MIN = 2;
const BLINK_MAX = 6;
const GESTURE_HOLD = 2.1;
const GESTURE_BLEND = 0.35;

const qScratch = BABYLON.Quaternion.Identity();
const qDelta = BABYLON.Quaternion.Identity();
const eulerScratch = new BABYLON.Vector3();

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const damp = (cur: number, next: number, rate: number, dt: number) =>
  cur + (next - cur) * (1 - Math.exp(-rate * dt));

const poseOf = (avatar: PlayerAvatar, suffix: string): BonePose | null => {
  const node = avatar.findJoint(suffix);
  if (!node) return null;
  if (!node.rotationQuaternion) {
    node.rotationQuaternion = BABYLON.Quaternion.FromEulerVector(node.rotation);
  }
  return { node, rest: node.rotationQuaternion.clone() };
};

const applyLocal = (pose: BonePose | null, yaw: number, pitch: number, roll: number) => {
  if (!pose) return;
  BABYLON.Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, qDelta);
  pose.rest.multiplyToRef(qDelta, qScratch);
  pose.node.rotationQuaternion!.copyFrom(qScratch);
};

const restore = (pose: BonePose | null) => {
  if (!pose?.node.rotationQuaternion) return;
  pose.node.rotationQuaternion.copyFrom(pose.rest);
};

const gestureWeights = (g: FaceGesture, u: number) => {
  // u 0..1 envelope (ease in/out of the hold).
  const e = u < 0.2 ? u / 0.2 : u > 0.8 ? (1 - u) / 0.2 : 1;
  switch (g) {
    case 'explain':
      return { spine: 0.04 * e, lArm: -0.55 * e, rArm: 0.55 * e, lFore: -0.35 * e, rFore: 0.35 * e, headY: 0, headP: 0.02 * e };
    case 'lean':
      return { spine: 0.18 * e, lArm: -0.12 * e, rArm: 0.12 * e, lFore: 0, rFore: 0, headY: 0, headP: 0.08 * e };
    case 'cross':
      return { spine: 0.02 * e, lArm: 0.7 * e, rArm: -0.7 * e, lFore: 1.1 * e, rFore: -1.1 * e, headY: 0, headP: -0.02 * e };
    case 'nod':
      return { spine: 0, lArm: 0, rArm: 0, lFore: 0, rFore: 0, headY: 0, headP: Math.sin(u * Math.PI * 2) * 0.18 * e };
    case 'shake':
      return { spine: 0, lArm: 0, rArm: 0, lFore: 0, rFore: 0, headY: Math.sin(u * Math.PI * 3) * 0.22 * e, headP: 0 };
    case 'point':
      return { spine: 0.05 * e, lArm: 0.1 * e, rArm: -0.95 * e, lFore: 0, rFore: -0.2 * e, headY: -0.08 * e, headP: 0.04 * e };
    default:
      return { spine: 0, lArm: 0, rArm: 0, lFore: 0, rFore: 0, headY: 0, headP: 0 };
  }
};

const rigs = new Map<string, FaceRig>();
let activeSpeakerId: string | null = null;
let activeSpeakerUrl = '';
let pierceId = 'chair-head';
let gestureCursor = 0;
let lastUpdateMs = 0;
let enabled = true;
let mouthOpenEvents = 0;
let lookTurnEvents = 0;
/** Wall-clock ms: keep the bound speaker talking (procedural flap) until the line hold ends. */
let speakUntil = 0;

const bindBones = (rig: FaceRig) => {
  if (!rig.avatar.isReady()) return;
  rig.jaw = poseOf(rig.avatar, 'Jaw') ?? poseOf(rig.avatar, 'jaw');
  rig.head = poseOf(rig.avatar, 'Head');
  rig.neck = poseOf(rig.avatar, 'Neck');
  rig.spine = poseOf(rig.avatar, 'Spine2') ?? poseOf(rig.avatar, 'Spine1') ?? poseOf(rig.avatar, 'Spine');
  rig.spine1 = poseOf(rig.avatar, 'Spine1') ?? poseOf(rig.avatar, 'Spine');
  rig.leftArm = poseOf(rig.avatar, 'LeftArm');
  rig.rightArm = poseOf(rig.avatar, 'RightArm');
  rig.leftFore = poseOf(rig.avatar, 'LeftForeArm');
  rig.rightFore = poseOf(rig.avatar, 'RightForeArm');
  rig.leftEye = poseOf(rig.avatar, 'LeftEye');
  rig.rightEye = poseOf(rig.avatar, 'RightEye');
  rig.ready = !!(rig.head || rig.jaw);
  rig.blinkIn = BLINK_MIN + Math.random() * (BLINK_MAX - BLINK_MIN);
};

const ensure = (id: string, avatar: PlayerAvatar): FaceRig => {
  let rig = rigs.get(id);
  if (rig && rig.avatar === avatar) {
    if (!rig.ready) bindBones(rig);
    return rig;
  }
  if (rig) rigs.delete(id);
  rig = {
    id,
    avatar,
    ready: false,
    jaw: null,
    head: null,
    neck: null,
    spine: null,
    spine1: null,
    leftArm: null,
    rightArm: null,
    leftFore: null,
    rightFore: null,
    leftEye: null,
    rightEye: null,
    mouth: 0,
    shape: 'closed',
    blinks: 0,
    blinkIn: BLINK_MIN + Math.random() * (BLINK_MAX - BLINK_MIN),
    blinkT: 0,
    lookYaw: 0,
    lookPitch: 0,
    gesture: null,
    gestureT: 0,
    gestureAge: 0,
    gesturesSeen: [],
    gestureClip: false,
    speaking: false,
    speakUrl: '',
  };
  rigs.set(id, rig);
  avatar.whenReady(() => bindBones(rig!));
  if (avatar.isReady()) bindBones(rig);
  return rig;
};

/** Register (or refresh) a character that can speak / look / blink. */
export const registerFace = (id: string, avatar: PlayerAvatar) => {
  ensure(id, avatar);
};

/** True when faceTalk drives this rig's head (npcLife then leaves look-at to it). */
export const isFaceAvatar = (avatar: PlayerAvatar) => {
  for (const rig of rigs.values()) if (rig.avatar === avatar) return true;
  return false;
};

export const unregisterFace = (id: string) => {
  const rig = rigs.get(id);
  if (!rig) return;
  restore(rig.jaw);
  restore(rig.head);
  restore(rig.neck);
  restore(rig.spine);
  restore(rig.spine1);
  restore(rig.leftArm);
  restore(rig.rightArm);
  restore(rig.leftFore);
  restore(rig.rightFore);
  restore(rig.leftEye);
  restore(rig.rightEye);
  rigs.delete(id);
  if (activeSpeakerId === id) {
    activeSpeakerId = null;
    activeSpeakerUrl = '';
  }
};

export const clearFaces = () => {
  for (const id of [...rigs.keys()]) unregisterFace(id);
};

/** Cutscene / bark: this actor is the one whose voice is about to (or just) sound. */
export const faceSpeak = (actorId: string, url = '', holdSeconds = 8) => {
  activeSpeakerId = actorId;
  activeSpeakerUrl = url;
  speakUntil = performance.now() + Math.max(1.2, holdSeconds) * 1000;
  const rig = rigs.get(actorId);
  if (!rig) return;
  rig.speaking = true;
  rig.speakUrl = url;
  // Kick a fresh gesture when a new line starts.
  if (!rig.gesture || rig.gestureAge > 0.4) {
    startGesture(rig, pickGesture(actorId));
  }
};

const startGesture = (rig: FaceRig, next: FaceGesture) => {
  rig.gesture = next;
  rig.gestureT = 0;
  rig.gestureAge = 0;
  if (!rig.gesturesSeen.includes(next)) rig.gesturesSeen.push(next);
  // Prefer a baked upper-body clip when the seat GLB has it; else procedural.
  // Always clear a prior overlay first so a partial bake cannot leave a stale clip under arms.
  rig.avatar.stopFaceGesture?.();
  const played = !!rig.avatar.playFaceGesture?.(gestureClipKeyword(next), () => {
    // Clip finished before GESTURE_HOLD: drop the flag so procedural (or the next pick) can run.
    if (rig.gesture === next) rig.gestureClip = false;
  });
  rig.gestureClip = played;
};

const pickGesture = (id: string): FaceGesture => {
  const pref = GESTURE_PREF[id] ?? GESTURES;
  const next = pref[gestureCursor % pref.length]!;
  gestureCursor += 1;
  return next;
};

export const faceSilence = (actorId?: string) => {
  if (actorId && activeSpeakerId && actorId !== activeSpeakerId) return;
  const id = actorId ?? activeSpeakerId;
  if (id) {
    const rig = rigs.get(id);
    if (rig) {
      rig.speaking = false;
      rig.speakUrl = '';
    }
  }
  if (!actorId || actorId === activeSpeakerId) {
    activeSpeakerId = null;
    activeSpeakerUrl = '';
    speakUntil = 0;
  }
};

export const setPierceFaceId = (id: string) => {
  pierceId = id;
};

export const setFaceTalkEnabled = (on: boolean) => {
  enabled = on;
};

const worldOf = (rig: FaceRig): BABYLON.Vector3 => {
  const head = rig.head?.node ?? rig.avatar.group;
  return head.getAbsolutePosition();
};

const lookToward = (
  from: BABYLON.Vector3,
  to: BABYLON.Vector3,
  facingYaw: number,
): { yaw: number; pitch: number } => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  const worldYaw = Math.atan2(dx, dz);
  let yaw = worldYaw - facingYaw;
  while (yaw > Math.PI) yaw -= Math.PI * 2;
  while (yaw < -Math.PI) yaw += Math.PI * 2;
  yaw = clamp(yaw, -HEAD_YAW_CAP, HEAD_YAW_CAP);
  const pitch = clamp(-Math.asin(clamp(dy / dist, -1, 1)), -HEAD_PITCH_CAP, HEAD_PITCH_CAP);
  return { yaw, pitch };
};

const facingOf = (rig: FaceRig) => {
  // Capsule / group yaw: Mixamo faces +Z; modelRoot often adds PI — use the group world matrix.
  const forward = rig.avatar.group.forward;
  return Math.atan2(forward.x, forward.z);
};

/**
 * Advance face state (mouth, blinks, look, gestures). Bone writes happen in
 * `applyFaces` after Mixamo clips, or the sit/talk tracks wipe the mouth.
 * Returns approximate CPU ms for the playtest.
 */
export const updateFaces = (
  dt: number,
  opts: {
    pierce?: { x: number; y: number; z: number } | null;
    /** During the board cutscene every seat stays active. */
    boardMeeting?: boolean;
    lowTier?: boolean;
  } = {},
): number => {
  const t0 = performance.now();
  if (!enabled || dt <= 0) {
    lastUpdateMs = 0;
    return 0;
  }
  const meter = sampleVoiceMeter();
  const held = !!activeSpeakerId && performance.now() < speakUntil;
  if (activeSpeakerId && !held && !meter.speaking) {
    faceSilence(activeSpeakerId);
  }
  const speakingId = (meter.speaking || held) ? activeSpeakerId : null;

  // Amplitude → mouth; spectral centroid → open / wide / round.
  // Missing clips / stubs still flap while the line is held so the board reads as talking.
  let mouthTarget = 0;
  let shape: FaceSpeakerSnapshot['shape'] = 'closed';
  if (speakingId) {
    if (meter.speaking && meter.amp > 0.02) {
      mouthTarget = clamp(meter.amp * 1.6, 0, 1);
      if (meter.centroid < 0.28) shape = 'open';
      else if (meter.centroid < 0.55) shape = 'wide';
      else shape = 'round';
    } else {
      const t = performance.now() * 0.001;
      mouthTarget = clamp(0.32 + 0.38 * Math.abs(Math.sin(t * 11.3)) + 0.18 * Math.abs(Math.sin(t * 17.1)), 0, 1);
      shape = mouthTarget > 0.55 ? 'open' : mouthTarget > 0.35 ? 'wide' : 'round';
    }
  }

  const piercePos = opts.pierce
    ? new BABYLON.Vector3(opts.pierce.x, opts.pierce.y, opts.pierce.z)
    : null;
  const speakerRig = speakingId ? rigs.get(speakingId) : null;
  const speakerPos = speakerRig ? worldOf(speakerRig) : null;

  let i = 0;
  for (const rig of rigs.values()) {
    if (!rig.ready) {
      if (rig.avatar.isReady()) bindBones(rig);
      if (!rig.ready) continue;
    }
    i += 1;
    // Phone budget: always update the speaker; others every other one when many.
    if (opts.lowTier && !opts.boardMeeting && speakingId && rig.id !== speakingId && (i & 1) === 0) {
      continue;
    }

    const isSpeaker = !!speakingId && rig.id === speakingId;
    rig.speaking = isSpeaker;
    if (isSpeaker) {
      const wasClosed = rig.mouth < 0.08;
      rig.mouth = damp(rig.mouth, mouthTarget, 28, dt);
      if (wasClosed && rig.mouth >= 0.12) mouthOpenEvents += 1;
      rig.shape = mouthTarget > 0.05 ? shape : 'closed';
      rig.speakUrl = activeSpeakerUrl || meter.url || rig.speakUrl;
      // Rotate gestures while a line is long enough.
      rig.gestureAge += dt;
      if (!rig.gesture || rig.gestureAge >= GESTURE_HOLD) {
        startGesture(rig, pickGesture(rig.id));
      } else {
        rig.gestureT = Math.min(1, rig.gestureT + dt / GESTURE_BLEND);
      }
    } else {
      rig.mouth = damp(rig.mouth, 0, 18, dt);
      if (rig.mouth < 0.02) {
        rig.mouth = 0;
        rig.shape = 'closed';
      }
      if (rig.gesture) {
        rig.gestureT = Math.max(0, rig.gestureT - dt / GESTURE_BLEND);
        if (rig.gestureT <= 0) {
          if (rig.gestureClip) rig.avatar.stopFaceGesture?.();
          rig.gesture = null;
          rig.gestureClip = false;
        }
      }
    }

    // Blinks every 2–6 s.
    if (rig.blinkT > 0) {
      rig.blinkT -= dt;
    } else {
      rig.blinkIn -= dt;
      if (rig.blinkIn <= 0) {
        rig.blinks += 1;
        rig.blinkT = 0.12;
        rig.blinkIn = BLINK_MIN + Math.random() * (BLINK_MAX - BLINK_MIN);
      }
    }

    // Look-at: speaker when someone talks, else Pierce (listeners) / current speaker seat.
    let look = { yaw: 0, pitch: 0 };
    if (isSpeaker && piercePos) {
      look = lookToward(worldOf(rig), piercePos, facingOf(rig));
    } else if (speakerPos && !isSpeaker) {
      look = lookToward(worldOf(rig), speakerPos, facingOf(rig));
    } else if (piercePos && rig.id !== pierceId) {
      look = lookToward(worldOf(rig), piercePos, facingOf(rig));
    }
    const hadLook = Math.abs(rig.lookYaw) > 0.08;
    rig.lookYaw = damp(rig.lookYaw, look.yaw, 8, dt);
    rig.lookPitch = damp(rig.lookPitch, look.pitch, 8, dt);
    if (!hadLook && Math.abs(rig.lookYaw) > 0.08) lookTurnEvents += 1;
  }

  lastUpdateMs = performance.now() - t0;
  return lastUpdateMs;
};

/**
 * Layer mouth / look / gesture on top of the just-evaluated sit/talk clip.
 * Call from `scene.onAfterAnimationsObservable`.
 */
export const applyFaces = (): number => {
  if (!enabled) return 0;
  const t0 = performance.now();
  for (const rig of rigs.values()) {
    if (!rig.ready) continue;

    // Additive on the live clip pose: sample current as the base, then multiply deltas.
    const capture = (pose: BonePose | null) => {
      if (!pose?.node.rotationQuaternion) return;
      pose.rest.copyFrom(pose.node.rotationQuaternion);
    };
    capture(rig.jaw);
    capture(rig.head);
    capture(rig.neck);
    capture(rig.spine);
    capture(rig.spine1);
    capture(rig.leftArm);
    capture(rig.rightArm);
    capture(rig.leftFore);
    capture(rig.rightFore);

    const mouth = rig.mouth;
    const open = mouth * MOUTH_MAX;
    const wide = rig.shape === 'wide' ? mouth * 0.06 : 0;
    const round = rig.shape === 'round' ? mouth * 0.04 : 0;
    if (rig.jaw) {
      applyLocal(rig.jaw, wide * 0.2, open + round, 0);
      applyLocal(rig.head, rig.lookYaw * 0.55, rig.lookPitch * 0.55, 0);
    } else {
      // No Jaw: Head pitch doubles as the lip flap (reads at boardroom distance).
      applyLocal(rig.head, rig.lookYaw * 0.55 + wide, rig.lookPitch * 0.55 + open * 0.85 + round, 0);
    }
    applyLocal(rig.neck, rig.lookYaw * 0.45, rig.lookPitch * 0.35, 0);

    if (rig.blinkT > 0) {
      const close = Math.sin((1 - Math.max(0, rig.blinkT) / 0.12) * Math.PI);
      if (rig.leftEye || rig.rightEye) {
        const scale = 1 - close * 0.85;
        if (rig.leftEye) rig.leftEye.node.scaling.y = scale;
        if (rig.rightEye) rig.rightEye.node.scaling.y = scale;
      } else if (rig.head?.node.rotationQuaternion) {
        // Mixamo rarely has eyelid bones: a short head pitch still reads as a blink at the table.
        BABYLON.Quaternion.RotationYawPitchRollToRef(0, close * 0.08, 0, qDelta);
        rig.head.node.rotationQuaternion.multiplyInPlace(qDelta);
      }
    } else {
      if (rig.leftEye) rig.leftEye.node.scaling.y = 1;
      if (rig.rightEye) rig.rightEye.node.scaling.y = 1;
    }

    // Baked Gesture* clips already own the upper body; only layer procedural when missing.
    if (rig.gesture && rig.gestureT > 0 && !rig.gestureClip) {
      const w = gestureWeights(rig.gesture, clamp(rig.gestureAge / GESTURE_HOLD, 0, 1));
      const t = rig.gestureT;
      applyLocal(rig.spine, 0, w.spine * t, 0);
      applyLocal(rig.spine1, 0, w.spine * 0.6 * t, 0);
      applyLocal(rig.leftArm, 0, 0, w.lArm * t);
      applyLocal(rig.rightArm, 0, 0, w.rArm * t);
      applyLocal(rig.leftFore, 0, 0, w.lFore * t);
      applyLocal(rig.rightFore, 0, 0, w.rFore * t);
      if (rig.head?.node.rotationQuaternion) {
        BABYLON.Quaternion.RotationYawPitchRollToRef(w.headY * t, w.headP * t, 0, qDelta);
        rig.head.node.rotationQuaternion.multiplyInPlace(qDelta);
      }
    }
  }
  const ms = performance.now() - t0;
  lastUpdateMs += ms;
  return ms;
};

export const facesSnapshot = (): {
  speaker: string | null;
  speakers: FaceSpeakerSnapshot[];
  gestures: FaceGesture[];
  blinks: number;
  mouthEvents: number;
  lookTurns: number;
  updateMs: number;
} => {
  const speakers: FaceSpeakerSnapshot[] = [];
  const allGestures = new Set<FaceGesture>();
  let blinks = 0;
  for (const rig of rigs.values()) {
    for (const g of rig.gesturesSeen) allGestures.add(g);
    blinks += rig.blinks;
    speakers.push({
      id: rig.id,
      speaking: rig.speaking,
      mouth: Number(rig.mouth.toFixed(3)),
      shape: rig.shape,
      blinks: rig.blinks,
      lookYaw: Number(rig.lookYaw.toFixed(3)),
      lookPitch: Number(rig.lookPitch.toFixed(3)),
      gesture: rig.gesture,
      gestures: [...rig.gesturesSeen],
    });
  }
  return {
    speaker: activeSpeakerId,
    speakers,
    gestures: [...allGestures],
    blinks,
    mouthEvents: mouthOpenEvents,
    lookTurns: lookTurnEvents,
    updateMs: Number(lastUpdateMs.toFixed(3)),
  };
};

/** Playtest / probe: reset counters without dropping registrations. */
export const resetFaceStats = () => {
  for (const rig of rigs.values()) {
    rig.blinks = 0;
    rig.gesturesSeen = [];
    rig.mouth = 0;
  }
  gestureCursor = 0;
  mouthOpenEvents = 0;
  lookTurnEvents = 0;
};

// Keep eulerScratch referenced so tree-shaking does not drop the import pattern.
void eulerScratch;
