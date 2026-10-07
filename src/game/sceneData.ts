import * as BABYLON from '@babylonjs/core';

import { getSceneTheme } from './scene';

export type SceneVector3 = {
  x: number;
  y: number;
  z: number;
};

// 'wall'/'pillar'/'ground' are structural arena pieces. They used to be
// generated procedurally (not stored anywhere); now they're regular scene
// assets like everything else, so they show up in the Hierarchy and can be
// selected, moved, scaled, duplicated, and deleted like any other object.
export type SceneAssetKind = 'model' | 'audio' | 'texture' | 'light' | 'trigger' | 'wall' | 'pillar' | 'ground';

export type SceneAssetInstance = {
  id: string;
  assetId: string;
  kind?: SceneAssetKind;
  type?: SceneAssetKind;
  name?: string;
  x?: number;
  y?: number;
  z?: number;
  position?: SceneVector3;
  rotation?: SceneVector3;
  scale?: SceneVector3;
  components?: string[];
  // Id of the parent scene asset. Transform fields are local to the parent.
  parentId?: string;
};

export type SceneTrigger = {
  id: string;
  type: string;
  label?: string;
  assetId?: string;
  position?: SceneVector3;
  x?: number;
  y?: number;
  z?: number;
  data?: Record<string, unknown>;
  parentId?: string;
};

export type SceneData = {
  id: string;
  name: string;
  theme: string;
  assets: SceneAssetInstance[];
  triggers: SceneTrigger[];
};

export const SCENE_DATA_KEY = 'ph-origins-scene-editor';
export const DEFAULT_SCENE_FILE_PATH = '/levels/starter-arena.json';

export const DEFAULT_SCENE_DATA: SceneData = {
  id: 'scene_default',
  name: 'Starter Arena',
  theme: 'Neon Drift',
  assets: [
    { id: 'scene_asset_0', assetId: 'structure-ground', kind: 'ground', name: 'Ground', x: 0, y: -0.5, z: 0, scale: { x: 90, y: 1, z: 90 }, components: ['Transform'] },
    { id: 'scene_asset_1', assetId: 'asset-hero-model', kind: 'model', name: 'Player', x: 0, y: 0, z: 0, components: ['Transform', 'Collider'] },
    { id: 'scene_asset_2', assetId: 'asset-rock-model', kind: 'model', name: 'Rock Cluster', x: 15, y: 0, z: 10, components: ['Transform'] },
    { id: 'scene_asset_3', assetId: 'asset-neon-drift-audio', kind: 'audio', name: 'Music Trigger', x: 0, y: 0, z: 0, components: ['AudioSource'] },
  ],
  triggers: [
    { id: 'trigger_1', type: 'enter_zone', label: 'Spawn Gate', assetId: 'asset-hero-model', x: 0, y: 0, z: 0 },
    { id: 'trigger_2', type: 'checkpoint', label: 'Checkpoint A', assetId: 'asset-lantern-light', x: 10, y: 0, z: 4 },
  ],
};

const normalizeVector = (vector?: SceneVector3 | null, fallbackX = 0, fallbackY = 0, fallbackZ = 0): BABYLON.Vector3 => {
  const x = vector?.x ?? fallbackX;
  const y = vector?.y ?? fallbackY;
  const z = vector?.z ?? fallbackZ;
  return new BABYLON.Vector3(x, y, z);
};

export const readSceneData = (): SceneData => {
  if (typeof localStorage === 'undefined') return JSON.parse(JSON.stringify(DEFAULT_SCENE_DATA));

  try {
    const raw = localStorage.getItem(SCENE_DATA_KEY);
    if (!raw) {
      localStorage.setItem(SCENE_DATA_KEY, JSON.stringify(DEFAULT_SCENE_DATA));
      return JSON.parse(JSON.stringify(DEFAULT_SCENE_DATA));
    }

    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SCENE_DATA,
      ...parsed,
      assets: Array.isArray(parsed?.assets) ? parsed.assets : DEFAULT_SCENE_DATA.assets,
      triggers: Array.isArray(parsed?.triggers) ? parsed.triggers : DEFAULT_SCENE_DATA.triggers,
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_SCENE_DATA));
  }
};

