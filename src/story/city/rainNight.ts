/**
 * Rain-slick night dress for Going Home (and the station's open stair end):
 * GPU/CPU rain with ground splashes, steam from vents, planar puddle mirrors
 * (reflection probe on Low/Medium; SSR only on High), headlight flares, and
 * eight lit neon signs along Pierce's sidewalk with stand-in emissives until
 * Gen textures land under assets/textures/city/neon/.
 *
 * Public Hawkes signage never names B3, the vat or the creature.
 */

import * as BABYLON from '@babylonjs/core';

import { createUnlockedAudio, releaseUnlockedAudio } from '../../game/audioUnlock';
import type { GraphicsTier } from '../../render/pipeline';

export type RainNightOptions = {
  tier: () => GraphicsTier;
  /** Follow Pierce so rain and steam stay near the camera. */
  playerAt: () => { x: number; z: number } | null;
  /** Parent under the city root when present so chunks dispose cleanly. */
  parent?: BABYLON.Nullable<BABYLON.TransformNode>;
  /** Cap rain particles (Low = ~1/3 of High). */
  mobile?: boolean;
};

/** Canon neon stops along the Going Home sidewalk (z ~22, west → east). */
export const NEON_SIGNS: {
  id: string;
  label: string;
  sub: string;
  x: number;
  z: number;
  yaw: number;
  w: number;
  h: number;
  color: [number, number, number];
  file: string;
}[] = [
  { id: 'hawkes-billboard', label: 'HAWKES', sub: 'BIOMEDICAL', x: 14, z: 27.4, yaw: Math.PI, w: 6.4, h: 3.2, color: [0.35, 0.85, 1.0], file: 'hawkes-billboard.webp' },
  { id: 'pharmacy-cross', label: '+', sub: 'PHARMACY', x: 34, z: 27.2, yaw: Math.PI, w: 2.4, h: 2.4, color: [0.25, 1.0, 0.45], file: 'pharmacy-cross.webp' },
  { id: 'noodle-bar', label: 'NOODLE', sub: 'BAR · OPEN', x: 52, z: 18.6, yaw: 0, w: 4.2, h: 1.6, color: [1.0, 0.35, 0.55], file: 'noodle-bar.webp' },
  { id: 'pawn-shop', label: 'PAWN', sub: 'GOLD · GUNS', x: 70, z: 27.3, yaw: Math.PI, w: 3.6, h: 1.8, color: [1.0, 0.72, 0.2], file: 'pawn-shop.webp' },
  { id: 'midnight-diner', label: 'MIDNIGHT', sub: 'DINER', x: 102, z: 18.55, yaw: 0, w: 5.0, h: 1.9, color: [1.0, 0.28, 0.42], file: 'midnight-diner.webp' },
  { id: 'voss-capital', label: 'VOSS', sub: 'CAPITAL', x: 118, z: 27.35, yaw: Math.PI, w: 4.4, h: 2.0, color: [1.0, 0.55, 0.22], file: 'voss-capital.webp' },
  { id: 'liberty-square', label: 'LIBERTY', sub: 'SQUARE', x: 136, z: 18.6, yaw: 0, w: 4.0, h: 1.7, color: [0.4, 1.0, 0.55], file: 'liberty-square.webp' },
  { id: 'hotel-neon', label: 'HOTEL', sub: 'VACANCY', x: 152, z: 27.25, yaw: Math.PI, w: 3.2, h: 2.6, color: [0.55, 0.75, 1.0], file: 'hotel-neon.webp' },
];

/**
 * Big puddles on the asphalt of the main avenue (z≈32). Sidewalk is CURB 0.14 m;
 * asphalt sits at y 0 — plates are +2 cm so they never z-fight or sink.
 */
const PUDDLES: { x: number; z: number; w: number; d: number }[] = [
  { x: 22, z: 29.2, w: 4.2, d: 2.6 },
  { x: 48, z: 30.0, w: 5.0, d: 3.0 },
  { x: 84, z: 28.8, w: 4.6, d: 2.8 },
  { x: 120, z: 30.2, w: 5.4, d: 3.2 },
  { x: 148, z: 29.4, w: 4.0, d: 2.4 },
];

