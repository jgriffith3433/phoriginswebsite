// Puts the game's own clips on a newly rigged Mixamo character, with the bone frames of the reference rig.
//
//   node tools/retargetPierce.mjs <rigged.glb> <reference.glb> <out.glb> [--name pierce]
//
// <rigged.glb> is a Hawkes Gen mesh.rig result (Make-It-Animatable: mixamorig: names, its own joint orientations,
// an A-pose rest). <reference.glb> is the character whose clips the game already plays (ch33-hero.glb: mixamorig7:
// names, a T-pose rest, the 16 player clips). The output keeps the new mesh and its skin weights and:
//
// 1. Turns every joint so its rest frame is the reference joint's frame, swung onto the new bone's direction
//    (B = swing(d_ref -> d_new) * Q0_ref). The inverse bind matrices are corrected with it (IBM' = R(B^-1 A) IBM), so
//    the rest shape is exactly the same.
// 2. Replaces the clips with the reference's: each joint's world rotation at a frame is the reference joint's world
//    rotation (W'(t) = Q(t)). With the frames above that bends the new bone exactly as the reference bone bends, and
//    the hand bone has the reference hand's axes, so the pistol grip, the phone in the palm and the sit pose that were
//    tuned on the reference still line up. The hips travel is scaled by the hip-height ratio.
//
// No Blender, no GPU. Run tools/compress-models.mjs on the output afterwards.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const [rigPath, refPath, outPath] = args.filter((a, i) => !a.startsWith('--') && !['--height', '--arm-spread', '--name'].includes(args[i - 1]));
if (!rigPath || !refPath || !outPath) {
  console.error('usage: node tools/retargetPierce.mjs <rigged.glb> <reference.glb> <out.glb> [--height m]');
  process.exit(1);
}
// --arm-spread <degrees>: swings each whole arm out from the body (about the chest's forward axis) in every clip, for
// a character wider through the chest and the jacket than the reference, whose hands would otherwise sink into it.
const spreadArg = args.indexOf('--arm-spread');
const armSpread = spreadArg >= 0 ? (Number(args[spreadArg + 1]) * Math.PI) / 180 : 0;
const heightArg = args.indexOf('--height');
const wantHeight = heightArg >= 0 ? Number(args[heightArg + 1]) : 0;

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

// ---------------------------------------------------------------- small math (quaternions [x,y,z,w], column-major mat4)
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qnorm = (q) => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};
const qrot = (q, v) => {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q));
  return [p[0], p[1], p[2]];
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** The shortest rotation taking direction a onto direction b. */
const qbetween = (a, b) => {
  const u = scl(a, 1 / (len(a) || 1));
  const v = scl(b, 1 / (len(b) || 1));
  const d = dot(u, v);
  if (d < -0.999999) {
    let axis = cross([1, 0, 0], u);
    if (len(axis) < 1e-6) axis = cross([0, 1, 0], u);
    axis = scl(axis, 1 / len(axis));
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(u, v);
  return qnorm([c[0], c[1], c[2], 1 + d]);
};
const slerp = (a, b, t) => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) {
    d = -d;
    bb = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (d > 0.9995) return qnorm(a.map((x, i) => x + (bb[i] - x) * t));
  const th = Math.acos(d);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return a.map((x, i) => x * wa + bb[i] * wb);
};
/** Column-major 4x4 of a rotation. */
const qmat = (q) => {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
};
const mmul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};

// ---------------------------------------------------------------- skeletons
const boneKey = (name) => name.split(':').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
/** Each bone's direction runs to this child joint (a hand points at its middle finger, as Gen's bake does). */
const TAIL = {
  hips: 'spine', spine: 'spine1', spine1: 'spine2', spine2: 'neck', neck: 'head',
  leftshoulder: 'leftarm', leftarm: 'leftforearm', leftforearm: 'lefthand', lefthand: 'lefthandmiddle1',
  rightshoulder: 'rightarm', rightarm: 'rightforearm', rightforearm: 'righthand', righthand: 'righthandmiddle1',
  leftupleg: 'leftleg', leftleg: 'leftfoot', leftfoot: 'lefttoebase',
  rightupleg: 'rightleg', rightleg: 'rightfoot', rightfoot: 'righttoebase',
};
for (const side of ['left', 'right']) {
  for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
    TAIL[`${side}hand${f}1`] = `${side}hand${f}2`;
    TAIL[`${side}hand${f}2`] = `${side}hand${f}3`;
  }
}

