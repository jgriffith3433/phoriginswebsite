/**
 * Scene audit (Node, Babylon NullEngine; no browser): loads each level file the way the game does, mounts the
 * level's runtime dressing (interior kit, station, train), then checks the Studio 3D quality rules that can be
 * judged from geometry alone. Built and run by tools/sceneAudit.mjs; prints one JSON line per level.
 *
 * - coplanar:  two triangles in the same plane, facing the same way, overlapping (z-fighting). Rule 2.
 * - floating / sunk: a placed prop or piece of furniture whose bounds bottom is off the surface under it. Rule 4.
 * - mirrored:  a node with negative scale, or a mesh whose world transform flips winding outside a glTF root. Rule 3.
 * - text:      a text or sign plane that is mirrored, readable from behind (no back-face culling, no billboard), or
 *              whose readable side faces straight into a wall. Rule 1.
 */
import * as BABYLON from '@babylonjs/core';
import { readGlbsFromDisk } from '../leakcheck/nodeEnv';

const { loadSceneFromJsonFile } = await import('../../src/game/sceneData');
const { createInteriorDress } = await import('../../src/game/interior/dress');
const { apexPlan } = await import('../../src/game/interior/apexPlan');
const { b3Plan } = await import('../../src/game/interior/b3Plan');
const { createStationDress } = await import('../../src/story/stationDress');
const { createTrainDress } = await import('../../src/story/trainDress');

readGlbsFromDisk();

type Finding = { rule: string; what: string; detail: string; amount?: number; fixY?: number };

const settle = async (scene: BABYLON.Scene) => {
  let last = ''; let same = 0;
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const now = `${scene.meshes.length}|${scene.transformNodes.length}|${scene.geometries.length}`;
    if (now === last) { if (++same > 20) return; } else { same = 0; last = now; }
  }
};

const assetIdOf = (node: BABYLON.Node | null): string => {
  for (let n: BABYLON.Node | null = node; n; n = n.parent) {
    const id = (n.metadata as { sceneAssetId?: string } | null)?.sceneAssetId;
    if (id) return id;
  }
  return '';
};
const label = (mesh: BABYLON.AbstractMesh) => {
  const id = assetIdOf(mesh);
  return id && id !== mesh.name ? `${id}/${mesh.name}` : mesh.name;
};
const inGltf = (node: BABYLON.Node) => {
  for (let n: BABYLON.Node | null = node; n; n = n.parent) if (n.name.endsWith('__root__')) return true;
  return false;
};
const shown = (mesh: BABYLON.AbstractMesh) => mesh.isVisible && mesh.visibility > 0 && !mesh.infiniteDistance
  && !(mesh.metadata as { trigger?: boolean } | null)?.trigger && mesh.getTotalVertices() > 0;

/** World-space triangles of a mesh (instances and thin instances included). */
const worldTriangles = (mesh: BABYLON.AbstractMesh): BABYLON.Vector3[][] => {
  const source = mesh instanceof BABYLON.InstancedMesh ? mesh.sourceMesh : (mesh as BABYLON.Mesh);
  const pos = source.getVerticesData?.(BABYLON.VertexBuffer.PositionKind);
  if (!pos) return [];
  const idx = source.getIndices() ?? Array.from({ length: pos.length / 3 }, (_, i) => i);
  const world = mesh.computeWorldMatrix(true);
  const mats: BABYLON.Matrix[] = [];
  const thin = (source as BABYLON.Mesh).thinInstanceCount ?? 0;
  if (thin > 0 && !(mesh instanceof BABYLON.InstancedMesh)) {
    for (const m of (source as BABYLON.Mesh).thinInstanceGetWorldMatrices()) mats.push(m.multiply(world));
  } else mats.push(world);
  const out: BABYLON.Vector3[][] = [];
  for (const m of mats) {
    const v = (i: number) => BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), m);
    for (let t = 0; t + 2 < idx.length; t += 3) out.push([v(idx[t]), v(idx[t + 1]), v(idx[t + 2])]);
  }
  return out;
};

