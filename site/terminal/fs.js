// The virtual filesystem: JSON in code. Nothing here touches a real disk or network.

const f = (content, o = {}) => ({ type: 'file', content, mode: o.mode ?? '-rw-r--r--', owner: o.owner ?? 'root', ...o });
const d = (children, o = {}) => ({ type: 'dir', children, mode: o.mode ?? 'drwxr-xr-x', owner: o.owner ?? 'root', ...o });
const page = (url, blurb) => f(`[web page] ${blurb}\nopen it with:  open ${url.replace(/^\.\//, '')}\n`, { page: url });

import { HAT_REVERSED, GW_STRINGS } from './content.js';

export function buildTree() {
  return d({
    bin: d({}),
    etc: d({
      motd: f('', { dynamic: 'motd' }),
      hostname: f('ph-origins\n'),
      issue: f('Hawkes Biomedical gateway \\n \\l\n'),
      'os-release': f('NAME="PH-OS"\nVERSION="58 (Apex)"\nID=phos\nPRETTY_NAME="PH-OS 58 Apex (a Hawkes Biomedical gateway)"\nHOME_URL="https://phorigins.com"\n'),
      hosts: f('127.0.0.1   localhost\n127.0.1.1   ph-origins\n10.58.0.2   tower.hawkes.lan\n10.58.0.7   vault.hawkes.lan\n# the intern was asked to add the staging gateway here. the intern did not.\n'),
      passwd: f('root:x:0:0:root:/root:/bin/sh\nguest:x:1000:1000:Guest (read-only):/home/guest:/bin/rsh\nops:x:1001:1001:Ops (staging gateway):/home/ops:/bin/bash\nintern:x:1002:1002:The Intern:/home/intern:/bin/nologin\n'),
      shadow: f('root:$6$...redacted...\n', { mode: '-rw-------' }),
      sudoers: f('# /etc/sudoers (excerpt)\nroot ALL=(ALL) ALL\nguest ALL=()  # nothing. nothing at all.\n', { mode: '-r--r-----' }),
    }),
    home: d({
      guest: d({
        'README.txt': f(
          'Welcome to the Hawkes Biomedical gateway console.\n\n'
          + 'You are logged in as "guest": read-only, no sudo, no fun. Yet.\n'
          + 'Type  help  for commands, ls -a to look properly, and  hint  if you get stuck (hints are free).\n'
          + 'Somebody on the old pen-testing team left a hat in this directory.\n',
        ),
        '.hat_backwards': f(HAT_REVERSED, { owner: 'guest' }),
        '.plan': f('Plan: get root.\nPlan B: ask nicely.\nPlan C: see Plan A.\n', { owner: 'guest' }),
        '.bash_history': f('ls -la\ncat README.txt\nrev .hat_backwards\nnmap <the host from the hat>\nssh ops@<the same host>\n# the rest was lost when the intern "cleaned up"\n', { owner: 'guest' }),
        '.achievements': f('', { dynamic: 'achievements', owner: 'guest' }),
        notes: d({
          'todo.txt': f('- ask Lang about Zurich (not my job)\n- staging gateway: unsure it is hardened. check before the board looks.\n- the old team signed everything backwards. the hat is in ~/.hat_backwards\n- remember: scan first, touch second\n', { owner: 'guest' }),
          'rules.txt': f('1. Patient data stays off this box. Always. No kidding.\n2. Everything here is read-only for guests. Reading is allowed. Reading is encouraged.\n3. The easy way in is never the way in.\n', { owner: 'guest' }),
        }, { owner: 'guest' }),
        loot: d({}, { owner: 'guest', loot: true }),
        site: d({
          'about.html': page('./about.html', 'About PH Origins: the story so far.'),
          'characters.html': page('./characters.html', 'The cast: Pierce Hawkes, Director Hale, Voss, Lang.'),
          'lore.html': page('./lore.html', 'Lore: one entry per chapter.'),
          'whatsnew.html': page('./whatsnew.html', 'What is new: release notes.'),
          'game.html': page('./play/game.html', 'The game itself. (You can also just type: game)'),
          lore: d({
            'the-apex-peak.html': page('./lore/the-apex-peak.html', 'Chapter 1: The Apex Peak.'),
            'b3.html': page('./lore/b3.html', 'Chapter 2: B3.'),
            'the-return.html': page('./lore/the-return.html', 'Chapter 3: The Return.'),
            'the-desk.html': page('./lore/the-desk.html', 'Chapter 4: The Desk.'),
            'going-home.html': page('./lore/going-home.html', 'Chapter 5: Going Home.'),
            'the-station.html': page('./lore/the-station.html', 'Chapter 6: The Station.'),
            'the-train.html': page('./lore/the-train.html', 'Chapter 7: The Train.'),
            'the-morning.html': page('./lore/the-morning.html', 'Chapter 8: The Morning.'),
          }),
        }, { owner: 'guest' }),
      }, { owner: 'guest' }),
      ops: d({
        'README.ops': f('ops@staging-gw: you are the staging gateway account.\nUse sudo -l to see what the intern let you do. We said "be careful". We were ignored.\n', { owner: 'ops' }),
        '.sudo_as_ops': f('', { owner: 'ops' }),
      }, { owner: 'ops' }),
    }),
    root: d({
      'flag.txt': f('You found the root flag. There was never a flag. Go /feed and look at home.\n', { mode: '-rw-------' }),
    }, { mode: 'drwx------' }),
    opt: d({
      '.feed-me': f('root-only: run /feed. LUNA-1, the first live camera on the Moon, is pointed at the Earth.\n(the backend comes online to carry it.)\n', { mode: '-rw-r-----' }),
    }),
    srv: d({
      lore: d({
        'hawkes-biomedical.txt': f('Hawkes Biomedical: the parent company. Tower on the skyline, the board on the 58th floor.\nPublic line: "records you can trust". Internal line: "records you can find".\n'),
        'board.txt': f('THE BOARD\n  Pierce Hawkes  chairman\n  Director Hale  the one who writes it down\n  Voss           the one who says it out loud\n  Lang           the one who has to carry a date to Zurich\n'),
        'apex-peak.txt': f('The Apex Peak: the 58th floor. Walnut, navy carpet, a city 205 m below the glass.\nBoard meetings run at night because the chairman prefers it.\n'),
      }),
    }),
    tmp: d({}, { mode: 'drwxrwxrwt' }),
    usr: d({
      share: d({
        doc: d({ 'intern-wiki.txt': f('Q: how do I make the build faster?\nA: you do not. it is a performance.\nQ: where are the backups?\nA: ask the gateway. be polite.\n') }),
      }),
    }),
    var: d({
      log: d({
        syslog: f('Nov 12 03:14:15 ph-origins kernel: PH-OS 58 Apex booting. coffee: low.\nNov 12 03:14:16 ph-origins gw[212]: staging gateway reachable at gw.hawkes.lan (do not tell the board)\nNov 12 03:14:17 ph-origins cron[301]: (root) CMD (rotate-the-hat)\nNov 12 03:14:19 ph-origins sshd[409]: the intern has left the building\n'),
        'auth.log': f('Nov 12 02:58:01 ph-origins sudo: ops : TTY=pts/0 ; COMMAND=/usr/bin/less /var/log/syslog\nNov 12 02:58:09 ph-origins sudo: ops : session closed. (the pager was left open. again.)\n', { mode: '-rw-r-----', owner: 'root' }),
        'build.log': f('', { dynamic: 'buildlog', mode: '-rw-r-----' }),
      }),
    }),
  }, { mode: 'drwxr-xr-x' });
}

