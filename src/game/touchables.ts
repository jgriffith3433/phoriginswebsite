import * as BABYLON from '@babylonjs/core';

import { lifeStats } from './lifeStats';

/**
 * Things that answer Interact in the three places Pierce spends longest: the 58th floor, the station, the train.
 * Each has a spot to stand near, a label, a sound and a motion. Props that are not in the level are built here
 * (a desk phone, a coffee machine, a light switch, a pole's grip band, a strap, a stop button); props that are
 * (the ticket machine, a turnstile, the newsstand, a bin) are unfrozen and nudged. Sounds are `touch/` files made
 * through Hawkes Gen; until a file exists `soundFallback.ts` plays an existing stand-in.
 */
export type TouchHost = {
  scene: BABYLON.Scene;
  playerXZ: () => { x: number; z: number };
  playFile: (url: string, volume: number) => void;
};

type Motion = (t: number, state: Record<string, unknown>) => void;

type Touchable = {
  id: string;
  label: string;
  x: number;
  z: number;
  r: number;
  sound: string;
  volume: number;
  /** A second sound that follows the first after `after` seconds (the handset going back down). */
  then?: { sound: string; volume: number; after: number };
  duration: number;
  motion: string;
  /** Called once at mount: build meshes, return the per-frame motion. */
  build: (scene: BABYLON.Scene, own: BABYLON.Node[], state: Record<string, unknown>) => Motion;
};

const TOUCH_SFX = {
  phone: '/assets/audio/sfx/touch/desk-phone.ogg',
  phoneDown: '/assets/audio/sfx/phone/hangup.wav',
  coffee: '/assets/audio/sfx/touch/coffee-machine.ogg',
  switch: '/assets/audio/sfx/touch/light-switch.ogg',
  thermostat: '/assets/audio/sfx/apex/screen-tap.ogg',
  ticket: '/assets/audio/sfx/touch/ticket-machine.ogg',
  turnstile: '/assets/audio/sfx/touch/turnstile.ogg',
  bell: '/assets/audio/sfx/street/shop-bell.wav',
  bin: '/assets/audio/sfx/touch/bin-lid.ogg',
  pole: '/assets/audio/sfx/touch/pole-grip.ogg',
  strap: '/assets/audio/sfx/touch/strap-swing.ogg',
  stop: '/assets/audio/sfx/touch/stop-request.ogg',
  handle: '/assets/audio/sfx/touch/emergency-handle.ogg',
} as const;
export const TOUCH_SOUNDS: readonly string[] = Object.values(TOUCH_SFX);

const mat = (scene: BABYLON.Scene, name: string, color: [number, number, number], emissive = 0) => {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = new BABYLON.Color3(...color);
  m.emissiveColor = new BABYLON.Color3(color[0] * emissive, color[1] * emissive, color[2] * emissive);
  m.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
  return m;
};

const box = (
  scene: BABYLON.Scene, own: BABYLON.Node[], name: string, size: [number, number, number],
  at: [number, number, number], material: BABYLON.Material, parent?: BABYLON.Node,
) => {
  const m = BABYLON.MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene);
  m.position.set(...at);
  m.material = material;
  m.isPickable = false;
  m.checkCollisions = false;
  if (parent) m.parent = parent;
  own.push(m);
  return m;
};

/** Finds a placed level prop by its asset name (a mesh or a transform node, as the loader made it). */
const findProp = (scene: BABYLON.Scene, name: string): BABYLON.TransformNode | null => {
  const byName = scene.getTransformNodeByName(name) ?? scene.getMeshByName(name);
  if (byName) return byName as BABYLON.TransformNode;
  for (const n of [...scene.transformNodes, ...scene.meshes]) {
    if ((n.metadata as { sceneAssetId?: string } | undefined)?.sceneAssetId === name) return n as BABYLON.TransformNode;
  }
  return null;
};

