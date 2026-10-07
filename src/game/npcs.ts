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
  assetId: string;
  departing: boolean;
  left: boolean;
  standing: boolean;
  departDelay: number;
  waypoints: BABYLON.Vector3[];
  waypointIndex: number;
};

const NPC_SEAT_COMPONENT = 'NpcSeat';
const HEAD_CHAIR_ID = 'chair-head';
/** Mixamo Sitting Idle already drops the hips; keep only a tiny extra drop onto the chair cubes. */
export const SIT_DROP = 0.05;

/** World Y of the avatar group while seated (capsule stays at PLAYER_STAND_Y). */
export const seatedAvatarWorldY = () => PLAYER_STAND_Y - PLAYER_MESH_Y_OFFSET - SIT_DROP;

/**
 * Mixamo faces +Z; modelRoot adds PI. Gameplay/NPC yaw is the Mixamo world facing.
 * Side chairs look inward along Z; the head chair looks along X toward the table.
 */
export const resolveSeatFacingYaw = (
  seatId: string,
  seatX: number,
  seatZ: number,
  tableX: number,
  tableZ: number,
) => {
  if (seatId === HEAD_CHAIR_ID) return seatX >= tableX ? -Math.PI / 2 : Math.PI / 2;
  return seatZ < tableZ ? 0 : Math.PI;
};

export const resolveBoardSeatPose = (sceneData: SceneData, seatId: string) => {
  const table = sceneData.assets.find((asset) => asset.id === 'board-table' || asset.name === 'Board Table');
  const tableX = table?.x ?? table?.position?.x ?? 44.2;
  const tableZ = table?.z ?? table?.position?.z ?? 32;
  const seat = sceneData.assets.find((asset) => asset.id === seatId);
  if (!seat) return null;
  const x = seat.x ?? seat.position?.x ?? 0;
  const z = seat.z ?? seat.position?.z ?? 0;
  return {
    x,
    z,
    facingYaw: resolveSeatFacingYaw(seatId, x, z, tableX, tableZ),
    visualY: seatedAvatarWorldY(),
  };
};

/** Board seats → Mixamo NPC GLBs. Ch33 is Pierce; Ch44 is reserved for post-transform. */
export const BOARD_NPC_BY_SEAT: Record<string, string> = {
  'chair-s-1': 'asset-ch08-npc', // Voss
  'chair-s-2': 'asset-ch23-npc',
  'chair-s-3': 'asset-ch28-npc', // Lang
  'chair-n-1': 'asset-ch31-npc',
  'chair-n-2': 'asset-ch37-npc', // Hale
  'chair-n-3': 'asset-ch08-npc', // reuse Ch08; only five unique NPC meshes besides Pierce/Ch44
};

export const NPC_ASSET_FALLBACK = 'asset-ch08-npc';

export const resolveNpcAssetId = (seatId: string, npcAssetId?: string) =>
  npcAssetId || BOARD_NPC_BY_SEAT[seatId] || NPC_ASSET_FALLBACK;

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
  assetId = resolveNpcAssetId(seatId),
): Npc => {
  const mesh = BABYLON.MeshBuilder.CreateCapsule(`professional-npc-${Math.random()}`, { radius: 0.4, height: 1.6 }, scene);
  mesh.position = new BABYLON.Vector3(x, PLAYER_STAND_Y, z);
  mesh.rotation.y = facingYaw + Math.PI;
  mesh.visibility = 0;
  mesh.isPickable = false;
  mesh.checkCollisions = true;
  mesh.ellipsoid = new BABYLON.Vector3(0.4, 0.8, 0.4);

  const avatar = createCharacterAvatar(scene, `professional-npc-${seatId}`, assetId);
  avatar.group.parent = mesh;
  avatar.group.position.y = -PLAYER_MESH_Y_OFFSET - SIT_DROP;
  avatar.playClip('sit', true);

  return {
    type: 'professional_npc',
    seatId,
    mesh,
    avatar,
    assetId,
    departing: false,
    left: false,
    standing: false,
    departDelay: 0,
    waypoints: [],
    waypointIndex: 0,
  };
};

const pointFromScene = (
  sceneData: SceneData,
  ids: string[],
  fallback: { x: number; z: number },
) => {
  const hit = sceneData.triggers.find((entry) => ids.includes(entry.id))
    ?? sceneData.assets.find((entry) => ids.includes(entry.id));
  if (!hit) return fallback;
  return {
    x: hit.x ?? hit.position?.x ?? fallback.x,
    z: hit.z ?? hit.position?.z ?? fallback.z,
  };
};