export const writeSceneData = (sceneData: SceneData) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SCENE_DATA_KEY, JSON.stringify(sceneData));
  }
};

export const loadSceneFromJsonFile = async (scene: BABYLON.Scene, path = DEFAULT_SCENE_FILE_PATH): Promise<SceneData | null> => {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) return null;
    const parsed = await response.json();
    const nextScene: SceneData = {
      ...DEFAULT_SCENE_DATA,
      ...parsed,
      assets: Array.isArray(parsed?.assets) ? parsed.assets : DEFAULT_SCENE_DATA.assets,
      triggers: Array.isArray(parsed?.triggers) ? parsed.triggers : DEFAULT_SCENE_DATA.triggers,
    };
    writeSceneData(nextScene);
    loadSceneFromJson(scene, nextScene);
    return nextScene;
  } catch {
    return null;
  }
};

// Metadata tag placed on every node created from scene data so editor
// tooling (and anything else) can trace a Babylon node back to its JSON
// source entry without affecting game behavior.
export type SceneNodeMetadata = {
  sceneAssetId?: string;
  sceneTriggerId?: string;
  // Names of AnimationGroups loaded from a model's GLB, if any (populated
  // asynchronously once the model finishes loading).
  animationGroups?: string[];
};

// Builds (or rebuilds) the Babylon node for a single scene asset entry.
// Shared by the bulk scene loader and the level editor's drag-drop/placement
// flow so both stay in sync with exactly the same visual representation.
// `themeName` only affects ground-kind assets (tints them to match the
// level's theme, mirroring the old procedural arena look).
export const createSceneAssetNode = (scene: BABYLON.Scene, asset: SceneAssetInstance, themeName = 'Neon Drift'): BABYLON.Node => {
  const kind = asset.kind ?? asset.type ?? 'model';
  const position = normalizeVector(asset.position ?? null, asset.x ?? 0, asset.y ?? 0, asset.z ?? 0);
  const rotation = new BABYLON.Vector3(
    asset.rotation?.x ?? 0,
    asset.rotation?.y ?? 0,
    asset.rotation?.z ?? 0,
  );
  const scale = new BABYLON.Vector3(
    asset.scale?.x ?? 1,
    asset.scale?.y ?? 1,
    asset.scale?.z ?? 1,
  );

  const metadata: SceneNodeMetadata = { sceneAssetId: asset.id };

  if (kind === 'light') {
    const light = new BABYLON.PointLight(
      asset.name ?? asset.assetId ?? 'sceneLight',
      position,
      scene,
    );
    light.intensity = 0.8;
    light.range = 20;
    light.metadata = metadata;
    return light;
  }

  if (kind === 'audio') {
    const mesh = BABYLON.MeshBuilder.CreateSphere(asset.id, { diameter: 0.7 }, scene);
    mesh.position = position;
    mesh.rotation = rotation;
    mesh.scaling = scale;
    const material = new BABYLON.StandardMaterial(`${asset.id}-mat`, scene);
    material.diffuseColor = new BABYLON.Color3(0.9, 0.4, 1);
    material.emissiveColor = new BABYLON.Color3(0.45, 0.18, 0.5);
    mesh.material = material;
    mesh.metadata = metadata;
    return mesh;
  }

  if (kind === 'texture') {
    const plane = BABYLON.MeshBuilder.CreatePlane(`${asset.id}-plane`, { size: 1 }, scene);
    plane.position = position;
    plane.rotation = rotation;
    plane.scaling = scale;
    const material = new BABYLON.StandardMaterial(`${asset.id}-mat`, scene);
    material.diffuseColor = new BABYLON.Color3(0.7, 0.75, 1);
    material.emissiveColor = new BABYLON.Color3(0.12, 0.12, 0.18);
    plane.material = material;
    plane.metadata = metadata;
    return plane;
  }

  if (kind === 'ground') {
    // Base 1x1 ground plane, sized via `scale` (e.g. scale {90,1,90}) so the
    // Inspector's regular Scale fields/gizmo resize it like any other asset.
    const theme = getSceneTheme(themeName);
    const ground = BABYLON.MeshBuilder.CreateGround(asset.name ?? 'Ground', { width: 1, height: 1 }, scene);
    ground.position = position;
    ground.rotation = rotation;
    ground.scaling = scale;
    const material = new BABYLON.StandardMaterial(`${asset.id}-mat`, scene);
    material.diffuseColor = theme.ground;
    material.emissiveColor = theme.ground.scale(0.35);
    ground.material = material;
    ground.metadata = metadata;
    return ground;
  }

  if (kind === 'wall') {
    const mesh = BABYLON.MeshBuilder.CreateBox(asset.name ?? asset.id, { width: 1, height: 1, depth: 1 }, scene);
    mesh.position = position;
    mesh.rotation = rotation;
    mesh.scaling = scale;
    const material = new BABYLON.StandardMaterial(`${asset.id}-mat`, scene);
    material.diffuseColor = new BABYLON.Color3(0.2, 0.24, 0.32);
    material.emissiveColor = new BABYLON.Color3(0.06, 0.08, 0.1);
    mesh.material = material;
    mesh.metadata = metadata;
    return mesh;
  }

  if (kind === 'pillar') {
    const mesh = BABYLON.MeshBuilder.CreateCylinder(asset.name ?? asset.id, { height: 1, diameter: 1 }, scene);
    mesh.position = position;
    mesh.rotation = rotation;
    mesh.scaling = scale;
    const material = new BABYLON.StandardMaterial(`${asset.id}-mat`, scene);
    material.diffuseColor = new BABYLON.Color3(0.25, 0.28, 0.35);
    mesh.material = material;
    mesh.metadata = metadata;
    return mesh;
  }

  if (kind === 'model') {
    return createModelAssetNode(scene, asset, position, rotation, scale, metadata);
  }

  const mesh = BABYLON.MeshBuilder.CreateBox(
    asset.name ?? asset.assetId ?? asset.id,
    { width: 1.5, height: 1.5, depth: 1.5 },
    scene,
  );
  mesh.position = position;
  mesh.rotation = rotation;
  mesh.scaling = scale;

  const material = new BABYLON.StandardMaterial(`${asset.id}-mat`, scene);
  material.diffuseColor = kind === 'trigger'
    ? new BABYLON.Color3(0.9, 0.5, 0.2)
    : new BABYLON.Color3(0.55, 0.8, 1.0);
  material.emissiveColor = kind === 'trigger'
    ? new BABYLON.Color3(0.3, 0.15, 0.05)
    : new BABYLON.Color3(0.12, 0.18, 0.24);
  mesh.material = material;
  mesh.metadata = metadata;

  return mesh;
};

