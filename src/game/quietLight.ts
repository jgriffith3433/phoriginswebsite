import * as BABYLON from '@babylonjs/core';

import type { GraphicsTier } from '../render/pipeline';
import { playClip, type ClipHandle } from './sfxMix';

/**
 * Quiet-chapter light on the shared render pipeline: The Return (clinical over-bright),
 * The Desk (one desk lamp, long shadows, city rim), The Morning (dawn shafts through blinds,
 * dust in the beams, TV spill). Mounted from levelDressing by library id.
 */

const BUZZ = '/assets/audio/sfx/b3/fluorescent-buzz.ogg';
const DESK = { x: 48, y: 0.92, z: 42.55 };
const WINDOW_CITY = { x: 47.2, y: 1.6, z: 46.4 };
const MORNING_WINDOW = { x: 0.15, y: 1.55, z: -0.4 };
const TV = { x: 3.2, y: 1.3, z: -2.85 };
/** Level length used to slide the dawn shafts across the room (seconds of play). */
const DAWN_SLIDE_SECONDS = 480;

export type QuietMode = 'return' | 'desk' | 'morning';

export type QuietLightOptions = {
  mode: QuietMode;
  tier: () => GraphicsTier;
  /** Override the chapter key-shadow direction (desk lamp throw). Null clears. */
  setKeyDir?: (dir: [number, number, number] | null) => void;
  /** Morning: whether the TV is on (spill light). */
  tvOn?: () => boolean;
  /** Morning: 0–1 picture brightness for TV spill (canvas mean). */
  tvBright?: () => number;
  /** Morning: 0 night, 1 day (after Sleep). */
  morningDay?: () => number;
};

export type QuietLightStats = {
  mode: QuietMode;
  deskLamp: boolean;
  deskShadowLong: boolean;
  mirrorTextOk: boolean;
  sunShafts: boolean;
  volumetric: boolean;
  tvSpill: boolean;
  buzzTube: boolean;
  dust: boolean;
  fpsHint: number;
};

type Owned = { dispose: () => void };

