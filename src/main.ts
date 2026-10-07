import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders';

import { configureResponsiveUI } from './game/mobile';
import { clearEnemies, type Enemy, spawnEnemy, updateEnemyAI } from './game/enemies';
import {
  clearNpcs,
  remainingDepartingNpcs,
  resolveBoardDoor,
  resolveBoardSeatPose,
  resolveElevator,
  resolveOfficeTerminal,
  resolveOfficeWindow,
  spawnNpcsFromScene,
  startBoardDeparture,
  updateNpcDeparture,
  type Npc,
} from './game/npcs';
import { createPlayerAvatar } from './game/playerAvatar';
import { addItem, createInventoryState, consumeItem, inventorySummary } from './game/inventory';
import { getLevelDefinition, getLevels, getUnlockedLevelCount, loadLevelLibrary } from './game/levels';
import { clampPlayerToArena, createPlayerCollider, createPlayerState, movePlayerOnGround, PLAYER_STAND_Y, playerMeshY, requestJump, updateVerticalMotion } from './game/player';
import { createBurst } from './game/physics';
import { createThirdPersonCamera, lerpAngle } from './game/thirdPersonCamera';
import { createQuestState, getGoalText, updateQuestProgress } from './game/progression';
import { applyTheme, getSceneTheme } from './game/scene';
import { importAssetFile } from './game/importer';
import { PLAYER_ASSET_IDS } from './game/modelLoader';
import { DEFAULT_SCENE_FILE_PATH, loadSceneFromJson, loadSceneFromJsonFile, paintLiftGlyph, readSceneData, type SceneData, type SceneTrigger } from './game/sceneData';
import { createTriggerRunner } from './game/triggers';
import { applyNpcAnim, startCutscene, stepCutscene, stopCutsceneAudio, type ActiveCutscene } from './game/cutscenes';
import { createUnlockedAudio, getSharedAudioContext, installAudioUnlock, unlockAudio } from './game/audioUnlock';
import { createObjectiveMarker } from './game/objectiveMarker';
import type { InventoryItemType, InventoryState, LevelDefinition, ProgressionState, QuestState } from './game/types';

const root = document.getElementById('game-root') as HTMLDivElement;
const healthBar = document.getElementById('healthBar') as HTMLDivElement;
const healthFill = document.getElementById('healthFill') as HTMLSpanElement;
const messageBox = document.getElementById('messageBox') as HTMLDivElement;
const messageTitle = document.getElementById('messageTitle') as HTMLHeadingElement;
const messageText = document.getElementById('messageText') as HTMLParagraphElement;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
const jumpBtn = document.getElementById('jumpBtn') as HTMLButtonElement;
const fireBtn = document.getElementById('fireBtn') as HTMLButtonElement;
const leftStickZone = document.getElementById('leftStickZone') as HTMLDivElement;
const leftStickKnob = document.getElementById('leftStickKnob') as HTMLDivElement;
const rightStickZone = document.getElementById('rightStickZone') as HTMLDivElement | null;
const rightStickKnob = document.getElementById('rightStickKnob') as HTMLDivElement | null;
const loadModelBtn = document.getElementById('loadModelBtn') as HTMLButtonElement;
const modelInput = document.getElementById('modelInput') as HTMLInputElement;
const devToggle = document.getElementById('devToggle') as HTMLButtonElement;
const devPanel = document.getElementById('devPanel') as HTMLDivElement;
const devOutput = document.getElementById('devOutput') as HTMLTextAreaElement;
const devFps = document.getElementById('devFps') as HTMLSpanElement;
const devHealth = document.getElementById('devHealth') as HTMLSpanElement;
const devLevel = document.getElementById('devLevel') as HTMLSpanElement;
const levelSelect = document.getElementById('levelSelect') as HTMLDivElement;
const levelList = document.getElementById('levelList') as HTMLDivElement;
const closeLevelSelectBtn = document.getElementById('closeLevelSelect') as HTMLButtonElement;
const crosshair = document.getElementById('crosshair') as HTMLDivElement;
const inventoryHud = document.getElementById('inventoryHud') as HTMLDivElement;
const inventoryHint = document.getElementById('inventoryHint') as HTMLButtonElement | null;
const inventoryItems = document.getElementById('inventoryItems') as HTMLDivElement;
const inventoryClose = document.getElementById('inventoryClose') as HTMLButtonElement;
const weaponSlot = document.getElementById('weaponSlot') as HTMLButtonElement | null;
const weaponSlotState = document.getElementById('weaponSlotState') as HTMLSpanElement | null;
const objectiveHud = document.getElementById('objectiveHud') as HTMLDivElement | null;
const objectiveText = document.getElementById('objectiveText') as HTMLSpanElement | null;
const objectiveDist = document.getElementById('objectiveDist') as HTMLSpanElement | null;
const alarmFlash = document.getElementById('alarmFlash') as HTMLDivElement | null;

const canvas = document.createElement('canvas');
canvas.style.width = '100%';
canvas.style.height = '100%';
canvas.style.touchAction = 'none';
canvas.style.userSelect = 'none';
root.appendChild(canvas);

const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new BABYLON.Scene(engine);
scene.collisionsEnabled = true;
scene.gravity = BABYLON.Vector3.Zero();

const followCamera = createThirdPersonCamera(scene);
const camera = followCamera.camera;

const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
hemi.intensity = 0.8;

const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -2, 1), scene);
sun.position = new BABYLON.Vector3(12, 18, 6);
sun.intensity = 0.9;

