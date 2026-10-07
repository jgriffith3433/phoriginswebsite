import * as BABYLON from '@babylonjs/core';

import { clampValue } from './physics';
import { playerMeshY } from './player';

export type ThirdPersonCameraConfig = {
  distance: number;
  minDistance: number;
  maxDistance: number;
  height: number;
  pivotHeight: number;
  minPitch: number;
  maxPitch: number;
  mouseSensitivity: number;
  stickSensitivity: number;
  zoomSensitivity: number;
  collisionRadius: number;
  followStiffness: number;
  lookAtStiffness: number;
  collisionInStiffness: number;
  collisionOutStiffness: number;
  enableMoveRecenter: boolean;
  recenterDelay: number;
  recenterStiffness: number;
  fov: number;
  minZ: number;
  maxZ: number;
};

export const DEFAULT_CAMERA_CONFIG: ThirdPersonCameraConfig = {
  distance: 5.6,
  minDistance: 1.35,
  maxDistance: 11,
  height: 0.18,
  pivotHeight: 1.52,
  minPitch: -0.38,
  maxPitch: 1.02,
  mouseSensitivity: 0.00205,
  stickSensitivity: 2.55,
  zoomSensitivity: 0.55,
  collisionRadius: 0.34,
  followStiffness: 18,
  lookAtStiffness: 24,
  collisionInStiffness: 32,
  collisionOutStiffness: 7.5,
  enableMoveRecenter: true,
  recenterDelay: 0.32,
  recenterStiffness: 2.8,
  fov: 0.9,
  minZ: 0.12,
  maxZ: 400,
};

const expDamp = (current: number, target: number, stiffness: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-stiffness * dt));

export const lerpAngle = (from: number, to: number, t: number) => {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
};

const dampAngle = (from: number, to: number, stiffness: number, dt: number) =>
  lerpAngle(from, to, 1 - Math.exp(-stiffness * dt));

