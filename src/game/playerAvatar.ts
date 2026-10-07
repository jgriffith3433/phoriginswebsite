import * as BABYLON from '@babylonjs/core';

import { PLAYER_ASSET_ID, loadGlbByAssetId } from './modelLoader';

export type PlayerAvatar = {
  group: BABYLON.TransformNode;
  setLocomotion: (moving: boolean, grounded: boolean) => void;
  playClip: (keyword: string, loop?: boolean) => boolean;
  resumeLocomotion: () => void;
  dispose: () => void;
};

const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
const tokens = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Keyword match that prefers SitIdle over SitTalk for `sit`, and standing Idle over SitIdle for `idle`. */
export const findClip = (clips: BABYLON.AnimationGroup[], keyword: string): BABYLON.AnimationGroup | null => {
  const key = keyword.trim().toLowerCase();
  if (!key || clips.length === 0) return null;
  const keyCompact = compact(key);
  const keyTokens = tokens(key);
  const wantsTalk = key === 'talk' || keyTokens.includes('talk');
  const wantsSit = key === 'sit' || keyTokens.includes('sit') || keyTokens.includes('sitting');
  const wantsIdle = key === 'idle' || (keyTokens.includes('idle') && !wantsSit);

  const scored = clips.map((clip) => {
    const name = clip.name.toLowerCase();
    const nameCompact = compact(clip.name);
    const nameTokens = tokens(clip.name);
    const clipTalk = nameCompact.includes('talk');
    const clipSit = nameCompact.includes('sit');
    let score = 0;
    if (name === key || nameCompact === keyCompact) score += 100;
    if (keyCompact.length >= 3 && nameCompact.includes(keyCompact)) score += 20;
    if (keyTokens.length > 0 && keyTokens.every((token) => nameCompact.includes(token))) score += 15;
    if (wantsTalk && clipTalk) score += 40;
    if (wantsTalk && !clipTalk) score -= 50;
    if (wantsSit && !wantsTalk && clipSit && !clipTalk) score += 40;
    if (wantsSit && !wantsTalk && clipTalk) score -= 40;
    if (wantsIdle && clipSit) score -= 50;
    if (wantsIdle && nameTokens.includes('idle') && !clipSit) score += 40;
    return { clip, score };
  }).filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.clip ?? null;
};

export const createCharacterAvatar = (scene: BABYLON.Scene, name = 'characterAvatar'): PlayerAvatar => {
  const group = new BABYLON.TransformNode(`${name}Root`, scene);
  const modelRoot = new BABYLON.TransformNode(`${name}ModelRoot`, scene);
  modelRoot.parent = group;
  // Mixamo/ch44 faces +Z; gameplay yaw treats -Z as forward (away from the camera).
  modelRoot.rotation.y = Math.PI;

  let animationGroups: BABYLON.AnimationGroup[] = [];
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
    jumpGroup.start(false, 1.0, jumpGroup.from, jumpGroup.to, false);
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

  void loadGlbByAssetId(scene, PLAYER_ASSET_ID, modelRoot).then((imported) => {
    if (!imported || disposed) {
      imported?.meshes.forEach((mesh) => mesh.dispose());
      imported?.animationGroups.forEach((clip) => clip.dispose());
      return;
    }

    imported.meshes.forEach((mesh) => {
      mesh.isPickable = false;
    });
    animationGroups = imported.animationGroups;
    idleGroup = findClip(animationGroups, 'idle');
    walkGroup = findClip(animationGroups, 'walk');
    jumpGroup = findClip(animationGroups, 'jump');
    if (!idleGroup && animationGroups.length === 1) idleGroup = animationGroups[0];
    if (pendingClip) {
      const queued = pendingClip;
      pendingClip = null;
      if (!playClip(queued.keyword, queued.loop)) applyLocomotion();
    } else {
      applyLocomotion();
    }
  });

  const playClip = (keyword: string, loop = true) => {
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
    clip.start(loop, 1.0, clip.from, clip.to, false);
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
      group.dispose();
    },
  };
};

export const createPlayerAvatar = (scene: BABYLON.Scene): PlayerAvatar =>
  createCharacterAvatar(scene, 'playerAvatar');
