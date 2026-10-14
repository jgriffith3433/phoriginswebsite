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

export const createCityView = (scene: BABYLON.Scene, camera: BABYLON.Camera) => {
  let world: CityWorld | null = null;
  let traffic: Traffic | null = null;
  let savedMaxZ = 0;
  const mobile = typeof document !== 'undefined' && document.body.dataset.device !== 'desktop';

  const dispose = () => {
    traffic?.dispose();
    traffic = null;
    world?.dispose();
    world = null;
    if (savedMaxZ) camera.maxZ = savedMaxZ;
    savedMaxZ = 0;
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
    },
    step: (dt: number) => {
      if (!world) return;
      world.step(TOWER_CENTER.x, TOWER_CENTER.z, dt);
      traffic?.step(dt, { x: TOWER_CENTER.x, z: TOWER_CENTER.z + 40 }, { fx: 0, fz: 1 }, false, () => {});
    },
    dispose,
  };
};

export type CityView = ReturnType<typeof createCityView>;
