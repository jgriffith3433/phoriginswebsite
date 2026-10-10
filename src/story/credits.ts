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
        role: 'The Elevator',
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
          'What Rode The Elevator',
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
  4: {
    left: [
      {
        role: 'The Bathroom',
        names: [
          'Had A Door',
          'The Rest Of The Floor',
          'Did Not Need One',
        ],
      },
      {
        role: 'The Mirror',
        names: [
          'Kept Its Answer',
          'And Would Not',
          'Soften It',
        ],
      },
      {
        role: 'The Work',
        names: [
          'Waited Where',
          'He Had Left It',
          'The Night Before',
        ],
      },
      {
        role: 'The Papers',
        names: [
          'Were Finished',
          'The Moment',
          'They Left The Desk',
        ],
      },
      {
        role: 'The Hall',
        names: [
          'Was Already Looking',
          'Before Anyone',
          'Was In It',
        ],
      },
      {
        role: 'Pierce Hawkes',
        names: [
          'Left The Floor',
          'Whatever It Still',
          'Wanted From Him',
        ],
      },
    ],
    right: [
      {
        role: 'Hale',
        names: [
          'Would Tell The Investors',
          'A Man Had Walked Out',
          'She Would Leave',
          'The Rest Unsaid',
        ],
      },
      {
        role: 'The Investors',
        names: [
          'Still Had A Meeting',
          'On A Floor',
          'He Was Leaving',
        ],
      },
      {
        role: 'The Brightness',
        names: [
          'Belonged To The Building',
          'He Had Stopped',
          'Belonging To It',
        ],
      },
      {
        role: 'The Elevator',
        names: [
          'Knew The Way Down',
          'He Only Had',
          'To Stand In It',
        ],
      },
      {
        role: 'Home',
        names: [
          'Was A Word',
          'He Still Used',
          'For A Place',
          'That Had Not Seen Him',
        ],
      },
      {
        role: 'The Hands',
        names: [
          'Were The First Thing',
          'The Mirror',
          'Had Been Honest About',
        ],
      },
    ],
  },
  5: {
    left: [
      {
        role: 'The Lobby',
        names: [
          'Still Had A Shift',
          'And A Phone',
          'Within Reach',
        ],
      },
      {
        role: 'The Receptionist',
        names: [
          'Said His Name',
          'To Someone',
          'Who Was Not There',
        ],
      },
      {
        role: 'The Police',
        names: [
          'Were Given A Floor',
          'And A Description',
          'The Directory',
          'Could Not Match',
        ],
      },
      {
        role: 'The Street',
        names: [
          'Took Him In',
          'Without Asking',
          'For Identification',
        ],
      },
      {
        role: 'The Crowd',
        names: [
          'Mostly Kept',
          'Their Errands',
        ],
      },
      {
        role: 'The Few',
        names: [
          'Who Ran',
          'Had To Be',
          'Close Enough To See',
        ],
      },
    ],
    right: [
      {
        role: 'The Cars',
        names: [
          'Kept The Lane',
          'And The Right',
          'Of Way',
        ],
      },
      {
        role: 'The Hands',
        names: [
          'Found People',
          'The Way A Gaze Finds',
          'A Face In A Crowd',
        ],
      },
      {
        role: 'The Tower',
        names: [
          'Stayed Lit',
          'Behind Him',
          'On A Floor',
          'He Was Done With',
        ],
      },
      {
        role: 'The Sidewalk',
        names: [
          'Ran For Blocks',
          'And Ended',
          'At A Stair',
        ],
      },
      {
        role: 'The Sign',
        names: [
          'Promised A Train',
          'Where A Door',
          'Would Have Promised',
          'A Room',
        ],
      },
      {
        role: 'Pierce Hawkes',
        names: [
          'Went Down',
          'Instead Of In',
        ],
      },
    ],
  },
  6: {
    left: [
      {
        role: 'The Stairs',
        names: [
          'Took The Street',
          'Off His Shoulders',
          'One Flight',
          'At A Time',
        ],
      },
      {
        role: 'The Lights',
        names: [
          'Had Been On',
          'Longer Than',
          'The City Above',
        ],
      },
      {
        role: 'The Turnstiles',
        names: [
          'Counted No One',
          'Who Mattered',
        ],
      },
      {
        role: 'The Platform',
        names: [
          'Held Its Line',
          'In Yellow',
          'And Waited',
        ],
      },
      {
        role: 'The Commuters',
        names: [
          'Had Somewhere',
          'They Still Believed',
          'They Were Going',
        ],
      },
      {
        role: 'The Quiet',
        names: [
          'Was The Street',
          'With The Sky',
          'Taken Off It',
        ],
      },
    ],
    right: [
      {
        role: 'The Train',
        names: [
          'Sat With A Door',
          'Open On Nothing',
          'He Could Name',
        ],
      },
      {
        role: 'The Tracks',
        names: [
          'Went On',
          'Past The Light',
          'He Was Standing In',
        ],
      },
      {
        role: 'The Hands',
        names: [
          'Still Knew',
          'How To Close',
          'A Distance',
        ],
      },
      {
        role: 'Above',
        names: [
          'The Tower Kept',
          'Its Meeting',
          'And Its Name',
          'On The Directory',
        ],
      },
      {
        role: 'The Phone',
        names: [
          'Had Nothing',
          'Left To Ring For',
        ],
      },
      {
        role: 'Pierce Hawkes',
        names: [
          'Stepped Toward',
          'A Door',
          'That Did Not Ask',
          'Him To Explain',
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