const readDevLevelConfig = () => {
  try {
    const raw = localStorage.getItem('ph-origins-level-config');
    if (!raw) {
      const firstLevel = getLevels()[0];
      if (firstLevel) {
        localStorage.setItem('ph-origins-level-config', JSON.stringify(firstLevel));
        return firstLevel;
      }
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const currentThemeName = typeof readDevLevelConfig()?.theme === 'string' ? (readDevLevelConfig()?.theme ?? 'Neon Drift') : 'Neon Drift';
const initialSceneData = readSceneData();
if (initialSceneData?.theme) {
  applyTheme(scene, initialSceneData.theme);
} else {
  applyTheme(scene, currentThemeName);
}

const sceneLoadOptions = { omitAssetIds: PLAYER_ASSET_IDS, hideTriggers: true };
let sceneNodes: BABYLON.Node[] = [];
let missionScene: SceneData | null = initialSceneData;

const applyLoadedScene = (loaded: Awaited<ReturnType<typeof loadSceneFromJsonFile>>) => {
  if (loaded) {
    sceneNodes = loaded.nodes;
    missionScene = loaded.data;
    applyTheme(scene, loaded.data.theme || currentThemeName);
    return;
  }
  missionScene = initialSceneData;
  sceneNodes = loadSceneFromJson(scene, initialSceneData, sceneLoadOptions);
};

const npcs: Npc[] = [];
let activeCutscene: ActiveCutscene | null = null;
let seatedPierceForCutscene = false;
let windowPierceLocked = false;
let terminalPierceLocked = false;
let boardDeparting = false;
let windowCutsceneQueued = false;
let elevatorCutsceneQueued = false;
let elevatorLocked = false;
// Rest poses left a ~0.09 gap (half-width 0.675). Slide further in so the leaves overlap.
const ELEVATOR_DOOR_L_CLOSED = 43.42;
const ELEVATOR_DOOR_R_CLOSED = 44.58;
const ELEVATOR_DOOR_L_OPEN = 42.42;
const ELEVATOR_DOOR_R_OPEN = 45.58;
let elevatorDoorOpen = 0;
let elevatorFloorIndex = 0;
let elevatorDinged = false;
let elevatorReadoutLabel = '';
let officeAlarmStarted = false;
let sequencePhase: 'seat' | 'idle' | 'wait-board' | 'window' | 'alarm' | 'terminal' | 'elevator' | 'ride' | 'done' = 'idle';
const objectiveMarker = createObjectiveMarker(scene);

const OFFICE_WINDOW_POSE = { x: 48, z: 46.2, yaw: 0 };
const OFFICE_TERMINAL_POSE = { x: 48.15, z: 43.12, yaw: Math.PI };

const placePierceAtTerminal = () => {
  const x = OFFICE_TERMINAL_POSE.x;
  const z = OFFICE_TERMINAL_POSE.z;
  const yaw = OFFICE_TERMINAL_POSE.yaw;
  state.player.x = x;
  state.player.y = PLAYER_STAND_Y;
  state.player.z = z;
  state.player.velocityY = 0;
  state.player.grounded = true;
  state.characterYaw = yaw;
  playerCollider.position.set(x, PLAYER_STAND_Y, z);
  playerAvatar.group.position.set(x, playerMeshY(PLAYER_STAND_Y), z);
  playerAvatar.group.rotation.y = yaw + Math.PI;
};

const placePierceAtOfficeWindow = () => {
  const pose = missionScene ? resolveOfficeWindow(missionScene) : OFFICE_WINDOW_POSE;
  const x = pose.x;
  const z = pose.z;
  const yaw = OFFICE_WINDOW_POSE.yaw;
  state.player.x = x;
  state.player.y = PLAYER_STAND_Y;
  state.player.z = z;
  state.player.velocityY = 0;
  state.player.grounded = true;
  state.characterYaw = yaw;
  playerCollider.position.set(x, PLAYER_STAND_Y, z);
  playerAvatar.group.position.set(x, playerMeshY(PLAYER_STAND_Y), z);
  playerAvatar.group.rotation.y = yaw + Math.PI;
};

const setObjective = (title: string, text: string, target: { x: number; z: number; y?: number } | null) => {
  if (objectiveText) objectiveText.textContent = text;
  if (objectiveHud) {
    const kicker = objectiveHud.querySelector('.objective-kicker') as HTMLElement | null;
    if (kicker) kicker.textContent = title;
  }
  if (target) objectiveMarker.setTarget({ ...target, title, text });
  else objectiveMarker.setTarget(null);
};

const showObjectiveHud = (visible: boolean) => {
  if (!objectiveHud) return;
  objectiveHud.classList.toggle('visible', visible);
};

const isApexPeakLevel = () =>
  getLevelDefinition(state.level).libraryId === 'apex-peak' || missionScene?.id === 'apex-peak';

const refreshObjectivePresentation = () => {
  const hideWorld = state.inCutscene
    || sequencePhase === 'idle'
    || sequencePhase === 'done'
    || sequencePhase === 'window'
    || sequencePhase === 'terminal'
    || sequencePhase === 'ride';
  if (hideWorld) objectiveMarker.hide();
  else objectiveMarker.show();
  const showHud = sequencePhase === 'seat'
    || sequencePhase === 'wait-board'
    || sequencePhase === 'alarm'
    || sequencePhase === 'elevator';
  showObjectiveHud(showHud && !state.inCutscene && state.running);
};

const restyleOfficeTerminal = (alarming: boolean) => {
  const mesh = scene.meshes.find((entry) => entry.metadata?.sceneAssetId === 'office-terminal');
  if (!mesh) return;
  const material = mesh.material;
  if (!(material instanceof BABYLON.StandardMaterial)) return;
  if (alarming) {
    material.diffuseColor = new BABYLON.Color3(0.55, 0.08, 0.1);
    material.emissiveColor = new BABYLON.Color3(0.85, 0.12, 0.14);
  } else {
    material.diffuseColor = new BABYLON.Color3(0.08, 0.12, 0.16);
    material.emissiveColor = new BABYLON.Color3(0.12, 0.35, 0.42);
  }
};

const officeAlarm = {
  active: false,
  wav: null as HTMLAudioElement | null,
  timer: 0,
  pulse: 0,
  start() {
    if (this.active) return;
    this.active = true;
    officeAlarmStarted = true;
    alarmFlash?.classList.add('visible');
    restyleOfficeTerminal(true);
    if (!audio.enabled) return;
    audio.ensure();
    this.wav = createUnlockedAudio('/assets/audio/cutscenes/apex-window/alarm.wav');
    this.wav.loop = true;
    this.wav.volume = 0.62;
    this.wav.addEventListener('error', () => {
      this.wav = null;
    });
    void this.wav.play().catch(() => {
      this.wav = null;
    });
  },
  update(delta: number) {
    if (!this.active) return;
    this.pulse += delta;
    const mesh = scene.meshes.find((entry) => entry.metadata?.sceneAssetId === 'office-terminal');
    const material = mesh?.material;
    if (material instanceof BABYLON.StandardMaterial) {
      const flash = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.pulse * 9));
      material.emissiveColor = new BABYLON.Color3(flash, 0.08, 0.1);
    }
    const wavPlaying = Boolean(this.wav && !this.wav.paused && this.wav.readyState >= 2);
    if (wavPlaying || !audio.enabled) return;
    this.timer += delta;
    if (this.timer < 0.52) return;
    this.timer = 0;
    audio.tone(880, 0.11, 'square', 0.085);
    window.setTimeout(() => audio.tone(620, 0.11, 'square', 0.07), 130);
  },
  stop() {
    this.active = false;
    alarmFlash?.classList.remove('visible');
    if (this.wav) {
      this.wav.pause();
      this.wav.src = '';
      this.wav = null;
    }
    restyleOfficeTerminal(false);
  },
};

const resetApexSequence = () => {
  boardDeparting = false;
  windowCutsceneQueued = false;
  elevatorCutsceneQueued = false;
  windowPierceLocked = false;
  terminalPierceLocked = false;
  elevatorLocked = false;
  officeAlarmStarted = false;
  sequencePhase = 'idle';
  officeAlarm.stop();
  elevatorDoorOpen = 0;
  elevatorFloorIndex = 0;
  elevatorDinged = false;
  elevatorReadoutLabel = '';
  applyElevatorDoors(0);
  applyElevatorIndicators(0, false, false);
  applyElevatorCabLight(0, false);
  objectiveMarker.setTarget(null);
  showObjectiveHud(false);
};

const beginSeatObjective = () => {
  if (!isApexPeakLevel()) return;
  sequencePhase = 'seat';
  const pose = missionScene ? resolveBoardSeatPose(missionScene, 'chair-head') : null;
  const x = pose?.x ?? 50.55;
  const z = pose?.z ?? 32;
  setObjective('Take your seat', 'Join the board', { x, y: 1.85, z });
  refreshObjectivePresentation();
};

const beginBoardWalkout = () => {
  if (!missionScene || boardDeparting || sequencePhase === 'wait-board') return;
  boardDeparting = true;
  sequencePhase = 'wait-board';
  startBoardDeparture(npcs, missionScene);
  const door = resolveBoardDoor(missionScene);
  setObjective('Objective', 'Wait for the board to leave', { x: door.x, y: 2.05, z: door.z });
  refreshObjectivePresentation();
};

const beginWindowCutscene = () => {
  if (windowCutsceneQueued || sequencePhase === 'window' || sequencePhase === 'alarm' || sequencePhase === 'terminal' || sequencePhase === 'elevator' || sequencePhase === 'ride') return;
  windowCutsceneQueued = true;
  sequencePhase = 'window';
  objectiveMarker.hide();
  showObjectiveHud(false);
  beginNamedCutscene('apex-window');
};

const beginAlarmObjective = () => {
  sequencePhase = 'alarm';
  officeAlarm.start();
  const terminal = missionScene
    ? resolveOfficeTerminal(missionScene)
    : { x: 48.15, z: 43.05 };
  setObjective('Objective', 'Investigate the terminal', { x: terminal.x, y: 1.85, z: terminal.z });
  refreshObjectivePresentation();
};

const ELEVATOR_POSE = { x: 44.25, z: 21.2, yaw: Math.PI / 2 };

const sceneMeshById = (id: string) =>
  scene.meshes.find((entry) => entry.metadata?.sceneAssetId === id);

const placePierceInElevator = () => {
  const x = ELEVATOR_POSE.x;
  const z = ELEVATOR_POSE.z;
  const y = PLAYER_STAND_Y;
  const yaw = ELEVATOR_POSE.yaw;
  state.player.x = x;
  state.player.y = y;
  state.player.z = z;
  state.player.velocityY = 0;
  state.player.grounded = true;
  state.characterYaw = yaw;
  playerCollider.position.set(x, y, z);
  playerAvatar.group.position.set(x, playerMeshY(y), z);
  playerAvatar.group.rotation.y = yaw + Math.PI;
};

const pulseB3Button = (lit: boolean) => {
  const mesh = sceneMeshById('lift-b3-button');
  const material = mesh?.material;
  if (!(material instanceof BABYLON.StandardMaterial)) return;
  if (lit) {
    material.diffuseColor = new BABYLON.Color3(0.95, 0.35, 0.12);
    material.emissiveColor = new BABYLON.Color3(1, 0.45, 0.08);
  } else {
    material.diffuseColor = new BABYLON.Color3(0.18, 0.2, 0.22);
    material.emissiveColor = new BABYLON.Color3(0.08, 0.1, 0.12);
  }
};

const LIFT_FLOOR_LEDS = [
  'lift-ind-58',
  'lift-ind-40',
  'lift-ind-20',
  'lift-ind-L',
  'lift-ind-B1',
  'lift-ind-B2',
  'lift-ind-B3',
] as const;

const LIFT_FLOOR_LABELS = ['58', '40', '20', 'L', 'B1', 'B2', 'B3'] as const;

const ELEVATOR_DOOR_CLOSE_AT = 3.3;
const ELEVATOR_RIDE_AT = 7.2;
const ELEVATOR_ARRIVE_AT = 64.5;
const ELEVATOR_DING_AT = 65.4;
const LIFT_FLOOR_AT = [0, 16, 26, 36, 46, 56, 64.5];

const elevatorFloorAt = (time: number) => {
  let index = 0;
  for (let i = 0; i < LIFT_FLOOR_AT.length; i++) {
    if (time >= LIFT_FLOOR_AT[i]) index = i;
  }
  return index;
};

const glowMesh = (id: string, diffuse: BABYLON.Color3, emissive: BABYLON.Color3) => {
  const mesh = sceneMeshById(id);
  const material = mesh?.material;
  if (!(material instanceof BABYLON.StandardMaterial)) return;
  material.diffuseColor = diffuse;
  material.emissiveColor = emissive;
};

const applyElevatorIndicators = (floorIndex: number, descending: boolean, arrived: boolean, time = 0) => {
  glowMesh('lift-ind-panel', new BABYLON.Color3(0.04, 0.05, 0.06), new BABYLON.Color3(0.02, 0.03, 0.04));
  const flicker = descending && !arrived && Math.sin(time * 31.4) * Math.sin(time * 5.7) > 0.62;
  LIFT_FLOOR_LEDS.forEach((id, index) => {
    const active = index === floorIndex;
    const basement = index === 6 && active;
    if (!active) {
      glowMesh(id, new BABYLON.Color3(0.12, 0.13, 0.14), new BABYLON.Color3(0.08, 0.09, 0.1));
      return;
    }
    if (flicker) {
      glowMesh(id, new BABYLON.Color3(0.16, 0.12, 0.06), new BABYLON.Color3(0.18, 0.1, 0.04));
      return;
    }
    if (basement) {
      glowMesh(id, new BABYLON.Color3(1, 0.28, 0.1), new BABYLON.Color3(1, 0.28, 0.08));
      return;
    }
    glowMesh(id, new BABYLON.Color3(1, 0.78, 0.22), new BABYLON.Color3(1, 0.72, 0.18));
  });
  const arrowOn = descending || arrived;
  const blink = descending && !arrived && Math.sin(time * 8.5) > 0;
  if (arrowOn && (arrived || blink) && !flicker) {
    glowMesh('lift-ind-down', new BABYLON.Color3(0.35, 1, 0.45), new BABYLON.Color3(0.2, 1, 0.28));
  } else {
    glowMesh('lift-ind-down', new BABYLON.Color3(0.1, 0.14, 0.12), new BABYLON.Color3(0.06, 0.08, 0.06));
  }
  const label = LIFT_FLOOR_LABELS[floorIndex] ?? '58';
  const readout = sceneMeshById('lift-ind-readout');
  if (label !== elevatorReadoutLabel) {
    elevatorReadoutLabel = label;
    paintLiftGlyph(readout, label, '#ffffff');
  }
  if (flicker) {
    glowMesh('lift-ind-readout', new BABYLON.Color3(0.12, 0.1, 0.06), new BABYLON.Color3(0.1, 0.08, 0.04));
  } else if (arrived) {
    glowMesh('lift-ind-readout', new BABYLON.Color3(1, 0.32, 0.1), new BABYLON.Color3(1, 0.3, 0.08));
  } else {
    glowMesh('lift-ind-readout', new BABYLON.Color3(1, 0.82, 0.28), new BABYLON.Color3(1, 0.75, 0.2));
  }
};

const cabLightById = () =>
  scene.lights.find((entry) => (entry.metadata as { sceneAssetId?: string } | undefined)?.sceneAssetId === 'light-lift');

const applyElevatorCabLight = (time: number, riding: boolean) => {
  const light = cabLightById();
  const ceiling = sceneMeshById('ceil-lift');
  const ceilingMat = ceiling?.material;
  if (!riding) {
    if (light) light.intensity = 0.52;
    if (ceilingMat instanceof BABYLON.StandardMaterial) {
      ceilingMat.emissiveColor = new BABYLON.Color3(0.12, 0.12, 0.13);
    }
    return;
  }
  const arrived = time >= ELEVATOR_ARRIVE_AT;
  const flicker = time >= ELEVATOR_RIDE_AT && time < ELEVATOR_ARRIVE_AT && (Math.sin(time * 23.4) * Math.sin(time * 4.1) > 0.72);
  const dim = arrived ? 0.08 : flicker ? 0.12 : 0.38 + 0.06 * Math.sin(time * 7.2);
  if (light) light.intensity = dim;
  if (ceilingMat instanceof BABYLON.StandardMaterial) {
    const glow = arrived ? 0.02 : flicker ? 0.04 : 0.18;
    ceilingMat.emissiveColor = new BABYLON.Color3(glow, glow * (arrived ? 0.4 : 0.95), glow * (arrived ? 0.3 : 0.9));
  }
};

const tickElevatorFloor = (index: number, arrived: boolean) => {
  if (!audio.enabled) return;
  if (arrived) {
    audio.tone(392, 0.12, 'sine', 0.07);
    window.setTimeout(() => audio.tone(587, 0.22, 'sine', 0.08), 90);
    return;
  }
  audio.tone(620 - index * 28, 0.07, 'square', 0.045);
};

const applyElevatorDoors = (openAmount: number) => {
  const t = Math.max(0, Math.min(1, openAmount));
  const doorL = sceneMeshById('lift-door-l');
  const doorR = sceneMeshById('lift-door-r');
  if (doorL) {
    doorL.position.x = ELEVATOR_DOOR_L_CLOSED + (ELEVATOR_DOOR_L_OPEN - ELEVATOR_DOOR_L_CLOSED) * t;
    doorL.checkCollisions = t < 0.45;
  }
  if (doorR) {
    doorR.position.x = ELEVATOR_DOOR_R_CLOSED + (ELEVATOR_DOOR_R_OPEN - ELEVATOR_DOOR_R_CLOSED) * t;
    doorR.checkCollisions = t < 0.45;
  }
};

const applyElevatorRideFeel = (time: number) => {
  if (time < ELEVATOR_RIDE_AT || time > ELEVATOR_ARRIVE_AT + 1.2) return;
  const amp = time >= ELEVATOR_ARRIVE_AT ? 0.006 : 0.02;
  const cam = followCamera.camera;
  cam.position.x += Math.sin(time * 41.3) * amp;
  cam.position.y += Math.sin(time * 53.7) * amp * 0.55;
  cam.position.z += Math.sin(time * 29.1) * amp * 0.35;
};

const stepElevatorSet = (time: number) => {
  // Cab/cart stay put. Descent is doors, B3 button, floor LEDs, readout, light flicker, and a light rumble on the camera.
  const closeT = Math.min(1, Math.max(0, (time - ELEVATOR_DOOR_CLOSE_AT) / 1.5));
  elevatorDoorOpen = 1 - closeT;
  applyElevatorDoors(elevatorDoorOpen);
  pulseB3Button(time >= 2.35);
  const descending = time >= ELEVATOR_RIDE_AT && time < ELEVATOR_ARRIVE_AT;
  const arrived = time >= ELEVATOR_ARRIVE_AT;
  const floorIndex = elevatorFloorAt(time);
  if (floorIndex !== elevatorFloorIndex) {
    elevatorFloorIndex = floorIndex;
    tickElevatorFloor(floorIndex, false);
  }
  if (arrived && !elevatorDinged && time >= ELEVATOR_DING_AT) {
    elevatorDinged = true;
    tickElevatorFloor(6, true);
  }
  applyElevatorIndicators(floorIndex, descending, arrived, time);
  applyElevatorCabLight(time, true);
  placePierceInElevator();
};

const beginElevatorObjective = () => {
  sequencePhase = 'elevator';
  officeAlarm.stop();
  const lift = missionScene ? resolveElevator(missionScene) : { x: 44, z: 21.35 };
  setObjective('Objective', 'Get to the elevator', { x: lift.x, y: 2.15, z: lift.z });
  refreshObjectivePresentation();
};

const beginTerminalBeat = () => {
  if (sequencePhase !== 'alarm') return;
  sequencePhase = 'terminal';
  objectiveMarker.hide();
  showObjectiveHud(false);
  beginNamedCutscene('apex-terminal');
};

const completeApexPeak = () => {
  const alreadyDone = sequencePhase === 'done';
  sequencePhase = 'done';
  elevatorLocked = false;
  officeAlarm.stop();
  objectiveMarker.setTarget(null);
  showObjectiveHud(false);
  clearInputState();
  playerAvatar.setLocomotion(false, true);
  playerAvatar.playClip('idle', true);
  state.running = false;
  if (alreadyDone) return;
  state.progression.highestUnlocked = getUnlockedLevelCount(Math.max(state.progression.highestUnlocked, state.level + 1));
  saveGame({ unlocked: Math.max(save.unlocked ?? 1, state.progression.highestUnlocked), sound: audio.enabled });
  audio.win();
  updateHud();
    showMessage('Level Complete', 'Apex Peak Act I is done. Later missions are coming soon.');
};

const beginElevatorCutscene = () => {
  if (elevatorCutsceneQueued || sequencePhase === 'ride' || sequencePhase !== 'elevator') return;
  elevatorCutsceneQueued = true;
  sequencePhase = 'ride';
  elevatorLocked = true;
  objectiveMarker.hide();
  showObjectiveHud(false);
  placePierceInElevator();
  beginNamedCutscene('elevator-b3');
};

const cineHud = document.createElement('div');
cineHud.style.cssText = 'position:absolute;left:0;right:0;bottom:11%;text-align:center;pointer-events:none;z-index:24;display:none;';
cineHud.innerHTML = '<div style="font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#7af0c9;margin-bottom:8px;"></div><div style="font-size:18px;color:#eefaff;text-shadow:0 2px 16px #000;"></div>';
root.appendChild(cineHud);
const cineTitle = cineHud.children[0] as HTMLDivElement;
const cineText = cineHud.children[1] as HTMLDivElement;

const showCineHud = (title?: string, text?: string) => {
  cineTitle.textContent = title ?? '';
  cineText.textContent = text ?? '';
  cineHud.style.display = title || text ? 'block' : 'none';
};

const resetCutsceneState = () => {
  stopCutsceneAudio(activeCutscene);
  activeCutscene = null;
  state.inCutscene = false;
  seatedPierceForCutscene = false;
  windowPierceLocked = false;
  terminalPierceLocked = false;
  elevatorLocked = false;
  followCamera.clearCinematic();
  showCineHud();
};

const PLAYER_HEAD_CHAIR_ID = 'chair-head';

const seatPlayerAtHeadChair = () => {
  const pose = missionScene ? resolveBoardSeatPose(missionScene, PLAYER_HEAD_CHAIR_ID) : null;
  if (!pose) return;
  state.player.x = pose.x;
  state.player.y = PLAYER_STAND_Y;
  state.player.z = pose.z;
  state.player.velocityY = 0;
  state.player.grounded = true;
  state.characterYaw = pose.facingYaw;
  playerCollider.position.set(pose.x, PLAYER_STAND_Y, pose.z);
  playerAvatar.group.position.set(pose.x, pose.visualY, pose.z);
  playerAvatar.group.rotation.y = pose.facingYaw + Math.PI;
  playerAvatar.playClip('sit', true);
};

const leavePlayerAtHeadChair = () => {
  const pose = missionScene ? resolveBoardSeatPose(missionScene, PLAYER_HEAD_CHAIR_ID) : null;
  if (!pose) return;
  const x = pose.x - 0.55;
  const z = pose.z - 1.15;
  state.player.x = x;
  state.player.y = PLAYER_STAND_Y;
  state.player.z = z;
  state.player.velocityY = 0;
  state.player.grounded = true;
  state.characterYaw = pose.facingYaw;
  playerCollider.position.set(x, PLAYER_STAND_Y, z);
  playerAvatar.group.position.set(x, playerMeshY(PLAYER_STAND_Y), z);
  playerAvatar.group.rotation.y = pose.facingYaw + Math.PI;
};

const endCutscene = () => {
  const finishedId = activeCutscene?.id;
  if (seatedPierceForCutscene) leavePlayerAtHeadChair();
  resetCutsceneState();
  if (finishedId === 'elevator-b3') {
    completeApexPeak();
    return;
  }
  playerAvatar.resumeLocomotion();
  refreshObjectivePresentation();
  if (finishedId === 'room-for-grace') beginBoardWalkout();
  if (finishedId === 'apex-window') beginAlarmObjective();
  if (finishedId === 'apex-terminal') beginElevatorObjective();
};

const beginNamedCutscene = (id: string) => {
  if (state.inCutscene) return;
  state.inCutscene = true;
  if (id === 'room-for-grace') {
    seatedPierceForCutscene = true;
    sequencePhase = 'idle';
    showObjectiveHud(false);
    objectiveMarker.hide();
    seatPlayerAtHeadChair();
  }
  if (id === 'apex-window') {
    windowPierceLocked = true;
    sequencePhase = 'window';
    showObjectiveHud(false);
    objectiveMarker.hide();
    placePierceAtOfficeWindow();
    playerAvatar.playClip('idle', true);
  }
  if (id === 'apex-terminal') {
    terminalPierceLocked = true;
    sequencePhase = 'terminal';
    showObjectiveHud(false);
    objectiveMarker.hide();
    placePierceAtTerminal();
    playerAvatar.playClip('idle', true);
  }
  if (id === 'elevator-b3') {
    elevatorLocked = true;
    sequencePhase = 'ride';
    showObjectiveHud(false);
    objectiveMarker.hide();
    placePierceInElevator();
    playerAvatar.playClip('idle', true);
  }
  unlockPointer();
  void startCutscene(id, {
    onCamera: (position, lookAt) => followCamera.setCinematic(position, lookAt),
    onHud: (title, text) => showCineHud(title, text),
    onAnim: (actor, clip, loop) => applyNpcAnim(npcs, actor, clip, loop, playerAvatar),
    audioEnabled: () => audio.enabled,
  }).then((next) => {
    if (!next) {
      endCutscene();
      if (id === 'room-for-grace') beginBoardWalkout();
      if (id === 'apex-window') beginAlarmObjective();
      if (id === 'apex-terminal') beginElevatorObjective();
      if (id === 'elevator-b3') completeApexPeak();
      return;
    }
    activeCutscene = next;
    if (seatedPierceForCutscene) seatPlayerAtHeadChair();
    if (windowPierceLocked) placePierceAtOfficeWindow();
    if (terminalPierceLocked) placePierceAtTerminal();
    if (elevatorLocked) placePierceInElevator();
  });
};

const triggerRunner = createTriggerRunner((trigger: SceneTrigger) => {
  if (trigger.id === 'trigger-elevator-b3') {
    beginElevatorCutscene();
    return;
  }
  const cutsceneId = trigger.type === 'cutscene'
    ? String(trigger.data?.cutscene ?? trigger.id)
    : typeof trigger.data?.cutscene === 'string'
      ? trigger.data.cutscene
      : null;
  if (cutsceneId) beginNamedCutscene(cutsceneId);
});

const loadMissionScene = async (path: string) => {
  clearNpcs(npcs);
  clearEnemies(enemies);
  resetApexSequence();
  resetCutsceneState();
  const loaded = await loadSceneFromJsonFile(scene, path, { ...sceneLoadOptions, replaceNodes: sceneNodes });
  applyLoadedScene(loaded);
  triggerRunner.bind(loaded?.data.triggers ?? []);
  if (loaded?.data) npcs.push(...spawnNpcsFromScene(scene, loaded.data));
  restyleOfficeTerminal(false);
  pulseB3Button(false);
  applyElevatorIndicators(0, false, false);
  applyElevatorCabLight(0, false);
  beginSeatObjective();
};

const saveKey = 'ph-origins-save';
type SaveData = { unlocked: number; sound: boolean };
const defaultSave: SaveData = { unlocked: 1, sound: true };
const MAX_HEALTH = 100;

const GAME_COPY = {
  intro: 'Get ready to embark on an exciting journey!',
  missionClear: 'Keep pushing into the next mission.',
  defeat: 'Press Start to retry.',
  reset: 'Get ready to embark on an exciting journey!',
} as const;

const loadSave = (): SaveData => {
  try {
    const raw = localStorage.getItem(saveKey);
    if (!raw) return defaultSave;
    return { ...defaultSave, ...JSON.parse(raw) };
  } catch {
    return defaultSave;
  }
};

const saveGame = (next: Partial<SaveData>) => {
  const current = loadSave();
  const merged = { ...current, ...next };
  localStorage.setItem(saveKey, JSON.stringify(merged));
  return merged;
};

const save = loadSave();

const devLevelConfig = readDevLevelConfig();

const state = {
  running: false,
  health: MAX_HEALTH,
  level: 1,
  wave: 1,
  kills: 0,
  lastSpawn: 0,
  lastDamageAt: 0,
  shootCooldown: 0,
  playerSpeed: 3.4,
  fireRate: Number(devLevelConfig?.fireRate) || 0.14,
  enemyHpMultiplier: Number(devLevelConfig?.enemyHp) || 1,
  spawnInterval: Number(devLevelConfig?.spawnRate) || 1.4,
  arenaSize: Number(devLevelConfig?.arenaSize) || 90,
  pointerLocked: false,
  mouseLookActive: false,
  characterYaw: 0,
  lookStickDragging: false,
  progression: {
    currentLevel: 1,
    highestUnlocked: getUnlockedLevelCount(save.unlocked ?? 1),
    xp: 0,
    medals: 0,
  } satisfies ProgressionState,
  quests: createQuestState() satisfies QuestState[],
  inventory: createInventoryState() satisfies InventoryState,
  player: createPlayerState(),
  input: {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
  },
  movementVector: { x: 0, y: 0 },
  fireHeld: false,
  stickDragging: false,
  inCutscene: false,
};

const enemies: Enemy[] = [];
const particles: Array<{ mesh: BABYLON.Mesh; velocity: BABYLON.Vector3; life: number }> = [];
const pickups: Array<{ mesh: BABYLON.Mesh; item: InventoryItemType; amount: number; active: boolean }> = [];
const playerAvatar = createPlayerAvatar(scene);
playerAvatar.group.rotation.y = Math.PI;
const playerCollider = createPlayerCollider(scene);

const audio = {
  enabled: save.sound,
  ctx: undefined as AudioContext | undefined,
  ensure() {
    unlockAudio();
    this.ctx = getSharedAudioContext();
  },
  tone(frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.04) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
    osc.stop(this.ctx.currentTime + duration);
  },
  hit() { this.tone(170, 0.18, 'square', 0.08); },
  shoot() { this.tone(600, 0.08, 'triangle', 0.05); },
  pickup() { this.tone(780, 0.12, 'sine', 0.06); },
  start() { this.tone(440, 0.1, 'sine', 0.05); this.tone(660, 0.13, 'triangle', 0.04); },
  win() { this.tone(530, 0.1, 'triangle', 0.06); this.tone(780, 0.18, 'triangle', 0.06); },
};