/** Steam vents / manholes on the south curb of the main avenue (asphalt edge). */
const VENTS: { x: number; z: number }[] = [
  { x: 18, z: 27.6 },
  { x: 46, z: 27.5 },
  { x: 74, z: 27.55 },
  { x: 108, z: 27.5 },
  { x: 142, z: 27.6 },
];

const rainCap = (tier: GraphicsTier, mobile?: boolean) => {
  if (tier === 'low' || mobile) return 800;
  if (tier === 'medium') return 1600;
  return 2400;
};

const paintNeon = (tex: BABYLON.DynamicTexture, sign: (typeof NEON_SIGNS)[number]) => {
  const size = tex.getSize();
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const [r, g, b] = sign.color;
  const rgb = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, size.width, size.height);
  // Soft glow plate.
  const glow = ctx.createRadialGradient(size.width / 2, size.height / 2, 4, size.width / 2, size.height / 2, size.width * 0.55);
  glow.addColorStop(0, `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},0.55)`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.strokeStyle = rgb;
  ctx.lineWidth = 10;
  ctx.shadowColor = rgb;
  ctx.shadowBlur = 28;
  ctx.strokeRect(18, 18, size.width - 36, size.height - 36);
  ctx.fillStyle = rgb;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.floor(size.height * 0.28)}px "Arial Black", Arial, sans-serif`;
  ctx.fillText(sign.label, size.width / 2, size.height * 0.42);
  ctx.font = `bold ${Math.floor(size.height * 0.14)}px Arial, sans-serif`;
  ctx.fillText(sign.sub, size.width / 2, size.height * 0.68);
  ctx.shadowBlur = 0;
  tex.update(false);
};

const tryLoadNeon = (mat: BABYLON.StandardMaterial, path: string, fallback: BABYLON.DynamicTexture) => {
  const url = `/assets/textures/city/neon/${path}`;
  const tex = new BABYLON.Texture(
    url,
    mat.getScene(),
    true,
    false,
    BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
    () => {
      mat.emissiveTexture = tex;
      mat.opacityTexture = tex;
      fallback.dispose();
    },
    () => {
      // Stand-in canvas stays until Gen imports the WebP.
      tex.dispose();
    },
  );
};

export const createRainNight = (scene: BABYLON.Scene, opts: RainNightOptions) => {
  const owned: { dispose: () => void }[] = [];
  const root = new BABYLON.TransformNode('city-rain-night', scene);
  if (opts.parent) root.parent = opts.parent;
  owned.push(root);

  let clock = 0;
  let rainCount = 0;
  let splashCount = 0;
  let steamCount = 0;
  let neonLit = 0;
  let puddleCount = 0;
  let reflectionMode: 'ssr' | 'probe' | 'planar' | 'sheen' = 'sheen';
  let probe: BABYLON.ReflectionProbe | null = null;

  // ---------- Neon signs (stand-in canvas; Gen WebP swaps in when present) ----------
  const neonMeshes: BABYLON.Mesh[] = [];
  for (const sign of NEON_SIGNS) {
    const plane = BABYLON.MeshBuilder.CreatePlane(`city-neon-${sign.id}`, { width: sign.w, height: sign.h }, scene);
    plane.parent = root;
    plane.position.set(sign.x, 3.2 + sign.h * 0.15, sign.z);
    plane.rotation.y = sign.yaw;
    plane.isPickable = false;
    plane.checkCollisions = false;
    // Never negative scale (quality rule 1). Double-sided so the sidewalk always reads the copy
    // (CreatePlane faces +Z; yaw aims the "front" at Pierce, but culling off is the safe bar).
    plane.scaling.set(1, 1, 1);
    const tex = new BABYLON.DynamicTexture(`city-neon-tex-${sign.id}`, { width: 512, height: 256 }, scene, true);
    paintNeon(tex, sign);
    owned.push(tex);
    const mat = new BABYLON.StandardMaterial(`city-neon-mat-${sign.id}`, scene);
    mat.disableLighting = true;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.emissiveColor = new BABYLON.Color3(sign.color[0], sign.color[1], sign.color[2]);
    mat.diffuseColor = BABYLON.Color3.Black();
    mat.specularColor = BABYLON.Color3.Black();
    mat.backFaceCulling = false;
    mat.alphaMode = BABYLON.Engine.ALPHA_ADD;
    plane.material = mat;
    tryLoadNeon(mat, sign.file, tex);
    neonMeshes.push(plane);
    owned.push(plane, mat);
  }
  neonLit = neonMeshes.filter((m) => m.isEnabled() && !m.isDisposed()).length;

  // ---------- Puddle plates (+2 cm over asphalt — no z-fight) + shared reflection probe ----------
  const puddleMats: BABYLON.StandardMaterial[] = [];
  const puddleMeshes: BABYLON.Mesh[] = [];
  const tier0 = opts.tier();
  // Phone / Low: small probe. High: larger cube (SSR stays out of this pass — keep one pipeline).
  const probeSize = tier0 === 'high' ? 256 : tier0 === 'medium' ? 128 : 64;
  try {
    probe = new BABYLON.ReflectionProbe('city-rain-probe', probeSize, scene, true);
    probe.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    // Neon + flares + city props; refreshed when Pierce walks.
    probe.renderList = [];
    reflectionMode = 'probe';
    owned.push({
      dispose: () => {
        probe?.dispose();
        probe = null;
      },
    });
  } catch {
    reflectionMode = 'sheen';
  }
  for (const p of PUDDLES) {
    const mesh = BABYLON.MeshBuilder.CreateGround(`city-puddle-${puddleCount}`, { width: p.w, height: p.d, subdivisions: 1 }, scene);
    mesh.parent = root;
    mesh.position.set(p.x, 0.02, p.z);
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = false;
    const mat = new BABYLON.StandardMaterial(`city-puddle-mat-${puddleCount}`, scene);
    mat.diffuseColor = new BABYLON.Color3(0.015, 0.02, 0.028);
    mat.specularColor = new BABYLON.Color3(0.7, 0.78, 0.85);
    mat.emissiveColor = new BABYLON.Color3(0.03, 0.04, 0.055);
    mat.alpha = 0.68;
    mat.roughness = 0.05;
    if (probe?.cubeTexture) {
      mat.reflectionTexture = probe.cubeTexture;
      mat.reflectionTexture.level = 0.95;
    }
    mesh.material = mat;
    puddleMats.push(mat);
    puddleMeshes.push(mesh);
    owned.push(mesh, mat);
    puddleCount += 1;
  }
  // Probe samples neon (and later city chunks) so puddles catch the signs and headlights.
  if (probe?.renderList) {
    for (const m of neonMeshes) probe.renderList.push(m);
  }

  // ---------- Rain texture (soft streak) ----------
  const rainTex = new BABYLON.DynamicTexture('city-rain-tex', { width: 32, height: 64 }, scene, false);
  {
    const ctx = rainTex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 32, 64);
    const g = ctx.createLinearGradient(16, 0, 16, 64);
    g.addColorStop(0, 'rgba(200,220,255,0)');
    g.addColorStop(0.35, 'rgba(210,230,255,0.85)');
    g.addColorStop(1, 'rgba(180,200,230,0)');
    ctx.fillStyle = g;
    ctx.fillRect(14, 0, 4, 64);
    rainTex.hasAlpha = true;
    rainTex.update(false);
  }
  owned.push(rainTex);

  const splashTex = new BABYLON.DynamicTexture('city-splash-tex', { width: 64, height: 64 }, scene, false);
  {
    const ctx = splashTex.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(220,235,255,0.9)');
    g.addColorStop(0.45, 'rgba(180,200,230,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    splashTex.hasAlpha = true;
    splashTex.update(false);
  }
  owned.push(splashTex);

  const mkRain = (capacity: number) => {
    const ps = new BABYLON.ParticleSystem('city-rain', capacity, scene);
    ps.particleTexture = rainTex;
    ps.emitter = new BABYLON.Vector3(0, 14, 0);
    ps.minEmitBox = new BABYLON.Vector3(-18, 0, -14);
    ps.maxEmitBox = new BABYLON.Vector3(18, 2, 14);
    ps.color1 = new BABYLON.Color4(0.75, 0.82, 0.95, 0.55);
    ps.color2 = new BABYLON.Color4(0.55, 0.65, 0.85, 0.25);
    ps.colorDead = new BABYLON.Color4(0.4, 0.5, 0.7, 0);
    ps.minSize = 0.04;
    ps.maxSize = 0.12;
    ps.minLifeTime = 0.35;
    ps.maxLifeTime = 0.7;
    ps.emitRate = capacity * 1.6;
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    ps.gravity = new BABYLON.Vector3(0, -38, 0);
    ps.direction1 = new BABYLON.Vector3(-0.4, -1, 0.1);
    ps.direction2 = new BABYLON.Vector3(0.35, -1, -0.15);
    ps.minEmitPower = 10;
    ps.maxEmitPower = 16;
    ps.updateSpeed = 0.016;
    ps.isBillboardBased = true;
    ps.renderingGroupId = 1;
    ps.start();
    owned.push(ps);
    rainCount = capacity;
    return ps;
  };

  const mkSplash = (capacity: number) => {
    const ps = new BABYLON.ParticleSystem('city-rain-splash', capacity, scene);
    ps.particleTexture = splashTex;
    ps.emitter = new BABYLON.Vector3(0, 0.04, 0);
    ps.minEmitBox = new BABYLON.Vector3(-10, 0, -6);
    ps.maxEmitBox = new BABYLON.Vector3(10, 0, 6);
    ps.color1 = new BABYLON.Color4(0.7, 0.8, 0.95, 0.45);
    ps.color2 = new BABYLON.Color4(0.5, 0.6, 0.8, 0.2);
    ps.colorDead = new BABYLON.Color4(0.3, 0.4, 0.55, 0);
    ps.minSize = 0.08;
    ps.maxSize = 0.28;
    ps.minLifeTime = 0.12;
    ps.maxLifeTime = 0.28;
    ps.emitRate = capacity * 2.2;
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
    ps.gravity = new BABYLON.Vector3(0, -2, 0);
    ps.direction1 = new BABYLON.Vector3(-0.2, 0.6, -0.2);
    ps.direction2 = new BABYLON.Vector3(0.2, 1.2, 0.2);
    ps.minEmitPower = 0.4;
    ps.maxEmitPower = 1.4;
    ps.updateSpeed = 0.016;
    ps.start();
    owned.push(ps);
    splashCount = capacity;
    return ps;
  };

  const rain = mkRain(rainCap(tier0, opts.mobile));
  const splash = mkSplash(Math.max(80, Math.floor(rainCap(tier0, opts.mobile) / 6)));

  // Rain bed: HEAD for Gen rain-hiss, else room-tone (never mutate a pooled element's .src).
  const RAIN_HISS = '/assets/audio/sfx/street/rain-hiss.ogg';
  const RAIN_FALLBACK = '/assets/audio/room-tone.mp3';
  let rainBed: HTMLAudioElement | null = null;
  void (async () => {
    let exists = false;
    try {
      exists = (await fetch(RAIN_HISS, { method: 'HEAD', cache: 'no-store' })).ok;
    } catch {
      /* offline / missing */
    }
    rainBed = createUnlockedAudio(exists ? RAIN_HISS : RAIN_FALLBACK, 'music');
    rainBed.loop = true;
    rainBed.volume = exists ? 0.14 : 0.1;
    void rainBed.play().catch(() => { /* gesture may not be ready yet */ });
  })();
  owned.push({
    dispose: () => {
      if (!rainBed) return;
      rainBed.pause();
      releaseUnlockedAudio(rainBed);
      rainBed = null;
    },
  });

  // ---------- Steam from vents ----------
  const steamSystems: BABYLON.ParticleSystem[] = [];
  const steamTex = new BABYLON.DynamicTexture('city-steam-tex', { width: 64, height: 64 }, scene, false);
  {
    const ctx = steamTex.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(32, 40, 2, 32, 28, 28);
    g.addColorStop(0, 'rgba(210,220,230,0.7)');
    g.addColorStop(0.45, 'rgba(170,180,190,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    steamTex.hasAlpha = true;
    steamTex.update(false);
  }
  owned.push(steamTex);
  for (const v of VENTS) {
    const ps = new BABYLON.ParticleSystem(`city-steam-${steamCount}`, 48, scene);
    ps.particleTexture = steamTex;
    ps.emitter = new BABYLON.Vector3(v.x, 0.05, v.z);
    ps.minEmitBox = new BABYLON.Vector3(-0.15, 0, -0.15);
    ps.maxEmitBox = new BABYLON.Vector3(0.15, 0.05, 0.15);
    ps.color1 = new BABYLON.Color4(0.55, 0.6, 0.65, 0.22);
    ps.color2 = new BABYLON.Color4(0.4, 0.45, 0.5, 0.08);
    ps.colorDead = new BABYLON.Color4(0.3, 0.35, 0.4, 0);
    ps.minSize = 0.25;
    ps.maxSize = 0.7;
    ps.minLifeTime = 1.2;
    ps.maxLifeTime = 2.4;
    ps.emitRate = 14;
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
    ps.gravity = new BABYLON.Vector3(0, 0.15, 0);
    ps.direction1 = new BABYLON.Vector3(-0.05, 0.8, -0.05);
    ps.direction2 = new BABYLON.Vector3(0.05, 1.4, 0.05);
    ps.minEmitPower = 0.3;
    ps.maxEmitPower = 0.7;
    ps.updateSpeed = 0.02;
    ps.start();
    steamSystems.push(ps);
    owned.push(ps);
    steamCount += 1;
  }

  // ---------- Headlight / taillight flare sprites (follow live traffic roots) ----------
  const flareMat = new BABYLON.StandardMaterial('city-car-flare-mat', scene);
  flareMat.disableLighting = true;
  flareMat.emissiveColor = BABYLON.Color3.White();
  flareMat.diffuseColor = BABYLON.Color3.Black();
  flareMat.specularColor = BABYLON.Color3.Black();
  flareMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
  flareMat.disableDepthWrite = true;
  owned.push(flareMat);
  const flareTex = new BABYLON.DynamicTexture('city-car-flare-tex', { width: 64, height: 64 }, scene, false);
  {
    const ctx = flareTex.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,230,180,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    flareTex.hasAlpha = true;
    flareTex.update(false);
  }
  owned.push(flareTex);
  flareMat.emissiveTexture = flareTex;
  flareMat.opacityTexture = flareTex;

  type FlarePair = { head: BABYLON.Mesh; tail: BABYLON.Mesh; tailMat: BABYLON.StandardMaterial; root: BABYLON.TransformNode };
  const flares: FlarePair[] = [];
  const ensureFlares = () => {
    // Drop flares whose car was recycled / disposed.
    for (let i = flares.length - 1; i >= 0; i -= 1) {
      const f = flares[i];
      if (f.root.isDisposed() || !f.root.isEnabled()) {
        f.head.dispose(false, false);
        f.tail.dispose(false, false);
        f.tailMat.dispose();
        flares.splice(i, 1);
      }
    }
    for (const node of scene.transformNodes) {
      if (!node.name.startsWith('street-car-') || node.name.includes('-body') || node.name.includes('-source')) continue;
      if (flares.some((f) => f.root === node)) continue;
      if (!node.isEnabled() || node.isDisposed()) continue;
      const head = BABYLON.MeshBuilder.CreatePlane(`city-flare-h-${node.name}`, { size: 1.4 }, scene);
      head.parent = node;
      head.position.set(2.6, 0.7, 0);
      head.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      head.material = flareMat;
      head.isPickable = false;
      head.renderingGroupId = 1;
      const tail = BABYLON.MeshBuilder.CreatePlane(`city-flare-t-${node.name}`, { size: 1.0 }, scene);
      tail.parent = node;
      tail.position.set(-2.6, 0.72, 0);
      tail.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      const tMat = flareMat.clone(`city-car-flare-tail-${node.name}`);
      tMat.emissiveColor = new BABYLON.Color3(1.0, 0.12, 0.06);
      tail.material = tMat;
      tail.isPickable = false;
      tail.renderingGroupId = 1;
      flares.push({ head, tail, tailMat: tMat, root: node });
      if (probe?.renderList) {
        probe.renderList.push(head);
        probe.renderList.push(tail);
      }
    }
  };

  let flareWait = 0;
  let probeWait = 0;
  let probeLive = 0;
  const rainEmit = new BABYLON.Vector3(0, 14, 0);
  const splashEmit = new BABYLON.Vector3(0, 0.04, 0);

  const retier = () => {
    const t = opts.tier();
    const cap = rainCap(t, opts.mobile);
    if (cap !== rainCount) {
      rain.stop();
      rain.emitRate = cap * 1.6;
      rainCount = cap;
      rain.start();
      const sc = Math.max(80, Math.floor(cap / 6));
      splash.stop();
      splash.emitRate = sc * 2.2;
      splashCount = sc;
      splash.start();
    }
  };

  return {
    step: (dt: number) => {
      clock += dt;
      retier();
      const at = opts.playerAt();
      if (at) {
        rainEmit.set(at.x, 14, at.z);
        splashEmit.set(at.x, 0.04, at.z);
        rain.emitter = rainEmit;
        splash.emitter = splashEmit;
        if (probe) {
          probeWait -= dt;
          if (probeLive > 0) {
            probeLive -= dt;
            if (probeLive <= 0) probe.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
          } else if (probeWait <= 0) {
            probeWait = 1.2;
            probe.position.set(at.x, 2.4, at.z);
            // Refresh the list with nearby city meshes so neon and headlights land in the puddle.
            if (probe.renderList) {
              probe.renderList.length = 0;
              for (const m of neonMeshes) if (!m.isDisposed()) probe.renderList.push(m);
              for (const f of flares) {
                if (!f.head.isDisposed()) probe.renderList.push(f.head);
                if (!f.tail.isDisposed()) probe.renderList.push(f.tail);
              }
              for (const m of scene.meshes) {
                if (probe.renderList.length > 48) break;
                const n = m.name;
                if (!n.startsWith('city-') || n.startsWith('city-puddle') || n.startsWith('city-neon') || n.startsWith('city-flare')) continue;
                if (m.isDisposed() || !m.isEnabled()) continue;
                const dx = m.getAbsolutePosition().x - at.x;
                const dz = m.getAbsolutePosition().z - at.z;
                if (dx * dx + dz * dz > 80 * 80) continue;
                probe.renderList.push(m);
              }
            }
            probe.refreshRate = 1;
            probeLive = 0.08;
          }
        }
      }
      flareWait -= dt;
      if (flareWait <= 0) {
        flareWait = 0.8;
        ensureFlares();
      }
    },
    stats: () => {
      neonLit = neonMeshes.filter((m) => !m.isDisposed() && m.isEnabled()).length;
      return {
        rain: rainCount,
        splashes: splashCount,
        steam: steamCount,
        neon: neonLit,
        neonIds: NEON_SIGNS.map((s) => s.id),
        puddles: puddleMeshes.filter((m) => !m.isDisposed()).length,
        reflection: reflectionMode,
        flares: flares.length,
        fpsHint: scene.getEngine().getFps(),
        tier: opts.tier(),
      };
    },
    dispose: () => {
      for (const f of flares) {
        try {
          f.head.dispose(false, false);
          f.tail.dispose(false, false);
          f.tailMat.dispose();
        } catch {
          /* gone */
        }
      }
      flares.length = 0;
      for (const o of owned) {
        try {
          o.dispose();
        } catch {
          /* already gone */
        }
      }
      owned.length = 0;
      probe = null;
    },
  };
};

export type RainNight = ReturnType<typeof createRainNight>;
