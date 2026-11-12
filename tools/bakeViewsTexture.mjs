// Re-bakes a character's albedo from its four reference views (front, back, left, right), on the CPU.
//
//   node tools/bakeViewsTexture.mjs <static.glb> <front.png> <back.png> <left.png> <right.png> <out.glb> [--size 2048]
//
// Why: mesh.views3d's paint step gave the suited Pierce a broken albedo (posterised, the suit pure black, the face an
// orange blotch) and a metal/rough map that is fully metallic, while its geometry and the four generated views it was
// built from (mesh.*-view, 1024 px, black background) are good. This projects those views back onto the mesh:
//
// 1. Each view is orthographic. Its scale and offset come from the silhouette's bounding box against the mesh's
//    projected bounding box; front and back follow glTF (+Z front, character's left +X), and each side view is tried
//    both ways round and keeps the one whose silhouette overlaps the mesh's best.
// 2. A depth buffer per view hides what that camera cannot see (an arm in front of the torso in a side view).
// 3. Every texel of every triangle in UV space takes the views that see it, weighted by how squarely they face the
//    surface (cos^4), so seams between views are soft. Texels no view sees are filled from their neighbours, and the
//    islands are padded so mipmaps do not bleed black.
//
// The material comes out dielectric (metallic 0, roughness 0.85) with no metal/rough map.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import sharp from 'sharp';

const args = process.argv.slice(2);
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--size');
const [meshPath, frontPath, backPath, leftPath, rightPath, outPath] = files;
if (!outPath) {
  console.error('usage: node tools/bakeViewsTexture.mjs <static.glb> <front> <back> <left> <right> <out.glb> [--size 2048]');
  process.exit(1);
}
const sArg = args.indexOf('--size');
const SIZE = sArg >= 0 ? Number(args[sArg + 1]) : 2048;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(meshPath);
const root = doc.getRoot();
const prim = root.listMeshes()[0].listPrimitives()[0];
const posA = prim.getAttribute('POSITION');
const uvA = prim.getAttribute('TEXCOORD_0');
const idx = prim.getIndices().getArray();
const N = posA.getCount();
const pos = [];
const uv = [];
for (let i = 0; i < N; i++) {
  pos.push(posA.getElement(i, [0, 0, 0]));
  uv.push(uvA.getElement(i, [0, 0]));
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const faceN = [];
for (let t = 0; t < idx.length; t += 3) {
  const n = cross(sub(pos[idx[t + 1]], pos[idx[t]]), sub(pos[idx[t + 2]], pos[idx[t]]));
  const l = Math.hypot(...n) || 1;
  faceN.push(n.map((x) => x / l));
}

// ---------------------------------------------------------------- views
/** Horizontal image axis as a function of the 3D point, the direction toward the camera, and a depth (bigger = nearer). */
const VIEWS = {
  front: { h: (p) => p[0], toCam: [0, 0, 1], depth: (p) => p[2] },
  back: { h: (p) => -p[0], toCam: [0, 0, -1], depth: (p) => -p[2] },
  left: { h: (p) => -p[2], toCam: [1, 0, 0], depth: (p) => p[0] },
  right: { h: (p) => p[2], toCam: [-1, 0, 0], depth: (p) => -p[0] },
};
const loadView = async (file) => {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const mask = new Uint8Array(W * H);
  let x0 = W;
  let x1 = 0;
  let y0 = H;
  let y1 = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      if (data[o] + data[o + 1] + data[o + 2] > 24) {
        mask[y * W + x] = 1;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  return { data, W, H, mask, box: [x0, x1, y0, y1] };
};

/** Rasterises the mesh into a view: depth per pixel. */
const depthMap = (view, img, proj) => {
  const zb = new Float32Array(img.W * img.H).fill(-Infinity);
  for (let t = 0; t < idx.length; t += 3) {
    const P = [0, 1, 2].map((k) => proj(pos[idx[t + k]]));
    const minX = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])));
    const maxX = Math.min(img.W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])));
    const maxY = Math.min(img.H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
    const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[1][1] - P[0][1]) * (P[2][0] - P[0][0]);
    if (Math.abs(area) < 1e-12) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[1][1] - py) * (P[2][0] - px)) / area;
        const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[2][1] - py) * (P[0][0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2];
        const k = y * img.W + x;
        if (z > zb[k]) zb[k] = z;
      }
    }
  }
  return zb;
};