/** Area of the overlap of two convex 2D polygons (Sutherland-Hodgman). */
const clipPoly = (a: number[][], b: number[][]) => {
  const area = (p: number[][]) => { let s = 0; for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i]; const [x1, y1] = p[(i + 1) % p.length]; s += x0 * y1 - x1 * y0; } return s / 2; };
  const ccw = (p: number[][]) => (area(p) < 0 ? [...p].reverse() : p);
  let out = ccw(a);
  const clip = ccw(b);
  for (let i = 0; i < clip.length && out.length; i++) {
    const [ax, ay] = clip[i]; const [bx, by] = clip[(i + 1) % clip.length];
    const side = (p: number[]) => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
    const input = out; out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j]; const q = input[(j + 1) % input.length];
      const sp = side(p); const sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
  }
  return out.length >= 3 ? { area: Math.abs(area(out)), poly: out } : { area: 0, poly: out };
};

/**
 * A face pressed into a solid (a wall's top inside the ceiling slab, its foot under the floor) never shows, so its
 * overlap cannot flicker. Solids: primitive boxes (24 vertices) by bounds, ground planes from below.
 */
const hiddenTest = (scene: BABYLON.Scene) => {
  const boxes: { a: BABYLON.Vector3; b: BABYLON.Vector3; id: number }[] = [];
  const grounds: { a: BABYLON.Vector3; b: BABYLON.Vector3 }[] = [];
  for (const m of scene.meshes) {
    if (!(shown(m) || m.checkCollisions) || m.skeleton) continue;
    const bb = m.getBoundingInfo().boundingBox;
    const kind = (m.metadata as { assetKind?: string } | null)?.assetKind;
    if (kind === 'ground' && m.getTotalVertices() <= 4) grounds.push({ a: bb.minimumWorld, b: bb.maximumWorld });
    else if (m.getTotalVertices() === 24) boxes.push({ a: bb.minimumWorld.add(new BABYLON.Vector3(1e-3, 1e-3, 1e-3)), b: bb.maximumWorld.subtract(new BABYLON.Vector3(1e-3, 1e-3, 1e-3)), id: m.uniqueId });
  }
  return (p: BABYLON.Vector3) => boxes.some((x) => p.x > x.a.x && p.x < x.b.x && p.y > x.a.y && p.y < x.b.y && p.z > x.a.z && p.z < x.b.z)
    || grounds.some((g) => p.x > g.a.x && p.x < g.b.x && p.z > g.a.z && p.z < g.b.z && p.y < g.a.y && p.y > g.a.y - 0.5);
};

