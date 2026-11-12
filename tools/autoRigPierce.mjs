// Rigs a static A-pose character GLB (a Hawkes Gen mesh.views3d result) with a Mixamo skeleton, on the CPU.
//
//   node tools/autoRigPierce.mjs <static.glb> <reference.glb> <out.glb> [--height 1.78]
//
// Why: mesh.rig (Make-It-Animatable) returned a shredded bind mesh twice for the suited Pierce (its own preview shows
// shards round a floating head), so this places the joints itself and paints the weights.
//
// 1. The mesh is scaled to --height, feet on y 0, centred on x and on the hips in z. It must face +Z, arms out in an
//    A-pose (the character's left is +X).
// 2. Joints: the spine, neck, head and legs take the reference rig's heights (ch33-hero, T-pose) scaled to the new
//    height, centred in the mesh's own cross-section there. Each arm is fitted from the mesh (principal axis of the
//    arm's vertices, fingertip = farthest point), then shoulder, elbow and wrist are placed by the reference's bone
//    length ratios and centred in the sleeve. Fingers copy the reference hand, turned onto the new hand direction.
// 3. Weights: chains (spine by height; arm and leg polylines by arc length) blend linearly across each joint, the arm
//    and leg zones blend into the torso at the shoulder and hip, the legs split across the centre seam, and the result
//    is smoothed over the welded mesh (UV seams share a weight, so they never open). Hands stay on the hand bone.
//
// The output has joint nodes with identity rotations (world-aligned rest), `mixamorig:` names, no clips. Run
// tools/retargetPierce.mjs on it next: that turns the frames onto the reference's and adds the game's 16 clips.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const [inPath, refPath, outPath] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--height'));
if (!inPath || !refPath || !outPath) {
  console.error('usage: node tools/autoRigPierce.mjs <static.glb> <reference.glb> <out.glb> [--height 1.78]');
  process.exit(1);
}
const hArg = args.indexOf('--height');
const HEIGHT = hArg >= 0 ? Number(args[hArg + 1]) : 1.78;

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

// ---------------------------------------------------------------- math
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => scl(a, 1 / (len(a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qrot = (q, v) => qmul(qmul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]).slice(0, 3);
const qbetween = (a, b) => {
  const u = norm(a);
  const v = norm(b);
  const c = cross(u, v);
  const q = [c[0], c[1], c[2], 1 + dot(u, v)];
  const l = Math.hypot(...q) || 1;
  return q.map((x) => x / l);
};

// ---------------------------------------------------------------- reference joints (world, metres)
const ref = await io.read(refPath);
const refJoints = ref.getRoot().listSkins()[0].listJoints();
const key = (n) => n.split(':').pop();
const refWorld = new Map();
{
  const memo = new Map();
  const w = (n) => {
    if (memo.has(n)) return memo.get(n);
    const p = n.getParentNode();
    const pw = p ? w(p) : { q: [0, 0, 0, 1], p: [0, 0, 0], s: 1 };
    const r = { q: qmul(pw.q, n.getRotation()), p: add(pw.p, scl(qrot(pw.q, n.getTranslation()), pw.s)), s: pw.s * n.getScale()[0] };
    memo.set(n, r);
    return r;
  };
  for (const j of refJoints) refWorld.set(key(j.getName()), w(j).p);
}
const R = (k) => {
  const p = refWorld.get(k);
  if (!p) throw new Error(`reference has no ${k}`);
  return p;
};
const refHeight = R('HeadTop_End')[1];
const ky = HEIGHT / refHeight;

// ---------------------------------------------------------------- the mesh
const doc = await io.read(inPath);
const root = doc.getRoot();
const meshNode = root.listNodes().find((n) => n.getMesh());
const prims = meshNode.getMesh().listPrimitives();
if (prims.length !== 1) throw new Error(`expected one primitive, found ${prims.length}`);
const prim = prims[0];
const posAcc = prim.getAttribute('POSITION');
const N = posAcc.getCount();
const pos = new Float32Array(N * 3);
{
  const e = [0, 0, 0];
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < N; i++) {
    posAcc.getElement(i, e);
    pos.set(e, i * 3);
    minY = Math.min(minY, e[1]);
    maxY = Math.max(maxY, e[1]);
    minX = Math.min(minX, e[0]);
    maxX = Math.max(maxX, e[0]);
  }
  const s = HEIGHT / (maxY - minY);
  const cx = (minX + maxX) / 2;
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (pos[i * 3] - cx) * s;
    pos[i * 3 + 1] = (pos[i * 3 + 1] - minY) * s;
    pos[i * 3 + 2] *= s;
  }
}
const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
/** Centroid of vertices passing a filter, or null. */
const centroid = (f) => {
  let n = 0;
  const c = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const v = P(i);
    if (!f(v)) continue;
    c[0] += v[0];
    c[1] += v[1];
    c[2] += v[2];
    n++;
  }
  return n ? scl(c, 1 / n) : null;
};
// Centre z on the hips' cross-section.
{
  const hy = R('Hips')[1] * ky;
  const c = centroid((v) => Math.abs(v[1] - hy) < 0.02 && Math.abs(v[0]) < 0.2);
  for (let i = 0; i < N; i++) pos[i * 3 + 2] -= c[2];
}

