import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders';

import { configureResponsiveUI, detectDevice } from './game/mobile';
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
import { callQuestOpen, missionCallId, missionLabel, missionsFor } from './game/missions';
import { clampPlayerToArena, CLIP_SIZE, createPlayerCollider, createPlayerState, flyPlayer, movePlayerOnGround, PLAYER_STAND_Y, playerMeshY, requestJump, updateVerticalMotion } from './game/player';
import { createBurst } from './game/physics';
import { createThirdPersonCamera, lerpAngle } from './game/thirdPersonCamera';
import { activateGameCamera, activateMenuCamera, createMenuCamera } from './game/menuCamera';
import { whenSkyboxReady } from './game/skybox';
import { createQuestState, getGoalText, updateQuestProgress } from './game/progression';
import { createSceneGrade } from './game/grade';
import { createShadowVeil } from './game/shadowVeil';
import { createPhone } from './game/phone';
import { mountPipeDrips } from './game/drips';
import { createLevelDressing } from './game/levelDressing';
import { applySceneLighting, applyTheme, getSceneTheme } from './game/scene';
import { importAssetFile } from './game/importer';
import { PLAYER_ASSET_ID, PLAYER_ASSET_IDS, TRANSFORM_HERO_ASSET_ID } from './game/modelLoader';
import { DEFAULT_SCENE_FILE_PATH, disposeSceneNodes, loadSceneFromJson, loadSceneFromJsonFile, readSceneData, type SceneData, type SceneTrigger } from './game/sceneData';
import { createMusicTriggerPlayer, createTriggerRunner, isMusicTrigger } from './game/triggers';
import { applyNpcAnim, skipToEnd, startCutscene, stepCutscene, stopCutsceneAudio, type ActiveCutscene } from './game/cutscenes';
import { createAct1, type Act1, type StoryCarry } from './story/act1';
import { createGoingHome, type GoingHome } from './story/goingHome';
import { createTheDesk, type TheDesk } from './story/theDesk';
import { createTheStation, type TheStation } from './story/theStation';
import { createTheTrain, ENDING_TRACK as TRAIN_ENDING_TRACK, TRAIN_CREDITS, type TheTrain } from './story/theTrain';
import { renderLevelCredits } from './story/credits';
import { POSSESS_SECONDS, SHADOW_RUN_SECONDS, SHADOW_RUN_SPEED } from './story/streetRules';
import { audioContextState, busInput, createUnlockedAudio, getSharedAudioContext, holdAllAudio, installAudioUnlock, liveAudioElementCount, releaseAllAudio, releaseUnlockedAudio, routedAudioElementCount, unlockAudio } from './game/audioUnlock';
import { holdClips, liveClipCount, mixVolume, playClip, preloadClips, releaseClips, startGaplessLoop, type ClipHandle, type LoopHandle } from './game/sfxMix';
import { createMuzzleFlash } from './game/muzzleFlash';
import { createPlayerPistol } from './game/pistol';
import { createObjectiveMarker } from './game/objectiveMarker';
import { createMinimap } from './game/minimap';
import { createScreenFade } from './game/fade';
import { createPerfMonitor } from './game/perfMonitor';
import { createAutoAim } from './game/autoAim';
import { installPhPlaytest } from './playtest/phPlaytest';
import { createGameAnalytics, type GameAnalytics } from './game/analytics';
import { onSoundSettings, setSoundSettings, soundSettings } from './game/soundSettings';
import type { InventoryItemType, InventoryState, LevelDefinition, ProgressionState, QuestState } from './game/types';

// The load-error card lives in game.html's inline script, so it still shows when this module never runs.
type LoadFailure = 'files' | 'error' | 'level' | 'timeout' | 'graphics';
const phBoot = (window as {
  __phBoot?: {
    started(): void; ready(): void; idleMs(): number;
    fail(kind: LoadFailure): void; failed(): LoadFailure | null; recover(): boolean;
  };
}).__phBoot;
const loadFailed = () => !!phBoot?.failed();
/** A level load that stalls this long (nothing finishing, page not busy: game.html's idleMs) shows the error card. */
const LEVEL_LOAD_STALL_MS = 20000;
const root = document.getElementById('game-root') as HTMLDivElement;
const screenFade = createScreenFade(document.getElementById('screenFade') as HTMLElement);
const healthBar = document.getElementById('healthBar') as HTMLDivElement;
const healthFill = document.getElementById('healthFill') as HTMLSpanElement;
const messageBox = document.getElementById('messageBox') as HTMLDivElement;
const messageTitle = document.getElementById('messageTitle') as HTMLHeadingElement;
const messageText = document.getElementById('messageText') as HTMLParagraphElement;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
if (!loadFailed()) {
  startBtn.disabled = true;
  startBtn.textContent = 'Loading…';
  startBtn.setAttribute('aria-busy', 'true');
}
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
const perfMonitor = createPerfMonitor(
  document.getElementById('perfFps') as HTMLElement,
  document.getElementById('perfMem') as HTMLElement,
);
const devHealth = document.getElementById('devHealth') as HTMLSpanElement;
const devLevel = document.getElementById('devLevel') as HTMLSpanElement;
const levelSelect = document.getElementById('levelSelect') as HTMLDivElement;
const levelList = document.getElementById('levelList') as HTMLDivElement;
const closeLevelSelectBtn = document.getElementById('closeLevelSelect') as HTMLButtonElement;
const crosshair = document.getElementById('crosshair') as HTMLDivElement;
const inventoryHud = document.getElementById('inventoryHud') as HTMLDivElement;
const inventoryHint = document.getElementById('inventoryHint') as HTMLButtonElement | null;
const missionsHud = document.getElementById('missionsHud') as HTMLDivElement | null;
const missionsHint = document.getElementById('missionsHint') as HTMLButtonElement | null;
const missionsClose = document.getElementById('missionsClose') as HTMLButtonElement | null;
const missionsList = document.getElementById('missionsList') as HTMLDivElement | null;
const missionsTitle = document.getElementById('missionsTitle') as HTMLElement | null;
const missionScore = document.getElementById('missionScore') as HTMLParagraphElement | null;
const sidearmHint = document.getElementById('sidearmHint') as HTMLButtonElement | null;
const lightHint = document.getElementById('lightHint') as HTMLButtonElement | null;
const abilityHint = document.getElementById('abilityHint') as HTMLButtonElement | null;
const abilityReadout = document.getElementById('abilityReadout') as HTMLDivElement | null;
const abilityName = document.getElementById('abilityName') as HTMLElement | null;
const possessBar = document.getElementById('possessBar') as HTMLDivElement | null;
const possessFill = document.getElementById('possessFill') as HTMLSpanElement | null;
const shadowRunBar = document.getElementById('shadowRunBar') as HTMLDivElement | null;
const shadowRunFill = document.getElementById('shadowRunFill') as HTMLSpanElement | null;
const skipCutsceneBtn = document.getElementById('skipCutscene') as HTMLButtonElement | null;
const shadowHint = document.getElementById('shadowHint') as HTMLButtonElement | null;
const medkitHint = document.getElementById('medkitHint') as HTMLButtonElement | null;
const inventoryItems = document.getElementById('inventoryItems') as HTMLDivElement;
const inventoryClose = document.getElementById('inventoryClose') as HTMLButtonElement;
const weaponSlot = document.getElementById('weaponSlot') as HTMLButtonElement | null;
const weaponSlotName = document.getElementById('weaponSlotName') as HTMLElement | null;
const weaponSlotState = document.getElementById('weaponSlotState') as HTMLSpanElement | null;
const reloadHint = document.getElementById('reloadHint') as HTMLButtonElement | null;
const interactHint = document.getElementById('interactHint') as HTMLButtonElement | null;
const actionHint = document.getElementById('actionHint') as HTMLButtonElement | null;
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
const phoneHome = document.getElementById('phoneHome') as HTMLElement | null;
const phoneSheet = document.getElementById('phoneSheet') as HTMLElement | null;
const phoneSheetTitle = document.getElementById('phoneSheetTitle') as HTMLElement | null;
const phoneSheetBody = document.getElementById('phoneSheetBody') as HTMLElement | null;
const phoneBack = document.getElementById('phoneBack') as HTMLButtonElement | null;
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

/**
 * Phones and tablets get the low-power tier: no MSAA or preserved drawing buffer, no SSAO, a cheaper bloom, and
 * a render size capped near a megapixel. `?quality=high` or `?quality=low` overrides it for a check.
 */
const qualityParam = new URLSearchParams(location.search).get('quality');
const lowPowerGraphics = qualityParam === 'low' || (qualityParam !== 'high' && (() => {
  const device = detectDevice();
  return device.isTouch && (device.isMobile || device.isTablet);
})());
const engine = new BABYLON.Engine(canvas, !lowPowerGraphics, {
  preserveDrawingBuffer: !lowPowerGraphics,
  stencil: true,
  powerPreference: lowPowerGraphics ? 'default' : 'high-performance',
});
const LOW_POWER_PIXELS = 1_000_000;
const applyRenderScale = () => {
  if (!lowPowerGraphics) return;
  const pixels = Math.max(1, canvas.clientWidth * canvas.clientHeight);
  engine.setHardwareScalingLevel(Math.max(1, Math.sqrt(pixels / LOW_POWER_PIXELS)));
};
applyRenderScale();
// A lost WebGL context leaves a frozen or crawling canvas. Show the load-error card with Retry instead, and log it
// so a bug report carries it.
engine.onContextLostObservable.add(() => {
  console.error('PH Origins: the WebGL context was lost (the graphics reset); showing Retry.');
  if (pauseMenu) pauseMenu.hidden = true;
  showLoadError('graphics');
});
engine.onContextRestoredObservable.add(() => {
  console.warn('PH Origins: the WebGL context came back; Retry reloads the game.');
});
const scene = new BABYLON.Scene(engine);
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as { __phScene?: BABYLON.Scene }).__phScene = scene;
const shadowVeil = createShadowVeil(scene);
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
const grade = createSceneGrade(scene, [followCamera.camera, menuCamera], { lowPower: lowPowerGraphics });

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
let dressedLevelId = 0;

const applyLoadedScene = (loaded: Awaited<ReturnType<typeof loadSceneFromJsonFile>>) => {
  if (loaded) {
    sceneNodes = loaded.nodes;
    missionScene = loaded.data;
    applyTheme(scene, loaded.data.theme || currentThemeName);
    applySceneLighting(scene, loaded.data);
    grade.setPowers(isReturnLevel() || isHomeLevel() || isDeskLevel());
    grade.apply(loaded.data.theme || currentThemeName);
    return;
  }
  missionScene = initialSceneData;
  disposeSceneNodes(sceneNodes);
  sceneNodes = loadSceneFromJson(scene, initialSceneData, sceneLoadOptions);
};

const npcs: Npc[] = [];
let activeCutscene: ActiveCutscene | null = null;
let storyCarry: StoryCarry[] = [];
let act: Act1;
let officeSwap = false;
let playerHeroId = PLAYER_ASSET_ID;
const objectiveMarker = createObjectiveMarker(scene);
const minimap = createMinimap(root);
const dressing = createLevelDressing(scene, camera);
let playerAvatar: PlayerAvatar = createPlayerAvatar(scene);
playerAvatar.group.rotation.y = Math.PI;
playerPistol.attachTo(playerAvatar);
let storyObjectiveId = () => 'seat';
let callQuestOpenFor = (_contactId: string) => false;
const phone = createPhone(scene, {
  soundOn: () => audio.enabled,
  objectiveId: () => storyObjectiveId(),
  callQuestOpen: (contactId) => callQuestOpenFor(contactId),
  onFinished: () => {
    followCamera.setCallFrame(false);
    act.onPhoneFinished();
  },
  onConnected: (contactId) => {
    const quest = missionCallId(contactId);
    if (quest) markMission(quest);
  },
  onCallEnded: (callId, how, heard, of) => analytics?.dialogue('call', callId, how, heard, of),
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
/** Hawkes Analytics (src/game/analytics.ts). Made at the end of this file, next to the playtest probe. */
let analytics: GameAnalytics | undefined;

const waitAvatarReady = (avatar: PlayerAvatar) =>
  new Promise<void>((resolve) => avatar.whenReady(resolve));

/** Hold black for a second, then fade clear over 1.5s. */
const revealFromBlack = (alive: () => boolean) => {
  window.setTimeout(() => {
    if (alive()) screenFade.to(0, 1.5);
  }, 1000);
};

const waitFrames = (count: number) =>
  new Promise<void>((resolve) => {
    let left = count;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      scene.onAfterRenderObservable.removeCallback(step);
      resolve();
    };
    const step = () => {
      left -= 1;
      if (left <= 0) done();
    };
    const timer = window.setTimeout(done, 700);
    scene.onAfterRenderObservable.add(step);
  });

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

if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
  Object.assign(window as unknown as Record<string, unknown>, {
    __phPlace: (x: number, z: number, yaw = 0) => placePierce(x, z, yaw),
    __phLook: (dx: number, dy: number) => followCamera.addLook(dx, dy),
    __phFrame: (p: { x: number; y: number; z: number } | null, l?: { x: number; y: number; z: number }) => {
      if (p && l) followCamera.setCinematic(p, l);
      else followCamera.clearCinematic();
    },
  });
}

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
  if (missionsOpen) renderMissions();
  if (!text || cue === lastObjectiveCue || !state.running) return;
  lastObjectiveCue = cue;
  audio.play(SFX.objective, 0.55);
};

