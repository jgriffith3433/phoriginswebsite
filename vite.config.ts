import fs from 'node:fs';
import path from 'node:path';
import type { Connect, Plugin, ViteDevServer } from 'vite';
import { defineConfig } from 'vite';
import { convertCharacterGlb, inferClipName } from './tools/blenderConvert.mjs';

// Directories the editor API is allowed to read/write. Keeps file access
// scoped to project content instead of the whole filesystem.
const EDITOR_ROOTS: Record<string, string> = {
  assets: 'assets',
  levels: 'levels',
  cutscenes: 'cutscenes',
};

type FsTreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  children?: FsTreeNode[];
};

const buildTree = (absDir: string, relDir: string): FsTreeNode[] => {
  if (!fs.existsSync(absDir)) return [];
  return fs
    .readdirSync(absDir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && !entry.name.toLowerCase().endsWith('.fbx'))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map((entry) => {
      const absPath = path.join(absDir, entry.name);
      const relPath = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        return { name: entry.name, path: relPath, isDir: true, children: buildTree(absPath, relPath) };
      }
      return { name: entry.name, path: relPath, isDir: false };
    });
};

const readJsonBody = (req: Connect.IncomingMessage): Promise<any> =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });

const readBinaryBody = (req: Connect.IncomingMessage, maxBytes = 120 * 1024 * 1024): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('File too large to import.'));
        req.destroy();
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const toAbsAssetPath = (root: string, maybeRel: string): string => {
  if (maybeRel.startsWith('/assets/')) return path.join(root, maybeRel.slice(1));
  return maybeRel;
};

const sendJson = (res: any, status: number, payload: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
};

// Resolves a project-relative path (e.g. "/levels/starter-arena.json") to an
// absolute path, rejecting anything that escapes the allowed editor roots.
const resolveSafePath = (root: string, relativePath: string): string | null => {
  const [, rootKey] = relativePath.split('/');
  if (!rootKey || !EDITOR_ROOTS[rootKey]) return null;
  const resolved = path.normalize(path.join(root, relativePath));
  const allowedRoot = path.normalize(path.join(root, EDITOR_ROOTS[rootKey]));
  if (!resolved.startsWith(allowedRoot)) return null;
  return resolved;
};

