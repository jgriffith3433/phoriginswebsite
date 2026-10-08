import * as BABYLON from '@babylonjs/core';

import { applyGlassFlags, applyHologramLook, applyMaterialToMesh, isHologramAsset, parseUvScale, warmupMaterials } from './materials';
import { getAssetLibrary, loadGlbByAssetId, resolveModelPath } from './modelLoader';
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

const SCENE_ASSET_KINDS: SceneAssetKind[] = ['model', 'audio', 'texture', 'light', 'trigger', 'wall', 'pillar', 'ground'];

export const toSceneAssetKind = (value: string | undefined, fallback: SceneAssetKind = 'model'): SceneAssetKind =>
  SCENE_ASSET_KINDS.includes(value as SceneAssetKind) ? (value as SceneAssetKind) : fallback;

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
  /** Mixamo GLB used when this asset is an NpcSeat. */
  npcAssetId?: string;
  /** Library material id (e.g. mat-hall-wall). Textures load once and UV-tile from world size. */
  materialId?: string;
  /** Per-object Babylon/Unity tiling. When omitted, materials use tileMeters from the catalog. */
  uvScale?: [number, number];
  /** Alternate JSON form; prefer `uvScale`. */
  uScale?: number;
  vScale?: number;
  /** Point lights only. Omitted lights keep the default intensity, range, and white diffuse. */
  intensity?: number;
  range?: number;
  color?: [number, number, number];
  // Id of the parent scene asset. Transform fields are local to the parent.
  parentId?: string;
};

export type SceneTrigger = {
  id: string;
  /** enter_zone | checkpoint | cutscene | npc_exit | music (bgm) */
  type: string;
  label?: string;
  assetId?: string;
  position?: SceneVector3;
  x?: number;
  y?: number;
  z?: number;
  /** Music: { audio|path, radius, loop?, fadeSeconds? }. Others: { radius, cutscene? }. */
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
export const DEFAULT_SCENE_FILE_PATH = '/levels/apex-peak.json';

export const DEFAULT_SCENE_DATA: SceneData = {
  id: 'scene_default',
  name: 'Starter Arena',
  theme: 'Neon Drift',
  assets: [
    { id: 'scene_asset_0', assetId: 'structure-ground', kind: 'ground', name: 'Ground', x: 0, y: -0.5, z: 0, scale: { x: 90, y: 1, z: 90 }, components: ['Transform'] },
    { id: 'scene_asset_1', assetId: 'asset-ch33-hero', kind: 'model', name: 'Player', x: 0, y: 0, z: 0, components: ['Transform', 'Collider'] },
    { id: 'scene_asset_2', assetId: 'asset-rock-model', kind: 'model', name: 'Rock Cluster', x: 15, y: 0, z: 10, components: ['Transform'] },
    { id: 'scene_asset_3', assetId: 'asset-neon-drift-audio', kind: 'audio', name: 'Music Trigger', x: 0, y: 0, z: 0, components: ['AudioSource'] },
  ],
  triggers: [
    { id: 'trigger_1', type: 'enter_zone', label: 'Spawn Gate', assetId: 'asset-ch33-hero', x: 0, y: 0, z: 0 },
    { id: 'trigger_2', type: 'checkpoint', label: 'Checkpoint A', assetId: 'asset-lantern-light', x: 10, y: 0, z: 4 },
  ],
};

const cloneDefaultScene = (): SceneData => JSON.parse(JSON.stringify(DEFAULT_SCENE_DATA));

const parseSceneData = (parsed: unknown): SceneData => {
  const data = (parsed && typeof parsed === 'object' ? parsed : {}) as Partial<SceneData>;
  return {
    ...cloneDefaultScene(),
    ...data,
    assets: Array.isArray(data.assets) ? data.assets : DEFAULT_SCENE_DATA.assets,
    triggers: Array.isArray(data.triggers) ? data.triggers : DEFAULT_SCENE_DATA.triggers,
  };
};

const normalizeVector = (vector?: SceneVector3 | null, fallbackX = 0, fallbackY = 0, fallbackZ = 0): BABYLON.Vector3 => {
  const x = vector?.x ?? fallbackX;
  const y = vector?.y ?? fallbackY;
  const z = vector?.z ?? fallbackZ;
  return new BABYLON.Vector3(x, y, z);
};

export const readSceneData = (): SceneData => {
  if (typeof localStorage === 'undefined') return cloneDefaultScene();

  try {
    const raw = localStorage.getItem(SCENE_DATA_KEY);
    if (!raw) {
      localStorage.setItem(SCENE_DATA_KEY, JSON.stringify(DEFAULT_SCENE_DATA));
      return cloneDefaultScene();
    }
    return parseSceneData(JSON.parse(raw));
  } catch {
    return cloneDefaultScene();
  }
};

export const writeSceneData = (sceneData: SceneData) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SCENE_DATA_KEY, JSON.stringify(sceneData));
  }
};

