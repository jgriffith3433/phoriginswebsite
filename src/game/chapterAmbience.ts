/**
 * Layered chapter ambience: each of the eight levels keeps its music-trigger bed looping and fires
 * randomised one-shots through the spatial panners so a walk never goes quiet for more than ~10 s
 * (outside the scripted silences in docs/music.md). Low tier / phone caps concurrent spots at 4.
 */
import type { SoundClass, Vec3, WorldOptions } from './acoustics';

export type AmbienceSpot = {
  id: string;
  url: string;
  volume: number;
  cls: SoundClass;
  /** Horizontal metres from Pierce (random angle). */
  radius: [number, number];
  y?: number;
};

export type ChapterAmbienceHost = {
  play: (url: string, volume: number, world?: WorldOptions) => void;
  player: () => { x: number; y: number; z: number };
  /** True while a scripted silence holds (cold open score, vat break, mirror, end card). Spots pause; the bed may still run. */
  scriptedSilence: () => boolean;
  /** True while Pierce can walk the level (Start pressed, not paused under a card). */
  active: () => boolean;
  /** Low memory / Low graphics: at most 4 live spots. */
  lowTier?: () => boolean;
};

const spot = (
  id: string,
  url: string,
  volume: number,
  cls: SoundClass,
  radius: [number, number],
  y = 1.4,
): AmbienceSpot => ({ id, url, volume, cls, radius, y });

