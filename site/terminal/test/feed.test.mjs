// /feed: the first live camera on the Moon, pointed at the Earth. The sky maths, the burned-in text, the layout on
// phones and desktops, the shell command (and /build sending you here), and the overlay itself in a fake browser.
// Run with:  node --test site/terminal/test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { ephemeris, hudText, connectScript, closingLines, phaseName, utcStamp, CAMERA } from '../lunar.js';
import { feedLayout, createFeed, TEXTURES } from '../feed.js';
import { createTerminal } from '../ui.js';
import { Shell, COMMANDS } from '../shell.js';

const at = (iso) => Date.parse(iso);

// ---- the sky
test('ephemeris: the Earth from the Moon is full at a new Moon and dark at a full Moon', () => {
  const full = ephemeris(at('2026-11-09T07:00:00Z')); // new Moon: the Earth is full from the Moon
  assert.ok(full.lit > 0.98, `lit ${full.lit}`);
  assert.equal(full.phase, 'FULL');
  const dark = ephemeris(at('2026-11-24T15:00:00Z')); // full Moon: the Earth is new from the Moon
  assert.ok(dark.lit < 0.02, `lit ${dark.lit}`);
  assert.equal(dark.phase, 'NEW');
});

test('ephemeris: the Sun is over the Tropic of Cancer at the June solstice, near Greenwich at noon UTC', () => {
  const e = ephemeris(at('2026-06-21T12:00:00Z'));
  assert.ok(Math.abs(e.subSun.lat - 23.44) < 0.2, `sub-solar lat ${e.subSun.lat}`);
  assert.ok(Math.abs(e.subSun.lon) < 3, `sub-solar lon ${e.subSun.lon}`);
  // the Moon is a light-second and a bit away, and the camera basis is orthonormal
  assert.ok(e.lightSeconds > 1.18 && e.lightSeconds < 1.36, `${e.lightSeconds}`);
  const { right, up, back } = e.cam;
  const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (const v of [right, up, back]) assert.ok(Math.abs(d(v, v) - 1) < 1e-9);
  assert.ok(Math.abs(d(right, up)) < 1e-9 && Math.abs(d(up, back)) < 1e-9 && Math.abs(d(right, back)) < 1e-9);
  assert.ok(up[2] > 0, 'north is up');
});

test('phase names cover the cycle', () => {
  assert.equal(phaseName(0.99, true), 'FULL');
  assert.equal(phaseName(0.01, false), 'NEW');
  assert.equal(phaseName(0.5, true), 'FIRST QUARTER');
  assert.equal(phaseName(0.79, false), 'WANING GIBBOUS');
  assert.equal(phaseName(0.2, true), 'WAXING CRESCENT');
});

// ---- the burned-in text and the log
test('hud: camera id, LIVE, a UTC stamp one light-time behind the wall clock, and short lines on a phone', () => {
  const now = at('2026-11-14T06:00:00Z');
  const e = ephemeris(now);
  const wide = hudText(now, e, { elapsed: 75 });
  assert.match(wide.tl.join(' '), /LUNA-1/);
  assert.equal(wide.tr[0], 'LIVE');
  assert.equal(wide.tr[1], 'REC 00:01:15');
  assert.match(wide.bl[0], /^2026-11-14 {2}05:59:58\.\d UTC$/);
  assert.match(wide.br.join(' '), /RNG .* KM .*DLY 1\.\d{3} S/);
  assert.match(wide.mid, /^EARTH \d+% LIT {2}[A-Z ]+$/);
  const narrow = hudText(now, e, { narrow: true });
  for (const l of [...narrow.tl, ...narrow.bl, ...narrow.br]) assert.ok(l.length <= 28, `"${l}" is too long for a phone`);
  assert.equal(utcStamp(at('2026-01-02T03:04:05.678Z')), '2026-01-02  03:04:05.6 UTC');
});

test('connect script: timed lines that name the camera and end on how to come back; closing line counts the turn', () => {
  const s = connectScript(at('2026-11-14T06:00:00Z'), { backendHash: 'abc123', fresh: true });
  assert.match(s[0].text, new RegExp(CAMERA.id));
  assert.ok(s.every((l, i) => i === 0 || l.at >= s[i - 1].at));
  assert.ok(s.at(-1).at < 3000, 'the picture comes up in under 3 s');
  assert.match(s.map((l) => l.text).join('\n'), /brought online[\s\S]*abc123[\s\S]*light time[\s\S]*Esc, q or the disconnect button/);
  const c = closingLines({ seconds: 3600 });
  assert.match(c[0].text, /feed closed after 01:00:00\. the Earth turned 15\.0 degrees/);
  assert.equal(closingLines({ seconds: 5, mode: '2d' }).length, 2);
});

