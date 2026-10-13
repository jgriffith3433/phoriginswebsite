import * as BABYLON from '@babylonjs/core';

import { createCharacterAvatar, type PlayerAvatar } from '../game/playerAvatar';
import { PLAYER_MESH_Y_OFFSET, PLAYER_STAND_Y } from '../game/player';
import { carryItems, lineAudio, lineSpeaker, lineText } from '../game/locale';
import type { StoryCarry } from './act1';
import type { Store, WalkPath } from './city/layout';
import { pointAt } from './city/math2';
import { createTraffic, type Traffic } from './city/traffic';
import { createCityWorld, type CityWorld } from './city/world';
import { deathScream, SHOP_LINE, STREET_BARKS, STREET_SFX, STREET_TALKS, streetCopy as resolveStreet, type StreetLine } from './streetAudio';
import { CORPSE_SECONDS, POSSESS_SECONDS, settleCorpse } from './streetRules';

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
  offerEnd: (title: string, text: string) => void;
  haltPlay: () => void;
  clearInput: () => void;
  unlockNext: () => void;
  refreshHud: () => void;
  player: () => { x: number; z: number; yaw: number };
  hand: () => { x: number; y: number; z: number } | null;
  leftHand: () => { x: number; y: number; z: number } | null;
  holster: () => void;
  shedShadow: (x: number, z: number) => void;
  pushPhoneText: (id: string) => void;
  ability: () => 'shock' | 'possess';
  cull: () => number;
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
  { id: 'shove', name: 'Shove', note: 'In Shadow mode, select Shadow Shock, then click someone in front.' },
  { id: 'shadow', name: 'Shadow mode', note: 'C or the Shadow button turns it on. Powers only work while it is on.' },
];

type Role = 'desk' | 'walk' | 'hostile' | 'police' | 'shop';
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
  homeYaw: number;
  mean: boolean;
  shown: boolean;
  shopId: string;
  voice: number;
  corpse: number;
  resting: boolean;
  poseHold: number;
  floorY: number;
  swing: number;
  /** Sidewalk path for calm walkers. */
  path: WalkPath | null;
  s: number;
  side: number;
  rejoin: boolean;
  lift: number;
  /** Seconds since this walker was last near the camera. */
  idle: number;
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

