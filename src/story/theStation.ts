import * as BABYLON from '@babylonjs/core';

import { createCharacterAvatar, type PlayerAvatar } from '../game/playerAvatar';
import { PLAYER_MESH_Y_OFFSET, PLAYER_STAND_Y } from '../game/player';
import type { StoryCarry } from './act1';

export type TheStationHost = {
  scene: BABYLON.Scene;
  running: () => boolean;
  placePierce: (x: number, z: number, yaw: number) => void;
  playClip: (clip: string, loop: boolean, speed?: number, onEnded?: () => void) => void;
  camera: BABYLON.Camera;
  resumeLocomotion: () => void;
  fade: (to: number, seconds?: number) => void;
  setObjective: (title: string, text: string, target: { x: number; z: number; y?: number } | null) => void;
  showObjective: (visible: boolean) => void;
  clearMarker: () => void;
  playFile: (url: string, volume: number) => void;
  setWalk: (moving: boolean) => void;
  setCarry: (items: StoryCarry[]) => void;
  win: () => void;
  showMessage: (title: string, text: string) => void;
  haltPlay: () => void;
  clearInput: () => void;
  unlockNext: () => void;
  refreshHud: () => void;
  holster: () => void;
  hand: () => { x: number; y: number; z: number } | null;
  player: () => { x: number; z: number; yaw: number };
  shedShadow: (x: number, z: number) => void;
};

const DOOR = { x: 50.3, z: 1.55 };
const SHOUT = '/assets/audio/street/pedestrian-away.wav';
const ASSETS = ['asset-ch08-npc', 'asset-ch28-npc', 'asset-ch31-npc', 'asset-ch23-npc'];

const CARRY: StoryCarry[] = [
  { id: 'phone', name: 'Phone', note: 'No signal this far down.' },
  { id: 'sidearm', name: 'Sidearm', note: 'Q draws it, until Shadow mode.' },
  { id: 'shadow', name: 'Shadow mode', note: 'C. Click is Shadow Shock. Q raises the hands. V possesses. While linked, V consumes and Tab lets go.' },
];

type Person = {
  mesh: BABYLON.Mesh;
  avatar: PlayerAvatar;
  x0: number;
  x1: number;
  z: number;
  dir: number;
  skittish: boolean;
  fleeing: boolean;
  screamed: boolean;
  moving: boolean;
  down: boolean;
};

