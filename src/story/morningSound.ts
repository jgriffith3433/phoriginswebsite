/**
 * The Morning's own synthesized sound (no assets, no GPU): the TV broadcast (studio bed, an anchor-like murmur and an
 * opening sting) heard from the television's position, and the soft room-exit cue. These are stand-ins that play until
 * Hawkes Gen takes exist (`sfx.morning.tv-news-bed`, `dialogue` news lines: see locales/sfx.json, pending-gpu.txt).
 * Everything goes through the acoustic graph (`createSourceGraph`: panner, room reverb zone, occlusion, voice duck) and
 * the sfx bus, never straight to the destination, so Pause, Settings and the voice duck hold it like any other clip.
 */
import { createSourceGraph, type SourceHandle, type Vec3 } from '../game/acoustics';
import { busInput, getSharedAudioContext } from '../game/audioUnlock';

/** Playback levels, under the voice (Pierce and the anchor lines play at 0.85-0.92). */
export const TV_BED_LEVEL = 0.1;
export const ROOM_EXIT_LEVEL = 0.22;
export const VOICE_LEVEL = 0.92;

export type TvAudioState = {
  /** Cue id (the catalog id a Gen take will replace). */
  name: string;
  level: number;
  /** An audio node is connected and running right now. */
  playing: boolean;
  /** Live oscillator/noise sources. */
  nodes: number;
  startedAt: number;
  endedAt: number;
  at: Vec3 | null;
  cls: string;
  /** The anchor murmur is sounding (no real take for the line being read). */
  anchor: boolean;
};

export type TvBroadcast = {
  stop: (fadeSeconds?: number) => void;
  /** The anchor murmur on while no recorded line is being read. */
  setAnchor: (on: boolean) => void;
  state: () => TvAudioState;
};

export const TV_AUDIO_NAME = 'sfx.morning.tv-news-bed';

let last: TvAudioState = { name: TV_AUDIO_NAME, level: 0, playing: false, nodes: 0, startedAt: 0, endedAt: 0, at: null, cls: 'effect', anchor: false };

/** What the playtest reads, even after the broadcast is gone. */
export const tvAudioState = (): TvAudioState => ({ ...last });

const noiseBuffer = (ctx: AudioContext, seconds: number) => {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
};

/** The TV broadcast, from `at`. Null when no audio context exists yet (the scene goes on in silence, never stalls). */
export const startTvBroadcast = (at: Vec3): TvBroadcast | null => {
  const ctx = getSharedAudioContext();
  if (!ctx) return null;
  try {
    const world = { at, cls: 'effect' as const };
    let graph: SourceHandle | null = createSourceGraph(ctx, 'synth:' + TV_AUDIO_NAME, 'effect', world, busInput(ctx, 'sfx'));
    const master = ctx.createGain();
    master.gain.value = 0;
    // A small speaker: no lows, no air.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 240;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    master.connect(hp);
    hp.connect(lp);
    lp.connect(graph.input);
    const sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
    const now = ctx.currentTime;
    master.gain.linearRampToValueAtTime(TV_BED_LEVEL, now + 0.6);

    // Studio bed: a slow soft chord under everything, shifting every four seconds.
    const bed = ctx.createGain();
    bed.gain.value = 0.5;
    const bedLp = ctx.createBiquadFilter();
    bedLp.type = 'lowpass';
    bedLp.frequency.value = 1500;
    bed.connect(bedLp);
    bedLp.connect(master);
    const chords = [[220, 261.6, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 329.6]];
    const voices = [0, 1, 2].map((i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.value = chords[0][i];
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.5 : 0.35;
      osc.connect(g);
      g.connect(bed);
      osc.start();
      sources.push(osc);
      return osc;
    });
    let chord = 0;
    const chordTimer = window.setInterval(() => {
      chord = (chord + 1) % chords.length;
      const t = ctx.currentTime;
      voices.forEach((osc, i) => osc.frequency.setTargetAtTime(chords[chord][i], t, 0.4));
    }, 4000);

    // Opening sting: a bright stab and a low hit, over in under a second.
    const sting = ctx.createGain();
    sting.gain.setValueAtTime(0.0001, now);
    sting.gain.exponentialRampToValueAtTime(0.9, now + 0.03);
    sting.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    sting.connect(master);
    for (const f of [440, 554.4, 659.3]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.18;
      osc.connect(g);
      g.connect(sting);
      osc.start(now);
      osc.stop(now + 1.2);
    }

    // Anchor stand-in: voiced-sounding noise through two formants, chopped at a syllable rate with phrase gaps.
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, 2);
    noise.loop = true;
    sources.push(noise);
    const voice = ctx.createGain();
    voice.gain.value = 0;
    const syllable = ctx.createGain();
    syllable.gain.value = 0.5;
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 520;
    f1.Q.value = 3.5;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1700;
    f2.Q.value = 4.5;
    noise.connect(f1);
    noise.connect(f2);
    f1.connect(syllable);
    f2.connect(syllable);
    syllable.connect(voice);
    voice.connect(master);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.6;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.5;
    lfo.connect(lfoDepth);
    lfoDepth.connect(syllable.gain);
    const phrase = ctx.createOscillator();
    phrase.frequency.value = 0.37;
    const phraseDepth = ctx.createGain();
    phraseDepth.gain.value = 0.3;
    phrase.connect(phraseDepth);
    phraseDepth.connect(voice.gain);
    noise.start();
    lfo.start();
    phrase.start();
    sources.push(lfo, phrase);

    last = { name: TV_AUDIO_NAME, level: TV_BED_LEVEL, playing: true, nodes: sources.length, startedAt: performance.now(), endedAt: 0, at, cls: 'effect', anchor: false };
    let ended = false;
    const anchorGainOn = 0.7;
    return {
      setAnchor: (on) => {
        if (ended) return;
        voice.gain.setTargetAtTime(on ? anchorGainOn * 0.5 : 0, ctx.currentTime, 0.15);
        last = { ...last, anchor: on };
      },
      stop: (fadeSeconds = 0.5) => {
        if (ended) return;
        ended = true;
        window.clearInterval(chordTimer);
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setTargetAtTime(0, t, Math.max(0.05, fadeSeconds / 4));
        last = { ...last, playing: false, anchor: false, endedAt: performance.now() };
        window.setTimeout(() => {
          for (const s of sources) {
            try { s.stop(); } catch { /* already stopped */ }
          }
          try { master.disconnect(); } catch { /* gone */ }
          graph?.dispose();
          graph = null;
          last = { ...last, nodes: 0 };
        }, fadeSeconds * 1000 + 200);
      },
      state: () => ({ ...last }),
    };
  } catch {
    return null;
  }
};

