import * as BABYLON from '@babylonjs/core';

import type { PlayerAvatar } from './playerAvatar';

/** Max vertical reach the IK will bridge (stairs, kerbs, shallow ramps). */
const REACH = 0.55;
/** A foot this close to its ground hit counts as planted. */
const PLANT_GAP = 0.035;
/** Cap on pelvis drop so the torso stays upright. */
const HIP_DROP_MAX = 0.16;
/** Extra crouch while the jump pose settles (pose 3..4). */
const LAND_CROUCH = 0.1;

type Limb = {
  hip: BABYLON.Bone;
  knee: BABYLON.Bone;
  foot: BABYLON.Bone;
  upper: number;
  lower: number;
};

export type FootSample = {
  left: { x: number; y: number; z: number; planted: boolean; drift: number };
  right: { x: number; y: number; z: number; planted: boolean; drift: number };
  maxPlantDrift: number;
  meanPlantDrift: number;
  plants: number;
  hipDrop: number;
};

const boneBy = (avatar: PlayerAvatar, suffix: string) => avatar.findBone(suffix);

const limbOf = (avatar: PlayerAvatar, side: 'left' | 'right'): Limb | null => {
  const hip = boneBy(avatar, `${side}upleg`) ?? boneBy(avatar, `${side}thigh`);
  const knee = boneBy(avatar, `${side}leg`) ?? boneBy(avatar, `${side}calf`);
  const foot = boneBy(avatar, `${side}foot`);
  if (!hip || !knee || !foot) return null;
  const upper = BABYLON.Vector3.Distance(hip.getAbsolutePosition(), knee.getAbsolutePosition()) || 0.42;
  const lower = BABYLON.Vector3.Distance(knee.getAbsolutePosition(), foot.getAbsolutePosition()) || 0.42;
  return { hip, knee, foot, upper, lower };
};

/**
 * Analytical two-bone IK after the clip poses the legs: raycast under each foot, bend hip+knee
 * so the sole sits on the hit, drop the pelvis toward the downhill foot (and a little more on a
 * landing). The avatar root stays upright — no body tilt on slopes.
 */