export type TheStation = ReturnType<typeof createTheStation>;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const createTheStation = (host: TheStationHost) => {
  const people: Person[] = [];
  const beads: BABYLON.Mesh[] = [];
  let active = false;
  let finished = false;
  let shadowOn = false;
  let handsOut = false;
  let tether: Person | null = null;
  let tetherMove = { x: 0, z: 0 };
  let tetherMoving = false;
  let linkTime = 0;
  let trailLeft = 0;
  let shockLeft = 0;
  let watchLeft = 0;
  let watchX = 0;
  let watchZ = 0;
  const trailFrom = new BABYLON.Vector3();
  const trailTo = new BABYLON.Vector3();

  const face = (person: Person, yaw: number) => {
    person.avatar.group.rotation.y = yaw + Math.PI;
  };

  const spawn = (id: string, assetId: string, x: number, z: number, x0: number, x1: number) => {
    const mesh = BABYLON.MeshBuilder.CreateCapsule(id, { radius: 0.38, height: 1.55 }, host.scene);
    mesh.position.set(x, PLAYER_STAND_Y, z);
    mesh.visibility = 0;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    const avatar = createCharacterAvatar(host.scene, id, assetId);
    avatar.group.parent = mesh;
    avatar.group.position.y = -PLAYER_MESH_Y_OFFSET;
    const person: Person = {
      mesh,
      avatar,
      x0,
      x1,
      z,
      dir: 1,
      skittish: Math.random() < 0.2,
      fleeing: false,
      screamed: false,
      moving: true,
      down: false,
    };
    face(person, Math.PI / 2);
    avatar.whenReady(() => {
      if (!person.down && person !== tether) person.avatar.setLocomotion(true, true);
    });
    people.push(person);
  };

  const showGoal = () => {
    const door = { x: DOOR.x, y: 1.3, z: DOOR.z };
    if (tether) {
      host.setObjective('Shadow Link', 'WASD walks them. V consumes. Tab lets go.', null);
      return;
    }
    if (shadowOn && !handsOut) {
      host.setObjective('Shadow mode', 'Click is Shadow Shock. Q raises the hands.', door);
      return;
    }
    if (shadowOn) {
      host.setObjective('Shadow Link', 'Aim at them. V possesses. Click still shocks.', door);
      return;
    }
    host.setObjective('The train', 'The open door, down the platform.', door);
  };

  const hideBeads = () => {
    for (const bead of beads) bead.setEnabled(false);
  };

  const ensureBeads = () => {
    if (beads.length) return;
    const material = new BABYLON.StandardMaterial('station-shadow-link-mat', host.scene);
    material.diffuseColor = new BABYLON.Color3(0.01, 0.01, 0.012);
    material.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.022);
    material.specularColor = BABYLON.Color3.Black();
    material.disableLighting = true;
    material.alpha = 0.32;
    material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    for (let i = 0; i < 16; i += 1) {
      const bead = BABYLON.MeshBuilder.CreateSphere(`station-shadow-link-${i}`, { diameter: 0.14, segments: 4 }, host.scene);
      bead.material = material;
      bead.isPickable = false;
      bead.checkCollisions = false;
      bead.setEnabled(false);
      beads.push(bead);
    }
  };

  const handOrigin = () => {
    const joint = host.hand();
    if (joint) return new BABYLON.Vector3(joint.x, joint.y, joint.z);
    const here = host.player();
    return new BABYLON.Vector3(
      here.x + Math.sin(here.yaw) * 0.42,
      1.22,
      here.z + Math.cos(here.yaw) * 0.42,
    );
  };

  const poseBeads = (from: BABYLON.Vector3, to: BABYLON.Vector3) => {
    ensureBeads();
    const dir = to.subtract(from);
    const len = Math.max(0.001, dir.length());
    const perp = new BABYLON.Vector3(-dir.z / len, 0, dir.x / len);
    for (let i = 0; i < beads.length; i += 1) {
      const t = i / (beads.length - 1);
      const wave = Math.sin(t * 16 + linkTime * 7.5) * 0.2 * Math.sin(t * Math.PI);
      const lift = Math.sin(t * Math.PI) * 0.42;
      const bead = beads[i];
      bead.setEnabled(true);
      bead.position.set(
        from.x + dir.x * t + perp.x * wave,
        from.y + dir.y * t + lift,
        from.z + dir.z * t + perp.z * wave,
      );
    }
  };

  const updateRibbon = () => {
    if (tether) {
      poseBeads(handOrigin(), tether.mesh.position.add(new BABYLON.Vector3(0, 1.15, 0)));
      return;
    }
    if (trailLeft > 0) {
      poseBeads(trailFrom, trailTo);
      return;
    }
    hideBeads();
  };

  const watchDeath = (x: number, z: number) => {
    const here = host.player();
    host.placePierce(here.x, here.z, Math.atan2(x - here.x, z - here.z));
    watchX = x;
    watchZ = z;
    watchLeft = 2.6;
    host.shedShadow(x, z);
  };

  const releaseLink = (announce = true) => {
    tether = null;
    tetherMove = { x: 0, z: 0 };
    tetherMoving = false;
    hideBeads();
    if (announce && active && !finished) showGoal();
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    host.setWalk(false);
    host.clearMarker();
    host.showObjective(false);
    host.clearInput();
    host.playClip('rebornidle', true);
    host.haltPlay();
    host.unlockNext();
    host.win();
    host.fade(1, 1.15);
    host.refreshHud();
    host.showMessage('Level Complete', 'The train is waiting. There is nowhere else to go.');
  };

  return {
    dispose: () => {
      active = false;
      releaseLink(false);
      for (const bead of beads) bead.dispose(false, true);
      beads.length = 0;
      for (const person of people) {
        person.avatar.dispose();
        person.mesh.dispose();
      }
      people.length = 0;
    },
    mount: async () => {
      active = true;
      finished = false;
      shadowOn = false;
      handsOut = false;
      tether = null;
      people.length = 0;
      const spots: [number, number, number, number][] = [
        [22, -4.2, 16, 28],
        [36, -1.1, 30, 42],
        [58, -4.4, 52, 66],
        [70, -1.2, 64, 76],
      ];
      spots.forEach(([x, z, x0, x1], index) => {
        spawn(`station-walk-${index}`, ASSETS[index % ASSETS.length], x, z, x0, x1);
      });
    },
    onStart: () => {
      if (!active) return;
      shadowOn = false;
      handsOut = false;
      host.placePierce(7.2, -1.6, Math.PI / 2);
      host.resumeLocomotion();
      host.setCarry(CARRY);
      showGoal();
      host.showObjective(true);
      host.fade(0, 1.1);
      host.refreshHud();
    },
    controls: () => active && !finished,
    shadowMode: () => shadowOn,
    handsOut: () => shadowOn && handsOut,
    setHands: (out: boolean) => {
      if (!active || finished || !shadowOn) return;
      handsOut = out;
      if (!out) {
        trailLeft = 0;
        hideBeads();
      }
      showGoal();
    },
    aimMarks: () => {
      const marks: { x: number; y: number; z: number }[] = [];
      if (!shadowOn || !handsOut || tether) return marks;
      for (const person of people) {
        if (person.down) continue;
        marks.push({ x: person.mesh.position.x, y: person.mesh.position.y, z: person.mesh.position.z });
      }
      return marks;
    },
    ignoresAim: (mesh: BABYLON.AbstractMesh) => {
      for (const person of people) {
        if (mesh === person.mesh || mesh.isDescendantOf(person.avatar.group)) return true;
      }
      return false;
    },
    possessAt: (x: number, y: number, z: number) => {
      if (!active || finished || !shadowOn || !handsOut || tether) return false;
      let best: Person | null = null;
      let bestDist = 1.35;
      for (const person of people) {
        if (person.down) continue;
        const dist = Math.hypot(person.mesh.position.x - x, person.mesh.position.y - y, person.mesh.position.z - z);
        if (dist > bestDist) continue;
        best = person;
        bestDist = dist;
      }
      if (!best) return false;
      tether = best;
      best.fleeing = false;
      best.avatar.resumeLocomotion();
      showGoal();
      return true;
    },
    consume: () => {
      if (!active || finished || !shadowOn || !tether) return false;
      const best = tether;
      trailFrom.copyFrom(handOrigin());
      trailTo.set(best.mesh.position.x, best.mesh.position.y, best.mesh.position.z);
      trailLeft = 0.55;
      ensureBeads();
      best.down = true;
      best.moving = false;
      best.avatar.playClip('deathforward', false);
      const atX = best.mesh.position.x;
      const atZ = best.mesh.position.z;
      releaseLink();
      watchDeath(atX, atZ);
      return true;
    },
    release: () => {
      if (!tether) return false;
      releaseLink();
      return true;
    },
    toggleShadow: () => {
      if (!active || finished) return shadowOn;
      if (tether) releaseLink();
      shadowOn = !shadowOn;
      handsOut = false;
      trailLeft = 0;
      hideBeads();
      if (shadowOn) host.holster();
      showGoal();
      return shadowOn;
    },
    linked: () => !!tether,
    linkFocus: () => {
      if (tether) return { x: tether.mesh.position.x, z: tether.mesh.position.z };
      if (watchLeft > 0) return { x: watchX, z: watchZ };
      return null;
    },
    linkMoving: () => tetherMoving,
    driveLinked: (dx: number, dz: number) => {
      tetherMove = { x: dx, z: dz };
      tetherMoving = Math.hypot(dx, dz) > 0.0008;
    },
    shadowShown: () => active && !finished,
    shock: () => {
      if (!active || finished || shockLeft > 0) return false;
      const here = host.player();
      const look = host.camera.getForwardRay(1).direction;
      const camLen = Math.hypot(look.x, look.z) || 1;
      const camX = look.x / camLen;
      const camZ = look.z / camLen;
      const bodyX = Math.sin(here.yaw);
      const bodyZ = Math.cos(here.yaw);
      let hit = false;
      for (const person of people) {
        if (person.down || person === tether) continue;
        const dx = person.mesh.position.x - here.x;
        const dz = person.mesh.position.z - here.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 6.2 || dist < 0.05) continue;
        const dot = Math.max((dx * camX + dz * camZ) / dist, (dx * bodyX + dz * bodyZ) / dist);
        if (dist > 2.8 ? dot < 0.4 : dot < 0.08) continue;
        person.down = true;
        person.moving = false;
        person.avatar.playClip('electrocuted', false);
        host.shedShadow(person.mesh.position.x, person.mesh.position.z);
        hit = true;
      }
      if (!hit) return false;
      shockLeft = 1.35;
      host.playClip('shadowshock', false, 1, () => {
        if (active && !finished) host.resumeLocomotion();
      });
      return true;
    },
    shocking: () => shockLeft > 0,
    step: (dt: number) => {
      if (!active || finished) return;
      const stepDt = Math.min(0.05, Math.max(0, dt));
      shockLeft = Math.max(0, shockLeft - stepDt);
      watchLeft = Math.max(0, watchLeft - stepDt);
      linkTime += stepDt;
      trailLeft = Math.max(0, trailLeft - stepDt);
      const here = host.player();
      updateRibbon();
      if (tether && Math.hypot(tether.mesh.position.x - here.x, tether.mesh.position.z - here.z) > 18) releaseLink();
      for (const person of people) {
        if (person === tether) {
          const mx = tetherMove.x;
          const mz = tetherMove.z;
          person.moving = Math.hypot(mx, mz) > 0.002;
          if (person.moving) {
            person.mesh.position.x = clamp(person.mesh.position.x + mx, 2, 78);
            person.mesh.position.z = clamp(person.mesh.position.z + mz, -6.2, 1.8);
            face(person, Math.atan2(mx, mz));
          }
          person.avatar.setLocomotion(person.moving, true);
          tetherMove = { x: 0, z: 0 };
          continue;
        }
        if (person.down) continue;
        const dx = person.mesh.position.x - here.x;
        const dz = person.mesh.position.z - here.z;
        const dist = Math.hypot(dx, dz);
        if (shadowOn && person.fleeing) person.fleeing = false;
        if (!shadowOn && !person.fleeing && person.skittish && dist < 2.3) {
          person.fleeing = true;
          person.dir = dx >= 0 ? 1 : -1;
          if (!person.screamed) {
            person.screamed = true;
            host.playFile(SHOUT, 0.55);
          }
        }
        const speed = person.fleeing ? 3.4 : 1.15;
        const limit = person.fleeing ? 4 : 0;
        if (person.mesh.position.x > person.x1 + limit) person.dir = -1;
        if (person.mesh.position.x < person.x0 - limit) person.dir = 1;
        if (!shadowOn && dist < 1.15 && Math.abs(dz) < 1.2 && person.dir * (here.x - person.mesh.position.x) > 0.15) {
          person.dir = -person.dir;
        }
        person.mesh.position.x += person.dir * speed * stepDt;
        person.mesh.position.z += (person.z - person.mesh.position.z) * Math.min(1, stepDt * 2);
        const moving = speed > 0.2;
        if (moving !== person.moving) person.moving = moving;
        person.avatar.setLocomotion(moving, true);
        face(person, person.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
      if (!tether && host.running() && Math.abs(here.x - DOOR.x) < 1.6 && here.z > 0.85 && here.z < 2.15) finish();
    },
  };
};
