import * as BABYLON from '@babylonjs/core';

/**
 * The key-light shadow every surface reads (src/render/pipeline.ts owns the light and its CascadedShadowGenerator).
 *
 * Casters (Pierce, NPCs, GLB furniture) are drawn into the cascades. Receivers do not use Babylon's own
 * receiveShadows path: the floors and walls of every chapter are mostly custom ShaderMaterials (interior kit, city,
 * station, train) that never see the scene lights. Instead every receiver samples the same cascade array with the
 * GLSL below and darkens its lit colour by `strength` where the key is blocked. Standard and PBR materials get it
 * through a material plugin; the custom shaders splice `KEY_SHADOW_GLSL` in and call `attachKeyShadow`.
 *
 * Architecture never casts (ceilings would black out every room under an overhead key, and a wall that both casts
 * and receives is where acne comes from), so floors and walls show soft contact shadows with nothing to acne.
 */

export const MAX_KEY_CASCADES = 3;

export const KEY_SHADOW_UNIFORMS = ['keyLightMatrix', 'keyShadowInfo', 'keyShadowSoft'];
export const KEY_SHADOW_SAMPLER = 'keyShadowMap';

/**
 * keyShadowInfo: x map size, y 1 / map size, z strength (0 off, 1 black), w cascade count.
 * keyShadowSoft: x kernel radius in texels, y taps (4 or 8).
 * `keyShadow(world)` is 1 where the key reaches, down to 1 - strength in full shadow.
 */
export const KEY_SHADOW_GLSL = /* glsl */ `
#ifdef KEY_SHADOW
uniform highp sampler2DArrayShadow keyShadowMap;
uniform mat4 keyLightMatrix[${MAX_KEY_CASCADES}];
uniform vec4 keyShadowInfo;
uniform vec4 keyShadowSoft;
float keyShadowTap(float layer, vec2 uv, float depth) {
  return texture(keyShadowMap, vec4(uv, layer, depth));
}
float keyShadowLayer(float layer, vec3 uvd) {
  vec2 r = vec2(keyShadowInfo.y * keyShadowSoft.x);
  float s = keyShadowTap(layer, uvd.xy + vec2(-0.5, -0.5) * r, uvd.z)
    + keyShadowTap(layer, uvd.xy + vec2(0.5, -0.5) * r, uvd.z)
    + keyShadowTap(layer, uvd.xy + vec2(-0.5, 0.5) * r, uvd.z)
    + keyShadowTap(layer, uvd.xy + vec2(0.5, 0.5) * r, uvd.z);
  if (keyShadowSoft.y < 4.5) return s * 0.25;
  s += keyShadowTap(layer, uvd.xy + vec2(0.0, -1.2) * r, uvd.z)
    + keyShadowTap(layer, uvd.xy + vec2(1.2, 0.0) * r, uvd.z)
    + keyShadowTap(layer, uvd.xy + vec2(0.0, 1.2) * r, uvd.z)
    + keyShadowTap(layer, uvd.xy + vec2(-1.2, 0.0) * r, uvd.z);
  return s * 0.125;
}
float keyShadow(vec3 world) {
  if (keyShadowInfo.z <= 0.0) return 1.0;
  for (int i = 0; i < ${MAX_KEY_CASCADES}; i++) {
    if (float(i) >= keyShadowInfo.w) break;
    vec4 p = keyLightMatrix[i] * vec4(world, 1.0);
    vec3 uvd = 0.5 * (p.xyz / p.w) + 0.5;
    if (uvd.x > 0.01 && uvd.x < 0.99 && uvd.y > 0.01 && uvd.y < 0.99 && uvd.z > 0.0 && uvd.z < 1.0) {
      float lit = keyShadowLayer(float(i), vec3(uvd.xy, min(uvd.z, 0.9999)));
      // Fade the last cascade out at its rim so the shadow range has no hard edge.
      vec2 rim = min(uvd.xy, 1.0 - uvd.xy);
      float edge = float(i) + 1.0 >= keyShadowInfo.w ? smoothstep(0.01, 0.08, min(rim.x, rim.y)) : 1.0;
      return 1.0 - keyShadowInfo.z * (1.0 - lit) * edge;
    }
  }
  return 1.0;
}
#else
float keyShadow(vec3 world) { return 1.0; }
#endif
`;

