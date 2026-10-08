import * as BABYLON from '@babylonjs/core';

const FLASH_SECONDS = 0.065;
const AIM_DISTANCE = 0.9;
const MIN_DISTANCE = 0.22;
const MAX_DISTANCE = 1.15;
const RIGHT_OFFSET = 0.22;
const DOWN_OFFSET = 0.06;

export const createMuzzleFlash = (scene: BABYLON.Scene) => {
  const plane = BABYLON.MeshBuilder.CreatePlane('muzzleFlash', { size: 0.22 }, scene);
  plane.isPickable = false;
  plane.checkCollisions = false;
  plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  plane.renderingGroupId = 1;
  plane.alwaysSelectAsActiveMesh = true;

  const material = new BABYLON.StandardMaterial('muzzleFlashMat', scene);
  material.disableLighting = true;
  material.emissiveColor = new BABYLON.Color3(1, 0.72, 0.28);
  material.diffuseColor = BABYLON.Color3.Black();
  material.specularColor = BABYLON.Color3.Black();
  material.alpha = 0.16;
  material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
  material.alphaMode = BABYLON.Engine.ALPHA_ADD;
  material.disableDepthWrite = true;
  material.backFaceCulling = false;
  plane.material = material;
  plane.setEnabled(false);

  const origin = new BABYLON.Vector3();
  const forward = new BABYLON.Vector3();
  const right = new BABYLON.Vector3();
  const up = new BABYLON.Vector3();
  const ray = new BABYLON.Ray(origin, forward, MAX_DISTANCE);
  let hideAt = 0;

  const ignorable = (mesh: BABYLON.AbstractMesh | undefined, ignore: Set<BABYLON.AbstractMesh>) => {
    if (!mesh || mesh === plane || ignore.has(mesh)) return true;
    if (!mesh.isEnabled() || !mesh.isVisible || mesh.visibility <= 0) return true;
    if ((mesh.metadata as { sceneTriggerId?: string } | undefined)?.sceneTriggerId) return true;
    return false;
  };

  const burst = (world: BABYLON.Vector3) => {
    plane.parent = null;
    plane.setAbsolutePosition(world);
    const scale = 0.55 + Math.random() * 0.25;
    plane.scaling.set(scale, scale, scale);
    plane.rotation.z = Math.random() * Math.PI;
    plane.setEnabled(true);
    hideAt = performance.now() + FLASH_SECONDS * 1000;
  };

  const showAt = (muzzle: BABYLON.TransformNode) => {
    muzzle.computeWorldMatrix(true);
    burst(muzzle.getAbsolutePosition());
  };

  const show = (camera: BABYLON.Camera, ignoreMeshes: BABYLON.AbstractMesh[]) => {
    const ignore = new Set(ignoreMeshes);
    origin.copyFrom(camera.globalPosition);
    camera.getDirectionToRef(BABYLON.Axis.Z, forward);
    camera.getDirectionToRef(BABYLON.Axis.X, right);
    camera.getDirectionToRef(BABYLON.Axis.Y, up);
    origin.addInPlace(right.scale(RIGHT_OFFSET));
    origin.addInPlace(up.scale(-DOWN_OFFSET));

    let distance = AIM_DISTANCE;
    ray.origin.copyFrom(origin);
    ray.direction.copyFrom(forward);
    ray.length = MAX_DISTANCE;
    const hit = scene.pickWithRay(ray, (mesh) => {
      if (ignorable(mesh, ignore)) return false;
      return mesh.checkCollisions || mesh.isPickable;
    }, false);
    if (hit?.hit && typeof hit.distance === 'number') {
      distance = Math.min(AIM_DISTANCE, Math.max(MIN_DISTANCE, hit.distance - 0.08));
    }

    burst(origin.add(forward.scale(distance)));
  };

  const update = () => {
    if (plane.isEnabled() && performance.now() >= hideAt) plane.setEnabled(false);
  };

  const hide = () => {
    plane.setEnabled(false);
    hideAt = 0;
  };

  return { mesh: plane, show, showAt, update, hide };
};