const showObjectiveHud = (visible: boolean) => {
  if (!objectiveHud) return;
  objectiveHud.classList.toggle('visible', visible);
};

const isApexPeakLevel = () => getLevelDefinition(state.level).libraryId === 'apex-peak';

const isB3Level = () => getLevelDefinition(state.level).libraryId === 'b3-basement';

const isReturnLevel = () => getLevelDefinition(state.level).libraryId === 'the-return';
const isHomeLevel = () => getLevelDefinition(state.level).libraryId === 'going-home';
const isDeskLevel = () => getLevelDefinition(state.level).libraryId === 'the-desk';
const isStationLevel = () => getLevelDefinition(state.level).libraryId === 'the-station';
/** Level 7, hidden (`comingSoon`) until it is written. `?beat=train` and the `train` playtest enter it. */
const isTrainLevel = () => getLevelDefinition(state.level).libraryId === 'the-train';

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

/** Where Skip was pressed in the running timeline (seconds), for analytics; null when it played out. */
let cutsceneSkippedAt: number | null = null;

const endCutscene = () => {
  const finished = activeCutscene;
  const skippedAt = cutsceneSkippedAt;
  cutsceneSkippedAt = null;
  if (finished) {
    const at = skippedAt ?? finished.time;
    analytics?.cutsceneEnd(finished.id, at, skippedAt != null);
    const lines = finished.timeline.events.filter((event) => event.type === 'line');
    if (lines.length) {
      const heard = lines.filter((event) => event.at <= at).length;
      analytics?.dialogue('cutscene', finished.id, skippedAt != null && heard < lines.length ? 'skipped' : 'read', heard, lines.length);
    }
  }
  const gear = cutsceneGear;
  cutsceneGear = null;
  const reequip = finished ? finished.timeline.reequip !== false : true;
  act.releaseSeat();
  resetCutsceneState();
  phone.aimBeam(null);
  const restoreLight = reequip && !!gear?.light && !isReturnLevel() && !isHomeLevel() && !isDeskLevel() && !isStationLevel() && !isTrainLevel();
  if (!restoreLight) {
    if (phone.isRaised()) phone.setRaised(false);
    else phone.setFlashlight(false);
  }
  if (reequip && gear) restoreGearAfterCutscene({ ...gear, light: restoreLight });
  if (finished) act.onCutsceneEnded(finished.id);
};

const beginNamedCutscene = (id: string) => {
  if (state.inCutscene) return;
  state.inCutscene = true;
  // Drop the walk from the frame before, or every idle the scene asks for plays as a walk.
  playerAvatar.setSprinting(false);
  playerAvatar.setLocomotion(false, true);
  stashGearForCutscene();
  act.prepareCutscene(id);
  unlockPointer();
  analytics?.cutscenePlay(id);
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
  // Walk-up cutscenes wait for the action button. The press is the audio gesture.
  if (String(trigger.type ?? '').toLowerCase() === 'cutscene') return;
  act.handleTrigger(trigger);
});

/** Playtest setup (`load-error`): make the next level load fail, as a missing level file or a load that never ends. */
let forcedLoadFailure: 'error' | 'hang' | null = null;

/**
 * Level loads run one after another. Two at once (Reset, then a level pick) both disposed the same old nodes and
 * left the first one's level, NPCs and story mounts in the scene for good.
 */
let loadChain: Promise<void> = Promise.resolve();
const loadMissionScene = (path: string, mode: 'boot' | 'arrive' = 'boot') => {
  const run = loadChain.then(() => loadMissionSceneNow(path, mode));
  loadChain = run.catch(() => undefined);
  return run;
};

const loadMissionSceneNow = async (path: string, mode: 'boot' | 'arrive' = 'boot') => {
  dressedLevelId = 0;
  if (mode === 'boot') {
    gameReady = false;
    screenFade.to(1, 0);
    syncStartButtonLabel();
  }
  try {
    clearNpcs(npcs);
    clearEnemies(enemies);
    home.dispose();
    desk.dispose();
    station.dispose();
    train.dispose();
    if (mode === 'boot') act.reset();
    resetCutsceneState();
    if (mode === 'arrive') state.inCutscene = true;
    const forced = forcedLoadFailure;
    forcedLoadFailure = null;
    if (forced === 'hang') await new Promise<never>(() => {});
    const loaded = forced === 'error' ? null : await loadSceneFromJsonFile(scene, path, { ...sceneLoadOptions, replaceNodes: sceneNodes });
    // A missing or broken level file comes back as null; the boot load and Start must not carry on into an empty scene.
    if (!loaded && mode === 'boot') throw new Error(`level file did not load: ${path}`);
    applyLoadedScene(loaded);
    triggerRunner.bind(loaded?.data.triggers ?? []);
    musicTriggerPlayer.bind(loaded?.data.triggers ?? []);
    if (mode === 'boot' && loaded?.data && !isDeskLevel()) npcs.push(...spawnNpcsFromScene(scene, loaded.data));
    await act.dressLevel();
    freezeStaticScene();
    mountPipeDrips(scene, loaded?.data.theme === 'B3 Basement');
    clearImpactMarks();
    bindScenePickups();
    ensurePlayerAvatar(isReturnLevel() || isHomeLevel() || isDeskLevel() || isStationLevel() || isTrainLevel() ? TRANSFORM_HERO_ASSET_ID : PLAYER_ASSET_ID);
    if (isHomeLevel()) await home.mount();
    if (isStationLevel()) await station.mount();
    if (isTrainLevel()) await train.mount();
    // Runtime dressing that is not in the level file (city under the office, basement air, station kit, the train car).
    dressing.mount({ levelId: loaded?.data.id ?? '', powers: isReturnLevel() });
    await Promise.all([
      waitAvatarReady(playerAvatar),
      whenSkyboxReady(scene),
      ...npcs.map((npc) => waitAvatarReady(npc.avatar)),
    ]);
    await waitFrames(3);
    if (mode === 'arrive') {
      act.onOfficeArrived();
      dressedLevelId = 0;
    } else {
      act.onLevelReady();
      dressedLevelId = state.level;
    }
  } finally {
    if (mode === 'boot') {
      gameReady = true;
      syncStartButtonLabel();
      if (!startingLevel) revealFromBlack(() => !startingLevel);
    }
  }
};

const SAVE_COOKIE = 'ph-origins-save';
const SAVE_STORAGE_KEY = 'ph-origins-save';
const SAVE_MAX_AGE = 60 * 60 * 24 * 400;
type SaveData = {
  unlocked: number;
  level: number;
  sound: boolean;
  health?: number;
  ammo?: number;
  medkits?: number;
  missions?: Record<string, string[]>;
};
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
  const health = Number(parsed.health);
  const ammo = Number(parsed.ammo);
  const medkits = Number(parsed.medkits);
  const missions: Record<string, string[]> = {};
  if (parsed.missions && typeof parsed.missions === 'object') {
    for (const [libraryId, ids] of Object.entries(parsed.missions)) {
      if (!Array.isArray(ids)) continue;
      missions[libraryId] = ids.filter((id) => typeof id === 'string');
    }
  }
  return {
    unlocked,
    level: Math.max(1, Number(parsed.level) || unlocked),
    sound: parsed.sound !== false,
    health: Number.isFinite(health) ? Math.max(1, Math.min(MAX_HEALTH, health)) : undefined,
    ammo: Number.isFinite(ammo) ? Math.max(0, Math.min(4, ammo)) : undefined,
    medkits: Number.isFinite(medkits) ? Math.max(0, Math.min(3, medkits)) : undefined,
    missions,
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
    health: next.health ?? save.health,
    ammo: next.ammo ?? save.ammo,
    medkits: next.medkits ?? save.medkits,
    missions: next.missions ?? save.missions,
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
  level: savedLevelId(),
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
    currentLevel: savedLevelId(),
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
    flyHeld: false,
    sprint: false,
  },
  movementVector: { x: 0, y: 0 },
  fireHeld: false,
  stickDragging: false,
  inCutscene: false,
};

const levelStartLine = (level = getLevelDefinition(state.level)) =>
  `Level ${level.id}: ${level.name}`;

const levelLoadingLine = (level = getLevelDefinition(state.level)) =>
  `Loading ${level.name}…`;

const enemies: Enemy[] = [];
const aimPoints: BABYLON.Vector3[] = [];
const shotDirection = new BABYLON.Vector3();
let aimSuppress = 0;
let aimEscape = 0;
const LOS_SKIP = /floor|ground|ceil|creature|phone|pistol|skybox|impact|mark|trigger|drip|eye|player|decal|pickup|label/i;
const autoAim = createAutoAim(scene, (mesh) => {
  if (mesh === playerCollider || mesh === muzzleFlash.mesh) return true;
  if (mesh.isDescendantOf(playerAvatar.group)) return true;
  const meta = mesh.metadata as { pickup?: unknown; sceneAssetId?: string } | undefined;
  if (meta?.pickup || meta?.sceneAssetId === 'b3-creature') return true;
  if (LOS_SKIP.test(mesh.name)) return true;
  if ((isHomeLevel() && home.ignoresAim(mesh)) || (isStationLevel() && station.ignoresAim(mesh)) || (isTrainLevel() && train.ignoresAim(mesh))) return true;
  for (const enemy of enemies) {
    if (mesh === enemy.mesh || mesh.isDescendantOf(enemy.root)) return true;
  }
  return false;
});
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
  hurt: '/assets/audio/sfx/hurt.ogg',
  reload: '/assets/audio/sfx/reload.ogg',
  draw: '/assets/audio/sfx/pistol-draw.ogg',
  holster: '/assets/audio/sfx/pistol-holster.ogg',
  start: '/assets/audio/sfx/start.ogg',
  objective: '/assets/audio/sfx/objective.ogg',
  levelComplete: '/assets/audio/sfx/level-complete.ogg',
  shadowRun: '/assets/audio/sfx/street/shadow-run.ogg',
} as const;
const endingTrack = (level: number) => (getLevelDefinition(level).libraryId === 'the-train' ? TRAIN_ENDING_TRACK : `/assets/audio/ending-${Math.max(1, level)}.mp3`);
let walkLoop: ClipHandle | null = null;
let walkWanted = false;
let endingSong: HTMLAudioElement | null = null;

const stopEndingSong = () => {
  if (!endingSong) return;
  releaseUnlockedAudio(endingSong);
  endingSong = null;
};

