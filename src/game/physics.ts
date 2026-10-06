import * as BABYLON from '@babylonjs/core';

export type Projectile = {
  mesh: BABYLON.Mesh;
  direction: BABYLON.Vector3;
  life: number;
  speed: number;
  damage: number;
};

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

export const createProjectile = (scene: BABYLON.Scene, origin: BABYLON.Vector3, direction: BABYLON.Vector3): Projectile => {
  const projectile = BABYLON.MeshBuilder.CreateSphere('projectile', { diameter: 0.18 }, scene);
  projectile.position = origin.clone();

  const material = new BABYLON.StandardMaterial('projectileMat', scene);
  material.emissiveColor = new BABYLON.Color3(0.8, 0.95, 1);
  material.diffuseColor = new BABYLON.Color3(0.35, 0.6, 1);
  projectile.material = material;

  return {
    mesh: projectile,
    direction: direction.clone(),
    life: 1.2,
    speed: 32,
    damage: 1,
  };
};

export const stepProjectiles = (
  projectiles: Projectile[],
  enemies: Array<{ mesh: BABYLON.Mesh; hp: number }>,
  delta: number,
  onHit: (enemy: { mesh: BABYLON.Mesh; hp: number }) => void,
) => {
  for (const projectile of projectiles) {
    projectile.mesh.position.addInPlace(projectile.direction.scale(projectile.speed * delta));
    projectile.life -= delta;

    if (projectile.life <= 0) {
      projectile.mesh.dispose();
      continue;
    }

    for (const enemy of enemies) {
      const dist = BABYLON.Vector3.Distance(enemy.mesh.position, projectile.mesh.position);
      if (dist < 1.2) {
        enemy.hp -= projectile.damage;
        projectile.life = 0;
        projectile.mesh.dispose();
        onHit(enemy);
        break;
      }
    }
  }

  for (let i = projectiles.length - 1; i >= 0; i--) {
    if (projectiles[i].life <= 0) {
      projectiles.splice(i, 1);
    }
  }
};