const updateHud = () => {
  const healthPct = Math.max(0, Math.min(100, (state.health / MAX_HEALTH) * 100));
  const healthBand = healthPct > 75 ? 'high' : healthPct >= 35 ? 'mid' : 'low';
  healthFill.style.width = `${healthPct}%`;
  healthFill.dataset.band = healthBand;
  healthBar.setAttribute('aria-valuenow', String(Math.round(healthPct)));
  devFps.textContent = `${Math.max(0, Math.round(engine.getFps()))}`;
  devHealth.textContent = Math.max(0, Math.ceil(state.health)).toString();
  devLevel.textContent = state.level.toString();

  const invEntries = [
    ['Ammo', state.inventory.items.ammo ?? 0],
    ['Medkit', state.inventory.items.medkit ?? 0],
    ['Scrap', state.inventory.items.scrap ?? 0],
    ['Core', state.inventory.items.power_core ?? 0],
  ] as const;
  inventoryItems.innerHTML = invEntries
    .map(([label, count]) => `<span class="inventory-item"><span class="inventory-label">${label}</span><strong>${count}</strong></span>`)
    .join('');

  if (weaponSlot && weaponSlotState) {
    const drawn = state.player.weaponDrawn;
    weaponSlotState.textContent = drawn ? 'Drawn' : 'Holstered';
    weaponSlot.classList.toggle('drawn', drawn);
    weaponSlot.setAttribute('aria-pressed', drawn ? 'true' : 'false');
    weaponSlot.disabled = weaponBusy || !state.running || state.inCutscene;
  }
};

