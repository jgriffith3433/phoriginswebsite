import { storyLine } from './locale';

export type MissionQuest = {
  id: string;
  group: 'main' | 'side';
  title: string;
  detail: string;
};

const mainQuest = (): MissionQuest => ({
  id: 'main',
  group: 'main',
  title: 'Main',
  detail: '',
});

const sideQuest = (id: string, title: string, detail: string): MissionQuest => {
  const row = storyLine(`ui.mission.${id}`);
  return { id, group: 'side', title: row?.speaker || title, detail: row?.text || detail };
};

const callQuests = (): MissionQuest[] => [
  sideQuest('call-voss', 'Call Voss', 'Dial Voss and get through.'),
  sideQuest('call-hale', 'Call Hale', 'Dial Hale and get through.'),
];

const powerQuests = (): MissionQuest[] => [
  sideQuest('power-shadow', 'Shadow mode', 'Press C. While it is on, people lose you.'),
  sideQuest('power-shock', 'Shadow Shock', 'Turn Shadow mode on. Select Shadow Shock. Click someone in front.'),
  sideQuest('power-possess', 'Possess', 'Turn Shadow mode on. Select Possess. Click someone in front.'),
  sideQuest('power-consume', 'Consume', 'While linked, in Shadow mode, click again.'),
];

/** Side work that counts toward clearing a level. The city teaches the powers. The earlier levels are the calls. */
export const missionsFor = (libraryId: string): MissionQuest[] => {
  if (libraryId === 'going-home') return [mainQuest(), ...powerQuests()];
  if (libraryId === 'apex-peak' || libraryId === 'b3-basement' || libraryId === 'the-return' || libraryId === 'the-desk') {
    return [mainQuest(), ...callQuests()];
  }
  // The Train: Hale calls at the stop (the only signal on the line); picking up, or dialing her there, counts.
  if (libraryId === 'the-train') return [mainQuest(), sideQuest('call-hale', 'Call Hale', 'Dial Hale and get through.')];
  return [mainQuest()];
};

export const missionCallId = (contactId: string) => {
  if (contactId === 'voss') return 'call-voss';
  if (contactId === 'hale') return 'call-hale';
  return '';
};

/** This level still expects a call to this contact, and that side quest is not done. */
export const callQuestOpen = (libraryId: string, contactId: string, done: readonly string[]) => {
  const quest = missionCallId(contactId);
  if (!quest) return false;
  if (!missionsFor(libraryId).some((item) => item.id === quest)) return false;
  return !done.includes(quest);
};

export const missionCount = (libraryId: string, done: readonly string[]) => {
  const quests = missionsFor(libraryId);
  const have = new Set(done);
  const complete = quests.filter((quest) => have.has(quest.id)).length;
  return { complete, total: quests.length };
};

export const missionLabel = (libraryId: string, done: readonly string[]) => {
  const count = missionCount(libraryId, done);
  return `${count.complete}/${count.total}`;
};
