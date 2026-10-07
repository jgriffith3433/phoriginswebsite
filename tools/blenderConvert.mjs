import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBlender } from './resolveBlender.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const safeAssetName = (value) => value.replace(/[^a-zA-Z0-9_-]/g, '-');

export const inferClipName = (fileName) => {
  const base = fileName.replace(/\.fbx$/i, '').trim();
  const lower = base.toLowerCase();
  if (lower.includes('talk') && (lower.includes('sit') || lower.includes('sitting'))) return 'SitTalk';
  if (lower.includes('sit')) return 'SitIdle';
  if (lower.includes('jump')) return 'Jump';
  if (lower.includes('walk')) return 'Walk';
  if (lower.includes('idle')) return 'Idle';
  return base.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Clip';
};

const readLibrary = (libraryAbsPath) => {
  if (!existsSync(libraryAbsPath)) return { version: 1, assets: [] };
  try {
    const parsed = JSON.parse(readFileSync(libraryAbsPath, 'utf8'));
    if (!Array.isArray(parsed.assets)) parsed.assets = [];
    return parsed;
  } catch {
    return { version: 1, assets: [] };
  }
};

const writeLibrary = (libraryAbsPath, library) => {
  writeFileSync(libraryAbsPath, JSON.stringify(library, null, 2), 'utf8');
};

const toProjectSourceFbx = (projectRoot, absPath) => {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(absPath);
  if (resolved.toLowerCase().startsWith(root.toLowerCase())) {
    return `/${path.relative(root, resolved).replace(/\\/g, '/')}`;
  }
  return absPath;
};

export const convertCharacterGlb = ({
  projectRoot,
  basePath,
  outputName,
  animations = [],
  blenderPath = '',
  tags,
}) => {
  const blender = resolveBlender(blenderPath);
  if (!blender) {
    return { ok: false, error: 'Could not locate a Blender executable on this machine.' };
  }
  if (!basePath || !existsSync(basePath)) {
    return { ok: false, error: `Base FBX not found: ${basePath}` };
  }

  const safeName = safeAssetName(outputName);
  if (!safeName) return { ok: false, error: 'A valid output name is required.' };

  for (const anim of animations) {
    if (!existsSync(anim.path)) {
      return { ok: false, error: `Animation FBX not found: ${anim.path}` };
    }
  }

  const outputRelPath = `/assets/models/${safeName}.glb`;
  const outputAbsPath = path.join(projectRoot, 'assets', 'models', `${safeName}.glb`);
  mkdirSync(path.dirname(outputAbsPath), { recursive: true });

  // Clips are retargeted onto the character's real mixamorig / mixamorigN bones. Do not rewrite GLB JSON.
  const scriptPath = path.join(__dirname, 'build_character_glb.py');
  const animArgs = animations.map((anim) => (anim.name ? `${anim.name}=${anim.path}` : anim.path));
  const result = spawnSync(blender, ['-b', '--python', scriptPath, '--', basePath, outputAbsPath, ...animArgs], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
    timeout: 10 * 60 * 1000,
  });

  const log = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0 || !existsSync(outputAbsPath) || /Traceback \(most recent call last\)|AttributeError:/.test(log)) {
    return { ok: false, error: 'Blender conversion failed.', log };
  }

  const libraryAbsPath = path.join(projectRoot, 'assets', 'asset-library.json');
  const library = readLibrary(libraryAbsPath);
  const assetId = `asset-${safeName}`;
  const clipNames = animations.map((anim) => anim.name).filter(Boolean);
  const animationEntries = animations.map((anim) => ({
    name: anim.name,
    path: anim.projectPath || anim.path,
  }));
  const defaultTags = animations.length
    ? ['character', 'mixamo', 'real-file']
    : ['prop', 'real-file'];
  const existingIndex = library.assets.findIndex((asset) => asset.id === assetId);
  const existingTags = existingIndex >= 0 && Array.isArray(library.assets[existingIndex].tags)
    ? library.assets[existingIndex].tags
    : null;
  const entry = {
    id: assetId,
    name: `${safeName}.glb`,
    path: outputRelPath,
    type: 'model',
    tags: Array.isArray(tags) && tags.length ? tags : (existingTags ?? defaultTags),
    source: 'project',
    sourceFbx: toProjectSourceFbx(projectRoot, basePath),
    animations: animationEntries,
  };
  if (existingIndex >= 0) library.assets[existingIndex] = { ...library.assets[existingIndex], ...entry };
  else library.assets.push(entry);
  writeLibrary(libraryAbsPath, library);

  return { ok: true, asset: entry, clipNames, log };
};
