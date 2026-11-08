import * as BABYLON from '@babylonjs/core';

import { carryItems, lineAudio, lineSpeaker, lineText } from '../game/locale';
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
 *   call    Voss rings (`voss-morning`, one-way: Voss talks, Pierce listens). The player answers with F.
 *   out     The front door. Action: Leave. His last line, then End Level (Exit only; nothing follows).
 *
 * The anchor is on-screen captions only for now (no voice). Stills are drawn on the canvas as placeholders.
 */

export type MorningHost = {
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
  offerEnd: (title: string, text: string) => void;
  clearInput: () => void;
  unlockNext: () => void;
  refreshHud: () => void;
  ringCall: (id: string) => void;
  /** A call is ringing or on (the phone holds the body). */
  callBusy: () => boolean;
};

export type MorningStory = {
  beat: 'ride' | 'walk' | 'home' | 'sleep' | 'wake' | 'news' | 'call' | 'out' | 'leaving' | 'done';
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
};

export const ENDING_TRACK = '/assets/audio/ending-6.mp3';

const START = { x: 1.3, z: 2.0, yaw: Math.PI };
const BED = { x: 6.7, z: -1.9 };
const BED_SIDE = { x: 5.9, z: -0.45, yaw: Math.PI };
const TV = { x: 3.2, z: -2.95 };
const WATCH = { x: 3.2, z: -0.4 };
const DOOR = { x: 1.2, z: 2.7 };
/** Where the bot and the marker stand to use the door. */
const LIE = { x: 5.75, y: 0.64, z: BED.z, yaw: Math.PI / 2 };

const CARRY: StoryCarry[] = [
  { id: 'phone', name: 'Phone', note: 'F. Voss will ring.' },
];

type Line = { id: string; speaker: string; hold: number; volume?: number };
const L_HAND: Line = { id: 'dialogue.morning.hand', speaker: 'Pierce', hold: 2.6 };
const L_HOME: Line = { id: 'dialogue.morning.home', speaker: 'Pierce', hold: 1.6 };
const L_SLEPT: Line = { id: 'dialogue.morning.slept', speaker: 'Pierce', hold: 2.0 };
const L_DONT: Line = { id: 'dialogue.morning.dont', speaker: 'Pierce', hold: 2.4 };
const L_WITHOUT: Line = { id: 'dialogue.morning.without', speaker: 'Pierce', hold: 3.6 };
const L_MINE: Line = { id: 'dialogue.morning.mine', speaker: 'Pierce', hold: 2.2 };
const L_BLOCKS: Line = { id: 'dialogue.morning.blocks', speaker: 'Pierce', hold: 4.2 };
const L_WALKS: Line = { id: 'dialogue.morning.walks', speaker: 'Pierce', hold: 5.2 };

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