// ---- layout
test('layout: the whole Earth and the horizon fit portrait phones, landscape phones and desktops', () => {
  for (const [w, h] of [[390, 844], [360, 640], [844, 390], [667, 375], [1280, 800], [1920, 1080], [768, 1024]]) {
    const L = feedLayout(w, h);
    assert.equal(L.portrait, h > w);
    assert.ok(L.cx - L.r >= 0 && L.cx + L.r <= w, `${w}x${h}: the Earth runs off the side`);
    assert.ok(L.cy - L.r > h * 0.08, `${w}x${h}: the Earth hits the top text`);
    assert.ok(L.cy + L.r < L.horizon, `${w}x${h}: the Earth sinks into the ground`);
    assert.ok(L.horizon < h * 0.9, `${w}x${h}: the bottom text has room`);
    assert.ok(L.r > Math.min(w, h) * 0.2, `${w}x${h}: the Earth is too small`);
  }
});

test('the textures are in the repo with their sources, and the song is gone', () => {
  const root = new URL('../../../', import.meta.url);
  for (const f of Object.values(TEXTURES)) assert.ok(existsSync(new URL(f, root)), f);
  assert.ok(existsSync(new URL('assets/feed/SOURCES.md', root)));
  assert.ok(!existsSync(new URL('site/terminal/song.mp3', root)), 'song.mp3 is gone');
  const term = readdirSync(new URL('site/terminal/', root));
  assert.ok(!term.some((f) => /\.(mp3|ogg|wav|m4a)$/.test(f)), 'no audio files in site/terminal');
});

// ---- the shell
const mkRoot = () => {
  let t = at('2026-11-14T06:00:00Z');
  const store = { s: null };
  const sh = new Shell({ load: () => store.s, save: (v) => { store.s = v; }, now: () => t });
  let guard = 0;
  while (!sh.isRoot && guard++ < 6) sh.run('hint');
  assert.ok(sh.isRoot);
  return sh;
};
const audioish = (effects) => effects.some((e) => e.k === 'song' || e.k === 'audio' || e.show || e.song || e.audio);

test('/feed opens the camera; /build sends you there and plays nothing; there is no song command', () => {
  const sh = mkRoot();
  const fx = sh.run('/feed');
  const seq = fx.find((e) => e.k === 'seq');
  assert.ok(seq && seq.feed === true, 'a seq that opens the feed');
  assert.ok(!audioish(fx));
  const b = sh.run('/build');
  assert.match(b.find((e) => e.k === 'print').text, /renamed[\s\S]*\/feed/);
  assert.ok(b.find((e) => e.k === 'seq')?.feed === true, '/build opens the feed');
  assert.ok(!audioish(b), '/build plays no audio');
  assert.equal(COMMANDS.song, undefined);
  assert.match(sh.run('song').map((e) => e.text).join(''), /command not found/);
  assert.equal(sh.run('help').map((e) => e.text).join(''), '/feed');
});

// ---- the overlay in a fake browser
function fakeEnv({ webgl = false } = {}) {
  let now = 0;
  const realNow = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  const rafs = [];
  const ctx2d = () => ({ measureText: () => ({ width: 40 }), setTransform() {}, fillRect() {}, clearRect() {}, fillText() {}, drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {}, putImageData() {}, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) });
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.style = { setProperty() {} }; this.dataset = {}; this.classList = { _s: new Set(), add: (c) => this.classList._s.add(c), remove: (c) => this.classList._s.delete(c), toggle: (c, on) => (on ? this.classList._s.add(c) : this.classList._s.delete(c)), contains: (c) => this.classList._s.has(c) }; this.handlers = {}; this.attrs = {}; this.hidden = false; this.clientWidth = 390; this.clientHeight = 700; this.textContent = ''; this.value = ''; this.className = ''; this.width = 0; this.height = 0; }
    append(...k) { this.children.push(...k); }
    appendChild(k) { this.children.push(k); return k; }
    insertBefore(k) { this.children.unshift(k); return k; }
    get firstChild() { return this.children[0]; }
    remove() {}
    replaceChildren() { this.children = []; }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k]; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
    fire(type, ev = {}) { for (const f of this.handlers[type] || []) f({ preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, target: this, ...ev }); }
    getContext(kind) { return kind === '2d' ? ctx2d() : (webgl ? null : null); }
    getBoundingClientRect() { return { width: 8, height: 12 }; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    focus() { env.focused = this; }
    blur() {}
    setSelectionRange() {}
    closest() { return null; }
  }
  let audios = 0;
  class NoAudio { constructor() { audios += 1; } }
  class Img { constructor() { this.complete = false; this.naturalWidth = 0; } }
  const win = {
    Audio: NoAudio, Image: Img, devicePixelRatio: 1, performance,
    requestAnimationFrame: (f) => { rafs.push(f); return rafs.length; },
    cancelAnimationFrame: () => { rafs.length = 0; },
    getComputedStyle: () => ({ fontFamily: 'monospace', getPropertyValue: () => '#020a04' }),
    addEventListener() {}, removeEventListener() {},
    location: { assign() {} },
  };
  const doc = { defaultView: win, baseURI: 'http://localhost/', createElement: (t) => new El(t), createTextNode: (t) => ({ t }), getSelection: () => null, activeElement: null, documentElement: { dataset: {} }, handlers: {}, addEventListener(t, f) { (this.handlers[t] ||= []).push(f); }, fire(t, ev = {}) { for (const f of this.handlers[t] || []) f({ preventDefault() {}, target: {}, ...ev }); } };
  const step = (ms) => { now += ms; const q = rafs.splice(0); for (const f of q) f(now); };
  const env = { win, doc, El, rafs, step, audios: () => audios, restore: () => { if (realNow) Object.defineProperty(performance, 'now', realNow); } };
  return env;
}

