import * as BABYLON from '@babylonjs/core';

import { createCharacterAvatar, type PlayerAvatar } from '../game/playerAvatar';
import { PLAYER_MESH_Y_OFFSET, PLAYER_STAND_Y } from '../game/player';
import { lineAudio, lineText, storyLine } from '../game/locale';
import { placeLine } from './placeVoices';
import { lifeStats } from '../game/lifeStats';

/**
 * Apex Peak vertical slice: hall life, optional interactions, and the cleaner beat.
 * Mounted only on level 1 (library id apex-peak). Level 4 (The Desk) leaves the cart alone.
 */

export type ApexSliceHost = {
  scene: BABYLON.Scene;
  isApex: () => boolean;
  playerXZ: () => { x: number; z: number };
  running: () => boolean;
  inCutscene: () => boolean;
  placePierce: (x: number, z: number, yaw: number) => void;
  playClip: (clip: string, loop: boolean, speed?: number) => void;
  resumeLocomotion: () => void;
  holdLocomotion: () => void;
  holdScene: (held: boolean) => void;
  showLine: (title: string, text: string) => void;
  playFile: (url: string, volume: number) => void;
  clearInput: () => void;
  /** Soft seat: raises the avatar group onto a sofa / chair (capsule stays standing). */
  seatVisual: (y: number) => void;
  standVisual: () => void;
};

const CLEANER_ASSET = 'asset-ch23-npc';
const CLEANER_LINE = 'bark.apex.cleaner';
const PAPER_LINE = 'bark.apex.papers';

const SFX = {
  sofa: '/assets/audio/sfx/apex/sofa-creak.ogg',
  cart: '/assets/audio/sfx/apex/cart-wheels.ogg',
  screen: '/assets/audio/sfx/apex/screen-tap.ogg',
  skyline: '/assets/audio/sfx/apex/skyline.ogg',
  flicker: '/assets/audio/sfx/apex/troffer-flicker.ogg',
} as const;

/** Hall 2 centerline: cleaner walks west → east once. */
const HALL2 = { z: 32, x0: 4.2, x1: 33.6, speed: 0.85, pauseAt: 18.5, pauseFor: 2.4 };
const SOFA_SIT = { duration: 4, visualY: 0.52 };
const CHART = { x: 36.0, y: 1.9, z: 27.2 };
const PAPERS = { x: 48.0, z: 42.45 };
const FLICKER_EVERY = 11;

type QuietKind = 'see' | 'hear' | 'do';

