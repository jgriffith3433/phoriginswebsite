/**
 * Spatial and acoustic audio (no assets, no GPU): the master chain (limiter, loudness leveller), one shared
 * ConvolverNode per room type with procedural impulse responses, per-source panning (HRTF on desktop, equal-power
 * on the low tier), distance rolloff by sound class, ray occlusion (low-pass and -6 dB), the phone band, and the
 * voice ducking of effects and beds. sfxMix.playClip builds each clip's graph here; main.ts feeds the listener,
 * the zone data of the loaded scene and the occlusion ray.
 *
 * Coordinates: Babylon is left-handed (+z forward). Web Audio is right-handed (-z forward), so z is negated.
 */
import { busLevel, onSoundSettings } from './soundSettings';

export type ReverbType =
  | 'hall' | 'boardroom' | 'lobby' | 'elevator' | 'tunnel' | 'vat' | 'street' | 'station' | 'train' | 'apartment' | 'dry';

export const REVERB_TYPES: ReverbType[] = ['hall', 'boardroom', 'lobby', 'elevator', 'tunnel', 'vat', 'street', 'station', 'train', 'apartment'];

/** A zone marked in the level's scene data (`acousticZones`). Higher priority wins where they overlap. */
export type AcousticZone = {
  id: string;
  type: ReverbType;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  priority?: number;
};

export type SoundClass = 'voice' | 'step' | 'machinery' | 'ambience' | 'effect';

export type Vec3 = { x: number; y: number; z: number };
export type WorldOptions = {
  /** Where it sounds from. A function is read about ten times a second (a walker, a car). Omit for a local sound. */
  at?: Vec3 | (() => Vec3);
  cls?: SoundClass;
  /** Skip the room reverb (a clip that is already wet or a UI sound). */
  dry?: boolean;
};

type ReverbSpec = {
  /** Seconds to fall 60 dB. */
  rt60: number;
  /** Seconds before the tail starts. */
  pre: number;
  /** High-frequency damping, Hz at the start of the tail (it darkens as it decays). */
  damp: number;
  /** Zone return level. */
  wet: number;
  /** Discrete early taps (seconds, gain): slapback off buildings, flutter in a metal box. */
  taps: [number, number][];
  /** 0..1 how dense the noise is (sparse tails sound like open air). */
  density: number;
};

const SPECS: Record<Exclude<ReverbType, 'dry'>, ReverbSpec> = {
  // Carpet, plaster, acoustic ceiling: short and soft.
  hall: { rt60: 0.85, pre: 0.012, damp: 5200, wet: 0.22, taps: [[0.011, 0.5], [0.019, 0.35]], density: 1 },
  // Walnut slats, glass wall, big table: a bit longer, warm.
  boardroom: { rt60: 1.25, pre: 0.02, damp: 4300, wet: 0.26, taps: [[0.016, 0.5], [0.027, 0.4], [0.041, 0.25]], density: 1 },
  // Marble and glass atrium: tall, bright, long.
  lobby: { rt60: 3.1, pre: 0.045, damp: 7000, wet: 0.34, taps: [[0.032, 0.5], [0.058, 0.4], [0.09, 0.3]], density: 1 },
  // Steel cab: tiny, dead, metallic ring.
  elevator: { rt60: 0.3, pre: 0.003, damp: 3200, wet: 0.16, taps: [[0.0031, 0.7], [0.0062, 0.5], [0.0093, 0.4], [0.0124, 0.3]], density: 1 },
  // Poured concrete, long pipe halls: dark and ringing.
  tunnel: { rt60: 2.3, pre: 0.03, damp: 3400, wet: 0.32, taps: [[0.05, 0.4], [0.11, 0.3]], density: 1 },
  // Glass, tile and a drained vat: big, hard, dark tail.
  vat: { rt60: 3.7, pre: 0.05, damp: 2800, wet: 0.36, taps: [[0.04, 0.5], [0.075, 0.45], [0.13, 0.3]], density: 1 },
  // Open air with building slapback: sparse, two echoes, little tail.
  street: { rt60: 1.4, pre: 0.06, damp: 4000, wet: 0.2, taps: [[0.12, 0.55], [0.21, 0.35], [0.33, 0.2]], density: 0.22 },
  // Tile and concrete platform: very long tail.
  station: { rt60: 4.2, pre: 0.05, damp: 5000, wet: 0.36, taps: [[0.07, 0.4], [0.14, 0.35]], density: 1 },
  // A small metal tube with windows.
  train: { rt60: 0.42, pre: 0.003, damp: 7500, wet: 0.2, taps: [[0.0042, 0.6], [0.0087, 0.5], [0.013, 0.35], [0.019, 0.25]], density: 1 },
  // A furnished room: soft, short.
  apartment: { rt60: 0.5, pre: 0.008, damp: 3600, wet: 0.14, taps: [[0.009, 0.4], [0.017, 0.25]], density: 1 },
};

