// The DOM side: output log, streaming player, input mirror, history, tap buttons. No network, no eval, no polling:
// timers only chain the lines of one command's output, and any key flushes them.

import { Shell } from './shell.js';
import { complete } from './complete.js';

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
const STORE_KEY = 'ph-origins-terminal';

const BOOT = [
  [0, 'PH-BIOS v5.8  (c) Hawkes Biomedical  58th floor edition', 'dim'],
  [80, 'CPU: HAWKES-58 @ 3.20 GHz .................. ok', ''],
  [160, 'Memory test: 5808 MB ....................... ok', ''],
  [260, 'Detecting drives: /dev/sda (58 GB) .......... ok', ''],
  [360, 'Hat sensor: orientation ..................... BACKWARDS (as expected)', 'warn'],
  [480, 'Loading PH-OS 58 Apex ...', ''],
  [620, '[  ok  ] Mounting / (read-only for guests)', 'ok'],
  [700, '[  ok  ] Started gw-watcher', 'ok'],
  [780, '[  ok  ] Started the simulated network (nothing leaves this page)', 'ok'],
  [860, '[ skip ] intern-wiki: nobody reads it', 'warn'],
  [960, '[  ok  ] Reached target: Login Prompt', 'ok'],
];

export function createTerminal(root, { storage, reduced, gameUrl }) {
  const $ = (id) => root.querySelector(id);
  const logEl = $('#termLog');
  const input = $('#termInput');
  const mirror = $('#termMirror');
  const promptEl = $('#termPrompt');
  const screen = $('#screen');
  const doc = root.ownerDocument;

  const shell = new Shell({
    load: () => { try { return JSON.parse(storage.getItem(STORE_KEY)); } catch { return null; } },
    save: (v) => { try { if (v) storage.setItem(STORE_KEY, JSON.stringify(v)); else storage.removeItem(STORE_KEY); } catch { /* private mode */ } },
  });

  let busy = false;
  let flush = null; // call to finish the running output at once
  let histPos = -1;
  let draft = '';
  let konamiAt = 0;
  let pending = [];
  let audio = null;

  // ---- drawing
  const scroll = () => { screen.scrollTop = screen.scrollHeight; };
  const addLine = (text, cls = '') => {
    const el = doc.createElement('div');
    el.className = `line ${cls}`.trim();
    el.textContent = text === '' ? ' ' : text;
    logEl.appendChild(el);
    return el;
  };

  const setTheme = (name) => { root.ownerDocument.documentElement.dataset.theme = name; };
  const syncPrompt = () => {
    promptEl.textContent = shell.prompt();
    root.classList.toggle('is-root', shell.isRoot);
    root.classList.toggle('is-secret', !!shell.mode?.mask);
    input.type = shell.mode?.mask ? 'password' : 'text';
    renderMirror();
  };

  function renderMirror() {
    const masked = !!shell.mode?.mask;
    const v = masked ? '' : input.value;
    const pos = masked ? 0 : Math.min(input.selectionStart ?? v.length, v.length);
    mirror.replaceChildren();
    mirror.append(doc.createTextNode(v.slice(0, pos)));
    const cur = doc.createElement('span');
    cur.className = 'cursor';
    cur.textContent = v[pos] ?? ' ';
    mirror.append(cur, doc.createTextNode(v.slice(pos + 1)));
  }

  // ---- effects
  function apply(effects, done) {
    let i = 0;
    const step = () => {
      while (i < effects.length) {
        const e = effects[i++];
        if (e.k === 'print') { if (e.text !== '') for (const l of e.text.split('\n')) addLine(l, e.cls); else addLine(''); } else if (e.k === 'clear') logEl.replaceChildren();
        else if (e.k === 'theme') setTheme(e.name);
        else if (e.k === 'sound') { if (e.on) ensureAudio(); } else if (e.k === 'granted') root.classList.add('is-root');
        else if (e.k === 'reset') { setTheme('green'); root.classList.remove('is-root'); } else if (e.k === 'go') { navigate(e.url); } else if (e.k === 'seq') {
          play(e.steps, step);
          return;
        }
      }
      scroll();
      done?.();
    };
    step();
  }

  function navigate(url) {
    const target = gameUrl(url);
    const go = () => { root.ownerDocument.defaultView.location.assign(target); };
    if (reduced) go(); else setTimeout(go, 450); // a beat to read "launching..."
  }

  /** Stream a command's output. Steps carry `at` ms from the start; a step with a `key` replaces the last line with that key. */
  function play(steps, then) {
    busy = true;
    input.setAttribute('aria-busy', 'true');
    const keyed = new Map();
    let i = 0;
    let timer = null;
    const show = (s) => {
      const lines = s.text.split('\n');
      if (s.key && keyed.has(s.key)) {
        const els = keyed.get(s.key);
        els.forEach((el, n) => { el.textContent = lines[n] ?? ''; });
      } else {
        const els = lines.map((l) => addLine(l, s.cls));
        if (s.key) keyed.set(s.key, els);
      }
    };
    const end = () => {
      clearTimeout(timer);
      flush = null;
      busy = false;
      input.removeAttribute('aria-busy');
      scroll();
      then?.();
    };
    const finish = () => { while (i < steps.length) show(steps[i++]); end(); };
    const next = () => {
      if (i >= steps.length) { end(); return; }
      show(steps[i++]);
      scroll();
      if (i >= steps.length) { end(); return; }
      timer = setTimeout(next, Math.max(0, steps[i].at - steps[i - 1].at));
    };
    flush = finish;
    if (reduced || !steps.length) { finish(); return; }
    timer = setTimeout(next, Math.max(0, steps[0].at));
  }

  // ---- commands
  function submit(line) {
    if (busy) { flush?.(); return; }
    const masked = !!shell.mode?.mask;
    const promptText = shell.prompt();
    addLine(masked ? promptText : `${promptText} ${line}`, 'echo');
    histPos = -1;
    input.value = '';
    const effects = shell.run(line);
    syncPrompt();
    apply(effects, () => { syncPrompt(); runPending(); });
  }

  function runPending() {
    if (busy || !pending.length) return;
    const p = pending.splice(0);
    apply(p.flat());
  }

  function startBoot() {
    const steps = BOOT.map(([at, text, cls]) => ({ at, text, cls }));
    steps.push({ at: 1100, text: '' });
    apply([{ k: 'seq', steps }, ...shell.boot()], () => { syncPrompt(); runPending(); });
    setTheme(shell.theme);
    syncPrompt();
  }

  // ---- keyboard
  function histStep(dir) {
    const h = shell.history;
    if (!h.length || shell.mode) return;
    if (histPos === -1) { if (dir > 0) return; draft = input.value; histPos = h.length; }
    histPos = Math.max(0, Math.min(h.length, histPos + dir));
    input.value = histPos === h.length ? draft : h[histPos];
    if (histPos === h.length) histPos = -1;
    input.setSelectionRange(input.value.length, input.value.length);
    renderMirror();
  }

  function tab() {
    if (busy) { flush?.(); return; }
    const before = input.value;
    const r = complete(shell, before);
    if (r.line !== before) { input.value = r.line; input.setSelectionRange(r.line.length, r.line.length); } else if (r.options.length) {
      addLine(`${shell.prompt()} ${before}`, 'echo');
      addLine(r.options.join('  '));
      scroll();
    }
    renderMirror();
  }

  function ctrlC() {
    if (busy) { flush?.(); addLine('^C', 'dim'); scroll(); return; }
    addLine(`${shell.prompt()} ${shell.mode?.mask ? '' : input.value}^C`, 'echo');
    shell.mode = null;
    input.value = '';
    histPos = -1;
    syncPrompt();
    scroll();
  }

  function clearScreen() { logEl.replaceChildren(); scroll(); }

  function onKey(e) {
    // Konami works anywhere, including during boot. It only ever prints a joke.
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === KONAMI[konamiAt]) {
      konamiAt += 1;
      if (konamiAt === KONAMI.length) { konamiAt = 0; const fx = shell.konami(); if (busy) pending.push(fx); else apply(fx); }
    } else konamiAt = k === KONAMI[0] ? 1 : 0;

    if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); clearScreen(); return; }
    if (e.ctrlKey && e.key.toLowerCase() === 'c' && !(doc.getSelection()?.toString())) { e.preventDefault(); ctrlC(); return; }
    if (busy && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) { e.preventDefault(); flush?.(); return; } // any key skips
    if (e.key === 'ArrowUp') { e.preventDefault(); histStep(-1); } else if (e.key === 'ArrowDown') { e.preventDefault(); histStep(1); } else if (e.key === 'Tab') { e.preventDefault(); tab(); } else if (shell.sound && e.key.length === 1) click();
  }

  // ---- sound: a tiny keyclick, off by default, created only after a user gesture
  function ensureAudio() {
    if (audio || !('AudioContext' in root.ownerDocument.defaultView)) return;
    try { audio = new root.ownerDocument.defaultView.AudioContext(); } catch { audio = null; }
  }
  function click() {
    ensureAudio();
    if (!audio) return;
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    const len = Math.floor(audio.sampleRate * 0.012);
    const buf = audio.createBuffer(1, len, audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let n = 0; n < len; n += 1) d[n] = (Math.random() * 2 - 1) * (1 - n / len) ** 2;
    const src = audio.createBufferSource();
    const g = audio.createGain();
    g.gain.value = 0.05;
    src.buffer = buf;
    src.connect(g).connect(audio.destination);
    src.start();
  }

  // ---- wiring
  input.addEventListener('keydown', onKey);
  doc.addEventListener('keydown', (e) => {
    if (e.target === input) return;
    // Typing anywhere goes to the prompt.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && !e.target.closest?.('a, button')) input.focus({ preventScroll: true });
    onKey(e);
  });
  for (const ev of ['input', 'keyup', 'click', 'select', 'focus']) input.addEventListener(ev, renderMirror);
  doc.addEventListener('selectionchange', () => { if (doc.activeElement === input) renderMirror(); });
  input.addEventListener('blur', () => root.classList.add('is-blurred'));
  input.addEventListener('focus', () => root.classList.remove('is-blurred'));
  $('#termForm').addEventListener('submit', (e) => { e.preventDefault(); submit(input.value); });

  // Tapping anywhere puts focus back in the input (unless the visitor is selecting text to copy).
  root.addEventListener('pointerup', (e) => {
    if (e.target.closest('a, button')) return;
    if (doc.getSelection()?.toString()) return;
    input.focus({ preventScroll: true });
  });
  // A skip tap during streaming.
  root.addEventListener('pointerdown', () => { if (busy) flush?.(); });

  for (const b of root.querySelectorAll('[data-act]')) {
    b.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the keyboard up
    b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (shell.sound) click();
      if (act === 'tab') tab();
      else if (act === 'up') histStep(-1);
      else if (act === 'down') histStep(1);
      else if (act === 'ctrlc') ctrlC();
      else if (busy) flush?.();
      else { input.value = act; submit(act); }
      input.focus({ preventScroll: true });
    });
  }

  startBoot();
  input.focus({ preventScroll: true });
  return { shell, submit, input };
}
