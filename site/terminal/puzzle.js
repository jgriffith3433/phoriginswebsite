// The puzzle state machine. Three steps, strictly ordered: a step only completes when every earlier step is done.

import { STEPS, GUIDE, SOLVED_HINT, OLD_STEP_MAP } from './content.js';

const ORDER = STEPS.map((s) => s.id);

export class Puzzle {
  /** @param {object} [saved] { done: string[], hints: Record<string,number>, hintsUsed: number, extra: string[] } */
  constructor(saved = {}) {
    // Saves from the old five-step chain (hat, scan, loot, crack, root) land at the matching new step.
    const mapped = (saved.done || []).map((id) => OLD_STEP_MAP[id]).filter(Boolean);
    this.done = ORDER.filter((id) => mapped.includes(id)); // keeps order, drops junk
    // A saved list with a gap is not a valid chain: keep only the unbroken prefix.
    const prefix = [];
    for (const id of ORDER) { if (this.done.includes(id)) prefix.push(id); else break; }
    this.done = prefix;
    this.hints = Object.fromEntries(Object.entries(saved.hints || {}).filter(([k]) => ORDER.includes(k)));
    this.hintsUsed = saved.hintsUsed || 0;
    this.extra = [...(saved.extra || [])]; // side achievements (konami, sandwich...)
  }

  has(id) { return this.done.includes(id); }

  /** Is this the next step in the chain? */
  ready(id) { return ORDER.indexOf(id) === this.done.length; }

  /** Complete a step; false when an earlier one is missing (or it was already done). */
  complete(id) {
    if (!ORDER.includes(id) || this.has(id) || !this.ready(id)) return false;
    this.done.push(id);
    return true;
  }

  get root() { return this.has('root'); }
  get current() { return ORDER[this.done.length] ?? null; }
  get stepsDone() { return this.done.length; }

  /** The next nudge for the current step. The level only goes up, and never past the last. */
  hint() {
    const cur = this.current;
    if (!cur) return { step: null, level: 0, text: SOLVED_HINT };
    const level = 1;
    if (!this.hints[cur]) this.hintsUsed += 1;
    this.hints[cur] = level;
    return { step: cur, level, text: `Next: ${GUIDE[cur].cmd}` };
  }

  award(id) { if (!this.extra.includes(id)) { this.extra.push(id); return true; } return false; }

  save() { return { done: [...this.done], hints: { ...this.hints }, hintsUsed: this.hintsUsed, extra: [...this.extra] }; }
}