export type LoadSceneOptions = {
  omitAssetIds?: Iterable<string>;
  replaceNodes?: BABYLON.Node[];
  hideTriggers?: boolean;
};

export type LoadedJsonScene = {
  data: SceneData;
  nodes: BABYLON.Node[];
};

export const loadSceneFromJsonFile = async (
  scene: BABYLON.Scene,
  path = DEFAULT_SCENE_FILE_PATH,
  options?: LoadSceneOptions,
): Promise<LoadedJsonScene | null> => {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) return null;
    const nextScene = parseSceneData(await response.json());
    writeSceneData(nextScene);
    options?.replaceNodes?.forEach((node) => {
      if (!node.isDisposed()) node.dispose();
    });
    const nodes = loadSceneFromJson(scene, nextScene, options);
    return { data: nextScene, nodes };
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
  animationGroups?: string[];
  clipGroups?: BABYLON.AnimationGroup[];
  modelPath?: string;
  liftTexture?: BABYLON.DynamicTexture;
  liftLabel?: string;
  materialId?: string;
  assetKind?: SceneAssetKind;
  uvScale?: [number, number];
};

const LIFT_GLYPH_FOR_ID: Record<string, string> = {
  'lift-ind-down': '▼',
  'lift-ind-58': '58',
  'lift-ind-40': '40',
  'lift-ind-20': '20',
  'lift-ind-L': 'L',
  'lift-ind-B1': 'B1',
  'lift-ind-B2': 'B2',
  'lift-ind-B3': 'B3',
  'lift-ind-readout': '58',
};

export const paintLiftGlyph = (mesh: BABYLON.AbstractMesh | null | undefined, text: string, fill = '#f4f7fb') => {
  const texture = (mesh?.metadata as SceneNodeMetadata | undefined)?.liftTexture;
  if (!texture) return;
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const { width, height } = texture.getSize();
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = fill;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = text.length > 2 ? Math.floor(height * 0.5) : Math.floor(height * 0.64);
  ctx.font = `700 ${size}px Consolas, "Courier New", monospace`;
  // Plane faces the cab (yaw 180). Flip the bitmap so glyphs read LTR from Pierce.
  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.fillText(text, width / 2, height / 2 + Math.floor(height * 0.04));
  ctx.restore();
  texture.update();
};

const B3_SIGN_COLOR: Record<string, string> = {
  'b3-sign-basement': '#9ae8ff',
  'b3-sign-containment': '#9dff78',
  'b3-sign-acid': '#c6ff4a',
  'b3-sign-decon': '#ffd27a',
  'b3-sign-chem': '#ffb45a',
  'b3-sign-control': '#b7dcff',
  'b3-sign-transform': '#e0c2ff',
  'b3-sign-utility': '#ffbf86',
  'b3-sign-sealed': '#ff5a4a',
  'b3-sign-sector': '#d5dde6',
};