const local = (n) => ({ q: n.getRotation().slice(), p: n.getTranslation().slice(), s: n.getScale()[0] });
const compose = (par, l) => ({ q: qnorm(qmul(par.q, l.q)), p: add(par.p, scl(qrot(par.q, l.p), par.s)), s: par.s * l.s });
const IDENT = { q: [0, 0, 0, 1], p: [0, 0, 0], s: 1 };
/** World transform of a node with each node's local taken from `get` (rest TRS by default). */
const worldOf = (node, get = local, memo = new Map()) => {
  if (memo.has(node)) return memo.get(node);
  const par = node.getParentNode();
  const w = compose(par ? worldOf(par, get, memo) : IDENT, get(node));
  memo.set(node, w);
  return w;
};

const rig = await io.read(rigPath);
const ref = await io.read(refPath);
const rigSkin = rig.getRoot().listSkins()[0];
const refSkin = ref.getRoot().listSkins()[0];
if (!rigSkin || !refSkin) throw new Error('both files need a skin');

const refByKey = new Map(refSkin.listJoints().map((j) => [boneKey(j.getName()), j]));
const rigJoints = rigSkin.listJoints();
const rigByKey = new Map(rigJoints.map((j) => [boneKey(j.getName()), j]));
const missing = rigJoints.filter((j) => !refByKey.has(boneKey(j.getName()))).map((j) => j.getName());
if (missing.length) console.log('joints with no reference (kept still):', missing.join(', '));

// Optional uniform scale to a height first (the rig is already metres; this only trims it).
const rigRestMemo = new Map();
const rest = (j) => worldOf(j, local, rigRestMemo);
const refRestMemo = new Map();
const refRest = (j) => worldOf(j, local, refRestMemo);

const hipsKey = 'hips';
const rigHips = rigByKey.get(hipsKey);
const refHips = refByKey.get(hipsKey);
if (!rigHips || !refHips) throw new Error('no Hips in one of the skeletons');

// Bind check: the rest TRS should be the bind pose (inverse bind x rest world = the same matrix for every joint).
const ibmOf = (skin) => {
  const acc = skin.getInverseBindMatrices();
  const out = [];
  for (let i = 0; i < acc.getCount(); i++) out.push(acc.getElement(i, new Array(16)));
  return out;
};

// ---------------------------------------------------------------- new rest frames
const A = new Map(); // rig joint -> old rest world rotation
const P = new Map(); // rig joint -> rest world position
const S = new Map(); // rig joint -> rest world scale (a Mixamo FBX armature carries 0.01)
const B = new Map(); // rig joint -> new rest world rotation
const swing = new Map();
const order = [];
const visit = (n) => {
  if (rigJoints.includes(n)) order.push(n);
  for (const c of n.listChildren()) visit(c);
};
for (const scene of rig.getRoot().listScenes()) for (const n of scene.listChildren()) visit(n);
for (const j of rigJoints) if (!order.includes(j)) order.push(j);

for (const j of order) {
  const w = rest(j);
  A.set(j, w.q);
  P.set(j, w.p);
  S.set(j, w.s);
}
for (const j of order) {
  const key = boneKey(j.getName());
  const rj = refByKey.get(key);
  const par = j.getParentNode();
  if (!rj) {
    B.set(j, A.get(j));
    swing.set(j, swing.get(par) ?? [0, 0, 0, 1]);
    continue;
  }
  const tail = TAIL[key];
  const jc = tail && rigByKey.get(tail);
  const rc = tail && refByKey.get(tail);
  let s;
  if (jc && rc) {
    const dNew = sub(P.get(jc), P.get(j));
    const dRef = sub(refRest(rc).p, refRest(rj).p);
    s = len(dNew) > 1e-6 && len(dRef) > 1e-6 ? qbetween(dRef, dNew) : [0, 0, 0, 1];
  } else {
    s = swing.get(par) ?? [0, 0, 0, 1];
  }
  swing.set(j, s);
  B.set(j, qnorm(qmul(s, refRest(rj).q)));
}

