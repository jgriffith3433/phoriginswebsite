// Run with:  node --test site/terminal/test
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, parseCommand, tokenize, suggest } from '../parser.js';
import { complete } from '../complete.js';
import { Shell } from '../shell.js';
import { Puzzle } from '../puzzle.js';
import { runBuild, MODULES, mergeBuilt, floodScript } from '../build.js';
import { rasterize, blob, composeFrame, BEAT_SEC, BPM, POSES_MJ, POSES_JORDAN } from '../flipbook.js';
import { staticFrame } from '../show.js';
import { STEPS, OPS_PASSWORD } from '../content.js';

const mk = (o = {}) => { let t = 1e12; const store = { s: null }; const sh = new Shell({ load: () => store.s, save: (v) => { store.s = v; }, now: () => t, ...o }); sh.tick = (ms) => { t += ms; }; sh.store2 = store; return sh; };
const out = (effects) => effects.flatMap((e) => (e.k === 'print' ? [e.text] : e.k === 'seq' ? e.steps.map((s) => s.text) : [])).join('\n');
const run = (sh, line) => out(sh.run(line));

test('parser: quotes, leading slash, aliases, pipes', () => {
  assert.deepEqual(tokenize(`echo "a b" 'c d' e\\ f`), ['echo', 'a b', 'c d', 'e f']);
  assert.equal(parseCommand('/help').cmd, 'help');
  assert.equal(parseCommand('help').cmd, 'help');
  assert.equal(parseCommand('/etc/motd').cmd, '/etc/motd'); // a path, not a command
  assert.deepEqual(parseCommand('ll /etc'), { cmd: 'ls', args: ['-l', '/etc'], raw: 'll /etc' });
  assert.equal(parseCommand('play').cmd, 'game');
  assert.equal(parseLine('cat a | grep "x|y" | wc').length, 3);
  assert.equal(parseLine('   ').length, 0);
});

test('parser: did you mean', () => {
  assert.ok(suggest('hlep', ['help', 'hint', 'ls']).includes('help'));
  assert.ok(suggest('nmpa', ['nmap', 'ls']).includes('nmap'));
  assert.deepEqual(suggest('zzzzzzzz', ['help']), []);
  const sh = mk();
  assert.match(run(sh, 'hlep'), /command not found[\s\S]*help/);
});

test('help lists at least 15 commands, with or without a slash', () => {
  const sh = mk();
  const a = run(sh, '/help');
  assert.ok(a.split('\n').filter((l) => /^ {2}\/?[a-z]+ {2,}\S/.test(l)).length >= 15);
  assert.equal(run(sh, 'help'), a);
});

test('tab completion: commands and paths', () => {
  const sh = mk();
  assert.equal(complete(sh, 'hel').line, 'help ');
  assert.equal(complete(sh, '/bui').line, '/build ');
  const many = complete(sh, 'h');
  assert.ok(many.options.includes('help') && many.options.includes('hint'));
  assert.equal(complete(sh, 'cat REA').line, 'cat README.txt ');
  assert.equal(complete(sh, 'cd no').line, 'cd notes/');
  assert.ok(complete(sh, 'ls .').options.includes('.hat_backwards'));
  assert.equal(complete(sh, 'cat ~/.hat').line, 'cat ~/.hat_backwards ');
  assert.equal(complete(sh, 'nothing-here').line, 'nothing-here');
});

test('filesystem: ls -a shows dotfiles, permissions block guests', () => {
  const sh = mk();
  assert.ok(!run(sh, 'ls').includes('.hat_backwards'));
  assert.match(run(sh, 'ls -a'), /\.hat_backwards/);
  assert.match(run(sh, 'cat /etc/shadow'), /Permission denied/);
  assert.match(run(sh, 'cd /root'), /Permission denied/);
  assert.match(run(sh, 'ls -l /etc'), /-rw-------/);
  run(sh, 'cd notes');
  assert.equal(sh.prompt(), 'guest@ph-origins:~/notes$');
  assert.match(run(sh, 'cat todo.txt | grep -i hat'), /hat/);
});

