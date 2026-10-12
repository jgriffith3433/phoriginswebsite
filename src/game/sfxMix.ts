import catalog from '../../locales/sfx.json';
import { getSharedAudioContext } from './audioUnlock';

/**
 * `volume` on a sound effect is its full playback level. Preview plays that.
 * Calls still pass the level they were written at (`peak`). Hearing is
 * `volume * (requested / peak)`, so a slider left on the shipped level
 * does not change the mix, and a distance fade still scales.
 */
const PEAKS: Record<string, number> = {
  '/assets/audio/sfx/pistol-shot.ogg': 0.78,
  '/assets/audio/sfx/pistol-draw.ogg': 0.55,
  '/assets/audio/sfx/pistol-holster.ogg': 0.55,
  '/assets/audio/sfx/jump.ogg': 0.42,
  '/assets/audio/sfx/hurt.ogg': 0.45,
  '/assets/audio/sfx/reload.ogg': 0.5,
  '/assets/audio/sfx/walk.ogg': 0.28,
  '/assets/audio/sfx/start.ogg': 0.7,
  '/assets/audio/sfx/objective.ogg': 0.55,
  '/assets/audio/sfx/level-complete.ogg': 0.55,
  '/assets/audio/sfx/flashlight.ogg': 0.4,
  '/assets/audio/sfx/flashlight-off.ogg': 0.4,
  '/assets/audio/sfx/phone-out.ogg': 0.45,
  '/assets/audio/sfx/phone-away.ogg': 0.45,
  '/assets/audio/sfx/punch.ogg': 0.55,
  '/assets/audio/sfx/kick.ogg': 0.55,
  '/assets/audio/sfx/phone/dial.wav': 0.42,
  '/assets/audio/sfx/phone/ringback.wav': 0.4,
  '/assets/audio/sfx/phone/busy.wav': 0.42,
  '/assets/audio/sfx/phone/hangup.wav': 0.45,
  '/assets/audio/sfx/phone/ring.wav': 0.5,
  '/assets/audio/sfx/phone/connect.wav': 0.4,
  '/assets/audio/sfx/street/shadow-on.wav': 0.4,
  '/assets/audio/sfx/street/shadow-off.wav': 0.4,
  '/assets/audio/sfx/street/shock.wav': 0.5,
  '/assets/audio/sfx/street/possess.wav': 0.4,
  '/assets/audio/sfx/street/consume.wav': 0.46,
  '/assets/audio/sfx/street/death.wav': 0.42,
  '/assets/audio/sfx/street/car-pass.wav': 0.2,
  '/assets/audio/sfx/street/shop-bell.wav': 0.32,
  '/assets/audio/sfx/street/shadow-run.ogg': 0.4,
  '/assets/audio/sfx/street/scream-woman.ogg': 0.72,
  '/assets/audio/sfx/street/scream-man.ogg': 0.72,
  '/assets/audio/sfx/street/scream-man-b.ogg': 0.72,
  '/assets/audio/sfx/street/scream-police.ogg': 0.72,
  '/assets/audio/cutscenes/elevator-b3/hum.wav': 0.3,
  '/assets/audio/cutscenes/elevator-b3/beep.wav': 0.7,
  '/assets/audio/cutscenes/elevator-b3/doors.wav': 0.65,
  '/assets/audio/cutscenes/elevator-b3/rumble.wav': 0.38,
  '/assets/audio/cutscenes/apex-window/alarm.wav': 0.46,
  '/assets/audio/sfx/creature/skitter.wav': 0.3,
  '/assets/audio/sfx/creature/scrape.wav': 0.37,
  '/assets/audio/sfx/creature/hiss.wav': 0.58,
  '/assets/audio/sfx/creature/shriek.wav': 0.78,
  '/assets/audio/sfx/creature/cry.wav': 0.2,
  '/assets/audio/sfx/creature/heartbeat.wav': 0.55,
  '/assets/audio/sfx/creature/snarl.wav': 0.7,
  '/assets/audio/sfx/creature/wound.wav': 0.62,
  '/assets/audio/sfx/creature/tick.wav': 0.24,
  '/assets/audio/sfx/creature/knock.wav': 0.16,
  '/assets/audio/sfx/creature/chitter.wav': 0.26,
  '/assets/audio/sfx/glass-tick.ogg': 0.5,
  '/assets/audio/cutscenes/b3-door-reveal/creature-breath.wav': 0.38,
  '/assets/audio/cutscenes/b3-door-reveal/creature-run.wav': 0.55,
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

const clean = (url: string) => url.split('?')[0];

const levels = new Map<string, number>();
for (const effect of catalog.effects as { audio?: string; volume?: number }[]) {
  if (!effect.audio || typeof effect.volume !== 'number') continue;
  levels.set(effect.audio, effect.volume);
}

export const mixVolume = (url: string, requested: number) => {
  const set = levels.get(clean(url));
  if (set == null) return clamp(requested);
  const peak = PEAKS[clean(url)];
  if (peak == null || peak <= 0) return clamp(requested * set);
  return clamp(set * (requested / peak));
};

export type LoopHandle = {
  setVolume: (volume: number) => void;
  stop: () => void;
};

const buffers = new Map<string, Promise<AudioBuffer>>();

const loadBuffer = (url: string, ctx: AudioContext) => {
  let pending = buffers.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data.slice(0)));
    buffers.set(url, pending);
  }
  return pending;
};

/** Sample-locked loop. An element loop leaves a gap in a cab hum. */
export const startGaplessLoop = async (url: string, volume: number): Promise<LoopHandle | null> => {
  const ctx = getSharedAudioContext();
  if (!ctx) return null;
  let buffer: AudioBuffer;
  try {
    buffer = await loadBuffer(clean(url), ctx);
  } catch {
    buffers.delete(clean(url));
    return null;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = clamp(volume);
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start();
  return {
    setVolume: (next) => {
      const now = ctx.currentTime;
      const value = clamp(next);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(value, now + 0.18);
    },
    stop: () => {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.12);
      try { source.stop(now + 0.13); } catch { /* already stopped */ }
    },
  };
};
