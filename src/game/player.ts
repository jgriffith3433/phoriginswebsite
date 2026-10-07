import * as BABYLON from '@babylonjs/core';

import type { PlayerState } from './types';

/** Physics capsule center while standing. */
export const PLAYER_STAND_Y = 1.6;
/** Visual root relative to capsule center so Mixamo feet sit on y=0. */
export const PLAYER_MESH_Y_OFFSET = 1.6;

export const playerMeshY = (playerY: number) => playerY - PLAYER_MESH_Y_OFFSET;

/** Delay after jump press before vertical velocity is applied (matches 2× jump clip). */
export const JUMP_WINDUP = 0.5;

export const createPlayerState = (): PlayerState => ({
  x: 0,
  y: PLAYER_STAND_Y,
  z: 3,
  velocityY: 0,
  grounded: true,
  jumpWindup: 0,
  weaponDrawn: false,
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
  player.velocityY = 7;
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
    } else if (blocked && player.velocityY > 0) {
      player.velocityY = 0;
    }
  } else {
    const { blocked } = moveVertical(player, collider, -0.14);
    if (!blocked) player.grounded = false;
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
  mesh.ellipsoid = new BABYLON.Vector3(0.4, 1.05, 0.4);
  mesh.ellipsoidOffset = new BABYLON.Vector3(0, -0.5, 0);
  return mesh;
};

export const movePlayerOnGround = (
  player: PlayerState,
  collider: BABYLON.Mesh,
  dx: number,
  dz: number,
) => {
  collider.position.set(player.x, player.y, player.z);
  collider.moveWithCollisions(new BABYLON.Vector3(dx, 0, dz));
  player.x = collider.position.x;
  player.z = collider.position.z;
  collider.position.y = player.y;
};
