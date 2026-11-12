// The stage: draws one frame of the /build show into a grid of text cells (a character, a colour, a glow flag per cell).
// Pure: no DOM, no timers. show.js paints the grid onto a canvas (one canvas, redrawn, so the DOM stays tiny); the tests
// read it back as text. Everything here is ASCII except the spotlight's shading blocks.
//
// Layers, back to front: stars, spotlights, the stage floor and the dancers' reflections, the dancers, the hoop, the
// ball, falling sparkles and confetti, the name banner (a colour per letter, a wave, a glow), speech bubbles, the
// equalizer, the marquee, the caption. Beat effects (a flash, a shake) come back as numbers for the painter.

import { JACKSON, JORDAN, FRAME_W, FRAME_H, CENTER, HOOP_FRAMES, HOOP_W, HOOP_H, flip } from './dancers.js';
import { layoutBanner, BANNER_H } from './banner.js';
import { stageAt, layout, beatPulse, beatAt, BEAT_SEC, BPM, hoopWanted } from './choreo.js';
import { rng } from './util.js';

// ---- the palette: fixed colours first, then a rainbow of RAINBOW hues
export const C = {
  NONE: 0, DIM: 1, FG: 2, BRIGHT: 3, WHITE: 4, AMBER: 5, RED: 6, CYAN: 7, MAGENTA: 8, BLUE: 9, ORANGE: 10, GOLD: 11, DEEP: 12,
  JACK: 13, JORD: 14, SPOT_M: 15, SPOT_C: 16, SPOT_G: 17, SPOT_R: 18, FLOOR: 19, REFL: 20,
};
export const RAINBOW = 24;
export const RAINBOW_AT = 24;
export const PALETTE = [
  'rgba(0,0,0,0)', '#26a653', '#3dff7a', '#b8ffd0', '#ffffff', '#ffd166', '#ff5a4a', '#5ff3ff', '#ff5ad1', '#6a8cff', '#ff9f43', '#ffe066', '#14702f',
  '#cfeaff', '#ff5a4a', '#ff5ad1', '#5ff3ff', '#ffe066', '#ff6a4a', '#1d8a49', '#2a5f8f', '#000000', '#000000', '#000000',
  ...Array.from({ length: RAINBOW }, (_, i) => `hsl(${Math.round((i * 360) / RAINBOW)},100%,62%)`),
];
const rainbow = (i) => RAINBOW_AT + ((((Math.floor(i) % RAINBOW) + RAINBOW) % RAINBOW));

// ---- the cell buffer
export function makeBuffer(cols, rows) {
  const n = cols * rows;
  return { cols, rows, ch: new Array(n).fill(' '), co: new Uint8Array(n), gl: new Uint8Array(n) };
}
export function clearBuffer(b) { b.ch.fill(' '); b.co.fill(0); b.gl.fill(0); }
export function bufferText(b) {
  const out = [];
  for (let r = 0; r < b.rows; r += 1) out.push(b.ch.slice(r * b.cols, (r + 1) * b.cols).join('').replace(/\s+$/, ''));
  return out;
}
const put = (b, x, y, ch, co, gl = 0) => {
  if (x < 0 || y < 0 || x >= b.cols || y >= b.rows || ch === ' ') return;
  const i = y * b.cols + x;
  b.ch[i] = ch; b.co[i] = co; b.gl[i] = gl;
};
const text = (b, x, y, s, co, gl = 0) => { for (let i = 0; i < s.length; i += 1) put(b, x + i, y, s[i], co, gl); };
const textC = (b, y, s, co, gl = 0) => text(b, Math.floor((b.cols - s.length) / 2), y, s, co, gl);

/** A sprite: `rows` drawn with its centre column on x and its bottom row on y. Spaces between the first and last mark of
 *  a row are solid (they blank what is behind), so a body reads as a shape and the beam does not cut through it. */
