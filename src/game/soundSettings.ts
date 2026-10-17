/**
 * The studio's standard sound settings, shared by every Hawkes game: localStorage "hawkes.sound" holds
 * { on, music, sfx }, the volumes 0-1. Music is the level beds and the ending songs. Effects is everything
 * else: sound effects, voice lines, phone tones. audioUnlock.ts applies them to every clip.
 */

export type SoundSettings = { on: boolean; music: number; sfx: number };
export type SoundBus = 'music' | 'sfx';

export const SOUND_KEY = 'hawkes.sound';
const DEFAULTS: SoundSettings = { on: true, music: 1, sfx: 1 };

const level = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};

export const readSoundSettings = (): SoundSettings => {
  try {
    const raw = localStorage.getItem(SOUND_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<SoundSettings>;
    return {
      on: parsed.on !== false,
      music: level(parsed.music, DEFAULTS.music),
      sfx: level(parsed.sfx, DEFAULTS.sfx),
    };
  } catch {
    return { ...DEFAULTS };
  }
};

let current = readSoundSettings();
const listeners = new Set<(settings: SoundSettings) => void>();

export const soundSettings = (): SoundSettings => ({ ...current });

/** What a bus plays at: its volume, or 0 with Sound off. */
export const busLevel = (bus: SoundBus) => (current.on ? current[bus] : 0);

export const setSoundSettings = (next: Partial<SoundSettings>) => {
  current = {
    on: next.on ?? current.on,
    music: level(next.music ?? current.music, current.music),
    sfx: level(next.sfx ?? current.sfx, current.sfx),
  };
  try {
    localStorage.setItem(SOUND_KEY, JSON.stringify(current));
  } catch {
    // Private mode can block storage; the choice still holds for this visit.
  }
  for (const listener of listeners) listener(soundSettings());
};

export const onSoundSettings = (listener: (settings: SoundSettings) => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
