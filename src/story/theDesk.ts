import * as BABYLON from '@babylonjs/core';

import type { StoryCarry } from './act1';

export type DeskHost = {
  scene: BABYLON.Scene;
  placePierce: (x: number, z: number, yaw: number) => void;
  playClip: (clip: string, loop: boolean, speed?: number) => void;
  frameCamera: (position: { x: number; y: number; z: number }, lookAt: { x: number; y: number; z: number }) => void;
  releaseCamera: () => void;
  fade: (to: number, seconds?: number) => void;
  showLine: (title: string, text: string) => void;
  holdScene: (held: boolean) => void;
  clearMarker: () => void;
  showObjective: (visible: boolean) => void;
  playFile: (url: string, volume: number) => void;
  setWalk: (moving: boolean) => void;
  setCarry: (items: StoryCarry[]) => void;
  win: () => void;
  showMessage: (title: string, text: string) => void;
  haltPlay: () => void;
  clearInput: () => void;
  unlockNext: () => void;
  refreshHud: () => void;
};

const MIRROR = { x: 19.05, z: 28.15, yaw: Math.PI / 2 };
const GLASS = { x: 20.22, y: 1.5, z: 28.15 };
const DESK = { x: 48.05, z: 41.22, yaw: 0 };
const CAB = { x: 44.15, z: 25.55, yaw: Math.PI };

const ACCEPT = '/assets/audio/cutscenes/going-home/04-pierce-accept.wav';
const NATURE = '/assets/audio/cutscenes/going-home/05-pierce-nature.wav';
const STILL = '/assets/audio/cutscenes/the-desk/01-pierce-still-here.wav';
const GOING = '/assets/audio/cutscenes/going-home/06-pierce-home.wav';

const CARRY: StoryCarry[] = [
  { id: 'phone', name: 'Phone', note: 'He is not picking it up.' },
  { id: 'sidearm', name: 'Sidearm', note: 'Still holstered. The work is what he came for.' },
];

type Pose = { t: number; x: number; z: number; yaw: number };
type Shot = { t: number; cx: number; cy: number; cz: number; lx: number; ly: number; lz: number };
type Sheet = {
  mesh: BABYLON.Mesh;
  v: BABYLON.Vector3;
  spin: number;
  grounded: boolean;
};

const WALK: Pose[] = [
  { t: 0, x: MIRROR.x, z: MIRROR.z, yaw: MIRROR.yaw },
  { t: 13.2, x: MIRROR.x, z: MIRROR.z, yaw: MIRROR.yaw },
  { t: 16.2, x: 18.35, z: 32.1, yaw: 0 },
  { t: 18, x: 18.5, z: 32.15, yaw: Math.PI / 2 },
  { t: 26, x: 36.2, z: 32.15, yaw: Math.PI / 2 },
  { t: 29.5, x: 40.2, z: 36.7, yaw: Math.PI / 2 },
  { t: 33, x: 46.2, z: 37.4, yaw: 0 },
  { t: 36.2, x: DESK.x, z: DESK.z, yaw: DESK.yaw },
  { t: 42.05, x: DESK.x, z: DESK.z, yaw: DESK.yaw },
  { t: 42.45, x: DESK.x, z: 41.82, yaw: DESK.yaw },
  { t: 43.15, x: DESK.x, z: 41.4, yaw: DESK.yaw },
  { t: 48.8, x: DESK.x, z: 41.4, yaw: DESK.yaw },
  { t: 51.5, x: 46.3, z: 40.5, yaw: Math.PI },
  { t: 55, x: 46.2, z: 36.6, yaw: -Math.PI / 2 },
  { t: 58.5, x: 40.2, z: 36.6, yaw: Math.PI },
  { t: 63.5, x: 40.4, z: 27.4, yaw: Math.PI / 2 },
  { t: 67.2, x: CAB.x, z: CAB.z, yaw: CAB.yaw },
  { t: 69.4, x: CAB.x, z: CAB.z, yaw: CAB.yaw },
];

