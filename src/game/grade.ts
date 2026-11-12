import * as BABYLON from '@babylonjs/core';

import type { RenderPipeline } from '../render/pipeline';

export type SceneGrade = {
  apply: (themeName: string) => void;
  /** Heightened contrast and saturation while Pierce is the changed body. */
  setPowers: (on: boolean) => void;
  /** 0–1. Basement only: tighter red vignette and a darker exposure while the creature is close. */
  setFear: (amount: number) => void;
  /** Apply the current theme again (after a graphics tier change resets the bloom caps). */
  reapply: () => void;
  dispose: () => void;
};

/**
 * Per-theme exposure, bloom, vignette and curves, applied to the one rendering pipeline (src/render/pipeline.ts),
 * which owns the post stack, the chapter LUT, SSAO, shadows and the graphics tier.
 */
export const createSceneGrade = (scene: BABYLON.Scene, render: RenderPipeline): SceneGrade => {
  const pipeline = render.pipeline;
  const image = render.image;

  let theme = '';
  let powers = false;
  let baseExposure = 1;
  let baseVignette = 2.2;
  const curves = new BABYLON.ColorCurves();
  image.colorCurves = curves;

  const apply = (themeName: string) => {
    theme = themeName;
    const basement = themeName === 'B3 Basement';
    const apex = themeName === 'Apex Peak';
    const street = themeName === 'Street';
    const station = themeName === 'Station';
    image.exposure = basement ? 0.84 : street ? 0.9 : apex ? 1.02 : 1.05;
    image.contrast = basement ? 1.06 : 1.12;
    pipeline.bloomWeight = basement ? 0.28 : apex ? 0.06 : 0.1;
    pipeline.bloomThreshold = basement ? 0.48 : 0.84;
    pipeline.bloomKernel = apex ? 16 : 32;
    pipeline.bloomScale = 0.45;
    image.vignetteWeight = basement ? 4.1 : 2.2;
    image.vignetteColor.set(0, 0, 0, 0);
    curves.globalSaturation = 0;
    curves.globalDensity = 0;
    curves.globalExposure = 0;
    curves.shadowsExposure = 0;
    curves.highlightsExposure = 0;
    curves.shadowsHue = 0;
    curves.midtonesHue = 0;
    curves.highlightsHue = 0;
    curves.shadowsSaturation = 0;
    curves.midtonesSaturation = 0;
    image.colorCurvesEnabled = false;
    paintHemiGround(0, 0, 0);
    if (station) {
      image.exposure = 0.94;
      image.contrast = 1.04;
      image.vignetteWeight = 1.5;
      pipeline.bloomWeight = 0.24;
      pipeline.bloomThreshold = 0.52;
      pipeline.bloomKernel = 48;
      pipeline.bloomScale = 0.42;
      curves.globalSaturation = 6;
      image.colorCurvesEnabled = true;
      liftFill(0.95, 0.2);
      paintHemiGround(0.16, 0.17, 0.15);
    } else if (apex && !powers) {
      // Title-card navy: cool the office halls so the bright ceiling reads with the terminal chrome.
      image.exposure = 1.0;
      image.contrast = 1.16;
      image.vignetteWeight = 2.55;
      image.vignetteColor.set(0.035, 0.06, 0.11, 0);
      pipeline.bloomWeight = 0.05;
      pipeline.bloomThreshold = 0.9;
      pipeline.bloomKernel = 14;
      curves.globalSaturation = -10;
      curves.shadowsHue = 28;
      curves.midtonesHue = 18;
      curves.highlightsHue = 12;
      curves.shadowsSaturation = 18;
      curves.midtonesSaturation = 8;
      curves.highlightsExposure = -22;
      curves.shadowsExposure = -8;
      image.colorCurvesEnabled = true;
      paintHemiGround(0.04, 0.07, 0.14);
      scene.fogColor = new BABYLON.Color3(0.035, 0.05, 0.09);
    } else if (powers && basement) {
      image.exposure = 1.72;
      image.contrast = 1.08;
      image.vignetteWeight = 1.05;
      pipeline.bloomWeight = 0.55;
      pipeline.bloomThreshold = 0.22;
      pipeline.bloomKernel = 68;
      pipeline.bloomScale = 0.64;
      curves.globalSaturation = 18;
      curves.shadowsExposure = 72;
      image.colorCurvesEnabled = true;
      liftFill(1.15, 0.32);
      paintHemiGround(0.78, 0.82, 0.76);
      scene.fogColor = new BABYLON.Color3(0.05, 0.07, 0.055);
      scene.fogStart = 22;
      scene.fogEnd = 86;
    } else if (powers && street) {
      image.exposure = 1.2;
      image.contrast = 1.08;
      image.vignetteWeight = 1.12;
      pipeline.bloomWeight = 0.4;
      pipeline.bloomThreshold = 0.34;
      pipeline.bloomKernel = 56;
      pipeline.bloomScale = 0.5;
      curves.globalSaturation = 12;
      curves.shadowsExposure = 36;
      image.colorCurvesEnabled = true;
      liftFill(1.15, 0.36);
      paintHemiGround(0.24, 0.25, 0.28);
      scene.fogColor = new BABYLON.Color3(0.032, 0.036, 0.05);
      scene.fogStart = 50;
      scene.fogEnd = 320;
    } else if (powers) {
      image.exposure = apex ? 1.48 : 1.65;
      image.contrast = 1.16;
      image.vignetteWeight = 1.15;
      pipeline.bloomWeight = 0.5;
      pipeline.bloomThreshold = 0.32;
      pipeline.bloomKernel = apex ? 28 : 72;
      pipeline.bloomScale = 0.58;
      curves.globalSaturation = 22;
      curves.globalExposure = 8;
      curves.highlightsExposure = 16;
      curves.shadowsExposure = 6;
      image.colorCurvesEnabled = true;
      if (apex) liftFill(1.9, 0.55);
    }
    render.capBloom();
    baseExposure = image.exposure;
    baseVignette = image.vignetteWeight;
    // Contact AO everywhere on the high tier; the office keeps it gentle (bright, wide rooms), the basement deep.
    if (powers) render.setSsao({ wanted: true, strength: basement ? 0.16 : 0.38, radius: 1.05 });
    else if (apex) render.setSsao({ wanted: true, strength: 0.5, radius: 0.9 });
    else render.setSsao({ wanted: true, strength: basement ? 0.95 : 0.7, radius: basement ? 1.6 : 1.25 });
  };

  const liftFill = (hemiIntensity: number, sunIntensity: number) => {
    const hemi = scene.getLightByName('hemi');
    const sun = scene.getLightByName('sun');
    if (hemi instanceof BABYLON.HemisphericLight) hemi.intensity = hemiIntensity;
    if (sun instanceof BABYLON.DirectionalLight) sun.intensity = sunIntensity;
  };

  const paintHemiGround = (r: number, g: number, b: number) => {
    const hemi = scene.getLightByName('hemi');
    if (hemi instanceof BABYLON.HemisphericLight) hemi.groundColor.set(r, g, b);
  };

  const setPowers = (on: boolean) => {
    if (powers === on) return;
    powers = on;
    if (theme) apply(theme);
  };

  const setFear = (amount: number) => {
    if (theme !== 'B3 Basement') return;
    const t = Math.max(0, Math.min(1, amount));
    image.exposure = baseExposure * (1 - t * 0.34);
    image.vignetteWeight = baseVignette + t * 3.6;
    image.vignetteColor.set(0.62 * t, 0.02 * t, 0.03 * t, 0);
  };

  return {
    apply,
    setPowers,
    setFear,
    reapply: () => {
      if (theme) apply(theme);
    },
    dispose: () => render.dispose(),
  };
};
