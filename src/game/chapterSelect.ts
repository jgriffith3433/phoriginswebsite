/**
 * Chapter Select: eight painted cards built from the save (best time, lore found n of m, what was chosen there),
 * the hidden lore objects each chapter holds, and the short music cue a card plays on hover or focus.
 * Copy is in locales/en.json (`lore.N.found.K`, `ui.chapters.*`). Art is `assets/textures/chapters/NN.webp`
 * (capped 960x540); a card draws its own painted-gradient stand-in until the file exists.
 */
import * as BABYLON from '@babylonjs/core';

import { lineText } from './locale';
import { playClip, type ClipHandle } from './sfxMix';

export const CHAPTER_COUNT = 8;

export type LoreSpot = { id: string; x: number; z: number; y?: number };

/**
 * Three hidden pages per chapter, on the floor of a room the story already walks through (coordinates are inside
 * known rooms: see the spawn table in chapterOpening.ts and the level notes in AGENTS.md). Finding all three also
 * unlocks that chapter's lore entry.
 */
export const LORE_SPOTS: Record<number, LoreSpot[]> = {
  1: [{ id: 'bath', x: 16.9, z: 28.15, y: 0.01 }, { id: 'office', x: 27, z: 32 }, { id: 'hall', x: 0, z: 19 }],
  2: [{ id: 'pipe', x: 44.25, z: 28 }, { id: 'decon', x: 7.5, z: 26 }, { id: 'long', x: 26, z: 38 }],
  3: [{ id: 'pipe', x: 44.25, z: 33 }, { id: 'long', x: 30, z: 38 }, { id: 'door', x: 20, z: 38 }],
  4: [{ id: 'office', x: 50.5, z: 42 }, { id: 'bath', x: 16.9, z: 28.15, y: 0.01 }, { id: 'hall', x: 27, z: 32 }],
  5: [{ id: 'near', x: 30, z: 22.6 }, { id: 'mid', x: 55, z: 22.6 }, { id: 'far', x: 78, z: 22.6 }],
  6: [{ id: 'stairs', x: 14, z: -1.6 }, { id: 'mid', x: 30, z: -1.6 }, { id: 'edge', x: 44, z: -1.6 }],
  7: [{ id: 'one', x: 4.5, z: 0.4 }, { id: 'two', x: 9, z: -0.4 }, { id: 'three', x: 13.4, z: 0.4 }],
  8: [{ id: 'sofa', x: 5, z: 1.8 }, { id: 'tv', x: 1, z: -2.2 }, { id: 'door', x: 7.2, z: 2.2 }],
};

/** The bed each card cues (the level's own music trigger). */
export const CHAPTER_BEDS: Record<number, string> = {
  1: '/assets/audio/ambient/office-night.ogg',
  2: '/assets/audio/ambient/b3-drone.ogg',
  3: '/assets/audio/ambient/b3-drone.ogg',
  4: '/assets/audio/ambient/office-night.ogg',
  5: '/assets/audio/ambient/street-night.ogg',
  6: '/assets/audio/ambient/platform.ogg',
  7: '/assets/audio/train/rumble.ogg',
  8: '/assets/audio/ambient/morning-room.ogg',
};

export type ChapterProgress = {
  best?: Record<string, number>;
  found?: Record<string, string[]>;
};

export const loreTotal = (n: number) => LORE_SPOTS[n]?.length ?? 0;
export const loreFoundCount = (p: ChapterProgress, n: number) =>
  (p.found?.[String(n)] ?? []).filter((id) => LORE_SPOTS[n]?.some((s) => s.id === id)).length;

