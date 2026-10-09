import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertCharacterGlb } from './blenderConvert.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsRoot = process.env.PHORIGINS_ASSETS || 'C:/Projects/phoriginsassets';
const modelsDir = path.join(assetsRoot, 'models');
const animationsDir = path.join(assetsRoot, 'animations');

const locomoClips = [
  { name: 'Idle', path: path.join(animationsDir, 'Idle.fbx') },
  { name: 'Walk', path: path.join(animationsDir, 'Walking.fbx') },
  { name: 'Jump', path: path.join(animationsDir, 'Jump.fbx') },
  { name: 'SitIdle', path: path.join(animationsDir, 'Sitting Idle.fbx') },
  { name: 'SitTalk', path: path.join(animationsDir, 'Sitting Talking.fbx') },
];

/*
 * Mixamo pistol FBX inspection (Blender 5, 2026-10-07). Every file’s action is
 * Armature|mixamo.com|Layer0 — names are useless; map by pose, not filename.
 *
 *   Pistol Idle.fbx      367136  41f  two-hand chest hold, looping
 *   Pistol Walk.fbx      326816  25f  two-hand hold while stepping
 *   Pistol Jump.fbx      424032  61f  same hold through a jump
 *   Pistol Take Out.fbx  381728  36f  two-hand gun already up; small recoil
 *                                    (NOT a hip draw). Identical SHA to Put Away.
 *   Pistol Put Away.fbx  381728  36f  byte-identical to Take Out — do not import.
 *   Pistol Aim.fbx       712608 167f  starts two-hand, hands drop/apart to sides
 *                                    (put-away / disarm, NOT aim).
 *
 * Draw  = reverse of Aim.fbx (raise from sides to two-hand).
 * Holster = reverse of Draw (Aim.fbx forward).
 * PistolAim = Take Out.fbx (the actual fire/aim-hold). Shoot keyword uses this.
 */
const putAwayPath = path.join(animationsDir, 'Pistol Aim.fbx');
const firePath = path.join(animationsDir, 'Pistol Take Out.fbx');
const playerPistolClips = [
  { name: 'PistolIdle', path: path.join(animationsDir, 'Pistol Idle.fbx') },
  { name: 'PistolWalk', path: path.join(animationsDir, 'Pistol Walk.fbx') },
  { name: 'PistolJump', path: path.join(animationsDir, 'Pistol Jump.fbx') },
  { name: 'Draw', path: putAwayPath, reverse: true },
  { name: 'Holster', path: putAwayPath, reverse: true },
  { name: 'PistolAim', path: firePath },
];

const walkBackClip = { name: 'WalkBack', path: path.join(animationsDir, 'Walk Backwards.fbx') };
const fallingClip = { name: 'FallingDown', path: path.join(animationsDir, 'Falling Down.fbx') };
const rebornClip = { name: 'RebornIdle', path: path.join(animationsDir, 'Reborn Idle Variation.fbx') };
const attackClip = { name: 'Attack', path: path.join(animationsDir, 'Attack.fbx') };

const npcClips = locomoClips.filter((clip) => clip.name !== 'Jump');
const creatureClips = [
  ...locomoClips.filter((clip) => clip.name === 'Idle' || clip.name === 'Walk'),
  attackClip,
];

const jobs = [
  {
    outputName: 'ch33-hero',
    fbx: 'Ch33_nonPBR.fbx',
    animations: [...locomoClips, ...playerPistolClips, walkBackClip, fallingClip],
    tags: ['character', 'mixamo', 'player', 'real-file'],
  },
  {
    outputName: 'ch44-hero',
    fbx: 'Ch44_nonPBR.fbx',
    animations: [...locomoClips, rebornClip],
    tags: ['character', 'mixamo', 'transform', 'post-god-complex', 'real-file'],
  },
  {
    outputName: 'ch08-npc',
    fbx: 'Ch08_nonPBR.fbx',
    animations: npcClips,
    tags: ['character', 'mixamo', 'npc', 'professional_npc', 'real-file'],
  },
  {
    outputName: 'ch23-npc',
    fbx: 'Ch23_nonPBR.fbx',
    animations: npcClips,
    tags: ['character', 'mixamo', 'npc', 'professional_npc', 'real-file'],
  },
  {
    outputName: 'ch28-npc',
    fbx: 'Ch28_nonPBR.fbx',
    animations: npcClips,
    tags: ['character', 'mixamo', 'npc', 'professional_npc', 'real-file'],
  },
  {
    outputName: 'ch31-npc',
    fbx: 'Ch31_nonPBR.fbx',
    animations: npcClips,
    tags: ['character', 'mixamo', 'npc', 'professional_npc', 'real-file'],
  },
  {
    outputName: 'ch37-npc',
    fbx: 'Ch37_nonPBR.fbx',
    animations: npcClips,
    tags: ['character', 'mixamo', 'npc', 'professional_npc', 'real-file'],
  },
  {
    outputName: 'parasite-starkie',
    fbx: 'Parasite L Starkie.fbx',
    animations: creatureClips,
    tags: ['character', 'mixamo', 'creature', 'b3', 'real-file'],
  },
];