test('the overlay without WebGL: the 2D still runs frames, shows the HUD stat, closes by itself and frees the loop', () => {
  const env = fakeEnv();
  try {
    const root = new env.El('div');
    const feed = createFeed({ root, doc: env.doc });
    let done = null;
    const r = feed.start({ seconds: 3, onDone: (i) => { done = i; } });
    assert.equal(r.mode, '2d');
    const wrap = root.children.find((c) => c.attrs.role === 'dialog');
    assert.equal(wrap.hidden, false);
    assert.equal(wrap.dataset.state, 'live');
    assert.equal(env.focused, wrap, 'focus is on the feed, not on disconnect (a habitual Enter must not close it)');
    for (let i = 0; i < 60 && !done; i += 1) env.step(33);
    assert.ok(Number(wrap.dataset.frames) > 10, `${wrap.dataset.frames} frames`);
    const stat = wrap.children.find((c) => c.className === 'feed-bar').children[0];
    assert.match(stat.textContent, /s from the Moon/);
    for (let i = 0; i < 100 && !done; i += 1) env.step(33);
    assert.ok(done, 'closed by itself');
    assert.equal(done.mode, '2d');
    assert.equal(wrap.hidden, true);
    assert.equal(feed.active, false);
    assert.equal(env.rafs.length, 0, 'no frame loop left running');
    assert.equal(env.audios(), 0);
  } finally { env.restore(); }
});

test('the console: /feed opens the camera, keys never reach the prompt, Esc closes it and the log says so; no Audio anywhere', async () => {
  const env = fakeEnv();
  try {
    const ids = {};
    const root = new env.El('div');
    root.ownerDocument = env.doc;
    root.querySelector = (sel) => (ids[sel] ||= new env.El(sel));
    root.querySelectorAll = () => [];
    const store = {};
    const term = createTerminal(root, { storage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } }, reduced: true, gameUrl: (u) => u });
    const input = ids['#termInput'];
    let guard = 0;
    while (!term.shell.isRoot && guard++ < 6) term.shell.run('hint');
    assert.ok(term.shell.isRoot);
    for (const cmd of ['/feed', '/build']) {
      term.submit(cmd);
      assert.equal(term.feed.active, true, `${cmd} opened the feed`);
      assert.ok(root.classList.contains('is-feeding'));
      const log = ids['#termLog'];
      const before = log.children.length;
      for (const k of ['Enter', 'a', ' ', 'ArrowUp', 'Tab']) input.fire('keydown', { key: k });
      input.value = 'zz'; input.fire('input');
      for (let i = 0; i < 10; i += 1) env.step(100);
      assert.equal(term.feed.active, true, 'other keys do not close it');
      assert.equal(log.children.length, before, 'nothing printed under the feed');
      input.fire('keydown', { key: cmd === '/feed' ? 'Escape' : 'q' });
      assert.equal(term.feed.active, false, 'Esc / q closes it');
      assert.ok(!root.classList.contains('is-feeding'));
      assert.equal(input.value, '');
      assert.ok(log.children.some((c) => /feed closed after/.test(c.textContent)), 'the closing line is in the log');
    }
    assert.equal(env.audios(), 0, 'no Audio was made: there is no song');
  } finally { env.restore(); }
});
