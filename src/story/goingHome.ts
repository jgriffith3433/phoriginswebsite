import * as BABYLON from '@babylonjs/core';

import { createCharacterAvatar, type PlayerAvatar } from '../game/playerAvatar';
import { PLAYER_MESH_Y_OFFSET, PLAYER_STAND_Y } from '../game/player';
import type { StoryCarry } from './act1';

export type GoingHomeHost = {
  scene: BABYLON.Scene;
  camera: BABYLON.Camera;
  running: () => boolean;
  placePierce: (x: number, z: number, yaw: number) => void;
  playClip: (clip: string, loop: boolean, speed?: number, onEnded?: () => void) => void;
  holdLocomotion: () => void;
  resumeLocomotion: () => void;
  frameCamera: (position: { x: number; y: number; z: number }, lookAt: { x: number; y: number; z: number }) => void;
  releaseCamera: () => void;
  fade: (to: number, seconds?: number) => void;
  showLine: (title: string, text: string) => void;
  holdScene: (held: boolean) => void;
  setObjective: (title: string, text: string, target: { x: number; z: number; y?: number } | null) => void;
  showObjective: (visible: boolean) => void;
  clearMarker: () => void;
  playFile: (url: string, volume: number) => void;
  setWalk: (moving: boolean) => void;
  setCarry: (items: StoryCarry[]) => void;
  hurt: (amount: number) => void;
  win: () => void;
  showMessage: (title: string, text: string) => void;
  haltPlay: () => void;
  clearInput: () => void;
  unlockNext: () => void;
  refreshHud: () => void;
  player: () => { x: number; z: number; yaw: number };
  hand: () => { x: number; y: number; z: number } | null;
  leftHand: () => { x: number; y: number; z: number } | null;
  holster: () => void;
  shedShadow: (x: number, z: number) => void;
};

const HOME = { x: 163.5, z: 21.2 };
const SPAWN = { x: 0, z: 2.35, yaw: 0 };
const STREET = { x: 3.6, z: 21.2, yaw: Math.PI / 2 };

const SCREAM = '/assets/audio/cutscenes/going-home/01-receptionist-scream.wav';
const POLICE_CALL = '/assets/audio/cutscenes/going-home/02-receptionist-police.wav';
const NOT_UP = '/assets/audio/cutscenes/going-home/03-pierce-not-going-up.wav';
const PEDESTRIAN = '/assets/audio/street/pedestrian-away.wav';
const POLICE_SHOUT = '/assets/audio/street/police-stop.wav';

const CARRY: StoryCarry[] = [
  { id: 'phone', name: 'Phone', note: 'It still rings. He is not picking it up.' },
  { id: 'sidearm', name: 'Sidearm', note: 'Q draws it, until Shadow mode.' },
  { id: 'shove', name: 'Shove', note: 'The new body. V, in front of him.' },
  { id: 'shadow', name: 'Shadow mode', note: 'C. Click is Shadow Shock. Q raises the hands. V possesses. While linked, V consumes and Tab lets go.' },
];

type Role = 'desk' | 'walk' | 'hostile' | 'police';
type Mood = 'calm' | 'flee' | 'chase' | 'stagger' | 'lost' | 'down';

type Person = {
  mesh: BABYLON.Mesh;
  avatar: PlayerAvatar;
  role: Role;
  mood: Mood;
  hp: number;
  x0: number;
  x1: number;
  z: number;
  dir: number;
  stagger: number;
  attack: number;
  screamed: boolean;
  fell: boolean;
  moving: boolean;
  skittish: boolean;
  shocked: boolean;
  lost: number;
};

type Car = {
  root: BABYLON.TransformNode;
  speed: number;
  x: number;
  z: number;
  axis: 'x' | 'z';
  parked: boolean;
};

type Pose = { t: number; x: number; z: number; yaw: number };
type Shot = { t: number; cx: number; cy: number; cz: number; lx: number; ly: number; lz: number };

const WALK: Pose[] = [
  { t: 0, x: 0, z: 2.35, yaw: 0 },
  { t: 2.6, x: 0, z: 2.35, yaw: 0 },
  { t: 13.2, x: 0, z: 8.6, yaw: 0 },
  { t: 26, x: 0, z: 21.2, yaw: 0 },
  { t: 30, x: 1.4, z: 21.2, yaw: Math.PI / 2 },
  { t: 36, x: STREET.x, z: STREET.z, yaw: STREET.yaw },
];

const SHOTS: Shot[] = [
  { t: 0, cx: -1.5, cy: 1.7, cz: 1.55, lx: 2.4, ly: 1.4, lz: 4.4 },
  { t: 7, cx: -1.6, cy: 1.72, cz: 3.5, lx: 4.2, ly: 1.4, lz: 4.2 },
  { t: 14, cx: -1.9, cy: 1.74, cz: 6.8, lx: 0.4, ly: 1.42, lz: 12 },
  { t: 24, cx: -1.4, cy: 1.8, cz: 14.5, lx: 0.15, ly: 1.4, lz: 20 },
  { t: 31, cx: -7, cy: 5.8, cz: 16, lx: 8, ly: 12, lz: 42 },
  { t: 36, cx: 0.8, cy: 2.05, cz: 17.8, lx: STREET.x, ly: 1.5, lz: STREET.z },
];

