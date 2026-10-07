import * as BABYLON from '@babylonjs/core';

import { getAssetLibrary, type AssetLibraryEntry } from './modelLoader';
import type { SceneAssetInstance, SceneAssetKind } from './sceneData';

const asFinitePositive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

/** Reads per-object UV tiling from `uvScale: [u, v]` or `uScale`/`vScale`. */
export const parseUvScale = (
  asset: Pick<SceneAssetInstance, 'uvScale' | 'uScale' | 'vScale'>,
): [number, number] | undefined => {
  if (Array.isArray(asset.uvScale) && asset.uvScale.length >= 2) {
    const u = asFinitePositive(Number(asset.uvScale[0]));
    const v = asFinitePositive(Number(asset.uvScale[1]));
    if (u !== undefined && v !== undefined) return [u, v];
  }
  const u = asFinitePositive(asset.uScale);
  const v = asFinitePositive(asset.vScale);
  if (u !== undefined && v !== undefined) return [u, v];
  return undefined;
};

export type MaterialDef = {
  id: string;
  name?: string;
  albedo: string;
  /** World meters per UV repeat when U/V are not set separately. */
  tileMeters?: number;
  /** World meters per U repeat (walls: longest face / corridor length). */
  uTileMeters?: number;
  /** World meters per V repeat (walls: next axis / height). */
  vTileMeters?: number;
  transparent?: boolean;
  alpha?: number;
  diffuse?: [number, number, number];
  emissive?: [number, number, number];
  specular?: [number, number, number];
  specularPower?: number;
  tags?: string[];
};

export type MaterialTile = { u: number; v: number };

const asPositive = (value: unknown): number | undefined =>
  typeof value === 'number' && value > 0 ? value : undefined;

const clampTile = (value: number | undefined, fallback: number) =>
  Math.max(0.2, value ?? fallback);

export const tileMetersForDef = (def: Pick<MaterialDef, 'tileMeters' | 'uTileMeters' | 'vTileMeters'>): MaterialTile => {
  const base = clampTile(def.tileMeters, 2);
  return {
    u: clampTile(def.uTileMeters, base),
    v: clampTile(def.vTileMeters, base),
  };
};

type Catalog = {
  byId: Map<string, MaterialDef>;
};

const catalogs = new WeakMap<BABYLON.Scene, Catalog>();
const textureCache = new WeakMap<BABYLON.Scene, Map<string, BABYLON.Texture>>();
let catalogPromise: Promise<Map<string, MaterialDef>> | null = null;

const color = (rgb: [number, number, number] | undefined, fallback: BABYLON.Color3) =>
  rgb ? new BABYLON.Color3(rgb[0], rgb[1], rgb[2]) : fallback;

const loadCatalog = async (): Promise<Map<string, MaterialDef>> => {
  if (!catalogPromise) {
    catalogPromise = fetch('/assets/textures/materials.json', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { materials: [] }))
      .then(async (json) => {
        const byId = new Map<string, MaterialDef>();
        const listed = Array.isArray(json?.materials) ? json.materials as MaterialDef[] : [];
        listed.forEach((mat) => {
          if (mat?.id) byId.set(mat.id, mat);
        });
        const library = await getAssetLibrary();
        library
          .filter((entry: AssetLibraryEntry) => entry.type === 'material' && entry.id && entry.path)
          .forEach((entry) => {
            if (byId.has(entry.id)) return;
            const lib = entry as AssetLibraryEntry & MaterialDef;
            byId.set(entry.id, {
              id: entry.id,
              name: entry.name,
              albedo: entry.path,
              tileMeters: asPositive(lib.tileMeters) ?? 2,
              uTileMeters: asPositive(lib.uTileMeters),
              vTileMeters: asPositive(lib.vTileMeters),
            });
          });
        return byId;
      })
      .catch(() => new Map());
  }
  return catalogPromise;
};

export const invalidateMaterials = () => {
  catalogPromise = null;
};

