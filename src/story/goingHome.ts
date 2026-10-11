import * as BABYLON from '@babylonjs/core';

import { applyCullBands, collectCullBands, type CullBand } from '../game/levelCull';
import { detachSharedProbe, loadGlbByAssetId } from '../game/modelLoader';
import { createCharacterAvatar, type PlayerAvatar } from '../game/playerAvatar';
import { PLAYER_MESH_Y_OFFSET, PLAYER_STAND_Y } from '../game/player';
import type { StoryCarry } from './act1';
import { SHOP_LINE, STREET_BARKS, STREET_SFX, STREET_TALKS, type StreetLine } from './streetAudio';
import { CORPSE_SECONDS, POSSESS_SECONDS, floorUnder, settleCorpse } from './streetRules';

export type GoingHomeHost = {
  scene: BABYLON.Scene;
  camera: BABYLON.Camera;
  running: () => boolean;
  placePierce: (x: number, z: number, yaw: number) => void;
  playClip: (clip: string, loop: boolean, speed?: number, onEnded?: () => void) => void;
  holdLocomotion: () => void;
  resumeLocomotion: () => void;
  frameCamera: (position: { x: number; y: number; z: number }, lookAt: { x: number; y: number; z: number }) => void;
  releaseCamera: () => void;
  fade: (to: number, seconds?: number) => void;
  showLine: (title: string, text: string) => void;
  holdScene: (held: boolean) => void;
  setObjective: (title: string, text: string, target: { x: number; z: number; y?: number } | null) => void;
  showObjective: (visible: boolean) => void;
  clearMarker: () => void;
  playFile: (url: string, volume: number) => void;
  setWalk: (moving: boolean) => void;
  setCarry: (items: StoryCarry[]) => void;
  hurt: (amount: number) => void;
  win: () => void;
  showMessage: (title: string, text: string) => void;
  offerEnd: (title: string, text: string) => void;
  haltPlay: () => void;
  clearInput: () => void;
  unlockNext: () => void;
  refreshHud: () => void;
  player: () => { x: number; z: number; yaw: number };
  hand: () => { x: number; y: number; z: number } | null;
  leftHand: () => { x: number; y: number; z: number } | null;
  holster: () => void;
  shedShadow: (x: number, z: number) => void;
  pushPhoneText: (id: string) => void;
  ability: () => 'shock' | 'possess';
  cull: () => number;
};

const HOME = { x: 163.5, z: 21.2 };
const SPAWN = { x: 0, z: 2.35, yaw: 0 };
const STREET = { x: 3.6, z: 21.2, yaw: Math.PI / 2 };

const SCREAM = '/assets/audio/cutscenes/going-home/01-receptionist-scream.wav';
const POLICE_CALL = '/assets/audio/cutscenes/going-home/02-receptionist-police.wav';
const NOT_UP = '/assets/audio/cutscenes/going-home/03-pierce-not-going-up.wav';
const PEDESTRIAN = '/assets/audio/street/pedestrian-away.wav';
const POLICE_SHOUT = '/assets/audio/street/police-stop.wav';

const CARRY: StoryCarry[] = [
  { id: 'phone', name: 'Phone', note: 'It still rings. He is not picking it up.' },
  { id: 'sidearm', name: 'Sidearm', note: 'Q draws it, until Shadow mode.' },
  { id: 'shove', name: 'Shove', note: 'In Shadow mode, select Shadow Shock, then click someone in front.' },
  { id: 'shadow', name: 'Shadow mode', note: 'C or the Shadow button turns it on. Powers only work while it is on.' },
];

type Role = 'desk' | 'walk' | 'hostile' | 'police' | 'shop';
type Mood = 'calm' | 'flee' | 'chase' | 'stagger' | 'lost' | 'down';

type Person = {
  mesh: BABYLON.Mesh;
  avatar: PlayerAvatar;
  role: Role;
  mood: Mood;
  hp: number;
  x0: number;
  x1: number;
  z: number;
  dir: number;
  stagger: number;
  attack: number;
  screamed: boolean;
  fell: boolean;
  moving: boolean;
  skittish: boolean;
  shocked: boolean;
  lost: number;
  homeYaw: number;
  mean: boolean;
  shown: boolean;
  shopId: string;
  voice: number;
  corpse: number;
  resting: boolean;
  poseHold: number;
  floorY: number;
  swing: number;
};

type Car = {
  root: BABYLON.TransformNode;
  speed: number;
  x: number;
  z: number;
  axis: 'x' | 'z';
  parked: boolean;
  passed: boolean;
};

type Pose = { t: number; x: number; z: number; yaw: number };
type Shot = { t: number; cx: number; cy: number; cz: number; lx: number; ly: number; lz: number };

const WALK: Pose[] = [
  { t: 0, x: 0, z: 2.35, yaw: 0 },
  { t: 2.6, x: 0, z: 2.35, yaw: 0 },
  { t: 13.2, x: 0, z: 8.6, yaw: 0 },
  { t: 26, x: 0, z: 21.2, yaw: 0 },
  { t: 30, x: 1.4, z: 21.2, yaw: Math.PI / 2 },
  { t: 36, x: STREET.x, z: STREET.z, yaw: STREET.yaw },
];

const SHOTS: Shot[] = [
  { t: 0, cx: -1.5, cy: 1.7, cz: 1.55, lx: 2.4, ly: 1.4, lz: 4.4 },
  { t: 7, cx: -1.6, cy: 1.72, cz: 3.5, lx: 4.2, ly: 1.4, lz: 4.2 },
  { t: 14, cx: -1.9, cy: 1.74, cz: 6.8, lx: 0.4, ly: 1.42, lz: 12 },
  { t: 24, cx: -1.4, cy: 1.8, cz: 14.5, lx: 0.15, ly: 1.4, lz: 20 },
  { t: 31, cx: -7, cy: 5.8, cz: 16, lx: 8, ly: 12, lz: 42 },
  { t: 36, cx: 0.8, cy: 2.05, cz: 17.8, lx: STREET.x, ly: 1.5, lz: STREET.z },
];

const CROWD: [number, number, number, number][] = [
  [-22, 21.15, Math.PI / 2, -30],
  [-14, 21.05, Math.PI / 2, -22],
  [-6, 21.25, -Math.PI / 2, -12],
  [4, 21.1, Math.PI / 2, -2],
  [12, 21.2, -Math.PI / 2, 6],
  [22, 21.05, Math.PI / 2, 16],
  [32, 21.3, -Math.PI / 2, 26],
  [-18, 36.2, Math.PI / 2, -26],
  [-8, 36.35, -Math.PI / 2, -16],
  [2, 36.15, Math.PI / 2, -4],
  [14, 36.4, -Math.PI / 2, 8],
  [28, 36.1, Math.PI / 2, 20],
];
const FAR: [number, number, number, number][] = [];
for (let x = 52; x <= 148; x += 24) {
  FAR.push([x, 21.15, x % 48 < 24 ? Math.PI / 2 : -Math.PI / 2, x - 8]);
  FAR.push([x + 6, 36.2, Math.PI / 2, x - 2]);
}
const NORTH: [number, number, number, number][] = [
  [36, 80.2, Math.PI / 2, 24],
  [78, 93.5, -Math.PI / 2, 66],
  [120, 80.3, Math.PI / 2, 108],
  [210, 93.6, Math.PI / 2, 198],
  [48, 138.2, -Math.PI / 2, 36],
  [170, 138.4, Math.PI / 2, 158],
];
const CROWD_ASSETS = ['asset-ch08-npc', 'asset-ch28-npc', 'asset-ch31-npc', 'asset-ch23-npc'];
const HOSTILE_CHANCE = 1 / 25;
const SHOP_DOOR_Z = 18.15;
const SHOPS: { id: string; x: number; z: number; yaw: number; asset: string }[] = [
  { id: 'market', x: 46, z: 14.9, yaw: 0, asset: 'asset-ch08-npc' },
  { id: 'diner', x: 108, z: 14.9, yaw: 0, asset: 'asset-ch28-npc' },
  { id: 'news', x: 152, z: 14.9, yaw: 0, asset: 'asset-ch31-npc' },
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

const paint = (scene: BABYLON.Scene, name: string, diffuse: BABYLON.Color3, emissive?: BABYLON.Color3) => {
  const material = new BABYLON.StandardMaterial(name, scene);
  material.diffuseColor = diffuse;
  material.specularColor = new BABYLON.Color3(0.04, 0.04, 0.05);
  if (emissive) material.emissiveColor = emissive;
  return material;
};

const streetTexture = (scene: BABYLON.Scene, url: string) => {
  const texture = new BABYLON.Texture(url, scene, false, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
  texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  return texture;
};

/** World-meter UVs so one shared material tiles across boxes of different sizes. */
const tileBox = (mesh: BABYLON.AbstractMesh, meters: number) => {
  const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  const normals = mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind);
  if (!positions || !normals) return;
  const uvs = new Float32Array((positions.length / 3) * 2);
  const sx = Math.abs(mesh.scaling.x) || 1;
  const sy = Math.abs(mesh.scaling.y) || 1;
  const sz = Math.abs(mesh.scaling.z) || 1;
  const tile = Math.max(0.4, meters);
  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i] * sx;
    const py = positions[i + 1] * sy;
    const pz = positions[i + 2] * sz;
    const ax = Math.abs(normals[i]);
    const ay = Math.abs(normals[i + 1]);
    const az = Math.abs(normals[i + 2]);
    let u = px / tile;
    let v = py / tile;
    if (ay >= ax && ay >= az) {
      u = px / tile;
      v = pz / tile;
    } else if (ax >= az) {
      u = pz / tile;
      v = py / tile;
    }
    const vi = (i / 3) * 2;
    uvs[vi] = u;
    uvs[vi + 1] = v;
  }
  mesh.setVerticesData(BABYLON.VertexBuffer.UVKind, uvs);
};

