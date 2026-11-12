// The shell: state, dispatch, input modes (password, pager, confirm) and every command. Pure logic: it returns
// "effects" (print, seq, clear, go...) and the UI draws them. Nothing here touches the DOM, the network or eval.

import { parseLine, suggest } from './parser.js';
import { VFS, USERS, modeOf } from './fs.js';
import { Puzzle } from './puzzle.js';
import { runBuild, mergeBuilt, isComplete, MODULES, VERSION } from './build.js';
import { STEPS, GUIDE, MOTD, MOTD_ART, MOTD_TEXT, FORTUNES, TARGET_HOST, OPS_PASSWORD, GW_STRINGS, GW_BACKUP_NAME } from './content.js';
import { rng, pad, lpad, bar, reverse, hex } from './util.js';

const P = (text, cls) => ({ k: 'print', text, cls });
const SEQ = (steps) => ({ k: 'seq', steps });
const text = (effects) => effects.filter((e) => e.k === 'print').map((e) => e.text).join('\n');

export const THEMES = ['green', 'amber', 'white'];
export const ROOT_ONLY = ['build', 'status', 'deploy', 'logs', 'services', 'rollback'];
const SITE_PAGES = { about: './about.html', characters: './characters.html', lore: './lore.html', whatsnew: './whatsnew.html', game: './play/game.html' };
const LORE_SLUGS = ['the-apex-peak', 'b3', 'the-return', 'the-desk', 'going-home', 'the-station', 'the-train', 'the-morning'];

const FAILS = [
  'Permission denied, please try again.',
  'Permission denied. The gateway raises one eyebrow.',
  'Nope. Nice try, though. Genuinely.',
  'Authentication failed. The hat did not move.',
  'That was a guess. Guesses are not credentials.',
  'Access denied. Somewhere, an intern giggles.',
];

export class Shell {
  /** @param {{ load?: () => object|null, save?: (o:object) => void, now?: () => number }} [opts] */
  constructor(opts = {}) {
    this.store = { load: opts.load || (() => null), save: opts.save || (() => {}) };
    this.now = opts.now || (() => Date.now());
    this.vfs = new VFS();
    this.mode = null;
    this.history = [];
    this.fails = 0;
    this.lockUntil = 0;
    this.suFails = 0;
    this.#load(this.store.load() || {});
  }

