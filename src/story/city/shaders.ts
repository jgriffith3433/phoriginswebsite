/**
 * GLSL for the Going Home city. One ground shader (roads, sidewalks, pavers,
 * grass, water), one facade shader (procedural windows with interior mapping,
 * storefronts, neon), one prop shader (vertex colored, light map lit), and an
 * additive flare shader for lamps and signals.
 *
 * Street lights are not scene lights. Their pools live in a light map texture
 * that follows the player, so any number of lamps costs one texture read.
 */

const COMMON = /* glsl */ `
uniform vec3 cameraPos;
uniform vec3 fogColor;
uniform float fogDensity;
uniform sampler2D lightMap;
uniform vec3 lmInfo;
uniform vec3 ambient;
uniform vec3 skyTop;
uniform vec3 skyHorizon;
uniform float time;
uniform vec4 sig;
uniform float boost;

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float h11(float p) {
  return fract(sin(p * 91.3458) * 47453.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 lmSample(vec2 xz) {
  vec2 uv = (xz - lmInfo.xy) / lmInfo.z;
  vec2 edge = min(uv, 1.0 - uv);
  float fade = clamp(min(edge.x, edge.y) * 10.0, 0.0, 1.0);
  return texture2D(lightMap, clamp(uv, 0.0, 1.0)).rgb * 2.4 * fade;
}
float fogAmount(vec3 p) {
  float d = length(p - cameraPos) * fogDensity;
  return clamp(1.0 - exp(-d * d * 0.85 - d * 0.35), 0.0, 1.0);
}
vec3 skyColor(vec3 dir) {
  float t = clamp(dir.y * 1.6, 0.0, 1.0);
  return mix(skyHorizon, skyTop, sqrt(t));
}
vec3 finish(vec3 color, vec3 world, float glow) {
  color *= 1.0 + clamp(glow, 0.0, 1.0) * (boost - 1.0);
  float f = fogAmount(world);
  f *= 1.0 - clamp(glow, 0.0, 1.0) * 0.55;
  return mix(color, fogColor, f);
}
`;

