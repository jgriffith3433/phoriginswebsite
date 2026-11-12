// The stage: draws one frame of the /build show into a grid of text cells (a character, a colour, a glow flag per cell).
// Pure: no DOM, no timers. show.js paints the grid onto a canvas (one canvas, redrawn, so the DOM stays tiny); the tests
// read it back as text.
//
// Layers, back to front: background matrix stars, sweeping data beams, the GPU server farm (racks, blinking LEDs, fan
// and heat glyphs, utilization bars, rising credits meter), the token stream, the network map (nodes, links, moving
// packets, pulsing core), rising hearts, the block-letter equation banner with sliding algebra and sign flip, the four
// stacked core equations in the finale, the live tally bar, the equalizer, the marquees, and the caption.

import {
  EQUATIONS,
  CORE_EQUATIONS,
  DEFAULT_VARS,
  balanceEquation,
  equationsForDuration,
  FRAME_W,
  FRAME_H,
  CENTER,
  flip,
} from './dancers.js';
import { layoutBanner, BANNER_H } from './banner.js';
import { stageAt, layout, beatPulse, beatAt, BEAT_SEC, BPM } from './choreo.js';
import { rng } from './util.js';

// ---- the palette: fixed colours first, then a rainbow of RAINBOW hues
export const C = {
  NONE: 0, DIM: 1, FG: 2, BRIGHT: 3, WHITE: 4, AMBER: 5, RED: 6, CYAN: 7, MAGENTA: 8, BLUE: 9, ORANGE: 10, GOLD: 11, DEEP: 12,
  GPU_C: 13, HEART_C: 14, SPOT_M: 15, SPOT_C: 16, SPOT_G: 17, SPOT_R: 18, FLOOR: 19, REFL: 20,
};
export const RAINBOW = 24;
export const RAINBOW_AT = 24;
export const PALETTE = [
  'rgba(0,0,0,0)', '#26a653', '#3dff7a', '#b8ffd0', '#ffffff', '#ffd166', '#ff5a4a', '#5ff3ff', '#ff5ad1', '#6a8cff', '#ff9f43', '#ffe066', '#14702f',
  '#5ff3ff', '#ff5ad1', '#ff5ad1', '#5ff3ff', '#ffe066', '#ff6a4a', '#1d8a49', '#2a5f8f', '#000000', '#000000', '#000000',
  ...Array.from({ length: RAINBOW }, (_, i) => `hsl(${Math.round((i * 360) / RAINBOW)},100%,62%)`),
];
const rainbow = (i) => RAINBOW_AT + ((((Math.floor(i) % RAINBOW) + RAINBOW) % RAINBOW));
const clamp01 = (v) => Math.max(0, Math.min(1, v));

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
const clearRow = (b, y, x0 = 0, x1 = b.cols - 1) => {
  if (y < 0 || y >= b.rows) return;
  const a = Math.max(0, x0);
  const z = Math.min(b.cols - 1, x1);
  for (let x = a; x <= z; x += 1) {
    const i = y * b.cols + x;
    b.ch[i] = ' '; b.co[i] = 0; b.gl[i] = 0;
  }
};

/**
 * The widest, squarest banner layout for `title` that fits `cols` x `availRows`: double-width pixels on one line if they
 * fit, else single-width (wrapped on spaces) with compact vertical spacing when needed so every letter fits on stage.
 */
export function bannerFor(title, cols, availRows) {
  const room = Math.max(BANNER_H, availRows);
  const fits = (l) => l.h <= room + 1 && l.w <= cols;
  const two = layoutBanner(title, cols - 2, 2);
  if (fits(two) && two.lines.length === 1) return two;
  const one = layoutBanner(title, cols - 2, 1);
  if (fits(one)) return one;
  const full = layoutBanner(title, cols, 1);
  if (fits(full)) return full;
  // Compact vertical line pitch (`BANNER_H` instead of `BANNER_H + 1`) when a multi-term equation wraps to 3-4 lines
  const compact = {
    ...full,
    letters: full.letters.map((lt) => ({ ...lt, y: lt.line * BANNER_H })),
    h: full.lines.length ? full.lines.length * BANNER_H : 0,
  };
  if (compact.h <= room + 5 && compact.w <= cols) return compact;
  return full;
}

