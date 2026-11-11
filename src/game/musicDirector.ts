/**
 * Music director (docs/music.md). One score under the game, on the existing music bus (busInput 'music', so the
 * Settings Music slider and Sound off already govern it).
 *
 * Per chapter there are three looping stems (calm, tension, peak) that share key (D minor), tempo (72 bpm) and
 * length, start on the same audio-clock instant and run together all the time; a state is only a gain on each.
 * A change is scheduled on the audio clock at the next bar line (a rise to peak, or a stinger, takes the next
 * beat so the score answers inside a second). Voice lines duck the whole score 7 dB (150 ms attack, 600 ms
 * release). Everything is driven by game events: no timers, no polling. The only per-frame input is the
 * creature distance, and the director acts only when it crosses a band.
 *
 * Files are made in Hawkes Gen (locales/sfx.json group music). While a stem file is missing the director still
 * tracks state, ducks and logs, and the level's own bed keeps playing; the stems come in as soon as the files exist.
 */
import { busInput, getSharedAudioContext } from './audioUnlock';
import { decodeClip, forgetClip, setVoiceHook } from './sfxMix';
import { SPOKEN_TYPES, storyLines } from './locale';

export type MusicState = 'silence' | 'calm' | 'tension' | 'peak';
export type StingerId = 'vat-break' | 'mirror' | 'is-that-me' | 'no-stop' | 'tv-news';
export type MusicBand = 'far' | 'near' | 'close';

export const MUSIC_BPM = 72;
export const BEAT = 60 / MUSIC_BPM;
export const BAR = BEAT * 4;
export const DUCK_DB = -7;
export const DUCK_ATTACK = 0.15;
export const DUCK_RELEASE = 0.6;
/** Loop length in bars: 12 bars at 72 bpm is 40 s. */
export const LOOP_BARS = 12;
const STEMS: MusicState[] = ['calm', 'tension', 'peak'];
const STEM_LEVEL: Record<MusicState, Record<'calm' | 'tension' | 'peak', number>> = {
  silence: { calm: 0, tension: 0, peak: 0 },
  calm: { calm: 1, tension: 0, peak: 0 },
  tension: { calm: 0.55, tension: 1, peak: 0 },
  peak: { calm: 0.3, tension: 0.8, peak: 1 },
};
const MASTER = 0.8;
const FADE_UP = 1.4;
const FADE_DOWN = 2.2;

export const stemUrl = (chapter: number, stem: string) => `/assets/audio/music/ch${chapter}-${stem}.ogg`;
export const stingerUrl = (id: StingerId) => `/assets/audio/music/stinger-${id}.ogg`;
/** Beats that fire a stinger when their voice line starts (the line is the beat). */
const LINE_STINGERS: [RegExp, StingerId][] = [
  [/return-mirror\/01-pierce-thats-me/, 'mirror'],
  [/station-shadow\/01-pierce-is-that-me/, 'is-that-me'],
  [/cutscenes\/train\/06-/, 'no-stop'],
];

type Stem = { url: string; gain: GainNode; stop: () => void; ok: boolean };
type MusicEvent = { t: number; kind: string; detail: string };

export type MusicProbe = {
  chapter: number;
  state: MusicState;
  stems: number;
  streaming: boolean;
  duckDb: number;
  duckDepthDb: number;
  voices: number;
  changes: number;
  stateLog: { t: number; state: MusicState; reason: string }[];
  events: MusicEvent[];
  silenceSeconds: number;
};

