/**
 * Chapter openings (docs/story/chapters.md): each level opens on a 4-6 s camera move over its place, the chapter title
 * typeset over it (`chapterCard.ts`), a short synthesized sting on the music bus, then the camera glides into the
 * third-person camera behind Pierce with no cut.
 *
 * How the path is made, and why it cannot clip. The shot ENDS on the follow camera's own pose for the level's spawn
 * (`snapToSpawn` puts the follow lens there; its boom already pulls in ahead of walls) and STARTS at an authored offset
 * from it (back, to the side, up or down), looking at a landmark down the room. The offset is tried at full size, then
 * shrunk (x0.8 ... 0) until a 0.45 m clearance test passes at 40 samples along the curve against the level's collision
 * meshes, so a small room gets a small move and a street a big one, and no frame is ever inside geometry. After
 * `beginGame` the glide blends the lens from where the shot ended to the live follow pose over ~1.2 s (0.4 s after a
 * skip); a glide whose straight line is blocked (a scripted scene that frames the room differently) is hidden by a
 * 0.15 s dip instead of crossing a wall.
 *
 * The sting is code (`chapterSting.ts`, no files).
 */
import * as BABYLON from '@babylonjs/core';

type Spawn = { x: number; z: number; yaw: number };

/** `back` metres behind the follow pose, `side` to its right (negative: left), `up` above it (negative: below), looking `ahead` m down the facing. */
type Shot = {
  /** Where Pierce stands when the level starts (the story code places him there; keep in sync with it). */
  spawn: Spawn;
  back: number;
  side: number;
  up: number;
  ahead: number;
  lookY: number;
  seconds: number;
  place: string;
};

/** One shot per chapter (level ids 1-8, the order of the chapter cards). */
export const OPENING_SHOTS: Record<number, Shot> = {
  // Apex Peak: from the floor of the 58th-floor hall, rising and tracking toward the board room as Pierce waits at the end.
  1: { spawn: { x: 0, z: 13.5, yaw: 0 }, back: 9, side: 0, up: -0.7, ahead: 14, lookY: 1.5, seconds: 5.6, place: 'the 58th-floor hall' },
  // B3: out of the cab, the lit hall opening ahead.
  2: { spawn: { x: 44.25, z: 21.2, yaw: 0 }, back: 3.2, side: 1.0, up: 0.9, ahead: 12, lookY: 1.2, seconds: 5.2, place: 'the B3 hall' },
  // The Return: the empty over-lit lab, wide and high, drifting in.
  3: { spawn: { x: 13.4, z: 38.15, yaw: -Math.PI / 2 }, back: 5.5, side: -2.5, up: 1.2, ahead: 8, lookY: 1.4, seconds: 5.6, place: 'the over-lit basement' },
  // The Desk: the hall bathroom, a slow push toward the mirror wall.
  4: { spawn: { x: 16.9, z: 28.15, yaw: Math.PI / 2 }, back: 2.2, side: 0.8, up: 0.4, ahead: 4, lookY: 1.5, seconds: 4.6, place: 'the hall bathroom' },
  // Going Home: the lobby, the glass wall and the street light beyond it.
  5: { spawn: { x: 0, z: 2.35, yaw: 0 }, back: 2.5, side: 2.0, up: 1.0, ahead: 12, lookY: 1.8, seconds: 5.0, place: 'the tower lobby' },
  // The Station: the platform from high behind him, the rails and the tunnel mouth ahead.
  6: { spawn: { x: 7.2, z: -1.6, yaw: Math.PI / 2 }, back: 9, side: -1.5, up: 1.6, ahead: 20, lookY: 1.6, seconds: 5.8, place: 'the platform' },
  // The Train: tracking down the car.
  7: { spawn: { x: 1, z: 0, yaw: Math.PI / 2 }, back: 0.9, side: 0.6, up: 0.2, ahead: 16, lookY: 1.5, seconds: 4.6, place: 'the car' },
  // The Morning: the one room, the window light.
  8: { spawn: { x: 1.3, z: 2.0, yaw: Math.PI }, back: 1.5, side: 1.5, up: 0.6, ahead: 5, lookY: 1.5, seconds: 4.8, place: 'the apartment' },
};