const CROWD: [number, number, number, number][] = [
  [-22, 21.15, Math.PI / 2, -30],
  [-14, 21.05, Math.PI / 2, -22],
  [-6, 21.25, -Math.PI / 2, -12],
  [4, 21.1, Math.PI / 2, -2],
  [12, 21.2, -Math.PI / 2, 6],
  [22, 21.05, Math.PI / 2, 16],
  [32, 21.3, -Math.PI / 2, 26],
  [-18, 36.2, Math.PI / 2, -26],
  [-8, 36.35, -Math.PI / 2, -16],
  [2, 36.15, Math.PI / 2, -4],
  [14, 36.4, -Math.PI / 2, 8],
  [28, 36.1, Math.PI / 2, 20],
];
const FAR: [number, number, number, number][] = [];
for (let x = 52; x <= 148; x += 24) {
  FAR.push([x, 21.15, x % 48 < 24 ? Math.PI / 2 : -Math.PI / 2, x - 8]);
  FAR.push([x + 6, 36.2, Math.PI / 2, x - 2]);
}
const NORTH: [number, number, number, number][] = [
  [36, 80.2, Math.PI / 2, 24],
  [78, 93.5, -Math.PI / 2, 66],
  [120, 80.3, Math.PI / 2, 108],
  [210, 93.6, Math.PI / 2, 198],
  [48, 138.2, -Math.PI / 2, 36],
  [170, 138.4, Math.PI / 2, 158],
];
const CROWD_ASSETS = ['asset-ch08-npc', 'asset-ch28-npc', 'asset-ch31-npc', 'asset-ch23-npc'];
const HOSTILE_CHANCE = 1 / 25;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const sample = <T extends { t: number }>(keys: T[], time: number): [T, T, number] => {
  let i = 0;
  while (i < keys.length - 2 && time > keys[i + 1].t) i += 1;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  const span = Math.max(0.001, b.t - a.t);
  return [a, b, Math.max(0, Math.min(1, (time - a.t) / span))];
};

const paint = (scene: BABYLON.Scene, name: string, diffuse: BABYLON.Color3, emissive?: BABYLON.Color3) => {
  const material = new BABYLON.StandardMaterial(name, scene);
  material.diffuseColor = diffuse;
  material.specularColor = new BABYLON.Color3(0.04, 0.04, 0.05);
  if (emissive) material.emissiveColor = emissive;
  return material;
};

const buildCar = (scene: BABYLON.Scene, name: string, x: number, z: number, speed: number, axis: 'x' | 'z' = 'x'): Car => {
  const root = new BABYLON.TransformNode(name, scene);
  root.position.set(x, 0, z);
  if (axis === 'z') root.rotation.y = speed < 0 ? -Math.PI / 2 : Math.PI / 2;
  else if (speed < 0) root.rotation.y = Math.PI;
  const body = BABYLON.MeshBuilder.CreateBox(`${name}-body`, { width: 4.4, height: 0.72, depth: 1.85 }, scene);
  body.parent = root;
  body.position.y = 0.72;
  body.material = paint(scene, `${name}-body-mat`, new BABYLON.Color3(0.11, 0.12, 0.14));
  body.checkCollisions = false;
  body.isPickable = false;
  const cabin = BABYLON.MeshBuilder.CreateBox(`${name}-cabin`, { width: 2.1, height: 0.55, depth: 1.65 }, scene);
  cabin.parent = root;
  cabin.position.set(-0.15, 1.28, 0);
  cabin.material = paint(scene, `${name}-cabin-mat`, new BABYLON.Color3(0.04, 0.05, 0.07), new BABYLON.Color3(0.02, 0.03, 0.04));
  cabin.isPickable = false;
  const lampMat = paint(scene, `${name}-lamp-mat`, new BABYLON.Color3(1, 0.92, 0.7), new BABYLON.Color3(1, 0.86, 0.45));
  const tailMat = paint(scene, `${name}-tail-mat`, new BABYLON.Color3(0.7, 0.08, 0.06), new BABYLON.Color3(0.85, 0.05, 0.04));
  for (const side of [-0.7, 0.7]) {
    const head = BABYLON.MeshBuilder.CreateBox(`${name}-head-${side}`, { width: 0.12, height: 0.16, depth: 0.28 }, scene);
    head.parent = root;
    head.position.set(2.15, 0.78, side);
    head.material = lampMat;
    head.isPickable = false;
    const tail = BABYLON.MeshBuilder.CreateBox(`${name}-tail-${side}`, { width: 0.1, height: 0.14, depth: 0.26 }, scene);
    tail.parent = root;
    tail.position.set(-2.15, 0.78, side);
    tail.material = tailMat;
    tail.isPickable = false;
  }
  const wheelMat = paint(scene, `${name}-wheel-mat`, new BABYLON.Color3(0.02, 0.02, 0.02));
  for (const wx of [-1.35, 1.35]) {
    for (const wz of [-0.82, 0.82]) {
      const wheel = BABYLON.MeshBuilder.CreateCylinder(`${name}-wheel-${wx}-${wz}`, { height: 0.22, diameter: 0.62 }, scene);
      wheel.parent = root;
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.32, wz);
      wheel.material = wheelMat;
      wheel.isPickable = false;
    }
  }
  const blocker = BABYLON.MeshBuilder.CreateBox(`${name}-block`, { width: 4.5, height: 1.5, depth: 1.95 }, scene);
  blocker.parent = root;
  blocker.position.y = 0.8;
  blocker.visibility = 0;
  blocker.isPickable = false;
  blocker.checkCollisions = speed === 0;
  return { root, speed, x, z, axis, parked: speed === 0 };
};