  #load(s) {
    this.puzzle = new Puzzle(s.puzzle || {});
    this.vfs.built = s.built || null;
    this.theme = THEMES.includes(s.theme) ? s.theme : 'green';
    this.sound = !!s.sound;
    this.deployed = s.deployed || null;
    // Root is saved only if the chain really finished.
    this.user = s.root && this.puzzle.root ? 'root' : 'guest';
    this.cwd = this.user === 'root' ? '/' : USERS[this.user].home;
    this.syncLoot();
  }

  #save() {
    this.store.save({ puzzle: this.puzzle.save(), root: this.user === 'root', built: this.vfs.built, theme: this.theme, sound: this.sound, deployed: this.deployed });
  }

  syncLoot() {
    const loot = this.vfs.node('/home/guest/loot');
    if (loot && this.puzzle.has('loot')) {
      loot.children[GW_BACKUP_NAME] = { type: 'file', binary: true, strings: GW_STRINGS, owner: 'guest', mode: '-rw-r--r--', content: '' };
    }
  }

  get isRoot() { return this.user === 'root'; }
  get host() { return 'ph-origins'; }

  cwdLabel() {
    const home = USERS[this.user].home;
    if (this.cwd === home) return '~';
    if (this.cwd.startsWith(`${home}/`)) return `~${this.cwd.slice(home.length)}`;
    return this.cwd;
  }

  prompt() {
    if (this.mode) return this.mode.prompt;
    const ctx = this.user === 'ops' ? 'ops@ph-origins' : `${this.user}@${this.host}`;
    return `${ctx}:${this.cwdLabel()}${this.isRoot ? '#' : '$'}`;
  }

  commandNames() { return Object.keys(COMMANDS).filter((n) => !COMMANDS[n].hidden); }

  boot() {
    const now = new Date(this.now());
    return [
      P(MOTD_ART, 'art motd'),
      P(MOTD_TEXT, 'motd'),
      P(`Last login: ${now.toUTCString().slice(0, 16)} from 10.58.0.99   [guest]`, 'dim'),
      P(this.isRoot ? 'Welcome back, root. The backend is waiting.' : 'Type  /help  to begin: the LOGIN GUIDE tells you the next command.', 'dim'),
    ];
  }

  // ---- input
  run(line) {
    if (this.mode) {
      const m = this.mode;
      this.mode = null;
      return m.handler(line.trim(), this);
    }
    const raw = line.trim();
    if (!raw) return [];
    if (this.history[this.history.length - 1] !== raw) this.history.push(raw);
    const phrase = raw.replace(/^\//, '').toLowerCase().replace(/\s+/g, ' ');
    if (phrase === 'sudo make me a sandwich') return this.#sandwich();
    if (/^(sudo )?rm -rf( --no-preserve-root)? \/\*?$/.test(phrase)) return this.#rmrf();
    if (phrase === 'hack the planet' || phrase === 'hack the planet!') return this.#planet();
    const cmds = parseLine(raw);
    if (!cmds.length) return [];
    let stdin = null;
    let out = [];
    for (const [i, c] of cmds.entries()) {
      out = this.#exec(c, stdin);
      if (i < cmds.length - 1) {
        if (out.some((e) => e.k === 'seq')) return [...out, P('(pipes only take plain text: this one streams)', 'warn')];
        stdin = text(out);
      }
    }
    this.#save();
    return out;
  }

  #exec(c, stdin) {
    const def = COMMANDS[c.cmd];
    if (!def) {
      const near = suggest(c.cmd, [...this.commandNames(), ...Object.keys(COMMANDS).filter((n) => COMMANDS[n].hidden)].filter((n) => !COMMANDS[n].secret));
      const tip = near.length ? `\nDid you mean: ${near.join(', ')}?` : '\nTry  help.';
      return [P(`${c.cmd}: command not found${tip}`, 'err')];
    }
    if (def.root && !this.isRoot) {
      const cur = this.puzzle.current;
      return [P(`${c.cmd}: permission denied (${this.user}). Only root can run this. ${cur ? `Next login step: ${GUIDE[cur].cmd}` : 'Log in as root first.'}`, 'err')];
    }
    const res = def.run(this, c.args, stdin);
    return typeof res === 'string' ? [P(res)] : (res || []);
  }

  // ---- modes
  ask(prompt, handler, extra = {}) {
    this.mode = { prompt, handler, ...extra };
  }

  throttle() { return Math.max(0, Math.ceil((this.lockUntil - this.now()) / 1000)); }

  failAuth(what) {
    this.fails += 1;
    this.lockUntil = this.now() + Math.min(5000, 800 + this.fails * 900);
    const msg = FAILS[(this.fails - 1) % FAILS.length];
    const lines = [P(msg, 'err')];
    if (this.fails >= 3) lines.push(P(`(${what}: the gateway makes you wait ${this.throttle()}s. brute force is slow here, by design.)`, 'dim'));
    if (this.fails >= 4) lines.push(P('hint: no guessing needed. type  /help  for the exact next command.', 'dim'));
    return lines;
  }

  grantRoot(how) {
    if (!this.puzzle.complete('root')) return [P('permission denied: you have not earned this yet.', 'err')];
    this.user = 'root';
    this.cwd = '/';
    this.#save();
    const steps = [];
    let at = 0;
    const add = (t, cls, wait = 90) => { at += wait; steps.push({ at, text: t, cls }); };
    add(how, 'dim', 0);
    add('uid=0(root) gid=0(root) groups=0(root)', '', 300);
    add('', '', 150);
    add('ACCESS GRANTED', 'banner big', 260);
    add('', '', 80);
    add('Welcome, root. The prompt is red now. It suits you.', 'ok', 380);
    add('New commands:  /build  /status  /services  /logs  /deploy  /rollback  /whoami --root', 'ok', 220);
    add('Start with  /build  - the medical backend is waiting for its first assembly.', 'ok', 220);
    return [{ k: 'granted' }, SEQ(steps)];
  }

  // ---- easter eggs
  #sandwich() {
    this.puzzle.award('sandwich');
    this.#save();
    return [P(this.isRoot ? 'Okay.' : 'What? Make it yourself.', this.isRoot ? 'ok' : 'err'), P(this.isRoot ? '  ( o_o)  [=======]  one sandwich, assembled in 0.4 s. no patient data.' : '', 'dim')];
  }

  #rmrf() {
    this.puzzle.award('rmrf');
    this.#save();
    return [P('rm: it is dangerous to operate recursively on "/"', 'err'), P('rm: use --no-preserve-root to override this failsafe', 'err'), P('... you did not. good. (this box would just laugh anyway.)', 'dim')];
  }

  #planet() {
    this.puzzle.award('planet');
    this.#save();
    return [SEQ([
      { at: 0, text: 'HACK THE PLANET!', cls: 'banner' },
      { at: 350, text: '  .-.  ', cls: 'ok' }, { at: 450, text: ' (   ) the planet has been notified.', cls: 'ok' }, { at: 550, text: "  `-'  it is mostly water.", cls: 'ok' },
    ])];
  }

  konami() {
    const first = this.puzzle.award('konami');
    this.#save();
    return [P(first ? '+30 LIVES. (cheat codes work on guests only. this one does not open anything. nice reflexes.)' : 'You have done that already. 30 lives is plenty.', 'ok')];
  }

  resolvePage(arg) {
    if (!arg) return null;
    let a = arg.replace(/^~?\/?(home\/guest\/)?site\//, '').replace(/^\.\//, '').replace(/\.html$/, '');
    if (a.startsWith('lore/')) { const slug = a.slice(5); return LORE_SLUGS.includes(slug) ? `./lore/${slug}.html` : null; }
    return SITE_PAGES[a] ?? null;
  }

  reset() {
    this.store.save(null);
    this.vfs = new VFS();
    this.mode = null;
    this.fails = 0;
    this.lockUntil = 0;
    this.suFails = 0;
    this.#load({});
  }

  save() { this.#save(); }
}

// ------------------------------------------------------------------ commands

const path = (sh, p) => sh.vfs.resolve(sh.cwd, p, sh.user);
const denied = (name, why = 'Permission denied') => [P(`${name}: ${why}`, 'err')];

function readNode(sh, name, abs) {
  const n = sh.vfs.node(abs);
  if (!n) return { err: `${name}: No such file or directory` };
  if (n.type === 'dir') return { err: `${name}: Is a directory` };
  if (!sh.vfs.canRead(n, sh.user)) return { err: `${name}: Permission denied` };
  return { n, content: contentOf(sh, n) };
}

function contentOf(sh, n) {
  if (n.dynamic === 'motd') return MOTD;
  if (n.dynamic === 'achievements') return achievements(sh).join('\n') + '\n';
  if (n.dynamic === 'buildlog') return buildLog(sh).join('\n') + '\n';
  return n.content ?? '';
}

function achievements(sh) {
  const p = sh.puzzle;
  const lines = ['ACHIEVEMENTS', ''];
  for (const s of STEPS) lines.push(`  [${p.has(s.id) ? 'x' : ' '}] ${s.title}`);
  const extra = { konami: 'Thirty lives (konami)', sandwich: 'Make it yourself (sandwich)', planet: 'Hack the planet', rmrf: 'Famous last words (rm -rf /)', built: 'It is online (first /build)' };
  lines.push('');
  for (const [k, v] of Object.entries(extra)) lines.push(`  [${p.extra.includes(k) ? 'x' : ' '}] ${v}`);
  lines.push('', `  hints used: ${p.hintsUsed}`);
  return lines;
}

function buildLog(sh) {
  const b = sh.vfs.built;
  if (!b) return ['(no build yet)'];
  const r = rng(b.seed);
  const lines = [];
  for (const m of b.modules) lines.push(`${String(10 + r.int(0, 2))}:${String(r.int(10, 59))}:${String(r.int(10, 59))} build  ${pad(m.id, 16)} compiled ${m.files} files, ${m.tests} tests passed`);
  lines.push(`build ${b.hash} SUCCESS`);
  return lines;
}

function listDir(sh, abs, flags) {
  const entries = sh.vfs.list(abs) || {};
  let names = Object.keys(entries).sort((a, b) => a.localeCompare(b));
  if (!flags.a) names = names.filter((n) => !n.startsWith('.'));
  if (flags.a) names = ['.', '..', ...names];
  if (flags.l) {
    return names.map((n) => {
      const e = n === '.' || n === '..' ? sh.vfs.node(abs) : entries[n];
      const size = e.type === 'dir' ? 4096 : contentOf(sh, e).length || (e.strings ? 412 : 0);
      return `${modeOf(e)} 1 ${pad(e.owner || 'root', 6)} ${pad(e.owner || 'root', 6)} ${lpad(size, 5)} Nov 12 03:14 ${n}${e.type === 'dir' ? '/' : ''}`;
    }).join('\n');
  }
  return names.map((n) => `${n}${n !== '.' && n !== '..' && entries[n].type === 'dir' ? '/' : ''}`).join('  ');
}

function flagsOf(args) {
  const flags = {};
  const rest = [];
  for (const a of args) {
    if (/^-[a-zA-Z]+$/.test(a)) for (const c of a.slice(1)) flags[c] = true;
    else if (a.startsWith('--')) flags[a.slice(2)] = true;
    else rest.push(a);
  }
  return { flags, rest };
}

function treeLines(sh, abs, prefix, depth, showHidden) {
  const entries = sh.vfs.list(abs) || {};
  const names = Object.keys(entries).filter((n) => showHidden || !n.startsWith('.')).sort();
  const out = [];
  names.forEach((n, i) => {
    const last = i === names.length - 1;
    const e = entries[n];
    out.push(`${prefix}${last ? '└── ' : '├── '}${n}${e.type === 'dir' ? '/' : ''}`);
    if (e.type === 'dir' && depth > 1) out.push(...treeLines(sh, `${abs === '/' ? '' : abs}/${n}`, prefix + (last ? '    ' : '│   '), depth - 1, showHidden));
  });
  return out;
}

function grepFiles(sh, abs, pat, flags, display) {
  const n = sh.vfs.node(abs);
  if (!n) return [`grep: ${display}: No such file or directory`];
  if (n.type === 'dir') {
    if (!flags.r) return [`grep: ${display}: Is a directory`];
    const out = [];
    for (const name of Object.keys(sh.vfs.list(abs)).sort()) out.push(...grepFiles(sh, `${abs === '/' ? '' : abs}/${name}`, pat, flags, `${display.replace(/\/$/, '')}/${name}`));
    return out;
  }
  if (!sh.vfs.canRead(n, sh.user) || n.binary) return [];
  return matchLines(contentOf(sh, n), pat, flags).map((l) => `${flags.H ? `${display}:` : ''}${l}`);
}

function matchLines(src, pat, flags) {
  let re;
  try { re = new RegExp(pat, flags.i ? 'i' : ''); } catch { re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags.i ? 'i' : ''); }
  const out = [];
  src.split('\n').forEach((line, i) => { if (line !== '' && (re.test(line) !== !!flags.v)) out.push(`${flags.n ? `${i + 1}:` : ''}${line}`); });
  return out;
}