export function createStage({ seed = 58 } = {}) {
  const R = rng(seed);
  const stars = Array.from({ length: 140 }, () => ({ u: R(), v: R(), ph: R() * 6.28, ch: R() < 0.65 ? '.' : R() < 0.5 ? '+' : ':' }));
  const bandSeed = Array.from({ length: 160 }, () => R());
  return {
    stars, bandSeed, particles: [], lastT: null, lastHit: null, lastBeatInt: -1, flash: 0, shake: 0, flashColor: C.WHITE, R,
    frames: 0, hits: 0, mq1: 0, mq2: 0, equationsSeen: new Set(),
  };
}

// ---- sweeping data beam: a cone from (ax, 0) toward (tx, floor), shaded with block characters
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

const SPARK = ['*', '+', '.', ':', '^', '$'];
const HEART_GLYPHS = ['<3', '*', '+', '#', '@', '^'];

function spawn(S, L, n, kind, x0 = 0, x1 = L.C) {
  for (let i = 0; i < n && S.particles.length < 160; i += 1) {
    const isHeart = kind === 'confetti' || kind === 'heart';
    S.particles.push({
      x: x0 + S.R() * (x1 - x0),
      y: isHeart ? L.floor - 1 - S.R() * 3 : -1 - S.R() * 2,
      vy: isHeart ? -(3 + S.R() * 5) : 3 + S.R() * 5,
      vx: (S.R() - 0.5) * 2.5,
      ch: isHeart ? (S.R() < 0.65 ? '<3' : HEART_GLYPHS[Math.floor(S.R() * HEART_GLYPHS.length)]) : SPARK[Math.floor(S.R() * SPARK.length)],
      co: isHeart ? (S.R() < 0.6 ? C.MAGENTA : RAINBOW_AT + Math.floor(S.R() * RAINBOW)) : S.R() < 0.5 ? C.CYAN : C.GOLD,
      life: 4.5,
    });
  }
}

/** Colour for a term in an equation banner so each term glows in its own semantic colour. */
function termColor(word, index, beat) {
  const w = String(word || '').toUpperCase();
  if (w.includes('GPU')) return rainbow(12 + Math.floor(beat * 2) % 3);
  if (w.includes('TEXT') || w.includes('TOK')) return rainbow(8 + Math.floor(beat * 2) % 3);
  if (w.includes('HEART')) return rainbow(20 + Math.floor(beat * 2) % 3);
  if (w.includes('CRED')) return rainbow(3 + Math.floor(beat * 2) % 3);
  if (w === '=') return C.WHITE;
  if (w === '+' || w === '-' || w === 'X' || w === '/') return rainbow(1 + (index * 2 + Math.floor(beat * 2)) % RAINBOW);
  return rainbow(index * 3 + beat * 1.5);
}

const MARQUEE_TOP = {
  default: '*** HAWKES BIOMEDICAL GATEWAY 58 ***   GPU + Text = Hearts - Credits   ***   Hearts = GPU + Text + Credits   ***   Credits = Hearts - GPU - Text   ***   Hearts + Credits = GPU + Text + 2(Credits)   ***   ',
  farm: '*** GPU SERVER FARM ONLINE ***   BLADES + COOLING FANS + HEAT TELEMETRY + UTILIZATION BARS + RISING CREDITS METER   ***   GPU + Text = Hearts - Credits   ***   ',
  net: '*** GLOBAL INTERNET TOPOLOGY ***   GATEWAY 58 CORE   ***   PACKETS IN FLIGHT   ***   Packets - Latency = Bandwidth + Hearts   ***   ',
  hearts: '*** HEARTS RISING FROM THE NETWORK ***   Hearts = GPU + Text + Credits   ***   Hearts + Credits = GPU + Text + 2(Credits)   ***   ',
  rapid: '!!! RAPID INTERNET ALGEBRA !!!   Tokens x GPU = Text / Latency   ***   Uptime = Credits / (Downtime + 1)   ***   ALL TERMS BALANCED   !!!   ',
  finale: '*** THE ALGORITHMS THAT RUN THE INTERNET ***   GPU + Text = Hearts - Credits   ***   Hearts = GPU + Text + Credits   ***   ',
  outro: '*** ALL 24 EQUATIONS BALANCED ***   BUILD SUCCESSFUL   ***   GATEWAY 58 ONLINE   ***   ',
};
const MARQUEE_BOTTOM = {
  default: '=== GPU + Text = Hearts - Credits === Hearts = GPU + Text + Credits === Credits = Hearts - GPU - Text === Hearts + Credits = GPU + Text + 2(Credits) ===   ',
  net: '>>> [GPU-POOL] ===> [GW-58 CORE] ===> [TEXT-LLM] ===> [HEART-MUX] ===> [CRED-LEDGER] >>>   ',
  finale: '*** GPU + Text = Hearts - Credits *** Hearts = GPU + Text + Credits *** Credits = Hearts - GPU - Text ***   ',
};

