// The data and ASCII/block geometry for the /build show: the equations that run the internet, the GPU server farm racks,
// the network nodes and packet links, the token stream, and the rising hearts. Pure data and pure functions: no DOM, no
// timers, no network.

export const BPM_DEFAULT = 118;
export const BEAT_OFFSET_DEFAULT = 0.31;
export const BEAT_SEC_DEFAULT = 60 / BPM_DEFAULT;

export const CORE_EQUATIONS = [
  'GPU + Text = Hearts - Credits',
  'Hearts = GPU + Text + Credits',
  'Credits = Hearts - GPU - Text',
  'Hearts + Credits = GPU + Text + 2(Credits)',
];

// Canonical base values satisfying the internet identity `Hearts = GPU + Text + Credits` and every network equation.
export const DEFAULT_VARS = {
  GPU: 4,
  Text: 24,
  Credits: 12,
  Hearts: 40,
  Tokens: 3,
  Latency: 2,
  Bandwidth: 20,
  Packets: 62,
  Downtime: 2,
  Uptime: 4,
  Cache: 18,
  DNS: 10,
  Gateway: 58,
  Nodes: 16,
  Streams: 8,
};

const T = (term, v, sign = '+', coeff = 1, extra = {}) => ({ term, var: v, sign, coeff, ...extra });

