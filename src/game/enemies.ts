import * as BABYLON from '@babylonjs/core';

import { createCharacterAvatar, type PlayerAvatar } from './playerAvatar';
import { PLAYER_MESH_Y_OFFSET, PLAYER_STAND_Y } from './player';

export type EnemyKind = 'scout' | 'brute' | 'elite';

export type Enemy = {
  mesh: BABYLON.Mesh;
  root: BABYLON.TransformNode;
  avatar: PlayerAvatar;
  hp: number;
  speed: number;
  kind: EnemyKind;
};

export const disposeEnemy = (enemy: Enemy) => {
  enemy.avatar.dispose();
  if (!enemy.mesh.isDisposed()) enemy.mesh.dispose();
};

export const clearEnemies = (enemies: Enemy[]) => {
  for (const enemy of enemies) disposeEnemy(enemy);
  enemies.length = 0;
};

export const spawnEnemy = (scene: BABYLON.Scene, level: number): Enemy => {
  const angle = Math.random() * Math.PI * 2;
  const distance = 18 + Math.random() * 10;
  const mesh = BABYLON.MeshBuilder.CreateCapsule(`enemy-root-${Math.random()}`, { radius: 0.5, height: 1.8 }, scene);
  mesh.position = new BABYLON.Vector3(Math.cos(angle) * distance, PLAYER_STAND_Y, Math.sin(angle) * distance);
  mesh.visibility = 0;
  mesh.isPickable = false;

  const kind: EnemyKind = level >= 6 ? (Math.random() > 0.66 ? 'elite' : 'brute') : level >= 3 ? 'brute' : 'scout';
  const avatar = createCharacterAvatar(scene, `enemy-${kind}`);
  avatar.group.parent = mesh;
  avatar.group.position.y = -PLAYER_MESH_Y_OFFSET;
  avatar.setLocomotion(true, true);

  return {
    mesh,
    root: avatar.group,
    avatar,
    hp: kind === 'elite' ? 4 + level : kind === 'brute' ? 3 + level : 2 + level,
    speed: kind === 'elite' ? 2.2 + level * 0.18 : kind === 'brute' ? 1.8 + level * 0.14 : 1.4 + level * 0.12,
    kind,
  };
};

export const updateEnemyAI = (enemy: Enemy, target: BABYLON.Vector3, delta: number) => {
  const toPlayer = new BABYLON.Vector3(target.x - enemy.mesh.position.x, 0, target.z - enemy.mesh.position.z);
  const distance = toPlayer.length();
  const moving = distance > 1.6;

  if (moving) {
    toPlayer.normalize();
    enemy.mesh.position.x += toPlayer.x * enemy.speed * delta;
    enemy.mesh.position.z += toPlayer.z * enemy.speed * delta;
  }

  enemy.avatar.setLocomotion(moving, true);
  enemy.root.rotation.y = Math.atan2(target.x - enemy.mesh.position.x, target.z - enemy.mesh.position.z) + Math.PI;

  return distance;
};
