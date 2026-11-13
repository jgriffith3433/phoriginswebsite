// The /build spectacle, in three acts. The DOM side only; the data lives in build.js (the flood), dancers.js (the equations, farm and network data), choreo.js (the beat clock, the timeline and the moves) and stage.js (one frame of text cells). No
// fetches, no polling timers: requestAnimationFrame runs only while the show does, and the song is one <audio> element
// on the site root (/song.mp3, resolved against the page base, so it works under GitHub Pages).
//
//   Act 1  the log flood: hundreds to thousands of lines a second, batched per frame, one textContent write per frame.
//   Act 2  the song starts (or "(song.mp3 not found, playing silent)" and a fixed timer carries on).
//   Act 3  the performance: the equations that run the internet, a GPU farm and a network in text, a timeline of scenes fitted to the length of the
//          song, drawn on ONE <canvas> that is redrawn every frame (the DOM stays a handful of nodes).
//
// THE SHOW CANNOT BE SKIPPED. There is no skip function, no key, click or tap handler here that ends it early. It ends
// when the song ends, or when its fixed timer runs out (no audio, blocked autoplay, a song that never loads or stalls).

import { floodScript } from './build.js';
import { buildTimeline, SILENT_SECONDS, CALM_SECONDS, BPM, beatAt, BEAT_SEC } from './choreo.js';
import { createStage, makeBuffer, drawFrame, PALETTE, C } from './stage.js';
import { rng } from './util.js';

export const SONG_FILE = 'song.mp3';
export const FLOOD_RATE = 1600; // lines per second in act 1
export const FLOOD_MAX_BATCH = 2500; // lines per frame, so a stalled frame does not freeze the page catching up
export const FLIP_FPS = 60; // the most text frames per second drawn in act 3 (it drops to 30 on a slow device)
export const CALM_FPS = 5; // frames per second in the reduced-motion version
export const SILENT_NOTE = '(song.mp3 not found, playing silent)';
export { SILENT_SECONDS, CALM_SECONDS };
const BLOCK_ALPHA = { '\u2591': 0.15, '\u2592': 0.32, '\u2593': 0.6, '\u2588': 1 };
const KEEP = 400; // log lines kept live in the flood's text source
const AUDIO_WAIT_MS = 15000; // a song that has not started by then is treated as missing
const GRACE_MS = 30000; // wall-clock time allowed past the song's own length before the show ends itself

