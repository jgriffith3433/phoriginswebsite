import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders';

export const PLAYER_ASSET_ID = 'asset-ch44-hero';
export const PLAYER_ASSET_IDS = new Set([PLAYER_ASSET_ID, 'asset-hero-model']);

export type AssetLibraryEntry = {
  id: string;
  name: string;
  path: string;
  type: string;
  tags?: string[];
  source?: string;
};

export type ImportedModel = {
  meshes: BABYLON.AbstractMesh[];
  animationGroups: BABYLON.AnimationGroup[];
};

let assetLibraryPromise: Promise<AssetLibraryEntry[]> | null = null;

export const invalidateAssetLibrary = () => {
  assetLibraryPromise = null;
};

export const getAssetLibrary = (): Promise<AssetLibraryEntry[]> => {
  if (!assetLibraryPromise) {
    assetLibraryPromise = fetch('/assets/asset-library.json', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { assets: [] }))
      .then((json) => (Array.isArray(json?.assets) ? json.assets : []))
      .catch(() => []);
  }
  return assetLibraryPromise;
};

const normalizeAssetPath = (value: string): string => value.replace(/\\/g, '/').replace(/\/+/g, '/');

export const resolveLibraryEntry = (
  library: AssetLibraryEntry[],
  assetIdOrPath: string,
): AssetLibraryEntry | undefined => {
  const needle = normalizeAssetPath(assetIdOrPath);
  const fileName = needle.split('/').pop() ?? needle;
  return library.find((item) => item.id === assetIdOrPath)
    ?? library.find((item) => normalizeAssetPath(item.path) === needle)
    ?? library.find((item) => item.name === fileName)
    ?? library.find((item) => normalizeAssetPath(item.path).endsWith(`/${fileName}`));
};

export const resolveModelPath = (library: AssetLibraryEntry[], assetIdOrPath: string): string | null => {
  const entry = resolveLibraryEntry(library, assetIdOrPath);
  if (entry?.path) return entry.path;
  const needle = normalizeAssetPath(assetIdOrPath);
  if (!/\.(glb|gltf)$/i.test(needle)) return null;
  return needle.startsWith('/') ? needle : `/${needle}`;
};

const splitModelUrl = (modelPath: string): { rootUrl: string; fileName: string } => {
  const normalized = normalizeAssetPath(modelPath);
  const lastSlash = normalized.lastIndexOf('/');
  return {
    rootUrl: lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : '/',
    fileName: lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized,
  };
};

const attachImportedRoots = (
  result: BABYLON.ISceneLoaderAsyncResult,
  parent: BABYLON.TransformNode,
) => {
  const candidates: BABYLON.Node[] = [...result.meshes, ...(result.transformNodes ?? [])];
  const roots = candidates.filter((node) => node !== parent && node.parent === null);
  const target = roots.length ? roots : candidates.filter((node) => node.name === '__root__');
  target.forEach((node) => {
    node.parent = parent;
  });
};

export const importGlbUnderParent = async (
  scene: BABYLON.Scene,
  modelPath: string,
  parent: BABYLON.TransformNode,
): Promise<ImportedModel> => {
  const { rootUrl, fileName } = splitModelUrl(modelPath);
  const result = await BABYLON.SceneLoader.ImportMeshAsync('', rootUrl, fileName, scene);
  if (parent.isDisposed()) {
    result.meshes.forEach((mesh) => mesh.dispose());
    result.animationGroups.forEach((group) => group.dispose());
    result.transformNodes.forEach((node) => node.dispose());
    return { meshes: [], animationGroups: [] };
  }
  attachImportedRoots(result, parent);
  result.animationGroups.forEach((group) => group.stop());
  return { meshes: result.meshes, animationGroups: result.animationGroups };
};

export const loadGlbByAssetId = async (
  scene: BABYLON.Scene,
  assetIdOrPath: string,
  parent: BABYLON.TransformNode,
): Promise<ImportedModel | null> => {
  const library = await getAssetLibrary();
  const modelPath = resolveModelPath(library, assetIdOrPath);
  if (!modelPath) {
    console.warn(`No GLB path found for "${assetIdOrPath}".`);
    return null;
  }
  try {
    return await importGlbUnderParent(scene, modelPath, parent);
  } catch (error) {
    console.warn(`Failed to load model "${modelPath}":`, error);
    return null;
  }
};
