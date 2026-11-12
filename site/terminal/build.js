// The /build runner: a pure function from (seed, options) to a timed list of output events. No timers here: the
// UI plays the events on its own clock, tests read them directly. Same seed, same log.

import { rng, hex, pad, lpad, bar } from './util.js';

export const MODULES = [
  { id: 'patient-intake', title: 'Patient intake', port: 8101, files: 42, tests: 118 },
  { id: 'records-vault', title: 'Records vault', port: 8102, files: 57, tests: 164 },
  { id: 'lab-results', title: 'Lab results', port: 8103, files: 49, tests: 141 },
  { id: 'imaging', title: 'Imaging store', port: 8104, files: 38, tests: 96 },
  { id: 'consent-ledger', title: 'Consent and audit ledger', port: 8105, files: 33, tests: 127 },
  { id: 'scheduling', title: 'Scheduling', port: 8106, files: 29, tests: 88 },
  { id: 'fhir-gateway', title: 'FHIR-style gateway', port: 8107, files: 61, tests: 203 },
  { id: 'notifications', title: 'Notifications', port: 8108, files: 21, tests: 64 },
  { id: 'deid-service', title: 'De-identification service', port: 8109, files: 27, tests: 109 },
  { id: 'billing', title: 'Billing', port: 8110, files: 36, tests: 92 },
];

export const VERSION = '5.8.0';

const DEPS = ['libfhir-lite', 'hawkes-crypto', 'vault-sdk', 'audit-chain', 'dicom-shim', 'hl7-bridge', 'tls13', 'ledger-core', 'zurich-formatter'];
const VERBOSE_FILES = ['schema', 'routes', 'validators', 'adapters', 'migrations', 'fixtures', 'handlers', 'policies'];

/** Total stage names in order, for status and docs. */
export const STAGES = ['resolve', ...MODULES.map((m) => m.id), 'integration', 'package'];

/**
 * @returns {{ events: {at:number,text:string,cls?:string,key?:string}[], summary: object, seconds: number }}
 */
