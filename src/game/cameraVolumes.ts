/**
 * Interior camera volumes and profiles.
 *
 * Authored on the level JSON (`cameraVolumes`). The follow camera blends the active
 * profile (~0.4 s) instead of stacking clearance patches. Occluders between the lens
 * and Pierce fade to ~25% opacity; boom collision / a light shove are last resort only.
 */
import * as BABYLON from '@babylonjs/core';

export type CameraProfileId = 'open' | 'hallway' | 'doorway';

export type CameraProfile = {
  id: CameraProfileId;
  /** Boom length in metres. */
  distance: number;
  /** Vertical FOV in radians (hallway stays within ~60–75°). */
  fov: number;
  /** Extra lens height on top of the base config height. */
  heightLift: number;
  /** Over-shoulder mix 0..1 (hallway biases toward the open side). */
  shoulder: number;
  /** Extra yaw bias toward the open side while in a hallway (radians). */
  openYawBias: number;
};

/** Designed framing. Open matches the previous default boom. */
export const CAMERA_PROFILES: Record<CameraProfileId, CameraProfile> = {
  open: {
    id: 'open',
    distance: 5.6,
    fov: 0.9,
    heightLift: 0,
    shoulder: 0,
    openYawBias: 0,
  },
  hallway: {
    id: 'hallway',
    // Shorter boom so the plaster walls leave Pierce framed over the shoulder.
    distance: 2.85,
    // ~66° — within the 60–75° hallway band.
    fov: 1.15,
    heightLift: 0.06,
    shoulder: 0.72,
    openYawBias: 0.08,
  },
  doorway: {
    id: 'doorway',
    distance: 3.35,
    fov: 1.05,
    // Brief lift and centred while crossing a threshold.
    heightLift: 0.32,
    shoulder: 0,
    openYawBias: 0,
  },
};

export type CameraVolume = {
  id: string;
  profile: CameraProfileId;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  /**
   * Preferred open side for hallway shoulder bias: world +X, -X, +Z or -Z.
   * When omitted the camera picks the side with more clearance.
   */
  openSide?: 'posX' | 'negX' | 'posZ' | 'negZ';
  /** Higher wins when volumes overlap. Doorways default above halls. */
  priority?: number;
};

export type BlendedCameraPose = {
  profile: CameraProfileId;
  distance: number;
  fov: number;
  heightLift: number;
  /** Signed shoulder in metres-worth of mix (-1..1): negative = left of Pierce. */
  shoulderSigned: number;
  openYaw: number;
  /** 0..1 blend weight of the non-open profile (for playtest / debug). */
  blend: number;
};

const PROFILE_PRIORITY: Record<CameraProfileId, number> = {
  open: 0,
  hallway: 1,
  doorway: 2,
};

const BLEND_SECONDS = 0.4;
const FADE_TARGET = 0.25;
const FADE_IN = 10;
const FADE_OUT = 7;

export const parseCameraVolumes = (raw: unknown): CameraVolume[] => {
  if (!Array.isArray(raw)) return [];
  const out: CameraVolume[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const v = entry as Record<string, unknown>;
    const profile = v.profile;
    if (profile !== 'open' && profile !== 'hallway' && profile !== 'doorway') continue;
    const minX = Number(v.minX);
    const maxX = Number(v.maxX);
    const minZ = Number(v.minZ);
    const maxZ = Number(v.maxZ);
    if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) continue;
    const minY = Number.isFinite(Number(v.minY)) ? Number(v.minY) : -1;
    const maxY = Number.isFinite(Number(v.maxY)) ? Number(v.maxY) : 8;
    const openSide = v.openSide;
    const side =
      openSide === 'posX' || openSide === 'negX' || openSide === 'posZ' || openSide === 'negZ'
        ? openSide
        : undefined;
    const priority = Number.isFinite(Number(v.priority)) ? Number(v.priority) : undefined;
    out.push({
      id: typeof v.id === 'string' ? v.id : `vol-${out.length}`,
      profile,
      minX: Math.min(minX, maxX),
      maxX: Math.max(minX, maxX),
      minY,
      maxY,
      minZ: Math.min(minZ, maxZ),
      maxZ: Math.max(minZ, maxZ),
      openSide: side,
      priority,
    });
  }
  return out;
};

export const volumeContaining = (
  volumes: CameraVolume[],
  x: number,
  y: number,
  z: number,
): CameraVolume | null => {
  let best: CameraVolume | null = null;
  let bestScore = -1;
  for (const vol of volumes) {
    if (x < vol.minX || x > vol.maxX || z < vol.minZ || z > vol.maxZ) continue;
    if (y < vol.minY || y > vol.maxY) continue;
    const score = (vol.priority ?? PROFILE_PRIORITY[vol.profile]) * 1000 + volumeSizeScore(vol);
    if (score > bestScore) {
      best = vol;
      bestScore = score;
    }
  }
  return best;
};

