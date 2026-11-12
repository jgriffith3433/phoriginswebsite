// Command-line parsing: quotes, a leading slash (/help = help), aliases, pipes, and "did you mean".

export const ALIASES = {
  '?': 'help', h: 'help', ll: 'ls -l', la: 'ls -a', l: 'ls', cls: 'clear', dir: 'ls', quit: 'exit', logout: 'exit',
  more: 'less', wget: 'curl', play: 'game', start: 'game', less: 'less', man: 'man', hist: 'history',
  who: 'whoami', ssh2: 'ssh', crack: 'john', hashcrack: 'john', info: 'about',
};

/** Split a line into words. Honours 'single' and "double" quotes and backslash escapes. */
export function tokenize(line) {
  const out = [];
  let cur = '';
  let q = null;
  let has = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"' && i + 1 < line.length) { i += 1; cur += line[i]; } else cur += c;
    } else if (c === '"' || c === "'") { q = c; has = true; } else if (c === '\\' && i + 1 < line.length) { i += 1; cur += line[i]; has = true; } else if (/\s/.test(c)) {
      if (cur || has) { out.push(cur); cur = ''; has = false; }
    } else { cur += c; has = true; }
  }
  if (cur || has) out.push(cur);
  return out;
}

/** Split on unquoted pipes. */
export function splitPipes(line) {
  const parts = [];
  let cur = '';
  let q = null;
  for (const c of line) {
    if (q) { if (c === q) q = null; cur += c; } else if (c === '"' || c === "'") { q = c; cur += c; } else if (c === '|') { parts.push(cur); cur = ''; } else cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim());
}

/**
 * One command: { cmd, args, raw }. `/build` and `build` are the same; `/etc/motd` is a path, not a command.
 * An alias that expands to several words puts the extra words in front of the args.
 */
export function parseCommand(segment) {
  const words = tokenize(segment.trim());
  if (!words.length) return null;
  let first = words[0];
  if (first.length > 1 && first[0] === '/' && !first.slice(1).includes('/')) first = first.slice(1);
  let args = words.slice(1);
  const alias = ALIASES[first];
  if (alias) {
    const [cmd, ...pre] = alias.split(' ');
    first = cmd;
    args = [...pre, ...args];
  }
  return { cmd: first, args, raw: segment.trim() };
}

export function parseLine(line) {
  return splitPipes(line).map(parseCommand).filter(Boolean);
}

/** Levenshtein distance, for "did you mean". */
export function distance(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}

/** Up to `max` command names close to `word`. */
export function suggest(word, names, max = 3) {
  const w = word.toLowerCase();
  return names
    .map((n) => ({ n, d: n.startsWith(w) || w.startsWith(n) ? 1 : distance(w, n) }))
    .filter((x) => x.d <= Math.max(2, Math.floor(w.length / 3)))
    .sort((a, b) => a.d - b.d || a.n.localeCompare(b.n))
    .slice(0, max)
    .map((x) => x.n);
}
