import * as BABYLON from '@babylonjs/core';

let live: BABYLON.ParticleSystem[] = [];
let dropTexture: BABYLON.DynamicTexture | null = null;

const dropTex = (scene: BABYLON.Scene) => {
  if (dropTexture && !dropTexture.getScene()?.isDisposed) return dropTexture;
  const texture = new BABYLON.DynamicTexture('pipe-drip', { width: 32, height: 32 }, scene, false);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const gradient = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  gradient.addColorStop(0, 'rgba(210, 230, 220, 0.95)');
  gradient.addColorStop(0.45, 'rgba(140, 175, 160, 0.55)');
  gradient.addColorStop(1, 'rgba(80, 110, 100, 0)');
  ctx.clearRect(0, 0, 32, 32);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(16, 16, 15, 0, Math.PI * 2);
  ctx.fill();
  texture.update();
  texture.hasAlpha = true;
  dropTexture = texture;
  return texture;
};

const isPipe = (mesh: BABYLON.AbstractMesh) => {
  const name = mesh.name;
  if (!/pipe/i.test(name)) return false;
  if (/floor|ceil|wall|light|fixture|sign|decal|header|door|puddle|housing/i.test(name)) return false;
  return mesh.getTotalVertices() > 8;
};

/** Falling drops under basement pipes. Pass enabled false to clear them on the next level. */
export const mountPipeDrips = (scene: BABYLON.Scene, enabled: boolean) => {
  for (const system of live) system.dispose();
  live = [];
  if (!enabled) return;

  const texture = dropTex(scene);
  let count = 0;
  for (const mesh of scene.meshes) {
    if (count >= 8 || !isPipe(mesh)) continue;
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    const origin = box.centerWorld.clone();
    origin.y = box.minimumWorld.y + 0.02;
    const drops = new BABYLON.ParticleSystem(`drip-${mesh.name}`, 24, scene);
    drops.particleTexture = texture;
    drops.emitter = origin;
    drops.minEmitBox = new BABYLON.Vector3(-0.05, 0, -0.05);
    drops.maxEmitBox = new BABYLON.Vector3(0.05, 0, 0.05);
    drops.direction1 = new BABYLON.Vector3(-0.04, -1, -0.04);
    drops.direction2 = new BABYLON.Vector3(0.04, -1, 0.04);
    drops.minLifeTime = 0.55;
    drops.maxLifeTime = 1.05;
    drops.minSize = 0.012;
    drops.maxSize = 0.03;
    drops.emitRate = 3.5;
    drops.gravity = new BABYLON.Vector3(0, -7.5, 0);
    drops.minEmitPower = 0.15;
    drops.maxEmitPower = 0.55;
    drops.color1 = new BABYLON.Color4(0.62, 0.78, 0.7, 0.55);
    drops.color2 = new BABYLON.Color4(0.35, 0.5, 0.44, 0.28);
    drops.colorDead = new BABYLON.Color4(0.2, 0.28, 0.24, 0);
    drops.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    drops.start();
    live.push(drops);
    count += 1;
  }
};
