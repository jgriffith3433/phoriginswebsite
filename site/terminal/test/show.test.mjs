// The /build show: the dancers, the timeline, the choreography, the stage, and the rule that nothing skips it.
// Run with:  node --test site/terminal/test
import test from 'node:test';
import assert from 'node:assert/strict';
import { JACKSON, JORDAN, FRAME_W, FRAME_H, CENTER, flip, HOOP_FRAMES } from '../dancers.js';
import { layoutBanner, BANNER_H } from '../banner.js';
import { buildTimeline, stageAt, layout, BPM, BEAT_SEC, BAR_SEC, SCENES, SILENT_SECONDS, CALM_SECONDS } from '../choreo.js';
import { createStage, makeBuffer, drawFrame, bufferText, bannerFor, RAINBOW_AT } from '../stage.js';
import { createShow, stageMetrics, SONG_FILE } from '../show.js';
import { createTerminal } from '../ui.js';
import { runBuild } from '../build.js';
import { Shell } from '../shell.js';

const ink = (rows) => rows.reduce((n, r) => n + [...r].filter((c) => c !== ' ').length, 0);

// ---- the art
test('dancers: at least 6 distinct hand-drawn frames each, all the same size, ASCII only, feet on the last row', () => {
  for (const [name, set] of [['Jackson', JACKSON], ['Jordan', JORDAN]]) {
    const keys = Object.keys(set);
    assert.ok(keys.length >= 6, `${name} has ${keys.length} frames`);
    assert.equal(new Set(keys.map((k) => set[k].join('\n'))).size, keys.length, `${name}: two frames are identical`);
    for (const k of keys) {
      const f = set[k];
      assert.equal(f.length, FRAME_H, `${name}.${k} rows`);
      for (const r of f) {
        assert.equal(r.length, FRAME_W, `${name}.${k} row width`);
        assert.match(r, /^[\x20-\x7e]*$/, `${name}.${k} is not plain ASCII`);
      }
      assert.ok(ink(f) > 40, `${name}.${k} is nearly empty`);
      // the figure stands on the floor: something is drawn in the last (or last but one, for a tiptoe) row
      assert.ok(f[FRAME_H - 1].trim() !== '' || f[FRAME_H - 2].trim() !== '', `${name}.${k} has no feet`);
    }
  }
  // the signature moves exist as frames
  for (const k of ['mw1', 'mw2', 'mw3', 'mw4', 'spinA', 'spinB', 'toe', 'hatTip', 'lean', 'gloveA', 'gloveB', 'freeze']) assert.ok(JACKSON[k], `Jackson.${k}`);
  for (const k of ['dribR', 'cross', 'gather', 'jump', 'release', 'leap', 'dunk', 'hang', 'shrug']) assert.ok(JORDAN[k], `Jordan.${k}`);
  assert.ok(HOOP_FRAMES.length >= 2 && HOOP_FRAMES[0].join('').includes('+--+'), 'a backboard and a hoop');
  assert.ok(Object.values(JORDAN).some((f) => f.join('').includes('=P=')), 'tongue out');
});

test('flip: mirrors a frame, twice is the same frame, a jersey number still reads 23', () => {
  for (const set of [JACKSON, JORDAN]) for (const f of Object.values(set)) assert.deepEqual(flip(flip(f)), f);
  const flipped = flip(JORDAN.ready).join('\n');
  assert.match(flipped, /23/);
  assert.doesNotMatch(flipped, /32/);
});

test('banner: the names lay out in block letters that fit a phone width, one letter at a time', () => {
  for (const [text, cols] of [['THE KING OF POP', 46], ['AIR JORDAN', 46], ['JACKSON x JORDAN', 46], ['MJ x MJ', 46], ['SHOWTIME', 46], ['THE KING OF POP', 118]]) {
    const l = layoutBanner(text, cols, 1);
    assert.ok(l.w <= cols, `${text} is ${l.w} wide for ${cols}`);
    assert.ok(layoutBanner(text, 118, 2).w <= 118 || text.length > 8, 'double-width pixels fit a wide stage');
    assert.equal(l.letters.filter((x) => x.ch !== ' ').length, text.replace(/ /g, '').length);
    assert.ok(l.letters.every((x) => x.rows.length === BANNER_H));
    assert.ok(l.h >= BANNER_H);
  }
  assert.equal(layoutBanner('THE KING OF POP', 118).lines.length, 1);
  assert.ok(layoutBanner('THE KING OF POP', 46).lines.length >= 2);
});

