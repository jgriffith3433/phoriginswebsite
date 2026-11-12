import * as BABYLON from '@babylonjs/core';

/**
 * A police car for the street, built from boxes (no GLB, no scene lights): it drives in along the avenue with its light
 * bar going, brakes beside the kerb and stays. Emissive light bar only, so it costs no light slot. Driven by
 * `step(dt)`; Going Home spawns it when the ledger crosses SIREN_KILLS (`docs/story/ledger.md`).
 */
export type PoliceCar = ReturnType<typeof createPoliceCar>;

const BODY = new BABYLON.Color3(0.05, 0.06, 0.09);
const WHITE = new BABYLON.Color3(0.82, 0.84, 0.88);

const std = (scene: BABYLON.Scene, name: string, color: BABYLON.Color3, emissive?: BABYLON.Color3) => {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.specularColor = new BABYLON.Color3(0.25, 0.25, 0.28);
  if (emissive) m.emissiveColor = emissive;
  return m;
};

export const createPoliceCar = (
  scene: BABYLON.Scene,
  from: { x: number; z: number },
  stop: { x: number; z: number },
  onArrive: () => void,
) => {
  const root = new BABYLON.TransformNode('police-car', scene);
  const owned: { dispose: () => void }[] = [];
  const part = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material: BABYLON.Material) => {
    const mesh = BABYLON.MeshBuilder.CreateBox(`police-car-${name}`, { width: w, height: h, depth: d }, scene);
    mesh.parent = root;
    mesh.position.set(x, y, z);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    owned.push(mesh);
    return mesh;
  };
  const body = std(scene, 'police-car-body', BODY);
  const door = std(scene, 'police-car-door', WHITE);
  const glass = std(scene, 'police-car-glass', new BABYLON.Color3(0.02, 0.03, 0.05));
  const tyre = std(scene, 'police-car-tyre', new BABYLON.Color3(0.02, 0.02, 0.02));
  const red = std(scene, 'police-car-red', new BABYLON.Color3(0.2, 0, 0), new BABYLON.Color3(1, 0.05, 0.05));
  const blue = std(scene, 'police-car-blue', new BABYLON.Color3(0, 0, 0.2), new BABYLON.Color3(0.1, 0.25, 1));
  owned.push(body, door, glass, tyre, red, blue);
  // The car runs along +x: length on x, width on z. Wheel bottoms sit on y 0.
  part('lower', 4.7, 0.62, 1.9, 0, 0.62, 0, body);
  part('cabin', 2.3, 0.58, 1.7, -0.2, 1.2, 0, glass);
  part('roof', 2.1, 0.06, 1.62, -0.2, 1.52, 0, body);
  part('stripe-l', 3.2, 0.3, 0.02, 0.2, 0.62, 0.96, door);
  part('stripe-r', 3.2, 0.3, 0.02, 0.2, 0.62, -0.96, door);
  for (const wx of [-1.5, 1.5]) for (const wz of [-0.9, 0.9]) {
    const wheel = BABYLON.MeshBuilder.CreateCylinder('police-car-wheel', { diameter: 0.64, height: 0.26, tessellation: 12 }, scene);
    wheel.parent = root;
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(wx, 0.32, wz);
    wheel.material = tyre;
    wheel.isPickable = false;
    owned.push(wheel);
  }
  const barRed = part('bar-red', 0.28, 0.14, 0.7, -0.2, 1.62, 0.42, red);
  const barBlue = part('bar-blue', 0.28, 0.14, 0.7, -0.2, 1.62, -0.42, blue);

  const heading = Math.atan2(stop.z - from.z, stop.x - from.x);
  root.rotation.y = -heading;
  root.position.set(from.x, 0, from.z);
  const total = Math.hypot(stop.x - from.x, stop.z - from.z);
  let travelled = 0;
  let clock = 0;
  let arrived = false;
  let speed = 0;
  return {
    root,
    arrived: () => arrived,
    position: () => ({ x: root.position.x, z: root.position.z }),
    step: (dt: number) => {
      clock += dt;
      const flash = Math.floor(clock * 6) % 2 === 0;
      barRed.isVisible = flash;
      barBlue.isVisible = !flash;
      if (arrived) return;
      // Cruise at 19 m/s, brake over the last 22 m.
      const left = total - travelled;
      const want = left > 22 ? 19 : Math.max(1.5, 19 * (left / 22));
      speed += (want - speed) * Math.min(1, dt * 2.2);
      travelled = Math.min(total, travelled + speed * dt);
      root.position.x = from.x + Math.cos(heading) * travelled;
      root.position.z = from.z + Math.sin(heading) * travelled;
      if (total - travelled < 0.2) {
        arrived = true;
        onArrive();
      }
    },
    dispose: () => {
      for (const item of owned) item.dispose();
      root.dispose();
    },
  };
};
