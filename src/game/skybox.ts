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

/** A face that 503s (host hiccup) is retried, then replaced so the cube never has a hole. */
const loadFace = async (url: string): Promise<string | null> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return URL.createObjectURL(await res.blob());
    } catch {
      /* retry */
    }
    await new Promise((r) => window.setTimeout(r, 300 * (attempt + 1)));
  }
  return null;
};

const darkFace = () => {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#05070d';
    g.fillRect(0, 0, 512, 512);
  }
  return c.toDataURL('image/png');
};

const pendingFaces = new WeakMap<BABYLON.Scene, Promise<void>>();

const CITY_SKYBOX_THEMES = new Set(['Apex Peak', 'Street']);

const disposeCubeWhenReady = (cube: BABYLON.BaseTexture | null) => {
  if (!(cube instanceof BABYLON.CubeTexture) || !cube.getScene()) return;
  // Disposing a cube while its faces are still uploading unbinds the GL texture.
  // The late onload then breaks every texture created after it, and the next level is flat grey.
  if (!cube.isReady()) {
    cube.onLoadObservable.addOnce(() => {
      if (cube.getScene()) cube.dispose();
    });
    return;
  }
  cube.dispose();
};

export const disposeSkybox = (scene: BABYLON.Scene) => {
  const box = scene.getMeshByName(NIGHT_CITY_SKYBOX_NAME);
  const material = box?.material;
  if (material instanceof BABYLON.StandardMaterial) material.reflectionTexture = null;
  const cube = scene.getTextureByName('night-city-cube');
  box?.dispose(false, false);
  material?.dispose(false, false);
  disposeCubeWhenReady(cube);
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
  material.disableDepthWrite = true;
  box.material = material;

  const pending = Promise.all(NIGHT_CITY_FACES.map(loadFace)).then((loaded) => {
    const urls: string[] = [];
    const blobs = loaded.filter((u): u is string => !!u);
    const fallback = blobs[0] ?? darkFace();
    for (const u of loaded) urls.push(u ?? fallback);
    if (blobs.length < loaded.length) console.warn('Skybox: a face failed to load; using a fallback for it');
    // Skybox was disposed (level change) while the faces downloaded.
    if (scene.isDisposed || scene.getMeshByName(NIGHT_CITY_SKYBOX_NAME) !== box) {
      blobs.forEach((u) => URL.revokeObjectURL(u));
      return;
    }
    const cube = BABYLON.CubeTexture.CreateFromImages(urls, scene, true);
    cube.name = 'night-city-cube';
    cube.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
    material.reflectionTexture = cube;
    cube.onLoadObservable.addOnce(() => blobs.forEach((u) => URL.revokeObjectURL(u)));
  });
  pendingFaces.set(scene, pending);
};

/** Resolves once the night-city faces are uploaded, or immediately when this theme has no cube. */
export const whenSkyboxReady = async (scene: BABYLON.Scene) => {
  await pendingFaces.get(scene);
  return whenCubeReady(scene);
};

const whenCubeReady = (scene: BABYLON.Scene) =>
  new Promise<void>((resolve) => {
    const texture = scene.getTextureByName('night-city-cube');
    if (!(texture instanceof BABYLON.CubeTexture)) {
      resolve();
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    if (texture.isReady()) {
      done();
      return;
    }
    const timer = window.setTimeout(done, 8000);
    texture.onLoadObservable.addOnce(() => {
      window.clearTimeout(timer);
      done();
    });
  });
