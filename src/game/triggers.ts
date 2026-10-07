import type { PlayerState } from './types';
import type { SceneTrigger } from './sceneData';

export type TriggerHandler = (trigger: SceneTrigger) => void;

export const createTriggerRunner = (onEnter: TriggerHandler) => {
  let triggers: SceneTrigger[] = [];
  const fired = new Set<string>();

  const bind = (next: SceneTrigger[]) => {
    triggers = next;
    fired.clear();
  };

  const update = (player: PlayerState) => {
    for (const trigger of triggers) {
      if (fired.has(trigger.id)) continue;
      const radius = Number(trigger.data?.radius ?? 1.7);
      const x = trigger.x ?? trigger.position?.x ?? 0;
      const z = trigger.z ?? trigger.position?.z ?? 0;
      const dx = player.x - x;
      const dz = player.z - z;
      if (dx * dx + dz * dz <= radius * radius) {
        fired.add(trigger.id);
        onEnter(trigger);
      }
    }
  };

  return { bind, update, reset: () => fired.clear() };
};
