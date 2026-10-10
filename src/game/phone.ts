import * as BABYLON from '@babylonjs/core';

import phoneCopy from '../story/phone.json';
import { createUnlockedAudio, getSharedAudioContext } from './audioUnlock';
import type { PlayerAvatar } from './playerAvatar';

type Contact = { name: string; detail: string };
type CallLine = { speaker: string; text: string; audio?: string; duration: number };
type CallScript = { contact: string; lines: CallLine[] };
type TextDef = { contact: string; text: string };

const copy = phoneCopy as {
  contacts: Record<string, Contact>;
  calls: Record<string, CallScript>;
  texts: Record<string, TextDef>;
};

export type PhoneMessage = { id: string; from: string; text: string; unread: boolean };

export type PhoneView = {
  panel: boolean;
  focused: boolean;
  raised: boolean;
  screen: boolean;
  flashlight: boolean;
  ringing: boolean;
  badge: string;
  status: string;
  contact: string;
  detail: string;
  speaker: string;
  line: string;
  clock: string;
  showAnswer: boolean;
  showEnd: boolean;
  showFlash: boolean;
  showMessages: boolean;
  messages: PhoneMessage[];
  toast: string;
};

export type Phone = {
  meshes: () => BABYLON.AbstractMesh[];
  attachTo: (avatar: PlayerAvatar | null) => void;
  isRaised: () => boolean;
  setRaised: (raised: boolean) => void;
  isScreenOpen: () => boolean;
  setScreen: (open: boolean) => void;
  flashlightOn: () => boolean;
  /** 0–1. When the beam is on and this is high, intensity dips for a few frames. The spot stays enabled. */
  setFear: (amount: number) => void;
  setFlashlight: (on: boolean) => void;
  /** While set, the beam points at this world point instead of along the camera. */
  aimBeam: (at: { x: number; y: number; z: number } | null) => void;
  locksBody: () => boolean;
  wantsCallCamera: () => boolean;
  ring: (id: string) => void;
  answer: () => void;
  end: () => void;
  pushText: (id: string) => void;
  silence: () => void;
  update: (dt: number, camera: BABYLON.Camera, feet: { x: number; y: number; z: number }) => void;
  view: () => PhoneView;
};

/** Metres out from the wrist along the fingers. The bone's +Y is that axis. */
const FINGER_REACH = 0.16;

const contactOf = (id: string): Contact => copy.contacts[id] ?? { name: id, detail: '' };

