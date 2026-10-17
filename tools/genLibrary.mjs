// The level editor's Library panel (src/editor/library.ts), on the dev server (vite.config.ts):
//
//   ANY  /api/gen/v1/...          Hawkes Gen's API with this PC's key added here (the panel's web components call it;
//                                 the key never reaches the browser). JSON, files and the live event stream pass through.
//   POST /api/library/import      { only?, dry?, adopt? } assets/models into the library (hawkes.library.json)
//   POST /api/library/export      { only?, dry? } the library's current versions back into assets/models
//
// hawkes.library.json maps one GLB to one entity (characters by name, the rest props); hawkesgen-folders.mjs is a copy
// of hawkesgen/clients/js/hawkesgen-folders.mjs (node C:/Projects/hawkesgen/bin/hawkesgen-sdk.mjs sync).

import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { HawkesGen } from './hawkesgen.mjs';
import { loadMappings, importFolders, exportFolders } from './hawkesgen-folders.mjs';

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });

const countActions = (report) => {
  const n = {};
  for (const r of report) n[r.action] = (n[r.action] ?? 0) + 1;
  return n;
};

export function genLibrary(root) {
  const gen = new HawkesGen({ project: 'phorigins' });
  const mappingFile = path.join(root, 'hawkes.library.json');

  const relay = (req, res) =>
    new Promise((resolve) => {
      // Mounted at /api/gen: req.url is /v1/...
      const target = new URL(req.url || '/', gen.url);
      const headers = {};
      for (const k of ['content-type', 'x-filename', 'accept', 'range']) if (req.headers[k]) headers[k] = req.headers[k];
      if (gen.key) headers.authorization = `Bearer ${gen.key}`;
      const up = (target.protocol === 'https:' ? https : http).request(target, { method: req.method, headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, Object.fromEntries(Object.entries(r.headers).filter(([k]) => !['transfer-encoding', 'connection'].includes(k))));
        r.pipe(res);
        r.on('end', resolve);
      });
      up.on('error', (e) => {
        if (!res.headersSent) send(res, 502, { error: `Hawkes Gen: ${e.message}. Start it: C:\\Projects\\hawkesgen\\auto-start.bat` });
        resolve();
      });
      // The browser left (an event stream closed): stop asking Gen. (req's own 'close' fires once its body is read.)
      res.on('close', () => up.destroy());
      req.pipe(up);
    });

  const folders = (what) => async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    try {
      const b = await readJson(req);
      const report = [];
      for (const m of loadMappings(mappingFile)) {
        const opts = { only: b.only || undefined, dry: !!b.dry };
        report.push(...(what === 'import' ? await importFolders(gen, m, { ...opts, adopt: !!b.adopt }) : await exportFolders(gen, m, opts)));
      }
      send(res, 200, { report, counts: countActions(report) });
    } catch (e) {
      send(res, e.status === 0 ? 502 : 500, { error: e.message });
    }
  };

  return { relay, importFolders: folders('import'), exportFolders: folders('export') };
}
