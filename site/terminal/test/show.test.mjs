// The /build show: the dancers, the timeline, the choreography, the stage, and the rule that nothing skips it.
// Run with:  node --test site/terminal/test
import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_EQUATIONS, EQUATIONS, DEFAULT_VARS, balanceEquation, formatEquation, equationsForDuration } from '../dancers.js';
import { readdirSync, readFileSync } from 'node:fs';
import { layoutBanner, BANNER_H } from '../banner.js';
import { buildTimeline, stageAt, layout, BPM, BEAT_SEC, BAR_SEC, SCENES, SILENT_SECONDS, CALM_SECONDS } from '../choreo.js';
import { createStage, makeBuffer, drawFrame, bufferText, bannerFor, RAINBOW_AT } from '../stage.js';
import { createShow, stageMetrics, SONG_FILE } from '../show.js';
import { createTerminal } from '../ui.js';
import { runBuild } from '../build.js';
import { Shell } from '../shell.js';

const ink = (rows) => rows.reduce((n, r) => n + [...r].filter((c) => c !== ' ').length, 0);

// ---- the equations
const need = (v) => assert.ok(v);
test('equations: J\'s four are in the data exactly as written, each on its own beat, and every equation balances as data', () => {
  const J = ['GPU + Text = Hearts - Credits', 'Hearts = GPU + Text + Credits', 'Credits = Hearts - GPU - Text', 'Hearts + Credits = GPU + Text + 2(Credits)'];
  assert.deepEqual(CORE_EQUATIONS, J);
  const beats = new Set();
  for (const text of J) {
    const eq = EQUATIONS.find((e) => e.text === text);
    need(eq);
    assert.equal(formatEquation(eq), text, 'terms and signs rebuild the text');
    assert.ok(eq.left.length >= 1 && eq.right.length >= 1, 'both sides listed');
    beats.add(eq.beat);
  }
  assert.equal(beats.size, 4, 'each on its own beat');
  // signs per the equation as J wrote it
  const e1 = EQUATIONS.find((e) => e.text === J[0]);
  assert.deepEqual(e1.left.map((t) => [t.term, t.sign]), [['GPU', '+'], ['Text', '+']]);
  assert.deepEqual(e1.right.map((t) => [t.term, t.sign]), [['Hearts', '+'], ['Credits', '-']]);
  const e3 = EQUATIONS.find((e) => e.text === J[2]);
  assert.deepEqual(e3.right.map((t) => [t.term, t.sign]), [['Hearts', '+'], ['GPU', '-'], ['Text', '-']]);
  const e4 = EQUATIONS.find((e) => e.text === J[3]);
  assert.equal(e4.right[2].coeff, 2);
  for (const eq of EQUATIONS) {
    const b = balanceEquation(eq, DEFAULT_VARS);
    assert.ok(b.balanced, `${eq.text}: ${b.leftValue} vs ${b.rightValue}`);
  }
});

test('equations: at least 20, each with a beat time inside the song, distinct texts, for every song length', () => {
  assert.ok(EQUATIONS.length >= 20, `${EQUATIONS.length}`);
  assert.equal(new Set(EQUATIONS.map((e) => e.text)).size, EQUATIONS.length);
  for (const dur of [258.1, 120, 60, 48, 20]) {
    const eqs = equationsForDuration(dur);
    assert.equal(eqs.length, EQUATIONS.length);
    for (const e of eqs) assert.ok(e.time > 0 && e.time < dur, `${e.text} at ${e.time} of ${dur}`);
  }
});

test('banner: equations lay out in block letters that fit a phone width', () => {
  for (const eq of EQUATIONS) for (const cols of [46, 118]) {
    const l = layoutBanner(eq.text, cols, 1);
    assert.ok(l.w <= cols || l.lines.some((x) => !x.includes(' ')), `${eq.text} is ${l.w} wide for ${cols}`);
    assert.ok(l.letters.every((x) => x.rows.length === BANNER_H));
  }
});