const RAW_EQUATIONS = [
  // ---- J's four core equations, first and each on its own beat
  {
    id: 'core-1',
    core: true,
    beat: 2,
    op: 'add',
    text: 'GPU + Text = Hearts - Credits',
    left: [T('GPU', 'GPU', '+', 1), T('Text', 'Text', '+', 1)],
    right: [T('Hearts', 'Hearts', '+', 1), T('Credits', 'Credits', '-', -1)],
    moved: { term: 'Credits', fromSide: 'left', toSide: 'right', fromSign: '+', toSign: '-' },
    caption: 'LAW I: THE CORE LEDGER',
  },
  {
    id: 'core-2',
    core: true,
    beat: 6,
    op: 'add',
    text: 'Hearts = GPU + Text + Credits',
    left: [T('Hearts', 'Hearts', '+', 1)],
    right: [T('GPU', 'GPU', '+', 1), T('Text', 'Text', '+', 1), T('Credits', 'Credits', '+', 1)],
    moved: { term: 'Credits', fromSide: 'left', toSide: 'right', fromSign: '-', toSign: '+' },
    caption: 'LAW II: HEARTS SYNTHESIS',
  },
  {
    id: 'core-3',
    core: true,
    beat: 10,
    op: 'add',
    text: 'Credits = Hearts - GPU - Text',
    left: [T('Credits', 'Credits', '+', 1)],
    right: [T('Hearts', 'Hearts', '+', 1), T('GPU', 'GPU', '-', -1), T('Text', 'Text', '-', -1)],
    moved: { term: 'GPU + Text', fromSide: 'left', toSide: 'right', fromSign: '+', toSign: '-' },
    caption: 'LAW III: CREDIT EXTRACTION',
  },
  {
    id: 'core-4',
    core: true,
    beat: 14,
    op: 'add',
    text: 'Hearts + Credits = GPU + Text + 2(Credits)',
    left: [T('Hearts', 'Hearts', '+', 1), T('Credits', 'Credits', '+', 1)],
    right: [T('GPU', 'GPU', '+', 1), T('Text', 'Text', '+', 1), T('2(Credits)', 'Credits', '+', 2)],
    moved: { term: 'Credits', fromSide: 'left', toSide: 'right', fromSign: '+', toSign: '+2x' },
    caption: 'LAW IV: DOUBLE CREDIT COMPOUND',
  },

  // ---- 20 more equations that control the entire internet (24 total)
  {
    id: 'eq-tokens-gpu',
    core: false,
    beat: 18,
    op: 'mul-div',
    text: 'Tokens x GPU = Text / Latency',
    left: [T('Tokens', 'Tokens', '+', 1), T('GPU', 'GPU', 'x', 1)],
    right: [T('Text', 'Text', '+', 1), T('Latency', 'Latency', '/', 1)],
    moved: { term: 'Latency', fromSide: 'left', toSide: 'right', fromSign: 'x', toSign: '/' },
    caption: 'TOKEN THROUGHPUT LAW',
  },
  {
    id: 'eq-packets-lat',
    core: false,
    beat: 22,
    op: 'add',
    text: 'Packets - Latency = Bandwidth + Hearts',
    left: [T('Packets', 'Packets', '+', 1), T('Latency', 'Latency', '-', -1)],
    right: [T('Bandwidth', 'Bandwidth', '+', 1), T('Hearts', 'Hearts', '+', 1)],
    moved: { term: 'Latency', fromSide: 'right', toSide: 'left', fromSign: '+', toSign: '-' },
    caption: 'BACKBONE PACKETconservation',
  },
  {
    id: 'eq-uptime-cred',
    core: false,
    beat: 26,
    op: 'mul-div',
    text: 'Uptime = Credits / (Downtime + 1)',
    left: [T('Uptime', 'Uptime', '+', 1)],
    right: [T('Credits', 'Credits', '+', 1), T('(Downtime + 1)', 'Downtime', '/', 1, { add: 1 })],
    moved: { term: '(Downtime + 1)', fromSide: 'left', toSide: 'right', fromSign: 'x', toSign: '/' },
    caption: 'SLA FIVE-NINES INVARIANT',
  },
  {
    id: 'eq-gpu-solve',
    core: false,
    beat: 30,
    op: 'add',
    text: 'GPU = Hearts - Text - Credits',
    left: [T('GPU', 'GPU', '+', 1)],
    right: [T('Hearts', 'Hearts', '+', 1), T('Text', 'Text', '-', -1), T('Credits', 'Credits', '-', -1)],
    moved: { term: 'Text', fromSide: 'left', toSide: 'right', fromSign: '+', toSign: '-' },
    caption: 'SOLVING FOR SILICON',
  },
  {
    id: 'eq-text-solve',
    core: false,
    beat: 34,
    op: 'add',
    text: 'Text = Hearts - GPU - Credits',
    left: [T('Text', 'Text', '+', 1)],
    right: [T('Hearts', 'Hearts', '+', 1), T('GPU', 'GPU', '-', -1), T('Credits', 'Credits', '-', -1)],
    moved: { term: 'GPU', fromSide: 'left', toSide: 'right', fromSign: '+', toSign: '-' },
    caption: 'CORPUS CONSERVATION',
  },
  {
    id: 'eq-hearts-minus-text',
    core: false,
    beat: 38,
    op: 'add',
    text: 'Hearts - Text = GPU + Credits',
    left: [T('Hearts', 'Hearts', '+', 1), T('Text', 'Text', '-', -1)],
    right: [T('GPU', 'GPU', '+', 1), T('Credits', 'Credits', '+', 1)],
    moved: { term: 'Text', fromSide: 'right', toSide: 'left', fromSign: '+', toSign: '-' },
    caption: 'NET ENGAGEMENT DELTA',
  },
  {
    id: 'eq-hearts-minus-gpu',
    core: false,
    beat: 42,
    op: 'add',
    text: 'Hearts - GPU = Text + Credits',
    left: [T('Hearts', 'Hearts', '+', 1), T('GPU', 'GPU', '-', -1)],
    right: [T('Text', 'Text', '+', 1), T('Credits', 'Credits', '+', 1)],
    moved: { term: 'GPU', fromSide: 'right', toSide: 'left', fromSign: '+', toSign: '-' },
    caption: 'POST-COMPUTE SURPLUS',
  },
  {
    id: 'eq-double-all',
    core: false,
    beat: 46,
    op: 'add',
    text: '2(Hearts) = 2(GPU) + 2(Text) + 2(Credits)',
    left: [T('2(Hearts)', 'Hearts', '+', 2)],
    right: [T('2(GPU)', 'GPU', '+', 2), T('2(Text)', 'Text', '+', 2), T('2(Credits)', 'Credits', '+', 2)],
    moved: { term: '2(Credits)', fromSide: 'left', toSide: 'right', fromSign: '-', toSign: '+' },
    caption: 'CLUSTER SCALING FACTOR x2',
  },
  {
    id: 'eq-packets-full',
    core: false,
    beat: 50,
    op: 'add',
    text: 'Packets = Bandwidth + Hearts + Latency',
    left: [T('Packets', 'Packets', '+', 1)],
    right: [T('Bandwidth', 'Bandwidth', '+', 1), T('Hearts', 'Hearts', '+', 1), T('Latency', 'Latency', '+', 1)],
    moved: { term: 'Latency', fromSide: 'left', toSide: 'right', fromSign: '-', toSign: '+' },
    caption: 'FULL DUPLEX PACKET SUM',
  },
  {
    id: 'eq-bandwidth-solve',
    core: false,
    beat: 54,
    op: 'add',
    text: 'Bandwidth = Packets - Hearts - Latency',
    left: [T('Bandwidth', 'Bandwidth', '+', 1)],
    right: [T('Packets', 'Packets', '+', 1), T('Hearts', 'Hearts', '-', -1), T('Latency', 'Latency', '-', -1)],
    moved: { term: 'Hearts', fromSide: 'left', toSide: 'right', fromSign: '+', toSign: '-' },
    caption: 'FIBER PIPE CAPACITY',
  },
  {
    id: 'eq-gateway-58',
    core: false,
    beat: 58,
    op: 'add',
    text: 'Gateway + Latency = Bandwidth + Hearts',
    left: [T('Gateway', 'Gateway', '+', 1), T('Latency', 'Latency', '+', 1)],
    right: [T('Bandwidth', 'Bandwidth', '+', 1), T('Hearts', 'Hearts', '+', 1)],
    moved: { term: 'Latency', fromSide: 'right', toSide: 'left', fromSign: '-', toSign: '+' },
    caption: '58TH FLOOR GATEWAY ROUTING',
  },
  {
    id: 'eq-gateway-uptime',
    core: false,
    beat: 61,
    op: 'add',
    text: 'Gateway = Packets - Uptime',
    left: [T('Gateway', 'Gateway', '+', 1)],
    right: [T('Packets', 'Packets', '+', 1), T('Uptime', 'Uptime', '-', -1)],
    moved: { term: 'Uptime', fromSide: 'left', toSide: 'right', fromSign: '+', toSign: '-' },
    caption: 'GATEWAY 58 DISPATCH',
  },
  {
    id: 'eq-cache-lat',
    core: false,
    beat: 65,
    op: 'add',
    text: 'Cache + Latency = Bandwidth',
    left: [T('Cache', 'Cache', '+', 1), T('Latency', 'Latency', '+', 1)],
    right: [T('Bandwidth', 'Bandwidth', '+', 1)],
    moved: { term: 'Latency', fromSide: 'right', toSide: 'left', fromSign: '-', toSign: '+' },
    caption: 'L3 EDGE CACHE HIT',
  },
  {
    id: 'eq-cache-dns',
    core: false,
    beat: 69,
    op: 'add',
    text: 'Cache + DNS = GPU + Text',
    left: [T('Cache', 'Cache', '+', 1), T('DNS', 'DNS', '+', 1)],
    right: [T('GPU', 'GPU', '+', 1), T('Text', 'Text', '+', 1)],
    moved: { term: 'DNS', fromSide: 'right', toSide: 'left', fromSign: '-', toSign: '+' },
    caption: 'DNS RESOLUTION EQUIVALENCE',
  },
  {
    id: 'eq-dns-credits',
    core: false,
    beat: 73,
    op: 'add',
    text: 'DNS + Latency = Credits',
    left: [T('DNS', 'DNS', '+', 1), T('Latency', 'Latency', '+', 1)],
    right: [T('Credits', 'Credits', '+', 1)],
    moved: { term: 'Latency', fromSide: 'right', toSide: 'left', fromSign: '-', toSign: '+' },
    caption: 'ROOT ZONE TOLL',
  },
  {
    id: 'eq-nodes-streams',
    core: false,
    beat: 77,
    op: 'add',
    text: 'Nodes + Streams = Text',
    left: [T('Nodes', 'Nodes', '+', 1), T('Streams', 'Streams', '+', 1)],
    right: [T('Text', 'Text', '+', 1)],
    moved: { term: 'Streams', fromSide: 'right', toSide: 'left', fromSign: '-', toSign: '+' },
    caption: 'TOKEN STREAM TOPOLOGY',
  },
  {
    id: 'eq-nodes-credits',
    core: false,
    beat: 81,
    op: 'add',
    text: 'Nodes = Credits + Uptime',
    left: [T('Nodes', 'Nodes', '+', 1)],
    right: [T('Credits', 'Credits', '+', 1), T('Uptime', 'Uptime', '+', 1)],
    moved: { term: 'Uptime', fromSide: 'left', toSide: 'right', fromSign: '-', toSign: '+' },
    caption: 'ACTIVE MESH QUORUM',
  },
  {
    id: 'eq-gateway-cache',
    core: false,
    beat: 85,
    op: 'add',
    text: 'Gateway - Cache = Hearts',
    left: [T('Gateway', 'Gateway', '+', 1), T('Cache', 'Cache', '-', -1)],
    right: [T('Hearts', 'Hearts', '+', 1)],
    moved: { term: 'Cache', fromSide: 'right', toSide: 'left', fromSign: '+', toSign: '-' },
    caption: 'UNFILTERED HEART OUTPUT',
  },
  {
    id: 'eq-packets-dns',
    core: false,
    beat: 88,
    op: 'add',
    text: 'Packets + DNS = Hearts + Bandwidth + Credits',
    left: [T('Packets', 'Packets', '+', 1), T('DNS', 'DNS', '+', 1)],
    right: [T('Hearts', 'Hearts', '+', 1), T('Bandwidth', 'Bandwidth', '+', 1), T('Credits', 'Credits', '+', 1)],
    moved: { term: 'DNS', fromSide: 'right', toSide: 'left', fromSign: '-', toSign: '+' },
    caption: 'GLOBAL ROUTING TABLE',
  },
  {
    id: 'eq-gateway-credits',
    core: false,
    beat: 91,
    op: 'add',
    text: 'Gateway + Credits = Hearts + Bandwidth + DNS',
    left: [T('Gateway', 'Gateway', '+', 1), T('Credits', 'Credits', '+', 1)],
    right: [T('Hearts', 'Hearts', '+', 1), T('Bandwidth', 'Bandwidth', '+', 1), T('DNS', 'DNS', '+', 1)],
    moved: { term: 'Credits', fromSide: 'right', toSide: 'left', fromSign: '-', toSign: '+' },
    caption: '58TH FLOOR SETTLEMENT',
  },
];