test('puzzle: strictly ordered, hints monotonic', () => {
  const p = new Puzzle();
  assert.equal(p.complete('root'), false);
  assert.equal(p.complete('crack'), false);
  assert.equal(p.complete('hat'), true);
  assert.equal(p.complete('loot'), false); // scan first
  assert.equal(p.complete('scan'), true);
  // a saved game with a gap keeps only the unbroken prefix
  assert.deepEqual(new Puzzle({ done: ['hat', 'loot', 'root'] }).done, ['hat']);
  const q = new Puzzle();
  const levels = [];
  let used = 0;
  for (let i = 0; i < 6; i += 1) { const h = q.hint(); levels.push(h.level); assert.ok(q.hintsUsed >= used); used = q.hintsUsed; }
  assert.deepEqual(levels, [1, 1, 1, 1, 1, 1]);
  q.complete('hat');
  assert.equal(q.hint().level, 1);
  assert.equal(q.hintsUsed, 2);
});

test('cannot reach root without the earlier steps', () => {
  const sh = mk();
  assert.match(run(sh, 'sudo less /var/log/syslog'), /not in the sudoers/);
  assert.match(run(sh, 'nmap tower.hawkes.lan'), /filtered/);
  assert.match(run(sh, 'curl gw.hawkes.lan:8080/backup/gw.cfg.bak'), /refused/);
  assert.match(run(sh, 'ssh ops@gw.hawkes.lan'), /refused/);
  assert.match(run(sh, 'john ~/README.txt'), /no password hashes/);
  // su root never works, even with the right ssh password
  run(sh, 'su root'); assert.equal(sh.prompt(), 'Password:');
  assert.match(run(sh, OPS_PASSWORD), /Authentication failure/);
  assert.equal(sh.user, 'guest');
  // the right ssh password without the cracking step is still refused
  run(sh, 'ssh ops@gw.hawkes.lan');
  sh.tick(10000);
  assert.equal(sh.user, 'guest');
  assert.match(run(sh, 'build'), /permission denied/);
  assert.match(run(sh, '/build'), /permission denied/);
});

function solve(sh) {
  assert.match(run(sh, 'rev ~/.hat_backwards'), /target: gw\.hawkes\.lan/);
  assert.match(run(sh, 'nmap gw.hawkes.lan'), /8080\/tcp\s+open/);
  assert.match(run(sh, 'curl gw.hawkes.lan:8080/backup/gw.cfg.bak'), /saved to ~\/loot/);
  assert.match(run(sh, 'john ~/loot/gw.cfg.bak'), /no password found/); // generic list fails
  assert.match(run(sh, 'john --wordlist=/usr/share/wordlists/hawkes-staff.txt ~/loot/gw.cfg.bak'), /roomforgrace58/);
  run(sh, 'ssh ops@gw.hawkes.lan');
  assert.equal(sh.prompt(), "ops@gw.hawkes.lan's password:");
  assert.match(run(sh, OPS_PASSWORD), /ACCESS GRANTED/);
}

/** The first "Type:  <command>" line of the LOGIN GUIDE in /help. */
const guideCmd = (sh) => { const m = run(sh, '/help').match(/^ {2}Type: {2}(.+)$/m); assert.ok(m, 'no Type: line in the guide'); return m[1]; };

