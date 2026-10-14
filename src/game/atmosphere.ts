import * as BABYLON from '@babylonjs/core';

/**
 * Air for interior levels: dust motes that catch the flashlight and nearby lamps,
 * soft light shafts under ceiling practicals, and steam off pipes.
 * Everything is one or two draw calls and reads the existing scene lights,
 * so dips and flicker from the story code show up in the air too.
 */

export type AtmosphereOptions = {
  /** Motes around the camera. 0 turns dust off. */
  dust: number;
  dustColor?: [number, number, number];
  /** Brightness of motes in light. */
  dustGain?: number;
  /** Mote size multiplier. */
  dustSize?: number;
  /** Shafts under point lights whose name matches. */
  shafts?: { match: RegExp; gain: number; floor?: number; maxHeight?: number; spread?: number };
  /** Steam emitters. */
  steam?: { x: number; y: number; z: number; up?: number }[];
  steamColor?: [number, number, number];
  /** Visible cone for the phone flashlight. */
  beam?: number;
};

const BEAM_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 worldViewProjection;
uniform mat4 world;
uniform vec3 camPos;
varying float vH;
varying float vEdge;
void main(void) {
  vec3 w = (world * vec4(position, 1.0)).xyz;
  vec3 n = normalize(mat3(world) * normal);
  vEdge = abs(dot(n, normalize(camPos - w)));
  vH = uv.y;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const BEAM_FRAG = /* glsl */ `
precision highp float;
varying float vH;
varying float vEdge;
uniform float beamI;
void main(void) {
  float fall = pow(1.0 - vH, 1.35) * smoothstep(0.0, 0.1, vH);
  float a = fall * (0.3 + 0.7 * pow(vEdge, 0.7)) * beamI;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vec3(1.0, 0.95, 0.86) * a, a);
}
`;

const DUST_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec2 uv2;
uniform mat4 viewProjection;
uniform mat4 view;
uniform vec3 camPos;
uniform float boxSize;
uniform float time;
varying vec2 vCorner;
varying vec3 vWorld;
varying float vFade;
void main(void) {
  float phase = uv2.y;
  vec3 drift = vec3(sin(time * 0.11 + phase * 6.0) * 0.6, sin(time * 0.07 + phase * 3.0) * 0.4 - time * 0.03 * (0.4 + phase), cos(time * 0.09 + phase * 5.0) * 0.6);
  vec3 cell = position * boxSize + drift;
  vec3 rel = fract((cell - camPos) / boxSize + 0.5) - 0.5;
  vec3 world = camPos + rel * boxSize;
  vec3 right = vec3(view[0][0], view[1][0], view[2][0]);
  vec3 up = vec3(view[0][1], view[1][1], view[2][1]);
  float d = length(world - camPos);
  vFade = smoothstep(0.35, 1.2, d) * (1.0 - smoothstep(boxSize * 0.32, boxSize * 0.5, d));
  vCorner = uv;
  vWorld = world;
  gl_Position = viewProjection * vec4(world + (right * uv.x + up * uv.y) * uv2.x, 1.0);
}
`;

const DUST_FRAG = /* glsl */ `
precision highp float;
varying vec2 vCorner;
varying vec3 vWorld;
varying float vFade;
uniform vec3 dustColor;
uniform float gain;
uniform vec3 spotPos;
uniform vec3 spotDir;
uniform float spotI;
uniform vec4 lights[6];
uniform vec3 lightColors[6];
void main(void) {
  float r = dot(vCorner, vCorner);
  if (r > 1.0) discard;
  float soft = exp(-r * 3.2);
  vec3 toSpot = vWorld - spotPos;
  float ds = length(toSpot);
  float cone = smoothstep(0.82, 0.95, dot(toSpot / max(ds, 0.001), spotDir));
  vec3 lit = vec3(1.0, 0.95, 0.85) * cone * spotI * clamp(1.0 - ds / 13.0, 0.0, 1.0) * 3.2;
  for (int i = 0; i < 6; i++) {
    vec4 l = lights[i];
    float dl = length(vWorld - l.xyz);
    float f = clamp(1.0 - dl / max(l.w, 0.01), 0.0, 1.0);
    lit += lightColors[i] * f * f;
  }
  vec3 c = dustColor * (lit * gain + 0.012);
  float a = soft * vFade;
  gl_FragColor = vec4(c * a, a);
}
`;

const SHAFT_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform float shaftI[32];
uniform vec3 camPos;
varying float vH;
varying float vI;
varying float vEdge;
varying vec3 vColor;
attribute vec4 color;
void main(void) {
  int idx = int(uv.x + 0.5);
  float inten = 0.0;
  for (int i = 0; i < 32; i++) {
    if (i == idx) inten = shaftI[i];
  }
  vI = inten;
  vH = uv.y;
  vColor = color.rgb;
  vec3 V = normalize(camPos - position);
  vEdge = abs(dot(normalize(normal), V));
  gl_Position = viewProjection * vec4(position, 1.0);
}
`;

const SHAFT_FRAG = /* glsl */ `
precision highp float;
varying float vH;
varying float vI;
varying float vEdge;
varying vec3 vColor;
uniform float gain;
void main(void) {
  float fall = pow(1.0 - vH, 1.6);
  float a = fall * pow(vEdge, 1.8) * vI * gain;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`;

const puffTexture = (scene: BABYLON.Scene) => {
  const tex = new BABYLON.DynamicTexture('atmo-puff', { width: 64, height: 64 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  tex.update();
  tex.hasAlpha = true;
  return tex;
};

export const createAtmosphere = (scene: BABYLON.Scene, opts: AtmosphereOptions) => {
  const disposables: { dispose: () => void }[] = [];
  const BOX = 16;
  let clock = 0;

  // ---------- Dust ----------
  let dustMat: BABYLON.ShaderMaterial | null = null;
  if (opts.dust > 0) {
    const positions: number[] = [];
    const uvs: number[] = [];
    const uvs2: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < opts.dust; i += 1) {
      const sx = Math.random();
      const sy = Math.random();
      const sz = Math.random();
      const size = (0.012 + Math.random() * 0.028) * (opts.dustSize ?? 1);
      const phase = Math.random();
      const base = i * 4;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        positions.push(sx, sy, sz);
        uvs.push(u, v);
        uvs2.push(size, phase);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const mesh = new BABYLON.Mesh('atmo-dust', scene);
    const data = new BABYLON.VertexData();
    data.positions = positions;
    data.uvs = uvs;
    data.uvs2 = uvs2;
    data.indices = indices;
    data.applyToMesh(mesh);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    dustMat = new BABYLON.ShaderMaterial('atmo-dust', scene, { vertexSource: DUST_VERT, fragmentSource: DUST_FRAG }, {
      attributes: ['position', 'uv', 'uv2'],
      uniforms: ['viewProjection', 'view', 'camPos', 'boxSize', 'time', 'dustColor', 'gain', 'spotPos', 'spotDir', 'spotI', 'lights', 'lightColors'],
      needAlphaBlending: true,
    });
    dustMat.backFaceCulling = false;
    dustMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
    dustMat.disableDepthWrite = true;
    const c = opts.dustColor ?? [0.9, 0.92, 0.88];
    dustMat.setColor3('dustColor', new BABYLON.Color3(c[0], c[1], c[2]));
    dustMat.setFloat('gain', opts.dustGain ?? 1);
    dustMat.setFloat('boxSize', BOX);
    mesh.material = dustMat;
    disposables.push(mesh, dustMat);
  }

  // ---------- Shafts ----------
  type Shaft = { light: BABYLON.Light; base: number };
  const shafts: Shaft[] = [];
  let shaftMat: BABYLON.ShaderMaterial | null = null;
  if (opts.shafts) {
    const cfg = opts.shafts;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const SEG = 16;
    for (const light of scene.lights) {
      if (shafts.length >= 32) break;
      const id = (light.metadata as { sceneAssetId?: string } | null)?.sceneAssetId ?? light.name;
      if (!(light instanceof BABYLON.PointLight) || !cfg.match.test(id)) continue;
      const p = light.getAbsolutePosition();
      const floor = cfg.floor ?? 0;
      const h = Math.min(p.y - floor, cfg.maxHeight ?? 4.5);
      if (h < 1) continue;
      const index = shafts.length;
      shafts.push({ light, base: Math.max(0.001, light.intensity) });
      const top = 0.22;
      const bottom = Math.min(2.6, h * (cfg.spread ?? 0.55));
      const col = light.diffuse;
      const base = positions.length / 3;
      for (let i = 0; i <= SEG; i += 1) {
        const a = (i / SEG) * Math.PI * 2;
        const cx = Math.cos(a);
        const cz = Math.sin(a);
        const slope = (bottom - top) / h;
        const nl = Math.hypot(1, slope);
        for (const [r, y, hv] of [[top, p.y - 0.12, 0], [bottom, p.y - h, 1]] as const) {
          positions.push(p.x + cx * r, y, p.z + cz * r);
          normals.push(cx / nl, slope / nl, cz / nl);
          uvs.push(index, hv);
          colors.push(col.r, col.g, col.b, 1);
        }
      }
      for (let i = 0; i < SEG; i += 1) {
        const a = base + i * 2;
        indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    if (shafts.length) {
      const mesh = new BABYLON.Mesh('atmo-shafts', scene);
      const data = new BABYLON.VertexData();
      data.positions = positions;
      data.normals = normals;
      data.uvs = uvs;
      data.colors = colors;
      data.indices = indices;
      data.applyToMesh(mesh);
      mesh.isPickable = false;
      shaftMat = new BABYLON.ShaderMaterial('atmo-shafts', scene, { vertexSource: SHAFT_VERT, fragmentSource: SHAFT_FRAG }, {
        attributes: ['position', 'normal', 'uv', 'color'],
        uniforms: ['viewProjection', 'shaftI', 'camPos', 'gain'],
        needAlphaBlending: true,
      });
      shaftMat.backFaceCulling = false;
      shaftMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
      shaftMat.disableDepthWrite = true;
      shaftMat.setFloat('gain', cfg.gain);
      mesh.material = shaftMat;
      disposables.push(mesh, shaftMat);
    }
  }

  // ---------- Steam ----------
  if (opts.steam?.length) {
    const tex = puffTexture(scene);
    disposables.push(tex);
    const sc = opts.steamColor ?? [0.75, 0.8, 0.78];
    for (const [i, s] of opts.steam.entries()) {
      const ps = new BABYLON.ParticleSystem(`atmo-steam-${i}`, 60, scene);
      ps.particleTexture = tex;
      ps.emitter = new BABYLON.Vector3(s.x, s.y, s.z);
      ps.minEmitBox = new BABYLON.Vector3(-0.08, 0, -0.08);
      ps.maxEmitBox = new BABYLON.Vector3(0.08, 0, 0.08);
      const up = s.up ?? 1;
      ps.direction1 = new BABYLON.Vector3(-0.25, up, -0.25);
      ps.direction2 = new BABYLON.Vector3(0.25, up, 0.25);
      ps.minEmitPower = 0.25;
      ps.maxEmitPower = 0.6;
      ps.minLifeTime = 2.2;
      ps.maxLifeTime = 4.2;
      ps.minSize = 0.35;
      ps.maxSize = 0.9;
      ps.minAngularSpeed = -0.4;
      ps.maxAngularSpeed = 0.4;
      ps.emitRate = 7;
      ps.gravity = new BABYLON.Vector3(0.05, 0.18 * up, 0);
      ps.color1 = new BABYLON.Color4(sc[0], sc[1], sc[2], 0.14);
      ps.color2 = new BABYLON.Color4(sc[0] * 0.8, sc[1] * 0.8, sc[2] * 0.8, 0.08);
      ps.colorDead = new BABYLON.Color4(sc[0], sc[1], sc[2], 0);
      ps.addSizeGradient(0, 0.4);
      ps.addSizeGradient(1, 1.6);
      ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
      ps.start();
      disposables.push(ps);
    }
  }

  // ---------- Flashlight beam ----------
  let beamMesh: BABYLON.Mesh | null = null;
  let beamMat: BABYLON.ShaderMaterial | null = null;
  if (opts.beam) {
    const length = 9;
    const radius = Math.tan(0.25) * length;
    const SEG = 18;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= SEG; i += 1) {
      const a = (i / SEG) * Math.PI * 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      for (const [r, z, h] of [[0.03, 0, 0], [radius, length, 1]] as const) {
        positions.push(cx * r, cy * r, z);
        normals.push(cx, cy, -radius / length);
        uvs.push(0, h);
      }
    }
    for (let i = 0; i < SEG; i += 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    beamMesh = new BABYLON.Mesh('atmo-beam', scene);
    const data = new BABYLON.VertexData();
    data.positions = positions;
    data.normals = normals;
    data.uvs = uvs;
    data.indices = indices;
    data.applyToMesh(beamMesh);
    beamMesh.isPickable = false;
    beamMesh.rotationQuaternion = new BABYLON.Quaternion();
    beamMat = new BABYLON.ShaderMaterial('atmo-beam', scene, { vertexSource: BEAM_VERT, fragmentSource: BEAM_FRAG }, {
      attributes: ['position', 'normal', 'uv'],
      uniforms: ['worldViewProjection', 'world', 'camPos', 'beamI'],
      needAlphaBlending: true,
    });
    beamMat.backFaceCulling = false;
    beamMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
    beamMat.disableDepthWrite = true;
    beamMesh.material = beamMat;
    beamMesh.setEnabled(false);
    disposables.push(beamMesh, beamMat);
  }

  const lightVec = new Array(24).fill(0);
  const lightCol = new Array(18).fill(0);
  const shaftI = new Array(32).fill(0);
  let lightWait = 0;
  let nearest: BABYLON.PointLight[] = [];
  const spotPos = new BABYLON.Vector3();
  const spotDir = new BABYLON.Vector3(0, -1, 0);

  return {
    step: (dt: number) => {
      clock += dt;
      const camera = scene.activeCamera;
      if (!camera) return;
      const cam = camera.globalPosition;
      if (dustMat) {
        lightWait -= dt;
        if (lightWait <= 0) {
          lightWait = 0.4;
          nearest = scene.lights
            .filter((l): l is BABYLON.PointLight => l instanceof BABYLON.PointLight && l.isEnabled() && l.intensity > 0.01)
            .sort((a, b) => BABYLON.Vector3.DistanceSquared(a.getAbsolutePosition(), cam) - BABYLON.Vector3.DistanceSquared(b.getAbsolutePosition(), cam))
            .slice(0, 6);
        }
        for (let i = 0; i < 6; i += 1) {
          const l = nearest[i];
          if (l && l.isEnabled()) {
            const p = l.getAbsolutePosition();
            const range = Math.min(l.range && Number.isFinite(l.range) ? l.range : 8, 9);
            lightVec.splice(i * 4, 4, p.x, p.y, p.z, range);
            const k = Math.min(l.intensity, 3) * 0.35;
            lightCol.splice(i * 3, 3, l.diffuse.r * k, l.diffuse.g * k, l.diffuse.b * k);
          } else {
            lightVec.splice(i * 4, 4, 0, -999, 0, 0.01);
            lightCol.splice(i * 3, 3, 0, 0, 0);
          }
        }
        const spot = scene.getLightByName('phoneFlash');
        let spotI = 0;
        if (spot instanceof BABYLON.SpotLight && spot.isEnabled() && spot.intensity > 0.5) {
          spotPos.copyFrom(spot.getAbsolutePosition());
          spotDir.copyFrom(spot.direction).normalize();
          spotI = Math.min(1.5, spot.intensity / 30);
        }
        dustMat.setVector3('camPos', cam);
        dustMat.setFloat('time', clock);
        dustMat.setVector3('spotPos', spotPos);
        dustMat.setVector3('spotDir', spotDir);
        dustMat.setFloat('spotI', spotI);
        dustMat.setArray4('lights', lightVec);
        dustMat.setArray3('lightColors', lightCol);
      }
      if (beamMesh && beamMat) {
        const spot = scene.getLightByName('phoneFlash');
        const on = spot instanceof BABYLON.SpotLight && spot.isEnabled() && spot.intensity > 0.5;
        beamMesh.setEnabled(on);
        if (on && spot instanceof BABYLON.SpotLight) {
          beamMesh.position.copyFrom(spot.getAbsolutePosition());
          const dir = spot.direction.clone().normalize();
          BABYLON.Quaternion.FromUnitVectorsToRef(BABYLON.Vector3.Forward(), dir, beamMesh.rotationQuaternion!);
          beamMat.setFloat('beamI', (opts.beam ?? 0) * Math.min(1.4, spot.intensity / 30));
          beamMat.setVector3('camPos', cam);
        }
      }
      if (shaftMat) {
        for (let i = 0; i < shafts.length; i += 1) {
          const s = shafts[i];
          shaftI[i] = s.light.isEnabled() ? Math.min(2, s.light.intensity / s.base) : 0;
        }
        shaftMat.setFloats('shaftI', shaftI);
        shaftMat.setVector3('camPos', cam);
      }
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
};

export type Atmosphere = ReturnType<typeof createAtmosphere>;