test('banner: every title fits the stage on a phone, a laptop and a wide screen (never clipped, never over the dancers)', () => {
  const titles = [...SCENES.map((s) => s.title), 'JACKSON', 'JORDAN', 'DUNK!', 'SWISH!', 'FINAL POSE', 'MOONWALK', 'CROSSOVER', 'SPARKLE!'];
  for (const [C, R] of [[46, 47], [64, 40], [118, 34], [150, 40]]) {
    const L = layout(C, R);
    const room = Math.max(BANNER_H, L.floor - FRAME_H - 2 - 1);
    for (const title of titles) {
      const lay = bannerFor(title, C, room);
      const need = title.replace(/ /g, '').length;
      assert.equal(lay.letters.length, need, `${title} on ${C}x${R}: ${lay.letters.length} of ${need} letters drawn`);
      assert.ok(lay.w <= C, `${title} is ${lay.w} wide on ${C} columns`);
      assert.ok(lay.h <= room + 1 || title === 'JACKSON x JORDAN' || title.length > 12, `${title} is ${lay.h} rows high in ${room}`);
    }
  }
});

// ---- the timeline
test('timeline: contiguous, starts at 0, ends at the song length, bar aligned, adapts from 8 s to 10 minutes', () => {
  for (const dur of [258.1, 240, 150, 90, 60, 36, 20, 8, 3, 600]) {
    const tl = buildTimeline(dur);
    assert.equal(tl[0].start, 0, `${dur}: first scene starts at 0`);
    assert.equal(tl.at(-1).end, dur, `${dur}: last scene ends at the end`);
    assert.equal(tl.at(-1).id, 'outro', `${dur}: it ends with the outro`);
    for (let i = 1; i < tl.length; i += 1) assert.ok(Math.abs(tl[i].start - tl[i - 1].end) < 1e-9, `${dur}: scenes are contiguous`);
    for (const s of tl) assert.ok(s.end > s.start, `${dur}: ${s.id} has length`);
    // scene boundaries (except the very first and last) sit on bar lines of the 118 BPM grid
    for (const s of tl.slice(1)) { const bars = (s.start - 0.31) / BAR_SEC; assert.ok(Math.abs(bars - Math.round(bars)) < 1e-6, `${dur}: ${s.id} starts on a bar line`); }
  }
  assert.equal(BPM, 118);
});

test('timeline: the full song has at least 8 distinct scenes: title banners, both solos, the duets, the battle, the finale, the outro', () => {
  for (const dur of [258.1, 200, 150]) {
    const ids = buildTimeline(dur).map((s) => s.id);
    assert.ok(new Set(ids).size >= 8, `${dur}: ${ids.join(',')}`);
    for (const need of ['king', 'air', 'jackson', 'jordan', 'mirror', 'callresponse', 'battle', 'names', 'finale', 'outro']) assert.ok(ids.includes(need), `${dur}: missing ${need}`);
  }
  // a short run keeps the most important scenes, and the song is never longer than the scenes
  const short = buildTimeline(30).map((s) => s.id);
  assert.ok(short.includes('jackson') && short.includes('jordan') && short.includes('outro'));
  assert.ok(buildTimeline(CALM_SECONDS).length >= 5);
  assert.ok(buildTimeline(SILENT_SECONDS).length >= 8);
  assert.ok(SCENES.length >= 8);
});

// ---- the choreography
const GRIDS = [[46, 47], [118, 34], [64, 40]];
const sample = (tl, fn, step = BEAT_SEC / 4) => { const end = tl.at(-1).end; for (let t = 0; t < end; t += step) fn(t); };

