import { apexPlan } from './interior/apexPlan';
import { b3Plan } from './interior/b3Plan';

/**
 * Hawkes Analytics for the game (contract: hawkesgen/docs/analytics.md; AGENTS.md "Analytics" says what goes where).
 * Hawkes Gen's SDK (game.html loads https://gen.hawkesgen.com/sdk/analytics@1.js, never a copy: a Gen deploy updates
 * every site at once) captures page views, sessions, device, load timings, errors, fps and the exit
 * snapshot itself; this module adds the story: levels, deaths, objectives, cutscenes, calls, settings, menus, and a
 * `stuck` event when an objective has not moved for three minutes of play. Nothing here runs per frame: the watcher
 * reads the game once a second and only sends when something changed. No event carries anything personal.
 */

declare const __HAWKES_BUILD__: { version: string; commit: string; date: string } | undefined;

export type AnalyticsProbe = {
  running: () => boolean;
  paused: () => boolean;
  /** The title / level / defeat card is up. */
  menuOpen: () => boolean;
  cutscene: () => { id: string; time: number } | null;
  /** A scripted scene with no timeline file (the lobby, the desk, the station opening). */
  scripted: () => string | null;
  level: () => { id: number; libraryId: string; name: string };
  theme: () => string;
  objective: () => { title: string; text: string };
  player: () => { x: number; z: number };
};

const STUCK_SECONDS = 180;
const STUCK_REPORTS = 3;
const ASK_THEME = { background: 'rgba(5, 10, 16, 0.96)', color: '#f3f1ea', accent: '#d4b483', font: 'Arial, Helvetica, sans-serif', radius: '18px' };

/**
 * The SDK, or while it hasn't loaded (blocked, offline, Gen down) a stand-in whose calls wait in hawkesAnalyticsQ: the
 * SDK runs them when it arrives, and the game never depends on it. Nothing here reads a value back from the SDK.
 */
const queued = new Proxy({} as Window['hawkesAnalytics'], {
  get: (_, method) => (...args: unknown[]) => {
    (window.hawkesAnalyticsQ ??= []).push([method, ...args]);
    return undefined;
  },
});
const sdk = (): Window['hawkesAnalytics'] => window.hawkesAnalytics ?? queued;

const ROOM_NAMES: Record<string, string> = {
  hall1: 'hall 1', hall2: 'hall 2', board: 'boardroom', office: 'office', bath: 'restroom',
  pipeHall: 'pipe hall', hallB: 'hall B', lab: 'lab', decon: 'decon', chemA: 'chem store A', chemB: 'chem store B',
  cell: 'holding', service: 'service', control: 'control room', transform: 'vat room', corridor: 'corridor', utility: 'utility',
};