let carHolder: BABYLON.TransformNode | null = null;
let carLoad: Promise<BABYLON.TransformNode | null> | null = null;

const loadCarSource = (scene: BABYLON.Scene) => {
  if (carHolder && !carHolder.isDisposed()) return carLoad ?? Promise.resolve(carHolder);
  const holder = new BABYLON.TransformNode('street-car-source', scene);
  holder.setEnabled(false);
  carHolder = holder;
  carLoad = loadGlbByAssetId(scene, 'asset-street-car', holder).then((imported) => {
    if (!imported || holder.isDisposed() || holder !== carHolder) return null;
    return holder;
  });
  return carLoad;
};

const releaseCarSource = () => {
  const holder = carHolder;
  carHolder = null;
  carLoad = null;
  if (!holder || holder.isDisposed()) return;
  const materials: BABYLON.Material[] = [];
  for (const mesh of holder.getChildMeshes(false)) {
    if (mesh.material) materials.push(mesh.material);
    if (mesh.material instanceof BABYLON.MultiMaterial) {
      for (const sub of mesh.material.subMaterials) {
        if (sub) materials.push(sub);
      }
    }
  }
  detachSharedProbe(materials);
  // Textures stay with the parsed prop container. Disposing them blanks the next copy.
  holder.dispose(false, false);
};

const buildCar = (scene: BABYLON.Scene, name: string, x: number, z: number, speed: number, axis: 'x' | 'z' = 'x'): Car => {
  const root = new BABYLON.TransformNode(name, scene);
  root.position.set(x, 0, z);
  if (axis === 'z') root.rotation.y = speed < 0 ? -Math.PI / 2 : Math.PI / 2;
  else if (speed < 0) root.rotation.y = Math.PI;
  const mount = new BABYLON.TransformNode(`${name}-body`, scene);
  mount.parent = root;
  mount.rotation.y = -Math.PI / 2;
  void loadCarSource(scene).then((source) => {
    if (!source || mount.isDisposed()) return;
    for (const child of source.getChildren()) {
      const copy = child.clone(`${name}-${child.name}`, mount);
      if (!copy) continue;
      copy.setEnabled(true);
      const meshes = copy instanceof BABYLON.TransformNode ? copy.getChildMeshes(false) : [];
      if (copy instanceof BABYLON.AbstractMesh) meshes.push(copy);
      for (const mesh of meshes) {
        mesh.setEnabled(true);
        mesh.isPickable = false;
        mesh.checkCollisions = false;
      }
    }
  });
  const blocker = BABYLON.MeshBuilder.CreateBox(`${name}-block`, { width: 4.5, height: 1.5, depth: 1.95 }, scene);
  blocker.parent = root;
  blocker.position.y = 0.8;
  blocker.visibility = 0;
  blocker.isPickable = false;
  blocker.checkCollisions = speed === 0;
  return { root, speed, x, z, axis, parked: speed === 0, passed: false };
};