/** No Web Audio: a pooled element, handed back when it ends. */
const playElementOnce = (url: string, level: number) => {
  const element = createUnlockedAudio(url);
  element.volume = level;
  const done = () => {
    element.removeEventListener('ended', done);
    element.removeEventListener('error', done);
    releaseUnlockedAudio(element);
  };
  element.addEventListener('ended', done);
  element.addEventListener('error', done);
  void element.play().catch(done);
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
    gain.connect(busInput(this.ctx, 'sfx'));
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
    osc.stop(this.ctx.currentTime + duration);
  },
  /** One-shots play from a decoded buffer, so a phone hears them without a finger on the screen. */
  play(url: string, volume: number) {
    if (!this.enabled) return;
    this.ensure();
    const level = mixVolume(url, volume);
    if (playClip(url, level)) return;
    playElementOnce(url, level);
  },
  setWalk(playing: boolean) {
    walkWanted = Boolean(playing && this.enabled);
    if (!walkWanted) {
      walkLoop?.stop(0.05);
      walkLoop = null;
      return;
    }
    if (walkLoop && !walkLoop.done()) return;
    this.ensure();
    walkLoop = playClip(SFX.walk, mixVolume(SFX.walk, 0.28), { loop: true });
  },
  hit() { this.play(SFX.hurt, 0.45); },
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
    const song = createUnlockedAudio(endingTrack(state.level), 'music');
    endingSong = song;
    song.loop = false;
    song.volume = 0.7;
    const done = () => {
      song.removeEventListener('ended', done);
      if (endingSong === song) stopEndingSong();
    };
    song.addEventListener('ended', done);
    void song.play().catch(() => {});
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

  const storyLevel = isApexPeakLevel() || isB3Level() || isReturnLevel() || isHomeLevel() || isDeskLevel() || isStationLevel() || isTrainLevel();
  const streetPowers = shadowPlay().controls();
  const shadowHands = streetPowers && shadowPlay().shadowMode();
  const handsRaised = shadowHands && shadowPlay().handsOut();
  if (abilityHint) abilityHint.hidden = !streetPowers;
  if (abilityReadout) {
    abilityReadout.hidden = !streetPowers;
    if (abilityName) abilityName.textContent = abilityTitle();
  }
  if (shadowHint) {
    shadowHint.hidden = !shadowPlay().shadowShown();
    shadowHint.classList.toggle('lit', shadowHands);
  }
  if (sidearmHint) {
    sidearmHint.innerHTML = shadowHands ? '<kbd>Q</kbd> Hands' : '<kbd>Q</kbd> Sidearm';
    sidearmHint.classList.toggle('lit', handsRaised);
    sidearmHint.classList.toggle('drawn', handsRaised || (!shadowHands && state.player.weaponDrawn));
    sidearmHint.setAttribute('aria-pressed', handsRaised || (!shadowHands && state.player.weaponDrawn) ? 'true' : 'false');
  }
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
    const shadowHands = shadowPlay().controls() && shadowPlay().shadowMode();
    const handsRaised = shadowHands && shadowPlay().handsOut();
    if (weaponSlotName) weaponSlotName.textContent = shadowHands ? 'Shadow Link' : 'Sidearm';
    weaponSlotState.textContent = shadowHands
      ? (shadowPlay().linked() ? 'Linked' : handsRaised ? 'Raised' : 'Lowered')
      : `${drawn ? 'Drawn' : 'Holstered'} · ${state.player.clip}/${CLIP_SIZE} · ${boxes}/${ITEM_CAP.ammo} ${boxLabel}`;
    weaponSlot.classList.toggle('drawn', (drawn && !shadowHands) || handsRaised);
    weaponSlot.setAttribute('aria-pressed', (drawn && !shadowHands) || handsRaised ? 'true' : 'false');
    weaponSlot.disabled = weaponBusy || !state.running || state.inCutscene || phone.locksBody() || phone.isRaised();
  }
  syncPhoneHud();
  syncActionHint();
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
  if (phoneClock) {
    if (view.clock) phoneClock.textContent = view.clock;
    else {
      const now = new Date();
      phoneClock.textContent = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
    }
  }
  if (phoneSpeaker) phoneSpeaker.textContent = view.speaker && view.line ? view.speaker : '';
  if (phoneLine) phoneLine.textContent = view.line;
  phoneAnswer?.toggleAttribute('hidden', !view.showAnswer);
  phoneEnd?.toggleAttribute('hidden', !view.showEnd);
  phoneFlash?.toggleAttribute('hidden', !view.showFlash);
  if (phoneFlash) {
    phoneFlash.textContent = view.flashlight ? 'Light on' : 'Flashlight';
    phoneFlash.classList.toggle('on', view.flashlight);
  }
  const browsing = view.screen && !view.ringing && !view.focused;
  if (phoneHome) phoneHome.hidden = !browsing || view.app !== 'home';
  if (phoneSheet) phoneSheet.hidden = !browsing || view.app === 'home';
  if (phoneContact) phoneContact.hidden = browsing;
  if (phoneDetail) phoneDetail.hidden = browsing;
  phonePanel?.classList.toggle('calling', view.ringing || view.focused || view.outgoing);
  if (phoneSpeaker) phoneSpeaker.hidden = browsing;
  if (phoneLine) phoneLine.hidden = browsing;
  if (browsing && phoneStatus) phoneStatus.textContent = '';
  if (phoneMessages) phoneMessages.hidden = true;
  if (browsing && view.app !== 'home' && phoneSheetTitle && phoneSheetBody) {
    const title = view.app === 'messages' ? 'Messages' : view.app === 'contacts' ? 'Contacts' : 'Recents';
    phoneSheetTitle.textContent = title;
    const rows = view.app === 'messages'
      ? (view.messages.length
        ? view.messages.map((message) => `<div class="phone-message"><strong>${message.from}</strong>${message.text}</div>`).join('')
        : '<div class="phone-empty">No messages</div>')
      : view.app === 'contacts'
        ? (view.contacts.length
          ? view.contacts.map((person) => `<button type="button" class="phone-person" data-phone-call="${person.id}"><strong>${person.name}</strong><span>${person.detail}</span></button>`).join('')
          : '<div class="phone-empty">No contacts</div>')
        : (view.recents.length
          ? view.recents.map((call) => `<button type="button" class="phone-person" data-phone-call="${call.contact}"><strong>${call.name}</strong><span>${call.detail}</span></button>`).join('')
          : '<div class="phone-empty">No recent calls</div>');
    if (rows !== phoneRows) {
      phoneRows = rows;
      phoneSheetBody.innerHTML = rows;
    }
  } else {
    phoneRows = '';
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
  const phoneHoldsPointer = phone.locksBody() || phone.isScreenOpen();
  if (phoneHoldsPointer) {
    unlockPointer();
    canvas.style.cursor = 'default';
    root.style.cursor = 'default';
  } else if (callPointerFree) {
    canvas.style.cursor = '';
    root.style.cursor = '';
    if (!panelsOpen()) lockGameplayPointer();
  }
  callPointerFree = phoneHoldsPointer;
};

let inventoryOpen = false;
let missionsOpen = false;
const panelsOpen = () => inventoryOpen || missionsOpen;
let callPointerFree = false;
let phoneRows = '';
let weaponBusy = false;
let defeatLeft = 0;
let wasInCutscene = false;
let reloadReadyAt = 0;
let reloadNote = '';
let reloadNoteUntil = 0;

const canLockGameplayPointer = () =>
  state.running && !state.inCutscene && messageBox.classList.contains('hidden') && !panelsOpen()
  && !phone.locksBody() && !phone.isScreenOpen();

const requestPlayLock = () => {
  if (phone.locksBody() || phone.isScreenOpen()) return;
  if (document.body.dataset.device === 'mobile') return;
  if (document.pointerLockElement === canvas) return;
  if (!canvas.isConnected || !document.hasFocus()) return;
  const pending = canvas.requestPointerLock();
  if (pending && typeof pending.catch === 'function') void pending.catch(() => {});
};

const lockGameplayPointer = () => {
  if (!canLockGameplayPointer()) return;
  requestPlayLock();
};

const lockPlayPointer = () => {
  if (document.body.dataset.device === 'mobile') return;
  state.mouseLookActive = true;
  requestPlayLock();
};

const setInventoryOpen = (open: boolean) => {
  if (open && !inventoryOpen) analytics?.used('inventory');
  inventoryOpen = open;
  if (open) missionsOpen = false;
  inventoryHud.classList.toggle('open', open);
  missionsHud?.classList.toggle('open', missionsOpen);
  if (open) {
    unlockPointer();
    canvas.style.cursor = 'default';
    root.style.cursor = 'default';
  } else if (!missionsOpen) {
    canvas.style.cursor = '';
    root.style.cursor = '';
    if (!state.inCutscene) lockGameplayPointer();
  }
  updateCrosshairVisibility();
};

const doneMissionIds = (libraryId: string) => save.missions?.[libraryId] ?? [];

callQuestOpenFor = (contactId) => {
  const libraryId = getLevelDefinition(state.level).libraryId;
  return callQuestOpen(libraryId, contactId, doneMissionIds(libraryId));
};

const markMission = (id: string) => {
  const libraryId = getLevelDefinition(state.level).libraryId;
  if (!missionsFor(libraryId).some((quest) => quest.id === id)) return;
  const done = doneMissionIds(libraryId);
  if (done.includes(id)) return;
  saveGame({ missions: { ...(save.missions ?? {}), [libraryId]: [...done, id] } });
  if (id !== 'main') analytics?.sideQuest(id);
  renderMissions();
};

const missionText = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const renderMissions = () => {
  if (!missionsList) return;
  const level = getLevelDefinition(state.level);
  const done = new Set(doneMissionIds(level.libraryId));
  const quests = missionsFor(level.libraryId);
  const kicker = objectiveHud?.querySelector('.objective-kicker')?.textContent?.trim() || 'Main';
  const detail = objectiveText?.textContent?.trim() || 'Follow the objective.';
  if (missionsTitle) missionsTitle.textContent = `Missions ${missionLabel(level.libraryId, [...done])}`;
  missionsList.innerHTML = quests.map((quest) => {
    const title = quest.id === 'main' ? kicker : quest.title;
    const note = quest.id === 'main' ? detail : quest.detail;
    const complete = done.has(quest.id);
    return `<div class="mission-row${complete ? ' done' : ''}"><span class="inventory-label">${quest.group === 'main' ? 'Main' : 'Side'}<span>${complete ? 'Done' : ''}</span></span><strong>${missionText(title)}</strong><span class="inventory-note">${missionText(note)}</span></div>`;
  }).join('');
};

