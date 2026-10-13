/**
 * Going Home city plan. Pure data, deterministic, no Babylon.
 *
 * Downtown is a grid of avenues (east-west) and cross streets (north-south)
 * around Pierce's tower and the station stairs. Outside it the roads curve:
 * connectors fan out to an inner ring, radials meander out to an outer ring
 * and the edge, crescents and cul-de-sacs fill the suburbs.
 *
 * Every road is a centerline polyline. Junctions cut the ribbons and get an
 * asphalt patch, rounded curbs, and sidewalk corners, so nothing overlaps.
 */
import {
  type OBB, type Rand, type V2, Grid, add, ccw, clamp, cross, cumulative, dist, dot, earcut, hash2, hermite,
  lineHit, noise1, norm, obbCorners, obbOverlap, obbPush, offsetLine, pick, pointAt, quadBezier, range, resample,
  rightOf, rng, scale, segDist, segHit, slice, sub, tangentAt,
} from './math2';

export const CITY_SEED = 20261013;
export const CHUNK = 160;
export const CURB = 0.14;

export const AVENUES = [-144, -56, 32, 120, 208];
export const CROSSES = [-126, -42, 42, 126, 210, 294];
export const DOWNTOWN = { minX: -126, maxX: 294, minZ: -144, maxZ: 208 };
export const CENTER: V2 = { x: 84, z: 32 };
export const ELLIPSE = 1.08;
export const CITY_RADIUS = 1150;

/** Station stairs (authored pit) and the lobby interior (authored). */
export const STATION_PIT = { minX: 163.2, maxX: 172, minZ: 18.3, maxZ: 24.1 };
export const LOBBY = { minX: -7, maxX: 7, minZ: 0.2, maxZ: 17.7 };
export const STATION_STAIRS: V2 = { x: 163.5, z: 21.2 };

export type RoadClass = 'avenue' | 'street' | 'boulevard' | 'arterial' | 'collector' | 'lane';

export type RoadSpec = {
  half: number;
  walk: number;
  lanes: number;
  laneW: number;
  median: number;
  parking: boolean;
  speed: number;
  /** 0 none, 1 double yellow, 2 dashed yellow. */
  center: number;
};

export const ROAD_SPEC: Record<RoadClass, RoadSpec> = {
  avenue: { half: 6, walk: 6, lanes: 2, laneW: 2.9, median: 0.15, parking: false, speed: 11, center: 1 },
  street: { half: 5, walk: 6, lanes: 1, laneW: 3.1, median: 0, parking: true, speed: 8.5, center: 1 },
  boulevard: { half: 7.6, walk: 4, lanes: 2, laneW: 3.4, median: 0.5, parking: false, speed: 14, center: 1 },
  arterial: { half: 6, walk: 3.4, lanes: 2, laneW: 2.9, median: 0.15, parking: false, speed: 12.5, center: 1 },
  collector: { half: 4.8, walk: 2.8, lanes: 1, laneW: 3.1, median: 0, parking: true, speed: 9.5, center: 2 },
  lane: { half: 3.7, walk: 2.2, lanes: 1, laneW: 3.0, median: 0, parking: false, speed: 6.5, center: 0 },
};

export type Road = {
  id: number;
  cls: RoadClass;
  spec: RoadSpec;
  pts: V2[];
  cum: number[];
  len: number;
  closed: boolean;
  grid: boolean;
};

export type Piece = {
  id: number;
  road: Road;
  pts: V2[];
  cum: number[];
  len: number;
  j0: Junction;
  j1: Junction;
  cut0: number;
  cut1: number;
  /** Sidewalk cuts. L is ccw of the piece heading, R is the other side. */
  side0L: number;
  side0R: number;
  side1L: number;
  side1R: number;
  /** Crosswalk / stop line at each end. */
  walk0: boolean;
  walk1: boolean;
  /** Grid axis, for signals. */
  axis: 'x' | 'z' | '';
};

export type Arm = {
  piece: Piece;
  atStart: boolean;
  d: V2;
  angle: number;
  half: number;
  walk: number;
  cut: number;
  sideL: number;
  sideR: number;
};

export type Junction = {
  id: number;
  x: number;
  z: number;
  arms: Arm[];
  signal: boolean;
  crosswalk: boolean;
  radius: number;
  dead: boolean;
  patch: V2[];
  corners: V2[][];
  curbs: V2[][];
  outers: V2[][];
  bulb: number;
};

export const STYLE = {
  GLASS: 0,
  CONCRETE: 1,
  BRICK: 2,
  STONE: 3,
  DARK: 4,
  STUCCO: 5,
  SIDING: 6,
  WAREHOUSE: 7,
  APEX: 8,
} as const;

export type Mass = {
  obb: OBB;
  y0: number;
  y1: number;
  /** 0 flat, 1 gable along local x. */
  roof: number;
  ridge: number;
  /** Faces that keep a storefront at the base (bit per face: +x, +z, -x, -z). */
  street: number;
  gfh: number;
};

export type Store = {
  id: 'market' | 'diner' | 'news';
  name: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  doorX: number;
  keeper: V2;
  asset: string;
  tint: [number, number, number];
};

export type Building = {
  id: number;
  obb: OBB;
  masses: Mass[];
  style: number;
  seed: number;
  floorH: number;
  bay: number;
  height: number;
  lit: number;
  store: Store | null;
  district: District;
  tall: boolean;
};

export type PropKind =
  | 'lamp' | 'signal' | 'hydrant' | 'bin' | 'bench' | 'tree' | 'newsbox' | 'busstop' | 'meter' | 'bollard'
  | 'mailbox' | 'car' | 'globe' | 'fountain' | 'planter' | 'dumpster' | 'sign' | 'blade' | 'billboard'
  | 'awning' | 'tank' | 'hvac' | 'antenna' | 'grate' | 'fence' | 'cone';

export type Prop = {
  kind: PropKind;
  x: number;
  z: number;
  y: number;
  /** Facing. For street props this is toward the road. */
  f: V2;
  a: number;
  b: number;
  c: number;
  g?: V2;
};

export type Light = { x: number; z: number; r: number; color: number; i: number; y: number };

/** Light palette for the light map sprites. */
export const LIGHT_COLORS: [number, number, number][] = [
  [1.0, 0.93, 0.82], // 0 LED street
  [1.0, 0.62, 0.28], // 1 sodium
  [1.0, 0.8, 0.52], // 2 warm classic
  [1.0, 0.82, 0.6], // 3 shop warm
  [0.75, 0.86, 1.0], // 4 cool shop / ad panel
  [1.0, 0.25, 0.6], // 5 neon pink
  [0.25, 0.9, 1.0], // 6 neon cyan
  [0.45, 1.0, 0.45], // 7 subway green
  [1.0, 0.4, 0.2], // 8 neon orange
];

export type WalkPath = { pts: V2[]; cum: number[]; len: number; closed: boolean };

export type Lane = {
  id: number;
  piece: Piece;
  forward: boolean;
  index: number;
  pts: V2[];
  cum: number[];
  len: number;
  from: Junction;
  to: Junction;
  speed: number;
  /** Axis this lane approaches on, for signals. */
  axis: 'x' | 'z' | '';
  stopAt: number;
  signal: boolean;
  next: Lane[];
  lanes: number;
};

export type Collider = { obb: OBB; y1: number; y0: number };

export type District = 'downtown' | 'midtown' | 'apartments' | 'houses' | 'industrial' | 'park';

export type Pave = { pts: V2[]; kind: number; y: number };

export type Park = { x: number; z: number; r: number; pond: { x: number; z: number; rx: number; rz: number } | null };

export type City = {
  roads: Road[];
  pieces: Piece[];
  junctions: Junction[];
  buildings: Building[];
  props: Prop[];
  lights: Light[];
  walks: WalkPath[];
  lanes: Lane[];
  colliders: Collider[];
  paves: Pave[];
  parks: Park[];
  parkPaths: { pts: V2[]; w: number }[];
  stores: Store[];
  blocks: { minX: number; maxX: number; minZ: number; maxZ: number }[];
  holes: { minX: number; maxX: number; minZ: number; maxZ: number }[];
  grids: {
    pieces: Grid<{ piece: Piece; i: number }>;
    junctions: Grid<Junction>;
    buildings: Grid<Building>;
    colliders: Grid<Collider>;
    walks: Grid<{ path: WalkPath; i: number }>;
    lanes: Grid<{ lane: Lane; i: number }>;
  };
  district: (x: number, z: number) => District;
  /** Ellipse metric distance from the center. */
  radial: (x: number, z: number) => number;
};

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

const rectHit = (a: Rect, b: Rect) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

/** a minus b, as up to four rects. */
const rectMinus = (a: Rect, b: Rect): Rect[] => {
  if (!rectHit(a, b)) return [a];
  const out: Rect[] = [];
  if (b.minX > a.minX) out.push({ minX: a.minX, maxX: b.minX, minZ: a.minZ, maxZ: a.maxZ });
  if (b.maxX < a.maxX) out.push({ minX: b.maxX, maxX: a.maxX, minZ: a.minZ, maxZ: a.maxZ });
  const x0 = Math.max(a.minX, b.minX);
  const x1 = Math.min(a.maxX, b.maxX);
  if (b.minZ > a.minZ) out.push({ minX: x0, maxX: x1, minZ: a.minZ, maxZ: b.minZ });
  if (b.maxZ < a.maxZ) out.push({ minX: x0, maxX: x1, minZ: b.maxZ, maxZ: a.maxZ });
  return out.filter((r) => r.maxX - r.minX > 0.05 && r.maxZ - r.minZ > 0.05);
};

const rectsMinus = (list: Rect[], holes: Rect[]) => {
  let out = list;
  for (const hole of holes) out = out.flatMap((r) => rectMinus(r, hole));
  return out;
};

const rectPts = (r: Rect): V2[] => [
  { x: r.minX, z: r.minZ }, { x: r.maxX, z: r.minZ }, { x: r.maxX, z: r.maxZ }, { x: r.minX, z: r.maxZ },
];

const axisObb = (r: Rect): OBB => ({
  x: (r.minX + r.maxX) / 2,
  z: (r.minZ + r.maxZ) / 2,
  hw: (r.maxX - r.minX) / 2,
  hd: (r.maxZ - r.minZ) / 2,
  ax: { x: 1, z: 0 },
});

const ringRadius = (phi: number) => 470 + 38 * Math.sin(3 * phi + 1.1) + 22 * Math.sin(5 * phi + 2.3) + 12 * Math.sin(8 * phi + 0.4);
const outerRadius = (phi: number) => 820 + 45 * Math.sin(2 * phi + 0.7) + 28 * Math.sin(5 * phi + 1.9) + 14 * Math.sin(9 * phi + 0.3);

const ellipsePoint = (phi: number, r: number): V2 => ({ x: CENTER.x + Math.cos(phi) * r * ELLIPSE, z: CENTER.z + Math.sin(phi) * r });
const phiOf = (p: V2) => Math.atan2(p.z - CENTER.z, (p.x - CENTER.x) / ELLIPSE);
const radialOf = (x: number, z: number) => Math.hypot((x - CENTER.x) / ELLIPSE, z - CENTER.z);