export const createGoingHome = (host: GoingHomeHost) => {
  const people: Person[] = [];
  const cars: Car[] = [];
  let active = false;
  let playing = false;
  let time = 0;
  let clip: 'walk' | 'idle' | '' = '';
  let lineUntil = 0;
  let screamed = false;
  let called = false;
  let pierceSaid = false;
  let streetTime = 0;
  let taught = false;
  let shoveLeft = 0;
  let shake = 0;
  let carHit = 0;
  let finished = false;
  let policeWaves = 0;
  let policeLine = false;
  let shoutLeft = 0;
  let skipStreet = false;
  let tether: Person | null = null;
  let tetherMove = { x: 0, z: 0 };
  let tetherMoving = false;
  let linkTime = 0;
  let shadowOn = false;
  let handsOut = false;
  let trailLeft = 0;
  let watchLeft = 0;
  let watchX = 0;
  let watchZ = 0;
  const trailFrom = new BABYLON.Vector3();
  const trailTo = new BABYLON.Vector3();
  const beads: BABYLON.Mesh[] = [];
  const disposers: BABYLON.Node[] = [];

  const face = (person: Person, yaw: number) => {
    person.avatar.group.rotation.y = yaw + Math.PI;
  };

  const setClip = (next: 'walk' | 'idle', moving: boolean) => {
    host.setWalk(moving && playing);
    if (clip === next) return;
    clip = next;
    host.playClip(next === 'walk' ? 'walk' : 'rebornidle', true);
  };

  const spawnPerson = (
    id: string,
    assetId: string,
    x: number,
    z: number,
    yaw: number,
    role: Role,
    x0 = x - 6,
    x1 = x + 6,
  ): Person => {
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
      role,
      mood: 'calm',
      hp: role === 'police' ? 4 : role === 'hostile' ? 3 : 1,
      x0,
      x1,
      z,
      dir: 1,
      stagger: 0,
      attack: 0,
      screamed: false,
      fell: false,
      moving: false,
      skittish: false,
      shocked: false,
      lost: 0,
    };
    face(person, yaw);
    people.push(person);
    return person;
  };

  const slideDoors = (open: number) => {
    const left = host.scene.getMeshByName('lobby-door-l');
    const right = host.scene.getMeshByName('lobby-door-r');
    if (left) left.position.x = lerp(-0.58, -1.85, open);
    if (right) right.position.x = lerp(0.58, 1.85, open);
  };

  const say = (title: string, text: string, url: string, volume: number, hold: number) => {
    host.showLine(title, text);
    host.playFile(url, volume);
    lineUntil = time + hold;
  };

  const hideBeads = () => {
    for (const bead of beads) bead.setEnabled(false);
  };

  const ensureBeads = () => {
    if (beads.length) return;
    const material = paint(host.scene, 'shadow-link-mat', new BABYLON.Color3(0.01, 0.01, 0.012), new BABYLON.Color3(0.02, 0.02, 0.022));
    material.alpha = 0.32;
    material.disableLighting = true;
    material.specularColor = BABYLON.Color3.Black();
    material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    for (let i = 0; i < 16; i += 1) {
      const bead = BABYLON.MeshBuilder.CreateSphere(`shadow-link-${i}`, { diameter: 0.14, segments: 4 }, host.scene);
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

  const poseBeads = (from: BABYLON.Vector3, to: BABYLON.Vector3, waveTime: number) => {
    ensureBeads();
    const dir = to.subtract(from);
    const len = Math.max(0.001, dir.length());
    const perp = new BABYLON.Vector3(-dir.z / len, 0, dir.x / len);
    for (let i = 0; i < beads.length; i += 1) {
      const t = i / (beads.length - 1);
      const wave = Math.sin(t * 16 + waveTime * 7.5) * 0.2 * Math.sin(t * Math.PI);
      const lift = Math.sin(t * Math.PI) * 0.42;
      const bead = beads[i];
      bead.setEnabled(true);
      bead.position.set(
        from.x + dir.x * t + perp.x * wave,
        from.y + dir.y * t + lift,
        from.z + dir.z * t + perp.z * wave,
      );
      const scale = 0.65 + Math.sin(t * 22 + waveTime * 9) * 0.35;
      bead.scaling.setAll(scale);
    }
  };

  const updateRibbon = () => {
    if (tether) {
      poseBeads(handOrigin(), tether.mesh.position.add(new BABYLON.Vector3(0, 1.15, 0)), linkTime);
      return;
    }
    if (trailLeft > 0) {
      poseBeads(trailFrom, trailTo, linkTime);
      return;
    }
    hideBeads();
  };

  const streetCopy = () => {
    if (!shadowOn) return { title: 'The station', text: 'Stairs down, a few blocks east. C is Shadow mode.' };
    if (!handsOut) return { title: 'Shadow mode', text: 'Click is Shadow Shock. Q raises the hands.' };
    return { title: 'Shadow Link', text: 'Aim at them. V possesses. Click still shocks.' };
  };

  const showStreet = () => {
    const copy = streetCopy();
    host.setObjective(copy.title, copy.text, { x: HOME.x, y: 1.2, z: HOME.z });
  };

  const releaseLink = (backToStreet: boolean) => {
    tether = null;
    tetherMove = { x: 0, z: 0 };
    tetherMoving = false;
    hideBeads();
    if (backToStreet && !finished) showStreet();
  };

  const handoff = () => {
    playing = false;
    clip = '';
    host.holdScene(false);
    host.releaseCamera();
    host.showLine('', '');
    host.setWalk(false);
    host.resumeLocomotion();
    host.setObjective('The station', 'Stairs down, a few blocks east. C is Shadow mode.', { x: HOME.x, y: 1.2, z: HOME.z });
    host.showObjective(true);
    const desk = people.find((person) => person.role === 'desk');
    if (desk && desk.mood === 'calm') desk.mood = 'flee';
  };

  const beginCutscene = () => {
    playing = true;
    time = 0;
    screamed = false;
    called = false;
    pierceSaid = false;
    streetTime = 0;
    taught = false;
    clip = '';
    host.fade(1, 0);
    host.fade(0, 1.5);
    host.holdScene(true);
    host.showObjective(false);
    host.clearMarker();
    host.placePierce(SPAWN.x, SPAWN.z, SPAWN.yaw);
    host.playClip('rebornidle', true);
    clip = 'idle';
    slideDoors(0);
  };

  const beginStreet = () => {
    playing = false;
    time = 40;
    host.fade(0, 0.4);
    host.holdScene(false);
    host.releaseCamera();
    const nearStairs = new URLSearchParams(location.search).get('at') === 'stairs';
    host.placePierce(nearStairs ? 150 : STREET.x, STREET.z, STREET.yaw);
    host.resumeLocomotion();
    host.setObjective('The station', 'Stairs down, a few blocks east. C is Shadow mode.', { x: HOME.x, y: 1.2, z: HOME.z });
    host.showObjective(true);
    const desk = people.find((person) => person.role === 'desk');
    if (desk) desk.mood = 'flee';
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    host.clearMarker();
    host.showObjective(false);
    host.clearInput();
    host.holdLocomotion();
    host.playClip('rebornidle', true);
    host.haltPlay();
    host.unlockNext();
    host.win();
    host.fade(1, 1.15);
    host.refreshHud();
    host.showMessage('Level Complete', 'The stairs go down. Continue. The station is waiting.');
  };

  const spawnPolice = (x: number, z: number, index: number) => {
    const person = spawnPerson(
      `street-police-${policeWaves}-${index}`,
      index === 0 ? 'asset-ch23-npc' : 'asset-ch31-npc',
      x,
      z,
      0,
      'police',
    );
    person.mood = 'chase';
    person.avatar.whenReady(() => {
      if (person.mood !== 'down') person.avatar.playClip('walk', true);
    });
  };

  const watchDeath = (x: number, z: number) => {
    const here = host.player();
    host.placePierce(here.x, here.z, Math.atan2(x - here.x, z - here.z));
    watchX = x;
    watchZ = z;
    watchLeft = 2.6;
    host.shedShadow(x, z);
  };

  const bind = (person: Person) => {
    tether = person;
    person.mood = 'calm';
    person.stagger = 0;
    person.attack = 0;
    ensureBeads();
    host.setObjective('Shadow Link', 'WASD walks them. V consumes. Tab lets go.', null);
  };

  const armMat = new BABYLON.StandardMaterial('shadow-arm-mat', host.scene);
  armMat.emissiveColor = new BABYLON.Color3(0.12, 0.04, 0.22);
  armMat.diffuseColor = new BABYLON.Color3(0.02, 0.01, 0.04);
  armMat.specularColor = BABYLON.Color3.Black();
  armMat.disableLighting = true;
  const makeArm = (name: string) => {
    const arm = BABYLON.MeshBuilder.CreateCylinder(name, { height: 1.2, diameter: 0.07, tessellation: 6 }, host.scene);
    arm.material = armMat;
    arm.isPickable = false;
    arm.checkCollisions = false;
    arm.setEnabled(false);
    return arm;
  };
  const rightArm = makeArm('shadow-arm-r');
  const leftArm = makeArm('shadow-arm-l');
  const poseArm = (arm: BABYLON.Mesh, hand: { x: number; y: number; z: number } | null, side: number) => {
    if (shoveLeft <= 0 || !hand) {
      arm.setEnabled(false);
      return;
    }
    const here = host.player();
    const fx = Math.sin(here.yaw);
    const fz = Math.cos(here.yaw);
    arm.setEnabled(true);
    arm.position.set(
      hand.x + fx * 0.62 + fz * side * 0.08,
      hand.y + 0.02,
      hand.z + fz * 0.62 - fx * side * 0.08,
    );
    arm.rotation.x = Math.PI / 2.15;
    arm.rotation.y = here.yaw;
    arm.rotation.z = side * 0.35;
  };

  return {
    playing: () => playing,
    skip: () => {
      if (active && playing && !finished) handoff();
    },
    controls: () => active && !playing && !finished,
    shoveShown: () => taught,
    shake: () => shake,
    armSkip: (street: boolean) => {
      skipStreet = street;
    },
    mount: async () => {
      active = true;
      finished = false;
      policeWaves = 0;
      policeLine = false;
      people.length = 0;
      for (const car of cars) car.root.dispose(false, true);
      cars.length = 0;
      spawnPerson('street-receptionist', 'asset-ch37-npc', 5.5, 4.55, -Math.PI / 2, 'desk');
      CROWD.concat(FAR, NORTH).forEach(([x, z, yaw, x0], index) => {
        const person = spawnPerson(
          `street-walk-${index}`,
          CROWD_ASSETS[index % CROWD_ASSETS.length],
          x,
          z,
          yaw,
          'walk',
          x0,
          Math.abs(z - 21.2) < 2.5 ? Math.min(x0 + 12, 156) : x0 + 14,
        );
        if (Math.random() < HOSTILE_CHANCE) {
          person.role = 'hostile';
          person.hp = 3;
        } else person.skittish = Math.random() < 0.2;
      });
      const specs: [number, number, number][] = [
        [-22, 26.7, 7.2],
        [8, 26.9, 8.4],
        [18, 31.3, -6.6],
        [-12, 31.1, -7.4],
        [58, 27.1, 7.6],
        [96, 31.2, -6.4],
        [134, 26.8, 8.2],
        [-40, 86.8, 7.4],
        [70, 87.2, -6.8],
        [160, 86.6, 8],
        [40, -29.2, -7.2],
        [120, -28.8, 6.6],
      ];
      specs.forEach(([x, z, speed], index) => {
        cars.push(buildCar(host.scene, `street-car-${index}`, x, z, speed));
      });
      const crosses: [number, number, number][] = [
        [80, 60, 6.4],
        [80, 150, -5.8],
        [196, 40, 7.1],
        [196, 170, -6.2],
      ];
      crosses.forEach(([x, z, speed], index) => {
        cars.push(buildCar(host.scene, `street-car-ns-${index}`, x, z, speed, 'z'));
      });
      cars.push(buildCar(host.scene, 'street-car-park-a', -10, 23.15, 0));
      cars.push(buildCar(host.scene, 'street-car-park-b', 16, 23.25, 0));
      host.placePierce(SPAWN.x, SPAWN.z, SPAWN.yaw);
      slideDoors(0);
      await Promise.all(people.map((person) => new Promise<void>((resolve) => person.avatar.whenReady(resolve))));
      for (const person of people) {
        person.moving = person.role === 'walk';
        person.avatar.setLocomotion(person.moving, true);
      }
    },
    dispose: () => {
      active = false;
      playing = false;
      releaseLink(false);
      const beadMat = beads[0]?.material;
      for (const bead of beads) {
        if (!bead.isDisposed()) bead.dispose(false, false);
      }
      beadMat?.dispose();
      beads.length = 0;
      for (const person of people) {
        person.avatar.dispose();
        if (!person.mesh.isDisposed()) person.mesh.dispose();
      }
      people.length = 0;
      for (const car of cars) car.root.dispose(false, true);
      cars.length = 0;
      for (const node of disposers) node.dispose(false, true);
      disposers.length = 0;
    },
    onStart: () => {
      shadowOn = false;
      handsOut = false;
      trailLeft = 0;
      host.setCarry(CARRY);
      host.playClip('rebornidle', true);
      if (!active) return;
      if (skipStreet) beginStreet();
      else beginCutscene();
    },
    shadowMode: () => shadowOn,
    handsOut: () => shadowOn && handsOut,
    setHands: (out: boolean) => {
      if (!active || playing || finished || !shadowOn) return;
      handsOut = out;
      if (!out) {
        trailLeft = 0;
        hideBeads();
      }
      showStreet();
    },
    aimMarks: () => {
      const marks: { x: number; y: number; z: number }[] = [];
      if (!shadowOn || !handsOut || tether) return marks;
      for (const person of people) {
        if (person.mood === 'down' || person.hp <= 0) continue;
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
      if (!active || playing || finished || !shadowOn || !handsOut || tether) return false;
      let best: Person | null = null;
      let bestDist = 1.35;
      for (const person of people) {
        if (person.mood === 'down' || person.hp <= 0) continue;
        const dist = Math.hypot(person.mesh.position.x - x, person.mesh.position.y - y, person.mesh.position.z - z);
        if (dist > bestDist) continue;
        best = person;
        bestDist = dist;
      }
      if (!best) return false;
      bind(best);
      return true;
    },
    consume: () => {
      if (!active || playing || finished || !shadowOn || !tether) return false;
      const best = tether;
      trailFrom.copyFrom(handOrigin());
      trailTo.set(best.mesh.position.x, best.mesh.position.y, best.mesh.position.z);
      trailLeft = 0.55;
      ensureBeads();
      best.hp = 0;
      best.mood = 'down';
      best.shocked = false;
      best.attack = 0;
      best.stagger = 0;
      best.moving = false;
      best.fell = best.avatar.playClip('deathforward', false);
      const atX = best.mesh.position.x;
      const atZ = best.mesh.position.z;
      releaseLink(false);
      watchDeath(atX, atZ);
      shake = 0.22;
      showStreet();
      return true;
    },
    release: () => {
      if (!tether) return false;
      releaseLink(true);
      return true;
    },
    toggleShadow: () => {
      if (!active || playing || finished) return shadowOn;
      if (tether) releaseLink(false);
      shadowOn = !shadowOn;
      if (!shadowOn) {
        const here = host.player();
        for (const person of people) {
          if (person.mood === 'down' || person === tether) continue;
          if (person.role !== 'police' && person.role !== 'hostile') continue;
          const dist = Math.hypot(person.mesh.position.x - here.x, person.mesh.position.z - here.z);
          if (dist < 16) person.mood = 'chase';
          else if (person.mood === 'lost') person.mood = 'calm';
        }
      }
      handsOut = false;
      trailLeft = 0;
      hideBeads();
      if (shadowOn) host.holster();
      showStreet();
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
    shadowShown: () => active && !playing && !finished,
    shock: () => {
      if (!active || playing || finished || shoveLeft > 0) return false;
      const here = host.player();
      const look = host.camera.getForwardRay(1).direction;
      const camLen = Math.hypot(look.x, look.z) || 1;
      const camX = look.x / camLen;
      const camZ = look.z / camLen;
      const bodyX = Math.sin(here.yaw);
      const bodyZ = Math.cos(here.yaw);
      let hit = false;
      for (const person of people) {
        if (person.mood === 'down' || person === tether) continue;
        const dx = person.mesh.position.x - here.x;
        const dz = person.mesh.position.z - here.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 6.2 || dist < 0.05) continue;
        const dot = Math.max((dx * camX + dz * camZ) / dist, (dx * bodyX + dz * bodyZ) / dist);
        if (dist > 2.8 ? dot < 0.4 : dot < 0.08) continue;
        person.hp = 0;
        person.mood = 'down';
        person.shocked = true;
        person.attack = 0;
        person.stagger = 0;
        person.moving = false;
        person.fell = person.avatar.playClip('electrocuted', false);
        host.shedShadow(person.mesh.position.x, person.mesh.position.z);
        hit = true;
      }
      if (!hit) return false;
      shoveLeft = 1.35;
      shake = 0.18;
      host.playClip('shadowshock', false, 1, () => {
        if (active && !playing && !finished) host.resumeLocomotion();
      });
      taught = true;
      showStreet();
      return true;
    },
    shocking: () => shoveLeft > 0,
    shotAt: (origin: BABYLON.Vector3, direction: BABYLON.Vector3) => {
      if (!active || playing || tether || shadowOn) return false;
      const dir = direction.clone();
      if (dir.lengthSquared() < 1e-6) return false;
      dir.normalize();
      let best: Person | null = null;
      let bestAlong = 28;
      for (const person of people) {
        if (person.mood === 'down' || person.hp <= 0) continue;
        const to = person.mesh.position.add(new BABYLON.Vector3(0, 0.2, 0)).subtract(origin);
        const along = BABYLON.Vector3.Dot(to, dir);
        if (along < 0.4 || along > bestAlong) continue;
        const miss = to.subtract(dir.scale(along)).length();
        if (miss > 0.55) continue;
        best = person;
        bestAlong = along;
      }
      if (!best) return false;
      best.hp -= 1;
      best.stagger = 0.45;
      if (best.hp <= 0) best.mood = 'down';
      else if (best.role !== 'walk') best.mood = 'chase';
      return true;
    },
    step: (delta: number) => {
      if (!active || finished) return;
      const dt = Math.min(0.05, Math.max(0, delta));
      shake = Math.max(0, shake - dt);
      shoveLeft = Math.max(0, shoveLeft - dt);
      watchLeft = Math.max(0, watchLeft - dt);
      poseArm(rightArm, host.hand(), 1);
      poseArm(leftArm, host.leftHand(), -1);
      carHit = Math.max(0, carHit - dt);
      if (playing) {
        time += dt;
        const open = Math.max(0, Math.min(1, (time - 0.7) / 1.5));
        slideDoors(open);
        const [pa, pb, pt] = sample(WALK, time);
        const x = lerp(pa.x, pb.x, pt);
        const z = lerp(pa.z, pb.z, pt);
        const yaw = lerp(pa.yaw, pb.yaw, pt);
        const moving = Math.hypot(pb.x - pa.x, pb.z - pa.z) > 0.2 && pt < 0.98 && time > 2.5 && time < 35.2;
        host.placePierce(x, z, yaw);
        setClip(moving ? 'walk' : 'idle', moving);
        const [sa, sb, st] = sample(SHOTS, time);
        host.frameCamera(
          { x: lerp(sa.cx, sb.cx, st), y: lerp(sa.cy, sb.cy, st), z: lerp(sa.cz, sb.cz, st) },
          { x: lerp(sa.lx, sb.lx, st), y: lerp(sa.ly, sb.ly, st), z: lerp(sa.lz, sb.lz, st) },
        );
        if (!screamed && time >= 6.2) {
          screamed = true;
          say('Receptionist', 'Ah! Oh my god!', SCREAM, 0.92, 2.4);
        } else if (!called && time >= 8.8) {
          called = true;
          say('Receptionist', "Security! I'm calling the police!", POLICE_CALL, 0.92, 3.6);
        } else if (!pierceSaid && time >= 13.2) {
          pierceSaid = true;
          say('Pierce Hawkes', "I'm not going back up.", NOT_UP, 0.92, 2.8);
        } else if (lineUntil > 0 && time > lineUntil) {
          lineUntil = 0;
          host.showLine('', '');
        }
        if (time >= 36.2) handoff();
      } else if (host.running()) {
        streetTime += dt;
      }

      trailLeft = Math.max(0, trailLeft - dt);
      linkTime += dt;
      const here = host.player();
      updateRibbon();
      if (tether && !playing) {
        const breakDx = tether.mesh.position.x - here.x;
        const breakDz = tether.mesh.position.z - here.z;
        if (Math.hypot(breakDx, breakDz) > 18) releaseLink(true);
      }
      const seen = playing ? time > 26 : !playing;
      for (const person of people) {
        const px = person.mesh.position.x;
        const pz = person.mesh.position.z;
        const dx = here.x - px;
        const dz = here.z - pz;
        const dist = Math.hypot(dx, dz);
        if (person === tether) {
          const mx = tetherMove.x;
          const mz = tetherMove.z;
          person.moving = Math.hypot(mx, mz) > 0.002;
          if (person.moving) {
            person.mesh.position.x = Math.max(-160, Math.min(340, person.mesh.position.x + mx));
            person.mesh.position.z = Math.max(-140, Math.min(250, person.mesh.position.z + mz));
            face(person, Math.atan2(mx, mz));
          }
          person.avatar.setLocomotion(person.moving, true);
          tetherMove = { x: 0, z: 0 };
          continue;
        }
        if (person.mood === 'down') {
          if (!person.fell) {
            person.fell = person.avatar.playClip(person.shocked ? 'electrocuted' : 'deathforward', false);
            person.moving = false;
          }
          continue;
        }
        if (shadowOn && person !== tether && (person.mood === 'chase' || person.mood === 'flee')) {
          person.mood = 'lost';
          person.lost = 2.8 + Math.random() * 1.2;
          person.attack = 0;
          person.stagger = 0;
        }
        if (person.stagger > 0 && person.mood !== 'lost') {
          person.stagger -= dt;
          if (person.stagger <= 0) {
            person.mood = person.role === 'hostile' || person.role === 'police'
              ? 'chase'
              : person.skittish || person.role === 'desk'
                ? 'flee'
                : 'calm';
          }
        }
        if (!shadowOn && seen && person.mood === 'calm' && person.skittish && person.role === 'walk' && dist < 2.4) {
          person.mood = 'flee';
          if (!person.screamed) {
            person.screamed = true;
            host.playFile(PEDESTRIAN, 0.7);
          }
        }
        if (!shadowOn && person.role === 'hostile' && !playing && streetTime > 2.5 && person.mood === 'calm') person.mood = 'chase';
        let mx = 0;
        let mz = 0;
        let speed = 0;
        if (person.mood === 'stagger') {
          speed = 0;
        } else if (person.mood === 'flee') {
          speed = 5.1;
          mx = px - here.x;
          mz = pz - here.z;
        } else if (person.mood === 'lost') {
          person.lost -= dt;
          if (person.lost > 1.25) {
            speed = 0;
            face(person, Math.atan2(here.x - px, here.z - pz) + Math.sin((streetTime + px) * 2.4) * 1.15);
          } else if (person.lost > 0) {
            speed = 1.7;
            mx = px - here.x;
            mz = pz - here.z;
          } else {
            person.mood = 'calm';
            person.avatar.resumeLocomotion();
          }
        } else if (person.mood === 'chase' && !playing && !shadowOn) {
          speed = person.role === 'police' ? 3.05 : 2.55;
          mx = here.x - px;
          mz = here.z - pz;
          if (dist < 1.35) speed = 0;
        } else if (person.role === 'walk' && person.mood === 'calm') {
          speed = 1.15;
          if (px > person.x1) person.dir = -1;
          if (px < person.x0) person.dir = 1;
          if (!shadowOn && dist < 1.15 && Math.abs(here.z - pz) < 1.2 && (here.x - px) * person.dir > 0.2) {
            person.dir = -person.dir;
          }
          mx = person.dir;
          mz = 0;
        } else if (person.role === 'desk' && person.mood === 'calm') {
          speed = 0;
          face(person, -Math.PI / 2);
        }
        const len = Math.hypot(mx, mz);
        person.moving = speed > 0.2 && len > 0.01;
        if (person.moving) {
          person.mesh.position.x += (mx / len) * speed * dt;
          person.mesh.position.z += (mz / len) * speed * dt;
          face(person, Math.atan2(mx, mz));
        }
        person.avatar.setLocomotion(person.moving, true);
        if (!playing && (person.mood === 'chase') && dist < 1.45) {
          person.attack -= dt;
          if (person.attack <= 0) {
            person.attack = person.role === 'police' ? 1.05 : 1.15;
            host.hurt(person.role === 'police' ? 14 : 8);
            if (!taught) {
              taught = true;
              if (!shadowOn && !tether) host.setObjective('Shadow Shock', 'C for shadow mode. V shocks anyone in front.', { x: HOME.x, y: 1.2, z: HOME.z });
            }
          }
        }
        if (!playing && !taught && !shadowOn && !tether && (person.role === 'hostile' || person.role === 'police') && person.mood === 'chase' && dist < 6) {
          taught = true;
          host.setObjective('Shadow Shock', 'C for shadow mode. V shocks anyone in front.', { x: HOME.x, y: 1.2, z: HOME.z });
        }
      }

      for (const car of cars) {
        if (car.parked) continue;
        if (car.axis === 'z') {
          car.root.position.z += car.speed * dt;
          if (car.root.position.z > 230) car.root.position.z = -110;
          if (car.root.position.z < -110) car.root.position.z = 230;
        } else {
          car.root.position.x += car.speed * dt;
          if (car.root.position.x > 320) car.root.position.x = -140;
          if (car.root.position.x < -140) car.root.position.x = 320;
        }
        if (playing || carHit > 0) continue;
        const dx = Math.abs((car.axis === 'z' ? car.x : car.root.position.x) - here.x);
        const dz = Math.abs((car.axis === 'z' ? car.root.position.z : car.z) - here.z);
        const along = car.axis === 'z' ? dz : dx;
        const across = car.axis === 'z' ? dx : dz;
        if (along < 2.3 && across < 1.15) {
          carHit = 1.4;
          host.hurt(16);
          if (car.axis === 'z') host.placePierce(here.x < car.x ? car.x - 4.2 : car.x + 4.2, here.z, here.yaw);
          else host.placePierce(here.x, here.z < car.z ? car.z - 4.2 : car.z + 4.2, here.yaw);
        }
      }

      if (!playing && policeWaves < 1 && streetTime > 46) {
        policeWaves = 1;
        const behind = Math.max(-18, here.x - 28);
        spawnPolice(behind, 27.4, 0);
        spawnPolice(behind - 8, 30.8, 1);
        if (!policeLine) {
          policeLine = true;
          host.showLine('Police', 'Stop! Stay where you are!');
          host.playFile(POLICE_SHOUT, 0.9);
          shoutLeft = 3.4;
        }
      }
      if (!playing && shoutLeft > 0) {
        shoutLeft -= dt;
        if (shoutLeft <= 0) host.showLine('', '');
      }

      if (!playing && host.running() && here.x > 162.5 && here.x < 165.2 && Math.abs(here.z - HOME.z) < 1.7) finish();
    },
  };
};

export type GoingHome = ReturnType<typeof createGoingHome>;