const setMissionsOpen = (open: boolean) => {
  if (open && !missionsOpen) analytics?.used('missions');
  missionsOpen = open;
  if (open) inventoryOpen = false;
  missionsHud?.classList.toggle('open', open);
  inventoryHud.classList.toggle('open', inventoryOpen);
  if (open) {
    renderMissions();
    unlockPointer();
    canvas.style.cursor = 'default';
    root.style.cursor = 'default';
  } else if (!inventoryOpen) {
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
missionsClose?.addEventListener('click', (event) => {
  event.stopPropagation();
  setMissionsOpen(false);
});
missionsHint?.addEventListener('click', (event) => {
  event.stopPropagation();
  event.preventDefault();
  setMissionsOpen(!missionsOpen);
});
missionsHud?.addEventListener('pointerdown', stopInventoryPointer);
missionsHud?.addEventListener('pointerup', stopInventoryPointer);
inventoryHud.addEventListener('pointerdown', stopInventoryPointer);
inventoryHud.addEventListener('pointerup', stopInventoryPointer);

const nextPlayableLevel = () => {
  const next = getLevels()[state.level];
  if (!next || next.comingSoon) return null;
  return next;
};

let levelPicked = false;
let pendingEnd: { title: string; text: string; levelId: number } | null = null;
let meleeAbility: 'punch' | 'kick' = 'punch';
let shadowPick: 'shock' | 'possess' = 'shock';
let shadowRunLeft = SHADOW_RUN_SECONDS;
let shadowRunLocked = false;
let shadowFlying = false;
/** First jump of this airtime already left the ground. The next press can enter the run. */
let shadowHop = false;
/** Second jump press is held. That hold is the same sustain as Shift. */
let shadowAirJump = false;
let spaceDown = false;
let shadowBed: LoopHandle | null = null;
let shadowBedOn = false;

const syncShadowBed = (active: boolean, moving: boolean) => {
  if (!active || !audio.enabled) {
    if (!shadowBedOn) return;
    shadowBedOn = false;
    shadowBed?.stop();
    shadowBed = null;
    return;
  }
  const level = mixVolume(SFX.shadowRun, moving ? 0.4 : 0.12);
  if (!shadowBedOn) {
    shadowBedOn = true;
    void startGaplessLoop(SFX.shadowRun, level).then((handle) => {
      if (!shadowBedOn || !handle) {
        handle?.stop();
        return;
      }
      shadowBed = handle;
    });
    return;
  }
  shadowBed?.setVolume(level);
};

const shadowRunHeld = () => state.input.sprint || shadowAirJump;

const shadowRunActive = () => shadowPlay().controls()
  && shadowPlay().shadowMode()
  && shadowRunHeld()
  && !shadowRunLocked
  && shadowRunLeft > 0
  && !shadowPlay().linked()
  && !state.inCutscene
  && state.running
  && messageBox.classList.contains('hidden')
  && !panelsOpen();

const shadowJumpReady = () => shadowPlay().controls()
  && shadowPlay().shadowMode()
  && !shadowPlay().linked()
  && state.running
  && !state.inCutscene
  && messageBox.classList.contains('hidden')
  && !panelsOpen();

const onJumpPress = () => {
  const airborne = !state.player.grounded && state.player.jumpWindup <= 0;
  if (shadowJumpReady() && airborne && shadowHop) {
    shadowAirJump = true;
    return;
  }
  if (state.player.grounded && !shadowRunActive()) {
    state.input.jump = true;
    if (shadowJumpReady()) shadowHop = true;
  }
};

const tickShadowRun = (delta: number) => {
  if (!shadowPlay().shadowMode()) {
    shadowAirJump = false;
    shadowHop = false;
  }
  if (shadowRunActive()) {
    shadowRunLeft = Math.max(0, shadowRunLeft - delta);
    if (shadowRunLeft <= 0) shadowRunLocked = true;
    return;
  }
  if (!shadowRunHeld() || !shadowPlay().shadowMode()) shadowRunLocked = false;
  if (!shadowRunLocked) shadowRunLeft = Math.min(SHADOW_RUN_SECONDS, shadowRunLeft + delta);
};

const abilityTitle = () => {
  if (shadowPlay().shadowMode()) return shadowPick === 'possess' ? 'Possess' : 'Shadow Shock';
  return meleeAbility === 'kick' ? 'Kick' : 'Punch';
};

const menuMode = () => {
  if (!gameReady) return 'loading' as const;
  if (messageTitle.textContent === 'Level Complete') return 'level-complete' as const;
  if (!state.running && messageTitle.textContent === 'PH Origins' && hasProgress() && !levelPicked) return 'resume' as const;
  return 'play' as const;
};

const syncStartButtonLabel = () => {
  // The "Couldn't start the game" card owns the Start button (Retry) until the page reloads.
  if (loadFailed()) return;
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
    newGameBtn.style.display = 'none';
    resetBtn.style.display = 'none';
    startBtn.disabled = !next;
    startBtn.style.display = next ? '' : 'none';
    startBtn.textContent = 'Continue';
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
  resetBtn.textContent = messageTitle.textContent === 'Defeat' ? 'Main Menu' : 'Reset';
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
  const aiming = state.player.weaponDrawn || (shadowPlay().controls() && shadowPlay().handsOut() && !shadowPlay().linked());
  const visible = state.running
    && aiming
    && !panelsOpen()
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
  if (holsterAfterWeapon && state.player.weaponDrawn) {
    holsterAfterWeapon = false;
    holsterSidearm();
    return;
  }
  holsterAfterWeapon = false;
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
let holsterAfterWeapon = false;

const holsterSidearm = () => {
  if (phone.isRaised()) {
    phone.setRaised(false);
    playerAvatar.resumeLocomotion();
  }
  if (!state.player.weaponDrawn) {
    if (weaponBusy) holsterAfterWeapon = true;
    syncEquippedCamera();
    updateHud();
    return;
  }
  if (weaponBusy) {
    holsterAfterWeapon = true;
    return;
  }
  holsterAfterWeapon = false;
  weaponBusy = true;
  state.player.weaponDrawn = false;
  updateCrosshairVisibility();
  syncEquippedCamera();
  updateHud();
  audio.holster();
  const played = playerAvatar.playClip('holster', false, 4, () => finishWeaponToggle(false));
  if (!played) finishWeaponToggle(false);
};

const syncEquippedCamera = () => {
  const close = phone.flashlightOn() || state.player.weaponDrawn || (shadowPlay().controls() && shadowPlay().handsOut());
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
  analytics?.used('phone');
  updateHud();
};

const toggleFlashlight = () => {
  if (!state.running || state.inCutscene || weaponBusy || phone.locksBody()) return;
  analytics?.used('flashlight');
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

const finishShadowHands = (drawn: boolean) => {
  weaponBusy = false;
  const raised = drawn && shadowPlay().controls() && shadowPlay().handsOut();
  playerAvatar.setArmed(raised);
  playerPistol.setVisible(false);
  state.player.weaponDrawn = false;
  playerAvatar.resumeLocomotion();
  syncEquippedCamera();
  updateCrosshairVisibility();
  updateHud();
};

const toggleShadowHands = () => {
  if (!shadowPlay().controls() || weaponBusy || phone.locksBody()) return;
  if (phone.isRaised()) phone.setRaised(false);
  const drawing = !shadowPlay().handsOut();
  shadowPlay().setHands(drawing);
  weaponBusy = true;
  followCamera.setOverShoulder(drawing);
  followCamera.setToolClose(drawing);
  playerPistol.setVisible(false);
  state.player.weaponDrawn = false;
  if (!drawing) updateCrosshairVisibility();
  updateHud();
  if (drawing) audio.draw();
  else audio.holster();
  const played = playerAvatar.playClip(drawing ? 'draw' : 'holster', false, 4, () => finishShadowHands(drawing));
  if (!played) finishShadowHands(drawing);
  setInventoryOpen(false);
};

const toggleWeapon = () => {
  if (shadowPlay().controls() && shadowPlay().shadowMode()) {
    if (state.running && messageBox.classList.contains('hidden') && !panelsOpen()) toggleShadowHands();
    return;
  }
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
abilityHint?.addEventListener('click', (event) => {
  event.preventDefault();
  abilityHint?.blur();
  switchAbility();
});
skipCutsceneBtn?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (activeCutscene) {
    const finished = activeCutscene;
    cutsceneSkippedAt = finished.time;
    skipToEnd(finished);
    act.beforeCutsceneStep(finished.id, finished.duration);
    endCutscene();
    return;
  }
  if (home.playing() || desk.playing() || station.playing() || train.playing()) analytics?.scriptedSkipped();
  if (home.playing()) home.skip();
  else if (desk.playing()) desk.skip();
  else if (station.playing()) station.skip();
  else if (train.playing()) train.skip();
  lockGameplayPointer();
});
shadowHint?.addEventListener('click', (event) => {
  event.preventDefault();
  if (shadowPlay().controls() && messageBox.classList.contains('hidden') && !panelsOpen()) {
    if (shadowPlay().toggleShadow()) {
      markMission('power-shadow');
      analytics?.used('shadow-mode');
    }
    if (!shadowPlay().shadowMode()) {
      playerAvatar.setArmed(false);
      syncEquippedCamera();
      updateCrosshairVisibility();
    }
    updateHud();
  }
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
phoneHome?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('[data-phone-app]');
  const next = button?.getAttribute('data-phone-app');
  if (next !== 'messages' && next !== 'contacts' && next !== 'recents') return;
  phone.openApp(next);
  updateHud();
});
phoneBack?.addEventListener('click', (event) => {
  event.stopPropagation();
  phone.back();
  updateHud();
});
phoneSheet?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('[data-phone-call]');
  const id = button?.getAttribute('data-phone-call');
  if (!id) return;
  event.preventDefault();
  event.stopPropagation();
  phone.dial(id);
  updateHud();
});

const levelCredits = document.getElementById('levelCredits') as HTMLDivElement | null;

const stopLevelCredits = () => {
  if (!levelCredits) return;
  levelCredits.hidden = true;
  levelCredits.innerHTML = '';
};

const startLevelCredits = (levelId: number) => {
  if (!levelCredits) return;
  // Level 7's crawl lives in its own script (theTrain.ts), so the level-7 tasks only fill that file in.
  const markup = renderLevelCredits(levelId, isTrainLevel() ? TRAIN_CREDITS ?? undefined : undefined);
  if (!markup) {
    stopLevelCredits();
    return;
  }
  levelCredits.hidden = false;
  levelCredits.innerHTML = markup;
};

/** Swap the title card for "Couldn't start the game" with Retry (rendered by game.html's boot script). */
const showLoadError = (kind: LoadFailure, error?: unknown) => {
  if (error) console.warn('PH Origins: the game could not start', error);
  state.running = false;
  phBoot?.fail(kind);
  levelSelect.classList.add('hidden');
  messageBox.classList.remove('leaving', 'hidden');
  stopLevelCredits();
  unlockPointer();
  screenFade.to(0, 0);
};

/** Wait for a level load; when it stalls for LEVEL_LOAD_STALL_MS show the error card. A late finish puts the card back. */
const withLoadTimeout = async (load: Promise<void>) => {
  let timedOut = false;
  const started = performance.now();
  const timer = setInterval(() => {
    // The stall clock is page-wide, so it only counts from when this load began.
    const stalled = Math.min(phBoot?.idleMs() ?? 0, performance.now() - started);
    if (timedOut || stalled <= LEVEL_LOAD_STALL_MS) return;
    timedOut = true;
    showLoadError('timeout');
  }, 250);
  try {
    await load;
  } finally {
    clearInterval(timer);
  }
  if (timedOut) recoverFromStall();
};

/** A load that stalled (error card shown) and then finished after all: put the title card back. */
const recoverFromStall = () => {
  if (!phBoot?.recover()) return;
  messageText.textContent = levelStartLine();
  syncStartButtonLabel();
};

const showMessage = (title: string, text: string) => {
  messageBox.classList.remove('leaving');
  messageTitle.textContent = title;
  messageText.textContent = text;
  syncStartButtonLabel();
  unlockPointer();
  levelSelect.classList.add('hidden');
  messageBox.classList.remove('hidden');
  if (title === 'Level Complete' || title === 'Mission Clear') startLevelCredits(state.level);
  else stopLevelCredits();
  if (missionScore) {
    const showScore = title === 'Level Complete';
    missionScore.hidden = !showScore;
    if (showScore) {
      const level = getLevelDefinition(state.level);
      missionScore.textContent = `Missions ${missionLabel(level.libraryId, doneMissionIds(level.libraryId))}`;
    }
  }
  updateCrosshairVisibility();
};

const hideMessage = () => {
  stopLevelCredits();
  messageBox.classList.add('hidden');
  messageBox.classList.remove('leaving');
  updateCrosshairVisibility();
};

/** Start fades the card out over the black veil. The level, HUD and touch controls only come after it is gone. */
const CARD_FADE_MS = 400;
let cardLeaving = false;
const fadeOutCard = () => new Promise<void>((resolve) => {
  if (messageBox.classList.contains('hidden')) {
    resolve();
    return;
  }
  cardLeaving = true;
  screenFade.to(1, CARD_FADE_MS / 1000);
  messageBox.classList.add('leaving');
  window.setTimeout(() => {
    cardLeaving = false;
    resolve();
  }, CARD_FADE_MS);
});

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
  grade.setPowers(isReturnLevel() || isHomeLevel() || isDeskLevel());
  grade.apply(config.theme);
};

const freezeStaticScene = () => {
  for (const mesh of scene.meshes) {
    const id = (mesh.metadata as { sceneAssetId?: string } | null)?.sceneAssetId ?? '';
    if (!id || mesh.skeleton) continue;
    if (/door|paper|folder|button|mirror/i.test(id)) continue;
    mesh.computeWorldMatrix(true);
    mesh.freezeWorldMatrix();
  }
};

const unlockProgress = () => {
  const next = getLevels()[state.level];
  const resumeId = next && !next.comingSoon ? next.id : state.level;
  state.progression.highestUnlocked = getUnlockedLevelCount(Math.max(state.progression.highestUnlocked, state.level + 1));
  saveGame({
    unlocked: Math.max(save.unlocked ?? 1, state.progression.highestUnlocked),
    level: Math.max(save.level ?? 1, resumeId),
    sound: audio.enabled,
    health: state.health,
    ammo: itemCount(state.inventory, 'ammo'),
    medkits: itemCount(state.inventory, 'medkit'),
  });
};

const resetPlayer = (keepLevel = false, fresh = false) => {
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
  phone.attachTo(playerAvatar);
  followCamera.setCallFrame(false);
  muzzleFlash.hide();
  followCamera.setOverShoulder(false);
  followCamera.setToolClose(false);
  state.progression.currentLevel = selectedLevel;
  state.progression.highestUnlocked = getUnlockedLevelCount(Math.max(1, state.progression.highestUnlocked));
  state.inventory = createInventoryState();
  if (fresh) {
    saveGame({ health: MAX_HEALTH, ammo: 0, medkits: itemCount(state.inventory, 'medkit'), missions: {} });
  } else if (typeof save.health === 'number') {
    state.health = save.health;
    state.inventory.items.ammo = save.ammo ?? 0;
    state.inventory.items.medkit = save.medkits ?? state.inventory.items.medkit;
  }
  state.quests = createQuestState();
  state.characterYaw = 0;
  applyLevelConfig(getLevelDefinition(selectedLevel));
  followCamera.reset();
};

let applyHurt = (_amount: number, _cause?: string) => {};
/** What hurt Pierce last: the death's cause for analytics. */
let lastHurtCause = 'unknown';
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
  isReturn: isReturnLevel,
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
  win: () => audio.win(),
  showMessage,
  offerEnd: (title, text) => offerLevelEnd(title, text),
  haltPlay: () => { state.running = false; },
  clearInput: () => clearInputState(),
  unlockNext: () => unlockProgress(),
  refreshHud: () => updateHud(),
  setCarry: (items) => { storyCarry = items; },
  hurt: (amount, cause) => applyHurt(amount, cause),
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
  releaseCamera: () => followCamera.clearCinematic(),
  fade: (to, seconds) => screenFade.to(to, seconds ?? 0),
  raiseLight: () => {
    phone.setRaised(true);
    phone.setFlashlight(true);
    syncEquippedCamera();
  },
  showLine: (title, text) => showCineHud(title, text),
  holdScene: (held) => {
    state.inCutscene = held;
    if (held) audio.setWalk(false);
  },
  arriveOffice: () => {
    if (officeSwap) return;
    officeSwap = true;
    state.inCutscene = true;
    screenFade.to(1, 0);
    void loadMissionScene(getLevelDefinition(1).path, 'arrive')
      .catch(() => { act.resumeAscent(); })
      .finally(() => {
        state.inCutscene = false;
        officeSwap = false;
      });
  },
});

