import * as BABYLON from '@babylonjs/core';

import { applySkyboxForTheme } from './skybox';

export const MENU_CAMERA_NAME = 'menuCamera';

/**
 * Start-screen camera. The night-city cube is infinite-distance, so only
 * look direction matters: +Z is the moon skyline face.
 */
export const createMenuCamera = (scene: BABYLON.Scene) => {
  const camera = new BABYLON.UniversalCamera(MENU_CAMERA_NAME, new BABYLON.Vector3(48, 6.2, 58), scene);
  camera.fov = 1.05;
  camera.minZ = 0.2;
  camera.maxZ = 500;
  camera.inertia = 0;
  camera.inputs.clear();
  camera.setTarget(new BABYLON.Vector3(48, 18, 140));
  camera.upVector.set(0, 1, 0);
  return camera;
};

export const activateMenuCamera = (scene: BABYLON.Scene, camera: BABYLON.Camera) => {
  applySkyboxForTheme(scene, 'Apex Peak');
  scene.activeCamera = camera;
};

export const activateGameCamera = (scene: BABYLON.Scene, camera: BABYLON.Camera) => {
  scene.activeCamera = camera;
};
