// The /build show's choreography: a beat clock, a timeline of scenes that adapts to the length of the song, and for every
// scene a function from "beats since the scene began" to what is on the stage (which frame each dancer is in, where he
// stands, how high he is off the floor, the hoop, the ball, a caption, a speech bubble). Pure functions: no DOM, no
// timers, no network. The stage (stage.js) draws what this says; tests read it directly.
//
// Positions are in cells of the stage grid and depend on its width C: the figures keep their size (the frames are
// hand drawn) and the choreography spreads or squeezes around them. y is a lift in rows above the floor (up is positive).

import { JACKSON, JORDAN, FRAME_W, CENTER, HOOP_W, HOOP_H } from './dancers.js';

export const BPM = 118; // measured from song.mp3 (onset autocorrelation: 118, steady for the whole file)
export const BEAT_OFFSET = 0.31; // seconds from the start of the file to the first beat
export const BEAT_SEC = 60 / BPM;
export const BAR_SEC = BEAT_SEC * 4;
export const SILENT_SECONDS = 60; // how long the show runs when there is no audio (the fixed timer)
export const CALM_SECONDS = 48; // the reduced-motion version

// ---- the scenes. `bars` is the nominal length, `min` the shortest it can be squeezed to, `prio` the order scenes are
// dropped in when the song is very short (1 is kept first). The outro and the title are always kept.
export const SCENES = [
  { id: 'intro', bars: 2, min: 1, prio: 1, title: 'SHOWTIME' },
  { id: 'king', bars: 4, min: 2, prio: 4, title: 'THE KING OF POP' },
  { id: 'jackson', bars: 12, min: 3, prio: 2, title: 'JACKSON' },
  { id: 'air', bars: 4, min: 2, prio: 7, title: 'AIR JORDAN' },
  { id: 'jordan', bars: 12, min: 3, prio: 3, title: 'JORDAN' },
  { id: 'mirror', bars: 8, min: 2, prio: 8, title: 'MJ x MJ' },
  { id: 'callresponse', bars: 8, min: 2, prio: 9, title: 'CALL AND RESPONSE' },
  { id: 'battle', bars: 8, min: 2, prio: 6, title: 'BATTLE' },
  { id: 'names', bars: 4, min: 1, prio: 10, title: 'JACKSON x JORDAN' },
  { id: 'finale', bars: 6, min: 2, prio: 5, title: 'MJ x MJ' },
  { id: 'outro', bars: 4, min: 2, prio: 0, title: 'THE END' },
];
const NOMINAL = SCENES.reduce((n, s) => n + s.bars, 0);

/**
 * The timeline for a song `duration` seconds long: [{ id, title, start, end, bars }], contiguous, the first starting at 0
 * and the last ending at `duration`. Scene boundaries sit on bar lines. A long song stretches every scene in proportion
 * (the solos run their sequence again, mirrored, the duets add rounds); a very short one keeps only the highest priority
 * scenes, at their minimum length first.
 */