// ---------------------------------------------------------------- joints
const J = new Map();
const slab = (y, xmin, xmax, h = 0.015) =>
  centroid((v) => Math.abs(v[1] - y) < h && v[0] >= xmin && v[0] <= xmax);

for (const k of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head']) {
  const y = R(k)[1] * ky;
  const w = k === 'Neck' || k === 'Head' ? 0.08 : 0.14;
  const c = slab(y, -w, w);
  J.set(k, [0, y, c ? c[2] + (R(k)[2] - 0) * 0 : 0]);
}

for (const [side, sg] of [['Left', 1], ['Right', -1]]) {
  // Legs
  const lx = (v) => (sg > 0 ? [0.005, 0.26] : [-0.26, -0.005]);
  for (const k of ['UpLeg', 'Leg', 'Foot']) {
    const y = R(`${side}${k}`)[1] * ky;
    const [a, b] = lx();
    const c = slab(y, a, b, k === 'UpLeg' ? 0.02 : 0.015);
    J.set(`${side}${k}`, [c[0], y, c[2]]);
  }
  // Foot: heel and tip from the shoe.
  {
    const [a, b] = lx();
    let tip = -Infinity;
    let heel = Infinity;
    for (let i = 0; i < N; i++) {
      const v = P(i);
      if (v[1] > 0.07 || v[0] < a || v[0] > b) continue;
      tip = Math.max(tip, v[2]);
      heel = Math.min(heel, v[2]);
    }
    const ballZ = tip - (tip - heel) * 0.27;
    const c = centroid((v) => v[1] < 0.06 && v[0] >= a && v[0] <= b && Math.abs(v[2] - ballZ) < 0.02);
    J.set(`${side}ToeBase`, [c[0], R(`${side}ToeBase`)[1] * ky, ballZ]);
    J.set(`${side}ToeTip`, [c[0], 0.025, tip]);
  }
  // Arm: principal axis of the arm's vertices.
  const armVerts = [];
  for (let i = 0; i < N; i++) {
    const v = P(i);
    if (sg * v[0] > 0.34 && v[1] > 0.6 && v[1] < 1.6) armVerts.push(v);
  }
  const mean = armVerts.reduce((m, v) => add(m, v), [0, 0, 0]).map((x) => x / armVerts.length);
  let d = [sg, -0.8, 0];
  for (let it = 0; it < 30; it++) {
    let nd = [0, 0, 0];
    for (const v of armVerts) {
      const r = sub(v, mean);
      nd = add(nd, scl(r, dot(r, d)));
    }
    d = norm(nd);
  }
  if (d[0] * sg < 0) d = scl(d, -1);
  // Shoulder ball: where that axis reaches the reference shoulder height, kept inside a sane width.
  const ay = R(`${side}Arm`)[1] * ky;
  let A = add(mean, scl(d, (ay - mean[1]) / d[1]));
  const ax = sg * Math.max(0.15, Math.min(0.24, Math.abs(A[0])));
  const shoulderC = centroid((v) => Math.abs(v[1] - ay) < 0.03 && Math.abs(v[0] - ax) < 0.03);
  A = [ax, ay, shoulderC ? shoulderC[2] : mean[2]];
  // Re-aim the axis from the shoulder ball through the arm's mean.
  d = norm(sub(mean, A));
  let tmax = 0;
  for (const v of armVerts) tmax = Math.max(tmax, dot(sub(v, A), d));
  const T = add(A, scl(d, tmax));
  const lu = len(sub(R(`${side}ForeArm`), R(`${side}Arm`)));
  const lf = len(sub(R(`${side}Hand`), R(`${side}ForeArm`)));
  const lh = len(sub(R(`${side}HandMiddle4`), R(`${side}Hand`)));
  const total = lu + lf + lh;
  /** Centre a point on the axis in the limb's cross-section there. */
  const centre = (p, r = 0.1) => {
    const c = centroid((v) => {
      const q = sub(v, p);
      const t = dot(q, d);
      return Math.abs(t) < 0.012 && len(sub(q, scl(d, t))) < r;
    });
    return c ? add(c, scl(d, dot(sub(p, c), d))) : p;
  };
  const E = centre(add(A, scl(d, (tmax * lu) / total)));
  const Wr = centre(add(A, scl(d, (tmax * (lu + lf)) / total)), 0.07);
  J.set(`${side}Arm`, A);
  J.set(`${side}ForeArm`, E);
  J.set(`${side}Hand`, Wr);
  J.set(`${side}HandTip`, T);
  const rs = R(`${side}Shoulder`);
  // The hip slab takes in the open jacket and the belly, which pulls its centroid forward: the hip joint keeps the
  // reference's depth offset over the knee instead (a straight thigh in the rest pose).
  J.get(`${side}UpLeg`)[2] = J.get(`${side}Leg`)[2] + (R(`${side}UpLeg`)[2] - R(`${side}Leg`)[2]);
  J.set(`${side}Shoulder`, [sg * Math.abs(rs[0]) * (Math.abs(ax) / Math.abs(R(`${side}Arm`)[0])), rs[1] * ky, A[2]]);
  // Fingers: the reference hand turned onto the new hand direction.
  const rh = R(`${side}Hand`);
  const rdir = sub(R(`${side}HandMiddle4`), rh);
  const ndir = sub(T, Wr);
  const q = qbetween(rdir, ndir);
  const fs = len(ndir) / len(rdir);
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
    for (const n of [1, 2, 3]) {
      const k = `${side}Hand${f}${n}`;
      J.set(k, add(Wr, scl(qrot(q, sub(R(k), rh)), fs)));
    }
  }
  console.log(`${side} arm: shoulder ${A.map((x) => x.toFixed(3))} elbow ${E.map((x) => x.toFixed(3))} wrist ${Wr.map((x) => x.toFixed(3))} tip ${T.map((x) => x.toFixed(3))} (angle below horizontal ${(Math.asin(-d[1]) * 57.3).toFixed(1)}°)`);
}

