// Rebuilds the board table's base: two solid pedestals under the top instead of four 12 cm legs,
// so the slab reads as a table (not a tilted wedge) from the boardroom. Top bounds are unchanged.
import { NodeIO } from '@gltf-transform/core';

const path = process.argv[2] ?? 'assets/models/board-table.glb';
const io = new NodeIO();
const doc = await io.read(path);
const mesh = doc.getRoot().listMeshes()[0];
const prim = mesh.listPrimitives()[1]; // metal base
const buf = doc.getRoot().listBuffers()[0];

function boxes(list) {
  const pos = [], nor = [], uv = [], idx = [];
  for (const [cx, cy, cz, sx, sy, sz] of list) {
    const faces = [
      [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
      [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
      [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
      [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
      [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
      [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
    ];
    for (const [n, vs] of faces) {
      const base = pos.length / 3;
      vs.forEach(([x, y, z], k) => {
        pos.push(cx + (x * sx) / 2, cy + (y * sy) / 2, cz + (z * sz) / 2);
        nor.push(...n);
        uv.push(k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0);
      });
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { pos, nor, uv, idx };
}

// glTF space is Y up. Pedestals sit under the top (underside y 0.70), floor at 0, 0.1 m clear of the apron.
const b = boxes([
  [-3.4, 0.34, 0, 0.6, 0.62, 1.7],
  [3.4, 0.34, 0, 0.6, 0.62, 1.7],
  [-3.4, 0.03, 0, 0.9, 0.06, 2.0], // plinths
  [3.4, 0.03, 0, 0.9, 0.06, 2.0],
]);
const set = (attr, data, T) => doc.getRoot().listAccessors().length && prim.getAttribute(attr).setArray(new T(data));
set('POSITION', b.pos, Float32Array);
set('NORMAL', b.nor, Float32Array);
set('TEXCOORD_0', b.uv, Float32Array);
prim.getIndices().setArray(new Uint16Array(b.idx));
void buf;
await io.write(path, doc);
console.log('wrote', path);