function sprite(b, rows, x, y, pick, { solid = true } = {}) {
  const h = rows.length;
  const left = Math.round(x) - CENTER;
  const top = Math.round(y) - h + 1;
  for (let r = 0; r < h; r += 1) {
    const row = rows[r];
    let a = 0;
    let z = row.length - 1;
    while (a <= z && row[a] === ' ') a += 1;
    while (z >= a && row[z] === ' ') z -= 1;
    for (let c = a; c <= z; c += 1) {
      const ch = row[c];
      const X = left + c;
      const Y = top + r;
      if (X < 0 || Y < 0 || X >= b.cols || Y >= b.rows) continue;
      const i = Y * b.cols + X;
      if (ch === ' ') { if (solid) { b.ch[i] = ' '; b.co[i] = 0; b.gl[i] = 0; } continue; }
      const [co, gl] = pick(ch, c, r);
      b.ch[i] = ch; b.co[i] = co; b.gl[i] = gl;
    }
  }
}

/** The widest, squarest banner layout for `title` that fits `cols` x `availRows`: double-width pixels on one line if they
 *  fit, else single-width (wrapped on spaces), else one long line that may clip rather than overlap the dancers. */
export function bannerFor(title, cols, availRows) {
  const fits = (l) => l.h <= availRows + 1 && l.w <= cols; // one row may touch the top of a dancer's hat
  const two = layoutBanner(title, cols - 2, 2);
  if (fits(two) && two.lines.length === 1) return two;
  const one = layoutBanner(title, cols - 2, 1);
  if (fits(one)) return one;
  const joined = layoutBanner(title, cols * 4, 1);
  return joined.h <= availRows ? joined : { ...one, letters: one.letters.filter((l) => l.y + BANNER_H <= availRows) };
}

export function createStage({ seed = 58 } = {}) {
  const R = rng(seed);
  const stars = Array.from({ length: 140 }, () => ({ u: R(), v: R(), ph: R() * 6.28, ch: R() < 0.7 ? '.' : R() < 0.5 ? '+' : '*' }));
  const bandSeed = Array.from({ length: 160 }, () => R());
  return {
    stars, bandSeed, particles: [], lastT: null, lastHit: null, lastBeatInt: -1, flash: 0, shake: 0, flashColor: C.WHITE, R,
    frames: 0, hits: 0, hist: { J: [], D: [] }, impact: null, mq1: 0, mq2: 0,
  };
}

// ---- the spotlight: a cone from (ax, 0) toward (tx, floor), shaded with block characters. Dim colours only.
function beam(b, ax, tx, floor, width, co) {
  const rows = Math.max(1, floor);
  for (let y = 1; y <= floor; y += 1) {
    const f = y / rows;
    const cx = ax + (tx - ax) * f;
    const half = 0.6 + f * width;
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x += 1) {
      const d = Math.abs(x + 0.5 - cx) / half;
      if (d > 1) continue;
      const i = y * b.cols + x;
      if (x < 0 || x >= b.cols || b.ch[i] !== ' ') continue;
      const core = d < 0.45;
      b.ch[i] = core ? '\u2592' : '\u2591';
      b.co[i] = co;
    }
  }
}

const SPARK = ['*', '+', '.', 'o', '\'', '`'];
const CONFETTI = ['#', '%', '=', '~', '^', '&', '@', 'o', '*', '+'];

function spawn(S, L, n, kind, x0 = 0, x1 = L.C) {
  for (let i = 0; i < n && S.particles.length < 160; i += 1) {
    const confetti = kind === 'confetti';
    S.particles.push({
      x: x0 + S.R() * (x1 - x0), y: -1 - S.R() * 2, vy: (confetti ? 5 : 3) + S.R() * 6, vx: (S.R() - 0.5) * (confetti ? 5 : 1.5),
      ch: confetti ? CONFETTI[Math.floor(S.R() * CONFETTI.length)] : SPARK[Math.floor(S.R() * SPARK.length)],
      co: confetti ? RAINBOW_AT + Math.floor(S.R() * RAINBOW) : S.R() < 0.5 ? C.WHITE : S.R() < 0.5 ? C.GOLD : C.CYAN, life: 5,
    });
  }
}
function burst(S, x, y, n) {
  for (let i = 0; i < n && S.particles.length < 160; i += 1) {
    const a = S.R() * Math.PI * 2;
    const v = 3 + S.R() * 9;
    S.particles.push({ x, y, vx: Math.cos(a) * v * 1.6, vy: Math.sin(a) * v - 3, ch: SPARK[Math.floor(S.R() * 4)], co: RAINBOW_AT + Math.floor(S.R() * RAINBOW), life: 1.6, g: 9 });
  }
}