// Dev-only middleware that lets the level editor browse assets/levels on
// disk and save scene JSON directly back to the project files.
const editorApiPlugin = (): Plugin => ({
  name: 'ph-origins-editor-api',
  configureServer(server: ViteDevServer) {
    const root = server.config.root;

    server.middlewares.use((req, res, next) => {
      const urlPath = (req.url || '').split('?')[0];
      if (req.method !== 'GET' || !urlPath.startsWith('/cutscenes/')) {
        next();
        return;
      }
      const abs = resolveSafePath(root, urlPath);
      if (!abs || !fs.existsSync(abs)) {
        res.statusCode = 404;
        res.end('Cutscene not found');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(fs.readFileSync(abs, 'utf8'));
    });

    server.middlewares.use('/api/tree', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      const tree: Record<string, FsTreeNode[]> = {};
      for (const [key, dir] of Object.entries(EDITOR_ROOTS)) {
        tree[key] = buildTree(path.join(root, dir), `/${dir}`);
      }
      res.end(JSON.stringify(tree));
    });

    server.middlewares.use('/api/save-json', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end('Method not allowed');
        return;
      }
      readJsonBody(req)
        .then((body) => {
          const targetPath = typeof body?.path === 'string' ? resolveSafePath(root, body.path) : null;
          if (!targetPath || typeof body?.data === 'undefined') {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid path or data' }));
            return;
          }
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.writeFileSync(targetPath, JSON.stringify(body.data, null, 2), 'utf8');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        })
        .catch((error) => {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: String(error) }));
        });
    });

    const runConvert = (options: {
      basePath: string;
      outputName: string;
      animations: { name: string; path: string; projectPath?: string }[];
      tags?: string[];
    }) => convertCharacterGlb({ projectRoot: root, ...options });

    const loadLibraryAssets = (): any[] => {
      const libraryAbsPath = path.join(root, 'assets', 'asset-library.json');
      try {
        const parsed = JSON.parse(fs.readFileSync(libraryAbsPath, 'utf8'));
        return Array.isArray(parsed?.assets) ? parsed.assets : [];
      } catch {
        return [];
      }
    };

    // Path-based convert (Import Model dialog): base FBX on disk plus optional
    // Mixamo animation-only FBX clips, baked into one GLB.
    server.middlewares.use('/api/import-model', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end('Method not allowed');
        return;
      }
      readJsonBody(req)
        .then((body) => {
          const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
          const basePath = typeof body?.basePath === 'string' ? body.basePath.trim() : '';
          const animations = Array.isArray(body?.animations)
            ? body.animations
                .filter((a: any) => a && typeof a.path === 'string' && a.path.trim())
                .map((a: any) => ({ name: String(a.name || '').trim(), path: String(a.path).trim() }))
            : [];
          const result = runConvert({ outputName: rawName, basePath, animations });
          sendJson(res, result.ok ? 200 : 400, result);
        })
        .catch((error) => sendJson(res, 400, { ok: false, error: String(error) }));
    });

    // Drag-drop convert: the browser uploads FBX bytes. Animation-only files
    // are stored under assets/animations and re-baked onto a character GLB.
    server.middlewares.use('/api/import-fbx', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end('Method not allowed');
        return;
      }
      const url = new URL(req.url || '', 'http://localhost');
      const mode = url.searchParams.get('mode') === 'animation' ? 'animation' : 'character';
      const requestedName = (url.searchParams.get('name') || '').trim();
      const targetName = (url.searchParams.get('target') || 'ch33-hero').trim();
      const headerName = String(req.headers['x-file-name'] || '');
      const fileName = path.basename(headerName || `${requestedName || 'clip'}.fbx`);

      readBinaryBody(req)
        .then((buffer) => {
          if (!buffer.length) {
            sendJson(res, 400, { ok: false, error: 'No FBX data received.' });
            return;
          }

          if (mode === 'character') {
            const outputName = requestedName || fileName.replace(/\.fbx$/i, '');
            const sourceRel = `/assets/source/${outputName.replace(/[^a-zA-Z0-9_-]/g, '-')}.fbx`;
            const sourceAbs = resolveSafePath(root, sourceRel);
            if (!sourceAbs) {
              sendJson(res, 400, { ok: false, error: 'Invalid source path.' });
              return;
            }
            fs.mkdirSync(path.dirname(sourceAbs), { recursive: true });
            fs.writeFileSync(sourceAbs, buffer);
            sendJson(res, 200, runConvert({ outputName, basePath: sourceAbs, animations: [] }));
            return;
          }

          const clipName = requestedName || inferClipName(fileName);
          const animRel = `/assets/animations/${clipName.replace(/[^a-zA-Z0-9_-]/g, '-')}.fbx`;
          const animAbs = resolveSafePath(root, animRel);
          if (!animAbs) {
            sendJson(res, 400, { ok: false, error: 'Invalid animation path.' });
            return;
          }
          fs.mkdirSync(path.dirname(animAbs), { recursive: true });
          fs.writeFileSync(animAbs, buffer);

          const assets = loadLibraryAssets();
          const targetId = targetName.startsWith('asset-') ? targetName : `asset-${targetName}`;
          const target = assets.find((asset) => asset.id === targetId) ?? assets.find((asset) => asset.id === 'asset-ch33-hero');
          const rawSource = typeof target?.sourceFbx === 'string'
            ? target.sourceFbx
            : 'C:/Projects/phoriginsassets/models/Ch33_nonPBR.fbx';
          const basePath = toAbsAssetPath(root, rawSource);
          if (!fs.existsSync(basePath)) {
            sendJson(res, 400, {
              ok: false,
              error: 'Character source FBX not found. Import the skinned character first, then drop animation-only clips.',
            });
            return;
          }

          const existing: { name: string; path: string; projectPath?: string }[] = Array.isArray(target?.animations)
            ? target.animations
                .filter((anim: any) => anim && anim.name && anim.path && anim.name !== clipName)
                .map((anim: any) => ({
                  name: String(anim.name),
                  path: toAbsAssetPath(root, String(anim.path)),
                  projectPath: String(anim.path),
                }))
            : [];
          existing.push({ name: clipName, path: animAbs, projectPath: animRel });

          const outputName = (target?.name || 'ch33-hero').replace(/\.glb$/i, '');
          sendJson(res, 200, runConvert({ outputName, basePath, animations: existing }));
        })
        .catch((error) => sendJson(res, 400, { ok: false, error: String(error) }));
    });
  },
});

export default defineConfig({
  base: './',
  plugins: [
    editorApiPlugin(),
    {
      name: 'copy-cutscenes',
      closeBundle() {
        const from = path.join(process.cwd(), 'cutscenes');
        const to = path.join(process.cwd(), 'play', 'cutscenes');
        if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true });
      },
    },
  ],
  build: {
    outDir: 'play',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: 'game.html',
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
