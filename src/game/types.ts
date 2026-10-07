export type InventoryItemType = 'medkit' | 'ammo' | 'scrap' | 'power_core';

export type PlayerState = {
  x: number;
  y: number;
  z: number;
  velocityY: number;
  grounded: boolean;
};

export type InventoryState = {
  slots: number;
  items: Record<InventoryItemType, number>;
};

export type LevelDefinition = {
  id: number;
  libraryId: string;
  path: string;
  name: string;
  difficulty: number;
  enemyCount: number;
  combat: boolean;
  spawnRate: number;
  playerSpeed: number;
  fireRate: number;
  enemyHp: number;
  theme: string;
  reward: string;
  arenaSize: number;
};

export type ProgressionState = {
  currentLevel: number;
  highestUnlocked: number;
  xp: number;
  medals: number;
};

export type QuestType = 'kills' | 'score' | 'collect';

export type QuestState = {
  id: string;
  title: string;
  description: string;
  type: QuestType;
  target: number;
  current: number;
  rewardItem?: InventoryItemType;
  rewardAmount?: number;
  completed: boolean;
};
