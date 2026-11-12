import * as BABYLON from '@babylonjs/core';

import { PLACE_SFX } from './placeVoices';
import { createCharacterAvatar, type PlayerAvatar } from '../game/playerAvatar';
import { TRANSFORM_HERO_ASSET_ID } from '../game/modelLoader';
import { DOUBLE_LAYER } from './bathroomMirror';
import { carryItems, lineAudio, lineSpeaker, lineText } from '../game/locale';
import { voiceBusy } from '../game/sfxMix';
import { deathsBucket, ledgerBand, type LedgerApi, type LedgerBand } from '../game/ledger';
import type { StoryCarry } from './act1';

/**
 * Level 8, The Morning (`levels/the-morning.json`, beat sheet in docs/story/level-8-beat-sheet.md).
 * Pierce's apartment: one room, built at runtime on top of the authored shell (floor, walls, lamps).
 *
 *   home    Control at the door. "It still knows my hand." Objective: the bed. Action: Sleep.
 *   sleep   Scene: black, he lies down in the bed, a morning comes up, "I slept." / "I don't sleep." The TV
 *           switches itself on. Control returns.
 *   news    Action: Watch (the television). Scene: the morning programme on a canvas TV (stills, headline, ticker,
 *           anchor captions). It names Hawkes Tower and Pierce Hawkes. Public-safe: no B3, vat or creature.
 *   call    Voss rings (`voss-morning`, two-way: two reply moments, and the opening and closing lines branch on `vossTrust`). The player answers with F.
 *   out     Free walk to the front door while the camera slowly pushes in. The hall mirror shows him as the Shadow form.
 *           Action at the coat: Take coat (his closing line, the canon one from the beat sheet).
 *   door    Action: Leave. The door opens onto white and `host.beginEnding()` hands over to morningEnding.ts (title,
 *           credits over empty places, the Act II call, the end card). There is no End Level press any more.
 *
 * The anchor is on-screen captions only for now (no voice). Stills are drawn on the canvas as placeholders.
 */

export type MorningHost = {
  /** The street ledger on the save: picks the TV report, the newspaper headline and Voss's call. */
  ledger: LedgerApi;
  scene: BABYLON.Scene;
  placePierce: (x: number, z: number, yaw: number) => void;
  /** Lie Pierce flat on his back at this spot (feet end at x, z), or stand him up again. */
  lie: (on: boolean, x: number, y: number, z: number, yaw: number) => void;
  /**
   * Pose the body about its pelvis: the pelvis sits at (x, y, z), turned to `yaw`, tipped back `pitch` radians
   * (0 upright, PI/2 flat on the back) and rolled `roll`. `pelvis` is the pelvis height above the feet in the
   * clip that is playing, so a seated pose keeps its feet on the floor.
   */
  poseBody: (x: number, y: number, z: number, yaw: number, pitch: number, roll: number, pelvis: number) => void;
  playClip: (clip: string, loop: boolean, speed?: number) => boolean | void;
  frameCamera: (position: { x: number; y: number; z: number }, lookAt: { x: number; y: number; z: number }) => void;
  releaseCamera: () => void;
  stepCineScene?: (
    sceneId: 'tv-news' | 'voss-morning-call',
    atSeconds: number,
    dt: number,
    opts?: {
      speaker?: string;
      lineKey?: string;
      speakerPosOverride?: { x: number; y: number; z: number };
      applyCamera?: boolean;
    },
  ) => void;
  endCineScene?: (clearCam?: boolean) => void;
  fade: (to: number, seconds?: number) => void;
  showLine: (title: string, text: string) => void;
  holdScene: (held: boolean) => void;
  clearMarker: () => void;
  showObjective: (visible: boolean) => void;
  setObjective: (title: string, text: string, target: { x: number; z: number; y?: number } | null) => void;
  playFile: (url: string, volume: number) => void;
  setWalk: (moving: boolean) => void;
  setCarry: (items: StoryCarry[]) => void;
  playerXZ: () => { x: number; z: number };
  resumeLocomotion: () => void;
  /** The door is opening: black, the title, the credits and the Act II card follow (morningEnding.ts). */
  beginEnding: () => void;
  /** Slow camera push-in while he walks to the door: 0 none, 1 closest. */
  setPush: (k: number) => void;
  /** Pierce's avatar root, for the mirror's reflection. */
  playerNode: () => BABYLON.TransformNode;
  clearInput: () => void;
  unlockNext: () => void;
  refreshHud: () => void;
  ringCall: (id: string) => void;
  /** A call is ringing or on (the phone holds the body). */
  callBusy: () => boolean;
};

export type MorningStory = {
  beat: 'ride' | 'walk' | 'home' | 'sleep' | 'wake' | 'news' | 'call' | 'out' | 'coat' | 'door' | 'leaving' | 'done';
  lying: boolean;
  tvOn: boolean;
  /** 0–1 mean luminance of the TV canvas (quiet-light spill tracks the picture). */
  tvBright: number;
  /** Everything the TV has shown so far (headline and still captions), for the playtest. */
  tvText: string;
  captions: number;
  callDone: boolean;
  /** Beat-sheet scene now playing, 0 (S0, the ride) through 6 (S6, the exit). */
  scene: number;
  /** Every scene reached so far, in order (S0..S6), for the playtest. */
  scenes: number[];
  /** The hall mirror shows the Shadow form (double ready and the glass drawing). */
  mirrorShadow: boolean;
  coatTaken: boolean;
  push: number;
  /** The street ledger as this morning read it: band 0 no one hurt, 1 injuries, 2 deaths, and the kill count. */
  band: number;
  kills: number;
  /** The id of the fourth TV report (the one the ledger changes) once it has played. */
  report: string;
  /** The newspaper on the table: its headline, and whether the player read it. */
  paper: string;
  paperRead: boolean;
  /** The bed scene's pose: phase, tip back in radians, roll, pelvis height over the floor, clip, walked metres. */
  pose: { phase: string; pitch: number; roll: number; x: number; y: number; z: number; clip: string; frames: number; minOverMattress: number; walked: number };
  /** The TV picture: on, hash of sampled pixels (changes as it plays), draws so far, texture bound to the screen mesh. */
  tv: { on: boolean; hash: number; frames: number; bound: boolean; visible: boolean; covered: boolean };
  /** Voiced lines this room asked for; `heard` once the voice channel went quiet after the line started. */
  lines: { id: string; at: number; heard: boolean; audio: boolean }[];
};

export const ENDING_TRACK = '/assets/audio/ending-6.mp3';

const START = { x: 1.3, z: 2.0, yaw: Math.PI };
const BED = { x: 6.7, z: -1.9 };
const BED_SIDE = { x: 5.9, z: -0.45, yaw: Math.PI };
const TV = { x: 3.2, z: -2.95 };
const WATCH = { x: 3.2, z: -0.4 };
const DOOR = { x: 1.2, z: 2.7 };
const MIRROR = { x: 2.35, y: 1.3, z: 2.94 };
const COAT = { x: 3.45, z: 2.45 };
/** The newspaper on the coffee table (top at y 0.4) and where he stands to read it. */
const PAPER = { x: 3.2, y: 0.408, z: -1.3 };
const READ_AT = { x: 3.2, z: -0.4 };
/** How far the front door opens on Leave, in radians. */
const DOOR_SWING = 1.3;

const CARRY: StoryCarry[] = [
  { id: 'phone', name: 'Phone', note: 'F. Voss will ring.' },
];
const COAT_ITEM: StoryCarry = { id: 'coat', name: 'Coat', note: 'His own. It still fits.' };

type Line = { id: string; speaker: string; hold: number; volume?: number };
const L_HAND: Line = { id: 'dialogue.morning.hand', speaker: 'Pierce', hold: 2.6 };
const L_HOME: Line = { id: 'dialogue.morning.home', speaker: 'Pierce', hold: 1.6 };
const L_SLEPT: Line = { id: 'dialogue.morning.slept', speaker: 'Pierce', hold: 2.0 };
const L_DONT: Line = { id: 'dialogue.morning.dont', speaker: 'Pierce', hold: 2.4 };
const L_WITHOUT: Line = { id: 'dialogue.morning.without', speaker: 'Pierce', hold: 3.6 };
const L_MINE: Line = { id: 'dialogue.morning.mine', speaker: 'Pierce', hold: 2.2 };
const L_BLOCKS: Line = { id: 'dialogue.morning.blocks', speaker: 'Pierce', hold: 4.2 };
const L_WALKS: Line = { id: 'dialogue.morning.walks', speaker: 'Pierce', hold: 5.2 };
const COAT_SCENE_SECONDS = 8.2;

