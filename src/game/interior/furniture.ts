import { IS } from './shader';
import type { Kit } from './dress';

/**
 * Furniture and fixtures for the interior kit. Wall pieces take the wall point
 * and the facing normal n (pointing into the room). Floor pieces that block take
 * a collider unless `pass` is set.
 */

type V2 = { x: number; z: number };
const tangent = (n: V2): V2 => ({ x: -n.z, z: n.x });
const along = (p: V2, t: V2, s: number, n: V2, o: number): V2 => ({ x: p.x + t.x * s + n.x * o, z: p.z + t.z * s + n.z * o });

// ---------------- Office ----------------

export const artFrame = (k: Kit, key: string, x: number, y0: number, z: number, w: number, h: number, n: V2) => {
  const t = tangent(n);
  k.set(IS.WOOD, 0.08, 0.06, 0.05);
  const c = along({ x, z }, t, 0, n, 0.03);
  k.box(c.x, y0 - 0.06, c.z, w / 2 + 0.06, h + 0.12, 0.025, t);
  k.tex(key, x, y0, z, w, h, n, 0, 0.058);
};

export const sconce = (k: Kit, x: number, y: number, z: number, n: V2) => {
  const t = tangent(n);
  const back = along({ x, z }, t, 0, n, 0.015);
  k.set(IS.METAL, 0.55, 0.46, 0.3);
  k.box(back.x, y - 0.12, back.z, 0.06, 0.24, 0.015, t);
  const arm = along({ x, z }, t, 0, n, 0.11);
  k.box(arm.x, y - 0.02, arm.z, 0.015, 0.03, 0.09, t);
  k.set(IS.SOLID, 1.0, 0.86, 0.62, 1.4);
  k.cyl(arm.x + n.x * 0.06, y - 0.08, arm.z + n.z * 0.06, 0.09, 0.07, 0.18, 12, true);
};

export const bookshelf = (k: Kit, x: number, z: number, w: number, h: number, d: number, n: V2, seed = 0) => {
  const t = tangent(n);
  const c = along({ x, z }, t, 0, n, d / 2);
  k.set(IS.WOOD, 0.22, 0.13, 0.08);
  for (const s of [-1, 1]) {
    const side = along(c, t, s * (w / 2 - 0.02), n, 0);
    k.box(side.x, 0, side.z, 0.02, h, d / 2, t);
  }
  const back = along(c, t, 0, n, -d / 2 + 0.01);
  k.box(back.x, 0, back.z, w / 2, h, 0.01, t);
  const rows = Math.max(2, Math.floor(h / 0.38));
  for (let i = 0; i <= rows; i += 1) {
    const y = (h / rows) * i;
    k.set(IS.WOOD, 0.22, 0.13, 0.08);
    k.box(c.x, Math.max(0, y - 0.025), c.z, w / 2 - 0.02, 0.025, d / 2, t);
    if (i === rows) continue;
    // Books: a front-facing quad strip with spine pattern, set back a little.
    const runs = 2 + ((i + seed) % 2);
    let s0 = -w / 2 + 0.05;
    for (let r = 0; r < runs; r += 1) {
      const len = (w - 0.1) / runs - 0.08;
      const bh = 0.22 + (((i * 7 + r * 3 + seed) % 5) * 0.02);
      const mid = along(c, t, s0 + len / 2, n, 0.02);
      k.set(IS.BOOKS, 1, 1, 1, 0, (i * 3 + r + seed) % 7);
      k.box(mid.x, y + 0.01, mid.z, len / 2, bh, d / 2 - 0.06, t, 0b011111);
      s0 += len + 0.08;
    }
  }
  k.solid(c.x, c.z, w / 2, d / 2, h, t);
};