/** A real prop answering a touch: a damped shake and squash around where it stands (it is frozen until then). */
const shake = (name: string, amount: number, spin = 0): Touchable['build'] => (scene, _own, state) => {
  let node: BABYLON.TransformNode | null = null;
  let base: { x: number; y: number; z: number; sy: number; ry: number } | null = null;
  return (t) => {
    if (!node) {
      node = findProp(scene, name);
      if (!node) return;
      node.unfreezeWorldMatrix?.();
      for (const child of node.getChildMeshes?.(false) ?? []) child.unfreezeWorldMatrix();
      base = { x: node.position.x, y: node.position.y, z: node.position.z, sy: node.scaling.y, ry: node.rotation.y };
    }
    if (!node || !base) return;
    const k = Math.exp(-t * 5) * Math.sin(t * 38);
    node.position.x = base.x + (t > 0 ? k * amount : 0);
    node.scaling.y = base.sy * (1 - (t > 0 ? Math.max(0, Math.exp(-t * 9)) * 0.03 : 0));
    node.rotation.y = base.ry + (t > 0 ? k * spin : 0);
    if (t < 0) { node.position.x = base.x; node.scaling.y = base.sy; node.rotation.y = base.ry; }
    state.moved = true;
  };
};

const phone: Touchable['build'] = (scene, own) => {
  const body = mat(scene, 'touch-phone-body', [0.08, 0.08, 0.09]);
  const led = mat(scene, 'touch-phone-led', [0.1, 0.9, 0.2], 1);
  const root = new BABYLON.TransformNode('touch-desk-phone', scene);
  root.position.set(48.95, 0.74, 42.55);
  own.push(root);
  box(scene, own, 'touch-phone-base', [0.2, 0.05, 0.24], [0, 0.025, 0], body, root);
  const handset = box(scene, own, 'touch-phone-handset', [0.05, 0.04, 0.2], [0, 0.07, 0], body, root);
  const lamp = box(scene, own, 'touch-phone-led', [0.025, 0.012, 0.025], [0.07, 0.056, 0.1], led, root);
  return (t) => {
    // Lifts, stays up while it rings, goes back down.
    const up = t < 0 ? 0 : t < 0.35 ? t / 0.35 : t < 2.0 ? 1 : Math.max(0, 1 - (t - 2.0) / 0.3);
    handset.position.y = 0.07 + up * 0.09;
    handset.rotation.x = -up * 0.5;
    lamp.setEnabled(t > 0 && t < 2.3 && Math.floor(t * 6) % 2 === 0);
  };
};

const coffee: Touchable['build'] = (scene, own) => {
  const body = mat(scene, 'touch-coffee-body', [0.12, 0.12, 0.13]);
  const steel = mat(scene, 'touch-coffee-steel', [0.55, 0.56, 0.58]);
  const lamp = mat(scene, 'touch-coffee-lamp', [0.9, 0.1, 0.05], 1);
  const cup = mat(scene, 'touch-coffee-cup', [0.9, 0.9, 0.88]);
  const steam = mat(scene, 'touch-coffee-steam', [0.9, 0.9, 0.95], 0.6);
  steam.alpha = 0.35;
  const root = new BABYLON.TransformNode('touch-coffee-machine', scene);
  root.position.set(50.6, 0.75, 24.2);
  root.rotation.y = Math.PI;
  own.push(root);
  box(scene, own, 'touch-coffee-body', [0.28, 0.38, 0.28], [0, 0.19, 0], body, root);
  box(scene, own, 'touch-coffee-spout', [0.12, 0.04, 0.1], [0, 0.3, -0.16], steel, root);
  box(scene, own, 'touch-coffee-cup', [0.07, 0.08, 0.07], [0, 0.04, -0.15], cup, root);
  const light = box(scene, own, 'touch-coffee-light', [0.04, 0.02, 0.01], [0.08, 0.34, -0.145], lamp, root);
  const puffs = [0, 1, 2].map((i) => box(scene, own, `touch-coffee-steam-${i}`, [0.05, 0.05, 0.05], [0, 0.14, -0.15], steam, root));
  return (t) => {
    const brewing = t > 0 && t < 3.2;
    const green = t >= 3.2 && t < 5;
    (light.material as BABYLON.StandardMaterial).emissiveColor = brewing ? new BABYLON.Color3(0.9, 0.5, 0) : green ? new BABYLON.Color3(0.1, 0.9, 0.2) : new BABYLON.Color3(0.9, 0.1, 0.05);
    puffs.forEach((p, i) => {
      const u = ((t - 1.2 - i * 0.5) % 1.6) / 1.6;
      p.setEnabled(t > 1.2 && t < 4.6 && u >= 0);
      p.position.y = 0.14 + Math.max(0, u) * 0.3;
      p.scaling.setAll(0.6 + Math.max(0, u));
    });
  };
};

