export type CutsceneVec3 = { x: number; y: number; z: number };

export type TimelineEvent = {
  at: number;
  type: 'camera' | 'hud' | 'audio' | 'line' | 'anim' | 'end';
  position?: CutsceneVec3;
  lookAt?: CutsceneVec3;
  title?: string;
  text?: string;
  clip?: string;
  audio?: string;
  bus?: 'vo' | 'sfx' | 'music';
  volume?: number;
  loop?: boolean;
  actor?: string;
  speaker?: string;
  anim?: string;
  duration?: number;
};

export type CutsceneTimeline = {
  id: string;
  name?: string;
  duration?: number;
  notes?: string;
  events: TimelineEvent[];
};

export type CutsceneHooks = {
  onCamera: (position: CutsceneVec3, lookAt: CutsceneVec3) => void;
  onHud: (title?: string, text?: string) => void;
  onAnim: (actor: string, clip: string, loop: boolean) => void;
  audioEnabled: () => boolean;
};

export type ActiveCutscene = {
  id: string;
  timeline: CutsceneTimeline;
  time: number;
  duration: number;
  cursor: number;
  playing: HTMLAudioElement[];
  hooks: CutsceneHooks;
  lineHold: { until: number; actor: string; restClip: string } | null;
};

const cache = new Map<string, CutsceneTimeline>();

const sortEvents = (events: TimelineEvent[]) =>
  [...events].sort((a, b) => a.at - b.at || a.type.localeCompare(b.type));

const parseTimeline = (raw: unknown, fallbackId: string): CutsceneTimeline | null => {
  const data = raw && typeof raw === 'object' ? raw as Partial<CutsceneTimeline> : null;
  if (!data || !Array.isArray(data.events) || data.events.length === 0) return null;
  const events = sortEvents(data.events.map((event) => ({
    ...event,
    at: Number(event.at) || 0,
  })));
  const lastAt = events.reduce((max, event) => Math.max(max, event.at), 0);
  return {
    id: String(data.id ?? fallbackId),
    name: data.name,
    notes: data.notes,
    duration: Number(data.duration ?? lastAt),
    events,
  };
};

export const loadCutsceneTimeline = async (id: string): Promise<CutsceneTimeline | null> => {
  const cached = cache.get(id);
  if (cached) return cached;
  try {
    const response = await fetch(`/cutscenes/${id}.json`, { cache: 'no-store' });
    if (!response.ok) return null;
    const parsed = parseTimeline(await response.json(), id);
    if (!parsed) return null;
    cache.set(id, parsed);
    return parsed;
  } catch {
    return null;
  }
};

const stopAudio = (cutscene: ActiveCutscene) => {
  cutscene.playing.forEach((element) => {
    element.pause();
    element.src = '';
  });
  cutscene.playing.length = 0;
};

const playFile = (cutscene: ActiveCutscene, url: string, volume: number, loop: boolean, stubSeconds = 1.6) => {
  if (!cutscene.hooks.audioEnabled() || !url) return;
  const element = new Audio(url);
  element.loop = loop;
  element.volume = Math.max(0, Math.min(1, volume));
  const handleError = () => {
    element.removeEventListener('error', handleError);
    playVoiceStub(cutscene, stubSeconds, 168);
  };
  element.addEventListener('error', handleError);
  void element.play().catch(() => playVoiceStub(cutscene, stubSeconds, 168));
  cutscene.playing.push(element);
};

const playVoiceStub = (cutscene: ActiveCutscene, seconds: number, hz: number) => {
  if (!cutscene.hooks.audioEnabled()) return;
  const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return;
  const ctx = new AudioCtor();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = hz;
  gain.gain.value = 0.045;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  const end = ctx.currentTime + Math.max(0.4, seconds);
  gain.gain.setValueAtTime(0.045, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.stop(end);
};

const speakerPitch = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return 140 + (Math.abs(hash) % 90);
};

const lineDuration = (text: string) => Math.max(1.4, Math.min(12, text.length / 16));

const PLAYER_ACTORS = new Set(['player', 'pierce', 'chair-head']);

const resolveLineDuration = (event: TimelineEvent) => {
  if (Number.isFinite(event.duration) && (event.duration ?? 0) > 0) return event.duration as number;
  return event.text ? lineDuration(event.text) : 3;
};

