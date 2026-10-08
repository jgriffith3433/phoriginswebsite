import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders';

/** glTF default is ALL — that starts PistolIdle/Aim with Idle and the last clip wins the bind pose. */
BABYLON.SceneLoader.OnPluginActivatedObservable.add((plugin) => {
  if (plugin.name !== 'gltf') return;
  const loader = plugin as { animationStartMode?: number };
  loader.animationStartMode = 0;
});

export const PLAYER_ASSET_ID = 'asset-ch33-hero';
export const PLAYER_ASSET_IDS = new Set([PLAYER_ASSET_ID, 'asset-hero-model']);
/** Reserved Mixamo mesh for Pierce after the God Complex transformation. Not the current player. */
export const TRANSFORM_HERO_ASSET_ID = 'asset-ch44-hero';

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
  skeletons: BABYLON.Skeleton[];
};

let assetLibraryPromise: Promise<AssetLibraryEntry[]> | null = null;
let instanceSeq = 0;
let importChain: Promise<unknown> = Promise.resolve();

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

/** Joint leaf after mixamorig / mixamorig7: — Hips, Spine, Spine1, … */
export const jointSuffix = (name: string): string => {
  const text = String(name);
  const mix = text.match(/mixamorig\d*:([^:]+)$/i);
  if (mix) return mix[1].toLowerCase();
  const colon = text.lastIndexOf(':');
  if (colon >= 0) return text.slice(colon + 1).toLowerCase();
  const parts = text.split('_');
  return (parts[parts.length - 1] || text).toLowerCase();
};

const clipLeaf = (name: string) => {
  const parts = name.split('_');
  return parts[parts.length - 1] ?? name;
};

/**
 * glTFLoader sets every material's maxSimultaneousLights to scene.lights.length
 * so "all lights" fit in one shader. B3 is the hemispheric, the sun, and 23
 * practicals (25). Each light is its own vertex uniform block, and this GPU's
 * GL_MAX_VERTEX_UNIFORM_BUFFERS is 12, so wall and character shaders fail to
 * compile (untextured, nearly black). Babylon's own default is 4; put it back.
 */
const MAX_SIMULTANEOUS_LIGHTS = 4;

export const capSimultaneousLights = (scene: BABYLON.Scene) => {
  for (const material of scene.materials) {
    const mat = material as BABYLON.Material & { maxSimultaneousLights?: number };
    if (typeof mat.maxSimultaneousLights !== 'number') continue;
    if (mat.maxSimultaneousLights > MAX_SIMULTANEOUS_LIGHTS) {
      mat.maxSimultaneousLights = MAX_SIMULTANEOUS_LIGHTS;
    }
  }
};

const enqueueImport = <T>(work: () => Promise<T>): Promise<T> => {
  const run = importChain.then(work, work);
  importChain = run.then(() => undefined, () => undefined);
  return run;
};

/** Graybox walls use StandardMaterial. Mixamo glTF PBR lands as metal + extra specular. */
const CHARACTER_MIN_ROUGHNESS = 0.82;

type SpecularLikePlugin = {
  name?: string;
  isEnabled?: boolean;
  specularWeight?: number;
  specularColor?: BABYLON.Color3;
};

const disablePbrSpecularPlugins = (material: BABYLON.PBRMaterial) => {
  const manager = material.pluginManager as
    | { plugins?: SpecularLikePlugin[]; getPlugin?: (name: string) => SpecularLikePlugin | null }
    | undefined;
  const found: SpecularLikePlugin[] = [];
  for (const name of ['PBRSpecular', 'Specular', 'KHR_materials_specular']) {
    const plugin = manager?.getPlugin?.(name);
    if (plugin) found.push(plugin);
  }
  for (const plugin of manager?.plugins ?? []) {
    if ((plugin.name ?? '').toLowerCase().includes('specular')) found.push(plugin);
  }
  const internal = (material as unknown as { _specularPlugin?: SpecularLikePlugin })._specularPlugin;
  if (internal) found.push(internal);
  for (const plugin of found) {
    plugin.isEnabled = false;
    if (typeof plugin.specularWeight === 'number') plugin.specularWeight = 0;
    plugin.specularColor?.set(0, 0, 0);
  }
};

/**
 * Force imported GLB materials to dielectric / matte without dropping albedo or normals.
 * Mixamo non-PBR FBX → Blender glTF writes metallicFactor 0.5 and KHR_materials_specular.
 */