export function runBuild({ seed = 58, only = null, verbose = false } = {}) {
  const r = rng(seed);
  const events = [];
  let t = 0;
  const say = (text, cls, wait = 0, key) => { t += wait; events.push({ at: Math.round(t), text, cls, key }); };
  const mods = only ? MODULES.filter((m) => m.id === only) : MODULES;
  const total = mods.length;
  // Pace so that a full build is about 28 s and a single module about 5 s (plus the fixed stages).
  const pace = 1;
  const den = only ? total + 1 : total + 3;

  say(`hawkes-build ${VERSION}  seed=${seed}  target=${only ?? 'all'}  ${verbose ? '(verbose)' : ''}`.trimEnd(), 'dim', 0);
  say('simulated build. no network, no patient data, no regrets.', 'dim', 250);

  // 1. resolve dependencies
  say('', '', 200);
  say(`[1/${den}] resolving dependencies`, 'head', 150);
  for (const dep of DEPS) {
    const ver = `${r.int(1, 4)}.${r.int(0, 9)}.${r.int(0, 12)}`;
    say(`  + ${pad(dep, 18)} ${ver}`, '', r.int(120, 260));
  }
  // a scripted warning, auto-fixed
  say('  WARN  vendor tls 1.0 pinned by hl7-bridge (deprecated)', 'warn', 380);
  say('  FIX   bumping to tls13 ... done', 'ok', 520);
  say(`  ${DEPS.length} packages resolved, 0 vulnerabilities (fictional)`, 'ok', 200);

  // 2. compile each module + its tests
  const results = [];
  let stage = 1;
  for (const m of mods) {
    stage += 1;
    say('', '', 120);
    say(`[${stage}/${den}] ${m.title} (${m.id})`, 'head', 100);
    const files = m.files + r.int(-2, 3);
    if (verbose) {
      for (let i = 0; i < 5; i += 1) {
        say(`    cc ${m.id}/src/${r.pick(VERBOSE_FILES)}-${r.int(1, 9)}.ts`, 'dim', r.int(40, 90));
      }
    }
    const ticks = 6;
    for (let i = 1; i <= ticks; i += 1) {
      say(`  compile ${bar(i / ticks, 14)} ${lpad(Math.round(files * i / ticks), 3)}/${files}`, '', r.int(110, 190) * pace, `c-${m.id}`);
    }
    if (m.id === 'lab-results') {
      say('  WARN  duplicate LOINC code 718-7 in lab-results/codes.json', 'warn', 260);
      say('  FIX   merged duplicate, kept the newer entry ... done', 'ok', 440);
    }
    const tests = m.tests + r.int(-3, 6);
    for (let i = 1; i <= 5; i += 1) {
      say(`  tests   ${bar(i / 5, 14)} ${lpad(Math.round(tests * i / 5), 3)}/${tests} passed`, '', r.int(90, 170) * pace, `t-${m.id}`);
    }
    const ms = r.int(1400, 4200);
    say(`  ok  ${m.id}  ${files} files, ${tests} tests, ${(ms / 1000).toFixed(1)}s`, 'ok', 120);
    results.push({ ...m, files, tests, ms });
  }

  // 3. integration + package (full builds only)
  let integration = 0;
  if (!only) {
    stage += 1;
    say('', '', 150);
    say(`[${stage}/${den}] integration suites`, 'head', 100);
    const suites = ['end-to-end intake to vault', 'consent revoked mid-visit', 'FHIR round trip (lab to gateway)', 'de-identified export is really de-identified', 'audit chain tamper check'];
    for (const s of suites) {
      const n = r.int(18, 41);
      integration += n;
      say(`  ${pad(s, 46)} ${lpad(n, 3)} passed`, '', r.int(380, 640));
    }
    stage += 1;
    say('', '', 150);
    say(`[${stage}/${den}] packaging /opt/hawkes-biomedical`, 'head', 100);
    for (let i = 1; i <= 6; i += 1) say(`  link    ${bar(i / 6, 14)}`, '', r.int(120, 220), 'link');
  }

  const tests = results.reduce((a, m) => a + m.tests, 0) + integration;
  const seconds = Math.round(t / 100) / 10;
  const hash = hex(`${seed}:${only ?? 'all'}:${tests}`, 12);
  const summary = { seed, only, version: VERSION, hash, modules: results, tests, integration, seconds, stages: total + (only ? 1 : 3) };

  say('', '', 200);
  const rows = [];
  rows.push(`${pad('module', 16)}${lpad('files', 6)}${lpad('tests', 7)}${lpad('time', 7)}`);
  rows.push('-'.repeat(36));
  for (const m of results) rows.push(`${pad(m.id, 16)}${lpad(m.files, 6)}${lpad(m.tests, 7)}${lpad((m.ms / 1000).toFixed(1) + 's', 7)}`);
  rows.push('-'.repeat(36));
  rows.push(`${pad('TOTAL', 16)}${lpad(results.reduce((a, m) => a + m.files, 0), 6)}${lpad(tests, 7)}${lpad(seconds.toFixed(1) + 's', 7)}`);
  for (const row of rows) say(row, 'table', 45);
  say('', '', 100);
  say(`build hash  ${hash}`, 'dim', 80);
  say('', '', 120);
  say('  ____  _   _ ___ _     ____    ____  _   _  ____ ____ _____ ____ ____ _____ _   _ _', 'banner art', 60);
  say(' | __ )| | | |_ _| |   |  _ \\  / ___|| | | |/ ___/ ___| ____/ ___/ ___|  ___| | | | |', 'banner art', 40);
  say(' |  _ \\| | | || || |   | | | | \\___ \\| | | | |  | |   |  _| \\___ \\___ \\ |_  | | | | |', 'banner art', 40);
  say(' | |_) | |_| || || |___| |_| |  ___) | |_| | |__| |___| |___ ___) |__) |  _| | |_| | |___', 'banner art', 40);
  say(' |____/ \\___/|___|_____|____/  |____/ \\___/ \\____\\____|_____|____/____/|_|    \\___/|_____|', 'banner art', 40);
  say('', '', 60);
  say(only ? `BUILD SUCCESSFUL  (${only})` : `BUILD SUCCESSFUL  ${results.length} modules, ${tests} tests, ${seconds.toFixed(1)}s`, 'banner', 120);
  say(only ? '  module installed under /opt/hawkes-biomedical/modules' : '  ls /opt/hawkes-biomedical   -- your backend is online (fictional, but still).', 'ok', 120);

  return { events, summary, seconds: Math.round(t) / 1000 };
}