let inventoryOpen = false;
let weaponBusy = false;

const canLockGameplayPointer = () =>
  state.running && !state.inCutscene && messageBox.classList.contains('hidden') && !inventoryOpen;

const lockGameplayPointer = () => {
  if (!canLockGameplayPointer()) return;
  void canvas.requestPointerLock();
};

const setInventoryOpen = (open: boolean) => {
  inventoryOpen = open;
  inventoryHud.classList.toggle('open', open);
  if (open) {
    unlockPointer();
    canvas.style.cursor = 'default';
    root.style.cursor = 'default';
  } else {
    canvas.style.cursor = '';
    root.style.cursor = '';
    if (!state.inCutscene) lockGameplayPointer();
  }
  updateCrosshairVisibility();
};

const stopInventoryPointer = (event: Event) => {
  event.stopPropagation();
};

inventoryClose.addEventListener('click', (event) => {
  event.stopPropagation();
  setInventoryOpen(false);
});
inventoryHint?.addEventListener('click', (event) => {
  event.stopPropagation();
  event.preventDefault();
  setInventoryOpen(!inventoryOpen);
});
inventoryHud.addEventListener('pointerdown', stopInventoryPointer);
inventoryHud.addEventListener('pointerup', stopInventoryPointer);

const syncStartButtonLabel = () => {
  const shouldContinue = state.running;
  startBtn.textContent = shouldContinue ? 'Continue' : 'Start';
};

