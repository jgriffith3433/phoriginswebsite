import * as BABYLON from '@babylonjs/core';

import type { LevelCredits } from './credits';
import type { StoryCarry } from './act1';
import type { TrainDress } from './trainDress';
import { CAR } from './trainDress';
import { PLAYER_ASSET_ID } from '../game/modelLoader';
import { createCharacterAvatar, type PlayerAvatar } from '../game/playerAvatar';
import { PLAYER_MESH_Y_OFFSET, PLAYER_STAND_Y } from '../game/player';
import { carryItems, lineAudio, lineSpeaker, lineText } from '../game/locale';
import { CORPSE_SECONDS, POSSESS_SECONDS, floorUnder, settleCorpse } from './streetRules';
import { deathScream, STREET_SFX } from './streetAudio';

/**
 * Level 7, The Train. Continue after The Station enters it. End Level is offered only from `finish`,
 * after the doors close and the last line. The card uses `ENDING_TRACK` (The Station's song) and the
 * level 7 crawl in credits.ts.
 *
 * Pierce walks the cars of the uptown 6 toward his old, untransformed body, the one that boarded with the commuter
 * at The Station. There is one car on the set (trainDress.ts); "the next car" is that car again, entered from its
 * back door, with other riders. It is never explained.
 *
 * - Car 1, opening scene (Skip ends it): the other Pierce stands at the front with the commuter, holding the pole,
 *   then goes through the end door into the next car. He never turns around.
 * - Car 2: he is one car ahead, already walking to the front, and through the end door before Pierce gets there.
 * - Car 3: the train slows into a stop with no name. A scene: the doors open, he says "This is me", the commuter
 *   says "Night", and he steps off without looking back. Then Hale calls (signal at the stop): nothing from B3
 *   reached the street. "The leak preferred a man."
 * - The open door is the end: walking to it, the doors close in front of Pierce and the train pulls out.
 *
 * Shadow mode works as at the station (main.ts routes the street controls here on level 7): C, Q hands, Tab,
 * Shadow Shock, Possess, Consume, Punch and Kick on the riders. The other Pierce and the commuter are not riders.
 */

export type TheTrainHost = {
  scene: BABYLON.Scene;
  camera: BABYLON.Camera;
  running: () => boolean;
  placePierce: (x: number, z: number, yaw: number) => void;
  playClip: (clip: string, loop: boolean, speed?: number, onEnded?: () => void) => void;
  resumeLocomotion: () => void;
  fade: (to: number, seconds?: number) => void;
  setObjective: (title: string, text: string, target: { x: number; z: number; y?: number } | null) => void;
  showObjective: (visible: boolean) => void;
  clearMarker: () => void;
  playFile: (url: string, volume: number) => void;
  setWalk: (moving: boolean) => void;
  setCarry: (items: StoryCarry[]) => void;
  showMessage: (title: string, text: string) => void;
  /** Offers End Level; the press plays `ENDING_TRACK` and rolls level 7's crawl. */
  offerEnd: (title: string, text: string) => void;
  clearInput: () => void;
  unlockNext: () => void;
  refreshHud: () => void;
  holster: () => void;
  hand: () => { x: number; y: number; z: number } | null;
  player: () => { x: number; z: number; yaw: number };
  shedShadow: (x: number, z: number) => void;
  frameCamera: (position: { x: number; y: number; z: number }, lookAt: { x: number; y: number; z: number }) => void;
  releaseCamera: () => void;
  showLine: (title: string, text: string) => void;
  holdScene: (held: boolean) => void;
  ringCall: (id: string) => void;
  /** A call is ringing or on (the phone holds the body). */
  callBusy: () => boolean;
  /** The car kit (tunnel speed for a stop, stats); null in a frame where the level is not dressed. */
  car: () => TrainDress | null;
};

/** The back of the car, facing the front (+x). */
export const TRAIN_SPAWN = { x: 1.0, z: 0, yaw: Math.PI / 2 };
/** The front end door, into the next car. */
const FRONT = { x: 17.3, z: 0 };
/** He gets off through the north door at x 11.2. */
const STOP_DOOR = { x: 11.2, z: 1.2 };
const LAST_CAR = 3;
const CRUISE = 14;
const EXIT_X = 17.85;
/** Car 2: already near the front end door when Pierce enters, so he walks out before a shadow run can close. */
const CAR2_SPAWN_X = 15.2;
/** Base walk in car 2; ramps when Pierce closes the lead, with a burst if he gets inside ~3 m. */
const CAR2_WALK = 2.6;
const CAR2_LEAD = 6;
const CAR2_BURST = 9;

