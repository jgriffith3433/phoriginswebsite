// The /build spectacle, in three acts. The DOM side only; the data lives in build.js (the flood) and flipbook.js (the
// silhouettes). No fetches, no polling timers: requestAnimationFrame runs only while the show does, and the song is one
// <audio> element on the site root (/song.mp3, resolved against the page base, so it works under GitHub Pages).
//
//   Act 1  the log flood: hundreds to thousands of lines a second, batched per frame, one textContent write per frame.
//   Act 2  the song starts (or "(song.mp3 not found, playing silent)" and the clock carries on).
//   Act 3  the text flipbook: full-screen text frames at ~16 fps, the left half a dancer, the right half a player,
//          both made of the scrolling build log, on a 112 BPM beat read from the audio clock.

import { floodScript, fillerLine } from './build.js';
import { rasterize, composeFrame } from './flipbook.js';
import { rng } from './util.js';

export const SONG_FILE = 'song.mp3';
export const FLOOD_RATE = 1600; // lines per second in act 1
export const FLOOD_MAX_BATCH = 2500; // lines per frame, so a stalled frame does not freeze the page catching up
export const FLIP_FPS = 16; // text frames per second in act 3
export const SILENT_SECONDS = 30; // how long the flipbook runs when there is no audio
export const SILENT_NOTE = '(song.mp3 not found, playing silent)';
const KEEP = 400; // log lines kept live in the flipbook's text source

const el = (doc, tag, props = {}, ...kids) => {
  const e = doc.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
};

/** A static frame of both silhouettes as text lines (reduced motion, and the tests). */
export function staticFrame(cols = 64, rows = 24, seed = 58) {
  const r = rng(seed);
  const src = Array.from({ length: 120 }, () => fillerLine(r));
  const mask = rasterize(cols, rows, 2.05 * (60 / 112));
  const f = composeFrame(mask, cols, rows, src);
  const l = f.left.split('\n');
  const rr = f.right.split('\n');
  return l.map((x, i) => (x + rr[i]).replace(/\s+$/, ''));
}

