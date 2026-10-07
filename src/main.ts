import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders';

import { configureResponsiveUI } from './game/mobile';
import { createHumanoid, clearEnemies, type Enemy, spawnEnemy, updateEnemyAI } from './game/enemies';
import { createPlayerAvatar } from './game/playerAvatar';
import { addItem, createInventoryState, consumeItem, inventorySummary } from './game/inventory';
import { getLevelDefinition, getLevels, getUnlockedLevelCount } from './game/levels';
import { applyJump, clampPlayerToArena, createPlayerState, updateVerticalMotion } from './game/player';
import { clampValue, createBurst, createProjectile } from './game/physics';
import { createQuestState, getGoalText, updateQuestProgress } from './game/progression';
import { applyTheme, getSceneTheme } from './game/scene';
import { importAssetFile } from './game/importer';
import { DEFAULT_SCENE_FILE_PATH, loadSceneFromJson, loadSceneFromJsonFile, readSceneData } from './game/sceneData';
import type { InventoryItemType, InventoryState, ProgressionState, QuestState } from './game/types';

const root = document.getElementById('game-root') as HTMLDivElement;
const scoreEl = document.getElementById('score') as HTMLSpanElement;
const bestEl = document.getElementById('best') as HTMLSpanElement;
const healthEl = document.getElementById('health') as HTMLSpanElement;
const levelEl = document.getElementById('level') as HTMLSpanElement;
const messageBox = document.getElementById('messageBox') as HTMLDivElement;
const messageTitle = document.getElementById('messageTitle') as HTMLHeadingElement;
const messageText = document.getElementById('messageText') as HTMLParagraphElement;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
const jumpBtn = document.getElementById('jumpBtn') as HTMLButtonElement;
const fireBtn = document.getElementById('fireBtn') as HTMLButtonElement;
const leftStickZone = document.getElementById('leftStickZone') as HTMLDivElement;
const leftStickKnob = document.getElementById('leftStickKnob') as HTMLDivElement;
const loadModelBtn = document.getElementById('loadModelBtn') as HTMLButtonElement;
const modelInput = document.getElementById('modelInput') as HTMLInputElement;
const devToggle = document.getElementById('devToggle') as HTMLButtonElement;
const devPanel = document.getElementById('devPanel') as HTMLDivElement;
const devOutput = document.getElementById('devOutput') as HTMLTextAreaElement;
const devFps = document.getElementById('devFps') as HTMLSpanElement;
const devHealth = document.getElementById('devHealth') as HTMLSpanElement;
const devScore = document.getElementById('devScore') as HTMLSpanElement;
const devLevel = document.getElementById('devLevel') as HTMLSpanElement;
const levelSelect = document.getElementById('levelSelect') as HTMLDivElement;
const levelList = document.getElementById('levelList') as HTMLDivElement;
const closeLevelSelectBtn = document.getElementById('closeLevelSelect') as HTMLButtonElement;
const crosshair = document.getElementById('crosshair') as HTMLDivElement;
const inventoryHud = document.getElementById('inventoryHud') as HTMLDivElement;

const canvas = document.createElement('canvas');
canvas.style.width = '100%';
canvas.style.height = '100%';
canvas.style.touchAction = 'none';
canvas.style.userSelect = 'none';
root.appendChild(canvas);

const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new BABYLON.Scene(engine);

const camera = new BABYLON.UniversalCamera('playerCamera', new BABYLON.Vector3(0, 1.7, 6), scene);
camera.fov = 0.9;
camera.minZ = 0.1;
camera.maxZ = 200;
camera.angularSensibility = 1700;
camera.speed = 8;
camera.inputs.clear();

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

void loadSceneFromJsonFile(scene, DEFAULT_SCENE_FILE_PATH).then((fileScene) => {
  if (fileScene) {
    applyTheme(scene, fileScene.theme || currentThemeName);
    return;
  }
  loadSceneFromJson(scene, initialSceneData);
}).catch(() => {
  loadSceneFromJson(scene, initialSceneData);
});

const saveKey = 'ph-origins-save';
type SaveData = { best: number; unlocked: number; sound: boolean };
const defaultSave: SaveData = { best: 0, unlocked: 1, sound: true };