test('the show has no Michael Jackson or Michael Jordan anywhere in site/terminal', () => {
  const dir = new URL('..', import.meta.url);
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(new URL(`${f.name}/`, d)) : [new URL(f.name, d)]));
  for (const f of walk(dir)) {
    if (f.pathname.endsWith('show.test.mjs')) continue; // this test names them to look for them
    const txt = readFileSync(f, 'utf8');
    assert.doesNotMatch(txt, /jackson|jordan|moonwalk|king of pop|slam dunk/i, f.pathname);
  }
});

// ---- the timeline
test('timeline: contiguous scenes include the farm, the net, the fly-through, hearts, rapid equations, the finale and the outro', () => {
  for (const dur of [258.1, 200, 150, 60]) {
    const ids = buildTimeline(dur).map((s) => s.id);
    for (const n of ['boot', 'eq1', 'farm', 'net', 'hearts', 'rapid', 'finale', 'outro']) assert.ok(ids.includes(n), `${dur}: missing ${n}`);
  }
  assert.ok(buildTimeline(258.1).map((s) => s.id).includes('flythrough'));
  const short = buildTimeline(30).map((s) => s.id);
  assert.ok(short.includes('outro'));
  assert.ok(buildTimeline(CALM_SECONDS).length >= 5);
  assert.equal(buildTimeline(SILENT_SECONDS).at(-1).end, SILENT_SECONDS);
});

const GRIDS = [[46, 47], [118, 34], [64, 40]];
const sample = (tl, fn, step = BEAT_SEC / 4) => { const end = tl.at(-1).end; for (let t = 0; t < end; t += step) fn(t); };

test('choreography: all 20+ equations appear on stage over the song, with a farm of racks and a net of moving packets', () => {
  for (const [C, R] of GRIDS) {
    const L = layout(C, R);
    const tl = buildTimeline(258.1);
    const seen = new Set();
    let maxPackets = 0; let racks = 0; const packetXY = new Set();
    sample(tl, (t) => {
      const st = stageAt(tl, t, L);
      if (st.eq) seen.add(st.eq.text);
      maxPackets = Math.max(maxPackets, st.net.packets.length);
      racks = Math.max(racks, st.farm.racks?.length ?? 0);
      if (st.scene.id === 'net') for (const p of st.net.packets.slice(0, 3)) packetXY.add(`${p.x},${p.y}`);
    }, BEAT_SEC / 2);
    assert.ok(seen.size >= 20, `${seen.size} equations on ${C}x${R}`);
    for (const t of CORE_EQUATIONS) assert.ok(seen.has(t), `${t} shown`);
    assert.ok(maxPackets >= 3, `${maxPackets} packets`);
    assert.ok(packetXY.size > 6, 'packets move');
    assert.ok(racks >= 2, `${racks} racks`);
  }
});


// ---- the stage
test('stage: a frame is text on a grid that fits (no row wider than the stage), deterministic, and beat effects change on every beat', () => {
  for (const [C, R] of [[46, 47], [118, 34]]) {
    const tl = buildTimeline(258.1);
    const run = () => {
      const S = createStage({ seed: 58 });
      const buf = makeBuffer(C, R);
      const frames = [];
      const beats = [];
      for (let t = 5; t < 40; t += 1 / 30) {
        const fx = drawFrame(S, buf, tl, t, {});
        if (fx.newBeat) beats.push({ flash: fx.flash, text: bufferText(buf).slice(R - 6).join('\n') });
        if (frames.length < 6 && Math.abs(t - Math.round(t)) < 1 / 60) frames.push(bufferText(buf).join('\n'));
        assert.ok(bufferText(buf).every((l) => l.length <= C));
        assert.equal(buf.ch.length, C * R);
      }
      return { frames, beats };
    };
    const a = run();
    const b = run();
    assert.deepEqual(a.frames, b.frames, 'same seed, same show');
    assert.ok(a.beats.length > 50);
    assert.ok(a.beats.every((x) => x.flash > 0), 'a flash on every beat');
    let changed = 0;
    for (let i = 1; i < a.beats.length; i += 1) if (a.beats[i].text !== a.beats[i - 1].text) changed += 1;
    assert.ok(changed >= a.beats.length * 0.9, `the equalizer row changed on ${changed} of ${a.beats.length} beats`);
  }
});