export const USERS = {
  guest: { home: '/home/guest', uid: 1000, groups: 'guest' },
  ops: { home: '/home/ops', uid: 1001, groups: 'ops' },
  root: { home: '/root', uid: 0, groups: 'root' },
};

export class VFS {
  constructor() {
    this.root = buildTree();
    this.built = null; // { modules: [...], hash, ... } mounts /opt/hawkes-biomedical
  }

  /** Normalise a path against cwd and the user's home. */
  resolve(cwd, path, user = 'guest') {
    let p = path || '.';
    const home = USERS[user].home;
    if (p === '~') p = home;
    else if (p.startsWith('~/')) p = `${home}/${p.slice(2)}`;
    const abs = p.startsWith('/') ? p : `${cwd}/${p}`;
    const out = [];
    for (const seg of abs.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') out.pop();
      else out.push(seg);
    }
    return `/${out.join('/')}`;
  }

  node(abs) {
    if (abs === '/') return this.root;
    let cur = this.root;
    const parts = abs.split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i += 1) {
      if (!cur || cur.type !== 'dir') return null;
      cur = cur.children[parts[i]] ?? this.mounted(abs, i, parts);
    }
    return cur || null;
  }

  /** The backend lives at /opt/hawkes-biomedical once /feed has brought it online. */
  mounted(abs, i, parts) {
    if (this.built && i === 1 && parts[0] === 'opt' && parts[1] === 'hawkes-biomedical') return this.builtTree();
    return null;
  }

  builtTree() {
    const b = this.built;
    const mods = {};
    for (const m of b.modules) {
      mods[m.id] = d({
        'index.js': f(`// ${m.title}: compiled. ${m.files} files, ${m.tests} tests passed.\n`, { mode: '-rwxr-xr-x' }),
        'module.json': f(JSON.stringify({ id: m.id, title: m.title, port: m.port, tests: m.tests, files: m.files, version: b.version }, null, 2) + '\n'),
      });
    }
    return d({
      'README.md': f(
        `# Hawkes Biomedical: medical backend framework\n\nbuild ${b.hash}  (${b.modules.length} modules, version ${b.version})\n\n`
        + 'It holds no patient data and was assembled by a progress bar. It is very proud of itself.\n\n'
        + `## Modules\n${b.modules.map((m) => `- ${m.id}: ${m.title} (:${m.port})`).join('\n')}\n\n## Try\n- /status\n- /services\n- /logs\n- /deploy  (it will ask first)\n`,
      ),
      'BUILD.txt': f(`build: ${b.hash}\nmodules: ${b.modules.length}\ntests passed: ${b.tests}\nseed: ${b.seed}\nelapsed: ${b.seconds}s\n`),
      'manifest.json': f(JSON.stringify({ hash: b.hash, version: b.version, modules: b.modules.map((m) => m.id) }, null, 2) + '\n'),
      bin: d({ 'hawkes-gw': f('#!/bin/sh\n# the gateway entrypoint. it does nothing, beautifully.\n', { mode: '-rwxr-xr-x' }) }),
      modules: d(mods),
    });
  }

  list(abs) {
    const n = this.node(abs);
    if (!n || n.type !== 'dir') return null;
    const entries = { ...n.children };
    if (abs === '/opt' && this.built) entries['hawkes-biomedical'] = this.builtTree();
    return entries;
  }

  /** Can this user read the node? Owner-less modes are world readable; -rw------- is root only. */
  canRead(n, user) {
    if (user === 'root') return true;
    const m = n.mode || '';
    if (m[7] === 'r') return true; // world
    if (user === n.owner && m[1] === 'r') return true;
    if (user === 'ops' && m[4] === 'r') return true; // ops is in the log-reading group
    return false;
  }
}

/** Mode column for ls -l */
export const modeOf = (n) => n.mode || (n.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--');
