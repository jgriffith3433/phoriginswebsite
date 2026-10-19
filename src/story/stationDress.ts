import * as BABYLON from '@babylonjs/core';

import { Geo } from './city/geo';

/**
 * The Station, dressed at runtime: subway tile walls with a mosaic band and
 * HAWKES ST tablets, platform concrete with a tactile edge, ballast and a third
 * rail in the trench, a girder ceiling with fluorescent tubes (one fails), lit
 * ads, a live departure board, and raymarched tunnel mouths at both ends.
 *
 * Everything is overlay geometry in front of the authored shell. Collision stays
 * on the authored level. One shader, a handful of draw calls.
 */

const SURF = { SOLID: 0, TILE: 1, FLOOR: 2, TACTILE: 3, BALLAST: 4, TEX: 5, TUNNEL: 6, CEIL: 7, TRENCH: 8 };

/** Tube lights along the ceiling: two rows. */
const TUBES: { x: number; z: number }[] = [];
for (let x = 4; x <= 78; x += 6.5) {
  TUBES.push({ x, z: -4.6 });
  if (x > 10) TUBES.push({ x: x + 3.2, z: -0.4 });
}
const MAX_LIGHTS = 16;

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
uniform vec3 fogColor;
uniform vec2 fogRange;
uniform vec3 ambient;
uniform vec4 lights[${MAX_LIGHTS}];
uniform vec3 lightColor;
uniform float time;
uniform sampler2D atlas;

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}

vec3 lighting(vec3 n) {
  vec3 sum = ambient;
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec4 l = lights[i];
    vec3 d = l.xyz - vWorld;
    float dist = length(d);
    float lam = max(dot(n, d / max(dist, 0.001)), 0.0) * 0.75 + 0.25;
    sum += lightColor * l.w * lam / (1.0 + dist * dist * 0.09);
  }
  return sum;
}

vec3 tunnel(vec2 p, vec3 V, vec3 n) {
  // Portal plane: p = (lateral, height). The ray goes into the tunnel along -n.
  vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), n));
  vec3 rd = -V;
  vec3 r = vec3(dot(rd, T), rd.y, -dot(rd, n));
  r.z = max(r.z, 0.05);
  vec3 ro = vec3(p.x, p.y, 0.0);
  float halfW = 2.45;
  float floorY = -1.1;
  float roofY = 3.2;
  float tx = (sign(r.x) * halfW - ro.x) / (r.x + 1e-5);
  float ty = r.y > 0.0 ? (roofY - ro.y) / r.y : (floorY - ro.y) / (r.y - 1e-5);
  float t = min(tx, ty);
  vec3 hit = ro + r * t;
  float depth = hit.z;
  vec3 c;
  if (t == ty && r.y < 0.0) {
    float rail = step(abs(abs(hit.x) - 0.75), 0.04);
    float tie = step(fract(depth / 0.65), 0.3);
    c = mix(vec3(0.05, 0.045, 0.04), vec3(0.09, 0.07, 0.05), tie) + rail * vec3(0.35, 0.33, 0.3);
  } else if (t == ty) {
    c = vec3(0.03, 0.03, 0.032) * (0.7 + 0.3 * step(0.5, fract(depth / 3.0)));
  } else {
    float rib = 0.75 + 0.25 * step(0.85, fract(depth / 3.0));
    c = vec3(0.06, 0.06, 0.058) * rib * (0.8 + 0.4 * vnoise(vec2(depth * 0.3, hit.y)));
    float lampSeg = fract((depth + 4.0) / 24.0);
    float lamp = smoothstep(0.012, 0.0, abs(lampSeg - 0.5) * 24.0 / 24.0 - 0.0) * 0.0;
    vec2 lp = vec2((lampSeg - 0.5) * 24.0, hit.y - 2.3);
    lamp = exp(-dot(lp, lp) * 6.0) * step(0.0, hit.x * sign(r.x));
    c += vec3(1.0, 0.78, 0.45) * lamp * 2.4;
    float sig = exp(-dot(vec2(depth - 58.0, hit.y - 1.4), vec2(depth - 58.0, hit.y - 1.4)) * 8.0) * step(0.0, -hit.x * sign(r.x) + 0.5);
    c += vec3(1.0, 0.1, 0.05) * sig * 3.0 * (0.85 + 0.15 * sin(time * 3.0));
  }
  float fade = exp(-depth * 0.045);
  return c * fade;
}