// Cached fetch of the project's asset library (assetId -> real file path).
// Shared by every 'model' node so we only hit the network once per session.
let assetLibraryPromise: Promise<AssetLibraryEntry[]> | null = null;
export const getAssetLibrary = (): Promise<AssetLibraryEntry[]> => {
  if (!assetLibraryPromise) {
    assetLibraryPromise = fetch('/assets/asset-library.json', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { assets: [] }))
      .then((json) => (Array.isArray(json?.assets) ? json.assets : []))
      .catch(() => []);
  }
  return assetLibraryPromise;
};

export type AssetLibraryEntry = {
  id: string;
  name: string;
  path: string;
  type: string;
  tags?: string[];
  source?: string;
};

// 'model' assets load a real GLB (via the project's asset library lookup)
// instead of a placeholder primitive. A TransformNode is returned
// synchronously -- carrying position/rotation/scale/metadata immediately so
// selection, the gizmo, and the Inspector all work right away -- and the
// actual mesh/skeleton/animations are parented under it once the async load
// resolves. If the GLB fails to load (missing file, bad path, etc.) a small
// placeholder box is shown instead so nothing is silently invisible.
const createModelAssetNode = (
  scene: BABYLON.Scene,
  asset: SceneAssetInstance,
  position: BABYLON.Vector3,
  rotation: BABYLON.Vector3,
  scale: BABYLON.Vector3,
  metadata: SceneNodeMetadata,
): BABYLON.TransformNode => {
  const root = new BABYLON.TransformNode(asset.name ?? asset.assetId ?? asset.id, scene);
  root.position = position;
  root.rotation = rotation;
  root.scaling = scale;
  root.metadata = metadata;

  const placeholder = BABYLON.MeshBuilder.CreateBox(`${asset.id}-placeholder`, { size: 1.2 }, scene);
  placeholder.parent = root;
  const placeholderMat = new BABYLON.StandardMaterial(`${asset.id}-placeholder-mat`, scene);
  placeholderMat.diffuseColor = new BABYLON.Color3(0.55, 0.8, 1.0);
  placeholderMat.emissiveColor = new BABYLON.Color3(0.12, 0.18, 0.24);
  placeholder.material = placeholderMat;

  void (async () => {
    const library = await getAssetLibrary();
    const entry = library.find((item) => item.id === asset.assetId);
    const modelPath = entry?.path;
    if (!modelPath) {
      return;
    }

    try {
      const lastSlash = modelPath.lastIndexOf('/');
      const rootUrl = modelPath.slice(0, lastSlash + 1);
      const fileName = modelPath.slice(lastSlash + 1);
      const result = await BABYLON.SceneLoader.ImportMeshAsync('', rootUrl, fileName, scene);
      if (root.isDisposed()) {
        result.meshes.forEach((mesh) => mesh.dispose());
        result.animationGroups.forEach((group) => group.dispose());
        return;
      }

      placeholder.dispose();
      result.meshes.forEach((mesh) => {
        if (mesh.parent === null) {
          mesh.parent = root;
        }
      });
      // Stop glTF animations from auto-playing on load; expose clip names so
      // the Inspector/game code can choose which one to play.
      result.animationGroups.forEach((group) => group.stop());
      root.metadata = {
        ...root.metadata,
        animationGroups: result.animationGroups.map((group) => group.name),
      } as SceneNodeMetadata;
      (root as unknown as { _phAnimationGroups?: BABYLON.AnimationGroup[] })._phAnimationGroups = result.animationGroups;
    } catch (error) {
      console.warn(`Failed to load model "${modelPath}" for asset ${asset.id}:`, error);
    }
  })();

  return root;
};