/** Merge a finished build into the saved record (a module build adds to the set; a full build replaces it). */
export function mergeBuilt(prev, summary) {
  if (!summary.only) {
    return { hash: summary.hash, version: summary.version, seed: summary.seed, seconds: summary.seconds, tests: summary.tests, modules: summary.modules.map(slim) };
  }
  const base = prev || { hash: summary.hash, version: summary.version, seed: summary.seed, seconds: 0, tests: 0, modules: [] };
  const modules = [...base.modules.filter((m) => m.id !== summary.only), ...summary.modules.map(slim)];
  modules.sort((a, b) => MODULES.findIndex((x) => x.id === a.id) - MODULES.findIndex((x) => x.id === b.id));
  return { ...base, hash: summary.hash, tests: modules.reduce((a, m) => a + m.tests, 0), modules };
}

const slim = (m) => ({ id: m.id, title: m.title, port: m.port, files: m.files, tests: m.tests });
export const isComplete = (built) => !!built && MODULES.every((m) => built.modules.some((x) => x.id === m.id));

// ---- Act 1: the log flood. A pure list of lines: the real build events (stages, bars, counters, warnings, fixes)
// each preceded by a burst of filler compile / test / link / deploy lines across every module. The UI plays it at a
// rate of its own (hundreds to thousands of lines a second); nothing here touches a timer.

const FILE_WORDS = ['schema', 'routes', 'validators', 'adapters', 'migrations', 'fixtures', 'handlers', 'policies', 'codec', 'index', 'audit', 'session'];
const STAGES_FLOOD = ['cc', 'ld', 'ar', 'lint', 'tsc', 'pack', 'sign'];

/** One filler line of build noise. Deterministic for a given generator `r`. */
export function fillerLine(r) {
  const m = r.pick(MODULES).id;
  const f = `${r.pick(FILE_WORDS)}-${r.int(1, 9)}`;
  switch (r.int(0, 9)) {
    case 0: return `PASS ${m}/${f}.test.ts (${r.int(2, 90)} ms)`;
    case 1: return `  LD   ${m}.so  ${r.int(40, 900)}K  ${hex(f + m, 8)}`;
    case 2: return `[${m}] ${hex(f, 8)} typecheck ok  ${r.int(120, 9000)} symbols`;
    case 3: return `  AR   lib${m}.a  ${r.int(8, 80)} objects`;
    case 4: return `lint ${m}/src/${f}.ts  0 problems`;
    case 5: return `  CHK  ${hex(m + f, 12)}  ${m}/src/${f}.ts`;
    case 6: return `stage ${m} -> simulated-staging  ${lpad(r.int(1, 100), 3)}%`;
    case 7: return `sign  ${m}.pkg  sha256:${hex(m + r.int(0, 999), 16)}`;
    case 8: return `  ${r.pick(STAGES_FLOOD)}  ${m}/src/${f}.ts -> ${m}/out/${f}.js  ${r.int(1, 40)} ms`;
    default: return `cc ${m}/src/${f}.ts`;
  }
}

/** @returns {{text:string, cls?:string}[]} the whole flood, same seed same lines. */
export function floodScript(events, seed = 58, { perEvent = [22, 50] } = {}) {
  const r = rng(seed * 7919 + 11);
  const out = [];
  for (const e of events) {
    const n = r.int(perEvent[0], perEvent[1]);
    for (let i = 0; i < n; i += 1) out.push({ text: fillerLine(r) });
    for (const l of e.text.split('\n')) out.push({ text: l, cls: e.cls });
  }
  return out;
}
