/**
 * Camera and subtitle choices, saved beside hawkes.sound as localStorage "hawkes.settings".
 * Invert Y defaults off for new players; a saved choice is kept. Sensitivity is 0.5×–2×. Graphics is the
 * Settings tier (src/render/pipeline.ts); null lets the device pick.
 */

import { parseGraphicsTier, type GraphicsTier } from '../render/pipeline';

export type SubtitleSize = 'sm' | 'md' | 'lg';

export type GameSettings = {
  invertY: boolean;
  mouseSens: number;
  touchSens: number;
  subtitles: boolean;
  subtitleSize: SubtitleSize;
  subtitleBox: boolean;
  /** Graphics Low / Medium / High; null until the player picks one (the device decides). */
  graphics: GraphicsTier | null;
};

export const GAME_SETTINGS_KEY = 'hawkes.settings';

const DEFAULTS: GameSettings = {
  invertY: false,
  mouseSens: 1,
  touchSens: 1,
  subtitles: true,
  subtitleSize: 'md',
  subtitleBox: true,
  graphics: null,
};

const clampSens = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0.5, Math.min(2, n)) : fallback;
};

const sizeOf = (value: unknown): SubtitleSize =>
  value === 'sm' || value === 'lg' || value === 'md' ? value : DEFAULTS.subtitleSize;

export const readGameSettings = (): GameSettings => {
  try {
    const raw = localStorage.getItem(GAME_SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      invertY: parsed.invertY === true,
      mouseSens: clampSens(parsed.mouseSens, DEFAULTS.mouseSens),
      touchSens: clampSens(parsed.touchSens, DEFAULTS.touchSens),
      subtitles: parsed.subtitles !== false,
      subtitleSize: sizeOf(parsed.subtitleSize),
      subtitleBox: parsed.subtitleBox !== false,
      graphics: parseGraphicsTier(parsed.graphics),
    };
  } catch {
    return { ...DEFAULTS };
  }
};

let current = readGameSettings();
const listeners = new Set<(settings: GameSettings) => void>();

export const gameSettings = (): GameSettings => ({ ...current });

export const setGameSettings = (next: Partial<GameSettings>) => {
  current = {
    invertY: next.invertY ?? current.invertY,
    mouseSens: clampSens(next.mouseSens ?? current.mouseSens, current.mouseSens),
    touchSens: clampSens(next.touchSens ?? current.touchSens, current.touchSens),
    subtitles: next.subtitles ?? current.subtitles,
    subtitleSize: sizeOf(next.subtitleSize ?? current.subtitleSize),
    subtitleBox: next.subtitleBox ?? current.subtitleBox,
    graphics: next.graphics !== undefined ? parseGraphicsTier(next.graphics) : current.graphics,
  };
  try {
    localStorage.setItem(GAME_SETTINGS_KEY, JSON.stringify(current));
  } catch {
    // Private mode can block storage; the choice still holds for this visit.
  }
  for (const listener of listeners) listener(gameSettings());
};

export const onGameSettings = (listener: (settings: GameSettings) => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
