import type { InteriorPlan, Kit } from './dress';
import { artFrame, bench, bookshelf, exitSign, extinguisher, floorLamp, pendantBar, plant, plaque, rug, sconce, screen, sideTable } from './furniture';
import { IS } from './shader';

/**
 * The 58th floor: Hall 1 runs north from the lift, Hall 2 east to the boardroom,
 * Pierce's office sits north of the boardroom behind the glass, the restroom is
 * off Hall 2. Walls are plaster over wood wainscot in the halls, walnut slats in
 * the boardroom, walnut and paper in the office.
 */

const W = { x: 1, z: 0 };
const E = { x: -1, z: 0 };
const N = { x: 0, z: -1 };
const S = { x: 0, z: 1 };

/** Wood casing around an existing office door (GLB is 1.04 x 2.1). */
const casing = (k: Kit, x: number, z: number, n: { x: number; z: number }) => {
  const t = { x: -n.z, z: n.x };
  const out = 0.03;
  k.set(IS.WOOD, 0.2, 0.12, 0.07);
  for (const s of [-1, 1]) {
    const px = x + t.x * s * 0.6 + n.x * out;
    const pz = z + t.z * s * 0.6 + n.z * out;
    k.box(px, 0, pz, 0.06, 2.18, 0.03, t);
  }
  k.box(x + n.x * out, 2.12, z + n.z * out, 0.66, 0.1, 0.03, t);
};

export const apexPlan: InteriorPlan = {
  rooms: [
    { id: 'hall1', minX: -2.2, maxX: 2.2, minZ: -1, maxZ: 34.25, wall: IS.OFFICE_WALL, wallVar: 0.15, floor: IS.CARPET, floorVar: 0, ceil: IS.ACOUSTIC },
    { id: 'hall2', minX: 2.2, maxX: 35.3, minZ: 29.8, maxZ: 34.26, wall: IS.OFFICE_WALL, wallVar: 0.15, floor: IS.CARPET, floorVar: 0, ceil: IS.ACOUSTIC },
    { id: 'board', minX: 35.2, maxX: 53, minZ: 24, maxZ: 40, wall: IS.WOOD_SLATS, floor: IS.CARPET, floorVar: 1, ceil: IS.ACOUSTIC },
    { id: 'office', minX: 43.2, maxX: 52.76, minZ: 40.1, maxZ: 47, wall: IS.WALNUT_PAPER, floor: IS.PLANKS, ceil: IS.ACOUSTIC },
    { id: 'bath', minX: 15.6, maxX: 20.4, minZ: 25.5, maxZ: 29.56, wall: IS.BATH_TILE, floor: IS.SMALL_TILE, ceil: IS.ACOUSTIC },
  ],
  skip: /^(lift-|floor-lift|office-wall-n|board-glass|office-glass|bath-stall|bath-door|bath-jamb|trim-|ceil-lift)/,
  hide: /^trim-/,
  keepClear: [
    { x: 0, z: 4.1, r: 1.5 },
    { x: 48, z: 46.2, r: 1.2 },
    { x: 48, z: 41.7, r: 1.4 },
    { x: 44, z: 24.5, r: 2 },
  ],
  build: (k) => {
    // ---------- Hall 1 (west wall x = -2.2 faces east, east wall x = 2.2 faces west) ----------
    const doorsH1W = [8, 18, 26];
    const doorsH1E = [6, 14, 22];
    for (const z of doorsH1W) casing(k, -2.2, z, W);
    for (const z of doorsH1E) casing(k, 2.2, z, E);
    artFrame(k, 'art-0', -2.2, 1.25, 4.6, 1.1, 0.95, W);
    artFrame(k, 'art-1', -2.2, 1.15, 21.8, 0.9, 1.15, W);
    artFrame(k, 'art-2', -2.2, 1.3, 32.2, 1.0, 0.95, W);
    artFrame(k, 'art-3', 2.2, 1.15, 10, 0.9, 1.15, E);
    artFrame(k, 'art-4', 2.2, 1.25, 26.5, 1.1, 0.95, E);
    for (const z of [2.6, 12.9, 23.6, 30]) sconce(k, -2.2, 2.05, z, W);
    for (const z of [3.6, 8.8, 18.6, 28.8]) sconce(k, 2.2, 2.05, z, E);
    exitSign(k, 0, 2.55, -1, S);
    extinguisher(k, 2.2, 1.0, E);
    bench(k, -2.2, 2.4, 1.3, W);

    // ---------- Hall 2 (south wall z = 29.8 faces north, north wall z = 34.26 faces south) ----------
    for (const x of [6, 14, 22, 30]) casing(k, x, 29.8, S);
    for (const x of [8, 16, 24]) casing(k, x, 34.26, N);
    artFrame(k, 'art-5', 4.4, 1.25, 34.26, 1.0, 1.1, N);
    artFrame(k, 'art-0', 20, 1.3, 34.26, 1.2, 0.95, N);
    artFrame(k, 'art-3', 28, 1.15, 34.26, 0.9, 1.15, N);
    artFrame(k, 'art-2', 26, 1.3, 29.8, 1.0, 0.95, S);
    artFrame(k, 'art-4', 33.4, 1.25, 29.8, 1.1, 0.95, S);
    for (const x of [4.6, 12, 20, 28, 34]) sconce(k, x, 2.05, 34.26, N);
    for (const x of [10, 26.2]) sconce(k, x, 2.05, 29.8, S);
    plaque(k, 'restroom', 17.95, 2.42, 29.8, 0.7, 0.2, N);
    plaque(k, 'restroom', 17.95, 2.42, 29.8, 0.7, 0.2, S);
    extinguisher(k, 34.6, 29.8, S);
    plant(k, 34.6, 33.7, 1.05);

    // ---------- Boardroom ----------
    screen(k, 'chart', 36.0, 1.45, 27.2, 2.4, 1.35, W, 1.25);
    plaque(k, 'logo', 39.6, 1.85, 40, 1.7, 0.53, N, 0.25);
    plaque(k, 'meeting', 33.6, 2.42, 34.26, 0.9, 0.27, N);
    artFrame(k, 'art-1', 39.5, 1.2, 24, 1.0, 1.25, S);
    artFrame(k, 'art-5', 48.4, 1.25, 24, 1.1, 1.2, S);
    pendantBar(k, 40.5, 48.0, 32, 2.55, 3.2);
    sideTable(k, 37.3, 39.1, 0.28, 0.55);
    floorLamp(k, 41.9, 39.25);
    plant(k, 52.2, 25.6, 1.1);

    // ---------- Pierce's office ----------
    rug(k, 45.2, 50.8, 40.9, 45.2, 0.36, 0.12, 0.1);
    bookshelf(k, 43.24, 45.9, 1.3, 2.2, 0.36, W, 2);
    bookshelf(k, 43.24, 41.5, 1.3, 2.2, 0.36, W, 5);
    artFrame(k, 'art-4', 52.76, 1.75, 42.4, 1.0, 0.85, E);
    plaque(k, 'office', 51.1, 2.42, 40.0, 0.9, 0.27, N);
    floorLamp(k, 51.9, 45.6);
    sconce(k, 52.76, 2.05, 45.3, E);
  },
};
