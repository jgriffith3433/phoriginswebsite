/**
 * New sounds made through Hawkes Gen, and the sound that plays until the file exists (or if it fails to load).
 * A one-shot or loop that fails to fetch or decode plays its fallback instead, so a fresh catalog entry never
 * leaves the game quieter than it was. Sounds with nothing to fall back to just stay silent until made.
 */
export const SOUND_FALLBACK: Readonly<Record<string, string>> = {
  '/assets/audio/sfx/interact.ogg': '/assets/audio/sfx/flashlight.ogg',
  '/assets/audio/sfx/pickup.ogg': '/assets/audio/sfx/pistol-holster.ogg',
  '/assets/audio/sfx/walk-concrete.ogg': '/assets/audio/sfx/walk.ogg',
  '/assets/audio/sfx/walk-hard.ogg': '/assets/audio/sfx/walk.ogg',
  '/assets/audio/sfx/station/train-pass.ogg': '/assets/audio/train/rumble.ogg',
};

export const soundFallback = (url: string): string | null => {
  const clean = url.split('?')[0];
  const fallback = SOUND_FALLBACK[clean];
  return fallback && fallback !== clean ? fallback : null;
};