export const warmupMaterials = async (scene: BABYLON.Scene) => {
  const byId = await loadCatalog();
  catalogs.set(scene, { byId });
  return byId;
};

export const getMaterialDefs = async (): Promise<MaterialDef[]> => {
  const byId = await loadCatalog();
  return [...byId.values()].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
};

const cachedTexture = (scene: BABYLON.Scene, url: string): BABYLON.Texture => {
  let map = textureCache.get(scene);
  if (!map) {
    map = new Map();
    textureCache.set(scene, map);
  }
  const existing = map.get(url);
  if (existing) return existing;
  const texture = new BABYLON.Texture(
    url,
    scene,
    false,
    true,
    BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
  );
  texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  map.set(url, texture);
  return texture;
};

const worldAxes = (scale: { x: number; y: number; z: number }) => ({
  x: Math.max(0.04, Math.abs(scale.x)),
  y: Math.max(0.04, Math.abs(scale.y)),
  z: Math.max(0.04, Math.abs(scale.z)),
});

export const tileScalesForMesh = (
  kind: SceneAssetKind | undefined,
  scale: { x: number; y: number; z: number },
  tileMeters: number | MaterialTile,
): { u: number; v: number } => {
  const tiles: MaterialTile = typeof tileMeters === 'number'
    ? { u: Math.max(0.2, tileMeters), v: Math.max(0.2, tileMeters) }
    : { u: Math.max(0.2, tileMeters.u), v: Math.max(0.2, tileMeters.v) };
  const { x, y, z } = worldAxes(scale);
  if (kind === 'ground') {
    // Ground UVs are X→U, Z→V. Put the larger tile on the longer axis so
    // a corridor stretch applies in both hall orientations.
    const along = Math.max(tiles.u, tiles.v);
    const across = Math.min(tiles.u, tiles.v);
    return {
      u: x / (x >= z ? along : across),
      v: z / (z >= x ? along : across),
    };
  }
  if (kind === 'texture') {
    return { u: x / tiles.u, v: y / tiles.v };
  }
  if (kind === 'pillar') {
    const diameter = Math.max(x, z);
    return { u: (Math.PI * diameter) / tiles.u, v: y / tiles.v };
  }
  const ranked = [x, y, z].sort((a, b) => b - a);
  return { u: ranked[0] / tiles.u, v: ranked[1] / tiles.v };
};

export const resolveMeshUvScale = (
  asset: SceneAssetInstance,
  scale: { x: number; y: number; z: number },
  def: Pick<MaterialDef, 'tileMeters' | 'uTileMeters' | 'vTileMeters'>,
): { u: number; v: number } => {
  const override = parseUvScale(asset);
  if (override) {
    return { u: Math.max(0.01, override[0]), v: Math.max(0.01, override[1]) };
  }
  const tile = tileScalesForMesh(asset.kind ?? asset.type, scale, tileMetersForDef(def));
  return { u: Math.max(0.25, tile.u), v: Math.max(0.25, tile.v) };
};

export const isHologramAsset = (asset: SceneAssetInstance) =>
  asset.id === 'board-hologram'
  || asset.assetId === 'asset-hologram'
  || (asset.name ?? '').toLowerCase().includes('hologram');

const isWindowGlassAsset = (asset: SceneAssetInstance) =>
  asset.assetId === 'asset-window'
  || asset.id === 'board-glass'
  || asset.id === 'office-glass';

const isGlassAsset = (asset: SceneAssetInstance) =>
  isWindowGlassAsset(asset) || isHologramAsset(asset);

