// Small shared helpers for the terminal. Plain ES modules: the page is served straight from the repo root.

/** mulberry32: a tiny seeded PRNG, so a build with the same seed prints the same log. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.pick = (list) => list[Math.floor(next() * list.length)];
  return next;
}

/** A short stable hex digest of a string (FNV-1a, twice). Not crypto: a build hash for show. */
export function hex(text, len = 12) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + text.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  const out = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + (h1 ^ h2 >>> 0).toString(16).padStart(8, '0'));
  return out.slice(0, len);
}

export const pad = (s, n) => String(s).padEnd(n, ' ');
export const lpad = (s, n) => String(s).padStart(n, ' ');

/** [#####-----] 50% */
export function bar(pct, width = 28) {
  const p = Math.max(0, Math.min(1, pct));
  const n = Math.round(p * width);
  return `[${'#'.repeat(n)}${'-'.repeat(width - n)}] ${lpad(Math.round(p * 100), 3)}%`;
}

export const reverse = (s) => [...s].reverse().join('');