export const rug = (k: Kit, minX: number, maxX: number, minZ: number, maxZ: number, r: number, g: number, b: number, y = 0.009) => {
  k.set(IS.FABRIC, r, g, b);
  k.g.quad([minX, y, minZ], [maxX, y, minZ], [maxX, y, maxZ], [minX, y, maxZ], [0, 1, 0], [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]]);
  k.set(IS.FABRIC, r * 0.55, g * 0.55, b * 0.55);
  const e = 0.12;
  const y2 = y + 0.001;
  for (const [a0, a1, b0, b1] of [[minX, maxX, minZ, minZ + e], [minX, maxX, maxZ - e, maxZ], [minX, minX + e, minZ, maxZ], [maxX - e, maxX, minZ, maxZ]]) {
    k.g.quad([a0, y2, b0], [a1, y2, b0], [a1, y2, b1], [a0, y2, b1], [0, 1, 0], [[a0, b0], [a1, b0], [a1, b1], [a0, b1]]);
  }
};

export const screen = (k: Kit, key: string, x: number, y0: number, z: number, w: number, h: number, n: V2, glow = 1.4) => {
  const t = tangent(n);
  const c = along({ x, z }, t, 0, n, 0.03);
  k.set(IS.METAL, 0.04, 0.04, 0.045);
  k.box(c.x, y0 - 0.04, c.z, w / 2 + 0.04, h + 0.08, 0.025, t);
  k.tex(key, x, y0, z, w, h, n, glow, 0.058);
};

export const plaque = (k: Kit, key: string, x: number, y0: number, z: number, w: number, h: number, n: V2, glow = 0.2) => {
  const t = tangent(n);
  const c = along({ x, z }, t, 0, n, 0.012);
  k.set(IS.METAL, 0.3, 0.26, 0.18);
  k.box(c.x, y0 - 0.02, c.z, w / 2 + 0.02, h + 0.04, 0.01, t);
  k.tex(key, x, y0, z, w, h, n, glow, 0.024);
};

export const pendantBar = (k: Kit, x0: number, x1: number, z: number, y: number, ceiling: number) => {
  k.set(IS.METAL, 0.12, 0.12, 0.13);
  for (const x of [x0 + 0.3, x1 - 0.3]) k.box(x, y, z, 0.006, ceiling - y, 0.006);
  k.box((x0 + x1) / 2, y - 0.05, z, (x1 - x0) / 2, 0.06, 0.06);
  k.set(IS.SOLID, 1.0, 0.94, 0.82, 1.8);
  k.box((x0 + x1) / 2, y - 0.056, z, (x1 - x0) / 2 - 0.03, 0.006, 0.045, { x: 1, z: 0 }, 0b100000);
};

export const exitSign = (k: Kit, x: number, y0: number, z: number, n: V2) => {
  const t = tangent(n);
  const c = along({ x, z }, t, 0, n, 0.05);
  k.set(IS.METAL, 0.85, 0.85, 0.82);
  k.box(c.x, y0, c.z, 0.2, 0.18, 0.05, t);
  k.tex('exit', x, y0 + 0.02, z, 0.36, 0.14, n, 1.6, 0.104);
};

export const extinguisher = (k: Kit, x: number, z: number, n: V2) => {
  const t = tangent(n);
  const c = along({ x, z }, t, 0, n, 0.11);
  k.set(IS.METAL, 0.62, 0.05, 0.04);
  k.cyl(c.x, 0.55, c.z, 0.08, 0.08, 0.52, 12, true);
  k.set(IS.METAL, 0.1, 0.1, 0.1);
  k.cyl(c.x, 1.07, c.z, 0.03, 0.02, 0.1, 8, true);
  const br = along({ x, z }, t, 0, n, 0.015);
  k.box(br.x, 0.75, br.z, 0.05, 0.1, 0.015, t);
  k.tex('fire', x, 1.32, z, 0.26, 0.26, n, 0.1);
};

export const floorLamp = (k: Kit, x: number, z: number) => {
  k.set(IS.METAL, 0.08, 0.08, 0.085);
  k.cyl(x, 0, z, 0.16, 0.16, 0.03, 12, true);
  k.cyl(x, 0.03, z, 0.012, 0.012, 1.5, 6, false);
  k.set(IS.SOLID, 1.0, 0.86, 0.6, 1.1);
  k.cyl(x, 1.42, z, 0.2, 0.15, 0.3, 14, true);
  k.solid(x, z, 0.16, 0.16, 1.7);
};

