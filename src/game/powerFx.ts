import * as BABYLON from '@babylonjs/core';

/**
 * Signature effects for the Shadow powers (Going Home, The Station, The Train): Shock, Possess, Consume,
 * Punch, Kick, the Shadow toggle and the shadow-run trail. Particles are GPU systems where the device has them
 * (CPU systems otherwise), half the count on the low tier. Textures are drawn here (DynamicTexture), so the
 * effects work before any Gen image exists; `setTexture` swaps in a Gen texture per kind.
 *
 * Sound is round robin over three takes per power with a small pitch change (never the same take twice in a row).
 * Hit-stop is a real-time hold: `hitStopLeft` is read by the render loop, which passes a ~0 delta and freezes
 * Babylon animation while it lasts.
 */

export type PowerKind = 'shock' | 'possess' | 'consume' | 'punch' | 'kick';

export const POWER_SFX: Record<PowerKind, string[]> = {
  shock: [1, 2, 3].map((n) => `/assets/audio/sfx/power/shock-${n}.ogg`),
  possess: [1, 2, 3].map((n) => `/assets/audio/sfx/power/possess-${n}.ogg`),
  consume: [1, 2, 3].map((n) => `/assets/audio/sfx/power/consume-${n}.ogg`),
  punch: [1, 2, 3].map((n) => `/assets/audio/sfx/power/punch-${n}.ogg`),
  kick: [1, 2, 3].map((n) => `/assets/audio/sfx/power/kick-${n}.ogg`),
};

/** Each power's level (the existing catalog level it replaces, so the mix does not move). */
const POWER_VOLUME: Record<PowerKind, number> = { shock: 0.5, possess: 0.42, consume: 0.46, punch: 0.55, kick: 0.58 };

export const HIT_STOP_MS = { punch: 55, kick: 90 } as const;

export type PowerFxOptions = {
  low: boolean;
  play: (url: string, volume: number, rate: number, at?: BABYLON.Vector3) => void;
  /** Pierce's hand and chest in world space. */
  hand: () => BABYLON.Vector3;
  chest: () => BABYLON.Vector3;
  /** Called with the camera shake amplitude (metres) whenever an effect asks for it. */
};

type TexName = 'soft' | 'star' | 'wisp' | 'ember' | 'ink' | 'noise';

const drawTexture = (scene: BABYLON.Scene, name: TexName, size = 128) => {
  const tex = new BABYLON.DynamicTexture(`fx-${name}`, { width: size, height: size }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  const radial = (r: number, a0: number, a1: number, cx = c, cy = c) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${a0})`);
    g.addColorStop(1, `rgba(255,255,255,${a1})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  };
  if (name === 'soft') radial(c, 1, 0);
  else if (name === 'ember') {
    const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  } else if (name === 'star') {
    radial(c * 0.55, 1, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    for (let i = 0; i < 4; i += 1) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate((i * Math.PI) / 4 + 0.2);
      const g = ctx.createLinearGradient(-c, 0, c, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-c, -2.2, size, 4.4);
      ctx.restore();
    }
  } else {
    // wisp / ink / noise: a few overlapping soft lobes, seeded so every run draws the same shape.
    let seed = name === 'wisp' ? 7 : name === 'ink' ? 19 : 31;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const lobes = name === 'noise' ? 40 : name === 'ink' ? 9 : 6;
    for (let i = 0; i < lobes; i += 1) {
      const x = c + (rnd() - 0.5) * size * (name === 'wisp' ? 0.5 : 0.7);
      const y = c + (rnd() - 0.5) * size * (name === 'wisp' ? 0.7 : 0.7);
      const r = size * (name === 'ink' ? 0.1 + rnd() * 0.16 : name === 'noise' ? 0.05 + rnd() * 0.1 : 0.14 + rnd() * 0.16);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${name === 'ink' ? 0.95 : 0.5})`);
      g.addColorStop(name === 'ink' ? 0.7 : 0.4, `rgba(255,255,255,${name === 'ink' ? 0.8 : 0.22})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
  }
  tex.update();
  return tex;
};

