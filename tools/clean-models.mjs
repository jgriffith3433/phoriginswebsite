// Model clean-up on import (Studio quality rule 3): `npm run models:clean` (every GLB in assets/models), or name files.
// `--check` only reports and exits 1 when a model still needs cleaning (used by `npm run check:scene`).
//
// Per primitive of every static (unskinned) mesh:
// - Coincident triangles (the same three corners within 1/10000 of the primitive's size) drawn twice are removed: a same-winding copy always,
//   a reversed copy when the material is double-sided (it draws both sides already). Generated models carry many;
//   drawn together they z-fight inside the model.
// - Doubled shells: on double-sided materials, a triangle lying in the same plane (within 2 mm) as another and
//   covered by it loses the covered part: the inner one of a back-to-back pair (the material draws both sides already),
//   and a same-facing layer under others level with or in front of it. Generators wrap thin parts in two skins,
//   and two-sided, they flicker against each other. A face only partly covered is cut: the covered part goes,
//   the rest is re-triangulated on corners interpolated from its own, so no hole or crack opens.
// - Inside-out primitives (negative signed volume: most faces wound inward) are reported, and with --fix-winding
//   reversed and their normals flipped.
// Writes the file back with the extensions it had (meshopt stays meshopt). Run it after adding or regenerating a model.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const args = process.argv.slice(2);
const check = args.includes('--check');
const fixWinding = args.includes('--fix-winding');
const DIR = path.resolve('assets/models');
const named = args.filter((a) => !a.startsWith('--'));
const files = named.length ? named.map((f) => path.resolve(f)) : fs.readdirSync(DIR).filter((f) => f.endsWith('.glb')).map((f) => path.join(DIR, f));


const SHELL_TOL = 0.002;
/** Area of triangle a clipped by triangle b, both as 2D points (Sutherland-Hodgman). */
const overlapArea = (a, b) => {
  const sgn = Math.sign((b[1][0] - b[0][0]) * (b[2][1] - b[0][1]) - (b[1][1] - b[0][1]) * (b[2][0] - b[0][0]));
  let out = a;
  for (let i = 0; i < 3 && out.length; i++) {
    const p = b[i]; const q = b[(i + 1) % 3];
    const side = (c) => sgn * ((q[0] - p[0]) * (c[1] - p[1]) - (q[1] - p[1]) * (c[0] - p[0]));
    const input = out; out = [];
    for (let j = 0; j < input.length; j++) {
      const c = input[j]; const d = input[(j + 1) % input.length];
      const sc = side(c); const sd = side(d);
      if (sc >= 0) out.push(c);
      if ((sc >= 0) !== (sd >= 0)) { const t = sc / (sc - sd); out.push([c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t]); }
    }
  }
  let area = 0;
  for (let i = 0; i < out.length; i++) { const u = out[i]; const v = out[(i + 1) % out.length]; area += u[0] * v[1] - u[1] * v[0]; }
  return Math.abs(area) / 2;
};

/** Keeps the part of a convex 2D polygon on one side of the line p -> q (side +1: left, -1: right). */
const clipHalf = (poly, p, q, side) => {
  const f = (c) => side * ((q[0] - p[0]) * (c[1] - p[1]) - (q[1] - p[1]) * (c[0] - p[0]));
  const out = [];
  for (let j = 0; j < poly.length; j++) {
    const c = poly[j]; const d = poly[(j + 1) % poly.length];
    const fc = f(c); const fd = f(d);
    if (fc >= 0) out.push(c);
    if ((fc >= 0) !== (fd >= 0)) { const t = fc / (fc - fd); out.push([c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t]); }
  }
  return out;
};
const polyArea = (poly) => { let a = 0; for (let i = 0; i < poly.length; i++) { const u = poly[i]; const v = poly[(i + 1) % poly.length]; a += u[0] * v[1] - u[1] * v[0]; } return Math.abs(a) / 2; };
/** A convex polygon minus a triangle, as convex pieces. */
const subtract = (poly, tri) => {
  const s = Math.sign((tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0]));
  const out = [];
  let rest = poly;
  for (let i = 0; i < 3 && rest.length >= 3; i++) {
    const p = tri[i]; const q = tri[(i + 1) % 3];
    const outside = clipHalf(rest, p, q, -s);
    if (outside.length >= 3 && polyArea(outside) > 1e-7) out.push(outside);
    rest = clipHalf(rest, p, q, s);
  }
  return out;
};
const PIECE_MIN = 1e-6; // 1 mm2: slivers below this are left out