export const createMusicDirector = () => {
  let chapter = 0;
  let base: MusicState = 'silence';
  let band: MusicBand | null = null;
  let chase: MusicBand | null = null;
  let powerOn = false;
  let inCutscene = false;
  let sceneThin: MusicState | null = null;
  let held = false;
  let changes = 0;
  let voices = 0;
  let deepestDuck = 0;
  const stateLog: MusicProbe['stateLog'] = [];
  const events: MusicEvent[] = [];
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;

  let ctx: AudioContext | undefined;
  let mix: GainNode | null = null;
  let duck: GainNode | null = null;
  let stems: Stem[] = [];
  let loopStart = 0;
  let streaming = false;
  let loadToken = 0;
  let state: MusicState = 'silence';
  let silentSince = now();
  const decoded = new Set<string>();

  const log = (kind: string, detail: string) => {
    events.push({ t: Math.round(now() * 100) / 100, kind, detail });
    if (events.length > 200) events.shift();
  };

  const ensure = (): boolean => {
    ctx = getSharedAudioContext();
    if (!ctx) return false;
    if (!mix) {
      mix = ctx.createGain();
      duck = ctx.createGain();
      mix.gain.value = MASTER;
      mix.connect(duck);
      duck.connect(busInput(ctx, 'music'));
    }
    return true;
  };

  /** Phone memory tier: stems stream from elements instead of all being decoded into memory. */
  const lowTier = () => document.body.dataset.memory === 'low';

  const nextBoundary = (unit: number) => {
    if (!ctx) return 0;
    const t = ctx.currentTime;
    if (!stems.length) return t;
    const into = Math.max(0, t - loopStart);
    return loopStart + Math.ceil(into / unit + 1e-6) * unit;
  };

  const target = (): MusicState => {
    if (sceneThin) return sceneThin;
    let next: MusicState = base;
    if (next === 'silence') return 'silence';
    const order: MusicState[] = ['calm', 'tension', 'peak'];
    const rank = (s: MusicState) => order.indexOf(s);
    const lift = (s: MusicState) => { if (rank(s) > rank(next)) next = s; };
    if (band === 'near') lift('tension');
    if (band === 'close') lift('peak');
    if (chase === 'near') lift('tension');
    if (chase === 'close') lift('peak');
    if (powerOn) lift('tension');
    return next;
  };

  const applyGains = (next: MusicState, rising: boolean) => {
    if (!ctx) return;
    const at = nextBoundary(rising ? BEAT : BAR);
    const span = next === 'silence' ? FADE_DOWN : rising ? 0.6 : FADE_UP;
    for (const stem of stems) {
      const name = stem.url.match(/-(calm|tension|peak)\.ogg/)?.[1] as 'calm' | 'tension' | 'peak';
      const level = STEM_LEVEL[next][name];
      stem.gain.gain.cancelScheduledValues(ctx.currentTime);
      stem.gain.gain.setValueAtTime(stem.gain.gain.value, ctx.currentTime);
      stem.gain.gain.setValueAtTime(stem.gain.gain.value, at);
      stem.gain.gain.linearRampToValueAtTime(level, at + span);
    }
  };

  const reconcile = (reason: string) => {
    const next = target();
    if (next === state) return;
    const order: MusicState[] = ['silence', 'calm', 'tension', 'peak'];
    const rising = order.indexOf(next) > order.indexOf(state);
    if (next === 'silence') silentSince = now();
    state = next;
    changes += 1;
    stateLog.push({ t: Math.round(now() * 100) / 100, state, reason });
    if (stateLog.length > 200) stateLog.shift();
    log('state', `${state} (${reason})`);
    applyGains(next, rising);
  };

  const unload = () => {
    loadToken += 1;
    for (const stem of stems) {
      stem.stop();
      try { stem.gain.disconnect(); } catch { /* gone */ }
      if (decoded.has(stem.url)) { forgetClip(stem.url); decoded.delete(stem.url); }
    }
    stems = [];
  };

  const addBufferStem = async (url: string, token: number, startAt: number) => {
    if (!ctx || !mix) return;
    const buffer = await decodeClip(url);
    if (token !== loadToken || !ctx || !mix) { forgetClip(url); return; }
    decoded.add(url);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(mix);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    // Late joiner: start inside the loop where the others already are, so the stems stay in phase.
    const offset = Math.max(0, ctx.currentTime - startAt) % buffer.duration;
    source.start(0, offset);
    stems.push({ url, gain, ok: true, stop: () => { try { source.stop(); } catch { /* not started */ } } });
  };

  const addStreamStem = (url: string, token: number) => {
    if (!ctx || !mix) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const element = new Audio();
      element.preload = 'auto';
      element.loop = true;
      element.crossOrigin = 'anonymous';
      element.setAttribute('playsinline', 'true');
      element.src = url;
      const done = () => resolve();
      element.addEventListener('error', done, { once: true });
      element.addEventListener('canplay', () => {
        if (token !== loadToken || !ctx || !mix) { element.removeAttribute('src'); done(); return; }
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(mix);
        const node = ctx.createMediaElementSource(element);
        node.connect(gain);
        void element.play().catch(() => {});
        stems.push({ url, gain, ok: true, stop: () => { element.pause(); element.removeAttribute('src'); try { node.disconnect(); } catch { /* gone */ } } });
        done();
      }, { once: true });
    });
  };

  const load = async (n: number) => {
    unload();
    if (!ensure() || !ctx) return;
    const token = loadToken;
    streaming = lowTier();
    loopStart = ctx.currentTime;
    // Calm first so the score is audible at once; the other two join in phase.
    for (const stem of STEMS.slice(0, 3)) {
      const url = stemUrl(n, stem);
      try {
        if (streaming) await addStreamStem(url, token);
        else await addBufferStem(url, token, loopStart);
      } catch {
        log('missing', url);
      }
      if (token !== loadToken) return;
    }
    if (stems.length) {
      const wanted = target();
      for (const stem of stems) stem.gain.gain.value = 0;
      state = 'silence';
      reconcile('stems-ready');
      void wanted;
    }
  };

  const setDuck = () => {
    if (!ctx || !duck) return;
    const at = ctx.currentTime;
    const goal = voices > 0 ? Math.pow(10, DUCK_DB / 20) : 1;
    const db = voices > 0 ? DUCK_DB : 0;
    if (db < deepestDuck) deepestDuck = db;
    duck.gain.cancelScheduledValues(at);
    duck.gain.setValueAtTime(duck.gain.value, at);
    duck.gain.linearRampToValueAtTime(goal, at + (voices > 0 ? DUCK_ATTACK : DUCK_RELEASE));
    log('duck', voices > 0 ? `${DUCK_DB} dB` : '0 dB');
  };

  // ---- voice lines (sfxMix calls this for every clip it starts)
  let voiceUrls: Set<string> | null = null;
  const isVoice = (url: string) => {
    if (!voiceUrls) {
      voiceUrls = new Set();
      for (const row of storyLines()) if (SPOKEN_TYPES.has(row.type) && row.audio) voiceUrls.add(row.audio.split('?')[0]!);
    }
    return voiceUrls.has(url) || /\/audio\/cutscenes\/(?:[^/]+\/)*\d\d-[^/]+\.(?:ogg|wav|mp3)$/.test(url) || /\/audio\/phone\/[^/]+-[^/]+\.(?:ogg|wav)$/.test(url) && !/\/sfx\//.test(url);
  };
  setVoiceHook((url) => {
    for (const [pattern, id] of LINE_STINGERS) if (pattern.test(url)) api.stinger(id);
    if (!isVoice(url)) return null;
    voices += 1;
    if (voices === 1) setDuck();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      voices = Math.max(0, voices - 1);
      if (voices === 0) setDuck();
    };
  });

  const api = {
    /** A chapter starts (level begins): its stems load and the calm state comes up. */
    chapterStart(n: number, opening: MusicState = 'calm') {
      chapter = n;
      base = opening;
      band = null; chase = null; powerOn = false; inCutscene = false; sceneThin = null;
      state = 'silence';
      log('chapter', `start ${n}`);
      void load(n);
    },
    /** The chapter ends (End Level): the score falls away for the ending song. */
    chapterEnd() {
      base = 'silence';
      log('chapter', `end ${chapter}`);
      reconcile('chapter-end');
    },
    /** Back to the title or a card: nothing plays. */
    stop() {
      chapter = 0;
      base = 'silence';
      reconcile('stop');
      unload();
    },
    /** A story phase or objective moved. `state` sets the chapter's base level, and null keeps it. */
    objective(key: string, next: MusicState | null = null) {
      log('objective', key);
      if (next) { base = next; reconcile(`objective ${key}`); }
    },
    cutsceneStart(id: string, thin: MusicState | null = 'calm') {
      inCutscene = true;
      sceneThin = thin;
      log('cutscene', `start ${id}`);
      reconcile(`cutscene ${id}`);
    },
    cutsceneEnd(id: string) {
      inCutscene = false;
      sceneThin = null;
      log('cutscene', `end ${id}`);
      reconcile(`cutscene-end ${id}`);
    },
    /** The creature's distance in metres (null: no hunt). Acts only when a band is crossed. */
    creature(distance: number | null) {
      let next: MusicBand | null = null;
      if (distance !== null) {
        // Hysteresis: it has to retreat past the exit mark to fall back a band.
        const closeIn = band === 'close' ? 10.5 : 8;
        const nearIn = band === 'close' || band === 'near' ? 19 : 16;
        next = distance < closeIn ? 'close' : distance < nearIn ? 'near' : 'far';
      }
      if (next === band) return;
      band = next;
      log('creature', `${next ?? 'none'} at ${distance === null ? '-' : distance.toFixed(1)} m`);
      reconcile(`creature ${next ?? 'none'}`);
    },
    /** The old body's lead in metres on the train, the same bands as the creature. */
    pursuit(distance: number | null) {
      let next: MusicBand | null = null;
      if (distance !== null) next = distance < 3 ? 'close' : distance < (chase === null ? 8 : 10) ? 'near' : 'far';
      if (next === chase) return;
      chase = next;
      log('pursuit', next ?? 'none');
      reconcile(`pursuit ${next ?? 'none'}`);
    },
    /** Shadow mode on or off (a power in use lifts the score one step). */
    power(on: boolean) {
      if (on === powerOn) return;
      powerOn = on;
      log('power', on ? 'on' : 'off');
      reconcile(on ? 'power on' : 'power off');
    },
    /** A one-shot, on the next beat, through the same duck as the stems. `delay` is seconds from now. */
    stinger(id: StingerId, delay = 0) {
      if (!ensure() || !ctx || !duck) return;
      log('stinger', id);
      const url = stingerUrl(id);
      const c = ctx;
      const out = duck;
      decodeClip(url).then((buffer) => {
        const source = c.createBufferSource();
        source.buffer = buffer;
        const gain = c.createGain();
        gain.gain.value = 0.9;
        source.connect(gain);
        gain.connect(out);
        source.onended = () => { try { gain.disconnect(); } catch { /* gone */ } forgetClip(url); };
        source.start(c.currentTime + Math.max(0, delay));
      }).catch(() => { log('missing', url); });
    },
    /** Pause holds the score; resume brings it back. */
    hold(on: boolean) {
      if (held === on) return;
      held = on;
      if (ctx && mix) {
        mix.gain.cancelScheduledValues(ctx.currentTime);
        mix.gain.setValueAtTime(mix.gain.value, ctx.currentTime);
        mix.gain.linearRampToValueAtTime(on ? 0 : MASTER, ctx.currentTime + 0.25);
      }
      log('hold', on ? 'pause' : 'resume');
    },
    state: () => state,
    probe: (): MusicProbe => ({
      chapter,
      state,
      stems: stems.length,
      streaming,
      duckDb: voices > 0 ? DUCK_DB : 0,
      duckDepthDb: deepestDuck,
      voices,
      changes,
      stateLog: [...stateLog],
      events: [...events],
      silenceSeconds: state === 'silence' ? now() - silentSince : 0,
    }),
  };
  void inCutscene;
  return api;
};

export const music = createMusicDirector();