const GLIDE_SECONDS = 1.2;
const SKIP_GLIDE_SECONDS = 0.4;
const CLEAR = 0.45;
const SAMPLES = 40;
type Offsets = { back: number; side: number; up: number };

const smooth = (u: number) => u * u * (3 - 2 * u);
const sine = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, u)));
const wrapAngle = (a: number) => {
  const t = Math.PI * 2;
  let v = (a + Math.PI) % t;
  if (v < 0) v += t;
  return v - Math.PI;
};

/** Camera rotation (Babylon: x pitch, y yaw) that looks from `from` at `to`. */
const lookRotation = (from: BABYLON.Vector3, to: BABYLON.Vector3) => {
  const d = to.subtract(from);
  const flat = Math.hypot(d.x, d.z);
  return { x: Math.atan2(-d.y, flat), y: Math.atan2(d.x, d.z) };
};

export type OpeningProbe = {
  /** idle, shot (moving), handover (shot over, the level is starting), glide (into the player's camera) */
  phase: 'idle' | 'shot' | 'handover' | 'glide';
  level: number;
  place: string;
  seconds: number;
  elapsed: number;
  moved: number;
  /** Radians the lens has turned since the first frame (a pan counts as camera movement in a room too small to dolly). */
  turned: number;
  /** Metres between the shot's first lens position and the follow pose. */
  scale: number;
  framesInside: number;
  framesNear: number;
  cuts: number;
  skipped: boolean;
  skipToGlideMs: number;
  stingPlayed: number;
  pos: [number, number, number];
  starts: number;
};

export type OpeningDeps = {
  scene: BABYLON.Scene;
  /** The follow camera's lens (also the one the render pipeline is attached to). */
  camera: BABYLON.UniversalCamera;
  /** Put the follow lens where it sits behind a player at this spawn (no damping). */
  snapToSpawn: (spawn: Spawn) => void;
  /** Meshes that count as geometry for the lens (the playtest's `feel.isSolid`). */
  isSolid: (mesh: BABYLON.AbstractMesh) => boolean;
  /** Hide a hard re-frame: black, then clear. */
  dip: () => void;
};

