/**
 * Staged crowd reactions to Shadow Pierce (Going Home, The Station, The Train).
 * Notice → panic / film / cower; voiced barks across many voices; a lit phone for filming;
 * companions call out to a possessed body; train riders pull the emergency handle or hide.
 * Probe: crowd() / home.crowd() / station.crowd() / train.crowd().
 */
import * as BABYLON from '@babylonjs/core';

import { lineAudio, lineSpeaker, lineText } from '../game/locale';
import { createLinePool, placeLine, type PlaceLine } from './placeVoices';
import type { PlayerAvatar } from '../game/playerAvatar';

export type CrowdStage = 'notice' | 'panic' | 'film' | 'cower' | 'handle' | 'hide';

export type CrowdKind = 'notice' | 'panic' | 'film' | 'cower' | 'companion' | 'train';

const ids = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);

/** Forty reaction barks: at least three per kind, six+ voices across the catalog. */
export const CROWD_NOTICE = ids('bark.crowd.notice.', 10);
export const CROWD_PANIC = ids('bark.crowd.panic.', 10);
export const CROWD_FILM = ids('bark.crowd.film.', 8);
export const CROWD_COWER = ids('bark.crowd.cower.', 6);
export const CROWD_COMPANION = ids('bark.crowd.companion.', 3);
export const CROWD_TRAIN = ids('bark.crowd.train.', 3);

export const CROWD_ALL = [
  ...CROWD_NOTICE,
  ...CROWD_PANIC,
  ...CROWD_FILM,
  ...CROWD_COWER,
  ...CROWD_COMPANION,
  ...CROWD_TRAIN,
] as const;

const noticePool = createLinePool(CROWD_NOTICE);
const panicPool = createLinePool(CROWD_PANIC);
const filmPool = createLinePool(CROWD_FILM);
const cowerPool = createLinePool(CROWD_COWER);
const companionPool = createLinePool(CROWD_COMPANION);
const trainPool = createLinePool(CROWD_TRAIN);

/** How far Shadow Pierce is noticed (metres). */
export const NOTICE_RANGE = 11;
/** How long notice holds before the next stage. */
export const NOTICE_HOLD = 0.85;
/** Phone / low tier: at most this many people animate a reaction at once. */
export const MAX_REACT_PHONE = 6;
export const MAX_REACT_DESKTOP = 12;
/** Soft separation radius so reactors do not walk through each other. */
export const SEPARATION = 0.72;

export type CrowdStats = {
  witnesses: number;
  voiced: number;
  voices: string[];
  voiceCount: number;
  filmers: number;
  panickers: number;
  cowers: number;
  companions: number;
  handles: number;
  hides: number;
  reacting: number;
  lastLine: string;
  lastLines: string[];
  repeatsBackToBack: number;
  within2s: number;
};

export type CrowdHost = {
  scene: BABYLON.Scene;
  playFile: (url: string, volume: number) => void;
  showLine?: (title: string, text: string) => void;
};

type PhoneProp = {
  root: BABYLON.TransformNode;
  light: BABYLON.PointLight;
};

const isPhone = () =>
  typeof document !== 'undefined'
  && (document.body.dataset.device === 'mobile' || document.body.dataset.device === 'tablet');

export const reactCap = () => (isPhone() ? MAX_REACT_PHONE : MAX_REACT_DESKTOP);

const pickPool = (kind: CrowdKind) => {
  if (kind === 'notice') return noticePool;
  if (kind === 'panic') return panicPool;
  if (kind === 'film') return filmPool;
  if (kind === 'cower') return cowerPool;
  if (kind === 'companion') return companionPool;
  return trainPool;
};

/** Stand-in when a bark's file is still missing: existing street screams cycle by kind. */
const FALLBACK_BY_KIND: Record<CrowdKind, string[]> = {
  notice: [
    '/assets/audio/street/bark-cold.ogg',
    '/assets/audio/street/bark-walk.ogg',
    '/assets/audio/street/bark-tower.ogg',
  ],
  panic: [
    '/assets/audio/sfx/street/scream-woman.ogg',
    '/assets/audio/sfx/street/scream-man.ogg',
    '/assets/audio/sfx/street/scream-man-b.ogg',
    '/assets/audio/street/pedestrian-away.ogg',
  ],
  film: [
    '/assets/audio/street/bark-hear.ogg',
    '/assets/audio/street/talk-tower-a.ogg',
  ],
  cower: [
    '/assets/audio/sfx/street/scream-man.ogg',
    '/assets/audio/street/bark-walk.ogg',
  ],
  companion: [
    '/assets/audio/street/bark-hear.ogg',
    '/assets/audio/sfx/street/scream-woman.ogg',
  ],
  train: [
    '/assets/audio/sfx/street/scream-man-b.ogg',
    '/assets/audio/street/pedestrian-away.ogg',
  ],
};

