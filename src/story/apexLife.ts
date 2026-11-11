import * as BABYLON from '@babylonjs/core';

import { createCharacterAvatar, type PlayerAvatar } from '../game/playerAvatar';
import { PLAYER_MESH_Y_OFFSET, PLAYER_STAND_Y } from '../game/player';
import { SIT_LIFT } from '../game/npcs';
import { lifeStats } from '../game/lifeStats';
import { APEX_STAFF, createLinePool } from './placeVoices';

/**
 * People on the 58th floor who are not the board: a night guard on his rounds in hall 1, an associate reading on the
 * waiting chairs in hall 2, a second on the phone beside him, and a late analyst at the hall cooler. Each keeps to a
 * routine, looks at Pierce when he passes, and now and then says something short (voiced lines only; a line never
 * repeats inside five minutes). Routes keep clear of the furniture and of each other (checked by `clearances`).
 * Level 1 only; a phone-tier device gets the guard, the reader and the cooler.
 */
export type ApexLifeHost = {
  scene: BABYLON.Scene;
  playerXZ: () => { x: number; z: number };
  active: () => boolean;
  lowPower: () => boolean;
  playFile: (url: string, volume: number) => void;
  showLine: (title: string, text: string) => void;
};

type Person = {
  id: string;
  mesh: BABYLON.Mesh;
  avatar: PlayerAvatar;
  routine: string;
  baseYaw: number;
  yaw: number;
  seated: boolean;
  glance: number;
  cool: number;
  moving: boolean;
};

const ASSETS = { guard: 'asset-ch31-npc', reader: 'asset-ch08-npc', caller: 'asset-ch28-npc', cooler: 'asset-ch37-npc' } as const;

/** Guard: east side of hall 1 (x 1.0), north and south along the doors, stopping at each to try the handle. */
export const GUARD = { x: 1.0, z0: 4.5, z1: 24, speed: 0.95, stops: [6, 14, 22], stopFor: 2.2 };
/** Waiting chairs in hall 2 face +z. The levels place them at x 27.2 and 28.0, z 30.4. */
export const SEATS = { reader: { x: 27.2, z: 30.35 }, caller: { x: 28.0, z: 30.35 } };
/** The cooler stands on the west wall of hall 1 and faces +x. */
export const COOLER = { x: -1.3, z: 12.5 };

/** Footprints (x, z, radius) of the furniture and people these routes pass, so the routine route can be audited. */
export const CLEARANCES: { name: string; x: number; z: number; r: number }[] = [
  { name: 'hall-cooler', x: -2.0, z: 12.5, r: 0.3 },
  { name: 'hall-cabinet', x: 1.9, z: 18, r: 0.35 },
  { name: 'hall-bin-south', x: 1.9, z: 1.6, r: 0.2 },
  { name: 'hall-bin-north', x: -1.9, z: 23, r: 0.2 },
];

const ANALYST_LEAN = 0.1;

