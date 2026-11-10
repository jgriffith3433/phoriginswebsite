/**
 * Frame-time trace for the PhProbe / playtest report.
 *
 * Push-only: Babylon render observables, PerformanceObserver (resource), engine shader
 * observables, and explicit marks from level setup / audio decode. No setInterval sampler.
 *
 * Frames over 50 ms get a cause from the hottest recent mark (or a GC heap drop). The first
 * second after start, and time inside an open level-setup mark, still record but do not fail.
 */

export type HitchCause =
  | 'shader-compile'
  | 'asset-load'
  | 'gc'
  | 'level-setup'
  | 'audio-decode'
  | 'unknown';

export type HitchEntry = {
  ms: number;
  cause: HitchCause;
  detail: string;
  level: number;
  objective: string;
  /** Seconds since this trace started. */
  t: number;
};

export type FrameTraceSummary = {
  frames: number;
  lastMs: number;
  over50: number;
  over100: number;
  /** Fail-worthy: over 100 ms after the first second and outside level setup. */
  failOver100: number;
  worst: HitchEntry[];
  startedAt: number;
  /** True once the first-second grace has passed. */
  armed: boolean;
};

export type FrameTraceContext = {
  level: number;
  libraryId: string;
  objective: string;
};

type Tag = { cause: HitchCause; detail: string; at: number; weight: number };

type HeapMemory = { usedJSHeapSize: number };

const SOFT_MS = 50;
const HARD_MS = 100;
const GRACE_MS = 1000;
const WORST_N = 5;
/** A mark stays "hot" this long after it fires. */
const TAG_HOLD_MS = 120;
const GC_DROP_BYTES = 1.5 * 1024 * 1024;
const CAUSE_WEIGHT: Record<HitchCause, number> = {
  'level-setup': 5,
  'shader-compile': 4,
  'audio-decode': 3,
  'asset-load': 3,
  gc: 2,
  unknown: 0,
};

const ASSET_RE = /\.(glb|gltf|png|jpe?g|webp|ktx2?|basis|env|dds)(\?|$)/i;

/** Loose engine/scene shapes so Babylon's typed Observables assign cleanly. */
type EngineLike = {
  onBeforeShaderCompilationObservable?: { add: (fn: () => void) => unknown; remove: (obs: never) => void };
  onAfterShaderCompilationObservable?: { add: (fn: () => void) => unknown; remove: (obs: never) => void };
  onNewEffectCreatedObservable?: { add: (fn: () => void) => unknown; remove: (obs: never) => void };
};

type SceneLike = {
  getEngine?: () => EngineLike;
  onBeforeRenderObservable?: { add: (fn: () => void) => unknown; remove: (obs: never) => void };
  onAfterRenderObservable?: { add: (fn: () => void) => unknown; remove: (obs: never) => void };
  isDisposed?: boolean;
};

export type FrameTraceApi = {
  /** Reset counters; call at the start of a playtest run. */
  reset: () => void;
  /** Push a cause mark (also available as window.__phFrameMark). */
  mark: (cause: HitchCause, detail?: string) => void;
  /** Nestable: level load / dress / shader warm. */
  beginSetup: (detail?: string) => void;
  endSetup: () => void;
  /** Snapshot for PhProbe.state / report(). */
  summary: () => FrameTraceSummary;
  /** Detach observers. */
  dispose: () => void;
};

