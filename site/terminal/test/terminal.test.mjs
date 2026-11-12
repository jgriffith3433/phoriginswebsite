// Run with:  node --test site/terminal/test
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, parseCommand, tokenize, suggest } from '../parser.js';
import { complete } from '../complete.js';
import { Shell } from '../shell.js';
import { Puzzle } from '../puzzle.js';
import { runBuild, MODULES, mergeBuilt } from '../build.js';
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
  assert.deepEqual(levels, [1, 2, 3, 3, 3, 3]);
  q.complete('hat');
  assert.equal(q.hint().level, 1); // next step starts gentle again
  assert.equal(q.hintsUsed, 4);
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
  assert.match(run(sh, 'strings ~/loot/gw.cfg.bak'), /ops_hash=/);
  assert.match(run(sh, 'john ~/loot/gw.cfg.bak'), /no password found/); // generic list fails
  assert.match(run(sh, 'john --wordlist=/usr/share/wordlists/hawkes-staff.txt ~/loot/gw.cfg.bak'), /roomforgrace58/);
  run(sh, 'ssh ops@gw.hawkes.lan');
  assert.equal(sh.prompt(), "ops@gw.hawkes.lan's password:");
  assert.match(run(sh, OPS_PASSWORD), /Welcome to ph-origins/);
  assert.equal(sh.user, 'ops');
  assert.match(run(sh, 'sudo -l'), /NOPASSWD: \/usr\/bin\/less/);
  run(sh, 'sudo less /var/log/syslog');
  assert.equal(sh.prompt(), ':');
  assert.match(run(sh, '!sh'), /ACCESS GRANTED/);
}

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
  assert.match(run(sh, 'ping tower.hawkes.lan'), /simulated/);
  assert.match(run(sh, 'echo $USER'), /guest/);
  assert.match(run(sh, 'open about'), /opening about\.html/);
  assert.equal(sh.run('game').some((e) => e.k === 'go' && e.url === './play/game.html'), true);
});
