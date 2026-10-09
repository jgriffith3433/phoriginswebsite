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
 * Each name continues the thought across short lines.
 * Left and right crawl on opposite edges of the card.
 */
export const LEVEL_CREDITS: Record<number, LevelCredits> = {
  1: {
    left: [
      {
        role: 'Pierce',
        names: [
          'Had Built A Company',
          'That Promised Control',
          'Over What Once Seemed',
          'Impossible To Change',
        ],
      },
      {
        role: 'Zurich',
        names: [
          'Was Promised A Future',
          'But Never Shown',
          'What It Had Cost',
          'To Build It',
        ],
      },
      {
        role: 'The Patients',
        names: [
          'Were The Work',
          'Behind Every Promise',
          'The Company Made',
        ],
      },
      {
        role: 'Those Who Leave',
        names: [
          'Would Write The Decade',
          'Pierce Promised Zurich',
        ],
      },
      {
        role: 'Grace',
        names: [
          'Was Always An Option',
          'For Someone Else',
        ],
      },
      {
        role: 'The Glass',
        names: [
          'Was Built To Keep',
          'Something Inside',
        ],
      },
      {
        role: 'His Promise',
        names: [
          'Was That B3',
          'Would Stay Dark',
        ],
      },
      {
        role: 'The Dark',
        names: [
          'Was Never His',
          'To Promise',
        ],
      },
    ],
    right: [
      {
        role: 'Voss',
        names: [
          'Still Called Them Patients',
          'Not Prototypes',
        ],
      },
      {
        role: 'Hale',
        names: [
          'Had Feared What',
          'Would Happen',
          'If The Basement',
          'Ever Came',
          'To Light',
        ],
      },
      {
        role: 'The Board',
        names: [
          'Could Debate The Future',
          'Without Looking Down',
        ],
      },
      {
        role: 'Lang',
        names: [
          'Only Needed A Date',
          'Zurich Needed A Promise',
        ],
      },
      {
        role: 'The Charter',
        names: [
          'Asked For A Seal',
          'And An End To B3',
        ],
      },
      {
        role: 'Voss',
        names: [
          'Called Pierce First',
          'Then Sent One Message',
          'Pick Up The Terminal',
        ],
      },
      {
        role: 'The Terminal',
        names: [
          'Showed Something Moving',
          'Deep Inside B3',
          'Something No Report',
          'Had Prepared Them For',
        ],
      },
      {
        role: 'Pierce',
        names: [
          'Could Have Stayed Upstairs',
          'Instead He Took',
          'The Ride Down',
        ],
      },
    ],
  },

  2: {
    left: [
      {
        role: 'The Creature',
        names: [
          'Was Not Lost',
          'It Knew Where',
          'It Was Going',
        ],
      },
      {
        role: 'The Halls',
        names: [
          'Were The Long Way',
          'Back To The Vat',
        ],
      },
      {
        role: 'The Vat',
        names: [
          'Was Home',
          'And The Creature',
          'Was Trying To Return',
        ],
      },
      {
        role: 'The Containment Team',
        names: [
          'Saw A Threat',
          'They Could Not Control',
          'Not Something Trying',
          'To Get Home',
        ],
      },
      {
        role: 'The Glass',
        names: [
          'Was The Door',
          'That Stood Between',
          'The Creature And Home',
        ],
      },
      {
        role: 'Pierce',
        names: [
          'Went Down To Close',
          'A File',
          'He Never Expected',
          'To Become Part Of',
        ],
      },
    ],
    right: [
      {
        role: 'Hale',
        names: [
          'Had Feared What',
          'Would Happen',
          'If The Basement',
          'Ever Came',
          'To Light',
        ],
      },
      {
        role: 'The Acid',
        names: [
          'Changed Pierce',
          'Beyond Recognition',
          'But Left Him',
          'With Every Memory',
        ],
      },
      {
        role: 'The Voice',
        names: [
          'Stayed His Own',
          'Even When His Body',
          'No Longer Was',
        ],
      },
      {
        role: 'The Basement',
        names: [
          'Would Remain Sealed',
          'But Pierce Would',
          'Never Leave It',
          'Behind',
        ],
      },
      {
        role: 'The Company',
        names: [
          'Could Seal The Doors',
          'And Hide The Records',
          'But Could Not Undo',
          'What Had Happened',
        ],
      },
      {
        role: 'The Tape',
        names: [
          'Would Keep The Record',
          'Of What Happened',
          'That Night',
        ],
      },
      {
        role: 'Pierce Hawkes',
        names: [
          'Could Still Remember',
          'The Man He Was',
          'He Would Have To Live',
          'With What Remained',
        ],
      },
    ],
  },

  3: {
    left: [
      {
        role: 'The Desk',
        names: [
          'Still Had The Work',
          'He Had Meant To Finish',
          'Before Going Home',
        ],
      },
      {
        role: 'The Hall',
        names: [
          'Was Brighter Than',
          'Any Lamp He Remembered',
        ],
      },
      {
        role: 'Hale',
        names: [
          'Was Already Speaking',
          'With The Other Investors',
        ],
      },
      {
        role: 'The Car',
        names: [
          'Only Proved',
          'That It Was Climbing',
        ],
      },
      {
        role: 'The Hands',
        names: [
          'Were Not The Ones',
          'He Took Downstairs',
        ],
      },
      {
        role: 'Home',
        names: [
          'Was Still The Plan',
          'The Plan Had Not',
          'Seen The Glass',
        ],
      },
    ],
    right: [
      {
        role: 'The Investors',
        names: [
          'Would Hear He Walked Out',
          'They Would Not Hear',
          'What Rode The Car',
        ],
      },
      {
        role: 'The Meeting',
        names: [
          'Stayed On The Books',
          'The Man Who Left It',
          'Did Not',
        ],
      },
      {
        role: 'The Mirror',
        names: [
          'Agreed With Him',
          'And Offered',
          'No Explanation',
        ],
      },
      {
        role: 'The Office',
        names: [
          'Remembered A Man',
          'It Would Have To Learn',
          'The Rest',
        ],
      },
      {
        role: 'The Light',
        names: [
          'Had Been Left Off',
          'The Room Was Not',
        ],
      },
      {
        role: 'Pierce Hawkes',
        names: [
          'Still Knew The Way',
          'To His Own Floor',
        ],
      },
    ],
  },
};

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const column = (blocks: CreditBlock[], side: 'left' | 'right') => {
  const body = blocks.map((block) => {
    const names = block.names
      .map((name) => `<p class="credit-name">${escapeHtml(name)}</p>`)
      .join('');

    return `<div class="credit-block"><p class="credit-role">${escapeHtml(block.role)}</p>${names}</div>`;
  }).join('');

  return `<div class="credit-roll credit-roll-${side}">${body}</div>`;
};

export const renderLevelCredits = (levelId: number) => {
  const credits = LEVEL_CREDITS[levelId];
  if (!credits) return '';

  return column(credits.left, 'left') + column(credits.right, 'right');
};