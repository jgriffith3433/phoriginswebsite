// Text content for the puzzle chain: the clue files, wordlists, hints. Kept apart from logic so the spec and tests can read it.

import { reverse } from './util.js';

export const TARGET_HOST = 'gw.hawkes.lan';
export const OPS_PASSWORD = 'roomforgrace58';

const HAT_PLAIN = 'target: gw.hawkes.lan (staging gateway, "ops" lives there). scan it before you touch it. then ask it for its backups. it is polite.';

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
  'ops_hash=$1$hat$0b9o1fR3w8H0H5uXx0Bz.1',
  'hash_type=md5crypt',
  '# TODO(intern): audit wordlist = /usr/share/wordlists/hawkes-staff.txt  <- delete before prod!!',
  'ssh_banner=staging gateway. be nice.',
];

export const GW_BACKUP_NAME = 'gw.cfg.bak';

const STAFF_WORDS = [
  'apexpeak', 'hawkes', 'hawkes1', 'hawkes123', 'tower58', 'floor58', 'fiftyeight', 'boardroom', 'boardmeeting', 'chairman',
  'zurich', 'zurichdate', 'lang2024', 'voss123', 'vosscapital', 'halefury', 'directorhale', 'piercehawkes', 'pierce58',
  'libertysquare', 'midnightdiner', 'nightshift', 'nightcleaner', 'eveningmrhawkes', 'valuation', 'marketshare', 'compliance',
  'ceilingmine', 'secretlab', 'recordsyoucantrust', 'recordsyoucanfind', 'elevator58', 'goinghome', 'thestation', 'thedesk',
  'themorning', 'thereturn', 'roomforgrace58', 'walnut', 'navycarpet', 'glasswall', 'skyline', 'coffeelow', 'password',
  'letmein', 'staging', 'stagingops', 'opsopsops', 'gateway', 'hatbackwards', 'backwardshat', 'intern', 'internpass',
  'changeme', 'welcome1', 'quarterly', 'zurich58', 'toweroflies', 'hawkesbio', 'biomedical', 'lobbydesk', 'cleaner',
];
export const WORDLIST_STAFF = STAFF_WORDS.join('\n') + '\n';

const LITE = ['123456', 'password', 'qwerty', 'letmein', 'dragon', 'monkey', 'abc123', 'iloveyou', 'admin', 'welcome',
  'sunshine', 'football', 'trustno1', 'princess', 'master', 'hunter2', 'shadow', 'baseball', 'superman', 'starwars',
  'batman', 'whatever', 'freedom', 'login', 'passw0rd', 'summer', 'flower', 'charlie', 'donald', 'access'];
export const WORDLIST_LITE = LITE.join('\n') + '\n';

export const STEPS = [
  { id: 'hat', title: 'Read the hat', done: 'You read the hat: the old crew wrote backwards.' },
  { id: 'scan', title: 'Knock on the gateway', done: 'You scanned gw.hawkes.lan and found its open doors.' },
  { id: 'loot', title: 'Take the backup', done: 'You pulled the staging backup off the admin port.' },
  { id: 'crack', title: 'Crack the ops hash', done: 'You cracked the ops password with the right wordlist.' },
  { id: 'root', title: 'Pager to root', done: 'You escaped the pager and became root.' },
];

/** The login guide: one exact, copy-paste command per step. Help, hint, Tab and the "Next:" pointers all read this. */
export const GUIDE = {
  hat: { cmd: 'rev ~/.hat_backwards', what: 'turns the backwards hat round. It names the gateway you are after.' },
  scan: { cmd: `nmap ${TARGET_HOST}`, what: 'knocks on the gateway and lists its open doors, and the backup it leaves lying around.' },
  loot: { cmd: `curl ${TARGET_HOST}:8080/backup/${GW_BACKUP_NAME}`, what: 'downloads that staging backup into ~/loot.' },
  crack: { cmd: `john --wordlist=/usr/share/wordlists/hawkes-staff.txt ~/loot/${GW_BACKUP_NAME}`, what: 'cracks the ops password in the backup with the staff wordlist.' },
  root: { cmd: `ssh ops@${TARGET_HOST}`, what: `logs in as ops (type the password ${OPS_PASSWORD} when asked). The gateway gives its staging admin root.` },
};

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
