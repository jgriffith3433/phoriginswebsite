import { lineAudio, lineSpeaker, lineText } from '../game/locale';

/** One voiced remark: the subtitle's speaker and text, and the clip. */
export type PlaceLine = { id: string; speaker: string; text: string; url: string };

const ids = (prefix: string, count: number, pad = 2) =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(pad, '0')}`);

/** Commuters on The Station's platform. */
export const STATION_BARKS = ids('bark.station.', 8);
/** The Station's platform announcements (each after the PA chime). */
export const STATION_PA = ids('pa.station.', 3);
/** Riders on The Train. */
export const TRAIN_BARKS = ids('bark.train.r', 8);
/** The conductor over The Train's car speakers. */
export const TRAIN_PA = ids('pa.train.', 2);
/** Apex Peak's board, talking while it waits for Pierce to sit. */
export const APEX_BOARD = ids('bark.apex.', 6);
/** Night security on the radio, heard on The Desk's empty floor, in order. */
export const DESK_RADIO = ids('bark.desk.', 3);

export const PLACE_SFX = {
  paChime: '/assets/audio/sfx/station/pa-chime.ogg',
  trainPass: '/assets/audio/sfx/station/train-pass.ogg',
  door: '/assets/audio/sfx/home/door-open.ogg',
  bed: '/assets/audio/sfx/home/bed-creak.ogg',
  tvStatic: '/assets/audio/sfx/home/tv-static.ogg',
  newsSting: '/assets/audio/sfx/home/news-sting.ogg',
} as const;

export const placeLine = (id: string): PlaceLine | null => {
  const url = lineAudio(id);
  if (!url) return null;
  return { id, speaker: lineSpeaker(id), text: lineText(id), url };
};

/**
 * Picks remarks from a pool at random, never the same one twice in a row, and only lines that have a clip
 * (a line still waiting for its take is skipped). Returns null when none of the pool is voiced yet.
 */
export const createLinePool = (pool: readonly string[]) => {
  let last = '';
  return (): PlaceLine | null => {
    const ready = pool.filter((id) => lineAudio(id));
    if (!ready.length) return null;
    const choices = ready.length > 1 ? ready.filter((id) => id !== last) : ready;
    const id = choices[Math.floor(Math.random() * choices.length)];
    last = id;
    return placeLine(id);
  };
};
