import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'play');

const redirectHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0; url=./game.html" />
    <title>PH Origins 3D</title>
  </head>
  <body>
    <p>Loading PH Origins 3D...</p>
  </body>
</html>
`;

const sourceFiles = [
  ['manifest.webmanifest', 'manifest.webmanifest'],
  ['favicon.svg', 'favicon.svg'],
];

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), redirectHtml, 'utf8');

for (const [src, dest] of sourceFiles) {
  const sourcePath = path.join(root, src);
  const targetPath = path.join(outDir, dest);
  if (!fs.existsSync(sourcePath)) {
    if (src === 'favicon.svg') continue;
    throw new Error(`Missing source file for postbuild: ${src}`);
  }
  fs.copyFileSync(sourcePath, targetPath);
}

console.log('Created static redirect page and assets for GitHub Pages preview.');