export const createThirdPersonCamera = (
  scene: BABYLON.Scene,
  config: Partial<ThirdPersonCameraConfig> = {},
) => {
  const cfg: ThirdPersonCameraConfig = { ...DEFAULT_CAMERA_CONFIG, ...config };

  const camera = new BABYLON.UniversalCamera('playerCamera', new BABYLON.Vector3(0, 3.2, -8), scene);
  camera.fov = cfg.fov;
  camera.minZ = cfg.minZ;
  camera.maxZ = cfg.maxZ;
  camera.inertia = 0;
  camera.inputs.clear();

  let yaw = 0;
  let pitch = 0.1;
  let cinematicPos: BABYLON.Vector3 | null = null;
  let cinematicLook: BABYLON.Vector3 | null = null;
  let desiredDistance = cfg.distance;
  let currentDistance = cfg.distance;
  let lookStickX = 0;
  let lookStickY = 0;
  let lookInputTimer = 0;
  let recenterIdle = 0;

  const pivot = new BABYLON.Vector3(0, cfg.pivotHeight, 0);
  const lookAt = new BABYLON.Vector3(0, cfg.pivotHeight, 0);
  const desiredPos = new BABYLON.Vector3();
  const smoothedPos = new BABYLON.Vector3(0, 3.2, -8);
  const offsetDir = new BABYLON.Vector3();
  const ray = new BABYLON.Ray(BABYLON.Vector3.Zero(), BABYLON.Vector3.Forward(), 1);

  const addLook = (dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    yaw += dx * cfg.mouseSensitivity;
    pitch = clampValue(pitch + dy * cfg.mouseSensitivity * 0.78, cfg.minPitch, cfg.maxPitch);
    lookInputTimer = 0.12;
    recenterIdle = 0;
  };

  const setLookStick = (x: number, y: number) => {
    lookStickX = clampValue(x, -1, 1);
    lookStickY = clampValue(y, -1, 1);
  };

  const setZoom = (wheelDelta: number) => {
    desiredDistance = clampValue(desiredDistance + wheelDelta * cfg.zoomSensitivity, cfg.minDistance + 0.8, cfg.maxDistance);
  };

  const reset = (nextYaw = 0, nextPitch = 0.1) => {
    yaw = nextYaw;
    pitch = clampValue(nextPitch, cfg.minPitch, cfg.maxPitch);
    desiredDistance = cfg.distance;
    currentDistance = cfg.distance;
    lookStickX = 0;
    lookStickY = 0;
    lookInputTimer = 0;
    recenterIdle = 0;
    pivot.set(0, cfg.pivotHeight, 0);
    lookAt.copyFrom(pivot);
    smoothedPos.set(0, cfg.pivotHeight + cfg.height + 2.2, -cfg.distance);
    camera.position.copyFrom(smoothedPos);
    camera.setTarget(pivot);
  };

  const isLooking = () => lookInputTimer > 0 || Math.hypot(lookStickX, lookStickY) > 0.08;

  const desiredOffset = (distance: number, into: BABYLON.Vector3) => {
    const cosPitch = Math.cos(pitch);
    into.set(
      -Math.sin(yaw) * cosPitch * distance,
      cfg.height + Math.sin(pitch) * distance,
      -Math.cos(yaw) * cosPitch * distance,
    );
    return into;
  };

  const collideDistance = (origin: BABYLON.Vector3, target: BABYLON.Vector3, ignore: Set<BABYLON.AbstractMesh>) => {
    offsetDir.copyFrom(target).subtractInPlace(origin);
    const maxDist = offsetDir.length();
    if (maxDist < 0.001) return cfg.minDistance;
    offsetDir.scaleInPlace(1 / maxDist);
    const skin = Math.min(0.45, maxDist * 0.2);
    ray.origin.copyFrom(origin).addInPlace(offsetDir.scale(skin));
    ray.direction.copyFrom(offsetDir);
    ray.length = Math.max(0.01, maxDist - skin);

    const hit = scene.pickWithRay(ray, (mesh) => {
      if (!mesh || !mesh.isEnabled()) return false;
      if (ignore.has(mesh)) return false;
      return mesh.isPickable;
    });

    if (hit?.hit && typeof hit.distance === 'number') {
      return clampValue(hit.distance + skin - cfg.collisionRadius, cfg.minDistance, maxDist);
    }
    return maxDist;
  };

  const update = (
    dt: number,
    player: { x: number; y: number; z: number },
    moving: boolean,
    moveHeading: number | null,
    ignoreMeshes: BABYLON.AbstractMesh[],
  ) => {
    const clampedDt = Math.min(dt, 0.05);
    if (cinematicPos && cinematicLook) {
      camera.position.x = expDamp(camera.position.x, cinematicPos.x, 4.2, clampedDt);
      camera.position.y = expDamp(camera.position.y, cinematicPos.y, 4.2, clampedDt);
      camera.position.z = expDamp(camera.position.z, cinematicPos.z, 4.2, clampedDt);
      lookAt.x = expDamp(lookAt.x, cinematicLook.x, 5.5, clampedDt);
      lookAt.y = expDamp(lookAt.y, cinematicLook.y, 5.5, clampedDt);
      lookAt.z = expDamp(lookAt.z, cinematicLook.z, 5.5, clampedDt);
      camera.setTarget(lookAt);
      camera.upVector.set(0, 1, 0);
      return;
    }
    const ignore = new Set(ignoreMeshes);

    if (Math.hypot(lookStickX, lookStickY) > 0.04) {
      yaw += lookStickX * cfg.stickSensitivity * clampedDt;
      pitch = clampValue(pitch - lookStickY * cfg.stickSensitivity * 0.85 * clampedDt, cfg.minPitch, cfg.maxPitch);
      lookInputTimer = 0.12;
      recenterIdle = 0;
    }

    lookInputTimer = Math.max(0, lookInputTimer - clampedDt);

    if (cfg.enableMoveRecenter && moving && moveHeading !== null && !isLooking()) {
      recenterIdle += clampedDt;
      if (recenterIdle >= cfg.recenterDelay) {
        yaw = dampAngle(yaw, moveHeading, cfg.recenterStiffness, clampedDt);
      }
    } else {
      recenterIdle = 0;
    }

    const pivotTargetX = player.x;
    const pivotTargetY = playerMeshY(player.y) + cfg.pivotHeight;
    const pivotTargetZ = player.z;
    pivot.x = expDamp(pivot.x, pivotTargetX, cfg.followStiffness, clampedDt);
    pivot.y = expDamp(pivot.y, pivotTargetY, cfg.followStiffness, clampedDt);
    pivot.z = expDamp(pivot.z, pivotTargetZ, cfg.followStiffness, clampedDt);

    desiredOffset(desiredDistance, desiredPos);
    desiredPos.addInPlace(pivot);

    const blocked = collideDistance(pivot, desiredPos, ignore);
    const stiffness = blocked < currentDistance - 0.02 ? cfg.collisionInStiffness : cfg.collisionOutStiffness;
    currentDistance = expDamp(currentDistance, Math.min(desiredDistance, blocked), stiffness, clampedDt);

    desiredOffset(currentDistance, smoothedPos);
    smoothedPos.addInPlace(pivot);

    const lookForward = 0.35;
    lookAt.x = expDamp(lookAt.x, pivot.x + Math.sin(yaw) * lookForward, cfg.lookAtStiffness, clampedDt);
    lookAt.y = expDamp(lookAt.y, pivot.y, cfg.lookAtStiffness, clampedDt);
    lookAt.z = expDamp(lookAt.z, pivot.z + Math.cos(yaw) * lookForward, cfg.lookAtStiffness, clampedDt);

    camera.position.copyFrom(smoothedPos);
    camera.setTarget(lookAt);
    camera.upVector.set(0, 1, 0);
  };

  reset();

  const setCinematic = (position: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }) => {
    cinematicPos = new BABYLON.Vector3(position.x, position.y, position.z);
    cinematicLook = new BABYLON.Vector3(target.x, target.y, target.z);
  };

  const clearCinematic = () => {
    cinematicPos = null;
    cinematicLook = null;
  };

  return {
    camera,
    config: cfg,
    addLook,
    setLookStick,
    setZoom,
    reset,
    update,
    isLooking,
    setCinematic,
    clearCinematic,
    getYaw: () => yaw,
    getPitch: () => pitch,
  };
};

export type ThirdPersonCamera = ReturnType<typeof createThirdPersonCamera>;
