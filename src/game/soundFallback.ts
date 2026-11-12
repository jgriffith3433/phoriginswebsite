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
  // B3 horror: fluorescent buzz loops under flickering practicals until Gen makes the take.
  '/assets/audio/sfx/b3/fluorescent-buzz.ogg': '/assets/audio/sfx/apex/troffer-flicker.ogg',
  // B3 hall life: dead guard radio crackle (tone only) when Pierce passes a drum.
  '/assets/audio/sfx/b3/radio-crackle.ogg': '/assets/audio/sfx/creature/knock.wav',
  '/assets/audio/sfx/apex/door-locked.ogg': '/assets/audio/sfx/glass-tick.ogg',
  // The Desk (theDesk.ts): the sweep and the mirror. The breath has no stand-in and stays silent until made.
  '/assets/audio/sfx/desk/paper-slide.ogg': '/assets/audio/sfx/apex/sofa-creak.ogg',
  '/assets/audio/sfx/desk/paper-land.ogg': '/assets/audio/sfx/pistol-holster.ogg',
  '/assets/audio/sfx/desk/desk-impact.ogg': '/assets/audio/sfx/glass-tick.ogg',
  '/assets/audio/sfx/desk/terminal-crash.ogg': '/assets/audio/sfx/glass-tick.ogg',
  // Power effects (powerFx.ts): until each take is made, the sound the power had before.
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
  // Ledger: the siren plays a car pass if its file fails to load.
  '/assets/audio/sfx/street/siren-police.mp3': '/assets/audio/sfx/street/car-pass.wav',
  // Going Home rain bed until Gen lands rain-hiss.ogg (rainNight.ts).
  '/assets/audio/sfx/street/rain-hiss.ogg': '/assets/audio/room-tone.mp3',
  // Layered chapter ambience spots (chapterAmbience.ts) until Gen takes land.
  '/assets/audio/sfx/ambience/apex-hvac.ogg': '/assets/audio/sfx/b3/fluorescent-buzz.ogg',
  '/assets/audio/sfx/ambience/apex-phone.ogg': '/assets/audio/sfx/phone/ring.wav',
  '/assets/audio/sfx/ambience/apex-printer.ogg': '/assets/audio/sfx/flashlight.ogg',
  '/assets/audio/sfx/ambience/apex-walla.ogg': '/assets/audio/sfx/apex/skyline.ogg',
  '/assets/audio/sfx/ambience/b3-drip.ogg': '/assets/audio/sfx/creature/knock.wav',
  '/assets/audio/sfx/ambience/b3-pipe-groan.ogg': '/assets/audio/sfx/creature/scrape.wav',
  '/assets/audio/sfx/ambience/b3-machinery.ogg': '/assets/audio/sfx/creature/tick.wav',
  '/assets/audio/sfx/ambience/return-door.ogg': '/assets/audio/sfx/home/door-open.ogg',
  '/assets/audio/sfx/ambience/desk-clock.ogg': '/assets/audio/sfx/glass-tick.ogg',
  '/assets/audio/sfx/ambience/street-neon.ogg': '/assets/audio/sfx/b3/fluorescent-buzz.ogg',
  '/assets/audio/sfx/ambience/street-walla.ogg': '/assets/audio/sfx/street/car-pass.wav',
  '/assets/audio/sfx/ambience/street-awning.ogg': '/assets/audio/sfx/street/rain-hiss.ogg',
  '/assets/audio/sfx/ambience/station-brakes.ogg': '/assets/audio/train/brakes.ogg',
  '/assets/audio/sfx/ambience/station-walla.ogg': '/assets/audio/sfx/station/train-pass.ogg',
  '/assets/audio/sfx/ambience/train-clatter.ogg': '/assets/audio/train/rumble.ogg',
  '/assets/audio/sfx/ambience/morning-birds.ogg': '/assets/audio/sfx/apex/skyline.ogg',
  '/assets/audio/sfx/ambience/morning-traffic.ogg': '/assets/audio/sfx/apex/skyline.ogg',
  '/assets/audio/sfx/ambience/morning-fridge.ogg': '/assets/audio/sfx/b3/fluorescent-buzz.ogg',
  // Crowd Shadow reactions (crowdReact.ts) until Gen voice takes land.
  '/assets/audio/vo/bark.crowd.notice.01.ogg': '/assets/audio/street/bark-cold.ogg',
  '/assets/audio/vo/bark.crowd.notice.02.ogg': '/assets/audio/street/bark-walk.ogg',
  '/assets/audio/vo/bark.crowd.notice.03.ogg': '/assets/audio/street/bark-tower.ogg',
  '/assets/audio/vo/bark.crowd.notice.04.ogg': '/assets/audio/street/bark-cold.ogg',
  '/assets/audio/vo/bark.crowd.notice.05.ogg': '/assets/audio/street/bark-walk.ogg',
  '/assets/audio/vo/bark.crowd.notice.06.ogg': '/assets/audio/street/bark-tower.ogg',
  '/assets/audio/vo/bark.crowd.notice.07.ogg': '/assets/audio/street/bark-cold.ogg',
  '/assets/audio/vo/bark.crowd.notice.08.ogg': '/assets/audio/street/bark-walk.ogg',
  '/assets/audio/vo/bark.crowd.notice.09.ogg': '/assets/audio/street/bark-tower.ogg',
  '/assets/audio/vo/bark.crowd.notice.10.ogg': '/assets/audio/street/bark-cold.ogg',
  '/assets/audio/vo/bark.crowd.panic.01.ogg': '/assets/audio/sfx/street/scream-woman.ogg',
  '/assets/audio/vo/bark.crowd.panic.02.ogg': '/assets/audio/sfx/street/scream-man.ogg',
  '/assets/audio/vo/bark.crowd.panic.03.ogg': '/assets/audio/sfx/street/scream-man-b.ogg',
  '/assets/audio/vo/bark.crowd.panic.04.ogg': '/assets/audio/street/pedestrian-away.ogg',
  '/assets/audio/vo/bark.crowd.panic.05.ogg': '/assets/audio/sfx/street/scream-woman.ogg',
  '/assets/audio/vo/bark.crowd.panic.06.ogg': '/assets/audio/sfx/street/scream-man.ogg',
  '/assets/audio/vo/bark.crowd.panic.07.ogg': '/assets/audio/sfx/street/scream-man-b.ogg',
  '/assets/audio/vo/bark.crowd.panic.08.ogg': '/assets/audio/street/pedestrian-away.ogg',
  '/assets/audio/vo/bark.crowd.panic.09.ogg': '/assets/audio/sfx/street/scream-woman.ogg',
  '/assets/audio/vo/bark.crowd.panic.10.ogg': '/assets/audio/sfx/street/scream-man.ogg',
  '/assets/audio/vo/bark.crowd.film.01.ogg': '/assets/audio/street/bark-hear.ogg',
  '/assets/audio/vo/bark.crowd.film.02.ogg': '/assets/audio/street/talk-tower-a.ogg',
  '/assets/audio/vo/bark.crowd.film.03.ogg': '/assets/audio/street/bark-hear.ogg',
  '/assets/audio/vo/bark.crowd.film.04.ogg': '/assets/audio/street/talk-tower-a.ogg',
  '/assets/audio/vo/bark.crowd.film.05.ogg': '/assets/audio/street/bark-hear.ogg',
  '/assets/audio/vo/bark.crowd.film.06.ogg': '/assets/audio/street/talk-tower-a.ogg',
  '/assets/audio/vo/bark.crowd.film.07.ogg': '/assets/audio/street/bark-hear.ogg',
  '/assets/audio/vo/bark.crowd.film.08.ogg': '/assets/audio/street/talk-tower-a.ogg',
  '/assets/audio/vo/bark.crowd.cower.01.ogg': '/assets/audio/sfx/street/scream-man.ogg',
  '/assets/audio/vo/bark.crowd.cower.02.ogg': '/assets/audio/street/bark-walk.ogg',
  '/assets/audio/vo/bark.crowd.cower.03.ogg': '/assets/audio/sfx/street/scream-man.ogg',
  '/assets/audio/vo/bark.crowd.cower.04.ogg': '/assets/audio/street/bark-walk.ogg',
  '/assets/audio/vo/bark.crowd.cower.05.ogg': '/assets/audio/sfx/street/scream-man.ogg',
  '/assets/audio/vo/bark.crowd.cower.06.ogg': '/assets/audio/street/bark-walk.ogg',
  '/assets/audio/vo/bark.crowd.companion.01.ogg': '/assets/audio/street/bark-hear.ogg',
  '/assets/audio/vo/bark.crowd.companion.02.ogg': '/assets/audio/sfx/street/scream-woman.ogg',
  '/assets/audio/vo/bark.crowd.companion.03.ogg': '/assets/audio/street/bark-hear.ogg',
  '/assets/audio/vo/bark.crowd.train.01.ogg': '/assets/audio/sfx/street/scream-man-b.ogg',
  '/assets/audio/vo/bark.crowd.train.02.ogg': '/assets/audio/street/pedestrian-away.ogg',
  '/assets/audio/vo/bark.crowd.train.03.ogg': '/assets/audio/sfx/street/scream-man-b.ogg',
};

export const soundFallback = (url: string): string | null => {
  const clean = url.split('?')[0];
  const fallback = SOUND_FALLBACK[clean];
  return fallback && fallback !== clean ? fallback : null;
};