/** Where Pierce is, in words: the room on the 58th floor or in B3, else the level's place. */
const areaAt = (theme: string, x: number, z: number) => {
  const plan = theme === 'Apex Peak' ? apexPlan : theme === 'B3 Basement' ? b3Plan : null;
  if (!plan) return theme ? theme.toLowerCase() : 'unknown';
  const room = plan.rooms.find((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
  if (room) return ROOM_NAMES[room.id] ?? room.id;
  return theme === 'Apex Peak' ? 'lift' : 'B3';
};

const round = (v: number) => Math.round(v * 10) / 10;

export const createGameAnalytics = (probe: AnalyticsProbe) => {
  if (typeof __HAWKES_BUILD__ !== 'undefined' && __HAWKES_BUILD__ && !window.HAWKES_BUILD) window.HAWKES_BUILD = __HAWKES_BUILD__;
  sdk().init({ product: 'phorigins', context: { mode: 'story' } });
  sdk().loadStart();

  // The level attempt in progress (null between levels).
  let open: { id: number; name: string; started: number } | null = null;
  let step = 0;
  let objectiveKey = '';
  let stuckFor = 0;
  let stuckSent = 0;
  let lastArea = '';
  let scripted: { id: string; started: number; skipped: boolean } | null = null;
  let uses: Record<string, number> = {};
  let deathsHere = 0;
  let readySent = false;

  const where = () => {
    const p = probe.player();
    return { area: areaAt(probe.theme(), p.x, p.z), x: round(p.x), z: round(p.z) };
  };

  const objectiveLabel = () => {
    const o = probe.objective();
    return [o.title, o.text].filter(Boolean).join(': ').slice(0, 120);
  };

  const closeCard = () => {
    // A feedback card left over from the last level card must not sit on screen during play.
    document.querySelectorAll('[data-hawkes-ask]').forEach((el) => el.remove());
  };

  const tick = () => {
    const running = probe.running();
    const scene = probe.scripted();
    if (scene && !scripted) {
      scripted = { id: scene, started: performance.now(), skipped: false };
      sdk().video(scene, 'play', 0, { level: open?.id });
    } else if (scripted && scene !== scripted.id) {
      sdk().video(scripted.id, scripted.skipped ? 'skip' : 'complete', (performance.now() - scripted.started) / 1000, { level: open?.id });
      scripted = null;
    }
    if (!open || !running) return;

    const here = where();
    if (here.area !== lastArea) {
      lastArea = here.area;
      sdk().setContext({ area: here.area });
    }
    const key = objectiveLabel();
    if (key && key !== objectiveKey) {
      objectiveKey = key;
      step += 1;
      stuckFor = 0;
      stuckSent = 0;
      sdk().setContext({ objective: key });
      sdk().track('progress', { step, label: key, level: String(open.id), area: here.area });
    }

    // Stuck: three minutes of real play (not paused, not a scene, not a menu, tab visible) on one objective.
    const playing = !probe.paused() && !probe.menuOpen() && !probe.cutscene() && !scene && document.visibilityState === 'visible';
    if (!playing) return;
    stuckFor += 1;
    if (stuckSent < STUCK_REPORTS && stuckFor >= STUCK_SECONDS * (stuckSent + 1)) {
      stuckSent += 1;
      sdk().track('stuck', { level: String(open.id), objective: objectiveKey, minutes: stuckSent * 3, ...here });
    }
  };
  window.setInterval(tick, 1000);

  const endOpen = (result: 'complete' | 'death' | 'quit' | 'restart') => {
    if (!open) return;
    sdk().levelEnd(open.id, result, { name: open.name, objective: objectiveKey, steps: step, area: lastArea, uses: { ...uses } });
    open = null;
  };

  // A player who closes the tab inside a level quit there. The SDK flushes on pagehide too; send ours with it.
  window.addEventListener('pagehide', () => {
    if (!open) return;
    endOpen('quit');
    sdk().flush();
  });

  return {
    /** The title card is interactive: Start can be pressed. */
    ready: () => {
      if (readySent) return;
      readySent = true;
      sdk().ready({ level: String(probe.level().id) });
      sdk().screen('title');
    },
    screen: (name: string) => sdk().screen(name),
    levelStarted: () => {
      const level = probe.level();
      // Start on a level that is still open (Continue after the title, a retry) closes the old attempt first.
      if (open) endOpen(open.id === level.id ? 'restart' : 'quit');
      closeCard();
      open = { id: level.id, name: level.name, started: performance.now() };
      step = 0;
      objectiveKey = '';
      stuckFor = 0;
      stuckSent = 0;
      lastArea = '';
      uses = {};
      sdk().setContext({ level: String(level.id), level_name: level.name, objective: null, area: null });
      sdk().levelStart(level.id, { name: level.name });
      sdk().screen('level');
    },
    levelCompleted: () => {
      const level = open;
      endOpen('complete');
      deathsHere = 0;
      if (!level) return;
      sdk().screen('level-complete');
      if (level.id === 7) {
        void sdk().ask({
          id: 'story-end', question: 'What did you think of the story?', context: 'the story (end of level 7)',
          kind: 'stars', comment: true, placeholder: 'Pierce, B3, the night: what stayed with you?', thanks: 'Noted. Thank you.', theme: ASK_THEME,
        });
      } else {
        void sdk().ask({
          id: `after-level-${level.id}`, question: `How was level ${level.id}, ${level.name}?`, context: `level ${level.id}`,
          kind: 'thumbs', comment: true, placeholder: 'What worked, what did not?', thanks: 'Noted. Thank you.', theme: ASK_THEME,
        });
      }
    },
    died: (cause: string) => {
      if (!open) return;
      const level = open;
      sdk().death(cause, { level: String(level.id), objective: objectiveKey, ...where() });
      endOpen('death');
      deathsHere += 1;
      sdk().screen('defeat');
      // A second death on the same level: ask, on the Defeat card, what is in the way.
      if (deathsHere >= 2) {
        void sdk().ask({
          id: `defeat-level-${level.id}`, question: 'Is this part fair?', context: `level ${level.id} deaths`,
          kind: 'thumbs', comment: true, placeholder: 'What keeps getting you?', thanks: 'Noted.', theme: ASK_THEME,
        });
      }
    },
    /** Back to the title from a level card or Defeat (Main Menu). */
    toTitle: () => {
      endOpen('quit');
      deathsHere = 0;
      closeCard();
      sdk().screen('title');
    },
    cutscenePlay: (id: string) => sdk().video(id, 'play', 0, { level: open?.id }),
    cutsceneEnd: (id: string, at: number, skipped: boolean) => sdk().video(id, skipped ? 'skip' : 'complete', at, { level: open?.id }),
    /** Skip on a scripted scene: the watcher sends the skip when the scene ends. */
    scriptedSkipped: () => {
      if (scripted) scripted.skipped = true;
    },
    /** Dialogue read through or skipped: a phone call (`call`) or a cutscene's lines (`cutscene`). */
    dialogue: (source: 'call' | 'cutscene', id: string, how: 'read' | 'skipped' | 'declined', heard?: number, of?: number) => {
      sdk().feature(`dialogue.${how}`, { source, id, heard, of, level: open?.id });
    },
    /** A control or power used: the first use in a level is a feature event, the count goes on level_end. */
    used: (name: string) => {
      uses[name] = (uses[name] ?? 0) + 1;
      if (uses[name] === 1) sdk().feature(name, { level: open?.id });
    },
    feature: (name: string, value?: string | number) => sdk().feature(name, value != null ? { value } : undefined),
    sideQuest: (id: string) => sdk().feature('side_quest', { value: id, level: open?.id }),
    setting: (name: string, value: string | number | boolean) => sdk().feature(`settings.${name}`, { value }),
    context: (ctx: Record<string, string | number | boolean | null>) => sdk().setContext(ctx),
  };
};

export type GameAnalytics = ReturnType<typeof createGameAnalytics>;