const CREDITS = [
  ['', 'A HAWKES BIOMEDICAL PRODUCTION'],
  ['', ''],
  ['THE ALGORITHMS', 'THAT CONTROL THE INTERNET'],
  ['LAW I', 'GPU + Text = Hearts - Credits'],
  ['LAW II', 'Hearts = GPU + Text + Credits'],
  ['LAW III', 'Credits = Hearts - GPU - Text'],
  ['LAW IV', 'Hearts + Credits = GPU + Text + 2(Credits)'],
  ['', ''],
  ['CLUSTER', '58TH FLOOR GPU FARM'],
  ['TOPOLOGY', 'GATEWAY 58 PACKET CORE'],
  ['MUSIC', 'SONG.MP3'],
  ['', ''],
  ['ALL TERMS BALANCED', ''],
  ['BUILD SUCCESSFUL', ''],
];

/** Draw the GPU server farm: rows of racks with blinking LEDs, spinning fans, heat glyphs, utilization bars, and rising credits. */
function drawFarm(buf, st, topY, botY, beat, calm) {
  const cols = buf.cols;
  const farm = st.farm;
  const bootP = st.mode === 'boot' ? st.bootProgress ?? 1 : 1;
  const h = Math.max(6, Math.min(11, botY - topY - 1));
  const y0 = Math.max(topY, botY - h - 1);

  for (let idx = 0; idx < farm.racks.length; idx += 1) {
    const r = farm.racks[idx];
    const rackOn = bootP >= idx / Math.max(1, farm.racks.length);
    const x = r.x;
    const w = r.w;
    if (x + w > cols) continue;
    const borderCo = !rackOn ? C.DEEP : r.hot ? C.AMBER : C.CYAN;

    // Heat shimmer wave rising above the rack vents
    if (rackOn && y0 - 1 >= topY) {
      const heatStr = w >= 14 ? ` ~ ^ ${r.tempC}C ^ ~ ` : `~${r.tempC}C^~`;
      text(buf, x + Math.floor((w - heatStr.length) / 2), y0 - 1, heatStr, r.hot ? C.ORANGE : C.AMBER, r.hot ? 1 : 0);
    }

    // Top border with rack ID
    const topBar = `+${'-'.repeat(w - 2)}+`;
    text(buf, x, y0, topBar, borderCo);
    const tag = `[${r.id}:${r.tempC}C]`;
    if (tag.length <= w - 2) text(buf, x + 1, y0, tag, rackOn ? C.WHITE : C.DIM, rackOn ? 1 : 0);

    // Interior blade rows, fan bays, and utilization bar
    const innerW = w - 2;
    for (let row = 1; row < h - 1; row += 1) {
      const yy = y0 + row;
      if (yy >= botY) break;
      put(buf, x, yy, '|', borderCo);
      put(buf, x + w - 1, yy, '|', borderCo);
      if (!rackOn) {
        text(buf, x + 1, yy, '.'.repeat(innerW), C.DEEP);
        continue;
      }
      if (row === 1 || row === 2) {
        // Server blades with blinking status LEDs
        const led = (row + Math.floor(beat * 2) + idx) % 2 === 0 ? r.ledA : r.ledB;
        const blade = innerW >= 12 ? `[${led}::GPU::${led}]` : `[${led}:GPU:${led}]`;
        text(buf, x + 1, yy, blade.padEnd(innerW, ':').slice(0, innerW), row === 1 ? C.CYAN : C.FG, 1);
      } else if (row === 3 || (h >= 9 && row === 4)) {
        // Spinning cooling fans
        const f1 = r.fan;
        const f2 = ['/', '-', '\\', '|'][(idx + Math.floor(beat * 4) + row) % 4];
        const fanRow = innerW >= 12 ? ` (${f1}) FAN (${f2})` : `(${f1})FAN(${f2})`;
        text(buf, x + 1, yy, fanRow.padEnd(innerW, ' ').slice(0, innerW), C.GOLD, 0);
      } else if (row === h - 3) {
        // Utilization bar using block characters
        const barW = Math.max(4, innerW - 4);
        const filled = Math.round((r.util / 100) * barW);
        const barStr = '\u2588'.repeat(filled) + '\u2591'.repeat(Math.max(0, barW - filled));
        const pct = `${String(r.util).padStart(2, '0')}%`;
        text(buf, x + 1, yy, `${barStr}${pct}`.slice(0, innerW), r.util > 88 ? C.MAGENTA : C.FG, 1);
      } else if (row === h - 2) {
        // Credit minting counter per rack
        const cr = `+${(r.util * 3 + idx * 17) % 900 + 100}CR`;
        text(buf, x + 1, yy, `CRD:${cr}`.padEnd(innerW, ' ').slice(0, innerW), C.GOLD, 1);
      } else {
        // Tensor core activity row
        const pat = ((row + idx + Math.floor(beat * 3)) % 2 === 0 ? '#==#==#==#==' : '==#==#==#==#').slice(0, innerW);
        text(buf, x + 1, yy, pat, C.BRIGHT);
      }
    }
    if (y0 + h - 1 < botY) text(buf, x, y0 + h - 1, topBar, borderCo);
  }

  // Rising Credits & Compute telemetry bar beneath the racks
  const meterY = Math.min(botY, y0 + h);
  clearRow(buf, meterY, 1, cols - 2);
  const meterLine =
    cols >= 76
      ? `GPU FARM: ${farm.avgUtil}% UTIL | ${farm.maxTemp}C | TOKENS/S: ${farm.tokensPerSec} | CREDITS: +${farm.credits} CR [^^^]`
      : `FARM ${farm.avgUtil}% ${farm.maxTemp}C | CREDITS: +${farm.credits} CR [^^]`;
  textC(buf, meterY, meterLine.slice(0, cols - 2), C.GOLD, 1);
}

