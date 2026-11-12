import * as BABYLON from '@babylonjs/core';

import { installKeyShadowPlugin, keyShadowSupported, setKeyShadowSource } from './keyShadow';

/**
 * The one rendering pipeline every chapter uses (docs/render.md).
 *
 * - DefaultRenderingPipeline: ACES tonemapping and exposure, bloom over a threshold (practicals, screens, neon, the
 *   vat glow), a whisper of chromatic aberration, film grain, vignette, FXAA. Exposure, bloom weight and the vignette
 *   per theme stay in src/game/grade.ts, which drives this pipeline.
 * - A per-chapter 3D LUT (assets/lut/<chapter>.3dl, tools/genLuts.mjs) after tonemapping.
 * - SSAO2 on the high tier.
 * - A CascadedShadowGenerator on the chapter's key light: Pierce, NPCs and GLB furniture cast; floors and walls
 *   receive through src/render/keyShadow.ts. The key light itself adds no light (intensity 0, lights nothing), so
 *   each chapter's tuned fill, sun and practicals are unchanged and the shadow is the key's occlusion.
 * - Graphics tiers Low / Medium / High (Settings, `?quality=`, the phone tier picks Low on its own).
 */

export type GraphicsTier = 'low' | 'medium' | 'high';
export const GRAPHICS_TIERS: GraphicsTier[] = ['low', 'medium', 'high'];

export const parseGraphicsTier = (value: unknown): GraphicsTier | null =>
  value === 'low' || value === 'medium' || value === 'high' ? value : null;

/**
 * Who picks the tier: `?quality=` for a check, then the player's Settings choice, then the device (phones and
 * low-memory devices are Low, everything else High).
 */
export const pickGraphicsTier = (param: string | null, saved: GraphicsTier | null, lowPowerDevice: boolean) => {
  const fromParam = parseGraphicsTier(param);
  if (fromParam) return { tier: fromParam, source: '?quality' as const };
  if (saved) return { tier: saved, source: 'settings' as const };
  return { tier: (lowPowerDevice ? 'low' : 'high') as GraphicsTier, source: 'device' as const };
};

type TierSpec = {
  cascades: number;
  mapSize: number;
  /** PCF kernel radius in shadow-map texels, and taps (4 or 8). */
  softRadius: number;
  taps: number;
  ssao: boolean;
  aberration: boolean;
  grain: boolean;
  /** Render size cap in pixels (null: native CSS pixels). */
  maxPixels: number | null;
  bloomKernelCap: number;
  bloomScaleCap: number;
};

const TIERS: Record<GraphicsTier, TierSpec> = {
  // Phones: tonemapping, the LUT, a small bloom and one cascade; no SSAO, no aberration or grain passes.
  low: { cascades: 1, mapSize: 1024, softRadius: 1.4, taps: 4, ssao: false, aberration: false, grain: false, maxPixels: 1_000_000, bloomKernelCap: 24, bloomScaleCap: 0.3 },
  medium: { cascades: 2, mapSize: 1024, softRadius: 1.8, taps: 8, ssao: false, aberration: true, grain: true, maxPixels: 1_800_000, bloomKernelCap: 48, bloomScaleCap: 0.5 },
  high: { cascades: 3, mapSize: 2048, softRadius: 2.6, taps: 8, ssao: true, aberration: true, grain: true, maxPixels: null, bloomKernelCap: 96, bloomScaleCap: 1 },
};

export type ChapterLook = {
  /** assets/lut/<lut>.3dl */
  lut: string;
  /** LUT strength 0..1. */
  lutLevel: number;
  /** Key light direction (towards the floor). Steep: these are overhead practicals, not a sun. */
  keyDir: [number, number, number];
  /** How much of the light the key's shadow takes away (0..1). */
  shadow: number;
  /** Shadow range from the camera, metres. */
  shadowMaxZ: number;
  /** Chromatic aberration in pixels at the frame edge, and grain intensity. */
  aberration: number;
  grain: number;
  /** The Train: the fluorescent cast stutters with the tubes. */
  flicker?: boolean;
  /** Image-based environment (assets/env/<env>.env) once it is made. */
  env: 'night-city' | 'grey-dawn' | 'sodium-underground';
};