const GAME_COPY = {
  intro: 'Move with WASD • Aim with mouse or drag • Fire • Jump • Explore the mission',
  missionClear: (score: number) => `You scored ${score}. Keep pushing into the next mission.`,
  defeat: (score: number) => `You scored ${score}. Press Start to retry.`,
  reset: 'Move with WASD • Aim with mouse or drag • Fire • Jump • Explore the mission',
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
  score: 0,
  health: 100,
  best: save.best,
  level: 1,
  wave: 1,
  kills: 0,
  lastSpawn: 0,
  lastDamageAt: 0,
  shootCooldown: 0,
  playerSpeed: Number(devLevelConfig?.playerSpeed) || 8.5,
  fireRate: Number(devLevelConfig?.fireRate) || 0.14,
  enemyHpMultiplier: Number(devLevelConfig?.enemyHp) || 1,
  spawnInterval: Number(devLevelConfig?.spawnRate) || 1.4,
  arenaSize: Number(devLevelConfig?.arenaSize) || 90,
  pointerLocked: false,
  mouseLookActive: false,
  progression: {
    currentLevel: 1,
    highestUnlocked: 1,
    xp: 0,
    medals: 0,
  } satisfies ProgressionState,
  quests: createQuestState() satisfies QuestState[],
  inventory: createInventoryState() satisfies InventoryState,
  player: createPlayerState(),
  cameraYaw: Math.PI,
  cameraPitch: 0,
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
};

const enemies: Enemy[] = [];
const projectiles: Array<{ mesh: BABYLON.Mesh; direction: BABYLON.Vector3; life: number; speed: number; damage: number }> = [];
const particles: Array<{ mesh: BABYLON.Mesh; velocity: BABYLON.Vector3; life: number }> = [];
const pickups: Array<{ mesh: BABYLON.Mesh; item: InventoryItemType; amount: number; active: boolean }> = [];
const weaponMuzzle = new BABYLON.Mesh('weaponMuzzle', scene);
weaponMuzzle.position = new BABYLON.Vector3(0.45, -0.12, 1.2);
weaponMuzzle.isVisible = false;

const playerAvatar = createPlayerAvatar(scene);
playerAvatar.group.parent = null;
playerAvatar.group.position = new BABYLON.Vector3(0, 0, 0);
playerAvatar.group.rotation.y = Math.PI;

const gunMesh = BABYLON.MeshBuilder.CreateBox('gunMesh', { width: 0.18, height: 0.18, depth: 0.9 }, scene);
const gunMat = new BABYLON.StandardMaterial('gunMat', scene);
gunMat.diffuseColor = new BABYLON.Color3(0.1, 0.1, 0.12);
gunMat.emissiveColor = new BABYLON.Color3(0.05, 0.05, 0.06);
gunMesh.material = gunMat;
gunMesh.parent = playerAvatar.group;
gunMesh.position = new BABYLON.Vector3(0.7, 1.15, 0.8);
gunMesh.rotation.x = -0.2;
gunMesh.rotation.y = Math.PI / 3;

