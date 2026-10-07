import * as BABYLON from '@babylonjs/core';

import { PLAYER_ASSET_ID, loadGlbByAssetId } from './modelLoader';

export type PlayerAvatar = {
  group: BABYLON.TransformNode;
  setLocomotion: (moving: boolean, grounded: boolean) => void;
  playClip: (keyword: string, loop?: boolean, speedRatio?: number) => boolean;
  resumeLocomotion: () => void;
  dispose: () => void;
};

const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Last segment after `_` so prefixed clones (`…ModelRoot_2_SitIdle`) still match. */
const clipTail = (value: string) => {
  const slash = value.replace(/\\/g, '/');
  const base = slash.slice(slash.lastIndexOf('/') + 1);
  const parts = base.split('_');
  return parts[parts.length - 1] ?? base;
};

const hasTail = (clipName: string, pattern: RegExp) => pattern.test(clipName) || pattern.test(clipTail(clipName));

/** Keyword match on the clip tail. Prefers SitIdle over SitTalk for `sit`, standing Idle over SitIdle for `idle`. */
export const findClip = (clips: BABYLON.AnimationGroup[], keyword: string): BABYLON.AnimationGroup | null => {
  const key = keyword.trim().toLowerCase();
  if (!key || clips.length === 0) return null;
  const keyCompact = compact(key);
  const wantsTalk = key === 'talk' || keyCompact.includes('talk');
  const wantsSit = key === 'sit' || key === 'sitting' || keyCompact === 'sitidle' || (keyCompact.includes('sit') && !wantsTalk);
  const wantsIdle = key === 'idle' || keyCompact === 'idle';
  const wantsWalk = key === 'walk' || key === 'walking' || keyCompact === 'walk';
  const wantsJump = key === 'jump' || keyCompact === 'jump';

  const scored = clips.map((clip) => {
    const tail = clipTail(clip.name);
    const tailCompact = compact(tail);
    let score = 0;
    if (tail.toLowerCase() === key || tailCompact === keyCompact) score += 100;
    if (wantsTalk) {
      if (hasTail(clip.name, /(?:^|_)SitTalk$/i) || tailCompact === 'sittalk' || tailCompact === 'talk') score += 80;
      else if (tailCompact.includes('talk')) score += 40;
      else score -= 50;
    } else if (wantsSit) {
      if (hasTail(clip.name, /(?:^|_)SitIdle$/i) || tailCompact === 'sitidle' || tailCompact === 'sit') score += 80;
      else if (tailCompact.includes('sit') && !tailCompact.includes('talk')) score += 40;
      else if (tailCompact.includes('talk')) score -= 40;
    } else if (wantsIdle) {
      if (hasTail(clip.name, /(?:^|_)Idle$/i) && !/sit/i.test(tail)) score += 80;
      else if (tailCompact === 'idle') score += 80;
    } else if (wantsWalk) {
      if (hasTail(clip.name, /(?:^|_)Walk(?:ing)?$/i) || tailCompact === 'walk' || tailCompact === 'walking') score += 80;
    } else if (wantsJump) {
      if (hasTail(clip.name, /(?:^|_)Jump$/i) || tailCompact === 'jump') score += 80;
    } else if (keyCompact.length >= 3 && tailCompact.includes(keyCompact)) {
      score += 20;
    }
    return { clip, score };
  }).filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.clip ?? null;
};

export const createCharacterAvatar = (
  scene: BABYLON.Scene,
  name = 'characterAvatar',
  assetId = PLAYER_ASSET_ID,
  jumpSpeedRatio = 1,
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
  let current: string | null = null;
  let wantsMoving = false;
  let wantsGrounded = true;
  let disposed = false;
  let cinematic = false;
  let pendingClip: { keyword: string; loop: boolean } | null = null;

  const playLoop = (target: BABYLON.AnimationGroup | null, name: string) => {
    if (!target || current === name) return;
    animationGroups.forEach((clip) => {
      if (clip !== target && clip.isPlaying) clip.stop();
    });
    target.start(true, 1.0, target.from, target.to, false);
    current = name;
  };

  const playJump = () => {
    if (!jumpGroup || current === 'jump') return;
    animationGroups.forEach((clip) => {
      if (clip !== jumpGroup && clip.isPlaying) clip.stop();
    });
    jumpGroup.start(false, jumpSpeedRatio, jumpGroup.from, jumpGroup.to, false);
    current = 'jump';
  };

  const applyLocomotion = () => {
    if (!wantsGrounded && jumpGroup) {
      playJump();
      return;
    }
    playLoop(wantsMoving ? walkGroup ?? idleGroup : idleGroup ?? walkGroup, wantsMoving ? 'walk' : 'idle');
  };

  const setLocomotion = (moving: boolean, grounded: boolean) => {
    wantsMoving = moving;
    wantsGrounded = grounded;
    if (cinematic) return;
    applyLocomotion();
  };

  const resumeLocomotion = () => {
    cinematic = false;
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
    const sitGroup = findClip(animationGroups, 'sit');
    if (!idleGroup && animationGroups.length === 1 && !sitGroup) idleGroup = animationGroups[0];
    if (!idleGroup && !walkGroup && !sitGroup && animationGroups.length) {
      console.warn(
        `${name} loaded ${animationGroups.length} clip(s) but none matched idle/walk/sit:`,
        animationGroups.map((clip) => clip.name),
      );
    }
    const hipBone = skeletons[0]?.bones.find((bone) => /:hips$/i.test(bone.name) || /(^|_)hips$/i.test(bone.name));
    const hipNode = hipBone?.getTransformNode() ?? null;
    const skinned = imported.meshes.find((mesh) => mesh.skeleton);
    const skinHip = skinned?.skeleton?.bones.find((bone) => /:hips$/i.test(bone.name) || /(^|_)hips$/i.test(bone.name));
    const skinJointNode = skinHip?.getTransformNode() ?? null;
    const probe = sitGroup ?? idleGroup ?? animationGroups[0];
    const hipsChannel = probe?.targetedAnimations.find((channel) => {
      const targetName = String((channel.target as { name?: string } | undefined)?.name ?? '');
      return /:hips$/i.test(targetName) || /(^|_)hips$/i.test(targetName);
    });
    const probeTarget = hipsChannel?.target as { name?: string; uniqueId?: number } | undefined;
    const targetId = probeTarget?.uniqueId;
    const skinJointId = skinJointNode?.uniqueId;

    if (pendingClip) {
      const queued = pendingClip;
      pendingClip = null;
      if (!playClip(queued.keyword, queued.loop)) applyLocomotion();
    } else {
      applyLocomotion();
    }
  });

  const playClip = (keyword: string, loop = true, speedRatio = 1) => {
    if (animationGroups.length === 0) {
      cinematic = true;
      pendingClip = { keyword, loop };
      current = keyword.toLowerCase();
      return true;
    }
    const clip = findClip(animationGroups, keyword);
    if (!clip) return false;
    cinematic = true;
    animationGroups.forEach((groupClip) => {
      if (groupClip !== clip && groupClip.isPlaying) groupClip.stop();
    });
    clip.start(loop, speedRatio, clip.from, clip.to, false);
    current = keyword.toLowerCase();
    return true;
  };

  return {
    group,
    setLocomotion,
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
  createCharacterAvatar(scene, 'playerAvatar', PLAYER_ASSET_ID, 1.3);