const readHeap = (): number | null => {
  try {
    const heap = (performance as Performance & { memory?: HeapMemory }).memory;
    return heap ? heap.usedJSHeapSize : null;
  } catch {
    return null;
  }
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export const installFrameTrace = (opts: {
  /** Babylon scene (typed loosely so Engine Observables do not fight assignment). */
  scene: () => unknown;
  context: () => FrameTraceContext;
}): FrameTraceApi => {
  let startedAt = performance.now();
  let frames = 0;
  let lastMs = 0;
  let over50 = 0;
  let over100 = 0;
  let failOver100 = 0;
  /** Start of the current Babylon render pass (work time, not wall-clock between frames). */
  let frameWorkStart = 0;
  let lastHeap: number | null = readHeap();
  let setupDepth = 0;
  const worst: HitchEntry[] = [];
  const tags: Tag[] = [];
  const cleanups: Array<() => void> = [];
  let hookedScene: SceneLike | null = null;
  let hookedEngine: EngineLike | null = null;
  let resourceObserver: PerformanceObserver | null = null;
  /** rAF fallback only: previous callback time when Babylon observables are missing. */
  let rafLastAt = startedAt;

  const pushTag = (cause: HitchCause, detail: string, weight = CAUSE_WEIGHT[cause]) => {
    const at = performance.now();
    tags.push({ cause, detail: detail.slice(0, 120), at, weight });
    // Keep a short ring; old tags cannot explain a hitch.
    while (tags.length > 48 || (tags[0] && at - tags[0].at > 2000)) tags.shift();
  };

  const mark = (cause: HitchCause, detail = '') => {
    pushTag(cause, detail || cause);
  };

  const beginSetup = (detail = 'level-setup') => {
    setupDepth += 1;
    pushTag('level-setup', detail, CAUSE_WEIGHT['level-setup'] + setupDepth);
  };

  const endSetup = () => {
    if (setupDepth > 0) setupDepth -= 1;
  };

  const pickCause = (frameEnd: number, heapDelta: number | null): { cause: HitchCause; detail: string } => {
    if (setupDepth > 0) {
      return { cause: 'level-setup', detail: 'level setup in progress' };
    }
    let best: Tag | null = null;
    for (let i = tags.length - 1; i >= 0; i -= 1) {
      const tag = tags[i]!;
      if (frameEnd - tag.at > TAG_HOLD_MS) break;
      if (!best || tag.weight > best.weight || (tag.weight === best.weight && tag.at > best.at)) {
        best = tag;
      }
    }
    if (best) return { cause: best.cause, detail: best.detail };
    if (heapDelta != null && heapDelta <= -GC_DROP_BYTES) {
      return { cause: 'gc', detail: `heap drop ${Math.round((-heapDelta) / (1024 * 1024))} MB` };
    }
    if (heapDelta != null && heapDelta >= GC_DROP_BYTES * 2) {
      // A large allocate on the frame often precedes a GC stall; still tag as gc when nothing else fits.
      return { cause: 'gc', detail: `heap +${Math.round(heapDelta / (1024 * 1024))} MB` };
    }
    return { cause: 'unknown', detail: '' };
  };

  const recordHitch = (ms: number, cause: HitchCause, detail: string, tSec: number, ctx: FrameTraceContext) => {
    const entry: HitchEntry = {
      ms: round1(ms),
      cause,
      detail,
      level: ctx.level,
      objective: ctx.objective,
      t: round1(tSec),
    };
    // Keep the worst N by ms (stable insert).
    let placed = false;
    for (let i = 0; i < worst.length; i += 1) {
      if (entry.ms > worst[i]!.ms) {
        worst.splice(i, 0, entry);
        placed = true;
        break;
      }
    }
    if (!placed && worst.length < WORST_N) worst.push(entry);
    if (worst.length > WORST_N) worst.length = WORST_N;
  };

  /**
   * Record one frame's main-thread work. Prefer Babylon before/after render (the render pass),
   * not wall-clock gaps between frames — a headless ~1 fps tab has ~1000 ms gaps with little work.
   */
  const onFrameWork = (dt: number, now = performance.now()) => {
    if (dt <= 0 || dt >= 5000) {
      lastHeap = readHeap();
      return;
    }
    frames += 1;
    lastMs = round1(dt);
    const since = now - startedAt;
    const heap = readHeap();
    const heapDelta = heap != null && lastHeap != null ? heap - lastHeap : null;
    lastHeap = heap;

    if (dt < SOFT_MS) return;

    const ctx = (() => {
      try {
        return opts.context();
      } catch {
        return { level: 0, libraryId: '', objective: '' };
      }
    })();
    const { cause, detail } = pickCause(now, heapDelta);
    over50 += 1;
    if (dt >= HARD_MS) {
      over100 += 1;
      if (since >= GRACE_MS && setupDepth === 0) failOver100 += 1;
    }
    recordHitch(dt, cause, detail, since / 1000, ctx);
  };

  const hookEngine = (engine: EngineLike | null | undefined) => {
    if (!engine || engine === hookedEngine) return;
    hookedEngine = engine;
    const bind = (obs: EngineLike['onBeforeShaderCompilationObservable'], label: string) => {
      if (!obs || typeof obs.add !== 'function') return;
      const token = obs.add(() => mark('shader-compile', label));
      cleanups.push(() => {
        try {
          (obs.remove as (o: unknown) => void)(token);
        } catch { /* gone */ }
      });
    };
    bind(engine.onBeforeShaderCompilationObservable, 'before shader');
    bind(engine.onAfterShaderCompilationObservable, 'after shader');
    bind(engine.onNewEffectCreatedObservable, 'new effect');
  };

  const hookScene = (scene: SceneLike | null | undefined) => {
    if (!scene || scene === hookedScene || scene.isDisposed) return;
    hookedScene = scene;
    const before = scene.onBeforeRenderObservable;
    const after = scene.onAfterRenderObservable;
    if (before && typeof before.add === 'function' && after && typeof after.add === 'function') {
      const beforeTok = before.add(() => {
        frameWorkStart = performance.now();
        try {
          hookEngine(typeof scene.getEngine === 'function' ? scene.getEngine() : null);
        } catch { /* */ }
      });
      const afterTok = after.add(() => {
        if (!frameWorkStart) return;
        const now = performance.now();
        onFrameWork(now - frameWorkStart, now);
        frameWorkStart = 0;
      });
      cleanups.push(() => {
        try {
          (before.remove as (o: unknown) => void)(beforeTok);
        } catch { /* */ }
        try {
          (after.remove as (o: unknown) => void)(afterTok);
        } catch { /* */ }
      });
    } else if (typeof requestAnimationFrame === 'function') {
      // No Babylon observables: fall back to rAF gaps (less accurate under a capped fps).
      let alive = true;
      const tick = (t: number) => {
        if (!alive) return;
        onFrameWork(t - rafLastAt, t);
        rafLastAt = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      cleanups.push(() => {
        alive = false;
      });
    }
    try {
      hookEngine(typeof scene.getEngine === 'function' ? scene.getEngine() : null);
    } catch { /* */ }
  };

  // Resource loads finishing on the main thread (GLB / texture).
  try {
    resourceObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!ASSET_RE.test(entry.name)) continue;
        const short = entry.name.replace(/^.*\/assets\//, '/assets/').slice(0, 100);
        mark('asset-load', short);
      }
    });
    resourceObserver.observe({ type: 'resource', buffered: true });
  } catch {
    resourceObserver = null;
  }

  // Explicit marks from game code (level setup, audio decode).
  type FrameHooks = {
    __phFrameMark?: (cause: HitchCause, detail?: string) => void;
    __phFrameSetup?: (on: boolean, detail?: string) => void;
  };
  const win = window as unknown as FrameHooks;
  const previousMark = win.__phFrameMark;
  const previousSetup = win.__phFrameSetup;
  const setupHook = (on: boolean, detail?: string) => {
    if (on) beginSetup(detail);
    else endSetup();
  };
  win.__phFrameMark = mark;
  win.__phFrameSetup = setupHook;

  const sceneOf = () => opts.scene() as SceneLike | null | undefined;

  // Attach to the live scene now and again when the probe's scene is ready.
  try {
    hookScene(sceneOf());
  } catch { /* boot */ }
  // One rAF retry if the scene was not ready at install (no setInterval poll).
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      try {
        hookScene(sceneOf());
      } catch { /* */ }
    });
  }

  const summary = (): FrameTraceSummary => ({
    frames,
    lastMs,
    over50,
    over100,
    failOver100,
    worst: worst.map((h) => ({ ...h })),
    startedAt,
    armed: performance.now() - startedAt >= GRACE_MS,
  });

  const reset = () => {
    startedAt = performance.now();
    frameWorkStart = 0;
    rafLastAt = startedAt;
    frames = 0;
    lastMs = 0;
    over50 = 0;
    over100 = 0;
    failOver100 = 0;
    worst.length = 0;
    tags.length = 0;
    setupDepth = 0;
    lastHeap = readHeap();
    try {
      hookScene(sceneOf());
    } catch { /* */ }
  };

  const dispose = () => {
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch { /* */ }
    }
    resourceObserver?.disconnect();
    resourceObserver = null;
    if (win.__phFrameMark === mark) {
      if (previousMark) win.__phFrameMark = previousMark;
      else delete win.__phFrameMark;
    }
    if (win.__phFrameSetup === setupHook) {
      if (previousSetup) win.__phFrameSetup = previousSetup;
      else delete win.__phFrameSetup;
    }
    hookedScene = null;
    hookedEngine = null;
  };

  return { reset, mark, beginSetup, endSetup, summary, dispose };
};

type FrameHooks = {
  __phFrameMark?: (cause: HitchCause, detail?: string) => void;
  __phFrameSetup?: (on: boolean, detail?: string) => void;
};

/** Game code calls this when a known hitch source runs. */
export const frameMark = (cause: HitchCause, detail?: string) => {
  try {
    (window as unknown as FrameHooks).__phFrameMark?.(cause, detail);
  } catch { /* playtest not installed */ }
};

/** Nestable level-load / dress mark around long setup work. */
export const frameSetup = (on: boolean, detail?: string) => {
  try {
    (window as unknown as FrameHooks).__phFrameSetup?.(on, detail);
  } catch { /* playtest not installed */ }
};
