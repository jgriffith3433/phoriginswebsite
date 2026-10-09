import * as BABYLON from '@babylonjs/core';

import { createUnlockedAudio } from '../game/audioUnlock';
import type { CutsceneVec3 } from '../game/cutscenes';
import { findClip } from '../game/playerAvatar';
import { TRANSFORM_HERO_ASSET_ID, PLAYER_ASSET_ID } from '../game/modelLoader';
import {
  remainingDepartingNpcs,
  resolveBoardDoor,
  resolveBoardSeatPose,
  resolveElevator,
  resolveOfficeTerminal,
  resolveOfficeWindow,
  startBoardDeparture,
  updateNpcDeparture,
  type Npc,
} from '../game/npcs';
import { paintLiftGlyph, type SceneData, type SceneTrigger } from '../game/sceneData';

import actCopy from './act1.json';

export type StoryCarry = { id: string; name: string; note: string };

export type SequencePhase =
  | 'seat' | 'idle' | 'wait-board' | 'window' | 'call' | 'alarm' | 'terminal' | 'elevator' | 'ride' | 'done'
  | 'arrive' | 'to-lab' | 'reveal' | 'hunt' | 'transform';

type Objective = { title: string; text: string };

const copy = actCopy as {
  objectives: Record<string, Objective>;
  carry: Record<string, StoryCarry[]>;
  complete: Record<string, Objective>;
};

const objective = (id: string): Objective => copy.objectives[id] ?? { title: 'Objective', text: '' };
const carryOf = (id: string): StoryCarry[] => (copy.carry[id] ?? []).map((item) => ({ ...item }));

export type ActHost = {
  scene: BABYLON.Scene;
  hemi: BABYLON.HemisphericLight;
  sun: BABYLON.DirectionalLight;
  camera: BABYLON.Camera;
  alarmFlash: HTMLElement | null;
  getMission: () => SceneData | null;
  getNpcs: () => Npc[];
  isApex: () => boolean;
  isB3: () => boolean;
  playerXZ: () => { x: number; z: number };
  running: () => boolean;
  inCutscene: () => boolean;
  setObjective: (title: string, text: string, target: { x: number; z: number; y?: number } | null) => void;
  showObjective: (visible: boolean) => void;
  hideMarker: () => void;
  showMarker: () => void;
  clearMarker: () => void;
  clearObjectiveCue: () => void;
  placePierce: (x: number, z: number, yaw: number) => void;
  playClip: (clip: string, loop: boolean, speed?: number) => void;
  resumeLocomotion: () => void;
  holdLocomotion: () => void;
  swapAvatar: (assetId: string) => void;
  seatHead: () => void;
  leaveHead: () => void;
  beginCutscene: (id: string) => void;
  playFile: (url: string, volume: number) => void;
  audioOn: () => boolean;
  ensureAudio: () => void;
  tone: (hz: number, seconds: number, type: OscillatorType, gain: number) => void;
  win: () => void;
  showMessage: (title: string, text: string) => void;
  haltPlay: () => void;
  clearInput: () => void;
  unlockNext: () => void;
  refreshHud: () => void;
  setCarry: (items: StoryCarry[]) => void;
  ringCall: (id: string) => void;
  pushPhoneText: (id: string) => void;
  silencePhone: () => void;
  hurt: (amount: number) => void;
  stockAmmo: () => void;
  beamAt: (at: { x: number; y: number; z: number } | null) => void;
  frameCamera: (position: { x: number; y: number; z: number }, lookAt: { x: number; y: number; z: number }) => void;
  fade: (to: number, seconds?: number) => void;
};

const ELEVATOR_DOOR_L_CLOSED = 43.42;
const ELEVATOR_DOOR_R_CLOSED = 44.58;
const ELEVATOR_DOOR_L_OPEN = 42.42;
const ELEVATOR_DOOR_R_OPEN = 45.58;
const ELEVATOR_POSE = { x: 44.25, z: 21.2, yaw: Math.PI / 2 };
const OFFICE_WINDOW_YAW = 0;
const OFFICE_TERMINAL_POSE = { x: 48.15, z: 41.2, yaw: 0 };
const ELEVATOR_DOOR_CLOSE_AT = 3.3;
const ELEVATOR_RIDE_AT = 7.2;
const ELEVATOR_ARRIVE_AT = 64.5;
const ELEVATOR_DING_AT = 65.4;
const LIFT_FLOOR_AT = [0, 16, 26, 36, 46, 56, 64.5];
const LIFT_FLOOR_LEDS = ['lift-ind-58', 'lift-ind-40', 'lift-ind-20', 'lift-ind-L', 'lift-ind-B1', 'lift-ind-B2', 'lift-ind-B3'] as const;
const LIFT_FLOOR_LABELS = ['58', '40', '20', 'L', 'B1', 'B2', 'B3'] as const;
const LAB_DOOR_L_CLOSED = 36.95;
const LAB_DOOR_R_CLOSED = 39.05;
const LAB_DOOR_L_OPEN = 35.5;
const LAB_DOOR_R_OPEN = 40.5;
const B3_LAB_DOOR = { x: 17.6, z: 38 };
const B3_REVEAL_START = { x: 18.5, z: 38, yaw: -Math.PI / 2 };
const B3_REVEAL_END = { x: 12.6, z: 38, yaw: -Math.PI / 2 };
const CREATURE_HOME = { x: 10.4, y: 0, z: 36.4, yaw: Math.PI / 2 };
const CREATURE_THREAT_AT = 9.1;
const CREATURE_FLEE_AT = 13.8;
const CREATURE_FLEE_END = 20.2;
const CREATURE_FLEE_PATH = [
  { x: CREATURE_HOME.x, z: CREATURE_HOME.z },
  { x: 6.9, z: 31.05 },
  { x: 7.5, z: 26.2 },
];
const VAT_CENTER = { x: 7.2, z: 38 };
const VAT_LUNG = { x: 9.15, z: 38.15 };
const VAT_STAND = { x: 11.35, z: 38.2 };
const VAT_ARRIVE = 6.5;
const VAT_CRACK = 3.8;
const VAT_BREAK = 14.4;
const CREATURE_SFX = {
  breath: '/assets/audio/cutscenes/b3-door-reveal/creature-breath.wav',
  run: '/assets/audio/cutscenes/b3-door-reveal/creature-run.wav',
  skitter: '/assets/audio/sfx/creature/skitter.wav',
  scrape: '/assets/audio/sfx/creature/scrape.wav',
  hiss: '/assets/audio/sfx/creature/hiss.wav',
  shriek: '/assets/audio/sfx/creature/shriek.wav',
  cry: '/assets/audio/sfx/creature/cry.wav',
  heartbeat: '/assets/audio/sfx/creature/heartbeat.wav',
  snarl: '/assets/audio/sfx/creature/snarl.wav',
  wound: '/assets/audio/sfx/creature/wound.wav',
  tick: '/assets/audio/sfx/creature/tick.wav',
  knock: '/assets/audio/sfx/creature/knock.wav',
  chitter: '/assets/audio/sfx/creature/chitter.wav',
} as const;

type HuntBlock = { minX: number; maxX: number; minZ: number; maxZ: number };

type HuntNav = {
  step: number;
  originX: number;
  originZ: number;
  cols: number;
  rows: number;
  open: Uint8Array;
  zone: Uint16Array;
  blocks: HuntBlock[];
};

const HIDE_MARKER: SequencePhase[] = ['idle', 'done', 'window', 'call', 'terminal', 'ride', 'reveal', 'transform'];
const SHOW_HUD: SequencePhase[] = ['seat', 'wait-board', 'alarm', 'elevator', 'arrive', 'to-lab', 'hunt'];

type LightBaseline = { hemi: number; sun: number; points: Map<BABYLON.Light, number> };

export type Act1 = ReturnType<typeof createAct1>;

