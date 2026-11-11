/**
 * New sounds made through Hawkes Gen, and the sound that plays until the file exists (or if it fails to load).
 * A one-shot or loop that fails to fetch or decode plays its fallback instead, so a fresh catalog entry never
 * leaves the game quieter than it was. Sounds with nothing to fall back to just stay silent until made.
 */
export const SOUND_FALLBACK: Readonly<Record<string, string>> = {
  '/assets/audio/sfx/interact.ogg': '/assets/audio/sfx/flashlight.ogg',
  '/assets/audio/sfx/pickup.ogg': '/assets/audio/sfx/pistol-holster.ogg',
  '/assets/audio/sfx/station/train-pass.ogg': '/assets/audio/train/rumble.ogg',
  '/assets/audio/sfx/apex/sofa-creak.ogg': '/assets/audio/sfx/home/bed-creak.ogg',
  '/assets/audio/sfx/apex/cart-wheels.ogg': '/assets/audio/sfx/flashlight.ogg',
  '/assets/audio/sfx/apex/screen-tap.ogg': '/assets/audio/sfx/flashlight.ogg',
  '/assets/audio/sfx/apex/skyline.ogg': '/assets/audio/sfx/objective.ogg',
  '/assets/audio/sfx/apex/troffer-flicker.ogg': '/assets/audio/sfx/flashlight-off.ogg',
  // The Desk (theDesk.ts): the sweep and the mirror. The breath has no stand-in and stays silent until made.
  '/assets/audio/sfx/desk/paper-slide.ogg': '/assets/audio/sfx/apex/sofa-creak.ogg',
  '/assets/audio/sfx/desk/paper-land.ogg': '/assets/audio/sfx/pistol-holster.ogg',
  '/assets/audio/sfx/desk/desk-impact.ogg': '/assets/audio/sfx/glass-tick.ogg',
  '/assets/audio/sfx/desk/terminal-crash.ogg': '/assets/audio/sfx/glass-tick.ogg',
  // Touchables (touchables.ts): until each take is made, a sound the game already has.
  '/assets/audio/sfx/touch/desk-phone.ogg': '/assets/audio/sfx/phone/connect.wav',
  '/assets/audio/sfx/touch/coffee-machine.ogg': '/assets/audio/sfx/home/tv-static.ogg',
  '/assets/audio/sfx/touch/light-switch.ogg': '/assets/audio/sfx/flashlight.ogg',
  '/assets/audio/sfx/touch/ticket-machine.ogg': '/assets/audio/sfx/station/pa-chime.ogg',
  '/assets/audio/sfx/touch/turnstile.ogg': '/assets/audio/sfx/home/door-open.ogg',
  '/assets/audio/sfx/touch/bin-lid.ogg': '/assets/audio/sfx/glass-tick.ogg',
  '/assets/audio/sfx/touch/pole-grip.ogg': '/assets/audio/sfx/apex/sofa-creak.ogg',
  '/assets/audio/sfx/touch/strap-swing.ogg': '/assets/audio/sfx/apex/sofa-creak.ogg',
  '/assets/audio/sfx/touch/stop-request.ogg': '/assets/audio/train/doors-close.ogg',
  '/assets/audio/sfx/touch/emergency-handle.ogg': '/assets/audio/sfx/pistol-holster.ogg',
};

export const soundFallback = (url: string): string | null => {
  const clean = url.split('?')[0];
  const fallback = SOUND_FALLBACK[clean];
  return fallback && fallback !== clean ? fallback : null;
};