/** Draw the internet network map: pulsing core, nodes, links, and moving packet glyphs. */
function drawNet(buf, st, topY, botY, beat, calm) {
  const cols = buf.cols;
  const net = st.net;

  // 1. Links between nodes
  for (const lk of net.links) {
    const steps = Math.max(Math.abs(lk.to.x - lk.from.x), Math.abs(lk.to.y - lk.from.y), 1);
    for (let s = 1; s < steps; s += 1) {
      const f = s / steps;
      const x = Math.round(lk.from.x + (lk.to.x - lk.from.x) * f);
      const y = Math.round(lk.from.y + (lk.to.y - lk.from.y) * f);
      if (y < topY || y >= botY) continue;
      put(buf, x, y, s % 2 === 0 ? ':' : '.', C.DEEP, 0);
    }
  }

  // 2. Moving packets travelling along the links
  for (const pk of net.packets) {
    if (pk.y < topY || pk.y >= botY) continue;
    put(buf, pk.x, pk.y, pk.ch, C.GOLD, 1);
    if (!calm && pk.x + 1 < cols) put(buf, pk.x + 1, pk.y, '>', C.CYAN, 1);
  }

  // 3. Nodes and the pulsing Gateway 58 core
  const pulseOn = beatPulse(beat) > 0.5 && !calm;
  for (const nd of net.nodes) {
    if (nd.y < topY || nd.y >= botY) continue;
    const tag = nd.core ? (pulseOn ? `(( ${nd.label} ))` : `[[ ${nd.label} ]]`) : `[${nd.label}]`;
    const x0 = Math.max(0, Math.min(cols - tag.length, Math.round(nd.x - tag.length / 2)));
    const co = nd.core ? (pulseOn ? C.WHITE : C.MAGENTA) : nd.id === 'GPU' ? C.CYAN : nd.id === 'HEART' ? C.MAGENTA : nd.id === 'CRED' ? C.GOLD : C.FG;
    text(buf, x0, nd.y, tag, co, 1);
  }
}