/** Keyed by level-library id (levels/level-library.json). */
export const CHAPTER_LOOKS: Record<string, ChapterLook> = {
  'apex-peak': { lut: 'apex-peak', lutLevel: 0.9, keyDir: [0.22, -1, 0.16], shadow: 0.5, shadowMaxZ: 34, aberration: 5, grain: 5, env: 'night-city' },
  'b3-basement': { lut: 'b3-basement', lutLevel: 1, keyDir: [0.12, -1, 0.2], shadow: 0.55, shadowMaxZ: 26, aberration: 7, grain: 9, env: 'sodium-underground' },
  'the-return': { lut: 'the-return', lutLevel: 0.95, keyDir: [0.12, -1, 0.08], shadow: 0.38, shadowMaxZ: 32, aberration: 6, grain: 4, env: 'sodium-underground' },
  'the-desk': { lut: 'the-desk', lutLevel: 1, keyDir: [0.78, -0.48, -0.25], shadow: 0.62, shadowMaxZ: 28, aberration: 5, grain: 6, env: 'night-city' },
  'going-home': { lut: 'going-home', lutLevel: 1, keyDir: [0.28, -1, -0.18], shadow: 0.5, shadowMaxZ: 40, aberration: 6, grain: 7, env: 'night-city' },
  'the-station': { lut: 'the-station', lutLevel: 1, keyDir: [0.15, -1, 0.1], shadow: 0.5, shadowMaxZ: 34, aberration: 5, grain: 7, env: 'sodium-underground' },
  'the-train': { lut: 'the-train', lutLevel: 1, keyDir: [0.05, -1, 0.06], shadow: 0.48, shadowMaxZ: 22, aberration: 6, grain: 8, flicker: true, env: 'sodium-underground' },
  'the-morning': { lut: 'the-morning', lutLevel: 0.95, keyDir: [0.72, -0.58, 0.18], shadow: 0.48, shadowMaxZ: 22, aberration: 4, grain: 6, env: 'grey-dawn' },
};

const DEFAULT_LOOK = CHAPTER_LOOKS['apex-peak'];

export type SsaoProfile = { wanted: boolean; strength: number; radius: number };

export type CineDofOptions = {
  active: boolean;
  focusDistanceMm: number;
  fStop?: number;
  focalLengthMm?: number;
  screenX?: number;
  screenY?: number;
};

export type RenderPipeline = ReturnType<typeof createRenderPipeline>;

