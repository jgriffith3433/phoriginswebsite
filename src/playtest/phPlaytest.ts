import type * as BABYLON from '@babylonjs/core';
import { installPlaytest, type RunOptions, type Outcome, type Tracker } from '../hawkes-playtest.js';
import { missingClip, spokenLine, storyLines } from '../game/locale';
import { STRIDE_MPS } from '../game/stride';
import type { TrainStory } from '../story/trainDress';
import type { MorningStory } from '../story/theMorning';
import type { MorningEndingStatus } from '../story/morningEnding';
import { installCameraWatch, type CamSummary } from './cameraWatch';
import { installFrameTrace, type FrameTraceSummary } from './frameTrace';

/**
 * Hawkes playtest contract v1 (spec: C:\Projects\hawkesstudio\docs\playtest.md).
 *
 * The bot plays through the same input a player uses: key events on the page (WASD, E, F, Q, R, H, C, Tab,
 * Space), clicks on the canvas, touch drags for the camera, and the title / card / Skip buttons. It reads the
 * game through a read-only probe from main.ts and never moves Pierce or edits story state. The one shortcut is
 * `setupLevel`, which starts a level directly (the same call as Continue) so `level-2` … `level-6` can begin
 * there. The save cookie is put back when a run ends, so a run never changes a player's progress.
 */

export type PhProbe = {
  ready: () => boolean;
  running: () => boolean;
  level: () => { id: number; libraryId: string; name: string };
  player: () => {
    x: number; y: number; z: number; yaw: number;
    health: number; clip: number; ammo: number; medkits: number; weaponDrawn: boolean;
  };
  /**
   * Player physics against the clip on screen: grounded flag, vertical speed, seconds off the floor,
   * the jump pose (null when walking/idle), smoothed ground speed, stick input, and the loop's clip and rate.
   */
  motion?: () => {
    grounded: boolean; velocityY: number; airTime: number; jumpPose: number | null;
    groundSpeed: number; moving: boolean; clip: string | null; rate: number; cinematic: boolean;
    walkMag?: number; phase?: string;
  };
  /**
   * Planted-foot drift while the plant flag is set (m). Criteria: under 0.03 m per plant.
   * `byLevel` covers every library id visited this run.
   */
  footSlide?: () => {
    max: number; mean: number; plants: number;
    left: { x: number; y: number; z: number; planted: boolean; drift: number };
    right: { x: number; y: number; z: number; planted: boolean; drift: number };
    hipDrop: number;
    byLevel: Record<string, { max: number; mean: number; plants: number }>;
  };
  cameraYaw: () => number;
  objective: () => { target: { x: number; z: number } | null; title: string; text: string; visible: boolean };
  action: () => string | null;
  phase: () => string;
  cutscene: () => { id: string; time: number; duration: number } | null;
  scripted: () => string | null;
  phone: () => { incoming: boolean; busy: boolean; speaker: string; line: string };
  /** Call replies: the open bubbles (with their boxes), the countdown, what was chosen, and the saved trust values. */
  replies?: () => {
    open: boolean;
    options: { key: number; text: string; rect: { x: number; y: number; w: number; h: number } | null }[];
    left: number; total: number;
    log: { call: string; moment: string; choice: string; cutOff: boolean; delta: number; stat: string; value: number }[];
    windows: { call: string; moment: string; words: number; window: number; openedAt: number; voiceEndAt: number; closedAt: number; how: string }[];
    caption: { x: number; y: number; w: number; h: number } | null;
    stats: { vossTrust: number; haleTemper: number; min: number; max: number };
  };
  /** The street ledger on the save (kills, possessions, consumes, witnesses, reported, band). Pass a seed to set it. */
  ledger?: (seed?: { kills?: number; possessions?: number; consumes?: number; witnesses?: number; reported?: number }) => {
    kills: number; possessions: number; consumes: number; witnesses: number; reported: number; band: number;
  };
  grantShock?: () => void;
  /** Going Home: siren time, police car spawn/arrival (street seconds), witnesses. */
  heat?: () => { kills: number; sirenAt: number; carSpawnedAt: number; carArrivedAt: number; sirenToCarSeconds: number; carActive: boolean; witnesses: number; withinSeconds: number };
  /** Staged Shadow crowd reactions (Going Home / Station / Train). */
  crowd?: () => {
    witnesses: number; voiced: number; voices: string[]; voiceCount: number;
    filmers: number; panickers: number; cowers: number; companions: number;
    handles: number; hides: number; reacting: number; lastLine: string; lastLines: string[];
    repeatsBackToBack: number; within2s: number;
  } | null;
  /** Test shortcut: ring a scripted call and (optionally) seed the saved trust values. */
  callTest?: (id: string, seed?: { vossTrust?: number; haleTemper?: number }) => void;
  /** The chapter title card that opens each level (kicker, name, story line). */
  hudShown: () => boolean;
  /** Share (0-1) of the rendered world canvas that is not black. */
  worldLuma: () => Promise<number>;
  chapter: () => { open: boolean; kicker: string; title: string; line: string; closing: boolean };
  /** The title over the opening shot: is it faded in, and the boxes (CSS px) of the text and the Skip button. */
  chapterLayout: () => { titled: boolean; text: { x: number; y: number; w: number; h: number } | null; skip: { x: number; y: number; w: number; h: number } | null; viewport: { w: number; h: number }; scale: number };
  /** The in-engine opening shot (src/game/chapterOpening.ts). */
  opening: () => { phase: 'idle' | 'shot' | 'handover' | 'glide'; level: number; place: string; seconds: number; elapsed: number; moved: number; turned: number; scale: number; framesInside: number; framesNear: number; cuts: number; skipped: boolean; skipToGlideMs: number; stingPlayed: number; pos: [number, number, number]; starts: number };
  /** The live title scene (rain, Shadow reflection flash, theme) and the menu sounds that have started. */
  title?: () => {
    active: boolean; secondsActive: number; rain: boolean; rainTimeAdvancing: boolean; flashes: number; reflectionShown: boolean;
    reflectionMs: number; nextFlashIn: number; lastFlashAt: number; musicPlaying: boolean; stings: number;
    camera: { x: number; y: number; z: number }; avatarVisible: boolean; menuSounds: { plays: number; last: string };
  };
  menu: () => { open: boolean; title: string; text: string; start: string | null; startEnabled: boolean; newGame: boolean };
  subtitle: () => { speaker: string; text: string };
  /** Letterbox + HUD-hidden presentation during cutscenes / scripted scenes. */
  cinematic?: () => { on: boolean; letterbox: boolean; skipBottom: boolean };
  /** Camera + subtitle choices (localStorage hawkes.settings). */
  playSettings?: () => {
    invertY: boolean; mouseSens: number; touchSens: number;
    subtitles: boolean; subtitleSize: string; subtitleBox: boolean;
  };
  creature: () => { x: number; y: number; z: number } | null;
  /** First-visit cold open: where it is, whether the creature is on screen, the lit doorway's box, the flashlight. */
  coldOpen?: () => {
    active: boolean; seconds: number; creatureShown: boolean; creatureOnScreen: boolean; rushing: boolean; lightOut: boolean; exitLit?: boolean;
    pending: boolean; running: boolean; sinceTapSeconds: number; flashlight: boolean; cardUp: boolean;
    doorway: { x: number; y: number; w: number; h: number } | null;
    /** Cold-open first-use warm finished (corridor, creature, creature SFX). */
    warmed: boolean;
    warmMs: number;
  };
  /** A scenario other than first-five opens on the title: drop the cold open and load level 1. */
  cancelColdOpen?: () => Promise<void>;
  aimLocked: () => boolean;
  shadow: () => { controls: boolean; on: boolean; handsOut: boolean; linked: boolean; ability: string; lessonStarted: boolean };
  /** Going Home's power lessons: the introduction log, the context prompt now, unlock pulses and the tape gates. */
  lesson?: () => {
    log: { t: number; power: string; step: string; setup: string; control: string }[];
    power: string;
    prompt: { shown: boolean; text: string; on: string; words: number; rect: { x: number; y: number; w: number; h: number } | null };
    unlocks: { power: string; t: number }[];
    gates: { id: string; open: boolean; passed: boolean }[];
    linked: { x: number; z: number } | null;
  };
  people: () => { x: number; z: number; kind: string }[];
  /** Apex Peak vertical slice quality (null off that level). */
  /** Living world: people on routines, glances, what answered Interact, and the longest quiet stretch. */
  /** The Desk's two played beats: the mirror's lag and head turn, and the drag that clears the desk. */
  desk?: () => {
    phase: string;
    mirror: { engaged: boolean; maxLagMs: number; lagMs: number; headTurns: number; headTurnBeforeHeMoved: boolean; quiet: boolean; thatsMe: boolean; walkedMetres: number };
    desk: { swept: boolean; drags: number; dragPx: number; peakSpeed: number; off: number; total: number; offAfterDrag: number[]; sounds: string[]; terminalOff: boolean; hintShown: boolean; skipped: boolean };
  };
  life?: () => { people: { id: string; place: string; routine: string }[]; glanceCount: number; glances: { place: string; who: string }[]; touchCount: number; touchIds: string[]; touches: { place: string; id: string; motion: string; sound: string }[]; barks: { place: string; line: string }[]; maxQuietSeconds: number; touchables: { id: string; label: string; x: number; z: number; r: number }[]; interactShown: boolean; interactLabel: string };
  apexSlice?: () => { maxQuietSeconds: number; textOnlyBeats: number; events: number } | null;
  /** Lip sync / blinks / look-at / gestures on registered speakers (`src/game/faceTalk.ts`). */
  faces?: () => {
    speaker: string | null;
    speakers: {
      id: string; speaking: boolean; mouth: number; shape: string; blinks: number;
      lookYaw: number; lookPitch: number; gesture: string | null; gestures: string[];
    }[];
    gestures: string[];
    blinks: number;
    mouthEvents: number;
    lookTurns: number;
    updateMs: number;
  };
  resetFaces?: () => void;
  /** Board plot through the Apex hall: desk person, locked door, visible threat (null off that level). */
  boardHall?: () => { deskSeen: boolean; doorTried: boolean; threatSeen: boolean; deskAt: { x: number; z: number }; doorAt: { x: number; z: number; r: number }; threatAt: { x: number; z: number; r: number } } | null;
  pickups: () => { x: number; z: number; item: string }[];
  scene: BABYLON.Scene;
  canvas: HTMLCanvasElement;
  startButton: HTMLButtonElement;
  newGameButton: HTMLButtonElement;
  skipButton: HTMLButtonElement | null;
  /** Test shortcut for setup: start a level directly, as Continue does. */
  setupLevel: (id: number) => Promise<void>;
  /** Test shortcut for a feel replay: stand Pierce at (x, z) facing yaw (radians), as the game's own respawns do. */
  place?: (x: number, z: number, yaw: number) => void;
  /** The feel sensor's view of Pierce: his capsule, whether he stands on something, which meshes count as solid. */
  feel?: { collider: BABYLON.AbstractMesh; grounded: () => boolean; isSolid: (mesh: BABYLON.AbstractMesh) => boolean };
  /** Interior camera volumes: active profile, faded occluder count, authored volume count. */
  camera?: () => { profile: string; faded: number; volumes: number };
  /** Test shortcut (`train`): start a hidden (`comingSoon`) level by library id, as `?beat=train` does. */
  setupHidden: (libraryId: string) => Promise<void>;
  /** The rows Load Level shows, as rendered into its list (titles only). */
  levelRows: () => string[];
  chapterSelect: () => { cards: { n: number; unlocked: boolean; text: string; box: { x: number; y: number; w: number; h: number } }[]; cue: { plays: number; last: number }; list: { x: number; y: number; w: number; h: number; scrollTop: number; scrollHeight: number; clientHeight: number }; save: { found: Record<string, string[]>; best: Record<string, number> } };
  loreSpots: () => { remaining: { id: string; x: number; z: number }[]; chapter: number; all: { id: string; x: number; z: number }[] };
  /** The train car kit while level 7 is dressed, else null. */
  train: () => {
    seats: number; poles: number; ads: number; windows: number; lampsPassed: number; speed: number; roll: number;
    /** Tunnel lamp period at current speed (s). Must be ≤ 3 while moving. */
    lampPeriodSec?: number; lampGap?: number; flicker?: number;
    /** The stop: how far the platform shows in the north windows and the side door is open (0..1). */
    platform: number; door: number;
    /** 3D Gaussian Splatting scene readiness and total splat count. */
    splatReady?: boolean; splatCount?: number;
    /** Level 7's script (theTrain.ts): its beat, the car, where the old body is and which way he faces. */
    story: TrainStory | null;
  } | null;
  /** Level 8's script (theMorning.ts): its beat, whether he lies in bed, what the TV showed; null off level 8. */
  morning: () => MorningStory | null;
  /** The end of level 8 (morningEnding.ts): phase, title, places flown over, names, the call and the card. */
  endSuite: () => MorningEndingStatus;
  /** Test setup (`level-8-ending`): skip to the walk to the coat ('out') or to the door with the coat taken. */
  morningJump: (to: 'out' | 'door') => void;
  /** The ending song playing on the Level Complete card, or null. Level 7 reuses ending-6. */
  ending: () => string | null;
  /** Test setup (`load-error`): the next level load fails, as a missing level file ('error') or one that never ends ('hang'). */
  failNextLoad: (kind: 'error' | 'hang') => void;
  /** The memory tier and texture cap (also in hawkesPlaytest.state().graphics). */
  graphics: () => GraphicsInfo;
  /** The rendering pipeline (src/render/pipeline.ts): tier, chapter LUT, shadows, SSAO, post passes. */
  render?: () => RenderInfo;
  /** Mean colour of the next finished frame (after the grade), for the chapter contact sheet. */
  frameColor?: () => Promise<{ r: number; g: number; b: number; luma: number } | null>;
  /** Test setup (`context-loss`): lose and restore the WebGL context with WEBGL_lose_context; what the recovery shows. */
  contextLoss: {
    lose: () => boolean;
    restore: () => boolean;
    status: () => { lost: boolean; overlay: boolean; overlayText: string; restarted: number; restored: number; lost_?: never };
  };
  /** Test setup (`vat-acid`): level 2 is loaded; start the hunt from the lab door, or the vat break shot. */
  setupBeat: (kind: 'hunt' | 'vat') => void;
  hunt: () => { huntRetries: number; retrySeconds: number[]; lastRetrySeconds: number; retrying: boolean; health: number; fade: number };
  acid: () => { active: boolean; t: number; falls: number; swapped: boolean; lag: number; drift: number; speed: number; locked: boolean; flashlight: boolean; skipShown: boolean; x: number; z: number; yaw: number };
  /** B3 horror lighting (src/game/b3Horror.ts): flashlight shadows, vat glow, fog, landmarks. Null off that level. */
  b3Horror?: () => {
    active: boolean; flashlightShadows: boolean; shadowCasters: number; beamVisible: boolean; volumetric: boolean;
    fogMode: string; landmarks: { id: string; lit: boolean }[]; vatWallsLit: number; flickerOn: boolean;
    creatureRim: boolean; fpsHint: number;
  } | null;
  /** Quiet chapters (src/game/quietLight.ts): Return / Desk / Morning looks. Null off those levels. */
  quietLight?: () => {
    mode: string; deskLamp: boolean; deskShadowLong: boolean; mirrorTextOk: boolean; sunShafts: boolean;
    volumetric: boolean; tvSpill: boolean; buzzTube: boolean; dust: boolean; fpsHint: number;
  } | null;
  /** Rain-slick city night (Going Home) or station open-end rain. Probe `rainNight()`. */
  rainNight?: () => {
    rain?: number; splashes?: number; steam?: number; neon?: number; neonIds?: string[];
    puddles?: number; reflection?: string; flares?: number; fpsHint?: number; tier?: string;
    sodium?: number; boardEmissive?: number; openEndRain?: boolean;
  } | null;
  /** Station rain / sodium dress only. */
  stationRain?: () => {
    rain: number; splashes: number; sodium: number; boardEmissive: number; openEndRain: boolean;
  } | null;
  /** Test shortcut (`b3-retry`): Pierce's health drops to zero, as a bite would. False while he cannot be hurt. */
  forceDefeat: () => boolean;
  /** Test shortcut (`world-hud`): hurts Pierce by `amount` but never below 25 health. */
  hurt?: (amount: number) => boolean;
  /** Pain state: vignette level 0..1, heartbeats played, whether the health bar is displayed. */
  pain?: () => { level: number; heartbeats: number; lastBeatAgoMs: number; healthBarShown: boolean; vignette: number };
  /** The use prompt hung on the thing in reach: text, on-target or on-button, box. */
  usePrompt?: () => { shown: boolean; text: string; on: string; words: number; rect: { x: number; y: number; w: number; h: number } | null };
  /** Test shortcut (`living-places`): show the running level's Level Complete card now. */
  showLevelComplete: () => boolean;
  /** What the scene holds right now, for leak checks (also in hawkesPlaytest.state().counts). */
  counts: () => SceneCounts;
  /** Test setup: lay the page out as a 390x844 phone (for a desktop viewport). */
  phoneFrame: (on: boolean, landscape?: boolean, size?: { w: number; h: number }) => void;
  /** Phone screen mode (src/game/screenMode.ts): the portrait prompt, fullscreen. `asTouch` is setup: act as a touch device. */
  screenMode: {
    prompt: () => { showing: boolean; text: string };
    asTouch: (on: boolean) => void;
    refresh: () => void;
    fullscreen: () => { supported: boolean; active: boolean };
    attempts: () => { fullscreen: number; lock: number };
  };
  /** The Lost? prompt (src/game/returnToObjective.ts): shown, seconds without progress, and a move under way. */
  lost: () => { prompt: boolean; idle: number; returning: boolean };
  /** The objective waypoint (src/game/objectiveWaypoint.ts): drawn or not, edge-clamped, its text and its box on screen. */
  waypoint: () => {
    shown: boolean; clamped: boolean; x: number; y: number; angle: number; name: string; distance: number;
    rect: { left: number; top: number; right: number; bottom: number } | null;
  };
  /** Tap to play, the AudioContext, Pause and Settings (studio sound standard). */
  sound: () => {
    prompt: boolean; context: string; paused: boolean; settingsOpen: boolean;
    settings: { on: boolean; music: number; sfx: number };
    /** Id of the music trigger bed that is active now, and whether it is audibly playing. */
    bed: string | null; bedPlaying: boolean;
    /** Layered chapter ambience spots (chapterAmbience.ts). */
    ambience?: {
      level: number; live: number; maxLive: number; spotsPlayed: string[]; distinctSpots: number;
      lastSpotId: string | null; lastSpotAtMs: number; silenceMs: number; startedAtMs: number; fired: number;
    } | null;
    /** The walk (footstep) loop is playing. */
    footsteps: boolean;
    stepCount?: number;
    steps?: { surface: string; variant: number; rate: number; foot: string }[];
    /** Music director (docs/music.md): state, state log, duck depth, events. */
    /** Every voice clip: start, end, whether a stop cut it short, whether another voice sounded under it. */
    sceneMix?: { maxSfx: number; minVoice: number; sfxToVoiceDb: number | null; capped: number; entries: { url: string; kind: string; asked: number; gain: number; capped: boolean }[] };
    sceneMixReset?: () => void;
    voice?: { url: string; start: number; end: number; waited: number; duration: number; state: string; cut: boolean; overlapped: boolean }[];
    /** Spatial audio: reverb zone, occlusion, panning, loudness, dropouts (src/game/acoustics.ts). */
    acoustics?: AcousticsProbe;
    music?: { chapter: number; state: string; stems: number; streaming: boolean; duckDb: number; duckDepthDb: number; voices: number; changes: number; stateLog: { t: number; state: string; reason: string }[]; events: { t: number; kind: string; detail: string }[]; silenceSeconds: number; theme?: { variant: string; rot: number; playing: boolean; cutoffHz: number; detuneCents: number }; voss?: { on: boolean; playing: boolean } };
  };
  /** A noise burst 3 m to the listener's side, read back from the master's left and right channels. */
  acousticPing?: (side: 'left' | 'right' | 'front') => Promise<{ left: number; right: number; side: string }>;
  /** Clears the visited reverb zones, the loudness history and the dropout count. */
  acousticReset?: () => void;
  /** Steady noise placed at a point (through the real world-sound graph) for `seconds`: label 'test-board-voice'. */
  acousticTestSource?: (x: number, y: number, z: number, seconds: number) => void;
  /**
   * Frame-time trace: last frame ms, hitch counts over 50/100 ms, and the worst five with a
   * named cause (shader-compile, asset-load, gc, level-setup, audio-decode, unknown).
   * Filled by installPhPlaytest; main does not provide it.
   */
  frames: () => FrameTraceSummary;
};

export type AcousticsProbe = ReturnType<typeof import('../game/acoustics').acousticsProbe> & { door: { closed: boolean } };

export type GraphicsInfo = {
  memoryTier: 'low' | 'standard'; deviceMemory: number | null; textureCap: number | null;
  maxTextureSize: number; lowPower: boolean; reason: string;
};

export type RenderInfo = {
  tier: 'low' | 'medium' | 'high'; chapter: string; lut: string | null; lutReady: boolean; toneMapping: string;
  exposure: number; bloom: boolean; bloomThreshold: number; aberration: boolean; grain: boolean; vignette: boolean;
  ssao: boolean; shadows: boolean; cascades: number; shadowMapSize: number; shadowCasters: number;
  shadowStrength: number; hardwareScaling: number; msSinceTierChange: number | null;
};

export type SceneCounts = {
  meshes: number; materials: number; textures: number; skeletons: number; animationGroups: number;
  particleSystems: number; lights: number; transformNodes: number; renderTargets: number;
  /** <audio> elements playing, iOS gain routes made for elements, and live Web Audio clips. */
  audioElements: number; audioRouted: number; audioClips: number;
  fps: number;
};

/** Counts that must come back to the same number after a Defeat -> Start retry. */
const FLAT_COUNTS = ['meshes', 'materials', 'textures', 'skeletons', 'animationGroups', 'particleSystems', 'lights', 'transformNodes', 'renderTargets', 'audioRouted'] as const;
const RETRIES = 5;

const LEVELS = [
  { n: 1, lib: 'apex-peak', name: 'Level 1: The Apex Peak' },
  { n: 2, lib: 'b3-basement', name: 'Level 2: B3' },
  { n: 3, lib: 'the-return', name: 'Level 3: The Return' },
  { n: 4, lib: 'the-desk', name: 'Level 4: The Desk' },
  { n: 5, lib: 'going-home', name: 'Level 5: Going Home' },
  { n: 6, lib: 'the-station', name: 'Level 6: The Station' },
];

const LEVEL_NAMES = ['The Apex Peak', 'B3', 'The Return', 'The Desk', 'Going Home', 'The Station', 'The Train', 'The Morning'];
/** A per-level smoke run has about four minutes of headless play (~1 fps). */
const SMOKE_SECONDS = 240;
/** No objective progress for this long ends a smoke run `stuck`, naming the live objective. */
const SMOKE_STUCK_MS = 30000;
/** A cutscene in a smoke run is skipped after this many seconds (rides use FULL_SKIP_AFTER). */
const SMOKE_SKIP_AFTER = 10;
class SmokeStuck extends Error {}

/** Usual timeline lengths, seconds. A scripted scene (lobby, desk, station opening) has no timeline file. */
const SCRIPTED_LIMIT = 150;
/** Meshes a scene refers to, by scene id: the audit reports any that never exist while the scene runs. */
const SCENE_PROPS: Record<string, RegExp[]> = {
  'station-opening': [/^station-man$/, /^station-double$/, /^station-shade$/],
  'the-desk': [/^desk-paper-\d$/],
};
/** In `full`, these long rides are skipped after this many seconds. Levels 1–6 stay near ten minutes; level 7 is the train after them. */
const FULL_SKIP_AFTER: Record<string, number> = { 'elevator-b3': 16, 'elevator-up': 16 };

const B3_DEN = { x: 7.5, z: 25 };
const HOME_STAIRS = { x: 163.5, z: 21.2 };
const STREET_LANE_Z = 22.6;

// Same doorway links the hunt grid adds in act1.ts, where B3 floor slabs do not meet.
const B3_LINKS: Rect[] = [
  { minX: 15.6, maxX: 18.6, minZ: 36.2, maxZ: 39.8 },
  { minX: 20, maxX: 40, minZ: 39.6, maxZ: 41.4 },
  { minX: 45.4, maxX: 47.8, minZ: 36.2, maxZ: 40.8 },
  { minX: 41.2, maxX: 46.8, minZ: 36.1, maxZ: 37.4 },
];

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
type Grid = { step: number; ox: number; oz: number; cols: number; rows: number; open: Uint8Array };
type Point = { x: number; z: number };

const STEP = 0.2;
const PAD = 0.4; // player ellipsoid radius
const TAU = Math.PI * 2;
const wrap = (a: number) => {
  let v = (a + Math.PI) % TAU;
  if (v < 0) v += TAU;
  return v - Math.PI;
};
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const RAW_KEY = /\b[a-z][a-z0-9]*(?:\.[a-z0-9-]+){2,}\b|\{[a-z]+\}|\bundefined\b|\bNaN\b/;

// ---------------------------------------------------------------- walk grid

const buildGrid = (scene: BABYLON.Scene, libraryId: string): Grid | null => {
  const floors: Rect[] = [];
  const blocks: Rect[] = [];
  for (const mesh of scene.meshes) {
    if (!mesh.isEnabled()) continue;
    const meta = mesh.metadata as { assetKind?: string; pickup?: unknown } | null;
    const box = mesh.getBoundingInfo().boundingBox;
    const r = { minX: box.minimumWorld.x, maxX: box.maximumWorld.x, minZ: box.minimumWorld.z, maxZ: box.maximumWorld.z };
    const sx = r.maxX - r.minX;
    const sz = r.maxZ - r.minZ;
    if (!Number.isFinite(sx) || !Number.isFinite(sz)) continue;
    if (meta?.assetKind === 'ground') {
      // Low slabs are trenches and pits, not floor to walk on.
      if (sx >= 1 && sz >= 1 && box.maximumWorld.y > -0.2 && box.maximumWorld.y < 0.6) floors.push(r);
      continue;
    }
    if (!mesh.checkCollisions || meta?.pickup) continue;
    if (/trigger|ceil|creature|skybox|playerCollider|impact|decal|floor|ground/i.test(mesh.name)) continue;
    if (box.maximumWorld.y < 0.35 || box.minimumWorld.y > 1.7) continue;
    if (sx > 24 && sz > 24) continue;
    if (sx < 0.02 && sz < 0.02) continue;
    blocks.push(r);
  }
  if (libraryId === 'b3-basement' || libraryId === 'the-return') floors.push(...B3_LINKS);
  if (!floors.length) return null;
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const f of floors) {
    minX = Math.min(minX, f.minX); maxX = Math.max(maxX, f.maxX);
    minZ = Math.min(minZ, f.minZ); maxZ = Math.max(maxZ, f.maxZ);
  }
  if ((maxX - minX) * (maxZ - minZ) > 400 * 400) return null;
  const cols = Math.ceil((maxX - minX) / STEP) + 1;
  const rows = Math.ceil((maxZ - minZ) / STEP) + 1;
  const open = new Uint8Array(cols * rows);
  for (const f of floors) {
    // Inclusive edges, so a cell on the seam between two slabs stays open.
    const c0 = Math.max(0, Math.ceil((f.minX - 0.02 - minX) / STEP));
    const c1 = Math.min(cols - 1, Math.floor((f.maxX + 0.02 - minX) / STEP));
    const r0 = Math.max(0, Math.ceil((f.minZ - 0.02 - minZ) / STEP));
    const r1 = Math.min(rows - 1, Math.floor((f.maxZ + 0.02 - minZ) / STEP));
    for (let r = r0; r <= r1; r++) open.fill(1, r * cols + c0, r * cols + c1 + 1);
  }
  for (const b of blocks) {
    const c0 = Math.max(0, Math.ceil((b.minX - PAD - minX) / STEP));
    const c1 = Math.min(cols - 1, Math.floor((b.maxX + PAD - minX) / STEP));
    const r0 = Math.max(0, Math.ceil((b.minZ - PAD - minZ) / STEP));
    const r1 = Math.min(rows - 1, Math.floor((b.maxZ + PAD - minZ) / STEP));
    if (c1 < c0 || r1 < r0) continue;
    for (let r = r0; r <= r1; r++) open.fill(0, r * cols + c0, r * cols + c1 + 1);
  }
  return { step: STEP, ox: minX, oz: minZ, cols, rows, open };
};

const cellOf = (g: Grid, p: Point) => ({ c: Math.round((p.x - g.ox) / g.step), r: Math.round((p.z - g.oz) / g.step) });
const isOpen = (g: Grid, c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.open[r * g.cols + c] === 1;
const worldOf = (g: Grid, c: number, r: number): Point => ({ x: g.ox + c * g.step, z: g.oz + r * g.step });

const nearestOpen = (g: Grid, p: Point, maxMeters: number) => {
  const { c, r } = cellOf(g, p);
  if (isOpen(g, c, r)) return { c, r };
  const maxR = Math.ceil(maxMeters / g.step);
  for (let rad = 1; rad <= maxR; rad++) {
    let best: { c: number; r: number } | null = null;
    let bestD = Infinity;
    for (let dc = -rad; dc <= rad; dc++) {
      for (let dr = -rad; dr <= rad; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad || !isOpen(g, c + dc, r + dr)) continue;
        const d = dc * dc + dr * dr;
        if (d < bestD) { bestD = d; best = { c: c + dc, r: r + dr }; }
      }
    }
    if (best) return best;
  }
  return null;
};

const lineOpen = (g: Grid, a: Point, b: Point) => {
  const n = Math.max(1, Math.ceil(dist(a, b) / (g.step * 0.5)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const { c, r } = cellOf(g, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    if (!isOpen(g, c, r)) return false;
  }
  return true;
};

/** A* over the grid, 8 neighbours, no corner cutting. Returns smoothed waypoints, or null when unreachable. */
const findPath = (g: Grid, from: Point, to: Point): Point[] | null => {
  const s = nearestOpen(g, from, 2.5);
  const e = nearestOpen(g, to, 4);
  if (!s || !e) return null;
  const n = g.cols * g.rows;
  const start = s.r * g.cols + s.c;
  const goal = e.r * g.cols + e.c;
  const gScore = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap: [number, number][] = [];
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  const h = (i: number) => {
    const c = i % g.cols;
    const r = (i - c) / g.cols;
    const dc = Math.abs(c - e.c);
    const dr = Math.abs(r - e.r);
    return Math.max(dc, dr) + 0.414 * Math.min(dc, dr);
  };
  gScore[start] = 0;
  push(h(start), start);
  let found = false;
  let guard = 0;
  while (heap.length && guard++ < 400000) {
    const [, i] = pop();
    if (closed[i]) continue;
    if (i === goal) { found = true; break; }
    closed[i] = 1;
    const c = i % g.cols;
    const r = (i - c) / g.cols;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (!isOpen(g, nc, nr)) continue;
        if (dc && dr && (!isOpen(g, c + dc, r) || !isOpen(g, c, r + dr))) continue;
        const j = nr * g.cols + nc;
        if (closed[j]) continue;
        const cost = gScore[i] + (dc && dr ? 1.414 : 1);
        if (cost >= gScore[j]) continue;
        gScore[j] = cost;
        came[j] = i;
        push(cost + h(j), j);
      }
    }
  }
  if (!found) return null;
  const cells: Point[] = [];
  for (let i = goal; i !== -1; i = came[i]) {
    const c = i % g.cols;
    cells.push(worldOf(g, c, (i - c) / g.cols));
  }
  cells.reverse();
  const out: Point[] = [];
  let anchor = 0;
  for (let i = 2; i < cells.length; i++) {
    if (!lineOpen(g, cells[anchor], cells[i])) {
      out.push(cells[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(cells[cells.length - 1]);
  return out;
};

// ---------------------------------------------------------------- the bot

export const installPhPlaytest = (probeIn: Omit<PhProbe, 'frames'> & { frames?: () => FrameTraceSummary }) => {
  const frameTrace = installFrameTrace({
    scene: () => probeIn.scene,
    context: () => {
      const level = probeIn.level();
      const obj = probeIn.objective();
      return {
        level: level.id,
        libraryId: level.libraryId,
        objective: (obj.title || obj.text || '').trim().slice(0, 80),
      };
    },
  });
  const probe = probeIn as PhProbe;
  probe.frames = () => frameTrace.summary();

  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    // Dev only: an ASCII map of the walk grid ('#' blocked, '.' open, '@' Pierce) for debugging routes.
    (window as unknown as Record<string, unknown>).__phWalkGrid = (x0: number, z0: number, x1: number, z1: number, step = 0.4) => {
      const g = buildGrid(probe.scene, probe.level().libraryId);
      if (!g) return 'no grid';
      const p = probe.player();
      const rows: string[] = [];
      for (let z = z1; z >= z0; z -= step) {
        let row = `${z.toFixed(1).padStart(6)} `;
        for (let x = x0; x <= x1; x += step) {
          const { c, r } = cellOf(g, { x, z });
          row += Math.hypot(p.x - x, p.z - z) < step * 0.7 ? '@' : isOpen(g, c, r) ? '.' : '#';
        }
        rows.push(row);
      }
      return rows.join('\n');
    };
    (window as unknown as Record<string, unknown>).__phProbe = probe;
    (window as unknown as Record<string, unknown>).__phBlocks = (x: number, z: number) => probe.scene.meshes
      .filter((m) => m.isEnabled() && m.checkCollisions)
      .filter((m) => { const b = m.getBoundingInfo().boundingBox; return x >= b.minimumWorld.x - PAD && x <= b.maximumWorld.x + PAD && z >= b.minimumWorld.z - PAD && z <= b.maximumWorld.z + PAD && b.maximumWorld.y > 0.35 && b.minimumWorld.y < 1.7; })
      .map((m) => { const b = m.getBoundingInfo().boundingBox; return `${m.name} [${b.minimumWorld.x.toFixed(2)},${b.maximumWorld.x.toFixed(2)}]x[${b.minimumWorld.z.toFixed(2)},${b.maximumWorld.z.toFixed(2)}] y${b.minimumWorld.y.toFixed(2)}-${b.maximumWorld.y.toFixed(2)}`; });
  }
  let token = 0;
  // False until this function has run to its end. `run` and `watchProblems` are consts declared below the
  // installPlaytest call, and its `?playtest=` auto start calls `start` synchronously when isReady() is true, so
  // answering true any earlier throws "Cannot access ... before initialization" at t=0.
  let installed = false;
  const held = new Set<string>();
  let lookSens = 0; // radians per pixel of touch drag, measured on first use

  const codeFor = (key: string) => (key === ' ' ? 'Space' : key === 'Tab' ? 'Tab' : key === 'Shift' ? 'ShiftLeft' : `Key${key.toUpperCase()}`);
  const sendKey = (type: 'keydown' | 'keyup', key: string) => {
    document.body.dispatchEvent(new KeyboardEvent(type, { key, code: codeFor(key), bubbles: true, cancelable: true }));
  };
  /** Phone scenarios walk with the left stick (touch drags), not W A S D: setHeld turns movement keys into stick positions. */
  let touchWalk = false;
  let stickIsDown = false;
  const stickTo = (ux: number, uy: number) => {
    const zone = document.getElementById('leftStickZone');
    if (!zone) return;
    const zr = zone.getBoundingClientRect();
    const type = stickIsDown ? 'pointermove' : 'pointerdown';
    stickIsDown = true;
    zone.dispatchEvent(new PointerEvent(type, { pointerId: 31, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: zr.left + zr.width / 2 + ux * zr.width * 0.38, clientY: zr.top + zr.height / 2 + uy * zr.height * 0.38 }));
  };
  const stickLift = () => {
    if (!stickIsDown) return;
    stickIsDown = false;
    document.getElementById('leftStickZone')?.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31, pointerType: 'touch', bubbles: true }));
  };
  const setHeld = (keysIn: string) => {
    let keys = keysIn;
    if (touchWalk) {
      const x = (keys.includes('d') ? 1 : 0) - (keys.includes('a') ? 1 : 0);
      const y = (keys.includes('s') ? 1 : 0) - (keys.includes('w') ? 1 : 0);
      keys = keys.replace(/[wasd]/g, '');
      if (x || y) { const m = Math.hypot(x, y); stickTo(x / m, y / m); } else stickLift();
    }
    const want = new Set(keys.split(''));
    for (const k of [...held]) if (!want.has(k)) { held.delete(k); sendKey('keyup', k); }
    for (const k of want) if (!held.has(k)) { held.add(k); sendKey('keydown', k); }
  };
  const releaseAll = () => setHeld('');

  /** A short drag on the canvas: the touch-look path a phone player uses. */
  const dragLook = (dx: number) => {
    const canvas = probe.canvas;
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + rect.width * 0.62;
    const y = rect.top + rect.height * 0.5;
    const touch = (cx: number) => new Touch({ identifier: 41, target: canvas, clientX: cx, clientY: y });
    const fire = (type: string, cx: number, live: boolean) => {
      const t = touch(cx);
      canvas.dispatchEvent(new TouchEvent(type, {
        touches: live ? [t] : [], targetTouches: live ? [t] : [], changedTouches: [t], bubbles: true, cancelable: true,
      }));
    };
    fire('touchstart', x, true);
    fire('touchmove', x + dx, true);
    fire('touchend', x + dx, false);
  };

  const clickCanvas = () => {
    const canvas = probe.canvas;
    const rect = canvas.getBoundingClientRect();
    const init = { pointerType: 'mouse', pointerId: 1, button: 0, buttons: 1, bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    canvas.dispatchEvent(new PointerEvent('pointerdown', init));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
  };

  const input = (action: string, down: boolean) => {
    const map: Record<string, string> = { forward: 'w', back: 's', left: 'a', right: 'd', jump: ' ', interact: 'e', phone: 'f', weapon: 'q', shadow: 'c', ability: 'Tab', reload: 'r', medkit: 'h' };
    const key = map[action] ?? action;
    if (action === 'fire') { if (down) clickCanvas(); return; }
    if (down) { held.add(key); sendKey('keydown', key); } else { held.delete(key); sendKey('keyup', key); }
  };

  const api = installPlaytest({
    product: 'phorigins',
    scenarios: [
      {
        id: 'smoke',
        title: 'Boot, title, start level 1, answer the call, walk to the board; hitchFailOver100; chapter-card black-frame check on levels 1-8 desktop and 844x390; short L1 explore-cam (cameraInside/blocked/snaps + worst screenshots)',
        description: 'Starts level 1 with Start (chapter card + warm). Samples the world while the card is up and fails on a mostly-black lift or HUD over the card/black. Answers Voss, walks to the board cutscene. Publishes hitchFailOver100 (Babylon work time) and fails on any post-grace frame over 100 ms. Then samples chapter-card → world for levels 2-8 on desktop and levels 1-8 at 844x390 (same black-frame rules as transition). Ends with a short Level 1 hall wall-hug under cameraWatch so a smoke-only beta run reports cameraInside/cameraBlocked/cameraSnaps and attaches worst-frame screenshots (docs/camera.md). Metrics: hitchOver50/100, hitchFailOver100, transitionSamples, cameraInside, cameraBlocked, cameraSnaps. Problems: board scene missing, hitch over 100 ms, black frame under/after the card, HUD over the card or over black, camera inside geometry.',
        seconds: 840,
        tags: ['smoke', 'perf', 'ui', 'camera'],
      },
      ...LEVELS.map((l) => ({ id: `level-${l.n}`, title: `${l.name} to its exit${l.n > 1 ? ` (starts at level ${l.n})` : ''}`, seconds: [330, 170, 200, 100, 200, 110][l.n - 1], tags: ['level'] })),
      ...LEVEL_NAMES.map((name, i) => ({
        id: `explore-cam-l${i + 1}`,
        title: `Explore camera, level ${i + 1} (${name}): wall-hugs hallways, turns in doorways, backs into corners on walkable routes; counts camera inside, blocked, near-wall, snaps and jitter vs docs/camera.md baseline (≤10%); worst frames with screenshots`,
        seconds: 300,
        // smoke tag: listed on the front-page contract so beta can schedule them; daily beta still plays smoke,
        // which carries a short L1 explore-cam leg for the same metrics.
        tags: ['smoke', 'camera', 'level'],
      })),
      {
        id: 'interior-cam',
        title: 'Interior camera volumes: Level 1 halls (hallway profile, occlusion fade) and Level 8 apartment on desktop and 844x390',
        description: 'Starts Level 1, skips openings, walks Hall 1 and Hall 2 hugging the wall and through doorways; checks hallway/doorway profile, faded occluders, and camera-inside/blocked ≤10% of the L1 baseline. Then Level 8 apartment the same way. Repeats both at 844x390. Metrics: cameraInside, cameraBlocked, cameraFadedPeak, cameraHallwayFrames, cameraProfileHall, cameraProfileOpen.',
        seconds: 420,
        tags: ['smoke', 'camera', 'level'],
      },
      ...LEVEL_NAMES.map((name, i) => ({
        id: `smoke-l${i + 1}`,
        title: `Smoke, level ${i + 1} (${name}): starts it directly, plays the objectives in order, long scenes skipped early, ends at its end card; stuck after 30 s with no objective progress`,
        seconds: SMOKE_SECONDS,
        tags: ['smoke', 'level'],
      })),
      {
        id: 'stuck-recovery',
        title: 'Idle 60 s in level 1: "Lost? Return to objective" shows and puts Pierce beside the objective; Pause always offers it; tappable at 390x844 and 844x390',
        description: 'Starts level 1 with Start, opens Pause at once and checks Return to objective is there. Then stands still: no key, no mouse. After 60 s of play with no progress the Lost? prompt must appear (logged with the seconds). Presses R (a tap on the prompt in the phone passes, hit-tested so a covered prompt fails), waits out the fade and checks Pierce is within 5 m of the objective marker, on walkable ground, and the prompt is gone. Pause > Return to objective is used once the same way. The prompt is checked on screen and clear of the touch buttons at 390x844 and again at 844x390.',
        seconds: 420,
        tags: ['menus', 'ui'],
      },
      {
        id: 'call-replies',
        title: 'Every Voss and Hale call offers replies (1/2/3, click or tap): choosing cuts the caller off, waiting plays silence, voss-morning branches on vossTrust',
        description: 'Starts level 3 (test shortcut) and rings each scripted call with the probe\'s callTest shortcut (voss-late, voss-meeting, hale-walkout, hale-board, hale-train, voss-morning), answering through real input (F, or the Answer button on touch). Each call must open a reply moment with 2-3 bubbles plus a countdown, every bubble at least 44 px tall and clear of the touch controls and the call caption. The bot chooses by key 1 (desktop) or a tap on the bubble (options.phone: 390x844 touch) about 0.7 s in, while the caller is still talking: the answer log must say cutOff, and the Pierce line must show as a subtitle. On voss-late and hale-walkout it waits out the window instead: the log must say silence, not cut off. Then voss-morning is rung with vossTrust seeded to -2 and to +2: the first Voss line must differ. vossTrust and haleTemper must stay within -2..+2 on the ph-origins-save cookie, and the same after a page reload. Metrics: replyMoments, replyCutOffs, replySilences, replyBubbleMinHeight. Options: phone.',
        seconds: 330,
        tags: ['story', 'phone'],
      },
      {
        id: 'world-hud',
        title: 'The HUD lives in the world: caller portrait on the phone, pain on the screen edges with a heartbeat, no health bar outside combat, use prompts over the object with a touch glyph, no control hints in objective text',
        description: 'Starts level 1. Checks the health bar is not displayed (not a combat level) and the objective text carries no control hint. Voss rings: answers (Answer button tap on phone, F on desktop) and checks the phone shows the caller portrait (#phonePortrait, loaded, 40 px or more) and name, and that every reply bubble is 44 px or more (tapped on phone). Hurts Pierce with the hurt shortcut: the pain vignette must rise above 0.3 and a heartbeat must play inside 4 s, and the health bar stays hidden. Then walks to the coffee machine: the use prompt must show within 0.3 s of the action turning live, name the object, show E (desktop) or the touch glyph (phone) and sit on screen. Metrics: portraitPx, replyBubbleMinHeight, painVignette, heartbeats, usePromptMs. Options: phone (390x844 touch).',
        seconds: 240,
        tags: ['ui', 'phone'],
      },
      { id: 'full', title: 'Levels 1–8 in order, cutscenes included (long rides skipped after 16 s); Level 7\'s card Continues into The Morning', seconds: 1400, tags: ['full'] },
      {
        id: 'first-five',
        title: 'First five: Tap to play goes straight into a playable B3 hall (flashlight on, creature on screen), then "Six hours earlier." and the title; a save cookie opens on the title',
        description: 'Cold page, nothing set up. Taps Tap to play and times: first input (the left stick on a phone, W on desktop moves Pierce, 10 s or less), the creature on screen (45 s or less), the words on screen in the first minute (15 or less), the flashlight on at the first frame, no objective or menu text, and on a touch layout that no control box overlaps the lit doorway. Resets the frame trace once in control and fails on any post-grace frame over 100 ms (hitchFailOver100); expects a warm event (corridor, creature, creature SFX under Tap to play). On phone (390x844) also checks no horizontal scroll and every visible control ≥ 44 px. The cut to black, the one-line card and the title terminal follow. With options {"returning":true} it writes a save cookie, reloads, and checks the title opens with no cold open. Metrics: secondsToFirstInput, secondsToFirstThreat, wordsOnScreen60s, coldOpenSeconds, titleSeconds, doorwayOverlaps, hitchFailOver100, coldWarmMs. Options: phone (390x844 touch layout), returning.',
        seconds: 120,
        tags: ['ftue', 'first-minute', 'perf'],
      },
      {
        id: 'sound-settings',
        title: 'Tap to play unlocks sound, Settings from the title and from Pause, a setting that survives a reload',
        description: 'Shows the Tap to play prompt, taps it with a pointer press on the spot (hit-tested, so a covered prompt fails) and checks the AudioContext is running. Opens Settings from the title, turns Sound off and Music to 40%, reloads the page (the run carries on after the reload through ?playtest=sound-settings), checks the prompt and the saved choice are back, then opens Settings again from Pause in level 1. The player\'s own hawkes.sound is put back at the end.',
        seconds: 120,
        tags: ['menus', 'sound'],
      },
      {
        id: 'cutscene-ui',
        title: 'Cinematic HUD/letterbox/Skip clear of health; Settings invert Y, sensitivity and subtitles persist; phone layouts',
        description: 'Opens Settings from the title: checks Invert camera Y, mouse and touch sensitivity, Subtitles, subtitle size and box are present and fit at 390x844. Turns Invert on, mouse sens to 1.5×, subtitle size Large, reloads and checks they survive. Starts level 1, walks to the board Join meeting: during the cutscene health, Pause and the objective marker are hidden, letterbox is up, Skip sits bottom-right and overlaps nothing at 1280×720, 844×390 and 390×844 (touch sticks hidden). Skips, then opens level 7 and 8 openings and checks the same HUD fade. Captions stay one line.',
        seconds: 360,
        tags: ['menus', 'ui'],
      },
      {
        id: 'spatial-audio',
        title: 'Rooms sound like their size, walls muffle, sound is placed (390x844 touch with options.phone)',
        description: 'Level 1: a sound is placed to the listener\'s left, right and front and the master\'s left/right channels are read back (left must be louder for left). A voice is then placed at the boardroom table and Pierce walks the hall: while the boardroom door is shut the source must report occluded with a low cutoff, and when he reaches the door it must open and the cutoff must clear above 10 kHz inside 0.5 s of audio time (acoustics.clears). Then levels 2 to 8 are entered and the reverb zone types seen are collected: at least 8 different (hall, boardroom, elevator, tunnel, vat, lobby, street, station, train, apartment). It reports the panning model (HRTF on desktop, equalpower with options.phone, which walks with the left stick), the master loudness (target -16 LUFS), limiter reduction and audio dropouts (must be 0). Metrics: acousticZones, acousticDoorClearMs, acousticLeftRight, acousticLufs, acousticDropouts.',
        seconds: 600,
        tags: ['sound'],
      },
      {
        id: 'feel-audio',
        title: 'Each level has its own bed, a strike gives sound and a screen pulse, volume sliders persist',
        description: 'Starts levels 1 to 8 directly (setup) and logs the music bed each one plays. On level 6 it walks and checks the footstep loop starts and stops, clicks (Punch) and checks the action pulse fired, then opens Pause > Settings, slides Music and Effects and checks hawkes.sound saved both.',
        seconds: 200,
        tags: ['sound'],
      },
      {
        id: 'layered-ambience',
        title: 'Each chapter plays a base bed plus 6+ positioned spot one-shots; Station and Train PA each hit 4+ lines; bed within 1 s on phone',
        description: 'Starts levels 1-8 directly (setup). On each chapter it waits for the music bed within 1 s, walks for up to 120 s through real input, and requires at least 6 distinct layered ambience spots (probe.sound().ambience) with no silence over 10 s outside scripted cutscenes. On levels 6 and 7 it also counts distinct Platform PA / Conductor lines (subtitle speaker) and requires 4+. With options.phone it lays out 390x844 touch and drives the left stick only; low-tier maxLive must stay at most 4. Metrics: ambienceSpotsL<n>, ambienceBedMsL<n>, ambienceSilenceMaxL<n>, stationPaDistinct, trainPaDistinct, ambienceMaxLive.',
        seconds: 1200,
        tags: ['sound', 'phone'],
      },
      {
        id: 'music-director',
        title: 'The score answers the game: a state change in every chapter, ducking under voice, stingers on their beats, Music 0% silences it',
        description: 'Starts levels 1 to 8 directly and logs each chapter\'s music state changes, stems loaded (streamed on the phone tier), duck depth and stinger events from the music director. On level 1 it drops Settings Music to 0 through the real slider and checks the bus is silent, then puts it back. Run it at 390x844 touch for the phone check.',
        seconds: 150,
        tags: ['sound'],
      },
      {
        id: 'ui-style',
        title: 'Menu, HUD, pause, settings and end cards share fonts and colours, nothing is clipped, and no touch control overlaps another or is under 44 px at 390x844, 844x390 and 667x375',
        description: 'Visits the title card, Settings, the level 1 HUD, Pause, Pause Settings and the Defeat card (test shortcut), once at the real viewport and once laid out as a 390x844 phone. On each screen it lists the fonts and the accent colour in use, reports any visible text in a font outside the house set (Barlow Condensed, Cormorant Garamond, the mono face) and any text that is clipped or leaves the screen. On the phone layout it then lays the page out at 390x844, 844x390 and 667x375, shows every conditional touch control (Interact, ability, shadow, lost, reload), and fails if any two touch controls overlap, any is under 44 px, or any leaves the safe area.',
        seconds: 170,
        tags: ['menus'],
      },
      {
        id: 'title-scene',
        title: 'The title menu sits over a live rain-soaked office with Pierce at the window; a Shadow reflection flash within 30 s; menu sounds; Reset lives in Settings (options.phone: 390x844 touch)',
        description: 'Opens on the title (after Tap to play). Checks the title scene is live (camera inside the office, rain on the glass with its clock advancing, Pierce at the window, the theme playing), waits for the lightning flash and the Shadow-form reflection (within 30 s, with its sting), checks Reset is not on the main menu, every menu button is at least 44 px tall and inside the viewport, then hovers and presses buttons and checks a menu sound starts each time (select plays, back plays), and finds Reset in Settings behind a confirm (Keep it, never Erase). With options {"phone":true} it lays the page out as a 390x844 touch phone and plays it by tap only. Metrics: titleFlashSeconds, titleReflectionMs, titleMenuSounds, titleMinButtonPx.',
        seconds: 90,
        tags: ['menus', 'ui', 'title'],
      },
      {
        id: 'screen-mode',
        title: 'Turn your phone sideways in portrait (dismissable), Start asks for fullscreen and the landscape lock, Pause has a Fullscreen switch, desktop is unchanged',
        description: 'Desktop first: no portrait prompt, the Pause card has no effect on play. Then lays the page out as a 390x844 touch phone (setup): the "Turn your phone sideways" screen fills the viewport over the title card. Turns the phone to 844x390 (the screen goes), back to portrait (it returns), then taps "Play in portrait anyway" (it goes and stays away). Presses Start on the touch layout and logs whether fullscreen and the landscape lock were asked for and what the browser did (headless browsers may refuse; that is not a failure). Opens Pause, checks the Fullscreen switch is there and taps it twice.',
        seconds: 90,
        tags: ['menus', 'ui'],
      },
      {
        id: 'objective-marker',
        title: 'The objective waypoint shows name and distance, clamps to the screen edge with an arrow, hides in scenes and menus, and stays clear of the touch controls',
        description: 'Level 1 at the real viewport, then laid out as 390x844 and 844x390 phones. Waits for control, checks the waypoint shows the live objective name and its distance, then turns the camera with touch drags until the waypoint is on screen and until it is clamped to the edge with an arrow. On every step it checks the box stays inside the screen and clear of the sticks, buttons and Pause. Opens Pause (hidden), then walks to the board seat and starts the board scene (hidden), and finally downs Pierce for the Defeat card (hidden).',
        seconds: 240,
        tags: ['hud'],
      },
      {
        id: 'load-error',
        title: "A level that fails to load shows Couldn't start the game and Retry; Retry reloads to START",
        description: 'Checks a normal load reaches the START card with no error. Then makes the next level load fail (setup; options.fail "hang" (default) never finishes, so the stall timeout (20 s with nothing loading) shows, "error" fails at once), presses Start, and times the error card with its Retry button. Presses Retry: the page really reloads (the run carries on after it through ?playtest=load-error), and the title card reaches START again; Start enters level 1.',
        seconds: 90,
        tags: ['menus'],
      },
      {
        id: 'phone-b3',
        title: 'Phone title card and buttons, About beat 01, then B3 with the creature downed before decon',
        description: 'On a desktop viewport the page is laid out as a 390x844 phone for the title and button checks. Then the About page shows in an overlay, then level 2: stand still for the way hints, shoot it from the lab before entering decon, and finish the level.',
        seconds: 260,
        tags: ['menus'],
      },
      {
        id: 'transition',
        title: 'Chapter card to world: card held until the world has rendered, crossfade, HUD only after; no black frames (levels 1-8, desktop and 844x390)',
        description: 'Level 1 on desktop starts with the real Start button (the live smoke path); levels 2-8 and the phone pass use the setup shortcut. While the chapter card is up it samples the world canvas every tick: pause/HUD must stay hidden, and once the level is running the card must not leave until the canvas is more than 3% non-black. After the card lifts it samples a few more frames and fails on a mostly-black frame or on HUD over black. Metrics: transitionSamples. Problems: black frame under/after the card, HUD over the card or over black.',
        seconds: 600,
        tags: ['level', 'ui'],
      },
      {
        id: 'chapter-openings',
        title: 'Chapter openings: 8 in-engine title shots with a sting, skip within 0.5 s, handover to the player camera without a cut (options.phone: 390x844 touch)',
        description: 'Each level 1-8 (test shortcut, as Continue does) opens on a moving shot of its place with the chapter title typeset over it. The bot waits for the shot, checks the camera moves (position or pan), the title is faded in and sits inside the viewport, the Skip button is at least 44 px and inside the viewport, a sting was played, and the world is not black. It then presses skip (a tap on the Skip button with options.phone, Space on desktop): the shot must end within 500 ms and the lens glide into the follow camera must show no black frame. Levels 1 and 6 are also played without a press to check the natural handover. The camera detector runs over every shot and glide and must report 0 frames inside geometry (the opening reports its own count too). Metrics: openingsSeen, openingSkipMs, openingInsideFrames, openingBlackFrames, openingMovedMin. Options: phone.',
        seconds: 600,
        tags: ['level', 'ui'],
      },
      {
        id: 'chapters',
        title: 'Chapter title cards: levels 1 to 8 each open on their own card; one press skips it; no placeholder text',
        description: 'Opens level 1 with the Start button, then levels 2 to 8 (test shortcut, as Continue does). Each level must open on a chapter title card (Chapter N, the level name, one story line). The bot logs the card, checks it is not a copy of an earlier card and shows no placeholder text (raw ids, {braces}, undefined, TODO, lorem), waits for it to be fully up, presses one key (Space) and checks the card begins closing at once and lifts within the ready cap (~10 s) once the world has painted. Metrics: chapterCards, chapterSkipSeconds. Problems: no card, a duplicate card, placeholder text, a card that needs more than one press.',
        seconds: 420,
        tags: ['level', 'ui'],
      },
      {
        id: 'context-loss',
        title: 'Level 1: lose the WebGL context, Recovering shows, the level resumes; memory tier and level change counts',
        description: 'Reports the memory tier and texture cap (state().graphics: tier, deviceMemory, textureCap, maxTextureSize; ?memory=low forces the low tier). Starts level 1 with the Start button, gets control, walks (real keys). Then loses the WebGL context with WEBGL_lose_context: the Recovering overlay must show, the context is restored, the overlay must go within 15 s with no load-error card, and Pierce must walk again (real keys). Then level 1 to level 2 and back (test shortcut, as Continue does): the scene counts (meshes, materials, textures, animation groups) are logged at each stop and must not grow once level 1 is back, so the previous level was freed. Metrics: textureCap, maxTextureSize, recoverSeconds, level1Meshes, level2Meshes, level1Textures, level2Textures, level1Again*.',
        seconds: 300,
        tags: ['graphics', 'level'],
      },
      {
        id: 'b3-retry',
        title: 'B3: die and press Start five times; meshes, materials, textures, skeletons, clips and lights stay flat',
        description: `Starts level 2 (test shortcut), waits for the scene to settle and reads the scene counts (also in hawkesPlaytest.state().counts). Then ${RETRIES} times: Pierce is downed (test shortcut, as a bite would), Defeat shows, Start retries the level, the scene settles, and the counts are read again. Metrics: each count after the first retry and after the last, and their growth. A count that keeps growing across retries is a bug. Headless WebGL is about 1 fps, so each stage reports progress.`,
        seconds: 420,
        tags: ['level', 'perf'],
      },
      {
        id: 'vat-acid',
        title: 'B3: a hunt death costs under 3 s with no card; the vat break is played with the left stick (390x844 touch)',
        description: 'Starts level 2 (test shortcut) and the hunt from the lab door. Pierce is downed (test shortcut, as a bite would): there must be no Defeat card, chapter card or reload, a red fade of about 0.6 s, control back inside 3 s (metrics huntRetries, retrySeconds), health full, and the creature out of sight. Then the vat break shot plays (it must end within 5.5 s, no camera hold over 5 s) and control returns in the acid. Laid out as a 390x844 phone, the bot plays the acid with the left stick only (pointer drags, no keys): it logs the input lag, heading drift, stagger and the falls, the flashlight failing, checks the touch controls stay visible and 44 px, that there is at least 15 s of movement input, that the avatar swaps during a fall, and that it ends as Pierce reaches the door and End Level is offered. Metrics: acidSeconds, acidInputSeconds, huntRetries, retrySeconds.',
        seconds: 300,
        tags: ['level', 'phone'],
      },
      {
        id: 'rain-city',
        title: 'Rain-slick city night: Going Home neon + wet puddles + rain splashes, Station open-end rain, Train tunnel lamps ≤3 s (options.phone: 390x844 Low ≥30 fps)',
        description: 'Starts Going Home at the street (test shortcut, skips lobby). Walks east along the sidewalk through real input (~25 s), checks rainNight(): ≥8 lit neon signs, rain + ground splashes, planar/probe/SSR wet reflections, steam vents, headlight flares. Then The Station: open-end rain and sodium platform lights. Then The Train: tunnel lampPeriodSec ≤ 3 while moving, fluorescent flicker. Options.phone: 390x844 touch, Low graphics on the street, reports phone.fpsP5 ≥ 30. Metrics: neonSigns, rainParticles, puddles, reflectionMode, stationRain, lampPeriodSec, streetFps. Probe: rainNight(), train().',
        seconds: 240,
        tags: ['level', 'feel', 'phone', 'quality'],
      },
      {
        id: 'b3-horror-light',
        title: 'B3 horror lighting: flashlight beam and moving shadows, vat green on walls, dark corridors, landmarks (options.phone: 390x844 Low tier ≥30 fps)',
        description: 'Starts level 2 (test shortcut). Turns the flashlight on with G (or the Flashlight touch button on phone), walks the long hall toward the lab for about 30 s through real input, and checks: the beam cone is on, flashlight shadows cast from at least 3 objects, the vat lights at least 2 nearby walls, fog is exp2 so corridor ends stay dark, and at least 3 light landmarks (EXIT signs / practicals / vat) mark the route. Options.phone: 390x844 touch, Low graphics, reports fpsP5 ≥ 30 with beam and fog on. Metrics: b3ShadowCasters, b3VatWalls, b3Landmarks, b3Fps, b3FogMode. Probe: b3Horror().',
        seconds: 120,
        tags: ['level', 'feel', 'phone'],
      },
      {
        id: 'quiet-light',
        title: 'Quiet chapters light: Morning sun shafts + TV spill, Desk lamp long shadows + mirror text, Return buzzing tube (options.phone: 390x844 Low shafts ≥30 fps)',
        description: 'Plays The Morning (test shortcut): skips S0/S1, walks to the bed and presses Sleep (E / Interact), waits for dawn, checks sun shafts and dust (quietLight().sunShafts), walks to the TV and presses Watch, checks TV spill on walls/Pierce (tvSpill). Then The Desk: checks the desk lamp is the key light with long shadows, walks to the bathroom mirror and checks the vanity HAWKES plaque has no negative scale (mirrorTextOk) while MirrorTexture reverses it. Then The Return: checks one fluorescent tube buzzes under the clinical wash. Options.phone: 390x844 touch, Low graphics, Morning only, reports phone.fpsP5 ≥ 30 with shaft meshes. Metrics: morningShafts, tvSpill, deskLamp, mirrorTextOk, returnBuzz, morningFps. Probe: quietLight().',
        seconds: 420,
        tags: ['level', 'feel', 'phone', 'quality'],
      },
      {
        id: 'ledger-city',
        title: 'The ledger: kills on the street bring sirens and a police car, and change The Morning (TV report, newspaper headline, Voss call)',
        description: 'Starts Going Home (skips the lobby), hands over Shadow Shock with the probe\'s grantShock setup shortcut, turns Shadow on and drops three bystanders by tapping the fire button (touch: stick drags and taps with options.phone). Checks the siren starts at the second kill and the police car stops beside him within 20 s. Then plays The Morning twice, once with the 3-kill ledger and once with none: it watches the TV, taps Read the paper at the coffee table and answers Voss by tap. The TV report, the newspaper headline and Voss\'s lines must differ; captions must be at least 13 px and on screen at 390x844. Metrics: ledgerKills, ledgerWitnesses, sirenToCarSeconds, vossLinesDiffering, captionMinPx. Options: phone.',
        seconds: 900,
        tags: ['level', 'phone', 'story'],
      },
      {
        id: 'street-powers',
        title: 'Going Home: each power arrives alone (Shadow, Shock, Possess, Consume, then Punch/Kick), taught by a context prompt, played with taps (390x844 touch with options.phone)',
        description: 'Starts Going Home (test shortcut), skips the lobby and plays the street by real input: the bot reads no objective text, it follows the context prompt. Shadow on its own button, walks through the crowd until people lose him; the police pair (Shock, one tap on the fire button); the taped sidewalk (Possess the guard, walk him to the tape); the station guard (Possess, then a second tap to Consume); and Punch/Kick only after he drops Shadow and is shoved. Logs each introduction step with its street setup and time (power-step events). Checks: introductions in order Shadow, Shock, Possess, Consume, Punch/Kick; at least 30 s between new controls; each power first used at a street setup; Punch/Kick only after an unshadowed shove; every objective.home.* line is 8 words or fewer; every context prompt is 4 words or fewer, on screen and clear of other controls, and each power\'s first use lands on one tap. Phone: taps and stick drags only.',
        seconds: 480,
        tags: ['level', 'phone', 'story'],
      },
      {
        id: 'crowd-shadow',
        title: 'Shadow in a crowd: pedestrians notice, scream, film and cower in many voices (Going Home; phone 390x844 ≥30 fps)',
        description: 'Starts Going Home (test shortcut), skips the lobby, walks into the sidewalk crowd and turns Shadow on through the Shadow button (phone: taps and stick drags only). Within 2 s at least 3 pedestrians must react with a voiced line and a visible animation; the run must hear 6+ different voices among street reactions; no reaction line repeats back-to-back across 10 reactions; at least one pedestrian raises a lit phone to film Pierce. Metrics: crowdWithin2s, crowdVoices, crowdFilmers, crowdWitnesses, crowdRepeats, phone.fpsP5. Probe: crowd().',
        seconds: 240,
        tags: ['level', 'phone', 'story', 'quality'],
      },
      {
        id: 'desk-beats',
        title: 'The Desk: the mirror is walked up to (no prompt; the reflection lags 0 to 0.5 s and turns its head first) and the desk is cleared by a held drag (390x844 touch with options.phone)',
        description: 'Starts The Desk (test shortcut). There must be no "Look in mirror" prompt at any time. Pierce is walked with the left stick (phone: pointer drags on the stick; desktop: keys) to the glass and back and forth while the camera holds its over-the-shoulder frame: the reflection\'s lag must reach about 0.5 s, it must turn its head once before he does, the hum drops out and "That\'s me" plays. He then walks to the desk. Phone: one finger swipes across the desk (desktop: a mouse drag). A slow short drag moves a few sheets, a hard long drag sends more props off (papers, folder, glass, terminal) and logs paper and impact sound events; then "I\'m going home" and End Level. Camera detector: 0 frames inside geometry. Metrics: mirrorMaxLagMs, headTurns, propsOffGentle, propsOffHard, sweepSounds, cameraInside.',
        seconds: 360,
        tags: ['level', 'phone'],
      },
      {
        id: 'scenes-no-skip',
        title: 'The Desk with no input and no Skip: the mirror starts by itself, the walk, the desk and the going-home line all end on their own',
        description: 'Starts The Desk (test shortcut) and then touches nothing: no keys, no stick, no drag, no Skip. The mirror beat must engage by itself (about 5 s), play to "That\'s me" (by about 30 s), the walk to the desk must hand over by itself (45 s cap), the papers must be on the desk and drawn when the desk scene starts, Pierce must be in idle (not the walk clip) while the scene holds him, and the scene must end with the End Level card within 150 s. Metrics: deskMirrorSeconds, deskSceneSeconds, deskTotalSeconds. Problems: a beat that never ends, a walk clip while standing, papers missing.',
        seconds: 240,
        tags: ['level', 'story'],
      },
      {
        id: 'scene-audit',
        title: 'Every scripted scene, hands off: the lobby, the station platform, the train opening and stop, the morning — no Skip, no input',
        description: 'Starts levels 5, 6, 7 and 8 directly (test shortcuts) and touches nothing: no keys, no stick, no Skip. Each scene that starts (probe.scripted() or a timeline cutscene) is timed and audited every frame: the walk clip playing with no movement (walking in place), movement with no walk clip (sliding), and the props the scene refers to (SCENE_PROPS). A scene that runs past its limit is a bug and is then skipped so the run can go on. Metrics per scene: scene:<id>:walkInPlaceFrames, scene:<id>:slideFrames, cutscene:<id> (seconds); events scene-audit. Options: level (one level number only).',
        seconds: 600,
        tags: ['level', 'story', 'quality'],
      },
      {
        id: 'analytics',
        title: 'Hawkes Analytics: level 1 played to its card, the events going out (debug log), the feedback card after the level',
        description: 'Reloads once with ?hawkes-analytics-debug=1 when the page was opened without it (the run carries on through ?playtest=analytics). Logs the build, env and product the SDK reports, then plays level 1 as level-1 does and logs each analytics event as it is made and sent (game_ready, screen, level_start, progress, video, feature, death, level_end, stuck, feedback). After the Level Complete card it checks the feedback card ("How was level 1…?") is on screen. Problems: no build, a standard event missing, no feedback card.',
        seconds: 360,
        tags: ['level', 'analytics'],
      },
      {
        id: 'living-places',
        title: 'The 58th floor, the station and the train lived in: board plot through the hall, footsteps, people on routines, touchables',
        description: 'Enters level 1, the station (level 6) and the train (test shortcuts), skips scripted openings. On Apex Peak it does not need the Voss call: it walks past the desk person (board-desk), tries the locked IN SESSION door (board-door), and walks the hall until the Hale silhouette flinch fires (board-threat). Then it checks art cohesion: HUD action buttons use the title-card gold/navy palette (no cyan or coral orange), and the hallway grade leans navy (cool hemi ground, fog and practicals). Then in each place it walks to every touchable and presses Interact through real input, logging the motion and sound each answered with and whether the Interact button was shown. Logs the people on routines and who glanced at Pierce, counts footsteps (one per foot plant, 3+ variants, never the same twice in a row), and reports quality.maxQuietSeconds per place (≤ 10). options.phone: true lays the page out as a 390x844 touch phone and requires the Interact button at each touchable; heapMB is reported; no horizontal scroll and 44 px targets.',
        seconds: 480,
        tags: ['level', 'quality', 'story', 'sound', 'phone'],
      },
      {
        id: 'apex-slice',
        title: 'Apex Peak vertical slice: hall life, cleaner, sofa, papers, valuation screen; quality.maxQuietSeconds and quality.textOnlyBeats',
        description: 'Starts level 1 (test shortcut). Answers Voss, walks hall 2 (expects the night cleaner or her cart and a troffer flicker), then the office: Sit on the sofa, Read papers, Tap screen on the boardroom valuation chart. Logs each interaction as an action event. Reports quality.maxQuietSeconds (must be ≤ 10) and quality.textOnlyBeats (must be 0 when clips exist; silent placeholders count until Gen takes land). Also reports feel.coyoteMs. Ends once the three interactions and the cleaner beat have been seen, or after walking the board seat.',
        seconds: 240,
        tags: ['level', 'quality', 'story'],
      },
      {
        id: 'train',
        title: 'Level 7: the subway car. Seats, poles, ads, tunnel lights, sway; seats and poles block; listed on Load Level; fps vs The Station',
        description: 'Checks Load Level lists level 7, The Train. Starts The Station (test shortcut), skips its opening scene and samples the frame rate for 8 s standing still. Then enters level 7 (test shortcut, as ?beat=train): logs what the car is made of (benches, poles, ads, windows), turns to the north windows and counts the tunnel lamps going past and the sway (camera roll) for 5 s, samples the frame rate the same way, then walks into the north bench, the south bench and a center pole (real input; each logs how close Pierce got), and walks the length of the car to the front end door. Metrics: fpsStation, fpsTrain, lampsPerSecond, swayDegrees, carWalkMeters. Problems: level 7 missing from Load Level, a missing part of the car, no lamps moving, no sway, Pierce inside a seat or a pole, train fps more than 10% under the station.',
        seconds: 200,
        tags: ['level', 'perf'],
      },
      {
        id: 'level-8',
        title: 'Level 8, The Morning: the 7 scenes in order (ride, walk up, threshold), bed, the wake-up, the news naming Hawkes Tower and Pierce, Voss\'s call in full, the door, End Level',
        description: 'Starts level 8 (test shortcut); S0 the train ride and S1 the walk up play first (barks "Mine." and "Three blocks…"), then it plays with real input: walks to the bed and presses E (Sleep); the scene fades to black, Pierce lies in the bed and wakes (checks he lies in the bed, "I slept." is heard); walks to the television and presses E (Watch): the morning news plays on the canvas TV (checks the TV showed HAWKES TOWER and PIERCE HAWKES and the captions name them); Voss rings, the bot answers with F and checks all seven of his lines play in order; walks to the front door and presses E (Leave), then End Level. Checks the end song and the level 8 credits, and that the card is Exit only. Metric: morningSeconds. Lines use silent placeholder clips until the voice is generated.',
        seconds: 240,
        tags: ['level', 'story'],
      },
      {
        id: 'world-events',
        title: 'Levels 1, 3, 5, 6 and 8: each chapter ends on one in-world event under 8 s (voice and SFX), Skip works, HUD and touch controls fade, one caption line, the end card crawls at most 3 lines',
        description: 'Plays levels 1, 3, 5 and 6 as level-N does (laid out as a 390x844 touch phone unless options.phone is false), then level 8. When End Level is pressed the chapter\'s ending event (cutscenes/finale-N.json: the board hush in the cab, the practicals coming on, the tower going dark, the departure board flipping, the TV report) must start; the bot logs it (world-event), checks it is under 8 s, that body.cinematic hides the HUD and touch controls, that the caption is one line, presses Skip, and counts the lines the Level Complete card crawls (at most 3). Lines use silent placeholder clips until Hawkes Gen makes the voices.',
        seconds: 1500,
        tags: ['level', 'story'],
      },
      {
        id: 'level-8-ending',
        title: "Level 8's ending on a 390x844 phone: walk to the door by touch (camera push-in, Shadow form in the mirror), coat and closing line, white dawn, black, PH ORIGINS, credits over 6+ places, the voiced Act II call, the end card with a tappable link, Skip on a second run",
        description: 'Starts level 8 (test shortcut) and jumps to the walk after Voss\'s call. With the touch stick only: walks to the coat (checks the camera pushes in and the hall mirror shows the Shadow form), taps Take coat (the closing line), walks to the door, taps Leave. Then checks the white-out, the cut to black, the PH ORIGINS title, the credits (names only, no text crawl, at least 6 distinct places, everything inside 390x844), the unknown caller\'s call, and the Act II is coming card (link to phorigins.com at least 44 px and hit-testable). A second run checks Skip shows after a first finish and goes to the card. Metrics: endingSeconds, creditPlaces.',
        seconds: 420,
        tags: ['level', 'story', 'phone'],
      },
      {
        id: 'level-8-release',
        title: 'The Train Continue enters The Morning; the whole of level 8 follows',
        description: 'Plays The Train (as level-7) to its card, checks Continue and Load Level list level 8, presses Continue and plays The Morning as level-8 does.',
        seconds: 520,
        tags: ['level'],
      },
      {
        id: 'level-7-release',
        title: 'The Station Continue enters The Train; End Level only after the story, then the station song and level 7 credits; Continue and Exit; Load Level lists it',
        description: 'Starts The Station (test shortcut), skips its opening, and plays to the Level Complete card. Checks Continue is on that card, checks Load Level\'s list includes Level 7: The Train as Play, and presses Continue. Level 7 must start. Plays the train through real input (opening, Next car, the stop, Hale, the door). End Level must not appear before the story\'s last beat. Pressing it plays ending-6 and rolls the level 7 credits (Preferred A Man, Went Uptown; not The Station\'s "Open On Nothing"). The card then shows Continue (into level 8, The Morning) and Exit.',
        seconds: 480,
        tags: ['level'],
      },
      {
        id: 'train-chase',
        title: 'The Train as a pursuit: no Next car prompt, the old body ahead through the end-door glass, riders in the aisle, lurches and stumbles, and car 3\'s doors closing a breath before Pierce (10 runs; 390x844 touch with options.phone)',
        description: 'Run 1 plays cars 1 to 3 from the opening (Skip) to the stop: walking into the front end door crosses to the next car with the fade and chime, and no "Next car" action is ever offered; in each car the old body is parked behind the end-door glass (story.oldBodyAhead) and at least one rider stands in the aisle; the car lurches and stumbles at the set points and Pierce stays under control. Then options.runs (default 10) runs of car 3 (test shortcut to start in car 3): skip the stop scene, walk to the door, and check the doors finish closing before Pierce touches them, the old body is on the platform at that moment, and Pierce ends within arm\'s reach (doorGap 0.1 to 1.1 m). options.phone: true lays the page out as 390x844 touch and drives the left stick with pointer drags only (shadow mode is a toggle on the Shadow button and is locked at the open door). Metrics: chaseRuns, chaseCaught0, chaseDoorGapMax, trainLurches, trainStumbles.',
        seconds: 600,
        tags: ['level', 'phone'],
      },
      {
        id: 'level-7',
        title: 'Level 7, The Train: the opening scene voiced and in order, Skip, the old body one car ahead, the stop, Shadow mode, the door, then the end song and credits',
        description: 'Starts level 7 (test shortcut, as ?beat=train) and lets the opening scene play: logs each subtitle with its speaker and checks the four opening lines come in order, that each spoken train line has a clip, and that the old body (the untransformed Pierce) is in the car and walks out through the front end door. Then starts the level again and presses Skip 3 s into the opening: control and the objective must be back within 2 s. Plays on with real input: walks to the objective marker, walks into the front end door (no prompt; the car changes with the fade), sees the old body one car ahead walk away; in car 2 turns Shadow mode on (C), checks the ability readout and Tab, shadow-runs a moment (Shift) and turns it off. In car 3 the train slows into a stop (platform in the windows), the stop scene plays: the door opens, he says "This is me", the commuter says "Night", and he steps out through the door facing away from Pierce (checks he never turns toward him). Answers Hale\'s call, walks to the open door (the end trigger), watches the doors close and presses End Level. End Level must be on the finished beat. The press plays ending-6, rolls the level 7 credits, and the card offers Continue (level 8) and Exit. Checks combat stays off (library row, no hostiles) and no missing clips. Metrics: trainOpeningSeconds, trainCars, trainSeconds.',
        seconds: 240,
        tags: ['level'],
      },
      {
        id: 'chapter-select',
        title: 'Chapter Select on the title menu: 8 painted cards, locked ones dimmed, best time and lore n of m, a card starts its chapter within 10 s, hidden lore pages raise n of m (options.phone: 390x844 touch)',
        description: 'Opens on the title (after Tap to play), taps Chapter Select and checks eight cards: art slot, title, and on each unlocked card its best time and "Lore n of m"; locked cards are dimmed and disabled. Every card must be at least 44 px tall and inside the viewport; the list must scroll by swipe (overflow auto, touch-action pan-y, more content than fits at 390x844). Hovering or focusing an unlocked card plays a short cue from its chapter\'s music. A tap on card 1 must start chapter 1 within 10 s. In the chapter the bot walks to each hidden lore page with real input; each one found shows its toast and raises the count on the save, and the card then reads the new n of m. Metrics: chapterCards, chapterStartSeconds, lorePagesFound, chapterCardMinPx. Options: phone.',
        seconds: 240,
        tags: ['menus', 'ui', 'level'],
      },
      {
        id: 'lore-link',
        title: 'Finish level 4 and unlock its lore entry, open its Read more page, check every lore page has Play this level',
        description: 'Starts The Desk (test shortcut) and plays it to the Level Complete card through real input. The card must show a "Lore unlocked" entry for chapter 4 (title, line) and a visible "Read more" link to lore/the-desk.html; the unlock is saved on the progress cookie. The linked page is then shown in an overlay and must carry a visible "Play this level" link whose href is ?level=4. Finally every lore page (eight) is loaded and checked for its own Play this level link (?level=N) and the lore index lists all eight. Problems: no lore entry on the card, no Read more, Read more not pointing at the site, a lore page with no Play this level link.',
        seconds: 200,
        tags: ['level', 'site'],
      },
      {
        id: 'site-links',
        title: 'Powered by HAWKES GEN on every site page, Hawkes Biomedical on Home, About lists levels 1-7 playable, the game screen unchanged',
        description: 'Taps to play, then shows Home, About, Characters and What\'s new in an overlay one after another. On About it first scrolls to "What you can play" and checks a Playable card for each of levels 1-7 (outlined gold, red when wrong), and that the "still being built out" line is gone. Then it scrolls each page to its footer and checks a visible "Powered by HAWKES GEN" link to https://hawkesgen.ai (outlined in gold), plus a Hawkes Biomedical link to https://hawkesbiomedical.com on Home. Then checks the game page itself carries no credit link.',
        seconds: 60,
        tags: ['menus', 'site'],
      },
      {
        id: 'frame-trace',
        title: 'Frame-time trace on all eight levels (desktop and phone): hitch counts, worst causes, no post-grace frame over 100 ms',
        description: 'For each of levels 1–8: starts the level directly (setup / setupHidden for The Train), waits out the first-second grace, plays a few seconds through real input, and logs hitchOver50 / hitchOver100 / the worst hitches with a named cause into the report. Then repeats at phone size (390x844 via phoneFrame). A frame over 100 ms after the first second (outside level setup) fails. Metrics: hitchOver50, hitchOver100, hitchWorstMs, and per-level hitchL{n}WorstMs / hitchL{n}Cause. report().frameTrace carries the summary.',
        seconds: 420,
        tags: ['smoke', 'perf'],
      },
      {
        id: 'graphics',
        title: 'Rendering pipeline: Graphics Low / Medium / High in Settings switch within 1 s; all 8 chapters show shadows, AO, bloom and their own grade; Level 1 fps',
        description: 'Opens Settings from the title and checks the Graphics row (Low / Medium / High, each 44 px or more, the live tier checked). Starts level 1, walks a few steps, then opens Pause > Settings and picks Low, Medium and High in turn: each must reach the pipeline (tier, cascades, shadow map size, SSAO, render scale) within 1 s (metric graphicsSwitchMs). On High it samples the frame rate standing in the hall for 6 s (metric fpsL1High, 45 or more). Then each chapter 1-8 starts directly (test shortcut), its opening is skipped, Pierce walks a few steps and stands, and the frame is held for the footage (scene "Chapter n"): the pipeline must report ACES, bloom, the chapter\'s own LUT loaded, shadows on with casters in range, and SSAO on High. The mean colour of each finished frame is logged (grade-fingerprint) and the number of distinct grades is counted (metric distinctGrades, 5 or more). Option phone: lays the page out as a 390x844 touch phone, taps Low in Settings, walks level 1 with the left stick and checks the low tier keeps ACES, the LUT, bloom and one shadow cascade without SSAO at 30 fps or more (metric fpsL1Low).',
        seconds: 600,
        tags: ['render', 'perf', 'menus'],
      },
      {
        id: 'model-audit',
        title: 'Mesh audit on the live scenes of levels 1 and 8: no mirrored nodes, no NaN or zero normals, no stretched skinned vertices, a screenshot of each',
        description: 'Starts level 1 and level 8 directly, walks a moment, then audits every enabled mesh the game loaded (characters and props): world matrix determinant (mirrors), NaN or zero-length normals and positions, skinned meshes bound to a skeleton with weights summing to 1. Logs model-audit events and a model-shot screenshot per level (Pierce and the board in level 1). Any finding is a bug.',
        seconds: 150,
        tags: ['level', 'quality'],
      },
      {
        id: 'human-pierce',
        title: 'The new human Pierce (Hawkes Gen suit model) in levels 1, 3, 4, 6 and 7: which body each level shows, feet on the floor, no folded or stretched skin in walk, run, sit and phone poses; phone: level 1 from the chapter card within 8 s',
        description: 'Desktop: starts levels 1, 3, 4, 6 and 7 directly (test shortcut; level 1 with Start). Finds every character whose material is the new Pierce (pierce-suit) and logs pierce-body per level: the player in level 1, the old body on the Station platform (level 6, its opening scene) and in the train car (level 7, its opening), the transformed body by canon in levels 3 and 4. For each new-Pierce body it measures the floor gap under the feet (skinned bounds against the floor straight below; more than 2 cm floating or 5 cm sunk is a bug) and takes a pierce-shot screenshot. In level 1 it walks Pierce forward, raises the phone (G) and takes shots, then pauses the game and scrubs the Idle, Walk, Run, SitIdle, PistolIdle and phone (Idle with the hand up is the phone overlay) clips frame by frame at a quarter speed on the paused body: every skinned triangle is compared with its rest shape carried by its main bone, and a face turned inside out (folded) or an edge stretched past 2.5x counts. Over 1% folded or 0.5% stretched in a clip is a bug (metrics pierceFold<clip>, pierceStretch<clip>). Option phone: a 390x844 touch layout, Start tapped, the seconds from the level 1 chapter card to control (metric pierceL1CardToControl, 8 or less), the pierce.glb download size (metric pierceGlbMB, 4 or less) and the memory tier.',
        seconds: 420,
        tags: ['level', 'quality', 'characters'],
      },
      {
        id: 'hitch-board',
        title: 'Level 1 spawn to board table with named hitch causes; phone sample of levels 1, 4 and 8',
        description: 'Starts level 1 with Start (chapter card up while first-use warm runs and awaits audio decode), logs the warm event, resets the frame trace once Pierce can walk, answers the late Voss call, walks to the board seat and starts the board cutscene through real input. Fails on any post-grace frame over 100 ms (desktop). Then samples levels 1, 4 and 8 at phone size (390x844): each starts directly, resets the trace after control, walks a few seconds, and fails on any hitch over 150 ms. Metrics: hitchOver50 / hitchOver100 / hitchFailOver100 / hitchWorstMs, chapterWarmMs, hitchL1/4/8PhoneWorstMs. Events: warm, call, action, hitch, hitch-level.',
        seconds: 240,
        tags: ['smoke', 'perf', 'level'],
      },
      {
        id: 'board-faces',
        title: 'Board meeting faces: lip sync, blinks, head look-at and three dialogue gestures',
        description: 'Starts level 1 (test shortcut), answers Voss, walks to the head chair and presses Join meeting through real input. During room-for-grace it samples faces(): speaking mouths open with the voice, each seat blinks at least once every 6 s, heads turn toward the current speaker, and at least three different gesture ids play. Option phone: 390x844 touch layout; face updateMs must stay ≤ 2. Metrics: faceMouthEvents, faceBlinks, faceGestures, faceLookTurns, faceUpdateMs. Events: face-mouth, face-blink, face-look, face-gesture.',
        seconds: 180,
        tags: ['level', 'quality', 'characters'],
        starts: ['board'],
      },
      {
        id: 'pierce-loco',
        title: 'Pierce locomotion: start/stop/turn with planted feet under 3 cm slide; stairs/ramps in L1 and L5; phone half-tilt stride match',
        description: 'Desktop: level 1 start/stop then a standstill look-turn and W so turn-in-place holds translation; hall walk for steps; then a short walk on levels 2–8 (setupHidden for The Train) reporting footSlide.byLevel for every library id. Fails when a planted foot drifts over 0.03 m. Option phone: 390x844 touch only — left stick at half tilt (~0.5) must keep groundSpeed near half walk (~1.5 m/s) with stride rate matching. Metrics: footSlideMaxCm, footSlideMeanCm, footSlideL1Cm, footSlideL5Cm, footSlide.<libraryId>.cm, halfTiltSpeed, halfTiltRate. Events: loco-start, loco-stop, loco-turn, loco-phase, loco-stairs, loco-half-tilt, foot-slide-level.',
        seconds: 480,
        tags: ['level', 'quality', 'feel'],
      },
    ],
    // The splash is the first thing a player can act on, so a run may start while it is up (the contract's auto start
    // and a runner both wait on this). Each scenario taps it, then waits for probe.ready() itself.
    isReady: () => installed && (probe.ready() || probe.sound().prompt),
    stallSeconds: 75,
    // The feel sensor (hawkes-feel.js): Pierce's capsule while he's the player's to move; during cutscenes, scripted
    // openings and menus only frame hitches count. His position is the capsule's center, so the eye is just above it.
    // hitchMs 250 matches quality rule 7 (wall-clock feel is advisory; the 100 ms bar is hitchFailOver100 / frameTrace).
    feel: probe.feel ? {
      active: () => probe.running() && !probe.cutscene() && !probe.scripted() && !probe.menu().open,
      player: () => probe.feel!.collider,
      grounded: () => probe.feel!.grounded(),
      isSolid: (mesh: BABYLON.AbstractMesh) => probe.feel!.isSolid(mesh),
      headHeight: 0.15,
      thresholds: { hitchMs: 250 },
    } : undefined,
    input,
    stop: () => { token++; releaseAll(); },
    async start(id: string, options: RunOptions, t: Tracker) {
      const my = ++token;
      frameTrace.reset();
      // The game's own moments (main.ts `revealFromBlack`) write into this run's event log.
      (window as unknown as { __phEmit?: (type: string, detail?: unknown) => void }).__phEmit = (type, detail) => t.event(type, detail);
      const saved = snapshotSave();
      const watch = watchProblems(t);
      try {
        await run(id, options, t, my);
      } finally {
        delete (window as unknown as { __phEmit?: unknown }).__phEmit;
        watch();
        releaseAll();
        restoreSave(saved);
      }
    },
  });

  // state() also carries the scene counts, so a watcher sees a leak while a run is going.
  const baseState = api.state.bind(api);
  api.state = () => {
    let counts: SceneCounts | null = null;
    try { counts = probe.counts(); } catch { /* scene not up yet */ }
    let graphics: GraphicsInfo | null = null;
    try { graphics = probe.graphics(); } catch { /* scene not up yet */ }
    let frames: FrameTraceSummary | null = null;
    try { frames = probe.frames(); } catch { /* */ }
    return { ...baseState(), counts, graphics, frames };
  };

  // report() gains the hitch summary (counts over 50/100 ms, worst 5 with cause + level/objective).
  let lastCam: CamSummary | null = null;
  const baseReport = api.report.bind(api);
  api.report = () => {
    const report = baseReport();
    if (!report) return report;
    try {
      return { ...report, frameTrace: probe.frames(), cameraWatch: lastCam };
    } catch {
      return report;
    }
  };

  /** Publish hitch metrics and fail the run when a post-grace frame exceeded 100 ms. */
  const publishFrameTrace = (t: Tracker, label: string) => {
    const snap = frameTrace.summary();
    t.metric('hitchOver50', snap.over50);
    t.metric('hitchOver100', snap.over100);
    t.metric('hitchFailOver100', snap.failOver100);
    t.metric('hitchFrames', snap.frames);
    t.metric('hitchWorstMs', snap.worst[0]?.ms ?? 0);
    for (let i = 0; i < snap.worst.length; i += 1) {
      const h = snap.worst[i]!;
      t.event('hitch', `${h.ms}ms ${h.cause} L${h.level} ${h.objective || '—'}${h.detail ? ` (${h.detail})` : ''}`);
    }
    t.event('frame-trace', `${label}: ${snap.over50} over 50 ms, ${snap.over100} over 100 ms, fail ${snap.failOver100}; worst ${snap.worst.map((h) => `${h.ms}ms/${h.cause}`).join(', ') || 'none'}`);
    if (snap.failOver100 > 0) {
      const sample = snap.worst.find((h) => h.ms >= 100 && h.t >= 1) ?? snap.worst[0];
      t.problem(
        'bug',
        `${label}: ${snap.failOver100} frame${snap.failOver100 === 1 ? '' : 's'} over 100 ms after the first second`
          + (sample ? ` (worst ${sample.ms} ms, ${sample.cause}, L${sample.level}${sample.objective ? ` ${sample.objective}` : ''})` : ''),
      );
      return false;
    }
    return true;
  };

  // ------------------------------------------------------------ run

  const run = async (id: string, options: RunOptions, t: Tracker, my: number) => {
    const alive = () => { if (my !== token) throw new Error('playtest stopped'); };
    const frame = () => new Promise<void>((resolve) => {
      let done = false;
      const go = () => { if (!done) { done = true; resolve(); } };
      requestAnimationFrame(go);
      setTimeout(go, 60); // keeps going in a background tab
    }).then(alive);
    const sleep = async (ms: number) => {
      const until = performance.now() + ms;
      while (performance.now() < until) await frame();
    };
    const tap = async (key: string, label?: string) => {
      sendKey('keydown', key);
      await sleep(70);
      sendKey('keyup', key);
      t.add('interactions');
      if (label) t.log(`press ${key === ' ' ? 'Space' : key.toUpperCase()} (${label})`);
    };
    const press = (button: HTMLButtonElement, label: string) => {
      button.click();
      t.add('interactions');
      t.log(`click ${label}`);
    };
    /**
     * Chapters 1, 3, 5, 6 and 8 end on one in-world event (cutscenes/finale-N.json) when End Level is pressed:
     * it must play under 8 s with the cinematic HUD (touch controls and HUD hidden, one caption line), Skip must
     * work, and the card that follows may crawl at most three lines.
     */
    const observeFinale = async (level: number) => {
      if (![1, 3, 5, 6, 8].includes(level)) return;
      const doc = document;
      const started = performance.now();
      while (performance.now() - started < 5000 && !(probe.cutscene()?.id ?? '').startsWith('finale-')) await sleep(100);
      const scene = probe.cutscene();
      if (!scene || !scene.id.startsWith('finale-')) {
        t.problem('bug', `level ${level}: End Level did not play its ending event`);
        return;
      }
      t.event('world-event', `${scene.id} plays (${scene.duration.toFixed(1)} s)`);
      if (scene.duration >= 8) t.problem('bug', `${scene.id} runs ${scene.duration.toFixed(1)} s (limit 8)`);
      await sleep(1800);
      if (!doc.body.classList.contains('cinematic')) t.problem('bug', `${scene.id}: the HUD and touch controls are not faded out (body.cinematic missing)`);
      for (const name of ['healthBar', 'pauseBtn', 'leftStickZone', 'rightStickZone', 'fireBtn', 'jumpBtn', 'interactBtn']) {
        const el = doc.getElementById(name);
        if (!el) continue;
        const cs = getComputedStyle(el);
        if (cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05) t.problem('bug', `${scene.id}: #${name} is still visible during the event`);
      }
      const caption = doc.getElementById('cineText');
      const lines = Math.round((caption?.getBoundingClientRect().height ?? 0) / Math.max(1, parseFloat(getComputedStyle(caption ?? doc.body).lineHeight) || 20));
      t.event('world-event-caption', `"${(caption?.textContent ?? '').trim()}" (${lines} line${lines === 1 ? '' : 's'})`);
      if ((caption?.textContent ?? '').trim() && lines > 1) t.problem('bug', `${scene.id}: the caption wraps to ${lines} lines`);
      const skip = probe.skipButton;
      if (!skip || skip.hidden) t.problem('bug', `${scene.id}: Skip is not shown during the event`);
      else press(skip, 'Skip (world event)');
      const ended = performance.now();
      while (performance.now() - ended < 4000 && (doc.getElementById('messageTitle')?.textContent ?? '') !== 'Level Complete') await sleep(100);
      if ((doc.getElementById('messageTitle')?.textContent ?? '') !== 'Level Complete') t.problem('bug', `${scene.id}: Skip did not lead to the Level Complete card`);
      else {
        const crawl = doc.querySelectorAll('#levelCredits .credit-roll p').length;
        t.event('crawl-lines', `level ${level} card crawl: ${crawl} lines`);
        if (crawl > 3) t.problem('bug', `level ${level}: the end card crawls ${crawl} lines (limit 3)`);
      }
    };
    const full = id === 'full';
    const smokeN = Number(/^smoke-l([1-8])$/.exec(id)?.[1] ?? 0);
    const smoke = smokeN > 0;
    // Levels 1-6 are walked by playLevel, so their scripted scenes (lobby, desk, station) can be skipped too.
    // Levels 7 and 8 run the story scripts, which listen to their own opening, so only timelines are skipped there.
    const smokeSkipScripted = smoke && smokeN <= 6;
    const smokeT0 = performance.now();
    const watch = { key: '', at: performance.now(), x: 0, z: 0, line: '' };
    const poke = () => { watch.at = performance.now(); };
    const speed = Math.max(1, Number(options.speed) || 1);
    let rng = (Number(options.seed) || 1) >>> 0 || 1;
    const random = () => { rng ^= rng << 13; rng >>>= 0; rng ^= rng >> 17; rng ^= rng << 5; rng >>>= 0; return rng / 4294967296; };

    // ---- what the bot watches every frame
    let lastLine = '';
    let lastPhone = '';
    let scene: {
      id: string; t0: number; limit: number; skipAt: number; last: number; skipped: boolean;
      /** Scene audit: samples taken, samples with the walk clip and no movement, movement without a walk clip, the last position, props never seen. */
      samples: number; walkInPlace: number; slide: number; lastP: { x: number; z: number } | null; propsSeen: Set<string>;
    } | null = null;
    let lastPos: { x: number; z: number; y: number } | null = null;
    let fallen = false;
    // Animation trace (quality rule 5): how long each mismatch between motion and clip has lasted.
    const animHeld = { airOnFloor: 0, floorInAir: 0, slide: 0, idleMoving: 0 };
    const animSeen = new Set<string>();
    let animAt = 0;
    let levelIndex = 0;
    let levelsTotal = 1;
    let levelSteps = 0;
    const seenRaw = new Set<string>();

    const mark = () => t.progress((levelIndex + Math.min(0.92, levelSteps * 0.08)) / levelsTotal);

    const checkCopy = (where: string, text: string) => {
      if (!text) return;
      const m = RAW_KEY.exec(text);
      if (!m || seenRaw.has(m[0])) return;
      seenRaw.add(m[0]);
      t.problem('bug', `missing locale string? "${m[0]}" shown in ${where}: "${text.slice(0, 90)}"`);
    };

    const controllable = () => probe.running() && !probe.cutscene() && !probe.scripted() && !probe.menu().open;

    const observe = () => {
      const sub = probe.subtitle();
      const line = sub.text.trim();
      if (line && line !== lastLine) {
        t.add('dialogueLines');
        t.event('dialogue', `${sub.speaker || '—'}: ${line.slice(0, 100)}`);
        checkCopy('subtitle', `${sub.speaker} ${line}`);
        mark();
      }
      lastLine = line;
      const ph = probe.phone();
      const pline = ph.line.trim();
      if (pline && pline !== lastPhone && ph.busy) {
        t.add('dialogueLines');
        t.event('dialogue', `phone ${ph.speaker || '—'}: ${pline.slice(0, 100)}`);
        checkCopy('phone', `${ph.speaker} ${pline}`);
        mark();
      }
      lastPhone = pline;
      const obj = probe.objective();
      if (obj.visible) {
        checkCopy('objective', `${obj.title} ${obj.text}`);
        if (!obj.text.trim()) {
          const key = `empty-objective-${probe.level().libraryId}-${obj.title}`;
          if (!seenRaw.has(key)) { seenRaw.add(key); t.problem('warning', `objective "${obj.title}" shows with no text on ${probe.level().name}`); }
        }
      }
      const label = probe.action();
      if (label) checkCopy('action button', label);
      const menu = probe.menu();
      if (menu.open) checkCopy('card', `${menu.title} ${menu.text}`);

      // Cutscenes: timeline scenes and the scripted ones (lobby, desk, station opening).
      const cut = probe.cutscene();
      const scripted = probe.scripted();
      const nowId = cut?.id ?? scripted ?? '';
      if (nowId && (!scene || scene.id !== nowId)) {
        if (scene) endScene();
        const limit = cut ? cut.duration * 1.25 + 8 : SCRIPTED_LIMIT;
        const skipAfter = full ? FULL_SKIP_AFTER[nowId]
          : smoke && (cut || smokeSkipScripted) ? (FULL_SKIP_AFTER[nowId] ?? SMOKE_SKIP_AFTER) : undefined;
        const bySpeed = speed > 1 && cut ? cut.duration / speed : undefined;
        scene = {
          id: nowId, t0: performance.now(), limit, skipAt: Math.min(skipAfter ?? Infinity, bySpeed ?? Infinity), last: -1, skipped: false,
          samples: 0, walkInPlace: 0, slide: 0, lastP: null, propsSeen: new Set(),
        };
        t.add('cutscenes');
        t.event('cutscene-start', nowId);
        levelSteps += 1;
        mark();
      } else if (!nowId && scene) {
        endScene();
      }
      if (scene) {
        const secs = (performance.now() - scene.t0) / 1000;
        const time = cut?.time ?? secs;
        if (time > scene.last + 0.5) { scene.last = time; mark(); }
        auditSceneFrame(scene);
        if (!scene.skipped && secs > scene.skipAt) {
          scene.skipped = true;
          t.event('cutscene-skip', `${scene.id} at ${secs.toFixed(0)} s`);
          if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        } else if (!scene.skipped && secs > scene.limit) {
          scene.skipped = true;
          t.problem('bug', `cutscene "${scene.id}" never ended (${secs.toFixed(0)} s, expected about ${Math.round(scene.limit)} s)`);
          if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        }
      }

      // Falls and knockbacks (a car on the street throws him to the curb).
      const p = probe.player();
      if (controllable()) {
        if (lastPos) {
          const jump = Math.hypot(p.x - lastPos.x, p.z - lastPos.z);
          if (jump > 1.5 && jump < 40) {
            // On the street that is a car throwing him to the curb. Elsewhere the collider pushed him out of something.
            const kind = probe.level().libraryId === 'going-home' ? 'knockback' : 'snap';
            t.add(kind === 'knockback' ? 'knockbacks' : 'positionSnaps');
            t.event(kind, `${jump.toFixed(1)} m at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
          }
        }
        if (p.y < -2 && !fallen) {
          fallen = true;
          t.add('falls');
          t.event('fall', `${probe.level().name} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}), y ${p.y.toFixed(1)}`);
          t.problem('bug', `Pierce fell through the floor on ${probe.level().name} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
        }
        if (p.y > -1) fallen = false;
        lastPos = { x: p.x, z: p.z, y: p.y };
        traceAnimation();
      } else {
        lastPos = null;
        animAt = 0;
      }
    };

    // Quality rule 5: the clip must agree with the physics. A jump pose held while standing, walking in mid-air,
    // feet sliding (loop rate off the ground speed) or idling while moving, each for longer than a blend, is a bug.
    const traceAnimation = () => {
      const m = probe.motion?.();
      const now = performance.now();
      const dt = animAt ? Math.min(0.25, (now - animAt) / 1000) : 0;
      animAt = now;
      if (!m || m.cinematic || dt <= 0) return;
      const hold = (key: keyof typeof animHeld, on: boolean, limit: number, message: () => string) => {
        animHeld[key] = on ? animHeld[key] + dt : 0;
        if (animHeld[key] < limit) return;
        const tag = `${probe.level().libraryId}|${key}`;
        t.add(`anim_${key}`);
        if (animSeen.has(tag)) return;
        animSeen.add(tag);
        t.event('anim', message());
        t.problem('bug', message());
      };
      const where = () => {
        const p = probe.player();
        return `on ${probe.level().name} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`;
      };
      hold('airOnFloor', m.grounded && m.jumpPose !== null && m.jumpPose < 3, 0.3,
        () => `jump pose held while Pierce stands on the floor ${where()}`);
      hold('floorInAir', !m.grounded && m.airTime > 0.3 && m.jumpPose === null, 0.2,
        () => `Pierce walks or idles in mid-air (${m.airTime.toFixed(1)} s off the floor) ${where()}`);
      const stride = m.clip ? STRIDE_MPS[m.clip] : undefined;
      const want = stride && m.groundSpeed > 0.4 ? m.groundSpeed / stride : null;
      const clamped = want !== null && (want > 2.55 || want < 0.4);
      hold('slide', m.grounded && m.moving && want !== null && !clamped && Math.abs(m.rate - want) / want > 0.25, 0.5,
        () => `feet slide: ${m.clip} plays at ${m.rate.toFixed(2)}x but ${m.groundSpeed.toFixed(2)} m/s needs ${want?.toFixed(2)}x ${where()}`);
      hold('idleMoving', m.grounded && m.groundSpeed > 0.8 && m.jumpPose === null && (m.clip === 'idle' || m.clip === 'pistolidle'), 0.3,
        () => `Pierce glides in his idle pose at ${m.groundSpeed.toFixed(1)} m/s ${where()}`);
    };

    // Smoke runs: no objective progress for 30 s ends the run stuck. Progress is a new objective, a scene or a
    // call playing, a new line, a card up, or Pierce 3 m from where the clock last reset.
    const watchProgress = () => {
      if (!smoke) return;
      const now = performance.now();
      const obj = probe.objective();
      const p = probe.player();
      const sub = probe.subtitle().text.trim();
      const ph = probe.phone();
      const key = `${probe.level().libraryId}|${obj.title}|${obj.text}|${probe.phase()}`;
      const busy = !probe.running() || probe.menu().open || probe.cutscene() || probe.scripted() || ph.busy || ph.incoming;
      const talked = sub !== watch.line;
      watch.line = sub;
      if (key !== watch.key || busy || talked || Math.hypot(p.x - watch.x, p.z - watch.z) > 3) {
        watch.key = key; watch.x = p.x; watch.z = p.z; watch.at = now;
        return;
      }
      if (now - watch.at > SMOKE_STUCK_MS) {
        const name = `${obj.title ? `${obj.title}: ` : ''}${obj.text}`.trim() || '(no objective)';
        throw new SmokeStuck(`stuck: no objective progress for 30 s on ${probe.level().name}, objective "${name}", phase ${probe.phase() || '-'}, at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
      }
    };

    /** Scene audit: while a scene runs, is the walk clip playing with no movement, is he moving with no walk clip, and are its props there. */
    const auditSceneFrame = (sc: NonNullable<typeof scene>) => {
      const p = probe.player();
      const clip = String(probe.motion?.()?.clip ?? '').toLowerCase();
      const walking = /walk|run/.test(clip);
      if (sc.lastP) {
        const moved = Math.hypot(p.x - sc.lastP.x, p.z - sc.lastP.z);
        sc.samples += 1;
        // A cut (placePierce to a new mark) is a jump of metres: not a slide.
        if (walking && moved < 0.005) sc.walkInPlace += 1;
        if (!walking && clip && moved > 0.15 && moved < 2.5) sc.slide += 1;
      }
      sc.lastP = { x: p.x, z: p.z };
      for (const re of SCENE_PROPS[sc.id] ?? []) {
        if (sc.propsSeen.has(re.source)) continue;
        if (probe.scene.meshes.some((m) => re.test(m.name) && m.isEnabled())) sc.propsSeen.add(re.source);
      }
    };

    const endScene = () => {
      if (!scene) return;
      const secs = (performance.now() - scene.t0) / 1000;
      // The audit's findings, per scene: shown as metrics and, when it matters, as bugs.
      t.metric(`scene:${scene.id}:walkInPlaceFrames`, scene.walkInPlace);
      t.metric(`scene:${scene.id}:slideFrames`, scene.slide);
      if (scene.walkInPlace > 3) t.problem('bug', `scene "${scene.id}": the walk clip played with no movement for ${scene.walkInPlace} frames (walking in place)`);
      if (scene.slide > 3) t.problem('warning', `scene "${scene.id}": Pierce moved with no walk clip for ${scene.slide} frames (sliding)`);
      const lastSecs = secs;
      if (lastSecs > 4) {
        const missing = (SCENE_PROPS[scene.id] ?? []).filter((re) => !scene!.propsSeen.has(re.source));
        if (missing.length) t.problem('bug', `scene "${scene.id}": props it refers to were never present: ${missing.map((re) => re.source).join(', ')}`);
      }
      t.event('scene-audit', `${scene.id}: started, ${scene.skipped ? 'ended only by Skip' : 'ended by itself'}, ${secs.toFixed(1)} s, walk-in-place ${scene.walkInPlace}, slide ${scene.slide}`);
      t.event('cutscene-end', `${scene.id} after ${secs.toFixed(1)} s${scene.skipped ? ' (skipped)' : ''}`);
      t.metric(`cutscene:${scene.id}`, Math.round(secs * 10) / 10);
      scene = null;
      mark();
    };

    const tick = async () => { await frame(); observe(); watchProgress(); };

    // ---- camera and walking
    const measureLook = async () => {
      if (lookSens) return;
      const before = probe.cameraYaw();
      dragLook(12);
      await frame();
      await frame();
      const moved = wrap(probe.cameraYaw() - before);
      if (Math.abs(moved) > 1e-4) {
        lookSens = moved / 12;
        dragLook(-12);
      }
    };

    const face = (heading: number) => {
      const err = wrap(heading - probe.cameraYaw());
      if (Math.abs(err) < 0.04 || !lookSens) return err;
      const px = Math.max(-14, Math.min(14, err / lookSens));
      if (Math.abs(px) >= 0.5) dragLook(px);
      return err;
    };

    const OCTANTS: Record<number, string> = { 0: 'w', 1: 'wd', 2: 'd', 3: 'sd', 4: 's', [-4]: 's', [-1]: 'wa', [-2]: 'a', [-3]: 'sa' };
    const steer = (to: Point, turn = true) => {
      const p = probe.player();
      const heading = Math.atan2(to.x - p.x, to.z - p.z);
      if (turn) face(heading);
      const rel = wrap(heading - probe.cameraYaw());
      setHeld(OCTANTS[Math.round(rel / (Math.PI / 4))] ?? 'w');
    };

    type Nav = { key: string; goal: Point; path: Point[] | null; grid: Grid | null; built: number; best: number; bestAt: number; wpBest: number; wpAt: number; recover: number; reported: boolean; direct: boolean };
    let nav: Nav | null = null;
    const unreachableSince = new Map<string, number>();

    const streetRoute = (from: Point, goal: Point): Point[] => {
      // Going Home: the south sidewalk of the main avenue runs from the tower to the stairs.
      const pts: Point[] = [];
      if (Math.abs(from.z - STREET_LANE_Z) > 1.2) pts.push({ x: from.x + 1.5, z: STREET_LANE_Z });
      if (goal.x - from.x > 6) pts.push({ x: goal.x - 4, z: STREET_LANE_Z });
      pts.push(goal);
      return pts;
    };

    const plan = (goal: Point, key: string) => {
      const lib = probe.level().libraryId;
      const here = probe.player();
      const grid = buildGrid(probe.scene, lib);
      let path: Point[] | null = null;
      let direct = false;
      if (grid && nearestOpen(grid, here, 2.5)) path = findPath(grid, here, goal);
      if (!path) {
        direct = true;
        const onGrid = !!(grid && nearestOpen(grid, here, 2.5));
        const waitedK = `unreachable-${lib}-${key}`;
        const waited = performance.now() - (unreachableSince.get(waitedK) ?? performance.now());
        // On a grid level, hold still first: the goal is often behind a door that opens on its own.
        path = lib === 'going-home' ? streetRoute(here, goal) : onGrid && waited < 8000 ? [] : [goal];
        const k = `unreachable-${lib}-${key}`;
        const first = unreachableSince.get(k) ?? performance.now();
        unreachableSince.set(k, first);
        // Doors open on their own (the B3 cab), so only report a goal that stays cut off.
        if (grid && nearestOpen(grid, here, 2.5) && lib !== 'going-home' && performance.now() - first > 8000) {
          if (!seenRaw.has(k)) {
            seenRaw.add(k);
            t.problem('bug', `no walkable path to "${key}" at (${goal.x.toFixed(1)}, ${goal.z.toFixed(1)}) on ${probe.level().name} from (${here.x.toFixed(1)}, ${here.z.toFixed(1)}); trying a straight line`);
          }
        }
      }
      const now = performance.now();
      const d = dist(here, goal);
      // A re-plan for the same goal keeps the stuck clock running.
      const same = nav && nav.key === key && dist(nav.goal, goal) <= 0.5 ? nav : null;
      nav = {
        key, goal, path, grid, built: now, best: same ? Math.min(same.best, d) : d, bestAt: same?.bestAt ?? now,
        wpBest: Infinity, wpAt: now, recover: same?.recover ?? 0, reported: same?.reported ?? false, direct,
      };
      t.log(`route to ${key}: ${path.length} waypoints${direct ? ' (direct)' : ''}, ${d.toFixed(1)} m`);
    };

    /** One frame of walking toward goal. Returns true once within `arrive` metres. */
    const walkTo = async (goal: Point, key: string, arrive = 0.55): Promise<boolean> => {
      const here = probe.player();
      const d = dist(here, goal);
      if (d <= arrive) { releaseAll(); return true; }
      if (!nav || nav.key !== key || dist(nav.goal, goal) > 0.5 || (nav.direct && performance.now() - nav.built > 3000)) plan(goal, key);
      const n = nav!;
      const now = performance.now();
      if (d < n.best - 0.5) { n.best = d; n.bestAt = now; n.recover = 0; levelSteps += 0.02; mark(); }
      // Drop reached waypoints.
      if (n.grid && probe.level().libraryId !== 'going-home' && !nearestOpen(n.grid, here, 1.6)) {
        const k = `outside-${probe.level().libraryId}`;
        if (!seenRaw.has(k)) {
          seenRaw.add(k);
          t.problem('bug', `Pierce is outside the walkable area on ${probe.level().name} at (${here.x.toFixed(1)}, ${here.z.toFixed(1)}): through a wall?`);
        }
      }
      while (n.path && n.path.length > 1 && dist(here, n.path[0]) < 0.5) { n.path.shift(); n.wpBest = Infinity; }
      if (n.path && !n.path.length) { releaseAll(); n.wpAt = now; return false; } // waiting for a way through
      const wp = n.path?.[0] ?? goal;
      const wd = dist(here, wp);
      if (wd < n.wpBest - 0.2) { n.wpBest = wd; n.wpAt = now; }
      if (now - n.wpAt > 2600) {
        // No closer to the next waypoint: hop, sidestep, plan again.
        n.recover += 1;
        t.add('stuckRecoveries');
        t.log(`stuck near (${here.x.toFixed(1)}, ${here.z.toFixed(1)}) going to ${key}, recovery ${n.recover}`);
        const side = random() < 0.5 ? 'a' : 'd';
        setHeld(side);
        await tap(' ');
        await sleep(450);
        setHeld('s');
        await sleep(250);
        releaseAll();
        plan(goal, key);
        return false;
      }
      if (now - n.bestAt > 30000 && !n.reported) {
        n.reported = true;
        t.problem('bug', `stuck: no movement toward "${key}" for 30 s on ${probe.level().name} at (${here.x.toFixed(1)}, ${here.z.toFixed(1)}), ${d.toFixed(1)} m away`);
      }
      if (now - n.bestAt > 45000) throw new Error(`timed out walking to ${key}`);
      t.note(`walking to ${key.slice(0, 40)}: ${d.toFixed(1)} m, at (${here.x.toFixed(1)}, ${here.z.toFixed(1)})`);
      steer(wp);
      return false;
    };

    // ---- menus
    const waitControl = async (what: string, ms = 90000) => {
      const until = performance.now() + ms;
      while (!(probe.running() && !probe.menu().open)) {
        if (performance.now() > until) throw new Error(`timed out waiting for ${what}`);
        await tick();
      }
    };

    const enterLevel = async (n: number) => {
      const menu = probe.menu();
      const lvl = probe.level();
      if (n === 1 && menu.open && lvl.id === 1 && menu.start && /start/i.test(menu.start)) {
        press(probe.startButton, menu.start);
      } else if (n === 1 && menu.open && menu.newGame) {
        press(probe.newGameButton, 'New Game');
      } else {
        t.event('setup', `start at level ${n} directly (test shortcut)`);
        await probe.setupLevel(n);
      }
      const until = performance.now() + 90000;
      while (!(probe.running() && probe.level().id === n)) {
        if (performance.now() > until) throw new Error(`timed out waiting for level ${n} to start`);
        await tick();
      }
    };

    /**
     * Chapter card → world black-frame check (shared by `transition` and smoke's beta legs).
     * Starts the level when `start` is true; otherwise the card must already be up or arriving.
     */
    const sampleChapterTransition = async (n: number, phone: boolean, start: boolean) => {
      const tag = `level ${n}${phone ? ' (phone)' : ''}`;
      if (start) {
        if (!phone && n === 1) await enterLevel(1);
        else {
          t.event('setup', `start at level ${n} directly (test shortcut)`);
          void probe.setupLevel(n);
        }
      }
      const until = performance.now() + 120000;
      while (!probe.chapter().open) {
        if (performance.now() > until) throw new Error(`${tag} never showed its card`);
        await tick();
      }
      t.event('chapter-card', { level: n, phone, kicker: probe.chapter().kicker, title: probe.chapter().title });
      await sleep(800);
      let worstWhileHeld = 1;
      let samples = 0;
      let hudOverCard = false;
      while (probe.chapter().open && performance.now() < until) {
        if (probe.hudShown()) {
          if (!hudOverCard) {
            hudOverCard = true;
            t.problem('bug', `${tag}: HUD/pause shows over the chapter card`);
          }
        }
        if (probe.running()) {
          const lit = await probe.worldLuma();
          samples++;
          if (probe.chapter().closing) worstWhileHeld = Math.min(worstWhileHeld, lit);
        }
        await tick();
      }
      const liftLit = await probe.worldLuma();
      t.add('transitionSamples', samples);
      t.event('transition', {
        level: n,
        phone,
        samples,
        litShareAtLift: Math.round(liftLit * 100) / 100,
        worstWhileClosing: Math.round(worstWhileHeld * 100) / 100,
      });
      if (liftLit < 0.03) t.problem('bug', `${tag}: world is mostly black when the card lifts (${liftLit.toFixed(2)})`);
      let blankAfter = 0;
      for (let i = 0; i < 8; i++) {
        await tick();
        const lit = await probe.worldLuma();
        if (lit < 0.03) {
          blankAfter++;
          if (probe.hudShown()) t.problem('bug', `${tag}: HUD over a mostly-black frame after the card (${lit.toFixed(2)})`);
        }
      }
      if (blankAfter >= 3) t.problem('bug', `${tag}: ${blankAfter}/8 frames after the card were mostly black`);
      await sleep(400);
      // Levels 5-8 open with a scripted scene (lobby, station, train, morning); the HUD is hidden for it by design
      // (body.cinematic). Play it out with Skip, then the HUD must be back once the player has control.
      if (probe.scripted() || probe.cutscene()) {
        const sceneUntil = performance.now() + 30000;
        while (performance.now() < sceneUntil && (probe.scripted() || probe.cutscene())) {
          if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
          await tick();
        }
        await sleep(400);
      }
      if (!probe.hudShown()) t.problem('bug', `${tag}: HUD missing after the card faded`);
    };

    // ---- per level special play
    let lastShot = 0;
    let huntDownAt = 0;
    let huntNudged = false;
    let lastKey: Record<string, number> = {};
    const once = async (key: string, gapMs: number, label: string) => {
      const now = performance.now();
      if ((lastKey[key] ?? 0) + gapMs > now) return false;
      lastKey[key] = now;
      await tap(key, label);
      return true;
    };

    const huntStep = async () => {
      const p = probe.player();
      if (!p.weaponDrawn) { releaseAll(); await once('q', 1800, 'draw sidearm'); return; }
      if (p.health < 45 && p.medkits > 0) await once('h', 2000, 'medkit');
      if (p.clip <= 0) {
        if (p.ammo > 0) { releaseAll(); await once('r', 2200, 'reload'); return; }
        const box = probe.pickups().filter((k) => k.item === 'ammo').sort((a, b) => dist(p, a) - dist(p, b))[0];
        if (box) {
          if (await walkTo(box, 'ammo box', 0.9)) await once('e', 900, 'take ammo');
          return;
        }
      }
      const beast = probe.creature();
      if (!beast) {
        // Dropped: it runs for the vat and the vat scene starts on its own. Follow the marker like a player.
        if (!huntDownAt) huntDownAt = performance.now();
        const waited = performance.now() - huntDownAt;
        const goal = probe.objective().target;
        if (waited < 14000 && goal) {
          if (await walkTo(goal, 'vat (creature down)', 2)) releaseAll();
          return;
        }
        if (!huntNudged) {
          huntNudged = true;
          t.problem('bug', 'B3 softlock: the creature went down before Pierce entered decon, and it never ran for the vat. stepHunt returns while huntWaiting is true, so the retreat timer never runs until he walks into the den (act1.ts).');
        }
        await walkTo(B3_DEN, 'decon (unstick the vat run)', 1.2);
        return;
      }
      const d = dist(p, beast);
      const heading = Math.atan2(beast.x - p.x, beast.z - p.z);
      const locked = probe.aimLocked();
      if ((locked && d < 15) || d < 3.2) {
        // Stand, turn to it, fire. Up close a shot lands without the snap when he faces it.
        releaseAll();
        const err = face(heading);
        if ((locked || Math.abs(err) < 0.18) && performance.now() - lastShot > 380) {
          lastShot = performance.now();
          poke();
          clickCanvas();
          t.add('shots');
          t.add('interactions');
        }
        return;
      }
      // Not in sight yet: walk in (it waits in decon until Pierce enters, then hunts him).
      await walkTo(beast, 'creature', 2.6);
    };

    let lesson = { started: 0, gaveUp: false };
    const streetLessonStep = async (): Promise<boolean> => {
      // Going Home teaches Shadow mode: use Shadow Shock and Possess on passersby. Returns false when it is done.
      if (lesson.gaveUp) return false;
      if (!lesson.started) { lesson.started = performance.now(); t.event('tutorial-start', 'street powers'); }
      if (performance.now() - lesson.started > 70000) {
        lesson.gaveUp = true;
        t.problem('warning', 'bot could not finish the street powers tutorial in 70 s (Shadow Shock, then Possess on a passerby)');
        return false;
      }
      const sh = probe.shadow();
      if (!sh.controls) return true;
      if (!sh.on) { releaseAll(); await once('c', 1200, 'Shadow mode'); return true; }
      if (sh.linked) { releaseAll(); await once('Tab', 1200, 'release link'); return true; }
      const p = probe.player();
      const crowd = probe.people().filter((x) => x.kind === 'person' || x.kind === 'hostile');
      const target = crowd.sort((a, b) => dist(p, a) - dist(p, b))[0];
      const wantPossess = sh.lessonStarted;
      if (wantPossess && sh.ability !== 'possess') { releaseAll(); await once('Tab', 900, 'switch to Possess'); return true; }
      if (wantPossess && !sh.handsOut) { releaseAll(); await once('q', 1200, 'raise hands'); return true; }
      if (!target) { setHeld('w'); return true; }
      const d = dist(p, target);
      if (!wantPossess) {
        if (d < 2.2) { releaseAll(); face(Math.atan2(target.x - p.x, target.z - p.z)); await sleep(120); clickCanvas(); t.add('interactions'); t.log('click Shadow Shock'); await sleep(900); return true; }
        steer(target);
        return true;
      }
      if (d < 4.5) {
        releaseAll();
        const err = face(Math.atan2(target.x - p.x, target.z - p.z));
        if (probe.aimLocked() || Math.abs(err) < 0.25) {
          clickCanvas();
          t.add('interactions');
          t.log('click Possess');
          await sleep(700);
        }
        return true;
      }
      steer(target);
      return true;
    };

    /** Apex Peak vertical slice: walk the halls, hit the new life and interactions, report quality metrics. */
    const apexSliceRun = async (): Promise<Outcome> => {
      t.event('setup', 'start Apex Peak for the vertical slice');
      await probe.setupLevel(1);
      await waitControl('apex slice');
      t.event('level-start', 'Apex Peak vertical slice');
      t.metric('feel.coyoteMs', 120);
      const seen = new Set<string>();
      const noteAction = (label: string) => {
        if (seen.has(label)) return;
        seen.add(label);
        t.event('action', label);
        t.add('interactions');
      };
      const stops: { key: string; x: number; z: number; want?: string }[] = [
        { key: 'hall-2', x: 18, z: 32 },
        { key: 'cleaner-path', x: 12, z: 32 },
        { key: 'office-sofa', x: 44.2, z: 44.2, want: 'Sit' },
        { key: 'desk-papers', x: 48, z: 43.35, want: 'Read papers' },
        { key: 'valuation', x: 36.8, z: 27.2, want: 'Tap screen' },
        { key: 'board-seat', x: 49.4, z: 32 },
      ];
      const until = performance.now() + 200_000;
      let stopAt = 0;
      while (performance.now() < until && stopAt < stops.length) {
        await tick();
        const phone = probe.phone();
        if (phone.incoming) {
          releaseAll();
          await once('f', 1500, 'answer call');
          t.event('call', phone.speaker || 'incoming');
          continue;
        }
        if (phone.busy) { releaseAll(); continue; }
        if (probe.cutscene() || probe.scripted()) { releaseAll(); continue; }
        const people = probe.people();
        if (people.some((p) => p.kind === 'cleaner') && !seen.has('cleaner')) {
          seen.add('cleaner');
          t.event('life', 'night cleaner walking hall 2');
        }
        if (people.some((p) => p.kind === 'cart') && !seen.has('cart')) {
          seen.add('cart');
          t.event('life', 'cleaner cart left in the hall');
        }
        if (stops[stopAt]?.want && [...seen].some((s) => s.includes(stops[stopAt].want!))) {
          stopAt += 1;
          continue;
        }
        const label = probe.action();
        if (label && stops[stopAt]?.want && label.includes(stops[stopAt].want!)) {
          releaseAll();
          if (await once('e', 1600, label)) {
            noteAction(label);
            // Sofa sit holds ~4 s.
            if (/sit/i.test(label)) await sleep(4500);
            else await sleep(900);
            stopAt += 1;
          }
          continue;
        }
        if (label && !seen.has(label) && /sit|papers|tap screen/i.test(label)) {
          releaseAll();
          if (await once('e', 1600, label)) {
            noteAction(label);
            if (/sit/i.test(label)) await sleep(4500);
            else await sleep(900);
          }
          continue;
        }
        const goal = stops[stopAt];
        if (!goal) break;
        if (await walkTo({ x: goal.x, z: goal.z }, goal.key, goal.want ? 1.2 : 1.4)) {
          if (!goal.want) {
            t.event('walk', `reached ${goal.key}`);
            stopAt += 1;
          }
        }
      }
      const slice = probe.apexSlice?.() ?? null;
      const quiet = slice?.maxQuietSeconds ?? 99;
      const textOnly = slice?.textOnlyBeats ?? 0;
      t.metric('quality.maxQuietSeconds', quiet);
      t.metric('quality.textOnlyBeats', textOnly);
      t.event('quality', `maxQuietSeconds=${quiet}, textOnlyBeats=${textOnly}, events=${slice?.events ?? 0}`);
      if (quiet > 10) t.problem('bug', `quality.quiet-gap: Apex Peak quiet stretch ${quiet}s (limit 10)`);
      if (textOnly > 0) t.problem('bug', `quality.text-story: ${textOnly} Apex beat(s) told only as text (clips missing)`);
      if (!seen.has('cleaner') && !seen.has('cart')) {
        t.problem('bug', 'apex-slice: never saw the night cleaner or her cart in hall 2');
      }
      const needed = ['Sit', 'Read papers', 'Tap screen'];
      for (const name of needed) {
        if (![...seen].some((s) => s.includes(name))) {
          t.problem('bug', `apex-slice: never used "${name}"`);
        }
      }
      releaseAll();
      t.event('level-end', 'Apex Peak vertical slice');
      return quiet <= 10 ? 'done' : 'lost';
    };

    /** The run goal: the Missions panel names the reward while the level is open, and Level Complete pays rank + tool and ends on a hook. */
    const rewardGoalCheck = async (phone: boolean) => {
      const text = (el: Element | null) => (el?.textContent ?? '').trim().replace(/\s+/g, ' ');
      const byId = (name: string) => document.getElementById(name) as HTMLElement | null;
      t.scene('Run goal: Missions panel');
      await tapAt(byId('missionsHint'), 'Missions');
      await sleep(500);
      const goal = document.getElementById('missionGoal');
      const goalText = text(goal);
      t.event('run-goal', `Missions panel shows: ${goalText}`);
      if (!goal || !shown(goal) || goalText.length < 20) t.problem('bug', `run goal: the Missions panel shows no reward line (${goalText})`);
      if (RAW_KEY.test(goalText)) t.problem('bug', 'run goal: raw locale id in the Missions panel');
      await tapAt(byId('missionsClose'), 'Close missions');
      await sleep(300);
      t.scene('Run goal: Level Complete reward');
      if (!probe.showLevelComplete()) { t.problem('bug', 'run goal: could not show the Level Complete card'); return; }
      await sleep(1500);
      const card = document.getElementById('rewardEntry');
      const rows = [...(card?.querySelectorAll('.reward-row') ?? [])].map((r) => text(r));
      const hook = text(card?.querySelector('.reward-hook') ?? null);
      t.event('reward', `${rows.join(' | ')} || hook: ${hook}`);
      if (card) (card as HTMLElement).style.outline = `2px solid ${shown(card) ? '#d4b483' : '#ff4d4d'}`;
      if (!card || !shown(card) || rows.length < 2) t.problem('bug', `run goal: Level Complete shows no rank and unlocked tool (${rows.join(' | ')})`);
      if (hook.length < 20) t.problem('bug', 'run goal: Level Complete ends with no hook into the next level');
      if (RAW_KEY.test(`${rows.join(' ')} ${hook}`)) t.problem('bug', 'run goal: raw locale id on the reward block');
      if (phone) {
        const scrollW = document.documentElement.scrollWidth;
        if (scrollW > window.innerWidth + 1) t.problem('bug', `run goal: Level Complete scrolls sideways on the phone (${scrollW} > ${window.innerWidth})`);
        const small = [...document.querySelectorAll<HTMLElement>('#messageBox .button-row button')].filter((b) => shown(b) && b.getBoundingClientRect().height < 44);
        if (small.length) t.problem('bug', `run goal: ${small.length} card buttons under 44 px`);
      }
      t.metric('runGoalShown', 1);
    };

    /** The 58th floor, the station and the train lived in: footsteps per foot plant, people on routines who look at Pierce, touchables that answer Interact. */
    const livingPlacesRun = async (): Promise<Outcome> => {
      levelsTotal = 3;
      const phone = Boolean(options.phone);
      if (probe.sound().prompt) {
        // Menus: the title card stays hidden behind the gate; once it is dismissed, loading is one line under the button.
        const panel = document.querySelector<HTMLElement>('#messageBox .panel');
        const hiddenBehind = !panel || getComputedStyle(panel).visibility === 'hidden';
        t.event('check', `menus: title card ${hiddenBehind ? 'hidden' : 'VISIBLE'} behind the Tap to play gate`);
        if (!hiddenBehind) t.problem('bug', 'menus: the title card shows through the Tap to play gate');
        await tapToPlay();
        const line = document.getElementById('loadLine') as HTMLElement | null;
        const sub = document.getElementById('messageText') as HTMLElement | null;
        const btn = document.getElementById('startBtn') as HTMLElement | null;
        if (line && !line.hidden && btn) {
          const below = line.getBoundingClientRect().top >= btn.getBoundingClientRect().bottom - 1;
          const subShown = !!sub && sub.offsetParent !== null && (sub.textContent ?? '').trim() !== '';
          t.event('check', `menus: one loading line "${line.textContent}" ${below ? 'below' : 'NOT below'} the button${subShown ? ', memo line also showing' : ''}`);
          if (!below || subShown) t.problem('bug', 'menus: loading text is not a single line below the button');
        }
        if (phone) {
          const w = document.documentElement.scrollWidth;
          if (w > window.innerWidth + 1) t.problem('bug', `menus: title card scrolls sideways (${w} > ${window.innerWidth})`);
        }
      }
      if (phone) { probe.phoneFrame(true); t.event('setup', 'phone layout 390x844 (touch)'); await sleep(800); }
      t.metric('feel.coyoteMs', 120);
      const places: { name: string; place: string; enter: () => Promise<void>; minPeople: number; touchables: number }[] = [
        { name: 'The Apex Peak', place: 'apex', minPeople: 4, touchables: 4, enter: async () => { await probe.setupLevel(1); } },
        { name: 'The Station', place: 'station', minPeople: 0, touchables: 4, enter: async () => { await probe.setupLevel(6); } },
        { name: 'The Train', place: 'train', minPeople: 4, touchables: 4, enter: async () => { await probe.setupHidden('the-train'); } },
      ];
      let worstQuiet = 0;
      const stepsSeen: { surface: string; variant: number }[] = [];
      let done = 0;
      for (const where of places) {
        t.scene(where.name);
        t.event('setup', `enter ${where.name} directly (test shortcut)`);
        await where.enter();
        const until = performance.now() + 60000;
        while (performance.now() < until && !(probe.running() && !probe.menu().open && !probe.scripted() && !probe.cutscene())) {
          if (probe.skipButton && !probe.skipButton.hidden && (probe.scripted() || probe.cutscene())) press(probe.skipButton, 'Skip');
          const ph = probe.phone();
          if (ph.incoming) { releaseAll(); await once('f', 1500, 'answer call'); }
          await tick();
        }
        await waitControl(where.name);
        t.event('level-start', where.name);
        // Apex Peak: show the board plot through the hallway without answering the call.
        if (where.place === 'apex') {
          const hall = probe.boardHall?.();
          if (!hall) t.problem('bug', 'living-places: boardHall probe missing on Apex Peak');
          else {
            t.event('setup', 'board plot through the hall (no call required)');
            // Walk past the desk person; they look up and speak once in range.
            await walkTo(hall.deskAt, 'board-desk', 2.2);
            const deskDeadline = performance.now() + 8000;
            while (performance.now() < deskDeadline && !(probe.boardHall?.()?.deskSeen)) {
              await tick();
            }
            if (!probe.boardHall?.()?.deskSeen) t.problem('bug', 'living-places: desk person never reacted (board-desk)');
            else t.event('board-desk', 'person at desk seen');
            t.progress(0.08);
            // Try the locked IN SESSION door.
            await walkTo({ x: hall.doorAt.x, z: hall.doorAt.z }, 'board-door', Math.max(0.55, hall.doorAt.r * 0.65));
            const doorDeadline = performance.now() + 12000;
            let doorOk = false;
            while (performance.now() < doorDeadline && !doorOk) {
              await tick();
              const label = probe.action();
              if (label && /door/i.test(label)) {
                releaseAll();
                if (phone) {
                  const shown = probe.life?.()?.interactShown ?? false;
                  if (!shown) t.problem('bug', 'living-places: Interact button hidden at locked door on the phone layout');
                }
                if (await once('e', 1500, label)) {
                  await sleep(600);
                  doorOk = Boolean(probe.boardHall?.()?.doorTried);
                }
              } else {
                await walkTo({ x: hall.doorAt.x, z: hall.doorAt.z }, 'board-door', Math.max(0.55, hall.doorAt.r * 0.65));
              }
            }
            if (!doorOk) t.problem('bug', 'living-places: locked door never tried (board-door)');
            else t.event('board-door', 'locked door tried');
            t.progress(0.12);
            // Walk toward the boardroom until the Hale silhouette flinch fires.
            await walkTo({ x: hall.threatAt.x + 2.5, z: hall.threatAt.z }, 'board-threat', 1.4);
            const threatDeadline = performance.now() + 12000;
            while (performance.now() < threatDeadline && !(probe.boardHall?.()?.threatSeen)) {
              await tick();
              await walkTo({ x: Math.min(36, (probe.player().x || 0) + 1.2), z: hall.threatAt.z }, 'board-threat-nudge', 1.2);
            }
            if (!probe.boardHall?.()?.threatSeen) t.problem('bug', 'living-places: board threat never fired (board-threat)');
            else t.event('board-threat', 'visible threat flinch');
            t.metric('boardHallDesk', probe.boardHall?.()?.deskSeen ? 1 : 0);
            t.metric('boardHallDoor', probe.boardHall?.()?.doorTried ? 1 : 0);
            t.metric('boardHallThreat', probe.boardHall?.()?.threatSeen ? 1 : 0);
            t.progress(0.18);
          }
          // Art cohesion (critic): HUD gold/navy, hallway grade toward the title card's dark blue.
          {
            const root = getComputedStyle(document.documentElement);
            const accent = root.getPropertyValue('--accent').trim().toLowerCase();
            const gold = root.getPropertyValue('--hb-gold').trim().toLowerCase() || '#c9a86a';
            const navy = root.getPropertyValue('--hb-navy').trim().toLowerCase() || '#0a1522';
            t.event('hud-palette', `accent ${accent || '(empty)'}, gold ${gold}, navy ${navy}`);
            if (!accent || accent === '#67d2ff' || /67\s*,\s*210\s*,\s*255/.test(accent)) {
              t.problem('bug', 'art cohesion: HUD --accent is still cyan (wants title-card gold)');
            } else if (accent !== gold && accent !== '#c9a86a') {
              t.problem('bug', `art cohesion: HUD --accent ${accent} is not the house gold`);
            }
            const clash = /(103\s*,\s*210\s*,\s*255|#67d2ff|255\s*,\s*122\s*,\s*89|#ff7a59|255\s*,\s*191\s*,\s*105|#ffbf69)/i;
            const btnIds = ['fireBtn', 'jumpBtn', 'shadowBtn', 'interactBtn'];
            let checked = 0;
            for (const id of btnIds) {
              const el = document.getElementById(id);
              if (!el || el.hidden) continue;
              const cs = getComputedStyle(el);
              const bg = `${cs.backgroundImage} ${cs.backgroundColor}`.toLowerCase();
              t.event('hud-btn', `${id}: ${bg.slice(0, 140)}`);
              if (clash.test(bg)) t.problem('bug', `art cohesion: #${id} still uses cyan or coral orange`);
              checked += 1;
            }
            t.metric('hudPaletteButtons', checked);
            if (phone && checked < 2) t.problem('bug', `art cohesion: only ${checked} HUD buttons visible to sample on the phone layout`);
            const hemi = probe.scene.getLightByName('hemi') as BABYLON.HemisphericLight | null;
            const fog = probe.scene.fogColor;
            if (hemi && hemi.groundColor) {
              const g = hemi.groundColor;
              t.event('hall-grade', `hemi ground ${g.r.toFixed(3)},${g.g.toFixed(3)},${g.b.toFixed(3)}; fog ${fog.r.toFixed(3)},${fog.g.toFixed(3)},${fog.b.toFixed(3)}`);
              if (g.b <= g.r + 0.02) t.problem('bug', 'art cohesion: hallway hemi ground is not cooled toward navy');
              t.metric('hallGradeBlue', Math.round((g.b - g.r) * 1000) / 1000);
            } else {
              t.problem('bug', 'art cohesion: hemi light missing for hallway grade check');
            }
            if (fog.b <= fog.r + 0.01) t.problem('bug', 'art cohesion: hallway fog is not cooled toward navy');
            let coolPracticals = 0;
            let practicals = 0;
            for (const light of probe.scene.lights) {
              // Duck-type PointLight (this file type-imports Babylon; no runtime instanceof).
              if (light.getClassName?.() !== 'PointLight' || !light.isEnabled()) continue;
              const point = light as BABYLON.PointLight;
              // Skip the phone beam / tiny spots; hall troffers are the mid-range practicals.
              if (point.range < 6 || point.intensity < 0.08) continue;
              practicals += 1;
              if (point.diffuse.b > point.diffuse.r + 0.04) coolPracticals += 1;
            }
            t.event('hall-practicals', `${coolPracticals}/${practicals} cool navy practicals`);
            t.metric('hallCoolPracticals', coolPracticals);
            if (practicals > 0 && coolPracticals < Math.ceil(practicals * 0.5)) {
              t.problem('bug', `art cohesion: only ${coolPracticals}/${practicals} hall lights lean cool/navy`);
            }
          }
          if (phone) {
            const scroll = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
            if (scroll) t.problem('bug', 'living-places: horizontal scroll on 390x844 phone layout');
            t.event('phone-layout', scroll ? 'scroll' : 'no-horizontal-scroll');
            const touchIds = ['moveStick', 'lookStick', 'jumpBtn', 'fireBtn', 'shadowBtn', 'interactBtn', 'pauseBtn'];
            const small: string[] = [];
            for (const id of touchIds) {
              const el = document.getElementById(id);
              if (!el || el.hidden) continue;
              const st = getComputedStyle(el);
              if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) continue;
              const b = el.getBoundingClientRect();
              if (b.width < 1 || b.height < 1) continue;
              if (b.width < 44 || b.height < 44) small.push(`${id} ${Math.round(b.width)}x${Math.round(b.height)}`);
            }
            t.event('phone-targets', small.length ? `under 44 px: ${small.join(', ')}` : 'all visible touch controls ≥ 44 px');
            if (small.length) t.problem('bug', `living-places: touch targets under 44 px on 390x844 (${small.join(', ')})`);
          }
        }
        const list = probe.life?.()?.touchables ?? [];
        t.event('check', `${where.name}: ${list.length} touchables mounted (${list.map((x) => x.id).join(', ')})`);
        if (list.length < where.touchables) t.problem('bug', `living-places: ${where.name} has ${list.length} touchables, wants ${where.touchables}+`);
        const answered = new Set<string>();
        for (const item of list) {
          const deadline = performance.now() + 45000;
          let pressed = false;
          while (performance.now() < deadline && !pressed) {
            await tick();
            const ph = probe.phone();
            if (ph.incoming) { releaseAll(); await once('f', 1500, 'answer call'); continue; }
            if (ph.busy || probe.cutscene() || probe.scripted()) { releaseAll(); continue; }
            const label = probe.action();
            if (label && label.includes(item.label)) {
              releaseAll();
              const shown = probe.life?.()?.interactShown ?? false;
              if (phone && !shown) t.problem('bug', `living-places: Interact button hidden at "${item.label}" on the phone layout`);
              else t.event('interact-button', `${shown ? 'shown' : 'not shown (desktop)'} at "${item.label}"`);
              const before = probe.life?.()?.touchCount ?? 0;
              if (await once('e', 1200, label)) {
                await sleep(700);
                const after = probe.life?.();
                if ((after?.touchCount ?? 0) > before) {
                  const hit = after!.touches[after!.touches.length - 1];
                  t.event('action', `${label} -> ${hit.motion}; sound ${hit.sound}`);
                  t.add('interactions');
                  answered.add(item.id);
                  pressed = true;
                  await sleep(Math.min(2500, 900));
                }
              }
              continue;
            }
            await walkTo({ x: item.x, z: item.z }, `touch-${item.id}`, Math.max(0.5, item.r * 0.7));
          }
          if (!pressed) t.problem('bug', `living-places: could not reach "${item.label}" in ${where.name}`);
        }
        releaseAll();
        // Wait a beat so the people on their routines can look up as he stands among them.
        await sleep(1500);
        const life = probe.life?.();
        const sound = probe.sound();
        t.event('life', `${where.name}: ${life?.people.length ?? 0} people on routines (${(life?.people ?? []).map((x) => `${x.id}:${x.routine}`).join(', ')}), ${life?.glanceCount ?? 0} glances, ${answered.size}/${list.length} touchables answered, steps ${sound.stepCount ?? 0}`);
        for (const g of (life?.glances ?? []).slice(0, 3)) t.event('glance', `${g.who} looked at Pierce (${g.place})`);
        if ((life?.people.length ?? 0) < where.minPeople) t.problem('bug', `living-places: only ${life?.people.length ?? 0} people on routines in ${where.name} (wants ${where.minPeople}+)`);
        if (answered.size < Math.min(4, list.length) && where.place !== 'apex') t.problem('bug', `living-places: ${where.name} answered ${answered.size} touchables`);
        const quiet = life?.maxQuietSeconds ?? 99;
        worstQuiet = Math.max(worstQuiet, quiet);
        t.metric(`quality.maxQuietSeconds.${where.place}`, quiet);
        if (quiet > 10) t.problem('bug', `quality.quiet-gap: ${where.name} quiet stretch ${quiet}s (limit 10)`);
        if (where.place === 'apex') await rewardGoalCheck(phone);
        for (const st of sound.steps ?? []) stepsSeen.push({ surface: st.surface, variant: st.variant });
        t.add('levels');
        done += 1;
        t.progress(done / places.length);
      }
      // Footsteps: one per plant, variants never twice in a row.
      const variants = new Set(stepsSeen.map((x) => `${x.surface}:${x.variant}`));
      let repeats = 0;
      for (let i = 1; i < stepsSeen.length; i += 1) {
        if (stepsSeen[i].surface === stepsSeen[i - 1].surface && stepsSeen[i].variant === stepsSeen[i - 1].variant) repeats += 1;
      }
      t.metric('footstepEvents', stepsSeen.length);
      t.metric('footstepVariants', variants.size);
      t.metric('footstepRepeats', repeats);
      t.event('footsteps', `${stepsSeen.length} foot plants, ${variants.size} surface/variant pairs, ${repeats} immediate repeats`);
      if (stepsSeen.length < 6) t.problem('bug', `living-places: only ${stepsSeen.length} footstep events while walking`);
      if (variants.size < 3) t.problem('bug', `living-places: ${variants.size} footstep variants heard (wants 3+)`);
      if (repeats > 0) t.problem('bug', `living-places: ${repeats} footsteps repeated the same variant back to back`);
      const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      if (heap) t.metric('heapMB', Math.round(heap / 1048576));
      if (phone) probe.phoneFrame(false);
      return worstQuiet <= 10 ? 'done' : 'lost';
    };

    // ---- one level, start to the Level Complete card
    const playLevel = async (n: number): Promise<Outcome> => {
      const info = LEVELS[n - 1];
      const t0 = performance.now();
      levelSteps = 0;
      nav = null;
      lesson = { started: 0, gaveUp: false };
      t.scene(info.name);
      t.event('level-start', info.name);
      mark();
      let endPressed = false;
      let defeats = 0;
      let lastAction = '';
      /** Optional touchables (switch, phone, pole...) already answered once: their prompt stays up while in reach, so walk on past it. */
      const touchedLabels = new Set<string>();
      let perfChecked = false;
      let phoneCallChecked = false;
      let waitBoardChecked = false;
      /** Level 1's route (first-minute pass): Start to the B3 doors, the cab ride, the caption above the touch controls. */
      let cabSeenAt = 0;
      let cabPressedAt = 0;
      let captionChecked = false;
      const phoneRun = Boolean(options.phone);
      await measureLook();
      for (;;) {
        await tick();
        const menu = probe.menu();
        if (menu.open) {
          if (menu.title === 'Defeat') {
            releaseAll();
            defeats += 1;
            t.add('respawns');
            t.event('defeat', `${info.name}, try ${defeats}`);
            if (defeats > 4) return 'lost';
            await sleep(1200);
            if (menu.start) press(probe.startButton, 'Start (retry)');
            await waitControl('retry');
            nav = null;
            continue;
          }
          if (endPressed) break;
          continue;
        }
        if (!probe.running()) continue;
        if (!perfChecked && !new URLSearchParams(location.search).has('debug')) {
          perfChecked = true;
          const perfEl = document.getElementById('perfMonitor');
          const perfCs = perfEl ? getComputedStyle(perfEl) : null;
          if (perfEl && perfCs && perfCs.display !== 'none' && perfCs.visibility !== 'hidden') {
            t.problem('bug', 'FPS / MEM debug pill (#perfMonitor) is visible in normal play');
          } else {
            t.event('hud-check', 'FPS / MEM debug pill hidden in normal play');
          }
        }
        if (probe.cutscene() || probe.scripted()) { releaseAll(); continue; }
        if (!lookSens) await measureLook();
        const phone = probe.phone();
        if (n === 1 && phoneRun && !captionChecked && (phone.incoming || phone.busy || probe.phase() === 'to-window')) {
          // The caption (call card, or Pierce's aside line) must sit fully on screen and clear of the touch controls.
          const cap = [document.getElementById('phonePanel'), document.getElementById('cineHud')]
            .map((el) => (el && shown(el) ? el.getBoundingClientRect() : null)).filter((r): r is DOMRect => Boolean(r));
          if (cap.length && (phone.line || probe.phase() === 'to-window')) {
            captionChecked = true;
            const ctl = ['.controls .stick-ring', '#jumpBtn', '#interactBtn', '#phoneBtn', '#fireBtn']
              .map((sel) => shown(document.querySelector(sel))).filter((r): r is DOMRect => Boolean(r));
            const inside = cap.every((r) => r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight);
            const hit = cap.some((r) => ctl.some((c) => overlaps(r, c)));
            t.event('caption-check', `caption ${inside ? 'fully on screen' : 'cut off'}, ${hit ? 'overlaps a touch control' : 'clear of the touch controls'}`);
            if (!inside || hit) t.problem('bug', `late-call caption is ${inside ? '' : 'cut off by the screen edge'}${hit ? ' under a touch control' : ''} at 390x844`);
          }
        }
        if (n === 1 && !cabSeenAt && probe.phase() === 'cab') {
          cabSeenAt = performance.now();
          t.event('cab-enter', `stepped into the cab at ${((cabSeenAt - t0) / 1000).toFixed(0)} s`);
        }
        if ((phone.incoming || phone.busy) && !phoneCallChecked) {
          const panel = document.getElementById('phonePanel');
          if (panel && panel.classList.contains('calling') && !panel.hidden) {
            phoneCallChecked = true;
            const r = panel.getBoundingClientRect();
            if (r.width > 240 || r.height > 230) {
              t.problem('bug', `phone call UI is too large (${Math.round(r.width)}x${Math.round(r.height)})`);
            } else {
              t.event('phone-call-ui', `compact in corner (${Math.round(r.width)}x${Math.round(r.height)})`);
            }
          }
        }
        if (phone.incoming) { releaseAll(); await once('f', 1500, 'answer call'); t.event('call', phone.speaker || 'incoming'); continue; }
        // The opening call is taken on the move: keep walking to the boardroom while Voss talks.
        if (phone.busy && !(n === 1 && probe.phase() === 'late')) { releaseAll(); continue; }
        const label = probe.action();
        const optional = Boolean(label) && (probe.life?.()?.touchables ?? []).some((x) => x.label === label);
        if (label && !(optional && touchedLabels.has(label))) {
          releaseAll();
          const onB3 = n === 1 && probe.phase() === 'cab' && label === 'Press B3';
          const interactBtn = document.getElementById('interactBtn');
          const viaTap = onB3 && phoneRun && Boolean(shown(interactBtn));
          if (onB3 && phoneRun && !viaTap) t.problem('bug', 'the cab\'s B3 button prompt is up but the Interact button is not shown on the phone layout');
          if (viaTap) await tapAt(interactBtn, 'Interact (Press B3)');
          if (viaTap || (!viaTap && (await once('e', 1200, label)))) {
            if (onB3) {
              cabPressedAt = performance.now();
              t.event('cab-press', `${viaTap ? 'Interact button tapped' : 'E pressed'} for B3 ${cabSeenAt ? ((cabPressedAt - cabSeenAt) / 1000).toFixed(1) : '?'} s after stepping in`);
            }
            if (label === 'End Level' && n === 1) {
              const total = (performance.now() - t0) / 1000;
              t.metric('level1ToElevatorSeconds', Math.round(total));
              if (cabSeenAt) t.metric('elevatorRideSeconds', Math.round((performance.now() - cabSeenAt) / 1000));
              const quiet = probe.apexSlice?.()?.maxQuietSeconds;
              if (quiet !== undefined) t.metric('quality.maxQuietSeconds', quiet);
              t.event('route', `level 1 Start to the B3 doors in ${total.toFixed(0)} s; ride ${cabSeenAt ? ((performance.now() - cabSeenAt) / 1000).toFixed(0) : '?'} s; maxQuietSeconds ${quiet ?? 'n/a'}`);
              if (total >= 240) t.problem('bug', `level 1 took ${total.toFixed(0)} s to the B3 doors (limit 240)`);
            }
            if (label !== lastAction) t.event('action', label);
            lastAction = label;
            if (optional) touchedLabels.add(label);
            levelSteps += 1;
            mark();
            if (label === 'End Level') { endPressed = true; await observeFinale(n); }
          }
          continue;
        }
        const lib = probe.level().libraryId;
        const phase = probe.phase();
        if (phase === 'wait-board' && !waitBoardChecked) {
          waitBoardChecked = true;
          const distText = (document.getElementById('objectiveDist')?.textContent ?? '').trim();
          if (distText) {
            t.problem('bug', `Wait for the board to leave shows frozen distance "${distText}"`);
          } else {
            t.event('wait-board-check', 'objective distance hidden while waiting for board to leave');
          }
        }
        if (lib === 'b3-basement' && phase === 'hunt') {
          await huntStep();
          continue;
        }
        const obj = probe.objective();
        if (lib === 'going-home' && !obj.target && probe.shadow().controls && (await streetLessonStep())) continue;
        // A possess link steers the other body, so let go before walking on.
        if (probe.shadow().linked && (await once('Tab', 1200, 'release link'))) continue;
        let goal = obj.target;
        if (!goal && lib === 'going-home' && probe.shadow().controls) goal = HOME_STAIRS;
        if (!goal) { releaseAll(); continue; }
        // While the board walks out, wait in the room instead of standing in their doorway.
        const arrive = phase === 'wait-board' ? 4 : lib === 'the-station' ? 0.25 : 0.45;
        const there = await walkTo(goal, `${obj.title || 'objective'}: ${obj.text.slice(0, 40)}`, arrive);
        if (there && phase !== 'wait-board') {
          // At the mark and no action yet: inch to the exact point (walk-ups test the trigger radius).
          const p = probe.player();
          if (dist(p, goal) > 0.12) steer(goal, false);
          else releaseAll();
        }
      }
      releaseAll();
      const secs = (performance.now() - t0) / 1000;
      t.metric(`level${n}Seconds`, Math.round(secs));
      t.event('level-end', `${info.name} in ${secs.toFixed(0)} s`);
      return 'won';
    };

    // ---- phone-b3: the phone title card and buttons, About beat 01, B3 with the creature downed early
    const shown = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 ? r : null;
    };
    const box = (r: DOMRect) => `${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`;
    const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const HUD_PARTS: [string, string][] = [['touch controls', '.controls .stick-ring'], ['action buttons', '#jumpBtn'], ['health bar', '#healthBar'], ['objective card', '#objectiveHud']];
    const hudShowing = () => HUD_PARTS.filter(([, sel]) => shown(document.querySelector(sel))).map(([name]) => name);
    const cardOpacity = () => {
      const el = document.getElementById('messageBox');
      return el && !el.classList.contains('hidden') ? +getComputedStyle(el).opacity : 0;
    };

    const phoneChecks = async () => {
      const framed = window.innerWidth > 600;
      if (framed) {
        t.event('setup', `phone layout 390x844 (the viewport is ${window.innerWidth}x${window.innerHeight})`);
        probe.phoneFrame(true);
      }
      t.scene('Phone title card');
      t.progress(0.05);
      await sleep(1200);
      const early = hudShowing();
      t.event('title-card', `card up, level running: ${probe.running()}, HUD showing: ${early.join(', ') || 'none'}`);
      if (early.length) t.problem('bug', `phone: ${early.join(', ')} show around the title card before Start`);
      await sleep(2500);
      if (probe.running()) t.problem('bug', 'phone: the level is running behind the title card before Start was tapped');
      else t.event('check', 'level waits for Start: not running after 3.7 s on the title card');

      const menu = probe.menu();
      press(probe.startButton, menu.start ?? 'Start');
      const t0 = performance.now();
      let goneAt = 0;
      let runAt = 0;
      let hudAt = 0;
      let reported = false;
      while (performance.now() - t0 < 20000 && !(goneAt && runAt && hudAt)) {
        await tick();
        const opacity = cardOpacity();
        const hud = hudShowing();
        const ms = Math.round(performance.now() - t0);
        if (!goneAt && opacity === 0) { goneAt = ms; t.event('card-gone', `${ms} ms after Start`); }
        if (!runAt && probe.running()) { runAt = ms; t.event('level-running', `${ms} ms after Start`); }
        if (!hudAt && hud.length) { hudAt = ms; t.event('hud-shown', `${ms} ms after Start: ${hud.join(', ')}`); }
        if (!reported && opacity > 0 && (hud.length || probe.running())) {
          reported = true;
          t.problem('bug', `phone: ${probe.running() ? 'the level runs' : `${hud.join(', ')} show`} while the title card is still on screen (opacity ${opacity.toFixed(2)})`);
        }
      }
      if (!reported && goneAt) t.event('check', `title card gone first (${goneAt} ms), then the level (${runAt} ms) and HUD (${hudAt} ms)`);
      t.progress(0.15);
      await waitControl('level 1 after Start');
      await sleep(3000);

      t.scene('Phone action buttons');
      t.progress(0.2);
      const frame = document.getElementById('game-root')!.getBoundingClientRect();
      const screen = framed ? frame : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      const scale = framed ? frame.width / 390 : 1;
      const buttons = ['#phoneBtn', '#fireBtn', '#jumpBtn'].map((sel) => [sel, shown(document.querySelector(sel))] as const);
      const stick = shown(document.querySelector('#rightStickZone .stick-ring'));
      const badge = shown(document.getElementById('perfMonitor'));
      for (const [sel, r] of buttons) {
        if (!r) { t.problem('bug', `phone: action button ${sel} is not visible`); continue; }
        const inside = r.left >= screen.left - 0.5 && r.right <= screen.right + 0.5 && r.top >= screen.top - 0.5 && r.bottom <= screen.bottom + 0.5;
        const size = Math.round(r.width / scale);
        t.event('phone-button', `${sel} ${size} px, ${inside ? 'inside' : 'OUTSIDE'} the screen (${box(r)}; screen ${box(screen)})`);
        if (!inside) t.problem('bug', `phone: action button ${sel} is clipped by the screen edge (${box(r)}; screen ${box(screen)})`);
        if (size > 64 || size < 56) t.problem('warning', `phone: action button ${sel} is ${size} px (asked for 56-64)`);
        if (badge && overlaps(r, badge)) t.problem('bug', `phone: the FPS badge covers ${sel} (badge ${box(badge)}; button ${box(r)})`);
      }
      t.event('fps-badge', badge ? `shown at ${box(badge)} (debug build)` : 'hidden');
      const top = Math.min(...buttons.map(([, r]) => r?.top ?? Infinity));
      if (stick && Number.isFinite(top)) {
        const gap = Math.round((top - stick.bottom) / scale);
        t.event('look-stick-gap', `${gap} px between the look stick and the buttons`);
        if (gap < 12) t.problem('bug', `phone: only ${gap} px between the look joystick and the action buttons`);
      }
      await sleep(3000);
      if (framed) {
        probe.phoneFrame(false);
        t.event('setup', 'phone layout off');
      }
    };

    const aboutCheck = async () => {
      t.scene('About page');
      const url = new URL(location.pathname.includes('/play/') ? '../about.html' : './about.html', location.href);
      const frame = document.createElement('iframe');
      frame.src = url.href;
      Object.assign(frame.style, { position: 'fixed', inset: '4%', width: '92%', height: '92%', zIndex: '9999', border: '2px solid #d4b483', background: '#05080c' });
      document.body.appendChild(frame);
      try {
        const until = performance.now() + 20000;
        while (!frame.contentDocument?.querySelector('#basement') && performance.now() < until) await sleep(200);
        await sleep(600);
        const doc = frame.contentDocument;
        if (!doc) { t.problem('warning', `About page did not load in the overlay (${url.href})`); return; }
        const beat = doc.getElementById('board');
        beat?.scrollIntoView({ block: 'center' });
        await sleep(600);
        const read = (id: string) => {
          const lede = doc.querySelector(`#${id} .lede`);
          const r = lede?.getBoundingClientRect();
          const cs = lede ? frame.contentWindow!.getComputedStyle(lede) : null;
          const visible = !!(r && r.height > 0 && cs && cs.visibility !== 'hidden' && +cs.opacity > 0.05);
          return { visible, text: (lede?.textContent ?? '').trim().replace(/\s+/g, ' ') };
        };
        for (const [n, id] of [['01', 'board'], ['02', 'glass'], ['03', 'basement']] as const) {
          const got = read(id);
          t.event('about-beat', `${n} ${got.visible ? 'shows' : 'NO'} paragraph${got.text ? `: ${got.text.slice(0, 80)}…` : ''}`);
          if (!got.visible || got.text.length < 40) t.problem('bug', `About: beat ${n} shows its heading but no paragraph`);
        }
        await sleep(3500);
      } finally {
        frame.remove();
      }
    };

    /** About's "What you can play": a Playable card for levels 1-7, no "still being built out". */
    const aboutLevelsCheck = async (doc: Document, frame: HTMLIFrameElement) => {
      const grid = doc.querySelector('.levels');
      if (!grid) { t.problem('bug', 'About page: no "What you can play" level cards'); return; }
      grid.scrollIntoView({ block: 'center', behavior: 'instant' });
      await sleep(900);
      const cards = [...grid.querySelectorAll<HTMLElement>('.level')];
      const text = (el: Element | null) => (el?.textContent ?? '').trim().replace(/\s+/g, ' ');
      for (let n = 1; n <= 7; n++) {
        const card = cards.find((c) => new RegExp(`^Level ${n}\\b`).test(text(c.querySelector('.kicker'))));
        const kicker = text(card?.querySelector('.kicker') ?? null);
        const r = card?.getBoundingClientRect();
        const cs = card ? frame.contentWindow!.getComputedStyle(card) : null;
        const visible = !!(r && r.width > 0 && r.height > 0 && cs && cs.visibility !== 'hidden' && cs.display !== 'none');
        const ok = !!card && visible && /playable/i.test(kicker);
        if (card) card.style.outline = `2px solid ${ok ? '#d4b483' : '#ff4d4d'}`;
        t.event('about-level', `${ok ? 'shows' : 'NO'} level ${n}${card ? `: "${kicker}" ${text(card.querySelector('h3'))}` : ''}`);
        if (!ok) t.problem('bug', `About page: level ${n} should show a Playable card (got ${card ? `"${kicker}"${visible ? '' : ', hidden'}` : 'none'})`);
      }
      const stale = /still being built out/i.test(text(doc.body));
      t.event('about-stale', stale ? 'the "still being built out" line is still on the page' : 'no "still being built out" line');
      if (stale) t.problem('bug', 'About page still says the rooms are "still being built out"');
      await sleep(3000); // hold the cards for the footage
    };

    /** Each site page in an overlay: the footer's Powered by HAWKES GEN link, and Hawkes Biomedical on Home. */
    const siteLinksCheck = async () => {
      const pages: [string, string][] = [['index.html', 'Home'], ['about.html', 'About'], ['characters.html', 'Characters'], ['whatsnew.html', 'What\'s new']];
      const want: [string, string, RegExp, string][] = [
        ['gen', 'https://hawkesgen.ai', /powered by\s+hawkes gen/i, 'Powered by HAWKES GEN'],
        ['parent', 'https://hawkesbiomedical.com', /hawkes biomedical/i, 'Hawkes Biomedical'],
      ];
      for (const [i, [file, name]] of pages.entries()) {
        t.scene(`${name} page`);
        const url = new URL((location.pathname.includes('/play/') ? '../' : './') + file, location.href);
        const frame = document.createElement('iframe');
        frame.src = url.href;
        Object.assign(frame.style, { position: 'fixed', inset: '4%', width: '92%', height: '92%', zIndex: '9999', border: '2px solid #d4b483', background: '#05080c' });
        document.body.appendChild(frame);
        try {
          const until = performance.now() + 20000;
          while (!frame.contentDocument?.querySelector('footer') && performance.now() < until) await sleep(200);
          await sleep(600);
          const doc = frame.contentDocument;
          const footer = doc?.querySelector('footer');
          if (!doc || !footer) { t.problem('bug', `${name} page did not load in the overlay (${url.href})`); continue; }
          if (file === 'about.html') await aboutLevelsCheck(doc, frame);
          footer.scrollIntoView({ block: 'end', behavior: 'instant' });
          await sleep(900);
          for (const [kind, href, text, label] of want) {
            if (kind === 'parent' && file !== 'index.html') continue;
            const match = (root: ParentNode) => [...root.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) => a.href.replace(/\/$/, '') === href);
            const links = match(footer).length ? match(footer) : match(doc);
            const link = links.find((a) => text.test(a.textContent ?? '')) ?? links[0];
            const r = link?.getBoundingClientRect();
            const cs = link ? frame.contentWindow!.getComputedStyle(link) : null;
            const visible = !!(r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < frame.clientHeight && cs && cs.visibility !== 'hidden' && +cs.opacity > 0.05);
            const shown = (link?.textContent ?? '').trim().replace(/\s+/g, ' ');
            if (link) link.style.outline = '2px solid #d4b483';
            t.event('site-link', `${name}: ${visible && text.test(shown) ? 'shows' : 'NO'} "${label}" → ${href}${link ? ` (text "${shown}", ${visible ? 'visible' : 'not visible'})` : ''}`);
            if (!link) t.problem('bug', `${name} page: no link to ${href}`);
            else if (!visible || !text.test(shown)) t.problem('bug', `${name} page: the ${href} link is not a visible "${label}" (text "${shown}", ${visible ? 'visible' : 'hidden'})`);
          }
          await sleep(2500);
        } finally {
          frame.remove();
        }
        t.progress(0.15 + (0.65 * (i + 1)) / pages.length);
      }
      // The game screen stays as it was: no credit on the title card or in the HUD.
      t.scene('Game screen');
      await sleep(400);
      const inGame = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) => /hawkesgen\.ai|hawkesbiomedical\.com/.test(a.href) || a.hasAttribute('data-hawkes-credit'));
      t.event('game-screen', inGame.length ? `credit links on the game page: ${inGame.map((a) => a.href).join(', ')}` : 'unchanged: no credit links on the game page');
      if (inGame.length) t.problem('bug', `the game page shows ${inGame.length} credit link(s); the credit belongs on the site pages only`);
      await sleep(2000);
    };

    /** Stand still until the objective changes to a hint that matches. */
    const waitHint = async (what: string, test: RegExp, ms: number) => {
      releaseAll();
      const t0 = performance.now();
      t.event('stand-still', `${what}: waiting for a way hint`);
      while (performance.now() - t0 < ms) {
        await tick();
        const obj = probe.objective();
        if (test.test(obj.text)) {
          const secs = ((performance.now() - t0) / 1000).toFixed(0);
          t.event('way-hint', `${what} after ${secs} s: ${obj.title} - ${obj.text}${obj.target ? ` (marker at ${obj.target.x.toFixed(1)}, ${obj.target.z.toFixed(1)})` : ''}`);
          levelSteps += 1;
          mark();
          return true;
        }
        if (Math.round(performance.now() - t0) % 5000 < 70) { levelSteps += 0.05; mark(); }
      }
      t.problem('bug', `B3: no way hint ${what} after ${Math.round(ms / 1000)} s without progress (objective still "${probe.objective().text}")`);
      return false;
    };

    const SHOOT_FROM = { x: 7.2, z: 32.6 }; // inside the lab, by the south door; decon starts at z 30.6
    const earlyDownB3 = async (): Promise<Outcome> => {
      levelIndex = 1;
      await enterLevel(2);
      mark();
      t.scene(LEVELS[1].name);
      t.event('level-start', `${LEVELS[1].name} (creature downed before decon)`);
      await measureLook();
      await waitControl('B3 arrival');
      while (probe.phase() === 'arrive') await tick();
      await waitHint('toward the lab door', /ACID VAT/i, 32000);

      // To the lab door and the reveal, like a player.
      for (;;) {
        await tick();
        if (probe.cutscene()) { releaseAll(); continue; }
        if (probe.phase() === 'hunt') break;
        const phone = probe.phone();
        if (phone.incoming) { releaseAll(); await once('f', 1500, 'answer call'); continue; }
        if (phone.busy) { releaseAll(); continue; }
        const label = probe.action();
        if (label) { releaseAll(); if (await once('e', 1200, label)) t.event('action', label); continue; }
        const goal = probe.objective().target;
        if (goal) await walkTo(goal, 'lab door', 0.45);
      }
      while (probe.cutscene()) await tick();
      await waitHint('after it fled into decon', /decon/i, 32000);

      // Shoot it from the lab without stepping into decon.
      t.scene('B3: down before decon');
      const t0 = performance.now();
      let downAt: { x: number; z: number } | null = null;
      let placed = false;
      let warned = false;
      while (performance.now() - t0 < 60000) {
        await tick();
        const p = probe.player();
        if (!warned && p.z < 30.6 && p.x < 16) { warned = true; t.problem('warning', 'bot stepped into decon before the creature went down'); }
        const beast = probe.creature();
        if (!beast) { downAt = { x: p.x, z: p.z }; break; }
        // Walk toward the south door, stopping short of decon (or where the route ends).
        if (!placed && (dist(p, SHOOT_FROM) < 1.2 || p.z < 31.6 || performance.now() - t0 > 20000)) {
          placed = true;
          t.event('shoot-from', `(${p.x.toFixed(1)}, ${p.z.toFixed(1)}), ${dist(p, beast).toFixed(1)} m from it`);
        }
        if (!placed) { await walkTo(SHOOT_FROM, 'lab, by the south door', 0.45); continue; }
        releaseAll();
        if (!p.weaponDrawn) { await once('q', 1800, 'draw sidearm'); continue; }
        if (p.clip <= 0) { if (p.ammo > 0) await once('r', 2200, 'reload'); continue; }
        const err = face(Math.atan2(beast.x - p.x, beast.z - p.z));
        if ((probe.aimLocked() || Math.abs(err) < 0.12) && performance.now() - lastShot > 420) {
          lastShot = performance.now();
          clickCanvas();
          t.add('shots');
          t.add('interactions');
        }
      }
      if (!downAt) { t.problem('warning', 'bot could not down the creature from the lab in 60 s'); return 'stuck'; }
      t.event('creature-down-early', `Pierce at (${downAt.x.toFixed(1)}, ${downAt.z.toFixed(1)}), outside decon`);
      levelSteps += 2;
      mark();
      const runT0 = performance.now();
      while (!probe.cutscene() && performance.now() - runT0 < 16000) await tick();
      const cut = probe.cutscene();
      if (cut?.id === 'b3-vat-break') t.event('vat-run', `it ran for the vat; vat scene after ${((performance.now() - runT0) / 1000).toFixed(1)} s`);
      else t.problem('bug', 'B3 softlock: the creature went down before Pierce entered decon and never ran for the vat');
      return playLevel(2);
    };

    /**
     * A press on the spot where a player would put a finger or the mouse: whatever is on top there gets it, so a
     * covered control fails. On a touch layout the game's own pointerup handler clicks the button, as on a phone.
     */
    const tapAt = async (el: HTMLElement | null, label: string) => {
      if (!el) throw new Error(`${label} is not on the page`);
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const target = (document.elementFromPoint(x, y) as HTMLElement | null) ?? el;
      if (!el.contains(target)) t.problem('bug', `${label} is covered: a press on it lands on ${target.id ? `#${target.id}` : target.tagName.toLowerCase()}`);
      const touch = document.body.dataset.device === 'mobile' || document.body.dataset.device === 'tablet';
      const init = { pointerType: touch ? 'touch' : 'mouse', pointerId: touch ? 51 : 1, isPrimary: true, button: 0, buttons: 1, bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y };
      target.dispatchEvent(new PointerEvent('pointerdown', init));
      await sleep(60);
      target.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
      if (!touch || !target.closest('button')) target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
      t.add('interactions');
      t.log(`tap ${label}`);
      await sleep(120);
    };
    const tapToPlay = async () => {
      await tapAt(document.getElementById('tapToPlay'), 'Tap to play');
      await t.until(() => !probe.sound().prompt, 5000, 'the Tap to play prompt to go');
      t.event('tap-to-play', 'prompt tapped');
    };

    // ---- first-five: a stranger's first minute. Tap to play on a first visit goes into the B3 hall, in control, with
    // the flashlight on and the creature on screen inside 45 s; a returning player (save cookie) gets the title.
    const firstFiveRun = async () => {
      levelsTotal = 1;
      const SAVE = 'ph-origins-save';
      const hasSave = () => document.cookie.split('; ').some((part) => part.startsWith(`${SAVE}=`));
      if (options.returning && !hasSave()) {
        // Criterion: a run with a save cookie opens on the title. Write one, reload as a returning player.
        document.cookie = `${SAVE}=${encodeURIComponent(JSON.stringify({ unlocked: 2, level: 2 }))}; Path=/; Max-Age=3600; SameSite=Lax`;
        const url = new URL(location.href);
        url.searchParams.set('playtest', 'first-five');
        url.searchParams.set('seed', String(options.seed ?? 1));
        url.searchParams.set('speed', String(options.speed ?? 1));
        t.event('reload', 'a save cookie is written and the page reloads as a returning player');
        location.assign(url.toString());
        await new Promise(() => {});
        return;
      }
      const returning = hasSave();
      const touch = Boolean(options.phone) || document.body.dataset.device === 'mobile' || matchMedia('(pointer: coarse)').matches;
      if (options.phone) { probe.phoneFrame(true); t.event('setup', 'phone layout 390x844 (touch)'); await sleep(300); }
      const byId = (name: string) => document.getElementById(name) as HTMLElement | null;
      const visible = (el: Element) => {
        const check = (el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
        if (check) return check.call(el, { opacityProperty: true, visibilityProperty: true });
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
      };
      // Words a player could read, counted from the tap: visible text only, the Tap to play splash itself excluded.
      const seenWords = new Set<string>();
      const sampleWords = () => {
        for (const el of document.body.querySelectorAll('*')) {
          if (/^(SCRIPT|STYLE|NOSCRIPT|CANVAS|SVG|PATH)$/i.test(el.tagName)) continue;
          if (el.closest('#tapToPlay, #devPanel, #devToggle, #turnPhone, #cineHud:empty')) continue;
          let own = '';
          for (const node of el.childNodes) if (node.nodeType === 3) own += ` ${node.textContent ?? ''}`;
          if (!/\w/.test(own) || !visible(el)) continue;
          for (const word of own.split(/\s+/)) if (/[a-z0-9]/i.test(word)) seenWords.add(word.toLowerCase().replace(/[^a-z0-9']/g, ''));
        }
      };
      const left = byId('leftStickZone');
      let stickDown = false;
      const stick = (ux: number, uy: number) => {
        if (!left) return;
        const zr = left.getBoundingClientRect();
        const type = stickDown ? 'pointermove' : 'pointerdown';
        stickDown = true;
        left.dispatchEvent(new PointerEvent(type, { pointerId: 31, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: zr.left + zr.width / 2 + ux * zr.width * 0.38, clientY: zr.top + zr.height / 2 + uy * zr.height * 0.38 }));
      };
      const lift = () => {
        if (stickDown && left) left.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31, pointerType: 'touch', bubbles: true }));
        stickDown = false;
      };
      const forward = () => { if (touch) stick(0, -1); else setHeld('w'); };
      const stop = () => { if (touch) lift(); else releaseAll(); };

      const t0 = performance.now();
      const since = () => (performance.now() - t0) / 1000;
      if (probe.sound().prompt) await tapToPlay();
      t.event('first-five', 'tapped');
      const turn = byId('turnPhone');
      if (turn && !turn.hidden) {
        await tapAt(byId('turnPhoneAnyway'), 'Play in portrait anyway');
        t.event('portrait-prompt', 'dismissed (counts against secondsToFirstInput)');
      }

      let activeSeen = false;
      let startPos: { x: number; z: number } | null = null;
      let firstInput = -1;
      let firstThreat = -1;
      let firstSuccess = false;
      let cutAt = -1;
      let titleAt = -1;
      let doorSamples = 0;
      let exitLitSeen = false;
      let doorOverlaps = 0;
      let objectiveShown = false;
      let rushAt = -1;
      let rushStart: { x: number; z: number } | null = null;
      let ranAway = false;
      let titleDuringHall = false;
      let lastWords = 0;
      let warmSeen = false;
      let warmMs = 0;
      let smallTargets = 0;
      let scrolledX = false;
      const touchBoxes = () => [...document.querySelectorAll<HTMLElement>('.controls .stick-ring, .controls button, #pauseBtn, #objectiveHud')]
        .filter((el) => visible(el));
      const auditPhoneChrome = () => {
        if (!touch) return;
        if (document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1) {
          if (!scrolledX) {
            scrolledX = true;
            t.problem('bug', `phone 390x844: page scrolls horizontally (${document.documentElement.scrollWidth}px wide at ${innerWidth}px)`);
          }
        }
        for (const el of touchBoxes()) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44)) {
            smallTargets += 1;
            if (smallTargets === 1) {
              t.problem('bug', `phone: #${el.id || el.className} is ${Math.round(r.width)}x${Math.round(r.height)} px (need 44)`);
            }
          }
        }
      };
      let next = 0;
      while (since() < 62) {
        const co = probe.coldOpen?.();
        const now = since();
        if (now >= next) { sampleWords(); if (touch) auditPhoneChrome(); next = now + 0.4; }
        if (returning) {
          if (probe.menu().open && probe.menu().title === 'PH Origins' && titleAt < 0) {
            titleAt = now;
            t.event('title', `a returning player opens on the title after ${now.toFixed(1)} s`);
            break;
          }
          if (co?.active || co?.running) { t.problem('bug', 'a save cookie is present but the cold open started'); break; }
        } else if (co) {
          if (co.active) {
            if (!activeSeen) {
              activeSeen = true;
              // Grace and hitchFailOver100 start when Pierce can walk — not under Tap to play / cold warm.
              frameTrace.reset();
              startPos = { x: probe.player().x, z: probe.player().z };
              t.event('cold-open', `in control ${now.toFixed(1)} s after the tap; flashlight ${co.flashlight ? 'on' : 'OFF'}`);
              t.event('milestone', 'gameplay');
              t.metric('flashlightAtFirstFrame', co.flashlight ? 1 : 0);
              if (co.warmed || co.warmMs > 0) {
                warmSeen = true;
                warmMs = co.warmMs;
                t.event('warm', `cold-open warm ${co.warmMs} ms (corridor + creature)`);
                t.metric('coldWarmMs', co.warmMs);
              }
              if (!co.flashlight) t.problem('bug', 'the cold open starts with the flashlight off');
              if (probe.menu().open) t.problem('bug', 'a menu is open over the cold open');
              forward();
            }
            if (firstInput < 0 && startPos) {
              const p = probe.player();
              if (Math.hypot(p.x - startPos.x, p.z - startPos.z) > 0.2) {
                firstInput = now;
                t.event('first-input', `${touch ? 'left stick' : 'W'} moved Pierce after ${now.toFixed(1)} s`);
                t.event('milestone', 'first-input-accepted');
              }
            }
            if (firstThreat < 0 && co.creatureOnScreen) {
              firstThreat = now;
              t.event('first-threat', `the creature is on screen ${now.toFixed(1)} s after the tap`);
            }
            if (co.rushing) {
              // The response: run back up the hall, away from it, on the stick (or S). The cut comes later than a stand-still.
              if (rushAt < 0) { rushAt = now; t.event('threat', `the creature rushes at ${now.toFixed(1)} s; the player has control and runs`); }
              if (touch) stick(0, 1); else { setHeld('s'); }
              const p = probe.player();
              if (rushStart && Math.hypot(p.x - rushStart.x, p.z - rushStart.z) > 2) ranAway = true;
              if (!rushStart) rushStart = { x: p.x, z: p.z };
            }
            // The first success: he walked into the dark hall and his own flashlight found what was in it.
            if (!firstSuccess && firstInput >= 0 && co.creatureOnScreen && co.flashlight) {
              firstSuccess = true;
              t.event('milestone', 'first-success');
            }
            if (co.exitLit && !exitLitSeen) { exitLitSeen = true; t.event('exit-lit', 'a lit exit stands at the end of the hall and the walls are lifted so the path reads'); }
            if (probe.objective().visible || probe.menu().open) objectiveShown = true;
            if (touch) {
              const door = co.doorway;
              if (door) {
                doorSamples += 1;
                const hit = touchBoxes().find((el) => {
                  const r = el.getBoundingClientRect();
                  return r.left < door.x + door.w && r.right > door.x && r.top < door.y + door.h && r.bottom > door.y;
                });
                if (hit) {
                  doorOverlaps += 1;
                  if (doorOverlaps === 1) t.problem('bug', `a touch control (${hit.id || hit.className}) covers the lit doorway during the cold open`);
                }
              }
            }
          } else if (activeSeen && cutAt < 0) {
            cutAt = now;
            stop();
            t.event('cut', `the creature got him: cut to black ${now.toFixed(1)} s after the tap`);
            if (rushAt >= 0) {
              t.metric('chaseSeconds', Number((now - rushAt).toFixed(1)));
              t.metric('controlAfterThreat', ranAway ? 1 : 0);
              if (!ranAway) t.problem('bug', 'the player could not move after the creature appeared');
              if (now - rushAt < 4) t.problem('bug', `the cut came ${(now - rushAt).toFixed(1)} s after the rush: no time to respond`);
            }
          }
          if (cutAt >= 0 && titleAt < 0 && probe.menu().open && probe.menu().title === 'PH Origins' && !co.cardUp) {
            titleAt = now;
            t.event('title', `the title terminal after ${now.toFixed(1)} s`);
          }
          if (!activeSeen && now > 25) { t.problem('bug', 'Tap to play on a first visit never reached the cold open'); break; }
          if (probe.menu().open && !activeSeen && now < 3) titleDuringHall = true;
        }
        lastWords = seenWords.size;
        await sleep(100);
      }
      stop();
      releaseAll();
      if (returning) {
        if (titleAt < 0) t.problem('bug', 'a returning player did not open on the title terminal');
        t.metric('returningTitleSeconds', Number(titleAt.toFixed(1)));
        t.progress(1);
        t.finish('done');
        return;
      }
      if (since() < 62) {
        // The loop ended early on a problem: keep sampling words to the minute so the number means something.
        while (since() < 60) { sampleWords(); await sleep(400); }
      }
      sampleWords();
      if (touch) auditPhoneChrome();
      t.metric('exitLit', exitLitSeen ? 1 : 0);
      t.metric('secondsToFirstInput', firstInput < 0 ? 999 : Number(firstInput.toFixed(1)));
      t.metric('secondsToFirstThreat', firstThreat < 0 ? 999 : Number(firstThreat.toFixed(1)));
      t.metric('wordsOnScreen60s', seenWords.size);
      t.metric('coldOpenSeconds', cutAt < 0 ? 0 : Number(cutAt.toFixed(1)));
      t.metric('titleSeconds', titleAt < 0 ? 0 : Number(titleAt.toFixed(1)));
      t.metric('doorwaySamples', doorSamples);
      t.metric('doorwayOverlaps', doorOverlaps);
      t.metric('coldWarmMs', warmMs);
      t.metric('feel.coyoteMs', 120);
      t.event('words', [...seenWords].join(' '));
      if (activeSeen) publishFrameTrace(t, 'first-five cold open');
      if (!warmSeen && activeSeen) {
        const late = probe.coldOpen?.();
        if (late?.warmed || (late?.warmMs ?? 0) > 0) {
          warmSeen = true;
          warmMs = late?.warmMs ?? 0;
          t.event('warm', `cold-open warm ${warmMs} ms (late probe)`);
          t.metric('coldWarmMs', warmMs);
        } else {
          t.problem('bug', 'cold open started without a warm pass (corridor/creature/audio under Tap to play)');
        }
      }
      if (firstInput < 0 || firstInput > 10) t.problem('bug', `first input took ${firstInput < 0 ? 'never' : `${firstInput.toFixed(1)} s`} (should be 10 s or less after the tap)`);
      if (firstThreat < 0 || firstThreat > 45) t.problem('bug', `the creature was on screen ${firstThreat < 0 ? 'never' : `${firstThreat.toFixed(1)} s`} after the tap (should be within 45 s)`);
      if (seenWords.size > 15) t.problem('bug', `${seenWords.size} words on screen in the first minute (should be 15 or less)`);
      if (objectiveShown) t.problem('bug', 'an objective or menu was on screen during the cold open');
      if (titleDuringHall) t.problem('bug', 'the title card showed before the cold open');
      if (touch && activeSeen && doorSamples === 0) t.problem('bug', 'the lit doorway was never in view during the cold open');
      if (titleAt < 0) t.problem('bug', 'the title terminal did not follow the cold open within the minute');
      else if (cutAt >= 0 && titleAt - cutAt > 6) t.problem('bug', `the title came ${(titleAt - cutAt).toFixed(1)} s after the cut ("Six hours earlier." should hold about 2 s)`);
      if (touch) {
        t.metric('phoneSmallTargets', smallTargets);
        t.metric('phoneScrollX', scrolledX ? 1 : 0);
      }
      void lastWords;
      t.progress(1);
      t.finish('done');
    };

    // ---- stuck-recovery: idle, the Lost? prompt, Return to objective (key, tap, Pause), at three viewports
    // ---- graphics: the rendering pipeline (src/render/pipeline.ts). Settings tiers, every chapter's look, fps.
    const graphicsRun = async (phone: boolean) => {
      const el = (name: string) => document.getElementById(name) as HTMLElement | null;
      const info = () => probe.render?.() ?? null;
      if (!probe.render) {
        t.problem('bug', 'graphics: the probe has no render() readout');
        t.finish('error');
        return;
      }
      levelsTotal = phone ? 2 : 10;
      levelIndex = 0;
      if (phone) {
        probe.phoneFrame(true, false, { w: 390, h: 844 });
        touchWalk = true;
        t.event('setup', 'phone layout 390x844 (touch); taps and the left stick only');
        await sleep(600);
      }
      const tierButton = (tier: string) => document.querySelector<HTMLButtonElement>(`#graphicsTiers .graphics-tier[data-tier="${tier}"]`);
      const checkRow = () => {
        for (const tier of ['low', 'medium', 'high']) {
          const b = tierButton(tier);
          if (!b) { t.problem('bug', `Settings has no Graphics ${tier} button`); continue; }
          const r = b.getBoundingClientRect();
          if (r.width < 44 || r.height < 44) t.problem('bug', `Graphics ${tier} button is ${Math.round(r.width)}x${Math.round(r.height)} px (44 px minimum)`);
          if (r.right > window.innerWidth + 1 || r.left < -1) t.problem('bug', `Graphics ${tier} button runs off the screen`);
        }
        const checked = document.querySelector<HTMLButtonElement>('#graphicsTiers .graphics-tier[aria-checked="true"]')?.dataset.tier;
        t.event('graphics-row', `Settings: Graphics Low / Medium / High, ${checked ?? 'none'} checked (pipeline ${info()?.tier})`);
        if (checked !== info()?.tier) t.problem('bug', `Settings shows ${checked ?? 'no'} tier checked but the pipeline runs ${info()?.tier}`);
      };
      /** Pick a tier with a real press and time how long until the pipeline runs it (shadows, SSAO, scale). */
      const pickTier = async (tier: 'low' | 'medium' | 'high') => {
        const before = info();
        const started = performance.now();
        await tapAt(tierButton(tier), `Graphics ${tier}`);
        const want = { low: { cascades: 1, ssao: false }, medium: { cascades: 2, ssao: false }, high: { cascades: 3, ssao: true } }[tier];
        let ms = -1;
        while (performance.now() - started < 3000) {
          const now = info();
          if (now && now.tier === tier && (!now.shadows || now.cascades === want.cascades) && (now.ssao === want.ssao || !want.ssao)) { ms = performance.now() - started; break; }
          await frame();
        }
        const after = info();
        t.event('graphics-tier', `${before?.tier} -> ${tier}: ${ms >= 0 ? `${Math.round(ms)} ms` : 'not applied in 3 s'}; cascades ${after?.cascades}, map ${after?.shadowMapSize}, SSAO ${after?.ssao ? 'on' : 'off'}, aberration ${after?.aberration ? 'on' : 'off'}, grain ${after?.grain ? 'on' : 'off'}, scale ${after?.hardwareScaling.toFixed(2)}`);
        if (ms < 0) t.problem('bug', `Graphics ${tier} did not reach the pipeline within 3 s`);
        else if (ms > 1000) t.problem('bug', `Graphics ${tier} took ${Math.round(ms)} ms to change the picture (limit 1 s)`);
        if (tierButton(tier)?.getAttribute('aria-checked') !== 'true') t.problem('bug', `Graphics ${tier} is not shown as checked after the press`);
        return ms;
      };
      const skipScenes = async (ms = 20000) => {
        const until = performance.now() + ms;
        while (performance.now() < until && (probe.cutscene() || probe.scripted() || !probe.running() || probe.menu().open)) {
          const skip = probe.skipButton;
          if ((probe.cutscene() || probe.scripted()) && skip && !skip.hidden && !skip.disabled) press(skip, 'Skip');
          await sleep(400);
        }
      };
      const walkAndStand = async (ms: number) => {
        await skipScenes();
        const until = performance.now() + ms;
        while (performance.now() < until) {
          if (probe.running() && !probe.cutscene() && !probe.scripted() && !probe.menu().open) setHeld('w');
          else releaseAll();
          await tick();
        }
        releaseAll();
        await sleep(1200);
      };
      const sampleFps = async (what: string, ms: number) => {
        await sleep(1500);
        const got: number[] = [];
        const until = performance.now() + ms;
        while (performance.now() < until) {
          await sleep(500);
          got.push(probe.counts().fps);
        }
        const avg = got.reduce((a, b) => a + b, 0) / Math.max(1, got.length);
        t.event('fps', `${what}: ${avg.toFixed(1)} fps average, worst ${Math.min(...got).toFixed(1)} (${got.length} samples)`);
        return avg;
      };
      const checkLook = (label: string, lib: string, tier: string) => {
        const r = info();
        if (!r) return;
        t.event('render', `${label}: tier ${r.tier}, LUT ${r.lut}${r.lutReady ? '' : ' (loading)'}, ${r.toneMapping}, exposure ${r.exposure.toFixed(2)}, bloom ${r.bloom ? `on >${r.bloomThreshold.toFixed(2)}` : 'off'}, shadows ${r.shadows ? `${r.cascades} cascade(s) ${r.shadowMapSize}px, ${r.shadowCasters} casters, strength ${r.shadowStrength}` : 'off'}, SSAO ${r.ssao ? 'on' : 'off'}, aberration ${r.aberration ? 'on' : 'off'}, grain ${r.grain ? 'on' : 'off'}`);
        if (r.toneMapping !== 'aces') t.problem('bug', `${label}: tonemapping is ${r.toneMapping}, not ACES`);
        if (!r.bloom) t.problem('bug', `${label}: bloom is off`);
        if (r.lut !== lib) t.problem('bug', `${label}: the grade is ${r.lut ?? 'none'}, not the chapter's own (${lib})`);
        else if (!r.lutReady) t.problem('warning', `${label}: the chapter LUT (${lib}) has not loaded`);
        if (!r.shadows) t.problem('bug', `${label}: no shadows`);
        else if (r.shadowCasters < 1) t.problem('bug', `${label}: shadows are on but nothing in range casts (Pierce should)`);
        if (tier === 'high' && !r.ssao) t.problem('bug', `${label}: SSAO is off on the high tier`);
        if (tier === 'low' && r.ssao) t.problem('bug', `${label}: SSAO is on on the low tier`);
        if (tier === 'low' && r.cascades !== 1) t.problem('bug', `${label}: the low tier draws ${r.cascades} cascades (1 expected)`);
      };

      // Settings from the title.
      t.scene('Settings: Graphics');
      await tapAt(el('settingsBtn'), 'Settings');
      await sleep(300);
      checkRow();
      if (phone) await pickTier('low');
      await tapAt(el('settingsDoneBtn'), 'Done');
      mark();

      if (phone) {
        t.scene('Chapter 1 (phone, Low)');
        await enterLevel(1);
        await waitControl('control on level 1');
        await walkAndStand(3500);
        checkLook('Chapter 1 (phone)', 'apex-peak', 'low');
        const fps = await sampleFps('Level 1, low tier, 390x844', 6000);
        t.metric('fpsL1Low', Math.round(fps * 10) / 10);
        if (fps < 30) t.problem('bug', `Level 1 on the low tier at 390x844 runs ${fps.toFixed(1)} fps (30 needed)`);
        levelIndex = 1;
        mark();
        touchWalk = false;
        releaseAll();
        probe.phoneFrame(false);
        t.progress(1);
        t.finish('done');
        return;
      }

      // Level 1: switch tiers from Pause > Settings, then the High tier frame rate.
      t.scene('Chapter 1: tiers');
      await enterLevel(1);
      await waitControl('control on level 1');
      await walkAndStand(2500);
      await tapAt(el('pauseBtn'), 'Pause');
      await sleep(300);
      await tapAt(el('pauseSettingsBtn'), 'Settings (Pause)');
      await sleep(300);
      checkRow();
      const switches: number[] = [];
      for (const tier of ['low', 'medium', 'high'] as const) {
        switches.push(await pickTier(tier));
        await sleep(1500); // the footage shows each tier's picture
      }
      t.metric('graphicsSwitchMs', Math.round(Math.max(...switches)));
      await tapAt(el('settingsDoneBtn'), 'Done');
      await sleep(200);
      if (!el('resumeBtn')?.closest('[hidden]')) await tapAt(el('resumeBtn'), 'Resume');
      await waitControl('control after Pause');
      const fpsHigh = await sampleFps('Level 1, high tier', 6000);
      t.metric('fpsL1High', Math.round(fpsHigh * 10) / 10);
      if (fpsHigh < 45) t.problem('bug', `Level 1 on the high tier runs ${fpsHigh.toFixed(1)} fps (45 needed)`);
      levelIndex = 1;
      mark();

      // Every chapter's opening look.
      const fingerprints: { n: number; c: { r: number; g: number; b: number; luma: number } }[] = [];
      const LIBS = ['apex-peak', 'b3-basement', 'the-return', 'the-desk', 'going-home', 'the-station', 'the-train', 'the-morning'];
      for (let n = 1; n <= 8; n += 1) {
        levelIndex = 1 + n;
        t.scene(`Chapter ${n}: ${LEVEL_NAMES[n - 1]}`);
        if (n === 7) await probe.setupHidden('the-train');
        else if (n > 1) await enterLevel(n);
        await waitControl(`control on level ${n}`, 120000);
        await walkAndStand(n === 1 ? 1500 : 2500);
        checkLook(`Chapter ${n}`, LIBS[n - 1], 'high');
        const c = await probe.frameColor?.();
        if (c) {
          fingerprints.push({ n, c });
          t.event('grade-fingerprint', `Chapter ${n} ${LEVEL_NAMES[n - 1]}: mean rgb ${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)}, luma ${c.luma.toFixed(3)}`);
        }
        await sleep(2500); // held for the contact sheet
        mark();
      }
      // Distinct grades: the hue of each chapter's mean colour (chromaticity), greedily clustered.
      const chroma = fingerprints.map(({ n, c }) => {
        const sum = Math.max(1e-4, c.r + c.g + c.b);
        return { n, x: c.r / sum, y: c.g / sum, l: c.luma };
      });
      const groups: (typeof chroma)[] = [];
      for (const p of chroma) {
        const home = groups.find((g) => Math.hypot(g[0].x - p.x, g[0].y - p.y) < 0.012 && Math.abs(g[0].l - p.l) < 0.06);
        if (home) home.push(p);
        else groups.push([p]);
      }
      t.metric('distinctGrades', groups.length);
      t.event('contact-sheet', `${groups.length} distinct grades: ${groups.map((g) => g.map((p) => p.n).join('+')).join(' | ')}`);
      if (fingerprints.length === 8 && groups.length < 5) t.problem('bug', `only ${groups.length} visibly distinct chapter grades (5 needed)`);
      t.progress(1);
      t.finish('done');
    };

    const stuckRecoveryRun = async () => {
      levelsTotal = 1;
      const byId = (name: string) => document.getElementById(name) as HTMLElement | null;
      const gap = () => {
        const target = probe.objective().target;
        const p = probe.player();
        return target ? Math.hypot(p.x - target.x, p.z - target.z) : NaN;
      };
      const visible = (el: HTMLElement | null) => !!el && !el.hidden && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
      const clearOfControls = (vp: string) => {
        const hint = byId('lostHint');
        if (!hint) return;
        const r = hint.getBoundingClientRect();
        const onScreen = r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1;
        if (!onScreen) t.problem('bug', `${vp}: the Lost? prompt leaves the screen (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)})`);
        if (r.height < 36) t.problem('bug', `${vp}: the Lost? prompt is ${Math.round(r.height)} px tall, too small to tap`);
        const covered = [...document.querySelectorAll<HTMLElement>('.controls button, .controls .stick, #pauseBtn, #objectiveHud')].filter((el) => {
          const b = el.getBoundingClientRect();
          return visible(el) && b.width > 0 && !(b.right < r.left || b.left > r.right || b.bottom < r.top || b.top > r.bottom);
        });
        for (const el of covered) t.problem('bug', `${vp}: the Lost? prompt overlaps #${el.id || el.className}`);
        t.event('prompt-layout', `${vp}: prompt ${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.left)},${Math.round(r.top)}; ${covered.length} overlaps`);
      };
      const recover = async (vp: string, how: 'key' | 'tap' | 'pause') => {
        const before = gap();
        const from = probe.player();
        if (how === 'pause') {
          await tapAt(byId('pauseBtn'), 'Pause');
          await t.until(() => probe.sound().paused, 3000, 'Pause');
          if (!visible(byId('pauseReturnBtn'))) t.problem('bug', `${vp}: Pause has no Return to objective`);
          await tapAt(byId('pauseReturnBtn'), 'Return to objective (Pause)');
        } else if (how === 'tap') await tapAt(byId('lostHint'), 'Lost? Return to objective');
        else await tap('r', 'Return to objective');
        await t.until(() => probe.lost().returning, 3000, 'the move to start');
        await t.until(() => !probe.lost().returning, 5000, 'the move to finish');
        await sleep(700);
        const after = gap();
        const p = probe.player();
        t.event('recovered', `${vp} via ${how}: ${Number.isFinite(before) ? before.toFixed(1) : '?'} m -> ${Number.isFinite(after) ? after.toFixed(1) : 'no marker'} m from the objective (moved ${Math.hypot(p.x - from.x, p.z - from.z).toFixed(1)} m)`);
        if (Number.isFinite(after) && after > 5) t.problem('bug', `${vp}: Return to objective left Pierce ${after.toFixed(1)} m from the objective`);
        if (Number.isFinite(after) && Number.isFinite(before) && before > 5 && after >= before) t.problem('bug', `${vp}: Return to objective did not bring Pierce closer (${before.toFixed(1)} m -> ${after.toFixed(1)} m)`);
        if (probe.lost().prompt) t.problem('bug', `${vp}: the Lost? prompt is still up after returning`);
        t.add('recoveries');
      };
      const idlePass = async (vp: string, how: 'key' | 'tap' | 'pause') => {
        await t.until(() => controllable() && probe.objective().visible, 60000, 'control and an objective');
        if (probe.menu().open) throw new Error('a card is up');
        t.scene(`Idle (${vp})`);
        const t0 = performance.now();
        releaseAll();
        // Nothing is pressed: not a key, not a stick. The prompt must come on its own.
        await t.until(() => probe.lost().prompt, 150000, 'the Lost? prompt');
        const secs = (performance.now() - t0) / 1000;
        t.event('lost-prompt', `${vp}: after ${secs.toFixed(0)} s idle (game counted ${probe.lost().idle} s)`);
        t.metric(`lostPromptSeconds${vp}`, Math.round(secs));
        if (secs < 55) t.problem('bug', `${vp}: the Lost? prompt came after only ${secs.toFixed(0)} s`);
        await sleep(400);
        clearOfControls(vp);
        t.scene(`Lost? prompt (${vp})`);
        await sleep(1200);
        await recover(vp, how);
        t.scene(`Returned (${vp})`);
        await sleep(1200);
      };

      if (probe.sound().prompt) await tapToPlay();
      t.scene('Title');
      await sleep(600);
      await enterLevel(1);
      await t.until(() => !(byId('pauseBtn') as HTMLButtonElement).hidden, 30000, 'the Pause button');
      // Pause always offers it, before any 60 s have passed.
      await tapAt(byId('pauseBtn'), 'Pause');
      await t.until(() => probe.sound().paused, 3000, 'Pause');
      t.scene('Paused');
      if (visible(byId('pauseReturnBtn'))) t.event('pause-return', 'Pause offers Return to objective from the first second');
      else t.problem('bug', 'Pause has no Return to objective');
      await sleep(800);
      await tapAt(byId('resumeBtn'), 'Resume');
      await t.until(() => !probe.sound().paused, 3000, 'Resume');
      t.progress(0.1);

      await idlePass(`${innerWidth}x${innerHeight}`, 'key');
      t.progress(0.4);
      probe.phoneFrame(true);
      t.event('setup', 'phone layout 390x844');
      await sleep(1200);
      await idlePass('390x844', 'tap');
      t.progress(0.65);
      probe.phoneFrame(true, true);
      t.event('setup', 'phone layout 844x390');
      await sleep(1200);
      await idlePass('844x390', 'pause');
      probe.phoneFrame(false);
      t.progress(1);
      t.finish('done');
    };

    // ---- screen-mode: the portrait prompt, fullscreen on Start, the Pause switch
    const titleSceneRun = async () => {
      levelsTotal = 1;
      const byId = (name: string) => document.getElementById(name) as HTMLElement | null;
      const phone = !!options.phone;
      if (phone) { probe.phoneFrame(true); t.event('setup', 'phone layout 390x844 (touch)'); await sleep(500); }
      await t.until(() => probe.ready(), 90000, 'game ready');
      t.scene('Title');
      const title = () => probe.title!();
      await t.until(() => title().active, 15000, 'title scene live');
      const t0 = performance.now();
      const first = title();
      t.event('title-scene', `camera ${first.camera.x.toFixed(1)},${first.camera.y.toFixed(1)},${first.camera.z.toFixed(1)}`);
      if (first.camera.z < 38 || first.camera.z > 47.5) t.problem('bug', 'the title camera is not inside the 58th-floor office');
      if (!first.rain) t.problem('bug', 'no rain on the window glass behind the title');
      if (!first.avatarVisible) t.problem('bug', 'Pierce is not standing at the window behind the title');
      await sleep(700);
      if (!title().rainTimeAdvancing) t.problem('bug', 'the rain is not moving behind the title');
      t.metric('titleCameraZ', Number(first.camera.z.toFixed(2)));

      // Main menu: Reset is gone, buttons are big and on screen.
      const shownBtn = (el: HTMLElement | null) => !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
      if (shownBtn(byId('resetBtn'))) t.problem('bug', 'Reset still shows on the main menu');
      else t.event('reset-gone', 'no Reset on the main menu');
      const buttons = [...document.querySelectorAll<HTMLElement>('#messageBox .button-row button')].filter(shownBtn);
      let minPx = 999;
      for (const b of buttons) {
        const r = b.getBoundingClientRect();
        minPx = Math.min(minPx, r.height);
        if (r.height < 43.5) t.problem('bug', `title button "${b.textContent?.trim()}" is ${r.height.toFixed(0)} px tall (44 needed)`);
        if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) t.problem('bug', `title button "${b.textContent?.trim()}" runs off the screen`);
      }
      t.metric('titleMinButtonPx', Math.round(minPx));
      t.event('title-buttons', `${buttons.length} buttons, smallest ${Math.round(minPx)} px`);

      // The lightning: a flash and the Shadow reflection within 30 s of the title.
      let sawReflection = false;
      await t.until(() => { if (title().reflectionShown) sawReflection = true; return title().flashes >= 1; }, 30000, 'lightning flash');
      const flashAt = (performance.now() - t0) / 1000;
      await sleep(900);
      if (title().reflectionShown) sawReflection = true;
      t.metric('titleFlashSeconds', Number(flashAt.toFixed(1)));
      t.metric('titleReflectionMs', Math.round(title().reflectionMs));
      if (!sawReflection && title().reflectionMs <= 0) t.problem('bug', 'the flash never showed the Shadow reflection');
      else t.event('reflection', `Shadow-form reflection shown ${Math.round(title().reflectionMs)} ms, ${flashAt.toFixed(1)} s after the title; stings ${title().stings}`);
      if (!title().musicPlaying) t.problem('bug', 'the title theme is not playing');

      // Menu sounds: hover (pointer), select, back.
      const before = title().menuSounds.plays;
      const settingsBtn = byId('settingsBtn');
      if (!phone && settingsBtn) {
        settingsBtn.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', bubbles: false }));
        await sleep(200);
        if (title().menuSounds.last !== 'hover') t.problem('bug', 'hovering a menu button played no sound');
      }
      await tapAt(settingsBtn, 'Settings');
      await sleep(400);
      if (title().menuSounds.plays <= before) t.problem('bug', 'pressing Settings played no menu sound');
      else t.event('menu-sound', `select played (${title().menuSounds.plays - before} sounds)`);

      // Reset is in Settings, behind a confirm.
      const rp = byId('resetProgressBtn');
      if (!shownBtn(rp)) t.problem('bug', 'Settings has no Reset');
      else {
        const rr = rp!.getBoundingClientRect();
        if (rr.height < 43.5) t.problem('bug', `Settings Reset is ${rr.height.toFixed(0)} px tall`);
        await tapAt(rp, 'Reset');
        await sleep(300);
        if (!shownBtn(byId('resetConfirmBtn'))) t.problem('bug', 'Reset did not ask for a confirm');
        else t.event('reset-confirm', 'Settings > Reset asks "Erase all progress?"');
        await tapAt(byId('resetCancelBtn'), 'Keep it');
        await sleep(300);
      }
      const plays = title().menuSounds.plays;
      await tapAt(byId('settingsDoneBtn'), 'Done');
      await sleep(300);
      if (title().menuSounds.plays <= plays || title().menuSounds.last !== 'back') t.problem('bug', 'Done / back played no back sound');
      t.metric('titleMenuSounds', title().menuSounds.plays);
    };
    const screenModeRun = async () => {
      levelsTotal = 1;
      const byId = (name: string) => document.getElementById(name) as HTMLElement | null;
      const sm = probe.screenMode;
      const shown = () => sm.prompt().showing;
      if (probe.sound().prompt) await tapToPlay();
      t.scene('Title');
      // Desktop: nothing changes.
      if (shown()) t.problem('bug', 'the portrait prompt shows on a desktop');
      else t.event('desktop', `no portrait prompt at ${innerWidth}x${innerHeight}`);

      // Touch phone held upright.
      probe.phoneFrame(true);
      sm.asTouch(true);
      await sleep(500);
      if (!shown()) t.problem('bug', 'a touch phone held in portrait shows no "Turn your phone sideways" screen');
      else {
        const text = sm.prompt().text;
        const r = byId('turnPhone')!.getBoundingClientRect();
        if (!/Turn your phone sideways/i.test(text)) t.problem('bug', `the portrait screen says "${text}"`);
        if (r.width < innerWidth - 1 || r.height < innerHeight - 1) t.problem('bug', 'the portrait screen does not fill the viewport');
        if (!/Play in portrait anyway/i.test(text)) t.problem('bug', 'the portrait screen has no "Play in portrait anyway" link');
        t.event('portrait-prompt', `shown at 390x844: ${text}`);
      }
      t.scene('Turn your phone sideways');
      await sleep(800);
      probe.phoneFrame(true, true);
      sm.refresh();
      await sleep(500);
      if (shown()) t.problem('bug', 'the portrait screen stays up in landscape');
      else t.event('landscape', 'turned sideways: the screen is gone');
      t.scene('Title');
      await sleep(600);
      probe.phoneFrame(true);
      sm.refresh();
      await sleep(400);
      if (!shown()) t.problem('bug', 'the portrait screen did not come back in portrait');
      else t.event('portrait-again', 'upright again: the screen is back');
      await tapAt(byId('turnPhoneAnyway'), 'Play in portrait anyway');
      await sleep(300);
      sm.refresh();
      if (shown()) t.problem('bug', '"Play in portrait anyway" did not dismiss the screen');
      else t.event('dismissed', 'Play in portrait anyway: the screen is gone for the session');
      await sleep(600);

      // Start on a touch device asks for fullscreen, then the landscape lock.
      const before = sm.attempts();
      const start = byId('startBtn');
      let guard = 0;
      while (probe.menu().startEnabled === false && guard++ < 600) await sleep(100);
      await tapAt(start, 'Start');
      await sleep(600);
      const after = sm.attempts();
      t.event('start-fullscreen', `Start asked for fullscreen ${after.fullscreen - before.fullscreen}x and the landscape lock ${after.lock - before.lock}x; fullscreen is ${sm.fullscreen().active ? 'on' : 'off'}`);
      if (after.fullscreen === before.fullscreen && sm.fullscreen().supported) t.problem('bug', 'Start on a touch device did not ask for fullscreen');
      await waitControl('level 1 to start');
      t.scene('Level 1');

      // Pause: a Fullscreen switch where the API exists.
      await tapAt(byId('pauseBtn'), 'Pause');
      await t.until(() => probe.sound().paused, 3000, 'Pause');
      t.scene('Paused');
      const btn = byId('fullscreenBtn') as HTMLButtonElement | null;
      if (!sm.fullscreen().supported) t.event('fullscreen-api', 'this browser has no fullscreen API: the switch is hidden');
      else if (!btn || btn.hidden) t.problem('bug', 'Pause has no Fullscreen switch though the browser can do it');
      else {
        t.event('fullscreen-switch', `Pause shows "${btn.textContent}"`);
        await tapAt(btn, 'Fullscreen');
        await sleep(800);
        t.event('fullscreen-on', `after the tap: "${btn.textContent}", fullscreen ${sm.fullscreen().active ? 'on' : 'off'}`);
        await tapAt(btn, 'Fullscreen');
        await sleep(800);
        t.event('fullscreen-off', `after the second tap: "${btn.textContent}", fullscreen ${sm.fullscreen().active ? 'on' : 'off'}`);
      }
      await tapAt(byId('resumeBtn'), 'Resume');
      await t.until(() => !probe.sound().paused, 3000, 'Resume');
      sm.asTouch(false);
      probe.phoneFrame(false);
      t.progress(1);
      t.finish('done');
    };

    // ---- objective-marker: the HUD waypoint over the live objective, edge clamp, hiding, clear of touch controls
    const objectiveMarkerRun = async () => {
      levelsTotal = 1;
      const byId = (name: string) => document.getElementById(name) as HTMLElement | null;
      const hit = (a: { left: number; top: number; right: number; bottom: number }, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const touchBoxes = () => [...document.querySelectorAll<HTMLElement>('.controls button, .left-stick-zone, .right-stick-zone, #pauseBtn, #phoneBtn, .ability-readout, .inventory-hud, .missions-hud, .missions-panel')]
        .filter((el) => !el.hidden && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0);
      const seenBad = new Set<string>();
      /** The box is on screen and over none of the controls. */
      const checkBox = (vp: string, mobile: boolean) => {
        const w = probe.waypoint();
        if (!w.shown || !w.rect) return;
        const r = w.rect;
        const rootRect = (byId('game-root') ?? document.body).getBoundingClientRect();
        if (r.left < rootRect.left - 1 || r.right > rootRect.right + 1 || r.top < rootRect.top - 1 || r.bottom > rootRect.bottom + 1) {
          const key = `${vp}-out`;
          if (!seenBad.has(key)) { seenBad.add(key); t.problem('bug', `${vp}: the waypoint leaves the screen (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)})`); }
        }
        for (const el of touchBoxes()) {
          if (!mobile && !el.matches('#pauseBtn, .ability-readout, .inventory-hud')) continue;
          if (hit(r, el.getBoundingClientRect())) {
            const key = `${vp}-${el.id || el.className}`;
            if (!seenBad.has(key)) { seenBad.add(key); t.problem('bug', `${vp}: the waypoint covers #${el.id || el.className} (waypoint ${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)})`); }
          }
        }
      };
      const answer = async () => {
        const phone = probe.phone();
        if (phone.incoming) { releaseAll(); await once('f', 1500, 'answer call'); t.event('call', phone.speaker || 'incoming'); }
      };

      const pass = async (vp: string, mobile: boolean) => {
        t.scene(`Waypoint (${vp})`);
        await t.until(() => controllable() && probe.objective().visible && !!probe.objective().target, 90000, 'control and an objective marker');
        await t.until(() => probe.waypoint().shown, 10000, 'the waypoint to show');
        let w = probe.waypoint();
        const obj = probe.objective();
        const p = probe.player();
        const real = Math.hypot(p.x - obj.target!.x, p.z - obj.target!.z);
        t.event('waypoint', `${vp}: "${w.name}" ${w.distance} m, ${w.clamped ? 'clamped' : 'on screen'} (objective "${obj.text}", ${real.toFixed(1)} m)`);
        if (w.name.trim() !== obj.text.trim()) t.problem('bug', `${vp}: waypoint says "${w.name}", the objective says "${obj.text}"`);
        if (Math.abs(w.distance - real) > 3) t.problem('bug', `${vp}: waypoint distance ${w.distance} m, real distance ${real.toFixed(1)} m`);
        // Turn the camera with touch drags: look for both the on-screen and the edge-clamped states.
        let onScreen = !w.clamped ? w : null;
        let edge = w.clamped ? w : null;
        for (let i = 0; i < 90 && !(onScreen && edge); i++) {
          dragLook(16);
          await frame();
          await frame();
          await answer();
          w = probe.waypoint();
          if (!w.shown) continue;
          checkBox(vp, mobile);
          if (w.clamped && !edge) {
            edge = w;
            t.event('waypoint-edge', `${vp}: clamped at ${w.x},${w.y}, arrow ${w.angle} deg`);
            t.scene(`Edge-clamped (${vp})`);
            await sleep(800);
          }
          if (!w.clamped && !onScreen) {
            onScreen = w;
            t.event('waypoint-onscreen', `${vp}: over the objective at ${w.x},${w.y}`);
            t.scene(`On screen (${vp})`);
            await sleep(800);
          }
        }
        if (!onScreen) t.problem('bug', `${vp}: the waypoint never showed over the objective while the camera turned`);
        if (!edge) t.problem('bug', `${vp}: the waypoint never clamped to the screen edge while the camera turned`);
        else if (!(byId('objectiveWaypoint')?.classList.contains('edge'))) t.problem('bug', `${vp}: edge-clamped waypoint has no arrow`);
        // Sweep once more all the way round, checking the box against the controls at every angle.
        for (let i = 0; i < 40; i++) {
          dragLook(20);
          await frame();
          checkBox(vp, mobile);
        }
        // With the Missions panel open the label must stay clear of it too (it covers the centre on a phone).
        if (mobile) {
          await tapAt(byId('missionsHint'), 'Missions');
          await sleep(300);
          for (let i = 0; i < 40; i++) {
            dragLook(20);
            await frame();
            checkBox(`${vp} (Missions open)`, mobile);
          }
          t.event('waypoint-missions', `${vp}: swept the camera with Missions open`);
          await tapAt(byId('missionsClose'), 'Close missions');
          await sleep(300);
        }
        // Pause hides it.
        await tapAt(byId('pauseBtn'), 'Pause');
        await t.until(() => probe.sound().paused, 3000, 'Pause');
        await sleep(400);
        if (probe.waypoint().shown) t.problem('bug', `${vp}: the waypoint still shows under Pause`);
        else t.event('waypoint-hidden', `${vp}: hidden in Pause`);
        await tapAt(byId('resumeBtn'), 'Resume');
        await t.until(() => !probe.sound().paused, 3000, 'Resume');
        await t.until(() => probe.waypoint().shown, 5000, 'the waypoint after Resume');
        t.add('waypointPasses');
      };

      if (probe.sound().prompt) await tapToPlay();
      t.scene('Title');
      await sleep(600);
      await enterLevel(1);
      await measureLook();
      t.progress(0.1);
      await pass(`${innerWidth}x${innerHeight}`, false);
      t.progress(0.3);
      probe.phoneFrame(true);
      t.event('setup', 'phone layout 390x844');
      await sleep(1200);
      await pass('390x844', true);
      t.progress(0.5);
      probe.phoneFrame(true, true);
      t.event('setup', 'phone layout 844x390');
      await sleep(1200);
      await pass('844x390', true);
      probe.phoneFrame(false);
      await sleep(800);
      t.progress(0.65);

      // The board scene hides it: walk to the head chair with real input and press Join meeting.
      t.scene('Board scene');
      const until = performance.now() + 120000;
      let sceneSeen = false;
      while (performance.now() < until) {
        await tick();
        if (probe.cutscene()) { sceneSeen = true; break; }
        if (!controllable()) continue;
        await answer();
        if (probe.phone().busy) { releaseAll(); continue; }
        const label = probe.action();
        if (label) { releaseAll(); if (await once('e', 1500, label)) t.event('action', label); continue; }
        const goal = probe.objective().target;
        if (goal) await walkTo(goal, 'seat');
      }
      releaseAll();
      if (!sceneSeen) t.problem('bug', 'objective-marker: the board scene did not start');
      else {
        await sleep(1500);
        if (probe.waypoint().shown) t.problem('bug', `the waypoint still shows during the ${probe.cutscene()?.id ?? 'cutscene'} scene`);
        else t.event('waypoint-hidden', `hidden during ${probe.cutscene()?.id ?? 'the scene'}`);
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        await sleep(1500);
      }
      t.progress(0.85);

      // The Defeat card hides it too.
      if (probe.forceDefeat()) {
        t.event('defeat', 'test shortcut');
        await t.until(() => probe.menu().title === 'Defeat', 30000, 'the Defeat card');
        await sleep(1200);
        t.scene('Defeat card');
        if (probe.waypoint().shown) t.problem('bug', 'the waypoint still shows on the Defeat card');
        else t.event('waypoint-hidden', 'hidden on the Defeat card');
      }
      t.progress(1);
      t.finish(sceneSeen ? 'done' : 'stuck');
    };

    // ---- cutscene-ui: cinematic HUD/letterbox/Skip + camera/subtitle Settings
    const cutsceneUiRun = async () => {
      const byId = (id: string) => document.getElementById(id);
      const SETTINGS_KEY = 'hawkes.settings';
      const SETTINGS_RUN_KEY = 'hawkes.playtest.cutscene-ui';
      const savedSettings = () => {
        try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Record<string, unknown> | null; } catch { return null; }
      };
      const carried = (() => {
        try {
          return JSON.parse(sessionStorage.getItem(SETTINGS_RUN_KEY) ?? 'null') as {
            original: string | null; soundOriginal: string | null;
          } | null;
        } catch { return null; }
      })();
      const slide = (input: HTMLInputElement | null, value: number, label: string) => {
        if (!input) return;
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        t.add('interactions');
        t.log(`slide ${label} to ${value}`);
      };
      const overlaps = (a: DOMRect, b: DOMRect) =>
        !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
      const checkCinematic = (where: string) => {
        const cine = probe.cinematic?.();
        if (!cine?.on) t.problem('bug', `${where}: body is not cinematic during the scene`);
        else t.event('cinematic-on', where);
        if (!cine?.letterbox) t.problem('bug', `${where}: letterbox bars missing`);
        else t.event('letterbox', where);
        const health = byId('healthBar');
        const pause = byId('pauseBtn');
        const objective = byId('objectiveHud');
        const skip = probe.skipButton;
        for (const [name, el] of [['health', health], ['pause', pause], ['objective', objective]] as const) {
          if (!el) continue;
          const vis = getComputedStyle(el).visibility;
          const op = Number(getComputedStyle(el).opacity);
          if (vis !== 'hidden' && op > 0.05 && !el.hasAttribute('hidden')) {
            t.problem('bug', `${where}: ${name} still visible during the scene`);
          } else t.event('hud-hidden', `${where}: ${name}`);
        }
        if (!skip || skip.hidden) {
          t.problem('bug', `${where}: Skip is not shown`);
          return;
        }
        const sr = skip.getBoundingClientRect();
        if (sr.top < innerHeight * 0.5) t.problem('bug', `${where}: Skip is not in the bottom half (${Math.round(sr.top)} of ${innerHeight})`);
        else t.event('skip-bottom', `${where}: top ${Math.round(sr.top)}`);
        const healthR = health?.getBoundingClientRect();
        const healthVisible = Boolean(health && Number(getComputedStyle(health).opacity) > 0.05 && getComputedStyle(health).visibility !== 'hidden');
        if (healthVisible && healthR && overlaps(sr, healthR)) {
          t.problem('bug', `${where}: Skip overlaps the health bar`);
        } else t.event('skip-clear', where);
        const left = byId('leftStickZone');
        const right = byId('rightStickZone');
        for (const stick of [left, right]) {
          if (!stick) continue;
          const cs = getComputedStyle(stick);
          if (cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && cs.display !== 'none') {
            t.problem('bug', `${where}: touch stick still visible during the scene`);
          }
        }
        const line = byId('cineText');
        if (line) {
          const cs = getComputedStyle(line);
          if (cs.whiteSpace !== 'nowrap' && (line.textContent ?? '').trim()) {
            t.problem('bug', `${where}: caption is not one line (white-space ${cs.whiteSpace})`);
          } else if ((line.textContent ?? '').trim()) t.event('caption-one-line', where);
        }
        {
          // Voice is the loudest thing in a scene: no one-shot sfx gain above the scene ceiling or a voice gain.
          const mix = probe.sound().sceneMix;
          if (mix && mix.entries.length) {
            t.metric('sceneSfxMaxGain', Number(mix.maxSfx.toFixed(3)));
            if (mix.sfxToVoiceDb != null) t.metric('sceneSfxToVoiceDb', Number(mix.sfxToVoiceDb.toFixed(1)));
            t.event('scene-mix', `${where}: sfx max ${mix.maxSfx.toFixed(2)}, voice min ${mix.minVoice.toFixed(2)}, ${mix.sfxToVoiceDb == null ? 'no voice yet' : `${mix.sfxToVoiceDb.toFixed(1)} dB`}, capped ${mix.capped}`);
            if (mix.minVoice > 0 && mix.maxSfx > mix.minVoice) t.problem('bug', `${where}: a scene sfx (${mix.maxSfx.toFixed(2)}) is louder than the voice (${mix.minVoice.toFixed(2)})`);
          }
        }
        t.scene(`Cinematic ${where}`);
      };
      const auditSkipAt = async (vp: string) => {
        await sleep(400);
        const skip = probe.skipButton;
        if (!skip || skip.hidden) {
          t.problem('bug', `${vp}: Skip missing while auditing layout`);
          return;
        }
        const sr = skip.getBoundingClientRect();
        if (sr.left < -1 || sr.top < -1 || sr.right > innerWidth + 1 || sr.bottom > innerHeight + 1) {
          t.problem('bug', `${vp}: Skip leaves the screen (${Math.round(sr.left)},${Math.round(sr.top)} ${Math.round(sr.width)}x${Math.round(sr.height)})`);
        } else t.event('skip-on-screen', `${vp}: ${Math.round(sr.left)},${Math.round(sr.top)}`);
        const others = ['healthBar', 'pauseBtn', 'objectiveHud', 'objectiveWaypoint', 'cineHud', 'leftStickZone', 'rightStickZone', 'fireBtn', 'jumpBtn']
          .map((id) => byId(id))
          .filter((el): el is HTMLElement => Boolean(el));
        for (const el of others) {
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05 || cs.display === 'none' || el.hasAttribute('hidden')) continue;
          if (el.id === 'cineHud' && !el.classList.contains('on')) continue;
          if (overlaps(sr, el.getBoundingClientRect())) t.problem('bug', `${vp}: Skip overlaps #${el.id}`);
        }
      };

      if (!carried) {
        if (probe.sound().prompt) await tapToPlay();
        t.scene('Title');
        await sleep(500);
        await tapAt(byId('settingsBtn'), 'Settings (title)');
        await t.until(() => probe.sound().settingsOpen, 3000, 'Settings to open');
        t.scene('Settings');
        for (const id of ['invertYSwitch', 'mouseSens', 'touchSens', 'subsSwitch', 'subsSize', 'subsBoxSwitch']) {
          if (!byId(id)) t.problem('bug', `Settings missing #${id}`);
          else t.event('settings-control', id);
        }
        probe.phoneFrame(true);
        await sleep(500);
        const panel = byId('settingsMenu')?.querySelector('.panel') as HTMLElement | null;
        if (panel) {
          const r = panel.getBoundingClientRect();
          if (r.bottom > innerHeight + 2 || r.right > innerWidth + 2) {
            t.problem('bug', `Settings card clips at 390x844 (${Math.round(r.width)}x${Math.round(r.height)})`);
          } else t.event('settings-fits', `390x844 panel ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        probe.phoneFrame(false);
        const original = localStorage.getItem(SETTINGS_KEY);
        const soundOriginal = localStorage.getItem(SOUND_KEY);
        if (byId('invertYSwitch')?.getAttribute('aria-checked') !== 'true') await tapAt(byId('invertYSwitch'), 'Invert Y on');
        slide(byId('mouseSens') as HTMLInputElement, 150, 'Mouse sensitivity');
        slide(byId('touchSens') as HTMLInputElement, 125, 'Touch sensitivity');
        slide(byId('subsSize') as HTMLInputElement, 2, 'Subtitle size');
        if (byId('subsBoxSwitch')?.getAttribute('aria-checked') !== 'true') await tapAt(byId('subsBoxSwitch'), 'Subtitle box on');
        await sleep(400);
        const now = savedSettings();
        if (!now || now.invertY !== true || Math.abs(Number(now.mouseSens) - 1.5) > 0.02
          || Math.abs(Number(now.touchSens) - 1.25) > 0.02 || now.subtitleSize !== 'lg' || now.subtitleBox !== true) {
          t.problem('bug', `hawkes.settings did not save invert/sens/size/box: ${JSON.stringify(now)}`);
        } else t.event('setting-saved', JSON.stringify(now));
        const live = probe.playSettings?.();
        if (!live?.invertY || Math.abs((live.mouseSens ?? 0) - 1.5) > 0.02
          || Math.abs((live.touchSens ?? 0) - 1.25) > 0.02 || live.subtitleSize !== 'lg' || live.subtitleBox !== true) {
          t.problem('bug', 'Settings did not apply at once');
        } else t.event('setting-applied', JSON.stringify(live));
        await tapAt(byId('settingsDoneBtn'), 'Done');
        sessionStorage.setItem(SETTINGS_RUN_KEY, JSON.stringify({ original, soundOriginal }));
        t.event('reload', 'page reloads; cutscene-ui continues');
        const url = new URL(location.href);
        url.searchParams.set('playtest', 'cutscene-ui');
        url.searchParams.set('seed', String(options.seed ?? 1));
        url.searchParams.set('speed', String(options.speed ?? 1));
        await sleep(200);
        location.replace(url.toString());
        await new Promise(() => {});
        return;
      }

      sessionStorage.removeItem(SETTINGS_RUN_KEY);
      if (probe.sound().prompt) await tapToPlay();
      const back = probe.playSettings?.();
      if (!back || back.invertY !== true || Math.abs(back.mouseSens - 1.5) > 0.02
        || Math.abs(back.touchSens - 1.25) > 0.02 || back.subtitleSize !== 'lg' || back.subtitleBox !== true) {
        t.problem('bug', `settings did not survive reload: ${JSON.stringify(back)}`);
      } else t.event('setting-survived-reload', JSON.stringify(back));
      t.progress(0.2);

      // Level 1 board cutscene
      await enterLevel(1);
      t.scene(LEVELS[0].name);
      const until = performance.now() + 150000;
      let boardSeen = false;
      while (performance.now() < until) {
        await tick();
        if (probe.cutscene()) { boardSeen = true; break; }
        if (!controllable()) continue;
        if (probe.phone().incoming) { await once('f', 1500, 'answer'); continue; }
        if (probe.phone().busy) { releaseAll(); continue; }
        const label = probe.action();
        if (label) { releaseAll(); await once('e', 1500, label); continue; }
        const goal = probe.objective().target;
        if (goal) await walkTo(goal, 'seat');
      }
      releaseAll();
      if (!boardSeen) t.problem('bug', 'level 1 board cutscene did not start');
      else {
        await sleep(800);
        checkCinematic('level-1 board');
        await auditSkipAt(`${innerWidth}x${innerHeight}`);
        probe.phoneFrame(true, true);
        await auditSkipAt('844x390');
        probe.phoneFrame(true, false);
        await auditSkipAt('390x844');
        probe.phoneFrame(false);
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        await t.until(() => !probe.cutscene(), 8000, 'board cutscene ends');
        t.event('cinematic-off', 'after Skip on level 1');
        if (probe.cinematic?.().on) t.problem('bug', 'cinematic stayed on after the board scene');
      }
      t.progress(0.55);

      // Level 7 opening (scripted scene)
      t.event('setup', 'start at level 7 (the-train)');
      await probe.setupHidden('the-train');
      await t.until(() => probe.running() && (probe.scripted() || probe.cutscene()), 90000, 'train opening');
      await sleep(600);
      checkCinematic('level-7 opening');
      await auditSkipAt(`${innerWidth}x${innerHeight}`);
      if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
      await t.until(() => controllable(), 8000, 'control after train Skip');
      t.progress(0.75);

      // Level 8 opening
      t.event('setup', 'start at level 8');
      probe.phoneFrame(true, false);
      await probe.setupLevel(8);
      await t.until(() => probe.running() && (probe.scripted() || probe.cutscene()), 90000, 'morning opening');
      await sleep(600);
      checkCinematic('level-8 opening (phone 390x844)');
      await auditSkipAt('390x844 level 8');
      // Phone, touch only: sticks stay hidden and every caption fits on one line for the whole scene, then one
      // held touch on Skip (hold ~0.85 s) completes it.
      const sticksHidden = () => ['leftStickZone', 'rightStickZone', 'fireBtn', 'jumpBtn'].every((id) => {
        const el = byId(id);
        if (!el) return true;
        const cs = getComputedStyle(el);
        return cs.visibility === 'hidden' || Number(cs.opacity) < 0.05 || cs.display === 'none';
      });
      let sticksOk = true;
      let captionOk = true;
      const phoneSkip = probe.skipButton;
      if (phoneSkip && !phoneSkip.hidden) {
        const r = phoneSkip.getBoundingClientRect();
        const init = { pointerType: 'touch', pointerId: 61, isPrimary: true, button: 0, buttons: 1, bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
        phoneSkip.dispatchEvent(new PointerEvent('pointerdown', init));
        t.log('touch hold on Skip');
        const holdEnd = performance.now() + 2500;
        while (performance.now() < holdEnd && probe.cinematic?.().on) {
          await sleep(100);
          if (!sticksHidden()) sticksOk = false;
          const line = byId('cineText');
          if (line && (line.textContent ?? '').trim()) {
            const box = byId('cineHud')?.getBoundingClientRect();
            if (getComputedStyle(line).whiteSpace !== 'nowrap' || (box && (box.left < -1 || box.right > innerWidth + 1))) captionOk = false;
          }
        }
        phoneSkip.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
      } else t.problem('bug', 'level 8 phone: Skip is not shown');
      if (!sticksOk) t.problem('bug', 'level 8 phone: touch controls showed during the scene');
      else t.event('sticks-hidden-whole-scene', 'level 8 at 390x844');
      if (!captionOk) t.problem('bug', 'level 8 phone: a caption wrapped or left the screen at 390x844');
      else t.event('caption-fits-phone', 'level 8 at 390x844');
      await sleep(800);
      if (probe.cinematic?.().on) t.problem('bug', 'level 8 phone: one held touch on Skip did not end the scene');
      else t.event('hold-skip-completed', 'level 8 at 390x844');
      probe.phoneFrame(false);
      t.progress(0.95);

      if (carried.original === null) localStorage.removeItem(SETTINGS_KEY);
      else localStorage.setItem(SETTINGS_KEY, carried.original);
      if (carried.soundOriginal === null) localStorage.removeItem(SOUND_KEY);
      else localStorage.setItem(SOUND_KEY, carried.soundOriginal);
      t.progress(1);
      t.finish(boardSeen ? 'done' : 'stuck');
    };


    // ---- quiet-light: Morning shafts + TV spill, Desk lamp + mirror text, Return buzz tube
    const quietLightRun = async (): Promise<Outcome> => {
      levelsTotal = 1;
      const phone = !!(options as { phone?: boolean }).phone;
      if (phone) {
        probe.phoneFrame(true, false, { w: 390, h: 844 });
        await sleep(400);
        t.event('setup', 'phone 390x844 touch');
      }

      const forceLowGraphics = async () => {
        const pause = document.getElementById('pauseBtn') as HTMLButtonElement | null;
        if (pause && !pause.hidden) {
          await tapAt(pause, 'Pause');
          await sleep(350);
        }
        await tapAt(document.getElementById('pauseSettingsBtn') ?? document.getElementById('settingsBtn'), 'Settings');
        await sleep(400);
        const lowBtn = document.querySelector<HTMLButtonElement>('#graphicsTiers .graphics-tier[data-tier="low"]');
        if (lowBtn) {
          await tapAt(lowBtn, 'Graphics Low');
          await sleep(350);
          t.event('graphics-tier', `Low (pipeline ${probe.render?.()?.tier ?? '?'})`);
        } else {
          t.problem('warning', 'Graphics Low button missing; shaft meshes may not be the path under test');
        }
        const back = document.getElementById('settingsBack') as HTMLButtonElement | null;
        if (back && !back.hidden) await tapAt(back, 'Back');
        await sleep(200);
        const resume = document.getElementById('resumeBtn') as HTMLButtonElement | null;
        if (resume && !resume.hidden) await tapAt(resume, 'Resume');
        await sleep(300);
      };

      const fpsSamples: number[] = [];
      const sampleFps = () => {
        const q = probe.quietLight?.();
        if (q) fpsSamples.push(q.fpsHint);
      };

      // --- The Morning: shafts after Sleep, TV spill while Watching ---
      t.scene('The Morning: dawn shafts');
      await enterLevel(8);
      await waitControl('The Morning');
      for (let i = 0; i < 80 && probe.scripted(); i += 1) {
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        await sleep(350);
      }
      await t.until(() => probe.running() && !probe.scripted() && !probe.menu().open, 60000, 'control in the apartment');
      if (phone) await forceLowGraphics();
      t.progress(0.15);
      const bed = { x: 5.9, z: -0.45 };
      const walkPhone = async (to: Point, label: string) => {
        const zone = document.getElementById('leftStickZone') as HTMLElement | null;
        const start = performance.now();
        while (performance.now() - start < 25000) {
          const p = probe.player();
          if (dist(p, to) < 0.55) break;
          if (phone && zone) {
            const heading = Math.atan2(to.x - p.x, to.z - p.z);
            const rel = Math.atan2(Math.sin(heading - probe.cameraYaw()), Math.cos(heading - probe.cameraYaw()));
            const zr = zone.getBoundingClientRect();
            const init = { pointerId: 71, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: zr.left + zr.width / 2 + Math.sin(rel) * zr.width * 0.38, clientY: zr.top + zr.height / 2 - Math.cos(rel) * zr.height * 0.38 };
            zone.dispatchEvent(new PointerEvent('pointerdown', init));
            zone.dispatchEvent(new PointerEvent('pointermove', init));
            await sleep(200);
            zone.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
          } else {
            steer(to, true);
            await sleep(200);
          }
          sampleFps();
        }
        releaseAll();
        t.event('walk', `${label} at (${probe.player().x.toFixed(1)}, ${probe.player().z.toFixed(1)})`);
      };
      await walkPhone(bed, 'bed');
      const interact = async (label: string) => {
        if (phone) await tapAt(document.getElementById('interactBtn'), label);
        else await once('e', 1400, label);
      };
      await interact('Sleep');
      t.event('action', 'Sleep');
      for (let i = 0; i < 90 && (probe.scripted() || probe.morning()?.beat === 'sleep' || probe.morning()?.beat === 'wake'); i += 1) {
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        sampleFps();
        await sleep(400);
      }
      await sleep(800);
      const afterDawn = probe.quietLight?.();
      t.event('quiet-morning', `shafts ${afterDawn?.sunShafts ? 'on' : 'OFF'}, dust ${afterDawn?.dust ? 'on' : 'off'}, volumetric ${afterDawn?.volumetric ? 'on' : 'off'}, day beat ${probe.morning()?.beat}`);
      t.metric('morningShafts', afterDawn?.sunShafts ? 1 : 0);
      if (!afterDawn?.sunShafts) t.problem('bug', 'Morning sun shafts are not visible after Sleep');
      if (!afterDawn?.dust) t.problem('bug', 'Morning dust motes are missing in the shafts');
      t.progress(0.35);

      await walkPhone({ x: 3.2, z: -0.4 }, 'TV');
      await interact('Watch');
      t.event('action', 'Watch');
      for (let i = 0; i < 40 && probe.scripted(); i += 1) {
        sampleFps();
        await sleep(400);
      }
      await sleep(600);
      let tvSpill = false;
      for (let i = 0; i < 25; i += 1) {
        sampleFps();
        const q = probe.quietLight?.();
        if (q?.tvSpill) tvSpill = true;
        await sleep(200);
      }
      t.metric('tvSpill', tvSpill ? 1 : 0);
      t.event('quiet-tv', `TV spill ${tvSpill ? 'on' : 'OFF'} while the programme plays`);
      if (!tvSpill) t.problem('bug', 'The TV does not cast flickering light on the wall / Pierce');
      t.progress(0.5);

      const fpsSorted = [...fpsSamples].sort((a, b) => a - b);
      const fpsP5 = fpsSorted.length ? fpsSorted[Math.max(0, Math.floor(fpsSorted.length * 0.05))] : 0;
      t.metric('morningFps', fpsP5);
      if (phone) {
        t.metric('phone.fpsP5', fpsP5);
        if (fpsP5 < 30) t.problem('bug', `phone fps p5 ${fpsP5} under 30 with Morning shaft meshes`);
        probe.phoneFrame(false);
        t.progress(1);
        return 'done';
      }

      // --- The Desk: lamp key + mirror plaque ---
      t.scene('The Desk: lamp and mirror');
      await enterLevel(4);
      await waitControl('The Desk');
      for (let i = 0; i < 40 && (probe.cutscene() || probe.scripted()); i += 1) await tick();
      await sleep(800);
      const deskQ = probe.quietLight?.();
      t.event('quiet-desk', `lamp ${deskQ?.deskLamp ? 'on' : 'OFF'}, long shadows ${deskQ?.deskShadowLong ? 'on' : 'off'}, mirror text ok ${deskQ?.mirrorTextOk}`);
      t.metric('deskLamp', deskQ?.deskLamp ? 1 : 0);
      t.metric('mirrorTextOk', deskQ?.mirrorTextOk ? 1 : 0);
      if (!deskQ?.deskLamp) t.problem('bug', 'The Desk has no desk-lamp key light');
      if (!deskQ?.deskShadowLong) t.problem('bug', 'The Desk is not set up for long desk-lamp shadows');
      if (!deskQ?.mirrorTextOk) t.problem('bug', 'Bathroom vanity text is mirrored or missing in normal view');
      // Walk into the bath so footage shows the plaque and the glass.
      await walkPhone({ x: 18.6, z: 28.15 }, 'bathroom mirror');
      await sleep(1200);
      const plaque = probe.scene.getMeshByName('quiet-bath-sign');
      const sx = plaque?.scaling.x ?? 0;
      const sy = plaque?.scaling.y ?? 0;
      const sz = plaque?.scaling.z ?? 0;
      if (!plaque) t.problem('bug', 'quiet-bath-sign vanity plaque is missing');
      else if (sx < 0 || sy < 0 || sz < 0) t.problem('bug', `vanity plaque has a negative scale (${sx},${sy},${sz}) — text would read backwards in normal view`);
      const glass = probe.scene.getMeshByName('desk-mirror');
      const mat = glass?.material as { reflectionTexture?: { name?: string } } | null;
      if (!mat?.reflectionTexture) t.problem('bug', 'The Desk mirror has no MirrorTexture (text in the glass would not reverse)');
      else t.event('mirror-texture', `MirrorTexture on desk-mirror (${mat.reflectionTexture.name ?? 'tex'})`);
      t.progress(0.75);

      // --- The Return: clinical buzz tube ---
      t.scene('The Return: clinical fluorescents');
      await enterLevel(3);
      await waitControl('The Return');
      for (let i = 0; i < 40 && (probe.cutscene() || probe.scripted()); i += 1) {
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        await sleep(300);
      }
      await sleep(1000);
      const retQ = probe.quietLight?.();
      t.event('quiet-return', `buzz tube ${retQ?.buzzTube ? 'on' : 'OFF'}, mode ${retQ?.mode}`);
      t.metric('returnBuzz', retQ?.buzzTube ? 1 : 0);
      if (!retQ?.buzzTube) t.problem('bug', 'The Return has no buzzing fluorescent tube');
      t.progress(1);
      return 'done';
    };

    // ---- rain-city: Going Home wet neon + rain, Station open-end rain, Train tunnel lamps ≤3 s
    const rainCityRun = async (): Promise<Outcome> => {
      levelsTotal = 1;
      const phone = !!(options as { phone?: boolean }).phone;
      if (phone) {
        probe.phoneFrame(true, false, { w: 390, h: 844 });
        await sleep(400);
        t.event('setup', 'phone 390x844 touch');
      }

      const forceLowGraphics = async () => {
        const pause = document.getElementById('pauseBtn') as HTMLButtonElement | null;
        if (pause && !pause.hidden) {
          await tapAt(pause, 'Pause');
          await sleep(350);
        }
        await tapAt(document.getElementById('pauseSettingsBtn') ?? document.getElementById('settingsBtn'), 'Settings');
        await sleep(400);
        const lowBtn = document.querySelector<HTMLButtonElement>('#graphicsTiers .graphics-tier[data-tier="low"]');
        if (lowBtn) {
          await tapAt(lowBtn, 'Graphics Low');
          await sleep(350);
          t.event('graphics-tier', `Low (pipeline ${probe.render?.()?.tier ?? '?'})`);
        }
        const back = document.getElementById('settingsBack') as HTMLButtonElement | null;
        if (back && !back.hidden) await tapAt(back, 'Back');
        await sleep(200);
        const resume = document.getElementById('resumeBtn') as HTMLButtonElement | null;
        if (resume && !resume.hidden) await tapAt(resume, 'Resume');
        await sleep(300);
      };

      const fpsSamples: number[] = [];
      t.scene('Going Home: rain street');
      await enterLevel(5);
      await waitControl('Going Home');
      // Skip lobby into the street.
      for (let i = 0; i < 40 && probe.scripted(); i += 1) {
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        await sleep(300);
      }
      await t.until(() => probe.running() && !probe.scripted() && !probe.menu().open, 45000, 'control on the street');
      if (phone) await forceLowGraphics();
      t.progress(0.15);

      // Walk east along the south sidewalk (~25 s) so neon, rain and traffic are in frame.
      // Phone: left-stick drags only (no keyboard). Desktop: hold W.
      const start = performance.now();
      if (!phone) setHeld('w');
      let peakNeon = 0;
      let peakRain = 0;
      let peakPuddles = 0;
      let reflection = '';
      let lampsAt0 = -1;
      while (performance.now() - start < 25000) {
        const p = probe.player();
        if (p.x < 140) {
          if (phone) {
            const zone = document.getElementById('leftStickZone') as HTMLElement | null;
            if (zone) {
              const zr = zone.getBoundingClientRect();
              const heading = Math.atan2(1, 0); // +x
              const rel = Math.atan2(Math.sin(heading - probe.cameraYaw()), Math.cos(heading - probe.cameraYaw()));
              const init = { pointerId: 81, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: zr.left + zr.width / 2 + Math.sin(rel) * zr.width * 0.38, clientY: zr.top + zr.height / 2 - Math.cos(rel) * zr.height * 0.38 };
              zone.dispatchEvent(new PointerEvent('pointerdown', init));
              zone.dispatchEvent(new PointerEvent('pointermove', init));
              await sleep(180);
              zone.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
            } else await sleep(180);
          } else {
            await sleep(180);
          }
        } else await sleep(180);
        const rn = probe.rainNight?.();
        if (rn) {
          peakNeon = Math.max(peakNeon, rn.neon ?? 0);
          peakRain = Math.max(peakRain, rn.rain ?? 0);
          peakPuddles = Math.max(peakPuddles, rn.puddles ?? 0);
          if (rn.reflection) reflection = rn.reflection;
        }
        // Sample engine fps via the rainNight probe (headless ~1 fps; still reports phone.fpsP5).
        if (typeof rn?.fpsHint === 'number' && rn.fpsHint > 0) fpsSamples.push(rn.fpsHint);
      }
      if (!phone) setHeld('');
      releaseAll();
      const street = probe.rainNight?.();
      t.event('rain-street', `neon ${peakNeon}, rain ${peakRain}, puddles ${peakPuddles}, reflection ${reflection || street?.reflection || '?'}, flares ${street?.flares ?? 0}, steam ${street?.steam ?? 0}`);
      t.metric('neonSigns', peakNeon);
      t.metric('rainParticles', peakRain);
      t.metric('puddles', peakPuddles);
      t.metric('reflectionMode', reflection === 'ssr' ? 3 : reflection === 'planar' ? 2 : reflection === 'probe' ? 1 : 0);
      if (peakNeon < 8) t.problem('bug', `only ${peakNeon} lit neon signs along Going Home (need ≥ 8)`);
      if (peakRain < 200) t.problem('bug', `rain particle cap ${peakRain} looks missing`);
      if (peakPuddles < 3) t.problem('bug', `only ${peakPuddles} wet puddle mirrors (need ≥ 3)`);
      if (!street?.splashes) t.problem('bug', 'ground rain splashes are missing on Going Home');
      t.progress(0.45);

      // Station open-end rain + sodium.
      t.scene('The Station: open-end rain');
      await enterLevel(6);
      await waitControl('The Station');
      for (let i = 0; i < 30 && probe.scripted(); i += 1) {
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        await sleep(300);
      }
      await sleep(1200);
      const st = probe.stationRain?.() ?? probe.rainNight?.();
      t.event('rain-station', `rain ${st?.rain ?? 0}, splashes ${st?.splashes ?? 0}, sodium ${st?.sodium ?? 0}, board ${st?.boardEmissive ?? 0}`);
      t.metric('stationRain', st?.rain ?? 0);
      t.metric('stationSodium', st?.sodium ?? 0);
      if (!(st?.openEndRain || (st?.rain ?? 0) > 0)) t.problem('bug', 'Station open-end rain is missing');
      if ((st?.sodium ?? 0) < 4) t.problem('bug', `Station sodium cans ${st?.sodium ?? 0} (need ≥ 4)`);
      t.progress(0.7);

      // Train tunnel lamps ≤ 3 s.
      t.scene('The Train: tunnel lamps');
      await probe.setupHidden('the-train');
      await waitControl('The Train');
      for (let i = 0; i < 40 && probe.scripted(); i += 1) {
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        await sleep(300);
      }
      // Measure lamp period from lampsPassed over a few seconds while the car moves.
      const sample0 = probe.train();
      const lamps0 = sample0?.lampsPassed ?? 0;
      const t0 = performance.now();
      await sleep(3500);
      const car = probe.train();
      const lamps1 = car?.lampsPassed ?? 0;
      const elapsed = Math.max(0.1, (performance.now() - t0) / 1000);
      const measured = lamps1 > lamps0 ? elapsed / (lamps1 - lamps0) : (car?.lampPeriodSec ?? 99);
      t.event('rain-train', `lampPeriodSec ${measured.toFixed(2)} (reported ${car?.lampPeriodSec ?? '?'}), speed ${car?.speed ?? 0}, flicker ${car?.flicker ?? '?'}, lamps ${lamps0}→${lamps1}`);
      t.metric('lampPeriodSec', Math.round(measured * 100) / 100);
      if (!car) t.problem('bug', 'train() returned null on The Train');
      else if ((car.speed ?? 0) > 1 && measured > 3) t.problem('bug', `tunnel lamps every ${measured.toFixed(2)}s while moving (need ≤ 3)`);
      else if (lamps1 <= lamps0 && (car.speed ?? 0) > 5) t.problem('bug', 'no tunnel lamps passed while the train is moving');
      t.progress(0.9);

      const fpsSorted = [...fpsSamples].sort((a, b) => a - b);
      const fpsP5 = fpsSorted.length ? fpsSorted[Math.max(0, Math.floor(fpsSorted.length * 0.05))] : 0;
      t.metric('streetFps', fpsP5);
      if (phone) {
        t.metric('phone.fpsP5', fpsP5);
        if (fpsP5 < 30) t.problem('bug', `phone fps p5 ${fpsP5} under 30 with rain and reflections on Low`);
        probe.phoneFrame(false);
      }
      t.progress(1);
      return 'done';
    };

    // ---- b3-horror-light: flashlight beam + moving shadows, vat green, dark corridors, landmarks; phone fps
    const b3HorrorLightRun = async (): Promise<Outcome> => {
      levelsTotal = 1;
      const phone = !!(options as { phone?: boolean }).phone;
      if (phone) {
        probe.phoneFrame(true, false, { w: 390, h: 844 });
        await sleep(400);
      }
      t.scene('B3 horror hall');
      await enterLevel(2);
      await waitControl('B3 horror');
      releaseAll();
      // Setup: stand in Hall B facing the lab so the beam sweeps crates and the vat glow is ahead.
      probe.place?.(42.6, 38, Math.PI);
      await sleep(400);
      // Flashlight on through real input (G / Flashlight touch button).
      if (phone) {
        const flashBtn = document.getElementById('phoneFlash') as HTMLButtonElement | null;
        if (flashBtn && !flashBtn.hidden) {
          await tapAt(flashBtn, 'Flashlight');
          t.event('flashlight', 'tapped Flashlight');
        } else {
          await tap('g', 'flashlight on');
        }
      } else {
        await tap('g', 'flashlight on');
      }
      await sleep(600);
      const first = probe.b3Horror?.();
      if (!first?.active) t.problem('bug', 'b3Horror() is null on level 2 — horror dressing did not mount');
      if (!first?.beamVisible) t.problem('bug', 'flashlight beam is not visible after G');
      t.event('b3-horror', `beam ${first?.beamVisible ? 'on' : 'OFF'}, shadows ${first?.flashlightShadows ? 'on' : 'off'}, casters ${first?.shadowCasters ?? 0}, fog ${first?.fogMode ?? '?'}`);
      t.progress(0.2);

      // Walk west down the hall (~30 s), sampling shadows and fog. Real stick / key input.
      const start = performance.now();
      let peakCasters = first?.shadowCasters ?? 0;
      let peakVat = first?.vatWallsLit ?? 0;
      let landmarks = first?.landmarks?.filter((l) => l.lit).length ?? 0;
      const fpsSamples: number[] = [];
      let lookNudge = 0;
      setHeld('w');
      while (performance.now() - start < 30000) {
        await frame();
        lookNudge += 1;
        if (lookNudge % 12 === 0) {
          // Soft look so the beam sweeps props (mouse move or touch look stick).
          if (!phone) {
            probe.canvas.dispatchEvent(new MouseEvent('mousemove', { movementX: lookNudge % 24 === 0 ? 4 : -3, movementY: 0, bubbles: true }));
          } else {
            const zone = document.getElementById('rightStickZone') as HTMLElement | null;
            if (zone) {
              const r = zone.getBoundingClientRect();
              const x = r.left + r.width * 0.55;
              const y = r.top + r.height * 0.5;
              const init = { pointerType: 'touch', pointerId: 61, isPrimary: true, button: 0, buttons: 1, bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y };
              zone.dispatchEvent(new PointerEvent('pointerdown', init));
              zone.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: x + 18, clientY: y }));
              zone.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0, clientX: x + 18, clientY: y }));
            }
          }
        }
        const h = probe.b3Horror?.();
        if (h) {
          peakCasters = Math.max(peakCasters, h.shadowCasters);
          peakVat = Math.max(peakVat, h.vatWallsLit);
          landmarks = Math.max(landmarks, h.landmarks.filter((l) => l.lit).length);
          fpsSamples.push(h.fpsHint);
        }
        const elapsed = performance.now() - start;
        if (elapsed > 5000 && elapsed < 5050) t.progress(0.35);
        if (elapsed > 15000 && elapsed < 15050) t.progress(0.55);
        if (elapsed > 25000 && elapsed < 25050) t.progress(0.75);
      }
      setHeld('');
      releaseAll();

      // Near the vat so green wash on the lab walls is measurable.
      probe.place?.(11.5, 38, Math.PI);
      await sleep(1500);
      const nearVat = probe.b3Horror?.();
      peakVat = Math.max(peakVat, nearVat?.vatWallsLit ?? 0);
      t.metric('b3ShadowCasters', peakCasters);
      t.metric('b3VatWalls', peakVat);
      t.metric('b3Landmarks', landmarks);
      t.metric('b3FogMode', nearVat?.fogMode === 'exp2' ? 2 : nearVat?.fogMode === 'linear' ? 1 : 0);
      const fpsSorted = [...fpsSamples].sort((a, b) => a - b);
      const fpsP5 = fpsSorted.length ? fpsSorted[Math.max(0, Math.floor(fpsSorted.length * 0.05))] : 0;
      t.metric('b3Fps', fpsP5);
      if (phone) t.metric('phone.fpsP5', fpsP5);
      t.event('b3-horror-end', `casters ${peakCasters}, vat walls ${peakVat}, landmarks ${landmarks}, fog ${nearVat?.fogMode}, fpsP5 ${fpsP5}`);
      if (peakCasters < 3) t.problem('bug', `flashlight moving shadows from only ${peakCasters} objects (need ≥ 3)`);
      if (peakVat < 2) t.problem('bug', `vat lights only ${peakVat} nearby walls (need ≥ 2)`);
      if (landmarks < 3) t.problem('bug', `only ${landmarks} light landmarks lit (need ≥ 3)`);
      if (nearVat?.fogMode !== 'exp2') t.problem('bug', `B3 fog is ${nearVat?.fogMode ?? 'missing'}, expected exp2`);
      if (phone && fpsP5 < 30) t.problem('bug', `phone fps p5 ${fpsP5} under 30 with beam and fog`);
      if (phone) probe.phoneFrame(false);
      t.progress(1);
      return 'done';
    };

    // ---- vat-acid: hunt retry (under 3 s, no card) and the vat break played with the left stick on a phone
    const vatAcidRun = async (): Promise<Outcome> => {
      levelsTotal = 1;
      const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
      t.scene('B3 hunt');
      await enterLevel(2);
      await waitControl('B3');
      probe.setupBeat('hunt');
      await sleep(1500);
      releaseAll();
      const before = probe.hunt();
      const downAt = performance.now();
      let sawCard = false;
      let peakFade = 0;
      if (!probe.forceDefeat()) throw new Error('could not down Pierce in the hunt');
      t.event('defeat', 'test shortcut, in the hunt');
      let back = 0;
      while (performance.now() - downAt < 8000) {
        await frame();
        const m = probe.menu();
        if (m.open || /defeat/i.test(m.title ?? '')) sawCard = true;
        peakFade = Math.max(peakFade, probe.hunt().fade);
        if (probe.hunt().huntRetries > before.huntRetries && !probe.hunt().retrying && probe.hunt().health >= 99) { back = performance.now() - downAt; break; }
      }
      const after = probe.hunt();
      t.metric('huntRetries', after.huntRetries);
      t.metric('retrySeconds', after.lastRetrySeconds);
      t.event('hunt-retry', `back in control after ${(back / 1000).toFixed(2)} s, retrySeconds ${after.lastRetrySeconds}, health ${after.health}, fade peak ${peakFade.toFixed(2)}, card ${sawCard}`);
      if (sawCard) t.problem('bug', 'a Defeat card or menu showed after a hunt death');
      if (!back || after.lastRetrySeconds >= 3) t.problem('bug', `control did not come back within 3 s of the hunt death (retrySeconds ${after.lastRetrySeconds})`);
      if (peakFade < 0.5) t.problem('bug', `no red fade on the hunt death (peak ${peakFade.toFixed(2)})`);
      t.progress(0.3);

      // The vat break, as a phone.
      t.scene('Vat break (phone)');
      probe.phoneFrame(true);
      await sleep(800);
      probe.setupBeat('vat');
      const shotAt = performance.now();
      while (!probe.cutscene() && performance.now() - shotAt < 4000) await frame();
      while (probe.cutscene() && performance.now() - shotAt < 30000) await frame();
      const shot = (performance.now() - shotAt) / 1000;
      t.metric('vatShotSeconds', Number(shot.toFixed(1)));
      if (shot > 8) t.problem('bug', `the vat shot held control for ${shot.toFixed(1)} s (should be a short shot under 5 s)`);
      const door = { x: 17.6, z: 38 };
      const zone = document.getElementById('leftStickZone') as HTMLElement;
      const zr = zone.getBoundingClientRect();
      const cx = zr.left + zr.width / 2;
      const cy = zr.top + zr.height / 2;
      const ptr = (type: string, ux: number, uy: number) =>
        zone.dispatchEvent(new PointerEvent(type, { pointerId: 17, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: cx + ux * zr.width * 0.38, clientY: cy + uy * zr.height * 0.38 }));
      let down = false;
      const stick = (ux: number, uy: number) => {
        if (!down) { ptr('pointerdown', ux, uy); down = true; } else ptr('pointermove', ux, uy);
      };
      const lift = () => { if (down) { zone.dispatchEvent(new PointerEvent('pointerup', { pointerId: 17, pointerType: 'touch', bubbles: true })); down = false; } };
      const startAt = performance.now();
      let inputSeconds = 0;
      let lastAt = performance.now();
      let maxLag = 0, maxDrift = 0, sawLocked = 0, sawFlashOff = false, swappedDuringFall = false, ended = false, minTouch = 999, controlsHidden = 0;
      let lastYaw = 0, turnSum = 0;
      while (performance.now() - startAt < 70000) {
        await frame();
        const a = probe.acid();
        const nowAt = performance.now();
        if (a.active) {
          maxLag = Math.max(maxLag, a.lag);
          maxDrift = Math.max(maxDrift, Math.abs(a.drift));
          if (a.locked) sawLocked += (nowAt - lastAt) / 1000;
          if (a.t > 9 && !a.flashlight) sawFlashOff = true;
          if (a.swapped && a.locked) swappedDuringFall = true;
          turnSum += Math.abs(wrap(a.yaw - lastYaw));
          lastYaw = a.yaw;
          if (!a.locked) {
            const rel = wrap(Math.atan2(door.x - a.x, door.z - a.z) - probe.cameraYaw());
            stick(Math.sin(rel), -Math.cos(rel));
            inputSeconds += (nowAt - lastAt) / 1000;
          } else lift();
          for (const sel of ['#leftStickZone .stick-ring', '#jumpBtn']) {
            const el = document.querySelector(sel);
            const r = el?.getBoundingClientRect();
            const cs = el ? getComputedStyle(el) : null;
            if (!r || r.width < 1 || cs!.visibility === 'hidden' || +cs!.opacity < 0.5) controlsHidden += 1;
            else minTouch = Math.min(minTouch, Math.min(r.width, r.height));
          }
        } else if (a.t > 1) { ended = true; lift(); break; }
        lastAt = nowAt;
        if (probe.menu().open) break;
      }
      lift();
      const total = (performance.now() - startAt) / 1000;
      t.metric('acidSeconds', Number(probe.acid().t.toFixed(1)));
      t.metric('acidInputSeconds', Number(inputSeconds.toFixed(1)));
      t.event('acid', `input ${inputSeconds.toFixed(1)} s, lag max ${maxLag.toFixed(2)} s, drift max ${maxDrift.toFixed(2)} rad, down ${sawLocked.toFixed(1)} s, light dead ${sawFlashOff}, swap in a fall ${swappedDuringFall}, ended ${ended} after ${total.toFixed(1)} s`);
      if (inputSeconds < 15) t.problem('bug', `only ${inputSeconds.toFixed(1)} s of movement input in the acid (want 15 or more)`);
      if (maxLag < 0.35) t.problem('bug', `input lag only reached ${maxLag.toFixed(2)} s`);
      if (sawLocked < 1.5) t.problem('bug', 'Pierce never fell in the acid');
      if (!sawFlashOff) t.problem('bug', 'the flashlight never failed in the acid');
      if (controlsHidden > 0) t.problem('bug', `touch controls were hidden or covered ${controlsHidden} times in the acid`);
      if (minTouch < 44) t.problem('bug', `a touch control was ${Math.round(minTouch)} px (44 minimum)`);
      if (!ended) t.problem('bug', 'the acid never ended at the door');
      else {
        const until = performance.now() + 20000;
        while (performance.now() < until && !/end level/i.test(probe.action() ?? '')) await frame();
        t.event('check', `action after the acid: ${probe.action()}`);
      }
      probe.phoneFrame(false);
      t.progress(1);
      return 'done';
    };

    // ---- crowd-shadow: Shadow in a sidewalk crowd — notice, panic, film, many voices
    const crowdShadowRun = async (): Promise<Outcome> => {
      const phone = Boolean(options.phone);
      if (probe.sound().prompt) await tapToPlay();
      if (phone) { probe.phoneFrame(true); t.event('setup', 'phone layout 390x844 (touch)'); await sleep(800); }
      t.metric('feel.coyoteMs', 120);
      t.scene('Going Home: crowd reactions');
      await enterLevel(5);
      await waitControl('Going Home');
      for (let i = 0; i < 120 && probe.scripted(); i += 1) {
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        await sleep(400);
      }
      await t.until(() => probe.running() && !probe.scripted(), 30000, 'control on the street');
      await sleep(500);
      const byId = (name: string) => document.getElementById(name) as HTMLElement | null;
      const zone = document.getElementById('leftStickZone') as HTMLElement | null;
      let down = false;
      const stick = (ux: number, uy: number) => {
        if (!zone) return;
        const zr = zone.getBoundingClientRect();
        const type = down ? 'pointermove' : 'pointerdown';
        down = true;
        zone.dispatchEvent(new PointerEvent(type, {
          pointerId: 31, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
          clientX: zr.left + zr.width / 2 + ux * zr.width * 0.38,
          clientY: zr.top + zr.height / 2 + uy * zr.height * 0.38,
        }));
      };
      const lift = () => {
        if (down && zone) zone.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31, pointerType: 'touch', bubbles: true }));
        down = false;
      };
      // Walk east into the densest sidewalk crowd near the tower.
      const untilCrowd = performance.now() + 25000;
      while (performance.now() < untilCrowd) {
        const p = probe.player();
        const crowd = probe.people().filter((x) => x.kind === 'person' || x.kind === 'hostile');
        if (crowd.length >= 3) {
          const near = crowd.sort((a, b) => dist(p, a) - dist(p, b))[0];
          if (near && dist(p, near) < 8) break;
        }
        if (phone) stick(0.85, 0);
        else steer({ x: p.x + 8, z: 22.6 }, true);
        await tick();
      }
      lift();
      releaseAll();
      await sleep(300);
      if (!probe.shadow().on) {
        if (phone) await tapAt(byId('shadowHint'), 'Shadow');
        else {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', bubbles: true }));
          await sleep(80);
          window.dispatchEvent(new KeyboardEvent('keyup', { key: 'c', code: 'KeyC', bubbles: true }));
        }
      }
      t.event('shadow-on', `t=${((performance.now()) / 1000).toFixed(1)}s`);
      const shadowAt = performance.now();
      const fpsSamples: number[] = [];
      // Hold Shadow near the crowd for several seconds so reactions stage and voices accumulate.
      const holdUntil = performance.now() + 14000;
      let peakVoices = 0;
      let peakWithin = 0;
      let peakFilm = 0;
      let peakWitness = 0;
      let peakRepeats = 0;
      let lastLines: string[] = [];
      while (performance.now() < holdUntil) {
        const p = probe.player();
        const near = probe.people().filter((x) => (x.kind === 'person' || x.kind === 'hostile') && dist(p, x) < 14);
        if (near.length) {
          const target = near.sort((a, b) => dist(p, a) - dist(p, b))[0];
          if (phone) {
            const heading = Math.atan2(target.x - p.x, target.z - p.z);
            const rel = wrap(heading - probe.cameraYaw());
            stick(Math.sin(rel) * 0.35, -Math.cos(rel) * 0.35);
          } else steer(target, true);
        }
        await tick();
        const eng = probe.scene?.getEngine?.();
        if (eng) {
          const f = eng.getFps?.();
          if (typeof f === 'number' && f > 0) fpsSamples.push(f);
        }
        const c = probe.crowd?.();
        if (c) {
          peakVoices = Math.max(peakVoices, c.voiceCount);
          peakWithin = Math.max(peakWithin, c.within2s);
          peakFilm = Math.max(peakFilm, c.filmers);
          peakWitness = Math.max(peakWitness, c.witnesses);
          peakRepeats = Math.max(peakRepeats, c.repeatsBackToBack);
          lastLines = c.lastLines;
          if (c.voiced > 0 && performance.now() - shadowAt < 2500) {
            t.event('crowd-voice', `${c.voiced} voiced, ${c.voiceCount} voices, within2s=${c.within2s}, filmers=${c.filmers}`);
          }
        }
      }
      lift();
      releaseAll();
      // Keep walking to accumulate 10 reactions / 6 voices.
      const moreUntil = performance.now() + 20000;
      while (performance.now() < moreUntil && (peakVoices < 6 || lastLines.length < 10 || peakFilm < 1)) {
        if (phone) stick(0.7, 0);
        else {
          const p = probe.player();
          steer({ x: p.x + 6, z: 22.6 }, true);
        }
        await tick();
        const eng = probe.scene?.getEngine?.();
        if (eng) {
          const f = eng.getFps?.();
          if (typeof f === 'number' && f > 0) fpsSamples.push(f);
        }
        const c = probe.crowd?.();
        if (c) {
          peakVoices = Math.max(peakVoices, c.voiceCount);
          peakWithin = Math.max(peakWithin, c.within2s);
          peakFilm = Math.max(peakFilm, c.filmers);
          peakWitness = Math.max(peakWitness, c.witnesses);
          peakRepeats = Math.max(peakRepeats, c.repeatsBackToBack);
          lastLines = c.lastLines;
        }
      }
      lift();
      releaseAll();
      const final = probe.crowd?.();
      const linesHeard = final?.lastLines?.length ?? lastLines.length;
      t.metric('crowdWithin2s', final?.within2s ?? peakWithin);
      t.metric('crowdVoices', final?.voiceCount ?? peakVoices);
      t.metric('crowdFilmers', final?.filmers ?? peakFilm);
      t.metric('crowdWitnesses', final?.witnesses ?? peakWitness);
      t.metric('crowdRepeats', final?.repeatsBackToBack ?? peakRepeats);
      t.metric('crowdVoiced', final?.voiced ?? 0);
      t.metric('crowdLines', linesHeard);
      t.event('crowd', JSON.stringify(final ?? { voices: peakVoices, within2s: peakWithin, filmers: peakFilm, lines: linesHeard }));
      if ((final?.within2s ?? peakWithin) < 3) {
        t.problem('bug', `only ${final?.within2s ?? peakWithin} voiced reactions within 2 s of Shadow (want 3+)`);
      }
      if ((final?.voiceCount ?? peakVoices) < 6) {
        t.problem('bug', `only ${final?.voiceCount ?? peakVoices} different voices in reactions (want 6+)`);
      }
      if (linesHeard < 10) {
        t.problem('bug', `only ${linesHeard} reaction lines heard (want 10+ to prove no back-to-back repeats)`);
      } else if ((final?.repeatsBackToBack ?? peakRepeats) > 0) {
        t.problem('bug', `a reaction line repeated back-to-back (${final?.repeatsBackToBack ?? peakRepeats} times)`);
      }
      if ((final?.filmers ?? peakFilm) < 1) {
        t.problem('bug', 'no pedestrian raised a lit phone to film Pierce');
      }
      if (phone) {
        const fpsSorted = [...fpsSamples].sort((a, b) => a - b);
        const fpsP5 = fpsSorted.length ? fpsSorted[Math.max(0, Math.floor(fpsSorted.length * 0.05))] : 0;
        t.metric('phone.fpsP5', fpsP5);
        if (fpsSamples.length === 0 || fpsP5 <= 0) {
          t.problem('bug', 'phone fps p5 was not measured during crowd reactions');
        } else if (fpsP5 < 30) {
          t.problem('bug', `phone fps p5 ${fpsP5.toFixed(1)} under 30 during crowd reactions`);
        }
        probe.phoneFrame(false);
      }
      t.progress(1);
      return 'done';
    };

    /** Going Home's power lessons, played from the context prompts with taps (phone) or clicks. */
    const streetPowersRun = async (): Promise<Outcome> => {
      const phone = Boolean(options.phone);
      if (probe.sound().prompt) await tapToPlay();
      if (phone) { probe.phoneFrame(true); t.event('setup', 'phone layout 390x844 (touch)'); await sleep(800); }
      t.metric('feel.coyoteMs', 120);
      t.scene('Going Home: the powers');
      await enterLevel(5);
      await waitControl('Going Home');
      for (let i = 0; i < 120 && probe.scripted(); i += 1) {
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        await sleep(400);
      }
      await t.until(() => probe.running() && !probe.scripted() && !!probe.lesson && probe.lesson().power !== '', 30000, 'control on the street');
      await sleep(600);
      const zone = document.getElementById('leftStickZone') as HTMLElement | null;
      let down = false;
      const stick = (ux: number, uy: number) => {
        if (!zone) return;
        const zr = zone.getBoundingClientRect();
        const type = down ? 'pointermove' : 'pointerdown';
        down = true;
        zone.dispatchEvent(new PointerEvent(type, { pointerId: 29, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: zr.left + zr.width / 2 + ux * zr.width * 0.38, clientY: zr.top + zr.height / 2 + uy * zr.height * 0.38 }));
      };
      const lift = () => {
        if (down && zone) zone.dispatchEvent(new PointerEvent('pointerup', { pointerId: 29, pointerType: 'touch', bubbles: true }));
        down = false;
      };
      const walkToward = (to: Point, from: Point = probe.player()) => {
        const heading = Math.atan2(to.x - from.x, to.z - from.z);
        if (phone) {
          const rel = wrap(heading - probe.cameraYaw());
          stick(Math.sin(rel), -Math.cos(rel));
        } else steer(to, true);
      };
      const stopWalking = () => { if (phone) lift(); else releaseAll(); };
      const byId = (name: string) => document.getElementById(name) as HTMLElement | null;
      const logged = new Set<string>();
      const flagged = new Set<string>();
      const sawPrompts = new Set<string>();
      const firstUse = new Map<string, number>();
      const started = performance.now();
      const seconds = () => (performance.now() - started) / 1000;
      const L = () => probe.lesson!();
      const syncLog = () => {
        for (const row of L().log) {
          const key = `${row.power}.${row.step}`;
          if (logged.has(key)) continue;
          logged.add(key);
          t.event('power-step', `${row.power} ${row.step} at the ${row.setup} setup (${row.control}) t=${row.t}s`);
          if (!firstUse.has(row.power)) firstUse.set(row.power, row.t);
        }
      };
      const unlocksSeen = new Set<string>();
      const checkPrompt = () => {
        const state = L();
        for (const u of state.unlocks) {
          if (!unlocksSeen.has(u.power)) { unlocksSeen.add(u.power); t.event('unlock-pulse', `${u.power} unlocked: its button pulses once`); }
        }
        const pr = state.prompt;
        if (!pr.shown || !pr.rect) return;
        if (!sawPrompts.has(pr.text)) { sawPrompts.add(pr.text); t.event('prompt', `"${pr.text}" on the ${pr.on}`); }
        if (pr.words > 4 && !flagged.has(`w${pr.text}`)) { flagged.add(`w${pr.text}`); t.problem('bug', `context prompt "${pr.text}" is ${pr.words} words (max 4)`); }
        const r = pr.rect;
        if (r.x < 0 || r.y < 0 || r.x + r.w > innerWidth + 1 || r.y + r.h > innerHeight + 1) {
          if (!flagged.has(`s${pr.text}`)) { flagged.add(`s${pr.text}`); t.problem('bug', `context prompt "${pr.text}" runs off the screen (${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)})`); }
        }
        if (phone) {
          for (const el of document.querySelectorAll('button')) {
            const b = (el as HTMLElement).getBoundingClientRect();
            if (!b.width || (el as HTMLElement).hidden || getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).display === 'none') continue;
            const overlap = Math.min(r.x + r.w, b.right) - Math.max(r.x, b.left) > 2 && Math.min(r.y + r.h, b.bottom) - Math.max(r.y, b.top) > 2;
            if (overlap && !flagged.has(`o${pr.text}${el.id}`)) {
              flagged.add(`o${pr.text}${el.id}`);
              t.problem('bug', `context prompt "${pr.text}" sits on top of #${el.id || el.className}`);
            }
          }
        }
      };
      const wantAfter = async (label: string) => {
        await tapAt(label === 'shadow' ? byId('shadowHint') : label === 'fire' ? byId('fireBtn') : byId('abilityHint'), label);
        await sleep(500);
      };
      const near = (kind: string, max = 40) => {
        const p = probe.player();
        return probe.people().filter((x) => x.kind === kind && dist(p, x) < max).sort((a, b) => dist(p, a) - dist(p, b))[0] ?? null;
      };
      const aimAndTap = async (target: Point, within: number) => {
        const p = probe.player();
        const d = dist(p, target);
        if (d > within) { walkToward(target); return false; }
        stopWalking();
        face(Math.atan2(target.x - p.x, target.z - p.z));
        await sleep(250);
        await wantAfter('fire');
        return true;
      };

      const deadline = performance.now() + 420_000;
      let lastLog = '';
      while (performance.now() < deadline) {
        await tick();
        if (probe.menu().open) break;
        syncLog();
        checkPrompt();
        const state = L();
        const sh = probe.shadow();
        const here = probe.player();
        if (state.log.some((r) => r.power === 'melee' && r.step === 'payoff') || here.x > 161) break;
        const key = `${state.power}|${state.log.length}|${sh.on}|${sh.linked}`;
        if (key !== lastLog) { lastLog = key; t.log(`lesson ${key}`); }
        const power = state.log.some((r) => r.power === 'consume' && r.step === 'payoff') ? 'melee' : state.power;
        const east = { x: here.x + 8, z: 22.6 };
        if (power === 'shadow') {
          if (!sh.on) { stopWalking(); await wantAfter('shadow'); continue; }
          const crowd = near('person', 14);
          walkToward(crowd ?? east);
        } else if (power === 'shock') {
          if (!sh.on) { stopWalking(); await wantAfter('shadow'); continue; }
          const cop = near('police', 60);
          if (!cop) { walkToward(east); continue; }
          if (await aimAndTap(cop, 4.2)) t.event('first-use-tap', 'Shadow Shock: one tap on the fire button');
        } else if (power === 'possess') {
          if (!sh.on) { stopWalking(); await wantAfter('shadow'); continue; }
          if (state.linked) { walkToward({ x: 84, z: 22.6 }, state.linked); continue; }
          const guard = near('person', 30);
          if (!guard || here.x < 56) { walkToward({ x: Math.min(here.x + 8, 78), z: 22.6 }); continue; }
          if (await aimAndTap(guard, 4.2)) t.event('first-use-tap', 'Possess: one tap on the fire button');
        } else if (power === 'consume') {
          if (!sh.on) { stopWalking(); await wantAfter('shadow'); continue; }
          if (state.linked) {
            const prompt = state.prompt;
            if (prompt.shown && /consume/i.test(prompt.text)) { stopWalking(); await wantAfter('fire'); t.event('first-use-tap', 'Consume: the second tap on the fire button'); }
            else await sleep(200);
            continue;
          }
          const guard = near('person', 30);
          if (!guard || here.x < 118) { walkToward({ x: Math.min(here.x + 8, 134), z: 22.6 }); continue; }
          await aimAndTap(guard, 4.2);
        } else {
          // Punch and Kick: drop Shadow, let him come, hit back.
          if (sh.on) { stopWalking(); await wantAfter('shadow'); continue; }
          const foe = near('hostile', 30);
          if (!foe) { walkToward({ x: Math.min(here.x + 6, 156), z: 22.6 }); continue; }
          const d = dist(here, foe);
          if (d > 1.9) { walkToward(foe); continue; }
          stopWalking();
          face(Math.atan2(foe.x - here.x, foe.z - here.z));
          await sleep(200);
          await wantAfter('fire');
        }
      }
      stopWalking();
      syncLog();

      // ---- Judge it.
      const log = L().log;
      const order = ['shadow', 'shock', 'possess', 'consume', 'melee'];
      const firstOf = order.map((power) => ({ power, row: log.find((r) => r.power === power) })).filter((x) => x.row);
      t.metric('powersIntroduced', firstOf.length);
      t.event('introduction-log', firstOf.map((x) => `${x.power}@${x.row!.t}s`).join(', '));
      for (let i = 0; i < firstOf.length; i += 1) {
        if (order.indexOf(firstOf[i].power) !== i) t.problem('bug', `powers introduced out of order: ${firstOf.map((x) => x.power).join(', ')}`);
        if (i > 0 && firstOf[i].row!.t - firstOf[i - 1].row!.t < 30) t.problem('bug', `${firstOf[i].power} introduced ${(firstOf[i].row!.t - firstOf[i - 1].row!.t).toFixed(1)} s after ${firstOf[i - 1].power}: a new control needs 30 s alone`);
      }
      const setups: Record<string, string> = { shadow: 'crowd', shock: 'police', possess: 'block', consume: 'station', melee: 'shove' };
      for (const x of firstOf) if (x.row!.setup !== setups[x.power]) t.problem('bug', `${x.power} first used at "${x.row!.setup}", not the ${setups[x.power]} setup`);
      for (const power of order) if (!firstOf.some((x) => x.power === power)) t.problem('bug', `${power} was never introduced on the street in 7 minutes`);
      const melee = log.find((r) => r.power === 'melee');
      const consumeDone = log.find((r) => r.power === 'consume' && r.step === 'payoff');
      if (melee && (!consumeDone || melee.t < consumeDone.t)) t.problem('bug', 'Punch/Kick was introduced before the other powers were done');
      if (!firstOf.length) t.problem('bug', 'no power step was ever logged');
      if (sawPrompts.size < 4) t.problem('bug', `only ${sawPrompts.size} context prompts were ever shown (${[...sawPrompts].join(' | ')})`);
      t.metric('promptsSeen', sawPrompts.size);
      t.metric('lessonSeconds', Math.round(seconds()));
      try {
        const res = await fetch('/locales/en.json', { cache: 'no-store' });
        const json = await res.json() as { lines: { id: string; text?: string }[] };
        const longest = json.lines.filter((l) => l.id.startsWith('objective.home') && l.text).map((l) => ({ id: l.id, words: l.text!.split(/\s+/).filter(Boolean).length }));
        t.metric('longestHomeObjectiveWords', Math.max(...longest.map((l) => l.words)));
        for (const l of longest) if (l.words > 8) t.problem('bug', `${l.id} is ${l.words} words (max 8)`);
      } catch { t.problem('warning', 'could not read locales/en.json to count objective words'); }
      {
        // Signature effects (powerFx.ts): every power must have played its own effect and sound; hit-stop 50-100 ms.
        const fx = (window as unknown as { __phPowerFx?: { stats: () => { counts: Record<string, number>; lastStopMs: number; half: number; gpu: boolean; log: { kind: string; take?: number }[] } } }).__phPowerFx?.stats();
        if (!fx) t.problem('bug', 'power effects module is not installed');
        else {
          for (const k of ['shock', 'possess', 'consume']) if (!fx.counts[k]) t.problem('bug', `${k} never showed its signature effect`);
          if (fx.counts.punch || fx.counts.kick) {
            t.metric('feel.hitStopMs', fx.lastStopMs);
            if (fx.lastStopMs < 50 || fx.lastStopMs > 100) t.problem('bug', `hit-stop ${fx.lastStopMs} ms is outside 50-100`);
          }
          const takes = new Set(fx.log.filter((l) => l.take !== undefined).map((l) => `${l.kind}${l.take}`));
          t.metric('powerSoundTakes', takes.size);
          t.metric('powerFxGpu', fx.gpu ? 1 : 0);
          t.event('power-fx', JSON.stringify(fx.counts));
        }
      }
      if (phone) probe.phoneFrame(false);
      return 'done';
    };

    const deskBeatsRun = async (): Promise<Outcome> => {
      levelsTotal = 1;
      const phone = Boolean(options.phone);
      if (probe.sound().prompt) await tapToPlay();
      if (phone) { probe.phoneFrame(true); t.event('setup', 'phone layout 390x844 (touch)'); await sleep(800); }
      t.metric('feel.coyoteMs', 120);
      t.scene('The Desk');
      const feel = probe.feel;
      const cw = installCameraWatch({
        scene: () => probe.scene,
        player: () => (feel ? feel.collider.getAbsolutePosition().clone() as never : null),
        isSolid: (m) => (feel ? feel.isSolid(m) : true),
        active: () => probe.running() && !probe.menu().open && !probe.cutscene() && !probe.scripted(),
        label: () => 'The Desk',
        emit: (type, detail) => t.event(type, detail),
      });
      await enterLevel(4);
      await waitControl('The Desk');
      for (let i = 0; i < 200 && (probe.cutscene() || probe.scripted()); i += 1) await tick();
      await sleep(1200);
      cw.start();
      const zone = document.getElementById('leftStickZone') as HTMLElement | null;
      let down = false;
      const stick = (ux: number, uy: number) => {
        if (!zone) return;
        const zr = zone.getBoundingClientRect();
        const type = down ? 'pointermove' : 'pointerdown';
        down = true;
        zone.dispatchEvent(new PointerEvent(type, { pointerId: 23, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: zr.left + zr.width / 2 + ux * zr.width * 0.38, clientY: zr.top + zr.height / 2 + uy * zr.height * 0.38 }));
      };
      const lift = () => {
        if (down && zone) zone.dispatchEvent(new PointerEvent('pointerup', { pointerId: 23, pointerType: 'touch', bubbles: true }));
        down = false;
      };
      /** Forward (toward the glass, +x) or back; the camera is held facing +x. */
      const walkMirror = (dir: 1 | -1) => {
        if (phone) stick(0, -dir);
        else setHeld(dir > 0 ? 'w' : 's');
      };
      const stopMirror = () => { if (phone) lift(); else releaseAll(); };

      let sawPrompt = false;
      const checkPrompt = () => { if (/look in mirror/i.test(probe.action() ?? '')) sawPrompt = true; };
      t.event('mirror', `start at (${probe.player().x.toFixed(1)}, ${probe.player().z.toFixed(1)}); walking to the glass with ${phone ? 'the left stick' : 'W'}`);
      const mirrorStart = performance.now();
      let phase = 0;
      let flip = performance.now();
      let maxLag = 0;
      let sawQuiet = false;
      let engagedLogged = false;
      let turnLogged = false;
      let lagLogged = 0;
      while (performance.now() - mirrorStart < 120000) {
        await tick();
        checkPrompt();
        const d = probe.desk?.();
        if (!d) break;
        maxLag = Math.max(maxLag, d.mirror.maxLagMs);
        if (d.mirror.quiet) sawQuiet = true;
        if (d.mirror.engaged && !engagedLogged) { engagedLogged = true; t.event('mirror-engaged', `camera eases over the shoulder at x ${probe.player().x.toFixed(2)}`); }
        if (d.mirror.lagMs >= lagLogged + 100) { lagLogged = d.mirror.lagMs; t.event('reflection-lag', `${d.mirror.lagMs} ms behind him`); }
        if (d.mirror.headTurns > 0 && !turnLogged) { turnLogged = true; t.event('reflection-head-turn', `the reflection turned its head first (lag ${d.mirror.lagMs} ms, he walked ${d.mirror.walkedMetres} m)`); }
        if (d.mirror.thatsMe && /that's me/i.test(probe.subtitle().text)) { t.event('dialogue', "That's me. I'm not seeing things."); }
        if (d.phase === 'walk' || d.phase === 'arrive' || d.phase === 'sweep') break;
        // Walk toward the glass until engaged, then back and forth in short strokes so the lag shows.
        const x = probe.player().x;
        if (!d.mirror.engaged) walkMirror(1);
        else if (performance.now() - flip > 900) {
          flip = performance.now();
          phase = phase === 0 ? 1 : 0;
          if (x > 19.2) phase = 1;
          if (x < 17.8) phase = 0;
          walkMirror(phase === 0 ? 1 : -1);
        }
      }
      stopMirror();
      const afterMirror = probe.desk?.();
      t.metric('mirrorMaxLagMs', maxLag);
      t.metric('headTurns', afterMirror?.mirror.headTurns ?? 0);
      t.event('mirror-result', `max lag ${maxLag} ms, head turns ${afterMirror?.mirror.headTurns}, hum and breath dropped ${sawQuiet}, "That's me" played ${afterMirror?.mirror.thatsMe}`);
      if (sawPrompt) t.problem('bug', 'a "Look in mirror" prompt showed');
      if (!afterMirror?.mirror.engaged) t.problem('bug', 'walking up to the mirror never started the beat');
      if (maxLag < 400 || maxLag > 650) t.problem('bug', `the reflection's lag peaked at ${maxLag} ms (expected about 500)`);
      if ((afterMirror?.mirror.headTurns ?? 0) !== 1) t.problem('bug', `the reflection turned its head ${afterMirror?.mirror.headTurns} times (expected once)`);
      if (!sawQuiet) t.problem('bug', 'the hum and breathing never dropped out for the head turn');
      if (!afterMirror?.mirror.thatsMe) t.problem('bug', "\"That's me\" never played");
      t.progress(0.45);

      // To the desk.
      t.scene('Walk to the desk');
      const desk0 = performance.now();
      while (performance.now() - desk0 < 90000) {
        const d = probe.desk?.();
        if (d && (d.phase === 'arrive' || d.phase === 'sweep')) break;
        await walkTo({ x: 47.2, z: 40.6 }, 'desk', 0.7);
        checkPrompt();
        await tick();
      }
      releaseAll();
      const sweepStart = performance.now();
      while (probe.desk?.().phase !== 'sweep' && performance.now() - sweepStart < 20000) await tick();
      if (probe.desk?.().phase !== 'sweep') t.problem('bug', 'never reached the desk beat');
      await sleep(1800);
      const canvas = probe.canvas;
      const rect = canvas.getBoundingClientRect();
      const pointerType = phone ? 'touch' : 'mouse';
      const pid = phone ? 71 : 1;
      let dragNo = 0;
      const swipe = async (x0: number, x1: number, y: number, events: number, gapMs: number) => {
        dragNo += 1;
        const at = (fx: number) => ({ clientX: rect.left + rect.width * fx, clientY: rect.top + rect.height * y });
        const init = (fx: number, buttons: number) => ({ pointerType, pointerId: pid, isPrimary: true, button: 0, buttons, bubbles: true, cancelable: true, composed: true, ...at(fx) });
        canvas.dispatchEvent(new PointerEvent('pointerdown', init(x0, 1)));
        for (let i = 1; i <= events; i += 1) {
          await sleep(gapMs);
          canvas.dispatchEvent(new PointerEvent('pointermove', init(x0 + ((x1 - x0) * i) / events, 1)));
        }
        canvas.dispatchEvent(new PointerEvent('pointerup', init(x1, 0)));
        await sleep(1600);
        const d = probe.desk!();
        t.event('sweep', `drag ${dragNo} (${phone ? 'one finger' : 'mouse'}, ${events} steps of ${gapMs} ms): ${d.desk.off} of ${d.desk.total} props off the desk, peak hand speed ${d.desk.peakSpeed} m/s`);
        return d.desk.off;
      };
      const gentle = await swipe(0.42, 0.52, 0.55, 12, 60);
      t.metric('propsOffGentle', gentle);
      let hard = gentle;
      for (let i = 0; i < 5 && probe.desk?.().phase === 'sweep'; i += 1) {
        hard = await swipe(i % 2 === 0 ? 0.2 : 0.8, i % 2 === 0 ? 0.8 : 0.2, 0.55, 10, 18);
      }
      t.metric('propsOffHard', hard);
      const afterSweep = probe.desk!();
      t.metric('sweepSounds', afterSweep.desk.sounds.length);
      for (const id of new Set(afterSweep.desk.sounds)) t.event('sfx', `${id} x${afterSweep.desk.sounds.filter((s) => s === id).length}`);
      if (hard <= gentle) t.problem('bug', `a harder drag sent no more props off (${gentle} then ${hard})`);
      if (!afterSweep.desk.sounds.some((s) => s.startsWith('paper'))) t.problem('bug', 'no paper sound when the papers moved');
      if (!afterSweep.desk.sounds.some((s) => s === 'terminal-crash' || s === 'desk-impact')) t.problem('bug', 'no impact sound when a heavy prop fell');
      if (!afterSweep.desk.terminalOff) t.problem('bug', 'the terminal never left the desk under a hard drag');
      const endAt = performance.now();
      while (!/end level/i.test(probe.action() ?? '') && performance.now() - endAt < 40000) await tick();
      t.event('check', `action after the sweep: ${probe.action()}`);
      if (!/end level/i.test(probe.action() ?? '')) t.problem('bug', "End Level was not offered after \"I'm going home\"");
      cw.stop();
      const sum = cw.summary();
      lastCam = sum;
      t.metric('cameraFrames', sum.frames);
      t.metric('cameraInside', sum.inside);
      t.metric('cameraSnaps', sum.snaps);
      t.event('camera-summary', JSON.stringify({ ...sum, worst: sum.worst.map((w) => ({ ...w, shot: undefined })) }));
      sum.worst.forEach((w, i) => { if (w.shot) t.event('camera-screenshot', JSON.stringify({ rank: i + 1, kind: w.kind, detail: w.detail, image: w.shot })); });
      if (sum.inside > 0) t.problem('bug', `camera inside geometry on The Desk: ${sum.inside} frames`);
      if (phone) probe.phoneFrame(false);
      t.progress(1);
      return 'done';
    };

    // ---- b3-retry: Defeat -> Start five times, scene counts stay flat
    const b3RetryRun = async () => {
      levelsTotal = 1;
      const stages = RETRIES + 1;
      // A level keeps loading GLBs after Start is live. Wait until the counts hold still for 3 s (max 90 s).
      const settle = async (what: string) => {
        const until = performance.now() + 90000;
        let last = JSON.stringify(flat(probe.counts()));
        let since = performance.now();
        while (performance.now() < until) {
          await sleep(500);
          const next = JSON.stringify(flat(probe.counts()));
          if (next !== last) {
            last = next;
            since = performance.now();
          } else if (performance.now() - since >= 3000) {
            return probe.counts();
          }
        }
        t.log(`${what}: counts still moving after 90 s`);
        return probe.counts();
      };
      const flat = (c: SceneCounts) => FLAT_COUNTS.map((key) => c[key]);
      const control = async (what: string) => {
        const until = performance.now() + 120000;
        while (!controllable()) {
          if (performance.now() > until) throw new Error(`timed out waiting for ${what}`);
          if (probe.cutscene() && probe.skipButton && !probe.skipButton.hidden) {
            press(probe.skipButton, 'Skip');
            await sleep(800);
          }
          if (probe.phone().incoming) await once('f', 1500, 'answer call');
          await tick();
        }
      };
      const report = (label: string, c: SceneCounts) => {
        t.log(`${label}: ${FLAT_COUNTS.map((key) => `${key} ${c[key]}`).join(', ')}, audio ${c.audioElements}/${c.audioClips}, fps ${c.fps}`);
        t.note(`${label}: meshes ${c.meshes}, materials ${c.materials}, textures ${c.textures}, skeletons ${c.skeletons}`);
      };

      t.scene(LEVELS[1].name);
      await enterLevel(2);
      await control('B3 control');
      const entry = await settle('entry');
      report('entry', entry);
      t.progress(1 / (stages + 1));
      const after: SceneCounts[] = [];
      for (let n = 1; n <= RETRIES; n++) {
        releaseAll();
        await control(`control before death ${n}`);
        if (!probe.forceDefeat()) throw new Error(`could not down Pierce on try ${n}`);
        t.event('defeat', `try ${n} (test shortcut)`);
        const until = performance.now() + 30000;
        while (probe.menu().title !== 'Defeat' || !probe.menu().start) {
          if (performance.now() > until) throw new Error(`no Defeat card on try ${n}`);
          await tick();
        }
        await sleep(800);
        press(probe.startButton, 'Start (retry)');
        t.add('respawns');
        await waitControl(`retry ${n}`, 120000);
        await control(`retry ${n} control`);
        const counts = await settle(`retry ${n}`);
        after.push(counts);
        report(`retry ${n}`, counts);
        t.event('retry', { n, ...counts });
        t.progress((n + 1) / (stages + 1));
      }
      const first = after[0];
      const last = after[after.length - 1];
      for (const key of FLAT_COUNTS) {
        t.metric(`${key}Entry`, entry[key]);
        t.metric(`${key}First`, first[key]);
        t.metric(`${key}Last`, last[key]);
        const growth = last[key] - first[key];
        t.metric(`${key}Growth`, growth);
        // The first retry may still fill a shared cache; after that each retry must come back the same.
        const rising = after.slice(1).every((c, i) => c[key] >= after[i][key]) && growth > 0;
        if (rising && growth >= RETRIES - 1) {
          t.problem('bug', `B3 retry leaks ${key}: ${first[key]} after the first retry, ${last[key]} after ${RETRIES} (${after.map((c) => c[key]).join(' -> ')})`);
        }
      }
      t.metric('audioElementsLast', last.audioElements);
      t.metric('audioClipsLast', last.audioClips);
      t.metric('fpsLast', last.fps);
      t.progress(1);
      t.finish('done');
    };

    // ---- train: level 7's car (hidden level)
    const trainRun = async (): Promise<Outcome> => {
      levelsTotal = 1;
      const deg = (r: number) => (r * 180) / Math.PI;
      // Load Level lists level 7 now that it is released.
      const rows = probe.levelRows();
      const listed = rows.some((row) => /level 7/i.test(row) && /train/i.test(row));
      t.event('check', `Load Level lists ${rows.length} levels: ${rows.join(' | ')}`);
      if (!listed) t.problem('bug', `Load Level does not list level 7, The Train: ${rows.join(' | ')}`);
      t.progress(0.05);

      const sampleFps = async (what: string, ms: number) => {
        releaseAll();
        await sleep(2000); // let the level settle
        const got: number[] = [];
        const until = performance.now() + ms;
        while (performance.now() < until) {
          await sleep(500);
          got.push(probe.counts().fps);
        }
        const avg = got.reduce((a, b) => a + b, 0) / Math.max(1, got.length);
        t.event('fps', `${what}: ${avg.toFixed(1)} fps average, worst ${Math.min(...got).toFixed(1)} (${got.length} samples standing still)`);
        return avg;
      };

      // 4: the baseline, The Station, sampled the same way.
      let fpsStation = 0;
      if (options.compare !== false) {
        await enterLevel(6);
        t.scene(LEVELS[5].name);
        t.event('level-start', `${LEVELS[5].name} (frame rate baseline)`);
        const until = performance.now() + 150000;
        let skipped = false;
        while (probe.scripted() || !probe.running()) {
          if (performance.now() > until) throw new Error('timed out waiting for the station opening to end');
          if (!skipped && probe.scripted() && probe.skipButton && !probe.skipButton.hidden) {
            await sleep(2500);
            press(probe.skipButton, 'Skip');
            skipped = true;
          }
          await tick();
        }
        fpsStation = await sampleFps('The Station', 8000);
        t.metric('fpsStation', Math.round(fpsStation * 10) / 10);
      }
      t.progress(0.3);

      // 1: enter the car.
      t.event('setup', 'start level 7, The Train, directly (test shortcut, as ?beat=train)');
      await probe.setupHidden('the-train');
      await t.until(() => probe.running() && probe.level().libraryId === 'the-train' && !probe.menu().open, 90000, 'level 7 to start');
      t.scene('Level 7: The Train');
      t.event('level-start', 'Level 7: The Train (hidden)');
      // The level opens on a scene: Skip it, the car is what this run looks at.
      await t.until(() => !!probe.scripted() || controllable(), 15000, 'the opening scene or control');
      if (probe.scripted()) {
        await sleep(1500);
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        await t.until(() => controllable(), 10000, 'control after the opening');
      }
      await measureLook();
      const car = probe.train();
      if (!car) {
        t.problem('bug', 'level 7 started but the train car kit is not mounted');
        return 'error';
      }
      const start = probe.player();
      t.event('car', `${car.seats} benches, ${car.poles} poles, ${car.ads} ads, ${car.windows} windows; Pierce at (${start.x.toFixed(1)}, ${start.z.toFixed(1)})`);
      if (car.seats < 8 || car.poles < 4 || car.ads < 4 || car.windows < 8) t.problem('bug', `the car is missing parts: ${JSON.stringify(car)}`);

      // Look out of the north windows: lamps going past, and the sway.
      face(0);
      await sleep(600);
      face(0);
      const lamps0 = probe.train()?.lampsPassed ?? 0;
      let rollMin = Infinity;
      let rollMax = -Infinity;
      const t0 = performance.now();
      while (performance.now() - t0 < 5000) {
        await tick();
        const r = probe.train()?.roll ?? 0;
        rollMin = Math.min(rollMin, r);
        rollMax = Math.max(rollMax, r);
      }
      const secs = (performance.now() - t0) / 1000;
      const now = probe.train();
      const lamps = (now?.lampsPassed ?? 0) - lamps0;
      t.event('tunnel', `${lamps} tunnel lamps went past the windows in ${secs.toFixed(1)} s at ${now?.speed ?? 0} m/s (splatReady=${Boolean(now?.splatReady)}, splatCount=${now?.splatCount ?? 0})`);
      t.metric('lampsPerSecond', Math.round((lamps / secs) * 100) / 100);
      t.metric('splatCount', now?.splatCount ?? 0);
      if (lamps < 2) t.problem('bug', `the tunnel is not moving past the windows (${lamps} lamps in ${secs.toFixed(1)} s)`);
      const sway = deg(rollMax - rollMin);
      t.event('sway', `the car rolls between ${deg(rollMin).toFixed(2)}° and ${deg(rollMax).toFixed(2)}° (${sway.toFixed(2)}° swing)`);
      t.metric('swayDegrees', Math.round(sway * 100) / 100);
      if (sway < 0.3) t.problem('bug', `no visible sway: ${sway.toFixed(2)}° of roll in ${secs.toFixed(1)} s`);
      if (sway > 4) t.problem('warning', `the sway is more than slight: ${sway.toFixed(2)}° of roll`);
      face(Math.PI / 2);
      t.progress(0.45);

      // 4: the frame rate in the car, sampled like the station.
      const fpsTrain = await sampleFps('The Train', 8000);
      t.metric('fpsTrain', Math.round(fpsTrain * 10) / 10);
      if (fpsStation > 0) {
        t.event('check', `frame rate: train ${fpsTrain.toFixed(1)} vs station ${fpsStation.toFixed(1)} fps`);
        if (fpsTrain < fpsStation * 0.9) t.problem('bug', `the train runs slower than The Station: ${fpsTrain.toFixed(1)} vs ${fpsStation.toFixed(1)} fps`);
      }
      t.progress(0.55);

      // 2: the seats and poles block. Walk into each with real input and see how close he gets.
      const arrive = async (goal: Point, key: string) => {
        const until = performance.now() + 30000;
        while (!(await walkTo(goal, key, 0.35))) {
          if (performance.now() > until) throw new Error(`timed out walking to ${key}`);
          await tick();
        }
        releaseAll();
        await sleep(300);
      };
      /** Hold the walk toward a point; closest is to `watch` (the thing walked into). */
      const push = async (toward: Point, ms: number, watch: Point = toward) => {
        let closest = Infinity;
        let far = -Infinity;
        const until = performance.now() + ms;
        while (performance.now() < until) {
          steer(toward, true);
          await tick();
          const p = probe.player();
          closest = Math.min(closest, dist(p, watch));
          far = Math.max(far, Math.abs(p.z));
        }
        releaseAll();
        return { closest, far, at: probe.player() };
      };
      for (const side of [1, -1]) {
        const name = side > 0 ? 'north' : 'south';
        await arrive({ x: 4.5, z: 0 }, `aisle by the ${name} bench`);
        const got = await push({ x: 4.5, z: side * 1.4 }, 2500);
        const stopped = got.far < 1.0;
        t.event('blocked-seat', `walked into the ${name} bench for 2.5 s: stopped at z ${got.at.z.toFixed(2)} (bench front at ${(side * 1.04).toFixed(2)})${stopped ? '' : ' (INSIDE the bench)'}`);
        if (!stopped) t.problem('bug', `Pierce walked into the ${name} bench: z ${got.far.toFixed(2)}`);
      }
      const pole = { x: 6.8, z: 0 };
      await arrive({ x: 5.4, z: 0 }, 'aisle behind the center pole');
      // The walk target is past the pole; what matters is how close he ever came to the pole itself.
      const hit = await push({ x: 8.4, z: 0 }, 2500, pole);
      const near = hit.closest;
      const poleOk = near >= 0.3;
      t.event('blocked-pole', `walked straight at the center pole by the second door for 2.5 s: never closer than ${near.toFixed(2)} m, ended at (${hit.at.x.toFixed(2)}, ${hit.at.z.toFixed(2)})`);
      if (!poleOk) t.problem('bug', `Pierce walked through the center pole at x ${pole.x}: ${near.toFixed(2)} m from it`);
      t.progress(0.7);

      // 2: the length of the car, back to front, around the poles.
      await arrive({ x: 17.0, z: 0 }, 'front of the car');
      const end = probe.player();
      const walked = end.x - start.x;
      t.event('walked', `the length of the car: from x ${start.x.toFixed(1)} to x ${end.x.toFixed(1)} (${walked.toFixed(1)} m)`);
      t.metric('carWalkMeters', Math.round(walked * 10) / 10);
      if (walked < 14) t.problem('bug', `Pierce did not reach the front of the car (${walked.toFixed(1)} m walked)`);
      await sleep(1500);
      return 'done';
    };

    // ---- level-7: The Train, the story. `arrived` means Continue from The Station already started it.
    const trainStoryRun = async (arrived = false): Promise<Outcome> => {
      if (!arrived) levelsTotal = 1;
      const t0 = performance.now();
      const story = () => probe.train()?.story ?? null;
      const enter = async (why: string) => {
        t.event('setup', `start level 7, The Train, directly (test shortcut, as ?beat=train)${why}`);
        await probe.setupHidden('the-train');
        await t.until(() => probe.running() && probe.level().libraryId === 'the-train' && !probe.menu().open, 90000, 'level 7 to start');
      };

      // 4: combat is off in the library row.
      try {
        const lib = await (await fetch(new URL('levels/level-library.json', location.href).href, { cache: 'no-store' })).json() as { levels?: { id: string; combat?: boolean }[] };
        const row = (lib.levels ?? []).find((r) => r.id === 'the-train');
        t.event('check', `level library: the-train combat ${row?.combat}`);
        if (row?.combat !== false) t.problem('bug', `level 7 has combat on in levels/level-library.json (${row?.combat})`);
      } catch {
        t.event('check', 'level library not readable from this page; combat checked from the scene instead');
      }

      // 1: the opening, played through. Continue from The Station has already started it.
      if (!arrived) await enter('');
      t.scene('Level 7: The Train');
      t.event('level-start', arrived ? 'Level 7: The Train (from The Station Continue)' : 'Level 7: The Train');
      const want = ['dialogue.train.there', 'dialogue.train.pole', 'dialogue.train.turn', 'dialogue.train.next'];
      const lines = storyLines();
      const textOf = (id: string) => lines.find((row) => row.id === id)?.text ?? id;
      for (const row of lines.filter((r) => /^(dialogue|bark)\.train\.|^phone\.(hale-train|stop\.hale)\./.test(r.id))) {
        if (!row.audio.trim()) t.problem('bug', `train line ${row.id} has no clip`);
      }
      const heard: string[] = [];
      let sawBody = false;
      let bodyLeft = false;
      const opening0 = performance.now();
      await t.until(() => probe.scripted() === 'train-opening', 10000, 'the opening scene');
      if (!probe.skipButton || probe.skipButton.hidden) t.problem('bug', 'no Skip button during the train opening');
      while (probe.scripted() === 'train-opening') {
        if (performance.now() - opening0 > 60000) throw new Error('the train opening ran past 60 s');
        const sub = probe.subtitle().text.trim();
        if (sub && heard[heard.length - 1] !== sub) heard.push(sub);
        const s = story();
        if (s?.oldBody) sawBody = true;
        if (sawBody && s && (!s.oldBody || s.oldBody.x >= 17.9)) bodyLeft = true;
        await tick();
      }
      const openingSecs = (performance.now() - opening0) / 1000;
      t.metric('trainOpeningSeconds', Math.round(openingSecs * 10) / 10);
      const order = want.map((id) => heard.indexOf(textOf(id)));
      const inOrder = order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]));
      t.event('check', `opening: ${heard.length} subtitles in ${openingSecs.toFixed(1)} s; the four lines ${inOrder ? 'in order' : `OUT OF ORDER or missing (${order.join(', ')})`}`);
      if (!inOrder) t.problem('bug', `the train opening lines did not play in order: ${heard.join(' | ')}`);
      t.event('check', `opening: the old body ${sawBody ? 'stood at the front of the car' : 'was NOT seen'}${bodyLeft ? ' and walked out through the front end door' : ''}`);
      if (!sawBody || !bodyLeft) t.problem('bug', 'the old body was not seen leaving car 1 in the opening');
      // `full` is already on level 7 of 8; an absolute fraction would rewind the bar.
      if (full) mark();
      else t.progress(arrived ? 0.5 : 0.2);

      // Skip, on the direct start only. Continue already spent the opening.
      if (!arrived) {
        await enter(' again, to press Skip in the opening');
        await t.until(() => probe.scripted() === 'train-opening', 10000, 'the opening scene again');
        await sleep(3000);
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        const skip0 = performance.now();
        try {
          await t.until(() => controllable() && probe.objective().visible, 2000, 'control after Skip');
          t.event('check', `Skip: control and the objective back in ${((performance.now() - skip0) / 1000).toFixed(1)} s (${probe.objective().text})`);
        } catch {
          t.problem('bug', 'Skip in the train opening did not hand control back within 2 s');
        }
      }
      await measureLook();
      if (full) mark();
      else t.progress(arrived ? 0.55 : 0.3);

      // 2-4: play to the end with real input.
      let endPressed = false;
      let endBeat = '';
      let shadowDone = false;
      let lastCar = story()?.car ?? 1;
      let stopSeen = false;
      let facedAway = true;
      let stepped = false;
      const lastAction = { label: '' };
      for (;;) {
        await tick();
        if (performance.now() - t0 > 230000) return 'stuck';
        const menu = probe.menu();
        if (menu.open) {
          if (endPressed) break;
          continue;
        }
        const s = story();
        if (s && s.car !== lastCar) {
          lastCar = s.car;
          t.event('car', `car ${s.car}: the old body ${s.oldBody ? `is ahead at x ${s.oldBody.x.toFixed(1)}` : 'is not in sight'}; ${s.riders} riders`);
          mark();
        }
        if (s && s.beat === 'cars' && s.car === 2 && s.oldBody && (s.leftCar ?? 0) < 2) {
          // He keeps one car ahead: never close enough to touch.
          const p = probe.player();
          if (Math.abs(p.x - s.oldBody.x) < 0.6 && Math.abs(p.z - s.oldBody.z) < 0.6) t.problem('bug', 'Pierce caught up with the old body in car 2');
        }
        if (probe.cutscene() || probe.scripted()) {
          releaseAll();
          if (s?.beat === 'stop') {
            if (!stopSeen) {
              stopSeen = true;
              const car = probe.train();
              t.event('stop', `the stop scene: train at ${car?.speed ?? 0} m/s, platform ${car?.platform ?? 0}`);
            }
            if (s.oldBody && s.oldBody.z > 1.0) stepped = true;
            // Pierce is behind him (south-west); facing back would point south (|yaw| > 90°).
            if (s.oldBody && s.oldBodyFacing !== null && Math.abs(((s.oldBodyFacing + 540) % 360) - 180) > 90) facedAway = false;
            const car = probe.train();
            if (car && car.door > 0.9 && !seenRaw.has('door-open')) { seenRaw.add('door-open'); t.event('stop', `the north door is open (train ${car.speed} m/s, platform ${car.platform})`); }
          }
          continue;
        }
        if (!probe.running()) continue;
        const phone = probe.phone();
        if (phone.incoming) { releaseAll(); await once('f', 1500, 'answer call'); t.event('call', phone.speaker || 'incoming'); continue; }
        if (phone.busy) { releaseAll(); continue; }
        // 4: Shadow mode as at the station, once, in car 2.
        if (!shadowDone && s?.car === 2 && s.beat === 'cars') {
          shadowDone = true;
          releaseAll();
          const before = probe.shadow();
          t.event('shadow', `controls ${before.controls}, ability ${before.ability}`);
          await tap('c', 'Shadow mode');
          await sleep(500);
          const on = probe.shadow();
          await tap('Tab', 'switch ability');
          await sleep(400);
          const switched = probe.shadow().ability;
          setHeld('w');
          sendKey('keydown', 'Shift');
          await sleep(900);
          sendKey('keyup', 'Shift');
          releaseAll();
          await tap('c', 'Shadow mode off');
          await sleep(500);
          const off = probe.shadow();
          t.event('shadow', `C: on ${on.on} (ability ${on.ability}), Tab: ${switched}, C again: on ${off.on}`);
          if (!before.controls || !on.on || off.on || switched === on.ability) t.problem('bug', `Shadow mode on the train does not work as at the station: controls ${before.controls}, on ${on.on}, Tab ${on.ability} -> ${switched}, off ${!off.on}`);
          const hostile = probe.people().filter((x) => x.kind === 'hostile' || x.kind === 'enemy').length;
          if (hostile) t.problem('bug', `combat is on in level 7: ${hostile} hostiles`);
          continue;
        }
        const label = probe.action();
        if (label) {
          releaseAll();
          if (await once('e', 1200, label)) {
            if (label !== lastAction.label) t.event('action', label);
            lastAction.label = label;
            levelSteps += 1;
            mark();
            if (label === 'End Level') {
              if (!endBeat) {
                endBeat = story()?.beat ?? '';
                t.event('end-level', `offered on beat ${endBeat || 'unknown'}`);
                if (endBeat !== 'done') t.problem('bug', `End Level showed before the story finished (beat ${endBeat || 'none'})`);
              }
              endPressed = true;
            }
          }
          continue;
        }
        if (probe.shadow().linked && (await once('Tab', 1200, 'release link'))) continue;
        const obj = probe.objective();
        if (!obj.target) { releaseAll(); continue; }
        const there = await walkTo(obj.target, `${obj.title || 'objective'}: ${obj.text.slice(0, 40)}`, 0.3);
        if (there) {
          const p = probe.player();
          if (dist(p, obj.target) > 0.12) steer(obj.target, false);
          else releaseAll();
        }
      }
      releaseAll();
      const s = story();
      t.event('check', `the old body got off: ${stepped ? 'stepped out through the north door' : 'NOT seen stepping out'}, ${facedAway ? 'never turned toward Pierce' : 'TURNED toward Pierce'}; Hale called: ${s?.hale}`);
      if (!stopSeen) t.problem('bug', 'the stop scene did not play');
      if (!stepped) t.problem('bug', 'the old body did not get off at the stop');
      if (!facedAway) t.problem('bug', 'the old body looked back as he got off');
      t.metric('trainCars', lastCar);
      const secs = (performance.now() - t0) / 1000;
      t.metric('trainSeconds', Math.round(secs));
      t.event('level-end', `Level 7: The Train in ${secs.toFixed(0)} s`);
      if (!endPressed) {
        t.problem('bug', 'level 7 ended without End Level');
        return 'stuck';
      }
      await sleep(700);
      const menu = probe.menu();
      const exitBtn = document.getElementById('loadModelBtn');
      const credits = document.getElementById('levelCredits');
      const crawl = (credits?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const song = probe.ending() ?? '';
      const showing = !!credits && !credits.hidden && crawl.length > 40;
      const own = /Preferred A Man/.test(crawl) && /Went Uptown/.test(crawl) && !/Open On Nothing/.test(crawl);
      const continues = menu.title === 'Level Complete' && menu.start === 'Continue' && /exit/i.test(exitBtn?.textContent ?? '');
      t.scene('Level 7 complete');
      t.event('ending', `song ${/ending-6\.mp3/.test(song) ? 'ending-6' : (song || 'none')}; credits ${showing && own ? 'level 7' : 'wrong'}; continue ${menu.start ?? 'hidden'}; button ${(exitBtn?.textContent ?? '').trim()}`);
      if (!/ending-6\.mp3/.test(song)) t.problem('bug', `level 7 did not play The Station's end song (got ${song || 'nothing'})`);
      if (!showing || !own) t.problem('bug', `level 7 credits did not roll ("${crawl.slice(0, 160)}")`);
      if (!continues) t.problem('bug', `level 7's card should offer Continue into level 8 and Exit (continue ${menu.start ?? 'hidden'}, title ${menu.title}, other ${(exitBtn?.textContent ?? '').trim()})`);
      await sleep(3500);
      return 'won';
    };

    /** The Train as a pursuit (train-chase): cars 1-3 once, then car 3's doors closing a breath before Pierce, N times. */
    const trainChaseRun = async (): Promise<Outcome> => {
      levelsTotal = 1;
      const phone = Boolean(options.phone);
      const runs = Math.max(1, Math.min(20, Number(options.runs ?? 10)));
      if (probe.sound().prompt) await tapToPlay();
      if (phone) { probe.phoneFrame(true); t.event('setup', 'phone layout 390x844 (touch)'); await sleep(800); }
      const story = () => probe.train()?.story ?? null;
      const zone = document.getElementById('leftStickZone') as HTMLElement | null;
      let down = false;
      const stick = (ux: number, uy: number) => {
        if (!zone) return;
        const zr = zone.getBoundingClientRect();
        const type = down ? 'pointermove' : 'pointerdown';
        down = true;
        zone.dispatchEvent(new PointerEvent(type, { pointerId: 31, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: zr.left + zr.width / 2 + ux * zr.width * 0.38, clientY: zr.top + zr.height / 2 + uy * zr.height * 0.38 }));
      };
      const lift = () => {
        if (down && zone) zone.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31, pointerType: 'touch', bubbles: true }));
        down = false;
      };
      const walkToward = (to: Point) => {
        const p = probe.player();
        const heading = Math.atan2(to.x - p.x, to.z - p.z);
        if (phone) {
          const rel = wrap(heading - probe.cameraYaw());
          stick(Math.sin(rel), -Math.cos(rel));
        } else steer(to, true);
      };
      const stopWalking = () => { if (phone) lift(); else releaseAll(); };
      const skipScene = async () => {
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        await sleep(300);
      };
      const enterCar = async (car: number) => {
        (window as unknown as { __phTrainStart?: number }).__phTrainStart = car;
        await probe.setupHidden('the-train');
        await t.until(() => probe.running() && probe.level().libraryId === 'the-train' && !probe.menu().open, 90000, 'level 7 to start');
        (window as unknown as { __phTrainStart?: number }).__phTrainStart = 1;
      };
      let nextCarPrompt = false;
      const watchPrompt = () => { if (/next car/i.test(probe.action() ?? '')) nextCarPrompt = true; };

      // ---- Run 1: the whole pursuit, cars 1 to 3.
      t.scene('The Train: the pursuit');
      await enterCar(1);
      await t.until(() => probe.scripted() === 'train-opening', 10000, 'the opening scene');
      await sleep(2500);
      await skipScene();
      await t.until(() => controllable(), 8000, 'control after the opening');
      const seenCars = new Map<number, { ahead: boolean; aisle: boolean; lurches: number; stumbles: number }>();
      let crossings = 0;
      let lastCar = 1;
      let lastStumbles = 0;
      const chase0 = performance.now();
      while (performance.now() - chase0 < 200000) {
        await tick();
        watchPrompt();
        const s = story();
        if (!s) continue;
        const row = seenCars.get(s.car) ?? { ahead: false, aisle: false, lurches: 0, stumbles: 0 };
        if (s.oldBodyAhead || (s.car > 1 && s.oldBody && s.oldBody.x > 17.5)) row.ahead = true;
        if (s.aisleRiders > 0) row.aisle = true;
        row.lurches = Math.max(row.lurches, s.lurches);
        row.stumbles = Math.max(row.stumbles, s.stumbles);
        seenCars.set(s.car, row);
        if (s.car !== lastCar) { crossings += 1; lastCar = s.car; t.event('car', `crossed into car ${s.car} without a prompt`); }
        if (s.stumbles > lastStumbles) {
          lastStumbles = s.stumbles;
          await sleep(900);
          if (!controllable() && !probe.scripted()) t.problem('bug', 'a stumble took control from Pierce');
          else t.event('stumble', `car ${s.car}: stumble at x ${probe.player().x.toFixed(1)}; control kept`);
        }
        if (s.beat === 'stop') break;
        if (!controllable()) { stopWalking(); continue; }
        const phoneState = probe.phone();
        if (phoneState.incoming || phoneState.busy) { stopWalking(); continue; }
        // Shadow mode once in car 2 (phone: the Shadow button); the chase is run on with the stick.
        const obj = probe.objective();
        if (obj.target) walkToward(obj.target);
      }
      stopWalking();
      if (nextCarPrompt) t.problem('bug', 'a "Next car" prompt was offered at an end door');
      if (crossings < 2) t.problem('bug', `walking through the front end doors changed car ${crossings} times (wanted 2: car 1 to 2 and 2 to 3)`);
      for (const car of [1, 2, 3]) {
        const row = seenCars.get(car);
        t.event('check', `car ${car}: old body ahead ${row?.ahead}, rider in the aisle ${row?.aisle}, lurches ${row?.lurches ?? 0}, stumbles ${row?.stumbles ?? 0}`);
        if (!row?.ahead) t.problem('bug', `car ${car}: the old body was never visible ahead through the end-door glass`);
        if (!row?.aisle) t.problem('bug', `car ${car}: no rider stood in the aisle`);
        if (!row || row.lurches < 1) t.problem('bug', `car ${car}: the car never lurched`);
      }
      const total = story();
      t.metric('trainLurches', total?.lurches ?? 0);
      t.metric('trainStumbles', total?.stumbles ?? 0);
      t.progress(0.3);

      // ---- Runs in car 3: the doors close a breath before him.
      let caught = 0;
      let gapMax = 0;
      let done = 0;
      for (let run = 1; run <= runs; run += 1) {
        await enterCar(3);
        const run0 = performance.now();
        let reachedStop = false;
        let closed: { gap: number; onPlatform: boolean; x: number; z: number } | null = null;
        let touched = false;
        while (performance.now() - run0 < 90000) {
          await tick();
          const s = story();
          if (!s) continue;
          watchPrompt();
          if (probe.scripted() === 'train-opening') { await skipScene(); continue; }
          if (s.beat === 'stop') { reachedStop = true; stopWalking(); await skipScene(); continue; }
          if (s.beat === 'closing' || s.beat === 'done') break;
          if (s.doorsClosed && !closed) {
            const p = probe.player();
            closed = { gap: s.doorGap ?? 99, onPlatform: s.oldBodyOnPlatform, x: p.x, z: p.z };
            stopWalking();
          }
          if (s.beat === 'door' && !s.doorsClosed && probe.player().z > 1.45 && Math.abs(probe.player().x - 11.2) < 0.4) touched = true;
          const phoneState = probe.phone();
          if (phoneState.incoming) { stopWalking(); await once('f', 1500, 'answer call'); continue; }
          if (phoneState.busy || !controllable()) { stopWalking(); continue; }
          const obj = probe.objective();
          if (obj.target) walkToward(obj.target);
        }
        stopWalking();
        done += 1;
        const ok = !!closed && !touched && closed.onPlatform && closed.gap >= 0.05 && closed.gap <= 1.1;
        if (ok) caught += 1;
        if (closed) gapMax = Math.max(gapMax, closed.gap);
        t.event('chase', `run ${run}/${runs}: ${reachedStop ? 'stop played' : 'no stop'}; doors ${closed ? `closed with Pierce ${closed.gap.toFixed(2)} m away, old body ${closed.onPlatform ? 'on the platform' : 'NOT in sight'}` : 'did not close'}${touched ? '; Pierce touched them first' : ''}`);
        if (!ok) t.problem('bug', `chase run ${run}: ${closed ? `gap ${closed.gap.toFixed(2)} m, old body on platform ${closed.onPlatform}, touched first ${touched}` : 'the doors never closed'}`);
        t.progress(0.3 + 0.7 * (run / runs));
      }
      t.metric('chaseRuns', done);
      t.metric('chaseCaught0', caught);
      t.metric('chaseDoorGapMax', Math.round(gapMax * 100) / 100);
      if (phone) probe.phoneFrame(false);
      return caught === runs ? 'won' : 'stuck';
    };

    /** Level 8, The Morning: bed, wake-up, the TV, Voss's call, the door, End Level. Real input all the way. */
    const morningRun = async (arrived = false): Promise<Outcome> => {
      if (!arrived) levelsTotal = 1;
      const t0 = performance.now();
      const story = () => probe.morning();
      try {
        const lib = await (await fetch(new URL('levels/level-library.json', location.href).href, { cache: 'no-store' })).json() as { levels?: { id: string; combat?: boolean }[] };
        const row = (lib.levels ?? []).find((r) => r.id === 'the-morning');
        t.event('check', `level library: the-morning combat ${row?.combat}`);
        if (!row) t.problem('bug', 'levels/level-library.json has no the-morning row');
        else if (row.combat !== false) t.problem('bug', `level 8 has combat on in the library (${row.combat})`);
      } catch {
        t.event('check', 'level library not readable from this page');
      }
      if (!arrived) {
        t.event('setup', 'start level 8, The Morning, directly (test shortcut)');
        await probe.setupLevel(8);
      }
      await t.until(() => probe.running() && probe.level().libraryId === 'the-morning' && !probe.menu().open, 90000, 'level 8 to start');
      t.scene('Level 8: The Morning');
      t.event('level-start', 'Level 8: The Morning');
      const vossIds = [1, 2, 3, 4, 5, 6, 7].map((n) => `phone.voss-morning.${String(n).padStart(2, '0')}`);
      const rows = storyLines().filter((r) => /^(dialogue\.morning|phone\.voss-morning|news\.morning)\./.test(r.id));
      for (const row of rows) if (missingClip(row)) t.problem('bug', `level 8 line ${row.id} has no clip`);
      const textOf = (id: string) => storyLines().find((r) => r.id === id)?.text ?? id;
      const heard: string[] = [];
      const note = (text: string) => { const x = text.trim(); if (x && heard[heard.length - 1] !== x) heard.push(x); };
      let sawLying = false;
      let sawWake = false;
      let sawTv = false;
      let sawCall = false;
      let sawSleepScene = false;
      let endPressed = false;
      let endBeat = '';
      let tvText = '';
      let lastBeat = '';
      let lastAction = '';
      let stepsDone = 0;
      let scenesSeen: number[] = [];
      for (;;) {
        await tick();
        if (performance.now() - t0 > 300000) return 'stuck';
        const menu = probe.menu();
        if (menu.open) { if (endPressed) break; continue; }
        note(probe.subtitle().text);
        const s = story();
        if (s) {
          if (s.scenes.length !== scenesSeen.length) {
            scenesSeen = s.scenes;
            const names = ['S0 the ride', 'S1 the walk up', 'S2 the threshold', 'S3 the wake-up', 'S4 the news', 'S5 Voss calls', 'S6 the exit'];
            t.event('scene', `level 8 ${names[scenesSeen[scenesSeen.length - 1]]} (${scenesSeen.length}/7)`);
          }
          tvText = s.tvText || tvText;
          if (s.beat !== lastBeat) {
            lastBeat = s.beat;
            t.event('beat', `level 8 beat: ${s.beat}`);
          }
          if (s.lying) sawLying = true;
          if (s.beat === 'wake' && s.lying && !sawWake) {
            sawWake = true;
            t.event('wake', 'Pierce wakes in bed: lying in the bed as the morning comes up');
          }
          if (s.tvOn && s.beat === 'news' && !sawTv) { sawTv = true; t.event('tv', 'the television is on: the morning news'); }
        }
        if (probe.scripted()) { releaseAll(); sawSleepScene = true; continue; }
        if (!probe.running()) continue;
        const phone = probe.phone();
        if (phone.incoming) {
          releaseAll();
          await once('f', 1500, 'answer call');
          sawCall = true;
          t.event('call', `${phone.speaker || 'Voss'} is calling; answered`);
          continue;
        }
        if (phone.busy) { releaseAll(); note(phone.line); continue; }
        const label = probe.action();
        if (label) {
          releaseAll();
          if (await once('e', 1200, label)) {
            if (label !== lastAction) t.event('action', label);
            lastAction = label;
            stepsDone += 1;
            if (label === 'Leave') {
              endBeat = story()?.beat ?? '';
              t.event('end-level', `the door opened on beat ${endBeat || 'unknown'}: the ending plays (no End Level press)`);
              endPressed = true;
              await t.until(() => probe.endSuite().cardShown, 300000, 'the Act II end card');
              break;
            }
          }
          continue;
        }
        const obj = probe.objective();
        if (!obj.target) { releaseAll(); continue; }
        const there = await walkTo(obj.target, `${obj.title || 'objective'}: ${obj.text.slice(0, 40)}`, 0.3);
        if (there) {
          const p = probe.player();
          if (dist(p, obj.target) > 0.12) steer(obj.target, false);
          else releaseAll();
        }
      }
      releaseAll();
      const secs = (performance.now() - t0) / 1000;
      t.metric('morningSeconds', Math.round(secs));
      t.event('level-end', `Level 8: The Morning in ${secs.toFixed(0)} s (${stepsDone} actions)`);
      // 0: the seven scenes of the beat sheet, in order.
      const inOrder = scenesSeen.length === 7 && scenesSeen.every((n, i) => n === i);
      t.event('check', `scenes: ${scenesSeen.join(', ')} ${inOrder ? '(all 7, in order)' : '(NOT all 7 in order)'}`);
      if (!inOrder) t.problem('bug', `level 8 did not play the 7 beat-sheet scenes in order (${scenesSeen.join(', ') || 'none'})`);
      if (!heard.includes(textOf('dialogue.morning.mine')) || !heard.includes(textOf('dialogue.morning.blocks'))) t.problem('bug', 'level 8 S0/S1 barks ("Mine.", "Three blocks…") were not heard');
      // 1: he slept, and woke in the bed.
      const slept = heard.indexOf(textOf('dialogue.morning.slept'));
      t.event('check', `wake: scene ${sawSleepScene ? 'played' : 'NOT seen'}, lying in bed ${sawLying}, woke ${sawWake}, "I slept." ${slept >= 0 ? 'heard' : 'missing'}`);
      if (!sawSleepScene || !sawLying || !sawWake || slept < 0) t.problem('bug', 'Pierce did not wake in bed after sleeping');
      // 2: the TV names the tower and Pierce.
      t.event('check', `tv: ${tvText}`);
      if (!/HAWKES TOWER/.test(tvText) || !/PIERCE HAWKES/.test(tvText) || !sawTv) t.problem('bug', `the TV did not name Hawkes Tower and Pierce Hawkes (${tvText || 'nothing shown'})`);
      const clipsSeen = (tvText.match(/clip:[a-z-]+/g) ?? []).length;
      t.metric('tvClips', clipsSeen);
      if (clipsSeen < 4) t.problem('bug', `the Morning TV played ${clipsSeen} of 4 news clips (${tvText || 'nothing shown'})`);
      if (!heard.some((x) => /Hawkes Tower/.test(x)) || !heard.some((x) => /Pierce Hawkes/.test(x))) t.problem('bug', 'the news captions never named Hawkes Tower and Pierce Hawkes');
      // 3: Voss's call plays in full, in order.
      const order = vossIds.map((id) => heard.indexOf(textOf(id)));
      const full = sawCall && order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]));
      t.event('check', `voss call: ${full ? 'all 7 lines, in order' : `INCOMPLETE (${order.join(', ')})`}, call done ${story()?.callDone}`);
      if (!full || story()?.callDone !== true) t.problem('bug', "Voss's call did not play in full");
      // Voice: every clip played to its end, and no two sounded at once.
      {
        const clips = probe.sound().voice ?? [];
        const played = clips.filter((c) => c.state !== 'failed');
        const cut = played.filter((c) => c.cut);
        let overlaps = 0;
        const byStart = [...played].sort((a, b) => a.start - b.start);
        byStart.forEach((c, i) => { if (i > 0 && c.start < byStart[i - 1].end - 0.05) overlaps += 1; });
        t.metric('voiceClips', played.length);
        t.metric('voiceCut', cut.length);
        t.metric('voiceOverlaps', overlaps);
        t.event('check', `voice clips: ${played.length}, ended ${played.filter((c) => c.state === 'ended').length}, cut ${cut.length}, overlaps ${overlaps}${cut.length ? ` (${cut.map((c) => c.url.split('/').pop()).join(', ')})` : ''}`);
        if (cut.length) t.problem('bug', `voice clip cut short: ${cut.map((c) => c.url.split('/').pop()).join(', ')}`);
        if (overlaps) t.problem('bug', `${overlaps} voice clip${overlaps === 1 ? '' : 's'} sounded over another`);
      }
      // 4: the ending suite: title, credits over six places, the call, the Act II card (details: level-8-ending).
      await sleep(700);
      const end = probe.endSuite();
      const crawl = (document.getElementById('levelCredits')?.textContent ?? '').replace(/\s+/g, ' ').trim();
      t.scene('Level 8 ending');
      t.event('ending', `title ${end.titleShown}; places ${end.places}; call ${end.callHeard}; card ${end.cardShown}; crawl "${crawl.slice(0, 40)}"`);
      if (!endPressed) t.problem('bug', 'level 8 ended without the front door');
      if (!end.titleShown) t.problem('bug', 'the PH ORIGINS title never dropped');
      if (end.places < 6) t.problem('bug', `the credits flew over ${end.places} places (need 6)`);
      if (!end.callHeard || !end.cardShown) t.problem('bug', 'the Act II call or end card did not appear');
      if (crawl) t.problem('bug', `a story text crawl showed: ${crawl.slice(0, 80)}`);
      return endPressed ? 'won' : 'stuck';
    };


    /**
     * Level 8's ending on a 390x844 touch phone: the walk to the door by stick and taps (camera push-in, the Shadow
     * form in the hall mirror), the coat and the closing line, the door onto white, black, PH ORIGINS, credits over
     * six places with names only, the unknown caller, the Act II card with a tappable link; then the same ending
     * skipped on a second run (Skip shows after a first finish).
     */
    const morningEndingRun = async (): Promise<Outcome> => {
      levelsTotal = 1;
      const t0 = performance.now();
      const phone = options.phone !== false;
      if (phone) { probe.phoneFrame(true); t.event('setup', 'phone layout 390x844 (touch)'); await sleep(400); }
      const fits = (el: HTMLElement | null, label: string) => {
        if (!el) { t.problem('bug', `${label} is not on the page`); return false; }
        const r = el.getBoundingClientRect();
        const ok = r.width > 0 && r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
        if (!ok) t.problem('bug', `${label} does not fit the screen (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} in ${window.innerWidth}x${window.innerHeight})`);
        return ok;
      };
      const left = document.getElementById('leftStickZone');
      let stickDown = false;
      const stick = (ux: number, uy: number) => {
        if (!left) return;
        const zr = left.getBoundingClientRect();
        const type = stickDown ? 'pointermove' : 'pointerdown';
        stickDown = true;
        left.dispatchEvent(new PointerEvent(type, { pointerId: 31, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: zr.left + zr.width / 2 + ux * zr.width * 0.38, clientY: zr.top + zr.height / 2 + uy * zr.height * 0.38 }));
      };
      const lift = () => {
        if (stickDown && left) left.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31, pointerType: 'touch', bubbles: true }));
        stickDown = false;
      };
      const touchWalk = async (to: Point, what: string, until: () => boolean, ms = 60000) => {
        const start = performance.now();
        const from = probe.player();
        let moved = 0;
        while (!until() && performance.now() - start < ms) {
          await tick();
          const p = probe.player();
          moved = Math.max(moved, dist(p, from));
          const heading = Math.atan2(to.x - p.x, to.z - p.z);
          const rel = wrap(heading - probe.cameraYaw());
          if (dist(p, to) > 0.35) stick(Math.sin(rel), -Math.cos(rel)); else lift();
        }
        lift();
        t.event('walk', `${what}: moved ${moved.toFixed(1)} m by the touch stick`);
        return until();
      };
      const sawNames = new Set<string>();

      const enter = async () => {
        await probe.setupLevel(8);
        await t.until(() => probe.running() && probe.level().libraryId === 'the-morning' && !probe.menu().open, 90000, 'level 8 to start');
        await sleep(600);
      };
      await enter();
      t.scene('Level 8 ending: the walk to the door');
      probe.morningJump('out');
      await sleep(500);
      let sawPush = 0;
      let sawShadow = false;
      const watch = async () => {
        const s = probe.morning();
        if (s) { sawPush = Math.max(sawPush, s.push); if (s.mirrorShadow) sawShadow = true; }
      };
      const tgt = () => probe.objective().target ?? { x: 3.45, z: 2.45 };
      // 1: keeps control, walks to the coat by the stick; the camera creeps in.
      const atCoat = await touchWalk(tgt(), 'the coat', () => { void watch(); return probe.action() === 'Take coat'; });
      t.event('check', `control: reached the coat by touch ${atCoat}; camera push ${sawPush.toFixed(2)}; Shadow form in the mirror ${sawShadow}`);
      if (!atCoat) t.problem('bug', 'could not walk to the coat with the touch stick');
      if (sawPush <= 0.02) t.problem('bug', 'the camera did not push in during the walk to the door');
      await sleep(1500);
      await watch();
      if (!sawShadow) t.problem('bug', 'the hall mirror never showed the Shadow form');
      await tapAt(document.getElementById('interactBtn'), 'Take coat');
      await t.until(() => probe.morning()?.coatTaken === true, 8000, 'the coat to be taken');
      await t.until(() => probe.morning()?.beat === 'door', 20000, 'the coat scene to end');
      const closing = probe.subtitle().text;
      t.event('dialogue', `closing line: ${closing || '(heard during the scene)'}`);
      // 2: the door.
      const atDoor = await touchWalk(tgt(), 'the door', () => probe.action() === 'Leave');
      if (!atDoor) t.problem('bug', 'could not walk to the door with the touch stick');
      await tapAt(document.getElementById('interactBtn'), 'Leave');
      t.scene('Level 8 ending: dawn, black, the title');
      // 3: white, black, the title.
      await t.until(() => probe.endSuite().phase === 'dawn', 8000, 'dawn');
      const whiteEl = document.getElementById('endWhite');
      await sleep(2800);
      t.event('check', `white-out opacity ${whiteEl?.style.opacity ?? '?'}`);
      await t.until(() => probe.endSuite().phase === 'black', 8000, 'the cut to black');
      await t.until(() => probe.endSuite().titleShown, 12000, 'the title');
      const title = document.getElementById('endTitle');
      fits(title, 'the PH ORIGINS title');
      t.event('title', `PH ORIGINS drops: "${title?.textContent ?? ''}"; music ${probe.ending() ?? 'tone chord fallback'}`);
      if (!/PH ORIGINS/.test(title?.textContent ?? '')) t.problem('bug', 'the title text is not PH ORIGINS');
      // 4: credits over places, names only.
      t.scene('Level 8 ending: credits');
      const until = performance.now() + 330000;
      while (probe.endSuite().phase !== 'call' && probe.endSuite().phase !== 'card' && performance.now() < until) {
        await tick();
        const n = document.getElementById('endNames');
        if (n?.classList.contains('on')) {
          const name = document.getElementById('endName')?.textContent ?? '';
          if (name && !sawNames.has(name)) { sawNames.add(name); fits(n, `credit "${name}"`); t.event('credit', `${name} (place ${probe.endSuite().places})`); }
        }
      }
      const st = probe.endSuite();
      t.event('check', `credits: ${st.places} places, ${st.shots} shots, names ${[...sawNames].join(', ')}`);
      if (st.places < 6) t.problem('bug', `the credits flew over ${st.places} places (need at least 6)`);
      const crawl = (document.getElementById('levelCredits')?.textContent ?? '').trim();
      if (crawl) t.problem('bug', `a story text crawl showed during the credits: ${crawl.slice(0, 80)}`);
      // 5: the call and the card.
      t.scene('Level 8 ending: the call and the Act II card');
      await t.until(() => probe.endSuite().callHeard, 30000, 'the unknown caller');
      fits(document.getElementById('endCall'), 'the call card');
      await t.until(() => probe.endSuite().cardShown, 40000, 'the Act II card');
      await sleep(1500);
      const link = document.getElementById('endCardLink') as HTMLAnchorElement | null;
      const exit = document.getElementById('endCardExit');
      fits(document.getElementById('endCardTitle'), 'the Act II title');
      if (fits(link, 'the end card link')) {
        const r = link!.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const tappable = !!link && (hit === link || link.contains(hit)) && r.width >= 44 && r.height >= 44 && /phorigins\.com/.test(link.href);
        t.event('check', `end card "${document.getElementById('endCardTitle')?.textContent}" link ${link!.href} ${Math.round(r.width)}x${Math.round(r.height)} tappable ${tappable}`);
        if (!tappable) t.problem('bug', 'the end card link is not tappable (hit test, size or address)');
      }
      fits(exit, 'the end card Exit');
      // 6: after a first finish the ending can be skipped.
      t.scene('Level 8 ending: skip after a first finish');
      await enter();
      probe.morningJump('door');
      await sleep(500);
      await touchWalk(tgt(), 'the door (second run)', () => probe.action() === 'Leave');
      await tapAt(document.getElementById('interactBtn'), 'Leave');
      await t.until(() => probe.endSuite().active && probe.endSuite().skipShown, 10000, 'Skip to show on the second run');
      const skipEl = document.getElementById('endSkip');
      fits(skipEl, 'Skip');
      const sr = skipEl?.getBoundingClientRect();
      if (sr && (sr.width < 44 || sr.height < 44)) t.problem('bug', `Skip is ${Math.round(sr.width)}x${Math.round(sr.height)} (needs 44)`);
      await tapAt(skipEl, 'Skip');
      await t.until(() => probe.endSuite().cardShown, 8000, 'the card after Skip');
      t.metric('endingSeconds', Math.round((performance.now() - t0) / 1000));
      t.metric('creditPlaces', st.places);
      if (phone) probe.phoneFrame(false);
      return 'won';
    };

    /** The Train through to its card, Continue into level 8, then The Morning. */
    const morningReleaseRun = async (): Promise<Outcome> => {
      levelsTotal = 2;
      levelIndex = 0;
      const train = await trainStoryRun(false);
      if (train !== 'won') return train;
      const card = probe.menu();
      if (card.title !== 'Level Complete' || card.start !== 'Continue') {
        t.problem('bug', `The Train's card did not offer Continue (title ${card.title}, start ${card.start ?? 'none'})`);
        return 'error';
      }
      const detail = [...document.querySelectorAll('#levelList .level-item')].map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
      if (!detail.some((line) => /level 8/i.test(line) && /morning/i.test(line))) t.problem('bug', `Load Level does not list level 8, The Morning: ${detail.join(' | ')}`);
      press(probe.startButton, 'Continue');
      await t.until(() => probe.running() && probe.level().libraryId === 'the-morning' && !probe.menu().open, 90000, 'Continue from The Train into level 8');
      t.event('continue', `The Train's Continue entered ${probe.level().name}`);
      levelIndex = 1;
      return morningRun(true);
    };

    /** The Station's card, Continue into level 7, then the train through to Exit only. */
    const releaseRun = async (): Promise<Outcome> => {
      levelsTotal = 2;
      levelIndex = 0;
      await enterLevel(6);
      const openUntil = performance.now() + 20000;
      while (!probe.scripted() && !(probe.running() && !probe.menu().open && !probe.cutscene()) && performance.now() < openUntil) await tick();
      if (probe.scripted()) {
        await sleep(1200);
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        await t.until(() => probe.running() && !probe.scripted() && !probe.menu().open, 15000, 'control after Skip on The Station');
      }
      const station = await playLevel(6);
      if (station !== 'won') return station;
      const card = probe.menu();
      t.event('station-card', `The Station complete: continue ${card.start ?? 'none'}`);
      if (card.title !== 'Level Complete' || card.start !== 'Continue') {
        t.problem('bug', `The Station's card did not offer Continue (title ${card.title}, start ${card.start ?? 'none'})`);
        return 'error';
      }
      const detail = probe.levelRows().length
        ? [...document.querySelectorAll('#levelList .level-item')].map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
        : [];
      t.event('load-level', detail.join(' | '));
      const row = detail.find((line) => /level 7/i.test(line) && /train/i.test(line));
      if (!row) t.problem('bug', `Load Level does not list level 7, The Train: ${detail.join(' | ')}`);
      else if (!/play/i.test(row)) t.problem('bug', `Load Level lists level 7 locked after The Station: ${row}`);
      press(probe.startButton, 'Continue');
      await t.until(() => probe.running() && probe.level().libraryId === 'the-train' && !probe.menu().open, 90000, 'Continue from The Station into level 7');
      t.event('continue', `The Station's Continue entered ${probe.level().name} (${probe.level().libraryId})`);
      if (probe.level().id !== 7) t.problem('bug', `Continue entered level ${probe.level().id}, not level 7`);
      levelIndex = 1;
      return trainStoryRun(true);
    };

    // ---- a feel replay: options.spot is a place the feel sensor flagged (falling through the floor, stuck, a camera
    // snap, a collision shove). Any scenario run with a spot plays a short probe there instead of the whole scenario,
    // so the recheck after a fix plays that exact place in seconds. The level comes from the scenario id (level-N,
    // smoke-lN) or options.at (a level number or library id), else level 1. Setup shortcuts (named): the level
    // started directly, Pierce stood at the spot. Real input: WASD each way, Shift to run, Space to jump.
    if (t.spot && probe.place) {
      const spot = t.spot;
      const fromId = Number(/^(?:level-|smoke-l)([1-8])$/.exec(id)?.[1] ?? 0);
      const at = t.at ?? '';
      const fromAt = Number(at) || LEVELS.find((l) => l.lib === at)?.n || 0;
      const n = fromId || fromAt || 1;
      levelsTotal = 1;
      await enterLevel(n);
      t.scene(probe.level().name);
      t.event('level-start', probe.level().name);
      const ready = performance.now() + 60000;
      while (!controllable() && performance.now() < ready) {
        if (probe.cutscene() && probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        await sleep(400);
      }
      if (!controllable()) {
        t.problem('bug', `spot replay: Pierce never became controllable on ${probe.level().name}`);
        return;
      }
      t.cut();
      probe.place(spot.x, spot.z, spot.yaw != null ? (spot.yaw * Math.PI) / 180 : probe.player().yaw);
      const p0 = probe.player();
      t.event('spot', `asked ${spot.x.toFixed(1)},${spot.y.toFixed(1)},${spot.z.toFixed(1)} on ${probe.level().name}; stood at ${p0.x.toFixed(1)},${p0.z.toFixed(1)}`);
      t.progress(0.2);
      await sleep(800);
      const legs = ['w', 'd', 's', 'a'];
      for (let i = 0; i < legs.length; i++) {
        setHeld(legs[i]);
        await sleep(1100);
        setHeld('');
        await sleep(250);
        t.progress(0.2 + (0.5 * (i + 1)) / legs.length);
      }
      sendKey('keydown', 'Shift');
      setHeld('w');
      await sleep(1200);
      setHeld('');
      sendKey('keyup', 'Shift');
      for (const k of ['w', 's']) {
        setHeld(k);
        await sleep(200);
        await tap(' ', 'jump');
        await sleep(900);
        setHeld('');
        await sleep(300);
      }
      const p1 = probe.player();
      t.metric('spotDrift', Math.round(Math.hypot(p1.x - spot.x, p1.z - spot.z) * 10) / 10);
      t.event('spot-probe', `ended at ${p1.x.toFixed(1)},${p1.y.toFixed(1)},${p1.z.toFixed(1)}`);
      t.progress(1);
      return;
    }

    // ---- scenarios
    if (id === 'analytics' && !window.hawkesAnalytics?.version) {
      t.problem('bug', 'Hawkes Analytics did not load on the game page (hawkesgen.ai/sdk/analytics@1.js)');
      return;
    }
    if (id === 'analytics' && !window.hawkesAnalytics.config().debug) {
      // The SDK reads its debug switch when the page loads: reload once with it, and carry the run on through the URL.
      const url = new URL(location.href);
      url.searchParams.set('hawkes-analytics-debug', '1');
      url.searchParams.set('playtest', 'analytics');
      url.searchParams.set('seed', String(options.seed ?? 1));
      url.searchParams.set('speed', String(options.speed ?? 1));
      t.event('reload', 'the page reloads with ?hawkes-analytics-debug=1; the run carries on after it');
      location.assign(url.toString());
      await new Promise(() => {}); // the page is going away
      return;
    }
    if (id === 'first-five') {
      await firstFiveRun();
      return;
    }
    // Every other scenario opens on the title: a first visit's cold open would otherwise take the tap.
    await probe.cancelColdOpen?.();
    // A player taps the splash at once; the tap never waits for the load. Scenarios that test the splash or lay the
    // page out themselves tap it in their own run.
    const ownsSplash = ['first-five', 'sound-settings', 'cutscene-ui', 'ui-style', 'load-error', 'screen-mode', 'stuck-recovery', 'objective-marker'];
    if (!ownsSplash.includes(id) && probe.sound().prompt) await tapToPlay();
    await t.until(() => probe.ready(), 90000, 'game ready');
    if (id === 'stuck-recovery') {
      await stuckRecoveryRun();
      return;
    }
    if (id === 'world-hud') {
      levelsTotal = 1;
      const touchy = () => document.body.dataset.device === 'mobile' || document.body.dataset.device === 'tablet';
      if (options.phone) { probe.phoneFrame(true); touchWalk = true; t.event('setup', 'phone layout 390x844 (touch)'); await sleep(700); }
      await enterLevel(1);
      await waitControl('control on level 1');
      if (probe.pain?.().healthBarShown) t.problem('bug', 'the health bar is displayed outside combat');
      else t.event('no-health-bar', 'health bar hidden on a story level');
      const hint = /\b(press|tap|click|hold)\b|\b(WASD|Tab|Shift)\b|\s[A-Z]\.|\([A-Z]\)/;
      const objText = probe.objective().text;
      if (hint.test(objText)) t.problem('bug', `objective text carries a control hint: "${objText}"`);
      else t.event('objective-clean', objText);
      // 1. A call: portrait, name, replies
      await t.until(() => probe.phone().incoming, 25000, 'Voss to ring');
      if (touchy()) await tapAt(document.getElementById('phoneAnswer'), 'Answer');
      else { releaseAll(); await once('f', 1500, 'answer call'); }
      await sleep(600);
      const img = document.getElementById('phonePortrait') as HTMLImageElement | null;
      const box = img?.getBoundingClientRect();
      const portraitOk = Boolean(img && !img.hidden && img.complete && img.naturalWidth > 0 && box && box.width >= 40);
      t.metric('portraitPx', Math.round(box?.width ?? 0));
      const nameText = document.getElementById('phoneContact')?.textContent ?? '';
      if (!portraitOk) t.problem('bug', 'the call shows no caller portrait');
      else t.event('portrait', `${nameText} portrait ${Math.round(box!.width)} px (${img!.getAttribute('src')})`);
      if (!nameText) t.problem('bug', 'the call shows no caller name');
      let minH = 9999;
      const untilReply = performance.now() + 40000;
      while (performance.now() < untilReply && !probe.replies?.().open) await sleep(150);
      const r = probe.replies?.();
      if (r?.open) {
        for (const o of r.options) { minH = Math.min(minH, o.rect?.h ?? 0); if ((o.rect?.h ?? 0) < 43.5) t.problem('bug', `reply "${o.text}" is ${Math.round(o.rect?.h ?? 0)} px tall`); }
        t.metric('replyBubbleMinHeight', Math.round(minH));
        t.event('replies', r.options.map((o) => o.text).join(' | '));
        if (touchy()) await tapAt(document.querySelector<HTMLElement>('#callReplies [data-reply="0"]'), 'reply 1');
        else await tap('1', 'reply 1');
      } else t.problem('bug', 'the call offered no reply choices');
      // 2. Pain
      probe.hurt?.(60);
      const painUntil = performance.now() + 4000;
      while (performance.now() < painUntil && !((probe.pain?.().vignette ?? 0) > 0.3 && (probe.pain?.().heartbeats ?? 0) > 0)) await sleep(100);
      const pain = probe.pain?.();
      t.metric('painVignette', Number((pain?.vignette ?? 0).toFixed(2)));
      t.metric('heartbeats', pain?.heartbeats ?? 0);
      if (!pain || pain.vignette <= 0.3) t.problem('bug', `the screen edges did not darken when hurt (vignette ${pain?.vignette ?? 0})`);
      if (!pain || pain.heartbeats < 1) t.problem('bug', 'no heartbeat played when hurt');
      if (pain?.healthBarShown) t.problem('bug', 'the health bar shows outside combat while hurt');
      if (pain && pain.vignette > 0.3 && pain.heartbeats > 0) t.event('pain', `vignette ${pain.vignette.toFixed(2)}, ${pain.heartbeats} heartbeats, no health bar`);
      if (probe.phone().busy) {
        if (touchy()) await tapAt(document.getElementById('phoneEnd'), 'End call');
        await t.until(() => !probe.phone().busy, 90000, 'the call to finish');
      }
      // 3. Use prompt over the coffee machine
      const coffee = { x: 50.6, z: 25.4 };
      let liveAt = 0;
      let shownAt = 0;
      const promptUntil = performance.now() + 100000;
      while (performance.now() < promptUntil) {
        await tick();
        if (!probe.running() || probe.menu().open || probe.cutscene()) continue;
        await walkTo(coffee, 'coffee', 1.0);
        const live = Boolean(probe.action());
        if (live && !liveAt) liveAt = performance.now();
        const up = probe.usePrompt?.();
        if (live && up?.shown && !shownAt) { shownAt = performance.now(); break; }
        if (!live) liveAt = 0;
      }
      releaseAll();
      const up = probe.usePrompt?.();
      if (!shownAt || !up) { t.problem('bug', 'no use prompt appeared over the object in reach'); }
      else {
        t.metric('usePromptMs', Math.round(shownAt - liveAt));
        t.event('use-prompt', `${up.text} (${up.on}) ${up.rect ? `${Math.round(up.rect.w)}x${Math.round(up.rect.h)}` : ''}`);
        const want = touchy() ? '☝' : 'E';
        if (!up.text.startsWith(want)) t.problem('bug', `use prompt shows "${up.text}", want the ${touchy() ? 'touch glyph' : 'E key'} first`);
        if (up.rect && (up.rect.h < 43.5 && touchy())) t.problem('bug', `use prompt is ${Math.round(up.rect.h)} px tall on touch`);
        if (up.rect && (up.rect.x < 0 || up.rect.y < 0 || up.rect.x + up.rect.w > innerWidth || up.rect.y + up.rect.h > innerHeight)) t.problem('bug', 'use prompt leaves the screen');
        if (shownAt - liveAt > 300) t.problem('bug', `use prompt took ${Math.round(shownAt - liveAt)} ms to show`);
      }
      t.finish('done');
      return;
    }
    if (id === 'call-replies') {
      levelsTotal = 1;
      const RUN_KEY = 'hawkes.callRepliesRun';
      const readStats = () => {
        const raw = document.cookie.split('; ').find((c) => c.startsWith('ph-origins-save='))?.slice('ph-origins-save='.length);
        try { const j = JSON.parse(decodeURIComponent(raw ?? '{}')); return { vossTrust: j.vossTrust as unknown, haleTemper: j.haleTemper as unknown }; } catch { return { vossTrust: undefined, haleTemper: undefined }; }
      };
      const okStat = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= -2 && v <= 2;
      let carried: { vossTrust: number; haleTemper: number } | null = null;
      try { carried = JSON.parse(sessionStorage.getItem(RUN_KEY) ?? 'null'); } catch { /* none */ }
      if (carried) {
        sessionStorage.removeItem(RUN_KEY);
        const now = readStats();
        t.event('stats-after-reload', JSON.stringify(now));
        if (!okStat(now.vossTrust) || !okStat(now.haleTemper)) t.problem('bug', `after the reload vossTrust/haleTemper are not within -2..+2 on the save cookie: ${JSON.stringify(now)}`);
        else if (now.vossTrust !== carried.vossTrust || now.haleTemper !== carried.haleTemper) t.problem('bug', `vossTrust/haleTemper changed over a reload: ${JSON.stringify(carried)} -> ${JSON.stringify(now)}`);
        else t.event('stats-persist', `vossTrust ${String(now.vossTrust)}, haleTemper ${String(now.haleTemper)} kept over the reload`);
        t.finish('done');
        return;
      }
      const touch = () => document.body.dataset.device === 'mobile' || document.body.dataset.device === 'tablet';
      if (options.phone) { probe.phoneFrame(true); t.event('setup', 'phone layout 390x844 (touch)'); await sleep(700); }
      await enterLevel(3);
      await sleep(1500);
      if (typeof options.trust === 'number') probe.callTest?.('none', { vossTrust: options.trust });
      const CONTROLS = ['interactBtn', 'fireBtn', 'jumpBtn', 'phoneBtn', 'leftStickZone', 'rightStickZone', 'pauseBtn', 'missionsHint', 'sidearmHint', 'abilityHint', 'shadowHint', 'lightHint', 'medkitHint', 'phoneHint', 'inventoryHint', 'reloadHint', 'lostHint'];
      const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
        a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
      let minHeight = 9999;
      let moments = 0;
      let cutOffs = 0;
      let silences = 0;
      const answer = async (callId: string, seed?: { vossTrust?: number; haleTemper?: number }) => {
        probe.callTest?.(callId, seed);
        await t.until(() => probe.phone().incoming, 6000, `${callId} to ring`);
        if (touch()) await tapAt(document.getElementById('phoneAnswer'), `Answer ${callId}`);
        else { releaseAll(); await once('f', 1500, 'answer call'); }
        t.event('call', `${callId} answered`);
      };
      const hangUp = async () => {
        if (probe.phone().busy) await tapAt(document.getElementById('phoneEnd'), 'End call');
        await t.until(() => !probe.phone().busy, 12000, 'the call to finish');
      };
      /** Plays one call to its end, answering every reply moment the way `mode` says. */
      const playCall = async (callId: string, mode: 'cut' | 'silence') => {
        await answer(callId);
        const lines: string[] = [];
        const base = probe.replies?.().log.length ?? 0;
        let handled = base;
        let chosenText = '';
        const until = performance.now() + 70000;
        while (probe.phone().busy && performance.now() < until) {
          const line = probe.phone().line;
          if (line && lines[lines.length - 1] !== line) lines.push(line);
          const r = probe.replies?.();
          if (r?.open && r.log.length === handled) {
            const caption = r.caption;
            moments += 1;
            if (r.options.length < 2 || r.options.length > 3) t.problem('bug', `${callId}: ${r.options.length} reply bubbles (want 2-3)`);
            const controls = touch() ? CONTROLS.map((cid) => document.getElementById(cid)).filter((el): el is HTMLElement => !!el && !el.hidden && getComputedStyle(el).display !== 'none').map((el) => { const b = el.getBoundingClientRect(); return { id: el.id, x: b.left, y: b.top, w: b.width, h: b.height }; }).filter((b) => b.w > 0) : [];
            for (const o of r.options) {
              if (!o.rect) { t.problem('bug', `${callId}: bubble "${o.text}" has no box`); continue; }
              minHeight = Math.min(minHeight, o.rect.h);
              if (o.rect.h < 43.5) t.problem('bug', `${callId}: reply bubble "${o.text}" is ${Math.round(o.rect.h)} px tall, under 44`);
              if (o.rect.x < 0 || o.rect.y < 0 || o.rect.x + o.rect.w > innerWidth || o.rect.y + o.rect.h > innerHeight) t.problem('bug', `${callId}: reply bubble "${o.text}" leaves the screen`);
              if (caption && hit(o.rect, caption)) t.problem('bug', `${callId}: reply bubble "${o.text}" overlaps the call caption`);
              for (const c of controls) if (hit(o.rect, c)) t.problem('bug', `${callId}: reply bubble "${o.text}" overlaps #${c.id}`);
            }
            const bar = document.querySelector<HTMLElement>('#callReplies .cr-timer');
            if (!bar || bar.getBoundingClientRect().width < 1) t.problem('bug', `${callId}: no visible countdown bar while the answer window is open`);
            t.event('replies-open', `${callId}: ${r.options.map((o) => `${o.key} ${o.text}`).join(' | ')} (${r.total}s)`);
            if (mode === 'cut') {
              await sleep(700);
              const before = probe.replies?.();
              if (!before?.open) { t.problem('bug', `${callId}: the reply window closed inside 0.7 s`); handled = (before?.log.length ?? handled) ; continue; }
              chosenText = before.options[0].text;
              if (touch()) await tapAt(document.querySelector<HTMLElement>('#callReplies [data-reply="0"]'), `reply 1 (${chosenText})`);
              else await tap('1', `reply 1 (${chosenText})`);
            } else {
              await t.until(() => (probe.replies?.().log.length ?? 0) > handled, 40000, `${callId} silence answer`);
            }
            const log = probe.replies?.().log ?? [];
            const last = log[log.length - 1];
            if (!last || log.length <= handled) { t.problem('bug', `${callId}: nothing was logged for the reply moment`); handled = log.length; continue; }
            handled = log.length;
            t.event('reply', `${callId} ${last.moment}: ${last.choice}${last.cutOff ? ' (cut the caller off)' : ''}, ${last.stat} ${last.delta >= 0 ? '+' : ''}${last.delta} -> ${last.value}`);
            if (mode === 'cut') {
              cutOffs += last.cutOff ? 1 : 0;
              if (!last.cutOff) t.problem('bug', `${callId}: choosing a reply 0.7 s in did not cut the caller off`);
            } else {
              silences += last.choice === 'silence' ? 1 : 0;
              if (last.choice !== 'silence' || last.cutOff) t.problem('bug', `${callId}: waiting out the window did not play the silence answer (${last.choice}, cutOff ${String(last.cutOff)})`);
            }
          }
          await sleep(100);
        }
        const done = probe.phone().busy;
        if (done) t.problem('bug', `${callId} was still going after 70 s`);
        if (handled <= base) t.problem('bug', `${callId} showed no reply moment`);
        if (mode === 'cut' && chosenText && !lines.some((l) => l.includes(chosenText))) t.problem('bug', `${callId}: the chosen reply "${chosenText}" was never spoken (captions: ${lines.join(' / ')})`);
        t.event('call-lines', `${callId} (${mode}): ${lines.join(' / ')}`);
        await t.until(() => !probe.phone().busy, 15000, `${callId} to end`);
        await sleep(400);
      };
      t.scene('Reply moments: choose to cut the caller off');
      const CALLS = ['voss-late', 'voss-meeting', 'hale-walkout', 'hale-board', 'hale-train', 'voss-morning'];
      for (const [i, callId] of CALLS.entries()) {
        await playCall(callId, 'cut');
        t.progress(0.05 + (i + 1) * 0.08);
      }
      t.scene('Reply moments: say nothing');
      await playCall('voss-late', 'silence');
      await playCall('hale-walkout', 'silence');
      t.progress(0.7);
      t.scene('voss-morning branches on vossTrust');
      const firsts: string[] = [];
      for (const trust of [-2, 2]) {
        await answer('voss-morning', { vossTrust: trust });
        await t.until(() => probe.phone().line.length > 0, 4000, 'the first Voss line');
        const first = probe.phone().line;
        firsts.push(first);
        t.event('morning-first-line', `vossTrust ${trust}: ${first}`);
        await hangUp();
        await sleep(300);
      }
      if (firsts[0] === firsts[1]) t.problem('bug', `voss-morning opens with the same line at vossTrust -2 and +2: "${firsts[0]}"`);
      // Every window: at least max(8 s, 6 s + 0.35 s per option word), clock from the voice's end, never closed at or before it.
      const wins = probe.replies?.().windows ?? [];
      let minAfterVoice = 9999;
      for (const w of wins) {
        const need = Math.max(8, 6 + 0.35 * w.words);
        if (w.window < need - 0.01) t.problem('bug', `${w.call}/${w.moment}: window ${w.window.toFixed(1)} s is under ${need.toFixed(1)} s for ${w.words} words`);
        t.event('reply-window', `${w.call}/${w.moment}: ${w.words} words, window ${w.window.toFixed(1)} s, ${w.how}`);
        if (w.how === 'timeout') {
          const open = (w.closedAt - w.voiceEndAt) / 1000;
          minAfterVoice = Math.min(minAfterVoice, open);
          if (!w.voiceEndAt || w.closedAt <= w.voiceEndAt) t.problem('bug', `${w.call}/${w.moment}: the window closed at or before the voice ended`);
          else if (open < need - 0.5) t.problem('bug', `${w.call}/${w.moment}: the buttons stayed ${open.toFixed(1)} s after the voice ended, under ${need.toFixed(1)} s`);
        }
      }
      t.metric('replyWindowMinAfterVoice', Math.round((minAfterVoice === 9999 ? 0 : minAfterVoice) * 10) / 10);
      t.metric('replyMoments', moments);
      t.metric('replyCutOffs', cutOffs);
      t.metric('replySilences', silences);
      t.metric('replyBubbleMinHeight', Math.round(minHeight === 9999 ? 0 : minHeight));
      const stats = readStats();
      t.event('stats', JSON.stringify(stats));
      if (!okStat(stats.vossTrust) || !okStat(stats.haleTemper)) t.problem('bug', `vossTrust/haleTemper are not within -2..+2 on the save cookie: ${JSON.stringify(stats)}`);
      sessionStorage.setItem(RUN_KEY, JSON.stringify(stats));
      t.event('reload', 'the page reloads; the run carries on after it');
      const url = new URL(location.href);
      url.searchParams.set('playtest', 'call-replies');
      url.searchParams.set('seed', String(options.seed ?? 1));
      url.searchParams.set('speed', String(options.speed ?? 1));
      await sleep(300);
      location.replace(url.toString());
      await new Promise(() => {});
      return;
    }
    if (id === 'sound-settings') {
      await soundSettingsRun(t, tapAt, tapToPlay, sleep, enterLevel, options);
      return;
    }
    if (id === 'cutscene-ui') {
      await cutsceneUiRun();
      return;
    }
    if (id === 'title-scene') {
      await titleSceneRun();
      return;
    }
    if (id === 'screen-mode') {
      await screenModeRun();
      return;
    }
    if (id === 'objective-marker') {
      await objectiveMarkerRun();
      return;
    }
    if (id === 'ui-style') {
      await uiStyleRun(t, tapAt, tapToPlay, sleep, enterLevel);
      return;
    }
    if (id === 'load-error') {
      await loadErrorRun(t, tapAt, tapToPlay, sleep, options);
      return;
    }
    if (probe.sound().prompt) await tapToPlay();
    t.scene('Title');
    t.event('title', probe.menu().title);
    await sleep(600);

    if (id === 'board-faces') {
      levelsTotal = 1;
      const phone = Boolean(options.phone);
      if (phone) {
        probe.phoneFrame(true, true, { w: 390, h: 844 });
        touchWalk = true;
        t.event('setup', 'phone layout 390x844 (touch)');
        await sleep(500);
      }
      t.scene('Level 1 board faces');
      await enterLevel(1);
      await waitControl('control on level 1');
      probe.resetFaces?.();
      t.event('play', 'walk to Join meeting');
      const until = performance.now() + 90000;
      let sceneSeen = 0;
      while (performance.now() < until) {
        await tick();
        if (probe.cutscene()?.id === 'room-for-grace' || (probe.cutscene() && !sceneSeen)) {
          if (!sceneSeen) {
            sceneSeen = performance.now();
            t.event('cutscene-start', probe.cutscene()?.id || 'board');
            probe.resetFaces?.();
          }
          // Sample faces through the meeting; do not Skip until criteria are visible.
          const face = probe.faces?.();
          if (face) {
            if (face.mouthEvents > 0) t.event('face-mouth', `mouthEvents ${face.mouthEvents}; speaker ${face.speaker ?? '—'}`);
            if (face.blinks > 0) t.event('face-blink', `blinks ${face.blinks}`);
            if (face.lookTurns > 0) t.event('face-look', `lookTurns ${face.lookTurns}`);
            if (face.gestures.length) t.event('face-gesture', face.gestures.join(','));
            t.metric('faceMouthEvents', face.mouthEvents);
            t.metric('faceBlinks', face.blinks);
            t.metric('faceGestures', face.gestures.length);
            t.metric('faceLookTurns', face.lookTurns);
            t.metric('faceUpdateMs', face.updateMs);
            const elapsed = (performance.now() - sceneSeen) / 1000;
            const mouthOk = face.speakers.some((s) => s.speaking && s.mouth > 0.08) || face.mouthEvents > 0;
            const blinkOk = face.speakers.every((s) => s.blinks >= 1) || (elapsed >= 6 && face.blinks >= face.speakers.length);
            const lookOk = face.lookTurns >= 1 || face.speakers.some((s) => Math.abs(s.lookYaw) > 0.05);
            const gestOk = face.gestures.length >= 3;
            if (mouthOk && blinkOk && lookOk && gestOk && elapsed >= 6) {
              t.progress(0.9);
              break;
            }
            // After ~45 s of the meeting, accept what we have and Skip.
            if (elapsed > 45) break;
          }
          continue;
        }
        if (!probe.running() || probe.menu().open) continue;
        const ph = probe.phone();
        if (ph.incoming) {
          releaseAll();
          if (phone) {
            const ans = document.getElementById('answerBtn');
            if (ans) await tapAt(ans, 'Answer');
            else await once('f', 1500, 'answer call');
          } else await once('f', 1500, 'answer call');
          t.event('call', ph.speaker || 'incoming');
          continue;
        }
        if (ph.busy) { releaseAll(); continue; }
        const label = probe.action();
        if (label) {
          releaseAll();
          if (phone) {
            const use = document.getElementById('interactBtn');
            if (use && !use.hidden) await tapAt(use, label);
            else if (await once('e', 1500, label)) t.event('action', label);
          } else if (await once('e', 1500, label)) t.event('action', label);
          continue;
        }
        const goal = probe.objective().target;
        if (goal) await walkTo(goal, 'seat');
      }
      releaseAll();
      const face = probe.faces?.();
      if (!sceneSeen) t.problem('bug', 'board-faces: the board scene did not start');
      if (!face) t.problem('bug', 'board-faces: faces() probe missing');
      else {
        t.metric('faceMouthEvents', face.mouthEvents);
        t.metric('faceBlinks', face.blinks);
        t.metric('faceGestures', face.gestures.length);
        t.metric('faceLookTurns', face.lookTurns);
        t.metric('faceUpdateMs', face.updateMs);
        t.event('faces', JSON.stringify({
          speaker: face.speaker,
          gestures: face.gestures,
          blinks: face.blinks,
          mouthEvents: face.mouthEvents,
          lookTurns: face.lookTurns,
          updateMs: face.updateMs,
          speakers: face.speakers.map((s) => ({ id: s.id, mouth: s.mouth, blinks: s.blinks, lookYaw: s.lookYaw, gestures: s.gestures })),
        }));
        if (face.mouthEvents < 1 && !face.speakers.some((s) => s.mouth > 0.08)) {
          t.problem('bug', 'board-faces: no speaking mouth opened during the meeting');
        }
        if (face.blinks < 1) t.problem('bug', 'board-faces: no blinks recorded during the meeting');
        if (face.gestures.length < 3) {
          t.problem('bug', `board-faces: only ${face.gestures.length} gesture(s) played (need 3+)`);
        }
        if (face.lookTurns < 1 && !face.speakers.some((s) => Math.abs(s.lookYaw) > 0.05)) {
          t.problem('bug', 'board-faces: no head look-at toward a speaker');
        }
        if (phone && face.updateMs > 2.05) {
          t.problem('bug', `board-faces: face update cost ${face.updateMs} ms on phone (limit 2)`);
        }
      }
      const skip = probe.skipButton;
      if (skip && !skip.disabled && skip.offsetParent) press(skip, 'Skip');
      await sleep(800);
      if (phone) probe.phoneFrame(false);
      t.progress(1);
      const lookOk = !!face && (face.lookTurns >= 1 || face.speakers.some((s) => Math.abs(s.lookYaw) > 0.05));
      const ok = !!sceneSeen && !!face && face.gestures.length >= 3 && face.blinks >= 1
        && (face.mouthEvents >= 1 || face.speakers.some((s) => s.mouth > 0.08))
        && lookOk
        && (!phone || face.updateMs <= 2.05);
      t.finish(ok ? 'won' : 'lost');
      return;
    }

    if (id === 'hitch-board') {
      levelsTotal = 4; // L1 desktop board walk + phone L1/4/8
      let warmMs = 0;
      const onWarm = (type: string, detail?: unknown) => {
        if (type !== 'warm') return;
        try {
          const stats = typeof detail === 'string' ? JSON.parse(detail) : detail;
          warmMs = Number((stats as { ms?: number })?.ms) || 0;
          t.metric('chapterWarmMs', warmMs);
        } catch { /* ignore */ }
      };
      const prevEmit = (window as unknown as { __phEmit?: (type: string, detail?: unknown) => void }).__phEmit;
      (window as unknown as { __phEmit?: (type: string, detail?: unknown) => void }).__phEmit = (type, detail) => {
        onWarm(type, detail);
        prevEmit?.(type, detail);
      };

      t.scene('L1 desktop');
      await enterLevel(1);
      // Grace and hitchFailOver100 start when Pierce can walk — not during the chapter card / warm.
      // (A reset before enterLevel let the 1 s grace expire under the card, so the first play frames failed.)
      frameTrace.reset();
      // Chapter card + warm already finished inside enterLevel / Start.
      if (warmMs > 6100) t.problem('bug', `chapter warm held Start for ${warmMs} ms (cap ~4600+1500)`);
      t.event('play', 'spawn to board');

      const until = performance.now() + 70000;
      let sceneSeen = 0;
      while (performance.now() < until) {
        await tick();
        if (probe.cutscene()) {
          if (!sceneSeen) {
            sceneSeen = performance.now();
            t.event('cutscene-start', probe.cutscene() || 'board');
          }
          if (performance.now() - sceneSeen > 4000) {
            const skip = probe.skipButton;
            if (skip && !skip.disabled && skip.offsetParent) press(skip, 'Skip');
            await sleep(600);
            break;
          }
          continue;
        }
        if (!probe.running() || probe.menu().open) continue;
        const phone = probe.phone();
        if (phone.incoming) { releaseAll(); await once('f', 1500, 'answer call'); t.event('call', phone.speaker || 'incoming'); continue; }
        if (phone.busy) { releaseAll(); continue; }
        const label = probe.action();
        if (label) { releaseAll(); if (await once('e', 1500, label)) t.event('action', label); continue; }
        const goal = probe.objective().target;
        if (goal) await walkTo(goal, 'seat');
      }
      releaseAll();
      if (!sceneSeen) t.problem('bug', 'hitch-board: the board scene did not start');

      const deskSnap = frameTrace.summary();
      t.metric('hitchOver50', deskSnap.over50);
      t.metric('hitchOver100', deskSnap.over100);
      t.metric('hitchFailOver100', deskSnap.failOver100);
      t.metric('hitchWorstMs', deskSnap.worst[0]?.ms ?? 0);
      for (const h of deskSnap.worst.slice(0, 5)) {
        t.event('hitch', `${h.ms}ms ${h.cause} L${h.level} ${h.objective || '—'}${h.detail ? ` (${h.detail})` : ''}`);
      }
      t.event('frame-trace', `L1 board: ${deskSnap.over50} over 50 ms, ${deskSnap.over100} over 100 ms, fail ${deskSnap.failOver100}`);
      if (deskSnap.failOver100 > 0) {
        const sample = deskSnap.worst.find((h) => h.ms >= 100 && h.t >= 1) ?? deskSnap.worst[0];
        t.problem(
          'bug',
          `hitch-board L1: ${deskSnap.failOver100} frame(s) over 100 ms after the first second`
            + (sample ? ` (worst ${sample.ms} ms, ${sample.cause})` : ''),
        );
      }
      t.progress(0.4);

      probe.phoneFrame(true, true, { w: 390, h: 844 });
      t.event('phoneFrame', '390x844');
      let phoneFail = 0;
      for (const n of [1, 4, 8]) {
        levelIndex = n;
        t.scene(`L${n} phone`);
        t.event('setup', `hitch-board phone level ${n}`);
        await enterLevel(n);
        // Grace after control, not under the chapter card.
        frameTrace.reset();
        await sleep(1200);
        const walkUntil = performance.now() + 4500;
        while (performance.now() < walkUntil) {
          if (probe.running() && !probe.menu().open && !probe.cutscene() && !probe.scripted()) setHeld('w');
          else {
            releaseAll();
            if (probe.cutscene() || probe.scripted()) {
              const skip = probe.skipButton;
              if (skip && !skip.disabled && skip.offsetParent) press(skip, 'Skip');
            }
          }
          await tick();
        }
        releaseAll();
        const snap = frameTrace.summary();
        const worst = snap.worst[0];
        t.metric(`hitchL${n}PhoneWorstMs`, worst?.ms ?? 0);
        t.metric(`hitchL${n}PhoneOver50`, snap.over50);
        if (worst) t.event('hitch-level', `L${n} phone: worst ${worst.ms}ms ${worst.cause}`);
        else t.event('hitch-level', `L${n} phone: no hitch over 50 ms`);
        // Phone acceptance: no hitch over 150 ms after grace.
        const over150 = snap.worst.filter((h) => h.ms >= 150 && h.t >= 1).length;
        if (over150 > 0) {
          phoneFail += over150;
          t.problem('bug', `hitch-board L${n} phone: ${over150} hitch(es) over 150 ms (worst ${worst?.ms ?? 0} ms, ${worst?.cause ?? '—'})`);
        }
        mark();
      }
      probe.phoneFrame(false);
      t.metric('hitchPhoneOver150', phoneFail);
      t.progress(1);
      (window as unknown as { __phEmit?: (type: string, detail?: unknown) => void }).__phEmit = prevEmit;
      t.finish(deskSnap.failOver100 === 0 && phoneFail === 0 && sceneSeen ? 'won' : 'lost');
      return;
    }

    // Patch-era baselines from docs/camera.md — inside/blocked must drop ≥90%.
    const CAM_BASELINE: { inside: number; blocked: number }[] = [
      { inside: 120, blocked: 280 },
      { inside: 100, blocked: 240 },
      { inside: 110, blocked: 260 },
      { inside: 100, blocked: 240 },
      { inside: 40, blocked: 60 },
      { inside: 80, blocked: 180 },
      { inside: 60, blocked: 120 },
      { inside: 50, blocked: 100 },
    ];

    const exploreN = Number(/^explore-cam-l([1-8])$/.exec(id)?.[1] ?? 0);
    if (exploreN > 0) {
      levelsTotal = 1;
      const feel = probe.feel;
      const camPhone = Boolean(options.phone);
      if (camPhone) { probe.phoneFrame(true); await sleep(600); }
      let fadedPeak = 0;
      let hallwayFrames = 0;
      const cw = installCameraWatch({
        scene: () => probe.scene,
        player: () => (feel ? feel.collider.getAbsolutePosition().clone() as never : null),
        isSolid: (m) => (feel ? feel.isSolid(m) : true),
        active: () => {
          if (!(probe.running() && !probe.menu().open && !probe.cutscene() && !probe.scripted())) return false;
          const cam = probe.camera?.();
          if (cam) {
            fadedPeak = Math.max(fadedPeak, cam.faded);
            if (cam.profile === 'hallway' || cam.profile === 'doorway') hallwayFrames += 1;
          }
          return true;
        },
        label: () => `L${exploreN}`,
        emit: (type, detail) => t.event(type, detail),
      });
      try {
        t.scene(`explore-cam L${exploreN}`);
        if (exploreN === 7) await probe.setupHidden('the-train');
        else await enterLevel(exploreN);
        for (let i = 0; i < 400 && (probe.cutscene() || probe.scripted() || probe.menu().open); i += 1) {
          const skip = probe.skipButton;
          if (skip && !skip.disabled && skip.offsetParent) press(skip, 'Skip');
          await tick();
        }
        await measureLook();
        await sleep(1200);
        cw.start();
        const grid = buildGrid(probe.scene, probe.level().libraryId);
        const start = probe.player();
        type Stop = { p: Point; kind: 'hug' | 'door' | 'corner' };
        const stops: Stop[] = [];
        if (grid) {
          const blockedAt = (c: number, r: number) => !isOpen(grid, c, r);
          const ring = (c: number, r: number, n: number) => {
            let k = 0;
            for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) if ((dc || dr) && blockedAt(c + dc * n, r + dr * n)) k++;
            return k;
          };
          const cand: Stop[] = [];
          for (let r = 0; r < grid.rows; r += 4) for (let c = 0; c < grid.cols; c += 4) {
            if (!isOpen(grid, c, r) || !isOpen(grid, c, r)) continue;
            const walls = ring(c, r, 2);
            const p = worldOf(grid, c, r);
            if (walls >= 5) cand.push({ p, kind: 'corner' });
            else if (walls >= 2 && !blockedAt(c + 4, r) !== !blockedAt(c - 4, r)) cand.push({ p, kind: 'door' });
            else if (walls >= 1) cand.push({ p, kind: 'hug' });
          }
          let here = start;
          for (const k of ['corner', 'door', 'hug'] as const) {
            for (const c of cand.filter((x) => x.kind === k)) {
              if (stops.length >= 24) break;
              if (dist(c.p, here) < 5 || stops.some((s) => dist(s.p, c.p) < 6)) continue;
              if (!findPath(grid, here, c.p)) continue;
              stops.push(c);
            }
          }
          stops.sort((a, b) => dist(a.p, start) - dist(b.p, start));
        }
        t.event('explore-plan', `${stops.length} stops on L${exploreN}`);
        let done = 0;
        for (const s of stops) {
          const t1 = performance.now();
          let arrived = false;
          while (performance.now() - t1 < 25000 && !(arrived = await walkTo(s.p, `cam-${done}`, 0.7))) {
            if (probe.cutscene() || probe.scripted()) break;
            await tick();
          }
          releaseAll();
          if (!arrived) continue;
          done += 1;
          if (s.kind === 'door' || s.kind === 'hug') {
            for (let i = 0; i < 8; i += 1) { dragLook(14); await tick(); }
            for (let i = 0; i < 8; i += 1) { dragLook(-14); await tick(); }
          }
          if (s.kind === 'corner') {
            setHeld('s');
            const u = performance.now() + 1500;
            while (performance.now() < u) await tick();
            releaseAll();
            for (let i = 0; i < 10; i += 1) { dragLook(14); await tick(); }
          }
          t.progress(Math.min(0.95, done / Math.max(1, stops.length)));
        }
        t.metric('cameraStops', done);
        t.metric('cameraStopsPlanned', stops.length);
      } catch (e) {
        t.event('explore-error', String(e));
      }
      releaseAll();
      cw.stop();
      const sum = cw.summary();
      lastCam = sum;
      t.metric('cameraFrames', sum.frames);
      t.metric('cameraInside', sum.inside);
      t.metric('cameraNear', sum.near);
      t.metric('cameraBlocked', sum.blocked);
      t.metric('cameraBehindWall', sum.behindWall);
      t.metric('cameraNearWall', sum.nearWall);
      t.metric('cameraSnaps', sum.snaps);
      t.metric('cameraJitter', sum.jitter);
      t.metric('cameraMaxCoverage', Math.round(sum.maxCoverage * 100) / 100);
      t.metric('cameraFadedPeak', fadedPeak);
      t.metric('cameraHallwayFrames', hallwayFrames);
      if (camPhone) probe.phoneFrame(false);
      if (sum.behindWall > 0) t.problem('bug', `camera inside or behind a wall/door on ${LEVEL_NAMES[exploreN - 1]}: ${sum.behindWall} frames`);
      t.event('camera-summary', JSON.stringify({ ...sum, worst: sum.worst.map((w) => ({ ...w, shot: undefined })), fadedPeak, hallwayFrames }));
      sum.worst.forEach((w, i) => { if (w.shot) t.event('camera-screenshot', JSON.stringify({ rank: i + 1, kind: w.kind, detail: w.detail, image: w.shot })); });
      if (sum.inside > 0) t.problem('bug', `camera inside geometry on ${LEVEL_NAMES[exploreN - 1]}: ${sum.inside} frames`);
      const base = CAM_BASELINE[exploreN - 1]!;
      const insideCap = Math.max(1, Math.ceil(base.inside * 0.1));
      const blockedCap = Math.max(1, Math.ceil(base.blocked * 0.1));
      if (sum.inside > insideCap) {
        t.problem('bug', `cameraInside ${sum.inside} on L${exploreN} exceeds 10% of baseline ${base.inside} (cap ${insideCap})`);
      }
      if (sum.blocked > blockedCap) {
        t.problem('bug', `cameraBlocked ${sum.blocked} on L${exploreN} exceeds 10% of baseline ${base.blocked} (cap ${blockedCap})`);
      }
      t.progress(1);
      t.finish(sum.inside <= insideCap && sum.blocked <= blockedCap && sum.behindWall === 0 ? 'done' : 'lost');
      return;
    }

    if (id === 'interior-cam') {
      levelsTotal = 2;
      const feel = probe.feel;
      type Pass = { label: string; level: number; phone: boolean };
      const passes: Pass[] = [
        { label: 'L1-desktop', level: 1, phone: false },
        { label: 'L8-desktop', level: 8, phone: false },
        { label: 'L1-844x390', level: 1, phone: true },
        { label: 'L8-844x390', level: 8, phone: true },
      ];
      let passOk = 0;
      let hallSeen = 0;
      let openSeen = 0;
      let fadeSeen = 0;
      let totalInside = 0;
      let totalBlocked = 0;
      for (let pi = 0; pi < passes.length; pi += 1) {
        const pass = passes[pi]!;
        if (pass.phone) probe.phoneFrame(true, true, { w: 844, h: 390 });
        else probe.phoneFrame(false);
        t.scene(`interior-cam ${pass.label}`);
        let fadedPeak = 0;
        let hallwayFrames = 0;
        let openFrames = 0;
        const cw = installCameraWatch({
          scene: () => probe.scene,
          player: () => (feel ? feel.collider.getAbsolutePosition().clone() as never : null),
          isSolid: (m) => (feel ? feel.isSolid(m) : true),
          active: () => {
            if (!(probe.running() && !probe.menu().open && !probe.cutscene() && !probe.scripted())) return false;
            const cam = probe.camera?.();
            if (cam) {
              fadedPeak = Math.max(fadedPeak, cam.faded);
              if (cam.profile === 'hallway' || cam.profile === 'doorway') hallwayFrames += 1;
              if (cam.profile === 'open') openFrames += 1;
            }
            return true;
          },
          label: () => pass.label,
          emit: (type, detail) => t.event(type, detail),
        });
        try {
          await enterLevel(pass.level);
          for (let i = 0; i < 400 && (probe.cutscene() || probe.scripted() || probe.menu().open); i += 1) {
            const skip = probe.skipButton;
            if (skip && !skip.disabled && skip.offsetParent) press(skip, 'Skip');
            await tick();
          }
          await measureLook();
          await sleep(800);
          cw.start();
          const goals: Point[] = pass.level === 1
            ? [
              { x: 0, z: 12 },
              { x: 0, z: 28 },
              { x: 8, z: 32 },
              { x: 18, z: 32 },
              { x: 30, z: 32 },
            ]
            : [
              { x: 2, z: 0 },
              { x: 4, z: -1.5 },
              { x: 6, z: 1.2 },
              { x: 4, z: 0 },
            ];
          let arrivedN = 0;
          for (const g of goals) {
            const t1 = performance.now();
            let ok = false;
            while (performance.now() - t1 < 20000 && !(ok = await walkTo(g, `ic-${pass.label}-${arrivedN}`, 0.85))) {
              if (probe.cutscene() || probe.scripted()) break;
              await tick();
            }
            releaseAll();
            if (ok) {
              arrivedN += 1;
              for (let i = 0; i < 6; i += 1) { dragLook(12); await tick(); }
              for (let i = 0; i < 6; i += 1) { dragLook(-12); await tick(); }
              // Hug the wall briefly so door frames can sit between lens and Pierce (fade check).
              setHeld('d');
              const u = performance.now() + 900;
              while (performance.now() < u) await tick();
              releaseAll();
            }
          }
          t.event('interior-pass', JSON.stringify({
            label: pass.label, arrived: arrivedN, fadedPeak, hallwayFrames, openFrames,
            profile: probe.camera?.()?.profile ?? null, volumes: probe.camera?.()?.volumes ?? 0,
          }));
        } catch (e) {
          t.event('interior-error', `${pass.label}: ${String(e)}`);
        }
        releaseAll();
        cw.stop();
        const sum = cw.summary();
        lastCam = sum;
        totalInside += sum.inside;
        totalBlocked += sum.blocked;
        hallSeen += hallwayFrames;
        openSeen += openFrames;
        fadeSeen = Math.max(fadeSeen, fadedPeak);
        const base = CAM_BASELINE[pass.level - 1]!;
        const insideCap = Math.max(1, Math.ceil(base.inside * 0.1));
        const blockedCap = Math.max(1, Math.ceil(base.blocked * 0.1));
        if (sum.inside > insideCap) {
          t.problem('bug', `${pass.label}: cameraInside ${sum.inside} > 10% of baseline ${base.inside}`);
        }
        if (sum.blocked > blockedCap) {
          t.problem('bug', `${pass.label}: cameraBlocked ${sum.blocked} > 10% of baseline ${base.blocked}`);
        }
        if (pass.level === 1 && hallwayFrames < 5) {
          t.problem('bug', `${pass.label}: hallway/doorway profile never held (frames ${hallwayFrames}) — volumes missing or not blending`);
        }
        if (pass.level === 1 && fadedPeak < 1) {
          // Door GLBs / props between lens and Pierce must fade; a zero peak means fade never armed.
          t.problem('bug', `${pass.label}: no occluder faded while wall-hugging (peak ${fadedPeak})`);
        }
        if (pass.level === 8 && openFrames < 5) {
          t.problem('bug', `${pass.label}: open profile never held in the apartment (frames ${openFrames})`);
        }
        const fadeOk = pass.level !== 1 || fadedPeak >= 1;
        if (sum.inside <= insideCap && sum.blocked <= blockedCap && (pass.level !== 1 || hallwayFrames >= 5) && fadeOk) passOk += 1;
        t.metric(`cameraInside_${pass.label}`, sum.inside);
        t.metric(`cameraBlocked_${pass.label}`, sum.blocked);
        t.metric(`cameraFadedPeak_${pass.label}`, fadedPeak);
        t.progress((pi + 1) / passes.length);
      }
      probe.phoneFrame(false);
      t.metric('cameraInside', totalInside);
      t.metric('cameraBlocked', totalBlocked);
      t.metric('cameraFadedPeak', fadeSeen);
      t.metric('cameraHallwayFrames', hallSeen);
      t.metric('cameraProfileHall', hallSeen);
      t.metric('cameraProfileOpen', openSeen);
      t.metric('interiorPassesOk', passOk);
      t.progress(1);
      t.finish(passOk >= 3 ? 'done' : 'lost');
      return;
    }

    if (id === 'graphics') {
      // The tier picks are saved in hawkes.settings; put the bot profile's own choice back so later runs (and the
      // phone runs, which rely on the device picking Low) are not left on what this run chose.
      const saved = localStorage.getItem('hawkes.settings');
      try {
        await graphicsRun(Boolean(options.phone));
      } finally {
        try {
          if (saved === null) localStorage.removeItem('hawkes.settings');
          else localStorage.setItem('hawkes.settings', saved);
        } catch { /* storage blocked */ }
      }
      return;
    }

    if (id === 'frame-trace') {
      levelsTotal = 16; // 8 levels × desktop + phone
      const sampleLevel = async (n: number, device: 'desktop' | 'phone') => {
        levelIndex = (device === 'phone' ? 8 : 0) + (n - 1);
        t.scene(`L${n} ${device}`);
        t.event('setup', `frame-trace level ${n} on ${device}`);
        if (n === 7) await probe.setupHidden('the-train');
        else await enterLevel(n);
        // Grace after Pierce can walk — chapter card / warm must not burn the first second.
        frameTrace.reset();
        // Let the first-second grace pass, then walk a few seconds so frames accumulate.
        await sleep(1200);
        const until = performance.now() + 4500;
        while (performance.now() < until) {
          if (probe.running() && !probe.menu().open && !probe.cutscene() && !probe.scripted()) {
            setHeld('w');
          } else {
            releaseAll();
            if (probe.cutscene() || probe.scripted()) {
              const skip = probe.skipButton;
              if (skip && !skip.disabled && skip.offsetParent) press(skip, 'Skip');
            }
          }
          await tick();
        }
        releaseAll();
        const snap = frameTrace.summary();
        const worst = snap.worst[0];
        t.metric(`hitchL${n}${device === 'phone' ? 'Phone' : ''}WorstMs`, worst?.ms ?? 0);
        t.metric(`hitchL${n}${device === 'phone' ? 'Phone' : ''}Over50`, snap.over50);
        t.metric(`hitchL${n}${device === 'phone' ? 'Phone' : ''}Over100`, snap.over100);
        if (worst) t.event('hitch-level', `L${n} ${device}: worst ${worst.ms}ms ${worst.cause} ${worst.objective || '—'}`);
        else t.event('hitch-level', `L${n} ${device}: no hitch over 50 ms (${snap.frames} frames)`);
        mark();
        return snap;
      };

      const desktop: FrameTraceSummary[] = [];
      for (let n = 1; n <= 8; n += 1) desktop.push(await sampleLevel(n, 'desktop'));
      t.progress(0.5);

      probe.phoneFrame(true, true, { w: 390, h: 844 });
      t.event('phoneFrame', '390x844 landscape');
      const phone: FrameTraceSummary[] = [];
      for (let n = 1; n <= 8; n += 1) phone.push(await sampleLevel(n, 'phone'));
      probe.phoneFrame(false);
      t.progress(0.9);

      // Aggregate for report().frameTrace (last reset was phone L8; rebuild a combined view via metrics).
      let over50 = 0;
      let over100 = 0;
      let failOver100 = 0;
      const worstAll: FrameTraceSummary['worst'] = [];
      for (const snap of [...desktop, ...phone]) {
        over50 += snap.over50;
        over100 += snap.over100;
        failOver100 += snap.failOver100;
        for (const h of snap.worst) worstAll.push(h);
      }
      worstAll.sort((a, b) => b.ms - a.ms);
      t.metric('hitchOver50', over50);
      t.metric('hitchOver100', over100);
      t.metric('hitchFailOver100', failOver100);
      t.metric('hitchWorstMs', worstAll[0]?.ms ?? 0);
      for (const h of worstAll.slice(0, 5)) {
        t.event('hitch', `${h.ms}ms ${h.cause} L${h.level} ${h.objective || '—'}${h.detail ? ` (${h.detail})` : ''}`);
      }
      t.event('frame-trace', `desktop+phone: ${over50} over 50 ms, ${over100} over 100 ms, fail ${failOver100}`);
      if (failOver100 > 0) {
        t.problem('bug', `frame-trace: ${failOver100} frame(s) over 100 ms after the first second`);
      }
      // Stash a combined summary so report().frameTrace still shows the run's rollup.
      (probe as PhProbe).frames = () => ({
        frames: desktop.reduce((n, s) => n + s.frames, 0) + phone.reduce((n, s) => n + s.frames, 0),
        lastMs: phone[7]?.lastMs ?? desktop[7]?.lastMs ?? 0,
        over50,
        over100,
        failOver100,
        worst: worstAll.slice(0, 5),
        startedAt: desktop[0]?.startedAt ?? performance.now(),
        armed: true,
      });
      t.progress(1);
      t.finish(failOver100 > 0 ? 'lost' : 'done');
      return;
    }

    if (id === 'pierce-loco') {
      const phone = Boolean(options.phone);
      levelsTotal = phone ? 1 : 2;
      if (probe.sound().prompt) await tapToPlay();
      const slideReport = (tag: string) => {
        const s = probe.footSlide?.();
        if (!s) {
          t.problem('bug', 'footSlide probe missing');
          return null;
        }
        t.event('foot-slide', `${tag}: max ${(s.max * 100).toFixed(1)} cm, mean ${(s.mean * 100).toFixed(1)} cm, plants ${s.plants}`);
        if (s.max > 0.03 && s.plants > 0) {
          t.problem('bug', `quality.foot-slide: planted foot drifted ${(s.max * 100).toFixed(1)} cm (${tag})`);
        }
        return s;
      };
      const waitWalk = async (seconds: number, drive: () => void) => {
        const until = performance.now() + seconds * 1000;
        while (performance.now() < until) {
          alive();
          drive();
          await sleep(50);
        }
        releaseAll();
      };

      if (phone) {
        touchWalk = true;
        probe.phoneFrame(true, false, { w: 390, h: 844 });
        await probe.setupLevel(1);
        await t.until(() => probe.running() && !probe.chapter().open, 45000, 'control in level 1 (phone)');
        t.scene('L1-phone-half-tilt');
        // Half tilt on the left stick: magnitude 0.5 so groundSpeed should sit near half walk (~1.5 m/s).
        const half = () => stickTo(0, -0.5);
        half();
        await sleep(200);
        let speedSum = 0;
        let rateSum = 0;
        let n = 0;
        const until = performance.now() + 4000;
        while (performance.now() < until) {
          alive();
          half();
          const m = probe.motion?.();
          if (m && m.moving && m.groundSpeed > 0.2) {
            speedSum += m.groundSpeed;
            rateSum += m.rate;
            n += 1;
          }
          await sleep(50);
        }
        releaseAll();
        stickLift();
        const avgSpeed = n ? speedSum / n : 0;
        const avgRate = n ? rateSum / n : 0;
        t.metric('halfTiltSpeed', Math.round(avgSpeed * 100) / 100);
        t.metric('halfTiltRate', Math.round(avgRate * 100) / 100);
        t.event('loco-half-tilt', `avg ${avgSpeed.toFixed(2)} m/s at rate ${avgRate.toFixed(2)}x over ${n} samples`);
        // Half of story walk (~3.05) is ~1.5; accept 1.0..2.2 so a soft start does not false-fail.
        if (avgSpeed < 1.0 || avgSpeed > 2.2) {
          t.problem('bug', `phone half-tilt speed ${avgSpeed.toFixed(2)} m/s (want ~1.5)`);
        }
        const want = avgSpeed > 0.4 ? avgSpeed / STRIDE_MPS.walk : null;
        if (want && Math.abs(avgRate - want) / want > 0.3) {
          t.problem('bug', `phone half-tilt stride ${avgRate.toFixed(2)}x vs need ${want.toFixed(2)}x`);
        }
        const s = slideReport('phone-l1');
        if (s) t.metric('footSlideMaxCm', Math.round(s.max * 1000) / 10);
        touchWalk = false;
        t.progress(1);
        t.finish('done');
        return;
      }

      // Desktop: start / stop / turn-in-place 180 on level 1, stairs/kerb on L1+L5, then a short walk on every level for byLevel.
      levelsTotal = 8;
      await probe.setupLevel(1);
      await t.until(() => probe.running() && !probe.chapter().open, 45000, 'control in level 1');
      t.scene('L1-loco');
      t.event('loco-start', 'walk forward');
      await waitWalk(2.2, () => setHeld('w'));
      t.event('loco-stop', 'release');
      await sleep(700);
      // Real turn-in-place: stand still, spin the camera ~180, then push W so locoState holds move while he faces.
      t.event('loco-turn', 'turn 180 in place');
      for (let i = 0; i < 18; i++) {
        alive();
        dragLook(28);
        await sleep(35);
      }
      await sleep(120);
      await waitWalk(1.6, () => setHeld('w'));
      {
        const phase = probe.motion?.()?.phase ?? '';
        t.event('loco-phase', phase || 'unknown');
      }
      await waitWalk(3.0, () => setHeld('w'));
      t.event('loco-stairs', 'hall walk for step/ramp contact');
      const s1 = slideReport('level-1');
      if (s1) {
        t.metric('footSlideL1Cm', Math.round(s1.max * 1000) / 10);
        t.metric('footSlideMaxCm', Math.round(s1.max * 1000) / 10);
        t.metric('footSlideMeanCm', Math.round(s1.mean * 1000) / 10);
      }
      t.progress(1 / 8);

      for (const n of [2, 3, 4, 5, 6, 7, 8]) {
        alive();
        if (n === 7) await probe.setupHidden('the-train');
        else await probe.setupLevel(n);
        await t.until(() => probe.running() && probe.level().id === n, 60000, `level ${n} running`);
        if (n === 5 && probe.scripted() === 'going-home-lobby') {
          const skip = document.getElementById('skipBtn') as HTMLButtonElement | null;
          if (skip && !skip.classList.contains('hidden')) press(skip, 'Skip lobby');
          await sleep(400);
        }
        t.scene(`L${n}-loco`);
        await waitWalk(n === 5 ? 4.0 : 2.2, () => setHeld('w'));
        const sn = slideReport(`level-${n}`);
        if (n === 5 && sn) t.metric('footSlideL5Cm', Math.round(sn.max * 1000) / 10);
        t.progress(n / 8);
      }
      const by = probe.footSlide?.()?.byLevel ?? {};
      let worst = 0;
      for (const [lib, row] of Object.entries(by)) {
        t.event('foot-slide-level', `${lib}: max ${(row.max * 100).toFixed(1)} cm over ${row.plants} plants`);
        t.metric(`footSlide.${lib}.cm`, Math.round(row.max * 1000) / 10);
        worst = Math.max(worst, row.max);
      }
      t.metric('footSlideMaxCm', Math.round(worst * 1000) / 10);
      if (Object.keys(by).length < 8) {
        t.problem('warning', `foot-slide byLevel only has ${Object.keys(by).length} of 8 levels`);
      }
      t.metric('feel.coyoteMs', 120);
      t.metric('feel.jumpBufferMs', 100);
      t.progress(1);
      t.finish('done');
      return;
    }

    if (id === 'human-pierce') {
      const phone = Boolean(options.phone);
      levelsTotal = phone ? 1 : 5;
      if (probe.sound().prompt) await tapToPlay();
      const scene = probe.scene;
      const isPierce = (m: BABYLON.AbstractMesh) => !!m.material && m.material.name.startsWith('pierce-') && !!m.skeleton;
      const bodies = () => scene.meshes.filter((m) => isPierce(m) && m.isEnabled() && m.isVisible && m.visibility > 0.05);
      const shot = (label: string) => {
        try {
          const c = probe.canvas;
          const w = 640; const cv = document.createElement('canvas');
          cv.width = w; cv.height = Math.round((c.height / c.width) * w);
          cv.getContext('2d')!.drawImage(c, 0, 0, cv.width, cv.height);
          t.event('pierce-shot', JSON.stringify({ label, image: cv.toDataURL('image/jpeg', 0.7) }));
        } catch { /* no capture */ }
      };
      /** Floor gap under one body: skinned bounds bottom against the first surface straight below. */
      const feet = (mesh: BABYLON.AbstractMesh, label: string) => {
        mesh.refreshBoundingInfo({ applySkeleton: true, applyMorph: false });
        const box = mesh.getBoundingInfo().boundingBox;
        const bottom = box.minimumWorld.y;
        const c = box.centerWorld;
        // BABYLON is a type-only import here: take a Ray from the scene and aim it straight down under the feet.
        const ray = scene.createPickingRay(0, 0, null, scene.activeCamera);
        ray.origin.set(c.x, bottom + 0.6, c.z);
        ray.direction.set(0, -1, 0);
        ray.length = 2.5;
        const hit = scene.pickWithRay(ray, (m) => m.isEnabled() && m.isVisible && m.visibility > 0.5 && m.getTotalVertices() > 0
          && !(m.material?.metadata as { character?: boolean } | null)?.character && !m.skeleton);
        if (!hit?.pickedPoint) { t.event('pierce-feet', `${label}: no floor found under the feet`); return null; }
        const gap = bottom - hit.pickedPoint.y;
        t.event('pierce-feet', `${label}: feet ${(gap * 100).toFixed(1)} cm ${gap >= 0 ? 'above' : 'into'} ${hit.pickedMesh?.name ?? 'the floor'}`);
        if (gap > 0.02 || gap < -0.05) t.problem('bug', `${label}: Pierce's feet are ${(Math.abs(gap) * 100).toFixed(1)} cm ${gap > 0 ? 'above' : 'into'} the floor`);
        return gap;
      };
      /** Skinned triangles against their rest shape: folded (inside-out) faces and stretched edges, in one pose. */
      const skinFaults = (mesh: BABYLON.AbstractMesh) => {
        const sk = mesh.skeleton!;
        sk.prepare(true);
        const rest = mesh.getVerticesData('position');
        const live = mesh.getPositionData(true, false);
        const mi = mesh.getVerticesData('matricesIndices');
        const mw = mesh.getVerticesData('matricesWeights');
        const idx = mesh.getIndices();
        const bm = sk.getTransformMatrices(mesh);
        if (!rest || !live || !mi || !mw || !idx) return { tris: 0, folded: 0, stretched: 0 };
        const dom = (v: number) => {
          let best = 0;
          for (let k = 1; k < 4; k++) if (mw[v * 4 + k]! > mw[v * 4 + best]!) best = k;
          return mi[v * 4 + best]! * 16;
        };
        const P = (a: Float32Array | number[], i: number) => [a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!];
        const nrm = (p: number[], q: number[], w: number[]) => {
          const u = [q[0]! - p[0]!, q[1]! - p[1]!, q[2]! - p[2]!];
          const x = [w[0]! - p[0]!, w[1]! - p[1]!, w[2]! - p[2]!];
          const c = [u[1]! * x[2]! - u[2]! * x[1]!, u[2]! * x[0]! - u[0]! * x[2]!, u[0]! * x[1]! - u[1]! * x[0]!];
          const l = Math.hypot(c[0]!, c[1]!, c[2]!);
          return l > 1e-12 ? c.map((y) => y / l) : null;
        };
        const dist = (p: number[], q: number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
        let folded = 0; let stretched = 0; let tris = 0;
        for (let i = 0; i + 2 < idx.length; i += 3) {
          const a = idx[i]!; const b = idx[i + 1]!; const c = idx[i + 2]!;
          tris++;
          const ra = P(rest, a); const rb = P(rest, b); const rc = P(rest, c);
          const la = P(live, a); const lb = P(live, b); const lc = P(live, c);
          const o = dom(a);
          const s = Math.hypot(bm[o]!, bm[o + 1]!, bm[o + 2]!) || 1;
          const r = [dist(ra, rb), dist(rb, rc), dist(rc, ra)];
          const l = [dist(la, lb), dist(lb, lc), dist(lc, la)];
          if (Math.max(...l.map((x, k) => (r[k]! > 1e-6 ? x / (r[k]! * s) : 1))) > 2.5) stretched++;
          const n0 = nrm(ra, rb, rc); const n1 = nrm(la, lb, lc);
          if (!n0 || !n1) continue;
          const rn = [bm[o]! * n0[0]! + bm[o + 4]! * n0[1]! + bm[o + 8]! * n0[2]!, bm[o + 1]! * n0[0]! + bm[o + 5]! * n0[1]! + bm[o + 9]! * n0[2]!, bm[o + 2]! * n0[0]! + bm[o + 6]! * n0[1]! + bm[o + 10]! * n0[2]!];
          const rl = Math.hypot(rn[0]!, rn[1]!, rn[2]!) || 1;
          if ((rn[0]! * n1[0]! + rn[1]! * n1[1]! + rn[2]! * n1[2]!) / rl < -0.2) folded++;
        }
        return { tris, folded, stretched };
      };
      /** Paused: scrub each clip on the player body at a quarter speed (16 samples over its length). */
      const poseAudit = async () => {
        const body = bodies()[0];
        if (!body) { t.problem('bug', 'level 1: no new-Pierce body to pose'); return; }
        await tapAt(document.getElementById('pauseBtn'), 'Pause');
        await t.until(() => probe.sound().paused, 3000, 'Pause');
        const bones = new Set(body.skeleton!.bones.map((b) => b.getTransformNode()).filter(Boolean));
        const groups = scene.animationGroups.filter((g) => g.targetedAnimations.some((ta) => bones.has(ta.target as BABYLON.TransformNode)));
        const clipOf = (g: BABYLON.AnimationGroup) => g.name.split('_').pop() ?? g.name;
        const was = groups.map((g) => ({ g, playing: g.isPlaying, weight: g.weight }));
        for (const g of groups) g.stop();
        for (const name of ['Idle', 'Walk', 'Run', 'SitIdle', 'SitTalk', 'PistolIdle', 'PistolWalk']) {
          const g = groups.find((x) => clipOf(x) === name);
          if (!g) { t.event('pierce-pose', `${name}: no such clip on the body`); continue; }
          let worstFold = 0; let worstStretch = 0; let tris = 0;
          g.start(false, 0.25, g.from, g.to);
          g.pause();
          g.setWeightForAllAnimatables(1);
          for (let k = 0; k <= 15; k++) {
            g.goToFrame(g.from + ((g.to - g.from) * k) / 15);
            const f = skinFaults(body);
            tris = f.tris;
            worstFold = Math.max(worstFold, f.folded);
            worstStretch = Math.max(worstStretch, f.stretched);
            await sleep(30);
          }
          g.stop();
          const fp = tris ? (100 * worstFold) / tris : 0;
          const sp = tris ? (100 * worstStretch) / tris : 0;
          t.metric(`pierceFold${name}`, Math.round(fp * 100) / 100);
          t.metric(`pierceStretch${name}`, Math.round(sp * 100) / 100);
          t.event('pierce-pose', `${name} (quarter speed, 16 frames): worst ${worstFold} folded (${fp.toFixed(2)}%), ${worstStretch} stretched (${sp.toFixed(2)}%) of ${tris} triangles`);
          if (fp > 1) t.problem('bug', `${name}: ${fp.toFixed(2)}% of Pierce's faces turn inside out (skin or suit folding through itself)`);
          if (sp > 0.5) t.problem('bug', `${name}: ${sp.toFixed(2)}% of Pierce's triangles stretch past 2.5x (suit tearing at a joint)`);
        }
        for (const w of was) if (w.playing) { w.g.play(true); w.g.setWeightForAllAnimatables(w.weight); }
        await tapAt(document.getElementById('resumeBtn'), 'Resume');
        await t.until(() => !probe.sound().paused, 3000, 'Resume');
      };
      const reportLevel = (n: number, expectHuman: boolean) => {
        const list = bodies();
        const roles = list.map((m) => (m.isDescendantOf(probe.feel?.collider ?? m) || m.name.includes('player') ? 'player' : m.name.split('_')[0]));
        t.metric(`pierceBodiesL${n}`, list.length);
        t.event('pierce-body', `Level ${n}: ${list.length ? `new Pierce shown (${[...new Set(roles)].join(', ')})` : expectHuman ? 'no new Pierce on screen' : 'the transformed body (canon: Pierce is the new body after the vat), no human Pierce in this level'}`);
        if (expectHuman && !list.length) t.problem('bug', `Level ${n}: the new human Pierce is not on screen`);
        list.forEach((m, i) => feet(m, `Level ${n} body ${i + 1}`));
        shot(`Level ${n}`);
      };
      const waitBody = async (ms: number) => {
        const until = performance.now() + ms;
        while (performance.now() < until && !bodies().length) await tick();
        return bodies().length > 0;
      };

      if (phone) {
        probe.phoneFrame(true);
        touchWalk = true;
        t.event('setup', 'phone layout 390x844 (touch)');
        await sleep(800);
        const g = probe.graphics();
        t.event('pierce-tier', `memory tier ${g.memoryTier}, texture cap ${g.textureCap ?? 'none'}, ${g.reason}`);
        await t.until(() => probe.menu().open && !!probe.menu().start, 60000, 'the title card with Start');
        await tapAt(probe.startButton, 'Start');
        await t.until(() => probe.chapter().open, 60000, 'the level 1 chapter card');
        const cardAt = performance.now();
        t.scene('Level 1 chapter card');
        await t.until(() => probe.running() && probe.level().id === 1 && !probe.chapter().open, 30000, 'control in level 1');
        const secs = (performance.now() - cardAt) / 1000;
        t.metric('pierceL1CardToControl', Math.round(secs * 10) / 10);
        t.event('pierce-start', `level 1 in control ${secs.toFixed(1)} s after the chapter card`);
        if (secs > 8) t.problem('bug', `phone: level 1 took ${secs.toFixed(1)} s from the chapter card to control (limit 8)`);
        const res = performance.getEntriesByType('resource').filter((e) => /pierce\.glb/.test(e.name)) as PerformanceResourceTiming[];
        const bytes = Math.max(0, ...res.map((e) => e.encodedBodySize || e.transferSize || 0));
        t.metric('pierceGlbMB', Math.round((bytes / 1048576) * 100) / 100);
        t.event('pierce-glb', res.length ? `pierce.glb ${(bytes / 1048576).toFixed(2)} MB` : 'pierce.glb not in the resource list');
        if (!res.length) t.problem('bug', 'phone: level 1 did not load pierce.glb');
        else if (bytes > 4 * 1048576) t.problem('bug', `phone: pierce.glb is ${(bytes / 1048576).toFixed(2)} MB (budget 4 MB)`);
        await waitBody(5000);
        reportLevel(1, true);
        setHeld('w'); await sleep(2500); releaseAll();
        await sleep(400);
        shot('Level 1 phone walk');
        t.progress(1);
        t.finish('done');
        return;
      }

      for (const [i, n] of [1, 3, 4, 6, 7].entries()) {
        levelIndex = i;
        if (n === 7) {
          t.event('setup', 'start at level 7 directly (test shortcut)');
          void probe.setupLevel(7);
        } else if (n === 6) {
          t.event('setup', 'start at level 6 directly (test shortcut)');
          void probe.setupLevel(6);
        } else {
          await enterLevel(n);
        }
        t.scene(`Level ${n}`);
        if (n === 6 || n === 7) {
          // The old body is in each level's opening scene: catch it there.
          const seen = await waitBody(90000);
          await sleep(1500);
          if (!seen) t.event("pierce-body", `Level ${n}: the old body did not show in 90 s`);
          reportLevel(n, true);
          await sleep(2500);
          shot(`Level ${n} opening`);
        } else {
          const until = performance.now() + 90000;
          while (!(probe.running() && probe.level().id === n)) {
            if (performance.now() > until) throw new Error(`level ${n} never started`);
            await tick();
          }
          await sleep(1500);
          reportLevel(n, n === 1);
          if (n === 1) {
            setHeld('w'); await sleep(2200); releaseAll();
            await sleep(500);
            shot('Level 1 walk');
            await tap('g', 'phone up, flashlight on');
            await sleep(1500);
            shot('Level 1 phone pose');
            feet(bodies()[0]!, 'Level 1 phone pose');
            await poseAudit();
            await tap('g', 'flashlight off');
          }
        }
        t.progress((i + 1) / 5);
      }
      t.finish('done');
      return;
    }

    if (id === 'model-audit') {
      levelsTotal = 2;
      const auditScene = (label: string) => {
        const scene = probe.scene;
        let meshes = 0; let skinned = 0; let bad = 0;
        const flag = (what: string, detail: string) => { bad++; t.problem('bug', `model-audit ${label}: ${what}: ${detail}`); };
        for (const mesh of scene.meshes) {
          if (!mesh.isEnabled(false) || mesh.getTotalVertices() === 0) continue;
          meshes++;
          mesh.computeWorldMatrix(true);
          if (mesh.getWorldMatrix().determinant() < 0) flag('mirrored', mesh.name);
          const nrm = mesh.getVerticesData('normal');
          if (nrm) {
            let nan = 0; let zero = 0;
            for (let i = 0; i + 2 < nrm.length; i += 3) {
              const l = Math.hypot(nrm[i]!, nrm[i + 1]!, nrm[i + 2]!);
              if (!Number.isFinite(l)) nan++; else if (l < 0.5) zero++;
            }
            if (nan || zero) flag('normals', `${mesh.name} ${nan} NaN, ${zero} zero`);
          }
          const pos = mesh.getVerticesData('position');
          if (pos && pos.some((v) => !Number.isFinite(v))) flag('positions', `${mesh.name} has NaN positions`);
          if (mesh.skeleton) {
            skinned++;
            const w = mesh.getVerticesData('matricesWeights');
            if (!w) { flag('skin', `${mesh.name} has no weights`); continue; }
            let off = 0;
            for (let i = 0; i + 3 < w.length; i += 4) if (Math.abs(w[i]! + w[i + 1]! + w[i + 2]! + w[i + 3]! - 1) > 0.02) off++;
            if (off) flag('skin', `${mesh.name} ${off} vertices with weights not summing to 1`);
          }
        }
        t.event('model-audit', `${label}: ${meshes} meshes, ${skinned} skinned, ${bad} findings`);
        t.metric(`modelAudit${label.replace(/\W/g, '')}Findings`, bad);
        try {
          const c = probe.canvas;
          const w = 640; const s = document.createElement('canvas');
          s.width = w; s.height = Math.round((c.height / c.width) * w);
          s.getContext('2d')!.drawImage(c, 0, 0, s.width, s.height);
          t.event('model-shot', JSON.stringify({ label, image: s.toDataURL('image/jpeg', 0.7) }));
        } catch { /* no canvas capture: the audit still counts */ }
      };
      for (const n of [1, 8]) {
        await enterLevel(n);
        t.scene(`Level ${n}`);
        await sleep(2500);
        auditScene(`L${n}`);
        t.progress(n === 1 ? 0.5 : 1);
      }
      t.finish('done');
      return;
    }

    if (id === 'music-director') {
      levelsTotal = 1;
      for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
        await enterLevel(n);
        t.scene(`Level ${n}`);
        t.event('level-start', `Level ${n}`);
        try {
          await t.until(() => (probe.sound().music?.chapter ?? 0) === n, 20000, 'the music director to start the chapter');
          await sleep(3000);
          const m = probe.sound().music!;
          t.event('music-state', `L${n}: ${m.state}, ${m.changes} change(s), stems ${m.stems}${m.streaming ? ' (streamed)' : ''}, duck depth ${m.duckDepthDb} dB`);
          if (m.theme) t.event('theme', `L${n}: ${m.theme.variant}, rot ${m.theme.rot}, cutoff ${m.theme.cutoffHz} Hz, detune ${m.theme.detuneCents} c`);
          if (n === 1 && m.theme?.variant !== 'human') t.problem('bug', 'Level 1 does not carry the human theme');
          if (n >= 3 && m.theme?.variant !== 'corrupt') t.problem('bug', `Level ${n} does not carry the corrupted theme`);
          for (const e of m.events.filter((x) => x.kind === 'stinger')) t.event('stinger', `L${n}: ${e.detail} at ${e.t}s`);
          if (m.changes < 1 && n !== 8) t.problem('bug', `Level ${n}: the music never changed state`);
        } catch { t.problem('bug', `Level ${n}: the music director never started`); }
        if (n === 1) {
          try {
            const byId = (name: string) => document.getElementById(name);
            await tapAt(byId('pauseBtn'), 'Pause');
            await t.until(() => probe.sound().paused, 3000, 'Pause');
            await tapAt(byId('pauseSettingsBtn'), 'Settings (Pause)');
            await t.until(() => probe.sound().settingsOpen, 3000, 'Settings');
            const el = byId('musicVolume') as HTMLInputElement;
            el.value = '0';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(300);
            t.event('setting-saved', `Music at 0%: bus level ${probe.sound().settings.music}`);
            if (probe.sound().settings.music !== 0) t.problem('bug', 'Music 0% did not take');
            el.value = '100';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            await tapAt(byId('settingsDoneBtn'), 'Done');
          } catch (e) { t.problem('bug', `Music slider check failed: ${e instanceof Error ? e.message : e}`); }
        }
      }
      return;
    }

    if (id === 'spatial-audio') {
      levelsTotal = 8;
      const phone = Boolean(options.phone);
      if (phone) { probe.phoneFrame(true); touchWalk = true; t.event('setup', 'phone layout 390x844 (touch); walking with the left stick'); await sleep(600); }
      const ac = () => probe.sound().acoustics;
      t.scene('Level 1: The Apex Peak');
      await enterLevel(1);
      await waitControl('control on level 1');
      t.event('level-start', 'Level 1: The Apex Peak');
      probe.acousticReset?.();
      await sleep(800);
      const first = ac();
      if (!first) throw new Error('the sound probe has no acoustics block');
      t.event('acoustics', `panning ${first.panning} on the ${first.tier} tier; zone ${first.zone} (${first.type}); ${first.convolvers} shared reverbs`);
      if (phone && first.panning !== 'equalpower') t.problem('bug', `spatial-audio: the phone tier pans with ${first.panning}, not equal-power`);
      if (!phone && first.panning !== 'HRTF') t.problem('bug', `spatial-audio: the desktop tier pans with ${first.panning}, not HRTF`);
      if (first.type !== 'hall') t.problem('bug', `spatial-audio: level 1 starts in a ${first.type} room, not the office hall`);

      // 3. A sound to Pierce's left is louder in the left channel.
      if (probe.acousticPing) {
        const left = await probe.acousticPing('left');
        const right = await probe.acousticPing('right');
        t.event('pan', `left source: L ${left.left.toFixed(4)} R ${left.right.toFixed(4)}; right source: L ${right.left.toFixed(4)} R ${right.right.toFixed(4)}`);
        t.metric('acousticLeftRight', left.right > 0 ? Math.round((left.left / left.right) * 100) / 100 : 99);
        if (!(left.left > left.right * 1.25)) t.problem('bug', `spatial-audio: a sound placed to the left is not louder in the left channel (L ${left.left.toFixed(4)}, R ${left.right.toFixed(4)})`);
        if (!(right.right > right.left * 1.25)) t.problem('bug', `spatial-audio: a sound placed to the right is not louder in the right channel (L ${right.left.toFixed(4)}, R ${right.right.toFixed(4)})`);
      }

      // 2. A voice at the boardroom table, heard from the hall: muffled behind the shut door, clear once it opens.
      probe.acousticTestSource?.(49.4, 1.5, 32, 90);
      await sleep(400);
      await walkTo({ x: 26, z: 32 }, 'hall-east', 1.2);
      releaseAll();
      await sleep(900);
      const shut = ac()!;
      const heard = shut.occlusion.find((o) => o.url === 'test-board-voice');
      if (!heard) t.problem('bug', 'spatial-audio: the test voice at the boardroom table is not in the occlusion list');
      else {
        t.event('door-shut', `boardroom door ${shut.door.closed ? 'shut' : 'OPEN'}; voice occluded=${heard.occluded}, cutoff ${heard.cutoffHz} Hz, ${heard.dist} m`);
        if (!shut.door.closed || !heard.occluded || heard.cutoffHz > 3000) t.problem('bug', `spatial-audio: voices behind the shut boardroom door are not muffled (door shut ${shut.door.closed}, occluded ${heard.occluded}, cutoff ${heard.cutoffHz} Hz)`);
      }
      await walkTo({ x: 38.6, z: 32 }, 'board-door-through', 1.0);
      releaseAll();
      try {
        await t.until(() => !ac()!.door.closed, 12000, 'the boardroom door to open');
        await t.until(() => (ac()!.occlusion.find((o) => o.url === 'test-board-voice')?.cutoffHz ?? 0) > 10000, 4000, 'the voice to clear');
        const clears = ac()!.clears.filter((c) => c.url === 'test-board-voice');
        const last = clears[clears.length - 1];
        t.event('door-open', `voice clear ${last ? last.sinceMs : '?'} ms after the door opened (filter model ${ac()!.clearModelMs} ms)`);
        t.metric('acousticDoorClearMs', last ? last.sinceMs : ac()!.clearModelMs);
        if (last && last.sinceMs > 500) t.problem('bug', `spatial-audio: the voice took ${last.sinceMs} ms to clear after the boardroom door opened (limit 500)`);
      } catch (e) {
        t.problem('bug', `spatial-audio: ${e instanceof Error ? e.message : e}`);
      }
      probe.acousticTestSource?.(0, 0, 0, 0);
      await sleep(900);
      const inside = ac()!;
      t.event('zone', `in the boardroom: zone ${inside.zone} (${inside.type})`);
      if (inside.type !== 'boardroom') t.problem('bug', `spatial-audio: inside the boardroom the reverb is ${inside.type}`);

      // 1. Every chapter: the room type under him, collected across the run.
      const names = ['The Apex Peak', 'B3', 'The Return', 'The Desk', 'Going Home', 'The Station', 'The Train', 'The Morning'];
      for (const n of [2, 3, 4, 5, 6, 7, 8]) {
        const lname = `Level ${n}: ${names[n - 1]}`;
        t.scene(lname);
        await enterLevel(n);
        t.event('level-start', lname);
        const until = performance.now() + 100000;
        const began = performance.now();
        const skipAfter = n === 5 ? 70000 : 5000;
        while (performance.now() < until && !(probe.running() && !probe.menu().open && !probe.scripted() && !probe.cutscene())) {
          if (probe.skipButton && !probe.skipButton.hidden && performance.now() - began > skipAfter) press(probe.skipButton, 'Skip');
          const ph = probe.phone();
          if (ph.incoming) { releaseAll(); await once('f', 1500, 'answer call'); }
          await tick();
        }
        await sleep(500);
        // A few steps of walking so the footsteps take the room too.
        setHeld('w');
        await sleep(1500);
        releaseAll();
        const a = ac()!;
        t.event('zone', `${lname}: ${a.zone} (${a.type}); seen so far ${a.visited.join(', ')}`);
      }
      const end = ac()!;
      t.metric('acousticZones', end.visited.length);
      t.event('acoustics', `reverb zones seen: ${end.visited.join(', ')}`);
      if (end.visited.length < 8) t.problem('bug', `spatial-audio: only ${end.visited.length} reverb zones across the 8 chapters (${end.visited.join(', ')}), need 8`);
      t.metric('acousticLufs', end.loudness.integrated);
      t.event('loudness', `integrated ${end.loudness.integrated} LUFS (short-term ${end.loudness.shortTerm}, target ${end.loudness.target}, trim ${end.loudness.trimDb} dB, ${end.loudness.blocks} blocks); limiter ${end.limiterReductionDb} dB`);
      t.metric('acousticDropouts', end.dropouts);
      t.event('dropouts', `${end.dropouts} audio dropouts, clock lag ${end.lagMs} ms, underruns ${end.underruns ?? 'n/a'}`);
      if (end.dropouts > 0) t.problem('bug', `spatial-audio: ${end.dropouts} audio dropouts in the run`);
      if (end.loudness.blocks > 30 && (end.loudness.integrated > -10 || end.loudness.integrated < -23)) t.problem('bug', `spatial-audio: master loudness ${end.loudness.integrated} LUFS is far from -16`);
      touchWalk = false;
      stickLift();
      t.progress(1);
      t.finish('done');
      return;
    }

    if (id === 'layered-ambience') {
      levelsTotal = 8;
      const phone = Boolean(options.phone);
      if (phone) {
        probe.phoneFrame(true);
        t.event('setup', 'phone layout 390x844 (touch)');
        await sleep(600);
      }
      const bedNames = ['The Apex Peak', 'B3', 'The Return', 'The Desk', 'Going Home', 'The Station', 'The Train', 'The Morning'];
      const paSeen = { station: new Set<string>(), train: new Set<string>() };
      let maxLiveSeen = 0;
      const walkChapter = async (n: number, seconds: number) => {
        const lname = `Level ${n}: ${bedNames[n - 1]}`;
        t.scene(lname);
        await enterLevel(n);
        t.event('level-start', lname);
        // Bed within 1 s of chapter start (phone criterion).
        const bedT0 = performance.now();
        try {
          await t.until(() => Boolean(probe.sound().bedPlaying), 1500, 'ambience bed within 1 s');
          const bedMs = Math.round(performance.now() - bedT0);
          t.metric(`ambienceBedMsL${n}`, bedMs);
          t.event('bed', `${lname} bed in ${bedMs} ms: ${probe.sound().bed}`);
          if (bedMs > 1000) t.problem('bug', `${lname}: ambience bed took ${bedMs} ms (limit 1000)`);
        } catch {
          t.problem('bug', `${lname} has no audible ambience bed within 1 s`);
          t.metric(`ambienceBedMsL${n}`, -1);
        }
        try {
          await t.until(() => controllable(), 60000, `control on ${lname}`);
        } catch {
          t.problem('bug', `${lname} never gave control`);
          return;
        }
        // Skip openings / scripted scenes so the walk can hear the bed.
        const skipUntil = performance.now() + 8000;
        while (performance.now() < skipUntil) {
          const skip = probe.skipButton;
          if (skip && !skip.hidden && !skip.disabled) {
            if (phone) await tapAt(skip, 'Skip');
            else press(skip, 'Skip');
            await sleep(400);
          }
          if (controllable() && !probe.cutscene()) break;
          await tick();
        }
        const walkFor = seconds * 1000;
        const walkStart = performance.now();
        let silenceMax = 0;
        if (!phone) setHeld('w');
        while (performance.now() - walkStart < walkFor) {
          if (phone) {
            // Left stick forward drag (touch).
            const stick = document.getElementById('moveStick');
            if (stick) {
              const r = stick.getBoundingClientRect();
              const cx = r.left + r.width / 2;
              const cy = r.top + r.height / 2;
              stick.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'touch' }));
              stick.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx, clientY: cy - 40, pointerId: 1, pointerType: 'touch' }));
            }
          }
          const amb = probe.sound().ambience;
          if (amb) {
            silenceMax = Math.max(silenceMax, amb.silenceMs);
            maxLiveSeen = Math.max(maxLiveSeen, amb.live);
            if (phone && amb.maxLive > 4) t.problem('bug', `phone ambience maxLive is ${amb.maxLive} (cap 4)`);
          }
          try {
            for (const b of probe.life?.().barks ?? []) {
              if (b.place === 'station' && b.line.startsWith('pa.station')) paSeen.station.add(b.line);
              if (b.place === 'train' && b.line.startsWith('pa.train')) paSeen.train.add(b.line);
            }
          } catch { /* optional */ }
          t.progress(((n - 1) + (performance.now() - walkStart) / walkFor) / 8);
          await sleep(phone ? 350 : 250);
        }
        if (!phone) releaseAll();
        else {
          const stick = document.getElementById('moveStick');
          if (stick) stick.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch' }));
        }
        const ambEnd = probe.sound().ambience;
        const distinct = ambEnd?.distinctSpots ?? ambEnd?.spotsPlayed.length ?? 0;
        t.metric(`ambienceSpotsL${n}`, distinct);
        t.metric(`ambienceSilenceMaxL${n}`, Math.round(silenceMax));
        t.event('ambience', `${lname}: ${distinct} spots [${(ambEnd?.spotsPlayed ?? []).join(', ')}], silenceMax ${Math.round(silenceMax)} ms`);
        if (distinct < 6) t.problem('bug', `${lname}: only ${distinct} distinct ambience spots in a walk (need 6)`);
        if (silenceMax > 10000) t.problem('bug', `${lname}: ambience silence reached ${Math.round(silenceMax)} ms (limit 10000)`);
        if (n === 6) {
          t.metric('stationPaDistinct', paSeen.station.size);
          t.event('pa', `Station PA distinct: ${paSeen.station.size} (${[...paSeen.station].join(' | ')})`);
          if (paSeen.station.size < 4) t.problem('bug', `Station PA only played ${paSeen.station.size} distinct lines (need 4)`);
        }
        if (n === 7) {
          t.metric('trainPaDistinct', paSeen.train.size);
          t.event('pa', `Train PA distinct: ${paSeen.train.size} (${[...paSeen.train].join(' | ')})`);
          if (paSeen.train.size < 4) t.problem('bug', `Train PA only played ${paSeen.train.size} distinct lines (need 4)`);
        }
      };
      // Station/train get longer walks so PA can rotate; others ~70 s is enough for 6 spots.
      for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const secs = n === 6 || n === 7 ? 100 : 70;
        await walkChapter(n, secs);
      }
      t.metric('ambienceMaxLive', maxLiveSeen);
      if (phone && maxLiveSeen > 4) t.problem('bug', `phone low tier played ${maxLiveSeen} concurrent spots (max 4)`);
      if (phone) probe.phoneFrame(false);
      t.progress(1);
      t.finish('done');
      return;
    }

    if (id === 'feel-audio') {
      levelsTotal = 1;
      const pulses = () => (window as unknown as { __phPulses?: number }).__phPulses ?? 0;
      const bedNames = ['The Apex Peak', 'B3', 'The Return', 'The Desk', 'Going Home', 'The Station', 'The Train', 'The Morning'];
      for (const n of [1, 2, 3, 4, 5, 7, 8, 6]) {
        const lname = `Level ${n}: ${bedNames[n - 1]}`;
        await enterLevel(n);
        t.scene(lname);
        t.event('level-start', lname);
        try {
          await t.until(() => probe.sound().bed !== null && probe.sound().bedPlaying, 20000, 'the level bed to play');
          t.event('bed', `${lname}: ${probe.sound().bed}`);
        } catch {
          t.problem('bug', `${lname} has no audible music bed`);
        }
      }
      // Level 6: wait for control, walk (footsteps), then Punch with a click.
      try {
        await t.until(() => controllable(), 60000, 'control on level 6');
        setHeld('w');
        try {
          await t.until(() => probe.sound().footsteps, 4000, 'the footstep loop');
          t.event('feedback', 'Footsteps: the walk loop plays while he moves');
        } catch { t.problem('bug', 'walking made no footstep sound'); }
        releaseAll();
        await sleep(400);
        if (probe.sound().footsteps) t.problem('bug', 'footsteps kept playing after he stopped');
        const before = pulses();
        input('fire', true);
        await sleep(300);
        if (pulses() > before) t.event('feedback', 'Punch: sound and screen pulse');
        else t.problem('bug', 'a click strike gave no screen pulse');
        // A power: Shadow mode on, then a click uses the selected ability (sound and the same pulse).
        await sleep(400);
        if (!probe.shadow().on) { releaseAll(); await once('c', 1200, 'Shadow mode'); await sleep(400); }
        if (probe.shadow().on) {
          const beforePower = pulses();
          input('fire', true);
          await sleep(300);
          if (pulses() > beforePower) t.event('feedback', 'Shadow power: sound and screen pulse');
          else t.problem('bug', 'a Shadow mode click gave no screen pulse');
        } else t.problem('bug', 'Shadow mode would not turn on on level 6');
      } catch { t.problem('bug', 'level 6 never gave control'); }
      // Sliders: open Pause, then Settings, and move the real Music and Effects sliders.
      try {
        const byId = (name: string) => document.getElementById(name);
        releaseAll();
        await tapAt(byId('pauseBtn'), 'Pause');
        await t.until(() => probe.sound().paused, 3000, 'Pause');
        await tapAt(byId('pauseSettingsBtn'), 'Settings (Pause)');
        await t.until(() => probe.sound().settingsOpen, 3000, 'Settings to open from Pause');
        const slide = (el: HTMLInputElement, percent: number) => {
          el.value = String(percent);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          t.add('interactions');
        };
        slide(byId('musicVolume') as HTMLInputElement, 30);
        slide(byId('sfxVolume') as HTMLInputElement, 60);
        await sleep(300);
        const saved = JSON.parse(localStorage.getItem(SOUND_KEY) ?? 'null');
        if (saved && Math.abs(saved.music - 0.3) < 0.001 && Math.abs(saved.sfx - 0.6) < 0.001) t.event('setting-saved', `Music 30%, Effects 60%: ${JSON.stringify(saved)}`);
        else t.problem('bug', `volumes not saved: ${JSON.stringify(saved)}`);
        await tapAt(byId('settingsDoneBtn'), 'Done');
      } catch (e) { t.problem('bug', `the volume sliders could not be used from Pause: ${e instanceof Error ? e.message : e}`); }
      return;
    }

    if (id === 'smoke') {
      // Beta only runs smoke: cover hitch-board's L1 work-time hitch bar, transition's black-frame check,
      // and a short L1 explore-cam so camera criteria are measurable without a separate scenario
      // (m_98ce28cc5577, m_36b0146480a8). Full explore-cam-l1..l8 / interior-cam stay on the front-page contract.
      levelsTotal = 18; // L1 board + transition samples + L1 explore-cam
      // Start L1: wait for the chapter card (Start path), sample black-frame, then walk.
      // Do not soft-skip if the card is late — that was the live path the level-start task needed.
      {
        const menu = probe.menu();
        if (menu.open && menu.start && /start/i.test(menu.start)) press(probe.startButton, menu.start);
        else if (menu.open && menu.newGame) press(probe.newGameButton, 'New Game');
        else await probe.setupLevel(1);
        await sampleChapterTransition(1, false, false);
        const untilL1 = performance.now() + 90000;
        while (!(probe.running() && probe.level().id === 1)) {
          if (performance.now() > untilL1) throw new Error('timed out waiting for level 1 to start after the card');
          await tick();
        }
      }
      // Hitch grace starts once Pierce can walk (same rule as hitch-board).
      frameTrace.reset();
      t.scene(LEVELS[0].name);
      t.event('level-start', LEVELS[0].name);
      await measureLook();
      const until = performance.now() + 54000;
      let menusChecked = false;
      let sceneSeen = 0;
      while (performance.now() < until) {
        await tick();
        if (probe.cutscene()) {
          if (!sceneSeen) sceneSeen = performance.now();
          if (performance.now() - sceneSeen > 5000) {
            if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
            await sleep(800);
            observe();
            break;
          }
          continue;
        }
        if (!probe.running() || probe.menu().open) continue;
        if (!lookSens) await measureLook();
        const phone = probe.phone();
        if (phone.incoming) { releaseAll(); await once('f', 1500, 'answer call'); t.event('call', phone.speaker || 'incoming'); continue; }
        if (phone.busy) { releaseAll(); continue; }
        if (!menusChecked) {
          menusChecked = true;
          releaseAll();
          await tap('o', 'Missions');
          await sleep(500);
          await tap('o', 'Missions');
          await tap('i', 'Inventory');
          await sleep(600);
          // hold it open so the footage shows the panel, and check it is clear of the HUD around it
          t.event('inventory open');
          const rect = (sel: string) => {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && +cs.opacity > 0.05 ? r : null;
          };
          const panel = rect('#inventoryPanel');
          if (!panel) t.problem('bug', 'Inventory did not open: the panel is not visible after pressing I');
          else {
            const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
            for (const [name, sel] of [['objective card', '#objectiveHud'], ['health bar', '#healthBar']] as const) {
              const other = rect(sel);
              if (other && hit(panel, other)) t.problem('bug', `the open Inventory panel overlaps the ${name} (panel ${Math.round(panel.left)},${Math.round(panel.top)}-${Math.round(panel.right)},${Math.round(panel.bottom)}; ${name} ${Math.round(other.left)},${Math.round(other.top)}-${Math.round(other.right)},${Math.round(other.bottom)})`);
            }
            // the Q/G/H/F stack must not be pushed up over the health bar or the pause button
            const health = rect('#healthBar');
            for (const id of ['sidearmHint', 'abilityHint', 'shadowHint', 'lightHint', 'medkitHint', 'phoneHint']) {
              const hint = rect('#' + id);
              if (!hint) continue;
              for (const [name, other] of [['health bar', health], ['pause button', rect('#pauseBtn')]] as const) {
                if (other && hit(hint, other)) t.problem('bug', `with Inventory open the ${id} button sits on the ${name}`);
              }
            }
          }
          await sleep(2500);
          await tap('i', 'Inventory');
          t.event('inventory closed');
          await sleep(300);
          continue;
        }
        const label = probe.action();
        if (label) { releaseAll(); if (await once('e', 1500, label)) t.event('action', label); continue; }
        const goal = probe.objective().target;
        if (goal) await walkTo(goal, 'seat');
      }
      releaseAll();
      if (!sceneSeen) t.problem('bug', 'smoke: the board scene did not start within 54 s of Start');
      const hitchOk = publishFrameTrace(t, 'smoke L1 board');
      t.progress(0.2);

      // Chapter-card black-frame check for the rest of the levels (desktop L2-8, then phone L1-8).
      let step = 1;
      const steps = 15;
      for (let n = 2; n <= 8; n++) {
        await sampleChapterTransition(n, false, true);
        t.progress(0.2 + 0.35 * (step++ / steps));
      }
      // Match the frame to the real viewport: a landscape 844x390 frame inside a portrait phone shrinks to a 0.46 scale box.
      const portraitView = window.innerHeight > window.innerWidth;
      probe.phoneFrame(true, !portraitView, portraitView ? { w: 390, h: 844 } : { w: 844, h: 390 });
      t.event('phoneFrame', portraitView ? '390x844' : '844x390');
      for (let n = 1; n <= 8; n++) {
        await sampleChapterTransition(n, true, true);
        t.progress(0.2 + 0.35 * (step++ / steps));
      }
      probe.phoneFrame(false);

      // Short L1 explore-cam: wall-hug Hall 1 / Hall 2 so smoke reports cameraInside/blocked/snaps
      // and attaches worst-frame screenshots (Camera at home indoors criteria on a smoke-only beta).
      t.scene('explore-cam smoke L1');
      t.event('explore-cam-smoke', 'L1 hall wall-hug');
      let camOk = true;
      {
        const feel = probe.feel;
        let fadedPeak = 0;
        let hallwayFrames = 0;
        const cw = installCameraWatch({
          scene: () => probe.scene,
          player: () => (feel ? feel.collider.getAbsolutePosition().clone() as never : null),
          isSolid: (m) => (feel ? feel.isSolid(m) : true),
          active: () => {
            if (!(probe.running() && !probe.menu().open && !probe.cutscene() && !probe.scripted())) return false;
            const cam = probe.camera?.();
            if (cam) {
              fadedPeak = Math.max(fadedPeak, cam.faded);
              if (cam.profile === 'hallway' || cam.profile === 'doorway') hallwayFrames += 1;
            }
            return true;
          },
          label: () => 'smoke-L1',
          emit: (type, detail) => t.event(type, detail),
        });
        try {
          await enterLevel(1);
          for (let i = 0; i < 400 && (probe.cutscene() || probe.scripted() || probe.menu().open); i += 1) {
            const skip = probe.skipButton;
            if (skip && !skip.disabled && skip.offsetParent) press(skip, 'Skip');
            await tick();
          }
          await measureLook();
          await sleep(600);
          cw.start();
          // Same hall waypoints as interior-cam's L1 pass (short: five stops, look drags, brief wall hug).
          const goals: Point[] = [
            { x: 0, z: 12 },
            { x: 0, z: 28 },
            { x: 8, z: 32 },
            { x: 18, z: 32 },
            { x: 30, z: 32 },
          ];
          let arrivedN = 0;
          for (const g of goals) {
            const t1 = performance.now();
            let okGoal = false;
            while (performance.now() - t1 < 16000 && !(okGoal = await walkTo(g, `smoke-cam-${arrivedN}`, 0.85))) {
              if (probe.cutscene() || probe.scripted()) break;
              await tick();
            }
            releaseAll();
            if (okGoal) {
              arrivedN += 1;
              for (let i = 0; i < 6; i += 1) { dragLook(12); await tick(); }
              for (let i = 0; i < 6; i += 1) { dragLook(-12); await tick(); }
              setHeld('d');
              const u = performance.now() + 700;
              while (performance.now() < u) await tick();
              releaseAll();
            }
          }
          t.metric('cameraStops', arrivedN);
          t.event('explore-plan', `${arrivedN} smoke-cam stops on L1`);
        } catch (e) {
          t.event('explore-error', `smoke L1: ${String(e)}`);
          camOk = false;
        }
        releaseAll();
        cw.stop();
        const sum = cw.summary();
        lastCam = sum;
        t.metric('cameraFrames', sum.frames);
        t.metric('cameraInside', sum.inside);
        t.metric('cameraNear', sum.near);
        t.metric('cameraBlocked', sum.blocked);
        t.metric('cameraNearWall', sum.nearWall);
        t.metric('cameraSnaps', sum.snaps);
        t.metric('cameraJitter', sum.jitter);
        t.metric('cameraMaxCoverage', Math.round(sum.maxCoverage * 100) / 100);
        t.metric('cameraFadedPeak', fadedPeak);
        t.metric('cameraHallwayFrames', hallwayFrames);
        t.event('camera-summary', JSON.stringify({ ...sum, worst: sum.worst.map((w) => ({ ...w, shot: undefined })), fadedPeak, hallwayFrames, source: 'smoke-L1' }));
        sum.worst.forEach((w, i) => { if (w.shot) t.event('camera-screenshot', JSON.stringify({ rank: i + 1, kind: w.kind, detail: w.detail, image: w.shot })); });
        if (sum.inside > 0) {
          t.problem('bug', `camera inside geometry on smoke L1 explore: ${sum.inside} frames`);
          camOk = false;
        }
        const base = CAM_BASELINE[0]!;
        const insideCap = Math.max(1, Math.ceil(base.inside * 0.1));
        const blockedCap = Math.max(1, Math.ceil(base.blocked * 0.1));
        if (sum.inside > insideCap) {
          t.problem('bug', `smoke cameraInside ${sum.inside} exceeds 10% of baseline ${base.inside} (cap ${insideCap})`);
          camOk = false;
        }
        if (sum.blocked > blockedCap) {
          t.problem('bug', `smoke cameraBlocked ${sum.blocked} exceeds 10% of baseline ${base.blocked} (cap ${blockedCap})`);
          camOk = false;
        }
      }
      t.progress(1);
      const ok = sceneSeen && hitchOk && camOk;
      t.finish(ok ? 'done' : sceneSeen ? 'lost' : 'stuck');
      return;
    }

    if (id === 'full') {
      levelsTotal = 8;
      await enterLevel(1);
      for (let n = 1; n <= 8; n++) {
        levelIndex = n - 1;
        // Level 7 is the train story (opening, cars, stop, Hale, the door, End Level) and level 8 is The
        // Morning (bed, TV, Voss, the door). Continue from the previous card has already started each.
        // playLevel walks a marker; the story levels have their own runs, shared with level-7 / level-8.
        const outcome = n === 8 ? await morningRun(true) : n === 7 ? await trainStoryRun(true) : await playLevel(n);
        if (outcome !== 'won') { t.finish(outcome); return; }
        t.event('full-progress', `level ${n} of 8 finished`);
        if (n < 8) {
          await sleep(2500);
          const menu = probe.menu();
          if (!menu.start) throw new Error(`no Continue on the level ${n} card`);
          press(probe.startButton, menu.start);
          const until = performance.now() + 90000;
          while (!(probe.running() && probe.level().id === n + 1)) {
            if (performance.now() > until) throw new Error(`timed out waiting for level ${n + 1} after Continue`);
            await tick();
          }
          if (n === 7) t.event('continue', `Level 7's Continue entered ${probe.level().name}`);
        }
      }
      const hitchOk = publishFrameTrace(t, 'full');
      t.progress(1);
      t.finish(hitchOk ? 'won' : 'lost');
      return;
    }

    if (id === 'lore-link') {
      levelsTotal = 1;
      const N = 4;
      await enterLevel(N);
      const outcome = await playLevel(N);
      t.progress(0.6);
      if (outcome !== 'won') { t.finish(outcome); return; }
      await sleep(1200);
      t.scene('Level Complete: lore entry');
      const text = (el: Element | null) => (el?.textContent ?? '').trim().replace(/\s+/g, ' ');
      const card = document.getElementById('loreEntry');
      const link = document.getElementById('loreLink') as HTMLAnchorElement | null;
      const cardShown = shown(card);
      const entry = { kicker: text(document.getElementById('loreKicker')), title: text(document.getElementById('loreTitle')), line: text(document.getElementById('loreText')) };
      t.event('lore-unlocked', { level: N, ...entry, link: link?.href ?? null, visible: !!cardShown });
      if (card) (card as HTMLElement).style.outline = `2px solid ${cardShown ? '#d4b483' : '#ff4d4d'}`;
      if (!cardShown || !entry.title || entry.line.length < 20) t.problem('bug', `Level Complete shows no lore entry for level ${N} (${JSON.stringify(entry)})`);
      else if (!/lore unlocked/i.test(entry.kicker)) t.problem('bug', `the lore entry has no "Lore unlocked" kicker: "${entry.kicker}"`);
      if (RAW_KEY.test(`${entry.kicker} ${entry.title} ${entry.line}`)) t.problem('bug', 'the lore entry shows a raw locale id');
      if (!link || !shown(link) || !/read more/i.test(text(link))) t.problem('bug', 'the lore entry has no visible "Read more" link');
      else if (!/\/lore\/the-desk\.html$/.test(link.href)) t.problem('bug', `Read more points at ${link.href}, not the site's lore/the-desk.html`);
      else t.event('read-more', `shows "${text(link)}" -> ${link.href}`);
      const saved = decodeURIComponent(document.cookie.split('; ').find((c) => c.startsWith('ph-origins-save='))?.slice(16) ?? '{}');
      let unlockedList: number[] = [];
      try { unlockedList = (JSON.parse(saved).lore as number[]) ?? []; } catch { /* no cookie */ }
      t.event('lore-saved', `unlocked entries on the save: ${JSON.stringify(unlockedList)}`);
      if (!unlockedList.includes(N)) t.problem('bug', `the lore entry for level ${N} is not saved as unlocked`);
      await sleep(2500);
      t.progress(0.75);

      // Read more: the page it names, in an overlay, with its Play this level link.
      const playLinkOf = (doc: Document, n: number) => [...doc.querySelectorAll<HTMLAnchorElement>('a[data-play]')].find((a) => /play this level/i.test(a.textContent ?? '') && new URL(a.href).searchParams.get('level') === String(n));
      const withPage = async (url: string, fn: (doc: Document, frame: HTMLIFrameElement) => Promise<void>) => {
        const frame = document.createElement('iframe');
        frame.src = url;
        Object.assign(frame.style, { position: 'fixed', inset: '4%', width: '92%', height: '92%', zIndex: '9999', border: '2px solid #d4b483', background: '#05080c' });
        document.body.appendChild(frame);
        try {
          const until = performance.now() + 20000;
          while (!frame.contentDocument?.querySelector('footer') && performance.now() < until) await sleep(200);
          await sleep(500);
          if (!frame.contentDocument?.querySelector('footer')) { t.problem('bug', `lore page did not load in the overlay (${url})`); return; }
          await fn(frame.contentDocument, frame);
        } finally { frame.remove(); }
      };
      t.scene('Lore page: the-desk');
      await withPage(link?.href ?? new URL('../lore/the-desk.html', location.href).href, async (doc, frame) => {
        const play = playLinkOf(doc, N);
        const r = play?.getBoundingClientRect();
        const visible = !!(r && r.width > 0 && r.height > 0);
        if (play) { play.scrollIntoView({ block: 'center' }); play.style.outline = '2px solid #d4b483'; }
        t.event('play-this-level', `the-desk page: ${visible ? 'shows' : 'NO'} "${text(play ?? null)}" -> ${play?.getAttribute('href') ?? 'none'}`);
        if (!play || !visible) t.problem('bug', 'the lore page for level 4 has no visible "Play this level" link with ?level=4');
        void frame;
        await sleep(2500);
      });
      t.progress(0.85);

      t.scene('Lore pages: every level');
      const base = new URL(location.pathname.includes('/play/') ? '../' : './', location.href);
      const slugs = ['the-apex-peak', 'b3', 'the-return', 'the-desk', 'going-home', 'the-station', 'the-train', 'the-morning'];
      for (const [i, slug] of slugs.entries()) {
        const res = await fetch(new URL(`lore/${slug}.html`, base).href, { cache: 'no-store' });
        if (!res.ok) { t.problem('bug', `lore/${slug}.html answers ${res.status}`); continue; }
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const play = playLinkOf(doc, i + 1);
        t.event('lore-page', `chapter ${i + 1} ${slug}: ${play ? `Play this level -> ?level=${i + 1}` : 'NO Play this level link'}`);
        if (!play) t.problem('bug', `lore/${slug}.html has no "Play this level" link to ?level=${i + 1}`);
      }
      const indexRes = await fetch(new URL('lore.html', base).href, { cache: 'no-store' });
      const index = new DOMParser().parseFromString(await indexRes.text(), 'text/html');
      const listed = index.querySelectorAll('.level a[href*="lore/"]').length;
      t.event('lore-index', `${listed} entries listed`);
      if (listed < 8) t.problem('bug', `lore.html lists ${listed} entries, not 8`);
      t.progress(1);
      t.finish('done');
      return;
    }

    if (id === 'chapter-select') {
      levelsTotal = 1;
      const phone = Boolean(options.phone);
      if (phone) {
        probe.phoneFrame(true, false, { w: 390, h: 844 });
        t.event('setup', 'phone layout 390x844 (touch)');
        await sleep(500);
      }
      t.scene('Chapter Select');
      const opener = document.getElementById('loadModelBtn') as HTMLButtonElement | null;
      if (!opener || !shown(opener)) { t.problem('bug', 'the title menu has no Chapter Select button'); t.finish('done'); return; }
      if (!/chapter select/i.test(opener.textContent ?? '')) t.problem('bug', `the button reads "${opener.textContent}", not Chapter Select`);
      await tapAt(opener, 'Chapter Select');
      await t.until(() => probe.chapterSelect().cards.length >= 8, 8000, 'eight chapter cards');
      await sleep(600);
      const view = probe.chapterSelect();
      t.metric('chapterCards', view.cards.length);
      t.event('chapter-cards', view.cards.map((c) => `${c.n}${c.unlocked ? '' : ' (locked)'}: ${c.text}`).join(' | '));
      if (view.cards.length !== 8) t.problem('bug', `Chapter Select shows ${view.cards.length} cards, not 8`);
      const locked = view.cards.filter((c) => !c.unlocked).length;
      if (!locked && view.cards.length === 8) t.event('note', 'every chapter is unlocked on this save, none dimmed');
      let minPx = 9999;
      for (const c of view.cards) {
        minPx = Math.min(minPx, c.box.h);
        if (c.unlocked && !(/Best\s+\S+/i.test(c.text) && /Lore\s+\d+\s+of\s+\d+/i.test(c.text))) t.problem('bug', `unlocked card ${c.n} shows no best time or "Lore n of m": ${c.text}`);
        if (RAW_KEY.test(c.text)) t.problem('bug', `card ${c.n} shows a raw locale id: ${c.text}`);
      }
      t.metric('chapterCardMinPx', Math.round(minPx));
      if (minPx < 44) t.problem('bug', `a chapter card is ${Math.round(minPx)} px tall, under 44`);
      const list = document.getElementById('levelList') as HTMLElement;
      const cs = getComputedStyle(list);
      const scrolls = /auto|scroll/.test(cs.overflowY) && /pan-y/.test(cs.touchAction);
      t.event('swipe-list', `overflowY ${cs.overflowY}, touch-action ${cs.touchAction}, ${view.list.scrollHeight} px of content in ${view.list.clientHeight} px`);
      if (!scrolls) t.problem('bug', 'the chapter list is not swipe-scrollable (needs overflow-y auto and touch-action pan-y)');
      if (phone && view.list.scrollHeight <= view.list.clientHeight + 4) t.problem('warning', 'at 390x844 all eight cards fit without scrolling');
      // A swipe on the list (touch drag), then the cards must still be reachable.
      const lr = list.getBoundingClientRect();
      const pid = 81;
      const ev = (type: string, y: number, buttons: number) => list.dispatchEvent(new PointerEvent(type, { pointerType: phone ? 'touch' : 'mouse', pointerId: pid, isPrimary: true, bubbles: true, cancelable: true, clientX: lr.left + lr.width / 2, clientY: y, buttons }));
      ev('pointerdown', lr.top + lr.height * 0.8, 1);
      for (let i = 1; i <= 8; i += 1) { await sleep(30); ev('pointermove', lr.top + lr.height * (0.8 - i * 0.07), 1); }
      ev('pointerup', lr.top + lr.height * 0.2, 0);
      list.scrollTop = list.scrollHeight;
      await sleep(300);
      t.event('swiped', `scrollTop ${Math.round(list.scrollTop)} of ${list.scrollHeight - list.clientHeight}`);
      list.scrollTop = 0;
      // The cue: focus the first unlocked card.
      const cards = [...list.querySelectorAll<HTMLButtonElement>('.chapter-card')];
      const first = cards.find((c) => !c.disabled);
      const before = probe.chapterSelect().cue.plays;
      first?.focus();
      await sleep(500);
      const cue = probe.chapterSelect().cue;
      t.event('cue', `chapter music cue plays ${before} -> ${cue.plays} (chapter ${cue.last})`);
      if (cue.plays <= before) t.problem('bug', 'focusing a chapter card plays no music cue');
      // Start chapter 1 by tap.
      t.scene('Start chapter 1');
      const t0 = performance.now();
      if (first) {
        first.scrollIntoView({ block: 'center' });
        await tapAt(first, 'chapter 1 card');
        await sleep(400);
        if (!probe.running()) first.click();
      }
      const until = performance.now() + 30000;
      while (!(probe.running() && probe.level().id === 1 && !probe.menu().open) && performance.now() < until) await sleep(100);
      const took = (performance.now() - t0) / 1000;
      t.metric('chapterStartSeconds', Math.round(took * 10) / 10);
      t.event('chapter-start', `chapter 1 running ${took.toFixed(1)} s after the tap`);
      if (took > 10) t.problem('bug', `chapter 1 took ${took.toFixed(1)} s to start from its card (limit 10)`);
      if (!probe.running()) { t.finish('done'); return; }
      // Hidden lore pages: walk onto each with real input.
      t.scene('Hidden lore pages');
      await waitControl('control in chapter 1');
      const total = probe.loreSpots().all.length;
      if (total < 2) t.problem('bug', `chapter 1 hides ${total} lore pages, under 2`);
      let found = 0;
      for (const spot of probe.loreSpots().all) {
        const stillThere = () => probe.loreSpots().remaining.some((r) => r.id === spot.id);
        const limit = performance.now() + 40000;
        while (stillThere() && performance.now() < limit) {
          await walkTo({ x: spot.x, z: spot.z }, `lore page ${spot.id}`, 0.9);
          await tick();
        }
        releaseAll();
        if (!stillThere()) { found += 1; t.event('lore-page', `found ${spot.id} (${found}/${total}); toast: ${document.getElementById('loreToast')?.textContent ?? ''}`); }
        else t.problem('warning', `could not reach lore page ${spot.id} at (${spot.x}, ${spot.z})`);
        await sleep(300);
      }
      t.metric('lorePagesFound', found);
      const saved = probe.chapterSelect().save.found['1'] ?? [];
      if (saved.length !== found) t.problem('bug', `found ${found} pages but the save holds ${saved.length}`);
      const rows = probe.levelRows();
      const card1 = probe.chapterSelect().cards.find((c) => c.n === 1);
      t.event('card-after', card1?.text ?? 'none');
      if (!new RegExp(`Lore\\s+${found}\\s+of\\s+${total}`).test(card1?.text ?? '')) t.problem('bug', `card 1 does not show Lore ${found} of ${total} after finding them: ${card1?.text}`);
      void rows;
      t.finish('done');
      return;
    }

    if (id === 'site-links') {
      t.progress(0.15);
      await siteLinksCheck();
      t.progress(1);
      t.finish('done');
      return;
    }

    if (id === 'transition') {
      levelsTotal = 16;
      for (const phone of [false, true]) {
        if (phone) {
          const portraitView = window.innerHeight > window.innerWidth;
          probe.phoneFrame(true, !portraitView, portraitView ? { w: 390, h: 844 } : { w: 844, h: 390 });
        }
        for (let n = 1; n <= 8; n++) {
          levelIndex = n - 1 + (phone ? 8 : 0);
          await sampleChapterTransition(n, phone, true);
          t.progress((levelIndex + 1) / 16);
        }
        if (phone) probe.phoneFrame(false);
      }
      t.finish('done');
      return;
    }

    if (id === 'chapter-openings') {
      levelsTotal = 8;
      const phone = Boolean(options.phone);
      if (probe.sound().prompt) await tapToPlay();
      if (phone) { probe.phoneFrame(true); t.event('setup', 'phone layout 390x844 (touch)'); await sleep(800); }
      const feel = probe.feel;
      const cw = installCameraWatch({
        scene: () => probe.scene,
        player: () => (feel ? feel.collider.getAbsolutePosition().clone() as never : null),
        isSolid: (m) => (feel ? feel.isSolid(m) : true),
        active: () => probe.opening().phase === 'shot' || probe.opening().phase === 'glide',
        label: () => `opening ${probe.opening().level}`,
        emit: (type, detail) => t.event(type, detail),
      });
      cw.start();
      let skipMsTotal = 0;
      let insideTotal = 0;
      let blackTotal = 0;
      let movedMin = Infinity;
      const toGlideEnd = async (n: number, why: string) => {
        let black = 0;
        const until = performance.now() + 30000;
        while (probe.chapter().open && performance.now() < until) {
          const lit = await probe.worldLuma();
          if (lit < 0.03) black += 1;
          await tick();
        }
        if (probe.chapter().open) t.problem('bug', `level ${n} (${why}): the chapter card never left after the opening`);
        blackTotal += black;
        if (black) t.problem('bug', `level ${n} (${why}): ${black} mostly-black frames between the opening and the player camera`);
      };
      const begin = async (n: number) => {
        t.event('setup', `start at level ${n} directly (test shortcut)`);
        void probe.setupLevel(n);
        const until = performance.now() + 120000;
        while (probe.opening().phase !== 'shot' || probe.opening().level !== n) {
          if (performance.now() > until) throw new Error(`level ${n} never started its opening shot`);
          await tick();
        }
        const o = probe.opening();
        t.scene(`Opening ${n}: ${o.place}`);
        t.event('opening-start', { level: n, place: o.place, seconds: o.seconds, startOffsetMeters: o.scale });
        return o;
      };
      const finishLevel = async (n: number) => {
        const until = performance.now() + 90000;
        while (!(probe.running() && probe.level().id === n)) {
          if (performance.now() > until) throw new Error(`timed out waiting for level ${n} to start after its opening`);
          await tick();
        }
        const o = probe.opening();
        insideTotal += o.framesInside;
        if (o.framesInside > 0) t.problem('bug', `level ${n}: the opening lens was inside geometry on ${o.framesInside} frame(s)`);
        releaseAll();
        await sleep(400);
      };
      for (let n = 1; n <= 8; n++) {
        levelIndex = n - 1;
        await begin(n);
        const first = probe.opening();
        // The title fades in slowly once the shot moves.
        await t.until(() => probe.chapterLayout().titled, 8000, `level ${n} title to fade in`);
        await sleep(1800);
        const a = probe.opening();
        const layout = probe.chapterLayout();
        const sc = layout.scale || 1;
        const text = layout.text;
        const card = probe.chapter();
        t.event('opening-title', { level: n, kicker: card.kicker, title: card.title, line: card.line, titled: layout.titled });
        if (!card.title || !/^chapter /i.test(card.kicker)) t.problem('bug', `level ${n}: the opening shows no chapter title (${card.kicker} | ${card.title})`);
        if (!text || text.x < -1 || text.y < -1 || text.x + text.w > layout.viewport.w + 1 || text.y + text.h > layout.viewport.h + 1) {
          t.problem('bug', `level ${n}: the chapter title does not fit the screen (${text ? `${Math.round(text.x)},${Math.round(text.y)} ${Math.round(text.w)}x${Math.round(text.h)}` : 'no box'} in ${Math.round(layout.viewport.w)}x${Math.round(layout.viewport.h)})`);
        }
        const skipBox = layout.skip;
        if (!skipBox || skipBox.w / sc < 44 || skipBox.h / sc < 44) t.problem('bug', `level ${n}: the Skip button is under 44 px (${skipBox ? `${Math.round(skipBox.w / sc)}x${Math.round(skipBox.h / sc)}` : 'missing'})`);
        else if (skipBox.x < 0 || skipBox.y < 0 || skipBox.x + skipBox.w > layout.viewport.w + 1 || skipBox.y + skipBox.h > layout.viewport.h + 1) t.problem('bug', `level ${n}: the Skip button runs off the screen`);
        const lit = await probe.worldLuma();
        if (lit < 0.03) t.problem('bug', `level ${n}: the opening shot is mostly black (${lit.toFixed(2)})`);
        const move = Math.max(a.moved, a.turned * 2);
        movedMin = Math.min(movedMin, move);
        if (a.moved < 0.05 && a.turned < 0.03 && first.phase === 'shot') t.problem('bug', `level ${n}: the opening camera does not move (moved ${a.moved} m, turned ${a.turned} rad after ${a.elapsed}s)`);
        if (a.stingPlayed !== n) t.problem('bug', `level ${n}: no chapter sting played (${a.stingPlayed})`);
        t.event('opening-motion', { level: n, moved: a.moved, turned: a.turned, elapsed: a.elapsed, litShare: Math.round(lit * 100) / 100 });
        // One press (a tap on Skip with options.phone, Space on desktop) ends the shot within 0.5 s.
        const at = performance.now();
        if (phone) await tapAt(document.querySelector('.chapter-skip') as HTMLElement | null, `skip opening ${n}`);
        else await tap(' ', `skip opening ${n}`);
        let skipMs = -1;
        while (performance.now() - at < 3000) {
          if (probe.opening().phase !== 'shot') { skipMs = Math.round(performance.now() - at); break; }
          await sleep(15);
        }
        t.event('opening-skip', { level: n, ms: skipMs, phone });
        if (skipMs < 0 || skipMs > 500) t.problem('bug', `level ${n}: skip took ${skipMs < 0 ? 'more than 3 s' : `${skipMs} ms`} (under 500 ms wanted)`);
        skipMsTotal += Math.max(0, skipMs);
        await toGlideEnd(n, 'skipped');
        await finishLevel(n);
        t.add('openingsSeen');
        t.progress(n / 10);
      }
      // The natural handover, nobody pressing: the shot ends by itself and glides into the follow camera.
      for (const n of [1, 6]) {
        await begin(n);
        const until = performance.now() + 60000;
        while (probe.opening().phase === 'shot' && performance.now() < until) await tick();
        await toGlideEnd(n, 'natural');
        await finishLevel(n);
        t.event('opening-natural', { level: n, cuts: probe.opening().cuts });
        t.progress(n === 1 ? 0.95 : 1);
      }
      cw.stop();
      const sum = cw.summary();
      insideTotal += sum.inside;
      t.metric('openingSkipMs', Math.round(skipMsTotal / 8));
      t.metric('openingInsideFrames', insideTotal);
      t.metric('openingBlackFrames', blackTotal);
      t.metric('openingMovedMin', Math.round((movedMin === Infinity ? 0 : movedMin) * 100) / 100);
      t.metric('cameraInside', sum.inside);
      t.metric('cameraSnaps', sum.snaps);
      if (sum.inside > 0) t.problem('bug', `the camera detector reported ${sum.inside} frame(s) inside geometry during the openings`);
      t.finish('done');
      return;
    }

    if (id === 'chapters') {
      levelsTotal = 8;
      const seen = new Map<string, number>();
      const PLACEHOLDER = /\{[^}]*\}|undefined|null|TODO|lorem|placeholder|\bchapter\.\d|^\s*$/i;
      let skipTotal = 0;
      for (let n = 1; n <= 8; n++) {
        levelIndex = n - 1;
        const menu = probe.menu();
        if (n === 1 && menu.open && probe.level().id === 1 && menu.start && /start/i.test(menu.start)) {
          press(probe.startButton, menu.start);
        } else {
          t.event('setup', `start at level ${n} directly (test shortcut)`);
          void probe.setupLevel(n);
        }
        const until = performance.now() + 90000;
        while (!probe.chapter().open) {
          if (performance.now() > until) { t.problem('bug', `level ${n} opened with no chapter title card`); break; }
          await tick();
        }
        const card = probe.chapter();
        if (card.open) {
          await sleep(900);
          const shown = probe.chapter();
          const text = `${shown.kicker} | ${shown.title} | ${shown.line}`;
          t.scene(`Chapter card ${n}`);
          t.event('chapter-card', { level: n, kicker: shown.kicker, title: shown.title, line: shown.line });
          t.note(`Level ${n} card: ${text}`);
          if (!shown.title || !shown.line || !/^chapter /i.test(shown.kicker)) t.problem('bug', `level ${n} chapter card is incomplete: ${text}`);
          if (PLACEHOLDER.test(shown.kicker) || PLACEHOLDER.test(shown.title) || PLACEHOLDER.test(shown.line) || RAW_KEY.test(text)) {
            t.problem('bug', `level ${n} chapter card shows placeholder text: ${text}`);
          }
          const dup = seen.get(text);
          if (dup) t.problem('bug', `level ${n} reuses the chapter card of level ${dup}: ${text}`);
          seen.set(text, n);
          t.add('chapterCards');
          const at = performance.now();
          await tap(' ', `skip chapter card ${n}`);
          // Press only ends the readable hold; the card stays up until the world has painted (ready cap ~8 s).
          let closedAt = 0;
          while (probe.chapter().open && performance.now() - at < 12000) {
            if (!closedAt && probe.chapter().closing) closedAt = performance.now();
            await tick();
          }
          const secs = (performance.now() - at) / 1000;
          skipTotal += secs;
          t.event('chapter-skip', {
            level: n,
            seconds: Math.round(secs * 100) / 100,
            closingMs: closedAt ? Math.round(closedAt - at) : null,
          });
          if (!closedAt) t.problem('bug', `level ${n} chapter card did not begin closing after one press`);
          if (secs > 10) t.problem('bug', `level ${n} chapter card took ${secs.toFixed(1)} s to lift after one press`);
        }
        const run = performance.now() + 90000;
        while (!(probe.running() && probe.level().id === n)) {
          if (performance.now() > run) throw new Error(`timed out waiting for level ${n} to start after its card`);
          await tick();
        }
        releaseAll();
        await sleep(600);
        t.progress(n / 8);
      }
      t.metric('chapterSkipSeconds', Math.round((skipTotal / 8) * 100) / 100);
      t.progress(1);
      t.finish('done');
      return;
    }

    if (id === 'context-loss') {
      levelsTotal = 1;
      const g = probe.graphics();
      t.event('graphics', `memory tier ${g.memoryTier} (${g.reason}), deviceMemory ${g.deviceMemory ?? 'unknown'}, texture cap ${g.textureCap ?? 'none'}, engine max texture ${g.maxTextureSize}, low power ${g.lowPower}`);
      t.metric('textureCap', g.textureCap ?? 0);
      t.metric('maxTextureSize', g.maxTextureSize);
      if (g.memoryTier === 'low' && g.maxTextureSize > 1024) t.problem('bug', `low memory tier but textures are not capped (max ${g.maxTextureSize})`);
      const settled = async () => {
        let last = '';
        let since = performance.now();
        const until = performance.now() + 60000;
        while (performance.now() < until) {
          await sleep(500);
          const c = probe.counts();
          const key = `${c.meshes}/${c.materials}/${c.textures}/${c.animationGroups}`;
          if (key !== last) { last = key; since = performance.now(); } else if (performance.now() - since >= 3000) break;
        }
        return probe.counts();
      };
      const control = async (what: string) => {
        const until = performance.now() + 120000;
        while (!controllable()) {
          if (performance.now() > until) throw new Error(`timed out waiting for ${what}`);
          if (probe.cutscene() && probe.skipButton && !probe.skipButton.hidden) { press(probe.skipButton, 'Skip'); await sleep(800); }
          if (probe.phone().incoming) await once('f', 1500, 'answer call');
          await tick();
        }
      };
      const walk = async (what: string) => {
        const from = probe.player();
        setHeld('w');
        await sleep(2500);
        releaseAll();
        const to = probe.player();
        const moved = Math.hypot(to.x - from.x, to.z - from.z);
        t.event('walk', `${what}: moved ${moved.toFixed(2)} m`);
        return moved;
      };
      t.scene(LEVELS[0].name);
      await enterLevel(1);
      await control('level 1 control');
      t.event('level-start', LEVELS[0].name);
      const before = await walk('before the loss');
      if (before < 0.3) t.problem('bug', 'Pierce did not walk before the context loss');
      const one = await settled();
      t.metric('level1Meshes', one.meshes);
      t.metric('level1Textures', one.textures);

      // ---- lose and restore the context
      const lostAt = performance.now();
      if (!probe.contextLoss.lose()) t.problem('bug', 'WEBGL_lose_context is not available, so the context could not be lost');
      else {
        t.event('context', 'WebGL context lost (WEBGL_lose_context)');
        try {
          await t.until(() => probe.contextLoss.status().overlay, 5000, 'the Recovering overlay');
          t.event('context', `overlay: "${probe.contextLoss.status().overlayText}"`);
          if (!/recovering/i.test(probe.contextLoss.status().overlayText)) t.problem('bug', 'the overlay does not say Recovering');
        } catch { t.problem('bug', 'losing the WebGL context showed no Recovering message'); }
        await sleep(1200);
        probe.contextLoss.restore();
        t.event('context', 'WebGL context restored (WEBGL_lose_context)');
        try {
          await t.until(() => !probe.contextLoss.status().overlay && !probe.contextLoss.status().lost, 15000, 'the level to resume');
          const secs = (performance.now() - lostAt) / 1000;
          t.metric('recoverSeconds', Math.round(secs * 10) / 10);
          t.event('context', `level resumed ${secs.toFixed(1)} s after the loss${probe.contextLoss.status().restarted ? ' (restarted from the level start)' : ''}`);
        } catch { t.problem('bug', 'the Recovering message never cleared after the context came back'); }
        if (probe.menu().open && /start|retry|reload/i.test(probe.menu().start ?? '')) t.event('context', `card showing after recovery: ${probe.menu().title}`);
        await control('control after recovery');
        const after = await walk('after the recovery');
        if (after < 0.3) t.problem('bug', 'Pierce could not walk after the context came back');
      }

      // ---- level change frees the previous level
      t.scene(LEVELS[1].name);
      await enterLevel(2);
      await control('level 2 control');
      const two = await settled();
      t.metric('level2Meshes', two.meshes);
      t.metric('level2Textures', two.textures);
      t.event('counts', `level 1: meshes ${one.meshes}, materials ${one.materials}, textures ${one.textures}, animation groups ${one.animationGroups}; level 2: meshes ${two.meshes}, materials ${two.materials}, textures ${two.textures}, animation groups ${two.animationGroups}`);
      t.scene(LEVELS[0].name);
      await enterLevel(1);
      await control('level 1 again');
      const again = await settled();
      t.metric('level1AgainMeshes', again.meshes);
      t.metric('level1AgainTextures', again.textures);
      t.event('counts', `level 1 again: meshes ${again.meshes}, materials ${again.materials}, textures ${again.textures}, animation groups ${again.animationGroups}`);
      for (const key of ['meshes', 'materials', 'textures', 'animationGroups'] as const) {
        if (again[key] > one[key] * 1.05 + 10) t.problem('bug', `${key} grew from ${one[key]} to ${again[key]} after level 1 -> 2 -> 1: the previous level was not freed`);
      }
      return;
    }

    if (id === 'street-powers') {
      const outcome = await streetPowersRun();
      t.finish(outcome);
      return;
    }

    if (id === 'crowd-shadow') {
      const outcome = await crowdShadowRun();
      t.finish(outcome);
      return;
    }

    if (id === 'scene-audit') {
      levelsTotal = 4;
      if (probe.sound().prompt) await tapToPlay();
      const only = Number(options.level) || 0;
      const plan: { n: number; seconds: number }[] = [
        { n: 5, seconds: 70 }, { n: 6, seconds: 90 }, { n: 7, seconds: 60 }, { n: 8, seconds: 60 },
      ].filter((p) => !only || p.n === only);
      let started = 0;
      for (const { n, seconds } of plan) {
        t.scene(`scene-audit L${n}`);
        if (n === 7) await probe.setupHidden('the-train');
        else await probe.setupLevel(n);
        await t.until(() => probe.running() && probe.level().id === n, 90000, `level ${n} running`);
        const t0 = performance.now();
        let sawScene = false;
        while ((performance.now() - t0) / 1000 < seconds) {
          await tick();
          if (probe.cutscene() || probe.scripted()) sawScene = true;
          // A scene that ended and gave control back is done: the rest of the window is not the audit's.
          if (sawScene && controllable()) break;
        }
        if (!sawScene) t.problem('bug', `level ${n}: no scene started by itself within ${seconds} s`);
        else {
          started += 1;
          if (!controllable()) t.problem('bug', `level ${n}: its scene was still running after ${seconds} s with no Skip`);
        }
        levelIndex += 1;
        t.progress(levelIndex / plan.length);
      }
      t.metric('scenesStartedLevels', started);
      t.finish(started === plan.length ? 'done' : 'error');
      return;
    }

    if (id === 'scenes-no-skip') {
      levelsTotal = 1;
      if (probe.sound().prompt) await tapToPlay();
      t.scene('The Desk, hands off');
      await enterLevel(4);
      await waitControl('The Desk');
      const t0 = performance.now();
      let mirrorAt = -1;
      let sceneAt = -1;
      let doneAt = -1;
      let papersSeen = false;
      let walkClipWhileHeld = 0;
      let lastPos = probe.player();
      while (performance.now() - t0 < 150000) {
        await tick();
        const d = probe.desk?.();
        if (!d) break;
        const now = (performance.now() - t0) / 1000;
        if (d.mirror.thatsMe && mirrorAt < 0) { mirrorAt = now; t.event('mirror-done', `${now.toFixed(1)} s, no input`); }
        if ((d.phase === 'arrive' || d.phase === 'sweep' || d.phase === 'going') && sceneAt < 0) { sceneAt = now; t.event('desk-scene', `${now.toFixed(1)} s`); }
        if (d.phase === 'sweep' || d.phase === 'going') {
          const meshes = probe.scene.meshes.filter((m) => /^desk-paper-\d$/.test(m.name));
          if (meshes.some((m) => m.isEnabled() && m.isVisible)) papersSeen = true;
          const p = probe.player();
          const moved = Math.hypot(p.x - lastPos.x, p.z - lastPos.z);
          if (moved < 0.001 && /walk/i.test(String(probe.motion?.()?.clip ?? ''))) walkClipWhileHeld += 1;
          lastPos = p;
        }
        if (d.phase === 'done') { doneAt = now; break; }
      }
      t.metric('deskMirrorSeconds', Math.round(mirrorAt));
      t.metric('deskSceneSeconds', Math.round(sceneAt));
      t.metric('deskTotalSeconds', Math.round(doneAt));
      if (mirrorAt < 0) t.problem('bug', 'the mirror beat never ended on its own (no input, no Skip) within 150 s');
      if (sceneAt < 0) t.problem('bug', 'the desk scene never started on its own');
      if (sceneAt >= 0 && !papersSeen) t.problem('bug', 'no papers on the desk during the desk scene');
      if (walkClipWhileHeld > 3) t.problem('bug', 'the walk clip played while Pierce stood still in the desk scene');
      if (doneAt < 0) t.problem('bug', 'the desk scene did not end on its own within 150 s (only Skip ended it)');
      t.progress(1);
      t.finish(doneAt >= 0 && mirrorAt >= 0 ? 'done' : 'error');
      return;
    }

    if (id === 'desk-beats') {
      const outcome = await deskBeatsRun();
      t.finish(outcome);
      return;
    }

    if (id === 'vat-acid') {
      const outcome = await vatAcidRun();
      t.progress(1);
      t.finish(outcome);
      return;
    }

    if (id === 'rain-city') {
      const outcome = await rainCityRun();
      t.finish(outcome);
      return;
    }

    if (id === 'b3-horror-light') {
      const outcome = await b3HorrorLightRun();
      t.finish(outcome);
      return;
    }

    if (id === 'quiet-light') {
      const outcome = await quietLightRun();
      t.finish(outcome);
      return;
    }

    if (id === 'b3-retry') {
      await b3RetryRun();
      return;
    }

    if (id === 'analytics') {
      levelsTotal = 1;
      const ha = window.hawkesAnalytics;
      const cfg = ha.config();
      const build = cfg.build ?? {};
      t.event('analytics', `product ${cfg.product}, env ${cfg.env}, build ${build.version ?? '?'} ${build.commit ?? '?'} ${build.date ?? ''}, debug ${cfg.debug}`);
      if (!build.version || !build.commit) t.problem('bug', `analytics: the build is incomplete (${JSON.stringify(build)}); window.HAWKES_BUILD should come from the real build`);
      const counts: Record<string, number> = {};
      let logged = 0;
      const brief = (props: Record<string, unknown> | undefined) => Object.entries(props ?? {})
        .filter(([, v]) => v != null && typeof v !== 'object')
        .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
        .join(' ');
      const drain = () => {
        const log = ha.debugLog;
        for (; logged < log.length; logged++) {
          const e = log[logged];
          counts[e.name] = (counts[e.name] ?? 0) + 1;
          if (e.name === 'perf' || e.name === 'exit') continue;
          t.event(`analytics:${e.name}`, `${brief(e.props)}${e.ctx?.level ? ` [level ${e.ctx.level}]` : ''}`);
        }
        const sent = log.filter((e) => e.sent).length;
        t.metric('analyticsEvents', log.length);
        t.metric('analyticsSent', sent);
      };
      const timer = window.setInterval(drain, 1000);
      let outcome: Outcome;
      try {
        await enterLevel(1);
        t.scene(LEVELS[0].name);
        outcome = await playLevel(1);
        await t.until(() => !!document.querySelector('[data-hawkes-ask]'), 10000, 'the feedback card').catch(() => undefined);
        const card = document.querySelector('[data-hawkes-ask]');
        const question = card?.shadowRoot?.querySelector('.ha-q')?.textContent ?? '';
        if (card) {
          t.scene('Level Complete + feedback card');
          t.event('feedback-card', question || card.getAttribute('data-hawkes-ask') || 'shown');
        } else {
          t.problem('bug', 'analytics: no feedback card after the level 1 Level Complete card');
        }
        await sleep(4000); // hold it for the footage
        ha.flush();
        await sleep(600);
      } finally {
        window.clearInterval(timer);
        drain();
      }
      for (const name of ['game_ready', 'level_start', 'progress', 'video', 'level_end']) {
        if (!counts[name]) t.problem('bug', `analytics: no ${name} event in level 1`);
      }
      t.metric('analyticsProgress', counts.progress ?? 0);
      t.metric('analyticsVideo', counts.video ?? 0);
      t.progress(1);
      t.finish(outcome);
      return;
    }

    if (id === 'living-places') {
      const outcome = await livingPlacesRun();
      t.progress(1);
      t.finish(outcome);
      return;
    }

    if (id === 'apex-slice') {
      const outcome = await apexSliceRun();
      t.progress(1);
      t.finish(outcome);
      return;
    }

    if (id === 'train-chase') {
      const outcome = await trainChaseRun();
      t.progress(1);
      t.finish(outcome);
      return;
    }

    if (id === 'level-7') {
      const outcome = await trainStoryRun();
      t.progress(1);
      t.finish(outcome);
      return;
    }

    if (id === 'ledger-city') {
      levelsTotal = 1;
      const phone = Boolean(options.phone);
      if (probe.sound().prompt) await tapToPlay();
      if (phone) { probe.phoneFrame(true); t.event('setup', 'phone layout 390x844 (touch)'); await sleep(800); }
      const byId = (name: string) => document.getElementById(name) as HTMLElement | null;
      // ---- Part 1: Going Home. Three bystanders by Shadow Shock; the city must answer within 20 s of the second.
      t.scene('Going Home: the ledger');
      await enterLevel(5);
      await waitControl('Going Home');
      for (let i = 0; i < 120 && probe.scripted(); i += 1) {
        if (probe.skipButton && !probe.skipButton.hidden) press(probe.skipButton, 'Skip');
        await sleep(400);
      }
      await t.until(() => probe.running() && !probe.scripted(), 30000, 'control on the street');
      probe.ledger?.({ kills: 0, possessions: 0, consumes: 0, witnesses: 0, reported: 0 });
      t.event('ledger', `start ${JSON.stringify(probe.ledger?.())}`);
      probe.grantShock?.();
      await sleep(500);
      if (!probe.shadow().on) await tapAt(byId('shadowHint'), 'Shadow');
      await sleep(500);
      const zone = byId('leftStickZone');
      let down = false;
      const stick = (ux: number, uy: number) => {
        if (!zone) return;
        const zr = zone.getBoundingClientRect();
        const type = down ? 'pointermove' : 'pointerdown';
        down = true;
        zone.dispatchEvent(new PointerEvent(type, { pointerId: 29, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: zr.left + zr.width / 2 + ux * zr.width * 0.38, clientY: zr.top + zr.height / 2 + uy * zr.height * 0.38 }));
      };
      const lift = () => { if (down && zone) zone.dispatchEvent(new PointerEvent('pointerup', { pointerId: 29, pointerType: 'touch', bubbles: true })); down = false; };
      const toward = (to: Point) => {
        const from = probe.player();
        const heading = Math.atan2(to.x - from.x, to.z - from.z);
        if (phone) { const rel = wrap(heading - probe.cameraYaw()); stick(Math.sin(rel), -Math.cos(rel)); } else steer(to, true);
      };
      const halt = () => { if (phone) lift(); else releaseAll(); };
      const killsNow = () => probe.ledger?.().kills ?? 0;
      const started = performance.now();
      let secondAt = -1;
      let guard = 0;
      while (killsNow() < 3 && performance.now() - started < 240000) {
        await tick();
        if (probe.menu().open) break;
        const p = probe.player();
        const mark = probe.people().filter((x) => x.kind === 'person').sort((a, b) => dist(p, a) - dist(p, b))[0];
        if (!mark) { toward({ x: p.x + 12, z: 21.5 }); continue; }
        if (dist(p, mark) > 4.2) { toward(mark); continue; }
        halt();
        face(Math.atan2(mark.x - p.x, mark.z - p.z));
        await sleep(250);
        await tapAt(byId('fireBtn'), 'Shadow Shock');
        await sleep(900);
        guard += 1;
        if (secondAt < 0 && killsNow() >= 2) { secondAt = performance.now(); t.event('kills', `2 bystanders down after ${guard} shocks`); }
      }
      halt();
      const after = probe.ledger?.();
      t.event('ledger', `after the street ${JSON.stringify(after)}`);
      t.metric('ledgerKills', after?.kills ?? 0);
      t.metric('ledgerWitnesses', after?.witnesses ?? 0);
      t.metric('ledgerPossessions', after?.possessions ?? 0);
      if (killsNow() < 2) t.problem('bug', `could not drop 2 bystanders on the street (kills ${killsNow()})`);
      // The siren starts at once; the car must stop beside him inside 20 s of the second kill.
      await t.until(() => (probe.heat?.().carArrivedAt ?? -1) >= 0, 24000, 'the police car to arrive');
      const heat = probe.heat?.();
      t.event('police', `siren at ${heat?.sirenAt.toFixed(1)} s, car spawned ${heat?.carSpawnedAt.toFixed(1)} s, car arrived ${heat?.carArrivedAt.toFixed(1)} s (street clock), witnesses ${heat?.witnesses}`);
      t.metric('sirenToCarSeconds', Math.round((heat?.sirenToCarSeconds ?? -1) * 10) / 10);
      if (!heat || heat.sirenAt < 0) t.problem('bug', 'two kills did not start the siren');
      else if (heat.sirenToCarSeconds < 0 || heat.sirenToCarSeconds > 20) t.problem('bug', `the police car came ${heat.sirenToCarSeconds.toFixed(1)} s after the siren (must be within 20 s)`);
      // ---- Part 2: The Morning, once with the 3-kill ledger, once with none. Same bot, same inputs; what differs is what it hears and reads.
      type Pass = { kills: number; band: number; report: string; paper: string; tv: string; vossLines: string[]; subtitleSizes: number[]; subtitleInView: boolean };
      const morningPass = async (kills: number): Promise<Pass> => {
        probe.ledger?.({ kills });
        await probe.setupLevel(8);
        await t.until(() => probe.running() && probe.level().libraryId === 'the-morning' && !probe.menu().open, 90000, 'level 8 to start');
        const vossLines: string[] = [];
        const sizes: number[] = [];
        let inView = true;
        let readPaper = false;
        const t0 = performance.now();
        let last = '';
        for (;;) {
          await tick();
          if (performance.now() - t0 > 280000) break;
          if (probe.menu().open) break;
          const sub = probe.subtitle();
          if (sub.text) {
            const el = document.getElementById('cineText');
            if (el) {
              const r = el.getBoundingClientRect();
              sizes.push(parseFloat(getComputedStyle(el).fontSize));
              if (r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) inView = false;
            }
          }
          const s = probe.morning();
          if (s && s.beat !== last) { last = s.beat; t.event('beat', `ledger pass kills=${kills}: ${s.beat}`); }
          if (s && s.callDone && readPaper) break;
          if (probe.scripted()) { releaseAll(); continue; }
          if (!probe.running()) continue;
          const phoneState = probe.phone();
          if (phoneState.incoming) {
            releaseAll();
            if (phone) await tapAt(byId('phoneAnswer'), 'Answer'); else await once('f', 1500, 'answer call');
            continue;
          }
          if (phoneState.busy) { releaseAll(); if (phoneState.line && vossLines[vossLines.length - 1] !== phoneState.line) vossLines.push(phoneState.line); continue; }
          const label = probe.action();
          if (label && label !== 'Leave') {
            releaseAll();
            if (label === 'Read the paper') readPaper = true;
            if (phone) await tapAt(byId('interactBtn'), label); else await once('e', 1200, label);
            continue;
          }
          if (s?.callDone && !readPaper) { const spot = { x: 3.2, z: -0.4 }; await walkTo(spot, 'paper', 0.5); continue; }
          const obj = probe.objective();
          if (!obj.target) { releaseAll(); continue; }
          await walkTo(obj.target, `${obj.title || 'objective'}: ${obj.text.slice(0, 40)}`, 0.3);
        }
        releaseAll();
        const s = probe.morning();
        return { kills, band: s?.band ?? -1, report: s?.report ?? '', paper: s?.paper ?? '', tv: s?.tvText ?? '', vossLines, subtitleSizes: sizes, subtitleInView: inView };
      };
      const loud = await morningPass(3);
      const quiet = await morningPass(0);
      for (const pass of [loud, quiet]) {
        t.event('morning', `kills ${pass.kills}: band ${pass.band}, TV report ${pass.report}, paper "${pass.paper.replace(/\n/g, ' / ')}", ticker/tv text "${pass.tv.slice(0, 120)}", ${pass.vossLines.length} Voss lines heard`);
        t.metric(`morningBand_${pass.kills}kills`, pass.band);
      }
      if (loud.report === quiet.report) t.problem('bug', `the TV played the same report for 0 and 3 kills (${loud.report})`);
      if (loud.paper === quiet.paper) t.problem('bug', 'the newspaper headline did not change between 0 and 3 kills');
      const differing = loud.vossLines.filter((l) => !quiet.vossLines.includes(l)).length;
      t.metric('vossLinesDiffering', differing);
      if (differing < 1) t.problem('bug', 'Voss\'s morning call played no different line for 0 and 3 kills');
      if (!loud.paper) t.problem('bug', 'the newspaper was never read (Read the paper did not show at the table)');
      const small = Math.min(...loud.subtitleSizes, 99);
      t.metric('captionMinPx', small === 99 ? 0 : Math.round(small));
      if (phone && small < 13) t.problem('bug', `a caption is ${small}px at 390x844 (too small to read)`);
      if (!loud.subtitleInView) t.problem('bug', 'a caption ran off the screen at this size');
      t.progress(1);
      t.finish('done');
      return;
    }

    if (id === 'level-8') {
      const outcome = await morningRun();
      t.progress(1);
      t.finish(outcome);
      return;
    }

    if (id === 'level-8-ending') {
      const outcome = await morningEndingRun();
      t.progress(1);
      t.finish(outcome);
      return;
    }

    if (id === 'level-8-release') {
      const outcome = await morningReleaseRun();
      t.progress(1);
      t.finish(outcome);
      return;
    }

    if (id === 'level-7-release') {
      const outcome = await releaseRun();
      t.progress(1);
      t.finish(outcome);
      return;
    }

    if (id === 'train') {
      const outcome = await trainRun();
      t.progress(1);
      t.finish(outcome);
      return;
    }

    if (id === 'phone-b3') {
      // Progress: phone checks, About, then B3 as the second half.
      levelsTotal = 2;
      await phoneChecks();
      t.progress(0.3);
      await aboutCheck();
      t.progress(0.45);
      const outcome = await earlyDownB3();
      t.progress(1);
      t.finish(outcome);
      return;
    }

    if (smoke) {
      levelsTotal = 1;
      const finishLevelRun = (outcome: Outcome) => {
        const secs = (performance.now() - smokeT0) / 1000;
        t.metric(`smokeL${smokeN}Seconds`, Math.round(secs));
        t.event('smoke-end', `level ${smokeN} ${outcome} in ${secs.toFixed(0)} s (budget ${SMOKE_SECONDS} s)`);
        if (secs > SMOKE_SECONDS) t.problem('bug', `smoke level ${smokeN} took ${secs.toFixed(0)} s, over its ${SMOKE_SECONDS} s budget`);
        const hitchOk = publishFrameTrace(t, `smoke-l${smokeN}`);
        t.progress(1);
        // A post-grace frame over 100 ms fails the smoke by number (hitchFailOver100).
        const final: Outcome = outcome === 'won' || outcome === 'done'
          ? (hitchOk ? outcome : 'lost')
          : outcome;
        t.finish(final);
      };
      try {
        let outcome: Outcome;
        if (smokeN === 8) {
          outcome = await morningRun();
        } else if (smokeN === 7) {
          t.event('setup', 'start level 7, The Train, directly (test shortcut)');
          await probe.setupHidden('the-train');
          outcome = await trainStoryRun(true);
        } else {
          await enterLevel(smokeN);
          // Hitch grace after control (chapter card / warm excluded).
          frameTrace.reset();
          outcome = await playLevel(smokeN);
        }
        finishLevelRun(outcome);
      } catch (e) {
        if (!(e instanceof SmokeStuck)) throw e;
        releaseAll();
        t.problem('bug', e.message);
        t.event('stuck', e.message);
        finishLevelRun('stuck');
      }
      return;
    }

    if (id === 'world-events') {
      // Levels 1, 3, 5, 6 and 8: each chapter's ending event, as a 390x844 touch phone unless options.phone is false.
      if (options.phone !== false) { probe.phoneFrame(true); t.event('setup', 'phone layout 390x844 (touch)'); await sleep(300); }
      levelsTotal = 5;
      let outcome: Outcome = 'won';
      for (const n of [1, 3, 5, 6]) {
        await enterLevel(n);
        outcome = await playLevel(n);
        levelIndex += 1;
        if (outcome !== 'won' && outcome !== 'done') break;
      }
      if (outcome === 'won' || outcome === 'done') outcome = await morningRun(true).catch(() => 'lost' as Outcome);
      t.progress(1);
      t.finish(outcome);
      return;
    }

    const m = /^level-(\d)$/.exec(id);
    if (m) {
      if (options.phone) { probe.phoneFrame(true); t.event('setup', 'phone layout 390x844 (touch)'); await sleep(300); }
      const n = Number(m[1]);
      levelsTotal = 1;
      await enterLevel(n);
      const outcome = await playLevel(n);
      t.progress(1);
      t.finish(outcome);
    }
  };

  // ------------------------------------------------------------ sound-settings

  const soundSettingsRun = async (
    t: Tracker,
    tapAt: (el: HTMLElement | null, label: string) => Promise<void>,
    tapToPlay: () => Promise<void>,
    sleep: (ms: number) => Promise<void>,
    enterLevel: (n: number) => Promise<void>,
    options: RunOptions,
  ) => {
    const byId = (id: string) => document.getElementById(id);
    const saved = () => {
      try { return JSON.parse(localStorage.getItem(SOUND_KEY) ?? 'null') as { on: boolean; music: number; sfx: number } | null; } catch { return null; }
    };
    const carried = (() => {
      try { return JSON.parse(sessionStorage.getItem(SOUND_RUN_KEY) ?? 'null') as { original: string | null; events: { type: string; detail?: string }[] } | null; } catch { return null; }
    })();
    const checkPrompt = (where: string) => {
      const prompt = byId('tapToPlay');
      if (!probe.sound().prompt || !prompt) { t.problem('bug', `no Tap to play prompt ${where}`); return; }
      const r = prompt.getBoundingClientRect();
      if (r.width < innerWidth - 1 || r.height < innerHeight - 1) t.problem('bug', `the Tap to play prompt does not fill the screen ${where} (${Math.round(r.width)}x${Math.round(r.height)} of ${innerWidth}x${innerHeight})`);
      t.event('prompt-shown', `${where}, ${innerWidth}x${innerHeight} ${innerWidth > innerHeight ? 'landscape' : 'portrait'}`);
    };
    const prompt0Text = () => byId('tapToPlay')?.firstElementChild as HTMLElement | null;
    const checkRunning = async (where: string) => {
      try {
        await t.until(() => probe.sound().context === 'running', 5000, 'the AudioContext to run');
        t.event('audio-running', `AudioContext ${probe.sound().context} ${where}`);
      } catch {
        t.problem('bug', `the AudioContext is "${probe.sound().context}" after the tap ${where}`);
      }
    };
    const slide = (input: HTMLInputElement, percent: number, label: string) => {
      // A range input has no drag a page can fake; set it as a drag ends and send the same events.
      input.value = String(percent);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      t.add('interactions');
      t.log(`slide ${label} to ${percent}%`);
    };

    if (!carried) {
      t.scene('Tap to play');
      checkPrompt('on load');
      await sleep(1200);
      await tapToPlay();
      await checkRunning('after the first tap');
      // The splash text must not ghost over the title card's rows while the splash fades out.
      await sleep(60);
      const splashText = prompt0Text();
      if (splashText && Number(getComputedStyle(splashText).opacity) > 0.05) {
        t.problem('bug', 'the Tap to play splash text is still visible over the title card after the tap');
      } else t.event('splash-text-gone', 'text hidden while the splash backdrop fades');
      t.progress(0.15);

      t.scene('Title');
      await sleep(500);
      await tapAt(byId('settingsBtn'), 'Settings (title)');
      await t.until(() => probe.sound().settingsOpen, 3000, 'Settings to open from the title');
      t.scene('Settings');
      t.event('settings-open', 'from the title');
      const original = localStorage.getItem(SOUND_KEY);
      if (!probe.sound().settings.on) await tapAt(byId('soundSwitch'), 'Sound on');
      await sleep(400);
      await tapAt(byId('soundSwitch'), 'Sound off');
      slide(byId('musicVolume') as HTMLInputElement, 40, 'Music');
      await sleep(800);
      const now = saved();
      if (!now || now.on !== false || Math.abs(now.music - 0.4) > 0.001) t.problem('bug', `hawkes.sound did not save Sound off and Music 40%: ${JSON.stringify(now)}`);
      else t.event('setting-saved', JSON.stringify(now));
      if (probe.sound().settings.on !== false) t.problem('bug', 'Sound off did not apply right away');
      t.progress(0.35);
      await tapAt(byId('settingsDoneBtn'), 'Done');
      await sleep(400);

      sessionStorage.setItem(SOUND_RUN_KEY, JSON.stringify({ original, events: [{ type: 'setting-saved', detail: JSON.stringify(now) }] }));
      t.event('reload', 'the page reloads; the run carries on after it');
      const url = new URL(location.href);
      url.searchParams.set('playtest', 'sound-settings');
      url.searchParams.set('seed', String(options.seed ?? 1));
      url.searchParams.set('speed', String(options.speed ?? 1));
      await sleep(300);
      location.replace(url.toString());
      await new Promise(() => {}); // the page is going away
      return;
    }

    sessionStorage.removeItem(SOUND_RUN_KEY);
    for (const e of carried.events) t.event(`before-reload:${e.type}`, e.detail);
    t.scene('Tap to play (after reload)');
    checkPrompt('after the reload');
    await sleep(1000);
    await tapToPlay();
    await checkRunning('after the reload');
    t.progress(0.5);

    const back = probe.sound().settings;
    if (back.on !== false || Math.abs(back.music - 0.4) > 0.001) t.problem('bug', `the setting did not survive the reload: ${JSON.stringify(back)}`);
    else t.event('setting-survived-reload', JSON.stringify(back));
    t.scene('Title');
    await tapAt(byId('settingsBtn'), 'Settings (title)');
    await t.until(() => probe.sound().settingsOpen, 3000, 'Settings to open after the reload');
    t.scene('Settings (after reload)');
    const shows = `${byId('soundSwitch')?.textContent} / Music ${(byId('musicVolume') as HTMLInputElement).value}%`;
    if (shows !== 'Off / Music 40%') t.problem('bug', `Settings shows "${shows}" after the reload, not Off / Music 40%`);
    else t.event('settings-shows-saved', shows);
    await sleep(1500);
    await tapAt(byId('soundSwitch'), 'Sound on');
    slide(byId('musicVolume') as HTMLInputElement, 100, 'Music');
    if (saved()?.on !== true) t.problem('bug', 'Sound on did not save');
    await tapAt(byId('settingsDoneBtn'), 'Done');
    t.progress(0.65);

    await enterLevel(1);
    t.scene(LEVELS[0].name);
    await sleep(3000);
    await t.until(() => !(byId('pauseBtn') as HTMLButtonElement).hidden, 20000, 'the Pause button');
    await tapAt(byId('pauseBtn'), 'Pause');
    await t.until(() => probe.sound().paused, 3000, 'Pause');
    t.scene('Paused');
    t.event('paused');
    await sleep(800);
    await tapAt(byId('pauseSettingsBtn'), 'Settings (pause)');
    await t.until(() => probe.sound().settingsOpen, 3000, 'Settings to open from Pause');
    t.scene('Settings (pause)');
    t.event('settings-open', 'from pause');
    slide(byId('sfxVolume') as HTMLInputElement, 70, 'Effects & voice');
    if (Math.abs((saved()?.sfx ?? 0) - 0.7) > 0.001) t.problem('bug', 'Effects & voice did not save from Pause');
    else t.event('setting-saved', JSON.stringify(saved()));
    await sleep(1200);
    await tapAt(byId('settingsDoneBtn'), 'Done');
    await tapAt(byId('resumeBtn'), 'Resume');
    await t.until(() => !probe.sound().paused, 3000, 'Resume');
    t.event('resumed');
    t.progress(0.95);
    await sleep(1500);

    if (carried.original === null) localStorage.removeItem(SOUND_KEY);
    else localStorage.setItem(SOUND_KEY, carried.original);
    t.progress(1);
    t.finish('done');
  };

  // ------------------------------------------------------------ ui-style

  const uiStyleRun = async (
    t: Tracker,
    tapAt: (el: HTMLElement | null, label: string) => Promise<void>,
    tapToPlay: () => Promise<void>,
    sleep: (ms: number) => Promise<void>,
    enterLevel: (n: number) => Promise<void>,
  ) => {
    const byId = (id: string) => document.getElementById(id);
    const HOUSE = /barlow condensed|cormorant garamond|ui-monospace|sfmono|menlo|consolas|monospace|arial narrow/i;
    const root = byId('game-root') ?? document.body;
    const audit = (screen: string, vp: string) => {
      const fonts = new Map<string, number>();
      const bad: string[] = [];
      const clipped: string[] = [];
      let n = 0;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? '').trim();
        const el = node.parentElement;
        if (!text || !el || el.closest('[hidden], .hidden, #devPanel, #devToggle, #perfMonitor, .perf-monitor')) continue;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05 || r.width < 1 || r.height < 1) continue;
        // Skip anything under a card that is not the one on top (title card sits beneath Pause, and so on).
        const probeX = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
        const probeY = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
        const top = document.elementFromPoint(probeX, probeY);
        if (top && !(top === el || el.contains(top) || top.contains(el))) continue;
        n++;
        const family = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
        fonts.set(family, (fonts.get(family) ?? 0) + 1);
        if (!HOUSE.test(cs.fontFamily.split(',')[0])) bad.push(`"${text.slice(0, 24)}" in ${family}`);
        const label = `"${text.slice(0, 28)}"`;
        if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 && !el.closest('.message, .overlay-card') ) clipped.push(`${label} leaves the screen`);
        let box: HTMLElement | null = el;
        for (let depth = 0; box && depth < 4; depth++, box = box.parentElement) {
          const bs = getComputedStyle(box);
          const clips = bs.overflowX === 'hidden' || bs.overflowX === 'clip';
          if (clips && box.scrollWidth > box.clientWidth + 1 && bs.textOverflow !== 'ellipsis' && !box.matches('.credit-roll, .level-credits, .credit-roll *')) {
            clipped.push(`${label} is cut off in .${box.className.toString().split(' ')[0] || box.tagName.toLowerCase()} (${box.scrollWidth}px in ${box.clientWidth}px)`);
            break;
          }
        }
      }
      const gold = getComputedStyle(document.documentElement).getPropertyValue('--hb-gold').trim();
      t.event('ui-screen', `${screen} @ ${vp}: ${n} text runs, fonts ${[...fonts].map(([f, c]) => `${f} x${c}`).join(', ')}, accent ${gold}`);
      for (const b of bad.slice(0, 5)) t.problem('bug', `${screen} @ ${vp}: text outside the house fonts: ${b}`);
      for (const c of clipped.slice(0, 5)) t.problem('bug', `${screen} @ ${vp}: clipped text: ${c}`);
      t.add('uiScreens');
    };

    /** Touch layout: every touch control (and the HUD readouts beside them) at one phone size. */
    const TOUCH_CONTROLS = ['interactBtn', 'fireBtn', 'jumpBtn', 'phoneBtn', 'leftStickZone', 'rightStickZone', 'pauseBtn', 'missionsHint',
      'sidearmHint', 'abilityHint', 'shadowHint', 'lightHint', 'medkitHint', 'phoneHint', 'inventoryHint', 'reloadHint', 'lostHint'];
    const TOUCH_HUD = ['objectiveHud', 'abilityReadout'];
    const touchAudit = async (w: number, h: number) => {
      const vp = `${w}x${h}`;
      probe.phoneFrame(true, w > h, { w, h });
      await sleep(900);
      t.scene(`Touch layout (${vp})`);
      // Worst case: every conditional control showing at once (layout only, nothing is pressed).
      const forced = ['interactBtn', 'abilityHint', 'shadowHint', 'lostHint', 'reloadHint', 'abilityReadout']
        .map((id) => byId(id)).filter((el): el is HTMLElement => !!el && el.hidden);
      for (const el of forced) el.hidden = false;
      await sleep(300);
      const rootBox = root.getBoundingClientRect();
      const k = rootBox.width / (root as HTMLElement).offsetWidth || 1;
      const probeEl = document.createElement('div');
      probeEl.style.cssText = 'position:absolute;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
      root.appendChild(probeEl);
      const cs = getComputedStyle(probeEl);
      const inset = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
      probeEl.remove();
      type Box = { id: string; l: number; t: number; r: number; b: number; control: boolean };
      const boxes: Box[] = [];
      for (const id of [...TOUCH_CONTROLS, ...TOUCH_HUD]) {
        const el = byId(id);
        if (!el) { t.problem('bug', `${vp}: #${id} is missing`); continue; }
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || el.hidden) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        boxes.push({ id, l: (r.left - rootBox.left) / k, t: (r.top - rootBox.top) / k, r: (r.right - rootBox.left) / k, b: (r.bottom - rootBox.top) / k, control: TOUCH_CONTROLS.includes(id) });
      }
      let bad = 0;
      for (const b of boxes) {
        if (b.control && (b.r - b.l < 43.5 || b.b - b.t < 43.5)) { bad++; t.problem('bug', `${vp}: #${b.id} is ${Math.round(b.r - b.l)}x${Math.round(b.b - b.t)} px, under 44`); }
        if (b.l < inset.l - 0.5 || b.t < inset.t - 0.5 || b.r > w - inset.r + 0.5 || b.b > h - inset.b + 0.5) { bad++; t.problem('bug', `${vp}: #${b.id} leaves the safe area`); }
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], c = boxes[j];
        if (!a.control && !c.control) continue;
        if (a.l < c.r - 0.5 && c.l < a.r - 0.5 && a.t < c.b - 0.5 && c.t < a.b - 0.5) { bad++; t.problem('bug', `${vp}: #${a.id} overlaps #${c.id}`); }
      }
      for (const el of forced) el.hidden = true;
      t.event('touch-layout', `${vp}: ${boxes.filter((b) => b.control).length} touch controls checked, ${bad} problems, safe inset ${inset.t}/${inset.r}/${inset.b}/${inset.l}`);
      t.add('touchLayouts');
    };

    const pass = async (vp: string, touch = false) => {
      if (probe.menu().title === 'PH Origins') {
        t.scene(`Title (${vp})`);
        await sleep(800);
        audit('Title', vp);
        await tapAt(byId('settingsBtn'), 'Settings (title)');
        await t.until(() => probe.sound().settingsOpen, 3000, 'Settings to open');
        t.scene(`Settings (${vp})`);
        await sleep(800);
        audit('Settings', vp);
        await tapAt(byId('settingsDoneBtn'), 'Done');
        await sleep(500);
      } else {
        t.scene(`Defeat card (${vp})`);
        audit('Card', vp);
      }
      await enterLevel(1);
      t.scene(`HUD (${vp})`);
      await t.until(() => !(byId('pauseBtn') as HTMLButtonElement).hidden, 30000, 'the Pause button');
      await t.until(() => !!byId('objectiveHud')?.classList.contains('visible'), 30000, 'the objective');
      await sleep(1500);
      audit('HUD', vp);
      if (touch) {
        await touchAudit(390, 844);
        await touchAudit(844, 390);
        await touchAudit(667, 375);
        probe.phoneFrame(true);
        await sleep(900);
      }
      await tapAt(byId('pauseBtn'), 'Pause');
      await t.until(() => probe.sound().paused, 3000, 'Pause');
      t.scene(`Paused (${vp})`);
      await sleep(800);
      audit('Pause', vp);
      await tapAt(byId('pauseSettingsBtn'), 'Settings (pause)');
      await t.until(() => probe.sound().settingsOpen, 3000, 'Settings from Pause');
      await sleep(600);
      audit('Pause settings', vp);
      await tapAt(byId('settingsDoneBtn'), 'Done');
      await tapAt(byId('resumeBtn'), 'Resume');
      await t.until(() => !probe.sound().paused, 3000, 'Resume');
      await sleep(600);
      if (!probe.forceDefeat()) throw new Error('could not down Pierce for the Defeat card');
      t.event('defeat', 'test shortcut');
      await t.until(() => probe.menu().title === 'Defeat', 30000, 'the Defeat card');
      await sleep(1500);
      t.scene(`Defeat (${vp})`);
      audit('Defeat', vp);
    };

    t.scene('Title');
    await pass(`${innerWidth}x${innerHeight}`);
    t.progress(0.5);
    probe.phoneFrame(true);
    t.event('setup', 'phone layout 390x844');
    await sleep(1500);
    await pass('390x844', true);
    probe.phoneFrame(false);
    t.progress(1);
    t.finish('done');
  };

  // ------------------------------------------------------------ load-error

  const loadErrorRun = async (
    t: Tracker,
    tapAt: (el: HTMLElement | null, label: string) => Promise<void>,
    tapToPlay: () => Promise<void>,
    sleep: (ms: number) => Promise<void>,
    options: RunOptions,
  ) => {
    const ERROR_TITLE = "Couldn't start the game";
    const carried = (() => {
      try { return JSON.parse(sessionStorage.getItem(LOAD_ERROR_RUN_KEY) ?? 'null') as { events: { type: string; detail?: string }[] } | null; } catch { return null; }
    })();
    const errorFlag = () => document.documentElement.getAttribute('data-load-error');
    /** The title card is at START (or Continue, with a save) and shows no error. */
    const checkStartCard = (where: string) => {
      const menu = probe.menu();
      const ok = menu.open && menu.title === 'PH Origins' && !!menu.start && /^(start|continue)$/i.test(menu.start) && menu.startEnabled && !errorFlag();
      if (!ok) t.problem('bug', `the title card is not at START ${where}: "${menu.title}" / "${menu.start}"${errorFlag() ? ` (load error: ${errorFlag()})` : ''}`);
      else t.event('start-card', `${where}: ${menu.start}, no error`);
      return ok;
    };
    const play = async () => {
      await tapAt(probe.startButton, probe.menu().start ?? 'Start');
      await t.until(() => probe.running() && !probe.menu().open, 60000, 'the level to start');
      t.scene(probe.level().name);
      t.event('level-start', probe.level().name);
      await sleep(2500);
    };

    if (!carried) {
      if (probe.sound().prompt) await tapToPlay();
      t.scene('Title (normal load)');
      await sleep(800);
      checkStartCard('on a normal load');
      t.progress(0.2);

      const kind = options.fail === 'error' ? 'error' : 'hang';
      probe.failNextLoad(kind);
      t.event('setup', `the next level load fails (${kind === 'hang' ? 'never finishes' : 'level file missing'}; test shortcut)`);
      const pressedAt = performance.now();
      await tapAt(probe.startButton, probe.menu().start ?? 'Start');
      t.scene('Loading (forced failure)');
      try {
        await t.until(() => probe.menu().title === ERROR_TITLE && probe.menu().start === 'Retry' && probe.menu().startEnabled, 30000, 'the error card');
      } catch {
        t.problem('bug', `no "${ERROR_TITLE}" card with Retry within 30 s of Start: "${probe.menu().title}" / "${probe.menu().start}"`);
        t.finish('stuck');
        return;
      }
      const seconds = (performance.now() - pressedAt) / 1000;
      t.metric('errorCardSeconds', Math.round(seconds * 10) / 10);
      t.scene('Error card');
      t.event('error-card', `${probe.menu().title}: ${probe.menu().text} (${seconds.toFixed(1)} s after Start)`);
      if (seconds > 28) t.problem('bug', `the error card took ${seconds.toFixed(1)} s to show (about 20 s expected)`);
      t.progress(0.5);
      await sleep(2500);

      sessionStorage.setItem(LOAD_ERROR_RUN_KEY, JSON.stringify({ events: [{ type: 'error-card', detail: `${seconds.toFixed(1)} s` }] }));
      // Retry reloads the page itself; keep the run in the URL so it carries on after the reload.
      const url = new URL(location.href);
      url.searchParams.set('playtest', 'load-error');
      url.searchParams.set('seed', String(options.seed ?? 1));
      url.searchParams.set('speed', String(options.speed ?? 1));
      history.replaceState(history.state, '', url.toString());
      t.event('retry', 'Retry pressed; the page reloads and the run carries on after it');
      await tapAt(probe.startButton, 'Retry');
      await new Promise(() => {}); // the page is going away
      return;
    }

    sessionStorage.removeItem(LOAD_ERROR_RUN_KEY);
    for (const e of carried.events) t.event(`before-reload:${e.type}`, e.detail);
    t.event('reloaded', 'the page reloaded after Retry');
    if (probe.sound().prompt) await tapToPlay();
    t.scene('Title (after Retry)');
    await sleep(800);
    const ok = checkStartCard('after Retry');
    t.progress(0.8);
    if (ok) await play();
    t.progress(1);
    t.finish(ok ? 'done' : 'stuck');
  };

  // ------------------------------------------------------------ problems the page can see

  const watchProblems = (t: Tracker) => {
    const missing = storyLines().filter(missingClip);
    if (missing.length) {
      t.problem('bug', `${missing.length} spoken line${missing.length === 1 ? ' has' : 's have'} no audio clip: ${missing.slice(0, 6).map((row) => row.id).join(', ')}${missing.length > 6 ? '…' : ''}`);
    }
    const silent = storyLines().filter((row) => spokenLine(row) && row.audio.trim() && !row.audioText.trim());
    if (silent.length) {
      t.problem('bug', `${silent.length} spoken line${silent.length === 1 ? ' is' : 's are'} silent placeholders (empty audioText): ${silent.slice(0, 6).map((row) => row.id).join(', ')}${silent.length > 6 ? '…' : ''}`);
    }
    const seen = new Set<string>();
    const report = (url: string, status: number) => {
      const path = url.replace(location.origin, '');
      if (seen.has(path)) return;
      seen.add(path);
      const kind = /\.(glb|gltf)(\?|$)/i.test(path) ? 'model' : /\.(png|jpe?g|webp|ktx2?|env|dds)(\?|$)/i.test(path) ? 'texture' : /\.(wav|ogg|mp3|m4a)(\?|$)/i.test(path) ? 'audio' : 'file';
      t.problem('bug', `missing ${kind}: ${path}${status ? ` (${status})` : ''}`);
    };
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          const status = (entry as PerformanceResourceTiming & { responseStatus?: number }).responseStatus ?? 0;
          if (status >= 400) report(entry.name, status);
        }
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch { observer = null; }
    const original = console.error;
    console.error = (...args: unknown[]) => {
      try {
        const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
        const url = /(\/assets\/[^\s"'()]+)/.exec(text)?.[1];
        if (url && /unable to load|failed|error|404/i.test(text)) report(url, 0);
        else t.log(`console.error ${text.slice(0, 200)}`);
      } catch { /* never break the page */ }
      original.apply(console, args as []);
    };
    const onMediaError = (event: Event) => {
      const el = event.target as HTMLMediaElement | null;
      if (el && 'currentSrc' in el && el.currentSrc) report(el.currentSrc, 0);
    };
    window.addEventListener('error', onMediaError, true);
    return () => {
      observer?.disconnect();
      if (console.error !== original) console.error = original;
      window.removeEventListener('error', onMediaError, true);
    };
  };
  installed = true;
};

// ---------------------------------------------------------------- save cookie

const SAVE_KEY = 'ph-origins-save';
const SOUND_KEY = 'hawkes.sound';
const SOUND_RUN_KEY = 'hawkes.playtest.sound-settings';
const LOAD_ERROR_RUN_KEY = 'hawkes.playtest.load-error';

const snapshotSave = () => {
  const cookie = document.cookie.split('; ').find((row) => row.startsWith(`${SAVE_KEY}=`)) ?? null;
  let stored: string | null = null;
  try { stored = localStorage.getItem(SAVE_KEY); } catch { stored = null; }
  return { cookie, stored };
};

const restoreSave = (saved: ReturnType<typeof snapshotSave>) => {
  if (saved.cookie) document.cookie = `${saved.cookie}; path=/; max-age=${60 * 60 * 24 * 400}; SameSite=Lax`;
  else document.cookie = `${SAVE_KEY}=; path=/; max-age=0`;
  try {
    if (saved.stored === null) localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, saved.stored);
  } catch { /* storage blocked */ }
};
