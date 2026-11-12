import { lineAudio, lineText } from '../game/locale';
import { voiceBusy } from '../game/sfxMix';

/**
 * The end of Level 8 and of Act I. It starts when the front door opens (theMorning.ts hands over):
 *
 *   dawn     the door swings onto blinding white
 *   black    a hard cut to black on a held tone
 *   title    PH ORIGINS drops with the end-suite chord
 *   credits  names only, over slow in-engine camera moves through empty places (SHOTS)
 *   call     a phone buzzes; an unknown caller speaks one line (new canon, see docs/world-bible.md)
 *   card     "Act II is coming" with a link to phorigins.com
 *
 * Time is the render loop's (`step`), so Pause holds it. After a first finish (`hawkes.endSeen`) Skip jumps to the card.
 */

export type EndingHost = {
  /** Load another level's scene behind black and hide Pierce (main.ts `loadMissionScene(path, 'credits')`). */
  loadShot: (path: string) => Promise<void>;
  camera: (position: V3, lookAt: V3) => void;
  playFile: (url: string, volume: number) => void;
  /** The end-suite cue on the music bus; resolves false when the file is missing. */
  playMusic: (url: string) => Promise<boolean>;
  stopMusic: () => void;
  tone: (frequency: number, seconds: number, type: OscillatorType, volume: number) => void;
  showLine: (title: string, text: string) => void;
  /** Called once when the card shows: marks the level complete. */
  complete: () => void;
  exit: () => void;
};

type V3 = { x: number; y: number; z: number };
type Shot = { path: string; from: V3; to: V3; lookFrom: V3; lookTo: V3; credits: { role: string; name: string }[] };

export const END_MUSIC = '/assets/audio/ending-8-suite.mp3';
export const ACT2_CALL = { id: 'dialogue.morning.act2', url: '/assets/audio/cutscenes/morning/act2-call.mp3' };
const SEEN_KEY = 'hawkes.endSeen';
const MORNING = '/levels/the-morning.json';

const v = (x: number, y: number, z: number): V3 => ({ x, y, z });
const cast = (name: string) => ({ role: 'Cast', name });

/** Eight places, empty. Six level files (the apartment is already loaded). */
export const SHOTS: Shot[] = [
  { path: MORNING, from: v(6.6, 1.7, 2.4), to: v(4.6, 1.6, 2.2), lookFrom: v(3.2, 1.3, -2.9), lookTo: v(3.2, 1.3, -2.9), credits: [cast('Pierce Hawkes')] },
  { path: '/levels/apex-peak.json', from: v(37.5, 1.5, 26.5), to: v(40.5, 1.4, 28.2), lookFrom: v(44.2, 1.0, 32), lookTo: v(44.2, 1.0, 32), credits: [cast('Director Hale')] },
  { path: '/levels/apex-peak.json', from: v(45.5, 1.6, 43.2), to: v(47.2, 1.6, 44.6), lookFrom: v(48.2, 1.5, 46.9), lookTo: v(48.2, 1.5, 46.9), credits: [cast('Voss')] },
  { path: '/levels/b3-basement.json', from: v(41, 1.5, 38), to: v(31, 1.5, 38), lookFrom: v(17, 1.4, 38), lookTo: v(17, 1.4, 38), credits: [cast('Lang')] },
  { path: '/levels/b3-basement.json', from: v(12.6, 1.6, 38), to: v(11, 1.6, 36.6), lookFrom: v(7.2, 1.2, 38), lookTo: v(7.2, 1.2, 38), credits: [cast('The Creature')] },
  { path: '/levels/going-home.json', from: v(0, 1.6, 15.5), to: v(0, 1.6, 10), lookFrom: v(0, 1.5, 1.1), lookTo: v(0, 1.5, 1.1), credits: [cast('The Night Cleaner')] },
  { path: '/levels/the-station.json', from: v(30, 1.4, 2.4), to: v(33.5, 1.4, 3), lookFrom: v(45, 1.4, 5), lookTo: v(45, 1.4, 5), credits: [cast('The Commuter')] },
  { path: '/levels/the-train.json', from: v(1, 1.5, 0), to: v(5, 1.5, 0), lookFrom: v(17, 1.3, 0), lookTo: v(17, 1.3, 0), credits: [cast('The Other One'), { role: 'Music and voices', name: 'Hawkes Gen' }, { role: 'A game by', name: 'Hawkes Studio' }] },
];

