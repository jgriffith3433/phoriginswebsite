import * as BABYLON from '@babylonjs/core';

import phoneCopy from '../story/phone.json';
import { busInput, getSharedAudioContext } from './audioUnlock';
import { mixVolume, playClip, preloadClips, type ClipHandle } from './sfxMix';
import { phoneSpeakerId, storyLine } from './locale';
import type { PlayerAvatar } from './playerAvatar';

type Contact = { name: string; detail: string };
type CallLine = { speaker: string; text: string; audio?: string; duration: number; alt?: { when: StatWhen; line: CallLine }[] };
/** A reply moment: while `after` plays, the player picks what Pierce says (keys 1-3, tap), or stays silent. */
type ReplyOption = { id: string; text: string; line: CallLine; answer: CallLine; delta: number };
type ReplyMoment = { id: string; after: number; resume: number; window: number; options: ReplyOption[]; silence: { answer: CallLine; delta: number } };
type CallScript = { contact: string; dial?: boolean; lines: CallLine[]; moments: ReplyMoment[] };
type StatKey = TrustStat | 'ledgerBand';
type StatWhen = Partial<Record<StatKey, { min?: number; max?: number }>>;
type RawLine = { line?: string; speaker?: string; text?: string; audio?: string; duration: number; alt?: { when: StatWhen; line?: string; duration?: number }[] };
type RawMoment = {
  id: string; after: number; resume?: number; options: { id: string; text: string; line: string; duration: number; answer: string; answerDuration: number; delta?: number }[];
  silence: { answer: string; duration: number; delta?: number };
};
type RawScript = { contact: string; dial?: boolean; lines: RawLine[]; replies?: RawMoment[] };
/** What the player has said to Voss and Hale, kept on the save cookie, each clamped to -2..+2. */
export type TrustStat = 'vossTrust' | 'haleTemper';
export const STAT_MIN = -2;
export const STAT_MAX = 2;
/** Answer window, shared by every call: starts when the caller's voice ends; 6 s + 0.35 s per visible option word, never under 8 s. */
export const REPLY_WINDOW_BASE = 6;
export const REPLY_WINDOW_PER_WORD = 0.35;
export const REPLY_WINDOW_MIN = 8;
export const replyWords = (texts: string[]) => texts.reduce((n, t) => n + t.trim().split(/\s+/).filter(Boolean).length, 0);
export const replyWindowSeconds = (texts: string[]) =>
  Math.max(REPLY_WINDOW_MIN, REPLY_WINDOW_BASE + REPLY_WINDOW_PER_WORD * replyWords(texts));
/** One answer window as it really ran (ms on performance.now): opened with the line, the clock started at the voice's end, closed. */
export type ReplyWindowLog = { call: string; moment: string; words: number; window: number; openedAt: number; voiceEndAt: number; closedAt: number; how: string };
const statOf = (contact: string): TrustStat => (contact === 'hale' ? 'haleTemper' : 'vossTrust');
type TextDef = { contact: string; line?: string; text?: string };

const copy = phoneCopy as {
  contacts: Record<string, Contact>;
  calls: Record<string, RawScript>;
  texts: Record<string, TextDef>;
  byObjective?: Record<string, Record<string, RawScript>>;
};

const resolveLine = (entry: { line?: string; speaker?: string; text?: string; audio?: string; duration: number }): CallLine => {
  const row = entry.line ? storyLine(entry.line) : undefined;
  const audio = row?.audio || entry.audio || '';
  return {
    speaker: phoneSpeakerId(row?.speaker || entry.speaker || ''),
    text: row?.text || entry.text || '',
    audio: audio || undefined,
    duration: entry.duration,
  };
};

const resolveScript = (raw: RawScript): CallScript => ({
  contact: raw.contact,
  dial: raw.dial,
  lines: raw.lines.map((entry) => ({
    ...resolveLine(entry),
    alt: entry.alt?.map((a) => ({ when: a.when, line: resolveLine({ line: a.line, duration: a.duration ?? entry.duration }) })),
  })),
  moments: (raw.replies ?? []).map((m) => ({
    id: m.id,
    after: m.after,
    resume: m.resume ?? m.after + 1,
    window: 0,
    options: m.options.map((o) => {
      const line = resolveLine({ line: o.line, duration: o.duration });
      return { id: o.id, text: o.text || line.text, line, answer: resolveLine({ line: o.answer, duration: o.answerDuration }), delta: o.delta ?? 0 };
    }),
    silence: { answer: resolveLine({ line: m.silence.answer, duration: m.silence.duration }), delta: m.silence.delta ?? 0 },
  })).map((m) => ({ ...m, window: replyWindowSeconds(m.options.map((o) => o.text)) })),
});