/** Per-chapter spot pools (6–10 each). Beds stay on the level music triggers. */
export const CHAPTER_SPOTS: Record<number, AmbienceSpot[]> = {
  1: [
    spot('apex-hvac', '/assets/audio/sfx/ambience/apex-hvac.ogg', 0.22, 'ambience', [4, 14], 2.6),
    spot('apex-phone', '/assets/audio/sfx/ambience/apex-phone.ogg', 0.18, 'effect', [6, 18], 1.2),
    spot('apex-printer', '/assets/audio/sfx/ambience/apex-printer.ogg', 0.2, 'machinery', [5, 16], 1.1),
    spot('apex-ding', '/assets/audio/cutscenes/elevator-b3/beep.wav', 0.28, 'effect', [8, 22], 1.5),
    spot('apex-walla', '/assets/audio/sfx/ambience/apex-walla.ogg', 0.16, 'ambience', [10, 24], 1.6),
    spot('apex-flicker', '/assets/audio/sfx/apex/troffer-flicker.ogg', 0.2, 'machinery', [3, 12], 2.8),
    spot('apex-skyline', '/assets/audio/sfx/apex/skyline.ogg', 0.14, 'ambience', [2, 8], 1.8),
    spot('apex-glass', '/assets/audio/sfx/glass-tick.ogg', 0.18, 'effect', [2, 10], 1.5),
  ],
  2: [
    spot('b3-drip', '/assets/audio/sfx/ambience/b3-drip.ogg', 0.28, 'ambience', [2, 10], 2.2),
    spot('b3-pipe', '/assets/audio/sfx/ambience/b3-pipe-groan.ogg', 0.26, 'machinery', [4, 16], 1.8),
    spot('b3-machine', '/assets/audio/sfx/ambience/b3-machinery.ogg', 0.22, 'machinery', [8, 22], 1.2),
    spot('b3-buzz', '/assets/audio/sfx/b3/fluorescent-buzz.ogg', 0.18, 'ambience', [3, 12], 2.6),
    spot('b3-radio', '/assets/audio/sfx/b3/radio-crackle.ogg', 0.2, 'effect', [5, 14], 1.1),
    spot('b3-knock', '/assets/audio/sfx/creature/knock.wav', 0.16, 'machinery', [6, 18], 1.4),
    spot('b3-scrape', '/assets/audio/sfx/creature/scrape.wav', 0.14, 'effect', [8, 20], 0.4),
    spot('b3-tick', '/assets/audio/sfx/glass-tick.ogg', 0.15, 'effect', [3, 11], 1.0),
  ],
  3: [
    spot('return-buzz', '/assets/audio/sfx/b3/fluorescent-buzz.ogg', 0.24, 'ambience', [2, 10], 2.7),
    spot('return-door', '/assets/audio/sfx/ambience/return-door.ogg', 0.22, 'effect', [10, 28], 1.4),
    spot('return-flicker', '/assets/audio/sfx/apex/troffer-flicker.ogg', 0.2, 'machinery', [3, 12], 2.8),
    spot('return-drip', '/assets/audio/sfx/ambience/b3-drip.ogg', 0.16, 'ambience', [4, 14], 2.0),
    spot('return-pipe', '/assets/audio/sfx/ambience/b3-pipe-groan.ogg', 0.14, 'machinery', [8, 20], 1.6),
    spot('return-ding', '/assets/audio/cutscenes/elevator-b3/beep.wav', 0.2, 'effect', [12, 30], 1.5),
    spot('return-glass', '/assets/audio/sfx/glass-tick.ogg', 0.14, 'effect', [2, 9], 1.4),
    spot('return-knock', '/assets/audio/sfx/creature/knock.wav', 0.12, 'machinery', [10, 24], 1.2),
  ],
  4: [
    spot('desk-city', '/assets/audio/sfx/apex/skyline.ogg', 0.26, 'ambience', [1, 4], 1.6),
    spot('desk-clock', '/assets/audio/sfx/ambience/desk-clock.ogg', 0.2, 'effect', [0.8, 2.5], 1.2),
    spot('desk-hvac', '/assets/audio/sfx/ambience/apex-hvac.ogg', 0.16, 'ambience', [3, 10], 2.5),
    spot('desk-phone', '/assets/audio/sfx/ambience/apex-phone.ogg', 0.14, 'effect', [8, 20], 1.2),
    spot('desk-paper', '/assets/audio/sfx/desk/paper-slide.ogg', 0.12, 'effect', [0.5, 2], 1.0),
    spot('desk-glass', '/assets/audio/sfx/glass-tick.ogg', 0.16, 'effect', [1, 5], 1.5),
    spot('desk-flicker', '/assets/audio/sfx/apex/troffer-flicker.ogg', 0.14, 'machinery', [2, 8], 2.6),
    spot('desk-printer', '/assets/audio/sfx/ambience/apex-printer.ogg', 0.12, 'machinery', [6, 16], 1.1),
  ],
  5: [
    spot('street-rain', '/assets/audio/sfx/street/rain-hiss.ogg', 0.22, 'ambience', [4, 14], 2.0),
    spot('street-siren', '/assets/audio/sfx/street/siren-police.mp3', 0.2, 'effect', [18, 40], 1.5),
    spot('street-car', '/assets/audio/sfx/street/car-pass.wav', 0.24, 'machinery', [8, 22], 1.0),
    spot('street-neon', '/assets/audio/sfx/ambience/street-neon.ogg', 0.18, 'ambience', [3, 12], 2.4),
    spot('street-walla', '/assets/audio/sfx/ambience/street-walla.ogg', 0.16, 'ambience', [6, 18], 1.5),
    spot('street-awning', '/assets/audio/sfx/ambience/street-awning.ogg', 0.2, 'ambience', [2, 8], 2.2),
    spot('street-bell', '/assets/audio/sfx/street/shop-bell.wav', 0.18, 'effect', [5, 16], 1.3),
    spot('street-hiss', '/assets/audio/sfx/street/rain-hiss.ogg', 0.14, 'ambience', [10, 24], 1.8),
  ],
  6: [
    spot('station-pass', '/assets/audio/sfx/station/train-pass.ogg', 0.28, 'machinery', [12, 30], 1.2),
    spot('station-walla', '/assets/audio/sfx/ambience/station-walla.ogg', 0.2, 'ambience', [4, 14], 1.5),
    spot('station-chime', '/assets/audio/sfx/station/pa-chime.ogg', 0.22, 'effect', [6, 18], 2.4),
    spot('station-doors', '/assets/audio/train/doors-open.ogg', 0.18, 'effect', [10, 26], 1.2),
    spot('station-rumble', '/assets/audio/train/rumble.ogg', 0.14, 'ambience', [16, 36], 0.8),
    spot('station-close', '/assets/audio/train/doors-close.ogg', 0.16, 'effect', [10, 24], 1.2),
  ],
  7: [
    spot('train-clatter', '/assets/audio/sfx/ambience/train-clatter.ogg', 0.28, 'machinery', [1, 6], 0.4),
    spot('train-joint', '/assets/audio/sfx/ambience/train-clatter.ogg', 0.22, 'machinery', [2, 8], 0.3),
    spot('train-chime', '/assets/audio/sfx/station/pa-chime.ogg', 0.2, 'effect', [4, 12], 2.0),
    spot('train-doors', '/assets/audio/train/doors-open.ogg', 0.18, 'effect', [3, 10], 1.2),
    spot('train-close', '/assets/audio/train/doors-close.ogg', 0.16, 'effect', [3, 10], 1.2),
    spot('train-brake', '/assets/audio/train/brakes.ogg', 0.14, 'machinery', [6, 16], 0.8),
    spot('train-rumble', '/assets/audio/train/rumble.ogg', 0.12, 'ambience', [1, 4], 0.5),
    spot('train-creak', '/assets/audio/sfx/apex/sofa-creak.ogg', 0.14, 'effect', [0.5, 3], 1.0),
  ],
  8: [
    spot('morning-birds', '/assets/audio/sfx/ambience/morning-birds.ogg', 0.22, 'ambience', [4, 14], 2.2),
    spot('morning-traffic', '/assets/audio/sfx/ambience/morning-traffic.ogg', 0.18, 'ambience', [8, 22], 1.6),
    spot('morning-fridge', '/assets/audio/sfx/ambience/morning-fridge.ogg', 0.2, 'machinery', [1, 3.5], 1.0),
    // Domestic only: a wall clock and the street. The old pool fired the CRT static burst, a bed creak and a door
    // swing at random spots around him all morning (the "weird sound" J heard); the TV and the bed sound when used.
    spot('morning-clock', '/assets/audio/sfx/ambience/desk-clock.ogg', 0.1, 'effect', [1.5, 3.5], 1.6),
    spot('morning-kettle', '/assets/audio/sfx/ambience/morning-fridge.ogg', 0.12, 'machinery', [2, 5], 1.0),
    spot('morning-skyline', '/assets/audio/sfx/apex/skyline.ogg', 0.14, 'ambience', [3, 10], 1.8),
  ],
};

