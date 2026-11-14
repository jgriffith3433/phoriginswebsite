// /feed: the first live camera on the Moon, pointed at the Earth, shown on a CRT monitor. The DOM and WebGL side; the
// sky (where the Sun and the Moon are right now) and the burned-in text come from lunar.js.
//
// Two passes on one <canvas>:
//   1. the camera: the Earth as a lit sphere (NASA Blue Marble day map, Black Marble city lights, Blue Marble clouds
//      with their shadows, ocean glint, the day/night terminator, an atmosphere rim), the lunar horizon in the
//      foreground, and the camera's text burned in (camera ID, LIVE, UTC stamp, signal numbers), at video size.
//   2. the monitor: barrel curve, chromatic fringe, scanlines, grain, flicker, a slow hum bar, now and then a vertical
//      roll or a torn line, a vignette and a little bloom.
// No fetches but the three textures (only when /feed opens), no polling: requestAnimationFrame runs only while the feed
// is on screen, and the text is redrawn when its second changes. No WebGL: a still frame drawn once on a 2D canvas.

import { ephemeris, hudText, clockOf } from './lunar.js';
import { rng } from './util.js';

export const TEXTURES = {
  day: 'assets/feed/earth-day.webp',
  night: 'assets/feed/earth-night.webp',
  clouds: 'assets/feed/earth-clouds.webp',
  water: 'assets/feed/earth-water.webp',
};
const VIDEO_LONG = 960; // the camera's long side in pixels (pass 1); 640 on a device that cannot keep up
const MAX_DPR = 1.5;
const SLOW_MS = 24; // a frame slower than this on average: drop the monitor's resolution and run at 30 fps
const CALM_FPS = 2;

const el = (doc, tag, props = {}, ...kids) => {
  const e = doc.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
};

/** Where the Earth and the horizon sit for a w x h picture (CSS pixels). Pure, so the layout can be tested. */
export function feedLayout(w, h) {
  const portrait = h > w * 1.1;
  const r = portrait ? Math.min(w * 0.4, h * 0.25) : Math.min(h * 0.31, w * 0.3);
  return {
    portrait,
    narrow: w < 560,
    cx: w / 2,
    cy: portrait ? h * 0.4 : h * 0.43, // from the top
    r,
    horizon: portrait ? h * 0.76 : h * 0.8, // the lunar ground's mean edge, from the top
  };
}