/** Prefer the tighter volume when priorities tie (doorway slabs over hall AABB). */
const volumeSizeScore = (vol: CameraVolume) => {
  const area = Math.max(0.01, (vol.maxX - vol.minX) * (vol.maxZ - vol.minZ));
  return 1 / area;
};

export type VolumeBlendState = {
  current: BlendedCameraPose;
  /** Target profile id last resolved. */
  targetId: CameraProfileId;
  /** Open-side sign last chosen (−1 left / +1 right in camera space). */
  openSign: number;
};

export const createVolumeBlend = (): VolumeBlendState => ({
  current: {
    profile: 'open',
    distance: CAMERA_PROFILES.open.distance,
    fov: CAMERA_PROFILES.open.fov,
    heightLift: 0,
    shoulderSigned: 0,
    openYaw: 0,
    blend: 0,
  },
  targetId: 'open',
  openSign: 1,
});

const openSignFromSide = (side: CameraVolume['openSide'], yaw: number): number => {
  // Camera right is (cos yaw, -sin yaw). Positive shoulder = to Pierce's right.
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  if (side === 'posX') return rightX >= 0 ? 1 : -1;
  if (side === 'negX') return rightX >= 0 ? -1 : 1;
  if (side === 'posZ') return rightZ >= 0 ? 1 : -1;
  if (side === 'negZ') return rightZ >= 0 ? -1 : 1;
  return 1;
};

/**
 * Resolve the blended pose for this frame. `clearanceLeft` / `clearanceRight` are metres
 * of free space to Pierce's left/right; used when a hallway volume has no authored openSide.
 */
export const stepVolumeBlend = (
  state: VolumeBlendState,
  volumes: CameraVolume[],
  player: { x: number; y: number; z: number },
  yaw: number,
  dt: number,
  clearanceLeft: number,
  clearanceRight: number,
): BlendedCameraPose => {
  const hit = volumeContaining(volumes, player.x, player.y, player.z);
  const targetId: CameraProfileId = hit?.profile ?? 'open';
  const target = CAMERA_PROFILES[targetId];
  state.targetId = targetId;

  let openSign = state.openSign;
  if (targetId === 'hallway') {
    if (hit?.openSide) openSign = openSignFromSide(hit.openSide, yaw);
    else openSign = clearanceRight >= clearanceLeft ? 1 : -1;
    state.openSign = openSign;
  } else if (targetId === 'open' || targetId === 'doorway') {
    openSign = 0;
  }

  const wantShoulder = target.shoulder * (openSign === 0 ? 0 : openSign);
  const wantYaw = target.openYawBias * (openSign === 0 ? 0 : openSign);
  // ~95% of the way in BLEND_SECONDS.
  const k = 1 - Math.exp((-Math.log(20) / BLEND_SECONDS) * Math.min(dt, 0.05));
  const c = state.current;
  c.distance += (target.distance - c.distance) * k;
  c.fov += (target.fov - c.fov) * k;
  c.heightLift += (target.heightLift - c.heightLift) * k;
  c.shoulderSigned += (wantShoulder - c.shoulderSigned) * k;
  c.openYaw += (wantYaw - c.openYaw) * k;
  c.blend += ((targetId === 'open' ? 0 : 1) - c.blend) * k;
  c.profile = targetId;
  return c;
};

type FadeSnap = {
  visibility: number;
};

export type OcclusionFader = {
  update: (
    scene: BABYLON.Scene,
    lens: BABYLON.Vector3,
    eye: BABYLON.Vector3,
    ignore: Set<BABYLON.AbstractMesh>,
    dt: number,
  ) => number;
  clear: () => void;
  fadedCount: () => number;
  isFaded: (mesh: BABYLON.AbstractMesh) => boolean;
};

const isOccluderMesh = (mesh: BABYLON.AbstractMesh, ignore: Set<BABYLON.AbstractMesh>) => {
  if (!mesh || mesh.isDisposed() || !mesh.isEnabled()) return false;
  if (ignore.has(mesh)) return false;
  if (mesh.visibility <= 0) return false;
  const meta = mesh.metadata as { sceneTriggerId?: string; cameraClip?: boolean; trainCollider?: boolean; noCameraFade?: boolean } | undefined;
  if (meta?.sceneTriggerId || meta?.trainCollider) return false;
  if (meta?.cameraClip || mesh.checkCollisions || (mesh.isVisible && mesh.isPickable)) return true;
  return false;
};

/** Discrete props / door GLBs only — never the merged `interior-dress` kit (one mesh = whole floor). */
export const isFadeCandidate = (mesh: BABYLON.AbstractMesh, ignore: Set<BABYLON.AbstractMesh>) => {
  if (!isOccluderMesh(mesh, ignore)) return false;
  const meta = mesh.metadata as { noCameraFade?: boolean } | undefined;
  if (meta?.noCameraFade) return false;
  const name = (mesh.name || '').toLowerCase();
  if (/(^|-)(floor|ground|ceil|ceiling|sky)/.test(name)) return false;
  if (/^interior-(dress|col)/.test(name)) return false;
  return true;
};

