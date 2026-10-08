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
  const box = scene.getMeshByName(NIGHT_CITY_SKYBOX_NAME);
  const cube = scene.getTextureByName('night-city-cube');
  box?.dispose(false, true);
  cube?.dispose();
};

export const applySkyboxForTheme = (scene: BABYLON.Scene, themeName: string) => {
  const wantsCity = CITY_SKYBOX_THEMES.has(themeName);
  const existing = scene.getMeshByName(NIGHT_CITY_SKYBOX_NAME);
  if (!wantsCity) {
    disposeSkybox(scene);
    return;
  }
  // Recreating the cube while the previous 6 faces are still loading unbinds the
  // GL texture; their onload then fires texImage2D / generateMipmap with nothing bound.
  if (existing) return;

  // Six WebP faces. noMipmap: skyboxes don’t need mips, and CreateFromImages
  // generateMipmap races the cube bind. Do not assign scene.environmentTexture.
  const cube = BABYLON.CubeTexture.CreateFromImages(NIGHT_CITY_FACES, scene, true);
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
