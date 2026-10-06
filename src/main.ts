import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders';

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
const leftBtn = document.getElementById('leftBtn') as HTMLButtonElement;
const rightBtn = document.getElementById('rightBtn') as HTMLButtonElement;
const jumpBtn = document.getElementById('jumpBtn') as HTMLButtonElement;

const canvas = document.createElement('canvas');
canvas.style.width = '100%';
canvas.style.height = '100%';
root.appendChild(canvas);

const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.05, 0.07, 0.12, 1);

const camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 4.5, -8), scene);
camera.setTarget(new BABYLON.Vector3(0, 1.5, 0));

const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
hemi.intensity = 0.9;

const dirLight = new BABYLON.DirectionalLight('dirLight', new BABYLON.Vector3(-1, -2, 1), scene);
dirLight.position = new BABYLON.Vector3(6, 10, 4);
dirLight.intensity = 0.8;

const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 60, height: 60 }, scene);
ground.position.y = -0.5;
const groundMat = new BABYLON.StandardMaterial('groundMat', scene);
groundMat.diffuseColor = new BABYLON.Color3(0.12, 0.2, 0.28);
groundMat.emissiveColor = new BABYLON.Color3(0.04, 0.07, 0.1);
ground.material = groundMat;

const saveKey = 'ph-origins-save';
type SaveData = { best: number; unlocked: number; sound: boolean };
const defaultSave: SaveData = { best: 0, unlocked: 1, sound: true };
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
const clampValue = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const state = {
  running: false,
  score: 0,
  health: 5,
  best: save.best,
  level: 1,
  lastSpawn: 0,
  lastDamageAt: 0,
  shootCooldown: 0,
  player: {
    x: 0,
    y: 1.2,
    z: 0,
    radius: 1.1,
    velocityY: 0,
    grounded: true,
  },
  cameraYaw: Math.PI,
  cameraPitch: 0.45,
  input: {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
  },
};

const enemies: Array<{ mesh: BABYLON.Mesh; hp: number; speed: number; }> = [];
const projectiles: Array<{ mesh: BABYLON.Mesh; direction: BABYLON.Vector3; life: number; speed: number; }> = [];
const particles: Array<{ mesh: BABYLON.Mesh; velocity: BABYLON.Vector3; life: number; }> = [];

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
  hit() { this.tone(180, 0.18, 'square', 0.08); },
  shoot() { this.tone(620, 0.08, 'triangle', 0.05); },
  pickup() { this.tone(820, 0.12, 'sine', 0.06); },
  start() { this.tone(440, 0.1, 'sine', 0.05); this.tone(660, 0.13, 'triangle', 0.04); },
  win() { this.tone(530, 0.1, 'triangle', 0.06); this.tone(780, 0.18, 'triangle', 0.06); },
};

const updateHud = () => {
  scoreEl.textContent = Math.floor(state.score).toString();
  bestEl.textContent = Math.floor(state.best).toString();
  healthEl.textContent = Math.max(0, state.health).toString();
  levelEl.textContent = state.level.toString();
};

const showMessage = (title: string, text: string) => {
  messageTitle.textContent = title;
  messageText.textContent = text;
  messageBox.classList.remove('hidden');
};

const hideMessage = () => {
  messageBox.classList.add('hidden');
};

const clearArrays = () => {
  for (const enemy of enemies) enemy.mesh.dispose();
  for (const projectile of projectiles) projectile.mesh.dispose();
  for (const particle of particles) particle.mesh.dispose();
  enemies.length = 0;
  projectiles.length = 0;
  particles.length = 0;
};

const spawnEnemy = () => {
  const angle = Math.random() * Math.PI * 2;
  const distance = 12 + Math.random() * 12;
  const enemyMesh = BABYLON.MeshBuilder.CreateCapsule('enemy', { radius: 0.7, height: 1.8 }, scene);
  enemyMesh.position = new BABYLON.Vector3(
    Math.cos(angle) * distance,
    1.2,
    Math.sin(angle) * distance,
  );

  const material = new BABYLON.StandardMaterial('enemyMat', scene);
  material.diffuseColor = new BABYLON.Color3(1, 0.29, 0.38);
  material.emissiveColor = new BABYLON.Color3(0.25, 0.05, 0.08);
  enemyMesh.material = material;

  enemies.push({
    mesh: enemyMesh,
    hp: 1 + Math.floor(state.level / 2),
    speed: 1.1 + state.level * 0.25,
  });
};

