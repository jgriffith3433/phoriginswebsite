import * as BABYLON from '@babylonjs/core';

import { CollisionGeo, Geo } from './geo';
import {
  type Building, type City, type Junction, type Light, type Mass, type Piece, type Prop, type Store, type WalkPath,
  CHUNK, CURB, DOWNTOWN, LIGHT_COLORS, LOBBY, STATION_PIT, STYLE, buildCity,
} from './layout';
import { type V2, Grid, ccw, clamp, earcut, obbPush, pointAt, segDist } from './math2';
import { CITY_SHADERS, SHARED_UNIFORMS } from './shaders';

type Vec3 = [number, number, number];

const SURF = { ROAD: 0, PATCH: 1, WALK: 2, CURBFACE: 3, PAVERS: 4, BASE: 5, GRASS: 6, PATH: 7, WATER: 8, TILE: 9 };
const ROAD_Y = 0.02;

const CAR_COLORS: Vec3[] = [
  [0.75, 0.75, 0.74], [0.04, 0.04, 0.045], [0.45, 0.46, 0.48], [0.06, 0.1, 0.22],
  [0.4, 0.05, 0.04], [0.2, 0.21, 0.22], [0.75, 0.55, 0.06], [0.08, 0.18, 0.12],
];
const NEON: Vec3[] = [
  [1.0, 0.62, 0.3], [1.0, 0.85, 0.6], [1.0, 0.8, 0.5], [1.0, 0.82, 0.6], [0.75, 0.86, 1.0],
  [1.0, 0.2, 0.58], [0.2, 0.86, 1.0], [0.4, 1.0, 0.4], [1.0, 0.45, 0.15],
];
const AWNINGS: Vec3[] = [[0.42, 0.06, 0.05], [0.05, 0.22, 0.12], [0.06, 0.08, 0.2], [0.3, 0.05, 0.1], [0.36, 0.3, 0.12], [0.08, 0.09, 0.1]];
const ADS: Vec3[] = [[1.0, 0.75, 0.3], [0.3, 0.75, 1.0], [1.0, 0.3, 0.5], [0.5, 1.0, 0.6], [0.95, 0.95, 0.9]];

export type SignalState = { x: number; z: number; walkX: number; walkZ: number };

export type CityWorldOptions = { mobile: boolean };

const chunkKey = (ix: number, iz: number) => ix * 4096 + iz;