export const createApexSlice = (host: ApexSliceHost) => {
  let active = false;
  let cleaner: { mesh: BABYLON.Mesh; avatar: PlayerAvatar; cart: BABYLON.TransformNode } | null = null;
  let cleanerX = HALL2.x0;
  let cleanerSaid = false;
  let cleanerDone = false;
  let cleanerPause = 0;
  let cleanerPaused = false;
  let cartAlone: BABYLON.TransformNode | null = null;
  let cartSettleIn = 0;

  let sitLeft = 0;
  let sitFrom: { x: number; z: number; yaw: number } | null = null;
  let papersDone = false;
  let screenTap = 0;
  let chartPlane: BABYLON.Mesh | null = null;
  let chartTex: BABYLON.DynamicTexture | null = null;
  let valuation = 412;

  let flickerIn = 7;
  let flickerLeft = 0;
  let hallLights: { light: BABYLON.PointLight; base: number }[] = [];
  let ambientIn = 5;

  let lineLeft = 0;
  let cleanerVoiced = false;
  let papersVoiced = false;
  const events: { t: number; kind: QuietKind; id: string }[] = [];
  let clock = 0;
  let lastQuietMark = 0;

  /** A spoken take is current only when the catalog has audioText (Gen / Dev Tools record). */
  const voiced = (id: string) => {
    const row = storyLine(id);
    return Boolean(row?.audioText && lineAudio(id));
  };

  const mark = (kind: QuietKind, id: string) => {
    events.push({ t: clock, kind, id });
    lifeStats.mark();
    lastQuietMark = clock;
  };

  const near = (x: number, z: number, r: number) => {
    const here = host.playerXZ();
    return Math.hypot(here.x - x, here.z - z) <= r;
  };

  const sofaPose = () => {
    let node: BABYLON.TransformNode | BABYLON.AbstractMesh | null =
      host.scene.getTransformNodeByName('office-sofa');
    if (!node) {
      node = host.scene.meshes.find(
        (m) => (m.metadata as { sceneAssetId?: string } | undefined)?.sceneAssetId === 'office-sofa',
      ) ?? null;
    }
    if (!node) {
      for (const n of host.scene.transformNodes) {
        if ((n.metadata as { sceneAssetId?: string } | undefined)?.sceneAssetId === 'office-sofa') {
          node = n;
          break;
        }
      }
    }
    if (node) {
      const p = node.getAbsolutePosition();
      const face = node.rotationQuaternion
        ? node.rotationQuaternion.toEulerAngles().y
        : node.rotation.y;
      // Sit just in front of the sofa facing the same way it faces.
      const fx = Math.sin(face);
      const fz = Math.cos(face);
      return { x: p.x - fx * 0.55, z: p.z - fz * 0.55, yaw: face };
    }
    return { x: 44.6, z: 44.6, yaw: -Math.PI / 2 };
  };

  const buildCart = (parent: BABYLON.TransformNode) => {
    const wood = new BABYLON.StandardMaterial('apex-cart-wood', host.scene);
    wood.diffuseColor = new BABYLON.Color3(0.22, 0.18, 0.14);
    wood.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
    const metal = new BABYLON.StandardMaterial('apex-cart-metal', host.scene);
    metal.diffuseColor = new BABYLON.Color3(0.45, 0.46, 0.48);
    metal.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    const body = BABYLON.MeshBuilder.CreateBox('apex-cart-body', { width: 0.72, height: 0.55, depth: 0.42 }, host.scene);
    body.position.set(0, 0.42, -0.55);
    body.material = wood;
    body.parent = parent;
    body.isPickable = false;
    body.checkCollisions = false;
    const shelf = BABYLON.MeshBuilder.CreateBox('apex-cart-shelf', { width: 0.68, height: 0.03, depth: 0.38 }, host.scene);
    shelf.position.set(0, 0.7, -0.55);
    shelf.material = wood;
    shelf.parent = parent;
    shelf.isPickable = false;
    for (const [sx, sz] of [[-0.28, -0.72], [0.28, -0.72], [-0.28, -0.38], [0.28, -0.38]] as const) {
      const wheel = BABYLON.MeshBuilder.CreateCylinder(`apex-cart-wheel-${sx}-${sz}`, { diameter: 0.12, height: 0.04 }, host.scene);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx, 0.08, sz);
      wheel.material = metal;
      wheel.parent = parent;
      wheel.isPickable = false;
    }
    const mop = BABYLON.MeshBuilder.CreateCylinder('apex-cart-mop', { diameter: 0.04, height: 1.35 }, host.scene);
    mop.position.set(0.28, 1.05, -0.55);
    mop.material = metal;
    mop.parent = parent;
    mop.isPickable = false;
  };

  const spawnCleaner = () => {
    if (cleaner || cleanerDone) return;
    const mesh = BABYLON.MeshBuilder.CreateCapsule('apex-cleaner', { radius: 0.34, height: 1.5 }, host.scene);
    mesh.position.set(HALL2.x0, PLAYER_STAND_Y, HALL2.z);
    mesh.visibility = 0;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    const avatar = createCharacterAvatar(host.scene, 'apex-cleaner', CLEANER_ASSET);
    avatar.group.parent = mesh;
    avatar.group.position.y = -PLAYER_MESH_Y_OFFSET;
    const cart = new BABYLON.TransformNode('apex-cleaner-cart', host.scene);
    cart.parent = mesh;
    buildCart(cart);
    avatar.whenReady(() => {
      if (!cleaner) return;
      avatar.setLocomotion(true, true);
    });
    mesh.rotation.y = Math.PI / 2 + Math.PI;
    cleaner = { mesh, avatar, cart };
    cleanerX = HALL2.x0;
    mark('see', 'cleaner');
  };

  const disposeCleaner = () => {
    if (!cleaner) return;
    cleaner.avatar.dispose();
    if (!cleaner.mesh.isDisposed()) cleaner.mesh.dispose();
    cleaner = null;
  };

  const leaveCart = () => {
    if (cartAlone && !cartAlone.isDisposed()) return;
    const root = new BABYLON.TransformNode('apex-cart-left', host.scene);
    root.position.set(18.4, 0, 32.15);
    root.rotation.y = 0.35;
    buildCart(root);
    cartAlone = root;
    mark('see', 'cart-left');
  };

  const paintChart = () => {
    if (!chartTex) return;
    const ctx = chartTex.getContext();
    const w = chartTex.getSize().width;
    const h = chartTex.getSize().height;
    ctx.fillStyle = '#071018';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1d3346';
    for (let k = 0; k < 6; k += 1) {
      ctx.beginPath();
      ctx.moveTo(16, 28 + k * 22);
      ctx.lineTo(w - 16, 28 + k * 22);
      ctx.stroke();
    }
    ctx.strokeStyle = '#4fd1ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const pts = [170, 160, 155, 140, 128, 110, 96, 78, 70, 58];
    pts.forEach((v, i) => (i ? ctx.lineTo(20 + i * 24, v) : ctx.moveTo(20, v)));
    ctx.stroke();
    ctx.fillStyle = '#e8f4ff';
    ctx.font = 'bold 28px Arial, sans-serif';
    ctx.fillText(`VALUATION  +${valuation}%`, 18, 26);
    ctx.fillStyle = '#7fe0a0';
    ctx.font = '18px Arial, sans-serif';
    ctx.fillText('SERIES D  ·  ZURICH', 18, h - 14);
    chartTex.update();
  };

  const mountChart = () => {
    if (chartPlane && !chartPlane.isDisposed()) return;
    chartTex = new BABYLON.DynamicTexture('apex-chart-tex', { width: 512, height: 256 }, host.scene, false);
    chartTex.hasAlpha = false;
    const mat = new BABYLON.StandardMaterial('apex-chart-mat', host.scene);
    mat.diffuseTexture = chartTex;
    mat.emissiveTexture = chartTex;
    mat.emissiveColor = new BABYLON.Color3(0.55, 0.7, 0.85);
    mat.disableLighting = true;
    mat.backFaceCulling = true;
    const plane = BABYLON.MeshBuilder.CreatePlane('apex-chart-plane', { width: 2.2, height: 1.1 }, host.scene);
    // Readable side faces −Z before rotation; west wall of boardroom faces into room (+X).
    plane.position.set(CHART.x + 0.07, CHART.y, CHART.z);
    plane.rotation.y = Math.PI / 2;
    plane.material = mat;
    plane.isPickable = false;
    plane.checkCollisions = false;
    chartPlane = plane;
    paintChart();
    mark('see', 'valuation');
  };

  const collectHallLights = () => {
    hallLights = [];
    for (const light of host.scene.lights) {
      if (!(light instanceof BABYLON.PointLight)) continue;
      const id = (light.metadata as { sceneAssetId?: string } | undefined)?.sceneAssetId
        ?? light.name;
      if (!/^light-h2/.test(String(id)) && !/Hall 2 Light/i.test(light.name)) continue;
      hallLights.push({ light, base: light.intensity });
    }
  };

  const beginSit = () => {
    if (sitLeft > 0) return false;
    const pose = sofaPose();
    sitFrom = { x: pose.x, z: pose.z + 0.9, yaw: pose.yaw };
    host.clearInput();
    host.holdScene(true);
    host.placePierce(pose.x, pose.z, pose.yaw);
    host.seatVisual(SOFA_SIT.visualY);
    host.playClip('sit', true);
    host.playFile(SFX.sofa, 0.55);
    sitLeft = SOFA_SIT.duration;
    mark('do', 'sofa');
    mark('hear', 'sofa-creak');
    return true;
  };

  const endSit = () => {
    sitLeft = 0;
    host.standVisual();
    const back = sitFrom ?? sofaPose();
    host.placePierce(back.x, back.z, back.yaw);
    host.resumeLocomotion();
    host.playClip('idle', true);
    host.holdScene(false);
    host.playFile(SFX.skyline, 0.42);
    mark('hear', 'skyline');
    sitFrom = null;
  };

  const readPapers = () => {
    if (papersDone) return false;
    papersDone = true;
    // Paper rustle stand-in so the beat is heard even before the Gen take.
    host.playFile(SFX.sofa, 0.22);
    mark('hear', 'papers-rustle');
    mark('do', 'papers');
    if (voiced(PAPER_LINE)) {
      const said = placeLine(PAPER_LINE);
      if (said) {
        host.showLine(said.speaker, said.text);
        host.playFile(said.url, 0.9);
        lineLeft = 3.8;
        papersVoiced = true;
        mark('hear', 'papers');
      }
    }
    return true;
  };

  const tapScreen = () => {
    valuation = Math.max(380, valuation - (3 + Math.floor(Math.random() * 5)));
    paintChart();
    host.playFile(SFX.screen, 0.4);
    screenTap += 1;
    mark('do', 'valuation');
    mark('hear', 'screen-tap');
    mark('see', `valuation-${valuation}`);
    return true;
  };

  const stepCleaner = (dt: number) => {
    if (cleanerDone) {
      if (cartAlone && !cartAlone.isDisposed() && cartSettleIn > 0) {
        cartSettleIn -= dt;
        if (cartSettleIn <= 0) {
          host.playFile(SFX.cart, 0.2);
          mark('hear', 'cart-settle');
          mark('see', 'cart-settle');
        }
      }
      return;
    }
    if (!cleaner) return;
    if (cleanerPause > 0) {
      cleanerPause -= dt;
      cleaner.avatar.setLocomotion(false, true);
      if (cleanerPause <= 0) mark('see', 'cleaner-resume');
      return;
    }
    if (!cleanerPaused && cleanerX >= HALL2.pauseAt) {
      cleanerPaused = true;
      cleanerPause = HALL2.pauseFor;
      cleaner.avatar.setLocomotion(false, true);
      host.playFile(SFX.cart, 0.25);
      mark('see', 'cleaner-pause');
      mark('hear', 'cart-pause');
      return;
    }
    cleanerX = Math.min(HALL2.x1, cleanerX + HALL2.speed * dt);
    cleaner.mesh.position.x = cleanerX;
    cleaner.mesh.position.z = HALL2.z;
    cleaner.mesh.rotation.y = Math.PI / 2 + Math.PI;
    cleaner.avatar.setLocomotion(true, true);
    if (!cleanerSaid && near(cleanerX, HALL2.z, 4.2)) {
      cleanerSaid = true;
      host.playFile(SFX.cart, 0.35);
      mark('hear', 'cart');
      mark('do', 'cleaner-greeting');
      // Bible: voice + cart, no text-only beat. Subtitle only when a Gen take is on the line.
      if (voiced(CLEANER_LINE)) {
        const said = placeLine(CLEANER_LINE);
        if (said) {
          host.showLine(said.speaker, said.text);
          host.playFile(said.url, 0.88);
          lineLeft = 3.2;
          cleanerVoiced = true;
          mark('hear', 'cleaner');
        }
      }
    }
    if (cleanerX >= HALL2.x1 - 0.05) {
      cleanerDone = true;
      disposeCleaner();
      leaveCart();
      cartSettleIn = 9;
    }
  };

  const stepFlicker = (dt: number) => {
    if (flickerLeft > 0) {
      flickerLeft -= dt;
      const pulse = 0.35 + 0.65 * Math.abs(Math.sin(flickerLeft * 28));
      for (const entry of hallLights) entry.light.intensity = entry.base * pulse;
      if (flickerLeft <= 0) {
        for (const entry of hallLights) entry.light.intensity = entry.base;
      }
      return;
    }
    flickerIn -= dt;
    if (flickerIn > 0) return;
    flickerIn = FLICKER_EVERY + Math.random() * 6;
    if (!near(24, 32, 18)) return;
    flickerLeft = 0.45;
    host.playFile(SFX.flicker, 0.28);
    mark('hear', 'flicker');
    mark('see', 'flicker');
  };

  const mount = () => {
    dispose();
    if (!host.isApex()) return;
    active = true;
    clock = 0;
    lastQuietMark = 0;
    events.length = 0;
    cleanerSaid = false;
    cleanerDone = false;
    cleanerPaused = false;
    cleanerPause = 0;
    cleanerVoiced = false;
    papersDone = false;
    papersVoiced = false;
    cartSettleIn = 0;
    screenTap = 0;
    ambientIn = 5;
    valuation = 412;
    sitLeft = 0;
    flickerIn = 6 + Math.random() * 4;
    collectHallLights();
    mountChart();
    spawnCleaner();
    mark('hear', 'room-tone');
  };

  const dispose = () => {
    active = false;
    if (sitLeft > 0) endSit();
    disposeCleaner();
    if (cartAlone && !cartAlone.isDisposed()) {
      for (const child of cartAlone.getChildMeshes(false)) child.dispose(false, true);
      cartAlone.dispose();
    }
    cartAlone = null;
    if (chartPlane && !chartPlane.isDisposed()) chartPlane.dispose(false, true);
    chartPlane = null;
    chartTex?.dispose();
    chartTex = null;
    for (const entry of hallLights) entry.light.intensity = entry.base;
    hallLights = [];
  };

  return {
    mount,
    dispose,
    /** Resolves once the night cleaner's model has loaded (so its shaders compile under the chapter card). */
    ready: () => (cleaner ? new Promise<void>((resolve) => cleaner!.avatar.whenReady(resolve)) : Promise.resolve()),
    playing: () => active && sitLeft > 0,
    blips: () => {
      const out: { x: number; z: number; kind: string }[] = [];
      if (cleaner) out.push({ x: cleaner.mesh.position.x, z: cleaner.mesh.position.z, kind: 'cleaner' });
      if (cartAlone && !cartAlone.isDisposed()) {
        out.push({ x: cartAlone.position.x, z: cartAlone.position.z, kind: 'cart' });
      }
      return out;
    },
    /** Longest stretch with nothing new to see, hear or do (seconds). */
    maxQuietSeconds: () => {
      if (!events.length) return clock;
      let max = events[0]?.t ?? 0;
      for (let i = 1; i < events.length; i += 1) {
        max = Math.max(max, events[i].t - events[i - 1].t);
      }
      max = Math.max(max, clock - lastQuietMark);
      return Math.round(max * 10) / 10;
    },
    /**
     * Beats that showed a subtitle without a current Gen take. Subtitles are withheld until
     * audioText is set; this only counts if that guard slips.
     */
    textOnlyBeats: () => {
      let n = 0;
      if (cleanerVoiced && !voiced(CLEANER_LINE)) n += 1;
      if (papersVoiced && !voiced(PAPER_LINE)) n += 1;
      return n;
    },
    events: () => events.slice(),
    action: (): string | null => {
      if (!active || !host.running() || host.inCutscene() || sitLeft > 0) return null;
      const pose = sofaPose();
      if (near(pose.x, pose.z, 1.35)) return lineText('ui.action.apex.sit', 'Sit');
      if (!papersDone && near(PAPERS.x, PAPERS.z, 1.25)) return lineText('ui.action.apex.papers', 'Read papers');
      if (near(CHART.x + 0.6, CHART.z, 1.55)) return lineText('ui.action.apex.screen', 'Tap screen');
      return null;
    },
    confirm: (): boolean => {
      if (!active || !host.running() || host.inCutscene() || sitLeft > 0) return false;
      const pose = sofaPose();
      if (near(pose.x, pose.z, 1.35)) return beginSit();
      if (!papersDone && near(PAPERS.x, PAPERS.z, 1.25)) return readPapers();
      if (near(CHART.x + 0.6, CHART.z, 1.55)) return tapScreen();
      return false;
    },
    step: (delta: number) => {
      if (!active || !host.isApex()) return;
      const dt = Math.min(0.05, Math.max(0, delta));
      clock += dt;
      if (lineLeft > 0) {
        lineLeft -= dt;
        if (lineLeft <= 0) host.showLine('', '');
      }
      if (sitLeft > 0) {
        sitLeft -= dt;
        if (sitLeft <= 0) endSit();
        return;
      }
      if (!host.running() || host.inCutscene()) return;
      stepCleaner(dt);
      stepFlicker(dt);
      // Real ambient fill: a soft city wash or cart-adjacent click when the floor goes quiet.
      ambientIn -= dt;
      if (ambientIn <= 0 && clock - lastQuietMark > 6.5) {
        ambientIn = 8 + Math.random() * 5;
        const here = host.playerXZ();
        if (here.z > 40) {
          host.playFile(SFX.skyline, 0.22);
          mark('hear', 'skyline-ambient');
        } else if (here.x > 2 && here.x < 36 && here.z > 28 && here.z < 36) {
          host.playFile(SFX.flicker, 0.18);
          mark('hear', 'hall-hum');
        } else {
          host.playFile(SFX.screen, 0.12);
          mark('hear', 'board-hum');
        }
      }
    },
  };
};

export type ApexSlice = ReturnType<typeof createApexSlice>;
