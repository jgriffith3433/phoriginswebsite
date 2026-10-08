import * as BABYLON from '@babylonjs/core';

import { refreshCharacterProbe } from './modelLoader';
import { applySkyboxForTheme } from './skybox';

export type SceneThemeName = 'Neon Drift' | 'Crimson Surge' | 'Arctic Rift' | 'Apex Peak' | 'B3 Basement';

export type SceneTheme = {
  name: SceneThemeName;
  skyTop: BABYLON.Color3;
  skyBottom: BABYLON.Color3;
  fog: BABYLON.Color3;
  ground: BABYLON.Color3;
  wall: BABYLON.Color3;
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
    wall: new BABYLON.Color3(0.2, 0.24, 0.32),
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
    wall: new BABYLON.Color3(0.28, 0.16, 0.16),
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
    wall: new BABYLON.Color3(0.25, 0.28, 0.35),
    ambient: new BABYLON.Color3(0.20, 0.30, 0.38),
    hemiIntensity: 0.7,
    sunIntensity: 0.8,
    fogDistance: 90,
  },
  'Apex Peak': {
    name: 'Apex Peak',
    skyTop: new BABYLON.Color3(0.02, 0.03, 0.05),
    skyBottom: new BABYLON.Color3(0.04, 0.05, 0.07),
    fog: new BABYLON.Color3(0.05, 0.06, 0.08),
    ground: new BABYLON.Color3(0.07, 0.07, 0.08),
    wall: new BABYLON.Color3(0.16, 0.16, 0.17),
    ambient: new BABYLON.Color3(0.24, 0.25, 0.30),
    hemiIntensity: 0.58,
    sunIntensity: 0.33,
    fogDistance: 42,
  },
  'B3 Basement': {
    name: 'B3 Basement',
    skyTop: new BABYLON.Color3(0.015, 0.02, 0.018),
    skyBottom: new BABYLON.Color3(0.03, 0.035, 0.03),
    fog: new BABYLON.Color3(0.04, 0.05, 0.045),
    ground: new BABYLON.Color3(0.08, 0.08, 0.075),
    wall: new BABYLON.Color3(0.14, 0.15, 0.14),
    ambient: new BABYLON.Color3(0.12, 0.13, 0.12),
    hemiIntensity: 0.36,
    sunIntensity: 0.1,
    fogDistance: 54,
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
  scene.metadata = { ...(scene.metadata ?? {}), themeName: theme.name };
  applySkyboxForTheme(scene, theme.name);
  refreshCharacterProbe(scene);

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

// Note: the arena's walls/pillars/ground used to be generated procedurally
// here. They're now authored as regular scene assets (kind 'wall'/'pillar'/
// 'ground' in game/sceneData.ts) so they can be selected, moved, and edited
// in the level editor like any other object. See levels/*.json.