type Burst = { ps: BABYLON.ParticleSystem | BABYLON.GPUParticleSystem; emitter: BABYLON.Mesh };

export const createPowerFx = (scene: BABYLON.Scene, opts: PowerFxOptions) => {
  const gpu = BABYLON.GPUParticleSystem.IsSupported && !opts.low;
  const half = opts.low ? 0.5 : 1;
  const textures = {} as Record<TexName, BABYLON.BaseTexture>;
  const tex = (name: TexName) => (textures[name] ??= drawTexture(scene, name));
  const turns: Record<PowerKind, number> = { shock: 0, possess: 0, consume: 0, punch: 0, kick: 0 };
  const lastTake: Partial<Record<PowerKind, number>> = {};
  const log: { kind: PowerKind | 'shadow' | 'run'; at: number; take?: number; stopMs?: number }[] = [];
  const counts: Record<string, number> = {};
  const bump = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };

  // ---- overlay (screen ripple, desaturation, ink edges, hit flash, vein flare) -------------------------------
  const layer = document.createElement('div');
  layer.id = 'powerFx';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = '<i class="pfx-ink"></i><i class="pfx-grey"></i><i class="pfx-ripple"></i><i class="pfx-flash"></i><i class="pfx-veins"></i>';
  document.body.appendChild(layer);
  const el = (cls: string) => layer.querySelector(`.${cls}`) as HTMLElement;
  const ink = el('pfx-ink');
  const grey = el('pfx-grey');
  const ripple = el('pfx-ripple');
  const flash = el('pfx-flash');
  const veins = el('pfx-veins');
  const restart = (node: HTMLElement, cls: string) => {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  };

  // ---- particle helpers --------------------------------------------------------------------------------------
  const bursts: Burst[] = [];
  const makeEmitter = (name: string) => {
    const mesh = BABYLON.MeshBuilder.CreateBox(name, { size: 0.01 }, scene);
    mesh.isVisible = false;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    return mesh;
  };
  const makeSystem = (name: string, capacity: number, texture: BABYLON.BaseTexture, emitter: BABYLON.Mesh) => {
    const cap = Math.max(16, Math.round(capacity * half));
    const ps: BABYLON.ParticleSystem | BABYLON.GPUParticleSystem = gpu
      ? new BABYLON.GPUParticleSystem(name, { capacity: cap }, scene)
      : new BABYLON.ParticleSystem(name, cap, scene);
    ps.particleTexture = texture;
    ps.emitter = emitter;
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ONEONE;
    ps.isLocal = false;
    ps.disposeOnStop = false;
    ps.renderingGroupId = 1;
    bursts.push({ ps, emitter });
    return ps;
  };
  const burstCount = (n: number) => Math.max(4, Math.round(n * half));

  const sparks = makeSystem('fx-sparks', 260, tex('ember'), makeEmitter('fx-sparks-at'));
  const dust = makeSystem('fx-dust', 120, tex('wisp'), makeEmitter('fx-dust-at'));
  const smoke = makeSystem('fx-smoke', 220, tex('wisp'), makeEmitter('fx-smoke-at'));
  const stream = makeSystem('fx-stream', 200, tex('ember'), makeEmitter('fx-stream-at'));
  const trail = makeSystem('fx-trail', 160, tex('wisp'), makeEmitter('fx-trail-at'));
  const rippleBurst = makeSystem('fx-star', 12, tex('star'), makeEmitter('fx-star-at'));
  const inkBurst = makeSystem('fx-inkburst', 90, tex('ink'), makeEmitter('fx-inkburst-at'));
  for (const ps of [sparks, rippleBurst]) ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
  for (const ps of [dust, smoke, trail, inkBurst]) ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;

  const sphere = (ps: BABYLON.ParticleSystem | BABYLON.GPUParticleSystem, radius: number) => {
    ps.createSphereEmitter(radius, 1);
  };
  sphere(sparks, 0.12);
  sparks.color1 = new BABYLON.Color4(0.85, 0.8, 1, 1);
  sparks.color2 = new BABYLON.Color4(0.55, 0.35, 1, 1);
  sparks.colorDead = new BABYLON.Color4(0.2, 0.05, 0.5, 0);
  sparks.minSize = 0.05; sparks.maxSize = 0.16;
  sparks.minLifeTime = 0.18; sparks.maxLifeTime = 0.5;
  sparks.minEmitPower = 3; sparks.maxEmitPower = 8;
  sparks.gravity = new BABYLON.Vector3(0, -6, 0);
  sparks.emitRate = 0;

  sphere(dust, 0.25);
  dust.color1 = new BABYLON.Color4(0.55, 0.5, 0.46, 0.55);
  dust.color2 = new BABYLON.Color4(0.4, 0.38, 0.36, 0.4);
  dust.colorDead = new BABYLON.Color4(0.3, 0.3, 0.3, 0);
  dust.minSize = 0.25; dust.maxSize = 0.7;
  dust.minLifeTime = 0.35; dust.maxLifeTime = 0.8;
  dust.minEmitPower = 0.6; dust.maxEmitPower = 2.2;
  dust.gravity = new BABYLON.Vector3(0, 0.3, 0);
  dust.emitRate = 0;

  sphere(smoke, 0.18);
  smoke.color1 = new BABYLON.Color4(0.03, 0.01, 0.06, 0.85);
  smoke.color2 = new BABYLON.Color4(0.1, 0.02, 0.16, 0.7);
  smoke.colorDead = new BABYLON.Color4(0, 0, 0, 0);
  smoke.minSize = 0.3; smoke.maxSize = 0.8;
  smoke.minLifeTime = 0.5; smoke.maxLifeTime = 1.1;
  smoke.minEmitPower = 0.4; smoke.maxEmitPower = 1.4;
  smoke.gravity = new BABYLON.Vector3(0, 0.5, 0);
  smoke.emitRate = 0;
  smoke.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;

  sphere(stream, 0.12);
  stream.color1 = new BABYLON.Color4(0.65, 0.3, 1, 1);
  stream.color2 = new BABYLON.Color4(0.95, 0.85, 1, 1);
  stream.colorDead = new BABYLON.Color4(0.3, 0.05, 0.6, 0);
  stream.minSize = 0.05; stream.maxSize = 0.14;
  stream.minLifeTime = 0.35; stream.maxLifeTime = 0.6;
  stream.emitRate = 0;
  stream.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;

  sphere(trail, 0.22);
  trail.color1 = new BABYLON.Color4(0.02, 0.01, 0.04, 0.8);
  trail.color2 = new BABYLON.Color4(0.08, 0.02, 0.12, 0.6);
  trail.colorDead = new BABYLON.Color4(0, 0, 0, 0);
  trail.minSize = 0.35; trail.maxSize = 0.9;
  trail.minLifeTime = 0.6; trail.maxLifeTime = 1.3;
  trail.minEmitPower = 0.1; trail.maxEmitPower = 0.6;
  trail.gravity = new BABYLON.Vector3(0, 0.25, 0);
  trail.emitRate = 0;

  rippleBurst.createPointEmitter(BABYLON.Vector3.Zero(), BABYLON.Vector3.Zero());
  rippleBurst.color1 = new BABYLON.Color4(1, 1, 0.9, 1);
  rippleBurst.color2 = new BABYLON.Color4(1, 0.9, 0.7, 1);
  rippleBurst.colorDead = new BABYLON.Color4(1, 0.7, 0.3, 0);
  rippleBurst.minSize = 0.9; rippleBurst.maxSize = 1.5;
  rippleBurst.minLifeTime = 0.09; rippleBurst.maxLifeTime = 0.16;
  rippleBurst.minEmitPower = 0; rippleBurst.maxEmitPower = 0.01;
  rippleBurst.emitRate = 0;

  sphere(inkBurst, 0.2);
  inkBurst.color1 = new BABYLON.Color4(0.02, 0, 0.04, 0.95);
  inkBurst.color2 = new BABYLON.Color4(0.12, 0.02, 0.2, 0.9);
  inkBurst.colorDead = new BABYLON.Color4(0, 0, 0, 0);
  inkBurst.minSize = 0.25; inkBurst.maxSize = 0.65;
  inkBurst.minLifeTime = 0.5; inkBurst.maxLifeTime = 0.9;
  inkBurst.minEmitPower = 0.4; inkBurst.maxEmitPower = 1.8;
  inkBurst.emitRate = 0;
  inkBurst.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;

  let started = false;
  const ensureStarted = () => {
    if (started) return;
    started = true;
    for (const { ps } of bursts) ps.start();
  };
  const emit = (ps: BABYLON.ParticleSystem | BABYLON.GPUParticleSystem, at: BABYLON.Vector3, n: number) => {
    ensureStarted();
    (ps.emitter as BABYLON.Mesh).position.copyFrom(at);
    ps.manualEmitCount = burstCount(n);
  };

  // ---- branching lightning -----------------------------------------------------------------------------------
  const MAIN_PTS = 14;
  const BRANCHES = 3;
  const BRANCH_PTS = 6;
  const mkLines = () => {
    const lines: BABYLON.Vector3[][] = [Array.from({ length: MAIN_PTS }, () => new BABYLON.Vector3())];
    for (let b = 0; b < BRANCHES; b += 1) lines.push(Array.from({ length: BRANCH_PTS }, () => new BABYLON.Vector3()));
    return lines;
  };
  const coreLines = mkLines();
  const glowLines = mkLines();
  const core = BABYLON.MeshBuilder.CreateLineSystem('fx-bolt-core', { lines: coreLines, updatable: true }, scene);
  const glow = BABYLON.MeshBuilder.CreateLineSystem('fx-bolt-glow', { lines: glowLines, updatable: true }, scene);
  core.color = new BABYLON.Color3(1.6, 1.5, 2.2);
  glow.color = new BABYLON.Color3(0.55, 0.3, 1.5);
  for (const m of [core, glow]) {
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    m.renderingGroupId = 1;
    m.setEnabled(false);
  }
  let boltLeft = 0;
  const boltFrom = new BABYLON.Vector3();
  const boltTo = new BABYLON.Vector3();
  let boltTick = 0;
  const side = new BABYLON.Vector3();
  const dir = new BABYLON.Vector3();
  const jitterLine = (lines: BABYLON.Vector3[][], spread: number, branchSeed: number) => {
    dir.copyFrom(boltTo).subtractInPlace(boltFrom);
    const len = dir.length() || 1;
    dir.scaleInPlace(1 / len);
    side.set(-dir.z, 0, dir.x);
    const up = BABYLON.Vector3.Up();
    const main = lines[0];
    for (let i = 0; i < MAIN_PTS; i += 1) {
      const t = i / (MAIN_PTS - 1);
      const env = Math.sin(t * Math.PI);
      const j = spread * env * (0.35 + Math.random() * 0.65);
      main[i].copyFrom(boltFrom).addInPlace(BABYLON.Vector3.Lerp(BABYLON.Vector3.Zero(), dir, t * len));
      main[i].addInPlace(side.scale((Math.random() - 0.5) * 2 * j)).addInPlace(up.scale((Math.random() - 0.5) * 2 * j));
    }
    for (let b = 0; b < BRANCHES; b += 1) {
      const at = main[2 + ((b * 3 + branchSeed) % (MAIN_PTS - 4))];
      const line = lines[1 + b];
      const sgn = b % 2 === 0 ? 1 : -1;
      for (let i = 0; i < BRANCH_PTS; i += 1) {
        const t = i / (BRANCH_PTS - 1);
        line[i].copyFrom(at)
          .addInPlace(dir.scale(t * len * 0.18))
          .addInPlace(side.scale(sgn * t * len * 0.14 + (Math.random() - 0.5) * 0.12))
          .addInPlace(up.scale((Math.random() - 0.3) * 0.3 * t));
      }
    }
  };
  const updateBolt = () => {
    jitterLine(coreLines, 0.22, boltTick);
    jitterLine(glowLines, 0.34, boltTick + 1);
    BABYLON.MeshBuilder.CreateLineSystem('fx-bolt-core', { lines: coreLines, instance: core }, scene);
    BABYLON.MeshBuilder.CreateLineSystem('fx-bolt-glow', { lines: glowLines, instance: glow }, scene);
    boltTick += 1;
  };

  // ---- possess tendril + eyes --------------------------------------------------------------------------------
  const TENDRIL_PTS = 16;
  const tendrilPath: BABYLON.Vector3[] = Array.from({ length: TENDRIL_PTS }, () => new BABYLON.Vector3());
  const tendril = BABYLON.MeshBuilder.CreateLines('fx-tendril', { points: tendrilPath, updatable: true }, scene);
  tendril.color = new BABYLON.Color3(0.12, 0.02, 0.22);
  tendril.isPickable = false;
  tendril.alwaysSelectAsActiveMesh = true;
  tendril.setEnabled(false);
  let tendrilAge = -1;
  const tendrilFrom = new BABYLON.Vector3();
  const tendrilTo = new BABYLON.Vector3();
  const TENDRIL_TIME = 0.55;
  const eyeMat = new BABYLON.StandardMaterial('fx-eye-mat', scene);
  eyeMat.disableLighting = true;
  eyeMat.emissiveColor = new BABYLON.Color3(0.9, 0.35, 1.6);
  eyeMat.diffuseColor = BABYLON.Color3.Black();
  eyeMat.specularColor = BABYLON.Color3.Black();
  const eyes = [0, 1].map((i) => {
    const eye = BABYLON.MeshBuilder.CreatePlane(`fx-eye-${i}`, { size: 0.16 }, scene);
    eye.material = eyeMat;
    eye.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    eye.isPickable = false;
    eye.renderingGroupId = 1;
    eye.setEnabled(false);
    return eye;
  });
  eyeMat.opacityTexture = tex('soft');
  const eyeFocus = new BABYLON.Vector3();
  let possessing = false;
  let eyesOn = false;

  // ---- shadow run ---------------------------------------------------------------------------------------------
  let running = false;
  const runAt = new BABYLON.Vector3();
  let runAcc = 0;

  // ---- consume ------------------------------------------------------------------------------------------------
  let consumeLeft = 0;
  const consumeFrom = new BABYLON.Vector3();
  const chest = new BABYLON.Vector3();
  const tmp = new BABYLON.Vector3();

  // ---- hit-stop + shake ---------------------------------------------------------------------------------------
  let hitStopUntil = 0;
  let shakeAmp = 0;
  let lastStopMs = 0;

  const takeFor = (kind: PowerKind) => {
    let take = turns[kind] % 3;
    if (take === lastTake[kind]) take = (take + 1) % 3;
    lastTake[kind] = take;
    turns[kind] = take + 1;
    return take;
  };
  const sound = (kind: PowerKind, at?: BABYLON.Vector3, volume = 1) => {
    const take = takeFor(kind);
    const rate = 0.94 + Math.random() * 0.12;
    opts.play(POWER_SFX[kind][take], POWER_VOLUME[kind] * volume, rate, at);
    log.push({ kind, at: performance.now(), take });
    if (log.length > 60) log.shift();
    return take;
  };
  const addShake = (amp: number) => { shakeAmp = Math.max(shakeAmp, amp); };
  const hitStop = (ms: number) => {
    hitStopUntil = performance.now() + ms;
    lastStopMs = ms;
    bump('hitStop');
    log.push({ kind: 'punch', at: performance.now(), stopMs: ms });
  };

  const api = {
    /** Shock: a branching arc from the hand to the target, a flicker of 0.45 s, sparks and a flash at the target. */
    shock: (to: BABYLON.Vector3) => {
      ensureStarted();
      boltFrom.copyFrom(opts.hand());
      boltTo.copyFrom(to);
      boltLeft = 0.45;
      core.setEnabled(true);
      glow.setEnabled(true);
      updateBolt();
      emit(sparks, to, 90);
      emit(rippleBurst, to, 1);
      restart(flash, 'pfx-flash-violet');
      addShake(0.14);
      sound('shock', to);
      bump('shock');
    },
    /** Possess: a black tendril travels from the hand into the target, then the eyes glow and the ink vignette stays. */
    possess: (to: BABYLON.Vector3) => {
      ensureStarted();
      tendrilFrom.copyFrom(opts.hand());
      tendrilTo.copyFrom(to);
      tendrilAge = 0;
      tendril.setEnabled(true);
      emit(smoke, opts.hand(), 40);
      emit(inkBurst, to, 40);
      eyeFocus.copyFrom(to);
      sound('possess', to);
      bump('possess');
    },
    /** True while a link holds: ink creeps in at the screen edges and the eyes burn. */
    setPossessing: (on: boolean, head?: BABYLON.Vector3) => {
      if (head) eyeFocus.copyFrom(head);
      if (on === possessing) return;
      possessing = on;
      ink.classList.toggle('on', on);
      if (!on) {
        eyesOn = false;
        for (const eye of eyes) eye.setEnabled(false);
        tendril.setEnabled(false);
        tendrilAge = -1;
      }
    },
    /** Consume: particles drawn out of the victim into the chest, and the veins flare. */
    consume: (from: BABYLON.Vector3) => {
      ensureStarted();
      consumeFrom.copyFrom(from);
      consumeLeft = 0.9;
      emit(smoke, from, 60);
      restart(veins, 'pfx-veins-flare');
      restart(flash, 'pfx-flash-violet');
      addShake(0.2);
      sound('consume', from);
      bump('consume');
    },
    /** Punch / Kick: impact star, dust burst, hit-stop (50–100 ms) and a shake scaled to the hit. */
    melee: (kind: 'punch' | 'kick', at: BABYLON.Vector3, hit: boolean) => {
      ensureStarted();
      const heavy = kind === 'kick';
      if (hit) {
        emit(rippleBurst, at, 1);
        emit(dust, tmp.copyFrom(at).subtractFromFloats(0, 0.6, 0), heavy ? 70 : 40);
        emit(sparks, at, heavy ? 36 : 18);
        restart(flash, heavy ? 'pfx-flash-white-big' : 'pfx-flash-white');
        hitStop(heavy ? HIT_STOP_MS.kick : HIT_STOP_MS.punch);
        addShake(heavy ? 0.16 : 0.09);
      } else addShake(0.02);
      sound(kind, hit ? at : undefined, hit ? 1 : 0.8);
      log[log.length - 1].kind = kind;
      bump(kind);
    },
    /** C: ripple from the centre, brief desaturation, ink bleeding in at the edges (on) or out (off). */
    toggleShadow: (on: boolean) => {
      restart(ripple, 'pfx-ripple-go');
      restart(grey, on ? 'pfx-grey-on' : 'pfx-grey-off');
      ink.classList.toggle('shadow', on);
      if (on) emit(inkBurst, opts.chest(), 50);
      addShake(0.04);
      log.push({ kind: 'shadow', at: performance.now() });
      bump(on ? 'shadowOn' : 'shadowOff');
    },
    /** Shift in Shadow mode: smoke trail behind the body for as long as it is held. */
    setRunning: (on: boolean, at?: BABYLON.Vector3) => {
      running = on;
      if (at) runAt.copyFrom(at);
      if (on) bump('run');
    },
    update: (dt: number, camera: BABYLON.Camera) => {
      if (running) {
        runAcc += dt * (opts.low ? 26 : 52);
        const n = Math.floor(runAcc);
        if (n > 0) {
          runAcc -= n;
          emit(trail, runAt, n);
        }
      }
      if (boltLeft > 0) {
        boltLeft -= dt;
        if (boltLeft <= 0) { core.setEnabled(false); glow.setEnabled(false); } else {
          // Flicker: a new set of kinks every ~40 ms, and the bolt drops out for a frame now and then.
          if (Math.floor(boltLeft * 25) !== Math.floor((boltLeft + dt) * 25)) updateBolt();
          const vis = Math.random() > 0.18;
          core.visibility = vis ? 1 : 0.15;
          glow.visibility = vis ? Math.min(1, boltLeft * 4) : 0.1;
        }
      }
      if (tendrilAge >= 0) {
        tendrilAge += dt;
        const t = Math.min(1, tendrilAge / TENDRIL_TIME);
        const reach = 1 - (1 - t) * (1 - t);
        for (let i = 0; i < TENDRIL_PTS; i += 1) {
          const u = (i / (TENDRIL_PTS - 1)) * reach;
          const p = tendrilPath[i];
          BABYLON.Vector3.LerpToRef(tendrilFrom, tendrilTo, u, p);
          const wob = Math.sin(u * 9 + tendrilAge * 14) * 0.18 * Math.sin(u * Math.PI);
          p.x += wob; p.y += Math.cos(u * 7 + tendrilAge * 11) * 0.14 * Math.sin(u * Math.PI);
        }
        tendril.updateMeshPositions((positions) => {
          for (let i = 0; i < TENDRIL_PTS; i += 1) {
            positions[i * 3] = tendrilPath[i].x; positions[i * 3 + 1] = tendrilPath[i].y; positions[i * 3 + 2] = tendrilPath[i].z;
          }
        });
        if (t >= 1) {
          eyesOn = true;
          if (tendrilAge > TENDRIL_TIME + 0.35) { tendril.setEnabled(false); tendrilAge = -1; }
        }
      }
      if (eyesOn && possessing) {
        // Two glowing points at head height, either side of the head line as seen from the camera.
        const right = camera.getDirection(BABYLON.Vector3.Right());
        const pulse = 0.85 + Math.sin(performance.now() * 0.012) * 0.15;
        for (let i = 0; i < 2; i += 1) {
          eyes[i].setEnabled(true);
          eyes[i].position.copyFrom(eyeFocus).addInPlace(right.scale((i === 0 ? -1 : 1) * 0.055));
          eyes[i].scaling.setAll(pulse);
        }
      }
      if (consumeLeft > 0) {
        consumeLeft -= dt;
        chest.copyFrom(opts.chest());
        // The stream's origin slides from the victim into Pierce's chest; particles are born along the way.
        const t = 1 - Math.max(0, consumeLeft) / 0.9;
        BABYLON.Vector3.LerpToRef(consumeFrom, chest, Math.min(1, t * 1.2), tmp);
        emit(stream, tmp, Math.round(dt * 240));
        if (consumeLeft <= 0) { emit(sparks, chest, 28); emit(rippleBurst, chest, 1); }
      }
      shakeAmp = Math.max(0, shakeAmp - dt * 0.9);
    },
    /** Remaining hit-stop in ms (0 when none); the render loop zeroes its delta while this is above 0. */
    hitStopLeft: () => Math.max(0, hitStopUntil - performance.now()),
    /** Camera shake amplitude in metres, decaying. */
    shake: () => shakeAmp,
    stats: () => ({ gpu, half, counts: { ...counts }, lastStopMs, log: log.slice(-12), systems: bursts.length }),
    setTexture: (name: TexName, texture: BABYLON.BaseTexture) => {
      textures[name] = texture;
      const map: [TexName, (BABYLON.ParticleSystem | BABYLON.GPUParticleSystem)[]][] = [
        ['ember', [sparks, stream]], ['wisp', [dust, smoke, trail]], ['star', [rippleBurst]], ['ink', [inkBurst]],
      ];
      for (const [key, list] of map) if (key === name) for (const ps of list) ps.particleTexture = texture;
    },
    dispose: () => {
      for (const { ps, emitter } of bursts) { ps.dispose(); emitter.dispose(); }
      layer.remove();
    },
  };
  return api;
};

export type PowerFx = ReturnType<typeof createPowerFx>;