export const createRenderPipeline = (
  scene: BABYLON.Scene,
  cameras: BABYLON.Camera[],
  options: { tier: GraphicsTier; canvas: HTMLCanvasElement },
) => {
  const engine = scene.getEngine();
  const canvas = options.canvas;
  let tier: GraphicsTier = options.tier;
  let spec = TIERS[tier];
  let chapter = '';
  let look: ChapterLook = DEFAULT_LOOK;
  const tierListeners = new Set<(tier: GraphicsTier) => void>();
  let tierChangedAt = 0;

  // ---------- Post ----------
  const pipeline = new BABYLON.DefaultRenderingPipeline('ph-grade', true, scene, cameras);
  pipeline.fxaaEnabled = true;
  pipeline.samples = 1;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.8;
  pipeline.bloomKernel = 32;
  pipeline.bloomScale = 0.45;
  pipeline.imageProcessingEnabled = true;
  const image = pipeline.imageProcessing;
  image.toneMappingEnabled = true;
  image.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  image.vignetteEnabled = true;
  image.vignetteColor = new BABYLON.Color4(0, 0, 0, 0);
  image.vignetteWeight = 2.4;
  image.vignetteStretch = 0.4;
  image.vignetteCameraFov = 0.7;

  const applyLensFx = () => {
    pipeline.chromaticAberrationEnabled = spec.aberration && look.aberration > 0;
    if (pipeline.chromaticAberrationEnabled) {
      pipeline.chromaticAberration.aberrationAmount = look.aberration;
      // Edges only: the centre of the frame (Pierce, captions) stays clean.
      pipeline.chromaticAberration.radialIntensity = 1.6;
    }
    pipeline.grainEnabled = spec.grain && look.grain > 0;
    if (pipeline.grainEnabled) {
      pipeline.grain.intensity = look.grain;
      pipeline.grain.animated = true;
    }
  };

  /** grade.ts sets bloom per theme; the tier caps its size. */
  const capBloom = () => {
    pipeline.bloomKernel = Math.min(pipeline.bloomKernel, spec.bloomKernelCap);
    pipeline.bloomScale = Math.min(pipeline.bloomScale, spec.bloomScaleCap);
  };

  // ---------- LUT ----------
  const luts = new Map<string, BABYLON.ColorGradingTexture>();
  let lutLevel = 1;
  const applyLut = () => {
    let texture = luts.get(look.lut);
    if (!texture) {
      texture = new BABYLON.ColorGradingTexture(`/assets/lut/${look.lut}.3dl`, scene);
      luts.set(look.lut, texture);
    }
    lutLevel = look.lutLevel;
    texture.level = lutLevel;
    image.colorGradingTexture = texture;
    image.colorGradingEnabled = true;
  };

  // ---------- SSAO (high tier) ----------
  let ssao: BABYLON.SSAO2RenderingPipeline | null = null;
  let ssaoProfile: SsaoProfile = { wanted: true, strength: 0.7, radius: 1.25 };
  let ssaoFailed = false;
  const syncSsao = () => {
    const on = spec.ssao && ssaoProfile.wanted && !ssaoFailed;
    if (!on) {
      if (ssao) {
        ssao.dispose(true);
        ssao = null;
      }
      return;
    }
    if (!ssao) {
      try {
        ssao = new BABYLON.SSAO2RenderingPipeline('ph-ssao', scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, cameras);
        ssao.expensiveBlur = false;
        ssao.samples = 8;
        ssao.base = 0.18;
      } catch (error) {
        // Some WebGL setups fail the depth prepass; the scene still renders without it.
        console.warn('SSAO unavailable', error);
        ssaoFailed = true;
        ssao = null;
        return;
      }
    }
    ssao.totalStrength = ssaoProfile.strength;
    ssao.radius = ssaoProfile.radius;
  };

  // ---------- Key light and cascaded shadows ----------
  const shadowsSupported = keyShadowSupported(engine);
  const anchor = new BABYLON.Mesh('key-shadow-anchor', scene);
  anchor.isPickable = false;
  anchor.doNotSerialize = true;
  const key = new BABYLON.DirectionalLight('key-shadow', new BABYLON.Vector3(0.2, -1, 0.15).normalize(), scene);
  key.intensity = 0;
  // Lights nothing (every material keeps its four light slots for the fill, sun and practicals); it only casts.
  key.includedOnlyMeshes = [anchor];
  key.shadowEnabled = true;
  let csm: BABYLON.CascadedShadowGenerator | null = null;

  type CasterMemo = { material: BABYLON.Material | null; caster: boolean };
  const casterMemo = new WeakMap<BABYLON.AbstractMesh, CasterMemo>();
  const MAX_CASTER_RADIUS = 9;
  const classify = (mesh: BABYLON.AbstractMesh) => {
    const meta = mesh.metadata as { castShadow?: boolean; boundsCollider?: boolean; interiorCollider?: boolean } | null;
    if (meta?.castShadow === false || meta?.boundsCollider || meta?.interiorCollider) return false;
    if (mesh.getTotalVertices() === 0) return false;
    if (meta?.castShadow === true) return true;
    const material = mesh.material;
    const tags = material?.metadata as { character?: boolean; prop?: boolean; castShadow?: boolean } | null | undefined;
    if (tags?.castShadow === false) return false;
    if (!(tags?.character || tags?.prop || tags?.castShadow)) return false;
    if (material && material.alpha < 0.5) return false;
    mesh.computeWorldMatrix();
    return mesh.getBoundingInfo().boundingSphere.radiusWorld <= MAX_CASTER_RADIUS;
  };
  /** Pierce, NPCs and furniture cast. Architecture, glass, effects and invisible colliders do not. */
  const isCaster = (mesh: BABYLON.AbstractMesh) => {
    if (!mesh.isEnabled() || !mesh.isVisible || mesh.visibility < 0.35) return false;
    const camera = scene.activeCamera;
    if (camera && (mesh.layerMask & camera.layerMask) === 0) return false;
    const memo = casterMemo.get(mesh);
    if (memo && memo.material === mesh.material) return memo.caster;
    const caster = classify(mesh);
    casterMemo.set(mesh, { material: mesh.material, caster });
    return caster;
  };

  const buildShadows = () => {
    if (!shadowsSupported) return;
    if (csm) {
      csm.dispose();
      csm = null;
    }
    // Babylon clamps CSM to 2..4 cascades because its own receiver shader blends neighbours. Receivers here use
    // keyShadow.ts, which handles a single layer, so the phone tier's one cascade is allowed.
    BABYLON.CascadedShadowGenerator.MIN_CASCADES_COUNT = 1;
    const generator = new BABYLON.CascadedShadowGenerator(spec.mapSize, key);
    generator.numCascades = spec.cascades;
    generator.usePercentageCloserFiltering = true;
    generator.filteringQuality = tier === 'high' ? BABYLON.ShadowGenerator.QUALITY_HIGH : tier === 'medium' ? BABYLON.ShadowGenerator.QUALITY_MEDIUM : BABYLON.ShadowGenerator.QUALITY_LOW;
    generator.lambda = 0.85;
    generator.stabilizeCascades = true;
    generator.depthClamp = true;
    generator.cascadeBlendPercentage = 0;
    generator.shadowMaxZ = look.shadowMaxZ;
    // Casters self-shadow (a chair seat under its back): a small depth bias and a normal bias stop acne on them
    // without lifting the contact shadow off the floor (receivers never cast, so floors and walls cannot acne).
    generator.bias = 0.0018;
    generator.normalBias = 0.018;
    generator.transparencyShadow = false;
    const map = generator.getShadowMap();
    if (map) {
      map.renderListPredicate = isCaster;
      map.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME;
    }
    csm = generator;
  };

  if (shadowsSupported) {
    installKeyShadowPlugin(scene);
    setKeyShadowSource(scene, {
      generator: () => csm,
      strength: () => look.shadow,
      soft: () => ({ radius: spec.softRadius, taps: spec.taps }),
    });
  }

  /** Quiet-chapter override (desk lamp throw, dawn window). Null restores the chapter look. */
  let keyDirOverride: [number, number, number] | null = null;

  // ---------- Cinematic depth of field (high tier) / vignette blur (low tier) ----------
  let cineDof: CineDofOptions = { active: false, focusDistanceMm: 2500, fStop: 2.2, focalLengthMm: 50, screenX: 0.5, screenY: 0.45 };
  let dofFailed = false;
  let baseVignetteWeight = image.vignetteWeight;
  let baseVignetteFov = image.vignetteCameraFov;

  const syncCineDof = () => {
    const vignetteEl = typeof document !== 'undefined' ? document.getElementById('cineVignetteBlur') : null;
    if (!cineDof.active) {
      if (pipeline.depthOfFieldEnabled) {
        try {
          pipeline.depthOfFieldEnabled = false;
        } catch {
          // ignore
        }
      }
      image.vignetteWeight = baseVignetteWeight;
      image.vignetteCameraFov = baseVignetteFov;
      if (vignetteEl) {
        vignetteEl.classList.remove('active');
      }
      return;
    }

    if (tier === 'high' && !dofFailed) {
      try {
        if (!pipeline.depthOfFieldEnabled) {
          pipeline.depthOfFieldBlurLevel = BABYLON.DepthOfFieldEffectBlurLevel.Low;
          pipeline.depthOfFieldEnabled = true;
        }
        pipeline.depthOfField.focalLength = cineDof.focalLengthMm ?? 50;
        pipeline.depthOfField.fStop = cineDof.fStop ?? 2.2;
        pipeline.depthOfField.lensSize = 50;
        pipeline.depthOfField.focusDistance = Math.max(300, cineDof.focusDistanceMm);
      } catch (err) {
        console.warn('DepthOfField unavailable', err);
        dofFailed = true;
      }
      if (vignetteEl) vignetteEl.classList.remove('active');
    } else {
      if (pipeline.depthOfFieldEnabled) {
        try {
          pipeline.depthOfFieldEnabled = false;
        } catch {
          // ignore
        }
      }
      image.vignetteEnabled = true;
      image.vignetteWeight = Math.max(baseVignetteWeight, 3.6);
      image.vignetteCameraFov = Math.min(baseVignetteFov, 0.52);
      if (vignetteEl) {
        vignetteEl.classList.add('active');
        const sx = Math.round(Math.max(15, Math.min(85, (cineDof.screenX ?? 0.5) * 100)));
        const sy = Math.round(Math.max(15, Math.min(85, (cineDof.screenY ?? 0.45) * 100)));
        vignetteEl.style.setProperty('--focus-x', `${sx}%`);
        vignetteEl.style.setProperty('--focus-y', `${sy}%`);
      }
    }
  };

  const applyKey = () => {
    const dir = keyDirOverride ?? look.keyDir;
    key.direction.set(dir[0], dir[1], dir[2]);
    key.direction.normalize();
    if (csm) csm.shadowMaxZ = look.shadowMaxZ;
  };

  // ---------- Render size ----------
  const applyRenderScale = () => {
    const cap = spec.maxPixels;
    if (cap === null) {
      engine.setHardwareScalingLevel(1);
      return;
    }
    const pixels = Math.max(1, canvas.clientWidth * canvas.clientHeight);
    engine.setHardwareScalingLevel(Math.max(1, Math.sqrt(pixels / cap)));
  };

  // ---------- Chapter flicker (The Train) ----------
  let clock = 0;
  const update = (dt: number) => {
    clock += dt;
    if (!look.flicker) return;
    const texture = image.colorGradingTexture as BABYLON.ColorGradingTexture | null;
    if (!texture) return;
    // A tube that mostly holds and sometimes stutters: the green cast drops and comes back.
    const n = Math.sin(clock * 21.0) * Math.sin(clock * 6.7) + Math.sin(clock * 1.3);
    const dip = n > 1.25 ? 0.22 : n > 1.0 ? 0.08 : 0;
    texture.level = lutLevel * (1 - dip);
  };

  const setChapter = (libraryId: string) => {
    chapter = libraryId;
    look = CHAPTER_LOOKS[libraryId] ?? DEFAULT_LOOK;
    applyLut();
    applyKey();
    applyLensFx();
  };

  const setTier = (next: GraphicsTier) => {
    if (next === tier) return;
    tier = next;
    spec = TIERS[tier];
    tierChangedAt = performance.now();
    buildShadows();
    applyKey();
    syncSsao();
    syncCineDof();
    applyLensFx();
    applyRenderScale();
    for (const listener of tierListeners) listener(tier);
  };

  buildShadows();
  applyKey();
  applyLensFx();
  applyRenderScale();

  return {
    pipeline,
    image,
    tier: () => tier,
    setTier,
    onTier: (listener: (tier: GraphicsTier) => void) => {
      tierListeners.add(listener);
      return () => tierListeners.delete(listener);
    },
    setChapter,
    chapter: () => chapter,
    look: () => look,
    /** Quiet chapters: steer the contact-shadow key (desk lamp, dawn window). Null clears. */
    setKeyDir: (dir: [number, number, number] | null) => {
      keyDirOverride = dir;
      applyKey();
    },
    /** grade.ts: whether this theme wants SSAO and how strong. Only the high tier draws it. */
    setSsao: (profile: SsaoProfile) => {
      ssaoProfile = profile;
      syncSsao();
    },
    /** cinecam.ts: focus pull on the high tier (DepthOfFieldEffect) and vignette blur on the low tier. */
    setCineDepthOfField: (next: CineDofOptions) => {
      if (!cineDof.active && next.active) {
        baseVignetteWeight = image.vignetteWeight;
        baseVignetteFov = image.vignetteCameraFov;
      }
      cineDof = { ...cineDof, ...next };
      syncCineDof();
    },
    cineDepthOfField: () => ({
      active: cineDof.active,
      tier,
      dofEnabled: Boolean(pipeline.depthOfFieldEnabled),
      vignetteBlur: Boolean(cineDof.active && tier !== 'high'),
      focusDistanceMm: cineDof.focusDistanceMm,
      fStop: cineDof.fStop ?? 2.2,
    }),
    capBloom,
    applyRenderScale,
    update,
    /** Mark a runtime-built mesh (furniture made in code) as a shadow caster. */
    castShadow: (mesh: BABYLON.AbstractMesh, on = true) => {
      mesh.metadata = { ...(mesh.metadata ?? {}), castShadow: on };
      casterMemo.delete(mesh);
    },
    /** Playtest and Settings readout. */
    stats: () => {
      const map = csm?.getShadowMap() ?? null;
      return {
        tier,
        chapter,
        lut: image.colorGradingEnabled ? look.lut : null,
        lutReady: Boolean(image.colorGradingTexture?.isReady()),
        toneMapping: image.toneMappingEnabled ? 'aces' : 'none',
        exposure: image.exposure,
        bloom: pipeline.bloomEnabled,
        bloomThreshold: pipeline.bloomThreshold,
        aberration: pipeline.chromaticAberrationEnabled,
        grain: pipeline.grainEnabled,
        vignette: image.vignetteEnabled,
        dof: Boolean(pipeline.depthOfFieldEnabled),
        vignetteBlur: Boolean(cineDof.active && tier !== 'high'),
        focusDistanceMm: cineDof.active ? cineDof.focusDistanceMm : null,
        ssao: Boolean(ssao),
        shadows: Boolean(csm),
        cascades: csm?.numCascades ?? 0,
        shadowMapSize: map?.getSize().width ?? 0,
        shadowCasters: map?.renderList?.length ?? 0,
        shadowStrength: look.shadow,
        hardwareScaling: engine.getHardwareScalingLevel(),
        msSinceTierChange: tierChangedAt ? performance.now() - tierChangedAt : null,
      };
    },
    dispose: () => {
      ssao?.dispose(true);
      csm?.dispose();
      for (const lut of luts.values()) lut.dispose();
      pipeline.dispose();
      key.dispose();
      anchor.dispose();
      setKeyShadowSource(scene, null);
    },
  };
};
