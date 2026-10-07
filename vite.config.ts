import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Connect, Plugin, ViteDevServer } from 'vite';
import { defineConfig } from 'vite';
import { resolveBlender } from './tools/resolveBlender.mjs';

// Directories the editor API is allowed to read/write. Keeps file access
// scoped to project content instead of the whole filesystem.
const EDITOR_ROOTS: Record<string, string> = {
  assets: 'assets',
  levels: 'levels',
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
    .filter((entry) => !entry.name.startsWith('.'))
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

    // Converts a source FBX (optionally merging Mixamo animation-only FBX
    // files as named clips) into a GLB via a headless Blender invocation,
    // registers the result in assets/asset-library.json, and returns the
    // new asset descriptor so the editor can place it immediately.
    server.middlewares.use('/api/import-model', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end('Method not allowed');
        return;
      }
      readJsonBody(req)
        .then((body) => {
          res.setHeader('Content-Type', 'application/json');

          const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
          const basePath = typeof body?.basePath === 'string' ? body.basePath.trim() : '';
          const animations: { name: string; path: string }[] = Array.isArray(body?.animations)
            ? body.animations
                .filter((a: any) => a && typeof a.path === 'string' && a.path.trim())
                .map((a: any) => ({ name: String(a.name || '').trim(), path: String(a.path).trim() }))
            : [];

          const safeName = rawName.replace(/[^a-zA-Z0-9_-]/g, '-');
          if (!safeName) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: 'A valid output name is required.' }));
            return;
          }
          if (!basePath || !fs.existsSync(basePath)) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: `Base FBX not found: ${basePath}` }));
            return;
          }
          for (const anim of animations) {
            if (!fs.existsSync(anim.path)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: `Animation FBX not found: ${anim.path}` }));
              return;
            }
          }

          const blender = resolveBlender(process.env.BLENDER_PATH || '');
          if (!blender) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: 'Could not locate a Blender executable on this machine.' }));
            return;
          }

          const outputRelPath = `/assets/models/${safeName}.glb`;
          const outputAbsPath = path.join(root, 'assets', 'models', `${safeName}.glb`);
          fs.mkdirSync(path.dirname(outputAbsPath), { recursive: true });

          const scriptPath = path.join(root, 'tools', 'build_character_glb.py');
          const animArgs = animations.map((a) => (a.name ? `${a.name}=${a.path}` : a.path));
          const blenderArgs = ['-b', '--python', scriptPath, '--', basePath, outputAbsPath, ...animArgs];

          const result = spawnSync(blender, blenderArgs, {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 64,
            timeout: 10 * 60 * 1000,
          });

          const log = `${result.stdout || ''}${result.stderr || ''}`;
          if (result.status !== 0 || !fs.existsSync(outputAbsPath)) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: 'Blender conversion failed.', log }));
            return;
          }

          const libraryRelPath = '/assets/asset-library.json';
          const libraryAbsPath = resolveSafePath(root, libraryRelPath)!;
          let library: { assets?: any[] } = { assets: [] };
          if (fs.existsSync(libraryAbsPath)) {
            try {
              library = JSON.parse(fs.readFileSync(libraryAbsPath, 'utf8'));
            } catch {
              library = { assets: [] };
            }
          }
          if (!Array.isArray(library.assets)) library.assets = [];

          const assetId = `asset-${safeName}`;
          const entry = {
            id: assetId,
            name: `${safeName}.glb`,
            path: outputRelPath,
            type: 'model',
            tags: animations.length ? ['character', 'mixamo', 'real-file'] : ['prop', 'real-file'],
            source: 'project',
          };
          const existingIndex = library.assets.findIndex((a: any) => a.id === assetId);
          if (existingIndex >= 0) library.assets[existingIndex] = entry;
          else library.assets.push(entry);
          fs.writeFileSync(libraryAbsPath, JSON.stringify(library, null, 2), 'utf8');

          res.end(JSON.stringify({ ok: true, asset: entry, clipNames: animations.map((a) => a.name).filter(Boolean), log }));
        })
        .catch((error) => {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: String(error) }));
        });
    });
  },
});

export default defineConfig({
  base: './',
  plugins: [editorApiPlugin()],
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