const home: GoingHome = createGoingHome({
  scene,
  camera,
  running: () => state.running,
  placePierce,
  playClip: (clip, loop, speed, onEnded) => { playerAvatar.playClip(clip, loop, speed, onEnded); },
  holdLocomotion: () => playerAvatar.setLocomotion(false, true),
  resumeLocomotion: () => playerAvatar.resumeLocomotion(),
  frameCamera: (position, lookAt) => followCamera.setCinematic(position, lookAt),
  releaseCamera: () => followCamera.clearCinematic(),
  fade: (to, seconds) => screenFade.to(to, seconds ?? 0),
  showLine: (title, text) => showCineHud(title, text),
  holdScene: (held) => {
    state.inCutscene = held;
    if (held) audio.setWalk(false);
  },
  setObjective,
  showObjective: (visible) => objectiveHud?.classList.toggle('visible', visible),
  clearMarker: () => objectiveMarker.setTarget(null),
  playFile: (url, volume) => { audio.play(url, volume); },
  setWalk: (moving) => audio.setWalk(moving),
  setCarry: (items) => { storyCarry = items; },
  hurt: (amount, cause) => applyHurt(amount, cause),
  win: () => audio.win(),
  showMessage,
  offerEnd: (title, text) => offerLevelEnd(title, text),
  haltPlay: () => { state.running = false; },
  clearInput: () => clearInputState(),
  unlockNext: () => unlockProgress(),
  refreshHud: () => updateHud(),
  player: () => ({ x: state.player.x, z: state.player.z, yaw: state.characterYaw }),
  shedShadow: (x, z) => shadowVeil.shed(x, z, Math.atan2(x - state.player.x, z - state.player.z)),
  hand: () => {
    const joint = playerAvatar.findJoint('RightHand');
    if (!joint) return null;
    const at = joint.getAbsolutePosition();
    return { x: at.x, y: at.y, z: at.z };
  },
  leftHand: () => {
    const joint = playerAvatar.findJoint('LeftHand');
    if (!joint) return null;
    const at = joint.getAbsolutePosition();
    return { x: at.x, y: at.y, z: at.z };
  },
  holster: () => holsterSidearm(),
  pushPhoneText: (id) => {
    phone.pushText(id);
    updateHud();
  },
  ability: () => shadowPick,
});

const desk: TheDesk = createTheDesk({
  scene,
  placePierce,
  playClip: (clip, loop, speed) => { playerAvatar.playClip(clip, loop, speed); },
  frameCamera: (position, lookAt) => followCamera.setCinematic(position, lookAt),
  releaseCamera: () => followCamera.clearCinematic(),
  fade: (to, seconds) => screenFade.to(to, seconds ?? 0),
  showLine: (title, text) => showCineHud(title, text),
  holdScene: (held) => {
    state.inCutscene = held;
    if (held) audio.setWalk(false);
  },
  clearMarker: () => objectiveMarker.setTarget(null),
  showObjective: (visible) => objectiveHud?.classList.toggle('visible', visible),
  setObjective,
  playFile: (url, volume) => { audio.play(url, volume); },
  setWalk: (moving) => audio.setWalk(moving),
  setCarry: (items) => { storyCarry = items; },
  playerXZ: () => ({ x: state.player.x, z: state.player.z }),
  resumeLocomotion: () => playerAvatar.resumeLocomotion(),
  win: () => audio.win(),
  showMessage,
  offerEnd: (title, text) => offerLevelEnd(title, text),
  haltPlay: () => { state.running = false; },
  clearInput: () => clearInputState(),
  unlockNext: () => unlockProgress(),
  refreshHud: () => updateHud(),
});

const station: TheStation = createTheStation({
  scene,
  camera,
  running: () => state.running,
  placePierce,
  playClip: (clip, loop, speed, onEnded) => { playerAvatar.playClip(clip, loop, speed, onEnded); },
  resumeLocomotion: () => playerAvatar.resumeLocomotion(),
  fade: (to, seconds) => screenFade.to(to, seconds ?? 0),
  setObjective,
  showObjective: (visible) => objectiveHud?.classList.toggle('visible', visible),
  clearMarker: () => objectiveMarker.setTarget(null),
  playFile: (url, volume) => { audio.play(url, volume); },
  setWalk: (moving) => audio.setWalk(moving),
  setCarry: (items) => { storyCarry = items; },
  win: () => audio.win(),
  showMessage,
  offerEnd: (title, text) => offerLevelEnd(title, text),
  haltPlay: () => { state.running = false; },
  clearInput: () => clearInputState(),
  unlockNext: () => unlockProgress(),
  refreshHud: () => updateHud(),
  holster: () => holsterSidearm(),
  hand: () => {
    const joint = playerAvatar.findJoint('RightHand');
    if (!joint) return null;
    const at = joint.getAbsolutePosition();
    return { x: at.x, y: at.y, z: at.z };
  },
  player: () => ({ x: state.player.x, z: state.player.z, yaw: state.characterYaw }),
  shedShadow: (x, z) => shadowVeil.shed(x, z, Math.atan2(x - state.player.x, z - state.player.z)),
  frameCamera: (position, lookAt) => followCamera.setCinematic(position, lookAt),
  releaseCamera: () => followCamera.clearCinematic(),
  showLine: (title, text) => showCineHud(title, text),
  holdScene: (held) => {
    state.inCutscene = held;
    if (held) {
      audio.setWalk(false);
      unlockPointer();
    }
  },
  ringCall: (id) => {
    clearHands();
    phone.ring(id);
    updateHud();
  },
});

const train: TheTrain = createTheTrain({
  scene,
  camera,
  running: () => state.running,
  placePierce,
  playClip: (clip, loop, speed, onEnded) => { playerAvatar.playClip(clip, loop, speed, onEnded); },
  resumeLocomotion: () => playerAvatar.resumeLocomotion(),
  fade: (to, seconds) => screenFade.to(to, seconds ?? 0),
  setObjective,
  showObjective: (visible) => objectiveHud?.classList.toggle('visible', visible),
  clearMarker: () => objectiveMarker.setTarget(null),
  playFile: (url, volume) => { audio.play(url, volume); },
  setWalk: (moving) => audio.setWalk(moving),
  setCarry: (items) => { storyCarry = items; },
  showMessage,
  offerEnd: (title, text) => offerLevelEnd(title, text),
  clearInput: () => clearInputState(),
  unlockNext: () => unlockProgress(),
  refreshHud: () => updateHud(),
  holster: () => holsterSidearm(),
  hand: () => {
    const joint = playerAvatar.findJoint('RightHand');
    if (!joint) return null;
    const at = joint.getAbsolutePosition();
    return { x: at.x, y: at.y, z: at.z };
  },
  player: () => ({ x: state.player.x, z: state.player.z, yaw: state.characterYaw }),
  shedShadow: (x, z) => shadowVeil.shed(x, z, Math.atan2(x - state.player.x, z - state.player.z)),
  frameCamera: (position, lookAt) => followCamera.setCinematic(position, lookAt),
  releaseCamera: () => followCamera.clearCinematic(),
  showLine: (title, text) => showCineHud(title, text),
  holdScene: (held) => {
    state.inCutscene = held;
    if (held) {
      audio.setWalk(false);
      unlockPointer();
    }
  },
  ringCall: (id) => {
    clearHands();
    phone.ring(id);
    updateHud();
  },
  callBusy: () => phone.locksBody(),
  car: () => dressing.train(),
});

storyObjectiveId = () => {
  if (isDeskLevel()) return desk.objectiveKey();
  if (isHomeLevel()) return home.objectiveKey();
  if (isStationLevel()) return station.objectiveKey();
  if (isTrainLevel()) return train.objectiveKey();
  return act.objectiveKey();
};

// Level 7 keeps the station's Shadow mode (its riders are the targets).
const shadowPlay = () => (isStationLevel() ? station : isTrainLevel() ? train : home);

let freshStart = false;

const beginGame = () => {
  if (!gameReady) return;
  pendingEnd = null;
  meleeAbility = 'punch';
  shadowPick = 'shock';
  shadowRunLeft = SHADOW_RUN_SECONDS;
  shadowRunLocked = false;
  shadowFlying = false;
  shadowHop = false;
  shadowAirJump = false;
  spaceDown = false;
  stopEndingSong();
  screenFade.to(1, 0);
  audio.start();
  state.running = true;
  menuCameraActive = false;
  activateGameCamera(scene, camera);
  clearDynamicObjects();
  resetPlayer(true, freshStart);
  freshStart = false;
  syncStartButtonLabel();
  updateHud();
  hideMessage();
  act.onStart();
  if (isHomeLevel()) home.onStart();
  if (isDeskLevel()) desk.onStart();
  if (isStationLevel()) station.onStart();
  if (isTrainLevel()) train.onStart();
  analytics?.levelStarted();
  void waitFrames(3).then(() => {
    revealFromBlack(() => state.running);
  });
};

let startingLevel = false;

/** `hidden` lets a test entry (the `train` playtest) start a `comingSoon` level; Continue and Load Level never do. */
const startAtLevel = async (levelId: number, fresh = false, forceLoad = false, hidden = false) => {
  if (startingLevel || !gameReady) return;
  const level = getLevelDefinition(levelId);
  if (level.comingSoon && !hidden) return;
  startingLevel = true;
  freshStart = fresh;
  unlockAudio();
  try {
    state.level = level.id;
    state.progression.currentLevel = level.id;
    const sceneTheme = (scene.metadata as { themeName?: string } | null)?.themeName;
    // dressedLevelId can still name this level after a detour. The street scene is not the station.
    if (forceLoad || forcedLoadFailure || dressedLevelId !== level.id || sceneTheme !== level.theme) {
      applyLevelConfig(level);
      await withLoadTimeout(loadMissionScene(level.path));
      if (loadFailed()) return;
    }
    await fadeOutCard();
    beginGame();
  } catch (error) {
    showLoadError('level', error);
  } finally {
    startingLevel = false;
  }
};

void (async () => {
  await loadLevelLibrary();
  const bootLevel = getLevelDefinition(savedLevelId());
  state.level = bootLevel.id;
  state.progression.currentLevel = bootLevel.id;
  applyLevelConfig(bootLevel);
  await loadMissionScene(bootLevel.path);
  phBoot?.ready();
  analytics?.ready();
  recoverFromStall();
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
  } else if (beat === 'return') {
    state.level = 3;
    state.progression.currentLevel = 3;
    const level = getLevelDefinition(3);
    applyLevelConfig(level);
    await loadMissionScene(level.path);
    beginGame();
    const at = params.get('at');
    if (at === 'hall') placePierce(44, 30.2, Math.PI);
    if (at === 'cab') {
      act.armPhase('return-up');
      placePierce(44.25, 21.2, 0);
    }
    if (at === 'mirror') {
      void loadMissionScene(getLevelDefinition(1).path, 'arrive').then(() => {
        placePierce(18, 31.4, Math.PI);
      });
    }
  } else if (beat === 'desk') {
    const level = getLevels().find((entry) => entry.libraryId === 'the-desk') ?? getLevelDefinition(4);
    state.level = level.id;
    state.progression.currentLevel = level.id;
    applyLevelConfig(level);
    await loadMissionScene(level.path);
    beginGame();
  } else if (beat === 'home') {
    const level = getLevels().find((entry) => entry.libraryId === 'going-home') ?? getLevelDefinition(5);
    state.level = level.id;
    state.progression.currentLevel = level.id;
    applyLevelConfig(level);
    home.armSkip(params.get('at') === 'street' || params.get('at') === 'stairs');
    await loadMissionScene(level.path);
    beginGame();
  } else if (beat === 'station') {
    const level = getLevels().find((entry) => entry.libraryId === 'the-station') ?? getLevelDefinition(6);
    state.level = level.id;
    state.progression.currentLevel = level.id;
    applyLevelConfig(level);
    await loadMissionScene(level.path);
    beginGame();
  } else if (beat === 'train') {
    // Level 7 is hidden from Load Level and Continue (comingSoon) until it is written; this enters it anyway.
    const level = getLevels().find((entry) => entry.libraryId === 'the-train') ?? getLevelDefinition(7);
    state.level = level.id;
    state.progression.currentLevel = level.id;
    applyLevelConfig(level);
    await loadMissionScene(level.path);
    beginGame();
  } else if (beat === 'voss') {
    act.armPhase('call');
    beginGame();
    act.startCall();
  }
})().catch((error) => {
  applyLoadedScene(null);
  showLoadError('level', error);
});

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
  if (isApexPeakLevel() || isB3Level() || isReturnLevel()) return;
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
    playerAvatar.playClip('deathforward', false);
    audio.play('/assets/audio/sfx/creature/wound.wav', 0.62);
    defeatLeft = 1.45;
    analytics?.died(lastHurtCause);
  }
};