const coplanarAudit = (scene: BABYLON.Scene): Finding[] => {
  const hidden = hiddenTest(scene);
  type Tri = { p: BABYLON.Vector3[]; n: BABYLON.Vector3; d: number; mesh: string; offset: boolean; twoSided: boolean; minA: number; maxA: number };
  const buckets = new Map<string, Tri[]>();
  const D = 0.004;
  for (const mesh of scene.meshes) {
    if (!shown(mesh) || mesh.skeleton) continue;
    const mat = mesh.material as BABYLON.Material | null;
    const offset = !!mat && (mat.zOffset !== 0 || (mat as any).zOffsetUnits);
    const twoSided = !!mat && mat.backFaceCulling === false;
    if (mat && mat.alpha === 0) continue;
    for (const p of worldTriangles(mesh)) {
      const n = BABYLON.Vector3.Cross(p[1].subtract(p[0]), p[2].subtract(p[0]));
      const len = n.length();
      if (len < 2e-4) continue; // < 1 cm^2
      n.scaleInPlace(1 / len);
      const d = BABYLON.Vector3.Dot(n, p[0]);
      const tri: Tri = { p, n, d, mesh: label(mesh), offset, twoSided, minA: 0, maxA: 0 };
      // Canonical direction so opposite-facing pairs share a bucket.
      const s = n.x < -1e-6 || (Math.abs(n.x) <= 1e-6 && (n.y < -1e-6 || (Math.abs(n.y) <= 1e-6 && n.z < 0))) ? -1 : 1;
      const key = `${Math.round(n.x * s * 40)},${Math.round(n.y * s * 40)},${Math.round(n.z * s * 40)}`;
      const k = `${key}|${Math.floor((d * s) / D)}`;
      (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(tri);
    }
  }
  const pairs = new Map<string, { area: number; count: number; at: string }>();
  const seen = new Set<string>();
  for (const [k, list] of buckets) {
    const [nk, dk] = k.split('|');
    const near = [...list, ...(buckets.get(`${nk}|${Number(dk) + 1}`) ?? [])];
    if (near.length < 2) continue;
    const n = list[0].n;
    const ax = Math.abs(n.x) > 0.9 ? new BABYLON.Vector3(0, 0, 1) : new BABYLON.Vector3(1, 0, 0);
    const u = BABYLON.Vector3.Cross(n, ax).normalize();
    const v = BABYLON.Vector3.Cross(n, u).normalize();
    const flat = near.map((t) => {
      const q = t.p.map((p) => [BABYLON.Vector3.Dot(p, u), BABYLON.Vector3.Dot(p, v)]);
      return { t, q, minX: Math.min(...q.map((c) => c[0])), maxX: Math.max(...q.map((c) => c[0])), minY: Math.min(...q.map((c) => c[1])), maxY: Math.max(...q.map((c) => c[1])) };
    }).sort((a, b) => a.minX - b.minX);
    for (let i = 0; i < flat.length; i++) {
      for (let j = i + 1; j < flat.length && flat[j].minX < flat[i].maxX; j++) {
        const A = flat[i]; const B = flat[j];
        if (A.t === B.t || B.minY >= A.maxY || A.minY >= B.maxY) continue;
        const same = BABYLON.Vector3.Dot(A.t.n, B.t.n);
        if (Math.abs(same) < 0.999) continue;
        const dd = same > 0 ? Math.abs(A.t.d - B.t.d) : Math.abs(A.t.d + B.t.d);
        if (dd > 0.002) continue;
        if (A.t.offset || B.t.offset) continue;
        if (same < 0 && !A.t.twoSided && !B.t.twoSided) continue; // back to back: one side is culled
        // Back to back across two objects is a contact face (a cabinet's back on the wall): the object hides it.
        if (same < 0 && A.t.mesh.split('/')[0] !== B.t.mesh.split('/')[0]) continue;
        const key = [A.t.mesh, B.t.mesh].sort().join(' <> ');
        const tag = `${key}|${A.t.p[0].toString()}|${B.t.p[0].toString()}`;
        if (seen.has(tag)) continue;
        seen.add(tag);
        const { area, poly } = clipPoly(A.q, B.q);
        if (area < 0.0004) continue; // 2 x 2 cm
        const cx = poly.reduce((t, q) => t + q[0], 0) / poly.length;
        const cy = poly.reduce((t, q) => t + q[1], 0) / poly.length;
        const c = u.scale(cx).add(v.scale(cy)).add(n.scale(BABYLON.Vector3.Dot(n, A.t.p[0])));
        if (same > 0 && hidden(c.add(A.t.n.scale(0.01)))) continue;
        const e = pairs.get(key) ?? { area: 0, count: 0, at: `${same > 0 ? 'same facing' : 'back to back, drawn two-sided'}, normal ${A.t.n.x.toFixed(2)},${A.t.n.y.toFixed(2)},${A.t.n.z.toFixed(2)} near ${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)}` };
        e.area += area; e.count++;
        pairs.set(key, e);
      }
    }
  }
  return [...pairs].filter(([, e]) => e.area >= 0.01).sort((a, b) => b[1].area - a[1].area)
    .map(([key, e]) => ({ rule: 'coplanar', what: key, detail: `${e.count} overlapping triangle pairs, ${e.at}`, amount: +e.area.toFixed(3) }));
};

/** Placed things: level props (model roots) and box furniture (wall/pillar kind under 2.5 m tall). */
const placedObjects = (scene: BABYLON.Scene) => {
  const out: { id: string; meshes: BABYLON.AbstractMesh[] }[] = [];
  const roots = [...scene.transformNodes, ...scene.meshes].filter((n) => {
    const md = n.metadata as { sceneAssetId?: string; assetKind?: string } | null;
    return md?.sceneAssetId && !assetIdOf(n.parent);
  });
  for (const root of roots) {
    const md = root.metadata as { sceneAssetId: string; assetKind?: string };
    const kind = md.assetKind ?? 'model';
    if (!['model', 'wall', 'pillar'].includes(kind)) continue;
    const meshes = [root, ...root.getChildMeshes(false)].filter((m): m is BABYLON.AbstractMesh => m instanceof BABYLON.AbstractMesh && shown(m));
    if (!meshes.length || meshes.some((m) => m.skeleton)) continue;
    out.push({ id: md.sceneAssetId, meshes });
  }
  return out;
};

const bounds = (meshes: BABYLON.AbstractMesh[]) => {
  const min = new BABYLON.Vector3(Infinity, Infinity, Infinity);
  const max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of meshes) {
    m.computeWorldMatrix(true);
    m.refreshBoundingInfo?.({});
    const b = m.getBoundingInfo().boundingBox;
    min.minimizeInPlace(b.minimumWorld);
    max.maximizeInPlace(b.maximumWorld);
  }
  return { min, max };
};