test('the LOGIN GUIDE walks a stranger to root by typing only what it prints', () => {
  const sh = mk();
  for (let n = 1; n <= 5; n += 1) {
    const help = run(sh, '/help');
    assert.match(help.split('\n').slice(0, 3).join('\n'), /LOGIN GUIDE/);
    assert.match(help, new RegExp(`Step ${n} of 5`));
    const cmd = guideCmd(sh);
    assert.equal(run(sh, 'help'), help);
    assert.match(run(sh, 'hint'), new RegExp(`Next: ${cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.equal(complete(sh, '').line, cmd);
    const o = run(sh, cmd);
    if (n === 5) { assert.equal(sh.prompt(), "ops@gw.hawkes.lan's password:"); run(sh, OPS_PASSWORD); } else assert.match(o, /Next: \S/, `step ${n} output ends with a Next: pointer`);
    assert.equal(sh.puzzle.stepsDone, n);
  }
  assert.equal(sh.user, 'root');
  assert.match(run(sh, '/help'), /All 5 steps done/);
});

test('the guide never says simulation, fake or the old winks', () => {
  const sh = mk();
  const seen = [sh.boot().map((e) => e.text).join('\n'), ...['/help', 'hint', 'about', 'credits', 'man nmap', 'ping tower.hawkes.lan', 'nmap localhost', 'ps', 'top', 'cat notes/rules.txt', 'progress'].map((c) => run(sh, c))];
  solve(sh); seen.push(run(sh, '/build'), run(sh, 'cat /opt/hawkes-biomedical/README.md'), run(sh, 'deploy'), run(sh, 'y'));
  const all = seen.join('\n');
  for (const bad of [/simulat/i, /no real system/i, /BACKWARDS \(as expected\)/, /ground truth/i, /\bfake\b/i, /fictional/i, /nothing leaves/i, /no real data/i]) assert.doesNotMatch(all, bad);
});

test('old saved progress still loads (same step ids)', () => {
  const sh = mk();
  const old = { puzzle: { done: ['hat', 'scan', 'loot', 'crack'], hints: { hat: 3 }, hintsUsed: 3, extra: [] }, root: false };
  const again = new Shell({ load: () => old, save: () => {} });
  assert.equal(again.puzzle.stepsDone, 4);
  assert.match(run(again, '/help'), /Step 5 of 5/);
  const gap = new Shell({ load: () => ({ puzzle: { done: ['hat', 'loot'] } }), save: () => {} });
  assert.equal(gap.puzzle.stepsDone, 1);
});

test('the documented chain reaches root in five steps, and root persists', () => {
  const sh = mk();
  solve(sh);
  assert.equal(sh.user, 'root');
  assert.equal(sh.prompt(), 'root@ph-origins:/#');
  assert.equal(sh.puzzle.stepsDone, STEPS.length);
  const again = new Shell({ load: () => sh.store2.s, save: () => {} });
  assert.equal(again.user, 'root');
  sh.reset();
  assert.equal(sh.user, 'guest');
});

test('wrong guesses are throttled but never for long', () => {
  const sh = mk();
  run(sh, 'rev ~/.hat_backwards'); run(sh, 'nmap gw.hawkes.lan');
  let worst = 0;
  for (let i = 0; i < 8; i += 1) {
    sh.tick(10000);
    run(sh, 'ssh ops@gw.hawkes.lan');
    assert.match(run(sh, 'hunter2'), /denied|Nope|failed|guess|hat/i);
    worst = Math.max(worst, sh.throttle());
  }
  assert.ok(worst >= 1 && worst <= 5);
  assert.match(run(sh, 'ssh ops@gw.hawkes.lan'), /try again in \d+s/);
});

test('root commands: build, status, deploy confirm, rollback, whoami --root', () => {
  const sh = mk();
  solve(sh);
  assert.match(run(sh, 'whoami --root'), /earned/);
  assert.match(run(sh, 'status'), /NOT BUILT/);
  assert.match(run(sh, 'deploy'), /nothing to deploy/);
  const b = run(sh, '/build');
  assert.match(b, /BUILD SUCCESSFUL/);
  assert.match(run(sh, 'ls /opt/hawkes-biomedical'), /README\.md/);
  assert.match(run(sh, 'ls /opt/hawkes-biomedical/modules'), /patient-intake/);
  assert.match(run(sh, 'cat /opt/hawkes-biomedical/README.md'), /medical backend framework/);
  assert.match(run(sh, 'game'), /backend online/);
  run(sh, 'deploy'); assert.match(sh.prompt(), /\[y\/N\]/);
  assert.match(run(sh, 'n'), /aborted/);
  run(sh, 'deploy'); run(sh, 'y'); assert.ok(sh.deployed);
  run(sh, 'rollback'); run(sh, 'y'); assert.equal(sh.deployed, null);
  assert.match(run(sh, 'build status'), /COMPLETE/);
});

test('build runner: deterministic, 8+ named stages, 20 to 40 s, table and banner', () => {
  const a = runBuild({ seed: 58 });
  const b = runBuild({ seed: 58 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(runBuild({ seed: 7 }).summary.hash, a.summary.hash);
  assert.ok(a.seconds >= 20 && a.seconds <= 40, `build took ${a.seconds}s`);
  const heads = a.events.filter((e) => e.cls === 'head');
  assert.ok(heads.length >= 8);
  for (const m of MODULES) assert.ok(a.events.some((e) => e.text.includes(m.id)), m.id);
  assert.ok(a.events.some((e) => /\[#+-*\]/.test(e.text)));
  assert.ok(a.events.filter((e) => e.cls === 'warn').length >= 2);
  assert.ok(a.events.every((e, i) => i === 0 || e.at >= a.events[i - 1].at));
  const last = a.events.map((e) => e.text).join('\n');
  assert.match(last, /BUILD SUCCESSFUL/);
  assert.match(last, /TOTAL/);
  assert.ok(runBuild({ seed: 1, verbose: true }).events.length > runBuild({ seed: 1 }).events.length);
  const one = runBuild({ seed: 3, only: 'billing' });
  assert.ok(one.seconds < 12 && one.summary.modules.length === 1);
  const merged = mergeBuilt(mergeBuilt(null, one.summary), runBuild({ seed: 4, only: 'imaging' }).summary);
  assert.deepEqual(merged.modules.map((m) => m.id), ['imaging', 'billing']);
});

test('easter eggs and misc', () => {
  const sh = mk();
  assert.match(run(sh, 'sudo make me a sandwich'), /Make it yourself/);
  assert.match(run(sh, 'rm -rf /'), /dangerous/);
  assert.match(run(sh, 'hack the planet'), /HACK THE PLANET/);
  assert.match(run(sh, 'cowsay hi'), /\^__\^/);
  assert.ok(run(sh, 'fortune').length > 5);
  assert.match(run(sh, 'konami'), /up up/);
  assert.match(sh.konami().map((e) => e.text).join(''), /30 LIVES/);
  assert.equal(sh.user, 'guest'); // a cheat code never grants root
  assert.match(run(sh, 'ping tower.hawkes.lan'), /PING tower/);
  assert.match(run(sh, 'echo $USER'), /guest/);
  assert.match(run(sh, 'open about'), /opening about\.html/);
  assert.equal(sh.run('game').some((e) => e.k === 'go' && e.url === './play/game.html'), true);
});

// ---- the /build spectacle: flood, song, text flipbook
test('flood: thousands of lines, every stage and warning inside, deterministic', () => {
  const b = runBuild({ seed: 58 });
  const a = floodScript(b.events, 58);
  assert.deepEqual(a, floodScript(b.events, 58));
  assert.ok(a.length > 3000, `flood is ${a.length} lines`);
  for (const m of MODULES) assert.ok(a.some((l) => l.text.includes(m.id)), m.id);
  assert.ok(a.some((l) => /WARN/.test(l.text)) && a.some((l) => /FIX/.test(l.text)));
  assert.ok(a.some((l) => /\d+\/\d+ passed/.test(l.text)) && a.some((l) => /\[#+-*\]/.test(l.text)));
  assert.match(a.at(-1).text, /BUILD SUCCESSFUL|online/);
  const sh = mk();
  solve(sh);
  const seq = sh.run('/build').find((e) => e.k === 'seq');
  assert.ok(seq.show, 'a full build is the show');
  assert.ok(!sh.run('/build billing').find((e) => e.k === 'seq').show, 'a module build stays plain');
});

const GRIDS = [[40, 20], [80, 24], [40, 60]];
test('flipbook: a left and a right blob in every pose, left centre left of right centre', () => {
  assert.equal(BPM, 112);
  assert.ok(POSES_MJ.length >= 6 && POSES_MJ.length <= 10 && POSES_JORDAN.length >= 6 && POSES_JORDAN.length <= 10);
  for (const [cols, rows] of GRIDS) {
    const half = cols / 2;
    // every pose exactly (a key pose is reached at every 2 beats), and the in-betweens
    for (let beat = 0; beat < 16 * 2 + 1; beat += 0.5) {
      const m = rasterize(cols, rows, beat * BEAT_SEC);
      const l = blob(m, cols, 1);
      const r = blob(m, cols, 2);
      assert.ok(l.n >= 6, `left blob ${l.n} cells at beat ${beat} on ${cols}x${rows}`);
      assert.ok(r.n >= 6, `right blob ${r.n} cells at beat ${beat} on ${cols}x${rows}`);
      assert.ok(l.cx < r.cx, `left ${l.cx} < right ${r.cx} (beat ${beat}, ${cols}x${rows})`);
      for (let i = 0; i < m.length; i += 1) {
        if (m[i] === 1) assert.ok(i % cols < half);
        if (m[i] === 2) assert.ok(i % cols >= half);
      }
    }
  }
});

test('flipbook: consecutive frames at 16 fps differ, but only by small steps', () => {
  for (const [cols, rows] of GRIDS) {
    let changed = 0;
    let worst = 0;
    const N = 16 * 20; // twenty seconds of frames
    let prev = rasterize(cols, rows, 0);
    for (let i = 1; i <= N; i += 1) {
      const cur = rasterize(cols, rows, i / 16);
      let diff = 0;
      let union = 0;
      for (let k = 0; k < cur.length; k += 1) { if (cur[k] !== prev[k]) diff += 1; if (cur[k] || prev[k]) union += 1; }
      if (diff > 0) changed += 1;
      worst = Math.max(worst, diff / union);
      prev = cur;
    }
    assert.ok(changed > N * 0.7, `${changed} of ${N} frames differ on ${cols}x${rows}`);
    assert.ok(worst < 0.6, `largest frame step changes ${(worst * 100).toFixed(0)}% of the shape on ${cols}x${rows}`);
  }
});

test('flipbook: the text frame is the log text, in both halves, with no holes', () => {
  const src = Array.from({ length: 80 }, (_, i) => `compile patient-intake line ${i}`);
  const m = rasterize(80, 24, 1.3);
  const f = composeFrame(m, 80, 24, src);
  assert.ok(f.nl > 20 && f.nr > 20);
  assert.equal(f.left.split('\n').length, 24);
  assert.ok(f.left.split('\n').every((l) => l.length === 40) && f.right.split('\n').every((l) => l.length === 40));
  assert.match(f.left + f.right, /compile|patient|line/i);
  const still = staticFrame(64, 22);
  assert.ok(still.length === 22 && still.join('').replace(/\s/g, '').length > 60);
  assert.ok(still.every((l) => l.length <= 64));
});

test('root is the only account: su/ssh/login to anyone else fails, root commands refuse with the next step', () => {
  const sh = mk();
  for (const line of ['su guest', 'su admin', 'su kali', 'login admin', 'ssh admin@gw.hawkes.lan', 'ssh kali@gw.hawkes.lan']) {
    const out = run(sh, line);
    assert.match(out, /login disabled|locked|Permission denied|refused|not exist|not found/i, line);
    assert.equal(sh.user, 'guest', line);
    assert.equal(sh.prompt().includes('password'), false);
  }
  for (const c of ['/build', '/status', '/deploy', '/logs', '/services', '/rollback']) {
    const out = run(sh, c);
    assert.match(out, /permission denied/);
    assert.match(out, /Next login step: rev ~\/\.hat_backwards/, c); // one line, pointing at the guide's current step
    assert.equal(out.trim().split('\n').length, 1, c);
  }
  solve(sh);
  assert.equal(sh.user, 'root');
  assert.doesNotMatch(run(sh, '/status'), /permission denied/);
  assert.doesNotMatch(run(sh, '/build'), /permission denied/);
});

test('/build phases: a flood well over 1,000 lines a second, then the song, then a flipbook at 12-24 fps with both figures', async () => {
  const show = await import('../show.js');
  assert.ok(show.FLOOD_RATE > 1000);
  assert.ok(show.FLIP_FPS >= 12 && show.FLIP_FPS <= 24);
  assert.equal(show.SONG_FILE, 'song.mp3');
  // The figures animate through several distinct poses over the song, both on screen the whole time.
  const sig = new Set();
  for (let t = 0; t < 40; t += 1.07) {
    const m = rasterize(120, 40, t, { aspect: 1.9 });
    const l = blob(m, 120, 1);
    const r = blob(m, 120, 2);
    assert.ok(l.n > 150 && r.n > 150, `both figures solid at ${t}s`);
    assert.ok(l.cx < 60 && r.cx > 60, 'Jackson on the left, Jordan on the right');
    sig.add(`${Math.round(l.n / 25)}-${Math.round(r.n / 25)}-${Math.round(l.cx / 2)}-${Math.round(r.cx / 2)}`);
  }
  assert.ok(sig.size >= 5, `only ${sig.size} distinct poses`);
});