/** Per sound class: panner rolloff (metres) and how much of it goes to the room. */
const CLASS_RULES: Record<SoundClass, { ref: number; rolloff: number; max: number; send: number }> = {
  voice: { ref: 2, rolloff: 0.7, max: 45, send: 0.7 },
  step: { ref: 1.5, rolloff: 1.8, max: 30, send: 0.55 },
  machinery: { ref: 3, rolloff: 1.0, max: 70, send: 0.8 },
  ambience: { ref: 4, rolloff: 0.8, max: 90, send: 0.5 },
  effect: { ref: 2, rolloff: 1.2, max: 55, send: 0.6 },
};

const CROSSFADE = 0.5;
const OCCLUDED_CUTOFF = 1100;
const OPEN_CUTOFF = 20000;
const OCCLUDED_DB = -6;
/** HRTF is dear: past this many live panners the rest are equal-power. */
const MAX_HRTF = 8;
const DUCK_FX_DB = -4;
const DUCK_BED_DB = -8;
export const TARGET_LUFS = -16;

const dbToGain = (db: number) => Math.pow(10, db / 20);

// ---------------------------------------------------------------- impulse responses

const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const impulseCache = new Map<string, AudioBuffer>();

/** Shaped, decaying noise: darker as it fades, with the room's early taps in front. Deterministic per type. */
export const buildImpulse = (ctx: BaseAudioContext, type: Exclude<ReverbType, 'dry'>, low: boolean): AudioBuffer => {
  const key = `${type}:${low ? 'l' : 'h'}`;
  const known = impulseCache.get(key);
  if (known && known.sampleRate === (low ? 22050 : ctx.sampleRate)) return known;
  const spec = SPECS[type];
  const rate = low ? 22050 : ctx.sampleRate;
  const seconds = spec.rt60 * (low ? 0.75 : 1) + spec.pre;
  const length = Math.max(64, Math.floor(seconds * rate));
  const channels = low ? 1 : 2;
  const buffer = ctx.createBuffer(channels, length, rate);
  const seedBase = REVERB_TYPES.indexOf(type) * 7919 + 17;
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    const rand = rng(seedBase + c * 101);
    const pre = Math.floor(spec.pre * rate);
    let lp = 0;
    for (let i = pre; i < length; i += 1) {
      const t = (i - pre) / rate;
      const env = Math.exp((-6.9078 * t) / spec.rt60);
      // Sparse noise (street) is mostly silence with random clicks; dense noise is a full wash.
      let n = rand() * 2 - 1;
      if (spec.density < 1 && rand() > spec.density) n = 0;
      // One-pole low-pass whose cutoff falls from `damp` to about 35% of it over the tail.
      const cutoff = spec.damp * (1 - 0.65 * Math.min(1, t / spec.rt60));
      const a = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
      lp += a * (n - lp);
      data[i] = lp * env;
    }
    for (const [at, gain] of spec.taps) {
      // A slightly different tap time per ear widens the room.
      const idx = Math.floor((at + c * 0.0013) * rate);
      if (idx < length) data[idx] += gain * (c % 2 === 0 ? 1 : -0.9);
    }
  }
  impulseCache.set(key, buffer);
  return buffer;
};

// ---------------------------------------------------------------- the rig

type ZoneNode = { conv: ConvolverNode; gain: GainNode; wet: number };

type Rig = {
  ctx: AudioContext;
  trim: GainNode;
  limiter: DynamicsCompressorNode;
  ceiling: GainNode;
  analyser: AnalyserNode;
  analyserL: AnalyserNode;
  analyserR: AnalyserNode;
  fxEntry: GainNode;
  bedEntry: GainNode;
  bedWired: boolean;
  voiceBus: GainNode;
  send: GainNode;
  zones: Map<ReverbType, ZoneNode>;
};