const COW = (msg) => {
  const lines = String(msg).match(/.{1,34}(\s|$)/g)?.map((l) => l.trim()) ?? [String(msg)];
  const w = Math.max(...lines.map((l) => l.length));
  return [` ${'_'.repeat(w + 2)}`, ...lines.map((l) => `| ${pad(l, w)} |`), ` ${'-'.repeat(w + 2)}`, '        \\   ^__^', '         \\  (oo)\\_______', '            (__)\\       )\\/\\', '                ||----w |', '                ||     ||'].join('\n');
};

const FAKE_PS = ['  PID TTY          TIME CMD', '    1 ?        00:00:00 init', '   58 ?        00:00:02 hawkes-gw-stub', '  212 ?        00:00:00 gw-watcher', '  301 ?        00:00:00 cron', '  409 ?        00:00:00 sshd', ' 1058 pts/0    00:00:00 sh', ' 1059 pts/0    00:00:00 ps'];
const FAKE_TOP = [
  'top - 03:14:15 up 58 days,  3:14,  1 user,  load average: 0.58, 0.42, 0.30',
  'Tasks:  8 total,   1 running,   7 sleeping,   0 stopped',
  '%Cpu(s):  2.8 us,  0.6 sy,  0.0 ni, 96.4 id',
  'MiB Mem :   5808.0 total,   4012.5 free,    910.2 used',
  '',
  '  PID USER      PR  NI    VIRT    RES  %CPU  %MEM COMMAND',
  '   58 root      20   0  120460  22180   1.2   0.4 hawkes-gw-stub',
  '  212 root      20   0   31020   8040   0.4   0.1 gw-watcher',
  '  409 root      20   0   16004   5230   0.0   0.1 sshd',
  '  301 root      20   0    9404   2120   0.0   0.0 cron',
  '    1 root      20   0    4380   1180   0.0   0.0 init',
  '',
  '(a snapshot. press q: there is nothing to press q on.)',
];

/** The LOGIN GUIDE block: which step, the exact next command, what it does. */
export function guideLines(sh) {
  const cur = sh.puzzle.current;
  if (!cur) return ['LOGIN GUIDE', '  All 5 steps done. You are root.', '  Next: /build', ''];
  const n = STEPS.findIndex((s) => s.id === cur) + 1;
  const g = GUIDE[cur];
  return ['LOGIN GUIDE', `  Step ${n} of ${STEPS.length}: ${STEPS[n - 1].title}`, `  Type:  ${g.cmd}`, `  It ${g.what}`, '  (copy it, or press Tab on an empty line. Stuck? type  hint)', ''];
}
/** The one-line pointer that ends every step's output. */
export const nextPointer = (sh) => (sh.puzzle.current ? P(`Next: ${GUIDE[sh.puzzle.current].cmd}`, 'hint') : P('Next: /build', 'hint'));

