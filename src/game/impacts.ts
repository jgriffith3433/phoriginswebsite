import * as BABYLON from '@babylonjs/core';

const MAX_MARKS = 36;
const marks: BABYLON.Mesh[] = [];
let markMaterial: BABYLON.StandardMaterial | null = null;

const paintMark = (scene: BABYLON.Scene) => {
  const tex = new BABYLON.DynamicTexture('impact-tex', { width: 64, height: 64 }, scene, false);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, 64, 64);
  const dust = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  dust.addColorStop(0, 'rgba(12, 10, 8, 0.95)');
  dust.addColorStop(0.35, 'rgba(28, 24, 20, 0.9)');
  dust.addColorStop(0.62, 'rgba(168, 156, 138, 0.82)');
  dust.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = dust;
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(8, 7, 6, 0.85)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(32, 14);
  ctx.lineTo(30, 32);
  ctx.lineTo(40, 46);
  ctx.moveTo(18, 28);
  ctx.lineTo(32, 34);
  ctx.lineTo(48, 26);
  ctx.stroke();
  tex.hasAlpha = true;
  tex.update();
  return tex;
};

const sharedMarkMaterial = (scene: BABYLON.Scene) => {
  if (markMaterial && markMaterial.getScene() === scene) return markMaterial;
  const tex = paintMark(scene);
  const material = new BABYLON.StandardMaterial('impact-mat', scene);
  material.diffuseTexture = tex;
  material.opacityTexture = tex;
  material.emissiveTexture = tex;
  material.emissiveColor = new BABYLON.Color3(0.62, 0.56, 0.46);
  material.specularColor = BABYLON.Color3.Black();
  material.useAlphaFromDiffuseTexture = true;
  material.zOffset = -2;
  material.backFaceCulling = false;
  material.disableLighting = false;
  markMaterial = material;
  return material;
};

const isCreatureMesh = (mesh: BABYLON.AbstractMesh) => {
  let node: BABYLON.Node | null = mesh;
  while (node) {
    const id = (node.metadata as { sceneAssetId?: string } | null)?.sceneAssetId;
    if (id === 'b3-creature') return true;
    node = node.parent;
  }
  return false;
};

export const clearImpactMarks = () => {
  for (const mark of marks) {
    if (!mark.isDisposed()) mark.dispose();
  }
  marks.length = 0;
};

/** Projects a chip onto the first solid surface along the shot. */
export const stampBulletMark = (
  scene: BABYLON.Scene,
  origin: BABYLON.Vector3,
  direction: BABYLON.Vector3,
  ignore: BABYLON.AbstractMesh[],
) => {
  if (direction.lengthSquared() < 1e-6) return;
  const ignored = new Set(ignore);
  const ray = new BABYLON.Ray(origin, direction.normalizeToNew(), 24);
  const hit = scene.pickWithRay(ray, (mesh) => {
    if (!mesh.isVisible || !mesh.isEnabled() || mesh.infiniteDistance || !mesh.isPickable) return false;
    if (ignored.has(mesh) || mesh.name.startsWith('impact-')) return false;
    if (mesh.getTotalVertices() <= 0 || isCreatureMesh(mesh)) return false;
    return true;
  });
  if (!hit?.hit || !hit.pickedMesh || !hit.pickedPoint) return;
  const normal = hit.getNormal(true, true);
  if (!normal || normal.lengthSquared() < 1e-6) return;
  let decal: BABYLON.Mesh;
  try {
    decal = BABYLON.MeshBuilder.CreateDecal('impact-mark', hit.pickedMesh, {
      position: hit.pickedPoint,
      normal,
      size: new BABYLON.Vector3(0.2, 0.2, 0.35),
      angle: Math.random() * Math.PI,
    });
  } catch {
    return;
  }
  if (decal.getTotalVertices() <= 0) {
    decal.dispose();
    return;
  }
  decal.material = sharedMarkMaterial(scene);
  decal.isPickable = false;
  decal.checkCollisions = false;
  decal.receiveShadows = false;
  decal.position.addInPlace(normal.scale(0.02));
  marks.push(decal);
  while (marks.length > MAX_MARKS) {
    const oldest = marks.shift();
    if (oldest && !oldest.isDisposed()) oldest.dispose();
  }
};
