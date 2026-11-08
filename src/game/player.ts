import * as BABYLON from '@babylonjs/core';

import type { PlayerState } from './types';

/** Physics capsule center while standing. */
export const PLAYER_STAND_Y = 1.6;
/** Visual root relative to capsule center so Mixamo feet sit on y=0. */
export const PLAYER_MESH_Y_OFFSET = 1.6;

export const playerMeshY = (playerY: number) => playerY - PLAYER_MESH_Y_OFFSET;

/** Collider ellipsoid: half-height and centre offset below the capsule centre. */
const ELLIPSOID_HALF_Y = 1.05;
const ELLIPSOID_OFFSET_Y = -0.5;
/**
 * The ellipsoid's bottom sits this far above the feet. On the y=0 floor the PLAYER_STAND_Y clamp
 * keeps that gap; on any raised surface the collider would rest on it and sink the feet 5 cm, so a
 * landing or floor snap lifts him by the same gap.
 */
const FOOT_CLEARANCE = PLAYER_MESH_Y_OFFSET - (ELLIPSOID_HALF_Y - ELLIPSOID_OFFSET_Y);

/** Delay after jump press before vertical velocity is applied. */
export const JUMP_WINDUP = 0.1;

/** Upward speed at takeoff (m/s). */
export const JUMP_SPEED = 7;

/** Rounds the sidearm holds. An ammo box refills this. */
export const CLIP_SIZE = 8;

export const createPlayerState = (): PlayerState => ({
  x: 0,
  y: PLAYER_STAND_Y,
  z: 3,
  velocityY: 0,
  grounded: true,
  jumpWindup: 0,
  weaponDrawn: false,
  clip: 0,
});

/** Queue a hop. Animation should start on true; physics waits JUMP_WINDUP. */
export const requestJump = (player: PlayerState) => {
  if (!player.grounded || player.jumpWindup > 0) return false;
  player.jumpWindup = JUMP_WINDUP;
  return true;
};

export const applyJump = (player: PlayerState) => {
  if (!player.grounded) return false;
  player.jumpWindup = 0;
  player.velocityY = JUMP_SPEED;
  player.grounded = false;
  return true;
};

const moveVertical = (player: PlayerState, collider: BABYLON.Mesh | undefined, dy: number) => {
  if (!collider || Math.abs(dy) < 1e-8) {
    player.y += dy;
    return { blocked: false };
  }
  const startY = player.y;
  collider.position.set(player.x, startY, player.z);
  collider.moveWithCollisions(new BABYLON.Vector3(0, dy, 0));
  player.y = collider.position.y;
  const expected = startY + dy;
  const blocked = dy < 0
    ? player.y > expected + 0.002
    : player.y < expected - 0.002;
  return { blocked };
};

/** Shadow running flight. Space climbs. Releasing Space holds the height. */
export const flyPlayer = (
  player: PlayerState,
  collider: BABYLON.Mesh | undefined,
  delta: number,
  climbing: boolean,
) => {
  player.jumpWindup = 0;
  player.grounded = false;
  player.velocityY = climbing ? 6.5 : 0;
  if (!collider || !climbing) return;
  collider.position.set(player.x, player.y, player.z);
  collider.moveWithCollisions(new BABYLON.Vector3(0, player.velocityY * delta, 0));
  player.y = collider.position.y;
};

export const updateVerticalMotion = (
  player: PlayerState,
  delta: number,
  collider?: BABYLON.Mesh,
) => {
  if (player.jumpWindup > 0) {
    player.jumpWindup -= delta;
    if (player.jumpWindup <= 0) {
      player.jumpWindup = 0;
      applyJump(player);
      return;
    }
  }
  if (!player.grounded) {
    player.velocityY -= 22 * delta;
    const dy = player.velocityY * delta;
    const { blocked } = moveVertical(player, collider, dy);
    if (blocked && player.velocityY < 0) {
      player.velocityY = 0;
      player.grounded = true;
      player.y += FOOT_CLEARANCE;
    } else if (blocked && player.velocityY > 0) {
      player.velocityY = 0;
    }
  } else {
    const { blocked } = moveVertical(player, collider, -0.14);
    if (!blocked) player.grounded = false;
    else player.y += FOOT_CLEARANCE;
  }
  if (player.y <= PLAYER_STAND_Y) {
    player.y = PLAYER_STAND_Y;
    if (player.velocityY < 0) player.velocityY = 0;
    player.grounded = true;
    collider?.position.set(player.x, player.y, player.z);
  }
};

export const clampPlayerToArena = (player: PlayerState, arenaSize: number) => {
  const boundary = arenaSize / 2 - 2;
  player.x = Math.max(-boundary, Math.min(boundary, player.x));
  player.z = Math.max(-boundary, Math.min(boundary, player.z));
};

export const createPlayerCollider = (scene: BABYLON.Scene) => {
  const mesh = BABYLON.MeshBuilder.CreateCapsule('playerCollider', { height: 1.72, radius: 0.38 }, scene);
  mesh.isVisible = false;
  mesh.isPickable = false;
  mesh.checkCollisions = true;
  // Reach down to chair/desk height (~0.4) without sitting in the floor.
  mesh.ellipsoid = new BABYLON.Vector3(0.4, ELLIPSOID_HALF_Y, 0.4);
  mesh.ellipsoidOffset = new BABYLON.Vector3(0, ELLIPSOID_OFFSET_Y, 0);
  return mesh;
};

export const movePlayerOnGround = (
  player: PlayerState,
  collider: BABYLON.Mesh,
  dx: number,
  dz: number,
) => {
  // One long frame, or a shadow run, is longer than a wall. Split it so the
  // capsule cannot start on one side of a box and finish on the other.
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / 0.2));
  const sx = dx / steps;
  const sz = dz / steps;
  for (let i = 0; i < steps; i += 1) {
    collider.position.set(player.x, player.y, player.z);
    collider.moveWithCollisions(new BABYLON.Vector3(sx, 0, sz));
    player.x = collider.position.x;
    player.z = collider.position.z;
  }
  collider.position.y = player.y;
};
