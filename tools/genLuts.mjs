// Writes the per-chapter colour grades as 3D LUTs: assets/lut/<chapter>.3dl (17³, 12-bit, Babylon's
// ColorGradingTexture format). Run: node tools/genLuts.mjs. Deterministic, no GPU.
//
// The LUT is applied after ACES tonemapping, in display space (src/render/pipeline.ts). Each grade is a small
// recipe: saturation, lift / gamma / gain, a contrast S-curve, and a split tone (shadow and highlight tints).
// Babylon normalises a .3dl by its largest value, so every grade is rescaled to keep white's brightest channel at
// full: brightness stays with exposure, the LUT only sets colour and contrast.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets', 'lut');
const SIZE = 17;
const MAX = 4095;

const clamp = (v) => Math.min(1, Math.max(0, v));
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** One grade: rgb in 0..1 (display space) to rgb. */
const grade = (recipe) => (c) => {
  const { sat = 1, lift = [0, 0, 0], gamma = [1, 1, 1], gain = [1, 1, 1], contrast = 1, shadows = [0, 0, 0], mids = [0, 0, 0], highlights = [0, 0, 0], crush = 0 } = recipe;
  let [r, g, b] = c;
  // Saturation around luma.
  const l0 = luma([r, g, b]);
  r = l0 + (r - l0) * sat;
  g = l0 + (g - l0) * sat;
  b = l0 + (b - l0) * sat;
  // Lift / gamma / gain per channel.
  const lgg = (v, i) => Math.pow(clamp(gain[i] * (v + lift[i] * (1 - v))), 1 / gamma[i]);
  r = lgg(r, 0);
  g = lgg(g, 1);
  b = lgg(b, 2);
  // Contrast S-curve around mid grey (display 0.45).
  const sc = (v) => {
    const p = 0.45;
    const x = clamp(v);
    return x < p ? p * Math.pow(x / p, contrast) : 1 - (1 - p) * Math.pow((1 - x) / (1 - p), contrast);
  };
  r = sc(r);
  g = sc(g);
  b = sc(b);
  // Black crush.
  if (crush > 0) {
    const k = (v) => clamp((v - crush) / (1 - crush));
    r = k(r);
    g = k(g);
    b = k(b);
  }
  // Split tone by luma: shadows, mids, highlights.
  const l = luma([r, g, b]);
  const ws = 1 - smooth(0.0, 0.5, l);
  const wh = smooth(0.45, 1.0, l);
  const wm = Math.max(0, 1 - ws - wh);
  r += shadows[0] * ws + mids[0] * wm + highlights[0] * wh;
  g += shadows[1] * ws + mids[1] * wm + highlights[1] * wh;
  b += shadows[2] * ws + mids[2] * wm + highlights[2] * wh;
  return [r, g, b];
};

/** The eight chapters (J's brief, docs/render.md). */
const CHAPTERS = {
  // Cold steel-blue corporate: drained colour, blue in the blacks, clean cool whites.
  'apex-peak': { sat: 0.74, lift: [0.0, 0.01, 0.035], gamma: [0.97, 1.0, 1.05], contrast: 1.1, shadows: [-0.025, 0.0, 0.05], mids: [-0.025, 0.0, 0.03], highlights: [-0.03, 0.0, 0.015] },
  // Sick green-sodium: green-black shadows, yellow sodium highlights, crushed.
  'b3-basement': { sat: 0.82, gamma: [0.98, 1.05, 0.92], contrast: 1.16, crush: 0.02, shadows: [-0.02, 0.045, 0.0], mids: [0.02, 0.05, -0.05], highlights: [0.08, 0.05, -0.09] },
  // Over-bright clinical white: lifted, bleached, a cyan cast in the whites.
  'the-return': { sat: 0.55, lift: [0.07, 0.08, 0.09], gamma: [1.12, 1.15, 1.18], contrast: 0.9, mids: [-0.01, 0.01, 0.02], highlights: [-0.03, 0.0, 0.02] },
  // Amber lamplight: warm amber mids and highlights over deep brown-teal shadows.
  'the-desk': { sat: 1.0, gamma: [1.06, 1.0, 0.9], contrast: 1.08, shadows: [-0.01, 0.0, 0.02], mids: [0.06, 0.025, -0.06], highlights: [0.07, 0.03, -0.08] },
  // Wet neon teal-magenta: teal shadows and mids, magenta highlights, punchy.
  'going-home': { sat: 1.25, contrast: 1.12, shadows: [-0.045, 0.03, 0.05], mids: [-0.03, 0.015, 0.03], highlights: [0.07, -0.04, 0.06] },
  // Sodium orange: orange everywhere but the blacks, brown shadows.
  'the-station': { sat: 0.92, gamma: [1.08, 1.0, 0.86], contrast: 1.08, shadows: [0.02, 0.0, -0.03], mids: [0.08, 0.025, -0.08], highlights: [0.08, 0.03, -0.1] },
  // Fluorescent green: green cast in the mids, green-white tubes, teal-green shadows.
  'the-train': { sat: 0.8, gamma: [0.96, 1.07, 0.97], contrast: 1.08, shadows: [-0.03, 0.03, 0.01], mids: [-0.03, 0.06, -0.01], highlights: [-0.02, 0.04, -0.02] },
  // Washed grey-gold dawn: low saturation, grey lifted blacks, pale gold whites.
  'the-morning': { sat: 0.6, lift: [0.06, 0.06, 0.065], gamma: [1.04, 1.02, 0.98], contrast: 0.92, mids: [0.025, 0.015, -0.02], highlights: [0.05, 0.03, -0.04] },
};

const write = (id, recipe) => {
  const f = grade(recipe);
  const values = [];
  // Babylon's .3dl reader: red slowest, then green, blue fastest.
  for (let ri = 0; ri < SIZE; ri += 1) {
    for (let gi = 0; gi < SIZE; gi += 1) {
      for (let bi = 0; bi < SIZE; bi += 1) {
        values.push(f([ri / (SIZE - 1), gi / (SIZE - 1), bi / (SIZE - 1)]));
      }
    }
  }
  const white = f([1, 1, 1]);
  const scale = 1 / Math.max(white[0], white[1], white[2]);
  const shaper = Array.from({ length: SIZE }, (_, i) => Math.round((i * 1023) / (SIZE - 1))).join(' ');
  const lines = [`# PH Origins chapter grade: ${id}. Generated by tools/genLuts.mjs; edit the recipe there.`, shaper];
  for (const v of values) lines.push(v.map((x) => Math.round(clamp(x * scale) * MAX)).join(' '));
  writeFileSync(join(out, `${id}.3dl`), `${lines.join('\n')}\n`);
  return { id, white: white.map((x) => +(x * scale).toFixed(3)), grey: f([0.45, 0.45, 0.45]).map((x) => +(x * scale).toFixed(3)) };
};

mkdirSync(out, { recursive: true });
for (const [id, recipe] of Object.entries(CHAPTERS)) {
  const r = write(id, recipe);
  console.log(`${r.id.padEnd(12)} white ${r.white.join(' ')}  grey ${r.grey.join(' ')}`);
}
