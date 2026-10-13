import * as BABYLON from '@babylonjs/core';

import type { V2 } from './math2';

type Vec3 = [number, number, number];

/**
 * Append-only geometry. Every chunk merges into a handful of these, one per
 * material, so a city block is a few draw calls instead of hundreds.
 */
export class Geo {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  uv2: number[] = [];
  uv3: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  count = 0;
  /** Current attribute state for subsequent vertices. */
  a = { u2: [0, 0] as [number, number], u3: [0, 0] as [number, number], c: [0, 0, 0, 0] as [number, number, number, number] };
  /** When set, every vertex gets this uv instead of the one passed (prop mode / param). */
  fixedUv: [number, number] | null = null;

  constructor(readonly useUv3 = false) {}

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, v = 0) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    const fu = this.fixedUv;
    this.uv.push(fu ? fu[0] : u, fu ? fu[1] : v);
    this.uv2.push(this.a.u2[0], this.a.u2[1]);
    if (this.useUv3) this.uv3.push(this.a.u3[0], this.a.u3[1]);
    this.col.push(this.a.c[0], this.a.c[1], this.a.c[2], this.a.c[3]);
    this.count += 1;
    return this.count - 1;
  }

  /** Triangle facing `n` (winding fixed to Babylon's front face). */
  tri(a: number, b: number, c: number, n: Vec3) {
    const p = this.pos;
    const ax = p[a * 3];
    const ay = p[a * 3 + 1];
    const az = p[a * 3 + 2];
    const e1x = p[b * 3] - ax;
    const e1y = p[b * 3 + 1] - ay;
    const e1z = p[b * 3 + 2] - az;
    const e2x = p[c * 3] - ax;
    const e2y = p[c * 3 + 1] - ay;
    const e2z = p[c * 3 + 2] - az;
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    // Babylon front faces have normal = -(e1 x e2).
    if (cx * n[0] + cy * n[1] + cz * n[2] > 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }

  /** Planar quad p0..p3 in order around the edge. */
  quad(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, n: Vec3, uvs?: [number, number][]) {
    const t = uvs ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
    const a = this.vert(p0[0], p0[1], p0[2], n[0], n[1], n[2], t[0][0], t[0][1]);
    const b = this.vert(p1[0], p1[1], p1[2], n[0], n[1], n[2], t[1][0], t[1][1]);
    const c = this.vert(p2[0], p2[1], p2[2], n[0], n[1], n[2], t[2][0], t[2][1]);
    const d = this.vert(p3[0], p3[1], p3[2], n[0], n[1], n[2], t[3][0], t[3][1]);
    this.tri(a, b, c, n);
    this.tri(a, c, d, n);
  }

  /**
   * Oriented box. ax is local x on the ground plane, local z is ccw(ax).
   * faces: bit mask of which faces to emit (+x, +z, -x, -z, top, bottom).
   */
  box(cx: number, y0: number, cz: number, hw: number, h: number, hd: number, ax: V2, faces = 0b011111) {
    const bx = { x: -ax.z, z: ax.x };
    const y1 = y0 + h;
    const c = (sx: number, sz: number, y: number): Vec3 => [cx + ax.x * hw * sx + bx.x * hd * sz, y, cz + ax.z * hw * sx + bx.z * hd * sz];
    const nx: Vec3 = [ax.x, 0, ax.z];
    const nz: Vec3 = [bx.x, 0, bx.z];
    if (faces & 1) this.quad(c(1, -1, y0), c(1, 1, y0), c(1, 1, y1), c(1, -1, y1), nx);
    if (faces & 2) this.quad(c(1, 1, y0), c(-1, 1, y0), c(-1, 1, y1), c(1, 1, y1), nz);
    if (faces & 4) this.quad(c(-1, 1, y0), c(-1, -1, y0), c(-1, -1, y1), c(-1, 1, y1), [-nx[0], 0, -nx[2]]);
    if (faces & 8) this.quad(c(-1, -1, y0), c(1, -1, y0), c(1, -1, y1), c(-1, -1, y1), [-nz[0], 0, -nz[2]]);
    if (faces & 16) this.quad(c(-1, -1, y1), c(1, -1, y1), c(1, 1, y1), c(-1, 1, y1), [0, 1, 0]);
    if (faces & 32) this.quad(c(-1, -1, y0), c(1, -1, y0), c(1, 1, y0), c(-1, 1, y0), [0, -1, 0]);
  }

  /** Vertical cylinder or frustum. */
  cyl(x: number, y0: number, z: number, r0: number, r1: number, h: number, seg = 8, caps = true) {
    const y1 = y0 + h;
    const slope = (r0 - r1) / Math.max(h, 1e-3);
    for (let i = 0; i < seg; i += 1) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const n: Vec3 = [Math.cos(am), slope, Math.sin(am)];
      const l = Math.hypot(n[0], n[1], n[2]);
      n[0] /= l;
      n[1] /= l;
      n[2] /= l;
      this.quad(
        [x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0],
        [x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0],
        [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1],
        [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1],
        n,
      );
    }
    if (caps && r1 > 0.001) {
      const c = this.vert(x, y1, z, 0, 1, 0);
      const ring: number[] = [];
      for (let i = 0; i < seg; i += 1) {
        const a = (i / seg) * Math.PI * 2;
        ring.push(this.vert(x + Math.cos(a) * r1, y1, z + Math.sin(a) * r1, 0, 1, 0));
      }
      for (let i = 0; i < seg; i += 1) this.tri(c, ring[i], ring[(i + 1) % seg], [0, 1, 0]);
    }
  }

  /** Horizontal cylinder along a direction (wheels, poles lying down). */
  hcyl(x: number, y: number, z: number, dir: V2, r: number, len: number, seg = 8) {
    const side = { x: -dir.z, z: dir.x };
    const ring = (o: number, a: number): Vec3 => [
      x + dir.x * o + side.x * Math.cos(a) * r,
      y + Math.sin(a) * r,
      z + dir.z * o + side.z * Math.cos(a) * r,
    ];
    for (let i = 0; i < seg; i += 1) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const n: Vec3 = [side.x * Math.cos(am), Math.sin(am), side.z * Math.cos(am)];
      this.quad(ring(-len / 2, a0), ring(-len / 2, a1), ring(len / 2, a1), ring(len / 2, a0), n);
    }
    for (const end of [-1, 1]) {
      const n: Vec3 = [dir.x * end, 0, dir.z * end];
      const c = this.vert(x + dir.x * end * len / 2, y, z + dir.z * end * len / 2, n[0], n[1], n[2]);
      const ids: number[] = [];
      for (let i = 0; i < seg; i += 1) {
        const p = ring((end * len) / 2, (i / seg) * Math.PI * 2);
        ids.push(this.vert(p[0], p[1], p[2], n[0], n[1], n[2]));
      }
      for (let i = 0; i < seg; i += 1) this.tri(c, ids[i], ids[(i + 1) % seg], n);
    }
  }

  /** Low poly blob (subdivided octahedron), squashed. Canopies, shrubs, globes. */
  blob(x: number, y: number, z: number, rx: number, ry: number, rz: number, jitter = 0, salt = 0) {
    const base = BLOB;
    const ids: number[] = [];
    for (let i = 0; i < base.verts.length; i += 1) {
      const [vx, vy, vz] = base.verts[i];
      const j = jitter ? 1 + (hashf(i + salt * 31) - 0.5) * jitter : 1;
      ids.push(this.vert(x + vx * rx * j, y + vy * ry * j, z + vz * rz * j, vx, vy, vz));
    }
    for (const [a, b, c] of base.tris) {
      const va = base.verts[a];
      const vb = base.verts[b];
      const vc = base.verts[c];
      this.tri(ids[a], ids[b], ids[c], [(va[0] + vb[0] + vc[0]) / 3, (va[1] + vb[1] + vc[1]) / 3, (va[2] + vb[2] + vc[2]) / 3]);
    }
  }

  /** Flat polygon on the ground (any simple polygon, triangulated by the caller). */
  flat(pts: V2[], tris: number[], y: number, uvOf: (p: V2) => [number, number]) {
    const base = this.count;
    for (const p of pts) {
      const t = uvOf(p);
      this.vert(p.x, y, p.z, 0, 1, 0, t[0], t[1]);
    }
    for (let i = 0; i < tris.length; i += 3) this.tri(base + tris[i], base + tris[i + 1], base + tris[i + 2], [0, 1, 0]);
  }

  toMesh(name: string, scene: BABYLON.Scene, material: BABYLON.Material | null) {
    if (!this.count) return null;
    const mesh = new BABYLON.Mesh(name, scene);
    const data = new BABYLON.VertexData();
    data.positions = new Float32Array(this.pos);
    data.normals = new Float32Array(this.nrm);
    data.uvs = new Float32Array(this.uv);
    data.uvs2 = new Float32Array(this.uv2);
    if (this.useUv3) data.uvs3 = new Float32Array(this.uv3);
    data.colors = new Float32Array(this.col);
    data.indices = this.count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx);
    data.applyToMesh(mesh, false);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = false;
    mesh.hasVertexAlpha = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    return mesh;
  }
}