export const createAct1 = (host: ActHost) => {
  let phase: SequencePhase = 'idle';
  let boardDeparting = false;
  let windowQueued = false;
  let callStarted = false;
  let elevatorQueued = false;
  let windowLocked = false;
  let terminalLocked = false;
  let elevatorLocked = false;
  let seated = false;
  let elevatorDoorOpen = 0;
  let elevatorFloorIndex = 0;
  let elevatorDinged = false;
  let elevatorReadout = '';
  let labDoorOpen = 0;
  let transformed = false;
  let vatPath: { x: number; z: number }[] = [];
  let vatPathLen = 0;
  let vatArrive = VAT_ARRIVE;
  let vatCrackAt = 0;
  let vatClip: string | null = null;
  let vatFxOn = false;
  let vatTex: BABYLON.DynamicTexture | null = null;
  let vatSpray: BABYLON.ParticleSystem | null = null;
  let vatCoat: BABYLON.ParticleSystem | null = null;
  let vatPour: BABYLON.ParticleSystem | null = null;
  let creatureClip: 'idle' | 'walk' | 'attack' | null = null;
  let creatureHp = 4;
  let biteCooldown = 0;
  let retreatLeft = 0;
  let huntMood: 'lurk' | 'strike' = 'lurk';
  let huntPosted: 'lurk' | 'strike' | null = null;
  let nextStrike = 5;
  let lurkIdle = 0;
  let strikeLeft = 0;
  let repathIn = 0;
  let huntBurst = 0;
  let weave = 0;
  let weaveIn = 0;
  let leapt = false;
  let leapCool = 0;
  let leapLeft = 0;
  let leapDur = 0.45;
  let leapFromX = 0;
  let leapFromZ = 0;
  let leapToX = 0;
  let leapToZ = 0;
  let leapH = 0.9;
  let huntPath: { x: number; z: number }[] = [];
  let huntNav: HuntNav | null = null;
  let stuckTime = 0;
  let stuckX = 0;
  let stuckZ = 0;
  let dread = 0;
  let breathIn = 1.4;
  let heartIn = 0.6;
  let skitterIn = 3.2;
  let scrapeIn = 0.5;
  let chitterIn = 2.2;
  let knockIn = 4.5;
  let cryIn = 8;
  let hissed = false;
  let hurtSfx = 0;
  let flickerLeft = 0;
  let fearFlash = 0;
  let practicalBase: Map<BABYLON.PointLight, number> | null = null;
  let lightBaseline: LightBaseline | null = null;
  const alarm = {
    active: false,
    wav: null as HTMLAudioElement | null,
    timer: 0,
    pulse: 0,
  };

  const mission = () => host.getMission();

  const nodesFor = (id: string) => {
    const found: BABYLON.Node[] = [];
    for (const mesh of host.scene.meshes) {
      if ((mesh.metadata as { sceneAssetId?: string } | undefined)?.sceneAssetId === id) found.push(mesh);
    }
    for (const node of host.scene.transformNodes) {
      if ((node.metadata as { sceneAssetId?: string } | undefined)?.sceneAssetId === id) found.push(node);
    }
    return found;
  };

  const meshesFor = (id: string) => {
    const meshes: BABYLON.AbstractMesh[] = [];
    for (const node of nodesFor(id)) {
      if (node instanceof BABYLON.AbstractMesh) meshes.push(node);
      for (const child of node.getChildMeshes(false)) meshes.push(child);
    }
    return meshes;
  };

  const firstMesh = (id: string) => meshesFor(id)[0] ?? null;

  const syncObjective = () => {
    if (host.inCutscene() || HIDE_MARKER.includes(phase)) host.hideMarker();
    else host.showMarker();
    host.showObjective(SHOW_HUD.includes(phase) && !host.inCutscene() && host.running());
  };

  const setCarry = (id: string) => host.setCarry(carryOf(id));

  const placeWindow = () => {
    const pose = mission() ? resolveOfficeWindow(mission() as SceneData) : { x: 48, z: 46.2 };
    host.placePierce(pose.x, pose.z, OFFICE_WINDOW_YAW);
  };

  const placeTerminal = () => {
    host.placePierce(OFFICE_TERMINAL_POSE.x, OFFICE_TERMINAL_POSE.z, OFFICE_TERMINAL_POSE.yaw);
  };

  const placeElevator = (yaw = ELEVATOR_POSE.yaw) => {
    host.placePierce(ELEVATOR_POSE.x, ELEVATOR_POSE.z, yaw);
  };

  const glow = (id: string, diffuse: BABYLON.Color3, emissive: BABYLON.Color3) => {
    for (const mesh of meshesFor(id)) {
      const material = mesh.material;
      if (!(material instanceof BABYLON.StandardMaterial) && !(material instanceof BABYLON.PBRMaterial)) continue;
      if (material instanceof BABYLON.PBRMaterial) {
        material.albedoColor = diffuse;
        material.emissiveColor = emissive;
      } else {
        material.diffuseColor = diffuse;
        material.emissiveColor = emissive;
      }
    }
  };

  type TerminalColors = {
    material: BABYLON.PBRMaterial | BABYLON.StandardMaterial;
    albedo: BABYLON.Color3 | null;
    diffuse: BABYLON.Color3 | null;
    emissive: BABYLON.Color3;
  };
  let terminalColors: TerminalColors[] | null = null;

  const rememberTerminal = () => {
    if (terminalColors) return;
    const saved: TerminalColors[] = [];
    for (const mesh of meshesFor('office-terminal')) {
      const material = mesh.material;
      if (material instanceof BABYLON.PBRMaterial) {
        saved.push({
          material,
          albedo: material.albedoColor.clone(),
          diffuse: null,
          emissive: material.emissiveColor.clone(),
        });
      } else if (material instanceof BABYLON.StandardMaterial) {
        saved.push({
          material,
          albedo: null,
          diffuse: material.diffuseColor.clone(),
          emissive: material.emissiveColor.clone(),
        });
      }
    }
    if (saved.length > 0) terminalColors = saved;
  };

  const restoreTerminal = () => {
    if (!terminalColors) return;
    for (const saved of terminalColors) {
      if (saved.material instanceof BABYLON.PBRMaterial && saved.albedo) {
        saved.material.albedoColor.copyFrom(saved.albedo);
        saved.material.emissiveColor.copyFrom(saved.emissive);
      } else if (saved.material instanceof BABYLON.StandardMaterial && saved.diffuse) {
        saved.material.diffuseColor.copyFrom(saved.diffuse);
        saved.material.emissiveColor.copyFrom(saved.emissive);
      }
    }
  };

  const restyleTerminal = (alarming: boolean) => {
    if (!alarming) {
      restoreTerminal();
      return;
    }
    rememberTerminal();
    const diffuse = new BABYLON.Color3(0.55, 0.08, 0.1);
    const emissive = new BABYLON.Color3(0.85, 0.12, 0.14);
    for (const mesh of meshesFor('office-terminal')) {
      const material = mesh.material;
      if (material instanceof BABYLON.PBRMaterial) {
        material.albedoColor = diffuse.clone();
        material.emissiveColor = emissive.clone();
      } else if (material instanceof BABYLON.StandardMaterial) {
        material.diffuseColor = diffuse.clone();
        material.emissiveColor = emissive.clone();
      }
    }
  };

  /** Walk-up point on the chair side of Pierce's desk. The terminal mesh sits on the far edge. */
  const alarmSpot = (data: SceneData) => {
    const chair = data.assets.find((asset) => asset.id === 'chair-office');
    const x = chair?.x ?? chair?.position?.x;
    const z = chair?.z ?? chair?.position?.z;
    if (typeof x === 'number' && typeof z === 'number') return { x, z };
    const terminal = resolveOfficeTerminal(data);
    return { x: terminal.x, z: terminal.z - 1.15 };
  };

  const applyElevatorDoors = (openAmount: number) => {
    const t = Math.max(0, Math.min(1, openAmount));
    const doorL = firstMesh('lift-door-l');
    const doorR = firstMesh('lift-door-r');
    if (doorL) {
      doorL.position.x = ELEVATOR_DOOR_L_CLOSED + (ELEVATOR_DOOR_L_OPEN - ELEVATOR_DOOR_L_CLOSED) * t;
      doorL.checkCollisions = t < 0.45;
    }
    if (doorR) {
      doorR.position.x = ELEVATOR_DOOR_R_CLOSED + (ELEVATOR_DOOR_R_OPEN - ELEVATOR_DOOR_R_CLOSED) * t;
      doorR.checkCollisions = t < 0.45;
    }
  };

  const applyLabDoors = (openAmount: number) => {
    const t = Math.max(0, Math.min(1, openAmount));
    const doorL = firstMesh('lab-door-l');
    const doorR = firstMesh('lab-door-r');
    if (doorL) {
      doorL.position.z = LAB_DOOR_L_CLOSED + (LAB_DOOR_L_OPEN - LAB_DOOR_L_CLOSED) * t;
      doorL.checkCollisions = t < 0.45;
    }
    if (doorR) {
      doorR.position.z = LAB_DOOR_R_CLOSED + (LAB_DOOR_R_OPEN - LAB_DOOR_R_CLOSED) * t;
      doorR.checkCollisions = t < 0.45;
    }
  };

  const elevatorFloorAt = (time: number) => {
    let index = 0;
    for (let i = 0; i < LIFT_FLOOR_AT.length; i += 1) {
      if (time >= LIFT_FLOOR_AT[i]) index = i;
    }
    return index;
  };

  const applyElevatorIndicators = (floorIndex: number, descending: boolean, arrived: boolean, time = 0) => {
    glow('lift-ind-panel', new BABYLON.Color3(0.04, 0.05, 0.06), new BABYLON.Color3(0.02, 0.03, 0.04));
    const flicker = descending && !arrived && Math.sin(time * 31.4) * Math.sin(time * 5.7) > 0.62;
    LIFT_FLOOR_LEDS.forEach((id, index) => {
      const active = index === floorIndex;
      const basement = index === 6 && active;
      if (!active) {
        glow(id, new BABYLON.Color3(0.12, 0.13, 0.14), new BABYLON.Color3(0.08, 0.09, 0.1));
        return;
      }
      if (flicker) {
        glow(id, new BABYLON.Color3(0.16, 0.12, 0.06), new BABYLON.Color3(0.18, 0.1, 0.04));
        return;
      }
      if (basement) {
        glow(id, new BABYLON.Color3(1, 0.28, 0.1), new BABYLON.Color3(1, 0.28, 0.08));
        return;
      }
      glow(id, new BABYLON.Color3(1, 0.78, 0.22), new BABYLON.Color3(1, 0.72, 0.18));
    });
    const arrowOn = descending || arrived;
    const blink = descending && !arrived && Math.sin(time * 8.5) > 0;
    if (arrowOn && (arrived || blink) && !flicker) {
      glow('lift-ind-down', new BABYLON.Color3(0.35, 1, 0.45), new BABYLON.Color3(0.2, 1, 0.28));
    } else {
      glow('lift-ind-down', new BABYLON.Color3(0.1, 0.14, 0.12), new BABYLON.Color3(0.06, 0.08, 0.06));
    }
    const label = LIFT_FLOOR_LABELS[floorIndex] ?? '58';
    const readout = firstMesh('lift-ind-readout');
    if (label !== elevatorReadout) {
      elevatorReadout = label;
      paintLiftGlyph(readout, label, '#ffffff');
    }
    if (flicker) glow('lift-ind-readout', new BABYLON.Color3(0.12, 0.1, 0.06), new BABYLON.Color3(0.1, 0.08, 0.04));
    else if (arrived) glow('lift-ind-readout', new BABYLON.Color3(1, 0.32, 0.1), new BABYLON.Color3(1, 0.3, 0.08));
    else glow('lift-ind-readout', new BABYLON.Color3(1, 0.82, 0.28), new BABYLON.Color3(1, 0.75, 0.2));
  };

  const applyCabLight = (time: number, riding: boolean) => {
    const light = host.scene.lights.find((entry) => (entry.metadata as { sceneAssetId?: string } | undefined)?.sceneAssetId === 'light-lift');
    const ceiling = firstMesh('ceil-lift');
    const ceilingMat = ceiling?.material;
    if (!riding) {
      if (light) light.intensity = 0.52;
      if (ceilingMat instanceof BABYLON.StandardMaterial) ceilingMat.emissiveColor = new BABYLON.Color3(0.12, 0.12, 0.13);
      if (ceilingMat instanceof BABYLON.PBRMaterial) ceilingMat.emissiveColor = new BABYLON.Color3(0.12, 0.12, 0.13);
      return;
    }
    const arrived = time >= ELEVATOR_ARRIVE_AT;
    const flicker = time >= ELEVATOR_RIDE_AT && time < ELEVATOR_ARRIVE_AT && (Math.sin(time * 23.4) * Math.sin(time * 4.1) > 0.72);
    const dim = arrived ? 0.08 : flicker ? 0.12 : 0.38 + 0.06 * Math.sin(time * 7.2);
    if (light) light.intensity = dim;
    const glowAmount = arrived ? 0.02 : flicker ? 0.04 : 0.18;
    const color = new BABYLON.Color3(glowAmount, glowAmount * (arrived ? 0.4 : 0.95), glowAmount * (arrived ? 0.3 : 0.9));
    if (ceilingMat instanceof BABYLON.StandardMaterial || ceilingMat instanceof BABYLON.PBRMaterial) {
      ceilingMat.emissiveColor = color;
    }
  };

  const pulseButton = (lit: boolean) => {
    if (lit) glow('lift-b3-button', new BABYLON.Color3(0.95, 0.35, 0.12), new BABYLON.Color3(1, 0.45, 0.08));
    else glow('lift-b3-button', new BABYLON.Color3(0.18, 0.2, 0.22), new BABYLON.Color3(0.08, 0.1, 0.12));
  };

  const creatureRoot = (): BABYLON.TransformNode | null => {
    const direct = host.scene.transformNodes.find((entry) => (entry.metadata as { sceneAssetId?: string } | undefined)?.sceneAssetId === 'b3-creature');
    if (direct) return direct;
    const fallback = nodesFor('b3-creature').find((node): node is BABYLON.TransformNode => node instanceof BABYLON.TransformNode);
    return fallback ?? null;
  };

  const playCreature = (keyword: 'idle' | 'walk' | 'attack', speed = 1, loop = true) => {
    const root = creatureRoot();
    const groups = (root?.metadata as { clipGroups?: BABYLON.AnimationGroup[] } | undefined)?.clipGroups;
    if (!groups?.length) return;
    const clip = findClip(groups, keyword);
    if (!clip) return;
    if (creatureClip === keyword && (clip.isPlaying || !loop)) {
      if (clip.isPlaying) clip.speedRatio = speed;
      return;
    }
    for (const group of groups) {
      if (group !== clip && group.isPlaying) group.stop();
    }
    clip.speedRatio = speed;
    clip.stop();
    clip.start(loop);
    creatureClip = keyword;
  };

  const resetCreature = () => {
    const node = creatureRoot();
    creatureClip = null;
    if (!node) return;
    node.setEnabled(true);
    node.position.set(CREATURE_HOME.x, CREATURE_HOME.y, CREATURE_HOME.z);
    node.rotation.set(0, CREATURE_HOME.yaw, 0);
    playCreature('idle', 1);
  };

  const setCreatureVisible = (visible: boolean) => {
    creatureRoot()?.setEnabled(visible);
  };

  const setVatGlassBroken = (broken: boolean) => {
    for (const glass of meshesFor('vat-glass')) {
      glass.setEnabled(!broken);
      glass.checkCollisions = !broken;
    }
    const acid = firstMesh('vat-acid');
    if (!acid) return;
    const material = acid.material;
    if (broken) {
      acid.scaling.x = 3.2;
      acid.scaling.y = 0.18;
      acid.scaling.z = 3.2;
      acid.position.y = 0.1;
      if (material instanceof BABYLON.StandardMaterial) {
        material.emissiveColor.set(0.16, 0.62, 0.16);
      }
    } else {
      acid.scaling.x = 2.15;
      acid.scaling.y = 1.7;
      acid.scaling.z = 2.15;
      acid.position.y = 0.95;
      if (material instanceof BABYLON.StandardMaterial) {
        material.emissiveColor.set(0.12, 0.62, 0.16);
      }
    }
  };

  const fleeAlong = (t: number) => {
    const points = CREATURE_FLEE_PATH;
    const lengths: number[] = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const span = Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
      lengths.push(span);
      total += span;
    }
    let left = Math.max(0, Math.min(1, t)) * total;
    for (let i = 0; i < lengths.length; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (left <= lengths[i] || i === lengths.length - 1) {
        const seg = lengths[i] || 1;
        const u = Math.min(1, left / seg);
        return {
          x: a.x + (b.x - a.x) * u,
          z: a.z + (b.z - a.z) * u,
          yaw: Math.atan2(b.x - a.x, b.z - a.z),
        };
      }
      left -= lengths[i];
    }
    const last = points[points.length - 1];
    return { x: last.x, z: last.z, yaw: 0 };
  };

  const stepCreatureFlee = (time: number) => {
    const node = creatureRoot();
    if (!node) return;
    if (time < CREATURE_FLEE_AT) {
      node.setEnabled(true);
      node.position.set(CREATURE_HOME.x, CREATURE_HOME.y, CREATURE_HOME.z);
      const facePierce = time >= CREATURE_THREAT_AT;
      const aimX = facePierce ? B3_REVEAL_END.x : CREATURE_HOME.x + Math.sin(CREATURE_HOME.yaw);
      const aimZ = facePierce ? B3_REVEAL_END.z : CREATURE_HOME.z + Math.cos(CREATURE_HOME.yaw);
      node.rotation.y = Math.atan2(aimX - CREATURE_HOME.x, aimZ - CREATURE_HOME.z);
      playCreature(facePierce ? 'attack' : 'idle', 1, !facePierce);
      return;
    }
    const span = CREATURE_FLEE_END - CREATURE_FLEE_AT;
    const raw = Math.min(1, Math.max(0, (time - CREATURE_FLEE_AT) / span));
    const eased = raw * raw * (3 - 2 * raw);
    const along = fleeAlong(eased);
    node.setEnabled(raw < 0.985);
    node.position.x = along.x;
    node.position.y = CREATURE_HOME.y;
    node.position.z = along.z;
    node.rotation.y = along.yaw;
    playCreature('walk', 1.45);
  };

  const lightCreature = () => {
    const node = creatureRoot();
    host.beamAt({
      x: node?.position.x ?? CREATURE_HOME.x,
      y: (node?.position.y ?? 0) + 1.38,
      z: node?.position.z ?? CREATURE_HOME.z,
    });
  };

  const captureLights = () => {
    if (lightBaseline) return;
    const points = new Map<BABYLON.Light, number>();
    host.scene.lights.forEach((light) => {
      if (light === host.hemi || light === host.sun) return;
      points.set(light, light.intensity);
    });
    lightBaseline = { hemi: host.hemi.intensity, sun: host.sun.intensity, points };
  };

  const restoreLights = () => {
    if (!lightBaseline) {
      if (host.isB3()) {
        host.hemi.intensity = 0.05;
        host.sun.intensity = 0.015;
      }
      return;
    }
    host.hemi.intensity = lightBaseline.hemi;
    host.sun.intensity = lightBaseline.sun;
    lightBaseline.points.forEach((base, light) => {
      if (!light.isDisposed()) light.intensity = base;
    });
    lightBaseline = null;
  };

  const stopAlarm = () => {
    alarm.active = false;
    host.alarmFlash?.classList.remove('visible');
    if (alarm.wav) {
      alarm.wav.pause();
      alarm.wav.src = '';
      alarm.wav = null;
    }
    restyleTerminal(false);
  };

  const startAlarm = () => {
    if (alarm.active) return;
    alarm.active = true;
    host.alarmFlash?.classList.add('visible');
    restyleTerminal(true);
    if (!host.audioOn()) return;
    host.ensureAudio();
    alarm.wav = createUnlockedAudio('/assets/audio/cutscenes/apex-window/alarm.wav');
    alarm.wav.loop = true;
    alarm.wav.volume = 0.46;
    alarm.wav.addEventListener('error', () => {
      alarm.wav = null;
    });
    void alarm.wav.play().catch(() => {
      alarm.wav = null;
    });
  };

  const finishLevel = (which: 'apex' | 'b3') => {
    const already = phase === 'done';
    clearVatFx();
    phase = 'done';
    elevatorLocked = false;
    stopAlarm();
    restoreLights();
    host.clearMarker();
    host.showObjective(false);
    host.clearInput();
    host.holdLocomotion();
    host.playClip('idle', true);
    host.haltPlay();
    if (already) return;
    if (which === 'b3') setCarry('changed');
    host.unlockNext();
    host.win();
    host.fade(1, 1.15);
    host.refreshHud();
    const card = copy.complete[which];
    host.showMessage(card.title, card.text);
  };

  const setOfficeAmmoVisible = (visible: boolean) => {
    for (const node of nodesFor('office-pickup-ammo')) node.setEnabled(visible);
  };

  const beginSeat = () => {
    if (!host.isApex()) return;
    phase = 'seat';
    setOfficeAmmoVisible(false);
    setCarry('sidearm');
    const data = mission();
    const pose = data ? resolveBoardSeatPose(data, 'chair-head') : null;
    const line = objective('seat');
    host.setObjective(line.title, line.text, { x: pose?.x ?? 50.55, y: 1.85, z: pose?.z ?? 32 });
    syncObjective();
  };

  const beginWalkout = () => {
    setOfficeAmmoVisible(true);
    const data = mission();
    if (!data || boardDeparting || phase === 'wait-board') return;
    boardDeparting = true;
    phase = 'wait-board';
    startBoardDeparture(host.getNpcs(), data);
    const door = resolveBoardDoor(data);
    const line = objective('wait-board');
    host.setObjective(line.title, line.text, { x: door.x, y: 2.05, z: door.z });
    syncObjective();
  };

  const beginWindow = () => {
    if (windowQueued || phase === 'window' || phase === 'call' || phase === 'alarm' || phase === 'terminal' || phase === 'elevator' || phase === 'ride') return;
    windowQueued = true;
    phase = 'window';
    host.fade(1, 0);
    host.hideMarker();
    host.showObjective(false);
    host.beginCutscene('apex-window');
  };

  const beginVossCall = () => {
    if (callStarted || phase === 'alarm' || phase === 'terminal' || phase === 'elevator' || phase === 'ride' || phase === 'done') return;
    callStarted = true;
    phase = 'call';
    host.fade(0, 1.3);
    windowLocked = false;
    host.clearInput();
    placeWindow();
    host.holdLocomotion();
    host.playClip('idle', true);
    host.hideMarker();
    host.showObjective(false);
    host.ringCall('voss-meeting');
  };

  const beginAlarm = () => {
    phase = 'alarm';
    startAlarm();
    host.pushPhoneText('voss-terminal');
    const data = mission();
    const spot = data ? alarmSpot(data) : { x: 48, z: 41.66 };
    const line = objective('alarm');
    host.setObjective(line.title, line.text, { x: spot.x, y: 1.45, z: spot.z });
    syncObjective();
  };

  const beginElevatorObjective = () => {
    phase = 'elevator';
    setCarry('clearance');
    stopAlarm();
    host.playFile('/assets/audio/cutscenes/elevator-b3/doors.wav', 0.58);
    const data = mission();
    const lift = data ? resolveElevator(data) : { x: 44, z: 21.35 };
    const line = objective('elevator');
    host.setObjective(line.title, line.text, { x: lift.x, y: 2.15, z: lift.z });
    syncObjective();
  };

  const beginTerminal = () => {
    if (phase !== 'alarm') return;
    phase = 'terminal';
    host.hideMarker();
    host.showObjective(false);
    host.beginCutscene('apex-terminal');
  };

  const beginElevatorCutscene = () => {
    if (elevatorQueued || phase === 'ride' || phase !== 'elevator') return;
    elevatorQueued = true;
    phase = 'ride';
    elevatorLocked = true;
    host.hideMarker();
    host.showObjective(false);
    placeElevator();
    host.beginCutscene('elevator-b3');
  };

  const beginLab = () => {
    if (!host.isB3() || phase === 'reveal' || phase === 'hunt' || phase === 'transform' || phase === 'done') return;
    phase = 'to-lab';
    const line = objective('lab');
    host.setObjective(line.title, line.text, { x: B3_LAB_DOOR.x, y: 2.05, z: B3_LAB_DOOR.z });
    syncObjective();
  };

  const beginArrival = () => {
    if (!host.isB3()) return;
    host.swapAvatar(PLAYER_ASSET_ID);
    transformed = false;
    phase = 'arrive';
    setCarry('b3');
    labDoorOpen = 0;
    elevatorDoorOpen = 0;
    applyLabDoors(0);
    applyElevatorDoors(0);
    applyElevatorIndicators(6, false, true);
    pulseButton(true);
    applyCabLight(ELEVATOR_ARRIVE_AT, true);
    if (host.running()) host.playFile('/assets/audio/cutscenes/elevator-b3/doors.wav', 0.58);
    placeElevator(0);
    resetCreature();
    setVatGlassBroken(false);
    restoreLights();
    const line = objective('lab');
    host.setObjective(line.title, line.text, { x: B3_LAB_DOOR.x, y: 2.05, z: B3_LAB_DOOR.z });
    syncObjective();
  };

  const collectHuntBlocks = (): HuntBlock[] => {
    const blocks: HuntBlock[] = [];
    const pad = 0.28;
    for (const mesh of host.scene.meshes) {
      if (!mesh.checkCollisions || !mesh.isEnabled()) continue;
      const name = mesh.name;
      if (/floor|ground|ceil|creature|phone|pistol|skybox|impact|mark|trigger|drip|eye|playerCollider|decal/i.test(name)) continue;
      const meta = mesh.metadata as { pickup?: unknown; sceneAssetId?: string } | undefined;
      if (meta?.pickup) continue;
      const id = meta?.sceneAssetId ?? '';
      if (id === 'b3-creature' || id.startsWith('b3-sign') || id.startsWith('b3-decal')) continue;
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      const minY = box.minimumWorld.y;
      const maxY = box.maximumWorld.y;
      if (maxY < 0.4 || minY > 1.65) continue;
      const spanX = box.maximumWorld.x - box.minimumWorld.x;
      const spanZ = box.maximumWorld.z - box.minimumWorld.z;
      if (spanX < 0.05 && spanZ < 0.05) continue;
      if (spanX > 24 && spanZ > 24) continue;
      blocks.push({
        minX: box.minimumWorld.x - pad,
        maxX: box.maximumWorld.x + pad,
        minZ: box.minimumWorld.z - pad,
        maxZ: box.maximumWorld.z + pad,
      });
    }
    return blocks;
  };

  const buildHuntNav = (): HuntNav | null => {
    const floors: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
    for (const mesh of host.scene.meshes) {
      if (!/floor/i.test(mesh.name)) continue;
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      const minX = box.minimumWorld.x;
      const maxX = box.maximumWorld.x;
      const minZ = box.minimumWorld.z;
      const maxZ = box.maximumWorld.z;
      if (maxX - minX < 2 || maxZ - minZ < 2) continue;
      floors.push({ minX, maxX, minZ, maxZ });
    }
    floors.push(
      { minX: 15.6, maxX: 18.6, minZ: 36.2, maxZ: 39.8 },
      { minX: 20, maxX: 40, minZ: 39.6, maxZ: 41.4 },
      { minX: 45.4, maxX: 47.8, minZ: 36.2, maxZ: 40.8 },
      { minX: 41.2, maxX: 46.8, minZ: 36.1, maxZ: 37.4 },
    );
    if (!floors.length) return null;
    const blocks = collectHuntBlocks();
    const inside = (x: number, z: number) => floors.some((floor) => {
      const narrow = (floor.maxX - floor.minX) < 4 || (floor.maxZ - floor.minZ) < 4;
      const pad = narrow ? 0.05 : 0.22;
      return x >= floor.minX + pad && x <= floor.maxX - pad && z >= floor.minZ + pad && z <= floor.maxZ - pad;
    });
    const hitsBlock = (x: number, z: number) => blocks.some((block) => (
      x >= block.minX && x <= block.maxX && z >= block.minZ && z <= block.maxZ
    ));
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const floor of floors) {
      minX = Math.min(minX, floor.minX);
      maxX = Math.max(maxX, floor.maxX);
      minZ = Math.min(minZ, floor.minZ);
      maxZ = Math.max(maxZ, floor.maxZ);
    }
    const step = 0.8;
    const originX = minX;
    const originZ = minZ;
    const cols = Math.ceil((maxX - minX) / step) + 1;
    const rows = Math.ceil((maxZ - minZ) / step) + 1;
    const open = new Uint8Array(cols * rows);
    let count = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = originX + c * step;
        const z = originZ + r * step;
        if (!inside(x, z) || hitsBlock(x, z)) continue;
        open[r * cols + c] = 1;
        count += 1;
      }
    }
    if (count < 8) return null;
    const map = { step, originX, originZ, cols, rows, open, zone: new Uint16Array(cols * rows), blocks };
    const zone = map.zone;
    let zoneId = 0;
    for (let i = 0; i < open.length; i++) {
      if (!open[i] || zone[i]) continue;
      zoneId += 1;
      const stack = [i];
      zone[i] = zoneId;
      while (stack.length) {
        const current = stack.pop()!;
        const c = current % cols;
        const r = (current - c) / cols;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
          const nc = c + dc;
          const nr = r + dr;
          if (!huntStep(map, c, r, dc, dr)) continue;
          const next = nr * cols + nc;
          if (zone[next]) continue;
          zone[next] = zoneId;
          stack.push(next);
        }
      }
    }
    return map;
  };

  const huntCell = (map: HuntNav, x: number, z: number) => ({
    c: Math.round((x - map.originX) / map.step),
    r: Math.round((z - map.originZ) / map.step),
  });

  const huntOpen = (map: HuntNav, c: number, r: number) =>
    c >= 0 && r >= 0 && c < map.cols && r < map.rows && map.open[r * map.cols + c] === 1;

  const huntWorld = (map: HuntNav, c: number, r: number) => ({
    x: map.originX + c * map.step,
    z: map.originZ + r * map.step,
  });

  const pointBlocked = (map: HuntNav, x: number, z: number) => map.blocks.some((block) => (
    x >= block.minX && x <= block.maxX && z >= block.minZ && z <= block.maxZ
  ));

  const cellsLinked = (map: HuntNav, c: number, r: number, nc: number, nr: number) => {
    if (!huntOpen(map, nc, nr)) return false;
    const a = huntWorld(map, c, r);
    const b = huntWorld(map, nc, nr);
    return !pointBlocked(map, (a.x + b.x) * 0.5, (a.z + b.z) * 0.5);
  };

  const huntStep = (map: HuntNav, c: number, r: number, dc: number, dr: number) => {
    if (dc !== 0 && dr !== 0) {
      if (!cellsLinked(map, c, r, c + dc, r)) return false;
      if (!cellsLinked(map, c, r, c, r + dr)) return false;
    }
    return cellsLinked(map, c, r, c + dc, r + dr);
  };

  const segmentClear = (map: HuntNav, x0: number, z0: number, x1: number, z1: number) => {
    const span = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(span / 0.4));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      if (pointBlocked(map, x, z)) return false;
      const cell = nearestHuntCell(map, x, z);
      if (!cell) return false;
      const spot = huntWorld(map, cell.c, cell.r);
      if (Math.hypot(spot.x - x, spot.z - z) > map.step * 0.85) return false;
    }
    return true;
  };

  const compressPath = (points: { x: number; z: number }[]) => {
    if (!huntNav || points.length < 3) return points;
    const out = [points[0]];
    let anchor = 0;
    for (let i = 2; i < points.length; i++) {
      const from = points[anchor];
      const to = points[i];
      if (!segmentClear(huntNav, from.x, from.z, to.x, to.z)) {
        out.push(points[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(points[points.length - 1]);
    return out;
  };

  const nearestHuntCell = (map: HuntNav, x: number, z: number) => {
    const { c, r } = huntCell(map, x, z);
    if (huntOpen(map, c, r)) return { c, r };
    let best: { c: number; r: number } | null = null;
    let bestD = Infinity;
    for (let radius = 1; radius <= 8 && !best; radius++) {
      for (let dc = -radius; dc <= radius; dc++) {
        for (let dr = -radius; dr <= radius; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
          if (!huntOpen(map, c + dc, r + dr)) continue;
          const score = dc * dc + dr * dr;
          if (score < bestD) {
            bestD = score;
            best = { c: c + dc, r: r + dr };
          }
        }
      }
    }
    return best;
  };

  const findHuntPath = (map: HuntNav, fromX: number, fromZ: number, toX: number, toZ: number) => {
    const start = nearestHuntCell(map, fromX, fromZ);
    const goal = nearestHuntCell(map, toX, toZ);
    if (!start || !goal) return [];
    const startI = start.r * map.cols + start.c;
    const goalI = goal.r * map.cols + goal.c;
    if (startI === goalI) return [huntWorld(map, goal.c, goal.r)];
    const size = map.cols * map.rows;
    const dist = new Float32Array(size);
    dist.fill(Number.POSITIVE_INFINITY);
    const prev = new Int32Array(size);
    prev.fill(-1);
    dist[startI] = 0;
    const heap = [startI];
    const done = new Uint8Array(size);
    const swap = (i: number, j: number) => {
      const tmp = heap[i];
      heap[i] = heap[j];
      heap[j] = tmp;
    };
    const bubbleUp = (index: number) => {
      let n = index;
      while (n > 0) {
        const parent = (n - 1) >> 1;
        if (dist[heap[parent]] <= dist[heap[n]]) break;
        swap(parent, n);
        n = parent;
      }
    };
    const bubbleDown = (index: number) => {
      let n = index;
      for (;;) {
        let best = n;
        const left = n * 2 + 1;
        const right = left + 1;
        if (left < heap.length && dist[heap[left]] < dist[heap[best]]) best = left;
        if (right < heap.length && dist[heap[right]] < dist[heap[best]]) best = right;
        if (best === n) break;
        swap(n, best);
        n = best;
      }
    };
    const push = (index: number) => {
      heap.push(index);
      bubbleUp(heap.length - 1);
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        bubbleDown(0);
      }
      return top;
    };
    const dirs: [number, number, number][] = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
    ];
    while (heap.length) {
      const current = pop();
      if (done[current]) continue;
      done[current] = 1;
      if (current === goalI) break;
      const c = current % map.cols;
      const r = (current - c) / map.cols;
      for (const [dc, dr, cost] of dirs) {
        if (!huntStep(map, c, r, dc, dr)) continue;
        const ni = (r + dr) * map.cols + (c + dc);
        const next = dist[current] + cost;
        if (next >= dist[ni]) continue;
        dist[ni] = next;
        prev[ni] = current;
        push(ni);
      }
    }
    if (dist[goalI] === Number.POSITIVE_INFINITY) return [];
    const points: { x: number; z: number }[] = [];
    let cursor = goalI;
    for (let guard = 0; cursor >= 0 && guard < size; guard++) {
      const c = cursor % map.cols;
      const r = (cursor - c) / map.cols;
      points.push(huntWorld(map, c, r));
      if (cursor === startI) break;
      cursor = prev[cursor];
    }
    points.reverse();
    return compressPath(points);
  };

  const pathToHide = (x: number, z: number, playerX: number, playerZ: number) => {
    if (!huntNav) return [];
    const here = nearestHuntCell(huntNav, x, z);
    if (!here) return [];
    const zone = huntNav.zone[here.r * huntNav.cols + here.c];
    const options: { x: number; z: number; score: number }[] = [];
    for (let r = 0; r < huntNav.rows; r++) {
      for (let c = 0; c < huntNav.cols; c++) {
        const index = r * huntNav.cols + c;
        if (!huntNav.open[index] || huntNav.zone[index] !== zone) continue;
        const point = huntWorld(huntNav, c, r);
        const fromSelf = Math.hypot(point.x - x, point.z - z);
        if (fromSelf < 2.4) continue;
        const fromPlayer = Math.hypot(point.x - playerX, point.z - playerZ);
        const roll = Math.random();
        let score = Math.random() * 8;
        if (roll < 0.34) score -= Math.abs(fromPlayer - (4 + Math.random() * 9));
        else if (roll < 0.62) score += fromPlayer * 0.2 + Math.random() * 6;
        else if (roll < 0.84) score -= fromPlayer * 0.12;
        else score += Math.random() * 16;
        options.push({ ...point, score });
      }
    }
    if (!options.length) return [];
    const roll = Math.random();
    const bucket = options.filter((point) => {
      const fromSelf = Math.hypot(point.x - x, point.z - z);
      const fromPlayer = Math.hypot(point.x - playerX, point.z - playerZ);
      if (roll < 0.42) return fromSelf > 3 && fromSelf < 12;
      if (roll < 0.72) return fromPlayer > 7 && fromSelf > 3;
      return fromSelf > 2.4;
    });
    const away = options.filter((point) => {
      const fromPlayer = Math.hypot(point.x - playerX, point.z - playerZ);
      const fromSelf = Math.hypot(point.x - x, point.z - z);
      const here = Math.hypot(x - playerX, z - playerZ);
      return fromPlayer > here + 2.5 && fromSelf > 3 && fromSelf < 16;
    });
    const pool = away.length ? away : (bucket.length ? bucket : options);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    let path = findHuntPath(huntNav, x, z, pick.x, pick.z);
    if (Math.random() < 0.7 && pool.length > 6) {
      const via = pool[Math.floor(Math.random() * Math.min(18, pool.length))];
      const out = findHuntPath(huntNav, x, z, via.x, via.z);
      const back = findHuntPath(huntNav, via.x, via.z, pick.x, pick.z);
      if (out.length > 1 && back.length > 1) path = out.concat(back);
    }
    return anchorPath(x, z, path);
  };

  const pathToPlayer = (x: number, z: number, playerX: number, playerZ: number) => {
    if (!huntNav) return [];
    const dx = playerX - x;
    const dz = playerZ - z;
    const dist = Math.hypot(dx, dz) || 1;
    const side = (Math.random() - 0.5) * 0.9;
    const goalX = playerX + (-dz / dist) * side;
    const goalZ = playerZ + (dx / dist) * side;
    const direct = findHuntPath(huntNav, x, z, goalX, goalZ);
    if (direct.length) return anchorPath(x, z, direct);
    return anchorPath(x, z, findHuntPath(huntNav, x, z, playerX, playerZ));
  };

  const anchorPath = (x: number, z: number, points: { x: number; z: number }[]) => {
    if (!huntNav || !points.length) return points;
    if (segmentClear(huntNav, x, z, points[0].x, points[0].z)) return points;
    const cell = nearestHuntCell(huntNav, x, z);
    if (!cell) return [];
    const spot = huntWorld(huntNav, cell.c, cell.r);
    if (!segmentClear(huntNav, x, z, spot.x, spot.z)) return points;
    return [spot, ...points];
  };

  const restorePracticals = () => {
    practicalBase?.forEach((base, light) => {
      if (!light.isDisposed()) light.intensity = base;
    });
    practicalBase = null;
  };

  const stepPracticals = (at: BABYLON.Vector3) => {
    if (!practicalBase) {
      practicalBase = new Map();
      for (const light of host.scene.lights) {
        if (!(light instanceof BABYLON.PointLight) || light.name === 'phoneFlash') continue;
        practicalBase.set(light, light.intensity);
      }
    }
    const dipping = flickerLeft > 0;
    for (const [light, base] of practicalBase) {
      if (light.isDisposed()) continue;
      const dist = BABYLON.Vector3.Distance(light.position, at);
      let scale = 1;
      if (dist < 9) scale = 1 - (1 - dist / 9) * 0.42;
      if (dipping && dist < 16) scale *= 0.22 + Math.random() * 0.45;
      light.intensity = base * scale;
    }
  };

  const stepDread = (node: BABYLON.TransformNode, dist: number, delta: number) => {
    stepPracticals(node.position);
    const reach = huntMood === 'strike' ? 8.5 : 5.2;
    const closeness = Math.max(0, 1 - dist / reach);
    dread = huntMood === 'strike' ? Math.max(0.4, closeness) : closeness * 0.62;
    if (huntMood === 'strike' && dist < 6.5) {
      const amp = (1 - dist / 6.5) * 0.028;
      host.camera.position.x += (Math.random() - 0.5) * amp;
      host.camera.position.y += (Math.random() - 0.5) * amp * 0.65;
    }
    const near = (span: number, floor = 0.05) => Math.max(floor, 1 - Math.min(dist, span) / span);
    breathIn -= delta;
    if (huntMood === 'lurk' && dist < 15 && breathIn <= 0) {
      breathIn = 2.8 + Math.random() * 2.6;
      host.playFile(CREATURE_SFX.breath, 0.34 * near(15, 0.08));
    }
    if (dist < 4.6) {
      if (!hissed) {
        hissed = true;
        host.playFile(CREATURE_SFX.hiss, huntMood === 'strike' ? 0.58 : 0.36);
      }
    } else if (dist > 7.5) hissed = false;
    if (huntMood === 'lurk' && lurkIdle <= 0 && huntPath.length > 0 && dist < 22) {
      scrapeIn -= delta;
      if (scrapeIn <= 0) {
        scrapeIn = 0.75 + Math.random() * 1.05;
        const step = Math.random() < 0.28 ? CREATURE_SFX.skitter : CREATURE_SFX.scrape;
        host.playFile(step, 0.3 * near(18, 0.06));
      }
    }
    skitterIn -= delta;
    if (huntMood === 'lurk' && dist > 8 && skitterIn <= 0) {
      skitterIn = 6 + Math.random() * 6;
      host.playFile(CREATURE_SFX.skitter, dist > 16 ? 0.12 : 0.22);
    }
    chitterIn -= delta;
    if (huntMood === 'lurk' && lurkIdle > 0.4 && dist < 12 && chitterIn <= 0) {
      chitterIn = 3.4 + Math.random() * 2.8;
      host.playFile(CREATURE_SFX.chitter, 0.26 * near(12, 0.08));
    }
    knockIn -= delta;
    if (knockIn <= 0) {
      knockIn = 9 + Math.random() * 8;
      host.playFile(CREATURE_SFX.knock, 0.16);
    }
    cryIn -= delta;
    if (huntMood === 'lurk' && dist > 14 && cryIn <= 0) {
      cryIn = 16 + Math.random() * 10;
      host.playFile(CREATURE_SFX.cry, 0.2);
    }
    heartIn -= delta;
    if (huntMood === 'strike' && dist < 10 && heartIn <= 0) {
      const close = dist < 3.2;
      heartIn = close ? 0.42 : 0.78;
      host.playFile(CREATURE_SFX.heartbeat, close ? 0.55 : 0.28);
    }
    if (hurtSfx > 0) hurtSfx -= delta;
    if (flickerLeft > 0) flickerLeft -= delta;
    if (fearFlash > 0) {
      fearFlash -= delta;
      if (fearFlash <= 0) host.alarmFlash?.classList.remove('visible');
    }
  };

  const postHuntMood = () => {
    if (huntPosted === huntMood) return;
    const enteringStrike = huntMood === 'strike';
    huntPosted = huntMood;
    if (!enteringStrike) return;
    flickerLeft = 0.7;
    fearFlash = 0.48;
    host.alarmFlash?.classList.add('visible');
    host.playFile(CREATURE_SFX.shriek, 0.62);
    host.playFile(CREATURE_SFX.run, 0.26);
    host.playFile(CREATURE_SFX.tick, 0.24);
  };

  const followHuntPath = (node: BABYLON.TransformNode, speed: number, delta: number) => {
    const target = huntPath[0];
    if (!target) return false;
    const dx = target.x - node.position.x;
    const dz = target.z - node.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.48) {
      huntPath.shift();
      return huntPath.length > 0;
    }
    const step = Math.min(dist, speed * delta);
    let nx = node.position.x + (dx / dist) * step;
    let nz = node.position.z + (dz / dist) * step;
    if (huntNav && pointBlocked(huntNav, nx, nz)) {
      const next = huntPath[1];
      if (next && segmentClear(huntNav, node.position.x, node.position.z, next.x, next.z)) {
        huntPath.shift();
        return true;
      }
      const half = step * 0.45;
      nx = node.position.x + (dx / dist) * half;
      nz = node.position.z + (dz / dist) * half;
      if (half < 0.02 || pointBlocked(huntNav, nx, nz)) return false;
    }
    node.position.x = nx;
    node.position.z = nz;
    node.position.y = 0;
    node.rotation.y = Math.atan2(dx, dz);
    playCreature('walk', speed > 2.2 ? 1.2 : 0.82);
    return true;
  };

  const markProgress = (node: BABYLON.TransformNode, moved: boolean, delta: number) => {
    const travel = Math.hypot(node.position.x - stuckX, node.position.z - stuckZ);
    if (moved && travel > 0.3) {
      stuckTime = 0;
      stuckX = node.position.x;
      stuckZ = node.position.z;
      return false;
    }
    stuckTime += delta;
    return stuckTime > 0.42;
  };

  const releaseCreature = (node: BABYLON.TransformNode, playerX: number, playerZ: number, chase: boolean) => {
    if (!huntNav) return;
    const blockedHere = pointBlocked(huntNav, node.position.x, node.position.z);
    const cell = nearestHuntCell(huntNav, node.position.x, node.position.z);
    if (cell) {
      const spot = huntWorld(huntNav, cell.c, cell.r);
      const gap = Math.hypot(spot.x - node.position.x, spot.z - node.position.z);
      if (gap > 0.12 && gap < 1.7 && (blockedHere || segmentClear(huntNav, node.position.x, node.position.z, spot.x, spot.z))) {
        node.position.x = spot.x;
        node.position.z = spot.z;
      }
      const here = nearestHuntCell(huntNav, node.position.x, node.position.z);
      if (here) {
        const toX = playerX - node.position.x;
        const toZ = playerZ - node.position.z;
        let best: { x: number; z: number } | null = null;
        let bestScore = -Infinity;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
          if (!huntStep(huntNav, here.c, here.r, dc, dr)) continue;
          const point = huntWorld(huntNav, here.c + dc, here.r + dr);
          if (!segmentClear(huntNav, node.position.x, node.position.z, point.x, point.z)) continue;
          const vx = point.x - node.position.x;
          const vz = point.z - node.position.z;
          const forward = vx * toX + vz * toZ;
          const side = Math.abs(vx * -toZ + vz * toX);
          const score = side * 0.6 + Math.max(0, forward) * 0.25 + Math.random() * 0.4;
          if (score > bestScore) {
            bestScore = score;
            best = point;
          }
        }
        if (best) {
          node.position.x = best.x;
          node.position.z = best.z;
        }
      }
    }
    node.position.y = 0;
    huntPath = chase
      ? pathToPlayer(node.position.x, node.position.z, playerX, playerZ)
      : pathToHide(node.position.x, node.position.z, playerX, playerZ);
    repathIn = 0.4;
    stuckTime = 0;
    stuckX = node.position.x;
    stuckZ = node.position.z;
  };

  const BITE_RANGE = 1.8;

  const dealBite = () => {
    if (biteCooldown > 0) return false;
    biteCooldown = 1.2;
    host.hurt(22);
    host.playFile(CREATURE_SFX.snarl, 0.7);
    host.playFile(CREATURE_SFX.wound, 0.4);
    return true;
  };

  const breakOff = (node: BABYLON.TransformNode, playerX: number, playerZ: number) => {
    node.position.y = 0;
    leapLeft = 0;
    huntMood = 'lurk';
    huntPosted = null;
    nextStrike = 5 + Math.random() * 10;
    lurkIdle = Math.random() < 0.22 ? 0.18 : 0;
    huntPath = pathToHide(node.position.x, node.position.z, playerX, playerZ);
  };

  const startLeap = (node: BABYLON.TransformNode, playerX: number, playerZ: number) => {
    if (!huntNav || leapCool > 0) return false;
    const dx = playerX - node.position.x;
    const dz = playerZ - node.position.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    if (dist < 1.15 || dist > 6.2) return false;
    const ux = dx / dist;
    const uz = dz / dist;
    const gap = 0.7 + Math.random() * 0.28;
    const travel = Math.max(0.4, dist - gap);
    const side = (Math.random() - 0.5) * 0.45;
    let tx = node.position.x + ux * travel - uz * side;
    let tz = node.position.z + uz * travel + ux * side;
    const clear = (x: number, z: number) => !pointBlocked(huntNav!, x, z)
      && segmentClear(huntNav!, node.position.x, node.position.z, x, z);
    if (!clear(tx, tz)) {
      tx = node.position.x + ux * travel;
      tz = node.position.z + uz * travel;
    }
    if (!clear(tx, tz)) return false;
    if (Math.hypot(playerX - tx, playerZ - tz) > 1.45) return false;
    leapFromX = node.position.x;
    leapFromZ = node.position.z;
    leapToX = tx;
    leapToZ = tz;
    leapH = 0.55 + Math.random() * 0.55;
    leapDur = 0.32 + Math.random() * 0.12;
    leapLeft = leapDur;
    leapt = true;
    leapCool = 1.5 + Math.random() * 1.1;
    return true;
  };

  const landLeap = (node: BABYLON.TransformNode, playerX: number, playerZ: number) => {
    node.position.y = 0;
    leapLeft = 0;
    stuckTime = 0;
    stuckX = node.position.x;
    stuckZ = node.position.z;
    const dist = Math.hypot(playerX - node.position.x, playerZ - node.position.z);
    if (dist < BITE_RANGE && dealBite()) {
      breakOff(node, playerX, playerZ);
      return;
    }
    huntMood = 'strike';
    leapt = false;
    repathIn = 0;
    huntPath = pathToPlayer(node.position.x, node.position.z, playerX, playerZ);
    strikeLeft = Math.max(strikeLeft, 2.4);
  };

  const beginHunt = () => {
    if (phase === 'transform' || phase === 'done' || phase === 'hunt') return;
    phase = 'hunt';
    creatureHp = 4;
    biteCooldown = 0.2;
    retreatLeft = 0;
    huntMood = 'strike';
    huntPosted = null;
    nextStrike = 0;
    lurkIdle = 0;
    strikeLeft = 0;
    repathIn = 0;
    huntBurst = 0;
    weave = 0;
    weaveIn = 0;
    leapt = false;
    leapCool = 0;
    leapLeft = 0;
    huntPath = [];
    huntNav = null;
    breathIn = 1.2;
    heartIn = 0.8;
    skitterIn = 2.4;
    scrapeIn = 0.4;
    chitterIn = 1.8;
    knockIn = 3.5;
    cryIn = 7;
    hissed = false;
    hurtSfx = 0;
    const player = host.playerXZ();
    const spawn = { x: 6.4, y: 0, z: 34.1 };
    const yaw = Math.atan2(player.x - spawn.x, player.z - spawn.z);
    const node = creatureRoot();
    creatureClip = null;
    if (node) {
      node.setEnabled(true);
      node.position.set(spawn.x, spawn.y, spawn.z);
      node.rotation.set(0, yaw, 0);
    }
    stuckTime = 0;
    stuckX = spawn.x;
    stuckZ = spawn.z;
    playCreature('idle', 1);
    host.resumeLocomotion();
    host.stockAmmo();
    const line = objective('lurk');
    host.setObjective(line.title, line.text, null);
    syncObjective();
  };

  const stepHunt = (delta: number) => {
    if (phase !== 'hunt' || host.inCutscene()) return;
    const node = creatureRoot();
    if (!node) return;
    if (retreatLeft > 0) {
      retreatLeft -= delta;
      if (!huntNav) huntNav = buildHuntNav();
      leapLeft = 0;
      node.position.y = 0;
      if (!huntPath.length && huntNav) {
        huntPath = findHuntPath(huntNav, node.position.x, node.position.z, VAT_LUNG.x, VAT_LUNG.z);
      }
      const dx = VAT_LUNG.x - node.position.x;
      const dz = VAT_LUNG.z - node.position.z;
      const dist = Math.hypot(dx, dz);
      followHuntPath(node, 3.4, delta);
      if (dist < 1.6 || retreatLeft <= 0) {
        beginVat();
        return;
      }
      const player = host.playerXZ();
      stepDread(node, Math.hypot(player.x - node.position.x, player.z - node.position.z), delta);
      return;
    }
    if (!huntNav) huntNav = buildHuntNav();
    if (leapCool > 0) leapCool -= delta;
    if (biteCooldown > 0) biteCooldown -= delta;
    const player = host.playerXZ();
    const dx = player.x - node.position.x;
    const dz = player.z - node.position.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    if (!huntNav) {
      node.rotation.y = Math.atan2(dx, dz);
      if (dist > 1.25) {
        const step = Math.min(dist - 1.05, 2.1 * delta);
        node.position.x += (dx / dist) * step;
        node.position.z += (dz / dist) * step;
        playCreature('walk', 0.9);
      } else playCreature('idle', 1);
    } else if (leapLeft > 0) {
      leapLeft -= delta;
      const t = 1 - Math.max(0, leapLeft) / leapDur;
      const eased = t * t * (3 - 2 * t);
      node.position.x = leapFromX + (leapToX - leapFromX) * eased;
      node.position.z = leapFromZ + (leapToZ - leapFromZ) * eased;
      node.position.y = Math.sin(Math.PI * Math.min(1, t)) * leapH;
      node.rotation.y = Math.atan2(leapToX - leapFromX, leapToZ - leapFromZ);
      playCreature('walk', 1.7);
      if (leapLeft <= 0) landLeap(node, player.x, player.z);
    } else if (huntMood === 'strike') {
      strikeLeft -= delta;
      repathIn -= delta;
      if (dist < BITE_RANGE) {
        if (dealBite()) breakOff(node, player.x, player.z);
        else {
          node.rotation.y = Math.atan2(dx, dz);
          playCreature('idle', 1);
        }
      } else if (leapLeft <= 0 && dist < 5.6 && startLeap(node, player.x, player.z)) {
        playCreature('walk', 1.7);
      } else if (leapLeft <= 0) {
        if (repathIn <= 0 || !huntPath.length) {
          repathIn = 0.5 + Math.random() * 0.25;
          huntPath = pathToPlayer(node.position.x, node.position.z, player.x, player.z);
        }
        const moving = followHuntPath(node, 3.15, delta);
        if (markProgress(node, moving, delta)) {
          releaseCreature(node, player.x, player.z, true);
        } else if (!moving) {
          node.rotation.y = Math.atan2(dx, dz);
          playCreature('idle', 1);
          if (repathIn <= 0) {
            repathIn = 0.35;
            huntPath = pathToPlayer(node.position.x, node.position.z, player.x, player.z);
          }
        }
      }
    } else {
      nextStrike -= delta;
      if (nextStrike <= 0) {
        lurkIdle = 0;
        huntMood = 'strike';
        huntPosted = null;
        leapt = false;
        strikeLeft = 8;
        repathIn = 0;
        huntPath = [];
        if (dist < BITE_RANGE && dealBite()) breakOff(node, player.x, player.z);
        else if (dist > 1.7 && dist < 5.2) startLeap(node, player.x, player.z);
      } else if (lurkIdle > 0) {
        lurkIdle -= delta;
        playCreature('idle', 1);
        if (Math.random() < delta * 1.4) node.rotation.y += (Math.random() - 0.5) * 1.8;
      } else if (!huntPath.length) {
        huntPath = pathToHide(node.position.x, node.position.z, player.x, player.z);
        if (!huntPath.length) lurkIdle = 0.45;
      } else {
        const moving = followHuntPath(node, 1.55, delta);
        if (markProgress(node, moving, delta)) {
          releaseCreature(node, player.x, player.z, false);
        } else if (!moving) {
          if (Math.random() < 0.72) {
            huntPath = pathToHide(node.position.x, node.position.z, player.x, player.z);
            lurkIdle = Math.random() < 0.3 ? 0.12 + Math.random() * 0.35 : 0;
          } else {
            lurkIdle = 0.18 + Math.random() * 0.45;
          }
        }
      }
    }
    postHuntMood();
    stepDread(node, dist, delta);
  };

  const shotAt = (origin: BABYLON.Vector3, direction: BABYLON.Vector3) => {
    if (phase !== 'hunt' || retreatLeft > 0 || creatureHp <= 0) return false;
    const node = creatureRoot();
    if (!node) return false;
    const body = node.position.add(new BABYLON.Vector3(0, 1.05, 0));
    const to = body.subtract(origin);
    const dir = direction.clone();
    if (dir.lengthSquared() < 1e-6) return false;
    dir.normalize();
    const along = BABYLON.Vector3.Dot(to, dir);
    if (along < 0.35 || along > 18) return false;
    const closest = origin.add(dir.scale(along));
    if (BABYLON.Vector3.Distance(closest, body) > 1.2) return false;
    creatureHp -= 1;
    if (creatureHp <= 0) {
      host.playFile(CREATURE_SFX.wound, 0.52);
      host.playFile(CREATURE_SFX.shriek, 0.55);
    } else if (hurtSfx <= 0) {
      hurtSfx = 0.22;
      host.playFile(CREATURE_SFX.wound, 0.48);
      host.playFile(CREATURE_SFX.hiss, 0.3);
    }
    if (creatureHp > 0) {
      const player = host.playerXZ();
      const gap = Math.hypot(player.x - node.position.x, player.z - node.position.z);
      const close = gap < 3.4;
      node.position.y = 0;
      if (huntMood === 'lurk') {
        leapLeft = 0;
        huntPath = pathToHide(node.position.x, node.position.z, player.x, player.z);
      } else if (close) {
        huntMood = 'strike';
        huntPosted = null;
        leapt = false;
        strikeLeft = Math.max(strikeLeft, 4.5);
        repathIn = 0;
        if (leapLeft <= 0 && !startLeap(node, player.x, player.z)) {
          leapLeft = 0;
          huntPath = pathToPlayer(node.position.x, node.position.z, player.x, player.z);
        }
      } else {
        huntMood = 'strike';
        huntPosted = null;
        leapt = false;
        strikeLeft = Math.max(strikeLeft, 4.5);
        repathIn = 0;
        leapLeft = 0;
        huntPath = pathToPlayer(node.position.x, node.position.z, player.x, player.z);
      }
      return true;
    }
    retreatLeft = 10;
    leapLeft = 0;
    node.position.y = 0;
    huntPath = [];
    const line = objective('vat');
    host.setObjective(line.title, line.text, { x: VAT_LUNG.x, y: 1.4, z: VAT_LUNG.z });
    return true;
  };

  const vatPathLength = (points: { x: number; z: number }[]) => {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    }
    return total;
  };

  const vatPointAlong = (points: { x: number; z: number }[], dist: number) => {
    let left = Math.max(0, dist);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (left <= seg || i === points.length - 2) {
        const t = seg < 0.001 ? 1 : Math.min(1, left / seg);
        return {
          x: a.x + (b.x - a.x) * t,
          z: a.z + (b.z - a.z) * t,
          yaw: Math.atan2(b.x - a.x, b.z - a.z),
        };
      }
      left -= seg;
    }
    const last = points[points.length - 1] ?? VAT_STAND;
    return {
      x: last.x,
      z: last.z,
      yaw: Math.atan2(VAT_CENTER.x - last.x, VAT_CENTER.z - last.z),
    };
  };

  const buildVatPath = () => {
    const start = host.playerXZ();
    let path = huntNav ? findHuntPath(huntNav, start.x, start.z, VAT_STAND.x, VAT_STAND.z) : [];
    if (path.length < 2) path = [{ x: start.x, z: start.z }, { x: VAT_STAND.x, z: VAT_STAND.z }];
    const last = path[path.length - 1];
    if (Math.hypot(last.x - VAT_STAND.x, last.z - VAT_STAND.z) > 0.4) {
      path = path.concat([{ x: VAT_STAND.x, z: VAT_STAND.z }]);
    } else {
      path[path.length - 1] = { x: VAT_STAND.x, z: VAT_STAND.z };
    }
    return path;
  };

  const pointLightById = (id: string) => {
    for (const light of host.scene.lights) {
      if (!(light instanceof BABYLON.PointLight) || light.name === 'phoneFlash') continue;
      const meta = light.metadata as { sceneAssetId?: string } | null;
      if (meta?.sceneAssetId === id) return light;
    }
    return null;
  };

  const lightVatStage = (time: number) => {
    const open = Math.min(1, time / 7.5);
    const flare = time >= VAT_BREAK && time < VAT_BREAK + 2.4 ? 1 : time >= VAT_BREAK ? 0.4 : 0;
    host.hemi.intensity = 0.16 + open * 0.82 + flare * 0.2;
    host.sun.intensity = 0.03 + open * 0.16 + flare * 0.06;
    const vat = pointLightById('light-vat');
    if (vat) vat.intensity = 1.4 + open * 6.5 + flare * 7;
    const north = pointLightById('light-lab-n');
    if (north) north.intensity = 0.35 + open * 2.6;
    const south = pointLightById('light-lab-s');
    if (south) south.intensity = 0.35 + open * 2.3;
    const cell = pointLightById('light-cell');
    if (cell) cell.intensity = 0.2 + open * 1.4;
  };

  const clearVatFx = () => {
    vatFxOn = false;
    vatSpray?.dispose();
    vatCoat?.dispose();
    vatPour?.dispose();
    vatTex?.dispose();
    vatSpray = null;
    vatCoat = null;
    vatPour = null;
    vatTex = null;
  };

  const acidTexture = () => {
    if (vatTex) return vatTex;
    const tex = new BABYLON.DynamicTexture('vat-acid-drop', 64, host.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const glow = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
    glow.addColorStop(0, 'rgba(230,255,210,1)');
    glow.addColorStop(0.28, 'rgba(120,255,90,0.95)');
    glow.addColorStop(0.62, 'rgba(20,140,40,0.45)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 64, 64);
    tex.update(false);
    vatTex = tex;
    return tex;
  };

  const makeAcid = (name: string, capacity: number, rate: number, life: number, stop: number) => {
    const system = new BABYLON.ParticleSystem(name, capacity, host.scene);
    system.particleTexture = acidTexture();
    system.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    system.minLifeTime = life * 0.65;
    system.maxLifeTime = life;
    system.emitRate = rate;
    system.gravity = new BABYLON.Vector3(0, -9, 0);
    system.color1 = new BABYLON.Color4(0.22, 0.9, 0.18, 1);
    system.color2 = new BABYLON.Color4(0.55, 1, 0.32, 0.9);
    system.colorDead = new BABYLON.Color4(0.04, 0.18, 0.04, 0);
    system.updateSpeed = 0.016;
    system.targetStopDuration = stop;
    system.emitter = new BABYLON.Vector3(VAT_CENTER.x, 1.65, VAT_CENTER.z);
    return system;
  };

  const startVatAcid = () => {
    if (vatFxOn) return;
    vatFxOn = true;
    const spray = makeAcid('vat-acid-spray', 1100, 900, 1.15, 2.8);
    spray.emitter = new BABYLON.Vector3(VAT_CENTER.x + 1.15, 1.55, VAT_CENTER.z);
    spray.minEmitBox = new BABYLON.Vector3(-0.1, -0.15, -0.4);
    spray.maxEmitBox = new BABYLON.Vector3(0.35, 0.35, 0.4);
    spray.direction1 = new BABYLON.Vector3(3.6, -0.55, -0.35);
    spray.direction2 = new BABYLON.Vector3(6.2, 0.25, 0.35);
    spray.minEmitPower = 7;
    spray.maxEmitPower = 12;
    spray.minSize = 0.045;
    spray.maxSize = 0.13;
    spray.start();
    vatSpray = spray;

    const pour = makeAcid('vat-acid-pour', 360, 140, 0.85, 8);
    pour.emitter = new BABYLON.Vector3(VAT_CENTER.x + 0.9, 1.7, VAT_CENTER.z);
    pour.minEmitBox = new BABYLON.Vector3(-0.2, 0, -0.35);
    pour.maxEmitBox = new BABYLON.Vector3(0.35, 0.2, 0.35);
    pour.direction1 = new BABYLON.Vector3(0.4, -0.1, -0.25);
    pour.direction2 = new BABYLON.Vector3(1.6, 0.35, 0.25);
    pour.minEmitPower = 1.2;
    pour.maxEmitPower = 2.4;
    pour.gravity = new BABYLON.Vector3(0, -8, 0);
    pour.minSize = 0.025;
    pour.maxSize = 0.07;
    pour.start();
    vatPour = pour;

    const here = host.playerXZ();
    const coat = makeAcid('vat-acid-coat', 700, 360, 0.55, 8.5);
    coat.emitter = new BABYLON.Vector3(here.x, 1.25, here.z);
    coat.minEmitBox = new BABYLON.Vector3(-0.22, 0.05, -0.16);
    coat.maxEmitBox = new BABYLON.Vector3(0.22, 0.7, 0.16);
    coat.direction1 = new BABYLON.Vector3(-0.35, -1.6, -0.3);
    coat.direction2 = new BABYLON.Vector3(0.35, -0.2, 0.3);
    coat.minEmitPower = 0.25;
    coat.maxEmitPower = 1.1;
    coat.gravity = new BABYLON.Vector3(0, -4.5, 0);
    coat.minSize = 0.03;
    coat.maxSize = 0.08;
    coat.start();
    vatCoat = coat;
  };

  const stepVatCoat = () => {
    const emitter = vatCoat?.emitter;
    if (!(emitter instanceof BABYLON.Vector3)) return;
    const here = host.playerXZ();
    emitter.set(here.x, 1.35, here.z);
  };

  const stepCreatureAtVat = (time: number) => {
    const node = creatureRoot();
    if (!node) return;
    if (time >= VAT_BREAK) {
      node.setEnabled(false);
      return;
    }
    node.setEnabled(true);
    node.position.set(VAT_LUNG.x, 0, VAT_LUNG.z);
    node.rotation.y = Math.atan2(VAT_CENTER.x - VAT_LUNG.x, VAT_CENTER.z - VAT_LUNG.z);
    playCreature('attack', 1);
  };

  const crackVatGlass = (time: number) => {
    const glass = firstMesh('vat-glass');
    if (!glass || time >= VAT_BREAK) return;
    const amount = time < VAT_CRACK ? 0 : Math.min(1, (time - VAT_CRACK) / (VAT_BREAK - VAT_CRACK));
    glass.position.x = VAT_CENTER.x + Math.sin(time * 47) * 0.04 * amount;
    glass.position.z = VAT_CENTER.z + Math.cos(time * 36) * 0.03 * amount;
    const material = glass.material;
    if (material instanceof BABYLON.StandardMaterial) {
      const flick = 0.3 + 0.7 * Math.abs(Math.sin(time * (5 + amount * 24)));
      material.emissiveColor.set(0.04 + 0.7 * amount * flick, 0.9 * amount * flick, 0.1 + 0.25 * amount * flick);
      material.alpha = 0.28 + 0.5 * amount * flick;
    }
    if (amount > 0.08 && time >= vatCrackAt) {
      host.tone(900 + amount * 1400, 0.04, 'square', 0.025 + amount * 0.02);
      if (amount > 0.4) host.playFile(CREATURE_SFX.scrape, 0.22 + amount * 0.15);
      vatCrackAt = time + (amount > 0.72 ? 0.32 : 0.75);
    }
  };

  const stepVatBreak = (time: number) => {
    const face = Math.atan2(VAT_CENTER.x - VAT_STAND.x, VAT_CENTER.z - VAT_STAND.z);
    host.beamAt({
      x: VAT_CENTER.x,
      y: time < VAT_BREAK ? 1.55 : 1.05,
      z: VAT_CENTER.z,
    });
    lightVatStage(time);
    stepCreatureAtVat(time);
    crackVatGlass(time);
    const frameOn = (x: number, z: number, yaw: number) => {
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      host.frameCamera(
        { x: x - fx * 3.05 + rx * 1.25, y: 1.66, z: z - fz * 3.05 + rz * 1.25 },
        { x: x * 0.42 + VAT_CENTER.x * 0.58, y: 1.28, z: z * 0.42 + VAT_CENTER.z * 0.58 },
      );
    };
    if (time < VAT_ARRIVE && vatPathLen > 0.55) {
      const along = vatPointAlong(vatPath, vatPathLen * Math.min(1, time / VAT_ARRIVE));
      host.placePierce(along.x, along.z, along.yaw);
      if (vatClip !== 'walk') {
        const rate = vatPathLen / VAT_ARRIVE;
        host.playClip('walk', true, Math.min(1.55, Math.max(0.7, rate / 1.45)));
        vatClip = 'walk';
      }
      frameOn(along.x, along.z, along.yaw);
    } else {
      const span = VAT_BREAK - VAT_ARRIVE;
      const u = Math.min(1, Math.max(0, (time - VAT_ARRIVE) / span));
      const back = u * u * (3 - 2 * u);
      const x = VAT_STAND.x + back * 2.15;
      const z = VAT_STAND.z + Math.sin(u * Math.PI) * 0.16;
      const yaw = face + (time < VAT_BREAK ? Math.sin(time * 2.1) * 0.08 : 0);
      host.placePierce(x, z, yaw);
      if (time < VAT_BREAK && vatClip !== 'back') {
        host.playClip('walkback', true, 0.62);
        vatClip = 'back';
      }
      if (time >= VAT_BREAK && vatClip !== 'fall') {
        host.playClip('fallingdown', false);
        vatClip = 'fall';
      }
      if (time < VAT_BREAK) frameOn(x, z, yaw);
    }
    if (time >= VAT_BREAK) {
      setVatGlassBroken(true);
      const glass = firstMesh('vat-glass');
      if (glass) {
        glass.position.x = VAT_CENTER.x;
        glass.position.z = VAT_CENTER.z;
      }
      startVatAcid();
      stepVatCoat();
      const acid = firstMesh('vat-acid');
      const material = acid?.material;
      if (material instanceof BABYLON.StandardMaterial) {
        const pulse = 0.72 + 0.28 * Math.abs(Math.sin((time - VAT_BREAK) * 5));
        material.emissiveColor.set(0.12 * pulse, 0.55 * pulse, 0.12 * pulse);
      }
    }
  };

  const beginVat = () => {
    if (phase === 'transform' || phase === 'done') return;
    retreatLeft = 0;
    dread = 0;
    fearFlash = 0;
    host.alarmFlash?.classList.remove('visible');
    restorePracticals();
    host.beginCutscene('b3-vat-break');
  };

  const reset = () => {
    boardDeparting = false;
    windowQueued = false;
    callStarted = false;
    host.silencePhone();
    elevatorQueued = false;
    windowLocked = false;
    terminalLocked = false;
    elevatorLocked = false;
    seated = false;
    host.clearObjectiveCue();
    phase = 'idle';
    stopAlarm();
    elevatorDoorOpen = 0;
    elevatorFloorIndex = 0;
    elevatorDinged = false;
    elevatorReadout = '';
    labDoorOpen = 0;
    transformed = false;
    creatureClip = null;
    creatureHp = 4;
    biteCooldown = 0;
    retreatLeft = 0;
    huntMood = 'lurk';
    huntPosted = null;
    nextStrike = 5;
    lurkIdle = 0;
    strikeLeft = 0;
    repathIn = 0;
    huntBurst = 0;
    weave = 0;
    weaveIn = 0;
    leapt = false;
    leapCool = 0;
    leapLeft = 0;
    huntPath = [];
    huntNav = null;
    stuckTime = 0;
    stuckX = 0;
    stuckZ = 0;
    dread = 0;
    breathIn = 1.4;
    heartIn = 0.6;
    skitterIn = 3.2;
    scrapeIn = 0.5;
    chitterIn = 2.2;
    knockIn = 4.5;
    cryIn = 8;
    hissed = false;
    hurtSfx = 0;
    flickerLeft = 0;
    fearFlash = 0;
    host.alarmFlash?.classList.remove('visible');
    restorePracticals();
    clearVatFx();
    vatPath = [];
    vatPathLen = 0;
    vatArrive = VAT_ARRIVE;
    vatCrackAt = 0;
    vatClip = null;
    applyElevatorDoors(0);
    applyElevatorIndicators(0, false, false);
    applyCabLight(0, false);
    applyLabDoors(0);
    restoreLights();
    setCreatureVisible(true);
    setVatGlassBroken(false);
    host.clearMarker();
    host.showObjective(false);
  };

  return {
    phase: () => phase,
    armPhase: (next: SequencePhase) => {
      phase = next;
    },
    reset,
    onLevelReady: () => {
      if (host.isB3()) beginArrival();
      else beginSeat();
    },
    onStart: () => {
      if (host.isB3()) beginArrival();
      else if (host.isApex() && (phase === 'idle' || phase === 'done' || phase === 'seat')) beginSeat();
      else syncObjective();
    },
    handleTrigger: (trigger: SceneTrigger) => {
      if (phase === 'call') return true;
      if (trigger.id === 'trigger-elevator-b3') {
        beginElevatorCutscene();
        return true;
      }
      if (trigger.id === 'trigger-lab-door') {
        if (!host.isB3() || (phase !== 'to-lab' && phase !== 'arrive')) return true;
        host.beginCutscene('b3-door-reveal');
        return true;
      }
      const cutsceneId = trigger.type === 'cutscene'
        ? String(trigger.data?.cutscene ?? trigger.id)
        : typeof trigger.data?.cutscene === 'string'
          ? trigger.data.cutscene
          : null;
      if (cutsceneId) {
        host.beginCutscene(cutsceneId);
        return true;
      }
      return false;
    },
    prepareCutscene: (id: string) => {
      if (id === 'room-for-grace') {
        seated = true;
        phase = 'idle';
        host.showObjective(false);
        host.hideMarker();
        host.seatHead();
      }
      if (id === 'apex-window') {
        windowLocked = true;
        phase = 'window';
        host.fade(1, 0);
        host.showObjective(false);
        host.hideMarker();
        placeWindow();
        host.playClip('idle', true);
      }
      if (id === 'apex-terminal') {
        terminalLocked = true;
        phase = 'terminal';
        host.showObjective(false);
        host.hideMarker();
        placeTerminal();
        host.playClip('idle', true);
      }
      if (id === 'elevator-b3') {
        elevatorLocked = true;
        phase = 'ride';
        host.showObjective(false);
        host.hideMarker();
        placeElevator();
        host.playClip('idle', true);
      }
      if (id === 'b3-door-reveal') {
        phase = 'reveal';
        host.showObjective(false);
        host.hideMarker();
        host.placePierce(B3_REVEAL_START.x, B3_REVEAL_START.z, B3_REVEAL_START.yaw);
        host.playClip('pistolIdle', true);
        resetCreature();
        lightCreature();
      }
      if (id === 'b3-vat-break') {
        phase = 'transform';
        host.showObjective(false);
        host.hideMarker();
        dread = 0;
        fearFlash = 0;
        host.alarmFlash?.classList.remove('visible');
        restorePracticals();
        clearVatFx();
        vatPath = buildVatPath();
        vatPathLen = vatPathLength(vatPath);
        vatArrive = VAT_ARRIVE;
        vatCrackAt = VAT_CRACK;
        vatClip = null;
        vatFxOn = false;
        captureLights();
        labDoorOpen = 1;
        applyLabDoors(1);
        const beast = creatureRoot();
        if (beast) {
          beast.setEnabled(true);
          beast.position.set(VAT_LUNG.x, 0, VAT_LUNG.z);
          beast.rotation.y = Math.atan2(VAT_CENTER.x - VAT_LUNG.x, VAT_CENTER.z - VAT_LUNG.z);
        }
        creatureClip = null;
        const face = Math.atan2(VAT_CENTER.x - VAT_STAND.x, VAT_CENTER.z - VAT_STAND.z);
        if (vatPathLen < 0.55) host.placePierce(VAT_STAND.x, VAT_STAND.z, face);
        host.beamAt({ x: VAT_CENTER.x, y: 1.62, z: VAT_CENTER.z });
      }
    },
    relock: (id: string) => {
      if (id === 'room-for-grace' && seated) host.seatHead();
      if (windowLocked) placeWindow();
      if (terminalLocked) placeTerminal();
      if (elevatorLocked) placeElevator();
    },
    releaseSeat: () => {
      if (!seated) return;
      seated = false;
      host.leaveHead();
    },
    onCutsceneEnded: (id: string) => {
      if (id === 'elevator-b3') {
        finishLevel('apex');
        return;
      }
      if (id === 'b3-vat-break') {
        finishLevel('b3');
        return;
      }
      if (id === 'b3-door-reveal') {
        beginHunt();
        return;
      }
      host.resumeLocomotion();
      syncObjective();
      if (id === 'room-for-grace') beginWalkout();
      if (id === 'apex-window') beginVossCall();
      if (id === 'apex-terminal') beginElevatorObjective();
    },
    startCall: () => beginVossCall(),
    onPhoneFinished: () => {
      if (phase !== 'call') return;
      host.resumeLocomotion();
      beginAlarm();
    },
    onCutsceneFailed: (id: string) => {
      if (id === 'room-for-grace') beginWalkout();
      if (id === 'apex-window') beginVossCall();
      if (id === 'apex-terminal') beginElevatorObjective();
      if (id === 'elevator-b3') finishLevel('apex');
      if (id === 'b3-door-reveal') beginHunt();
      if (id === 'b3-vat-break') finishLevel('b3');
    },
    beforeCutsceneStep: (id: string, time: number) => {
      if (windowLocked) placeWindow();
      if (terminalLocked) placeTerminal();
      if (elevatorLocked) {
        const closeT = Math.min(1, Math.max(0, (time - ELEVATOR_DOOR_CLOSE_AT) / 1.5));
        elevatorDoorOpen = 1 - closeT;
        applyElevatorDoors(elevatorDoorOpen);
        pulseButton(time >= 2.35);
        const descending = time >= ELEVATOR_RIDE_AT && time < ELEVATOR_ARRIVE_AT;
        const arrived = time >= ELEVATOR_ARRIVE_AT;
        const floorIndex = elevatorFloorAt(time);
        if (floorIndex !== elevatorFloorIndex) {
          elevatorFloorIndex = floorIndex;
          if (!arrived) host.playFile('/assets/audio/cutscenes/elevator-b3/beep.wav', 0.34);
        }
        if (arrived && !elevatorDinged && time >= ELEVATOR_DING_AT) elevatorDinged = true;
        applyElevatorIndicators(floorIndex, descending, arrived, time);
        applyCabLight(time, true);
        placeElevator();
      }
      if (id === 'b3-door-reveal') {
        const doorT = Math.min(1, Math.max(0, (time - 0.75) / 1.35));
        labDoorOpen = doorT;
        applyLabDoors(doorT);
        const walkT = Math.min(1, Math.max(0, (time - 2.35) / 3.2));
        const x = B3_REVEAL_START.x + (B3_REVEAL_END.x - B3_REVEAL_START.x) * walkT;
        host.placePierce(x, B3_REVEAL_START.z, B3_REVEAL_START.yaw);
        stepCreatureFlee(time);
        lightCreature();
      }
      if (id === 'b3-vat-break') stepVatBreak(time);
    },
    afterCamera: (time: number) => {
      if (phase === 'transform' && time >= VAT_BREAK && time < VAT_BREAK + 1.7) {
        const amp = 0.055 * (1 - (time - VAT_BREAK) / 1.7);
        host.camera.position.x += Math.sin(time * 48.2) * amp;
        host.camera.position.y += Math.sin(time * 71.4) * amp * 0.65;
        host.camera.position.z += Math.cos(time * 39.6) * amp * 0.4;
      }
      if (!elevatorLocked) return;
      if (time < ELEVATOR_RIDE_AT || time > ELEVATOR_ARRIVE_AT + 1.2) return;
      const amp = time >= ELEVATOR_ARRIVE_AT ? 0.006 : 0.02;
      host.camera.position.x += Math.sin(time * 41.3) * amp;
      host.camera.position.y += Math.sin(time * 53.7) * amp * 0.55;
      host.camera.position.z += Math.sin(time * 29.1) * amp * 0.35;
    },
    fearLevel: () => dread,
    stepWorld: (delta: number) => {
      if (phase === 'elevator' && elevatorDoorOpen < 1) {
        elevatorDoorOpen = Math.min(1, elevatorDoorOpen + delta / 1.05);
        applyElevatorDoors(elevatorDoorOpen);
      }
      if (host.isB3() && (phase === 'arrive' || phase === 'to-lab') && elevatorDoorOpen < 1) {
        elevatorDoorOpen = Math.min(1, elevatorDoorOpen + delta / 1.15);
        applyElevatorDoors(elevatorDoorOpen);
        if (elevatorDoorOpen >= 1) beginLab();
      }
      if (boardDeparting) {
        updateNpcDeparture(host.getNpcs(), delta);
        if (remainingDepartingNpcs(host.getNpcs()) === 0) {
          boardDeparting = false;
          beginWindow();
        }
      }
      if (phase !== 'hunt') {
        if (dread !== 0 || practicalBase || fearFlash > 0) {
          dread = 0;
          fearFlash = 0;
          host.alarmFlash?.classList.remove('visible');
          restorePracticals();
        }
      }
      stepHunt(delta);
      if (phase === 'alarm') {
        const data = mission();
        if (!data) return;
        const spot = alarmSpot(data);
        const player = host.playerXZ();
        if (Math.hypot(player.x - spot.x, player.z - spot.z) < 1.35) beginTerminal();
      }
    },
    alarmTick: (delta: number) => {
      if (!alarm.active) return;
      rememberTerminal();
      alarm.pulse += delta;
      const flash = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(alarm.pulse * 9));
      const color = new BABYLON.Color3(flash, 0.08, 0.1);
      for (const mesh of meshesFor('office-terminal')) {
        const material = mesh.material;
        if (material instanceof BABYLON.StandardMaterial || material instanceof BABYLON.PBRMaterial) {
          material.emissiveColor = color;
        }
      }
      const wavPlaying = Boolean(alarm.wav && !alarm.wav.paused && alarm.wav.readyState >= 2);
      if (wavPlaying || !host.audioOn()) return;
      alarm.timer += delta;
      if (alarm.timer < 0.52) return;
      alarm.timer = 0;
      host.tone(880, 0.11, 'square', 0.085);
      window.setTimeout(() => host.tone(620, 0.11, 'square', 0.07), 130);
    },
    shotAt,
    doneHold: () => phase === 'done',
    cutsceneLight: (on: boolean, intensity?: number, target?: string) => {
      captureLights();
      if (!lightBaseline) return;
      const apply = (light: BABYLON.Light, base: number) => {
        if (light.isDisposed()) return;
        light.intensity = intensity ?? (on ? base : base * 0.04);
      };
      const id = (target ?? 'all').toLowerCase();
      if (id === 'all' || id === 'hemi') apply(host.hemi, lightBaseline.hemi);
      if (id === 'all' || id === 'sun') apply(host.sun, lightBaseline.sun);
      lightBaseline.points.forEach((base, light) => {
        const meta = light.metadata as { sceneAssetId?: string } | undefined;
        if (id !== 'all' && meta?.sceneAssetId !== target && light.name !== target) return;
        apply(light, base);
      });
    },
    onMesh: (target: string, enabled: boolean, position?: CutsceneVec3) => {
      if (target === 'vat-glass') {
        setVatGlassBroken(!enabled);
        return;
      }
      for (const node of nodesFor(target)) {
        node.setEnabled(enabled);
        if (position && node instanceof BABYLON.TransformNode) {
          node.position.set(position.x, position.y, position.z);
        }
      }
    },
    onObjective: (title?: string, text?: string) => {
      if (!text) return;
      host.setObjective(title ?? 'Objective', text, null);
    },
    onAvatar: (assetId: string) => {
      transformed = assetId === TRANSFORM_HERO_ASSET_ID;
      host.swapAvatar(assetId);
      host.playClip(transformed ? 'rebornidle' : 'idle', true);
      if (transformed) setCarry('changed');
    },
    onCarry: (id: string, name: string, note?: string) => {
      if (copy.carry[id]) {
        setCarry(id);
        return;
      }
      const next = carryOf('sidearm');
      next.push({ id, name, note: note ?? '' });
      host.setCarry(next);
    },
    dressLevel: () => {
      restyleTerminal(false);
      pulseButton(false);
      applyElevatorIndicators(0, false, false);
      applyCabLight(0, false);
    },
  };
};