const MARQUEE_TOP = {
  default: '*** HAWKES BIOMEDICAL PRESENTS ***   THE KING OF POP   vs   AIR JORDAN   ***   LIVE FROM THE 58TH FLOOR   ***   BUILD IN PROGRESS: PLEASE ENJOY   ***   NO SKIP BUTTON WAS HARMED IN THE MAKING OF THIS SHOW   ***   ',
  jackson: '*** MOONWALK *** SPIN *** TOE STAND *** HAT TIP *** 45 DEGREE LEAN *** SPARKLE GLOVE *** FREEZE ***   ONE GLOVE, ZERO SKIPS   ',
  jordan: '*** DRIBBLE *** CROSSOVER *** JUMP SHOT *** SLAM DUNK *** HANG TIME *** SHRUG ***   HE LEAVES THE FLOOR, THE FLOOR FILES A COMPLAINT   ',
  battle: '!!! BATTLE !!!   ROUND AFTER ROUND   TWO DANCERS   ONE FLOOR   NOBODY GETS TO LEAVE   !!!   ',
  finale: '*** ONE MORE TIME *** ONE MORE TIME *** ONE MORE TIME *** ONE MORE TIME ***   ',
  outro: '*** THANK YOU FOR SITTING THROUGH IT *** BUILD SUCCESSFUL *** ',
};
const MARQUEE_BOTTOM = {
  default: '=== MOONWALK === SPIN === HAT TIP === CROSSOVER === JUMP SHOT === SLAM DUNK === HANG TIME === SHRUG === ONE MORE TIME ===   ',
  battle: '>>> JACKSON >>> JORDAN >>> JACKSON >>> JORDAN >>> JACKSON >>> JORDAN >>>   ',
  finale: '*** ONE MORE TIME *** ONE MORE TIME *** ONE MORE TIME *** ONE MORE TIME ***   ',
};
// a big word that slams onto the stage on a hit
const IMPACT = { dunk: 'DUNK!', swish: 'SWISH!', final: 'FINAL POSE', freeze: 'FREEZE!', hang: 'HANG TIME', toe: 'TOES!', glove: 'SPARKLE!', spin: 'SPIN!', lean: 'LEAN!', open: 'GO!', mw: 'MOONWALK', hat: 'HAT TIP', cross: 'CROSSOVER', shrug: 'SHRUG' };

const CREDITS = [
  ['', 'A HAWKES BIOMEDICAL PRODUCTION'],
  ['', ''],
  ['STARRING', ''],
  ['', 'JACKSON'],
  ['', 'x'],
  ['', 'JORDAN'],
  ['', ''],
  ['CHOREOGRAPHY', 'EVERY FRAME BY HAND'],
  ['MUSIC', 'SONG.MP3'],
  ['LIGHTING', 'ONE SPOTLIGHT, TWO BEAMS'],
  ['', ''],
  ['NO KEYS WERE PRESSED', ''],
  ['THANK YOU FOR SITTING THROUGH IT', ''],
];

/**
 * Draw one frame. `t` is the song (or fixed timer) time in seconds, `tl` the timeline, `buf` a buffer from makeBuffer,
 * `S` the stage state from createStage. `opts`: calm (reduced motion), spec (an array 0..1 of spectrum bands, optional),
 * `lowFx` (fewer particles). Returns { flash, flashColor, shake: [dx, dy] (in cells), scene, state } for the painter.
 */
