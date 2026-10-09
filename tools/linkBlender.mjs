import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveBlender } from './resolveBlender.mjs';

const MCP_PORT = 9876;
const ENABLE_SCRIPT = `import addon_utils
import bpy
addon_utils.enable("blender_mcp", default_set=True, persistent=True)
bpy.ops.wm.save_userpref()
print("PH_ORIGINS_BLENDER_LINKED")
`;

let inFlight = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const portOpen = (port) => new Promise((resolve) => {
  const socket = net.connect({ host: '127.0.0.1', port });
  const finish = (open) => {
    socket.removeAllListeners();
    socket.destroy();
    resolve(open);
  };
  socket.setTimeout(400);
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false));
  socket.once('error', () => finish(false));
});

const blenderConfigVersion = (blenderExe) => {
  const match = String(blenderExe).match(/Blender[ _]?(\d+\.\d+)/i);
  return match ? match[1] : '';
};

const addonPaths = (blenderExe) => {
  const version = blenderConfigVersion(blenderExe);
  if (!version) return { file: '', dir: '' };
  let dir = '';
  if (process.platform === 'win32' && process.env.APPDATA) {
    dir = path.join(process.env.APPDATA, 'Blender Foundation', 'Blender', version, 'scripts', 'addons');
  } else if (process.platform === 'darwin' && process.env.HOME) {
    dir = path.join(process.env.HOME, 'Library', 'Application Support', 'Blender', version, 'scripts', 'addons');
  } else if (process.env.HOME) {
    dir = path.join(process.env.HOME, '.config', 'blender', version, 'scripts', 'addons');
  }
  if (!dir) return { file: '', dir: '' };
  return { file: path.join(dir, 'blender_mcp.py'), dir };
};

const resolveUvx = () => {
  const candidates = [];
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'uvx.exe'));
    }
    if (process.env.USERPROFILE) candidates.push(path.join(process.env.USERPROFILE, '.local', 'bin', 'uvx.exe'));
  } else if (process.env.HOME) {
    candidates.push(path.join(process.env.HOME, '.local', 'bin', 'uvx'));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const where = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['uvx'], { encoding: 'utf8', windowsHide: true });
  if (where.status === 0) {
    const found = (where.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (found) return found;
  }
  return '';
};

const blenderIsRunning = () => {
  try {
    if (process.platform === 'win32') {
      const listed = spawnSync('tasklist', ['/FI', 'IMAGENAME eq blender.exe', '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      return /blender\.exe/i.test(listed.stdout || '');
    }
    const listed = spawnSync('pgrep', ['-x', 'blender'], { encoding: 'utf8' });
    return Boolean((listed.stdout || '').trim());
  } catch {
    return false;
  }
};

const installAddon = (uvx, addonsDir) => {
  const args = ['mcp-for-blender', 'install-addon'];
  if (addonsDir) args.push('--addons-dir', addonsDir);
  const result = spawnSync(uvx, args, {
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  return `${result.stdout || ''}\n${result.stderr || ''}\n${result.error ? String(result.error) : ''}`.trim();
};

const waitForPort = async (port, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true;
    await sleep(500);
  }
  return portOpen(port);
};

const launchBlender = (blenderExe) => {
  const scriptPath = path.join(tmpdir(), 'ph-origins-link-blender.py');
  writeFileSync(scriptPath, ENABLE_SCRIPT, 'utf8');
  const child = spawn(blenderExe, ['--python', scriptPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
};

const linkBlenderOnce = async () => {
  if (await portOpen(MCP_PORT)) {
    return {
      ok: true,
      linked: true,
      already: true,
      message: 'Blender is already linked (localhost:9876).',
    };
  }

  const blender = resolveBlender();
  if (!blender) {
    return { ok: false, error: 'Blender was not found. Install Blender, or set BLENDER_PATH to blender.exe.' };
  }

  const uvx = resolveUvx();
  if (!uvx) {
    return { ok: false, error: 'uv is not installed. Install it with winget install astral-sh.uv, then press Link Blender again.' };
  }

  const { file: addonFile, dir: addonsDir } = addonPaths(blender);
  let installed = false;
  if (!addonFile || !existsSync(addonFile)) {
    const output = installAddon(uvx, addonsDir);
    installed = Boolean(addonFile && existsSync(addonFile));
    if (!installed) {
      return {
        ok: false,
        error: output || 'Could not install the Blender MCP addon.',
      };
    }
  }

  if (blenderIsRunning()) {
    return {
      ok: false,
      installed,
      error: 'Blender is open, but the MCP server is not listening. Press N in that window, open MCP for Blender, and start the server. Or close Blender and press Link Blender again.',
    };
  }

  launchBlender(blender);
  const linked = await waitForPort(MCP_PORT, 45000);
  if (!linked) {
    return {
      ok: false,
      installed,
      error: 'Blender started, but nothing is listening on localhost:9876 yet. Check the Blender console for an addon error.',
    };
  }

  return {
    ok: true,
    linked: true,
    started: true,
    installed,
    message: installed
      ? 'Installed the MCP addon and started Blender. Listening on localhost:9876.'
      : 'Started Blender. Listening on localhost:9876.',
  };
};

export const linkBlender = () => {
  if (!inFlight) {
    inFlight = linkBlenderOnce().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
};
