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

const boneY = (avatar: PlayerAvatar, suffix: string) => {
  const bone = avatar.findBone(suffix);
  return bone ? bone.getAbsolutePosition().y : null;
};

/** Lowest posed limb. A death clip often leaves that point in the air. */
const lowestLimb = (avatar: PlayerAvatar) => {
  let low = Number.POSITIVE_INFINITY;
  for (const suffix of ['leftfoot', 'rightfoot', 'lefthand', 'righthand', 'head', 'hips']) {
    const y = boneY(avatar, suffix);
    if (y == null || !Number.isFinite(y)) continue;
    if (y < low) low = y;
  }
  return Number.isFinite(low) ? low : null;
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
 * Death clips hold the last frame with the hips still up, so the body floats.
 * Drop the visual root until the lowest limb meets the sidewalk.
 */
export const restOnFloor = (avatar: PlayerAvatar, floorY: number) => {
  const skinned = avatar.getSkinnedMesh();
  if (!skinned || skinned.isDisposed()) return false;
  skinned.skeleton?.computeAbsoluteTransforms(true);
  skinned.computeWorldMatrix(true);
  const low = lowestLimb(avatar);
  if (low == null) return false;
  const gap = low - (floorY + 0.05);
  if (!Number.isFinite(gap) || gap <= 0.04) return true;
  avatar.group.position.y -= gap;
  return true;
};

/** Count while the death clip plays, then snap the held pose onto the ground. */
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
  const wait = length == null ? 1.2 : length + 0.08;
  if (next < wait) return { age: next, resting: false };
  return { age: next, resting: restOnFloor(avatar, floorY) };
};