export const createFootIk = (scene: BABYLON.Scene) => {
  let avatar: PlayerAvatar | null = null;
  let mesh: BABYLON.AbstractMesh | null = null;
  let left: Limb | null = null;
  let right: Limb | null = null;
  let bound = false;
  let hipDrop = 0;
  let landCrouch = 0;
  const ray = new BABYLON.Ray(BABYLON.Vector3.Zero(), BABYLON.Vector3.Down(), REACH * 2);
  const plant = {
    left: { x: 0, z: 0, on: false, drift: 0 },
    right: { x: 0, z: 0, on: false, drift: 0 },
  };
  let maxPlantDrift = 0;
  let driftSum = 0;
  let plantCount = 0;
  const scratch = new BABYLON.Vector3();

  const predicate = (m: BABYLON.AbstractMesh) => {
    if (!m.isEnabled() || !m.checkCollisions) return false;
    if (avatar && m.isDescendantOf(avatar.group)) return false;
    return true;
  };

  const bind = (next: PlayerAvatar) => {
    avatar = next;
    mesh = next.getSkinnedMesh();
    left = limbOf(next, 'left');
    right = limbOf(next, 'right');
    // Re-measure lengths once the skeleton has posed.
    if (left) {
      left.upper = BABYLON.Vector3.Distance(left.hip.getAbsolutePosition(), left.knee.getAbsolutePosition()) || left.upper;
      left.lower = BABYLON.Vector3.Distance(left.knee.getAbsolutePosition(), left.foot.getAbsolutePosition()) || left.lower;
    }
    if (right) {
      right.upper = BABYLON.Vector3.Distance(right.hip.getAbsolutePosition(), right.knee.getAbsolutePosition()) || right.upper;
      right.lower = BABYLON.Vector3.Distance(right.knee.getAbsolutePosition(), right.foot.getAbsolutePosition()) || right.lower;
    }
    bound = !!(mesh && left && right);
    plant.left.on = false;
    plant.right.on = false;
  };

  const groundAt = (x: number, y: number, z: number): { y: number; nx: number; ny: number; nz: number } | null => {
    ray.origin.set(x, y + REACH, z);
    ray.direction.set(0, -1, 0);
    ray.length = REACH * 2;
    const info = scene.pickWithRay(ray, predicate, false);
    if (!info?.hit || !info.pickedPoint) return null;
    const n = info.getNormal(true);
    return {
      y: info.pickedPoint.y,
      nx: n?.x ?? 0,
      ny: n?.y ?? 1,
      nz: n?.z ?? 0,
    };
  };

  /**
   * Two-bone solve in the leg's bend plane: keep the hip fixed, put the foot at (fx, targetY, fz).
   * Mixamo knees bend around local +X (left) / -X (right).
   */
  const solveLimb = (limb: Limb, targetY: number, side: 'left' | 'right', hit: { nx: number; nz: number }) => {
    const hipPos = limb.hip.getAbsolutePosition();
    const footPos = limb.foot.getAbsolutePosition();
    const fx = footPos.x;
    const fz = footPos.z;
    const wantY = Math.min(hipPos.y - 0.04, Math.max(hipPos.y - limb.upper - limb.lower + 0.02, targetY));
    scratch.set(fx - hipPos.x, wantY - hipPos.y, fz - hipPos.z);
    const dist = Math.min(limb.upper + limb.lower - 0.012, Math.max(0.04, scratch.length()));
    const cosKnee = Math.max(-1, Math.min(1,
      (limb.upper * limb.upper + limb.lower * limb.lower - dist * dist)
      / (2 * limb.upper * limb.lower)));
    const kneeAngle = Math.PI - Math.acos(cosKnee);
    // Animated pose already has some bend; add the extra needed to reach the ground.
    const footNow = limb.foot.getAbsolutePosition();
    const gap = footNow.y - wantY;
    if (Math.abs(gap) < 0.008 && kneeAngle < 0.05) {
      // Already on the surface.
    } else {
      const sign = side === 'left' ? 1 : -1;
      // Scale bend by how far the foot still floats; full analytical when floating a lot.
      const weight = Math.max(0.15, Math.min(1, Math.abs(gap) / 0.25));
      const qKnee = limb.knee.getRotationQuaternion()?.clone() ?? BABYLON.Quaternion.Identity();
      const addKnee = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, sign * kneeAngle * 0.55 * weight);
      limb.knee.setRotationQuaternion(qKnee.multiply(addKnee));
      // Hip pitches a little so the thigh aims at the target.
      const qHip = limb.hip.getRotationQuaternion()?.clone() ?? BABYLON.Quaternion.Identity();
      const hipPitch = Math.asin(Math.max(-0.6, Math.min(0.6, (wantY - hipPos.y + limb.upper * 0.5) / (limb.upper + 0.01))));
      const addHip = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, sign * hipPitch * 0.35 * weight);
      limb.hip.setRotationQuaternion(qHip.multiply(addHip));
    }
    const pitch = Math.asin(Math.max(-0.4, Math.min(0.4, -hit.nz)));
    const roll = Math.asin(Math.max(-0.3, Math.min(0.3, hit.nx)));
    if (Math.abs(pitch) > 0.01 || Math.abs(roll) > 0.01) {
      const qFoot = limb.foot.getRotationQuaternion()?.clone() ?? BABYLON.Quaternion.Identity();
      limb.foot.setRotationQuaternion(
        qFoot.multiply(BABYLON.Quaternion.RotationYawPitchRoll(0, pitch * 0.5, roll * 0.5)),
      );
    }
  };

  const trackPlant = (side: 'left' | 'right', foot: BABYLON.Bone, groundY: number | null) => {
    const p = foot.getAbsolutePosition();
    const slot = plant[side];
    const near = groundY !== null && Math.abs(p.y - groundY) <= PLANT_GAP + 0.02;
    if (near) {
      if (!slot.on) {
        slot.on = true;
        slot.x = p.x;
        slot.z = p.z;
        slot.drift = 0;
      } else {
        const step = Math.hypot(p.x - slot.x, p.z - slot.z);
        if (step < 0.4) {
          slot.drift += step;
          maxPlantDrift = Math.max(maxPlantDrift, slot.drift);
        }
        slot.x = p.x;
        slot.z = p.z;
      }
    } else if (slot.on) {
      slot.on = false;
      if (slot.drift > 0.001) {
        driftSum += slot.drift;
        plantCount += 1;
      }
      slot.drift = 0;
    }
  };

  const update = (dt: number, landingPose: number | null, enabled = true): number => {
    if (!enabled || !bound || !avatar || !left || !right || !mesh) {
      hipDrop += (0 - hipDrop) * Math.min(1, dt * 10);
      return hipDrop;
    }
    if (!avatar.isReady() || !avatar.group.isEnabled()) return hipDrop;

    mesh.computeWorldMatrix(true);
    mesh.skeleton?.computeAbsoluteTransforms();

    const leftPos = left.foot.getAbsolutePosition();
    const rightPos = right.foot.getAbsolutePosition();
    const leftHit = groundAt(leftPos.x, leftPos.y, leftPos.z);
    const rightHit = groundAt(rightPos.x, rightPos.y, rightPos.z);

    if (leftHit) solveLimb(left, leftHit.y, 'left', leftHit);
    if (rightHit) solveLimb(right, rightHit.y, 'right', rightHit);
    mesh.skeleton?.computeAbsoluteTransforms();

    trackPlant('left', left.foot, leftHit?.y ?? null);
    trackPlant('right', right.foot, rightHit?.y ?? null);

    const wantLand = landingPose !== null && landingPose >= 3
      ? LAND_CROUCH * Math.min(1, Math.max(0, 4 - landingPose))
      : 0;
    landCrouch += (wantLand - landCrouch) * Math.min(1, dt * 14);

    let wantDrop = landCrouch;
    if (leftHit && rightHit) {
      wantDrop += Math.min(HIP_DROP_MAX, Math.abs(leftHit.y - rightHit.y) * 0.55);
    }
    hipDrop += (wantDrop - hipDrop) * Math.min(1, dt * 12);
    return hipDrop;
  };

  const sample = (): FootSample => {
    const zero = { x: 0, y: 0, z: 0 };
    const lp = left?.foot.getAbsolutePosition() ?? zero;
    const rp = right?.foot.getAbsolutePosition() ?? zero;
    return {
      left: { x: lp.x, y: lp.y, z: lp.z, planted: plant.left.on, drift: plant.left.drift },
      right: { x: rp.x, y: rp.y, z: rp.z, planted: plant.right.on, drift: plant.right.drift },
      maxPlantDrift,
      meanPlantDrift: plantCount ? driftSum / plantCount : 0,
      plants: plantCount,
      hipDrop,
    };
  };

  const resetDrift = () => {
    maxPlantDrift = 0;
    driftSum = 0;
    plantCount = 0;
    plant.left.on = false;
    plant.right.on = false;
  };

  return {
    bind,
    update,
    sample,
    resetDrift,
    ready: () => bound,
    dispose: () => {
      avatar = null;
      mesh = null;
      bound = false;
    },
  };
};

export type FootIk = ReturnType<typeof createFootIk>;