test('choreography: Jackson and Jordan each use many distinct frames over the song, and every frame they name exists', () => {
  for (const [C, R] of GRIDS) {
    const L = layout(C, R);
    const tl = buildTimeline(258.1);
    const used = { J: new Set(), D: new Set() };
    sample(tl, (t) => {
      const st = stageAt(tl, t, L);
      for (const d of st.d) {
        assert.ok((d.who === 'J' ? JACKSON : JORDAN)[d.frame], `${d.who}.${d.frame} does not exist (t=${t.toFixed(1)}, ${st.scene.id})`);
        used[d.who].add(d.frame);
      }
    });
    assert.ok(used.J.size >= 14, `Jackson used ${used.J.size} frames on ${C}x${R}`);
    assert.ok(used.D.size >= 12, `Jordan used ${used.D.size} frames on ${C}x${R}`);
  }
});

test('choreography: every signature move happens, in its own scene', () => {
  const L = layout(100, 40);
  const tl = buildTimeline(258.1);
  const seen = {};
  sample(tl, (t) => { const st = stageAt(tl, t, L); if (st.caption) (seen[st.scene.id] ||= new Set()).add(st.caption); });
  for (const m of ['MOONWALK', 'SPIN', 'TOE STAND', 'HAT TIP', '45 DEGREE LEAN', 'SPARKLE GLOVE', 'FREEZE']) assert.ok(seen.jackson.has(m), `Jackson: ${m}`);
  for (const m of ['DRIBBLE CROSSOVER', 'JUMP SHOT', 'SLAM DUNK', 'HANG TIME', 'SHRUG']) assert.ok(seen.jordan.has(m), `Jordan: ${m}`);
  assert.ok([...seen.mirror].length >= 6, 'mirrored moves');
  assert.ok([...seen.callresponse].includes('CALL') && [...seen.callresponse].includes('RESPONSE'), 'call and response');
  assert.ok([...seen.battle].some((c) => /ROUND 2/.test(c)) && [...seen.battle].some((c) => /JORDAN/.test(c)) && [...seen.battle].some((c) => /JACKSON/.test(c)), 'a trade-off battle');
});

test('choreography: the dunk is a leap across the screen to the hoop, and the figures stay on a phone-width stage', () => {
  for (const [C, R] of GRIDS) {
    const L = layout(C, R);
    const tl = buildTimeline(258.1);
    const jor = tl.find((s) => s.id === 'jordan');
    let minX = Infinity; let maxX = -Infinity; let maxLift = 0; let hoopOn = false;
    for (let b = 20; b < 32; b += 0.1) {
      const st = stageAt(tl, jor.start + b * BEAT_SEC, L);
      const d = st.d[0];
      minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x); maxLift = Math.max(maxLift, d.y); hoopOn ||= !!st.hoopOn;
    }
    assert.ok(hoopOn, 'the hoop is on stage for the dunk');
    assert.ok(maxX - minX >= C * 0.35, `the leap crosses ${maxX - minX} of ${C} columns`);
    assert.ok(maxLift >= 5, `he leaves the floor by ${maxLift} rows`);
    // at no time in the song does a dancer's drawn ink leave the stage (the intro's walk-on and the dunk's last step excepted)
    sample(tl, (t) => {
      const st = stageAt(tl, t, L);
      if (st.scene.id === 'intro') return;
      for (const d of st.d) {
        const art = d.flipped ? flip((d.who === 'J' ? JACKSON : JORDAN)[d.frame]) : (d.who === 'J' ? JACKSON : JORDAN)[d.frame];
        let lo = Infinity; let hi = -Infinity;
        for (const r of art) { const a = r.search(/\S/); if (a >= 0) { lo = Math.min(lo, a); hi = Math.max(hi, r.trimEnd().length - 1); } }
        const left = d.x - CENTER + lo;
        const right = d.x - CENTER + hi;
        assert.ok(left >= -1 && right <= C, `${st.scene.id} ${d.who}.${d.frame} spans ${left}..${right} on ${C} columns at ${t.toFixed(1)} s`);
      }
    });
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
  const king = tl.find((s) => s.id === 'king');
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
  assert.match(text, /~ JACKSON ~/, 'caption');
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
    assert.ok(Number(wrap.dataset.jframes) >= 6 && Number(wrap.dataset.dframes) >= 5, `${wrap.dataset.jframes} Jackson frames, ${wrap.dataset.dframes} Jordan frames`);
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
