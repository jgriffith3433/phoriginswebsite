import * as BABYLON from '@babylonjs/core';

export type SceneGrade = {
  apply: (themeName: string) => void;
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

  const apply = (themeName: string) => {
    const basement = themeName === 'B3 Basement';
    const apex = themeName === 'Apex Peak';
    image.exposure = basement ? 1.08 : apex ? 1.12 : 1.05;
    image.contrast = basement ? 1.18 : 1.12;
    pipeline.bloomWeight = basement ? 0.22 : 0.1;
    pipeline.bloomThreshold = basement ? 0.62 : 0.84;
    image.vignetteWeight = basement ? 3.4 : 2.2;
    if (ssao) {
      ssao.totalStrength = basement ? 0.95 : 0.7;
      ssao.radius = basement ? 1.6 : 1.25;
    }
  };

  return {
    apply,
    dispose: () => {
      pipeline.dispose();
      ssao?.dispose();
    },
  };
};
