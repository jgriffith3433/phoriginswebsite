import type { InteriorPlan } from './dress';
import {
  beacon, elevatorCab, boiler, cableTray, consoleDesk, doorFrame, electricalPanel, extinguisher, eyewash, ivStand, labBench, medCart,
  papers, pipe, rack, screen, serverRack, specimenTank, surgicalLamp, valve, ventGrille,
} from './furniture';
import { IS } from './shader';

/**
 * Sub-level B3. Steel panels in the pipe hall, painted block in the halls and
 * stores, stained tile in the lab, decon, cells, and the transformation wing,
 * board-formed concrete in utility. Props stay along walls and out of doorways,
 * the vat approach, the creature's flee route, and the stairs in the wing.
 */

/** Facing normals: into the room from a wall on that side. */
const W = { x: 1, z: 0 };
const E = { x: -1, z: 0 };
const S = { x: 0, z: 1 };
const N = { x: 0, z: -1 };
const X = { x: 1, z: 0 };
const Z = { x: 0, z: 1 };

const STEEL: [number, number, number] = [0.32, 0.34, 0.35];
const RED: [number, number, number] = [0.42, 0.08, 0.06];
const GREEN: [number, number, number] = [0.12, 0.26, 0.16];
const YELLOW: [number, number, number] = [0.6, 0.48, 0.08];
const COPPER: [number, number, number] = [0.45, 0.24, 0.12];