export function buildTimeline(duration, { offset = BEAT_OFFSET } = {}) {
  const total = Math.max(1, duration);
  const barsAvail = Math.max(1, Math.floor((total - offset) / BAR_SEC));
  let picked = SCENES.map((s) => ({ ...s }));
  if (barsAvail < NOMINAL) {
    // squeeze: keep scenes by priority while their minimum lengths fit, then share what is left out by nominal length
    const keep = new Set();
    let used = 0;
    for (const s of [...SCENES].sort((a, b) => a.prio - b.prio)) {
      if (used + s.min <= barsAvail || s.prio === 0) { keep.add(s.id); used += s.min; }
    }
    picked = picked.filter((s) => keep.has(s.id));
    let spare = Math.max(0, barsAvail - picked.reduce((n, s) => n + s.min, 0));
    for (const s of picked) s.n = s.min;
    const room = picked.map((s) => ({ s, want: s.bars - s.min })).filter((r) => r.want > 0);
    const wantTotal = room.reduce((n, r) => n + r.want, 0) || 1;
    for (const r of room) { const add = Math.min(r.want, Math.floor((spare * r.want) / wantTotal)); r.s.n += add; }
    spare = barsAvail - picked.reduce((n, s) => n + s.n, 0);
    for (let i = 0; spare > 0 && room.length; i = (i + 1) % room.length) { room[i].s.n += 1; spare -= 1; }
  } else {
    // stretch: scale every scene, then hand out the rounding remainder to the longest first
    const scale = barsAvail / NOMINAL;
    for (const s of picked) s.n = Math.max(s.min, Math.floor(s.bars * scale));
    let spare = barsAvail - picked.reduce((n, s) => n + s.n, 0);
    const order = [...picked].sort((a, b) => b.bars - a.bars);
    for (let i = 0; spare > 0; i = (i + 1) % order.length) { order[i].n += 1; spare -= 1; }
  }
  const tl = [];
  let bar = 0;
  picked.forEach((s, i) => {
    const start = i === 0 ? 0 : offset + bar * BAR_SEC;
    bar += s.n;
    const last = i === picked.length - 1;
    tl.push({ id: s.id, title: s.title, bars: s.n, start, end: last ? total : offset + bar * BAR_SEC });
  });
  return tl;
}

/** The scene at time t (the last one for t past the end), and the beats since it began. */
export function sceneAt(tl, t) {
  let sc = tl[tl.length - 1];
  for (const s of tl) if (t < s.end) { sc = s; break; }
  return { scene: sc, sb: Math.max(0, (t - sc.start) / BEAT_SEC), index: tl.indexOf(sc) };
}

// ---- small helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, f) => a + (b - a) * f;
const ease = (f) => { const x = clamp(f, 0, 1); return x * x * (3 - 2 * x); };
const frac = (v) => v - Math.floor(v);
const cyc = (list, perBeat, b) => list[Math.floor(b * perBeat) % list.length]; // `perBeat` frames per beat
const seg = (b, from, to) => clamp((b - from) / (to - from), 0, 1); // 0..1 progress of a stretch of beats
export const beatPulse = (beat) => Math.exp(-frac(beat) * 4.5); // 1 on the beat, falling to ~0.1 at the next

/** The beat number (continuous) at song time t. */
export const beatAt = (t) => (t - BEAT_OFFSET) / BEAT_SEC;

// ---- the stage geometry for a grid: the floor row, the hoop, where the dancers stand
export function layout(C, R) {
  const eqH = clamp(Math.round(R * 0.1), 3, 6);
  const floor = R - 2 - eqH - 5; // the row the feet stand on
  const hoopX = Math.max(FRAME_W, C - HOOP_W - 1);
  const rim = floor - 19; // the row of the rim
  const hoopTop = Math.max(0, rim - 4);
  return { C, R, eqH, floor, hoopX, rim, hoopTop, cx: C / 2, left: Math.round(C * 0.27), right: Math.round(C * 0.73) };
}

// A dancer on the stage: who, which frame (a key of JACKSON / JORDAN), the centre column, the lift, facing, and a tint.
const D = (who, frame, x, y = 0, flipped = false, tint = null) => ({ who, frame, x: Math.round(x), y: Math.round(y), flipped, tint });
const J = (frame, x, y, f, tint) => D('J', frame, x, y, f, tint);
const O = (frame, x, y, f, tint) => D('D', frame, x, y, f ?? false, tint);
const BOB = (beat) => (beatPulse(beat) > 0.55 ? 1 : 0); // sink one row on the beat: the groove

/** Every frame name each dancer owns: tests count them. */
export const FRAMES = { J: Object.keys(JACKSON), D: Object.keys(JORDAN) };

