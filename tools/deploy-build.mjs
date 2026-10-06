import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const playDir = path.join(rootDir, 'play');
const latestPath = path.join(playDir, 'latest.json');
const launcherPath = path.join(playDir, 'index.html');

fs.mkdirSync(playDir, { recursive: true });

let latest = { build: 0, folder: 'dist_000' };
if (fs.existsSync(latestPath)) {
  try {
    latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  } catch {
    latest = { build: 0, folder: 'dist_000' };
  }
}

const nextBuild = Number.isInteger(latest.build) ? latest.build + 1 : 1;
const folderName = `dist_${String(nextBuild).padStart(3, '0')}`;
const targetDir = path.join(playDir, folderName);

fs.rmSync(targetDir, { recursive: true, force: true });

console.log(`[deploy] Building ${folderName}...`);
const viteCommand = process.platform === 'win32'
  ? path.join(rootDir, 'node_modules', '.bin', 'vite.cmd')
  : path.join(rootDir, 'node_modules', '.bin', 'vite');

try {
  execSync(`"${viteCommand}" build --outDir "${targetDir}"`, {
    cwd: rootDir,
    stdio: 'inherit',
  });
} catch (error) {
  process.exit(error && typeof error === 'object' && 'status' in error ? Number(error.status) || 1 : 1);
}

const launcherHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PH Origins - Launching</title>
    <style>
      :root {
        --bg: #07141e;
        --panel: #0d1a25;
        --line: rgba(255,255,255,0.08);
        --text: #ebf8ff;
        --muted: #9ec1d6;
        --accent: #74d4ff;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        min-height: 100%;
        background: radial-gradient(circle at top, #102637 0%, var(--bg) 60%);
        color: var(--text);
        font-family: Inter, "Segoe UI", sans-serif;
      }
      body {
        min-height: 100vh;
        display: grid;
        place-items: center;
      }
      .card {
        width: min(92vw, 520px);
        padding: 2rem 1.5rem;
        background: rgba(15, 25, 38, 0.85);
        border: 1px solid var(--line);
        border-radius: 18px;
        box-shadow: 0 20px 40px rgba(0,0,0,0.35);
        text-align: center;
      }
      .title {
        margin: 0 0 0.5rem;
        font-size: clamp(1.5rem, 3vw, 2.4rem);
      }
      .meta {
        margin: 0;
        color: var(--muted);
        font-size: 1rem;
      }
      .spinner {
        width: 54px;
        height: 54px;
        margin: 1.5rem auto 0;
        border: 4px solid rgba(255,255,255,0.14);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: spin 0.9s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1 class="title">PH Origins</h1>
      <p class="meta">Launching the latest build...</p>
      <div class="spinner"></div>
    </div>

    <script>
      fetch('./latest.json', { cache: 'no-store' })
        .then((response) => {
          if (!response.ok) throw new Error('Missing latest.json');
          return response.json();
        })
        .then((data) => {
          const folder = data.folder || 'dist_001';
          window.location.replace('./' + folder + '/');
        })
        .catch(() => {
          document.body.innerHTML = '<div class="card"><h1 class="title">Build not found</h1><p class="meta">Run the deploy script first to generate a build.</p></div>';
        });
    </script>
  </body>
</html>
`;

fs.writeFileSync(launcherPath, launcherHtml, 'utf8');

const latestState = {
  build: nextBuild,
  folder: folderName,
  updatedAt: new Date().toISOString(),
};

fs.writeFileSync(latestPath, `${JSON.stringify(latestState, null, 2)}\n`, 'utf8');

console.log(`[deploy] Completed. Latest build: ${folderName}`);
console.log(`[deploy] Launcher updated: ${path.relative(rootDir, launcherPath)}`);
console.log(`[deploy] Open: ${path.relative(rootDir, path.join(playDir, 'index.html'))}`);
