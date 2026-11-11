import * as BABYLON from '@babylonjs/core';

import { createCharacterAvatar, type PlayerAvatar } from '../game/playerAvatar';
import { PLAYER_MESH_Y_OFFSET, PLAYER_STAND_Y } from '../game/player';
import { lineAudio, lineText, storyLine } from '../game/locale';
import { barkFresh, barkSpoken, placeLine } from './placeVoices';
import { lifeStats } from '../game/lifeStats';
import type { ImpairState } from './act1';

/**
 * Board plot told through the Apex Peak hallway itself (story through play): a late associate at a desk,
 * a locked side door marked IN SESSION, and a visible silhouette of Hale on her feet through the boardroom
 * doorway that makes Pierce flinch — none of it needs the Voss call.
 * Level 1 only (`apex-peak`).
 */

export type ApexBoardHallHost = {
  scene: BABYLON.Scene;
  isApex: () => boolean;
  playerXZ: () => { x: number; z: number };
  running: () => boolean;
  inCutscene: () => boolean;
  playFile: (url: string, volume: number) => void;
  showLine: (title: string, text: string) => void;
  impair: (next: ImpairState | null) => void;
};

const DESK_ASSET = 'asset-ch08-npc';
const DESK_LINE = 'bark.apex.desk01';
/** Until Gen lands desk01, the associate points Pierce at the board with this voiced line. */
const DESK_FALLBACK = 'bark.apex.03';
const THREAT_LINE = 'bark.apex.threat01';
/** Pre-flinch board presence from mid-hall (already voiced). */
const BOARD_MURMUR = 'bark.apex.01';
const DESK = { x: -1.45, z: 16.6, yaw: -Math.PI / 2 };
const DOOR = { x: 2.05, z: 22.0, r: 1.15 };
const THREAT = { x: 46.8, z: 32.0, seeX: 28.5, seeR: 5.5, murmurX: 18.0 };

const SFX = {
  locked: '/assets/audio/sfx/apex/door-locked.ogg',
  rattle: '/assets/audio/sfx/home/door-open.ogg',
  paper: '/assets/audio/sfx/apex/screen-tap.ogg',
  dip: '/assets/audio/sfx/apex/troffer-flicker.ogg',
} as const;

const emit = (type: string, detail: unknown) => {
  try {
    (window as unknown as { __phEmit?: (t: string, d?: unknown) => void }).__phEmit?.(type, detail);
  } catch { /* playtest not installed */ }
};

const voiced = (id: string) => {
  const row = storyLine(id);
  return Boolean(row?.audioText && lineAudio(id));
};