export const sideTable = (k: Kit, x: number, z: number, r: number, h: number) => {
  k.set(IS.WOOD, 0.2, 0.12, 0.07);
  k.cyl(x, h - 0.04, z, r, r, 0.04, 18, true);
  k.set(IS.METAL, 0.06, 0.06, 0.06);
  k.cyl(x, 0, z, 0.03, 0.03, h - 0.04, 6, false);
  k.cyl(x, 0, z, r * 0.6, r * 0.6, 0.02, 12, true);
  k.solid(x, z, r, r, h);
};

export const plant = (k: Kit, x: number, z: number, s = 1, pass = false) => {
  k.set(IS.METAL, 0.12, 0.12, 0.12);
  k.cyl(x, 0, z, 0.2 * s, 0.24 * s, 0.42 * s, 12, true);
  k.set(IS.LEAF, 0.12, 0.26, 0.1);
  k.blob(x, 0.75 * s, z, 0.32 * s, 0.38 * s, 0.32 * s, 0.4, Math.floor(x * 7 + z));
  k.blob(x + 0.12 * s, 1.0 * s, z - 0.08 * s, 0.22 * s, 0.3 * s, 0.22 * s, 0.4, Math.floor(x * 3 + z * 5));
  if (!pass) k.solid(x, z, 0.24 * s, 0.24 * s, 1.2 * s);
};

export const bench = (k: Kit, x: number, z: number, w: number, n: V2) => {
  const t = tangent(n);
  const c = along({ x, z }, t, 0, n, 0.25);
  k.set(IS.FABRIC, 0.16, 0.18, 0.2);
  k.box(c.x, 0.38, c.z, w / 2, 0.1, 0.22, t);
  k.set(IS.METAL, 0.08, 0.08, 0.08);
  for (const s of [-1, 1]) {
    const leg = along(c, t, s * (w / 2 - 0.08), n, 0);
    k.box(leg.x, 0, leg.z, 0.03, 0.38, 0.2, t);
  }
  k.solid(c.x, c.z, w / 2, 0.22, 0.5, t);
};

// ---------------- Basement ----------------

/** Pipe along x or z with flanges and brackets. */
export const pipe = (k: Kit, x0: number, z0: number, x1: number, z1: number, y: number, r: number, color: [number, number, number]) => {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.1) return;
  const dir = { x: dx / len, z: dz / len };
  k.set(IS.METAL, color[0], color[1], color[2]);
  k.hcyl((x0 + x1) / 2, y, (z0 + z1) / 2, dir, r, len, 10);
  for (let s = 1; s < len; s += 2.4) {
    const px = x0 + dir.x * s;
    const pz = z0 + dir.z * s;
    k.set(IS.METAL, color[0] * 0.7, color[1] * 0.7, color[2] * 0.7);
    k.hcyl(px, y, pz, dir, r * 1.35, 0.06, 10);
    k.set(IS.METAL, 0.12, 0.12, 0.12);
    k.box(px, y + r, pz, 0.025, 3.6 - y - r, 0.025);
  }
};

export const valve = (k: Kit, x: number, y: number, z: number, dir: { x: number; z: number }) => {
  k.set(IS.METAL, 0.5, 0.08, 0.06);
  k.hcyl(x, y + 0.18, z, { x: dir.z, z: -dir.x }, 0.12, 0.03, 12);
  k.set(IS.METAL, 0.2, 0.2, 0.2);
  k.cyl(x, y, z, 0.03, 0.03, 0.18, 6, false);
};