const audio = {
  enabled: save.sound,
  ctx: undefined as AudioContext | undefined,
  ensure() {
    if (!this.ctx) {
      const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      this.ctx = new AudioCtor();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
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
  scoreEl.textContent = Math.floor(state.score).toString();
  bestEl.textContent = Math.floor(state.best).toString();
  healthEl.textContent = Math.max(0, Math.ceil(state.health)).toString();
  levelEl.textContent = state.level.toString();
  devFps.textContent = `${Math.max(0, Math.round(engine.getFps()))}`;
  devHealth.textContent = Math.max(0, Math.ceil(state.health)).toString();
  devScore.textContent = Math.floor(state.score).toString();
  devLevel.textContent = state.level.toString();

  const invEntries = [
    ['Ammo', state.inventory.items.ammo ?? 0],
    ['Medkit', state.inventory.items.medkit ?? 0],
    ['Scrap', state.inventory.items.scrap ?? 0],
    ['Core', state.inventory.items.power_core ?? 0],
  ] as const;
  inventoryHud.innerHTML = invEntries
    .map(([label, count]) => `<span class="inventory-item"><span class="inventory-label">${label}</span><strong>${count}</strong></span>`)
    .join('');
};

const syncStartButtonLabel = () => {
  const shouldContinue = state.running || state.score > 0 || state.best > 0;
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
  const visible = state.running && messageBox.classList.contains('hidden');
  crosshair.style.display = visible ? 'block' : 'none';
};

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
  for (const projectile of projectiles) {
    projectile.mesh.dispose();
  }
  for (const particle of particles) {
    particle.mesh.dispose();
  }
  for (const pickup of pickups) {
    pickup.mesh.dispose();
  }
  projectiles.length = 0;
  particles.length = 0;
  pickups.length = 0;
};

const resetPlayer = () => {
  state.player = createPlayerState();
  state.level = 1;
  state.wave = 1;
  state.score = 0;
  state.health = 100;
  state.shootCooldown = 0;
  state.lastDamageAt = 0;
  state.kills = 0;
  state.progression.currentLevel = 1;
  state.progression.highestUnlocked = Math.max(1, state.progression.highestUnlocked);
  state.inventory = createInventoryState();
  state.quests = createQuestState();
  state.cameraYaw = Math.PI;
  state.cameraPitch = 0;
  camera.position = new BABYLON.Vector3(0, 3.2, 6);
  camera.setTarget(new BABYLON.Vector3(0, 1.6, 0));
};

const beginGame = () => {
  audio.start();
  state.running = true;
  clearDynamicObjects();
  resetPlayer();
  syncStartButtonLabel();
  updateHud();
  hideMessage();
};

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
  const finalScore = Math.floor(state.score);
  const best = Math.max(state.best, finalScore);
  state.best = best;
  saveGame({ best, unlocked: Math.max(save.unlocked ?? 1, state.level), sound: audio.enabled });
  updateHud();

  if (won) {
    audio.win();
    showMessage('Mission Clear', GAME_COPY.missionClear(finalScore));
  } else {
    audio.hit();
    showMessage('Defeat', GAME_COPY.defeat(finalScore));
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
  state.cameraYaw += dx * 0.0022;
  state.cameraPitch = clampValue(state.cameraPitch - dy * 0.0016, -1.1, 1.1);
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
};

const updateCamera = () => {
  const target = new BABYLON.Vector3(state.player.x, state.player.y + 1.2, state.player.z);
  const behindOffset = new BABYLON.Vector3(
    Math.sin(state.cameraYaw) * -8,
    3.1 - state.cameraPitch * 1.6,
    Math.cos(state.cameraYaw) * -8,
  );
  const aimTarget = new BABYLON.Vector3(
    target.x + Math.sin(state.cameraYaw) * 14,
    target.y + state.cameraPitch * 4,
    target.z + Math.cos(state.cameraYaw) * 14,
  );

  camera.position = target.add(behindOffset);
  camera.setTarget(aimTarget);

  gunMesh.position.x = 0.7;
  gunMesh.position.y = 1.15;
  gunMesh.position.z = 0.8;
  gunMesh.rotation.y = state.cameraYaw + Math.PI / 1.9;
  gunMesh.rotation.x = state.cameraPitch * 0.4 - 0.25;

  playerAvatar.group.rotation.y = state.cameraYaw + Math.PI;
  playerAvatar.group.position = new BABYLON.Vector3(state.player.x, state.player.y - 1.6, state.player.z);
};

const updatePlayer = (delta: number) => {
  const forward = new BABYLON.Vector3(Math.sin(state.cameraYaw), 0, Math.cos(state.cameraYaw));
  const right = new BABYLON.Vector3(Math.cos(state.cameraYaw), 0, -Math.sin(state.cameraYaw));

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
    state.player.x += desiredMove.x * speed * delta;
    state.player.z += desiredMove.z * speed * delta;
  }

  const walkMagnitude = Math.hypot(moveX, moveZ);
  playerAvatar.setMoving(walkMagnitude > 0.05);

  clampPlayerToArena(state.player, state.arenaSize);
  updateVerticalMotion(state.player, delta);

  if (state.input.jump && state.player.grounded) {
    if (applyJump(state.player)) {
      state.input.jump = false;
      audio.tone(360, 0.12, 'triangle', 0.04);
    }
  }
};