const unlockPointer = () => {
  if (document.pointerLockElement === canvas) {
    document.exitPointerLock();
  }
  state.pointerLocked = false;
  state.mouseLookActive = false;
};

const updateCrosshairVisibility = () => {
  const visible = state.running
    && state.player.weaponDrawn
    && !inventoryOpen
    && messageBox.classList.contains('hidden');
  crosshair.style.display = visible ? 'block' : 'none';
};

const finishWeaponToggle = (drawn: boolean) => {
  state.player.weaponDrawn = drawn;
  playerAvatar.setArmed(drawn);
  weaponBusy = false;
  playerAvatar.resumeLocomotion();
  updateHud();
  updateCrosshairVisibility();
};

const toggleWeapon = () => {
  if (!state.running || state.inCutscene || weaponBusy) return;
  const drawing = !state.player.weaponDrawn;
  weaponBusy = true;
  followCamera.setOverShoulder(drawing);
  if (!drawing) {
    state.player.weaponDrawn = false;
    updateCrosshairVisibility();
  }
  updateHud();
  const keyword = drawing ? 'draw' : 'holster';
  const played = playerAvatar.playClip(keyword, false, 4, () => finishWeaponToggle(drawing));
  if (!played) finishWeaponToggle(drawing);
  setInventoryOpen(false);
};

weaponSlot?.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleWeapon();
});

const showMessage = (title: string, text: string) => {
  messageTitle.textContent = title;
  messageText.textContent = text;
  const isEndState = title === 'Defeat' || title === 'Mission Clear';
  loadModelBtn.textContent = 'Load Level';
  loadModelBtn.style.display = isEndState ? 'none' : '';
  syncStartButtonLabel();
  unlockPointer();
  levelSelect.classList.add('hidden');
  messageBox.classList.remove('hidden');
  updateCrosshairVisibility();
};

const hideMessage = () => {
  messageBox.classList.add('hidden');
  updateCrosshairVisibility();
};

const clearDynamicObjects = () => {
  clearEnemies(enemies);
  for (const particle of particles) {
    particle.mesh.dispose();
  }
  for (const pickup of pickups) {
    pickup.mesh.dispose();
  }
  particles.length = 0;
  pickups.length = 0;
};

const applyLevelCombat = (config: LevelDefinition) => {
  state.playerSpeed = config.playerSpeed;
  state.fireRate = config.fireRate;
  state.enemyHpMultiplier = config.enemyHp;
  state.spawnInterval = config.spawnRate;
  state.arenaSize = config.arenaSize || 90;
};

const applyLevelConfig = (config: LevelDefinition) => {
  applyLevelCombat(config);
  applyTheme(scene, config.theme);
};

const resetPlayer = (keepLevel = false) => {
  const selectedLevel = keepLevel ? Math.max(1, state.level) : 1;
  state.player = createPlayerState();
  state.level = selectedLevel;
  state.wave = 1;
  state.health = MAX_HEALTH;
  state.shootCooldown = 0;
  state.lastDamageAt = 0;
  state.kills = 0;
  weaponBusy = false;
  state.player.weaponDrawn = false;
  playerAvatar.setArmed(false);
  playerAvatar.resumeLocomotion();
  followCamera.setOverShoulder(false);
  state.progression.currentLevel = selectedLevel;
  state.progression.highestUnlocked = getUnlockedLevelCount(Math.max(1, state.progression.highestUnlocked));
  state.inventory = createInventoryState();
  state.quests = createQuestState();
  state.characterYaw = 0;
  applyLevelConfig(getLevelDefinition(selectedLevel));
  followCamera.reset();
};

const beginGame = () => {
  audio.start();
  state.running = true;
  clearDynamicObjects();
  resetPlayer(true);
  syncStartButtonLabel();
  updateHud();
  hideMessage();
  if (isApexPeakLevel() && (sequencePhase === 'idle' || sequencePhase === 'done' || sequencePhase === 'seat')) {
    beginSeatObjective();
  } else {
    refreshObjectivePresentation();
  }
};

void (async () => {
  await loadLevelLibrary();
  const firstLevel = getLevels()[0];
  if (firstLevel) applyLevelConfig(firstLevel);
  await loadMissionScene(firstLevel?.path ?? DEFAULT_SCENE_FILE_PATH);
  if (new URLSearchParams(location.search).get('cutscene') === 'elevator-b3') {
    sequencePhase = 'elevator';
    beginGame();
    beginElevatorCutscene();
  }
})().catch(() => applyLoadedScene(null));

const spawnPickup = (position: BABYLON.Vector3, item: InventoryItemType, amount = 1) => {
  const colorMap: Record<InventoryItemType, BABYLON.Color3> = {
    medkit: new BABYLON.Color3(0.2, 1, 0.5),
    ammo: new BABYLON.Color3(0.8, 0.9, 1),
    scrap: new BABYLON.Color3(1, 0.75, 0.2),
    power_core: new BABYLON.Color3(0.7, 0.3, 1),
  };

  const mesh = BABYLON.MeshBuilder.CreateSphere(`pickup-${Math.random()}`, { diameter: 0.8 }, scene);
  mesh.position = position.clone();
  const material = new BABYLON.StandardMaterial(`pickup-mat-${Math.random()}`, scene);
  material.diffuseColor = colorMap[item];
  material.emissiveColor = colorMap[item].scale(0.4);
  mesh.material = material;
  pickups.push({ mesh, item, amount, active: true });
};

