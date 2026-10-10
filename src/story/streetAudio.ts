export const STREET_SFX = {
  shadowOn: '/assets/audio/sfx/street/shadow-on.wav',
  shadowOff: '/assets/audio/sfx/street/shadow-off.wav',
  shock: '/assets/audio/sfx/street/shock.wav',
  possess: '/assets/audio/sfx/street/possess.wav',
  consume: '/assets/audio/sfx/street/consume.wav',
  death: '/assets/audio/sfx/street/death.wav',
  car: '/assets/audio/sfx/street/car-pass.wav',
  bell: '/assets/audio/sfx/street/shop-bell.wav',
} as const;

export type StreetLine = { text: string; url: string; hold: number };

export const STREET_BARKS: StreetLine[][] = [
  [
    { text: 'Cold out here.', url: '/assets/audio/street/bark-cold.wav', hold: 1.6 },
    { text: 'Keep walking.', url: '/assets/audio/street/bark-walk.wav', hold: 1.4 },
  ],
  [
    { text: 'You see that tower?', url: '/assets/audio/street/bark-tower.wav', hold: 1.7 },
  ],
  [
    { text: 'Did you hear that?', url: '/assets/audio/street/bark-hear.wav', hold: 1.7 },
  ],
];

export const SHOP_LINE: StreetLine = {
  text: "We're still open.",
  url: '/assets/audio/street/bark-open.wav',
  hold: 3.8,
};

export const STREET_TALKS: { a: number; b: number; first: StreetLine; second: StreetLine }[] = [
  {
    a: 0,
    b: 2,
    first: { text: 'You hear about the tower?', url: '/assets/audio/street/talk-tower-a.wav', hold: 1.9 },
    second: { text: 'Did you hear that?', url: '/assets/audio/street/bark-hear.wav', hold: 1.7 },
  },
  {
    a: 0,
    b: 1,
    first: { text: 'Cold out here.', url: '/assets/audio/street/bark-cold.wav', hold: 1.6 },
    second: { text: 'You see that tower?', url: '/assets/audio/street/bark-tower.wav', hold: 1.7 },
  },
];