export const EQUATIONS = RAW_EQUATIONS.map((eq, index) => ({
  ...eq,
  index,
  time: +(BEAT_OFFSET_DEFAULT + eq.beat * BEAT_SEC_DEFAULT).toFixed(3),
}));

/** Format one side of an equation (`left` or `right`) from its structured terms and signs. */
export function formatSide(terms) {
  return terms
    .map((t, i) => {
      if (i === 0) return t.sign === '-' ? `- ${t.term}` : t.term;
      return `${t.sign} ${t.term}`;
    })
    .join(' ');
}

/** Reconstruct the full equation text from its structured left and right sides. */
export function formatEquation(eq) {
  return `${formatSide(eq.left)} = ${formatSide(eq.right)}`;
}

/** Evaluate one side of an equation for a given variable map. */
export function evalSide(terms, vars = DEFAULT_VARS) {
  if (!terms.length) return 0;
  let acc = 0;
  for (let i = 0; i < terms.length; i += 1) {
    const t = terms[i];
    const base = (vars[t.var] ?? 0) + (t.add ?? 0);
    if (i === 0) {
      acc = t.coeff * base;
    } else if (t.sign === 'x') {
      acc *= t.coeff * base;
    } else if (t.sign === '/') {
      acc /= t.coeff * base;
    } else {
      acc += t.coeff * base;
    }
  }
  return acc;
}

