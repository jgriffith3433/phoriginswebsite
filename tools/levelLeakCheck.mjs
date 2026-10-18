// Level reload leak check: `npm run check:leaks` (default B3 four times) or
// `node tools/levelLeakCheck.mjs /levels/b3-basement.json,/levels/apex-peak.json`.
// Bundles tools/leakcheck/entry.ts with esbuild (a Vite dependency) and runs it on Babylon's NullEngine.
// Exits 1 when a count grows between the second and the last load of the same level (needs 3 loads of it).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = mkdtempSync(join(tmpdir(), 'ph-leakcheck-'));
const bundle = join(out, 'check.mjs');
await build({
  entryPoints: [join(root, 'tools/leakcheck/entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  logLevel: 'error',
});
const levels = process.argv[2] ?? '/levels/b3-basement.json';
const run = spawnSync(process.execPath, [bundle, levels], { env: { ...process.env, PHROOT: root }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
rmSync(out, { recursive: true, force: true });
const lines = `${run.stdout}`.split('\n').filter((line) => line && !line.startsWith('BJS'));
console.log(lines.join('\n'));
if (run.status !== 0) {
  console.error(run.stderr);
  process.exit(run.status ?? 1);
}
const loads = lines.filter((line) => line.startsWith('load ')).map((line) => {
  const [, , level, json] = /^load (\d+) (\S+) (.*)$/.exec(line) ?? [];
  return { level, counts: JSON.parse(json) };
});
let failed = false;
for (const level of new Set(loads.map((load) => load.level))) {
  const mine = loads.filter((load) => load.level === level);
  // The first visit and the first visit after another level may fill shared caches (catalog textures).
  if (mine.length < 3) {
    console.log(`${level}: loaded ${mine.length}x, needs 3 to judge`);
    continue;
  }
  const before = mine[1].counts;
  const after = mine[mine.length - 1].counts;
  for (const key of Object.keys(after)) {
    if (key === 'geometries') continue; // parsed prop containers are a shared cache
    if (after[key] > before[key]) {
      console.error(`LEAK ${level}: ${key} ${before[key]} -> ${after[key]}`);
      failed = true;
    }
  }
}
console.log(failed ? 'leak check: FAILED' : 'leak check: flat');
process.exit(failed ? 1 : 0);
