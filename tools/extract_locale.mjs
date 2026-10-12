/**
 * Builds locales/en.json from the story files and points phone calls and
 * cutscene lines at those ids. Safe to run again: a line that already has an
 * id keeps the catalog text.
 *
 * node tools/extract_locale.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const localePath = path.join(root, 'locales', 'en.json');

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const writeJson = (rel, data) => {
  fs.writeFileSync(path.join(root, rel), `${JSON.stringify(data, null, 2)}\n`);
};

const previous = fs.existsSync(localePath) ? readJson('locales/en.json') : { lines: [] };
const prevById = new Map((previous.lines ?? []).map((row) => [row.id, row]));

const lines = [];
const seen = new Set();

const add = (row) => {
  if (!row.id || seen.has(row.id)) return;
  seen.add(row.id);
  const prior = prevById.get(row.id);
  const entry = {
    id: row.id,
    type: row.type,
    speaker: row.speaker ?? prior?.speaker ?? '',
    text: row.text ?? prior?.text ?? '',
    audio: row.audio ?? prior?.audio ?? '',
  };
  const audioText = String(prior?.audioText ?? row.audioText ?? '').trim();
  if (audioText) entry.audioText = audioText;
  const performance = String(prior?.performance ?? row.performance ?? '').trim();
  if (performance && performance !== 'default') entry.performance = performance;
  const audioPerformance = String(prior?.audioPerformance ?? row.audioPerformance ?? '').trim();
  if (audioPerformance) entry.audioPerformance = audioPerformance;
  const audioVoice = String(prior?.audioVoice ?? row.audioVoice ?? '').trim();
  if (audioVoice) entry.audioVoice = audioVoice;
  entry.note = row.note ?? prior?.note ?? '';
  lines.push(entry);
};

const pad = (n) => String(n).padStart(2, '0');
const nameOf = (speaker) => {
  const key = String(speaker ?? '').trim().toLowerCase();
  if (key === 'voss') return 'Voss';
  if (key === 'hale') return 'Hale';
  if (key === 'pierce') return 'Pierce';
  return String(speaker ?? '');
};

const phone = readJson('src/story/phone.json');

const takeCallLine = (entry, id, note) => {
  const prior = entry.line ? prevById.get(entry.line) : null;
  add({
    id,
    type: 'phone',
    speaker: nameOf(entry.speaker ?? prior?.speaker),
    text: entry.text ?? prior?.text ?? '',
    audio: entry.audio ?? prior?.audio ?? '',
    note,
  });
  const duration = entry.duration;
  return { line: id, duration };
};

for (const [callId, call] of Object.entries(phone.calls ?? {})) {
  call.lines = call.lines.map((entry, index) => takeCallLine(
    entry,
    `phone.${callId}.${pad(index + 1)}`,
    `Incoming call ${callId}`,
  ));
}

for (const [objective, contacts] of Object.entries(phone.byObjective ?? {})) {
  for (const [contact, call] of Object.entries(contacts)) {
    call.lines = call.lines.map((entry, index) => takeCallLine(
      entry,
      `phone.${objective}.${contact}.${pad(index + 1)}`,
      `Outbound call, objective ${objective}, ${nameOf(contact)}`,
    ));
  }
}

for (const [textId, message] of Object.entries(phone.texts ?? {})) {
  const prior = message.line ? prevById.get(message.line) : null;
  const id = `text.${textId}`;
  add({
    id,
    type: 'text',
    speaker: nameOf(message.contact),
    text: message.text ?? prior?.text ?? '',
    audio: '',
    note: `Phone text ${textId}`,
  });
  message.line = id;
  delete message.text;
}

writeJson('src/story/phone.json', phone);

const cutsceneDir = path.join(root, 'cutscenes');
for (const file of fs.readdirSync(cutsceneDir).filter((name) => name.endsWith('.json'))) {
  const rel = `cutscenes/${file}`;
  const scene = readJson(rel);
  let lineN = 0;
  let hudN = 0;
  let itemN = 0;
  for (const event of scene.events ?? []) {
    if (event.type === 'line' && (event.text || event.audio || event.line)) {
      lineN += 1;
      const id = event.line || `dialogue.${scene.id}.${pad(lineN)}`;
      const prior = prevById.get(id);
      add({
        id,
        type: 'dialogue',
        speaker: event.speaker || prior?.speaker || '',
        text: event.text ?? prior?.text ?? '',
        audio: event.audio ?? prior?.audio ?? '',
        note: `${scene.name || scene.id} at ${event.at}s`,
      });
      event.line = id;
      delete event.speaker;
      delete event.text;
      delete event.audio;
    } else if (event.type === 'hud' && (event.title || event.text || event.line)) {
      hudN += 1;
      const id = event.line || `hud.${scene.id}.${pad(hudN)}`;
      const prior = prevById.get(id);
      add({
        id,
        type: 'hud',
        speaker: event.title ?? prior?.speaker ?? '',
        text: event.text ?? prior?.text ?? '',
        audio: '',
        note: `${scene.name || scene.id} card at ${event.at}s`,
      });
      event.line = id;
      delete event.title;
      delete event.text;
    } else if (event.type === 'carry' && (event.title || event.text || event.line)) {
      itemN += 1;
      const id = event.line || `item.scene.${scene.id}.${pad(itemN)}`;
      const prior = prevById.get(id);
      add({
        id,
        type: 'item',
        speaker: event.title ?? prior?.speaker ?? '',
        text: event.text ?? prior?.text ?? '',
        audio: '',
        note: `${scene.name || scene.id} inventory`,
      });
      event.line = id;
      delete event.title;
      delete event.text;
    }
  }
  writeJson(rel, scene);
}

const act = readJson('src/story/act1.json');
for (const [id, row] of Object.entries(act.objectives ?? {})) {
  add({
    id: `objective.${id}`,
    type: 'objective',
    speaker: row.title,
    text: row.text,
    audio: '',
    note: `Objective ${id}. speaker is the short title.`,
  });
}
for (const [bag, items] of Object.entries(act.carry ?? {})) {
  for (const item of items) {
    add({
      id: `item.${bag}.${item.id}`,
      type: 'item',
      speaker: item.name,
      text: item.note,
      audio: '',
      note: `Inventory while carry is ${bag}. speaker is the item name.`,
    });
  }
}
for (const [id, row] of Object.entries(act.complete ?? {})) {
  add({
    id: `ui.complete.${id}`,
    type: 'ui',
    speaker: row.title,
    text: row.text,
    audio: '',
    note: `Level complete card for ${id}`,
  });
}

const extra = [
  ['dialogue.return.office', 'dialogue', 'Pierce', 'I need to get back to the office. There is still work on the desk, and I am not leaving it overnight.', '/assets/audio/cutscenes/return-walk/01-pierce-office.wav', 'The Return, walking out of the vat room'],
  ['dialogue.return.home', 'dialogue', 'Pierce', 'Finish it. Then I go home. That is the rest of the day.', '/assets/audio/cutscenes/return-walk/02-pierce-home.wav', 'The Return, second line in the vat room'],
  ['dialogue.return.bright', 'dialogue', 'Pierce', 'Why is the hall this bright? I can see the whole length of it.', '/assets/audio/cutscenes/return-walk/03-pierce-bright.wav', 'The Return, north end of the pipe hall'],
  ['dialogue.return.lamps', 'dialogue', 'Pierce', 'I did not turn a light on. B3 does not look like this.', '/assets/audio/cutscenes/return-walk/04-pierce-lamps.wav', 'The Return, after the bright line'],
  ['dialogue.return.mirror', 'dialogue', 'Pierce', "That's me. I'm not seeing things.", '/assets/audio/cutscenes/return-mirror/01-pierce-thats-me.wav', 'The Return, look in the mirror'],
  ['objective.desk.look', 'objective', 'Look', 'The hall bathroom. The mirror.', '', 'The Desk, opening objective'],
  ['dialogue.desk.accept', 'dialogue', 'Pierce Hawkes', 'Look at this. Nobody is going to accept me. Not looking like this.', '/assets/audio/cutscenes/going-home/04-pierce-accept.wav', 'The Desk, at the mirror'],
  ['dialogue.desk.nature', 'dialogue', 'Pierce Hawkes', 'That is just human nature. People decide what you are before you ever speak.', '/assets/audio/cutscenes/going-home/05-pierce-nature.wav', 'The Desk, after the mirror'],
  ['dialogue.desk.still', 'dialogue', 'Pierce Hawkes', "It's all still here. I was supposed to finish this.", '/assets/audio/cutscenes/the-desk/01-pierce-still-here.wav', 'The Desk, at the desk'],
  ['dialogue.desk.going', 'dialogue', 'Pierce Hawkes', 'I am not staying here to be stared at. I am going home.', '/assets/audio/cutscenes/going-home/06-pierce-home.wav', 'The Desk, leaving'],
  ['dialogue.home.scream', 'dialogue', 'Receptionist', 'Ah! Oh my god!', '/assets/audio/cutscenes/going-home/01-receptionist-scream.wav', 'Going Home lobby'],
  ['dialogue.home.police', 'dialogue', 'Receptionist', "Security! I'm calling the police!", '/assets/audio/cutscenes/going-home/02-receptionist-police.wav', 'Going Home lobby'],
  ['dialogue.home.not-up', 'dialogue', 'Pierce Hawkes', "I'm not going back up.", '/assets/audio/cutscenes/going-home/03-pierce-not-going-up.wav', 'Going Home lobby'],
  ['shout.street.police', 'shout', 'Police', 'Stop! Stay where you are!', '/assets/audio/street/police-stop.wav', 'Going Home, the police pair'],
  ['shout.street.pedestrian', 'shout', 'Passerby', '', '/assets/audio/street/pedestrian-away.wav', 'Street scream. Subtitle uses Passerby. The clip has no separate sentence.'],
  ['dialogue.station.me', 'dialogue', 'Pierce', 'Wait. Is that me?', '/assets/audio/cutscenes/station-shadow/01-pierce-is-that-me.wav', 'The Station opening'],
  ['dialogue.station.here', 'dialogue', 'Pierce', "How am I talking to him if I'm standing here?", '/assets/audio/cutscenes/station-shadow/02-pierce-standing-here.wav', 'The Station opening'],
  ['dialogue.station.uptown', 'dialogue', 'Pierce', 'You heading uptown?', '/assets/audio/cutscenes/station-shadow/03-pierce-uptown.wav', 'The Station, shadow Pierce'],
  ['dialogue.station.mine', 'dialogue', 'Passerby', "Yeah. This one's mine.", '/assets/audio/cutscenes/station-shadow/04-man-this-one.wav', 'The Station, the commuter'],
  ['dialogue.station.seat', 'dialogue', 'Pierce', 'Save me a seat.', '/assets/audio/cutscenes/station-shadow/05-pierce-seat.wav', 'The Station, shadow Pierce'],
  ['dialogue.station.left', 'dialogue', 'Passerby', "If there's one left.", '/assets/audio/cutscenes/station-shadow/06-man-one-left.wav', 'The Station, the commuter'],
  ['bark.street.cold', 'bark', 'Passerby', 'Cold out here.', '/assets/audio/street/bark-cold.wav', 'Street bark'],
  ['bark.street.walk', 'bark', 'Passerby', 'Keep walking.', '/assets/audio/street/bark-walk.wav', 'Street bark'],
  ['bark.street.tower', 'bark', 'Passerby', 'You see that tower?', '/assets/audio/street/bark-tower.wav', 'Street bark'],
  ['bark.street.hear', 'bark', 'Passerby', 'Did you hear that?', '/assets/audio/street/bark-hear.wav', 'Street bark'],
  ['bark.street.open', 'bark', 'Shopkeeper', "We're still open.", '/assets/audio/street/bark-open.wav', 'Shopkeeper'],
  ['bark.street.talk-tower', 'bark', 'Passerby', 'You hear about the tower?', '/assets/audio/street/talk-tower-a.wav', 'Two people talking'],
  ['objective.home.station', 'objective', 'The station', 'Stairs down, a few blocks east. Tab switches Punch and Kick. C is Shadow mode.', '', 'Going Home, after the tutorial'],
  ['objective.home.linked', 'objective', 'Shadow Link', 'WASD walks them. Click kills. Tab switches the ability.', '', 'Going Home, while linked'],
  ['objective.home.shadow', 'objective', 'Shadow mode', 'Tab switches the ability. Q raises the hands.', '', 'Going Home, Shadow mode on, hands down'],
  ['objective.home.link', 'objective', 'Shadow Link', 'Aim at them. Click uses Possess.', '', 'Going Home, hands raised'],
  ['objective.home.switch', 'objective', 'Switch', 'Switch to {name} with Tab or Switch Ability, then use it on a passerby. Stay in Shadow mode.', '', 'Going Home tutorial, second ability. {name} is the other ability.'],
  ['objective.home.first', 'objective', 'Shadow mode', 'Turn Shadow mode on with C or the Shadow button, then use {name} on a passerby.', '', 'Going Home tutorial, first step. {name} is the selected ability.'],
  ['objective.station.link-walk', 'objective', 'Shadow Link', 'WASD walks them. Click kills. Tab switches the ability.', '', 'The Station, while linked'],
  ['objective.station.shadow', 'objective', 'Shadow mode', 'Tab switches the ability. Q raises the hands.', '', 'The Station, Shadow mode on'],
  ['objective.station.link-aim', 'objective', 'Shadow Link', 'Aim at them. Click uses Possess.', '', 'The Station, hands raised'],
  ['objective.station.train', 'objective', 'The train', 'The open door, down the platform. Tab switches the ability.', '', 'The Station, main objective'],
  ['ui.complete.desk', 'ui', 'Level Complete', 'The work is on the floor. Continue. He is going home.', '', 'The Desk complete card'],
  ['ui.complete.going-home', 'ui', 'Level Complete', 'The stairs go down. Continue. The station is waiting.', '', 'Going Home complete card'],
  ['ui.complete.station', 'ui', 'Level Complete', 'The train is waiting. There is nowhere else to go.', '', 'The Station complete card'],
  ['ui.mission.call-voss', 'ui', 'Call Voss', 'Dial Voss and get through.', '', 'Side quest'],
  ['ui.mission.call-hale', 'ui', 'Call Hale', 'Dial Hale and get through.', '', 'Side quest'],
  ['ui.mission.power-shadow', 'ui', 'Shadow mode', 'Press C. While it is on, people lose you.', '', 'Going Home side quest'],
  ['ui.mission.power-shock', 'ui', 'Shadow Shock', 'Turn Shadow mode on. Select Shadow Shock. Click someone in front.', '', 'Going Home side quest'],
  ['ui.mission.power-possess', 'ui', 'Possess', 'Turn Shadow mode on. Select Possess. Click someone in front.', '', 'Going Home side quest'],
  ['ui.mission.power-consume', 'ui', 'Consume', 'While linked, in Shadow mode, click again.', '', 'Going Home side quest'],
  ['item.home.phone', 'item', 'Phone', 'It still rings. He is not picking it up.', '', 'Going Home inventory'],
  ['item.home.sidearm', 'item', 'Sidearm', 'Q draws it, until Shadow mode.', '', 'Going Home inventory'],
  ['item.home.shove', 'item', 'Shove', 'In Shadow mode, select Shadow Shock, then click someone in front.', '', 'Going Home inventory'],
  ['item.home.shadow', 'item', 'Shadow mode', 'C or the Shadow button turns it on. Powers only work while it is on.', '', 'Going Home inventory'],
  ['item.desk.phone', 'item', 'Phone', 'He is not picking it up.', '', 'The Desk inventory'],
  ['item.desk.sidearm', 'item', 'Sidearm', 'Still holstered. The work is what he came for.', '', 'The Desk inventory'],
  ['item.station.phone', 'item', 'Phone', 'No signal this far down.', '', 'The Station inventory'],
  ['item.station.sidearm', 'item', 'Sidearm', 'Q draws it, until Shadow mode.', '', 'The Station inventory'],
  ['item.station.shadow', 'item', 'Shadow mode', 'C or the Shadow button turns it on. Powers only work while it is on.', '', 'The Station inventory'],
];

for (const [id, type, speaker, text, audio, note] of extra) {
  const prior = prevById.get(id);
  add({
    id,
    type: prior?.type || type,
    speaker: prior?.speaker || speaker,
    text: prior?.text || text,
    audio: prior?.audio || audio,
    note: prior?.note || note,
  });
}

const creditSource = fs.readFileSync(path.join(root, 'src/story/credits.ts'), 'utf8');
const levelRe = /(\d+):\s*\{([\s\S]*?)\n  \},/g;
let levelMatch;
while ((levelMatch = levelRe.exec(creditSource))) {
  const level = levelMatch[1];
  const body = levelMatch[2];
  for (const side of ['left', 'right']) {
    const sideRe = new RegExp(`${side}:\\s*\\[([\\s\\S]*?)\\n    \\],`);
    const sideMatch = sideRe.exec(body);
    if (!sideMatch) continue;
    const blocks = [...sideMatch[1].matchAll(/role:\s*'([^']*)',\s*names:\s*\[([\s\S]*?)\]/g)];
    blocks.forEach((block, bi) => {
      add({
        id: `credit.${level}.${side}.${bi}.role`,
        type: 'credit',
        speaker: '',
        text: block[1],
        audio: '',
        note: `Level ${level} ${side} column title`,
      });
      const names = [...block[2].matchAll(/'([^']*)'/g)].map((hit) => hit[1]);
      names.forEach((text, ni) => {
        add({
          id: `credit.${level}.${side}.${bi}.${ni}`,
          type: 'credit',
          speaker: block[1],
          text,
          audio: '',
          note: `Level ${level} ${side} column`,
        });
      });
    });
  }
}

fs.mkdirSync(path.dirname(localePath), { recursive: true });
writeJson('locales/en.json', { locale: 'en', lines });
console.log(`wrote ${lines.length} lines`);
