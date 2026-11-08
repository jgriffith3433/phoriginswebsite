// Model clean-up on import (Studio quality rule 3): `npm run models:clean` (every GLB in assets/models), or name files.
// `--check` only reports and exits 1 when a model still needs cleaning (used by `npm run check:scene`).
//
// Per primitive of every static (unskinned) mesh:
// - Coincident triangles (the same three corners within 1/10000 of the primitive's size) drawn twice are removed: a same-winding copy always,
//   a reversed copy when the material is double-sided (it draws both sides already). Generated models carry many;
//   drawn together they z-fight inside the model.
// - Inside-out primitives (negative signed volume: most faces wound inward) are reported, and with --fix-winding
//   reversed and their normals flipped.
// Writes the file back with the extensions it had (meshopt stays meshopt). Run it after adding or regenerating a model.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const args = process.argv.slice(2);
const check = args.includes('--check');
const fixWinding = args.includes('--fix-winding');
const DIR = path.resolve('assets/models');
const named = args.filter((a) => !a.startsWith('--'));
const files = named.length ? named.map((f) => path.resolve(f)) : fs.readdirSync(DIR).filter((f) => f.endsWith('.glb')).map((f) => path.join(DIR, f));

let dirty = 0;
for (const file of files) {
  const name = path.basename(file);
  let doc;
  try { doc = await io.read(file); } catch (error) { console.log(`${name}: can't be read, skipped`); continue; }
  const skinned = new Set(doc.getRoot().listNodes().filter((n) => n.getSkin()).map((n) => n.getMesh()));
  let removed = 0;
  const inverted = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    if (skinned.has(mesh)) continue;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const pos = prim.getAttribute('POSITION');
      const ind = prim.getIndices();
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
  console.log(`${name}: ${removed} duplicate/degenerate triangles${inverted.length ? `; inside out: ${inverted.join(', ')}${fixWinding ? ' (fixed)' : ''}` : ''}`);
  if (check) { if (needs) dirty++; continue; }
  if (removed || (inverted.length && fixWinding)) await io.write(file, doc);
}
if (check) {
  console.log(dirty ? `models: ${dirty} need \`npm run models:clean\`` : 'models: clean');
  process.exit(dirty ? 1 : 0);
}