/**
 * Fade walls / door frames / props that sit on the eye→lens segment to FADE_TARGET.
 * Meshes keep collision; the follow camera treats a faded mesh as see-through for boom tests.
 */
export const createOcclusionFader = (): OcclusionFader => {
  const snaps = new Map<BABYLON.AbstractMesh, FadeSnap>();
  const weight = new Map<BABYLON.AbstractMesh, number>();
  const ray = new BABYLON.Ray(BABYLON.Vector3.Zero(), BABYLON.Vector3.Forward(), 1);
  const dir = new BABYLON.Vector3();
  const origin = new BABYLON.Vector3();

  const restoreOne = (mesh: BABYLON.AbstractMesh) => {
    const snap = snaps.get(mesh);
    if (!snap) return;
    if (!mesh.isDisposed()) {
      // Visibility only — never touch shared materials (one door casing must not ghost every twin).
      mesh.visibility = snap.visibility;
      if (mesh.metadata && typeof mesh.metadata === 'object') {
        delete (mesh.metadata as { cameraFade?: number }).cameraFade;
      }
    }
    snaps.delete(mesh);
    weight.delete(mesh);
  };

  const ensureSnap = (mesh: BABYLON.AbstractMesh) => {
    if (snaps.has(mesh)) return;
    snaps.set(mesh, { visibility: mesh.visibility });
  };

  const applyFade = (mesh: BABYLON.AbstractMesh, amount: number) => {
    ensureSnap(mesh);
    const snap = snaps.get(mesh)!;
    mesh.visibility = snap.visibility * (1 - amount * (1 - FADE_TARGET));
    const meta = (mesh.metadata && typeof mesh.metadata === 'object' ? mesh.metadata : (mesh.metadata = {})) as {
      cameraFade?: number;
    };
    meta.cameraFade = amount;
  };

  const pickSegment = (
    scene: BABYLON.Scene,
    from: BABYLON.Vector3,
    to: BABYLON.Vector3,
    ignore: Set<BABYLON.AbstractMesh>,
    into: Set<BABYLON.AbstractMesh>,
  ) => {
    dir.copyFrom(to).subtractInPlace(from);
    const len = dir.length();
    if (len < 0.2) return;
    dir.scaleInPlace(1 / len);
    // Step along the segment so thick door frames and overlapping overlays still register.
    const steps = Math.min(6, Math.max(2, Math.ceil(len / 0.7)));
    for (let s = 0; s < steps; s++) {
      const t0 = (s / steps) * len;
      const span = len / steps;
      origin.copyFrom(from).addInPlace(dir.scale(t0 + 0.02));
      ray.origin.copyFrom(origin);
      ray.direction.copyFrom(dir);
      ray.length = Math.max(0.05, span);
      // First solid on the segment wins: a dress wall blocks fade of whatever sits behind it;
      // only fade when that first hit is a discrete prop or door GLB.
      const hit = scene.pickWithRay(ray, (m) => isOccluderMesh(m, ignore), false);
      if (hit?.hit && hit.pickedMesh && isFadeCandidate(hit.pickedMesh, ignore)) into.add(hit.pickedMesh);
    }
  };

  return {
    update(scene, lens, eye, ignore, dt) {
      const hitSet = new Set<BABYLON.AbstractMesh>();
      pickSegment(scene, eye, lens, ignore, hitSet);
      // A couple of parallel samples so a jamb beside the exact ray still fades.
      const sideX = -(lens.z - eye.z);
      const sideZ = lens.x - eye.x;
      const sideLen = Math.hypot(sideX, sideZ) || 1;
      const ox = (sideX / sideLen) * 0.28;
      const oz = (sideZ / sideLen) * 0.28;
      for (const sign of [1, -1]) {
        origin.set(eye.x + ox * sign, eye.y, eye.z + oz * sign);
        const tip = new BABYLON.Vector3(lens.x + ox * sign, lens.y, lens.z + oz * sign);
        pickSegment(scene, origin, tip, ignore, hitSet);
      }

      const clamped = Math.min(dt, 0.05);
      for (const mesh of hitSet) {
        const next = Math.min(1, (weight.get(mesh) ?? 0) + clamped * FADE_IN);
        weight.set(mesh, next);
        applyFade(mesh, next);
      }
      for (const mesh of [...weight.keys()]) {
        if (hitSet.has(mesh)) continue;
        const next = Math.max(0, (weight.get(mesh) ?? 0) - clamped * FADE_OUT);
        if (next <= 0.01) restoreOne(mesh);
        else {
          weight.set(mesh, next);
          applyFade(mesh, next);
        }
      }
      return weight.size;
    },
    clear() {
      for (const mesh of [...snaps.keys()]) restoreOne(mesh);
    },
    fadedCount: () => weight.size,
    isFaded(mesh) {
      return (weight.get(mesh) ?? 0) > 0.35;
    },
  };
};