const smoothPatch = (v: number) => clamp((v - 0.3) / 0.4, 0, 1);

const angleGap = (from: number, to: number) => {
  let g = to - from;
  while (g <= 0) g += Math.PI * 2;
  while (g > Math.PI * 2) g -= Math.PI * 2;
  return g;
};

export const buildCity = (): City => {
  const rand = rng(CITY_SEED);
  const roads: Road[] = [];
  const live = new Grid<{ road: Road; a: V2; b: V2 }>(32);
  /** True when a candidate centerline crosses a road it is not meant to touch. */
  const crossesExisting = (raw: V2[], allow: Road[], margin = 26) => {
    const pts = resample(raw, 5);
    const first = pts[0];
    const last = pts[pts.length - 1];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const pad = 16;
      for (const hit of live.query(Math.min(a.x, b.x) - pad, Math.min(a.z, b.z) - pad, Math.max(a.x, b.x) + pad, Math.max(a.z, b.z) + pad)) {
        const nearEnd = Math.min(dist(a, first), dist(a, last)) < margin;
        if (nearEnd && (allow.includes(hit.road) || margin > 0)) continue;
        if (segHit(a, b, hit.a, hit.b)) return true;
        // Too close to run alongside another road.
        if (!nearEnd && segDist(a, hit.a, hit.b).d < 14) return true;
      }
    }
    return false;
  };

  const addRoad = (cls: RoadClass, raw: V2[], opts: { closed?: boolean; grid?: boolean; step?: number } = {}) => {
    let pts = resample(raw, opts.step ?? (opts.grid ? 8 : 5));
    if (opts.closed) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (dist(first, last) > 0.01) pts = [...pts, { ...first }];
    }
    const cum = cumulative(pts);
    const road: Road = { id: roads.length, cls, spec: ROAD_SPEC[cls], pts, cum, len: cum[cum.length - 1], closed: !!opts.closed, grid: !!opts.grid };
    roads.push(road);
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      live.insert({ road, a, b }, Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z));
    }
    return road;
  };

  // ---------- Downtown grid ----------
  for (const z of AVENUES) addRoad('avenue', [{ x: DOWNTOWN.minX, z }, { x: DOWNTOWN.maxX, z }], { grid: true });
  for (const x of CROSSES) addRoad('street', [{ x, z: DOWNTOWN.minZ }, { x, z: DOWNTOWN.maxZ }], { grid: true });

  // ---------- Inner ring ----------
  const RING_N = 360;
  const ringPts: V2[] = [];
  for (let i = 0; i < RING_N; i += 1) {
    const phi = (i / RING_N) * Math.PI * 2;
    ringPts.push(ellipsePoint(phi, ringRadius(phi)));
  }
  const ring = addRoad('boulevard', ringPts, { closed: true, step: 7 });

  const ringHit = (p0: V2, d: V2) => {
    let p = p0;
    for (let t = 0; t < 900; t += 3) {
      p = add(p0, scale(d, t));
      const phi = phiOf(p);
      if (radialOf(p.x, p.z) >= ringRadius(phi)) return p;
    }
    return p;
  };

  const nearestIndex = (pts: V2[], p: V2) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i += 1) {
      const d = dist(pts[i], p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  // ---------- Connectors: grid ends out to the ring ----------
  type Stub = { p: V2; d: V2; cls: RoadClass };
  const stubs: Stub[] = [];
  for (const z of AVENUES) {
    stubs.push({ p: { x: DOWNTOWN.minX, z }, d: { x: -1, z: 0 }, cls: 'avenue' });
    stubs.push({ p: { x: DOWNTOWN.maxX, z }, d: { x: 1, z: 0 }, cls: 'avenue' });
  }
  for (const x of CROSSES.slice(1, -1)) {
    stubs.push({ p: { x, z: DOWNTOWN.minZ }, d: { x: 0, z: -1 }, cls: 'street' });
    stubs.push({ p: { x, z: DOWNTOWN.maxZ }, d: { x: 0, z: 1 }, cls: 'street' });
  }
  const ringBody = ring.pts.slice(0, -1);
  const taken: number[] = [];
  const freeIndex = (want: number, spacing: number) => {
    const n = ringBody.length;
    for (let k = 0; k < n; k += 1) {
      for (const sign of [1, -1]) {
        const idx = (((want + sign * k) % n) + n) % n;
        if (taken.every((t) => Math.min(Math.abs(t - idx), n - Math.abs(t - idx)) >= spacing)) return idx;
      }
    }
    return want;
  };
  type Connector = { road: Road; phi: number };
  const connectors: Connector[] = [];
  for (const stub of stubs) {
    const hit = ringHit(stub.p, stub.d);
    const jitter = Math.round(range(rand, -4, 4));
    const idx = freeIndex((nearestIndex(ringBody, hit) + jitter + ringBody.length) % ringBody.length, 8);
    taken.push(idx);
    const end = ringBody[idx];
    const outward = norm(sub(end, CENTER));
    const span = dist(stub.p, end);
    const raw = hermite(stub.p, scale(stub.d, span * 0.75), end, scale(outward, span * 0.55), 40);
    const n = ccw(stub.d);
    const wiggle = range(rand, -0.11, 0.11) * span;
    const bent = raw.map((p, i) => {
      const t = i / (raw.length - 1);
      const w = Math.sin(t * Math.PI) * wiggle * (t < 0.15 ? t / 0.15 : 1);
      return { x: p.x + n.x * w, z: p.z + n.z * w };
    });
    bent[bent.length - 1] = { ...end };
    connectors.push({ road: addRoad(stub.cls, bent), phi: phiOf(end) });
  }
  connectors.sort((a, b) => a.phi - b.phi);

  // ---------- Park wedge and midtown arcs ----------
  let parkPair = 0;
  {
    let best = Infinity;
    for (let i = 0; i < connectors.length; i += 1) {
      const a = connectors[i];
      const b = connectors[(i + 1) % connectors.length];
      const mid = Math.atan2(Math.sin(a.phi) + Math.sin(b.phi), Math.cos(a.phi) + Math.cos(b.phi));
      const d = Math.abs(angleGap(0.95, mid) > Math.PI ? angleGap(0.95, mid) - Math.PI * 2 : angleGap(0.95, mid));
      if (d < best) {
        best = d;
        parkPair = i;
      }
    }
  }
  const arcAt = (road: Road, t: number) => {
    const s = road.len * t;
    let best = 0;
    for (let i = 0; i < road.pts.length; i += 1) if (Math.abs(road.cum[i] - s) < Math.abs(road.cum[best] - s)) best = i;
    return { p: road.pts[best], tan: tangentAt(road.pts, road.cum, road.cum[best]) };
  };
  for (let i = 0; i < connectors.length; i += 1) {
    if (i === parkPair) continue;
    const a = connectors[i].road;
    const b = connectors[(i + 1) % connectors.length].road;
    const A = arcAt(a, 0.52);
    const B = arcAt(b, 0.52);
    const span = dist(A.p, B.p);
    if (span < 70 || span > 340) continue;
    let ta = ccw(A.tan);
    if (dot(ta, sub(B.p, A.p)) < 0) ta = scale(ta, -1);
    let tb = ccw(B.tan);
    if (dot(tb, sub(B.p, A.p)) < 0) tb = scale(tb, -1);
    const arc = hermite(A.p, scale(ta, span * 0.8), B.p, scale(tb, span * 0.8), 30);
    if (!crossesExisting(arc, [a, b])) addRoad('street', arc);
  }

  // ---------- Radials ----------
  const radials: Road[] = [];
  for (let k = 0; k < 12; k += 1) {
    const wantPhi = ((k + 0.5) / 12) * Math.PI * 2 + range(rand, -0.08, 0.08);
    const wantIdx = Math.round(((((wantPhi % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * ringBody.length) % ringBody.length;
    const idx = freeIndex(wantIdx, 7);
    taken.push(idx);
    const start = ringBody[idx];
    const pts: V2[] = [start];
    let p = start;
    let h = Math.atan2(p.z - CENTER.z, p.x - CENTER.x);
    for (let step = 0; step < 200; step += 1) {
      const target = Math.atan2(p.z - CENTER.z, p.x - CENTER.x);
      let diff = target - h;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      h += diff * 0.08 + (noise1(step * 0.11, 300 + k) - 0.5) * 0.16;
      p = { x: p.x + Math.cos(h) * 10, z: p.z + Math.sin(h) * 10 };
      pts.push(p);
      if (radialOf(p.x, p.z) > CITY_RADIUS) break;
    }
    radials.push(addRoad('arterial', pts));
  }

  // ---------- Outer ring ----------
  const outerPts: V2[] = [];
  for (let i = 0; i < 540; i += 1) {
    const phi = (i / 540) * Math.PI * 2;
    outerPts.push(ellipsePoint(phi, outerRadius(phi)));
  }
  addRoad('boulevard', outerPts, { closed: true, step: 7 });

  // ---------- Crescents and cul-de-sacs ----------
  const atRadius = (road: Road, rho: number) => {
    for (let i = 1; i < road.pts.length; i += 1) {
      if (radialOf(road.pts[i].x, road.pts[i].z) >= rho) return { p: road.pts[i], tan: tangentAt(road.pts, road.cum, road.cum[i]) };
    }
    return null;
  };
  for (const outerBand of [false, true]) {
    for (let k = 0; k < radials.length; k += 1) {
      const ra = radials[k];
      const rb = radials[(k + 1) % radials.length];
      const bandOf = (road: Road) => {
        const phi = phiOf(road.pts[0]);
        return outerBand ? 1010 : (ringRadius(phi) + outerRadius(phi)) / 2;
      };
      const a = atRadius(ra, bandOf(ra));
      const b = atRadius(rb, bandOf(rb));
      if (!a || !b) continue;
      const span = dist(a.p, b.p);
      let ta = ccw(a.tan);
      if (dot(ta, sub(b.p, a.p)) < 0) ta = scale(ta, -1);
      let tb = ccw(b.tan);
      if (dot(tb, sub(b.p, a.p)) < 0) tb = scale(tb, -1);
      const raw = hermite(a.p, scale(ta, span * 0.7), b.p, scale(tb, span * 0.7), 48);
      const n = ccw(norm(sub(b.p, a.p)));
      const wig = range(rand, -0.05, 0.05) * span;
      const bent = raw.map((p, i) => {
        const t = i / (raw.length - 1);
        const w = Math.sin(t * Math.PI * 2) * wig;
        return { x: p.x + n.x * w, z: p.z + n.z * w };
      });
      if (crossesExisting(bent, [ra, rb])) continue;
      const crescent = addRoad('collector', bent);
      for (const [t, side] of [[0.3, 1], [0.7, -1]] as const) {
        const s = crescent.len * t;
        const base = pointAt(crescent.pts, crescent.cum, s);
        const idx = crescent.pts.findIndex((q, i) => crescent.cum[i] >= s);
        const root = crescent.pts[Math.max(0, idx)];
        const tan = tangentAt(crescent.pts, crescent.cum, s);
        const out = scale(ccw(tan), side);
        const length = range(rand, 52, 64);
        const turn = range(rand, -0.6, 0.6);
        const endDir = norm({ x: out.x * Math.cos(turn) - out.z * Math.sin(turn), z: out.x * Math.sin(turn) + out.z * Math.cos(turn) });
        const end = add(base, add(scale(out, length * 0.8), scale(endDir, length * 0.3)));
        const cul = hermite(root, scale(out, length * 0.9), end, scale(endDir, length * 0.6), 16);
        if (!crossesExisting(cul, [crescent], 20)) addRoad('lane', cul);
      }
    }
  }

  // ---------- Junctions ----------
  type Ref = { road: Road; s: number };
  type Cand = { x: number; z: number; refs: Ref[] };
  const cands: Cand[] = [];
  const segGrid = new Grid<{ road: Road; i: number }>(32);
  for (const road of roads) {
    for (let i = 0; i < road.pts.length - 1; i += 1) {
      const a = road.pts[i];
      const b = road.pts[i + 1];
      segGrid.insert({ road, i }, Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z));
    }
  }
  const addCand = (x: number, z: number, refs: Ref[]) => {
    for (const c of cands) {
      if (Math.hypot(c.x - x, c.z - z) < 5) {
        c.refs.push(...refs);
        return;
      }
    }
    cands.push({ x, z, refs: [...refs] });
  };
  // Endpoints touching other roads.
  for (const road of roads) {
    if (road.closed) continue;
    for (const s of [0, road.len]) {
      const p = pointAt(road.pts, road.cum, s);
      const refs: Ref[] = [{ road, s }];
      for (const hit of segGrid.query(p.x - 1.5, p.z - 1.5, p.x + 1.5, p.z + 1.5)) {
        if (hit.road === road) continue;
        const a = hit.road.pts[hit.i];
        const b = hit.road.pts[hit.i + 1];
        const sd = segDist(p, a, b);
        if (sd.d < 1.5) refs.push({ road: hit.road, s: hit.road.cum[hit.i] + sd.t * dist(a, b) });
      }
      addCand(p.x, p.z, refs);
    }
  }
  // Crossings.
  for (const road of roads) {
    for (let i = 0; i < road.pts.length - 1; i += 1) {
      const a = road.pts[i];
      const b = road.pts[i + 1];
      for (const hit of segGrid.query(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z))) {
        if (hit.road.id <= road.id) continue;
        const c = hit.road.pts[hit.i];
        const d = hit.road.pts[hit.i + 1];
        const x = segHit(a, b, c, d);
        if (!x) continue;
        addCand(x.x, x.z, [
          { road, s: road.cum[i] + x.t * dist(a, b) },
          { road: hit.road, s: hit.road.cum[hit.i] + x.u * dist(c, d) },
        ]);
      }
    }
  }

  const junctions: Junction[] = [];
  const refsByRoad = new Map<Road, { s: number; j: Junction }[]>();
  const newJunction = (x: number, z: number): Junction => {
    const j: Junction = { id: junctions.length, x, z, arms: [], signal: false, crosswalk: false, radius: 0, dead: false, patch: [], corners: [], curbs: [], outers: [], bulb: 0 };
    junctions.push(j);
    return j;
  };
  for (const cand of cands) {
    const roadsHere = new Set(cand.refs.map((r) => r.road));
    // Pure endpoint of a single road that touches nothing becomes a dead end later.
    if (roadsHere.size < 2) continue;
    const j = newJunction(cand.x, cand.z);
    for (const road of roadsHere) {
      const own = cand.refs.filter((r) => r.road === road);
      let s = own.reduce((sum, r) => sum + r.s, 0) / own.length;
      if (!road.closed) {
        if (s < 4) s = 0;
        if (s > road.len - 4) s = road.len;
      }
      const list = refsByRoad.get(road) ?? [];
      if (!list.some((e) => Math.abs(e.s - s) < 6)) list.push({ s, j });
      refsByRoad.set(road, list);
    }
  }
  for (const road of roads) {
    const list = refsByRoad.get(road) ?? [];
    if (!road.closed) {
      for (const s of [0, road.len]) {
        if (list.some((e) => Math.abs(e.s - s) < 0.5)) continue;
        const p = pointAt(road.pts, road.cum, s);
        const j = newJunction(p.x, p.z);
        j.dead = true;
        list.push({ s, j });
      }
    }
    list.sort((a, b) => a.s - b.s);
    refsByRoad.set(road, list);
  }

  // ---------- Pieces ----------
  const pieces: Piece[] = [];
  const gridAxis = (road: Road): 'x' | 'z' | '' => {
    if (!road.grid) return '';
    return Math.abs(road.pts[1].x - road.pts[0].x) > Math.abs(road.pts[1].z - road.pts[0].z) ? 'x' : 'z';
  };
  for (const road of roads) {
    const list = refsByRoad.get(road) ?? [];
    if (list.length < 2 && !road.closed) continue;
    const spans: { s0: number; s1: number; j0: Junction; j1: Junction }[] = [];
    for (let i = 0; i < list.length - 1; i += 1) spans.push({ s0: list[i].s, s1: list[i + 1].s, j0: list[i].j, j1: list[i + 1].j });
    if (road.closed && list.length) spans.push({ s0: list[list.length - 1].s, s1: list[0].s + road.len, j0: list[list.length - 1].j, j1: list[0].j });
    for (const span of spans) {
      if (span.s1 - span.s0 < 1) continue;
      let pts: V2[];
      if (span.s1 > road.len) {
        const body = road.pts.slice(0, -1);
        const doubled = [...body, ...body, body[0]];
        const cum2 = cumulative(doubled);
        pts = slice(doubled, cum2, span.s0, span.s1);
      } else {
        pts = slice(road.pts, road.cum, span.s0, span.s1);
      }
      pts[0] = { x: span.j0.x, z: span.j0.z };
      pts[pts.length - 1] = { x: span.j1.x, z: span.j1.z };
      const cum = cumulative(pts);
      pieces.push({
        id: pieces.length, road, pts, cum, len: cum[cum.length - 1], j0: span.j0, j1: span.j1,
        cut0: 0, cut1: 0, side0L: 0, side0R: 0, side1L: 0, side1R: 0, walk0: false, walk1: false, axis: gridAxis(road),
      });
    }
  }

  // ---------- Arms, cuts, patches ----------
  for (const piece of pieces) {
    const probe = Math.min(7, piece.len * 0.4);
    const a = pointAt(piece.pts, piece.cum, probe);
    const b = pointAt(piece.pts, piece.cum, piece.len - probe);
    const spec = piece.road.spec;
    piece.j0.arms.push({ piece, atStart: true, d: norm(sub(a, piece.j0)), angle: 0, half: spec.half, walk: spec.walk, cut: 0, sideL: 0, sideR: 0 });
    piece.j1.arms.push({ piece, atStart: false, d: norm(sub(b, piece.j1)), angle: 0, half: spec.half, walk: spec.walk, cut: 0, sideL: 0, sideR: 0 });
  }

  const insideDowntown = (x: number, z: number, pad = 0) => (
    x > DOWNTOWN.minX - pad && x < DOWNTOWN.maxX + pad && z > DOWNTOWN.minZ - pad && z < DOWNTOWN.maxZ + pad
  );

  for (const j of junctions) {
    const arms = j.arms;
    for (const arm of arms) arm.angle = Math.atan2(arm.d.z, arm.d.x);
    arms.sort((a, b) => a.angle - b.angle);
    const n = arms.length;
    const downtown = insideDowntown(j.x, j.z, 1);
    const r = downtown ? 2.6 : 4;
    j.signal = downtown && n >= 3;
    j.crosswalk = n >= 3 && (downtown || arms.every((arm) => arm.piece.road.cls !== 'lane'));
    if (n === 1) {
      const arm = arms[0];
      j.dead = true;
      j.bulb = arm.half + 4.5;
      arm.cut = j.bulb * 0.75;
      const inner = Math.sqrt(Math.max(1, j.bulb * j.bulb - arm.half * arm.half));
      arm.sideL = inner;
      arm.sideR = inner;
      continue;
    }
    const roadCut = new Array(n).fill(0);
    const sideL = new Array(n).fill(0);
    const sideR = new Array(n).fill(0);
    for (let k = 0; k < n; k += 1) {
      const m = (k + 1) % n;
      const A = arms[k];
      const B = arms[m];
      const gap = n === 1 ? Math.PI * 2 : angleGap(A.angle, B.angle);
      if (gap > 0.25 && gap < Math.PI - 0.2) {
        const s = Math.sin(gap);
        const c = Math.cos(gap);
        const tA = (B.half + A.half * c) / s;
        const tB = (A.half + B.half * c) / s;
        const tA2 = (B.half + B.walk + (A.half + A.walk) * c) / s;
        const tB2 = (A.half + A.walk + (B.half + B.walk) * c) / s;
        roadCut[k] = Math.max(roadCut[k], tA + r);
        roadCut[m] = Math.max(roadCut[m], tB + r);
        sideL[k] = Math.max(sideL[k], tA2);
        sideR[m] = Math.max(sideR[m], tB2);
      } else if (gap <= 0.25) {
        roadCut[k] = Math.max(roadCut[k], 26);
        roadCut[m] = Math.max(roadCut[m], 26);
      }
    }
    let maxCut = 0;
    for (let k = 0; k < n; k += 1) {
      const arm = arms[k];
      const room = arm.piece.len * 0.45;
      arm.cut = Math.min(roadCut[k], 40, room);
      arm.sideL = Math.min(Math.max(sideL[k], arm.cut + (sideL[k] > 0 ? 1 : 0)), room + 6);
      arm.sideR = Math.min(Math.max(sideR[k], arm.cut + (sideR[k] > 0 ? 1 : 0)), room + 6);
      maxCut = Math.max(maxCut, arm.cut);
    }
    j.radius = maxCut + 2;
  }

  // Write cuts back onto pieces.
  for (const j of junctions) {
    for (const arm of j.arms) {
      const p = arm.piece;
      // Piece L side at the start equals arm L side. At the end the arm points backward, so sides swap.
      if (arm.atStart) {
        p.cut0 = arm.cut;
        p.side0L = arm.sideL;
        p.side0R = arm.sideR;
        p.walk0 = j.crosswalk;
      } else {
        p.cut1 = arm.cut;
        p.side1L = arm.sideR;
        p.side1R = arm.sideL;
        p.walk1 = j.crosswalk;
      }
    }
  }

  // Patch and corner geometry.
  for (const j of junctions) {
    const J: V2 = { x: j.x, z: j.z };
    if (j.dead) {
      const arm = j.arms[0];
      const R = j.bulb;
      const ring: V2[] = [];
      for (let i = 0; i < 28; i += 1) {
        const a = (i / 28) * Math.PI * 2;
        ring.push({ x: j.x + Math.cos(a) * R, z: j.z + Math.sin(a) * R });
      }
      j.patch = ring;
      const gap = Math.asin(clamp(arm.half / R, 0, 0.99));
      const start = arm.angle + gap;
      const sweep = Math.PI * 2 - gap * 2;
      const curb: V2[] = [];
      const outer: V2[] = [];
      for (let i = 0; i <= 24; i += 1) {
        const a = start + (sweep * i) / 24;
        curb.push({ x: j.x + Math.cos(a) * R, z: j.z + Math.sin(a) * R });
        outer.push({ x: j.x + Math.cos(a) * (R + arm.walk), z: j.z + Math.sin(a) * (R + arm.walk) });
      }
      j.corners.push([...curb, ...outer.slice().reverse()]);
      j.curbs.push(curb);
      j.outers.push(outer);
      continue;
    }
    const arms = j.arms;
    const n = arms.length;
    if (arms.every((arm) => arm.cut < 0.3)) continue;
    const patch: V2[] = [];
    for (let k = 0; k < n; k += 1) {
      const A = arms[k];
      const B = arms[(k + 1) % n];
      const LA = ccw(A.d);
      const LB = ccw(B.d);
      const Q = add(J, add(scale(A.d, A.cut), scale(LA, -A.half)));
      const P = add(J, add(scale(A.d, A.cut), scale(LA, A.half)));
      const QB = add(J, add(scale(B.d, B.cut), scale(LB, -B.half)));
      const gap = angleGap(A.angle, B.angle);
      const straight = Math.abs(gap - Math.PI) < 0.2;
      const hit = straight ? null : lineHit(add(J, scale(LA, A.half)), A.d, add(J, scale(LB, -B.half)), B.d);
      const ctrl = hit ? { x: hit.x, z: hit.z } : scale(add(P, QB), 0.5);
      const fillet = quadBezier(P, ctrl, QB, straight ? 2 : 10);
      patch.push(Q, P, ...fillet.slice(1, -1));
      // Sidewalk corner between A (L side) and B (R side).
      const A1 = add(J, add(scale(A.d, A.sideL), scale(LA, A.half)));
      const A2 = add(J, add(scale(A.d, A.sideL), scale(LA, A.half + A.walk)));
      const B1 = add(J, add(scale(B.d, B.sideR), scale(LB, -B.half)));
      const B2 = add(J, add(scale(B.d, B.sideR), scale(LB, -(B.half + B.walk))));
      const outerHit = straight ? null : lineHit(add(J, scale(LA, A.half + A.walk)), A.d, add(J, scale(LB, -(B.half + B.walk))), B.d);
      const curbLine = [A1, ...fillet, B1];
      const outerLine = outerHit && gap < Math.PI ? [A2, { x: outerHit.x, z: outerHit.z }, B2] : outerHit ? [A2, { x: outerHit.x, z: outerHit.z }, B2] : [A2, B2];
      const poly: V2[] = [];
      for (const p of [...curbLine, ...outerLine.slice().reverse()]) {
        const last = poly[poly.length - 1];
        if (!last || dist(last, p) > 0.05) poly.push(p);
      }
      if (poly.length > 2 && dist(poly[0], poly[poly.length - 1]) < 0.05) poly.pop();
      j.corners.push(poly);
      j.curbs.push(curbLine);
      j.outers.push(outerLine);
    }
    j.patch = patch;
  }

  // ---------- Districts ----------
  const parks: Park[] = [];
  const industrial = (phi: number) => noise1(phi * 1.9 + 3.1, 77) > 0.7;
  const district = (x: number, z: number): District => {
    if (insideDowntown(x, z)) return 'downtown';
    for (const park of parks) if (Math.hypot(x - park.x, z - park.z) < park.r) return 'park';
    const rho = radialOf(x, z);
    const phi = Math.atan2(z - CENTER.z, (x - CENTER.x) / ELLIPSE);
    if (rho < ringRadius(phi) + 4) return 'midtown';
    if (industrial(phi)) return 'industrial';
    if (rho < outerRadius(phi) + 4) return 'apartments';
    return 'houses';
  };

  const pieceGrid = new Grid<{ piece: Piece; i: number }>(32);
  for (const piece of pieces) {
    for (let i = 0; i < piece.pts.length - 1; i += 1) {
      const a = piece.pts[i];
      const b = piece.pts[i + 1];
      const pad = piece.road.spec.half + piece.road.spec.walk;
      pieceGrid.insert({ piece, i }, Math.min(a.x, b.x) - pad, Math.min(a.z, b.z) - pad, Math.max(a.x, b.x) + pad, Math.max(a.z, b.z) + pad);
    }
  }
  const junctionGrid = new Grid<Junction>(48);
  for (const j of junctions) {
    const r = Math.max(j.radius, j.bulb) + 14;
    junctionGrid.insert(j, j.x - r, j.z - r, j.x + r, j.z + r);
  }

  /** Clearance from the nearest road corridor (centerline distance minus half and sidewalk). */
  const roadClear = (p: V2) => {
    let best = Infinity;
    for (const hit of pieceGrid.query(p.x - 2, p.z - 2, p.x + 2, p.z + 2)) {
      const a = hit.piece.pts[hit.i];
      const b = hit.piece.pts[hit.i + 1];
      const spec = hit.piece.road.spec;
      best = Math.min(best, segDist(p, a, b).d - spec.half - spec.walk);
    }
    for (const j of junctionGrid.query(p.x, p.z, p.x, p.z)) {
      const r = j.dead ? j.bulb + 3 : j.radius;
      best = Math.min(best, Math.hypot(p.x - j.x, p.z - j.z) - r);
    }
    return best;
  };

  // Park in the open wedge: the roomiest point between the two connectors.
  {
    const a = connectors[parkPair].road;
    const b = connectors[(parkPair + 1) % connectors.length].road;
    let best = { p: CENTER, clear: -Infinity };
    for (let ti = 2; ti <= 9; ti += 1) {
      const A = arcAt(a, ti / 10).p;
      const B = arcAt(b, ti / 10).p;
      for (let ui = 1; ui <= 9; ui += 1) {
        const p = add(A, scale(sub(B, A), ui / 10));
        if (insideDowntown(p.x, p.z, 10)) continue;
        let clear = roadClear(p);
        for (let i = 0; i < 16 && clear > best.clear; i += 1) {
          const ang = (i / 16) * Math.PI * 2;
          for (const rr of [20, 40, 60, 80]) {
            if (rr > clear) break;
            clear = Math.min(clear, roadClear({ x: p.x + Math.cos(ang) * rr, z: p.z + Math.sin(ang) * rr }) + rr);
          }
        }
        if (clear > best.clear) best = { p, clear };
      }
    }
    const c = best.p;
    let r = Math.min(130, best.clear - 3);
    for (let step = 0; step < 60 && r > 30; step += 1) {
      let clear = Infinity;
      for (let i = 0; i < 48; i += 1) {
        const ang = (i / 48) * Math.PI * 2;
        clear = Math.min(clear, roadClear({ x: c.x + Math.cos(ang) * r, z: c.z + Math.sin(ang) * r }));
      }
      if (clear > 3) break;
      r -= 3;
    }
    const pr = rng(CITY_SEED + 7);
    const pondAng = range(pr, 0, Math.PI * 2);
    parks.push({
      x: c.x,
      z: c.z,
      r,
      pond: r > 45 ? { x: c.x + Math.cos(pondAng) * r * 0.34, z: c.z + Math.sin(pondAng) * r * 0.34, rx: r * 0.27, rz: r * 0.19 } : null,
    });
  }

  // ---------- Buildings ----------
  const buildings: Building[] = [];
  const buildingGrid = new Grid<Building>(48);
  const props: Prop[] = [];
  const lights: Light[] = [];
  const colliders: Collider[] = [];
  const colliderGrid = new Grid<Collider>(24);
  const paves: Pave[] = [];
  const stores: Store[] = [];
  const blocks: Rect[] = [];
  const holes: Rect[] = [STATION_PIT];

  const addCollider = (obb: OBB, y1: number, y0 = 0) => {
    const c: Collider = { obb, y1, y0 };
    colliders.push(c);
    const r = Math.hypot(obb.hw, obb.hd);
    colliderGrid.insert(c, obb.x - r, obb.z - r, obb.x + r, obb.z + r);
    return c;
  };

  const addBuilding = (b: Building) => {
    buildings.push(b);
    const r = Math.hypot(b.obb.hw, b.obb.hd);
    buildingGrid.insert(b, b.obb.x - r, b.obb.z - r, b.obb.x + r, b.obb.z + r);
    for (const m of b.masses) addCollider(m.obb, m.y1, m.y0);
    return b;
  };

  const blocked = (o: OBB, pad: number) => {
    const r = Math.hypot(o.hw, o.hd) + pad;
    for (const other of buildingGrid.query(o.x - r, o.z - r, o.x + r, o.z + r)) {
      if (obbOverlap(o, other.obb, pad)) return true;
    }
    return false;
  };

  const prop = (kind: PropKind, x: number, z: number, f: V2, a = 0, b = 0, c = 0, y = 0, g?: V2) => {
    const p: Prop = { kind, x, z, y, f, a, b, c, g };
    props.push(p);
    return p;
  };

  const light = (x: number, z: number, r: number, color: number, i: number, y = 6) => {
    lights.push({ x, z, r, color, i, y });
  };

  /** Massing for a lot. Returns masses in the lot frame. */
  const massing = (
    o: OBB,
    height: number,
    style: number,
    street: number,
    gfh: number,
    br: Rand,
    tall: boolean,
  ): Mass[] => {
    const masses: Mass[] = [];
    const isHouse = style === STYLE.SIDING || (style === STYLE.STUCCO && height < 9);
    if (isHouse) {
      const wall = Math.max(3, height - 2.4);
      masses.push({ obb: o, y0: 0, y1: wall, roof: 1, ridge: wall + Math.min(o.hd, o.hw) * 0.9, street, gfh: 0 });
      return masses;
    }
    if (!tall || height < 30) {
      masses.push({ obb: o, y0: 0, y1: height, roof: 0, ridge: 0, street, gfh });
      return masses;
    }
    const podium = Math.min(height * 0.25, gfh + range(br, 6, 16));
    masses.push({ obb: o, y0: 0, y1: podium, roof: 0, ridge: 0, street, gfh });
    let hw = o.hw * range(br, 0.72, 0.92);
    let hd = o.hd * range(br, 0.72, 0.92);
    let y = podium;
    const tiers = height > 90 ? 3 : height > 55 ? 2 : 1;
    for (let t = 0; t < tiers; t += 1) {
      const top = t === tiers - 1 ? height : y + (height - y) * range(br, 0.45, 0.7);
      masses.push({ obb: { ...o, hw, hd }, y0: y, y1: top, roof: 0, ridge: 0, street: 0, gfh: 0 });
      y = top;
      hw *= range(br, 0.74, 0.9);
      hd *= range(br, 0.74, 0.9);
    }
    return masses;
  };

  const roofKit = (b: Building, br: Rand) => {
    const top = b.masses[b.masses.length - 1];
    if (top.roof) return;
    const o = top.obb;
    const bz = ccw(o.ax);
    const at = (lx: number, lz: number): V2 => ({ x: o.x + o.ax.x * lx + bz.x * lz, z: o.z + o.ax.z * lx + bz.z * lz });
    const count = 1 + Math.floor(br() * 3);
    for (let i = 0; i < count; i += 1) {
      const p = at(range(br, -0.6, 0.6) * o.hw, range(br, -0.6, 0.6) * o.hd);
      prop('hvac', p.x, p.z, o.ax, range(br, 1.4, 3.2), range(br, 1, 1.8), range(br, 1.2, 2.6), top.y1);
    }
    if ((b.style === STYLE.BRICK || b.style === STYLE.STONE) && br() < 0.55 && b.height < 60) {
      const p = at(range(br, -0.4, 0.4) * o.hw, range(br, -0.4, 0.4) * o.hd);
      prop('tank', p.x, p.z, o.ax, 1.6, 0, 0, top.y1);
    }
    if (b.height > 85 && br() < 0.7) {
      const p = at(0, 0);
      prop('antenna', p.x, p.z, o.ax, range(br, 8, 22), 0, 0, top.y1);
    }
    if (!b.tall && b.height > 12 && b.height < 45 && br() < 0.16) {
      const front = at(0, o.hd * 0.4);
      prop('billboard', front.x, front.z, bz, Math.min(o.hw * 1.4, 12), Math.floor(br() * 5), 0, top.y1);
    }
  };

  const styleFor = (district: District, height: number, br: Rand) => {
    if (district === 'houses') return br() < 0.65 ? STYLE.SIDING : STYLE.STUCCO;
    if (district === 'industrial') return STYLE.WAREHOUSE;
    if (district === 'apartments') return pick(br, [STYLE.BRICK, STYLE.BRICK, STYLE.STUCCO, STYLE.SIDING, STYLE.CONCRETE]);
    if (height > 80) return pick(br, [STYLE.GLASS, STYLE.GLASS, STYLE.DARK, STYLE.CONCRETE]);
    if (height > 36) return pick(br, [STYLE.GLASS, STYLE.CONCRETE, STYLE.STONE, STYLE.DARK, STYLE.BRICK]);
    return pick(br, [STYLE.BRICK, STYLE.BRICK, STYLE.STONE, STYLE.CONCRETE, STYLE.STUCCO]);
  };

  const finishBuilding = (
    o: OBB, height: number, style: number, street: number, gfh: number, district: District, br: Rand, store: Store | null = null,
  ) => {
    const tall = height > 30;
    const floorH = style === STYLE.WAREHOUSE ? range(br, 4.5, 6) : style === STYLE.SIDING || style === STYLE.STUCCO ? range(br, 2.8, 3.1) : range(br, 3.2, 3.9);
    const bay = style === STYLE.GLASS || style === STYLE.DARK ? range(br, 1.5, 2.2) : style === STYLE.WAREHOUSE ? range(br, 4, 6) : range(br, 2.4, 3.6);
    const b: Building = {
      id: buildings.length,
      obb: o,
      masses: massing(o, height, style, street, gfh, br, tall),
      style,
      seed: br(),
      floorH,
      bay,
      height,
      lit: district === 'downtown' ? range(br, 0.35, 0.7) : range(br, 0.25, 0.55),
      store,
      district,
      tall,
    };
    if (store) {
      b.masses[0].y0 = 4.4;
      b.masses[0].street = 0;
      b.masses[0].gfh = 0;
    }
    addBuilding(b);
    roofKit(b, br);
    // Storefront glow and neon on the street faces.
    const base = b.masses[0];
    if (base.gfh > 0) {
      const bz = ccw(o.ax);
      const faces: [V2, number, number][] = [[o.ax, o.hw, o.hd], [bz, o.hd, o.hw], [scale(o.ax, -1), o.hw, o.hd], [scale(bz, -1), o.hd, o.hw]];
      faces.forEach(([n, reach, span], index) => {
        if (!(base.street & (1 << index))) return;
        const t = ccw(n);
        const count = Math.max(1, Math.floor((span * 2) / 7));
        for (let i = 0; i < count; i += 1) {
          const along = -span + ((i + 0.5) / count) * span * 2;
          const px = o.x + n.x * (reach + 2.4) + t.x * along;
          const pz = o.z + n.z * (reach + 2.4) + t.z * along;
          if (hash2(b.id, i, index) < 0.78) light(px, pz, 5.5, hash2(b.id, i, 9) < 0.7 ? 3 : 4, 0.55, 2);
        }
        if (district === 'downtown' || district === 'midtown') {
          if (br() < 0.55) {
            const along = range(br, -0.7, 0.7) * span;
            const sx = o.x + n.x * (reach + 0.05) + t.x * along;
            const sz = o.z + n.z * (reach + 0.05) + t.z * along;
            const color = pick(br, [5, 6, 8, 3, 7]);
            prop('blade', sx, sz, n, Math.min(height - 1, range(br, 5.2, 9)), color, range(br, 1.6, 3.2), 0, t);
            light(sx + n.x * 1.2, sz + n.z * 1.2, 5, color, 0.45, 5);
          }
          if (br() < 0.5) {
            const along = range(br, -0.5, 0.5) * span;
            prop('awning', o.x + n.x * reach + t.x * along, o.z + n.z * reach + t.z * along, n, Math.min(span * 1.6, range(br, 4, 9)), Math.floor(br() * 6), 0, 0, t);
          }
        }
      });
    }
    return b;
  };

  // ---------- Downtown blocks ----------
  const street = ROAD_SPEC.street;
  const avenue = ROAD_SPEC.avenue;
  const blockRect = (i: number, k: number): Rect => ({
    minX: CROSSES[i] + street.half + street.walk,
    maxX: CROSSES[i + 1] - street.half - street.walk,
    minZ: AVENUES[k] + avenue.half + avenue.walk,
    maxZ: AVENUES[k + 1] - avenue.half - avenue.walk,
  });
  const cbdHeight = (x: number, z: number, br: Rand) => {
    const d = Math.hypot(x - 70, z - 10);
    const base = 150 * Math.exp(-d / 160) + 16;
    const roll = br();
    if (roll < 0.14) return range(br, 11, 19);
    return base * range(br, 0.5, 1.3);
  };

  const splitLots = (r: Rect, br: Rand, min = 15, max = 32): Rect[] => {
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    if (w <= max && d <= max) return [r];
    if (w >= d) {
      const cut = r.minX + w * range(br, 0.36, 0.64);
      if (cut - r.minX < min || r.maxX - cut < min) return [r];
      return [...splitLots({ ...r, maxX: cut }, br, min, max), ...splitLots({ ...r, minX: cut }, br, min, max)];
    }
    const cut = r.minZ + d * range(br, 0.36, 0.64);
    if (cut - r.minZ < min || r.maxZ - cut < min) return [r];
    return [...splitLots({ ...r, maxZ: cut }, br, min, max), ...splitLots({ ...r, minZ: cut }, br, min, max)];
  };

  const streetMask = (lot: Rect, block: Rect) => {
    let mask = 0;
    if (Math.abs(lot.maxX - block.maxX) < 0.5) mask |= 1;
    if (Math.abs(lot.maxZ - block.maxZ) < 0.5) mask |= 2;
    if (Math.abs(lot.minX - block.minX) < 0.5) mask |= 4;
    if (Math.abs(lot.minZ - block.minZ) < 0.5) mask |= 8;
    return mask;
  };

  const downtownLot = (lot: Rect, block: Rect, br: Rand, opts: { height?: number; style?: number; store?: Store | null } = {}) => {
    const cx = (lot.minX + lot.maxX) / 2;
    const cz = (lot.minZ + lot.maxZ) / 2;
    const height = opts.height ?? cbdHeight(cx, cz, br);
    const style = opts.style ?? styleFor('downtown', height, br);
    const mask = streetMask(lot, block);
    return finishBuilding(axisObb(lot), height, style, mask, mask ? range(br, 4.2, 5.2) : 0, 'downtown', br, opts.store ?? null);
  };

  const plaza = (r: Rect, br: Rand, trees = true) => {
    if (!trees) return;
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const nx = Math.max(1, Math.floor(w / 9));
    const nz = Math.max(1, Math.floor(d / 9));
    for (let i = 0; i < nx; i += 1) {
      for (let k = 0; k < nz; k += 1) {
        if (br() < 0.35) continue;
        const x = r.minX + ((i + 0.5) / nx) * w;
        const z = r.minZ + ((k + 0.5) / nz) * d;
        prop('tree', x, z, { x: 0, z: 1 }, range(br, 0.9, 1.25), 0);
        prop('grate', x, z, { x: 1, z: 0 });
        addCollider({ x, z, hw: 0.32, hd: 0.32, ax: { x: 1, z: 0 } }, 3);
      }
    }
  };

  const storeSpec: Record<Store['id'], { name: string; asset: string; tint: [number, number, number] }> = {
    market: { name: 'MARKET', asset: 'asset-ch08-npc', tint: [0.3, 1.0, 0.5] },
    diner: { name: 'DINER', asset: 'asset-ch28-npc', tint: [1.0, 0.3, 0.55] },
    news: { name: 'NEWS', asset: 'asset-ch31-npc', tint: [1.0, 0.75, 0.25] },
  };
  const makeStore = (id: Store['id'], lot: Rect): Store => {
    const spec = storeSpec[id];
    const doorX = (lot.minX + lot.maxX) / 2;
    const store: Store = {
      id, name: spec.name, x0: lot.minX, x1: lot.maxX, z0: lot.maxZ - 11, z1: lot.maxZ, doorX,
      keeper: { x: doorX + 1.6, z: lot.maxZ - 7.6 }, asset: spec.asset, tint: spec.tint,
    };
    stores.push(store);
    // Shell walls for people outside the store (the player uses the chunk collision mesh).
    const ax = { x: 1, z: 0 };
    const z0 = store.z0;
    const z1 = store.z1;
    addCollider({ x: lot.minX + 0.15, z: (z0 + z1) / 2, hw: 0.15, hd: (z1 - z0) / 2, ax }, 4.4);
    addCollider({ x: lot.maxX - 0.15, z: (z0 + z1) / 2, hw: 0.15, hd: (z1 - z0) / 2, ax }, 4.4);
    addCollider({ x: (lot.minX + lot.maxX) / 2, z: z0 + 0.15, hw: (lot.maxX - lot.minX) / 2, hd: 0.15, ax }, 4.4);
    addCollider({ x: (lot.minX + doorX - 0.95) / 2, z: z1 - 0.12, hw: (doorX - 0.95 - lot.minX) / 2, hd: 0.12, ax }, 3.2);
    addCollider({ x: (doorX + 0.95 + lot.maxX) / 2, z: z1 - 0.12, hw: (lot.maxX - doorX - 0.95) / 2, hd: 0.12, ax }, 3.2);
    // The rest of the lot behind the store is solid.
    if (z0 - lot.minZ > 0.5) addCollider({ x: (lot.minX + lot.maxX) / 2, z: (lot.minZ + z0) / 2, hw: (lot.maxX - lot.minX) / 2, hd: (z0 - lot.minZ) / 2, ax }, 4.4);
    light(doorX, lot.maxZ + 2.5, 7, 3, 0.85, 2.5);
    light(doorX, lot.maxZ - 5, 6, 3, 0.9, 3);
    return store;
  };

  for (let i = 0; i < CROSSES.length - 1; i += 1) {
    for (let k = 0; k < AVENUES.length - 1; k += 1) {
      const block = blockRect(i, k);
      blocks.push(block);
      const br = rng(CITY_SEED + 1000 + i * 31 + k * 7);
      const solids: Rect[] = [];
      const lots: Rect[] = [];
      const open: Rect[] = [];
      const cross = CROSSES[i];
      const ave = AVENUES[k];
      if (cross === -42 && ave === -56) {
        // Pierce's tower. The lobby is authored; the tower wraps it.
        const tower = { minX: -12, maxX: 12, minZ: -4, maxZ: 17.7 };
        const towerObb = axisObb(tower);
        const ax = { x: 1, z: 0 };
        const b: Building = {
          id: buildings.length,
          obb: towerObb,
          masses: [
            { obb: axisObb({ minX: -12, maxX: -7.14, minZ: -4, maxZ: 17.7 }), y0: 0, y1: 3.25, roof: 0, ridge: 0, street: 2, gfh: 3.25 },
            { obb: axisObb({ minX: 7.14, maxX: 12, minZ: -4, maxZ: 17.7 }), y0: 0, y1: 3.25, roof: 0, ridge: 0, street: 2, gfh: 3.25 },
            { obb: axisObb({ minX: -7.14, maxX: 7.14, minZ: -4, maxZ: 0.26 }), y0: 0, y1: 3.25, roof: 0, ridge: 0, street: 0, gfh: 0 },
            { obb: towerObb, y0: 3.25, y1: 150, roof: 0, ridge: 0, street: 0, gfh: 0 },
            { obb: { x: 0, z: 6.85, hw: 10.4, hd: 9.2, ax }, y0: 150, y1: 196, roof: 0, ridge: 0, street: 0, gfh: 0 },
            { obb: { x: 0, z: 6.85, hw: 7.4, hd: 6.4, ax }, y0: 196, y1: 212, roof: 0, ridge: 0, street: 0, gfh: 0 },
          ],
          style: STYLE.APEX,
          seed: 0.37,
          floorH: 3.6,
          bay: 1.7,
          height: 212,
          lit: 0.62,
          store: null,
          district: 'downtown',
          tall: true,
        };
        addBuilding(b);
        prop('antenna', 0, 6.85, ax, 34, 1, 0, 212);
        prop('awning', 0, 17.7, { x: 0, z: 1 }, 7.6, 6, 1, 0, { x: 1, z: 0 });
        solids.push({ minX: -12, maxX: 12, minZ: -4, maxZ: 17.7 });
        for (const x of [-9.5, -5.6, 5.6, 9.5]) {
          prop('bollard', x, 19.2, { x: 0, z: 1 });
          addCollider({ x, z: 19.2, hw: 0.14, hd: 0.14, ax }, 1);
        }
        prop('planter', -10, 15.2, { x: 0, z: 1 }, 2.6);
        prop('planter', 10, 15.2, { x: 0, z: 1 }, 2.6);
        lots.push(
          ...splitLots({ minX: block.minX, maxX: -14, minZ: block.minZ, maxZ: block.maxZ }, br),
          ...splitLots({ minX: 14, maxX: block.maxX, minZ: block.minZ, maxZ: block.maxZ }, br),
          ...splitLots({ minX: -14, maxX: 14, minZ: block.minZ, maxZ: -6 }, br),
        );
      } else if (cross === 42 && ave === -56) {
        const front = [[block.minX, 62], [62, 72], [72, 96], [96, 108], [108, block.maxX]] as const;
        for (const [x0, x1] of front) {
          const lot = { minX: x0, maxX: x1, minZ: 2, maxZ: block.maxZ };
          if (x0 === 62) downtownLot(lot, block, br, { height: range(br, 14, 20), style: STYLE.BRICK, store: makeStore('market', lot) });
          else if (x0 === 96) downtownLot(lot, block, br, { height: range(br, 16, 24), style: STYLE.STONE, store: makeStore('diner', lot) });
          else lots.push(lot);
          if (x0 === 62 || x0 === 96) solids.push(lot);
        }
        lots.push(...splitLots({ ...block, maxZ: 2 }, br));
      } else if (cross === 126 && ave === -56) {
        const corner = { minX: block.minX, maxX: 145, minZ: 4, maxZ: block.maxZ };
        const news = { minX: 145, maxX: 156, minZ: 4, maxZ: block.maxZ };
        const square = { minX: 156, maxX: 180, minZ: 4, maxZ: block.maxZ };
        lots.push(corner);
        downtownLot(news, block, br, { height: range(br, 18, 26), style: STYLE.BRICK, store: makeStore('news', news) });
        solids.push(news);
        open.push(square);
        lots.push(...splitLots({ minX: 180, maxX: block.maxX, minZ: block.minZ, maxZ: block.maxZ }, br));
        lots.push(...splitLots({ minX: block.minX, maxX: 180, minZ: block.minZ, maxZ: 4 }, br));
        // Subway globes either side of the stairs, a sign, and some trees.
        for (const z of [17.6, 24.8]) {
          prop('globe', 162.4, z, { x: 1, z: 0 });
          addCollider({ x: 162.4, z, hw: 0.16, hd: 0.16, ax: { x: 1, z: 0 } }, 3);
          light(162.4, z, 6, 7, 0.75, 3);
        }
        prop('planter', 158.5, 8, { x: 0, z: 1 }, 3.2);
        prop('planter', 177.5, 8, { x: 0, z: 1 }, 3.2);
        plaza({ minX: 157, maxX: 179, minZ: 6, maxZ: 14 }, br);
      } else if (cross === 42 && ave === 32) {
        // Liberty Square: open plaza with a fountain across from Pierce's walk.
        open.push(block);
        const cx = (block.minX + block.maxX) / 2;
        const cz = (block.minZ + block.maxZ) / 2;
        prop('fountain', cx, cz, { x: 0, z: 1 }, 5.2);
        addCollider({ x: cx, z: cz, hw: 5.4, hd: 5.4, ax: { x: 1, z: 0 } }, 1.2);
        light(cx, cz, 10, 6, 0.6, 1);
        for (let a = 0; a < 8; a += 1) {
          const ang = (a / 8) * Math.PI * 2 + Math.PI / 8;
          const x = cx + Math.cos(ang) * 11;
          const z = cz + Math.sin(ang) * 11;
          prop('bench', x, z, norm({ x: cx - x, z: cz - z }));
          addCollider({ x, z, hw: 0.95, hd: 0.35, ax: ccw(norm({ x: cx - x, z: cz - z })) }, 1);
        }
        for (let a = 0; a < 6; a += 1) {
          const ang = (a / 6) * Math.PI * 2;
          prop('lamp', cx + Math.cos(ang) * 17, cz + Math.sin(ang) * 17, { x: Math.cos(ang), z: Math.sin(ang) }, 0, 2);
          addCollider({ x: cx + Math.cos(ang) * 17, z: cz + Math.sin(ang) * 17, hw: 0.16, hd: 0.16, ax: { x: 1, z: 0 } }, 4);
          light(cx + Math.cos(ang) * 17, cz + Math.sin(ang) * 17, 9, 2, 0.9, 4);
        }
        const ring = { minX: block.minX + 2, maxX: block.maxX - 2, minZ: block.minZ + 2, maxZ: block.maxZ - 2 };
        for (let x = ring.minX + 3; x < ring.maxX; x += 8.5) {
          for (const z of [ring.minZ + 2, ring.maxZ - 2]) {
            prop('tree', x, z, { x: 0, z: 1 }, range(br, 1, 1.3), 1);
            prop('grate', x, z, { x: 1, z: 0 });
            addCollider({ x, z, hw: 0.32, hd: 0.32, ax: { x: 1, z: 0 } }, 3);
          }
        }
        for (let z = ring.minZ + 10; z < ring.maxZ - 8; z += 8.5) {
          for (const x of [ring.minX + 2, ring.maxX - 2]) {
            prop('tree', x, z, { x: 0, z: 1 }, range(br, 1, 1.3), 1);
            prop('grate', x, z, { x: 1, z: 0 });
            addCollider({ x, z, hw: 0.32, hd: 0.32, ax: { x: 1, z: 0 } }, 3);
          }
        }
      } else {
        lots.push(...splitLots(block, br));
      }
      for (const lot of lots) {
        const roll = br();
        const isCorner = streetMask(lot, block);
        if (roll < 0.06 && !(cross === -42 && ave === -56)) {
          open.push(lot);
          plaza(lot, br);
          continue;
        }
        downtownLot(lot, block, br);
        solids.push(lot);
        void isCorner;
      }
      // Paving: block minus buildings and holes.
      for (const r of rectsMinus([block], [...solids, ...holes])) paves.push({ pts: rectPts(r), kind: 4, y: CURB });
    }
  }

  // ---------- Frontage buildings outside downtown ----------
  const park = parks[0];
  const inPark = (p: V2, pad: number) => parks.some((pk) => Math.hypot(p.x - pk.x, p.z - pk.z) < pk.r + pad);
  const frontRand = rng(CITY_SEED + 5000);
  const params: Record<string, { w: [number, number]; d: [number, number]; set: [number, number]; gap: [number, number]; h: [number, number]; shop: number }> = {
    midtown: { w: [15, 30], d: [14, 26], set: [0.4, 2], gap: [0.6, 4], h: [12, 52], shop: 0.7 },
    apartments: { w: [13, 22], d: [11, 17], set: [3, 5.5], gap: [3, 7], h: [7, 18], shop: 0.18 },
    houses: { w: [8.5, 12.5], d: [8.5, 11.5], set: [6, 9], gap: [5, 10], h: [5.6, 8.6], shop: 0 },
    industrial: { w: [26, 52], d: [20, 36], set: [9, 15], gap: [8, 16], h: [8, 14], shop: 0 },
  };
  const footprintClear = (o: OBB, pad: number) => {
    const cs = obbCorners(o);
    const pts = [...cs, { x: o.x, z: o.z }];
    for (let i = 0; i < 4; i += 1) pts.push(scale(add(cs[i], cs[(i + 1) % 4]), 0.5));
    for (const p of pts) {
      if (roadClear(p) < pad) return false;
      if (insideDowntown(p.x, p.z, 4)) return false;
      if (inPark(p, 4)) return false;
      if (radialOf(p.x, p.z) > CITY_RADIUS + 40) return false;
    }
    // Any road segment through the footprint.
    const r = Math.hypot(o.hw, o.hd) + 2;
    for (const hit of pieceGrid.query(o.x - r, o.z - r, o.x + r, o.z + r)) {
      const a = hit.piece.pts[hit.i];
      const b = hit.piece.pts[hit.i + 1];
      for (let i = 0; i < 4; i += 1) if (segHit(a, b, cs[i], cs[(i + 1) % 4])) return false;
    }
    return true;
  };

  for (const piece of pieces) {
    const spec = piece.road.spec;
    for (const side of [1, -1]) {
      const sideStart = side > 0 ? piece.side0L : piece.side0R;
      const sideEnd = side > 0 ? piece.side1L : piece.side1R;
      let s = sideStart + range(frontRand, 1, 5);
      let guard = 0;
      while (s < piece.len - sideEnd - 6 && guard < 400) {
        guard += 1;
        const probe = pointAt(piece.pts, piece.cum, s);
        const dist0 = district(probe.x + 1, probe.z + 1);
        if (dist0 === 'downtown' || dist0 === 'park') {
          s += 8;
          continue;
        }
        const P = params[dist0];
        const w = range(frontRand, P.w[0], P.w[1]);
        const d = range(frontRand, P.d[0], P.d[1]);
        const setback = range(frontRand, P.set[0], P.set[1]);
        const mid = Math.min(s + w / 2, piece.len - 1);
        const c = pointAt(piece.pts, piece.cum, mid);
        const t = tangentAt(piece.pts, piece.cum, mid);
        const n = scale(ccw(t), side);
        const off = spec.half + spec.walk + setback + d / 2;
        // Local z points to the road.
        const toRoad = scale(n, -1);
        const ax = rightOf(toRoad);
        const o: OBB = { x: c.x + n.x * off, z: c.z + n.z * off, hw: w / 2, hd: d / 2, ax };
        if (!footprintClear(o, setback - 0.6) || blocked(o, 1)) {
          s += 3;
          continue;
        }
        const br = rng(Math.floor(frontRand() * 1e9));
        let height = range(br, P.h[0], P.h[1]);
        if (dist0 === 'midtown') {
          const rr = radialOf(o.x, o.z);
          height *= clamp(1.4 - rr / 700, 0.5, 1.2);
          if (br() < 0.12) height = range(br, 50, 85);
        }
        const style = styleFor(dist0, height, br);
        const storefront = br() < P.shop;
        const b = finishBuilding(o, height, style, storefront ? 2 : 0, storefront ? range(br, 4, 4.8) : 0, dist0, br);
        if (dist0 === 'houses' || dist0 === 'apartments') {
          // Front walk and a yard tree.
          const yard = add({ x: o.x, z: o.z }, scale(toRoad, d / 2 + setback * 0.5));
          if (br() < 0.75) {
            const side2 = br() < 0.5 ? 1 : -1;
            const tx = yard.x + ax.x * (w / 2 - 1) * side2;
            const tz = yard.z + ax.z * (w / 2 - 1) * side2;
            prop('tree', tx, tz, toRoad, range(br, 0.9, 1.4), dist0 === 'houses' ? 2 : 0);
            addCollider({ x: tx, z: tz, hw: 0.3, hd: 0.3, ax: { x: 1, z: 0 } }, 3);
          }
          if (dist0 === 'houses' && br() < 0.6) {
            const mx = yard.x + toRoad.x * (setback * 0.5 - 0.6) - ax.x * (w / 2 - 1.2);
            const mz = yard.z + toRoad.z * (setback * 0.5 - 0.6) - ax.z * (w / 2 - 1.2);
            prop('mailbox', mx, mz, toRoad);
          }
          // Porch light.
          if (br() < 0.6) light(o.x + toRoad.x * (d / 2 + 1.2), o.z + toRoad.z * (d / 2 + 1.2), 4, 2, 0.45, 2.5);
        }
        if (dist0 === 'industrial' && br() < 0.6) {
          const dx = o.x - ax.x * (w / 2 - 2) + toRoad.x * (d / 2 + 2.5);
          const dz = o.z - ax.z * (w / 2 - 2) + toRoad.z * (d / 2 + 2.5);
          prop('dumpster', dx, dz, toRoad);
          addCollider({ x: dx, z: dz, hw: 1, hd: 0.7, ax }, 1.3);
          light(o.x + toRoad.x * (d / 2 + 1), o.z + toRoad.z * (d / 2 + 1), 7, 1, 0.6, 5);
        }
        void b;
        s += w + range(frontRand, P.gap[0], P.gap[1]);
      }
    }
  }

  // ---------- Street props ----------
  const exclusions: Rect[] = [
    { minX: 160, maxX: 176, minZ: 16, maxZ: 27 },
    { minX: -4.5, maxX: 4.5, minZ: 17, maxZ: 27 },
    ...stores.map((st) => ({ minX: st.doorX - 2.5, maxX: st.doorX + 2.5, minZ: st.z1 - 1, maxZ: st.z1 + 7 })),
  ];
  const excluded = (x: number, z: number) => exclusions.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
  const propRand = rng(CITY_SEED + 9000);
  const placedNear = new Grid<V2>(8);
  const roomFor = (x: number, z: number, r: number) => {
    for (const p of placedNear.query(x - r, z - r, x + r, z + r)) if (Math.hypot(p.x - x, p.z - z) < r) return false;
    return true;
  };
  const claim = (x: number, z: number) => placedNear.insert({ x, z }, x, z, x, z);

  const lampStyle = (d: District) => (d === 'downtown' ? 0 : d === 'midtown' || d === 'industrial' ? 1 : 2);
  const lampLight = (d: District) => (d === 'downtown' ? 0 : d === 'midtown' || d === 'industrial' ? 1 : 2);

  for (const piece of pieces) {
    const spec = piece.road.spec;
    const cls = piece.road.cls;
    const mid = pointAt(piece.pts, piece.cum, piece.len / 2);
    const dz = district(mid.x, mid.z);
    const downtown = dz === 'downtown';
    for (const side of [1, -1]) {
      const s0 = (side > 0 ? piece.side0L : piece.side0R) + 1.2;
      const s1 = piece.len - (side > 0 ? piece.side1L : piece.side1R) - 1.2;
      if (s1 - s0 < 4) continue;
      const at = (s: number, lateral: number) => {
        const p = pointAt(piece.pts, piece.cum, s);
        const t = tangentAt(piece.pts, piece.cum, s);
        const n = scale(ccw(t), side);
        return { p: add(p, scale(n, lateral)), toRoad: scale(n, -1), t };
      };
      const put = (kind: PropKind, s: number, lateral: number, r: number, a = 0, b = 0, c = 0) => {
        if (s < s0 || s > s1) return null;
        const { p, toRoad, t } = at(s, lateral);
        if (excluded(p.x, p.z) || !roomFor(p.x, p.z, r)) return null;
        if (inPark(p, -2) && kind !== 'lamp') return null;
        claim(p.x, p.z);
        return prop(kind, p.x, p.z, toRoad, a, b, c, 0, t);
      };
      // Lamps.
      const spacing = downtown ? 30 : cls === 'lane' ? 42 : 36;
      if (!(cls === 'lane' && side < 0)) {
        for (let s = s0 + (side > 0 ? 4 : spacing / 2); s < s1; s += spacing) {
          const arm = downtown ? 2.4 : cls === 'boulevard' || cls === 'arterial' ? 2.6 : 1.6;
          const lp = put('lamp', s, spec.half + 0.55, 1.2, arm, lampStyle(dz));
          if (!lp) continue;
          addCollider({ x: lp.x, z: lp.z, hw: 0.16, hd: 0.16, ax: { x: 1, z: 0 } }, 6);
          light(lp.x + lp.f.x * arm, lp.z + lp.f.z * arm, downtown ? 11 : 10, lampLight(dz), downtown ? 1 : 0.9, 7);
        }
      }
      // Trees in pits.
      if ((downtown || dz === 'midtown') && spec.walk >= 4 && hash2(piece.id, side, 3) < (cls === 'avenue' ? 0.8 : 0.55)) {
        for (let s = s0 + 7; s < s1 - 3; s += range(propRand, 10, 13)) {
          const tp = put('tree', s, spec.half + 1.35, 2.2, range(propRand, 0.85, 1.15), 0);
          if (!tp) continue;
          prop('grate', tp.x, tp.z, tp.f);
          addCollider({ x: tp.x, z: tp.z, hw: 0.28, hd: 0.28, ax: { x: 1, z: 0 } }, 3);
        }
      }
      if ((dz === 'apartments' || dz === 'houses') && spec.walk >= 2) {
        for (let s = s0 + 5; s < s1 - 3; s += range(propRand, 14, 22)) {
          const tp = put('tree', s, spec.half + spec.walk + 1.4, 2.5, range(propRand, 0.9, 1.35), dz === 'houses' ? 2 : 0);
          if (tp) addCollider({ x: tp.x, z: tp.z, hw: 0.3, hd: 0.3, ax: { x: 1, z: 0 } }, 3);
        }
      }
      // Hydrant near the start of each side.
      if (dz !== 'park') {
        const hp = put('hydrant', s0 + range(propRand, 2, 6), spec.half + 0.6, 1.2);
        if (hp) addCollider({ x: hp.x, z: hp.z, hw: 0.2, hd: 0.2, ax: { x: 1, z: 0 } }, 0.8);
      }
      // Bins and news boxes near corners.
      if (downtown || dz === 'midtown') {
        for (const s of [s0 + 1.5, s1 - 1.5]) {
          if (propRand() < 0.7) {
            const bp = put('bin', s, spec.half + spec.walk - 0.9, 1.1, 0, Math.floor(propRand() * 2));
            if (bp) addCollider({ x: bp.x, z: bp.z, hw: 0.3, hd: 0.3, ax: { x: 1, z: 0 } }, 1);
          }
          if (downtown && propRand() < 0.55) {
            const count = 1 + Math.floor(propRand() * 3);
            for (let q = 0; q < count; q += 1) {
              const np = put('newsbox', s + (s < piece.len / 2 ? 2.4 : -2.4) + q * 0.62 * (s < piece.len / 2 ? 1 : -1), spec.half + spec.walk - 0.7, 0.3, 0, Math.floor(propRand() * 5));
              if (np) addCollider({ x: np.x, z: np.z, hw: 0.28, hd: 0.25, ax: np.g ?? { x: 1, z: 0 } }, 1.1);
            }
          }
        }
        // Benches mid block.
        if (spec.walk >= 4 && propRand() < 0.55) {
          const bp = put('bench', (s0 + s1) / 2 + range(propRand, -6, 6), spec.half + spec.walk - 1.2, 2);
          if (bp) addCollider({ x: bp.x, z: bp.z, hw: 0.95, hd: 0.32, ax: bp.g ?? { x: 1, z: 0 } }, 1);
        }
      }
      // Bus stops on the big roads.
      if ((cls === 'avenue' || cls === 'arterial' || cls === 'boulevard') && hash2(piece.id, side, 11) < (downtown ? 0.32 : 0.22) && s1 - s0 > 30) {
        const bs = put('busstop', (s0 + s1) / 2, spec.half + Math.min(spec.walk - 1.2, 2.6), 4);
        if (bs) {
          const g = bs.g ?? { x: 1, z: 0 };
          addCollider({ x: bs.x - bs.f.x * 0.75, z: bs.z - bs.f.z * 0.75, hw: 1.9, hd: 0.12, ax: g }, 2.4);
          light(bs.x, bs.z, 4.5, 4, 0.55, 2);
        }
      }
      // Parking.
      if (spec.parking) {
        const lateral = spec.half - 1.05;
        for (let s = s0 + 5; s < s1 - 5; s += 6.4) {
          if (propRand() > (downtown ? 0.55 : 0.42)) continue;
          const { p, t } = at(s, lateral);
          if (excluded(p.x, p.z)) continue;
          // Parked cars face traffic on their side: right-hand traffic.
          const heading = side > 0 ? scale(t, -1) : t;
          prop('car', p.x, p.z, heading, Math.floor(propRand() * 8));
          addCollider({ x: p.x, z: p.z, hw: 2.25, hd: 0.95, ax: heading }, 1.5);
        }
        if (downtown) {
          for (let s = s0 + 4; s < s1 - 3; s += 6.4) put('meter', s, spec.half + 0.45, 0.5);
        }
      }
    }
  }

  // Signals, street signs.
  for (const j of junctions) {
    if (!j.signal) continue;
    for (const arm of j.arms) {
      const L = ccw(arm.d);
      const base = add({ x: j.x, z: j.z }, add(scale(arm.d, arm.cut + 0.9), scale(L, arm.half + 0.75)));
      const axis = Math.abs(arm.d.x) > Math.abs(arm.d.z) ? 0 : 1;
      prop('signal', base.x, base.z, scale(L, -1), arm.half * 0.72, axis, 0, 0, arm.d);
      addCollider({ x: base.x, z: base.z, hw: 0.2, hd: 0.2, ax: { x: 1, z: 0 } }, 6);
      claim(base.x, base.z);
      if (j.arms.indexOf(arm) % 2 === 0) prop('sign', base.x, base.z, arm.d, 0, axis);
    }
  }

  // ---------- Park dressing ----------
  const parkPaths: { pts: V2[]; w: number }[] = [];
  if (park) {
    const pr = rng(CITY_SEED + 31);
    const loop: V2[] = [];
    for (let i = 0; i <= 64; i += 1) {
      const a = (i / 64) * Math.PI * 2;
      const rr = park.r * (0.62 + 0.08 * Math.sin(a * 3 + 1.2));
      loop.push({ x: park.x + Math.cos(a) * rr, z: park.z + Math.sin(a) * rr });
    }
    parkPaths.push({ pts: loop, w: 3.2 });
    const a0 = range(pr, 0, Math.PI);
    const diag = hermite(
      { x: park.x + Math.cos(a0) * park.r * 0.98, z: park.z + Math.sin(a0) * park.r * 0.98 },
      { x: -Math.cos(a0) * park.r, z: -Math.sin(a0) * park.r * 0.6 },
      { x: park.x - Math.cos(a0) * park.r * 0.98, z: park.z - Math.sin(a0) * park.r * 0.98 },
      { x: -Math.cos(a0) * park.r * 0.6, z: -Math.sin(a0) * park.r },
      40,
    );
    parkPaths.push({ pts: diag, w: 2.6 });
    const onPath = (p: V2, pad: number) => parkPaths.some((path) => {
      for (let i = 0; i < path.pts.length - 1; i += 1) if (segDist(p, path.pts[i], path.pts[i + 1]).d < path.w / 2 + pad) return true;
      return false;
    });
    const inPond = (p: V2, pad: number) => {
      if (!park.pond) return false;
      const { x, z, rx, rz } = park.pond;
      return ((p.x - x) / (rx + pad)) ** 2 + ((p.z - z) / (rz + pad)) ** 2 < 1;
    };
    for (let i = 0; i < loop.length - 1; i += 6) {
      const p = loop[i];
      const t = norm(sub(loop[i + 1], p));
      const lp = add(p, scale(ccw(t), 2.4));
      if (inPond(lp, 2)) continue;
      prop('lamp', lp.x, lp.z, scale(ccw(t), -1), 0, 2);
      addCollider({ x: lp.x, z: lp.z, hw: 0.16, hd: 0.16, ax: { x: 1, z: 0 } }, 4);
      light(lp.x, lp.z, 9, 2, 0.85, 4);
      if (i % 12 === 0) {
        const bp = add(p, scale(ccw(t), -2.5));
        prop('bench', bp.x, bp.z, ccw(t));
        addCollider({ x: bp.x, z: bp.z, hw: 0.95, hd: 0.32, ax: t }, 1);
      }
    }
    let placed = 0;
    for (let tries = 0; tries < 900 && placed < 160; tries += 1) {
      const a = range(pr, 0, Math.PI * 2);
      const rr = Math.sqrt(pr()) * (park.r - 4);
      const p = { x: park.x + Math.cos(a) * rr, z: park.z + Math.sin(a) * rr };
      if (onPath(p, 2) || inPond(p, 3) || !roomFor(p.x, p.z, 4.5)) continue;
      claim(p.x, p.z);
      prop('tree', p.x, p.z, { x: 0, z: 1 }, range(pr, 0.9, 1.6), pr() < 0.3 ? 2 : 1);
      addCollider({ x: p.x, z: p.z, hw: 0.32, hd: 0.32, ax: { x: 1, z: 0 } }, 3);
      placed += 1;
    }
  }

  // ---------- Infill trees: back yards and woods between the streets ----------
  {
    const woods = rng(CITY_SEED + 77);
    const noise2 = (x: number, z: number) => {
      const ix = Math.floor(x);
      const iz = Math.floor(z);
      const fx = x - ix;
      const fz = z - iz;
      const ux = fx * fx * (3 - 2 * fx);
      const uz = fz * fz * (3 - 2 * fz);
      const a = hash2(ix, iz, 5);
      const b = hash2(ix + 1, iz, 5);
      const c = hash2(ix, iz + 1, 5);
      const d = hash2(ix + 1, iz + 1, 5);
      return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
    };
    const reach = CITY_RADIUS * ELLIPSE + 40;
    for (let x = CENTER.x - reach; x < CENTER.x + reach; x += 12) {
      for (let z = CENTER.z - CITY_RADIUS - 40; z < CENTER.z + CITY_RADIUS + 40; z += 12) {
        const p = { x: x + range(woods, -4.5, 4.5), z: z + range(woods, -4.5, 4.5) };
        if (radialOf(p.x, p.z) > CITY_RADIUS + 30) continue;
        const dz = district(p.x, p.z);
        if (dz === 'downtown' || dz === 'park') continue;
        const patch = noise2(p.x / 85, p.z / 85);
        const want = dz === 'houses' ? 0.75 : dz === 'apartments' ? 0.5 : dz === 'industrial' ? 0.2 : 0.18;
        if (woods() > want * smoothPatch(patch)) continue;
        if (roadClear(p) < 7) continue;
        let nearBuilding = false;
        for (const b of buildingGrid.query(p.x - 4, p.z - 4, p.x + 4, p.z + 4)) {
          if (obbPush(b.obb, p, 2.5)) {
            nearBuilding = true;
            break;
          }
        }
        if (nearBuilding || !roomFor(p.x, p.z, 4)) continue;
        claim(p.x, p.z);
        prop('tree', p.x, p.z, { x: 0, z: 1 }, range(woods, 0.85, 1.5), woods() < 0.4 ? 2 : 1);
        addCollider({ x: p.x, z: p.z, hw: 0.3, hd: 0.3, ax: { x: 1, z: 0 } }, 3);
      }
    }
  }

  // ---------- Walk paths ----------
  const walks: WalkPath[] = [];
  const addWalk = (pts: V2[], closed: boolean) => {
    if (pts.length < 2) return;
    const list = closed ? [...pts, pts[0]] : pts;
    const cum = cumulative(list);
    if (cum[cum.length - 1] < 8) return;
    walks.push({ pts: list, cum, len: cum[cum.length - 1], closed });
  };
  for (const b of blocks) {
    const m = 3;
    const r = { minX: b.minX - m, maxX: b.maxX + m, minZ: b.minZ - m, maxZ: b.maxZ + m };
    const c = 2.4;
    addWalk([
      { x: r.minX + c, z: r.minZ }, { x: r.maxX - c, z: r.minZ }, { x: r.maxX, z: r.minZ + c },
      { x: r.maxX, z: r.maxZ - c }, { x: r.maxX - c, z: r.maxZ }, { x: r.minX + c, z: r.maxZ },
      { x: r.minX, z: r.maxZ - c }, { x: r.minX, z: r.minZ + c },
    ], true);
  }
  for (const piece of pieces) {
    const spec = piece.road.spec;
    if (piece.road.grid || spec.walk < 2) continue;
    for (const side of [1, -1]) {
      const s0 = side > 0 ? piece.side0L : piece.side0R;
      const s1 = piece.len - (side > 0 ? piece.side1L : piece.side1R);
      if (s1 - s0 < 10) continue;
      const sub0 = slice(piece.pts, piece.cum, s0, s1);
      addWalk(offsetLine(resample(sub0, 6), side * (spec.half + spec.walk * 0.55)), false);
    }
  }
  for (const path of parkPaths) addWalk(path.pts.slice(0, -1), path.pts.length > 60);

  // ---------- Lanes ----------
  const lanes: Lane[] = [];
  for (const piece of pieces) {
    const spec = piece.road.spec;
    const usable = piece.len - piece.cut0 - piece.cut1;
    if (usable < 4) continue;
    const core = slice(piece.pts, piece.cum, piece.cut0, piece.len - piece.cut1);
    const fine = resample(core, 4);
    for (const forward of [true, false]) {
      for (let index = 0; index < spec.lanes; index += 1) {
        const offset = spec.median + spec.laneW * (index + 0.5);
        const base = forward ? fine : fine.slice().reverse();
        // Right of heading = -ccw.
        const pts = offsetLine(base, -offset);
        const cum = cumulative(pts);
        const to = forward ? piece.j1 : piece.j0;
        const from = forward ? piece.j0 : piece.j1;
        const lane: Lane = {
          id: lanes.length,
          piece,
          forward,
          index,
          pts,
          cum,
          len: cum[cum.length - 1],
          from,
          to,
          speed: spec.speed,
          axis: piece.axis,
          stopAt: cum[cum.length - 1] - ((forward ? piece.walk1 : piece.walk0) ? 5.6 : 1.2),
          signal: to.signal,
          next: [],
          lanes: spec.lanes,
        };
        lanes.push(lane);
      }
    }
  }
  const lanesFrom = new Map<Junction, Lane[]>();
  for (const lane of lanes) {
    const list = lanesFrom.get(lane.from) ?? [];
    list.push(lane);
    lanesFrom.set(lane.from, list);
  }
  for (const lane of lanes) {
    const out = (lanesFrom.get(lane.to) ?? []).filter((next) => next.piece !== lane.piece || lane.to.dead);
    lane.next = out.filter((next) => next.index === Math.min(lane.index, next.lanes - 1) || next.lanes === 1);
    if (!lane.next.length) lane.next = out;
  }

  // ---------- Grids ----------
  const walkGrid = new Grid<{ path: WalkPath; i: number }>(24);
  for (const path of walks) {
    for (let i = 0; i < path.pts.length - 1; i += 1) {
      const a = path.pts[i];
      const b = path.pts[i + 1];
      walkGrid.insert({ path, i }, Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z));
    }
  }
  const laneGrid = new Grid<{ lane: Lane; i: number }>(32);
  for (const lane of lanes) {
    for (let i = 0; i < lane.pts.length - 1; i += 1) {
      const a = lane.pts[i];
      const b = lane.pts[i + 1];
      laneGrid.insert({ lane, i }, Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z));
    }
  }

  void cross;
  void obbPush;
  return {
    roads, pieces, junctions, buildings, props, lights, walks, lanes, colliders, paves, parks, parkPaths, stores, blocks, holes,
    grids: { pieces: pieceGrid, junctions: junctionGrid, buildings: buildingGrid, colliders: colliderGrid, walks: walkGrid, lanes: laneGrid },
    district,
    radial: radialOf,
  };
};
