/**
 * Going Home's power lessons, as data. One power at a time, each in four steps: safe first use, harder use, a twist,
 * a payoff (Portal's early chambers). Pure state, no Babylon: `goingHome.ts` feeds it events and draws what it says.
 *
 * Order: Shadow (crowd), Shock (police pair), Possess (a blocked sidewalk), Consume (the station gate), then
 * Punch/Kick, which only arrives after Pierce, unshadowed, is shoved.
 */

export type Power = 'shadow' | 'shock' | 'possess' | 'consume' | 'melee';
export type Step = 'safe' | 'harder' | 'twist' | 'payoff';
export type Setup = 'crowd' | 'police' | 'block' | 'station' | 'shove';

/** A new control is never introduced inside this many seconds of the last one. */
export const MIN_GAP = 30;

export const POWERS: Power[] = ['shadow', 'shock', 'possess', 'consume', 'melee'];

export const SETUP_OF: Record<Power, Setup> = {
  shadow: 'crowd',
  shock: 'police',
  possess: 'block',
  consume: 'station',
  melee: 'shove',
};

/** The control that power teaches (for the log). */
export const CONTROL_OF: Record<Power, string> = {
  shadow: 'C',
  shock: 'Click',
  possess: 'Click',
  consume: 'Click again',
  melee: 'Click',
};

/** Which on-screen button a context prompt belongs on. */
export type PromptButton = 'shadow' | 'fire' | 'ability';

export type Prompt = {
  /** One glyph. */
  icon: string;
  /** Key on a keyboard, the touch word on a phone. */
  key: string;
  touchKey: string;
  /** At most four words in all, with the key. */
  label: string;
  button: PromptButton;
  /** World spot to hang the prompt on, when the power is used on something. */
  target: { x: number; y: number; z: number } | null;
};

export type Intro = { t: number; power: Power; step: Step; setup: Setup; control: string };

/** What each power's prompt says. Key plus label stays at four words or fewer. */
export const PROMPTS: Record<Power, Omit<Prompt, 'target'>> = {
  shadow: { icon: '◐', key: 'C', touchKey: 'Tap', label: 'Shadow', button: 'shadow' },
  shock: { icon: '⚡', key: 'Click', touchKey: 'Tap', label: 'Shock', button: 'fire' },
  possess: { icon: '◉', key: 'Click', touchKey: 'Tap', label: 'Possess', button: 'fire' },
  consume: { icon: '✹', key: 'Click', touchKey: 'Tap', label: 'again: Consume', button: 'fire' },
  melee: { icon: '✊', key: 'Click', touchKey: 'Tap', label: 'Punch', button: 'fire' },
};

export const promptWords = (power: Power) => {
  const p = PROMPTS[power];
  return `${p.key} ${p.label}`.split(/\s+/).filter(Boolean).length;
};

export const createTutorial = () => {
  let clock = 0;
  let power: Power = 'shadow';
  let lastIntro = -Infinity;
  let started = false;
  const log: Intro[] = [];
  const done = new Set<string>();
  const unlocked = new Set<Power>();

  const mark = (p: Power, step: Step) => {
    const key = `${p}:${step}`;
    if (done.has(key)) return false;
    done.add(key);
    log.push({ t: Math.round(clock * 10) / 10, power: p, step, setup: SETUP_OF[p], control: CONTROL_OF[p] });
    return true;
  };

  return {
    tick: (dt: number) => { clock += dt; },
    now: () => clock,
    power: () => power,
    log: () => log.slice(),
    stepsDone: (p: Power) => (['safe', 'harder', 'twist', 'payoff'] as Step[]).filter((s) => done.has(`${p}:${s}`)),
    has: (p: Power, s: Step) => done.has(`${p}:${s}`),
    /** The street opened: Shadow is the first thing, offered at once. */
    begin: () => {
      if (started) return;
      started = true;
      lastIntro = clock;
      unlocked.add('shadow');
    },
    started: () => started,
    /** Seconds until the next power may be introduced. */
    gapLeft: () => Math.max(0, MIN_GAP - (clock - lastIntro)),
    /** Introduce `p`: it becomes the current power and the gap restarts. Returns false when it may not yet. */
    introduce: (p: Power) => {
      if (unlocked.has(p)) return true;
      if (p !== 'shadow' && !(POWERS.indexOf(p) === POWERS.indexOf(power) + 1 && done.has(`${power}:payoff`))) return false;
      if (p !== 'shadow' && clock - lastIntro < MIN_GAP) return false;
      unlocked.add(p);
      power = p;
      lastIntro = clock;
      return true;
    },
    /** Test shortcut (playtest setup): hand over `p` without its lesson. */
    force: (p: Power) => {
      unlocked.add(p);
      power = p;
      lastIntro = clock;
    },
    isUnlocked: (p: Power) => unlocked.has(p),
    mark,
    reset: () => {
      clock = 0;
      power = 'shadow';
      lastIntro = -Infinity;
      started = false;
      log.length = 0;
      done.clear();
      unlocked.clear();
    },
  };
};

export type Tutorial = ReturnType<typeof createTutorial>;