applyHurt = (amount: number, cause = 'story') => {
  if (!state.running || state.inCutscene) return;
  lastHurtCause = cause;
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
  state.input.flyHeld = false;
  state.input.sprint = false;
  shadowAirJump = false;
  shadowHop = false;
  spaceDown = false;
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

let playerLift = 0;

const updateMinimap = (delta: number) => {
  const source = isHomeLevel() && !home.playing() && state.running ? home.map() : null;
  if (!source) {
    minimap.update(delta, null);
    return;
  }
  const look = camera.getForwardRay(1).direction;
  const len = Math.hypot(look.x, look.z) || 1;
  const target = objectiveMarker.getTarget();
  minimap.update(delta, {
    x: state.player.x,
    z: state.player.z,
    yaw: state.characterYaw,
    fx: look.x / len,
    fz: look.z / len,
    target: target ? { x: target.x, z: target.z } : null,
    source,
  });
};

const updateCamera = (delta: number, moving = false, moveHeading: number | null = null) => {
  const focus = shadowPlay().linkFocus();
  if (focus) state.characterYaw = Math.atan2(focus.x - state.player.x, focus.z - state.player.z);
  const subject = focus ? { ...state.player, x: focus.x, z: focus.z } : state.player;
  followCamera.update(delta, subject, moving, moveHeading, gatherCameraIgnoreMeshes());

  const liftWant = isHomeLevel() ? home.lift(state.player.x, state.player.z) : 0;
  playerLift += (liftWant - playerLift) * Math.min(1, delta * 14);
  if (state.inCutscene) return;
  playerAvatar.group.rotation.y = state.characterYaw + Math.PI;
  playerAvatar.group.position = new BABYLON.Vector3(state.player.x, playerMeshY(state.player.y) + playerLift, state.player.z);
};

const levelSealed = () => pendingEnd?.levelId === state.level;

const holdSealedPlayer = (delta: number) => {
  state.input.forward = false;
  state.input.backward = false;
  state.input.left = false;
  state.input.right = false;
  state.input.jump = false;
  state.input.flyHeld = false;
  state.input.sprint = false;
  state.movementVector.x = 0;
  state.movementVector.y = 0;
  shadowAirJump = false;
  shadowHop = false;
  spaceDown = false;
  shadowFlying = false;
  state.player.jumpWindup = 0;
  if (state.player.velocityY > 0) state.player.velocityY = 0;
  updateVerticalMotion(state.player, delta, playerCollider);
  playerAvatar.setSprinting(false);
  playerAvatar.setLocomotion(false, true);
  audio.setWalk(false);
};

const updatePlayer = (delta: number) => {
  if (levelSealed()) {
    holdSealedPlayer(delta);
    return { moving: false, moveHeading: null };
  }
  tickShadowRun(delta);
  if (shadowPlay().linked()) {
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
    if (desiredMove.lengthSquared() > 0) desiredMove.normalize();
    const sprinting = state.input.sprint && shadowPlay().shadowMode();
    const speed = state.playerSpeed * (sprinting ? 1.75 : 1);
    shadowPlay().driveLinked(desiredMove.x * speed * delta, desiredMove.z * speed * delta);
    state.input.jump = false;
    state.player.jumpWindup = 0;
    playerCollider.position.set(state.player.x, state.player.y, state.player.z);
    playerAvatar.setLocomotion(false, true);
    audio.setWalk(false);
    return { moving: false, moveHeading: null };
  }
  if (shadowPlay().controls() && shadowPlay().shocking()) {
    state.player.jumpWindup = 0;
    state.input.jump = false;
    playerCollider.position.set(state.player.x, state.player.y, state.player.z);
    audio.setWalk(false);
    return { moving: false, moveHeading: null };
  }
  if (state.inCutscene || phone.locksBody()) {
    state.player.jumpWindup = 0;
    state.input.jump = false;
    playerCollider.position.set(state.player.x, state.player.y, state.player.z);
    if (phone.locksBody()) playerAvatar.setLocomotion(false, true);
    audio.setWalk(false);
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
    const speed = state.playerSpeed * (shadowRunActive() ? SHADOW_RUN_SPEED : 1);
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
  const runningShadow = shadowRunActive();
  if (runningShadow && state.input.flyHeld) shadowFlying = true;
  if (!runningShadow && shadowFlying) {
    shadowFlying = false;
    state.player.grounded = false;
    state.player.velocityY = 0;
  }
  if (shadowFlying) {
    state.input.jump = false;
    flyPlayer(state.player, playerCollider, delta, state.input.flyHeld);
  } else {
    updateVerticalMotion(state.player, delta, playerCollider);
  }

  if (!shadowFlying && state.input.jump) {
    if (requestJump(state.player)) {
      audio.jump();
    }
    // One-shot: Space and the on-screen button share this path. Consume even on
    // miss so a press during windup or in air cannot queue a second hop.
    state.input.jump = false;
  }

  if (state.player.grounded && state.player.jumpWindup <= 0) shadowHop = false;

  const handsOut = shadowPlay().controls() && shadowPlay().handsOut();
  const aimFacing = state.player.weaponDrawn || handsOut;
  const facingTarget = aimFacing
    ? (followCamera.isLooking() || !moving || moveHeading === null ? followCamera.getYaw() : moveHeading)
    : (moving && moveHeading !== null ? moveHeading : state.characterYaw);
  state.characterYaw = lerpAngle(
    state.characterYaw,
    facingTarget,
    1 - Math.exp(-(followCamera.isLooking() ? 22 : 24) * Math.min(delta, 0.05)),
  );

  const jumpAnim = !state.player.grounded || state.player.jumpWindup > 0;
  const sprinting = moving && shadowRunActive();
  playerAvatar.setSprinting(sprinting);
  playerAvatar.setLocomotion(moving, shadowFlying ? true : !jumpAnim);
  playerAvatar.setPace(1);
  audio.setWalk(
    moving
    && !jumpAnim
    && !shadowRunActive()
    && state.running
    && !state.inCutscene
    && !panelsOpen()
    && messageBox.classList.contains('hidden'),
  );
  syncShadowBed(runningShadow, moving);

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
  analytics?.used('medkit');
  showReloadNote('Medkit');
  audio.tone(520, 0.08, 'sine', 0.05);
  updateHud();
};

const offerLevelEnd = (title: string, text: string) => {
  if (pendingEnd?.levelId === state.level) return;
  pendingEnd = { title, text, levelId: state.level };
  audio.play(SFX.levelComplete, 0.55);
  screenFade.to(0, 0.45);
};

const presentLevelEnd = () => {
  if (!pendingEnd || pendingEnd.levelId !== state.level) {
    pendingEnd = null;
    return;
  }
  const card = pendingEnd;
  pendingEnd = null;
  phone.silence();
  followCamera.setCallFrame(false);
  state.running = false;
  clearInputState();
  audio.setWalk(false);
  audio.win();
  screenFade.to(1, 1.15);
  markMission('main');
  updateHud();
  showMessage(card.title, card.text);
  analytics?.levelCompleted();
};

const storyAction = (): string | null => {
  if (!state.running || state.inCutscene) return null;
  if (!messageBox.classList.contains('hidden')) return null;
  if (pendingEnd?.levelId === state.level) return 'End Level';
  pendingEnd = null;
  if (panelsOpen() || home.playing() || desk.playing() || station.playing() || train.playing()) return null;
  if (phone.locksBody() || phone.isScreenOpen()) return null;
  if (isDeskLevel()) return desk.action();
  if (isTrainLevel()) return train.action();
  if (isHomeLevel() || isStationLevel()) return null;
  return act.action();
};

const confirmStoryAction = () => {
  if (!storyAction()) return false;
  unlockAudio();
  if (pendingEnd) {
    presentLevelEnd();
    syncActionHint();
    return true;
  }
  if (isDeskLevel()) desk.confirm();
  else if (isTrainLevel()) train.confirm();
  else act.confirm();
  syncActionHint();
  return true;
};

const syncActionHint = () => {
  if (!actionHint) return;
  const label = storyAction();
  actionHint.hidden = !label;
  if (label) actionHint.innerHTML = `${label}<kbd> — E</kbd>`;
  interactHint?.classList.toggle('stacked', Boolean(label));
};

const syncInteractHint = () => {
  if (!interactHint) return;
  const pickup = state.running && !state.inCutscene && !panelsOpen() ? nearestSupply() : null;
  if (!pickup) {
    interactHint.hidden = true;
    return;
  }
  const label = SUPPLY_LABEL[pickup.item];
  interactHint.hidden = false;
  interactHint.innerHTML = roomFor(state.inventory, pickup.item) > 0 ? `${label}<kbd> — E</kbd>` : `${label} full`;
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
  const text = note || (emptyClip ? 'Reload<kbd> — R</kbd>' : '');
  reloadHint.hidden = !text;
  reloadHint.innerHTML = text;
};

const reloadWeapon = () => {
  if (!state.running || state.inCutscene || panelsOpen() || weaponBusy || phone.locksBody() || phone.isRaised()) return;
  if (performance.now() < reloadReadyAt) return;
  if (state.player.clip >= CLIP_SIZE) return;
  if (!consumeItem(state.inventory, 'ammo', 1)) {
    showReloadNote('Out of ammo');
    audio.hit();
    return;
  }
  state.player.clip = CLIP_SIZE;
  reloadReadyAt = performance.now() + 700;
  audio.play(SFX.reload, 0.5);
  updateHud();
};

const possessAimed = () => {
  if (!shadowPlay().controls() || !shadowPlay().shadowMode() || shadowPick !== 'possess' || shadowPlay().linked()) return false;
  if (!state.running || state.inCutscene || panelsOpen() || weaponBusy || phone.isRaised() || phone.locksBody()) return false;
  const spot = shadowPlay().handsOut() ? autoAim.point() : null;
  const took = (spot && shadowPlay().possessAt(spot.x, spot.y, spot.z)) || shadowPlay().possessLook();
  if (!took) return false;
  markMission('power-possess');
  audio.tone(78, 0.1, 'sine', 0.06);
  updateHud();
  return true;
};

const useShadowClick = () => {
  if (!shadowPlay().controls() || !shadowPlay().shadowMode() || !state.running || state.inCutscene || panelsOpen() || phone.isRaised() || phone.locksBody()) return;
  analytics?.used(shadowPick === 'possess' ? (shadowPlay().linked() ? 'consume' : 'possess') : 'shadow-shock');
  if (shadowPick === 'possess') {
    if (shadowPlay().linked()) {
      if (shadowPlay().consume()) {
        markMission('power-consume');
        audio.tone(64, 0.14, 'sine', 0.07);
      }
      return;
    }
    possessAimed();
    return;
  }
  if (shadowPlay().shock()) markMission('power-shock');
};

const switchAbility = () => {
  if (!shadowPlay().controls() || !state.running || state.inCutscene || panelsOpen() || !messageBox.classList.contains('hidden')) return;
  if (shadowPlay().shadowMode()) {
    if (shadowPlay().linked()) shadowPlay().release();
    shadowPick = shadowPick === 'shock' ? 'possess' : 'shock';
  } else {
    meleeAbility = meleeAbility === 'punch' ? 'kick' : 'punch';
  }
  updateHud();
};

let shadowClickEdge = false;

const fireWeapon = () => {
  if (shadowPlay().controls() && shadowPlay().shadowMode()) {
    if (!shadowClickEdge) return;
    shadowClickEdge = false;
    useShadowClick();
    updateHud();
    return;
  }
  if (shadowPlay().controls() && !state.player.weaponDrawn) {
    if (!shadowClickEdge) return;
    shadowClickEdge = false;
    if (!state.running || state.inCutscene || panelsOpen() || phone.isRaised() || phone.locksBody()) return;
    shadowPlay().strike(meleeAbility);
    analytics?.used(meleeAbility);
    updateHud();
    return;
  }
  if (!state.running || state.inCutscene || panelsOpen() || weaponBusy || phone.isRaised() || phone.locksBody() || !state.player.weaponDrawn || state.shootCooldown > 0) return;
  if (performance.now() < reloadReadyAt) return;
  if (state.player.clip <= 0) {
    state.shootCooldown = 0.35;
    audio.hit();
    syncReloadHint();
    return;
  }
  state.player.clip -= 1;
  state.shootCooldown = state.fireRate;
  analytics?.used('sidearm');
  audio.shoot();
  if (playerPistol.isVisible()) muzzleFlash.showAt(playerPistol.muzzle);
  else muzzleFlash.show(camera, gatherCameraIgnoreMeshes());
  playerAvatar.playClip('shoot', false, 3, () => playerAvatar.resumeLocomotion());
  const assisted = autoAim.direction();
  if (assisted) shotDirection.copyFrom(assisted);
  else camera.getDirectionToRef(BABYLON.Vector3.Forward(), shotDirection);
  act.shotAt(camera.globalPosition, shotDirection);
  if (isHomeLevel()) home.shotAt(camera.globalPosition, shotDirection);
  stampBulletMark(scene, camera.globalPosition, shotDirection, gatherCameraIgnoreMeshes());
  updateHud();
};

const writeAim = (index: number, x: number, y: number, z: number) => {
  let point = aimPoints[index];
  if (!point) {
    point = new BABYLON.Vector3();
    aimPoints[index] = point;
  }
  point.set(x, y, z);
};

const refreshAim = (delta: number) => {
  const shadowAim = shadowPlay().controls() && shadowPlay().handsOut() && !shadowPlay().linked();
  if (!state.running || state.inCutscene || panelsOpen() || (!state.player.weaponDrawn && !shadowAim) || phone.isRaised()) {
    autoAim.clear();
    followCamera.clearAim();
    aimSuppress = 0;
    aimEscape = 0;
    return;
  }
  const flick = followCamera.takeMouseFlick();
  const shoving = followCamera.lookForce() > 0.82;
  if (autoAim.point() && flick) aimSuppress = 0.35;
  else if (autoAim.point() && shoving) {
    aimEscape += delta;
    if (aimEscape > 0.16) aimSuppress = 0.3;
  } else aimEscape = 0;
  if (aimSuppress > 0) {
    aimSuppress = Math.max(0, aimSuppress - delta);
    if (shoving) aimSuppress = 0.3;
    autoAim.clear();
    followCamera.clearAim();
    return;
  }
  let count = 0;
  const chest = act.aimPoint();
  if (chest) {
    writeAim(count, chest.x, chest.y, chest.z);
    count += 1;
  }
  for (const enemy of enemies) {
    if (enemy.hp <= 0 || !enemy.mesh.isEnabled()) continue;
    const at = enemy.mesh.position;
    writeAim(count, at.x, at.y + 0.9, at.z);
    count += 1;
  }
  if (shadowAim) {
    for (const mark of shadowPlay().aimMarks()) {
      writeAim(count, mark.x, mark.y, mark.z);
      count += 1;
    }
  }
  autoAim.update(camera, aimPoints, count);
  const spot = autoAim.point();
  if (spot) followCamera.aimAt(spot.x, spot.y, spot.z);
  else followCamera.clearAim();
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
  if (event.key === 'Escape') {
    if (settingsOpen()) closeSettings();
    else if (isPaused()) setPaused(false);
    else setPaused(true);
    return;
  }
  // While paused or in Settings, keys belong to the menu.
  if (isPaused() || settingsOpen()) return;
  const key = event.key.toLowerCase();
  if (key === 'w' || key === 'arrowup') state.input.forward = true;
  if (key === 's' || key === 'arrowdown') state.input.backward = true;
  if (key === 'a' || key === 'arrowleft') state.input.left = true;
  if (key === 'd' || key === 'arrowright') state.input.right = true;
  if (key === 'shift') state.input.sprint = true;
  if (key === ' ') {
    event.preventDefault();
    const edge = !spaceDown;
    spaceDown = true;
    state.input.flyHeld = true;
    if (edge) onJumpPress();
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
  if (key === 'o') {
    event.preventDefault();
    setMissionsOpen(!missionsOpen);
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
  if (key === 'tab') {
    event.preventDefault();
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    switchAbility();
  }
  if (key === 'c') {
    event.preventDefault();
    if (shadowPlay().controls() && messageBox.classList.contains('hidden') && !panelsOpen()) {
      if (shadowPlay().toggleShadow()) {
        markMission('power-shadow');
        analytics?.used('shadow-mode');
      }
      if (!shadowPlay().shadowMode()) {
        playerAvatar.setArmed(false);
        syncEquippedCamera();
        updateCrosshairVisibility();
      }
      updateHud();
    }
  }
  if (key === 'r') {
    event.preventDefault();
    if (state.running && messageBox.classList.contains('hidden')) reloadWeapon();
  }
  if (key === 'e') {
    event.preventDefault();
    if (confirmStoryAction()) return;
    const pickup = nearestSupply();
    if (pickup && state.running && !state.inCutscene && !panelsOpen() && messageBox.classList.contains('hidden')) takeSupply(pickup);
  }
  if (key === 'h') {
    event.preventDefault();
    if (messageBox.classList.contains('hidden')) useMedkit();
  }
  if (key === 'l' && devLevelConfig) {
    showMessage('Dev level loaded', `${devLevelConfig.levelName || 'Custom'} • ${devLevelConfig.enemyCount || 0} enemies`);
  }
});

reloadHint?.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  event.stopPropagation();
  unlockAudio();
  if (state.running && messageBox.classList.contains('hidden')) reloadWeapon();
});
actionHint?.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  event.stopPropagation();
  unlockAudio();
  confirmStoryAction();
});
interactHint?.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  event.stopPropagation();
  unlockAudio();
  const pickup = nearestSupply();
  if (pickup && state.running && !state.inCutscene && !panelsOpen() && messageBox.classList.contains('hidden')) takeSupply(pickup);
});