const groundAudit = (scene: BABYLON.Scene): Finding[] => {
  const out: Finding[] = [];
  const TOL = 0.03;
  const objects = placedObjects(scene);
  for (const o of objects) {
    const { min, max } = bounds(o.meshes);
    const size = max.subtract(min);
    if (size.y > 2.5 && o.meshes.length === 1 && !o.meshes[0].parent) continue; // walls and columns stand on the floor by authoring
    if (size.x * size.z < 1e-4) continue;
    const self = new Set(o.meshes.map((m) => m.uniqueId));
    const solid = (m: BABYLON.AbstractMesh) => !self.has(m.uniqueId) && (shown(m) || m.checkCollisions) && !m.skeleton;
    const samples = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].map(([fx, fz]) => [min.x + size.x * fx, min.z + size.z * fz]);
    let best = Infinity;
    for (const [x, z] of samples) {
      const ray = new BABYLON.Ray(new BABYLON.Vector3(x, min.y + 0.05, z), new BABYLON.Vector3(0, -1, 0), 60);
      const hit = scene.pickWithRay(ray, solid);
      if (hit?.hit && hit.pickedPoint) best = Math.min(best, Math.abs(min.y - hit.pickedPoint.y));
    }
    // Sunk: a level floor slab cuts through the object's lower part.
    let sunk = 0;
    const floors = (m: BABYLON.AbstractMesh) => !self.has(m.uniqueId) && (m.metadata as { assetKind?: string } | null)?.assetKind === 'ground';
    const ray = new BABYLON.Ray(new BABYLON.Vector3((min.x + max.x) / 2, max.y + 0.01, (min.z + max.z) / 2), new BABYLON.Vector3(0, -1, 0), size.y + 0.02);
    const floorHit = scene.pickWithRay(ray, floors);
    if (floorHit?.hit && floorHit.pickedPoint) sunk = floorHit.pickedPoint.y - min.y;
    if (sunk > 0.04) {
      out.push({ rule: 'sunk', what: o.id, detail: `bottom ${min.y.toFixed(3)} is ${sunk.toFixed(3)} m under the floor`, amount: +sunk.toFixed(3), fixY: +sunk.toFixed(3) });
      continue;
    }
    if (best <= TOL) continue;
    // Not resting on anything: fine when it is fixed to a wall, ceiling or another object (bounds touch).
    const grown = { min: min.subtract(new BABYLON.Vector3(TOL, TOL, TOL)), max: max.add(new BABYLON.Vector3(TOL, TOL, TOL)) };
    const touching = scene.meshes.some((m) => {
      if (!solid(m)) return false;
      const b = m.getBoundingInfo().boundingBox;
      if (b.maximumWorld.x < grown.min.x || b.minimumWorld.x > grown.max.x || b.maximumWorld.y < grown.min.y || b.minimumWorld.y > grown.max.y || b.maximumWorld.z < grown.min.z || b.minimumWorld.z > grown.max.z) return false;
      // A huge merged mesh (the interior kit) overlaps everything by bounds: ask it with a short ray instead.
      const bs = b.maximumWorld.subtract(b.minimumWorld);
      if (bs.x > 6 && bs.z > 6) {
        const c = min.add(max).scale(0.5);
        for (const dir of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
          const d = new BABYLON.Vector3(dir[0], dir[1], dir[2]);
          const reach = Math.abs(d.x) * size.x / 2 + Math.abs(d.y) * size.y / 2 + Math.abs(d.z) * size.z / 2 + TOL;
          const h = new BABYLON.Ray(c, d, reach).intersectsMesh(m as BABYLON.Mesh);
          if (h.hit) return true;
        }
        return false;
      }
      return true;
    });
    if (touching) continue;
    // Suggested move: up flush to a surface just above (a ceiling fixture), else down onto the surface below.
    let fixY: number | undefined;
    const up = scene.pickWithRay(new BABYLON.Ray(new BABYLON.Vector3((min.x + max.x) / 2, max.y - 0.01, (min.z + max.z) / 2), new BABYLON.Vector3(0, 1, 0), 0.5), solid);
    if (up?.hit && up.distance - 0.01 > 0) fixY = +(up.distance - 0.01).toFixed(3);
    else if (best !== Infinity && best <= 0.4) fixY = -best.toFixed(3);
    out.push({ rule: 'floating', fixY, what: o.id, detail: `${best === Infinity ? 'nothing under it' : `${best.toFixed(3)} m above the surface under it`}; bounds y ${min.y.toFixed(3)}..${max.y.toFixed(3)}`, amount: best === Infinity ? 99 : +best.toFixed(3) });
  }
  return out;
};

