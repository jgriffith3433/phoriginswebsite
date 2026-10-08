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
  | 'seat' | 'idle' | 'wait-board' | 'window' | 'alarm' | 'terminal' | 'elevator' | 'ride' | 'done'
  | 'arrive' | 'to-lab' | 'reveal' | 'transform';

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
  playClip: (clip: string, loop: boolean) => void;
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
};

const ELEVATOR_DOOR_L_CLOSED = 43.42;
const ELEVATOR_DOOR_R_CLOSED = 44.58;
const ELEVATOR_DOOR_L_OPEN = 42.42;
const ELEVATOR_DOOR_R_OPEN = 45.58;
const ELEVATOR_POSE = { x: 44.25, z: 21.2, yaw: Math.PI / 2 };
const OFFICE_WINDOW_YAW = 0;
const OFFICE_TERMINAL_POSE = { x: 48.15, z: 43.12, yaw: Math.PI };
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
const CREATURE_FLEE = { x: 1.6, y: 0, z: 32.4 };
const CREATURE_FLEE_YAW = Math.atan2(CREATURE_FLEE.x - CREATURE_HOME.x, CREATURE_FLEE.z - CREATURE_HOME.z);
const CREATURE_FLEE_AT = 8.8;
const CREATURE_FLEE_END = 13.2;

const HIDE_MARKER: SequencePhase[] = ['idle', 'done', 'window', 'terminal', 'ride', 'reveal', 'transform'];
const SHOW_HUD: SequencePhase[] = ['seat', 'wait-board', 'alarm', 'elevator', 'arrive', 'to-lab'];

type LightBaseline = { hemi: number; sun: number; points: Map<BABYLON.Light, number> };

export type Act1 = ReturnType<typeof createAct1>;