const GROUND_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec2 uv2;
attribute vec2 uv3;
attribute vec4 color;
uniform mat4 worldViewProjection;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUV;
varying vec2 vUV2;
varying vec2 vUV3;
varying vec4 vInfo;
void main(void) {
  vWorld = position;
  vNormal = normal;
  vUV = uv;
  vUV2 = uv2;
  vUV3 = uv3;
  vInfo = color;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const GROUND_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUV;
varying vec2 vUV2;
varying vec2 vUV3;
varying vec4 vInfo;
//#COMMON

float band(float x, float a, float b) {
  return step(a, x) * step(x, b);
}

vec3 asphalt(vec2 wp, float n1, float n2, float n3) {
  float grit = step(0.9, h21(floor(wp * 28.0))) * 0.035;
  float patchy = smoothstep(0.55, 0.75, vnoise(wp * 0.07 + 13.0)) * 0.018;
  float tone = 0.058 + n1 * 0.02 + n3 * 0.014 + grit - patchy;
  return vec3(tone * 0.98, tone, tone * 1.04);
}

void main(void) {
  vec2 wp = vWorld.xz;
  float surf = floor(vInfo.x + 0.5);
  float n1 = vnoise(wp * 0.33);
  float n2 = vnoise(wp * 1.9 + 7.1);
  float n3 = vnoise(wp * 8.7 + 3.3);
  vec3 V = normalize(cameraPos - vWorld);
  vec3 albedo = vec3(0.2);
  float wet = 0.0;
  float paint = 0.0;
  vec3 paintColor = vec3(0.8);
  vec3 emis = vec3(0.0);
  float lit = 1.0;

  if (surf < 1.5) {
    albedo = asphalt(wp, n1, n2, n3);
    if (surf < 0.5) {
      float lat = vUV.x;
      float al = abs(lat);
      float along = vUV.y;
      float rlen = vUV2.x;
      float flags = vUV2.y;
      float halfW = vInfo.y;
      float lanes = vInfo.z;
      float style = vInfo.w;
      float laneW = vUV3.x;
      float median = vUV3.y;
      float d0 = along;
      float d1 = rlen - along;
      float dEnd = min(d0, d1);
      float walk0 = mod(flags, 2.0);
      float walk1 = mod(floor(flags / 2.0), 2.0);
      float hasWalk = d0 < d1 ? walk0 : walk1;
      float clearZone = hasWalk > 0.5 ? 5.4 : 0.6;
      float marks = step(clearZone, dEnd);
      // Tire wear in each lane.
      for (int k = 0; k < 2; k++) {
        float c = median + laneW * (float(k) + 0.5);
        float inLane = step(float(k), lanes - 1.0);
        float w1 = smoothstep(0.55, 0.0, abs(al - (c - 0.8)));
        float w2 = smoothstep(0.55, 0.0, abs(al - (c + 0.8)));
        albedo *= 1.0 - (w1 + w2) * 0.14 * inLane;
      }
      // Center line.
      if (style > 0.5 && style < 1.5) {
        float off = max(median, 0.12);
        float line = band(al, off - 0.06, off + 0.08);
        paint = max(paint, line * marks);
        paintColor = mix(paintColor, vec3(0.85, 0.62, 0.12), line);
      } else if (style > 1.5) {
        float dash = step(fract(along / 9.0), 0.4);
        float line = band(al, 0.0, 0.09) * dash;
        paint = max(paint, line * marks);
        paintColor = mix(paintColor, vec3(0.85, 0.62, 0.12), line);
      }
      // Lane dividers.
      if (lanes > 1.5) {
        float x = median + laneW;
        float dash = step(fract(along / 12.0), 0.25);
        float line = band(al, x - 0.06, x + 0.06) * dash;
        paint = max(paint, line * marks);
        paintColor = mix(paintColor, vec3(0.85), line);
      }
      // Edge or parking line.
      float edge = median + laneW * lanes;
      float edgeLine = band(al, edge - 0.05, edge + 0.07) * step(edge, halfW - 0.3);
      paint = max(paint, edgeLine * marks * 0.85);
      // Crosswalk and stop line.
      if (hasWalk > 0.5) {
        float zebra = band(dEnd, 0.7, 4.0) * step(fract((lat + 50.0) / 1.15), 0.56) * step(al, halfW - 0.25);
        paint = max(paint, zebra);
        float incoming = d0 < d1 ? step(0.0, lat) : step(lat, 0.0);
        float stopLine = band(dEnd, 4.75, 5.25) * incoming * band(al, median, halfW - 0.3);
        paint = max(paint, stopLine);
        paintColor = mix(paintColor, vec3(0.86), max(zebra, stopLine));
      }
      // Manholes.
      float cell = floor(along / 31.0);
      float mh = h11(cell + rlen * 0.37);
      vec2 mc = vec2(sign(mh - 0.5) * (median + laneW * 0.5), cell * 31.0 + 9.0 + mh * 12.0);
      float md = length(vec2(lat, along) - mc);
      if (mh > 0.25 && md < 0.42) {
        albedo = vec3(0.07, 0.068, 0.065) * (0.75 + 0.25 * step(0.5, fract(md * 9.0)));
      }
      wet = smoothstep(0.58, 0.72, vnoise(wp * 0.09 + 4.0) + n2 * 0.18) + smoothstep(halfW - 1.6, halfW - 0.2, al) * 0.35;
    } else {
      wet = smoothstep(0.6, 0.75, vnoise(wp * 0.09 + 4.0) + n2 * 0.15);
    }
    paint *= 0.72 + 0.28 * n3;
    albedo = mix(albedo, paintColor * 0.62, paint);
  } else if (surf < 2.5) {
    // Sidewalk slabs. uv.x from the curb, uv.y along.
    float fromCurb = vUV.x;
    vec2 slab = vec2(fromCurb / 1.5, vUV.y / 1.5);
    float joint = max(smoothstep(0.035, 0.0, abs(fract(slab.y) - 0.5) - 0.465), smoothstep(0.035, 0.0, abs(fract(slab.x) - 0.5) - 0.465));
    float tone = 0.3 + h21(floor(slab) + 3.0) * 0.05 + n1 * 0.05 - n3 * 0.03;
    albedo = vec3(tone, tone * 0.985, tone * 0.955);
    albedo *= 1.0 - joint * 0.35;
    float curbTop = step(fromCurb, 0.32);
    albedo = mix(albedo, vec3(0.38, 0.38, 0.37), curbTop);
    float stain = smoothstep(0.62, 0.8, vnoise(wp * 0.6 + 9.0));
    albedo *= 1.0 - stain * 0.25;
    float gum = step(0.985, h21(floor(wp * 9.0)));
    albedo *= 1.0 - gum * 0.4;
    wet = smoothstep(0.66, 0.8, vnoise(wp * 0.11 + 4.0)) * 0.5;
  } else if (surf < 3.5) {
    float tone = 0.3 + n3 * 0.05;
    albedo = vec3(tone, tone, tone * 0.98) * (0.6 + 0.4 * clamp(vWorld.y / 0.14, 0.0, 1.0));
  } else if (surf < 4.5) {
    // Plaza pavers.
    vec2 g = wp / vec2(0.9, 0.45);
    g.x += step(1.0, mod(floor(g.y), 2.0)) * 0.5;
    vec2 c = floor(g);
    vec2 f = fract(g);
    float joint = max(smoothstep(0.06, 0.0, f.x), smoothstep(0.1, 0.0, f.y));
    float tone = 0.22 + h21(c) * 0.07 + n1 * 0.04;
    albedo = vec3(tone * 1.05, tone, tone * 0.93) * (1.0 - joint * 0.45);
    wet = smoothstep(0.66, 0.8, vnoise(wp * 0.11 + 4.0)) * 0.4;
  } else if (surf < 5.5) {
    // Open ground: grass, dirt, or a concrete lot.
    float grass = vInfo.y;
    float lot = vInfo.z;
    vec3 g = mix(vec3(0.035, 0.06, 0.025), vec3(0.06, 0.085, 0.03), n2) * (0.8 + 0.4 * n3);
    vec3 dirt = vec3(0.075, 0.065, 0.052) * (0.8 + 0.4 * n2);
    vec3 conc = vec3(0.15, 0.15, 0.145) * (0.82 + 0.25 * n1 - 0.1 * n3);
    float mixG = smoothstep(0.3, 0.7, grass + (n1 - 0.5) * 0.5);
    albedo = mix(mix(dirt, g, mixG), conc, lot);
  } else if (surf < 6.5) {
    albedo = mix(vec3(0.035, 0.065, 0.025), vec3(0.065, 0.095, 0.035), n2) * (0.75 + 0.5 * n3);
  } else if (surf < 7.5) {
    float tone = 0.16 + n3 * 0.06 + step(0.8, h21(floor(wp * 20.0))) * 0.05;
    albedo = vec3(tone * 1.1, tone, tone * 0.85);
  } else if (surf < 8.5) {
    // Pond.
    vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
    float ripple = vnoise(wp * 1.4 + vec2(time * 0.3, time * 0.2)) * 0.5 + vnoise(wp * 3.1 - vec2(time * 0.25, 0.0)) * 0.5;
    vec3 refl = skyColor(R) * 0.8 + lmSample(wp + V.xz * 4.0) * 0.5;
    float fres = 0.08 + 0.92 * pow(1.0 - max(V.y, 0.0), 4.0);
    vec3 water = mix(vec3(0.01, 0.02, 0.025), refl, fres) * (0.85 + ripple * 0.3);
    gl_FragColor = vec4(finish(water, vWorld, 0.2), 1.0);
    return;
  } else if (surf > 9.5) {
    // Horizon: the city past the streamed chunks, as a carpet of lights.
    vec2 cellP = wp / 74.0;
    vec2 cell = floor(cellP);
    vec2 f = fract(cellP);
    float bend = h21(cell * 0.37);
    float road = max(smoothstep(0.07, 0.0, f.x), smoothstep(0.07, 0.0, f.y));
    float lampRow = smoothstep(0.45, 0.0, length(fract(wp / 14.0) - 0.5));
    float lamps = road * lampRow;
    vec2 win = floor(wp / 5.0);
    float glitter = step(0.86, h21(win + 3.1)) * (1.0 - road) * step(0.25, bend);
    float twinkle = 0.75 + 0.25 * sin(time * 1.3 + h21(win) * 40.0);
    vec3 sodium = vec3(1.0, 0.62, 0.3);
    vec3 winC = mix(vec3(1.0, 0.75, 0.45), vec3(0.7, 0.85, 1.0), step(0.6, h21(win * 1.7)));
    float dist = length(vWorld - cameraPos);
    float fade = clamp(dist / 900.0, 0.0, 1.0);
    vec3 col = vec3(0.02, 0.021, 0.026) + sodium * lamps * 0.9 + winC * glitter * twinkle * 0.6;
    col *= mix(1.0, 0.55, fade);
    gl_FragColor = vec4(finish(col, vWorld, 0.85 * max(lamps, glitter)), 1.0);
    return;
  } else if (surf < 9.5) {
    // Store floor tiles.
    vec2 t = floor(wp / 0.5);
    float checker = mod(t.x + t.y, 2.0);
    vec3 a = vInfo.y > 0.5 ? vec3(0.62, 0.6, 0.56) : vec3(0.5, 0.48, 0.44);
    vec3 b = vInfo.y > 0.5 ? vec3(0.06, 0.06, 0.065) : vec3(0.42, 0.4, 0.37);
    albedo = mix(a, b, checker);
    vec2 f = fract(wp / 0.5);
    albedo *= 1.0 - max(smoothstep(0.04, 0.0, f.x), smoothstep(0.04, 0.0, f.y)) * 0.3;
    emis = albedo * vec3(1.0, 0.92, 0.8) * 0.75;
    lit = 0.3;
  } else {
    // Driveway / parking concrete.
    float tone = 0.19 + n1 * 0.05 - n3 * 0.03;
    albedo = vec3(tone);
  }

  vec3 L = lmSample(wp);
  vec3 light = ambient * (0.9 + 0.1 * n1) + L;
  vec3 color = albedo * light * lit + emis;
  // Wet sheen: streaks of the light map toward the camera, plus a sky tint.
  if (wet > 0.01) {
    vec2 toCam = normalize(V.xz + vec2(1e-4));
    vec3 streak = lmSample(wp + toCam * 1.6) * 0.5 + lmSample(wp + toCam * 4.5) * 0.32 + lmSample(wp + toCam * 9.0) * 0.18;
    float fres = 0.04 + 0.96 * pow(1.0 - max(V.y, 0.0), 5.0);
    vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
    color = mix(color, color * 0.55, wet * 0.5);
    color += (streak * 0.55 + skyColor(R) * 0.25) * fres * wet;
  }
  gl_FragColor = vec4(finish(color, vWorld, 0.0), 1.0);
}
`;

const FACADE_VERT = /* glsl */ `
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
varying vec2 vUV2;
varying vec4 vInfo;
void main(void) {
  vWorld = position;
  vNormal = normal;
  vUV = uv;
  vUV2 = uv2;
  vInfo = color;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const FACADE_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUV;
varying vec2 vUV2;
varying vec4 vInfo;
//#COMMON

vec3 styleWall(float style, float seed, vec2 m, float y, float n) {
  // m = meters along face, height.
  if (style < 0.5) return mix(vec3(0.07, 0.085, 0.1), vec3(0.11, 0.12, 0.13), seed);
  if (style < 1.5) {
    vec2 panel = fract(vec2(m.x / 3.0, m.y / 1.8));
    float seam = max(smoothstep(0.02, 0.0, panel.x), smoothstep(0.03, 0.0, panel.y));
    float streak = vnoise(vec2(m.x * 1.7, m.y * 0.08)) * 0.08;
    vec3 c = mix(vec3(0.34, 0.33, 0.31), vec3(0.42, 0.4, 0.37), seed) - streak;
    return c * (1.0 - seam * 0.35);
  }
  if (style < 2.5) {
    float row = floor(y / 0.075);
    float bx = fract(m.x / 0.215 + mod(row, 2.0) * 0.5);
    float by = fract(y / 0.075);
    float mortar = max(step(by, 0.14), step(bx, 0.06));
    vec3 base = mix(vec3(0.36, 0.13, 0.08), vec3(0.3, 0.18, 0.12), seed);
    base = mix(base, vec3(0.24, 0.17, 0.13), step(0.75, fract(seed * 7.0)));
    vec3 brick = base * (0.8 + 0.4 * h21(vec2(floor(m.x / 0.215 + mod(row, 2.0) * 0.5), row)));
    return mix(brick, vec3(0.3, 0.29, 0.27), mortar * 0.85);
  }
  if (style < 3.5) {
    vec2 blk = vec2(m.x / 1.2 + mod(floor(y / 0.6), 2.0) * 0.5, y / 0.6);
    vec2 f = fract(blk);
    float joint = max(smoothstep(0.02, 0.0, f.x), smoothstep(0.035, 0.0, f.y));
    vec3 c = mix(vec3(0.5, 0.45, 0.36), vec3(0.56, 0.53, 0.46), seed) * (0.9 + 0.12 * h21(floor(blk)));
    return c * (1.0 - joint * 0.3);
  }
  if (style < 4.5) {
    vec2 panel = fract(vec2(m.x / 1.5, y / 0.9));
    float seam = max(smoothstep(0.02, 0.0, panel.x), smoothstep(0.02, 0.0, panel.y));
    return vec3(0.045, 0.045, 0.05) * (1.0 + seam * 0.6);
  }
  if (style < 5.5) {
    vec3 c = vec3(0.62, 0.55, 0.45);
    float pickC = fract(seed * 5.0);
    if (pickC < 0.25) c = vec3(0.6, 0.42, 0.34);
    else if (pickC < 0.5) c = vec3(0.45, 0.52, 0.45);
    else if (pickC < 0.75) c = vec3(0.5, 0.53, 0.58);
    return c * (0.85 + 0.2 * n);
  }
  if (style < 6.5) {
    float board = fract(y / 0.2);
    float shade = 0.82 + 0.18 * smoothstep(0.0, 0.85, board);
    vec3 c = vec3(0.7, 0.68, 0.62);
    float pickC = fract(seed * 3.7);
    if (pickC < 0.2) c = vec3(0.42, 0.5, 0.58);
    else if (pickC < 0.4) c = vec3(0.6, 0.52, 0.4);
    else if (pickC < 0.6) c = vec3(0.38, 0.45, 0.38);
    else if (pickC < 0.75) c = vec3(0.55, 0.32, 0.28);
    return c * shade;
  }
  if (style < 7.5) {
    float rib = 0.75 + 0.25 * sin(m.x * 6.2832 * 3.0);
    vec3 c = mix(vec3(0.28, 0.3, 0.32), vec3(0.3, 0.22, 0.16), step(0.6, seed));
    c = mix(c, vec3(0.18, 0.24, 0.3), step(0.85, seed));
    return c * rib * (0.85 + 0.2 * n);
  }
  return vec3(0.05, 0.07, 0.09);
}

vec3 roomLight(float r) {
  if (r < 0.55) return vec3(1.0, 0.78, 0.5);
  if (r < 0.85) return vec3(0.82, 0.88, 1.0);
  if (r < 0.95) return vec3(1.0, 0.92, 0.75);
  return vec3(0.55, 0.75, 1.0);
}

/** Interior mapped room behind a window. */
vec3 room(vec3 ro, vec3 rd, vec3 halfB, float depth, float id, float lit, out float glow) {
  vec3 inv = 1.0 / (rd + vec3(1e-5));
  float tx = (sign(rd.x) * halfB.x - ro.x) * inv.x;
  float ty = (sign(rd.y) * halfB.y - ro.y) * inv.y;
  float tz = (-depth - ro.z) * inv.z;
  float t = min(min(tx, ty), tz);
  vec3 hit = ro + rd * t;
  float r = h11(id * 1.37);
  vec3 wallC = mix(vec3(0.55, 0.5, 0.42), vec3(0.42, 0.47, 0.52), step(0.6, h11(id * 2.1)));
  vec3 c;
  float depthT = clamp(-hit.z / depth, 0.0, 1.0);
  if (t == tz) {
    c = wallC;
    float furn = step(hit.y, -halfB.y + 0.75 + h11(id * 3.3) * 0.5) * step(abs(hit.x - (h11(id * 4.1) - 0.5) * halfB.x), halfB.x * 0.45);
    c = mix(c, vec3(0.08, 0.06, 0.05), furn);
    float art = step(abs(hit.x - (h11(id * 5.7) - 0.5) * halfB.x * 0.6), 0.35) * step(abs(hit.y - 0.25), 0.28) * step(0.5, h11(id * 6.6));
    c = mix(c, vec3(h11(id), h11(id + 1.0), h11(id + 2.0)) * 0.6, art);
  } else if (t == ty) {
    if (rd.y > 0.0) {
      c = vec3(0.6, 0.6, 0.58);
      float fixture = step(abs(hit.x), halfB.x * 0.5) * step(abs(hit.z + depth * 0.5), 0.3);
      c += fixture * 2.5 * lit;
    } else {
      c = mix(vec3(0.14, 0.12, 0.1), vec3(0.2, 0.17, 0.13), h11(id * 7.0));
    }
  } else {
    c = wallC * 0.8;
  }
  vec3 lc = roomLight(r);
  if (r > 0.95) lc *= 0.6 + 0.4 * sin(time * 9.0 + id) * sin(time * 3.7 + id * 2.0);
  float fall = mix(1.0, 0.55, depthT);
  vec3 litC = c * lc * fall * 1.15;
  vec3 darkC = c * vec3(0.012, 0.014, 0.02);
  glow = lit;
  return mix(darkC, litC, lit);
}

vec3 neonColor(float k) {
  if (k < 0.2) return vec3(1.0, 0.18, 0.55);
  if (k < 0.4) return vec3(0.2, 0.85, 1.0);
  if (k < 0.6) return vec3(1.0, 0.55, 0.12);
  if (k < 0.8) return vec3(0.4, 1.0, 0.35);
  return vec3(1.0, 0.25, 0.18);
}

/** Pseudo text: segment glyphs. Returns stroke coverage. */
float glyphs(vec2 p, float seedT) {
  float cw = 0.42;
  float ci = floor(p.x / cw);
  vec2 f = vec2(fract(p.x / cw), p.y);
  if (f.y < 0.0 || f.y > 1.0) return 0.0;
  float h = h11(ci * 3.1 + seedT * 17.0);
  float x = f.x * 1.25 - 0.12;
  float stroke = 0.0;
  float th = 0.09;
  if (x < 0.0 || x > 1.0) return 0.0;
  if (fract(h * 2.0) > 0.3) stroke = max(stroke, step(abs(f.y - 0.92), th) * step(0.08, x) * step(x, 0.92));
  if (fract(h * 3.0) > 0.35) stroke = max(stroke, step(abs(f.y - 0.5), th) * step(0.08, x) * step(x, 0.92));
  if (fract(h * 5.0) > 0.3) stroke = max(stroke, step(abs(f.y - 0.08), th) * step(0.08, x) * step(x, 0.92));
  if (fract(h * 7.0) > 0.25) stroke = max(stroke, step(abs(x - 0.1), th) * step(0.5, f.y));
  if (fract(h * 11.0) > 0.25) stroke = max(stroke, step(abs(x - 0.9), th) * step(0.5, f.y));
  if (fract(h * 13.0) > 0.35) stroke = max(stroke, step(abs(x - 0.1), th) * step(f.y, 0.5));
  if (fract(h * 17.0) > 0.3) stroke = max(stroke, step(abs(x - 0.9), th) * step(f.y, 0.5));
  return stroke;
}

void main(void) {
  vec3 n = normalize(vNormal);
  vec3 V = normalize(cameraPos - vWorld);
  float seed = vUV2.x;
  float style = floor(vUV2.y);
  float litFrac = fract(vUV2.y) / 0.9;
  float kind = floor(vInfo.w + 0.5);
  float glow = 0.0;
  vec3 color;
  vec3 L = lmSample(vWorld.xz + n.xz * 1.2) * exp(-max(vWorld.y - 0.5, 0.0) / 5.0);
  float moon = max(dot(n, normalize(vec3(0.35, 0.8, 0.25))), 0.0);
  vec3 amb = ambient * (0.7 + 0.3 * n.y) + vec3(0.03, 0.035, 0.05) * moon;
  float n1 = vnoise(vWorld.xz * 0.5 + vWorld.y * 0.3);

  if (kind > 0.5 && kind < 1.5) {
    // Flat roof: tar and gravel.
    float g = 0.075 + vnoise(vWorld.xz * 3.0) * 0.03 + step(0.92, h21(floor(vWorld.xz * 12.0))) * 0.03;
    color = vec3(g) * (amb * 1.6 + L * 0.3);
    gl_FragColor = vec4(finish(color, vWorld, 0.0), 1.0);
    return;
  }
  if (kind > 1.5 && kind < 2.5) {
    float seam = step(0.92, fract(vUV.y * 1.2));
    vec3 metal = mix(vec3(0.2, 0.2, 0.21), vec3(0.12, 0.12, 0.13), seam);
    color = metal * (amb * 1.4 + L);
    gl_FragColor = vec4(finish(color, vWorld, 0.0), 1.0);
    return;
  }
  if (kind > 2.5 && kind < 3.5) {
    // Gable roof shingles. uv: along ridge, up slope.
    float row = floor(vUV.y / 0.22);
    float tab = fract(vUV.x / 0.36 + mod(row, 2.0) * 0.5);
    float edge = smoothstep(0.0, 0.06, fract(vUV.y / 0.22)) * (0.85 + 0.15 * step(0.06, tab));
    vec3 c = vec3(0.16, 0.15, 0.15);
    float p = fract(seed * 9.0);
    if (p < 0.3) c = vec3(0.22, 0.12, 0.09);
    else if (p < 0.5) c = vec3(0.1, 0.13, 0.11);
    c *= (0.75 + 0.35 * h21(vec2(floor(vUV.x / 0.36), row))) * edge;
    color = c * (amb * 1.5 + L * 0.5);
    gl_FragColor = vec4(finish(color, vWorld, 0.0), 1.0);
    return;
  }

  float fh = vInfo.x;
  float bw = vInfo.y;
  float gfh = vInfo.z;
  float y = vUV.y;
  float u = vUV.x;
  vec2 m = vec2(u * bw, y);
  vec3 wall = styleWall(style, seed, m, y, n1);
  vec3 T = normalize(vec3(n.z, 0.0, -n.x));
  vec3 rdW = -V;
  vec3 rd = vec3(dot(rdW, T), rdW.y, dot(rdW, n));
  rd.z = min(rd.z, -0.05);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 skyR = skyColor(reflect(rdW, n));

  // Ground floor shops, house doors, warehouse doors.
  if (kind > 3.5 && kind < 4.5) {
    float center = gfh * bw * 0.5;
    if (style > 6.5 && style < 7.5) {
      float colI = floor(u);
      float door = step(0.5, mod(colI, 2.0)) * step(y, 4.2) * band01(fract(u), 0.08, 0.92);
      if (door > 0.5) {
        float rib = 0.8 + 0.2 * step(0.5, fract(y / 0.3));
        color = vec3(0.32, 0.33, 0.34) * rib * (amb + L);
        float lamp = step(abs(fract(u) - 0.5), 0.06) * step(abs(y - 4.55), 0.1);
        color += vec3(1.0, 0.7, 0.4) * lamp * 2.0;
        gl_FragColor = vec4(finish(color, vWorld, lamp), 1.0);
        return;
      }
    } else {
      float dx = abs(m.x - center);
      if (dx < 0.55 && y < 2.15) {
        vec3 woodC = mix(vec3(0.25, 0.12, 0.07), vec3(0.08, 0.12, 0.2), step(0.5, fract(seed * 13.0)));
        color = woodC * (amb * 1.2 + L) + vec3(1.0, 0.75, 0.4) * step(abs(m.y - 1.0), 0.03) * step(abs(m.x - center - 0.38), 0.03);
        gl_FragColor = vec4(finish(color, vWorld, 0.0), 1.0);
        return;
      }
      float porch = smoothstep(0.18, 0.0, length(vec2(dx - 0.85, y - 2.2)));
      if (porch > 0.0 && fract(seed * 23.0) > 0.35) {
        color = wall * (amb + L) + vec3(1.0, 0.75, 0.42) * porch * 3.0;
        gl_FragColor = vec4(finish(color, vWorld, porch), 1.0);
        return;
      }
    }
  }

  if (y < gfh && gfh > 0.5) {
    float shopW = 2.0 + floor(fract(seed * 7.3) * 3.0);
    float shopI = floor(u / shopW);
    float su = fract(u / shopW) * shopW;
    float sid = h11(shopI * 7.7 + seed * 31.0);
    float signTop = gfh - 0.2;
    float signBot = gfh - 1.05;
    float isOpen = step(0.3, sid);
    if (y > signTop) {
      color = vec3(0.12, 0.11, 0.1) * (amb + L);
      gl_FragColor = vec4(finish(color, vWorld, 0.0), 1.0);
      return;
    }
    vec3 nc = neonColor(fract(sid * 3.3));
    if (y > signBot) {
      vec2 p = vec2(su * bw - 0.4, (y - signBot - 0.18) / 0.5);
      float textLen = (shopW * bw - 0.8);
      float inText = step(0.0, p.x) * step(p.x, textLen);
      float g = glyphs(p, sid) * inText;
      float haloY = smoothstep(0.7, 0.0, abs(p.y - 0.5));
      float flick = 0.85 + 0.15 * step(0.03, fract(time * 0.7 + sid * 9.0));
      vec3 board = vec3(0.04, 0.04, 0.045);
      color = board * (amb + L) + nc * (g * 2.2 + haloY * inText * 0.18) * isOpen * flick;
      glow = g * isOpen;
      gl_FragColor = vec4(finish(color, vWorld, glow), 1.0);
      return;
    }
    if (y < 0.45) {
      color = vec3(0.1, 0.1, 0.1) * (amb + L * 1.3);
      gl_FragColor = vec4(finish(color, vWorld, 0.0), 1.0);
      return;
    }
    // Shop window or door.
    float bayI = floor(su);
    float bf = fract(su);
    float frame = 1.0 - band01(bf, 0.05, 0.95) * band01(y, 0.55, signBot - 0.12);
    float pier = step(bayI, 0.5) * step(bf, 0.16);
    float doorBay = floor(h11(shopI + seed * 5.0) * shopW);
    if (isOpen < 0.5) {
      float rib = 0.75 + 0.25 * step(0.5, fract(y / 0.12));
      color = vec3(0.24, 0.24, 0.25) * rib * (amb + L * 1.2);
      float tag = step(0.6, vnoise(vec2(u * 3.0, y * 2.0) + sid * 40.0)) * step(y, 2.2);
      color = mix(color, neonColor(fract(sid * 7.0)) * 0.15, tag * 0.6);
      gl_FragColor = vec4(finish(color, vWorld, 0.0), 1.0);
      return;
    }
    if (pier > 0.5) {
      color = wall * (amb + L);
      gl_FragColor = vec4(finish(color, vWorld, 0.0), 1.0);
      return;
    }
    if (frame > 0.5) {
      color = vec3(0.05, 0.05, 0.055) * (amb + L);
      gl_FragColor = vec4(finish(color, vWorld, 0.0), 1.0);
      return;
    }
    vec3 ro = vec3((bf - 0.5) * bw, y - (signBot + 0.5) * 0.5, 0.0);
    vec3 halfB = vec3(bw * 0.5, (signBot - 0.5) * 0.5 + 0.3, 0.0);
    vec3 inv = 1.0 / (rd + vec3(1e-5));
    float depth = 3.0 + h11(sid * 3.0) * 2.5;
    float tz = (-depth - ro.z) * inv.z;
    float ty = (sign(rd.y) * halfB.y - ro.y) * inv.y;
    float tx = (sign(rd.x) * halfB.x - ro.x) * inv.x;
    float t = min(min(tx, ty), tz);
    vec3 hit = ro + rd * t;
    float kindS = fract(sid * 13.7);
    vec3 shopLight = kindS < 0.35 ? vec3(1.0, 0.78, 0.5) : kindS < 0.7 ? vec3(0.9, 0.94, 1.0) : vec3(1.0, 0.9, 0.75);
    float level = kindS > 0.88 ? 0.28 : 0.72;
    vec3 wallIn = mix(vec3(0.5, 0.45, 0.38), vec3(0.42, 0.44, 0.46), step(0.5, fract(sid * 9.1)));
    vec3 inside;
    float floorY = -halfB.y;
    if (t == tz) {
      inside = wallIn;
      if (kindS > 0.35 && kindS < 0.7) {
        float rowY = hit.y - floorY;
        float onShelf = step(rowY, 2.0) * step(0.25, rowY);
        float shelf = step(0.85, fract(rowY / 0.45));
        vec2 pc = vec2(floor(hit.x / 0.3), floor(rowY / 0.45));
        vec3 goods = mix(vec3(0.45, 0.42, 0.38), vec3(h21(pc + sid), h21(pc + 3.0 + sid), h21(pc + 7.0 + sid)), 0.35);
        goods *= 0.5 + 0.5 * h21(pc * 1.7);
        inside = mix(inside, mix(goods, vec3(0.18), shelf), onShelf);
      } else {
        float board = step(abs(hit.x - (h11(sid) - 0.5) * halfB.x), 0.5) * step(abs(hit.y - halfB.y * 0.35), 0.3);
        inside = mix(inside, neonColor(fract(sid * 5.0)) * 0.9, board * step(0.35, kindS));
      }
      float counter = step(hit.y - floorY, 1.05) * step(0.3, fract(sid * 2.3));
      inside = mix(inside, vec3(0.16, 0.11, 0.08), counter);
    } else if (t == ty) {
      if (rd.y > 0.0) {
        float lamp = step(0.7, fract(hit.z * 0.6 + hit.x * 0.2));
        inside = vec3(0.55) + vec3(1.2) * lamp;
      } else {
        inside = vec3(0.16, 0.15, 0.14) * (0.8 + 0.2 * step(0.5, fract(hit.x * 2.0 + floor(hit.z * 2.0) * 0.5)));
      }
    } else {
      inside = wallIn * 0.75;
    }
    float people = step(0.55, h11(sid * 7.7 + bayI)) * step(abs(hit.x - (h11(bayI + sid) - 0.5) * halfB.x), 0.22) * step(hit.y - floorY, 1.7) * step(0.0, hit.y - floorY) * step(depth * 0.4, -hit.z);
    inside = mix(inside, vec3(0.05, 0.045, 0.045), people);
    vec3 shop = inside * shopLight * level * mix(1.0, 0.6, clamp(-hit.z / depth, 0.0, 1.0));
    if (bayI == doorBay) {
      shop *= 0.6;
      shop += step(abs(bf - 0.8), 0.03) * step(abs(y - 1.1), 0.25) * vec3(0.5);
    }
    color = mix(shop, skyR * 0.6, fres * 0.6);
    gl_FragColor = vec4(finish(color, vWorld, 0.8), 1.0);
    return;
  }

  // Upper floors.
  float yy = y - gfh;
  float floorI = floor(yy / fh);
  float fy = fract(yy / fh);
  float colI = floor(u);
  float fx = fract(u);
  vec4 win = vec4(0.25, 0.22, 0.75, 0.8);
  if (style < 0.5) win = vec4(0.035, 0.2, 0.965, 0.97);
  else if (style < 1.5) win = vec4(0.18, 0.26, 0.82, 0.86);
  else if (style < 2.5) win = vec4(0.27, 0.24, 0.73, 0.8);
  else if (style < 3.5) win = vec4(0.3, 0.2, 0.7, 0.82);
  else if (style < 4.5) win = vec4(0.0, 0.32, 1.0, 0.86);
  else if (style < 5.5) win = vec4(0.3, 0.3, 0.7, 0.78);
  else if (style < 6.5) win = vec4(0.32, 0.32, 0.68, 0.76);
  else if (style < 7.5) win = vec4(0.06, 0.62, 0.94, 0.86);
  else win = vec4(0.04, 0.16, 0.96, 0.98);
  float inWin = band01(fx, win.x, win.z) * band01(fy, win.y, win.w);
  float mullion = 0.0;
  if (style < 0.5 || style > 7.5) {
    mullion = max(step(abs(fx - 0.5), 0.012), 0.0);
  }
  if (style > 6.5 && style < 7.5 && floorI > 0.5) inWin = 0.0;
  float cellId = colI * 13.0 + floorI * 101.0 + seed * 977.0;
  float rId = h11(cellId);
  float floorLit = h11(floorI * 3.3 + seed * 41.0);
  float lit = step(rId, mix(0.15, 1.0, floorLit) * litFrac * 1.5);

  if (inWin > 0.5 && mullion < 0.5) {
    vec3 ro = vec3((fx - (win.x + win.z) * 0.5) * bw, (fy - (win.y + win.w) * 0.5) * fh, 0.0);
    vec3 halfB = vec3(bw * 0.5, fh * 0.5, 0.0);
    float depth = 3.0 + h11(cellId * 1.7) * 4.0;
    float g;
    vec3 inside = room(ro, rd, halfB, depth, cellId, lit, g);
    // Blinds.
    float blinds = step(0.62, h11(cellId * 2.9));
    float drop = mix(win.w, win.y, h11(cellId * 3.9) * 0.8);
    float onBlind = blinds * step(drop, fy);
    vec3 blindC = mix(vec3(0.02), vec3(1.0, 0.85, 0.62) * 0.55, lit) * (0.8 + 0.2 * step(0.5, fract(fy * fh * 9.0)));
    inside = mix(inside, blindC, onBlind);
    vec3 tint = style < 0.5 ? vec3(0.55, 0.7, 0.8) : style > 7.5 ? vec3(0.45, 0.65, 0.85) : vec3(0.85, 0.9, 0.95);
    float reflAmt = style < 0.5 || style > 7.5 ? 0.85 : 0.6;
    color = mix(inside * tint, skyR * tint + L * 0.15, clamp(fres * reflAmt + (1.0 - lit) * 0.12, 0.0, 1.0));
    glow = lit * 0.9;
  } else {
    color = wall * (amb + L);
    if (style > 1.5 && style < 3.5) {
      // Lintels and sills.
      float lintel = band01(fx, win.x - 0.04, win.z + 0.04) * (band01(fy, win.w, win.w + 0.06) + band01(fy, win.y - 0.05, win.y));
      color = mix(color, vec3(0.42, 0.4, 0.36) * (amb + L), lintel);
    }
    if (style > 0.5 && style < 1.5) {
      float reveal = band01(fx, win.x - 0.03, win.z + 0.03) * band01(fy, win.y - 0.03, win.w + 0.03);
      color *= 1.0 - reveal * 0.5;
    }
    if (style < 0.5 || style > 7.5) {
      color = mix(color, skyR * 0.35, fres * 0.5);
    }
  }
  if (style > 7.5) {
    // Apex: LED slab lines every six floors and a lit crown.
    float slab = step(fract(yy / (fh * 6.0)), 0.012);
    color += vec3(0.25, 0.75, 1.0) * slab * 1.6;
    float crown = step(196.0, vWorld.y) * step(abs(fract(vWorld.y / 2.0) - 0.5), 0.08);
    color += vec3(0.4, 0.85, 1.0) * crown * 1.4;
    glow = max(glow, max(slab, crown));
  }
  gl_FragColor = vec4(finish(color, vWorld, glow), 1.0);
}
`;

const FACADE_FAR_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUV;
varying vec2 vUV2;
varying vec4 vInfo;
//#COMMON
void main(void) {
  vec3 n = normalize(vNormal);
  float seed = vUV2.x;
  float kind = floor(vInfo.w + 0.5);
  if (kind > 0.5) {
    gl_FragColor = vec4(finish(vec3(0.02), vWorld, 0.0), 1.0);
    return;
  }
  float fh = vInfo.x;
  float u = vUV.x;
  float y = vUV.y;
  float floorI = floor(y / fh);
  float colI = floor(u);
  vec2 f = vec2(fract(u), fract(y / fh));
  float inWin = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.85);
  float id = colI * 13.0 + floorI * 101.0 + seed * 977.0;
  float lit = step(h11(id), mix(0.15, 1.0, h11(floorI * 3.3 + seed * 41.0)) * fract(vUV2.y) / 0.9 * 1.5);
  vec3 lc = h11(id * 1.37) < 0.6 ? vec3(1.0, 0.75, 0.45) : vec3(0.8, 0.88, 1.0);
  vec3 wallC = vec3(0.03, 0.032, 0.04) + ambient * 0.1;
  vec3 color = mix(wallC, lc * 0.9, inWin * lit);
  gl_FragColor = vec4(finish(color, vWorld, inWin * lit), 1.0);
}
`;

const PROP_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec2 uv2;
attribute vec4 color;
uniform mat4 worldViewProjection;
uniform float time;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vMode;
varying vec4 vColor;
void main(void) {
  vec3 p = position;
  float sway = uv2.x;
  if (sway > 0.0) {
    float t = time * 1.3 + p.x * 0.21 + p.z * 0.17;
    p.x += sin(t) * 0.06 * sway;
    p.z += cos(t * 0.8) * 0.05 * sway;
  }
  vWorld = p;
  vNormal = normal;
  vMode = uv;
  vColor = color;
  gl_Position = worldViewProjection * vec4(p, 1.0);
}
`;

const SIGNAL_LOGIC = /* glsl */ `
float signalOn(float param) {
  float group = floor(param / 8.0);
  float lamp = param - group * 8.0;
  float st = group < 0.5 ? sig.x : sig.y;
  float walk = group < 0.5 ? sig.z : sig.w;
  if (lamp < 0.5) return step(1.5, st);
  if (lamp < 1.5) return step(0.5, st) * step(st, 1.5);
  if (lamp < 2.5) return step(st, 0.5);
  if (lamp < 3.5) return step(0.5, walk) * step(walk, 1.5) + step(1.5, walk) * step(0.5, fract(time * 1.5));
  return 1.0 - step(0.5, walk) * step(walk, 1.5);
}
`;

const PROP_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vMode;
varying vec4 vColor;
//#COMMON
${SIGNAL_LOGIC}
void main(void) {
  vec3 n = normalize(vNormal);
  vec3 V = normalize(cameraPos - vWorld);
  float mode = floor(vMode.x + 0.5);
  vec3 albedo = vColor.rgb;
  float emissive = vColor.a;
  vec3 L = lmSample(vWorld.xz + n.xz * 0.4) * (0.55 + 0.45 * exp(-max(vWorld.y - 0.3, 0.0) / 4.0));
  float up = max(n.y, 0.0);
  vec3 amb = ambient * (0.65 + 0.35 * up);
  vec3 color = albedo * (amb + L);
  float glow = 0.0;
  if (mode == 1.0) {
    color = albedo * emissive;
    glow = 1.0;
  } else if (mode == 2.0) {
    float on = signalOn(vMode.y);
    color = albedo * mix(0.05, 2.6, on);
    glow = on;
  } else if (mode == 3.0) {
    float on = step(0.55, fract(time * 0.6 + vMode.y));
    color = albedo * mix(0.15, 3.0, on);
    glow = on;
  } else if (mode == 4.0) {
    vec3 R = reflect(-V, n);
    float fres = 0.06 + 0.94 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
    color = mix(albedo * (amb + L) * 0.6, skyColor(R) + L * 0.25, fres);
  } else if (mode == 5.0) {
    float var = 0.7 + 0.6 * vnoise(vWorld.xz * 1.7 + vWorld.y * 2.3);
    float rim = pow(1.0 - max(dot(n, V), 0.0), 2.0) * 0.35;
    vec3 moonLit = vec3(0.05, 0.065, 0.1) * max(dot(n, normalize(vec3(0.35, 0.8, 0.25))), 0.0);
    color = albedo * var * (amb * 1.7 + moonLit * 3.0 + L * 0.75 + rim * ambient);
  } else if (mode == 6.0) {
    float flick = 0.88 + 0.12 * sin(time * 2.0 + vMode.y * 13.0);
    flick *= step(0.02, fract(time * 0.31 + vMode.y));
    color = albedo * emissive * flick;
    glow = 1.0;
  } else if (mode == 7.0) {
    // Water in the fountain basin.
    float ripple = vnoise(vWorld.xz * 3.0 + time * 0.8);
    color = mix(vec3(0.02, 0.05, 0.07), skyColor(reflect(-V, n)), 0.5) + vec3(0.1, 0.35, 0.45) * ripple * 0.6;
    glow = 0.3;
  }
  gl_FragColor = vec4(finish(color, vWorld, glow), 1.0);
}
`;

const GLOW_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec2 uv2;
attribute vec4 color;
uniform mat4 viewProjection;
uniform mat4 view;
uniform mat4 world;
uniform vec3 cameraPos;
uniform float time;
uniform vec4 sig;
uniform float flareScale;
varying vec2 vCorner;
varying vec4 vColor;
varying float vFade;
${SIGNAL_LOGIC}
void main(void) {
  vec3 right = vec3(view[0][0], view[1][0], view[2][0]);
  vec3 up = vec3(view[0][1], view[1][1], view[2][1]);
  vec3 center = (world * vec4(position, 1.0)).xyz;
  float d = length(position - cameraPos);
  float size = uv2.x * (1.0 + d * 0.012) * flareScale;
  float mode = floor(uv2.y / 64.0 + 0.001);
  float param = uv2.y - mode * 64.0;
  float on = 1.0;
  if (mode > 1.5 && mode < 2.5) on = signalOn(param);
  if (mode > 2.5 && mode < 3.5) on = step(0.55, fract(time * 0.6 + param / 64.0));
  vec3 p = center + (right * uv.x + up * uv.y) * size * on;
  vCorner = uv;
  vColor = color;
  vFade = clamp(1.0 - d / (420.0 * flareScale), 0.0, 1.0) * on * clamp((d - 0.8) / 2.0, 0.0, 1.0);
  gl_Position = viewProjection * vec4(p, 1.0);
}
`;

const GLOW_FRAG = /* glsl */ `
precision highp float;
varying vec2 vCorner;
varying vec4 vColor;
varying float vFade;
void main(void) {
  float r = dot(vCorner, vCorner);
  float core = exp(-r * 9.0);
  float halo = exp(-r * 2.6) * 0.35;
  float a = (core + halo) * vFade * vColor.a;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor.rgb * a, a);
}
`;

const BAND = /* glsl */ `
float band01(float x, float a, float b) {
  return step(a, x) * step(x, b);
}
`;

const withCommon = (src: string) => src.replace('//#COMMON', COMMON + BAND);

export const CITY_SHADERS = {
  groundVert: GROUND_VERT,
  groundFrag: withCommon(GROUND_FRAG),
  facadeVert: FACADE_VERT,
  facadeFrag: withCommon(FACADE_FRAG),
  facadeFarFrag: withCommon(FACADE_FAR_FRAG),
  propVert: PROP_VERT,
  propFrag: withCommon(PROP_FRAG),
  glowVert: GLOW_VERT,
  glowFrag: GLOW_FRAG,
};

export const SHARED_UNIFORMS = [
  'worldViewProjection', 'cameraPos', 'fogColor', 'fogDensity', 'lmInfo', 'ambient', 'skyTop', 'skyHorizon', 'time', 'sig', 'boost',
];
