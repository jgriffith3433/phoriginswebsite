/**
 * Interior surfaces for the office and the basement. One shader: wall, floor,
 * ceiling, and prop styles are picked per vertex. Lit from the level's own point
 * lights (nearest few), the hemisphere fill, and the phone flashlight, so the
 * story's dips and the beam still read on every surface.
 *
 * Attributes: uv = surface coords in meters (walls: along, height; floors: x, z),
 * uv2 = (style, variant), color = prop albedo (rgb) and emissive (a).
 */

export const MAX_INTERIOR_LIGHTS = 12;

/** Styles. Keep in sync with the branches below. */
export const IS = {
  SOLID: 0,
  // Walls.
  OFFICE_WALL: 1,
  WOOD_SLATS: 2,
  WALNUT_PAPER: 3,
  MARBLE_WALL: 4,
  BATH_TILE: 5,
  BLOCK: 6,
  LAB_TILE: 7,
  STEEL_PANEL: 8,
  CONCRETE: 9,
  // Floors.
  CARPET: 20,
  PLANKS: 21,
  MARBLE_FLOOR: 22,
  SMALL_TILE: 23,
  EPOXY: 24,
  DIAMOND: 25,
  LAB_FLOOR: 26,
  // Ceilings.
  ACOUSTIC: 40,
  CONCRETE_CEIL: 41,
  // Prop finishes.
  WOOD: 60,
  METAL: 61,
  GLASS: 62,
  SCREEN: 63,
  BOOKS: 64,
  FABRIC: 65,
  LEAF: 66,
  LIQUID: 67,
  HAZARD: 68,
  RUBBER: 69,
  /** Atlas quad: art, signs, labels. Color alpha is the emissive amount. */
  TEX: 70,
} as const;

