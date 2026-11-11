/** The run goal: every level pays a rank and an unlocked tool when it is finished, and ends on a hook into the next. Copy is in locales/en.json (`reward.N.*`). */
import { lineText } from './locale';

export type LevelReward = { n: number; rank: string; tool: string; hook: string };

export const REWARD_LEVELS = 8;

export const levelReward = (n: number): LevelReward | null => {
  if (n < 1 || n > REWARD_LEVELS) return null;
  const rank = lineText(`reward.${n}.rank`, '');
  const tool = lineText(`reward.${n}.tool`, '');
  if (!rank || !tool) return null;
  return { n, rank, tool, hook: lineText(`reward.${n}.hook`, '') };
};

/** One line for the Missions panel while the level is still open. */
export const goalLine = (n: number) => {
  const reward = levelReward(n);
  return reward ? `${reward.rank} · ${reward.tool}` : '';
};
