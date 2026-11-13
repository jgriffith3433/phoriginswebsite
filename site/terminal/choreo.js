// The /build show's choreography: a beat clock, a timeline of scenes that adapts to the length of the song, and for every
// scene a pure function from "beats since the scene began" to what is on the stage (which equation is balancing, the GPU
// farm racks, the network nodes and moving packets, the token stream from farm to net, the rising hearts, and the live
// tally of GPU + Text = Hearts - Credits). Pure functions: no DOM, no timers, no network.

import {
  EQUATIONS,
  CORE_EQUATIONS,
  DEFAULT_VARS,
  balanceEquation,
  equationsForDuration,
  buildFarmState,
  buildNetState,
  FRAME_W,
  FRAME_H,
  CENTER,
} from './dancers.js';

export const BPM = 128; // measured from song.mp3 (onset comb fit: 128.00, steady for the whole 228.264 s file)
export const BEAT_OFFSET = 0.409; // seconds from the start of the file to the first beat (same in each third of the file)
export const SONG_SECONDS = 228.264; // the length of the song in the repo (the show reads the real length from the file)
export const BEAT_SEC = 60 / BPM;
export const BAR_SEC = BEAT_SEC * 4;
export const SILENT_SECONDS = 60; // how long the show runs when there is no audio (the fixed timer)
export const CALM_SECONDS = 48; // the reduced-motion version

// ---- the scenes. `bars` is the nominal length, `min` the shortest it can be squeezed to, `prio` the order scenes are
// dropped in when the song is very short (1 is kept first). The outro is always kept.
export const SCENES = [
  { id: 'boot', bars: 4, min: 1, prio: 4, title: 'RACK BOOT' },
  { id: 'eq1', bars: 6, min: 1, prio: 1, title: 'GPU + Text = Hearts - Credits' },
  { id: 'farm', bars: 10, min: 2, prio: 2, title: 'GPU FARM' },
  { id: 'eq2', bars: 6, min: 1, prio: 5, title: 'Hearts = GPU + Text + Credits' },
  { id: 'net', bars: 10, min: 2, prio: 2, title: 'THE INTERNET' },
  { id: 'flythrough', bars: 8, min: 2, prio: 6, title: 'FARM TO NET' },
  { id: 'hearts', bars: 8, min: 2, prio: 3, title: 'HEARTS FLOOD' },
  { id: 'rapid', bars: 10, min: 2, prio: 3, title: 'RAPID ALGEBRA' },
  { id: 'finale', bars: 6, min: 2, prio: 1, title: 'THE ALGORITHMS' },
  { id: 'outro', bars: 4, min: 1, prio: 0, title: 'BUILD SUCCESSFUL' },
];
const NOMINAL = SCENES.reduce((n, s) => n + s.bars, 0);

/**
 * The timeline for a song `duration` seconds long: [{ id, title, start, end, bars }], contiguous, the first starting at 0
 * and the last ending at `duration`. Scene boundaries sit on bar lines.
 */