const lightSwitch: Touchable['build'] = (scene, own, state) => {
  const plate = mat(scene, 'touch-switch-plate', [0.85, 0.84, 0.8]);
  const toggle = mat(scene, 'touch-switch-toggle', [0.95, 0.95, 0.92]);
  const root = new BABYLON.TransformNode('touch-light-switch', scene);
  // On the east wall of hall 1, between the doors: its face is at about x 2.12, facing -x.
  root.position.set(2.1, 1.2, 10);
  root.rotation.y = -Math.PI / 2;
  own.push(root);
  box(scene, own, 'touch-switch-plate', [0.08, 0.13, 0.012], [0, 0, 0], plate, root);
  const lever = box(scene, own, 'touch-switch-lever', [0.02, 0.045, 0.02], [0, 0, -0.014], toggle, root);
  const lights = scene.lights.filter((l) => l instanceof BABYLON.PointLight && /Hall 1|light-h1/i.test(`${l.name} ${(l.metadata as { sceneAssetId?: string } | undefined)?.sceneAssetId ?? ''}`)) as BABYLON.PointLight[];
  const base = lights.map((l) => l.intensity);
  state.lights = lights;
  return (t) => {
    // Click: the hall goes dark for a couple of seconds, the second click brings it back.
    const off = t > 0.08 && t < 2.4;
    lever.rotation.x = off ? 0.6 : 0;
    lights.forEach((l, i) => { l.intensity = off ? base[i] * 0.08 : base[i]; });
  };
};

const thermostat: Touchable['build'] = (scene, own) => {
  const plate = mat(scene, 'touch-thermo-plate', [0.88, 0.87, 0.84]);
  const dial = mat(scene, 'touch-thermo-dial', [0.2, 0.2, 0.22]);
  const screen = mat(scene, 'touch-thermo-screen', [0.1, 0.5, 0.9], 0.8);
  const root = new BABYLON.TransformNode('touch-thermostat', scene);
  // On the east wall of hall 1, south of the light switch, facing -x.
  root.position.set(2.1, 1.35, 13.2);
  root.rotation.y = -Math.PI / 2;
  own.push(root);
  box(scene, own, 'touch-thermo-plate', [0.1, 0.1, 0.014], [0, 0, 0], plate, root);
  const face = box(scene, own, 'touch-thermo-screen', [0.05, 0.03, 0.004], [0, 0.015, -0.009], screen, root);
  const knob = box(scene, own, 'touch-thermo-knob', [0.03, 0.012, 0.012], [0, -0.025, -0.012], dial, root);
  return (t) => {
    // The setpoint ticks up twice: the knob turns, the display flashes.
    knob.rotation.z = t <= 0 ? 0 : Math.min(1, t / 0.6) * 0.9;
    const on = t > 0 && Math.floor(t * 6) % 2 === 0 && t < 1.6;
    (face.material as BABYLON.StandardMaterial).emissiveColor = on ? new BABYLON.Color3(0.4, 1, 1) : new BABYLON.Color3(0.08, 0.4, 0.72);
  };
};

const polegrip: Touchable['build'] = (scene, own) => {
  const brass = mat(scene, 'touch-pole-band', [0.75, 0.6, 0.25], 0.15);
  const band = BABYLON.MeshBuilder.CreateCylinder('touch-pole-band', { diameter: 0.07, height: 0.12, tessellation: 12 }, scene);
  band.material = brass;
  band.position.set(6.8, 1.3, 0);
  band.isPickable = false;
  own.push(band);
  return (t) => {
    // The hand slides down the pole and stays there a moment.
    const u = t < 0 ? 0 : Math.min(1, t / 0.5);
    band.position.y = t < 0 || t > 3 ? 1.35 : 1.35 - u * 0.3;
    band.rotation.z = Math.sin(t * 9) * Math.exp(-t * 2) * 0.05;
  };
};

const strap: Touchable['build'] = (scene, own) => {
  const vinyl = mat(scene, 'touch-strap', [0.1, 0.1, 0.12]);
  const steel = mat(scene, 'touch-strap-ring', [0.6, 0.6, 0.62]);
  const root = new BABYLON.TransformNode('touch-strap', scene);
  root.position.set(13.6, 2.35, 0);
  own.push(root);
  box(scene, own, 'touch-strap-band', [0.03, 0.42, 0.012], [0, -0.21, 0], vinyl, root);
  const ring = BABYLON.MeshBuilder.CreateTorus('touch-strap-ring', { diameter: 0.14, thickness: 0.014, tessellation: 14 }, scene);
  ring.material = steel;
  ring.rotation.x = Math.PI / 2;
  ring.rotation.z = Math.PI / 2;
  ring.position.set(0, -0.46, 0);
  ring.parent = root;
  ring.isPickable = false;
  own.push(ring);
  return (t) => {
    root.rotation.x = t < 0 ? 0 : Math.sin(t * 5) * Math.exp(-t * 0.9) * 0.45;
  };
};

