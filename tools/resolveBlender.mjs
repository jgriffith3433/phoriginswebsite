import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Locates a Blender executable on this machine. Checks (in order): an
// explicit override, BLENDER_PATH env var, any versioned install under the
// default Windows "Blender Foundation" Program Files directory, then PATH.
export const resolveBlender = (explicitPath = '') => {
  if (explicitPath && existsSync(explicitPath)) return explicitPath;

  const envPath = process.env.BLENDER_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  const foundationDir = 'C:/Program Files/Blender Foundation';
  if (existsSync(foundationDir)) {
    const versionDirs = readdirSync(foundationDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const dir of versionDirs) {
      const candidate = path.join(foundationDir, dir, 'blender.exe');
      if (existsSync(candidate)) return candidate;
    }
  }

  const macCandidate = '/Applications/Blender.app/Contents/MacOS/Blender';
  if (existsSync(macCandidate)) return macCandidate;

  const where = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['blender'], { encoding: 'utf8' });
  if (where.status === 0) {
    const found = (where.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (found) return found;
  }

  return '';
};
