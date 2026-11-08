/**
 * Node shims for running the game's scene code on Babylon's NullEngine (no browser): window, canvas 2D stubs,
 * fetch from the repo, the meshopt decoder from node_modules, and GLB reads from disk. Shared by the leak check
 * (tools/leakcheck/entry.ts) and the scene audit (tools/sceneaudit/entry.ts). Import it before any game module.
 */
import * as BABYLON from '@babylonjs/core';
import { readFileSync, existsSync } from 'node:fs';
export const ROOT = process.env.PHROOT ?? process.cwd();
const g = globalThis as any;
g.window = g; g.requestAnimationFrame = (f: () => void) => setTimeout(f, 1);
g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const fakeCtx: any = new Proxy(function () {}, {
  get: (_t, key) => (key === 'measureText' ? () => ({ width: 10 }) : key === 'canvas' ? fakeCanvas() : fakeCtx),
  apply: () => fakeCtx,
  set: () => true,
});
const fakeCanvas = (): any => ({ width: 64, height: 64, style: {}, getContext: () => fakeCtx, addEventListener() {}, removeEventListener() {} });
g.OffscreenCanvas = class { width: number; height: number; constructor(w: number, h: number) { this.width = w; this.height = h; } getContext() { return fakeCtx; } };
g.document = { body: { dataset: { device: 'desktop' } }, createElement: () => fakeCanvas(), addEventListener() {}, removeEventListener() {} };
export const fileFor = (url: string) => ROOT + decodeURIComponent(url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]);
g.fetch = async (url: string) => {
  const path = fileFor(String(url));
  if (!existsSync(path)) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  const data = readFileSync(path);
  return { ok: true, status: 200, json: async () => JSON.parse(data.toString()), arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
};
// Compressed GLBs (EXT_meshopt_compression, tools/compress-models.mjs): the page loads meshoptimizer's decoder as
// a script; here it comes from node_modules.
const { MeshoptDecoder } = await import('meshoptimizer');
// Node has no Worker, which Babylon's decode path asks for: decode on this thread instead.
g.MeshoptDecoder = {
  ready: MeshoptDecoder.ready,
  supported: MeshoptDecoder.supported,
  useWorkers() {},
  decodeGltfBuffer: MeshoptDecoder.decodeGltfBuffer,
  async decodeGltfBufferAsync(count: number, stride: number, source: Uint8Array, mode: string, filter?: string) {
    const target = new Uint8Array(count * stride);
    MeshoptDecoder.decodeGltfBuffer(target, count, stride, source, mode as any, filter as any);
    return target;
  },
};
const loadScript = BABYLON.Tools.LoadBabylonScriptAsync.bind(BABYLON.Tools);
(BABYLON.Tools as any).LoadBabylonScriptAsync = (url: string) => (/meshopt_decoder/.test(url) ? Promise.resolve() : loadScript(url));

/** GLB imports read from disk (the loader's rootUrl + fileName is a site path). */
export const readGlbsFromDisk = () => {
  const orig = BABYLON.SceneLoader.LoadAssetContainerAsync.bind(BABYLON.SceneLoader);
  (BABYLON.SceneLoader as any).LoadAssetContainerAsync = (rootUrl: string, fileName: string, sc: BABYLON.Scene) => {
    const data = readFileSync(fileFor(rootUrl + fileName));
    return orig('', new Uint8Array(data), sc, undefined, '.glb');
  };
};
