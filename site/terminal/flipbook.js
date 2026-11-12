// The text flipbook: two generic dark silhouettes (a dancer with a fedora on the left, a basketball player on the right)
// built from articulated 2D skeletons with thick tapered limbs, rasterised to a character grid and interpolated between
// key poses on a steady beat. Pure functions: no DOM, no timers, no network. The UI flips the frames; tests read them.
// Silhouettes only: an iconic pose, a hat, a jersey and shorts outline, a ball. No faces, no likeness detail.

export const BPM = 112;
export const BEAT_SEC = 60 / BPM;
export const BEATS_PER_POSE = 2; // each key pose is reached two beats after the last one

// Segment lengths (world units, a figure is about 1.7 tall).
const L = { torso: 0.55, neck: 0.07, head: 0.11, ua: 0.3, fa: 0.28, th: 0.42, sh: 0.42, foot: 0.17 };

const BASE = {
  x: 0, lift: 0, t: 0, h: 0, hat: 10,
  a1: [10, 15], a2: [-10, -5], l1: [5, 3], l2: [-5, -2], f1: 90, f2: 90,
  ball: [0, 0, 0],
};
const P = (o) => ({ ...BASE, ...o });

// Angles: limbs are measured from straight down (0 = down, 90 = forward +x, 180 = up). The torso and head are measured
// from straight up (positive leans toward +x). Every pose faces +x; the right-hand figure is mirrored to face the left one.
export const POSES_MJ = [
  P({ t: -6, h: -4, hat: 14, a1: [150, 168], a2: [40, -80], l1: [35, 15], l2: [-18, -10] }), // point up
  P({ t: 4, h: 8, hat: 18, a1: [95, 200], a2: [8, 5], l1: [8, 5], l2: [-8, -4] }), // hat tip
  P({ t: 10, h: 10, hat: 12, a1: [50, 75], a2: [-40, -60], l1: [12, 8], l2: [-22, -55], f2: 30, x: 0.1 }), // moonwalk
  P({ t: 0, h: 0, hat: 8, a1: [25, 115], a2: [35, 125], l1: [0, 0], l2: [-25, 35], f1: 20, f2: 60 }), // spin
  P({ t: -4, h: -6, hat: 20, a1: [20, 40], a2: [-25, -35], l1: [2, 0], l2: [-2, 0], f1: 10, f2: 10 }), // toe stand
  P({ t: 38, h: 35, hat: 8, a1: [60, 70], a2: [-45, -40], l1: [-38, -38], l2: [-40, -36], x: -0.2 }), // the lean
  P({ t: 0, h: 0, hat: 12, a1: [90, 92], a2: [-90, -92], l1: [30, 20], l2: [-30, -20] }), // arms wide
  P({ t: 15, h: 20, hat: 30, a1: [110, 205], a2: [30, 10], l1: [50, 0], l2: [-10, -15] }), // hat brim, knees bent
];

export const POSES_JORDAN = [
  P({ t: 18, h: 5, a1: [25, 5], a2: [80, 100], l1: [55, -5], l2: [-20, -45], ball: [0, 0.02, -0.14] }), // dribble crouch
  P({ t: 15, h: 0, a1: [40, 30], a2: [100, 60], l1: [85, 10], l2: [-5, -5], ball: [0, 0.05, -0.1] }), // drive, knee up
  P({ t: -8, h: 10, a1: [150, 175], a2: [-105, -105], l1: [75, 15], l2: [-70, -80], lift: 0.5, ball: [0, 0, 0.12] }), // the Jumpman leap
  P({ t: 6, h: 10, a1: [155, 172], a2: [145, 170], l1: [55, -10], l2: [-25, -60], lift: 0.6, ball: [0.5, 0.02, 0.13] }), // the dunk
  P({ t: -22, h: -15, a1: [165, 185], a2: [100, 60], l1: [40, 15], l2: [-5, -20], lift: 0.45, ball: [0, 0, 0.12] }), // fadeaway jumper
  P({ t: 12, h: 5, a1: [140, 160], a2: [120, 140], l1: [60, -5], l2: [40, -10], ball: [0, 0.3, 0.6] }), // landing, the ball is up and away
  P({ t: 5, h: 0, a1: [40, 100], a2: [50, 105], l1: [30, 10], l2: [-20, -10], ball: [0.5, 0.08, 0] }), // triple threat
  P({ t: -5, h: 0, a1: [60, 80], a2: [40, 70], l1: [40, 5], l2: [-40, -5], ball: [0, 0.05, -0.05] }), // pivot
];