/**
 * Verify that an equation's structured left and right sides match its text and balance numerically (and symbolically
 * under `Hearts = GPU + Text + Credits` for the core equations).
 */
export function balanceEquation(eq, vars = DEFAULT_VARS) {
  const leftText = formatSide(eq.left);
  const rightText = formatSide(eq.right);
  const fullText = `${leftText} = ${rightText}`;
  const leftValue = evalSide(eq.left, vars);
  const rightValue = evalSide(eq.right, vars);
  // For additive equations over {GPU, Text, Credits, Hearts}, also verify symbolic balance under Hearts = GPU + Text + Credits
  let symbolicOk = true;
  if (eq.core) {
    const net = { GPU: 0, Text: 0, Credits: 0 };
    const addSide = (side, dir) => {
      for (const t of side) {
        if (t.var === 'Hearts') {
          net.GPU += dir * t.coeff;
          net.Text += dir * t.coeff;
          net.Credits += dir * t.coeff;
        } else {
          net[t.var] = (net[t.var] ?? 0) + dir * t.coeff;
        }
      }
    };
    addSide(eq.left, 1);
    addSide(eq.right, -1);
    symbolicOk = net.GPU === 0 && net.Text === 0 && net.Credits === 0;
  }
  const balanced = Math.abs(leftValue - rightValue) < 1e-9 && fullText === eq.text && symbolicOk;
  return { balanced, leftValue, rightValue, leftText, rightText, fullText, symbolicOk };
}