window.addEventListener('keyup', (event) => {
  const key = event.key.toLowerCase();
  if (key === 'w' || key === 'arrowup') state.input.forward = false;
  if (key === 's' || key === 'arrowdown') state.input.backward = false;
  if (key === 'a' || key === 'arrowleft') state.input.left = false;
  if (key === 'd' || key === 'arrowright') state.input.right = false;
  if (key === 'shift') state.input.sprint = false;
  if (key === ' ') {
    spaceDown = false;
    state.input.jump = false;
    state.input.flyHeld = false;
    shadowAirJump = false;
  }
});

window.addEventListener('blur', clearInputState);
window.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('gesturestart', (event) => event.preventDefault(), { passive: false });
window.addEventListener('gesturechange', (event) => event.preventDefault(), { passive: false });
window.addEventListener('gestureend', (event) => event.preventDefault(), { passive: false });

canvas.addEventListener('pointerdown', (event) => {
  if (panelsOpen() || state.inCutscene) return;
  if (event.pointerType === 'mouse') {
    state.mouseLookActive = true;
    requestPlayLock();
  }
  shadowClickEdge = true;
  if (state.running) fireWeapon();
});

canvas.addEventListener('pointerup', () => {
  state.mouseLookActive = false;
  shadowClickEdge = false;
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
  state.input.flyHeld = true;
  onJumpPress();
});
const releaseJumpButton = () => {
  state.input.jump = false;
  state.input.flyHeld = false;
  shadowAirJump = false;
};
jumpBtn.addEventListener('pointerup', releaseJumpButton);
jumpBtn.addEventListener('pointerleave', releaseJumpButton);
jumpBtn.addEventListener('pointercancel', releaseJumpButton);

fireBtn.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  state.fireHeld = true;
  shadowClickEdge = true;
  if (state.running) fireWeapon();
});
fireBtn.addEventListener('pointerup', () => {
  state.fireHeld = false;
  shadowClickEdge = false;
});
fireBtn.addEventListener('pointerleave', () => { state.fireHeld = false; });
fireBtn.addEventListener('pointercancel', () => { state.fireHeld = false; });

startBtn.addEventListener('click', () => {
  // Retry on the error card reloads the page (its own handler in game.html).
  if (cardLeaving || loadFailed()) return;
  unlockAudio();
  const mode = menuMode();
  if (mode === 'level-complete') {
    lockPlayPointer();
    const next = nextPlayableLevel();
    if (next) void startAtLevel(next.id);
    return;
  }
  lockPlayPointer();
  if (mode === 'resume') {
    void startAtLevel(savedLevelId());
    return;
  }
  if (messageTitle.textContent === 'Defeat') {
    defeatLeft = 0;
    hideMessage();
    screenFade.to(1, 0);
    void startAtLevel(state.level, false, true);
    return;
  }
  if (!gameReady) return;
  if (forcedLoadFailure) {
    // Playtest `load-error`: Start loads the level again so the forced failure happens on a real press.
    void startAtLevel(state.level, false, true);
    return;
  }
  void fadeOutCard().then(beginGame);
});
newGameBtn.addEventListener('click', () => {
  analytics?.feature('new-game');
  unlockAudio();
  lockPlayPointer();
  void startAtLevel(1, true);
});
canvas.addEventListener('pointerdown', () => unlockAudio());
installAudioUnlock();

// ---------------------------------------------------------------- Tap to play, Pause, Settings (studio standard)

const tapPrompt = document.getElementById('tapToPlay') as HTMLDivElement | null;
const tapState = (window as { __phTap?: { tapped: boolean; onTap: (() => void) | null } }).__phTap;
// The capture listeners above already unlocked sound during this tap; this tops the pool up once more.
const warmSounds = () => {
  unlockAudio();
  preloadClips([SFX.walk, SFX.jump, SFX.start, SFX.objective, SFX.levelComplete, SFX.draw, SFX.holster, SFX.hurt]);
};
if (tapState) tapState.onTap = warmSounds;
if (tapState?.tapped) warmSounds();
const tapPromptShowing = () => Boolean(tapPrompt && !tapPrompt.hidden && !tapPrompt.classList.contains('gone'));

const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
const pauseMenu = document.getElementById('pauseMenu') as HTMLDivElement;
const resumeBtn = document.getElementById('resumeBtn') as HTMLButtonElement;
const settingsMenu = document.getElementById('settingsMenu') as HTMLDivElement;
const settingsRows = document.getElementById('settingsRows') as HTMLDivElement;
const soundSwitch = document.getElementById('soundSwitch') as HTMLButtonElement;
const musicVolume = document.getElementById('musicVolume') as HTMLInputElement;
const sfxVolume = document.getElementById('sfxVolume') as HTMLInputElement;
const musicVolumeOut = document.getElementById('musicVolumeOut') as HTMLOutputElement;
const sfxVolumeOut = document.getElementById('sfxVolumeOut') as HTMLOutputElement;

const renderSoundSettings = () => {
  const settings = soundSettings();
  soundSwitch.setAttribute('aria-checked', String(settings.on));
  soundSwitch.textContent = settings.on ? 'On' : 'Off';
  settingsRows.dataset.off = String(!settings.on);
  musicVolume.value = String(Math.round(settings.music * 100));
  sfxVolume.value = String(Math.round(settings.sfx * 100));
  musicVolumeOut.textContent = `${musicVolume.value}%`;
  sfxVolumeOut.textContent = `${sfxVolume.value}%`;
};
renderSoundSettings();
onSoundSettings(renderSoundSettings);

soundSwitch.addEventListener('click', () => {
  setSoundSettings({ on: !soundSettings().on });
  analytics?.setting('sound', soundSettings().on ? 'on' : 'off');
});
musicVolume.addEventListener('input', () => setSoundSettings({ music: Number(musicVolume.value) / 100 }));
musicVolume.addEventListener('change', () => analytics?.setting('music', Number(musicVolume.value)));
sfxVolume.addEventListener('change', () => analytics?.setting('sfx', Number(sfxVolume.value)));
sfxVolume.addEventListener('input', () => {
  setSoundSettings({ sfx: Number(sfxVolume.value) / 100 });
});
// A short tick at the new level, so the slider is heard as it moves.
sfxVolume.addEventListener('change', () => audio.tone(660, 0.09, 'sine', 0.05));

const settingsOpen = () => !settingsMenu.hidden;
const openSettings = () => {
  analytics?.screen(state.running ? 'settings-pause' : 'settings-title');
  renderSoundSettings();
  settingsMenu.hidden = false;
  unlockPointer();
  soundSwitch.focus({ preventScroll: true });
};
const closeSettings = () => {
  if (!settingsMenu.hidden) analytics?.screen(paused ? 'pause' : state.running ? 'level' : 'title');
  settingsMenu.hidden = true;
  if (!pauseMenu.hidden) resumeBtn.focus({ preventScroll: true });
};

let paused = false;
const isPaused = () => paused;
const setPaused = (on: boolean) => {
  if (on === paused) return;
  if (on && (!state.running || !messageBox.classList.contains('hidden'))) return;
  paused = on;
  pauseMenu.hidden = !on;
  analytics?.screen(on ? 'pause' : 'level');
  if (on) {
    clearInputState();
    state.fireHeld = false;
    audio.setWalk(false);
    unlockPointer();
    holdAllAudio();
    holdClips();
    scene.animationsEnabled = false;
    resumeBtn.focus({ preventScroll: true });
  } else {
    closeSettings();
    scene.animationsEnabled = true;
    releaseAllAudio();
    releaseClips();
    lockGameplayPointer();
  }
};

settingsBtn.addEventListener('click', () => openSettings());
document.getElementById('pauseSettingsBtn')?.addEventListener('click', () => openSettings());
document.getElementById('settingsDoneBtn')?.addEventListener('click', () => closeSettings());
pauseBtn.addEventListener('click', () => setPaused(true));
resumeBtn.addEventListener('click', () => setPaused(false));
// Going to another tab or app pauses; coming back shows Paused so nothing is missed.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.running && messageBox.classList.contains('hidden')) setPaused(true);
});

/**
 * iOS drops the click for a tap made while another finger is on a stick, so HUD buttons never fire mid-drag.
 * Fire the click on touch pointerup ourselves and swallow the native one if it does arrive.
 */
let touchClickAt = 0;
let touchClickTarget: Element | null = null;
document.addEventListener('pointerup', (event) => {
  if (event.pointerType !== 'touch') return;
  const target = (event.target as Element | null)?.closest?.('button');
  if (!target || (target as HTMLButtonElement).disabled || target.closest('#devtools, .editor')) return;
  const down = touchDownButtons.get(event.pointerId);
  touchDownButtons.delete(event.pointerId);
  if (down !== target) return;
  touchClickAt = performance.now();
  touchClickTarget = target;
  (target as HTMLButtonElement).click();
}, true);
const touchDownButtons = new Map<number, Element>();
document.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'touch') return;
  const target = (event.target as Element | null)?.closest?.('button');
  if (target) touchDownButtons.set(event.pointerId, target);
}, true);
document.addEventListener('pointercancel', (event) => touchDownButtons.delete(event.pointerId), true);
window.addEventListener('click', (event) => {
  if (!event.isTrusted || !touchClickTarget) return;
  if (performance.now() - touchClickAt > 800) return;
  if (!touchClickTarget.contains(event.target as Node)) return;
  event.stopImmediatePropagation();
  event.preventDefault();
}, true);
resetBtn.addEventListener('click', () => {
  if (messageTitle.textContent === 'Defeat') {
    analytics?.toTitle();
    defeatLeft = 0;
    levelPicked = false;
    state.running = false;
    menuCameraActive = true;
    activateMenuCamera(scene, menuCamera);
    showMessage('PH Origins', levelStartLine());
    return;
  }
  analytics?.feature('reset-progress');
  stopEndingSong();
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
  void withLoadTimeout(loadMissionScene(getLevelDefinition(1).path)).catch((error) => showLoadError('level', error));
  updateHud();
  showMessage('PH Origins', levelStartLine());
  menuCameraActive = true;
  activateMenuCamera(scene, menuCamera);
});

