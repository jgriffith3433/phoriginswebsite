import * as BABYLON from '@babylonjs/core';

import { Geo } from './city/geo';
import { AD_COPY, paintAd } from './stationDress';

/**
 * The Train, dressed at runtime: one uptown 6 car seen from inside. Molded
 * benches along both walls, steel stanchions and center poles, overhead grab
 * rails, the station's four ads in the cove above the windows, line maps over
 * the doors, two ceiling light strips (one segment fails), and windows that look
 * onto a raytraced tunnel whose lamps stream past. Lamp light sweeps through the
 * car as they pass. The car sways: `roll()` is the camera roll main.ts applies
 * after the follow camera.
 *
 * Like stationDress.ts this is overlay geometry in front of the authored shell
 * (levels/the-train.json: floor, walls, ceiling, end walls, lights). The seats
 * and poles are runtime colliders here, invisible boxes, so the player and the
 * playtest walk grid are blocked by exactly what is drawn.
 *
 * One shader, one draw call, no real lights. Cheaper than The Station's kit.
 */

/** Car interior: x along the car (0 back, 18 front, the train runs toward +x), z across, y up. */
export const CAR = { x0: 0, x1: 18, halfWidth: 1.5, ceiling: 2.42 };
/** Side door centers (both walls). */
export const DOORS_X = [2.3, 6.8, 11.2, 15.7];
const DOOR_HALF = 0.65;
/** Seat front edge, distance from the car's center line. */
const SEAT_FRONT = 1.04;
const SEAT_TOP = 0.45;
/** Tunnel lamp spacing, meters. */
const LAMP_GAP = 11;
/** Cruising speed through the tunnel, m/s. */
const CRUISE = 14;

const SURF = { SOLID: 0, FLOOR: 1, WALL: 2, SEAT: 3, WINDOW: 4, TEX: 5, CEIL: 6, STEEL: 7, LAMP: 8, DOOR: 9 };

/** Bench spans along x, between the doors and the end walls. */
const BENCHES: [number, number][] = (() => {
  const out: [number, number][] = [];
  let from = CAR.x0 + 0.25;
  for (const d of DOORS_X) {
    out.push([from, d - DOOR_HALF - 0.1]);
    from = d + DOOR_HALF + 0.1;
  }
  out.push([from, CAR.x1 - 0.25]);
  return out;
})();

const VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec2 uv2;
attribute vec4 color;
uniform mat4 worldViewProjection;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUV;
varying vec2 vSurf;
varying vec4 vColor;
void main(void) {
  vWorld = position;
  vNormal = normal;
  vUV = uv;
  vSurf = uv2;
  vColor = color;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUV;
varying vec2 vSurf;
varying vec4 vColor;
uniform vec3 cameraPos;
uniform float scroll;
uniform float speedN;
uniform float time;
uniform float flicker;
uniform sampler2D atlas;

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float sq(float x) {
  return x * x;
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Two ceiling light strips at z = +-0.62, plus tunnel lamps sweeping in through each side's windows.
vec3 lighting(vec3 n) {
  vec3 sum = vec3(0.26, 0.27, 0.28);
  float ends = smoothstep(${CAR.x0.toFixed(1)}, ${(CAR.x0 + 0.7).toFixed(1)}, vWorld.x) * (1.0 - smoothstep(${(CAR.x1 - 0.7).toFixed(1)}, ${CAR.x1.toFixed(1)}, vWorld.x));
  for (int i = 0; i < 2; i++) {
    float s = i == 0 ? 1.0 : -1.0;
    vec3 d = vec3(0.0, ${(CAR.ceiling - 0.05).toFixed(2)} - vWorld.y, s * 0.62 - vWorld.z);
    float r = length(d);
    float lam = max(dot(n, d / max(r, 0.001)), 0.0) * 0.8 + 0.2;
    float seg = floor(vWorld.x / 1.5);
    float fail = (s < 0.0 && seg == 7.0) ? flicker : 1.0;
    sum += vec3(0.95, 1.0, 0.96) * lam * 1.3 * fail * ends / (1.0 + r * r * 0.9);
    // A tunnel lamp passing this side's windows. Lamps on the -z side run half a gap behind.
    float phase = fract((vWorld.x + scroll) / ${LAMP_GAP.toFixed(1)} + (s < 0.0 ? 0.5 : 0.0)) - 0.5;
    float pass = exp(-sq(phase * ${LAMP_GAP.toFixed(1)} / 1.4));
    float facing = clamp(-s * n.z * 0.8 + 0.35, 0.0, 1.0) * (1.0 - smoothstep(0.6, 2.2, vWorld.y + 0.4 * (1.0 - abs(n.y))));
    sum += vec3(1.0, 0.8, 0.5) * pass * facing * 0.42;
  }
  return sum;
}

// The view out of a side window: a tunnel wall 1 m past the car, its ribs, cables and lamps moving by.
vec3 tunnel(vec3 V) {
  vec3 rd = -V;
  float side = vWorld.z > 0.0 ? 1.0 : -1.0;
  float outw = max(rd.z * side, 0.04);
  float dist = (2.55 - abs(vWorld.z)) / outw;
  vec2 hit = vec2(vWorld.x + rd.x * dist, vWorld.y + rd.y * dist);
  float u = hit.x + scroll + (side < 0.0 ? ${(LAMP_GAP / 2).toFixed(1)} : 0.0);
  float blur = clamp(speedN * 1.2, 0.0, 1.0);
  vec3 c;
  if (hit.y < -0.6) {
    // Trackbed: ties blur into a band at speed.
    float tie = mix(step(fract(u / 0.65), 0.35), 0.35, blur);
    c = mix(vec3(0.03, 0.028, 0.025), vec3(0.06, 0.05, 0.04), tie);
  } else if (hit.y > 3.3) {
    c = vec3(0.02, 0.02, 0.022);
  } else {
    float rib = mix(step(0.82, fract(u / 1.5)), 0.18, blur);
    c = vec3(0.05, 0.05, 0.048) * (0.75 + 0.5 * rib) * (0.75 + 0.5 * vnoise(vec2(u * 0.2, hit.y * 1.5)));
    // Cables along the wall.
    float cable = 3.0 - smoothstep(0.0, 0.03, abs(hit.y - 0.55)) - smoothstep(0.0, 0.025, abs(hit.y - 0.7)) - smoothstep(0.0, 0.03, abs(hit.y - 2.25));
    c = mix(c, vec3(0.015), clamp(cable, 0.0, 1.0));
    // Lamps, stretched by motion.
    float du = (fract(u / ${LAMP_GAP.toFixed(1)}) - 0.5) * ${LAMP_GAP.toFixed(1)};
    float stretch = 0.1 + speedN * 0.7;
    float lamp = exp(-sq(du / stretch) - sq((hit.y - 1.75) / 0.06));
    float halo = exp(-sq(du / (stretch * 3.0 + 0.4)) - sq((hit.y - 1.75) / 0.5));
    c += vec3(1.0, 0.82, 0.55) * (lamp * 2.6 + halo * 0.22);
    // Now and then a signal on the far side.
    if (side < 0.0) {
      float su = (fract(u / 53.0) - 0.5) * 53.0;
      float sig = exp(-sq(su / (0.06 + speedN * 0.5)) - sq((hit.y - 1.05) / 0.05));
      c += vec3(0.1, 1.0, 0.35) * sig * 2.0;
    }
  }
  c *= exp(-dist * 0.18);
  // Glass: a faint tint and the car's own strip lights reflected.
  float fres = pow(1.0 - abs(dot(V, vec3(0.0, 0.0, side))), 3.0);
  c = c * 0.85 + vec3(0.05, 0.06, 0.065) + vec3(0.12, 0.13, 0.13) * fres;
  return c;
}

void main(void) {
  vec3 n = normalize(vNormal);
  vec3 V = normalize(cameraPos - vWorld);
  float surf = floor(vSurf.x + 0.5);
  vec3 albedo = vColor.rgb;
  vec3 emis = vec3(0.0);
  float gloss = 0.0;
  vec2 p = vUV;

  if (surf == ${SURF.WINDOW}.0) {
    gl_FragColor = vec4(tunnel(V), 1.0);
    return;
  } else if (surf == ${SURF.FLOOR}.0) {
    float speck = step(0.78, h21(floor(p * 40.0))) * 0.06;
    float tone = 0.16 + vnoise(p * 1.3) * 0.03 + speck;
    albedo = vec3(tone, tone * 0.98, tone * 0.95);
    // Scuffed path down the aisle.
    albedo *= 1.0 - (1.0 - smoothstep(0.0, 0.9, abs(p.y))) * 0.12;
    // Yellow threshold plates at each door.
    float door = 0.0;
    ${DOORS_X.map((d) => `door = max(door, step(abs(p.x - ${d.toFixed(2)}), ${DOOR_HALF.toFixed(2)}));`).join('\n    ')}
    float plate = door * step(${(CAR.halfWidth - 0.16).toFixed(2)}, abs(p.y));
    float ridge = step(0.5, fract(p.x * 14.0));
    albedo = mix(albedo, vec3(0.62, 0.48, 0.08) * (0.8 + 0.2 * ridge), plate);
    gloss = 0.1;
  } else if (surf == ${SURF.WALL}.0) {
    vec2 f = fract(p / vec2(1.5, 3.0));
    float seam = (1.0 - smoothstep(0.0, 0.006, f.x)) * 0.5;
    albedo = vec3(0.8, 0.79, 0.74) * (1.0 - seam) * (0.94 + 0.06 * vnoise(p * 3.0));
    albedo *= 1.0 - (1.0 - smoothstep(0.0, 0.6, p.y)) * 0.25;
    gloss = 0.25;
  } else if (surf == ${SURF.SEAT}.0) {
    // Molded bench: one bucket per rider, a groove between them.
    float b = fract(p.x / 0.46);
    float groove = (1.0 - smoothstep(0.0, 0.05, min(b, 1.0 - b)));
    float bowl = 1.0 - 0.18 * sq((b - 0.5) * 2.0);
    albedo = vColor.rgb * bowl * (1.0 - groove * 0.45) * (0.92 + 0.08 * vnoise(p * 6.0));
    gloss = 0.45;
  } else if (surf == ${SURF.TEX}.0) {
    vec3 t = texture2D(atlas, p).rgb;
    albedo = t;
    emis = t * vSurf.y;
  } else if (surf == ${SURF.CEIL}.0) {
    vec2 f = fract(p / vec2(1.5, 3.0));
    float seam = (1.0 - smoothstep(0.0, 0.008, f.x)) * 0.4;
    albedo = vec3(0.86, 0.86, 0.83) * (1.0 - seam);
  } else if (surf == ${SURF.STEEL}.0) {
    // Stainless: a dark core with bright edges and the strip lights running down it.
    float edge = pow(1.0 - abs(dot(n, V)), 1.6);
    vec3 R = reflect(-V, n);
    float strip = smoothstep(0.55, 0.95, R.y);
    albedo = vec3(0.32, 0.33, 0.34) + vec3(0.5) * edge;
    emis = vec3(0.55, 0.58, 0.58) * strip;
  } else if (surf == ${SURF.LAMP}.0) {
    float seg = floor(vWorld.x / 1.5);
    float gap = smoothstep(0.02, 0.05, fract(vWorld.x / 1.5)) * smoothstep(0.02, 0.05, 1.0 - fract(vWorld.x / 1.5));
    float fail = (vWorld.z < 0.0 && seg == 7.0) ? flicker : 1.0;
    gl_FragColor = vec4(vec3(1.0, 1.0, 0.95) * mix(0.25, 1.9 * fail, gap), 1.0);
    return;
  } else if (surf == ${SURF.DOOR}.0) {
    float brush = vnoise(vec2(p.x * 2.0, p.y * 90.0)) * 0.08;
    albedo = vec3(0.52, 0.53, 0.54) + brush;
    gloss = 0.6;
  } else {
    emis = albedo * vColor.a;
  }

  vec3 lit = albedo * lighting(n) + emis;
  if (gloss > 0.0) {
    vec3 R = reflect(-V, n);
    lit += vec3(0.9, 0.95, 0.92) * pow(max(R.y, 0.0), 14.0) * gloss * 0.35;
  }
  gl_FragColor = vec4(lit, 1.0);
}
`;

type Rect = { u0: number; v0: number; u1: number; v1: number };
/** Atlas layout (UV 0..1, v up): the station's four ads, the line map, the front sign, the door decal. */
const ATLAS = {
  ads: [
    { u0: 0, v0: 0.75, u1: 0.5, v1: 1 },
    { u0: 0.5, v0: 0.75, u1: 1, v1: 1 },
    { u0: 0, v0: 0.5, u1: 0.5, v1: 0.75 },
    { u0: 0.5, v0: 0.5, u1: 1, v1: 0.75 },
  ] as Rect[],
  map: { u0: 0, v0: 0.375, u1: 1, v1: 0.5 } as Rect,
  sign: { u0: 0, v0: 0.25, u1: 0.5, v1: 0.375 } as Rect,
  decal: { u0: 0.5, v0: 0.25, u1: 1, v1: 0.375 } as Rect,
};

export const createTrainDress = (scene: BABYLON.Scene) => {
  const owned: { dispose: () => void }[] = [];
  const atlas = new BABYLON.DynamicTexture('train-atlas', { width: 1024, height: 1024 }, scene, true);
  owned.push(atlas);
  const ctx = atlas.getContext() as CanvasRenderingContext2D;
  const box = (r: Rect) => ({ x: r.u0 * 1024, y: (1 - r.v1) * 1024, w: (r.u1 - r.u0) * 1024, h: (r.v1 - r.v0) * 1024 });

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 1024, 1024);
  AD_COPY.forEach((ad, i) => paintAd(ctx, ad, box(ATLAS.ads[i])));
  // Line map: the 6, HAWKES ST lit as the station just left. The other stops stay unnamed.
  {
    const m = box(ATLAS.map);
    ctx.fillStyle = '#ece8dc';
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.fillStyle = '#1f7a3a';
    ctx.beginPath();
    ctx.arc(m.x + 60, m.y + m.h / 2, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 56px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('6', m.x + 60, m.y + m.h / 2 + 3);
    ctx.fillStyle = '#1f7a3a';
    ctx.fillRect(m.x + 130, m.y + m.h / 2 - 6, m.w - 170, 12);
    for (let i = 0; i < 9; i += 1) {
      const x = m.x + 150 + i * ((m.w - 210) / 8);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, m.y + m.h / 2, i === 0 ? 16 : 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = i === 0 ? '#c23a2a' : '#1b1b1b';
      ctx.stroke();
    }
    ctx.fillStyle = '#1b1b1b';
    ctx.font = 'bold 24px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('HAWKES ST', m.x + 128, m.y + 26);
    ctx.textAlign = 'right';
    ctx.fillText('UPTOWN →', m.x + m.w - 24, m.y + m.h - 22);
  }
  // Front sign: amber dot matrix.
  {
    const s = box(ATLAS.sign);
    ctx.fillStyle = '#060403';
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.fillStyle = '#ffae1a';
    ctx.shadowColor = '#ff8a00';
    ctx.shadowBlur = 12;
    ctx.font = 'bold 54px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('6  UPTOWN', s.x + s.w / 2, s.y + s.h / 2 + 4);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    for (let x = 0; x < s.w; x += 4) ctx.fillRect(s.x + x, s.y, 1, s.h);
    for (let y = 0; y < s.h; y += 4) ctx.fillRect(s.x, s.y + y, s.w, 1);
  }
  // Door decal.
  {
    const d = box(ATLAS.decal);
    ctx.fillStyle = '#d8d4c8';
    ctx.fillRect(d.x, d.y, d.w, d.h);
    ctx.fillStyle = '#1b1b1b';
    ctx.font = 'bold 34px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('STAND CLEAR OF', d.x + d.w / 2, d.y + d.h * 0.34);
    ctx.fillText('THE CLOSING DOORS', d.x + d.w / 2, d.y + d.h * 0.7);
  }
  atlas.update(true);

  const material = new BABYLON.ShaderMaterial('train-dress', scene, { vertexSource: VERT, fragmentSource: FRAG }, {
    attributes: ['position', 'normal', 'uv', 'uv2', 'color'],
    uniforms: ['worldViewProjection', 'cameraPos', 'scroll', 'speedN', 'time', 'flicker'],
    samplers: ['atlas'],
  });
  material.backFaceCulling = true;
  material.zOffset = -1;
  material.setTexture('atlas', atlas);
  owned.push(material);

  const g = new Geo();
  const surf = (id: number, param = 0) => {
    g.a.u2 = [id, param];
  };
  const col = (r: number, gg: number, b: number, e = 0) => {
    g.a.c = [r, gg, b, e];
  };
  type V3 = [number, number, number];
  const X = { x: 1, z: 0 };
  const HW = CAR.halfWidth;
  const TOP = CAR.ceiling;

  /** Side wall quad on side s (+1 north, -1 south) from x0 to x1, uv = (x, y). */
  const sideQuad = (s: number, x0: number, x1: number, y0: number, y1: number, inset = 0) => {
    const z = s * (HW - inset);
    const n: V3 = [0, 0, -s];
    g.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], n, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  };
  /** Atlas panel on side s, facing into the car. */
  const sidePanel = (s: number, cx: number, y0: number, w: number, h: number, r: Rect, glow: number, inset = 0.01) => {
    const z = s * (HW - inset);
    const n: V3 = [0, 0, -s];
    // Seen from inside, +x is the viewer's right on the -z wall (looking -z... toward s = -1) and left on +z.
    const left = s < 0 ? cx - w / 2 : cx + w / 2;
    const right = s < 0 ? cx + w / 2 : cx - w / 2;
    surf(SURF.TEX, glow);
    g.quad([left, y0, z], [right, y0, z], [right, y0 + h, z], [left, y0 + h, z], n, [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]]);
  };
  /** Atlas panel on an end wall at x, facing into the car. */
  const endPanel = (x: number, cz: number, y0: number, w: number, h: number, r: Rect, glow: number) => {
    const into = x < (CAR.x0 + CAR.x1) / 2 ? 1 : -1;
    const n: V3 = [into, 0, 0];
    const left = into > 0 ? cz + w / 2 : cz - w / 2;
    const right = into > 0 ? cz - w / 2 : cz + w / 2;
    const px = x + into * 0.012;
    surf(SURF.TEX, glow);
    g.quad([px, y0, left], [px, y0, right], [px, y0 + h, right], [px, y0 + h, left], n, [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]]);
  };

  let windows = 0;
  let ads = 0;
  const WIN_LO = 1.0;
  const WIN_HI = 1.85;

  // ---------- Side walls, windows, doors ----------
  for (const s of [1, -1]) {
    // Wall sections between doors.
    const spans: [number, number][] = [];
    let from = CAR.x0;
    for (const d of DOORS_X) {
      spans.push([from, d - DOOR_HALF]);
      from = d + DOOR_HALF;
    }
    spans.push([from, CAR.x1]);
    for (const [a, b] of spans) {
      surf(SURF.WALL);
      col(1, 1, 1);
      sideQuad(s, a, b, 0, WIN_LO);
      sideQuad(s, a, b, WIN_HI, 2.25);
      // Window panes with steel mullions; a little wall at each end.
      const w0 = a + 0.18;
      const w1 = b - 0.18;
      surf(SURF.WALL);
      sideQuad(s, a, w0, WIN_LO, WIN_HI);
      sideQuad(s, w1, b, WIN_LO, WIN_HI);
      const panes = Math.max(1, Math.ceil((w1 - w0) / 1.25));
      const pw = (w1 - w0) / panes;
      for (let i = 0; i < panes; i += 1) {
        surf(SURF.WINDOW);
        sideQuad(s, w0 + i * pw, w0 + (i + 1) * pw, WIN_LO, WIN_HI, 0.004);
        windows += 1;
      }
      surf(SURF.STEEL);
      for (let i = 0; i <= panes; i += 1) g.box(w0 + i * pw, WIN_LO, s * (HW - 0.02), 0.025, WIN_HI - WIN_LO, 0.02, X, 0b011111);
      // Sill and header.
      g.box((a + b) / 2, WIN_LO - 0.04, s * (HW - 0.05), (b - a) / 2, 0.04, 0.05, X, 0b011111);
      g.box((a + b) / 2, WIN_HI, s * (HW - 0.025), (b - a) / 2, 0.03, 0.025, X, 0b111111);
      // Ad cove: the station's cards, repeated down the car.
      const count = Math.floor((b - a - 0.2) / 0.78);
      const start = (a + b) / 2 - ((count - 1) * 0.78) / 2;
      for (let i = 0; i < count; i += 1) {
        const cx = start + i * 0.78;
        sidePanel(s, cx, 1.93, 0.66, 0.3, ATLAS.ads[(ads + (s > 0 ? 0 : 2)) % 4], 0.55, 0.035);
        surf(SURF.SOLID);
        col(0.1, 0.1, 0.11);
        g.box(cx, 1.91, s * (HW - 0.015), 0.35, 0.34, 0.01, X, 0b111111);
        ads += 1;
      }
    }
    // Upper cove from the wall to the flat ceiling.
    surf(SURF.WALL);
    col(1, 1, 1);
    const cz0 = s * HW;
    const cz1 = s * 1.18;
    const coveN: V3 = [0, 0.86, -s * 0.5];
    g.quad([CAR.x0, 2.25, cz0], [CAR.x1, 2.25, cz0], [CAR.x1, TOP, cz1], [CAR.x0, TOP, cz1], coveN, [[CAR.x0, 2.25], [CAR.x1, 2.25], [CAR.x1, 2.6], [CAR.x0, 2.6]]);
    // Doors: two brushed leaves with tall windows, black seals, a map and a decal.
    for (const d of DOORS_X) {
      surf(SURF.WALL);
      sideQuad(s, d - DOOR_HALF, d + DOOR_HALF, 2.05, 2.25);
      for (const leaf of [-1, 1]) {
        const l0 = leaf < 0 ? d - DOOR_HALF : d;
        const l1 = leaf < 0 ? d : d + DOOR_HALF;
        surf(SURF.DOOR);
        sideQuad(s, l0, l1, 0, 1.15, 0.01);
        sideQuad(s, l0, l1, 1.85, 2.05, 0.01);
        sideQuad(s, l0, l0 + 0.1, 1.15, 1.85, 0.01);
        sideQuad(s, l1 - 0.1, l1, 1.15, 1.85, 0.01);
        surf(SURF.WINDOW);
        sideQuad(s, l0 + 0.1, l1 - 0.1, 1.15, 1.85, 0.014);
        windows += 1;
      }
      surf(SURF.SOLID);
      col(0.02, 0.02, 0.02);
      g.box(d, 0, s * (HW - 0.02), 0.012, 2.05, 0.02, X, 0b111111);
      col(0.05, 0.05, 0.05);
      g.box(d - DOOR_HALF - 0.02, 0, s * (HW - 0.03), 0.025, 2.05, 0.03, X, 0b111111);
      g.box(d + DOOR_HALF + 0.02, 0, s * (HW - 0.03), 0.025, 2.05, 0.03, X, 0b111111);
      sidePanel(s, d, 2.07, 1.26, 0.16, ATLAS.map, 0.3, 0.025);
      sidePanel(s, d - DOOR_HALF / 2, 0.98, 0.42, 0.1, ATLAS.decal, 0.1, 0.016);
    }
  }

  // ---------- Floor and ceiling ----------
  surf(SURF.FLOOR);
  g.quad([CAR.x0, 0.006, -HW], [CAR.x1, 0.006, -HW], [CAR.x1, 0.006, HW], [CAR.x0, 0.006, HW], [0, 1, 0], [[CAR.x0, -HW], [CAR.x1, -HW], [CAR.x1, HW], [CAR.x0, HW]]);
  surf(SURF.CEIL);
  g.quad([CAR.x0, TOP, -1.18], [CAR.x1, TOP, -1.18], [CAR.x1, TOP, 1.18], [CAR.x0, TOP, 1.18], [0, -1, 0], [[CAR.x0, -1.18], [CAR.x1, -1.18], [CAR.x1, 1.18], [CAR.x0, 1.18]]);
  // Light strips.
  for (const s of [1, -1]) {
    surf(SURF.SOLID);
    col(0.75, 0.75, 0.72);
    g.box((CAR.x0 + CAR.x1) / 2, TOP - 0.05, s * 0.62, (CAR.x1 - CAR.x0) / 2 - 0.45, 0.05, 0.11, X, 0b101111);
    surf(SURF.LAMP);
    g.box((CAR.x0 + CAR.x1) / 2, TOP - 0.056, s * 0.62, (CAR.x1 - CAR.x0) / 2 - 0.5, 0.01, 0.08, X, 0b100000);
  }

  // ---------- End walls: an end door to the next car, the front sign ----------
  for (const x of [CAR.x0, CAR.x1]) {
    const into = x === CAR.x0 ? 1 : -1;
    const n: V3 = [into, 0, 0];
    const px = x + into * 0.002;
    const wallZ = (z0: number, z1: number, y0: number, y1: number) => {
      const a = into > 0 ? z1 : z0;
      const b = into > 0 ? z0 : z1;
      g.quad([px, y0, a], [px, y0, b], [px, y1, b], [px, y1, a], n, [[a, y0], [b, y0], [b, y1], [a, y1]]);
    };
    surf(SURF.WALL);
    col(1, 1, 1);
    wallZ(-HW, -0.42, 0, TOP);
    wallZ(0.42, HW, 0, TOP);
    wallZ(-0.42, 0.42, 2.02, TOP);
    surf(SURF.DOOR);
    wallZ(-0.42, 0.42, 0, 1.1);
    wallZ(-0.42, 0.42, 1.78, 2.02);
    wallZ(-0.42, -0.26, 1.1, 1.78);
    wallZ(0.26, 0.42, 1.1, 1.78);
    // The next car is dark through the end door glass.
    surf(SURF.SOLID);
    col(0.03, 0.035, 0.04, 0.6);
    wallZ(-0.26, 0.26, 1.1, 1.78);
    col(0.08, 0.08, 0.09);
    g.box(x + into * 0.03, 1.0, 0.0, 0.03, 0.03, 0.12, { x: 0, z: 1 }, 0b111111);
    endPanel(x, 0, 2.1, 0.78, 0.2, ATLAS.sign, 1.4);
    endPanel(x, -0.95, 1.55, 0.66, 0.33, ATLAS.ads[x === CAR.x0 ? 1 : 3], 0.55);
    ads += 1;
  }

  // ---------- Benches ----------
  const seatColor: [number, number, number] = [0.2, 0.33, 0.52];
  for (const s of [1, -1]) {
    for (const [a, b] of BENCHES) {
      const zf = s * SEAT_FRONT;
      const zb = s * (HW - 0.12);
      const len = b - a;
      surf(SURF.SEAT);
      col(...seatColor);
      // Pan, uv = (x, depth).
      g.quad([a, SEAT_TOP, zf], [b, SEAT_TOP, zf], [b, SEAT_TOP, zb], [a, SEAT_TOP, zb], [0, 1, 0], [[a, 0], [b, 0], [b, 1], [a, 1]]);
      // Front lip.
      col(seatColor[0] * 0.75, seatColor[1] * 0.75, seatColor[2] * 0.75);
      g.quad([a, 0.12, zf], [b, 0.12, zf], [b, SEAT_TOP, zf], [a, SEAT_TOP, zf], [0, 0, -s], [[a, 0], [b, 0], [b, 1], [a, 1]]);
      // Backrest, leaning back against the wall.
      col(...seatColor);
      const bn: V3 = [0, 0.22, -s * 0.97];
      g.quad([a, SEAT_TOP + 0.02, zb], [b, SEAT_TOP + 0.02, zb], [b, 0.98, s * (HW - 0.02)], [a, 0.98, s * (HW - 0.02)], bn, [[a, 0], [b, 0], [b, 1], [a, 1]]);
      // Pan ends and the dark skirt under the lip.
      surf(SURF.SOLID);
      col(0.08, 0.09, 0.11);
      g.box(a + 0.01, 0.12, (zf + s * HW) / 2, 0.01, SEAT_TOP - 0.12, Math.abs(s * HW - zf) / 2, X, 0b000101);
      g.box(b - 0.01, 0.12, (zf + s * HW) / 2, 0.01, SEAT_TOP - 0.12, Math.abs(s * HW - zf) / 2, X, 0b000101);
      col(0.03, 0.03, 0.035);
      g.box((a + b) / 2, 0, s * (SEAT_FRONT + 0.04), len / 2, 0.12, 0.01, X, 0b001010);
      // Wind screens at the door ends of the bench.
      col(0.62, 0.64, 0.66);
      if (a > CAR.x0 + 0.5) g.box(a - 0.02, 0.1, s * (SEAT_FRONT + 0.22), 0.012, 1.05, 0.24, X, 0b111111);
      if (b < CAR.x1 - 0.5) g.box(b + 0.02, 0.1, s * (SEAT_FRONT + 0.22), 0.012, 1.05, 0.24, X, 0b111111);
    }
  }

  // ---------- Poles and rails ----------
  type Pole = { x: number; z: number };
  const poles: Pole[] = [];
  for (const d of DOORS_X) poles.push({ x: d, z: 0 });
  for (const s of [1, -1]) {
    for (const [a, b] of BENCHES) {
      if (a > CAR.x0 + 0.5) poles.push({ x: a - 0.02, z: s * (SEAT_FRONT - 0.03) });
      if (b < CAR.x1 - 0.5) poles.push({ x: b + 0.02, z: s * (SEAT_FRONT - 0.03) });
    }
  }
  surf(SURF.STEEL);
  col(1, 1, 1);
  for (const pole of poles) g.cyl(pole.x, 0, pole.z, 0.022, 0.022, TOP, 8, false);
  // Overhead grab rails, with drop brackets.
  for (const s of [1, -1]) {
    g.hcyl((CAR.x0 + CAR.x1) / 2, 1.96, s * 0.8, X, 0.016, CAR.x1 - CAR.x0 - 0.6, 6);
    for (let x = CAR.x0 + 0.6; x < CAR.x1; x += 2.2) g.cyl(x, 1.96, s * 0.8, 0.01, 0.01, TOP - 1.96, 4, false);
  }

  const mesh = g.toMesh('train-dress', scene, material);
  if (mesh) {
    mesh.alwaysSelectAsActiveMesh = true;
    owned.push(mesh);
  }

  // ---------- Colliders: what is drawn is what blocks ----------
  const colliderMat = new BABYLON.StandardMaterial('train-collider', scene);
  owned.push(colliderMat);
  const collider = (name: string, cx: number, cz: number, w: number, h: number, d: number) => {
    const c = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    c.position.set(cx, h / 2, cz);
    c.material = colliderMat;
    c.isVisible = false;
    c.isPickable = false;
    c.checkCollisions = true;
    c.metadata = { trainCollider: true };
    // Invisible meshes are not rendered, so nothing refreshes the matrix: set it once.
    c.computeWorldMatrix(true);
    c.freezeWorldMatrix();
    c.getBoundingInfo();
    owned.push(c);
    return c;
  };
  let benchCount = 0;
  for (const s of [1, -1]) {
    for (const [a, b] of BENCHES) {
      // Up to chest height: the capsule center sits near y 1.1 and walks over anything lower.
      const depth = HW - SEAT_FRONT + 0.02;
      collider(`train-seat-col-${s > 0 ? 'n' : 's'}-${benchCount}`, (a + b) / 2, s * (HW - depth / 2), b - a + 0.06, 1.2, depth);
      benchCount += 1;
    }
  }
  poles.forEach((pole, i) => collider(`train-pole-col-${i}`, pole.x, pole.z, 0.08, TOP, 0.08));

  // ---------- Motion ----------
  let clock = 0;
  let scroll = 0;
  let speed = CRUISE;
  let targetSpeed = CRUISE;
  let flicker = 1;
  let rollNow = 0;
  const camPos = new BABYLON.Vector3();

  return {
    step: (dt: number) => {
      const d = Math.min(0.1, Math.max(0, dt));
      clock += d;
      // Ease toward the target: about 1.3 m/s each second, like a train pulling in or out.
      const dv = targetSpeed - speed;
      speed += Math.sign(dv) * Math.min(Math.abs(dv), 1.3 * d);
      scroll += speed * d;
      const speedN = speed / CRUISE;
      const f = Math.sin(clock * 23) * Math.sin(clock * 7.3) + Math.sin(clock * 1.7);
      flicker = f > 0.6 ? 0.12 : 1;
      // Slight sway: a slow rock, a quicker wobble, and a jolt every lamp gap or so.
      const jolt = Math.exp(-Math.pow(((scroll / 9.0) % 1) * 9.0 - 0.4, 2) * 20) * 0.004;
      rollNow = (0.0105 * Math.sin(clock * 2.3) + 0.0045 * Math.sin(clock * 5.9 + 1.3) + jolt) * Math.min(1, 0.15 + speedN);
      const camera = scene.activeCamera;
      if (!camera) return;
      camPos.copyFrom(camera.globalPosition);
      material.setVector3('cameraPos', camPos);
      material.setFloat('scroll', scroll);
      material.setFloat('speedN', speedN);
      material.setFloat('time', clock);
      material.setFloat('flicker', flicker);
    },
    /** Camera roll in radians for this frame (main.ts applies it after the follow camera). */
    roll: () => rollNow,
    /** Train speed in m/s; the tunnel slows to it (0 is a stop). Level 7's script sets this for a station stop. */
    setSpeed: (mps: number) => {
      targetSpeed = Math.max(0, mps);
    },
    speed: () => speed,
    /** What the car is made of, for the playtest. */
    stats: () => ({
      seats: benchCount,
      poles: poles.length,
      ads,
      windows,
      lampsPassed: Math.floor(scroll / LAMP_GAP),
      speed: Math.round(speed * 10) / 10,
      roll: rollNow,
    }),
    dispose: () => {
      for (const o of owned) o.dispose();
      owned.length = 0;
    },
  };
};

export type TrainDress = ReturnType<typeof createTrainDress>;