test('stage: the title banner is coloured letter by letter, the equalizer, floor, marquee and caption are all drawn', () => {
  const tl = buildTimeline(258.1);
  const king = tl.find((s) => s.id === 'eq1');
  const S = createStage({ seed: 58 });
  const buf = makeBuffer(118, 34);
  const colors = new Set();
  for (let t = king.start + 1; t < king.start + 5; t += 1 / 20) {
    drawFrame(S, buf, tl, t, {});
    for (let i = 0; i < buf.ch.length; i += 1) if (buf.ch[i] === '\u2588' && buf.gl[i] && Math.floor(i / 118) < 12) colors.add(buf.co[i]);
  }
  assert.ok(colors.size >= 8, `${colors.size} colours in the banner`);
  assert.ok([...colors].every((c) => c >= RAINBOW_AT || c === 4), 'rainbow glow plus the white beat flash');
  const text = bufferText(buf).join('\n');
  assert.match(text, /~ LAW I/, 'caption');
  assert.match(text, /===|---/, 'floor');
  assert.match(text, /\^/, 'equalizer peaks');
  assert.match(text, /\*\*\*/, 'marquee');
});

test('stage: the calm version has no flash and no shake and no falling confetti, and still draws', () => {
  const tl = buildTimeline(CALM_SECONDS);
  const S = createStage({ seed: 58 });
  const buf = makeBuffer(46, 47);
  let drawn = 0;
  for (let t = 0; t < CALM_SECONDS; t += 0.2) {
    const fx = drawFrame(S, buf, tl, t, { calm: true });
    assert.equal(fx.flash, 0);
    assert.equal(fx.shake, 0);
    assert.equal(S.particles.length, 0);
    if (ink(bufferText(buf)) > 100) drawn += 1;
  }
  assert.ok(drawn > 100);
});

test('stage metrics: 46+ columns on a 390 px phone, text at least 9 px, 34+ rows; wide screens get bigger text, not more empty columns', () => {
  const phone = stageMetrics(390, 760);
  assert.ok(phone.cols >= 46 && phone.px >= 9 && phone.rows >= 34, JSON.stringify(phone));
  assert.ok(phone.cols * phone.cw <= 390 + 0.01);
  const desk = stageMetrics(1280, 756);
  assert.ok(desk.px > phone.px && desk.px <= 22 && desk.rows >= 34);
  assert.ok(stageMetrics(844, 300).rows >= 24);
});

