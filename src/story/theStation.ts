import * as BABYLON from '@babylonjs/core';

import { PLAYER_ASSET_ID } from '../game/modelLoader';
import { createCharacterAvatar, type PlayerAvatar } from '../game/playerAvatar';
import { PLAYER_MESH_Y_OFFSET, PLAYER_STAND_Y } from '../game/player';
import { carryItems, lineAudio, lineSpeaker, lineText } from '../game/locale';
import type { StoryCarry } from './act1';
import { CORPSE_SECONDS, POSSESS_SECONDS, floorUnder, settleCorpse } from './streetRules';
import { deathScream, STREET_SFX } from './streetAudio';

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
  offerEnd: (title: string, text: string) => void;
  haltPlay: () => void;
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
};

const DOOR = { x: 50.3, z: 1.55 };
const SHOUT = '/assets/audio/street/pedestrian-away.wav';
const ASSETS = ['asset-ch08-npc', 'asset-ch28-npc', 'asset-ch31-npc', 'asset-ch23-npc'];

const CARRY: StoryCarry[] = [
  { id: 'phone', name: 'Phone', note: 'No signal this far down.' },
  { id: 'sidearm', name: 'Sidearm', note: 'Q draws it, until Shadow mode.' },
  { id: 'shadow', name: 'Shadow mode', note: 'C or the Shadow button turns it on. Powers only work while it is on.' },
];

const MAN_ASSET = 'asset-ch28-npc';
const SPAWN = { x: 7.2, z: -1.6, yaw: Math.PI / 2 };
const MAN_AT = { x: 24, z: -1.15 };
const DOUBLE_FROM = { x: 31.2, z: 0.45 };
const DOUBLE_AT = { x: 24.12, z: 0.4 };
const CROWD: [number, number, number, number][] = [
  [22, -4.2, 16, 28],
  [36, -1.1, 30, 42],
  [58, -4.4, 52, 66],
  [70, -1.2, 64, 76],
];
const MAN_PATH = [
  { x: 24, z: -1.15 },
  { x: 50.2, z: -0.35 },
  { x: 50.3, z: 1.2 },
  { x: 50.3, z: 3.15 },
];
const DOUBLE_PATH = [
  { x: 24.12, z: 0.4 },
  { x: 49.4, z: 0.15 },
  { x: 50.1, z: 1.2 },
  { x: 50.1, z: 3.05 },
];

const LINE_ME = { id: 'dialogue.station.me', hold: 2.3 };
const LINE_HERE = { id: 'dialogue.station.here', hold: 3.6 };
const LINE_UPTOWN = { id: 'dialogue.station.uptown', hold: 1.8 };
const LINE_MINE = { id: 'dialogue.station.mine', hold: 2.0 };
const LINE_SEAT = { id: 'dialogue.station.seat', hold: 1.6 };
const LINE_LEFT = { id: 'dialogue.station.left', hold: 1.8 };

const T_WALK = 2.4;
const T_ARRIVE = 6.6;
const T_ME = 6.9;
const T_HERE = 9.3;
const T_UPTOWN = 13.1;
const T_MINE = 15.0;
const T_SEAT = 17.1;
const T_LEFT = 18.9;
const T_STRIKE = T_LEFT + LINE_LEFT.hold + 0.4;
const BOARD_SPEED = 2.7;
const STRIKE_LIMIT = 8;

type Figure = {
  mesh: BABYLON.Mesh;
  avatar: PlayerAvatar;
  role: 'man' | 'shade' | 'double';
  gone: boolean;
};

type PathPoint = { x: number; z: number };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Beside the commuter, off the line between him and the other Pierce. */
const shadeBeside = (_yaw: number) => ({
  x: MAN_AT.x + 0.65,
  z: MAN_AT.z + 0.05,
});

