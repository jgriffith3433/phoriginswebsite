import type { PlayerState } from './types';
import type { SceneTrigger } from './sceneData';
import { playClip, type ClipHandle } from './sfxMix';

export type TriggerHandler = (trigger: SceneTrigger) => void;

export const MUSIC_TRIGGER_TYPE = 'music';

export const isMusicTrigger = (trigger: SceneTrigger): boolean => {
  const type = String(trigger.type ?? '').toLowerCase();
  return type === MUSIC_TRIGGER_TYPE || type === 'bgm';
};

export const musicTriggerAudio = (trigger: SceneTrigger): string => {
  const data = trigger.data ?? {};
  return String(data.audio ?? data.path ?? '').trim();
};

/** A bed's stand-in (`data.fallback`) while its own file is missing or fails to load. */
export const musicTriggerFallback = (trigger: SceneTrigger): string => {
  const data = trigger.data ?? {};
  return String(data.fallback ?? '').trim();
};

const triggerRadius = (trigger: SceneTrigger, fallback = 1.7): number => {
  const radius = Number(trigger.data?.radius ?? fallback);
  return Number.isFinite(radius) && radius > 0 ? radius : fallback;
};

const triggerFadeSeconds = (trigger: SceneTrigger): number => {
  const fade = Number(trigger.data?.fadeSeconds ?? 2);
  return Number.isFinite(fade) && fade >= 0 ? fade : 2;
};

const triggerPeakVolume = (trigger: SceneTrigger): number => {
  const volume = Number(trigger.data?.volume ?? 0.32);
  if (!Number.isFinite(volume)) return 0.32;
  return Math.max(0, Math.min(1, volume));
};

const triggerXz = (trigger: SceneTrigger): { x: number; y: number; z: number } => ({
  x: trigger.x ?? trigger.position?.x ?? 0,
  y: trigger.y ?? trigger.position?.y ?? 0,
  z: trigger.z ?? trigger.position?.z ?? 0,
});

/** Camera (or player) inside the trigger's XZ radius; optional `data.height` is a Y slab. */
export const pointInsideTrigger = (
  trigger: SceneTrigger,
  point: { x: number; y?: number; z: number },
  fallbackRadius = 1.7,
): boolean => {
  const origin = triggerXz(trigger);
  const radius = triggerRadius(trigger, fallbackRadius);
  const dx = point.x - origin.x;
  const dz = point.z - origin.z;
  if (dx * dx + dz * dz > radius * radius) return false;
  const height = Number(trigger.data?.height);
  if (Number.isFinite(height) && height > 0) {
    const y = point.y ?? origin.y;
    return Math.abs(y - origin.y) <= height * 0.5;
  }
  return true;
};

export const createTriggerRunner = (onEnter: TriggerHandler) => {
  let triggers: SceneTrigger[] = [];
  const fired = new Set<string>();

  const bind = (next: SceneTrigger[]) => {
    triggers = next;
    fired.clear();
  };

  const update = (player: PlayerState) => {
    for (const trigger of triggers) {
      if (isMusicTrigger(trigger)) continue;
      if (fired.has(trigger.id)) continue;
      if (pointInsideTrigger(trigger, player)) {
        fired.add(trigger.id);
        onEnter(trigger);
      }
    }
  };

  return { bind, update, reset: () => fired.clear() };
};

type MusicVoice = {
  triggerId: string;
  url: string;
  /** The bed, playing through Web Audio on the music bus (a phone needs no finger down, the probe sees it). */
  clip: ClipHandle | null;
  loop: boolean;
  gain: number;
  target: number;
  fade: number;
  peak: number;
  /** Last level sent to the clip, so the per-frame update only touches the graph when it changes. */
  sent: number;
  fellBack: boolean;
};