/**
 * The train car sways: roll the game camera with the car (around the car's long axis, x). The follow camera sets
 * its up vector back to +y every frame it updates, so this only ever adds this frame's roll.
 */
const applyCarSway = () => {
  const roll = state.running && scene.activeCamera === camera ? dressing.roll() : 0;
  if (roll === 0) {
    if (camera.upVector.y !== 1) camera.upVector.set(0, 1, 0);
    return;
  }
  camera.upVector.set(0, Math.cos(roll), Math.sin(roll));
};

const renderLoop = () => {
  pauseBtn.hidden = !(state.running && !paused && messageBox.classList.contains('hidden'));
  if (paused) {
    // Hold the frame: no story, camera or cutscene time passes until Resume.
    scene.render();
    return;
  }
  const delta = engine.getDeltaTime() / 1000;
  screenFade.update(delta);
  syncActionHint();
  if (defeatLeft > 0) {
    defeatLeft = Math.max(0, defeatLeft - delta);
    if (defeatLeft === 0) showMessage('Defeat', GAME_COPY.defeat);
  }
  const cine = state.inCutscene || home.playing() || desk.playing() || station.playing() || train.playing();
  updateMinimap(delta);
  dressing.step(delta);
  if (wasInCutscene && !cine) lockGameplayPointer();
  wasInCutscene = cine;
  if (skipCutsceneBtn) {
    const canSkip = state.running && ((state.inCutscene && !!activeCutscene) || home.playing() || desk.playing() || station.playing() || train.playing());
    skipCutsceneBtn.hidden = !canSkip;
  }
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
    } else if (home.playing()) {
      home.step(delta);
      updateCamera(delta, false, null);
      const amp = home.shake();
      if (amp > 0) {
        camera.position.x += (Math.random() - 0.5) * amp;
        camera.position.y += (Math.random() - 0.5) * amp * 0.65;
      }
    } else if (desk.playing()) {
      desk.step(delta);
      updateCamera(delta, false, null);
      const amp = desk.shake();
      if (amp > 0) {
        camera.position.x += (Math.random() - 0.5) * amp;
        camera.position.y += (Math.random() - 0.5) * amp * 0.65;
      }
    } else if (station.playing()) {
      station.step(delta);
      updateCamera(delta, false, null);
    } else if (train.playing()) {
      train.step(delta);
      updateCamera(delta, false, null);
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
    updateCamera(delta, shadowPlay().linked() ? shadowPlay().linkMoving() : locomotion.moving, locomotion.moveHeading);
    refreshAim(delta);
    triggerRunner.update(state.player);
    act.stepWorld(delta);
    home.step(delta);
    station.step(delta);
    train.step(delta);
    const streetShake = home.shake();
    if (streetShake > 0) {
      camera.position.x += (Math.random() - 0.5) * streetShake;
      camera.position.y += (Math.random() - 0.5) * streetShake * 0.65;
    }
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
        lastHurtCause = 'enemy';
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

  if (possessBar && possessFill) {
    const left = shadowPlay().linked() ? shadowPlay().possessLeft() : 0;
    possessBar.hidden = left <= 0;
    if (left > 0) possessFill.style.transform = `scaleX(${Math.max(0, Math.min(1, left / POSSESS_SECONDS))})`;
  }
  if (shadowRunBar && shadowRunFill) {
    const showRun = shadowPlay().controls() && shadowPlay().shadowMode() && (shadowRunActive() || shadowRunLeft < SHADOW_RUN_SECONDS - 0.05);
    shadowRunBar.hidden = !showRun;
    if (showRun) shadowRunFill.style.transform = `scaleX(${Math.max(0, Math.min(1, shadowRunLeft / SHADOW_RUN_SECONDS))})`;
  }
  perfMonitor.update(delta, engine.getFps());
  shadowVeil.update(
    shadowPlay().controls() && shadowPlay().shadowMode(),
    playerAvatar,
    state.player.x,
    state.player.z,
    state.characterYaw,
    delta,
    shadowRunActive(),
    Math.max(0, state.player.y - PLAYER_STAND_Y),
  );
  applyCarSway();
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
// The FPS / MEM readout shows on phones and tablets only in debug (dev server or ?debug).
if (isLocalPlay() || new URLSearchParams(location.search).has('debug')) document.body.dataset.debug = 'true';

const renderLevelSelect = () => {
  levelList.innerHTML = '';
  // Hidden slots (comingSoon, level 7 until it is written) are not listed at all.
  const levels = getLevels().filter((level) => !level.comingSoon);

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
        <small>${level.reward} · ${missionLabel(level.libraryId, doneMissionIds(level.libraryId))}</small>
      </div>
      <span>${unlocked ? 'Play' : 'Locked'}</span>
    `;

    button.addEventListener('click', () => {
      if (comingSoon) {
        messageText.textContent = 'Coming soon.';
        return;
      }
      if (!unlocked) return;
      analytics?.feature('level-select', level.id);
      levelPicked = true;
      state.level = level.id;
      state.progression.currentLevel = level.id;
      applyLevelConfig(level);
      void withLoadTimeout(loadMissionScene(level.path)).catch((error) => showLoadError('level', error));
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
  analytics?.screen('level-select');
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
  analytics?.screen('title');
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
    void withLoadTimeout(loadMissionScene(getLevelDefinition(state.level).path)).catch((error) => showLoadError('level', error));
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
engine.resize();
applyRenderScale();
engine.runRenderLoop(renderLoop);
let phoneFramed = false;
window.addEventListener('resize', () => {
  if (!phoneFramed) configureResponsiveUI(root);
  engine.resize();
  applyRenderScale();
});

/** Playtest setup: lay the page out as a 390x844 phone, centred and scaled to fit a desktop viewport. */
const setPhoneFrame = (on: boolean) => {
  phoneFramed = on;
  if (on) {
    const scale = Math.min(1, window.innerHeight / 844, window.innerWidth / 390);
    Object.assign(root.style, { width: '390px', height: '844px', margin: '0 auto', transform: `scale(${scale})`, transformOrigin: 'center center' });
    document.body.dataset.device = 'mobile';
    document.body.dataset.orientation = 'portrait';
    document.body.dataset.touch = 'true';
    root.classList.add('is-mobile');
    root.style.setProperty('--ui-scale', '0.96');
  } else {
    Object.assign(root.style, { width: '', height: '', margin: '', transform: '', transformOrigin: '' });
    configureResponsiveUI(root);
  }
  engine.resize();
};

// Hawkes Analytics (src/game/analytics.ts, AGENTS.md "Analytics"). Read-only probe like the playtest's below.
analytics = createGameAnalytics({
  running: () => state.running,
  paused: () => isPaused(),
  menuOpen: () => !messageBox.classList.contains('hidden'),
  cutscene: () => (state.inCutscene && activeCutscene ? { id: activeCutscene.id, time: activeCutscene.time } : null),
  scripted: () => (home.playing() ? 'going-home-lobby' : desk.playing() ? 'the-desk' : station.playing() ? 'station-opening' : train.playing() ? 'train-opening' : null),
  level: () => {
    const level = getLevelDefinition(state.level);
    return { id: level.id, libraryId: level.libraryId, name: level.name };
  },
  theme: () => (scene.metadata as { themeName?: string } | null)?.themeName ?? getLevelDefinition(state.level).theme,
  objective: () => ({
    title: (objectiveHud?.querySelector('.objective-kicker') as HTMLElement | null)?.textContent?.trim() ?? '',
    text: objectiveText?.textContent?.trim() ?? '',
  }),
  player: () => ({ x: state.player.x, z: state.player.z }),
});
analytics.context({ graphics: lowPowerGraphics ? 'low' : 'high' });

// Hawkes playtest contract (src/playtest/phPlaytest.ts). Read-only probe; the bot plays through real input.
installPhPlaytest({
  ready: () => gameReady && !startBtn.disabled,
  running: () => state.running,
  level: () => {
    const level = getLevelDefinition(state.level);
    return { id: level.id, libraryId: level.libraryId, name: level.name };
  },
  player: () => ({
    x: state.player.x,
    y: state.player.y,
    z: state.player.z,
    yaw: state.characterYaw,
    health: state.health,
    clip: state.player.clip,
    ammo: itemCount(state.inventory, 'ammo'),
    medkits: itemCount(state.inventory, 'medkit'),
    weaponDrawn: state.player.weaponDrawn,
  }),
  cameraYaw: () => followCamera.getYaw(),
  objective: () => {
    const target = objectiveMarker.getTarget();
    const kicker = objectiveHud?.querySelector('.objective-kicker') as HTMLElement | null;
    return {
      target: target && objectiveMarker.isVisible() ? { x: target.x, z: target.z } : null,
      title: kicker?.textContent ?? '',
      text: objectiveText?.textContent ?? '',
      visible: objectiveHud?.classList.contains('visible') ?? false,
    };
  },
  action: () => storyAction(),
  phase: () => act.phase(),
  cutscene: () => (state.inCutscene && activeCutscene
    ? { id: activeCutscene.id, time: activeCutscene.time, duration: activeCutscene.duration }
    : null),
  scripted: () => (home.playing() ? 'going-home-lobby' : desk.playing() ? 'the-desk' : station.playing() ? 'station-opening' : train.playing() ? 'train-opening' : null),
  phone: () => {
    const view = phone.view();
    return { incoming: view.showAnswer, busy: phone.locksBody(), speaker: view.speaker, line: view.line };
  },
  menu: () => ({
    open: !messageBox.classList.contains('hidden'),
    title: messageTitle.textContent ?? '',
    text: messageText.textContent ?? '',
    start: startBtn.style.display === 'none' ? null : (startBtn.textContent ?? '').trim(),
    startEnabled: !startBtn.disabled,
    newGame: newGameBtn.style.display !== 'none',
  }),
  subtitle: () => ({
    speaker: cineTitle.textContent ?? '',
    text: cineHud.style.display === 'none' ? '' : cineText.textContent ?? '',
  }),
  creature: () => {
    const at = act.aimPoint();
    return at ? { x: at.x, y: at.y, z: at.z } : null;
  },
  aimLocked: () => !!autoAim.point(),
  shadow: () => ({
    controls: shadowPlay().controls(),
    on: shadowPlay().shadowMode(),
    handsOut: shadowPlay().handsOut(),
    linked: shadowPlay().linked(),
    ability: shadowPlay().shadowMode() ? shadowPick : meleeAbility,
    lessonStarted: isHomeLevel() ? home.shoveShown() : true,
  }),
  people: () => (isHomeLevel() ? home.map()?.blips ?? [] : [])
    .filter((blip) => blip.kind !== 'shop' && blip.kind !== 'linked')
    .map((blip) => ({ x: blip.x, z: blip.z, kind: blip.kind })),
  pickups: () => pickups
    .filter((pickup) => pickup.active && !pickup.mesh.isDisposed() && pickup.mesh.isEnabled())
    .map((pickup) => ({ x: pickup.mesh.position.x, z: pickup.mesh.position.z, item: pickup.item })),
  scene,
  canvas,
  startButton: startBtn,
  newGameButton: newGameBtn,
  skipButton: skipCutsceneBtn,
  setupLevel: (id) => startAtLevel(id, true, true),
  setupHidden: (libraryId) => {
    const level = getLevels().find((entry) => entry.libraryId === libraryId);
    return level ? startAtLevel(level.id, true, true, true) : Promise.resolve();
  },
  levelRows: () => {
    renderLevelSelect();
    return [...levelList.querySelectorAll('.level-item strong')].map((row) => row.textContent?.trim() ?? '');
  },
  train: () => dressing.train()?.stats() ?? null,
  failNextLoad: (kind) => { forcedLoadFailure = kind; },
  forceDefeat: () => {
    if (!state.running || state.inCutscene) return false;
    applyHurt(Math.max(1, state.health), 'playtest');
    return true;
  },
  counts: () => ({
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    textures: scene.textures.length,
    skeletons: scene.skeletons.length,
    animationGroups: scene.animationGroups.length,
    particleSystems: scene.particleSystems.length,
    lights: scene.lights.length,
    transformNodes: scene.transformNodes.length,
    renderTargets: scene.customRenderTargets.length,
    audioElements: liveAudioElementCount(),
    audioRouted: routedAudioElementCount(),
    audioClips: liveClipCount(),
    fps: Math.round(engine.getFps() * 10) / 10,
  }),
  phoneFrame: setPhoneFrame,
  sound: () => ({
    prompt: tapPromptShowing(),
    context: audioContextState(),
    paused: isPaused(),
    settingsOpen: settingsOpen(),
    settings: soundSettings(),
  }),
});

// The module ran: from here on, load failures are caught above (boot, Start) and by the load timeout.
phBoot?.started();