const el = (doc, tag, props = {}, ...kids) => {
  const e = doc.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
};
const clock = (secs) => `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

/** The text size and grid for a stage of w x h CSS pixels: at least 46 columns wide and 34 rows high, text 9-22 px. */
export function stageMetrics(w, h, ratio = 0.6) {
  const px = Math.max(9, Math.min(22, Math.floor(Math.min(w / (46 * ratio), h / (34 * 1.2)))));
  const cw = px * ratio;
  const lh = Math.round(px * 1.2);
  return { px, cw, lh, cols: Math.max(30, Math.floor(w / cw)), rows: Math.max(24, Math.floor(h / lh)) };
}

export function createShow({ root, doc, muted = false }) {
  const win = doc.defaultView;
  let box = null;
  let st = null; // the running show

  const build = () => {
    if (box) return box;
    const bg = el(doc, 'pre', { id: 'showBg', className: 'show-bg' });
    const canvas = el(doc, 'canvas', { id: 'showCanvas', className: 'show-canvas' });
    canvas.hidden = true;
    const stage = el(doc, 'div', { className: 'show-stage' }, bg, canvas);
    const stat = el(doc, 'span', { id: 'showStat', className: 'show-stat' });
    const note = el(doc, 'span', { id: 'showNote', className: 'show-note' });
    const mute = el(doc, 'button', { id: 'showMute', type: 'button', className: 'show-mute' });
    mute.setAttribute('aria-label', 'Mute the song');
    const hud = el(doc, 'div', { className: 'show-hud' }, stat, note, mute);
    const wrap = el(doc, 'div', { id: 'termShow', className: 'show' }, stage, hud);
    wrap.setAttribute('aria-hidden', 'true'); // a flood of lines and a dance are not something to read out; the finished log is
    wrap.hidden = true;
    root.append(wrap);
    box = { wrap, stage, bg, canvas, stat, note, mute };
    // A press on mute mutes. Nothing here, or anywhere else on the show, ends it.
    mute.addEventListener('click', () => api.toggleMute());
    return box;
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
    /** The text of the stage as it is drawn now, one string per row (for tests and screenshots). */
    frameText() { return st?.lastText?.() ?? []; },
    /**
     * start({ events, seed, songSeconds, calm, onDone }): events are runBuild's events. `songSeconds` is a test hook that
     * ends the song early (the real length is audio.duration). `calm` is the reduced-motion version: no flood, no sound,
     * a slow frame rate, no flashes, shakes or falling confetti, and a fixed timer of CALM_SECONDS.
     * onDone(info) runs once, when the show ends by itself. There is no way to end it from outside.
     */
    start({ events, seed = 58, songSeconds = null, calm = false, onDone }) {
      const b = build();
      b.wrap.hidden = false;
      b.bg.className = 'show-bg';
      b.bg.textContent = '';
      b.canvas.hidden = true;
      api.toggleMute(); api.toggleMute(); // paint the button label without changing the state
      const script = floodScript(events, seed);
      const now0 = performance.now();
      const s = {
        script, at: 0, lines: 0, frames: 0, ring: [], act: calm ? 'flip' : 'flood', t0: now0, last: now0, songT0: now0, audio: null,
        audioState: 'none', done: false, raf: 0, songSeconds, calm, scenesSeen: new Set(), eqSeen: new Set(), packetsSeen: 0,
        timeline: null, tlKey: '', stage: createStage({ seed }), lastDraw: 0, drawMs: 0, lowFx: false, fps: FLIP_FPS, ctx2d: null,
        metrics: null, buf: null, spec: null, analyser: null, actx: null, bins: null, lastStat: 0, hardEnd: Infinity, clockT: 0, lastAudioT: -1,
        lastAudioWall: now0, flashes: 0, shakes: 0, beats: 0, lastBeat: -1, text: [], dpr: 1, pxRatio: 0.6, fontFamily: '',
      };
      st = s;
      const d = b.wrap.dataset;
      Object.assign(d, { act: s.act, lines: '0', frames: '0', audio: 'none', scene: '', scenes: '0', equations: '0', packets: '0', flashes: '0', shakes: '0', beats: '0', calm: calm ? '1' : '0' });
      b.stat.textContent = calm ? 'CALM VERSION' : 'BUILDING';
      b.note.textContent = '';
      s.lastText = () => s.text;

      const closeAudio = () => {
        if (s.audio) { try { s.audio.pause(); } catch { /* ignore */ } s.audio.removeAttribute('src'); try { s.audio.load(); } catch { /* ignore */ } }
        if (s.actx) { try { s.actx.close(); } catch { /* ignore */ } }
      };
      // The one exit. Called only from the song's own end, or the fixed timer. Never from input.
      const finish = (why) => {
        if (s.done) return;
        s.done = true;
        win.cancelAnimationFrame(s.raf);
        win.removeEventListener('resize', onResize);
        closeAudio();
        b.wrap.hidden = true;
        b.canvas.hidden = true;
        st = null;
        const note = calm ? '(reduced motion: no sound.  type  play song  to hear song.mp3)' : s.audioState === 'silent' ? SILENT_NOTE : s.audioState === 'playing' || s.audioState === 'ended' ? '(song.mp3 stopped)' : '';
        onDone?.({ why, note, lines: s.lines, audio: s.audioState, scenes: [...s.scenesSeen] });
      };

      // ---- the canvas: sized to the stage, re-measured on resize (a phone turning, a keyboard coming up)
      const setup = () => {
        const w = Math.max(1, b.stage.clientWidth || root.clientWidth || 390);
        const h = Math.max(1, b.stage.clientHeight || 600);
        const dpr = Math.min(win.devicePixelRatio || 1, s.lowFx ? 1 : 2);
        b.canvas.width = Math.round(w * dpr);
        b.canvas.height = Math.round(h * dpr);
        b.canvas.style.width = `${w}px`;
        b.canvas.style.height = `${h}px`;
        const ctx = b.canvas.getContext('2d', { alpha: false });
        s.ctx2d = ctx;
        s.dpr = dpr;
        s.fontFamily = win.getComputedStyle(b.wrap).fontFamily || 'monospace';
        if (ctx) {
          ctx.font = `20px ${s.fontFamily}`;
          const ratio = ctx.measureText('MMMMMMMMMM').width / 200 || 0.6;
          s.pxRatio = ratio;
        }
        const m = stageMetrics(w, h, s.pxRatio);
        m.w = w; m.h = h;
        m.ox = Math.floor((w - m.cols * m.cw) / 2);
        s.metrics = m;
        s.buf = makeBuffer(m.cols, m.rows);
        s.bg = win.getComputedStyle(root).getPropertyValue('--bg').trim() || '#020a04';
        b.wrap.style.setProperty('--show-px', `${m.px}px`);
        d.cols = String(m.cols); d.rows = String(m.rows); d.px = String(m.px);
      };
      const onResize = () => { if (s.act === 'flip') setup(); else b.wrap.style.setProperty('--show-px', `${stageMetrics(b.stage.clientWidth || 390, b.stage.clientHeight || 600).px}px`); };
      win.addEventListener('resize', onResize);
      // the flood's own text size (it has no canvas): the same metrics
      b.wrap.style.setProperty('--show-px', `${stageMetrics(b.stage.clientWidth || 390, b.stage.clientHeight || 600).px}px`);
      const floodRows = () => Math.max(10, Math.floor((b.stage.clientHeight || 600) / (stageMetrics(b.stage.clientWidth || 390, b.stage.clientHeight || 600).px * 1.2)));

      // ---- the song: an <audio> element, optionally tapped by an analyser for the equalizer. A failure of any kind falls
      // back to the fixed timer, never to the end of the show.
      const goSilent = () => {
        if (s.audioState === 'silent') return;
        s.audioState = 'silent';
        d.audio = 'silent';
        b.note.textContent = SILENT_NOTE;
        s.songT0 = performance.now();
        s.timeline = null;
      };
      const startSong = () => {
        s.act = 'flip';
        d.act = 'flip';
        s.songT0 = performance.now();
        b.bg.textContent = '';
        b.canvas.hidden = false;
        setup();
        if (calm) { s.audioState = 'silent'; d.audio = 'silent'; b.note.textContent = '(reduced motion: calm version, no sound)'; return; }
        try {
          const a = new win.Audio();
          a.preload = 'auto';
          a.muted = muted;
          a.src = new URL(SONG_FILE, doc.baseURI).href;
          s.audio = a;
          s.audioState = 'pending';
          d.audio = 'pending';
          a.addEventListener('ended', () => { s.audioState = 'ended'; d.audio = 'ended'; finish('ended'); });
          a.addEventListener('error', goSilent);
          const play = () => {
            const p = a.play();
            if (p && p.then) {
              p.then(() => { if (s.audioState === 'pending') { s.audioState = 'playing'; d.audio = 'playing'; s.songT0 = performance.now(); s.timeline = null; } }).catch(goSilent);
            } else { s.audioState = 'playing'; d.audio = 'playing'; }
          };
          // An analyser makes the equalizer follow the real music. It is wired only when the audio context is really running
          // (a suspended one would silence the element), and only when the browser lets us; otherwise the beat clock drives it.
          const AC = win.AudioContext || win.webkitAudioContext;
          if (AC) {
            let actx = null;
            try {
              actx = new AC();
              const ready = actx.state === 'running' ? Promise.resolve() : Promise.race([actx.resume(), new Promise((r) => setTimeout(r, 250))]);
              ready.then(() => {
                if (s.done) return;
                if (actx.state === 'running') {
                  try {
                    const node = actx.createMediaElementSource(a);
                    const an = actx.createAnalyser();
                    an.fftSize = 256;
                    an.smoothingTimeConstant = 0.6;
                    node.connect(an);
                    an.connect(actx.destination);
                    s.actx = actx; s.analyser = an; s.bins = new Uint8Array(an.frequencyBinCount);
                    s.spec = new Float32Array(48);
                    actx.addEventListener('statechange', () => { if (actx.state === 'suspended') actx.resume().catch(() => {}); });
                  } catch { try { actx.close(); } catch { /* ignore */ } }
                } else { try { actx.close(); } catch { /* ignore */ } }
                play();
              }).catch(() => { play(); });
            } catch { try { actx?.close(); } catch { /* ignore */ } play(); }
          } else play();
        } catch { goSilent(); }
      };

      // ---- the clock: the audio's own currentTime when it is playing (extrapolated between its updates), else the wall clock
      const songTime = (now) => {
        const a = s.audio;
        if (s.audioState === 'playing' && a && Number.isFinite(a.currentTime)) {
          if (a.currentTime !== s.lastAudioT) { s.lastAudioT = a.currentTime; s.lastAudioWall = now; }
          return a.currentTime + Math.min(0.25, Math.max(0, (now - s.lastAudioWall) / 1000)) * (a.paused ? 0 : 1);
        }
        return (now - s.songT0) / 1000;
      };

      const readSpectrum = () => {
        if (!s.analyser) return null;
        s.analyser.getByteFrequencyData(s.bins);
        const n = s.spec.length;
        const top = s.bins.length * 0.75; // the top quarter is only air
        for (let k = 0; k < n; k += 1) {
          const lo = Math.floor((top * k * k) / (n * n)); // roughly logarithmic bands
          const hi = Math.max(lo + 1, Math.floor((top * (k + 1) * (k + 1)) / (n * n)));
          let m = 0;
          for (let i = lo; i < hi; i += 1) m = Math.max(m, s.bins[i]);
          s.spec[k] = Math.min(1, (m / 255) * (1 + (k / n) * 0.9));
        }
        return s.spec;
      };

      const textOf = () => {
        const out = [];
        const bf = s.buf;
        for (let r = 0; r < bf.rows; r += 1) out.push(bf.ch.slice(r * bf.cols, (r + 1) * bf.cols).join('').replace(/\s+$/, ''));
        return out;
      };

      // ---- paint the cell buffer onto the canvas: runs of one colour per row, glow only where the cell asks for it
      const paint = (fx) => {
        const ctx = s.ctx2d;
        const m = s.metrics;
        const bf = s.buf;
        if (!ctx) return;
        ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.fillStyle = s.bg;
        ctx.fillRect(0, 0, m.w, m.h);
        if (fx.flash > 0.01) {
          ctx.globalAlpha = Math.min(0.35, fx.flash);
          ctx.fillStyle = PALETTE[fx.flashColor] || '#fff';
          ctx.fillRect(0, 0, m.w, m.h);
          ctx.globalAlpha = 1;
        }
        const sx = fx.shake ? (Math.random() - 0.5) * 2 * fx.shake * m.cw * 0.7 : 0;
        const sy = fx.shake ? (Math.random() - 0.5) * 2 * fx.shake * m.lh * 0.45 : 0;
        ctx.font = `${m.px}px ${s.fontFamily}`;
        ctx.textBaseline = 'alphabetic';
        const base = Math.round(m.lh * 0.8);
        const glow = !s.lowFx;
        for (let r = 0; r < bf.rows; r += 1) {
          const y = r * m.lh + base + sy;
          let x = 0;
          while (x < bf.cols) {
            const i = r * bf.cols + x;
            const co = bf.co[i];
            const ch = bf.ch[i];
            if (co === 0 || ch === ' ') { x += 1; continue; }
            const g = bf.gl[i];
            if (ch.charCodeAt(0) > 127) { // a block character (the banner's pixels, the spotlight's shading): drawn as its cell, the way a terminal does
              const alpha = BLOCK_ALPHA[ch] ?? 1;
              ctx.shadowBlur = g && glow && alpha === 1 ? m.px * 0.5 : 0;
              ctx.shadowColor = PALETTE[co];
              ctx.globalAlpha = alpha;
              ctx.fillStyle = PALETTE[co];
              ctx.fillRect(m.ox + x * m.cw + sx, r * m.lh + sy, Math.ceil(m.cw) + (alpha === 1 ? 0.5 : 0), m.lh);
              ctx.globalAlpha = 1;
              x += 1;
              continue;
            }
            let e = x + 1;
            let run = ch;
            while (e < bf.cols && bf.co[r * bf.cols + e] === co && bf.gl[r * bf.cols + e] === g && bf.ch[r * bf.cols + e] !== ' ' && bf.ch[r * bf.cols + e].charCodeAt(0) < 128) { run += bf.ch[r * bf.cols + e]; e += 1; }
            ctx.fillStyle = PALETTE[co];
            if (g && glow) { ctx.shadowColor = PALETTE[co]; ctx.shadowBlur = m.px * 0.55; } else ctx.shadowBlur = 0;
            ctx.fillText(run, m.ox + x * m.cw + sx, y);
            x = e;
          }
        }
        ctx.shadowBlur = 0;
      };

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
          b.bg.textContent = s.ring.slice(-floodRows()).join('\n');
          d.lines = String(s.lines);
          b.stat.textContent = `BUILDING  ${s.lines.toLocaleString('en-US')} lines`;
          if (s.at >= s.script.length) startSong();
          return;
        }
        // ---- act 3: the performance
        if (s.audioState === 'pending' && now - s.songT0 > AUDIO_WAIT_MS) goSilent(); // the file never loaded: carry on silent
        const t = songTime(now);
        const a = s.audio;
        // which length is the show? the test hook, the song's own, or the fixed timer
        let dur = s.songSeconds != null ? s.songSeconds : calm ? CALM_SECONDS : SILENT_SECONDS;
        if (s.songSeconds == null && !calm && s.audioState === 'playing' && a && Number.isFinite(a.duration) && a.duration > 1) dur = a.duration;
        if (s.songSeconds != null && s.audioState === 'playing' && a && Number.isFinite(a.duration)) dur = Math.min(dur, a.duration);
        const key = `${dur.toFixed(2)}`;
        if (key !== s.tlKey || !s.timeline) { s.timeline = buildTimeline(dur); s.tlKey = key; }
        if (s.hardEnd === Infinity && (s.audioState === 'playing' || s.audioState === 'silent')) s.hardEnd = now + (dur * 1000) + GRACE_MS;
        // the end: the song's own `ended` event is the normal one; the clock reaching the end of the timeline, or the wall-clock cap, are the safety nets
        if (t >= dur + (s.audioState === 'playing' ? 2 : 0) || now > s.hardEnd) { finish('time'); return; }
        // frame pacing: full rate while the device keeps up, half rate when drawing is slow
        const minGap = 1000 / (calm ? CALM_FPS : s.fps) - 2;
        if (now - s.lastDraw < minGap) return;
        s.lastDraw = now;
        const t0 = performance.now();
        const fx = drawFrame(s.stage, s.buf, s.timeline, Math.min(t, dur), { calm, spec: calm ? null : readSpectrum(), lowFx: s.lowFx });
        if (fx.newBeat) { s.beats += 1; }
        paint(fx);
        const ms = performance.now() - t0;
        s.drawMs = s.drawMs ? s.drawMs * 0.9 + ms * 0.1 : ms;
        if (!calm && s.frames > 20) {
          if (s.drawMs > 12 && !s.lowFx) { s.lowFx = true; setup(); }
          if (s.drawMs > 24) s.fps = 30;
        }
        s.frames += 1;
        s.text = null;
        s.lastText = () => { s.text = textOf(); return s.text; };
        // bookkeeping the playtest reads
        s.scenesSeen.add(fx.scene);
        if (fx.state.eq?.text) s.eqSeen.add(fx.state.eq.text);
        s.packetsSeen = Math.max(s.packetsSeen, fx.state.net?.packets?.length ?? 0);
        if (fx.flash > 0.12) { s.flashes += 1; }
        if (fx.shake > 0.1) { s.shakes += 1; }
        d.frames = String(s.frames);
        d.scene = fx.scene;
        d.scenes = String(s.scenesSeen.size);
        d.equations = String(s.eqSeen.size);
        d.packets = String(s.packetsSeen);
        d.flashes = String(s.flashes);
        d.shakes = String(s.shakes);
        d.beats = String(s.beats);
        d.beat = String(Math.floor(beatAt(t)));
        if (now - s.lastStat > 250) {
          s.lastStat = now;
          const total = Math.max(dur, 1);
          b.stat.textContent = `INTERNET  ${clock(t)} / ${clock(total)}   ${BPM} BPM   ${fx.scene.toUpperCase()}`;
        }
      };
      if (calm) startSong(); // the reduced-motion version has no flood: straight to the stage
      s.raf = win.requestAnimationFrame(tick);
      return { active: true };
    },
    destroy() { box?.wrap.remove(); box = null; },
  };
  return api;
}

export { BEAT_SEC, C, rng };
