import { storyLine } from '../game/locale';

export type CreditBlock = {
  role: string;
  names: string[];
};

export type LevelCredits = {
  left: CreditBlock[];
  right: CreditBlock[];
};

/**
 * The end-of-chapter crawl: at most three short lines (a role and two names), on the left edge only.
 * The facts it used to carry now happen in the world: cutscenes/finale-N.json for levels 1, 3, 5, 6 and 8,
 * and the existing calls and barks (docs/story/events.md lists where each one went).
 * `role` is the small title. `names` are the large lines. Level 7's card uses entry 7.
 */
export const LEVEL_CREDITS: Record<number, LevelCredits> = {
  1: {
    left: [
      {
        role: 'Pierce',
        names: [
          'Could Have Stayed Upstairs',
          'He Took The Ride Down',
        ],
      },
    ],
    right: [],
  },
  2: {
    left: [
      {
        role: 'The Creature',
        names: [
          'Was Not Lost',
          'It Was Going Home',
        ],
      },
    ],
    right: [],
  },
  3: {
    left: [
      {
        role: 'Pierce Hawkes',
        names: [
          'Still Knew The Way',
          'To His Own Floor',
        ],
      },
    ],
    right: [],
  },
  4: {
    left: [
      {
        role: 'The Mirror',
        names: [
          'Kept Its Answer',
          'And Would Not Soften It',
        ],
      },
    ],
    right: [],
  },
  5: {
    left: [
      {
        role: 'Pierce Hawkes',
        names: [
          'Went Down',
          'Instead Of In',
        ],
      },
    ],
    right: [],
  },
  6: {
    left: [
      {
        role: 'The Train',
        names: [
          'Sat With A Door',
          'Open On Nothing He Could Name',
        ],
      },
    ],
    right: [],
  },
  7: {
    left: [
      {
        role: 'The Other One',
        names: [
          'Never Turned Around',
          'The Train Went Uptown',
        ],
      },
    ],
    right: [],
  },
  8: {
    left: [
      {
        role: 'The Door',
        names: [
          'Closed Behind Him',
          'On A Television Saying His Name',
        ],
      },
    ],
    right: [],
  },
};

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const column = (blocks: CreditBlock[], levelId: number, side: 'left' | 'right') => {
  const body = blocks.map((block, index) => {
    const role = storyLine(`credit.${levelId}.${side}.${index}.role`)?.text || block.role;
    const names = block.names
      .map((name, line) => storyLine(`credit.${levelId}.${side}.${index}.${line}`)?.text || name)
      .map((name) => `<p class="credit-name">${escapeHtml(name)}</p>`)
      .join('');

    return `<div class="credit-block"><p class="credit-role">${escapeHtml(role)}</p>${names}</div>`;
  }).join('');

  return `<div class="credit-roll credit-roll-${side}">${body}</div>`;
};

/** `credits` overrides the table. Level 7's crawl is entry 7. */
export const renderLevelCredits = (levelId: number, credits: LevelCredits | undefined = LEVEL_CREDITS[levelId]) => {
  if (!credits) return '';

  return column(credits.left, levelId, 'left') + column(credits.right, levelId, 'right');
};