import * as BABYLON from '@babylonjs/core';

import { importGlbUnderParent } from './modelLoader';
import type { PlayerAvatar } from './playerAvatar';

export const PISTOL_ASSET_PATH = '/assets/models/tt_pistol.glb';
const TEXTURE_ROOT = '/assets/textures/tt_pistol';

/** Barrel tip in original FBX space. */
const MUZZLE_IN_MESH = new BABYLON.Vector3(0.031, 0.113, 0.117);
/** World-space length of the pistol in the hand (TT is ~20cm). */
const TARGET_WORLD_LENGTH = 0.2;
/**
 * Mixamo RightHand: +Y along the fingers (aim in the pistol pose).
 * Rx(180) aims the muzzle forward. Ry(90) rolls the slide upright.
 */
const HAND_ROTATION = new BABYLON.Vector3(Math.PI, -Math.PI / 2, 0);
/** Metres: +Y along fingers into the fist, -Z from under the wrist up into the palm. */
const PALM_METERS = new BABYLON.Vector3(-3, 15, -3);

export type PlayerPistol = {
  meshes: BABYLON.AbstractMesh[];
  muzzle: BABYLON.TransformNode;
  attachTo: (avatar: PlayerAvatar | null) => void;
  setVisible: (visible: boolean) => void;
  isVisible: () => boolean;
  dispose: () => void;
};

const loadTexture = (scene: BABYLON.Scene, file: string) => {
  const texture = new BABYLON.Texture(`${TEXTURE_ROOT}/${file}`, scene, false, false);
  texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  return texture;
};

const applyPistolMaterials = (scene: BABYLON.Scene, meshes: BABYLON.AbstractMesh[]) => {
  const albedo = loadTexture(scene, 'tt_pistol_Albedo.png');
  albedo.hasAlpha = false;
  const material = new BABYLON.StandardMaterial('ttPistolMat', scene);
  material.diffuseTexture = albedo;
  material.ambientTexture = loadTexture(scene, 'tt_pistol_AO.png');
  material.bumpTexture = loadTexture(scene, 'tt_pistol_Normal.png');
  material.specularTexture = loadTexture(scene, 'tt_pistol_Metallic.png');
  material.specularColor = new BABYLON.Color3(0.55, 0.55, 0.58);
  material.specularPower = 48;
  material.emissiveTexture = albedo;
  material.emissiveColor = new BABYLON.Color3(0.28, 0.28, 0.3);
  material.useAlphaFromDiffuseTexture = false;
  material.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
  material.backFaceCulling = false;
  material.alpha = 1;

  for (const mesh of meshes) {
    if (!mesh.getTotalVertices()) continue;
    mesh.material = material;
    if (mesh instanceof BABYLON.Mesh) mesh.sideOrientation = BABYLON.Mesh.DOUBLESIDE;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.isVisible = true;
    mesh.visibility = 1;
    mesh.setEnabled(true);
    mesh.alwaysSelectAsActiveMesh = true;
  }
};

const stripImportedAlpha = (mesh: BABYLON.AbstractMesh) => {
  const material = mesh.material;
  if (!material) return;
  material.backFaceCulling = false;
  material.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
  material.alpha = 1;
  if (material instanceof BABYLON.PBRMaterial) {
    material.albedoTexture && (material.albedoTexture.hasAlpha = false);
    material.useAlphaFromAlbedoTexture = false;
    material.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
    material.alphaCutOff = 0;
    material.backFaceCulling = false;
  }
  if (material instanceof BABYLON.StandardMaterial) {
    if (material.diffuseTexture) material.diffuseTexture.hasAlpha = false;
    material.useAlphaFromDiffuseTexture = false;
  }
};