// Apply: joint locals from the new frames, inverse binds corrected.
const parentWorld = (j) => {
  const par = j.getParentNode();
  if (!par) return IDENT;
  if (B.has(par)) return { q: B.get(par), p: P.get(par), s: S.get(par) };
  return rest(par);
};
const newLocal = new Map();
for (const j of order) {
  const pw = parentWorld(j);
  const qi = qinv(pw.q);
  const l = { q: qnorm(qmul(qi, B.get(j))), p: scl(qrot(qi, sub(P.get(j), pw.p)), 1 / pw.s), s: S.get(j) / pw.s };
  newLocal.set(j, l);
}
const ibms = ibmOf(rigSkin);
const fixed = rigJoints.map((j, i) => mmul(qmat(qmul(qinv(B.get(j)), A.get(j))), ibms[i]));
for (const j of order) {
  const l = newLocal.get(j);
  j.setRotation(l.q).setTranslation(l.p).setScale([l.s, l.s, l.s]);
}
rigSkin.getInverseBindMatrices().setArray(new Float32Array(fixed.flat()));

// ---------------------------------------------------------------- clips
for (const a of rig.getRoot().listAnimations()) {
  for (const c of a.listChannels()) c.dispose();
  for (const s of a.listSamplers()) {
    s.getInput()?.dispose();
    s.getOutput()?.dispose();
    s.dispose();
  }
  a.dispose();
}

const hipY = (w) => w.p[1];
const k = hipY(P.has(rigHips) ? { p: P.get(rigHips) } : rest(rigHips)) / hipY(refRest(refHips));
console.log(`hips: new ${P.get(rigHips)[1].toFixed(3)} m, reference ${refRest(refHips).p[1].toFixed(3)} m, travel x${k.toFixed(3)}`);

const sample = (sampler, t) => {
  const input = sampler.getInput();
  const output = sampler.getOutput();
  const n = input.getCount();
  const size = output.getElementSize();
  const cubic = sampler.getInterpolation() === 'CUBICSPLINE';
  const at = (i) => {
    const e = new Array(size);
    output.getElement(cubic ? i * 3 + 1 : i, e);
    return e;
  };
  if (t <= input.getScalar(0)) return at(0);
  if (t >= input.getScalar(n - 1)) return at(n - 1);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (input.getScalar(mid) <= t) lo = mid;
    else hi = mid;
  }
  const t0 = input.getScalar(lo);
  const t1 = input.getScalar(hi);
  const f = sampler.getInterpolation() === 'STEP' ? 0 : (t - t0) / (t1 - t0 || 1);
  const a = at(lo);
  const b = at(hi);
  if (size === 4) return slerp(a, b, f);
  return a.map((x, i) => x + (b[i] - x) * f);
};