// The spine: the belly and the open jacket make the torso's cross-sections useless for depth, so the hips take the
// reference's offset over the hip joints and the spine the reference's curve from there. Neck and head stay measured
// (nothing but neck and head at those heights).
{
  const up = (J.get('LeftUpLeg')[2] + J.get('RightUpLeg')[2]) / 2;
  const refUp = (R('LeftUpLeg')[2] + R('RightUpLeg')[2]) / 2;
  const hz = up + (R('Hips')[2] - refUp);
  for (const k of ['Hips', 'Spine', 'Spine1', 'Spine2']) J.get(k)[2] = hz + (R(k)[2] - R('Hips')[2]);
  console.log('spine z:', ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'].map((k) => `${k} ${J.get(k)[2].toFixed(3)}`).join(', '));
}

// ---------------------------------------------------------------- hierarchy
const PARENT = {
  Hips: null, Spine: 'Hips', Spine1: 'Spine', Spine2: 'Spine1', Neck: 'Spine2', Head: 'Neck',
};
const ORDER = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'];
for (const side of ['Left', 'Right']) {
  PARENT[`${side}Shoulder`] = 'Spine2';
  PARENT[`${side}Arm`] = `${side}Shoulder`;
  PARENT[`${side}ForeArm`] = `${side}Arm`;
  PARENT[`${side}Hand`] = `${side}ForeArm`;
  ORDER.push(`${side}Shoulder`, `${side}Arm`, `${side}ForeArm`, `${side}Hand`);
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
    PARENT[`${side}Hand${f}1`] = `${side}Hand`;
    PARENT[`${side}Hand${f}2`] = `${side}Hand${f}1`;
    PARENT[`${side}Hand${f}3`] = `${side}Hand${f}2`;
    ORDER.push(`${side}Hand${f}1`, `${side}Hand${f}2`, `${side}Hand${f}3`);
  }
}
for (const side of ['Left', 'Right']) {
  PARENT[`${side}UpLeg`] = 'Hips';
  PARENT[`${side}Leg`] = `${side}UpLeg`;
  PARENT[`${side}Foot`] = `${side}Leg`;
  PARENT[`${side}ToeBase`] = `${side}Foot`;
  ORDER.push(`${side}UpLeg`, `${side}Leg`, `${side}Foot`, `${side}ToeBase`);
}
const IDX = new Map(ORDER.map((k, i) => [k, i]));