export const applyMatteCharacterMaterials = (meshes: BABYLON.AbstractMesh[], extraMaterials: BABYLON.Material[] = []) => {
  const seen = new Set<BABYLON.Material>();
  const consider = (material: BABYLON.Material | null | undefined) => {
    if (!material || seen.has(material)) return;
    seen.add(material);
    if (material instanceof BABYLON.MultiMaterial) {
      for (const sub of material.subMaterials) consider(sub);
      return;
    }
    if (material instanceof BABYLON.PBRMaterial) {
      material.metallic = 0;
      material.roughness = Math.max(material.roughness ?? 1, CHARACTER_MIN_ROUGHNESS);
      material.useMetallnessFromMetallicTextureBlue = false;
      material.useRoughnessFromMetallicTextureGreen = false;
      material.useRoughnessFromMetallicTextureAlpha = false;
      material.environmentIntensity = 0;
      material.metallicF0Factor = 0;
      material.useRadianceOverAlpha = false;
      material.useSpecularOverAlpha = false;
      disablePbrSpecularPlugins(material);
      material.markAsDirty(BABYLON.Material.AllDirtyFlag);
      return;
    }
    if (material instanceof BABYLON.StandardMaterial) {
      material.specularColor = BABYLON.Color3.Black();
    }
  };
  for (const material of extraMaterials) consider(material);
  for (const mesh of meshes) consider(mesh.material);
};

/**
 * One fresh container per instance (no instantiate, no cache). Rename, then
 * retarget every TargetedAnimation onto THIS skeleton's linked joint node.
 * Never leave a clip pointed at a previous character's node.
 */
export const importGlbUnderParent = async (
  scene: BABYLON.Scene,
  modelPath: string,
  parent: BABYLON.TransformNode,
  options?: { matte?: boolean },
): Promise<ImportedModel> => {
  const { rootUrl, fileName } = splitModelUrl(modelPath);
  return enqueueImport(async () => {
    const container = await BABYLON.SceneLoader.LoadAssetContainerAsync(rootUrl, fileName, scene);
    capSimultaneousLights(scene);
    if (parent.isDisposed()) {
      container.dispose();
      return { meshes: [], animationGroups: [], skeletons: [] };
    }

    container.addAllToScene();
    if (options?.matte !== false) {
      applyMatteCharacterMaterials(container.meshes, container.materials);
    }

    const skeleton = container.skeletons[0] ?? null;
    const deformBySuffix = new Map<string, BABYLON.Node>();
    const boneBySuffix = new Map<string, BABYLON.Bone>();

    if (skeleton) {
      for (const bone of skeleton.bones) {
        const suffix = jointSuffix(bone.name);
        boneBySuffix.set(suffix, bone);
        const linked = bone.getTransformNode();
        // glTF Mixamo animates the linked joint node; the bone copies it for skinning.
        deformBySuffix.set(suffix, linked ?? bone);
      }
    }
    for (const node of [...container.transformNodes, ...container.meshes]) {
      const suffix = jointSuffix(node.name);
      if (!deformBySuffix.has(suffix)) deformBySuffix.set(suffix, node);
    }

    const prefix = `${parent.name}_${++instanceSeq}_`;
    for (const node of [...container.meshes, ...container.transformNodes, ...container.rootNodes]) {
      if (!node.name.startsWith(prefix)) node.name = `${prefix}${node.name}`;
    }
    if (skeleton) {
      skeleton.name = `${prefix}${skeleton.name}`;
      for (const bone of skeleton.bones) {
        if (!bone.name.startsWith(prefix)) bone.name = `${prefix}${bone.name}`;
      }
    }

    for (const group of container.animationGroups) {
      group.name = `${prefix}${clipLeaf(group.name)}`;
      const channels = [...group.targetedAnimations];
      for (const targeted of channels) {
        const targetName = targeted.target && typeof targeted.target === 'object' && 'name' in targeted.target
          ? String((targeted.target as { name: string }).name)
          : '';
        const suffix = jointSuffix(targetName);
        if (!suffix || suffix === 'root' || suffix === '__root__') continue;
        const deform = deformBySuffix.get(suffix);
        if (!deform) {
          group.removeTargetedAnimation(targeted.animation);
          continue;
        }
        targeted.target = deform;
      }
      group.stop(true);
    }

    for (const node of container.rootNodes) {
      node.parent = parent;
    }

    return {
      meshes: container.meshes.slice(),
      animationGroups: container.animationGroups.slice(),
      skeletons: container.skeletons.slice(),
    };
  });
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