export const createPlayerPistol = (scene: BABYLON.Scene): PlayerPistol => {
  const attach = new BABYLON.TransformNode('pistolAttach', scene);
  attach.rotation.copyFrom(HAND_ROTATION);
  attach.position.set(0, 0, 0);
  attach.scaling.setAll(1);
  attach.setEnabled(false);

  const root = new BABYLON.TransformNode('pistolRoot', scene);
  root.parent = attach;

  const muzzle = new BABYLON.TransformNode('pistolMuzzle', scene);
  muzzle.parent = root;
  muzzle.position.copyFrom(MUZZLE_IN_MESH);

  const meshes: BABYLON.AbstractMesh[] = [];
  let disposed = false;
  let wantedVisible = false;
  let boundAvatar: PlayerAvatar | null = null;

  const syncVisible = () => {
    attach.setEnabled(wantedVisible);
    root.setEnabled(true);
    if (wantedVisible) {
      for (const mesh of meshes) {
        let node: BABYLON.Node | null = mesh;
        while (node && node !== attach) {
          if (node instanceof BABYLON.TransformNode) node.setEnabled(true);
          node = node.parent;
        }
        mesh.setEnabled(true);
        mesh.isVisible = true;
        mesh.visibility = 1;
      }
    }
  };

  const bindHand = (avatar: PlayerAvatar) => {
    if (disposed) return;
    try {
      attach.detachFromBone();
    } catch {
      /* not bone-attached yet */
    }
    attach.parent = null;

    const skinned = avatar.getSkinnedMesh();
    const bone = avatar.findBone('righthand');
    const joint = avatar.findJoint('righthand');
    if (bone && skinned) {
      attach.attachToBone(bone, skinned);
    } else {
      attach.parent = joint ?? avatar.group;
    }
    attach.rotationQuaternion = BABYLON.Quaternion.FromEulerVector(HAND_ROTATION);
    attach.rotation.set(0, 0, 0);
    attach.position.set(0, 0, 0);
    attach.scaling.setAll(1);
    for (const mesh of meshes) mesh.refreshBoundingInfo(true, false);
    attach.computeWorldMatrix(true);
    root.computeWorldMatrix(true);
    const bounds = root.getHierarchyBoundingVectors(true);
    const longest = Math.max(
      bounds.max.x - bounds.min.x,
      bounds.max.y - bounds.min.y,
      bounds.max.z - bounds.min.z,
    );
    if (Number.isFinite(longest) && longest > 1e-5) {
      attach.scaling.setAll(TARGET_WORLD_LENGTH / longest);
    }
    const boneScale = new BABYLON.Vector3(1, 1, 1);
    if (bone) {
      bone.getSkeleton().prepare(true);
      bone.getFinalMatrix().decompose(boneScale);
    }
    const parentS = Math.max(Math.abs(boneScale.x), Math.abs(boneScale.y), Math.abs(boneScale.z), 1e-4);
    attach.position.set(PALM_METERS.x / parentS, PALM_METERS.y / parentS, PALM_METERS.z / parentS);
    syncVisible();
  };

  const alignGripToAttach = () => {
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scaling.setAll(1);
    for (const mesh of meshes) mesh.refreshBoundingInfo(true, false);
    root.computeWorldMatrix(true);
    const bounds = root.getHierarchyBoundingVectors(true);
    const size = bounds.max.subtract(bounds.min);
    const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.z >= size.y ? 'z' : 'y';
    const grip = bounds.min.add(bounds.max).scale(0.5);
    grip[axis] = bounds.min[axis] + size[axis] * 0.22;
    const inverse = root.getWorldMatrix().clone().invert();
    const local = BABYLON.Vector3.TransformCoordinates(grip, inverse);
    root.position.subtractInPlace(local);
  };

  void importGlbUnderParent(scene, PISTOL_ASSET_PATH, root, { matte: false })
    .then((imported) => {
      if (disposed) {
        imported.meshes.forEach((mesh) => mesh.dispose());
        return;
      }
      for (const mesh of imported.meshes) {
        if (/tt_mag|_mag$/i.test(mesh.name)) {
          mesh.setEnabled(false);
          mesh.isVisible = false;
          continue;
        }
        if (!mesh.getTotalVertices()) continue;
        stripImportedAlpha(mesh);
        mesh.isVisible = true;
        mesh.visibility = 1;
        mesh.setEnabled(true);
        meshes.push(mesh);
      }
      applyPistolMaterials(scene, meshes);
      for (const mesh of meshes) {
        const rotation = mesh.rotationQuaternion ?? BABYLON.Quaternion.FromEulerVector(mesh.rotation);
        const local = BABYLON.Matrix.Compose(mesh.scaling, rotation, mesh.position);
        if (mesh instanceof BABYLON.Mesh) mesh.bakeTransformIntoVertices(local);
        mesh.position.set(0, 0, 0);
        mesh.rotationQuaternion = null;
        mesh.rotation.set(0, 0, 0);
        mesh.scaling.setAll(1);
      }
      alignGripToAttach();
      const bakedMuzzle = root.getChildTransformNodes(true).find((node) => /pistol_muzzle/i.test(node.name));
      if (bakedMuzzle) {
        muzzle.parent = bakedMuzzle;
        muzzle.position.set(0, 0, 0);
        muzzle.rotation.set(0, 0, 0);
      }
      if (boundAvatar?.isReady()) bindHand(boundAvatar);
      else syncVisible();
    })
    .catch(() => {});

  return {
    meshes,
    muzzle,
    attachTo: (avatar) => {
      try {
        attach.detachFromBone();
      } catch {
        /* not bone-attached yet */
      }
      attach.parent = null;
      boundAvatar = avatar;
      if (!avatar) return;
      avatar.whenReady(() => {
        if (boundAvatar !== avatar || disposed) return;
        bindHand(avatar);
      });
    },
    setVisible: (visible) => {
      wantedVisible = visible;
      syncVisible();
    },
    isVisible: () => wantedVisible && attach.isEnabled(),
    dispose: () => {
      disposed = true;
      boundAvatar = null;
      attach.parent = null;
      attach.dispose();
    },
  };
};