const hashf = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const BLOB = (() => {
  let verts: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  let tris: [number, number, number][] = [
    [0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [0, 4, 3], [4, 1, 3], [1, 5, 3], [5, 0, 3],
  ];
  for (let level = 0; level < 1; level += 1) {
    const next: [number, number, number][] = [];
    const mid = new Map<string, number>();
    const midpoint = (a: number, b: number) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const hit = mid.get(key);
      if (hit !== undefined) return hit;
      const va = verts[a];
      const vb = verts[b];
      const m: Vec3 = [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2];
      const l = Math.hypot(m[0], m[1], m[2]);
      verts = [...verts, [m[0] / l, m[1] / l, m[2] / l]];
      mid.set(key, verts.length - 1);
      return verts.length - 1;
    };
    for (const [a, b, c] of tris) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    tris = next;
  }
  return { verts, tris };
})();

/** Collision boxes, grouped into sub meshes so the collider and camera picks stay cheap. */
export class CollisionGeo {
  pos: number[] = [];
  idx: number[] = [];
  groups: { start: number; count: number }[] = [];
  private open = -1;
  count = 0;

  begin() {
    this.open = this.idx.length;
  }

  end() {
    if (this.open < 0) return;
    const count = this.idx.length - this.open;
    if (count) this.groups.push({ start: this.open, count });
    this.open = -1;
  }

