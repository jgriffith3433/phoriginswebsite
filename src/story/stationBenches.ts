import * as BABYLON from '@babylonjs/core';

import { createCharacterAvatar, type PlayerAvatar } from '../game/playerAvatar';
import { PLAYER_STAND_Y } from '../game/player';
import { createSeatBlend, propTopAt, registerSeat, SEAT_TOPS, standingGroupY } from '../game/seatAnchor';
import { lifeStats } from '../game/lifeStats';

/**
 * Commuters waiting on the station's two steel benches (`station-bench-a`, `station-bench-b`, against the south wall,
 * seats toward the platform). Each sits where the bench really is: the bench's world bounds give the seat's middle
 * and depth, and a ray through its own meshes gives the seat pan's height, so hips land on the plank.
 * They are scenery that breathes (npcLife does the glances and shifts); the walkers are the Shadow-mode targets.
 */
export type StationBenchesHost = { scene: BABYLON.Scene };

/** Bench id, the asset used for each sitter and where along the bench he sits (-1..1 of half the length). */
const SITTERS: { bench: string; asset: string; along: number }[] = [
  { bench: 'station-bench-a', asset: 'asset-ch31-npc', along: 0 },
  { bench: 'station-bench-b', asset: 'asset-ch08-npc', along: -0.45 },
  { bench: 'station-bench-b', asset: 'asset-ch23-npc', along: 0.45 },
];

type Sitter = { id: string; mesh: BABYLON.Mesh; avatar: PlayerAvatar };

export const createStationBenches = (host: StationBenchesHost) => {
  const sitters: Sitter[] = [];
  let pending = SITTERS.map((spec, index) => ({ spec, index }));
  let mounted = false;

  /** Seats a sitter once his bench has loaded (bounds and the seat pan need the model); returns false to retry. */
  const trySeat = (spec: (typeof SITTERS)[number], index: number): boolean => {
    const root = host.scene.getTransformNodeByName(spec.bench);
    if (!root || !root.getChildMeshes(false).length) return false;
    const { min, max } = root.getHierarchyBoundingVectors(true);
    if (!(max.x - min.x > 0.2)) return false;
    // The bench runs along its longer horizontal axis; the seat's depth is the shorter one. Seats face away from the wall (+z).
    const alongX = max.x - min.x >= max.z - min.z;
    const cx = (min.x + max.x) / 2;
    const cz = (min.z + max.z) / 2;
    const half = (alongX ? max.x - min.x : max.z - min.z) / 2 - 0.3;
    const x = alongX ? cx + spec.along * half : cx;
    const z = alongX ? cz : cz + spec.along * half;
    const top = propTopAt(root, x, z) ?? SEAT_TOPS.stationBench;
    const id = `station-sitter-${index}`;
    const mesh = BABYLON.MeshBuilder.CreateCapsule(id, { radius: 0.34, height: 1.5 }, host.scene);
    mesh.position.set(x, PLAYER_STAND_Y, z);
    mesh.rotation.y = Math.PI; // faces +z (yaw 0), toward the platform
    mesh.visibility = 0;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    const avatar = createCharacterAvatar(host.scene, id, spec.asset);
    avatar.group.parent = mesh;
    avatar.group.position.y = standingGroupY();
    const seat = createSeatBlend(avatar);
    seat.setSeated(top);
    registerSeat(`station-bench-${index}`, seat, avatar);
    avatar.whenReady(() => {
      if (sitters.some((s) => s.id === id)) avatar.playClip('sit', true);
    });
    lifeStats.person(id, 'station', 'bench');
    sitters.push({ id, mesh, avatar });
    return true;
  };

  const dispose = () => {
    for (const s of sitters) {
      lifeStats.forget(s.id);
      s.avatar.dispose();
      if (!s.mesh.isDisposed()) s.mesh.dispose();
    }
    sitters.length = 0;
    pending = [];
  };

  return {
    mount: () => {
      dispose();
      pending = SITTERS.map((spec, index) => ({ spec, index }));
      mounted = true;
    },
    dispose: () => {
      mounted = false;
      dispose();
    },
    /** Retries the benches that had not loaded yet (a few ms a frame at most, nothing once everyone sits). */
    step: () => {
      if (!mounted || !pending.length) return;
      pending = pending.filter(({ spec, index }) => !trySeat(spec, index));
    },
    count: () => sitters.length,
  };
};

export type StationBenches = ReturnType<typeof createStationBenches>;
