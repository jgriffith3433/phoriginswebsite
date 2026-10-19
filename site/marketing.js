const isLocalHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const isLocalDev = isLocalHost && location.port !== '4173' && location.port !== '';

// The static href is the live build (/play/game.html). Vite dev serves the game from source at /game.html.
if (isLocalDev) {
  document.querySelectorAll('[data-play]').forEach((link) => link.setAttribute('href', '/game.html'));
}

const page = document.body.dataset.page;
document.querySelectorAll('[data-nav]').forEach((link) => {
  if (link.getAttribute('data-nav') === page) {
    link.setAttribute('aria-current', 'page');
  }
});

const nav = document.querySelector('.nav');
const navLinks = document.getElementById('nav-links');
const navToggle = document.getElementById('navToggle');

const setMenu = (open) => {
  if (!navLinks || !navToggle) return;
  navLinks.classList.toggle('is-open', open);
  navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  navToggle.textContent = open ? 'Close' : 'Menu';
};

navToggle?.addEventListener('click', () => {
  setMenu(!navLinks.classList.contains('is-open'));
});

navLinks?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => setMenu(false));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setMenu(false);
});

const onScroll = () => {
  nav?.classList.toggle('is-scrolled', window.scrollY > 8);
};

onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

const MUSIC_KEY = 'ph-origins-landing-music';
const audio = document.getElementById('landingAudio');
const musicBtn = document.getElementById('musicBtn');

if (audio && musicBtn) {
  audio.volume = 0.42;

  const isMobile =
    window.matchMedia('(pointer: coarse)').matches ||
    window.matchMedia('(max-width: 768px)').matches;

  const setMusicUi = (on) => {
    musicBtn.classList.toggle('is-on', on);
    musicBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    musicBtn.setAttribute('aria-label', on ? 'Mute music' : 'Play music');
  };

  const musicIsAudible = () => !audio.paused && !audio.muted;

  const startMusic = async () => {
    audio.muted = false;
    audio.currentTime = 0;
    await audio.play();
    setMusicUi(true);
    try {
      localStorage.setItem(MUSIC_KEY, 'on');
    } catch (_) {}
  };

  const stopMusic = () => {
    audio.pause();
    audio.muted = true;
    setMusicUi(false);
    try {
      localStorage.setItem(MUSIC_KEY, 'off');
    } catch (_) {}
  };

  musicBtn.addEventListener('click', async () => {
    try {
      if (musicIsAudible()) stopMusic();
      else await startMusic();
    } catch (_) {
      setMusicUi(false);
    }
  });

  const wantOn = (() => {
    try {
      return localStorage.getItem(MUSIC_KEY) === 'on';
    } catch (_) {
      return false;
    }
  })();

  if (!isMobile) {
    audio.muted = true;
    audio.play().catch(() => {});
    if (wantOn) startMusic().catch(() => setMusicUi(false));
  }
}

const shotA = document.getElementById('shotA');
const shotB = document.getElementById('shotB');

if (shotA && shotB) {
  const BACKGROUNDS = [
    './assets/landing/bg-1.jpg',
    './assets/landing/bg-2.jpg',
    './assets/landing/bg-3.jpg',
  ];
  const HOLD_MS = 9000;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let index = 0;
  let showingA = true;

  BACKGROUNDS.forEach((src) => {
    const img = new Image();
    img.src = src;
  });

  const setShot = (el, src) => {
    el.style.backgroundImage = `url("${src}")`;
  };

  const show = (el, on) => {
    el.classList.toggle('is-live', on);
    if (on && !reduceMotion) {
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    }
  };

  setShot(shotA, BACKGROUNDS[0]);
  setShot(shotB, BACKGROUNDS[1]);
  show(shotA, true);

  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const cycleOnce = () => {
    index = (index + 1) % BACKGROUNDS.length;
    const incoming = showingA ? shotB : shotA;
    const outgoing = showingA ? shotA : shotB;
    setShot(incoming, BACKGROUNDS[index]);
    show(incoming, true);
    show(outgoing, false);
    showingA = !showingA;
  };

  const runCycle = async () => {
    while (true) {
      await wait(HOLD_MS);
      cycleOnce();
    }
  };

  runCycle();
}

// Hawkes Analytics (loaded in the head of every site page; AGENTS.md "Analytics"). The SDK counts page views,
// outbound links and the device by itself; these say which page sent a player to the game, and who watched the film.
const analytics = () => window.hawkesAnalytics;
document.querySelectorAll('[data-play]').forEach((link) => {
  link.addEventListener('click', () => {
    const where = link.closest('header') ? 'nav' : link.closest('footer') ? 'footer' : 'page';
    analytics()?.track('play_click', { page: page || 'home', where });
    analytics()?.flush();
  });
});
const film = document.querySelector('.frame iframe');
if (film) {
  // A click into the YouTube frame moves focus to it; that is the only signal a page gets from the embed.
  let filmCounted = false;
  window.addEventListener('blur', () => {
    if (filmCounted || document.activeElement !== film) return;
    filmCounted = true;
    analytics()?.video('trailer', 'play', 0);
  });
}
musicBtn?.addEventListener('click', () => {
  // startMusic is async; read the button once it has settled.
  window.setTimeout(() => analytics()?.feature('site.music', { value: musicBtn.getAttribute('aria-pressed') === 'true' ? 'on' : 'off' }), 600);
});
