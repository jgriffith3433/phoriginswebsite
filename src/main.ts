import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders';

import { configureResponsiveUI } from './game/mobile';
import { clearEnemies, type Enemy, spawnEnemy, updateEnemyAI } from './game/enemies';
import {
  clearNpcs,
  resolveBoardSeatPose,
  spawnNpcsFromScene,
  type Npc,
} from './game/npcs';
import { createPlayerAvatar, type PlayerAvatar } from './game/playerAvatar';
import { clearImpactMarks, stampBulletMark } from './game/impacts';
import { ITEM_CAP, addItem, createInventoryState, consumeItem, inventorySummary, itemCount, roomFor } from './game/inventory';
import { getLevelDefinition, getLevels, getPlayableLevelCount, getUnlockedLevelCount, loadLevelLibrary } from './game/levels';
import { clampPlayerToArena, CLIP_SIZE, createPlayerCollider, createPlayerState, movePlayerOnGround, PLAYER_STAND_Y, playerMeshY, requestJump, updateVerticalMotion } from './game/player';
import { createBurst } from './game/physics';
import { createThirdPersonCamera, lerpAngle } from './game/thirdPersonCamera';
import { activateGameCamera, activateMenuCamera, createMenuCamera } from './game/menuCamera';
import { createQuestState, getGoalText, updateQuestProgress } from './game/progression';
import { createSceneGrade } from './game/grade';
import { createPhone } from './game/phone';
import { mountPipeDrips } from './game/drips';
import { applySceneLighting, applyTheme, getSceneTheme } from './game/scene';
import { importAssetFile } from './game/importer';
import { PLAYER_ASSET_ID, PLAYER_ASSET_IDS } from './game/modelLoader';
import { DEFAULT_SCENE_FILE_PATH, loadSceneFromJson, loadSceneFromJsonFile, readSceneData, type SceneData, type SceneTrigger } from './game/sceneData';
import { createMusicTriggerPlayer, createTriggerRunner, isMusicTrigger } from './game/triggers';
import { applyNpcAnim, startCutscene, stepCutscene, stopCutsceneAudio, type ActiveCutscene } from './game/cutscenes';
import { createAct1, type Act1, type StoryCarry } from './story/act1';
import { renderLevelCredits } from './story/credits';
import { createUnlockedAudio, getSharedAudioContext, installAudioUnlock, unlockAudio } from './game/audioUnlock';
import { createMuzzleFlash } from './game/muzzleFlash';
import { createPlayerPistol } from './game/pistol';
import { createObjectiveMarker } from './game/objectiveMarker';
import { createScreenFade } from './game/fade';
import type { InventoryItemType, InventoryState, LevelDefinition, ProgressionState, QuestState } from './game/types';

const root = document.getElementById('game-root') as HTMLDivElement;
const screenFade = createScreenFade(document.getElementById('screenFade') as HTMLElement);
const healthBar = document.getElementById('healthBar') as HTMLDivElement;
const healthFill = document.getElementById('healthFill') as HTMLSpanElement;
const messageBox = document.getElementById('messageBox') as HTMLDivElement;
const messageTitle = document.getElementById('messageTitle') as HTMLHeadingElement;
const messageText = document.getElementById('messageText') as HTMLParagraphElement;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
startBtn.disabled = true;
startBtn.textContent = 'Loading…';
startBtn.setAttribute('aria-busy', 'true');
const newGameBtn = document.getElementById('newGameBtn') as HTMLButtonElement;
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
const sidearmHint = document.getElementById('sidearmHint') as HTMLButtonElement | null;
const lightHint = document.getElementById('lightHint') as HTMLButtonElement | null;
const medkitHint = document.getElementById('medkitHint') as HTMLButtonElement | null;
const inventoryItems = document.getElementById('inventoryItems') as HTMLDivElement;
const inventoryClose = document.getElementById('inventoryClose') as HTMLButtonElement;
const weaponSlot = document.getElementById('weaponSlot') as HTMLButtonElement | null;
const weaponSlotState = document.getElementById('weaponSlotState') as HTMLSpanElement | null;
const reloadHint = document.getElementById('reloadHint') as HTMLDivElement | null;
const interactHint = document.getElementById('interactHint') as HTMLDivElement | null;
const objectiveHud = document.getElementById('objectiveHud') as HTMLDivElement | null;
const objectiveText = document.getElementById('objectiveText') as HTMLSpanElement | null;
const objectiveDist = document.getElementById('objectiveDist') as HTMLSpanElement | null;
const alarmFlash = document.getElementById('alarmFlash') as HTMLDivElement | null;
const phonePanel = document.getElementById('phonePanel') as HTMLElement | null;
const phoneStatus = document.getElementById('phoneStatus') as HTMLElement | null;
const phoneContact = document.getElementById('phoneContact') as HTMLElement | null;
const phoneDetail = document.getElementById('phoneDetail') as HTMLElement | null;
const phoneClock = document.getElementById('phoneClock') as HTMLElement | null;
const phoneSpeaker = document.getElementById('phoneSpeaker') as HTMLElement | null;
const phoneLine = document.getElementById('phoneLine') as HTMLElement | null;
const phoneAnswer = document.getElementById('phoneAnswer') as HTMLButtonElement | null;
const phoneEnd = document.getElementById('phoneEnd') as HTMLButtonElement | null;
const phoneFlash = document.getElementById('phoneFlash') as HTMLButtonElement | null;
const phoneMessages = document.getElementById('phoneMessages') as HTMLElement | null;
const phoneToast = document.getElementById('phoneToast') as HTMLElement | null;
const phoneHint = document.getElementById('phoneHint') as HTMLButtonElement | null;
const phoneBadge = document.getElementById('phoneBadge') as HTMLElement | null;
const phoneBtn = document.getElementById('phoneBtn') as HTMLButtonElement | null;

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
const menuCamera = createMenuCamera(scene);
let menuCameraActive = true;
activateMenuCamera(scene, menuCamera);
const muzzleFlash = createMuzzleFlash(scene);
const playerPistol = createPlayerPistol(scene);

const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
hemi.intensity = 0.8;

const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -2, 1), scene);
sun.position = new BABYLON.Vector3(12, 18, 6);
sun.intensity = 0.9;
const grade = createSceneGrade(scene, [followCamera.camera, menuCamera]);

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
  applySceneLighting(scene, initialSceneData);
  grade.apply(initialSceneData.theme);
} else {
  applyTheme(scene, currentThemeName);
  grade.apply(currentThemeName);
}

const sceneLoadOptions = { omitAssetIds: PLAYER_ASSET_IDS, hideTriggers: true };
let sceneNodes: BABYLON.Node[] = [];
let missionScene: SceneData | null = initialSceneData;

const applyLoadedScene = (loaded: Awaited<ReturnType<typeof loadSceneFromJsonFile>>) => {
  if (loaded) {
    sceneNodes = loaded.nodes;
    missionScene = loaded.data;
    applyTheme(scene, loaded.data.theme || currentThemeName);
    applySceneLighting(scene, loaded.data);
    grade.apply(loaded.data.theme || currentThemeName);
    return;
  }
  missionScene = initialSceneData;
  sceneNodes = loadSceneFromJson(scene, initialSceneData, sceneLoadOptions);
};

