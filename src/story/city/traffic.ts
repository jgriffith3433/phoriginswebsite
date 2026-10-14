import * as BABYLON from '@babylonjs/core';

import { detachSharedProbe, loadGlbByAssetId } from '../../game/modelLoader';
import type { Junction, Lane } from './layout';
import { type V2, cumulative, pointAt, quadBezier, lineHit } from './math2';
import type { CityWorld } from './world';

/** Car model faces +x under its mount. Root yaw = heading yaw minus a quarter turn. */
const CAR_YAW = -Math.PI / 2;

type Turn = { pts: V2[]; cum: number[]; len: number; next: Lane; from: Junction };

type Car = {
  root: BABYLON.TransformNode;
  lane: Lane;
  s: number;
  speed: number;
  turn: Turn | null;
  ts: number;
  passed: boolean;
  wait: number;
  x: number;
  z: number;
  hx: number;
  hz: number;
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
      for (const sub of mesh.material.subMaterials) if (sub) materials.push(sub);
    }
  }
  detachSharedProbe(materials);
  // Textures stay with the parsed prop container. Disposing them blanks the next copy.
  holder.dispose(false, false);
};

export type TrafficHit = { x: number; z: number };

export const createTraffic = (scene: BABYLON.Scene, world: CityWorld, count: number) => {
  const cars: Car[] = [];
  const lampMat = new BABYLON.StandardMaterial('city-car-lamps', scene);
  lampMat.disableLighting = true;
  lampMat.emissiveColor = BABYLON.Color3.White();
  lampMat.diffuseColor = BABYLON.Color3.Black();
  lampMat.specularColor = BABYLON.Color3.Black();
  // Headlight pool on the road: additive, a soft radial texture.
  const beamTex = new BABYLON.DynamicTexture('city-car-beam', { width: 128, height: 128 }, scene, true);
  {
    const ctx = beamTex.getContext() as CanvasRenderingContext2D;
    const grad = ctx.createRadialGradient(64, 20, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,240,215,0.9)');
    grad.addColorStop(0.45, 'rgba(255,230,200,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    beamTex.update();
  }
  const beamMat = new BABYLON.StandardMaterial('city-car-beam', scene);
  beamMat.disableLighting = true;
  beamMat.emissiveTexture = beamTex;
  beamMat.diffuseColor = BABYLON.Color3.Black();
  beamMat.specularColor = BABYLON.Color3.Black();
  beamMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
  beamMat.alpha = 0.55;
  beamMat.disableDepthWrite = true;
  beamMat.zOffset = -4;

  const lampMesh = (name: string, parent: BABYLON.TransformNode) => {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const quad = (x: number, y: number, z: number, nx: number, w: number, h: number, c: [number, number, number]) => {
      const base = positions.length / 3;
      // Faces along x (front +x / rear -x). z spans width.
      positions.push(x, y - h, z - w, x, y - h, z + w, x, y + h, z + w, x, y + h, z - w);
      for (let i = 0; i < 4; i += 1) colors.push(c[0], c[1], c[2], 1);
      if (nx > 0) indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (const s of [-0.62, 0.62]) quad(2.27, 0.68, s, 1, 0.16, 0.06, [1.4, 1.35, 1.2]);
    for (const s of [-0.66, 0.66]) quad(-2.27, 0.72, s, -1, 0.17, 0.05, [1.3, 0.05, 0.03]);
    const mesh = new BABYLON.Mesh(name, scene);
    const data = new BABYLON.VertexData();
    data.positions = positions;
    data.colors = colors;
    data.indices = indices;
    const normals: number[] = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);
    data.normals = normals;
    data.applyToMesh(mesh);
    mesh.material = lampMat;
    mesh.parent = parent;
    mesh.isPickable = false;
    lampMat.emissiveColor = BABYLON.Color3.White();
    mesh.useVertexColors = true;
    return mesh;
  };

  const beamMesh = (name: string, parent: BABYLON.TransformNode) => {
    const mesh = BABYLON.MeshBuilder.CreateGround(name, { width: 9, height: 4.2 }, scene);
    mesh.material = beamMat;
    mesh.parent = parent;
    mesh.position.set(6.6, 0.05, 0);
    mesh.rotation.y = Math.PI / 2;
    mesh.isPickable = false;
    return mesh;
  };

  const lanes = world.city.lanes;
  const laneCars = new Map<Lane, Car[]>();
  const junctionBusy = new Map<Junction, Car>();

  const place = (car: Car) => {
    let x: number;
    let z: number;
    let hx: number;
    let hz: number;
    if (car.turn) {
      const p = pointAt(car.turn.pts, car.turn.cum, car.ts);
      const q = pointAt(car.turn.pts, car.turn.cum, Math.min(car.turn.len, car.ts + 1));
      const r = pointAt(car.turn.pts, car.turn.cum, Math.max(0, car.ts - 1));
      x = p.x;
      z = p.z;
      hx = q.x - r.x;
      hz = q.z - r.z;
    } else {
      const lane = car.lane;
      const p = pointAt(lane.pts, lane.cum, car.s);
      const q = pointAt(lane.pts, lane.cum, Math.min(lane.len, car.s + 1));
      const r = pointAt(lane.pts, lane.cum, Math.max(0, car.s - 1));
      x = p.x;
      z = p.z;
      hx = q.x - r.x;
      hz = q.z - r.z;
    }
    const l = Math.hypot(hx, hz) || 1;
    car.x = x;
    car.z = z;
    car.hx = hx / l;
    car.hz = hz / l;
    car.root.position.set(x, 0, z);
    car.root.rotation.y = Math.atan2(car.hx, car.hz) + CAR_YAW;
  };

  const occupy = (car: Car, lane: Lane) => {
    const old = laneCars.get(car.lane);
    if (old) {
      const i = old.indexOf(car);
      if (i >= 0) old.splice(i, 1);
    }
    car.lane = lane;
    const list = laneCars.get(lane) ?? [];
    list.push(car);
    laneCars.set(lane, list);
  };

  const spawnOn = (car: Car, px: number, pz: number, fx: number, fz: number, first: boolean) => {
    for (let tries = 0; tries < 30; tries += 1) {
      const hits = world.city.grids.lanes.query(px - 170, pz - 170, px + 170, pz + 170);
      const list = [...hits];
      if (!list.length) return false;
      const pick = list[Math.floor(Math.random() * list.length)];
      const lane = pick.lane;
      const s = Math.min(lane.len - 2, lane.cum[pick.i] + Math.random() * 4);
      const p = pointAt(lane.pts, lane.cum, s);
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d < (first ? 18 : 70) || d > 170) continue;
      if (!first && ((p.x - px) * fx + (p.z - pz) * fz) / d > 0.35 && d < 130) continue;
      if ((laneCars.get(lane) ?? []).some((other) => Math.abs(other.s - s) < 14)) continue;
      car.turn = null;
      occupy(car, lane);
      car.s = s;
      car.speed = lane.speed * 0.7;
      car.wait = 0;
      place(car);
      car.root.setEnabled(true);
      return true;
    }
    return false;
  };

  const makeCar = (index: number) => {
    const root = new BABYLON.TransformNode(`street-car-${index}`, scene);
    const mount = new BABYLON.TransformNode(`street-car-${index}-body`, scene);
    mount.parent = root;
    mount.rotation.y = -Math.PI / 2;
    void loadCarSource(scene).then((source) => {
      if (!source || mount.isDisposed()) return;
      for (const child of source.getChildren()) {
        const copy = child.clone(`street-car-${index}-${child.name}`, mount);
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
    lampMesh(`street-car-${index}-lamps`, root);
    beamMesh(`street-car-${index}-beam`, root);
    const car: Car = { root, lane: lanes[0], s: 0, speed: 0, turn: null, ts: 0, passed: false, wait: 0, x: 0, z: 0, hx: 1, hz: 0 };
    return car;
  };

  const buildTurn = (from: Lane, next: Lane): Turn => {
    const a = from.pts[from.pts.length - 1];
    const a0 = from.pts[from.pts.length - 2] ?? a;
    const b = next.pts[0];
    const b1 = next.pts[1] ?? b;
    const da = { x: a.x - a0.x, z: a.z - a0.z };
    const db = { x: b1.x - b.x, z: b1.z - b.z };
    const hit = lineHit(a, da, b, db);
    let ctrl: V2 = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const gap = Math.hypot(b.x - a.x, b.z - a.z);
    if (hit && hit.t > 0 && Math.hypot(hit.x - a.x, hit.z - a.z) < gap * 1.2) ctrl = { x: hit.x, z: hit.z };
    let pts: V2[];
    if (from.piece === next.piece) {
      // Turnaround in a cul-de-sac bulb.
      const j = from.to;
      const out = { x: a.x - j.x, z: a.z - j.z };
      pts = [a, { x: j.x - out.z * 1.6 + (a.x - j.x) * -0.4, z: j.z + out.x * 1.6 + (a.z - j.z) * -0.4 }, b];
      pts = quadBezier(pts[0], pts[1], pts[2], 12);
    } else {
      pts = quadBezier(a, ctrl, b, 10);
    }
    const cum = cumulative(pts);
    return { pts, cum, len: cum[cum.length - 1], next, from: from.to };
  };

  const axisGreen = (axis: 'x' | 'z' | '', sig: ReturnType<CityWorld['signals']>) => {
    const st = axis === 'x' ? sig.x : sig.z;
    return st;
  };

  let pumped = 0;

  return {
    mount: (x: number, z: number) => {
      for (let i = 0; i < count; i += 1) {
        const car = makeCar(i);
        cars.push(car);
        if (!spawnOn(car, x, z, 0, 1, true)) car.root.setEnabled(false);
      }
    },
    cars: () => cars,
    step: (dt: number, player: { x: number; z: number }, camera: { fx: number; fz: number }, freeze: boolean, onPass: (dist: number) => void) => {
      const sig = world.signals();
      for (const car of cars) {
        if (!car.root.isEnabled()) {
          if (pumped <= 0 && spawnOn(car, player.x, player.z, camera.fx, camera.fz, false)) pumped = 0.4;
          continue;
        }
        const d = Math.hypot(car.x - player.x, car.z - player.z);
        if (d > 230) {
          car.root.setEnabled(false);
          const list = laneCars.get(car.lane);
          if (list) list.splice(list.indexOf(car), 1);
          if (junctionBusy.get(car.lane.to) === car) junctionBusy.delete(car.lane.to);
          continue;
        }
        if (freeze) {
          place(car);
          continue;
        }
        const lane = car.lane;
        let target = (car.turn ? lane.speed * 0.6 : lane.speed);
        if (!car.turn) {
          // Car ahead.
          let gap = Infinity;
          for (const other of laneCars.get(lane) ?? []) {
            if (other === car || other.turn) continue;
            const ds = other.s - car.s;
            if (ds > 0 && ds < gap) gap = ds;
          }
          if (gap < Infinity) target = Math.min(target, Math.max(0, (gap - 7.5) * 0.9));
          // Signals.
          const toStop = lane.stopAt - car.s;
          if (lane.signal && toStop > -0.5) {
            const st = axisGreen(lane.axis, sig);
            const brakeRoom = (car.speed * car.speed) / (2 * 5.5) + 1;
            if (st === 2 || (st === 1 && toStop > brakeRoom * 0.6)) target = Math.min(target, Math.max(0, toStop - 0.4) * 0.8);
          } else if (!lane.signal && lane.len - car.s < 8) {
            const busy = junctionBusy.get(lane.to);
            if (busy && busy !== car) target = Math.min(target, Math.max(0, lane.len - car.s - 2) * 0.7);
          }
        }
        // The player in front.
        const ax = player.x - car.x;
        const az = player.z - car.z;
        const along = ax * car.hx + az * car.hz;
        const across = Math.abs(-ax * car.hz + az * car.hx);
        if (along > 2 && along < 13 && across < 1.6) target = Math.min(target, Math.max(0, along - 4.5) * 0.9);
        const accel = target > car.speed ? 2.6 : 7.5;
        car.speed += Math.sign(target - car.speed) * Math.min(Math.abs(target - car.speed), accel * dt);
        const step = car.speed * dt;
        if (car.turn) {
          car.ts += step;
          if (car.ts >= car.turn.len) {
            const next = car.turn.next;
            if (junctionBusy.get(car.turn.from) === car) junctionBusy.delete(car.turn.from);
            car.turn = null;
            occupy(car, next);
            car.s = 0;
          }
        } else {
          car.s += step;
          if (car.s >= lane.len) {
            const options = lane.next.length ? lane.next : [];
            if (!options.length) {
              car.root.setEnabled(false);
              continue;
            }
            const next = options[Math.floor(Math.random() * options.length)];
            car.turn = buildTurn(lane, next);
            car.ts = car.s - lane.len;
            if (!lane.signal) junctionBusy.set(lane.to, car);
          }
        }
        place(car);
        // Pass-by sound.
        if (along > -3 && along < 3 && across < 9) {
          if (!car.passed && car.speed > 3) {
            car.passed = true;
            onPass(d);
          }
        } else if (Math.abs(along) > 8) car.passed = false;
      }
      pumped -= dt;
    },
    /** A moving car that is on the player. */
    hits: (player: { x: number; z: number }) => {
      for (const car of cars) {
        if (!car.root.isEnabled() || car.speed < 2.2) continue;
        const ax = player.x - car.x;
        const az = player.z - car.z;
        const along = ax * car.hx + az * car.hz;
        const across = -ax * car.hz + az * car.hx;
        if (Math.abs(along) < 2.4 && Math.abs(across) < 1.15) {
          const side = across >= 0 ? 1 : -1;
          car.speed = 0;
          return { x: car.x - car.hz * side * 3.6, z: car.z + car.hx * side * 3.6 } as TrafficHit;
        }
      }
      return null;
    },
    dispose: () => {
      for (const car of cars) car.root.dispose(false, false);
      cars.length = 0;
      laneCars.clear();
      junctionBusy.clear();
      lampMat.dispose();
      beamMat.dispose();
      beamTex.dispose();
      releaseCarSource();
    },
  };
};

export type Traffic = ReturnType<typeof createTraffic>;
