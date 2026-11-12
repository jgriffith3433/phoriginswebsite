// Entry point for index.html. Plain ES module: no build step, so GitHub Pages serves it as it is.

import { createTerminal } from './ui.js';

window.__termErrors = [];
window.addEventListener('error', (e) => window.__termErrors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__termErrors.push(String(e.reason)));

const reduced = (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || /[?&]motion=off\b/.test(location.search);
const isLocalHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const isLocalDev = isLocalHost && location.port !== '4173' && location.port !== '';
// The built game is ./play/game.html; Vite dev serves it from source at /game.html (same swap as site/marketing.js).
const gameUrl = (url) => (isLocalDev && url === './play/game.html' ? '/game.html' : url);

let store;
try { store = window.localStorage; store.getItem('x'); } catch { store = { getItem: () => null, setItem: () => {}, removeItem: () => {} }; }

if (isLocalDev) document.querySelectorAll('[data-play]').forEach((a) => a.setAttribute('href', '/game.html'));
if (reduced) document.documentElement.classList.add('reduced-motion');

// The soft keyboard: size the app to the visible viewport so the prompt stays above it (event driven).
const app = document.getElementById('app');
const fit = () => {
  const vv = window.visualViewport;
  app.style.height = vv && vv.height < window.innerHeight - 40 ? `${Math.round(vv.height)}px` : '';
};
if (window.visualViewport) { window.visualViewport.addEventListener('resize', fit); window.visualViewport.addEventListener('scroll', () => window.scrollTo(0, 0)); }
window.addEventListener('resize', fit);
fit();

createTerminal(document.getElementById('app'), { storage: store, reduced, gameUrl });
