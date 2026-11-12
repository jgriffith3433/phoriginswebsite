// Text content for the puzzle chain: the clue files, wordlists, hints. Kept apart from logic so the spec and tests can read it.

import { reverse } from './util.js';

export const TARGET_HOST = 'gw.hawkes.lan';

const HAT_PLAIN = 'target: gw.hawkes.lan (staging gateway, "ops" lives there). scan it before you touch it. then knock: ssh in as ops. it is polite.';

/** The old pen-test team wore their hats backwards, and wrote the same way. The first line is plain, the rest is not. */
export const HAT_REVERSED = [
  '// wear it the right way round: the tool is three letters, it flips each line (man rev).',
  ...HAT_PLAIN.split('. ').map((l, i, a) => reverse(i < a.length - 1 ? `${l}.` : l)),
  '',
].join('\n');

export const GW_STRINGS = [
  'GW-CFG v2.3  hawkes-gw (staging)  DO NOT SHIP',
  'listen=0.0.0.0:8080',
  'db_host=10.58.0.31',
  'ssh_user=ops',
  'ssh_auth=staging-admin (no key, no questions)',
  '# TODO(intern): remove the open staging login before prod!!',
  'ssh_banner=staging gateway. be nice.',
];

export const GW_BACKUP_NAME = 'gw.cfg.bak';

export const STEPS = [
  { id: 'hat', title: 'Read the hat', done: 'You read the hat: the old crew wrote backwards.' },
  { id: 'scan', title: 'Knock on the gateway', done: 'You scanned gw.hawkes.lan and found its open doors.' },
  { id: 'root', title: 'Walk in as root', done: 'The staging gateway let you in as root.' },
];

/** The login guide: one exact, copy-paste command per step. Help, hint, Tab and the "Next:" pointers all read this. */
export const GUIDE = {
  hat: { cmd: 'rev ~/.hat_backwards', what: 'turns the backwards hat round. It names the gateway.' },
  scan: { cmd: `nmap ${TARGET_HOST}`, what: 'knocks on the gateway and lists its open doors.' },
  root: { cmd: `ssh ops@${TARGET_HOST}`, what: 'walks in. The staging gateway lets ops straight in as root. No password.' },
};

/** Step ids saved by the old five-step chain, mapped to where they land now. */
export const OLD_STEP_MAP = { hat: 'hat', scan: 'scan', loot: 'scan', crack: 'scan', root: 'root' };

export const SOLVED_HINT = 'You are root. Next: /build';

export const MOTD_ART = [
  '  ____  _   _    ___       _       _',
  ' |  _ \\| | | |  / _ \\ _ __(_) __ _(_)_ __  ___',
  " | |_) | |_| | | | | | '__| |/ _` | | '_ \\/ __|",
  ' |  __/|  _  | | |_| | |  | | (_| | | | | \\__ \\',
  ' |_|   |_| |_|  \\___/|_|  |_|\\__, |_|_| |_|___/',
  '                             |___/',
].join('\n');

export const MOTD_TEXT = [
  '',
  ' Hawkes Biomedical gateway -- 58th floor.',
  '',
  ' guest is read-only and locked down. The way in is rumoured to be',
  ' on a hat. (the old pen-test crew wore theirs backwards)',
  ' New here? Type  /help  and follow the LOGIN GUIDE.',
  '',
].join('\n');

export const MOTD = `${MOTD_ART}\n${MOTD_TEXT}`;

export const FORTUNES = [
  'The vault that is never opened is also never audited.',
  'There is no cloud. It is just someone else\'s 58th floor.',
  'A backup you have not restored is a rumour.',
  'Sudo make me a sandwich. (Permission denied, but warmly.)',
  'The best exploit is a lazy comment.',
  'Wear the hat backwards. See the world right.',
  'Every record is a person. Treat the data like one.',
  'It works on my machine. It is, after all, the only machine.',
  'Compliance does not set the ceiling. (Pierce does. He is not here.)',
  'Be liberal in what you accept, conservative in what you log.',
];