const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const selected = only.length ? jobs.filter((job) => only.includes(job.outputName)) : jobs;
if (only.length && selected.length !== only.length) {
  const known = new Set(jobs.map((job) => job.outputName));
  const missing = only.filter((name) => !known.has(name));
  console.error(`Unknown bake target(s): ${missing.join(', ')}`);
  process.exit(1);
}

const verifyGlbSkinAndClips = (glbAbsPath) => {
  const buf = readFileSync(glbAbsPath);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  const nodes = json.nodes || [];
  const skinNames = new Set((json.skins?.[0]?.joints || []).map((index) => nodes[index]?.name));
  const hipJoint = [...skinNames].find((name) => /hips/i.test(name || ''));
  const clips = (json.animations || []).filter((anim) =>
    /^(Idle|Walk|Jump|SitIdle|SitTalk|PistolIdle|PistolWalk|PistolJump|PistolAim|Draw|Holster|WalkBack|FallingDown|RebornIdle|Attack)$/i.test(anim.name || ''),
  );
  const problems = [];
  if (!hipJoint) problems.push('skin.joints has no Hips');
  for (const anim of clips) {
    const targets = [...new Set((anim.channels || []).map((channel) => nodes[channel.target.node]?.name))];
    const hipTarget = targets.find((name) => /hips/i.test(name || ''));
    if (!hipTarget) problems.push(`${anim.name} has no Hips channel`);
    else if (!skinNames.has(hipTarget)) problems.push(`${anim.name} Hips ${hipTarget} not in skin.joints`);
  }
  return { hipJoint, clipCount: clips.length, problems };
};

let failed = 0;
for (const job of selected) {
  const basePath = path.join(modelsDir, job.fbx);
  console.log(`Baking ${job.outputName} from ${basePath} (${job.animations.map((clip) => clip.name).join(', ')})...`);
  const result = convertCharacterGlb({
    projectRoot,
    outputName: job.outputName,
    basePath,
    animations: job.animations,
    tags: job.tags,
  });
  if (!result.ok) {
    failed += 1;
    console.error(`FAILED ${job.outputName}: ${result.error}`);
    if (result.log) console.error(result.log);
    continue;
  }
  console.log(`Baked ${result.asset.path} with clips: ${result.clipNames.join(', ')}`);
  const jointLine = (result.log || '').split(/\r?\n/).filter((line) =>
    line.includes('Character armature hips')
    || line.includes('Retargeted')
    || line.includes('fcurve0=')
    || line.includes('Rename object')
    || line.includes('Pre-export hip objects')
    || line.includes('Exported hips bone')
    || line.includes('Reversed clip')
    || line.includes('NLA track')
    || line.includes('Unique action')
  );
  jointLine.forEach((line) => console.log(line));
  const glbAbs = path.join(projectRoot, 'assets', 'models', `${job.outputName}.glb`);
  const check = verifyGlbSkinAndClips(glbAbs);
  const expectedHips = (result.log.match(/Character armature hips=(\S+)/) || [])[1];
  console.log(`Verify ${job.outputName} blenderHips=${expectedHips} glbHips=${check.hipJoint} clips=${check.clipCount}`);
  if (!check.hipJoint) {
    check.problems.push('GLB skin has no Hips joint');
  }
  if (check.problems.length) {
    failed += 1;
    console.error(`VERIFY FAILED ${job.outputName}: ${check.problems.join('; ')}`);
  }
}

if (failed) {
  console.error(`Bake finished with ${failed} failure(s).`);
  process.exit(1);
}

console.log('Bake finished successfully.');