const GAP: Record<number, [number, number]> = {
  1: [2.8, 6.5],
  2: [2.2, 5.5],
  3: [3.0, 7.0],
  4: [3.2, 7.5],
  5: [2.5, 6.0],
  6: [2.4, 5.8],
  7: [2.0, 4.5],
  8: [3.5, 8.0],
};

const MAX_LIVE_LOW = 4;
const MAX_LIVE_HIGH = 8;

const defaultLow = () => {
  try {
    return document.body?.getAttribute('data-memory') === 'low'
      || document.body?.getAttribute('data-device') === 'mobile'
      || document.body?.getAttribute('data-device') === 'tablet';
  } catch {
    return false;
  }
};

export type ChapterAmbienceProbe = {
  level: number;
  live: number;
  maxLive: number;
  spotsPlayed: string[];
  distinctSpots: number;
  lastSpotId: string | null;
  lastSpotAtMs: number;
  silenceMs: number;
  startedAtMs: number;
  fired: number;
};

export const createChapterAmbience = (host: ChapterAmbienceHost) => {
  let level = 0;
  let nextIn = 0.35;
  let live = 0;
  let lastId = '';
  let lastAt = 0;
  let startedAt = 0;
  let silenceSince = 0;
  let fired = 0;
  const played: string[] = [];
  const recent: string[] = [];

  const maxLive = () => ((host.lowTier ?? defaultLow)() ? MAX_LIVE_LOW : MAX_LIVE_HIGH);

  const placeAround = (s: AmbienceSpot): Vec3 => {
    const p = host.player();
    const [r0, r1] = s.radius;
    const r = r0 + Math.random() * Math.max(0.1, r1 - r0);
    const a = Math.random() * Math.PI * 2;
    return { x: p.x + Math.sin(a) * r, y: p.y + (s.y ?? 1.4), z: p.z + Math.cos(a) * r };
  };

  const pick = (): AmbienceSpot | null => {
    const pool = CHAPTER_SPOTS[level];
    if (!pool?.length) return null;
    const choices = pool.length > 1 ? pool.filter((s) => s.id !== lastId && !recent.includes(s.id)) : pool;
    const list = choices.length ? choices : pool.filter((s) => s.id !== lastId);
    const use = list.length ? list : pool;
    return use[Math.floor(Math.random() * use.length)];
  };

  const fire = () => {
    const s = pick();
    if (!s) return;
    const at = placeAround(s);
    live += 1;
    fired += 1;
    lastId = s.id;
    lastAt = performance.now();
    silenceSince = lastAt;
    if (!played.includes(s.id)) played.push(s.id);
    recent.push(s.id);
    if (recent.length > 4) recent.shift();
    const world: WorldOptions = { at, cls: s.cls };
    host.play(s.url, s.volume, world);
    // Spots are short; free the live slot after a bound so the cap stays honest without clip handles.
    const hold = s.cls === 'ambience' ? 4.5 : 2.8;
    window.setTimeout(() => { live = Math.max(0, live - 1); }, hold * 1000);
  };

  const start = (nextLevel: number) => {
    level = nextLevel >= 1 && nextLevel <= 8 ? nextLevel : 0;
    nextIn = 0.25;
    live = 0;
    lastId = '';
    played.length = 0;
    recent.length = 0;
    fired = 0;
    startedAt = performance.now();
    silenceSince = startedAt;
    lastAt = 0;
  };

  const stop = () => {
    level = 0;
    live = 0;
    nextIn = 1;
  };

  const update = (dt: number) => {
    if (!level || !host.active()) return;
    if (host.scriptedSilence()) {
      silenceSince = performance.now();
      return;
    }
    nextIn -= dt;
    if (nextIn > 0) return;
    if (live >= maxLive()) {
      nextIn = 0.4;
      return;
    }
    fire();
    const [g0, g1] = GAP[level] ?? [3, 7];
    nextIn = g0 + Math.random() * Math.max(0.2, g1 - g0);
  };

  const probe = (): ChapterAmbienceProbe => {
    const now = performance.now();
    return {
      level,
      live,
      maxLive: maxLive(),
      spotsPlayed: [...played],
      distinctSpots: played.length,
      lastSpotId: lastId || null,
      lastSpotAtMs: lastAt ? Math.round(now - lastAt) : -1,
      silenceMs: Math.round(now - silenceSince),
      startedAtMs: startedAt ? Math.round(now - startedAt) : -1,
      fired,
    };
  };

  return { start, stop, update, probe, spotsFor: (n: number) => CHAPTER_SPOTS[n] ?? [] };
};

export type ChapterAmbience = ReturnType<typeof createChapterAmbience>;