export const formatBest = (seconds: number | undefined) => {
  if (!seconds || seconds <= 0) return '--:--';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const loreFoundLine = (n: number, id: string) => lineText(`lore.${n}.found.${id}`, '');

export const chapterArtUrl = (n: number) => `/assets/textures/chapters/${String(n).padStart(2, '0')}.webp`;

export type ChapterCard = {
  n: number;
  title: string;
  reward: string;
  unlocked: boolean;
  best?: number;
  found: number;
  total: number;
  outcome: string;
  onPick: () => void;
};

let cue: ClipHandle | null = null;
let cueTimer = 0;
let cueCount = 0;
let cueLast = 0;
/** Plays the first couple of seconds of a chapter's bed; a new card cuts the last one. */
export const playChapterCue = (n: number) => {
  stopChapterCue();
  const url = CHAPTER_BEDS[n];
  if (!url) return;
  cueCount += 1;
  cueLast = n;
  cue = playClip(url, 0.3, {
    bus: 'music',
    onError: () => { playClip('/assets/audio/room-tone.mp3', 0.2, { bus: 'music' })?.stop(1.4); },
  });
  cueTimer = window.setTimeout(() => cue?.stop(0.5), 1800);
};
export const stopChapterCue = () => {
  window.clearTimeout(cueTimer);
  cue?.stop(0.15);
  cue = null;
};
export const chapterCueLog = () => ({ plays: cueCount, last: cueLast });

/** Fills `list` with one tappable card per chapter. */
export const renderChapterCards = (list: HTMLElement, cards: ChapterCard[]) => {
  list.innerHTML = '';
  for (const card of cards) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chapter-card${card.unlocked ? '' : ' locked'}`;
    button.dataset.chapter = String(card.n);
    button.dataset.unlocked = card.unlocked ? 'true' : 'false';
    button.disabled = !card.unlocked;
    button.setAttribute('aria-disabled', card.unlocked ? 'false' : 'true');
    const lore = card.unlocked ? `${lineText('ui.chapters.lore', 'Lore')} ${card.found} ${lineText('ui.chapters.of', 'of')} ${card.total}` : lineText('ui.chapters.locked', 'Locked');
    const best = card.unlocked ? `${lineText('ui.chapters.best', 'Best')} ${formatBest(card.best)}` : '';
    button.innerHTML = `
      <span class="chapter-art" data-art="${card.n}" aria-hidden="true"></span>
      <span class="chapter-body">
        <span class="chapter-kicker">${lineText('ui.chapters.chapter', 'Chapter')} ${card.n}</span>
        <strong class="chapter-title"></strong>
        <span class="chapter-stats"><span class="chapter-best">${best}</span><span class="chapter-lore">${lore}</span></span>
        <span class="chapter-outcome"></span>
      </span>`;
    (button.querySelector('.chapter-title') as HTMLElement).textContent = card.title;
    (button.querySelector('.chapter-outcome') as HTMLElement).textContent = card.unlocked ? card.outcome : card.reward;
    // Painted art loads at its capped size; until it does (or if it never does) the CSS gradient stands in.
    const art = button.querySelector('.chapter-art') as HTMLElement;
    const image = new Image();
    image.onload = () => { art.style.backgroundImage = `url(${image.src})`; art.classList.add('painted'); };
    image.decoding = 'async';
    image.src = chapterArtUrl(card.n);
    if (card.unlocked) {
      button.addEventListener('pointerenter', (event) => { if ((event as PointerEvent).pointerType === 'mouse') playChapterCue(card.n); });
      button.addEventListener('focus', () => playChapterCue(card.n));
    }
    button.addEventListener('click', () => { stopChapterCue(); card.onPick(); });
    list.appendChild(button);
  }
};

/** Hidden pages lying on the floor; walking within a metre and a half picks one up. */
export type LoreObjects = {
  mount: (chapter: number, found: readonly string[]) => void;
  dispose: () => void;
  step: (delta: number) => void;
  /** Spot centres still lying in the world (probe). */
  remaining: () => { id: string; x: number; z: number }[];
};

export const createLoreObjects = (host: {
  scene: BABYLON.Scene;
  playerXZ: () => { x: number; z: number };
  active: () => boolean;
  onFound: (chapter: number, id: string) => void;
}): LoreObjects => {
  type Live = { spot: LoreSpot; root: BABYLON.TransformNode };
  let live: Live[] = [];
  let chapter = 0;
  let material: BABYLON.StandardMaterial | null = null;
  let glow: BABYLON.StandardMaterial | null = null;
  let t = 0;

  const dispose = () => {
    for (const l of live) l.root.dispose(false, false);
    live = [];
    material?.dispose();
    glow?.dispose();
    material = glow = null;
  };

  return {
    mount(n, found) {
      dispose();
      chapter = n;
      const { scene } = host;
      material = new BABYLON.StandardMaterial('lore-page', scene);
      material.disableLighting = true;
      material.emissiveColor = new BABYLON.Color3(0.92, 0.78, 0.42);
      glow = new BABYLON.StandardMaterial('lore-glow', scene);
      glow.disableLighting = true;
      glow.emissiveColor = new BABYLON.Color3(0.85, 0.6, 0.2);
      glow.alpha = 0.35;
      glow.backFaceCulling = false;
      for (const spot of LORE_SPOTS[n] ?? []) {
        if (found.includes(spot.id)) continue;
        const root = new BABYLON.TransformNode(`lore-${n}-${spot.id}`, scene);
        root.position.set(spot.x, spot.y ?? 0, spot.z);
        root.rotation.y = (spot.x * 7.3 + spot.z * 3.1) % Math.PI;
        // A folded page lying flat on the floor, with a soft pool of light under it so it reads from across the room.
        const page = BABYLON.MeshBuilder.CreateBox(`lore-page-${spot.id}`, { width: 0.3, height: 0.02, depth: 0.22 }, scene);
        page.position.y = 0.04;
        page.material = material;
        page.parent = root;
        page.isPickable = false;
        page.checkCollisions = false;
        const pool = BABYLON.MeshBuilder.CreateDisc(`lore-glow-${spot.id}`, { radius: 0.5, tessellation: 24 }, scene);
        pool.rotation.x = Math.PI / 2;
        pool.position.y = 0.03;
        pool.material = glow;
        pool.parent = root;
        pool.isPickable = false;
        pool.checkCollisions = false;
        live.push({ spot, root });
      }
    },
    dispose,
    step(delta) {
      if (!live.length) return;
      t += delta;
      if (glow) glow.alpha = 0.3 + 0.12 * Math.sin(t * 2.4);
      if (!host.active()) return;
      const p = host.playerXZ();
      for (const l of [...live]) {
        if (Math.hypot(p.x - l.spot.x, p.z - l.spot.z) > 1.5) continue;
        live = live.filter((x) => x !== l);
        l.root.dispose(false, false);
        host.onFound(chapter, l.spot.id);
      }
    },
    remaining: () => live.map((l) => ({ id: l.spot.id, x: l.spot.x, z: l.spot.z })),
  };
};
