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
  /** World meters to the character's right when the pistol is drawn. */
  shoulderOffset: number;
  shoulderStiffness: number;
  drawnDistanceDelta: number;
  /** Former mouse-wheel close stop. Used while the pistol or phone light is out. */
  equippedDistance: number;
};

export const DEFAULT_CAMERA_CONFIG: ThirdPersonCameraConfig = {
  distance: 5.6,
  minDistance: 1.05,
  maxDistance: 11,
  height: 0.18,
  pivotHeight: 1.52,
  minPitch: -0.38,
  maxPitch: 1.02,
  mouseSensitivity: 0.00205,
  stickSensitivity: 2.55,
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
  shoulderOffset: 0.55,
  shoulderStiffness: 8.2,
  drawnDistanceDelta: -0.4,
  equippedDistance: 1.55,
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
  let mouseFlick = false;
  let holdAim = false;
  const aimSpot = new BABYLON.Vector3();
  let recenterIdle = 0;
  let shoulderTarget = 0;
  let shoulderMix = 0;
  let toolClose = false;

  const pivot = new BABYLON.Vector3(0, cfg.pivotHeight, 0);
  const lookAt = new BABYLON.Vector3(0, cfg.pivotHeight, 0);
  const desiredPos = new BABYLON.Vector3();
  const smoothedPos = new BABYLON.Vector3(0, 3.2, -8);
  const offsetDir = new BABYLON.Vector3();
  const probeOrigin = new BABYLON.Vector3();
  const upDir = BABYLON.Vector3.Up();
  const ray = new BABYLON.Ray(BABYLON.Vector3.Zero(), BABYLON.Vector3.Forward(), 1);
  const ceilingClearance = Math.max(cfg.minZ + 0.08, 0.2);

  let callTarget = 0;
  let callMix = 0;

  const addLook = (dx: number, dy: number) => {
    if (callTarget > 0) return;
    if (dx === 0 && dy === 0) return;
    yaw += dx * cfg.mouseSensitivity;
    pitch = clampValue(pitch + dy * cfg.mouseSensitivity * 0.78, cfg.minPitch, cfg.maxPitch);
    if (Math.hypot(dx, dy) > 16) mouseFlick = true;
    lookInputTimer = 0.12;
    recenterIdle = 0;
  };

  const setLookStick = (x: number, y: number) => {
    lookStickX = clampValue(x, -1, 1);
    lookStickY = clampValue(y, -1, 1);
  };

  const reset = (nextYaw = 0, nextPitch = 0.1) => {
    yaw = nextYaw;
    pitch = clampValue(nextPitch, cfg.minPitch, cfg.maxPitch);
    desiredDistance = cfg.distance;
    currentDistance = cfg.distance;
    lookStickX = 0;
    lookStickY = 0;
    lookInputTimer = 0;
    mouseFlick = false;
    holdAim = false;
    recenterIdle = 0;
    shoulderTarget = 0;
    shoulderMix = 0;
    toolClose = false;
    callTarget = 0;
    callMix = 0;
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

  const isCameraObstacle = (mesh: BABYLON.AbstractMesh | undefined, ignore: Set<BABYLON.AbstractMesh>) => {
    if (!mesh || !mesh.isEnabled() || !mesh.isVisible || mesh.visibility <= 0) return false;
    if (ignore.has(mesh)) return false;
    if ((mesh.metadata as { sceneTriggerId?: string } | undefined)?.sceneTriggerId) return false;
    return mesh.checkCollisions || mesh.isPickable;
  };

  const pickAlong = (
    origin: BABYLON.Vector3,
    direction: BABYLON.Vector3,
    length: number,
    ignore: Set<BABYLON.AbstractMesh>,
  ) => {
    if (length < 0.001) return null;
    ray.origin.copyFrom(origin);
    ray.direction.copyFrom(direction);
    ray.length = length;
    return scene.pickWithRay(ray, (mesh) => isCameraObstacle(mesh, ignore), false);
  };

  const collideDistance = (origin: BABYLON.Vector3, target: BABYLON.Vector3, ignore: Set<BABYLON.AbstractMesh>) => {
    offsetDir.copyFrom(target).subtractInPlace(origin);
    const maxDist = offsetDir.length();
    if (maxDist < 0.001) return cfg.minDistance;
    offsetDir.scaleInPlace(1 / maxDist);
    const skin = Math.min(0.45, maxDist * 0.2);
    probeOrigin.copyFrom(origin).addInPlace(offsetDir.scale(skin));
    const hit = pickAlong(probeOrigin, offsetDir, Math.max(0.01, maxDist - skin), ignore);
    if (hit?.hit && typeof hit.distance === 'number') {
      return clampValue(hit.distance + skin - cfg.collisionRadius, cfg.minDistance, maxDist);
    }
    return maxDist;
  };

  /** World Y of the first ceiling/overhang above a point; boom rays barely change Y under a flat slab. */
  const ceilingWorldY = (x: number, y: number, z: number, ignore: Set<BABYLON.AbstractMesh>) => {
    probeOrigin.set(x, y, z);
    const hit = pickAlong(probeOrigin, upDir, 12, ignore);
    if (hit?.hit && hit.pickedPoint) return hit.pickedPoint.y;
    return Number.POSITIVE_INFINITY;
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

    const stickMag = Math.hypot(lookStickX, lookStickY);
    const stickBreak = stickMag > 0.82;
    if (stickMag > 0.04 && !(holdAim && !stickBreak)) {
      yaw += lookStickX * cfg.stickSensitivity * clampedDt;
      pitch = clampValue(pitch - lookStickY * cfg.stickSensitivity * 0.85 * clampedDt, cfg.minPitch, cfg.maxPitch);
      lookInputTimer = 0.12;
      recenterIdle = 0;
    }

    lookInputTimer = Math.max(0, lookInputTimer - clampedDt);

    if (cfg.enableMoveRecenter && moving && moveHeading !== null && !isLooking() && !holdAim) {
      recenterIdle += clampedDt;
      if (recenterIdle >= cfg.recenterDelay) {
        yaw = dampAngle(yaw, moveHeading, cfg.recenterStiffness, clampedDt);
      }
    } else {
      recenterIdle = 0;
    }

    shoulderMix = expDamp(shoulderMix, shoulderTarget, cfg.shoulderStiffness, clampedDt);
    desiredDistance = toolClose ? cfg.equippedDistance : cfg.distance;
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const shoulder = cfg.shoulderOffset * shoulderMix;
    const aimDistance = clampValue(
      desiredDistance + cfg.drawnDistanceDelta * shoulderMix,
      cfg.minDistance,
      cfg.maxDistance,
    );

    const pivotTargetX = player.x + rightX * shoulder;
    const pivotTargetY = playerMeshY(player.y) + cfg.pivotHeight;
    const pivotTargetZ = player.z + rightZ * shoulder;
    pivot.x = expDamp(pivot.x, pivotTargetX, cfg.followStiffness, clampedDt);
    pivot.y = expDamp(pivot.y, pivotTargetY, cfg.followStiffness, clampedDt);
    pivot.z = expDamp(pivot.z, pivotTargetZ, cfg.followStiffness, clampedDt);

    desiredOffset(aimDistance, desiredPos);
    desiredPos.addInPlace(pivot);

    let blocked = collideDistance(pivot, desiredPos, ignore);

    const midX = (pivot.x + desiredPos.x) * 0.5;
    const midZ = (pivot.z + desiredPos.z) * 0.5;
    const ceilingY = Math.min(
      ceilingWorldY(pivot.x, pivot.y, pivot.z, ignore),
      ceilingWorldY(desiredPos.x, pivot.y, desiredPos.z, ignore),
      ceilingWorldY(midX, pivot.y, midZ, ignore),
    );
    const maxCamY = ceilingY - ceilingClearance;
    const pitchLift = Math.sin(pitch);
    if (Number.isFinite(maxCamY) && pitchLift > 0.02) {
      const maxDistY = (maxCamY - pivot.y - cfg.height) / pitchLift;
      if (maxDistY < blocked) {
        blocked = clampValue(maxDistY, cfg.minDistance, blocked);
      }
    }

    const stiffness = blocked < currentDistance - 0.02 ? cfg.collisionInStiffness : cfg.collisionOutStiffness;
    currentDistance = expDamp(currentDistance, Math.min(aimDistance, blocked), stiffness, clampedDt);

    desiredOffset(currentDistance, smoothedPos);
    smoothedPos.addInPlace(pivot);
    if (smoothedPos.y > maxCamY) smoothedPos.y = maxCamY;

    const lookForward = 0.35;
    if (holdAim) {
      lookAt.copyFrom(aimSpot);
    } else {
      lookAt.x = expDamp(lookAt.x, pivot.x + Math.sin(yaw) * lookForward, cfg.lookAtStiffness, clampedDt);
      lookAt.y = expDamp(lookAt.y, pivot.y, cfg.lookAtStiffness, clampedDt);
      lookAt.z = expDamp(lookAt.z, pivot.z + Math.cos(yaw) * lookForward, cfg.lookAtStiffness, clampedDt);
    }

    callMix = expDamp(callMix, callTarget, 5.2, clampedDt);
    if (callMix > 0.001) {
      const faceX = Math.sin(yaw);
      const faceZ = Math.cos(yaw);
      const leftX = -Math.cos(yaw);
      const leftZ = Math.sin(yaw);
      const baseY = playerMeshY(player.y);
      const camX = player.x + leftX * 0.95 - faceX * 2.45;
      const camY = baseY + 1.48;
      const camZ = player.z + leftZ * 0.95 - faceZ * 2.45;
      const lookX = player.x + leftX * 0.2;
      const lookY = baseY + 1.28;
      const lookZ = player.z + leftZ * 0.2;
      smoothedPos.x = smoothedPos.x * (1 - callMix) + camX * callMix;
      smoothedPos.y = smoothedPos.y * (1 - callMix) + camY * callMix;
      smoothedPos.z = smoothedPos.z * (1 - callMix) + camZ * callMix;
      lookAt.x = lookAt.x * (1 - callMix) + lookX * callMix;
      lookAt.y = lookAt.y * (1 - callMix) + lookY * callMix;
      lookAt.z = lookAt.z * (1 - callMix) + lookZ * callMix;
      // The wide shot is a fixed offset. Pull it back to the near side of a wall
      // so the blend cannot sit the lens in the next room.
      offsetDir.copyFrom(smoothedPos).subtractInPlace(pivot);
      const span = offsetDir.length();
      if (span > 0.05) {
        offsetDir.scaleInPlace(1 / span);
        const skin = 0.06;
        probeOrigin.copyFrom(pivot).addInPlace(offsetDir.scale(skin));
        const hit = pickAlong(probeOrigin, offsetDir, Math.max(0.01, span - skin), ignore);
        if (hit?.hit && typeof hit.distance === 'number') {
          const stop = Math.max(0.22, hit.distance + skin - cfg.collisionRadius);
          if (stop < span - 0.01) smoothedPos.copyFrom(pivot).addInPlace(offsetDir.scale(stop));
        }
      }
      const overhead = ceilingWorldY(smoothedPos.x, smoothedPos.y - 0.05, smoothedPos.z, ignore);
      const capY = Math.min(maxCamY, overhead - ceilingClearance);
      if (Number.isFinite(capY) && smoothedPos.y > capY) smoothedPos.y = capY;
    }

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
    reset,
    update,
    isLooking,
    setCinematic,
    clearCinematic,
    setOverShoulder: (enabled: boolean) => {
      shoulderTarget = enabled ? 1 : 0;
    },
    setToolClose: (enabled: boolean) => {
      toolClose = enabled;
    },
    setCallFrame: (enabled: boolean) => {
      callTarget = enabled ? 1 : 0;
    },
    face: (nextYaw: number) => {
      yaw = nextYaw;
    },
    getYaw: () => yaw,
    getPitch: () => pitch,
    lookForce: () => Math.hypot(lookStickX, lookStickY),
    takeMouseFlick: () => {
      const flicked = mouseFlick;
      mouseFlick = false;
      return flicked;
    },
    /** Point the view at a world point. The crosshair lands there this frame. */
    aimAt: (x: number, y: number, z: number) => {
      holdAim = true;
      aimSpot.set(x, y, z);
      const dx = x - pivot.x;
      const dz = z - pivot.z;
      if (dx * dx + dz * dz > 1e-4) yaw = Math.atan2(dx, dz);
      const ex = x - camera.position.x;
      const ey = y - camera.position.y;
      const ez = z - camera.position.z;
      const horiz = Math.hypot(ex, ez);
      if (horiz > 0.05) {
        const slope = ey / horiz;
        const dist = Math.max(cfg.minDistance, currentDistance);
        const radius = Math.hypot(1, slope);
        const rhs = -(slope * 0.35 + cfg.height) / dist;
        const alpha = Math.atan2(slope, 1);
        const sine = Math.max(-1, Math.min(1, rhs / radius));
        pitch = clampValue(Math.asin(sine) - alpha, cfg.minPitch, cfg.maxPitch);
      }
      lookAt.copyFrom(aimSpot);
      camera.setTarget(lookAt);
      recenterIdle = 0;
    },
    clearAim: () => {
      if (!holdAim) return;
      holdAim = false;
      const lookForward = 0.35;
      lookAt.set(
        pivot.x + Math.sin(yaw) * lookForward,
        pivot.y,
        pivot.z + Math.cos(yaw) * lookForward,
      );
      camera.setTarget(lookAt);
    },
  };
};

export type ThirdPersonCamera = ReturnType<typeof createThirdPersonCamera>;
