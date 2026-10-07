import type { InventoryItemType, QuestState } from './types';

export type QuestDefinition = {
  id: string;
  title: string;
  description: string;
  type: 'kills' | 'score' | 'collect';
  target: number;
  rewardItem: InventoryItemType;
  rewardAmount: number;
};

export const MISSION_DEFINITIONS: QuestDefinition[] = [
  {
    id: 'training-sweep',
    title: 'Sweep the Outpost',
    description: 'Defeat 6 hostiles in the ruins.',
    type: 'kills',
    target: 6,
    rewardItem: 'ammo',
    rewardAmount: 4,
  },
  {
    id: 'find-scrap',
    title: 'Scavenge the Corridor',
    description: 'Collect 3 supply drops.',
    type: 'collect',
    target: 3,
    rewardItem: 'scrap',
    rewardAmount: 5,
  },
  {
    id: 'raise-score',
    title: 'Secure the Zone',
    description: 'Reach 250 score.',
    type: 'score',
    target: 250,
    rewardItem: 'medkit',
    rewardAmount: 1,
  },
];

export const createQuestState = (): QuestState[] =>
  MISSION_DEFINITIONS.map((quest) => ({
    id: quest.id,
    title: quest.title,
    description: quest.description,
    type: quest.type,
    target: quest.target,
    current: 0,
    rewardItem: quest.rewardItem,
    rewardAmount: quest.rewardAmount,
    completed: false,
  }));

export const updateQuestProgress = (quest: QuestState, amount: number) => {
  if (quest.completed) return quest;
  quest.current = Math.min(quest.target, quest.current + amount);
  if (quest.current >= quest.target) {
    quest.completed = true;
  }
  return quest;
};

export const getGoalText = (quest: QuestState) => `${quest.title}: ${quest.current}/${quest.target}`;