export type KeyShadowSource = {
  /** The live cascade generator, or null while shadows are off. */
  generator: () => BABYLON.CascadedShadowGenerator | null;
  /** 0 off .. 1 black, the chapter's shadow strength. */
  strength: () => number;
  /** PCF kernel radius in texels and tap count (4 or 8). */
  soft: () => { radius: number; taps: number };
};

const sources = new WeakMap<BABYLON.Scene, KeyShadowSource>();

/** WebGL2 only: the cascades are a depth texture array. */
export const keyShadowSupported = (engine: BABYLON.AbstractEngine) =>
  ((engine as unknown as { webGLVersion?: number }).webGLVersion ?? 0) >= 2 && !engine.isWebGPU && BABYLON.CascadedShadowGenerator.IsSupported;

export const setKeyShadowSource = (scene: BABYLON.Scene, source: KeyShadowSource | null) => {
  if (source) sources.set(scene, source);
  else sources.delete(scene);
};

export const keyShadowFor = (scene: BABYLON.Scene) => sources.get(scene) ?? null;

const matrices = new Float32Array(16 * MAX_KEY_CASCADES);
const info = new BABYLON.Vector4(0, 0, 0, 0);
const soft = new BABYLON.Vector4(1.5, 4, 0, 0);

/** Bind the cascades into any effect compiled with KEY_SHADOW. */
export const bindKeyShadow = (scene: BABYLON.Scene, effect: BABYLON.Effect | null | undefined) => {
  if (!effect) return;
  const source = sources.get(scene);
  const generator = source?.generator() ?? null;
  const map = generator?.getShadowMap() ?? null;
  if (!source || !generator || !map) {
    info.set(1, 1, 0, 0);
    effect.setVector4('keyShadowInfo', info);
    return;
  }
  const cascades = Math.min(MAX_KEY_CASCADES, generator.numCascades);
  for (let i = 0; i < cascades; i += 1) {
    const m = generator.getCascadeTransformMatrix(i);
    if (m) m.copyToArray(matrices, i * 16);
  }
  const size = map.getSize().width || 1024;
  info.set(size, 1 / size, source.strength(), cascades);
  const k = source.soft();
  soft.set(k.radius, k.taps, 0, 0);
  effect.setDepthStencilTexture(KEY_SHADOW_SAMPLER, map);
  effect.setMatrices('keyLightMatrix', matrices);
  effect.setVector4('keyShadowInfo', info);
  effect.setVector4('keyShadowSoft', soft);
};

/**
 * Options to merge into a ShaderMaterial so it can read the key shadow. Empty (the shader's stub `keyShadow`
 * returns 1) when this scene has no pipeline: Dev Tools, the Node checks, WebGL1.
 */
export const keyShadowShaderOptions = (scene: BABYLON.Scene) => {
  if (!sources.has(scene)) return { defines: [] as string[], uniforms: [] as string[], samplers: [] as string[] };
  return { defines: ['#define KEY_SHADOW'], uniforms: [...KEY_SHADOW_UNIFORMS], samplers: [KEY_SHADOW_SAMPLER] };
};

/**
 * Bind the cascades on every draw of a ShaderMaterial made with `keyShadowShaderOptions`. If the shader fails to
 * compile with the shadow code, it is rebuilt without it: a floor without contact shadows beats a missing floor.
 */
export const attachKeyShadow = (scene: BABYLON.Scene, material: BABYLON.ShaderMaterial) => {
  if (!sources.has(scene)) return;
  material.onBindObservable.add(() => bindKeyShadow(scene, material.getEffect()));
  const previous = material.onError;
  material.onError = (effect, errors) => {
    const defines = material.options.defines as string[];
    const at = defines.indexOf('#define KEY_SHADOW');
    if (at >= 0) {
      console.warn(`PH Origins: ${material.name} key shadow did not compile; drawing it without.`, errors);
      defines.splice(at, 1);
      material.markDirty(true);
    }
    previous?.(effect, errors);
  };
};