const NEWS_CAPTIONS = [1, 2, 3, 4].map((n) => `news.morning.${String(n).padStart(2, '0')}`);
/** Which still each lower third sits over. The ticker on the set carries the rest, so the scene stays short. */
const NEWS_STILLS = ['tower', 'portrait', 'board', 'police'] as const;
const TICKERS = [1, 2, 3, 4].map((n) => `news.morning.tick.${n}`);
const FALLBACK_NEWS = [
  'Hawkes Biomedical has removed its founder as chairman.',
  "The board says Pierce Hawkes walked out of last night's meeting.",
  'Director Hale is interim chairman. Voss backed the vote.',
  'Police were at Hawkes Tower overnight. No one was hurt.',
];

/** The fourth report is the one the ledger changes: no one hurt, injuries, or deaths with a count (docs/story/ledger.md). */
const REPORT_FALLBACK: Record<string, string> = {
  'news.morning.04': FALLBACK_NEWS[3],
  'news.morning.04.b1': 'Police were at Hawkes Tower overnight. One man was taken to hospital from the avenue.',
  'news.morning.04.d2': 'Police were at Hawkes Tower overnight. Two people died on the avenue.',
  'news.morning.04.d3': 'Police were at Hawkes Tower overnight. Three people died on the avenue.',
  'news.morning.04.d4': 'Police were at Hawkes Tower overnight. Four people died on the avenue.',
  'news.morning.04.d5': 'Police were at Hawkes Tower overnight. Five or more people died on the avenue. Police are asking who was there.',
};
const TICK_FALLBACK: Record<string, string> = {
  'news.morning.tick.4': 'POLICE: NO ONE HURT AT HAWKES TOWER',
  'news.morning.tick.4.b1': 'POLICE: ONE MAN TO HOSPITAL FROM TOWER AVENUE',
  'news.morning.tick.4.d2': 'POLICE: TWO DEAD ON TOWER AVENUE',
  'news.morning.tick.4.d3': 'POLICE: THREE DEAD ON TOWER AVENUE',
  'news.morning.tick.4.d4': 'POLICE: FOUR DEAD ON TOWER AVENUE',
  'news.morning.tick.4.d5': 'POLICE: FIVE OR MORE DEAD ON TOWER AVENUE',
};
const PAPER_FALLBACK: Record<string, string> = {
  b0: 'A QUIET NIGHT\nON TOWER AVENUE\nHawkes chairman out. Police found no one hurt.',
  b1: 'MAN TAKEN TO\nHOSPITAL ON AVENUE\nPolice ask who was on Tower Avenue last night.',
  d2: 'TWO DEAD ON\nTOWER AVENUE\nPolice: no weapon, no suspect.',
  d3: 'THREE DEAD ON\nTOWER AVENUE\nPolice: no weapon, no suspect.',
  d4: 'FOUR DEAD ON\nTOWER AVENUE\nPolice: no weapon, no suspect.',
  d5: 'FIVE OR MORE DEAD\nON TOWER AVENUE\nPolice: no weapon, no suspect.',
};
/** Which variant the ledger picks: b0, b1, or d2..d5 (deaths, with the count). */
const variantOf = (band: LedgerBand, kills: number) => (band === 0 ? 'b0' : band === 1 ? 'b1' : `d${deathsBucket(kills)}`);
const reportId = (variant: string) => (variant === 'b0' ? 'news.morning.04' : `news.morning.04.${variant}`);
const tickId = (variant: string) => (variant === 'b0' ? 'news.morning.tick.4' : `news.morning.tick.4.${variant}`);
const REACT_ID: Record<string, string> = { b0: 'dialogue.morning.paper.b0', b1: 'dialogue.morning.paper.b1', d: 'dialogue.morning.paper.b2' };
const REACT_HOLD = 3.4;

const caption = (index: number, variant = 'b0') => {
  if (index === 3) {
    const id = reportId(variant);
    return lineText(id, REPORT_FALLBACK[id]);
  }
  return lineText(NEWS_CAPTIONS[index], FALLBACK_NEWS[index]);
};
const captionKey = (index: number, variant: string) => (index === 3 ? reportId(variant) : NEWS_CAPTIONS[index]);
const holdFor = (text: string) => Math.max(3, text.length / 16 + 1.4);

const mat = (scene: BABYLON.Scene, name: string, r: number, g: number, b: number, emissive = 0) => {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = new BABYLON.Color3(r, g, b);
  m.specularColor = new BABYLON.Color3(0.03, 0.03, 0.03);
  if (emissive > 0) m.emissiveColor = new BABYLON.Color3(r * emissive, g * emissive, b * emissive);
  return m;
};