// =====================================================================================================================
// Jackson's solo: a sequence of moves, each a number of bars long. `at(b, L)` gives the dancer for the beat inside it.
// =====================================================================================================================
const MJ_MOVES = [
  { name: 'MOONWALK', bars: 4, at: (b, L, r) => { // glides backwards: faces right, slides left (r flips the round)
    const f = ease(seg(b, 0, 16));
    const x = r ? lerp(L.cx - L.cx * 0.45, L.cx + L.cx * 0.45, f) : lerp(L.cx + L.cx * 0.45, L.cx - L.cx * 0.45, f);
    return { d: [J(cyc(['mw1', 'mw2', 'mw3', 'mw4'], 2, b), x, 0, r)], hit: b < 0.1 ? 'mw' : null };
  } },
  { name: 'SPIN', bars: 1, at: (b, L) => ({ d: [J(cyc(['spinA', 'spinB', 'spinC', 'spinD'], 4, b), L.cx, 0)], hit: b < 0.1 ? 'spin' : null }) },
  { name: 'TOE STAND', bars: 1, at: (b, L) => ({ d: [J('toe', L.cx, 1 + (b > 1 ? 0 : 0), false)], hit: b < 0.1 ? 'toe' : null, sparkle: true }) },
  { name: 'HAT TIP', bars: 1, at: (b, L) => ({ d: [J(b < 3 ? 'hatTip' : 'stand', L.cx, 0)], hit: b < 0.1 ? 'hat' : null }) },
  { name: '45 DEGREE LEAN', bars: 2, at: (b, L) => ({ d: [J(Math.floor(b) % 2 ? 'leanB' : 'lean', L.cx + (Math.floor(b) % 2 ? 1 : 0), 0)], hit: b < 0.1 ? 'lean' : null }) },
  { name: 'SPARKLE GLOVE', bars: 2, at: (b, L) => ({ d: [J(cyc(['gloveA', 'gloveB'], 2, b), L.cx, 0)], sparkle: true, hit: b < 0.1 ? 'glove' : null }) },
  { name: 'FREEZE', bars: 1, at: (b, L) => ({ d: [J(b < 0.5 ? 'point' : 'freeze', L.cx, 0)], hit: b >= 0.5 && b < 0.6 ? 'freeze' : null, hold: b >= 0.5 }) },
];
const MJ_LOOP = MJ_MOVES.reduce((n, m) => n + m.bars, 0) * 4;

// =====================================================================================================================
// Jordan's solo.
// =====================================================================================================================
const ballArc = (a, b, f, peak) => ({ x: lerp(a[0], b[0], f), y: lerp(a[1], b[1], f) + peak * 4 * f * (1 - f) });