const fireEvent = (cutscene: ActiveCutscene, event: TimelineEvent) => {
  if (event.type === 'camera' && event.position && event.lookAt) {
    cutscene.hooks.onCamera(event.position, event.lookAt);
    return;
  }
  if (event.type === 'hud') {
    cutscene.hooks.onHud(event.title, event.text);
    return;
  }
  if (event.type === 'audio' && event.clip) {
    playFile(cutscene, event.clip, event.volume ?? 0.8, event.loop === true);
    return;
  }
  if (event.type === 'anim' && event.actor && event.clip) {
    cutscene.hooks.onAnim(event.actor, event.clip, event.loop !== false);
    return;
  }
  if (event.type === 'line') {
    const speaker = event.speaker ?? event.actor ?? 'Board';
    const hold = resolveLineDuration(event);
    cutscene.hooks.onHud(speaker, event.text);
    if (event.actor) {
      const clip = event.anim ?? 'talk';
      const seatedTalk = clip === 'talk' || clip === 'sit';
      if (seatedTalk) cutscene.hooks.onAnim('*', 'sit', true);
      cutscene.hooks.onAnim(event.actor, clip, true);
      cutscene.lineHold = {
        until: cutscene.time + hold,
        actor: event.actor,
        restClip: seatedTalk ? 'sit' : clip,
      };
    }
    if (event.audio) {
      playFile(cutscene, event.audio, event.volume ?? 0.85, false, hold);
    } else if (event.text) {
      playVoiceStub(cutscene, hold, speakerPitch(speaker));
    }
  }
};

const flushDueEvents = (cutscene: ActiveCutscene) => {
  const { events } = cutscene.timeline;
  while (cutscene.cursor < events.length && events[cutscene.cursor].at <= cutscene.time + 0.0001) {
    const event = events[cutscene.cursor];
    cutscene.cursor += 1;
    if (event.type === 'end') {
      cutscene.time = cutscene.duration;
      return;
    }
    fireEvent(cutscene, event);
  }
};

export const startCutscene = async (id: string, hooks: CutsceneHooks): Promise<ActiveCutscene | null> => {
  const timeline = await loadCutsceneTimeline(id);
  if (!timeline) return null;
  const cutscene: ActiveCutscene = {
    id: timeline.id,
    timeline,
    time: 0,
    duration: Math.max(0.5, timeline.duration ?? 0),
    cursor: 0,
    playing: [],
    hooks,
    lineHold: null,
  };
  flushDueEvents(cutscene);
  return cutscene;
};

export const stepCutscene = (cutscene: ActiveCutscene, delta: number): boolean => {
  cutscene.time += delta;
  flushDueEvents(cutscene);
  if (cutscene.lineHold && cutscene.time >= cutscene.lineHold.until) {
    cutscene.hooks.onAnim(cutscene.lineHold.actor, cutscene.lineHold.restClip, true);
    cutscene.lineHold = null;
  }
  if (cutscene.time >= cutscene.duration) {
    stopAudio(cutscene);
    return false;
  }
  return true;
};

export const stopCutsceneAudio = (cutscene: ActiveCutscene | null) => {
  if (cutscene) stopAudio(cutscene);
};

type AnimAvatar = { playClip: (clip: string, loop?: boolean) => boolean };

const playWithFallback = (avatar: AnimAvatar, clip: string, loop: boolean) => {
  if (avatar.playClip(clip, loop)) return;
  if (clip === 'walk' && avatar.playClip('idle', true)) return;
  if (clip !== 'sit' && clip !== 'idle' && clip !== 'walk' && avatar.playClip('sit', true)) return;
  if (clip !== 'idle') avatar.playClip('idle', true);
};

export const applyNpcAnim = (
  npcs: Array<{ seatId: string; avatar: AnimAvatar }>,
  actor: string,
  clip: string,
  loop: boolean,
  player?: AnimAvatar | null,
) => {
  if (actor === '*') {
    npcs.forEach((npc) => playWithFallback(npc.avatar, clip, loop));
    if (player) playWithFallback(player, clip, loop);
    return;
  }
  if (player && PLAYER_ACTORS.has(actor.toLowerCase())) {
    playWithFallback(player, clip, loop);
    return;
  }
  npcs.filter((npc) => npc.seatId === actor).forEach((npc) => playWithFallback(npc.avatar, clip, loop));
};
