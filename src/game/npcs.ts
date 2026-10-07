import * as BABYLON from '@babylonjs/core';

import { createCharacterAvatar, type PlayerAvatar } from './playerAvatar';
import { PLAYER_MESH_Y_OFFSET, PLAYER_STAND_Y } from './player';
import type { SceneData } from './sceneData';

export type NpcType = 'professional_npc';

export type Npc = {
  type: NpcType;
  seatId: string;
  mesh: BABYLON.Mesh;
  avatar: PlayerAvatar;
};

const NPC_SEAT_COMPONENT = 'NpcSeat';
const SIT_DROP = 0.52;

export const disposeNpc = (npc: Npc) => {
  npc.avatar.dispose();
  if (!npc.mesh.isDisposed()) npc.mesh.dispose();
};

export const clearNpcs = (npcs: Npc[]) => {
  for (const npc of npcs) disposeNpc(npc);
  npcs.length = 0;
};

export const spawnProfessionalNpc = (
  scene: BABYLON.Scene,
  seatId: string,
  x: number,
  z: number,
  facingYaw: number,
): Npc => {
  const mesh = BABYLON.MeshBuilder.CreateCapsule(`professional-npc-${Math.random()}`, { radius: 0.4, height: 1.6 }, scene);
  mesh.position = new BABYLON.Vector3(x, PLAYER_STAND_Y, z);
  mesh.rotation.y = facingYaw + Math.PI;
  mesh.visibility = 0;
  mesh.isPickable = false;
  mesh.checkCollisions = true;
  mesh.ellipsoid = new BABYLON.Vector3(0.4, 0.8, 0.4);

  const avatar = createCharacterAvatar(scene, 'professional-npc');
  avatar.group.parent = mesh;
  avatar.group.position.y = -PLAYER_MESH_Y_OFFSET - SIT_DROP;
  avatar.playClip('sit', true);

  return { type: 'professional_npc', seatId, mesh, avatar };
};

const facingYawForSeat = (seatZ: number, tableZ: number) => (seatZ < tableZ ? 0 : Math.PI);

export const spawnNpcsFromScene = (scene: BABYLON.Scene, sceneData: SceneData): Npc[] => {
  const table = sceneData.assets.find((asset) => asset.id === 'board-table' || asset.name === 'Board Table');
  const tableZ = table?.z ?? table?.position?.z ?? 32;
  const seats = sceneData.assets.filter((asset) => asset.components?.includes(NPC_SEAT_COMPONENT));
  return seats.map((seat) => {
    const x = seat.x ?? seat.position?.x ?? 0;
    const z = seat.z ?? seat.position?.z ?? 0;
    return spawnProfessionalNpc(scene, seat.id, x, z, facingYawForSeat(z, tableZ));
  });
};
