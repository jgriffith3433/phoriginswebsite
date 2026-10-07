import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertCharacterGlb } from './blenderConvert.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const animationsDir = path.join(projectRoot, 'assets', 'animations');

const result = convertCharacterGlb({
  projectRoot,
  outputName: 'ch44-hero',
  basePath: 'C:/Projects/phoriginsassets/models/Ch44_nonPBR.fbx',
  animations: [
    { name: 'Idle', path: path.join(animationsDir, 'Idle.fbx'), projectPath: '/assets/animations/Idle.fbx' },
    { name: 'Walk', path: path.join(animationsDir, 'Walking.fbx'), projectPath: '/assets/animations/Walking.fbx' },
    { name: 'Jump', path: path.join(animationsDir, 'Jump.fbx'), projectPath: '/assets/animations/Jump.fbx' },
    { name: 'SitIdle', path: path.join(animationsDir, 'Sitting Idle.fbx'), projectPath: '/assets/animations/Sitting Idle.fbx' },
    { name: 'SitTalk', path: path.join(animationsDir, 'Sitting Talking.fbx'), projectPath: '/assets/animations/Sitting Talking.fbx' },
  ],
});

if (!result.ok) {
  console.error(result.error);
  if (result.log) console.error(result.log);
  process.exit(1);
}

console.log(`Baked ${result.asset.path} with clips: ${result.clipNames.join(', ')}`);
if (result.log) console.log(result.log);
