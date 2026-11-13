import { busInput, createUnlockedAudio, getSharedAudioContext, releaseUnlockedAudio } from './audioUnlock';
import { storyLine } from './locale';
import { isVoiceUrl, mixVolume, playClip, preloadClipsReady, type ClipHandle, type LoopHandle } from './sfxMix';

export type CutsceneVec3 = { x: number; y: number; z: number };

export type TimelineEvent = {
  at: number;
  type: 'camera' | 'hud' | 'audio' | 'line' | 'anim' | 'light' | 'end' | 'mesh' | 'objective' | 'avatar' | 'carry' | 'fade' | 'world';
  /** Fade black amount. 0 is clear, 1 is black. */
  to?: number;
  /**
   * `camera` only: position and lookAt are offsets from the player (x right, y up from the floor, z forward along
   * his facing), so an ending reads the same wherever the player stopped.
   */
  rel?: boolean;
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
  /** Story line id in locales/en.json. Speaker, text, and audio come from there. */
  line?: string;
  anim?: string;
  duration?: number;
  on?: boolean;
  intensity?: number;
  target?: string;
  /** Avatar swap (`avatar`) or carry id override. */
  assetId?: string;
};

export type CutsceneTimeline = {
  id: string;
  name?: string;
  duration?: number;
  notes?: string;
  /**
   * When the scene ends, put the sidearm or flashlight back if they were out
   * when it started. Omit the field to keep that. Set false to leave the hands empty.
   */
  reequip?: boolean;
  events: TimelineEvent[];
};

export type CutsceneHooks = {
  onCamera: (position: CutsceneVec3, lookAt: CutsceneVec3, rel?: boolean) => void;
  /** A `world` event: `target` names a change the level's script knows (tower floors, departure board, TV). */
  onWorld?: (target: string, to: number, seconds: number) => void;
  onHud: (title?: string, text?: string) => void;
  onAnim: (actor: string, clip: string, loop: boolean) => void;
  /** A spoken line started on this actor (faceTalk binds the mouth / gaze / gesture). */
  onSpeak?: (actor: string, url: string, holdSeconds: number) => void;
  onLight?: (on: boolean, intensity?: number, target?: string) => void;
  onMesh?: (target: string, enabled: boolean, position?: CutsceneVec3) => void;
  onObjective?: (title?: string, text?: string) => void;
  onAvatar?: (assetId: string) => void;
  onCarry?: (id: string, name: string, note?: string) => void;
  onFade?: (to: number, seconds: number) => void;
  audioEnabled: () => boolean;
};

export type ActiveCutscene = {
  id: string;
  timeline: CutsceneTimeline;
  time: number;
  duration: number;
  cursor: number;
  playing: ClipHandle[];
  /** The voice lines this scene started (the clock waits on them). */
  voices: ClipHandle[];
  /** Fallback elements when the browser has no Web Audio. */
  elements: HTMLAudioElement[];
  loops: LoopHandle[];
  /** Bumped when the scene stops, so a hum that finishes decoding does not start. */
  loopToken: number;
  hooks: CutsceneHooks;
  lineHold: { until: number; actor: string; restClip: string } | null;
  silent?: boolean;
  /** Seconds the clock has been held for a voice line still sounding (bounded by VOICE_HOLD_MAX). */
  voiceHeld?: number;
};

/** Longest the scene waits on one voice line (a clip that will not load must not freeze it). */
const VOICE_HOLD_MAX = 12;
/** Longest the scene waits for its clips to decode before it starts anyway. */
const PRELOAD_WAIT_MS = 4000;

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
    reequip: data.reequip !== false,
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
  cutscene.loopToken = (cutscene.loopToken ?? 0) + 1;
  (cutscene.loops ?? []).forEach((loop) => loop.stop());
  cutscene.loops = [];
  cutscene.playing.forEach((clip) => clip.stop());
  cutscene.playing.length = 0;
  cutscene.voices.length = 0;
  cutscene.elements.forEach((element) => releaseUnlockedAudio(element));
  cutscene.elements.length = 0;
};

/** No Web Audio in this browser: a pooled element, handed back when the scene stops. */
const playElement = (cutscene: ActiveCutscene, url: string, level: number, loop: boolean, stubSeconds: number) => {
  const element = createUnlockedAudio(url);
  element.loop = loop;
  element.volume = level;
  cutscene.elements.push(element);
  const token = cutscene.loopToken;
  const failed = () => {
    element.removeEventListener('error', failed);
    if (token !== cutscene.loopToken || loop) return;
    playVoiceStub(cutscene, stubSeconds, 168);
  };
  element.addEventListener('error', failed);
  void element.play().catch(failed);
};

const playFile = (cutscene: ActiveCutscene, url: string, volume: number, loop: boolean, stubSeconds = 1.6) => {
  if (!cutscene.hooks.audioEnabled() || !url) return;
  const level = mixVolume(url, volume);
  const token = cutscene.loopToken;
  // Web Audio plays a decoded buffer: on a phone it does not need a finger on the screen.
  const clip = playClip(url, level, {
    loop,
    onError: () => {
      if (token !== cutscene.loopToken || loop) return;
      playVoiceStub(cutscene, stubSeconds, 168);
    },
  });
  if (clip) {
    cutscene.playing.push(clip);
    if (!loop && isVoiceUrl(url)) cutscene.voices.push(clip);
    return;
  }
  playElement(cutscene, url, level, loop, stubSeconds);
};

