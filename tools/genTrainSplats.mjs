#!/usr/bin/env node
/**
 * Generate the Gaussian Splat (.splat) scene assets for Level 7 (The Train):
 *   - assets/splats/train-tunnel.splat   (scrolling cast-iron/concrete subway tunnel, ribs, cables, trackbed, amber lamps)
 *   - assets/splats/train-station.splat  (cavernous unnamed north station platform, wet tiles, green band, pillars, exit stairs)
 *   - assets/splats/train-car.splat      (volumetric ceiling light bloom, threshold scuff, coupled next-car vestibule silhouettes)
 *
 * Binary .splat format (32 bytes per splat, compatible with BABYLON.GaussianSplattingMesh):
 *   0..11  Float32[3] position (x, -y, z)  -- Note: Babylon's _makeSplat negates float[1] (y = -fBuffer[8*i+1]).
 *  12..23  Float32[3] scale    (sx, sy, sz)
 *  24..27  Uint8[4]   color    (r, g, b, a)
 *  28..31  Uint8[4]   rot      (qw, qx, qy, qz) mapped via round(q * 127.5 + 127.5)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'assets', 'splats');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function quatFromEuler(rx = 0, ry = 0, rz = 0) {
  const cx = Math.cos(rx * 0.5), sx = Math.sin(rx * 0.5);
  const cy = Math.cos(ry * 0.5), sy = Math.sin(ry * 0.5);
  const cz = Math.cos(rz * 0.5), sz = Math.sin(rz * 0.5);
  const qw = cx * cy * cz + sx * sy * sz;
  const qx = sx * cy * cz - cx * sy * sz;
  const qy = cx * sy * cz + sx * cy * sz;
  const qz = cx * cy * sz - sx * sy * cz;
  return [
    clampByte(qw * 127.5 + 127.5),
    clampByte(qx * 127.5 + 127.5),
    clampByte(qy * 127.5 + 127.5),
    clampByte(qz * 127.5 + 127.5),
  ];
}

class SplatBuilder {
  constructor() {
    this.records = [];
  }

  add(x, y, z, sx, sy, sz, r, g, b, a = 220, rot = [255, 128, 128, 128]) {
    this.records.push({ x, y, z, sx, sy, sz, r, g, b, a, rot });
  }

  toBuffer() {
    const count = this.records.length;
    const buf = new ArrayBuffer(count * 32);
    const f32 = new Float32Array(buf);
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < count; i++) {
      const s = this.records[i];
      const fBase = i * 8;
      const uBase = i * 32;
      f32[fBase + 0] = s.x;
      f32[fBase + 1] = -s.y; // Babylon GaussianSplattingMesh negates Y on load
      f32[fBase + 2] = s.z;
      f32[fBase + 3] = s.sx;
      f32[fBase + 4] = s.sy;
      f32[fBase + 5] = s.sz;
      u8[uBase + 24] = clampByte(s.r);
      u8[uBase + 25] = clampByte(s.g);
      u8[uBase + 26] = clampByte(s.b);
      u8[uBase + 27] = clampByte(s.a);
      u8[uBase + 28] = s.rot[0];
      u8[uBase + 29] = s.rot[1];
      u8[uBase + 30] = s.rot[2];
      u8[uBase + 31] = s.rot[3];
    }
    return Buffer.from(buf);
  }
}

/**
 * 1. train-tunnel.splat
 * Periodic every LAMP_GAP = 11.0 m so scrolling by -(scroll % 11.0) is seamless.
 * Covers x in [-11.0, 44.0] (5 periods = 55 m), wrapping the 18 m car with generous margin past both end doors.
 */