// ---------------------------------------------------------------- weights
/** Weights along a polyline: bones[i] owns segment i; blends of half-width h[i] at inner joint i+1. */
const chain = (v, pts, bones, h) => {
  // Arc length of the projection onto the nearest segment.
  let best = Infinity;
  let s = 0;
  let acc = 0;
  const L = [0];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const ab = sub(pts[i + 1], a);
    const l = len(ab);
    const t = Math.max(i === 0 ? -Infinity : 0, Math.min(i === pts.length - 2 ? Infinity : 1, dot(sub(v, a), ab) / (l * l)));
    const c = add(a, scl(ab, t));
    const dd = len(sub(v, c));
    if (dd < best) {
      best = dd;
      s = acc + t * l;
    }
    acc += l;
    L.push(acc);
  }
  const out = new Map();
  for (let i = 0; i < bones.length; i++) {
    const lo = i === 0 ? 1 : smooth((s - (L[i] - h[i - 1])) / (2 * h[i - 1]));
    const hi = i === bones.length - 1 ? 1 : 1 - smooth((s - (L[i + 1] - h[i])) / (2 * h[i]));
    const w = lo * hi;
    if (w > 1e-4) out.set(bones[i], (out.get(bones[i]) ?? 0) + w);
  }
  return out;
};
const mix = (a, b, t) => {
  const o = new Map();
  for (const [k, w] of a) o.set(k, (o.get(k) ?? 0) + w * (1 - t));
  for (const [k, w] of b) o.set(k, (o.get(k) ?? 0) + w * t);
  return o;
};

