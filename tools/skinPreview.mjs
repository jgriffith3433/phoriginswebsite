// CPU-skins a character GLB at a clip time and renders front and side views to a PNG (flat shaded triangles),
// and prints the feet: the lowest skinned vertex and the floor gap. For checking a rig without a browser.
//
//   node tools/skinPreview.mjs <file.glb> <out.png> [clip] [seconds] [clip seconds ...]
//
// Several clip/seconds pairs make one row of panels each. sharp is needed (npm i --no-save sharp).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const [file, out, ...rest] = process.argv.slice(2);
const poses = [];
for (let i = 0; i < rest.length; i += 2) poses.push([rest[i], Number(rest[i + 1] ?? 0)]);
if (!poses.length) poses.push([null, 0]);

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const root = doc.getRoot();

const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const trs = (t, q, s) => {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
};
const mmul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const slerp = (a, b, t) => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = d < 0 ? b.map((x) => -x) : b;
  d = Math.abs(d);
  if (d > 0.9995) {
    const r = a.map((x, i) => x + (bb[i] - x) * t);
    const l = Math.hypot(...r);
    return r.map((x) => x / l);
  }
  const th = Math.acos(d);
  const s = Math.sin(th);
  return a.map((x, i) => (x * Math.sin((1 - t) * th) + bb[i] * Math.sin(t * th)) / s);
};
const sample = (sampler, t) => {
  const input = sampler.getInput();
  const output = sampler.getOutput();
  const n = input.getCount();
  const size = output.getElementSize();
  const cubic = sampler.getInterpolation() === 'CUBICSPLINE';
  const at = (i) => output.getElement(cubic ? i * 3 + 1 : i, new Array(size));
  if (t <= input.getScalar(0)) return at(0);
  if (t >= input.getScalar(n - 1)) return at(n - 1);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (input.getScalar(m) <= t) lo = m;
    else hi = m;
  }
  const f = (t - input.getScalar(lo)) / (input.getScalar(hi) - input.getScalar(lo) || 1);
  const a = at(lo);
  const b = at(hi);
  return size === 4 ? slerp(a, b, f) : a.map((x, i) => x + (b[i] - x) * f);
};