export const cableTray = (k: Kit, x0: number, z0: number, x1: number, z1: number, y: number) => {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const dir = { x: dx / len, z: dz / len };
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  k.set(IS.METAL, 0.28, 0.29, 0.3);
  k.box(cx, y, cz, len / 2, 0.02, 0.18, dir);
  const side = { x: -dir.z, z: dir.x };
  for (const s of [-1, 1]) k.box(cx + side.x * 0.18 * s, y, cz + side.z * 0.18 * s, len / 2, 0.08, 0.008, dir);
  const colors: [number, number, number][] = [[0.05, 0.05, 0.05], [0.4, 0.06, 0.04], [0.06, 0.12, 0.35], [0.5, 0.42, 0.05]];
  colors.forEach((c, i) => {
    k.set(IS.RUBBER, c[0], c[1], c[2]);
    k.hcyl(cx + side.x * (i - 1.5) * 0.08, y + 0.045, cz + side.z * (i - 1.5) * 0.08, dir, 0.025, len, 6);
  });
};

export const electricalPanel = (k: Kit, x: number, z: number, n: { x: number; z: number }, w = 0.6, h = 0.9) => {
  const t = tangent(n);
  const c = along({ x, z }, t, 0, n, 0.1);
  k.set(IS.METAL, 0.42, 0.44, 0.42);
  k.box(c.x, 1.0, c.z, w / 2, h, 0.1, t);
  k.set(IS.METAL, 0.3, 0.32, 0.3);
  const door = along(c, t, 0, n, 0.101);
  k.box(door.x, 1.04, door.z, w / 2 - 0.04, h - 0.08, 0.002, t);
  for (let i = 0; i < 3; i += 1) {
    const led = along(c, t, -w / 2 + 0.1 + i * 0.08, n, 0.105);
    k.set(IS.SOLID, i === 1 ? 1 : 0.2, i === 1 ? 0.2 : 1, 0.15, 1.6);
    k.box(led.x, 1.0 + h - 0.12, led.z, 0.015, 0.03, 0.005, t);
  }
  k.tex('highvolt', x, 1.6, z, 0.36, 0.27, n, 0.05, 0.21);
};

/** Metal shelving rack with jugs, bottles, and boxes. */
export const rack = (k: Kit, x: number, z: number, w: number, d: number, h: number, n: { x: number; z: number }, kind: 'chem' | 'boxes' | 'jars', seed = 0) => {
  const t = tangent(n);
  const c = along({ x, z }, t, 0, n, d / 2);
  k.set(IS.METAL, 0.26, 0.28, 0.3);
  for (const s of [-1, 1]) {
    for (const o of [-1, 1]) {
      const post = along(c, t, s * (w / 2 - 0.03), n, o * (d / 2 - 0.03));
      k.box(post.x, 0, post.z, 0.02, h, 0.02, t);
    }
  }
  const shelves = 4;
  for (let i = 0; i < shelves; i += 1) {
    const y = 0.12 + (h - 0.2) * (i / (shelves - 1));
    k.set(IS.METAL, 0.3, 0.32, 0.33);
    k.box(c.x, y, c.z, w / 2, 0.025, d / 2, t);
    if (i === shelves - 1) continue;
    const count = Math.floor(w / 0.22);
    for (let j = 0; j < count; j += 1) {
      const r = Math.abs(Math.sin((j + 1) * 12.9898 + (i + seed) * 78.233)) % 1;
      if (r < 0.18) continue;
      const p = along(c, t, -w / 2 + 0.14 + j * ((w - 0.2) / count), n, (r - 0.5) * d * 0.4);
      if (kind === 'chem') {
        const tint: [number, number, number] = r < 0.4 ? [0.85, 0.85, 0.8] : r < 0.6 ? [0.18, 0.35, 0.65] : r < 0.8 ? [0.75, 0.55, 0.1] : [0.6, 0.12, 0.1];
        k.set(IS.METAL, tint[0], tint[1], tint[2]);
        k.cyl(p.x, y + 0.025, p.z, 0.07, 0.07, 0.24 + r * 0.1, 10, true);
        k.set(IS.METAL, 0.08, 0.08, 0.08);
        k.cyl(p.x, y + 0.27 + r * 0.1, p.z, 0.03, 0.03, 0.04, 8, true);
      } else if (kind === 'jars') {
        k.set(IS.LIQUID, 0.25 + r * 0.3, 0.75, 0.3, 0.6);
        k.cyl(p.x, y + 0.025, p.z, 0.06, 0.06, 0.2, 10, true);
        k.set(IS.GLASS, 0.5, 0.6, 0.6);
        k.cyl(p.x, y + 0.025, p.z, 0.065, 0.065, 0.24, 10, false);
      } else {
        k.set(IS.WOOD, 0.45, 0.36, 0.22);
        k.box(p.x, y + 0.025, p.z, 0.1, 0.14 + r * 0.12, d / 2 - 0.08, t);
      }
    }
  }
  k.solid(c.x, c.z, w / 2, d / 2, h, t);
};

