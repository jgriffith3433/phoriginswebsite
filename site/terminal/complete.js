// Tab completion for commands and paths. Pure: (shell, line) -> { line, options }.

import { COMMANDS, THEMES } from './shell.js';
import { GUIDE } from './content.js';

const PATH_CMDS = new Set(['ls', 'cd', 'cat', 'less', 'more', 'tree', 'grep', 'head', 'tail', 'wc', 'sort', 'strings', 'rev', 'john', 'open']);

function common(list) {
  if (!list.length) return '';
  let p = list[0];
  for (const s of list) { while (!s.startsWith(p)) p = p.slice(0, -1); }
  return p;
}

/** Path completion for the word `word` (may include ~ and a directory part). */
function completePath(sh, word, dirsOnly) {
  const slash = word.lastIndexOf('/');
  const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
  const base = slash >= 0 ? word.slice(slash + 1) : word;
  const abs = sh.vfs.resolve(sh.cwd, dirPart || '.', sh.user);
  const entries = sh.vfs.list(abs);
  if (!entries) return [];
  return Object.keys(entries)
    .filter((n) => n.startsWith(base) && (base.startsWith('.') || !n.startsWith('.')))
    .filter((n) => !dirsOnly || entries[n].type === 'dir')
    .sort()
    .map((n) => `${dirPart}${n}${entries[n].type === 'dir' ? '/' : ''}`);
}

export function complete(sh, line) {
  if (sh.mode) return { line, options: [] };
  // The guide's next command is always one Tab away: an empty line, or any start of it, completes to the whole thing.
  const cur = sh.puzzle.current;
  if (cur && !sh.isRoot) {
    const next = GUIDE[cur].cmd;
    const t = line.trimStart();
    if (t === '' || (t.length >= 2 && next.startsWith(t) && t !== next)) return { line: next, options: [] };
  }
  const m = line.match(/^(\s*)(\S*)$/);
  if (m) {
    // first word: command names (keeping a leading slash)
    const slash = m[2].startsWith('/') && !m[2].slice(1).includes('/');
    const prefix = slash ? m[2].slice(1) : m[2];
    if (m[2].includes('/') && !slash) {
      const opts = completePath(sh, m[2], false);
      return finish(line, m[1], m[2], opts);
    }
    const names = Object.keys(COMMANDS).filter((n) => !COMMANDS[n].hidden || n === 'konami').filter((n) => n.startsWith(prefix));
    const opts = names.map((n) => (slash ? `/${n}` : n));
    return finish(line, m[1], m[2], opts, true);
  }
  const words = line.split(/\s+/);
  const last = words[words.length - 1];
  const head = line.slice(0, line.length - last.length);
  const cmd = (words[0] || '').replace(/^\//, '');
  let opts = [];
  if (cmd === 'man' || cmd === 'help') opts = Object.keys(COMMANDS).filter((n) => n.startsWith(last) && !COMMANDS[n].hidden);
  else if (cmd === 'theme') opts = THEMES.filter((t) => t.startsWith(last));
  else if (cmd === 'sound') opts = ['on', 'off'].filter((t) => t.startsWith(last));
  else if (cmd === 'cd') opts = completePath(sh, last, true);
  else if (cmd === 'open') opts = ['about', 'characters', 'lore', 'whatsnew', 'game'].filter((t) => t.startsWith(last));
  else if (PATH_CMDS.has(cmd) || words.length > 1) opts = completePath(sh, last, false);
  return finish(line, head, last, opts);
}

function finish(line, head, word, opts, command = false) {
  if (!opts.length) return { line, options: [] };
  const done = opts.length === 1;
  const base = done ? opts[0] : common(opts);
  const tail = done && !base.endsWith('/') ? ' ' : '';
  const prefix = command ? head : line.slice(0, line.length - word.length);
  return { line: `${prefix}${base}${tail}`, options: done ? [] : opts };
}