/** Standard and PBR materials: the same shadow, spliced in before fog. */
class KeyShadowPlugin extends BABYLON.MaterialPluginBase {
  private readonly pbr: boolean;

  constructor(material: BABYLON.Material) {
    super(material, 'KeyShadow', 310, { KEY_SHADOW: false }, true, true);
    this.pbr = material instanceof BABYLON.PBRBaseMaterial;
  }

  override getClassName() {
    return 'KeyShadowPlugin';
  }

  override isCompatible(shaderLanguage: BABYLON.ShaderLanguage) {
    return shaderLanguage === BABYLON.ShaderLanguage.GLSL;
  }

  override prepareDefines(defines: BABYLON.MaterialDefines) {
    const material = this._material as BABYLON.Material & { disableLighting?: boolean; unlit?: boolean; metadata?: { keyShadow?: boolean; character?: boolean } | null };
    // Characters cast but do not receive: an overhead key darkening every face under its brow reads as a mask,
    // not as light. Unlit materials (sky, signs, effects) never receive.
    const off = material.disableLighting === true || material.unlit === true || material.metadata?.keyShadow === false || material.metadata?.character === true;
    defines.KEY_SHADOW = !off && sources.has(material.getScene());
  }

  /** A driver that rejects the shadow code gets the material without it, not a missing mesh. */
  override addFallbacks(defines: BABYLON.MaterialDefines, fallbacks: BABYLON.EffectFallbacks, currentRank: number) {
    if (defines.KEY_SHADOW) fallbacks.addFallback(currentRank++, 'KEY_SHADOW');
    return currentRank;
  }

  override getSamplers(samplers: string[]) {
    samplers.push(KEY_SHADOW_SAMPLER);
  }

  override getUniforms() {
    return { ubo: KEY_SHADOW_UNIFORMS.map((name) => ({ name })) };
  }

  override hardBindForSubMesh(_ubo: BABYLON.UniformBuffer, scene: BABYLON.Scene, _engine: BABYLON.AbstractEngine, subMesh: BABYLON.SubMesh) {
    const defines = subMesh.materialDefines as (BABYLON.MaterialDefines & { KEY_SHADOW?: boolean }) | null;
    if (!defines?.KEY_SHADOW) return;
    bindKeyShadow(scene, subMesh.effect);
  }

  override getCustomCode(shaderType: string): BABYLON.Nullable<{ [pointName: string]: string }> {
    if (shaderType !== 'fragment') return null;
    // Standard lights in display space until after fog; PBR is linear throughout.
    return this.pbr
      ? {
          CUSTOM_FRAGMENT_DEFINITIONS: KEY_SHADOW_GLSL,
          CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: 'finalColor.rgb *= keyShadow(vPositionW);',
        }
      : {
          CUSTOM_FRAGMENT_DEFINITIONS: KEY_SHADOW_GLSL,
          CUSTOM_FRAGMENT_BEFORE_FOG: 'color.rgb *= pow(keyShadow(vPositionW), 0.4545);',
        };
  }
}

let pluginRegistered = false;
const pluginScenes = new WeakSet<BABYLON.Scene>();

/**
 * Give every Standard and PBR material made in this scene from now on the key-shadow plugin. Call right after the
 * scene exists, before any material: a plugin added to a compiled material recompiles it.
 */
export const installKeyShadowPlugin = (scene: BABYLON.Scene) => {
  if (!keyShadowSupported(scene.getEngine())) return false;
  pluginScenes.add(scene);
  if (pluginRegistered) return true;
  pluginRegistered = true;
  BABYLON.RegisterMaterialPlugin('KeyShadow', (material) => {
    if (!pluginScenes.has(material.getScene())) return null;
    if (!(material instanceof BABYLON.StandardMaterial) && !(material instanceof BABYLON.PBRBaseMaterial)) return null;
    return new KeyShadowPlugin(material);
  });
  return true;
};
