import { lineAudio, lineText } from '../game/locale';

export const STREET_SFX = {
  shadowOn: '/assets/audio/sfx/street/shadow-on.wav',
  shadowOff: '/assets/audio/sfx/street/shadow-off.wav',
  shock: '/assets/audio/sfx/street/shock.wav',
  possess: '/assets/audio/sfx/street/possess.wav',
  consume: '/assets/audio/sfx/street/consume.wav',
  death: '/assets/audio/sfx/street/death.wav',
  car: '/assets/audio/sfx/street/car-pass.wav',
  bell: '/assets/audio/sfx/street/shop-bell.wav',
  punch: '/assets/audio/sfx/punch.ogg',
  kick: '/assets/audio/sfx/kick.ogg',
  screamWoman: '/assets/audio/sfx/street/scream-woman.ogg',
  screamMan: '/assets/audio/sfx/street/scream-man.ogg',
  screamManB: '/assets/audio/sfx/street/scream-man-b.ogg',
  screamPolice: '/assets/audio/sfx/street/scream-police.ogg',
} as const;

let screamTurn = 0;

export const deathScream = (kind: 'woman' | 'man' | 'police') => {
  if (kind === 'police') return STREET_SFX.screamPolice;
  if (kind === 'woman') return STREET_SFX.screamWoman;
  screamTurn += 1;
  return screamTurn % 2 === 0 ? STREET_SFX.screamManB : STREET_SFX.screamMan;
};

export type StreetLine = { id: string; hold: number };

export const STREET_BARKS: StreetLine[][] = [
  [
    { id: 'bark.street.cold', hold: 1.6 },
    { id: 'bark.street.walk', hold: 1.4 },
  ],
  [
    { id: 'bark.street.tower', hold: 1.7 },
  ],
  [
    { id: 'bark.street.hear', hold: 1.7 },
  ],
];

export const SHOP_LINE: StreetLine = { id: 'bark.street.open', hold: 3.8 };

export const STREET_TALKS: { a: number; b: number; first: StreetLine; second: StreetLine }[] = [
  {
    a: 0,
    b: 2,
    first: { id: 'bark.street.talk-tower', hold: 1.9 },
    second: { id: 'bark.street.hear', hold: 1.7 },
  },
  {
    a: 0,
    b: 1,
    first: { id: 'bark.street.cold', hold: 1.6 },
    second: { id: 'bark.street.tower', hold: 1.7 },
  },
];

export const streetCopy = (line: StreetLine) => ({
  text: lineText(line.id),
  url: lineAudio(line.id),
  hold: line.hold,
});
