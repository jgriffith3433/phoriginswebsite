/**
 * Makes only the clips that do not exist yet: spoken lines in locales/en.json with no `audio` (or whose file is
 * gone) and sound effects in locales/sfx.json whose file is missing. Same takes as Dev Tools' Generate
 * (tools/voiceLines.mjs, tools/soundEffects.mjs, through Hawkes Gen), and the line records go back into en.json.
 *
 *   npm run audio:missing -- --dry          list what would be made and a rough cost, spend nothing
 *   npm run audio:missing -- --limit 10     make at most 10 clips
 *   npm run audio:missing -- --only sfx.morning.door,bark.station.01
 *
 * Hawkes Gen is found from HAWKESGEN_URL / HAWKESGEN_KEY or ~/.hawkes/client.json; HAWKESGEN_PROJECT overrides the
 * project id (default phorigins). Each voice line or effect is one ElevenLabs call (a few cents; the 30 s beds cost
 * the most). Never regenerates a clip that exists: use Dev Tools for that.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const dry = flag('dry');
const limit = Number(value('limit') ?? Infinity);
const onlyList = value('only');
const only = onlyList ? new Set(onlyList.split(',').map((id) => id.trim()).filter(Boolean)) : null;

const SPOKEN = new Set(['phone', 'dialogue', 'bark', 'shout']);
const enPath = path.join(root, 'locales', 'en.json');
const sfxPath = path.join(root, 'locales', 'sfx.json');
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const sfx = JSON.parse(fs.readFileSync(sfxPath, 'utf8'));
const onDisk = (url) => {
  const clean = String(url || '').replace(/\\/g, '/');
  if (!clean.startsWith('/assets/') || clean.includes('..')) return false;
  const abs = path.join(root, clean.slice(1));
  return fs.existsSync(abs) && fs.statSync(abs).size > 0;
};

const lines = en.lines.filter((line) => SPOKEN.has(line.type) && !onDisk(line.audio) && (!only || only.has(line.id)));
const effects = sfx.effects.filter((effect) => effect.audio && !onDisk(effect.audio) && (!only || only.has(effect.id)));
const jobs = [
  ...lines.map((line) => ({ kind: 'line', id: line.id, line })),
  ...effects.map((effect) => ({ kind: 'sfx', id: effect.id, effect })),
].slice(0, Number.isFinite(limit) ? Math.max(0, limit) : undefined);

// Rough: a voice take by its characters, an effect by its length (a one-shot counted as 4 s).
const estimate = jobs.reduce((sum, job) => sum + (job.kind === 'line'
  ? 0.03 + String(job.line.text).length * 0.0003
  : 0.03 + (job.effect.duration ?? 4) * 0.004), 0);
console.log(`${jobs.length} clip(s) to make (${lines.length} line(s), ${effects.length} effect(s) missing), roughly $${estimate.toFixed(2)}:`);
for (const job of jobs) {
  const what = job.kind === 'line' ? `line ${job.id}  ${job.line.speaker}: ${job.line.text}` : `sfx  ${job.id}  ${job.effect.audio}`;
  console.log(`  ${what}`);
}
if (dry || jobs.length === 0) process.exit(0);

const { synthesizeLine, voiceForSpeaker } = await import('./voiceLines.mjs');
const { synthesizeEffect } = await import('./soundEffects.mjs');

for (const job of jobs) {
  if (job.kind === 'line' && !voiceForSpeaker(root, job.line.speaker)) {
    console.error(`No voice for speaker "${job.line.speaker}" (${job.id}). Add it to locales/voices.json first.`);
    process.exit(1);
  }
}

let made = 0;
const failed = [];
const saveLocale = () => fs.writeFileSync(enPath, `${JSON.stringify(en, null, 2)}\n`);
for (const job of jobs) {
  try {
    if (job.kind === 'line') {
      const { line } = job;
      const result = await synthesizeLine(root, {
        id: line.id,
        speaker: line.speaker,
        text: line.text,
        audio: line.audio,
        performance: line.performance,
      });
      Object.assign(line, result);
      saveLocale();
    } else {
      await synthesizeEffect(root, job.effect);
    }
    made += 1;
    console.log(`made ${job.id}`);
  } catch (error) {
    failed.push(job.id);
    console.error(`failed ${job.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`${made} made, ${failed.length} failed${failed.length ? `: ${failed.join(', ')}` : ''}.`);
process.exit(failed.length ? 1 : 0);