export function buildTimeline(duration, { offset = BEAT_OFFSET } = {}) {
  const total = Math.max(1, duration);
  const barsAvail = Math.max(1, Math.floor((total - offset) / BAR_SEC));
  let picked = SCENES.map((s) => ({ ...s }));
  if (barsAvail < NOMINAL) {
    const keep = new Set();
    let used = 0;
    for (const s of [...SCENES].sort((a, b) => a.prio - b.prio)) {
      if (used + s.min <= barsAvail || s.prio === 0) {
        keep.add(s.id);
        used += s.min;
      }
    }
    picked = picked.filter((s) => keep.has(s.id));
    let spare = Math.max(0, barsAvail - picked.reduce((n, s) => n + s.min, 0));
    for (const s of picked) s.n = s.min;
    const room = picked.map((s) => ({ s, want: s.bars - s.min })).filter((r) => r.want > 0);
    const wantTotal = room.reduce((n, r) => n + r.want, 0) || 1;
    for (const r of room) {
      const add = Math.min(r.want, Math.floor((spare * r.want) / wantTotal));
      r.s.n += add;
    }
    spare = barsAvail - picked.reduce((n, s) => n + s.n, 0);
    for (let i = 0; spare > 0 && room.length; i = (i + 1) % room.length) {
      room[i].s.n += 1;
      spare -= 1;
    }
  } else {
    // A long song is not one stretched pass: the middle scenes (everything between the boot and the finale) run again, as
    // many rounds as fit, each squeezed or stretched so the whole still ends exactly on the song.
    const ratio = barsAvail / NOMINAL;
    const rounds = Math.max(1, Math.ceil(ratio - 0.15));
    if (rounds > 1) {
      const mid = SCENES.filter((s) => !['boot', 'finale', 'outro'].includes(s.id));
      const first = SCENES.find((s) => s.id === 'boot');
      const tail = SCENES.filter((s) => s.id === 'finale' || s.id === 'outro');
      picked = [{ ...first }];
      for (let r = 0; r < rounds; r += 1) for (const s of mid) picked.push({ ...s, round: r });
      picked.push(...tail.map((s) => ({ ...s })));
    }
    const nominal = picked.reduce((n, s) => n + s.bars, 0);
    const scale = barsAvail / nominal;
    for (const s of picked) s.n = Math.max(s.min, Math.floor(s.bars * scale));
    let spare = barsAvail - picked.reduce((n, s) => n + s.n, 0);
    const order = [...picked].sort((a, b) => b.bars - a.bars);
    for (let i = 0; spare > 0; i = (i + 1) % order.length) {
      order[i].n += 1;
      spare -= 1;
    }
  }
  const tl = [];
  let bar = 0;
  picked.forEach((s, i) => {
    const start = i === 0 ? 0 : offset + bar * BAR_SEC;
    bar += s.n;
    const last = i === picked.length - 1;
    tl.push({ id: s.id, title: s.title, round: s.round || 0, bars: s.n, start, end: last ? total : offset + bar * BAR_SEC });
  });
  return tl;
}

/** The scene at time t (the last one for t past the end), and the beats since it began. */
export function sceneAt(tl, t) {
  let sc = tl[tl.length - 1];
  for (const s of tl) {
    if (t < s.end) {
      sc = s;
      break;
    }
  }
  return { scene: sc, sb: Math.max(0, (t - sc.start) / BEAT_SEC), index: tl.indexOf(sc) };
}

// ---- small helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const frac = (v) => v - Math.floor(v);
const seg = (b, from, to) => clamp((b - from) / Math.max(1e-6, to - from), 0, 1);
export const beatPulse = (beat) => Math.exp(-frac(beat) * 4.5);

/** The beat number (continuous) at song time t. */
export const beatAt = (t) => (t - BEAT_OFFSET) / BEAT_SEC;

/** The stage geometry for a grid of `C` columns by `R` rows. */
export function layout(C, R) {
  const eqH = clamp(Math.round(R * 0.1), 3, 5);
  const floor = R - 2 - eqH - 3;
  const topViz = Math.min(11, Math.max(8, Math.floor(R * 0.28)));
  return {
    C,
    R,
    eqH,
    floor,
    topViz,
    cx: Math.floor(C / 2),
    left: Math.round(C * 0.25),
    right: Math.round(C * 0.75),
  };
}

/** Build the active equation state for a given equation index and beat progress within its slot. */
function makeEqState(eqIndex, slotBeat, { rapid = false } = {}) {
  const eq = EQUATIONS[((eqIndex % EQUATIONS.length) + EQUATIONS.length) % EQUATIONS.length];
  const bal = balanceEquation(eq, DEFAULT_VARS);
  const period = rapid ? 1 : 2;
  const phase = ((slotBeat % period) + period) % period / period; // 0..1 within the equation's beat cycle
  const sliding = phase < 0.45;
  const slideProgress = sliding ? phase / 0.45 : 1;
  const justBalanced = phase >= 0.45 && phase < 0.62;
  return {
    ...eq,
    ...bal,
    phase,
    sliding,
    slideProgress,
    justBalanced,
  };
}