// ---- nothing skips the show
// A small fake browser: a document of fake elements, a manual requestAnimationFrame and a clock we advance by hand.
function fakeEnv({ audio = 'ok' } = {}) {
  let now = 0;
  const realNow = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  const rafs = [];
  const listeners = [];
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.style = { setProperty() {} }; this.dataset = {}; this.classList = { _s: new Set(), add: (c) => this.classList._s.add(c), remove: (c) => this.classList._s.delete(c), toggle: (c, on) => (on ? this.classList._s.add(c) : this.classList._s.delete(c)), contains: (c) => this.classList._s.has(c) }; this.handlers = {}; this.attrs = {}; this.hidden = false; this.clientWidth = 390; this.clientHeight = 700; this.textContent = ''; this.value = ''; this.className = ''; }
    append(...k) { this.children.push(...k); }
    appendChild(k) { this.children.push(k); return k; }
    remove() {}
    replaceChildren() { this.children = []; }
    setAttribute(k, v) { this.attrs[k] = v; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); listeners.push([this, type]); }
    fire(type, ev = {}) { for (const f of this.handlers[type] || []) f({ preventDefault() {}, stopPropagation() {}, target: this, ...ev }); }
    getContext() { return { measureText: () => ({ width: 120 }), setTransform() {}, fillRect() {}, fillText() {}, set font(v) {}, set fillStyle(v) {}, set globalAlpha(v) {}, set shadowBlur(v) {}, set shadowColor(v) {}, set textBaseline(v) {} }; }
    getBoundingClientRect() { return { width: 8, height: 12 }; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    focus() {}
    setSelectionRange() {}
    closest() { return null; }
  }
  const instances = [];
  class FakeAudio {
    constructor() { this.handlers = {}; this.currentTime = 0; this.duration = NaN; this.paused = true; this.muted = false; instances.push(this); }
    addEventListener(t, f) { (this.handlers[t] ||= []).push(f); }
    play() {
      if (audio === 'throws') throw new Error('no audio');
      if (audio === 'blocked') return Promise.reject(new Error('NotAllowedError'));
      if (audio === 'never') return new Promise(() => {});
      this.paused = false; this.duration = this.len ?? 120;
      return Promise.resolve();
    }
    pause() { this.paused = true; }
    removeAttribute() {}
    load() {}
    emit(t) { for (const f of this.handlers[t] || []) f({}); }
  }
  const win = {
    Audio: FakeAudio, devicePixelRatio: 1,
    requestAnimationFrame: (f) => { rafs.push(f); return rafs.length; },
    cancelAnimationFrame: () => { rafs.length = 0; },
    getComputedStyle: () => ({ fontFamily: 'monospace', getPropertyValue: () => '#020a04' }),
    addEventListener() {}, removeEventListener() {},
    location: { assign() {} },
  };
  const doc = { defaultView: win, baseURI: 'http://localhost/', createElement: (t) => new El(t), createTextNode: (t) => ({ t }), getSelection: () => null, activeElement: null, documentElement: { dataset: {} }, handlers: {}, addEventListener(t, f) { (this.handlers[t] ||= []).push(f); }, fire(t, ev = {}) { for (const f of this.handlers[t] || []) f({ preventDefault() {}, target: {}, ...ev }); } };
  const step = (ms) => { now += ms; const q = rafs.splice(0); for (const f of q) f(now); };
  const run = (seconds, fps = 30, each = null) => { for (let i = 0; i < seconds * fps; i += 1) { step(1000 / fps); each?.(i); } };
  return { win, doc, El, rafs, step, run, instances, listeners, restore: () => { if (realNow) Object.defineProperty(performance, 'now', realNow); }, time: () => now };
}

test('the show has no skip: no skip function, no input handler on the show, the song file is song.mp3', () => {
  const env = fakeEnv();
  try {
    const root = new env.El('div');
    const show = createShow({ root, doc: env.doc });
    assert.equal(show.skip, undefined);
    assert.equal(show.stop, undefined);
    assert.equal(show.abort, undefined);
    const ret = show.start({ events: runBuild({ seed: 58 }).events, seed: 58, songSeconds: 5, onDone() {} });
    assert.equal(ret.skip, undefined);
    assert.equal(typeof ret.finish, 'undefined');
    // the only handler registered on anything in the show is the mute button's click
    const wrap = root.children[0];
    const handlers = env.listeners.filter(([el]) => el !== env.doc).map(([el, type]) => `${el.tag}:${type}`);
    assert.deepEqual([...new Set(handlers)], ['button:click'], 'only the mute button listens');
    assert.equal(wrap.handlers.keydown, undefined);
    assert.equal(wrap.handlers.pointerdown, undefined);
    assert.equal(SONG_FILE, 'song.mp3');
  } finally { env.restore(); }
});

