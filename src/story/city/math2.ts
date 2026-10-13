/** Small deterministic helpers and 2D polyline math for the Going Home city. Plane is x / z. */

export type V2 = { x: number; z: number };

export const v2 = (x: number, z: number): V2 => ({ x, z });

/** mulberry32. Same seed, same city. */
export const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export type Rand = ReturnType<typeof rng>;

export const range = (rand: Rand, a: number, b: number) => a + (b - a) * rand();
export const pick = <T>(rand: Rand, list: readonly T[]) => list[Math.floor(rand() * list.length) % list.length];

/** Stable 0..1 hash of two integers and a salt. */
export const hash2 = (i: number, j: number, salt = 0) => {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/** Smooth 1D value noise, period free. */
export const noise1 = (t: number, salt = 0) => {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return hash2(i, 0, salt) * (1 - u) + hash2(i + 1, 0, salt) * u;
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export const sub = (a: V2, b: V2): V2 => ({ x: a.x - b.x, z: a.z - b.z });
export const add = (a: V2, b: V2): V2 => ({ x: a.x + b.x, z: a.z + b.z });
export const scale = (a: V2, s: number): V2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: V2, b: V2) => a.x * b.x + a.z * b.z;
export const cross = (a: V2, b: V2) => a.x * b.z - a.z * b.x;
export const len = (a: V2) => Math.hypot(a.x, a.z);
export const dist = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.z - b.z);
export const norm = (a: V2): V2 => {
  const l = Math.hypot(a.x, a.z) || 1;
  return { x: a.x / l, z: a.z / l };
};
/** Counter-clockwise quarter turn seen from above (+y). */
export const ccw = (a: V2): V2 => ({ x: -a.z, z: a.x });
/** Right of a heading. Traffic keeps right. */
export const rightOf = (a: V2): V2 => ({ x: a.z, z: -a.x });

export const cumulative = (pts: V2[]) => {
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return cum;
};

/** Segment index and local t for arc length s. */
const locate = (cum: number[], s: number) => {
  const last = cum.length - 1;
  if (s <= 0) return { i: 0, t: 0 };
  if (s >= cum[last]) return { i: Math.max(0, last - 1), t: 1 };
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const span = cum[lo + 1] - cum[lo] || 1;
  return { i: lo, t: (s - cum[lo]) / span };
};

export const pointAt = (pts: V2[], cum: number[], s: number): V2 => {
  const { i, t } = locate(cum, s);
  const a = pts[i];
  const b = pts[Math.min(i + 1, pts.length - 1)];
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
};

export const tangentAt = (pts: V2[], cum: number[], s: number): V2 => {
  const { i } = locate(cum, s);
  const a = pts[i];
  const b = pts[Math.min(i + 1, pts.length - 1)];
  return norm(sub(b, a));
};

/** Even spacing. Keeps both ends. */
export const resample = (pts: V2[], step: number) => {
  const cum = cumulative(pts);
  const total = cum[cum.length - 1];
  const count = Math.max(1, Math.round(total / step));
  const out: V2[] = [];
  for (let i = 0; i <= count; i += 1) out.push(pointAt(pts, cum, (total * i) / count));
  return out;
};

/** Sub polyline between arc lengths. */
export const slice = (pts: V2[], cum: number[], s0: number, s1: number) => {
  const out: V2[] = [pointAt(pts, cum, s0)];
  for (let i = 0; i < pts.length; i += 1) {
    if (cum[i] > s0 + 0.01 && cum[i] < s1 - 0.01) out.push(pts[i]);
  }
  out.push(pointAt(pts, cum, s1));
  return out;
};

/** Per point normals (left = ccw of heading), averaged at joints. */
export const offsetLine = (pts: V2[], offset: number) => {
  const out: V2[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const n = ccw(norm(sub(next, prev)));
    out.push({ x: pts[i].x + n.x * offset, z: pts[i].z + n.z * offset });
  }
  return out;
};

/** Cubic Hermite from p0 to p1. */
export const hermite = (p0: V2, t0: V2, p1: V2, t1: V2, steps: number) => {
  const out: V2[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    out.push({
      x: h00 * p0.x + h10 * t0.x + h01 * p1.x + h11 * t1.x,
      z: h00 * p0.z + h10 * t0.z + h01 * p1.z + h11 * t1.z,
    });
  }
  return out;
};

export const quadBezier = (a: V2, c: V2, b: V2, steps: number) => {
  const out: V2[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, z: u * u * a.z + 2 * u * t * c.z + t * t * b.z });
  }
  return out;
};

/** Intersection of lines p + t*d and q + u*e. Null when parallel. */
export const lineHit = (p: V2, d: V2, q: V2, e: V2) => {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-6) return null;
  const w = sub(q, p);
  const t = cross(w, e) / den;
  return { x: p.x + d.x * t, z: p.z + d.z * t, t };
};