let rig: Rig | null = null;
let lowTier = false;

const makeRig = (ctx: AudioContext): Rig => {
  const trim = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  const ceiling = ctx.createGain();
  ceiling.gain.value = dbToGain(-1.2);
  trim.connect(limiter);
  limiter.connect(ceiling);
  ceiling.connect(ctx.destination);

  // Measurement branch: K-weighting (high-pass 38 Hz, +4 dB shelf at 1.5 kHz) into an analyser.
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 38;
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 1500;
  shelf.gain.value = 4;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  ceiling.connect(hp);
  hp.connect(shelf);
  shelf.connect(analyser);
  const split = ctx.createChannelSplitter(2);
  const analyserL = ctx.createAnalyser();
  const analyserR = ctx.createAnalyser();
  analyserL.fftSize = 1024;
  analyserR.fftSize = 1024;
  ceiling.connect(split);
  split.connect(analyserL, 0);
  split.connect(analyserR, 1);

  // Effects duck under a voice (-4 dB); the effects bus enters here. Beds duck -8 dB.
  const fxEntry = ctx.createGain();
  fxEntry.connect(trim);
  const bedEntry = ctx.createGain();
  // Voices skip the effect duck but still follow the Effects slider.
  const voiceBus = ctx.createGain();
  voiceBus.gain.value = busLevel('sfx');
  voiceBus.connect(trim);
  // Reverb returns come back through the effects slider too, and are not ducked by the voice they dress.
  const send = ctx.createGain();
  send.gain.value = 1;
  return { ctx, trim, limiter, ceiling, analyser, analyserL, analyserR, fxEntry, bedEntry, bedWired: false, voiceBus, send, zones: new Map() };
};

export const getRig = (ctx: AudioContext): Rig => {
  if (!rig || rig.ctx !== ctx) rig = makeRig(ctx);
  return rig;
};

/** Where a bus node plugs in: everything ends at the master chain. */
export const masterInput = (ctx: AudioContext): AudioNode => getRig(ctx).trim;
export const busEntry = (ctx: AudioContext, bus: 'music' | 'sfx'): AudioNode => (bus === 'sfx' ? getRig(ctx).fxEntry : getRig(ctx).trim);

onSoundSettings(() => {
  if (rig) rig.voiceBus.gain.value = busLevel('sfx');
});

export const configureTier = (low: boolean) => {
  if (low === lowTier) return;
  lowTier = low;
  // Zones already built get the other tier's impulse (shorter, mono, 22 kHz on the low tier).
  if (rig) for (const [type, node] of rig.zones) node.conv.buffer = buildImpulse(rig.ctx, type as Exclude<ReverbType, 'dry'>, low);
};

// ---------------------------------------------------------------- reverb zones

let zones: AcousticZone[] = [];
let defaultType: ReverbType = 'dry';
let currentType: ReverbType = 'dry';
let currentZoneId = '';
const visited = new Set<ReverbType>();
const zoneLog: { t: number; zone: string; type: ReverbType }[] = [];

const ensureZoneNode = (r: Rig, type: ReverbType): ZoneNode | null => {
  if (type === 'dry') return null;
  let node = r.zones.get(type);
  if (node) return node;
  const conv = r.ctx.createConvolver();
  conv.normalize = true;
  conv.buffer = buildImpulse(r.ctx, type, lowTier);
  const gain = r.ctx.createGain();
  gain.gain.value = 0;
  conv.connect(gain);
  // The return joins the effects bus level but not the duck.
  gain.connect(r.voiceBus);
  node = { conv, gain, wet: SPECS[type].wet };
  r.zones.set(type, node);
  return node;
};

/** Level data: zones and the type used outside them. Impulses for these types are built now, off the walk. */
export const setZones = (next: AcousticZone[] | undefined, fallback: ReverbType | undefined) => {
  zones = [...(next ?? [])].filter((z) => REVERB_TYPES.includes(z.type));
  defaultType = fallback && (REVERB_TYPES as string[]).includes(fallback) ? fallback : 'dry';
  const c = rig?.ctx;
  if (c) {
    const types = new Set<ReverbType>([defaultType, ...zones.map((z) => z.type)]);
    for (const t of types) ensureZoneNode(rig!, t);
  }
  currentZoneId = '';
  currentType = 'dry';
};