function buildTunnelSplats() {
  const rng = mulberry32(0x74756e6c);
  const b = new SplatBuilder();
  const LAMP_GAP = 11.0;
  const X_MIN = -11.0;
  const X_MAX = 44.0;
  const RIB_STEP = LAMP_GAP / 7; // 7 ribs per 11m period -> perfectly periodic with LAMP_GAP

  // Helper: distance to nearest lamp on side s (+1 north, -1 south)
  function lampGlowAt(x, y, side) {
    const offset = side < 0 ? LAMP_GAP * 0.5 : 0.0;
    const phase = ((((x - offset) % LAMP_GAP) + LAMP_GAP + LAMP_GAP * 0.5) % LAMP_GAP) - LAMP_GAP * 0.5;
    const dy = y - 1.76;
    const d2 = phase * phase + dy * dy * 1.8;
    return Math.exp(-d2 * 0.32);
  }

  // Tunnel masonry walls & arched vault on both sides (s = -1 south, s = +1 north)
  for (const side of [-1, 1]) {
    const zWall = side * 2.62;
    for (let x = X_MIN; x < X_MAX; x += 0.34) {
      for (let y = -0.35; y <= 2.95; y += 0.24) {
        const jx = x + (rng() - 0.5) * 0.14;
        const jy = y + (rng() - 0.5) * 0.10;
        // Slight inward curve near the top of the tunnel wall
        const archIn = jy > 1.9 ? (jy - 1.9) * (jy - 1.9) * 0.26 : 0;
        const jz = zWall - side * archIn + (rng() - 0.5) * 0.05;
        const glow = lampGlowAt(jx, jy, side);
        const grit = 0.85 + 0.3 * rng();
        const r = (22 + 95 * glow) * grit;
        const g = (25 + 68 * glow) * grit;
        const bl = (32 + 34 * glow) * grit;
        b.add(jx, jy, jz, 0.22, 0.16, 0.06, r, g, bl, 235);
      }
    }

    // Cast-iron tunnel ribs every RIB_STEP
    for (let rx = X_MIN; rx <= X_MAX; rx += RIB_STEP) {
      for (let y = -0.4; y <= 3.15; y += 0.13) {
        const archIn = y > 1.8 ? (y - 1.8) * (y - 1.8) * 0.28 : 0;
        const rz = side * (2.44 - archIn);
        const glow = lampGlowAt(rx, y, side);
        const edgeHighlight = 0.22 + 0.78 * glow;
        const r = 34 + 135 * edgeHighlight;
        const g = 36 + 98 * edgeHighlight;
        const bl = 44 + 52 * edgeHighlight;
        b.add(
          rx + (rng() - 0.5) * 0.02,
          y + (rng() - 0.5) * 0.02,
          rz,
          0.065,
          0.095,
          0.09,
          r,
          g,
          bl,
          248
        );
      }
    }

    // Horizontal power/signal conduits along tunnel walls
    const cableHeights = [0.48, 0.66, 0.82, 2.18, 2.34];
    for (const cy of cableHeights) {
      for (let x = X_MIN; x < X_MAX; x += 0.28) {
        const sag = Math.sin((x / RIB_STEP) * Math.PI) * 0.025;
        const glow = lampGlowAt(x, cy, side);
        const r = 16 + 70 * glow;
        const g = 18 + 52 * glow;
        const bl = 22 + 30 * glow;
        b.add(x, cy - sag, side * 2.48, 0.18, 0.032, 0.035, r, g, bl, 240);
      }
    }

    // Warm amber tunnel lamp fixtures + volumetric halo splats every LAMP_GAP
    const lampOffset = side < 0 ? LAMP_GAP * 0.5 : 0.0;
    for (let lx = X_MIN + lampOffset; lx <= X_MAX; lx += LAMP_GAP) {
      if (lx < X_MIN - 0.5 || lx > X_MAX + 0.5) continue;
      const lz = side * 2.38;
      const ly = 1.76;
      // Bulkhead cage + bright sodium/amber core
      b.add(lx, ly, lz, 0.16, 0.09, 0.07, 255, 232, 175, 255);
      b.add(lx, ly, lz - side * 0.04, 0.11, 0.06, 0.05, 255, 248, 215, 255);
      // Volumetric amber glow cloud around lamp
      for (let k = 0; k < 14; k++) {
        const ox = (rng() - 0.5) * 1.3;
        const oy = (rng() - 0.5) * 0.85;
        const oz = -side * (0.05 + rng() * 0.35);
        const falloff = Math.exp(-(ox * ox + oy * oy * 1.5) * 1.4);
        b.add(
          lx + ox,
          ly + oy,
          lz + oz,
          0.28 + rng() * 0.22,
          0.20 + rng() * 0.16,
          0.16 + rng() * 0.12,
          255,
          192 + 40 * falloff,
          105 + 45 * falloff,
          clampByte(38 + 75 * falloff)
        );
      }
    }
  }

  // Block signal heads on the south (-z) wall every 22m
  for (let sx = X_MIN + 3.2; sx <= X_MAX; sx += LAMP_GAP * 2) {
    const sz = -2.36;
    // Signal housing
    b.add(sx, 1.38, sz, 0.09, 0.22, 0.08, 18, 20, 24, 250);
    // Green aspect + halo
    b.add(sx, 1.45, sz + 0.04, 0.055, 0.055, 0.04, 90, 255, 145, 255);
    b.add(sx, 1.45, sz + 0.08, 0.18, 0.18, 0.12, 45, 220, 110, 85);
    // Amber lower aspect
    b.add(sx, 1.29, sz + 0.04, 0.045, 0.045, 0.04, 255, 185, 65, 235);
  }

  // Trackbed ballast, timber ties, and running rails below the car and beside it
  for (let x = X_MIN; x < X_MAX; x += 0.55) {
    // Timber sleeper/tie
    for (const tz of [-2.1, -1.65, 1.65, 2.1]) {
      const grit = 0.8 + 0.4 * rng();
      b.add(x + (rng() - 0.5) * 0.04, -0.52, tz, 0.14, 0.05, 0.28, 34 * grit, 28 * grit, 24 * grit, 235);
    }
    // Running steel rails + third rail glint
    for (const rz of [-2.25, -1.58, 1.58, 2.25]) {
      const glow = lampGlowAt(x, -0.4, rz > 0 ? 1 : -1);
      b.add(
        x,
        -0.46,
        rz,
        0.30,
        0.035,
        0.035,
        55 + 110 * glow,
        62 + 95 * glow,
        74 + 70 * glow,
        245
      );
    }
  }

  return b.toBuffer();
}