export const b3Plan: InteriorPlan = {
  rooms: [
    { id: 'pipeHall', minX: 41.5, maxX: 46.5, minZ: 24, maxZ: 35.6, wall: IS.STEEL_PANEL, floor: IS.DIAMOND, ceil: IS.CONCRETE_CEIL },
    { id: 'hallB', minX: 16.4, maxX: 46.75, minZ: 35.6, maxZ: 40.45, wall: IS.BLOCK, wallVar: 0, floor: IS.EPOXY, floorVar: 0, ceil: IS.CONCRETE_CEIL },
    { id: 'lab', minX: 0, maxX: 16.4, minZ: 30.9, maxZ: 45.1, wall: IS.LAB_TILE, wallVar: 0, floor: IS.LAB_FLOOR, floorVar: 0, ceil: IS.CONCRETE_CEIL },
    { id: 'decon', minX: 1.1, maxX: 14.9, minZ: 22.1, maxZ: 30.9, wall: IS.LAB_TILE, wallVar: 1, floor: IS.LAB_FLOOR, floorVar: 1, ceil: IS.CONCRETE_CEIL },
    { id: 'chemA', minX: 18.5, maxX: 28.6, minZ: 27, maxZ: 35.6, wall: IS.BLOCK, wallVar: 1, floor: IS.EPOXY, floorVar: 1, ceil: IS.CONCRETE_CEIL },
    { id: 'chemB', minX: 28.6, maxX: 40.3, minZ: 27, maxZ: 35.6, wall: IS.BLOCK, wallVar: 1, floor: IS.EPOXY, floorVar: 1, ceil: IS.CONCRETE_CEIL },
    { id: 'cell', minX: 18.7, maxX: 40.4, minZ: 40.45, maxZ: 52.8, wall: IS.LAB_TILE, wallVar: 1, floor: IS.EPOXY, floorVar: 0, ceil: IS.CONCRETE_CEIL },
    { id: 'service', minX: 40.4, maxX: 46.5, minZ: 40.45, maxZ: 52.8, wall: IS.STEEL_PANEL, floor: IS.DIAMOND, ceil: IS.CONCRETE_CEIL },
    { id: 'control', minX: 0.2, maxX: 16.4, minZ: 45.1, maxZ: 52.8, wall: IS.BLOCK, wallVar: 0, floor: IS.EPOXY, floorVar: 0, ceil: IS.CONCRETE_CEIL },
    { id: 'transform', minX: 46.75, maxX: 63, minZ: 30, maxZ: 52.85, wall: IS.LAB_TILE, wallVar: 0, floor: IS.LAB_FLOOR, floorVar: 0, ceil: IS.CONCRETE_CEIL },
    { id: 'corridor', minX: 0.3, maxX: 63, minZ: 52.8, maxZ: 56.5, wall: IS.BLOCK, wallVar: 0, floor: IS.DIAMOND, ceil: IS.CONCRETE_CEIL },
    { id: 'utility', minX: 16, maxX: 44, minZ: 56.5, maxZ: 63, wall: IS.CONCRETE, floor: IS.EPOXY, floorVar: 1, ceil: IS.CONCRETE_CEIL },
  ],
  skip: /lift|door|glass|vat|decal|sign|puddle|window|ceil-lift/,
  hide: /^fixture-light-lift$/,
  keepClear: [
    { x: 16.8, z: 38, r: 2.5 },
    { x: 7, z: 38.3, r: 4.2 },
    { x: 10.4, z: 36.4, r: 1.6 },
    { x: 18.5, z: 38, r: 1.6 },
    { x: 7.5, z: 26, r: 2.6 },
    { x: 44, z: 22, r: 2.6 },
    { x: 59.6, z: 48, r: 3.6 },
  ],
  build: (k) => {
    elevatorCab(k);
    // ---------- Doorway frames ----------
    doorFrame(k, 22.6, 35.7, 2.0, X, 2.4);
    doorFrame(k, 42.65, 40.45, 2.7, X, 2.4);
    doorFrame(k, 4.2, 45.1, 2.2, X, 2.4);
    doorFrame(k, 6.9, 30.9, 2.2, X, 2.4);
    doorFrame(k, 7.47, 52.8, 1.85, X, 2.4);
    doorFrame(k, 17.47, 52.8, 2.55, X, 2.4);
    doorFrame(k, 55.45, 52.85, 1.8, X, 2.4);
    doorFrame(k, 27.1, 56.5, 2.0, X, 2.4);
    doorFrame(k, 46.75, 37.9, 2.7, Z, 2.4);

    // ---------- Pipe hall ----------
    cableTray(k, 41.9, 24.4, 41.9, 35.2, 2.85);
    electricalPanel(k, 46.5, 26.4, E);
    electricalPanel(k, 46.5, 33.6, E, 0.5, 0.7);
    extinguisher(k, 41.5, 31.8, W);
    ventGrille(k, 41.5, 0.25, 28.6, 0.9, 0.45, W);
    beacon(k, 44, 3.05, 24.5);
    k.tex('level', 46.5, 2.2, 25.4, 1.2, 0.4, E, 0.15);

    // ---------- Hall B ----------
    pipe(k, 17, 39.95, 46.4, 39.95, 3.05, 0.11, GREEN);
    pipe(k, 17, 39.65, 46.4, 39.65, 3.15, 0.07, COPPER);
    pipe(k, 17, 36.15, 41, 36.15, 3.1, 0.09, STEEL);
    valve(k, 30, 2.75, 39.95, X);
    cableTray(k, 17.2, 36.5, 40.6, 36.5, 2.75);
    eyewash(k, 19.4, 35.7, S);
    k.tex('biohazard', 27.5, 1.45, 35.7, 0.62, 0.39, S, 0.05);
    k.tex('nosmoke', 35, 1.5, 35.7, 0.32, 0.32, S, 0.05);
    extinguisher(k, 36.5, 40.45, N);
    ventGrille(k, 26.5, 0.25, 40.45, 1.0, 0.45, N);
    beacon(k, 46.4, 2.9, 37.9);

    // ---------- Acid vat lab ----------
    labBench(k, 0, 36.2, 2.6, 0.75, W, 1);
    labBench(k, 0, 40.3, 2.6, 0.75, W, 2);
    rack(k, 11.4, 30.9, 2.2, 0.5, 2.0, S, 'jars', 3);
    specimenTank(k, 13.4, 32.4, 0.5, 2.3);
    specimenTank(k, 15.2, 32.4, 0.5, 2.3, [0.4, 0.9, 1.0]);
    eyewash(k, 16.4, 43.6, E);
    k.tex('acid', 9.6, 1.6, 45.1, 0.7, 0.44, N, 0.05);
    k.tex('biohazard', 0, 1.7, 33.6, 0.62, 0.39, W, 0.05);
    papers(k, 3.2, 38.4, 5, 1);

    // ---------- Decon ----------
    for (const x of [10.8, 12.6]) {
      k.set(IS.METAL, 0.62, 0.5, 0.08);
      k.box(x, 0, 23.0, 0.04, 2.4, 0.04);
      k.box(x, 2.4, 23.5, 0.04, 0.04, 0.5);
      k.set(IS.METAL, 0.7, 0.72, 0.72);
      k.cyl(x, 2.32, 24.0, 0.12, 0.06, 0.08, 12, true);
      k.solid(x, 23.0, 0.08, 0.08, 2.4);
    }
    k.tex('biohazard', 8.6, 1.6, 22.1, 0.62, 0.39, S, 0.05);
    ventGrille(k, 1.1, 2.4, 27.5, 0.8, 0.5, W);
    for (const z of [24.6, 25.4, 26.2]) {
      k.set(IS.FABRIC, 0.62, 0.5, 0.1);
      k.blob(1.32, 1.35, z, 0.16, 0.42, 0.2, 0.25, Math.floor(z * 10));
      k.set(IS.METAL, 0.2, 0.2, 0.2);
      k.box(1.18, 1.75, z, 0.08, 0.03, 0.02);
    }
    papers(k, 10, 28.5, 3, 4);

    // ---------- Chem stores ----------
    rack(k, 23.4, 27, 2.4, 0.55, 2.1, S, 'chem', 1);
    rack(k, 28.1, 31.4, 2.4, 0.5, 2.1, E, 'chem', 4);
    rack(k, 35.6, 27, 2.4, 0.55, 2.1, S, 'chem', 7);
    rack(k, 29.1, 32.2, 2.2, 0.5, 2.1, W, 'boxes', 2);
    k.tex('acid', 26.1, 1.7, 27.0, 0.62, 0.39, S, 0.05);
    k.tex('nosmoke', 33.4, 1.6, 27.0, 0.32, 0.32, S, 0.05);
    extinguisher(k, 18.5, 30.9, W);
    ventGrille(k, 40.3, 2.4, 30.5, 0.9, 0.5, E);

    // ---------- Cells ----------
    for (const [x, tint] of [[28.2, [0.3, 1.0, 0.45]], [30.6, [0.25, 0.85, 0.95]], [33, [0.3, 1.0, 0.45]], [35.4, [0.9, 0.5, 0.2]]] as const) {
      specimenTank(k, x, 51.7, 0.55, 2.4, [tint[0], tint[1], tint[2]]);
    }
    medCart(k, 26.2, 47.4);
    ivStand(k, 27.6, 49.4);
    rack(k, 40.4, 50.4, 2.0, 0.45, 2.0, E, 'jars', 6);
    k.tex('cold', 18.7, 1.7, 46.2, 0.5, 0.31, W, 0.05);
    papers(k, 24.5, 44.5, 4, 2);

    // ---------- Service ----------
    labBench(k, 44.1, 52.8, 2.6, 0.75, N, 5);
    electricalPanel(k, 46.5, 48.8, E);
    electricalPanel(k, 46.5, 51.2, E, 0.5, 0.7);
    cableTray(k, 46.1, 40.9, 46.1, 52.4, 2.85);

    // ---------- Control ----------
    consoleDesk(k, 11.6, 52.8, 3.2, N, 'cctv');
    serverRack(k, 0.2, 46.6, W);
    serverRack(k, 0.2, 51.6, W);
    screen(k, 'cctv', 0.2, 1.45, 49.2, 1.8, 1.0, W, 1.3);
    k.tex('highvolt', 16.4, 1.7, 47.4, 0.44, 0.33, E, 0.05);
    papers(k, 9.5, 49, 6, 3);

    // ---------- Transformation wing ----------
    surgicalLamp(k, 52.3, 33.5, 3.5);
    surgicalLamp(k, 58.3, 33.9, 3.5);
    ivStand(k, 54.6, 32.3);
    ivStand(k, 60.6, 32.7);
    medCart(k, 51.6, 35.4);
    medCart(k, 57.6, 35.8);
    screen(k, 'vitals', 53, 1.4, 30, 0.9, 0.56, S, 1.3);
    screen(k, 'vitals', 59, 1.4, 30, 0.9, 0.56, S, 1.3);
    specimenTank(k, 62.2, 37.6, 0.5, 2.3);
    specimenTank(k, 62.2, 39.6, 0.5, 2.3, [0.4, 0.9, 1.0]);
    rack(k, 46.75, 44.5, 2.2, 0.5, 2.0, W, 'jars', 8);
    k.tex('biohazard', 63, 1.7, 42.4, 0.62, 0.39, E, 0.05);
    papers(k, 55.6, 38.5, 5, 6);

    // ---------- Corridor ----------
    pipe(k, 0.8, 56.05, 62.6, 56.05, 3.05, 0.12, RED);
    pipe(k, 0.8, 55.72, 62.6, 55.72, 3.18, 0.07, STEEL);
    cableTray(k, 0.8, 53.25, 62.4, 53.25, 2.9);
    extinguisher(k, 12, 56.5, N);
    extinguisher(k, 48, 56.5, N);
    electricalPanel(k, 40, 56.5, N);
    for (const x of [6, 30, 54]) beacon(k, x, 3.1, 54.6);
    ventGrille(k, 20, 0.25, 56.5, 1.0, 0.45, N);

    // ---------- Utility ----------
    boiler(k, 33.6, 60.6, 1.0, 2.1);
    boiler(k, 38.2, 60.6, 1.0, 2.1);
    pipe(k, 33.6, 62.4, 42.5, 62.4, 2.6, 0.13, YELLOW);
    pipe(k, 34.6, 60.6, 37.2, 60.6, 1.3, 0.08, COPPER);
    valve(k, 35.9, 1.42, 60.6, X);
    electricalPanel(k, 22, 63, N);
    electricalPanel(k, 24.4, 63, N, 0.5, 0.7);
    rack(k, 16, 61, 2.0, 0.5, 2.0, W, 'boxes', 9);
    k.tex('highvolt', 23.2, 2.25, 63, 0.44, 0.33, N, 0.05);
  },
};