export const zoneAt = (x: number, z: number): { id: string; type: ReverbType } => {
  let best: AcousticZone | null = null;
  for (const zone of zones) {
    if (x < zone.minX || x > zone.maxX || z < zone.minZ || z > zone.maxZ) continue;
    if (!best || (zone.priority ?? 0) >= (best.priority ?? 0)) best = zone;
  }
  return best ? { id: best.id, type: best.type } : { id: 'default', type: defaultType };
};

const fadeTimers = new Map<ReverbType, ReturnType<typeof setTimeout>>();

const switchZone = (r: Rig, type: ReverbType, id: string) => {
  currentZoneId = id;
  if (type === currentType) return;
  const now = r.ctx.currentTime;
  const prev = currentType;
  currentType = type;
  if (type !== 'dry') visited.add(type);
  zoneLog.push({ t: performance.now() / 1000, zone: id, type });
  if (zoneLog.length > 80) zoneLog.shift();
  // Crossfade: old return down, new return up, over 0.5 s.
  const next = ensureZoneNode(r, type);
  if (next) {
    try { r.send.connect(next.conv); } catch { /* already */ }
    const pending = fadeTimers.get(type);
    if (pending) clearTimeout(pending);
    next.gain.gain.cancelScheduledValues(now);
    next.gain.gain.setValueAtTime(next.gain.gain.value, now);
    next.gain.gain.linearRampToValueAtTime(next.wet, now + CROSSFADE);
  }
  const old = prev === 'dry' ? null : r.zones.get(prev);
  if (old) {
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setValueAtTime(old.gain.gain.value, now);
    old.gain.gain.linearRampToValueAtTime(0, now + CROSSFADE);
    // Stop feeding it once it has faded, so only the active room convolves.
    fadeTimers.set(prev, setTimeout(() => {
      fadeTimers.delete(prev);
      if (currentType !== prev) { try { r.send.disconnect(old.conv); } catch { /* gone */ } }
    }, CROSSFADE * 1000 + 80));
  }
};

// ---------------------------------------------------------------- per-source graph

type OcclusionRay = (from: Vec3, to: Vec3) => boolean;
let occlusionRay: OcclusionRay | null = null;
export const setOcclusionRay = (fn: OcclusionRay | null) => { occlusionRay = fn; };

type Source = {
  url: string;
  cls: SoundClass;
  panner: PannerNode | null;
  lowpass: BiquadFilterNode | null;
  occGain: GainNode | null;
  send: GainNode | null;
  at: (() => Vec3) | null;
  occluded: boolean;
  /** ctx time the source was let through (cleared), until its cutoff is back above 10 kHz. */
  openedAt: number;
  dirty: boolean;
  dist: number;
  hrtf: boolean;
  nodes: AudioNode[];
};
const sources = new Set<Source>();

const setPos = (target: { positionX?: AudioParam; setPosition?: (x: number, y: number, z: number) => void }, x: number, y: number, z: number) => {
  if (target.positionX) {
    target.positionX.value = x;
    (target as unknown as PannerNode).positionY.value = y;
    (target as unknown as PannerNode).positionZ.value = z;
  } else target.setPosition?.(x, y, z);
};

export type SourceHandle = { input: AudioNode; dispose: () => void };

export const isPhoneUrl = (url: string) => /\/audio\/phone\/[^/]+-[^/]+\.(?:ogg|wav|mp3)$/.test(url.split('?')[0]!) && !/\/sfx\//.test(url);

/**
 * Builds what stands between a clip's gain and the output. `kind`: 'voice' (a spoken line: not ducked, dressed by
 * the room), 'phone' (dry, band-passed to a handset), 'bed' (music bed, ducks 8 dB), 'effect' (everything else).
 */