const projectileSpawner = (sceneRef: BABYLON.Scene, origin: BABYLON.Vector3, direction: BABYLON.Vector3) => {
  const projectile = createProjectile(sceneRef, origin, direction);
  projectiles.push(projectile);
  weaponMuzzle.position = new BABYLON.Vector3(0.45, -0.12, 1.2);
  weaponMuzzle.isVisible = true;
  setTimeout(() => {
    weaponMuzzle.isVisible = false;
  }, 35);
};

const fireWeapon = () => {
  if (!state.running || state.shootCooldown > 0) return;
  if (!consumeItem(state.inventory, 'ammo', 1)) {
    audio.hit();
    return;
  }
  state.shootCooldown = state.fireRate;

  const forward = camera.getForwardRay(1).direction.normalize();
  projectileSpawner(scene, camera.position.add(forward.scale(1.5)), forward);
  audio.shoot();
};

const spawnWaveEnemy = () => {
  const enemy = spawnEnemy(scene, state.level);
  enemy.hp = Math.max(1, state.level * state.enemyHpMultiplier);
  const angle = Math.random() * Math.PI * 2;
  const distance = 20 + Math.random() * 14;
  enemy.mesh.position = new BABYLON.Vector3(Math.cos(angle) * distance, 0.9, Math.sin(angle) * distance);
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

jumpBtn.addEventListener('pointerdown', (event) => {
  event.preventDefault();
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

startBtn.addEventListener('click', beginGame);
resetBtn.addEventListener('click', () => {
  clearDynamicObjects();
  clearInputState();
  resetPlayer();
  state.best = loadSave().best;
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
    if (state.fireHeld) fireWeapon();

    const targetWave = 1 + Math.floor(state.score / 220);
    state.level = Math.min(8, targetWave);
    state.wave = state.level;
    state.progression.currentLevel = state.level;
    state.progression.highestUnlocked = Math.max(state.progression.highestUnlocked, state.level);
    const levelConfig = getLevelDefinition(state.level);
    state.playerSpeed = Number(devLevelConfig?.playerSpeed) || state.playerSpeed || levelConfig.playerSpeed;
    state.fireRate = Number(devLevelConfig?.fireRate) || state.fireRate || levelConfig.fireRate;
    state.enemyHpMultiplier = Number(devLevelConfig?.enemyHp) || state.enemyHpMultiplier || levelConfig.enemyHp;
    state.spawnInterval = Number(devLevelConfig?.spawnRate) || state.spawnInterval || levelConfig.spawnRate;
    state.arenaSize = Number(devLevelConfig?.arenaSize) || state.arenaSize || 90;

    const spawnDelay = Math.max(0.45, state.spawnInterval * (1.75 - state.level * 0.14));
    if (performance.now() - state.lastSpawn > spawnDelay * 1000 || enemies.length === 0) {
      const maxSpawns = Math.min(2 + state.level, Math.max(2, Number(devLevelConfig?.enemyCount) || 8));
      for (let i = 0; i < Math.min(maxSpawns, 8); i++) {
        if (enemies.length < Math.max(6, Number(devLevelConfig?.enemyCount) || 8)) spawnWaveEnemy();
      }
      state.lastSpawn = performance.now();
    }

    updatePlayer(delta);
    updateCamera();

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

    for (const projectile of projectiles) {
      projectile.mesh.position.addInPlace(projectile.direction.scale(projectile.speed * delta));
      projectile.life -= delta;

      for (const enemy of enemies) {
        const dist = BABYLON.Vector3.Distance(enemy.mesh.position, projectile.mesh.position);
        if (dist < 1.2) {
          enemy.hp -= projectile.damage;
          projectile.life = 0;
          projectile.mesh.dispose();
          createBurst(scene, projectile.mesh.position.x, projectile.mesh.position.y, projectile.mesh.position.z, new BABYLON.Color3(0.55, 0.83, 1), particles);
          if (enemy.hp <= 0) {
            enemy.mesh.dispose();
            const index = enemies.indexOf(enemy);
            if (index >= 0) enemies.splice(index, 1);
            state.score += 50;
            state.kills += 1;
            awardQuestProgress('kills', 1);
            awardQuestProgress('score', 50);
            if (Math.random() > 0.72) {
              spawnPickup(new BABYLON.Vector3(enemy.mesh.position.x, 1.2, enemy.mesh.position.z), Math.random() > 0.5 ? 'ammo' : 'scrap', 1);
            }
            audio.pickup();
          }
          break;
        }
      }
    }

    for (let i = projectiles.length - 1; i >= 0; i--) {
      if (projectiles[i].life <= 0) {
        projectiles[i].mesh.dispose();
        projectiles.splice(i, 1);
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

      if (state.score > state.best) {
      state.best = state.score;
      saveGame({ best: Math.floor(state.best), unlocked: Math.max(save.unlocked ?? 1, state.level), sound: audio.enabled });
    }

    if (state.kills >= 12 && state.level >= 5) {
      finishGame(true);
    }

    state.progression.xp = Math.max(0, Math.floor(state.score / 20));
    state.progression.medals = Math.max(0, Math.floor(state.kills / 3));
    updateQuestTracker();
    updateHud();
  } else {
    updateCamera();
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

const themeOrder = ['Neon Drift', 'Crimson Surge', 'Arctic Rift'] as const;
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
    const unlocked = level.id <= state.progression.highestUnlocked;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `level-item${unlocked ? '' : ' locked'}`;
    button.disabled = !unlocked;
    button.innerHTML = `
      <div>
        <strong>Level ${level.id}: ${level.name}</strong>
        <small>${level.reward}</small>
      </div>
      <span>${unlocked ? 'Play' : 'Locked'}</span>
    `;

    button.addEventListener('click', () => {
      if (!unlocked) return;
      state.level = level.id;
      state.progression.currentLevel = level.id;
      state.progression.highestUnlocked = Math.max(state.progression.highestUnlocked, level.id);
      const nextConfig = getLevelDefinition(level.id);
      state.playerSpeed = nextConfig.playerSpeed;
      state.fireRate = nextConfig.fireRate;
      state.enemyHpMultiplier = nextConfig.enemyHp;
      state.spawnInterval = nextConfig.spawnRate;
      applyTheme(scene, nextConfig.theme);
      levelSelect.classList.add('hidden');
      messageText.textContent = `${nextConfig.name} • ${nextConfig.reward}`;
      messageTitle.textContent = 'PH Origins';
      syncStartButtonLabel();
      updateCrosshairVisibility();
    });

    levelList.appendChild(button);
  });
};

const showLevelSelect = () => {
  renderLevelSelect();
  messageTitle.textContent = 'Mission Select';
  messageText.textContent = 'Choose the next zone and continue your run.';
  levelSelect.classList.remove('hidden');
  messageBox.classList.remove('hidden');
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
    state.health = 100;
    updateHud();
  },
  score: () => {
    state.score += 100;
    updateHud();
  },
  level: () => {
    state.level += 1;
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

if (devLevelConfig) {
  const cfg = devLevelConfig;
  state.level = Math.max(1, Number(cfg.difficulty) || 1);
  state.progression.currentLevel = state.level;
  state.progression.highestUnlocked = getUnlockedLevelCount(Math.max(state.progression.highestUnlocked, state.level));
  state.playerSpeed = Number(cfg.playerSpeed) || state.playerSpeed;
  state.fireRate = Number(cfg.fireRate) || state.fireRate;
  state.enemyHpMultiplier = Number(cfg.enemyHp) || state.enemyHpMultiplier;
  state.spawnInterval = Number(cfg.spawnRate) || state.spawnInterval;
  state.arenaSize = Number(cfg.arenaSize) || state.arenaSize;
  activeThemeName = typeof cfg.theme === 'string' ? cfg.theme : 'Neon Drift';
  applyTheme(scene, activeThemeName);
  showMessage('Dev level', `${cfg.levelName || 'Custom'} • ${cfg.theme || 'Neon Drift'} • difficulty ${state.level}`);
} else {
  loadModelBtn.style.display = '';
  showMessage('PH Origins', GAME_COPY.intro);
}

updateCrosshairVisibility();
configureResponsiveUI(root);
engine.runRenderLoop(renderLoop);
window.addEventListener('resize', () => {
  configureResponsiveUI(root);
  engine.resize();
});
