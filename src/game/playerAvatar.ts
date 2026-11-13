import * as BABYLON from '@babylonjs/core';

import {
  clipPlayRange,
  clipTail,
  clipFps,
  loadClipTrims,
  lookupClipTrim,
  type ClipTrimsFile,
} from './clipTrims';
import { JUMP_KEYS, RUN_OFF_MPS, RUN_ON_MPS, strideRatio } from './stride';
import { PLAYER_ASSET_ID, getAssetLibrary, jointSuffix, loadGlbByAssetId, resolveModelPath } from './modelLoader';

export { JUMP_KEYS, STRIDE_MPS, strideRatio } from './stride';

export type PlayerAvatar = {
  group: BABYLON.TransformNode;
  setLocomotion: (moving: boolean, grounded: boolean) => void;
  setPace: (rate: number) => void;
  /**
   * Ground speed in m/s the walk/run loop should match so the planted foot does not slide.
   * null leaves the loop at the speed it was started with (cutscenes pass their own rate).
   */
  setStride: (metresPerSecond: number | null) => void;
  /**
   * Hold the jump clip at a pose that follows the physics instead of the clip's own clock:
   * 0 crouch, 1 takeoff, 2 apex, 3 touchdown, 4 settled. null releases it.
   */
  setJumpPose: (pose: number | null) => void;
  /** What the rig is playing now, for the playtest's animation trace. */
  locomotion: () => { clip: string | null; rate: number; cinematic: boolean; phase?: string };
  setSprinting: (sprinting: boolean) => void;
  setArmed: (armed: boolean) => void;
  playClip: (keyword: string, loop?: boolean, speedRatio?: number, onEnded?: () => void) => boolean;
  /**
   * Upper-body dialogue gesture (GestureExplain / Lean / Cross / Nod / Shake / Point) layered
   * over the current sit/talk/idle without locking locomotion. Returns false when the clip is
   * missing — callers fall back to procedural bone layers in faceTalk.
   */
  playFaceGesture: (keyword: string, onEnded?: () => void) => boolean;
  /** Stop a face-gesture overlay (speak-end or fallback to procedural). */
  stopFaceGesture: () => void;
  /** True when the loaded rig has a clip for this keyword (startWalk, stop, turn90, turn180, stairsUp…). */
  hasClip: (keyword: string) => boolean;
  /** Seconds the clip plays, or null until the rig has loaded. */
  clipDuration: (keyword: string) => number | null;
  resumeLocomotion: () => void;
  /** Hide the rig and stop clips. Far street people stay loaded and unsimulated. */
  setShown: (on: boolean) => void;
  whenReady: (callback: () => void) => void;
  findJoint: (suffix: string) => BABYLON.TransformNode | null;
  findBone: (suffix: string) => BABYLON.Bone | null;
  getSkinnedMesh: () => BABYLON.AbstractMesh | null;
  isReady: () => boolean;
  dispose: () => void;
};

const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

const byTail = (clips: BABYLON.AnimationGroup[], tail: string) =>
  clips.find((clip) => clipTail(clip.name).toLowerCase() === tail.toLowerCase()) ?? null;

/**
 * Exact clip-tail match. Tails: Idle Walk WalkBack Jump FallingDown SitIdle
 * SitTalk PistolIdle PistolWalk PistolJump Draw Holster PistolAim Shoot
 * RebornIdle Punch Kick. Attack is on the creature. Punch on NPCs is their strike.
 * draw→Draw, holster→Holster, shoot→Shoot else PistolAim.
 */
export const findClip = (clips: BABYLON.AnimationGroup[], keyword: string): BABYLON.AnimationGroup | null => {
  const key = keyword.trim().toLowerCase();
  if (!key || clips.length === 0) return null;
  if (key === 'draw') return byTail(clips, 'Draw');
  if (key === 'holster') return byTail(clips, 'Holster');
  if (key === 'shoot') return byTail(clips, 'Shoot') ?? byTail(clips, 'PistolAim');
  if (key === 'idle') return byTail(clips, 'Idle');
  if (key === 'walk') return byTail(clips, 'Walk');
  if (key === 'jump') return byTail(clips, 'Jump');
  if (key === 'pistolidle') return byTail(clips, 'PistolIdle');
  if (key === 'pistolwalk') return byTail(clips, 'PistolWalk');
  if (key === 'pistoljump') return byTail(clips, 'PistolJump');
  // Locomotion transitions (Gen motion.from-text, baked onto the hero):
  if (key === 'startwalk') return byTail(clips, 'StartWalk') ?? byTail(clips, 'WalkStart');
  if (key === 'stop') return byTail(clips, 'Stop') ?? byTail(clips, 'WalkStop');
  if (key === 'turn90') return byTail(clips, 'Turn90') ?? byTail(clips, 'TurnRight90');
  if (key === 'turn180') return byTail(clips, 'Turn180') ?? byTail(clips, 'TurnRight180');
  if (key === 'stairsup') return byTail(clips, 'StairsUp') ?? byTail(clips, 'Stairs');
  // Board dialogue gestures (Gen motion.from-text, baked as upper-body overlays):
  if (key === 'gestureexplain') return byTail(clips, 'GestureExplain');
  if (key === 'gesturelean') return byTail(clips, 'GestureLean');
  if (key === 'gesturecross') return byTail(clips, 'GestureCross');
  if (key === 'gesturenod') return byTail(clips, 'GestureNod');
  if (key === 'gestureshake') return byTail(clips, 'GestureShake');
  if (key === 'gesturepoint') return byTail(clips, 'GesturePoint');
  const want = key === 'sit' ? 'sitidle' : key === 'talk' ? 'sittalk' : compact(keyword);
  return clips.find((clip) => compact(clipTail(clip.name)) === want) ?? null;
};