export const labBench = (k: Kit, x: number, z: number, w: number, d: number, n: { x: number; z: number }, seed = 0) => {
  const t = tangent(n);
  const c = along({ x, z }, t, 0, n, d / 2);
  k.set(IS.METAL, 0.38, 0.4, 0.4);
  k.box(c.x, 0, c.z, w / 2, 0.86, d / 2 - 0.04, t);
  k.set(IS.METAL, 0.06, 0.07, 0.07);
  k.box(c.x, 0.86, c.z, w / 2 + 0.02, 0.04, d / 2, t);
  // Drawer seams.
  k.set(IS.METAL, 0.2, 0.21, 0.21);
  for (let i = 0; i < Math.floor(w / 0.6); i += 1) {
    const s = along(c, t, -w / 2 + 0.6 * (i + 1), n, d / 2 - 0.035);
    k.box(s.x, 0.05, s.z, 0.004, 0.76, 0.003, t);
  }
  // Glassware and gear.
  for (let i = 0; i < 6; i += 1) {
    const r = Math.abs(Math.sin((i + 3) * 41.7 + seed * 9.1)) % 1;
    const p = along(c, t, -w / 2 + 0.2 + (w - 0.4) * (i / 5), n, (r - 0.5) * d * 0.5);
    if (i === 2) {
      k.set(IS.METAL, 0.1, 0.1, 0.11);
      k.box(p.x, 0.9, p.z, 0.22, 0.32, 0.03, t);
      k.set(IS.SCREEN, 0.3, 0.9, 0.6, 1.2, seed);
      const sc = along(p, t, 0, n, 0.031);
      k.box(sc.x, 0.93, sc.z, 0.2, 0.26, 0.002, t, 0b001000 | 0b000010);
      continue;
    }
    if (i === 4) {
      k.set(IS.METAL, 0.85, 0.85, 0.82);
      k.box(p.x, 0.9, p.z, 0.09, 0.08, 0.14, t);
      k.cyl(p.x, 0.98, p.z, 0.03, 0.03, 0.3, 8, true);
      k.set(IS.METAL, 0.1, 0.1, 0.1);
      k.cyl(p.x, 1.22, p.z + 0.02, 0.025, 0.02, 0.12, 8, true);
      continue;
    }
    const liquid: [number, number, number] = r < 0.33 ? [0.3, 0.9, 0.4] : r < 0.66 ? [0.3, 0.55, 1.0] : [1.0, 0.45, 0.15];
    k.set(IS.LIQUID, liquid[0], liquid[1], liquid[2], 0.5);
    k.cyl(p.x, 0.9, p.z, 0.05, 0.05, 0.08 + r * 0.06, 10, true);
    k.set(IS.GLASS, 0.6, 0.7, 0.72);
    k.cyl(p.x, 0.9, p.z, 0.055, 0.04, 0.2 + r * 0.1, 10, false);
  }
  k.solid(c.x, c.z, w / 2, d / 2, 0.92, t);
};