const updateQuestTracker = () => {
  const activeQuest = state.quests.find((quest) => !quest.completed) ?? state.quests[state.quests.length - 1];
  if (!activeQuest) return;
  const label = getGoalText(activeQuest);
  devOutput.value = `${inventorySummary(state.inventory)} • ${label}`;
  if (activeQuest.completed && state.quests.every((quest) => quest.completed)) {
    messageText.textContent = 'Mission complete: the zone is secure.';
  }
};

const finishGame = (won = false) => {
  state.running = false;
  saveGame({ unlocked: Math.max(save.unlocked ?? 1, state.progression.highestUnlocked), sound: audio.enabled });
  updateHud();

  if (won) {
    audio.win();
    showMessage('Mission Clear', GAME_COPY.missionClear);
  } else {
    audio.hit();
    showMessage('Defeat', GAME_COPY.defeat);
  }
};

const awardQuestProgress = (type: 'kills' | 'score' | 'collect', amount: number) => {
  const quest = state.quests.find((entry) => !entry.completed && entry.type === type) ?? state.quests.find((entry) => !entry.completed);
  if (!quest) return;

  updateQuestProgress(quest, amount);
  if (quest.completed && quest.rewardItem && quest.rewardAmount) {
    addItem(state.inventory, quest.rewardItem, quest.rewardAmount);
    state.progression.xp += 40;
    state.progression.medals += 1;
    showMessage('Mission Update', `${quest.title} complete • +${quest.rewardAmount} ${quest.rewardItem}`);
    audio.pickup();
  }
};

const handleLook = (dx: number, dy: number) => {
  followCamera.addLook(dx, dy);
};

const clearInputState = () => {
  state.input.forward = false;
  state.input.backward = false;
  state.input.left = false;
  state.input.right = false;
  state.input.jump = false;
  state.movementVector.x = 0;
  state.movementVector.y = 0;
  leftStickKnob.style.left = '50%';
  leftStickKnob.style.top = '50%';
  leftStickKnob.style.transform = 'translate(-50%, -50%)';
  state.stickDragging = false;
  state.lookStickDragging = false;
  followCamera.setLookStick(0, 0);
  if (rightStickKnob) {
    rightStickKnob.style.left = '50%';
    rightStickKnob.style.top = '50%';
    rightStickKnob.style.transform = 'translate(-50%, -50%)';
  }
};

const gatherCameraIgnoreMeshes = () => {
  const ignored: BABYLON.AbstractMesh[] = [
    playerCollider,
    ...playerAvatar.group.getChildMeshes(true),
  ];
  for (const particle of particles) ignored.push(particle.mesh);
  for (const pickup of pickups) ignored.push(pickup.mesh);
  for (const enemy of enemies) {
    ignored.push(enemy.mesh);
    enemy.root.getChildMeshes(true).forEach((mesh) => ignored.push(mesh));
  }
  for (const npc of npcs) {
    ignored.push(npc.mesh);
    npc.avatar.group.getChildMeshes(true).forEach((mesh) => ignored.push(mesh));
  }
  return ignored;
};

const updateCamera = (delta: number, moving = false, moveHeading: number | null = null) => {
  followCamera.update(delta, state.player, moving, moveHeading, gatherCameraIgnoreMeshes());

  if (state.inCutscene) return;
  playerAvatar.group.rotation.y = state.characterYaw + Math.PI;
  playerAvatar.group.position = new BABYLON.Vector3(state.player.x, playerMeshY(state.player.y), state.player.z);
};

const updatePlayer = (delta: number) => {
  if (state.inCutscene) {
    state.player.jumpWindup = 0;
    playerCollider.position.set(state.player.x, state.player.y, state.player.z);
    return { moving: false, moveHeading: null };
  }
  const yaw = followCamera.getYaw();
  const forward = new BABYLON.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new BABYLON.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  let moveX = 0;
  let moveZ = 0;

  if (state.input.right) moveX += 1;
  if (state.input.left) moveX -= 1;
  if (state.input.forward) moveZ += 1;
  if (state.input.backward) moveZ -= 1;

  moveX += state.movementVector.x;
  moveZ += -state.movementVector.y;

  const desiredMove = forward.scale(moveZ).add(right.scale(moveX));
  if (desiredMove.lengthSquared() > 0) {
    desiredMove.normalize();
    const speed = state.playerSpeed;
    movePlayerOnGround(state.player, playerCollider, desiredMove.x * speed * delta, desiredMove.z * speed * delta);
  } else {
    playerCollider.position.set(state.player.x, state.player.y, state.player.z);
  }

  const walkMagnitude = Math.hypot(moveX, moveZ);
  const moving = walkMagnitude > 0.05;
  const moveHeading = desiredMove.lengthSquared() > 0
    ? Math.atan2(desiredMove.x, desiredMove.z)
    : null;

  clampPlayerToArena(state.player, state.arenaSize);
  updateVerticalMotion(state.player, delta, playerCollider);

  if (state.input.jump) {
    if (requestJump(state.player)) {
      audio.tone(360, 0.12, 'triangle', 0.04);
    }
    // One-shot: Space and the on-screen button share this path. Consume even on
    // miss so a press during windup or in air cannot queue a second hop.
    state.input.jump = false;
  }

  const facingTarget = followCamera.isLooking() || !moving || moveHeading === null
    ? followCamera.getYaw()
    : moveHeading;
  state.characterYaw = lerpAngle(state.characterYaw, facingTarget, 1 - Math.exp(-(followCamera.isLooking() ? 18 : 10) * Math.min(delta, 0.05)));

  const jumpAnim = !state.player.grounded || state.player.jumpWindup > 0;
  playerAvatar.setLocomotion(moving, !jumpAnim);

  const forwardDot = moveHeading === null ? 0 : Math.sin(yaw) * Math.sin(moveHeading) + Math.cos(yaw) * Math.cos(moveHeading);
  return { moving, moveHeading: moving && forwardDot > 0.45 ? moveHeading : null };
};

const fireWeapon = () => {
  if (!state.running || state.inCutscene || inventoryOpen || weaponBusy || !state.player.weaponDrawn || state.shootCooldown > 0) return;
  if (!consumeItem(state.inventory, 'ammo', 1)) {
    audio.hit();
    return;
  }
  state.shootCooldown = state.fireRate;
  audio.shoot();
  playerAvatar.playClip('shoot', false, 3, () => playerAvatar.resumeLocomotion());
};

const levelAllowsCombat = () => {
  const config = getLevelDefinition(state.level);
  return config.combat === true && config.libraryId !== 'apex-peak' && config.enemyCount > 0;
};

const spawnWaveEnemy = () => {
  if (!levelAllowsCombat()) return;
  const enemy = spawnEnemy(scene, state.level);
  enemy.hp = Math.max(1, state.level * state.enemyHpMultiplier);
  const angle = Math.random() * Math.PI * 2;
  const distance = 8 + Math.random() * 6;
  enemy.mesh.position = new BABYLON.Vector3(Math.cos(angle) * distance, PLAYER_STAND_Y, Math.sin(angle) * distance);
  enemies.push(enemy);
};

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (key === 'w' || key === 'arrowup') state.input.forward = true;
  if (key === 's' || key === 'arrowdown') state.input.backward = true;
  if (key === 'a' || key === 'arrowleft') state.input.left = true;
  if (key === 'd' || key === 'arrowright') state.input.right = true;
  if (key === ' ' && state.player.grounded) {
    event.preventDefault();
    state.input.jump = true;
  }
  if (key === 'p') beginGame();
  if (key === 'i') {
    event.preventDefault();
    setInventoryOpen(!inventoryOpen);
  }
  if (key === 'l' && devLevelConfig) {
    showMessage('Dev level loaded', `${devLevelConfig.levelName || 'Custom'} • ${devLevelConfig.enemyCount || 0} enemies`);
  }
});

window.addEventListener('keyup', (event) => {
  const key = event.key.toLowerCase();
  if (key === 'w' || key === 'arrowup') state.input.forward = false;
  if (key === 's' || key === 'arrowdown') state.input.backward = false;
  if (key === 'a' || key === 'arrowleft') state.input.left = false;
  if (key === 'd' || key === 'arrowright') state.input.right = false;
  if (key === ' ') state.input.jump = false;
});

window.addEventListener('blur', clearInputState);
window.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('gesturestart', (event) => event.preventDefault(), { passive: false });
window.addEventListener('gesturechange', (event) => event.preventDefault(), { passive: false });
window.addEventListener('gestureend', (event) => event.preventDefault(), { passive: false });

