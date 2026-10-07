import * as BABYLON from '@babylonjs/core';

import { PLAYER_ASSET_ID, loadGlbByAssetId } from './modelLoader';

export type PlayerAvatar = {
  group: BABYLON.TransformNode;
  setLocomotion: (moving: boolean, grounded: boolean) => void;
  setArmed: (armed: boolean) => void;
  playClip: (keyword: string, loop?: boolean, speedRatio?: number, onEnded?: () => void) => boolean;
  resumeLocomotion: () => void;
  dispose: () => void;
};

const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Last `_` segment so prefixed clones (`…ModelRoot_2_SitIdle`) still match. */
const clipTail = (value: string) => {
  const slash = value.replace(/\\/g, '/');
  const base = slash.slice(slash.lastIndexOf('/') + 1);
  const parts = base.split('_');
  return parts[parts.length - 1] ?? base;
};

const byTail = (clips: BABYLON.AnimationGroup[], tail: string) =>
  clips.find((clip) => clipTail(clip.name).toLowerCase() === tail.toLowerCase()) ?? null;

/**
 * Exact clip-tail match. Tails: Idle Walk Jump SitIdle SitTalk PistolIdle
 * PistolWalk PistolJump Draw Holster PistolAim Shoot.
 * draw→Draw, holster→Holster, shoot→Shoot else PistolAim.
 */
export const findClip = (clips: BABYLON.AnimationGroup[], keyword: string): BABYLON.AnimationGroup | null => {
  const key = keyword.trim().toLowerCase();
  if (!key || clips.length === 0) return null;
  if (key === 'draw') return byTail(clips, 'Draw');
  if (key === 'holster') return byTail(clips, 'Holster');
  if (key === 'shoot') return byTail(clips, 'Shoot') ?? byTail(clips, 'PistolAim');
  const want = key === 'sit' ? 'sitidle' : key === 'talk' ? 'sittalk' : compact(keyword);
  return clips.find((clip) => compact(clipTail(clip.name)) === want) ?? null;
};

const WEAPON_OVERLAY = new Set(['draw', 'holster', 'shoot']);

const PLAYER_CLIP_SPEEDS: Record<string, number> = {
  draw: 4,
  holster: 4,
  shoot: 3,
};

const targetName = (target: unknown) => {
  if (!target || typeof target !== 'object') return '';
  return String((target as { name?: string }).name ?? '');
};

/** Mixamo legs + hips so in-place draw/holster do not pin the pelvis while walking. */
const isLowerBody = (target: unknown) => {
  const n = compact(targetName(target));
  if (!n) return false;
  if (n.includes('hip')) return true;
  if (n.includes('upleg') || n.includes('thigh') || n.includes('calf')) return true;
  if (n.includes('foot') || n.includes('toe')) return true;
  return n.includes('leg');
};

