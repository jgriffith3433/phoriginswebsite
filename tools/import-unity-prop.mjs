/**
 * Fit one catalog prop to a GLB and register it.
 *
 *   node tools/import-unity-prop.mjs --name Sofa_3seat --pack AtmosphericHouse --height 0.84 --file office-sofa.glb --id asset-office-sofa --tag office
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveBlender } from './resolveBlender.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readArgs = () => {
  const out = {};
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i += 2) {
    const key = raw[i];
    if (!key?.startsWith('--')) throw new Error(`unexpected ${key}`);
    out[key.slice(2)] = raw[i + 1];
  }
  return out;
};

const opts = readArgs();
if (!opts.name || !opts.file || !opts.height) {
  throw new Error('need --name, --height, and --file');
}

const blender = resolveBlender();
if (!blender) throw new Error('Blender was not found');

const script = path.join(root, 'tools', 'fit-unity-prop.py');
const out = path.join('assets', 'models', opts.file);
const result = spawnSync(blender, [
  '-b',
  '--python',
  script,
  '--',
  '--name',
  opts.name,
  '--pack',
  opts.pack || '',
  '--height',
  opts.height,
  '--out',
  out,
], { cwd: root, encoding: 'utf8' });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.status !== 0) process.exit(result.status ?? 1);

if (!opts.id) process.exit(0);
const libraryPath = path.join(root, 'assets', 'asset-library.json');
const library = JSON.parse(readFileSync(libraryPath, 'utf8'));
const assets = library.assets ?? library;
const list = Array.isArray(assets) ? assets : library.assets;
if (list.some((entry) => entry.id === opts.id)) {
  console.log(`library already has ${opts.id}`);
  process.exit(0);
}
list.push({
  id: opts.id,
  name: opts.file,
  path: `/assets/models/${opts.file}`,
  type: 'model',
  tags: ['prop', opts.tag || 'prop'],
  source: 'project',
});
writeFileSync(libraryPath, `${JSON.stringify(library, null, 2)}\n`);
console.log(`registered ${opts.id}`);
