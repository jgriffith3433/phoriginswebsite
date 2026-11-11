import * as BABYLON from '@babylonjs/core';

import { createTraffic, type Traffic } from './traffic';
import { createCityWorld, type CityWorld } from './world';

/**
 * The Going Home city, seen from Pierce's office on the 58th floor.
 * The office sits where the tower top would be, so the tower itself is not drawn
 * and neighbours over the office footprint are cut below the floor.
 */

/** Office scene point that sits over the tower centre, and the floor height in the city. */
const OFFICE_CENTER = { x: 25, z: 23 };
const TOWER_CENTER = { x: 0, z: 6.85 };
const FLOOR_HEIGHT = 205;

/** What the traffic steps with each frame: fixed here, so the render loop allocates nothing. */
const TRAFFIC_FOCUS = { x: TOWER_CENTER.x, z: TOWER_CENTER.z + 40 };
const TRAFFIC_FACING = { fx: 0, fz: 1 };
const NO_HIT = () => {};

/** Near plane while a far-plane city is on screen (quality rule 2). */
export const CITY_NEAR = 0.2;

/**
 * Skybox behind the office windows. The cube's sky is near black (about 5, 10, 21 of 255 at the top), and the city
 * under the glass only fills the last few degrees below the horizon, so the rest of the window read as a flat black
 * void (smoke@live, boardroom). The cube is lifted, and a night-blue floor is added under it so the window is never
 * black, even for the frames before the six faces have uploaded.
 */
const SKY_LEVEL = 4.2;
const SKY_GLOW = new BABYLON.Color3(0.03, 0.05, 0.11);

export const createCityView = (scene: BABYLON.Scene, camera: BABYLON.Camera) => {
  let world: CityWorld | null = null;
  let traffic: Traffic | null = null;
  let savedMaxZ = 0;
  let savedMinZ = 0;
  const mobile = typeof document !== 'undefined' && document.body.dataset.device !== 'desktop';

  const syncSkybox = (highAltitude: boolean) => {
    const sky = scene.getMeshByName('apex-night-city-skybox');
    if (!sky) return;
    const drop = highAltitude && scene.activeCamera?.name !== 'menuCamera' ? -20 : 0;
    if (sky.position.y !== drop) sky.position.y = drop;
    // Seen through the 58th-floor windows the night sky grades to pure black (a void behind the hall's far end and the
    // boardroom's back wall). Lift the cube so the navy sky and skyline read; the street keeps its own level.
    const material = sky.material as BABYLON.StandardMaterial | null;
    const cube = material?.reflectionTexture;
    const level = highAltitude ? SKY_LEVEL : 1;
    if (cube && cube.level !== level) cube.level = level;
    if (material) {
      const glow = highAltitude ? SKY_GLOW : BABYLON.Color3.Black();
      if (!material.emissiveColor.equals(glow)) material.emissiveColor.copyFrom(glow);
    }
  };

  const dispose = () => {
    syncSkybox(false);
    traffic?.dispose();
    traffic = null;
    world?.dispose();
    world = null;
    if (savedMaxZ) camera.maxZ = savedMaxZ;
    if (savedMinZ) camera.minZ = savedMinZ;
    savedMaxZ = 0;
    savedMinZ = 0;
  };

  return {
    mounted: () => !!world,
    mount: () => {
      if (world) return;
      const offset = { x: OFFICE_CENTER.x - TOWER_CENTER.x, y: -FLOOR_HEIGHT, z: OFFICE_CENTER.z - TOWER_CENTER.z };
      world = createCityWorld(scene, {
        mobile,
        offset,
        view: true,
        load: mobile ? 420 : 680,
        cap: { minX: -40, maxX: 44, minZ: -36, maxZ: 46, height: FLOOR_HEIGHT - 14 },
      });
      world.setEnv({
        fogDensity: mobile ? 0.0013 : 0.001,
        fogColor: new BABYLON.Color3(0.035, 0.036, 0.05),
        boost: 2.4,
        flareScale: 1.25,
        ambient: new BABYLON.Color3(0.15, 0.16, 0.2),
      });
      world.mount(TOWER_CENTER.x, TOWER_CENTER.z);
      traffic = createTraffic(scene, world, mobile ? 8 : 14);
      traffic.mount(TOWER_CENTER.x, TOWER_CENTER.z + 40);
      savedMaxZ = camera.maxZ;
      camera.maxZ = Math.max(camera.maxZ, 2200);
      // A 2.2 km far plane on a 0.12 m near plane leaves centimetres of depth precision across the city: z-fighting
      // on distant facades (quality rule 2). A slightly further near plane buys most of it back.
      savedMinZ = camera.minZ;
      camera.minZ = Math.max(camera.minZ, CITY_NEAR);
      syncSkybox(true);
    },
    step: (dt: number) => {
      if (!world) return;
      syncSkybox(true);
      world.step(TOWER_CENTER.x, TOWER_CENTER.z, dt);
      traffic?.step(dt, TRAFFIC_FOCUS, TRAFFIC_FACING, false, NO_HIT);
    },
    dispose,
  };
};

export type CityView = ReturnType<typeof createCityView>;