/**
 * 2. train-station.splat
 * The cavernous unnamed north station platform (z > 1.75 out to z = 7.6, x in [-5, 25]).
 * Includes wet concrete platform floor with overhead light reflections, yellow tactile safety edge,
 * tiled back wall with classic green subway mosaic band and blank name tablets, structural pillars,
 * overhead fluorescent light banks, bench, and dark exit stairs leading up at x ≈ 14.5..18.0.
 */
function buildStationSplats() {
  const rng = mulberry32(0x73746174);
  const b = new SplatBuilder();

  const X_MIN = -4.5;
  const X_MAX = 23.5;

  function ceilingPoolAt(x, z) {
    // Overhead fluorescent banks at x = 1.5, 6.5, 11.5, 16.5, 21.5 and z = 3.8
    const nearestX = Math.round((x - 1.5) / 5.0) * 5.0 + 1.5;
    const dx = x - nearestX;
    const dz = z - 3.85;
    return Math.exp(-(dx * dx * 0.22 + dz * dz * 0.35));
  }

  // 1) Platform deck (y ≈ -0.02, z in [1.80, 7.35])
  for (let x = X_MIN; x <= X_MAX; x += 0.32) {
    // Yellow tactile safety strip right along platform edge (z = 1.82..2.08)
    for (const tz of [1.85, 1.98]) {
      const pool = ceilingPoolAt(x, tz);
      const wear = 0.78 + 0.28 * rng();
      b.add(
        x + (rng() - 0.5) * 0.05,
        -0.015,
        tz + (rng() - 0.5) * 0.03,
        0.18,
        0.022,
        0.085,
        (195 + 45 * pool) * wear,
        (152 + 38 * pool) * wear,
        (36 + 22 * pool) * wear,
        248
      );
    }

    // Wet dark concrete platform tiles + glossy puddle reflection splats (z = 2.18..7.25)
    for (let z = 2.22; z <= 7.25; z += 0.36) {
      // Leave room for the stair well cut-out at x in [14.6, 18.2], z in [5.1, 7.1]
      if (x >= 14.6 && x <= 18.2 && z >= 5.1) continue;
      const pool = ceilingPoolAt(x, z);
      const puddle = Math.sin(x * 0.7 + z * 1.1) * Math.cos(x * 1.3 - z * 0.8);
      const isWet = puddle > 0.15 ? 1.0 : 0.35;
      const spec = pool * pool * isWet;
      const grit = 0.86 + 0.24 * rng();
      const r = (34 + 48 * pool + 78 * spec) * grit;
      const g = (40 + 58 * pool + 92 * spec) * grit;
      const bl = (44 + 54 * pool + 86 * spec) * grit;
      b.add(
        x + (rng() - 0.5) * 0.08,
        -0.02,
        z + (rng() - 0.5) * 0.08,
        0.21,
        0.02,
        0.21,
        r,
        g,
        bl,
        245
      );
    }
  }

  // 2) Tiled station back wall (z ≈ 7.38, y in [0.0, 3.25]) with green subway band (y in [1.52, 1.84])
  for (let x = X_MIN; x <= X_MAX; x += 0.28) {
    for (let y = 0.08; y <= 3.22; y += 0.20) {
      const pool = ceilingPoolAt(x, 6.2);
      const light = 0.45 + 0.55 * pool;
      const grit = 0.88 + 0.20 * rng();
      let r, g, bl;

      // Blank dark-bordered station name tablets every 5.0m inside the green band (unnamed station!)
      const tabletDist = Math.abs((((x - 1.5) % 5.0) + 5.0) % 5.0 - 2.5);
      if (y >= 1.50 && y <= 1.86) {
        if (tabletDist < 0.72 && y >= 1.56 && y <= 1.80) {
          // Empty charcoal tablet where the station name would normally be
          r = 22 * light;
          g = 28 * light;
          bl = 26 * light;
        } else if (y < 1.55 || y > 1.81) {
          // Crisp cream border trim line
          r = 205 * light;
          g = 214 * light;
          bl = 202 * light;
        } else {
          // Classic transit forest-green glazed mosaic band
          r = (26 + 24 * pool) * grit;
          g = (88 + 56 * pool) * grit;
          bl = (58 + 36 * pool) * grit;
        }
      } else if (y < 0.42) {
        // Dark concrete base course
        r = 38 * light * grit;
        g = 42 * light * grit;
        bl = 44 * light * grit;
      } else {
        // Glazed off-white/sage ceramic subway tiles
        const damp = y > 2.6 ? 0.78 : 1.0;
        r = (148 + 52 * pool) * grit * damp;
        g = (158 + 58 * pool) * grit * damp;
        bl = (150 + 50 * pool) * grit * damp;
      }

      b.add(
        x + (rng() - 0.5) * 0.04,
        y + (rng() - 0.5) * 0.03,
        7.38 + (rng() - 0.5) * 0.03,
        0.17,
        0.12,
        0.05,
        r,
        g,
        bl,
        245
      );
    }
  }

  // 3) Structural station pillars along z = 3.35 (x = 1.8, 6.8, 12.2, 17.6)
  // Note: x = 11.2 is STOP_DOOR, so 6.8 and 12.2 frame the open door without blocking the walk-out path!
  const pillarXs = [1.8, 6.8, 12.4, 17.8];
  for (const px of pillarXs) {
    for (let y = 0.05; y <= 3.25; y += 0.14) {
      const isBand = y >= 1.52 && y <= 1.84;
      const r = isBand ? 32 : 156;
      const g = isBand ? 96 : 166;
      const bl = isBand ? 64 : 158;
      // 4 faces of the square column (width 0.36m)
      for (const [ox, oz, sx, sz] of [
        [0, -0.18, 0.16, 0.05],
        [0, 0.18, 0.16, 0.05],
        [-0.18, 0, 0.05, 0.16],
        [0.18, 0, 0.05, 0.16],
      ]) {
        const grit = 0.88 + 0.22 * rng();
        b.add(px + ox, y, 3.35 + oz, sx, 0.09, sz, r * grit, g * grit, bl * grit, 250);
      }
    }
  }

  // 4) Overhead station ceiling coffer vault (y ≈ 3.32) & fluorescent light banks (y = 2.98, z = 3.85)
  for (let x = X_MIN; x <= X_MAX; x += 0.45) {
    for (let z = 1.95; z <= 7.25; z += 0.48) {
      const pool = ceilingPoolAt(x, z);
      b.add(
        x + (rng() - 0.5) * 0.1,
        3.32 + (rng() - 0.5) * 0.04,
        z + (rng() - 0.5) * 0.1,
        0.28,
        0.05,
        0.28,
        28 + 38 * pool,
        34 + 44 * pool,
        36 + 42 * pool,
        235
      );
    }
  }

  for (const lx of [1.5, 6.5, 11.5, 16.5, 21.5]) {
    for (let dx = -1.1; dx <= 1.1; dx += 0.22) {
      // Bright cool-white fluorescent tubes
      b.add(lx + dx, 2.98, 3.85, 0.15, 0.04, 0.12, 225, 248, 238, 255);
      // Soft volumetric light haze below fixture
      b.add(lx + dx, 2.78, 3.85, 0.34, 0.22, 0.32, 165, 215, 198, 68);
    }
  }

  // 5) Wooden/steel station bench at x in [3.6, 5.6], z = 5.35
  for (let bx = 3.6; bx <= 5.6; bx += 0.16) {
    // Seat slats & backrest
    b.add(bx, 0.46, 5.25, 0.10, 0.04, 0.18, 98, 68, 42, 248);
    b.add(bx, 0.72, 5.42, 0.10, 0.16, 0.04, 92, 64, 38, 248);
  }

  // 6) Dark exit stairs leading up into shadow at x in [14.6, 18.2], z in [5.1, 7.1]
  for (let step = 0; step < 12; step++) {
    const sx = 14.7 + step * 0.28;
    const sy = step * 0.19;
    for (let sz = 5.2; sz <= 6.95; sz += 0.22) {
      const fade = Math.max(0.18, 1.0 - step * 0.075);
      b.add(sx, sy, sz, 0.16, 0.09, 0.14, 48 * fade, 54 * fade, 56 * fade, 248);
    }
    // Brushed steel handrails on both sides of the stair flight
    b.add(sx, sy + 0.82, 5.15, 0.16, 0.035, 0.035, 135, 145, 150, 245);
    b.add(sx, sy + 0.82, 7.02, 0.16, 0.035, 0.035, 135, 145, 150, 245);
  }

  // 7) South trackside wall (z ≈ -2.58) & trackbed opposite the platform so south windows see 3D splats at the stop
  for (let x = X_MIN; x <= X_MAX; x += 0.42) {
    const pool = ceilingPoolAt(x, 2.2);
    for (let y = -0.35; y <= 2.85; y += 0.28) {
      const grit = 0.85 + 0.25 * rng();
      b.add(
        x + (rng() - 0.5) * 0.08,
        y + (rng() - 0.5) * 0.08,
        -2.58 + (rng() - 0.5) * 0.04,
        0.24,
        0.18,
        0.06,
        (26 + 42 * pool) * grit,
        (32 + 52 * pool) * grit,
        (36 + 48 * pool) * grit,
        238
      );
    }
    // South running rail & ties
    b.add(x, -0.46, -1.62, 0.26, 0.035, 0.04, 68 + 60 * pool, 76 + 65 * pool, 82 + 60 * pool, 242);
  }

  return b.toBuffer();
}

