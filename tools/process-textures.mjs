/**
 * Compress albedo samples into web runtime WebP maps.
 *
 *   npm run textures
 *   Editor Tools → Add Textures  (writes assets/textures/source/, then WebP)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(__dirname, '..');
const IMAGE_EXT = /\.(jpe?g|png|webp|tif{1,2}|bmp|gif)$/i;

export const findFfmpeg = () => {
  const candidates = [
    'ffmpeg',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    '/usr/bin/ffmpeg',
  ];
  for (const bin of candidates) {
    const probe = spawnSync(bin, ['-version'], { encoding: 'utf8' });
    if (probe.status === 0) return bin;
  }
  return null;
};

export const slugify = (value) =>
  String(value || 'texture')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'texture';

export const prettyName = (value) =>
  String(value || 'Texture')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Texture';

const pipelinePathFor = (projectRoot) => path.join(projectRoot, 'tools', 'texture-pipeline.json');

const loadPipeline = (projectRoot) => {
  const pipelinePath = pipelinePathFor(projectRoot);
  const pipeline = JSON.parse(fs.readFileSync(pipelinePath, 'utf8'));
  if (!Array.isArray(pipeline.converts)) pipeline.converts = [];
  if (!Array.isArray(pipeline.materials)) pipeline.materials = [];
  return pipeline;
};

const savePipeline = (projectRoot, pipeline) => {
  fs.writeFileSync(pipelinePathFor(projectRoot), `${JSON.stringify(pipeline, null, 2)}\n`, 'utf8');
};

const resolveSourceDir = (projectRoot, configured) => {
  const envDir = process.env.PHORIGINS_TEXTURES;
  const candidates = [
    envDir,
    configured && path.resolve(projectRoot, configured),
    path.resolve(projectRoot, '..', 'phoriginsassets', 'textures'),
    'C:\\Projects\\phoriginsassets\\textures',
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[candidates.length - 1];
};

const matchInDir = (dir, pattern) => {
  if (!dir || !fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  const lower = String(pattern).toLowerCase();
  const hit = files.find((name) => {
    const n = name.toLowerCase();
    const stem = n.replace(/\.[^.]+$/, '');
    return n === lower || stem === lower || n.startsWith(lower) || stem.startsWith(lower) || n.includes(lower);
  });
  return hit ? path.join(dir, hit) : null;
};

const matchSource = (projectRoot, sourceDir, pattern) => {
  if (!pattern) return null;
  if (path.isAbsolute(pattern) && fs.existsSync(pattern)) return pattern;
  const localFromAssets = path.resolve(projectRoot, 'assets', 'textures', pattern.replace(/^\/?assets\/textures\//, ''));
  if (fs.existsSync(localFromAssets)) return localFromAssets;
  const sourceLocal = path.join(projectRoot, 'assets', 'textures', 'source', path.basename(pattern));
  if (fs.existsSync(sourceLocal)) return sourceLocal;
  const exact = path.join(sourceDir, pattern);
  if (fs.existsSync(exact)) return exact;
  const nestedDir = path.dirname(pattern);
  const nestedBase = path.basename(pattern);
  if (nestedDir && nestedDir !== '.') {
    const nested = matchInDir(path.join(sourceDir, nestedDir), nestedBase);
    if (nested) return nested;
  }
  const rootHit = matchInDir(sourceDir, nestedBase);
  if (rootHit) return rootHit;
  if (!fs.existsSync(sourceDir)) return null;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = matchInDir(path.join(sourceDir, entry.name), nestedBase);
    if (nested) return nested;
  }
  return null;
};

export const convertWithFfmpeg = (ffmpeg, src, dest, maxDim, quality) => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const vf = `scale='min(${maxDim}\\,iw)':'min(${maxDim}\\,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  const result = spawnSync(
    ffmpeg,
    ['-y', '-i', src, '-vf', vf, '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '4', dest],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.slice(-800) || `ffmpeg failed for ${src}`);
  }
};

const libraryEntryFor = (mat) => ({
  id: mat.id,
  name: mat.name || mat.id,
  path: mat.albedo.startsWith('/') ? mat.albedo : `/assets/textures/${path.basename(mat.albedo)}`,
  type: 'material',
  tags: mat.tags ?? ['material'],
  source: mat.source || 'pipeline',
  tileMeters: mat.tileMeters,
  ...(Number(mat.uTileMeters) > 0 ? { uTileMeters: mat.uTileMeters } : {}),
  ...(Number(mat.vTileMeters) > 0 ? { vTileMeters: mat.vTileMeters } : {}),
});

const upsertLibrary = (projectRoot, materials) => {
  const libraryPath = path.join(projectRoot, 'assets', 'asset-library.json');
  let library = { version: 1, assets: [] };
  try {
    library = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
  } catch {
    /* keep empty */
  }
  if (!Array.isArray(library.assets)) library.assets = [];
  const others = library.assets.filter((entry) => entry?.type !== 'material');
  const mats = library.assets.filter((entry) => entry?.type === 'material');
  const byId = new Map(mats.map((entry) => [entry.id, entry]));
  for (const mat of materials) {
    byId.set(mat.id, libraryEntryFor(mat));
  }
  library.assets = [...others, ...byId.values()];
  fs.writeFileSync(libraryPath, `${JSON.stringify(library, null, 2)}\n`, 'utf8');
};

