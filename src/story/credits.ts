export type CreditBlock = {
  role: string;
  names: string[];
};

export type LevelCredits = {
  left: CreditBlock[];
  right: CreditBlock[];
};

/**
 * Unspoken leftovers, not a recap of the beats.
 * `role` is the small title. `names` are the large lines.
 * Left and right crawl on opposite edges of the card.
 */
export const LEVEL_CREDITS: Record<number, LevelCredits> = {
  1: {
    left: [
      { role: 'Pierce', names: ['Let them keep the quarter'] },
      { role: 'Zurich', names: ['Buys the story', 'Not the basement'] },
      { role: 'The patients', names: ['Were the work'] },
      { role: 'Who leave', names: ['Write the decade'] },
      { role: 'Grace', names: ['Was the door', 'On the way out'] },
      { role: 'The glass', names: ['Keeps them in'] },
      { role: 'His promise', names: ['B3 stays dark'] },
      { role: 'The dark', names: ['Was never his', 'To promise'] },
    ],
    right: [
      { role: 'Voss', names: ['Is mad'] },
      { role: 'Hale', names: ["Didn't like", 'Being walked out on'] },
      { role: 'She stayed', names: ['In the room', 'They left her'] },
      { role: 'A board', names: ['Is not a room', 'You leave'] },
      { role: 'Lang', names: ['Only wanted', "Zurich's date"] },
      { role: 'The charter', names: ['Asked for a seal'] },
      { role: 'He answered', names: ['With the ride down'] },
      { role: 'The tape', names: ['He will not bury'] },
    ],
  },
  2: {
    left: [
      { role: 'The creature', names: ['Was not lost'] },
      { role: 'The halls', names: ['Were the long way'] },
      { role: 'The vat', names: ['Was home'] },
      { role: 'Four hits', names: ['Did not change', 'Its mind'] },
      { role: 'The glass', names: ['Was the door', 'That mattered'] },
      { role: 'It did not flee', names: ['It went to be opened'] },
    ],
    right: [
      { role: 'Pierce', names: ['Came to close a file'] },
      { role: 'The file', names: ['Closed on him'] },
      { role: "Hale's fear", names: ['Was a leak', 'To the street'] },
      { role: 'The leak', names: ['Preferred a man'] },
      { role: 'The voice', names: ['Stayed', 'It was not asked'] },
      { role: 'The hands', names: ['Belong to the floor'] },
      { role: 'What walked in', names: ['Does not leave'] },
    ],
  },
};

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const column = (blocks: CreditBlock[], side: 'left' | 'right') => {
  const body = blocks.map((block) => {
    const names = block.names.map((name) => `<p class="credit-name">${escapeHtml(name)}</p>`).join('');
    return `<div class="credit-block"><p class="credit-role">${escapeHtml(block.role)}</p>${names}</div>`;
  }).join('');
  return `<div class="credit-roll credit-roll-${side}">${body}</div>`;
};

export const renderLevelCredits = (levelId: number) => {
  const credits = LEVEL_CREDITS[levelId];
  if (!credits) return '';
  return column(credits.left, 'left') + column(credits.right, 'right');
};