const SHOT_SECONDS = 8;
const lerp = (a: V3, b: V3, k: number): V3 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

export const endingSeen = () => {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
};

export type MorningEndingStatus = {
  active: boolean;
  phase: 'idle' | 'dawn' | 'black' | 'title' | 'credits' | 'call' | 'card';
  titleShown: boolean;
  /** Distinct level files the credits flew over so far. */
  places: number;
  shots: number;
  names: string[];
  callHeard: boolean;
  cardShown: boolean;
  skipShown: boolean;
  skipped: boolean;
};

export const createMorningEnding = (host: EndingHost) => {
  let active = false;
  let phase: MorningEndingStatus['phase'] = 'idle';
  let skipped = false;
  let titleShown = false;
  let callHeard = false;
  let cardShown = false;
  let shots = 0;
  const paths = new Set<string>();
  const names: string[] = [];
  let waiters: { left: number; resolve: () => void }[] = [];
  let shot: { s: Shot; t: number } | null = null;
  let current = '';
  let run = 0;

  const sleep = (seconds: number) => new Promise<void>((resolve) => {
    if (skipped) { resolve(); return; }
    waiters.push({ left: seconds, resolve });
  });
  const white = (o: number, secs: number) => {
    const e = el('endWhite');
    if (!e) return;
    e.style.transition = `opacity ${secs}s linear`;
    e.style.opacity = String(o);
  };
  const black = (o: number, secs: number) => {
    const e = el('endBlack');
    if (!e) return;
    e.style.transition = `opacity ${secs}s ease`;
    e.style.opacity = String(o);
  };
  const showNames = (role: string, name: string, on: boolean) => {
    const box = el('endNames');
    if (!box) return;
    if (on) {
      const r = el('endRole');
      const n = el('endName');
      if (r) r.textContent = role;
      if (n) n.textContent = name;
      names.push(name);
    }
    box.classList.toggle('on', on);
  };
  const setSkip = () => {
    const b = el('endSkip');
    if (b) b.classList.toggle('on', active && endingSeen() && phase !== 'card');
  };

  const toCard = async () => {
    phase = 'card';
    host.showLine('', '');
    shot = null;
    el('endCall')?.classList.remove('on');
    showNames('', '', false);
    el('endTitle')?.classList.remove('drop');
    white(0, 0);
    black(1, 0.4);
    host.stopMusic();
    const title = el('endCardTitle');
    if (title) title.textContent = lineText('ui.end.act2', 'Act II is coming');
    const exit = el('endCardExit');
    if (exit) exit.textContent = lineText('ui.end.exit', 'Exit');
    el('endCard')?.classList.add('on');
    cardShown = true;
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ }
    setSkip();
    host.complete();
  };

  const sequence = async (id: number) => {
    const alive = () => id === run && active;
    // dawn: the door is opening; the world goes white.
    phase = 'dawn';
    host.tone(196, 3.2, 'sine', 0.03);
    white(1, 2.4);
    if (await sleep(3.0), !alive() || skipped) return;
    // black: a hard cut, one held tone.
    phase = 'black';
    white(0, 0);
    black(1, 0);
    host.tone(110, 4.4, 'sine', 0.05);
    host.tone(165, 4.4, 'sine', 0.025);
    if (await sleep(3.4), !alive() || skipped) return;
    // title: the chord and the title land together.
    phase = 'title';
    const hasMusic = await host.playMusic(END_MUSIC);
    if (!hasMusic) {
      for (const f of [73.4, 110, 146.8, 220, 293.7]) host.tone(f, 6, 'triangle', 0.045);
    }
    el('endTitle')?.classList.add('drop');
    titleShown = true;
    if (await sleep(6.5), !alive() || skipped) return;
    el('endTitle')?.classList.remove('drop');
    if (await sleep(1.2), !alive() || skipped) return;
    // credits: names over the empty places.
    phase = 'credits';
    for (const s of SHOTS) {
      if (!alive() || skipped) return;
      if (s.path !== current) {
        black(1, 0.6);
        await sleep(0.7);
        if (!alive() || skipped) return;
        try {
          await host.loadShot(s.path);
          current = s.path;
        } catch {
          continue;
        }
      }
      shots += 1;
      paths.add(s.path);
      shot = { s, t: 0 };
      host.camera(s.from, s.lookFrom);
      black(0, 1.2);
      const each = SHOT_SECONDS / s.credits.length;
      for (const c of s.credits) {
        await sleep(0.9);
        if (!alive() || skipped) return;
        showNames(c.role, c.name, true);
        await sleep(Math.max(1.6, each - 2.2));
        showNames('', '', false);
        await sleep(0.8);
        if (!alive() || skipped) return;
      }
    }
    shot = null;
    black(1, 1.2);
    showNames('', '', false);
    host.stopMusic();
    if (await sleep(2.0), !alive() || skipped) return;
    // call: a phone buzzes in the dark; an unknown caller says one line.
    phase = 'call';
    const who = el('endCallWho');
    const sub = el('endCallSub');
    if (who) who.textContent = lineText('ui.end.caller', 'Unknown caller');
    if (sub) sub.textContent = lineText('ui.end.buzz', 'Incoming');
    el('endCall')?.classList.add('on');
    for (let i = 0; i < 3; i += 1) {
      host.tone(70, 0.35, 'square', 0.05);
      if (await sleep(0.8), !alive() || skipped) return;
    }
    const url = lineAudio(ACT2_CALL.id) || ACT2_CALL.url;
    host.showLine(lineText('ui.end.caller', 'Unknown caller'), lineText(ACT2_CALL.id, 'Pierce. The one who got off the train is looking for you. Find me first.'));
    host.playFile(url, 0.95);
    callHeard = true;
    if (await sleep(1.5), !alive() || skipped) return;
    let waited = 0;
    while (alive() && !skipped && voiceBusy() && waited < 12) {
      await sleep(0.25);
      waited += 0.25;
    }
    if (await sleep(1.2), !alive() || skipped) return;
    el('endCall')?.classList.remove('on');
    await toCard();
  };

  const skipNow = () => {
    if (!active || phase === 'card' || !endingSeen()) return;
    skipped = true;
    const pending = waiters;
    waiters = [];
    pending.forEach((w) => w.resolve());
    void toCard();
  };

  el('endSkip')?.addEventListener('click', skipNow);
  el('endCardExit')?.addEventListener('click', () => host.exit());

  return {
    active: () => active,
    /** Enter and Escape-free skip (main.ts routes Enter here). */
    skip: skipNow,
    begin: () => {
      active = true;
      skipped = false;
      titleShown = false;
      callHeard = false;
      cardShown = false;
      shots = 0;
      paths.clear();
      names.length = 0;
      current = MORNING;
      shot = null;
      run += 1;
      const root = el('endSuite');
      root?.classList.add('on');
      el('endCard')?.classList.remove('on');
      black(0, 0);
      white(0, 0);
      setSkip();
      void sequence(run);
    },
    step: (delta: number) => {
      if (!active) return;
      const dt = Math.min(0.1, Math.max(0, delta));
      const due: (() => void)[] = [];
      waiters = waiters.filter((w) => {
        w.left -= dt;
        if (w.left > 0) return true;
        due.push(w.resolve);
        return false;
      });
      due.forEach((fn) => fn());
      if (shot) {
        shot.t += dt;
        const k = Math.min(1, shot.t / SHOT_SECONDS);
        const e = k * k * (3 - 2 * k);
        host.camera(lerp(shot.s.from, shot.s.to, e), lerp(shot.s.lookFrom, shot.s.lookTo, e));
      }
    },
    dispose: () => {
      active = false;
      run += 1;
      skipped = true;
      waiters.forEach((w) => w.resolve());
      waiters = [];
      el('endSuite')?.classList.remove('on');
      el('endCard')?.classList.remove('on');
      el('endCall')?.classList.remove('on');
      el('endNames')?.classList.remove('on');
      el('endTitle')?.classList.remove('drop');
      black(0, 0);
      white(0, 0);
      host.showLine('', '');
      phase = 'idle';
    },
    status: (): MorningEndingStatus => ({
      active,
      phase,
      titleShown,
      places: paths.size,
      shots,
      names: [...names],
      callHeard,
      cardShown,
      skipShown: !!el('endSkip')?.classList.contains('on'),
      skipped,
    }),
  };
};

export type MorningEnding = ReturnType<typeof createMorningEnding>;