export const createChapterOpening = (deps: OpeningDeps) => {
  const { scene, camera } = deps;
  let phase: OpeningProbe['phase'] = 'idle';
  let level = 0;
  let shot: Shot | null = null;
  let path: BABYLON.Vector3[] = [];
  let looks: BABYLON.Vector3[] = [];
  let scale = 0;
  let elapsed = 0;
  let wall = 0;
  let observer: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
  let resolveShot: (() => void) | null = null;
  let skipped = false;
  let skipAt = 0;
  let skipToGlideMs = 0;
  let moved = 0;
  let turned = 0;
  let startRot = { x: 0, y: 0 };
  let framesInside = 0;
  let framesNear = 0;
  let cuts = 0;
  let stingPlayed = 0;
  let starts = 0;
  let last = new BABYLON.Vector3();
  const lastRot = { x: 0, y: 0 };
  let startPos = new BABYLON.Vector3();

  // What the follow camera's boom treats as an obstacle (thirdPersonCamera `isCameraObstacle`): collision boxes, camera clips
  // and visible pickable meshes. Static props are not pickable in the game, so their collision boxes are what count.
  const solid = (m: BABYLON.AbstractMesh) => {
    if (!m || m.isDisposed() || !m.isEnabled() || m.visibility <= 0 || m.getTotalVertices() === 0) return false;
    const meta = m.metadata as { sceneTriggerId?: string; trainCollider?: boolean; cameraClip?: boolean } | null;
    if (meta?.sceneTriggerId || meta?.trainCollider) return false;
    if (!(meta?.cameraClip || m.checkCollisions || (m.isVisible && m.isPickable))) return false;
    return deps.isSolid(m);
  };
  const hit = (from: BABYLON.Vector3, dir: BABYLON.Vector3, len: number) =>
    scene.pickWithRay(new BABYLON.Ray(from, dir, len), solid)?.hit ? true : false;

  const AXES = [BABYLON.Vector3.Right(), BABYLON.Vector3.Left(), BABYLON.Vector3.Up(), BABYLON.Vector3.Down(), BABYLON.Vector3.Forward(), BABYLON.Vector3.Backward()];
  const clearAt = (p: BABYLON.Vector3, radius: number) => AXES.every((a) => !hit(p, a, radius));
  const segmentClear = (a: BABYLON.Vector3, b: BABYLON.Vector3) => {
    const d = b.subtract(a);
    const len = d.length();
    return len < 1e-3 || !hit(a, d.scale(1 / len), len + CLEAR);
  };

  const bezier = (a: BABYLON.Vector3, c: BABYLON.Vector3, b: BABYLON.Vector3, u: number) => {
    const v = 1 - u;
    return a.scale(v * v).add(c.scale(2 * v * u)).add(b.scale(u * u));
  };

  /** Build the curve for these offset scales (back, side, up); null when it fails the clearance test. */
  const build = (s: Shot, end: BABYLON.Vector3, endLook: BABYLON.Vector3, endClear: number, k: Offsets) => {
    const fwd = new BABYLON.Vector3(Math.sin(s.spawn.yaw), 0, Math.cos(s.spawn.yaw));
    const right = new BABYLON.Vector3(Math.cos(s.spawn.yaw), 0, -Math.sin(s.spawn.yaw));
    const from = end.add(fwd.scale(-s.back * k.back)).add(right.scale(s.side * k.side)).add(new BABYLON.Vector3(0, s.up * k.up, 0));
    const ctrl = from.add(end).scale(0.5).add(right.scale(s.side * 0.35 * k.side));
    const pts: BABYLON.Vector3[] = [];
    for (let i = 0; i <= SAMPLES; i += 1) pts.push(bezier(from, ctrl, end, i / SAMPLES));
    return pts;
  };

  /** The lens path stays clear of geometry: full clearance until the last fifth, then what the follow pose itself has. */
  const pathClear = (pts: BABYLON.Vector3[], endClear: number) => {
    const tight = Math.max(0.08, Math.min(CLEAR, endClear * 0.9));
    let prev: BABYLON.Vector3 | null = null;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const p = pts[i]!;
      if (!clearAt(p, i >= SAMPLES * 0.8 ? tight : CLEAR)) return false;
      if (prev && !segmentClear(prev, p)) return false;
      prev = p;
    }
    return true;
  };

  const clearance = (p: BABYLON.Vector3, max: number) => {
    let min = max;
    for (const a of AXES) {
      const r = scene.pickWithRay(new BABYLON.Ray(p, a, max), solid);
      if (r?.hit) min = Math.min(min, r.distance ?? max);
    }
    return min;
  };

  /** The biggest move (back, side, up each tried at 1, .75, .5, .25, 0 of the authored offset) whose lens path is clear. */
  const search = (s: Shot, end: BABYLON.Vector3, endLook: BABYLON.Vector3) => {
    const endClear = clearance(end, CLEAR);
    const steps = [1, 0.75, 0.5, 0.25, 0];
    const combos: Offsets[] = [];
    for (const back of steps) for (const side of steps) for (const up of steps) combos.push({ back, side, up });
    const size = (k: Offsets) => Math.hypot(s.back * k.back, s.side * k.side, s.up * k.up);
    combos.sort((a, b) => size(b) - size(a));
    const fwd = new BABYLON.Vector3(Math.sin(s.spawn.yaw), 0, Math.cos(s.spawn.yaw));
    const right = new BABYLON.Vector3(Math.cos(s.spawn.yaw), 0, -Math.sin(s.spawn.yaw));
    for (const k of combos) {
      if (size(k) === 0) break;
      const start = end.add(fwd.scale(-s.back * k.back)).add(right.scale(s.side * k.side)).add(new BABYLON.Vector3(0, s.up * k.up, 0));
      if (!clearAt(start, CLEAR)) continue;
      const pts = build(s, end, endLook, endClear, k);
      if (pathClear(pts, endClear)) return { pts, k };
    }
    const k = { back: 0, side: 0, up: 0 };
    return { pts: build(s, end, endLook, endClear, k), k };
  };

  const setPose = (p: BABYLON.Vector3, look: BABYLON.Vector3) => {
    camera.position.copyFrom(p);
    camera.setTarget(look);
    camera.upVector.set(0, 1, 0);
  };

  /** Lens-in-geometry bookkeeping for the probe: the playtest's detector asks for 0. */
  const audit = () => {
    const p = camera.globalPosition;
    let inside = false;
    let near = false;
    for (const a of AXES) {
      const r = scene.pickWithRay(new BABYLON.Ray(p, a, 0.25), solid);
      if (!r?.hit) continue;
      near = true;
      const n = r.getNormal(true, true);
      if ((r.distance ?? 1) < 0.05 || (n && BABYLON.Vector3.Dot(n, a) > 0.2)) inside = true;
    }
    if (inside) framesInside += 1;
    else if (near) framesNear += 1;
  };

  const stop = () => {
    if (observer) scene.onBeforeRenderObservable.remove(observer);
    observer = null;
  };

  /**
   * Pose the lens at the first frame of the level's shot (the caller activates the camera, waits for a painted frame,
   * then calls `run`).
   */
  const prepare = (n: number) => {
    const s = OPENING_SHOTS[n] ?? OPENING_SHOTS[1]!;
    level = n;
    shot = s;
    skipped = false;
    elapsed = 0;
    wall = 0;
    moved = 0;
    turned = 0;
    framesInside = 0;
    framesNear = 0;
    cuts = 0;
    skipToGlideMs = 0;
    deps.snapToSpawn(s.spawn);
    const end = camera.position.clone();
    const rot = camera.rotation.clone();
    const endLook = end.add(new BABYLON.Vector3(Math.sin(rot.y) * Math.cos(rot.x), -Math.sin(rot.x), Math.cos(rot.y) * Math.cos(rot.x)).scale(10));
    const found = search(s, end, endLook);
    scale = Math.round(Math.hypot(s.back * found.k.back, s.side * found.k.side, s.up * found.k.up) * 100) / 100;
    path = found.pts;
    // Looks: from a landmark down the room to where the follow lens looks.
    const fwd = new BABYLON.Vector3(Math.sin(s.spawn.yaw), 0, Math.cos(s.spawn.yaw));
    const landmark = new BABYLON.Vector3(s.spawn.x, s.lookY, s.spawn.z).add(fwd.scale(s.ahead));
    looks = [];
    for (let i = 0; i <= SAMPLES; i += 1) looks.push(BABYLON.Vector3.Lerp(landmark, endLook, smooth(i / SAMPLES)));
    startPos = path[0]!.clone();
    setPose(path[0]!, looks[0]!);
    startRot = { x: camera.rotation.x, y: camera.rotation.y };
    last.copyFrom(camera.position);
    lastRot.x = camera.rotation.x;
    lastRot.y = camera.rotation.y;
    return { place: s.place, scale, seconds: s.seconds };
  };

  /** Move along the path; resolves when the shot ends (its time, or `skip`). */
  const run = () => new Promise<void>((resolve) => {
    if (!shot) { resolve(); return; }
    starts += 1;
    if (skipped) { phase = 'handover'; resolve(); return; }
    phase = 'shot';
    resolveShot = resolve;
    const seconds = shot.seconds;
    const finish = () => {
      stop();
      phase = 'handover';
      resolveShot = null;
      resolve();
    };
    stop();
    observer = scene.onBeforeRenderObservable.add(() => {
      if (phase !== 'shot') return;
      const frame = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
      // A slow GPU still ends the shot (about 2x its length); the step is capped so the move never jumps.
      wall += scene.getEngine().getDeltaTime() / 1000;
      elapsed += wall > seconds * 2 ? scene.getEngine().getDeltaTime() / 1000 : frame;
      const u = sine(elapsed / seconds);
      const f = u * SAMPLES;
      const i = Math.min(SAMPLES - 1, Math.floor(f));
      const k = f - i;
      const p = BABYLON.Vector3.Lerp(path[i]!, path[i + 1]!, k);
      const l = BABYLON.Vector3.Lerp(looks[i]!, looks[i + 1]!, k);
      setPose(p, l);
      moved = BABYLON.Vector3.Distance(p, startPos);
      turned = Math.hypot(camera.rotation.x - startRot.x, wrapAngle(camera.rotation.y - startRot.y));
      audit();
      last.copyFrom(p);
      lastRot.x = camera.rotation.x;
      lastRot.y = camera.rotation.y;
      if (elapsed >= seconds) finish();
    });
  });

  const skip = () => {
    if (phase === 'shot') {
      skipped = true;
      skipAt = performance.now();
      stop();
      phase = 'handover';
      const done = resolveShot;
      resolveShot = null;
      done?.();
    } else {
      skipped = true;
      skipAt = performance.now();
    }
  };

  /** After `beginGame`: blend the lens from where the shot ended to the live follow pose. */
  const glide = () => new Promise<void>((resolve) => {
    if (!shot) { resolve(); return; }
    phase = 'glide';
    if (skipped && skipAt) skipToGlideMs = Math.round(performance.now() - skipAt);
    const seconds = skipped ? SKIP_GLIDE_SECONDS : GLIDE_SECONDS;
    const fromPos = last.clone();
    const fromRot = { x: lastRot.x, y: lastRot.y };
    let t = 0;
    let first = true;
    stop();
    const done = () => {
      stop();
      phase = 'idle';
      shot = null;
      resolve();
    };
    observer = scene.onBeforeRenderObservable.add(() => {
      if (phase !== 'glide') return;
      // The follow update ran earlier this frame: the camera holds the live pose until we overwrite it.
      const livePos = camera.position.clone();
      const liveRot = { x: camera.rotation.x, y: camera.rotation.y };
      if (first) {
        first = false;
        if (!segmentClear(fromPos, livePos)) {
          // Not clear from where the shot ended: cut under a short dip instead of crossing geometry.
          cuts += 1;
          deps.dip();
          done();
          return;
        }
      }
      t += Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
      const e = smooth(Math.min(1, t / seconds));
      camera.position.copyFrom(BABYLON.Vector3.Lerp(fromPos, livePos, e));
      camera.rotation.x = fromRot.x + (liveRot.x - fromRot.x) * e;
      camera.rotation.y = fromRot.y + wrapAngle(liveRot.y - fromRot.y) * e;
      audit();
      if (t >= seconds) done();
    });
  });

  /** Smallest distance from the planned lens path (and its end pose) to geometry, for the build-time audit. */
  const pathReport = () => {
    let min = Infinity;
    let at = -1;
    path.forEach((p, i) => {
      // The last sample is the follow camera's own pose (a tight room pulls it in as far as it ever goes).
      if (i === path.length - 1) return;
      for (const a of AXES) {
        const r = scene.pickWithRay(new BABYLON.Ray(p, a, 1), solid);
        if (r?.hit && (r.distance ?? 1) < min) { min = r.distance ?? 1; at = i; }
      }
    });
    return { min: min === Infinity ? 1 : min, at, scale, samples: path.length };
  };

  return {
    prepare,
    pathReport,
    run,
    skip,
    glide,
    noteSting: (n: number) => { stingPlayed = n; },
    cancel: () => { stop(); phase = 'idle'; shot = null; resolveShot?.(); resolveShot = null; },
    active: () => phase !== 'idle',
    phase: () => phase,
    probe: (): OpeningProbe => ({
      phase,
      level,
      place: shot?.place ?? '',
      seconds: shot?.seconds ?? 0,
      elapsed: Math.round(elapsed * 100) / 100,
      moved: Math.round(moved * 100) / 100,
      turned: Math.round(turned * 1000) / 1000,
      scale,
      framesInside,
      framesNear,
      cuts,
      skipped,
      skipToGlideMs,
      stingPlayed,
      pos: [Math.round(camera.position.x * 100) / 100, Math.round(camera.position.y * 100) / 100, Math.round(camera.position.z * 100) / 100],
      starts,
    }),
  };
};

export type ChapterOpening = ReturnType<typeof createChapterOpening>;