export const specimenTank = (k: Kit, x: number, z: number, r: number, h: number, tint: [number, number, number] = [0.25, 1.0, 0.45]) => {
  k.set(IS.METAL, 0.18, 0.19, 0.2);
  k.cyl(x, 0, z, r + 0.12, r + 0.12, 0.35, 18, true);
  k.cyl(x, h - 0.25, z, r + 0.1, r + 0.06, 0.3, 18, true);
  k.set(IS.LIQUID, tint[0], tint[1], tint[2], 0.9);
  k.cyl(x, 0.35, z, r - 0.04, r - 0.04, h - 0.7, 18, true);
  k.set(IS.SOLID, 0.12, 0.08, 0.07);
  k.blob(x, 0.35 + (h - 0.7) * 0.5, z, r * 0.35, (h - 0.7) * 0.25, r * 0.3, 0.6, Math.floor(x * 5 + z * 3));
  k.set(IS.GLASS, 0.55, 0.75, 0.7);
  k.cyl(x, 0.35, z, r, r, h - 0.6, 18, false);
  k.set(IS.METAL, 0.25, 0.25, 0.27);
  k.cyl(x + r * 0.5, h + 0.05, z, 0.04, 0.04, 3.4 - h, 8, false);
  k.cyl(x - r * 0.4, h + 0.05, z + r * 0.3, 0.03, 0.03, 3.4 - h, 8, false);
  k.solid(x, z, r + 0.12, r + 0.12, h);
};

export const serverRack = (k: Kit, x: number, z: number, n: { x: number; z: number }) => {
  const t = tangent(n);
  const c = along({ x, z }, t, 0, n, 0.5);
  k.set(IS.METAL, 0.05, 0.05, 0.055);
  k.box(c.x, 0, c.z, 0.3, 2.0, 0.5, t);
  for (let i = 0; i < 14; i += 1) {
    const y = 0.15 + i * 0.13;
    const face = along(c, t, -0.1, n, 0.502);
    k.set(IS.METAL, 0.1, 0.1, 0.11);
    k.box(face.x, y, face.z, 0.27, 0.1, 0.002, t, 0b001000);
    for (let j = 0; j < 3; j += 1) {
      const on = Math.sin(i * 3.7 + j * 1.9 + x) > -0.2;
      const led = along(c, t, 0.12 + j * 0.05, n, 0.505);
      k.set(IS.SOLID, on ? 0.2 : 1, on ? 1 : 0.6, on ? 0.4 : 0.1, on ? 1.6 : 1.2);
      k.box(led.x, y + 0.04, led.z, 0.008, 0.012, 0.002, t, 0b001000);
    }
  }
  k.solid(c.x, c.z, 0.3, 0.5, 2.0, t);
};

export const consoleDesk = (k: Kit, x: number, z: number, w: number, n: { x: number; z: number }, screenKey: string) => {
  const t = tangent(n);
  const c = along({ x, z }, t, 0, n, 0.45);
  k.set(IS.METAL, 0.16, 0.17, 0.18);
  k.box(c.x, 0, c.z, w / 2, 0.74, 0.4, t);
  k.set(IS.METAL, 0.08, 0.08, 0.09);
  k.box(c.x, 0.74, c.z, w / 2 + 0.02, 0.04, 0.44, t);
  const screens = Math.max(1, Math.floor(w / 0.8));
  for (let i = 0; i < screens; i += 1) {
    const s = -w / 2 + (w / screens) * (i + 0.5);
    const p = along(c, t, s, n, -0.25);
    k.set(IS.METAL, 0.05, 0.05, 0.05);
    k.box(p.x, 0.78, p.z, 0.04, 0.2, 0.04, t);
    // Screen faces into the room (toward +n).
    const sp = along(c, t, s, n, -0.2);
    k.set(IS.METAL, 0.04, 0.04, 0.045);
    k.box(sp.x, 0.98, sp.z, 0.34, 0.4, 0.02, t);
    k.tex(screenKey, sp.x - n.x * 0.0, 1.0, sp.z - n.z * 0.0, 0.64, 0.36, n, 1.3, 0.022);
  }
  // Keyboard.
  const kb = along(c, t, 0, n, 0.12);
  k.set(IS.METAL, 0.12, 0.12, 0.13);
  k.box(kb.x, 0.78, kb.z, 0.22, 0.02, 0.07, t);
  k.solid(c.x, c.z, w / 2, 0.42, 0.82, t);
};