canvas.addEventListener('pointerdown', (event) => {
  if (inventoryOpen || state.inCutscene) return;
  if (event.pointerType === 'mouse') {
    state.mouseLookActive = true;
    canvas.requestPointerLock();
  }
  if (state.running) fireWeapon();
});

canvas.addEventListener('pointerup', () => {
  state.mouseLookActive = false;
});

canvas.addEventListener('pointerleave', () => {
  state.mouseLookActive = false;
});

document.addEventListener('pointerlockchange', () => {
  state.pointerLocked = document.pointerLockElement === canvas;
});

document.addEventListener('mousemove', (event) => {
  if (!state.running || !(state.pointerLocked || state.mouseLookActive)) return;
  handleLook(event.movementX, event.movementY);
});

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  followCamera.setZoom(Math.sign(event.deltaY));
}, { passive: false });

const touchState = { active: false, lastX: 0, lastY: 0 };
canvas.addEventListener('touchstart', (event) => {
  if (!state.running) return;
  event.preventDefault();
  if (event.touches.length > 0) {
    const touch = event.touches[0];
    touchState.active = true;
    touchState.lastX = touch.clientX;
    touchState.lastY = touch.clientY;
  }
}, { passive: false });

canvas.addEventListener('touchmove', (event) => {
  if (!state.running || !touchState.active) return;
  event.preventDefault();
  const touch = event.touches[0];
  const dx = touch.clientX - touchState.lastX;
  const dy = touch.clientY - touchState.lastY;
  touchState.lastX = touch.clientX;
  touchState.lastY = touch.clientY;
  handleLook(dx, dy);
}, { passive: false });

canvas.addEventListener('touchend', () => { touchState.active = false; }, { passive: false });
canvas.addEventListener('touchcancel', () => { touchState.active = false; }, { passive: false });

leftStickZone.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  state.stickDragging = true;
  leftStickZone.setPointerCapture(event.pointerId);
  const rect = leftStickZone.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = (event.clientX - centerX) / (rect.width * 0.38);
  const dy = (event.clientY - centerY) / (rect.height * 0.38);
  const mag = Math.min(1, Math.hypot(dx, dy));
  state.movementVector.x = Math.min(1, Math.max(-1, dx)) / Math.max(1, mag);
  state.movementVector.y = Math.min(1, Math.max(-1, dy)) / Math.max(1, mag);
  const knobX = Math.max(-38, Math.min(38, dx * 38));
  const knobY = Math.max(-38, Math.min(38, dy * 38));
  leftStickKnob.style.left = `calc(50% + ${knobX}px)`;
  leftStickKnob.style.top = `calc(50% + ${knobY}px)`;
  leftStickKnob.style.transform = 'translate(-50%, -50%)';
});

leftStickZone.addEventListener('pointermove', (event) => {
  if (!state.stickDragging) return;
  const rect = leftStickZone.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = (event.clientX - centerX) / (rect.width * 0.38);
  const dy = (event.clientY - centerY) / (rect.height * 0.38);
  const clampX = Math.max(-1, Math.min(1, dx));
  const clampY = Math.max(-1, Math.min(1, dy));
  const magnitude = Math.hypot(clampX, clampY);
  const normalizedX = magnitude > 1 ? clampX / magnitude : clampX;
  const normalizedY = magnitude > 1 ? clampY / magnitude : clampY;
  state.movementVector.x = normalizedX;
  state.movementVector.y = normalizedY;
  const knobX = normalizedX * 38;
  const knobY = normalizedY * 38;
  leftStickKnob.style.left = `calc(50% + ${knobX}px)`;
  leftStickKnob.style.top = `calc(50% + ${knobY}px)`;
  leftStickKnob.style.transform = 'translate(-50%, -50%)';
});

leftStickZone.addEventListener('pointerup', () => {
  state.stickDragging = false;
  state.movementVector.x = 0;
  state.movementVector.y = 0;
  leftStickKnob.style.left = '50%';
  leftStickKnob.style.top = '50%';
  leftStickKnob.style.transform = 'translate(-50%, -50%)';
});
leftStickZone.addEventListener('pointerleave', () => {
  if (!state.stickDragging) return;
  state.stickDragging = false;
  state.movementVector.x = 0;
  state.movementVector.y = 0;
  leftStickKnob.style.left = '50%';
  leftStickKnob.style.top = '50%';
  leftStickKnob.style.transform = 'translate(-50%, -50%)';
});
leftStickZone.addEventListener('pointercancel', () => {
  state.stickDragging = false;
  state.movementVector.x = 0;
  state.movementVector.y = 0;
  leftStickKnob.style.left = '50%';
  leftStickKnob.style.top = '50%';
  leftStickKnob.style.transform = 'translate(-50%, -50%)';
});

const resetLookStick = () => {
  state.lookStickDragging = false;
  followCamera.setLookStick(0, 0);
  if (!rightStickKnob) return;
  rightStickKnob.style.left = '50%';
  rightStickKnob.style.top = '50%';
  rightStickKnob.style.transform = 'translate(-50%, -50%)';
};

const applyLookStick = (clientX: number, clientY: number) => {
  if (!rightStickZone || !rightStickKnob) return;
  const rect = rightStickZone.getBoundingClientRect();
  const dx = (clientX - (rect.left + rect.width / 2)) / (rect.width * 0.38);
  const dy = (clientY - (rect.top + rect.height / 2)) / (rect.height * 0.38);
  const mag = Math.hypot(dx, dy);
  const x = mag > 1 ? dx / mag : dx;
  const y = mag > 1 ? dy / mag : dy;
  followCamera.setLookStick(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
  rightStickKnob.style.left = `calc(50% + ${x * 38}px)`;
  rightStickKnob.style.top = `calc(50% + ${y * 38}px)`;
  rightStickKnob.style.transform = 'translate(-50%, -50%)';
};

if (rightStickZone) {
  rightStickZone.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    state.lookStickDragging = true;
    rightStickZone.setPointerCapture(event.pointerId);
    applyLookStick(event.clientX, event.clientY);
  });
  rightStickZone.addEventListener('pointermove', (event) => {
    if (!state.lookStickDragging) return;
    applyLookStick(event.clientX, event.clientY);
  });
  rightStickZone.addEventListener('pointerup', resetLookStick);
  rightStickZone.addEventListener('pointerleave', () => {
    if (state.lookStickDragging) resetLookStick();
  });
  rightStickZone.addEventListener('pointercancel', resetLookStick);
}

jumpBtn.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  unlockAudio();
  state.input.jump = true;
});
jumpBtn.addEventListener('pointerup', () => { state.input.jump = false; });
jumpBtn.addEventListener('pointerleave', () => { state.input.jump = false; });
jumpBtn.addEventListener('pointercancel', () => { state.input.jump = false; });

fireBtn.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  state.fireHeld = true;
  if (state.running) fireWeapon();
});
fireBtn.addEventListener('pointerup', () => { state.fireHeld = false; });
fireBtn.addEventListener('pointerleave', () => { state.fireHeld = false; });
fireBtn.addEventListener('pointercancel', () => { state.fireHeld = false; });

startBtn.addEventListener('click', () => {
  unlockAudio();
  beginGame();
});
canvas.addEventListener('pointerdown', () => unlockAudio());
installAudioUnlock();
resetBtn.addEventListener('click', () => {
  clearDynamicObjects();
  clearInputState();
  resetPlayer();
  void loadMissionScene(getLevelDefinition(1).path);
  updateHud();
  showMessage('PH Origins', GAME_COPY.reset);
  loadModelBtn.style.display = '';
  syncStartButtonLabel();
  state.running = false;
});

