import * as BABYLON from '@babylonjs/core';

import { Geo } from '../../story/city/geo';
import { INTERIOR_FRAG, INTERIOR_VERT, IS, MAX_INTERIOR_LIGHTS } from './shader';

/**
 * Re-skins an authored interior and fills it with props.
 *
 * Surfaces: every authored wall, floor, ceiling, and pillar gets an overlay a few
 * millimeters off its face, styled by the room it faces. Authored decals, signs,
 * and puddles sit further out and stay visible.
 *
 * Props: a level plan places furniture and fixtures through the kit below. They
 * merge into one mesh with the surfaces. Floor-standing pieces get their own small
 * invisible collider, so the player, the camera, and the B3 hunt grid (which reads
 * each collider's bounds) treat them like authored props.
 */

export type Room = {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  wall: number;
  wallVar?: number;
  floor: number;
  floorVar?: number;
  ceil: number;
};

export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

export type InteriorPlan = {
  rooms: Room[];
  /** Asset ids left as authored (glass, doors, lift, decals...). */
  skip: RegExp;
  /** Authored meshes hidden while the dressing is on (collision stays). */
  hide?: RegExp;
  /** Points props must keep clear of (doorways, walk-ups, story marks), with radius. */
  keepClear: { x: number; z: number; r: number }[];
  build: (kit: Kit) => void;
  lightGain?: number;
};

type V2 = { x: number; z: number };
type V3 = [number, number, number];

export type Kit = ReturnType<typeof makeKit>;

const AX: V2 = { x: 1, z: 0 };

const makeKit = (scene: BABYLON.Scene, g: Geo, plan: InteriorPlan, colliders: BABYLON.Mesh[], atlasRects: Record<string, [number, number, number, number]>) => {
  let colIndex = 0;
  const clearOf = (x: number, z: number, r: number) => plan.keepClear.every((c) => Math.hypot(c.x - x, c.z - z) > c.r + r);

  const set = (style: number, r = 1, gg = 1, b = 1, e = 0, variant = 0) => {
    g.a.u2 = [style, variant];
    g.a.c = [r, gg, b, e];
  };

  /** Box with metric uvs on every face (grain and seams keep their scale). */
  const box = (cx: number, y0: number, cz: number, hw: number, h: number, hd: number, ax: V2 = AX, faces = 0b111111) => {
    const bx = { x: -ax.z, z: ax.x };
    const y1 = y0 + h;
    const c = (sx: number, sz: number, y: number): V3 => [cx + ax.x * hw * sx + bx.x * hd * sz, y, cz + ax.z * hw * sx + bx.z * hd * sz];
    const W = hw * 2;
    const D = hd * 2;
    const nx: V3 = [ax.x, 0, ax.z];
    const nz: V3 = [bx.x, 0, bx.z];
    if (faces & 1) g.quad(c(1, -1, y0), c(1, 1, y0), c(1, 1, y1), c(1, -1, y1), nx, [[0, y0], [D, y0], [D, y1], [0, y1]]);
    if (faces & 2) g.quad(c(1, 1, y0), c(-1, 1, y0), c(-1, 1, y1), c(1, 1, y1), nz, [[0, y0], [W, y0], [W, y1], [0, y1]]);
    if (faces & 4) g.quad(c(-1, 1, y0), c(-1, -1, y0), c(-1, -1, y1), c(-1, 1, y1), [-nx[0], 0, -nx[2]], [[0, y0], [D, y0], [D, y1], [0, y1]]);
    if (faces & 8) g.quad(c(-1, -1, y0), c(1, -1, y0), c(1, -1, y1), c(-1, -1, y1), [-nz[0], 0, -nz[2]], [[0, y0], [W, y0], [W, y1], [0, y1]]);
    if (faces & 16) g.quad(c(-1, -1, y1), c(1, -1, y1), c(1, 1, y1), c(-1, 1, y1), [0, 1, 0], [[0, 0], [W, 0], [W, D], [0, D]]);
    if (faces & 32) g.quad(c(-1, -1, y0), c(1, -1, y0), c(1, 1, y0), c(-1, 1, y0), [0, -1, 0], [[0, 0], [W, 0], [W, D], [0, D]]);
  };

  /** Invisible collider with tight bounds. */
  const solid = (cx: number, cz: number, hw: number, hd: number, h: number, ax: V2 = AX, y0 = 0) => {
    const mesh = BABYLON.MeshBuilder.CreateBox(`interior-col-${colIndex++}`, { width: hw * 2, height: h, depth: hd * 2 }, scene);
    mesh.position.set(cx, y0 + h / 2, cz);
    mesh.rotation.y = Math.atan2(ax.z, ax.x) * -1;
    mesh.isVisible = false;
    mesh.isPickable = false;
    mesh.checkCollisions = true;
    mesh.computeWorldMatrix(true);
    mesh.freezeWorldMatrix();
    mesh.metadata = { interiorCollider: true };
    colliders.push(mesh);
  };

  /** Atlas quad on a wall facing n (viewer's right is the wall tangent). */
  const tex = (key: string, cx: number, y0: number, cz: number, w: number, h: number, n: V2, glow = 0, out = 0.012) => {
    const r = atlasRects[key];
    if (!r) return;
    const t = { x: -n.z, z: n.x };
    const a: V3 = [cx - t.x * w / 2 + n.x * out, y0, cz - t.z * w / 2 + n.z * out];
    const b: V3 = [cx + t.x * w / 2 + n.x * out, y0, cz + t.z * w / 2 + n.z * out];
    set(IS.TEX, 1, 1, 1, glow);
    g.quad(a, b, [b[0], y0 + h, b[2]], [a[0], y0 + h, a[2]], [n.x, 0, n.z], [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]);
  };

  return {
    g,
    set,
    box,
    solid,
    tex,
    clearOf,
    cyl: (x: number, y0: number, z: number, r0: number, r1: number, h: number, seg = 10, caps = true) => g.cyl(x, y0, z, r0, r1, h, seg, caps),
    blob: (x: number, y: number, z: number, rx: number, ry: number, rz: number, jitter = 0, salt = 0) => g.blob(x, y, z, rx, ry, rz, jitter, salt),
    hcyl: (x: number, y: number, z: number, dir: V2, r: number, len: number, seg = 10) => g.hcyl(x, y, z, dir, r, len, seg),
    room: (id: string) => plan.rooms.find((r) => r.id === id),
  };
};