/**
 * Map all equations into a song of `duration` seconds so every equation has a distinct beat time strictly inside `(0, duration)`.
 */
export function equationsForDuration(duration, { offset = BEAT_OFFSET_DEFAULT, beatSec = BEAT_SEC_DEFAULT } = {}) {
  const d = Math.max(1, duration);
  const maxRawTime = EQUATIONS[EQUATIONS.length - 1].time;
  if (d > maxRawTime + 1) {
    return EQUATIONS.map((eq) => ({ ...eq }));
  }
  const span = Math.max(0.5, d - Math.min(offset, d * 0.1) - 0.2);
  const t0 = Math.min(offset, d * 0.05);
  return EQUATIONS.map((eq, i) => {
    const time = +(t0 + ((i + 0.5) / EQUATIONS.length) * span).toFixed(3);
    const beat = +((time - t0) / beatSec).toFixed(2);
    return { ...eq, beat, time };
  });
}

// =====================================================================================================================
// ASCII / block server rack and network node sprites (kept deterministic and ASCII-clean).
// =====================================================================================================================
export const FRAME_W = 14;
export const FRAME_H = 12;
export const CENTER = 7;

export const FAN_GLYPHS = ['|', '/', '-', '\\'];

const MIRROR = { '/': '\\', '\\': '/', '(': ')', ')': '(', '<': '>', '>': '<', '[': ']', ']': '[', '{': '}', '}': '{', '`': '\'', '\'': '`' };
export function flip(frame) {
  return frame.map((r) => {
    const s = [...r].reverse().map((c) => MIRROR[c] ?? c).join('');
    return s.replace(/[0-9A-Z]{2,}/g, (m) => [...m].reverse().join(''));
  });
}

/** Build the GPU farm state for a grid of `cols` x `rows` at beat `beat` and zoom `zoom` (0..1). */
export function buildFarmState(cols, rows, beat, { zoom = 1, calm = false } = {}) {
  const phone = cols < 64;
  const rackCount = phone ? 3 : cols < 96 ? 5 : 6;
  const rackW = phone ? 12 : 14;
  const gap = phone ? 2 : Math.max(2, Math.floor((cols - rackCount * rackW) / (rackCount + 1)));
  const totalW = rackCount * rackW + (rackCount - 1) * gap;
  const startX = Math.max(1, Math.floor((cols - totalW) / 2));
  const bi = Math.floor(Math.max(0, beat));
  const fanStep = calm ? 0 : Math.floor(Math.max(0, beat) * 4);
  const racks = [];
  for (let i = 0; i < rackCount; i += 1) {
    const phase = i * 1.3 + Math.max(0, beat) * 0.7;
    const util = Math.min(99, Math.max(42, Math.round(74 + 22 * Math.sin(phase) * zoom)));
    const tempC = Math.round(68 + (util - 40) * 0.42 + (i % 2) * 2);
    const fan = FAN_GLYPHS[(fanStep + i) % FAN_GLYPHS.length];
    const ledA = (bi + i) % 2 === 0 ? '*' : 'o';
    const ledB = (bi + i) % 3 === 0 ? '#' : ':';
    racks.push({
      id: `R${i + 1}`,
      index: i,
      x: startX + i * (rackW + gap),
      w: rackW,
      util,
      tempC,
      fan,
      ledA,
      ledB,
      hot: tempC >= 86,
    });
  }
  const step = Math.max(1, Math.floor(Math.max(0, beat) * 3) + 10);
  const gpuCount = DEFAULT_VARS.GPU * step;
  const textCount = DEFAULT_VARS.Text * step;
  const creditsCount = DEFAULT_VARS.Credits * step;
  const heartsCount = gpuCount + textCount + creditsCount;
  return {
    rackCount,
    racks,
    avgUtil: Math.round(racks.reduce((s, r) => s + r.util, 0) / racks.length),
    maxTemp: Math.max(...racks.map((r) => r.tempC)),
    credits: creditsCount,
    gpu: gpuCount,
    text: textCount,
    hearts: heartsCount,
    tokensPerSec: 1200 + step * 48,
  };
}