const renderLoop = () => {
  const delta = engine.getDeltaTime() / 1000;
  state.shootCooldown = Math.max(0, state.shootCooldown - delta);

  if (state.running) {
    if (state.inCutscene && activeCutscene) {
      if (windowPierceLocked) placePierceAtOfficeWindow();
      if (terminalPierceLocked) placePierceAtTerminal();
      if (elevatorLocked) stepElevatorSet(activeCutscene.time);
      if (activeCutscene.id === 'apex-window' && activeCutscene.time >= 42.3) officeAlarm.start();
      const playing = stepCutscene(activeCutscene, delta);
      if (!playing) endCutscene();
      officeAlarm.update(delta);
      objectiveMarker.update(delta);
      updateCamera(delta, false, null);
      if (elevatorLocked && activeCutscene) applyElevatorRideFeel(activeCutscene.time);
    } else {
    if (state.fireHeld) fireWeapon();

    state.wave = 1 + Math.floor(state.kills / 4);
    const levelConfig = getLevelDefinition(state.level);
    applyLevelCombat(levelConfig);

    if (!levelAllowsCombat()) {
      if (enemies.length > 0) clearEnemies(enemies);
    } else {
      const spawnDelay = Math.max(0.45, state.spawnInterval * (1.75 - state.wave * 0.14));
      const enemyCap = levelConfig.enemyCount;
      if (enemyCap > 0 && (performance.now() - state.lastSpawn > spawnDelay * 1000 || enemies.length === 0)) {
        const maxSpawns = Math.min(2 + state.wave, Math.max(1, enemyCap));
        for (let i = 0; i < Math.min(maxSpawns, 8); i++) {
          if (enemies.length < enemyCap) spawnWaveEnemy();
        }
        state.lastSpawn = performance.now();
      }
    }

    const locomotion = updatePlayer(delta);
    updateCamera(delta, locomotion.moving, locomotion.moveHeading);
    triggerRunner.update(state.player);

    if (sequencePhase === 'elevator' && elevatorDoorOpen < 1) {
      elevatorDoorOpen = Math.min(1, elevatorDoorOpen + delta / 1.05);
      applyElevatorDoors(elevatorDoorOpen);
    }

    if (boardDeparting) {
      updateNpcDeparture(npcs, delta);
      if (remainingDepartingNpcs(npcs) === 0) {
        boardDeparting = false;
        beginWindowCutscene();
      }
    }

    if (sequencePhase === 'alarm' && missionScene) {
      const terminal = resolveOfficeTerminal(missionScene);
      if (Math.hypot(state.player.x - terminal.x, state.player.z - terminal.z) < 1.35) {
        beginTerminalBeat();
      }
    }

    officeAlarm.update(delta);
    if (!state.inCutscene) objectiveMarker.update(delta);
    if (objectiveHud?.classList.contains('visible') && objectiveDist && objectiveMarker.getTarget()) {
      objectiveDist.textContent = `${objectiveMarker.distanceTo(state.player.x, state.player.z).toFixed(1)} m`;
    }

    for (const enemy of enemies) {
      const distance = updateEnemyAI(enemy, new BABYLON.Vector3(state.player.x, 1.6, state.player.z), delta);

      if (distance < 1.8 && performance.now() - state.lastDamageAt > 500) {
        state.health -= 10;
        state.lastDamageAt = performance.now();
        audio.hit();
        createBurst(scene, enemy.mesh.position.x, enemy.mesh.position.y + 1.5, enemy.mesh.position.z, new BABYLON.Color3(1, 0.2, 0.2), particles);
        if (state.health <= 0) {
          finishGame(false);
          break;
        }
      }
    }

    for (const particle of particles) {
      particle.mesh.position.addInPlace(particle.velocity.scale(delta));
      particle.life -= delta;
      if (particle.life <= 0) {
        particle.mesh.dispose();
      }
    }

    for (let i = pickups.length - 1; i >= 0; i--) {
      const pickup = pickups[i];
      if (!pickup.active) continue;
      pickup.mesh.rotation.y += delta * 2;
      if (BABYLON.Vector3.Distance(pickup.mesh.position, new BABYLON.Vector3(state.player.x, state.player.y, state.player.z)) < 1.8) {
        addItem(state.inventory, pickup.item, pickup.amount);
        awardQuestProgress('collect', 1);
        pickup.mesh.dispose();
        pickups.splice(i, 1);
        audio.pickup();
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life <= 0) particles.splice(i, 1);
    }

    if (state.kills >= 12) {
      state.progression.highestUnlocked = getUnlockedLevelCount(Math.max(state.progression.highestUnlocked, state.level + 1));
      finishGame(true);
    }

    state.progression.xp = Math.max(0, state.kills * 5);
    state.progression.medals = Math.max(0, Math.floor(state.kills / 3));
    updateQuestTracker();
    updateHud();
    }
  } else {
    if (sequencePhase === 'done') {
      clearInputState();
      playerAvatar.setLocomotion(false, true);
    }
    updateCamera(delta);
  }

  scene.render();
};

const loadCustomModel = (file: File) => {
  importAssetFile(scene, file, (rootNode) => {
    if (rootNode.getChildMeshes().length > 0) {
      playerAvatar.group.setEnabled(false);
      playerAvatar.group.parent = rootNode;
      playerAvatar.group.position = new BABYLON.Vector3(0, 0, 0);
      rootNode.scaling = new BABYLON.Vector3(0.7, 0.7, 0.7);
      rootNode.position = new BABYLON.Vector3(0, 0.6, 1.3);
      rootNode.rotation.y = Math.PI;
      devOutput.value = `Imported model: ${file.name}`;
    }
  });
};

const themeOrder = ['Apex Peak', 'Neon Drift', 'Crimson Surge', 'Arctic Rift'] as const;
let activeThemeName = typeof devLevelConfig?.theme === 'string' ? devLevelConfig.theme : 'Neon Drift';

const cycleTheme = () => {
  const currentIndex = themeOrder.indexOf(activeThemeName as (typeof themeOrder)[number]);
  const nextTheme = themeOrder[(currentIndex + 1) % themeOrder.length];
  activeThemeName = nextTheme;
  applyTheme(scene, nextTheme);
  devOutput.value = `Theme applied: ${nextTheme}`;
  if (devLevelConfig) {
    localStorage.setItem('ph-origins-level-config', JSON.stringify({ ...devLevelConfig, theme: nextTheme, updatedAt: new Date().toISOString() }));
  }
};

const renderLevelSelect = () => {
  levelList.innerHTML = '';
  const levels = getLevels();

  levels.forEach((level) => {
    const comingSoon = level.comingSoon || level.id > 1;
    const unlocked = !comingSoon && level.id <= state.progression.highestUnlocked;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `level-item${comingSoon ? ' coming-soon' : unlocked ? '' : ' locked'}`;
    button.disabled = comingSoon || !unlocked;
    button.setAttribute('aria-disabled', comingSoon || !unlocked ? 'true' : 'false');
    button.innerHTML = comingSoon
      ? `
      <div>
        <strong>Level ${level.id}</strong>
        <small>Coming soon</small>
      </div>
      <span>Coming soon</span>
    `
      : `
      <div>
        <strong>Level ${level.id}: ${level.name}</strong>
        <small>${level.reward}</small>
      </div>
      <span>${unlocked ? 'Play' : 'Locked'}</span>
    `;

    button.addEventListener('click', () => {
      if (comingSoon) {
        messageText.textContent = 'Coming soon.';
        return;
      }
      if (!unlocked) return;
      state.level = level.id;
      state.progression.currentLevel = level.id;
      state.progression.highestUnlocked = Math.max(state.progression.highestUnlocked, level.id);
      applyLevelConfig(level);
      void loadMissionScene(level.path);
      levelSelect.classList.add('hidden');
      messageText.textContent = `${level.name} • ${level.reward}`;
      messageTitle.textContent = 'PH Origins';
      syncStartButtonLabel();
      updateCrosshairVisibility();
    });

    levelList.appendChild(button);
  });
};

const showLevelSelect = () => {
  void loadLevelLibrary().then(() => {
    renderLevelSelect();
    messageTitle.textContent = 'Mission Select';
    messageText.textContent = 'Choose the next zone and continue your run.';
    levelSelect.classList.remove('hidden');
    messageBox.classList.remove('hidden');
  });
};

loadModelBtn.addEventListener('click', () => {
  showLevelSelect();
});
closeLevelSelectBtn.addEventListener('click', () => {
  levelSelect.classList.add('hidden');
  messageText.textContent = GAME_COPY.intro;
  messageTitle.textContent = 'PH Origins';
});
modelInput.addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) {
    loadCustomModel(file);
    (event.target as HTMLInputElement).value = '';
  }
});

const devActions: Record<string, () => void> = {
  reset: () => {
    resetBtn.click();
  },
  hp: () => {
    state.health = MAX_HEALTH;
    updateHud();
  },
  level: () => {
    state.level = Math.min(getLevels().length, state.level + 1);
    applyLevelConfig(getLevelDefinition(state.level));
    void loadMissionScene(getLevelDefinition(state.level).path);
    updateHud();
  },
  pause: () => {
    state.running = !state.running;
    if (state.running) {
      showMessage('Battle resumed', 'Keep moving and hold the line.');
    } else {
      showMessage('Battle paused', 'Resume when you are ready.');
    }
  },
  audio: () => {
    audio.enabled = !audio.enabled;
    saveGame({ sound: audio.enabled });
    devOutput.value = `Audio ${audio.enabled ? 'enabled' : 'muted'}`;
  },
  lighting: () => {
    cycleTheme();
  },
};

document.querySelectorAll('[data-dev-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.getAttribute('data-dev-action');
    if (action && devActions[action]) {
      devActions[action]();
    }
  });
});

devToggle.addEventListener('click', () => {
  devPanel.classList.toggle('visible');
});

loadModelBtn.style.display = '';
showMessage('PH Origins', GAME_COPY.intro);
updateHud();

updateCrosshairVisibility();
configureResponsiveUI(root);
engine.runRenderLoop(renderLoop);
window.addEventListener('resize', () => {
  configureResponsiveUI(root);
  engine.resize();
});