// ---------------------------------------------------------------------------------------------------- shaders

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SCENE = (deriv) => `
${deriv ? '#extension GL_OES_standard_derivatives : enable' : ''}
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;          // video size, px
uniform vec3 uEarth;        // centre x, y (px, from the bottom), radius px
uniform float uHorizon;     // the ground's mean edge, px from the bottom
uniform mat3 uCam;          // columns: right, up, back (Earth-fixed)
uniform vec3 uSun;          // Earth-fixed, unit
uniform vec3 uSunCam;       // the Sun in camera axes
uniform float uTime;
uniform float uCloudShift;  // clouds drift east, in texture u
uniform float uReady;       // 0 until the textures arrive, then fades to 1
uniform sampler2D uDay, uNight, uClouds, uWater, uHud;
const float PI = 3.14159265;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
vec3 toLin(vec3 c) { return c * c; }
// craters: a bowl with a raised rim in some cells of a grid
float craters(vec2 p) {
  vec2 c = floor(p); vec2 f = fract(p);
  float h = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    float k = hash(c + o);
    if (k > 0.55) continue;
    vec2 ctr = o + vec2(hash(c + o + 3.1), hash(c + o + 7.7)) * 0.6 + 0.2;
    float r = 0.18 + k * 0.5;
    float d = length(f - ctr) / r;
    h += (d < 1.0 ? (d * d - 1.0) * 0.6 : 0.0) + exp(-pow((d - 1.0) * 5.0, 2.0)) * 0.25;
  }
  return h;
}
// fine grain and pebbles: octaves fade out once they are smaller than a pixel (fp: ground units per pixel)
float detail(vec2 p, float fp) {
  float s = 0.0; float a = 0.5; float f = 5.0;
  for (int i = 0; i < 6; i++) {
    s += a * (noise(p * f) - 0.5) * (1.0 - smoothstep(0.2, 0.55, f * fp));
    f *= 2.13; a *= 0.6;
  }
  return s;
}
// scattered rocks: a dome in some cells
float rocks(vec2 p) {
  vec2 c = floor(p); vec2 f = fract(p);
  float k = hash(c + 5.3);
  if (k > 0.22) return 0.0;
  vec2 ctr = vec2(hash(c + 1.9), hash(c + 8.4)) * 0.6 + 0.2;
  float d = length((f - ctr) * vec2(1.0, 1.4)) / (0.08 + k * 0.5);
  return d < 1.0 ? sqrt(1.0 - d * d) * (0.3 + k) : 0.0;
}
float ground(vec2 p, float far, float fp) {
  float h = fbm(p * 0.3) * 0.16 + craters(p * 1.4) * 0.2 * (1.0 - far * 0.7);
  h += craters(p * 4.3 + 11.0) * 0.09 * (1.0 - far);
  h += rocks(p * 3.0) * 0.1 * (1.0 - smoothstep(0.02, 0.08, fp));
  h += detail(p, fp) * 0.1;
  return h;
}

vec2 lonLatUv(vec3 n) {
  float lon = atan(n.y, n.x);
  float lat = asin(clamp(n.z, -1.0, 1.0));
  return vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
}
// The map's seam at 180 degrees: pick whichever of two wraps has the smaller screen derivative (no line at the seam).
vec4 tex(sampler2D t, vec2 uv) {
${deriv ? `  vec2 uv2 = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
  if (fwidth(uv.x) > fwidth(uv2.x) + 0.0001) return texture2D(t, uv2);` : ''}
  return texture2D(t, uv);
}

void main() {
  vec2 px = vUv * uRes;
  vec2 q = (px - uEarth.xy) / uEarth.z;   // in Earth radii
  float rr = dot(q, q);
  vec3 col = vec3(0.0);

  if (rr < 1.0) {
    vec3 nc = vec3(q, sqrt(1.0 - rr));            // camera axes
    vec3 n = uCam * nc;                            // Earth-fixed
    vec2 uv = lonLatUv(n);
    float mu = dot(n, uSun);
    float day = smoothstep(-0.08, 0.12, mu);
    vec3 land = toLin(tex(uDay, uv).rgb);
    float water = tex(uWater, uv).r;
    vec2 cuv = vec2(uv.x + uCloudShift, uv.y);
    float cloud = smoothstep(0.04, 0.85, tex(uClouds, cuv).r);
    // cloud shadows: look up the clouds a little towards the Sun
    vec3 sunT = uSun - n * mu;
    vec2 sh = vec2(sunT.y * n.x - sunT.x * n.y, -sunT.z) * 0.004;
    float shadow = tex(uClouds, cuv + sh).r;
    vec3 ground = land * (1.0 - 0.45 * shadow * day);
    // light: the Sun with a little wrap, the ocean glint, a warm band at the terminator
    float diff = max(0.0, mu * 0.92 + 0.08);
    vec3 sunCol = mix(vec3(1.0, 0.55, 0.32), vec3(1.0, 0.98, 0.95), smoothstep(0.0, 0.35, mu));
    vec3 h = normalize(uSun + uCam[2]);
    float glint = (pow(max(dot(n, h), 0.0), 700.0) * 2.2 + pow(max(dot(n, h), 0.0), 40.0) * 0.06) * water * (1.0 - cloud);
    vec3 lit = ground * diff * sunCol * 1.6 + vec3(1.0, 0.92, 0.8) * glint * day;
    vec3 cl = vec3(1.0) * (diff * 1.2 + 0.01) * sunCol;
    lit = mix(lit, cl, cloud * 0.92);
    // night: the cities, dimmed under cloud, only where it is dark
    float lights = toLin(tex(uNight, uv).rgb).r;
    vec3 night = vec3(1.0, 0.72, 0.4) * lights * 1.4 * (1.0 - smoothstep(-0.12, 0.05, mu)) * (1.0 - 0.75 * cloud);
    // atmosphere: blue haze towards the limb on the day side, a thin orange line along the terminator
    float limb = pow(1.0 - nc.z, 3.0);
    vec3 haze = vec3(0.28, 0.5, 1.0) * limb * smoothstep(-0.25, 0.4, mu) * 1.3;
    float band = exp(-pow(mu / 0.06, 2.0)) * limb;
    col = lit + night + haze + vec3(1.0, 0.45, 0.2) * band * 0.25;
    // the edge of the disk, anti-aliased
    col *= smoothstep(1.0, 1.0 - 2.5 / uEarth.z, sqrt(rr));
  }
  // the thin glow of air just past the limb, on the lit side
  float r1 = sqrt(rr);
  if (r1 > 0.985 && r1 < 1.08) {
    vec3 nl = uCam * vec3(q / r1, 0.0);
    float l2 = smoothstep(-0.2, 0.35, dot(nl, uSun));
    float g = exp(-(r1 - 1.0) * 70.0) * smoothstep(0.985, 1.0, r1);
    col += vec3(0.35, 0.6, 1.0) * g * l2 * 0.55;
  }
  col *= uReady;

  // the lunar ground: rolling regolith seen from a camera a couple of metres up, receding to a soft ridge line. A height
  // field on a ground plane in perspective, lit from the Sun's side; detail fades with distance so the far ground does
  // not shimmer.
  float hx = px.x / uRes.y;
  float edge = uHorizon + (fbm(vec2(hx * 1.6, 1.7)) - 0.5) * uRes.y * 0.07 + (noise(vec2(hx * 9.0, 4.1)) - 0.5) * uRes.y * 0.008;
  if (px.y < edge) {
    float below = (edge - px.y) / uRes.y;             // 0 at the ridge, about 0.2 at the bottom of the frame
    float z = 0.035 / (below + 0.0025);              // distance along the ground (arbitrary units)
    vec2 gp = vec2((px.x - uRes.x * 0.5) / uRes.y * z * 1.4, z);
    float far = smoothstep(1.2, 6.0, z);            // how much the detail is washed out by distance
    float fp = z * z / (0.035 * uRes.y);             // ground units under one pixel
    vec2 e = vec2(max(fp * 1.2, 0.004), 0.0);
    float h0 = ground(gp, far, fp);
    float hX = ground(gp + e.xy, far, fp);
    float hZ = ground(gp + e.yx, far, fp);
    vec3 gn = normalize(vec3((h0 - hX) / e.x, 1.0, (h0 - hZ) / e.x * 0.7));
    vec3 s = normalize(vec3(uSunCam.x, max(uSunCam.y, 0.22), -abs(uSunCam.z) * 0.3));
    float lgt = max(dot(gn, s), 0.0);
    lgt = smoothstep(0.02, 0.9, lgt) * 0.85 + 0.1 * step(0.02, lgt); // airless: hard light, black shadows
    float albedo = 0.2 + detail(gp * 1.7 + 3.0, fp) * 0.22 + (fbm(gp * 0.5) - 0.5) * 0.06;
    vec3 regolith = vec3(0.98, 0.95, 0.9) * albedo;
    col = regolith * lgt * 1.2 + vec3(0.06, 0.08, 0.12) * 0.12;   // a touch of earthshine in the shadows
    col *= mix(1.0, 0.8, far);
    // the sunlit lip of the ridge line, anti-aliased
    col = mix(col, vec3(0.0), 1.0 - smoothstep(0.0, 1.5 / uRes.y, below));
  }

  // sensor: a little lift in the blacks and grain, then the burned-in text
  col = col / (1.0 + col * 0.6);
  col = sqrt(max(col, 0.0));
  col += (hash(px + fract(uTime * 7.31)) - 0.5) * 0.035;
  vec4 hud = texture2D(uHud, vec2(vUv.x, 1.0 - vUv.y));
  col = mix(col, hud.rgb, hud.a * 0.9);
  gl_FragColor = vec4(col, 1.0);
}`;

