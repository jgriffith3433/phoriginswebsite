import { JUMP_SPEED, JUMP_WINDUP } from './player';
import type { PlayerState } from './types';

/** A step down shorter than this keeps walking (stairs, a kerb); a longer fall shows the jump pose. */
export const JUMP_COYOTE = 0.12;
/** Seconds of the landing settle when he lands standing still. */
export const LAND_SETTLE = 0.3;

/**
 * Jump pose from the physics for playerAvatar.setJumpPose (quality rule 5): 0..1 windup, 1..2 rising,
 * 2..3 falling, 3..4 landing settle; null is plain locomotion. The airborne pose starts on the hop or
 * after JUMP_COYOTE of falling and ends on the grounded transition, not on the clip's own clock.
 */
export const createJumpPoser = () => {
  let airTime = 0;
  let showing = false;
  let landing = -1;

  const reset = (): null => {
    airTime = 0;
    showing = false;
    landing = -1;
    return null;
  };

  const step = (p: Pick<PlayerState, 'grounded' | 'velocityY' | 'jumpWindup'>, delta: number, moving: boolean): number | null => {
    if (p.jumpWindup > 0) {
      showing = true;
      landing = -1;
      airTime = 0;
      return Math.min(1, Math.max(0, 1 - p.jumpWindup / JUMP_WINDUP));
    }
    if (!p.grounded) {
      airTime += delta;
      landing = -1;
      if (!showing && airTime < JUMP_COYOTE) return null;
      showing = true;
      return p.velocityY > 0
        ? 1 + Math.min(1, 1 - p.velocityY / JUMP_SPEED)
        : 2 + 0.9 * Math.min(1, -p.velocityY / JUMP_SPEED);
    }
    airTime = 0;
    if (showing) {
      showing = false;
      landing = moving ? -1 : 0;
    }
    if (landing < 0) return null;
    if (moving) return reset();
    landing += delta;
    if (landing >= LAND_SETTLE) return reset();
    return 3 + landing / LAND_SETTLE;
  };

  return { step, reset, airTime: () => airTime };
};