// Builds the Babylon node for a single trigger entry. See createSceneAssetNode.
export const createSceneTriggerNode = (scene: BABYLON.Scene, trigger: SceneTrigger): BABYLON.Node => {
  const position = normalizeVector(trigger.position ?? null, trigger.x ?? 0, trigger.y ?? 0, trigger.z ?? 0);
  const marker = BABYLON.MeshBuilder.CreateCylinder(`${trigger.id}-trigger`, { height: 0.8, diameter: 0.8 }, scene);
  marker.position = position;
  marker.material = new BABYLON.StandardMaterial(`${trigger.id}-mat`, scene);
  const triggerMat = marker.material as BABYLON.StandardMaterial;
  triggerMat.diffuseColor = new BABYLON.Color3(1, 0.7, 0.2);
  triggerMat.emissiveColor = new BABYLON.Color3(0.42, 0.2, 0.04);
  marker.metadata = { sceneTriggerId: trigger.id } as SceneNodeMetadata;
  return marker;
};

export const loadSceneFromJson = (scene: BABYLON.Scene, sceneData: SceneData): BABYLON.Node[] => {
  const created: BABYLON.Node[] = [];
  const assetNodes = new Map<string, BABYLON.Node>();
  const pending: Array<{ node: BABYLON.Node; parentId?: string }> = [];
  sceneData.assets.forEach((asset) => {
    const node = createSceneAssetNode(scene, asset, sceneData.theme);
    assetNodes.set(asset.id, node);
    pending.push({ node, parentId: asset.parentId });
    created.push(node);
  });
  sceneData.triggers.forEach((trigger) => {
    const node = createSceneTriggerNode(scene, trigger);
    pending.push({ node, parentId: trigger.parentId });
    created.push(node);
  });
  pending.forEach(({ node, parentId }) => {
    const parent = parentId ? assetNodes.get(parentId) : undefined;
    if (parent && parent !== node) node.parent = parent;
  });
  return created;
};