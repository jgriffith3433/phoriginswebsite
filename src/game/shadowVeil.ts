import * as BABYLON from '@babylonjs/core';

import type { PlayerAvatar } from './playerAvatar';

const WISPS = 26;

/**
 * Shadow mode: the body stays partly see-through and faint wisps peel off the skin.
 * Wisps are plain meshes so they do not add a light.
 */
export const createShadowVeil = (scene: BABYLON.Scene) => {
  const material = new BABYLON.StandardMaterial('shadow-veil-mat', scene);
  material.diffuseColor = new BABYLON.Color3(0.01, 0.01, 0.015);
  material.emissiveColor = new BABYLON.Color3(0.04, 0.015, 0.07);
  material.specularColor = BABYLON.Color3.Black();
  material.alpha = 0.16;
  material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
  material.disableLighting = true;
  material.backFaceCulling = false;

  const makeWisp = (name: string) => {
    const wisp = BABYLON.MeshBuilder.CreateSphere(name, { diameter: 0.34, segments: 5 }, scene);
    wisp.material = material;
    wisp.isPickable = false;
    wisp.checkCollisions = false;
    wisp.setEnabled(false);
    return wisp;
  };

  const wisps: BABYLON.Mesh[] = [];
  for (let i = 0; i < WISPS; i += 1) wisps.push(makeWisp(`shadow-wisp-${i}`));

  type Shed = { x: number; z: number; yaw: number; left: number; age: number; wisps: BABYLON.Mesh[] };
  const sheds: Shed[] = [];

  const poseWisps = (list: BABYLON.Mesh[], x: number, z: number, yaw: number, time: number, fade: number) => {
    for (let i = 0; i < list.length; i += 1) {
      const wisp = list[i];
      const cycle = (time * 0.28 + (i * 0.37) % 1) % 1;
      const skin = 0.28 + (i % 8) * 0.16;
      const lift = cycle * 0.72;
      const out = 0.34 + cycle * 0.5;
      const sway = Math.sin(time * 0.55 + i) * 0.06 * cycle;
      const ang = yaw + (i / list.length) * Math.PI * 2 + sway;
      wisp.setEnabled(true);
      wisp.position.set(x + Math.cos(ang) * out, skin + lift, z + Math.sin(ang) * out);
      const puff = 0.38 + cycle * 1.05;
      wisp.scaling.set(puff, puff * 1.45, puff);
      wisp.visibility = (1 - cycle) * (1 - cycle) * 0.4 * fade;
    }
  };

  const tickSheds = (dt: number) => {
    for (const shed of sheds) {
      if (shed.left <= 0) {
        for (const wisp of shed.wisps) wisp.setEnabled(false);
        continue;
      }
      shed.left = Math.max(0, shed.left - dt);
      shed.age += dt;
      const fade = shed.left < 0.45 ? shed.left / 0.45 : 1;
      poseWisps(shed.wisps, shed.x, shed.z, shed.yaw, shed.age, fade);
    }
  };

  let bound: BABYLON.TransformNode | null = null;
  let body: BABYLON.AbstractMesh[] = [];
  let clock = 0;
  const matSnap = new Map<BABYLON.Material, { alpha: number; mode: number | null; fromAlbedo: boolean | null }>();

  const restoreBody = () => {
    for (const mesh of body) {
      if (!mesh.isDisposed()) mesh.visibility = 1;
    }
    for (const [material, snap] of matSnap) {
      if (material instanceof BABYLON.PBRMaterial || material instanceof BABYLON.StandardMaterial) {
        material.alpha = snap.alpha;
        material.transparencyMode = snap.mode;
        if (material instanceof BABYLON.PBRMaterial && snap.fromAlbedo !== null) {
          material.useAlphaFromAlbedoTexture = snap.fromAlbedo;
        }
      }
    }
    matSnap.clear();
    body = [];
    bound = null;
  };

  const fadeBody = (avatar: PlayerAvatar) => {
    const group = avatar.group;
    if (bound !== group) {
      restoreBody();
      bound = group;
      body = group.getChildMeshes(false);
    }
    for (const mesh of body) {
      if (mesh.isDisposed()) continue;
      mesh.visibility = 0.92;
      const material = mesh.material;
      if (!(material instanceof BABYLON.PBRMaterial) && !(material instanceof BABYLON.StandardMaterial)) continue;
      if (!matSnap.has(material)) {
        matSnap.set(material, {
          alpha: material.alpha,
          mode: material.transparencyMode,
          fromAlbedo: material instanceof BABYLON.PBRMaterial ? material.useAlphaFromAlbedoTexture : null,
        });
      }
      material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      material.alpha = 0.58;
      if (material instanceof BABYLON.PBRMaterial) material.useAlphaFromAlbedoTexture = false;
    }
  };

  return {
    shed: (x: number, z: number, yaw: number) => {
      let slot = sheds.find((entry) => entry.left <= 0);
      if (!slot) {
        const list: BABYLON.Mesh[] = [];
        for (let i = 0; i < 12; i += 1) list.push(makeWisp(`shadow-shed-${sheds.length}-${i}`));
        slot = { x, z, yaw, left: 0, age: 0, wisps: list };
        if (sheds.length >= 4) {
          const oldest = sheds.shift();
          oldest?.wisps.forEach((wisp) => wisp.dispose(false, false));
        }
        sheds.push(slot);
      }
      slot.x = x;
      slot.z = z;
      slot.yaw = yaw;
      slot.left = 2.6;
      slot.age = 0;
    },
    update: (on: boolean, avatar: PlayerAvatar, x: number, z: number, yaw: number, dt: number) => {
      clock += dt;
      tickSheds(dt);
      if (!on) {
        restoreBody();
        bound = null;
        body = [];
        for (const wisp of wisps) wisp.setEnabled(false);
        return;
      }
      fadeBody(avatar);
      poseWisps(wisps, x, z, yaw, clock, 1);
    },
    dispose: () => {
      restoreBody();
      for (const wisp of wisps) wisp.dispose(false, false);
      for (const shed of sheds) shed.wisps.forEach((wisp) => wisp.dispose(false, false));
      sheds.length = 0;
      material.dispose();
    },
  };
};