export const createApexLife = (host: ApexLifeHost) => {
  const people: Person[] = [];
  const pool = createLinePool(APEX_STAFF);
  let guardZ = GUARD.z0;
  let guardDir = 1;
  let guardStop = 0;
  let guardDone = new Set<number>();
  let barkIn = 6;
  let lineLeft = 0;
  let clock = 0;

  const spawn = (id: string, assetId: string, x: number, z: number, yaw: number, routine: string, seated: boolean): Person => {
    const mesh = BABYLON.MeshBuilder.CreateCapsule(`apex-life-${id}`, { radius: 0.34, height: 1.5 }, host.scene);
    mesh.position.set(x, PLAYER_STAND_Y, z);
    mesh.visibility = 0;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    const avatar = createCharacterAvatar(host.scene, `apex-life-${id}`, assetId);
    avatar.group.parent = mesh;
    avatar.group.position.y = -PLAYER_MESH_Y_OFFSET + (seated ? SIT_LIFT : 0);
    mesh.rotation.y = yaw + Math.PI;
    const person: Person = { id, mesh, avatar, routine, baseYaw: yaw, yaw, seated, glance: 0, cool: 3 + Math.random() * 3, moving: false };
    avatar.whenReady(() => {
      if (!people.includes(person)) return;
      if (seated) avatar.playClip(routine === 'on-the-phone' ? 'talk' : 'sit', true);
      else avatar.setLocomotion(routine === 'rounds', true);
    });
    lifeStats.person(`apex-${id}`, 'apex', routine);
    people.push(person);
    return person;
  };

  const face = (p: Person, yaw: number) => {
    p.yaw = yaw;
    p.mesh.rotation.y = yaw + Math.PI;
  };
  const turnToward = (p: Person, want: number, dt: number) => {
    let d = want - p.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    face(p, p.yaw + d * Math.min(1, dt * 6));
  };

  const mount = () => {
    dispose();
    guardZ = GUARD.z0;
    guardDir = 1;
    guardStop = 0;
    guardDone = new Set();
    barkIn = 6;
    spawn('guard', ASSETS.guard, GUARD.x, GUARD.z0, 0, 'rounds', false).mesh.position.x = GUARD.x;
    spawn('reader', ASSETS.reader, SEATS.reader.x, SEATS.reader.z, 0, 'reading', true);
    spawn('cooler', ASSETS.cooler, COOLER.x, COOLER.z, -Math.PI / 2, 'at-the-cooler', false);
    if (!host.lowPower()) spawn('caller', ASSETS.caller, SEATS.caller.x, SEATS.caller.z, 0, 'on-the-phone', true);
  };

  const dispose = () => {
    for (const p of people) {
      lifeStats.forget(`apex-${p.id}`);
      p.avatar.dispose();
      if (!p.mesh.isDisposed()) p.mesh.dispose();
    }
    people.length = 0;
  };

  const step = (dt: number) => {
    if (!people.length) return;
    clock += dt;
    const here = host.playerXZ();
    for (const p of people) {
      const dx = here.x - p.mesh.position.x;
      const dz = here.z - p.mesh.position.z;
      const dist = Math.hypot(dx, dz);

      p.cool -= dt;
      if (p.glance <= 0 && p.cool <= 0 && dist < 3.6 && host.active()) {
        p.glance = 1.8;
        p.cool = 11;
        lifeStats.glance('apex', p.id);
      }

      if (p.routine === 'rounds') {
        // Walk the hall, stop at each door to try the handle, never walk into Pierce.
        const yaw = guardDir > 0 ? 0 : Math.PI;
        const ahead = dist < 1.1 && dz * guardDir > 0;
        const stop = GUARD.stops.find((s) => !guardDone.has(s) && Math.abs(s - guardZ) < 0.06);
        if (stop !== undefined) {
          guardDone.add(stop);
          guardStop = GUARD.stopFor;
        }
        if (guardStop > 0) {
          guardStop -= dt;
          p.moving = false;
          p.avatar.setLocomotion(false, true);
          turnToward(p, Math.PI / 2, dt);
          // Rattles the handle halfway through the stop.
          if (guardStop < GUARD.stopFor * 0.5 && guardStop + dt >= GUARD.stopFor * 0.5) {
            host.playFile('/assets/audio/sfx/home/door-open.ogg', 0.18);
            lifeStats.mark();
          }
        } else if (p.glance > 0) {
          p.glance -= dt;
          p.avatar.setLocomotion(false, true);
          turnToward(p, Math.atan2(dx, dz), dt);
        } else if (ahead) {
          p.avatar.setLocomotion(false, true);
        } else {
          guardZ += guardDir * GUARD.speed * dt;
          if (guardZ >= GUARD.z1) { guardZ = GUARD.z1; guardDir = -1; guardDone = new Set(); }
          if (guardZ <= GUARD.z0) { guardZ = GUARD.z0; guardDir = 1; guardDone = new Set(); }
          p.mesh.position.z = guardZ;
          turnToward(p, yaw, dt);
          if (!p.moving) { p.moving = true; p.avatar.setLocomotion(true, true); }
          continue;
        }
        p.moving = false;
      } else if (p.glance > 0) {
        p.glance -= dt;
        const want = Math.atan2(dx, dz);
        let d = want - p.baseYaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        // Seated people turn their heads and shoulders, not all the way round.
        turnToward(p, p.baseYaw + Math.max(-1.2, Math.min(1.2, d)), dt);
      } else {
        turnToward(p, p.baseYaw, dt);
      }

      // Routine posture: the reader bends over the page, the cooler drinker leans on the wall.
      const lean = p.routine === 'reading' ? 0.16 + Math.max(0, Math.sin(clock * 1.1 + 1)) * 0.03 : p.routine === 'at-the-cooler' ? ANALYST_LEAN : 0;
      p.avatar.group.rotation.x += (lean - p.avatar.group.rotation.x) * Math.min(1, dt * 4);

    }
    // One short remark when Pierce is close to someone: voiced lines only, never one heard in the last 5 minutes.
    barkIn -= dt;
    if (barkIn <= 0 && host.active()) {
      const closeOnes = people.filter((p) => Math.hypot(here.x - p.mesh.position.x, here.z - p.mesh.position.z) < 3.2);
      if (!closeOnes.length) { barkIn = 1.5; return; }
      const line = pool();
      barkIn = 12 + Math.random() * 8;
      if (line) {
        host.showLine(line.speaker, line.text);
        host.playFile(line.url, 0.8);
        lineLeft = 3.2;
        lifeStats.bark('apex', closeOnes[0].id, line.id);
      }
    }
    if (lineLeft > 0) {
      lineLeft -= dt;
      if (lineLeft <= 0) host.showLine('', '');
    }
  };

  return {
    mount,
    dispose,
    step,
    blips: () => people.map((p) => ({ x: p.mesh.position.x, z: p.mesh.position.z, kind: p.routine })),
    count: () => people.length,
    /** Resolves once every person's model has loaded (so their shaders compile under the chapter card). */
    ready: () => Promise.all(people.map((p) => new Promise<void>((resolve) => p.avatar.whenReady(resolve)))).then(() => undefined),
  };
};

export type ApexLife = ReturnType<typeof createApexLife>;