export function createShow({ root, doc, muted = false }) {
  const win = doc.defaultView;
  let box = null;
  let st = null; // the running show

  const build = () => {
    if (box) return box;
    const bg = el(doc, 'pre', { id: 'showBg', className: 'show-bg' });
    const left = el(doc, 'pre', { id: 'flipL', className: 'show-fig show-left' });
    const right = el(doc, 'pre', { id: 'flipR', className: 'show-fig show-right' });
    const figs = el(doc, 'div', { className: 'show-figs' }, left, right);
    const stage = el(doc, 'div', { className: 'show-stage' }, bg, figs);
    const stat = el(doc, 'span', { id: 'showStat', className: 'show-stat' });
    const note = el(doc, 'span', { id: 'showNote', className: 'show-note' });
    const mute = el(doc, 'button', { id: 'showMute', type: 'button', className: 'show-mute' });
    mute.setAttribute('aria-label', 'Mute the song');
    const hud = el(doc, 'div', { className: 'show-hud' }, stat, note, mute);
    const wrap = el(doc, 'div', { id: 'termShow', className: 'show' }, stage, hud);
    wrap.setAttribute('aria-hidden', 'true'); // a flood of lines is not something to read out; the finished log is
    wrap.hidden = true;
    root.append(wrap);
    box = { wrap, stage, bg, left, right, figs, stat, note, mute };
    mute.addEventListener('pointerdown', (e) => e.stopPropagation()); // a tap on mute must not skip the show
    mute.addEventListener('click', () => api.toggleMute());
    return box;
  };

  const measure = (b) => {
    // Text size: at least 10 px (phones), up to 14 px on a wide screen. The cell is measured, not assumed.
    const w = Math.max(1, b.stage.clientWidth || root.clientWidth || 390);
    const h = Math.max(1, b.stage.clientHeight || 600);
    const px = Math.max(10, Math.min(14, Math.floor(w / 80)));
    b.wrap.style.setProperty('--show-px', `${px}px`);
    const probe = el(doc, 'span', { className: 'show-probe', textContent: 'M'.repeat(40) });
    b.stage.append(probe);
    const cw = probe.getBoundingClientRect().width / 40 || px * 0.6;
    probe.remove();
    const lh = px * 1.2;
    const cols = Math.max(20, Math.floor(w / cw));
    const rows = Math.max(10, Math.floor(h / lh));
    return { px, cols, rows, aspect: lh / cw };
  };

  const api = {
    get active() { return !!st; },
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      if (st?.audio) st.audio.muted = muted;
      if (box) { box.mute.textContent = muted ? 'sound: off' : 'sound: on'; box.mute.setAttribute('aria-pressed', String(muted)); }
      return muted;
    },
    /**
     * start({ events, seed, songSeconds, onDone }): events are runBuild's events. `songSeconds` is a test hook that ends
     * the song early; the real length is audio.duration. onDone(note) runs once, when the show ends or is skipped.
     */
    start({ events, seed = 58, songSeconds = null, onDone }) {
      const b = build();
      b.wrap.hidden = false;
      b.bg.className = 'show-bg';
      b.left.textContent = '';
      b.right.textContent = '';
      api.toggleMute(); api.toggleMute(); // paint the button label without changing the state
      const grid = measure(b);
      const script = floodScript(events, seed);
      const r = rng(seed + 5);
      const s = {
        grid, script, at: 0, lines: 0, frames: 0, ring: [], act: 'flood', t0: performance.now(), last: performance.now(),
        lastFlip: 0, songT0: 0, audio: null, audioState: 'none', note: '', done: false, raf: 0, cycle: 0, songSeconds,
        r, events,
      };
      st = s;
      const d = b.wrap.dataset;
      d.act = 'flood'; d.lines = '0'; d.frames = '0'; d.audio = 'none'; d.nl = '0'; d.nr = '0';
      b.stat.textContent = 'BUILDING';
      b.note.textContent = '';

      const finish = (why) => {
        if (s.done) return;
        s.done = true;
        win.cancelAnimationFrame(s.raf);
        if (s.audio) { try { s.audio.pause(); } catch { /* ignore */ } s.audio.removeAttribute('src'); try { s.audio.load(); } catch { /* ignore */ } }
        b.wrap.hidden = true;
        st = null;
        const note = s.audioState === 'silent' ? SILENT_NOTE : s.audioState === 'playing' || s.audioState === 'ended' ? '(song.mp3 stopped)' : '';
        onDone?.({ why, note, lines: s.lines, audio: s.audioState });
      };
      s.finish = finish;

      const startSong = () => {
        s.act = 'flip';
        d.act = 'flip';
        s.songT0 = performance.now();
        b.bg.classList.add('dim');
        const silent = () => {
          if (s.audioState === 'silent') return;
          s.audioState = 'silent';
          d.audio = 'silent';
          s.note = SILENT_NOTE;
          b.note.textContent = SILENT_NOTE;
        };
        try {
          const a = new win.Audio();
          a.preload = 'auto';
          a.muted = muted;
          a.src = new URL(SONG_FILE, doc.baseURI).href;
          s.audio = a;
          s.audioState = 'pending';
          d.audio = 'pending';
          a.addEventListener('ended', () => { s.audioState = 'ended'; finish('ended'); });
          a.addEventListener('error', silent);
          const p = a.play();
          if (p && p.then) {
            p.then(() => {
              if (s.audioState === 'pending') { s.audioState = 'playing'; d.audio = 'playing'; s.songT0 = performance.now(); }
            }).catch(silent);
          } else { s.audioState = 'playing'; d.audio = 'playing'; }
        } catch { silent(); }
      };

      const songTime = (now) => (s.audioState === 'playing' && s.audio && Number.isFinite(s.audio.currentTime) ? s.audio.currentTime : (now - s.songT0) / 1000);
      const clock = (secs) => `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

      const tick = (now) => {
        if (s.done) return;
        s.raf = win.requestAnimationFrame(tick);
        const dt = Math.min(0.25, (now - s.last) / 1000);
        s.last = now;
        if (s.act === 'flood') {
          const n = Math.min(FLOOD_MAX_BATCH, Math.max(1, Math.round(FLOOD_RATE * dt)), s.script.length - s.at);
          for (let i = 0; i < n; i += 1) s.ring.push(s.script[s.at + i].text);
          s.at += n;
          s.lines += n;
          if (s.ring.length > KEEP) s.ring.splice(0, s.ring.length - KEEP);
          const view = s.ring.slice(-grid.rows);
          b.bg.textContent = view.join('\n');
          d.lines = String(s.lines);
          b.stat.textContent = `BUILDING  ${s.lines.toLocaleString('en-US')} lines   tap to skip`;
          if (s.at >= s.script.length) startSong();
          return;
        }
        // act 3: flip a text frame at ~16 fps
        const t = songTime(now);
        const cap = s.songSeconds != null ? s.songSeconds : (s.audioState === 'silent' ? SILENT_SECONDS : Infinity);
        if (t >= cap) { finish('time'); return; }
        if (s.audioState === 'pending' && (now - s.songT0) > 15000) { /* the file never loaded: carry on silent */ s.audioState = 'silent'; d.audio = 'silent'; b.note.textContent = SILENT_NOTE; }
        if (now - s.lastFlip < 1000 / FLIP_FPS - 2) return;
        s.lastFlip = now;
        for (let i = 0; i < 3; i += 1) {
          s.cycle += 1;
          s.ring.push(s.cycle % 11 === 0 ? s.events[s.cycle % s.events.length].text || fillerLine(s.r) : fillerLine(s.r));
        }
        if (s.ring.length > KEEP) s.ring.splice(0, s.ring.length - KEEP);
        const mask = rasterize(grid.cols, grid.rows, t, { aspect: grid.aspect });
        const f = composeFrame(mask, grid.cols, grid.rows, s.ring);
        b.bg.textContent = f.bg;
        b.left.textContent = f.left;
        b.right.textContent = f.right;
        s.frames += 1;
        d.frames = String(s.frames);
        d.nl = String(f.nl);
        d.nr = String(f.nr);
        b.stat.textContent = `MJ x MJ  ${clock(t)}${Number.isFinite(s.audio?.duration) ? ` / ${clock(s.audio.duration)}` : ''}   112 BPM   esc to stop`;
      };
      s.raf = win.requestAnimationFrame(tick);
      return { skip: () => finish('skip') };
    },
    skip() { st?.finish?.('skip'); },
    destroy() { box?.wrap.remove(); box = null; },
  };
  return api;
}