  box(cx: number, y0: number, cz: number, hw: number, h: number, hd: number, ax: V2) {
    const bx = { x: -ax.z, z: ax.x };
    const base = this.count;
    for (const y of [y0, y0 + h]) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        this.pos.push(cx + ax.x * hw * sx + bx.x * hd * sz, y, cz + ax.z * hw * sx + bx.z * hd * sz);
      }
    }
    this.count += 8;
    const f = (a: number, b: number, c: number, d: number) => {
      this.idx.push(base + a, base + b, base + c, base + a, base + c, base + d);
      this.idx.push(base + a, base + c, base + b, base + a, base + d, base + c);
    };
    f(0, 1, 2, 3);
    f(4, 5, 6, 7);
    f(0, 1, 5, 4);
    f(1, 2, 6, 5);
    f(2, 3, 7, 6);
    f(3, 0, 4, 7);
  }

  toMesh(name: string, scene: BABYLON.Scene) {
    if (!this.count) return null;
    const mesh = new BABYLON.Mesh(name, scene);
    const data = new BABYLON.VertexData();
    data.positions = new Float32Array(this.pos);
    data.indices = this.count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx);
    const normals: number[] = [];
    BABYLON.VertexData.ComputeNormals(this.pos, this.idx, normals);
    data.normals = normals;
    data.applyToMesh(mesh, false);
    mesh.subMeshes = [];
    const total = this.count;
    if (!this.groups.length) this.groups.push({ start: 0, count: this.idx.length });
    for (const g of this.groups) new BABYLON.SubMesh(0, 0, total, g.start, g.count, mesh);
    mesh.isVisible = false;
    mesh.isPickable = false;
    mesh.checkCollisions = true;
    mesh.freezeWorldMatrix();
    mesh.metadata = { cityCollider: true };
    return mesh;
  }
}
