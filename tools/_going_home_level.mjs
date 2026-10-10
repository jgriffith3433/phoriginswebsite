import { writeFileSync } from 'node:fs';

const assets = [];
const wall = (id, x, y, z, sx, sy, sz, materialId, name = id) => {
  assets.push({
    id,
    assetId: 'structure-wall',
    kind: 'wall',
    name,
    x, y, z,
    scale: { x: sx, y: sy, z: sz },
    materialId,
    components: ['Transform'],
  });
};
const ground = (id, x, z, sx, sz, materialId, y = 0) => {
  assets.push({
    id,
    assetId: 'structure-ground',
    kind: 'ground',
    name: id,
    x, y, z,
    scale: { x: sx, y: 1, z: sz },
    materialId,
    components: ['Transform'],
  });
};
const model = (id, assetId, x, y, z, yaw = 0) => {
  assets.push({
    id,
    assetId,
    kind: 'model',
    name: id,
    x, y, z,
    rotation: { x: 0, y: yaw, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    components: ['Transform'],
  });
};
const windowsZ = (id, x, y0, z0, cols, rows, spanZ, spanY) => {
  const sz = spanZ / cols * 0.62;
  const sy = spanY / rows * 0.55;
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const z = z0 - spanZ / 2 + (c + 0.5) * (spanZ / cols);
      const y = y0 + (r + 0.5) * (spanY / rows);
      wall(`${id}-${c}-${r}`, x, y, z, 0.08, sy, sz, 'mat-street-window');
    }
  }
};
const windows = (id, x0, y0, z, cols, rows, spanX, spanY, depth = 0.08) => {
  const sx = spanX / cols * 0.62;
  const sy = spanY / rows * 0.55;
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const x = x0 - spanX / 2 + (c + 0.5) * (spanX / cols);
      const y = y0 + (r + 0.5) * (spanY / rows);
      wall(`${id}-${c}-${r}`, x, y, z, sx, sy, depth, 'mat-street-window');
    }
  }
};

const city = () => {
  const mats = ['mat-board-wall', 'mat-hall-wall', 'mat-office-wall'];
  const ew = [-29, 87, 145, 203];
  const ns = [-108, -50, 22, 80, 138, 196, 254, 312];
  const half = 7;
  const xs = [-158, ...ns, 348];
  const zs = [-138, ...ew.slice(0, 1), 29, ...ew.slice(1), 258];
  let n = 0;
  const strips = (id, axis, x, z, span, height) => {
    if (height < 14) return;
    for (let band = 0; band < 2; band += 1) {
      const y = height * (0.38 + band * 0.28);
      const idn = `b3-decal-win-${id}-${band}`;
      if (axis === 'x') wall(idn, x, y, z, span * 0.62, Math.min(3.2, height * 0.08), 0.16, 'mat-street-window');
      else wall(idn, x, y, z, 0.16, Math.min(3.2, height * 0.08), span * 0.62, 'mat-street-window');
    }
  };
  const place = (x0, x1, z0, z1, key) => {
    if (z1 > 16 && z0 < 43) {
      if (z0 < 16) z1 = Math.min(z1, 14.5);
      else if (z1 > 43) z0 = Math.max(z0, 44);
      else return;
    }
    if (x1 > -11 && x0 < 11 && z1 > -2 && z0 < 20) {
      if (z0 < -2) z1 = Math.min(z1, -3);
      else return;
    }
    if (x1 - x0 < 14 || z1 - z0 < 12) return;
    const wide = x1 - x0 > 46;
    const deep = z1 - z0 > 46;
    const parts = [[x0, x1, z0, z1]];
    if (wide) {
      const mid = (x0 + x1) / 2;
      parts.splice(0, 1, [x0, mid - 3.5, z0, z1], [mid + 3.5, x1, z0, z1]);
    } else if (deep) {
      const mid = (z0 + z1) / 2;
      parts.splice(0, 1, [x0, x1, z0, mid - 3.5], [x0, x1, mid + 3.5, z1]);
    }
    for (const [ax0, ax1, az0, az1] of parts) {
      if (ax1 - ax0 < 12 || az1 - az0 < 10) continue;
      const height = 16 + ((key * 17 + n * 11) % 58);
      const cx = (ax0 + ax1) / 2;
      const cz = (az0 + az1) / 2;
      const sx = ax1 - ax0 - 1.5;
      const sz = az1 - az0 - 1.5;
      const mat = mats[(key + n) % mats.length];
      const id = `block-${n}`;
      wall(id, cx, height / 2, cz, sx, height, sz, mat);
      strips(`${id}-s`, 'x', cx, cz - sz / 2 - 0.12, sx, height);
      strips(`${id}-n`, 'x', cx, cz + sz / 2 + 0.12, sx, height);
      n += 1;
    }
  };
  for (let i = 0; i < xs.length - 1; i += 1) {
    for (let j = 0; j < zs.length - 1; j += 1) {
      place(xs[i] + half + 1.5, xs[i + 1] - half - 1.5, zs[j] + half + 1.5, zs[j + 1] - half - 1.5, i + j * 3);
    }
  }
  wall('city-south', 95, 52, -152, 530, 104, 14, 'mat-board-wall');
  wall('city-north', 95, 58, 272, 530, 116, 14, 'mat-hall-wall');
  wall('city-west', -172, 54, 60, 14, 108, 450, 'mat-office-wall');
  wall('city-east', 362, 60, 60, 14, 120, 450, 'mat-board-wall');
  for (const z of ew) {
    wall(`b3-decal-ave-${z}`, 95, 0.035, z, 500, 0.04, 10, 'mat-b3-floor', `b3-decal-ave-${z}`);
  }
  for (const x of ns) {
    wall(`b3-decal-cross-${x}`, x, 0.05, 60, 10, 0.04, 390, 'mat-b3-floor', `b3-decal-cross-${x}`);
  }
};