export const createMusicTriggerPlayer = () => {
  let triggers: SceneTrigger[] = [];
  let insidePrev = new Set<string>();
  let activeId: string | null = null;
  let duck = 1;
  let duckTarget = 1;
  const voices = new Map<string, MusicVoice>();

  const stopVoice = (voice: MusicVoice) => {
    voice.clip?.stop(0.2);
    voice.clip = null;
  };

  const stopAll = () => {
    voices.forEach(stopVoice);
    voices.clear();
    insidePrev.clear();
    activeId = null;
  };

  const bind = (next: SceneTrigger[]) => {
    triggers = next.filter(isMusicTrigger);
    stopAll();
  };

  const startClip = (voice: MusicVoice, trigger: SceneTrigger, url: string) => {
    const fallback = musicTriggerFallback(trigger);
    voice.sent = -1;
    voice.clip = playClip(url, 0, {
      loop: voice.loop,
      bus: 'music',
      // The bed's own file is missing or will not decode: loop the stand-in instead.
      onError: () => {
        if (voices.get(trigger.id) !== voice || voice.fellBack) return;
        voice.fellBack = true;
        if (fallback && fallback !== url) startClip(voice, trigger, fallback);
      },
    });
  };

  const ensureVoice = (trigger: SceneTrigger): MusicVoice | null => {
    const url = musicTriggerAudio(trigger);
    if (!url) return null;
    const existing = voices.get(trigger.id);
    if (existing && existing.url === url) {
      existing.fade = triggerFadeSeconds(trigger);
      existing.peak = triggerPeakVolume(trigger);
      existing.loop = trigger.data?.loop !== false;
      return existing;
    }
    if (existing) stopVoice(existing);

    const voice: MusicVoice = {
      triggerId: trigger.id,
      url,
      clip: null,
      loop: trigger.data?.loop !== false,
      gain: 0,
      target: 0,
      fade: triggerFadeSeconds(trigger),
      peak: triggerPeakVolume(trigger),
      sent: -1,
      fellBack: false,
    };
    voices.set(trigger.id, voice);
    startClip(voice, trigger, url);
    return voice;
  };

  const setActive = (nextId: string | null) => {
    if (nextId === activeId) return;
    if (activeId) {
      const previous = voices.get(activeId);
      if (previous) previous.target = 0;
    }
    activeId = nextId;
    if (!nextId) return;
    const trigger = triggers.find((entry) => entry.id === nextId);
    if (!trigger) {
      activeId = null;
      return;
    }
    const voice = ensureVoice(trigger);
    if (!voice) {
      activeId = null;
      return;
    }
    voice.target = 1;
  };

  const update = (
    camera: { x: number; y?: number; z: number },
    delta: number,
    enabled: boolean,
    duckAmount = 1,
  ) => {
    if (!enabled) {
      setActive(null);
      insidePrev.clear();
    } else {
      const inside = triggers.filter((trigger) => pointInsideTrigger(trigger, camera, 8));
      const insideIds = new Set(inside.map((trigger) => trigger.id));
      const entered = inside.filter((trigger) => !insidePrev.has(trigger.id));

      let nextActive = activeId;
      if (entered.length > 0) {
        nextActive = entered[entered.length - 1].id;
      } else if (!nextActive || !insideIds.has(nextActive)) {
        nextActive = inside.length > 0 ? inside[inside.length - 1].id : null;
      }
      setActive(nextActive);
      insidePrev = insideIds;
    }

    const dt = Math.max(0, delta);
    duckTarget = Math.max(0, Math.min(1, duckAmount));
    const duckDelta = (1 / 0.45) * dt;
    if (Math.abs(duckTarget - duck) <= duckDelta) duck = duckTarget;
    else duck += Math.sign(duckTarget - duck) * duckDelta;

    voices.forEach((voice, id) => {
      const speed = voice.fade > 0 ? 1 / voice.fade : 1e6;
      const deltaGain = speed * dt;
      if (Math.abs(voice.target - voice.gain) <= deltaGain) voice.gain = voice.target;
      else voice.gain += Math.sign(voice.target - voice.gain) * deltaGain;

      const level = Math.max(0, Math.min(1, voice.gain * voice.peak * duck));
      if (voice.clip && Math.abs(level - voice.sent) > 0.002) {
        voice.clip.setVolume(level);
        voice.sent = level;
      }

      if (voice.target <= 0 && voice.gain <= 0 && id !== activeId) {
        stopVoice(voice);
        voices.delete(id);
      }
    });
  };

  return { bind, update, stop: stopAll, active: () => activeId, playing: () => [...voices.values()].some((v) => !!v.clip && !v.clip.done() && v.gain > 0.001) };
};
