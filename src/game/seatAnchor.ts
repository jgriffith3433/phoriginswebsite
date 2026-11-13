import type { PlayerAvatar } from './playerAvatar';
import { PLAYER_MESH_Y_OFFSET } from './player';

/**
 * Seat anchors: every seated person gets a seat top (the prop's real top surface, metres) and the rig is lifted so
 * the clip's hips land on it, instead of one shared lift that was only right for a 0.50 m office chair.
 *
 * SitIdle puts the hips joint about 0.65 m above the standing foot plane once the rig is raised `SIT_LIFT_REF`
 * (0.08) for a seat 0.50 m high; the hips joint sits about 0.15 m over the sit bones, so on the seat the joint is
 * `SEAT_HIPS_RISE` above its top.
 */
export const SIT_LIFT_REF = 0.08;
export const SEAT_REF_TOP = 0.5;
export const SEAT_HIPS_RISE = 0.15;

/** Seat tops of the props people sit on (their real tops). */
export const SEAT_TOPS = {
  officeChair: 0.5,
  trainBench: 0.45,
  sofa: 0.45,
  bed: 0.5,
} as const;

/** Rig offset (relative to the standing offset) that puts SitIdle's hips on a seat of this height. */
export const seatLift = (top: number) => SIT_LIFT_REF + (top - SEAT_REF_TOP);

/** Group Y (in the capsule's frame) for a rig seated on `top`. */
export const seatedGroupY = (top: number) => -PLAYER_MESH_Y_OFFSET + seatLift(top);
export const standingGroupY = () => -PLAYER_MESH_Y_OFFSET;

const ease = (k: number) => k * k * (3 - 2 * k);

export type SeatPhase = 'standing' | 'sitting-down' | 'seated' | 'getting-up';

/** Sit-down and get-up take this long: the pelvis follows the clip change instead of snapping. */
export const SEAT_TRANSITION_SECONDS = 0.9;

export type SeatBlend = {
  phase: () => SeatPhase;
  /** Start seated (no transition): the person was already there when the scene began. */
  setSeated: (top: number) => void;
  /** Sit down on a seat of this top: SitIdle blends in while the pelvis settles onto it. */
  sitDown: (top: number, clip?: string) => void;
  /** Get up: Idle blends back in while the pelvis rises to the floor. */
  getUp: (onStanding?: () => void) => void;
  step: (dt: number) => void;
  /** Hips joint height above the seat top (m), or null before the rig is ready. For the prop-contact probe. */
  hipsAboveSeat: () => number | null;
};

/**
 * Drives the avatar group's Y (a child of the person's capsule) through a sit-down or get-up. The rig's own
 * clip change is the 0.1 s blend `playClip` already does; the pelvis eases over `SEAT_TRANSITION_SECONDS` so the
 * body is never on the seat before the legs fold, and never snaps off it.
 */
export const createSeatBlend = (avatar: PlayerAvatar): SeatBlend => {
  let phase: SeatPhase = 'standing';
  let top = SEAT_REF_TOP;
  let t = 0;
  let from = standingGroupY();
  let to = standingGroupY();
  let seatedClip = 'sit';
  let after: (() => void) | undefined;

  const apply = (y: number) => {
    avatar.group.position.y = y;
  };

  return {
    phase: () => phase,
    setSeated(seatTop) {
      top = seatTop;
      phase = 'seated';
      apply(seatedGroupY(seatTop));
    },
    sitDown(seatTop, clip = 'sit') {
      top = seatTop;
      seatedClip = clip;
      phase = 'sitting-down';
      t = 0;
      from = avatar.group.position.y;
      to = seatedGroupY(seatTop);
      avatar.playClip(clip, true);
    },
    getUp(onStanding) {
      if (phase === 'standing') {
        onStanding?.();
        return;
      }
      phase = 'getting-up';
      t = 0;
      from = avatar.group.position.y;
      to = standingGroupY();
      after = onStanding;
      avatar.setLocomotion(false, true);
    },
    step(dt) {
      if (phase !== 'sitting-down' && phase !== 'getting-up') return;
      t += dt / SEAT_TRANSITION_SECONDS;
      const k = ease(Math.min(1, t));
      apply(from + (to - from) * k);
      if (t < 1) return;
      if (phase === 'sitting-down') {
        phase = 'seated';
        avatar.playClip(seatedClip, true);
      } else {
        phase = 'standing';
        const done = after;
        after = undefined;
        done?.();
      }
    },
    hipsAboveSeat() {
      const hips = avatar.findJoint('Hips');
      if (!hips) return null;
      hips.computeWorldMatrix(true);
      return hips.getAbsolutePosition().y - top;
    },
  };
};

/** The prop-contact numbers the playtest reads: hips height over the seat, and what the limit is. */
export type SeatContact = { id: string; hipsAboveSeat: number; error: number; ok: boolean };

/** Prop contact: how far the hips joint is from where it should be (seat top + `SEAT_HIPS_RISE`). Under 3 cm passes. */
export const seatContactError = (hipsAboveSeat: number) => Math.abs(hipsAboveSeat - SEAT_HIPS_RISE);
export const SEAT_CONTACT_LIMIT = 0.03;

export const measureSeat = (id: string, blend: SeatBlend): SeatContact | null => {
  if (blend.phase() !== 'seated') return null;
  const h = blend.hipsAboveSeat();
  if (h == null) return null;
  const error = seatContactError(h);
  return { id, hipsAboveSeat: h, error, ok: error <= SEAT_CONTACT_LIMIT };
};

// ---------- Prop-contact registry (read by the playtest probe) ----------

const registry = new Map<string, { blend: SeatBlend; avatar: PlayerAvatar }>();

/** Registers a seated person for the prop-contact probe; dead rigs drop out on their own. */
export const registerSeat = (id: string, blend: SeatBlend, avatar: PlayerAvatar) => {
  registry.set(id, { blend, avatar });
};

/** Every registered seated person: hips height over the seat and the error from where the clip's hips belong. */
export const seatReport = () => {
  const out: (SeatContact | { id: string; phase: SeatPhase })[] = [];
  for (const [id, entry] of [...registry]) {
    if (entry.avatar.group.isDisposed()) {
      registry.delete(id);
      continue;
    }
    const c = measureSeat(id, entry.blend);
    out.push(c ?? { id, phase: entry.blend.phase() });
  }
  return out;
};
