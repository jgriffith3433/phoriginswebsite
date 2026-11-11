/**
 * What the living world did, for the playtest probe: people on routines, who glanced at Pierce, what answered
 * Interact (with its motion and sound), and the longest stretch with nothing to see, hear or do. Read-only
 * counters; nothing here drives gameplay.
 */
export type LifeTouch = { place: string; id: string; motion: string; sound: string; at: number };
export type LifeGlance = { place: string; who: string; at: number };
export type LifeBark = { place: string; who: string; line: string; at: number };

const people = new Map<string, { place: string; routine: string }>();
const glances: LifeGlance[] = [];
const touches: LifeTouch[] = [];
const barks: LifeBark[] = [];
let marks: number[] = [];
let started = performance.now();

const now = () => (performance.now() - started) / 1000;

export const lifeStats = {
  reset() {
    people.clear();
    glances.length = 0;
    touches.length = 0;
    barks.length = 0;
    marks = [0];
    started = performance.now();
  },
  /** Anything to see, hear or do just happened. */
  mark() { marks.push(now()); },
  person(id: string, place: string, routine: string) { people.set(id, { place, routine }); },
  forget(id: string) { people.delete(id); },
  glance(place: string, who: string) {
    glances.push({ place, who, at: now() });
    marks.push(now());
  },
  touch(place: string, id: string, motion: string, sound: string) {
    touches.push({ place, id, motion, sound, at: now() });
    marks.push(now());
  },
  bark(place: string, who: string, line: string) {
    barks.push({ place, who, line, at: now() });
    marks.push(now());
  },
  maxQuietSeconds() {
    const list = [...marks, now()].sort((a, b) => a - b);
    let max = 0;
    for (let i = 1; i < list.length; i += 1) max = Math.max(max, list[i] - list[i - 1]);
    return Math.round(max * 10) / 10;
  },
  snapshot() {
    const routines = [...people.entries()].map(([id, p]) => ({ id, ...p }));
    return {
      people: routines,
      glances: glances.slice(-40),
      glanceCount: glances.length,
      touches: touches.slice(-40),
      touchCount: touches.length,
      touchIds: [...new Set(touches.map((t) => `${t.place}:${t.id}`))],
      barks: barks.slice(-40),
      maxQuietSeconds: lifeStats.maxQuietSeconds(),
    };
  },
};