export const createSourceGraph = (
  ctx: AudioContext,
  url: string,
  kind: 'voice' | 'phone' | 'bed' | 'effect',
  world: WorldOptions | undefined,
  /** Where a plain effect with no world options goes (the sfx bus node). */
  plainOut: AudioNode,
): SourceHandle => {
  const r = getRig(ctx);
  const input = ctx.createGain();
  const nodes: AudioNode[] = [input];
  const out = kind === 'voice' || kind === 'phone' ? r.voiceBus : plainOut;

  if (kind === 'phone') {
    // A handset: 300 Hz to 3.4 kHz, no room.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 300;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3400;
    input.connect(hp);
    hp.connect(lp);
    lp.connect(out);
    nodes.push(hp, lp);
    return { input, dispose: () => { for (const n of nodes) { try { n.disconnect(); } catch { /* gone */ } } } };
  }
  if (kind === 'bed') {
    if (!r.bedWired) { r.bedEntry.connect(plainOut); r.bedWired = true; }
    input.connect(r.bedEntry);
    return { input, dispose: () => { try { input.disconnect(); } catch { /* gone */ } } };
  }
  if (kind === 'effect' && !world) {
    input.connect(out);
    return { input, dispose: () => { try { input.disconnect(); } catch { /* gone */ } } };
  }

  const cls: SoundClass = world?.cls ?? (kind === 'voice' ? 'voice' : 'effect');
  const rule = CLASS_RULES[cls];
  const src: Source = { url, cls, panner: null, lowpass: null, occGain: null, send: null, at: null, occluded: false, openedAt: -1, dirty: true, dist: 0, hrtf: false, nodes };
  let tail: AudioNode = input;
  const at = world?.at;
  if (at) {
    const panner = ctx.createPanner();
    let hrtf = !lowTier;
    if (hrtf) {
      let live = 0;
      for (const s of sources) if (s.hrtf) live += 1;
      if (live >= MAX_HRTF) hrtf = false;
    }
    panner.panningModel = hrtf ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = rule.ref;
    panner.rolloffFactor = rule.rolloff;
    panner.maxDistance = rule.max;
    panner.coneInnerAngle = 360;
    const first = typeof at === 'function' ? at() : at;
    setPos(panner, first.x, first.y, -first.z);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = OPEN_CUTOFF;
    lowpass.Q.value = 0.5;
    const occGain = ctx.createGain();
    input.connect(panner);
    panner.connect(lowpass);
    lowpass.connect(occGain);
    tail = occGain;
    src.panner = panner;
    src.lowpass = lowpass;
    src.occGain = occGain;
    src.hrtf = hrtf;
    src.at = typeof at === 'function' ? at : () => at;
    nodes.push(panner, lowpass, occGain);
  }
  tail.connect(out);
  if (!world?.dry) {
    const send = ctx.createGain();
    send.gain.value = rule.send;
    tail.connect(send);
    send.connect(r.send);
    src.send = send;
    nodes.push(send);
  }
  sources.add(src);
  return {
    input,
    dispose: () => {
      sources.delete(src);
      for (const n of nodes) { try { n.disconnect(); } catch { /* gone */ } }
    },
  };
};

// ---------------------------------------------------------------- listener, ducking, loudness

let listener: { pos: Vec3; fwd: Vec3 } = { pos: { x: 0, y: 1.6, z: 0 }, fwd: { x: 0, y: 0, z: 1 } };
let player = { x: 0, z: 0 };

export const setListener = (ctx: AudioContext, pos: Vec3, forward: Vec3, playerXZ: { x: number; z: number }) => {
  listener = { pos, fwd: forward };
  player = playerXZ;
  const l = ctx.listener as AudioListener & { positionX?: AudioParam; forwardX?: AudioParam; setPosition?: (x: number, y: number, z: number) => void; setOrientation?: (...n: number[]) => void };
  if (l.positionX && l.forwardX) {
    const now = ctx.currentTime;
    l.positionX.setValueAtTime(pos.x, now);
    l.positionY.setValueAtTime(pos.y, now);
    l.positionZ.setValueAtTime(-pos.z, now);
    l.forwardX.setValueAtTime(forward.x, now);
    l.forwardY.setValueAtTime(forward.y, now);
    l.forwardZ.setValueAtTime(-forward.z, now);
    l.upX.setValueAtTime(0, now);
    l.upY.setValueAtTime(1, now);
    l.upZ.setValueAtTime(0, now);
  } else {
    l.setPosition?.(pos.x, pos.y, -pos.z);
    l.setOrientation?.(forward.x, forward.y, -forward.z, 0, 1, 0);
  }
};

let voiceOn = false;
/** A spoken line started or ended: effects duck 4 dB, beds 8 dB, with a short attack and a longer release. */
export const setVoiceActive = (on: boolean) => {
  if (voiceOn === on) return;
  voiceOn = on;
  if (!rig) return;
  const now = rig.ctx.currentTime;
  const t = on ? 0.12 : 0.6;
  rig.fxEntry.gain.cancelScheduledValues(now);
  rig.fxEntry.gain.setTargetAtTime(on ? dbToGain(DUCK_FX_DB) : 1, now, t / 3);
  rig.bedEntry.gain.cancelScheduledValues(now);
  rig.bedEntry.gain.setTargetAtTime(on ? dbToGain(DUCK_BED_DB) : 1, now, t / 3);
};

