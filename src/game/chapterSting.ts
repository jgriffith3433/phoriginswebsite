/**
 * Chapter stings (docs/story/chapters.md): a short synthesized cue per chapter in the score's D minor, 72 bpm, played as the
 * opening shot starts. No files: the oscillators run through `busInput(ctx, 'music')`, so Settings > Music and Sound off
 * govern it, and nothing can 404. Hawkes Gen takes can replace these later without touching the opening.
 */
import { busInput, getSharedAudioContext } from './audioUnlock';

/** A short sting in the score's key (D minor, 72 bpm), a different colour per chapter. */
export const playChapterSting = (n: number): boolean => {
  const ctx = getSharedAudioContext();
  if (!ctx || ctx.state === 'closed') return false;
  const out = busInput(ctx, 'music');
  const now = ctx.currentTime + 0.05;
  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.gain.exponentialRampToValueAtTime(0.5, now + 0.35);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 4.2);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = [0, 3200, 900, 1500, 1100, 2200, 1400, 800, 2600][n] ?? 2000;
  master.connect(lp);
  lp.connect(out);
  const D = 146.83;
  const note = (hz: number, at: number, len: number, type: OscillatorType, gain: number, detune = 0) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = hz;
    o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, now + at);
    g.gain.exponentialRampToValueAtTime(gain, now + at + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, now + at + len);
    o.connect(g);
    g.connect(master);
    o.start(now + at);
    o.stop(now + at + len + 0.05);
  };
  const tick = (at: number, gain: number) => {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    g.gain.value = gain;
    src.buffer = buffer;
    src.connect(g);
    g.connect(master);
    src.start(now + at);
  };
  switch (n) {
    case 1: // human: low piano-ish D, the fifth, the minor third on top
      note(D, 0, 3.6, 'triangle', 0.5); note(D * 1.5, 0.5, 3.0, 'triangle', 0.28); note(D * 2 * 1.189, 1.1, 2.6, 'sine', 0.2);
      break;
    case 2: // B3: sub, a metal second
      note(D / 4, 0, 4.0, 'sine', 0.7); note(D * 1.0595, 0.2, 3.4, 'sawtooth', 0.07); tick(1.4, 0.2); tick(2.8, 0.12);
      break;
    case 3: // the motif, detuned
      note(D, 0, 3.6, 'triangle', 0.45, -35); note(D * 1.5, 0.6, 3.0, 'triangle', 0.22, 28); note(D / 2, 0, 3.8, 'sine', 0.4);
      break;
    case 4: // one note, alone
      note(D * 1.5, 0.0, 4.0, 'sine', 0.4); note(D * 1.5 * 1.0595, 1.4, 2.6, 'sine', 0.1);
      break;
    case 5: // street: a soft kick pulse and a pad
      for (let i = 0; i < 4; i += 1) note(55, i * 0.83, 0.5, 'sine', 0.55);
      note(D, 0, 3.8, 'triangle', 0.25); note(D * 1.189, 0.83, 3.0, 'triangle', 0.16);
      break;
    case 6: // rail percussion over a drone
      for (let i = 0; i < 5; i += 1) tick(i * 0.83, 0.28);
      note(D / 2, 0, 4.0, 'sawtooth', 0.12);
      break;
    case 7: // the train: rumble and an open fifth
      for (let i = 0; i < 6; i += 1) tick(i * 0.66, 0.22);
      note(D / 2, 0, 4.0, 'triangle', 0.35); note(D * 0.75, 0.3, 3.6, 'triangle', 0.2);
      break;
    default: // morning: almost nothing
      note(D * 4, 0.3, 3.4, 'sine', 0.12); note(D * 4 * 1.5, 1.4, 2.4, 'sine', 0.05);
  }
  return true;
};
