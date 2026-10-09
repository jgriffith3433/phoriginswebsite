import * as BABYLON from '@babylonjs/core';

const MAX_RANGE = 16;
/** About 41 degrees off the crosshair. Wider than that is not "in front". */
const MIN_DOT = 0.75;
const BODY_CLEARANCE = 0.35;

export type AutoAim = {
  update: (camera: BABYLON.Camera, points: readonly BABYLON.Vector3[], count: number) => void;
  direction: () => BABYLON.Vector3 | null;
  point: () => BABYLON.Vector3 | null;
  clear: () => void;
};

/**
 * Picks the target most in front of the camera when a solid collider's box
 * does not sit between the camera and that point. Boxes only, so a drawn
 * weapon can test this every frame without a scene triangle pick.
 */
export const createAutoAim = (
  scene: BABYLON.Scene,
  skip: (mesh: BABYLON.AbstractMesh) => boolean,
): AutoAim => {
  const ray = new BABYLON.Ray(BABYLON.Vector3.Zero(), BABYLON.Vector3.Forward(), 1);
  const toward = new BABYLON.Vector3();
  const forward = new BABYLON.Vector3();
  const locked = new BABYLON.Vector3();
  const lockedPoint = new BABYLON.Vector3();
  const solids: BABYLON.AbstractMesh[] = [];
  let hasLock = false;
  let solidsUntil = 0;

  const solidMeshes = () => {
    const now = performance.now();
    if (now < solidsUntil) return solids;
    solidsUntil = now + 250;
    solids.length = 0;
    const meshes = scene.meshes;
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      if (mesh?.checkCollisions) solids.push(mesh);
    }
    return solids;
  };

  const blocked = (origin: BABYLON.Vector3, distance: number) => {
    const limit = distance - BODY_CLEARANCE;
    if (limit <= 0.2) return false;
    const limitSq = limit * limit;
    ray.origin.copyFrom(origin);
    ray.direction.copyFrom(toward);
    ray.length = limit;
    const meshes = solidMeshes();
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      if (!mesh.checkCollisions || !mesh.isEnabled() || skip(mesh)) continue;
      const box = mesh.getBoundingInfo().boundingBox;
      const min = box.minimumWorld;
      const max = box.maximumWorld;
      const cx = Math.max(min.x, Math.min(origin.x, max.x));
      const cy = Math.max(min.y, Math.min(origin.y, max.y));
      const cz = Math.max(min.z, Math.min(origin.z, max.z));
      const dx = cx - origin.x;
      const dy = cy - origin.y;
      const dz = cz - origin.z;
      if (dx * dx + dy * dy + dz * dz > limitSq) continue;
      if (ray.intersectsBoxMinMax(min, max)) return true;
    }
    return false;
  };

  return {
    clear: () => {
      hasLock = false;
    },
    direction: () => (hasLock ? locked : null),
    point: () => (hasLock ? lockedPoint : null),
    update: (camera, points, count) => {
      hasLock = false;
      if (count <= 0) return;
      const origin = camera.globalPosition;
      camera.getDirectionToRef(BABYLON.Vector3.Forward(), forward);
      let best = -1;
      let bestDot = MIN_DOT;
      for (let i = 0; i < count; i++) {
        const point = points[i];
        if (!point) continue;
        toward.copyFrom(point).subtractInPlace(origin);
        const dist = toward.length();
        if (dist < 0.6 || dist > MAX_RANGE) continue;
        toward.scaleInPlace(1 / dist);
        const dot = BABYLON.Vector3.Dot(forward, toward);
        if (dot <= bestDot) continue;
        best = i;
        bestDot = dot;
      }
      if (best < 0) return;
      const point = points[best];
      if (!point) return;
      toward.copyFrom(point).subtractInPlace(origin);
      const dist = toward.length();
      if (dist < 0.6) return;
      toward.scaleInPlace(1 / dist);
      if (blocked(origin, dist)) return;
      locked.copyFrom(toward);
      lockedPoint.copyFrom(point);
      hasLock = true;
    },
  };
};