/** Build the internet network topology and moving packets for a grid of `cols` x `rows` at beat `beat`. */
export function buildNetState(cols, rows, topY, botY, beat, { calm = false } = {}) {
  const cx = Math.floor(cols / 2);
  const cy = Math.floor((topY + botY) / 2);
  const rx = Math.max(14, Math.floor(cols * 0.36));
  const ry = Math.max(5, Math.floor((botY - topY) * 0.38));
  const phone = cols < 64;

  const nodes = phone
    ? [
        { id: 'CORE', label: 'GW-58', x: cx, y: cy, core: true },
        { id: 'GPU', label: 'GPU', x: Math.max(5, cx - rx), y: Math.max(topY + 2, cy - ry + 1) },
        { id: 'TEXT', label: 'TEXT', x: Math.min(cols - 6, cx + rx), y: Math.max(topY + 2, cy - ry + 1) },
        { id: 'DNS', label: 'DNS', x: Math.max(5, cx - rx), y: Math.min(botY - 2, cy + ry - 1) },
        { id: 'HEART', label: 'HEART', x: Math.min(cols - 6, cx + rx), y: Math.min(botY - 2, cy + ry - 1) },
        { id: 'CRED', label: 'CRED', x: cx, y: Math.min(botY - 1, cy + ry) },
      ]
    : [
        { id: 'CORE', label: 'GW-58 CORE', x: cx, y: cy, core: true },
        { id: 'GPU', label: 'GPU-POOL', x: Math.max(7, cx - rx), y: Math.max(topY + 2, cy - ry + 1) },
        { id: 'TEXT', label: 'TEXT-LLM', x: Math.min(cols - 8, cx + rx), y: Math.max(topY + 2, cy - ry + 1) },
        { id: 'DNS', label: 'DNS-ROOT', x: Math.max(7, cx - rx - 2), y: cy },
        { id: 'CACHE', label: 'CACHE-L3', x: Math.min(cols - 8, cx + rx + 2), y: cy },
        { id: 'BAND', label: 'BANDWIDTH', x: Math.max(7, cx - Math.floor(rx * 0.85)), y: Math.min(botY - 2, cy + ry - 1) },
        { id: 'HEART', label: 'HEART-MUX', x: Math.min(cols - 8, cx + Math.floor(rx * 0.85)), y: Math.min(botY - 2, cy + ry - 1) },
        { id: 'CRED', label: 'CRED-LEDGER', x: cx, y: Math.min(botY - 1, cy + ry) },
      ];

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const linkPairs = phone
    ? [
        ['GPU', 'CORE', '*'],
        ['TEXT', 'CORE', '#'],
        ['CORE', 'DNS', '>'],
        ['CORE', 'HEART', '<3'],
        ['CORE', 'CRED', '$'],
        ['GPU', 'DNS', ':'],
        ['TEXT', 'HEART', '+'],
      ]
    : [
        ['GPU', 'CORE', '*'],
        ['TEXT', 'CORE', '#'],
        ['DNS', 'CORE', '>'],
        ['CORE', 'CACHE', '<'],
        ['CORE', 'BAND', '='],
        ['CORE', 'HEART', 'v'],
        ['CORE', 'CRED', '$'],
        ['GPU', 'DNS', '+'],
        ['TEXT', 'CACHE', '~'],
        ['BAND', 'CRED', '$'],
        ['CACHE', 'HEART', '*'],
      ];

  const links = linkPairs.map(([a, b, glyph], idx) => ({
    index: idx,
    from: byId[a],
    to: byId[b],
    glyph: glyph[0],
  }));

  const packets = [];
  const b = Math.max(0, beat);
  const perLink = calm ? 1 : 2;
  links.forEach((lk, li) => {
    for (let k = 0; k < perLink; k += 1) {
      const u = ((b * (0.45 + (li % 3) * 0.12) + k * 0.5 + li * 0.17) % 1 + 1) % 1;
      const x = Math.round(lk.from.x + (lk.to.x - lk.from.x) * u);
      const y = Math.round(lk.from.y + (lk.to.y - lk.from.y) * u);
      packets.push({ linkIndex: li, u, x, y, ch: lk.glyph });
    }
  });

  return { nodes, links, packets, cx, cy };
}