const G = (k) => J.get(k);
const spineY = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head'].map((k) => G(k)[1]);
const torso = (v) => {
  const bones = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'];
  const hw = [0.05, 0.05, 0.05, 0.035, 0.03];
  const o = new Map();
  for (let i = 0; i < bones.length; i++) {
    const lo = i === 0 ? 1 : smooth((v[1] - (spineY[i - 1] - hw[i - 1])) / (2 * hw[i - 1]));
    const hi = i === bones.length - 1 ? 1 : 1 - smooth((v[1] - (spineY[i] - hw[i])) / (2 * hw[i]));
    if (lo * hi > 1e-4) o.set(bones[i], lo * hi);
  }
  // The top of the chest and the shoulder line follow the clavicle.
  const side = v[0] >= 0 ? 'Left' : 'Right';
  const A = G(`${side}Arm`);
  const wsh = smooth((Math.abs(v[0]) - 0.07) / (Math.abs(A[0]) - 0.07)) * smooth((v[1] - (spineY[2] - 0.02)) / 0.1) * (v[1] < spineY[3] + 0.06 ? 1 : 0);
  return wsh > 0 ? mix(o, new Map([[`${side}Shoulder`, 1]]), wsh * 0.85) : o;
};
const leg = (v, side) =>
  chain(v, [add(G(`${side}UpLeg`), [0, 0.12, 0]), G(`${side}UpLeg`), G(`${side}Leg`), G(`${side}Foot`), G(`${side}ToeBase`), G(`${side}ToeTip`)],
    ['Hips', `${side}UpLeg`, `${side}Leg`, `${side}Foot`, `${side}ToeBase`], [0.06, 0.07, 0.045, 0.03]);
const arm = (v, side) =>
  chain(v, [G(`${side}Shoulder`), G(`${side}Arm`), G(`${side}ForeArm`), G(`${side}Hand`), G(`${side}HandTip`)],
    [`${side}Shoulder`, `${side}Arm`, `${side}ForeArm`, `${side}Hand`], [0.10, 0.065, 0.035]);
const armZone = (v, side) => {
  const A = G(`${side}Arm`);
  const d = norm(sub(G(`${side}HandTip`), A));
  const q = sub(v, A);
  const t = dot(q, d);
  const r = len(sub(q, scl(d, t)));
  if ((side === 'Left') !== v[0] > 0) return 0;
  // Well out from the jacket everything is arm; past the wrist the fingers spread off the axis.
  if (Math.abs(v[0]) > 0.36 && t > 0) return 1;
  const wristT = dot(sub(G(`${side}Hand`), A), d);
  const rmax = t > wristT - 0.03 ? 0.15 : 0.10;
  // A long gradient off the sleeve: the mesh webs the armpit to the jacket's back, and a short one tears that web when
  // he aims forward (tools/modelAudit.mjs stretch).
  return smooth((t + 0.05) / 0.2) * (1 - smooth((r - rmax) / 0.12));
};
const hipY = G('LeftUpLeg')[1];
const SEAT = 0.7;

const raw = [];
for (let i = 0; i < N; i++) {
  const v = P(i);
  const fa = Math.max(armZone(v, 'Left'), armZone(v, 'Right'));
  const side = v[0] >= 0 ? 'Left' : 'Right';
  const fl = smooth((hipY + 0.04 - v[1]) / 0.16);
  const sL = smooth((v[0] + 0.03) / 0.06);
  let w = torso(v);
  if (fl > 0) {
    let lw = mix(leg(v, 'Right'), leg(v, 'Left'), sL);
    // The trouser seam between the legs belongs to the pelvis, or each step tears it between the thighs.
    const crotch = (1 - smooth(Math.abs(v[0]) / 0.10)) * smooth((v[1] - (hipY - 0.3)) / 0.12) * 0.75;
    // The seat and the jacket's back hang from the pelvis too (seated, they fold against the thighs otherwise).
    const seat = smooth((G('Hips')[2] - v[2] - 0.12) / 0.08) * smooth((v[1] - (hipY - 0.3)) / 0.12) * SEAT;
    const pelvis = Math.max(crotch, seat);
    if (pelvis > 0) lw = mix(lw, new Map([['Hips', 1]]), pelvis);
    w = mix(w, lw, fl);
  }
  if (fa > 0) w = mix(w, arm(v, side), fa);
  raw.push(w);
}

