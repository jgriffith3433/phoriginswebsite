import * as BABYLON from '@babylonjs/core';

/** Far distance for block faces and facade cards. Other street bands scale from this. */
export const CULL_REFERENCE = 70;

const BASE: Record<string, { near: number; far: number }> = {
  block: { near: 52, far: 70 },
  shell: { near: 56, far: 74 },
  furn: { near: 34, far: 46 },
  facade: { near: 52, far: 70 },
  window: { near: 46, far: 60 },
  lamp: { near: 42, far: 56 },
  walk: { near: 42, far: 56 },
  curb: { near: 42, far: 56 },
  xing: { near: 42, far: 56 },
};

export type CullBand = {
  node: BABYLON.Node;
  near: number;
  far: number;
  /** Hysteresis. True once the node is inside the far distance. */
  on: boolean;
  /** Last visibility written. A selected editor node can show while `on` is false. */
  shown: boolean;
  seen: number;
};

const nodeId = (node: BABYLON.Node) => {
  const meta = node.metadata as { sceneAssetId?: string } | null;
  return meta?.sceneAssetId || node.name || '';
};

/** Street props the level cull hides. `block` is the avenue volume. Shop interiors stay out. */
export const streetCullKind = (id: string) => {
  if (!id) return '';
  if (id.startsWith('block-')) return 'block';
  if (id.startsWith('b3-decal-win-') || id.startsWith('tower-win')) return 'window';
  if (id.startsWith('lamp-')) return 'lamp';
  if (id.startsWith('b3-decal-walk-')) return 'walk';
  if (id.startsWith('b3-decal-curb-')) return 'curb';
  if (id.startsWith('b3-decal-xing-')) return 'xing';
  if (id.startsWith('street-facade-')) return 'facade';
  if (
    id.startsWith('street-bin-')
    || id.startsWith('street-plant-')
    || id.startsWith('street-board-')
    || id.startsWith('street-hydrant-')
    || id.startsWith('street-can-')
    || id.startsWith('street-paper-')
    || id.startsWith('street-planter-')
  ) return 'furn';
  if (id.includes('-in-')) return 'interior';
  if (id.startsWith('shop-') || id.startsWith('b3-decal-shop-')) return 'shell';
  return '';
};

/** Saved `cull`, or 70 on Going Home when the field is omitted. 0 draws everything. */
export const levelCullMeters = (data: { id?: string; cull?: number } | null | undefined) => {
  if (typeof data?.cull === 'number' && Number.isFinite(data.cull)) return Math.max(0, data.cull);
  if (data?.id === 'going-home') return CULL_REFERENCE;
  return 0;
};

const underBand = (node: BABYLON.Node, roots: Set<BABYLON.Node>) => {
  let parent = node.parent;
  while (parent) {
    if (roots.has(parent)) return true;
    parent = parent.parent;
  }
  return false;
};

const holds = (node: BABYLON.Node, pinned: BABYLON.Node | null) => {
  let cursor: BABYLON.Node | null = pinned;
  while (cursor) {
    if (cursor === node) return true;
    cursor = cursor.parent;
  }
  return false;
};

export const collectCullBands = (scene: BABYLON.Scene, previous: CullBand[] = []): CullBand[] => {
  const prior = new Map(previous.map((band) => [band.node, band]));
  const candidates: { node: BABYLON.Node; near: number; far: number }[] = [];
  const seen = new Set<BABYLON.Node>();
  for (const node of [...scene.meshes, ...scene.transformNodes]) {
    if (seen.has(node) || node.isDisposed()) continue;
    seen.add(node);
    const base = BASE[streetCullKind(nodeId(node))];
    if (!base) continue;
    candidates.push({ node, near: base.near, far: base.far });
  }
  const roots = new Set(candidates.map((row) => row.node));
  const bands: CullBand[] = [];
  for (const row of candidates) {
    if (underBand(row.node, roots)) continue;
    const kept = prior.get(row.node);
    if (kept) {
      kept.near = row.near;
      kept.far = row.far;
      bands.push(kept);
    } else {
      bands.push({ node: row.node, near: row.near, far: row.far, on: true, shown: true, seen: -1 });
    }
  }
  return bands;
};

export const applyCullBands = (
  bands: CullBand[],
  x: number,
  z: number,
  meters: number,
  pinned: BABYLON.Node | null = null,
) => {
  const scale = meters > 0 ? meters / CULL_REFERENCE : 1;
  for (const band of bands) {
    if (band.node.isDisposed()) continue;
    const at = (band.node as BABYLON.TransformNode).getAbsolutePosition();
    const dx = at.x - x;
    const dz = at.z - z;
    const dist2 = dx * dx + dz * dz;
    const near = band.near * scale;
    const far = band.far * scale;
    const byDistance = meters <= 0 || (band.on ? dist2 < far * far : dist2 < near * near);
    const want = byDistance || holds(band.node, pinned);
    const meshes = band.node instanceof BABYLON.AbstractMesh
      ? [band.node, ...band.node.getChildMeshes(false)]
      : band.node.getChildMeshes(false);
    if (want === band.shown && meshes.length === band.seen) {
      band.on = byDistance;
      continue;
    }
    band.on = byDistance;
    band.shown = want;
    band.seen = meshes.length;
    // A disabled root swallows a copy parented later. Visibility hides the draw.
    band.node.setEnabled(true);
    for (const mesh of meshes) {
      if ((mesh.metadata as { boundsCollider?: boolean } | null)?.boundsCollider) continue;
      mesh.isVisible = want;
    }
  }
};