const walkPath = (points: PathPoint[], dist: number) => {
  let left = Math.max(0, dist);
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= seg || i === points.length - 2 && left >= seg) {
      const u = seg < 0.001 ? 1 : Math.min(1, left / seg);
      const done = i === points.length - 2 && left >= seg - 0.02;
      return {
        x: lerp(a.x, b.x, u),
        z: lerp(a.z, b.z, u),
        yaw: Math.atan2(b.x - a.x, b.z - a.z),
        done,
      };
    }
    left -= seg;
  }
  const last = points[points.length - 1];
  const prev = points[points.length - 2] ?? last;
  return { x: last.x, z: last.z, yaw: Math.atan2(last.x - prev.x, last.z - prev.z), done: true };
};

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
  shocked: boolean;
  corpse: number;
  resting: boolean;
  poseHold: number;
  floorY: number;
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
  const figures: Figure[] = [];
  const shadeWisps: BABYLON.Mesh[] = [];
  let shadeMat: BABYLON.StandardMaterial | null = null;
  let playing = false;
  let sceneTime = 0;
  let lineUntil = 0;
  let saidMe = false;
  let saidHere = false;
  let saidUptown = false;
  let saidMine = false;
  let saidSeat = false;
  let saidLeft = false;
  let boardMan = 0;
  let boardDouble = 0;
  let leaveAt = -1;
  let callIn = -1;
  let haleRang = false;
  let crowd = false;
  let shadeAlpha = 0.58;
  let shadePhase: 'yell' | 'strike' | 'gone' = 'yell';
  let yelled = false;
  let strikeAt = -1;
  let boardAt = -1;
  let castWait = 0;

  const face = (person: Person, yaw: number) => {
    person.avatar.group.rotation.y = yaw + Math.PI;
  };

  const faceFigure = (figure: Figure, yaw: number) => {
    figure.avatar.group.rotation.y = yaw + Math.PI;
  };

  const paintShade = (avatar: PlayerAvatar, alpha: number) => {
    for (const mesh of avatar.group.getChildMeshes(false)) {
      mesh.visibility = alpha < 0.04 ? 0 : 1;
      const material = mesh.material;
      if (material instanceof BABYLON.PBRMaterial) {
        material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        material.alpha = alpha;
        material.useAlphaFromAlbedoTexture = false;
        const tagged = material.metadata as { shade?: boolean } | null;
        if (!tagged?.shade) {
          material.albedoColor = new BABYLON.Color3(0.14, 0.13, 0.16);
          material.emissiveColor = new BABYLON.Color3(0.02, 0.012, 0.04);
          material.metadata = { ...(material.metadata ?? {}), shade: true };
        }
      } else if (material instanceof BABYLON.StandardMaterial) {
        material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        material.alpha = alpha;
        material.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.06);
        material.emissiveColor = new BABYLON.Color3(0.02, 0.012, 0.035);
      }
    }
  };

  const ensureWisps = () => {
    if (shadeWisps.length || !shadeMat) return;
    for (let i = 0; i < 8; i += 1) {
      const wisp = BABYLON.MeshBuilder.CreateSphere(`station-shade-wisp-${i}`, { diameter: 0.28, segments: 5 }, host.scene);
      wisp.material = shadeMat;
      wisp.isPickable = false;
      wisp.checkCollisions = false;
      wisp.setEnabled(false);
      shadeWisps.push(wisp);
    }
  };

  const poseWisps = (x: number, z: number, alpha: number) => {
    ensureWisps();
    for (let i = 0; i < shadeWisps.length; i += 1) {
      const wisp = shadeWisps[i];
      if (alpha < 0.04) {
        wisp.setEnabled(false);
        continue;
      }
      const cycle = (sceneTime * 0.35 + i * 0.31) % 1;
      const ang = sceneTime * 0.6 + (i / shadeWisps.length) * Math.PI * 2;
      const out = 0.28 + cycle * 0.35;
      wisp.setEnabled(true);
      wisp.position.set(x + Math.cos(ang) * out, 0.45 + cycle * 1.15, z + Math.sin(ang) * out);
      wisp.visibility = (1 - cycle) * alpha * 0.7;
    }
  };

  const clearFigures = () => {
    for (const figure of figures) {
      figure.avatar.dispose();
      if (!figure.mesh.isDisposed()) figure.mesh.dispose();
    }
    figures.length = 0;
    for (const wisp of shadeWisps) {
      if (!wisp.isDisposed()) wisp.dispose(false, false);
    }
    shadeWisps.length = 0;
    shadeMat?.dispose();
    shadeMat = null;
  };

  const spawnFigure = (id: string, assetId: string, x: number, z: number, yaw: number, role: Figure['role']) => {
    const mesh = BABYLON.MeshBuilder.CreateCapsule(id, { radius: 0.34, height: 1.5 }, host.scene);
    mesh.position.set(x, PLAYER_STAND_Y, z);
    mesh.visibility = 0;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    const avatar = createCharacterAvatar(host.scene, id, assetId);
    avatar.group.parent = mesh;
    avatar.group.position.y = -PLAYER_MESH_Y_OFFSET;
    const figure: Figure = { mesh, avatar, role, gone: false };
    faceFigure(figure, yaw);
    avatar.whenReady(() => {
      if (figure.gone) return;
      if (role === 'shade') paintShade(avatar, shadeAlpha);
      avatar.setLocomotion(false, true);
    });
    figures.push(figure);
    return figure;
  };

  const putFigure = (figure: Figure, x: number, z: number, yaw: number, moving: boolean, holdClip = false) => {
    if (figure.gone) return;
    figure.mesh.position.x = x;
    figure.mesh.position.z = z;
    faceFigure(figure, yaw);
    if (!holdClip) figure.avatar.setLocomotion(moving, true);
  };

  const hideFigure = (figure: Figure) => {
    if (figure.gone) return;
    figure.gone = true;
    figure.avatar.setShown(false);
    figure.mesh.setEnabled(false);
  };

  const say = (title: string, text: string, url: string, hold: number) => {
    host.showLine(title, text);
    host.playFile(url, 0.92);
    lineUntil = sceneTime + hold;
  };

  const frameShot = () => {
    if (sceneTime < T_UPTOWN) {
      host.frameCamera({ x: 3.6, y: 2.35, z: -0.15 }, { x: 30, y: 1.15, z: -0.9 });
      return;
    }
    if (shadePhase !== 'gone') {
      host.frameCamera({ x: 21.5, y: 1.62, z: -0.35 }, { x: 24.7, y: 1.28, z: -0.7 });
      return;
    }
    const man = figures.find((figure) => figure.role === 'man');
    const focus = man && !man.gone
      ? { x: man.mesh.position.x, z: man.mesh.position.z }
      : { x: 50.2, z: 1.2 };
    host.frameCamera(
      { x: Math.min(focus.x - 3.2, 46.5), y: 1.68, z: Math.min(focus.z + 2.1, 0.9) },
      { x: focus.x, y: 1.22, z: focus.z },
    );
  };

  const spawnCrowd = () => {
    if (crowd) return;
    crowd = true;
    CROWD.forEach(([x, z, x0, x1], index) => {
      spawn(`station-walk-${index}`, ASSETS[index % ASSETS.length], x, z, x0, x1);
    });
  };

  const handoff = () => {
    if (!playing) return;
    playing = false;
    clearFigures();
    host.showLine('', '');
    host.setWalk(false);
    host.releaseCamera();
    host.holdScene(false);
    host.placePierce(SPAWN.x, SPAWN.z, SPAWN.yaw);
    // playClip locks cinematic. Calling it after resume leaves him sliding in idle.
    host.resumeLocomotion();
    showGoal();
    host.showObjective(true);
    spawnCrowd();
    callIn = 0.7;
  };

  const beginEncounter = () => {
    clearFigures();
    playing = true;
    sceneTime = 0;
    lineUntil = 0;
    saidMe = false;
    saidHere = false;
    saidUptown = false;
    saidMine = false;
    saidSeat = false;
    saidLeft = false;
    boardMan = 0;
    boardDouble = 0;
    leaveAt = -1;
    callIn = -1;
    shadeAlpha = 0.58;
    shadePhase = 'yell';
    yelled = false;
    strikeAt = -1;
    boardAt = -1;
    castWait = 0;
    shadeMat = new BABYLON.StandardMaterial('station-shade-wisp-mat', host.scene);
    shadeMat.diffuseColor = new BABYLON.Color3(0.01, 0.01, 0.015);
    shadeMat.emissiveColor = new BABYLON.Color3(0.04, 0.015, 0.07);
    shadeMat.specularColor = BABYLON.Color3.Black();
    shadeMat.alpha = 0.2;
    shadeMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    shadeMat.disableLighting = true;
    shadeMat.backFaceCulling = false;
    const manYaw = Math.atan2(DOUBLE_FROM.x - MAN_AT.x, DOUBLE_FROM.z - MAN_AT.z);
    const shadeAt = shadeBeside(manYaw);
    spawnFigure('station-man', MAN_ASSET, MAN_AT.x, MAN_AT.z, manYaw, 'man');
    spawnFigure('station-shade', MAN_ASSET, shadeAt.x, shadeAt.z, manYaw, 'shade');
    spawnFigure('station-double', PLAYER_ASSET_ID, DOUBLE_FROM.x, DOUBLE_FROM.z, Math.atan2(MAN_AT.x - DOUBLE_FROM.x, MAN_AT.z - DOUBLE_FROM.z), 'double');
    host.holdScene(true);
    host.showObjective(false);
    host.clearMarker();
    host.placePierce(SPAWN.x, SPAWN.z, SPAWN.yaw);
    host.playClip('rebornidle', true);
    frameShot();
  };

  const poofShade = () => {
    if (!playing || shadePhase === 'gone') return;
    const shade = figures.find((figure) => figure.role === 'shade');
    shadePhase = 'gone';
    if (boardAt < 0) boardAt = sceneTime;
    if (!shade || shade.gone) return;
    host.shedShadow(shade.mesh.position.x, shade.mesh.position.z);
    hideFigure(shade);
  };

  const stepEncounter = (dt: number) => {
    if (figures.some((figure) => !figure.avatar.isReady()) && castWait < 8) {
      castWait += dt;
      frameShot();
      return;
    }
    sceneTime += dt;
    const man = figures.find((figure) => figure.role === 'man');
    const shade = figures.find((figure) => figure.role === 'shade');
    const twin = figures.find((figure) => figure.role === 'double');
    const approach = sceneTime < T_WALK ? 0 : Math.min(1, (sceneTime - T_WALK) / (T_ARRIVE - T_WALK));
    const twinX = lerp(DOUBLE_FROM.x, DOUBLE_AT.x, approach);
    const twinZ = lerp(DOUBLE_FROM.z, DOUBLE_AT.z, approach);
    const walkingIn = approach > 0 && approach < 1;
    if (twin && shadePhase !== 'gone') {
      const yaw = walkingIn
        ? Math.atan2(DOUBLE_AT.x - DOUBLE_FROM.x, DOUBLE_AT.z - DOUBLE_FROM.z)
        : Math.atan2(MAN_AT.x - twinX, MAN_AT.z - twinZ);
      putFigure(twin, twinX, twinZ, yaw, walkingIn);
    }
    const talkYaw = Math.atan2(twinX - MAN_AT.x, twinZ - MAN_AT.z);
    if (man && shadePhase !== 'gone') {
      putFigure(man, MAN_AT.x, MAN_AT.z, talkYaw, false);
    }
    if (shade && !shade.gone) {
      const spot = shadeBeside(talkYaw);
      paintShade(shade.avatar, shadeAlpha);
      if (shadePhase === 'yell' && sceneTime >= T_STRIKE) {
        shadePhase = 'strike';
        strikeAt = sceneTime;
        const played = shade.avatar.playClip('melee360', false, 1, () => poofShade());
        if (!played) poofShade();
      } else if (shadePhase === 'yell' && !yelled) {
        yelled = shade.avatar.playClip('yellingout', true);
      }
      if (shadePhase === 'strike' && strikeAt >= 0 && sceneTime > strikeAt + STRIKE_LIMIT) poofShade();
      if (!shade.gone) putFigure(shade, spot.x, spot.z, talkYaw, false, true);
    }
    if (shadePhase === 'gone' && man && twin) {
      if (boardAt < 0) boardAt = sceneTime;
      const walked = sceneTime - boardAt;
      boardMan += BOARD_SPEED * dt;
      if (walked >= 0.85) boardDouble += BOARD_SPEED * dt;
      const manAt = walkPath(MAN_PATH, boardMan);
      const twinAt = walkPath(DOUBLE_PATH, boardDouble);
      if (manAt.done) hideFigure(man);
      else putFigure(man, manAt.x, manAt.z, manAt.yaw, true);
      if (twinAt.done) hideFigure(twin);
      else putFigure(twin, twinAt.x, twinAt.z, twinAt.yaw, true);
      if (manAt.done && twinAt.done && leaveAt < 0) leaveAt = sceneTime + 0.45;
      if (leaveAt >= 0 && sceneTime >= leaveAt) {
        handoff();
        return;
      }
    }
    frameShot();
    if (!saidMe && sceneTime >= T_ME) {
      saidMe = true;
      say(lineSpeaker(LINE_ME.id, 'Pierce'), lineText(LINE_ME.id), lineAudio(LINE_ME.id), LINE_ME.hold);
    } else if (!saidHere && sceneTime >= T_HERE) {
      saidHere = true;
      say(lineSpeaker(LINE_HERE.id, 'Pierce'), lineText(LINE_HERE.id), lineAudio(LINE_HERE.id), LINE_HERE.hold);
    } else if (!saidUptown && sceneTime >= T_UPTOWN) {
      saidUptown = true;
      say(lineSpeaker(LINE_UPTOWN.id, 'Pierce'), lineText(LINE_UPTOWN.id), lineAudio(LINE_UPTOWN.id), LINE_UPTOWN.hold);
    } else if (!saidMine && sceneTime >= T_MINE) {
      saidMine = true;
      say(lineSpeaker(LINE_MINE.id, 'Passerby'), lineText(LINE_MINE.id), lineAudio(LINE_MINE.id), LINE_MINE.hold);
    } else if (!saidSeat && sceneTime >= T_SEAT) {
      saidSeat = true;
      say(lineSpeaker(LINE_SEAT.id, 'Pierce'), lineText(LINE_SEAT.id), lineAudio(LINE_SEAT.id), LINE_SEAT.hold);
    } else if (!saidLeft && sceneTime >= T_LEFT) {
      saidLeft = true;
      say(lineSpeaker(LINE_LEFT.id, 'Passerby'), lineText(LINE_LEFT.id), lineAudio(LINE_LEFT.id), LINE_LEFT.hold);
    } else if (lineUntil > 0 && sceneTime > lineUntil) {
      lineUntil = 0;
      host.showLine('', '');
    }
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
      shocked: false,
      corpse: 0,
      resting: false,
      poseHold: 0,
      floorY: 0,
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
      host.setObjective(lineSpeaker('objective.station.link-walk', 'Shadow Link'), lineText('objective.station.link-walk'), null);
      return;
    }
    if (shadowOn && !handsOut) {
      host.setObjective(lineSpeaker('objective.station.shadow', 'Shadow mode'), lineText('objective.station.shadow'), door);
      return;
    }
    if (shadowOn) {
      host.setObjective(lineSpeaker('objective.station.link-aim', 'Shadow Link'), lineText('objective.station.link-aim'), door);
      return;
    }
    host.setObjective(lineSpeaker('objective.station.train', 'The train'), lineText('objective.station.train'), door);
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
    linkLeft = 0;
    tetherMove = { x: 0, z: 0 };
    tetherMoving = false;
    hideBeads();
    if (announce && active && !finished) showGoal();
  };

  const layDown = (person: Person, shocked: boolean) => {
    if (person.down) return;
    person.down = true;
    person.shocked = shocked;
    person.moving = false;
    person.fleeing = false;
    person.corpse = CORPSE_SECONDS;
    person.resting = false;
    person.poseHold = 0;
    const feet = person.mesh.position.y + person.avatar.group.position.y;
    person.floorY = floorUnder(host.scene, person.mesh.position.x, person.mesh.position.z, feet, person.avatar.group);
    person.avatar.playClip(shocked ? 'electrocuted' : 'deathforward', false);
    host.playFile(deathScream('man'), 0.72);
  };

  const bury = (person: Person) => {
    const index = people.indexOf(person);
    if (index >= 0) people.splice(index, 1);
    person.avatar.dispose();
    if (!person.mesh.isDisposed()) person.mesh.dispose();
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    host.setWalk(false);
    host.clearMarker();
    host.showObjective(false);
    host.clearInput();
    host.playClip('rebornidle', true);
    host.unlockNext();
    host.refreshHud();
    host.offerEnd(lineSpeaker('ui.complete.station', 'Level Complete'), lineText('ui.complete.station'));
  };

  return {
    objectiveKey: () => (tether ? 'link' : shadowOn ? 'shock' : 'station'),
    dispose: () => {
      active = false;
      playing = false;
      releaseLink(false);
      clearFigures();
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
      linkLeft = 0;
      people.length = 0;
      crowd = false;
      haleRang = false;
      callIn = -1;
      playing = false;
    },
    onStart: () => {
      if (!active) return;
      shadowOn = false;
      handsOut = false;
      host.setCarry(carryItems('station', CARRY));
      host.fade(0, 1.1);
      beginEncounter();
      host.refreshHud();
    },
    controls: () => active && !finished && !playing,
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
      linkLeft = POSSESS_SECONDS;
      best.fleeing = false;
      best.avatar.resumeLocomotion();
      host.playFile('/assets/audio/sfx/street/possess.wav', 0.4);
      showGoal();
      return true;
    },
    possessLook: () => {
      if (!active || finished || !shadowOn || tether) return false;
      const here = host.player();
      const look = host.camera.getForwardRay(1).direction;
      const camLen = Math.hypot(look.x, look.z) || 1;
      const camX = look.x / camLen;
      const camZ = look.z / camLen;
      let best: Person | null = null;
      let bestDist = 6.2;
      for (const person of people) {
        if (person.down) continue;
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
      tether = best;
      linkLeft = POSSESS_SECONDS;
      best.fleeing = false;
      best.avatar.resumeLocomotion();
      host.playFile('/assets/audio/sfx/street/possess.wav', 0.4);
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
      layDown(best, false);
      const atX = best.mesh.position.x;
      const atZ = best.mesh.position.z;
      releaseLink();
      watchDeath(atX, atZ);
      host.playFile('/assets/audio/sfx/street/consume.wav', 0.46);
      host.playFile('/assets/audio/sfx/street/death.wav', 0.32);
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
      host.playFile(shadowOn ? '/assets/audio/sfx/street/shadow-on.wav' : '/assets/audio/sfx/street/shadow-off.wav', 0.4);
      if (shadowOn) host.holster();
      showGoal();
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
    playing: () => playing,
    skip: () => {
      if (active && playing && !finished) handoff();
    },
    shadowShown: () => active && !finished && !playing,
    shock: () => {
      if (!active || finished || !shadowOn || shockLeft > 0) return false;
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
        layDown(person, true);
        host.shedShadow(person.mesh.position.x, person.mesh.position.z);
        hit = true;
      }
      if (!hit) return false;
      host.playFile('/assets/audio/sfx/street/shock.wav', 0.5);
      host.playFile('/assets/audio/sfx/street/death.wav', 0.28);
      shockLeft = 1.35;
      host.playClip('shadowshock', false, 1, () => {
        if (active && !finished) host.resumeLocomotion();
      });
      return true;
    },
    strike: (kind: 'punch' | 'kick') => {
      if (!active || finished || shadowOn || meleeLeft > 0) return false;
      const here = host.player();
      const look = host.camera.getForwardRay(1).direction;
      const camLen = Math.hypot(look.x, look.z) || 1;
      const camX = look.x / camLen;
      const camZ = look.z / camLen;
      const reach = kind === 'kick' ? 2.35 : 1.7;
      let best: Person | null = null;
      let bestDist = reach;
      for (const person of people) {
        if (person.down || person === tether) continue;
        const dx = person.mesh.position.x - here.x;
        const dz = person.mesh.position.z - here.z;
        const dist = Math.hypot(dx, dz);
        if (dist > bestDist || dist < 0.05) continue;
        const dot = (dx * camX + dz * camZ) / dist;
        if (dot < 0.35) continue;
        best = person;
        bestDist = dist;
      }
      if (best) layDown(best, false);
      meleeLeft = 0.85;
      host.playFile(kind === 'kick' ? STREET_SFX.kick : STREET_SFX.punch, 0.55);
      host.playClip(kind, false, 1, () => {
        if (active && !finished) host.resumeLocomotion();
      });
      return true;
    },
    shocking: () => shockLeft > 0,
    step: (dt: number) => {
      if (!active || finished) return;
      const stepDt = Math.min(0.05, Math.max(0, dt));
      if (playing) {
        stepEncounter(stepDt);
        return;
      }
      if (callIn >= 0) {
        callIn -= stepDt;
        if (callIn <= 0) {
          callIn = -1;
          if (!haleRang) {
            haleRang = true;
            host.ringCall('hale-board');
          }
        }
      }
      shockLeft = Math.max(0, shockLeft - stepDt);
      meleeLeft = Math.max(0, meleeLeft - stepDt);
      watchLeft = Math.max(0, watchLeft - stepDt);
      linkTime += stepDt;
      trailLeft = Math.max(0, trailLeft - stepDt);
      const here = host.player();
      updateRibbon();
      if (tether) {
        linkLeft -= stepDt;
        if (linkLeft <= 0) releaseLink();
      }
      const buried: Person[] = [];
      for (const person of people) {
        if (person.down) {
          const posed = settleCorpse(
            person.avatar,
            person.floorY,
            person.shocked ? 'electrocuted' : 'deathforward',
            person.poseHold,
            stepDt,
            person.resting,
          );
          person.poseHold = posed.age;
          person.resting = posed.resting;
          person.corpse -= stepDt;
          if (person.corpse <= 0) {
            if (tether === person) releaseLink(false);
            buried.push(person);
          }
          continue;
        }
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
        const dx = person.mesh.position.x - here.x;
        const dz = person.mesh.position.z - here.z;
        const dist = Math.hypot(dx, dz);
        if (shadowOn && person.fleeing) person.fleeing = false;
        if (!shadowOn && !person.fleeing && person.skittish && dist < 2.3) {
          person.fleeing = true;
          person.dir = dx >= 0 ? 1 : -1;
          if (!person.screamed) {
            person.screamed = true;
            host.playFile(lineAudio('shout.street.pedestrian', SHOUT), 0.55);
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
      for (const person of buried) bury(person);
      if (!tether && host.running() && Math.abs(here.x - DOOR.x) < 1.6 && here.z > 0.85 && here.z < 2.15) finish();
    },
  };
};