// Weld by position, so UV seams share one weight, then smooth over the welded edges.
const weld = new Int32Array(N);
{
  const m = new Map();
  for (let i = 0; i < N; i++) {
    const k = `${Math.round(pos[i * 3] * 2e4)},${Math.round(pos[i * 3 + 1] * 2e4)},${Math.round(pos[i * 3 + 2] * 2e4)}`;
    if (!m.has(k)) m.set(k, i);
    weld[i] = m.get(k);
  }
}
const nbr = new Map();
{
  const idx = prim.getIndices();
  const link = (a, b) => {
    if (a === b) return;
    if (!nbr.has(a)) nbr.set(a, new Set());
    nbr.get(a).add(b);
  };
  for (let t = 0; t < idx.getCount(); t += 3) {
    const a = weld[idx.getScalar(t)];
    const b = weld[idx.getScalar(t + 1)];
    const c = weld[idx.getScalar(t + 2)];
    link(a, b); link(b, a); link(b, c); link(c, b); link(a, c); link(c, a);
  }
}
let W = new Map();
for (let i = 0; i < N; i++) if (weld[i] === i) W.set(i, raw[i]);
for (let it = 0; it < 10; it++) {
  const next = new Map();
  for (const [i, w] of W) {
    const ns = nbr.get(i);
    if (!ns || !ns.size) {
      next.set(i, w);
      continue;
    }
    const avg = new Map();
    for (const n of ns) for (const [k, x] of W.get(n)) avg.set(k, (avg.get(k) ?? 0) + x / ns.size);
    next.set(i, mix(w, avg, 0.5));
  }
  W = next;
}

const joints = new Uint16Array(N * 4);
const weights = new Float32Array(N * 4);
for (let i = 0; i < N; i++) {
  const top = [...W.get(weld[i])].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = top.reduce((s, [, x]) => s + x, 0) || 1;
  top.forEach(([k, x], c) => {
    joints[i * 4 + c] = IDX.get(k);
    weights[i * 4 + c] = x / sum;
  });
}

// ---------------------------------------------------------------- write
const buffer = root.listBuffers()[0];
posAcc.setArray(pos);
prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer));
prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));
meshNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
// views3d marks its material double-sided; the winding is outward (checked against the normals), so cull back faces.
for (const m of root.listMaterials()) m.setDoubleSided(false);

const nodes = new Map();
for (const k of ORDER) {
  const p = G(k);
  const par = PARENT[k];
  const pp = par ? G(par) : [0, 0, 0];
  const n = doc.createNode(`mixamorig:${k}`).setTranslation(sub(p, pp));
  nodes.set(k, n);
  if (par) nodes.get(par).addChild(n);
}
const scene = root.listScenes()[0] ?? doc.createScene();
const armature = doc.createNode('Armature');
armature.addChild(nodes.get('Hips'));
scene.addChild(armature);
const ibm = new Float32Array(ORDER.length * 16);
ORDER.forEach((k, i) => {
  const p = G(k);
  ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1], i * 16);
});
const skin = doc.createSkin('pierce-skin').setSkeleton(nodes.get('Hips'))
  .setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
for (const k of ORDER) skin.addJoint(nodes.get(k));
meshNode.setSkin(skin);

// Report.
const used = new Map();
for (let i = 0; i < N; i++) used.set(joints[i * 4], (used.get(joints[i * 4]) ?? 0) + 1);
console.log('dominant bones:', [...used].sort((a, b) => b[1] - a[1]).map(([j, n]) => `${ORDER[j]} ${n}`).join(', '));
for (const k of ['Hips', 'Spine2', 'Neck', 'Head', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase']) console.log(k.padEnd(12), G(k).map((x) => x.toFixed(3)).join(' '));
await io.write(outPath, doc);
console.log('wrote', outPath, `${N} vertices, ${ORDER.length} joints`);
