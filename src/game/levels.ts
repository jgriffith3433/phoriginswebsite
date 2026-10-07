import type { LevelDefinition } from './types';

const DEFAULT_LEVELS: LevelDefinition[] = [
  {
    id: 1,
    name: 'Training Grounds',
    difficulty: 1,
    enemyCount: 4,
    spawnRate: 2.2,
    playerSpeed: 8.5,
    fireRate: 0.18,
    enemyHp: 1,
    theme: 'Neon Drift',
    reward: 'Starter Gear',
  },
  {
    id: 2,
    name: 'Crimson Courtyard',
    difficulty: 2,
    enemyCount: 6,
    spawnRate: 1.8,
    playerSpeed: 9,
    fireRate: 0.16,
    enemyHp: 1.2,
    theme: 'Crimson Surge',
    reward: 'Heavy Ammo',
  },
  {
    id: 3,
    name: 'Glass District',
    difficulty: 3,
    enemyCount: 8,
    spawnRate: 1.4,
    playerSpeed: 9.4,
    fireRate: 0.14,
    enemyHp: 1.5,
    theme: 'Neon Drift',
    reward: 'Nanoweave',
  },
  {
    id: 4,
    name: 'Storm Channel',
    difficulty: 4,
    enemyCount: 10,
    spawnRate: 1.1,
    playerSpeed: 9.8,
    fireRate: 0.12,
    enemyHp: 1.8,
    theme: 'Arctic Rift',
    reward: 'Energy Cells',
  },
  {
    id: 5,
    name: 'Last Signal',
    difficulty: 5,
    enemyCount: 12,
    spawnRate: 0.9,
    playerSpeed: 10.4,
    fireRate: 0.1,
    enemyHp: 2.1,
    theme: 'Arctic Rift',
    reward: 'Core Key',
  },
];

const LEVELS_JSON = JSON.stringify(DEFAULT_LEVELS);
const LEVELS_KEY = 'ph-origins-levels';

const normalizeLevel = (entry: Partial<LevelDefinition> | undefined, fallbackId: number): LevelDefinition => ({
  id: Number(entry?.id ?? fallbackId),
  name: String(entry?.name ?? `Level ${fallbackId}`),
  difficulty: Number(entry?.difficulty ?? 1),
  enemyCount: Number(entry?.enemyCount ?? 4),
  spawnRate: Number(entry?.spawnRate ?? 1.4),
  playerSpeed: Number(entry?.playerSpeed ?? 8.5),
  fireRate: Number(entry?.fireRate ?? 0.14),
  enemyHp: Number(entry?.enemyHp ?? 1),
  theme: String(entry?.theme ?? 'Neon Drift'),
  reward: String(entry?.reward ?? 'Mission reward'),
});

export const LEVELS: LevelDefinition[] = JSON.parse(LEVELS_JSON) as LevelDefinition[];

export const loadLevels = (): LevelDefinition[] => {
  if (typeof localStorage === 'undefined') return [...LEVELS];

  try {
    const raw = localStorage.getItem(LEVELS_KEY);
    if (!raw) return [...LEVELS];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [...LEVELS];

    return parsed.map((entry, index) => normalizeLevel(entry, index + 1));
  } catch {
    return [...LEVELS];
  }
};

export const saveLevels = (levels: LevelDefinition[]) => {
  const nextLevels = levels.map((level, index) => normalizeLevel(level, index + 1));
  if (typeof localStorage !== 'undefined') localStorage.setItem(LEVELS_KEY, JSON.stringify(nextLevels));
  return nextLevels;
};

export const getLevels = () => loadLevels();

export const getLevelDefinition = (level: number): LevelDefinition => {
  const levels = getLevels();
  const boundedLevel = Math.max(1, Math.min(level, levels.length));
  return normalizeLevel(levels[boundedLevel - 1], boundedLevel);
};

export const getUnlockedLevelCount = (highestUnlocked: number) => {
  const levels = getLevels();
  return Math.max(1, Math.min(highestUnlocked, levels.length));
};
