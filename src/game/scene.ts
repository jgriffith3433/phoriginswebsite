import * as BABYLON from '@babylonjs/core';

export type SceneThemeName = 'Neon Drift' | 'Crimson Surge' | 'Arctic Rift';

export type SceneTheme = {
  name: SceneThemeName;
  skyTop: BABYLON.Color3;
  skyBottom: BABYLON.Color3;
  fog: BABYLON.Color3;
  ground: BABYLON.Color3;
  ambient: BABYLON.Color3;
  hemiIntensity: number;
  sunIntensity: number;
  fogDistance: number;
};

const themes: Record<SceneThemeName, SceneTheme> = {
  'Neon Drift': {
    name: 'Neon Drift',
    skyTop: new BABYLON.Color3(0.04, 0.08, 0.12),
    skyBottom: new BABYLON.Color3(0.06, 0.12, 0.17),
    fog: new BABYLON.Color3(0.04, 0.08, 0.12),
    ground: new BABYLON.Color3(0.13, 0.22, 0.27),
    ambient: new BABYLON.Color3(0.26, 0.32, 0.40),
    hemiIntensity: 0.8,
    sunIntensity: 0.9,
    fogDistance: 80,
  },
  'Crimson Surge': {
    name: 'Crimson Surge',
    skyTop: new BABYLON.Color3(0.12, 0.04, 0.06),
    skyBottom: new BABYLON.Color3(0.18, 0.06, 0.08),
    fog: new BABYLON.Color3(0.09, 0.03, 0.04),
    ground: new BABYLON.Color3(0.2, 0.12, 0.10),
    ambient: new BABYLON.Color3(0.45, 0.22, 0.20),
    hemiIntensity: 0.9,
    sunIntensity: 1.2,
    fogDistance: 74,
  },
  'Arctic Rift': {
    name: 'Arctic Rift',
    skyTop: new BABYLON.Color3(0.05, 0.09, 0.14),
    skyBottom: new BABYLON.Color3(0.10, 0.18, 0.22),
    fog: new BABYLON.Color3(0.08, 0.14, 0.18),
    ground: new BABYLON.Color3(0.12, 0.18, 0.20),
    ambient: new BABYLON.Color3(0.20, 0.30, 0.38),
    hemiIntensity: 0.7,
    sunIntensity: 0.8,
    fogDistance: 90,
  },
};

export const getSceneTheme = (theme: string): SceneTheme => {
  return themes[(theme as SceneThemeName) in themes ? (theme as SceneThemeName) : 'Neon Drift'];
};

export const applyTheme = (scene: BABYLON.Scene, themeName: string) => {
  const theme = getSceneTheme(themeName);
  scene.clearColor = new BABYLON.Color4(theme.skyBottom.r, theme.skyBottom.g, theme.skyBottom.b, 1);
  scene.fogColor = theme.fog;
  scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
  scene.fogStart = 10;
  scene.fogEnd = theme.fogDistance;
  scene.ambientColor = theme.ambient;

  const lighting = scene.getLightByName('sun');
  const hemi = scene.getLightByName('hemi');
  if (lighting && lighting instanceof BABYLON.DirectionalLight) {
    lighting.intensity = theme.sunIntensity;
  }
  if (hemi && hemi instanceof BABYLON.HemisphericLight) {
    hemi.intensity = theme.hemiIntensity;
  }

  return theme;
};

export const createArena = (scene: BABYLON.Scene, arenaSize = 90, themeName = 'Neon Drift') => {
  const theme = getSceneTheme(themeName);
  const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: arenaSize, height: arenaSize }, scene);
  ground.position.y = -0.5;

  const groundMat = new BABYLON.StandardMaterial('groundMat', scene);
  groundMat.diffuseColor = theme.ground;
  groundMat.emissiveColor = theme.ground.scale(0.35);
  ground.material = groundMat;

  const wallMat = new BABYLON.StandardMaterial('wallMat', scene);
  wallMat.diffuseColor = new BABYLON.Color3(0.2, 0.24, 0.32);
  wallMat.emissiveColor = new BABYLON.Color3(0.06, 0.08, 0.1);

  const wallCount = Math.max(8, Math.min(18, Math.round(arenaSize / 6)));
  for (let i = 0; i < wallCount; i++) {
    const wall = BABYLON.MeshBuilder.CreateBox(`wall-${i}`, { width: 4, height: 4, depth: 1 }, scene);
    wall.position = new BABYLON.Vector3((i - wallCount / 2) * (arenaSize / wallCount), 2, -arenaSize * 0.32 + (i % 3) * (arenaSize * 0.22));
    wall.material = wallMat;
  }

  const pillarMat = new BABYLON.StandardMaterial('pillarMat', scene);
  pillarMat.diffuseColor = new BABYLON.Color3(0.25, 0.28, 0.35);
  const pillarCount = Math.max(6, Math.min(12, Math.round(arenaSize / 10)));
  for (let i = 0; i < pillarCount; i++) {
    const pillar = BABYLON.MeshBuilder.CreateCylinder(`pillar-${i}`, { height: 5, diameter: 1.2 }, scene);
    pillar.position = new BABYLON.Vector3(-arenaSize * 0.42 + (i % 3) * (arenaSize * 0.25), 2.5, -arenaSize * 0.42 + (Math.floor(i / 3) * (arenaSize * 0.25)));
    pillar.material = pillarMat;
  }

  return theme;
};
