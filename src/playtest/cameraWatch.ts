/**
 * Per-frame camera detector for the PhProbe / playtest report (docs/camera.md).
 *
 * Push-only: runs from scene.onAfterRenderObservable and reports through `emit`, no timers.
 * Per frame it checks: lens inside or within 0.25 m of solid geometry, a solid between Pierce's eye
 * and the lens (occluder), the fraction of the frame within 0.5 m of a surface (near-wall coverage),
 * yaw/pitch snaps over 30 degrees, and back-and-forth jitter. The worst frames keep a screenshot.
 */
import { isStructureMesh } from '../game/cameraVolumes';
import { Ray, Vector3, type AbstractMesh, type Scene } from '@babylonjs/core';

export type CamKind = 'inside' | 'near' | 'blocked' | 'nearwall' | 'snap' | 'jitter';

export type CamFrame = {
  kind: CamKind;
  score: number;
  t: number;
  level: string;
  detail: string;
  pos: [number, number, number];
  shot: string | null;
};

export type CamSummary = {
  frames: number;
  inside: number;
  near: number;
  blocked: number;
  /** Frames with the lens inside, or behind, a wall / door / glass mesh (the hard criterion: must be 0). */
  behindWall: number;
  nearWall: number;
  snaps: number;
  jitter: number;
  maxCoverage: number;
  meanCoverage: number;
  worst: CamFrame[];
};

export type CamWatchOptions = {
  scene: () => Scene;
  player: () => Vector3 | null;
  isSolid: (mesh: AbstractMesh) => boolean;
  /** False during cutscenes, menus and scripted scenes: nothing is judged. */
  active: () => boolean;
  label: () => string;
  emit: (type: string, detail: string) => void;
};

const NEAR = 0.25;
const INSIDE = 0.05;
const WALL_DEPTH = 0.5;
const SNAP = (30 * Math.PI) / 180;
const WORST_N = 5;
const COVER_FLAG = 0.5;
const SHOT_WIDTH = 480;