export const applyMaterialToMesh = (
  scene: BABYLON.Scene,
  mesh: BABYLON.AbstractMesh,
  asset: SceneAssetInstance,
) => {
  const materialId = asset.materialId;
  if (!materialId) {
    if (mesh.material instanceof BABYLON.StandardMaterial) {
      if (isHologramAsset(asset)) applyHologramLook(mesh, mesh.material);
      else if (isGlassAsset(asset)) applyGlassFlags(mesh.material);
    }
    return;
  }

  const def = catalogs.get(scene)?.byId.get(materialId);
  if (!def?.albedo) {
    void loadCatalog().then((byId) => {
      catalogs.set(scene, { byId });
      if (byId.has(materialId) && !mesh.isDisposed()) applyMaterialToMesh(scene, mesh, asset);
    });
    return;
  }

  const scale = {
    x: asset.scale?.x ?? mesh.scaling.x,
    y: asset.scale?.y ?? mesh.scaling.y,
    z: asset.scale?.z ?? mesh.scaling.z,
  };
  const tile = resolveMeshUvScale(asset, scale, def);
  // Clone per mesh so uScale/vScale never leak across objects that share materialId.
  const albedo = cachedTexture(scene, def.albedo).clone();
  albedo.name = `${asset.id}:${materialId}:albedo`;
  albedo.uScale = tile.u;
  albedo.vScale = tile.v;
  albedo.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  albedo.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;

  const uniqueName = `${asset.id}-mat`;
  let material: BABYLON.StandardMaterial;
  if (mesh.material instanceof BABYLON.StandardMaterial && mesh.material.name === uniqueName) {
    material = mesh.material;
  } else if (mesh.material instanceof BABYLON.StandardMaterial) {
    material = mesh.material.clone(uniqueName) ?? new BABYLON.StandardMaterial(uniqueName, scene);
  } else {
    material = new BABYLON.StandardMaterial(uniqueName, scene);
  }
  if (isHologramAsset(asset)) {
    applyHologramLook(mesh, material, def.alpha ?? 0.32);
    mesh.material = material;
    return;
  }
  if (isWindowGlassAsset(asset)) {
    material.diffuseTexture = null;
    material.diffuseColor = new BABYLON.Color3(0.06, 0.1, 0.14);
    material.emissiveColor = new BABYLON.Color3(0.01, 0.016, 0.024);
    material.specularColor = color(def.specular, new BABYLON.Color3(0.32, 0.34, 0.38));
    material.specularPower = def.specularPower ?? 64;
    applyGlassFlags(material, Math.min(def.alpha ?? 0.22, 0.26));
    mesh.renderingGroupId = 0;
    mesh.material = material;
    mesh.checkCollisions = true;
    return;
  }
  material.diffuseTexture = albedo;
  material.diffuseColor = color(def.diffuse, BABYLON.Color3.White());
  material.emissiveColor = color(def.emissive, new BABYLON.Color3(0.03, 0.03, 0.035));
  material.specularColor = color(def.specular, new BABYLON.Color3(0.12, 0.12, 0.14));
  material.specularPower = def.specularPower ?? 24;
  if (def.transparent || isGlassAsset(asset)) {
    applyGlassFlags(material, def.alpha ?? 0.72);
    mesh.renderingGroupId = 0;
  }
  mesh.material = material;
};

/** Cyan hologram: alpha blend, no depth write, unlit, same group as walls. */
export const applyHologramLook = (
  mesh: BABYLON.AbstractMesh,
  material: BABYLON.StandardMaterial,
  alpha = 0.32,
) => {
  material.diffuseTexture = null;
  material.opacityTexture = null;
  material.emissiveTexture = null;
  material.diffuseColor = new BABYLON.Color3(0.18, 0.62, 0.92);
  material.emissiveColor = new BABYLON.Color3(0.08, 0.38, 0.58);
  material.specularColor = BABYLON.Color3.Black();
  material.specularPower = 8;
  material.disableLighting = true;
  applyGlassFlags(material, alpha);
  mesh.renderingGroupId = 0;
  mesh.checkCollisions = false;
};

export const applyGlassFlags = (material: BABYLON.StandardMaterial, alpha = 0.72) => {
  material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
  material.alphaMode = BABYLON.Engine.ALPHA_COMBINE;
  material.alpha = alpha;
  material.disableDepthWrite = true;
  material.forceDepthWrite = false;
  material.needDepthPrePass = false;
  material.backFaceCulling = false;
  material.useAlphaFromDiffuseTexture = false;
  material.separateCullingPass = false;
};