export const SCENE_FNS = {
  boot: (sb, L, bars) => {
    const totalBeats = Math.max(4, bars * 4);
    const bootProgress = seg(sb, 0, totalBeats);
    const eqIdx = Math.floor(sb / 2) % 4;
    return {
      mode: 'boot',
      bootProgress,
      eq: makeEqState(eqIdx, sb),
      showFarm: true,
      showNet: false,
      showStream: bootProgress > 0.5,
      heartsRate: 0,
      caption: sb < 4 ? 'BOOTING 58TH FLOOR GPU CLUSTER' : 'INITIALIZING INTERNET ALGEBRA',
      hit: sb < 0.15 ? 'boot' : null,
    };
  },
  eq1: (sb, L, bars) => {
    const totalBeats = Math.max(4, bars * 4);
    const eqIdx = Math.floor((sb / totalBeats) * 4) % 4;
    const eq = makeEqState(eqIdx, sb);
    return {
      mode: 'equation',
      eq,
      bannerText: eq.text,
      showFarm: true,
      showNet: false,
      showStream: true,
      heartsRate: 0.25,
      caption: eq.caption,
      hit: eq.justBalanced ? `eq-${eq.id}` : null,
      flash: eq.justBalanced,
    };
  },
  farm: (sb, L, bars) => {
    const farmEqs = [0, 4, 7, 11, 1, 2, 3];
    const pick = farmEqs[Math.floor(sb / 4) % farmEqs.length];
    const eq = makeEqState(pick, sb);
    const zoom = 0.65 + 0.35 * Math.sin(seg(sb, 0, bars * 4) * Math.PI);
    return {
      mode: 'farm',
      eq,
      bannerText: eq.text,
      showFarm: true,
      farmZoom: zoom,
      showNet: false,
      showStream: true,
      heartsRate: 0.35,
      caption: 'GPU SERVER FARM  //  RACKS + FANS + CREDITS METER',
      hit: sb % 4 < 0.15 ? `farm-${Math.floor(sb / 4)}` : null,
    };
  },
  eq2: (sb, L, bars) => {
    const seq = [1, 2, 3, 4, 5, 6, 8, 9];
    const idx = seq[Math.floor(sb / 2) % seq.length];
    const eq = makeEqState(idx, sb);
    return {
      mode: 'equation',
      eq,
      bannerText: eq.text,
      showFarm: true,
      showNet: true,
      showStream: true,
      heartsRate: 0.5,
      caption: eq.caption,
      hit: eq.justBalanced ? `eq2-${eq.id}` : null,
      flash: eq.justBalanced,
    };
  },
  net: (sb, L, bars) => {
    const netEqs = [5, 6, 12, 13, 14, 15, 17, 22];
    const pick = netEqs[Math.floor(sb / 4) % netEqs.length];
    const eq = makeEqState(pick, sb);
    return {
      mode: 'net',
      eq,
      bannerText: eq.text,
      showFarm: false,
      showNet: true,
      showStream: true,
      heartsRate: 0.6,
      caption: 'GLOBAL NETWORK TOPOLOGY  //  PACKETS IN FLIGHT',
      hit: sb % 4 < 0.15 ? `net-${Math.floor(sb / 4)}` : null,
    };
  },
  flythrough: (sb, L, bars) => {
    const totalBeats = Math.max(4, bars * 4);
    const pan = seg(sb, 0, totalBeats); // 0 = inside GPU farm, 0.5 = token trunk stream, 1 = network core
    const streamEqs = [4, 19, 16, 18, 20, 21];
    const pick = streamEqs[Math.floor(sb / 3) % streamEqs.length];
    const eq = makeEqState(pick, sb);
    return {
      mode: 'flythrough',
      pan,
      eq,
      bannerText: eq.text,
      showFarm: true,
      showNet: true,
      showStream: true,
      heartsRate: 0.75,
      caption: pan < 0.35 ? 'CAMERA: GPU RACK AISLE' : pan < 0.7 ? 'CAMERA: TOKEN STREAM TRUNK' : 'CAMERA: GATEWAY 58 CORE',
      hit: sb % 4 < 0.15 ? `fly-${Math.floor(sb / 4)}` : null,
    };
  },
  hearts: (sb, L, bars) => {
    const heartEqs = [1, 3, 9, 10, 21, 0, 2];
    const pick = heartEqs[Math.floor(sb / 3) % heartEqs.length];
    const eq = makeEqState(pick, sb);
    return {
      mode: 'hearts',
      eq,
      bannerText: eq.text,
      showFarm: false,
      showNet: true,
      showStream: true,
      heartsRate: 1.0,
      confetti: true,
      caption: 'HEARTS RISING OUT OF THE NET  //  LIVE LEDGER TALLY',
      hit: sb % 2 < 0.15 ? `heart-${Math.floor(sb / 2)}` : null,
    };
  },
  rapid: (sb, L, bars) => {
    const totalBeats = Math.max(4, bars * 4);
    const sweepIdx = Math.floor((sb / totalBeats) * EQUATIONS.length * Math.max(1, Math.floor(totalBeats / EQUATIONS.length)));
    const eq = makeEqState(sweepIdx % EQUATIONS.length, sb, { rapid: true });
    return {
      mode: 'rapid',
      eq,
      bannerText: eq.text,
      showFarm: true,
      showNet: true,
      showStream: true,
      heartsRate: 0.85,
      caption: `RAPID ALGEBRA [${(sweepIdx % EQUATIONS.length) + 1}/${EQUATIONS.length}]  //  ${eq.caption}`,
      hit: frac(sb) < 0.15 ? `rapid-${sweepIdx % EQUATIONS.length}` : null,
      flash: frac(sb) < 0.15,
    };
  },
  finale: (sb, L, bars) => {
    const idx = Math.floor(sb / 2) % 4;
    const eq = makeEqState(idx, sb);
    return {
      mode: 'finale',
      eq,
      bannerText: eq.text,
      stackedEquations: CORE_EQUATIONS,
      showFarm: true,
      showNet: true,
      showStream: true,
      heartsRate: 1.0,
      confetti: true,
      caption: 'ALL SYSTEMS LIT  //  THE FOUR LAWS OF THE INTERNET',
      hit: sb % 2 < 0.15 ? `fin-${Math.floor(sb / 2)}` : null,
      flash: sb % 1 < 0.15,
    };
  },
  outro: (sb, L, bars) => {
    const eq = makeEqState(0, sb);
    return {
      mode: 'outro',
      eq,
      bannerText: 'BUILD SUCCESSFUL',
      stackedEquations: CORE_EQUATIONS,
      showFarm: true,
      showNet: true,
      showStream: false,
      heartsRate: 0.4,
      credits: true,
      caption: '',
      hit: sb < 0.15 ? 'outro' : null,
      progress: seg(sb, 0, bars * 4),
    };
  },
};

