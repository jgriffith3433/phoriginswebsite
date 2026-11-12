// A big block-letter font for the show's equation and title banners: 5 rows high, 3-5 columns wide, drawn from `#`.
// Pure functions: a banner is laid out as a list of letters with their own position and token index, so the stage can
// colour each term of an equation, slide a term across `=`, and wave letters on the beat. ASCII only.

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
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#..#', '#..#', '#..#', '#..#', '.##.'],
  V: ['#..#', '#..#', '#..#', '.##.', '.##.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#..#', '#..#', '.##.', '#..#', '#..#'],
  Y: ['#..#', '#..#', '.##.', '.#..', '.#..'],
  Z: ['####', '...#', '.##.', '#...', '####'],
  0: ['.##.', '#..#', '#..#', '#..#', '.##.'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['###.', '...#', '.##.', '#...', '####'],
  3: ['###.', '...#', '.##.', '...#', '###.'],
  4: ['#..#', '#..#', '####', '...#', '...#'],
  5: ['####', '#...', '###.', '...#', '###.'],
  6: ['.##.', '#...', '###.', '#..#', '.##.'],
  7: ['####', '...#', '..#.', '.#..', '.#..'],
  8: ['.##.', '#..#', '.##.', '#..#', '.##.'],
  9: ['.##.', '#..#', '.###', '...#', '.##.'],
  x: ['...', '#.#', '.#.', '#.#', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '-': ['...', '...', '###', '...', '...'],
  '=': ['...', '###', '...', '###', '...'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '(': ['.#', '#.', '#.', '#.', '.#'],
  ')': ['#.', '.#', '.#', '.#', '#.'],
  '!': ['#', '#', '#', '.', '#'],
  '.': ['.', '.', '.', '.', '#'],
  ':': ['.', '#', '.', '#', '.'],
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
 * px 2 gives square pixels when the width allows). Returns { letters: [{ ch, x, y, rows, line, index, word, wordIndex }], lines, w, h, px }.
 * x and y are relative to the banner's top-left corner; w is the widest line. A word wider than maxCols is kept whole.
 */
export function layoutBanner(text, maxCols, px = 1) {
  const words = String(text).split(' ').filter(Boolean);
  const lines = [];
  const lineWords = [];
  let cur = '';
  let curW = [];
  words.forEach((w, wi) => {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && lineWidth(t, px) > maxCols) {
      lines.push(cur);
      lineWords.push(curW);
      cur = w;
      curW = [{ word: w, wordIndex: wi }];
    } else {
      cur = t;
      curW.push({ word: w, wordIndex: wi });
    }
  });
  if (cur) {
    lines.push(cur);
    lineWords.push(curW);
  }
  const w = Math.max(0, ...lines.map((l) => lineWidth(l, px)));
  const letters = [];
  let index = 0;
  lines.forEach((ln, li) => {
    let x = Math.floor((w - lineWidth(ln, px)) / 2);
    const ws = lineWords[li] || [];
    ws.forEach((tok, ti) => {
      for (const c of tok.word) {
        const rows = glyph(c);
        if (c !== ' ') letters.push({ ch: c, x, y: li * (BANNER_H + 1), rows, line: li, index: index++, word: tok.word, wordIndex: tok.wordIndex });
        x += (rows[0].length + 1) * px;
      }
      if (ti < ws.length - 1) {
        const sp = glyph(' ');
        x += (sp[0].length + 1) * px;
      }
    });
  });
  return { letters, lines, w, h: lines.length ? lines.length * (BANNER_H + 1) - 1 : 0, px };
}