export const createCityWorld = (scene: BABYLON.Scene, opts: CityWorldOptions) => {
  const city: City = buildCity();
  const LOAD = opts.mobile ? 280 : 400;
  const UNLOAD = LOAD + 90;

  // ---------- Buckets ----------
  type Bucket = {
    buildings: Building[];
    props: Prop[];
    pieceSegs: { piece: Piece; i: number }[];
    junctions: Junction[];
    paves: City['paves'];
    colliders: City['colliders'];
    stores: Store[];
    tall: Building[];
  };
  const buckets = new Map<number, Bucket>();
  const bucketOf = (x: number, z: number) => {
    const ix = Math.floor(x / CHUNK);
    const iz = Math.floor(z / CHUNK);
    const key = chunkKey(ix, iz);
    let b = buckets.get(key);
    if (!b) {
      b = { buildings: [], props: [], pieceSegs: [], junctions: [], paves: [], colliders: [], stores: [], tall: [] };
      buckets.set(key, b);
    }
    return b;
  };
  for (const b of city.buildings) {
    bucketOf(b.obb.x, b.obb.z).buildings.push(b);
    if (b.height > 26) bucketOf(b.obb.x, b.obb.z).tall.push(b);
  }
  for (const p of city.props) bucketOf(p.x, p.z).props.push(p);
  for (const j of city.junctions) bucketOf(j.x, j.z).junctions.push(j);
  for (const p of city.paves) {
    const cx = p.pts.reduce((s, q) => s + q.x, 0) / p.pts.length;
    const cz = p.pts.reduce((s, q) => s + q.z, 0) / p.pts.length;
    bucketOf(cx, cz).paves.push(p);
  }
  for (const c of city.colliders) bucketOf(c.obb.x, c.obb.z).colliders.push(c);
  for (const s of city.stores) bucketOf((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2).stores.push(s);

  // Ribbon samples per piece.
  type Ribbon = { s: number[]; p: V2[]; t: V2[] };
  const ribbons = new Map<Piece, Ribbon>();
  for (const piece of city.pieces) {
    const ss: number[] = [0];
    const marks = [piece.cut0, piece.len - piece.cut1, piece.side0L, piece.side0R, piece.len - piece.side1L, piece.len - piece.side1R];
    const step = piece.road.grid ? 8 : 4;
    for (let s = step; s < piece.len; s += step) ss.push(s);
    for (const m of marks) if (m > 0.05 && m < piece.len - 0.05) ss.push(m);
    ss.push(piece.len);
    ss.sort((a, b) => a - b);
    const uniq = ss.filter((v, i) => i === 0 || v - ss[i - 1] > 0.05);
    const p = uniq.map((s) => pointAt(piece.pts, piece.cum, s));
    const t = uniq.map((s) => {
      const a = pointAt(piece.pts, piece.cum, Math.max(0, s - 1.5));
      const b = pointAt(piece.pts, piece.cum, Math.min(piece.len, s + 1.5));
      const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { x: (b.x - a.x) / d, z: (b.z - a.z) / d };
    });
    ribbons.set(piece, { s: uniq, p, t });
    for (let i = 0; i < uniq.length - 1; i += 1) {
      bucketOf((p[i].x + p[i + 1].x) / 2, (p[i].z + p[i + 1].z) / 2).pieceSegs.push({ piece, i });
    }
  }

  const lightGrid = new Grid<Light>(64);
  for (const l of city.lights) lightGrid.insert(l, l.x - l.r, l.z - l.r, l.x + l.r, l.z + l.r);
  const lampGrid = new Grid<V2>(48);
  for (const p of city.props) {
    if (p.kind !== 'lamp') continue;
    const head = { x: p.x + p.f.x * p.a, z: p.z + p.f.z * p.a };
    lampGrid.insert(head, head.x, head.z, head.x, head.z);
  }

  // ---------- Materials ----------
  const shaderMat = (name: string, vert: string, frag: string, extra: { attributes: string[]; uniforms?: string[]; samplers?: string[] }) => {
    const material = new BABYLON.ShaderMaterial(name, scene, { vertexSource: vert, fragmentSource: frag }, {
      attributes: extra.attributes,
      uniforms: [...SHARED_UNIFORMS, ...(extra.uniforms ?? [])],
      samplers: extra.samplers ?? ['lightMap'],
    });
    material.backFaceCulling = true;
    return material;
  };
  const groundAttrs = ['position', 'normal', 'uv', 'uv2', 'uv3', 'color'];
  const stdAttrs = ['position', 'normal', 'uv', 'uv2', 'color'];
  const groundMat = shaderMat('city-ground', CITY_SHADERS.groundVert, CITY_SHADERS.groundFrag, { attributes: groundAttrs });
  const baseMat = shaderMat('city-base', CITY_SHADERS.groundVert, CITY_SHADERS.groundFrag, { attributes: groundAttrs });
  baseMat.zOffset = 3;
  const facadeMat = shaderMat('city-facade', CITY_SHADERS.facadeVert, CITY_SHADERS.facadeFrag, { attributes: stdAttrs });
  const farMat = shaderMat('city-far', CITY_SHADERS.facadeVert, CITY_SHADERS.facadeFarFrag, { attributes: stdAttrs });
  const propMat = shaderMat('city-props', CITY_SHADERS.propVert, CITY_SHADERS.propFrag, { attributes: stdAttrs });
  const glowMat = new BABYLON.ShaderMaterial('city-glow', scene, { vertexSource: CITY_SHADERS.glowVert, fragmentSource: CITY_SHADERS.glowFrag }, {
    attributes: ['position', 'uv', 'uv2', 'color'],
    uniforms: ['viewProjection', 'view', 'world', 'cameraPos', 'time', 'sig'],
    needAlphaBlending: true,
  });
  glowMat.backFaceCulling = false;
  glowMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
  glowMat.disableDepthWrite = true;
  const glassMat = new BABYLON.StandardMaterial('city-store-glass', scene);
  glassMat.diffuseColor = new BABYLON.Color3(0.2, 0.25, 0.3);
  glassMat.emissiveColor = new BABYLON.Color3(0.05, 0.06, 0.07);
  glassMat.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
  glassMat.alpha = 0.16;
  glassMat.backFaceCulling = false;
  const shaders = [groundMat, baseMat, facadeMat, farMat, propMat];

  // ---------- Light map ----------
  const LM_SIZE = opts.mobile ? 512 : 1024;
  const LM_WORLD = opts.mobile ? 300 : 420;
  const lmTex = new BABYLON.DynamicTexture('city-lightmap', { width: LM_SIZE, height: LM_SIZE }, scene, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE);
  lmTex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
  lmTex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  const lmCtx = lmTex.getContext() as CanvasRenderingContext2D;
  const sprites = LIGHT_COLORS.map(([r, g, b]) => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    const col = (a: number) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
    grad.addColorStop(0, col(0.7));
    grad.addColorStop(0.2, col(0.5));
    grad.addColorStop(0.55, col(0.2));
    grad.addColorStop(1, col(0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    return c;
  });
  const lmOrigin = { x: Number.NaN, z: Number.NaN };
  const paintLightMap = (cx: number, cz: number) => {
    const ox = Math.round((cx - LM_WORLD / 2) / 16) * 16;
    const oz = Math.round((cz - LM_WORLD / 2) / 16) * 16;
    lmOrigin.x = ox;
    lmOrigin.z = oz;
    const ctx = lmCtx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, LM_SIZE, LM_SIZE);
    ctx.globalCompositeOperation = 'lighter';
    const k = LM_SIZE / LM_WORLD;
    for (const l of lightGrid.query(ox, oz, ox + LM_WORLD, oz + LM_WORLD)) {
      const px = (l.x - ox) * k;
      const pz = (l.z - oz) * k;
      const r = l.r * k;
      ctx.globalAlpha = clamp(l.i, 0, 1);
      ctx.drawImage(sprites[l.color] ?? sprites[0], px - r, pz - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    lmTex.update(false);
  };

  // ---------- Uniforms ----------
  const env = {
    fogColor: new BABYLON.Color3(0.032, 0.036, 0.05),
    fogDensity: opts.mobile ? 0.0042 : 0.0034,
    ambient: new BABYLON.Color3(0.12, 0.13, 0.17),
    skyTop: new BABYLON.Color3(0.01, 0.015, 0.035),
    skyHorizon: new BABYLON.Color3(0.1, 0.09, 0.11),
  };
  let clock = 0;
  const signals = (t: number): SignalState => {
    const c = ((t % 30) + 30) % 30;
    let x = 2;
    let z = 2;
    let walkX = 0;
    let walkZ = 0;
    if (c < 12) x = 0;
    else if (c < 15) x = 1;
    if (c >= 16 && c < 27) z = 0;
    else if (c >= 27) z = 1;
    if (c < 8) walkZ = 1;
    else if (c < 12) walkZ = 2;
    if (c >= 16 && c < 23) walkX = 1;
    else if (c >= 23 && c < 27) walkX = 2;
    return { x, z, walkX, walkZ };
  };
  const sigVec = new BABYLON.Vector4();
  const camPos = new BABYLON.Vector3();
  const lmInfo = new BABYLON.Vector3();
  const pushUniforms = () => {
    const camera = scene.activeCamera;
    if (camera) camPos.copyFrom(camera.globalPosition);
    const s = signals(clock);
    sigVec.set(s.x, s.z, s.walkX, s.walkZ);
    lmInfo.set(lmOrigin.x, lmOrigin.z, LM_WORLD);
    for (const m of shaders) {
      m.setVector3('cameraPos', camPos);
      m.setColor3('fogColor', env.fogColor);
      m.setFloat('fogDensity', env.fogDensity);
      m.setVector3('lmInfo', lmInfo);
      m.setColor3('ambient', env.ambient);
      m.setColor3('skyTop', env.skyTop);
      m.setColor3('skyHorizon', env.skyHorizon);
      m.setFloat('time', clock);
      m.setVector4('sig', sigVec);
      m.setTexture('lightMap', lmTex);
    }
    glowMat.setVector3('cameraPos', camPos);
    glowMat.setFloat('time', clock);
    glowMat.setVector4('sig', sigVec);
  };

  // ---------- Queries ----------
  const inRect = (x: number, z: number, r: { minX: number; maxX: number; minZ: number; maxZ: number }) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;

  /** Visual floor height at a point: sidewalk and plaza tops sit on the curb. */
  const lift = (x: number, z: number) => {
    for (const s of city.stores) if (x > s.x0 + 0.3 && x < s.x1 - 0.3 && z > s.z0 + 0.3 && z < s.z1) return 0.16;
    if (inRect(x, z, STATION_PIT)) return 0;
    if (inRect(x, z, LOBBY)) return 0.02;
    for (const b of city.blocks) if (inRect(x, z, b)) return CURB;
    let onWalk = false;
    for (const hit of city.grids.pieces.query(x, z, x, z)) {
      const a = hit.piece.pts[hit.i];
      const b = hit.piece.pts[hit.i + 1];
      const spec = hit.piece.road.spec;
      const d = segDist({ x, z }, a, b).d;
      if (d < spec.half) return 0;
      if (d < spec.half + spec.walk + 0.05) onWalk = true;
    }
    if (onWalk) return CURB;
    for (const j of city.grids.junctions.query(x, z, x, z)) {
      const d = Math.hypot(x - j.x, z - j.z);
      if (j.dead) {
        if (d < j.bulb) return 0;
        if (d < j.bulb + j.arms[0].walk) return CURB;
        continue;
      }
      if (j.radius > 0 && d < j.radius + 6) return CURB;
    }
    return 0;
  };

  /** Push a circle out of buildings and street furniture. */
  const resolve = (x: number, z: number, r: number) => {
    let px = x;
    let pz = z;
    for (let pass = 0; pass < 2; pass += 1) {
      for (const c of city.grids.colliders.query(px - r - 2, pz - r - 2, px + r + 2, pz + r + 2)) {
        if (c.y0 > 2) continue;
        const push = obbPush(c.obb, { x: px, z: pz }, r);
        if (!push) continue;
        px += push.x;
        pz += push.z;
      }
    }
    return { x: px, z: pz };
  };

  /** Random sidewalk spot in a distance ring, preferring outside the camera view. */
  const walkSpot = (x: number, z: number, minD: number, maxD: number, avoid?: { fx: number; fz: number; cos: number }) => {
    const cand: { path: WalkPath; s: number; p: V2 }[] = [];
    for (const hit of city.grids.walks.query(x - maxD, z - maxD, x + maxD, z + maxD)) {
      const a = hit.path.pts[hit.i];
      const b = hit.path.pts[hit.i + 1];
      const t = Math.random();
      const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < minD || d > maxD) continue;
      if (avoid) {
        const dot = ((p.x - x) * avoid.fx + (p.z - z) * avoid.fz) / d;
        if (dot > avoid.cos) continue;
      }
      cand.push({ path: hit.path, s: hit.path.cum[hit.i] + t * Math.hypot(b.x - a.x, b.z - a.z), p });
    }
    if (!cand.length) return null;
    return cand[Math.floor(Math.random() * cand.length)];
  };

  const nearestWalk = (x: number, z: number, radius = 30) => {
    let best: { path: WalkPath; s: number; d: number } | null = null;
    for (const hit of city.grids.walks.query(x - radius, z - radius, x + radius, z + radius)) {
      const a = hit.path.pts[hit.i];
      const b = hit.path.pts[hit.i + 1];
      const sd = segDist({ x, z }, a, b);
      if (!best || sd.d < best.d) best = { path: hit.path, s: hit.path.cum[hit.i] + sd.t * Math.hypot(b.x - a.x, b.z - a.z), d: sd.d };
    }
    return best;
  };

  const nearestLamp = (x: number, z: number) => {
    let best: V2 | null = null;
    let bd = Infinity;
    for (const p of lampGrid.query(x - 30, z - 30, x + 30, z + 30)) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };

  // ---------- Geometry emission ----------
  const setGround = (g: Geo, surf: number, b = 0, c = 0, d = 0) => {
    g.a.c = [surf, b, c, d];
  };

  const emitPieceSeg = (g: Geo, piece: Piece, i: number) => {
    const rb = ribbons.get(piece);
    if (!rb) return;
    const spec = piece.road.spec;
    const s0 = rb.s[i];
    const s1 = rb.s[i + 1];
    const pA = rb.p[i];
    const pB = rb.p[i + 1];
    const tA = rb.t[i];
    const tB = rb.t[i + 1];
    const LA = ccw(tA);
    const LB = ccw(tB);
    const at = (p: V2, L: V2, lat: number): V2 => ({ x: p.x + L.x * lat, z: p.z + L.z * lat });
    const lerpS = (s: number) => {
      const t = (s - s0) / Math.max(1e-6, s1 - s0);
      const p = { x: pA.x + (pB.x - pA.x) * t, z: pA.z + (pB.z - pA.z) * t };
      const L = { x: LA.x + (LB.x - LA.x) * t, z: LA.z + (LB.z - LA.z) * t };
      const l = Math.hypot(L.x, L.z) || 1;
      return { p, L: { x: L.x / l, z: L.z / l } };
    };
    // Road.
    const r0 = piece.cut0;
    const r1 = piece.len - piece.cut1;
    const a = Math.max(s0, r0);
    const b = Math.min(s1, r1);
    if (b - a > 0.02) {
      const A = lerpS(a);
      const B = lerpS(b);
      const half = spec.half;
      const flags = (piece.walk0 ? 1 : 0) + (piece.walk1 ? 2 : 0);
      g.a.u2 = [r1 - r0, flags];
      g.a.u3 = [spec.laneW, spec.median];
      setGround(g, SURF.ROAD, half, spec.lanes, spec.center);
      const v0 = g.vert(at(A.p, A.L, half).x, ROAD_Y, at(A.p, A.L, half).z, 0, 1, 0, half, a - r0);
      const v1 = g.vert(at(A.p, A.L, -half).x, ROAD_Y, at(A.p, A.L, -half).z, 0, 1, 0, -half, a - r0);
      const v2 = g.vert(at(B.p, B.L, -half).x, ROAD_Y, at(B.p, B.L, -half).z, 0, 1, 0, -half, b - r0);
      const v3 = g.vert(at(B.p, B.L, half).x, ROAD_Y, at(B.p, B.L, half).z, 0, 1, 0, half, b - r0);
      g.tri(v0, v1, v2, [0, 1, 0]);
      g.tri(v0, v2, v3, [0, 1, 0]);
      g.a.u2 = [0, 0];
      g.a.u3 = [0, 0];
    }
    // Sidewalks.
    const outsideDowntown = !piece.road.grid;
    for (const side of [1, -1]) {
      const w0 = side > 0 ? piece.side0L : piece.side0R;
      const w1 = piece.len - (side > 0 ? piece.side1L : piece.side1R);
      const sa = Math.max(s0, w0);
      const sb = Math.min(s1, w1);
      if (sb - sa < 0.02) continue;
      const A = lerpS(sa);
      const B = lerpS(sb);
      const inner = spec.half;
      const outer = spec.half + spec.walk;
      const pIA = at(A.p, A.L, inner * side);
      const pOA = at(A.p, A.L, outer * side);
      const pIB = at(B.p, B.L, inner * side);
      const pOB = at(B.p, B.L, outer * side);
      // Holes (station stairs) on axis aligned grid sidewalks.
      if (piece.road.grid) {
        const minX = Math.min(pIA.x, pOA.x, pIB.x, pOB.x);
        const maxX = Math.max(pIA.x, pOA.x, pIB.x, pOB.x);
        const minZ = Math.min(pIA.z, pOA.z, pIB.z, pOB.z);
        const maxZ = Math.max(pIA.z, pOA.z, pIB.z, pOB.z);
        const hit = city.holes.find((h) => minX < h.maxX && maxX > h.minX && minZ < h.maxZ && maxZ > h.minZ);
        if (hit) {
          const parts = [{ minX, maxX, minZ, maxZ }].flatMap((r) => {
            const out: typeof r[] = [];
            if (hit.minX > r.minX) out.push({ ...r, maxX: hit.minX });
            if (hit.maxX < r.maxX) out.push({ ...r, minX: hit.maxX });
            const x0 = Math.max(r.minX, hit.minX);
            const x1 = Math.min(r.maxX, hit.maxX);
            if (hit.minZ > r.minZ) out.push({ minX: x0, maxX: x1, minZ: r.minZ, maxZ: hit.minZ });
            if (hit.maxZ < r.maxZ) out.push({ minX: x0, maxX: x1, minZ: hit.maxZ, maxZ: r.maxZ });
            return out.filter((q) => q.maxX - q.minX > 0.02 && q.maxZ - q.minZ > 0.02);
          });
          setGround(g, SURF.WALK);
          const curbX = Math.abs(tA.x) > 0.5;
          const curbLine = curbX ? pIA.z : pIA.x;
          for (const r of parts) {
            const pts = [{ x: r.minX, z: r.minZ }, { x: r.maxX, z: r.minZ }, { x: r.maxX, z: r.maxZ }, { x: r.minX, z: r.maxZ }];
            g.flat(pts, [0, 1, 2, 0, 2, 3], CURB, (p) => [Math.abs((curbX ? p.z : p.x) - curbLine), curbX ? p.x : p.z]);
          }
          emitCurbFace(g, pIA, pIB, scale2(A.L, -side));
          continue;
        }
      }
      setGround(g, SURF.WALK);
      const i0 = g.vert(pIA.x, CURB, pIA.z, 0, 1, 0, 0, sa);
      const i1 = g.vert(pOA.x, CURB, pOA.z, 0, 1, 0, spec.walk, sa);
      const i2 = g.vert(pOB.x, CURB, pOB.z, 0, 1, 0, spec.walk, sb);
      const i3 = g.vert(pIB.x, CURB, pIB.z, 0, 1, 0, 0, sb);
      g.tri(i0, i1, i2, [0, 1, 0]);
      g.tri(i0, i2, i3, [0, 1, 0]);
      emitCurbFace(g, pIA, pIB, scale2(A.L, -side));
      if (outsideDowntown || !inRect((pOA.x + pOB.x) / 2, (pOA.z + pOB.z) / 2, { minX: DOWNTOWN.minX + 1, maxX: DOWNTOWN.maxX - 1, minZ: DOWNTOWN.minZ + 1, maxZ: DOWNTOWN.maxZ - 1 })) {
        emitCurbFace(g, pOA, pOB, scale2(A.L, side));
      }
    }
  };

  const scale2 = (v: V2, s: number): V2 => ({ x: v.x * s, z: v.z * s });

  const emitCurbFace = (g: Geo, a: V2, b: V2, n: V2) => {
    setGround(g, SURF.CURBFACE);
    const nn: Vec3 = [n.x, 0, n.z];
    g.quad([a.x, 0, a.z], [b.x, 0, b.z], [b.x, CURB, b.z], [a.x, CURB, a.z], nn);
  };

  const emitJunction = (g: Geo, j: Junction) => {
    if (j.patch.length >= 3) {
      setGround(g, SURF.PATCH);
      g.flat(j.patch, earcut(j.patch), ROAD_Y + (j.dead ? 0.004 : 0), (p) => [p.x, p.z]);
    }
    for (const poly of j.corners) {
      if (poly.length < 3) continue;
      setGround(g, SURF.WALK);
      g.flat(poly, earcut(poly), CURB, (p) => [3 + ((p.x * 0.7 + p.z * 0.3) % 50), p.z * 0.7 - p.x * 0.3]);
    }
    const J = { x: j.x, z: j.z };
    for (const line of j.curbs) {
      for (let i = 0; i < line.length - 1; i += 1) {
        const a = line[i];
        const b = line[i + 1];
        const mx = (a.x + b.x) / 2;
        const mz = (a.z + b.z) / 2;
        let n = ccw({ x: b.x - a.x, z: b.z - a.z });
        const l = Math.hypot(n.x, n.z) || 1;
        n = { x: n.x / l, z: n.z / l };
        if (n.x * (J.x - mx) + n.z * (J.z - mz) < 0) n = { x: -n.x, z: -n.z };
        emitCurbFace(g, a, b, n);
      }
    }
    if (!inRect(j.x, j.z, { minX: DOWNTOWN.minX + 1, maxX: DOWNTOWN.maxX - 1, minZ: DOWNTOWN.minZ + 1, maxZ: DOWNTOWN.maxZ - 1 })) {
      for (const line of j.outers) {
        for (let i = 0; i < line.length - 1; i += 1) {
          const a = line[i];
          const b = line[i + 1];
          const mx = (a.x + b.x) / 2;
          const mz = (a.z + b.z) / 2;
          let n = ccw({ x: b.x - a.x, z: b.z - a.z });
          const l = Math.hypot(n.x, n.z) || 1;
          n = { x: n.x / l, z: n.z / l };
          if (n.x * (J.x - mx) + n.z * (J.z - mz) > 0) n = { x: -n.x, z: -n.z };
          emitCurbFace(g, a, b, n);
        }
      }
    }
  };

  const baseGround = (g: Geo, ix: number, iz: number) => {
    const x0 = ix * CHUNK;
    const z0 = iz * CHUNK;
    type R = { minX: number; maxX: number; minZ: number; maxZ: number };
    let rects: R[] = [{ minX: x0, maxX: x0 + CHUNK, minZ: z0, maxZ: z0 + CHUNK }];
    const cut = (hole: R) => {
      rects = rects.flatMap((r) => {
        if (!(r.minX < hole.maxX && r.maxX > hole.minX && r.minZ < hole.maxZ && r.maxZ > hole.minZ)) return [r];
        const out: R[] = [];
        if (hole.minX > r.minX) out.push({ ...r, maxX: hole.minX });
        if (hole.maxX < r.maxX) out.push({ ...r, minX: hole.maxX });
        const a = Math.max(r.minX, hole.minX);
        const b = Math.min(r.maxX, hole.maxX);
        if (hole.minZ > r.minZ) out.push({ minX: a, maxX: b, minZ: r.minZ, maxZ: hole.minZ });
        if (hole.maxZ < r.maxZ) out.push({ minX: a, maxX: b, minZ: hole.maxZ, maxZ: r.maxZ });
        return out.filter((q) => q.maxX - q.minX > 0.05 && q.maxZ - q.minZ > 0.05);
      });
    };
    for (const b of city.blocks) cut(b);
    for (const h of city.holes) cut(h);
    const attr = (x: number, z: number): [number, number] => {
      switch (city.district(x, z)) {
        case 'houses': return [1, 0];
        case 'park': return [1, 0];
        case 'apartments': return [0.65, 0.12];
        case 'midtown': return [0.3, 0.55];
        case 'industrial': return [0.12, 0.75];
        default: return [0, 1];
      }
    };
    for (const r of rects) {
      const nx = Math.max(1, Math.ceil((r.maxX - r.minX) / 20));
      const nz = Math.max(1, Math.ceil((r.maxZ - r.minZ) / 20));
      const ids: number[][] = [];
      for (let i = 0; i <= nx; i += 1) {
        ids.push([]);
        for (let k = 0; k <= nz; k += 1) {
          const x = r.minX + ((r.maxX - r.minX) * i) / nx;
          const z = r.minZ + ((r.maxZ - r.minZ) * k) / nz;
          const [grass, lot] = attr(x, z);
          g.a.c = [SURF.BASE, grass, lot, 0];
          ids[i].push(g.vert(x, 0, z, 0, 1, 0, x, z));
        }
      }
      for (let i = 0; i < nx; i += 1) {
        for (let k = 0; k < nz; k += 1) {
          g.tri(ids[i][k], ids[i + 1][k], ids[i + 1][k + 1], [0, 1, 0]);
          g.tri(ids[i][k], ids[i + 1][k + 1], ids[i][k + 1], [0, 1, 0]);
        }
      }
    }
  };

  // ---------- Facades ----------
  const faceSet = (b: Building) => (b.lit * 0.9);

  const emitWall = (
    g: Geo, b: Building, a: Vec3, c: Vec3, y0: number, y1: number, n: Vec3, width: number, gfh: number, kind: number,
  ) => {
    const nb = Math.max(1, Math.round(width / b.bay));
    const bw = width / nb;
    g.a.u2 = [b.seed, b.style + faceSet(b)];
    g.a.c = [b.floorH, bw, kind === 4 ? nb : gfh, kind];
    g.quad([a[0], y0, a[2]], [c[0], y0, c[2]], [c[0], y1, c[2]], [a[0], y1, a[2]], n, [[0, y0], [nb, y0], [nb, y1], [0, y1]]);
  };

  const emitMass = (g: Geo, b: Building, m: Mass) => {
    const o = m.obb;
    const ax = o.ax;
    const bz = ccw(ax);
    const corner = (sx: number, sz: number): Vec3 => [o.x + ax.x * o.hw * sx + bz.x * o.hd * sz, 0, o.z + ax.z * o.hw * sx + bz.z * o.hd * sz];
    // Faces seen from outside, left to right: +x face goes from (1,-1) to (1,1)? Viewer outside looking -x sees +z on the left.
    const faces: { a: Vec3; c: Vec3; n: Vec3; w: number; bit: number }[] = [
      { a: corner(1, 1), c: corner(1, -1), n: [ax.x, 0, ax.z], w: o.hd * 2, bit: 1 },
      { a: corner(-1, 1), c: corner(1, 1), n: [bz.x, 0, bz.z], w: o.hw * 2, bit: 2 },
      { a: corner(-1, -1), c: corner(-1, 1), n: [-ax.x, 0, -ax.z], w: o.hd * 2, bit: 4 },
      { a: corner(1, -1), c: corner(-1, -1), n: [-bz.x, 0, -bz.z], w: o.hw * 2, bit: 8 },
    ];
    const houseLike = b.style === STYLE.SIDING || b.style === STYLE.STUCCO || b.style === STYLE.WAREHOUSE;
    for (const f of faces) {
      const street = (m.street & f.bit) !== 0;
      const kind = street && houseLike && m.y0 < 0.5 ? 4 : 0;
      emitWall(g, b, f.a, f.c, m.y0, m.y1, f.n, f.w, street && !houseLike ? m.gfh : 0, kind);
    }
    if (m.roof === 1) {
      // Gable along local x. Ends on the ±x faces, slopes toward ±z.
      const over = 0.45;
      const eave = m.y1;
      const ridge = m.ridge;
      const rise = ridge - eave;
      g.a.u2 = [b.seed, b.style + faceSet(b)];
      g.a.c = [b.floorH, b.bay, 0, 0];
      for (const sx of [1, -1]) {
        const p0 = corner(sx, -1);
        const p1 = corner(sx, 1);
        const top: Vec3 = [o.x + ax.x * o.hw * sx, ridge, o.z + ax.z * o.hw * sx];
        const n: Vec3 = [ax.x * sx, 0, ax.z * sx];
        const i0 = g.vert(p0[0], eave, p0[2], n[0], 0, n[2], 0, eave);
        const i1 = g.vert(p1[0], eave, p1[2], n[0], 0, n[2], 1, eave);
        const i2 = g.vert(top[0], top[1], top[2], n[0], 0, n[2], 0.5, ridge);
        g.tri(i0, i1, i2, n);
      }
      g.a.c = [b.floorH, b.bay, 0, 3];
      const slopeLen = Math.hypot(o.hd + over, rise + over * (rise / Math.max(o.hd, 0.1)));
      for (const sz of [1, -1]) {
        const e0: Vec3 = [o.x + ax.x * (o.hw + over) * -1 + bz.x * (o.hd + over) * sz, eave - over * (rise / Math.max(o.hd, 0.1)), o.z + ax.z * -(o.hw + over) + bz.z * (o.hd + over) * sz];
        const e1: Vec3 = [o.x + ax.x * (o.hw + over) + bz.x * (o.hd + over) * sz, e0[1], o.z + ax.z * (o.hw + over) + bz.z * (o.hd + over) * sz];
        const r1: Vec3 = [o.x + ax.x * (o.hw + over), ridge, o.z + ax.z * (o.hw + over)];
        const r0: Vec3 = [o.x - ax.x * (o.hw + over), ridge, o.z - ax.z * (o.hw + over)];
        const ny = (o.hd + over);
        const nh = rise + over * (rise / Math.max(o.hd, 0.1));
        const len = Math.hypot(ny, nh) || 1;
        const n: Vec3 = [bz.x * sz * (nh / len), ny / len, bz.z * sz * (nh / len)];
        const L = (o.hw + over) * 2;
        g.quad(e0, e1, r1, r0, n, [[0, 0], [L, 0], [L, slopeLen], [0, slopeLen]]);
        // Underside so the overhang is not see-through.
        g.quad(e0, r0, r1, e1, [-n[0], -n[1], -n[2]], [[0, 0], [0, 1], [1, 1], [1, 0]]);
      }
      return;
    }
    // Flat roof, parapet.
    g.a.u2 = [b.seed, b.style + faceSet(b)];
    g.a.c = [b.floorH, b.bay, 0, 1];
    const t = (sx: number, sz: number, y: number): Vec3 => {
      const c = corner(sx, sz);
      return [c[0], y, c[2]];
    };
    g.quad(t(-1, -1, m.y1), t(1, -1, m.y1), t(1, 1, m.y1), t(-1, 1, m.y1), [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    if (b.style === STYLE.SIDING) return;
    const ph = b.height > 40 ? 1.2 : 0.85;
    const inset = 0.28;
    g.a.c = [b.floorH, b.bay, 0, 2];
    const top = m.y1 + ph;
    for (const f of faces) {
      g.quad([f.a[0], m.y1, f.a[2]], [f.c[0], m.y1, f.c[2]], [f.c[0], top, f.c[2]], [f.a[0], top, f.a[2]], f.n, [[0, 0], [1, 0], [1, ph], [0, ph]]);
      const ia: Vec3 = [f.a[0] - f.n[0] * inset, 0, f.a[2] - f.n[2] * inset];
      const ic: Vec3 = [f.c[0] - f.n[0] * inset, 0, f.c[2] - f.n[2] * inset];
      g.quad([ia[0], m.y1, ia[2]], [ic[0], m.y1, ic[2]], [ic[0], top, ic[2]], [ia[0], top, ia[2]], [-f.n[0], 0, -f.n[2]], [[0, 0], [1, 0], [1, ph], [0, ph]]);
      g.quad([f.a[0], top, f.a[2]], [f.c[0], top, f.c[2]], [ic[0], top, ic[2]], [ia[0], top, ia[2]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  };

  const emitBuilding = (g: Geo, b: Building) => {
    for (const m of b.masses) emitMass(g, b, m);
  };

  const emitFar = (g: Geo, b: Building) => {
    const base = b.masses[0];
    const o = base.obb;
    const ax = o.ax;
    const bz = ccw(ax);
    const corner = (sx: number, sz: number): Vec3 => [o.x + ax.x * o.hw * sx + bz.x * o.hd * sz, 0, o.z + ax.z * o.hw * sx + bz.z * o.hd * sz];
    const faces: { a: Vec3; c: Vec3; n: Vec3; w: number }[] = [
      { a: corner(1, 1), c: corner(1, -1), n: [ax.x, 0, ax.z], w: o.hd * 2 },
      { a: corner(-1, 1), c: corner(1, 1), n: [bz.x, 0, bz.z], w: o.hw * 2 },
      { a: corner(-1, -1), c: corner(-1, 1), n: [-ax.x, 0, -ax.z], w: o.hd * 2 },
      { a: corner(1, -1), c: corner(-1, -1), n: [-bz.x, 0, -bz.z], w: o.hw * 2 },
    ];
    const top = b.masses.reduce((h, m) => Math.max(h, m.y1), 0);
    for (const f of faces) emitWall(g, b, f.a, f.c, 0, top * 0.97, f.n, f.w, 0, 0);
    g.a.c = [b.floorH, b.bay, 0, 1];
    g.quad([corner(-1, -1)[0], top * 0.97, corner(-1, -1)[2]], [corner(1, -1)[0], top * 0.97, corner(1, -1)[2]], [corner(1, 1)[0], top * 0.97, corner(1, 1)[2]], [corner(-1, 1)[0], top * 0.97, corner(-1, 1)[2]], [0, 1, 0]);
  };

  // ---------- Props ----------
  const P = {
    c(g: Geo, r: number, gg: number, b: number, e = 0, mode = 0, param = 0, sway = 0) {
      g.a.c = [r, gg, b, e];
      g.fixedUv = [mode, param];
      g.a.u2 = [sway, 0];
    },
  };
  const glowAt = (gl: Geo, x: number, y: number, z: number, color: Vec3, size: number, intensity: number, mode = 0, param = 0) => {
    gl.a.u2 = [size, mode * 64 + param];
    gl.a.c = [color[0], color[1], color[2], intensity];
    const ids = [
      gl.vert(x, y, z, 0, 1, 0, -1, -1),
      gl.vert(x, y, z, 0, 1, 0, 1, -1),
      gl.vert(x, y, z, 0, 1, 0, 1, 1),
      gl.vert(x, y, z, 0, 1, 0, -1, 1),
    ];
    gl.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  };

  const propBase = (p: Prop) => (p.y > 0 ? p.y : lift(p.x, p.z));

  const emitProp = (g: Geo, gl: Geo, p: Prop) => {
    const y = propBase(p);
    const f = p.f;
    const side = { x: -f.z, z: f.x };
    switch (p.kind) {
      case 'lamp': {
        const style = p.b;
        if (style === 2) {
          P.c(g, 0.05, 0.07, 0.06);
          g.cyl(p.x, y, p.z, 0.13, 0.09, 0.5, 6);
          g.cyl(p.x, y + 0.5, p.z, 0.065, 0.055, 3.5, 6, false);
          P.c(g, 1.0, 0.82, 0.55, 2.6, 1);
          g.cyl(p.x, y + 4.0, p.z, 0.16, 0.22, 0.55, 6, false);
          P.c(g, 0.05, 0.07, 0.06);
          g.cyl(p.x, y + 4.55, p.z, 0.26, 0.02, 0.32, 6);
          glowAt(gl, p.x, y + 4.28, p.z, [1.0, 0.8, 0.5], 1.4, 0.85);
          break;
        }
        const h = style === 0 ? 7.6 : 8.2;
        const arm = p.a;
        P.c(g, 0.1, 0.105, 0.11);
        g.cyl(p.x, y, p.z, 0.17, 0.14, 0.55, 6);
        g.cyl(p.x, y + 0.55, p.z, 0.09, 0.065, h - 0.55, 6, false);
        const hx = p.x + f.x * arm;
        const hz = p.z + f.z * arm;
        g.box((p.x + hx) / 2, y + h - 0.12, (p.z + hz) / 2, arm / 2 + 0.05, 0.08, 0.05, f, 0b111111);
        if (style === 0) {
          g.box(hx, y + h - 0.2, hz, 0.42, 0.1, 0.17, f, 0b011111);
          P.c(g, 1.0, 0.96, 0.88, 3.2, 1);
          g.quad([hx - f.x * 0.36 - side.x * 0.13, y + h - 0.205, hz - f.z * 0.36 - side.z * 0.13], [hx + f.x * 0.36 - side.x * 0.13, y + h - 0.205, hz + f.z * 0.36 - side.z * 0.13], [hx + f.x * 0.36 + side.x * 0.13, y + h - 0.205, hz + f.z * 0.36 + side.z * 0.13], [hx - f.x * 0.36 + side.x * 0.13, y + h - 0.205, hz - f.z * 0.36 + side.z * 0.13], [0, -1, 0]);
          glowAt(gl, hx, y + h - 0.32, hz, [1.0, 0.94, 0.84], 1.5, 0.85);
        } else {
          g.box(hx, y + h - 0.28, hz, 0.5, 0.18, 0.2, f, 0b011111);
          P.c(g, 1.0, 0.66, 0.3, 3.0, 1);
          g.blob(hx, y + h - 0.32, hz, 0.42, 0.08, 0.16);
          glowAt(gl, hx, y + h - 0.42, hz, [1.0, 0.62, 0.28], 1.6, 0.85);
        }
        break;
      }
      case 'signal': {
        const g0 = p.g ?? { x: 1, z: 0 };
        const group = p.b;
        P.c(g, 0.12, 0.12, 0.11);
        g.cyl(p.x, y, p.z, 0.15, 0.13, 0.4, 6);
        g.cyl(p.x, y + 0.4, p.z, 0.11, 0.09, 5.9, 6);
        const mx = p.x + f.x * p.a;
        const mz = p.z + f.z * p.a;
        g.box((p.x + mx) / 2, y + 6.0, (p.z + mz) / 2, p.a / 2, 0.14, 0.07, f, 0b111111);
        const head = (x: number, hy: number, z: number) => {
          P.c(g, 0.32, 0.27, 0.06);
          g.box(x, hy - 0.55, z, 0.18, 1.1, 0.16, { x: -g0.z, z: g0.x }, 0b111111);
          const lens: [Vec3, number][] = [[[1.0, 0.12, 0.06], 0], [[1.0, 0.6, 0.05], 1], [[0.15, 1.0, 0.55], 2]];
          lens.forEach(([col, lamp], k) => {
            const ly = hy - 0.2 - k * 0.35;
            const cx = x + g0.x * 0.165;
            const cz = z + g0.z * 0.165;
            const s2 = { x: -g0.z, z: g0.x };
            P.c(g, col[0], col[1], col[2], 0, 2, group * 8 + lamp);
            g.quad([cx - s2.x * 0.12, ly - 0.12, cz - s2.z * 0.12], [cx + s2.x * 0.12, ly - 0.12, cz + s2.z * 0.12], [cx + s2.x * 0.12, ly + 0.12, cz + s2.z * 0.12], [cx - s2.x * 0.12, ly + 0.12, cz - s2.z * 0.12], [g0.x, 0, g0.z]);
            glowAt(gl, cx + g0.x * 0.05, ly, cz + g0.z * 0.05, col, 0.55, 0.9, 2, group * 8 + lamp);
          });
        };
        head(mx, y + 5.95, mz);
        head(p.x + g0.x * 0.25, y + 3.6, p.z + g0.z * 0.25);
        // Pedestrian head faces across the road.
        const px = p.x + f.x * 0.22;
        const pz = p.z + f.z * 0.22;
        P.c(g, 0.1, 0.1, 0.1);
        g.box(px, y + 2.4, pz, 0.17, 0.62, 0.12, side, 0b111111);
        const pedLens: [Vec3, number][] = [[[1.0, 0.45, 0.1], 4], [[0.85, 0.95, 1.0], 3]];
        pedLens.forEach(([col, lamp], k) => {
          const ly = y + 2.86 - k * 0.27;
          const cx = px + f.x * 0.125;
          const cz = pz + f.z * 0.125;
          P.c(g, col[0], col[1], col[2], 0, 2, group * 8 + lamp);
          g.quad([cx - side.x * 0.11, ly - 0.11, cz - side.z * 0.11], [cx + side.x * 0.11, ly - 0.11, cz + side.z * 0.11], [cx + side.x * 0.11, ly + 0.11, cz + side.z * 0.11], [cx - side.x * 0.11, ly + 0.11, cz - side.z * 0.11], [f.x, 0, f.z]);
          glowAt(gl, cx + f.x * 0.04, ly, cz + f.z * 0.04, col, 0.4, 0.75, 2, group * 8 + lamp);
        });
        break;
      }
      case 'sign': {
        P.c(g, 0.04, 0.32, 0.14);
        g.box(p.x + f.x * 0.55, y + 4.4, p.z + f.z * 0.55, 0.6, 0.22, 0.015, f, 0b111111);
        P.c(g, 0.04, 0.32, 0.14);
        g.box(p.x + side.x * 0.55, y + 4.7, p.z + side.z * 0.55, 0.6, 0.22, 0.015, side, 0b111111);
        break;
      }
      case 'hydrant': {
        const yellow = (Math.abs(Math.floor(p.x * 3 + p.z * 7)) % 3) === 0;
        if (yellow) P.c(g, 0.62, 0.48, 0.05);
        else P.c(g, 0.5, 0.05, 0.035);
        g.cyl(p.x, y, p.z, 0.17, 0.15, 0.12, 8);
        g.cyl(p.x, y + 0.12, p.z, 0.12, 0.12, 0.5, 8, false);
        g.blob(p.x, y + 0.64, p.z, 0.13, 0.1, 0.13);
        g.hcyl(p.x, y + 0.45, p.z, side, 0.055, 0.38, 6);
        g.hcyl(p.x + f.x * 0.12, y + 0.42, p.z + f.z * 0.12, f, 0.07, 0.12, 6);
        break;
      }
      case 'bin': {
        if (p.b === 0) P.c(g, 0.04, 0.09, 0.06);
        else P.c(g, 0.05, 0.05, 0.055);
        g.cyl(p.x, y, p.z, 0.29, 0.32, 0.92, 10);
        P.c(g, 0.03, 0.03, 0.03);
        g.cyl(p.x, y + 0.92, p.z, 0.33, 0.3, 0.08, 10);
        break;
      }
      case 'bench': {
        const ax = side;
        P.c(g, 0.3, 0.17, 0.08);
        for (let k = 0; k < 3; k += 1) g.box(p.x - f.x * (0.1 * k - 0.05), y + 0.44, p.z - f.z * (0.1 * k - 0.05), 0.9, 0.04, 0.045, ax, 0b011111);
        for (let k = 0; k < 2; k += 1) g.box(p.x - f.x * 0.26, y + 0.62 + k * 0.16, p.z - f.z * 0.26, 0.9, 0.08, 0.025, ax, 0b111111);
        P.c(g, 0.06, 0.06, 0.065);
        for (const s of [-0.75, 0.75]) g.box(p.x + ax.x * s, y, p.z + ax.z * s, 0.04, 0.44, 0.2, ax, 0b111111);
        break;
      }
      case 'tree': {
        const sz = p.a || 1;
        P.c(g, 0.14, 0.09, 0.06);
        g.cyl(p.x, y, p.z, 0.16 * sz, 0.1 * sz, 2.6 * sz, 6, false);
        const tints: Vec3[] = [[0.1, 0.19, 0.07], [0.08, 0.17, 0.06], [0.18, 0.2, 0.07]];
        const tint = tints[p.b] ?? tints[0];
        const salt = Math.floor(Math.abs(p.x * 13.1 + p.z * 7.7));
        P.c(g, tint[0], tint[1], tint[2], 0, 5, 0, 1);
        g.blob(p.x, y + 3.6 * sz, p.z, 2.0 * sz, 1.55 * sz, 2.0 * sz, 0.35, salt);
        g.blob(p.x + 0.7 * sz, y + 4.6 * sz, p.z - 0.4 * sz, 1.4 * sz, 1.2 * sz, 1.4 * sz, 0.35, salt + 1);
        g.blob(p.x - 0.6 * sz, y + 4.3 * sz, p.z + 0.6 * sz, 1.3 * sz, 1.1 * sz, 1.3 * sz, 0.35, salt + 2);
        break;
      }
      case 'grate': {
        P.c(g, 0.05, 0.045, 0.04);
        g.box(p.x, y + 0.004, p.z, 0.65, 0.012, 0.65, { x: 1, z: 0 }, 0b010000);
        break;
      }
      case 'newsbox': {
        const cols: Vec3[] = [[0.5, 0.05, 0.04], [0.05, 0.12, 0.4], [0.6, 0.5, 0.05], [0.06, 0.3, 0.12], [0.6, 0.6, 0.58]];
        const c = cols[p.b] ?? cols[0];
        P.c(g, c[0], c[1], c[2]);
        g.box(p.x, y + 0.3, p.z, 0.26, 0.75, 0.22, side, 0b111111);
        g.box(p.x, y, p.z, 0.04, 0.3, 0.04, side, 0b111111);
        P.c(g, 0.2, 0.22, 0.25, 0, 4);
        g.box(p.x + f.x * 0.225, y + 0.75, p.z + f.z * 0.225, 0.2, 0.22, 0.005, side, 0b0010);
        break;
      }
      case 'busstop': {
        const ax = side;
        const back = { x: p.x - f.x * 0.75, z: p.z - f.z * 0.75 };
        P.c(g, 0.14, 0.15, 0.16);
        for (const s of [-1.85, 1.85]) {
          g.box(back.x + ax.x * s, y, back.z + ax.z * s, 0.05, 2.5, 0.05, ax, 0b111111);
          g.box(back.x + ax.x * s + f.x * 1.3, y, back.z + ax.z * s + f.z * 1.3, 0.05, 2.5, 0.05, ax, 0b111111);
        }
        g.box(back.x + f.x * 0.65, y + 2.5, back.z + f.z * 0.65, 1.95, 0.1, 0.8, ax, 0b111111);
        P.c(g, 0.12, 0.14, 0.16, 0, 4);
        g.box(back.x, y + 0.2, back.z, 1.85, 2.2, 0.02, ax, 0b001010);
        const ad = ADS[Math.abs(Math.floor(p.x + p.z)) % ADS.length];
        P.c(g, ad[0], ad[1], ad[2], 1.5, 1);
        g.box(back.x + ax.x * 1.85 + f.x * 0.65, y + 0.4, back.z + ax.z * 1.85 + f.z * 0.65, 0.03, 1.8, 0.6, ax, 0b111111);
        glowAt(gl, back.x + ax.x * 1.85 + f.x * 0.65, y + 1.3, back.z + ax.z * 1.85 + f.z * 0.65, ad, 2.0, 0.28);
        P.c(g, 0.1, 0.1, 0.11);
        g.box(back.x + f.x * 0.3, y + 0.45, back.z + f.z * 0.3, 1.2, 0.05, 0.2, ax, 0b111111);
        break;
      }
      case 'meter': {
        P.c(g, 0.12, 0.12, 0.13);
        g.cyl(p.x, y, p.z, 0.035, 0.035, 1.05, 5, false);
        P.c(g, 0.32, 0.33, 0.35);
        g.box(p.x, y + 1.05, p.z, 0.08, 0.26, 0.07, side, 0b111111);
        break;
      }
      case 'bollard': {
        P.c(g, 0.08, 0.08, 0.085);
        g.cyl(p.x, y, p.z, 0.12, 0.11, 0.95, 8);
        P.c(g, 0.9, 0.85, 0.7, 0.35, 1);
        g.cyl(p.x, y + 0.78, p.z, 0.115, 0.115, 0.05, 8, false);
        break;
      }
      case 'mailbox': {
        P.c(g, 0.18, 0.12, 0.08);
        g.box(p.x, y, p.z, 0.04, 1.0, 0.04, side, 0b111111);
        P.c(g, 0.05, 0.05, 0.055);
        g.box(p.x, y + 1.0, p.z, 0.11, 0.22, 0.24, f, 0b111111);
        break;
      }
      case 'car': {
        emitCar(g, p.x, y, p.z, f, CAR_COLORS[p.a % CAR_COLORS.length]);
        break;
      }
      case 'globe': {
        P.c(g, 0.05, 0.1, 0.06);
        g.cyl(p.x, y, p.z, 0.08, 0.06, 2.7, 6);
        P.c(g, 0.3, 1.0, 0.45, 2.0, 1);
        g.blob(p.x, y + 2.95, p.z, 0.3, 0.3, 0.3);
        glowAt(gl, p.x, y + 2.95, p.z, [0.35, 1.0, 0.45], 1.6, 0.9);
        break;
      }
      case 'fountain': {
        const r = p.a;
        P.c(g, 0.32, 0.31, 0.29);
        g.cyl(p.x, y, p.z, r, r, 0.6, 24, false);
        g.cyl(p.x, y + 0.6, p.z, r, r - 0.3, 0.05, 24, false);
        P.c(g, 0.1, 0.25, 0.3, 0, 7);
        g.cyl(p.x, y, p.z, r - 0.3, r - 0.3, 0.45, 24, true);
        P.c(g, 0.32, 0.31, 0.29);
        g.cyl(p.x, y + 0.45, p.z, 1.0, 0.7, 1.3, 12);
        g.cyl(p.x, y + 1.75, p.z, 0.4, 1.4, 0.3, 12);
        P.c(g, 0.6, 0.9, 1.0, 1.1, 1);
        g.cyl(p.x, y + 2.05, p.z, 0.08, 0.02, 1.8, 6, false);
        glowAt(gl, p.x, y + 2.6, p.z, [0.45, 0.85, 1.0], 3.6, 0.35);
        break;
      }
      case 'planter': {
        const w = p.a || 2.4;
        P.c(g, 0.3, 0.29, 0.27);
        g.box(p.x, y, p.z, w / 2, 0.7, 0.5, side, 0b111111);
        P.c(g, 0.05, 0.11, 0.04, 0, 5, 0, 0.4);
        for (let k = 0; k < 3; k += 1) g.blob(p.x + side.x * (k - 1) * w * 0.3, y + 0.95, p.z + side.z * (k - 1) * w * 0.3, 0.5, 0.42, 0.45, 0.4, k);
        break;
      }
      case 'dumpster': {
        P.c(g, 0.06, 0.16, 0.1);
        g.box(p.x, y, p.z, 1.0, 1.25, 0.7, side, 0b111111);
        P.c(g, 0.03, 0.04, 0.035);
        g.box(p.x, y + 1.25, p.z, 1.02, 0.06, 0.72, side, 0b111111);
        break;
      }
      case 'blade': {
        const g0 = p.g ?? side;
        const h = p.c;
        const color = NEON[p.b] ?? NEON[5];
        const cx = p.x + f.x * 0.55;
        const cz = p.z + f.z * 0.55;
        P.c(g, 0.05, 0.05, 0.055);
        g.box(cx, y + p.a - h / 2 - 0.05, cz, 0.05, h + 0.1, 0.52, g0, 0b111111);
        P.c(g, color[0], color[1], color[2], 2.4, 6, p.b * 3 + p.x * 0.1);
        g.box(cx, y + p.a - h / 2, cz, 0.1, h, 0.45, g0, 0b000101);
        glowAt(gl, cx + f.x * 0.3, y + p.a, cz + f.z * 0.3, color, 2.2, 0.38);
        break;
      }
      case 'billboard': {
        const w = p.a;
        const ad = ADS[p.b % ADS.length];
        P.c(g, 0.1, 0.1, 0.11);
        for (const s of [-0.4, 0.4]) g.box(p.x + side.x * w * s, y, p.z + side.z * w * s, 0.08, 2.2, 0.08, side, 0b111111);
        g.box(p.x - f.x * 0.06, y + 2.2, p.z - f.z * 0.06, w / 2, w * 0.42, 0.05, side, 0b111111);
        P.c(g, ad[0], ad[1], ad[2], 1.3, 1);
        g.box(p.x + f.x * 0.01, y + 2.3, p.z + f.z * 0.01, w / 2 - 0.15, w * 0.42 - 0.2, 0.01, side, 0b0010);
        glowAt(gl, p.x + f.x * 0.6, y + 2.2 + w * 0.21, p.z + f.z * 0.6, ad, w * 0.45, 0.12);
        break;
      }
      case 'awning': {
        const g0 = p.g ?? side;
        const w = p.a;
        const c = AWNINGS[p.b % AWNINGS.length];
        P.c(g, c[0], c[1], c[2]);
        const out = 1.5;
        const y0 = y + 3.5;
        const y1 = y + 2.95;
        const a0: Vec3 = [p.x - g0.x * w / 2, y0, p.z - g0.z * w / 2];
        const a1: Vec3 = [p.x + g0.x * w / 2, y0, p.z + g0.z * w / 2];
        const b1: Vec3 = [p.x + g0.x * w / 2 + f.x * out, y1, p.z + g0.z * w / 2 + f.z * out];
        const b0: Vec3 = [p.x - g0.x * w / 2 + f.x * out, y1, p.z - g0.z * w / 2 + f.z * out];
        const nl = Math.hypot(out, y0 - y1);
        g.quad(a0, a1, b1, b0, [f.x * (y0 - y1) / nl, out / nl, f.z * (y0 - y1) / nl]);
        g.quad(a0, b0, b1, a1, [-f.x * (y0 - y1) / nl, -out / nl, -f.z * (y0 - y1) / nl]);
        g.quad(b0, b1, [b1[0], y1 - 0.3, b1[2]], [b0[0], y1 - 0.3, b0[2]], [f.x, 0, f.z]);
        if (p.c === 1) glowAt(gl, p.x + f.x * 1.2, y1 - 0.2, p.z + f.z * 1.2, [1.0, 0.85, 0.6], 2.6, 0.3);
        break;
      }
      case 'tank': {
        P.c(g, 0.12, 0.1, 0.09);
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.box(p.x + sx * 0.9, y, p.z + sz * 0.9, 0.06, 2.1, 0.06, { x: 1, z: 0 }, 0b111111);
        P.c(g, 0.24, 0.16, 0.1);
        g.cyl(p.x, y + 2.1, p.z, p.a, p.a, 2.6, 10, false);
        P.c(g, 0.1, 0.09, 0.08);
        g.cyl(p.x, y + 4.7, p.z, p.a + 0.1, 0.05, 1.0, 10, false);
        break;
      }
      case 'hvac': {
        P.c(g, 0.24, 0.24, 0.25);
        g.box(p.x, y, p.z, p.a / 2, p.b, p.c / 2, f, 0b011111);
        P.c(g, 0.06, 0.06, 0.065);
        g.cyl(p.x, y + p.b, p.z, Math.min(p.a, p.c) * 0.3, Math.min(p.a, p.c) * 0.3, 0.1, 8);
        break;
      }
      case 'antenna': {
        P.c(g, 0.14, 0.14, 0.15);
        g.cyl(p.x, y, p.z, 0.22, 0.05, p.a, 6, false);
        P.c(g, 1.0, 0.1, 0.05, 0, 3, (p.x * 0.37) % 1);
        g.blob(p.x, y + p.a + 0.15, p.z, 0.15, 0.15, 0.15);
        glowAt(gl, p.x, y + p.a + 0.15, p.z, [1.0, 0.12, 0.05], 2.4, 0.9, 3, Math.floor(((p.x * 0.37) % 1) * 63));
        if (p.b === 1) {
          P.c(g, 0.3, 0.8, 1.0, 2.2, 1);
          g.cyl(p.x, y + 0.2, p.z, 0.24, 0.2, 0.3, 8, false);
        }
        break;
      }
      default:
        break;
    }
    g.fixedUv = null;
    g.a.u2 = [0, 0];
  };

  const emitCar = (g: Geo, x: number, y: number, z: number, f: V2, color: Vec3) => {
    const side = { x: -f.z, z: f.x };
    P.c(g, color[0], color[1], color[2]);
    g.box(x, y + 0.3, z, 2.2, 0.62, 0.9, f, 0b011111);
    P.c(g, color[0] * 0.95, color[1] * 0.95, color[2] * 0.95);
    g.box(x - f.x * 0.25, y + 0.92, z - f.z * 0.25, 1.15, 0.5, 0.78, f, 0b010000);
    P.c(g, 0.08, 0.1, 0.12, 0, 4);
    g.box(x - f.x * 0.25, y + 0.92, z - f.z * 0.25, 1.15, 0.5, 0.78, f, 0b001111);
    P.c(g, 0.025, 0.025, 0.028);
    for (const sx of [-1.35, 1.35]) {
      for (const sz of [-0.82, 0.82]) {
        g.hcyl(x + f.x * sx + side.x * sz, y + 0.34, z + f.z * sx + side.z * sz, side, 0.33, 0.22, 8);
      }
    }
    P.c(g, 0.8, 0.8, 0.75, 0.2, 1);
    for (const s of [-0.62, 0.62]) g.box(x + f.x * 2.205 + side.x * s, y + 0.62, z + f.z * 2.205 + side.z * s, 0.005, 0.1, 0.17, f, 0b000001);
    P.c(g, 0.6, 0.04, 0.03, 0.3, 1);
    for (const s of [-0.65, 0.65]) g.box(x - f.x * 2.205 + side.x * s, y + 0.66, z - f.z * 2.205 + side.z * s, 0.005, 0.09, 0.18, f, 0b000100);
  };

  // ---------- Stores ----------
  const storeSignTex = new Map<string, BABYLON.DynamicTexture>();
  const signTexture = (store: Store) => {
    const hit = storeSignTex.get(store.id);
    if (hit) return hit;
    const tex = new BABYLON.DynamicTexture(`city-sign-${store.id}`, { width: 512, height: 128 }, scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, 512, 128);
    const [r, g, b] = store.tint;
    const css = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    ctx.font = 'bold 84px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = css;
    ctx.shadowBlur = 28;
    ctx.fillStyle = css;
    ctx.fillText(store.name, 256, 68);
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 0.55;
    ctx.fillText(store.name, 256, 68);
    tex.update();
    storeSignTex.set(store.id, tex);
    return tex;
  };

  const emitStore = (g: Geo, ground: Geo, gl: Geo, coll: CollisionGeo, store: Store, extras: BABYLON.Mesh[]) => {
    const { x0, x1, z0, z1, doorX } = store;
    const H = 4.4;
    const wallC: Vec3 = store.id === 'diner' ? [0.55, 0.5, 0.42] : store.id === 'market' ? [0.48, 0.5, 0.44] : [0.5, 0.45, 0.4];
    const ax = { x: 1, z: 0 };
    const t = 0.25;
    // Floor.
    ground.a.c = [SURF.TILE, store.id === 'diner' ? 1 : 0, 0, 0];
    ground.flat([{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], [0, 1, 2, 0, 2, 3], 0.16, (p) => [p.x, p.z]);
    // Walls.
    P.c(g, wallC[0], wallC[1], wallC[2], 0.55, 1);
    g.box((x0 + x1) / 2, 0, z0 + t / 2, (x1 - x0) / 2, H, t / 2, ax, 0b111111);
    g.box(x0 + t / 2, 0, (z0 + z1) / 2, t / 2, H, (z1 - z0) / 2, ax, 0b111111);
    g.box(x1 - t / 2, 0, (z0 + z1) / 2, t / 2, H, (z1 - z0) / 2, ax, 0b111111);
    // Ceiling and light panels.
    P.c(g, 0.75, 0.74, 0.7, 0.85, 1);
    g.box((x0 + x1) / 2, H - 0.3, (z0 + z1) / 2, (x1 - x0) / 2, 0.3, (z1 - z0) / 2, ax, 0b111111);
    P.c(g, 1.0, 0.97, 0.9, 2.4, 1);
    for (let z = z0 + 2; z < z1 - 1; z += 3) g.box((x0 + x1) / 2, H - 0.32, z, (x1 - x0) * 0.3, 0.02, 0.3, ax, 0b100000);
    // Front: piers, bulkheads, transom, door gap.
    const brick: Vec3 = [0.3, 0.12, 0.08];
    P.c(g, brick[0], brick[1], brick[2]);
    const front = z1 - t / 2;
    g.box(x0 + 0.3, 0, front, 0.3, H, t / 2, ax, 0b111111);
    g.box(x1 - 0.3, 0, front, 0.3, H, t / 2, ax, 0b111111);
    P.c(g, 0.08, 0.08, 0.09);
    g.box((x0 + x1) / 2, 3.2, front, (x1 - x0) / 2, H - 3.2, t / 2, ax, 0b111111);
    const leftW = doorX - 0.95 - (x0 + 0.6);
    const rightW = x1 - 0.6 - (doorX + 0.95);
    g.box(x0 + 0.6 + leftW / 2, 0, front, leftW / 2, 0.6, t / 2, ax, 0b111111);
    g.box(doorX + 0.95 + rightW / 2, 0, front, rightW / 2, 0.6, t / 2, ax, 0b111111);
    coll.begin();
    coll.box(x0 + 0.3, 0, front, 0.3, H, t / 2, ax);
    coll.box(x1 - 0.3, 0, front, 0.3, H, t / 2, ax);
    coll.box(x0 + 0.6 + leftW / 2, 0, front, leftW / 2, 3.2, t / 2, ax);
    coll.box(doorX + 0.95 + rightW / 2, 0, front, rightW / 2, 3.2, t / 2, ax);
    coll.box((x0 + x1) / 2, 0, z0 + t / 2, (x1 - x0) / 2, H, t / 2, ax);
    coll.box(x0 + t / 2, 0, (z0 + z1) / 2, t / 2, H, (z1 - z0) / 2, ax);
    coll.box(x1 - t / 2, 0, (z0 + z1) / 2, t / 2, H, (z1 - z0) / 2, ax);
    // Glass.
    const glass = new Geo();
    glass.quad([x0 + 0.6, 0.6, z1 - 0.05], [doorX - 0.95, 0.6, z1 - 0.05], [doorX - 0.95, 3.2, z1 - 0.05], [x0 + 0.6, 3.2, z1 - 0.05], [0, 0, 1]);
    glass.quad([doorX + 0.95, 0.6, z1 - 0.05], [x1 - 0.6, 0.6, z1 - 0.05], [x1 - 0.6, 3.2, z1 - 0.05], [doorX + 0.95, 3.2, z1 - 0.05], [0, 0, 1]);
    const glassMesh = glass.toMesh(`city-store-glass-${store.id}`, scene, glassMat);
    if (glassMesh) extras.push(glassMesh);
    // Sign.
    const sign = BABYLON.MeshBuilder.CreatePlane(`city-store-sign-${store.id}`, { width: Math.min(5.2, x1 - x0 - 1.2), height: 1.0 }, scene);
    sign.position.set((x0 + x1) / 2, 3.8, z1 + 0.04);
    sign.rotation.y = Math.PI;
    const signMat = new BABYLON.StandardMaterial(`city-store-sign-mat-${store.id}`, scene);
    signMat.emissiveTexture = signTexture(store);
    signMat.diffuseColor = BABYLON.Color3.Black();
    signMat.specularColor = BABYLON.Color3.Black();
    signMat.disableLighting = true;
    sign.material = signMat;
    sign.isPickable = false;
    sign.freezeWorldMatrix();
    extras.push(sign);
    glowAt(gl, (x0 + x1) / 2, 3.8, z1 + 0.5, store.tint, 3.2, 0.35);
    glowAt(gl, doorX, 3.0, z1 + 0.6, [1.0, 0.85, 0.62], 2.2, 0.25);
    // Fixtures.
    const width = x1 - x0;
    if (store.id === 'market') {
      for (const s of [-1, 1]) {
        const sx = (x0 + x1) / 2 + s * (width / 2 - 1.0);
        P.c(g, 0.3, 0.3, 0.32);
        g.box(sx, 0.16, (z0 + z1) / 2 - 1, 0.35, 1.9, 3.6, ax, 0b111111);
        coll.box(sx, 0, (z0 + z1) / 2 - 1, 0.35, 1.9, 3.6, ax);
        for (let row = 0; row < 4; row += 1) {
          for (let k = 0; k < 9; k += 1) {
            const c = CAR_COLORS[(row * 9 + k) % CAR_COLORS.length];
            P.c(g, 0.3 + c[0] * 0.8, 0.2 + c[1] * 0.8, 0.15 + c[2] * 0.6, 0.35, 1);
            g.box(sx - s * 0.36, 0.45 + row * 0.42, z0 + 2.3 + k * 0.8, 0.06, 0.3, 0.3, ax, 0b111111);
          }
        }
      }
      P.c(g, 0.85, 0.95, 1.0, 1.3, 1);
      g.box((x0 + x1) / 2, 0.16, z0 + 0.6, width / 2 - 1.6, 2.2, 0.35, ax, 0b111111);
      coll.box((x0 + x1) / 2, 0, z0 + 0.6, width / 2 - 1.6, 2.2, 0.35, ax);
      // Produce crates out front.
      for (let k = 0; k < 4; k += 1) {
        const cx = x0 + 1.4 + k * 0.9;
        P.c(g, 0.28, 0.17, 0.08);
        g.box(cx, CURB, z1 + 0.6, 0.4, 0.55, 0.35, ax, 0b011111);
        const fruit = [[0.6, 0.08, 0.05], [0.65, 0.45, 0.05], [0.25, 0.45, 0.08], [0.55, 0.3, 0.05]][k];
        P.c(g, fruit[0], fruit[1], fruit[2], 0.25, 1);
        g.box(cx, CURB + 0.55, z1 + 0.6, 0.36, 0.08, 0.31, ax, 0b010000);
      }
      coll.box(x0 + 2.75, 0, z1 + 0.6, 1.85, 0.7, 0.4, ax);
    } else if (store.id === 'diner') {
      P.c(g, 0.55, 0.06, 0.06);
      g.box(x0 + 2.0, 0.16, (z0 + z1) / 2 - 0.5, 0.45, 1.05, 3.6, ax, 0b111111);
      coll.box(x0 + 2.0, 0, (z0 + z1) / 2 - 0.5, 0.45, 1.1, 3.6, ax);
      for (let k = 0; k < 5; k += 1) {
        P.c(g, 0.65, 0.06, 0.06);
        g.cyl(x0 + 2.95, 0.16, z0 + 2.6 + k * 1.2, 0.22, 0.22, 0.75, 8);
      }
      for (let k = 0; k < 2; k += 1) {
        const bz = z1 - 1.8 - k * 2.6;
        P.c(g, 0.5, 0.05, 0.05);
        g.box(x1 - 1.4, 0.16, bz - 0.7, 1.0, 1.0, 0.25, ax, 0b111111);
        g.box(x1 - 1.4, 0.16, bz + 0.7, 1.0, 1.0, 0.25, ax, 0b111111);
        P.c(g, 0.7, 0.7, 0.68);
        g.box(x1 - 1.4, 0.86, bz, 0.9, 0.06, 0.45, ax, 0b111111);
        coll.box(x1 - 1.4, 0, bz, 1.0, 1.0, 0.95, ax);
      }
      P.c(g, 0.2, 0.9, 1.0, 1.6, 6, 2);
      g.box((x0 + x1) / 2, 2.4, z0 + 0.27, 1.8, 0.6, 0.02, ax, 0b0010);
    } else {
      for (const s of [-1, 1]) {
        const sx = (x0 + x1) / 2 + s * (width / 2 - 0.7);
        P.c(g, 0.25, 0.2, 0.15);
        g.box(sx, 0.16, (z0 + z1) / 2, 0.35, 2.0, 4.2, ax, 0b111111);
        coll.box(sx, 0, (z0 + z1) / 2, 0.35, 2.0, 4.2, ax);
        for (let row = 0; row < 5; row += 1) {
          for (let k = 0; k < 10; k += 1) {
            const c = ADS[(row + k) % ADS.length];
            P.c(g, c[0] * 0.7, c[1] * 0.7, c[2] * 0.7, 0.4, 1);
            g.box(sx - s * 0.36, 0.5 + row * 0.33, (z0 + z1) / 2 - 3.8 + k * 0.84, 0.02, 0.26, 0.36, ax, 0b111111);
          }
        }
      }
      P.c(g, 1.0, 0.6, 0.15, 1.8, 6, 5);
      g.box((x0 + x1) / 2, 2.5, z0 + 0.27, 1.2, 0.35, 0.02, ax, 0b0010);
      // Bundles by the door.
      P.c(g, 0.7, 0.68, 0.62);
      g.box(doorX + 1.6, CURB, z1 + 0.5, 0.35, 0.4, 0.25, ax, 0b011111);
    }
    // Counter by the keeper.
    P.c(g, 0.32, 0.2, 0.12);
    g.box(store.keeper.x - 0.2, 0.16, store.keeper.z + 1.1, 1.3, 1.0, 0.35, ax, 0b111111);
    P.c(g, 0.1, 0.1, 0.11);
    g.box(store.keeper.x + 0.4, 1.16, store.keeper.z + 1.1, 0.2, 0.25, 0.18, ax, 0b111111);
    coll.box(store.keeper.x - 0.2, 0, store.keeper.z + 1.1, 1.3, 1.1, 0.35, ax);
    coll.end();
    g.fixedUv = null;
    g.a.u2 = [0, 0];
  };

  // ---------- Park ----------
  const emitPark = (g: Geo, ground: Geo, park: City['parks'][number]) => {
    const circle: V2[] = [];
    for (let i = 0; i < 64; i += 1) {
      const a = (i / 64) * Math.PI * 2;
      circle.push({ x: park.x + Math.cos(a) * park.r, z: park.z + Math.sin(a) * park.r });
    }
    ground.a.c = [SURF.GRASS, 0, 0, 0];
    ground.flat(circle, earcut(circle), 0.012, (p) => [p.x, p.z]);
    for (const path of city.parkPaths) {
      ground.a.c = [SURF.PATH, 0, 0, 0];
      for (let i = 0; i < path.pts.length - 1; i += 1) {
        const a = path.pts[i];
        const b = path.pts[i + 1];
        const n = ccw({ x: b.x - a.x, z: b.z - a.z });
        const l = Math.hypot(n.x, n.z) || 1;
        const h = path.w / 2;
        const nx = (n.x / l) * h;
        const nz = (n.z / l) * h;
        const ids = [
          ground.vert(a.x + nx, 0.024, a.z + nz, 0, 1, 0, a.x, a.z),
          ground.vert(a.x - nx, 0.024, a.z - nz, 0, 1, 0, a.x, a.z),
          ground.vert(b.x - nx, 0.024, b.z - nz, 0, 1, 0, b.x, b.z),
          ground.vert(b.x + nx, 0.024, b.z + nz, 0, 1, 0, b.x, b.z),
        ];
        ground.tri(ids[0], ids[1], ids[2], [0, 1, 0]);
        ground.tri(ids[0], ids[2], ids[3], [0, 1, 0]);
      }
    }
    if (park.pond) {
      const { x, z, rx, rz } = park.pond;
      const pond: V2[] = [];
      for (let i = 0; i < 48; i += 1) {
        const a = (i / 48) * Math.PI * 2;
        pond.push({ x: x + Math.cos(a) * rx, z: z + Math.sin(a) * rz });
      }
      ground.a.c = [SURF.WATER, 0, 0, 0];
      ground.flat(pond, earcut(pond), 0.03, (p) => [p.x, p.z]);
      P.c(g, 0.26, 0.25, 0.23);
      for (let i = 0; i < 48; i += 1) {
        const a0 = (i / 48) * Math.PI * 2;
        const a1 = ((i + 1) / 48) * Math.PI * 2;
        const p0 = { x: x + Math.cos(a0) * rx, z: z + Math.sin(a0) * rz };
        const p1 = { x: x + Math.cos(a1) * rx, z: z + Math.sin(a1) * rz };
        const dx = p1.x - p0.x;
        const dz = p1.z - p0.z;
        const len = Math.hypot(dx, dz);
        g.box((p0.x + p1.x) / 2, 0, (p0.z + p1.z) / 2, len / 2 + 0.05, 0.22, 0.35, { x: dx / len, z: dz / len }, 0b011111);
      }
      g.fixedUv = null;
    }
  };

  // ---------- Chunks ----------
  type Chunk = { key: number; ix: number; iz: number; meshes: BABYLON.Mesh[]; far: BABYLON.Mesh | null };
  const built = new Map<number, Chunk>();
  const farMeshes = new Map<number, BABYLON.Mesh>();
  let root: BABYLON.TransformNode | null = null;

  const buildChunk = (ix: number, iz: number) => {
    const key = chunkKey(ix, iz);
    const bucket = buckets.get(key);
    const ground = new Geo(true);
    const base = new Geo(true);
    const decal = new Geo(true);
    const facade = new Geo();
    const props = new Geo();
    const glow = new Geo();
    const coll = new CollisionGeo();
    const extras: BABYLON.Mesh[] = [];
    baseGround(base, ix, iz);
    if (bucket) {
      for (const seg of bucket.pieceSegs) emitPieceSeg(ground, seg.piece, seg.i);
      for (const j of bucket.junctions) emitJunction(ground, j);
      for (const pave of bucket.paves) {
        ground.a.c = [SURF.PAVERS, 0, 0, 0];
        ground.flat(pave.pts, earcut(pave.pts), pave.y, (p) => [p.x, p.z]);
      }
      for (const b of bucket.buildings) emitBuilding(facade, b);
      for (const p of bucket.props) emitProp(p.kind === 'grate' ? decal : props, glow, p);
      for (const store of bucket.stores) emitStore(props, ground, glow, coll, store, extras);
      // Colliders grouped by 32 m cells for broad phase.
      const cells = new Map<number, City['colliders']>();
      for (const c of bucket.colliders) {
        const k = Math.floor(c.obb.x / 32) * 1000 + Math.floor(c.obb.z / 32);
        const list = cells.get(k) ?? [];
        list.push(c);
        cells.set(k, list);
      }
      for (const list of cells.values()) {
        coll.begin();
        for (const c of list) {
          const y0 = c.y0 > 0.5 ? c.y0 : -0.5;
          coll.box(c.obb.x, y0, c.obb.z, c.obb.hw, c.y1 - y0, c.obb.hd, c.obb.ax);
        }
        coll.end();
      }
    }
    for (const park of city.parks) {
      if (Math.floor(park.x / CHUNK) === ix && Math.floor(park.z / CHUNK) === iz) emitPark(props, ground, park);
    }
    const meshes = [
      base.toMesh(`city-base-${ix}-${iz}`, scene, baseMat),
      ground.toMesh(`city-ground-${ix}-${iz}`, scene, groundMat),
      decal.toMesh(`city-decal-${ix}-${iz}`, scene, propMat),
      facade.toMesh(`city-facade-${ix}-${iz}`, scene, facadeMat),
      props.toMesh(`city-props-${ix}-${iz}`, scene, propMat),
      glow.toMesh(`city-glow-${ix}-${iz}`, scene, glowMat),
      coll.toMesh(`city-collide-${ix}-${iz}`, scene),
      ...extras,
    ].filter((m): m is BABYLON.Mesh => !!m);
    const chunk: Chunk = { key, ix, iz, meshes, far: farMeshes.get(key) ?? null };
    if (chunk.far) chunk.far.setEnabled(false);
    built.set(key, chunk);
    return chunk;
  };

  const dropChunk = (chunk: Chunk) => {
    for (const m of chunk.meshes) {
      if (m.name.startsWith('city-store-sign-')) m.material?.dispose();
      m.material = null;
      m.dispose(false, false);
    }
    if (chunk.far) chunk.far.setEnabled(true);
    built.delete(chunk.key);
  };

  const buildFar = () => {
    for (const [key, bucket] of buckets) {
      if (!bucket.tall.length) continue;
      const g = new Geo();
      for (const b of bucket.tall) emitFar(g, b);
      const mesh = g.toMesh(`city-far-${key}`, scene, farMat);
      if (mesh) farMeshes.set(key, mesh);
    }
  };

  let anchor = { x: Number.NaN, z: Number.NaN };
  let queue: { ix: number; iz: number; d: number }[] = [];

  const plan = (x: number, z: number) => {
    anchor = { x, z };
    const span = Math.ceil(LOAD / CHUNK) + 1;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const want: { ix: number; iz: number; d: number }[] = [];
    for (let ix = cx - span; ix <= cx + span; ix += 1) {
      for (let iz = cz - span; iz <= cz + span; iz += 1) {
        const mx = Math.max(ix * CHUNK, Math.min(x, (ix + 1) * CHUNK));
        const mz = Math.max(iz * CHUNK, Math.min(z, (iz + 1) * CHUNK));
        const d = Math.hypot(mx - x, mz - z);
        if (d > LOAD) continue;
        if (!built.has(chunkKey(ix, iz))) want.push({ ix, iz, d });
      }
    }
    want.sort((a, b) => a.d - b.d);
    queue = want;
    for (const chunk of [...built.values()]) {
      const mx = Math.max(chunk.ix * CHUNK, Math.min(x, (chunk.ix + 1) * CHUNK));
      const mz = Math.max(chunk.iz * CHUNK, Math.min(z, (chunk.iz + 1) * CHUNK));
      if (Math.hypot(mx - x, mz - z) > UNLOAD) dropChunk(chunk);
    }
  };

  // Backstop ground far below everything else, out to the horizon.
  let horizon: BABYLON.Mesh | null = null;
  const buildHorizon = () => {
    const g = new Geo(true);
    g.a.c = [SURF.BASE, 0.7, 0.2, 0];
    const R = 3200;
    const c = { x: 84, z: 32 };
    g.flat([{ x: c.x - R, z: c.z - R }, { x: c.x + R, z: c.z - R }, { x: c.x + R, z: c.z + R }, { x: c.x - R, z: c.z + R }], [0, 1, 2, 0, 2, 3], -0.35, (p) => [p.x, p.z]);
    horizon = g.toMesh('city-horizon', scene, baseMat);
  };

  // A real light that follows the nearest lamp so characters pick up the pools.
  let lampLight: BABYLON.PointLight | null = null;
  let lampWait = 0;
  const lampTarget = new BABYLON.Vector3();

  let lastLm = { x: Number.NaN, z: Number.NaN };
  let disposed = false;

  return {
    city,
    lift,
    resolve,
    walkSpot,
    nearestWalk,
    signals: () => signals(clock),
    mount: (x: number, z: number) => {
      disposed = false;
      root = new BABYLON.TransformNode('city-world', scene);
      buildFar();
      buildHorizon();
      paintLightMap(x, z);
      lastLm = { x, z };
      plan(x, z);
      for (const item of queue) buildChunk(item.ix, item.iz);
      queue = [];
      lampLight = new BABYLON.PointLight('city-lamp-light', new BABYLON.Vector3(x, 7, z), scene);
      lampLight.diffuse = new BABYLON.Color3(1.0, 0.86, 0.66);
      lampLight.specular = new BABYLON.Color3(0.2, 0.18, 0.15);
      lampLight.intensity = 0;
      lampLight.range = 16;
      pushUniforms();
    },
    step: (x: number, z: number, dt: number) => {
      if (disposed) return;
      clock += dt;
      if (!Number.isFinite(anchor.x) || Math.hypot(x - anchor.x, z - anchor.z) > 24) plan(x, z);
      if (queue.length) {
        const t0 = performance.now();
        while (queue.length && performance.now() - t0 < (opts.mobile ? 5 : 8)) {
          const next = queue.shift();
          if (next && !built.has(chunkKey(next.ix, next.iz))) buildChunk(next.ix, next.iz);
        }
      }
      if (!Number.isFinite(lastLm.x) || Math.hypot(x - lastLm.x, z - lastLm.z) > LM_WORLD * 0.22) {
        paintLightMap(x, z);
        lastLm = { x, z };
      }
      lampWait -= dt;
      if (lampLight) {
        if (lampWait <= 0) {
          lampWait = 0.35;
          const near = nearestLamp(x, z);
          if (near) lampTarget.set(near.x, 6.6, near.z);
        }
        if (lampTarget.lengthSquared() > 0) {
          const d = Math.hypot(lampTarget.x - x, lampTarget.z - z);
          lampLight.position.copyFrom(lampTarget);
          const want = clamp(1 - d / 15, 0, 1) * 2.2;
          lampLight.intensity += (want - lampLight.intensity) * Math.min(1, dt * 4);
        }
      }
      pushUniforms();
    },
    setEnv: (next: Partial<typeof env>) => Object.assign(env, next),
    env,
    dispose: () => {
      disposed = true;
      for (const chunk of [...built.values()]) dropChunk(chunk);
      for (const mesh of farMeshes.values()) {
        mesh.material = null;
        mesh.dispose(false, false);
      }
      farMeshes.clear();
      if (horizon) {
        horizon.material = null;
        horizon.dispose();
        horizon = null;
      }
      lampLight?.dispose();
      lampLight = null;
      for (const m of [...shaders, glowMat, glassMat]) m.dispose(true, false);
      for (const t of storeSignTex.values()) t.dispose();
      storeSignTex.clear();
      lmTex.dispose();
      root?.dispose();
      root = null;
      anchor = { x: Number.NaN, z: Number.NaN };
    },
    /** Minimap: draws roads, blocks, parks, and buildings around a point. */
    drawMap: (ctx: CanvasRenderingContext2D, cx: number, cz: number, radius: number) => {
      const x0 = cx - radius;
      const z0 = cz - radius;
      const x1 = cx + radius;
      const z1 = cz + radius;
      ctx.fillStyle = '#121a20';
      ctx.fillRect(x0, z0, radius * 2, radius * 2);
      for (const park of city.parks) {
        if (park.x + park.r < x0 || park.x - park.r > x1 || park.z + park.r < z0 || park.z - park.r > z1) continue;
        ctx.fillStyle = '#16301d';
        ctx.beginPath();
        ctx.arc(park.x, park.z, park.r, 0, Math.PI * 2);
        ctx.fill();
        if (park.pond) {
          ctx.fillStyle = '#163548';
          ctx.beginPath();
          ctx.ellipse(park.pond.x, park.pond.z, park.pond.rx, park.pond.rz, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = '#26323b';
      for (const b of city.blocks) {
        if (b.maxX < x0 || b.minX > x1 || b.maxZ < z0 || b.minZ > z1) continue;
        ctx.fillRect(b.minX - 6, b.minZ - 6, b.maxX - b.minX + 12, b.maxZ - b.minZ + 12);
      }
      const seen = new Set<Piece>();
      for (const hit of city.grids.pieces.query(x0, z0, x1, z1)) seen.add(hit.piece);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const pass of [0, 1]) {
        for (const piece of seen) {
          const spec = piece.road.spec;
          ctx.strokeStyle = pass === 0 ? '#2f3d47' : '#6d7c86';
          ctx.lineWidth = pass === 0 ? (spec.half + spec.walk) * 2 : spec.half * 2;
          ctx.beginPath();
          piece.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)));
          ctx.stroke();
        }
      }
      ctx.fillStyle = '#3a4752';
      for (const b of city.grids.buildings.query(x0, z0, x1, z1)) {
        const o = b.obb;
        const bz = ccw(o.ax);
        ctx.beginPath();
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const px = o.x + o.ax.x * o.hw * sx + bz.x * o.hd * sz;
          const pz = o.z + o.ax.z * o.hw * sx + bz.z * o.hd * sz;
          ctx.lineTo(px, pz);
        }
        ctx.closePath();
        ctx.fill();
      }
    },
  };
};

export type CityWorld = ReturnType<typeof createCityWorld>;

