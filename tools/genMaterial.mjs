/**
 * A tileable material from a description, through Hawkes Gen (C:\Projects\hawkesgen):
 * the phorigins "material" preset paints a seamless albedo on the GPU fleet, then
 * texture.maps derives a normal and a roughness map. The three PNGs land in the
 * source-asset repo, next to the other texture samples, for the usual pipeline
 * (tools/texture-pipeline.json, npm run textures) to compress into WebP.
 *
 *   node tools/genMaterial.mjs lab-tile "white ceramic lab wall tiles, 10 cm square, thin grey grout, slightly worn"
 *   node tools/genMaterial.mjs walnut "dark walnut wall paneling with fine vertical grain" --seed 7 --size 1024 --takes 2
 *
 * Start Hawkes Gen first (hawkesgen\auto-start.bat). A GPU server must be running
 * (or be started from its dashboard); each take costs a few cents.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HawkesGen } from './hawkesgen.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.env.PHORIGINS_TEXTURES ?? path.join(ROOT, '..', 'phoriginsassets', 'textures'), 'generated');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const [name, description] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!name || !description || !/^[a-z0-9-]+$/.test(name)) {
  console.error('usage: node tools/genMaterial.mjs <name-with-dashes> "<description>" [--seed N] [--size 1024] [--takes 1]');
  process.exit(1);
}

const gen = new HawkesGen({ project: 'phorigins' });
const size = Number(flag('size', 1024));
const takes = Number(flag('takes', 1));
const seed = flag('seed') ? Number(flag('seed')) : undefined;

const log = (j) => console.log(`  ${j.status}: ${j.detail}`);
console.log(`painting ${name} (${takes} take${takes > 1 ? 's' : ''}, ${size}px)...`);
const albedo = await gen.run(null, {
  preset: 'material',
  params: { prompt: description, width: size, height: size, count: takes, ...(seed ? { seed } : {}) },
  labels: { material: name },
  onUpdate: log,
});
fs.mkdirSync(OUT, { recursive: true });
for (const [k, o] of albedo.outputs.entries()) {
  const base = takes > 1 ? `${name}-${k + 1}` : name;
  const src = path.join(OUT, `${base}.png`);
  await gen.download(o.asset, src);
  console.log(`deriving maps for ${base}...`);
  const maps = await gen.run('texture.maps', { inputs: { image: `asset:${o.asset}` }, labels: { material: base }, onUpdate: log });
  for (const m of maps.outputs) {
    if (m.title === 'albedo') continue; // keep the painted albedo; the flattened one is for reference in the library
    await gen.download(m.asset, path.join(OUT, `${base}_${m.title}.png`));
  }
  console.log(`  ${path.relative(ROOT, src)} (+ _normal, _roughness)  seed ${o.seed}`);
}
console.log(`done. Next: add them in Dev Tools (Tools > Add Textures) or tools/texture-pipeline.json, then npm run textures.`);