test('the show runs the flood, then the song, then the dance, and ends only when the song ends', async () => {
  const env = fakeEnv();
  try {
    const root = new env.El('div');
    const show = createShow({ root, doc: env.doc });
    let done = null;
    show.start({ events: runBuild({ seed: 58 }).events, seed: 58, onDone: (i) => { done = i; } });
    const wrap = root.children[0];
    env.run(2); // the flood: well over 1,000 lines a second
    assert.equal(wrap.dataset.act, 'flood');
    assert.ok(Number(wrap.dataset.lines) > 1500, `${wrap.dataset.lines} lines in 2 s`);
    // run until the song starts
    for (let i = 0; i < 600 && wrap.dataset.act !== 'flip'; i += 1) env.step(33);
    assert.equal(wrap.dataset.act, 'flip');
    env.step(33); await Promise.resolve(); await Promise.resolve(); env.step(33);
    assert.equal(wrap.dataset.audio, 'playing');
    const a = env.instances[0];
    assert.equal(a.len, undefined);
    // the song is 60 s long here: play it with its own clock
    a.duration = 60;
    const seen = new Set();
    let t = 0;
    while (!done && t < 70) {
      a.currentTime = t;
      env.step(1000 / 30);
      t += 1 / 30;
      seen.add(wrap.dataset.scene);
      assert.ok(!done || t >= 59, `ended at ${t.toFixed(1)} s of a 60 s song`);
      if (t > 40) assert.ok(!wrap.hidden || done);
    }
    assert.ok(seen.size >= 5, `scenes seen: ${[...seen]}`);
    assert.ok(done, 'the show ended by itself');
    assert.equal(wrap.hidden, true);
    assert.equal(show.active, false);
    assert.ok(Number(wrap.dataset.equations) >= 8 && Number(wrap.dataset.packets) >= 3, `${wrap.dataset.equations} equations, ${wrap.dataset.packets} packets`);
    assert.ok(Number(wrap.dataset.beats) > 40, 'a beat is counted every beat');
  } finally { env.restore(); }
});

for (const mode of ['throws', 'blocked', 'never']) {
  test(`the show survives a song that fails (${mode}): the fixed timer runs the whole length, then it ends by itself`, () => {
    const env = fakeEnv({ audio: mode });
    try {
      const root = new env.El('div');
      const show = createShow({ root, doc: env.doc });
      let done = null;
      show.start({ events: runBuild({ seed: 58 }).events, seed: 58, onDone: (i) => { done = i; } });
      const wrap = root.children[0];
      let started = null;
      let t = 0;
      while (!done && t < 400) {
        env.step(1000 / 20); t += 1 / 20;
        if (wrap.dataset.act === 'flip' && started == null) started = t;
        if (mode === 'throws' || mode === 'blocked') { /* the fallback fires at once */ }
      }
      assert.ok(done, 'it ended by itself');
      assert.equal(done.audio, 'silent');
      assert.match(done.note, /song\.mp3 not found/);
      const dance = t - started;
      const lo = mode === 'never' ? 15 + SILENT_SECONDS - 3 : SILENT_SECONDS - 3;
      assert.ok(dance >= lo, `the dance ran ${dance.toFixed(1)} s (at least ${lo})`);
      assert.ok(dance <= SILENT_SECONDS + 22, `and ended in time (${dance.toFixed(1)} s)`);
      assert.ok(Number(wrap.dataset.scenes) >= 8, `${wrap.dataset.scenes} scenes in the silent version`);
    } finally { env.restore(); }
  });
}