const buffer = rig.getRoot().listBuffers()[0] ?? rig.createBuffer();
const rigHipsParentWorld = parentWorld(rigHips);
for (const ra of ref.getRoot().listAnimations()) {
  const byNode = new Map();
  let times = new Set();
  for (const ch of ra.listChannels()) {
    const node = ch.getTargetNode();
    if (!node) continue;
    const m = byNode.get(node) ?? {};
    m[ch.getTargetPath()] = ch.getSampler();
    byNode.set(node, m);
    const inp = ch.getSampler().getInput();
    for (let i = 0; i < inp.getCount(); i++) times.add(Math.round(inp.getScalar(i) * 1e5) / 1e5);
  }
  times = [...times].sort((x, y) => x - y);
  const get = (t) => (n) => {
    const l = local(n);
    const m = byNode.get(n);
    if (m?.rotation) l.q = qnorm(sample(m.rotation, t));
    if (m?.translation) l.p = sample(m.translation, t);
    if (m?.scale) l.s = sample(m.scale, t)[0];
    return l;
  };
  const rot = new Map(order.map((j) => [j, []]));
  const hipsPos = [];
  const prev = new Map();
  const refHipsRest = refRest(refHips).p;
  for (const t of times) {
    const memo = new Map();
    const g = get(t);
    const W = new Map();
    for (const j of order) {
      const rj = refByKey.get(boneKey(j.getName()));
      W.set(j, rj ? worldOf(rj, g, memo).q : null);
    }
    if (armSpread) {
      // The chest's forward axis now, from the reference's Spine2 (its rest frame carries +Z forward).
      const sp = refByKey.get('spine2');
      const fwd = sp ? qrot(qmul(worldOf(sp, g, memo).q, qinv(refRest(sp).q)), [0, 0, 1]) : [0, 0, 1];
      for (const j of order) {
        const k = boneKey(j.getName());
        const side = k.startsWith('leftarm') || k.startsWith('leftforearm') || k.startsWith('lefthand') ? 1
          : k.startsWith('rightarm') || k.startsWith('rightforearm') || k.startsWith('righthand') ? -1 : 0;
        if (!side || !W.get(j)) continue;
        // Left arm (+X) swings out with a rotation of +angle about forward; right with -angle.
        const h = (side * armSpread) / 2;
        const sw = [fwd[0] * Math.sin(h), fwd[1] * Math.sin(h), fwd[2] * Math.sin(h), Math.cos(h)];
        W.set(j, qnorm(qmul(sw, W.get(j))));
      }
    }
    for (const j of order) {
      const par = j.getParentNode();
      const wj = W.get(j) ?? qmul(W.get(par) ?? parentWorld(j).q, newLocal.get(j).q);
      if (!W.get(j)) W.set(j, wj);
      const wp = B.has(par) ? W.get(par) : parentWorld(j).q;
      let q = qnorm(qmul(qinv(wp), wj));
      const pq = prev.get(j);
      if (pq && q[0] * pq[0] + q[1] * pq[1] + q[2] * pq[2] + q[3] * pq[3] < 0) q = q.map((x) => -x);
      prev.set(j, q);
      rot.get(j).push(...q);
    }
    const hp = worldOf(refHips, g, memo).p;
    const world = add(P.get(rigHips), scl(sub(hp, refHipsRest), k));
    const pw = rigHipsParentWorld;
    hipsPos.push(...scl(qrot(qinv(pw.q), sub(world, pw.p)), 1 / pw.s));
  }
  const anim = rig.createAnimation(ra.getName());
  const input = rig.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer);
  for (const j of order) {
    const out = rig.createAccessor().setType('VEC4').setArray(new Float32Array(rot.get(j))).setBuffer(buffer);
    const s = rig.createAnimationSampler().setInput(input).setOutput(out).setInterpolation('LINEAR');
    anim.addSampler(s).addChannel(rig.createAnimationChannel().setTargetNode(j).setTargetPath('rotation').setSampler(s));
  }
  const hout = rig.createAccessor().setType('VEC3').setArray(new Float32Array(hipsPos)).setBuffer(buffer);
  const hs = rig.createAnimationSampler().setInput(input).setOutput(hout).setInterpolation('LINEAR');
  anim.addSampler(hs).addChannel(rig.createAnimationChannel().setTargetNode(rigHips).setTargetPath('translation').setSampler(hs));
  console.log(`${ra.getName()}: ${times.length} keys, ${times[times.length - 1].toFixed(2)} s`);
}

// Names the game and the playtest can find: materials `<name>-suit`, meshes `<name>-body`.
const nameArg = args.indexOf('--name');
if (nameArg >= 0) {
  const base = args[nameArg + 1];
  rig.getRoot().listMaterials().forEach((m, i) => m.setName(i ? `${base}-suit-${i}` : `${base}-suit`));
  rig.getRoot().listMeshes().forEach((m, i) => m.setName(i ? `${base}-body-${i}` : `${base}-body`));
}

if (wantHeight > 0) console.log(`(--height ${wantHeight} is informational; mesh.rig already planted and sized the rig)`);
await io.write(outPath, rig);
console.log('wrote', outPath);