void main(void) {
  vec3 n = normalize(vNormal);
  vec3 V = normalize(cameraPos - vWorld);
  float surf = floor(vSurf.x + 0.5);
  vec3 albedo = vColor.rgb;
  vec3 emis = vec3(0.0);
  float gloss = 0.0;
  vec2 p = vUV;

  if (surf == ${SURF.TILE}.0) {
    float y = p.y;
    vec3 tileC = vec3(0.78, 0.78, 0.74);
    vec2 tile = vec2(0.15, 0.075);
    vec2 g = p / tile;
    g.x += step(1.0, mod(floor(g.y), 2.0)) * 0.5;
    vec2 f = fract(g);
    float grout = max(smoothstep(0.06, 0.0, f.x), smoothstep(0.1, 0.0, f.y));
    vec2 cell = floor(g);
    if (y < 1.15) {
      tileC = vec3(0.12, 0.27, 0.22);
    } else if (y > 2.35 && y < 2.75) {
      vec2 m = floor(p / 0.075);
      float pat = step(0.5, fract((m.x + m.y) * 0.25)) * step(abs(y - 2.55), 0.12);
      tileC = mix(vec3(0.42, 0.12, 0.1), vec3(0.75, 0.62, 0.32), pat);
      tileC = mix(tileC, vec3(0.12, 0.27, 0.22), step(abs(y - 2.55), 0.18) * (1.0 - step(abs(y - 2.55), 0.15)));
      grout = max(smoothstep(0.08, 0.0, fract(p.x / 0.075)), smoothstep(0.08, 0.0, fract(p.y / 0.075)));
    } else if (y > 1.15 && y < 1.27) {
      tileC = vec3(0.42, 0.12, 0.1);
    }
    tileC *= 0.92 + 0.08 * h21(cell);
    float grime = smoothstep(0.55, 0.85, vnoise(p * vec2(0.35, 1.2))) * 0.35 + smoothstep(1.6, 0.0, y) * 0.18;
    float streak = smoothstep(0.7, 0.95, vnoise(vec2(p.x * 3.0, p.y * 0.15))) * 0.25;
    albedo = tileC * (1.0 - grout * 0.45) * (1.0 - grime - streak);
    gloss = 0.35 * (1.0 - grout);
  } else if (surf == ${SURF.FLOOR}.0) {
    float n1 = vnoise(p * 0.6);
    float n2 = vnoise(p * 4.0);
    float tone = 0.3 + n1 * 0.06 - n2 * 0.04;
    albedo = vec3(tone, tone * 0.98, tone * 0.94);
    vec2 slab = fract(p / vec2(2.0, 2.0));
    float joint = max(smoothstep(0.012, 0.0, slab.x), smoothstep(0.012, 0.0, slab.y));
    albedo *= 1.0 - joint * 0.4;
    vec2 gc = floor(p * 3.0);
    vec2 gp = fract(p * 3.0) - 0.5 - (vec2(h21(gc + 1.7), h21(gc + 4.1)) - 0.5) * 0.6;
    float gum = step(0.9, h21(gc)) * smoothstep(0.06, 0.03, length(gp));
    albedo *= 1.0 - gum * 0.4;
    float path = smoothstep(2.2, 0.0, abs(p.y + 2.2)) * 0.12;
    albedo *= 1.0 - path;
    gloss = 0.12;
  } else if (surf == ${SURF.TACTILE}.0) {
    vec2 d = fract(p / 0.06) - 0.5;
    float dome = smoothstep(0.32, 0.18, length(d));
    albedo = vec3(0.75, 0.55, 0.06) * (0.8 + 0.2 * dome) * (0.85 + 0.15 * vnoise(p * 2.0));
    if (p.y > 2.2) albedo = vec3(0.85, 0.85, 0.82);
  } else if (surf == ${SURF.BALLAST}.0) {
    float stone = h21(floor(p * 18.0));
    albedo = vec3(0.1, 0.095, 0.09) * (0.6 + 0.8 * stone);
    float oil = smoothstep(0.6, 0.85, vnoise(p * 0.5)) * 0.5;
    albedo *= 1.0 - oil;
  } else if (surf == ${SURF.TEX}.0) {
    vec3 t = texture2D(atlas, p).rgb;
    albedo = t;
    emis = t * vSurf.y;
  } else if (surf == ${SURF.TUNNEL}.0) {
    gl_FragColor = vec4(tunnel(p, V, n), 1.0);
    return;
  } else if (surf == ${SURF.CEIL}.0) {
    vec2 f = fract(p / vec2(3.0, 1.2));
    float seam = max(smoothstep(0.01, 0.0, f.x), smoothstep(0.02, 0.0, f.y));
    albedo = vec3(0.09, 0.095, 0.1) * (1.0 - seam * 0.5) * (0.85 + 0.3 * vnoise(p * 0.8));
  } else if (surf == ${SURF.TRENCH}.0) {
    albedo = vec3(0.12, 0.115, 0.11) * (0.6 + 0.6 * vnoise(p * vec2(0.4, 2.0)));
    albedo *= 1.0 - smoothstep(0.7, 0.95, vnoise(vec2(p.x * 2.0, p.y * 0.2))) * 0.4;
  } else {
    emis = albedo * vColor.a;
  }

  vec3 lit = albedo * lighting(n) + emis;
  if (gloss > 0.0) {
    vec3 R = reflect(-V, n);
    float spec = 0.0;
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      vec4 l = lights[i];
      vec3 d = normalize(l.xyz - vWorld);
      spec += pow(max(dot(R, d), 0.0), 40.0) * l.w;
    }
    lit += lightColor * spec * gloss * 0.35;
  }
  float fogF = clamp((length(vWorld - cameraPos) - fogRange.x) / max(fogRange.y - fogRange.x, 0.01), 0.0, 1.0);
  gl_FragColor = vec4(mix(lit, fogColor, fogF), 1.0);
}
`;

/** The four lit ads. The train cars carry the same cards (trainDress.ts). */
export const AD_COPY: { title: string; sub: string; bg: [string, string]; ink: string }[] = [
  { title: 'HAWKES BIOMEDICAL', sub: 'Built better. Built for you.', bg: ['#0d2a3a', '#1c6f8c'], ink: '#e9fbff' },
  { title: 'VOSS CAPITAL', sub: 'Your future, leveraged.', bg: ['#2b1b0e', '#a8662a'], ink: '#fff3e0' },
  { title: 'LIBERTY SQUARE', sub: 'Fountain lights every night until 2 AM', bg: ['#132414', '#3f8a4a'], ink: '#efffef' },
  { title: 'MIDNIGHT DINER', sub: 'Pie. Coffee. Main Ave. Always open.', bg: ['#2a0b16', '#c23a5c'], ink: '#fff0f4' },
];

/** One ad card into a 512x256 canvas rect (canvas y down). */
export const paintAd = (ctx: CanvasRenderingContext2D, ad: (typeof AD_COPY)[number], a: { x: number; y: number; w: number; h: number }) => {
  const grad = ctx.createLinearGradient(a.x, a.y, a.x + a.w, a.y + a.h);
  grad.addColorStop(0, ad.bg[0]);
  grad.addColorStop(1, ad.bg[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(a.x, a.y, a.w, a.h);
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#fff';
  for (let k = 0; k < 6; k += 1) {
    ctx.beginPath();
    ctx.arc(a.x + a.w * (0.6 + 0.08 * k), a.y + a.h * 0.45, 30 + k * 18, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = ad.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 44px "Arial Black", Arial, sans-serif';
  ctx.fillText(ad.title, a.x + 26, a.y + a.h * 0.42);
  ctx.font = '26px Arial, sans-serif';
  ctx.fillText(ad.sub, a.x + 28, a.y + a.h * 0.68);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 4;
  ctx.strokeRect(a.x + 6, a.y + 6, a.w - 12, a.h - 12);
};

/** Atlas layout (UV 0..1, v up): tablet, four ads, board. */
const ATLAS = {
  tablet: { u0: 0, v0: 0.875, u1: 0.5, v1: 1 },
  ads: [
    { u0: 0, v0: 0.625, u1: 0.5, v1: 0.875 },
    { u0: 0.5, v0: 0.625, u1: 1, v1: 0.875 },
    { u0: 0, v0: 0.375, u1: 0.5, v1: 0.625 },
    { u0: 0.5, v0: 0.375, u1: 1, v1: 0.625 },
  ],
  board: { u0: 0, v0: 0.25, u1: 1, v1: 0.375 },
  bullet: { u0: 0.5, v0: 0.875, u1: 0.625, v1: 1 },
};

export const createStationDress = (scene: BABYLON.Scene) => {
  const owned: { dispose: () => void }[] = [];
  const atlas = new BABYLON.DynamicTexture('station-atlas', { width: 1024, height: 1024 }, scene, true);
  owned.push(atlas);
  const ctx = atlas.getContext() as CanvasRenderingContext2D;
  // Canvas y grows down; texture v grows up. Row r (0 top) maps to v = 1 - r.
  const box = (r: { u0: number; v0: number; u1: number; v1: number }) => ({
    x: r.u0 * 1024,
    y: (1 - r.v1) * 1024,
    w: (r.u1 - r.u0) * 1024,
    h: (r.v1 - r.v0) * 1024,
  });

  const drawStatic = () => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 1024, 1024);
    // Name tablet: mosaic border, cream field, dark letters.
    const t = box(ATLAS.tablet);
    ctx.fillStyle = '#6b1d16';
    ctx.fillRect(t.x, t.y, t.w, t.h);
    for (let i = 0; i < t.w; i += 8) {
      ctx.fillStyle = (i / 8) % 2 ? '#c49a4a' : '#24493c';
      ctx.fillRect(t.x + i, t.y, 7, 7);
      ctx.fillRect(t.x + i, t.y + t.h - 7, 7, 7);
    }
    ctx.fillStyle = '#e8e2cf';
    ctx.fillRect(t.x + 12, t.y + 12, t.w - 24, t.h - 24);
    ctx.fillStyle = '#1b1b1b';
    ctx.font = 'bold 66px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('HAWKES ST', t.x + t.w / 2, t.y + t.h / 2 + 3);
    // Line bullet.
    const b = box(ATLAS.bullet);
    ctx.fillStyle = '#e8e2cf';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#1f7a3a';
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 84px Arial, sans-serif';
    ctx.fillText('6', b.x + b.w / 2, b.y + b.h / 2 + 4);
    // Ads.
    AD_COPY.forEach((ad, i) => paintAd(ctx, ad, box(ATLAS.ads[i])));
  };

  let boardTick = -1;
  const drawBoard = (now: number) => {
    const b = box(ATLAS.board);
    ctx.fillStyle = '#050403';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    const up = Math.max(0, 1 - Math.floor(now / 40) % 2);
    const rows = [
      `6  UPTOWN   ${up === 0 ? 'NOW ARRIVING' : (2 - Math.floor((now % 40) / 20)) + ' MIN'}`,
      `6  DOWNTOWN    ${7 - Math.floor((now % 120) / 20)} MIN`,
    ];
    ctx.font = 'bold 46px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    rows.forEach((row, i) => {
      ctx.fillStyle = '#ffae1a';
      ctx.shadowColor = '#ff8a00';
      ctx.shadowBlur = 12;
      ctx.fillText(row, b.x + 24, b.y + b.h * (0.3 + i * 0.42));
    });
    ctx.shadowBlur = 0;
    // Dot matrix screen.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 0; x < b.w; x += 4) ctx.fillRect(b.x + x, b.y, 1, b.h);
    for (let y = 0; y < b.h; y += 4) ctx.fillRect(b.x, b.y + y, b.w, 1);
  };

  drawStatic();
  drawBoard(0);
  atlas.update(true);

  const material = new BABYLON.ShaderMaterial('station-dress', scene, { vertexSource: VERT, fragmentSource: FRAG }, {
    attributes: ['position', 'normal', 'uv', 'uv2', 'color'],
    uniforms: ['worldViewProjection', 'cameraPos', 'fogColor', 'fogRange', 'ambient', 'lights', 'lightColor', 'time'],
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
  /** Wall quad with uv = (along, height) in meters. */
  const wall = (a: V3, b: V3, y0: number, y1: number, n: V3, u0 = 0) => {
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    g.quad([a[0], y0, a[2]], [b[0], y0, b[2]], [b[0], y1, b[2]], [a[0], y1, a[2]], n, [[u0, y0], [u0 + len, y0], [u0 + len, y1], [u0, y1]]);
  };
  const flat = (x0: number, x1: number, z0: number, z1: number, y: number, up = true) => {
    g.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, up ? 1 : -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
  };
  /** Textured quad from an atlas rect, on a wall facing n. */
  const panel = (cx: number, cz: number, y0: number, w: number, h: number, n: V3, r: { u0: number; v0: number; u1: number; v1: number }, glow: number) => {
    const t: V3 = [-n[2], 0, n[0]];
    // Seen from the front (viewer looking along -n), the viewer's right is t.
    const rx = t[0];
    const rz = t[2];
    const a: V3 = [cx - rx * w / 2 + n[0] * 0.05, y0, cz - rz * w / 2 + n[2] * 0.05];
    const b: V3 = [cx + rx * w / 2 + n[0] * 0.05, y0, cz + rz * w / 2 + n[2] * 0.05];
    surf(SURF.TEX, glow);
    g.quad(a, b, [b[0], y0 + h, b[2]], [a[0], y0 + h, a[2]], n, [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]]);
  };
  const frame = (cx: number, cz: number, y0: number, w: number, h: number, n: V3) => {
    const t = { x: -n[2], z: n[0] };
    surf(SURF.SOLID);
    col(0.06, 0.06, 0.065);
    g.box(cx + n[0] * 0.02, y0 - 0.06, cz + n[2] * 0.02, w / 2 + 0.07, h + 0.12, 0.02, t, 0b111111);
  };

  // ---------- Walls ----------
  surf(SURF.TILE);
  col(1, 1, 1);
  wall([0, 0, -7.11], [80.98, 0, -7.11], 0, 3.42, [0, 0, 1]);
  wall([80.98, 0, 7.58], [11.2, 0, 7.58], -1.1, 3.42, [0, 0, -1]);
  wall([-0.88, 0, 7.4], [-0.88, 0, -7.1], 0, 3.42, [1, 0, 0]);
  wall([80.98, 0, -7.1], [80.98, 0, 2.62], 0, 3.42, [-1, 0, 0]);
  wall([80.98, 0, 2.62], [80.98, 0, 7.58], 3.2, 3.42, [-1, 0, 0]);
  // Tunnel mouths.
  surf(SURF.TUNNEL);
  // Lateral uv must run along the shader tangent cross(up, n), or the fake tunnel bends.
  g.quad([80.97, -1.1, 2.62], [80.97, -1.1, 7.58], [80.97, 3.2, 7.58], [80.97, 3.2, 2.62], [-1, 0, 0], [[-2.48, -1.1], [2.48, -1.1], [2.48, 3.2], [-2.48, 3.2]]);
  g.quad([11.22, -1.1, 7.58], [11.22, -1.1, 2.62], [11.22, 3.2, 2.62], [11.22, 3.2, 7.58], [1, 0, 0], [[-2.48, -1.1], [2.48, -1.1], [2.48, 3.2], [-2.48, 3.2]]);
  // Trench face under the platform edge.
  surf(SURF.TRENCH);
  wall([11.2, 0, 2.63], [80.98, 0, 2.63], -1.1, -0.02, [0, 0, 1]);

  // ---------- Floors ----------
  surf(SURF.FLOOR);
  flat(-0.88, 80.98, -7.1, 1.5, 0.004);
  flat(-0.88, 11.2, 1.5, 7.4, 0.004);
  surf(SURF.TACTILE);
  flat(11.2, 80.98, 1.5, 2.36, 0.018);
  surf(SURF.BALLAST);
  flat(11.2, 80.98, 2.63, 7.58, -1.085);

  // ---------- Ceiling ----------
  surf(SURF.CEIL);
  flat(-0.88, 80.98, -7.1, 7.58, 3.41, false);
  surf(SURF.SOLID);
  for (let x = 2; x < 80; x += 6.5) {
    col(0.07, 0.075, 0.08);
    g.box(x, 3.1, 0.24, 0.1, 0.31, 7.3, { x: 1, z: 0 }, 0b111111);
    g.box(x, 3.1, 0.24, 0.02, 0.31, 7.3, { x: 1, z: 0 }, 0b111111);
  }
  // Cable tray along the south wall.
  col(0.12, 0.12, 0.13);
  g.box(40, 2.92, -6.82, 40.5, 0.08, 0.18, { x: 1, z: 0 }, 0b111111);
  // Fluorescent tubes.
  for (const tube of TUBES) {
    col(0.15, 0.15, 0.16);
    g.box(tube.x, 3.2, tube.z, 0.68, 0.1, 0.12, { x: 1, z: 0 }, 0b111111);
    col(0.95, 1.0, 0.92, 1.6);
    g.box(tube.x, 3.17, tube.z, 0.62, 0.03, 0.06, { x: 1, z: 0 }, 0b100000);
  }
  // Third rail with its cover board on brackets.
  for (let x = 12; x < 80; x += 3) {
    col(0.1, 0.1, 0.1);
    g.box(x, -1.08, 7.05, 0.05, 0.42, 0.05, { x: 1, z: 0 }, 0b111111);
  }
  col(0.32, 0.3, 0.27);
  g.box(46, -0.72, 7.05, 34, 0.08, 0.12, { x: 1, z: 0 }, 0b111111);
  col(0.55, 0.48, 0.22);
  g.box(46, -0.6, 7.05, 34, 0.04, 0.32, { x: 1, z: 0 }, 0b111111);

  // ---------- Signs, ads, board ----------
  const south: V3 = [0, 0, 1];
  const north: V3 = [0, 0, -1];
  for (const x of [16.5, 40, 61]) {
    frame(x, -7.09, 2.3, 2.6, 0.62, south);
    panel(x, -7.09, 2.3, 2.6, 0.62, south, ATLAS.tablet, 0.25);
  }
  for (const x of [18, 76]) {
    frame(x, 7.56, 1.9, 3.6, 0.86, north);
    panel(x, 7.56, 1.9, 3.6, 0.86, north, ATLAS.tablet, 0.25);
  }
  const ads: [number, number, V3, number][] = [[41.5, -7.09, south, 0], [54, -7.09, south, 1], [24.5, 7.56, north, 2], [72.5, 7.56, north, 3]];
  for (const [x, z, n, i] of ads) {
    frame(x, z, 0.95, 2.2, 1.1, n);
    panel(x, z, 0.95, 2.2, 1.1, n, ATLAS.ads[i], 1.15);
  }
  // Departure board hanging over the platform, readable both ways.
  surf(SURF.SOLID);
  col(0.05, 0.05, 0.055);
  g.box(36, 2.62, -1.6, 0.08, 0.6, 1.35, { x: 1, z: 0 }, 0b111111);
  for (const dz of [-0.9, 0.9]) g.box(36, 3.22, -1.6 + dz, 0.02, 0.2, 0.02, { x: 1, z: 0 }, 0b111111);
  panel(35.91, -1.6, 2.66, 2.5, 0.5, [-1, 0, 0], ATLAS.board, 1.6);
  panel(36.09, -1.6, 2.66, 2.5, 0.5, [1, 0, 0], ATLAS.board, 1.6);
  // Line bullets by the turnstiles.
  panel(22.2, -7.09, 1.6, 0.5, 0.5, south, ATLAS.bullet, 0.3);

  const mesh = g.toMesh('station-dress', scene, material);
  if (mesh) {
    mesh.alwaysSelectAsActiveMesh = true;
    owned.push(mesh);
  }

  // ---------- Lights ----------
  const flickerIndex = 9;
  const lightArr = new Array(MAX_LIGHTS * 4).fill(0);
  const camPos = new BABYLON.Vector3();
  let clock = 0;
  let lastBoard = -1;
  const lightColor = new BABYLON.Color3(0.92, 1.0, 0.9);

  return {
    step: (dt: number) => {
      clock += dt;
      const camera = scene.activeCamera;
      if (!camera) return;
      camPos.copyFrom(camera.globalPosition);
      // Nearest tubes to the camera.
      const near = TUBES.map((t, i) => ({ t, i, d: Math.hypot(t.x - camPos.x, t.z - camPos.z) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_LIGHTS);
      for (let k = 0; k < MAX_LIGHTS; k += 1) {
        const item = near[k];
        if (!item) {
          lightArr.splice(k * 4, 4, 0, -50, 0, 0);
          continue;
        }
        let power = 0.55;
        if (item.i === flickerIndex) {
          const f = Math.sin(clock * 23) * Math.sin(clock * 7.3) + Math.sin(clock * 1.7);
          power *= f > 0.6 ? 0.15 : 1;
        }
        lightArr.splice(k * 4, 4, item.t.x, 3.1, item.t.z, power);
      }
      material.setVector3('cameraPos', camPos);
      material.setColor3('fogColor', scene.fogColor ?? new BABYLON.Color3(0.09, 0.1, 0.09));
      material.setVector2('fogRange', new BABYLON.Vector2(scene.fogStart || 12, Math.max(scene.fogEnd || 46, 60)));
      material.setColor3('ambient', new BABYLON.Color3(0.16, 0.17, 0.16));
      material.setColor3('lightColor', lightColor);
      material.setArray4('lights', lightArr);
      material.setFloat('time', clock);
      const tick = Math.floor(clock);
      if (tick !== lastBoard) {
        lastBoard = tick;
        drawBoard(tick);
        atlas.update(true);
      }
    },
    /** Tube positions, for other systems (dust, shafts). */
    tubes: TUBES,
    dispose: () => {
      for (const o of owned) o.dispose();
      owned.length = 0;
    },
  };
};

export type StationDress = ReturnType<typeof createStationDress>;
