import type * as BABYLON from '@babylonjs/core';

/**
 * "Lost? Return to objective": a way out for a player who is stuck. Nothing here runs per frame. `main.ts` calls
 * `tick()` once a second (the same clock idea as the analytics `stuck` watcher) and `safeSpotNear` when the move is
 * made. AGENTS.md "Lost? Return to objective" says what the player sees.
 */

/** Seconds of real play with no progress before the prompt shows. */
export const LOST_SECONDS = 60;
/** Getting this much closer to the objective marker counts as progress. */
const CLOSER_BY = 1.5;

export type Point = { x: number; z: number };

export type LostProbe = {
  /** Real play: running, no card, no pause, no scene, no panel, tab visible. */
  playing: () => boolean;
  /** The live objective as text (kicker + line); a new one is progress. */
  objective: () => string;
  /** Pierce, and the objective marker (null when the objective has no position). */
  player: () => Point;
  target: () => Point | null;
};

export const createLostWatcher = (probe: LostProbe, onChange: (lost: boolean) => void) => {
  let key = '';
  let idle = 0;
  let best = Infinity;
  let lost = false;

  const set = (next: boolean) => {
    if (next === lost) return;
    lost = next;
    onChange(lost);
  };

  const reset = () => {
    idle = 0;
    best = Infinity;
    set(false);
  };

  return {
    /** Once a second. */
    tick: () => {
      if (!probe.playing()) {
        // Pause, scenes and menus do not count, and they do not clear a prompt that is already up.
        return;
      }
      const now = probe.objective();
      if (now !== key) {
        key = now;
        reset();
        return;
      }
      const target = probe.target();
      if (target) {
        const p = probe.player();
        const d = Math.hypot(p.x - target.x, p.z - target.z);
        if (d < best - CLOSER_BY) {
          const first = best === Infinity;
          best = d;
          if (!first) {
            idle = 0;
            set(false);
            return;
          }
        }
      }
      idle += 1;
      if (idle >= LOST_SECONDS) set(true);
    },
    reset,
    lost: () => lost,
    /** Seconds without progress so far (playtest). */
    idle: () => idle,
  };
};

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

const PAD = 0.5;

/** Ground slabs and solid colliders from the loaded scene, the same reading the playtest's walk grid uses. */
const collect = (scene: BABYLON.Scene) => {
  const floors: Rect[] = [];
  const blocks: Rect[] = [];
  for (const mesh of scene.meshes) {
    if (!mesh.isEnabled()) continue;
    const meta = mesh.metadata as { assetKind?: string; pickup?: unknown } | null;
    const box = mesh.getBoundingInfo().boundingBox;
    const r = { minX: box.minimumWorld.x, maxX: box.maximumWorld.x, minZ: box.minimumWorld.z, maxZ: box.maximumWorld.z };
    const sx = r.maxX - r.minX;
    const sz = r.maxZ - r.minZ;
    if (!Number.isFinite(sx) || !Number.isFinite(sz)) continue;
    if (meta?.assetKind === 'ground') {
      // Low slabs are trenches and pits, not floor to walk on.
      if (sx >= 1 && sz >= 1 && box.maximumWorld.y > -0.2 && box.maximumWorld.y < 0.6) floors.push(r);
      continue;
    }
    if (!mesh.checkCollisions || meta?.pickup) continue;
    if (/trigger|ceil|creature|skybox|playerCollider|impact|decal|floor|ground|city-/i.test(mesh.name)) continue;
    if (box.maximumWorld.y < 0.35 || box.minimumWorld.y > 1.7) continue;
    if (sx > 24 && sz > 24) continue;
    if (sx < 0.02 && sz < 0.02) continue;
    blocks.push(r);
  }
  return { floors, blocks };
};

const inside = (r: Rect, p: Point, pad = 0) => p.x >= r.minX - pad && p.x <= r.maxX + pad && p.z >= r.minZ - pad && p.z <= r.maxZ + pad;

/**
 * A spot on walkable ground a metre or two from `target`: inside a ground slab (when the level has any there), clear of
 * every solid collider by the player's radius, nearest first, not on top of the target itself. Null if none is found,
 * and the caller falls back to the last checkpoint.
 */
export const safeSpotNear = (scene: BABYLON.Scene, target: Point, from?: Point): Point | null => {
  const { floors, blocks } = collect(scene);
  const hasFloor = floors.some((f) => inside(f, target, 1));
  const ok = (p: Point) => (!hasFloor || floors.some((f) => inside(f, p, -0.25))) && !blocks.some((b) => inside(b, p, PAD));
  const found: { p: Point; score: number }[] = [];
  for (let radius = 1.4; radius <= 4.2; radius += 0.4) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const p = { x: target.x + Math.sin(a) * radius, z: target.z + Math.cos(a) * radius };
      if (!ok(p)) continue;
      // Prefer the side Pierce comes from, so he is placed before the objective, not past it.
      const side = from ? Math.hypot(p.x - from.x, p.z - from.z) * 0.05 : 0;
      found.push({ p, score: radius + side });
    }
    if (found.length >= 4) break;
  }
  if (!found.length) return ok(target) ? target : null;
  found.sort((a, b) => a.score - b.score);
  return found[0].p;
};