export const createGoingHome = (host: GoingHomeHost) => {
  const people: Person[] = [];
  const cars: Car[] = [];
  let active = false;
  let playing = false;
  let time = 0;
  let clip: 'walk' | 'idle' | '' = '';
  let lineUntil = 0;
  let screamed = false;
  let called = false;
  let pierceSaid = false;
  let streetTime = 0;
  let streetOpen = false;
  let lesson: 'first' | 'second' | 'done' = 'first';
  let firstAbility: 'shock' | 'possess' | null = null;
  let shownAbility: 'shock' | 'possess' | '' = '';
  let policeAfter = -1;
  let shoveLeft = 0;
  let meleeLeft = 0;
  let shake = 0;
  let carHit = 0;
  let finished = false;
  let policeWaves = 0;
  let policeLine = false;
  let shoutLeft = 0;
  let skipStreet = false;
  let tether: Person | null = null;
  let tetherMove = { x: 0, z: 0 };
  let tetherMoving = false;
  let linkLeft = 0;
  let linkTime = 0;
  let shadowOn = false;
  let handsOut = false;
  let trailLeft = 0;
  let watchLeft = 0;
  let watchX = 0;
  let watchZ = 0;
  const trailFrom = new BABYLON.Vector3();
  const trailTo = new BABYLON.Vector3();
  const beads: BABYLON.Mesh[] = [];
  const disposers: BABYLON.Node[] = [];
  type QueuedPerson = {
    id: string;
    asset: string;
    x: number;
    z: number;
    yaw: number;
    role: Role;
    x0: number;
    x1: number;
    shopId: string;
    homeYaw: number;
  };
  const queued: QueuedPerson[] = [];
  const shopSpots = SHOPS.map((shop) => ({
    id: shop.id,
    x: shop.x,
    open: false,
    interior: [] as BABYLON.Node[],
  }));
  const bands: CullBand[] = [];
  const painted: BABYLON.AbstractMesh[] = [];
  const paintJobs: { mesh: BABYLON.AbstractMesh; material: BABYLON.Material }[] = [];
  const ownedMats: BABYLON.Material[] = [];
  let shareLeft = 8;
  let cullWait = 0;
  let streetNoted = false;
  let chatterWait = 6;
  let chatterLeft = 0;
  let chatterNext: { title: string; line: StreetLine } | null = null;
  let insideShop = '';

  const nodeId = (node: BABYLON.Node) => {
    const meta = node.metadata as { sceneAssetId?: string } | null;
    return meta?.sceneAssetId || node.name || '';
  };

  const dressKind = (id: string) => {
    if (!id) return '';
    if (id.startsWith('b3-decal-win-') || id.startsWith('tower-win')) return 'window';
    if (id.startsWith('lamp-')) return 'lamp';
    if (id.startsWith('b3-decal-walk-')) return 'walk';
    if (id.startsWith('b3-decal-curb-')) return 'curb';
    if (id.startsWith('b3-decal-xing-')) return 'xing';
    if (id.startsWith('street-facade-')) return 'facade';
    if (
      id.startsWith('street-bin-')
      || id.startsWith('street-plant-')
      || id.startsWith('street-board-')
      || id.startsWith('street-hydrant-')
      || id.startsWith('street-can-')
      || id.startsWith('street-paper-')
      || id.startsWith('street-planter-')
    ) return 'furn';
    if (id.includes('-in-')) return 'interior';
    if (id.startsWith('shop-') || id.startsWith('b3-decal-shop-')) return 'shell';
    return '';
  };

  const releaseMaterial = (material: BABYLON.Material) => {
    if (ownedMats.includes(material)) return;
    if (material instanceof BABYLON.PBRMaterial) material.reflectionTexture = null;
    material.dispose(false, false);
  };

  const flatMat = (name: string, diffuse: BABYLON.Color3, emissive?: BABYLON.Color3, alpha = 1) => {
    const material = paint(host.scene, name, diffuse, emissive);
    if (alpha < 1) {
      material.alpha = alpha;
      material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      material.backFaceCulling = false;
    }
    ownedMats.push(material);
    return material;
  };

  const paintMesh = (mesh: BABYLON.AbstractMesh, material: BABYLON.Material) => {
    if (!mesh.material || mesh.material === material) return;
    const old = mesh.material;
    mesh.material = material;
    if (!painted.includes(mesh)) painted.push(mesh);
    if (old.getBindedMeshes().length === 0) releaseMaterial(old);
  };

  const applyBands = (x: number, z: number) => {
    applyCullBands(bands, x, z, host.cull());
  };

  const syncShops = (x: number, z: number) => {
    for (const shop of shopSpots) {
      const dx = x - shop.x;
      const dz = z - SHOP_DOOR_Z;
      const dist2 = dx * dx + dz * dz;
      const want = shop.open ? dist2 < 20 * 20 : dist2 < 15 * 15;
      if (want === shop.open) continue;
      shop.open = want;
      for (const node of shop.interior) {
        if (!node.isDisposed()) node.setEnabled(want);
      }
    }
  };

  const shopOpen = (id: string) => shopSpots.find((shop) => shop.id === id)?.open ?? false;

  const shouldShow = (person: Person, dist: number) => {
    if (person === tether) return true;
    if (person.role === 'desk') return playing || dist < 32;
    if (person.role === 'shop') return shopOpen(person.shopId);
    if (person.role === 'police' || person.mood === 'chase' || person.mood === 'flee') {
      return dist < (person.shown ? 58 : 46);
    }
    if (person.mood === 'down') return true;
    return dist < (person.shown ? 28 : 20);
  };

  const setPersonShown = (person: Person, on: boolean) => {
    if (person.shown === on) return;
    person.shown = on;
    person.mesh.setEnabled(on);
    person.avatar.setShown(on);
  };

  const realize = (spec: QueuedPerson) => {
    const person = spawnPerson(spec.id, spec.asset, spec.x, spec.z, spec.yaw, spec.role, spec.x0, spec.x1);
    person.homeYaw = spec.homeYaw;
    person.shopId = spec.shopId;
    if (Math.random() < HOSTILE_CHANCE) {
      person.hp = 3;
      if (spec.role === 'shop') person.mean = true;
      else person.role = 'hostile';
    } else person.skittish = Math.random() < 0.2;
    person.avatar.whenReady(() => {
      if (!active || person.mood === 'down') return;
      person.moving = person.role === 'walk';
      if (person.shown) person.avatar.setLocomotion(person.moving, true);
    });
    return person;
  };

  const pumpQueue = (x: number, z: number, limit: number) => {
    let spawned = 0;
    for (let i = queued.length - 1; i >= 0 && spawned < limit; i -= 1) {
      const spec = queued[i];
      if (Math.hypot(spec.x - x, spec.z - z) > 40) continue;
      queued.splice(i, 1);
      const person = realize(spec);
      setPersonShown(person, shouldShow(person, Math.hypot(person.mesh.position.x - x, person.mesh.position.z - z)));
      spawned += 1;
    }
  };

  const face = (person: Person, yaw: number) => {
    person.avatar.group.rotation.y = yaw + Math.PI;
  };

  const setClip = (next: 'walk' | 'idle', moving: boolean) => {
    host.setWalk(moving && playing);
    if (clip === next) return;
    clip = next;
    host.playClip(next === 'walk' ? 'walk' : 'rebornidle', true);
  };

  const spawnPerson = (
    id: string,
    assetId: string,
    x: number,
    z: number,
    yaw: number,
    role: Role,
    x0 = x - 6,
    x1 = x + 6,
  ): Person => {
    const mesh = BABYLON.MeshBuilder.CreateCapsule(id, { radius: 0.38, height: 1.55 }, host.scene);
    mesh.position.set(x, PLAYER_STAND_Y, z);
    mesh.visibility = 0;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    const avatar = createCharacterAvatar(host.scene, id, assetId);
    avatar.group.parent = mesh;
    avatar.group.position.y = -PLAYER_MESH_Y_OFFSET;
    const person: Person = {
      mesh,
      avatar,
      role,
      mood: 'calm',
      hp: role === 'police' ? 4 : role === 'hostile' ? 3 : 1,
      x0,
      x1,
      z,
      dir: 1,
      stagger: 0,
      attack: 0,
      screamed: false,
      fell: false,
      moving: false,
      skittish: false,
      shocked: false,
      lost: 0,
      homeYaw: yaw,
      mean: false,
      shown: true,
      shopId: '',
      voice: role === 'shop' ? 0 : [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % STREET_BARKS.length,
      corpse: 0,
      resting: false,
      poseHold: 0,
      floorY: 0,
      swing: 0,
    };
    face(person, yaw);
    people.push(person);
    return person;
  };

  const slideDoors = (open: number) => {
    const left = host.scene.getMeshByName('lobby-door-l');
    const right = host.scene.getMeshByName('lobby-door-r');
    if (left) left.position.x = lerp(-0.58, -1.85, open);
    if (right) right.position.x = lerp(0.58, 1.85, open);
  };

  const say = (title: string, text: string, url: string, volume: number, hold: number) => {
    host.showLine(title, text);
    host.playFile(url, volume);
    lineUntil = time + hold;
  };

  const hideBeads = () => {
    for (const bead of beads) bead.setEnabled(false);
  };

  const ensureBeads = () => {
    if (beads.length) return;
    const material = paint(host.scene, 'shadow-link-mat', new BABYLON.Color3(0.01, 0.01, 0.012), new BABYLON.Color3(0.02, 0.02, 0.022));
    material.alpha = 0.32;
    material.disableLighting = true;
    material.specularColor = BABYLON.Color3.Black();
    material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    for (let i = 0; i < 16; i += 1) {
      const bead = BABYLON.MeshBuilder.CreateSphere(`shadow-link-${i}`, { diameter: 0.14, segments: 4 }, host.scene);
      bead.material = material;
      bead.isPickable = false;
      bead.checkCollisions = false;
      bead.setEnabled(false);
      beads.push(bead);
    }
  };

  const handOrigin = () => {
    const joint = host.hand();
    if (joint) return new BABYLON.Vector3(joint.x, joint.y, joint.z);
    const here = host.player();
    return new BABYLON.Vector3(
      here.x + Math.sin(here.yaw) * 0.42,
      1.22,
      here.z + Math.cos(here.yaw) * 0.42,
    );
  };

  const poseBeads = (from: BABYLON.Vector3, to: BABYLON.Vector3, waveTime: number) => {
    ensureBeads();
    const dir = to.subtract(from);
    const len = Math.max(0.001, dir.length());
    const perp = new BABYLON.Vector3(-dir.z / len, 0, dir.x / len);
    for (let i = 0; i < beads.length; i += 1) {
      const t = i / (beads.length - 1);
      const wave = Math.sin(t * 16 + waveTime * 7.5) * 0.2 * Math.sin(t * Math.PI);
      const lift = Math.sin(t * Math.PI) * 0.42;
      const bead = beads[i];
      bead.setEnabled(true);
      bead.position.set(
        from.x + dir.x * t + perp.x * wave,
        from.y + dir.y * t + lift,
        from.z + dir.z * t + perp.z * wave,
      );
      const scale = 0.65 + Math.sin(t * 22 + waveTime * 9) * 0.35;
      bead.scaling.setAll(scale);
    }
  };

  const updateRibbon = () => {
    if (tether) {
      poseBeads(handOrigin(), tether.mesh.position.add(new BABYLON.Vector3(0, 1.15, 0)), linkTime);
      return;
    }
    if (trailLeft > 0) {
      poseBeads(trailFrom, trailTo, linkTime);
      return;
    }
    hideBeads();
  };

  const streetCopy = () => {
    if (!shadowOn) return { title: 'The station', text: 'Stairs down, a few blocks east. Tab switches Punch and Kick. C is Shadow mode.' };
    if (!handsOut) return { title: 'Shadow mode', text: 'Tab switches the ability. Q raises the hands.' };
    return { title: 'Shadow Link', text: 'Aim at them. Click uses Possess.' };
  };

  const abilityLabel = (id: 'shock' | 'possess') => (id === 'possess' ? 'Possess' : 'Shadow Shock');

  const showLesson = () => {
    if (lesson === 'second' && firstAbility) {
      const other = firstAbility === 'shock' ? 'possess' : 'shock';
      const name = abilityLabel(other);
      host.setObjective('Switch', `Switch to ${name} with Tab or Switch Ability, then use it on a passerby. Stay in Shadow mode.`, null);
      return;
    }
    const selected = host.ability();
    shownAbility = selected;
    const name = abilityLabel(selected);
    host.setObjective(name, `Turn Shadow mode on with C or the Shadow button, then use ${name} on a passerby.`, null);
  };

  const showStreet = () => {
    if (lesson !== 'done') {
      showLesson();
      return;
    }
    const copy = streetCopy();
    host.setObjective(copy.title, copy.text, { x: HOME.x, y: 1.2, z: HOME.z });
  };

  const resetLesson = () => {
    lesson = 'first';
    firstAbility = null;
    shownAbility = '';
    streetNoted = false;
    policeAfter = -1;
  };

  const noteUse = (used: 'shock' | 'possess') => {
    if (lesson === 'done' || playing || !shadowOn) return;
    if (lesson === 'first') {
      firstAbility = used;
      lesson = 'second';
      showLesson();
      return;
    }
    if (used === firstAbility) return;
    lesson = 'done';
    host.setObjective('The station', 'Stairs down, a few blocks east. Tab switches the ability. C is Shadow mode.', { x: HOME.x, y: 1.2, z: HOME.z });
    if (!streetNoted) {
      streetNoted = true;
      host.pushPhoneText('voss-street');
      policeAfter = 0;
    }
  };

  const releaseLink = (backToStreet: boolean) => {
    tether = null;
    linkLeft = 0;
    tetherMove = { x: 0, z: 0 };
    tetherMoving = false;
    hideBeads();
    if (backToStreet && !finished) showStreet();
  };

  const layDown = (person: Person, shocked: boolean) => {
    if (person.mood === 'down') return;
    person.hp = 0;
    person.mood = 'down';
    person.shocked = shocked;
    person.attack = 0;
    person.stagger = 0;
    person.moving = false;
    person.corpse = CORPSE_SECONDS;
    person.resting = false;
    person.poseHold = 0;
    const feet = person.mesh.position.y + person.avatar.group.position.y;
    person.floorY = floorUnder(host.scene, person.mesh.position.x, person.mesh.position.z, feet, person.avatar.group);
    person.fell = person.avatar.playClip(shocked ? 'electrocuted' : 'deathforward', false);
  };

  const bury = (person: Person) => {
    const index = people.indexOf(person);
    if (index >= 0) people.splice(index, 1);
    person.avatar.dispose();
    if (!person.mesh.isDisposed()) person.mesh.dispose();
  };

  const handoff = () => {
    playing = false;
    clip = '';
    host.holdScene(false);
    host.releaseCamera();
    host.showLine('', '');
    host.setWalk(false);
    host.resumeLocomotion();
    showStreet();
    host.showObjective(true);
    const desk = people.find((person) => person.role === 'desk');
    if (desk && desk.mood === 'calm') desk.mood = 'flee';
    streetOpen = true;
    streetTime = 0;
  };

  const beginCutscene = () => {
    playing = true;
    time = 0;
    screamed = false;
    called = false;
    pierceSaid = false;
    streetOpen = false;
    streetTime = 0;
    resetLesson();
    clip = '';
    host.fade(1, 0);
    host.fade(0, 1.5);
    host.holdScene(true);
    host.showObjective(false);
    host.clearMarker();
    host.placePierce(SPAWN.x, SPAWN.z, SPAWN.yaw);
    host.playClip('rebornidle', true);
    clip = 'idle';
    slideDoors(0);
  };

  const beginStreet = () => {
    playing = false;
    time = 40;
    resetLesson();
    streetOpen = true;
    streetTime = 0;
    host.fade(0, 0.4);
    host.holdScene(false);
    host.releaseCamera();
    const nearStairs = new URLSearchParams(location.search).get('at') === 'stairs';
    host.placePierce(nearStairs ? 150 : STREET.x, STREET.z, STREET.yaw);
    host.resumeLocomotion();
    showStreet();
    host.showObjective(true);
    const desk = people.find((person) => person.role === 'desk');
    if (desk) desk.mood = 'flee';
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    host.clearMarker();
    host.showObjective(false);
    host.clearInput();
    host.holdLocomotion();
    host.playClip('rebornidle', true);
    host.unlockNext();
    host.refreshHud();
    host.offerEnd('Level Complete', 'The stairs go down. Continue. The station is waiting.');
  };

  const spawnPolice = (x: number, z: number, index: number) => {
    const person = spawnPerson(
      `street-police-${policeWaves}-${index}`,
      index === 0 ? 'asset-ch23-npc' : 'asset-ch31-npc',
      x,
      z,
      0,
      'police',
    );
    person.mood = 'chase';
    person.avatar.whenReady(() => {
      if (person.mood !== 'down') person.avatar.playClip('walk', true);
    });
  };

  const watchDeath = (x: number, z: number) => {
    const here = host.player();
    host.placePierce(here.x, here.z, Math.atan2(x - here.x, z - here.z));
    watchX = x;
    watchZ = z;
    watchLeft = 2.6;
    host.shedShadow(x, z);
  };

  const speak = (title: string, line: StreetLine) => {
    host.showLine(title, line.text);
    host.playFile(line.url, 0.62);
    chatterLeft = line.hold;
  };

  const considerTalk = () => {
    if (playing || shoutLeft > 0 || chatterLeft > 0) return;
    const here = host.player();
    const near = people.filter((person) => {
      if (!person.shown || person.mood !== 'calm' || person === tether || person.role === 'desk' || person.role === 'police') return false;
      return Math.hypot(person.mesh.position.x - here.x, person.mesh.position.z - here.z) < 10;
    });
    if (near.length >= 2 && Math.random() < 0.1) {
      for (let i = 0; i < near.length; i += 1) {
        for (let j = i + 1; j < near.length; j += 1) {
          const apart = Math.hypot(
            near[i].mesh.position.x - near[j].mesh.position.x,
            near[i].mesh.position.z - near[j].mesh.position.z,
          );
          if (apart > 2.8) continue;
          const row = STREET_TALKS.find((talk) => (
            (near[i].voice === talk.a && near[j].voice === talk.b)
            || (near[i].voice === talk.b && near[j].voice === talk.a)
          ));
          if (!row) continue;
          speak('Passerby', row.first);
          chatterNext = { title: 'Passerby', line: row.second };
          return;
        }
      }
    }
    if (!near.length || Math.random() >= 0.1) return;
    const person = near[Math.floor(Math.random() * near.length)];
    if (person.role === 'shop') {
      speak('Shopkeeper', SHOP_LINE);
      return;
    }
    const pool = STREET_BARKS[person.voice] ?? [];
    if (!pool.length) return;
    const line = pool[Math.floor(Math.random() * pool.length)];
    if (line) speak('Passerby', line);
  };

  const shopHere = () => {
    const here = host.player();
    if (here.z > 18.25 || here.z < 13.9) return '';
    for (const shop of SHOPS) {
      if (Math.abs(here.x - shop.x) < 2.9) return shop.id;
    }
    return '';
  };

  const bind = (person: Person) => {
    tether = person;
    linkLeft = POSSESS_SECONDS;
    person.mood = 'calm';
    person.stagger = 0;
    person.attack = 0;
    ensureBeads();
    host.playFile(STREET_SFX.possess, 0.4);
    if (lesson !== 'done') {
      noteUse('possess');
      return;
    }
    host.setObjective('Shadow Link', 'WASD walks them. Click kills. Tab switches the ability.', null);
  };

  const armMat = new BABYLON.StandardMaterial('shadow-arm-mat', host.scene);
  armMat.emissiveColor = new BABYLON.Color3(0.12, 0.04, 0.22);
  armMat.diffuseColor = new BABYLON.Color3(0.02, 0.01, 0.04);
  armMat.specularColor = BABYLON.Color3.Black();
  armMat.disableLighting = true;
  const makeArm = (name: string) => {
    const arm = BABYLON.MeshBuilder.CreateCylinder(name, { height: 1.2, diameter: 0.07, tessellation: 6 }, host.scene);
    arm.material = armMat;
    arm.isPickable = false;
    arm.checkCollisions = false;
    arm.setEnabled(false);
    return arm;
  };
  const rightArm = makeArm('shadow-arm-r');
  const leftArm = makeArm('shadow-arm-l');
  const poseArm = (arm: BABYLON.Mesh, hand: { x: number; y: number; z: number } | null, side: number) => {
    if (shoveLeft <= 0 || !hand) {
      arm.setEnabled(false);
      return;
    }
    const here = host.player();
    const fx = Math.sin(here.yaw);
    const fz = Math.cos(here.yaw);
    arm.setEnabled(true);
    arm.position.set(
      hand.x + fx * 0.62 + fz * side * 0.08,
      hand.y + 0.02,
      hand.z + fz * 0.62 - fx * side * 0.08,
    );
    arm.rotation.x = Math.PI / 2.15;
    arm.rotation.y = here.yaw;
    arm.rotation.z = side * 0.35;
  };

  return {
    objectiveKey: () => (tether ? 'link' : shadowOn ? 'shock' : 'home'),
    playing: () => playing,
    skip: () => {
      if (active && playing && !finished) handoff();
    },
    controls: () => active && !playing && !finished,
    shoveShown: () => lesson !== 'first',
    shake: () => shake,
    armSkip: (street: boolean) => {
      skipStreet = street;
    },
    mount: async () => {
      active = true;
      finished = false;
      policeWaves = 0;
      policeLine = false;
      resetLesson();
      streetOpen = false;
      streetTime = 0;
      chatterWait = 6;
      chatterLeft = 0;
      chatterNext = null;
      insideShop = '';
      people.length = 0;
      queued.length = 0;
      for (const car of cars) car.root.dispose(false, false);
      cars.length = 0;
      const bootX = new URLSearchParams(location.search).get('at') === 'stairs' ? 150 : STREET.x;
      const nearBoot = (x: number, z: number) => Math.hypot(x - bootX, z - STREET.z) <= 34;
      spawnPerson('street-receptionist', 'asset-ch37-npc', 5.5, 4.55, -Math.PI / 2, 'desk');
      CROWD.concat(FAR, NORTH).forEach(([x, z, yaw, x0], index) => {
        const spec: QueuedPerson = {
          id: `street-walk-${index}`,
          asset: CROWD_ASSETS[index % CROWD_ASSETS.length],
          x,
          z,
          yaw,
          role: 'walk',
          x0,
          x1: Math.abs(z - 21.2) < 2.5 ? Math.min(x0 + 12, 156) : x0 + 14,
          shopId: '',
          homeYaw: yaw,
        };
        if (nearBoot(x, z)) realize(spec);
        else queued.push(spec);
      });
      for (const shop of SHOPS) {
        const spec: QueuedPerson = {
          id: `shop-${shop.id}-owner`,
          asset: shop.asset,
          x: shop.x,
          z: shop.z,
          yaw: shop.yaw,
          role: 'shop',
          x0: shop.x,
          x1: shop.x,
          shopId: shop.id,
          homeYaw: shop.yaw,
        };
        if (nearBoot(shop.x, shop.z)) realize(spec);
        else queued.push(spec);
      }
      const specs: [number, number, number][] = [
        [-22, 26.7, 7.2],
        [8, 26.9, 8.4],
        [18, 31.3, -6.6],
        [-12, 31.1, -7.4],
        [58, 27.1, 7.6],
        [96, 31.2, -6.4],
        [134, 26.8, 8.2],
        [-40, 86.8, 7.4],
        [70, 87.2, -6.8],
        [160, 86.6, 8],
        [40, -29.2, -7.2],
        [120, -28.8, 6.6],
      ];
      specs.forEach(([x, z, speed], index) => {
        cars.push(buildCar(host.scene, `street-car-${index}`, x, z, speed));
      });
      const crosses: [number, number, number][] = [
        [80, 60, 6.4],
        [80, 150, -5.8],
        [196, 40, 7.1],
        [196, 170, -6.2],
      ];
      crosses.forEach(([x, z, speed], index) => {
        cars.push(buildCar(host.scene, `street-car-ns-${index}`, x, z, speed, 'z'));
      });
      cars.push(buildCar(host.scene, 'street-car-park-a', -10, 23.15, 0));
      cars.push(buildCar(host.scene, 'street-car-park-b', 16, 23.25, 0));
      const texMat = (name: string, url: string, diffuse: BABYLON.Color3, emissive: BABYLON.Color3, glow = false) => {
        const material = paint(host.scene, name, diffuse, emissive);
        const texture = streetTexture(host.scene, url);
        if (glow) material.emissiveTexture = texture;
        else material.diffuseTexture = texture;
        ownedMats.push(material);
        return material;
      };
      const facadeTex = streetTexture(host.scene, '/assets/textures/street/facade.png');
      const facadeMat = (name: string, diffuse: BABYLON.Color3) => {
        const material = paint(host.scene, name, diffuse, new BABYLON.Color3(0.055, 0.05, 0.045));
        material.diffuseTexture = facadeTex;
        ownedMats.push(material);
        return material;
      };
      const metalTex = streetTexture(host.scene, '/assets/textures/lift-metal.webp');
      const metalOf = (name: string, diffuse: BABYLON.Color3) => {
        const material = paint(host.scene, name, diffuse, diffuse.scale(0.12));
        material.diffuseTexture = metalTex;
        material.specularColor = new BABYLON.Color3(0.12, 0.12, 0.13);
        ownedMats.push(material);
        return material;
      };
      const windowMat = texMat('street-window-shared', '/assets/textures/street/window.png', new BABYLON.Color3(0.12, 0.1, 0.08), new BABYLON.Color3(0.42, 0.34, 0.22), true);
      const walkMat = texMat('street-walk-shared', '/assets/textures/street/sidewalk.png', new BABYLON.Color3(0.92, 0.9, 0.86), new BABYLON.Color3(0.07, 0.07, 0.065));
      const curbMat = metalOf('street-curb-shared', new BABYLON.Color3(0.28, 0.28, 0.3));
      const xingMat = flatMat('street-xing-shared', new BABYLON.Color3(0.88, 0.7, 0.16), new BABYLON.Color3(0.14, 0.09, 0.02));
      const wallMat = texMat('street-shop-wall', '/assets/textures/street/wood.png', new BABYLON.Color3(0.72, 0.58, 0.4), new BABYLON.Color3(0.05, 0.035, 0.02));
      const metalMat = metalOf('street-shop-metal', new BABYLON.Color3(0.42, 0.42, 0.44));
      const glassMat = flatMat('street-shop-glass', new BABYLON.Color3(0.55, 0.68, 0.78), new BABYLON.Color3(0.08, 0.1, 0.12), 0.38);
      const awningMat: Record<string, BABYLON.StandardMaterial> = {
        market: flatMat('street-awning-market', new BABYLON.Color3(0.55, 0.12, 0.09), new BABYLON.Color3(0.08, 0.02, 0.012)),
        diner: flatMat('street-awning-diner', new BABYLON.Color3(0.12, 0.2, 0.42), new BABYLON.Color3(0.03, 0.04, 0.08)),
        news: flatMat('street-awning-news', new BABYLON.Color3(0.42, 0.34, 0.12), new BABYLON.Color3(0.07, 0.05, 0.015)),
      };
      const boardMat = facadeMat('street-block-board', new BABYLON.Color3(0.78, 0.72, 0.64));
      const hallMat = facadeMat('street-block-hall', new BABYLON.Color3(0.58, 0.62, 0.68));
      const officeMat = facadeMat('street-block-office', new BABYLON.Color3(0.86, 0.8, 0.7));
      const groundMat = texMat('street-ground-shared', '/assets/textures/street/asphalt.png', new BABYLON.Color3(0.55, 0.55, 0.58), new BABYLON.Color3(0.045, 0.045, 0.05));
      const roadMat = texMat('street-road-shared', '/assets/textures/street/asphalt.png', new BABYLON.Color3(0.7, 0.7, 0.74), new BABYLON.Color3(0.04, 0.04, 0.045));
      const assignFlat = (mesh: BABYLON.AbstractMesh, material: BABYLON.Material, meters = 0) => {
        if (meters > 0) tileBox(mesh, meters);
        paintJobs.push({ mesh, material });
        paintMesh(mesh, material);
      };
      const dressNodes = [...host.scene.meshes, ...host.scene.transformNodes];
      for (const node of dressNodes) {
        const id = nodeId(node);
        const kind = dressKind(id);
        const matId = (node.metadata as { materialId?: string } | null)?.materialId ?? '';
        if (node instanceof BABYLON.AbstractMesh && (id.startsWith('block-') || id.startsWith('city-') || id === 'tower')) {
          const material = matId === 'mat-hall-wall' ? hallMat : matId === 'mat-office-wall' ? officeMat : boardMat;
          assignFlat(node, material, 2.4);
          continue;
        }
        if (node instanceof BABYLON.AbstractMesh && (id.startsWith('street-ground') || id.startsWith('b3-decal-ave-') || id.startsWith('b3-decal-cross-') || id === 'b3-decal-road')) {
          assignFlat(node, id.startsWith('street-ground') ? groundMat : roadMat, id.startsWith('street-ground') ? 4 : 3.2);
          continue;
        }
        if (node instanceof BABYLON.AbstractMesh && id.startsWith('b3-decal-lane-')) {
          assignFlat(node, xingMat);
          continue;
        }
        if (!kind) continue;
        if (kind === 'interior' || kind === 'shell') {
          const spot = shopSpots.find((shop) => id.includes(`shop-${shop.id}`));
          if (!spot) continue;
          if (kind === 'interior') {
            spot.interior.push(node);
            node.setEnabled(false);
          }
        }
        if (!(node instanceof BABYLON.AbstractMesh) || id.includes('-in-') && !id.includes('-in-lamp')) continue;
        let material: BABYLON.Material | null = null;
        let tile = 0;
        if (kind === 'window' || id.includes('lamp-head') || id.includes('shell-sign') || id.includes('-in-lamp')) {
          material = windowMat;
          tile = 1.45;
        } else if (kind === 'walk') {
          material = walkMat;
          tile = 1.6;
        } else if (kind === 'curb') {
          material = curbMat;
          tile = 1.1;
        } else if (kind === 'xing' || id.includes('shell-sill')) material = xingMat;
        else if (id.includes('shell-glass')) material = glassMat;
        else if (id.includes('shell-awning')) material = awningMat[shopSpots.find((shop) => id.includes(`shop-${shop.id}`))?.id ?? ''] ?? wallMat;
        else if (id.includes('shell-lintel') || id.includes('lamp-post')) {
          material = metalMat;
          tile = 0.7;
        } else if (id.includes('shell-w') || id.includes('shell-e')) {
          material = wallMat;
          tile = 0.85;
        }
        if (material) assignFlat(node, material, tile);
      }
      bands.push(...collectCullBands(host.scene));
      syncShops(bootX, STREET.z);
      applyBands(bootX, STREET.z);
      for (const person of people) {
        const dist = Math.hypot(person.mesh.position.x - bootX, person.mesh.position.z - STREET.z);
        setPersonShown(person, shouldShow(person, dist));
      }
      host.placePierce(SPAWN.x, SPAWN.z, SPAWN.yaw);
      slideDoors(0);
      await Promise.all(people.map((person) => new Promise<void>((resolve) => person.avatar.whenReady(resolve))));
      for (const person of people) {
        person.moving = person.role === 'walk';
        person.avatar.setLocomotion(person.moving, true);
      }
    },
    dispose: () => {
      active = false;
      playing = false;
      streetOpen = false;
      releaseLink(false);
      const beadMat = beads[0]?.material;
      for (const bead of beads) {
        if (!bead.isDisposed()) bead.dispose(false, false);
      }
      beadMat?.dispose();
      beads.length = 0;
      for (const person of people) {
        person.avatar.dispose();
        if (!person.mesh.isDisposed()) person.mesh.dispose();
      }
      people.length = 0;
      for (const car of cars) car.root.dispose(false, false);
      cars.length = 0;
      for (const node of disposers) node.dispose(false, true);
      disposers.length = 0;
      for (const mesh of painted) {
        if (!mesh.isDisposed() && mesh.material && ownedMats.includes(mesh.material)) mesh.material = null;
      }
      painted.length = 0;
      paintJobs.length = 0;
      for (const mat of ownedMats) mat.dispose();
      ownedMats.length = 0;
      releaseCarSource();
      bands.length = 0;
      queued.length = 0;
      for (const shop of shopSpots) {
        shop.interior.length = 0;
        shop.open = false;
      }
    },
    onStart: () => {
      shadowOn = false;
      handsOut = false;
      trailLeft = 0;
      host.setCarry(CARRY);
      host.playClip('rebornidle', true);
      if (!active) return;
      if (skipStreet) beginStreet();
      else beginCutscene();
    },
    shadowMode: () => shadowOn,
    handsOut: () => shadowOn && handsOut,
    setHands: (out: boolean) => {
      if (!active || playing || finished || !shadowOn) return;
      handsOut = out;
      if (!out) {
        trailLeft = 0;
        hideBeads();
      }
      showStreet();
    },
    aimMarks: () => {
      const marks: { x: number; y: number; z: number }[] = [];
      if (!shadowOn || !handsOut || tether) return marks;
      for (const person of people) {
        if (!person.shown || person.mood === 'down' || person.hp <= 0) continue;
        marks.push({ x: person.mesh.position.x, y: person.mesh.position.y, z: person.mesh.position.z });
      }
      return marks;
    },
    ignoresAim: (mesh: BABYLON.AbstractMesh) => {
      for (const person of people) {
        if (mesh === person.mesh || mesh.isDescendantOf(person.avatar.group)) return true;
      }
      return false;
    },
    possessAt: (x: number, y: number, z: number) => {
      if (!active || playing || finished || !shadowOn || !handsOut || tether) return false;
      let best: Person | null = null;
      let bestDist = 1.35;
      for (const person of people) {
        if (!person.shown || person.mood === 'down' || person.hp <= 0) continue;
        const dist = Math.hypot(person.mesh.position.x - x, person.mesh.position.y - y, person.mesh.position.z - z);
        if (dist > bestDist) continue;
        best = person;
        bestDist = dist;
      }
      if (!best) return false;
      bind(best);
      return true;
    },
    possessLook: () => {
      if (!active || playing || finished || !shadowOn || tether) return false;
      const here = host.player();
      const look = host.camera.getForwardRay(1).direction;
      const camLen = Math.hypot(look.x, look.z) || 1;
      const camX = look.x / camLen;
      const camZ = look.z / camLen;
      let best: Person | null = null;
      let bestDist = 6.2;
      for (const person of people) {
        if (!person.shown || person.mood === 'down' || person.hp <= 0) continue;
        const dx = person.mesh.position.x - here.x;
        const dz = person.mesh.position.z - here.z;
        const dist = Math.hypot(dx, dz);
        if (dist > bestDist || dist < 0.05) continue;
        const dot = (dx * camX + dz * camZ) / dist;
        if (dist > 2.8 ? dot < 0.4 : dot < 0.08) continue;
        best = person;
        bestDist = dist;
      }
      if (!best) return false;
      bind(best);
      return true;
    },
    consume: () => {
      if (!active || playing || finished || !shadowOn || !tether) return false;
      const best = tether;
      trailFrom.copyFrom(handOrigin());
      trailTo.set(best.mesh.position.x, best.mesh.position.y, best.mesh.position.z);
      trailLeft = 0.55;
      ensureBeads();
      layDown(best, false);
      const atX = best.mesh.position.x;
      const atZ = best.mesh.position.z;
      releaseLink(false);
      watchDeath(atX, atZ);
      host.playFile(STREET_SFX.consume, 0.46);
      host.playFile(STREET_SFX.death, 0.32);
      shake = 0.22;
      showStreet();
      return true;
    },
    release: () => {
      if (!tether) return false;
      releaseLink(true);
      return true;
    },
    toggleShadow: () => {
      if (!active || playing || finished) return shadowOn;
      if (tether) releaseLink(false);
      shadowOn = !shadowOn;
      if (!shadowOn) {
        const here = host.player();
        for (const person of people) {
          if (person.mood === 'down' || person === tether) continue;
          if (person.role !== 'police' && person.role !== 'hostile' && !person.mean) continue;
          const dist = Math.hypot(person.mesh.position.x - here.x, person.mesh.position.z - here.z);
          if (dist < 16) person.mood = 'chase';
          else if (person.mood === 'lost') person.mood = 'calm';
        }
      }
      handsOut = false;
      trailLeft = 0;
      hideBeads();
      host.playFile(shadowOn ? STREET_SFX.shadowOn : STREET_SFX.shadowOff, 0.4);
      if (shadowOn) host.holster();
      showStreet();
      return shadowOn;
    },
    linked: () => !!tether,
    possessLeft: () => (tether ? Math.max(0, linkLeft) : 0),
    linkFocus: () => {
      if (tether) return { x: tether.mesh.position.x, z: tether.mesh.position.z };
      if (watchLeft > 0) return { x: watchX, z: watchZ };
      return null;
    },
    linkMoving: () => tetherMoving,
    driveLinked: (dx: number, dz: number) => {
      tetherMove = { x: dx, z: dz };
      tetherMoving = Math.hypot(dx, dz) > 0.0008;
    },
    shadowShown: () => active && !playing && !finished,
    shock: () => {
      if (!active || playing || finished || !shadowOn || shoveLeft > 0) return false;
      const here = host.player();
      const look = host.camera.getForwardRay(1).direction;
      const camLen = Math.hypot(look.x, look.z) || 1;
      const camX = look.x / camLen;
      const camZ = look.z / camLen;
      const bodyX = Math.sin(here.yaw);
      const bodyZ = Math.cos(here.yaw);
      let hit = false;
      for (const person of people) {
        if (!person.shown || person.mood === 'down' || person === tether) continue;
        const dx = person.mesh.position.x - here.x;
        const dz = person.mesh.position.z - here.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 6.2 || dist < 0.05) continue;
        const dot = Math.max((dx * camX + dz * camZ) / dist, (dx * bodyX + dz * bodyZ) / dist);
        if (dist > 2.8 ? dot < 0.4 : dot < 0.08) continue;
        layDown(person, true);
        host.shedShadow(person.mesh.position.x, person.mesh.position.z);
        hit = true;
      }
      if (!hit) return false;
      host.playFile(STREET_SFX.shock, 0.5);
      shoveLeft = 1.35;
      shake = 0.18;
      host.playClip('shadowshock', false, 1, () => {
        if (active && !playing && !finished) host.resumeLocomotion();
      });
      const teaching = lesson !== 'done';
      noteUse('shock');
      if (!teaching) showStreet();
      return true;
    },
    strike: (kind: 'punch' | 'kick') => {
      if (!active || playing || finished || shadowOn || meleeLeft > 0) return false;
      const here = host.player();
      const look = host.camera.getForwardRay(1).direction;
      const camLen = Math.hypot(look.x, look.z) || 1;
      const camX = look.x / camLen;
      const camZ = look.z / camLen;
      const reach = kind === 'kick' ? 2.35 : 1.7;
      const damage = kind === 'kick' ? 2 : 1;
      let best: Person | null = null;
      let bestDist = reach;
      for (const person of people) {
        if (!person.shown || person.mood === 'down' || person.hp <= 0 || person === tether) continue;
        const dx = person.mesh.position.x - here.x;
        const dz = person.mesh.position.z - here.z;
        const dist = Math.hypot(dx, dz);
        if (dist > bestDist || dist < 0.05) continue;
        const dot = (dx * camX + dz * camZ) / dist;
        if (dot < 0.35) continue;
        best = person;
        bestDist = dist;
      }
      if (best) {
        best.hp -= damage;
        if (best.hp <= 0) layDown(best, false);
        else {
          best.stagger = 0.45;
          if (best.role === 'hostile' || best.role === 'police' || best.mean) best.mood = 'chase';
        }
      }
      meleeLeft = 0.85;
      host.playClip(kind, false, 1, () => {
        if (active && !playing && !finished) host.resumeLocomotion();
      });
      return true;
    },
    shocking: () => shoveLeft > 0,
    shotAt: (origin: BABYLON.Vector3, direction: BABYLON.Vector3) => {
      if (!active || playing || tether || shadowOn) return false;
      const dir = direction.clone();
      if (dir.lengthSquared() < 1e-6) return false;
      dir.normalize();
      let best: Person | null = null;
      let bestAlong = 28;
      for (const person of people) {
        if (!person.shown || person.mood === 'down' || person.hp <= 0) continue;
        const to = person.mesh.position.add(new BABYLON.Vector3(0, 0.2, 0)).subtract(origin);
        const along = BABYLON.Vector3.Dot(to, dir);
        if (along < 0.4 || along > bestAlong) continue;
        const miss = to.subtract(dir.scale(along)).length();
        if (miss > 0.55) continue;
        best = person;
        bestAlong = along;
      }
      if (!best) return false;
      best.hp -= 1;
      if (best.hp <= 0) {
        layDown(best, false);
        host.playFile(STREET_SFX.death, 0.42);
      } else {
        best.stagger = 0.45;
        if (best.role !== 'walk') best.mood = 'chase';
      }
      return true;
    },
    step: (delta: number) => {
      if (!active || finished) return;
      const dt = Math.min(0.05, Math.max(0, delta));
      shake = Math.max(0, shake - dt);
      shoveLeft = Math.max(0, shoveLeft - dt);
      meleeLeft = Math.max(0, meleeLeft - dt);
      watchLeft = Math.max(0, watchLeft - dt);
      poseArm(rightArm, host.hand(), 1);
      poseArm(leftArm, host.leftHand(), -1);
      carHit = Math.max(0, carHit - dt);
      if (playing) {
        time += dt;
        const open = Math.max(0, Math.min(1, (time - 0.7) / 1.5));
        slideDoors(open);
        const [pa, pb, pt] = sample(WALK, time);
        const x = lerp(pa.x, pb.x, pt);
        const z = lerp(pa.z, pb.z, pt);
        const yaw = lerp(pa.yaw, pb.yaw, pt);
        const moving = Math.hypot(pb.x - pa.x, pb.z - pa.z) > 0.2 && pt < 0.98 && time > 2.5 && time < 35.2;
        host.placePierce(x, z, yaw);
        setClip(moving ? 'walk' : 'idle', moving);
        const [sa, sb, st] = sample(SHOTS, time);
        host.frameCamera(
          { x: lerp(sa.cx, sb.cx, st), y: lerp(sa.cy, sb.cy, st), z: lerp(sa.cz, sb.cz, st) },
          { x: lerp(sa.lx, sb.lx, st), y: lerp(sa.ly, sb.ly, st), z: lerp(sa.lz, sb.lz, st) },
        );
        if (!screamed && time >= 6.2) {
          screamed = true;
          say('Receptionist', 'Ah! Oh my god!', SCREAM, 0.92, 2.4);
        } else if (!called && time >= 8.8) {
          called = true;
          say('Receptionist', "Security! I'm calling the police!", POLICE_CALL, 0.92, 3.6);
        } else if (!pierceSaid && time >= 13.2) {
          pierceSaid = true;
          say('Pierce Hawkes', "I'm not going back up.", NOT_UP, 0.92, 2.8);
        } else if (lineUntil > 0 && time > lineUntil) {
          lineUntil = 0;
          host.showLine('', '');
        }
        if (time >= 36.2) handoff();
      } else if (streetOpen && host.running()) {
        streetTime += dt;
        if (streetNoted && policeAfter >= 0) policeAfter += dt;
        if (lesson === 'first') {
          const selected = host.ability();
          if (selected !== shownAbility) showLesson();
        }
        const shopNow = shopHere();
        if (shopNow && shopNow !== insideShop) host.playFile(STREET_SFX.bell, 0.32);
        insideShop = shopNow;
      }
      if (chatterLeft > 0) {
        chatterLeft = Math.max(0, chatterLeft - dt);
        if (chatterLeft <= 0 && chatterNext && shoutLeft <= 0) {
          const next = chatterNext;
          chatterNext = null;
          speak(next.title, next.line);
        } else if (chatterLeft <= 0 && shoutLeft <= 0) host.showLine('', '');
      } else if (!playing && host.running()) {
        chatterWait -= dt;
        if (chatterWait <= 0) {
          chatterWait = 4.6;
          considerTalk();
        }
      }

      trailLeft = Math.max(0, trailLeft - dt);
      linkTime += dt;
      const here = host.player();
      cullWait -= dt;
      const cullNow = cullWait <= 0;
      if (cullNow) {
        applyBands(here.x, here.z);
        cullWait = 0.28;
      }
      if (shareLeft > 0 && cullNow) {
        shareLeft -= 0.28;
        for (const job of paintJobs) {
          if (!job.mesh.isDisposed() && job.mesh.material !== job.material) paintMesh(job.mesh, job.material);
        }
      }
      syncShops(here.x, here.z);
      pumpQueue(here.x, here.z, 1);
      updateRibbon();
      if (tether && !playing) {
        linkLeft -= dt;
        if (linkLeft <= 0) releaseLink(true);
      }
      const seen = playing ? time > 26 : !playing;
      const buried: Person[] = [];
      for (const person of people) {
        if (person.mood === 'down') {
          if (!person.shown) {
            person.shown = true;
            person.mesh.setEnabled(true);
            person.avatar.group.setEnabled(true);
          }
          if (!person.fell) {
            person.fell = person.avatar.playClip(person.shocked ? 'electrocuted' : 'deathforward', false);
            person.moving = false;
            if (person.corpse <= 0) person.corpse = CORPSE_SECONDS;
            if (!person.shocked) host.playFile(STREET_SFX.death, 0.42);
          }
          const posed = settleCorpse(
            person.avatar,
            person.floorY,
            person.shocked ? 'electrocuted' : 'deathforward',
            person.poseHold,
            dt,
            person.resting,
          );
          person.poseHold = posed.age;
          person.resting = posed.resting;
          person.corpse -= dt;
          if (person.corpse <= 0) {
            if (tether === person) releaseLink(false);
            buried.push(person);
          }
          continue;
        }
        const px = person.mesh.position.x;
        const pz = person.mesh.position.z;
        const dx = here.x - px;
        const dz = here.z - pz;
        const dist = Math.hypot(dx, dz);
        const want = shouldShow(person, dist);
        setPersonShown(person, want);
        if (!want) continue;
        if (person === tether) {
          const mx = tetherMove.x;
          const mz = tetherMove.z;
          person.moving = Math.hypot(mx, mz) > 0.002;
          if (person.moving) {
            person.mesh.position.x = Math.max(-160, Math.min(340, person.mesh.position.x + mx));
            person.mesh.position.z = Math.max(-140, Math.min(250, person.mesh.position.z + mz));
            face(person, Math.atan2(mx, mz));
          }
          person.avatar.setLocomotion(person.moving, true);
          tetherMove = { x: 0, z: 0 };
          continue;
        }
        if (shadowOn && person !== tether && (person.mood === 'chase' || person.mood === 'flee')) {
          person.mood = 'lost';
          person.lost = 2.8 + Math.random() * 1.2;
          person.attack = 0;
          person.stagger = 0;
        }
        if (person.stagger > 0 && person.mood !== 'lost') {
          person.stagger -= dt;
          if (person.stagger <= 0) {
            person.mood = person.role === 'hostile' || person.role === 'police' || person.mean
              ? 'chase'
              : person.skittish || person.role === 'desk'
                ? 'flee'
                : 'calm';
          }
        }
        if (!shadowOn && seen && person.mood === 'calm' && person.skittish && (person.role === 'walk' || person.role === 'shop') && dist < 2.4) {
          person.mood = 'flee';
          if (!person.screamed) {
            person.screamed = true;
            host.playFile(PEDESTRIAN, 0.7);
          }
        }
        if (!shadowOn && (person.role === 'hostile' || person.mean) && !playing && streetTime > 2.5 && person.mood === 'calm') person.mood = 'chase';
        let mx = 0;
        let mz = 0;
        let speed = 0;
        if (person.mood === 'stagger') {
          speed = 0;
        } else if (person.mood === 'flee') {
          speed = 5.1;
          mx = px - here.x;
          mz = pz - here.z;
        } else if (person.mood === 'lost') {
          person.lost -= dt;
          if (person.lost > 1.25) {
            speed = 0;
            face(person, Math.atan2(here.x - px, here.z - pz) + Math.sin((streetTime + px) * 2.4) * 1.15);
          } else if (person.lost > 0) {
            speed = 1.7;
            mx = px - here.x;
            mz = pz - here.z;
          } else {
            person.mood = 'calm';
            person.avatar.resumeLocomotion();
          }
        } else if (person.mood === 'chase' && !playing && !shadowOn) {
          speed = person.role === 'police' ? 3.05 : 2.55;
          mx = here.x - px;
          mz = here.z - pz;
          if (dist < 1.35) speed = 0;
        } else if (person.role === 'walk' && person.mood === 'calm') {
          speed = 1.15;
          if (px > person.x1) person.dir = -1;
          if (px < person.x0) person.dir = 1;
          if (!shadowOn && dist < 1.15 && Math.abs(here.z - pz) < 1.2 && (here.x - px) * person.dir > 0.2) {
            person.dir = -person.dir;
          }
          mx = person.dir;
          mz = 0;
        } else if (person.role === 'shop' && person.mood === 'calm') {
          speed = 0;
          const look = !shadowOn && dist < 3.4 && dist > 0.15;
          face(person, look ? Math.atan2(here.x - px, here.z - pz) : person.homeYaw);
        } else if (person.role === 'desk' && person.mood === 'calm') {
          speed = 0;
          face(person, -Math.PI / 2);
        }
        const len = Math.hypot(mx, mz);
        person.moving = speed > 0.2 && len > 0.01;
        if (person.moving) {
          person.mesh.position.x += (mx / len) * speed * dt;
          person.mesh.position.z += (mz / len) * speed * dt;
          face(person, Math.atan2(mx, mz));
        }
        if (person.swing > 0) {
          person.swing = Math.max(0, person.swing - dt);
          person.moving = false;
        } else {
          person.avatar.setLocomotion(person.moving, true);
        }
        if (!playing && person.swing <= 0 && (person.mood === 'chase') && dist < 1.45) {
          person.attack -= dt;
          if (person.attack <= 0) {
            person.attack = person.role === 'police' ? 1.05 : 1.15;
            face(person, Math.atan2(here.x - px, here.z - pz));
            person.avatar.playClip('punch', false, 1, () => {
              if (person.mood !== 'down') person.avatar.resumeLocomotion();
            });
            person.swing = 0.85;
            host.hurt(person.role === 'police' ? 14 : 8);
          }
        }
      }
      for (const person of buried) bury(person);

      for (const car of cars) {
        const nearX = car.root.position.x - here.x;
        const nearZ = car.root.position.z - here.z;
        const near2 = nearX * nearX + nearZ * nearZ;
        const carOn = car.root.isEnabled();
        const wantCar = carOn ? near2 < 68 * 68 : near2 < 50 * 50;
        if (wantCar !== carOn) car.root.setEnabled(wantCar);
        if (car.parked) continue;
        if (car.axis === 'z') {
          car.root.position.z += car.speed * dt;
          if (car.root.position.z > 230) car.root.position.z = -110;
          if (car.root.position.z < -110) car.root.position.z = 230;
        } else {
          car.root.position.x += car.speed * dt;
          if (car.root.position.x > 320) car.root.position.x = -140;
          if (car.root.position.x < -140) car.root.position.x = 320;
        }
        if (!car.parked) {
          const alongNow = car.axis === 'z'
            ? Math.abs(car.root.position.z - here.z)
            : Math.abs(car.root.position.x - here.x);
          const acrossNow = car.axis === 'z'
            ? Math.abs(car.x - here.x)
            : Math.abs(car.z - here.z);
          if (alongNow < 3.2 && acrossNow < 7) {
            if (!car.passed && !playing) {
              car.passed = true;
              const dist = Math.hypot(nearX, nearZ);
              host.playFile(STREET_SFX.car, Math.max(0.07, Math.min(0.2, 0.26 - dist * 0.018)));
            }
          } else if (alongNow > 8) car.passed = false;
        }
        if (playing || carHit > 0) continue;
        const dx = Math.abs((car.axis === 'z' ? car.x : car.root.position.x) - here.x);
        const dz = Math.abs((car.axis === 'z' ? car.root.position.z : car.z) - here.z);
        const along = car.axis === 'z' ? dz : dx;
        const across = car.axis === 'z' ? dx : dz;
        if (along < 2.3 && across < 1.15) {
          carHit = 1.4;
          host.hurt(16);
          if (car.axis === 'z') host.placePierce(here.x < car.x ? car.x - 4.2 : car.x + 4.2, here.z, here.yaw);
          else host.placePierce(here.x, here.z < car.z ? car.z - 4.2 : car.z + 4.2, here.yaw);
        }
      }

      if (!playing && policeWaves < 1 && streetNoted && policeAfter >= 30) {
        policeWaves = 1;
        const behind = Math.max(-18, here.x - 28);
        spawnPolice(behind, 27.4, 0);
        spawnPolice(behind - 8, 30.8, 1);
        if (!policeLine) {
          policeLine = true;
          host.showLine('Police', 'Stop! Stay where you are!');
          host.playFile(POLICE_SHOUT, 0.9);
          shoutLeft = 3.4;
        }
      }
      if (!playing && shoutLeft > 0) {
        shoutLeft -= dt;
        if (shoutLeft <= 0) host.showLine('', '');
      }

      if (!playing && host.running() && here.x > 162.5 && here.x < 165.2 && Math.abs(here.z - HOME.z) < 1.7) finish();
    },
  };
};

export type GoingHome = ReturnType<typeof createGoingHome>;
