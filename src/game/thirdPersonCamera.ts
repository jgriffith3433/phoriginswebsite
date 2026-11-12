import * as BABYLON from '@babylonjs/core';

import {
  createOcclusionFader,
  createVolumeBlend,
  parseCameraVolumes,
  stepVolumeBlend,
  type CameraVolume,
  type OcclusionFader,
} from './cameraVolumes';
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
  /** Seconds without look input while moving before yaw recentres behind Pierce. */
  recenterDelay: number;
  /** Seconds without look input while standing still before yaw recentres. */
  idleRecenterDelay: number;
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
  // Moving: ease behind him soon. Standing still after a look: settle after ~2 s.
  recenterDelay: 0.45,
  idleRecenterDelay: 2.0,
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
  let cinematicFresh = false;
  let cinematicLook: BABYLON.Vector3 | null = null;
  let desiredDistance = cfg.distance;
  let currentDistance = cfg.distance;
  let lookStickX = 0;
  let lookStickY = 0;
  let lookInputTimer = 0;
  let mouseFlick = false;
  /** Invert Y (Settings). Default off: mouse down looks up relative to the old baked sign. */
  let invertY = false;
  let mouseScale = 1;
  let stickScale = 1;
  let holdAim = false;
  const aimSpot = new BABYLON.Vector3();
  let recenterIdle = 0;
  let lastMoveHeading: number | null = null;
  let shoulderTarget = 0;
  let shoulderMix = 0;
  let toolClose = false;
  /** How far the boom was squeezed by geometry last frame: 0 free, 1 on the minimum distance. */
  let squeeze = 0;

  const pivot = new BABYLON.Vector3(0, cfg.pivotHeight, 0);
  const lookAt = new BABYLON.Vector3(0, cfg.pivotHeight, 0);
  const desiredPos = new BABYLON.Vector3();
  const smoothedPos = new BABYLON.Vector3(0, 3.2, -8);
  const offsetDir = new BABYLON.Vector3();
  const probeOrigin = new BABYLON.Vector3();
  const upDir = BABYLON.Vector3.Up();
  const downDir = BABYLON.Vector3.Down();
  const ray = new BABYLON.Ray(BABYLON.Vector3.Zero(), BABYLON.Vector3.Forward(), 1);
  const ceilingClearance = Math.max(cfg.minZ + 0.08, 0.2);
  const feelDir = new BABYLON.Vector3();
  const pushOut = new BABYLON.Vector3();

  let callTarget = 0;
  let callMix = 0;

  let volumes: CameraVolume[] = [];
  const volumeBlend = createVolumeBlend();
  const fader: OcclusionFader = createOcclusionFader();
  let lastFaded = 0;

  const addLook = (dx: number, dy: number) => {
    if (callTarget > 0) return;
    if (dx === 0 && dy === 0) return;
    const ySign = invertY ? 1 : -1;
    const sens = cfg.mouseSensitivity * mouseScale;
    yaw += dx * sens;
    pitch = clampValue(pitch + dy * ySign * sens * 0.78, cfg.minPitch, cfg.maxPitch);
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
    squeeze = 0;
    callTarget = 0;
    callMix = 0;
    fader.clear();
    lastFaded = 0;
    volumeBlend.current.distance = cfg.distance;
    volumeBlend.current.fov = cfg.fov;
    volumeBlend.current.heightLift = 0;
    volumeBlend.current.shoulderSigned = 0;
    volumeBlend.current.openYaw = 0;
    volumeBlend.current.blend = 0;
    volumeBlend.current.profile = 'open';
    volumeBlend.targetId = 'open';
    pivot.set(0, cfg.pivotHeight, 0);
    lookAt.copyFrom(pivot);
    smoothedPos.set(0, cfg.pivotHeight + cfg.height + 2.2, -cfg.distance);
    camera.position.copyFrom(smoothedPos);
    camera.fov = cfg.fov;
    camera.setTarget(pivot);
  };

  const isLooking = () => lookInputTimer > 0 || Math.hypot(lookStickX, lookStickY) > 0.08;

  const desiredOffset = (distance: number, into: BABYLON.Vector3, usePitch = pitch, useYaw = yaw) => {
    const cosPitch = Math.cos(usePitch);
    into.set(
      -Math.sin(useYaw) * cosPitch * distance,
      cfg.height + Math.sin(usePitch) * distance,
      -Math.cos(useYaw) * cosPitch * distance,
    );
    return into;
  };

  const isCameraObstacle = (mesh: BABYLON.AbstractMesh | undefined, ignore: Set<BABYLON.AbstractMesh>) => {
    if (!mesh || !mesh.isEnabled() || mesh.visibility <= 0) return false;
    if (ignore.has(mesh)) return false;
    // Occlusion fade owns these; do not shorten the boom into Pierce because of them.
    if (fader.isFaded(mesh)) return false;
    const meta = mesh.metadata as { sceneTriggerId?: string; cameraClip?: boolean; trainCollider?: boolean; cameraFade?: number } | undefined;
    if (meta?.sceneTriggerId || meta?.trainCollider) return false;
    if ((meta?.cameraFade ?? 0) > 0.35) return false;
    if (meta?.cameraClip || mesh.checkCollisions) return true;
    return mesh.isVisible && mesh.isPickable;
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
    const rayLen = Math.max(0.01, maxDist - skin);
    let best = maxDist;
    const hit = pickAlong(probeOrigin, offsetDir, rayLen, ignore);
    if (hit?.hit && typeof hit.distance === 'number') {
      best = clampValue(hit.distance + skin - cfg.collisionRadius, cfg.minDistance, maxDist);
    }
    // Side probes catch a jamb that sits beside the boom line (fade will clear most of these).
    const sideX = -offsetDir.z;
    const sideZ = offsetDir.x;
    const sideLen = Math.hypot(sideX, sideZ);
    if (sideLen > 0.01) {
      const r = cfg.collisionRadius * 0.7;
      const ox = (sideX / sideLen) * r;
      const oz = (sideZ / sideLen) * r;
      for (const sign of [1, -1]) {
        probeOrigin.copyFrom(origin).addInPlace(offsetDir.scale(skin));
        probeOrigin.x += ox * sign;
        probeOrigin.z += oz * sign;
        const side = pickAlong(probeOrigin, offsetDir, rayLen, ignore);
        if (side?.hit && typeof side.distance === 'number') {
          best = Math.min(best, clampValue(side.distance + skin - 0.05, cfg.minDistance, maxDist));
        }
      }
    }
    return best;
  };

  /**
   * Last-resort shove only: keep the near plane out of solid geometry.
   * Hall framing and occlusion fade own the rest — do not grow this reach again.
   */
  const clearancePush = (pos: BABYLON.Vector3, ignore: Set<BABYLON.AbstractMesh>) => {
    const reach = Math.max(cfg.collisionRadius, cfg.minZ * 2.5);
    pushOut.set(0, 0, 0);
    let any = false;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      feelDir.set(Math.sin(a), 0, Math.cos(a));
      const hit = pickAlong(pos, feelDir, reach, ignore);
      if (hit?.hit && typeof hit.distance === 'number' && hit.distance < reach) {
        const push = reach - hit.distance;
        pushOut.x -= feelDir.x * push;
        pushOut.z -= feelDir.z * push;
        any = true;
      }
    }
    const len = Math.hypot(pushOut.x, pushOut.z);
    if (len > reach) pushOut.scaleInPlace(reach / len);
    return any;
  };

  const ceilingWorldY = (x: number, y: number, z: number, ignore: Set<BABYLON.AbstractMesh>) => {
    probeOrigin.set(x, y, z);
    const hit = pickAlong(probeOrigin, upDir, 12, ignore);
    if (hit?.hit && hit.pickedPoint) return hit.pickedPoint.y;
    return Number.POSITIVE_INFINITY;
  };

  const floorWorldY = (x: number, y: number, z: number, ignore: Set<BABYLON.AbstractMesh>) => {
    probeOrigin.set(x, y, z);
    const hit = pickAlong(probeOrigin, downDir, Math.max(0.4, y + 2), ignore);
    if (hit?.hit && hit.pickedPoint) return hit.pickedPoint.y;
    return Number.NEGATIVE_INFINITY;
  };

  const sideClearance = (px: number, py: number, pz: number, dirX: number, dirZ: number, ignore: Set<BABYLON.AbstractMesh>) => {
    probeOrigin.set(px, py, pz);
    feelDir.set(dirX, 0, dirZ);
    const hit = pickAlong(probeOrigin, feelDir, 4, ignore);
    if (hit?.hit && typeof hit.distance === 'number') return hit.distance;
    return 4;
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
      if (cinematicFresh) {
        cinematicFresh = false;
        const dist = BABYLON.Vector3.Distance(camera.position, cinematicPos);
        if (dist > 0.5 && collideDistance(camera.position, cinematicPos, new Set(ignoreMeshes)) < dist - 0.05) {
          camera.position.copyFrom(cinematicPos);
          lookAt.copyFrom(cinematicLook);
        }
      }
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
      const stick = cfg.stickSensitivity * stickScale;
      const ySign = invertY ? 1 : -1;
      yaw += lookStickX * stick * clampedDt;
      pitch = clampValue(pitch - lookStickY * ySign * stick * 0.85 * clampedDt, cfg.minPitch, cfg.maxPitch);
      lookInputTimer = 0.12;
      recenterIdle = 0;
    }

    lookInputTimer = Math.max(0, lookInputTimer - clampedDt);

    const eyeY = playerMeshY(player.y) + 1.5;
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const clearR = sideClearance(player.x, eyeY, player.z, rightX, rightZ, ignore);
    const clearL = sideClearance(player.x, eyeY, player.z, -rightX, -rightZ, ignore);
    const pose = stepVolumeBlend(volumeBlend, volumes, player, yaw, clampedDt, clearL, clearR);

    camera.fov = expDamp(camera.fov, toolClose ? Math.min(pose.fov, cfg.fov) : pose.fov, 8, clampedDt);

    if (moveHeading !== null) lastMoveHeading = moveHeading;
    if (cfg.enableMoveRecenter && !isLooking() && !holdAim) {
      recenterIdle += clampedDt;
      const heading = moveHeading ?? lastMoveHeading;
      const delay = moving ? cfg.recenterDelay : cfg.idleRecenterDelay;
      if (heading !== null && squeeze > 0.35 && moving) {
        // Corner escape: swing behind him when the last-resort boom is hard into a wall.
        yaw = dampAngle(yaw, heading + pose.openYaw, cfg.recenterStiffness + squeeze * 9, clampedDt);
      } else if (heading !== null && recenterIdle >= delay) {
        yaw = dampAngle(yaw, heading + pose.openYaw, cfg.recenterStiffness, clampedDt);
      }
    } else {
      recenterIdle = 0;
    }

    shoulderMix = expDamp(shoulderMix, shoulderTarget, cfg.shoulderStiffness, clampedDt);
    // Volume shoulder (hallway open-side) blends with the armed over-shoulder.
    const volumeShoulder = pose.shoulderSigned * (1 - shoulderMix * 0.35);
    const armedShoulder = cfg.shoulderOffset * shoulderMix;
    const shoulder = armedShoulder + volumeShoulder * cfg.shoulderOffset;

    // A scripted slow push-in (The Morning's walk to the door): up to 40% closer, eased.
    push = expDamp(push, pushTarget, 2, clampedDt);
    const profileDistance = (toolClose ? cfg.equippedDistance : pose.distance) * (1 - 0.4 * push);
    desiredDistance = profileDistance;
    const aimDistance = clampValue(
      desiredDistance + cfg.drawnDistanceDelta * shoulderMix,
      cfg.minDistance,
      cfg.maxDistance,
    );

    const useYaw = yaw + pose.openYaw * (1 - shoulderMix);
    const pivotTargetX = player.x + Math.cos(useYaw) * shoulder;
    const pivotTargetY = playerMeshY(player.y) + cfg.pivotHeight;
    const pivotTargetZ = player.z + -Math.sin(useYaw) * shoulder;
    pivot.x = expDamp(pivot.x, pivotTargetX, cfg.followStiffness, clampedDt);
    pivot.y = expDamp(pivot.y, pivotTargetY, cfg.followStiffness, clampedDt);
    pivot.z = expDamp(pivot.z, pivotTargetZ, cfg.followStiffness, clampedDt);

    desiredOffset(aimDistance, desiredPos, pitch, useYaw);
    desiredPos.y += pose.heightLift;
    desiredPos.addInPlace(pivot);

    const midX = (pivot.x + desiredPos.x) * 0.5;
    const midZ = (pivot.z + desiredPos.z) * 0.5;
    const ceilingY = Math.min(
      ceilingWorldY(pivot.x, pivot.y, pivot.z, ignore),
      ceilingWorldY(desiredPos.x, pivot.y, desiredPos.z, ignore),
      ceilingWorldY(midX, pivot.y, midZ, ignore),
    );
    const maxCamY = ceilingY - ceilingClearance;
    let effPitch = pitch;
    if (Number.isFinite(maxCamY) && Math.sin(pitch) > 0.02) {
      const capSin = (maxCamY - pivot.y - cfg.height - pose.heightLift) / aimDistance;
      if (capSin < Math.sin(pitch)) effPitch = Math.asin(clampValue(capSin, 0, 1));
      desiredOffset(aimDistance, desiredPos, effPitch, useYaw);
      desiredPos.y += pose.heightLift;
      desiredPos.addInPlace(pivot);
    }

    // Prefer full boom; fade handles most occluders. Collision only when something solid remains.
    let blocked = collideDistance(pivot, desiredPos, ignore);

    const pitchLift = Math.sin(effPitch);
    if (Number.isFinite(maxCamY) && pitchLift > 0.02) {
      const maxDistY = (maxCamY - pivot.y - cfg.height - pose.heightLift) / pitchLift;
      if (maxDistY < blocked) {
        blocked = clampValue(maxDistY, cfg.minDistance, blocked);
      }
    }

    const stiffness = blocked < currentDistance - 0.02 ? cfg.collisionInStiffness : cfg.collisionOutStiffness;
    currentDistance = expDamp(currentDistance, Math.min(aimDistance, blocked), stiffness, clampedDt);
    squeeze = clampValue((aimDistance * 0.7 - blocked) / Math.max(0.1, aimDistance * 0.7 - cfg.minDistance), 0, 1);

    desiredOffset(currentDistance, smoothedPos, effPitch, useYaw);
    smoothedPos.y += pose.heightLift;
    smoothedPos.addInPlace(pivot);
    if (smoothedPos.y > maxCamY) smoothedPos.y = maxCamY;

    const lookForward = 0.35;
    if (holdAim) {
      lookAt.copyFrom(aimSpot);
    } else {
      lookAt.x = expDamp(lookAt.x, pivot.x + Math.sin(useYaw) * lookForward, cfg.lookAtStiffness, clampedDt);
      lookAt.y = expDamp(lookAt.y, pivot.y, cfg.lookAtStiffness, clampedDt);
      lookAt.z = expDamp(lookAt.z, pivot.z + Math.cos(useYaw) * lookForward, cfg.lookAtStiffness, clampedDt);
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

    const floorY = floorWorldY(smoothedPos.x, pivot.y + 0.25, smoothedPos.z, ignore);
    const minCamY = floorY + ceilingClearance;
    if (smoothedPos.y < minCamY) smoothedPos.y = minCamY;

    // Fade walls / frames / props on the eye→lens line before any last-resort shove.
    probeOrigin.set(player.x, eyeY, player.z);
    lastFaded = fader.update(scene, smoothedPos, probeOrigin, ignore, clampedDt);

    // Last resort only: near-plane out of solid geometry (faded meshes are ignored).
    if (clearancePush(smoothedPos, ignore)) {
      smoothedPos.x += pushOut.x;
      smoothedPos.z += pushOut.z;
    }

    // Eye→lens hard stop when something unfaded still stands between (pivot lag at corners).
    probeOrigin.set(player.x, eyeY, player.z);
    offsetDir.copyFrom(smoothedPos).subtractInPlace(probeOrigin);
    const eyeSpan = offsetDir.length();
    if (eyeSpan > 0.3) {
      offsetDir.scaleInPlace(1 / eyeSpan);
      const eyeHit = pickAlong(probeOrigin, offsetDir, eyeSpan, ignore);
      if (eyeHit?.hit && typeof eyeHit.distance === 'number') {
        const stop = Math.max(0.3, eyeHit.distance - cfg.collisionRadius);
        smoothedPos.copyFrom(probeOrigin).addInPlace(offsetDir.scale(Math.min(stop, eyeSpan)));
        currentDistance = Math.min(currentDistance, Math.max(cfg.minDistance, stop));
      }
    }

    camera.position.copyFrom(smoothedPos);
    camera.setTarget(lookAt);
    camera.upVector.set(0, 1, 0);
  };

  /**
   * Put the follow lens behind `player` immediately (no damp from the last pose or from reset's origin).
   * A Start that only called `reset` used to fly the camera through walls to the spawn and paint black frames.
   */
  const snapTo = (
    player: { x: number; y: number; z: number },
    ignoreMeshes: BABYLON.AbstractMesh[] = [],
    nextYaw?: number,
  ) => {
    if (typeof nextYaw === 'number') yaw = nextYaw;
    cinematicPos = null;
    cinematicLook = null;
    cinematicFresh = false;
    holdAim = false;
    lookStickX = 0;
    lookStickY = 0;
    lookInputTimer = 0;
    recenterIdle = 0;
    shoulderMix = shoulderTarget;
    callMix = callTarget;
    fader.clear();
    lastFaded = 0;
    const ignore = new Set(ignoreMeshes);
    const eyeY = playerMeshY(player.y) + 1.5;
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const clearR = sideClearance(player.x, eyeY, player.z, rightX, rightZ, ignore);
    const clearL = sideClearance(player.x, eyeY, player.z, -rightX, -rightZ, ignore);
    // Snap volume blend to the room he is in so Start does not ease from open→hallway.
    for (let i = 0; i < 12; i++) stepVolumeBlend(volumeBlend, volumes, player, yaw, 0.05, clearL, clearR);
    const pose = volumeBlend.current;
    camera.fov = pose.fov;
    const volumeShoulder = pose.shoulderSigned * (1 - shoulderMix * 0.35);
    const shoulder = cfg.shoulderOffset * shoulderMix + volumeShoulder * cfg.shoulderOffset;
    const useYaw = yaw + pose.openYaw * (1 - shoulderMix);
    pivot.set(
      player.x + Math.cos(useYaw) * shoulder,
      playerMeshY(player.y) + cfg.pivotHeight,
      player.z + -Math.sin(useYaw) * shoulder,
    );
    const aimDistance = toolClose ? cfg.equippedDistance : pose.distance;
    desiredDistance = aimDistance;
    desiredOffset(aimDistance, desiredPos, pitch, useYaw);
    desiredPos.y += pose.heightLift;
    desiredPos.addInPlace(pivot);
    let blocked = collideDistance(pivot, desiredPos, ignore);
    const ceilingY = Math.min(
      ceilingWorldY(pivot.x, pivot.y, pivot.z, ignore),
      ceilingWorldY(desiredPos.x, pivot.y, desiredPos.z, ignore),
    );
    const maxCamY = ceilingY - ceilingClearance;
    const pitchLift = Math.sin(pitch);
    if (Number.isFinite(maxCamY) && pitchLift > 0.02) {
      const maxDistY = (maxCamY - pivot.y - cfg.height - pose.heightLift) / pitchLift;
      if (maxDistY < blocked) blocked = clampValue(maxDistY, cfg.minDistance, blocked);
    }
    currentDistance = Math.min(aimDistance, blocked);
    squeeze = clampValue((aimDistance * 0.7 - blocked) / Math.max(0.1, aimDistance * 0.7 - cfg.minDistance), 0, 1);
    desiredOffset(currentDistance, smoothedPos, pitch, useYaw);
    smoothedPos.y += pose.heightLift;
    smoothedPos.addInPlace(pivot);
    if (Number.isFinite(maxCamY) && smoothedPos.y > maxCamY) smoothedPos.y = maxCamY;
    const floorY = floorWorldY(smoothedPos.x, pivot.y + 0.25, smoothedPos.z, ignore);
    const minCamY = floorY + ceilingClearance;
    if (smoothedPos.y < minCamY) smoothedPos.y = minCamY;
    probeOrigin.set(player.x, eyeY, player.z);
    lastFaded = fader.update(scene, smoothedPos, probeOrigin, ignore, 1);
    if (clearancePush(smoothedPos, ignore)) {
      smoothedPos.x += pushOut.x;
      smoothedPos.z += pushOut.z;
    }
    probeOrigin.set(player.x, eyeY, player.z);
    offsetDir.copyFrom(smoothedPos).subtractInPlace(probeOrigin);
    const eyeSpan = offsetDir.length();
    if (eyeSpan > 0.3) {
      offsetDir.scaleInPlace(1 / eyeSpan);
      const eyeHit = pickAlong(probeOrigin, offsetDir, eyeSpan, ignore);
      if (eyeHit?.hit && typeof eyeHit.distance === 'number') {
        const stop = Math.max(0.3, eyeHit.distance - cfg.collisionRadius);
        smoothedPos.copyFrom(probeOrigin).addInPlace(offsetDir.scale(Math.min(stop, eyeSpan)));
        currentDistance = Math.min(currentDistance, Math.max(cfg.minDistance, stop));
      }
    }
    lookAt.set(pivot.x + Math.sin(useYaw) * 0.35, pivot.y, pivot.z + Math.cos(useYaw) * 0.35);
    camera.position.copyFrom(smoothedPos);
    camera.setTarget(lookAt);
    camera.upVector.set(0, 1, 0);
  };

  reset();

  let push = 0;
  let pushTarget = 0;

  const setCinematic = (position: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }) => {
    if (!cinematicPos) cinematicFresh = true;
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
    /** Apply Settings: invert Y and 0.5×–2× mouse / touch sensitivity. */
    setLookOptions: (opts: { invertY?: boolean; mouseScale?: number; stickScale?: number }) => {
      if (opts.invertY !== undefined) invertY = opts.invertY;
      if (opts.mouseScale !== undefined) mouseScale = Math.max(0.5, Math.min(2, opts.mouseScale));
      if (opts.stickScale !== undefined) stickScale = Math.max(0.5, Math.min(2, opts.stickScale));
    },
    reset,
    snapTo,
    update,
    isLooking,
    setCinematic,
    clearCinematic,
    /** 0..1: the lens creeps in as it grows (eased). */
    setPush: (k: number) => {
      pushTarget = Math.max(0, Math.min(1, k));
    },
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
    /** Authored interior volumes for this level (empty = open-room profile only). */
    setVolumes: (next: CameraVolume[] | unknown) => {
      volumes = Array.isArray(next) && next.length && typeof (next[0] as CameraVolume).minX === 'number'
        ? (next as CameraVolume[])
        : parseCameraVolumes(next);
      fader.clear();
      lastFaded = 0;
    },
    volumes: () => volumes,
    /** Active blended profile id (open / hallway / doorway). */
    profile: () => volumeBlend.current.profile,
    fadedCount: () => lastFaded || fader.fadedCount(),
    isOcclusionFaded: (mesh: BABYLON.AbstractMesh) => fader.isFaded(mesh),
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
