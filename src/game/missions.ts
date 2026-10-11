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

const callQuests = (): MissionQuest[] => [
  { id: 'call-voss', group: 'side', title: 'Call Voss', detail: 'Dial Voss and get through.' },
  { id: 'call-hale', group: 'side', title: 'Call Hale', detail: 'Dial Hale and get through.' },
];

const powerQuests = (): MissionQuest[] => [
  { id: 'power-shadow', group: 'side', title: 'Shadow mode', detail: 'Press C. While it is on, people lose you.' },
  { id: 'power-shock', group: 'side', title: 'Shadow Shock', detail: 'Turn Shadow mode on. Select Shadow Shock. Click someone in front.' },
  { id: 'power-possess', group: 'side', title: 'Possess', detail: 'Turn Shadow mode on. Select Possess. Click someone in front.' },
  { id: 'power-consume', group: 'side', title: 'Consume', detail: 'While linked, in Shadow mode, click again.' },
];

/** Side work that counts toward clearing a level. The city teaches the powers. The earlier levels are the calls. */
export const missionsFor = (libraryId: string): MissionQuest[] => {
  if (libraryId === 'going-home') return [mainQuest(), ...powerQuests()];
  if (libraryId === 'apex-peak' || libraryId === 'b3-basement' || libraryId === 'the-return' || libraryId === 'the-desk') {
    return [mainQuest(), ...callQuests()];
  }
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
