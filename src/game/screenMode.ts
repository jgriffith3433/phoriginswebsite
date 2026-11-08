// Phone screen mode: the "Turn your phone sideways" prompt and fullscreen + landscape lock.
// Event driven only (matchMedia change, orientationchange, fullscreenchange): no timers, no polling.

type FullscreenDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };

/** How many times fullscreen and the landscape lock were asked for (the playtest reads this; headless browsers may refuse). */
export const screenAttempts = { fullscreen: 0, lock: 0 };

const DISMISS_KEY = 'hawkes.portraitOk';

/** A coarse primary pointer: a phone or tablet, not a desktop with a touch screen bolted on. */
let testTouch = false;
/** Playtest setup: behave as a touch device even though a bot (or a desktop pointer) is driving the page. */
export const setTestTouch = (on: boolean) => { testTouch = on; };
export const isTouchDevice = () => testTouch || matchMedia('(pointer: coarse)').matches;

const quiet = (result: unknown) => {
  if (result && typeof (result as Promise<void>).catch === 'function') void (result as Promise<void>).catch(() => {});
};

/** Real play is being driven by the playtest bot: the prompt must not stand in its way. */
const driven = () => !testTouch && (/[?&]playtest=/.test(location.search) || navigator.webdriver === true);

export type OrientationGuard = {
  /** Re-evaluate now (events call this; the playtest calls it after it lays the page out as a phone). */
  refresh: () => void;
  showing: () => boolean;
  /** Playtest setup: act as a touch device even while a bot drives the page. */
  force: (on: boolean) => void;
};

export const createOrientationGuard = (onShow?: () => void): OrientationGuard | null => {
  const el = document.getElementById('turnPhone');
  const dismissBtn = document.getElementById('turnPhoneAnyway');
  if (!el) return null;
  let forced = false;
  let dismissed = false;
  try { dismissed = sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { /* private mode */ }

  const portrait = () => {
    const body = document.body.dataset;
    // The playtest's phone frame sets these on the body without resizing the window.
    if (forced && body.orientation) return body.orientation === 'portrait';
    return window.innerHeight > window.innerWidth;
  };
  const wanted = () => !dismissed && (forced || (isTouchDevice() && !driven())) && portrait();

  const refresh = () => {
    const show = wanted();
    const was = !el.hidden;
    el.hidden = !show;
    document.body.classList.toggle('turn-phone-on', show);
    if (show && !was) onShow?.();
  };

  dismissBtn?.addEventListener('click', () => {
    dismissed = true;
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    refresh();
  });

  const query = matchMedia('(orientation: portrait)');
  query.addEventListener('change', refresh);
  window.addEventListener('orientationchange', refresh);
  refresh();

  return {
    refresh,
    showing: () => !el.hidden,
    force: (on) => { forced = on; setTestTouch(on); if (on) dismissed = false; refresh(); },
  };
};

export type FullscreenControl = {
  supported: () => boolean;
  active: () => boolean;
  toggle: () => void;
  /** Start on a touch device: fullscreen the game root, then lock landscape. Rejections are ignored. */
  enterForPlay: () => void;
};

export const createFullscreen = (root: HTMLElement, onChange: () => void): FullscreenControl => {
  const doc = document as FullscreenDoc;
  const target = root as FullscreenEl;
  const supported = () => Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
  const active = () => Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
  const lockLandscape = () => {
    const orientation = screen.orientation as LockableOrientation | undefined;
    if (orientation && typeof orientation.lock === 'function') {
      screenAttempts.lock++;
      try { quiet(orientation.lock('landscape')); } catch { /* unsupported */ }
    }
  };
  /** Fullscreen first; the orientation lock is only allowed once it is on. */
  const enter = (lockAfter: boolean) => {
    screenAttempts.fullscreen++;
    try {
      const pending = target.requestFullscreen ? target.requestFullscreen() : target.webkitRequestFullscreen?.();
      if (pending && typeof (pending as Promise<void>).then === 'function') {
        (pending as Promise<void>).then(() => { if (lockAfter) lockLandscape(); }, () => {});
      } else if (lockAfter) lockLandscape();
    } catch { /* iOS Safari on iPhone has no element fullscreen */ }
  };
  const exit = () => {
    try {
      if (doc.exitFullscreen) quiet(doc.exitFullscreen());
      else if (doc.webkitExitFullscreen) quiet(doc.webkitExitFullscreen());
    } catch { /* ignore */ }
  };
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
  return {
    supported,
    active,
    toggle: () => {
      if (active()) { exit(); return; }
      enter(isTouchDevice());
    },
    enterForPlay: () => {
      if (!isTouchDevice() || driven()) return;
      if (!active()) enter(true);
      else lockLandscape();
    },
  };
};