export const createTheMorning = (host: MorningHost) => {
  let active = false;
  let playing = false;
  let beat: MorningStory['beat'] = 'home';
  let time = 0;
  let lineUntil = 0;
  let flags = new Set<string>();
  let tvOn = false;
  let tvBright = 0;
  let tvHash = 0;
  let tvFrames = 0;
  let tvSeen: string[] = [];
  let paperMesh: BABYLON.Mesh | null = null;
  let paperText = '';
  let paperRead = false;
  let reading = 0;
  let readLine = '';
  let reportSeen = '';
  let snap = { band: 0 as LedgerBand, kills: 0 };
  const variant = () => variantOf(snap.band, snap.kills);
  const readLedger = () => {
    const now = host.ledger.get();
    snap = { band: ledgerBand(now), kills: now.kills };
  };
  let captionsShown = 0;
  let callDone = false;
  let rang = false;
  let ringIn = -1;
  let ringSince = 0;
  let wasBusy = false;
  let blink = 0;
  let still: (typeof NEWS_STILLS)[number] | 'static' | 'off' = 'off';
  let tvClock = 0;
  let lastDt = 0.016;
  let newsT = 0;
  let scenes: number[] = [];
  let coatTaken = false;
  let pushT = 0;
  let push = 0;
  let hallMaterial: BABYLON.StandardMaterial | null = null;
  let mirrorTex: BABYLON.MirrorTexture | null = null;
  let double: PlayerAvatar | null = null;
  let doubleReady = false;
  let doubleLast = { x: 0, z: 0 };
  let mirrorShadow = false;
  let hookCoat: BABYLON.Mesh | null = null;

  const sceneOf = (b: MorningStory['beat']) => (b === 'ride' ? 0 : b === 'walk' ? 1 : b === 'home' ? 2 : b === 'sleep' || b === 'wake' ? 3 : b === 'news' ? 4 : b === 'call' ? 5 : 6);
  const markScene = () => {
    const n = sceneOf(beat);
    if (scenes[scenes.length - 1] !== n) scenes.push(n);
  };

  /** `prepare` built the room under the chapter card; the next `onStart` keeps it. */
  let prepared = false;
  const owned: (BABYLON.Mesh | BABYLON.Material | BABYLON.BaseTexture)[] = [];
  let tvTexture: BABYLON.DynamicTexture | null = null;
  let tvMaterial: BABYLON.StandardMaterial | null = null;
  let screenMesh: BABYLON.Mesh | null = null;
  /** True when a mesh sits between the lens and the screen's centre (the camera ray hits something else first). */
  const tvCovered = () => {
    const cam = host.scene.activeCamera;
    if (!cam || !screenMesh) return false;
    const from = cam.globalPosition;
    const to = screenMesh.getAbsolutePosition();
    const dir = to.subtract(from);
    const len = dir.length();
    if (len < 0.1) return false;
    const hit = host.scene.pickWithRay(new BABYLON.Ray(from, dir.normalize(), len - 0.05), (m) => m.isVisible && m.isEnabled() && m !== screenMesh && m.name !== 'morning-tv-frame' && !m.name.startsWith('morning-tv') && m.getTotalVertices() > 0 && m.visibility > 0.5);
    return !!hit?.hit;
  };
  let windowMaterial: BABYLON.StandardMaterial | null = null;
  /** The front door, hinged on its west edge so Leave can swing it open. */
  let door: BABYLON.Mesh | null = null;
  let led: BABYLON.StandardMaterial | null = null;
  const lamps: { light: BABYLON.Light; night: number; day: number }[] = [];

  const say = (line: Line) => {
    host.showLine(lineSpeaker(line.id, line.speaker), lineText(line.id));
    const url = lineAudio(line.id);
    if (url) host.playFile(url, line.volume ?? 0.92);
    lineUntil = time + line.hold;
    lineLog.push({ id: line.id, at: time, heard: false, audio: !!url });
  };
  /** Every spoken line the room asked for, and whether its voice played out before the scene moved on. */
  const lineLog: { id: string; at: number; heard: boolean; audio: boolean }[] = [];
  const markHeard = () => {
    const last = lineLog[lineLog.length - 1];
    if (last && !last.heard && time - last.at > 0.5 && !voiceBusy()) last.heard = true;
  };
  // ---------- The room ----------
  const box = (name: string, cx: number, cy: number, cz: number, w: number, h: number, d: number, material: BABYLON.Material, solid = false) => {
    const mesh = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, host.scene);
    mesh.position.set(cx, cy, cz);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.checkCollisions = solid;
    // Furniture casts the key light's contact shadow (src/render/pipeline.ts); the window, door and LED do not.
    mesh.metadata = { ...(mesh.metadata ?? {}), castShadow: !/window|door|led/.test(name) };
    owned.push(mesh);
    return mesh;
  };

  const sampleTvBright = (ctx: CanvasRenderingContext2D, W: number, H: number) => {
    let sum = 0;
    let n = 0;
    let h = 2166136261;
    for (let y = 9; y < H; y += 18) {
      for (let x = 11; x < W; x += 32) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        sum += (d[0] + d[1] + d[2]) / 3;
        n += 1;
        h = Math.imul(h ^ ((d[0] << 16) | (d[1] << 8) | d[2]), 16777619);
      }
    }
    tvBright = n ? sum / n / 255 : 0;
    tvHash = h >>> 0;
    tvFrames += 1;
  };

  const drawTv = () => {
    if (!tvTexture) return;
    const ctx = tvTexture.getContext() as CanvasRenderingContext2D;
    const W = 512;
    const H = 288;
    if (!tvOn) {
      ctx.fillStyle = '#050607';
      ctx.fillRect(0, 0, W, H);
      tvTexture.update();
      tvBright = 0;
      tvHash = 0;
      return;
    }
    if (still === 'static') {
      for (let y = 0; y < H; y += 6) {
        for (let x = 0; x < W; x += 6) {
          const v = Math.floor(Math.random() * 120 + 30);
          ctx.fillStyle = `rgb(${v},${v},${v + 8})`;
          ctx.fillRect(x, y, 6, 6);
        }
      }
      tvTexture.update();
      sampleTvBright(ctx, W, H);
      return;
    }
    // A code-drawn news broadcast (also the fallback for any footage that fails to load): studio, anchor,
    // an inset picture for the story, the logo bug, a lower third, a scrolling ticker, a light roll and scanlines.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#13213a');
    g.addColorStop(1, '#223657');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Studio backdrop: a city wall of lit windows that drift with the programme clock.
    for (let i = 0; i < 18; i++) {
      const bx = i * 30 - ((newsT * 6) % 30);
      ctx.fillStyle = '#0c1424';
      ctx.fillRect(bx, 70 + (i % 5) * 9, 24, 130);
      ctx.fillStyle = (i * 7 + Math.floor(newsT / 2)) % 4 === 0 ? '#f2c96b' : '#33507f';
      for (let wy = 0; wy < 6; wy++) ctx.fillRect(bx + 4 + (wy % 2) * 9, 80 + (i % 5) * 9 + wy * 20, 6, 8);
    }
    // The anchor, left of centre, mouth moving while she reads.
    ctx.fillStyle = '#10151f';
    ctx.beginPath();
    ctx.ellipse(130, 252, 82, 62, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#c9a88c';
    ctx.beginPath();
    ctx.arc(130, 150, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a1d17';
    ctx.beginPath();
    ctx.arc(130, 140, 32, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#6b2b2b';
    const mouth = 2 + Math.abs(Math.sin(newsT * 9)) * 5;
    ctx.fillRect(122, 160, 16, mouth);
    ctx.fillStyle = '#4c5d7d';
    ctx.fillRect(0, 214, 250, 12);
    // The inset: a picture for the story, right of the anchor.
    const px = 262;
    const py = 44;
    const pw = 232;
    const ph = 130;
    ctx.fillStyle = '#05080e';
    ctx.fillRect(px - 3, py - 3, pw + 6, ph + 6);
    const ig = ctx.createLinearGradient(0, py, 0, py + ph);
    ig.addColorStop(0, '#0d1626');
    ig.addColorStop(1, '#2a3b5a');
    ctx.fillStyle = ig;
    ctx.fillRect(px, py, pw, ph);
    let head = 'HAWKES BIOMEDICAL';
    if (still === 'tower' || still === 'police') {
      head = 'HAWKES TOWER';
      ctx.fillStyle = '#0a0f18';
      ctx.fillRect(px + 90, py + 8, 52, ph - 8);
      ctx.fillRect(px + 105, py - 0, 22, 12);
      ctx.fillStyle = '#e9c46a';
      for (let y = py + 20; y < py + ph - 6; y += 12) for (let x = px + 96; x < px + 138; x += 11) if ((x * 7 + y * 3) % 5 !== 0) ctx.fillRect(x, y, 6, 5);
      if (still === 'police') {
        ctx.fillStyle = Math.floor(newsT * 3) % 2 ? '#d33' : '#37c';
        ctx.fillRect(px + 14, py + ph - 14, 34, 10);
        ctx.fillRect(px + pw - 48, py + ph - 14, 34, 10);
      }
    } else if (still === 'portrait') {
      head = 'PIERCE HAWKES';
      ctx.fillStyle = '#2b3445';
      ctx.fillRect(px + 70, py + 10, 92, ph - 10);
      ctx.fillStyle = '#9b8672';
      ctx.beginPath();
      ctx.arc(px + 116, py + 48, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#141a26';
      ctx.fillRect(px + 88, py + 76, 56, ph - 76);
    } else if (still === 'board') {
      head = 'THE BOARD';
      ctx.fillStyle = '#273247';
      ctx.fillRect(px + 20, py + 70, pw - 40, 18);
      ctx.fillStyle = '#9aa4b6';
      for (let i = 0; i < 6; i++) ctx.fillRect(px + 30 + i * 32, py + 44, 18, 22);
    }
    // Logo bug and the headline band.
    ctx.fillStyle = '#b01c2a';
    ctx.fillRect(0, 0, W, 26);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(18, 13, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b01c2a';
    ctx.font = 'bold 11px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HB', 18, 17);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`MORNING NEWS · ${head}`, 36, 18);
    ctx.textAlign = 'right';
    ctx.fillText(`LIVE ${String(6 + Math.floor(newsT / 60)).padStart(2, '0')}:${String(Math.floor(newsT) % 60).padStart(2, '0')}`, W - 10, 18);
    ctx.textAlign = 'left';
    // Lower third: the story, then the ticker that scrolls under it.
    const lowerIndex = Math.min(NEWS_CAPTIONS.length - 1, Math.max(0, captionsShown - 1));
    const lower = caption(lowerIndex, variant());
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(0, H - 86, W, 86);
    ctx.fillStyle = '#e9c46a';
    ctx.fillRect(0, H - 86, 6, 60);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px Arial, sans-serif';
    const words = lower.split(' ');
    let row = '';
    let ry = H - 66;
    for (const w of words) {
      if (ctx.measureText(`${row}${w}`).width > W - 28 && row) {
        ctx.fillText(row.trim(), 14, ry);
        ry += 21;
        row = '';
      }
      row += `${w} `;
    }
    ctx.fillText(row.trim(), 14, ry);
    ctx.fillStyle = '#b01c2a';
    ctx.fillRect(0, H - 26, W, 26);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px Arial, sans-serif';
    const tickIndex = Math.floor(newsT / 3) % TICKERS.length;
    const tid = tickIndex === 3 ? tickId(variant()) : TICKERS[tickIndex];
    const t = lineText(tid, TICK_FALLBACK[tid] ?? 'HAWKES BIOMEDICAL REMOVES FOUNDER AS CHAIRMAN');
    const reel = `${t}   ///   `;
    const rw = Math.max(80, ctx.measureText(reel).width);
    const off = (newsT * 70) % rw;
    for (let x = -off; x < W; x += rw) ctx.fillText(reel, x, H - 8);
    if (!tvSeen.includes(head)) tvSeen.push(head);
    if (!tvSeen.includes(t)) tvSeen.push(t);
    if (!tvSeen.includes(lower)) tvSeen.push(lower);
    // Light roll and scanlines: the picture breathes the way a tube does.
    const roll = ((newsT * 40) % (H + 60)) - 30;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, roll, W, 30);
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    tvTexture.update();
    sampleTvBright(ctx, W, H);
  };

  /** The newspaper on the coffee table. Headline by ledger band; big type so a phone reads it up close. */
  let paperTex: BABYLON.DynamicTexture | null = null;
  const drawPaper = () => {
    if (!paperTex) return;
    const v = variant();
    const id = `news.morning.paper.${v}`;
    paperText = lineText(id, PAPER_FALLBACK[v]);
    const ctx = paperTex.getContext() as CanvasRenderingContext2D;
    const W = 512;
    const H = 384;
    ctx.fillStyle = '#e6dfcd';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(14, 14, W - 28, 5);
    ctx.textAlign = 'center';
    ctx.font = 'bold 30px Georgia, serif';
    ctx.fillText('THE CITY LEDGER', W / 2, 52);
    ctx.fillRect(14, 64, W - 28, 3);
    const [head1, head2, sub] = paperText.split('\n');
    ctx.font = 'bold 54px Georgia, serif';
    ctx.fillText(head1 ?? '', W / 2, 140, W - 40);
    ctx.fillText(head2 ?? '', W / 2, 202, W - 40);
    ctx.font = '25px Georgia, serif';
    ctx.fillStyle = '#2a2a2a';
    const words = (sub ?? '').split(' ');
    let row = '';
    let y = 262;
    for (const word of words) {
      if ((row + word).length > 34) {
        ctx.fillText(row.trim(), W / 2, y);
        row = '';
        y += 32;
      }
      row += `${word} `;
    }
    ctx.fillText(row.trim(), W / 2, y);
    ctx.fillStyle = '#9a9484';
    for (let i = 0; i < 3; i++) ctx.fillRect(40, 330 + i * 12, W - 80, 4);
    paperTex.update();
  };

  const setTv = (on: boolean, next: typeof still) => {
    tvOn = on;
    still = on ? next : 'off';
    // StandardMaterial ADDS emissiveColor to the emissive texture (it does not multiply), so a white colour
    // saturated the whole screen to solid white. The canvas carries the picture; the colour stays black.
    if (tvMaterial) tvMaterial.emissiveColor = BABYLON.Color3.Black();
    drawTv();
  };

  const setMorning = (on: boolean) => {
    for (const l of lamps) l.light.intensity = on ? l.day : l.night;
    if (windowMaterial) {
      windowMaterial.emissiveColor = on ? new BABYLON.Color3(0.95, 0.78, 0.5) : new BABYLON.Color3(0.05, 0.09, 0.16);
    }
  };

  // ---------- The hall mirror: its glass shows the Shadow form, not Pierce ----------
  const paintShade = (avatar: PlayerAvatar) => {
    for (const mesh of avatar.group.getChildMeshes(false)) {
      mesh.layerMask = DOUBLE_LAYER;
      const material = mesh.material;
      if (material instanceof BABYLON.PBRMaterial) {
        material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        material.alpha = 0.82;
        material.useAlphaFromAlbedoTexture = false;
        material.albedoColor = new BABYLON.Color3(0.05, 0.045, 0.06);
        material.emissiveColor = new BABYLON.Color3(0.03, 0.015, 0.06);
      } else if (material instanceof BABYLON.StandardMaterial) {
        material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        material.alpha = 0.82;
        material.diffuseColor = new BABYLON.Color3(0.04, 0.04, 0.05);
        material.emissiveColor = new BABYLON.Color3(0.03, 0.015, 0.06);
      }
    }
  };

  const buildMirror = () => {
    const s = host.scene;
    const frameMat = mat(s, 'morning-mirror-frame-mat', 0.06, 0.05, 0.05);
    owned.push(frameMat);
    box('morning-mirror-frame', MIRROR.x, MIRROR.y, MIRROR.z + 0.03, 1.0, 1.66, 0.05, frameMat);
    const glass = BABYLON.MeshBuilder.CreatePlane('morning-mirror', { width: 0.9, height: 1.56 }, s);
    glass.position.set(MIRROR.x, MIRROR.y, MIRROR.z);
    glass.isPickable = false;
    owned.push(glass);
    const glassMat = new BABYLON.StandardMaterial('morning-mirror-mat', s);
    glassMat.disableLighting = true;
    glassMat.diffuseColor = BABYLON.Color3.Black();
    glassMat.specularColor = BABYLON.Color3.Black();
    glassMat.backFaceCulling = false;
    owned.push(glassMat);
    const tex = new BABYLON.MirrorTexture('morning-mirror-tex', { width: 512, height: 512 }, s, false, BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE);
    tex.mirrorPlane = BABYLON.Plane.FromPositionAndNormal(glass.position, new BABYLON.Vector3(0, 0, 1));
    tex.level = 0.8;
    tex.renderParticles = false;
    tex.renderSprites = false;
    tex.refreshRate = 0;
    glassMat.reflectionTexture = tex;
    glass.material = glassMat;
    owned.push(tex);
    mirrorTex = tex;
    // The Shadow form: a second Ch44 body on a layer the main camera skips; the glass draws it.
    const avatar = createCharacterAvatar(s, 'morningDouble', TRANSFORM_HERO_ASSET_ID);
    double = avatar;
    avatar.group.setEnabled(false);
    avatar.whenReady(() => {
      if (double !== avatar) return;
      doubleReady = true;
      avatar.setLocomotion(false, true);
      paintShade(avatar);
      avatar.group.setEnabled(true);
    });
  };

  const refreshMirror = () => {
    if (!mirrorTex || !double) return;
    const wanted = active && (beat === 'out' || beat === 'coat' || beat === 'door' || beat === 'leaving') && doubleReady;
    if (!wanted) {
      mirrorTex.refreshRate = 0;
      mirrorShadow = false;
      return;
    }
    const node = host.playerNode();
    double.group.position.copyFrom(node.position);
    double.group.rotation.y = node.rotation.y;
    const moved = Math.hypot(node.position.x - doubleLast.x, node.position.z - doubleLast.z) > 0.003;
    doubleLast = { x: node.position.x, z: node.position.z };
    double.setLocomotion(moved, true);
    double.getSkinnedMesh()?.skeleton?.prepare();
    // The pass draws the room and only the double; Pierce himself is not in the glass.
    const list: BABYLON.AbstractMesh[] = owned.filter((m): m is BABYLON.Mesh => m instanceof BABYLON.Mesh && m.name !== 'morning-mirror' && m.isEnabled());
    for (const m of double.group.getChildMeshes(false)) list.push(m);
    if (!mirrorTex.renderList || mirrorTex.renderList.length !== list.length) mirrorTex.renderList = list;
    mirrorTex.refreshRate = 2;
    mirrorShadow = true;
  };

  const build = () => {
    const s = host.scene;
    const wood = mat(s, 'morning-wood', 0.34, 0.24, 0.17);
    const cloth = mat(s, 'morning-cloth', 0.34, 0.37, 0.42);
    const sheet = mat(s, 'morning-sheet', 0.62, 0.64, 0.68);
    const dark = mat(s, 'morning-dark', 0.07, 0.07, 0.08);
    owned.push(wood, cloth, sheet, dark);
    // Bed: frame, mattress with sheet, pillow, headboard on the east wall.
    box('morning-bed-frame', BED.x, 0.18, BED.z, 2.3, 0.36, 2.0, wood, true);
    box('morning-bed-mattress', BED.x, 0.43, BED.z, 2.2, 0.14, 1.9, sheet);
    box('morning-bed-pillow', 7.55, 0.57, BED.z, 0.5, 0.14, 0.9, mat(s, 'morning-pillow', 0.85, 0.85, 0.82));
    box('morning-bed-headboard', 7.95, 0.8, BED.z, 0.1, 1.0, 2.1, wood);
    // Nightstand with the landline and a photo frame turned face down.
    box('morning-nightstand', 7.55, 0.3, -0.45, 0.6, 0.6, 0.6, wood, true);
    box('morning-landline', 7.55, 0.64, -0.45, 0.24, 0.1, 0.2, dark);
    led = mat(s, 'morning-led', 0.9, 0.1, 0.1, 1);
    owned.push(led);
    box('morning-landline-led', 7.55, 0.7, -0.5, 0.04, 0.02, 0.04, led);
    box('morning-photo', 7.4, 0.62, -0.28, 0.16, 0.02, 0.2, dark);
    // Television on a low stand against the north wall.
    box('morning-tv-stand', TV.x, 0.3, TV.z + 0.1, 1.9, 0.6, 0.4, wood, true);
    box('morning-tv-frame', TV.x, 1.3, TV.z + 0.04, 1.72, 1.0, 0.06, dark);
    tvTexture = new BABYLON.DynamicTexture('morning-tv', { width: 512, height: 288 }, s, false);
    owned.push(tvTexture);
    tvMaterial = new BABYLON.StandardMaterial('morning-tv-mat', s);
    tvMaterial.disableLighting = true;
    tvMaterial.emissiveTexture = tvTexture;
    tvMaterial.emissiveColor = BABYLON.Color3.Black();
    tvMaterial.diffuseColor = BABYLON.Color3.Black();
    tvMaterial.specularColor = BABYLON.Color3.Black();
    tvMaterial.backFaceCulling = false;
    owned.push(tvMaterial);
    const screen = BABYLON.MeshBuilder.CreatePlane('morning-tv-screen', { width: 1.6, height: 0.9 }, s);
    screenMesh = screen;
    screen.alwaysSelectAsActiveMesh = true;
    screen.metadata = { ...(screen.metadata ?? {}), castShadow: false };
    screen.position.set(TV.x, 1.3, TV.z + 0.08);
    // The default plane faces -z; the room looks at it from +z.
    screen.rotation.y = Math.PI;
    screen.material = tvMaterial;
    screen.isPickable = false;
    owned.push(screen);
    // The newspaper lies on the coffee table (table top y 0.4), headline up toward the sofa.
    paperTex = new BABYLON.DynamicTexture('morning-paper', { width: 512, height: 384 }, s, true);
    owned.push(paperTex);
    const paperMat = new BABYLON.StandardMaterial('morning-paper-mat', s);
    paperMat.diffuseTexture = paperTex;
    paperMat.emissiveTexture = paperTex;
    paperMat.emissiveColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    paperMat.specularColor = BABYLON.Color3.Black();
    owned.push(paperMat);
    paperMesh = BABYLON.MeshBuilder.CreatePlane('morning-paper', { width: 0.56, height: 0.42 }, s);
    paperMesh.position.set(PAPER.x, PAPER.y, PAPER.z);
    paperMesh.rotation.set(Math.PI / 2, Math.PI, 0);
    paperMesh.material = paperMat;
    paperMesh.isPickable = false;
    owned.push(paperMesh);
    // Sofa and a coffee table in front of it; the chair by the window with a coat on it.
    box('morning-sofa', 3.2, 0.3, 0.6, 2.0, 0.6, 0.85, cloth, true);
    box('morning-sofa-back', 3.2, 0.7, 1.0, 2.0, 0.5, 0.2, cloth);
    box('morning-table', 3.2, 0.2, -1.3, 1.1, 0.4, 0.6, wood, true);
    box('morning-chair', 1.0, 0.25, -1.3, 0.6, 0.5, 0.6, cloth, true);
    // His coat hangs on a hook by the front door, beside the hall mirror.
    box('morning-coat-hook', COAT.x, 1.75, 2.9, 0.34, 0.05, 0.08, dark);
    hookCoat = box('morning-coat', COAT.x, 1.25, 2.86, 0.46, 0.98, 0.1, mat(s, 'morning-coat', 0.12, 0.12, 0.14));
    buildMirror();
    // Window on the west wall, front door on the south wall.
    windowMaterial = mat(s, 'morning-window', 0.2, 0.3, 0.5, 1);
    owned.push(windowMaterial);
    box('morning-window', 0.02, 1.5, -0.4, 0.04, 1.2, 1.8, windowMaterial);
    door = box('morning-door', DOOR.x, 1.05, 2.98, 1.0, 2.1, 0.06, mat(s, 'morning-door', 0.2, 0.16, 0.12));
    door.setPivotPoint(new BABYLON.Vector3(-0.5, 0, 0));
    // The dark hall the open door shows, just off the wall's face behind it (the shell has no doorway).
    const hall = BABYLON.MeshBuilder.CreatePlane('morning-door-hall', { width: 1.0, height: 2.1 }, s);
    hall.position.set(DOOR.x, 1.05, 2.995);
    const hallMat = mat(s, 'morning-door-hall', 0.015, 0.014, 0.013);
    hallMaterial = hallMat;
    hallMat.disableLighting = true;
    hall.material = hallMat;
    hall.isPickable = false;
    owned.push(hall);
    for (const light of s.lights) {
      if (light.name.startsWith('morning-lamp')) lamps.push({ light, night: 0.15, day: 0.9 });
    }
    setMorning(false);
    setTv(false, 'off');
  };

  const clearRoom = () => {
    for (const item of owned) {
      if (item instanceof BABYLON.Mesh) {
        if (!item.isDisposed()) item.dispose(false, true);
      } else item.dispose();
    }
    owned.length = 0;
    double?.dispose();
    double = null;
    doubleReady = false;
    mirrorTex = null;
    mirrorShadow = false;
    hookCoat = null;
    hallMaterial = null;
    door = null;
    lamps.length = 0;
    tvTexture = null;
    tvMaterial = null;
    screenMesh = null;
    paperTex = null;
    paperMesh = null;
    windowMaterial = null;
    led = null;
  };

  // ---------- Beats ----------
  const near = (p: { x: number; z: number }, r: number) => {
    const here = host.playerXZ();
    return Math.hypot(here.x - p.x, here.z - p.z) < r;
  };

  const control = () => {
    host.setWalk(false);
    host.showLine('', '');
    host.releaseCamera();
    host.holdScene(false);
    host.clearInput();
    host.resumeLocomotion();
    host.refreshHud();
  };

  const goHome = () => {
    beat = 'home';
    markScene();
    host.setObjective(lineSpeaker('objective.morning.bed', 'Home'), lineText('objective.morning.bed', 'Sleep. The bed.'), { x: BED_SIDE.x, y: 1, z: BED_SIDE.z });
    host.showObjective(true);
  };

  const beginScene = (next: MorningStory['beat']) => {
    playing = true;
    beat = next;
    markScene();
    time = 0;
    lineUntil = 0;
    flags = new Set();
    host.holdScene(true);
    host.showObjective(false);
    host.clearMarker();
  };

  const endSleep = () => {
    host.lie(false, 0, 0, 0, 0);
    host.placePierce(WATCH.x, WATCH.z, Math.PI);
    host.playClip('rebornidle', true);
    host.fade(0, 0.2);
    setMorning(true);
    if (!tvOn) setTv(true, 'static');
    playing = false;
    control();
    beat = 'news';
    markScene();
    host.setObjective(lineSpeaker('objective.morning.news', 'The news'), lineText('objective.morning.news', 'The television.'), { x: WATCH.x, y: 1.3, z: WATCH.z });
    host.showObjective(true);
  };

  const endNews = () => {
    playing = false;
    host.fade(0, 0.2);
    host.placePierce(WATCH.x, WATCH.z, Math.PI);
    setTv(true, 'portrait');
    host.endCineScene?.(false);
    control();
    beat = 'call';
    markScene();
    ringIn = 1.5;
    host.setObjective(lineSpeaker('objective.morning.call', 'Voss'), lineText('objective.morning.call', 'Answer the phone. F.'), null);
    host.showObjective(true);
  };

  /** The door has opened; morningEnding.ts runs the rest, so the room's own scene is over. */
  const finish = () => {
    playing = false;
    beat = 'done';
    host.clearMarker();
    host.showObjective(false);
  };

  const toDoor = () => {
    playing = false;
    control();
    beat = 'door';
    markScene();
    host.setObjective(lineSpeaker('objective.morning.out', 'Out'), lineText('objective.morning.out', 'The front door.'), { x: DOOR.x, y: 1.3, z: DOOR.z - 0.3 });
    host.showObjective(true);
  };

  /** S0 and S1: black, sound and two barks. No street is built; the room is the next thing he sees. */
  const endIntro = () => {
    host.fade(0, 1.4);
    host.showLine('', '');
    playing = false;
    control();
    host.placePierce(START.x, START.z, START.yaw);
    goHome();
    time = 0;
    lineUntil = 0;
    flags.add('hand-due');
  };

  /** Reading the paper: the camera comes down to the table, the headline is up, Pierce says what he makes of it. */
  const beginRead = () => {
    reading = REACT_HOLD + 1.4;
    paperRead = true;
    host.holdScene(true);
    host.clearInput();
    host.setWalk(false);
    host.placePierce(READ_AT.x, READ_AT.z, Math.PI);
    host.playClip('rebornidle', true);
    host.playFile(PLACE_SFX.paper, 0.5);
    const v = variant();
    const id = v === 'b0' ? REACT_ID.b0 : v === 'b1' ? REACT_ID.b1 : REACT_ID.d;
    const [head1, head2] = paperText.split('\n');
    host.showLine(lineText('news.morning.paper.title', 'The City Ledger'), `${head1} ${head2 ?? ''}`.trim());
    const url = lineAudio(id);
    if (url) host.playFile(url, 0.9);
    if (snap.band > 0) host.ledger.add('reported');
    readLine = id;
  };

  const stepIntro = () => {
    if (beat === 'ride') {
      if (!flags.has('a')) {
        flags.add('a');
        host.fade(1, 0);
        host.playFile('/assets/audio/train/rumble.ogg', 0.3);
        host.showLine(lineText('text.morning.ride.title', 'The uptown 6'), lineText('text.morning.ride', 'The train runs past a stop that was never on the map.'));
      }
      if (time > 6 && !flags.has('b')) {
        flags.add('b');
        host.playFile('/assets/audio/train/brakes.ogg', 0.5);
      }
      if (time > 9.5 && !flags.has('c')) {
        flags.add('c');
        host.playFile('/assets/audio/train/doors-open.ogg', 0.6);
        say(L_MINE);
      }
      if (time > 13) {
        beat = 'walk';
        markScene();
        time = 0;
        flags = new Set();
      }
    } else {
      if (!flags.has('a')) {
        flags.add('a');
        host.showLine(lineText('text.morning.walk.title', 'The walk up'), lineText('text.morning.walk', 'Two strangers cross the street rather than pass him.'));
      }
      if (time > 4 && !flags.has('b')) {
        flags.add('b');
        say(L_BLOCKS);
      }
      if (time > 11) endIntro();
    }
  };

  /**
   * The bed scene, in phases (each ends on its clock, and a spoken line also waits for its voice, bounded):
   *   stand    fade up beside the bed, "Home."
   *   turn     turns his back on the room to face the bed edge
   *   sitdown  sits on the edge (SitIdle; pelvis lowered with the feet kept on the floor)
   *   sit      a breath
   *   recline  lies back and swings round until his head is on the pillow (the view goes dark under it)
   *   asleep   dark, breathing and one small shift; the morning comes up
   *   wake     "I slept." / "I don't sleep." with the TV coming on
   *   situp    sits up on the edge again
   *   standup  stands, turned toward the TV
   *   walk     crosses the room to the set at walking pace
   *   face     squares up to the screen
   */
  type SleepPhase = 'stand' | 'turn' | 'sitdown' | 'sit' | 'recline' | 'asleep' | 'wake' | 'situp' | 'standup' | 'walk' | 'face';
  const SLEEP_ORDER: SleepPhase[] = ['stand', 'turn', 'sitdown', 'sit', 'recline', 'asleep', 'wake', 'situp', 'standup', 'walk', 'face'];
  const SLEEP_MIN: Record<SleepPhase, number> = { stand: 1.8, turn: 0.8, sitdown: 1.1, sit: 1.0, recline: 2.2, asleep: 5.6, wake: 6.4, situp: 1.8, standup: 1.1, walk: 2.0, face: 0.7 };
  const STAND_PELVIS = 0.95;
  const SIT_PELVIS = 0.5;
  /** Feet on the floor at the bedside, then sitting on the edge (pelvis over the mattress, feet clear of the frame). */
  const AT_SIDE = { x: BED_SIDE.x, z: BED_SIDE.z };
  const AT_EDGE = { x: 5.95, z: -0.72, y: 0.54 };
  const ON_PILLOW = { x: 6.5, y: 0.64, z: BED.z };
  const YAW_SIT = 0;
  const YAW_LIE = -Math.PI / 2;
  const YAW_WEST = -Math.PI / 2;
  const ease = (k: number) => {
    const c = Math.min(1, Math.max(0, k));
    return c * c * (3 - 2 * c);
  };
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  let sleepPhase: SleepPhase = 'stand';
  let sleepT = 0;
  let poseState = { phase: 'stand' as SleepPhase, pitch: 0, roll: 0, x: 0, y: 0, z: 0, clip: '', frames: 0, minOverMattress: 99, walked: 0 };
  let sleepClip = '';
  const sleepClipTo = (clip: string) => {
    if (sleepClip === clip) return;
    sleepClip = clip;
    host.playClip(clip, true);
  };
  const sleepLineFor: Partial<Record<SleepPhase, Line>> = { stand: L_HOME };
  const enterSleepPhase = (next: SleepPhase) => {
    sleepPhase = next;
    sleepT = 0;
    if (next === 'sitdown') {
      sleepClipTo('sit');
      host.playFile(PLACE_SFX.bed, 0.4);
    } else if (next === 'recline') {
      setMorning(false);
      setTv(false, 'off');
      host.fade(0.9, 1.2);
      host.playFile(PLACE_SFX.bed, 0.5);
    } else if (next === 'asleep') {
      sleepClipTo('rebornidle');
    } else if (next === 'wake') {
      setMorning(true);
      host.fade(0, 2.2);
    } else if (next === 'situp') {
      sleepClipTo('sit');
      host.playFile(PLACE_SFX.bed, 0.4);
    } else if (next === 'standup') {
      sleepClipTo('rebornidle');
    } else if (next === 'walk') {
      sleepClipTo('walk');
    } else if (next === 'face') {
      sleepClipTo('rebornidle');
    }
    const line = sleepLineFor[next];
    if (line) say(line);
  };

  /** Pose the body for this phase and say whether its work is done. */
  const poseSleep = (): boolean => {
    const k = ease(sleepT / SLEEP_MIN[sleepPhase]);
    let pitch = 0;
    let roll = 0;
    let yaw = YAW_SIT;
    let px = 0;
    let py = 0;
    let pz = 0;
    let pel = STAND_PELVIS;
    // The pelvis path: standing at the bedside, sitting on the edge, on the pillow.
    const standP = (x: number, z: number) => ({ x, y: STAND_PELVIS, z });
    switch (sleepPhase) {
      case 'stand':
        ({ x: px, y: py, z: pz } = standP(AT_SIDE.x, AT_SIDE.z));
        yaw = Math.PI;
        break;
      case 'turn':
        ({ x: px, y: py, z: pz } = standP(AT_SIDE.x, AT_SIDE.z));
        yaw = lerp(Math.PI, YAW_SIT, k);
        break;
      case 'sitdown':
      case 'standup': {
        const d = sleepPhase === 'sitdown' ? k : 1 - k;
        px = lerp(AT_SIDE.x, AT_EDGE.x, d);
        pz = lerp(AT_SIDE.z, AT_EDGE.z, d);
        py = lerp(STAND_PELVIS, AT_EDGE.y, d);
        pel = lerp(STAND_PELVIS, SIT_PELVIS, d);
        yaw = sleepPhase === 'sitdown' ? YAW_SIT : lerp(YAW_WEST, YAW_SIT, d);
        break;
      }
      case 'sit': {
        px = AT_EDGE.x;
        pz = AT_EDGE.z;
        pel = SIT_PELVIS;
        // Breathing out: the pelvis does not move; the shoulders cannot be driven without a clip, so a hair of pitch.
        py = AT_EDGE.y;
        pitch = Math.sin(sleepT * 2.2) * 0.012;
        break;
      }
      case 'recline':
      case 'situp': {
        const d = sleepPhase === 'recline' ? k : 1 - k;
        px = lerp(AT_EDGE.x, ON_PILLOW.x, d);
        pz = lerp(AT_EDGE.z, ON_PILLOW.z, d);
        py = lerp(AT_EDGE.y, ON_PILLOW.y, d);
        pel = lerp(SIT_PELVIS, STAND_PELVIS, d);
        pitch = d * (Math.PI / 2);
        yaw = lerp(YAW_SIT, YAW_LIE, d);
        break;
      }
      case 'asleep':
      case 'wake': {
        px = ON_PILLOW.x;
        pz = ON_PILLOW.z;
        pel = STAND_PELVIS;
        pitch = Math.PI / 2;
        yaw = YAW_LIE;
        // Breathing (about 0.22 Hz, a few millimetres) and one small shift of the weight at 2 s.
        const breath = Math.sin(sleepT * 1.4);
        py = ON_PILLOW.y + 0.006 * breath;
        pitch += 0.01 * breath;
        const shift = sleepPhase === 'asleep' ? Math.max(0, Math.sin(Math.min(1, Math.max(0, (sleepT - 2) / 1.6)) * Math.PI)) : 0;
        roll = 0.07 * shift;
        break;
      }
      case 'walk': {
        const from = { x: AT_SIDE.x, z: AT_SIDE.z };
        px = lerp(from.x, WATCH.x, k);
        pz = lerp(from.z, WATCH.z, k);
        py = STAND_PELVIS;
        yaw = YAW_WEST;
        break;
      }
      case 'face':
        px = WATCH.x;
        pz = WATCH.z;
        py = STAND_PELVIS;
        yaw = lerp(YAW_WEST, -Math.PI, k);
        break;
    }
    if (sleepPhase === 'walk') {
      // Walking is on the floor like any other step: placePierce keeps the feet planted and the camera behind him.
      host.placePierce(px, pz, yaw);
    } else if (sleepPhase === 'stand' || sleepPhase === 'turn' || sleepPhase === 'face') {
      host.placePierce(px, pz, yaw);
    } else {
      host.poseBody(px, py, pz, yaw, pitch, roll, pel);
    }
    // Probe numbers: how far the body's lowest part is above the mattress while he lies (a gap under 0 is a limb in it).
    const lyingNow = sleepPhase === 'asleep' || sleepPhase === 'wake';
    poseState = {
      phase: sleepPhase,
      pitch,
      roll,
      x: px,
      y: py,
      z: pz,
      clip: sleepClip,
      frames: poseState.frames + 1,
      minOverMattress: lyingNow ? Math.min(poseState.minOverMattress, py - 0.5) : poseState.minOverMattress,
      walked: sleepPhase === 'walk' ? Math.hypot(px - AT_SIDE.x, pz - AT_SIDE.z) : poseState.walked,
    };
    // Camera: wide on the bed, closer while he lies, then following him across the room.
    if (sleepPhase === 'walk' || sleepPhase === 'face') {
      host.frameCamera({ x: Math.min(7.0, px + 1.5), y: 1.5, z: 1.1 }, { x: px - 0.6, y: 1.1, z: pz - 0.5 });
    } else if (lyingNow || sleepPhase === 'recline' || sleepPhase === 'situp') {
      host.frameCamera({ x: 4.9, y: 1.45, z: -0.9 }, { x: 7.0, y: 0.75, z: BED.z });
    } else {
      host.frameCamera({ x: 4.6, y: 1.7, z: 0.5 }, { x: BED.x - 0.4, y: 0.7, z: BED.z + 0.4 });
    }
    // Phase work that depends on the clock inside the phase.
    if (sleepPhase === 'asleep' && sleepT > 2.4 && !flags.has('dawn')) {
      flags.add('dawn');
      host.fade(0, 2.4);
      setMorning(true);
    }
    if (sleepPhase === 'recline' && k > 0.5) sleepClipTo('rebornidle');
    if (sleepPhase === 'wake') {
      if (sleepT > 1.2 && !flags.has('slept')) {
        flags.add('slept');
        say(L_SLEPT);
        waitFrom = sleepT;
      } else if (flags.has('slept') && !flags.has('dont') && lineClear(L_SLEPT, 0.5)) {
        flags.add('dont');
        say(L_DONT);
        waitFrom = sleepT;
      } else if (flags.has('dont') && !flags.has('tv') && lineClear(L_DONT, 0.4)) {
        flags.add('tv');
        setTv(true, 'static');
        host.playFile(PLACE_SFX.tvStatic, 0.3);
        waitFrom = sleepT;
      }
      // Done once both lines have played out and the set has been on for a moment.
      return flags.has('tv') && sleepT > waitFrom + 1.2;
    }
    return sleepT >= SLEEP_MIN[sleepPhase] && (sleepPhase !== 'stand' || lineClear(L_HOME, 0));
  };
  let waitFrom = 0;
  /** True once the line has had its time and its voice is over (never waits more than 6 s past it). */
  const lineClear = (line: Line, extra: number) => {
    const since = sleepT - waitFrom;
    if (since < Math.max(line.hold, 0.4) + extra) return since > line.hold + 6;
    return !voiceBusy() || since > line.hold + 6;
  };

  const stepSleep = () => {
    if (!flags.has('begin')) {
      flags.add('begin');
      sleepPhase = 'stand';
      sleepT = 0;
      waitFrom = 0;
      sleepClip = '';
      poseState = { ...poseState, frames: 0, minOverMattress: 99, walked: 0 };
      host.fade(1, 0);
      host.fade(0, 1.1);
      host.placePierce(AT_SIDE.x, AT_SIDE.z, Math.PI);
      sleepClipTo('rebornidle');
      beat = 'sleep';
      enterSleepPhase('stand');
    }
    sleepT += lastDt;
    if (poseSleep()) {
      const i = SLEEP_ORDER.indexOf(sleepPhase);
      if (i === SLEEP_ORDER.length - 1) {
        endSleep();
        return;
      }
      enterSleepPhase(SLEEP_ORDER[i + 1]);
    }
    if (sleepPhase === 'wake' || sleepPhase === 'situp' || sleepPhase === 'standup' || sleepPhase === 'walk' || sleepPhase === 'face') beat = 'wake';
  };

  const stepNews = () => {
    newsT = time;
    tvClock += 0.016;
    if (tvClock > 0.12 || (flags.has('drawn') === false && flags.has('start'))) {
      tvClock = 0;
      flags.add('drawn');
      drawTv();
    }
    if (!flags.has('start')) {
      flags.add('start');
      host.placePierce(WATCH.x, WATCH.z, Math.PI);
      host.playClip('rebornidle', true);
      setTv(true, 'static');
      host.playFile(PLACE_SFX.newsSting, 0.4);
    }
    // Captions in order; the first one lands as the programme's opening sting ends.
    let at = 2.4;
    let shown = -1;
    for (let i = 0; i < NEWS_CAPTIONS.length; i++) {
      if (time >= at) shown = i;
      at += holdFor(caption(i, variant()));
    }
    const total = at;
    if (host.stepCineScene) {
      const newsSpeaker = flags.has('without') ? 'Pierce' : 'Anchor';
      const newsLineKey = flags.has('without')
        ? L_WITHOUT.id
        : shown >= 0
          ? captionKey(shown, variant())
          : 'news.morning.sting';
      host.stepCineScene('tv-news', time, 0.016, {
        applyCamera: true,
        speaker: newsSpeaker,
        lineKey: newsLineKey,
      });
    } else {
      // A portrait phone sees a narrow slice: back the camera up (inside the south wall) until the whole set fits.
      const eng = host.scene.getEngine();
      const aspect = eng.getRenderWidth() / Math.max(1, eng.getRenderHeight());
      const fit = Math.min(2.55, Math.max(1.2, 1.15 / (0.4228 * Math.max(0.3, aspect)) - 4.15 + 1.2));
      host.frameCamera({ x: 4.1 + (fit - 1.2) * 0.1, y: 1.55, z: Math.min(fit, 2.55) }, { x: TV.x, y: 1.3, z: TV.z });
    }
    if (shown >= 0 && shown + 1 > captionsShown) {
      captionsShown = shown + 1;
      still = NEWS_STILLS[shown];
      const key = captionKey(shown, variant());
      host.showLine(lineSpeaker(key, 'Morning News'), caption(shown, variant()));
      // Each lower third is read by the anchor once its take exists.
      const read = lineAudio(key);
      if (read) host.playFile(read, 0.85);
      if (shown === 3) {
        reportSeen = key;
        if (snap.band > 0) host.ledger.add('reported');
      }
    }
    if (time >= total && !flags.has('without')) {
      flags.add('without');
      lineUntil = 0;
      say(L_WITHOUT);
    }
    // endNews hands the room to Voss's ring: wait for the anchor and Pierce to finish first (bounded).
    if (time >= total + L_WITHOUT.hold + 0.4 && (!voiceBusy() || time >= total + L_WITHOUT.hold + 8)) endNews();
  };

  /** He puts the coat on in front of the mirror and says the closing line. */
  const stepCoat = () => {
    if (!flags.has('start')) {
      flags.add('start');
      host.placePierce(MIRROR.x, 2.05, 0);
      host.playClip('rebornidle', true);
    }
    // Behind him, close: the glass over his shoulder shows what is standing there.
    const k = Math.min(1, time / COAT_SCENE_SECONDS);
    host.frameCamera({ x: MIRROR.x + 0.15 - k * 0.1, y: 1.55, z: 0.55 + k * 0.7 }, { x: MIRROR.x, y: 1.35, z: 3 });
    if (time >= 1.2 && !flags.has('coat')) {
      flags.add('coat');
      coatTaken = true;
      if (hookCoat) hookCoat.setEnabled(false);
      host.playFile(PLACE_SFX.bed, 0.5);
      host.setCarry([...carryItems('morning', CARRY), COAT_ITEM]);
    }
    if (time >= 2.4 && !flags.has('line')) {
      flags.add('line');
      say(L_WALKS);
    }
    if (time >= COAT_SCENE_SECONDS) toDoor();
  };

  const stepLeaving = () => {
    if (!flags.has('start')) {
      flags.add('start');
      // Beside the door, clear of its swing (it opens into the room on its west hinge), facing it.
      host.placePierce(DOOR.x + 0.8, DOOR.z - 0.35, -0.9);
      host.playClip('rebornidle', true);
      host.beginEnding();
    }
    host.frameCamera({ x: 2.6, y: 1.55, z: 0.4 }, { x: DOOR.x, y: 1.2, z: DOOR.z });
    // The door swings open into the room and the hall behind it is dawn.
    if (time >= 0.5 && !flags.has('door-sound')) {
      flags.add('door-sound');
      host.playFile(PLACE_SFX.door, 0.6);
    }
    const t = Math.min(1, Math.max(0, (time - 0.5) / 1.4));
    if (door) door.rotation.y = DOOR_SWING * t * t * (3 - 2 * t);
    if (hallMaterial) hallMaterial.emissiveColor = new BABYLON.Color3(t * 2.4, t * 2.3, t * 2.1);
    if (time >= 3.2) finish();
  };

  return {
    /** Test setup (playtest `level-8-ending`): skip to the walk to the coat, or to the door with the coat taken. */
    jumpTo: (to: 'out' | 'door') => {
      if (!active) return;
      playing = false;
      lineUntil = 0;
      flags = new Set();
      host.lie(false, 0, 0, 0, 0);
      host.fade(0, 0.2);
      host.showLine('', '');
      setMorning(true);
      setTv(true, 'portrait');
      callDone = true;
      pushT = 0;
      control();
      if (to === 'door') {
        coatTaken = true;
        if (hookCoat) hookCoat.setEnabled(false);
        host.placePierce(MIRROR.x, 2.05, 0);
        toDoor();
      } else {
        host.placePierce(WATCH.x, WATCH.z, Math.PI);
        beat = 'out';
        markScene();
        host.setObjective(lineSpeaker('objective.morning.coat', 'Out'), lineText('objective.morning.coat', 'The coat. Then the door.'), { x: COAT.x, y: 1.3, z: COAT.z });
        host.showObjective(true);
      }
    },
    /** The ending event: the TV switches itself on to the Hawkes Tower report (a still of the old face). */
    tvReport: (on: boolean) => setTv(on, on ? 'portrait' : 'off'),
    objectiveKey: () => 'morning',
    playing: () => playing,
    action: () => {
      if (!active || playing) return null;
      if (beat === 'home' && near(BED, 1.9)) return lineText('ui.action.morning.sleep', 'Sleep');
      if (beat === 'news' && near({ x: TV.x, z: -1.2 }, 1.9)) return lineText('ui.action.morning.watch', 'Watch');
      if (beat === 'out' && near(COAT, 1.1)) return lineText('ui.action.morning.coat', 'Take coat');
      if (beat === 'door' && near(DOOR, 1.3)) return lineText('ui.action.morning.leave', 'Leave');
      if ((beat === 'call' || beat === 'out') && !reading && !paperRead && near(READ_AT, 1.1)) return lineText('ui.action.morning.paper', 'Read the paper');
      return null;
    },
    confirm: () => {
      if (!active || playing) return false;
      if (beat === 'home' && near(BED, 1.9)) {
        beginScene('sleep');
        return true;
      }
      if (beat === 'news' && near({ x: TV.x, z: -1.2 }, 1.9)) {
        beginScene('news');
        captionsShown = 0;
        return true;
      }
      if (beat === 'out' && near(COAT, 1.1)) {
        beginScene('coat');
        return true;
      }
      if (beat === 'door' && near(DOOR, 1.3)) {
        beginScene('leaving');
        return true;
      }
      if ((beat === 'call' || beat === 'out') && !reading && !paperRead && near(READ_AT, 1.1)) {
        beginRead();
        return true;
      }
      return false;
    },
    skip: () => {
      if (!active || !playing) return;
      if (beat === 'ride' || beat === 'walk') endIntro();
      else if (beat === 'sleep' || beat === 'wake') endSleep();
      else if (beat === 'news') endNews();
      else if (beat === 'coat') toDoor();
    },
    story: (): MorningStory => ({
      beat,
      lying: playing && (sleepPhase === 'asleep' || sleepPhase === 'wake') && (beat === 'sleep' || beat === 'wake') && flags.has('begin'),
      tvOn,
      tvBright,
      tvText: tvSeen.join(' | '),
      captions: captionsShown,
      callDone,
      scene: sceneOf(beat),
      scenes: [...scenes],
      mirrorShadow,
      coatTaken,
      push,
      band: snap.band,
      kills: snap.kills,
      report: reportSeen,
      paper: paperText,
      paperRead,
      pose: { ...poseState, phase: playing && flags.has('begin') ? sleepPhase : 'none' },
      tv: {
        on: tvOn,
        hash: tvHash,
        frames: tvFrames,
        bound: !!(tvMaterial && tvTexture && tvMaterial.emissiveTexture === tvTexture && screenMesh?.material === tvMaterial),
        visible: !!screenMesh && screenMesh.isEnabled() && screenMesh.isVisible,
        covered: tvCovered(),
      },
      lines: lineLog.map((l) => ({ ...l })),
    }),
    dispose: () => {
      active = false;
      playing = false;
      prepared = false;
      host.setPush(0);
      clearRoom();
    },
    /**
     * Build the room (about thirty meshes, the TV's canvas texture, its materials) while the level loads, so the
     * shaders compile under the chapter card. `onStart` keeps it instead of building it on Start's first frame.
     */
    prepare: () => {
      clearRoom();
      readLedger();
      build();
      drawPaper();
      prepared = true;
    },
    onStart: () => {
      if (!prepared) clearRoom();
      active = true;
      playing = false;
      beat = 'home';
      time = 0;
      lineUntil = 0;
      flags = new Set();
      tvSeen = [];
      captionsShown = 0;
      callDone = false;
      rang = false;
      ringIn = -1;
      ringSince = 0;
      wasBusy = false;
      newsT = 0;
      tvClock = 0;
      scenes = [];
      coatTaken = false;
      pushT = 0;
      push = 0;
      host.setPush(0);
      if (hookCoat) hookCoat.setEnabled(true);
      paperRead = false;
      reading = 0;
      reportSeen = '';
      readLedger();
      host.setCarry(carryItems('morning', CARRY));
      if (!prepared) build();
      drawPaper();
      prepared = false;
      host.lie(false, 0, 0, 0, 0);
      host.placePierce(START.x, START.z, START.yaw);
      host.holdScene(false);
      host.releaseCamera();
      host.resumeLocomotion();
      beginScene('ride');
    },
    step: (delta: number) => {
      if (!active || beat === 'done') return;
      const dt = Math.min(0.05, Math.max(0, delta));
      lastDt = dt;
      time += dt;
      blink += dt;
      if (led) led.emissiveColor = new BABYLON.Color3(blink % 1 < 0.5 ? 0.9 : 0.1, 0.05, 0.05);
      refreshMirror();
      markHeard();
      if (playing) {
        if (beat === 'ride' || beat === 'walk') stepIntro();
        else if (beat === 'sleep' || beat === 'wake') stepSleep();
        else if (beat === 'news') stepNews();
        else if (beat === 'coat') stepCoat();
        else if (beat === 'leaving') stepLeaving();
      } else {
        // The walk to the door: the camera creeps in as he nears it.
        if (beat === 'out' || beat === 'door') pushT = Math.min(18, pushT + dt);
        push = beat === 'out' || beat === 'door' ? pushT / 18 : 0;
        host.setPush(push);
        if (reading > 0) {
          reading -= dt;
          // Close on the table: the paper (0.56 m) must fill a phone's narrow view, so the distance follows the aspect.
          const cam = host.scene.activeCamera as BABYLON.FreeCamera | null;
          const eng = host.scene.getEngine();
          const aspect = Math.max(0.3, eng.getRenderWidth() / Math.max(1, eng.getRenderHeight()));
          const fov = cam?.fov ?? 0.8;
          const d = Math.max(1.0, Math.min(1.7, 0.78 / (2 * Math.tan(fov / 2) * aspect)));
          host.frameCamera({ x: PAPER.x, y: PAPER.y + d * 0.84, z: PAPER.z + d * 0.54 }, { x: PAPER.x, y: PAPER.y, z: PAPER.z - 0.02 });
          if (reading <= 0) {
            reading = 0;
            host.showLine('', '');
            control();
          }
          return;
        }
        // Free play. Static on the TV flickers; the first line comes once control is his.
        if (tvOn) {
          newsT += dt;
          tvClock += dt;
          if (tvClock > 0.12) {
            tvClock = 0;
            drawTv();
          }
        }
        if (flags.has('hand-due') && time > 1.2) {
          flags.delete('hand-due');
          say(L_HAND);
        }
        if (beat === 'call') {
          if (ringIn > 0) {
            ringIn -= dt;
            if (ringIn <= 0 && !host.callBusy()) {
              rang = true;
              ringSince = 0;
              host.ringCall('voss-morning');
            }
          } else if (rang) {
            ringSince += dt;
            const busy = host.callBusy();
            if (busy) {
              wasBusy = true;
              host.stepCineScene?.('voss-morning-call', ringSince, dt, { applyCamera: true });
            }
            if (wasBusy && !busy) {
              callDone = true;
              host.endCineScene?.(true);
              beat = 'out';
              markScene();
              host.setObjective(lineSpeaker('objective.morning.coat', 'Out'), lineText('objective.morning.coat', 'The coat. Then the door.'), { x: COAT.x, y: 1.3, z: COAT.z });
              host.showObjective(true);
            } else if (!wasBusy && ringSince > 40) {
              // Nobody picked up: Voss tries again.
              rang = false;
              ringIn = 2;
            }
          }
        }
      }
      // The caption stays up until the voice behind it is done (the voice channel queues, it never cuts a line).
      if (lineUntil > 0 && time > lineUntil && (!voiceBusy() || time > lineUntil + 8)) {
        lineUntil = 0;
        host.showLine('', '');
      }
    },
  };
};

export type TheMorning = ReturnType<typeof createTheMorning>;
