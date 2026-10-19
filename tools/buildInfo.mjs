// The build every Hawkes Analytics event names (window.HAWKES_BUILD = { version, commit, date }).
// pages.yml passes HAWKES_BUILD_VERSION / _COMMIT / _DATE; a build without them (Studio's beta build, a local one)
// reads the version from releases.json, the commit from git and the date from the clock.
// vite.config.ts defines it into the game (__HAWKES_BUILD__) and writes play/hawkes-build.js for the site pages.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const gitCommit = (root) => {
  try {
    return execSync('git rev-parse --short=12 HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
};

const releaseVersion = (root) => {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(root, 'releases.json'), 'utf8')).current || '');
  } catch {
    return '';
  }
};

let cached = null;

export const buildInfo = (root = process.cwd()) => {
  if (cached) return cached;
  const env = process.env;
  const commit = (env.HAWKES_BUILD_COMMIT || gitCommit(root)).slice(0, 12);
  cached = {
    version: env.HAWKES_BUILD_VERSION || releaseVersion(root) || '0.0.0',
    commit: /^[0-9a-f]{4,40}$/i.test(commit) ? commit : '',
    date: env.HAWKES_BUILD_DATE || new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  };
  return cached;
};
