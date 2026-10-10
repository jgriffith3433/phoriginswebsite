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
const light = (id, x, y, z, intensity, range) => {
  assets.push({
    id,
    assetId: 'structure-light',
    kind: 'light',
    name: id,
    x, y, z,
    intensity,
    range,
    color: [0.86, 0.9, 0.82],
    components: ['Transform'],
  });
};

// Walkable concourse and platform. The track is a separate lower slab.
ground('station-floor', 40, -2.4, 82, 9.6, 'mat-board-floor');
ground('track-floor', 46, 5.15, 68, 5.1, 'mat-b3-floor', -1.15);

wall('shell-west', -1.1, 1.8, -0.6, 0.4, 3.6, 16.2, 'mat-board-wall');
wall('shell-south', 40, 1.8, -7.3, 82.4, 3.6, 0.35, 'mat-office-wall');
wall('shell-east', 81.2, 1.8, -0.6, 0.4, 3.6, 16.2, 'mat-board-wall');
wall('shell-north', 46, 1.8, 7.8, 70, 3.6, 0.4, 'mat-b3-wall');
wall('shell-ceil', 40, 3.55, -0.6, 84, 0.16, 16.6, 'mat-ceil-tile');

for (let i = 0; i < 6; i += 1) {
  const rise = 0.18;
  wall(`stair-up-${i}`, 1.1 + i * 0.85, 0.2 + i * rise, -4.6, 0.85, 0.4 + i * rise * 2, 2.2, 'mat-b3-floor');
}
wall('stair-rail', 3.4, 1.15, -3.35, 5.2, 0.08, 0.08, 'mat-lift-metal');

for (const x of [12.4, 15.2, 18]) {
  wall(`stile-${x}`, x, 0.52, -4.6, 0.12, 1.05, 1.7, 'mat-lift-metal');
  wall(`stile-b-${x}`, x, 0.52, -0.4, 0.12, 1.05, 1.5, 'mat-lift-metal');
}

wall('curb-w', 28, 0.28, 2.35, 40, 0.55, 0.22, 'mat-lift-metal');
wall('curb-door', 50.3, 0.5, 2.42, 6.2, 1.0, 0.2, 'mat-lift-metal');
wall('curb-e', 66, 0.28, 2.35, 24, 0.55, 0.22, 'mat-lift-metal');
wall('b3-decal-safety', 40, 0.03, 1.95, 70, 0.02, 0.18, 'mat-b3-hazard', 'b3-decal-safety');

for (const x of [30, 44, 58, 72]) {
  wall(`column-${x}`, x, 1.8, -4.8, 0.5, 3.6, 0.5, 'mat-lift-metal');
  model(`troffer-${x}`, 'asset-ceiling-troffer', x, 3.32, -2.2, 0);
}
model('troffer-hall', 'asset-ceiling-troffer', 10, 3.32, -2.2, Math.PI / 2);
model('troffer-mid', 'asset-ceiling-troffer', 22, 3.32, -2.2, Math.PI / 2);

wall('bench-a', 34, 0.4, -5.7, 2.4, 0.4, 0.5, 'mat-lift-metal');
wall('bench-b', 62, 0.4, -5.7, 2.4, 0.4, 0.5, 'mat-lift-metal');
wall('b3-decal-sign-a', 26, 2.55, -7.05, 0.08, 0.62, 2.2, 'mat-street-window', 'b3-decal-sign-a');
wall('b3-decal-sign-b', 68, 2.55, -7.05, 0.08, 0.62, 2.2, 'mat-street-window', 'b3-decal-sign-b');

wall('train-a', 38, 1.55, 5.05, 22, 2.55, 2.5, 'mat-lift-metal');
wall('train-b', 62.2, 1.55, 5.05, 20, 2.55, 2.5, 'mat-lift-metal');
wall('b3-decal-train-win-a', 38, 2.05, 3.76, 16, 0.62, 0.06, 'mat-street-window', 'b3-decal-train-win-a');
wall('b3-decal-train-win-b', 62, 2.05, 3.76, 14, 0.62, 0.06, 'mat-street-window', 'b3-decal-train-win-b');
wall('train-door-l', 49.15, 1.35, 4.05, 0.1, 2.15, 0.7, 'mat-b3-wall');
wall('train-door-r', 51.55, 1.35, 4.05, 0.1, 2.15, 0.7, 'mat-b3-wall');

light('station-light-hall', 12, 3.05, -2.2, 2.1, 16);
light('station-light-mid', 40, 3.05, -2, 2.3, 18);
light('station-light-far', 66, 3.05, -2, 2.1, 16);

const scene = {
  id: 'the-station',
  name: 'The Station',
  theme: 'Station',
  ambient: 0.85,
  assets,
  triggers: [
    {
      id: 'station-bed',
      type: 'music',
      x: 36,
      y: 0,
      z: -1,
      data: {
        audio: '/assets/audio/room-tone.mp3',
        radius: 90,
        volume: 0.2,
        loop: true,
        fadeSeconds: 1.5,
      },
    },
  ],
};

writeFileSync(new URL('../levels/the-station.json', import.meta.url), `${JSON.stringify(scene, null, 2)}\n`);
console.log('assets', assets.length);