export const FIGURES = {
  mj: { poses: POSES_MJ, hat: true, ball: false, torso: [0.13, 0.15], thigh: [0.11, 0.09], shin: [0.08, 0.06], arm: [0.065, 0.055] },
  mjd: { poses: POSES_JORDAN, hat: false, ball: true, torso: [0.17, 0.2], thigh: [0.14, 0.11], shin: [0.085, 0.065], arm: [0.07, 0.06] },
};

const rad = (d) => (d * Math.PI) / 180;
const down = (d) => [Math.sin(rad(d)), -Math.cos(rad(d))]; // limb direction
const up = (d) => [Math.sin(rad(d)), Math.cos(rad(d))]; // torso and head direction
const add = (p, v, s = 1) => [p[0] + v[0] * s, p[1] + v[1] * s];

const lerp = (a, b, f) => a + (b - a) * f;
function mix(a, b, f) {
  if (Array.isArray(a)) return a.map((v, i) => lerp(v, b[i], f));
  return lerp(a, b, f);
}
const ease = (f) => f * f * (3 - 2 * f);

/** The pose at beat `beat` (continuous): the two neighbouring key poses, eased. `offset` shifts a figure by whole beats. */
export function poseAt(poses, beat) {
  const u = beat / BEATS_PER_POSE;
  const i = Math.floor(u);
  const f = ease(u - i);
  const a = poses[((i % poses.length) + poses.length) % poses.length];
  const b = poses[(((i + 1) % poses.length) + poses.length) % poses.length];
  const out = {};
  for (const k of Object.keys(BASE)) out[k] = mix(a[k], b[k], f);
  return out;
}

/** Forward kinematics: capsules (a, b, ra, rb) in world units, y up, the lowest foot on the floor at `lift`. */
export function skeleton(pose, fig) {
  const rel = (pel) => {
    const sh = add(pel, up(pose.t), L.torso);
    const headC = add(sh, up(pose.h), L.neck + L.head);
    const arm = (a) => { const el = add(sh, down(a[0]), L.ua); return [el, add(el, down(a[1]), L.fa)]; };
    const leg = (l, ft) => { const kn = add(pel, down(l[0]), L.th); const an = add(kn, down(l[1]), L.sh); return [kn, an, add(an, down(ft), L.foot)]; };
    return { sh, headC, arms: [arm(pose.a1), arm(pose.a2)], legs: [leg(pose.l1, pose.f1), leg(pose.l2, pose.f2)] };
  };
  const probe = rel([0, 0]);
  const low = Math.min(...probe.legs.flatMap((l) => [l[1][1], l[2][1]]));
  const pel = [pose.x, -low + pose.lift];
  const j = rel(pel);
  const caps = [];
  const cap = (a, b, [ra, rb]) => caps.push([a[0], a[1], b[0], b[1], ra, rb]);
  cap(pel, j.sh, fig.torso);
  cap(j.sh, j.headC, [0.045, 0.05]);
  cap(j.headC, j.headC, [L.head, L.head]);
  for (const [el, hand] of j.arms) {
    cap(j.sh, el, fig.arm);
    cap(el, hand, [fig.arm[1], fig.arm[1] - 0.005]);
    cap(hand, hand, [0.05, 0.05]);
  }
  for (const [kn, an, toe] of j.legs) {
    cap(pel, kn, fig.thigh);
    cap(kn, an, fig.shin);
    cap(an, toe, [0.05, 0.04]);
  }
  if (fig.hat) {
    const d = pose.h + pose.hat; // a tilted fedora
    const base = add(j.headC, up(d), 0.085);
    cap(base, add(base, up(d), 0.09), [0.095, 0.085]); // crown
    const side = [Math.cos(rad(d)), -Math.sin(rad(d))];
    cap(add(base, side, -0.22), add(base, side, 0.22), [0.03, 0.03]); // brim
  }
  if (fig.ball) {
    const [w, dx, dy] = pose.ball;
    const h1 = j.arms[0][1];
    const h2 = j.arms[1][1];
    const c = [lerp(h1[0], h2[0], w) + dx, lerp(h1[1], h2[1], w) + dy];
    cap(c, c, [0.125, 0.125]);
  }
  return caps;
}

// World box each figure is fitted into (the same for both, so they read at the same scale).
const VIEW = { w: 2.5, yMin: -0.05, yMax: 2.65 };