const mirrorAudit = (scene: BABYLON.Scene): Finding[] => {
  const out: Finding[] = [];
  for (const node of [...scene.transformNodes, ...scene.meshes] as BABYLON.TransformNode[]) {
    if (node.name.endsWith('__root__')) continue; // the glTF loader's handedness root
    const s = node.scaling;
    if (s && (s.x < 0 || s.y < 0 || s.z < 0)) out.push({ rule: 'mirrored', what: node.name, detail: `negative scale ${s.toString()}` });
  }
  for (const mesh of scene.meshes) {
    if (!shown(mesh) || inGltf(mesh)) continue;
    if (mesh.computeWorldMatrix(true).determinant() < 0 && (mesh.material?.backFaceCulling ?? true)) {
      out.push({ rule: 'mirrored', what: label(mesh), detail: 'world transform flips winding (renders inside out)' });
    }
  }
  return out;
};

const isTextTexture = (t: BABYLON.BaseTexture | null | undefined) => !!t && t.getClassName() === 'DynamicTexture';
const textAudit = (scene: BABYLON.Scene): Finding[] => {
  const out: Finding[] = [];
  for (const mesh of scene.meshes) {
    if (!shown(mesh)) continue;
    const mat = mesh.material as any;
    if (!mat || !(isTextTexture(mat.diffuseTexture) || isTextTexture(mat.emissiveTexture) || isTextTexture(mat.albedoTexture) || isTextTexture(mat.opacityTexture))) continue;
    const billboard = mesh.billboardMode !== BABYLON.AbstractMesh.BILLBOARDMODE_NONE;
    const world = mesh.computeWorldMatrix(true);
    if (world.determinant() < 0 && !inGltf(mesh)) out.push({ rule: 'text', what: label(mesh), detail: 'text mesh is mirrored (negative scale)' });
    if (billboard) continue;
    if (mat.backFaceCulling === false) out.push({ rule: 'text', what: label(mesh), detail: 'text reads backwards from behind (back faces drawn, no billboard)' });
    const normals = (mesh instanceof BABYLON.InstancedMesh ? mesh.sourceMesh : mesh as BABYLON.Mesh).getVerticesData?.(BABYLON.VertexBuffer.NormalKind);
    if (!normals || mesh.getTotalVertices() > 64) continue; // only flat sign planes
    const n = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(normals[0], normals[1], normals[2]), world).normalize();
    const c = mesh.getBoundingInfo().boundingBox.centerWorld;
    const blocker = (m: BABYLON.AbstractMesh) => m !== mesh && (shown(m) || m.checkCollisions) && !m.skeleton;
    const front = scene.pickWithRay(new BABYLON.Ray(c.add(n.scale(0.002)), n, 0.12), blocker);
    const back = scene.pickWithRay(new BABYLON.Ray(c.subtract(n.scale(0.002)), n.negate(), 0.12), blocker);
    const doubleFaced = mesh.getChildMeshes(true).some((c) => c.material === mesh.material);
    if (front?.hit && !back?.hit && !doubleFaced) out.push({ rule: 'text', what: label(mesh), detail: `readable side faces into ${front.pickedMesh?.name ?? 'a surface'} ${front.distance.toFixed(3)} m away` });
  }
  return out;
};


