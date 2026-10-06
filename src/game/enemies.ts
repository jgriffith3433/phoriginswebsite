import * as BABYLON from '@babylonjs/core';

export type EnemyKind = 'scout' | 'brute' | 'elite';

export type Enemy = {
  mesh: BABYLON.Mesh;
  root: BABYLON.TransformNode;
  leftArm: BABYLON.Mesh;
  rightArm: BABYLON.Mesh;
  leftLeg: BABYLON.Mesh;
  rightLeg: BABYLON.Mesh;
  hp: number;
  speed: number;
  bob: number;
  kind: EnemyKind;
};

export const createHumanoid = (scene: BABYLON.Scene, color: BABYLON.Color3, isEnemy: boolean) => {
  const group = new BABYLON.TransformNode(`humanoid-${Math.random()}`, scene);

  const torso = BABYLON.MeshBuilder.CreateBox(`torso-${Math.random()}`, { width: 0.8, height: 1.2, depth: 0.45 }, scene);
  torso.parent = group;
  torso.position.y = 1.3;

  const head = BABYLON.MeshBuilder.CreateSphere(`head-${Math.random()}`, { diameter: 0.5, segments: 12 }, scene);
  head.parent = group;
  head.position.y = 2.2;

  const leftArm = BABYLON.MeshBuilder.CreateBox(`larm-${Math.random()}`, { width: 0.25, height: 1.1, depth: 0.25 }, scene);
  leftArm.parent = group;
  leftArm.position = new BABYLON.Vector3(-0.55, 1.3, 0);

  const rightArm = BABYLON.MeshBuilder.CreateBox(`rarm-${Math.random()}`, { width: 0.25, height: 1.1, depth: 0.25 }, scene);
  rightArm.parent = group;
  rightArm.position = new BABYLON.Vector3(0.55, 1.3, 0);

  const leftLeg = BABYLON.MeshBuilder.CreateBox(`lleg-${Math.random()}`, { width: 0.3, height: 1.3, depth: 0.3 }, scene);
  leftLeg.parent = group;
  leftLeg.position = new BABYLON.Vector3(-0.22, 0.55, 0);

  const rightLeg = BABYLON.MeshBuilder.CreateBox(`rleg-${Math.random()}`, { width: 0.3, height: 1.3, depth: 0.3 }, scene);
  rightLeg.parent = group;
  rightLeg.position = new BABYLON.Vector3(0.22, 0.55, 0);

  const material = new BABYLON.StandardMaterial(`mat-${Math.random()}`, scene);
  material.diffuseColor = color;
  material.emissiveColor = isEnemy ? new BABYLON.Color3(0.18, 0.04, 0.08) : new BABYLON.Color3(0.04, 0.12, 0.16);

  [torso, head, leftArm, rightArm, leftLeg, rightLeg].forEach((mesh) => {
    mesh.material = material;
  });

  return { group, torso, head, leftArm, rightArm, leftLeg, rightLeg };
};

export const clearEnemies = (enemies: Enemy[]) => {
  for (const enemy of enemies) {
    enemy.mesh.dispose();
    enemy.root.dispose();
  }
  enemies.length = 0;
};

export const spawnEnemy = (scene: BABYLON.Scene, level: number): Enemy => {
  const angle = Math.random() * Math.PI * 2;
  const distance = 18 + Math.random() * 10;
  const root = BABYLON.MeshBuilder.CreateCapsule(`enemy-root-${Math.random()}`, { radius: 0.5, height: 1.8 }, scene);
  root.position = new BABYLON.Vector3(Math.cos(angle) * distance, 0.9, Math.sin(angle) * distance);

  const kind: EnemyKind = level >= 6 ? (Math.random() > 0.66 ? 'elite' : 'brute') : level >= 3 ? 'brute' : 'scout';
  const humanoid = createHumanoid(scene, new BABYLON.Color3(1, 0.3, 0.45), true);
  humanoid.group.parent = root;
  humanoid.group.position = new BABYLON.Vector3(0, -0.9, 0);

  const enemy: Enemy = {
    mesh: root,
    root: humanoid.group,
    leftArm: humanoid.leftArm,
    rightArm: humanoid.rightArm,
    leftLeg: humanoid.leftLeg,
    rightLeg: humanoid.rightLeg,
    hp: kind === 'elite' ? 4 + level : kind === 'brute' ? 3 + level : 2 + level,
    speed: kind === 'elite' ? 2.2 + level * 0.18 : kind === 'brute' ? 1.8 + level * 0.14 : 1.4 + level * 0.12,
    bob: Math.random() * Math.PI * 2,
    kind,
  };

  return enemy;
};

export const updateEnemyAI = (enemy: Enemy, target: BABYLON.Vector3, delta: number) => {
  const toPlayer = new BABYLON.Vector3(target.x - enemy.mesh.position.x, 0, target.z - enemy.mesh.position.z);
  const distance = toPlayer.length();

  if (distance > 0.001) {
    toPlayer.normalize();
    enemy.mesh.position.x += toPlayer.x * enemy.speed * delta;
    enemy.mesh.position.z += toPlayer.z * enemy.speed * delta;
  }

  const t = performance.now() * 0.006 + enemy.bob;
  const walk = Math.sin(t * 6) * 0.8;
  enemy.leftArm.rotation.x = walk;
  enemy.rightArm.rotation.x = -walk;
  enemy.leftLeg.rotation.x = -walk;
  enemy.rightLeg.rotation.x = walk;
  enemy.root.rotation.y = Math.atan2(target.x - enemy.mesh.position.x, target.z - enemy.mesh.position.z) + Math.PI;

  return distance;
};