const blocks: number[] = [];
let shortTerm = -120;
let momentary: number[] = [];
let trimDb = 0;
let sampleClock = 0;
let blockClock = 0;
let blockSum = 0;
let blockN = 0;
let lastCtxTime = 0;
let lastWall = 0;
let lagMs = 0;
let dropouts = 0;
let wasRunning = false;
let silentSince = 0;
const buf = new Float32Array(new ArrayBuffer(2048 * 4));
const bufL = new Float32Array(new ArrayBuffer(1024 * 4));
const bufR = new Float32Array(new ArrayBuffer(1024 * 4));
const meanSquare = (a: AnalyserNode, into: Float32Array<ArrayBuffer>) => {
  a.getFloatTimeDomainData(into);
  let s = 0;
  for (let i = 0; i < into.length; i += 1) s += into[i]! * into[i]!;
  return s / into.length;
};

const integrated = () => {
  const abs = blocks.filter((b) => b > -70);
  if (!abs.length) return -120;
  const mean = (list: number[]) => 10 * Math.log10(list.reduce((s, b) => s + Math.pow(10, b / 10), 0) / list.length);
  const rel = mean(abs) - 10;
  const kept = abs.filter((b) => b > rel);
  return kept.length ? mean(kept) : -120;
};

let pauseHeld = false;
export const setAcousticsPaused = (paused: boolean) => { pauseHeld = paused; };

const scratchFrom = { x: 0, y: 0, z: 0 };
let tickWall = 0;
let occClock = 0;
/** The last time a source went from muffled to clear: the model's time to clear, and what was read back. */
let lastMuffleAt = -1;
const clearLog: { sinceMs: number; cutoffHz: number; url: string }[] = [];
let rr = 0;