/** Every clip the timeline will play, so lines start on cue instead of after a fetch. */
const timelineAudio = (timeline: CutsceneTimeline) => {
  const urls = new Set<string>();
  for (const event of timeline.events) {
    if (event.type === 'audio' && event.clip) urls.add(event.clip);
    if (event.type === 'line') {
      const audio = withCopy(event).audio;
      if (audio) urls.add(audio);
    }
  }
  return urls;
};

const playVoiceStub = (cutscene: ActiveCutscene, seconds: number, hz: number) => {
  if (!cutscene.hooks.audioEnabled()) return;
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = hz;
  gain.gain.value = 0.045;
  osc.connect(gain);
  gain.connect(busInput(ctx, 'sfx'));
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
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

const withCopy = (event: TimelineEvent): TimelineEvent => {
  if (!event.line) return event;
  const row = storyLine(event.line);
  if (!row) return event;
  if (event.type === 'line') {
    return {
      ...event,
      speaker: row.speaker || event.speaker,
      text: row.text,
      audio: row.audio || event.audio,
    };
  }
  return { ...event, title: row.speaker || event.title, text: row.text || event.text };
};

const fireEvent = (cutscene: ActiveCutscene, event: TimelineEvent) => {
  event = withCopy(event);
  if (cutscene.silent && (event.type === 'audio' || event.type === 'line' || event.type === 'hud' || event.type === 'camera')) return;
  if (cutscene.silent && event.type === 'fade' && (event.to ?? 1) > 0.2) return;
  if (event.type === 'camera' && event.position && event.lookAt) {
    cutscene.hooks.onCamera(event.position, event.lookAt, event.rel === true);
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
  if (event.type === 'light') {
    cutscene.hooks.onLight?.(event.on !== false, event.intensity, event.target);
    return;
  }
  if (event.type === 'mesh' && event.target) {
    cutscene.hooks.onMesh?.(event.target, event.on !== false, event.position);
    return;
  }
  if (event.type === 'objective') {
    cutscene.hooks.onObjective?.(event.title, event.text);
    return;
  }
  if (event.type === 'avatar') {
    const assetId = event.assetId ?? event.target;
    if (assetId) cutscene.hooks.onAvatar?.(assetId);
    return;
  }
  if (event.type === 'carry') {
    cutscene.hooks.onCarry?.(event.target ?? event.assetId ?? 'item', event.title ?? 'Item', event.text);
    return;
  }
  if (event.type === 'world' && event.target) {
    cutscene.hooks.onWorld?.(event.target, event.to ?? 1, event.duration ?? 0);
    return;
  }
  if (event.type === 'fade') {
    cutscene.hooks.onFade?.(event.to ?? 1, event.duration ?? 0.8);
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
      cutscene.hooks.onSpeak?.(event.actor, event.audio ?? event.line ?? '', hold);
    } else {
      cutscene.hooks.onSpeak?.(speaker, event.audio ?? event.line ?? event.text ?? '', hold);
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
    voices: [],
    elements: [],
    loops: [],
    loopToken: 0,
    hooks,
    lineHold: null,
  };
  // Every clip is fetched and decoded before the first beat, with a bounded wait; a straggler keeps loading.
  if (hooks.audioEnabled()) {
    await Promise.race([
      preloadClipsReady(timelineAudio(timeline), performance.now() + PRELOAD_WAIT_MS),
      new Promise((resolve) => setTimeout(resolve, PRELOAD_WAIT_MS + 500)),
    ]);
  }
  flushDueEvents(cutscene);
  return cutscene;
};

/** A voice line of this scene is still sounding (or waiting on its file). */
const voiceSounding = (cutscene: ActiveCutscene) => {
  cutscene.voices = cutscene.voices.filter((clip) => !clip.done());
  return cutscene.voices.length > 0;
};

export const stepCutscene = (cutscene: ActiveCutscene, delta: number): boolean => {
  let next = cutscene.time + delta;
  // A line is never cut by the next beat: the clock waits at the next spoken line (or the end) until the voice
  // before it has finished. The wait is bounded.
  if (!cutscene.silent && voiceSounding(cutscene) && (cutscene.voiceHeld ?? 0) < VOICE_HOLD_MAX) {
    const upcoming = cutscene.timeline.events.slice(cutscene.cursor).find((event) => (event.type === 'line' && (event.audio || event.line)) || event.type === 'end');
    const gate = upcoming ? Math.min(upcoming.at, cutscene.duration) : cutscene.duration;
    if (next >= gate) {
      next = Math.max(cutscene.time, gate - 0.0001);
      cutscene.voiceHeld = (cutscene.voiceHeld ?? 0) + delta;
    }
  } else if (!voiceSounding(cutscene)) {
    cutscene.voiceHeld = 0;
  }
  cutscene.time = next;
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

export const skipToEnd = (cutscene: ActiveCutscene) => {
  cutscene.silent = true;
  cutscene.time = cutscene.duration;
  flushDueEvents(cutscene);
  stopAudio(cutscene);
  // Full playback puts the speaker back on the rest clip when the line ends; Skip must end in the same pose.
  if (cutscene.lineHold) cutscene.hooks.onAnim(cutscene.lineHold.actor, cutscene.lineHold.restClip, true);
  cutscene.lineHold = null;
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
