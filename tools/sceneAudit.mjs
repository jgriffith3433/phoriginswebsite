// Scene audit: `npm run check:scene` (every level) or `node tools/sceneAudit.mjs apex-peak,the-station`.
// Bundles tools/sceneaudit/entry.ts with esbuild (a Vite dependency) and runs it on Babylon's NullEngine.
// Checks the Studio 3D quality rules that geometry alone can judge (see entry.ts) and exits 1 on any finding
// that is not listed in tools/sceneaudit/allow.json (each entry there needs a reason).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = mkdtempSync(join(tmpdir(), 'ph-sceneaudit-'));
const bundle = join(out, 'audit.mjs');
await build({ entryPoints: [join(root, 'tools/sceneaudit/entry.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'error' });
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const run = spawnSync(process.execPath, [bundle, ...args], { env: { ...process.env, PHROOT: root }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
rmSync(out, { recursive: true, force: true });
if (run.status !== 0) {
  console.error(`${run.stdout}`.split('\n').filter((l) => !l.startsWith('BJS')).join('\n'));
  console.error(run.stderr);
  process.exit(run.status ?? 1);
}
const allow = JSON.parse(readFileSync(join(root, 'tools/sceneaudit/allow.json'), 'utf8'));
const allowed = (level, f) => allow.some((a) => (a.level === '*' || a.level === level) && a.rule === f.rule && new RegExp(a.what).test(f.what));
let failed = 0;
for (const line of `${run.stdout}`.split('\n')) {
  const m = /^audit (\S+) (.*)$/.exec(line);
  if (!m) continue;
  const findings = JSON.parse(m[2]);
  const bad = findings.filter((f) => !allowed(m[1], f));
  console.log(`${m[1]}: ${bad.length ? `${bad.length} problem(s)` : 'clean'}${findings.length > bad.length ? ` (${findings.length - bad.length} allowed)` : ''}`);
  for (const f of bad) console.log(`  ${f.rule.padEnd(9)} ${f.what}: ${f.detail}${f.amount != null ? ` [${f.amount}]` : ''}${f.fixY != null ? ` (move y ${f.fixY > 0 ? '+' : ''}${f.fixY})` : ''}`);
  failed += bad.length;
}
console.log(failed ? `scene audit: FAILED (${failed})` : 'scene audit: clean');
process.exit(failed ? 1 : 0);