/** The primitive's index list, copied first when another primitive shares it (an edit must not change both). */
const ownIndices = (prim) => {
  const ind = prim.getIndices();
  if (!ind || ind.listParents().filter((x) => x.propertyType === 'Primitive').length <= 1) return ind;
  const copy = ind.clone();
  prim.setIndices(copy);
  return copy;
};

/** Triangles to drop per primitive: doubled shells on double-sided materials (see the header). */
const findShells = (doc, skinned) => {
  const world = (node) => { let m = Matrix.FromArray(node.getMatrix()); for (let p = node.getParentNode(); p; p = p.getParentNode()) m = m.multiply(Matrix.FromArray(p.getMatrix())); return m; };
  const tris = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || skinned.has(mesh)) continue;
    const W = world(node);
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4 || !prim.getMaterial()?.getDoubleSided()) continue;
      const pos = prim.getAttribute('POSITION'); const ind = prim.getIndices();
      if (!pos || !ind) continue;
      const idx = ind.getArray();
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const ps = [0, 1, 2].map((k) => Vector3.TransformCoordinates(Vector3.FromArray(pos.getElement(idx[t + k], [])), W));
        const n = Vector3.Cross(ps[1].subtract(ps[0]), ps[2].subtract(ps[0]));
        const len = n.length();
        if (len < 1e-9) continue;
        n.scaleInPlace(1 / len);
        tris.push({ prim, t: t / 3, ps, n, d: Vector3.Dot(n, ps[0]), area: len / 2, c: ps[0].add(ps[1]).add(ps[2]).scale(1 / 3) });
      }
    }
  }
  if (tris.length < 2) return new Map();
  let lo = new Vector3(Infinity, Infinity, Infinity); let hi = lo.scale(-1);
  for (const t of tris) for (const p of t.ps) { lo = Vector3.Minimize(lo, p); hi = Vector3.Maximize(hi, p); }
  const center = lo.add(hi).scale(0.5);
  // Bucketed by normal (1/40 steps) and plane (SHELL_TOL steps). Partners are looked up in the neighbouring
  // buckets of both the normal and its opposite, so a face tilted a degree or two off its twin is still found.
  const buckets = new Map();
  const nkey = (n) => [Math.round(n.x * 40), Math.round(n.y * 40), Math.round(n.z * 40)];
  for (const t of tris) {
    t.nk = nkey(t.n);
    t.slot = Math.floor(t.d / SHELL_TOL);
    const k = `${t.nk}|${t.slot}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)).push(t);
  }
  const drop = new Set();
  const partners = (t) => {
    const out = new Set();
    for (const flip of [1, -1]) {
      const [x, y, z] = t.nk.map((c) => c * flip);
      const slot = Math.floor((t.d * flip) / SHELL_TOL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (let e = -1; e <= 1; e++) {
        for (const o of buckets.get(`${[x + a, y + b, z + c]}|${slot + e}`) ?? []) {
          if (o === t) continue;
          const dot = Vector3.Dot(t.n, o.n);
          if (Math.abs(dot) < 0.999) continue;
          if ((dot > 0 ? Math.abs(t.d - o.d) : Math.abs(t.d + o.d)) > SHELL_TOL) continue;
          // Every corner within SHELL_TOL of the other's plane: a big face tilted a degree is far apart at its ends.
          if (t.ps.some((p) => Math.abs(Vector3.Dot(o.n, p) - o.d) > SHELL_TOL) || o.ps.some((p) => Math.abs(Vector3.Dot(t.n, p) - t.d) > SHELL_TOL)) continue;
          out.add(o);
        }
      }
    }
    return [...out].map((o) => ({ o, same: Vector3.Dot(t.n, o.n) > 0 }));
  };
  const flat = (t, u, v) => t.ps.map((p) => [Vector3.Dot(p, u), Vector3.Dot(p, v)]);
  const frame = (n) => { const ax = Math.abs(n.x) > 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0); const u = Vector3.Cross(n, ax).normalize(); return [u, Vector3.Cross(n, u).normalize()]; };
  // Smallest first: a small layer under a big face goes, the big face stays.
  const split = new Map();
  for (const t of [...tris].sort((a, b) => a.area - b.area)) {
    if (drop.has(t)) continue;
    const [u, v] = frame(t.n);
    const mine = flat(t, u, v);
    // Faces that would draw over this one: same-facing layers level with or in front of it (a label raised
    // over a face is not one), and, for the inner face of a back-to-back pair, the outer face.
    const covers = [];
    const tOut = Vector3.Dot(t.n, t.c.subtract(center));
    for (const { o, same } of partners(t)) {
      if (drop.has(o)) continue;
      if (same ? o.d < t.d - 2e-5 : tOut >= Vector3.Dot(o.n, o.c.subtract(center))) continue;
      const q = flat(o, u, v);
      if (overlapArea(mine, q) >= PIECE_MIN) covers.push(q);
    }
    if (!covers.length) continue;
    // What is left of it once the covered parts are cut away: nothing (dropped), or convex pieces that are
    // re-triangulated on corners interpolated from its own, so the surface stays whole with no crack or hole.
    let pieces = [mine];
    for (const q of covers) pieces = pieces.flatMap((poly) => subtract(poly, q));
    pieces = pieces.filter((poly) => polyArea(poly) >= PIECE_MIN);
    const left = pieces.reduce((sum, poly) => sum + polyArea(poly), 0);
    if (left > t.area * 0.995) continue;
    if (!pieces.length) { drop.add(t); continue; }
    const [a, b, c] = mine;
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const bary = (p) => { const w1 = ((p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0])) / det; const w2 = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / det; return [1 - w1 - w2, w1, w2]; };
    split.set(t, pieces.map((poly) => poly.map(bary)));
    drop.add(t);
  }
  const byPrim = new Map();
  const entry = (prim) => byPrim.get(prim) ?? byPrim.set(prim, { gone: new Set(), split: new Map() }).get(prim);
  for (const t of drop) entry(t.prim).gone.add(t.t);
  for (const [t, pieces] of split) entry(t.prim).split.set(t.t, pieces);
  return byPrim;
};

let dirty = 0;
for (const file of files) {
  const name = path.basename(file);
  let doc;
  try { doc = await io.read(file); } catch (error) { console.log(`${name}: can't be read, skipped`); continue; }
  const skinned = new Set(doc.getRoot().listNodes().filter((n) => n.getSkin()).map((n) => n.getMesh()));
  let removed = 0;
  const inverted = [];
  // Shells first, on the model as it is; the duplicate pass below then sees what is left.
  let shells = 0;
  let cut = 0;
  for (const [prim, { gone, split }] of findShells(doc, skinned)) {
    const ind = ownIndices(prim);
    const idx = Array.from(ind.getArray());
    // A cut triangle's pieces get corners of their own, interpolated from its three. Not on primitives with
    // morph targets, which would need the same corners; those keep the triangle whole.
    const canCut = !prim.listTargets().length;
    const attrs = prim.listSemantics().map((sem) => [sem, prim.getAttribute(sem)]);
    const added = new Map(attrs.map(([sem]) => [sem, []]));
    let count = prim.getAttribute('POSITION').getCount();
    const keep = [];
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const pieces = split.get(t / 3);
      if (pieces && !canCut) { keep.push(idx[t], idx[t + 1], idx[t + 2]); continue; }
      if (gone.has(t / 3) && !pieces) continue;
      if (!pieces) { keep.push(idx[t], idx[t + 1], idx[t + 2]); continue; }
      const corners = attrs.map(([, acc]) => [0, 1, 2].map((k) => acc.getElement(idx[t + k], [])));
      // Pieces of one triangle share their corners, and its own three corners stay the original vertices.
      const made = new Map();
      const vertex = (w) => {
        const k = w.findIndex((x) => x > 1 - 1e-6);
        if (k >= 0) return idx[t + k];
        const key = w.map((x) => x.toFixed(6)).join();
        if (made.has(key)) return made.get(key);
        attrs.forEach(([sem], i) => {
          const [e0, e1, e2] = corners[i];
          const el = e0.map((_, j) => w[0] * e0[j] + w[1] * e1[j] + w[2] * e2[j]);
          if (sem === 'NORMAL' || sem === 'TANGENT') { const l = Math.hypot(el[0], el[1], el[2]) || 1; for (let j = 0; j < 3; j++) el[j] /= l; if (sem === 'TANGENT') el[3] = e0[3]; }
          if (sem.startsWith('JOINTS')) el.splice(0, el.length, ...e0);
          added.get(sem).push(el);
        });
        made.set(key, count);
        return count++;
      };
      for (const poly of pieces) {
        const ids = poly.map(vertex);
        for (let k = 1; k + 1 < ids.length; k++) keep.push(ids[0], ids[k], ids[k + 1]);
      }
      cut++;
    }
    for (const [sem, acc] of attrs) {
      const extra = added.get(sem);
      if (!extra.length) continue;
      const n = acc.getCount();
      const size = acc.getElementSize();
      const grown = new (acc.getArray().constructor)((n + extra.length) * size);
      grown.set(acc.getArray());
      acc.setArray(grown);
      extra.forEach((el, i) => acc.setElement(n + i, el));
    }
    shells += [...gone].filter((t) => !split.has(t)).length;
    const big = count > 0xffff || keep.some((i) => i > 0xffff);
    ind.setArray(big && !(ind.getArray() instanceof Uint32Array) ? Uint32Array.from(keep) : ind.getArray().constructor.from(keep));
  }
  removed += shells + cut;
  for (const mesh of doc.getRoot().listMeshes()) {
    if (skinned.has(mesh)) continue;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const pos = prim.getAttribute('POSITION');
      const ind = ownIndices(prim);
      if (!pos || !ind) continue;
      const doubleSided = !!prim.getMaterial()?.getDoubleSided();
      // Tolerance relative to the primitive's size: models come in metres, centimetres or worse.
      const lo = pos.getMin([]); const hi = pos.getMax([]);
      const q = 1 / (Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 1e-4 || 1e-6);
      const key = (v) => `${Math.round(v[0] * q)},${Math.round(v[1] * q)},${Math.round(v[2] * q)}`;
      const idx = Array.from(ind.getArray());
      const keep = [];
      const seen = new Map();
      let volume = 0;
      const p = (i) => pos.getElement(i, []);
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const tri = [idx[t], idx[t + 1], idx[t + 2]];
        const k = tri.map((i) => key(p(i)));
        if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) { removed++; continue; } // degenerate
        const r = k.indexOf([...k].sort()[0]);
        const fwd = `${k[r]}|${k[(r + 1) % 3]}|${k[(r + 2) % 3]}`;
        const rev = `${k[r]}|${k[(r + 2) % 3]}|${k[(r + 1) % 3]}`;
        if (seen.has(fwd) || (doubleSided && seen.has(rev))) { removed++; continue; }
        seen.set(fwd, true);
        keep.push(...tri);
        const [a, b, c] = tri.map(p);
        volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
      }
      if (keep.length !== idx.length) {
        const out = ind.getArray().constructor.from(keep);
        ind.setArray(out);
      }
      // glTF is counter-clockwise front faces: a closed outward model has positive signed volume.
      const [mn, mx] = [pos.getMin([]), pos.getMax([])];
      const box = (mx[0] - mn[0]) * (mx[1] - mn[1]) * (mx[2] - mn[2]);
      if (volume < -0.05 * box) {
        inverted.push(mesh.getName());
        if (fixWinding) {
          const arr = ind.getArray();
          for (let t = 0; t + 2 < arr.length; t += 3) [arr[t + 1], arr[t + 2]] = [arr[t + 2], arr[t + 1]];
          ind.setArray(arr);
          const nrm = prim.getAttribute('NORMAL');
          if (nrm) for (let i = 0; i < nrm.getCount(); i++) nrm.setElement(i, nrm.getElement(i, []).map((v) => -v));
        }
      }
    }
  }
  const needs = removed > 0 || (inverted.length && !fixWinding);
  if (!needs && !inverted.length) continue;
  console.log(`${name}: ${removed} duplicate/degenerate/shell triangles (${shells} shell${cut ? `, ${cut} cut` : ''})${inverted.length ? `; inside out: ${inverted.join(', ')}${fixWinding ? ' (fixed)' : ''}` : ''}`);
  if (check) { if (needs) dirty++; continue; }
  if (removed || (inverted.length && fixWinding)) await io.write(file, doc);
}
if (check) {
  console.log(dirty ? `models: ${dirty} need \`npm run models:clean\`` : 'models: clean');
  process.exit(dirty ? 1 : 0);
}