const W = 260;
const H = 300;
const panels = [];
for (const [clip, t] of poses) {
  const anim = clip ? root.listAnimations().find((a) => a.getName() === clip) : null;
  if (clip && !anim) throw new Error(`no clip ${clip}; has ${root.listAnimations().map((a) => a.getName()).join(', ')}`);
  const over = new Map();
  if (anim) for (const ch of anim.listChannels()) {
    const n = ch.getTargetNode();
    const m = over.get(n) ?? {};
    m[ch.getTargetPath()] = sample(ch.getSampler(), t);
    over.set(n, m);
  }
  const memo = new Map();
  const world = (n) => {
    if (memo.has(n)) return memo.get(n);
    const o = over.get(n) ?? {};
    const l = trs(o.translation ?? n.getTranslation(), o.rotation ?? n.getRotation(), o.scale ?? n.getScale());
    const p = n.getParentNode();
    const w = p ? mmul(world(p), l) : l;
    memo.set(n, w);
    return w;
  };
  const tris = [];
  let minY = Infinity;
  let stretched = 0;
  let folded = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const skin = node.getSkin();
    const joints = skin?.listJoints() ?? [];
    const ibm = skin?.getInverseBindMatrices();
    const jm = joints.map((j, i) => mmul(world(j), ibm ? ibm.getElement(i, new Array(16)) : trs([0, 0, 0], [0, 0, 0, 1], [1, 1, 1])));
    const nm = world(node);
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const J = prim.getAttribute('JOINTS_0');
      const Wt = prim.getAttribute('WEIGHTS_0');
      const v = [];
      const r0 = [];
      const dom = [];
      const e = [0, 0, 0];
      const je = [0, 0, 0, 0];
      const we = [0, 0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, e);
        let x = 0;
        let y = 0;
        let z = 0;
        r0.push([e[0], e[1], e[2]]);
        if (skin && J) {
          J.getElement(i, je);
          Wt.getElement(i, we);
          let best = 0;
          for (let k = 1; k < 4; k++) if (we[k] > we[best]) best = k;
          dom.push(jm[je[best]]);
          for (let k = 0; k < 4; k++) {
            const w = we[k];
            if (!w) continue;
            const m = jm[je[k]];
            x += w * (m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12]);
            y += w * (m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13]);
            z += w * (m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14]);
          }
        } else {
          const m = nm;
          x = m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12];
          y = m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13];
          z = m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14];
        }
        v.push([x, y, z]);
        if (y < minY) minY = y;
      }
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : v.length;
      for (let i = 0; i + 2 < n; i += 3) {
        const a = idx ? idx.getScalar(i) : i;
        const b = idx ? idx.getScalar(i + 1) : i + 1;
        const c = idx ? idx.getScalar(i + 2) : i + 2;
        tris.push([v[a], v[b], v[c]]);
        if (dom.length) {
          // Stretch: longest skinned edge over its rest length. Fold: the skinned face turned against its rest normal
          // carried by the dominant joint (a candy-wrapper elbow or a knee pushed through the trousers).
          const el = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
          const r = [el(r0[a], r0[b]), el(r0[b], r0[c]), el(r0[c], r0[a])];
          const k = [el(v[a], v[b]), el(v[b], v[c]), el(v[c], v[a])];
          const ratio = Math.max(...k.map((x, i) => (r[i] > 1e-6 ? x / (r[i] * (dom[a][0] ** 2 + dom[a][1] ** 2 + dom[a][2] ** 2) ** 0.5) : 1)));
          if (ratio > 2.5) stretched++;
          const nrm = (p, q, w) => {
            const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
            const x = [w[0] - p[0], w[1] - p[1], w[2] - p[2]];
            const c2 = [u[1] * x[2] - u[2] * x[1], u[2] * x[0] - u[0] * x[2], u[0] * x[1] - u[1] * x[0]];
            const l = Math.hypot(...c2);
            return l > 1e-12 ? c2.map((y) => y / l) : null;
          };
          const n0 = nrm(r0[a], r0[b], r0[c]);
          const n1 = nrm(v[a], v[b], v[c]);
          if (n0 && n1) {
            const m = dom[a];
            const rn = [m[0] * n0[0] + m[4] * n0[1] + m[8] * n0[2], m[1] * n0[0] + m[5] * n0[1] + m[9] * n0[2], m[2] * n0[0] + m[6] * n0[1] + m[10] * n0[2]];
            const l = Math.hypot(...rn) || 1;
            if ((rn[0] * n1[0] + rn[1] * n1[1] + rn[2] * n1[2]) / l < -0.2) folded++;
          }
        }
      }
    }
  }
  console.log(`${clip ?? 'rest'} @ ${t}s: lowest vertex y=${minY.toFixed(3)} m, ${tris.length} triangles, folded ${folded} (${((100 * folded) / tris.length).toFixed(2)}%), stretched ${stretched}`);
  // Two views: front (looking down -Z at the +Z-facing character) and side (from +X).
  for (const view of ['front', 'side']) {
    const img = new Uint8Array(W * H * 3).fill(40);
    const zb = new Float32Array(W * H).fill(-Infinity);
    const S = H / 2.1;
    const proj = (p) => (view === 'front' ? [W / 2 + p[0] * S, H - 10 - p[1] * S, p[2]] : [W / 2 - p[2] * S, H - 10 - p[1] * S, p[0]]);
    for (const [a, b, c] of tris) {
      const n = (() => {
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const x = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        const l = Math.hypot(...x) || 1;
        return x.map((q) => q / l);
      })();
      const lightDir = view === 'front' ? [0.3, 0.4, 0.86] : [0.86, 0.4, 0.3];
      const facing = n[0] * lightDir[0] + n[1] * lightDir[1] + n[2] * lightDir[2];
      // Back faces (pointing away from the camera) are drawn red: an inside-out model shows mostly red.
      const toCam = view === 'front' ? n[2] : n[0];
      const shade = Math.max(0.15, Math.abs(facing));
      const col = toCam >= 0 ? [200 * shade + 30, 200 * shade + 30, 210 * shade + 30] : [220 * shade + 30, 40, 40];
      const A = proj(a);
      const B = proj(b);
      const C = proj(c);
      const minX = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
      const minYp = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
      const maxYp = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
      const area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (Math.abs(area) < 1e-9) continue;
      for (let py = minYp; py <= maxYp; py++) {
        for (let px = minX; px <= maxX; px++) {
          const w0 = ((B[0] - px) * (C[1] - py) - (B[1] - py) * (C[0] - px)) / area;
          const w1 = ((C[0] - px) * (A[1] - py) - (C[1] - py) * (A[0] - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * A[2] + w1 * B[2] + w2 * C[2];
          const k = py * W + px;
          if (z <= zb[k]) continue;
          zb[k] = z;
          img.set(col.map((x) => Math.min(255, x)), k * 3);
        }
      }
    }
    // Floor line at y = 0.
    const fy = Math.round(H - 10);
    for (let px = 0; px < W; px++) img.set([60, 160, 60], (fy * W + px) * 3);
    panels.push(img);
  }
}
const cols = 2 * Math.min(poses.length, 4);
const rows = Math.ceil(panels.length / cols);
const big = Buffer.alloc(cols * W * rows * H * 3, 20);
panels.forEach((p, i) => {
  const ox = (i % cols) * W;
  const oy = Math.floor(i / cols) * H;
  for (let y = 0; y < H; y++) Buffer.from(p.buffer, y * W * 3, W * 3).copy(big, ((oy + y) * cols * W + ox) * 3);
});
await sharp(big, { raw: { width: cols * W, height: rows * H, channels: 3 } }).png().toFile(out);
console.log('wrote', out);
