/**
 * Memory tier for phones. `navigator.deviceMemory` (GB, rounded down to a power of two, Chromium only) at 4 or
 * less, or unknown on a touch-first device, is the low tier: textures are capped at 1024 px and the optional heavy
 * effects (SSAO, shafts, dust, splat detail) are skipped. `?memory=low|high` overrides it for a check.
 */
export type MemoryTier = {
  tier: 'low' | 'standard';
  /** navigator.deviceMemory in GB, or null when the browser does not say. */
  deviceMemory: number | null;
  /** Largest texture side in pixels the game lets the engine keep (null: the GPU's own limit). */
  textureCap: number | null;
  /** Why this tier was picked, for the playtest state and bug reports. */
  reason: string;
};

export const LOW_MEMORY_GB = 4;
export const LOW_TEXTURE_CAP = 1024;

export const pickMemoryTier = (coarsePointer: boolean, search = location.search): MemoryTier => {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const deviceMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 ? nav.deviceMemory : null;
  const override = new URLSearchParams(search).get('memory');
  const low = (reason: string): MemoryTier => ({ tier: 'low', deviceMemory, textureCap: LOW_TEXTURE_CAP, reason });
  if (override === 'low') return low('?memory=low');
  if (override === 'high') return { tier: 'standard', deviceMemory, textureCap: null, reason: '?memory=high' };
  if (deviceMemory !== null && deviceMemory <= LOW_MEMORY_GB) return low(`deviceMemory ${deviceMemory} GB`);
  if (deviceMemory === null && coarsePointer) return low('deviceMemory unknown on a touch device');
  return { tier: 'standard', deviceMemory, textureCap: null, reason: deviceMemory === null ? 'deviceMemory unknown' : `deviceMemory ${deviceMemory} GB` };
};

/** Clamp the engine's reported max texture size, so every image texture is downscaled on load. */
export const capTextureSize = (engine: { getCaps: () => { maxTextureSize: number } }, cap: number | null): number => {
  const caps = engine.getCaps();
  if (cap !== null && caps.maxTextureSize > cap) caps.maxTextureSize = cap;
  return caps.maxTextureSize;
};
