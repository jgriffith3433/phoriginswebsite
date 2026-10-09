import * as BABYLON from '@babylonjs/core';

import type { InventoryItemType } from './types';
import { applyGlassFlags, applyHologramLook, applyMaterialToMesh, isHologramAsset, parseUvScale, warmupMaterials } from './materials';
import { getAssetLibrary, loadGlbByAssetId, resolveModelPath } from './modelLoader';
import { findClip } from './playerAvatar';
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
  /** World pickup. The mesh stays until the player takes it and the stack has room. */
  pickup?: {
    item: InventoryItemType;
    amount?: number;
  };
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
  /** Hemispheric fill. Omitted levels use the theme intensity. */
  ambient?: number;
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
  const ambient = typeof data.ambient === 'number' && Number.isFinite(data.ambient) ? Math.max(0, data.ambient) : undefined;
  return {
    ...cloneDefaultScene(),
    ...data,
    ambient,
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
  pickup?: {
    item: InventoryItemType;
    amount: number;
  };
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
  'b3-sign-drip': '#7ec8ff',
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
  ctx.fillStyle = '#10141a';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 2;
  for (let y = 6; y < height; y += 7) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  const fill = B3_SIGN_COLOR[asset.id] ?? '#9ae8ff';
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, 16, height);
  ctx.fillRect(0, height - 8, width, 8);
  ctx.fillStyle = '#3c4652';
  for (const [x, y] of [[36, 32], [36, height - 32], [width - 36, 32], [width - 36, height - 32]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a2028';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3c4652';
  }
  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.fillStyle = fill;
  for (let i = 0; i < 3; i += 1) {
    const x = 56 + i * 26;
    ctx.beginPath();
    ctx.moveTo(x, 46);
    ctx.lineTo(x + 14, height / 2);
    ctx.lineTo(x, height - 36);
    ctx.lineTo(x - 8, height / 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.font = '600 26px Consolas, "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('SECTOR 4', 150, 42);
  ctx.fillStyle = '#e7eef6';
  ctx.textAlign = 'center';
  const size = label.length > 18 ? 58 : label.length > 12 ? 78 : 104;
  ctx.font = `700 ${size}px Consolas, "Courier New", monospace`;
  ctx.fillText(label, width / 2 + 36, height / 2 + 16);
  ctx.restore();
  texture.update();
  const material = new BABYLON.StandardMaterial(`${asset.id}-mat`, scene);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);
  material.backFaceCulling = false;
  material.diffuseColor = new BABYLON.Color3(0.22, 0.24, 0.26);
  material.emissiveColor = new BABYLON.Color3(0.72, 0.74, 0.76);
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

const SOLID_FURNITURE = new Set([
  'asset-office-chair',
  'asset-board-table',
  'asset-office-desk',
  'asset-office-terminal',
  'asset-lab-console',
  'asset-water-cooler',
  'asset-filing-cabinet',
  'asset-office-plant',
  'asset-office-door',
  'asset-credenza',
]);

/** Screens are a centimeter thick in the GLB. Thicken them so the capsule cannot step through. */
const MIN_COLLIDER_THICKNESS = 0.2;

const bindColliderMatrix = (root: BABYLON.TransformNode, box: BABYLON.Mesh) => {
  let refreshing = false;
  const refresh = () => {
    if (refreshing || box.isDisposed()) return;
    refreshing = true;
    box.computeWorldMatrix(true);
    refreshing = false;
  };
  refresh();
  root.onAfterWorldMatrixUpdateObservable.add(refresh);
};

const attachBoundsCollider = (scene: BABYLON.Scene, root: BABYLON.TransformNode, meshes: BABYLON.AbstractMesh[]) => {
  root.computeWorldMatrix(true);
  const toLocal = root.getWorldMatrix().clone();
  if (!toLocal.invert()) return;
  const min = new BABYLON.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const max = new BABYLON.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  let found = false;
  for (const mesh of meshes) {
    if (mesh.getTotalVertices() <= 0) continue;
    mesh.computeWorldMatrix(true);
    for (const world of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
      const local = BABYLON.Vector3.TransformCoordinates(world, toLocal);
      min.minimizeInPlace(local);
      max.maximizeInPlace(local);
      found = true;
    }
  }
  if (!found) return;
  const size = max.subtract(min);
  const center = min.add(max).scale(0.5);
  if (size.x < MIN_COLLIDER_THICKNESS) size.x = MIN_COLLIDER_THICKNESS;
  if (size.y < MIN_COLLIDER_THICKNESS) size.y = MIN_COLLIDER_THICKNESS;
  if (size.z < MIN_COLLIDER_THICKNESS) size.z = MIN_COLLIDER_THICKNESS;
  // The capsule center sits near y 1.1. A desk only 0.7 tall is under that center, so the
  // sweep walks through it. Extend floor furniture up to chest height.
  const blockTop = 1.2;
  const bottom = center.y - size.y / 2;
  const top = center.y + size.y / 2;
  if (bottom < 0.05 && top < blockTop) {
    size.y = blockTop - Math.max(0, bottom);
    center.y = Math.max(0, bottom) + size.y / 2;
  }
  const box = BABYLON.MeshBuilder.CreateBox(`${root.name}-col`, {
    width: size.x,
    height: size.y,
    depth: size.z,
  }, scene);
  box.parent = root;
  box.position.copyFrom(center);
  box.isVisible = false;
  box.isPickable = false;
  box.checkCollisions = true;
  // Invisible meshes are not rendered, so nothing else refreshes this matrix.
  // Collision reads the cached world matrix.
  bindColliderMatrix(root, box);
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

const paintSupplyLabel = (scene: BABYLON.Scene, id: string, draw: (ctx: CanvasRenderingContext2D) => void) => {
  const tex = new BABYLON.DynamicTexture(`${id}-label-tex`, { width: 256, height: 128 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 256, 128);
  draw(ctx);
  tex.hasAlpha = true;
  tex.update();
  return tex;
};

const createSupplyMesh = (
  scene: BABYLON.Scene,
  asset: SceneAssetInstance,
  position: BABYLON.Vector3,
  rotation: BABYLON.Vector3,
  metadata: SceneNodeMetadata,
): BABYLON.Mesh => {
  const item = asset.pickup?.item ?? 'ammo';
  const ammo = item === 'ammo';
  const height = ammo ? 0.22 : 0.26;
  const root = BABYLON.MeshBuilder.CreateBox(asset.name ?? asset.id, {
    width: ammo ? 0.42 : 0.26,
    height,
    depth: ammo ? 0.3 : 0.26,
  }, scene);
  root.position = position.clone();
  root.position.y += height * 0.5;
  root.rotation = rotation;
  root.scaling.set(1, 1, 1);
  const body = new BABYLON.StandardMaterial(`${asset.id}-body`, scene);
  body.diffuseColor = ammo ? new BABYLON.Color3(0.24, 0.28, 0.16) : new BABYLON.Color3(0.82, 0.84, 0.8);
  body.specularColor = new BABYLON.Color3(0.08, 0.08, 0.06);
  root.material = body;
  root.checkCollisions = false;
  root.metadata = {
    ...metadata,
    pickup: { item, amount: asset.pickup?.amount ?? 1 },
  } satisfies SceneNodeMetadata;

  if (ammo) {
    const stripe = BABYLON.MeshBuilder.CreateBox(`${asset.id}-stripe`, { width: 0.44, height: 0.045, depth: 0.31 }, scene);
    stripe.parent = root;
    stripe.position.y = 0.04;
    const stripeMat = new BABYLON.StandardMaterial(`${asset.id}-stripe-mat`, scene);
    stripeMat.diffuseColor = new BABYLON.Color3(0.72, 0.58, 0.12);
    stripeMat.emissiveColor = new BABYLON.Color3(0.12, 0.08, 0.02);
    stripeMat.specularColor = BABYLON.Color3.Black();
    stripe.material = stripeMat;
    stripe.isPickable = false;
    stripe.checkCollisions = false;
  }

  const label = BABYLON.MeshBuilder.CreatePlane(`${asset.id}-label`, { width: ammo ? 0.28 : 0.16, height: ammo ? 0.1 : 0.16 }, scene);
  label.parent = root;
  label.position.z = (ammo ? 0.15 : 0.13) + 0.004;
  // Plane front faces -Z. Spin it so the readable side points out of the box.
  label.rotation.y = Math.PI;
  const tex = paintSupplyLabel(scene, asset.id, (ctx) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (ammo) {
      ctx.fillStyle = '#e2b84a';
      ctx.font = 'bold 54px sans-serif';
      ctx.fillText('AMMO', 128, 68);
      return;
    }
    ctx.strokeStyle = '#d24a42';
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(128, 28);
    ctx.lineTo(128, 100);
    ctx.moveTo(78, 64);
    ctx.lineTo(178, 64);
    ctx.stroke();
  });
  const labelMat = new BABYLON.StandardMaterial(`${asset.id}-label-mat`, scene);
  labelMat.diffuseTexture = tex;
  labelMat.emissiveTexture = tex;
  labelMat.opacityTexture = tex;
  labelMat.emissiveColor = ammo ? new BABYLON.Color3(0.45, 0.32, 0.08) : new BABYLON.Color3(0.55, 0.12, 0.1);
  labelMat.specularColor = BABYLON.Color3.Black();
  labelMat.useAlphaFromDiffuseTexture = true;
  labelMat.backFaceCulling = false;
  label.material = labelMat;
  label.isPickable = false;
  label.checkCollisions = false;
  return root;
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

  if (asset.pickup) {
    return createSupplyMesh(scene, asset, position, rotation, metadata);
  }

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
    if (themeName === 'B3 Basement') light.falloffType = BABYLON.Light.FALLOFF_STANDARD;
    if (asset.color) {
      light.diffuse = new BABYLON.Color3(asset.color[0], asset.color[1], asset.color[2]);
      light.specular = light.diffuse.scale(themeName === 'B3 Basement' ? 0.08 : 0.35);
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
      const slab = BABYLON.MeshBuilder.CreateBox(`${asset.id}-col`, { width: 1, height: 1, depth: 1 }, scene);
      slab.parent = plane;
      slab.scaling.set(1, 1, MIN_COLLIDER_THICKNESS / Math.max(Math.abs(scale.z), 0.001));
      slab.isVisible = false;
      slab.isPickable = false;
      slab.checkCollisions = true;
      bindColliderMatrix(plane, slab);
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
    if (asset.id.startsWith('b3-cage')) {
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
    if (asset.id === 'b3-creature') {
      const idle = findClip(imported.animationGroups, 'idle');
      idle?.start(true);
    }
    if (SOLID_FURNITURE.has(asset.assetId)) attachBoundsCollider(scene, root, imported.meshes);
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