const AJ_MOVES = [
  { name: 'DRIBBLE CROSSOVER', bars: 3, at: (b, L) => {
    const side = Math.floor(b) % 2 ? -1 : 1; // the ball hand: right of the figure, then left
    const x = L.cx;
    const frame = frac(b) < 0.5 ? (side > 0 ? 'dribR' : 'dribL') : 'cross';
    const fl = side < 0;
    const f = frac(b);
    const bx = x + side * 6 * (f < 0.5 ? 1 : 1 - (f - 0.5) * 4); // across the body on the second half of the beat
    const by = 1 + Math.abs(Math.sin(Math.PI * f)) * 6;
    const dancer = frame === 'dribL' ? O('dribR', x, 0, true) : O(frame, x, 0, fl && frame === 'cross');
    return { d: [dancer], ball: { x: bx, y: by }, hit: b < 0.1 ? 'cross' : null };
  } },
  { name: 'JUMP SHOT', bars: 2, at: (b, L) => {
    // 0-1.5 gather, 1.5-3 up (the release at the top), 3-5 the ball flies, 5-8 down and watch it drop
    const x = L.hoopX - 22;
    const up = b < 1.5 ? 0 : b < 3 ? ease(seg(b, 1.5, 3)) * 3 : 3 - ease(seg(b, 4.5, 6)) * 3;
    const frame = b < 1.5 ? 'gather' : b < 3 ? 'jump' : b < 5.5 ? 'release' : 'land';
    const out = { d: [O(frame, x, up)] };
    if (b >= 3 && b < 5.5) {
      const f = seg(b, 3, 5);
      const start = [x + 5, 15 + 3];
      const end = [L.hoopX + 6, L.floor - L.rim];
      out.ball = ballArc(start, end, f, 6);
    } else if (b >= 5.5 && b < 8) out.ball = { x: L.hoopX + 6, y: L.floor - L.rim - 3 - (b - 5.5) * (b - 5.5) * 0.9 }; // through the net, down
    out.hoop = b >= 5 && b < 7 ? 1 + Math.floor((b - 5) * 2) % 2 : 0;
    out.bubble = b >= 5 && b < 7.5 ? { text: 'SWISH!', x: L.hoopX - 4, y: L.floor - L.rim - 6 } : null;
    out.hit = b >= 5 && b < 5.1 ? 'swish' : null;
    return out;
  } },
  { name: 'SLAM DUNK', bars: 3, at: (b, L) => {
    // 0-3 the drive from the far left, 3-4 the gather at the take-off spot, 4-7 the leap across, 7-9 on the rim, 9-12 the fall
    const take = L.hoopX - 20;
    const startX = Math.max(CENTER, L.C * 0.1);
    const out = { d: [] };
    if (b < 3) out.d = [O(cyc(['drive', 'ready', 'drive', 'ready'], 2, b), lerp(startX, take, ease(seg(b, 0, 3))), 0)];
    else if (b < 4) out.d = [O('gather', take, 0)];
    else if (b < 7) {
      const f = seg(b, 4, 7);
      out.d = [O(f < 0.55 ? 'leap' : 'dunk', lerp(take, L.hoopX, ease(f)), Math.sin(Math.PI * Math.min(1, f * 1.0)) * 6)];
    } else if (b < 9.5) out.d = [O('dunk', L.hoopX, 6)];
    else out.d = [O(b < 11 ? 'dunk' : 'land', L.hoopX - 1, 6 * (1 - ease(seg(b, 9.5, 11))))];
    out.hoop = b >= 7 && b < 10 ? 1 + Math.floor((b - 7) * 3) % 2 : 0;
    if (b >= 7 && b < 12) out.ball = { x: L.hoopX + 6, y: L.floor - L.rim - 1 - ease(seg(b, 7.3, 11)) * (L.floor - L.rim - 2) };
    out.bubble = b >= 7 && b < 9.5 ? { text: 'BOOM!', x: L.hoopX - 12, y: L.floor - L.rim - 5 } : null;
    out.hit = b >= 7 && b < 7.1 ? 'dunk' : null;
    out.shake = b >= 7 && b < 8;
    return out;
  } },
  { name: 'HANG TIME', bars: 2, at: (b, L) => {
    const x = L.cx;
    const rise = ease(seg(b, 0, 1.5));
    const hover = rise * (6 + Math.sin(b * 1.4) * 0.6) * (b > 7 ? 1 - ease(seg(b, 7, 8)) : 1);
    return { d: [O(b < 1 ? 'gather' : 'hang', x, hover)], hit: b >= 1.5 && b < 1.6 ? 'hang' : null, bubble: b > 2 && b < 7 ? { text: 'HANG TIME...', x: x - 7, y: 17 + 8 } : null };
  } },
  { name: 'SHRUG', bars: 2, at: (b, L) => ({ d: [O(frac(b / 2) < 0.5 ? 'shrug' : 'pivot', L.cx, 0)], bubble: b > 1 && b < 5 ? { text: '(shrug)', x: L.cx - 3, y: 18 } : null, hit: b < 0.1 ? 'shrug' : null }),
  },
];
const AJ_LOOP = AJ_MOVES.reduce((n, m) => n + m.bars, 0) * 4;

