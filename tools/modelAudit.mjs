// Mesh audit over every GLB under assets/models: `npm run check:models` (exit 1 on any failure), `--json` for a report,
// or name files. Studio quality rule 3, asked of the pipeline (not of a two-sided material):
// - winding:  a primitive whose triangles mostly wind inward (negative signed volume) is inside out; a lit-side
//             check on the stored normals (normal against the face normal) catches flipped normals on open meshes.
// - mirror:   a node whose own or inherited matrix mirrors (negative determinant): the mirror must be baked into the mesh.
// - normals:  NaN, infinite or zero-length normals (what a lossy meshopt pass leaves behind), NaN positions.
// - handed:   right-handed glTF to the engine: glTF asset version 2, unit-length quaternions and a root with no mirror.
// - skin:     joints inside the skin, weights summing to 1 (within 0.02), every joint node reachable, one skin per
//             character (a second skeleton means the rig was split), joints/weights on every vertex of a skinned mesh.
// - stretch:  the skinned mesh at rest and posed with the walk / sit clips: an edge that grows past STRETCH x its bind
//             length (or collapses) is a stretched vertex.
// Models are read with the meshopt decoder, so what is judged is what the game loads.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const DIR = path.resolve('assets/models');
const named = args.filter((a) => !a.startsWith('--'));
const files = named.length ? named.map((f) => path.resolve(f)) : fs.readdirSync(DIR).filter((f) => f.endsWith('.glb')).sort().map((f) => path.join(DIR, f));

const STRETCH = 6; // posed edge over rest edge; a seated crotch or belt folds to about 5x, broken weights give 50x and up
const MIN_EDGE = 0.004; // bind edges under this (metres) are ignored: sub-tolerance slivers
const POSES = [/^walk$/i, /walk/i, /sit/i, /idle/i]; // clips tried, by name tail; the first two cover Walk, Pistol Walk
const world = (node) => { let m = Matrix.FromArray(node.getMatrix()); for (let p = node.getParentNode(); p; p = p.getParentNode()) m = m.multiply(Matrix.FromArray(p.getMatrix())); return m; };

const slerpSample = (times, values, t, size, rotation) => {
  const n = times.length;
  if (t <= times[0]) return Array.from(values.slice(0, size));
  if (t >= times[n - 1]) return Array.from(values.slice((n - 1) * size, n * size));
  let i = 0;
  while (times[i + 1] < t) i++;
  const f = (t - times[i]) / (times[i + 1] - times[i] || 1);
  const a = values.slice(i * size, (i + 1) * size);
  const b = values.slice((i + 1) * size, (i + 2) * size);
  if (rotation) return Array.from(Quaternion.Slerp(Quaternion.FromArray(a), Quaternion.FromArray(b), f).asArray());
  return Array.from(a, (v, k) => v + (b[k] - v) * f);
};

/** Local matrices of every node with the clip applied at time t (nodes the clip doesn't touch keep their rest pose). */
const posedLocals = (doc, clip, t) => {
  const local = new Map();
  for (const node of doc.getRoot().listNodes()) local.set(node, { t: node.getTranslation(), r: node.getRotation(), s: node.getScale() });
  if (clip) {
    for (const ch of clip.listChannels()) {
      const node = ch.getTargetNode();
      const path_ = ch.getTargetPath();
      const sm = ch.getSampler();
      if (!node || !sm || sm.getInterpolation() === 'CUBICSPLINE') continue;
      const tm = sm.getInput().getArray(); const vals = sm.getOutput().getArray();
      const size = path_ === 'rotation' ? 4 : 3;
      if (!['translation', 'rotation', 'scale'].includes(path_)) continue;
      const v = slerpSample(tm, vals, t, size, path_ === 'rotation');
      local.get(node)[path_ === 'translation' ? 't' : path_ === 'rotation' ? 'r' : 's'] = v;
    }
  }
  const mats = new Map();
  for (const [node, { t: tr, r, s }] of local) mats.set(node, Matrix.Compose(Vector3.FromArray(s), Quaternion.FromArray(r), Vector3.FromArray(tr)));
  const cache = new Map();
  const worldOf = (node) => {
    if (cache.has(node)) return cache.get(node);
    const p = node.getParentNode();
    const m = p ? mats.get(node).multiply(worldOf(p)) : mats.get(node);
    cache.set(node, m);
    return m;
  };
  return worldOf;
};

