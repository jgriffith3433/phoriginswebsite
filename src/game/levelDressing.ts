import * as BABYLON from '@babylonjs/core';

import { createCityView, type CityView } from '../story/city/cityView';
import { createStationDress, type StationDress } from '../story/stationDress';
import { createAtmosphere, type Atmosphere } from './atmosphere';
import { apexPlan } from './interior/apexPlan';
import { b3Plan } from './interior/b3Plan';
import { createInteriorDress, type InteriorDress } from './interior/dress';

/**
 * Runtime dressing that is not in the level files. The game and Dev Tools both
 * mount it from the level id, so the editor draws what the player sees.
 *
 * apex-peak:   the generated city 205 m below the office windows.
 * b3-basement: dust, light shafts, steam, a visible flashlight beam.
 * the-station: tiles, tunnels, tubes, ads, departure board, plus dust.
 * (going-home mounts its own city: the level runs it.)
 */
export type DressingContext = {
  /** Level file id: apex-peak, b3-basement, the-station, ... */
  levelId: string;
  /** The Return: the basement with the powers look. */
  powers?: boolean;
};

export const createLevelDressing = (scene: BABYLON.Scene, camera: BABYLON.Camera) => {
  let cityView: CityView | null = null;
  let atmosphere: Atmosphere | null = null;
  let station: StationDress | null = null;
  let interior: InteriorDress | null = null;
  let current = '';

  const clear = () => {
    cityView?.dispose();
    cityView = null;
    atmosphere?.dispose();
    atmosphere = null;
    station?.dispose();
    station = null;
    interior?.dispose();
    interior = null;
    current = '';
  };

  const mobile = () => typeof document !== 'undefined' && document.body.dataset.device !== 'desktop';

  return {
    mount: (ctx: DressingContext) => {
      // Always rebuild: a reload of the same level file replaces the meshes this dressing reads.
      const key = `${ctx.levelId}|${ctx.powers ? 1 : 0}`;
      clear();
      current = key;
      if (ctx.levelId === 'apex-peak') {
        interior = createInteriorDress(scene, apexPlan);
        cityView = createCityView(scene, camera);
        cityView.mount();
      } else if (ctx.levelId === 'b3-basement') {
        const powers = !!ctx.powers;
        interior = createInteriorDress(scene, b3Plan);
        const steam: { x: number; y: number; z: number; up?: number }[] = [];
        for (const mesh of scene.meshes) {
          const id = (mesh.metadata as { sceneAssetId?: string } | null)?.sceneAssetId ?? '';
          if (steam.length >= 5 || !/pipe.*drop/.test(id)) continue;
          mesh.computeWorldMatrix(true);
          const box = mesh.getBoundingInfo().boundingBox;
          steam.push({ x: box.centerWorld.x, y: box.minimumWorld.y + 0.05, z: box.centerWorld.z, up: -0.15 });
        }
        atmosphere = createAtmosphere(scene, {
          dust: mobile() ? 160 : 380,
          dustColor: [0.85, 0.9, 0.82],
          dustGain: powers ? 0.18 : 0.42,
          dustSize: 0.45,
          shafts: { match: /^light-/, gain: powers ? 0.06 : 0.3, maxHeight: 4.2 },
          steam,
          steamColor: [0.62, 0.72, 0.66],
          beam: powers ? 0.05 : 0.14,
        });
      } else if (ctx.levelId === 'the-station') {
        station = createStationDress(scene);
        atmosphere = createAtmosphere(scene, {
          dust: mobile() ? 300 : 800,
          dustColor: [0.95, 0.95, 0.9],
          dustGain: 0.6,
          shafts: { match: /^station-light-/, gain: 0.07, maxHeight: 3.2, spread: 0.9 },
          beam: 0.2,
        });
      }
    },
    step: (dt: number) => {
      cityView?.step(dt);
      atmosphere?.step(dt);
      station?.step(dt);
      interior?.step(dt);
    },
    dispose: clear,
  };
};

export type LevelDressing = ReturnType<typeof createLevelDressing>;