const WEAPON_OVERLAY = new Set(['draw', 'holster', 'shoot']);
/** Seated dialogue gestures: upper-body only, keep SitTalk / SitIdle underneath. */
const FACE_GESTURE = new Set([
  'gestureexplain', 'gesturelean', 'gesturecross', 'gesturenod', 'gestureshake', 'gesturepoint',
]);
/** Looping stand/walk poses. They must not lock locomotion, or a level start stays on idle until punch or the pistol clears it. */
const POSE_LOOP = new Set([
  'idle', 'rebornidle', 'walk', 'run', 'pistolidle', 'pistolwalk', 'sit', 'sittalk', 'walkback', 'stairsup',
]);
/** One-shot start / stop / turn clips: they must not lock cinematic locomotion. */
const LOCO_ONESHOT = new Set(['startwalk', 'stop', 'turn90', 'turn180']);

const PLAYER_CLIP_SPEEDS: Record<string, number> = {
  draw: 4,
  holster: 4,
  shoot: 3,
};

/**
 * BJS 7 `blendingSpeed` is added to blendingFactor once per evaluated frame (not per second).
 * Engine default 0.01 ≈ 100 frames (~1.67s at 60fps). 1 / (0.1 * 60) = 1/6 ≈ 0.1s at 60fps.
 */
const CLIP_BLEND_SECONDS = 0.1;
const CLIP_BLEND_ASSUMED_FPS = 60;
const CLIP_BLENDING_SPEED = 1 / (CLIP_BLEND_SECONDS * CLIP_BLEND_ASSUMED_FPS);
/** PistolWalk + PistolJump on the same bones while airborne and moving. */
const ARMED_MOVE_JUMP_WEIGHT = 0.5;

const applyClipBlending = (clip: BABYLON.AnimationGroup) => {
  clip.enableBlending = true;
  clip.blendingSpeed = CLIP_BLENDING_SPEED;
};

const targetName = (target: unknown) => {
  if (!target || typeof target !== 'object') return '';
  return String((target as { name?: string }).name ?? '');
};

/** Mixamo legs + hips so in-place draw/holster/aim do not pin the pelvis while walking. */
const isLowerBody = (target: unknown) => {
  const n = compact(targetName(target));
  if (!n) return false;
  if (n.includes('hip')) return true;
  if (n.includes('upleg') || n.includes('thigh') || n.includes('calf')) return true;
  if (n.includes('foot') || n.includes('toe')) return true;
  return n.includes('leg');
};

/** LeftHand / RightHand and finger bones only — fire overlay stops at the wrists. */
const isHandOrFinger = (target: unknown) => {
  const n = compact(targetName(target));
  if (!n || isLowerBody(target)) return false;
  if (n.includes('finger') || n.includes('thumb')) return true;
  if (n.includes('lefthand') || n.includes('righthand')) return true;
  return n.endsWith('hand');
};

/** Spine through hands/head — Draw/Holster own these; shoot uses hands only. */
const isUpperBody = (target: unknown) => {
  const n = compact(targetName(target));
  if (!n || isLowerBody(target)) return false;
  if (n.includes('spine') || n.includes('chest') || n.includes('neck') || n.includes('head')) return true;
  if (n.includes('shoulder') || n.includes('clavicle') || n.includes('collar')) return true;
  if (n.includes('arm') || n.includes('hand') || n.includes('finger') || n.includes('thumb')) return true;
  return false;
};

const clipDurationMs = (
  clip: BABYLON.AnimationGroup,
  speedRatio: number,
  from: number,
  to: number,
) => {
  const fps = clipFps(clip);
  const frames = Math.max(1, to - from);
  return (frames / (fps * Math.max(speedRatio, 0.001))) * 1000;
};

const resetTrackWeights = (clip: BABYLON.AnimationGroup, weight: number) => {
  for (const anim of clip.animatables) {
    if (anim) anim.weight = weight;
  }
  clip.weight = weight;
};

/** Weight-0 animatables never advance in BJS 7, so they can block onAnimationGroupEnd. Use masks instead. */
const hardStop = (clip: BABYLON.AnimationGroup | null, nextWeight = 0) => {
  if (!clip) return;
  clip.mask = null;
  clip.stop(true);
  resetTrackWeights(clip, nextWeight);
  for (const ta of clip.targetedAnimations) {
    ta.animation.enableBlending = false;
  }
};