/**
 * 3. train-car.splat
 * Volumetric car interior & coupled next-car vestibule splats:
 * - Soft warm-white volumetric light bloom along the two ceiling light troughs (z = ±0.62, y ≈ 2.34)
 * - Subtle window-sill grazing light & open-door threshold atmospheric haze
 * - Coupled next-car dark silhouette beyond the front (x > 18.2) and rear (x < -0.2) end-door windows
 */
function buildCarSplats() {
  const rng = mulberry32(0x63617237);
  const b = new SplatBuilder();

  // 1) Ceiling light-strip volumetric bloom along z = ±0.62, y = 2.33, x in [0.4, 17.6]
  for (const sz of [-0.62, 0.62]) {
    for (let x = 0.4; x <= 17.6; x += 0.26) {
      // Bright diffuser core splat
      b.add(x, 2.36, sz, 0.16, 0.025, 0.065, 255, 248, 232, 165);
      // Soft warm atmospheric bloom halo just beneath the ceiling trough
      b.add(
        x + (rng() - 0.5) * 0.06,
        2.26 + (rng() - 0.5) * 0.03,
        sz + (rng() - 0.5) * 0.05,
        0.24,
        0.09,
        0.16,
        248,
        232,
        204,
        42
      );
    }
  }

  // 2) Floor threshold scuff & damp aisle sheen splats (y = 0.012, kept low so floor stays crisp)
  for (const dx of [3.2, 11.2, 14.8]) {
    for (const side of [-1, 1]) {
      for (let k = 0; k < 18; k++) {
        const ox = (rng() - 0.5) * 1.1;
        const oz = side * (1.05 + rng() * 0.38);
        b.add(dx + ox, 0.012, oz, 0.14, 0.008, 0.10, 58, 64, 70, 65);
      }
    }
  }

  // 3) Coupled next-car silhouette beyond front (x = 18.35..20.8) and rear (x = -2.8..-0.35) end-door glass
  for (const dir of [-1, 1]) {
    const baseX = dir > 0 ? 18.45 : -0.45;
    // Accordion rubber gangway bellows
    for (let step = 0; step < 6; step++) {
      const gx = baseX + dir * (step * 0.14);
      for (let a = 0; a < 18; a++) {
        const t = (a / 17) * Math.PI - Math.PI * 0.5;
        const gz = Math.sin(t) * 0.62;
        const gy = 1.1 + Math.cos(t) * 0.95;
        b.add(gx, gy, gz, 0.07, 0.11, 0.09, 24, 26, 30, 235);
      }
    }
    // Next car interior shell silhouette + dim amber ceiling strip visible through the end door
    for (let d = 0.9; d <= 2.6; d += 0.24) {
      const cx = baseX + dir * d;
      // Next car ceiling glow
      b.add(cx, 2.25, -0.42, 0.18, 0.06, 0.10, 215, 192, 152, 160);
      b.add(cx, 2.25, 0.42, 0.18, 0.06, 0.10, 215, 192, 152, 160);
      // Next car side walls and end door frame
      for (let y = 0.2; y <= 2.2; y += 0.24) {
        b.add(cx, y, -0.95, 0.16, 0.16, 0.08, 38, 42, 48, 225);
        b.add(cx, y, 0.95, 0.16, 0.16, 0.08, 38, 42, 48, 225);
      }
    }
  }

  return b.toBuffer();
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const tunnelBuf = buildTunnelSplats();
const stationBuf = buildStationSplats();
const carBuf = buildCarSplats();

fs.writeFileSync(path.join(OUT_DIR, 'train-tunnel.splat'), tunnelBuf);
fs.writeFileSync(path.join(OUT_DIR, 'train-station.splat'), stationBuf);
fs.writeFileSync(path.join(OUT_DIR, 'train-car.splat'), carBuf);

console.log(
  `Generated Gaussian Splat assets in ${OUT_DIR}:\n` +
    `  train-tunnel.splat:  ${tunnelBuf.length / 32} splats (${(tunnelBuf.length / 1024).toFixed(1)} KB)\n` +
    `  train-station.splat: ${stationBuf.length / 32} splats (${(stationBuf.length / 1024).toFixed(1)} KB)\n` +
    `  train-car.splat:     ${carBuf.length / 32} splats (${(carBuf.length / 1024).toFixed(1)} KB)`
);