/** Which move of a sequence is playing at `b` beats, and the beats into it. */
function inSequence(moves, loop, b) {
  const round = Math.floor(b / loop);
  let lb = b - round * loop;
  for (const m of moves) {
    const len = m.bars * 4;
    if (lb < len) return { m, lb, round };
    lb -= len;
  }
  const m = moves[moves.length - 1];
  return { m, lb: m.bars * 4, round };
}

// =====================================================================================================================
// Duets. Jackson stands on the left facing right, Jordan on the right facing left.
// =====================================================================================================================
const PAIRS = [
  { j: ['stand', 'point'], d: ['ready', 'jumpman'], name: 'MIRROR' },
  { j: ['point', 'gloveA'], d: ['jumpman', 'hang'], name: 'GLOVE / BALL' },
  { j: ['hatTip', 'stand'], d: ['shrug', 'pivot'], name: 'TIP / SHRUG' },
  { j: ['lean', 'leanB'], d: ['drive', 'ready'], name: 'LEAN / DRIVE' },
  { j: ['gloveA', 'gloveB'], d: ['jump', 'release'], name: 'SPARKLE / SHOT' },
  { j: ['spinA', 'spinC'], d: ['cross', 'pivot'], name: 'SPIN / CROSSOVER' },
  { j: ['toe', 'point'], d: ['hang', 'leap'], name: 'TOES / AIR' },
  { j: ['freeze', 'freeze'], d: ['jumpman', 'jumpman'], name: 'FREEZE' },
];

const AIR_FRAMES = new Set(['jump', 'release', 'leap', 'hang', 'jumpman', 'dunk']);
const airLift = (frame, b) => (AIR_FRAMES.has(frame) ? 2 + Math.abs(Math.sin(Math.PI * b * 0.5)) * 2 : 0);

