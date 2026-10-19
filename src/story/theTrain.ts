import type { LevelCredits } from './credits';
import type { StoryCarry } from './act1';
import type { TrainDress } from './trainDress';
import { carryItems, lineSpeaker, lineText } from '../game/locale';

/**
 * Level 7, The Train (hidden: `comingSoon` in levels/level-library.json until the level is written).
 *
 * Placeholder script: Pierce stands at the back of the car and has control at once; the objective is the front
 * of the car. The car itself (seats, poles, ads, tunnel, sway) is the runtime kit in trainDress.ts, mounted by
 * levelDressing. main.ts already calls everything below at the same moments as The Station's script (mount,
 * onStart, step, playing/skip for a scripted scene, objectiveKey, finish -> offerEnd, credits, ending song), so the
 * level-7 tasks fill in this file and need no main.ts change.
 *
 * Story direction (AGENTS.md, Level 7): Pierce walks the cars toward his old, untransformed body, which gets off at
 * a stop and doesn't look back. Never explained.
 */

export type TheTrainHost = {
  running: () => boolean;
  placePierce: (x: number, z: number, yaw: number) => void;
  playClip: (clip: string, loop: boolean, speed?: number, onEnded?: () => void) => void;
  resumeLocomotion: () => void;
  fade: (to: number, seconds?: number) => void;
  setObjective: (title: string, text: string, target: { x: number; z: number; y?: number } | null) => void;
  showObjective: (visible: boolean) => void;
  clearMarker: () => void;
  playFile: (url: string, volume: number) => void;
  setWalk: (moving: boolean) => void;
  setCarry: (items: StoryCarry[]) => void;
  showMessage: (title: string, text: string) => void;
  /** Offers End Level; the press plays `ENDING_TRACK` and rolls `TRAIN_CREDITS`. */
  offerEnd: (title: string, text: string) => void;
  clearInput: () => void;
  unlockNext: () => void;
  refreshHud: () => void;
  holster: () => void;
  player: () => { x: number; z: number; yaw: number };
  frameCamera: (position: { x: number; y: number; z: number }, lookAt: { x: number; y: number; z: number }) => void;
  releaseCamera: () => void;
  showLine: (title: string, text: string) => void;
  holdScene: (held: boolean) => void;
  ringCall: (id: string) => void;
  /** The car kit (tunnel speed for a stop, stats); null in a frame where the level is not dressed. */
  car: () => TrainDress | null;
};

/** The back of the car, facing the front (+x). */
export const TRAIN_SPAWN = { x: 1.0, z: 0, yaw: Math.PI / 2 };
/** The front end door. */
const FRONT = { x: 17.3, z: 0 };

const CARRY: StoryCarry[] = [
  { id: 'phone', name: 'Phone', note: 'No signal in the tunnel.' },
  { id: 'sidearm', name: 'Sidearm', note: 'Q draws it.' },
];

/** End-of-level credit crawl for level 7. Null rolls none; the level-7 story task writes it. */
export const TRAIN_CREDITS: LevelCredits | null = null;
/** The decision for now: level 7 ends on The Station's song. */
export const ENDING_TRACK = '/assets/audio/ending-6.mp3';

export const createTheTrain = (host: TheTrainHost) => {
  let active = false;
  let finished = false;
  let playing = false;

  const showGoal = () => {
    host.setObjective(lineSpeaker('objective.train.front', 'The train'), lineText('objective.train.front'), { x: FRONT.x, y: 1.3, z: FRONT.z });
  };

  return {
    objectiveKey: () => 'train',
    mount: async () => {
      active = true;
      finished = false;
      playing = false;
    },
    onStart: () => {
      if (!active) return;
      host.setCarry(carryItems('train', CARRY));
      host.placePierce(TRAIN_SPAWN.x, TRAIN_SPAWN.z, TRAIN_SPAWN.yaw);
      host.fade(0, 1.1);
      showGoal();
      host.showObjective(true);
      host.refreshHud();
    },
    /** The E prompt (null for none), and what pressing it does. */
    action: (): string | null => null,
    confirm: () => {},
    /** A scripted scene is running (input held, Skip offered). */
    playing: () => playing,
    skip: () => {
      playing = false;
    },
    step: (dt: number) => {
      if (!active || finished || dt <= 0) return;
    },
    dispose: () => {
      active = false;
      playing = false;
    },
  };
};

export type TheTrain = ReturnType<typeof createTheTrain>;