const normalizeMaterial = (mat) => ({
  ...mat,
  albedo: mat.albedo.startsWith('/') ? mat.albedo : `/assets/textures/${path.basename(mat.albedo)}`,
});

const writeMaterialsFile = (projectRoot, pipeline, extra = []) => {
  const materialsFile = path.resolve(projectRoot, pipeline.materialsFile || 'assets/textures/materials.json');
  fs.mkdirSync(path.dirname(materialsFile), { recursive: true });
  let existing = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(materialsFile, 'utf8'));
    existing = Array.isArray(parsed?.materials) ? parsed.materials : [];
  } catch {
    existing = [];
  }
  const byId = new Map();
  [...existing, ...(pipeline.materials ?? []).map(normalizeMaterial), ...extra.map(normalizeMaterial)].forEach((mat) => {
    if (mat?.id) byId.set(mat.id, mat);
  });
  const materials = [...byId.values()];
  fs.writeFileSync(
    materialsFile,
    `${JSON.stringify({ version: 1, generatedBy: 'tools/process-textures.mjs', materials }, null, 2)}\n`,
    'utf8',
  );
  upsertLibrary(projectRoot, materials);
  return materials;
};

const uniqueSlug = (projectRoot, pipeline, base) => {
  const outDir = path.resolve(projectRoot, pipeline.outDir || 'assets/textures');
  const taken = new Set([
    ...pipeline.converts.map((job) => String(job.id)),
    ...pipeline.materials.map((mat) => String(mat.id).replace(/^mat-/, '')),
    ...pipeline.converts.map((job) => String(job.out || '').replace(/\.webp$/i, '')),
  ]);
  let slug = base;
  let n = 2;
  while (taken.has(slug) || fs.existsSync(path.join(outDir, `${slug}.webp`))) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
};

/**
 * Editor import: save bytes under assets/textures/source/, emit WebP, register material.
 */