export const resolveBoardExit = (sceneData: SceneData) =>
  pointFromScene(sceneData, ['trigger-board-exit', 'marker-board-exit'], { x: 16, z: 32 });

export const resolveBoardDoor = (sceneData: SceneData) =>
  pointFromScene(sceneData, ['trigger-board-door', 'marker-board-door'], { x: 36.4, z: 32 });

export const resolveOfficeTerminal = (sceneData: SceneData) =>
  pointFromScene(sceneData, ['office-terminal', 'trigger-office-terminal'], { x: 48.15, z: 43.05 });

export const resolveOfficeWindow = (sceneData: SceneData) =>
  pointFromScene(sceneData, ['trigger-office-window'], { x: 48, z: 46.2 });

export const resolveElevator = (sceneData: SceneData) =>
  pointFromScene(sceneData, ['trigger-elevator-b3', 'floor-lift'], { x: 44, z: 21.5 });

export const startBoardDeparture = (npcs: Npc[], sceneData: SceneData) => {
  const exit = resolveBoardExit(sceneData);
  const door = pointFromScene(sceneData, ['marker-board-door'], { x: 36.4, z: 32 });
  npcs.forEach((npc, index) => {
    npc.departing = true;
    npc.left = false;
    npc.standing = false;
    npc.departDelay = index * 0.38;
    npc.waypointIndex = 0;
    const z = npc.mesh.position.z;
    npc.waypoints = [
      new BABYLON.Vector3(37.4, PLAYER_STAND_Y, z),
      new BABYLON.Vector3(door.x, PLAYER_STAND_Y, door.z),
      new BABYLON.Vector3(exit.x, PLAYER_STAND_Y, exit.z),
    ];
    npc.mesh.checkCollisions = false;
  });
};

export const remainingDepartingNpcs = (npcs: Npc[]) =>
  npcs.filter((npc) => npc.departing && !npc.left).length;

export const updateNpcDeparture = (npcs: Npc[], delta: number, speed = 2.35) => {
  for (const npc of npcs) {
    if (!npc.departing || npc.left) continue;
    if (npc.departDelay > 0) {
      npc.departDelay -= delta;
      continue;
    }
    if (!npc.standing) {
      npc.standing = true;
      npc.avatar.group.position.y = -PLAYER_MESH_Y_OFFSET;
      npc.avatar.playClip('walk', true);
    }
    const target = npc.waypoints[npc.waypointIndex];
    if (!target) {
      npc.left = true;
      disposeNpc(npc);
      continue;
    }
    const dx = target.x - npc.mesh.position.x;
    const dz = target.z - npc.mesh.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) {
      npc.waypointIndex += 1;
      if (npc.waypointIndex >= npc.waypoints.length) {
        npc.left = true;
        disposeNpc(npc);
      }
      continue;
    }
    const step = Math.min(dist, speed * delta);
    npc.mesh.position.x += (dx / dist) * step;
    npc.mesh.position.z += (dz / dist) * step;
    npc.mesh.rotation.y = Math.atan2(dx, dz) + Math.PI;
  }
  for (let i = npcs.length - 1; i >= 0; i -= 1) {
    if (npcs[i].left) npcs.splice(i, 1);
  }
  return remainingDepartingNpcs(npcs);
};

export const spawnNpcsFromScene = (scene: BABYLON.Scene, sceneData: SceneData): Npc[] => {
  const table = sceneData.assets.find((asset) => asset.id === 'board-table' || asset.name === 'Board Table');
  const tableX = table?.x ?? table?.position?.x ?? 44.2;
  const tableZ = table?.z ?? table?.position?.z ?? 32;
  const seats = sceneData.assets.filter((asset) => asset.components?.includes(NPC_SEAT_COMPONENT));
  return seats.map((seat) => {
    const x = seat.x ?? seat.position?.x ?? 0;
    const z = seat.z ?? seat.position?.z ?? 0;
    return spawnProfessionalNpc(
      scene,
      seat.id,
      x,
      z,
      resolveSeatFacingYaw(seat.id, x, z, tableX, tableZ),
      resolveNpcAssetId(seat.id, seat.npcAssetId),
    );
  });
};
