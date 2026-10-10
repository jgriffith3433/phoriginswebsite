import * as BABYLON from '@babylonjs/core';

import {
  clipPlayRange,
  clipTail,
  clipFps,
  loadClipTrims,
  lookupClipTrim,
  type ClipTrimsFile,
} from './clipTrims';
import { PLAYER_ASSET_ID, getAssetLibrary, jointSuffix, loadGlbByAssetId, resolveModelPath } from './modelLoader';

export type PlayerAvatar = {
  group: BABYLON.TransformNode;
  setLocomotion: (moving: boolean, grounded: boolean) => void;
  setPace: (rate: number) => void;
  setSprinting: (sprinting: boolean) => void;
  setArmed: (armed: boolean) => void;
  playClip: (keyword: string, loop?: boolean, speedRatio?: number, onEnded?: () => void) => boolean;
  resumeLocomotion: () => void;
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
 * RebornIdle. Attack is on the creature.
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
  const want = key === 'sit' ? 'sitidle' : key === 'talk' ? 'sittalk' : compact(keyword);
  return clips.find((clip) => compact(clipTail(clip.name)) === want) ?? null;
};

const WEAPON_OVERLAY = new Set(['draw', 'holster', 'shoot']);

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
  let armed = false;
  let disposed = false;
  let cinematic = false;
  let overlaying = false;
  let overlayArmed = false;
  let overlayClip: BABYLON.AnimationGroup | null = null;
  let overlayEndTimer = 0;
  let overlaySeq = 0;
  let overlayEnded: (() => void) | null = null;
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
    if (sprinting && runGroup) return runGroup;
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
  const isIdleName = (name: string | null) => name === 'idle' || name === 'pistolidle';

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
      if (sprinting && runGroup) return 'run';
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
    const movingName = armed ? 'pistolwalk' : sprinting && runGroup ? 'run' : 'walk';
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
    wantsMoving = moving;
    wantsGrounded = grounded;
    if (overlayLockActive()) {
      syncOverlayLocomotion();
      return;
    }
    if (cinematic) return;
    applyLocomotion();
  };

  const setSprinting = (next: boolean) => {
    const resolved = Boolean(next && runGroup);
    if (sprinting === resolved) return;
    sprinting = resolved;
    if (current === 'walk' || current === 'run') current = null;
    if (!cinematic) applyLocomotion();
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

    if (!disposed) {
      group.setEnabled(true);
      modelReady = true;
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

  return {
    group,
    setLocomotion,
    setPace,
    setSprinting,
    setArmed,
    playClip,
    resumeLocomotion,
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
      animationGroups.forEach((clip) => clip.dispose());
      skeletons.forEach((skeleton) => skeleton.dispose());
      group.dispose();
    },
  };
};

export const createPlayerAvatar = (scene: BABYLON.Scene, assetId = PLAYER_ASSET_ID): PlayerAvatar =>
  createCharacterAvatar(scene, 'playerAvatar', assetId, 1.3, PLAYER_CLIP_SPEEDS);