export const createCharacterAvatar = (
  scene: BABYLON.Scene,
  name = 'characterAvatar',
  assetId = PLAYER_ASSET_ID,
  jumpSpeedRatio = 1,
  clipSpeedRatios: Record<string, number> = {},
): PlayerAvatar => {
  const group = new BABYLON.TransformNode(`${name}Root`, scene);
  group.setEnabled(false);
  const modelRoot = new BABYLON.TransformNode(`${name}ModelRoot`, scene);
  modelRoot.parent = group;
  // Mixamo characters face +Z; gameplay yaw treats -Z as forward (away from the camera).
  modelRoot.rotation.y = Math.PI;

  let animationGroups: BABYLON.AnimationGroup[] = [];
  let skeletons: BABYLON.Skeleton[] = [];
  let idleGroup: BABYLON.AnimationGroup | null = null;
  let walkGroup: BABYLON.AnimationGroup | null = null;
  let runGroup: BABYLON.AnimationGroup | null = null;
  let jumpGroup: BABYLON.AnimationGroup | null = null;
  let pistolIdleGroup: BABYLON.AnimationGroup | null = null;
  let pistolWalkGroup: BABYLON.AnimationGroup | null = null;
  let pistolJumpGroup: BABYLON.AnimationGroup | null = null;
  let lowerInclude: BABYLON.AnimationGroupMask | null = null;
  let upperInclude: BABYLON.AnimationGroupMask | null = null;
  let handsInclude: BABYLON.AnimationGroupMask | null = null;
  let bodyWithoutHands: BABYLON.AnimationGroupMask | null = null;
  let upperWithoutHands: BABYLON.AnimationGroupMask | null = null;
  let current: string | null = null;
  let playGen = 0;
  let wantsMoving = false;
  let wantsGrounded = true;
  let sprinting = false;
  /** Ground speed picked the run clip (walk time-scaled past ~1.45x slid; see RUN_ON_MPS). */
  let speedRun = false;
  const useRun = () => (sprinting || speedRun) && !!runGroup;
  let armed = false;
  let disposed = false;
  let shown = true;
  let cinematic = false;
  let stride: number | null = null;
  // NPCs: measure the rig's own ground speed each frame. The player's loop sets it explicitly.
  let autoStride = true;
  let strideFrame = -1;
  let strideTime = 0;
  let strideX = 0;
  let strideZ = 0;
  let jumpPose: number | null = null;
  let overlaying = false;
  let overlayArmed = false;
  let overlayClip: BABYLON.AnimationGroup | null = null;
  let overlayEndTimer = 0;
  let overlaySeq = 0;
  let overlayEnded: (() => void) | null = null;
  /** Face gesture overlay: separate from weapon overlays so SitTalk is not syncOverlayLocomotion'd. */
  let faceGestureClip: BABYLON.AnimationGroup | null = null;
  let faceGestureTimer = 0;
  let faceGestureSeq = 0;
  let pendingClip: {
    keyword: string;
    loop: boolean;
    speedRatio: number;
    onEnded?: () => void;
    lockCinematic: boolean;
  } | null = null;
  let clipTrims: ClipTrimsFile | null = null;
  let modelPath = '';
  let modelReady = false;
  const readyWaiters: Array<() => void> = [];

  const rangeFor = (clip: BABYLON.AnimationGroup) =>
    clipPlayRange(clip, lookupClipTrim(clipTrims ?? { version: 1, clips: {} }, clipTail(clip.name), modelPath));

  const activeIdle = () => (armed ? pistolIdleGroup ?? idleGroup : idleGroup);
  const activeWalk = () => {
    if (armed) return pistolWalkGroup ?? walkGroup;
    if (useRun()) return runGroup;
    return walkGroup;
  };
  const activeJump = () => (armed ? pistolJumpGroup ?? jumpGroup : jumpGroup);
  const overlayWalk = () => (overlayArmed ? pistolWalkGroup ?? walkGroup : walkGroup ?? pistolWalkGroup);
  const overlayBody = () => {
    if (wantsMoving) return overlayWalk() ?? activeIdle();
    return activeIdle() ?? overlayWalk();
  };
  const pistolReadyIdle = () => pistolIdleGroup ?? idleGroup;

  const locoGroups = () => [idleGroup, walkGroup, runGroup, pistolIdleGroup, pistolWalkGroup, jumpGroup, pistolJumpGroup];
  const isIdleName = (name: string | null) => name === 'idle' || name === 'pistolidle' || name === 'rebornidle';

  const clipFullyDriving = (clip: BABYLON.AnimationGroup) => {
    if (!clip.isPlaying || clip.mask) return false;
    if (clip.weight === 0) return false;
    for (const anim of clip.animatables) {
      if (anim && anim.weight === 0) return false;
    }
    return true;
  };

  const extraLocoPlaying = (target: BABYLON.AnimationGroup) => {
    for (const clip of locoGroups()) {
      if (!clip || clip === target) continue;
      if (clip.isPlaying) return true;
    }
    return false;
  };

  const restoreGameplayTracks = () => {
    for (const clip of locoGroups()) {
      if (!clip) continue;
      clip.mask = null;
      applyClipBlending(clip);
      resetTrackWeights(clip, 1);
    }
  };

  const clearOverlayEndTimer = () => {
    if (!overlayEndTimer) return;
    window.clearTimeout(overlayEndTimer);
    overlayEndTimer = 0;
  };

  const releaseOverlay = () => {
    clearOverlayEndTimer();
    const leftover = overlayClip;
    overlayClip = null;
    overlaying = false;
    hardStop(leftover, 0);
    for (const keyword of WEAPON_OVERLAY) {
      const clip = findClip(animationGroups, keyword);
      if (clip && clip !== leftover) hardStop(clip, 0);
    }
  };

  const clearFaceGestureTimer = () => {
    if (!faceGestureTimer) return;
    window.clearTimeout(faceGestureTimer);
    faceGestureTimer = 0;
  };

  const releaseFaceGesture = () => {
    clearFaceGestureTimer();
    const leftover = faceGestureClip;
    faceGestureClip = null;
    if (leftover) hardStop(leftover, 0);
    for (const keyword of FACE_GESTURE) {
      const clip = findClip(animationGroups, keyword);
      if (clip && clip !== leftover) hardStop(clip, 0);
    }
  };

  /**
   * Layer a Gen Gesture* clip on the upper body while SitTalk / SitIdle / Idle keeps the seat.
   * Does not touch the weapon overlay lock (setLocomotion stays on cinematic sit). Missing → false.
   */
  const playFaceGesture = (keyword: string, onEnded?: () => void): boolean => {
    const token = keyword.trim().toLowerCase();
    if (!FACE_GESTURE.has(token)) return false;
    const clip = findClip(animationGroups, token);
    if (!clip || !upperInclude || !lowerInclude) return false;
    let keep: BABYLON.AnimationGroup | null = null;
    for (const g of animationGroups) {
      if (g === clip) continue;
      if (g.isPlaying && (!g.mask || g.mask === lowerInclude)) {
        keep = g;
        break;
      }
    }
    if (!keep) {
      keep =
        findClip(animationGroups, 'sittalk')
        ?? findClip(animationGroups, 'sit')
        ?? (current ? findClip(animationGroups, current) : null)
        ?? idleGroup;
    }
    if (!keep) return false;
    faceGestureSeq += 1;
    clearFaceGestureTimer();
    if (faceGestureClip && faceGestureClip !== clip) hardStop(faceGestureClip, 0);
    for (const keyword of FACE_GESTURE) {
      const other = findClip(animationGroups, keyword);
      if (other && other !== clip) hardStop(other, 0);
    }
    startMaskedLoop(keep, lowerInclude, keep.speedRatio || 1, true, 1);
    faceGestureClip = clip;
    const speed = 1;
    const { from, to } = rangeFor(clip);
    const seq = faceGestureSeq;
    const finish = () => {
      if (seq !== faceGestureSeq) return;
      faceGestureSeq += 1;
      releaseFaceGesture();
      if (keep) {
        keep.mask = null;
        applyClipBlending(keep);
        resetTrackWeights(keep, 1);
        if (!keep.isPlaying) {
          const range = rangeFor(keep);
          keep.start(true, 1, range.from, range.to, false);
        }
      }
      onEnded?.();
    };
    clip.mask = upperInclude;
    clip.stop(true);
    applyClipBlending(clip);
    resetTrackWeights(clip, 1);
    clip.onAnimationGroupEndObservable.addOnce(finish);
    faceGestureTimer = window.setTimeout(finish, clipDurationMs(clip, speed, from, to) + 40);
    clip.start(false, speed, from, to, false);
    clip.syncWithMask(true);
    resetTrackWeights(clip, 1);
    return true;
  };

  const takeOverlayEnded = () => {
    const cb = overlayEnded;
    overlayEnded = null;
    return cb;
  };

  /** Drop a dead overlay lock so setLocomotion cannot stay blocked. */
  const overlayLockActive = () => {
    if (!overlaying) return false;
    if (overlayEndTimer || overlayClip?.isPlaying) return true;
    overlaySeq += 1;
    const cb = takeOverlayEnded();
    releaseOverlay();
    cinematic = false;
    restoreGameplayTracks();
    if (cb) queueMicrotask(cb);
    return false;
  };

  const startFresh = (target: BABYLON.AnimationGroup, loop: boolean, speed: number) => {
    target.mask = null;
    target.stop(true);
    applyClipBlending(target);
    resetTrackWeights(target, 1);
    const { from, to } = rangeFor(target);
    target.start(loop, speed, from, to, false);
    resetTrackWeights(target, 1);
  };

  const playLoop = (target: BABYLON.AnimationGroup | null, clipName: string, forceRestart = false) => {
    if (!target) return;
    if (wantsMoving && isIdleName(clipName)) {
      const walk = activeWalk();
      if (walk) {
        playLoop(walk, armed ? 'pistolwalk' : 'walk', true);
        return;
      }
    }
    if (
      !forceRestart
      && !overlaying
      && current === clipName
      && clipFullyDriving(target)
      && !extraLocoPlaying(target)
      && !(wantsMoving && isIdleName(current))
    ) return;
    releaseOverlay();
    cinematic = false;
    restoreGameplayTracks();
    animationGroups.forEach((clip) => {
      if (clip !== target) hardStop(clip, 1);
    });
    startFresh(target, true, 1);
    current = clipName;
  };

  const startMaskedLoop = (
    clip: BABYLON.AnimationGroup,
    mask: BABYLON.AnimationGroupMask,
    speed: number,
    loop: boolean,
    weight = 1,
  ) => {
    if (clip.mask === mask && clip.isPlaying) {
      resetTrackWeights(clip, weight);
      return;
    }
    if (clip.mask === mask && !loop && !clip.isPlaying) return;
    clip.stop(true);
    clip.mask = mask;
    applyClipBlending(clip);
    const range = rangeFor(clip);
    clip.start(loop, speed, range.from, range.to, false);
    clip.syncWithMask(true);
    resetTrackWeights(clip, weight);
  };

  const stopOthers = (keep: Iterable<BABYLON.AnimationGroup | null | undefined>) => {
    const held = new Set(Array.from(keep).filter(Boolean) as BABYLON.AnimationGroup[]);
    animationGroups.forEach((clip) => {
      if (held.has(clip)) return;
      if (clip.isPlaying) hardStop(clip, 1);
    });
  };

  /** Gun-out jump: idle owns arms; airborne walk mixes PistolWalk + PistolJump 50/50 on hips/legs. */
  const syncArmedJump = (keepExtra: BABYLON.AnimationGroup | null = null) => {
    const jump = activeJump();
    const idle = pistolReadyIdle();
    const walk = pistolWalkGroup ?? walkGroup;
    if (!jump || !idle || !lowerInclude || !upperInclude) return false;
    const handsHeld = !!keepExtra && !!handsInclude;
    const moving = wantsMoving && !!walk && walk !== jump;
    stopOthers([jump, idle, moving ? walk : null, keepExtra]);
    const idleUpper = handsHeld ? upperWithoutHands ?? upperInclude : upperInclude;
    if (moving && walk && walk !== jump) {
      startMaskedLoop(walk, lowerInclude, 1, true, ARMED_MOVE_JUMP_WEIGHT);
      startMaskedLoop(jump, lowerInclude, jumpSpeedRatio, false, ARMED_MOVE_JUMP_WEIGHT);
      if (idle !== jump) startMaskedLoop(idle, idleUpper, 1, true);
      return true;
    }
    startMaskedLoop(jump, lowerInclude, jumpSpeedRatio, false);
    if (idle !== jump) startMaskedLoop(idle, idleUpper, 1, true);
    return true;
  };

  const playJump = () => {
    const jump = activeJump();
    if (!jump) return;
    if (overlaying || overlayClip) {
      overlaySeq += 1;
      overlayEnded = null;
      releaseOverlay();
      cinematic = false;
      restoreGameplayTracks();
      current = null;
    }
    if (armed && syncArmedJump()) {
      current = 'pistoljump';
      return;
    }
    const jumpName = armed ? 'pistoljump' : 'jump';
    if (current === jumpName && clipFullyDriving(jump) && !extraLocoPlaying(jump)) return;
    restoreGameplayTracks();
    animationGroups.forEach((clip) => {
      if (clip !== jump) hardStop(clip, 1);
    });
    startFresh(jump, false, jumpSpeedRatio);
    current = jumpName;
  };

  const locomotionKeyword = () => {
    if (!wantsGrounded && activeJump()) return armed ? 'pistolJump' : 'jump';
    if (wantsMoving) {
      if (armed) return 'pistolWalk';
      if (useRun()) return 'run';
      return 'walk';
    }
    return armed ? 'pistolIdle' : 'idle';
  };

  const applyLocomotion = (forceRestart = false) => {
    const restart = forceRestart || (wantsMoving && isIdleName(current));
    if (!wantsGrounded && activeJump()) {
      playJump();
      return;
    }
    const movingName = armed ? 'pistolwalk' : useRun() ? 'run' : 'walk';
    const idleName = armed ? 'pistolidle' : 'idle';
    const walk = activeWalk();
    playLoop(
      wantsMoving ? walk ?? activeIdle() : activeIdle() ?? walk,
      wantsMoving && walk ? movingName : idleName,
      restart,
    );
  };

  const syncOverlayLocomotion = () => {
    if (!overlayClip) return;
    const shootHands = current === 'shoot' && !!handsInclude;
    if (shootHands && handsInclude) {
      overlayClip.mask = handsInclude;
      overlayClip.syncWithMask(true);
      if (!wantsGrounded && armed && syncArmedJump(overlayClip)) return;
      const body = overlayBody();
      stopOthers([overlayClip, body]);
      if (body && body !== overlayClip && bodyWithoutHands) {
        startMaskedLoop(body, bodyWithoutHands, 1, true);
      }
      return;
    }
    const lower = overlayWalk();
    const overlayMask = upperInclude ?? null;
    const useLower = wantsMoving && wantsGrounded && !!lower && !!lowerInclude && !!overlayMask;
    animationGroups.forEach((clip) => {
      if (clip === overlayClip) return;
      if (useLower && clip === lower) return;
      if (clip.isPlaying) hardStop(clip, 1);
    });
    if (useLower && lower && lowerInclude && overlayMask) {
      overlayClip.mask = overlayMask;
      overlayClip.syncWithMask(true);
      startMaskedLoop(lower, lowerInclude, 1, true);
    } else {
      overlayClip.mask = null;
      overlayClip.syncWithMask(true);
      if (lower?.isPlaying && lower !== overlayClip) hardStop(lower, 1);
    }
  };

  const setLocomotion = (moving: boolean, grounded: boolean) => {
    if (autoStride && shown) measureStride(moving);
    wantsMoving = moving;
    wantsGrounded = grounded;
    if (!shown) return;
    if (overlayLockActive()) {
      syncOverlayLocomotion();
      return;
    }
    if (cinematic) return;
    applyLocomotion();
    applyJumpPose();
    applyStride();
  };

  const setSprinting = (next: boolean) => {
    const resolved = Boolean(next && runGroup);
    if (sprinting === resolved) return;
    sprinting = resolved;
    if (current === 'walk' || current === 'run') current = null;
    if (!cinematic) applyLocomotion();
  };

  /** Blend walk to run by real root speed with hysteresis, so neither clip is time-scaled outside ~0.6-1.45x. */
  const updateSpeedRun = () => {
    const next = stride === null ? false : speedRun ? stride > RUN_OFF_MPS : stride > RUN_ON_MPS;
    if (next === speedRun) return;
    speedRun = next;
    if (!runGroup || sprinting || armed || cinematic || !wantsMoving) return;
    if (current === 'walk' || current === 'run') {
      current = null;
      applyLocomotion();
    }
  };

  const applyStride = () => {
    updateSpeedRun();
    if (stride === null) return;
    const pairs: [BABYLON.AnimationGroup | null, string][] = [[walkGroup, 'walk'], [runGroup, 'run'], [pistolWalkGroup, 'pistolwalk']];
    for (const [clip, name] of pairs) {
      if (clip?.isPlaying) clip.speedRatio = strideRatio(name, stride);
    }
  };

  const applyJumpPose = () => {
    if (jumpPose === null || cinematic) return;
    const jump = activeJump();
    if (!jump?.isPlaying) return;
    const keys = JUMP_KEYS[armed && pistolJumpGroup ? 'pistoljump' : 'jump'];
    const u = Math.min(4, Math.max(0, jumpPose));
    const i = Math.min(3, Math.floor(u));
    const seconds = keys[i] + (keys[i + 1] - keys[i]) * (u - i);
    jump.goToFrame(Math.min(jump.to, jump.from + seconds * clipFps(jump)));
  };

  const measureStride = (moving: boolean) => {
    const frame = scene.getFrameId();
    if (frame === strideFrame) return;
    const now = performance.now();
    const at = group.getAbsolutePosition();
    const dt = (now - strideTime) / 1000;
    const dist = Math.hypot(at.x - strideX, at.z - strideZ);
    const fresh = strideFrame >= 0 && frame === strideFrame + 1 && dt > 0 && dt < 0.25 && dist < 1.5;
    strideFrame = frame;
    strideTime = now;
    strideX = at.x;
    strideZ = at.z;
    if (!moving) {
      stride = null;
      return;
    }
    if (!fresh) return;
    const speed = dist / dt;
    stride = stride === null ? speed : stride + (speed - stride) * Math.min(1, dt * 10);
  };

  const setStride = (metresPerSecond: number | null) => {
    autoStride = false;
    stride = metresPerSecond === null || !Number.isFinite(metresPerSecond) ? null : Math.max(0, metresPerSecond);
    applyStride();
  };

  const setJumpPose = (pose: number | null) => {
    jumpPose = pose;
    applyJumpPose();
  };

  const setPace = (rate: number) => {
    const pace = Math.max(0.25, rate);
    for (const clip of locoGroups()) {
      if (clip) clip.speedRatio = pace;
    }
  };

  const setArmed = (next: boolean) => {
    armed = next;
    if (current === 'idle' || current === 'walk' || current === 'jump'
      || current === 'pistolidle' || current === 'pistolwalk' || current === 'pistoljump') {
      current = null;
    }
    if (!cinematic) applyLocomotion();
  };

  const resumeLocomotion = () => {
    overlaySeq += 1;
    overlayEnded = null;
    releaseOverlay();
    cinematic = false;
    pendingClip = null;
    restoreGameplayTracks();
    for (const clip of locoGroups()) {
      if (!clip) continue;
      clip.stop(true);
      resetTrackWeights(clip, 1);
    }
    current = null;
    const keyword = locomotionKeyword();
    const loop = keyword !== 'jump' && keyword !== 'pistolJump';
    const speed = loop ? 1 : jumpSpeedRatio;
    playClip(keyword, loop, speed, undefined, false);
  };

  const playClip = (
    keyword: string,
    loop = true,
    speedRatio = 1,
    onEnded?: () => void,
    lockCinematic = true,
  ) => {
    const tokenEarly = keyword.trim().toLowerCase();
    if (loop && POSE_LOOP.has(tokenEarly)) lockCinematic = false;
    if (!loop && LOCO_ONESHOT.has(tokenEarly)) lockCinematic = false;
    if (animationGroups.length === 0) {
      cinematic = lockCinematic;
      pendingClip = { keyword, loop, speedRatio, onEnded, lockCinematic };
      current = keyword.toLowerCase();
      return true;
    }
    let request = keyword;
    let token = request.trim().toLowerCase();
    if (!lockCinematic && wantsMoving && isIdleName(token)) {
      request = armed ? 'pistolWalk' : 'walk';
      token = request.toLowerCase();
      loop = true;
    }
    const clip = findClip(animationGroups, request);
    if (!clip) return false;
    if (!loop && cinematic && current === token && lockCinematic && clip.isPlaying && overlaying && overlayEndTimer) {
      return true;
    }
    if (!lockCinematic && (token === 'jump' || token === 'pistoljump')) {
      ++playGen;
      playJump();
      return true;
    }
    ++playGen;
    const isOverlay = lockCinematic && WEAPON_OVERLAY.has(token);
    if (!isOverlay) {
      overlaySeq += 1;
      overlayEnded = null;
      releaseOverlay();
      restoreGameplayTracks();
    } else {
      overlaySeq += 1;
      overlayEnded = onEnded ?? null;
    }
    cinematic = lockCinematic;
    overlaying = isOverlay;
    overlayArmed = token === 'holster' ? false : token === 'draw' || token === 'shoot' ? true : armed;
    overlayClip = isOverlay ? clip : null;
    const speed = clipSpeedRatios[token] ?? speedRatio;
    const layerHands = isOverlay && token === 'shoot' && !!handsInclude;
    const layerLower = isOverlay && !layerHands && wantsMoving && wantsGrounded;
    const keepBody = layerHands ? overlayBody() : layerLower ? overlayWalk() : null;
    if (!layerHands) {
      animationGroups.forEach((groupClip) => {
        if (groupClip === clip || groupClip === keepBody) return;
        hardStop(groupClip, 1);
      });
    }
    clip.mask = layerHands && handsInclude
      ? handsInclude
      : layerLower && upperInclude
        ? upperInclude
        : null;
    clip.stop(true);
    applyClipBlending(clip);
    resetTrackWeights(clip, 1);
    const { from, to } = rangeFor(clip);
    const seq = overlaySeq;
    const finish = () => {
      if (seq !== overlaySeq) return;
      overlaySeq += 1;
      overlayEnded = null;
      releaseOverlay();
      onEnded?.();
    };
    if (isOverlay || (!loop && onEnded)) {
      if (!loop) clip.onAnimationGroupEndObservable.addOnce(finish);
      overlayEndTimer = window.setTimeout(finish, clipDurationMs(clip, speed, from, to) + 40);
    }
    clip.start(loop, speed, from, to, false);
    if (!loop && !onEnded && !isOverlay) {
      const held = overlaySeq;
      clip.onAnimationGroupEndObservable.addOnce(() => {
        if (held !== overlaySeq) return;
        clip.start(true, 1, Math.max(from, to - 1), to, false);
      });
    }
    if (seq !== overlaySeq) return true;
    resetTrackWeights(clip, 1);
    current = token;
    // A cutscene that passes its own rate keeps it; a plain loop matches the walker's ground speed.
    if (loop && speedRatio === 1) applyStride();
    if (isOverlay) syncOverlayLocomotion();
    return true;
  };

  void Promise.all([
    loadGlbByAssetId(scene, assetId, modelRoot),
    loadClipTrims(),
    getAssetLibrary().then((library) => resolveModelPath(library, assetId) ?? ''),
  ]).then(([imported, trims, path]) => {
    clipTrims = trims;
    modelPath = path;
    if (!imported || disposed) {
      imported?.meshes.forEach((mesh) => mesh.dispose());
      imported?.animationGroups.forEach((clip) => clip.dispose());
      imported?.skeletons.forEach((skeleton) => skeleton.dispose());
      if (!disposed) {
        group.setEnabled(true);
        modelReady = true;
        for (const waiter of readyWaiters.splice(0)) waiter();
      }
      return;
    }

    imported.meshes.forEach((mesh) => {
      mesh.isPickable = false;
    });
    animationGroups = imported.animationGroups;
    animationGroups.forEach((clip) => {
      clip.stop(true);
      applyClipBlending(clip);
    });
    skeletons = imported.skeletons;
    idleGroup = findClip(animationGroups, 'rebornidle') ?? findClip(animationGroups, 'idle');
    walkGroup = findClip(animationGroups, 'walk');
    runGroup = findClip(animationGroups, 'run');
    jumpGroup = findClip(animationGroups, 'jump');
    pistolIdleGroup = findClip(animationGroups, 'pistolIdle');
    pistolWalkGroup = findClip(animationGroups, 'pistolWalk');
    pistolJumpGroup = findClip(animationGroups, 'pistolJump');
    const lowerNames = new Set<string>();
    const upperNames = new Set<string>();
    const handNames = new Set<string>();
    const bodyNames = new Set<string>();
    const upperNoHandNames = new Set<string>();
    animationGroups.forEach((clip) => {
      clip.targetedAnimations.forEach((ta) => {
        const name = targetName(ta.target);
        if (!name) return;
        if (isHandOrFinger(ta.target)) handNames.add(name);
        else bodyNames.add(name);
        if (isLowerBody(ta.target)) lowerNames.add(name);
        else if (isUpperBody(ta.target)) {
          upperNames.add(name);
          if (!isHandOrFinger(ta.target)) upperNoHandNames.add(name);
        }
      });
    });
    const includeMask = (names: Set<string>) =>
      names.size ? new BABYLON.AnimationGroupMask([...names], BABYLON.AnimationGroupMaskMode.Include) : null;
    lowerInclude = includeMask(lowerNames);
    upperInclude = includeMask(upperNames);
    handsInclude = includeMask(handNames);
    bodyWithoutHands = includeMask(bodyNames);
    upperWithoutHands = includeMask(upperNoHandNames);
    const sitGroup = findClip(animationGroups, 'sit');
    if (!idleGroup && animationGroups.length === 1 && !sitGroup) idleGroup = animationGroups[0];
    if (!idleGroup && !walkGroup && !sitGroup && animationGroups.length) {
      console.warn(
        `${name} loaded ${animationGroups.length} clip(s) but none matched idle/walk/sit:`,
        animationGroups.map((clip) => clip.name),
      );
    }

    if (!disposed) {
      modelReady = true;
      if (shown) {
        if (pendingClip) {
          const queued = pendingClip;
          pendingClip = null;
          cinematic = false;
          current = null;
          if (!playClip(queued.keyword, queued.loop, queued.speedRatio, queued.onEnded, queued.lockCinematic)) {
            applyLocomotion();
          }
        } else {
          applyLocomotion();
        }
        group.setEnabled(true);
      } else {
        pendingClip = null;
        animationGroups.forEach((clip) => clip.stop());
        group.setEnabled(false);
      }
      for (const waiter of readyWaiters.splice(0)) waiter();
    }
  });

  const findJoint = (suffix: string): BABYLON.TransformNode | null => {
    const want = suffix.toLowerCase();
    for (const node of group.getChildTransformNodes(true)) {
      if (jointSuffix(node.name) === want) return node;
    }
    for (const skeleton of skeletons) {
      for (const bone of skeleton.bones) {
        if (jointSuffix(bone.name) !== want) continue;
        const linked = bone.getTransformNode();
        if (linked) return linked;
      }
    }
    return null;
  };

  const findBone = (suffix: string): BABYLON.Bone | null => {
    const want = suffix.toLowerCase();
    for (const skeleton of skeletons) {
      for (const bone of skeleton.bones) {
        if (jointSuffix(bone.name) === want) return bone;
      }
    }
    return null;
  };

  const getSkinnedMesh = (): BABYLON.AbstractMesh | null => {
    const meshes = group.getChildMeshes(false);
    const withSkeleton = meshes
      .filter((mesh) => !!mesh.skeleton && mesh.getTotalVertices() > 0)
      .sort((a, b) => b.getTotalVertices() - a.getTotalVertices());
    if (withSkeleton[0]) return withSkeleton[0];
    const biggest = [...meshes].sort((a, b) => b.getTotalVertices() - a.getTotalVertices())[0];
    return biggest ?? null;
  };

  const clipDuration = (keyword: string) => {
    if (!animationGroups.length) return null;
    const clip = findClip(animationGroups, keyword);
    if (!clip) return null;
    const { from, to } = rangeFor(clip);
    const speed = clipSpeedRatios[keyword.trim().toLowerCase()] ?? 1;
    return clipDurationMs(clip, speed, from, to) / 1000;
  };

  return {
    group,
    setLocomotion,
    setPace,
    setStride,
    setJumpPose,
    locomotion: () => {
      const name = current;
      const clip = name === 'walk' ? walkGroup
        : name === 'run' ? runGroup
          : name === 'pistolwalk' ? pistolWalkGroup
            : null;
      return { clip: name, rate: clip?.isPlaying ? clip.speedRatio : 1, cinematic };
    },
    setSprinting,
    setArmed,
    playClip,
    playFaceGesture,
    stopFaceGesture: () => {
      faceGestureSeq += 1;
      const keepPlaying = (() => {
        for (const g of animationGroups) {
          if (g === faceGestureClip) continue;
          if (g.isPlaying) return g;
        }
        return findClip(animationGroups, 'sittalk')
          ?? findClip(animationGroups, 'sit')
          ?? (current ? findClip(animationGroups, current) : null)
          ?? idleGroup;
      })();
      releaseFaceGesture();
      if (keepPlaying) {
        keepPlaying.mask = null;
        applyClipBlending(keepPlaying);
        resetTrackWeights(keepPlaying, 1);
        if (!keepPlaying.isPlaying) {
          const range = rangeFor(keepPlaying);
          keepPlaying.start(true, 1, range.from, range.to, false);
        }
      }
    },
    hasClip: (keyword: string) => !!findClip(animationGroups, keyword),
    clipDuration,
    resumeLocomotion,
    setShown: (on: boolean) => {
      if (shown === on) return;
      shown = on;
      if (!modelReady || disposed) {
        if (!on) group.setEnabled(false);
        return;
      }
      group.setEnabled(on);
      if (!on) {
        animationGroups.forEach((clip) => {
          if (clip.isPlaying) clip.stop();
        });
        return;
      }
      current = null;
      applyLocomotion();
    },
    whenReady: (callback) => {
      if (modelReady && !disposed) {
        callback();
        return;
      }
      readyWaiters.push(callback);
    },
    isReady: () => modelReady && !disposed,
    findJoint,
    findBone,
    getSkinnedMesh,
    dispose: () => {
      disposed = true;
      readyWaiters.length = 0;
      clearOverlayEndTimer();
      clearFaceGestureTimer();
      faceGestureClip = null;
      animationGroups.forEach((clip) => clip.dispose());
      skeletons.forEach((skeleton) => skeleton.dispose());
      group.dispose();
    },
  };
};

export const createPlayerAvatar = (scene: BABYLON.Scene, assetId = PLAYER_ASSET_ID): PlayerAvatar =>
  createCharacterAvatar(scene, 'playerAvatar', assetId, 1.3, PLAYER_CLIP_SPEEDS);