/** Every 50 ms from a timer (main.ts), so the audio side keeps its own time when frames are slow. */
export const updateAcoustics = () => {
  if (!rig) return;
  const r = rig;
  const ctx = r.ctx;
  const wall = performance.now();
  const delta = tickWall > 0 ? Math.min(0.5, (wall - tickWall) / 1000) : 0.05;
  tickWall = wall;

  // Dropout watch: the audio clock must keep up with the wall clock while the context runs.
  if (ctx.state === 'running' && !pauseHeld && lastWall > 0 && wasRunning) {
    const wallDt = (wall - lastWall) / 1000;
    const ctxDt = ctx.currentTime - lastCtxTime;
    if (wallDt > 0.05 && wallDt < 1.5) {
      lagMs = Math.max(0, (wallDt - ctxDt) * 1000);
      if (lagMs > 120) silentSince += wallDt; else silentSince = 0;
      if (silentSince > 0.3) { dropouts += 1; silentSince = 0; }
    }
  }
  lastWall = wall;
  lastCtxTime = ctx.currentTime;
  wasRunning = ctx.state === 'running';

  // Room: the zone under the player.
  const z = zoneAt(player.x, player.z);
  if (z.id !== currentZoneId) switchZone(r, z.type, z.id);

  // Occlusion: a few rays per tick, round-robin, ten times a second (at once after a door moves).
  occClock += delta;
  let any = false;
  for (const s of sources) if (s.dirty && s.at) { any = true; break; }
  if (occClock >= 0.1 || any) {
    occClock = 0;
    const list = [...sources].filter((s) => s.at);
    const budget = Math.min(list.length, any ? 12 : 6);
    for (let k = 0; k < budget; k += 1) {
      const s = list[(rr + k) % list.length]!;
      const p = s.at!();
      if (s.panner) setPos(s.panner, p.x, p.y, -p.z);
      const d = Math.hypot(p.x - listener.pos.x, p.z - listener.pos.z);
      s.dist = d;
      let blocked = false;
      if (occlusionRay && d > 0.6) {
        scratchFrom.x = p.x; scratchFrom.y = Math.max(p.y, 1.2); scratchFrom.z = p.z;
        try { blocked = occlusionRay(scratchFrom, listener.pos); } catch { blocked = false; }
      }
      s.dirty = false;
      if (blocked !== s.occluded) {
        s.occluded = blocked;
        const now = ctx.currentTime;
        s.openedAt = blocked ? -1 : now;
        if (blocked) lastMuffleAt = now;
        s.lowpass?.frequency.cancelScheduledValues(now);
        s.lowpass?.frequency.setTargetAtTime(blocked ? OCCLUDED_CUTOFF : OPEN_CUTOFF, now, 0.07);
        s.occGain?.gain.cancelScheduledValues(now);
        s.occGain?.gain.setTargetAtTime(blocked ? dbToGain(OCCLUDED_DB) : 1, now, 0.07);
        // Behind a wall the room tail is the other room's, so thin the send too.
        s.send?.gain.cancelScheduledValues(now);
        s.send?.gain.setTargetAtTime(CLASS_RULES[s.cls].send * (blocked ? 0.5 : 1), now, 0.07);
      }
      if (s.send && !s.occluded) {
        const near = Math.min(1, d / 15);
        s.send.gain.setTargetAtTime(CLASS_RULES[s.cls].send * (0.45 + near * 0.9), ctx.currentTime, 0.2);
      }
    }
    rr += budget;
  }

  // Clear check: a source let through reports how long its filter took to open (audio clock).
  for (const s of sources) {
    if (s.openedAt >= 0 && s.lowpass && s.lowpass.frequency.value > 10000) {
      clearLog.push({ sinceMs: Math.round((ctx.currentTime - s.openedAt) * 1000), cutoffHz: Math.round(s.lowpass.frequency.value), url: s.url });
      if (clearLog.length > 20) clearLog.shift();
      s.openedAt = -1;
    }
  }

  // Loudness: K-weighted energy every 100 ms; 400 ms blocks feed the integrated figure; a slow leveller trims.
  sampleClock += delta;
  if (sampleClock >= 0.1) {
    const dt = sampleClock;
    sampleClock = 0;
    const ms = meanSquare(r.analyser, buf);
    blockSum += ms;
    blockN += 1;
    momentary.push(ms);
    if (momentary.length > 30) momentary.shift();
    const st = momentary.reduce((s, v) => s + v, 0) / momentary.length;
    shortTerm = st > 1e-12 ? -0.691 + 10 * Math.log10(st) : -120;
    blockClock += dt;
    if (blockClock >= 0.4 && blockN > 0) {
      const l = blockSum / blockN > 1e-12 ? -0.691 + 10 * Math.log10(blockSum / blockN) : -120;
      if (!pauseHeld) { blocks.push(l); if (blocks.length > 4500) blocks.shift(); }
      blockClock = 0; blockSum = 0; blockN = 0;
    }
    // Leveller: only while something sounds, slowly (0.35 dB/s), within +-6 dB, aiming at the target.
    if (shortTerm > -48 && !pauseHeld) {
      const error = TARGET_LUFS - shortTerm;
      const step = Math.max(-0.35 * dt, Math.min(0.35 * dt, error * 0.1 * dt));
      const next = Math.max(-6, Math.min(6, trimDb + step));
      if (next !== trimDb) {
        trimDb = next;
        r.trim.gain.setTargetAtTime(dbToGain(trimDb), ctx.currentTime, 0.4);
      }
    }
  }
};

/** A door or wall moved: re-test every source now. */
export const markOcclusionDirty = () => { for (const s of sources) s.dirty = true; };


/** Playtest: steady noise from a point, through the same graph as a world sound (position, room, occlusion). */
export const startTestSource = (ctx: AudioContext, at: Vec3, seconds: number, cls: SoundClass, label: string, level = 0.5): (() => void) => {
  const r = getRig(ctx);
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, Math.floor(rate * seconds), rate);
  const data = buffer.getChannelData(0);
  const rand = rng(5);
  // Speech-like: noise with a slow amplitude wobble, so a low-pass is audible as muffling.
  for (let i = 0; i < data.length; i += 1) data[i] = (rand() * 2 - 1) * (0.55 + 0.35 * Math.sin(i / rate * 9));
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = level;
  const graph = createSourceGraph(ctx, label, cls === 'voice' ? 'voice' : 'effect', { at, cls, dry: false }, r.fxEntry);
  source.connect(gain);
  gain.connect(graph.input);
  source.start();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { source.stop(); } catch { /* done */ }
    graph.dispose();
  };
  source.onended = stop;
  return stop;
};