const clockOf = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const createPhone = (
  scene: BABYLON.Scene,
  options: {
    soundOn: () => boolean;
    onFinished: () => void;
    onHand: (raised: boolean) => void;
  },
): Phone => {
  const attach = new BABYLON.TransformNode('phoneAttach', scene);
  attach.setEnabled(false);

  const root = new BABYLON.TransformNode('phoneRoot', scene);
  root.parent = attach;

  const bodyMat = new BABYLON.StandardMaterial('phoneBodyMat', scene);
  bodyMat.diffuseColor = new BABYLON.Color3(0.08, 0.09, 0.1);
  bodyMat.specularColor = new BABYLON.Color3(0.18, 0.18, 0.2);
  bodyMat.specularPower = 32;

  const screenMat = new BABYLON.StandardMaterial('phoneScreenMat', scene);
  screenMat.diffuseColor = new BABYLON.Color3(0.02, 0.04, 0.05);
  screenMat.emissiveColor = new BABYLON.Color3(0.03, 0.08, 0.1);
  screenMat.specularColor = new BABYLON.Color3(0.2, 0.22, 0.24);

  const ledMat = new BABYLON.StandardMaterial('phoneLedMat', scene);
  ledMat.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.14);
  ledMat.emissiveColor = new BABYLON.Color3(0, 0, 0);
  ledMat.specularColor = BABYLON.Color3.Black();

  const body = BABYLON.MeshBuilder.CreateBox('phoneBody', { width: 0.072, height: 0.146, depth: 0.009 }, scene);
  body.parent = root;
  body.material = bodyMat;
  body.isPickable = false;
  body.checkCollisions = false;

  const screen = BABYLON.MeshBuilder.CreateBox('phoneScreen', { width: 0.06, height: 0.118, depth: 0.002 }, scene);
  screen.parent = body;
  screen.position.z = 0.006;
  screen.material = screenMat;
  screen.isPickable = false;
  screen.checkCollisions = false;

  const led = BABYLON.MeshBuilder.CreateBox('phoneLed', { width: 0.012, height: 0.008, depth: 0.004 }, scene);
  led.parent = body;
  led.position.set(0, 0.07, 0.004);
  led.material = ledMat;
  led.isPickable = false;
  led.checkCollisions = false;

  const spot = new BABYLON.SpotLight(
    'phoneFlash',
    new BABYLON.Vector3(0, 0.09, 0),
    new BABYLON.Vector3(0, 1, 0),
    0.5,
    8,
    scene,
  );
  spot.diffuse = new BABYLON.Color3(1, 0.96, 0.88);
  spot.specular = new BABYLON.Color3(0.28, 0.24, 0.18);
  spot.range = 14;
  spot.intensity = 0;
  spot.falloffType = BABYLON.Light.FALLOFF_STANDARD;
  // Stay enabled at intensity 0 while the beam is off. Disabling it changes which
  // light type occupies a shader slot, and the first frame of that rebuild draws
  // with a uniform buffer that is too small (the skybox-only flash).
  spot.setEnabled(true);
  let beamLive = false;
  let beamFear = 0;
  let beamStutter = 0;

  const syncBeamSlot = (beam: boolean) => {
    if (beam === beamLive) return;
    beamLive = beam;
    spot.intensity = beam ? 30 : 0;
  };

  const applyBeam = (delta: number) => {
    if (!beamLive) {
      spot.intensity = 0;
      return;
    }
    if (beamFear > 0.58) {
      beamStutter -= delta;
      if (beamStutter <= 0 && Math.random() < 0.45) beamStutter = 0.05 + Math.random() * 0.07;
      spot.intensity = beamStutter > 0 ? 9 : 30;
      return;
    }
    beamStutter = 0;
    spot.intensity = 30;
  };

  const meshes = [body, screen, led];
  spot.excludedMeshes = meshes;
  for (const mesh of meshes) mesh.alwaysSelectAsActiveMesh = true;

  // Four lights per material. The scene list is creation order, so the office was
  // shaded by the elevator and the start of the hall, and the office practical never
  // got a slot. Rank per mesh: fill, sun, then the nearest practicals. The spot stays
  // in the last slot from the first compile, so toggling it does not rebuild shaders
  // or knock the room lights out.
  const LIGHT_SLOTS = 4;
  const lightScratch: BABYLON.Light[] = [];
  const lightChosen: BABYLON.Light[] = [];
  let seenMeshes = -1;
  let seenLights = -1;
  const lightRank = (light: BABYLON.Light, origin: BABYLON.Vector3) => {
    if (light instanceof BABYLON.HemisphericLight) return 0;
    if (light instanceof BABYLON.DirectionalLight) return 1;
    return 2 + BABYLON.Vector3.Distance(light.getAbsolutePosition(), origin);
  };
  const sameLights = (current: BABYLON.Light[], next: BABYLON.Light[]) => {
    if (current.length !== next.length) return false;
    for (let i = 0; i < next.length; i++) if (current[i] !== next[i]) return false;
    return true;
  };
  const applyLightLists = () => {
    for (const mesh of scene.meshes) {
      lightScratch.length = 0;
      for (const light of scene.lights) {
        if (light === spot || !light.isEnabled() || !light.canAffectMesh(mesh)) continue;
        lightScratch.push(light);
      }
      const origin = mesh.getAbsolutePosition();
      lightScratch.sort((a, b) => lightRank(a, origin) - lightRank(b, origin));
      const includeSpot = spot.canAffectMesh(mesh);
      const roomSlots = includeSpot ? LIGHT_SLOTS - 1 : LIGHT_SLOTS;
      lightChosen.length = 0;
      for (let i = 0; i < lightScratch.length && lightChosen.length < roomSlots; i++) {
        lightChosen.push(lightScratch[i]);
      }
      if (includeSpot) lightChosen.push(spot);
      if (sameLights(mesh.lightSources, lightChosen)) continue;
      const sources = mesh.lightSources;
      sources.length = 0;
      for (const light of lightChosen) sources.push(light);
      mesh._markSubMeshesAsLightDirty();
    }
  };
  scene.onBeforeRenderObservable.add(() => {
    if (scene.meshes.length === seenMeshes && scene.lights.length === seenLights) return;
    seenMeshes = scene.meshes.length;
    seenLights = scene.lights.length;
    applyLightLists();
  });
  let disposed = false;
  let boundAvatar: PlayerAvatar | null = null;
  let handBone: BABYLON.Bone | null = null;
  let handMesh: BABYLON.AbstractMesh | null = null;
  const bonePos = new BABYLON.Vector3();
  const finger = new BABYLON.Vector3();
  const axisX = new BABYLON.Vector3();
  const axisZ = new BABYLON.Vector3();
  const boneWorld = new BABYLON.Matrix();
  attach.rotationQuaternion = new BABYLON.Quaternion();

  const poseHand = () => {
    if (disposed || !handBone || !handMesh || !attach.rotationQuaternion) return;
    // Parenting to the bone inherits a 0.01 scale and turns the slab into a wedge.
    // The joint quaternion drops the bone's mirrored Y, which aims the beam backward.
    // Take the bone's world axes, with scale removed and the mirror kept.
    handBone.getSkeleton().prepare(true);
    handMesh.computeWorldMatrix(true);
    handBone.getFinalMatrix().multiplyToRef(handMesh.getWorldMatrix(), boneWorld);
    axisX.set(boneWorld.m[0], boneWorld.m[1], boneWorld.m[2]).normalize();
    finger.set(boneWorld.m[4], boneWorld.m[5], boneWorld.m[6]).normalize();
    axisZ.set(boneWorld.m[8], boneWorld.m[9], boneWorld.m[10]).normalize();
    BABYLON.Quaternion.RotationQuaternionFromAxisToRef(axisX, finger, axisZ, attach.rotationQuaternion);
    bonePos.set(boneWorld.m[12], boneWorld.m[13], boneWorld.m[14]);
    attach.parent = null;
    const mirrored = BABYLON.Vector3.Dot(axisX, BABYLON.Vector3.Cross(finger, axisZ)) < 0;
    attach.scaling.set(1, mirrored ? -1 : 1, 1);
    attach.position.copyFrom(bonePos).addInPlace(finger.scale(FINGER_REACH));
    spot.position.copyFrom(bonePos).addInPlace(finger.scale(FINGER_REACH + 0.05));
    spot.direction.copyFrom(finger);
    applyBeam(scene.getEngine().getDeltaTime() / 1000);
  };
  scene.onBeforeRenderObservable.add(poseHand);
  let raised = false;
  let uiOpen = false;
  let flashlight = false;
  let beamAim: BABYLON.Vector3 | null = null;
  let mode: 'idle' | 'incoming' | 'active' | 'ended' = 'idle';
  let script: CallScript | null = null;
  let scriptId = '';
  let lineIndex = 0;
  let lineText = '';
  let speakerId = '';
  let elapsed = 0;
  let gap = 0;
  let lineToken = 0;
  let voice: HTMLAudioElement | null = null;
  let nextRing = 0;
  let toast = '';
  let toastLeft = 0;
  let endLeft = 0;
  const inbox: PhoneMessage[] = [];

  const bindHand = (avatar: PlayerAvatar) => {
    if (disposed) return;
    try {
      attach.detachFromBone();
    } catch {
      /* not on a bone yet */
    }
    attach.parent = null;
    attach.scaling.setAll(1);
    attach.setEnabled(true);
    handBone = avatar.findBone('righthand');
    handMesh = avatar.getSkinnedMesh();
    if (!handBone) {
      const joint = avatar.findJoint('righthand');
      attach.parent = joint ?? avatar.group;
      attach.position.set(0.16, 1.15, 0.28);
    }
    poseHand();
    syncMesh();
  };

  const syncMesh = () => {
    const show = raised && mode === 'idle' && !disposed;
    // Hide the slab only. The attach node stays on so the spot is not switched off with it.
    root.setEnabled(show);
    for (const mesh of meshes) mesh.isVisible = show;
    screenMat.emissiveColor = show
      ? new BABYLON.Color3(0.25, 0.42, 0.48)
      : new BABYLON.Color3(0, 0, 0);
    ledMat.emissiveColor = flashlight && show
      ? new BABYLON.Color3(1, 0.92, 0.65)
      : new BABYLON.Color3(0, 0, 0);
    syncBeamSlot(flashlight && show);
  };

  const chirp = (frequency: number, duration: number, type: OscillatorType, volume: number) => {
    if (!options.soundOn()) return;
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  };

  const stopVoice = () => {
    lineToken += 1;
    gap = 0;
    if (!voice) return;
    voice.pause();
    voice.src = '';
    voice = null;
  };

  const playLine = () => {
    const line = script?.lines[lineIndex];
    if (!script || !line) {
      beginEnded();
      return;
    }
    speakerId = line.speaker;
    lineText = line.text;
    const token = ++lineToken;
    gap = 0;
    if (line.audio && options.soundOn()) {
      const clip = createUnlockedAudio(line.audio);
      voice = clip;
      clip.volume = 0.92;
      const advance = () => {
        if (token !== lineToken) return;
        gap = 0.4;
      };
      clip.addEventListener('ended', advance);
      clip.addEventListener('error', () => {
        if (token !== lineToken) return;
        gap = line.duration;
      });
      void clip.play().catch(() => {
        if (token !== lineToken) return;
        gap = line.duration;
      });
    } else {
      gap = line.duration;
    }
  };

  const beginEnded = () => {
    stopVoice();
    mode = 'ended';
    lineText = '';
    speakerId = '';
    endLeft = 1.5;
    chirp(520, 0.12, 'sine', 0.05);
    window.setTimeout(() => chirp(340, 0.16, 'sine', 0.04), 140);
    syncMesh();
  };

  const finish = () => {
    mode = 'idle';
    script = null;
    scriptId = '';
    lineText = '';
    speakerId = '';
    elapsed = 0;
    endLeft = 0;
    syncMesh();
    options.onFinished();
  };

  const openScreen = () => {
    uiOpen = true;
    for (const message of inbox) message.unread = false;
  };

  const setScreen = (open: boolean) => {
    if (mode !== 'idle') return;
    if (open) {
      openScreen();
      if (!raised) {
        raised = true;
        syncMesh();
        options.onHand(true);
        return;
      }
      syncMesh();
      return;
    }
    uiOpen = false;
    syncMesh();
  };

  const setRaised = (next: boolean) => {
    if (mode !== 'idle') return;
    if (!next) {
      const wasOut = raised;
      raised = false;
      uiOpen = false;
      flashlight = false;
      syncMesh();
      if (wasOut) options.onHand(false);
      return;
    }
    if (raised) return;
    raised = true;
    syncMesh();
    options.onHand(true);
  };

  return {
    meshes: () => meshes,
    attachTo: (avatar) => {
      try {
        attach.detachFromBone();
      } catch {
        /* not on a bone yet */
      }
      attach.parent = null;
      boundAvatar = avatar;
      if (!avatar) return;
      avatar.whenReady(() => {
        if (boundAvatar !== avatar || disposed) return;
        bindHand(avatar);
      });
    },
    isRaised: () => raised,
    setRaised,
    isScreenOpen: () => uiOpen && mode === 'idle',
    setScreen,
    flashlightOn: () => flashlight,
    setFear: (amount: number) => {
      beamFear = Math.max(0, Math.min(1, amount));
    },
    setFlashlight: (on: boolean) => {
      if (!on) {
        flashlight = false;
        syncMesh();
        return;
      }
      if (!raised || mode !== 'idle') return;
      flashlight = true;
      chirp(210, 0.04, 'square', 0.03);
      syncMesh();
    },
    aimBeam: (at: { x: number; y: number; z: number } | null) => {
      if (!at) {
        beamAim = null;
        return;
      }
      if (!beamAim) beamAim = new BABYLON.Vector3();
      beamAim.set(at.x, at.y, at.z);
    },
    locksBody: () => mode === 'incoming' || mode === 'active' || mode === 'ended',
    wantsCallCamera: () => mode === 'active' || mode === 'ended',
    ring: (id: string) => {
      const next = copy.calls[id];
      if (!next || mode !== 'idle') return;
      script = next;
      scriptId = id;
      lineIndex = 0;
      lineText = '';
      speakerId = '';
      elapsed = 0;
      mode = 'incoming';
      raised = false;
      uiOpen = false;
      flashlight = false;
      nextRing = 0.15;
      syncMesh();
      options.onHand(false);
    },
    answer: () => {
      if (mode !== 'incoming' || !script) return;
      mode = 'active';
      elapsed = 0;
      lineIndex = 0;
      nextRing = 0;
      playLine();
    },
    end: () => {
      if (mode !== 'active' && mode !== 'incoming') return;
      if (mode === 'incoming') {
        mode = 'idle';
        script = null;
        scriptId = '';
        stopVoice();
        syncMesh();
        options.onFinished();
        return;
      }
      beginEnded();
    },
    pushText: (id: string) => {
      const text = copy.texts[id];
      if (!text) return;
      if (inbox.some((message) => message.id === id)) return;
      const from = contactOf(text.contact).name;
      inbox.unshift({ id, from, text: text.text, unread: !(uiOpen && mode === 'idle') });
      toast = `${from}  ·  ${text.text}`;
      toastLeft = 4.2;
      chirp(740, 0.09, 'sine', 0.05);
    },
    silence: () => {
      stopVoice();
      mode = 'idle';
      script = null;
      scriptId = '';
      raised = false;
      uiOpen = false;
      flashlight = false;
      lineText = '';
      toast = '';
      toastLeft = 0;
      endLeft = 0;
      syncMesh();
      syncBeamSlot(false);
    },
    update: (dt, camera, feet) => {
      if (mode === 'incoming') {
        nextRing -= dt;
        if (nextRing <= 0) {
          chirp(880, 0.09, 'sine', 0.06);
          window.setTimeout(() => chirp(660, 0.1, 'sine', 0.05), 160);
          nextRing = 2.7;
        }
      }
      if (mode === 'active') {
        elapsed += dt;
        if (gap > 0) {
          gap -= dt;
          if (gap <= 0) {
            gap = 0;
            lineIndex += 1;
            playLine();
          }
        }
      }
      if (mode === 'ended') {
        endLeft -= dt;
        if (endLeft <= 0) finish();
      }
      if (toastLeft > 0) {
        toastLeft -= dt;
        if (toastLeft <= 0) toast = '';
      }

      syncBeamSlot(flashlight && raised && mode === 'idle');
    },
    view: () => {
      const who = script ? contactOf(script.contact) : null;
      const talking = speakerId ? contactOf(speakerId) : null;
      const unread = inbox.filter((message) => message.unread).length;
      const panel = mode !== 'idle' || uiOpen;
      return {
        panel,
        focused: mode === 'active' || mode === 'ended',
        raised,
        screen: uiOpen && mode === 'idle',
        flashlight,
        ringing: mode === 'incoming',
        badge: unread > 0 ? String(unread) : '',
        status: mode === 'incoming'
          ? 'Incoming'
          : mode === 'active'
            ? 'Connected'
            : mode === 'ended'
              ? 'Call ended'
              : 'Phone',
        contact: who?.name ?? '',
        detail: who?.detail ?? (uiOpen && mode === 'idle' ? (flashlight ? 'F hides the screen' : 'G turns the light') : ''),
        speaker: talking?.name ?? '',
        line: lineText,
        clock: mode === 'active' || mode === 'ended' ? clockOf(elapsed) : '',
        showAnswer: mode === 'incoming',
        showEnd: mode === 'active',
        showFlash: uiOpen && mode === 'idle',
        showMessages: uiOpen && mode === 'idle',
        messages: inbox.map((message) => ({ ...message })),
        toast,
      };
    },
  };
};