export const createAct1 = (host: ActHost) => {
  let phase: SequencePhase = 'idle';
  let boardDeparting = false;
  let windowQueued = false;
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
  let creatureClip: 'idle' | 'walk' | null = null;
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

  const restyleTerminal = (alarming: boolean) => {
    for (const mesh of meshesFor('office-terminal')) {
      const material = mesh.material;
      if (material instanceof BABYLON.PBRMaterial) {
        material.albedoColor = alarming ? new BABYLON.Color3(0.55, 0.08, 0.1) : new BABYLON.Color3(0.08, 0.12, 0.16);
        material.emissiveColor = alarming ? new BABYLON.Color3(0.85, 0.12, 0.14) : new BABYLON.Color3(0.05, 0.22, 0.28);
      } else if (material instanceof BABYLON.StandardMaterial) {
        material.diffuseColor = alarming ? new BABYLON.Color3(0.55, 0.08, 0.1) : new BABYLON.Color3(0.08, 0.12, 0.16);
        material.emissiveColor = alarming ? new BABYLON.Color3(0.85, 0.12, 0.14) : new BABYLON.Color3(0.12, 0.35, 0.42);
      }
    }
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

  const playCreature = (keyword: 'idle' | 'walk', speed = 1) => {
    const root = creatureRoot();
    const groups = (root?.metadata as { clipGroups?: BABYLON.AnimationGroup[] } | undefined)?.clipGroups;
    if (!groups?.length) return;
    const clip = findClip(groups, keyword);
    if (!clip) return;
    if (creatureClip === keyword && clip.isPlaying) {
      clip.speedRatio = speed;
      return;
    }
    for (const group of groups) {
      if (group !== clip && group.isPlaying) group.stop();
    }
    clip.speedRatio = speed;
    if (!clip.isPlaying) clip.start(true);
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
    if (broken) {
      acid.scaling.x = 2.55;
      acid.scaling.z = 2.55;
      acid.position.y = 0.55;
    } else {
      acid.scaling.x = 2.15;
      acid.scaling.z = 2.15;
      acid.position.y = 0.95;
    }
  };

  const stepCreatureFlee = (time: number) => {
    const node = creatureRoot();
    if (!node) return;
    if (time < CREATURE_FLEE_AT) {
      node.setEnabled(true);
      node.position.set(CREATURE_HOME.x, CREATURE_HOME.y, CREATURE_HOME.z);
      node.rotation.y = CREATURE_HOME.yaw;
      playCreature('idle', 1);
      return;
    }
    const span = CREATURE_FLEE_END - CREATURE_FLEE_AT;
    const raw = Math.min(1, Math.max(0, (time - CREATURE_FLEE_AT) / span));
    const eased = raw * raw * (3 - 2 * raw);
    node.setEnabled(raw < 1);
    node.position.x = CREATURE_HOME.x + (CREATURE_FLEE.x - CREATURE_HOME.x) * eased;
    node.position.y = CREATURE_HOME.y;
    node.position.z = CREATURE_HOME.z + (CREATURE_FLEE.z - CREATURE_HOME.z) * eased;
    node.rotation.y = CREATURE_FLEE_YAW;
    playCreature('walk', 1.7);
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
        host.hemi.intensity = 0.34;
        host.sun.intensity = 0.12;
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
    host.refreshHud();
    const card = copy.complete[which];
    host.showMessage(card.title, card.text);
  };

  const beginSeat = () => {
    if (!host.isApex()) return;
    phase = 'seat';
    setCarry('sidearm');
    const data = mission();
    const pose = data ? resolveBoardSeatPose(data, 'chair-head') : null;
    const line = objective('seat');
    host.setObjective(line.title, line.text, { x: pose?.x ?? 50.55, y: 1.85, z: pose?.z ?? 32 });
    syncObjective();
  };

  const beginWalkout = () => {
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
    if (windowQueued || phase === 'window' || phase === 'alarm' || phase === 'terminal' || phase === 'elevator' || phase === 'ride') return;
    windowQueued = true;
    phase = 'window';
    host.hideMarker();
    host.showObjective(false);
    host.beginCutscene('apex-window');
  };

  const beginAlarm = () => {
    phase = 'alarm';
    startAlarm();
    const data = mission();
    const terminal = data ? resolveOfficeTerminal(data) : { x: 48.15, z: 43.05 };
    const line = objective('alarm');
    host.setObjective(line.title, line.text, { x: terminal.x, y: 1.85, z: terminal.z });
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
    if (!host.isB3() || phase === 'reveal' || phase === 'transform' || phase === 'done') return;
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
    host.playFile('/assets/audio/cutscenes/elevator-b3/doors.wav', 0.58);
    placeElevator(0);
    resetCreature();
    setVatGlassBroken(false);
    restoreLights();
    const line = objective('lab');
    host.setObjective(line.title, line.text, { x: B3_LAB_DOOR.x, y: 2.05, z: B3_LAB_DOOR.z });
    syncObjective();
  };

  const beginVat = () => {
    setCreatureVisible(false);
    host.beginCutscene('b3-vat-break');
  };

  const reset = () => {
    boardDeparting = false;
    windowQueued = false;
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
        host.playClip('idle', true);
        resetCreature();
      }
      if (id === 'b3-vat-break') {
        phase = 'transform';
        host.showObjective(false);
        host.hideMarker();
        host.placePierce(9.5, 36.9, -Math.PI / 2 + 0.35);
        host.playClip('idle', true);
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
        beginVat();
        return;
      }
      host.resumeLocomotion();
      syncObjective();
      if (id === 'room-for-grace') beginWalkout();
      if (id === 'apex-window') beginAlarm();
      if (id === 'apex-terminal') beginElevatorObjective();
    },
    onCutsceneFailed: (id: string) => {
      if (id === 'room-for-grace') beginWalkout();
      if (id === 'apex-window') beginAlarm();
      if (id === 'apex-terminal') beginElevatorObjective();
      if (id === 'elevator-b3') finishLevel('apex');
      if (id === 'b3-door-reveal') beginVat();
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
      }
      if (id === 'b3-vat-break') {
        host.placePierce(9.5, 36.9, -Math.PI / 2 + 0.35);
        if (time >= 4.05) setVatGlassBroken(true);
        if (time >= 7.4 && !transformed) {
          transformed = true;
          host.swapAvatar(TRANSFORM_HERO_ASSET_ID);
          host.playClip('idle', true);
          setCarry('changed');
        }
      }
      if (id === 'apex-window' && time >= 42.3) startAlarm();
    },
    afterCamera: (time: number) => {
      if (!elevatorLocked) return;
      if (time < ELEVATOR_RIDE_AT || time > ELEVATOR_ARRIVE_AT + 1.2) return;
      const amp = time >= ELEVATOR_ARRIVE_AT ? 0.006 : 0.02;
      host.camera.position.x += Math.sin(time * 41.3) * amp;
      host.camera.position.y += Math.sin(time * 53.7) * amp * 0.55;
      host.camera.position.z += Math.sin(time * 29.1) * amp * 0.35;
    },
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
      if (phase === 'alarm') {
        const data = mission();
        if (!data) return;
        const terminal = resolveOfficeTerminal(data);
        const player = host.playerXZ();
        if (Math.hypot(player.x - terminal.x, player.z - terminal.z) < 1.35) beginTerminal();
      }
    },
    alarmTick: (delta: number) => {
      if (!alarm.active) return;
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
      host.playClip('idle', true);
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