const caption = (index: number) => lineText(NEWS_CAPTIONS[index], FALLBACK_NEWS[index]);
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

  const sceneOf = (b: MorningStory['beat']) => (b === 'ride' ? 0 : b === 'walk' ? 1 : b === 'home' ? 2 : b === 'sleep' || b === 'wake' ? 3 : b === 'news' ? 4 : b === 'call' ? 5 : 6);
  const markScene = () => {
    const n = sceneOf(beat);
    if (scenes[scenes.length - 1] !== n) scenes.push(n);
  };

  const owned: (BABYLON.Mesh | BABYLON.Material | BABYLON.BaseTexture)[] = [];
  let tvTexture: BABYLON.DynamicTexture | null = null;
  let tvMaterial: BABYLON.StandardMaterial | null = null;
  let windowMaterial: BABYLON.StandardMaterial | null = null;
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
    const t = lineText(TICKERS[Math.floor(newsT / 3) % TICKERS.length], 'HAWKES BIOMEDICAL REMOVES FOUNDER AS CHAIRMAN');
    ctx.fillText(t, 12, H - 28);
    ctx.fillStyle = '#fff';
    ctx.font = '13px Arial, sans-serif';
    ctx.fillText('LIVE · HAWKES TOWER · PIERCE HAWKES', 12, H - 8);
    if (!tvSeen.includes(head)) tvSeen.push(head);
    if (!tvSeen.includes(t)) tvSeen.push(t);
    tvTexture.update();
  };

  const setTv = (on: boolean, next: typeof still) => {
    tvOn = on;
    still = on ? next : 'off';
    if (tvMaterial) tvMaterial.emissiveColor = on ? new BABYLON.Color3(1, 1, 1) : new BABYLON.Color3(0.15, 0.15, 0.15);
    drawTv();
  };

  const setMorning = (on: boolean) => {
    for (const l of lamps) l.light.intensity = on ? l.day : l.night;
    if (windowMaterial) {
      windowMaterial.emissiveColor = on ? new BABYLON.Color3(0.95, 0.78, 0.5) : new BABYLON.Color3(0.05, 0.09, 0.16);
    }
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
    // Sofa and a coffee table in front of it; the chair by the window with a coat on it.
    box('morning-sofa', 3.2, 0.3, 0.6, 2.0, 0.6, 0.85, cloth, true);
    box('morning-sofa-back', 3.2, 0.7, 1.0, 2.0, 0.5, 0.2, cloth);
    box('morning-table', 3.2, 0.2, -1.3, 1.1, 0.4, 0.6, wood, true);
    box('morning-chair', 1.0, 0.25, -1.3, 0.6, 0.5, 0.6, cloth, true);
    box('morning-coat', 1.0, 0.62, -1.18, 0.5, 0.3, 0.12, mat(s, 'morning-coat', 0.12, 0.12, 0.13));
    // Window on the west wall, front door on the south wall.
    windowMaterial = mat(s, 'morning-window', 0.2, 0.3, 0.5, 1);
    owned.push(windowMaterial);
    box('morning-window', 0.02, 1.5, -0.4, 0.04, 1.2, 1.8, windowMaterial);
    box('morning-door', DOOR.x, 1.05, 2.98, 1.0, 2.1, 0.06, mat(s, 'morning-door', 0.2, 0.16, 0.12));
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
    lamps.length = 0;
    tvTexture = null;
    tvMaterial = null;
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

  const finish = () => {
    playing = false;
    beat = 'done';
    control();
    host.clearMarker();
    host.showObjective(false);
    host.unlockNext();
    host.offerEnd(lineSpeaker('ui.complete.morning', 'Level Complete'), lineText('ui.complete.morning', 'The morning kept its story. He kept the door.'));
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
    }
    host.frameCamera({ x: 4.5, y: 1.55, z: 1.2 }, { x: TV.x, y: 1.3, z: TV.z });
    // Captions in order; the first one lands after a second of static.
    let at = 1.2;
    let shown = -1;
    for (let i = 0; i < NEWS_CAPTIONS.length; i++) {
      if (time >= at) shown = i;
      at += holdFor(caption(i));
    }
    const total = at;
    if (shown >= 0 && shown + 1 > captionsShown) {
      captionsShown = shown + 1;
      still = NEWS_STILLS[shown];
      host.showLine(lineSpeaker(NEWS_CAPTIONS[shown], 'Morning News'), caption(shown));
    }
    if (time >= total && !flags.has('without')) {
      flags.add('without');
      lineUntil = 0;
      say(L_WITHOUT);
    }
    if (time >= total + L_WITHOUT.hold + 0.4) endNews();
  };

  const stepLeaving = () => {
    if (!flags.has('start')) {
      flags.add('start');
      host.placePierce(DOOR.x, DOOR.z - 0.2, 0);
      host.playClip('rebornidle', true);
      say(L_WALKS);
    }
    host.frameCamera({ x: 2.6, y: 1.55, z: 0.4 }, { x: DOOR.x, y: 1.2, z: DOOR.z });
    if (time >= L_WALKS.hold + 0.6) finish();
  };

  return {
    objectiveKey: () => 'morning',
    playing: () => playing,
    action: () => {
      if (!active || playing) return null;
      if (beat === 'home' && near(BED, 1.9)) return lineText('ui.action.morning.sleep', 'Sleep');
      if (beat === 'news' && near({ x: TV.x, z: -1.2 }, 1.9)) return lineText('ui.action.morning.watch', 'Watch');
      if (beat === 'out' && near(DOOR, 1.3)) return lineText('ui.action.morning.leave', 'Leave');
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
      if (beat === 'out' && near(DOOR, 1.3)) {
        beginScene('leaving');
        return true;
      }
      return false;
    },
    skip: () => {
      if (!active || !playing) return;
      if (beat === 'ride' || beat === 'walk') endIntro();
      else if (beat === 'sleep' || beat === 'wake') endSleep();
      else if (beat === 'news') endNews();
      else if (beat === 'leaving') finish();
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
    }),
    dispose: () => {
      active = false;
      playing = false;
      clearRoom();
    },
    onStart: () => {
      clearRoom();
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
      host.setCarry(carryItems('morning', CARRY));
      build();
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
      if (playing) {
        if (beat === 'ride' || beat === 'walk') stepIntro();
        else if (beat === 'sleep' || beat === 'wake') stepSleep();
        else if (beat === 'news') stepNews();
        else if (beat === 'leaving') stepLeaving();
      } else {
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
              host.setObjective(lineSpeaker('objective.morning.out', 'Out'), lineText('objective.morning.out', 'The front door.'), { x: DOOR.x, y: 1.3, z: DOOR.z - 0.3 });
              host.showObjective(true);
            } else if (!wasBusy && ringSince > 40) {
              // Nobody picked up: Voss tries again.
              rang = false;
              ringIn = 2;
            }
          }
        }
      }
      if (lineUntil > 0 && time > lineUntil) {
        lineUntil = 0;
        host.showLine('', '');
      }
    },
  };
};

export type TheMorning = ReturnType<typeof createTheMorning>;