const pit = { x0: 163.2, x1: 171.8, z0: 18.6, z1: 23.8 };
const slab = (id, x0, x1, z0, z1) => {
  if (x1 - x0 < 0.4 || z1 - z0 < 0.4) return;
  ground(id, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 'mat-hall-floor');
};
const gx0 = 95 - 360;
const gx1 = 95 + 360;
const gz0 = 60 - 280;
const gz1 = 60 + 280;
slab('street-ground-w', gx0, pit.x0, gz0, gz1);
slab('street-ground-e', pit.x1, gx1, gz0, gz1);
slab('street-ground-n', pit.x0, pit.x1, pit.z1, gz1);
slab('street-ground-s', pit.x0, pit.x1, gz0, pit.z0);
ground('lobby-floor', 0, 9, 13.4, 17.2, 'mat-board-floor', 0.02);
wall('b3-decal-road', 95, 0.03, 29, 500, 0.04, 10, 'mat-b3-floor', 'b3-decal-road');
for (const lane of [-120, -70, -20, 30, 80, 130, 180, 230, 280]) {
  wall(`b3-decal-lane-${lane}`, lane, 0.06, 29, 16, 0.02, 0.18, 'mat-b3-hazard', `b3-decal-lane-${lane}`);
}

wall('lobby-west', -7, 1.6, 9, 0.28, 3.2, 17.6, 'mat-office-wall');
wall('lobby-east', 7, 1.6, 9, 0.28, 3.2, 17.6, 'mat-office-wall');
wall('lobby-south-l', -4.1, 1.6, 0.4, 5.6, 3.2, 0.28, 'mat-lift-metal');
wall('lobby-south-r', 4.1, 1.6, 0.4, 5.6, 3.2, 0.28, 'mat-lift-metal');
wall('lobby-door-l', -0.58, 1.15, 1.15, 1.05, 2.3, 0.12, 'mat-lift-metal', 'lobby-door-l');
wall('lobby-door-r', 0.58, 1.15, 1.15, 1.05, 2.3, 0.12, 'mat-lift-metal', 'lobby-door-r');
wall('lobby-glass-l', -4.3, 1.6, 17.7, 5.2, 3.2, 0.08, 'mat-office-glass');
wall('lobby-glass-r', 4.3, 1.6, 17.7, 5.2, 3.2, 0.08, 'mat-office-glass');
wall('lobby-header', 0, 2.9, 17.7, 3.4, 0.6, 0.12, 'mat-lift-metal');
wall('lobby-ceil', 0, 3.28, 9, 13.6, 0.12, 17.2, 'mat-ceil-tile');

wall('tower', 0, 29.2, 9, 16, 52, 16, 'mat-board-wall');
windows('tower-win', 0, 8, 17.15, 4, 8, 12, 40, 0.06);
city();

