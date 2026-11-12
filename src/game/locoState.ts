/**
 * Pierce locomotion phases: start, stop, turn-in-place (90 / 180) and a stairs hint.
 * Plays the matching clip when the avatar has it; otherwise keeps speed-matched walk/idle
 * with a short rotate-before-translate window so planted feet do not skate.
 */

export type LocoPhase = 'idle' | 'start' | 'walk' | 'stop' | 'turn90' | 'turn180' | 'stairs';

export type LocoDecision = {
  phase: LocoPhase;
  /** Multiplier on ground speed (start ramps up, stop ramps down). */
  speedScale: number;
  /** When true, hold translation this frame (turn-in-place). */
  holdMove: boolean;
  /** Clip keyword to play once when the phase begins (null = leave locomotion alone). */
  oneshot: string | null;
  /** Target facing during a turn, or null. */
  faceYaw: number | null;
};

const START_S = 0.22;
const STOP_S = 0.28;
const TURN_S = 0.45;
/** Yaw error (rad) that triggers a turn-in-place instead of a skating pivot. */
const TURN_ENTER = 0.85;
const TURN_180 = 2.4;
/** Close enough to release the hold and walk. */
const TURN_RELEASE = 0.35;

const groundish = (p: LocoPhase) =>
  p === 'idle' || p === 'stop' || p === 'start' || p === 'turn90' || p === 'turn180';

const angleDelta = (from: number, to: number) => {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export const createLocoState = () => {
  let phase: LocoPhase = 'idle';
  let age = 0;
  let turnTarget: number | null = null;
  let lastMoving = false;
  let oneshotArmed: string | null = null;

  const enter = (next: LocoPhase, shot: string | null = null) => {
    if (phase === next) return;
    phase = next;
    age = 0;
    oneshotArmed = shot;
  };

  const step = (opts: {
    moving: boolean;
    moveHeading: number | null;
    faceYaw: number;
    grounded: boolean;
    /** Absolute vertical speed; stairs are a grounded walk with a non-zero climb. */
    climbRate: number;
    hasClip: (keyword: string) => boolean;
    delta: number;
  }): LocoDecision => {
    const { moving, moveHeading, faceYaw, grounded, climbRate, hasClip, delta } = opts;
    age += delta;
    let speedScale = 1;
    let holdMove = false;
    let face: number | null = null;
    let oneshot: string | null = null;

    const yawErr = moveHeading === null ? 0 : Math.abs(angleDelta(faceYaw, moveHeading));
    // Turn in place from a standstill, or when the stick asks for a sharp pivot while nearly stopped /
    // already turning. Mid-walk sharps still turn the body; only a big error while slow holds translation.
    const slowEnough = !lastMoving || groundish(phase) || yawErr > TURN_180;
    const wantTurn = grounded && moving && moveHeading !== null && yawErr > TURN_ENTER && slowEnough;

    if (!grounded) {
      enter('walk');
      lastMoving = moving;
      return { phase, speedScale: 1, holdMove: false, oneshot: null, faceYaw: null };
    }

    // Stairs: keep walking; stairs-up clip is optional flavour when climbing.
    if (moving && Math.abs(climbRate) > 0.55 && phase !== 'turn90' && phase !== 'turn180') {
      if (climbRate > 0.55 && hasClip('stairsup')) {
        if (phase !== 'stairs') enter('stairs', 'stairsUp');
      } else if (phase === 'stairs') {
        enter('walk');
      }
    }

    if (wantTurn) {
      const is180 = yawErr > TURN_180;
      const shot = is180
        ? (hasClip('turn180') ? 'turn180' : null)
        : (hasClip('turn90') ? 'turn90' : null);
      if (phase !== 'turn90' && phase !== 'turn180') enter(is180 ? 'turn180' : 'turn90', shot);
      else if (is180 && phase === 'turn90') enter('turn180', shot);
      turnTarget = moveHeading;
    } else if (moving && (phase === 'idle' || phase === 'stop')) {
      enter('start', hasClip('startwalk') ? 'startWalk' : null);
    } else if (!moving && (phase === 'walk' || phase === 'start' || phase === 'stairs')) {
      enter('stop', hasClip('stop') ? 'stop' : null);
    } else if (!moving && phase === 'stop' && age >= STOP_S) {
      enter('idle');
    } else if (moving && phase === 'start' && age >= START_S) {
      enter('walk');
    } else if ((phase === 'turn90' || phase === 'turn180') && turnTarget !== null) {
      const left = Math.abs(angleDelta(faceYaw, turnTarget));
      if (left < TURN_RELEASE || age >= TURN_S) {
        turnTarget = null;
        enter(moving ? (hasClip('startwalk') ? 'start' : 'walk') : 'idle',
          moving && hasClip('startwalk') ? 'startWalk' : null);
      }
    }

    if (phase === 'start') {
      speedScale = 0.35 + 0.65 * Math.min(1, age / START_S);
    } else if (phase === 'stop') {
      speedScale = Math.max(0, 1 - age / STOP_S);
    } else if (phase === 'turn90' || phase === 'turn180') {
      holdMove = true;
      face = turnTarget;
      speedScale = 0;
    } else if (phase === 'idle') {
      speedScale = 0;
    }

    if (oneshotArmed) {
      oneshot = oneshotArmed;
      oneshotArmed = null;
    }

    lastMoving = moving;
    return { phase, speedScale, holdMove, oneshot, faceYaw: face };
  };

  return {
    step,
    phase: () => phase,
    reset: () => {
      phase = 'idle';
      age = 0;
      turnTarget = null;
      lastMoving = false;
      oneshotArmed = null;
    },
  };
};

export type LocoState = ReturnType<typeof createLocoState>;