const CRT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uVideo;
uniform vec2 uOut;          // canvas size, device px
uniform vec2 uIn;           // video size
uniform float uTime;
uniform float uRoll;        // vertical hold slip, in screen heights
uniform float uTear;        // a torn band, 0 when none
uniform float uTearY;
uniform float uCurve;
uniform float uCalm;
float hash(vec2 p) { p = fract(p * vec2(443.8975, 397.2973)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
vec3 sampleRGB(vec2 uv, vec2 off) {
  return vec3(texture2D(uVideo, uv + off).r, texture2D(uVideo, uv).g, texture2D(uVideo, uv - off).b);
}
void main() {
  vec2 cc = vUv * 2.0 - 1.0;
  float aspect = uOut.x / uOut.y;
  vec2 k = vec2(uCurve) * (aspect > 1.0 ? vec2(1.0, 1.0 / aspect) : vec2(aspect, 1.0));
  cc *= 1.0 + k * dot(cc, cc) * 0.5;
  vec2 uv = cc * 0.5 + 0.5;
  // the tube's rounded corners
  vec2 bez = smoothstep(vec2(0.0), vec2(0.008), uv) * smoothstep(vec2(0.0), vec2(0.008), 1.0 - uv);
  float inside = bez.x * bez.y;
  // vertical roll and a torn line
  uv.y = fract(uv.y + uRoll);
  float tear = uTear * exp(-pow((uv.y - uTearY) * 28.0, 2.0));
  uv.x += tear * (0.5 + 0.5 * sin(uv.y * 900.0 + uTime * 40.0));
  uv.x += (hash(vec2(floor(uv.y * uIn.y), floor(uTime * 30.0))) - 0.5) * 0.0012 * (1.0 - uCalm);
  vec2 off = (cc * 0.0022 + vec2(0.0009, 0.0));
  vec3 c = sampleRGB(uv, off);
  // a little bloom
  vec2 b = 2.5 / uIn;
  vec3 blur = texture2D(uVideo, uv + vec2(b.x, b.y)).rgb + texture2D(uVideo, uv + vec2(-b.x, b.y)).rgb + texture2D(uVideo, uv + vec2(b.x, -b.y)).rgb + texture2D(uVideo, uv + vec2(-b.x, -b.y)).rgb;
  c += max(blur * 0.25 - 0.45, 0.0) * 0.5;
  // scanlines at a pitch the screen can hold (never under 3 device px), a faint aperture grille, grain
  float lines = max(uIn.y, 240.0);
  lines = min(lines, uOut.y / 3.0);
  float scan = 0.72 + 0.28 * pow(abs(sin(uv.y * lines * 3.14159)), 1.4);
  float grille = 0.94 + 0.06 * sin(vUv.x * uOut.x * 2.0944);
  c *= scan * grille;
  c += (hash(vUv * uOut + uTime * 61.0) - 0.5) * 0.06 * (1.0 - uCalm * 0.6);
  // hum bar rolling down, flicker
  c *= 1.0 + 0.035 * sin((uv.y + uTime * 0.11) * 6.2832) * (1.0 - uCalm);
  c *= 1.0 + (hash(vec2(floor(uTime * 24.0), 1.0)) - 0.5) * 0.035 * (1.0 - uCalm);
  // vignette, the glass
  float vig = pow(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.22);
  c *= vig * inside;
  c = mix(c, c * vec3(0.96, 1.02, 0.98), 0.4);
  gl_FragColor = vec4(c * 1.08, 1.0);
}`;

// ---------------------------------------------------------------------------------------------------- the overlay

export function createFeed({ root, doc }) {
  const win = doc.defaultView;
  let box = null;
  let st = null;

  const build = () => {
    if (box) return box;
    const canvas = el(doc, 'canvas', { id: 'feedCanvas', className: 'feed-canvas' });
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Live video from the first camera on the Moon: the Earth, lit as it is right now');
    const stat = el(doc, 'span', { id: 'feedStat', className: 'feed-stat' });
    stat.setAttribute('aria-live', 'polite');
    const close = el(doc, 'button', { id: 'feedClose', type: 'button', className: 'feed-close', textContent: 'disconnect' });
    close.setAttribute('aria-label', 'Disconnect the feed (Esc)');
    const bar = el(doc, 'div', { className: 'feed-bar' }, stat, close);
    const wrap = el(doc, 'div', { id: 'termFeed', className: 'feed' }, canvas, bar);
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'LUNA-1 live feed');
    wrap.hidden = true;
    wrap.tabIndex = -1; // focus lands on the picture, so a habitual Enter does not press disconnect
    close.addEventListener('click', () => api.stop('button'));
    root.appendChild(wrap);
    box = { wrap, canvas, stat, close };
    return box;
  };

  // ---- WebGL
  function initGL(canvas) {
    let gl = null;
    try { gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' }); } catch { gl = null; }
    if (!gl || typeof gl.createShader !== 'function') return null;
    const deriv = !!gl.getExtension('OES_standard_derivatives');
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`feed shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const program = (fs) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`feed program: ${gl.getProgramInfoLog(p)}`);
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i += 1) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
      return { p, u };
    };
    let scene;
    let crt;
    try { scene = program(SCENE(deriv)); crt = program(CRT); } catch (err) { win.__termErrors?.push(String(err.message || err)); return null; }
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const texture = (pixel, opts = {}) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixel));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const tex = {
      day: texture([20, 40, 80, 255], { repeat: true }),
      night: texture([0, 0, 0, 255], { repeat: true }),
      clouds: texture([0, 0, 0, 255], { repeat: true }),
      water: texture([255, 255, 255, 255], { repeat: true }),
      hud: texture([0, 0, 0, 0]),
      video: texture([0, 0, 0, 255]),
    };
    const fbo = gl.createFramebuffer();
    return { gl, scene, crt, tex, fbo, deriv, videoW: 0, videoH: 0 };
  }

  function loadTextures(g, onDone) {
    let left = Object.keys(TEXTURES).length;
    let failed = 0;
    for (const [key, file] of Object.entries(TEXTURES)) {
      const img = new win.Image();
      img.decoding = 'async';
      img.onload = () => {
        if (!st || st.g !== g) return;
        const { gl } = g;
        gl.bindTexture(gl.TEXTURE_2D, g.tex[key]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, g.deriv ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
        left -= 1;
        if (!left) onDone(failed);
      };
      img.onerror = () => { failed += 1; left -= 1; if (!left) onDone(failed); };
      img.src = new URL(file, doc.baseURI).href;
    }
  }

  function sizeVideo(g, w, h) {
    const s = (st.slow ? 640 : VIDEO_LONG) / Math.max(w, h);
    const vw = Math.max(2, Math.round(w * s));
    const vh = Math.max(2, Math.round(h * s));
    if (vw === g.videoW && vh === g.videoH) return;
    const { gl } = g;
    g.videoW = vw;
    g.videoH = vh;
    gl.bindTexture(gl.TEXTURE_2D, g.tex.video);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, vw, vh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, g.tex.video, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    st.hudCanvas.width = vw;
    st.hudCanvas.height = vh;
    st.hudKey = '';
  }

  // ---- the burned-in text, drawn on a 2D canvas at video size
  function drawHud(ctx, w, h, text, liveOn, { scale = 1, clear = true } = {}) {
    if (clear) ctx.clearRect(0, 0, w, h);
    // at least 12 CSS px on the screen, whatever the video's size (scale: video px per CSS px)
    const px = Math.max(Math.ceil(12 * scale), Math.round(Math.min(w, h) * (w < h ? 0.032 : 0.028)));
    const pad = Math.round(px * 1.3);
    ctx.font = `600 ${px}px ui-monospace, Menlo, Consolas, 'DejaVu Sans Mono', monospace`;
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 3;
    ctx.fillStyle = 'rgba(235,240,235,0.92)';
    const lh = Math.round(px * 1.3);
    text.tl.forEach((l, i) => ctx.fillText(l, pad, pad + i * lh));
    text.bl.forEach((l, i) => ctx.fillText(l, pad, h - pad - (text.bl.length - i) * lh));
    ctx.textAlign = 'right';
    text.br.forEach((l, i) => ctx.fillText(l, w - pad, h - pad - (text.br.length - i) * lh));
    ctx.fillText(text.tr[1], w - pad, pad + lh);
    ctx.fillText(text.tr[0], w - pad, pad);
    if (liveOn) {
      const tw = ctx.measureText(text.tr[0]).width;
      ctx.fillStyle = 'rgba(255,40,40,0.95)';
      ctx.beginPath?.();
      ctx.arc?.(w - pad - tw - px * 0.75, pad + px * 0.5, px * 0.38, 0, Math.PI * 2);
      ctx.fill?.();
      ctx.fillStyle = 'rgba(235,240,235,0.92)';
    }
    ctx.fillStyle = 'rgba(235,240,235,0.62)';
    ctx.textAlign = 'left';
    ctx.fillText(text.mid, pad, pad + text.tl.length * lh);
  }

  // ---- the frame
  function frame(t) {
    if (!st) return;
    st.raf = win.requestAnimationFrame(frame);
    const now = Date.now();
    const elapsed = (t - st.t0) / 1000;
    if (st.seconds && elapsed >= st.seconds) { api.stop('timer'); return; }
    if (st.calm && t - st.lastDraw < 1000 / CALM_FPS) return;
    if (st.slow && t - st.lastDraw < 1000 / 31) return;
    const dt = st.lastDraw ? t - st.lastDraw : 16;
    st.lastDraw = t;
    const { canvas, wrap } = box;
    const cw = canvas.clientWidth || 390;
    const ch = canvas.clientHeight || 700;
    const dpr = Math.min(MAX_DPR, win.devicePixelRatio || 1) * (st.slow ? 0.66 : 1);
    const W = Math.max(2, Math.round(cw * dpr));
    const H = Math.max(2, Math.round(ch * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    if (now - (st.ephAt || 0) > 5000) { st.eph = ephemeris(now); st.ephAt = now; }
    const eph = st.eph;
    // the link's numbers wander a little
    const r = st.r;
    st.sig.dbm = Math.max(-104, Math.min(-91, st.sig.dbm + (r() - 0.5) * 0.12));
    st.sig.snr = Math.max(14, Math.min(22, st.sig.snr + (r() - 0.5) * 0.06));
    st.sig.mbps = Math.max(1.9, Math.min(2.4, st.sig.mbps + (r() - 0.5) * 0.004));
    const narrow = cw < 560 || ch < 480;
    const sec = Math.floor(now / 500);
    if (st.mode === '2d') { draw2d(eph, now, elapsed, narrow, sec); finishFrame(elapsed, eph); return; }

    const g = st.g;
    const { gl } = g;
    if (gl.isContextLost?.()) return;
    sizeVideo(g, cw, ch);
    const vw = g.videoW;
    const vh = g.videoH;
    // text: redrawn twice a second (the stamp has tenths, the LIVE dot blinks)
    if (st.hudKey !== `${sec}:${vw}x${vh}`) {
      st.hudKey = `${sec}:${vw}x${vh}`;
      drawHud(st.hudCtx, vw, vh, hudText(now, eph, { elapsed, sig: st.sig, narrow }), sec % 2 === 0 || st.calm, { scale: vw / cw });
      gl.bindTexture(gl.TEXTURE_2D, g.tex.hud);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, st.hudCanvas);
    }
    // vertical hold: now and then the picture slips and catches again; now and then a line tears
    if (!st.calm) {
      if (st.rollLeft <= 0 && r() < dt / 14000) st.rollLeft = 0.35 + r() * 0.3;
      if (st.rollLeft > 0) { st.rollLeft -= dt / 1000; st.roll = st.rollLeft > 0 ? (1 - st.rollLeft / 0.65) * 0.06 * (1 + r() * 0.2) : 0; }
      if (st.tear <= 0.0001 && r() < dt / 7000) { st.tear = 0.006 + r() * 0.012; st.tearY = r(); }
      st.tear *= Math.pow(0.002, dt / 1000);
    }
    st.ready = Math.min(1, st.ready + (st.loaded ? dt / 900 : 0));

    // pass 1: the camera
    const L = feedLayout(vw, vh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo);
    gl.viewport(0, 0, vw, vh);
    const S = g.scene;
    gl.useProgram(S.p);
    const units = ['day', 'night', 'clouds', 'water', 'hud'];
    const names = { day: 'uDay', night: 'uNight', clouds: 'uClouds', water: 'uWater', hud: 'uHud' };
    units.forEach((k, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, g.tex[k]); gl.uniform1i(S.u[names[k]], i); });
    const jitter = st.calm ? [0, 0] : [(r() - 0.5) * 0.35, (r() - 0.5) * 0.35];
    gl.uniform2f(S.u.uRes, vw, vh);
    gl.uniform3f(S.u.uEarth, L.cx + jitter[0], vh - L.cy + jitter[1], L.r);
    gl.uniform1f(S.u.uHorizon, vh - L.horizon);
    const { right, up, back } = eph.cam;
    gl.uniformMatrix3fv(S.u.uCam, false, new Float32Array([...right, ...up, ...back]));
    gl.uniform3fv(S.u.uSun, new Float32Array(eph.sun));
    gl.uniform3fv(S.u.uSunCam, new Float32Array(eph.sunCam));
    gl.uniform1f(S.u.uTime, (t / 1000) % 1000);
    gl.uniform1f(S.u.uCloudShift, ((now / 1000) * 0.0000025) % 1);
    gl.uniform1f(S.u.uReady, st.ready);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // pass 2: the monitor
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    const C = g.crt;
    gl.useProgram(C.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g.tex.video);
    gl.uniform1i(C.u.uVideo, 0);
    gl.uniform2f(C.u.uOut, W, H);
    gl.uniform2f(C.u.uIn, vw, vh);
    gl.uniform1f(C.u.uTime, (t / 1000) % 1000);
    gl.uniform1f(C.u.uRoll, st.roll);
    gl.uniform1f(C.u.uTear, st.tear);
    gl.uniform1f(C.u.uTearY, st.tearY);
    gl.uniform1f(C.u.uCurve, L.portrait ? 0.06 : 0.09);
    gl.uniform1f(C.u.uCalm, st.calm ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // a phone that cannot keep up gets a lighter monitor and 30 fps
    st.ft.push(dt); // the time between frames: a GPU that cannot keep up shows here, not in the JS time
    if (st.ft.length > 60) st.ft.shift();
    if (!st.slow && st.frames > 90 && st.ft.length === 60 && st.ft.reduce((a, b) => a + b, 0) / 60 > SLOW_MS) { st.slow = true; wrap.dataset.slow = '1'; }
    finishFrame(elapsed, eph);
  }

  function finishFrame(elapsed, eph) {
    st.frames += 1;
    const w = box.wrap;
    const sec = Math.floor(elapsed);
    if (sec !== st.statSec) { st.statSec = sec; box.stat.textContent = `${eph.lightSeconds.toFixed(2)} s from the Moon  ·  ${clockOf(elapsed)}`; }
    w.dataset.frames = String(st.frames);
    if (st.frames % 15 === 1 || st.calm || st.mode === '2d') {
      w.dataset.lit = String(Math.round(eph.lit * 100));
      w.dataset.subcam = `${eph.subCam.lat.toFixed(1)},${eph.subCam.lon.toFixed(1)}`;
      w.dataset.seconds = String(Math.round(elapsed));
      w.dataset.ready = st.mode === '2d' ? '1' : String(Math.round(st.ready * 100) / 100);
    }
  }

  // ---- no WebGL: one still frame, drawn on the CPU from the day map, refreshed when the text changes
  function draw2d(eph, now, elapsed, narrow, sec) {
    const { canvas } = box;
    const ctx = st.ctx2d;
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    if (st.lastSec === sec && st.still2dW === w) return;
    st.lastSec = sec;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const L = feedLayout(w, h);
    if (!st.still2d || st.still2dW !== w) { st.still2d = renderStill(eph, L, w, h); st.still2dW = w; }
    if (st.still2d) ctx.drawImage(st.still2d, 0, 0);
    drawHud(ctx, w, h, hudText(now, eph, { elapsed, sig: st.sig, narrow }), true, { scale: w / (box.canvas.clientWidth || w), clear: false });
  }

  function renderStill(eph, L, w, h) {
    const img = st.dayImg;
    const out = doc.createElement('canvas');
    out.width = w;
    out.height = h;
    const o = out.getContext('2d');
    if (!o) return null;
    let src = null;
    if (img && img.complete && img.naturalWidth) {
      const c = doc.createElement('canvas');
      c.width = 512; c.height = 256;
      const cx = c.getContext('2d');
      try { cx.drawImage(img, 0, 0, 512, 256); src = cx.getImageData(0, 0, 512, 256).data; } catch { src = null; }
    }
    const size = Math.ceil(L.r * 2);
    const data = o.createImageData(size, size);
    const { right, up, back } = eph.cam;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const qx = (x - L.r) / L.r;
        const qy = (L.r - y) / L.r;
        const rr = qx * qx + qy * qy;
        if (rr >= 1) continue;
        const qz = Math.sqrt(1 - rr);
        const n = [0, 1, 2].map((i) => right[i] * qx + up[i] * qy + back[i] * qz);
        const mu = n[0] * eph.sun[0] + n[1] * eph.sun[1] + n[2] * eph.sun[2];
        const lit = Math.max(0.03, Math.min(1, mu * 1.2 + 0.05));
        let rgb = [40, 70, 130];
        if (src) {
          const u = Math.floor(((Math.atan2(n[1], n[0]) / (2 * Math.PI)) + 0.5) * 511);
          const v = Math.floor((0.5 - Math.asin(n[2]) / Math.PI) * 255);
          const k = (v * 512 + u) * 4;
          rgb = [src[k], src[k + 1], src[k + 2]];
        }
        const k2 = (y * size + x) * 4;
        data.data[k2] = rgb[0] * lit; data.data[k2 + 1] = rgb[1] * lit; data.data[k2 + 2] = rgb[2] * lit; data.data[k2 + 3] = 255;
      }
    }
    o.putImageData(data, Math.round(L.cx - L.r), Math.round(L.cy - L.r));
    // the ground
    o.fillStyle = '#2a2927';
    o.beginPath();
    o.moveTo(0, h);
    const r = rng(58);
    for (let x = 0; x <= w; x += Math.max(4, w / 60)) o.lineTo(x, L.horizon + (r() - 0.5) * h * 0.03);
    o.lineTo(w, h);
    o.fill();
    return out;
  }

  // ---- open and close
  const api = {
    get active() { return !!st; },
    /**
     * Open the feed. `seconds` closes it by itself after that long (a test hook); `calm` is reduced motion (no roll,
     * tear, flicker or hum bar, two frames a second). `onDone(info)` runs once when it closes.
     */
    start({ seconds = null, calm = false, onDone = () => {} } = {}) {
      if (st) api.stop('restart');
      const b = build();
      const hudCanvas = doc.createElement('canvas');
      st = {
        t0: win.performance?.now ? win.performance.now() : 0, frames: 0, lastDraw: 0, seconds, calm, onDone, raf: 0,
        r: rng((Date.now() & 0xffff) + 58), sig: { dbm: -97.4, snr: 18.6, mbps: 2.2 },
        roll: 0, rollLeft: 0, tear: 0, tearY: 0.5, ready: 0, loaded: false, slow: false, ft: [], hudKey: '',
        hudCanvas, hudCtx: hudCanvas.getContext('2d'), eph: ephemeris(Date.now()), ephAt: Date.now(),
      };
      b.wrap.hidden = false;
      b.wrap.dataset.state = 'live';
      b.wrap.dataset.frames = '0';
      b.wrap.dataset.calm = calm ? '1' : '0';
      b.stat.textContent = 'acquiring signal ...';
      const g = st.hudCtx ? initGL(b.canvas) : null;
      if (g) {
        st.mode = 'webgl';
        st.g = g;
        loadTextures(g, (failed) => { if (st) { st.loaded = true; b.wrap.dataset.textures = failed ? `missing ${failed}` : 'ok'; } });
      } else {
        st.mode = '2d';
        st.ctx2d = b.canvas.getContext('2d');
        const img = new win.Image();
        img.onload = () => { if (st) { st.still2d = null; st.lastSec = -1; } };
        img.src = new URL(TEXTURES.day, doc.baseURI).href;
        st.dayImg = img;
      }
      b.wrap.dataset.mode = st.mode;
      b.wrap.focus?.({ preventScroll: true }); // the keyboard lands on the feed (Esc closes, Tab reaches disconnect); a phone's keyboard stays down
      st.raf = win.requestAnimationFrame(frame);
      return { mode: st.mode };
    },
    stop(why = 'key') {
      if (!st) return;
      const s = st;
      st = null;
      win.cancelAnimationFrame(s.raf);
      const elapsed = ((win.performance?.now ? win.performance.now() : 0) - s.t0) / 1000;
      if (box) { box.wrap.hidden = true; box.wrap.dataset.state = 'closed'; }
      // let the GPU have its memory back
      if (s.g) {
        const { gl } = s.g;
        for (const t of Object.values(s.g.tex)) gl.deleteTexture(t);
        gl.deleteFramebuffer(s.g.fbo);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        // a lost context cannot be had back on the same canvas: the next /feed gets a fresh one
        box.canvas.remove();
        const fresh = el(doc, 'canvas', { id: 'feedCanvas', className: 'feed-canvas' });
        fresh.setAttribute('role', 'img');
        fresh.setAttribute('aria-label', box.canvas.getAttribute?.('aria-label') ?? 'Live video');
        box.wrap.insertBefore ? box.wrap.insertBefore(fresh, box.wrap.firstChild) : box.wrap.append(fresh);
        box.canvas = fresh;
      }
      s.onDone({ seconds: Math.max(0, elapsed), frames: s.frames, mode: s.mode, why });
    },
  };
  return api;
}