/** Segment intersection, returns params on both. */
export const segHit = (a: V2, b: V2, c: V2, d: V2) => {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const w = sub(c, a);
  const t = cross(w, s) / den;
  const u = cross(w, r) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, x: a.x + r.x * t, z: a.z + r.z * t };
};

export const segDist = (p: V2, a: V2, b: V2) => {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const l2 = abx * abx + abz * abz || 1e-9;
  const t = clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / l2, 0, 1);
  return { d: Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t)), t };
};

/** Oriented rectangle. Local x along `ax`, local z along ccw(ax). */
export type OBB = { x: number; z: number; hw: number; hd: number; ax: V2 };

export const obbCorners = (o: OBB): V2[] => {
  const bz = ccw(o.ax);
  const c: V2[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    c.push({ x: o.x + o.ax.x * o.hw * sx + bz.x * o.hd * sz, z: o.z + o.ax.z * o.hw * sx + bz.z * o.hd * sz });
  }
  return c;
};

export const obbOverlap = (a: OBB, b: OBB, pad = 0) => {
  const axes = [a.ax, ccw(a.ax), b.ax, ccw(b.ax)];
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  for (const axis of axes) {
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const p of ca) {
      const v = dot(p, axis);
      a0 = Math.min(a0, v);
      a1 = Math.max(a1, v);
    }
    for (const p of cb) {
      const v = dot(p, axis);
      b0 = Math.min(b0, v);
      b1 = Math.max(b1, v);
    }
    if (a1 + pad <= b0 || b1 + pad <= a0) return false;
  }
  return true;
};

/** Point in an OBB inflated by r. Returns push-out vector or null. */
export const obbPush = (o: OBB, p: V2, r: number) => {
  const bz = ccw(o.ax);
  const dx = p.x - o.x;
  const dz = p.z - o.z;
  const lx = dx * o.ax.x + dz * o.ax.z;
  const lz = dx * bz.x + dz * bz.z;
  const ex = o.hw + r;
  const ez = o.hd + r;
  if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) return null;
  const px = ex - Math.abs(lx);
  const pz = ez - Math.abs(lz);
  if (px < pz) {
    const s = Math.sign(lx) || 1;
    return { x: o.ax.x * px * s, z: o.ax.z * px * s };
  }
  const s = Math.sign(lz) || 1;
  return { x: bz.x * pz * s, z: bz.z * pz * s };
};

export const pointInObb = (o: OBB, p: V2, pad = 0) => obbPush(o, p, pad) !== null;

/** Ear clipping for a simple polygon. Returns index triples. */
export const earcut = (poly: V2[]) => {
  const n = poly.length;
  if (n < 3) return [] as number[];
  let area = 0;
  for (let i = 0; i < n; i += 1) area += cross(poly[i], poly[(i + 1) % n]);
  const idx = Array.from({ length: n }, (_, i) => i);
  if (area < 0) idx.reverse();
  const out: number[] = [];
  const inside = (p: V2, a: V2, b: V2, c: V2) => (
    cross(sub(b, a), sub(p, a)) >= -1e-9 && cross(sub(c, b), sub(p, b)) >= -1e-9 && cross(sub(a, c), sub(p, c)) >= -1e-9
  );
  let guard = 0;
  while (idx.length > 3 && guard < 4000) {
    guard += 1;
    let clipped = false;
    for (let i = 0; i < idx.length; i += 1) {
      const ia = idx[(i + idx.length - 1) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const a = poly[ia];
      const b = poly[ib];
      const c = poly[ic];
      if (cross(sub(b, a), sub(c, b)) <= 1e-9) continue;
      let ear = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (inside(poly[j], a, b, c)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      out.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Degenerate. Fan the rest so nothing is left open.
      for (let i = 1; i < idx.length - 1; i += 1) out.push(idx[0], idx[i], idx[i + 1]);
      return out;
    }
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
};

/** Uniform grid of buckets for broad-phase queries. */
export class Grid<T> {
  private cells = new Map<number, T[]>();
  constructor(readonly size: number) {}
  private key(ix: number, iz: number) {
    return (ix + 4096) * 8192 + (iz + 4096);
  }
  insert(item: T, x0: number, z0: number, x1: number, z1: number) {
    const s = this.size;
    for (let ix = Math.floor(x0 / s); ix <= Math.floor(x1 / s); ix += 1) {
      for (let iz = Math.floor(z0 / s); iz <= Math.floor(z1 / s); iz += 1) {
        const k = this.key(ix, iz);
        let list = this.cells.get(k);
        if (!list) {
          list = [];
          this.cells.set(k, list);
        }
        list.push(item);
      }
    }
  }
  query(x0: number, z0: number, x1: number, z1: number, out: Set<T> = new Set()) {
    const s = this.size;
    for (let ix = Math.floor(x0 / s); ix <= Math.floor(x1 / s); ix += 1) {
      for (let iz = Math.floor(z0 / s); iz <= Math.floor(z1 / s); iz += 1) {
        const list = this.cells.get(this.key(ix, iz));
        if (list) for (const item of list) out.add(item);
      }
    }
    return out;
  }
}