const COMMUTER = 'asset-ch28-npc';
const RIDER_ASSETS = ['asset-ch08-npc', 'asset-ch31-npc', 'asset-ch23-npc'];
/** Riders per car: x, z, facing. They stand by the doors and the poles; nobody is in the aisle down the middle. */
const RIDERS: [number, number, number][][] = [
  [[6.8, -1.15, 0], [9.4, 0.92, Math.PI]],
  [[2.3, 1.15, Math.PI], [7.4, -0.92, 0], [15.7, -1.15, 0]],
  [[4.2, -0.92, 0], [15.7, 1.15, Math.PI]],
];

const CARRY: StoryCarry[] = [
  { id: 'phone', name: 'Phone', note: 'No signal in the tunnel. A bar or two at a stop.' },
  { id: 'sidearm', name: 'Sidearm', note: 'Q draws it, until Shadow mode.' },
  { id: 'shadow', name: 'Shadow mode', note: 'C or the Shadow button turns it on. Powers only work while it is on.' },
];

type Line = { id: string; speaker: string; hold: number };
// Holds are each clip's length plus a breath.
const L_THERE: Line = { id: 'dialogue.train.there', speaker: 'Pierce', hold: 2.7 };
const L_POLE: Line = { id: 'dialogue.train.pole', speaker: 'Pierce', hold: 3.3 };
const L_TURN: Line = { id: 'dialogue.train.turn', speaker: 'Pierce', hold: 3.0 };
const L_NEXT: Line = { id: 'dialogue.train.next', speaker: 'Pierce', hold: 2.1 };
const L_AHEAD: Line = { id: 'bark.train.ahead', speaker: 'Pierce', hold: 2.8 };
const L_STOP: Line = { id: 'bark.train.stop', speaker: 'Pierce', hold: 2.7 };
const L_MINE: Line = { id: 'dialogue.train.mine', speaker: 'Pierce', hold: 1.6 };
const L_NIGHT: Line = { id: 'dialogue.train.night', speaker: 'Passerby', hold: 1.0 };
const L_WAIT: Line = { id: 'dialogue.train.wait', speaker: 'Pierce', hold: 1.7 };
const L_BACK: Line = { id: 'dialogue.train.back', speaker: 'Pierce', hold: 1.9 };
const L_STREET: Line = { id: 'dialogue.train.street', speaker: 'Pierce', hold: 3.4 };

/**
 * Null so the Level Complete card uses `LEVEL_CREDITS[7]` in credits.ts.
 * The Station's line is "The Train / Sat With A Door / Open On Nothing"; level 7 has its own crawl there.
 */
export const TRAIN_CREDITS: LevelCredits | null = null;
/** The decision for now: level 7 ends on The Station's song. */
export const ENDING_TRACK = '/assets/audio/ending-6.mp3';

const SFX = {
  brakes: '/assets/audio/train/brakes.ogg',
  open: '/assets/audio/train/doors-open.ogg',
  close: '/assets/audio/train/doors-close.ogg',
};

type Figure = { mesh: BABYLON.Mesh; avatar: PlayerAvatar; gone: boolean };

type Rider = {
  mesh: BABYLON.Mesh;
  avatar: PlayerAvatar;
  yaw: number;
  moving: boolean;
  down: boolean;
  shocked: boolean;
  corpse: number;
  resting: boolean;
  poseHold: number;
  floorY: number;
};

