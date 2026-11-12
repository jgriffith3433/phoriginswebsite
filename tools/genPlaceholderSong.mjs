// node tools/genPlaceholderSong.mjs /tmp/song.wav, then: ffmpeg -i /tmp/song.wav -ac 1 -ar 22050 -b:a 64k song.mp3  (the repo-root song.mp3 is this stand-in).
// Placeholder song: 112 BPM A-minor groove, 240 s mono. A stand-in until the real song.mp3 is uploaded.
import fs from 'node:fs';
const SR = 22050, BPM = 112, beat = 60 / BPM, DUR = 240, n = SR * DUR;
const out = new Float32Array(n);
let seed = 5; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const add = (t0, sig, g = 1) => { const i = Math.floor(t0 * SR); for (let k = 0; k < sig.length && i + k < n; k++) out[i + k] += sig[k] * g; };
const mk = (len, f) => { const a = new Float32Array(Math.floor(SR * len)); for (let i = 0; i < a.length; i++) a[i] = f(i / SR, i); return a; };
let ph = 0;
const kick = mk(0.45, (t) => { ph += 2 * Math.PI * (45 + 120 * Math.exp(-t * 30)) / SR; return Math.sin(ph) * Math.exp(-t * 8); });
const snare = mk(0.3, (t) => (rnd() * 0.5 * Math.exp(-t * 22) + Math.sin(2 * Math.PI * 190 * t) * 0.4 * Math.exp(-t * 20)));
let prev = 0;
const hat = mk(0.08, (t) => { const v = rnd() * Math.exp(-t * 70) * 0.25; const d = v - prev; prev = v; return d; });
const note = (f, dur, att = 0.01, rel = 0.1, harm = [1, 0.4, 0.2]) => mk(dur + rel, (t) => {
  let s = 0; harm.forEach((h, k) => { s += h * Math.sin(2 * Math.PI * f * (k + 1) * t); });
  return s * Math.min(1, t / att) * (t < dur ? 1 : Math.exp(-(t - dur) / rel * 5));
});
const mf = (m) => 440 * 2 ** ((m - 69) / 12);
const prog = [[57, [57, 60, 64]], [53, [53, 57, 60]], [48, [48, 52, 55]], [55, [55, 59, 62]]];
const bars = Math.ceil(DUR / (beat * 4)) + 1;
for (let b = 0; b < bars; b++) {
  const tb = b * beat * 4; const [root, chord] = prog[Math.floor(b / 2) % 4]; const sect = Math.floor(b / 16) % 4;
  for (let k = 0; k < 4; k++) { add(tb + k * beat, kick, 0.9); if (k === 1 || k === 3) add(tb + k * beat, snare, 0.5); }
  for (let k = 0; k < 8; k++) add(tb + k * beat / 2, hat, k % 2 ? 0.5 : 0.3);
  for (const off of [0, 1.5, 2, 3.5]) add(tb + off * beat, note(mf(root - 12), beat * 0.4, 0.01, 0.1, [1, 0.5, 0.25]), 0.45);
  if (sect !== 0) for (const c of chord) add(tb, note(mf(c), beat * 4, 0.3, 0.4, [1, 0.3]), 0.07);
  if (sect >= 1) for (let k = 0; k < 8; k++) add(tb + k * beat / 2, note(mf(chord[k % 3] + 12 + (k > 4 ? 12 : 0)), beat * 0.35, 0.005, 0.1, [1, 0.5, 0.3, 0.15]), sect < 3 ? 0.1 : 0.14);
}
const f1 = SR * 2, f2 = SR * 4;
const pcm = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) {
  let v = Math.tanh(out[i] * 1.3) * 0.8;
  if (i < f1) v *= i / f1; if (i > n - f2) v *= (n - i) / f2;
  pcm.writeInt16LE(Math.round(v * 32767), i * 2);
}
const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(process.argv[2] || 'song.wav', Buffer.concat([h, pcm]));