const audit = async (file) => {
  const name = path.basename(file);
  const fails = [];
  const notes = [];
  const fail = (rule, what, detail) => fails.push({ rule, what, detail });
  const doc = await io.read(file);
  const root = doc.getRoot();
  if (!String(doc.getRoot().getAsset?.().version ?? '2.0').startsWith('2')) fail('handed', name, `glTF version ${root.getAsset().version}`);
  const nodes = root.listNodes();
  let prims = 0; let verts = 0;

  for (const node of nodes) {
    const w = world(node);
    if (w.determinant() < 0) fail('mirror', node.getName(), `world matrix mirrors (determinant ${w.determinant().toExponential(2)}): bake the mirror into the mesh`);
    const s = node.getScale();
    if (s[0] < 0 || s[1] < 0 || s[2] < 0) fail('mirror', node.getName(), `negative scale ${s.map((v) => +v.toFixed(3))}`);
    const q = node.getRotation();
    if (Math.abs(Math.hypot(...q) - 1) > 1e-3) fail('handed', node.getName(), `rotation is not a unit quaternion (${Math.hypot(...q).toFixed(4)})`);
    if ([...node.getTranslation(), ...q, ...s].some((v) => !Number.isFinite(v))) fail('handed', node.getName(), 'non-finite transform');
  }

  const skinNodes = nodes.filter((n) => n.getSkin() && n.getMesh());
  const skins = new Set(skinNodes.map((n) => n.getSkin()));
  if (skins.size > 1) fail('skin', name, `${skins.size} skeletons (a character should load one)`);

  for (const node of nodes) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const skin = node.getSkin();
    const W = world(node);
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const label = `${node.getName() || mesh.getName()}`;
      const pos = prim.getAttribute('POSITION');
      const nrm = prim.getAttribute('NORMAL');
      const ind = prim.getIndices();
      if (!pos) continue;
      prims++; verts += pos.getCount();
      const P = []; // positions as plain arrays
      let badPos = 0; let badNrm = 0; let zeroNrm = 0;
      for (let i = 0; i < pos.getCount(); i++) {
        const p = pos.getElement(i, []);
        if (p.some((v) => !Number.isFinite(v))) badPos++;
        P.push(p);
        if (nrm) {
          const n = nrm.getElement(i, []);
          if (n.some((v) => !Number.isFinite(v))) badNrm++;
          else if (Math.hypot(...n) < 0.5) zeroNrm++; // a unit normal that decodes under half length is zero or collapsed
          else if (Math.abs(Math.hypot(...n) - 1) > 0.2) zeroNrm++;
        }
      }
      if (badPos) fail('normals', label, `${badPos} NaN/infinite positions`);
      if (badNrm) fail('normals', label, `${badNrm} NaN/infinite normals`);
      if (zeroNrm) fail('normals', label, `${zeroNrm} zero or non-unit normals`);
      const idx = ind ? ind.getArray() : Uint32Array.from(P.keys());
      if (idx.length % 3) fail('winding', label, 'index count is not a multiple of 3');

      // Signed volume of the primitive in world space (needs W's determinant positive, which the mirror check enforces),
      // plus the share of triangles whose face normal opposes the stored vertex normals.
      const mn = [Infinity, Infinity, Infinity]; const mx = [-Infinity, -Infinity, -Infinity];
      let vol = 0; let opposed = 0; let counted = 0;
      const tp = (i) => P[i];
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map(tp);
        if (!a || !b || !c) continue;
        for (const p of [a, b, c]) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
        vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
        if (nrm && !skin) {
          const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
          const fl = Math.hypot(...f);
          if (fl < 1e-12) continue;
          const na = nrm.getElement(idx[t], []);
          counted++;
          if ((f[0] * na[0] + f[1] * na[1] + f[2] * na[2]) / fl < -0.2) opposed++;
        }
      }
      const box = (mx[0] - mn[0]) * (mx[1] - mn[1]) * (mx[2] - mn[2]);
      const mat = prim.getMaterial();
      const doubleSided = !!mat?.getDoubleSided();
      // A closed shell has a clear sign; an open one (a card, a runner) is judged on its normals instead.
      if (!skin && vol < -0.05 * box && Math.abs(vol) > 0.02 * box) fail('winding', label, `inside out: signed volume ${vol.toExponential(2)} against a ${box.toExponential(2)} box`);
      if (nrm && !skin && counted > 20 && opposed / counted > 0.5 && !doubleSided) fail('winding', label, `${Math.round((opposed / counted) * 100)}% of triangles wind against their normals`);
      void W;

      if (skin) {
        const jn = prim.getAttribute('JOINTS_0'); const wt = prim.getAttribute('WEIGHTS_0');
        if (!jn || !wt) { fail('skin', label, 'skinned mesh without JOINTS_0 / WEIGHTS_0'); continue; }
        const nj = skin.listJoints().length;
        let badSum = 0; let badJoint = 0; let orphan = 0;
        for (let i = 0; i < jn.getCount(); i++) {
          const j = jn.getElement(i, []); const w = wt.getElement(i, []);
          const sum = w[0] + w[1] + w[2] + w[3];
          if (!(Math.abs(sum - 1) <= 0.02)) badSum++;
          for (let k = 0; k < 4; k++) if (w[k] > 0 && j[k] >= nj) badJoint++;
          if (sum < 0.5) orphan++;
        }
        if (badSum) fail('skin', label, `${badSum} of ${jn.getCount()} vertices with weights not summing to 1`);
        if (badJoint) fail('skin', label, `${badJoint} weights point past the skin's ${nj} joints`);
        if (orphan) fail('skin', label, `${orphan} vertices with no weight`);
        const ibm = skin.getInverseBindMatrices();
        if (ibm && ibm.getCount() !== nj) fail('skin', label, `inverse bind matrices ${ibm.getCount()} for ${nj} joints`);
        const joints = skin.listJoints();
        for (const j of joints) { if (!nodes.includes(j)) fail('skin', label, `joint ${j.getName()} is not in the scene`); }
      }
    }
  }

  // Stretch at rest and in the walk and sit poses.
  const clips = root.listAnimations();
  const skinned = skinNodes.filter((n) => n.getMesh().listPrimitives().some((p) => p.getAttribute('JOINTS_0')));
  let worst = { ratio: 1, clip: 'rest', mesh: '' };
  if (skinned.length) {
    const chosen = [];
    for (const re of POSES) {
      const hit = clips.find((c) => re.test(c.getName().split(/[|:]/).pop().trim()) && !chosen.includes(c));
      if (hit && chosen.length < 4) chosen.push(hit);
    }
    const walk = clips.find((c) => /walk/i.test(c.getName()) && !/pistol|back/i.test(c.getName()));
    if (walk && !chosen.includes(walk)) chosen.unshift(walk);
    const poses = [{ clip: null, t: 0, label: 'rest' }];
    for (const c of chosen) {
      const dur = Math.max(...c.listSamplers().map((s) => s.getInput().getArray().slice(-1)[0] ?? 0), 0);
      for (const f of [0.25, 0.5, 0.75]) poses.push({ clip: c, t: dur * f, label: c.getName() });
    }
    for (const n of skinned) {
      const skin = n.getSkin();
      const joints = skin.listJoints();
      const ibm = skin.getInverseBindMatrices();
      const IBM = joints.map((_, i) => Matrix.FromArray(ibm ? ibm.getElement(i, []) : Matrix.Identity().toArray()));
      for (const prim of n.getMesh().listPrimitives()) {
        const pos = prim.getAttribute('POSITION'); const jn = prim.getAttribute('JOINTS_0'); const wt = prim.getAttribute('WEIGHTS_0'); const ind = prim.getIndices();
        if (!pos || !jn || !wt || !ind) continue;
        const bind = []; const J = []; const Wt = [];
        for (let i = 0; i < pos.getCount(); i++) { bind.push(Vector3.FromArray(pos.getElement(i, []))); J.push(jn.getElement(i, [])); Wt.push(wt.getElement(i, [])); }
        // Unique edges; lengths are measured on the skinned rest pose (glTF skinning ignores the mesh node's transform).
        const arr = ind.getArray();
        const edges = new Map();
        for (let t = 0; t + 2 < arr.length; t += 3) for (let k = 0; k < 3; k++) {
          const a = arr[t + k]; const b = arr[t + (k + 1) % 3];
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          if (!edges.has(key)) edges.set(key, [a, b, 0]);
        }
        const list = [...edges.values()];
        const skinnedAt = (pose) => {
          const worldOf = posedLocals(doc, pose.clip, pose.t);
          const skinM = joints.map((j, i) => IBM[i].multiply(worldOf(j)));
          return bind.map((v, i) => {
            const p = new Vector3(0, 0, 0);
            for (let k = 0; k < 4; k++) if (Wt[i][k] > 0) p.addInPlace(Vector3.TransformCoordinates(v, skinM[J[i][k]]).scale(Wt[i][k]));
            return p;
          });
        };
        const rest = skinnedAt(poses[0]);
        const edgeList = [];
        for (const [a, b] of list) { const d = Vector3.Distance(rest[a], rest[b]); if (d >= MIN_EDGE) edgeList.push([a, b, d]); }
        for (const pose of poses) {
          const out = skinnedAt(pose);
          if (out.some((p) => !Number.isFinite(p.x + p.y + p.z))) { fail('stretch', n.getName(), `${pose.label}: non-finite skinned vertex`); continue; }
          let bad = 0; let top = 1;
          for (const [a, b, d] of edgeList) {
            const r = Vector3.Distance(out[a], out[b]) / d;
            if (r > STRETCH) bad++;
            top = Math.max(top, r);
          }
          if (top > worst.ratio) worst = { ratio: top, clip: pose.label, mesh: n.getName() };
          if (bad) fail('stretch', n.getName(), `${pose.label}: ${bad} of ${edgeList.length} edges stretched past ${STRETCH}x (worst ${top.toFixed(1)}x)`);
        }
      }
    }
  }
  return { name, prims, verts, skins: skins.size, clips: clips.length, worstStretch: +worst.ratio.toFixed(2), worstAt: worst.ratio > 1 ? `${worst.clip}/${worst.mesh}` : 'rest', fails, notes };
};

const report = [];
for (const f of files) {
  try { report.push(await audit(f)); } catch (error) { report.push({ name: path.basename(f), fails: [{ rule: 'read', what: path.basename(f), detail: String(error?.message ?? error) }] }); }
}
const failed = report.reduce((n, r) => n + r.fails.length, 0);
if (asJson) console.log(JSON.stringify({ models: report.length, failures: failed, report }, null, 1));
else {
  for (const r of report) {
    console.log(`${r.name}: ${r.fails.length ? `${r.fails.length} failure(s)` : 'ok'}${r.prims != null ? ` (${r.prims} prims, ${r.verts} verts${r.skins ? `, ${r.skins} skin, stretch ${r.worstStretch}x` : ''})` : ''}`);
    for (const f of r.fails) console.log(`  ${f.rule.padEnd(8)} ${f.what}: ${f.detail}`);
  }
  console.log(failed ? `model audit: FAILED (${failed})` : `model audit: ${report.length} models, 0 failures`);
}
process.exit(failed ? 1 : 0);
