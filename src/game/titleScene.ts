import * as BABYLON from '@babylonjs/core';

import { createUnlockedAudio, releaseUnlockedAudio } from './audioUnlock';
import { playClip, preloadClips } from './sfxMix';

/**
 * The live scene behind the title card: Pierce at the glass of his 58th-floor office at night (the level-1 office the
 * title loads anyway, with the Going Home city 205 m below the windows from cityView), seen from behind, rain
 * running down the pane, and every ~20 s a lightning flash that shows his reflection as the Shadow form for 0.3 s
 * with a low sting. Pierce's theme plays under it.
 *
 * Nothing here is a second scene: it moves the menu camera and the player's avatar into the office, adds two planes
 * in front of the window glass (rain, reflection) and hands both back when the card goes away.
 */

const CAM_POS = new BABYLON.Vector3(45.5, 1.55, 41.1);
const CAM_TARGET = new BABYLON.Vector3(47.75, 1.75, 47);
/** Pierce at the glass; the pane is at z 46.76 (levels/apex-peak.json office-glass). */
const PIERCE = { x: 47.4, z: 45.35, yaw: 0 };
const PANE = { x: 48, y: 1.6, w: 8.8, h: 2.9 };
const RAIN_Z = 46.66;
const REFLECT_Z = 46.71;

/** First flash lands within 8 s of the card, then one every 16-24 s. */
const FIRST_FLASH_S = [4.5, 7.5];
const GAP_S = [16, 24];
/** The reflection shows for this long, in ms (the brief: 0.3 s). */
export const REFLECTION_MS = 300;

const THEME_URL = '/assets/audio/music/pierce-theme.ogg';
const STING_URL = '/assets/audio/sfx/ui/title-sting.mp3';
const THEME_LEVEL = 0.5;

const RAIN_VERT = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main() { vUV = uv; gl_Position = worldViewProjection * vec4(position, 1.0); }
`;

/**
 * Drops and trails on the pane. A drop is a small lens: its inside shows the city glow turned upside down (warm low,
 * cold high), which is what a drop on glass does to a light behind it, and its rim catches a thin highlight. This is
 * a painted refraction, not a sample of the scene: nothing is rendered to a texture, so it costs the same on the low
 * tier. `flash` brightens the whole pane for the lightning.
 */
const RAIN_FRAG = `
precision highp float;
varying vec2 vUV;
uniform float time;
uniform float flash;
uniform float aspect;
uniform float detail;

float N(float t) { return fract(sin(t * 12345.564) * 7658.76); }
float Saw(float b, float t) { return smoothstep(0., b, t) * smoothstep(1., b, t); }

// x: drop+trail mask, y: lens offset (vertical, -1..1), z: rim
vec3 dropLayer(vec2 uv, float t) {
  vec2 UV = uv;
  uv.y += t * 0.75;
  vec2 a = vec2(6., 1.);
  vec2 grid = a * 2.;
  vec2 id = floor(uv * grid);
  float colShift = N(id.x);
  uv.y += colShift;
  id = floor(uv * grid);
  float n = N(id.x * 35.2 + id.y * 2376.1);
  vec2 st = fract(uv * grid) - vec2(.5, 0.);
  float x = n - .5;
  float y = UV.y * 20.;
  float wiggle = sin(y + sin(y));
  x += wiggle * (.5 - abs(x)) * (n - .5);
  x *= .7;
  float ti = fract(t + n);
  y = (Saw(.85, ti) - .5) * .9 + .5;
  vec2 p = vec2(x, y);
  float d = length((st - p) * a.yx);
  float drop = smoothstep(.4, .0, d);
  float r = sqrt(smoothstep(1., y, st.y));
  float cd = abs(st.x - x);
  float trail = smoothstep(.23 * r, .15 * r * r, cd);
  float front = smoothstep(-.02, .02, st.y - y);
  trail *= front * r * r;
  float rim = smoothstep(.4, .3, d) * smoothstep(.2, .35, d);
  float lens = (st.y - p.y) * 3.0 * drop;
  return vec3(max(drop, trail * .45), lens, rim);
}

float staticDrops(vec2 uv, float t) {
  uv *= 22.;
  vec2 id = floor(uv);
  uv = fract(uv) - .5;
  float n = N(id.x * 107.45 + id.y * 3543.654);
  vec2 p = (vec2(n, fract(n * 34.)) - .5) * .7;
  float d = length(uv - p);
  float fade = Saw(.025, fract(t + n));
  return smoothstep(.3, .0, d) * fract(n * 10.) * fade;
}