const inRange = (value: number, range?: { min?: number; max?: number }) =>
  !range || ((range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max));

const TONE = {
  dial: '/assets/audio/sfx/phone/dial.wav',
  ringback: '/assets/audio/sfx/phone/ringback.wav',
  busy: '/assets/audio/sfx/phone/busy.wav',
  hangup: '/assets/audio/sfx/phone/hangup.wav',
  ring: '/assets/audio/sfx/phone/ring.wav',
  connect: '/assets/audio/sfx/phone/connect.wav',
  light: '/assets/audio/sfx/flashlight.ogg',
  lightAway: '/assets/audio/sfx/flashlight-off.ogg',
  phoneOut: '/assets/audio/sfx/phone-out.ogg',
  phoneAway: '/assets/audio/sfx/phone-away.ogg',
};

const PICKUP_CHANCE = 1 / 3;

export type PhoneMessage = { id: string; from: string; text: string; unread: boolean };

export type PhoneView = {
  panel: boolean;
  focused: boolean;
  raised: boolean;
  screen: boolean;
  flashlight: boolean;
  ringing: boolean;
  outgoing: boolean;
  badge: string;
  status: string;
  contact: string;
  /** Caller id for the portrait ('voss' | 'hale' | 'lang' | 'unknown'; '' when no call). */
  contactId: string;
  detail: string;
  speaker: string;
  line: string;
  clock: string;
  showAnswer: boolean;
  showEnd: boolean;
  showFlash: boolean;
  showMessages: boolean;
  messages: PhoneMessage[];
  /** Reply bubbles for the moment that is open now (empty otherwise). `left` counts down from `total` seconds. */
  replies: { key: number; text: string }[];
  repliesLeft: number;
  repliesTotal: number;
  toast: string;
  app: 'home' | 'messages' | 'contacts' | 'recents';
  contacts: { id: string; name: string; detail: string }[];
  recents: { contact: string; name: string; detail: string }[];
};

export type Phone = {
  meshes: () => BABYLON.AbstractMesh[];
  /**
   * Builds every mesh's four-light list now (the per-frame pass only does it when the mesh or light count changes), so a
   * compile pass under the title card sees the lights the opening will draw with.
   */
  refreshLights: () => void;
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
  dial: (contactId: string) => void;
  pushText: (id: string) => void;
  openApp: (app: 'messages' | 'contacts' | 'recents') => void;
  back: () => void;
  silence: () => void;
  /** Picks reply `index` (0-based) of the open moment. False when none is open. */
  chooseReply: (index: number) => boolean;
  /** Every reply moment this session answered, in order: which option (or `silence`), and whether it cut the caller off. */
  /** Every answer window this session: size, when it opened, when the voice ended, when it closed. */
  replyWindows: () => ReplyWindowLog[];
  replyLog: () => { call: string; moment: string; choice: string; cutOff: boolean; delta: number; stat: TrustStat; value: number }[];
  update: (dt: number, camera: BABYLON.Camera, feet: { x: number; y: number; z: number }) => void;
  view: () => PhoneView;
};

/** Metres out from the wrist along the fingers. The bone's +Y is that axis. */
const FINGER_REACH = 0.08;
/** World height of the slab once it is seated. */
const HANDSET_HEIGHT = 0.1;
/**
 * Metres past the slab tip, along the fingers.
 * The hand extends past the slab, and the walk cycle swings the wrist into the body.
 * 0.15 left the cone in the fist on the frames where the axis failed to normalize.
 */