type Beat = 'opening' | 'cars' | 'stop' | 'door' | 'closing' | 'done';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const createTheTrain = (host: TheTrainHost) => {
  let active = false;
  let finished = false;
  let playing = false;
  let beat: Beat = 'opening';
  let carNo = 1;
  let sceneTime = 0;
  let lineUntil = 0;
  let said = new Set<string>();
  let castWait = 0;
  let double: Figure | null = null;
  let commuter: Figure | null = null;
  const riders: Rider[] = [];
  const beads: BABYLON.Mesh[] = [];
  let shadowOn = false;
  let handsOut = false;
  let tether: Rider | null = null;
  let tetherMove = { x: 0, z: 0 };
  let tetherMoving = false;
  let linkLeft = 0;
  let linkTime = 0;
  let trailLeft = 0;
  let shockLeft = 0;
  let meleeLeft = 0;
  let watchLeft = 0;
  let watchX = 0;
  let watchZ = 0;
  const trailFrom = new BABYLON.Vector3();
  const trailTo = new BABYLON.Vector3();
  // Car changes: a short fade through the end door.
  let crossing = -1;
  let carTime = 0;
  let braking = false;
  let openedAt = -1;
  let walkOutAt = -1;
  let goneAt = -1;
  let callIn = -1;
  let haleRang = false;
  let leftCar = 0;

  const face = (avatar: PlayerAvatar, yaw: number) => {
    avatar.group.rotation.y = yaw + Math.PI;
  };

  const say = (line: Line, volume = 0.92) => {
    host.showLine(lineSpeaker(line.id, line.speaker), lineText(line.id));
    const url = lineAudio(line.id);
    if (url) host.playFile(url, volume);
    lineUntil = sceneTime + line.hold;
  };

  /** Says `line` once, at `at` seconds into the current scene. */
  const cue = (line: Line, at: number) => {
    if (said.has(line.id) || sceneTime < at) return false;
    said.add(line.id);
    say(line);
    return true;
  };

  const clearLine = () => {
    if (lineUntil > 0 && sceneTime > lineUntil) {
      lineUntil = 0;
      host.showLine('', '');
    }
  };

  // ---------- The other Pierce and the commuter ----------

  const spawnFigure = (id: string, assetId: string, x: number, z: number, yaw: number) => {
    const mesh = BABYLON.MeshBuilder.CreateCapsule(id, { radius: 0.34, height: 1.5 }, host.scene);
    mesh.position.set(x, PLAYER_STAND_Y, z);
    mesh.visibility = 0;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    const avatar = createCharacterAvatar(host.scene, id, assetId);
    avatar.group.parent = mesh;
    avatar.group.position.y = -PLAYER_MESH_Y_OFFSET;
    const figure: Figure = { mesh, avatar, gone: false };
    face(avatar, yaw);
    avatar.whenReady(() => {
      if (!figure.gone) avatar.setLocomotion(false, true);
    });
    return figure;
  };

  const putFigure = (figure: Figure | null, x: number, z: number, yaw: number, moving: boolean) => {
    if (!figure || figure.gone) return;
    figure.mesh.position.x = x;
    figure.mesh.position.z = z;
    face(figure.avatar, yaw);
    figure.avatar.setLocomotion(moving, true);
  };

  const hideFigure = (figure: Figure | null) => {
    if (!figure || figure.gone) return;
    figure.gone = true;
    figure.avatar.setShown(false);
    figure.mesh.setEnabled(false);
  };

  const disposeFigure = (figure: Figure | null) => {
    if (!figure) return;
    figure.gone = true;
    figure.avatar.dispose();
    if (!figure.mesh.isDisposed()) figure.mesh.dispose();
  };

  const clearFigures = () => {
    disposeFigure(double);
    disposeFigure(commuter);
    double = null;
    commuter = null;
  };

  const castReady = () => [double, commuter].every((figure) => !figure || figure.gone || figure.avatar.isReady());

  /** Walks a figure toward +x along its lane; true once it has gone through the end door. */
  const walkForward = (figure: Figure | null, z: number, speed: number, dt: number) => {
    if (!figure || figure.gone) return true;
    const x = figure.mesh.position.x + speed * dt;
    if (x >= EXIT_X) {
      hideFigure(figure);
      return true;
    }
    putFigure(figure, x, figure.mesh.position.z + (z - figure.mesh.position.z) * Math.min(1, dt * 3), Math.PI / 2, true);
    return false;
  };

  // ---------- Riders (Shadow mode targets) ----------

  const spawnRiders = (car: number) => {
    const spots = RIDERS[(car - 1) % RIDERS.length];
    spots.forEach(([x, z, yaw], index) => {
      const id = `train-rider-${car}-${index}`;
      const mesh = BABYLON.MeshBuilder.CreateCapsule(id, { radius: 0.38, height: 1.55 }, host.scene);
      mesh.position.set(x, PLAYER_STAND_Y, z);
      mesh.visibility = 0;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      const avatar = createCharacterAvatar(host.scene, id, RIDER_ASSETS[(car + index) % RIDER_ASSETS.length]);
      avatar.group.parent = mesh;
      avatar.group.position.y = -PLAYER_MESH_Y_OFFSET;
      const rider: Rider = { mesh, avatar, yaw, moving: false, down: false, shocked: false, corpse: 0, resting: false, poseHold: 0, floorY: 0 };
      face(avatar, yaw);
      avatar.whenReady(() => {
        if (!rider.down && rider !== tether) avatar.setLocomotion(false, true);
      });
      riders.push(rider);
    });
  };

  const clearRiders = () => {
    for (const rider of riders) {
      rider.avatar.dispose();
      if (!rider.mesh.isDisposed()) rider.mesh.dispose();
    }
    riders.length = 0;
  };

  const hideBeads = () => {
    for (const bead of beads) bead.setEnabled(false);
  };

  const ensureBeads = () => {
    if (beads.length) return;
    const material = new BABYLON.StandardMaterial('train-shadow-link-mat', host.scene);
    material.diffuseColor = new BABYLON.Color3(0.01, 0.01, 0.012);
    material.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.022);
    material.specularColor = BABYLON.Color3.Black();
    material.disableLighting = true;
    material.alpha = 0.32;
    material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    for (let i = 0; i < 16; i += 1) {
      const bead = BABYLON.MeshBuilder.CreateSphere(`train-shadow-link-${i}`, { diameter: 0.14, segments: 4 }, host.scene);
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
    return new BABYLON.Vector3(here.x + Math.sin(here.yaw) * 0.42, 1.22, here.z + Math.cos(here.yaw) * 0.42);
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
      bead.position.set(from.x + dir.x * t + perp.x * wave, from.y + dir.y * t + lift, from.z + dir.z * t + perp.z * wave);
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

  const layDown = (rider: Rider, shocked: boolean) => {
    if (rider.down) return;
    rider.down = true;
    rider.shocked = shocked;
    rider.moving = false;
    rider.corpse = CORPSE_SECONDS;
    rider.resting = false;
    rider.poseHold = 0;
    const feet = rider.mesh.position.y + rider.avatar.group.position.y;
    rider.floorY = floorUnder(host.scene, rider.mesh.position.x, rider.mesh.position.z, feet, rider.avatar.group);
    rider.avatar.playClip(shocked ? 'electrocuted' : 'deathforward', false);
    host.playFile(deathScream('man'), 0.72);
  };

  const bury = (rider: Rider) => {
    const index = riders.indexOf(rider);
    if (index >= 0) riders.splice(index, 1);
    rider.avatar.dispose();
    if (!rider.mesh.isDisposed()) rider.mesh.dispose();
  };

  /** Riders in front of Pierce: within `reach`, inside the look cone (camera or body). */
  const inFront = (reach: number, minDot: (dist: number) => number, useBody: boolean) => {
    const here = host.player();
    const look = host.camera.getForwardRay(1).direction;
    const camLen = Math.hypot(look.x, look.z) || 1;
    const camX = look.x / camLen;
    const camZ = look.z / camLen;
    const bodyX = Math.sin(here.yaw);
    const bodyZ = Math.cos(here.yaw);
    const out: { rider: Rider; dist: number }[] = [];
    for (const rider of riders) {
      if (rider.down || rider === tether) continue;
      const dx = rider.mesh.position.x - here.x;
      const dz = rider.mesh.position.z - here.z;
      const dist = Math.hypot(dx, dz);
      if (dist > reach || dist < 0.05) continue;
      const camDot = (dx * camX + dz * camZ) / dist;
      const dot = useBody ? Math.max(camDot, (dx * bodyX + dz * bodyZ) / dist) : camDot;
      if (dot < minDot(dist)) continue;
      out.push({ rider, dist });
    }
    return out.sort((a, b) => a.dist - b.dist);
  };

  const releaseLink = (announce = true) => {
    tether = null;
    linkLeft = 0;
    tetherMove = { x: 0, z: 0 };
    tetherMoving = false;
    hideBeads();
    if (announce && active && !finished) showGoal();
  };

  const link = (rider: Rider) => {
    tether = rider;
    linkLeft = POSSESS_SECONDS;
    rider.avatar.resumeLocomotion();
    host.playFile(STREET_SFX.possess, 0.4);
    showGoal();
    return true;
  };

  // ---------- Objective ----------

  const goalTarget = () => {
    if (beat === 'door') return { x: STOP_DOOR.x, y: 1.3, z: STOP_DOOR.z - 0.25 };
    if (beat === 'cars' && carNo < LAST_CAR) return { x: FRONT.x, y: 1.3, z: FRONT.z };
    return null;
  };

  const showGoal = () => {
    const target = goalTarget();
    if (tether) {
      host.setObjective(lineSpeaker('objective.station.link-walk', 'Shadow Link'), lineText('objective.station.link-walk'), null);
      return;
    }
    if (shadowOn && target) {
      const id = handsOut ? 'objective.station.link-aim' : 'objective.station.shadow';
      host.setObjective(lineSpeaker(id, 'Shadow mode'), lineText(id), target);
      return;
    }
    const id = beat === 'door' ? 'objective.train.door' : carNo >= LAST_CAR ? 'objective.train.catch' : 'objective.train.front';
    host.setObjective(lineSpeaker(id, 'The train'), lineText(id), target ?? { x: STOP_DOOR.x, y: 1.3, z: 0.6 });
  };

  const report = () => {
    const pos = (figure: Figure | null) => (figure && !figure.gone
      ? { x: Math.round(figure.mesh.position.x * 100) / 100, z: Math.round(figure.mesh.position.z * 100) / 100 }
      : null);
    host.car()?.setStory({
      beat,
      car: carNo,
      oldBody: pos(double),
      oldBodyFacing: double && !double.gone ? Math.round(((double.avatar.group.rotation.y - Math.PI) * 180) / Math.PI) : null,
      commuter: pos(commuter),
      leftCar: leftCar || null,
      riders: riders.filter((rider) => !rider.down).length,
      hale: haleRang,
    });
  };

  // ---------- Scenes ----------

  const holdFor = (shot: () => void) => {
    playing = true;
    sceneTime = 0;
    lineUntil = 0;
    castWait = 0;
    host.holdScene(true);
    host.showObjective(false);
    host.clearMarker();
    host.setWalk(false);
    shot();
  };

  const giveControl = () => {
    playing = false;
    host.showLine('', '');
    host.setWalk(false);
    host.releaseCamera();
    host.holdScene(false);
    // playClip locks cinematic. Calling it after resume leaves him sliding in idle.
    host.resumeLocomotion();
    showGoal();
    host.showObjective(true);
    host.refreshHud();
  };

  const openingShot = () => host.frameCamera({ x: 0.45, y: 1.92, z: -0.75 }, { x: 15.5, y: 1.3, z: 0.1 });

  const beginOpening = () => {
    beat = 'opening';
    carNo = 1;
    said = new Set();
    clearFigures();
    double = spawnFigure('train-double', PLAYER_ASSET_ID, 15.0, 0.25, Math.PI / 2);
    commuter = spawnFigure('train-commuter', COMMUTER, 15.55, -0.4, -Math.PI / 2 + 0.4);
    spawnRiders(1);
    host.placePierce(TRAIN_SPAWN.x, TRAIN_SPAWN.z, TRAIN_SPAWN.yaw);
    holdFor(openingShot);
    host.playClip('rebornidle', true);
  };

  const T_THERE = 1.2;
  const T_POLE = T_THERE + L_THERE.hold + 0.2;
  const T_GO = T_POLE + 1.8;
  const T_TURN = T_POLE + L_POLE.hold + 0.3;
  const T_NEXT = T_TURN + L_TURN.hold + 0.5;
  const T_OPENING_END = T_NEXT + L_NEXT.hold + 0.3;

  const endOpening = () => {
    if (beat !== 'opening') return;
    hideFigure(double);
    hideFigure(commuter);
    leftCar = 1;
    beat = 'cars';
    host.placePierce(TRAIN_SPAWN.x, TRAIN_SPAWN.z, TRAIN_SPAWN.yaw);
    giveControl();
  };

  const stepOpening = (dt: number) => {
    if (!castReady() && castWait < 8) {
      castWait += dt;
      openingShot();
      return;
    }
    sceneTime += dt;
    openingShot();
    cue(L_THERE, T_THERE);
    cue(L_POLE, T_POLE);
    if (sceneTime >= T_GO) {
      walkForward(double, 0.15, 1.15, dt);
      if (sceneTime >= T_GO + 0.5) walkForward(commuter, -0.2, 1.15, dt);
    }
    cue(L_TURN, T_TURN);
    cue(L_NEXT, T_NEXT);
    clearLine();
    if (sceneTime >= T_OPENING_END) endOpening();
  };

  /** Car 2 and 3: Pierce comes through the back end door, one car closer. */
  const enterCar = (n: number) => {
    carNo = n;
    carTime = 0;
    sceneTime = 0;
    said = new Set();
    releaseLink(false);
    clearRiders();
    clearFigures();
    spawnRiders(n);
    if (n < LAST_CAR) {
      // Already past mid-car and walking out — one car ahead, not a fair chase.
      double = spawnFigure('train-double', PLAYER_ASSET_ID, CAR2_SPAWN_X, 0.15, Math.PI / 2);
      commuter = spawnFigure('train-commuter', COMMUTER, CAR2_SPAWN_X + 0.7, -0.25, Math.PI / 2);
    } else {
      // At the north door, facing it. He does not turn around again.
      double = spawnFigure('train-double', PLAYER_ASSET_ID, STOP_DOOR.x, 0.95, 0);
      commuter = spawnFigure('train-commuter', COMMUTER, 12.05, 0.62, -Math.PI / 2 - 0.5);
      braking = false;
    }
    host.placePierce(TRAIN_SPAWN.x, TRAIN_SPAWN.z, TRAIN_SPAWN.yaw);
    host.resumeLocomotion();
    showGoal();
    host.refreshHud();
  };

  const stopShot = () => host.frameCamera({ x: 7.6, y: 1.78, z: -1.05 }, { x: STOP_DOOR.x + 0.2, y: 1.2, z: 1.25 });

  const beginStop = () => {
    beat = 'stop';
    openedAt = -1;
    walkOutAt = -1;
    goneAt = -1;
    host.car()?.setSpeed(0);
    host.car()?.setStop(true);
    if (shadowOn) toggle(false);
    releaseLink(false);
    host.placePierce(7.3, -0.35, Math.atan2(STOP_DOOR.x - 7.3, STOP_DOOR.z - -0.35));
    holdFor(stopShot);
    host.playClip('rebornidle', true);
  };

  const openDoors = () => {
    host.car()?.setDoor(STOP_DOOR.x, 1, true);
    host.playFile(SFX.open, 0.6);
  };

  const endStop = () => {
    if (beat !== 'stop') return;
    if (openedAt < 0) openDoors();
    hideFigure(double);
    hideFigure(commuter);
    leftCar = LAST_CAR;
    beat = 'door';
    giveControl();
    callIn = 1.0;
  };

  const stepStop = (dt: number) => {
    sceneTime += dt;
    stopShot();
    const speed = host.car()?.speed() ?? 0;
    if (speed < 7.5) cue(L_STOP, 0.4);
    if (openedAt < 0 && (speed < 0.3 || sceneTime > 12)) {
      openedAt = sceneTime;
      openDoors();
    }
    if (openedAt >= 0) {
      const at = openedAt + 1.3;
      cue(L_MINE, at);
      cue(L_NIGHT, at + L_MINE.hold + 0.1);
      if (walkOutAt < 0 && sceneTime >= at + L_MINE.hold + L_NIGHT.hold + 0.2) walkOutAt = sceneTime;
    }
    if (walkOutAt >= 0 && double && !double.gone) {
      // Straight out through the door onto the Gaussian Splat station platform, facing it the whole way.
      const z = double.mesh.position.z + 1.45 * dt;
      if (z > 2.65) {
        hideFigure(double);
        goneAt = sceneTime;
      } else {
        putFigure(double, STOP_DOOR.x, z, 0, true);
      }
    }
    if (walkOutAt >= 0 && sceneTime >= walkOutAt + 0.35 && commuter && !commuter.gone) {
      const cx = commuter.mesh.position.x + (STOP_DOOR.x + 0.22 - commuter.mesh.position.x) * Math.min(1, 3.5 * dt);
      const cz = commuter.mesh.position.z + 1.35 * dt;
      if (cz > 2.45) {
        hideFigure(commuter);
      } else {
        putFigure(commuter, cx, cz, 0, true);
      }
    }
    if (walkOutAt >= 0) cue(L_WAIT, walkOutAt + 0.5);
    if (goneAt >= 0) {
      cue(L_BACK, Math.max(goneAt + 0.9, walkOutAt + 0.5 + L_WAIT.hold + 0.2));
      if (said.has(L_BACK.id) && sceneTime > lineUntil + 0.5) {
        endStop();
        return;
      }
    }
    clearLine();
  };

  const closingShot = () => host.frameCamera({ x: 8.9, y: 1.72, z: -0.95 }, { x: STOP_DOOR.x, y: 1.15, z: 1.45 });

  const beginClosing = () => {
    beat = 'closing';
    releaseLink(false);
    if (shadowOn) toggle(false);
    host.placePierce(STOP_DOOR.x - 0.1, 0.55, 0);
    holdFor(closingShot);
    host.playClip('rebornidle', true);
    host.car()?.setDoor(STOP_DOOR.x, 1, false);
    host.playFile(SFX.close, 0.6);
  };

  const finish = () => {
    if (finished) return;
    beat = 'done';
    finished = true;
    if (playing) {
      playing = false;
      host.showLine('', '');
      host.releaseCamera();
      host.holdScene(false);
    }
    host.car()?.setDoor(STOP_DOOR.x, 1, false);
    host.car()?.setSpeed(CRUISE);
    host.car()?.setStop(false);
    host.setWalk(false);
    host.clearMarker();
    host.showObjective(false);
    host.clearInput();
    host.resumeLocomotion();
    host.playClip('rebornidle', true);
    host.unlockNext();
    host.refreshHud();
    report();
    host.offerEnd(lineSpeaker('ui.complete.train', 'Level Complete'), lineText('ui.complete.train'));
  };

  const stepClosing = (dt: number) => {
    sceneTime += dt;
    closingShot();
    if (sceneTime >= 1.4 && (host.car()?.speed() ?? 0) < 0.5) host.car()?.setSpeed(CRUISE);
    if (sceneTime >= 2.2) host.car()?.setStop(false);
    cue(L_STREET, 1.6);
    clearLine();
    if (said.has(L_STREET.id) && sceneTime > lineUntil + 0.6) finish();
  };

  // ---------- Shadow mode ----------

  const toggle = (on: boolean) => {
    if (tether) releaseLink(false);
    shadowOn = on;
    handsOut = false;
    trailLeft = 0;
    hideBeads();
    host.playFile(on ? STREET_SFX.shadowOn : STREET_SFX.shadowOff, 0.4);
    if (on) host.holster();
    showGoal();
  };

  const controls = () => active && !finished && !playing && crossing < 0;

  const stepRiders = (dt: number) => {
    const buried: Rider[] = [];
    for (const rider of riders) {
      if (rider.down) {
        const posed = settleCorpse(rider.avatar, rider.floorY, rider.shocked ? 'electrocuted' : 'deathforward', rider.poseHold, dt, rider.resting);
        rider.poseHold = posed.age;
        rider.resting = posed.resting;
        rider.corpse -= dt;
        if (rider.corpse <= 0) {
          if (tether === rider) releaseLink(false);
          buried.push(rider);
        }
        continue;
      }
      if (rider === tether) {
        const mx = tetherMove.x;
        const mz = tetherMove.z;
        rider.moving = Math.hypot(mx, mz) > 0.002;
        if (rider.moving) {
          rider.mesh.position.x = clamp(rider.mesh.position.x + mx, CAR.x0 + 0.4, CAR.x1 - 0.4);
          rider.mesh.position.z = clamp(rider.mesh.position.z + mz, -1.0, 1.0);
          rider.yaw = Math.atan2(mx, mz);
          face(rider.avatar, rider.yaw);
        }
        rider.avatar.setLocomotion(rider.moving, true);
        tetherMove = { x: 0, z: 0 };
        continue;
      }
      if (rider.moving) {
        rider.moving = false;
        rider.avatar.setLocomotion(false, true);
      }
    }
    for (const rider of buried) bury(rider);
  };

  return {
    objectiveKey: () => (tether ? 'link' : shadowOn ? 'shock' : beat === 'door' ? 'stop' : 'train'),
    mount: async () => {
      active = true;
      finished = false;
      playing = false;
      shadowOn = false;
      handsOut = false;
      tether = null;
      crossing = -1;
      haleRang = false;
      callIn = -1;
      leftCar = 0;
      beat = 'opening';
    },
    onStart: () => {
      if (!active) return;
      finished = false;
      shadowOn = false;
      handsOut = false;
      crossing = -1;
      haleRang = false;
      callIn = -1;
      leftCar = 0;
      releaseLink(false);
      clearRiders();
      host.car()?.setSpeed(CRUISE);
      host.car()?.setStop(false);
      host.car()?.setDoor(STOP_DOOR.x, 1, false);
      host.setCarry(carryItems('train', CARRY));
      host.fade(0, 1.1);
      beginOpening();
      report();
      host.refreshHud();
    },
    /** The E prompt (null for none), and what pressing it does. */
    action: (): string | null => {
      if (!active || finished || playing || crossing >= 0 || beat !== 'cars' || carNo >= LAST_CAR || tether) return null;
      const here = host.player();
      return Math.abs(here.x - FRONT.x) < 1.3 && Math.abs(here.z - FRONT.z) < 0.9 ? lineText('ui.action.train.next', 'Next car') : null;
    },
    confirm: () => {
      if (crossing >= 0 || beat !== 'cars' || carNo >= LAST_CAR) return;
      if (shadowOn) toggle(false);
      host.clearInput();
      host.setWalk(false);
      host.fade(1, 0.3);
      host.playFile(SFX.close, 0.25);
      crossing = 0.4;
    },
    /** A scripted scene is running (input held, Skip offered). */
    playing: () => playing,
    skip: () => {
      if (!active || !playing || finished) return;
      if (beat === 'opening') endOpening();
      else if (beat === 'stop') endStop();
      else if (beat === 'closing') finish();
    },
    controls,
    shadowMode: () => shadowOn,
    handsOut: () => shadowOn && handsOut,
    setHands: (out: boolean) => {
      if (!controls() || !shadowOn) return;
      handsOut = out;
      if (!out) {
        trailLeft = 0;
        hideBeads();
      }
      showGoal();
    },
    shadowShown: () => controls(),
    toggleShadow: () => {
      if (!controls()) return shadowOn;
      toggle(!shadowOn);
      return shadowOn;
    },
    aimMarks: () => {
      const marks: { x: number; y: number; z: number }[] = [];
      if (!shadowOn || !handsOut || tether) return marks;
      for (const rider of riders) {
        if (!rider.down) marks.push({ x: rider.mesh.position.x, y: rider.mesh.position.y, z: rider.mesh.position.z });
      }
      return marks;
    },
    ignoresAim: (mesh: BABYLON.AbstractMesh) => {
      for (const rider of riders) {
        if (mesh === rider.mesh || mesh.isDescendantOf(rider.avatar.group)) return true;
      }
      for (const figure of [double, commuter]) {
        if (figure && (mesh === figure.mesh || mesh.isDescendantOf(figure.avatar.group))) return true;
      }
      return false;
    },
    possessAt: (x: number, y: number, z: number) => {
      if (!controls() || !shadowOn || !handsOut || tether) return false;
      let best: Rider | null = null;
      let bestDist = 1.35;
      for (const rider of riders) {
        if (rider.down) continue;
        const dist = Math.hypot(rider.mesh.position.x - x, rider.mesh.position.y - y, rider.mesh.position.z - z);
        if (dist > bestDist) continue;
        best = rider;
        bestDist = dist;
      }
      return best ? link(best) : false;
    },
    possessLook: () => {
      if (!controls() || !shadowOn || tether) return false;
      const best = inFront(6.2, (dist) => (dist > 2.8 ? 0.4 : 0.08), false)[0];
      return best ? link(best.rider) : false;
    },
    consume: () => {
      if (!controls() || !shadowOn || !tether) return false;
      const best = tether;
      trailFrom.copyFrom(handOrigin());
      trailTo.set(best.mesh.position.x, best.mesh.position.y, best.mesh.position.z);
      trailLeft = 0.55;
      ensureBeads();
      layDown(best, false);
      const atX = best.mesh.position.x;
      const atZ = best.mesh.position.z;
      releaseLink();
      watchDeath(atX, atZ);
      host.playFile(STREET_SFX.consume, 0.46);
      host.playFile(STREET_SFX.death, 0.32);
      return true;
    },
    release: () => {
      if (!tether) return false;
      releaseLink();
      return true;
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
    shock: () => {
      if (!controls() || !shadowOn || shockLeft > 0) return false;
      const hits = inFront(6.2, (dist) => (dist > 2.8 ? 0.4 : 0.08), true);
      if (!hits.length) return false;
      for (const { rider } of hits) {
        layDown(rider, true);
        host.shedShadow(rider.mesh.position.x, rider.mesh.position.z);
      }
      host.playFile(STREET_SFX.shock, 0.5);
      host.playFile(STREET_SFX.death, 0.28);
      shockLeft = 1.35;
      host.playClip('shadowshock', false, 1, () => {
        if (active && !finished) host.resumeLocomotion();
      });
      return true;
    },
    strike: (kind: 'punch' | 'kick') => {
      if (!controls() || shadowOn || meleeLeft > 0) return false;
      const best = inFront(kind === 'kick' ? 2.35 : 1.7, () => 0.35, false)[0];
      if (best) layDown(best.rider, false);
      meleeLeft = 0.85;
      host.playFile(kind === 'kick' ? STREET_SFX.kick : STREET_SFX.punch, 0.55);
      host.playClip(kind, false, 1, () => {
        if (active && !finished) host.resumeLocomotion();
      });
      return true;
    },
    shocking: () => shockLeft > 0,
    step: (dt: number) => {
      if (!active || finished || dt <= 0) return;
      const stepDt = Math.min(0.05, dt);
      if (playing) {
        if (beat === 'opening') stepOpening(stepDt);
        else if (beat === 'stop') stepStop(stepDt);
        else if (beat === 'closing') stepClosing(stepDt);
        report();
        return;
      }
      if (crossing >= 0) {
        const before = crossing;
        crossing -= stepDt;
        if (before > 0 && crossing <= 0) {
          enterCar(carNo + 1);
          host.fade(0, 0.5);
          crossing = -1;
        }
        report();
        return;
      }
      sceneTime += stepDt;
      carTime += stepDt;
      shockLeft = Math.max(0, shockLeft - stepDt);
      meleeLeft = Math.max(0, meleeLeft - stepDt);
      watchLeft = Math.max(0, watchLeft - stepDt);
      linkTime += stepDt;
      trailLeft = Math.max(0, trailLeft - stepDt);
      updateRibbon();
      if (tether) {
        linkLeft -= stepDt;
        if (linkLeft <= 0) releaseLink();
      }
      stepRiders(stepDt);
      const here = host.player();

      if (beat === 'cars' && carNo > 1 && carNo < LAST_CAR) {
        // One car ahead, and through the end door before Pierce gets there.
        if (carTime > 0.8) cue(L_AHEAD, 0);
        const lead = double && !double.gone ? double.mesh.position.x - here.x : 99;
        // Faster when he closes in; a short burst keeps shadow-run from tagging him.
        let speed = CAR2_WALK + Math.max(0, CAR2_LEAD - lead) * 1.15;
        if (lead < 3) speed = Math.max(speed, CAR2_BURST);
        const gone = walkForward(double, 0.15, speed, stepDt);
        walkForward(commuter, -0.25, speed, stepDt);
        if (gone && leftCar < carNo) leftCar = carNo;
      }
      if (beat === 'cars' && carNo >= LAST_CAR) {
        if (!braking && carTime > 0.3) {
          // The train slows for a stop that is not on the map.
          braking = true;
          host.car()?.setSpeed(0);
          host.car()?.setStop(true);
          host.playFile(SFX.brakes, 0.5);
        }
        if (braking && (host.car()?.speed() ?? 0) < 7.5) cue(L_STOP, 0);
        const speed = host.car()?.speed() ?? 0;
        if (braking && (speed < 0.4 || here.x > 7.4)) beginStop();
      }
      if (beat === 'door') {
        if (callIn >= 0) {
          callIn -= stepDt;
          if (callIn <= 0) {
            callIn = -1;
            if (!haleRang) {
              haleRang = true;
              host.ringCall('hale-train');
            }
          }
        }
        // The end: the door he left by. Not while Hale is still on the line.
        const atDoor = Math.abs(here.x - STOP_DOOR.x) < 0.75 && here.z > 0.75;
        if (atDoor && !tether && host.running() && !host.callBusy() && callIn < 0) beginClosing();
      }
      clearLine();
      report();
    },
    dispose: () => {
      active = false;
      playing = false;
      releaseLink(false);
      clearFigures();
      clearRiders();
      for (const bead of beads) bead.dispose(false, true);
      beads.length = 0;
    },
  };
};

export type TheTrain = ReturnType<typeof createTheTrain>;