/** Draw the token/text stream flowing from the GPU farm into the network and hearts rising out. */
function drawTokenStreamAndHearts(buf, st, yRow, beat, calm) {
  const cols = buf.cols;
  if (yRow < 2 || yRow >= buf.rows - 2) return;
  const tokens = ['[GPU]', '==>', '"Text"', '==>', '<TOK:58>', '==>', '<3 Hearts', '==>', '+Credits'];
  const shift = calm ? 0 : Math.floor(Math.max(0, beat) * 6);
  const streamStr = Array.from({ length: Math.ceil(cols / 8) + 2 }, (_, i) => tokens[i % tokens.length]).join(' ');
  clearRow(buf, yRow, 0, cols - 1);
  for (let x = 0; x < cols; x += 1) {
    const ch = streamStr[(x + shift) % streamStr.length];
    const co = ch === '<' || ch === '3' ? C.MAGENTA : ch === '+' ? C.GOLD : ch === '=' || ch === '>' ? C.CYAN : C.FG;
    put(buf, x, yRow, ch, co, 0);
  }
}

/** Draw deterministic rising hearts so the hearts scene and finale always flood with `<3` and block hearts. */
function drawRisingHearts(buf, st, topY, botY, beat, calm) {
  const rate = st.heartsRate ?? 0;
  if (rate <= 0) return;
  const cols = buf.cols;
  const spanY = Math.max(4, botY - topY);
  const count = Math.max(4, Math.round((cols < 64 ? 10 : 20) * rate));
  for (let i = 0; i < count; i += 1) {
    const u = ((i * 0.6180339887) % 1);
    const x = 2 + Math.floor(u * (cols - 5));
    const rise = calm ? (i * 1.7) % spanY : ((Math.max(0, beat) * (1.8 + (i % 3) * 0.5) + i * 2.3) % spanY);
    const y = Math.round(botY - 1 - rise);
    if (y < topY || y >= botY) continue;
    const co = i % 3 === 0 ? C.MAGENTA : i % 3 === 1 ? C.RED : C.GOLD;
    text(buf, x, y, '<3', co, 1);
  }
}