const npcs: Npc[] = [];
let activeCutscene: ActiveCutscene | null = null;
let storyCarry: StoryCarry[] = [];
let act: Act1;
let playerHeroId = PLAYER_ASSET_ID;
const objectiveMarker = createObjectiveMarker(scene);
let playerAvatar: PlayerAvatar = createPlayerAvatar(scene);
playerAvatar.group.rotation.y = Math.PI;
playerPistol.attachTo(playerAvatar);
const phone = createPhone(scene, {
  soundOn: () => audio.enabled,
  onFinished: () => {
    followCamera.setCallFrame(false);
    act.onPhoneFinished();
  },
  onHand: (raised) => {
    if (!raised || phone.locksBody()) {
      if (!state.player.weaponDrawn) {
        playerAvatar.setArmed(false);
        followCamera.setOverShoulder(false);
        followCamera.setToolClose(false);
      }
      updateCrosshairVisibility();
      return;
    }
    state.player.weaponDrawn = false;
    playerPistol.setVisible(false);
    weaponBusy = false;
    playerAvatar.setArmed(true);
    followCamera.setOverShoulder(phone.flashlightOn());
    followCamera.setToolClose(phone.flashlightOn());
    updateCrosshairVisibility();
  },
});
phone.attachTo(playerAvatar);
const playerCollider = createPlayerCollider(scene);
let gameReady = false;

const waitAvatarReady = (avatar: PlayerAvatar) =>
  new Promise<void>((resolve) => avatar.whenReady(resolve));

const ensurePlayerAvatar = (assetId: string) => {
  if (playerHeroId === assetId && playerAvatar) return;
  const prev = playerAvatar;
  const next = createPlayerAvatar(scene, assetId);
  next.group.position.copyFrom(prev.group.position);
  next.group.rotation.copyFrom(prev.group.rotation);
  next.setArmed(state.player.weaponDrawn);
  playerPistol.attachTo(null);
  prev.dispose();
  playerAvatar = next;
  playerHeroId = assetId;
  playerPistol.attachTo(playerAvatar);
  playerPistol.setVisible(state.player.weaponDrawn);
  phone.attachTo(playerAvatar);
};

const placePierce = (x: number, z: number, yaw: number) => {
  state.player.x = x;
  state.player.y = PLAYER_STAND_Y;
  state.player.z = z;
  state.player.velocityY = 0;
  state.player.grounded = true;
  state.characterYaw = yaw;
  playerCollider.position.set(x, PLAYER_STAND_Y, z);
  playerAvatar.group.position.set(x, playerMeshY(PLAYER_STAND_Y), z);
  playerAvatar.group.rotation.y = yaw + Math.PI;
  followCamera.face(yaw);
};

let lastObjectiveCue = '';

const setObjective = (title: string, text: string, target: { x: number; z: number; y?: number } | null) => {
  if (objectiveText) objectiveText.textContent = text;
  if (objectiveHud) {
    const kicker = objectiveHud.querySelector('.objective-kicker') as HTMLElement | null;
    if (kicker) kicker.textContent = title;
  }
  if (target) objectiveMarker.setTarget({ ...target, title, text });
  else objectiveMarker.setTarget(null);
  const cue = `${title}|${text}`;
  if (!text || cue === lastObjectiveCue || !state.running) return;
  lastObjectiveCue = cue;
  audio.play(SFX.objective, 0.55);
};

const showObjectiveHud = (visible: boolean) => {
  if (!objectiveHud) return;
  objectiveHud.classList.toggle('visible', visible);
};

const isApexPeakLevel = () =>
  getLevelDefinition(state.level).libraryId === 'apex-peak' || missionScene?.id === 'apex-peak';

const isB3Level = () =>
  getLevelDefinition(state.level).libraryId === 'b3-basement' || missionScene?.id === 'b3-basement';

const cineHud = document.createElement('div');
cineHud.style.cssText = 'position:absolute;left:0;right:0;bottom:11%;text-align:center;pointer-events:none;z-index:24;display:none;';
cineHud.innerHTML = '<div style="font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#d4b483;margin-bottom:8px;"></div><div style="font-size:18px;color:#f3f1ea;text-shadow:0 2px 16px #000;"></div>';
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

type CutsceneGear = { gun: boolean; phone: boolean; light: boolean; screen: boolean };

let cutsceneGear: CutsceneGear | null = null;

const stashGearForCutscene = () => {
  cutsceneGear = {
    gun: state.player.weaponDrawn || (weaponBusy && playerPistol.isVisible()),
    phone: phone.isRaised() && !phone.locksBody(),
    light: phone.flashlightOn(),
    screen: phone.isScreenOpen(),
  };
  if (phone.locksBody()) return;
  armPhoneAfterHolster = false;
  armFlashAfterRaise = false;
  weaponBusy = false;
  state.player.weaponDrawn = false;
  playerPistol.setVisible(false);
  playerAvatar.setArmed(false);
  followCamera.setOverShoulder(false);
  followCamera.setToolClose(false);
  followCamera.setCallFrame(false);
  if (phone.isRaised()) phone.setRaised(false);
  else phone.setFlashlight(false);
  updateCrosshairVisibility();
};

const restoreGearAfterCutscene = (gear: CutsceneGear) => {
  if (phone.locksBody()) return;
  if (gear.gun) {
    state.player.weaponDrawn = true;
    playerPistol.setVisible(true);
    playerAvatar.setArmed(true);
    if (phone.isRaised()) phone.setRaised(false);
  } else if (gear.phone || gear.light || gear.screen) {
    state.player.weaponDrawn = false;
    playerPistol.setVisible(false);
    phone.setRaised(true);
    if (gear.light) phone.setFlashlight(true);
    if (gear.screen) phone.setScreen(true);
    playerAvatar.setArmed(true);
  }
  syncEquippedCamera();
  updateHud();
  updateCrosshairVisibility();
};

const endCutscene = () => {
  const finished = activeCutscene;
  const gear = cutsceneGear;
  cutsceneGear = null;
  const reequip = finished ? finished.timeline.reequip !== false : true;
  act.releaseSeat();
  resetCutsceneState();
  phone.aimBeam(null);
  if (!phone.locksBody() && phone.isRaised()) phone.setRaised(false);
  if (reequip && gear) restoreGearAfterCutscene(gear);
  if (finished) act.onCutsceneEnded(finished.id);
};