const subway = () => {
  const x0 = pit.x0;
  const x1 = pit.x1;
  const z0 = pit.z0;
  const z1 = pit.z1;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  ground('station-pit-floor', cx, cz, x1 - x0 - 0.4, z1 - z0 - 0.4, 'mat-b3-floor', -1.45);
  wall('station-pit-s', cx, -0.2, z0, x1 - x0, 2.9, 0.28, 'mat-lift-metal');
  wall('station-pit-n', cx, -0.2, z1, x1 - x0, 2.9, 0.28, 'mat-lift-metal');
  wall('station-pit-e', x1, -0.2, cz, 0.28, 2.9, z1 - z0, 'mat-lift-metal');
  wall('station-parapet-s', cx, 0.55, z0 - 0.2, x1 - x0 + 0.8, 1.1, 0.16, 'mat-lift-metal');
  wall('station-parapet-n', cx, 0.55, z1 + 0.2, x1 - x0 + 0.8, 1.1, 0.16, 'mat-lift-metal');
  wall('station-canopy', cx - 0.4, 3.05, cz, 7.4, 0.14, z1 - z0 + 1.2, 'mat-lift-metal');
  wall('b3-decal-station-sign', x0 + 0.35, 2.45, cz, 0.12, 0.62, 2.6, 'mat-street-window', 'b3-decal-station-sign');
  for (const side of [-1, 1]) {
    const z = cz + side * ((z1 - z0) / 2 - 0.15);
    wall(`station-post-${side}`, x0 + 0.4, 1.55, z, 0.18, 3.1, 0.18, 'mat-lift-metal');
    wall(`station-rail-${side}`, cx + 0.3, 0.92, z, x1 - x0 - 1.2, 0.08, 0.08, 'mat-lift-metal');
  }
  for (let i = 0; i < 8; i += 1) {
    const rise = 0.17;
    const run = 0.95;
    const top = -i * rise;
    wall(
      `station-step-${i}`,
      x0 + 0.55 + i * run,
      top - rise / 2,
      cz,
      run,
      rise,
      z1 - z0 - 0.7,
      'mat-b3-floor',
    );
  }
};

subway();

for (const x of [-90, -70, -28, 6, 42, 62, 104, 122, 156, 178, 220, 242, 280, 300]) {
  wall(`lamp-post-${x}`, x, 2.1, 23.35, 0.16, 4.2, 0.16, 'mat-lift-metal');
  wall(`lamp-head-${x}`, x, 4.15, 23.35, 0.55, 0.12, 0.28, 'mat-street-window');
}

model('lobby-desk-a', 'asset-credenza', 4.55, 0.02, 3.15, Math.PI / 2);
model('lobby-desk-b', 'asset-credenza', 4.55, 0.02, 4.75, Math.PI / 2);
model('lobby-chair', 'asset-office-chair', 5.45, 0.02, 3.2, -Math.PI / 2);
model('lobby-plant-a', 'asset-office-plant', -5.3, 0.02, 3.1, 0);
model('lobby-plant-b', 'asset-office-plant', 5.3, 0.02, 14.2, 0.4);
model('lobby-board', 'asset-directory-board', 6.72, 1.25, 6.2, Math.PI / 2);
model('lobby-bin', 'asset-waste-bin', 5.6, 0.02, 12.1, 0);
model('lobby-light-a', 'asset-ceiling-troffer', -2.2, 3.05, 6, 0);
model('lobby-light-b', 'asset-ceiling-troffer', 2.2, 3.05, 12, 0);

assets.push({
  id: 'lobby-fill',
  assetId: 'structure-light',
  kind: 'light',
  name: 'lobby-fill',
  x: 0, y: 2.7, z: 8,
  intensity: 2.6,
  range: 18,
  color: [1, 0.94, 0.82],
  components: ['Transform'],
});
assets.push({
  id: 'street-medkit',
  assetId: 'structure-wall',
  kind: 'wall',
  name: 'Medkit',
  x: 10, y: 0.35, z: 21.35,
  pickup: { item: 'medkit', amount: 1 },
  components: ['Transform'],
});
assets.push({
  id: 'street-ammo',
  assetId: 'structure-wall',
  kind: 'wall',
  name: 'Ammo',
  x: 28, y: 0.35, z: 21.15,
  pickup: { item: 'ammo', amount: 1 },
  components: ['Transform'],
});

const scene = {
  id: 'going-home',
  name: 'Going Home',
  theme: 'Street',
  ambient: 0.78,
  assets,
  triggers: [
    {
      id: 'street-bed',
      type: 'music',
      x: 80,
      y: 0,
      z: 40,
      data: {
        audio: '/assets/audio/room-tone.mp3',
        radius: 520,
        volume: 0.24,
        loop: true,
        fadeSeconds: 1.5,
      },
    },
  ],
};

writeFileSync(new URL('../levels/going-home.json', import.meta.url), `${JSON.stringify(scene, null, 2)}\n`);
console.log('assets', assets.length);