export const importEditorTexture = (options) => {
  const projectRoot = options.projectRoot || defaultProjectRoot;
  const fileName = path.basename(String(options.fileName || 'texture.png'));
  if (!IMAGE_EXT.test(fileName)) {
    return { ok: false, error: `Unsupported image type: ${fileName}` };
  }
  const buffer = options.buffer;
  if (!buffer || !buffer.length) {
    return { ok: false, error: 'No image data received.' };
  }

  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    return { ok: false, error: 'ffmpeg not found. Install it or add C:\\ffmpeg\\bin to PATH.' };
  }

  const pipeline = loadPipeline(projectRoot);
  const maxDim = Number(options.maxDim) > 0 ? Number(options.maxDim) : (pipeline.defaultMaxDim ?? 1024);
  const quality = Number(options.quality) > 0 ? Number(options.quality) : (pipeline.defaultQuality ?? 78);
  const tileMeters = Number(options.tileMeters) > 0 ? Number(options.tileMeters) : 2;
  const slug = uniqueSlug(projectRoot, pipeline, slugify(fileName));
  const materialId = `mat-${slug}`;
  const outName = `${slug}.webp`;
  const sourceRel = `source/${fileName.replace(/[<>:"|?*]/g, '_')}`;
  const sourceAbs = path.join(projectRoot, 'assets', 'textures', 'source', path.basename(sourceRel));
  const outAbs = path.join(projectRoot, pipeline.outDir || 'assets/textures', outName);

  fs.mkdirSync(path.dirname(sourceAbs), { recursive: true });
  fs.writeFileSync(sourceAbs, buffer);
  convertWithFfmpeg(ffmpeg, sourceAbs, outAbs, maxDim, quality);

  const convertJob = {
    id: slug,
    source: sourceRel,
    out: outName,
    maxDim,
    note: `Editor import: ${fileName}`,
  };
  const material = {
    id: materialId,
    name: prettyName(fileName),
    albedo: `/assets/textures/${outName}`,
    tileMeters,
    specular: [0.14, 0.14, 0.16],
    specularPower: 24,
    emissive: [0.03, 0.03, 0.035],
    tags: ['material', 'imported'],
    source: 'editor',
  };

  pipeline.converts = pipeline.converts.filter((job) => job.id !== slug && job.out !== outName);
  pipeline.materials = pipeline.materials.filter((mat) => mat.id !== materialId);
  pipeline.converts.push(convertJob);
  pipeline.materials.push(material);
  savePipeline(projectRoot, pipeline);
  writeMaterialsFile(projectRoot, pipeline, [material]);

  const bytes = fs.statSync(outAbs).size;
  return {
    ok: true,
    material,
    convert: convertJob,
    bytes,
    path: `/assets/textures/${outName}`,
  };
};

const main = () => {
  const projectRoot = defaultProjectRoot;
  const args = new Set(process.argv.slice(2));
  const processAll = args.has('--all');
  const pipeline = loadPipeline(projectRoot);
  const sourceDir = resolveSourceDir(projectRoot, pipeline.sourceDir);
  const outDir = path.resolve(projectRoot, pipeline.outDir || 'assets/textures');
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    console.error('ffmpeg not found. Install it or add C:\\ffmpeg\\bin to PATH.');
    process.exit(1);
  }

  console.log(`Source: ${sourceDir}`);
  console.log(`Output: ${outDir}`);
  fs.mkdirSync(outDir, { recursive: true });

  const defaultMax = pipeline.defaultMaxDim ?? 1024;
  const defaultQuality = pipeline.defaultQuality ?? 78;
  const jobs = [...pipeline.converts];
  if (processAll && fs.existsSync(sourceDir)) {
    const skip = new Set((pipeline.skip ?? []).map((s) => String(s).toLowerCase()));
    const listed = new Set(pipeline.converts.map((job) => String(job.source).toLowerCase()));
    for (const name of fs.readdirSync(sourceDir)) {
      if (!IMAGE_EXT.test(name)) continue;
      const stem = name.replace(/\.[^.]+$/, '');
      if ([...skip].some((s) => stem.toLowerCase().includes(s) || name.toLowerCase().includes(s))) continue;
      if ([...listed].some((s) => stem.toLowerCase().includes(s))) continue;
      const slug = slugify(stem);
      jobs.push({ id: slug, source: stem, out: `${slug}.webp`, maxDim: 1024, extra: true });
    }
  }

  const report = [];
  for (const job of jobs) {
    const src = matchSource(projectRoot, sourceDir, job.source);
    if (!src) {
      console.warn(`Skip (missing source): ${job.source}`);
      continue;
    }
    const dest = path.join(outDir, job.out);
    const maxDim = job.maxDim ?? defaultMax;
    const quality = job.quality ?? defaultQuality;
    convertWithFfmpeg(ffmpeg, src, dest, maxDim, quality);
    const inBytes = fs.statSync(src).size;
    const outBytes = fs.statSync(dest).size;
    console.log(`${job.out}\t${(outBytes / 1024).toFixed(1)} KB  (${(inBytes / 1024).toFixed(0)} KB → webp, max ${maxDim})`);
    report.push({ id: job.id, out: job.out, bytes: outBytes, source: path.basename(src) });
  }

  writeMaterialsFile(projectRoot, pipeline);
  fs.writeFileSync(path.join(outDir, 'process-report.json'), `${JSON.stringify({ sourceDir, report }, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${pipeline.materials.length} pipeline materials`);
};

const invoked = process.argv[1] && path.basename(process.argv[1]).replace(/\\/g, '/').endsWith('process-textures.mjs');
if (invoked) main();