const BEAM_CLEAR = 0.4;
/** Bone columns are length ~0.01. A 1e-4 test treats that as "no axis" and skips normalize. */
const AXIS_EPSILON = 1e-8;

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
    onConnected?: (contactId: string) => void;
    /** A scripted call ended: played to its last line (`read`), hung up early (`skipped`) or not answered (`declined`). */
    onCallEnded?: (callId: string, how: 'read' | 'skipped' | 'declined', heard: number, of: number) => void;
    objectiveId: () => string;
    /** Open Call Voss / Call Hale on this level. Those outbound calls connect. */
    callQuestOpen: (contactId: string) => boolean;
    /** Saved trust values (vossTrust, haleTemper). */
    getStat?: (stat: StatKey) => number;
    /** A call line that knows the street ledger was chosen (counts as something reported). */
    onLedgerLine?: () => void;
    /** Adds a reply's delta to a saved stat (clamped to -2..+2 by the saver) and returns the new value. */
    addStat?: (stat: TrustStat, delta: number) => number;
    /** A reply moment was answered (for analytics and the playtest). */
    onReply?: (info: { call: string; moment: string; choice: string; cutOff: boolean }) => void;
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

  const body = BABYLON.MeshBuilder.CreateBox('phoneBody', { width: 0.054, height: HANDSET_HEIGHT, depth: 0.00675 }, scene);
  body.parent = root;
  body.material = bodyMat;
  body.isPickable = false;
  body.checkCollisions = false;
  body.receiveShadows = false;

  const screen = BABYLON.MeshBuilder.CreateBox('phoneScreen', { width: 0.045, height: 0.0885, depth: 0.0015 }, scene);
  screen.parent = body;
  screen.position.z = 0.0045;
  screen.material = screenMat;
  screen.isPickable = false;
  screen.checkCollisions = false;
  screen.receiveShadows = false;

  // The live screen: a plane painted from a DynamicTexture (caller portrait, name, timer, reply choices).
  // A plane reads on its -Z face before rotation; turned half a circle about Y (a rotation, never a mirror) it reads on +Z.
  const uiTex = new BABYLON.DynamicTexture('phoneUiTex', { width: 256, height: 512 }, scene, true);
  uiTex.hasAlpha = false;
  const uiMat = new BABYLON.StandardMaterial('phoneUiMat', scene);
  uiMat.diffuseColor = BABYLON.Color3.Black();
  uiMat.specularColor = BABYLON.Color3.Black();
  uiMat.emissiveTexture = uiTex;
  uiMat.disableLighting = true;
  const uiPlane = BABYLON.MeshBuilder.CreatePlane('phoneScreenUi', { width: 0.045, height: 0.0885 }, scene);
  uiPlane.parent = body;
  uiPlane.position.z = 0.0045 + 0.00085;
  uiPlane.rotation.y = Math.PI;
  uiPlane.material = uiMat;
  uiPlane.isPickable = false;
  uiPlane.checkCollisions = false;
  uiPlane.receiveShadows = false;
  uiPlane.isVisible = false;

  const led = BABYLON.MeshBuilder.CreateBox('phoneLed', { width: 0.009, height: 0.006, depth: 0.003 }, scene);
  led.parent = body;
  led.position.set(0, 0.0525, 0.003);
  led.material = ledMat;
  led.isPickable = false;
  led.checkCollisions = false;
  led.receiveShadows = false;

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

  const meshes = [body, screen, led, uiPlane];
  // Phone meshes only. Avatar meshes are pushed later; this array is the public handset list.
  const excluded: BABYLON.AbstractMesh[] = [body, screen, led, uiPlane];
  const excludedSet = new Set<BABYLON.AbstractMesh>(excluded);
  // Hooked array: pushing a mesh pulls the spot out of that mesh's light list.
  // The slab does not receive shadows. The player rig is added as it loads, every frame,
  // because a list built at startup misses the skinned meshes.
  spot.excludedMeshes = excluded;
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
  let disposed = false;
  let boundAvatar: PlayerAvatar | null = null;
  let handBone: BABYLON.Bone | null = null;
  let handMesh: BABYLON.AbstractMesh | null = null;

  let scannedMeshes = -1;
  let scannedAvatar: PlayerAvatar | null = null;
  let scannedAvatarMeshes = -1;

  const rememberExcluded = (mesh: BABYLON.AbstractMesh | null | undefined) => {
    if (!mesh || excludedSet.has(mesh)) return false;
    excludedSet.add(mesh);
    excluded.push(mesh);
    return true;
  };

  const syncExcluded = () => {
    let grew = false;
    const avatar = boundAvatar;
    // `getChildMeshes` builds a new array: walk the avatar only when the scene's mesh list changed (or the avatar did),
    // not on every rendered frame.
    if (avatar && (avatar !== scannedAvatar || scene.meshes.length !== scannedAvatarMeshes)) {
      scannedAvatar = avatar;
      scannedAvatarMeshes = scene.meshes.length;
      for (const mesh of avatar.group.getChildMeshes(false)) {
        if (rememberExcluded(mesh)) grew = true;
      }
    }
    const skeleton = handBone?.getSkeleton() ?? null;
    const meshCount = scene.meshes.length;
    if (skeleton && meshCount !== scannedMeshes) {
      scannedMeshes = meshCount;
      for (const mesh of scene.meshes) {
        if (mesh.skeleton !== skeleton) continue;
        if (rememberExcluded(mesh)) grew = true;
      }
    }
    const stop = avatar?.group ?? null;
    let parent: BABYLON.Node | null = handMesh;
    while (parent && parent !== stop) {
      if (parent instanceof BABYLON.AbstractMesh && rememberExcluded(parent)) grew = true;
      parent = parent.parent;
    }
    return grew;
  };

  scene.onBeforeRenderObservable.add(() => {
    const grew = syncExcluded();
    if (!grew && scene.meshes.length === seenMeshes && scene.lights.length === seenLights) return;
    seenMeshes = scene.meshes.length;
    seenLights = scene.lights.length;
    applyLightLists();
  });
  const bonePos = new BABYLON.Vector3();
  const finger = new BABYLON.Vector3(0, 1, 0);
  const lastFinger = new BABYLON.Vector3(0, 1, 0);
  const boneWorld = new BABYLON.Matrix();
  attach.rotationQuaternion = new BABYLON.Quaternion();

  const seatOnBone = () => {
    if (!handBone || !handMesh) return;
    try {
      attach.detachFromBone();
    } catch {
      /* not on a bone yet */
    }
    // Fixed pose on the bone. Rebuilding a world quaternion each frame spun the
    // slab in the palm whenever the camera moved.
    attach.attachToBone(handBone, handMesh);
    attach.rotationQuaternion = BABYLON.Quaternion.Identity();
    attach.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(
      Math.PI,      // Y: 180°
      Math.PI / 2,  // X: 90°
      Math.PI / 2   // Z: 90°
    );
    handBone.getSkeleton().prepare(true);
    const boneScale = new BABYLON.Vector3(1, 1, 1);
    handBone.getFinalMatrix().decompose(boneScale);
    const parentS = Math.max(Math.abs(boneScale.x), Math.abs(boneScale.y), Math.abs(boneScale.z), 1e-4);
    const s = 1 / parentS;
    const mirrored = boneScale.x < 0 || boneScale.y < 0 || boneScale.z < 0;
    attach.scaling.set(s, mirrored ? -s : s, s);
    attach.position.set(0.03, FINGER_REACH / parentS, 0.02);
    attach.computeWorldMatrix(true);
    const bounds = root.getHierarchyBoundingVectors(true);
    const height = bounds.max.y - bounds.min.y;
    if (height > 1e-4 && Math.abs(height - HANDSET_HEIGHT) / HANDSET_HEIGHT > 0.35) {
      const fix = HANDSET_HEIGHT / height;
      attach.scaling.scaleInPlace(fix);
      attach.position.scaleInPlace(fix);
    }
  };

  const poseHand = () => {
    if (disposed || !handBone || !handMesh) return;
    handBone.getSkeleton().prepare(true);
    handMesh.computeWorldMatrix(true);
    handBone.getFinalMatrix().multiplyToRef(handMesh.getWorldMatrix(), boneWorld);
    // Column length is the bone scale (~0.01). lengthSquared is 1e-4, so a `> 1e-4`
    // test never normalizes a clean pose and then succeeds on walk frames whose
    // rotation stretches the column. The spot popped between the wrist and the beam.
    finger.set(boneWorld.m[4], boneWorld.m[5], boneWorld.m[6]);
    const axisLen = Math.hypot(finger.x, finger.y, finger.z);
    if (axisLen > AXIS_EPSILON) {
      finger.scaleInPlace(1 / axisLen);
      lastFinger.copyFrom(finger);
    } else {
      finger.copyFrom(lastFinger);
    }
    bonePos.set(boneWorld.m[12], boneWorld.m[13], boneWorld.m[14]);
    // Past the handset tip and the hand. Still unparented. A parented spot inherits the bone's 0.01 scale.
    const clear = FINGER_REACH + HANDSET_HEIGHT * 0.5 + BEAM_CLEAR;
    spot.position.copyFrom(bonePos).addInPlace(finger.scale(clear));
    if (root.isEnabled()) {
      const box = body.getHierarchyBoundingVectors(true);
      const cx = (box.min.x + box.max.x) * 0.5;
      const cy = (box.min.y + box.max.y) * 0.5;
      const cz = (box.min.z + box.max.z) * 0.5;
      const half = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) * 0.5;
      const dist = Math.hypot(spot.position.x - cx, spot.position.y - cy, spot.position.z - cz);
      // Ignore a broken hierarchy box. Only push further along the fingers, never back into the wrist.
      if (half > 1e-4 && half < 0.35 && dist < half + 0.02) {
        const pushed = BABYLON.Vector3.Dot(finger, new BABYLON.Vector3(cx - bonePos.x, cy - bonePos.y, cz - bonePos.z));
        const along = pushed + half + BEAM_CLEAR;
        if (along > clear) spot.position.copyFrom(bonePos).addInPlace(finger.scale(along));
      }
    }
    if (beamAim) {
      const aimed = beamAim.subtract(spot.position);
      if (aimed.lengthSquared() > 1e-4) {
        aimed.normalize();
        spot.direction.copyFrom(aimed);
      }
    } else {
      const lowered = finger.add(new BABYLON.Vector3(0, -0.2, 0));
      if (lowered.lengthSquared() > AXIS_EPSILON) lowered.normalize();
      spot.direction.copyFrom(lowered);
    }
    applyBeam(scene.getEngine().getDeltaTime() / 1000);
  };
  scene.onBeforeRenderObservable.add(poseHand);
  let raised = false;
  let uiOpen = false;
  let flashlight = false;
  let beamAim: BABYLON.Vector3 | null = null;
  let mode: 'idle' | 'incoming' | 'outgoing' | 'active' | 'ended' = 'idle';
  let party = '';
  let ringbackIn = 0;
  let ringsLeft = 0;
  let script: CallScript | null = null;
  let scriptId = '';
  let lineIndex = 0;
  let lineText = '';
  let speakerId = '';
  let elapsed = 0;
  let gap = 0;
  let lineToken = 0;
  let voice: ClipHandle | null = null;
  /** Reply moment being offered: its seconds left, and the ones already answered on this call. */
  let moment: { def: ReplyMoment; left: number; log: ReplyWindowLog } | null = null;
  const windowLogged: ReplyWindowLog[] = [];
  const closeMoment = (how: string) => {
    if (!moment) return;
    moment.log.closedAt = performance.now();
    moment.log.how = how;
    moment = null;
  };
  const momentsDone = new Set<string>();
  let queue: CallLine[] = [];
  let resumeAt = -1;
  const replyLogged: { call: string; moment: string; choice: string; cutOff: boolean; delta: number; stat: TrustStat; value: number }[] = [];
  let nextRing = 0;
  let toast = '';
  let toastLeft = 0;
  let endLeft = 0;
  const inbox: PhoneMessage[] = [];
  let app: 'home' | 'messages' | 'contacts' | 'recents' = 'home';
  const recents: { contact: string; name: string; detail: string }[] = [];
  const contacts = Object.entries(copy.contacts)
    .filter(([id]) => id === 'voss' || id === 'hale')
    .map(([id, contact]) => ({ id, name: contact.name, detail: contact.detail }));

  const rememberCall = (detail: string) => {
    const id = party || script?.contact || '';
    if (!id) return;
    recents.unshift({ contact: id, name: contactOf(id).name, detail });
    if (recents.length > 16) recents.pop();
  };

  const pickupFor = (contactId: string) => {
    const key = options.objectiveId();
    const call = copy.byObjective?.[key]?.[contactId];
    if (!call?.lines.length) return null;
    return { id: `${key}-${contactId}`, call: resolveScript(call) };
  };

  /** Open call quests connect. Anyone else is answered about one time in three, or not at all when this objective has no lines. */
  const scriptForOutbound = (contactId: string) => {
    const next = pickupFor(contactId);
    if (!next) return null;
    if (options.callQuestOpen(contactId)) return next;
    return Math.random() < PICKUP_CHANCE ? next : null;
  };

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
    } else {
      seatOnBone();
    }
    poseHand();
    syncMesh();
  };

  const portraitImgs = new Map<string, HTMLImageElement>();
  let paintedKey = '';
  const portraitFor = (id: string) => {
    const known = id === 'voss' || id === 'hale' || id === 'lang' ? id : 'unknown';
    let img = portraitImgs.get(known);
    if (!img) {
      img = new Image();
      img.onload = () => { paintedKey = ''; };
      img.src = `/assets/textures/phone/portrait-${known}.webp`;
      portraitImgs.set(known, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  };
  const wrap = (c: CanvasRenderingContext2D, text: string, width: number) => {
    const lines: string[] = [];
    let cur = '';
    for (const word of text.split(' ')) {
      const t = cur ? `${cur} ${word}` : word;
      if (cur && c.measureText(t).width > width) { lines.push(cur); cur = word; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  /** Draws the call onto the handset's screen texture; only when something on it changed. */
  const paintScreen = () => {
    const who = script ? contactOf(script.contact) : party ? contactOf(party) : null;
    const id = script?.contact ?? party;
    const replies = mode === 'active' && moment ? moment.def.options.map((o) => o.text) : [];
    const left = mode === 'active' && moment ? Math.ceil(moment.left * 4) : 0;
    const img = portraitFor(id);
    const key = [mode, id, clockOf(elapsed), replies.join('|'), left, img ? 1 : 0].join('~');
    if (key === paintedKey) return;
    paintedKey = key;
    const c = uiTex.getContext() as unknown as CanvasRenderingContext2D;
    c.fillStyle = '#070b14';
    c.fillRect(0, 0, 256, 512);
    c.textAlign = 'center';
    c.fillStyle = '#d4b483';
    c.font = '600 20px sans-serif';
    c.fillText(mode === 'outgoing' ? 'Calling' : mode === 'ended' ? 'Ended' : 'Connected', 128, 32);
    const cy = 128;
    c.save();
    c.beginPath();
    c.arc(128, cy, 62, 0, Math.PI * 2);
    c.clip();
    if (img) c.drawImage(img, 66, cy - 62, 124, 124);
    else { c.fillStyle = '#16213a'; c.fillRect(66, cy - 62, 124, 124); }
    c.restore();
    c.strokeStyle = '#d4b483';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(128, cy, 63, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#f2f2f7';
    c.font = '700 36px sans-serif';
    c.fillText(who?.name ?? 'Unknown', 128, 236);
    c.fillStyle = '#8fa0c0';
    c.font = '500 22px sans-serif';
    c.fillText(clockOf(elapsed), 128, 268);
    if (replies.length) {
      c.fillStyle = 'rgba(212,180,131,0.9)';
      c.fillRect(16, 286, Math.max(0, 224 * (moment ? Math.max(0, moment.left) / moment.def.window : 0)), 4);
      c.font = '500 19px sans-serif';
      c.textAlign = 'left';
      let y = 300;
      for (const [i, text] of replies.entries()) {
        const rows = wrap(c, text, 188).slice(0, 2);
        const h = 18 + rows.length * 22;
        c.fillStyle = '#16213a';
        c.fillRect(12, y, 232, h);
        c.fillStyle = '#d4b483';
        c.fillText(String(i + 1), 20, y + 27);
        c.fillStyle = '#f2f2f7';
        rows.forEach((row, r) => c.fillText(row, 46, y + 27 + r * 22));
        y += h + 8;
      }
    }
    uiTex.update(false);
  };

  const syncMesh = () => {
    const inCall = mode === 'active' || mode === 'outgoing' || mode === 'ended';
    const show = ((raised && mode === 'idle') || inCall) && !disposed;
    // Hide the slab only. The attach node stays on so the spot is not switched off with it.
    root.setEnabled(show);
    for (const mesh of meshes) mesh.isVisible = show;
    uiPlane.isVisible = show && inCall;
    screen.isVisible = show && !inCall;
    if (show && inCall) paintScreen();
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
    gain.connect(busInput(ctx, 'sfx'));
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  };

  let toneClip: ClipHandle | null = null;

  const stopTones = () => {
    toneClip?.stop();
    toneClip = null;
  };

  // Tones and voices play from decoded buffers: a phone hears them without a finger on the screen.
  const playTone = (src: string, volume: number) => {
    stopTones();
    if (!options.soundOn()) return;
    toneClip = playClip(src, mixVolume(src, volume));
  };

  const stopVoice = () => {
    lineToken += 1;
    gap = 0;
    voice?.stop();
    voice = null;
  };

  const pickLine = (line: CallLine): CallLine => {
    for (const alt of line.alt ?? []) {
      const ok = (Object.keys(alt.when) as StatKey[]).every((key) => inRange(options.getStat?.(key) ?? 0, alt.when[key]));
      if (ok) {
        if (alt.when.ledgerBand) options.onLedgerLine?.();
        return alt.line;
      }
    }
    return line;
  };

  const playLineNow = (line: CallLine) => {
    if (!script) return;
    speakerId = line.speaker;
    lineText = line.text;
    const token = ++lineToken;
    gap = 0;
    if (line.audio && options.soundOn()) {
      const upcoming = script.lines.slice(lineIndex + 1, lineIndex + 3).map((next) => next.audio ?? '');
      preloadClips([...queue.map((q) => q.audio ?? ''), ...upcoming]);
      voice = playClip(line.audio, 0.92, {
        onEnded: () => {
          if (token !== lineToken) return;
          gap = 0.4;
        },
        onError: () => {
          if (token !== lineToken) return;
          gap = line.duration;
        },
      });
      if (!voice) gap = line.duration;
    } else {
      gap = line.duration;
    }
  };

  const playLine = () => {
    const line = script?.lines[lineIndex];
    if (!script || !line) {
      beginEnded();
      return;
    }
    const def = script.moments.find((m) => m.after === lineIndex && !momentsDone.has(m.id));
    if (def) {
      momentsDone.add(def.id);
      const log: ReplyWindowLog = { call: scriptId, moment: def.id, words: replyWords(def.options.map((o) => o.text)), window: def.window, openedAt: performance.now(), voiceEndAt: 0, closedAt: 0, how: '' };
      windowLogged.push(log);
      moment = { def, left: def.window, log };
    }
    playLineNow(pickLine(line));
  };

  /** The line that just finished is followed by an inserted reply/answer, else the script's next (or resume) line. */
  const advance = () => {
    const next = queue.shift();
    if (next) {
      playLineNow(next);
      return;
    }
    if (resumeAt >= 0) {
      lineIndex = resumeAt;
      resumeAt = -1;
    } else {
      lineIndex += 1;
    }
    playLine();
  };

  const settle = (choice: ReplyOption | null) => {
    if (!moment || !script) return;
    const def = moment.def;
    const cutOff = choice !== null && gap <= 0;
    const delta = choice ? choice.delta : def.silence.delta;
    const stat = statOf(script.contact);
    const value = options.addStat?.(stat, delta) ?? 0;
    const tag = choice ? choice.id : 'silence';
    replyLogged.push({ call: scriptId, moment: def.id, choice: tag, cutOff, delta, stat, value });
    options.onReply?.({ call: scriptId, moment: def.id, choice: tag, cutOff });
    closeMoment(choice ? 'chose' : 'timeout');
    stopVoice();
    queue = choice ? [choice.line, choice.answer] : [def.silence.answer];
    resumeAt = def.resume;
    advance();
  };

  const beginEnded = () => {
    if (script && scriptId) {
      const of = script.lines.length;
      options.onCallEnded?.(scriptId, lineIndex >= of ? 'read' : 'skipped', Math.min(lineIndex, of), of);
    }
    rememberCall('Answered');
    closeMoment('ended');
    queue = [];
    resumeAt = -1;
    stopVoice();
    mode = 'ended';
    lineText = '';
    speakerId = '';
    endLeft = 1.5;
    playTone(TONE.hangup, 0.45);
    syncMesh();
  };

  let notifyOnFinish = false;
  let returnToRecents = false;

  const noAnswer = () => {
    playTone(TONE.busy, 0.42);
    rememberCall('No answer');
    mode = 'ended';
    lineText = 'No answer.';
    speakerId = '';
    endLeft = 1.8;
    returnToRecents = true;
    syncMesh();
  };

  const connectDial = (id: string, next: CallScript) => {
    playTone(TONE.connect, 0.4);
    script = next;
    scriptId = id;
    mode = 'active';
    elapsed = 0;
    lineIndex = 0;
    momentsDone.clear();
    options.onConnected?.(next.contact);
    playLine();
  };

  const finish = () => {
    const notify = notifyOnFinish;
    notifyOnFinish = false;
    mode = 'idle';
    script = null;
    scriptId = '';
    party = '';
    lineText = '';
    speakerId = '';
    elapsed = 0;
    endLeft = 0;
    if (returnToRecents) {
      returnToRecents = false;
      uiOpen = true;
      app = 'recents';
    }
    syncMesh();
    if (notify) options.onFinished();
  };

  const openScreen = () => {
    uiOpen = true;
    app = 'home';
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
        playTone(TONE.phoneOut, 0.45);
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
      const wasLight = flashlight;
      raised = false;
      uiOpen = false;
      flashlight = false;
      syncMesh();
      if (wasOut) {
        playTone(wasLight ? TONE.lightAway : TONE.phoneAway, wasLight ? 0.4 : 0.45);
        options.onHand(false);
      }
      return;
    }
    if (raised) return;
    raised = true;
    syncMesh();
    options.onHand(true);
  };

  return {
    meshes: () => meshes,
    refreshLights: () => {
      syncExcluded();
      applyLightLists();
      seenMeshes = scene.meshes.length;
      seenLights = scene.lights.length;
    },
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
        const was = flashlight;
        flashlight = false;
        syncMesh();
        if (was) playTone(TONE.lightAway, 0.4);
        return;
      }
      if (!raised || mode !== 'idle') return;
      flashlight = true;
      playTone(TONE.light, 0.4);
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
    locksBody: () => mode === 'incoming' || mode === 'outgoing' || mode === 'active' || mode === 'ended',
    wantsCallCamera: () => mode === 'outgoing' || mode === 'active' || mode === 'ended',
    ring: (id: string) => {
      const next = copy.calls[id];
      if (!next || mode !== 'idle') return;
      stopTones();
      script = resolveScript(next);
      scriptId = id;
      party = next.contact;
      notifyOnFinish = true;
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
      momentsDone.clear();
      nextRing = 0;
      stopTones();
      options.onConnected?.(script.contact);
      playLine();
    },
    dial: (contactId: string) => {
      if (mode !== 'idle') return;
      if (!copy.contacts[contactId] || contactId === 'pierce' || contactId === 'lang' || contactId === 'unknown') return;
      stopTones();
      party = contactId;
      script = null;
      scriptId = '';
      lineIndex = 0;
      lineText = '';
      speakerId = '';
      elapsed = 0;
      mode = 'outgoing';
      notifyOnFinish = false;
      raised = true;
      uiOpen = true;
      flashlight = false;
      ringsLeft = 2;
      ringbackIn = 1.3;
      playTone(TONE.dial, 0.42);
      syncMesh();
      options.onHand(true);
    },
    end: () => {
      if (mode === 'outgoing') {
        playTone(TONE.hangup, 0.45);
        rememberCall('Canceled');
        mode = 'idle';
        party = '';
        lineText = '';
        speakerId = '';
        uiOpen = true;
        app = 'recents';
        syncMesh();
        return;
      }
      if (mode !== 'active' && mode !== 'incoming') return;
      if (mode === 'incoming') {
        if (script && scriptId) options.onCallEnded?.(scriptId, 'declined', 0, script.lines.length);
        playTone(TONE.hangup, 0.4);
        rememberCall('Missed');
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
    openApp: (next) => {
      if (mode !== 'idle' || !uiOpen) return;
      app = next;
      if (next === 'messages') {
        for (const message of inbox) message.unread = false;
      }
    },
    back: () => {
      app = 'home';
    },
    pushText: (id: string) => {
      const text = copy.texts[id];
      if (!text) return;
      if (inbox.some((message) => message.id === id)) return;
      const row = text.line ? storyLine(text.line) : undefined;
      const body = row?.text || text.text || '';
      const from = contactOf(text.contact).name;
      inbox.unshift({ id, from, text: body, unread: !(uiOpen && mode === 'idle') });
      toast = `${from}  ·  ${body}`;
      toastLeft = Math.min(8, 3.4 + body.length / 28);
      chirp(740, 0.09, 'sine', 0.05);
    },
    chooseReply: (index: number) => {
      const choice = moment?.def.options[index];
      if (!moment || !choice || mode !== 'active') return false;
      settle(choice);
      return true;
    },
    replyWindows: () => windowLogged.map((w) => ({ ...w })),
    replyLog: () => replyLogged.map((entry) => ({ ...entry })),
    silence: () => {
      closeMoment('hangup');
      queue = [];
      resumeAt = -1;
      stopVoice();
      stopTones();
      mode = 'idle';
      script = null;
      scriptId = '';
      party = '';
      notifyOnFinish = false;
      returnToRecents = false;
      ringsLeft = 0;
      raised = false;
      uiOpen = false;
      flashlight = false;
      beamAim = null;
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
          playTone(TONE.ring, 0.5);
          nextRing = 2.8;
        }
      }
      if (mode === 'outgoing') {
        elapsed += dt;
        ringbackIn -= dt;
        if (ringbackIn <= 0) {
          if (ringsLeft <= 0) {
            const outbound = scriptForOutbound(party);
            if (outbound) connectDial(outbound.id, outbound.call);
            else noAnswer();
          } else {
            playTone(TONE.ringback, 0.4);
            ringsLeft -= 1;
            ringbackIn = 4.2;
          }
        }
      }
      if (mode === 'active') {
        elapsed += dt;
        if (moment && gap > 0) {
          // The clock runs only once the caller's voice has ended (gap > 0), never while it plays.
          if (!moment.log.voiceEndAt) moment.log.voiceEndAt = performance.now();
          moment.left -= dt;
          if (moment.left <= 0) settle(null);
        }
        if (mode === 'active' && gap > 0 && !(moment && moment.left > 0)) {
          gap -= dt;
          if (gap <= 0) {
            gap = 0;
            advance();
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
      if (uiPlane.isVisible) paintScreen();
    },
    view: () => {
      const who = script ? contactOf(script.contact) : party ? contactOf(party) : null;
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
        outgoing: mode === 'outgoing',
        badge: unread > 0 ? String(unread) : '',
        status: mode === 'incoming'
          ? 'Incoming'
          : mode === 'outgoing'
            ? 'Calling'
            : mode === 'active'
              ? 'Connected'
              : mode === 'ended'
                ? 'Ended'
                : 'Phone',
        contact: who?.name ?? '',
        contactId: who ? (['voss', 'hale', 'lang'].includes(script?.contact ?? party) ? (script?.contact ?? party) : 'unknown') : '',
        detail: mode === 'outgoing'
          ? 'Ringing'
          : who?.detail ?? (uiOpen && mode === 'idle' ? (flashlight ? 'F hides the screen' : 'G turns the light') : ''),
        speaker: talking?.name ?? '',
        line: lineText,
        clock: mode === 'outgoing' || mode === 'active' || mode === 'ended' ? clockOf(elapsed) : '',
        showAnswer: mode === 'incoming',
        showEnd: mode === 'outgoing' || mode === 'active',
        showFlash: uiOpen && mode === 'idle',
        showMessages: uiOpen && mode === 'idle',
        messages: inbox.map((message) => ({ ...message })),
        replies: mode === 'active' && moment ? moment.def.options.map((o, i) => ({ key: i + 1, text: o.text })) : [],
        repliesLeft: mode === 'active' && moment ? Math.max(0, moment.left) : 0,
        repliesTotal: mode === 'active' && moment ? moment.def.window : 0,
        toast,
        app,
        contacts,
        recents: recents.map((entry) => ({ ...entry })),
      };
    },
  };
};