/** Atlas art: paintings, signs, labels, screens. Drawn once per mount. */
const paintAtlas = (scene: BABYLON.Scene) => {
  const size = 2048;
  const tex = new BABYLON.DynamicTexture('interior-atlas', { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const rects: Record<string, [number, number, number, number]> = {};
  let cx = 0;
  let cy = 0;
  let rowH = 0;
  /** Allocate a w x h pixel cell and return its rect (uv with v up). */
  const cell = (key: string, w: number, h: number, draw: (x: number, y: number) => void) => {
    if (cx + w > size) {
      cx = 0;
      cy += rowH + 4;
      rowH = 0;
    }
    const x = cx;
    const y = cy;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    draw(x, y);
    ctx.restore();
    rects[key] = [(x + 1) / size, 1 - (y + h - 1) / size, (x + w - 1) / size, 1 - (y + 1) / size];
    cx += w + 4;
    rowH = Math.max(rowH, h);
  };
  const rnd = (seed: number) => {
    let s = seed;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  };
  // Paintings: abstract, warm and cool, with a mat and a frame.
  const palettes = [
    ['#1d2b3a', '#c75b39', '#e8c07d', '#f3ede0'],
    ['#0f1a17', '#2f6b5e', '#b8d4c8', '#e2d9c3'],
    ['#2a1b2e', '#8c3b5e', '#e3a26f', '#f1e4d0'],
    ['#101418', '#3c4e63', '#9fb3c8', '#e9edf2'],
    ['#2b2414', '#a4782c', '#e2c88f', '#f4ecd8'],
    ['#151515', '#b02e2e', '#e6e1d8', '#6c6c6c'],
  ];
  palettes.forEach((pal, i) => {
    cell(`art-${i}`, 256, i % 2 ? 320 : 256, (x, y) => {
      const r = rnd(97 + i * 31);
      const w = 256;
      const h = i % 2 ? 320 : 256;
      ctx.fillStyle = '#ece6da';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = pal[0];
      ctx.fillRect(x + 22, y + 22, w - 44, h - 44);
      for (let k = 0; k < 14; k += 1) {
        ctx.globalAlpha = 0.35 + r() * 0.5;
        ctx.fillStyle = pal[1 + Math.floor(r() * 3)];
        if (r() < 0.5) {
          ctx.beginPath();
          ctx.arc(x + 22 + r() * (w - 44), y + 22 + r() * (h - 44), 10 + r() * 60, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(x + 22 + r() * (w - 80), y + 22 + r() * (h - 80), 20 + r() * 90, 6 + r() * 70);
        }
      }
      ctx.globalAlpha = 1;
    });
  });
  const sign = (key: string, w: number, h: number, bg: string, fg: string, text: string, opts: { sub?: string; stripe?: boolean; icon?: string } = {}) => {
    cell(key, w, h, (x, y) => {
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, w, h);
      if (opts.stripe) {
        for (let k = -h; k < w; k += 36) {
          ctx.fillStyle = '#e0b10e';
          ctx.beginPath();
          ctx.moveTo(x + k, y);
          ctx.lineTo(x + k + 18, y);
          ctx.lineTo(x + k + 18 + h * 0.18, y + h * 0.18);
          ctx.lineTo(x + k + h * 0.18, y + h * 0.18);
          ctx.fill();
        }
      }
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const big = Math.floor(h * (opts.sub ? 0.36 : 0.5));
      ctx.font = `bold ${big}px "Arial Black", Arial, sans-serif`;
      const ty = y + h * (opts.sub ? (opts.stripe ? 0.5 : 0.42) : 0.54);
      ctx.fillText(text, x + w / 2, ty, w - 24);
      if (opts.sub) {
        ctx.font = `${Math.floor(h * 0.17)}px Arial, sans-serif`;
        ctx.fillText(opts.sub, x + w / 2, y + h * 0.78, w - 24);
      }
      ctx.strokeStyle = fg;
      ctx.lineWidth = 4;
      ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
    });
  };
  sign('exit', 256, 96, '#0b5d2a', '#eaffef', 'EXIT');
  sign('biohazard', 320, 200, '#f2c300', '#111', '☣ BIOHAZARD', { sub: 'AUTHORIZED PERSONNEL ONLY' });
  sign('acid', 320, 200, '#f2c300', '#111', 'DANGER', { sub: 'CORROSIVE — FULL PPE', stripe: true });
  sign('eyewash', 256, 160, '#0f7a3a', '#fff', 'EYE WASH', { sub: 'STATION' });
  sign('fire', 192, 192, '#b81d1d', '#fff', 'FIRE', { sub: 'EXTINGUISHER' });
  sign('nosmoke', 192, 192, '#f5f5f2', '#b81d1d', 'NO OPEN', { sub: 'FLAME' });
  sign('highvolt', 256, 192, '#f2c300', '#111', '⚡ HIGH VOLTAGE', { sub: 'KEEP OUT' });
  sign('cold', 256, 160, '#1c4f8c', '#fff', 'COLD STORE', { sub: '-20 °C' });
  sign('level', 384, 128, '#1b1d20', '#d8dde3', 'SUB-LEVEL B3', { sub: 'HAWKES BIOMEDICAL' });
  sign('meeting', 320, 96, '#202326', '#d9c79a', 'BOARDROOM');
  sign('office', 320, 96, '#202326', '#d9c79a', 'P. HAWKES');
  sign('restroom', 256, 96, '#202326', '#d9c79a', 'RESTROOM');
  // Logo plaque.
  cell('logo', 512, 160, (x, y) => {
    ctx.fillStyle = '#121416';
    ctx.fillRect(x, y, 512, 160);
    ctx.fillStyle = '#c9a868';
    ctx.font = 'bold 54px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('HAWKES', x + 256, y + 66);
    ctx.font = '22px Georgia, serif';
    ctx.fillText('B I O M E D I C A L', x + 256, y + 116);
  });
  // Boardroom screen: valuation chart.
  cell('chart', 512, 288, (x, y) => {
    ctx.fillStyle = '#071018';
    ctx.fillRect(x, y, 512, 288);
    ctx.strokeStyle = '#1d3346';
    for (let k = 0; k < 8; k += 1) {
      ctx.beginPath();
      ctx.moveTo(x + 40, y + 40 + k * 28);
      ctx.lineTo(x + 490, y + 40 + k * 28);
      ctx.stroke();
    }
    ctx.strokeStyle = '#4fd1ff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    const pts = [240, 230, 236, 212, 200, 205, 172, 150, 158, 120, 96, 70];
    pts.forEach((v, k) => (k ? ctx.lineTo(x + 40 + k * 40, y + v) : ctx.moveTo(x + 40, y + v)));
    ctx.stroke();
    ctx.fillStyle = '#e8f4ff';
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.fillText('VALUATION  +412%', x + 40, y + 30);
    ctx.fillStyle = '#7fe0a0';
    ctx.font = '20px Arial, sans-serif';
    ctx.fillText('SERIES D  ·  ZURICH', x + 300, y + 270);
  });
  // CCTV wall: four feeds.
  cell('cctv', 512, 288, (x, y) => {
    ctx.fillStyle = '#020403';
    ctx.fillRect(x, y, 512, 288);
    const r = rnd(5);
    for (let k = 0; k < 4; k += 1) {
      const fx = x + (k % 2) * 256 + 6;
      const fy = y + Math.floor(k / 2) * 144 + 6;
      const grad = ctx.createLinearGradient(fx, fy, fx, fy + 132);
      grad.addColorStop(0, '#1b2a22');
      grad.addColorStop(1, '#0a120e');
      ctx.fillStyle = grad;
      ctx.fillRect(fx, fy, 244, 132);
      ctx.strokeStyle = '#3c5a48';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fx + 30, fy + 132);
      ctx.lineTo(fx + 110, fy + 50);
      ctx.lineTo(fx + 134, fy + 50);
      ctx.lineTo(fx + 214, fy + 132);
      ctx.stroke();
      for (let n = 0; n < 40; n += 1) {
        ctx.fillStyle = `rgba(160,220,180,${r() * 0.15})`;
        ctx.fillRect(fx + r() * 244, fy + r() * 132, 2, 2);
      }
      ctx.fillStyle = '#9fe0b0';
      ctx.font = '14px "Courier New", monospace';
      ctx.fillText(`CAM ${k + 1}  B3-${['VAT', 'DECON', 'CELL', 'HALL'][k]}`, fx + 8, fy + 18);
      ctx.fillStyle = '#ff4a4a';
      ctx.fillText('● REC', fx + 186, fy + 18);
    }
  });
  // Lab monitor: vitals.
  cell('vitals', 384, 240, (x, y) => {
    ctx.fillStyle = '#020806';
    ctx.fillRect(x, y, 384, 240);
    const lines: [string, number][] = [['#3cff8a', 60], ['#ffd23c', 120], ['#3cc8ff', 180]];
    for (const [color, base] of lines) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let k = 0; k <= 300; k += 4) {
        const spike = k % 60 < 8 ? (k % 60 < 4 ? -30 : 24) : Math.sin(k * 0.2) * 3;
        const px = x + 20 + k;
        const py = y + base + spike;
        if (k) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#3cff8a';
    ctx.font = 'bold 26px Arial, sans-serif';
    ctx.fillText('HR 0', x + 300, y + 60);
  });
  // Clipboard / paper sheet.
  cell('paper', 128, 176, (x, y) => {
    ctx.fillStyle = '#ece9df';
    ctx.fillRect(x, y, 128, 176);
    ctx.fillStyle = '#8a8a8a';
    for (let k = 0; k < 14; k += 1) ctx.fillRect(x + 12, y + 20 + k * 10, 60 + ((k * 37) % 44), 3);
    ctx.fillStyle = '#b02e2e';
    ctx.fillRect(x + 12, y + 6, 50, 8);
  });
  tex.update(true);
  return { tex, rects };
};

export const createInteriorDress = (scene: BABYLON.Scene, plan: InteriorPlan) => {
  const owned: { dispose: () => void }[] = [];
  const colliders: BABYLON.Mesh[] = [];
  const atlas = paintAtlas(scene);
  owned.push(atlas.tex);

  const material = new BABYLON.ShaderMaterial('interior-dress', scene, { vertexSource: INTERIOR_VERT, fragmentSource: INTERIOR_FRAG }, {
    attributes: ['position', 'normal', 'uv', 'uv2', 'color'],
    uniforms: [
      'worldViewProjection', 'cameraPos', 'lPos', 'lCol', 'spotPos', 'spotDir', 'spotInfo', 'hemiSky', 'hemiGround',
      'fogColor', 'fogInfo', 'time', 'lightGain', 'toGamma',
    ],
    samplers: ['atlas'],
  });
  material.backFaceCulling = true;
  material.zOffset = -1;
  material.setTexture('atlas', atlas.tex);
  owned.push(material);

  const g = new Geo();
  const hidden: BABYLON.AbstractMesh[] = [];
  const roomAt = (x: number, z: number) => plan.rooms.find((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) ?? null;

  // ---------- Surfaces from the authored level ----------
  const OFF = 0.005;
  for (const mesh of scene.meshes) {
    const meta = mesh.metadata as { sceneAssetId?: string; assetKind?: string } | null;
    const id = meta?.sceneAssetId;
    const kind = meta?.assetKind;
    if (!id || !kind || !mesh.isEnabled() || !mesh.isVisible || plan.skip.test(id)) continue;
    if (kind !== 'wall' && kind !== 'ground' && kind !== 'pillar') continue;
    mesh.computeWorldMatrix(true);
    const bb = mesh.getBoundingInfo().boundingBox;
    const min = bb.minimumWorld;
    const max = bb.maximumWorld;
    const dx = max.x - min.x;
    const dy = max.y - min.y;
    const dz = max.z - min.z;
    if (kind === 'ground') {
      const room = roomAt((min.x + max.x) / 2, (min.z + max.z) / 2);
      if (!room || room.floor < 0) continue;
      const x0 = Math.max(min.x, room.minX);
      const x1 = Math.min(max.x, room.maxX);
      const z0 = Math.max(min.z, room.minZ);
      const z1 = Math.min(max.z, room.maxZ);
      if (x1 <= x0 || z1 <= z0) continue;
      g.a.u2 = [room.floor, room.floorVar ?? 0];
      g.a.c = [1, 1, 1, 0];
      const y = max.y + 0.004;
      g.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
      mesh.isVisible = false;
      hidden.push(mesh);
      continue;
    }
    // Ceilings: thin slabs up high.
    if (dy <= 0.35 && min.y > 2.3 && dx > 1 && dz > 1) {
      const room = roomAt((min.x + max.x) / 2, (min.z + max.z) / 2);
      if (!room || room.ceil < 0) continue;
      const x0 = Math.max(min.x, room.minX);
      const x1 = Math.min(max.x, room.maxX);
      const z0 = Math.max(min.z, room.minZ);
      const z1 = Math.min(max.z, room.maxZ);
      if (x1 <= x0 || z1 <= z0) continue;
      g.a.u2 = [room.ceil, 0];
      g.a.c = [1, 1, 1, 0];
      const y = min.y - 0.004;
      g.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
      mesh.isVisible = false;
      hidden.push(mesh);
      continue;
    }
    const tall = dy >= 1.8 && min.y < 0.6;
    if (!tall) continue;
    const thinX = dx < dz;
    const pillar = kind === 'pillar' || Math.max(dx, dz) < 1.2;
    const faces: { n: V2; at: number; from: number; to: number; alongX: boolean }[] = [];
    if (thinX || pillar) {
      faces.push({ n: { x: -1, z: 0 }, at: min.x - OFF, from: min.z, to: max.z, alongX: false });
      faces.push({ n: { x: 1, z: 0 }, at: max.x + OFF, from: min.z, to: max.z, alongX: false });
    }
    if (!thinX || pillar) {
      faces.push({ n: { x: 0, z: -1 }, at: min.z - OFF, from: min.x, to: max.x, alongX: true });
      faces.push({ n: { x: 0, z: 1 }, at: max.z + OFF, from: min.x, to: max.x, alongX: true });
    }
    const y0 = Math.max(min.y, 0);
    const y1 = max.y;
    for (const f of faces) {
      // Split the face where the room on its side changes.
      const span = f.to - f.from;
      const steps = Math.max(1, Math.ceil(span / 1.5));
      let start = f.from;
      let current: Room | null = null;
      const flush = (end: number) => {
        if (current && current.wall >= 0 && end - start > 0.02) {
          g.a.u2 = [current.wall, current.wallVar ?? 0];
          g.a.c = [1, 1, 1, 0];
          const n: V3 = [f.n.x, 0, f.n.z];
          if (f.alongX) {
            const a: V3 = [start, y0, f.at];
            const b: V3 = [end, y0, f.at];
            g.quad(a, b, [end, y1, f.at], [start, y1, f.at], n, [[start, y0], [end, y0], [end, y1], [start, y1]]);
          } else {
            const a: V3 = [f.at, y0, start];
            const b: V3 = [f.at, y0, end];
            g.quad(a, b, [f.at, y1, end], [f.at, y1, start], n, [[start, y0], [end, y0], [end, y1], [start, y1]]);
          }
        }
        start = end;
      };
      for (let i = 0; i < steps; i += 1) {
        const s0 = f.from + (span * i) / steps;
        const mid = s0 + span / steps / 2;
        const px = f.alongX ? mid : f.at + f.n.x * 0.4;
        const pz = f.alongX ? f.at + f.n.z * 0.4 : mid;
        const room = roomAt(px, pz);
        if (room !== current) {
          flush(s0);
          current = room;
        }
      }
      flush(f.to);
    }
  }

  // ---------- Hidden authored pieces ----------
  // Model meshes arrive after their GLB loads, so this runs again from step().
  const hideNow = () => {
    if (!plan.hide) return;
    const assetIdOf = (node: BABYLON.Node | null): string => {
      for (let n = node; n; n = n.parent) {
        const id = (n.metadata as { sceneAssetId?: string } | null)?.sceneAssetId;
        if (id) return id;
      }
      return '';
    };
    for (const m of scene.meshes) {
      const id = assetIdOf(m);
      if (!id || !plan.hide.test(id) || !m.isVisible) continue;
      m.isVisible = false;
      hidden.push(m);
    }
  };
  hideNow();
  let hideWait = 1;

  // ---------- Props ----------
  const kit = makeKit(scene, g, plan, colliders, atlas.rects);
  plan.build(kit);

  const mesh = g.toMesh('interior-dress', scene, material);
  if (mesh) {
    mesh.alwaysSelectAsActiveMesh = true;
    owned.push(mesh);
  }
  for (const c of colliders) owned.push(c);

  // ---------- Lighting uniforms ----------
  const lPos = new Array(MAX_INTERIOR_LIGHTS * 4).fill(0);
  const lCol = new Array(MAX_INTERIOR_LIGHTS * 3).fill(0);
  const spotPos = new BABYLON.Vector3();
  const spotDir = new BABYLON.Vector3(0, -1, 0);
  const spotInfo = new BABYLON.Vector4(1, 1, 0, 1);
  const hemiSky = new BABYLON.Color3();
  const hemiGround = new BABYLON.Color3();
  const fogColor = new BABYLON.Color3();
  const fogInfo = new BABYLON.Vector3();
  let clock = 0;
  let pick: BABYLON.PointLight[] = [];
  let pickWait = 0;

  return {
    step: (dt: number) => {
      clock += dt;
      hideWait -= dt;
      if (hideWait <= 0) {
        hideWait = 1;
        hideNow();
      }
      const camera = scene.activeCamera;
      if (!camera) return;
      const cam = camera.globalPosition;
      pickWait -= dt;
      if (pickWait <= 0) {
        pickWait = 0.25;
        pick = scene.lights
          .filter((l): l is BABYLON.PointLight => l instanceof BABYLON.PointLight && l.name !== 'city-lamp-light')
          .sort((a, b) => BABYLON.Vector3.DistanceSquared(a.getAbsolutePosition(), cam) - BABYLON.Vector3.DistanceSquared(b.getAbsolutePosition(), cam))
          .slice(0, MAX_INTERIOR_LIGHTS);
      }
      for (let i = 0; i < MAX_INTERIOR_LIGHTS; i += 1) {
        const l = pick[i];
        if (!l || !l.isEnabled() || l.intensity <= 0) {
          lPos.splice(i * 4, 4, 0, -100, 0, 0.01);
          lCol.splice(i * 3, 3, 0, 0, 0);
          continue;
        }
        const p = l.getAbsolutePosition();
        const range = Number.isFinite(l.range) && l.range > 0 && l.range < 1e5 ? l.range : 14;
        lPos.splice(i * 4, 4, p.x, p.y, p.z, range);
        lCol.splice(i * 3, 3, l.diffuse.r * l.intensity, l.diffuse.g * l.intensity, l.diffuse.b * l.intensity);
      }
      const spot = scene.getLightByName('phoneFlash');
      if (spot instanceof BABYLON.SpotLight && spot.isEnabled() && spot.intensity > 0.01) {
        spotPos.copyFrom(spot.getAbsolutePosition());
        spotDir.copyFrom(spot.direction).normalize();
        spotInfo.set(Math.cos(spot.angle / 2), spot.exponent, spot.intensity * 0.08, spot.range);
      } else spotInfo.z = 0;
      const hemi = scene.getLightByName('hemi');
      if (hemi instanceof BABYLON.HemisphericLight && hemi.isEnabled()) {
        hemiSky.copyFrom(hemi.diffuse).scaleToRef(hemi.intensity, hemiSky);
        hemiGround.copyFrom(hemi.groundColor).scaleToRef(hemi.intensity, hemiGround);
      } else {
        hemiSky.set(0.05, 0.05, 0.05);
        hemiGround.set(0.02, 0.02, 0.02);
      }
      fogColor.copyFrom(scene.fogColor ?? BABYLON.Color3.Black());
      fogInfo.set(scene.fogStart, scene.fogEnd, scene.fogMode === BABYLON.Scene.FOGMODE_LINEAR ? 1 : 0);
      material.setVector3('cameraPos', cam);
      material.setArray4('lPos', lPos);
      material.setArray3('lCol', lCol);
      material.setVector3('spotPos', spotPos);
      material.setVector3('spotDir', spotDir);
      material.setVector4('spotInfo', spotInfo);
      material.setColor3('hemiSky', hemiSky);
      material.setColor3('hemiGround', hemiGround);
      material.setColor3('fogColor', fogColor);
      material.setVector3('fogInfo', fogInfo);
      material.setFloat('time', clock);
      material.setFloat('lightGain', plan.lightGain ?? 1);
      material.setFloat('toGamma', scene.imageProcessingConfiguration.applyByPostProcess ? 0 : 1);
    },
    dispose: () => {
      for (const o of owned) o.dispose();
      owned.length = 0;
      for (const m of hidden) if (!m.isDisposed()) m.isVisible = true;
      hidden.length = 0;
    },
  };
};

export type InteriorDress = ReturnType<typeof createInteriorDress>;
