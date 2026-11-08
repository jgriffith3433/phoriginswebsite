/** Clip timing the locomotion code matches to the physics (quality rule 5). No Babylon import: the playtest reads it too. */

/**
 * Planted-foot speed (m/s) of the shared Mixamo locomotion clips at speed 1, measured from the toe bones
 * of the hero and the street NPC rigs (they agree within 0.1 m/s). Re-measure with `npm run models:stride`.
 */
export const STRIDE_MPS: Readonly<Record<string, number>> = { walk: 1.72, pistolwalk: 2.4, run: 3.6 };
const STRIDE_MIN = 0.35;
const STRIDE_MAX = 2.6;
export const strideRatio = (clip: string, metresPerSecond: number) =>
  Math.min(STRIDE_MAX, Math.max(STRIDE_MIN, metresPerSecond / (STRIDE_MPS[clip] ?? STRIDE_MPS.walk)));

/**
 * Seconds into the Mixamo Jump clips for each pose of setJumpPose: crouch bottom, takeoff, apex,
 * touchdown, settled. The clips spend 0.85 s crouching before the feet leave the floor, so playing
 * them on their own clock showed a crouch in mid-air and a standing landing.
 */
export const JUMP_KEYS: Readonly<Record<string, readonly number[]>> = {
  jump: [0.6, 0.85, 1.1, 1.3, 1.7],
  pistoljump: [0.55, 0.85, 1.12, 1.4, 1.75],
};
