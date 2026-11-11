import * as BABYLON from '@babylonjs/core';

import { createCharacterAvatar, type PlayerAvatar } from '../game/playerAvatar';
import { TRANSFORM_HERO_ASSET_ID } from '../game/modelLoader';
import { PLAYER_MESH_Y_OFFSET, PLAYER_STAND_Y } from '../game/player';
import { carryItems, lineAudio, lineSpeaker, lineText } from '../game/locale';
import type { StoryCarry } from './act1';
import { DOUBLE_LAYER, mountBathroomMirror, type BathroomMirror } from './bathroomMirror';
import { DESK_RADIO, placeLine } from './placeVoices';

/**
 * The Desk (level 4), played with the hands (docs/story/playable-beats.md).
 *
 * The mirror: Pierce starts in the hall bathroom and walks to the glass himself. Close to it the camera eases over
 * his shoulder onto the reflection. The reflection is a second body that copies his moves a little late, and the
 * lag grows from 0 to about half a second; then it turns its head once, before he does. The hum and his breathing
 * drop out, and "That's me." plays into the quiet.
 *
 * The desk: he walks to it and the work is still there. A held drag (mouse or one finger) is his arm: papers, the
 * folder, the glass and the terminal slide with it and go over the edge, as many as the drag is hard enough to move.
 * A hand floats over the papers and shows the motion. "I'm going home" follows.
 */

export type DeskHost = {
  scene: BABYLON.Scene;
  placePierce: (x: number, z: number, yaw: number) => void;
  playClip: (clip: string, loop: boolean, speed?: number) => void;
  frameCamera: (position: { x: number; y: number; z: number }, lookAt: { x: number; y: number; z: number }) => void;
  releaseCamera: () => void;
  /** Keep the follow camera's heading fixed (the stick walks relative to it). */
  faceCamera: (yaw: number) => void;
  fade: (to: number, seconds?: number) => void;
  showLine: (title: string, text: string) => void;
  holdScene: (held: boolean) => void;
  clearMarker: () => void;
  showObjective: (visible: boolean) => void;
  setObjective: (title: string, text: string, target: { x: number; z: number; y?: number } | null) => void;
  playFile: (url: string, volume: number, rate?: number) => void;
  /** 1 plays the level's bed, 0 drops it. */
  setBedDuck: (amount: number) => void;
  setWalk: (moving: boolean) => void;
  setCarry: (items: StoryCarry[]) => void;
  playerXZ: () => { x: number; z: number };
  playerYaw: () => number;
  resumeLocomotion: () => void;
  win: () => void;
  showMessage: (title: string, text: string) => void;
  offerEnd: (title: string, text: string) => void;
  haltPlay: () => void;
  clearInput: () => void;
  unlockNext: () => void;
  refreshHud: () => void;
};

const MIRROR = { x: 18.65, z: 28.15, yaw: Math.PI / 2 };
/** He starts inside the bathroom, a few steps from the glass, facing it. */
const SPAWN = { x: 16.9, z: 28.15, yaw: Math.PI / 2 };
const DESK = { x: 48.05, z: 41.22, yaw: 0 };
/** Walking within this of the desk (x 48, z 42.35) takes him to it. */
const DESK_NEAR = { x: 48.0, z: 41.9, r: 1.6 };
/** Night security on the radio, in the gaps between Pierce's lines (seconds into the walk to the desk). */
const RADIO_AT = [5, 16, 40] as const;

const ACCEPT = '/assets/audio/cutscenes/going-home/04-pierce-accept.wav';
const NATURE = '/assets/audio/cutscenes/going-home/05-pierce-nature.wav';
const THATS_ME = '/assets/audio/cutscenes/return-mirror/01-pierce-thats-me.wav';
const STILL = '/assets/audio/cutscenes/the-desk/01-pierce-still-here.wav';
const GOING = '/assets/audio/cutscenes/going-home/06-pierce-home.wav';

export const DESK_SFX = {
  slide: '/assets/audio/sfx/desk/paper-slide.ogg',
  land: '/assets/audio/sfx/desk/paper-land.ogg',
  impact: '/assets/audio/sfx/desk/desk-impact.ogg',
  crash: '/assets/audio/sfx/desk/terminal-crash.ogg',
  breath: '/assets/audio/sfx/desk/breath.ogg',
} as const;

const CARRY: StoryCarry[] = [
  { id: 'phone', name: 'Phone', note: 'He is not picking it up.' },
  { id: 'sidearm', name: 'Sidearm', note: 'Still holstered. The work is what he came for.' },
];

/** The reflection's lag, in seconds, grows to this while he moves. */
const LAG_MAX = 0.5;
const LAG_RAMP_FROM = 0.8;
const LAG_RAMP_FOR = 7.5;
/** The head turn waits for the lag to be there and for him to have moved (metres), or this long. */
const TURN_MIN_BEAT = 9;
const TURN_MIN_WALK = 1.6;
const TURN_MAX_BEAT = 18;
const HEAD_TURN = { out: 0.45, hold: 0.9, back: 0.5, angle: 0.95 };

const SHOT = { cx: 50.1, cy: 1.6, cz: 40.6, lx: 48.08, ly: 1.0, lz: 42.38 };
const DESK_TOP_FALLBACK = { minX: 47.2, maxX: 48.8, minZ: 41.95, maxZ: 42.75, top: 0.75 };
const ROOM = { minX: 43.2, maxX: 52.8, minZ: 40.0, maxZ: 46.6 };