/**
 * Rule 14, level geometry the follow camera and Pierce (collider radius 0.4) have to live in: hall clear width,
 * door width and frame depth, ceiling height over floors, stair riser.
 */
const MIN_HALL = 2.4; const MIN_DOOR = 1.2; const MAX_PROUD = 0.02; const MIN_CEIL = 3.0; const MAX_RISER = 0.2;
const geometryAudit = (scene: BABYLON.Scene): Finding[] => {
  let lastNear = '';
  const out: Finding[] = [];
  const meta = (m: BABYLON.AbstractMesh) => m.metadata as { sceneAssetId?: string; assetKind?: string } | null;
  const solid = (m: BABYLON.AbstractMesh) => (m.checkCollisions || shown(m)) && !m.skeleton && meta(m)?.assetKind !== 'ground' && !m.name.startsWith('interior-floor');
  const cast = (o: BABYLON.Vector3, d: BABYLON.Vector3, len: number, pred = solid) => { const h = scene.pickWithRay(new BABYLON.Ray(o, d, len), pred); if (h?.hit && h.distance < 0.3) lastNear = h.pickedMesh?.name ?? ''; return h?.hit ? h.distance : len; };
  const slab = (m: BABYLON.AbstractMesh) => { if (!solid(m)) return false; const e = m.getBoundingInfo().boundingBox.extendSizeWorld; return e.x > 0.75 && e.z > 0.75 && e.y < 0.4; };
  const wallish = (m: BABYLON.AbstractMesh) => { if (!solid(m)) return false; const e = m.getBoundingInfo().boundingBox.extendSizeWorld; return e.y > 1.0 && Math.max(e.x, e.z) > 1.5; };
  const grounds = scene.meshes.filter((m) => meta(m)?.assetKind === 'ground' && m.getTotalVertices() > 0);
  const V = (x: number, y: number, z: number) => new BABYLON.Vector3(x, y, z);
  for (const g of grounds) {
    const b = g.getBoundingInfo().boundingBox; const lo = b.minimumWorld; const hi = b.maximumWorld;
    const id = g.name;
    const sx = hi.x - lo.x; const sz = hi.z - lo.z;
    if (sx < 1 || sz < 1) continue;
    const isHall = /hall/i.test(id);
    let minW = Infinity; let minC = Infinity; let at = '';
    for (let x = lo.x + 0.6; x < hi.x - 0.5; x += 0.5) {
      for (let z = lo.z + 0.6; z < hi.z - 0.5; z += 0.5) {
        const y = hi.y + 1.0;
        if (isHall) {
          const alongX = sx > sz;
          const w = alongX ? cast(V(x, y, z), V(0, 0, 1), 20, wallish) + cast(V(x, y, z), V(0, 0, -1), 20, wallish) : cast(V(x, y, z), V(1, 0, 0), 20, wallish) + cast(V(x, y, z), V(-1, 0, 0), 20, wallish);
          if (w < minW) { minW = w; at = `${x.toFixed(1)},${z.toFixed(1)}`; }
        }
        const up = cast(V(x, hi.y + 2.0, z), V(0, 1, 0), 8, slab);
        if (up < 8 && up + 2.0 < minC) minC = up + 2.0;
      }
    }
    if (isHall && minW < MIN_HALL) out.push({ rule: 'geometry', what: `hall ${id}`, detail: `clear width ${minW.toFixed(2)} m near ${at} ${lastNear} (min ${MIN_HALL})`, amount: +minW.toFixed(2) });
    if (minC < MIN_CEIL) out.push({ rule: 'geometry', what: `ceiling ${id}`, detail: `ceiling ${minC.toFixed(2)} m over the floor (min ${MIN_CEIL})`, amount: +minC.toFixed(2) });
  }
  for (const o of placedObjects(scene)) {
    if (!/door/i.test(o.id) || /elevator|lift|train|subway/i.test(o.id)) continue;
    const { min, max } = bounds(o.meshes); const sz = max.subtract(min);
    const wide = Math.max(sz.x, sz.z); const deep = Math.min(sz.x, sz.z);
    if (wide < MIN_DOOR) out.push({ rule: 'geometry', what: `door ${o.id}`, detail: `opening ${wide.toFixed(2)} m wide (min ${MIN_DOOR}, 1.5 x capsule 0.8)`, amount: +wide.toFixed(2) });
    // Frame depth proud of the wall face: wall hit from beside the door against the door's own face.
    const c = min.add(max).scale(0.5); const alongX = sz.x > sz.z; const side = wide / 2 + 0.3;
    for (const dir of alongX ? [-1, 1] : [-1, 1]) {
      const d = alongX ? V(0, 0, dir) : V(dir, 0, 0);
      const far = 1.5; const o1 = c.add(d.scale(far)); const flip = d.scale(-1);
      const self = new Set(o.meshes.map((m) => m.uniqueId));
      const wallD = cast(o1.add(alongX ? V(side, 0, 0) : V(0, 0, side)).add(V(0, 0.4 - c.y + c.y, 0)), flip, far + 1, (m) => solid(m) && !self.has(m.uniqueId));
      const doorD = cast(o1.add(V(0, 0.4 - c.y + c.y, 0)), flip, far + 1, (m) => self.has(m.uniqueId));
      const proud = wallD - doorD;
      if (doorD < far + 1 && proud > MAX_PROUD) { out.push({ rule: 'geometry', what: `door ${o.id}`, detail: `frame ${(proud * 100).toFixed(1)} cm proud of the wall (max ${MAX_PROUD * 100})`, amount: +proud.toFixed(3) }); break; }
    }
  }
  const stairs = scene.meshes.filter((m) => /^stair-up-\d+$/.test(m.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  let prev = 0;
  for (const m of stairs) {
    const top = m.getBoundingInfo().boundingBox.maximumWorld.y;
    if (top - prev > MAX_RISER + 1e-3) out.push({ rule: 'geometry', what: `stairs ${m.name}`, detail: `riser ${(top - prev).toFixed(2)} m (max ${MAX_RISER})`, amount: +(top - prev).toFixed(2) });
    prev = top;
  }
  return out;
};

const LEVELS: Record<string, { file: string; dress?: (scene: BABYLON.Scene) => void }> = {
  'apex-peak': { file: '/levels/apex-peak.json', dress: (s) => { createInteriorDress(s, apexPlan); } },
  'b3-basement': { file: '/levels/b3-basement.json', dress: (s) => { createInteriorDress(s, b3Plan); } },
  'going-home': { file: '/levels/going-home.json' },
  'the-station': { file: '/levels/the-station.json', dress: (s) => { createStationDress(s); } },
  'the-train': { file: '/levels/the-train.json', dress: (s) => { createTrainDress(s); } },
  'the-morning': { file: '/levels/the-morning.json' },
};

const pick = (process.argv[2] ?? Object.keys(LEVELS).join(',')).split(',');
for (const id of pick) {
  const level = LEVELS[id];
  if (!level) throw new Error(`unknown level ${id}`);
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  const loaded = await loadSceneFromJsonFile(scene, level.file, { replaceNodes: [], hideTriggers: true });
  if (!loaded) throw new Error(`no level ${id}`);
  await settle(scene);
  level.dress?.(scene);
  await settle(scene);
  for (const m of scene.meshes) { m.computeWorldMatrix(true); m.refreshBoundingInfo?.({}); }
  const findings = [...groundAudit(scene), ...coplanarAudit(scene), ...mirrorAudit(scene), ...textAudit(scene), ...geometryAudit(scene)];
  console.log(`audit ${id} ${JSON.stringify(findings)}`);
  scene.dispose();
}
process.exit(0);