export const installCameraWatch = (o: CamWatchOptions) => {
  let on = false;
  let obs: ReturnType<Scene['onAfterRenderObservable']['add']> = null;
  let sum: CamSummary = fresh();
  let prev: { yaw: number; pitch: number; p: Vector3; dyaw: number; dpitch: number; rev: number; player: Vector3 } | null = null;
  let coverSum = 0;
  let restUntil = 0;
  const t0 = () => performance.now();
  let started = t0();

  function fresh(): CamSummary {
    return { frames: 0, inside: 0, near: 0, blocked: 0, behindWall: 0, nearWall: 0, snaps: 0, jitter: 0, maxCoverage: 0, meanCoverage: 0, worst: [] };
  }

  const hit = (scene: Scene, from: Vector3, dir: Vector3, len: number) => {
    const info = scene.pickWithRay(new Ray(from, dir, len), (m) => m.isEnabled() && m.isVisible && m.isPickable && o.isSolid(m));
    return info?.hit ? info : null;
  };

  const shot = (scene: Scene): string | null => {
    try {
      const c = scene.getEngine().getRenderingCanvas();
      if (!c) return null;
      const w = SHOT_WIDTH;
      const h = Math.round((c.height / c.width) * w);
      const s = document.createElement('canvas');
      s.width = w;
      s.height = h;
      s.getContext('2d')!.drawImage(c, 0, 0, w, h);
      return s.toDataURL('image/jpeg', 0.6);
    } catch {
      return null;
    }
  };

  const keep = (scene: Scene, kind: CamKind, score: number, detail: string, pos: Vector3) => {
    const worst = sum.worst;
    if (worst.length >= WORST_N && score <= worst[worst.length - 1]!.score) return;
    const entry: CamFrame = {
      kind, score, detail, level: o.label(), t: Math.round((t0() - started) / 100) / 10,
      pos: [Math.round(pos.x * 100) / 100, Math.round(pos.y * 100) / 100, Math.round(pos.z * 100) / 100],
      shot: shot(scene),
    };
    worst.push(entry);
    worst.sort((a, b) => b.score - a.score);
    if (worst.length > WORST_N) worst.length = WORST_N;
    o.emit('camera-worst', JSON.stringify({ ...entry, shot: entry.shot ? `${entry.shot.length} bytes` : null }));
  };

  const flag = (scene: Scene, kind: CamKind, score: number, detail: string, pos: Vector3) => {
    o.emit(`camera-${kind}`, `${o.label()} ${detail} at ${pos.x.toFixed(1)},${pos.z.toFixed(1)}`);
    keep(scene, kind, score, detail, pos);
  };

  const frame = () => {
    const scene = o.scene();
    const cam = scene.activeCamera;
    const player = o.player();
    if (!cam || !player) return;
    const now = t0();
    if (!o.active() || now < restUntil) { prev = null; return; }
    const lens = cam.globalPosition.clone();
    const fwd = cam.getForwardRay(1).direction;
    const yaw = Math.atan2(fwd.x, fwd.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y)));
    sum.frames += 1;

    // A jump in Pierce's own position is a respawn or a placement, not the camera's fault.
    if (prev && Vector3.Distance(prev.player, player) > 3) { prev = null; return; }

    const eye = player.add(new Vector3(0, 1.5, 0));
    const axes = [Vector3.Right(), Vector3.Left(), Vector3.Up(), Vector3.Down(), Vector3.Forward(), Vector3.Backward()];
    let nearest = Infinity;
    let inside = false;
    let wallFrame = false;
    for (const a of axes) {
      const h = hit(scene, lens, a, NEAR);
      if (!h) continue;
      nearest = Math.min(nearest, h.distance);
      const n = h.getNormal(true, true);
      if (h.distance < INSIDE || (n && Vector3.Dot(n, a) > 0.2)) {
        inside = true;
        if (h.pickedMesh && isStructureMesh(h.pickedMesh)) wallFrame = true;
      }
    }
    if (inside) { sum.inside += 1; flag(scene, 'inside', 3, 'lens inside geometry', lens); }
    else if (nearest < NEAR) { sum.near += 1; flag(scene, 'near', 1 + (NEAR - nearest) / NEAR, `lens ${nearest.toFixed(2)} m from geometry`, lens); }

    const toLens = lens.subtract(eye);
    const gap = toLens.length();
    if (gap > 0.4) {
      const h = hit(scene, eye, toLens.normalize(), gap - 0.1);
      if (h) {
        if (h.pickedMesh && isStructureMesh(h.pickedMesh)) wallFrame = true;
        sum.blocked += 1; flag(scene, 'blocked', 2 + (1 - h.distance / gap), `${h.pickedMesh?.name ?? '?'} between eye and lens`, lens);
      }
    }

    if (wallFrame) { sum.behindWall += 1; o.emit('camera-behindwall', `${o.label()} lens inside or behind a wall/door at ${lens.x.toFixed(1)},${lens.z.toFixed(1)}`); }

    // Near-wall coverage: a 5x5 fan of rays across the view, counted when it stops within 0.5 m.
    const right = cam.getDirection(Vector3.Right());
    const up = cam.getDirection(Vector3.Up());
    const fwdN = cam.getDirection(Vector3.Forward());
    const half = 0.6;
    let covered = 0;
    for (let i = -2; i <= 2; i += 1) {
      for (let j = -2; j <= 2; j += 1) {
        const d = fwdN.add(right.scale((i / 2) * half)).add(up.scale((j / 2) * half * 0.6)).normalize();
        if (hit(scene, lens, d, WALL_DEPTH)) covered += 1;
      }
    }
    const cover = covered / 25;
    coverSum += cover;
    sum.maxCoverage = Math.max(sum.maxCoverage, cover);
    sum.meanCoverage = coverSum / sum.frames;
    if (cover >= COVER_FLAG) { sum.nearWall += 1; flag(scene, 'nearwall', cover, `${Math.round(cover * 100)}% of the frame within ${WALL_DEPTH} m`, lens); }

    if (prev) {
      const dyaw = wrapA(yaw - prev.yaw);
      const dpitch = pitch - prev.pitch;
      if (Math.abs(dyaw) > SNAP || Math.abs(dpitch) > SNAP) {
        sum.snaps += 1;
        flag(scene, 'snap', 2 + Math.max(Math.abs(dyaw), Math.abs(dpitch)), `yaw ${(dyaw * 57.3).toFixed(0)} deg, pitch ${(dpitch * 57.3).toFixed(0)} deg in one frame`, lens);
      }
      // Jitter: the camera's turn or move flips direction on consecutive frames by a visible amount.
      const move = lens.subtract(prev.p);
      const flip = (a: number, b: number, min: number) => Math.abs(a) > min && Math.abs(b) > min && Math.sign(a) !== Math.sign(b);
      const back = flip(dyaw, prev.dyaw, 0.01) || flip(dpitch, prev.dpitch, 0.01);
      const rev = back ? prev.rev + 1 : 0;
      if (rev === 4) { sum.jitter += 1; flag(scene, 'jitter', 1.5 + move.length(), 'turn direction flips four frames running', lens); }
      prev = { yaw, pitch, p: lens, dyaw, dpitch, rev, player: player.clone() };
    } else {
      prev = { yaw, pitch, p: lens, dyaw: 0, dpitch: 0, rev: 0, player: player.clone() };
    }
  };

  return {
    start() {
      if (on) return;
      on = true;
      sum = fresh();
      coverSum = 0;
      prev = null;
      started = t0();
      obs = o.scene().onAfterRenderObservable.add(frame);
    },
    stop() {
      on = false;
      if (obs) o.scene().onAfterRenderObservable.remove(obs);
      obs = null;
    },
    /** An intended cut or placement: judge nothing for a moment. */
    cut(seconds = 1) { restUntil = t0() + seconds * 1000; prev = null; },
    summary: (): CamSummary => ({ ...sum, worst: sum.worst.slice() }),
  };
};

function wrapA(a: number) {
  const t = Math.PI * 2;
  let v = (a + Math.PI) % t;
  if (v < 0) v += t;
  return v - Math.PI;
}