export const INTERIOR_VERT = /* glsl */ `
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
varying vec2 vStyle;
varying vec4 vColor;
void main(void) {
  vWorld = position;
  vNormal = normal;
  vUV = uv;
  vStyle = uv2;
  vColor = color;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

export const INTERIOR_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUV;
varying vec2 vStyle;
varying vec4 vColor;
uniform vec3 cameraPos;
uniform vec4 lPos[${MAX_INTERIOR_LIGHTS}];
uniform vec3 lCol[${MAX_INTERIOR_LIGHTS}];
uniform vec3 spotPos;
uniform vec3 spotDir;
uniform vec4 spotInfo;
uniform vec3 hemiSky;
uniform vec3 hemiGround;
uniform vec3 fogColor;
uniform vec3 fogInfo;
uniform float time;
uniform float lightGain;
uniform sampler2D atlas;
uniform float toGamma;

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
float fbm(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.1 + 3.7) * 0.3 + vnoise(p * 4.3 + 7.1) * 0.15;
}
float gridLine(float v, float w) {
  float f = fract(v);
  return 1.0 - smoothstep(0.0, w, min(f, 1.0 - f));
}

/** Albedo, roughness-ish gloss, and an emissive term for every style. */
void surface(float style, float variant, vec2 p, vec3 n, out vec3 albedo, out float gloss, out vec3 emis, out float bump) {
  albedo = vColor.rgb;
  gloss = 0.08;
  emis = vec3(0.0);
  bump = 0.0;
  float y = p.y;
  if (style < 0.5) {
    emis = vColor.rgb * vColor.a;
    return;
  }
  // ---------- Walls ----------
  if (style < 1.5) {
    // Office: plaster, wood wainscot to 0.95 m, chair rail, baseboard.
    vec3 paint = mix(vec3(0.74, 0.72, 0.68), vec3(0.6, 0.64, 0.66), variant);
    float speck = vnoise(p * 40.0) * 0.04 + fbm(p * 1.5) * 0.04;
    albedo = paint * (0.96 + speck);
    if (y < 0.95) {
      float panel = fract(p.x / 1.2);
      float frame = 1.0 - smoothstep(0.0, 0.03, min(min(panel, 1.0 - panel) * 1.2, min(y - 0.14, 0.86 - y)));
      vec3 wood = mix(vec3(0.32, 0.2, 0.12), vec3(0.42, 0.27, 0.16), vnoise(vec2(p.x * 1.5, y * 30.0)));
      albedo = wood * (1.0 - frame * 0.25);
      gloss = 0.3;
    }
    if (abs(y - 0.97) < 0.035) { albedo = vec3(0.26, 0.16, 0.1); gloss = 0.4; }
    if (y < 0.13) { albedo = vec3(0.12, 0.1, 0.09); gloss = 0.25; }
    if (y > 2.95) albedo = vec3(0.86, 0.85, 0.82);
    return;
  }
  if (style < 2.5) {
    // Boardroom: vertical walnut slats over a dark felt backer.
    float slat = fract(p.x / 0.11);
    float gap = smoothstep(0.08, 0.16, slat) * smoothstep(0.92, 0.84, slat);
    vec3 wood = mix(vec3(0.24, 0.14, 0.08), vec3(0.36, 0.22, 0.13), vnoise(vec2(floor(p.x / 0.11) * 3.1, y * 6.0)));
    albedo = mix(vec3(0.03, 0.03, 0.032), wood, gap);
    bump = 1.0 - gap;
    gloss = 0.06 * gap;
    if (y < 0.12) albedo = vec3(0.06, 0.05, 0.05);
    return;
  }
  if (style < 3.5) {
    // Pierce's office: walnut wainscot to 1.1 m, textured paper above.
    if (y < 1.1) {
      float panel = fract(p.x / 0.9);
      float frame = 1.0 - smoothstep(0.0, 0.025, min(min(panel, 1.0 - panel) * 0.9, min(y - 0.16, 1.0 - y)));
      albedo = mix(vec3(0.18, 0.1, 0.06), vec3(0.26, 0.15, 0.09), vnoise(vec2(p.x * 2.0, y * 25.0))) * (1.0 - frame * 0.3);
      gloss = 0.35;
    } else {
      vec2 q = vec2(p.x / 0.32, (y - 1.1) / 0.42);
      vec2 f = fract(q) - 0.5;
      float motif = smoothstep(0.24, 0.18, length(f * vec2(1.0, 1.6))) - smoothstep(0.16, 0.1, length(f * vec2(1.0, 1.6)));
      albedo = mix(vec3(0.3, 0.33, 0.31), vec3(0.325, 0.355, 0.33), motif) * (0.95 + fbm(p * 3.0) * 0.08);
    }
    if (abs(y - 1.12) < 0.03) albedo = vec3(0.14, 0.08, 0.05);
    if (y < 0.15) albedo = vec3(0.08, 0.05, 0.03);
    return;
  }
  if (style < 4.5) {
    // Lobby marble panels.
    vec2 q = p / vec2(1.2, 0.6);
    vec2 cell = floor(q);
    vec2 f = fract(q);
    float seam = 1.0 - smoothstep(0.0, 0.012, min(min(f.x, 1.0 - f.x) * 1.2, min(f.y, 1.0 - f.y) * 0.6));
    float vein = smoothstep(0.02, 0.0, abs(fbm(p * 1.3 + cell * 7.0) - 0.5 + sin(p.x * 2.0 + p.y) * 0.05));
    albedo = mix(vec3(0.82, 0.8, 0.76), vec3(0.42, 0.4, 0.38), vein * 0.7) * (1.0 - seam * 0.5);
    gloss = 0.7;
    return;
  }
  if (style < 5.5) {
    // Bathroom tile.
    vec2 q = p / 0.2;
    vec2 f = fract(q);
    float grout = 1.0 - smoothstep(0.0, 0.05, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    albedo = mix(vec3(0.88, 0.88, 0.86), vec3(0.62, 0.64, 0.64), grout) * (0.96 + h21(floor(q)) * 0.05);
    if (abs(y - 1.3) < 0.1) albedo = mix(vec3(0.15, 0.22, 0.26), vec3(0.5), grout);
    gloss = 0.6 * (1.0 - grout);
    return;
  }
  if (style < 6.5) {
    // Basement cinder block, painted. Lower band darker, a stripe, grime and rust runs.
    vec2 q = vec2(p.x / 0.4 + step(1.0, mod(floor(y / 0.2), 2.0)) * 0.5, y / 0.2);
    vec2 f = fract(q);
    float mortar = 1.0 - smoothstep(0.0, 0.04, min(min(f.x, 1.0 - f.x) * 0.4, min(f.y, 1.0 - f.y) * 0.2) * 4.0);
    vec3 upper = mix(vec3(0.58, 0.6, 0.55), vec3(0.5, 0.54, 0.56), variant);
    vec3 lower = mix(vec3(0.2, 0.28, 0.24), vec3(0.32, 0.3, 0.24), variant);
    albedo = y < 1.2 ? lower : upper;
    if (abs(y - 1.25) < 0.05) albedo = mix(vec3(0.62, 0.48, 0.1), vec3(0.6, 0.15, 0.1), variant);
    albedo *= (1.0 - mortar * 0.35) * (0.92 + h21(floor(q)) * 0.1) * (0.9 + vnoise(p * 12.0) * 0.15);
    float grime = smoothstep(0.45, 0.9, fbm(vec2(p.x * 0.7, y * 0.25))) * 0.45 + smoothstep(0.7, 0.0, y) * 0.25;
    float runs = smoothstep(0.7, 0.95, vnoise(vec2(p.x * 4.0, 0.3))) * smoothstep(3.2, 1.2, y) * smoothstep(0.4, 1.5, y);
    albedo *= 1.0 - grime;
    albedo = mix(albedo, vec3(0.28, 0.14, 0.06), runs * 0.55);
    bump = mortar;
    return;
  }
  if (style < 7.5) {
    // Lab tile, stained.
    vec2 q = p / 0.15;
    vec2 f = fract(q);
    float grout = 1.0 - smoothstep(0.0, 0.07, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    vec3 tile = mix(vec3(0.72, 0.76, 0.74), vec3(0.6, 0.7, 0.72), variant) * (0.94 + h21(floor(q)) * 0.08);
    albedo = mix(tile, vec3(0.2, 0.22, 0.2), grout);
    float stain = smoothstep(0.5, 0.85, fbm(p * vec2(0.5, 0.35) + variant * 9.0));
    float drip = smoothstep(0.75, 0.97, vnoise(vec2(p.x * 3.0, 1.7))) * smoothstep(3.0, 0.8, y);
    albedo *= 1.0 - stain * 0.45 - smoothstep(0.6, 0.0, y) * 0.3;
    albedo = mix(albedo, vec3(0.25, 0.3, 0.12), drip * 0.4);
    gloss = 0.5 * (1.0 - grout) * (1.0 - stain);
    bump = grout;
    return;
  }
  if (style < 8.5) {
    // Riveted steel panels with a hazard band.
    vec2 q = p / vec2(1.2, 1.1);
    vec2 f = fract(q);
    float seam = 1.0 - smoothstep(0.0, 0.01, min(min(f.x, 1.0 - f.x) * 1.2, min(f.y, 1.0 - f.y) * 1.1));
    vec2 rv = fract(p / vec2(0.15, 1.1)) - vec2(0.5, 0.05);
    float rivet = smoothstep(0.012, 0.0, length(vec2(rv.x * 0.15, rv.y * 1.1)) - 0.005) * step(min(f.x, 1.0 - f.x), 0.06);
    vec3 steel = vec3(0.34, 0.36, 0.37) * (0.85 + fbm(p * vec2(0.6, 3.0)) * 0.25);
    float rust = smoothstep(0.6, 0.9, fbm(p * 0.8 + 3.0)) * 0.6 + smoothstep(0.75, 0.97, vnoise(vec2(p.x * 3.0, 9.0))) * smoothstep(3.0, 0.5, y) * 0.5;
    albedo = mix(steel, vec3(0.3, 0.14, 0.06), rust) * (1.0 - seam * 0.5) + rivet * 0.12;
    if (y > 0.9 && y < 1.1) {
      float stripe = step(0.5, fract((p.x + y) / 0.3));
      albedo = mix(vec3(0.05), vec3(0.75, 0.55, 0.05), stripe) * (1.0 - rust * 0.4);
    }
    gloss = 0.45 * (1.0 - rust);
    bump = seam;
    return;
  }
  if (style < 9.5) {
    // Board-formed concrete with tie holes.
    float board = fract(y / 0.3);
    float edge = 1.0 - smoothstep(0.0, 0.03, min(board, 1.0 - board));
    vec2 tie = fract(p / vec2(0.9, 0.6)) - 0.5;
    float hole = smoothstep(0.03, 0.02, length(tie * vec2(0.9, 0.6)));
    albedo = vec3(0.36, 0.35, 0.33) * (0.8 + fbm(p * vec2(0.4, 3.0)) * 0.35) * (1.0 - edge * 0.2) * (1.0 - hole * 0.6);
    albedo *= 1.0 - smoothstep(0.65, 0.95, fbm(p * 0.6)) * 0.35;
    bump = edge;
    return;
  }
  // ---------- Floors ----------
  if (style > 19.5 && style < 20.5) {
    // Commercial carpet: tufts and a quiet geometric pattern.
    vec3 base = mix(vec3(0.14, 0.17, 0.22), vec3(0.18, 0.15, 0.14), variant);
    vec2 q = p / 0.6;
    vec2 f = fract(q) - 0.5;
    float pat = smoothstep(0.03, 0.0, abs(abs(f.x) + abs(f.y) - 0.35));
    albedo = base * (0.85 + vnoise(p * 60.0) * 0.25) + pat * 0.035;
    albedo *= 1.0 - smoothstep(0.6, 0.0, fbm(p * 0.3)) * 0.1;
    return;
  }
  if (style < 21.5) {
    // Wood planks.
    vec2 q = vec2(p.x / 0.18, p.y / 1.8 + floor(p.x / 0.18) * 0.37);
    vec2 cell = floor(q);
    vec2 f = fract(q);
    float joint = 1.0 - smoothstep(0.0, 0.04, min(min(f.x, 1.0 - f.x) * 0.18 * 20.0, min(f.y, 1.0 - f.y) * 4.0));
    vec3 wood = mix(vec3(0.34, 0.2, 0.11), vec3(0.48, 0.3, 0.17), h21(cell));
    float grain = vnoise(vec2(p.x * 40.0, p.y * 2.0 + cell.x));
    albedo = wood * (0.85 + grain * 0.25) * (1.0 - joint * 0.5);
    gloss = 0.45;
    return;
  }
  if (style < 22.5) {
    vec2 q = p / 0.9;
    vec2 cell = floor(q);
    vec2 f = fract(q);
    float seam = 1.0 - smoothstep(0.0, 0.01, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    float vein = smoothstep(0.009, 0.0, abs(fbm(p * 0.8 + cell * 5.0) - 0.5)) + smoothstep(0.005, 0.0, abs(fbm(p * 2.3 + cell * 3.0) - 0.5)) * 0.5;
    float cloud = fbm(p * 0.6 + cell * 2.0);
    albedo = mix(vec3(0.8, 0.78, 0.74), vec3(0.42, 0.4, 0.38), clamp(vein, 0.0, 1.0) * 0.45) * (0.94 + cloud * 0.08) * (1.0 - seam * 0.6);
    gloss = 0.85;
    return;
  }
  if (style < 23.5) {
    vec2 q = p / 0.1;
    vec2 f = fract(q);
    float grout = 1.0 - smoothstep(0.0, 0.08, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    albedo = mix(vec3(0.3, 0.32, 0.34), vec3(0.12), grout) * (0.9 + h21(floor(q)) * 0.15);
    gloss = 0.4 * (1.0 - grout);
    return;
  }
  if (style < 24.5) {
    // Basement epoxy over concrete: worn, cracked, stained, joints.
    vec3 epoxy = mix(vec3(0.24, 0.27, 0.26), vec3(0.3, 0.28, 0.24), variant);
    float wear = smoothstep(0.35, 0.8, fbm(p * 0.35));
    albedo = mix(epoxy, vec3(0.32, 0.31, 0.29), wear * 0.6) * (0.88 + vnoise(p * 9.0) * 0.18);
    vec2 slab = fract(p / 4.0);
    float joint = 1.0 - smoothstep(0.0, 0.004, min(min(slab.x, 1.0 - slab.x), min(slab.y, 1.0 - slab.y)));
    float crack = smoothstep(0.012, 0.0, abs(vnoise(p * 0.9) - 0.5)) * smoothstep(0.55, 0.75, vnoise(p * 0.2 + 4.0));
    float stain = smoothstep(0.62, 0.9, fbm(p * 0.25 + 9.0));
    albedo *= (1.0 - joint * 0.5) * (1.0 - crack * 0.6) * (1.0 - stain * 0.4);
    vec2 dr = fract(p / 9.0) - 0.5;
    float drain = step(length(dr * 9.0), 0.22) * (0.5 + 0.5 * step(0.5, fract(dr.x * 9.0 * 8.0)));
    albedo = mix(albedo, vec3(0.05), drain * 0.85);
    gloss = 0.35 * (1.0 - wear) + stain * 0.3;
    return;
  }
  if (style < 25.5) {
    // Diamond plate.
    vec2 q = p / 0.06;
    vec2 f = fract(q) - 0.5;
    float a = step(0.5, fract((floor(q.x) + floor(q.y)) * 0.5));
    vec2 r = a > 0.5 ? vec2(f.x + f.y, f.x - f.y) : vec2(f.x - f.y, f.x + f.y);
    float bar = smoothstep(0.1, 0.05, abs(r.y) * 1.0) * smoothstep(0.42, 0.3, abs(r.x));
    vec3 steel = vec3(0.3, 0.31, 0.32) * (0.8 + fbm(p * 0.7) * 0.35);
    float rust = smoothstep(0.65, 0.9, fbm(p * 0.5 + 2.0));
    albedo = mix(steel, vec3(0.25, 0.13, 0.06), rust * 0.7) + bar * 0.08;
    gloss = 0.5 * (1.0 - rust) + bar * 0.3;
    bump = bar;
    return;
  }
  if (style < 26.5) {
    vec2 q = p / 0.3;
    vec2 f = fract(q);
    float grout = 1.0 - smoothstep(0.0, 0.04, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    vec3 tile = mix(vec3(0.6, 0.64, 0.62), vec3(0.5, 0.56, 0.58), h21(floor(q)) * 0.5 + variant * 0.5);
    float stain = smoothstep(0.5, 0.85, fbm(p * 0.3 + 5.0));
    albedo = mix(tile, vec3(0.15), grout) * (1.0 - stain * 0.5);
    gloss = 0.4 * (1.0 - grout) * (1.0 - stain);
    return;
  }
  // ---------- Ceilings ----------
  if (style > 39.5 && style < 40.5) {
    vec2 q = p / vec2(0.6, 1.2);
    vec2 f = fract(q);
    float tee = 1.0 - smoothstep(0.0, 0.02, min(min(f.x, 1.0 - f.x) * 0.6, min(f.y, 1.0 - f.y) * 1.2));
    float speck = step(0.7, h21(floor(p * 90.0))) * 0.06;
    albedo = mix(vec3(0.82, 0.82, 0.8) - speck, vec3(0.92), tee);
    return;
  }
  if (style < 41.5) {
    albedo = vec3(0.22, 0.22, 0.21) * (0.75 + fbm(p * 0.6) * 0.4);
    float form = gridLine(p.x / 1.2, 0.02);
    albedo *= 1.0 - form * 0.3;
    return;
  }
  // ---------- Prop finishes ----------
  if (style < 60.5) {
    float grain = vnoise(vec2(dot(p, vec2(1.0, 0.3)) * 3.0, dot(p, vec2(-0.3, 1.0)) * 40.0));
    albedo = vColor.rgb * (0.82 + grain * 0.3);
    gloss = 0.35;
    return;
  }
  if (style < 61.5) {
    albedo = vColor.rgb * (0.85 + fbm(p * 3.0) * 0.2);
    gloss = 0.6;
    return;
  }
  if (style < 62.5) {
    albedo = vColor.rgb;
    gloss = 0.95;
    return;
  }
  if (style < 63.5) {
    // Screens: emissive content in the vertex color, with scanlines and a slow roll.
    float scan = 0.85 + 0.15 * step(0.5, fract(p.y * 90.0));
    float roll = 0.9 + 0.1 * sin(p.y * 8.0 - time * 2.0);
    float graph = smoothstep(0.03, 0.0, abs(fract(p.y * 3.0) - (0.5 + 0.35 * sin(p.x * 9.0 + time * 0.6 + variant * 5.0))));
    albedo = vec3(0.01);
    emis = vColor.rgb * vColor.a * scan * roll + vColor.rgb * graph * vColor.a * 0.8;
    gloss = 0.9;
    return;
  }
  if (style < 64.5) {
    // Book spines.
    float spine = floor(p.x / 0.035);
    float r = h21(vec2(spine, variant * 7.0));
    vec3 c = r < 0.25 ? vec3(0.38, 0.08, 0.06) : r < 0.5 ? vec3(0.06, 0.12, 0.24) : r < 0.7 ? vec3(0.12, 0.2, 0.1) : r < 0.85 ? vec3(0.45, 0.38, 0.25) : vec3(0.08);
    float band = step(abs(fract(p.y * 4.0) - 0.8), 0.04);
    albedo = c * (0.85 + band * 0.6);
    gloss = 0.15;
    return;
  }
  if (style < 65.5) {
    albedo = vColor.rgb * (0.8 + vnoise(p * 80.0) * 0.3);
    return;
  }
  if (style < 66.5) {
    albedo = vColor.rgb * (0.7 + fbm(p * 6.0) * 0.6);
    return;
  }
  if (style < 67.5) {
    albedo = vColor.rgb * 0.4;
    emis = vColor.rgb * vColor.a * (0.8 + 0.2 * sin(time * 1.5 + p.y * 6.0));
    gloss = 0.95;
    return;
  }
  if (style < 68.5) {
    float stripe = step(0.5, fract((p.x + p.y) / 0.2));
    albedo = mix(vec3(0.04), vec3(0.75, 0.55, 0.05), stripe);
    return;
  }
  if (style > 69.5) {
    albedo = texture2D(atlas, p).rgb;
    emis = albedo * vColor.a;
    gloss = 0.2;
    return;
  }
  albedo = vColor.rgb;
}

void main(void) {
  vec3 n = normalize(vNormal);
  vec3 V = normalize(cameraPos - vWorld);
  vec3 albedo;
  float gloss;
  vec3 emis;
  float bump;
  surface(floor(vStyle.x + 0.5), vStyle.y, vUV, n, albedo, gloss, emis, bump);
  vec3 diffuse = mix(hemiGround, hemiSky, n.y * 0.5 + 0.5) + (hemiSky + hemiGround) * 0.22;
  vec3 spec = vec3(0.0);
  for (int i = 0; i < ${MAX_INTERIOR_LIGHTS}; i++) {
    vec4 lp = lPos[i];
    vec3 L = lp.xyz - vWorld;
    float d = length(L);
    L /= max(d, 0.001);
    float att = clamp(1.0 - d / max(lp.w, 0.01), 0.0, 1.0);
    att *= att;
    float ndl = max(dot(n, L), 0.0);
    diffuse += lCol[i] * ndl * att;
    vec3 H = normalize(L + V);
    spec += lCol[i] * pow(max(dot(n, H), 0.0), 60.0) * att * ndl;
  }
  // Phone flashlight.
  if (spotInfo.z > 0.0) {
    vec3 L = spotPos - vWorld;
    float d = length(L);
    L /= max(d, 0.001);
    float cosA = dot(-L, spotDir);
    float cone = cosA > spotInfo.x ? pow(max(cosA, 0.0), spotInfo.y) : 0.0;
    float att = clamp(1.0 - d / spotInfo.w, 0.0, 1.0);
    float ndl = max(dot(n, L), 0.0);
    vec3 beam = vec3(1.0, 0.96, 0.88) * spotInfo.z * cone * att * att;
    diffuse += beam * ndl;
    vec3 H = normalize(L + V);
    spec += beam * pow(max(dot(n, H), 0.0), 50.0) * ndl;
  }
  albedo *= 1.0 - bump * 0.25;
  // Albedos are authored in display space; light in linear like the PBR level materials.
  albedo = pow(max(albedo, vec3(0.0)), vec3(2.2));
  emis = pow(max(emis, vec3(0.0)), vec3(2.2));
  vec3 color = albedo * diffuse * lightGain + spec * gloss * 0.5 * lightGain + emis;
  float fogF = clamp((length(vWorld - cameraPos) - fogInfo.x) / max(fogInfo.y - fogInfo.x, 0.01), 0.0, 1.0) * fogInfo.z;
  color = mix(color, pow(fogColor, vec3(2.2)), fogF);
  // No post pipeline (Dev Tools): go to display space here.
  color = mix(color, pow(max(color, vec3(0.0)), vec3(1.0 / 2.2)), toGamma);
  gl_FragColor = vec4(color, 1.0);
}
`;
