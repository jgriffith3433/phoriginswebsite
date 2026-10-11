import * as BABYLON from '@babylonjs/core';

import type { PlayerAvatar } from '../game/playerAvatar';

/** Possess length. Raise this when the duration is upgraded. */
export const POSSESS_SECONDS = 30;

/** How long Shift can keep Shadow running. Raise this when the duration is upgraded. */
export const SHADOW_RUN_SECONDS = 10;

/** Shadow-mode Shift used to be 1.75× walk. Shadow running is three times that. */
export const SHADOW_RUN_SPEED = 1.75 * 3;

/** How long a corpse stays, counted from the moment of death. */
export const CORPSE_SECONDS = 60;

const hipHeight = (avatar: PlayerAvatar) => {
  const hips = avatar.findBone('hips');
  return hips ? hips.getAbsolutePosition().y : null;
};

/** Surface under a person. Falls back to the height their feet already use. */
export const floorUnder = (
  scene: BABYLON.Scene,
  x: number,
  z: number,
  feetY: number,
  ignore: BABYLON.Node | null,
) => {
  const ray = new BABYLON.Ray(new BABYLON.Vector3(x, 1.5, z), new BABYLON.Vector3(0, -1, 0), 3.5);
  const hits = scene.multiPickWithRay(ray, (mesh) => {
    if (!mesh.isEnabled() || !mesh.isPickable || mesh.skeleton) return false;
    if (ignore && (mesh === ignore || mesh.isDescendantOf(ignore))) return false;
    return true;
  });
  let best = feetY;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const hit of hits ?? []) {
    if (!hit.hit || !hit.pickedPoint || hit.distance >= bestDist) continue;
    const normal = hit.getNormal(true);
    if (!normal || normal.y < 0.55) continue;
    bestDist = hit.distance;
    best = hit.pickedPoint.y;
  }
  return best;
};

/**
 * Death clips leave the hips up, so the posed mesh floats.
 * Drop the visual root (the group under PLAYER_MESH_Y_OFFSET) until the body meets the floor.
 */
export const restOnFloor = (avatar: PlayerAvatar, floorY: number) => {
  const skinned = avatar.getSkinnedMesh();
  if (!skinned || skinned.isDisposed()) return false;
  skinned.skeleton?.computeAbsoluteTransforms(true);
  skinned.computeWorldMatrix(true);
  skinned.refreshBoundingInfo(true, false);
  const minY = skinned.getBoundingInfo().boundingBox.minimumWorld.y;
  let gap = minY - floorY;
  const hipY = hipHeight(avatar);
  if (!Number.isFinite(gap) || (gap < 0.04 && hipY != null && hipY > floorY + 0.35)) {
    if (hipY == null) return false;
    gap = hipY - (floorY + 0.16);
  }
  if (!Number.isFinite(gap) || gap <= 0.02) return true;
  avatar.group.position.y -= gap;
  return true;
};

/** Count while the death clip plays, then snap once the held pose is the one on the ground. */
export const settleCorpse = (
  avatar: PlayerAvatar,
  floorY: number,
  clip: string,
  age: number,
  dt: number,
  resting: boolean,
) => {
  if (resting || !avatar.isReady()) return { age, resting };
  const next = age + dt;
  const length = avatar.clipDuration(clip);
  if (length == null || next < length + 0.12) return { age: next, resting: false };
  const hipY = hipHeight(avatar);
  if (hipY != null && hipY >= floorY + 0.82) return { age: next, resting: true };
  return { age: next, resting: restOnFloor(avatar, floorY) };
};