void main() {
  vec2 uv = vUV;
  uv.x *= aspect;
  float t = time * 0.2;
  vec3 d1 = dropLayer(uv, t);
  vec3 d2 = dropLayer(uv * 1.85 + 7.3, t * 1.1) * 0.8;
  float small = staticDrops(uv, time * 0.35) * detail;
  float mask = clamp(max(max(d1.x, d2.x), small), 0., 1.);
  float lens = d1.y + d2.y;
  float rim = max(d1.z, d2.z);

  // What a drop shows: the city's light inverted, warm below, cold above, a little brighter in a flash.
  vec3 warm = vec3(1.0, 0.72, 0.38);
  vec3 cold = vec3(0.32, 0.5, 0.95);
  vec3 inside = mix(warm, cold, clamp(0.5 + lens * 0.9, 0., 1.)) * (0.28 + 0.55 * flash);
  vec3 col = inside * mask + vec3(0.7, 0.8, 1.0) * rim * (0.16 + 0.4 * flash);
  // A faint film of mist on the whole pane.
  float mist = 0.045 + 0.1 * flash;
  vec3 mistCol = vec3(0.1, 0.14, 0.22) + vec3(0.55, 0.62, 0.9) * flash;
  float alpha = clamp(mask * 0.62 + rim * 0.3 + mist, 0., 0.85);
  gl_FragColor = vec4(col + mistCol * mist, alpha);
}
`;

export type TitleSceneHost = {
  scene: BABYLON.Scene;
  camera: BABYLON.FreeCamera;
  /** The player's avatar (it changes between levels), and where the game keeps it so it can go back. */
  avatar: () => {
    group: BABYLON.TransformNode;
    setLocomotion: (m: boolean, g: boolean) => void;
    resumeLocomotion: () => void;
    whenReady: (cb: () => void) => void;
  };
  meshY: (y: number) => number;
  home: () => { x: number; y: number; z: number; yaw: number };
  /** The scene is the 58th-floor office (apex-peak.json on the level 1 title). */
  officeLoaded: () => boolean;
  mobile: boolean;
};

export type TitleProbe = {
  active: boolean;
  secondsActive: number;
  rain: boolean;
  rainTimeAdvancing: boolean;
  flashes: number;
  reflectionShown: boolean;
  reflectionMs: number;
  nextFlashIn: number;
  lastFlashAt: number;
  musicPlaying: boolean;
  stings: number;
  camera: { x: number; y: number; z: number };
  avatarVisible: boolean;
};

export const createTitleScene = (host: TitleSceneHost) => {
  const { scene } = host;
  let active = false;
  let built = false;
  let rain: BABYLON.Mesh | null = null;
  let rainMat: BABYLON.ShaderMaterial | null = null;
  let reflect: BABYLON.Mesh | null = null;
  let reflectMat: BABYLON.StandardMaterial | null = null;
  let overlay: HTMLDivElement | null = null;
  let hemi: BABYLON.HemisphericLight | null = null;
  let hemiBase = 0;
  let theme: HTMLAudioElement | null = null;
  let themeGain = 0;
  let clock = 0;
  let activeFor = 0;
  let nextFlash = 0;
  let flashT = -1;
  let flashes = 0;
  let stings = 0;
  let lastFlashAt = -1;
  let reflectionMs = 0;
  let lastRainTime = 0;
  let rainAdvancing = false;
  let savedMaxZ = 500;

  const rand = (range: number[]) => range[0] + Math.random() * (range[1] - range[0]);

  /** The Shadow form as it would show in glass: broad, hunched, too tall, arms hanging too long, two red points. */
  const paintShadow = () => {
    const w = 256;
    const h = 512;
    const tex = new BABYLON.DynamicTexture('title-shadow-form', { width: w, height: h }, scene, true);
    tex.hasAlpha = true;
    const g = tex.getContext() as unknown as CanvasRenderingContext2D;
    g.clearRect(0, 0, w, h);
    const body = (stroke: boolean) => {
      g.beginPath();
      g.moveTo(128, 40);
      g.bezierCurveTo(100, 36, 94, 78, 112, 96); // head, tilted
      g.bezierCurveTo(70, 104, 26, 120, 18, 190); // left shoulder to hand
      g.lineTo(10, 330); // long arm
      g.lineTo(32, 332);
      g.lineTo(46, 210);
      g.lineTo(76, 300); // torso, narrowing
      g.lineTo(70, 500);
      g.lineTo(122, 500);
      g.lineTo(128, 360);
      g.lineTo(134, 500);
      g.lineTo(186, 500);
      g.lineTo(180, 300);
      g.lineTo(210, 210);
      g.lineTo(224, 332);
      g.lineTo(246, 330);
      g.lineTo(238, 190);
      g.bezierCurveTo(230, 120, 186, 104, 144, 96);
      g.bezierCurveTo(162, 78, 156, 36, 128, 40);
      g.closePath();
      if (stroke) g.stroke();
      else g.fill();
    };
    g.fillStyle = 'rgba(4, 5, 10, 0.94)';
    body(false);
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(130, 150, 210, 0.55)';
    body(true);
    // Two eyes, the only colour in it.
    g.fillStyle = 'rgba(255, 70, 40, 1)';
    g.shadowColor = 'rgba(255, 60, 30, 1)';
    g.shadowBlur = 10;
    g.fillRect(112, 62, 8, 4);
    g.fillRect(132, 62, 8, 4);
    tex.update();
    return tex;
  };

  const build = () => {
    built = true;
    rain = BABYLON.MeshBuilder.CreatePlane('title-rain', { width: PANE.w, height: PANE.h }, scene);
    rain.position.set(PANE.x, PANE.y, RAIN_Z);
    rain.isPickable = false;
    rain.renderingGroupId = 0;
    rain.alphaIndex = 20;
    rainMat = new BABYLON.ShaderMaterial(
      'title-rain-mat',
      scene,
      { vertexSource: RAIN_VERT, fragmentSource: RAIN_FRAG },
      { attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'time', 'flash', 'aspect', 'detail'] },
    );
    rainMat.backFaceCulling = false;
    rainMat.needAlphaBlending = () => true;
    rainMat.alphaMode = BABYLON.Engine.ALPHA_COMBINE;
    rainMat.setFloat('time', 0);
    rainMat.setFloat('flash', 0);
    rainMat.setFloat('aspect', PANE.w / PANE.h);
    rainMat.setFloat('detail', host.mobile ? 0.6 : 1);
    rain.material = rainMat;
    rain.metadata = { castShadow: false, titleScene: true };

    reflect = BABYLON.MeshBuilder.CreatePlane('title-shadow-reflection', { width: 1.5, height: 3 }, scene);
    reflect.position.set(48.65, 1.5, REFLECT_Z);
    reflect.isPickable = false;
    reflect.alphaIndex = 10;
    reflectMat = new BABYLON.StandardMaterial('title-shadow-reflection-mat', scene);
    const tex = paintShadow();
    reflectMat.diffuseTexture = tex;
    reflectMat.opacityTexture = tex;
    reflectMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    reflectMat.disableLighting = true;
    reflectMat.backFaceCulling = false;
    reflectMat.alpha = 0;
    reflect.material = reflectMat;
    reflect.visibility = 0;
    reflect.setEnabled(false);

    const root = document.getElementById('game-root');
    overlay = document.createElement('div');
    overlay.id = 'titleFlash';
    overlay.setAttribute('aria-hidden', 'true');
    root?.insertBefore(overlay, root.firstChild?.nextSibling ?? null);
  };

  const place = () => {
    host.camera.position.copyFrom(CAM_POS);
    host.camera.setTarget(CAM_TARGET);
    const avatar = host.avatar();
    avatar.group.setEnabled(true);
    avatar.group.position.set(PIERCE.x, host.meshY(1.6), PIERCE.z);
    avatar.group.rotation.y = PIERCE.yaw + Math.PI;
    avatar.whenReady(() => {
      avatar.resumeLocomotion();
      avatar.setLocomotion(false, true);
    });
  };

  const handBack = () => {
    const home = host.home();
    const avatar = host.avatar();
    avatar.group.position.set(home.x, host.meshY(home.y), home.z);
    avatar.group.rotation.y = home.yaw + Math.PI;
  };

  const startTheme = () => {
    if (theme) return;
    try {
      theme = createUnlockedAudio(THEME_URL, 'music');
      theme.loop = true;
      theme.volume = 0;
      themeGain = 0;
      void theme.play().catch(() => {});
    } catch {
      theme = null;
    }
  };

  const stopTheme = () => {
    if (!theme) return;
    const t = theme;
    theme = null;
    releaseUnlockedAudio(t);
  };

  const setFlash = (level: number) => {
    if (overlay) overlay.style.opacity = level > 0.004 ? String(Math.min(0.55, level * 0.55)) : '0';
    rainMat?.setFloat('flash', level);
    if (hemi) hemi.intensity = hemiBase + level * 1.1;
  };

  const showReflection = (on: boolean) => {
    if (!reflect || !reflectMat) return;
    reflect.setEnabled(on);
    reflectMat.alpha = on ? 0.92 : 0;
    reflect.visibility = on ? 1 : 0;
  };

  const strike = () => {
    flashT = 0;
    flashes += 1;
    lastFlashAt = activeFor;
    reflectionMs = 0;
    stings += 1;
    playClip(STING_URL, 0.8, { bus: 'sfx' });
  };

  const on = () => {
    if (!built) build();
    active = true;
    activeFor = 0;
    place();
    savedMaxZ = host.camera.maxZ;
    host.camera.maxZ = Math.max(savedMaxZ, 2200);
    rain?.setEnabled(true);
    hemi = (scene.lights.find((l) => l instanceof BABYLON.HemisphericLight) as BABYLON.HemisphericLight | undefined) ?? null;
    hemiBase = hemi?.intensity ?? 0;
    nextFlash = rand(FIRST_FLASH_S);
    flashT = -1;
    preloadClips([STING_URL]);
    startTheme();
  };

  const off = () => {
    active = false;
    flashT = -1;
    setFlash(0);
    if (hemi) hemi.intensity = hemiBase;
    showReflection(false);
    rain?.setEnabled(false);
    host.camera.maxZ = savedMaxZ;
    stopTheme();
    handBack();
  };

  /** Lightning envelope: a hard strike, a short dip, a softer second strike, then a slow fall. */
  const envelope = (t: number) => {
    if (t < 0.05) return t / 0.05;
    if (t < 0.18) return 1 - (t - 0.05) * 3;
    if (t < 0.26) return 0.6 + (t - 0.18) * 4;
    return Math.max(0, 0.92 * Math.exp(-(t - 0.26) * 5));
  };

  const step = (dt: number, wantsTitle: boolean) => {
    const should = wantsTitle && host.officeLoaded();
    if (should && !active) on();
    else if (!should && active) off();
    if (!active) return;
    clock += dt;
    activeFor += dt;
    host.camera.position.set(
      CAM_POS.x + Math.sin(clock * 0.21) * 0.05,
      CAM_POS.y + Math.sin(clock * 0.33) * 0.015,
      CAM_POS.z,
    );
    host.camera.setTarget(CAM_TARGET);
    rainMat?.setFloat('time', clock);
    rainAdvancing = clock !== lastRainTime;
    lastRainTime = clock;
    if (theme) {
      themeGain = Math.min(THEME_LEVEL, themeGain + dt * 0.12);
      theme.volume = themeGain;
    }
    if (flashT < 0) {
      nextFlash -= dt;
      if (nextFlash <= 0) strike();
    }
    if (flashT >= 0) {
      // The strike is animated on a capped step, so a slow frame still paints the flash and the reflection.
      const fdt = Math.min(dt, 0.05);
      flashT += fdt;
      const level = envelope(flashT);
      setFlash(level);
      const shown = flashT >= 0.12 && flashT < 0.12 + REFLECTION_MS / 1000;
      showReflection(shown);
      if (shown) reflectionMs += fdt * 1000;
      if (flashT > 1.6) {
        flashT = -1;
        setFlash(0);
        showReflection(false);
        nextFlash = rand(GAP_S);
      }
    }
  };

  return {
    step,
    /** Playtest: strike now instead of waiting. */
    strikeNow: () => { if (active && flashT < 0) strike(); },
    probe: (): TitleProbe => ({
      active,
      secondsActive: activeFor,
      rain: !!rain && rain.isEnabled(),
      rainTimeAdvancing: rainAdvancing,
      flashes,
      reflectionShown: !!reflect && reflect.isEnabled(),
      reflectionMs,
      nextFlashIn: nextFlash,
      lastFlashAt,
      musicPlaying: !!theme && !theme.paused,
      stings,
      camera: { x: host.camera.position.x, y: host.camera.position.y, z: host.camera.position.z },
      avatarVisible: host.avatar().group.isEnabled(),
    }),
    isActive: () => active,
  };
};

export type TitleScene = ReturnType<typeof createTitleScene>;