const resolveHost = (h) => {
  const host = h.replace(/^[a-z]+:\/\//, '').split(/[/:]/)[0].toLowerCase();
  return host;
};


/** `help all`: every registered command, grouped. Secret ones stay out. */
function helpAll(sh, row) {
  const group = (title, names) => [title, ...names.filter((n) => COMMANDS[n]).map(row), ''];
  const listed = new Set();
  const g = (title, names) => { names.forEach((n) => listed.add(n)); return group(title, names); };
  const lines = [
    ...guideLines(sh),
    'ALL COMMANDS (with or without a leading slash; man <cmd> for details)',
    '',
    ...g('Look around', ['ls', 'cd', 'pwd', 'cat', 'less', 'tree', 'grep', 'head', 'tail', 'wc', 'sort', 'echo']),
    ...g('System', ['whoami', 'id', 'uname', 'hostname', 'date', 'ps', 'top', 'history', 'clear', 'exit', 'su', 'sudo', 'login']),
    ...g('Network tools', ['ping', 'nmap', 'curl', 'ssh', 'strings', 'rev', 'john']),
    ...g('Console', ['hint', 'progress', 'man', 'help', 'theme', 'sound', 'song', 'about', 'credits', 'reset']),
    ...g('Site', ['game', 'open']),
    `Root only ${sh.isRoot ? '(unlocked)' : '(locked: earn root)'}`,
    ...['build', 'status', 'services', 'logs', 'deploy', 'rollback'].map((n) => { listed.add(n); return row(n); }),
    '',
  ];
  const rest = Object.keys(COMMANDS).filter((n) => !listed.has(n) && !COMMANDS[n].secret);
  if (rest.length) lines.push(...group('Extras', rest));
  lines.push('Tips: Tab completes, up/down is history, Ctrl+L clears, Ctrl+C cancels. Stuck? type  hint.');
  return lines;
}

const COMMANDS = {
  help: {
    desc: 'short list of commands (help all: every command)', usage: 'help [all|command]',
    run(sh, args) {
      if (args[0] && args[0].replace(/^\//, '').toLowerCase() !== 'all') return COMMANDS.man.run(sh, args);
      const row = (n) => `  ${pad(COMMANDS[n].root ? '/' + n : n, 11)}${COMMANDS[n].desc}`;
      if (args[0]) return [P(helpAll(sh, row).join('\n'))];
      const short = {
        build: 'build the backend', hint: 'the next login command', ls: 'list files (ls -a: hidden)', cat: 'read a file', cd: 'change directory',
        clear: 'clear the screen', game: 'play PH Origins', man: 'manual for a command',
      };
      const line = (n) => `  ${pad(COMMANDS[n].root ? '/' + n : n, 11)}${short[n]}`;
      const names = sh.isRoot ? ['build', 'hint', 'ls', 'cat', 'cd', 'game', 'clear'] : ['hint', 'ls', 'cat', 'cd', 'game', 'clear', 'man'];
      const lines = [...guideLines(sh), 'COMMANDS', ...names.map(line), sh.isRoot ? '  more: help all' : `  ${pad('help all', 11)}every command`];
      return [P(lines.join('\n'))];
    },
  },
  man: {
    desc: 'manual page for a command', usage: 'man <command>',
    run(sh, args) {
      const name = (args[0] || '').replace(/^\//, '');
      if (!name) return [P('What manual page do you want? (try: man ls)', 'err')];
      const d = COMMANDS[name];
      if (!d || d.secret) return [P(`No manual entry for ${name}`, 'err')];
      return [P(`${name.toUpperCase()}(1)\n\nNAME\n    ${name} - ${d.desc}\n\nUSAGE\n    ${d.usage || name}\n${d.man ? `\nNOTES\n    ${d.man}\n` : ''}`)];
    },
  },
  ls: {
    desc: 'list directory (-a hidden, -l long)', usage: 'ls [-a] [-l] [path...]',
    run(sh, args) {
      const { flags, rest } = flagsOf(args);
      const targets = rest.length ? rest : ['.'];
      const out = [];
      for (const t of targets) {
        const abs = path(sh, t);
        const n = sh.vfs.node(abs);
        if (!n) { out.push(P(`ls: cannot access '${t}': No such file or directory`, 'err')); continue; }
        if (n.type === 'file') { out.push(P(flags.l ? `${modeOf(n)} 1 ${n.owner} ${n.owner} ${lpad(contentOf(sh, n).length, 5)} Nov 12 03:14 ${t}` : t)); continue; }
        if (!sh.vfs.canRead(n, sh.user)) { out.push(P(`ls: cannot open directory '${t}': Permission denied`, 'err')); continue; }
        if (targets.length > 1) out.push(P(`${t}:`));
        out.push(P(listDir(sh, abs, flags)));
      }
      return out;
    },
  },
  cd: {
    desc: 'change directory', usage: 'cd [path]',
    run(sh, args) {
      const abs = args[0] ? path(sh, args[0]) : USERS[sh.user].home;
      const n = sh.vfs.node(abs);
      if (!n) {
        const page = sh.resolvePage(args[0]);
        return page ? [P(`cd: ${args[0]}: that is a web page, not a directory. try:  open ${args[0]}`, 'err')] : [P(`cd: ${args[0]}: No such file or directory`, 'err')];
      }
      if (n.type !== 'dir') return [P(`cd: ${args[0]}: Not a directory`, 'err')];
      if (!sh.vfs.canRead(n, sh.user)) return [P(`cd: ${args[0]}: Permission denied`, 'err')];
      sh.cwd = abs;
      return [];
    },
  },
  pwd: { desc: 'print working directory', usage: 'pwd', run: (sh) => sh.cwd },
  cat: {
    desc: 'print files', usage: 'cat <file...>',
    run(sh, args, stdin) {
      if (!args.length) return stdin == null ? [P('cat: usage: cat <file>', 'err')] : [P(stdin)];
      const out = [];
      for (const a of args) {
        const r = readNode(sh, a, path(sh, a));
        if (r.err) out.push(P(r.err, 'err'));
        else if (r.n.binary) out.push(P(`cat: ${a}: binary file (the readable bits are another tool's job)`, 'dim'));
        else out.push(P(r.content.replace(/\n$/, '')));
      }
      return out;
    },
  },
  less: {
    desc: 'page through a file (also: more)', usage: 'less <file>',
    run(sh, args) {
      if (!args[0]) return [P('less: missing filename', 'err')];
      const r = readNode(sh, args[0], path(sh, args[0]));
      return r.err ? [P(r.err, 'err')] : [P(r.content.replace(/\n$/, '')), P('(END)', 'dim')];
    },
  },
  head: { desc: 'first lines', usage: 'head [-n N] [file]', run: (sh, args, stdin) => sliceCmd(sh, args, stdin, true) },
  tail: { desc: 'last lines', usage: 'tail [-n N] [file]', run: (sh, args, stdin) => sliceCmd(sh, args, stdin, false) },
  wc: {
    desc: 'count lines, words, bytes', usage: 'wc [file]',
    run(sh, args, stdin) {
      let src = stdin;
      if (src == null) { const r = readNode(sh, args[0] || '', path(sh, args[0] || '.')); if (r.err) return [P(r.err, 'err')]; src = r.content; }
      const lines = src === '' ? 0 : src.replace(/\n$/, '').split('\n').length;
      return [P(`${lines} ${src.split(/\s+/).filter(Boolean).length} ${src.length}`)];
    },
  },
  sort: {
    desc: 'sort lines', usage: 'sort [file]',
    run(sh, args, stdin) {
      let src = stdin;
      if (src == null) { const r = readNode(sh, args[0] || '', path(sh, args[0] || '.')); if (r.err) return [P(r.err, 'err')]; src = r.content; }
      return [P(src.replace(/\n$/, '').split('\n').sort().join('\n'))];
    },
  },
  echo: {
    desc: 'print text', usage: 'echo [text...]',
    run: (sh, args) => args.join(' ').replace(/\$USER\b/g, sh.user).replace(/\$HOME\b/g, USERS[sh.user].home).replace(/\$HOST(NAME)?\b/g, 'ph-origins'),
  },
  grep: {
    desc: 'find lines (-i -n -r -v)', usage: 'grep [-i] [-n] [-r] [-v] <pattern> [file...]',
    run(sh, args, stdin) {
      const { flags, rest } = flagsOf(args);
      const pat = rest.shift();
      if (pat == null) return [P('grep: usage: grep [-inrv] <pattern> [file...]', 'err')];
      if (stdin != null && !rest.length) return [P(matchLines(stdin, pat, flags).join('\n'))];
      const targets = rest.length ? rest : (flags.r ? ['.'] : []);
      if (!targets.length) return [P('grep: no file given', 'err')];
      flags.H = flags.r || targets.length > 1;
      const out = targets.flatMap((t) => grepFiles(sh, path(sh, t), pat, flags, t));
      return [P(out.join('\n'))];
    },
  },
  tree: {
    desc: 'show a directory tree (-a hidden)', usage: 'tree [-a] [path]',
    run(sh, args) {
      const { flags, rest } = flagsOf(args);
      const abs = path(sh, rest[0] || '.');
      const n = sh.vfs.node(abs);
      if (!n || n.type !== 'dir') return [P(`tree: ${rest[0] || abs}: not a directory`, 'err')];
      const lines = [abs, ...treeLines(sh, abs, '', 4, !!flags.a)];
      return [P(lines.join('\n'))];
    },
  },
  whoami: {
    desc: 'who am I (--root: the root note)', usage: 'whoami [--root]',
    run(sh, args) {
      if (args.includes('--root')) {
        return sh.isRoot ? [P('root. earned, not given. (hints used: ' + sh.puzzle.hintsUsed + ').', 'ok')] : [P('whoami --root: permission denied (' + sh.user + '). The backend only answers to root.', 'err'), P('hint: type  hint', 'dim')];
      }
      return sh.user;
    },
  },
  id: { desc: 'user and group ids', usage: 'id', run: (sh) => `uid=${USERS[sh.user].uid}(${sh.user}) gid=${USERS[sh.user].uid}(${sh.user}) groups=${USERS[sh.user].uid}(${sh.user})` },
  uname: {
    desc: 'system name (-a for all)', usage: 'uname [-a]',
    run: (sh, args) => (args.includes('-a') ? 'PH-OS ph-origins 5.8.0-apex #58 SMP Fri Nov 12 03:14:15 UTC 2026 x86_64 GNU/Linux' : 'PH-OS'),
  },
  hostname: { desc: 'print host name', usage: 'hostname', run: () => 'ph-origins' },
  date: { desc: 'date and time', usage: 'date', run: (sh) => new Date(sh.now()).toUTCString().replace('GMT', 'UTC') },
  history: {
    desc: 'command history', usage: 'history',
    run: (sh) => sh.history.map((h, i) => `${lpad(i + 1, 4)}  ${h}`).join('\n') || '(nothing yet)',
  },
  ps: { desc: 'processes', usage: 'ps', run: () => FAKE_PS.join('\n') },
  top: { desc: 'a static-looking process monitor', usage: 'top', run: () => FAKE_TOP.join('\n') },
  clear: { desc: 'clear the screen (Ctrl+L)', usage: 'clear', run: () => [{ k: 'clear' }] },
  exit: {
    desc: 'leave the session', usage: 'exit',
    run(sh) {
      if (sh.user === 'ops') { sh.user = 'guest'; sh.cwd = USERS.guest.home; return [P(`Connection to ${TARGET_HOST} closed.`, 'dim')]; }
      if (sh.isRoot) return [P('logout: you earned this seat. sit.', 'dim')];
      return [P('logout: there is nowhere to go. the tab is your friend.', 'dim')];
    },
  },
  theme: {
    desc: 'green, amber or white', usage: 'theme <green|amber|white>',
    run(sh, args) {
      const t = (args[0] || '').toLowerCase();
      if (!THEMES.includes(t)) return [P(`theme: ${THEMES.join(' | ')}   (now: ${sh.theme})`)];
      sh.theme = t;
      return [{ k: 'theme', name: t }, P(`theme: ${t}`, 'ok')];
    },
  },
  sound: {
    desc: 'keyclick sound on/off (off by default)', usage: 'sound <on|off>',
    run(sh, args) {
      const v = (args[0] || '').toLowerCase();
      if (v !== 'on' && v !== 'off') return [P(`sound: ${sh.sound ? 'on' : 'off'}   (usage: sound on | sound off)`)];
      sh.sound = v === 'on';
      return [{ k: 'sound', on: sh.sound }, P(`sound: ${v}${sh.sound ? '  (tick.)' : ''}`, 'ok')];
    },
  },
  about: {
    desc: 'what is this place', usage: 'about',
    run: () => [P('PH Origins: a third-person story set on the 58th floor of Hawkes Tower, and in the lab the board keeps dark.\n\nThis console is the Hawkes gateway: a way in, and a backend that builds itself.\nThe game is one command away:  game', '')],
  },
  credits: {
    desc: 'who made this', usage: 'credits',
    run: () => [P('PH Origins\n  a Hawkes Biomedical company\n  Powered by HAWKES GEN\n  Console: the 58th floor gateway. Thanks for hacking the planet.')],
  },
  hint: {
    desc: 'a nudge for the current step (free)', usage: 'hint',
    run(sh) {
      const h = sh.puzzle.hint();
      sh.save();
      if (!h.step) return [P(h.text, 'ok')];
      return [P(`hint (step ${STEPS.findIndex((s) => s.id === h.step) + 1} of ${STEPS.length}): ${h.text}`, 'hint')];
    },
  },
  progress: {
    desc: 'your progress and achievements', usage: 'progress',
    run(sh) {
      const done = sh.puzzle.stepsDone;
      return [P(`${achievements(sh).join('\n')}\n\n  root path: ${done}/${STEPS.length}${sh.vfs.built ? `\n  backend: built (${sh.vfs.built.hash})` : ''}`)];
    },
  },
  reset: {
    desc: 'wipe saved progress and start over', usage: 'reset',
    run(sh) {
      sh.ask('wipe all progress? type yes to confirm >', (ans, s) => {
        if (ans.toLowerCase() !== 'yes') return [P('reset: cancelled.', 'dim')];
        s.reset();
        return [{ k: 'reset' }, P('progress wiped. you are guest again. the hat is backwards again.', 'ok')];
      });
      return [];
    },
  },
  song: {
    desc: 'play or stop song.mp3 (the one from /build)', usage: 'song [stop]',
    run(sh, args) {
      if ((args[0] || '').toLowerCase() === 'stop') return [{ k: 'song', on: false }, P('song stopped.', 'dim')];
      return [{ k: 'song', on: true }, P('playing song.mp3 ...  (song stop)', 'ok')];
    },
  },
  game: {
    desc: 'open the game (also: play)', usage: 'game',
    run(sh, args) {
      if ((args[0] || '').toLowerCase() === 'song') return COMMANDS.song.run(sh, []);
      const note = sh.vfs.built ? ' [backend online: build ' + sh.vfs.built.hash + ']' : '';
      return [P(`launching PH Origins...${note}`, 'ok'), { k: 'go', url: SITE_PAGES.game }];
    },
  },
  open: {
    desc: 'open a site page: about, characters, lore, whatsnew, game', usage: 'open <page>',
    run(sh, args) {
      if (!args[0]) return [P('open: pages are  about  characters  lore  whatsnew  game  lore/<chapter>  (try: ls ~/site)', 'err')];
      const url = sh.resolvePage(args[0]);
      if (!url) return [P(`open: ${args[0]}: no such page (try: ls ~/site)`, 'err')];
      return [P(`opening ${url.replace('./', '')} ...`, 'ok'), { k: 'go', url }];
    },
  },
  ping: {
    desc: 'ping a host', usage: 'ping <host>',
    run(sh, args) {
      const host = resolveHost(args[0] || '');
      if (!host) return [P('ping: usage: ping <host>', 'err')];
      const known = { localhost: '127.0.0.1', '127.0.0.1': '127.0.0.1', 'tower.hawkes.lan': '10.58.0.2', 'vault.hawkes.lan': '10.58.0.7', 'hawkesbiomedical.com': '203.0.113.58', 'phorigins.com': '203.0.113.59', '8.8.8.8': '8.8.8.8' };
      const ip = known[host] ?? (host === TARGET_HOST && sh.puzzle.has('hat') ? '10.58.0.12' : null);
      if (!ip) return [P(`ping: ${host}: Name or service not known`, 'err')];
      const r = rng(hex(host, 6).length + host.length * 7 + sh.history.length);
      const steps = [{ at: 0, text: `PING ${host} (${ip}) 56(84) bytes of data. `, cls: 'dim' }];
      const times = [];
      for (let i = 0; i < 4; i += 1) { const ms = (r.int(8, 190) / 10 + (host === 'localhost' ? 0 : 6)).toFixed(1); times.push(+ms); steps.push({ at: 350 + i * 450, text: `64 bytes from ${ip}: icmp_seq=${i + 1} ttl=${r.int(52, 64)} time=${ms} ms` }); }
      steps.push({ at: 350 + 4 * 450, text: `--- ${host} ping statistics ---\n4 packets transmitted, 4 received, 0% packet loss` });
      return [SEQ(steps)];
    },
  },
  nmap: {
    desc: 'scan a host for open ports', usage: 'nmap [-sV] <host>',
    man: 'Lists the open ports on a host. Try the host the hat names.',
    run(sh, args) {
      const { rest } = flagsOf(args);
      const host = resolveHost(rest[0] || '');
      if (!host) return [P('nmap: usage: nmap <host>', 'err')];
      const steps = [{ at: 0, text: `Starting Nmap 7.94 ( https://nmap.org )`, cls: 'dim' }];
      let at = 500;
      const add = (t, cls) => { steps.push({ at, text: t, cls }); at += 140; };
      if (host === TARGET_HOST) {
        sh.puzzle.complete('hat');
        const first = sh.puzzle.complete('scan');
        add(`Nmap scan report for ${TARGET_HOST} (10.58.0.12)`);
        add('Host is up (0.0031s latency).');
        add('PORT      STATE SERVICE  VERSION');
        add('21/tcp    open  ftp      vsftpd 3.0.3 (anonymous login refused, ftp is for the shy)');
        add('22/tcp    open  ssh      OpenSSH 7.9 (accounts here: ops)');
        add('8080/tcp  open  http-alt hawkes-gw admin (staging)');
        add('| http-title: hawkes-gw staging admin');
        add('| http-robots.txt: 1 disallowed entry');
        add('|_/backup/gw.cfg.bak', 'ok');
        add('Nmap done: 1 IP address (1 host up) scanned in 2.4 seconds');
        if (first) sh.save();
        steps.push({ at, text: nextPointer(sh).text, cls: 'hint' });
      } else if (host === 'localhost' || host === '127.0.0.1') {
        add('Nmap scan report for localhost (127.0.0.1)');
        add('All 1000 scanned ports on localhost are closed (the shell is not a port).');
      } else if (['tower.hawkes.lan', 'vault.hawkes.lan'].includes(host)) {
        add(`Nmap scan report for ${host}`);
        add('All 1000 scanned ports are filtered. Someone on the 58th floor made sure.');
      } else if (['hawkesbiomedical.com', 'phorigins.com'].includes(host)) {
        add(`Nmap scan report for ${host}`);
        add('443/tcp open https  (a public website. the front door, not the way in.)');
      } else {
        add(`Failed to resolve "${rest[0]}".`, 'err');
        add('WARNING: No targets were specified, so 0 hosts scanned.');
      }
      return [SEQ(steps)];
    },
  },
  curl: {
    desc: 'fetch a URL (also: wget)', usage: 'curl [-O] <host[:port]/path>',
    run(sh, args) {
      const { rest } = flagsOf(args);
      if (!rest[0]) return [P('curl: usage: curl <url>', 'err')];
      const url = rest[0].replace(/^[a-z]+:\/\//, '');
      const m = url.match(/^([^/:]+)(?::(\d+))?(\/.*)?$/);
      if (!m) return [P(`curl: (3) URL rejected: ${rest[0]}`, 'err')];
      const host = m[1].toLowerCase();
      const port = m[2] || '80';
      const p = m[3] || '/';
      if (host !== TARGET_HOST) return [P(`curl: (6) Could not resolve host: ${host}`, 'err')];
      if (!sh.puzzle.has('scan') || port !== '8080') return [P(`curl: (7) Failed to connect to ${host} port ${port}: Connection refused`, 'err'), P('(the gateway ignores callers that have not knocked. a scanner is a polite knock.)', 'dim')];
      if (p === '/' || p === '/index.html') return [P('<html><head><title>hawkes-gw staging admin</title></head>\n<body><h1>hawkes-gw</h1><p>staging only. nothing to see. the backups are not linked here.</p></body></html>')];
      if (p === '/robots.txt') return [P('User-agent: *\nDisallow: /backup/gw.cfg.bak')];
      if (p === `/backup/${GW_BACKUP_NAME}`) {
        const first = sh.puzzle.complete('loot');
        sh.syncLoot();
        sh.save();
        return [SEQ([
          { at: 0, text: '  % Total    % Received  Time   Current Speed' },
          { at: 250, text: `100   412  100   412   0:00:00  saved` },
          { at: 500, text: `saved to ~/loot/${GW_BACKUP_NAME} (412 bytes, binary)`, cls: 'ok' },
          { at: 650, text: nextPointer(sh).text, cls: 'hint' },
        ])];
      }
      return [P('<html><body><h1>404</h1><p>not here. look at robots.txt.</p></body></html>', 'err')];
    },
  },
  strings: {
    desc: 'print the readable strings in a file', usage: 'strings <file>',
    run(sh, args) {
      if (!args[0]) return [P('strings: usage: strings <file>', 'err')];
      const r = readNode(sh, args[0], path(sh, args[0]));
      if (r.err) return [P(r.err.replace(/^[^:]+:/, 'strings:'), 'err')];
      return [P(r.n.binary ? r.n.strings.join('\n') : r.content.replace(/\n$/, ''))];
    },
  },
  rev: {
    desc: 'reverse each line of a file', usage: 'rev <file>',
    man: 'Writes each line back to front. Some people wear their hats the same way.',
    run(sh, args, stdin) {
      if (!args[0] && stdin == null) return [P('rev: usage: rev <file>', 'err')];
      let src = stdin;
      if (src == null) {
        const abs = path(sh, args[0]);
        const r = readNode(sh, args[0], abs);
        if (r.err) return [P(r.err.replace(/^[^:]+:/, 'rev:'), 'err')];
        src = r.content;
        if (abs === '/home/guest/.hat_backwards' && sh.puzzle.complete('hat')) sh.save();
        const out = [P(src.replace(/\n$/, '').split('\n').map(reverse).join('\n'))];
        return abs === '/home/guest/.hat_backwards' && sh.puzzle.has('hat') ? [...out, nextPointer(sh)] : out;
      }
      return [P(src.replace(/\n$/, '').split('\n').map(reverse).join('\n'))];
    },
  },
  john: {
    desc: 'crack password hashes with a wordlist (also: crack)', usage: 'john [--wordlist=<file>] <hashfile>',
    run(sh, args) {
      const { rest } = flagsOf(args.filter((a) => !a.startsWith('--wordlist')));
      let wl = null;
      args.forEach((a, i) => { if (a.startsWith('--wordlist=')) wl = a.slice(11); else if (a === '--wordlist') wl = args[i + 1]; });
      const fileArg = rest.filter((a) => a !== wl)[0];
      if (!fileArg) return [P('john: usage: john [--wordlist=FILE] <hashfile>', 'err')];
      const fr = readNode(sh, fileArg, path(sh, fileArg));
      if (fr.err) return [P(fr.err.replace(/^[^:]+:/, 'john:'), 'err')];
      const isHash = fr.n.binary && fr.n.strings?.some((l) => l.startsWith('ops_hash='));
      if (!isHash) return [P(`john: ${fileArg}: no password hashes loaded (this file has none)`, 'err')];
      const wlPath = wl || '/usr/share/wordlists/rockyou-lite.txt';
      const wr = readNode(sh, wlPath, path(sh, wlPath));
      if (wr.err) return [P(wr.err.replace(/^[^:]+:/, 'john:'), 'err')];
      const words = wr.content.split('\n').filter(Boolean);
      const hit = words.includes(OPS_PASSWORD);
      const steps = [
        { at: 0, text: `Loaded 1 password hash (md5crypt [MD5 32/64]) from ${fileArg}`, cls: 'dim' },
        { at: 200, text: `Wordlist: ${wlPath} (${words.length} words)`, cls: 'dim' },
      ];
      const ticks = 8;
      for (let i = 1; i <= ticks; i += 1) steps.push({ at: 400 + i * 260, text: `  ${bar(i / ticks)}  ${lpad(Math.round(words.length * i / ticks), 3)}/${words.length} words`, key: 'john' });
      const end = 400 + (ticks + 1) * 260;
      if (hit) {
        const first = sh.puzzle.complete('crack');
        steps.push({ at: end, text: `${OPS_PASSWORD}      (ops)`, cls: 'ok' });
        steps.push({ at: end + 150, text: '1g 0:00:00:03 DONE  (password recovered)', cls: 'ok' });
        steps.push({ at: end + 300, text: first ? 'ssh is open on this host. a username and a password: there is a door.' : 'already cracked. the door is where you left it.', cls: 'dim' });
        sh.save();
        steps.push({ at: end + 450, text: nextPointer(sh).text, cls: 'hint' });
      } else {
        steps.push({ at: end, text: '0g 0:00:00:03 DONE  (wordlist exhausted: no password found)', cls: 'err' });
        steps.push({ at: end + 150, text: 'a generic list will not know who wrote this. use the staff wordlist.', cls: 'dim' });
        steps.push({ at: end + 300, text: nextPointer(sh).text, cls: 'hint' });
      }
      return [SEQ(steps)];
    },
  },
  ssh: {
    desc: 'log in to a host', usage: 'ssh <user>@<host>',
    run(sh, args) {
      let user = null;
      let host = null;
      for (let i = 0; i < args.length; i += 1) {
        const a = args[i];
        if (a === '-l') { user = args[i + 1]; i += 1; } else if (a.startsWith('-')) continue;
        else if (a.includes('@')) [user, host] = a.split('@');
        else host = a;
      }
      host = resolveHost(host || '');
      if (!host) return [P('ssh: usage: ssh <user>@<host>', 'err')];
      if (host !== TARGET_HOST) return [P(`ssh: Could not resolve hostname ${host}: Name or service not known`, 'err')];
      if (!sh.puzzle.has('scan')) return [P(`ssh: connect to host ${host} port 22: Connection refused`, 'err'), P('(you have not knocked yet. scan first.)', 'dim'), nextPointer(sh)];
      if (sh.user === 'ops') return [P('already logged in as ops. (inception is not supported.)', 'dim')];
      if (user && user !== 'ops') return [P(`${user}@${host}: Permission denied (publickey). Only the staging admin account may log in here.`, 'err'), nextPointer(sh)];
      const wait = sh.throttle();
      if (wait > 0) return [P(`ssh: too many attempts. the gateway rolls its eyes. try again in ${wait}s.`, 'err')];
      sh.ask(`${user || sh.user}@${host}'s password:`, (pw, s) => {
        const left = s.throttle();
        if (left > 0) return [P(`ssh: too many attempts. try again in ${left}s.`, 'err')];
        if (user === 'ops' && pw === OPS_PASSWORD && s.puzzle.has('crack')) {
          s.fails = 0;
          return s.grantRoot(`Welcome to ph-origins (${TARGET_HOST})  -- staging gateway. be nice. ops is a staging admin: root shell.`);
        }
        return s.failAuth('ssh');
      }, { mask: true });
      return [];
    },
  },
  su: {
    desc: 'switch user (try root; good luck)', usage: 'su [user]',
    run(sh, args) {
      const who = args[0] || 'root';
      if (sh.isRoot) return [P('su: you are already root. what more do you want?', 'dim')];
      if (who !== 'root') return [P(`su: user ${who}: login disabled. root is the only account that can be logged into.`, 'err'), nextPointer(sh)];
      sh.ask('Password:', (pw, s) => {
        s.suFails += 1;
        const out = s.failAuth('su');
        out.unshift(P('su: Authentication failure', 'err'));
        if (s.suFails >= 2) out.push(P('root\'s password is not written anywhere you can read. staging accounts are lazier than root.', 'dim'));
        return out;
      }, { mask: true });
      return [];
    },
  },
  login: {
    desc: 'log in as a user (root only)', usage: 'login [user]', hidden: true,
    run(sh, args) {
      const who = args.find((a) => !a.startsWith('-')) || 'root';
      if (sh.isRoot) return [P('login: you are already root.', 'dim')];
      if (who !== 'root') return [P(`login: ${who}: account locked. root is the only account that can be logged into.`, 'err'), nextPointer(sh)];
      return [P('login: root logins are only accepted over the gateway.', 'err'), nextPointer(sh)];
    },
  },
  sudo: {
    desc: 'run as root (guests get a stern look)', usage: 'sudo [-l] <command>',
    run(sh, args) {
      if (sh.isRoot) return [P('you are root. sudo is for people who are not.', 'dim')];
      if (sh.user !== 'ops') return [P(`${sh.user} is not in the sudoers file. This incident will be reported.`, 'err'), P('(to whom? to the intern. who does not read email.)', 'dim')];
      if (args[0] === '-l') {
        return [P(`Matching Defaults entries for ops on ph-origins:\n    env_reset, mail_badpass\n\nUser ops may run the following commands on ph-origins:\n    (root) NOPASSWD: /usr/bin/less /var/log/*\n\n(the intern added the wildcard. "less" is a pager. pagers can run commands with  !)`)];
      }
      if (args[0] === 'less' && args[1]) {
        const abs = path(sh, args[1]);
        if (!abs.startsWith('/var/log/')) return [P(`Sorry, user ops is not allowed to execute 'less ${args[1]}' as root on ph-origins.`, 'err')];
        const n = sh.vfs.node(abs);
        if (!n || n.type !== 'file') return [P(`${args[1]}: No such file`, 'err')];
        sh.ask(':', (line, s) => COMMANDS.sudo.pager(s, line), { pager: true });
        return [P(contentOf(sh, n).replace(/\n$/, '')), P('(press q to quit, or ! to run a command)', 'dim')];
      }
      return [P(`Sorry, user ops is not allowed to execute '${args.join(' ')}' as root on ph-origins.`, 'err')];
    },
    pager(sh, line) {
      if (/^!\s*(\/bin\/)?(sh|bash)$/.test(line)) return sh.grantRoot('# spawned a shell from the pager (running as root)');
      if (line === 'q' || line === 'Q') return [P('(left the pager.)', 'dim')];
      sh.ask(':', (l2, s2) => COMMANDS.sudo.pager(s2, l2), { pager: true });
      return [P('(q quits. ! runs a command.)', 'dim')];
    },
  },
  // ---- root only
  build: {
    root: true, desc: 'build the medical backend framework (--verbose, <module>, status)', usage: 'build [--verbose] [<module>|status]',
    man: 'Assembles the medical backend. A full build is a show: the log floods past, song.mp3 plays and the log text forms two silhouettes (M mutes, Esc, Ctrl+C or any tap skips to BUILD SUCCESSFUL; the build still finishes). /build <module> is the quiet version.',
    run(sh, args) {
      const { flags, rest } = flagsOf(args);
      const b = sh.vfs.built;
      if (rest[0] === 'status') {
        if (!b) return [P('build status: not built. run  /build', 'warn')];
        return [P(`build status: ${isComplete(b) ? 'COMPLETE' : 'PARTIAL'}  hash ${b.hash}  ${b.modules.length}/${MODULES.length} modules  ${b.tests} tests\n  ${b.modules.map((m) => m.id).join(', ')}`, 'ok')];
      }
      let only = null;
      if (rest[0]) {
        if (!MODULES.some((m) => m.id === rest[0])) return [P(`build: unknown module "${rest[0]}". modules:\n  ${MODULES.map((m) => m.id).join('\n  ')}`, 'err')];
        only = rest[0];
      }
      const seed = 58 + (b ? 1 : 0) + (only ? only.length : 0);
      const res = runBuild({ seed, only, verbose: !!(flags.verbose || flags.v) });
      sh.vfs.built = mergeBuilt(b, res.summary);
      sh.puzzle.award('built');
      sh.save();
      const seq = SEQ(res.events.map((e) => ({ at: e.at, text: e.text, cls: e.cls, key: e.key })));
      if (!only) seq.show = { seed }; // a full build is the three-act show (log flood, song, text flipbook); a module build stays plain
      return [seq];
    },
  },
  status: {
    root: true, desc: 'backend status', usage: 'status',
    run(sh) {
      const b = sh.vfs.built;
      if (!b) return [P('backend: NOT BUILT. run  /build', 'warn')];
      const rows = b.modules.map((m) => `  ${pad(m.id, 16)} ${pad('UP', 4)} :${m.port}  ${lpad(m.tests, 4)} tests`);
      return [P(`backend: ${isComplete(b) ? 'ONLINE' : 'PARTIAL'}  build ${b.hash}  v${b.version}  deployed: ${sh.deployed ?? 'no'}\n${rows.join('\n')}`, 'ok')];
    },
  },
  services: {
    root: true, desc: 'list backend services', usage: 'services',
    run(sh) {
      const b = sh.vfs.built;
      const mods = MODULES.map((m) => `  ${pad(m.id, 16)} ${b?.modules.some((x) => x.id === m.id) ? 'active (running)' : 'inactive (not built)'}`);
      return [P(`UNIT              STATE\n${mods.join('\n')}`)];
    },
  },
  logs: {
    root: true, desc: 'tail the build and service log', usage: 'logs',
    run(sh) { return [P(buildLog(sh).join('\n'))]; },
  },
  deploy: {
    root: true, desc: 'deploy the build (asks first)', usage: 'deploy',
    run(sh) {
      const b = sh.vfs.built;
      if (!b) return [P('deploy: nothing to deploy. run  /build  first.', 'warn')];
      sh.ask(`deploy build ${b.hash} to staging? [y/N]`, (ans, s) => {
        if (!/^y(es)?$/i.test(ans)) return [P('deploy: aborted.', 'dim')];
        s.deployed = b.hash;
        s.save();
        const steps = ['uploading artifacts to a bucket that does not exist ... ok', 'draining the nothing ... ok', 'rolling 10 services (each is a progress bar) ... ok', `deployed ${b.hash} to staging.`]
          .map((t, i) => ({ at: i * 520, text: t, cls: i === 3 ? 'ok' : '' }));
        return [SEQ(steps)];
      });
      return [];
    },
  },
  rollback: {
    root: true, desc: 'roll back the last deploy (asks first)', usage: 'rollback',
    run(sh) {
      if (!sh.deployed) return [P('rollback: nothing is deployed. you cannot roll back a feeling.', 'warn')];
      sh.ask(`roll back ${sh.deployed}? [y/N]`, (ans, s) => {
        if (!/^y(es)?$/i.test(ans)) return [P('rollback: aborted.', 'dim')];
        s.deployed = null;
        s.save();
        return [SEQ([{ at: 0, text: 'restoring the previous nothing ...' }, { at: 600, text: 'rolled back. the board never knew.', cls: 'ok' }])];
      });
      return [];
    },
  },
  // ---- easter eggs
  cowsay: { desc: 'a cow says something', usage: 'cowsay [text]', run: (sh, args) => COW(args.join(' ') || 'moo. (a gateway cow. very secure.)') },
  fortune: { desc: 'a fortune', usage: 'fortune', run: (sh) => FORTUNES[(sh.history.length * 7 + new Date(sh.now()).getSeconds()) % FORTUNES.length] },
  sl: {
    desc: 'you meant ls', usage: 'sl',
    run() {
      const train = ['      ====        ________                ___________', '  _D _|  |_______/        \\__I_I_____===__|_________|', '   |(_)---  |   H\\________/ |   |        =|___ ___|', '   /     |  |   H  |  |     |   |         ||_| |_||', '  |      |  |   H  |__--------------------| [___] |', '  | ________|___H__/__|_____/[][]~\\_______|       |', '  |/ |   |-----------I_____I [][] []  D   |=======|__'];
      const steps = [];
      for (let i = 0; i < 6; i += 1) steps.push({ at: i * 160, text: train.map((l) => ' '.repeat(i * 3) + l).join('\n'), key: 'sl' });
      steps.push({ at: 6 * 160, text: '(you meant  ls .)', cls: 'dim' });
      return [SEQ(steps)];
    },
  },
  matrix: {
    desc: 'wake up, guest', usage: 'matrix',
    run(sh) {
      const r = rng(sh.now() >>> 8);
      const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ0123456789PHBIO';
      const steps = [];
      for (let i = 0; i < 12; i += 1) steps.push({ at: i * 110, text: Array.from({ length: 56 }, () => (r() < 0.4 ? ' ' : glyphs[r.int(0, glyphs.length - 1)])).join(''), cls: 'ok' });
      steps.push({ at: 12 * 110 + 200, text: 'Wake up, guest...  the backend has you.', cls: 'ok' });
      return [SEQ(steps)];
    },
  },
  konami: { desc: 'the code', usage: 'konami', secret: true, hidden: true, run: () => [P('up up down down left right left right b a. at the prompt. try it.', 'dim')] },
};

function sliceCmd(sh, args, stdin, head) {
  const { rest } = flagsOf(args.filter((a, i) => !(args[i - 1] === '-n')));
  let n = 10;
  const ni = args.indexOf('-n');
  if (ni >= 0) n = parseInt(args[ni + 1], 10) || 10;
  let src = stdin;
  if (src == null) {
    const r = readNode(sh, rest[0] || '', path(sh, rest[0] || '.'));
    if (r.err) return [P(r.err, 'err')];
    src = r.content;
  }
  const lines = src.replace(/\n$/, '').split('\n');
  return [P((head ? lines.slice(0, n) : lines.slice(-n)).join('\n'))];
}

export { COMMANDS };