const createStencilSign = (
  scene: BABYLON.Scene,
  asset: SceneAssetInstance,
  position: BABYLON.Vector3,
  rotation: BABYLON.Vector3,
  scale: BABYLON.Vector3,
  metadata: SceneNodeMetadata,
): BABYLON.Mesh => {
  const plane = BABYLON.MeshBuilder.CreatePlane(asset.name ?? asset.id, { width: 1, height: 1 }, scene);
  plane.position = position;
  plane.rotation = rotation.clone();
  plane.scaling = new BABYLON.Vector3(Math.max(0.04, Math.abs(scale.x)), Math.max(0.04, scale.y), 1);
  const label = (asset.name ?? 'B3').toUpperCase();
  const texture = new BABYLON.DynamicTexture(
    `${asset.id}-tex`,
    { width: 1024, height: 256 },
    scene,
    false,
    BABYLON.Texture.BILINEAR_SAMPLINGMODE,
    BABYLON.Engine.TEXTUREFORMAT_RGBA,
    false,
  );
  texture.hasAlpha = false;
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const { width, height } = texture.getSize();
  ctx.fillStyle = '#07090c';
  ctx.fillRect(0, 0, width, height);
  const fill = B3_SIGN_COLOR[asset.id] ?? '#9ae8ff';
  ctx.fillStyle = fill;
  ctx.fillRect(0, height - 18, width, 18);
  ctx.fillRect(0, 0, 14, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = label.length > 16 ? 92 : label.length > 10 ? 118 : 148;
  ctx.font = `700 ${size}px Consolas, "Courier New", monospace`;
  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.fillText(label, width / 2, height / 2 - 6);
  ctx.restore();
  texture.update();
  const material = new BABYLON.StandardMaterial(`${asset.id}-mat`, scene);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.specularColor = BABYLON.Color3.Black();
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.diffuseColor = BABYLON.Color3.White();
  material.emissiveColor = BABYLON.Color3.White();
  plane.material = material;
  plane.checkCollisions = false;
  plane.metadata = { ...metadata, liftTexture: texture, liftLabel: label };
  return plane;
};

const createLiftGlyphMesh = (
  scene: BABYLON.Scene,
  asset: SceneAssetInstance,
  position: BABYLON.Vector3,
  rotation: BABYLON.Vector3,
  scale: BABYLON.Vector3,
  metadata: SceneNodeMetadata,
): BABYLON.Mesh => {
  const plane = BABYLON.MeshBuilder.CreatePlane(asset.name ?? asset.id, { width: 1, height: 1 }, scene);
  plane.position = position;
  plane.rotation = rotation.clone();
  // Panel sits on the north cab wall (z≈23.44). Pierce/camera look +Z at it.
  // Yaw 180 so the plane faces the cab. Glyph bitmap is flipped in paintLiftGlyph.
  plane.rotation.y += Math.PI;
  plane.scaling = new BABYLON.Vector3(Math.max(0.04, Math.abs(scale.x)), Math.max(0.04, scale.y), 1);
  const label = LIFT_GLYPH_FOR_ID[asset.id] ?? asset.id.replace(/^lift-ind-/, '');
  const wide = asset.id === 'lift-ind-readout';
  const texture = new BABYLON.DynamicTexture(
    `${asset.id}-tex`,
    { width: wide ? 512 : 256, height: wide ? 256 : 256 },
    scene,
    false,
    BABYLON.Texture.BILINEAR_SAMPLINGMODE,
    BABYLON.Engine.TEXTUREFORMAT_RGBA,
    false,
  );
  texture.hasAlpha = false;
  const material = new BABYLON.StandardMaterial(`${asset.id}-mat`, scene);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.specularColor = BABYLON.Color3.Black();
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.diffuseColor = new BABYLON.Color3(0.2, 0.22, 0.24);
  material.emissiveColor = new BABYLON.Color3(0.08, 0.09, 0.1);
  plane.material = material;
  plane.checkCollisions = false;
  plane.metadata = { ...metadata, liftTexture: texture, liftLabel: label };
  paintLiftGlyph(plane, label);
  return plane;
};

/** Open a hole in the opaque wall behind city glass so the skybox shows through. */
const createWindowFrameWall = (
  scene: BABYLON.Scene,
  asset: SceneAssetInstance,
  position: BABYLON.Vector3,
  rotation: BABYLON.Vector3,
  scale: BABYLON.Vector3,
  metadata: SceneNodeMetadata,
  theme: ReturnType<typeof getSceneTheme>,
): BABYLON.TransformNode => {
  const root = new BABYLON.TransformNode(asset.name ?? asset.id, scene);
  root.position.copyFrom(position);
  root.rotation.copyFrom(rotation);
  root.metadata = metadata;

  const sx = Math.max(0.04, Math.abs(scale.x));
  const sy = Math.max(0.04, Math.abs(scale.y));
  const sz = Math.max(0.04, Math.abs(scale.z));
  const alongX = sx >= sz;
  const sill = 0.18;
  const lintel = 0.28;
  const jamb = 0.22;
  const openingH = Math.max(0.4, sy - sill - lintel);

  const makePart = (name: string, size: BABYLON.Vector3, local: BABYLON.Vector3) => {
    const mesh = BABYLON.MeshBuilder.CreateBox(name, { width: size.x, height: size.y, depth: size.z }, scene);
    mesh.parent = root;
    mesh.position.copyFrom(local);
    mesh.checkCollisions = true;
    mesh.metadata = metadata;
    const material = new BABYLON.StandardMaterial(`${name}-mat`, scene);
    material.diffuseColor = theme.wall;
    material.emissiveColor = theme.wall.scale(0.22);
    mesh.material = material;
    applyMaterialToMesh(scene, mesh, { ...asset, id: name });
    return mesh;
  };

  if (alongX) {
    makePart(`${asset.id}-sill`, new BABYLON.Vector3(sx, sill, sz), new BABYLON.Vector3(0, -sy / 2 + sill / 2, 0));
    makePart(`${asset.id}-lintel`, new BABYLON.Vector3(sx, lintel, sz), new BABYLON.Vector3(0, sy / 2 - lintel / 2, 0));
    makePart(`${asset.id}-jamb-l`, new BABYLON.Vector3(jamb, openingH, sz), new BABYLON.Vector3(-sx / 2 + jamb / 2, (sill - lintel) / 2, 0));
    makePart(`${asset.id}-jamb-r`, new BABYLON.Vector3(jamb, openingH, sz), new BABYLON.Vector3(sx / 2 - jamb / 2, (sill - lintel) / 2, 0));
  } else {
    makePart(`${asset.id}-sill`, new BABYLON.Vector3(sx, sill, sz), new BABYLON.Vector3(0, -sy / 2 + sill / 2, 0));
    makePart(`${asset.id}-lintel`, new BABYLON.Vector3(sx, lintel, sz), new BABYLON.Vector3(0, sy / 2 - lintel / 2, 0));
    makePart(`${asset.id}-jamb-l`, new BABYLON.Vector3(sx, openingH, jamb), new BABYLON.Vector3(0, (sill - lintel) / 2, -sz / 2 + jamb / 2));
    makePart(`${asset.id}-jamb-r`, new BABYLON.Vector3(sx, openingH, jamb), new BABYLON.Vector3(0, (sill - lintel) / 2, sz / 2 - jamb / 2));
  }
  return root;
};

const isJumpOnFurniture = (asset: SceneAssetInstance) => {
  const label = `${asset.id} ${asset.name ?? ''}`.toLowerCase();
  return label.includes('desk') || label.includes('table');
};

/** Thin top-face collider with world scale 1 so ellipsoid landing is not eaten by parent scale. */
const attachFurnitureTopCollider = (scene: BABYLON.Scene, mesh: BABYLON.Mesh, scale: BABYLON.Vector3) => {
  const thickness = 0.18;
  const sx = Math.max(Math.abs(scale.x), 0.01);
  const sy = Math.max(Math.abs(scale.y), 0.01);
  const sz = Math.max(Math.abs(scale.z), 0.01);

  const pivot = new BABYLON.TransformNode(`${mesh.name}-col-pivot`, scene);
  pivot.parent = mesh;
  pivot.position.set(0, 0, 0);
  pivot.rotation.set(0, 0, 0);
  pivot.scaling.set(1 / sx, 1 / sy, 1 / sz);

  const top = BABYLON.MeshBuilder.CreateBox(`${mesh.name}-top-col`, {
    width: sx,
    height: thickness,
    depth: sz,
  }, scene);
  top.parent = pivot;
  top.position.set(0, sy / 2 - thickness / 2, 0);
  top.isVisible = false;
  top.isPickable = false;
  top.checkCollisions = true;
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

  const metadata: SceneNodeMetadata = {
    sceneAssetId: asset.id,
    materialId: asset.materialId,
    assetKind: kind,
    uvScale: parseUvScale(asset),
  };

  const finishMesh = (mesh: BABYLON.AbstractMesh): BABYLON.AbstractMesh => {
    applyMaterialToMesh(scene, mesh, asset);
    return mesh;
  };

  if (asset.id === 'lift-ind-panel') {
    const mesh = BABYLON.MeshBuilder.CreateBox(asset.name ?? asset.id, { width: 1, height: 1, depth: 1 }, scene);
    mesh.position = position;
    mesh.rotation = rotation;
    mesh.scaling = scale;
    const material = new BABYLON.StandardMaterial(`${asset.id}-mat`, scene);
    material.diffuseColor = new BABYLON.Color3(0.04, 0.05, 0.06);
    material.emissiveColor = new BABYLON.Color3(0.03, 0.04, 0.05);
    material.specularColor = BABYLON.Color3.Black();
    material.disableLighting = true;
    mesh.material = material;
    mesh.metadata = metadata;
    mesh.checkCollisions = false;
    return finishMesh(mesh);
  }

  if (asset.id.startsWith('lift-ind-')) {
    return createLiftGlyphMesh(scene, asset, position, rotation, scale, metadata);
  }

  if (asset.id.startsWith('b3-sign-')) {
    return createStencilSign(scene, asset, position, rotation, scale, metadata);
  }

  if (kind === 'light') {
    const light = new BABYLON.PointLight(
      asset.name ?? asset.assetId ?? 'sceneLight',
      position,
      scene,
    );
    light.intensity = asset.intensity ?? 0.46;
    light.range = asset.range ?? 14;
    if (asset.color) {
      light.diffuse = new BABYLON.Color3(asset.color[0], asset.color[1], asset.color[2]);
      light.specular = light.diffuse.scale(0.35);
    }
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
    mesh.isPickable = false;
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
    const isWindowGlass = asset.assetId === 'asset-window'
      || asset.id === 'board-glass'
      || asset.id === 'office-glass';
    if (isHologramAsset(asset)) {
      applyHologramLook(plane, material, 0.32);
    } else if (isWindowGlass) {
      applyGlassFlags(material, 0.72);
      plane.checkCollisions = true;
    }
    plane.material = material;
    plane.metadata = metadata;
    return finishMesh(plane);
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
    ground.checkCollisions = true;
    return finishMesh(ground);
  }

  if (kind === 'wall') {
    const theme = getSceneTheme(themeName);
    if (asset.id === 'board-glass-sill' || asset.id === 'office-wall-n') {
      return createWindowFrameWall(scene, asset, position, rotation, scale, metadata, theme);
    }
    const mesh = BABYLON.MeshBuilder.CreateBox(asset.name ?? asset.id, { width: 1, height: 1, depth: 1 }, scene);
    mesh.position = position;
    mesh.rotation = rotation;
    mesh.scaling = scale;
    const material = new BABYLON.StandardMaterial(`${asset.id}-mat`, scene);
    material.diffuseColor = theme.wall;
    material.emissiveColor = theme.wall.scale(0.22);
    mesh.material = material;
    mesh.metadata = metadata;
    const isChair = asset.id.startsWith('chair-') || Boolean(asset.components?.includes('NpcSeat'));
    const isLiftButton = asset.id === 'lift-b3-button';
    const isDecal = asset.id.startsWith('b3-decal-');
    const jumpOn = isJumpOnFurniture(asset);
    mesh.checkCollisions = !isChair && !isLiftButton && !jumpOn && !isDecal;
    if (isLiftButton) {
      material.diffuseColor = new BABYLON.Color3(0.18, 0.2, 0.22);
      material.emissiveColor = new BABYLON.Color3(0.08, 0.1, 0.12);
      material.specularColor = BABYLON.Color3.Black();
    }
    if (jumpOn) attachFurnitureTopCollider(scene, mesh, scale);
    return finishMesh(mesh);
  }

  if (kind === 'pillar') {
    const theme = getSceneTheme(themeName);
    const mesh = BABYLON.MeshBuilder.CreateCylinder(asset.name ?? asset.id, { height: 1, diameter: 1 }, scene);
    mesh.position = position;
    mesh.rotation = rotation;
    mesh.scaling = scale;
    const material = new BABYLON.StandardMaterial(`${asset.id}-mat`, scene);
    material.diffuseColor = theme.wall.scale(1.15);
    mesh.material = material;
    mesh.metadata = metadata;
    mesh.checkCollisions = true;
    if (asset.id === 'vat-acid' || asset.id.startsWith('b3-side-vat')) {
      material.diffuseColor = new BABYLON.Color3(0.1, 0.55, 0.16);
      material.emissiveColor = new BABYLON.Color3(0.12, 0.62, 0.16);
      material.specularColor = new BABYLON.Color3(0.25, 0.55, 0.22);
      mesh.checkCollisions = false;
    }
    if (asset.id === 'b3-creature' || asset.id.startsWith('b3-cage')) {
      material.diffuseColor = new BABYLON.Color3(0.04, 0.16, 0.05);
      material.emissiveColor = new BABYLON.Color3(0.05, 0.28, 0.06);
      material.disableLighting = true;
      mesh.checkCollisions = false;
    }
    if (asset.id === 'vat-glass') {
      applyGlassFlags(material, 0.28);
      mesh.checkCollisions = true;
    }
    return finishMesh(mesh);
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

  return finishMesh(mesh);
};

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

  void Promise.all([
    loadGlbByAssetId(scene, asset.assetId, root),
    getAssetLibrary().then((library) => resolveModelPath(library, asset.assetId) ?? ''),
  ]).then(([imported, modelPath]) => {
    if (!imported || root.isDisposed()) return;
    root.metadata = {
      ...root.metadata,
      animationGroups: imported.animationGroups.map((group) => group.name),
      clipGroups: imported.animationGroups,
      modelPath,
    } as SceneNodeMetadata;
  });

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
  marker.isPickable = false;
  return marker;
};

export const loadSceneFromJson = (
  scene: BABYLON.Scene,
  sceneData: SceneData,
  options?: LoadSceneOptions,
): BABYLON.Node[] => {
  void warmupMaterials(scene).then(() => {
    const assetsById = new Map(sceneData.assets.map((asset) => [asset.id, asset]));
    scene.meshes.forEach((mesh) => {
      const meta = mesh.metadata as SceneNodeMetadata | undefined;
      if (!meta?.materialId || !meta.sceneAssetId) return;
      const asset = assetsById.get(meta.sceneAssetId);
      applyMaterialToMesh(scene, mesh, asset ?? {
        id: meta.sceneAssetId,
        assetId: '',
        kind: meta.assetKind,
        materialId: meta.materialId,
        uvScale: meta.uvScale,
        scale: { x: mesh.scaling.x, y: mesh.scaling.y, z: mesh.scaling.z },
      });
    });
  });
  const omit = new Set(options?.omitAssetIds ?? []);
  const created: BABYLON.Node[] = [];
  const assetNodes = new Map<string, BABYLON.Node>();
  const pending: Array<{ node: BABYLON.Node; parentId?: string }> = [];
  sceneData.assets.forEach((asset) => {
    if (omit.has(asset.assetId)) return;
    const node = createSceneAssetNode(scene, asset, sceneData.theme);
    assetNodes.set(asset.id, node);
    pending.push({ node, parentId: asset.parentId });
    created.push(node);
  });
  sceneData.triggers.forEach((trigger) => {
    if (options?.hideTriggers) return;
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