const SHOTS: Shot[] = [
  { t: 0, cx: 19.72, cy: 1.58, cz: 29.2, lx: 19.12, ly: 1.42, lz: 28.2 },
  { t: 13, cx: 19.55, cy: 1.6, cz: 29.25, lx: 19.08, ly: 1.42, lz: 28.18 },
  { t: 18, cx: 16.5, cy: 1.72, cz: 30.2, lx: 18.6, ly: 1.4, lz: 32.1 },
  { t: 26, cx: 33.4, cy: 1.75, cz: 30.4, lx: 36.8, ly: 1.4, lz: 32.2 },
  { t: 33, cx: 44.2, cy: 1.78, cz: 36.2, lx: 46.4, ly: 1.4, lz: 39 },
  { t: 36.5, cx: 50.15, cy: 1.62, cz: 40.55, lx: 48.1, ly: 1.05, lz: 42.35 },
  { t: 48.5, cx: 50.05, cy: 1.58, cz: 40.7, lx: 48.05, ly: 0.9, lz: 42.4 },
  { t: 56, cx: 43.6, cy: 1.75, cz: 34.2, lx: 44.8, ly: 1.4, lz: 28 },
  { t: 67, cx: 42.2, cy: 1.68, cz: 27.4, lx: 44.2, ly: 1.35, lz: 24.2 },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const sample = <T extends { t: number }>(keys: T[], time: number): [T, T, number] => {
  let i = 0;
  while (i < keys.length - 2 && time > keys[i + 1].t) i += 1;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  const span = Math.max(0.001, b.t - a.t);
  return [a, b, Math.max(0, Math.min(1, (time - a.t) / span))];
};

export const createTheDesk = (host: DeskHost) => {
  let active = false;
  let playing = false;
  let finished = false;
  let time = 0;
  let clip: 'walk' | 'idle' | '' = '';
  let lineUntil = 0;
  let saidAccept = false;
  let saidNature = false;
  let saidStill = false;
  let swept = false;
  let saidGoing = false;
  let shake = 0;
  let mirrorTex: BABYLON.MirrorTexture | null = null;
  const mirrorNodes: BABYLON.AbstractMesh[] = [];
  const sheets: Sheet[] = [];

  const say = (title: string, text: string, url: string, volume: number, hold: number) => {
    host.showLine(title, text);
    host.playFile(url, volume);
    lineUntil = time + hold;
  };

  const setClip = (next: 'walk' | 'idle', moving: boolean) => {
    host.setWalk(moving && playing);
    if (clip === next) return;
    clip = next;
    host.playClip(next === 'walk' ? 'walk' : 'rebornidle', true);
  };

  const clearMirror = () => {
    mirrorTex?.dispose();
    mirrorTex = null;
    for (const mesh of mirrorNodes) {
      if (!mesh.isDisposed()) mesh.dispose(false, true);
    }
    mirrorNodes.length = 0;
  };

  const mountMirror = () => {
    clearMirror();
    const frame = BABYLON.MeshBuilder.CreateBox('desk-mirror-frame', { width: 0.04, height: 0.98, depth: 1.4 }, host.scene);
    frame.position.set(GLASS.x + 0.025, GLASS.y, GLASS.z);
    frame.isPickable = false;
    frame.checkCollisions = false;
    const frameMat = new BABYLON.StandardMaterial('desk-mirror-frame-mat', host.scene);
    frameMat.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.055);
    frameMat.specularColor = new BABYLON.Color3(0.55, 0.56, 0.58);
    frame.material = frameMat;
    const glass = BABYLON.MeshBuilder.CreatePlane('desk-mirror', {
      width: 1.24,
      height: 0.84,
      sideOrientation: BABYLON.Mesh.DOUBLESIDE,
    }, host.scene);
    glass.position.set(GLASS.x, GLASS.y, GLASS.z);
    glass.rotation.y = -Math.PI / 2;
    glass.isPickable = false;
    glass.checkCollisions = false;
    const glassMat = new BABYLON.StandardMaterial('desk-mirror-mat', host.scene);
    glassMat.disableLighting = true;
    glassMat.diffuseColor = BABYLON.Color3.Black();
    glassMat.specularColor = new BABYLON.Color3(0.22, 0.22, 0.24);
    glassMat.specularPower = 64;
    const caps = host.scene.getEngine().getCaps();
    const texType = caps.textureHalfFloatRender
      ? BABYLON.Constants.TEXTURETYPE_HALF_FLOAT
      : BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE;
    const tex = new BABYLON.MirrorTexture('desk-mirror-tex', { width: 1024, height: 1024 }, host.scene, false, texType);
    tex.mirrorPlane = BABYLON.Plane.FromPositionAndNormal(glass.position, new BABYLON.Vector3(1, 0, 0));
    tex.level = 0.45;
    glassMat.reflectionTexture = tex;
    glass.material = glassMat;
    mirrorTex = tex;
    mirrorNodes.push(frame, glass);
    const skip = new Set<BABYLON.AbstractMesh>(mirrorNodes);
    tex.renderList = host.scene.meshes.filter((mesh) => !skip.has(mesh));
  };

  const paperMat = (name: string, color: BABYLON.Color3) => {
    const material = new BABYLON.StandardMaterial(name, host.scene);
    material.diffuseColor = color;
    material.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
    return material;
  };

  const spawnWork = () => {
    const spots: [number, number, number, number, number][] = [
      [47.62, 42.42, 0.22, 0.28, 0.2],
      [47.95, 42.55, 0.24, 0.3, -0.4],
      [48.28, 42.38, 0.2, 0.26, 0.6],
      [48.55, 42.62, 0.18, 0.24, 1.1],
      [48.12, 42.28, 0.16, 0.2, 0.15],
    ];
    spots.forEach(([x, z, w, d, yaw], index) => {
      const mesh = BABYLON.MeshBuilder.CreateBox(`desk-paper-${index}`, {
        width: w,
        height: 0.008,
        depth: d,
      }, host.scene);
      mesh.position.set(x, 0.755 + index * 0.004, z);
      mesh.rotation.y = yaw;
      mesh.material = paperMat(`desk-paper-mat-${index}`, new BABYLON.Color3(0.86, 0.84, 0.78));
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      sheets.push({ mesh, v: BABYLON.Vector3.Zero(), spin: 0, grounded: true });
    });
    const folder = BABYLON.MeshBuilder.CreateBox('desk-folder', { width: 0.28, height: 0.02, depth: 0.36 }, host.scene);
    folder.position.set(47.78, 0.79, 42.7);
    folder.rotation.y = -0.25;
    folder.material = paperMat('desk-folder-mat', new BABYLON.Color3(0.62, 0.48, 0.28));
    folder.isPickable = false;
    folder.checkCollisions = false;
    sheets.push({ mesh: folder, v: BABYLON.Vector3.Zero(), spin: 0, grounded: true });
  };

  const sweep = () => {
    sheets.forEach((sheet, index) => {
      const side = (index - 2.5) * 0.55;
      sheet.grounded = false;
      sheet.v.set(side, 1.35 + (index % 3) * 0.18, -2.4 - index * 0.15);
      sheet.spin = (index % 2 === 0 ? 1 : -1) * (4 + index * 0.4);
    });
    shake = 0.22;
  };

  const stepSheets = (dt: number) => {
    for (const sheet of sheets) {
      if (sheet.grounded) continue;
      sheet.v.y -= 9.2 * dt;
      sheet.mesh.position.addInPlace(sheet.v.scale(dt));
      sheet.mesh.rotation.x += sheet.spin * dt;
      sheet.mesh.rotation.z += sheet.spin * 0.35 * dt;
      if (sheet.mesh.position.y <= 0.02) {
        sheet.mesh.position.y = 0.02;
        sheet.v.setAll(0);
        sheet.grounded = true;
      }
    }
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    playing = false;
    host.setWalk(false);
    host.showLine('', '');
    host.clearMarker();
    host.showObjective(false);
    host.clearInput();
    host.playClip('rebornidle', true);
    host.haltPlay();
    host.unlockNext();
    host.win();
    host.fade(1, 1.15);
    host.refreshHud();
    host.showMessage('Level Complete', 'The work is on the floor. Continue. He is going home.');
  };

  return {
    playing: () => playing,
    shake: () => shake,
    skip: () => {
      if (active && playing && !finished) finish();
    },
    dispose: () => {
      active = false;
      playing = false;
      clearMirror();
      for (const sheet of sheets) {
        if (!sheet.mesh.isDisposed()) sheet.mesh.dispose(false, true);
      }
      sheets.length = 0;
    },
    onStart: () => {
      for (const sheet of sheets) {
        if (!sheet.mesh.isDisposed()) sheet.mesh.dispose(false, true);
      }
      sheets.length = 0;
      clearMirror();
      active = true;
      playing = true;
      finished = false;
      time = 0;
      clip = '';
      lineUntil = 0;
      saidAccept = false;
      saidNature = false;
      saidStill = false;
      swept = false;
      saidGoing = false;
      shake = 0;
      host.setCarry(CARRY);
      host.fade(1, 0);
      host.fade(0, 1.6);
      host.holdScene(true);
      host.showObjective(false);
      host.clearMarker();
      host.scene.getMeshByName('Office Ammo')?.setEnabled(false);
      mountMirror();
      spawnWork();
      host.placePierce(MIRROR.x, MIRROR.z, MIRROR.yaw);
      host.playClip('rebornidle', true);
      clip = 'idle';
    },
    step: (delta: number) => {
      if (!active || finished || !playing) return;
      const dt = Math.min(0.05, Math.max(0, delta));
      shake = Math.max(0, shake - dt);
      time += dt;
      const [pa, pb, pt] = sample(WALK, time);
      const x = lerp(pa.x, pb.x, pt);
      const z = lerp(pa.z, pb.z, pt);
      const dx = pb.x - pa.x;
      const dz = pb.z - pa.z;
      const moving = Math.hypot(dx, dz) > 0.15 && pt < 0.98;
      const yaw = moving ? Math.atan2(dx, dz) : lerp(pa.yaw, pb.yaw, pt);
      host.placePierce(x, z, yaw);
      setClip(moving ? 'walk' : 'idle', moving);
      const [sa, sb, st] = sample(SHOTS, time);
      host.frameCamera(
        { x: lerp(sa.cx, sb.cx, st), y: lerp(sa.cy, sb.cy, st), z: lerp(sa.cz, sb.cz, st) },
        { x: lerp(sa.lx, sb.lx, st), y: lerp(sa.ly, sb.ly, st), z: lerp(sa.lz, sb.lz, st) },
      );
      if (!saidAccept && time >= 1.1) {
        saidAccept = true;
        say('Pierce Hawkes', 'Look at this. Nobody is going to accept me. Not looking like this.', ACCEPT, 0.92, 5.5);
      } else if (!saidNature && time >= 7) {
        saidNature = true;
        say('Pierce Hawkes', 'That is just human nature. People decide what you are before you ever speak.', NATURE, 0.92, 5.4);
      } else if (!saidStill && time >= 36.6) {
        saidStill = true;
        say('Pierce Hawkes', "It's all still here. I was supposed to finish this.", STILL, 0.92, 4.8);
      } else if (!swept && time >= 42.15) {
        swept = true;
        sweep();
      } else if (!saidGoing && time >= 43.4) {
        saidGoing = true;
        say('Pierce Hawkes', 'I am not staying here to be stared at. I am going home.', GOING, 0.92, 4.2);
      } else if (lineUntil > 0 && time > lineUntil) {
        lineUntil = 0;
        host.showLine('', '');
      }
      stepSheets(dt);
      if (time >= 69.6) finish();
    },
  };
};

export type TheDesk = ReturnType<typeof createTheDesk>;