const createBurst = (x: number, y: number, z: number, color: BABYLON.Color3) => {
  for (let i = 0; i < 12; i++) {
    const mesh = BABYLON.MeshBuilder.CreateSphere(`particle-${Math.random()}`, { diameter: 0.2 }, scene);
    mesh.position = new BABYLON.Vector3(x, y, z);
    const mat = new BABYLON.StandardMaterial(`particleMat-${Math.random()}`, scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color;
    mesh.material = mat;
    particles.push({
      mesh,
      velocity: new BABYLON.Vector3((Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 2.5),
      life: 0.7,
    });
  }
};

const resetPlayer = () => {
  state.player.x = 0;
  state.player.y = 1.2;
  state.player.z = 0;
  state.player.velocityY = 0;
  state.player.grounded = true;
  state.level = 1;
  state.shootCooldown = 0;
  state.lastDamageAt = 0;
};

const beginGame = () => {
  audio.start();
  state.running = true;
  state.score = 0;
  state.health = 5;
  state.level = 1;
  clearArrays();
  resetPlayer();
  updateHud();
  hideMessage();
};

const finishGame = (won = false) => {
  state.running = false;
  const finalScore = Math.floor(state.score);
  const best = Math.max(state.best, finalScore);
  state.best = best;
  const unlocked = Math.max(save.unlocked ?? 1, Math.min(5, Math.floor(finalScore / 120) + 1));
  saveGame({ best, unlocked, sound: audio.enabled });
  updateHud();
  if (won) {
    audio.win();
    showMessage('Mission Clear', `You scored ${finalScore} and unlocked level ${unlocked}.`);
  } else {
    audio.hit();
    showMessage('Defeat', `You scored ${finalScore}. Press Start to retry.`);
  }
};

const fireWeapon = () => {
  if (!state.running) return;
  if (state.shootCooldown > 0) return;
  state.shootCooldown = 0.18;

  const playerPos = new BABYLON.Vector3(state.player.x, state.player.y + 0.6, state.player.z);
  const direction = camera.getForwardRay(1).direction.normalize();
  const projectile = BABYLON.MeshBuilder.CreateSphere('projectile', { diameter: 0.28 }, scene);
  projectile.position = playerPos.add(direction.scale(1.2));

  const mat = new BABYLON.StandardMaterial('projectileMat', scene);
  mat.emissiveColor = new BABYLON.Color3(0.7, 0.95, 1);
  mat.diffuseColor = new BABYLON.Color3(0.4, 0.6, 1);
  projectile.material = mat;

  projectiles.push({
    mesh: projectile,
    direction: direction.clone(),
    life: 1.2,
    speed: 26,
  });

  audio.shoot();
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

  const desiredMove = forward.scale(moveZ).add(right.scale(moveX));
  if (desiredMove.lengthSquared() > 0) {
    desiredMove.normalize();
    const speed = 7.5;
    state.player.x += desiredMove.x * speed * delta;
    state.player.z += desiredMove.z * speed * delta;
  }

  state.player.x = clampValue(state.player.x, -18, 18);
  state.player.z = clampValue(state.player.z, -18, 18);

  if (!state.player.grounded) {
    state.player.velocityY -= 18 * delta;
    state.player.y += state.player.velocityY * delta;
    if (state.player.y <= 1.2) {
      state.player.y = 1.2;
      state.player.velocityY = 0;
      state.player.grounded = true;
    }
  }

  if (state.input.jump && state.player.grounded) {
    state.player.velocityY = 6.5;
    state.player.grounded = false;
    state.input.jump = false;
    audio.tone(360, 0.12, 'triangle', 0.04);
  }
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
});

window.addEventListener('keyup', (event) => {
  const key = event.key.toLowerCase();
  if (key === 'w' || key === 'arrowup') state.input.forward = false;
  if (key === 's' || key === 'arrowdown') state.input.backward = false;
  if (key === 'a' || key === 'arrowleft') state.input.left = false;
  if (key === 'd' || key === 'arrowright') state.input.right = false;
  if (key === ' ') state.input.jump = false;
});

leftBtn.addEventListener('pointerdown', () => { state.input.left = true; });
leftBtn.addEventListener('pointerup', () => { state.input.left = false; });
leftBtn.addEventListener('pointerleave', () => { state.input.left = false; });
rightBtn.addEventListener('pointerdown', () => { state.input.right = true; });
rightBtn.addEventListener('pointerup', () => { state.input.right = false; });
rightBtn.addEventListener('pointerleave', () => { state.input.right = false; });
jumpBtn.addEventListener('pointerdown', () => { state.input.jump = true; });
jumpBtn.addEventListener('pointerup', () => { state.input.jump = false; });

canvas.addEventListener('pointermove', (event) => {
  if (!state.running) return;
  const rect = canvas.getBoundingClientRect();
  const xRatio = (event.clientX - rect.left) / rect.width;
  const yRatio = (event.clientY - rect.top) / rect.height;
  state.cameraYaw = (xRatio - 0.5) * 2.3 + Math.PI;
  state.cameraPitch = clampValue((0.5 - yRatio) * 1.6, -0.8, 0.8);
});

canvas.addEventListener('pointerdown', () => {
  if (state.running) fireWeapon();
});
window.addEventListener('contextmenu', (event) => event.preventDefault());

startBtn.addEventListener('click', beginGame);
resetBtn.addEventListener('click', () => {
  clearArrays();
  resetPlayer();
  state.score = 0;
  state.health = 5;
  state.best = loadSave().best;
  updateHud();
  showMessage('3rd Person Shooter', 'Desktop: WASD move • Mouse aim • Left click shoot • Space jump');
  state.running = false;
});

const updateCamera = () => {
  const lookTarget = new BABYLON.Vector3(state.player.x, state.player.y + 1.4, state.player.z);
  const camDistance = 7.5;
  const camOffset = new BABYLON.Vector3(
    Math.sin(state.cameraYaw) * -camDistance,
    3.5 + state.cameraPitch * 2.4,
    Math.cos(state.cameraYaw) * -camDistance,
  );
  camera.position = lookTarget.add(camOffset);
  camera.setTarget(lookTarget);
};

const tick = () => {
  const delta = engine.getDeltaTime() / 1000;
  state.shootCooldown = Math.max(0, state.shootCooldown - delta);

  if (state.running) {
    updatePlayer(delta);
    updateCamera();

    state.level = Math.min(5, 1 + Math.floor(state.score / 100));
    if (performance.now() - state.lastSpawn > Math.max(0.85, 1.5 - state.level * 0.12) * 1000) {
      spawnEnemy();
      state.lastSpawn = performance.now();
    }

    for (const enemy of enemies) {
      const dir = new BABYLON.Vector3(state.player.x - enemy.mesh.position.x, 0, state.player.z - enemy.mesh.position.z);
      const length = dir.length();
      if (length > 0.001) {
        dir.normalize();
        enemy.mesh.position.x += dir.x * enemy.speed * delta;
        enemy.mesh.position.z += dir.z * enemy.speed * delta;
      }

      const now = performance.now();
      if (length < 1.6 && now - state.lastDamageAt > 500) {
        state.health -= 1;
        state.lastDamageAt = now;
        audio.hit();
        createBurst(enemy.mesh.position.x, enemy.mesh.position.y, enemy.mesh.position.z, new BABYLON.Color3(1, 0.3, 0.3));
        updateHud();
        if (state.health <= 0) {
          finishGame(false);
          break;
        }
      }
    }

    for (const projectile of projectiles) {
      projectile.mesh.position.addInPlace(projectile.direction.scale(projectile.speed * delta));
      projectile.life -= delta;
      if (projectile.life <= 0) {
        projectile.mesh.dispose();
        continue;
      }

      for (const enemy of enemies) {
        const dist = BABYLON.Vector3.Distance(enemy.mesh.position, projectile.mesh.position);
        if (dist < 1.2) {
          enemy.hp -= 1;
          projectile.life = 0;
          projectile.mesh.dispose();
          createBurst(projectile.mesh.position.x, projectile.mesh.position.y, projectile.mesh.position.z, new BABYLON.Color3(0.5, 0.8, 1));
          if (enemy.hp <= 0) {
            enemy.mesh.dispose();
            const idx = enemies.indexOf(enemy);
            if (idx >= 0) enemies.splice(idx, 1);
            state.score += 25;
            audio.pickup();
          }
          break;
        }
      }
    }

    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      if (p.life <= 0) {
        p.mesh.dispose();
        projectiles.splice(i, 1);
      }
    }

    for (const p of particles) {
      p.mesh.position.addInPlace(p.velocity.scale(delta));
      p.life -= delta;
      if (p.life <= 0) {
        p.mesh.dispose();
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life <= 0) particles.splice(i, 1);
    }

    if (state.score > state.best) {
      state.best = state.score;
      saveGame({ best: Math.floor(state.best), unlocked: Math.max(save.unlocked ?? 1, state.level), sound: audio.enabled });
    }

    if (state.level >= 5 && state.score > 450) {
      finishGame(true);
    }

    updateHud();
  } else {
    updateCamera();
  }

  scene.render();
  requestAnimationFrame(tick);
};

async function start() {
  updateHud();
  updateCamera();
  showMessage('3rd Person Shooter', 'Desktop: WASD move • Mouse aim • Left click shoot • Space jump');
  requestAnimationFrame(tick);
}

window.addEventListener('resize', () => engine.resize());
start();
