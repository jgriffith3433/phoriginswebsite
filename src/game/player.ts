import type { PlayerState } from './types';

export const createPlayerState = (): PlayerState => ({
  x: 0,
  y: 1.6,
  z: 0,
  velocityY: 0,
  grounded: true,
});

export const applyJump = (player: PlayerState) => {
  if (!player.grounded) return false;
  player.velocityY = 7;
  player.grounded = false;
  return true;
};

export const updateVerticalMotion = (player: PlayerState, delta: number) => {
  if (!player.grounded) {
    player.velocityY -= 22 * delta;
    player.y += player.velocityY * delta;
    if (player.y <= 1.6) {
      player.y = 1.6;
      player.velocityY = 0;
      player.grounded = true;
    }
  }
};

export const clampPlayerToArena = (player: PlayerState, arenaSize: number) => {
  const boundary = arenaSize / 2 - 2;
  player.x = Math.max(-boundary, Math.min(boundary, player.x));
  player.z = Math.max(-boundary, Math.min(boundary, player.z));
};
