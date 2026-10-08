import type { AnimationGroup } from '@babylonjs/core';

/** Last `_` segment so prefixed clones (`…ModelRoot_2_SitIdle`) still match. */
export const clipTail = (value: string) => {
  const slash = value.replace(/\\/g, '/');
  const base = slash.slice(slash.lastIndexOf('/') + 1);
  const parts = base.split('_');
  return parts[parts.length - 1] ?? base;
};

/** Inclusive start/end in seconds, clip-local (0 = first frame). */
export type ClipTrim = {
  start: number;
  end: number;
};

export type ClipTrimsFile = {
  version: 1;
  /** Exact clip tails: Draw, Holster, PistolAim, Idle, Walk, … */
  clips: Record<string, ClipTrim>;
  /** Per-GLB overrides: "/assets/models/ch33-hero.glb" → tail → trim */
  assets?: Record<string, Record<string, ClipTrim>>;
};

export const CLIP_TRIMS_PATH = '/assets/animations/clip-trims.json';

export const emptyClipTrims = (): ClipTrimsFile => ({
  version: 1,
  clips: {},
  assets: {},
});

const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/\/+/g, '/');

const asTrim = (value: unknown): ClipTrim | null => {
  if (!value || typeof value !== 'object') return null;
  const start = Number((value as { start?: unknown }).start);
  const end = Number((value as { end?: unknown }).end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start: Math.max(0, start), end: Math.max(0, end) };
};

const lookupInMap = (map: Record<string, ClipTrim> | undefined, tail: string): ClipTrim | null => {
  if (!map || !tail) return null;
  const exact = asTrim(map[tail]);
  if (exact) return exact;
  const want = tail.toLowerCase();
  for (const [key, trim] of Object.entries(map)) {
    if (key.toLowerCase() === want) return asTrim(trim);
  }
  return null;
};

export const normalizeClipTrims = (raw: unknown): ClipTrimsFile => {
  const file = emptyClipTrims();
  if (!raw || typeof raw !== 'object') return file;
  const src = raw as Partial<ClipTrimsFile> & { trims?: Record<string, ClipTrim> };
  const clips = src.clips ?? src.trims ?? {};
  for (const [key, value] of Object.entries(clips)) {
    const trim = asTrim(value);
    if (trim) file.clips[key] = trim;
  }
  if (src.assets && typeof src.assets === 'object') {
    file.assets = {};
    for (const [path, tails] of Object.entries(src.assets)) {
      if (!tails || typeof tails !== 'object') continue;
      const out: Record<string, ClipTrim> = {};
      for (const [tail, value] of Object.entries(tails)) {
        const trim = asTrim(value);
        if (trim) out[tail] = trim;
      }
      if (Object.keys(out).length) file.assets[normalizePath(path)] = out;
    }
  }
  return file;
};

let cached: Promise<ClipTrimsFile> | null = null;

export const invalidateClipTrims = () => {
  cached = null;
};

export const rememberClipTrims = (data: ClipTrimsFile) => {
  cached = Promise.resolve(normalizeClipTrims(data));
};

export const loadClipTrims = (): Promise<ClipTrimsFile> => {
  if (!cached) {
    cached = fetch(CLIP_TRIMS_PATH, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : emptyClipTrims()))
      .then(normalizeClipTrims)
      .catch(() => emptyClipTrims());
  }
  return cached;
};

/** Asset-path + exact tail wins; then global tail. Missing trim = full clip. */
export const lookupClipTrim = (
  file: ClipTrimsFile,
  tail: string,
  glbPath?: string | null,
): ClipTrim | null => {
  const path = glbPath ? normalizePath(glbPath) : '';
  if (path && file.assets) {
    const byPath = file.assets[path] ?? Object.entries(file.assets).find(([key]) => key.toLowerCase() === path.toLowerCase())?.[1];
    const fromAsset = lookupInMap(byPath, tail);
    if (fromAsset) return fromAsset;
  }
  return lookupInMap(file.clips, tail);
};

export const upsertClipTrim = (
  file: ClipTrimsFile,
  tail: string,
  trim: ClipTrim | null,
  glbPath?: string | null,
): ClipTrimsFile => {
  const next = normalizeClipTrims(file);
  const path = glbPath ? normalizePath(glbPath) : '';
  const write = (map: Record<string, ClipTrim>) => {
    for (const key of Object.keys(map)) {
      if (key.toLowerCase() === tail.toLowerCase()) delete map[key];
    }
    if (trim) map[tail] = { start: trim.start, end: trim.end };
  };
  write(next.clips);
  if (path) {
    next.assets ??= {};
    next.assets[path] ??= {};
    write(next.assets[path]);
    if (!Object.keys(next.assets[path]).length) delete next.assets[path];
  }
  return next;
};

export const clipFps = (clip: AnimationGroup) =>
  clip.targetedAnimations[0]?.animation.framePerSecond || 30;

export const clipFullDurationSec = (clip: AnimationGroup) => {
  const fps = clipFps(clip);
  return Math.max(0, (clip.to - clip.from) / fps);
};

export const clipPlayRange = (
  clip: AnimationGroup,
  trim: ClipTrim | null | undefined,
): { from: number; to: number } => {
  const fps = clipFps(clip);
  const fullFrom = clip.from;
  const fullTo = clip.to;
  if (!trim) return { from: fullFrom, to: fullTo };
  const start = Number.isFinite(trim.start) ? trim.start : 0;
  const end = Number.isFinite(trim.end) ? trim.end : clipFullDurationSec(clip);
  const from = fullFrom + start * fps;
  const to = fullFrom + end * fps;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return {
    from: Math.max(fullFrom, Math.min(lo, fullTo)),
    to: Math.max(fullFrom, Math.min(Math.max(hi, lo + 1 / fps), fullTo)),
  };
};