const goboBlinds = (scene: BABYLON.Scene, name: string) => {
  const tex = new BABYLON.DynamicTexture(name, { width: 512, height: 512 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#fff';
  // Dense horizontal venetian slats: white light, black bars.
  for (let y = 0; y < 512; y += 18) {
    ctx.fillRect(0, y + 4, 512, 10);
  }
  // Soft edge so the throw does not hard-cut at the cone.
  const g = ctx.createRadialGradient(256, 256, 140, 256, 256, 256);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  tex.update();
  tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  return tex;
};

const goboWindow = (scene: BABYLON.Scene, name: string) => {
  const tex = new BABYLON.DynamicTexture(name, { width: 512, height: 512 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#f4f0e4';
  const inset = 48;
  const gap = 18;
  const cols = 2;
  const rows = 3;
  const cellW = (512 - inset * 2 - gap) / cols;
  const cellH = (512 - inset * 2 - gap * 2) / rows;
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const x = inset + c * (cellW + gap);
      const y = inset + r * (cellH + gap);
      ctx.fillRect(x, y, cellW, cellH);
    }
  }
  tex.update();
  tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  return tex;
};

/**
 * Gobo cookie for the dawn spot. Prefers Gen files at assets/textures/gobo/{blinds,window}.webp
 * when present; otherwise a procedural stand-in (Gen image.generate was out of credits this pass).
 */
const loadGobo = (scene: BABYLON.Scene, path: string, fallback: () => BABYLON.Texture) => {
  const standIn = fallback();
  // Prefer the Gen webp when Studio has imported it; keep the stand-in until then.
  const tex = new BABYLON.Texture(
    path,
    scene,
    true,
    false,
    BABYLON.Texture.BILINEAR_SAMPLINGMODE,
    () => {
      tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
      tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
      standIn.dispose();
      (tex as BABYLON.Texture & { __quietReady?: boolean }).__quietReady = true;
    },
    () => {
      tex.dispose();
    },
  );
  // Callers attach standIn immediately; when the Gen file loads, callers that remount pick it up.
  // SpotLight.projectionTexture is set to standIn; swap on success via a light refresh is handled by remount.
  void tex;
  return standIn;
};

export const createQuietLight = (scene: BABYLON.Scene, camera: BABYLON.Camera, opts: QuietLightOptions) => {
  const owned: Owned[] = [];
  const mode = opts.mode;
  let clock = 0;
  let frames = 0;
  let fpsHint = 60;
  let lastFpsAt = performance.now();
  let buzz: ClipHandle | null = null;
  let buzzLight: BABYLON.PointLight | null = null;
  let deskLamp: BABYLON.SpotLight | null = null;
  let cityRim: BABYLON.PointLight | null = null;
  let tvLight: BABYLON.PointLight | null = null;
  let sunSpot: BABYLON.SpotLight | null = null;
  let vls: BABYLON.VolumetricLightScatteringPostProcess | null = null;
  let vlsMesh: BABYLON.Mesh | null = null;
  let shaftRoot: BABYLON.TransformNode | null = null;
  let blindsGobo: BABYLON.Texture | null = null;
  let windowGobo: BABYLON.Texture | null = null;
  let dustMat: BABYLON.ShaderMaterial | null = null;
  let mirrorSignOk = false;
  let sunShaftsOn = false;
  let dustOn = false;
  const saved: { light: BABYLON.Light; intensity: number }[] = [];

  const saveIntensity = (light: BABYLON.Light) => {
    if (saved.some((s) => s.light === light)) return;
    saved.push({ light, intensity: light.intensity });
  };

  const restore = () => {
    for (const s of saved) {
      if (!s.light.isDisposed()) s.light.intensity = s.intensity;
    }
    saved.length = 0;
  };

  // ---------- The Return: clinical over-bright + one buzzing tube ----------
  const mountReturn = () => {
    for (const light of scene.lights) {
      if (!(light instanceof BABYLON.PointLight)) continue;
      const id = (light.metadata as { sceneAssetId?: string } | null)?.sceneAssetId ?? light.name;
      if (!/^light-/.test(id)) continue;
      saveIntensity(light);
      light.intensity = Math.max(light.intensity, 1.35) * 1.55;
      light.range = Math.max(light.range || 0, 16);
      light.diffuse = new BABYLON.Color3(0.92, 0.97, 1);
    }
    // One tube that never settles: a mid-hall practical buzzes under the over-bright wash.
    const pick =
      (scene.getLightByName('light-h2-a') as BABYLON.PointLight | null) ??
      (scene.getLightByName('light-lab-n') as BABYLON.PointLight | null) ??
      scene.lights.find((l): l is BABYLON.PointLight => l instanceof BABYLON.PointLight && /^light-h/.test(l.name)) ??
      null;
    if (pick) {
      buzzLight = pick;
      saveIntensity(pick);
      const at = pick.getAbsolutePosition();
      buzz = playClip(BUZZ, 0.14, { loop: true, world: { at: { x: at.x, y: at.y, z: at.z }, cls: 'machinery' } });
    }
  };

  // ---------- The Desk: one lamp, long shadows, city rim, vanity text for the mirror ----------
  const mountDesk = () => {
    for (const light of scene.lights) {
      if (light.name === 'hemi' || light.name === 'sun' || light.name === 'key-shadow' || light.name === 'phoneFlash') continue;
      if (light instanceof BABYLON.PointLight || light instanceof BABYLON.SpotLight) {
        saveIntensity(light);
        light.intensity *= 0.08;
      }
    }
    const hemi = scene.getLightByName('hemi');
    const sun = scene.getLightByName('sun');
    if (hemi instanceof BABYLON.HemisphericLight) {
      saveIntensity(hemi);
      hemi.intensity = 0.22;
      hemi.groundColor.set(0.02, 0.03, 0.06);
    }
    if (sun instanceof BABYLON.DirectionalLight) {
      saveIntensity(sun);
      sun.intensity = 0.04;
    }

    deskLamp = new BABYLON.SpotLight(
      'quiet-desk-lamp',
      new BABYLON.Vector3(DESK.x - 0.35, DESK.y + 0.55, DESK.z + 0.15),
      new BABYLON.Vector3(0.55, -0.75, -0.35).normalize(),
      Math.PI * 0.55,
      1.6,
      scene,
    );
    deskLamp.diffuse = new BABYLON.Color3(1, 0.82, 0.55);
    deskLamp.specular = new BABYLON.Color3(0.6, 0.45, 0.25);
    deskLamp.intensity = 4.8;
    deskLamp.range = 9;
    owned.push(deskLamp);

    // Physical lamp body on the desk so the prop reads and casts.
    const base = BABYLON.MeshBuilder.CreateCylinder('quiet-desk-lamp-base', { height: 0.04, diameter: 0.14 }, scene);
    base.position.set(DESK.x - 0.35, DESK.y + 0.02, DESK.z + 0.15);
    const arm = BABYLON.MeshBuilder.CreateCylinder('quiet-desk-lamp-arm', { height: 0.42, diameter: 0.028 }, scene);
    arm.position.set(DESK.x - 0.35, DESK.y + 0.24, DESK.z + 0.15);
    const shade = BABYLON.MeshBuilder.CreateCylinder('quiet-desk-lamp-shade', { height: 0.12, diameterTop: 0.08, diameterBottom: 0.22 }, scene);
    shade.position.set(DESK.x - 0.2, DESK.y + 0.48, DESK.z + 0.05);
    shade.rotation.z = 0.55;
    const metal = new BABYLON.StandardMaterial('quiet-desk-lamp-mat', scene);
    metal.diffuseColor = new BABYLON.Color3(0.18, 0.16, 0.12);
    metal.emissiveColor = new BABYLON.Color3(0.35, 0.22, 0.08);
    metal.specularColor = new BABYLON.Color3(0.4, 0.35, 0.25);
    metal.metadata = { prop: true, castShadow: true };
    for (const m of [base, arm, shade]) {
      m.material = metal;
      m.isPickable = false;
      m.checkCollisions = false;
      m.metadata = { ...(m.metadata ?? {}), castShadow: true };
      owned.push(m);
    }
    owned.push(metal);

    cityRim = new BABYLON.PointLight('quiet-city-rim', new BABYLON.Vector3(WINDOW_CITY.x, WINDOW_CITY.y, WINDOW_CITY.z), scene);
    cityRim.diffuse = new BABYLON.Color3(0.35, 0.48, 0.85);
    cityRim.specular = new BABYLON.Color3(0.1, 0.14, 0.25);
    cityRim.intensity = 1.1;
    cityRim.range = 14;
    owned.push(cityRim);

    // Long contact shadows: key almost horizontal from the lamp toward the carpet.
    opts.setKeyDir?.([0.82, -0.42, -0.28]);

    // Vanity plaque on the west bath wall. Default plane faces -Z; yaw π/2 turns that face to +X (into the
    // room toward the glass). Readable looking west at the wall; MirrorTexture reverses it in the glass.
    const plaque = BABYLON.MeshBuilder.CreatePlane('quiet-bath-sign', { width: 0.42, height: 0.12 }, scene);
    plaque.position.set(18.55, 1.35, 28.15);
    plaque.rotation.y = Math.PI / 2;
    plaque.isPickable = false;
    plaque.metadata = { ...(plaque.metadata ?? {}), sceneAssetId: 'bath-sign-hawkes' };
    const tex = new BABYLON.DynamicTexture('quiet-bath-sign-tex', { width: 512, height: 128 }, scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = '#1a1c20';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#d8d2c4';
    ctx.font = '700 64px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('HAWKES', 256, 68);
    tex.update();
    const mat = new BABYLON.StandardMaterial('quiet-bath-sign-mat', scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.emissiveColor = new BABYLON.Color3(0.35, 0.34, 0.3);
    mat.specularColor = BABYLON.Color3.Black();
    mat.backFaceCulling = true;
    plaque.material = mat;
    // Never negative scale: MirrorTexture reverses the pass; the plaque itself stays upright.
    plaque.scaling.set(1, 1, 1);
    owned.push(plaque, tex, mat);
    mirrorSignOk = plaque.scaling.x > 0 && plaque.scaling.y > 0 && plaque.scaling.z > 0;
  };

  // ---------- The Morning: dawn shafts, dust, TV spill ----------
  const mountMorning = () => {
    blindsGobo = loadGobo(scene, '/assets/textures/gobo/blinds.webp', () => goboBlinds(scene, 'quiet-gobo-blinds'));
    windowGobo = loadGobo(scene, '/assets/textures/gobo/window.webp', () => goboWindow(scene, 'quiet-gobo-window'));
    owned.push(blindsGobo, windowGobo);

    // Soften the authored ceiling lamps so the window key reads.
    for (const light of scene.lights) {
      if (!light.name.startsWith('morning-lamp')) continue;
      saveIntensity(light);
      light.intensity *= 0.35;
    }
    const hemi = scene.getLightByName('hemi');
    if (hemi instanceof BABYLON.HemisphericLight) {
      saveIntensity(hemi);
      hemi.intensity = 0.45;
      hemi.groundColor.set(0.22, 0.2, 0.16);
      hemi.diffuse = new BABYLON.Color3(0.95, 0.82, 0.62);
    }

    sunSpot = new BABYLON.SpotLight(
      'quiet-dawn-sun',
      new BABYLON.Vector3(MORNING_WINDOW.x - 0.4, MORNING_WINDOW.y + 0.15, MORNING_WINDOW.z),
      new BABYLON.Vector3(1, -0.35, 0.12).normalize(),
      Math.PI * 0.48,
      1.35,
      scene,
    );
    sunSpot.diffuse = new BABYLON.Color3(1, 0.86, 0.62);
    sunSpot.specular = new BABYLON.Color3(0.5, 0.4, 0.25);
    sunSpot.intensity = 0.15;
    sunSpot.range = 12;
    sunSpot.projectionTexture = blindsGobo;
    owned.push(sunSpot);
    opts.setKeyDir?.([0.75, -0.55, 0.2]);

    tvLight = new BABYLON.PointLight('quiet-tv-spill', new BABYLON.Vector3(TV.x, TV.y, TV.z + 0.35), scene);
    tvLight.diffuse = new BABYLON.Color3(0.35, 0.55, 1);
    tvLight.specular = new BABYLON.Color3(0.15, 0.25, 0.45);
    tvLight.intensity = 0;
    tvLight.range = 5.5;
    owned.push(tvLight);

    // Light-shaft meshes (every tier; phone Low relies on these instead of VLS).
    shaftRoot = new BABYLON.TransformNode('quiet-dawn-shafts', scene);
    owned.push(shaftRoot);
    const shaftMat = new BABYLON.StandardMaterial('quiet-dawn-shaft-mat', scene);
    shaftMat.disableLighting = true;
    shaftMat.emissiveColor = new BABYLON.Color3(1, 0.88, 0.65);
    shaftMat.diffuseColor = BABYLON.Color3.Black();
    shaftMat.specularColor = BABYLON.Color3.Black();
    shaftMat.alpha = 0.14;
    shaftMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    shaftMat.backFaceCulling = false;
    shaftMat.disableDepthWrite = true;
    owned.push(shaftMat);
    for (let i = 0; i < 7; i += 1) {
      const slab = BABYLON.MeshBuilder.CreateBox(`quiet-dawn-shaft-${i}`, { width: 0.09, height: 2.4, depth: 4.2 }, scene);
      slab.parent = shaftRoot;
      slab.position.set(0.2 + i * 0.22, 0.05, 0.6);
      slab.rotation.z = -0.12;
      slab.rotation.y = 0.04 * (i - 3);
      slab.material = shaftMat;
      slab.isPickable = false;
      slab.visibility = 0.55 + (i % 2) * 0.15;
      owned.push(slab);
    }
    shaftRoot.position.set(MORNING_WINDOW.x + 0.3, 1.2, MORNING_WINDOW.z);
    sunShaftsOn = true;

    // Dust motes that catch the dawn and the TV.
    const dustCount = opts.tier() === 'low' ? 120 : 280;
    const positions: number[] = [];
    const uvs: number[] = [];
    const uvs2: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < dustCount; i += 1) {
      const base = i * 4;
      const phase = Math.random();
      const size = 0.012 + Math.random() * 0.02;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        positions.push(Math.random(), Math.random(), Math.random());
        uvs.push(u, v);
        uvs2.push(size, phase);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const dust = new BABYLON.Mesh('quiet-dawn-dust', scene);
    const data = new BABYLON.VertexData();
    data.positions = positions;
    data.uvs = uvs;
    data.uvs2 = uvs2;
    data.indices = indices;
    data.applyToMesh(dust);
    dust.isPickable = false;
    dust.alwaysSelectAsActiveMesh = true;
    dustMat = new BABYLON.ShaderMaterial(
      'quiet-dawn-dust-mat',
      scene,
      {
        vertexSource: /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec2 uv2;
uniform mat4 viewProjection;
uniform mat4 view;
uniform vec3 camPos;
uniform float time;
varying vec2 vCorner;
varying float vFade;
varying float vBeam;
void main(void) {
  float phase = uv2.y;
  vec3 drift = vec3(sin(time * 0.09 + phase * 5.0) * 0.5, sin(time * 0.06 + phase * 2.0) * 0.25 - time * 0.02 * (0.3 + phase), cos(time * 0.07 + phase * 4.0) * 0.5);
  vec3 cell = position * 7.0 + drift;
  vec3 rel = fract((cell - camPos) / 7.0 + 0.5) - 0.5;
  vec3 world = camPos + rel * 7.0;
  // Prefer motes near the west window shaft corridor.
  vBeam = smoothstep(3.5, 0.2, abs(world.z + 0.4)) * smoothstep(6.0, 0.5, world.x) * smoothstep(-0.2, 1.8, world.y);
  vec3 right = vec3(view[0][0], view[1][0], view[2][0]);
  vec3 up = vec3(view[0][1], view[1][1], view[2][1]);
  float d = length(world - camPos);
  vFade = smoothstep(0.4, 1.1, d) * (1.0 - smoothstep(3.2, 5.5, d));
  vCorner = uv;
  gl_Position = viewProjection * vec4(world + (right * uv.x + up * uv.y) * uv2.x, 1.0);
}
`,
        fragmentSource: /* glsl */ `
precision highp float;
varying vec2 vCorner;
varying float vFade;
varying float vBeam;
uniform float gain;
uniform float day;
uniform float tv;
void main(void) {
  float r = dot(vCorner, vCorner);
  if (r > 1.0) discard;
  float soft = exp(-r * 3.4);
  float lit = vBeam * (0.35 + 0.9 * day) + tv * 0.25;
  float a = soft * vFade * (0.08 + lit) * gain;
  if (a < 0.002) discard;
  vec3 c = mix(vec3(0.75, 0.82, 0.95), vec3(1.0, 0.9, 0.7), day);
  gl_FragColor = vec4(c * a, a);
}
`,
      },
      {
        attributes: ['position', 'uv', 'uv2'],
        uniforms: ['viewProjection', 'view', 'camPos', 'time', 'gain', 'day', 'tv'],
        needAlphaBlending: true,
      },
    );
    dustMat.backFaceCulling = false;
    dustMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
    dustMat.disableDepthWrite = true;
    dustMat.setFloat('gain', opts.tier() === 'low' ? 0.7 : 1.1);
    dust.material = dustMat;
    owned.push(dust, dustMat);
    dustOn = true;

    ensureVolumetric();
  };

  const ensureVolumetric = () => {
    if (mode !== 'morning' || opts.tier() !== 'high' || vls || !sunSpot) return;
    vlsMesh = BABYLON.MeshBuilder.CreateSphere('quiet-dawn-vls', { diameter: 0.2, segments: 6 }, scene);
    vlsMesh.isPickable = false;
    vlsMesh.position.copyFrom(sunSpot.position);
    const mat = new BABYLON.StandardMaterial('quiet-dawn-vls-mat', scene);
    mat.disableLighting = true;
    mat.emissiveColor = new BABYLON.Color3(1, 0.9, 0.7);
    mat.diffuseColor = BABYLON.Color3.Black();
    vlsMesh.material = mat;
    try {
      vls = new BABYLON.VolumetricLightScatteringPostProcess(
        'quiet-dawn-vls-pp',
        0.55,
        camera,
        vlsMesh,
        70,
        BABYLON.Texture.BILINEAR_SAMPLINGMODE,
        scene.getEngine(),
        false,
      );
      vls.exposure = 0.28;
      vls.decay = 0.94;
      vls.weight = 0.62;
      vls.density = 0.78;
      const vlsRef = vls;
      owned.push(
        {
          dispose: () => {
            try { vlsRef.dispose(camera); } catch { /* */ }
            if (vls === vlsRef) vls = null;
          },
        },
        vlsMesh,
        mat,
      );
    } catch (error) {
      console.warn('Morning volumetric shafts unavailable', error);
      vlsMesh.dispose();
      vlsMesh = null;
      mat.dispose();
    }
  };

  if (mode === 'return') mountReturn();
  else if (mode === 'desk') mountDesk();
  else mountMorning();

  return {
    step: (dt: number) => {
      clock += dt;
      frames += 1;
      const now = performance.now();
      if (now - lastFpsAt >= 500) {
        fpsHint = Math.round((frames * 1000) / (now - lastFpsAt));
        frames = 0;
        lastFpsAt = now;
      }

      if (mode === 'return' && buzzLight) {
        // Clinical tube that never settles: slow pulse + a sharp stutter.
        const n = Math.sin(clock * 17.3) * Math.sin(clock * 5.1) + Math.sin(clock * 41.0) * 0.35;
        const base = saved.find((s) => s.light === buzzLight)?.intensity ?? 1.4;
        const stutter = n > 1.15 ? 0.35 : n > 0.85 ? 0.7 : 1;
        buzzLight.intensity = base * (0.92 + 0.08 * Math.sin(clock * 2.2)) * stutter;
      }

      if (mode === 'morning') {
        const day = opts.morningDay?.() ?? 0;
        const slide = Math.min(1, clock / DAWN_SLIDE_SECONDS);
        if (sunSpot) {
          sunSpot.intensity = 0.2 + day * 3.6;
          // Shafts crawl east across the floor as morning progresses.
          const yaw = -0.05 + slide * 0.35;
          const pitch = -0.28 - slide * 0.12;
          sunSpot.direction.set(Math.cos(yaw), pitch, Math.sin(yaw) * 0.4 + 0.1);
          sunSpot.direction.normalize();
          sunSpot.position.set(
            MORNING_WINDOW.x - 0.35,
            MORNING_WINDOW.y + 0.2 - slide * 0.25,
            MORNING_WINDOW.z + slide * 0.9,
          );
          if (windowGobo && day > 0.4 && sunSpot.projectionTexture === blindsGobo) {
            // After Sleep, the open window mullion joins the blinds throw.
            sunSpot.projectionTexture = windowGobo;
          }
        }
        if (shaftRoot) {
          shaftRoot.position.z = MORNING_WINDOW.z + slide * 1.1;
          shaftRoot.position.x = MORNING_WINDOW.x + 0.3 + slide * 0.8;
          shaftRoot.rotation.y = slide * 0.18;
          const vis = 0.2 + day * 0.75;
          for (const child of shaftRoot.getChildMeshes()) child.visibility = vis * (0.5 + 0.5 * Math.sin(clock * 0.4 + child.position.x));
        }
        if (vlsMesh && sunSpot) vlsMesh.position.copyFrom(sunSpot.position);
        if (opts.tier() === 'high' && !vls) ensureVolumetric();

        if (tvLight) {
          const on = !!opts.tvOn?.();
          if (!on) tvLight.intensity = 0;
          else {
            const picture = Math.max(0.25, Math.min(1, opts.tvBright?.() ?? 0.7));
            const flicker = 0.75 + 0.35 * Math.sin(clock * 11.3) * Math.sin(clock * 7.1) + 0.12 * Math.sin(clock * 29.0);
            tvLight.intensity = 2.8 * picture * Math.max(0.45, flicker);
            tvLight.diffuse.set(0.28 + 0.12 * picture, 0.45 + 0.1 * picture, 0.85 + 0.15 * picture);
          }
        }

        if (dustMat) {
          const cam = scene.activeCamera?.globalPosition;
          if (cam) dustMat.setVector3('camPos', cam);
          dustMat.setFloat('time', clock);
          dustMat.setFloat('day', day);
          dustMat.setFloat('tv', tvLight && tvLight.intensity > 0.2 ? 1 : 0);
        }
      }
    },
    stats: (): QuietLightStats => {
      const day = opts.morningDay?.() ?? 0;
      const key = scene.getLightByName('key-shadow');
      const keyDir = key instanceof BABYLON.DirectionalLight ? key.direction : null;
      // Long shadows: key more horizontal than steep overhead (|y| under ~0.7).
      const long = mode === 'desk' && !!deskLamp && !!keyDir && Math.abs(keyDir.y) < 0.7 && Math.abs(keyDir.x) > 0.45;
      const plaque = scene.getMeshByName('quiet-bath-sign');
      const plaqueOk = !plaque
        || (plaque.scaling.x > 0 && plaque.scaling.y > 0 && plaque.scaling.z > 0
          && Math.abs(Math.sin(plaque.rotation.y)) > 0.9);
      return {
        mode,
        deskLamp: !!deskLamp && deskLamp.intensity > 1,
        deskShadowLong: long,
        mirrorTextOk: mode === 'desk' ? mirrorSignOk && plaqueOk : true,
        sunShafts: sunShaftsOn && (mode !== 'morning' || day > 0.05 || !!vls),
        volumetric: !!vls,
        tvSpill: !!tvLight && tvLight.intensity > 0.3,
        buzzTube: mode === 'return' && !!buzzLight,
        dust: dustOn,
        fpsHint,
      };
    },
    dispose: () => {
      buzz?.stop();
      buzz = null;
      restore();
      opts.setKeyDir?.(null);
      for (const o of owned) {
        try { o.dispose(); } catch { /* */ }
      }
      owned.length = 0;
      deskLamp = null;
      cityRim = null;
      tvLight = null;
      sunSpot = null;
      vls = null;
      vlsMesh = null;
      shaftRoot = null;
    },
  };
};

export type QuietLight = ReturnType<typeof createQuietLight>;