/** Playtest: a noise burst placed `metres` to the listener's `side`, read back from the master's two channels. */
export const testPing = async (ctx: AudioContext, side: 'left' | 'right' | 'front', metres = 3): Promise<{ left: number; right: number; side: string }> => {
  const r = getRig(ctx);
  const f = listener.fwd;
  const len = Math.hypot(f.x, f.z) || 1;
  // Babylon is left-handed: facing +z, the listener's left is -x. Left of (fx, fz) is (-fz, fx) rotated the other way.
  // Facing (fx, fz) in the left-handed world, left is (-fz, fx): facing +z, left is -x.
  const leftX = -f.z / len;
  const leftZ = f.x / len;
  const sign = side === 'left' ? 1 : side === 'right' ? -1 : 0;
  const pos = side === 'front'
    ? { x: listener.pos.x + (f.x / len) * metres, y: listener.pos.y, z: listener.pos.z + (f.z / len) * metres }
    : { x: listener.pos.x + sign * leftX * metres, y: listener.pos.y, z: listener.pos.z + sign * leftZ * metres };
  const stop = startTestSource(ctx, pos, 0.8, 'effect', 'test-ping', 0.8);
  let left = 0;
  let right = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 600) {
    await new Promise((res) => setTimeout(res, 40));
    left = Math.max(left, Math.sqrt(meanSquare(r.analyserL, bufL)));
    right = Math.max(right, Math.sqrt(meanSquare(r.analyserR, bufR)));
  }
  stop();
  return { left, right, side };
};

/** What the playtest's sound() block reads. */
export const acousticsProbe = (ctx: AudioContext | undefined) => {
  const live = [...sources].filter((s) => s.at);
  const stats = (ctx as (AudioContext & { playoutStats?: { underrunEvents?: number } }) | undefined)?.playoutStats;
  return {
    zone: currentZoneId,
    type: currentType,
    zonesInLevel: [...new Set([defaultType, ...zones.map((z) => z.type)])].filter((t) => t !== 'dry'),
    visited: [...visited],
    log: zoneLog.slice(-20),
    panning: lowTier ? 'equalpower' : 'HRTF',
    tier: lowTier ? 'low' : 'high',
    convolvers: rig?.zones.size ?? 0,
    activeConvolvers: rig ? [...rig.zones.entries()].filter(([, n]) => n.gain.gain.value > 0.001).length : 0,
    sources: live.length,
    hrtfSources: live.filter((s) => s.hrtf).length,
    occlusion: live.slice(0, 12).map((s) => ({
      url: s.url,
      cls: s.cls,
      occluded: s.occluded,
      cutoffHz: Math.round(s.lowpass?.frequency.value ?? OPEN_CUTOFF),
      dist: Math.round(s.dist * 10) / 10,
      panning: s.panner?.panningModel ?? 'none',
    })),
    occludedCount: live.filter((s) => s.occluded).length,
    /** Muffled to clear transitions: ms of audio time until the low-pass was above 10 kHz (the filter's time constant is 70 ms). */
    clears: clearLog.slice(-8),
    clearModelMs: Math.round(-Math.log((20000 - 10000) / (20000 - OCCLUDED_CUTOFF)) * 70),
    lastMuffleAt,
    loudness: { shortTerm: Math.round(shortTerm * 10) / 10, integrated: Math.round(integrated() * 10) / 10, trimDb: Math.round(trimDb * 10) / 10, target: TARGET_LUFS, blocks: blocks.length },
    voiceDuck: voiceOn,
    dropouts,
    lagMs: Math.round(lagMs),
    underruns: stats?.underrunEvents ?? null,
    limiterReductionDb: rig ? Math.round(rig.limiter.reduction * 10) / 10 : 0,
  };
};

/** Test/diagnostic: clear the visited set and loudness history (a scenario starts a measure). */
export const resetAcousticsStats = () => {
  visited.clear();
  if (currentType !== 'dry') visited.add(currentType);
  blocks.length = 0;
  dropouts = 0;
  zoneLog.length = 0;
};

export const ensureRig = (ctx: AudioContext) => {
  const r = getRig(ctx);
  const types = new Set<ReverbType>([defaultType, ...zones.map((z) => z.type)]);
  for (const t of types) ensureZoneNode(r, t);
};