const maskGroup = (group: BABYLON.AnimationGroup, mode: 'full' | 'upper' | 'lower') => {
  for (const anim of group.animatables) {
    if (!anim) continue;
    const lower = isLowerBody(anim.target);
    if (mode === 'full') anim.weight = 1;
    else if (mode === 'upper') anim.weight = lower ? 0 : 1;
    else anim.weight = lower ? 1 : 0;
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
  const modelRoot = new BABYLON.TransformNode(`${name}ModelRoot`, scene);
  modelRoot.parent = group;
  // Mixamo characters face +Z; gameplay yaw treats -Z as forward (away from the camera).
  modelRoot.rotation.y = Math.PI;

  let animationGroups: BABYLON.AnimationGroup[] = [];
  let skeletons: BABYLON.Skeleton[] = [];
  let idleGroup: BABYLON.AnimationGroup | null = null;
  let walkGroup: BABYLON.AnimationGroup | null = null;
  let jumpGroup: BABYLON.AnimationGroup | null = null;
  let pistolIdleGroup: BABYLON.AnimationGroup | null = null;
  let pistolWalkGroup: BABYLON.AnimationGroup | null = null;
  let pistolJumpGroup: BABYLON.AnimationGroup | null = null;
  let current: string | null = null;
  let playGen = 0;
  let wantsMoving = false;
  let wantsGrounded = true;
  let armed = false;
  let disposed = false;
  let cinematic = false;
  let overlaying = false;
  let overlayArmed = false;
  let overlayClip: BABYLON.AnimationGroup | null = null;
  let pendingClip: { keyword: string; loop: boolean; speedRatio: number; onEnded?: () => void } | null = null;

  const activeIdle = () => (armed ? pistolIdleGroup ?? idleGroup : idleGroup);
  const activeWalk = () => (armed ? pistolWalkGroup ?? walkGroup : walkGroup);
  const activeJump = () => (armed ? pistolJumpGroup ?? jumpGroup : jumpGroup);
  const overlayWalk = () => (overlayArmed ? pistolWalkGroup ?? walkGroup : walkGroup ?? pistolWalkGroup);

  const playLoop = (target: BABYLON.AnimationGroup | null, name: string) => {
    if (!target || current === name) return;
    animationGroups.forEach((clip) => {
      if (clip !== target && clip.isPlaying) clip.stop();
    });
    target.start(true, 1.0, target.from, target.to, false);
    current = name;
  };

  const playJump = () => {
    const jump = activeJump();
    const jumpName = armed ? 'pistoljump' : 'jump';
    if (!jump || current === jumpName) return;
    animationGroups.forEach((clip) => {
      if (clip !== jump && clip.isPlaying) clip.stop();
    });
    jump.start(false, jumpSpeedRatio, jump.from, jump.to, false);
    current = jumpName;
  };

  const applyLocomotion = () => {
    if (!wantsGrounded && activeJump()) {
      playJump();
      return;
    }
    const movingName = armed ? 'pistolwalk' : 'walk';
    const idleName = armed ? 'pistolidle' : 'idle';
    playLoop(wantsMoving ? activeWalk() ?? activeIdle() : activeIdle() ?? activeWalk(), wantsMoving ? movingName : idleName);
  };

  const syncOverlayLocomotion = () => {
    if (!overlayClip) return;
    const walk = overlayWalk();
    const useLegs = wantsMoving && wantsGrounded && !!walk;
    animationGroups.forEach((clip) => {
      if (clip === overlayClip) return;
      if (useLegs && clip === walk) return;
      if (clip.isPlaying) clip.stop();
    });
    if (useLegs && walk) {
      if (!walk.isPlaying) walk.start(true, 1.0, walk.from, walk.to, false);
      walk.enableBlending = true;
      walk.blendingSpeed = 0.12;
      maskGroup(walk, 'lower');
      maskGroup(overlayClip, 'upper');
    } else {
      maskGroup(overlayClip, 'full');
    }
  };

  const setLocomotion = (moving: boolean, grounded: boolean) => {
    wantsMoving = moving;
    wantsGrounded = grounded;
    if (overlaying) {
      syncOverlayLocomotion();
      return;
    }
    if (cinematic) return;
    applyLocomotion();
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
    cinematic = false;
    overlaying = false;
    overlayClip = null;
    pendingClip = null;
    applyLocomotion();
  };

  void loadGlbByAssetId(scene, assetId, modelRoot).then((imported) => {
    if (!imported || disposed) {
      imported?.meshes.forEach((mesh) => mesh.dispose());
      imported?.animationGroups.forEach((clip) => clip.dispose());
      imported?.skeletons.forEach((skeleton) => skeleton.dispose());
      return;
    }

    imported.meshes.forEach((mesh) => {
      mesh.isPickable = false;
    });
    animationGroups = imported.animationGroups;
    skeletons = imported.skeletons;
    idleGroup = findClip(animationGroups, 'idle');
    walkGroup = findClip(animationGroups, 'walk');
    jumpGroup = findClip(animationGroups, 'jump');
    pistolIdleGroup = findClip(animationGroups, 'pistolIdle');
    pistolWalkGroup = findClip(animationGroups, 'pistolWalk');
    pistolJumpGroup = findClip(animationGroups, 'pistolJump');
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
      if (!playClip(queued.keyword, queued.loop, queued.speedRatio, queued.onEnded)) applyLocomotion();
    } else {
      applyLocomotion();
    }
  });

  const playClip = (keyword: string, loop = true, speedRatio = 1, onEnded?: () => void) => {
    if (animationGroups.length === 0) {
      cinematic = true;
      pendingClip = { keyword, loop, speedRatio, onEnded };
      current = keyword.toLowerCase();
      return true;
    }
    const clip = findClip(animationGroups, keyword);
    if (!clip) return false;
    const token = keyword.toLowerCase();
    if (!loop && cinematic && current === token) return true;
    const gen = ++playGen;
    cinematic = true;
    overlaying = WEAPON_OVERLAY.has(token);
    overlayArmed = token === 'holster' ? false : token === 'draw' || token === 'shoot' ? true : armed;
    overlayClip = overlaying ? clip : null;
    const speed = clipSpeedRatios[token] ?? speedRatio;
    const keepWalk = overlaying && wantsMoving && wantsGrounded ? overlayWalk() : null;
    animationGroups.forEach((groupClip) => {
      if (groupClip === clip || groupClip === keepWalk) return;
      if (groupClip.isPlaying) groupClip.stop();
    });
    clip.enableBlending = true;
    clip.blendingSpeed = 0.12;
    clip.start(loop, speed, clip.from, clip.to, false);
    current = token;
    if (overlaying) syncOverlayLocomotion();
    if (!loop && onEnded) {
      clip.onAnimationGroupEndObservable.addOnce(() => {
        if (gen !== playGen || current !== token) return;
        onEnded();
      });
    }
    return true;
  };

  return {
    group,
    setLocomotion,
    setArmed,
    playClip,
    resumeLocomotion,
    dispose: () => {
      disposed = true;
      animationGroups.forEach((clip) => clip.dispose());
      skeletons.forEach((skeleton) => skeleton.dispose());
      group.dispose();
    },
  };
};

export const createPlayerAvatar = (scene: BABYLON.Scene): PlayerAvatar =>
  createCharacterAvatar(scene, 'playerAvatar', PLAYER_ASSET_ID, 1.3, PLAYER_CLIP_SPEEDS);