const fitView = (name, img, mirror) => {
  const v = VIEWS[name];
  const hf = mirror ? (p) => -v.h(p) : v.h;
  let h0 = Infinity;
  let h1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pos) {
    const h = hf(p);
    h0 = Math.min(h0, h);
    h1 = Math.max(h1, h);
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  const [bx0, bx1, by0, by1] = img.box;
  const s = (by1 - by0) / (y1 - y0);
  const cx = (bx0 + bx1 + 1) / 2 - ((h0 + h1) / 2) * s;
  const proj = (p) => [cx + hf(p) * s, by1 + 1 - (p[1] - y0) * s, v.depth(p) * s];
  return { proj, s };
};

const OCCLUDE_PX = 10;
/** Max filter (separable square window). */
const dilateMax = (zb, W, H, r) => {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = -Infinity;
    for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < W) m = Math.max(m, zb[y * W + xx]); }
    tmp[y * W + x] = m;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = -Infinity;
    for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < H) m = Math.max(m, tmp[yy * W + x]); }
    out[y * W + x] = m;
  }
  return out;
};
const views = [];
for (const [name, file] of [['front', frontPath], ['back', backPath], ['left', leftPath], ['right', rightPath]]) {
  const img = await loadView(file);
  let best = null;
  for (const mirror of name === 'front' || name === 'back' ? [false] : [false, true]) {
    const { proj, s } = fitView(name, img, mirror);
    const zb = depthMap(name, img, proj);
    let inter = 0;
    let uni = 0;
    for (let k = 0; k < zb.length; k++) {
      const a = zb[k] > -Infinity;
      const b = img.mask[k] === 1;
      if (a && b) inter++;
      if (a || b) uni++;
    }
    const iou = inter / (uni || 1);
    if (!best || iou > best.iou) best = { name, img, proj, zb, iou, mirror, eps: 0.012 * s };
  }
  // The generated views do not line up with the mesh to the pixel, so near an occluder's edge (a hand in front of the
  // jacket in a side view) the view may show the occluder where the mesh shows the surface behind. The depth test uses
  // the nearest depth within OCCLUDE_PX instead, and leaves those texels to a view that sees them squarely.
  best.zb = dilateMax(best.zb, best.img.W, best.img.H, OCCLUDE_PX);
  console.log(`${name}: silhouette overlap ${(best.iou * 100).toFixed(1)}%${best.mirror ? ' (mirrored)' : ''}`);
  views.push(best);
}