/**
 * Draw one frame. `t` is the song (or fixed timer) time in seconds, `tl` the timeline, `buf` a buffer from makeBuffer,
 * `S` the stage state from createStage. `opts`: calm (reduced motion), spec (an array 0..1 of spectrum bands, optional),
 * `lowFx` (fewer particles). Returns { flash, flashColor, shake, scene, state, layout, beat, newBeat } for the painter.
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
  if (st.eq?.text) S.equationsSeen.add(st.eq.text);

  // ---- 1. Background matrix stars
  for (const s of S.stars) {
    const x = Math.floor(s.u * cols);
    const y = Math.floor(s.v * (F - 2)) + 1;
    const tw = calm ? 0.7 : 0.5 + 0.5 * Math.sin(t * 3 + s.ph);
    if (tw > 0.45) put(buf, x, y, s.ch, tw > 0.85 ? C.WHITE : C.DIM);
  }

  // ---- 2. Sweeping data beams
  {
    const sw = calm ? 0 : Math.sin((beat / 8) * Math.PI * 2);
    const bw = Math.max(3, Math.round(cols * 0.045));
    if (sceneId === 'finale' || sceneId === 'hearts') {
      beam(buf, cols * 0.2, L.cx + sw * cols * 0.2, F, bw, C.SPOT_M);
      beam(buf, cols * 0.8, L.cx - sw * cols * 0.2, F, bw, C.SPOT_G);
    } else {
      beam(buf, cols * 0.25, cols * 0.5 + sw * cols * 0.3, F, bw, C.SPOT_C);
      beam(buf, cols * 0.75, cols * 0.5 - sw * cols * 0.3, F, bw, C.SPOT_M);
    }
  }

  // ---- 3. Block-letter Equation Banner at the top of the stage (with per-term glow & algebra motion)
  const availTop = 2;
  const bannerMaxRows = Math.max(BANNER_H, Math.min(18, Math.floor((F - availTop) * 0.45)));
  const bannerTitle = st.bannerText || st.eq?.text || st.scene.title;
  let bannerBottom = availTop + BANNER_H;
  if (!st.credits) {
    const lay = bannerFor(bannerTitle, cols, bannerMaxRows);
    const px = lay.px;
    const bx0 = Math.floor((cols - lay.w) / 2);
    const by0 = availTop;
    bannerBottom = by0 + lay.h + 1;
    const n = lay.letters.length || 1;
    const ripple = (beat * 5) % (n + 8);
    const movedTerm = st.eq?.moved?.term || '';
    const slideOffset = !calm && st.eq?.sliding ? Math.round((1 - st.eq.slideProgress) * (st.eq.moved?.fromSide === 'left' ? -5 : 5)) : 0;

    for (const lt of lay.letters) {
      const near = Math.max(0, 1 - Math.abs(lt.index - ripple) / 1.8);
      const lift = calm ? 0 : Math.round(near * 1.2);
      const white = (pulse > 0.8 || st.eq?.justBalanced) && !calm;
      const isMoved = movedTerm && movedTerm.includes(lt.word);
      const dx = isMoved ? slideOffset : 0;
      const co = white ? C.WHITE : termColor(lt.word, lt.index, beat);
      for (let r = 0; r < BANNER_H; r += 1) {
        for (let c = 0; c < lt.rows[r].length; c += 1) {
          if (lt.rows[r][c] !== '#') continue;
          for (let q = 0; q < px; q += 1) put(buf, bx0 + lt.x + c * px + q + dx, by0 + lt.y + r - lift, '\u2588', co, 1);
        }
      }
    }

    // Live algebra motion & balance row directly under the banner
    if (st.eq && bannerBottom < F - 6) {
      const eq = st.eq;
      clearRow(buf, bannerBottom, 1, cols - 2);
      if (eq.sliding && !calm) {
        const mv = eq.moved || { term: 'Credits', fromSign: '-', toSign: '+' };
        const arrow = eq.slideProgress < 0.5 ? '===>' : '>>>=';
        const msg =
          cols >= 68
            ? `ALGEBRA MOVE: [ ${mv.fromSign} ${mv.term} ] ${arrow} = ${arrow} [ ${mv.toSign} ${mv.term} ]   (${eq.leftValue} = ${eq.rightValue})`
            : `MOVE [${mv.fromSign}${mv.term}] => = => [${mv.toSign}${mv.term}] (${eq.leftValue}=${eq.rightValue})`;
        textC(buf, bannerBottom, msg.slice(0, cols - 2), C.AMBER, 1);
      } else {
        const msg =
          cols >= 68
            ? `BALANCED: ${eq.text}   [ LHS ${eq.leftValue} == RHS ${eq.rightValue} ]`
            : `[ ${eq.leftValue} == ${eq.rightValue} ] ${eq.text}`;
        textC(buf, bannerBottom, msg.slice(0, cols - 2), eq.justBalanced && !calm ? C.WHITE : C.BRIGHT, 1);
      }
      bannerBottom += 1;
    }
  }

  // ---- 4. Main Visualization Area (GPU Farm, Token Stream, Internet Network, Rising Hearts, Finale Stack)
  const vizTop = Math.max(bannerBottom + 1, L.topViz);
  const vizBot = F - 1;

  if (!st.credits) {
    if (sceneId === 'finale') {
      // Finale: stacked four main equations in the upper-middle ledger, plus farm racks on left, network on right, rising hearts
      drawNet(buf, st, vizTop, vizBot, beat, calm);
      drawRisingHearts(buf, st, vizTop, vizBot, beat, calm);
      const stackY = Math.max(vizTop, Math.floor((vizTop + vizBot) / 2) - 2);
      CORE_EQUATIONS.forEach((eqText, i) => {
        const yy = stackY + i;
        if (yy >= vizBot) return;
        clearRow(buf, yy, Math.max(0, Math.floor((cols - eqText.length) / 2) - 2), Math.min(cols - 1, Math.ceil((cols + eqText.length) / 2) + 2));
        const active = Math.floor(Math.max(0, beat) / 2) % 4 === i;
        textC(buf, yy, eqText, active ? C.WHITE : rainbow(i * 5 + beat * 2), 1);
      });
    } else if (st.showFarm && st.showNet) {
      // Connected split/fly-through: top half or left/right shows farm + stream + network
      const midY = Math.floor((vizTop + vizBot) / 2);
      if (vizBot - vizTop >= 14) {
        drawFarm(buf, st, vizTop, midY, beat, calm);
        drawTokenStreamAndHearts(buf, st, midY, beat, calm);
        drawNet(buf, st, midY + 1, vizBot, beat, calm);
      } else {
        drawNet(buf, st, vizTop, vizBot, beat, calm);
        drawTokenStreamAndHearts(buf, st, vizBot - 1, beat, calm);
      }
      drawRisingHearts(buf, st, vizTop, vizBot, beat, calm);
    } else if (st.showFarm) {
      drawFarm(buf, st, vizTop, vizBot - 1, beat, calm);
      if (st.showStream) drawTokenStreamAndHearts(buf, st, vizBot - 1, beat, calm);
      drawRisingHearts(buf, st, vizTop, vizBot, beat, calm);
    } else if (st.showNet) {
      drawNet(buf, st, vizTop, vizBot - 1, beat, calm);
      if (st.showStream) drawTokenStreamAndHearts(buf, st, vizBot - 1, beat, calm);
      drawRisingHearts(buf, st, vizTop, vizBot, beat, calm);
    }
  }

  // ---- 5. Live Equation Tally Row (`GPU + Text = Hearts - Credits` updating live from the scene)
  const tallyRow = F;
  if (!st.credits) {
    const tlObj = st.tally;
    const forms = [
      `LIVE TALLY: GPU(${tlObj.gpu}) + Text(${tlObj.text}) = Hearts(${tlObj.hearts}) - Credits(${tlObj.credits}) [EQUAL]`,
      `GPU(${tlObj.gpu}) + Text(${tlObj.text}) = Hearts(${tlObj.hearts}) - Credits(${tlObj.credits})`,
      `GPU(${tlObj.gpu})+Text(${tlObj.text})=Hearts(${tlObj.hearts})-Credits(${tlObj.credits})`,
      `GPU ${tlObj.gpu}+Text ${tlObj.text}=Hearts ${tlObj.hearts}-Cr ${tlObj.credits}`,
      `${tlObj.gpu}+${tlObj.text}=${tlObj.hearts}-${tlObj.credits}`,
    ];
    const tallyStr = forms.find((f) => f.length <= cols) || forms[forms.length - 1];
    clearRow(buf, tallyRow, 0, cols - 1);
    textC(buf, tallyRow, tallyStr.slice(0, cols), C.CYAN, 1);
  }

  // ---- 6. Stage floor tiles that step with the beat
  const tileRow = F + 1;
  for (let x = 0; x < cols; x += 1) {
    const lit = (Math.floor(x / 4) + bi) % 3 === 0;
    put(buf, x, tileRow, Math.floor(x / 4) % 2 ? '=' : '-', lit ? rainbow(x / 3 + beat * 2) : C.DEEP, lit ? 1 : 0);
  }
  if (tileRow + 2 < rows - L.eqH - 1) {
    for (let x = 0; x < cols; x += 1) put(buf, x, tileRow + 2, x % 8 === 0 ? '+' : '_', C.DEEP);
  }

  // ---- 7. Beat effects: flash, shake, particles
  S.flash = Math.max(0, S.flash - dt * 2.6);
  S.shake = Math.max(0, S.shake - dt * 4.5);
  if (st.hit && st.hit !== S.lastHit && !calm) {
    S.hits += 1;
    S.flash = Math.max(S.flash, 0.28);
    S.shake = Math.max(S.shake, 0.55);
    S.flashColor = rainbow(S.hits * 5);
  }
  S.lastHit = st.hit || null;
  if (newBeat && !calm) {
    S.flash = Math.max(S.flash, downbeat ? 0.18 : 0.07);
    S.flashColor = rainbow(bi * 3);
    if (downbeat) S.shake = Math.max(S.shake, 0.5);
    if (!lowFx || bi % 2 === 0) spawn(S, L, 3, 'spark');
    if (st.confetti) spawn(S, L, lowFx ? 5 : 10, 'heart');
  }

  const live = [];
  for (const p of S.particles) {
    p.life -= dt;
    p.y += p.vy * dt;
    p.x += p.vx * dt;
    if (p.life <= 0 || p.y > F + 2 || p.y < 1 || p.x < -2 || p.x > cols + 2) continue;
    live.push(p);
    text(buf, Math.round(p.x), Math.round(p.y), p.ch, p.co, 1);
  }
  S.particles = calm ? [] : live;

  // ---- 8. Outro credits scroll
  if (st.credits) {
    const lines = CREDITS;
    const total = lines.length;
    const top = rows - 4;
    const span = rows + total * 2;
    const scroll = (st.progress ?? 0) * span * 0.85;
    lines.forEach((ln, i) => {
      const y = Math.round(top - scroll + i * 2);
      if (y < 2 || y > F + 1) return;
      const s0 = ln[0] && ln[1] ? `${ln[0]}   ${ln[1]}` : ln[0] || ln[1];
      if (!s0) return;
      const s = s0.slice(0, cols - 2);
      const x0 = Math.floor((cols - s.length) / 2);
      clearRow(buf, y, x0 - 2, x0 + s.length + 2);
      textC(buf, y, s, i >= 3 && i <= 6 ? rainbow(i * 4 + beat * 2) : i === total - 1 ? C.WHITE : C.BRIGHT, 1);
    });
    if ((st.progress ?? 0) > 0.85) {
      const y = Math.floor(F * 0.45);
      clearRow(buf, y, 0, cols - 1);
      textC(buf, y, 'B U I L D   S U C C E S S F U L'.slice(0, cols), rainbow(beat * 4), 1);
    }
  }

  // ---- 9. Equalizer
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

  // ---- 10. Top and bottom marquees + scene caption
  S.mq1 += dt * (calm ? 0 : 9 + 16 * pulse);
  S.mq2 += dt * (calm ? 0 : 9 + 16 * pulse);
  const mq = (line, y, off, co) => {
    const o = Math.floor(off);
    for (let x = 0; x < cols; x += 1) {
      const ch = line[(((x + o) % line.length) + line.length) % line.length];
      put(buf, x, y, ch, co === 'rb' ? rainbow(x / 4 + beat) : co, 0);
    }
  };
  if (!calm) {
    mq(MARQUEE_TOP[sceneId] || MARQUEE_TOP.default, 0, S.mq1, C.AMBER);
    mq(MARQUEE_BOTTOM[sceneId] || MARQUEE_BOTTOM.default, rows - 1, -S.mq2, 'rb');
  } else {
    textC(buf, 0, 'HAWKES BIOMEDICAL GATEWAY 58', C.AMBER);
    textC(buf, rows - 1, 'GPU + Text = Hearts - Credits', C.DIM);
  }
  if (st.caption) {
    const cap = `~ ${st.caption} ~`.slice(0, cols - 2);
    textC(buf, 1, cap, pulse > 0.6 && !calm ? C.WHITE : C.BRIGHT, 1);
  }

  // ---- 11. Diagonal wipe on scene transitions
  if (!calm && st.sb < 1.2 && st.index > 0) {
    const p = st.sb / 1.2;
    const front = p * (cols + rows * 0.7 + 14) - 7;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const d = x + y * 0.7 - front;
        if (d < -5 || d > 0) continue;
        const k = -d / 5;
        put(buf, x, y, k < 0.25 ? '\u2588' : k < 0.55 ? '\u2593' : k < 0.8 ? '\u2592' : '\u2591', rainbow(sceneId.length * 3 + p * 12 + y * 0.2), 0);
      }
    }
  }

  return {
    flash: calm ? 0 : S.flash,
    flashColor: S.flashColor,
    shake: calm ? 0 : S.shake,
    scene: sceneId,
    state: st,
    layout: L,
    beat,
    newBeat,
  };
}

export { beatPulse, beatAt, BEAT_SEC, BPM, FRAME_W, FRAME_H, CENTER, flip, EQUATIONS, CORE_EQUATIONS, DEFAULT_VARS, balanceEquation, equationsForDuration };
