// Compresses the big GLBs in assets/models in place: WebP textures (capped), resampled animations and
// lossless meshopt geometry/animation compression (EXT_meshopt_compression, no quantization).
// The game decodes meshopt with the decoder self-hosted at public/vendor/meshopt_decoder.js (src/game/meshopt.ts).
//
//   npm i --no-save sharp                     once, for the WebP encoder
//   node tools/compress-models.mjs            compress every model over 4 MB that isn't compressed yet
//   node tools/compress-models.mjs a.glb ...  compress just these
//   node tools/compress-models.mjs --inspect  list sizes, textures and extensions, change nothing
//
// The originals stay in git history. Already-compressed files are skipped, so it is safe to run again.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, resample, reorder, textureCompress } from '@gltf-transform/functions';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const DIR = path.resolve('assets/models');
const MIN_BYTES = 4 * 1024 * 1024;
/** Props seen small on screen get smaller textures than characters. */
const PROP_TEXTURE_PX = { 'tt_pistol.glb': 1024 };
const CHARACTER_TEXTURE_PX = 1024;

// sharp (WebP encoding) is only needed here, so it is not a project dependency: `npm i --no-save sharp` first.
const sharp = await import('sharp').then((m) => m.default).catch(() => null);
if (!sharp && !process.argv.includes('--inspect')) {
  console.error('compress-models needs sharp for WebP textures: run `npm i --no-save sharp` and try again.');
  process.exit(1);
}
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const args = process.argv.slice(2);
const inspect = args.includes('--inspect');
const named = args.filter((a) => !a.startsWith('--'));
const files = named.length
  ? named.map((f) => path.resolve(f))
  : fs.readdirSync(DIR).filter((f) => f.endsWith('.glb')).map((f) => path.join(DIR, f));

const mb = (n) => (n / 1e6).toFixed(2) + ' MB';
const compressed = (doc) => doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression');

let before = 0;
let after = 0;
for (const file of files) {
  const size = fs.statSync(file).size;
  if (!inspect && !named.length && size < MIN_BYTES) continue;
  const name = path.basename(file);
  let doc;
  try {
    doc = await io.read(file);
  } catch (error) {
    console.log(`${name}: can't be read (${error.message.split('\n')[0].slice(0, 80)}), skipped`);
    continue;
  }
  if (inspect) {
    const tex = doc.getRoot().listTextures().map((t) => `${t.getMimeType()} ${t.getSize()?.join('x')}`);
    const ext = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName).join(', ') || 'none';
    console.log(`${name}: ${mb(size)}; extensions ${ext}; textures ${tex.join(', ') || 'none'}`);
    continue;
  }
  if (compressed(doc)) {
    console.log(`${name}: already compressed (${mb(size)}), skipped`);
    continue;
  }
  const px = PROP_TEXTURE_PX[name] ?? CHARACTER_TEXTURE_PX;
  await doc.transform(
    dedup(),
    resample(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [px, px], quality: 88 }),
    reorder({ encoder: MeshoptEncoder }),
  );
  // Lossless meshopt only: no quantize(). Quantizing these multi-mesh Mixamo characters splits their one shared
  // skin into one skin per mesh (each mesh gets its own dequantize transform), which Babylon loads as several
  // skeletons; the game expects one rig per character (clips, pistol hand bone).
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
    method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
  });
  await io.write(file, doc);
  const out = fs.statSync(file).size;
  before += size;
  after += out;
  console.log(`${name}: ${mb(size)} -> ${mb(out)}`);
}
if (!inspect && before) console.log(`Total: ${mb(before)} -> ${mb(after)}`);