const stopButton: Touchable['build'] = (scene, own) => {
  const plate = mat(scene, 'touch-stop-plate', [0.75, 0.75, 0.72]);
  const cap = mat(scene, 'touch-stop-cap', [0.85, 0.1, 0.08], 0.35);
  const root = new BABYLON.TransformNode('touch-stop-button', scene);
  root.position.set(14.75, 1.3, 1.47);
  root.rotation.y = Math.PI;
  own.push(root);
  box(scene, own, 'touch-stop-plate', [0.1, 0.16, 0.012], [0, 0, 0], plate, root);
  const button = box(scene, own, 'touch-stop-cap', [0.06, 0.06, 0.02], [0, 0, -0.014], cap, root);
  return (t) => {
    const lit = t > 0 && t < 3.5 && Math.floor(t * 4) % 2 === 0;
    button.position.z = t > 0 && t < 0.2 ? -0.008 : -0.014;
    (button.material as BABYLON.StandardMaterial).emissiveColor = lit ? new BABYLON.Color3(1, 0.4, 0.1) : new BABYLON.Color3(0.3, 0.035, 0.028);
  };
};

const handle: Touchable['build'] = (scene, own) => {
  const red = mat(scene, 'touch-handle-red', [0.8, 0.05, 0.05], 0.3);
  const plate = mat(scene, 'touch-handle-plate', [0.7, 0.7, 0.68]);
  const root = new BABYLON.TransformNode('touch-emergency-handle', scene);
  root.position.set(0.06, 1.45, -1.1);
  root.rotation.y = Math.PI / 2;
  own.push(root);
  box(scene, own, 'touch-handle-plate', [0.14, 0.18, 0.012], [0, 0, 0], plate, root);
  const lever = box(scene, own, 'touch-handle-lever', [0.09, 0.03, 0.03], [0, 0.04, -0.02], red, root);
  return (t) => {
    // Pulled down, held, let go.
    const pull = t < 0 ? 0 : t < 0.25 ? t / 0.25 : t < 1.2 ? 1 : Math.max(0, 1 - (t - 1.2) / 0.3);
    lever.position.y = 0.04 - pull * 0.07;
  };
};

const PLACES: Record<string, Touchable[]> = {
  'apex-peak': [
    { id: 'desk-phone', label: 'Pick up the desk phone', x: 48.6, z: 41.5, r: 1.1, sound: TOUCH_SFX.phone, volume: 0.5, then: { sound: TOUCH_SFX.phoneDown, volume: 0.3, after: 2.1 }, duration: 2.4, motion: 'handset lifts, LED blinks', build: phone },
    { id: 'coffee-machine', label: 'Pour a coffee', x: 50.6, z: 25.4, r: 1.1, sound: TOUCH_SFX.coffee, volume: 0.45, duration: 5, motion: 'light turns amber then green, steam rises', build: coffee },
    { id: 'light-switch', label: 'Flip the light switch', x: 1.0, z: 10, r: 1.2, sound: TOUCH_SFX.switch, volume: 0.45, then: { sound: TOUCH_SFX.switch, volume: 0.45, after: 2.4 }, duration: 2.6, motion: 'lever flips, hall lights go dark, then back', build: lightSwitch },
    { id: 'thermostat', label: 'Nudge the thermostat', x: 1.0, z: 13.2, r: 1.0, sound: TOUCH_SFX.thermostat, volume: 0.4, duration: 1.8, motion: 'knob turns, display flashes', build: thermostat },
  ],
  'the-station': [
    { id: 'ticket-machine', label: 'Use the ticket machine', x: 8.4, z: -5.5, r: 1.5, sound: TOUCH_SFX.ticket, volume: 0.45, duration: 1.4, motion: 'machine shudders as it prints', build: shake('station-kiosk', 0.015) },
    { id: 'turnstile', label: 'Push the turnstile', x: 15.2, z: -1.4, r: 1.3, sound: TOUCH_SFX.turnstile, volume: 0.45, duration: 1.0, motion: 'turnstile jolts and swings', build: shake('station-stile-e', 0.02, 0.08) },
    { id: 'newsstand-bell', label: 'Ring the newsstand bell', x: 8.2, z: -4.6, r: 1.5, sound: TOUCH_SFX.bell, volume: 0.32, duration: 1.2, motion: 'stand rocks to the bell', build: shake('station-newsstand', 0.012) },
    { id: 'bin', label: 'Lift the bin lid', x: 28, z: -5.7, r: 1.2, sound: TOUCH_SFX.bin, volume: 0.4, duration: 0.9, motion: 'bin rattles', build: shake('station-bin-a', 0.02, 0.06) },
  ],
  'the-train': [
    { id: 'pole', label: 'Hold the pole', x: 6.8, z: 0.55, r: 1.0, sound: TOUCH_SFX.pole, volume: 0.35, duration: 3.2, motion: 'brass grip slides down the pole', build: polegrip },
    { id: 'strap', label: 'Grab the strap', x: 13.6, z: 0.5, r: 1.0, sound: TOUCH_SFX.strap, volume: 0.3, duration: 4.5, motion: 'strap swings', build: strap },
    { id: 'stop-request', label: 'Press the stop button', x: 14.75, z: 0.55, r: 1.3, sound: TOUCH_SFX.stop, volume: 0.4, duration: 3.6, motion: 'button lights and blinks', build: stopButton },
    { id: 'emergency-handle', label: 'Pull the handle', x: 1.0, z: -0.7, r: 1.0, sound: TOUCH_SFX.handle, volume: 0.45, duration: 1.6, motion: 'lever pulls down', build: handle },
  ],
};

