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
  playClip: (clip: string, loop: boolean, speed?: number) => void;
  frameCamera: (position: { x: number; y: number; z: number }, lookAt: { x: number; y: number; z: number }) => void;
  releaseCamera: () => void;
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
/** Where the bot and the marker stand to use the door. */
const LIE = { x: 5.75, y: 0.64, z: BED.z, yaw: Math.PI / 2 };

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

  const drawTv = () => {
    if (!tvTexture) return;
    const ctx = tvTexture.getContext() as CanvasRenderingContext2D;
    const W = 512;
    const H = 288;
    if (!tvOn) {
      ctx.fillStyle = '#050607';
      ctx.fillRect(0, 0, W, H);
      tvTexture.update();
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
      return;
    }
    // Still, placeholder drawings until the real stills are generated.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d1626');
    g.addColorStop(1, '#1d2a40');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    let head = 'HAWKES BIOMEDICAL';
    if (still === 'tower' || still === 'police') {
      head = 'HAWKES TOWER';
      ctx.fillStyle = '#0a0f18';
      ctx.fillRect(190, 30, 120, 200);
      ctx.fillRect(220, 12, 60, 24);
      ctx.fillStyle = '#e9c46a';
      for (let y = 44; y < 220; y += 14) for (let x = 200; x < 300; x += 18) if ((x * 7 + y * 3) % 5 !== 0) ctx.fillRect(x, y, 8, 6);
      if (still === 'police') {
        ctx.fillStyle = Math.floor(newsT * 3) % 2 ? '#d33' : '#37c';
        ctx.fillRect(60, 200, 40, 14);
        ctx.fillRect(412, 200, 40, 14);
      }
    } else if (still === 'portrait') {
      head = 'PIERCE HAWKES';
      ctx.fillStyle = '#2b3445';
      ctx.fillRect(176, 28, 160, 190);
      ctx.fillStyle = '#9b8672';
      ctx.beginPath();
      ctx.arc(256, 100, 40, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#141a26';
      ctx.fillRect(206, 150, 100, 68);
      ctx.fillStyle = '#c9ced6';
      ctx.font = '12px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('FOUNDER AND CHAIRMAN', 256, 232);
    } else {
      head = 'THE BOARD';
      ctx.fillStyle = '#273247';
      ctx.fillRect(110, 110, 292, 30);
      ctx.fillStyle = '#9aa4b6';
      for (let i = 0; i < 6; i++) ctx.fillRect(122 + i * 48, 78, 28, 34);
    }
    // Headline band and the lower third.
    ctx.fillStyle = '#b01c2a';
    ctx.fillRect(0, 0, W, 24);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`MORNING NEWS · ${head}`, 10, 17);
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(0, H - 52, W, 52);
    ctx.fillStyle = '#e9c46a';
    ctx.font = 'bold 20px Arial, sans-serif';
    const tickIndex = Math.floor(newsT / 3) % TICKERS.length;
    const tid = tickIndex === 3 ? tickId(variant()) : TICKERS[tickIndex];
    const t = lineText(tid, TICK_FALLBACK[tid] ?? 'HAWKES BIOMEDICAL REMOVES FOUNDER AS CHAIRMAN');
    ctx.fillText(t, 12, H - 28);
    ctx.fillStyle = '#fff';
    ctx.font = '13px Arial, sans-serif';
    ctx.fillText('LIVE · HAWKES TOWER · PIERCE HAWKES', 12, H - 8);
    if (!tvSeen.includes(head)) tvSeen.push(head);
    if (!tvSeen.includes(t)) tvSeen.push(t);
    tvTexture.update();
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
    box('morning-bed-frame', BED.x, 0.22, BED.z, 2.3, 0.44, 2.0, wood, true);
    box('morning-bed-mattress', BED.x, 0.52, BED.z, 2.2, 0.18, 1.9, sheet);
    box('morning-bed-pillow', 7.55, 0.68, BED.z, 0.5, 0.14, 0.9, mat(s, 'morning-pillow', 0.85, 0.85, 0.82));
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
    host.placePierce(BED_SIDE.x, BED_SIDE.z, BED_SIDE.yaw);
    host.fade(0, 0.2);
    setMorning(true);
    setTv(true, 'static');
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

  const stepSleep = () => {
    if (!flags.has('home')) {
      flags.add('home');
      host.fade(1, 1.1);
      host.placePierce(BED_SIDE.x, BED_SIDE.z, BED_SIDE.yaw);
      host.playClip('rebornidle', true);
      say(L_HOME);
    }
    if (time < 1.4) {
      host.frameCamera({ x: 4.6, y: 1.7, z: 0.5 }, { x: BED.x, y: 0.7, z: BED.z });
    } else if (time < 6.2) {
      // Lights out. He lies in the bed in the dark.
      if (!flags.has('down')) {
        flags.add('down');
        setMorning(false);
        setTv(false, 'off');
        host.placePierce(LIE.x, LIE.z, LIE.yaw);
        host.playFile(PLACE_SFX.bed, 0.5);
      }
      host.lie(true, LIE.x, LIE.y, LIE.z, LIE.yaw);
      host.frameCamera({ x: 4.9, y: 1.45, z: -0.9 }, { x: 7.0, y: 0.75, z: BED.z });
    } else {
      host.lie(true, LIE.x, LIE.y, LIE.z, LIE.yaw);
      if (!flags.has('wake')) {
        flags.add('wake');
        beat = 'wake';
        setMorning(true);
        host.fade(0, 2.2);
        host.frameCamera({ x: 4.9, y: 1.45, z: -0.9 }, { x: 7.0, y: 0.75, z: BED.z });
      }
      if (time > 7.2 && !flags.has('slept')) {
        flags.add('slept');
        say(L_SLEPT);
      } else if (time > 10 && !flags.has('dont')) {
        flags.add('dont');
        say(L_DONT);
      } else if (time > 13.2 && !flags.has('tv')) {
        flags.add('tv');
        setTv(true, 'static');
        host.playFile(PLACE_SFX.tvStatic, 0.3);
      }
    }
    if (time > 15) endSleep();
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
    // A portrait phone sees a narrow slice: back the camera up (inside the south wall) until the whole set fits.
    const eng = host.scene.getEngine();
    const aspect = eng.getRenderWidth() / Math.max(1, eng.getRenderHeight());
    const fit = Math.min(2.55, Math.max(1.2, 1.15 / (0.4228 * Math.max(0.3, aspect)) - 4.15 + 1.2));
    host.frameCamera({ x: 4.1 + (fit - 1.2) * 0.1, y: 1.55, z: Math.min(fit, 2.55) }, { x: TV.x, y: 1.3, z: TV.z });
    // Captions in order; the first one lands as the programme's opening sting ends.
    let at = 2.4;
    let shown = -1;
    for (let i = 0; i < NEWS_CAPTIONS.length; i++) {
      if (time >= at) shown = i;
      at += holdFor(caption(i, variant()));
    }
    const total = at;
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
      lying: flags.has('down') && (beat === 'sleep' || beat === 'wake'),
      tvOn,
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
      time += dt;
      blink += dt;
      if (led) led.emissiveColor = new BABYLON.Color3(blink % 1 < 0.5 ? 0.9 : 0.1, 0.05, 0.05);
      refreshMirror();
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
        if (tvOn && still === 'static') {
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
            if (busy) wasBusy = true;
            if (wasBusy && !busy) {
              callDone = true;
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