export const boiler = (k: Kit, x: number, z: number, r: number, h: number) => {
  k.set(IS.METAL, 0.32, 0.18, 0.1);
  k.cyl(x, 0.25, z, r, r, h, 20, true);
  k.set(IS.METAL, 0.2, 0.2, 0.2);
  k.cyl(x, 0, z, r * 0.9, r * 0.9, 0.25, 16, true);
  k.blob(x, 0.25 + h, z, r, r * 0.35, r);
  for (let i = 0; i < 4; i += 1) {
    k.set(IS.METAL, 0.18, 0.18, 0.18);
    k.cyl(x, 0.6 + i * (h / 4), z, r + 0.02, r + 0.02, 0.05, 20, false);
  }
  k.set(IS.METAL, 0.85, 0.85, 0.8);
  k.cyl(x + r + 0.03, 1.4, z, 0.08, 0.08, 0.04, 12, true);
  k.set(IS.METAL, 0.28, 0.3, 0.32);
  k.cyl(x, 0.25 + h + r * 0.3, z, 0.12, 0.12, 3.5 - (0.25 + h + r * 0.3), 10, false);
  k.solid(x, z, r, r, h + 0.6);
};

export const medCart = (k: Kit, x: number, z: number, ax = { x: 1, z: 0 }) => {
  k.set(IS.METAL, 0.7, 0.72, 0.72);
  k.box(x, 0.12, z, 0.35, 0.03, 0.25, ax);
  k.box(x, 0.85, z, 0.35, 0.03, 0.25, ax);
  k.set(IS.METAL, 0.5, 0.52, 0.52);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(x + ax.x * 0.33 * sx - ax.z * 0.23 * sz, 0.05, z + ax.z * 0.33 * sx + ax.x * 0.23 * sz, 0.012, 0.8, 0.012, ax);
  k.set(IS.METAL, 0.85, 0.85, 0.82);
  k.box(x, 0.88, z, 0.12, 0.05, 0.08, ax);
  k.set(IS.LIQUID, 0.8, 0.15, 0.1, 0.2);
  k.cyl(x + ax.x * 0.2, 0.88, z + ax.z * 0.2, 0.03, 0.03, 0.12, 8, true);
  k.solid(x, z, 0.36, 0.26, 0.95, ax);
};

export const ivStand = (k: Kit, x: number, z: number) => {
  k.set(IS.METAL, 0.6, 0.62, 0.62);
  k.cyl(x, 0, z, 0.22, 0.22, 0.03, 5, true);
  k.cyl(x, 0.03, z, 0.012, 0.012, 1.9, 6, false);
  k.box(x, 1.9, z, 0.16, 0.012, 0.012);
  k.set(IS.LIQUID, 0.7, 0.9, 0.95, 0.15);
  k.box(x + 0.12, 1.62, z, 0.05, 0.22, 0.02);
};

export const surgicalLamp = (k: Kit, x: number, z: number, ceiling: number) => {
  k.set(IS.METAL, 0.7, 0.72, 0.72);
  k.cyl(x, ceiling - 0.6, z, 0.03, 0.03, 0.6, 8, false);
  k.box(x + 0.35, ceiling - 0.65, z, 0.38, 0.05, 0.04);
  k.cyl(x + 0.7, 2.0, z, 0.36, 0.3, 0.16, 20, true);
  k.set(IS.SOLID, 0.95, 0.98, 1.0, 1.3);
  for (const [dx, dz] of [[0, 0], [0.14, 0.08], [-0.14, 0.08], [0, -0.16]]) k.cyl(x + 0.7 + dx, 1.995, z + dz, 0.06, 0.06, 0.01, 10, true);
};

