// Animation trace check (quality rule 5): `npm run check:anim`. Bundles tools/animcheck/entry.ts with esbuild and
// runs it on Babylon's NullEngine: jump pose against the physics, jump clip frames, walk rate against ground speed.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = mkdtempSync(join(tmpdir(), 'ph-animcheck-'));
const bundle = join(out, 'check.mjs');
await build({ entryPoints: [join(root, 'tools/animcheck/entry.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'error' });
const run = spawnSync(process.execPath, [bundle], { env: { ...process.env, PHROOT: root }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
rmSync(out, { recursive: true, force: true });
const lines = `${run.stdout}`.split('\n').filter((line) => line && !line.startsWith('BJS'));
console.log(lines.join('\n'));
if (run.status !== 0) {
  console.error(run.stderr.split('\n').slice(0, 30).join('\n'));
  process.exit(run.status ?? 1);
}
if (lines.some((line) => line.startsWith('fail '))) process.exit(1);
