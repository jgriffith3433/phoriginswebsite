import * as BABYLON from '@babylonjs/core';

/** Visual-only cube (not scene.environmentTexture) so PBR characters stay matte. */
export const NIGHT_CITY_SKYBOX_NAME = 'apex-night-city-skybox';

/** Full URLs, CubeTexture order: px, py, pz, nx, ny, nz */
const NIGHT_CITY_FACES = [
  '/assets/textures/skybox/night-city_px.webp',
  '/assets/textures/skybox/night-city_py.webp',
  '/assets/textures/skybox/night-city_pz.webp',
  '/assets/textures/skybox/night-city_nx.webp',
  '/assets/textures/skybox/night-city_ny.webp',
  '/assets/textures/skybox/night-city_nz.webp',
];

const CITY_SKYBOX_THEMES = new Set(['Apex Peak']);

export const disposeSkybox = (scene: BABYLON.Scene) => {
  scene.getMeshByName(NIGHT_CITY_SKYBOX_NAME)?.dispose(false, true);
};

export const applySkyboxForTheme = (scene: BABYLON.Scene, themeName: string) => {
  disposeSkybox(scene);
  if (!CITY_SKYBOX_THEMES.has(themeName)) return;

  // Six WebP faces. Do not assign scene.environmentTexture (IBL would chrome PBR).
  const cube = BABYLON.CubeTexture.CreateFromImages(NIGHT_CITY_FACES, scene);
  cube.name = 'night-city-cube';
  cube.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;

  const box = BABYLON.MeshBuilder.CreateBox(NIGHT_CITY_SKYBOX_NAME, { size: 180 }, scene);
  box.infiniteDistance = true;
  box.applyFog = false;
  box.isPickable = false;
  box.checkCollisions = false;

  const material = new BABYLON.StandardMaterial(`${NIGHT_CITY_SKYBOX_NAME}-mat`, scene);
  material.backFaceCulling = false;
  material.disableLighting = true;
  material.diffuseColor = BABYLON.Color3.Black();
  material.specularColor = BABYLON.Color3.Black();
  material.reflectionTexture = cube;
  material.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
  material.disableDepthWrite = true;
  box.material = material;
};