const beginNamedCutscene = (id: string) => {
  if (state.inCutscene) return;
  state.inCutscene = true;
  stashGearForCutscene();
  act.prepareCutscene(id);
  unlockPointer();
  void startCutscene(id, {
    onCamera: (position, lookAt) => followCamera.setCinematic(position, lookAt),
    onHud: (title, text) => showCineHud(title, text),
    onAnim: (actor, clip, loop) => applyNpcAnim(npcs, actor, clip, loop, playerAvatar),
    onLight: (on, intensity, target) => act.cutsceneLight(on, intensity, target),
    onMesh: (target, enabled, position) => act.onMesh(target, enabled, position),
    onObjective: (title, text) => act.onObjective(title, text),
    onAvatar: (assetId) => act.onAvatar(assetId),
    onCarry: (itemId, name, note) => act.onCarry(itemId, name, note),
    onFade: (to, seconds) => screenFade.to(to, seconds),
    audioEnabled: () => audio.enabled,
  }).then((next) => {
    if (!next) {
      endCutscene();
      act.onCutsceneFailed(id);
      return;
    }
    activeCutscene = next;
    act.relock(id);
  });
};

const musicTriggerPlayer = createMusicTriggerPlayer();
const triggerRunner = createTriggerRunner((trigger: SceneTrigger) => {
  if (isMusicTrigger(trigger)) return;
  act.handleTrigger(trigger);
});

const loadMissionScene = async (path: string) => {
  gameReady = false;
  syncStartButtonLabel();
  try {
    clearNpcs(npcs);
    clearEnemies(enemies);
    act.reset();
    resetCutsceneState();
    const loaded = await loadSceneFromJsonFile(scene, path, { ...sceneLoadOptions, replaceNodes: sceneNodes });
    applyLoadedScene(loaded);
    triggerRunner.bind(loaded?.data.triggers ?? []);
    musicTriggerPlayer.bind(loaded?.data.triggers ?? []);
    if (loaded?.data) npcs.push(...spawnNpcsFromScene(scene, loaded.data));
    act.dressLevel();
    mountPipeDrips(scene, loaded?.data.theme === 'B3 Basement');
    clearImpactMarks();
    bindScenePickups();
    ensurePlayerAvatar(PLAYER_ASSET_ID);
    await Promise.all([
      waitAvatarReady(playerAvatar),
      ...npcs.map((npc) => waitAvatarReady(npc.avatar)),
    ]);
    act.onLevelReady();
  } finally {
    gameReady = true;
    syncStartButtonLabel();
  }
};

const SAVE_COOKIE = 'ph-origins-save';
const SAVE_STORAGE_KEY = 'ph-origins-save';
const SAVE_MAX_AGE = 60 * 60 * 24 * 400;
type SaveData = { unlocked: number; level: number; sound: boolean };
const defaultSave: SaveData = { unlocked: 1, level: 1, sound: true };
const MAX_HEALTH = 100;

const GAME_COPY = {
  missionClear: 'Keep pushing into the next mission.',
  defeat: 'Press Start to retry.',
} as const;

const readCookie = (name: string) => {
  const prefix = `${name}=`;
  const hit = document.cookie.split('; ').find((part) => part.startsWith(prefix));
  if (!hit) return null;
  try {
    return decodeURIComponent(hit.slice(prefix.length));
  } catch {
    return null;
  }
};

const writeSaveCookie = (data: SaveData) => {
  document.cookie = `${SAVE_COOKIE}=${encodeURIComponent(JSON.stringify(data))}; Path=/; Max-Age=${SAVE_MAX_AGE}; SameSite=Lax`;
};

