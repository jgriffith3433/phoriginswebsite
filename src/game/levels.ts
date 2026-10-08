import type { LevelDefinition } from './types';

export const LEVEL_LIBRARY_PATH = '/levels/level-library.json';

export const MISSION_SELECT_SLOTS = 3;

type LibraryEntry = {
  id?: string;
  name?: string;
  path?: string;
  theme?: string;
  difficulty?: number;
  reward?: string;
  enemyCount?: number;
  combat?: boolean;
  spawnRate?: number;
  playerSpeed?: number;
  fireRate?: number;
  enemyHp?: number;
  arenaSize?: number;
  comingSoon?: boolean;
};

const combatFromDifficulty = (difficulty: number) => ({
  enemyCount: 2 + difficulty * 2,
  spawnRate: Math.max(0.7, 2.6 - difficulty * 0.45),
  playerSpeed: 5.2 + difficulty * 0.25,
  fireRate: Math.max(0.1, 0.2 - difficulty * 0.025),
  enemyHp: 0.8 + difficulty * 0.35,
});

const FALLBACK_LIBRARY: LibraryEntry[] = [
  { id: 'apex-peak', name: 'The Apex Peak', path: '/levels/apex-peak.json', theme: 'Apex Peak', difficulty: 1, enemyCount: 0, combat: false, playerSpeed: 3.4, arenaSize: 140, reward: 'Room for Grace' },
  { id: 'b3-basement', name: 'B3', path: '/levels/b3-basement.json', theme: 'B3 Basement', difficulty: 2, enemyCount: 0, combat: false, playerSpeed: 3.4, arenaSize: 140, reward: 'The vat' },
  { id: 'arctic-rift', path: '/levels/arctic-rift.json', comingSoon: true },
];

const normalizeLevel = (entry: LibraryEntry | Partial<LevelDefinition> | undefined, index: number): LevelDefinition => {
  const difficulty = Math.max(1, Number(entry?.difficulty ?? index));
  const combat = combatFromDifficulty(difficulty);
  const libraryId = String((entry as LibraryEntry)?.id ?? (entry as LevelDefinition)?.libraryId ?? `level-${index}`);
  const comingSoon = entry?.comingSoon === true;
  return {
    id: index,
    libraryId,
    comingSoon,
    path: String(entry?.path ?? `/levels/${libraryId}.json`),
    name: comingSoon ? `Level ${index}` : String(entry?.name ?? `Level ${index}`),
    difficulty,
    enemyCount: Number(entry?.enemyCount ?? combat.enemyCount),
    combat: entry?.combat === true || (entry?.combat !== false && Number(entry?.enemyCount ?? combat.enemyCount) > 0),
    spawnRate: Number(entry?.spawnRate ?? combat.spawnRate),
    playerSpeed: Number(entry?.playerSpeed ?? combat.playerSpeed),
    fireRate: Number(entry?.fireRate ?? combat.fireRate),
    enemyHp: Number(entry?.enemyHp ?? combat.enemyHp),
    theme: String(entry?.theme ?? 'Neon Drift'),
    reward: String(entry?.reward ?? 'Mission reward'),
    arenaSize: Number(entry?.arenaSize ?? 90),
  };
};

let cachedLevels: LevelDefinition[] = FALLBACK_LIBRARY.map((entry, index) => normalizeLevel(entry, index + 1));
let loadPromise: Promise<LevelDefinition[]> | null = null;

const parseLibrary = (payload: unknown): LevelDefinition[] => {
  const entries = Array.isArray((payload as { levels?: unknown })?.levels)
    ? (payload as { levels: LibraryEntry[] }).levels
    : Array.isArray(payload)
      ? (payload as LibraryEntry[])
      : [];
  const source = entries.length === 0 ? FALLBACK_LIBRARY : entries;
  const levels = source.map((entry, index) => normalizeLevel(entry, index + 1));
  while (levels.length < MISSION_SELECT_SLOTS) {
    const index = levels.length + 1;
    levels.push(normalizeLevel({ id: `coming-soon-${index}`, comingSoon: true }, index));
  }
  return levels;
};

export const loadLevelLibrary = async (): Promise<LevelDefinition[]> => {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const response = await fetch(LEVEL_LIBRARY_PATH, { cache: 'no-store' });
      if (!response.ok) return cachedLevels;
      cachedLevels = parseLibrary(await response.json());
      return cachedLevels;
    } catch {
      return cachedLevels;
    }
  })();
  return loadPromise;
};

export const getLevels = () => cachedLevels;

export const getLevelDefinition = (level: number): LevelDefinition => {
  const levels = getLevels();
  const boundedLevel = Math.max(1, Math.min(level, levels.length));
  return levels[boundedLevel - 1] ?? normalizeLevel(FALLBACK_LIBRARY[0], 1);
};

export const getPlayableLevelCount = () => {
  const playable = getLevels().filter((level) => !level.comingSoon).length;
  return Math.max(1, playable);
};

export const getUnlockedLevelCount = (highestUnlocked: number) => {
  return Math.max(1, Math.min(highestUnlocked, getPlayableLevelCount()));
};
