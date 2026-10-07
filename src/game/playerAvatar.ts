import * as BABYLON from '@babylonjs/core';

import { createHumanoid } from './enemies';
import { getAssetLibrary } from './sceneData';

// Asset library id for the player's real visual model (see
// assets/asset-library.json and the editor's Import Model dialog, which
// produces GLBs with this naming convention: asset-<name>).
const PLAYER_ASSET_ID = 'asset-ch44-hero';

export type PlayerAvatar = {
  group: BABYLON.TransformNode;
  // Switches between the Idle/Walk animation clips (matched by name,
  // case-insensitively) once the real model and its AnimationGroups have
  // finished loading. Safe to call before load completes -- the desired
  // state is remembered and applied as soon as animations are available.
  setMoving: (isMoving: boolean) => void;
  dispose: () => void;
};

// Loads the player's real character model (with Idle/Walk animation clips
// merged in via the Mixamo import pipeline) and swaps it in for the
// placeholder box-humanoid once ready. Mirrors the placeholder-then-replace
// pattern used for 'model' scene assets in sceneData.ts, but for the
// player's own avatar rather than a level-placed instance.
export const createPlayerAvatar = (scene: BABYLON.Scene): PlayerAvatar => {
  const group = new BABYLON.TransformNode('playerAvatarRoot', scene);

  const placeholder = createHumanoid(scene, new BABYLON.Color3(0.22, 0.9, 1), false);
  placeholder.group.parent = group;

  // Loaded meshes are parented under this inner node (rather than directly
  // under `group`) so a per-model forward-facing correction can be applied
  // here later without touching the gameplay rotation/position logic that
  // drives `group`.
  const modelRoot = new BABYLON.TransformNode('playerAvatarModelRoot', scene);
  modelRoot.parent = group;

  let animationGroups: BABYLON.AnimationGroup[] = [];
  let idleGroup: BABYLON.AnimationGroup | null = null;
  let walkGroup: BABYLON.AnimationGroup | null = null;
  let wantsMoving = false;
  let loadedMeshes: BABYLON.AbstractMesh[] = [];
  let disposed = false;

  const findClip = (keyword: string) =>
    animationGroups.find((clip) => clip.name.toLowerCase().includes(keyword)) ?? null;

  const playGroup = (target: BABYLON.AnimationGroup | null) => {
    animationGroups.forEach((clip) => {
      if (clip !== target && clip.isPlaying) clip.stop();
    });
    if (target && !target.isPlaying) target.start(true, 1.0, target.from, target.to, false);
  };

  const setMoving = (isMoving: boolean) => {
    wantsMoving = isMoving;
    if (!idleGroup && !walkGroup) return;
    playGroup(isMoving ? walkGroup ?? idleGroup : idleGroup ?? walkGroup);
  };

  void (async () => {
    const library = await getAssetLibrary();
    const entry = library.find((item) => item.id === PLAYER_ASSET_ID);
    if (!entry || disposed) return;

    try {
      const lastSlash = entry.path.lastIndexOf('/');
      const rootUrl = entry.path.slice(0, lastSlash + 1);
      const fileName = entry.path.slice(lastSlash + 1);
      const result = await BABYLON.SceneLoader.ImportMeshAsync('', rootUrl, fileName, scene);
      if (disposed) {
        result.meshes.forEach((mesh) => mesh.dispose());
        result.animationGroups.forEach((clip) => clip.dispose());
        return;
      }

      placeholder.group.dispose();
      loadedMeshes = result.meshes;
      result.meshes.forEach((mesh) => {
        if (mesh.parent === null) mesh.parent = modelRoot;
      });

      animationGroups = result.animationGroups;
      animationGroups.forEach((clip) => clip.stop());
      idleGroup = findClip('idle');
      walkGroup = findClip('walk');
      if (!idleGroup && !walkGroup && animationGroups.length) {
        console.warn(
          `Player model has animation clips but none matched "idle"/"walk" by name: ${animationGroups
            .map((clip) => clip.name)
            .join(', ')}`,
        );
      }
      playGroup(wantsMoving ? walkGroup ?? idleGroup : idleGroup ?? walkGroup);
    } catch (error) {
      console.warn(`Failed to load player avatar model "${entry.path}":`, error);
    }
  })();

  const dispose = () => {
    disposed = true;
    animationGroups.forEach((clip) => clip.dispose());
    loadedMeshes.forEach((mesh) => mesh.dispose());
    group.dispose();
  };

  return { group, setMoving, dispose };
};