let fallbackTurn = 0;

const fallbackUrl = (kind: CrowdKind) => {
  const pool = FALLBACK_BY_KIND[kind];
  fallbackTurn += 1;
  return pool[fallbackTurn % pool.length];
};

export const createCrowdReact = (host: CrowdHost) => {
  const witnesses = new Set<string>();
  const voices = new Set<string>();
  const lastLines: string[] = [];
  let lastLine = '';
  let repeatsBackToBack = 0;
  let voiced = 0;
  let filmers = 0;
  let panickers = 0;
  let cowers = 0;
  let companions = 0;
  let handles = 0;
  let hides = 0;
  let within2s = 0;
  let shadowSince = -1;
  let reacting = 0;
  const phones = new Map<string, PhoneProp>();
  const drops: BABYLON.Mesh[] = [];

  const reset = () => {
    witnesses.clear();
    voices.clear();
    lastLines.length = 0;
    lastLine = '';
    repeatsBackToBack = 0;
    voiced = 0;
    filmers = 0;
    panickers = 0;
    cowers = 0;
    companions = 0;
    handles = 0;
    hides = 0;
    within2s = 0;
    shadowSince = -1;
    reacting = 0;
    for (const phone of phones.values()) {
      phone.light.dispose();
      phone.root.dispose();
    }
    phones.clear();
    for (const drop of drops) drop.dispose();
    drops.length = 0;
  };

  const markShadow = (on: boolean, streetTime: number) => {
    if (on && shadowSince < 0) shadowSince = streetTime;
    if (!on) shadowSince = -1;
  };

  const say = (kind: CrowdKind, volume = 0.72): PlaceLine | null => {
    const picked = pickPool(kind)();
    const id = picked?.id ?? '';
    const speaker = picked?.speaker || lineSpeaker(id, 'Passerby');
    const text = picked?.text || lineText(id);
    const catalog = picked?.url || lineAudio(id);
    const url = catalog || fallbackUrl(kind);
    if (!url) return null;
    if (id && id === lastLine) repeatsBackToBack += 1;
    if (id) {
      lastLine = id;
      lastLines.push(id);
      if (lastLines.length > 24) lastLines.shift();
    }
    voices.add(speaker);
    voiced += 1;
    host.playFile(url, volume);
    if (text) host.showLine?.(speaker, text);
    return picked ?? placeLine(id) ?? { id: id || `fallback.${kind}`, speaker, text, url };
  };

  const noteWitness = (id: string, streetTime: number) => {
    if (witnesses.has(id)) return false;
    witnesses.add(id);
    return true;
  };

  /** A voiced reaction that landed inside the first 2 s of this Shadow bout. */
  const noteVoicedInWindow = (streetTime: number) => {
    if (shadowSince >= 0 && streetTime - shadowSince <= 2.05) within2s += 1;
  };

  const countReacting = (n: number) => {
    reacting = n;
  };

  const canAnimate = () => reacting < reactCap();

  /** Raise a lit phone in the right hand (or at chest height if the bone is missing). */
  const raisePhone = (id: string, avatar: PlayerAvatar) => {
    if (phones.has(id)) return;
    const hand = avatar.findJoint('RightHand') ?? avatar.findJoint('LeftHand');
    const root = new BABYLON.TransformNode(`crowd-phone-${id}`, host.scene);
    const body = BABYLON.MeshBuilder.CreateBox(`crowd-phone-body-${id}`, { width: 0.05, height: 0.1, depth: 0.012 }, host.scene);
    const mat = new BABYLON.StandardMaterial(`crowd-phone-mat-${id}`, host.scene);
    mat.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.06);
    mat.emissiveColor = new BABYLON.Color3(0.35, 0.55, 0.9);
    mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.12);
    body.material = mat;
    body.parent = root;
    body.position.set(0, 0.05, 0.01);
    const light = new BABYLON.PointLight(`crowd-phone-light-${id}`, new BABYLON.Vector3(0, 0.08, 0.06), host.scene);
    light.intensity = 0.55;
    light.range = 2.4;
    light.diffuse = new BABYLON.Color3(0.55, 0.7, 1);
    light.parent = root;
    if (hand) {
      root.parent = hand;
      root.position.set(0.02, 0.08, 0.04);
      root.rotation.set(-0.9, 0.2, 0.1);
    } else {
      root.parent = avatar.group;
      root.position.set(0.18, 1.35, 0.22);
    }
    phones.set(id, { root, light });
    filmers += 1;
  };

  const dropPhone = (id: string) => {
    const phone = phones.get(id);
    if (!phone) return;
    phone.light.dispose();
    phone.root.dispose();
    phones.delete(id);
  };

  /** Drop a carried bag/phone onto the ground when panic starts. */
  const dropCarry = (id: string, x: number, y: number, z: number) => {
    const bag = BABYLON.MeshBuilder.CreateBox(`crowd-drop-${id}-${drops.length}`, { width: 0.18, height: 0.12, depth: 0.08 }, host.scene);
    const mat = new BABYLON.StandardMaterial(`crowd-drop-mat-${id}`, host.scene);
    mat.diffuseColor = new BABYLON.Color3(0.22, 0.16, 0.1);
    bag.material = mat;
    bag.position.set(x + 0.25, y + 0.9, z);
    bag.rotation.y = Math.random() * Math.PI;
    drops.push(bag);
    // Settle onto the curb over a short fall (visual only; feet stay grounded on the walker).
    let t = 0;
    const startY = bag.position.y;
    const ground = y + 0.06;
    const obs = host.scene.onBeforeRenderObservable.add(() => {
      t += host.scene.getEngine().getDeltaTime() / 1000;
      const u = Math.min(1, t / 0.45);
      bag.position.y = startY + (ground - startY) * (u * u);
      bag.rotation.x = u * 1.1;
      if (u >= 1) host.scene.onBeforeRenderObservable.remove(obs);
    });
  };

  const markPanic = () => { panickers += 1; };
  const markCower = () => { cowers += 1; };
  const markCompanion = () => { companions += 1; };
  const markHandle = () => { handles += 1; };
  const markHide = () => { hides += 1; };

  /** Soft push so two reactors do not occupy the same spot. */
  const separate = (
    self: { x: number; z: number },
    others: { x: number; z: number }[],
    radius = SEPARATION,
  ) => {
    let ox = 0;
    let oz = 0;
    for (const o of others) {
      const dx = self.x - o.x;
      const dz = self.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.001 || d >= radius) continue;
      const push = (radius - d) / radius;
      ox += (dx / d) * push * 0.35;
      oz += (dz / d) * push * 0.35;
    }
    return { x: ox, z: oz };
  };

  /** Prefer yelling when the rig has it; else walk / idle / sitidle as stand-ins until Gen flee/cower clips land. */
  const playStageClip = (avatar: PlayerAvatar, stage: CrowdStage, moving: boolean) => {
    if (stage === 'panic' || stage === 'hide') {
      if (avatar.hasClip('yellingout') && !moving) {
        avatar.playClip('yellingout', true);
        return;
      }
      avatar.setLocomotion(moving, true);
      if (moving) avatar.playClip('walk', true);
      else if (avatar.hasClip('yellingout')) avatar.playClip('yellingout', true);
      else avatar.playClip('idle', true);
      return;
    }
    if (stage === 'cower') {
      if (avatar.hasClip('cower')) {
        avatar.playClip('cower', true);
        return;
      }
      if (avatar.hasClip('crouch')) {
        avatar.playClip('crouch', true);
        return;
      }
      // SitIdle reads as tucked down until a real cower clip is baked onto the NPCs.
      if (avatar.hasClip('sit')) {
        avatar.playClip('sit', true);
        return;
      }
      avatar.playClip('idle', true);
      return;
    }
    if (stage === 'film' || stage === 'notice' || stage === 'handle') {
      avatar.setLocomotion(false, true);
      avatar.playClip('idle', true);
      return;
    }
  };

  const stats = (): CrowdStats => ({
    witnesses: witnesses.size,
    voiced,
    voices: [...voices],
    voiceCount: voices.size,
    filmers,
    panickers,
    cowers,
    companions,
    handles,
    hides,
    reacting,
    lastLine,
    lastLines: [...lastLines],
    repeatsBackToBack,
    within2s,
  });

  return {
    reset,
    markShadow,
    say,
    noteWitness,
    noteVoicedInWindow,
    countReacting,
    canAnimate,
    raisePhone,
    dropPhone,
    dropCarry,
    markPanic,
    markCower,
    markCompanion,
    markHandle,
    markHide,
    separate,
    playStageClip,
    stats,
  };
};

export type CrowdReact = ReturnType<typeof createCrowdReact>;

/** Roll the stage after notice: panic most often, then film, then cower. */
export const rollAfterNotice = (seed = Math.random()): Exclude<CrowdStage, 'notice' | 'handle' | 'hide'> => {
  if (seed < 0.55) return 'panic';
  if (seed < 0.8) return 'film';
  return 'cower';
};