/** What the playtest reads about the room-exit cue (the sound that plays when Pierce leaves the bed for the room). */
export const ROOM_EXIT_CUE = 'sfx.morning.room-exit';
export type RoomExitState = { cue: string; level: number; voiceLevel: number; plays: number; steps: number; at: Vec3 | null };
let roomExit: RoomExitState = { cue: ROOM_EXIT_CUE, level: ROOM_EXIT_LEVEL, voiceLevel: VOICE_LEVEL, plays: 0, steps: 0, at: null };
export const roomExitState = (): RoomExitState => ({ ...roomExit });
export const noteRoomExit = (at: Vec3, steps: number) => { roomExit = { ...roomExit, plays: roomExit.plays + 1, steps: roomExit.steps + steps, at }; };

/** A soft interior door: the latch, then a muffled wood swing. Synthesized, short, quiet. */
export const playSoftDoor = (at: Vec3, level = ROOM_EXIT_LEVEL): boolean => {
  const ctx = getSharedAudioContext();
  if (!ctx) return false;
  try {
    const graph = createSourceGraph(ctx, 'synth:' + ROOM_EXIT_CUE, 'effect', { at, cls: 'effect' }, busInput(ctx, 'sfx'));
    const out = ctx.createGain();
    out.gain.value = level;
    out.connect(graph.input);
    const t = ctx.currentTime;
    const click = ctx.createOscillator();
    click.type = 'square';
    click.frequency.value = 1900;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.exponentialRampToValueAtTime(0.35, t + 0.004);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    click.connect(cg);
    cg.connect(out);
    click.start(t);
    click.stop(t + 0.06);
    const swing = ctx.createBufferSource();
    swing.buffer = noiseBuffer(ctx, 0.6);
    const sl = ctx.createBiquadFilter();
    sl.type = 'lowpass';
    sl.frequency.value = 380;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t + 0.08);
    sg.gain.exponentialRampToValueAtTime(0.5, t + 0.25);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    swing.connect(sl);
    sl.connect(sg);
    sg.connect(out);
    swing.start(t + 0.08);
    swing.stop(t + 0.7);
    window.setTimeout(() => { try { out.disconnect(); } catch { /* gone */ } graph.dispose(); }, 900);
    return true;
  } catch {
    return false;
  }
};