export const createApexBoardHall = (host: ApexBoardHallHost) => {
  let active = false;
  const own: BABYLON.Node[] = [];
  let deskMesh: BABYLON.Mesh | null = null;
  let deskAvatar: PlayerAvatar | null = null;
  let deskSaid = false;
  let deskGlance = 0;
  let doorTried = false;
  let doorShake = 0;
  let doorLeaf: BABYLON.Mesh | null = null;
  let sessionLed: BABYLON.StandardMaterial | null = null;
  let threatMesh: BABYLON.Mesh | null = null;
  let threatSeen = false;
  let threatLeft = 0;
  let murmurSaid = false;
  let lineLeft = 0;
  let typePulse = 0;
  let clock = 0;
  let platePulse = 0;

  const mat = (name: string, color: [number, number, number], emissive = 0) => {
    const m = new BABYLON.StandardMaterial(name, host.scene);
    m.diffuseColor = new BABYLON.Color3(...color);
    m.emissiveColor = new BABYLON.Color3(color[0] * emissive, color[1] * emissive, color[2] * emissive);
    m.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);
    return m;
  };

  const box = (
    name: string,
    size: [number, number, number],
    at: [number, number, number],
    material: BABYLON.Material,
    parent?: BABYLON.Node,
  ) => {
    const m = BABYLON.MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, host.scene);
    m.position.set(...at);
    m.material = material;
    m.isPickable = false;
    m.checkCollisions = false;
    if (parent) m.parent = parent;
    own.push(m);
    return m;
  };

  const buildDesk = () => {
    const wood = mat('apex-hall-desk-wood', [0.22, 0.17, 0.12]);
    const metal = mat('apex-hall-desk-metal', [0.45, 0.46, 0.48]);
    const paper = mat('apex-hall-desk-paper', [0.9, 0.88, 0.8]);
    const lamp = mat('apex-hall-desk-lamp', [0.95, 0.85, 0.55], 0.7);
    const root = new BABYLON.TransformNode('apex-hall-desk', host.scene);
    root.position.set(DESK.x, 0, DESK.z);
    root.rotation.y = DESK.yaw + Math.PI;
    own.push(root);
    box('apex-hall-desk-top', [1.05, 0.04, 0.58], [0, 0.74, 0], wood, root);
    box('apex-hall-desk-leg-l', [0.06, 0.72, 0.06], [-0.42, 0.36, -0.22], metal, root);
    box('apex-hall-desk-leg-r', [0.06, 0.72, 0.06], [0.42, 0.36, 0.22], metal, root);
    box('apex-hall-desk-papers', [0.28, 0.01, 0.22], [0.18, 0.77, 0.05], paper, root);
    box('apex-hall-desk-lamp', [0.08, 0.22, 0.08], [-0.32, 0.87, -0.12], lamp, root);
    // Warm pool so the desk reads from the far end of the hall.
    const light = new BABYLON.PointLight('apex-hall-desk-light', new BABYLON.Vector3(DESK.x + 0.2, 1.15, DESK.z), host.scene);
    light.intensity = 0.55;
    light.range = 3.2;
    light.diffuse = new BABYLON.Color3(1, 0.85, 0.55);
    own.push(light);

    const mesh = BABYLON.MeshBuilder.CreateCapsule('apex-hall-desk-person', { radius: 0.34, height: 1.5 }, host.scene);
    mesh.position.set(DESK.x + 0.55, PLAYER_STAND_Y, DESK.z);
    mesh.visibility = 0;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.rotation.y = DESK.yaw + Math.PI;
    own.push(mesh);
    const avatar = createCharacterAvatar(host.scene, 'apex-hall-desk', DESK_ASSET);
    avatar.group.parent = mesh;
    avatar.group.position.y = -PLAYER_MESH_Y_OFFSET + 0.42;
    avatar.whenReady(() => {
      if (!deskAvatar) return;
      avatar.playClip('sit', true);
    });
    deskMesh = mesh;
    deskAvatar = avatar;
    lifeStats.person('apex-desk', 'apex', 'at-desk');
    lifeStats.mark();
  };

  const buildLockedDoor = () => {
    const paint = mat('apex-locked-door-paint', [0.18, 0.16, 0.14]);
    const handle = mat('apex-locked-door-handle', [0.7, 0.62, 0.35], 0.15);
    const leaf = box('apex-locked-door-leaf', [0.08, 2.05, 0.92], [DOOR.x, 1.05, DOOR.z], paint);
    box('apex-locked-door-handle', [0.04, 0.02, 0.12], [DOOR.x - 0.06, 1.05, DOOR.z + 0.28], handle);
    doorLeaf = leaf;

    // Plate faces into the hall (−X). Readable side of a plane is −Z before rotation.
    const tex = new BABYLON.DynamicTexture('apex-session-tex', { width: 512, height: 128 }, host.scene, false);
    tex.hasAlpha = false;
    const ctx = tex.getContext();
    const w = tex.getSize().width;
    const h = tex.getSize().height;
    ctx.fillStyle = '#1a1010';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c03028';
    ctx.fillRect(0, 0, 14, h);
    const draw = ctx as CanvasRenderingContext2D;
    draw.fillStyle = '#f2e8e4';
    draw.font = '700 52px Consolas, "Courier New", monospace';
    draw.textAlign = 'center';
    draw.textBaseline = 'middle';
    draw.fillText('IN SESSION', w / 2 + 8, h / 2);
    tex.update();
    const plateMat = new BABYLON.StandardMaterial('apex-session-mat', host.scene);
    plateMat.diffuseTexture = tex;
    plateMat.emissiveTexture = tex;
    plateMat.emissiveColor = new BABYLON.Color3(0.55, 0.18, 0.12);
    plateMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    plateMat.backFaceCulling = true;
    plateMat.disableLighting = true;
    sessionLed = plateMat;
    const plate = BABYLON.MeshBuilder.CreatePlane('apex-session-plate', { width: 0.55, height: 0.14 }, host.scene);
    plate.position.set(DOOR.x - 0.05, 2.05, DOOR.z);
    plate.rotation.y = -Math.PI / 2;
    plate.material = plateMat;
    plate.isPickable = false;
    plate.checkCollisions = false;
    own.push(plate);
    lifeStats.mark();
  };

  const buildThreat = () => {
    // Always a darkened silhouette — never a second ch37 next to seated Hale on chair-n-2.
    const body = mat('apex-threat-body', [0.04, 0.04, 0.05], 0.08);
    const root = new BABYLON.TransformNode('apex-threat-sil', host.scene);
    root.position.set(THREAT.x, 0, THREAT.z);
    own.push(root);
    const torso = box('apex-threat-torso', [0.42, 0.7, 0.28], [0, 1.15, 0], body, root);
    box('apex-threat-head', [0.22, 0.26, 0.22], [0, 1.68, 0], body, root);
    const arm = box('apex-threat-arm', [0.12, 0.55, 0.12], [0.32, 1.35, 0.05], body, root);
    threatMesh = torso;
    // Arm gesture reads as "on her feet" from the hall doorway.
    arm.rotation.z = -0.55;
    lifeStats.person('apex-threat', 'apex', 'hale-standing');
  };

  const near = (x: number, z: number, r: number) => {
    const here = host.playerXZ();
    return Math.hypot(here.x - x, here.z - z) <= r;
  };

  const say = (id: string, volume: number, fallback?: string) => {
    const candidates = [id, fallback].filter((x): x is string => Boolean(x && voiced(x) && barkFresh(x)));
    const pick = candidates[0];
    if (!pick) return false;
    const said = placeLine(pick);
    if (!said) return false;
    barkSpoken(pick);
    host.showLine(said.speaker, said.text);
    host.playFile(said.url, volume);
    lineLeft = 3.4;
    lifeStats.bark('apex', pick, pick);
    return true;
  };

  const tryDoor = () => {
    if (!active || doorTried) return false;
    if (!near(DOOR.x - 0.8, DOOR.z, DOOR.r)) return false;
    doorTried = true;
    doorShake = 0.55;
    host.playFile(SFX.rattle, 0.42);
    host.playFile(SFX.locked, 0.55);
    lifeStats.touch('apex', 'locked-door', 'door rattles, lock holds', SFX.locked);
    lifeStats.mark();
    emit('board-door', JSON.stringify({ locked: true, x: DOOR.x, z: DOOR.z }));
    if (sessionLed) {
      sessionLed.emissiveColor = new BABYLON.Color3(1.0, 0.35, 0.2);
    }
    return true;
  };

  const fireThreat = () => {
    if (threatSeen) return;
    threatSeen = true;
    threatLeft = 1.05;
    host.impair({
      lag: 0.05,
      drift: 0.08,
      speed: 0.42,
      locked: false,
      pull: { x: -0.35, z: 0 },
      maxX: 99,
    });
    host.playFile(SFX.dip, 0.38);
    // Prefer Pierce's own line; until Gen lands it the flinch is still the beat (no text-only filler).
    say(THREAT_LINE, 0.9);
    lifeStats.mark();
    lifeStats.glance('apex', 'hale-standing');
    emit('board-threat', JSON.stringify({
      x: Math.round(host.playerXZ().x * 10) / 10,
      z: Math.round(host.playerXZ().z * 10) / 10,
      silhouette: Boolean(threatMesh),
    }));
  };

  const mount = () => {
    dispose();
    if (!host.isApex()) return;
    active = true;
    clock = 0;
    deskSaid = false;
    deskGlance = 0;
    doorTried = false;
    doorShake = 0;
    threatSeen = false;
    threatLeft = 0;
    murmurSaid = false;
    lineLeft = 0;
    typePulse = 0;
    platePulse = 0;
    buildDesk();
    buildLockedDoor();
    buildThreat();
    emit('board-hall', JSON.stringify({ desk: true, door: true, threat: true }));
  };

  const dispose = () => {
    active = false;
    if (deskAvatar) {
      lifeStats.forget('apex-desk');
      deskAvatar.dispose();
      deskAvatar = null;
    }
    lifeStats.forget('apex-threat');
    for (const node of own) {
      if (!node.isDisposed?.()) node.dispose(false, false);
    }
    own.length = 0;
    deskMesh = null;
    doorLeaf = null;
    sessionLed = null;
    threatMesh = null;
    if (threatLeft > 0) host.impair(null);
    threatLeft = 0;
  };

  return {
    mount,
    dispose,
    ready: () => (deskAvatar
      ? new Promise<void>((resolve) => deskAvatar!.whenReady(resolve))
      : Promise.resolve()),
    blips: () => {
      const out: { x: number; z: number; kind: string }[] = [];
      if (deskMesh) out.push({ x: deskMesh.position.x, z: deskMesh.position.z, kind: 'desk' });
      out.push({ x: DOOR.x - 0.8, z: DOOR.z, kind: 'locked-door' });
      if (threatMesh) out.push({ x: THREAT.x, z: THREAT.z, kind: 'threat' });
      return out;
    },
    snapshot: () => ({
      deskSeen: deskSaid,
      doorTried,
      threatSeen,
      deskAt: { x: DESK.x, z: DESK.z },
      doorAt: { x: DOOR.x - 0.8, z: DOOR.z, r: DOOR.r },
      threatAt: { x: THREAT.seeX, z: THREAT.z, r: THREAT.seeR },
    }),
    action: (): string | null => {
      if (!active || !host.running() || host.inCutscene() || doorTried) return null;
      if (near(DOOR.x - 0.8, DOOR.z, DOOR.r)) return lineText('ui.action.apex.door', 'Try the door');
      return null;
    },
    confirm: (): boolean => tryDoor(),
    step: (dtRaw: number) => {
      if (!active || !host.isApex()) return;
      const dt = Math.min(0.05, Math.max(0, dtRaw));
      clock += dt;
      if (lineLeft > 0) {
        lineLeft -= dt;
        if (lineLeft <= 0) host.showLine('', '');
      }
      if (threatLeft > 0) {
        threatLeft -= dt;
        if (threatLeft <= 0) host.impair(null);
      }
      if (doorShake > 0 && doorLeaf) {
        doorShake -= dt;
        const k = Math.exp(-doorShake * 4) * Math.sin((0.55 - doorShake) * 40);
        doorLeaf.rotation.y = doorShake > 0 ? k * 0.04 : 0;
        if (doorShake <= 0 && sessionLed) {
          sessionLed.emissiveColor = new BABYLON.Color3(0.55, 0.18, 0.12);
        }
      }
      // IN SESSION plate breathes so the locked wing reads occupied before Pierce reaches it.
      if (sessionLed && doorShake <= 0) {
        platePulse += dt;
        const pulse = 0.45 + 0.25 * (0.5 + 0.5 * Math.sin(platePulse * 2.2));
        sessionLed.emissiveColor = new BABYLON.Color3(pulse, pulse * 0.32, pulse * 0.22);
      }
      if (!host.running() || host.inCutscene()) return;

      // Mid-hall: board murmur through the doors so Hale's wing feels occupied before the flinch.
      if (!murmurSaid) {
        const here = host.playerXZ();
        if (here.x >= THREAT.murmurX && Math.abs(here.z - THREAT.z) < 6) {
          murmurSaid = true;
          if (say(BOARD_MURMUR, 0.38)) {
            lifeStats.mark();
            emit('board-murmur', JSON.stringify({ line: BOARD_MURMUR }));
          }
        }
      }

      // Desk person types, glances, and tells Pierce the board started without him.
      if (deskMesh && deskAvatar) {
        typePulse += dt;
        deskAvatar.group.rotation.x = 0.12 + Math.sin(typePulse * 2.4) * 0.02;
        const here = host.playerXZ();
        const dist = Math.hypot(here.x - deskMesh.position.x, here.z - deskMesh.position.z);
        if (!deskSaid && dist < 3.8) {
          deskSaid = true;
          deskGlance = 1.6;
          host.playFile(SFX.paper, 0.28);
          lifeStats.glance('apex', 'desk');
          lifeStats.mark();
          const said = say(DESK_LINE, 0.85, DESK_FALLBACK);
          emit('board-desk', JSON.stringify({ x: DESK.x, z: DESK.z, said, line: voiced(DESK_LINE) ? DESK_LINE : DESK_FALLBACK }));
        }
        if (deskGlance > 0) {
          deskGlance -= dt;
          const want = Math.atan2(here.x - deskMesh.position.x, here.z - deskMesh.position.z);
          let d = want - DESK.yaw;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          const turn = DESK.yaw + Math.max(-0.9, Math.min(0.9, d));
          deskMesh.rotation.y = turn + Math.PI;
        } else {
          deskMesh.rotation.y = DESK.yaw + Math.PI;
        }
      }

      // Threat silhouette: Hale on her feet, visible through the board doorway.
      if (threatMesh?.parent) {
        const wave = Math.sin(clock * 1.7);
        (threatMesh.parent as BABYLON.TransformNode).rotation.y = wave * 0.25;
        (threatMesh.parent as BABYLON.TransformNode).position.z = THREAT.z + wave * 0.12;
      }

      if (!threatSeen) {
        const here = host.playerXZ();
        // Hall 2 approaches the board doorway at x 36; once Pierce is past the mid-hall he can see her.
        const inSight = here.x >= THREAT.seeX && Math.abs(here.z - THREAT.z) <= THREAT.seeR;
        if (inSight) fireThreat();
      }
    },
  };
};

export type ApexBoardHall = ReturnType<typeof createApexBoardHall>;
