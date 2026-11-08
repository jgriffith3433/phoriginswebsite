/**
 * Level reload leak check (Node, Babylon NullEngine; no browser). Loads level files through the game's own
 * loadSceneFromJsonFile the way loadMissionScene does (replaceNodes), waits for every GLB import to settle,
 * and prints the scene counts after each load, plus which names grew. Built and run by levelLeakCheck.mjs.
 * Counts must come back the same on a second load of the same level (a first visit may fill shared caches).
 */
import * as BABYLON from '@babylonjs/core';
import { readGlbsFromDisk } from './nodeEnv';
const { loadSceneFromJsonFile } = await import('../../src/game/sceneData');
const engine = new BABYLON.NullEngine();
const scene = new BABYLON.Scene(engine);
readGlbsFromDisk();
const counts = () => ({
  meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.length,
  skeletons: scene.skeletons.length, groups: scene.animationGroups.length, nodes: scene.transformNodes.length,
  geometries: scene.geometries.length, lights: scene.lights.length,
});
const settle = async () => {
  let last = ''; let same = 0;
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const now = JSON.stringify(counts());
    if (now === last) { if (++same > 20) return; } else { same = 0; last = now; }
  }
};
let nodes: BABYLON.Node[] = [];
let prev: any = null;
const seq = (process.argv[2] ?? '/levels/b3-basement.json').split(',');
for (let i = 0; i < Math.max(4, seq.length); i++) {
  const level = seq[i % seq.length];
  const loaded = await loadSceneFromJsonFile(scene, level, { replaceNodes: nodes, hideTriggers: true, omitAssetIds: new Set(['asset-ch33-hero']) });
  if (!loaded) throw new Error('no level');
  nodes = loaded.nodes;
  await settle();
  console.log(`load ${i + 1} ${level}`, JSON.stringify(counts()));
  const tally = (list: { name: string }[]) => { const m = new Map<string, number>(); for (const x of list) { const k = x.name.replace(/[0-9]+/g, '#'); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
  const t = tally(scene.textures as any); const mm = tally(scene.materials as any); const me = tally(scene.meshes as any);
  // Only a reload of the same level says what grew.
  if (prev && seq[(i - 1 + seq.length) % seq.length] === level) for (const [label, now, before] of [['tex', t, prev[0]], ['mat', mm, prev[1]], ['mesh', me, prev[2]]] as const) {
    const grown = [...now].filter(([k, v]) => v > (before.get(k) ?? 0)).map(([k, v]) => `${k}+${v - (before.get(k) ?? 0)}`);
    if (grown.length) console.log(`  grew ${label}:`, grown.slice(0, 25).join(' | '));
  }
  prev = [t, mm, me];
}
process.exit(0);