/**
 * Rasterise both figures into a cols x rows grid. 0 = empty, 1 = left figure (dancer), 2 = right figure (player).
 * `aspect` is a cell's height over its width (a monospace cell is about 2). Each figure is fitted to its half.
 */
export function rasterize(cols, rows, time, { aspect = 2 } = {}) {
  const mask = new Uint8Array(cols * rows);
  const half = Math.floor(cols / 2);
  const physH = rows * aspect;
  const scaleFor = (w) => Math.min(w / VIEW.w, physH / (VIEW.yMax - VIEW.yMin));
  const beat = time / BEAT_SEC;
  const draw = (fig, beatShift, x0, w, mirror, id) => {
    const s = scaleFor(w);
    const cx = x0 + w / 2;
    const top = (physH - (VIEW.yMax - VIEW.yMin) * s) / 2;
    const b = beat + beatShift;
    const pose = poseAt(fig.poses, b);
    pose.lift += 0.03 * Math.abs(Math.sin(Math.PI * b)); // a small bounce on every beat
    for (const [ax, ay, bx, by, ra, rb] of skeleton(pose, fig)) {
      const m = mirror ? -1 : 1;
      const A = [cx + m * ax * s, top + (VIEW.yMax - ay) * s];
      const B = [cx + m * bx * s, top + (VIEW.yMax - by) * s];
      const pad = Math.max(ra, rb) * s + 1;
      const c0 = Math.max(x0 === 0 ? 0 : half, Math.floor(Math.min(A[0], B[0]) - pad));
      const c1 = Math.min(x0 === 0 ? half : cols, Math.ceil(Math.max(A[0], B[0]) + pad));
      const r0 = Math.max(0, Math.floor((Math.min(A[1], B[1]) - pad) / aspect));
      const r1 = Math.min(rows, Math.ceil((Math.max(A[1], B[1]) + pad) / aspect));
      const dx = B[0] - A[0];
      const dy = B[1] - A[1];
      const len2 = dx * dx + dy * dy;
      for (let r = r0; r < r1; r += 1) {
        const py = (r + 0.5) * aspect;
        for (let c = c0; c < c1; c += 1) {
          const px = c + 0.5;
          const u = len2 > 1e-9 ? Math.max(0, Math.min(1, ((px - A[0]) * dx + (py - A[1]) * dy) / len2)) : 0;
          const qx = A[0] + dx * u - px;
          const qy = A[1] + dy * u - py;
          const rad2 = (ra + (rb - ra) * u) * s;
          if (qx * qx + qy * qy <= rad2 * rad2) mask[r * cols + c] = id;
        }
      }
    }
  };
  draw(FIGURES.mj, 0, 0, half, false, 1);
  draw(FIGURES.mjd, 1, half, cols - half, true, 2);
  return mask;
}

/** The size of a blob: cell count and centre x (in cells), for one figure id. */
export function blob(mask, cols, id) {
  let n = 0;
  let sx = 0;
  for (let i = 0; i < mask.length; i += 1) if (mask[i] === id) { n += 1; sx += i % cols; }
  return { n, cx: n ? sx / n + 0.5 : NaN };
}

/**
 * One text frame: the mask filled with the scrolling log text. `src` is an array of log lines (the newest last),
 * `lineAt` offsets into it. Inside a silhouette every cell shows the log character (a space shows a dot, so the shape
 * never has holes); outside is empty in `left` / `right` and the same text, dim, in `bg`.
 */
export function composeFrame(mask, cols, rows, src) {
  const rowsText = [];
  const n = src.length;
  for (let r = 0; r < rows; r += 1) {
    let s = '';
    let k = (n - rows + r) % Math.max(1, n);
    if (k < 0) k += n;
    while (s.length < cols && n) { s += `${src[k % n]}  `; k += rows; }
    rowsText.push(s.slice(0, cols).padEnd(cols, ' '));
  }
  const half = Math.floor(cols / 2);
  const left = [];
  const right = [];
  let nl = 0;
  let nr = 0;
  for (let r = 0; r < rows; r += 1) {
    let l = '';
    let rr = '';
    const row = rowsText[r];
    for (let c = 0; c < cols; c += 1) {
      const id = mask[r * cols + c];
      const ch = id ? (row[c] === ' ' ? '.' : row[c]) : ' ';
      if (c < half) { l += ch; if (id) nl += 1; } else { rr += ch; if (id) nr += 1; }
    }
    left.push(l);
    right.push(rr);
  }
  return { left: left.join('\n'), right: right.join('\n'), bg: rowsText.join('\n'), nl, nr };
}