// =====================================================================================================================
// The scenes. scene(sb, L, bars) -> { d: dancers[], ball?, hoop?, bubble?, caption?, banner?, hit?, flash?, shake?, ... }
// =====================================================================================================================
export const SCENE_FNS = {
  intro: (sb, L, bars) => {
    // the lights come up, then both walk on from the wings
    const f = ease(seg(sb, 1, Math.max(2, bars * 4 - 0.5)));
    return {
      d: [J(cyc(['mw1', 'mw2', 'mw3', 'mw4'], 2, sb), lerp(-FRAME_W / 2, L.left, f), 0), O(cyc(['drive', 'ready'], 1, sb), lerp(L.C + FRAME_W / 2, L.right, f), 0, true)],
      caption: sb < 4 ? 'LADIES AND GENTLEMEN' : 'THE 58TH FLOOR PRESENTS', countdown: sb < 3 ? 3 - Math.floor(sb) : 0, hit: sb < 0.1 ? 'open' : null,
    };
  },
  king: (sb, L) => {
    const k = Math.floor(sb / 2) % 4;
    const frame = ['point', 'hatTip', 'gloveA', 'stand'][k];
    return { d: [J(frame === 'gloveA' ? cyc(['gloveA', 'gloveB'], 2, sb) : frame, L.cx, 0)], caption: 'JACKSON', hit: sb % 2 < 0.1 ? `k${k}` : null, sparkle: true };
  },
  jackson: (sb, L, bars) => {
    const speed = clamp(MJ_LOOP / (bars * 4), 1, 3); // a short solo plays the sequence faster so every signature move still shows
    const { m, lb, round } = inSequence(MJ_MOVES, MJ_LOOP, sb * speed);
    const r = m.at(lb, L, round % 2 === 1);
    // a second round runs the sequence again from the other side
    if (round % 2 === 1) for (const d of r.d) { if (m.name !== 'MOONWALK') d.flipped = !d.flipped; if (m.name !== 'MOONWALK') d.x = Math.round(L.C - d.x); }
    return { ...r, caption: m.name };
  },
  air: (sb, L) => {
    const k = Math.floor(sb / 2) % 4;
    const frame = ['jumpman', 'hang', 'shrug', 'leap'][k];
    return { d: [O(frame, L.cx, airLift(frame, sb) + (frame === 'hang' ? 2 : 0), false)], caption: 'JORDAN', hit: sb % 2 < 0.1 ? `a${k}` : null };
  },
  jordan: (sb, L, bars) => {
    const speed = clamp(AJ_LOOP / (bars * 4), 1, 3);
    const { m, lb } = inSequence(AJ_MOVES, AJ_LOOP, sb * speed);
    const r = m.at(lb, L);
    return { ...r, caption: m.name, hoopOn: m.name === 'JUMP SHOT' || m.name === 'SLAM DUNK' };
  },
  mirror: (sb, L) => {
    const n = Math.floor(sb / 4);
    const pass = Math.floor(n / PAIRS.length);
    const step = n % PAIRS.length;
    const pr = PAIRS[pass % 2 ? PAIRS.length - 1 - step : step]; // a second pass runs the pairs backwards, so a long song does not repeat itself
    const b = sb - Math.floor(sb / 4) * 4;
    const i = Math.floor(b * 1) % 2; // the two frames of the pair alternate every beat
    const jf = pr.j[i];
    const df = pr.d[i];
    const gap = L.C * (0.2 + 0.06 * Math.sin(sb * 0.4)) + 2;
    return {
      d: [J(jf, L.cx - gap, airLift(jf, b)), O(df, L.cx + gap, airLift(df, b), true)],
      caption: pr.name, hit: b < 0.1 ? `m${step}` : null, sparkle: true,
    };
  },
  callresponse: (sb, L) => {
    // two bars the caller, two bars the answer, four times (the moves change each time)
    const turn = Math.floor(sb / 8) % 4;
    const callJ = turn % 2 === 0;
    const b = sb - Math.floor(sb / 8) * 8;
    const jMoves = ['gloveA', 'point', 'lean', 'spinA'];
    const dMoves = ['jumpman', 'jump', 'cross', 'hang'];
    const jf = callJ ? (turn === 2 ? Math.floor(b) % 2 ? 'leanB' : 'lean' : cyc([jMoves[turn], turn === 0 ? 'gloveB' : 'point'], 2, b)) : 'stand';
    const df = callJ ? 'ready' : (turn === 3 ? 'hang' : cyc([dMoves[turn], 'pivot'], 2, b));
    return {
      d: [J(jf, L.left, callJ ? 0 : BOB(sb), false, callJ ? null : 'dim'), O(df, L.right, callJ ? BOB(sb) : airLift(df, b), true, callJ ? 'dim' : null)],
      caption: callJ ? 'CALL' : 'RESPONSE',
      bubble: b < 6 ? (callJ ? { text: 'OW!', x: L.left + 2, y: 18 } : { text: 'SWISH!', x: L.right - 3, y: 18 }) : null,
      hit: b < 0.1 ? `c${turn}` : null, sparkle: callJ,
    };
  },
  battle: (sb, L) => {
    // every two beats the floor changes hands; the one who holds it steps to the middle and the other waits at the edge
    const turn = Math.floor(sb / 2);
    const jTurn = turn % 2 === 0;
    const b = sb - turn * 2;
    const round = Math.floor(turn / 2);
    const jSet = ['gloveA', 'spinA', 'lean', 'point', 'freeze', 'hatTip'];
    const dSet = ['cross', 'jump', 'drive', 'hang', 'jumpman', 'shrug'];
    const jf = jSet[round % jSet.length];
    const df = dSet[round % dSet.length];
    const jx = jTurn ? lerp(L.left, L.cx - 6, ease(b)) : lerp(L.cx - 6, L.left - 2, ease(b));
    const dx = jTurn ? lerp(L.cx + 6, L.right + 2, ease(b)) : lerp(L.right, L.cx + 6, ease(b));
    const jp = jTurn ? (jf === 'spinA' ? cyc(['spinA', 'spinB', 'spinC', 'spinD'], 4, b) : jf === 'gloveA' ? cyc(['gloveA', 'gloveB'], 2, b) : jf) : 'stand';
    const dp = jTurn ? 'ready' : df;
    return {
      d: [J(jp, jx, jTurn ? airLift(jp, b) * 0 : BOB(sb), false, jTurn ? null : 'dim'), O(dp, dx, jTurn ? BOB(sb) : airLift(dp, b), true, jTurn ? 'dim' : null)],
      caption: `ROUND ${round + 1}   JACKSON ${Math.ceil((turn + 1) / 2)} : ${Math.floor((turn + 1) / 2)} JORDAN`,
      hit: b < 0.1 ? `b${turn}` : null, spot: jTurn ? 'J' : 'D', flash: b < 0.1,
    };
  },
  names: (sb, L) => {
    const k = Math.floor(sb / 2) % 2;
    return {
      d: [J(k ? 'gloveA' : 'point', L.left, 0), O(k ? 'hang' : 'jumpman', L.right, airLift(k ? 'hang' : 'jumpman', sb), true)],
      caption: 'TOGETHER', hit: sb % 2 < 0.1 ? `n${Math.floor(sb / 2)}` : null, sparkle: true,
    };
  },
  finale: (sb, L, bars) => {
    // they run to the middle, spin and leap, and land in the last pose together for the last bar and a half
    const end = bars * 4;
    const runIn = ease(seg(sb, 0, 4));
    const jx = lerp(L.left, L.cx - 9, runIn);
    const dx = lerp(L.right, L.cx + 9, runIn);
    const posed = sb >= end - 6;
    const jf = posed ? 'freeze' : sb < 4 ? cyc(['mw1', 'mw2', 'mw3', 'mw4'], 2, sb) : cyc(['gloveA', 'gloveB', 'spinA', 'spinC', 'point'], 1, sb - 4);
    const df = posed ? 'jumpman' : sb < 4 ? cyc(['drive', 'ready'], 1, sb) : cyc(['jumpman', 'hang', 'leap', 'jump', 'shrug'], 1, sb - 4);
    return {
      d: [J(jf, jx, posed ? 0 : airLift(jf, sb)), O(df, dx, posed ? 2 : airLift(df, sb), true)],
      caption: posed ? '' : 'ONE MORE TIME', hit: posed && sb < end - 5.9 ? 'final' : sb % 4 < 0.1 ? `f${Math.floor(sb / 4)}` : null,
      confetti: true, flash: sb % 1 < 0.15, sparkle: true, hold: posed,
    };
  },
  outro: (sb, L, bars) => {
    const b = sb;
    return { d: [J(b < 3 ? 'hatTip' : 'stand', L.left, BOB(b)), O(b < 3 ? 'shrug' : 'pivot', L.right, BOB(b), true)], caption: '', credits: true, hit: b < 0.1 ? 'outro' : null, progress: seg(sb, 0, bars * 4) };
  },
};

/**
 * What is on the stage at time t. Returns the scene state plus `scene`, `sb` (beats into the scene), `beat` (the song's
 * beat number), `pulse` (1 on the beat, decaying) and `bar`. `calm` (reduced motion) drops flashes, shakes and bursts.
 */
export function stageAt(tl, t, L, { calm = false } = {}) {
  const { scene, sb, index } = sceneAt(tl, t);
  const fn = SCENE_FNS[scene.id];
  const s = fn(sb, L, scene.bars);
  const beat = beatAt(t);
  const out = { ...s, scene, sb, index, beat, pulse: beatPulse(beat), bar: Math.floor(beat / 4), calm };
  out.d = (s.d || []).map((x) => ({ ...x }));
  return out;
}

/** The hoop placement the stage draws when a scene wants it (the jump shot and the dunk, and the finale). */
export const hoopWanted = (s) => !!s.hoopOn;

export { MJ_MOVES, AJ_MOVES, PAIRS, HOOP_H };