const clearSave = () => {
  document.cookie = `${SAVE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  try {
    localStorage.removeItem(SAVE_STORAGE_KEY);
  } catch {
    /* private mode */
  }
};

const parseSave = (raw: string): SaveData => {
  const parsed = JSON.parse(raw) as Partial<SaveData>;
  const unlocked = Math.max(1, Number(parsed.unlocked) || 1);
  return {
    unlocked,
    level: Math.max(1, Number(parsed.level) || unlocked),
    sound: parsed.sound !== false,
  };
};

const loadSave = (): SaveData => {
  try {
    const fromCookie = readCookie(SAVE_COOKIE);
    if (fromCookie) return parseSave(fromCookie);
  } catch {
    /* try the previous local save */
  }
  try {
    const raw = localStorage.getItem(SAVE_STORAGE_KEY);
    if (!raw) return { ...defaultSave };
    const parsed = parseSave(raw);
    writeSaveCookie(parsed);
    localStorage.removeItem(SAVE_STORAGE_KEY);
    return parsed;
  } catch {
    return { ...defaultSave };
  }
};

let save = loadSave();

const saveGame = (next: Partial<SaveData>) => {
  save = {
    unlocked: Math.max(1, Number(next.unlocked ?? save.unlocked) || 1),
    level: Math.max(1, Number(next.level ?? save.level) || 1),
    sound: next.sound ?? save.sound,
  };
  writeSaveCookie(save);
  return save;
};

const hasProgress = () => save.unlocked > 1 || save.level > 1;

const savedLevelId = () => {
  const requested = Math.max(1, save.level || 1, save.unlocked || 1);
  const def = getLevelDefinition(requested);
  return def.comingSoon ? getPlayableLevelCount() : def.id;
};

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

const levelStartLine = (level = getLevelDefinition(state.level)) =>
  `Level ${level.id}: ${level.name}`;

const levelLoadingLine = (level = getLevelDefinition(state.level)) =>
  level.libraryId === 'apex-peak' ? 'Loading the office…' : `Loading ${level.name}…`;

const enemies: Enemy[] = [];
const particles: Array<{ mesh: BABYLON.Mesh; velocity: BABYLON.Vector3; life: number }> = [];
const pickups: Array<{
  mesh: BABYLON.AbstractMesh;
  item: InventoryItemType;
  amount: number;
  active: boolean;
  runtime: boolean;
  baseY: number;
  phase: number;
}> = [];

const SFX = {
  shot: '/assets/audio/sfx/pistol-shot.ogg',
  jump: '/assets/audio/sfx/jump.ogg',
  walk: '/assets/audio/sfx/walk.ogg',
  draw: '/assets/audio/sfx/pistol-draw.ogg',
  holster: '/assets/audio/sfx/pistol-holster.ogg',
  start: '/assets/audio/sfx/start.ogg',
  objective: '/assets/audio/sfx/objective.ogg',
} as const;
const endingTrack = (level: number) => `/assets/audio/ending-${Math.max(1, level)}.mp3`;
const oneShotTemplates = new Map<string, HTMLAudioElement>();
let walkLoop: HTMLAudioElement | null = null;
let walkStartPending = false;
let endingSong: HTMLAudioElement | null = null;

const stopEndingSong = () => {
  if (!endingSong) return;
  endingSong.pause();
  endingSong.src = '';
  endingSong = null;
};

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
  play(url: string, volume: number) {
    if (!this.enabled) return;
    this.ensure();
    let template = oneShotTemplates.get(url);
    if (!template) {
      template = createUnlockedAudio(url);
      oneShotTemplates.set(url, template);
    }
    const element = template.cloneNode(true) as HTMLAudioElement;
    element.volume = volume;
    element.currentTime = 0;
    void element.play().catch(() => {});
  },
  setWalk(playing: boolean) {
    if (!playing || !this.enabled) {
      walkStartPending = false;
      if (walkLoop) {
        walkLoop.pause();
        walkLoop.currentTime = 0;
      }
      return;
    }
    this.ensure();
    if (!walkLoop) {
      walkLoop = createUnlockedAudio(SFX.walk);
      walkLoop.loop = true;
      walkLoop.muted = false;
      walkLoop.volume = 0.62;
    }
    if (!walkLoop.paused || walkStartPending) return;
    walkLoop.muted = false;
    walkLoop.volume = 0.62;
    walkStartPending = true;
    void walkLoop.play().then(() => {
      walkStartPending = false;
    }).catch(() => {
      walkStartPending = false;
    });
  },
  hit() { this.tone(170, 0.18, 'square', 0.08); },
  shoot() { this.play(SFX.shot, 0.78); },
  jump() { this.play(SFX.jump, 0.42); },
  draw() { this.play(SFX.draw, 0.55); },
  holster() { this.play(SFX.holster, 0.55); },
  pickup() { this.tone(780, 0.12, 'sine', 0.06); },
  start() { this.play(SFX.start, 0.7); },
  win() {
    stopEndingSong();
    musicTriggerPlayer.stop();
    if (!this.enabled) return;
    this.ensure();
    endingSong = createUnlockedAudio(endingTrack(state.level));
    endingSong.loop = false;
    endingSong.volume = 0.7;
    void endingSong.play().catch(() => {});
  },
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

  const storyLevel = isApexPeakLevel() || isB3Level();
  if (storyLevel) {
    const items = storyCarry.length
      ? storyCarry
      : [{ id: 'empty', name: 'Nothing carried', note: 'The sidearm stays in the weapon slot.' }];
    inventoryItems.innerHTML = [
      ...items.map((item) => `<span class="inventory-item"><strong>${item.name}</strong><span class="inventory-note">${item.note}</span></span>`),
      supplyRow('Ammo boxes', 'ammo', 'One box refills the clip.'),
      supplyRow('Medkits', 'medkit', 'Restores 40.'),
    ].join('');
  } else {
    const invEntries = [
      ['Ammo boxes', 'ammo'],
      ['Medkits', 'medkit'],
      ['Scrap', 'scrap'],
      ['Cores', 'power_core'],
    ] as const;
    inventoryItems.innerHTML = invEntries
      .map(([label, item]) => `<span class="inventory-item"><span class="inventory-label">${label}</span><strong>${itemCount(state.inventory, item)} / ${ITEM_CAP[item]}</strong></span>`)
      .join('');
  }

  if (weaponSlot && weaponSlotState) {
    const drawn = state.player.weaponDrawn;
    const boxes = state.inventory.items.ammo ?? 0;
    const boxLabel = boxes === 1 ? 'box' : 'boxes';
    weaponSlotState.textContent = `${drawn ? 'Drawn' : 'Holstered'} · ${state.player.clip}/${CLIP_SIZE} · ${boxes}/${ITEM_CAP.ammo} ${boxLabel}`;
    weaponSlot.classList.toggle('drawn', drawn);
    weaponSlot.setAttribute('aria-pressed', drawn ? 'true' : 'false');
    weaponSlot.disabled = weaponBusy || !state.running || state.inCutscene || phone.locksBody() || phone.isRaised();
  }
  sidearmHint?.classList.toggle('drawn', state.player.weaponDrawn);
  sidearmHint?.setAttribute('aria-pressed', state.player.weaponDrawn ? 'true' : 'false');
  syncPhoneHud();
  syncInteractHint();
  syncReloadHint();
};

const syncPhoneHud = () => {
  const view = phone.view();
  phonePanel?.classList.toggle('focused', view.focused);
  const shotHidesPanel = state.inCutscene && !phone.locksBody();
  phonePanel?.toggleAttribute('hidden', shotHidesPanel || !view.panel);
  if (phoneStatus) phoneStatus.textContent = view.status;
  if (phoneContact) phoneContact.textContent = view.contact;
  if (phoneDetail) phoneDetail.textContent = view.detail;
  if (phoneClock) phoneClock.textContent = view.clock;
  if (phoneSpeaker) phoneSpeaker.textContent = view.speaker && view.line ? view.speaker : '';
  if (phoneLine) phoneLine.textContent = view.line;
  phoneAnswer?.toggleAttribute('hidden', !view.showAnswer);
  phoneEnd?.toggleAttribute('hidden', !view.showEnd);
  phoneFlash?.toggleAttribute('hidden', !view.showFlash);
  if (phoneFlash) {
    phoneFlash.textContent = view.flashlight ? 'Light on' : 'Flashlight';
    phoneFlash.classList.toggle('on', view.flashlight);
  }
  if (phoneMessages) {
    phoneMessages.hidden = !view.showMessages;
    phoneMessages.innerHTML = !view.showMessages
      ? ''
      : view.messages.length
        ? view.messages.map((message) => `<div class="phone-message"><strong>${message.from}</strong>${message.text}</div>`).join('')
        : '<div class="phone-empty">No messages</div>';
  }
  if (phoneToast) {
    phoneToast.hidden = !view.toast;
    phoneToast.textContent = view.toast;
  }
  phoneHint?.classList.toggle('raised', view.screen);
  phoneHint?.classList.toggle('ringing', view.ringing);
  lightHint?.classList.toggle('lit', view.flashlight);
  if (phoneBadge) {
    phoneBadge.hidden = !view.badge;
    phoneBadge.textContent = view.badge;
  }
  followCamera.setCallFrame(phone.wantsCallCamera() && !state.inCutscene);
};

let inventoryOpen = false;
let weaponBusy = false;
let reloadReadyAt = 0;
let reloadNote = '';
let reloadNoteUntil = 0;

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

const nextPlayableLevel = () => {
  const next = getLevels()[state.level];
  if (!next || next.comingSoon) return null;
  return next;
};

let levelPicked = false;

const menuMode = () => {
  if (!gameReady) return 'loading' as const;
  if (messageTitle.textContent === 'Level Complete') return 'level-complete' as const;
  if (!state.running && messageTitle.textContent === 'PH Origins' && hasProgress() && !levelPicked) return 'resume' as const;
  return 'play' as const;
};

const syncStartButtonLabel = () => {
  const loading = !gameReady;
  startBtn.disabled = loading;
  resetBtn.disabled = loading;
  loadModelBtn.disabled = loading;
  newGameBtn.disabled = loading;
  if (loading) {
    startBtn.textContent = 'Loading…';
    startBtn.setAttribute('aria-busy', 'true');
    startBtn.style.display = '';
    newGameBtn.style.display = 'none';
    if (messageTitle.textContent === 'PH Origins') messageText.textContent = levelLoadingLine();
    return;
  }
  startBtn.removeAttribute('aria-busy');

  const mode = menuMode();
  if (mode === 'level-complete') {
    const next = nextPlayableLevel();
    startBtn.disabled = !next;
    startBtn.style.display = next ? '' : 'none';
    startBtn.textContent = 'Continue';
    newGameBtn.style.display = 'none';
    resetBtn.style.display = 'none';
    loadModelBtn.textContent = 'Exit';
    loadModelBtn.style.display = '';
    return;
  }

  const resume = mode === 'resume';
  startBtn.disabled = false;
  startBtn.style.display = '';
  startBtn.textContent = resume || state.running ? 'Continue' : 'Start';
  if (resume && messageTitle.textContent === 'PH Origins') {
    messageText.textContent = levelStartLine(getLevelDefinition(savedLevelId()));
  } else if (!state.running && messageTitle.textContent === 'PH Origins') {
    messageText.textContent = levelStartLine();
  }
  newGameBtn.style.display = resume ? '' : 'none';
  resetBtn.style.display = '';
  const hideLoad = messageTitle.textContent === 'Defeat' || messageTitle.textContent === 'Mission Clear';
  loadModelBtn.textContent = 'Load Level';
  loadModelBtn.style.display = hideLoad ? 'none' : '';
  loadModelBtn.disabled = !hasProgress();
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
  if (state.inCutscene) {
    weaponBusy = false;
    return;
  }
  state.player.weaponDrawn = drawn;
  playerAvatar.setArmed(drawn);
  playerPistol.setVisible(drawn);
  weaponBusy = false;
  playerAvatar.resumeLocomotion();
  updateHud();
  updateCrosshairVisibility();
  if (!drawn && armPhoneAfterHolster) {
    armPhoneAfterHolster = false;
    const withLight = armFlashAfterRaise;
    armFlashAfterRaise = false;
    if (withLight) {
      phone.setRaised(true);
      phone.setFlashlight(true);
    } else phone.setScreen(true);
    syncEquippedCamera();
    updateHud();
  }
};

let armPhoneAfterHolster = false;
let armFlashAfterRaise = false;

const syncEquippedCamera = () => {
  const close = phone.flashlightOn() || state.player.weaponDrawn;
  followCamera.setOverShoulder(close);
  followCamera.setToolClose(close);
};

const clearHands = () => {
  armPhoneAfterHolster = false;
  armFlashAfterRaise = false;
  weaponBusy = false;
  state.player.weaponDrawn = false;
  playerPistol.setVisible(false);
  playerAvatar.setArmed(false);
  followCamera.setOverShoulder(false);
  followCamera.setToolClose(false);
  if (phone.isRaised()) phone.setRaised(false);
  else phone.setFlashlight(false);
  updateCrosshairVisibility();
};

const raisePhone = () => {
  if (!state.running || state.inCutscene || weaponBusy) return;
  if (phone.locksBody()) {
    if (phone.view().showAnswer) phone.answer();
    return;
  }
  if (phone.flashlightOn()) {
    phone.setScreen(!phone.isScreenOpen());
    updateHud();
    return;
  }
  if (phone.isRaised() || phone.isScreenOpen()) {
    phone.setRaised(false);
    playerAvatar.resumeLocomotion();
    updateHud();
    return;
  }
  if (state.player.weaponDrawn) {
    armPhoneAfterHolster = true;
    armFlashAfterRaise = false;
    toggleWeapon();
    return;
  }
  phone.setScreen(true);
  updateHud();
};

const toggleFlashlight = () => {
  if (!state.running || state.inCutscene || weaponBusy || phone.locksBody()) return;
  if (!phone.isRaised()) {
    if (state.player.weaponDrawn) {
      armPhoneAfterHolster = true;
      armFlashAfterRaise = true;
      toggleWeapon();
      return;
    }
    phone.setRaised(true);
    phone.setFlashlight(true);
    syncEquippedCamera();
    updateHud();
    return;
  }
  if (phone.flashlightOn() && !phone.isScreenOpen()) {
    phone.setRaised(false);
    playerAvatar.resumeLocomotion();
    syncEquippedCamera();
    updateHud();
    return;
  }
  phone.setFlashlight(!phone.flashlightOn());
  syncEquippedCamera();
  updateHud();
};

const toggleWeapon = () => {
  if (!state.running || state.inCutscene || weaponBusy || phone.locksBody()) return;
  if (phone.isRaised()) phone.setRaised(false);
  const drawing = !state.player.weaponDrawn;
  weaponBusy = true;
  followCamera.setOverShoulder(drawing);
  followCamera.setToolClose(drawing);
  if (drawing) playerPistol.setVisible(true);
  if (!drawing) {
    state.player.weaponDrawn = false;
    updateCrosshairVisibility();
  }
  updateHud();
  const keyword = drawing ? 'draw' : 'holster';
  if (drawing) audio.draw();
  else audio.holster();
  const played = playerAvatar.playClip(keyword, false, 4, () => finishWeaponToggle(drawing));
  if (!played) finishWeaponToggle(drawing);
  setInventoryOpen(false);
};

weaponSlot?.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleWeapon();
});
sidearmHint?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (state.running && messageBox.classList.contains('hidden')) toggleWeapon();
});
lightHint?.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleFlashlight();
});
medkitHint?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (messageBox.classList.contains('hidden')) useMedkit();
});

const onPhoneControl = (event: Event) => {
  event.stopPropagation();
  if (phone.view().showAnswer) phone.answer();
  else raisePhone();
  updateHud();
};
phoneHint?.addEventListener('click', onPhoneControl);
phoneBtn?.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  onPhoneControl(event);
});
phoneAnswer?.addEventListener('click', (event) => {
  event.stopPropagation();
  phone.answer();
  updateHud();
});
phoneEnd?.addEventListener('click', (event) => {
  event.stopPropagation();
  phone.end();
  updateHud();
});
phoneFlash?.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleFlashlight();
});
phonePanel?.addEventListener('pointerdown', (event) => event.stopPropagation());

const levelCredits = document.getElementById('levelCredits') as HTMLDivElement | null;

const stopLevelCredits = () => {
  if (!levelCredits) return;
  levelCredits.hidden = true;
  levelCredits.innerHTML = '';
};

const startLevelCredits = (levelId: number) => {
  if (!levelCredits) return;
  const markup = renderLevelCredits(levelId);
  if (!markup) {
    stopLevelCredits();
    return;
  }
  levelCredits.hidden = false;
  levelCredits.innerHTML = markup;
};

const showMessage = (title: string, text: string) => {
  messageTitle.textContent = title;
  messageText.textContent = text;
  syncStartButtonLabel();
  unlockPointer();
  levelSelect.classList.add('hidden');
  messageBox.classList.remove('hidden');
  if (title === 'Level Complete' || title === 'Mission Clear') startLevelCredits(state.level);
  else stopLevelCredits();
  updateCrosshairVisibility();
};

const hideMessage = () => {
  stopLevelCredits();
  messageBox.classList.add('hidden');
  updateCrosshairVisibility();
};

const clearDynamicObjects = () => {
  clearEnemies(enemies);
  for (const particle of particles) {
    particle.mesh.dispose();
  }
  for (let i = pickups.length - 1; i >= 0; i--) {
    if (!pickups[i].runtime) continue;
    pickups[i].mesh.dispose();
    pickups.splice(i, 1);
  }
  particles.length = 0;
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
  if (missionScene) applySceneLighting(scene, missionScene);
  grade.apply(config.theme);
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
  playerPistol.setVisible(false);
  playerAvatar.resumeLocomotion();
  phone.silence();
  followCamera.setCallFrame(false);
  muzzleFlash.hide();
  followCamera.setOverShoulder(false);
  followCamera.setToolClose(false);
  state.progression.currentLevel = selectedLevel;
  state.progression.highestUnlocked = getUnlockedLevelCount(Math.max(1, state.progression.highestUnlocked));
  state.inventory = createInventoryState();
  state.quests = createQuestState();
  state.characterYaw = 0;
  applyLevelConfig(getLevelDefinition(selectedLevel));
  followCamera.reset();
};

let applyHurt = (_amount: number) => {};
let stockSidearm = () => {};

act = createAct1({
  scene,
  hemi,
  sun,
  camera,
  alarmFlash,
  getMission: () => missionScene,
  getNpcs: () => npcs,
  isApex: isApexPeakLevel,
  isB3: isB3Level,
  playerXZ: () => ({ x: state.player.x, z: state.player.z }),
  running: () => state.running,
  inCutscene: () => state.inCutscene,
  setObjective,
  showObjective: showObjectiveHud,
  hideMarker: () => objectiveMarker.hide(),
  showMarker: () => objectiveMarker.show(),
  clearMarker: () => objectiveMarker.setTarget(null),
  clearObjectiveCue: () => { lastObjectiveCue = ''; },
  placePierce,
  playClip: (clip, loop, speed) => { playerAvatar.playClip(clip, loop, speed); },
  resumeLocomotion: () => playerAvatar.resumeLocomotion(),
  holdLocomotion: () => playerAvatar.setLocomotion(false, true),
  swapAvatar: (assetId) => ensurePlayerAvatar(assetId),
  seatHead: seatPlayerAtHeadChair,
  leaveHead: leavePlayerAtHeadChair,
  beginCutscene: beginNamedCutscene,
  ringCall: (id) => {
    clearHands();
    phone.ring(id);
    updateHud();
  },
  pushPhoneText: (id) => {
    phone.pushText(id);
    updateHud();
  },
  silencePhone: () => {
    phone.silence();
    followCamera.setCallFrame(false);
  },
  playFile: (url, volume) => audio.play(url, volume),
  audioOn: () => audio.enabled,
  ensureAudio: () => audio.ensure(),
  tone: (hz, seconds, type, gain) => audio.tone(hz, seconds, type, gain),
  win: () => audio.win(),
  showMessage,
  haltPlay: () => { state.running = false; },
  clearInput: () => clearInputState(),
  unlockNext: () => {
    const next = getLevels()[state.level];
    const resumeId = next && !next.comingSoon ? next.id : state.level;
    state.progression.highestUnlocked = getUnlockedLevelCount(Math.max(state.progression.highestUnlocked, state.level + 1));
    saveGame({
      unlocked: Math.max(save.unlocked ?? 1, state.progression.highestUnlocked),
      level: Math.max(save.level ?? 1, resumeId),
      sound: audio.enabled,
    });
  },
  refreshHud: () => updateHud(),
  setCarry: (items) => { storyCarry = items; },
  hurt: (amount) => applyHurt(amount),
  stockAmmo: () => stockSidearm(),
  beamAt: (at) => {
    if (!at || phone.locksBody()) {
      phone.aimBeam(null);
      return;
    }
    if (!phone.isRaised()) phone.setRaised(true);
    if (!phone.flashlightOn()) phone.setFlashlight(true);
    phone.aimBeam(at);
  },
  frameCamera: (position, lookAt) => followCamera.setCinematic(position, lookAt),
  fade: (to, seconds) => screenFade.to(to, seconds ?? 0),
});

const beginGame = () => {
  if (!gameReady) return;
  stopEndingSong();
  screenFade.to(0, 0.8);
  audio.start();
  state.running = true;
  menuCameraActive = false;
  activateGameCamera(scene, camera);
  clearDynamicObjects();
  resetPlayer(true);
  syncStartButtonLabel();
  updateHud();
  hideMessage();
  act.onStart();
};

let startingLevel = false;

const startAtLevel = async (levelId: number) => {
  if (startingLevel || !gameReady) return;
  const level = getLevelDefinition(levelId);
  if (level.comingSoon) return;
  startingLevel = true;
  unlockAudio();
  try {
    state.level = level.id;
    state.progression.currentLevel = level.id;
    if (missionScene?.id !== level.libraryId) {
      applyLevelConfig(level);
      await loadMissionScene(level.path);
    }
    beginGame();
  } catch {
    state.running = false;
    showMessage('PH Origins', levelStartLine());
  } finally {
    startingLevel = false;
  }
};

void (async () => {
  await loadLevelLibrary();
  const firstLevel = getLevels()[0];
  if (firstLevel) applyLevelConfig(firstLevel);
  await loadMissionScene(firstLevel?.path ?? DEFAULT_SCENE_FILE_PATH);
  const params = new URLSearchParams(location.search);
  const beat = params.get('beat');
  const cutscene = params.get('cutscene');
  if (cutscene === 'b3-vat-break') {
    state.level = 2;
    state.progression.currentLevel = 2;
    const level = getLevelDefinition(2);
    applyLevelConfig(level);
    await loadMissionScene(level.path);
    beginGame();
    placePierce(18.5, 38, -Math.PI / 2);
    beginNamedCutscene('b3-vat-break');
  } else if (cutscene === 'b3-door-reveal') {
    state.level = 2;
    state.progression.currentLevel = 2;
    const level = getLevelDefinition(2);
    applyLevelConfig(level);
    await loadMissionScene(level.path);
    beginGame();
    beginNamedCutscene('b3-door-reveal');
  } else if (cutscene === 'elevator-b3') {
    act.armPhase('elevator');
    beginGame();
    act.handleTrigger({ id: 'trigger-elevator-b3', type: 'enter_zone' });
  } else if (cutscene === 'apex-window') {
    act.armPhase('window');
    beginGame();
    beginNamedCutscene('apex-window');
  } else if (beat === 'voss') {
    act.armPhase('call');
    beginGame();
    act.startCall();
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
  pickups.push({ mesh, item, amount, active: true, runtime: true, baseY: mesh.position.y, phase: Math.random() * Math.PI * 2 });
};

const updateQuestTracker = () => {
  if (isApexPeakLevel() || isB3Level()) return;
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
    screenFade.to(1, 1.15);
    showMessage('Mission Clear', GAME_COPY.missionClear);
  } else {
    audio.hit();
    showMessage('Defeat', GAME_COPY.defeat);
  }
};

applyHurt = (amount: number) => {
  if (!state.running || state.inCutscene) return;
  state.health = Math.max(0, state.health - amount);
  state.lastDamageAt = performance.now();
  audio.hit();
  alarmFlash?.classList.add('visible');
  window.setTimeout(() => alarmFlash?.classList.remove('visible'), 140);
  updateHud();
  if (state.health <= 0) finishGame(false);
};

stockSidearm = () => {
  state.player.clip = CLIP_SIZE;
  if ((state.inventory.items.ammo ?? 0) < 1) state.inventory.items.ammo = 1;
  updateHud();
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
    muzzleFlash.mesh,
    ...playerAvatar.group.getChildMeshes(true),
    ...phone.meshes(),
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
  if (state.inCutscene || phone.locksBody()) {
    state.player.jumpWindup = 0;
    state.input.jump = false;
    playerCollider.position.set(state.player.x, state.player.y, state.player.z);
    if (phone.locksBody()) {
      playerAvatar.setLocomotion(false, true);
      audio.setWalk(false);
    }
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
      audio.jump();
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
  audio.setWalk(
    moving
    && !jumpAnim
    && state.running
    && !state.inCutscene
    && !inventoryOpen
    && messageBox.classList.contains('hidden'),
  );

  const forwardDot = moveHeading === null ? 0 : Math.sin(yaw) * Math.sin(moveHeading) + Math.cos(yaw) * Math.cos(moveHeading);
  return { moving, moveHeading: moving && forwardDot > 0.45 ? moveHeading : null };
};

const SUPPLY_LABEL: Record<InventoryItemType, string> = {
  ammo: 'Ammo box',
  medkit: 'Medkit',
  scrap: 'Scrap',
  power_core: 'Core',
};

const supplyRow = (label: string, item: InventoryItemType, note: string) =>
  `<span class="inventory-item"><span class="inventory-label">${label}</span><strong>${itemCount(state.inventory, item)} / ${ITEM_CAP[item]}</strong><span class="inventory-note">${note}</span></span>`;

const bindScenePickups = () => {
  for (let i = pickups.length - 1; i >= 0; i--) {
    if (pickups[i].runtime) continue;
    pickups.splice(i, 1);
  }
  for (const mesh of scene.meshes) {
    const meta = mesh.metadata as { pickup?: { item: InventoryItemType; amount?: number } } | null;
    if (!meta?.pickup) continue;
    pickups.push({
      mesh,
      item: meta.pickup.item,
      amount: meta.pickup.amount ?? 1,
      active: true,
      runtime: false,
      baseY: mesh.position.y,
      phase: mesh.position.x * 0.37 + mesh.position.z,
    });
  }
};

const nearestSupply = () => {
  let best: (typeof pickups)[number] | null = null;
  let bestD = 1.25;
  for (const pickup of pickups) {
    if (!pickup.active || pickup.mesh.isDisposed() || !pickup.mesh.isEnabled()) continue;
    const at = pickup.mesh.getAbsolutePosition();
    const dist = Math.hypot(at.x - state.player.x, at.z - state.player.z);
    if (dist < bestD) {
      bestD = dist;
      best = pickup;
    }
  }
  return best;
};

const takeSupply = (pickup: (typeof pickups)[number]) => {
  const taken = addItem(state.inventory, pickup.item, pickup.amount);
  if (taken <= 0) {
    showReloadNote(`${SUPPLY_LABEL[pickup.item]} full`);
    audio.hit();
    return;
  }
  pickup.active = false;
  pickup.mesh.setEnabled(false);
  audio.pickup();
  updateHud();
};

const useMedkit = () => {
  if (!state.running || state.inCutscene) return;
  if (state.health >= MAX_HEALTH) {
    showReloadNote('Health full');
    return;
  }
  if (!consumeItem(state.inventory, 'medkit', 1)) {
    showReloadNote('No medkits');
    audio.hit();
    return;
  }
  state.health = Math.min(MAX_HEALTH, state.health + 40);
  showReloadNote('Medkit');
  audio.tone(520, 0.08, 'sine', 0.05);
  updateHud();
};

const syncInteractHint = () => {
  if (!interactHint) return;
  const pickup = state.running && !state.inCutscene && !inventoryOpen ? nearestSupply() : null;
  if (!pickup) {
    interactHint.hidden = true;
    return;
  }
  const label = SUPPLY_LABEL[pickup.item];
  interactHint.hidden = false;
  interactHint.textContent = roomFor(state.inventory, pickup.item) > 0 ? `${label} — E` : `${label} full`;
};

const showReloadNote = (text: string, seconds = 1.6) => {
  reloadNote = text;
  reloadNoteUntil = performance.now() + seconds * 1000;
  syncReloadHint();
};

const syncReloadHint = () => {
  if (!reloadHint) return;
  const now = performance.now();
  const note = reloadNote && now < reloadNoteUntil ? reloadNote : '';
  const emptyClip = state.running
    && state.player.weaponDrawn
    && state.player.clip <= 0
    && !state.inCutscene
    && messageBox.classList.contains('hidden');
  const text = note || (emptyClip ? 'Reload — press R' : '');
  reloadHint.hidden = !text;
  reloadHint.textContent = text;
};

const reloadWeapon = () => {
  if (!state.running || state.inCutscene || inventoryOpen || weaponBusy || phone.locksBody() || phone.isRaised()) return;
  if (performance.now() < reloadReadyAt) return;
  if (state.player.clip >= CLIP_SIZE) return;
  if (!consumeItem(state.inventory, 'ammo', 1)) {
    showReloadNote('Out of ammo');
    audio.hit();
    return;
  }
  state.player.clip = CLIP_SIZE;
  reloadReadyAt = performance.now() + 700;
  audio.tone(210, 0.07, 'square', 0.04);
  window.setTimeout(() => audio.tone(320, 0.05, 'square', 0.03), 160);
  updateHud();
};

const fireWeapon = () => {
  if (!state.running || state.inCutscene || inventoryOpen || weaponBusy || phone.isRaised() || phone.locksBody() || !state.player.weaponDrawn || state.shootCooldown > 0) return;
  if (performance.now() < reloadReadyAt) return;
  if (state.player.clip <= 0) {
    state.shootCooldown = 0.35;
    audio.hit();
    syncReloadHint();
    return;
  }
  state.player.clip -= 1;
  state.shootCooldown = state.fireRate;
  audio.shoot();
  if (playerPistol.isVisible()) muzzleFlash.showAt(playerPistol.muzzle);
  else muzzleFlash.show(camera, gatherCameraIgnoreMeshes());
  playerAvatar.playClip('shoot', false, 3, () => playerAvatar.resumeLocomotion());
  const aim = camera.getDirection(BABYLON.Vector3.Forward());
  act.shotAt(camera.globalPosition, aim);
  stampBulletMark(scene, camera.globalPosition, aim, gatherCameraIgnoreMeshes());
  updateHud();
};

const levelAllowsCombat = () => {
  const config = getLevelDefinition(state.level);
  return config.combat === true && config.libraryId !== 'apex-peak' && config.libraryId !== 'b3-basement' && config.enemyCount > 0;
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
  if (key === 'p') {
    const menuOpen = !messageBox.classList.contains('hidden');
    if (!menuOpen) beginGame();
    else if (!startBtn.disabled && startBtn.style.display !== 'none') startBtn.click();
  }
  if (key === 'i') {
    event.preventDefault();
    setInventoryOpen(!inventoryOpen);
  }
  if (key === 'f') {
    event.preventDefault();
    if (phone.view().showAnswer) phone.answer();
    else raisePhone();
    updateHud();
  }
  if (key === 'g') {
    event.preventDefault();
    toggleFlashlight();
  }
  if (key === 'q') {
    event.preventDefault();
    if (state.running && messageBox.classList.contains('hidden')) toggleWeapon();
  }
  if (key === 'r') {
    event.preventDefault();
    if (state.running && messageBox.classList.contains('hidden')) reloadWeapon();
  }
  if (key === 'e') {
    event.preventDefault();
    const pickup = nearestSupply();
    if (pickup && state.running && !state.inCutscene && !inventoryOpen && messageBox.classList.contains('hidden')) takeSupply(pickup);
  }
  if (key === 'h') {
    event.preventDefault();
    if (messageBox.classList.contains('hidden')) useMedkit();
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
  const mode = menuMode();
  if (mode === 'level-complete') {
    const next = nextPlayableLevel();
    if (next) void startAtLevel(next.id);
    return;
  }
  if (mode === 'resume') {
    void startAtLevel(savedLevelId());
    return;
  }
  beginGame();
});
newGameBtn.addEventListener('click', () => {
  unlockAudio();
  void startAtLevel(1);
});
canvas.addEventListener('pointerdown', () => unlockAudio());
installAudioUnlock();
resetBtn.addEventListener('click', () => {
  stopEndingSong();
  screenFade.to(0, 0);
  clearSave();
  save = { ...defaultSave, sound: audio.enabled };
  levelPicked = false;
  state.running = false;
  state.level = 1;
  state.progression.currentLevel = 1;
  state.progression.highestUnlocked = 1;
  clearDynamicObjects();
  clearInputState();
  resetPlayer();
  void loadMissionScene(getLevelDefinition(1).path);
  updateHud();
  showMessage('PH Origins', levelStartLine());
  menuCameraActive = true;
  activateMenuCamera(scene, menuCamera);
});

const renderLoop = () => {
  const delta = engine.getDeltaTime() / 1000;
  screenFade.update(delta);
  state.shootCooldown = Math.max(0, state.shootCooldown - delta);
  muzzleFlash.update();

  if (state.running) {
    if (state.inCutscene && activeCutscene) {
      audio.setWalk(false);
      grade.setFear(act.fearLevel());
      act.beforeCutsceneStep(activeCutscene.id, activeCutscene.time);
      const playing = stepCutscene(activeCutscene, delta);
      if (!playing) endCutscene();
      act.alarmTick(delta);
      objectiveMarker.update(delta);
      updateCamera(delta, false, null);
      if (activeCutscene) act.afterCamera(activeCutscene.time);
    } else {
    phone.update(delta, followCamera.camera, state.player);
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
    act.stepWorld(delta);
    const fear = act.fearLevel();
    grade.setFear(fear);
    phone.setFear(fear);
    act.alarmTick(delta);
    if (!state.inCutscene) objectiveMarker.update(delta);
    if (objectiveHud?.classList.contains('visible') && objectiveDist) {
      const target = objectiveMarker.getTarget();
      objectiveDist.textContent = target
        ? `${objectiveMarker.distanceTo(state.player.x, state.player.z).toFixed(1)} m`
        : '';
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

    const bob = performance.now() * 0.001;
    for (let i = pickups.length - 1; i >= 0; i--) {
      const pickup = pickups[i];
      if (!pickup.active || pickup.mesh.isDisposed()) {
        if (pickup.mesh.isDisposed()) pickups.splice(i, 1);
        continue;
      }
      pickup.mesh.position.y = pickup.baseY + Math.sin(bob * 2.1 + pickup.phase) * 0.03;
      if (pickup.runtime) pickup.mesh.rotation.y += delta * 1.4;
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life <= 0) particles.splice(i, 1);
    }

    if (levelAllowsCombat() && state.kills >= 12) {
      state.progression.highestUnlocked = getUnlockedLevelCount(Math.max(state.progression.highestUnlocked, state.level + 1));
      finishGame(true);
    }

    state.progression.xp = Math.max(0, state.kills * 5);
    state.progression.medals = Math.max(0, Math.floor(state.kills / 3));
    updateQuestTracker();
    updateHud();
    }
  } else {
    if (act.doneHold()) {
      clearInputState();
      playerAvatar.setLocomotion(false, true);
    }
    audio.setWalk(false);
    if (!menuCameraActive) updateCamera(delta);
  }

  musicTriggerPlayer.update(
    camera.position,
    delta,
    state.running && audio.enabled,
    state.inCutscene ? 0.18 : 1,
  );

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

const themeOrder = ['Apex Peak', 'B3 Basement', 'Neon Drift', 'Crimson Surge', 'Arctic Rift'] as const;
let activeThemeName = typeof devLevelConfig?.theme === 'string' ? devLevelConfig.theme : 'Neon Drift';

const cycleTheme = () => {
  const currentIndex = themeOrder.indexOf(activeThemeName as (typeof themeOrder)[number]);
  const nextTheme = themeOrder[(currentIndex + 1) % themeOrder.length];
  activeThemeName = nextTheme;
  applyTheme(scene, nextTheme);
  if (missionScene) applySceneLighting(scene, missionScene);
  grade.apply(nextTheme);
  devOutput.value = `Theme applied: ${nextTheme}`;
  if (devLevelConfig) {
    localStorage.setItem('ph-origins-level-config', JSON.stringify({ ...devLevelConfig, theme: nextTheme, updatedAt: new Date().toISOString() }));
  }
};

const isLocalPlay = () => (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

if (isLocalPlay()) devToggle.hidden = false;

const renderLevelSelect = () => {
  levelList.innerHTML = '';
  const levels = getLevels();

  levels.forEach((level) => {
    const comingSoon = level.comingSoon;
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
      levelPicked = true;
      state.level = level.id;
      state.progression.currentLevel = level.id;
      applyLevelConfig(level);
      void loadMissionScene(level.path);
      levelSelect.classList.add('hidden');
      messageTitle.textContent = 'PH Origins';
      messageText.textContent = levelStartLine(level);
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
  if (menuMode() === 'level-complete') {
    window.location.assign('/');
    return;
  }
  if (!hasProgress()) return;
  showLevelSelect();
});
closeLevelSelectBtn.addEventListener('click', () => {
  levelSelect.classList.add('hidden');
  messageTitle.textContent = 'PH Origins';
  messageText.textContent = levelStartLine();
  syncStartButtonLabel();
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
    if (!audio.enabled) audio.setWalk(false);
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
showMessage('PH Origins', levelStartLine());
updateHud();

updateCrosshairVisibility();
configureResponsiveUI(root);
engine.runRenderLoop(renderLoop);
window.addEventListener('resize', () => {
  configureResponsiveUI(root);
  engine.resize();
});
