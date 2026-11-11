import { STEP_LENGTH } from './stride';

/**
 * Footsteps: one short clip on each foot plant, from the stride clock (metres walked, not time), so the
 * sound lands with the feet at any speed. Surface picks the set; a variant never plays twice in a row and
 * every plant gets a pitch within about +-8%.
 */
export type Surface = 'carpet' | 'tile' | 'concrete' | 'train';

export const STEP_VARIANTS = 4;
export const stepUrl = (surface: Surface, variant: number) => `/assets/audio/sfx/step/${surface}-${variant + 1}.ogg`;
export const stepUrls = (surface: Surface) => Array.from({ length: STEP_VARIANTS }, (_, i) => stepUrl(surface, i));

/** Level plus where he stands. Apex: carpet in the office wing and boardroom, tile in the restroom. */
export const surfaceFor = (libraryId: string, x: number, z: number): Surface => {
  switch (libraryId) {
    case 'going-home':
    case 'the-station':
    case 'b3-basement':
      return 'concrete';
    case 'the-train':
      return 'train';
    case 'the-morning':
      return 'train';
    default:
      // Restroom off the south wall of hall 2 (doorway x 18, z 29.7) and the cab are hard floors.
      if (z < 29.7 && x > 12 && x < 26) return 'tile';
      return 'carpet';
  }
};

export type StepEvent = { surface: Surface; variant: number; rate: number; t: number; foot: 'L' | 'R' };

export const createFootsteps = (play: (url: string, rate: number) => void) => {
  let acc = STEP_LENGTH * 0.5;
  let last = -1;
  let foot: 'L' | 'R' = 'L';
  let count = 0;
  const log: StepEvent[] = [];
  const plant = (surface: Surface, rng: () => number) => {
    let variant = Math.floor(rng() * STEP_VARIANTS);
    if (variant === last) variant = (variant + 1 + Math.floor(rng() * (STEP_VARIANTS - 1))) % STEP_VARIANTS;
    last = variant;
    const rate = 0.92 + rng() * 0.16;
    foot = foot === 'L' ? 'R' : 'L';
    count += 1;
    log.push({ surface, variant, rate, t: performance.now(), foot });
    if (log.length > 64) log.shift();
    play(stepUrl(surface, variant), rate);
  };
  return {
    /** Feed the metres walked this frame; fires one plant per STEP_LENGTH. */
    advance(metres: number, surface: Surface, rng: () => number = Math.random) {
      acc += Math.max(0, metres);
      let guard = 3;
      while (acc >= STEP_LENGTH && guard-- > 0) {
        acc -= STEP_LENGTH;
        plant(surface, rng);
      }
      if (acc > STEP_LENGTH) acc = 0;
    },
    /** Standing still: the next move starts with a plant half a stride in. */
    reset() { acc = STEP_LENGTH * 0.5; },
    count: () => count,
    events: () => log.slice(),
  };
};