/**
 * What is on the stage at time t. Returns the scene state plus `scene`, `sb` (beats into the scene), `beat` (the song's
 * beat number), `pulse` (1 on the beat, decaying), `bar`, `farm`, `net`, and `tally`.
 */
export function stageAt(tl, t, L, { calm = false } = {}) {
  const { scene, sb, index } = sceneAt(tl, t);
  const fn = SCENE_FNS[scene.id] || SCENE_FNS.eq1;
  const s = fn(sb, L, scene.bars);
  const beat = beatAt(t);
  const bPos = Math.max(0, beat);
  const farm = buildFarmState(L.C, L.R, bPos, { zoom: s.farmZoom ?? 1, calm });
  const net = buildNetState(L.C, L.R, L.topViz, L.floor - 2, bPos, { calm });
  const tally = {
    gpu: farm.gpu,
    text: farm.text,
    credits: farm.credits,
    hearts: farm.hearts,
    balanced: farm.gpu + farm.text === farm.hearts - farm.credits,
  };
  return {
    ...s,
    scene,
    sb,
    index,
    beat,
    pulse: beatPulse(beat),
    bar: Math.floor(beat / 4),
    calm,
    farm,
    net,
    tally,
  };
}

export { EQUATIONS, CORE_EQUATIONS, DEFAULT_VARS, balanceEquation, equationsForDuration, FRAME_W, FRAME_H, CENTER };