// ---------------------------------------------------------------- bake in UV space
const acc = new Float32Array(SIZE * SIZE * 4);
const covered = new Uint8Array(SIZE * SIZE);
const sampleView = (v, p) => {
  const q = v.proj(p);
  const x = Math.floor(q[0]);
  const y = Math.floor(q[1]);
  if (x < 0 || y < 0 || x >= v.img.W || y >= v.img.H) return null;
  // Visible if no surface sits nearer the camera at this pixel (within a small tolerance).
  if (q[2] < v.zb[y * v.img.W + x] - v.eps) return null;
  if (!v.img.mask[y * v.img.W + x]) return null;
  // Bilinear colour.
  const fx = q[0] - 0.5;
  const fy = q[1] - 0.5;
  const ix = Math.max(0, Math.min(v.img.W - 2, Math.floor(fx)));
  const iy = Math.max(0, Math.min(v.img.H - 2, Math.floor(fy)));
  const ax = Math.max(0, Math.min(1, fx - ix));
  const ay = Math.max(0, Math.min(1, fy - iy));
  const c = [0, 0, 0];
  for (const [dx, dy, w] of [[0, 0, (1 - ax) * (1 - ay)], [1, 0, ax * (1 - ay)], [0, 1, (1 - ax) * ay], [1, 1, ax * ay]]) {
    const o = ((iy + dy) * v.img.W + ix + dx) * 3;
    c[0] += v.img.data[o] * w;
    c[1] += v.img.data[o + 1] * w;
    c[2] += v.img.data[o + 2] * w;
  }
  return c;
};
for (let t = 0, f = 0; t < idx.length; t += 3, f++) {
  const n = faceN[f];
  const ws = views.map((v) => {
    const c = n[0] * VIEWS[v.name].toCam[0] + n[1] * VIEWS[v.name].toCam[1] + n[2] * VIEWS[v.name].toCam[2];
    return c > 0.05 ? c ** 4 : 0;
  });
  if (!ws.some((w) => w > 0)) continue;
  const U = [0, 1, 2].map((k) => [uv[idx[t + k]][0] * SIZE, uv[idx[t + k]][1] * SIZE]);
  const Pp = [0, 1, 2].map((k) => pos[idx[t + k]]);
  const minX = Math.max(0, Math.floor(Math.min(U[0][0], U[1][0], U[2][0])));
  const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(U[0][0], U[1][0], U[2][0])));
  const minY = Math.max(0, Math.floor(Math.min(U[0][1], U[1][1], U[2][1])));
  const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(U[0][1], U[1][1], U[2][1])));
  const area = (U[1][0] - U[0][0]) * (U[2][1] - U[0][1]) - (U[1][1] - U[0][1]) * (U[2][0] - U[0][0]);
  if (Math.abs(area) < 1e-12) continue;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let w0 = ((U[1][0] - px) * (U[2][1] - py) - (U[1][1] - py) * (U[2][0] - px)) / area;
      let w1 = ((U[2][0] - px) * (U[0][1] - py) - (U[2][1] - py) * (U[0][0] - px)) / area;
      let w2 = 1 - w0 - w1;
      // Half a texel of slack so island edges are filled.
      const slack = -0.5 / Math.sqrt(Math.abs(area));
      if (w0 < slack || w1 < slack || w2 < slack) continue;
      w0 = Math.max(0, w0);
      w1 = Math.max(0, w1);
      w2 = Math.max(0, w2);
      const sw = w0 + w1 + w2;
      const p = [0, 1, 2].map((k) => (w0 * Pp[0][k] + w1 * Pp[1][k] + w2 * Pp[2][k]) / sw);
      const k = y * SIZE + x;
      for (let vi = 0; vi < views.length; vi++) {
        if (!ws[vi]) continue;
        const c = sampleView(views[vi], p);
        if (!c) continue;
        acc[k * 4] += c[0] * ws[vi];
        acc[k * 4 + 1] += c[1] * ws[vi];
        acc[k * 4 + 2] += c[2] * ws[vi];
        acc[k * 4 + 3] += ws[vi];
        covered[k] = 1;
      }
    }
  }
}

// Fill: unseen texels inside and around the islands take their neighbours' average, a ring at a time.
const out = new Float32Array(SIZE * SIZE * 3);
let filled = 0;
for (let k = 0; k < SIZE * SIZE; k++) {
  if (!covered[k]) continue;
  out[k * 3] = acc[k * 4] / acc[k * 4 + 3];
  out[k * 3 + 1] = acc[k * 4 + 1] / acc[k * 4 + 3];
  out[k * 3 + 2] = acc[k * 4 + 2] / acc[k * 4 + 3];
  filled++;
}
console.log(`baked ${((100 * filled) / (SIZE * SIZE)).toFixed(1)}% of the atlas from the views`);
for (let ring = 0; ring < 24; ring++) {
  const next = covered.slice();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const k = y * SIZE + x;
      if (covered[k]) continue;
      let n = 0;
      const c = [0, 0, 0];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= SIZE || yy >= SIZE) continue;
        const kk = yy * SIZE + xx;
        if (!covered[kk]) continue;
        c[0] += out[kk * 3];
        c[1] += out[kk * 3 + 1];
        c[2] += out[kk * 3 + 2];
        n++;
      }
      if (!n) continue;
      out[k * 3] = c[0] / n;
      out[k * 3 + 1] = c[1] / n;
      out[k * 3 + 2] = c[2] / n;
      next[k] = 1;
    }
  }
  covered.set(next);
}
const px = Buffer.alloc(SIZE * SIZE * 3);
for (let i = 0; i < px.length; i++) px[i] = Math.max(0, Math.min(255, Math.round(out[i])));
const png = await sharp(px, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toBuffer();

// ---------------------------------------------------------------- material
const mat = prim.getMaterial();
const base = mat.getBaseColorTexture();
base.setImage(new Uint8Array(png)).setMimeType('image/png');
mat.setBaseColorFactor([1, 1, 1, 1]);
// Cloth and skin are dielectric. The game draws characters matte and ignores this map (modelLoader.ts
// applyMatteCharacterMaterials), so the fully metallic one goes. views3d also wires the same image in as occlusion,
// whose red channel (about 0.45 everywhere) would only darken the whole body: that goes too.
mat.setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(0.85);
mat.setOcclusionTexture(null);
await doc.transform(prune());
await io.write(outPath, doc);
console.log('wrote', outPath);