type Phase = 'approach' | 'mirror' | 'walk' | 'arrive' | 'sweep' | 'going' | 'done';
type Pose = { t: number; x: number; z: number; yaw: number; moving: boolean };

type Prop = {
  id: string;
  kind: 'paper' | 'prop';
  node: BABYLON.TransformNode | BABYLON.AbstractMesh;
  /** Resting height on the floor after the fall. */
  floorY: number;
  /** Hand speed (m/s) needed to move it at all: papers go with a touch, the terminal wants a hard sweep. */
  need: number;
  /** Friction on the desk, m/s². */
  drag: number;
  radius: number;
  maxSpeed: number;
  /** Tilt it lands at, rad, and how it comes to rest. */
  tilt: number;
  v: BABYLON.Vector3;
  spin: number;
  state: 'desk' | 'slide' | 'fall' | 'floor';
  sound: 'land' | 'impact' | 'crash';
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const createTheDesk = (host: DeskHost) => {
  let active = false;
  let finished = false;
  let phase: Phase = 'approach';
  let clock = 0;
  let clip: 'walk' | 'idle' | '' = '';
  let lineUntil = 0;
  let radioSaid = 0;
  let shake = 0;
  let bathroomMirror: BathroomMirror | null = null;
  let double: PlayerAvatar | null = null;
  let doubleReady = false;
  let headNodes: { node: BABYLON.TransformNode; axis: BABYLON.Vector3; share: number }[] = [];
  let headObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
  let headAngle = 0;
  /** `prepare` built the mirror, the double and the papers under the chapter card; the next `onStart` keeps them. */
  let prepared = false;

  // Mirror beat.
  const history: Pose[] = [];
  let beatT = 0;
  let walked = 0;
  let lag = 0;
  let turnT = -1;
  let turnedAt = -1;
  let heldQuiet = false;
  let thatsMeAt = -1;
  let mirrorDone = false;
  let breathIn = 1.2;
  let lastPose: Pose | null = null;
  const mirrorStats = {
    engaged: false,
    maxLagMs: 0,
    lagMs: 0,
    headTurns: 0,
    headTurnBeforeHeMoved: false,
    quiet: false,
    thatsMe: false,
    walkedMetres: 0,
  };

  // Desk beat.
  const props: Prop[] = [];
  let desk = { ...DESK_TOP_FALLBACK };
  let arriveT = 0;
  let sweepT = 0;
  let idleSince = 0;
  let sweptAt = -1;
  let goingAt = -1;
  let skipped = false;
  let hand: BABYLON.Mesh | null = null;
  let handMat: BABYLON.StandardMaterial | null = null;
  const drag = {
    down: false,
    id: -1,
    sx: 0,
    sy: 0,
    last: null as { x: number; z: number; t: number; px: number; py: number } | null,
    v: new BABYLON.Vector3(),
    px: 0,
    speed: 0,
    peak: 0,
    drags: 0,
    slideAt: 0,
    rateIx: 0,
  };
  const deskStats = {
    swept: false,
    drags: 0,
    dragPx: 0,
    peakSpeed: 0,
    off: 0,
    total: 0,
    offAfterDrag: [] as number[],
    sounds: [] as string[],
    terminalOff: false,
    hint: 0,
  };
  const listeners: ['pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', (event: PointerEvent) => void][] = [];

  const say = (title: string, text: string, url: string, volume: number, hold: number) => {
    host.showLine(title, text);
    host.playFile(url, volume);
    lineUntil = clock + hold;
  };

  const heard = (id: string, url: string, volume: number, rate: number) => {
    host.playFile(url, volume, rate);
    deskStats.sounds.push(id);
  };

  const setClip = (next: 'walk' | 'idle', moving: boolean) => {
    host.setWalk(moving && phase !== 'sweep');
    if (clip === next) return;
    clip = next;
    host.playClip(next === 'walk' ? 'walk' : 'rebornidle', true);
  };

  // ---------------------------------------------------------------- mirror: the double

  const buildDouble = () => {
    const avatar = createCharacterAvatar(host.scene, 'deskDouble', TRANSFORM_HERO_ASSET_ID);
    double = avatar;
    avatar.whenReady(() => {
      doubleReady = true;
      avatar.setLocomotion(false, true);
      const group = avatar.group;
      group.setEnabled(true);
      group.position.set(SPAWN.x, PLAYER_STAND_Y - PLAYER_MESH_Y_OFFSET, SPAWN.z);
      group.rotation.y = SPAWN.yaw + Math.PI;
      for (const mesh of group.getChildMeshes(false)) mesh.layerMask = DOUBLE_LAYER;
      // The head and neck turn about the axis that points up the bone (toward its child).
      headNodes = [];
      for (const [suffix, share] of [['Head', 0.7], ['Neck', 0.3]] as const) {
        const node = avatar.findJoint(suffix);
        if (!node) continue;
        const child = node.getChildTransformNodes(true)[0];
        const axis = child && child.position.lengthSquared() > 1e-8 ? child.position.clone().normalize() : new BABYLON.Vector3(0, 1, 0);
        headNodes.push({ node, axis, share });
      }
    });
    avatar.group.setEnabled(false);
    headObserver = host.scene.onAfterAnimationsObservable.add(() => {
      if (headAngle === 0) return;
      for (const part of headNodes) {
        const turn = BABYLON.Quaternion.RotationAxis(part.axis, headAngle * part.share);
        const base = part.node.rotationQuaternion ?? BABYLON.Quaternion.FromEulerVector(part.node.rotation);
        part.node.rotationQuaternion = base.multiply(turn);
      }
    });
  };

  const placeDouble = (pose: Pose) => {
    if (!double || !doubleReady) return;
    double.group.position.set(pose.x, PLAYER_STAND_Y - PLAYER_MESH_Y_OFFSET, pose.z);
    double.group.rotation.y = pose.yaw + Math.PI;
    double.setLocomotion(pose.moving, true);
  };

  const poseAt = (t: number): Pose | null => {
    if (history.length === 0) return null;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i].t <= t) return history[i];
    }
    return history[0];
  };

  let doubleShown = false;
  const showDouble = (on: boolean) => {
    if (!bathroomMirror || !double) return;
    doubleShown = on;
    if (on) {
      double.group.setEnabled(true);
      bathroomMirror.setDouble({
        root: double.group,
        prepare: () => {
          const mesh = double?.getSkinnedMesh();
          mesh?.skeleton?.prepare();
        },
      });
    } else {
      bathroomMirror.setDouble(null);
      double.group.setEnabled(false);
    }
  };

  const clearMirror = () => {
    bathroomMirror?.dispose();
    bathroomMirror = null;
    if (headObserver) host.scene.onAfterAnimationsObservable.remove(headObserver);
    headObserver = null;
    double?.dispose();
    double = null;
    doubleReady = false;
    headNodes = [];
    headAngle = 0;
  };

  const mountMirror = () => {
    clearMirror();
    bathroomMirror = mountBathroomMirror(host.scene, 'desk-mirror');
    buildDouble();
  };

  // ---------------------------------------------------------------- desk: the work

  const paperMat = (name: string, color: BABYLON.Color3) => {
    const material = new BABYLON.StandardMaterial(name, host.scene);
    material.diffuseColor = color;
    material.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
    return material;
  };

  const nodesFor = (id: string) => {
    const found: (BABYLON.TransformNode | BABYLON.AbstractMesh)[] = [];
    for (const node of host.scene.transformNodes) {
      if ((node.metadata as { sceneAssetId?: string } | null)?.sceneAssetId === id) found.push(node);
    }
    if (found.length === 0) {
      for (const mesh of host.scene.meshes) {
        if ((mesh.metadata as { sceneAssetId?: string } | null)?.sceneAssetId === id) found.push(mesh);
      }
    }
    return found;
  };

  const loosen = (node: BABYLON.TransformNode | BABYLON.AbstractMesh) => {
    if (node.rotationQuaternion) {
      node.rotation = node.rotationQuaternion.toEulerAngles();
      node.rotationQuaternion = null;
    }
    node.unfreezeWorldMatrix();
    for (const mesh of node.getChildMeshes(false)) mesh.unfreezeWorldMatrix();
  };

  const footprint = (node: BABYLON.TransformNode | BABYLON.AbstractMesh) => {
    node.computeWorldMatrix(true);
    const meshes = node instanceof BABYLON.AbstractMesh ? [node, ...node.getChildMeshes(false)] : node.getChildMeshes(false);
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (const mesh of meshes) {
      if (mesh.getTotalVertices() === 0) continue;
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      minX = Math.min(minX, box.minimumWorld.x); maxX = Math.max(maxX, box.maximumWorld.x);
      minZ = Math.min(minZ, box.minimumWorld.z); maxZ = Math.max(maxZ, box.maximumWorld.z);
    }
    return Number.isFinite(minX) ? Math.max(0.05, Math.min(0.32, Math.max(maxX - minX, maxZ - minZ) / 2)) : 0.15;
  };

  const readDesk = () => {
    desk = { ...DESK_TOP_FALLBACK };
    const [root] = nodesFor('office-desk');
    if (!root) return;
    root.computeWorldMatrix(true);
    const meshes = root instanceof BABYLON.AbstractMesh ? [root, ...root.getChildMeshes(false)] : root.getChildMeshes(false);
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity; let top = -Infinity;
    for (const mesh of meshes) {
      if (mesh.getTotalVertices() === 0) continue;
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      minX = Math.min(minX, box.minimumWorld.x); maxX = Math.max(maxX, box.maximumWorld.x);
      minZ = Math.min(minZ, box.minimumWorld.z); maxZ = Math.max(maxZ, box.maximumWorld.z);
      top = Math.max(top, box.maximumWorld.y);
    }
    if (Number.isFinite(minX) && maxX - minX > 0.8) desk = { minX, maxX, minZ, maxZ, top: Number.isFinite(top) ? top : desk.top };
  };

  const addProp = (
    id: string,
    node: BABYLON.TransformNode | BABYLON.AbstractMesh,
    kind: Prop['kind'],
    rest: Pick<Prop, 'floorY' | 'need' | 'drag' | 'maxSpeed' | 'tilt' | 'sound'>,
    radius?: number,
  ) => {
    loosen(node);
    props.push({
      id,
      kind,
      node,
      radius: radius ?? footprint(node),
      v: BABYLON.Vector3.Zero(),
      spin: 0,
      state: 'desk',
      ...rest,
    });
  };

  const spawnWork = () => {
    readDesk();
    const spots: [number, number, number, number, number][] = [
      [47.62, 42.42, 0.22, 0.28, 0.2],
      [47.95, 42.55, 0.24, 0.3, -0.4],
      [48.28, 42.38, 0.2, 0.26, 0.6],
      [48.55, 42.62, 0.18, 0.24, 1.1],
      [48.12, 42.28, 0.16, 0.2, 0.15],
    ];
    spots.forEach(([x, z, w, d, yaw], index) => {
      const mesh = BABYLON.MeshBuilder.CreateBox(`desk-paper-${index}`, { width: w, height: 0.008, depth: d }, host.scene);
      mesh.position.set(x, desk.top + 0.005 + index * 0.004, z);
      mesh.rotation.y = yaw;
      mesh.material = paperMat(`desk-paper-mat-${index}`, new BABYLON.Color3(0.86, 0.84, 0.78));
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      addProp(`paper-${index}`, mesh, 'paper', { floorY: 0.03 + index * 0.004, need: 0.45, drag: 1.7, maxSpeed: 4.2, tilt: 0, sound: 'land' }, Math.max(w, d) / 2);
    });
    const folder = BABYLON.MeshBuilder.CreateBox('desk-folder', { width: 0.28, height: 0.02, depth: 0.36 }, host.scene);
    folder.position.set(47.78, desk.top + 0.04, 42.7);
    folder.rotation.y = -0.25;
    folder.material = paperMat('desk-folder-mat', new BABYLON.Color3(0.62, 0.48, 0.28));
    folder.isPickable = false;
    folder.checkCollisions = false;
    addProp('folder', folder, 'paper', { floorY: 0.04, need: 0.8, drag: 2.0, maxSpeed: 4, tilt: 0, sound: 'land' }, 0.2);
    for (const [id, asset, rest] of [
      ['glass', 'office-whiskey', { floorY: 0, need: 1.6, drag: 2.4, maxSpeed: 3.6, tilt: 1.25, sound: 'impact' }],
      ['terminal', 'office-terminal', { floorY: 0, need: 2.7, drag: 3.2, maxSpeed: 3.4, tilt: 0.3, sound: 'crash' }],
    ] as const) {
      const [node] = nodesFor(asset);
      if (node) addProp(id, node, 'prop', rest);
    }
    deskStats.total = props.length;
  };

  const disposeWork = () => {
    for (const prop of props) {
      if (prop.kind === 'paper' && !prop.node.isDisposed()) prop.node.dispose(false, true);
    }
    props.length = 0;
    hand?.dispose(false, true);
    handMat?.dispose();
    hand = null;
    handMat = null;
  };

  const buildHand = () => {
    if (hand) return;
    const parts: BABYLON.Mesh[] = [];
    const palm = BABYLON.MeshBuilder.CreateBox('desk-hand-palm', { width: 0.09, height: 0.022, depth: 0.1 }, host.scene);
    parts.push(palm);
    [-0.033, -0.011, 0.011, 0.033].forEach((x, i) => {
      const finger = BABYLON.MeshBuilder.CreateBox(`desk-hand-f${i}`, { width: 0.02, height: 0.018, depth: 0.075 + (i === 1 || i === 2 ? 0.012 : 0) }, host.scene);
      finger.position.set(x, 0, 0.088);
      parts.push(finger);
    });
    const thumb = BABYLON.MeshBuilder.CreateBox('desk-hand-thumb', { width: 0.05, height: 0.018, depth: 0.02 }, host.scene);
    thumb.position.set(0.062, 0, 0.02);
    thumb.rotation.y = -0.6;
    parts.push(thumb);
    const merged = BABYLON.Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (!merged) return;
    merged.name = 'desk-hand';
    handMat = new BABYLON.StandardMaterial('desk-hand-mat', host.scene);
    handMat.disableLighting = true;
    handMat.emissiveColor = new BABYLON.Color3(0.95, 0.82, 0.58);
    handMat.alpha = 0.34;
    merged.material = handMat;
    merged.isPickable = false;
    merged.checkCollisions = false;
    merged.setEnabled(false);
    hand = merged;
  };

  const planePoint = (clientX: number, clientY: number) => {
    const engine = host.scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    const camera = host.scene.activeCamera;
    if (!canvas || !camera) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = ((clientX - rect.left) / rect.width) * engine.getRenderWidth();
    const y = ((clientY - rect.top) / rect.height) * engine.getRenderHeight();
    const ray = host.scene.createPickingRay(x, y, BABYLON.Matrix.Identity(), camera);
    if (Math.abs(ray.direction.y) < 1e-4) return null;
    const t = (desk.top + 0.02 - ray.origin.y) / ray.direction.y;
    if (t <= 0) return null;
    return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
  };

  const slideRates = [0.9, 1.06, 0.97, 1.12, 0.84, 1.0];
  const nextRate = () => slideRates[drag.rateIx++ % slideRates.length];

  const push = (ax: number, az: number, bx: number, bz: number, speed: number, dx: number, dz: number) => {
    let moved = 0;
    for (const prop of props) {
      if (prop.state === 'fall' || prop.state === 'floor') continue;
      const px = prop.node.position.x;
      const pz = prop.node.position.z;
      const sx = bx - ax;
      const sz = bz - az;
      const len2 = sx * sx + sz * sz;
      const u = len2 > 1e-8 ? clamp(((px - ax) * sx + (pz - az) * sz) / len2, 0, 1) : 0;
      const dist = Math.hypot(px - (ax + sx * u), pz - (az + sz * u));
      if (dist > 0.17 + prop.radius || speed < prop.need) continue;
      const out = Math.min(prop.maxSpeed, speed * 1.05);
      prop.v.set(dx * out, 0, dz * out);
      prop.spin = (Math.random() - 0.5) * 3;
      prop.state = 'slide';
      moved += 1;
    }
    if (moved > 0 && clock - drag.slideAt > 0.28) {
      drag.slideAt = clock;
      heard('paper-slide', DESK_SFX.slide, 0.5, nextRate());
    }
  };

  const offDesk = (prop: Prop) => {
    const x = prop.node.position.x;
    const z = prop.node.position.z;
    return x < desk.minX - 0.02 || x > desk.maxX + 0.02 || z < desk.minZ - 0.02 || z > desk.maxZ + 0.02;
  };

  const countOff = () => props.filter((p) => p.state === 'fall' || p.state === 'floor').length;

  const stepProps = (dt: number) => {
    for (const prop of props) {
      const node = prop.node;
      if (prop.state === 'slide') {
        const sp = Math.hypot(prop.v.x, prop.v.z);
        const next = Math.max(0, sp - prop.drag * dt);
        if (sp > 1e-4) prop.v.scaleInPlace(next / sp);
        node.position.x += prop.v.x * dt;
        node.position.z += prop.v.z * dt;
        node.rotation.y += prop.spin * (next / 3) * dt;
        if (offDesk(prop)) {
          prop.state = 'fall';
          prop.v.y = 0;
        } else if (next < 0.02) {
          prop.v.setAll(0);
          prop.state = 'desk';
        }
      } else if (prop.state === 'fall') {
        prop.v.y -= 9.2 * dt;
        node.position.addInPlace(prop.v.scale(dt));
        node.position.x = clamp(node.position.x, ROOM.minX, ROOM.maxX);
        node.position.z = clamp(node.position.z, ROOM.minZ, ROOM.maxZ);
        node.rotation.x += prop.spin * 1.4 * dt;
        node.rotation.z += prop.spin * 0.6 * dt;
        const rest = prop.floorY + (prop.tilt > 0 ? prop.radius * Math.sin(prop.tilt) : 0);
        if (node.position.y <= rest) {
          node.position.y = rest;
          node.rotation.x = 0;
          node.rotation.z = prop.tilt > 0 ? prop.tilt : 0;
          prop.v.setAll(0);
          prop.state = 'floor';
          if (prop.sound === 'crash') shake = 0.2;
          else if (prop.sound === 'impact') shake = Math.max(shake, 0.07);
          const url = prop.sound === 'crash' ? DESK_SFX.crash : prop.sound === 'impact' ? DESK_SFX.impact : DESK_SFX.land;
          heard(prop.sound === 'land' ? 'paper-land' : prop.sound === 'impact' ? 'desk-impact' : 'terminal-crash', url, prop.sound === 'land' ? 0.45 : 0.7, nextRate());
          deskStats.off = countOff();
          if (prop.id === 'terminal') deskStats.terminalOff = true;
        }
      }
    }
  };

  // ---------------------------------------------------------------- pointer: the drag

  const interactive = (target: EventTarget | null) =>
    target instanceof Element && Boolean(target.closest('button, a, input, select, textarea, .message'));

  const onDown = (event: PointerEvent) => {
    if (phase !== 'sweep' || drag.down || interactive(event.target)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const p = planePoint(event.clientX, event.clientY);
    drag.down = true;
    drag.id = event.pointerId;
    drag.px = 0;
    drag.peak = 0;
    drag.v.setAll(0);
    drag.last = p ? { x: p.x, z: p.z, t: event.timeStamp, px: event.clientX, py: event.clientY } : null;
    drag.drags += 1;
    deskStats.drags = drag.drags;
    idleSince = clock;
    if (hand) {
      hand.setEnabled(true);
      if (p) hand.position.set(p.x, desk.top + 0.06, p.z);
    }
  };

  const onMove = (event: PointerEvent) => {
    if (phase !== 'sweep' || !drag.down || event.pointerId !== drag.id) return;
    const p = planePoint(event.clientX, event.clientY);
    if (!p) return;
    const last = drag.last;
    drag.last = { x: p.x, z: p.z, t: event.timeStamp, px: event.clientX, py: event.clientY };
    if (hand) hand.position.set(p.x, desk.top + 0.06, p.z);
    if (!last) return;
    const dtMs = Math.max(8, event.timeStamp - last.t);
    const dx = p.x - last.x;
    const dz = p.z - last.z;
    const len = Math.hypot(dx, dz);
    drag.px += Math.hypot(event.clientX - last.px, event.clientY - last.py);
    deskStats.dragPx += Math.hypot(event.clientX - last.px, event.clientY - last.py);
    if (len < 1e-5) return;
    const speed = Math.min(7, len / (dtMs / 1000));
    drag.speed = lerp(drag.speed, speed, 0.65);
    drag.peak = Math.max(drag.peak, drag.speed);
    deskStats.peakSpeed = Math.max(deskStats.peakSpeed, drag.speed);
    if (hand) hand.rotation.y = Math.atan2(dx, dz);
    idleSince = clock;
    sweptAt = sweptAt < 0 ? clock : sweptAt;
    deskStats.swept = true;
    push(last.x, last.z, p.x, p.z, drag.speed, dx / len, dz / len);
  };

  const onUp = (event: PointerEvent) => {
    if (!drag.down || event.pointerId !== drag.id) return;
    drag.down = false;
    drag.speed = 0;
    deskStats.offAfterDrag.push(countOff());
    hand?.setEnabled(false);
    idleSince = clock;
  };

  const attach = () => {
    detach();
    for (const [name, fn] of [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onUp]] as const) {
      window.addEventListener(name, fn, true);
      listeners.push([name, fn]);
    }
  };

  const detach = () => {
    for (const [name, fn] of listeners) window.removeEventListener(name, fn, true);
    listeners.length = 0;
  };

  // ---------------------------------------------------------------- flow

  const quiet = (on: boolean) => {
    if (heldQuiet === on) return;
    heldQuiet = on;
    mirrorStats.quiet = on;
    host.setBedDuck(on ? 0 : 1);
  };

  const reset = () => {
    phase = 'approach';
    clock = 0;
    clip = '';
    lineUntil = 0;
    radioSaid = 0;
    shake = 0;
    history.length = 0;
    beatT = 0;
    walked = 0;
    lag = 0;
    turnT = -1;
    turnedAt = -1;
    thatsMeAt = -1;
    mirrorDone = false;
    breathIn = 1.2;
    lastPose = null;
    heldQuiet = false;
    doubleShown = false;
    queued = [];
    Object.assign(mirrorStats, { engaged: false, maxLagMs: 0, lagMs: 0, headTurns: 0, headTurnBeforeHeMoved: false, quiet: false, thatsMe: false, walkedMetres: 0 });
    arriveT = 0;
    sweepT = 0;
    idleSince = 0;
    sweptAt = -1;
    goingAt = -1;
    skipped = false;
    headAngle = 0;
    drag.down = false;
    drag.drags = 0;
    drag.slideAt = 0;
    Object.assign(deskStats, { swept: false, drags: 0, dragPx: 0, peakSpeed: 0, off: 0, offAfterDrag: [], sounds: [], terminalOff: false, hint: 0 });
    deskStats.total = props.length;
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    phase = 'done';
    detach();
    quiet(false);
    hand?.setEnabled(false);
    host.setWalk(false);
    host.showLine('', '');
    host.clearMarker();
    host.showObjective(false);
    host.releaseCamera();
    host.holdScene(false);
    host.clearInput();
    host.resumeLocomotion();
    host.unlockNext();
    host.refreshHud();
    host.offerEnd(lineSpeaker('ui.complete.desk', 'Level Complete'), lineText('ui.complete.desk', 'The work is on the floor. Continue. He is going home.'));
  };

  const mirrorCamera = (px: number, pz: number) => {
    const cx = clamp(px - 1.15, 16.2, 19.2);
    const cz = clamp(pz + 0.5, 27.0, 29.0);
    host.frameCamera({ x: cx, y: 1.62, z: cz }, { x: 20.2, y: 1.42, z: clamp(pz - 0.1, 27.4, 28.9) });
  };

  const engage = () => {
    phase = 'mirror';
    beatT = 0;
    walked = 0;
    turnT = -1;
    mirrorStats.engaged = true;
    host.faceCamera(MIRROR.yaw);
    if (double && doubleReady) showDouble(true);
    host.setObjective(lineSpeaker('objective.desk.look', 'Look'), lineText('objective.desk.look', 'The hall bathroom. The mirror.'), { x: MIRROR.x + 0.8, y: 1.5, z: MIRROR.z });
  };

  const stepMirror = (dt: number, here: { x: number; z: number }, yaw: number) => {
    beatT += dt;
    if (here.z > 29.25) host.placePierce(here.x, 29.25, yaw);
    host.faceCamera(MIRROR.yaw);
    if (!doubleShown && doubleReady) showDouble(true);
    mirrorCamera(here.x, here.z);
    const ramp = smooth((beatT - LAG_RAMP_FROM) / LAG_RAMP_FOR);
    lag = turnedAt >= 0 && beatT > turnedAt + 2.4
      ? Math.max(0, lag - dt * 0.6)
      : LAG_MAX * ramp;
    mirrorStats.lagMs = Math.round(lag * 1000);
    mirrorStats.maxLagMs = Math.max(mirrorStats.maxLagMs, mirrorStats.lagMs);
    const pose = poseAt(clock - lag);
    if (pose) placeDouble(pose);

    // The breath: slow, close, until the glass goes quiet.
    breathIn -= dt;
    if (!heldQuiet && turnT < 0 && breathIn <= 0) {
      breathIn = 3.4;
      host.playFile(DESK_SFX.breath, 0.3, 0.97 + Math.random() * 0.06);
    }

    if (turnT < 0 && thatsMeAt < 0) {
      const ready = (beatT >= TURN_MIN_BEAT && walked >= TURN_MIN_WALK && lag >= LAG_MAX * 0.95) || beatT >= TURN_MAX_BEAT;
      if (ready) {
        turnT = 0;
        turnedAt = beatT;
        mirrorStats.headTurns += 1;
        // He has not turned: the reflection did it first.
        mirrorStats.headTurnBeforeHeMoved = true;
        quiet(true);
      }
    }
    if (turnT >= 0) {
      turnT += dt;
      const { out, hold, back, angle } = HEAD_TURN;
      if (turnT < out) headAngle = angle * smooth(turnT / out);
      else if (turnT < out + hold) headAngle = angle;
      else if (turnT < out + hold + back) headAngle = angle * (1 - smooth((turnT - out - hold) / back));
      else headAngle = 0;
      if (thatsMeAt < 0 && turnT >= out + hold + back + 0.35) {
        thatsMeAt = beatT;
        mirrorStats.thatsMe = true;
        say(lineSpeaker('dialogue.return.mirror', 'Pierce Hawkes'), lineText('dialogue.return.mirror', "That's me. I'm not seeing things."), lineAudio('dialogue.return.mirror', THATS_ME), 0.92, 3.4);
      }
    }
    if (thatsMeAt >= 0 && beatT > thatsMeAt + 3.1 && !mirrorDone) {
      mirrorDone = true;
      quiet(false);
      headAngle = 0;
      showDouble(false);
      host.releaseCamera();
      phase = 'walk';
      clock = 0;
      radioSaid = 0;
      lineUntil = 0;
      queued = [
        { at: 1.2, id: 'dialogue.desk.accept', url: ACCEPT, hold: 5.5 },
        { at: 7.4, id: 'dialogue.desk.nature', url: NATURE, hold: 5.4 },
      ];
      host.setObjective(lineSpeaker('objective.desk.desk', 'Desk'), lineText('objective.desk.desk', 'Your desk. The work is still on it.'), { x: DESK_NEAR.x, y: 1.2, z: 42.1 });
      host.showObjective(true);
    }
  };

  let queued: { at: number; id: string; url: string; hold: number }[] = [];

  const stepQueue = () => {
    const next = queued[0];
    if (next && clock >= next.at && (lineUntil === 0 || clock > lineUntil)) {
      queued.shift();
      say(lineSpeaker(next.id, 'Pierce Hawkes'), lineText(next.id), lineAudio(next.id, next.url), 0.92, next.hold);
      return true;
    }
    return false;
  };

  const stepWalk = (here: { x: number; z: number }) => {
    if (!stepQueue() && radioSaid < RADIO_AT.length && clock >= RADIO_AT[radioSaid] && queued.length === 0 && (lineUntil === 0 || clock > lineUntil)) {
      const said = placeLine(DESK_RADIO[radioSaid]);
      radioSaid += 1;
      if (said) say(said.speaker, said.text, said.url, 0.5, 4.2);
    }
    if (Math.hypot(here.x - DESK_NEAR.x, here.z - DESK_NEAR.z) < DESK_NEAR.r && queued.length === 0 && (lineUntil === 0 || clock > lineUntil - 1)) {
      phase = 'arrive';
      arriveT = 0;
      host.fade(1, 0.35);
      host.showObjective(false);
      host.clearMarker();
      host.holdScene(true);
      host.clearInput();
      host.setWalk(false);
      host.showLine('', '');
    }
  };

  const sweepAll = () => {
    skipped = true;
    sweptAt = sweptAt < 0 ? clock : sweptAt;
    deskStats.swept = true;
    props.forEach((prop, index) => {
      if (prop.state === 'fall' || prop.state === 'floor') return;
      const side = (index - props.length / 2) * 0.35;
      prop.v.set(side, 0, -2.6 - index * 0.12);
      prop.spin = (index % 2 === 0 ? 1 : -1) * (3 + index * 0.4);
      prop.state = 'slide';
      prop.need = 0;
    });
    heard('paper-slide', DESK_SFX.slide, 0.5, nextRate());
  };

  const stepSweep = (dt: number) => {
    sweepT += dt;
    host.frameCamera({ x: SHOT.cx, y: SHOT.cy, z: SHOT.cz }, { x: SHOT.lx, y: SHOT.ly, z: SHOT.lz });
    stepProps(dt);
    deskStats.off = countOff();
    // The hand: until the first push, it sweeps across the papers on its own, and comes back if he stops.
    const lonely = !drag.down && clock - idleSince > (sweptAt < 0 ? 1.4 : 5);
    if (hand && phase === 'sweep' && !drag.down) {
      const show = lonely && countOff() < props.filter((p) => p.kind === 'paper').length;
      hand.setEnabled(show);
      if (show) {
        deskStats.hint = Math.max(deskStats.hint, 1);
        const wave = (clock - idleSince) * 1.9;
        const t = (Math.sin(wave) + 1) / 2;
        hand.position.set(lerp(desk.minX + 0.2, desk.maxX - 0.2, t), desk.top + 0.07, 42.55 + Math.sin(wave * 0.5) * 0.04);
        hand.rotation.y = Math.cos(wave) > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
    }
    const papers = props.filter((p) => p.kind === 'paper');
    const cleared = papers.every((p) => p.state === 'floor');
    if (cleared && goingAt < 0) {
      goingAt = clock + 1.0;
    }
    if (goingAt >= 0 && clock >= goingAt && phase === 'sweep') {
      phase = 'going';
      hand?.setEnabled(false);
      drag.down = false;
      say(lineSpeaker('dialogue.desk.going', 'Pierce Hawkes'), lineText('dialogue.desk.going'), lineAudio('dialogue.desk.going', GOING), 0.92, 4.4);
      goingAt = clock + 4.6;
    }
  };

  return {
    objectiveKey: () => 'desk',
    /** The desk's scripted stretch (arrive, sweep, going): letterbox, Skip, HUD away. The mirror is played, not shown. */
    playing: () => active && !finished && (phase === 'arrive' || phase === 'sweep' || phase === 'going'),
    /** No walk-up prompt: the mirror and the desk answer to where he stands and what he does with his hand. */
    action: () => null as string | null,
    confirm: () => false,
    shake: () => shake,
    skip: () => {
      if (!active || finished) return;
      if (phase === 'sweep') {
        sweepAll();
        return;
      }
      if (phase === 'going' || phase === 'arrive') finish();
    },
    stats: () => ({
      phase,
      level: 'the-desk',
      mirror: { ...mirrorStats },
      desk: {
        swept: deskStats.swept,
        drags: deskStats.drags,
        dragPx: Math.round(deskStats.dragPx),
        peakSpeed: Math.round(deskStats.peakSpeed * 10) / 10,
        off: deskStats.off,
        total: deskStats.total,
        offAfterDrag: [...deskStats.offAfterDrag],
        sounds: [...deskStats.sounds],
        terminalOff: deskStats.terminalOff,
        hintShown: deskStats.hint > 0,
        skipped,
      },
    }),
    dispose: () => {
      active = false;
      prepared = false;
      detach();
      quiet(false);
      clearMirror();
      disposeWork();
    },
    /**
     * Build the mirror (render target, materials), the reflection's body and the desk papers while the level loads,
     * so their shaders compile under the chapter card and Start opens on nothing new. `onStart` keeps them.
     */
    prepare: () => {
      disposeWork();
      mountMirror();
      spawnWork();
      buildHand();
      prepared = true;
    },
    onStart: () => {
      if (!prepared) {
        disposeWork();
        clearMirror();
      }
      active = true;
      finished = false;
      reset();
      host.setCarry(carryItems('desk', CARRY));
      host.holdScene(false);
      host.setObjective(lineSpeaker('objective.desk.look', 'Look'), lineText('objective.desk.look', 'The hall bathroom. The mirror.'), { x: MIRROR.x + 0.8, y: 1.5, z: MIRROR.z });
      host.showObjective(true);
      host.scene.getMeshByName('Office Ammo')?.setEnabled(false);
      if (!prepared) {
        mountMirror();
        spawnWork();
        buildHand();
      }
      prepared = false;
      attach();
      host.placePierce(SPAWN.x, SPAWN.z, SPAWN.yaw);
      // playClip after resume locks the idle and blocks walk and jump.
      host.resumeLocomotion();
      clip = '';
    },
    step: (delta: number) => {
      if (!active || finished) return;
      const dt = Math.min(0.25, Math.max(0, delta));
      clock += dt;
      shake = Math.max(0, shake - dt);
      const here = host.playerXZ();
      const yaw = host.playerYaw();

      if (phase === 'approach' || phase === 'mirror') {
        const moving = lastPose ? Math.hypot(here.x - lastPose.x, here.z - lastPose.z) / Math.max(dt, 1e-3) > 0.3 : false;
        if (lastPose && phase === 'mirror') walked += Math.hypot(here.x - lastPose.x, here.z - lastPose.z);
        mirrorStats.walkedMetres = Math.round(walked * 100) / 100;
        const pose: Pose = { t: clock, x: here.x, z: here.z, yaw, moving };
        history.push(pose);
        while (history.length > 2 && history[1].t < clock - 2) history.shift();
        lastPose = pose;
        if (phase === 'approach') {
          if (here.x >= 18.15 && here.z >= 26.9 && here.z <= 29.3) engage();
        }
        if (phase === 'mirror') stepMirror(dt, here, yaw);
      }
      if (phase === 'walk') stepWalk(here);
      if (phase === 'arrive') {
        arriveT += dt;
        if (arriveT >= 0.45 && arriveT < 90) {
          arriveT = 100;
          host.placePierce(DESK.x, DESK.z, DESK.yaw);
          host.playClip('rebornidle', true);
          clip = 'idle';
          host.frameCamera({ x: SHOT.cx, y: SHOT.cy, z: SHOT.cz }, { x: SHOT.lx, y: SHOT.ly, z: SHOT.lz });
          host.fade(0, 0.6);
          say(lineSpeaker('dialogue.desk.still', 'Pierce Hawkes'), lineText('dialogue.desk.still'), lineAudio('dialogue.desk.still', STILL), 0.92, 4.8);
          phase = 'sweep';
          sweepT = 0;
          idleSince = clock;
        }
      }
      if (phase === 'sweep' || phase === 'going') {
        stepSweep(dt);
        if (lineUntil > 0 && clock > lineUntil) {
          lineUntil = 0;
          host.showLine('', '');
        }
        if (phase === 'going' && clock >= goingAt) finish();
      } else if (phase !== 'arrive' && lineUntil > 0 && clock > lineUntil) {
        lineUntil = 0;
        host.showLine('', '');
      }
      // Walk and idle for the avatar are the player's own (updatePlayer); only the scripted stretch plays a clip.
      if (phase === 'sweep' || phase === 'going') setClip('idle', false);
    },
  };
};

export type TheDesk = ReturnType<typeof createTheDesk>;
