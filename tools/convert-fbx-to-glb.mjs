#!/usr/bin/env node
// CLI wrapper around tools/build_character_glb.py: converts a base FBX
// (optionally merging Mixamo animation-only FBX files as named clips) into
// a GLB. This is the same Blender pipeline the editor's "Import Model"
// dialog uses via the dev server's /api/import-model endpoint.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBlender } from './resolveBlender.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const blenderScript = path.join(__dirname, 'build_character_glb.py');

const args = process.argv.slice(2);
let inputPath = '';
let outputPath = '';
let blenderPath = '';
const animArgs = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--input') inputPath = args[++i] ?? '';
  else if (arg === '--output') outputPath = args[++i] ?? '';
  else if (arg === '--blender') blenderPath = args[++i] ?? '';
  else if (arg === '--anim') animArgs.push(args[++i] ?? '');
}

const printUsage = () => {
  console.log(
    'Usage: node tools/convert-fbx-to-glb.mjs --input "C:/path/to/hero.fbx" --output "C:/path/to/hero.glb" ' +
    '[--blender "C:/path/to/blender.exe"] [--anim "Walk=C:/path/to/walk.fbx" ...]'
  );
};

if (!inputPath || !outputPath) {
  printUsage();
  process.exit(1);
}

if (!existsSync(inputPath)) {
  console.error(`FBX source file not found: ${inputPath}`);
  process.exit(1);
}

const resolvedBlender = resolveBlender(blenderPath);
if (!resolvedBlender) {
  console.error('Blender executable not found. Set --blender or BLENDER_PATH, or install Blender on this machine.');
  process.exit(1);
}

mkdirSync(path.dirname(outputPath), { recursive: true });

const result = spawnSync(
  resolvedBlender,
  ['-b', '--python', blenderScript, '--', inputPath, outputPath, ...animArgs],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status === 0) {
  console.log(`Converted ${inputPath} -> ${outputPath}`);
} else {
  console.error(`Blender conversion failed with exit code ${result.status}.`);
  process.exit(result.status || 1);
}
