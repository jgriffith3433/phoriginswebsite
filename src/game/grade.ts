import * as BABYLON from '@babylonjs/core';

export type SceneGrade = {
  apply: (themeName: string) => void;
  /** 0–1. Basement only: tighter red vignette and a darker exposure while the creature is close. */
  setFear: (amount: number) => void;
  dispose: () => void;
};

const aces = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;

/**
 * Per-level color grade. SSAO is optional: some WebGL setups fail the depth prepass
 * and the scene should still render without it.
 */
export const createSceneGrade = (
  scene: BABYLON.Scene,
  cameras: BABYLON.Camera[],
): SceneGrade => {
  const pipeline = new BABYLON.DefaultRenderingPipeline('ph-grade', true, scene, cameras);
  pipeline.fxaaEnabled = true;
  pipeline.samples = 1;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.72;
  pipeline.bloomKernel = 42;
  pipeline.bloomScale = 0.45;
  pipeline.imageProcessingEnabled = true;
  const image = pipeline.imageProcessing;
  image.toneMappingEnabled = true;
  image.toneMappingType = aces;
  image.vignetteEnabled = true;
  image.vignetteColor = new BABYLON.Color4(0, 0, 0, 0);
  image.vignetteWeight = 2.4;
  image.vignetteStretch = 0.4;
  image.vignetteCameraFov = 0.7;

  let ssao: BABYLON.SSAO2RenderingPipeline | null = null;
  try {
    ssao = new BABYLON.SSAO2RenderingPipeline('ph-ssao', scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, cameras);
    ssao.radius = 1.35;
    ssao.totalStrength = 0.72;
    ssao.base = 0.18;
    ssao.expensiveBlur = false;
    ssao.samples = 8;
  } catch (error) {
    console.warn('SSAO unavailable', error);
    ssao = null;
  }

  let theme = '';
  let baseExposure = 1;
  let baseVignette = 2.2;

  const apply = (themeName: string) => {
    theme = themeName;
    const basement = themeName === 'B3 Basement';
    const apex = themeName === 'Apex Peak';
    image.exposure = basement ? 0.78 : apex ? 1.12 : 1.05;
    image.contrast = basement ? 1.06 : 1.12;
    pipeline.bloomWeight = basement ? 0.28 : 0.1;
    pipeline.bloomThreshold = basement ? 0.48 : 0.84;
    image.vignetteWeight = basement ? 4.1 : 2.2;
    image.vignetteColor.set(0, 0, 0, 0);
    baseExposure = image.exposure;
    baseVignette = image.vignetteWeight;
    if (ssao) {
      ssao.totalStrength = basement ? 0.95 : 0.7;
      ssao.radius = basement ? 1.6 : 1.25;
    }
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
    setFear,
    dispose: () => {
      pipeline.dispose();
      ssao?.dispose();
    },
  };
};
