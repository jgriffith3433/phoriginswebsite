// Measures the Mixamo locomotion clips the game matches to physics (quality rule 5):
//   planted-foot speed of Walk / Run / PistolWalk, and the takeoff and touchdown times of Jump / PistolJump.
// `npm run models:stride` prints them for the hero and NPC rigs; `--check` fails when src/game/stride.ts
// no longer matches the player rig (a new hero model or re-exported clips), so feet would slide again.
import { readFileSync, readdirSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const check = process.argv.includes('--check');
const PLAYER = 'assets/models/pierce.glb';

const sample = (sampler, t, size) => {
  const inp = sampler.getInput().getArray();
  const out = sampler.getOutput().getArray();
  let i = 0;
  while (i < inp.length - 1 && inp[i + 1] < t) i++;
  const j = Math.min(i + 1, inp.length - 1);
  const f = j === i ? 0 : Math.max(0, Math.min(1, (t - inp[i]) / (inp[j] - inp[i])));
  const a = Array.from(out.slice(i * size, i * size + size));
  const b = Array.from(out.slice(j * size, j * size + size));
  if (size === 4) return Quaternion.Slerp(Quaternion.FromArray(a), Quaternion.FromArray(b), f).asArray();
  return a.map((v, k) => v + (b[k] - v) * f);
};

const measure = async (file) => {
  const root = (await io.read(file)).getRoot();
  const parentOf = new Map();
  const walk = (n, p) => { parentOf.set(n, p); n.listChildren().forEach((c) => walk(c, n)); };
  root.listScenes()[0].listChildren().forEach((c) => walk(c, null));
  const joint = (tail) => root.listNodes().find((n) => n.getName().endsWith(`:${tail}`) || n.getName() === tail);
  const clip = (name) => {
    const anim = root.listAnimations().find((a) => a.getName() === name);
    if (!anim) return null;
    const channels = new Map();
    let duration = 0;
    for (const c of anim.listChannels()) {
      const n = c.getTargetNode();
      if (!channels.has(n)) channels.set(n, {});
      channels.get(n)[c.getTargetPath()] = c.getSampler();
      duration = Math.max(duration, c.getSampler().getInput().getArray().at(-1));
    }
    const world = (n, t) => {
      const c = channels.get(n) ?? {};
      const T = c.translation ? sample(c.translation, t, 3) : n.getTranslation();
      const R = c.rotation ? sample(c.rotation, t, 4) : n.getRotation();
      const S = c.scale ? sample(c.scale, t, 3) : n.getScale();
      let m = Matrix.Compose(Vector3.FromArray(S), Quaternion.FromArray(R), Vector3.FromArray(T));
      const p = parentOf.get(n);
      if (p) m = m.multiply(world(p, t));
      return m;
    };
    const at = (n, t) => Vector3.TransformCoordinates(Vector3.Zero(), world(n, t));
    return { duration, at };
  };
  const toes = ['LeftToeBase', 'RightToeBase'].map(joint).filter(Boolean);
  const result = { stride: {}, jump: {} };
  for (const [name, key] of [['Walk', 'walk'], ['Run', 'run'], ['PistolWalk', 'pistolwalk']]) {
    const c = clip(name);
    if (!c || !toes.length) continue;
    const speeds = toes.map((toe) => {
      const N = 200;
      const pts = Array.from({ length: N + 1 }, (_, i) => { const t = (c.duration * i) / N; const v = c.at(toe, t); return [v.x, v.y, v.z, t]; });
      const floor = Math.min(...pts.map((p) => p[1])) + 0.03;
      let dist = 0;
      let time = 0;
      for (let i = 1; i < pts.length; i++) {
        if (pts[i][1] < floor && pts[i - 1][1] < floor) {
          dist += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
          time += pts[i][3] - pts[i - 1][3];
        }
      }
      return time > 0 ? dist / time : 0;
    });
    result.stride[key] = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  }
  for (const [name, key] of [['Jump', 'jump'], ['PistolJump', 'pistoljump']]) {
    const c = clip(name);
    if (!c || !toes.length) continue;
    const lift = (t) => Math.min(...toes.map((toe) => c.at(toe, t).y));
    const rest = lift(0);
    let takeoff = null;
    let touchdown = null;
    for (let t = 0; t <= c.duration; t += 0.01) {
      const up = lift(t) - rest > 0.08;
      if (up && takeoff === null) takeoff = t;
      if (!up && takeoff !== null && touchdown === null && t > takeoff + 0.1) touchdown = t;
    }
    result.jump[key] = { takeoff, touchdown };
  }
  return result;
};

const fmt = (r) => [
  ...Object.entries(r.stride).map(([k, v]) => `${k} ${v.toFixed(2)} m/s`),
  ...Object.entries(r.jump).map(([k, v]) => `${k} off ${v.takeoff?.toFixed(2)} s, down ${v.touchdown?.toFixed(2)} s`),
].join(', ');

if (!check) {
  const files = [PLAYER, 'assets/models/ch44-hero.glb', ...readdirSync('assets/models').filter((f) => /^ch\d+-npc\.glb$/.test(f)).map((f) => `assets/models/${f}`)];
  for (const file of files) {
    try { console.log(file, fmt(await measure(file))); } catch (error) { console.log(file, 'unreadable:', String(error).split('\n')[0]); }
  }
} else {
  const src = readFileSync('src/game/stride.ts', 'utf8');
  const stride = Object.fromEntries([...src.match(/STRIDE_MPS[^{]*\{([^}]*)\}/)[1].matchAll(/(\w+):\s*([\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
  const keys = Object.fromEntries([...src.matchAll(/(\w+):\s*\[([\d.,\s]+)\]/g)].map((m) => [m[1], m[2].split(',').map(Number)]));
  const r = await measure(PLAYER);
  const problems = [];
  for (const [k, v] of Object.entries(r.stride)) {
    if (stride[k] && Math.abs(v - stride[k]) / stride[k] > 0.1) problems.push(`${k} clip moves ${v.toFixed(2)} m/s but stride.ts says ${stride[k]}`);
  }
  for (const [k, v] of Object.entries(r.jump)) {
    const want = keys[k];
    if (!want || v.takeoff === null) continue;
    // takeoff key (index 1) and touchdown key (index 3) within 0.12 s of where the toes leave and meet the floor
    if (Math.abs(v.takeoff - want[1]) > 0.12) problems.push(`${k} feet leave the floor at ${v.takeoff.toFixed(2)} s but JUMP_KEYS takeoff is ${want[1]}`);
    if (v.touchdown !== null && Math.abs(v.touchdown - want[3]) > 0.12) problems.push(`${k} feet land at ${v.touchdown.toFixed(2)} s but JUMP_KEYS touchdown is ${want[3]}`);
  }
  if (problems.length) {
    console.error(`clip stride check (${PLAYER}):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`clip stride: ${fmt(r)}`);
}
