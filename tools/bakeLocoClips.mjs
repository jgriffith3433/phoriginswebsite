#!/usr/bin/env node
/**
 * Append named locomotion transition clips onto pierce.glb / ch44-hero.glb.
 *
 * After Gen motion.from-text (+ motion.check inPlace) and studio_gen_import of each
 * clip GLB, run:
 *
 *   node tools/bakeLocoClips.mjs \
 *     --target assets/models/pierce.glb \
 *     --clip StartWalk=assets/animations/loco/StartWalk.glb \
 *     --clip Stop=assets/animations/loco/Stop.glb \
 *     --clip Turn90=assets/animations/loco/Turn90.glb \
 *     --clip Turn180=assets/animations/loco/Turn180.glb \
 *     --clip StairsUp=assets/animations/loco/StairsUp.glb
 *
 * Then the same for ch44-hero.glb. Turn90Left is optional (mirror of Turn90); the
 * runtime falls back to Turn90 for both sides until a left take lands.
 *
 * Clip GLBs should be Mixamo-named, in-place, one Animation per file (or the first
 * animation is used). Replaces an existing animation of the same name.
 *
 * Then: npm run models:compress (skip if already meshopt) and check:anim.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const takes = (flag) => {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1]) out.push(args[++i]);
  }
  return out;
};

const boneKey = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/^mixamorig\d*:/, '')
    .replace(/[^a-z0-9]+/g, '');

const targetPath = take('--target');
const clipSpecs = takes('--clip');
if (!targetPath || clipSpecs.length === 0) {
  console.error(
    'usage: node tools/bakeLocoClips.mjs --target <hero.glb> --clip Name=path.glb [--clip ...]',
  );
  process.exit(1);
}

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(path.resolve(targetPath));
const root = doc.getRoot();
const buffer = root.listBuffers()[0] ?? doc.createBuffer();

const jointIndex = new Map();
for (const node of root.listNodes()) {
  const key = boneKey(node.getName());
  if (key) jointIndex.set(key, node);
}

const copyAccessor = (src) => {
  const arr = src.getArray();
  if (!arr) return null;
  return doc
    .createAccessor()
    .setType(src.getType())
    .setArray(arr.slice ? arr.slice() : new arr.constructor(arr))
    .setBuffer(buffer);
};

for (const spec of clipSpecs) {
  const eq = spec.indexOf('=');
  if (eq < 0) {
    console.error(`bad --clip ${spec} (want Name=path.glb)`);
    process.exit(1);
  }
  const name = spec.slice(0, eq);
  const clipPath = path.resolve(spec.slice(eq + 1));
  const clipDoc = await io.read(clipPath);
  const srcAnim = clipDoc.getRoot().listAnimations()[0];
  if (!srcAnim) {
    console.error(`${clipPath}: no animations`);
    process.exit(1);
  }

  for (const anim of root.listAnimations()) {
    if (anim.getName() === name) anim.dispose();
  }

  const dstAnim = doc.createAnimation(name);
  let channels = 0;
  for (const ch of srcAnim.listChannels()) {
    const srcNode = ch.getTargetNode();
    const keyed = jointIndex.get(boneKey(srcNode?.getName()));
    if (!keyed) continue;
    const sampler = ch.getSampler();
    if (!sampler) continue;
    const input = copyAccessor(sampler.getInput());
    const output = copyAccessor(sampler.getOutput());
    if (!input || !output) continue;
    const dstSampler = doc
      .createAnimationSampler()
      .setInput(input)
      .setOutput(output)
      .setInterpolation(sampler.getInterpolation() || 'LINEAR');
    dstAnim
      .addSampler(dstSampler)
      .addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(keyed)
          .setTargetPath(ch.getTargetPath())
          .setSampler(dstSampler),
      );
    channels += 1;
  }
  console.log(`${name}: ${channels} channels from ${path.basename(clipPath)}`);
  if (channels === 0) {
    console.error(`no matching joints for ${name}; is the clip Mixamo-named?`);
    process.exit(1);
  }
}

const outPath = take('--out') || targetPath;
await io.write(outPath, doc);
// Keep JSON chunk space-padded (strict parsers reject NUL padding).
const buf = readFileSync(outPath);
const jsonLen = buf.readUInt32LE(12);
const jsonStart = 20;
const jsonEnd = jsonStart + jsonLen;
const json = buf.subarray(jsonStart, jsonEnd);
if (json.includes(0)) {
  const text = Buffer.from(json.toString('utf8').replace(/\0+$/, ''));
  const pad = Buffer.alloc(jsonLen - text.length, 0x20);
  const fixed = Buffer.concat([buf.subarray(0, jsonStart), text, pad, buf.subarray(jsonEnd)]);
  writeFileSync(outPath, fixed);
}
console.log(`wrote ${outPath}`);
