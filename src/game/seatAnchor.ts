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

/**
 * Baked sit clips (CC0 stock motion:ual1/Sitting_Enter, Sitting_Exit, Sitting_Idle_Loop retargeted onto the rig and
 * appended with tools/bakeLocoClips.mjs, see .hawkes/pending-gpu.txt). Clip names are matched by exact tail
 * (`findClip`). While a rig lacks them the eased pelvis blend below stays as the stand-in.
 */
export const SIT_CLIPS = { enter: 'SitEnter', exit: 'SitExit', idle: 'SitIdleLoop' } as const;

/** What a sit-down or get-up used last: `clip` (baked Sitting_Enter / Sitting_Exit) or `blend` (eased stand-in). */
export type SeatTransition = 'clip' | 'blend' | 'none';

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
  /** How the last sit-down / get-up was played (probe: criterion "plays the clip, not a position slide"). */
  lastTransition: () => SeatTransition;
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
  let last: SeatTransition = 'none';

  const apply = (y: number) => {
    avatar.group.position.y = y;
  };

  return {
    phase: () => phase,
    lastTransition: () => last,
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
      if (avatar.hasClip(SIT_CLIPS.enter)) {
        // The clip carries the pelvis down: the rig sits at its seated height from the first frame, no slide.
        last = 'clip';
        apply(to);
        const started = avatar.playClip(SIT_CLIPS.enter, false, 1, () => {
          if (phase !== 'sitting-down') return;
          phase = 'seated';
          avatar.playClip(avatar.hasClip(SIT_CLIPS.idle) ? SIT_CLIPS.idle : seatedClip, true);
        });
        if (started) return;
      }
      last = 'blend';
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
      if (avatar.hasClip(SIT_CLIPS.exit)) {
        last = 'clip';
        const started = avatar.playClip(SIT_CLIPS.exit, false, 1, () => {
          if (phase !== 'getting-up') return;
          apply(standingGroupY());
          phase = 'standing';
          avatar.setLocomotion(false, true);
          const done = after;
          after = undefined;
          done?.();
        });
        if (started) return;
      }
      last = 'blend';
      avatar.setLocomotion(false, true);
    },
    step(dt) {
      if (last === 'clip') return;
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

/** What an anchor is: a seat (hips on it), a bed (back on the mattress) or a lean (back on a wall or rail). */
export type AnchorKind = 'seat' | 'bed' | 'lean';

/** A contact the prop measures itself: metres between where the body part is and where the prop's surface is. */
export type ContactSample = { value: number; target: number; transition?: SeatTransition };

type Entry = {
  kind: AnchorKind;
  blend?: SeatBlend;
  avatar: PlayerAvatar;
  measure?: () => ContactSample | null;
};

const registry = new Map<string, Entry>();

/** Registers a seated person for the prop-contact probe; dead rigs drop out on their own. */
export const registerSeat = (id: string, blend: SeatBlend, avatar: PlayerAvatar) => {
  registry.set(id, { kind: 'seat', blend, avatar });
};

/**
 * Registers a bed or lean anchor (or any seat whose rig is not driven by a SeatBlend: Pierce's own chair, the sofa).
 * `measure` returns the measured value and the one the prop wants (hips joint over the seat top, hips over the
 * mattress top, back distance from the wall...) while the pose is held, null while he moves or the rig loads.
 */
export const registerContact = (id: string, kind: AnchorKind, avatar: PlayerAvatar, measure: () => ContactSample | null) => {
  registry.set(id, { kind, avatar, measure });
};

export const unregisterContact = (id: string) => {
  registry.delete(id);
};

/** The hips joint height of a rig in world metres, or null while it loads. */
export const hipsWorldY = (avatar: PlayerAvatar): number | null => {
  const hips = avatar.findJoint('Hips');
  if (!hips) return null;
  hips.computeWorldMatrix(true);
  return hips.getAbsolutePosition().y;
};

export type AnchorReport = SeatContact & { kind: AnchorKind; transition: SeatTransition };

/** Every registered anchor: hips height over the seat and the error from where the clip's hips belong. */
export const seatReport = () => {
  const out: (AnchorReport | { id: string; kind: AnchorKind; phase: SeatPhase | 'moving' })[] = [];
  for (const [id, entry] of [...registry]) {
    if (entry.avatar.group.isDisposed()) {
      registry.delete(id);
      continue;
    }
    if (entry.measure) {
      const m = entry.measure();
      if (!m) {
        out.push({ id, kind: entry.kind, phase: 'moving' });
        continue;
      }
      const error = Math.abs(m.value - m.target);
      out.push({ id, kind: entry.kind, hipsAboveSeat: m.value, error, ok: error <= SEAT_CONTACT_LIMIT, transition: m.transition ?? 'none' });
      continue;
    }
    const c = entry.blend ? measureSeat(id, entry.blend) : null;
    out.push(c && entry.blend
      ? { ...c, kind: entry.kind, transition: entry.blend.lastTransition() }
      : { id, kind: entry.kind, phase: entry.blend?.phase() ?? 'moving' });
  }
  return out;
};