export function drawFrame(S, buf, tl, t, { calm = false, spec = null, lowFx = false } = {}) {
  const cols = buf.cols;
  const rows = buf.rows;
  clearBuffer(buf);
  const L = layout(cols, rows);
  const st = stageAt(tl, t, L, { calm });
  const beat = st.beat;
  const pulse = st.pulse;
  const dt = S.lastT == null ? 0 : Math.max(0, Math.min(0.25, t - S.lastT));
  S.lastT = t;
  S.frames += 1;
  const bi = Math.floor(beat);
  const newBeat = bi !== S.lastBeatInt;
  S.lastBeatInt = bi;
  const downbeat = newBeat && ((bi % 4) + 4) % 4 === 0;
  const sceneId = st.scene.id;
  const F = L.floor;

  // ---- stars
  for (const s of S.stars) {
    const x = Math.floor(s.u * cols);
    const y = Math.floor(s.v * (F - 2)) + 1;
    const tw = calm ? 0.7 : 0.5 + 0.5 * Math.sin(t * 3 + s.ph);
    if (tw > 0.45) put(buf, x, y, s.ch, tw > 0.85 ? C.WHITE : C.DIM);
  }

  // ---- spotlights: two beams that sweep on the bar, and in a battle one follows whoever has the floor
  if (!calm || true) {
    const sw = calm ? 0 : Math.sin((beat / 8) * Math.PI * 2);
    const bw = Math.max(3, Math.round(cols * 0.045));
    if (sceneId === 'battle' && st.spot) {
      const dd = st.d.find((q) => q.who === st.spot);
      beam(buf, dd ? dd.x : L.cx, dd ? dd.x : L.cx, F, bw, st.spot === 'J' ? C.SPOT_C : C.SPOT_R);
    } else if (sceneId === 'finale' || sceneId === 'names') {
      beam(buf, cols * 0.2, L.cx + sw * cols * 0.2, F, bw, C.SPOT_M);
      beam(buf, cols * 0.8, L.cx - sw * cols * 0.2, F, bw, C.SPOT_G);
    } else {
      beam(buf, cols * 0.25, cols * 0.5 + sw * cols * 0.3, F, bw, C.SPOT_C);
      beam(buf, cols * 0.75, cols * 0.5 - sw * cols * 0.3, F, bw, C.SPOT_M);
    }
  }

  // ---- the stage floor: a row of lit tiles that step with the beat, and the reflections below it
  const tileRow = F + 1;
  for (let x = 0; x < cols; x += 1) {
    const lit = (Math.floor(x / 4) + bi) % 3 === 0;
    put(buf, x, tileRow, Math.floor(x / 4) % 2 ? '=' : '-', lit ? rainbow(x / 3 + beat * 2) : C.DEEP, lit ? 1 : 0);
  }
  for (let x = 0; x < cols; x += 1) put(buf, x, tileRow + 4, x % 8 === 0 ? '+' : '_', C.DEEP);

  // ---- the hoop (when the scene wants it) with its stand
    if (hoopWanted(st)) {
    const hf = st.hoop || 0;
    const rows3 = HOOP_FRAMES[hf % HOOP_FRAMES.length];
    const hx = L.hoopX;
    for (let r = 0; r < rows3.length; r += 1) {
      for (let c = 0; c < rows3[r].length; c += 1) {
        const ch = rows3[r][c];
        if (ch === ' ') continue;
        put(buf, hx + c, L.hoopTop + r, ch, r < 4 ? C.WHITE : r === 4 ? C.ORANGE : C.BRIGHT, r === 4 ? 1 : 0);
      }
    }
    for (let y = L.hoopTop + 4; y < F; y += 1) put(buf, hx + 6, y, '|', C.DIM);
    put(buf, hx + 6, F, 'H', C.DIM);
  }

  // ---- the dancers, with their reflections
  const palOf = (who) => (who === 'J' ? C.JACK : C.JORD);
  const lowest = {};
  for (const dn of st.d) {
    const rowsSrc = (dn.who === 'J' ? JACKSON : JORDAN)[dn.frame] || (dn.who === 'J' ? JACKSON.stand : JORDAN.ready);
    const art = dn.flipped ? flip(rowsSrc) : rowsSrc;
    const lift = Math.max(0, Math.round(dn.y));
    const bob = dn.y === 0 ? 0 : 0;
    const y = F - lift + bob;
    const base = dn.tint === 'dim' ? C.DIM : palOf(dn.who);
    const hot = st.hold && downbeat;
    // afterimages: two dim ghosts of where he was a moment ago, when he is moving
    const hist = S.hist[dn.who];
    if (!calm) {
      for (const age of [0.26, 0.13]) {
        const gh = hist.find((hq) => t - hq.t <= age + 0.04 && t - hq.t >= age - 0.04);
        if (gh && Math.abs(gh.x - dn.x) + Math.abs(gh.y - y) >= 2) sprite(buf, gh.art, gh.x, gh.y, () => [age > 0.2 ? C.DEEP : C.DIM, 0], { solid: false });
      }
    }
    hist.push({ t, x: dn.x, y, art });
    while (hist.length && t - hist[0].t > 0.5) hist.shift();
    sprite(buf, art, dn.x, y, (ch) => {
      if (ch === '*') return [rainbow(beat * 3 + dn.x), 1];
      if (ch === '@' || ch === '(' && false) return [C.ORANGE, 1];
      if (/[0-9]/.test(ch)) return [C.GOLD, 1];
      if (ch === '=' || ch === 'P') return [C.AMBER, 0];
      return [hot ? C.WHITE : base, dn.tint === 'dim' ? 0 : 1];
    });
    // the reflection: the bottom three rows, upside down, dim and shimmering, dropped by how high he is
    const refl = art.slice(-3).reverse();
    for (let r = 0; r < refl.length; r += 1) {
      const rr = refl[r];
      for (let c = 0; c < rr.length; c += 1) {
        const ch = rr[c];
        if (ch === ' ') continue;
        if (((c * 7 + r * 3 + Math.floor(t * 6)) % 4) === 0 && !calm) continue; // shimmer
        const m = ch === '/' ? '\\' : ch === '\\' ? '/' : ch;
        const X = dn.x - CENTER + c;
        const Y = F + 2 + lift + r;
        if (Y < F + 5) put(buf, X, Y, m, C.FLOOR, 0);
      }
    }
    lowest[dn.who] = { x: dn.x, y, lift };
  }

  // ---- the ball: a small orange ball with a trail
  if (st.ball) {
    const bx = Math.round(st.ball.x);
    const by = F - Math.round(st.ball.y);
    put(buf, bx - 1, by, '(', C.ORANGE, 1); put(buf, bx, by, '@', C.ORANGE, 1); put(buf, bx + 1, by, ')', C.ORANGE, 1);
    if (S.prevBall && !calm) {
      const px = Math.round(S.prevBall.x);
      const py = F - Math.round(S.prevBall.y);
      if (px !== bx || py !== by) put(buf, px, py, '.', C.ORANGE);
    }
    S.prevBall = { x: st.ball.x, y: st.ball.y };
  } else S.prevBall = null;

  // ---- effects: hits and beats (the previous frame's flash and shake fade first, so a new hit shows at full strength)
  S.flash = Math.max(0, S.flash - dt * 2.6);
  S.shake = Math.max(0, S.shake - dt * 4.5);
  if (st.hit && st.hit !== S.lastHit && !calm) {
    S.hits += 1;
    S.flash = Math.max(S.flash, 0.3);
    S.shake = Math.max(S.shake, st.shake || /dunk|final|freeze|swish/.test(st.hit) ? 1 : 0.5);
    S.flashColor = rainbow(S.hits * 5);
    if (IMPACT[st.hit]) S.impact = { text: IMPACT[st.hit], t0: t };
    const dd = st.d[0];
    if (dd && /dunk|swish|final|freeze|toe|glove/.test(st.hit)) burst(S, dd.x, F - 8, lowFx ? 10 : 26);
  }
  S.lastHit = st.hit || null;
  if (newBeat && !calm) {
    S.flash = Math.max(S.flash, downbeat ? 0.18 : 0.07);
    S.flashColor = rainbow(bi * 3);
    if (downbeat) S.shake = Math.max(S.shake, 0.6);
    if (!lowFx || bi % 2 === 0) spawn(S, L, 3, 'spark');
    if (st.confetti) spawn(S, L, lowFx ? 6 : 14, 'confetti');
    if (st.sparkle) { const dd = st.d[0]; if (dd) burst(S, dd.x + 5, F - 12, 4); }
  }

  // ---- falling sparkles and confetti
  const live = [];
  for (const p of S.particles) {
    p.life -= dt;
    p.y += p.vy * dt;
    p.x += p.vx * dt;
    if (p.g) p.vy += p.g * dt;
    if (p.life <= 0 || p.y > F + 3 || p.x < -2 || p.x > cols + 2) continue;
    live.push(p);
    put(buf, Math.round(p.x), Math.round(p.y), p.ch, p.co, 1);
  }
  S.particles = calm ? [] : live;

  // ---- the name banner: block letters, each one a colour of its own that cycles, a ripple that bounces a few letters on
  // every beat, a white flash on the beat. Pixels are solid blocks (the painter draws them as full cells).
  const availTop = 2;
  const availRows = Math.max(BANNER_H, L.floor - FRAME_H - availTop - 1);
  let title = st.scene.title;
  if (sceneId === 'jackson' || sceneId === 'jordan') title = sceneId === 'jackson' ? 'JACKSON' : 'JORDAN';
  const impactLive = !calm && S.impact && t - S.impact.t0 >= 0 && t - S.impact.t0 < 0.6;
  if (!st.credits && !impactLive) {
    const lay = bannerFor(title, cols, availRows);
    const px = lay.px;
    const bx0 = Math.floor((cols - lay.w) / 2);
    const by0 = availTop + Math.max(0, Math.floor((availRows - lay.h) / 2));
    const n = lay.letters.length || 1;
    const ripple = (beat * 5) % (n + 8); // a bounce travels through the letters on every beat
    for (const lt of lay.letters) {
      const near = Math.max(0, 1 - Math.abs(lt.index - ripple) / 1.8);
      const lift = calm ? 0 : Math.round(near * 1.6);
      const white = pulse > 0.8 && !calm;
      const co = white ? C.WHITE : rainbow(lt.index * 3 + beat * 1.5 + lt.line * 6);
      for (let r = 0; r < BANNER_H; r += 1) {
        for (let c = 0; c < lt.rows[r].length; c += 1) {
          if (lt.rows[r][c] !== '#') continue;
          for (let q = 0; q < px; q += 1) put(buf, bx0 + lt.x + c * px + q, by0 + lt.y + r - lift, '\u2588', co, 1);
        }
      }
    }
  }

  // ---- the credits (the outro)
  if (st.credits) {
    const lines = CREDITS;
    const total = lines.length;
    const top = rows - 4;
    const span = rows + total * 2;
    const scroll = (st.progress ?? 0) * span * 0.85;
    lines.forEach((ln, i) => {
      const y = Math.round(top - scroll + i * 2);
      if (y < 2 || y > F + 2) return;
      const s0 = ln[0] && ln[1] ? `${ln[0]}   ${ln[1]}` : ln[0] || ln[1];
      if (!s0) return;
      const big = s0 === 'JACKSON' || s0 === 'JORDAN';
      const s = big ? s0.split('').join(' ') : s0;
      const x0 = Math.floor((cols - s.length) / 2);
      for (let k = -2; k < s.length + 2; k += 1) { const X = x0 + k; if (X >= 0 && X < cols) { const q = y * cols + X; buf.ch[q] = ' '; buf.co[q] = 0; buf.gl[q] = 0; } } // a dark bar behind the line
      textC(buf, y, s, big ? rainbow(i * 3 + beat * 2) : i === total - 1 ? C.WHITE : C.BRIGHT, 1);
    });
    if ((st.progress ?? 0) > 0.9) { const y = Math.floor(F * 0.45); for (let k = 0; k < cols; k += 1) { const q = y * cols + k; buf.ch[q] = ' '; buf.co[q] = 0; } textC(buf, y, 'B U I L D   S U C C E S S F U L', rainbow(beat * 4), 1); }
  }

  // ---- the countdown in the intro
  if (st.countdown) textC(buf, Math.floor(F * 0.45), String(st.countdown), C.WHITE, 1);

  // ---- speech bubbles
  if (st.bubble) {
    const bt = st.bubble;
    const w = bt.text.length + 4;
    const x = Math.max(0, Math.min(cols - w, Math.round(bt.x)));
    const y = Math.max(1, F - Math.round(bt.y));
    text(buf, x, y, `.${'-'.repeat(w - 2)}.`, C.WHITE);
    text(buf, x, y + 1, `| ${bt.text} |`, C.GOLD, 1);
    text(buf, x, y + 2, `'${'-'.repeat(w - 2)}'`, C.WHITE);
    put(buf, x + 2, y + 3, 'v', C.WHITE);
  }

  // ---- the equalizer
  const eqTop = rows - 1 - L.eqH;
  const nb = Math.max(8, Math.floor(cols / 2));
  const bw = cols / nb;
  for (let k = 0; k < nb; k += 1) {
    const sv = spec ? spec[Math.floor((k / nb) * spec.length)] : null;
    const bandR = S.bandSeed[(k * 7 + bi * 3) % S.bandSeed.length];
    const base = 0.22 + 0.18 * Math.sin(k * 0.55 + beat * 0.9);
    const synth = base + (0.2 + 0.55 * bandR) * (0.35 + 0.65 * pulse);
    const lv = clamp01(calm ? 0.35 + 0.15 * Math.sin(k * 0.5 + t * 0.8) : sv != null ? 0.15 + sv * 0.85 : synth);
    const h = Math.max(1, Math.round(lv * L.eqH));
    const x = Math.floor(k * bw + bw / 2 - 0.5);
    const co = rainbow(k * (RAINBOW / nb) + beat * 1.5);
    for (let r = 0; r < h; r += 1) put(buf, x, rows - 2 - r, r === h - 1 ? '^' : '#', co, r === h - 1 ? 1 : 0);
  }

  // ---- the marquees (top and bottom rows: per scene text, a scroll that surges on the beat) and the caption under the top one
  S.mq1 += dt * (calm ? 0 : 9 + 16 * pulse);
  S.mq2 += dt * (calm ? 0 : 9 + 16 * pulse);
  const mq = (line, y, off, co) => {
    const o = Math.floor(off);
    for (let x = 0; x < cols; x += 1) {
      const ch = line[(((x + o) % line.length) + line.length) % line.length];
      put(buf, x, y, ch, co === 'rb' ? rainbow(x / 4 + beat) : co, 0);
    }
  };
  if (!calm) { mq(MARQUEE_TOP[sceneId] || MARQUEE_TOP.default, 0, S.mq1, C.AMBER); mq(MARQUEE_BOTTOM[sceneId] || MARQUEE_BOTTOM.default, rows - 1, -S.mq2, 'rb'); } else { textC(buf, 0, 'HAWKES BIOMEDICAL PRESENTS', C.AMBER); textC(buf, rows - 1, 'BUILD IN PROGRESS', C.DIM); }
  if (st.caption) {
    const cap = `~ ${st.caption} ~`;
    textC(buf, 1, cap, pulse > 0.6 && !calm ? C.WHITE : C.BRIGHT, 1);
  }

  // ---- an impact word slams into the banner's place for half a second on a hit (the name banner steps aside)
  if (impactLive) {
    const age = t - S.impact.t0;
    const inv = Math.floor(age * 14) % 2 === 0;
    const il = bannerFor(S.impact.text, cols, availRows);
    const x0 = Math.floor((cols - il.w) / 2);
    const y0 = availTop + Math.max(0, Math.floor((availRows - il.h) / 2));
    for (const lt of il.letters) for (let r = 0; r < BANNER_H; r += 1) for (let c = 0; c < lt.rows[r].length; c += 1) {
      if (lt.rows[r][c] !== '#') continue;
      for (let q = 0; q < il.px; q += 1) put(buf, x0 + lt.x + c * il.px + q, y0 + lt.y + r, '\u2588', inv ? C.WHITE : rainbow(lt.index * 4 + age * 30), 1);
    }
  } else if (S.impact && t - S.impact.t0 >= 0.6) S.impact = null;

  // ---- a diagonal wipe on every scene change (on the first beat of a scene)
  if (!calm && st.sb < 1.4 && st.index > 0) {
    const p = st.sb / 1.4;
    const front = p * (cols + rows * 0.7 + 14) - 7;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const d = x + y * 0.7 - front;
        if (d < -6 || d > 0) continue;
        const k = -d / 6; // 0 at the leading edge, 1 at the tail
        put(buf, x, y, k < 0.2 ? '\u2588' : k < 0.5 ? '\u2593' : k < 0.8 ? '\u2592' : '\u2591', rainbow(sceneId.length * 3 + p * 12 + y * 0.2), 0);
      }
    }
  }

  return {
    flash: calm ? 0 : S.flash, flashColor: S.flashColor, shake: calm ? 0 : S.shake, scene: sceneId, state: st, layout: L, beat, newBeat,
  };
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export { beatPulse, beatAt, BEAT_SEC, BPM, FRAME_W, HOOP_W, HOOP_H, flip };
