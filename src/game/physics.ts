import * as BABYLON from '@babylonjs/core';

export type Particle = {
  mesh: BABYLON.Mesh;
  velocity: BABYLON.Vector3;
  life: number;
};

export const clampValue = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const createBurst = (
  scene: BABYLON.Scene,
  x: number,
  y: number,
  z: number,
  color: BABYLON.Color3,
  particles: Particle[],
) => {
  for (let i = 0; i < 12; i++) {
    const mesh = BABYLON.MeshBuilder.CreateSphere(`particle-${Math.random()}`, { diameter: 0.22 }, scene);
    mesh.position = new BABYLON.Vector3(x, y, z);
    const material = new BABYLON.StandardMaterial(`particleMat-${Math.random()}`, scene);
    material.diffuseColor = color;
    material.emissiveColor = color;
    mesh.material = material;
    particles.push({
      mesh,
      velocity: new BABYLON.Vector3((Math.random() - 0.5) * 2.8, (Math.random() - 0.5) * 2.8, (Math.random() - 0.5) * 2.8),
      life: 0.7,
    });
  }
};