test('the reduced-motion version is calm and also cannot be skipped: no flood, no sound, a fixed timer', () => {
  const env = fakeEnv();
  try {
    const root = new env.El('div');
    const show = createShow({ root, doc: env.doc });
    let done = null;
    show.start({ events: runBuild({ seed: 58 }).events, seed: 58, calm: true, onDone: (i) => { done = i; } });
    const wrap = root.children[0];
    assert.equal(wrap.dataset.act, 'flip', 'no flood');
    let t = 0;
    while (!done && t < 100) { env.step(100); t += 0.1; }
    assert.equal(env.instances.length, 0, 'no audio element');
    assert.ok(done);
    assert.ok(t >= CALM_SECONDS - 1 && t <= CALM_SECONDS + 3, `${t.toFixed(1)} s`);
    assert.equal(wrap.dataset.flashes, '0');
    assert.equal(wrap.dataset.shakes, '0');
  } finally { env.restore(); }
});

// The terminal around it: keys, taps and buttons while the show plays do nothing, and the prompt is clean afterwards.
test('input never skips the show: keys (Esc, Enter, Ctrl+C, letters), taps, a soft keyboard and the quick-key buttons are swallowed', async () => {
  const env = fakeEnv();
  try {
    const ids = {};
    const root = new env.El('div');
    root.ownerDocument = env.doc;
    root.querySelector = (sel) => (ids[sel] ||= new env.El(sel));
    root.querySelectorAll = () => [];
    const store = {};
    const term = createTerminal(root, { storage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } }, reduced: false, gameUrl: (u) => u, songSeconds: 20 });
    const input = ids['#termInput'];
    // boot (real timers, about 1.2 s), then become root with the three steps the guide prints
    await new Promise((r) => setTimeout(r, 1400));
    for (const c of ['rev ~/.hat_backwards', 'nmap gw.hawkes.lan', 'curl http://gw.hawkes.lan/backup.tgz', 'john --wordlist=/usr/share/wordlists/hawkes-staff backup.tgz', 'ssh ops@gw.hawkes.lan']) term.shell.run(c);
    if (!term.shell.isRoot) term.shell.run('hint');
    let guard = 0;
    while (!term.shell.isRoot && guard++ < 6) term.shell.run('hint');
    assert.ok(term.shell.isRoot, 'root');
    term.submit('/build');
    assert.equal(term.show.active, true, 'the show started');
    const log = ids['#termLog'];
    const before = log.children.length;
    const key = (k, extra = {}) => input.fire('keydown', { key: k, ...extra });
    const wrap = root.children.find((c) => c.id === 'termShow');
    // 1. a minute of hammering every kind of input, through the flood, the song and the dance
    let t = 0;
    let n = 0;
    while (t < 12) {
      env.step(50); t += 0.05; n += 1;
      if (n % 3 === 0) {
        for (const k of ['Escape', 'Enter', ' ', 'a', 'Backspace', 'ArrowUp', 'Tab']) key(k);
        key('c', { ctrlKey: true });
        input.value = 'zz'; input.fire('input'); // a soft keyboard puts text in the field
        assert.equal(input.value, '', 'typed text never reaches the prompt');
        root.fire('pointerdown'); root.fire('pointerup'); root.fire('click');
        env.doc.fire('keydown', { key: 'x' });
        input.fire('submit');
      }
      assert.equal(term.show.active, true, `the show was cut short at ${t.toFixed(1)} s`);
    }
    assert.equal(wrap.hidden, false);
    assert.ok(Number(wrap.dataset.lines) > 100, 'the flood ran');
    // no stray echo lines or ^C landed in the log under the show
    assert.equal(log.children.length, before, 'nothing was printed while the show played');
    // 2. let it finish on its own (songlen 20 s)
    let guard2 = 0;
    while (term.show.active && guard2++ < 5000) env.step(50);
    assert.equal(term.show.active, false, 'it ended by itself');
    assert.equal(input.value, '', 'the prompt is clean');
    assert.ok(log.children.some((c) => /BUILD SUCCESSFUL|online/.test(c.textContent)), 'the log and BUILD SUCCESSFUL follow');
    assert.equal(term.shell.isRoot, true);
    // 3. keys work again afterwards
    key('Enter');
    assert.equal(term.show.active, false);
  } finally { env.restore(); }
});
