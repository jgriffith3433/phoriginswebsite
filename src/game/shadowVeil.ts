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
  type PathPoint = { x: number; y: number; z: number; t: number };
  const path: PathPoint[] = [];
  let motionT = 0;
  let prevX = 0;
  let prevY = 0;
  let prevZ = 0;
  let havePrev = false;
  let svx = 0;
  let svy = 0;
  let svz = 0;
  const smooth = wisps.map(() => ({ x: 0, y: 0, z: 0, ready: false }));
  const up = new BABYLON.Vector3(0, 1, 0);
  const axis = new BABYLON.Vector3();

  const resetMotion = () => {
    path.length = 0;
    havePrev = false;
    svx = 0;
    svy = 0;
    svz = 0;
    for (const spot of smooth) spot.ready = false;
    for (const wisp of wisps) {
      if (wisp.rotationQuaternion) wisp.rotationQuaternion.set(0, 0, 0, 1);
    }
  };

  const stepMotion = (x: number, y: number, z: number, dt: number) => {
    const step = Math.max(dt, 1 / 240);
    if (!havePrev) {
      havePrev = true;
      prevX = x;
      prevY = y;
      prevZ = z;
    }
    let vx = (x - prevX) / step;
    let vy = (y - prevY) / step;
    let vz = (z - prevZ) / step;
    prevX = x;
    prevY = y;
    prevZ = z;
    const spike = Math.hypot(vx, vy, vz);
    if (spike > 18) {
      const scale = 18 / spike;
      vx *= scale;
      vy *= scale;
      vz *= scale;
    }
    const blend = 1 - Math.exp(-Math.min(step, 0.05) * 8);
    svx += (vx - svx) * blend;
    svy += (vy - svy) * blend;
    svz += (vz - svz) * blend;
    motionT += step;
    const last = path[path.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y, z - last.z) > 30) path.length = 0;
    path.push({ x, y, z, t: motionT });
    const horizon = motionT - 0.7;
    while (path.length > 2 && path[1].t < horizon) path.shift();
  };

  const samplePath = (age: number) => {
    const newest = path[path.length - 1];
    if (!newest) return { x: prevX, y: prevY, z: prevZ };
    const when = motionT - age;
    if (path.length === 1 || when >= newest.t) return newest;
    if (when <= path[0].t) return path[0];
    for (let i = path.length - 2; i >= 0; i -= 1) {
      const a = path[i];
      if (a.t <= when) {
        const b = path[i + 1];
        const u = (when - a.t) / Math.max(1e-4, b.t - a.t);
        return {
          x: a.x + (b.x - a.x) * u,
          y: a.y + (b.y - a.y) * u,
          z: a.z + (b.z - a.z) * u,
        };
      }
    }
    return newest;
  };

  const leanWisp = (wisp: BABYLON.Mesh, dx: number, dy: number, dz: number, amount: number) => {
    if (!wisp.rotationQuaternion) wisp.rotationQuaternion = BABYLON.Quaternion.Identity();
    if (amount < 0.04) {
      wisp.rotationQuaternion.set(0, 0, 0, 1);
      return;
    }
    const len = Math.hypot(dx, dy, dz) || 1;
    axis.set(
      (dx / len) * amount,
      (1 - amount) + (dy / len) * amount,
      (dz / len) * amount,
    );
    axis.normalize();
    BABYLON.Quaternion.FromUnitVectorsToRef(up, axis, wisp.rotationQuaternion);
  };

  const settle = (index: number, gx: number, gy: number, gz: number, dt: number, rate: number) => {
    const spot = smooth[index];
    if (!spot.ready) {
      spot.ready = true;
      spot.x = gx;
      spot.y = gy;
      spot.z = gz;
      return spot;
    }
    const k = 1 - Math.exp(-Math.min(dt, 0.05) * rate);
    spot.x += (gx - spot.x) * k;
    spot.y += (gy - spot.y) * k;
    spot.z += (gz - spot.z) * k;
    return spot;
  };
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

  const fadeBody = (avatar: PlayerAvatar, rush: boolean) => {
    const group = avatar.group;
    if (bound !== group) {
      restoreBody();
      bound = group;
      body = group.getChildMeshes(false);
    }
    for (const mesh of body) {
      if (mesh.isDisposed()) continue;
      mesh.visibility = rush ? 0.04 : 0.92;
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
      material.alpha = rush ? 0.04 : 0.58;
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
    update: (on: boolean, avatar: PlayerAvatar, x: number, z: number, yaw: number, dt: number, rush = false, liftY = 0) => {
      clock += dt;
      tickSheds(dt);
      if (!on) {
        restoreBody();
        bound = null;
        body = [];
        resetMotion();
        for (const wisp of wisps) wisp.setEnabled(false);
        return;
      }
      if (dt > 0) stepMotion(x, liftY, z, dt);
      fadeBody(avatar, rush);
      const spd = Math.hypot(svx, svy, svz);
      const inv = spd > 0.2 ? 1 / spd : 0;
      const mx = svx * inv;
      const my = svy * inv;
      const mz = svz * inv;
      if (!rush) {
        material.alpha = 0.16;
        material.emissiveColor.set(0.04, 0.015, 0.07);
        const lean = Math.min(1, spd / 2.4);
        const back = 0.2 * lean;
        const ox = x - mx * back;
        const oy = liftY - my * back;
        const oz = z - mz * back;
        for (let i = 0; i < wisps.length; i += 1) {
          const wisp = wisps[i];
          const cycle = (clock * 0.28 + (i * 0.37) % 1) % 1;
          const skin = 0.28 + (i % 8) * 0.16;
          const lift = cycle * 0.72;
          const ang = yaw + (i / wisps.length) * Math.PI * 2 + Math.sin(clock * 0.55 + i) * 0.06 * cycle;
          const trail = Math.max(0, -(Math.cos(ang) * mx + Math.sin(ang) * mz));
          const out = 0.34 + cycle * 0.5 + trail * 0.18 * lean;
          const spot = settle(
            i,
            ox + Math.cos(ang) * out,
            oy + skin + lift - my * trail * 0.32 * lean,
            oz + Math.sin(ang) * out,
            dt,
            18,
          );
          wisp.setEnabled(true);
          wisp.position.copyFromFloats(spot.x, spot.y, spot.z);
          const puff = 0.38 + cycle * 1.05;
          wisp.scaling.set(puff * 0.82, puff * 1.45, puff * 0.82);
          wisp.visibility = (1 - cycle) * (1 - cycle) * 0.4;
          leanWisp(wisp, mx, my, mz, lean * 0.8);
        }
        return;
      }
      material.alpha = 0.72;
      material.emissiveColor.set(0.01, 0.01, 0.012);
      const pathWeight = Math.min(1, Math.max(0, (spd - 0.6) / 2.2));
      const faceX = Math.sin(yaw);
      const faceZ = Math.cos(yaw);
      for (let i = 0; i < wisps.length; i += 1) {
        const wisp = wisps[i];
        const along = i / Math.max(1, wisps.length - 1);
        const back = along * 4.2;
        const age = Math.min(0.48, back / Math.max(spd, 2.8));
        const sample = samplePath(age + 0.03);
        const newer = samplePath(Math.max(0, age + 0.03 - 0.06));
        let dx = newer.x - sample.x;
        let dy = newer.y - sample.y;
        let dz = newer.z - sample.z;
        const len = Math.hypot(dx, dy, dz);
        if (len > 0.05) {
          dx /= len;
          dy /= len;
          dz /= len;
        } else if (spd > 0.4) {
          dx = mx;
          dy = my;
          dz = mz;
        } else {
          dx = faceX;
          dy = 0;
          dz = faceZ;
        }
        let sideX = -dz;
        let sideZ = dx;
        if (sideX * sideX + sideZ * sideZ < 0.05) {
          sideX = 1;
          sideZ = 0;
        }
        const sway = Math.sin(clock * 7 + i * 0.8) * (0.1 + back * 0.07);
        const chest = 0.5 + Math.sin(clock * 5 + i) * 0.1 + (i % 4) * 0.05;
        const flatX = x - faceX * (back + 0.16) + faceZ * sway;
        const flatY = liftY + chest;
        const flatZ = z - faceZ * (back + 0.16) - faceX * sway;
        const pathX = sample.x - dx * 0.16 + sideX * sway;
        const pathY = sample.y + chest;
        const pathZ = sample.z - dz * 0.16 + sideZ * sway;
        const spot = settle(
          i,
          flatX + (pathX - flatX) * pathWeight,
          flatY + (pathY - flatY) * pathWeight,
          flatZ + (pathZ - flatZ) * pathWeight,
          dt,
          36 - along * 18,
        );
        wisp.setEnabled(true);
        wisp.position.copyFromFloats(spot.x, spot.y, spot.z);
        const puff = 0.7 + (1 - along) * 1.05;
        wisp.scaling.set(puff * 0.62, puff * 1.35, puff * 0.62);
        wisp.visibility = 0.85 * (1 - back / 5.2);
        leanWisp(
          wisp,
          faceX + (dx - faceX) * pathWeight,
          dy * pathWeight,
          faceZ + (dz - faceZ) * pathWeight,
          0.4 + 0.6 * pathWeight,
        );
      }
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