/** The places that have touchables, by library id. */
export const touchPlace = (libraryId: string) => (libraryId === 'apex-peak' ? 'apex' : libraryId === 'the-station' ? 'station' : libraryId === 'the-train' ? 'train' : null);

export const createTouchables = (host: TouchHost) => {
  const own: BABYLON.Node[] = [];
  let list: { def: Touchable; motion: Motion; state: Record<string, unknown>; t: number; thenAt: number }[] = [];
  let place: string | null = null;

  const near = (def: Touchable) => {
    const here = host.playerXZ();
    return Math.hypot(here.x - def.x, here.z - def.z) <= def.r;
  };
  const closest = () => {
    let best: (typeof list)[number] | null = null;
    let bestD = Infinity;
    const here = host.playerXZ();
    for (const entry of list) {
      if (!near(entry.def)) continue;
      const d = Math.hypot(here.x - entry.def.x, here.z - entry.def.z);
      if (d < bestD) { best = entry; bestD = d; }
    }
    return best;
  };

  const dispose = () => {
    for (const entry of list) entry.motion(-1, entry.state);
    for (const node of own) node.dispose(false, false);
    own.length = 0;
    list = [];
    place = null;
  };

  return {
    mount(libraryId: string) {
      dispose();
      const key = touchPlace(libraryId);
      if (!key) return;
      place = key;
      lifeStats.reset();
      list = PLACES[libraryId].map((def) => {
        const state: Record<string, unknown> = {};
        const motion = def.build(host.scene, own, state);
        motion(-1, state);
        return { def, motion, state, t: -1, thenAt: -1 };
      });
    },
    dispose,
    /** The E prompt for the touchable in reach, or null. */
    action: (): string | null => closest()?.def.label ?? null,
    confirm: (): boolean => {
      const entry = closest();
      if (!entry || !place) return false;
      if (entry.t >= 0 && entry.t < entry.def.duration) return true;
      entry.t = 0;
      entry.thenAt = entry.def.then ? entry.def.then.after : -1;
      host.playFile(entry.def.sound, entry.def.volume);
      lifeStats.touch(place, entry.def.id, entry.def.motion, entry.def.sound);
      return true;
    },
    step(dt: number) {
      for (const entry of list) {
        if (entry.t < 0) continue;
        entry.t += dt;
        if (entry.thenAt >= 0 && entry.t >= entry.thenAt && entry.def.then) {
          host.playFile(entry.def.then.sound, entry.def.then.volume);
          entry.thenAt = -1;
        }
        if (entry.t >= entry.def.duration) {
          entry.motion(-1, entry.state);
          entry.t = -1;
          continue;
        }
        entry.motion(entry.t, entry.state);
      }
    },
    /** For the probe: what is mounted, where, and whether each is in reach. */
    list: () => list.map((e) => ({ id: e.def.id, label: e.def.label, x: e.def.x, z: e.def.z, r: e.def.r, active: e.t >= 0 })),
  };
};

export type Touchables = ReturnType<typeof createTouchables>;
