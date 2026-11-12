// A big block-letter font for the show's name banners: 5 rows high, 4 columns wide (M and W are 5, I is 3), drawn from
// `#`. Pure functions: a banner is laid out as a list of letters with their own position, so the stage can colour and
// wave each letter on its own. ASCII only.

const G = {
  A: ['.##.', '#..#', '####', '#..#', '#..#'],
  B: ['###.', '#..#', '###.', '#..#', '###.'],
  C: ['.###', '#...', '#...', '#...', '.###'],
  D: ['###.', '#..#', '#..#', '#..#', '###.'],
  E: ['####', '#...', '###.', '#...', '####'],
  F: ['####', '#...', '###.', '#...', '#...'],
  G: ['.###', '#...', '#.##', '#..#', '.###'],
  H: ['#..#', '#..#', '####', '#..#', '#..#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..##', '...#', '...#', '#..#', '.##.'],
  K: ['#..#', '#.#.', '##..', '#.#.', '#..#'],
  L: ['#...', '#...', '#...', '#...', '####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.##.', '#..#', '#..#', '#..#', '.##.'],
  P: ['###.', '#..#', '###.', '#...', '#...'],
  Q: ['.##.', '#..#', '#..#', '#.##', '.###'],
  R: ['###.', '#..#', '###.', '#.#.', '#..#'],
  S: ['.###', '#...', '.##.', '...#', '###.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..'],
  U: ['#..#', '#..#', '#..#', '#..#', '.##.'],
  V: ['#..#', '#..#', '#..#', '.##.', '.##.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#..#', '#..#', '.##.', '#..#', '#..#'],
  Y: ['#..#', '#..#', '.##.', '.#..', '.#..'],
  Z: ['####', '...#', '.##.', '#...', '####'],
  x: ['....', '#..#', '.##.', '.##.', '#..#'],
  '!': ['#', '#', '#', '.', '#'],
  '-': ['....', '....', '####', '....', '....'],
  ' ': ['..', '..', '..', '..', '..'],
};

export const BANNER_H = 5;
const glyph = (c) => G[c] ?? G[c.toUpperCase()] ?? G[' '];
export const glyphWidth = (c) => glyph(c)[0].length;

/** Width in cells of one line of banner text: every font pixel is `px` cells wide, letters are one font pixel apart. */
export function lineWidth(text, px = 1) {
  let w = 0;
  for (const c of text) w += (glyphWidth(c) + 1) * px;
  return Math.max(0, w - px);
}

/**
 * Lay a banner out: break `text` on spaces (greedy) so each line fits `maxCols`, stack the lines `BANNER_H + 1` rows
 * apart, centre each. Each font pixel is `px` cells wide and one row high (a cell is about twice as tall as it is wide, so
 * px 2 gives square pixels when the width allows). Returns { letters: [{ ch, x, y, rows, line, index }], lines, w, h, px }.
 * x and y are relative to the banner's top-left corner; w is the widest line. A word wider than maxCols is kept whole.
 */
export function layoutBanner(text, maxCols, px = 1) {
  const words = String(text).split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && lineWidth(t, px) > maxCols) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  const w = Math.max(0, ...lines.map((l) => lineWidth(l, px)));
  const letters = [];
  let index = 0;
  lines.forEach((ln, li) => {
    let x = Math.floor((w - lineWidth(ln, px)) / 2);
    for (const c of ln) {
      const rows = glyph(c);
      if (c !== ' ') letters.push({ ch: c, x, y: li * (BANNER_H + 1), rows, line: li, index: index++ });
      x += (rows[0].length + 1) * px;
    }
  });
  return { letters, lines, w, h: lines.length ? lines.length * (BANNER_H + 1) - 1 : 0, px };
}