/** Steel door frame with a hazard band and a sign above, around a doorway in a wall along `t`. */
export const doorFrame = (k: Kit, x: number, z: number, width: number, t: { x: number; z: number }, height = 2.4, sign = '', signSide: 1 | -1 = 1) => {
  const n = { x: t.z, z: -t.x };
  k.set(IS.METAL, 0.22, 0.23, 0.24);
  for (const s of [-1, 1]) {
    const j = along({ x, z }, t, s * (width / 2 + 0.06), n, 0);
    k.box(j.x, 0, j.z, 0.08, height, 0.2, t);
    k.set(IS.HAZARD, 1, 1, 1);
    k.box(j.x, 0.02, j.z, 0.081, 0.9, 0.201, t, 0b001111);
    k.set(IS.METAL, 0.22, 0.23, 0.24);
  }
  k.box(x, height, z, width / 2 + 0.14, 0.18, 0.2, t);
  if (sign) {
    const nn = { x: n.x * signSide, z: n.z * signSide };
    k.tex(sign, x, height + 0.25, z, 1.0, 0.3, nn, 0.15, 0.205);
  }
};

export const hazardTape = (k: Kit, minX: number, maxX: number, minZ: number, maxZ: number, y = 0.012) => {
  k.set(IS.HAZARD, 1, 1, 1);
  k.g.quad([minX, y, minZ], [maxX, y, minZ], [maxX, y, maxZ], [minX, y, maxZ], [0, 1, 0], [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]]);
};

export const beacon = (k: Kit, x: number, y: number, z: number) => {
  k.set(IS.METAL, 0.1, 0.1, 0.1);
  k.cyl(x, y - 0.06, z, 0.07, 0.07, 0.06, 10, true);
  k.set(IS.SOLID, 1.0, 0.12, 0.06, 1.2);
  k.blob(x, y + 0.02, z, 0.06, 0.08, 0.06);
};

export const ventGrille = (k: Kit, x: number, y0: number, z: number, w: number, h: number, n: { x: number; z: number }) => {
  const t = tangent(n);
  const c = along({ x, z }, t, 0, n, 0.02);
  k.set(IS.METAL, 0.3, 0.31, 0.32);
  k.box(c.x, y0, c.z, w / 2, h, 0.02, t);
  k.set(IS.METAL, 0.06, 0.06, 0.06);
  for (let i = 1; i < Math.floor(h / 0.06); i += 1) {
    const s = along(c, t, 0, n, 0.021);
    k.box(s.x, y0 + i * 0.06, s.z, w / 2 - 0.04, 0.012, 0.003, t, 0b001010);
  }
};

export const eyewash = (k: Kit, x: number, z: number, n: { x: number; z: number }) => {
  const t = tangent(n);
  const c = along({ x, z }, t, 0, n, 0.25);
  k.set(IS.METAL, 0.75, 0.62, 0.05);
  k.cyl(c.x, 0, c.z, 0.04, 0.04, 1.0, 8, false);
  k.cyl(c.x, 1.0, c.z, 0.22, 0.12, 0.12, 14, true);
  k.cyl(c.x, 1.12, c.z, 0.03, 0.03, 1.1, 8, false);
  k.cyl(c.x, 2.15, c.z, 0.2, 0.08, 0.1, 14, true);
  k.tex('eyewash', x, 1.6, z, 0.38, 0.24, n, 0.05);
  k.solid(c.x, c.z, 0.22, 0.22, 1.2);
};

export const papers = (k: Kit, x: number, z: number, count: number, seed = 0, y = 0.012) => {
  for (let i = 0; i < count; i += 1) {
    const r = Math.abs(Math.sin((i + 1) * 91.7 + seed * 13.1));
    const a = r * Math.PI * 2;
    const px = x + Math.cos(a * 1.7) * r * 0.9;
    const pz = z + Math.sin(a * 2.3) * r * 0.9;
    k.set(IS.SOLID, 0.78, 0.76, 0.7);
    k.box(px, y + i * 0.0006, pz, 0.105, 0.002, 0.15, { x: Math.cos(a), z: Math.sin(a) }, 0b010000);
  }
};