export const createGoingHome = (host: GoingHomeHost) => {
  const people: Person[] = [];
  let active = false;
  let playing = false;
  let time = 0;
  let clip: 'walk' | 'idle' | '' = '';
  let lineUntil = 0;
  let screamed = false;
  let called = false;
  let pierceSaid = false;
  let streetTime = 0;
  let streetOpen = false;
  let lesson: 'first' | 'second' | 'done' = 'first';
  let firstAbility: 'shock' | 'possess' | null = null;
  let shownAbility: 'shock' | 'possess' | '' = '';
  let policeAfter = -1;
  let shoveLeft = 0;
  let meleeLeft = 0;
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
  let linkLeft = 0;
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
  const mobile = typeof document !== 'undefined' && document.body.dataset.device !== 'desktop';
  const WALKERS = mobile ? 9 : 16;
  let world: CityWorld | null = null;
  let traffic: Traffic | null = null;
  let stores: Store[] = [];
  let savedMaxZ = 0;
  let recycleWait = 0;
  let streetNoted = false;
  let chatterWait = 6;
  let chatterLeft = 0;
  let chatterNext: { title: string; line: StreetLine } | null = null;
  let insideShop = '';

  const shouldShow = (person: Person, dist: number) => {
    if (person === tether) return true;
    if (person.role === 'desk') return playing || dist < 32;
    if (person.role === 'shop') return dist < (person.shown ? 48 : 40);
    if (person.mood === 'down') return true;
    return dist < (person.shown ? 74 : 66);
  };

  const setPersonShown = (person: Person, on: boolean) => {
    if (person.shown === on) return;
    person.shown = on;
    person.mesh.setEnabled(on);
    person.avatar.setShown(on);
  };

  const roll = (person: Person) => {
    person.mean = false;
    person.skittish = false;
    if (person.role === 'hostile') person.role = 'walk';
    if (Math.random() < HOSTILE_CHANCE) {
      person.hp = 3;
      if (person.role === 'shop') person.mean = true;
      else person.role = 'hostile';
    } else {
      person.hp = 1;
      person.skittish = Math.random() < 0.2;
    }
  };

  /** Put a walker on a sidewalk path at a spot. */
  const setPath = (person: Person, path: WalkPath, s: number) => {
    person.path = path;
    person.s = s;
    person.dir = Math.random() < 0.5 ? 1 : -1;
    person.side = (Math.random() - 0.5) * 1.6;
    person.rejoin = false;
    const p = pointAt(path.pts, path.cum, s);
    person.mesh.position.x = p.x;
    person.mesh.position.z = p.z;
  };

  /** Pull a far, calm walker back near Pierce, preferably out of view. */
  const recycleWalkers = (x: number, z: number) => {
    if (!world) return;
    const look = host.camera.getForwardRay(1).direction;
    const len = Math.hypot(look.x, look.z) || 1;
    const fx = look.x / len;
    const fz = look.z / len;
    let moved = 0;
    for (const person of people) {
      if (moved >= 2) break;
      if (person.role !== 'walk' && person.role !== 'hostile') continue;
      if (person === tether || person.mood !== 'calm') continue;
      const dx = person.mesh.position.x - x;
      const dz = person.mesh.position.z - z;
      const dist = Math.hypot(dx, dz);
      const behind = (dx * fx + dz * fz) / Math.max(dist, 0.01) < -0.2;
      if (dist < 70 && !(behind && dist > 34)) continue;
      const spot = world.walkSpot(x, z, 22, 62, { fx, fz, cos: 0.3 }) ?? world.walkSpot(x, z, 40, 64);
      if (!spot) continue;
      setPath(person, spot.path, spot.s);
      roll(person);
      person.screamed = false;
      setPersonShown(person, shouldShow(person, Math.hypot(spot.p.x - x, spot.p.z - z)));
      moved += 1;
    }
  };

  const face = (person: Person, yaw: number) => {
    person.avatar.group.rotation.y = yaw + Math.PI;
  };

  /** Feet follow curbs and store floors. */
  const liftPerson = (person: Person, dt: number) => {
    if (!world) return;
    const want = person.role === 'shop' && person.mood === 'calm' ? 0.16 : world.lift(person.mesh.position.x, person.mesh.position.z);
    person.lift += (want - person.lift) * Math.min(1, dt * 14);
    person.avatar.group.position.y = -PLAYER_MESH_Y_OFFSET + person.lift;
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
      homeYaw: yaw,
      mean: false,
      shown: true,
      shopId: '',
      voice: role === 'shop' ? 0 : [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % STREET_BARKS.length,
      corpse: 0,
      resting: false,
      poseHold: 0,
      floorY: 0,
      swing: 0,
      path: null,
      s: 0,
      side: 0,
      rejoin: false,
      lift: 0,
      idle: 0,
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

  const streetGoal = () => {
    if (!shadowOn) {
      return {
        title: lineSpeaker('objective.home.station', 'The station'),
        text: lineText('objective.home.station', 'Stairs down, a few blocks east. Tab switches Punch and Kick. C is Shadow mode.'),
      };
    }
    if (!handsOut) {
      return {
        title: lineSpeaker('objective.home.shadow', 'Shadow mode'),
        text: lineText('objective.home.shadow', 'Tab switches the ability. Q raises the hands.'),
      };
    }
    return {
      title: lineSpeaker('objective.home.link', 'Shadow Link'),
      text: lineText('objective.home.link', 'Aim at them. Click uses Possess.'),
    };
  };

  const abilityLabel = (id: 'shock' | 'possess') => (id === 'possess' ? 'Possess' : 'Shadow Shock');

  const showLesson = () => {
    if (lesson === 'second' && firstAbility) {
      const other = firstAbility === 'shock' ? 'possess' : 'shock';
      const name = abilityLabel(other);
      host.setObjective(
        lineSpeaker('objective.home.switch', 'Switch'),
        lineText('objective.home.switch', 'Switch to {name} with Tab or Switch Ability, then use it on a passerby. Stay in Shadow mode.').split('{name}').join(name),
        null,
      );
      return;
    }
    const selected = host.ability();
    shownAbility = selected;
    const name = abilityLabel(selected);
    host.setObjective(
      name,
      lineText('objective.home.first', 'Turn Shadow mode on with C or the Shadow button, then use {name} on a passerby.').split('{name}').join(name),
      null,
    );
  };

  const showStreet = () => {
    if (lesson !== 'done') {
      showLesson();
      return;
    }
    const copy = streetGoal();
    host.setObjective(copy.title, copy.text, { x: HOME.x, y: 1.2, z: HOME.z });
  };

  const resetLesson = () => {
    lesson = 'first';
    firstAbility = null;
    shownAbility = '';
    streetNoted = false;
    policeAfter = -1;
  };

  const noteUse = (used: 'shock' | 'possess') => {
    if (lesson === 'done' || playing || !shadowOn) return;
    if (lesson === 'first') {
      firstAbility = used;
      lesson = 'second';
      showLesson();
      return;
    }
    if (used === firstAbility) return;
    lesson = 'done';
    host.setObjective(
      lineSpeaker('objective.home.station', 'The station'),
      lineText('objective.home.station', 'Stairs down, a few blocks east. Tab switches Punch and Kick. C is Shadow mode.'),
      { x: HOME.x, y: 1.2, z: HOME.z },
    );
    if (!streetNoted) {
      streetNoted = true;
      host.pushPhoneText('voss-street');
      policeAfter = 0;
    }
  };

  const releaseLink = (backToStreet: boolean) => {
    tether = null;
    linkLeft = 0;
    tetherMove = { x: 0, z: 0 };
    tetherMoving = false;
    hideBeads();
    if (backToStreet && !finished) showStreet();
  };

  const layDown = (person: Person, shocked: boolean) => {
    if (person.mood === 'down') return;
    person.hp = 0;
    person.mood = 'down';
    person.shocked = shocked;
    person.attack = 0;
    person.stagger = 0;
    person.moving = false;
    person.corpse = CORPSE_SECONDS;
    person.resting = false;
    person.poseHold = 0;
    person.floorY = world ? world.lift(person.mesh.position.x, person.mesh.position.z) : 0;
    person.fell = person.avatar.playClip(shocked ? 'electrocuted' : 'deathforward', false);
    const kind = person.role === 'police' ? 'police' : person.role === 'desk' || person.role === 'shop' ? 'woman' : 'man';
    host.playFile(deathScream(kind), 0.72);
  };

  const bury = (person: Person) => {
    const index = people.indexOf(person);
    if (index >= 0) people.splice(index, 1);
    person.avatar.dispose();
    if (!person.mesh.isDisposed()) person.mesh.dispose();
  };

  const handoff = () => {
    playing = false;
    clip = '';
    host.holdScene(false);
    host.releaseCamera();
    host.showLine('', '');
    host.setWalk(false);
    host.resumeLocomotion();
    showStreet();
    host.showObjective(true);
    const desk = people.find((person) => person.role === 'desk');
    if (desk && desk.mood === 'calm') desk.mood = 'flee';
    streetOpen = true;
    streetTime = 0;
  };

  const beginCutscene = () => {
    playing = true;
    time = 0;
    screamed = false;
    called = false;
    pierceSaid = false;
    streetOpen = false;
    streetTime = 0;
    resetLesson();
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
    resetLesson();
    streetOpen = true;
    streetTime = 0;
    host.fade(0, 0.4);
    host.holdScene(false);
    host.releaseCamera();
    const nearStairs = new URLSearchParams(location.search).get('at') === 'stairs';
    host.placePierce(nearStairs ? 150 : STREET.x, STREET.z, STREET.yaw);
    host.resumeLocomotion();
    showStreet();
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
    host.unlockNext();
    host.refreshHud();
    host.offerEnd(
      lineSpeaker('ui.complete.going-home', 'Level Complete'),
      lineText('ui.complete.going-home', 'The stairs go down. Continue. The station is waiting.'),
    );
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

  const speak = (title: string, line: StreetLine) => {
    const copy = resolveStreet(line);
    host.showLine(title, copy.text);
    host.playFile(copy.url, 0.62);
    chatterLeft = copy.hold;
  };

  const considerTalk = () => {
    if (playing || shoutLeft > 0 || chatterLeft > 0) return;
    const here = host.player();
    const near = people.filter((person) => {
      if (!person.shown || person.mood !== 'calm' || person === tether || person.role === 'desk' || person.role === 'police') return false;
      return Math.hypot(person.mesh.position.x - here.x, person.mesh.position.z - here.z) < 10;
    });
    if (near.length >= 2 && Math.random() < 0.1) {
      for (let i = 0; i < near.length; i += 1) {
        for (let j = i + 1; j < near.length; j += 1) {
          const apart = Math.hypot(
            near[i].mesh.position.x - near[j].mesh.position.x,
            near[i].mesh.position.z - near[j].mesh.position.z,
          );
          if (apart > 2.8) continue;
          const row = STREET_TALKS.find((talk) => (
            (near[i].voice === talk.a && near[j].voice === talk.b)
            || (near[i].voice === talk.b && near[j].voice === talk.a)
          ));
          if (!row) continue;
          speak('Passerby', row.first);
          chatterNext = { title: 'Passerby', line: row.second };
          return;
        }
      }
    }
    if (!near.length || Math.random() >= 0.1) return;
    const person = near[Math.floor(Math.random() * near.length)];
    if (person.role === 'shop') {
      speak('Shopkeeper', SHOP_LINE);
      return;
    }
    const pool = STREET_BARKS[person.voice] ?? [];
    if (!pool.length) return;
    const line = pool[Math.floor(Math.random() * pool.length)];
    if (line) speak('Passerby', line);
  };

  const shopHere = () => {
    const here = host.player();
    for (const shop of stores) {
      if (here.x > shop.x0 && here.x < shop.x1 && here.z > shop.z0 && here.z < shop.z1 - 0.2) return shop.id;
    }
    return '';
  };

  const bind = (person: Person) => {
    tether = person;
    linkLeft = POSSESS_SECONDS;
    person.mood = 'calm';
    person.stagger = 0;
    person.attack = 0;
    ensureBeads();
    host.playFile(STREET_SFX.possess, 0.4);
    if (lesson !== 'done') {
      noteUse('possess');
      return;
    }
    host.setObjective(
      lineSpeaker('objective.home.linked', 'Shadow Link'),
      lineText('objective.home.linked', 'WASD walks them. Click kills. Tab switches the ability.'),
      null,
    );
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
    objectiveKey: () => (tether ? 'link' : shadowOn ? 'shock' : 'home'),
    playing: () => playing,
    skip: () => {
      if (active && playing && !finished) handoff();
    },
    controls: () => active && !playing && !finished,
    shoveShown: () => lesson !== 'first',
    shake: () => shake,
    armSkip: (street: boolean) => {
      skipStreet = street;
    },
    mount: async () => {
      active = true;
      finished = false;
      policeWaves = 0;
      policeLine = false;
      resetLesson();
      streetOpen = false;
      streetTime = 0;
      chatterWait = 6;
      chatterLeft = 0;
      chatterNext = null;
      insideShop = '';
      recycleWait = 0;
      people.length = 0;
      const bootX = new URLSearchParams(location.search).get('at') === 'stairs' ? 150 : STREET.x;
      world = createCityWorld(host.scene, { mobile });
      world.mount(bootX, STREET.z);
      stores = world.city.stores;
      savedMaxZ = host.camera.maxZ;
      host.camera.maxZ = 1800;
      spawnPerson('street-receptionist', 'asset-ch37-npc', 5.5, 4.55, -Math.PI / 2, 'desk');
      for (let i = 0; i < WALKERS; i += 1) {
        const spot = world.walkSpot(bootX, STREET.z, i < 4 ? 6 : 12, i < 8 ? 38 : 60);
        if (!spot) continue;
        const person = spawnPerson(`street-walk-${i}`, CROWD_ASSETS[i % CROWD_ASSETS.length], spot.p.x, spot.p.z, 0, 'walk');
        setPath(person, spot.path, spot.s);
        roll(person);
      }
      for (const store of stores) {
        const keeper = spawnPerson(`shop-${store.id}-owner`, store.asset, store.keeper.x, store.keeper.z, 0, 'shop');
        keeper.shopId = store.id;
        keeper.homeYaw = 0;
        keeper.lift = 0.16;
        roll(keeper);
      }
      traffic = createTraffic(host.scene, world, mobile ? 9 : 16);
      traffic.mount(bootX, STREET.z);
      for (const person of people) {
        const dist = Math.hypot(person.mesh.position.x - bootX, person.mesh.position.z - STREET.z);
        person.shown = !shouldShow(person, dist);
        setPersonShown(person, !person.shown);
        person.lift = world.lift(person.mesh.position.x, person.mesh.position.z);
        person.avatar.group.position.y = -PLAYER_MESH_Y_OFFSET + person.lift;
      }
      host.placePierce(SPAWN.x, SPAWN.z, SPAWN.yaw);
      slideDoors(0);
      await Promise.all(people.map((person) => new Promise<void>((resolve) => person.avatar.whenReady(resolve))));
      for (const person of people) {
        person.moving = person.role === 'walk' || person.role === 'hostile';
        person.avatar.setLocomotion(person.moving, true);
      }
    },
    dispose: () => {
      active = false;
      playing = false;
      streetOpen = false;
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
      for (const node of disposers) node.dispose(false, true);
      disposers.length = 0;
      traffic?.dispose();
      traffic = null;
      world?.dispose();
      world = null;
      stores = [];
      if (savedMaxZ) host.camera.maxZ = savedMaxZ;
      savedMaxZ = 0;
    },
    /** Visual floor height under a point (curbs, plazas, store floors). */
    lift: (x: number, z: number) => (world ? world.lift(x, z) : 0),
    /** Data for the minimap. */
    map: () => {
      if (!world || !active) return null;
      const blips: { x: number; z: number; kind: 'police' | 'hostile' | 'linked' | 'shop' | 'person' }[] = [];
      for (const person of people) {
        if (person.mood === 'down' || !person.shown) continue;
        const kind = person === tether ? 'linked' : person.role === 'police' ? 'police' : person.role === 'hostile' || person.mood === 'chase' ? 'hostile' : person.role === 'shop' ? 'shop' : 'person';
        blips.push({ x: person.mesh.position.x, z: person.mesh.position.z, kind });
      }
      return {
        draw: world.drawMap,
        stores: stores.map((store) => ({ x: store.doorX, z: store.z1, name: store.name })),
        station: { x: HOME.x, z: HOME.z },
        blips,
      };
    },
    onStart: () => {
      shadowOn = false;
      handsOut = false;
      trailLeft = 0;
      host.setCarry(carryItems('home', CARRY));
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
        if (!person.shown || person.mood === 'down' || person.hp <= 0) continue;
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
        if (!person.shown || person.mood === 'down' || person.hp <= 0) continue;
        const dist = Math.hypot(person.mesh.position.x - x, person.mesh.position.y - y, person.mesh.position.z - z);
        if (dist > bestDist) continue;
        best = person;
        bestDist = dist;
      }
      if (!best) return false;
      bind(best);
      return true;
    },
    possessLook: () => {
      if (!active || playing || finished || !shadowOn || tether) return false;
      const here = host.player();
      const look = host.camera.getForwardRay(1).direction;
      const camLen = Math.hypot(look.x, look.z) || 1;
      const camX = look.x / camLen;
      const camZ = look.z / camLen;
      let best: Person | null = null;
      let bestDist = 6.2;
      for (const person of people) {
        if (!person.shown || person.mood === 'down' || person.hp <= 0) continue;
        const dx = person.mesh.position.x - here.x;
        const dz = person.mesh.position.z - here.z;
        const dist = Math.hypot(dx, dz);
        if (dist > bestDist || dist < 0.05) continue;
        const dot = (dx * camX + dz * camZ) / dist;
        if (dist > 2.8 ? dot < 0.4 : dot < 0.08) continue;
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
      layDown(best, false);
      const atX = best.mesh.position.x;
      const atZ = best.mesh.position.z;
      releaseLink(false);
      watchDeath(atX, atZ);
      host.playFile(STREET_SFX.consume, 0.46);
      host.playFile(STREET_SFX.death, 0.32);
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
          if (person.role !== 'police' && person.role !== 'hostile' && !person.mean) continue;
          const dist = Math.hypot(person.mesh.position.x - here.x, person.mesh.position.z - here.z);
          if (dist < 16) person.mood = 'chase';
          else if (person.mood === 'lost') person.mood = 'calm';
        }
      }
      handsOut = false;
      trailLeft = 0;
      hideBeads();
      host.playFile(shadowOn ? STREET_SFX.shadowOn : STREET_SFX.shadowOff, 0.4);
      if (shadowOn) host.holster();
      showStreet();
      return shadowOn;
    },
    linked: () => !!tether,
    possessLeft: () => (tether ? Math.max(0, linkLeft) : 0),
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
      if (!active || playing || finished || !shadowOn || shoveLeft > 0) return false;
      const here = host.player();
      const look = host.camera.getForwardRay(1).direction;
      const camLen = Math.hypot(look.x, look.z) || 1;
      const camX = look.x / camLen;
      const camZ = look.z / camLen;
      const bodyX = Math.sin(here.yaw);
      const bodyZ = Math.cos(here.yaw);
      let hit = false;
      for (const person of people) {
        if (!person.shown || person.mood === 'down' || person === tether) continue;
        const dx = person.mesh.position.x - here.x;
        const dz = person.mesh.position.z - here.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 6.2 || dist < 0.05) continue;
        const dot = Math.max((dx * camX + dz * camZ) / dist, (dx * bodyX + dz * bodyZ) / dist);
        if (dist > 2.8 ? dot < 0.4 : dot < 0.08) continue;
        layDown(person, true);
        host.shedShadow(person.mesh.position.x, person.mesh.position.z);
        hit = true;
      }
      if (!hit) return false;
      host.playFile(STREET_SFX.shock, 0.5);
      shoveLeft = 1.35;
      shake = 0.18;
      host.playClip('shadowshock', false, 1, () => {
        if (active && !playing && !finished) host.resumeLocomotion();
      });
      const teaching = lesson !== 'done';
      noteUse('shock');
      if (!teaching) showStreet();
      return true;
    },
    strike: (kind: 'punch' | 'kick') => {
      if (!active || playing || finished || shadowOn || meleeLeft > 0) return false;
      const here = host.player();
      const look = host.camera.getForwardRay(1).direction;
      const camLen = Math.hypot(look.x, look.z) || 1;
      const camX = look.x / camLen;
      const camZ = look.z / camLen;
      const reach = kind === 'kick' ? 2.35 : 1.7;
      const damage = kind === 'kick' ? 2 : 1;
      let best: Person | null = null;
      let bestDist = reach;
      for (const person of people) {
        if (!person.shown || person.mood === 'down' || person.hp <= 0 || person === tether) continue;
        const dx = person.mesh.position.x - here.x;
        const dz = person.mesh.position.z - here.z;
        const dist = Math.hypot(dx, dz);
        if (dist > bestDist || dist < 0.05) continue;
        const dot = (dx * camX + dz * camZ) / dist;
        if (dot < 0.35) continue;
        best = person;
        bestDist = dist;
      }
      if (best) {
        best.hp -= damage;
        if (best.hp <= 0) layDown(best, false);
        else {
          best.stagger = 0.45;
          if (best.role === 'hostile' || best.role === 'police' || best.mean) best.mood = 'chase';
        }
      }
      meleeLeft = 0.85;
      host.playFile(kind === 'kick' ? STREET_SFX.kick : STREET_SFX.punch, 0.55);
      host.playClip(kind, false, 1, () => {
        if (active && !playing && !finished) host.resumeLocomotion();
      });
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
        if (!person.shown || person.mood === 'down' || person.hp <= 0) continue;
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
      if (best.hp <= 0) {
        layDown(best, false);
        host.playFile(STREET_SFX.death, 0.42);
      } else {
        best.stagger = 0.45;
        if (best.role !== 'walk') best.mood = 'chase';
      }
      return true;
    },
    step: (delta: number) => {
      if (!active || finished) return;
      const dt = Math.min(0.05, Math.max(0, delta));
      shake = Math.max(0, shake - dt);
      shoveLeft = Math.max(0, shoveLeft - dt);
      meleeLeft = Math.max(0, meleeLeft - dt);
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
          say(lineSpeaker('dialogue.home.scream', 'Receptionist'), lineText('dialogue.home.scream', 'Ah! Oh my god!'), lineAudio('dialogue.home.scream', SCREAM), 0.92, 2.4);
        } else if (!called && time >= 8.8) {
          called = true;
          say(lineSpeaker('dialogue.home.police', 'Receptionist'), lineText('dialogue.home.police', "Security! I'm calling the police!"), lineAudio('dialogue.home.police', POLICE_CALL), 0.92, 3.6);
        } else if (!pierceSaid && time >= 13.2) {
          pierceSaid = true;
          say(lineSpeaker('dialogue.home.not-up', 'Pierce Hawkes'), lineText('dialogue.home.not-up', "I'm not going back up."), lineAudio('dialogue.home.not-up', NOT_UP), 0.92, 2.8);
        } else if (lineUntil > 0 && time > lineUntil) {
          lineUntil = 0;
          host.showLine('', '');
        }
        if (time >= 36.2) handoff();
      } else if (streetOpen && host.running()) {
        streetTime += dt;
        if (streetNoted && policeAfter >= 0) policeAfter += dt;
        if (lesson === 'first') {
          const selected = host.ability();
          if (selected !== shownAbility) showLesson();
        }
        const shopNow = shopHere();
        if (shopNow && shopNow !== insideShop) host.playFile(STREET_SFX.bell, 0.32);
        insideShop = shopNow;
      }
      if (chatterLeft > 0) {
        chatterLeft = Math.max(0, chatterLeft - dt);
        if (chatterLeft <= 0 && chatterNext && shoutLeft <= 0) {
          const next = chatterNext;
          chatterNext = null;
          speak(next.title, next.line);
        } else if (chatterLeft <= 0 && shoutLeft <= 0) host.showLine('', '');
      } else if (!playing && host.running()) {
        chatterWait -= dt;
        if (chatterWait <= 0) {
          chatterWait = 4.6;
          considerTalk();
        }
      }

      trailLeft = Math.max(0, trailLeft - dt);
      linkTime += dt;
      const here = host.player();
      world?.step(here.x, here.z, dt);
      recycleWait -= dt;
      if (recycleWait <= 0 && !playing) {
        recycleWait = 0.5;
        recycleWalkers(here.x, here.z);
      }
      updateRibbon();
      if (tether && !playing) {
        linkLeft -= dt;
        if (linkLeft <= 0) releaseLink(true);
      }
      const seen = playing ? time > 26 : !playing;
      const buried: Person[] = [];
      for (const person of people) {
        if (person.mood === 'down') {
          if (!person.shown) {
            person.shown = true;
            person.mesh.setEnabled(true);
            person.avatar.group.setEnabled(true);
          }
          if (!person.fell) {
            person.fell = person.avatar.playClip(person.shocked ? 'electrocuted' : 'deathforward', false);
            person.moving = false;
            if (person.corpse <= 0) person.corpse = CORPSE_SECONDS;
            if (!person.shocked) host.playFile(STREET_SFX.death, 0.42);
          }
          const posed = settleCorpse(
            person.avatar,
            person.floorY,
            person.shocked ? 'electrocuted' : 'deathforward',
            person.poseHold,
            dt,
            person.resting,
          );
          person.poseHold = posed.age;
          person.resting = posed.resting;
          person.corpse -= dt;
          if (person.corpse <= 0) {
            if (tether === person) releaseLink(false);
            buried.push(person);
          }
          continue;
        }
        const px = person.mesh.position.x;
        const pz = person.mesh.position.z;
        const dx = here.x - px;
        const dz = here.z - pz;
        const dist = Math.hypot(dx, dz);
        const want = shouldShow(person, dist);
        setPersonShown(person, want);
        if (!want) continue;
        if (person === tether) {
          const mx = tetherMove.x;
          const mz = tetherMove.z;
          person.moving = Math.hypot(mx, mz) > 0.002;
          if (person.moving) {
            const to = world ? world.resolve(person.mesh.position.x + mx, person.mesh.position.z + mz, 0.36) : { x: person.mesh.position.x + mx, z: person.mesh.position.z + mz };
            person.mesh.position.x = to.x;
            person.mesh.position.z = to.z;
            face(person, Math.atan2(mx, mz));
          }
          liftPerson(person, dt);
          person.avatar.setLocomotion(person.moving, true);
          tetherMove = { x: 0, z: 0 };
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
            person.mood = person.role === 'hostile' || person.role === 'police' || person.mean
              ? 'chase'
              : person.skittish || person.role === 'desk'
                ? 'flee'
                : 'calm';
          }
        }
        if (!shadowOn && seen && person.mood === 'calm' && person.skittish && (person.role === 'walk' || person.role === 'shop') && dist < 2.4) {
          person.mood = 'flee';
          if (!person.screamed) {
            person.screamed = true;
            host.playFile(lineAudio('shout.street.pedestrian', PEDESTRIAN), 0.7);
          }
        }
        if (!shadowOn && (person.role === 'hostile' || person.mean) && !playing && streetTime > 2.5 && person.mood === 'calm' && dist < 18) person.mood = 'chase';
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
            person.rejoin = true;
            person.avatar.resumeLocomotion();
          }
        } else if (person.mood === 'chase' && !playing && !shadowOn) {
          speed = person.role === 'police' ? 3.05 : 2.55;
          mx = here.x - px;
          mz = here.z - pz;
          if (dist < 1.35) speed = 0;
        } else if ((person.role === 'walk' || person.role === 'hostile') && person.mood === 'calm' && person.path) {
          speed = 1.2;
          const path = person.path;
          if (person.rejoin) {
            const near = world?.nearestWalk(px, pz, 40);
            if (near) {
              person.path = near.path;
              person.s = near.s;
              const target = pointAt(near.path.pts, near.path.cum, near.s);
              mx = target.x - px;
              mz = target.z - pz;
              if (Math.hypot(mx, mz) < 0.6) person.rejoin = false;
            } else person.rejoin = false;
          } else {
            person.s += person.dir * speed * dt;
            if (path.closed) {
              person.s = ((person.s % path.len) + path.len) % path.len;
            } else if (person.s > path.len - 0.5 || person.s < 0.5) {
              person.dir = -person.dir;
              person.s = Math.max(0.5, Math.min(path.len - 0.5, person.s));
            }
            if (!shadowOn && dist < 1.3) {
              const ahead = pointAt(path.pts, path.cum, person.s + person.dir * 2);
              if ((here.x - px) * (ahead.x - px) + (here.z - pz) * (ahead.z - pz) > 0) person.dir = -person.dir;
            }
            const a = pointAt(path.pts, path.cum, person.s);
            const b = pointAt(path.pts, path.cum, person.s + person.dir * 1.5);
            const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
            const nx = -(b.z - a.z) / tl;
            const nz = (b.x - a.x) / tl;
            // Keep right: offset to the right of the heading.
            const tx = a.x - nx * (0.55 + person.side * 0.4);
            const tz = a.z - nz * (0.55 + person.side * 0.4);
            mx = tx - px + (b.x - a.x) * 0.25;
            mz = tz - pz + (b.z - a.z) * 0.25;
            const lead = Math.hypot(mx, mz);
            if (lead > 3) {
              person.rejoin = true;
            }
          }
        } else if (person.role === 'shop' && person.mood === 'calm') {
          speed = 0;
          const look = !shadowOn && dist < 3.4 && dist > 0.15;
          face(person, look ? Math.atan2(here.x - px, here.z - pz) : person.homeYaw);
        } else if (person.role === 'desk' && person.mood === 'calm') {
          speed = 0;
          face(person, -Math.PI / 2);
        }
        const len = Math.hypot(mx, mz);
        person.moving = speed > 0.2 && len > 0.01;
        if (person.moving) {
          const step = Math.min(len, speed * dt);
          let nx = person.mesh.position.x + (mx / len) * step;
          let nz = person.mesh.position.z + (mz / len) * step;
          if (world && person.mood !== 'calm') {
            const to = world.resolve(nx, nz, 0.36);
            nx = to.x;
            nz = to.z;
          }
          person.mesh.position.x = nx;
          person.mesh.position.z = nz;
          face(person, Math.atan2(mx, mz));
        }
        liftPerson(person, dt);
        if (person.swing > 0) {
          person.swing = Math.max(0, person.swing - dt);
          person.moving = false;
        } else {
          person.avatar.setLocomotion(person.moving, true);
        }
        if (!playing && person.swing <= 0 && (person.mood === 'chase') && dist < 1.45) {
          person.attack -= dt;
          if (person.attack <= 0) {
            person.attack = person.role === 'police' ? 1.05 : 1.15;
            face(person, Math.atan2(here.x - px, here.z - pz));
            person.avatar.playClip('punch', false, 1, () => {
              if (person.mood !== 'down') person.avatar.resumeLocomotion();
            });
            host.playFile(STREET_SFX.punch, 0.5);
            person.swing = 0.85;
            host.hurt(person.role === 'police' ? 14 : 8);
          }
        }
      }
      for (const person of buried) bury(person);

      if (traffic) {
        const look = host.camera.getForwardRay(1).direction;
        const ll = Math.hypot(look.x, look.z) || 1;
        traffic.step(dt, here, { fx: look.x / ll, fz: look.z / ll }, false, (dist) => {
          if (!playing) host.playFile(STREET_SFX.car, Math.max(0.07, Math.min(0.22, 0.28 - dist * 0.018)));
        });
        if (!playing && carHit <= 0) {
          const hit = traffic.hits(here);
          if (hit) {
            carHit = 1.4;
            host.hurt(16);
            shake = 0.3;
            const to = world ? world.resolve(hit.x, hit.z, 0.45) : hit;
            host.placePierce(to.x, to.z, here.yaw);
          }
        }
      }

      if (!playing && policeWaves < 1 && streetNoted && policeAfter >= 30) {
        policeWaves = 1;
        const look = host.camera.getForwardRay(1).direction;
        const ll = Math.hypot(look.x, look.z) || 1;
        const spot = world?.walkSpot(here.x, here.z, 24, 34, { fx: look.x / ll, fz: look.z / ll, cos: -0.2 })
          ?? world?.walkSpot(here.x, here.z, 20, 40);
        const sx = spot ? spot.p.x : here.x - 26;
        const sz = spot ? spot.p.z : here.z;
        spawnPolice(sx, sz, 0);
        spawnPolice(sx + 1.4, sz + 1.2, 1);
        if (!policeLine) {
          policeLine = true;
          host.showLine(lineSpeaker('shout.street.police', 'Police'), lineText('shout.street.police', 'Stop! Stay where you are!'));
          host.playFile(lineAudio('shout.street.police', POLICE_SHOUT), 0.9);
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
