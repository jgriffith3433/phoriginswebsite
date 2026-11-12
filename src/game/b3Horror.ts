import * as BABYLON from '@babylonjs/core';

import { playClip, type ClipHandle } from './sfxMix';
import type { GraphicsTier } from '../render/pipeline';

/**
 * B3 horror lighting on top of the shared render pipeline: the phone flashlight casts
 * moving shadows, the beam reads in the air, practicals flicker with a buzz, the vat
 * is the green hero light, and corridors fall to black in fog. Mounted only for
 * `b3-basement` (level 2 and the cold open); The Return's powers look skips the fear.
 */

const BUZZ = '/assets/audio/sfx/b3/fluorescent-buzz.ogg';
const RADIO = '/assets/audio/sfx/b3/radio-crackle.ogg';
const VAT = { x: 7.2, y: 1.4, z: 38 };
/** Dead-guard radio on the pipe-hall drum (`b3-drum-hall`). */
const RADIO_AT = { x: 45.92, y: 1.0, z: 28.6 };
const CASTER_RADIUS = 9;

export type B3HorrorOptions = {
  powers?: boolean;
  tier: () => GraphicsTier;
  /** Pierce's feet for the hall radio life beat (optional). */
  playerAt?: () => { x: number; z: number } | null;
};

export type B3HorrorStats = {
  active: boolean;
  flashlightShadows: boolean;
  shadowCasters: number;
  beamVisible: boolean;
  volumetric: boolean;
  fogMode: string;
  landmarks: { id: string; lit: boolean }[];
  vatWallsLit: number;
  flickerOn: boolean;
  creatureRim: boolean;
  fpsHint: number;
};

const isFlashCaster = (mesh: BABYLON.AbstractMesh) => {
  if (!mesh.isEnabled() || !mesh.isVisible || mesh.visibility < 0.35) return false;
  if (mesh.getTotalVertices() === 0) return false;
  const meta = mesh.metadata as {
    castShadow?: boolean;
    boundsCollider?: boolean;
    interiorCollider?: boolean;
    sceneAssetId?: string;
    assetKind?: string;
  } | null;
  if (meta?.castShadow === false || meta?.boundsCollider || meta?.interiorCollider) return false;
  if (meta?.castShadow === true) return true;
  const kind = meta?.assetKind ?? '';
  if (kind === 'wall' || kind === 'ground' || kind === 'ceiling') return false;
  const id = meta?.sceneAssetId ?? mesh.name;
  if (/^vat-|^floor-|^wall-|^ceil-|^lift-|^puddle-|^b3-sign-|^b3-decal-|^atmo-|^interior-/.test(id)) return false;
  const tags = mesh.material?.metadata as { character?: boolean; prop?: boolean; castShadow?: boolean } | null | undefined;
  if (tags?.character || tags?.prop || tags?.castShadow) {
    mesh.computeWorldMatrix(true);
    return mesh.getBoundingInfo().boundingSphere.radiusWorld <= CASTER_RADIUS;
  }
  // Authored B3 props (drums, crates, gurneys, lockers) and the creature root.
  if (/b3-(drum|barrel|crate|locker|gurney)|creature|parasite|ch33|ch44/i.test(id) || /asset-b3-|asset-parasite|asset-ch/.test(id)) {
    mesh.computeWorldMatrix(true);
    return mesh.getBoundingInfo().boundingSphere.radiusWorld <= CASTER_RADIUS;
  }
  return false;
};

const causticCookie = (scene: BABYLON.Scene) => {
  const tex = new BABYLON.DynamicTexture('b3-vat-caustic', { width: 256, height: 256 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const paint = (t: number) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 18; i += 1) {
      const a = t * (0.4 + (i % 5) * 0.07) + i * 1.7;
      const x = 128 + Math.cos(a) * (40 + (i % 7) * 8);
      const y = 128 + Math.sin(a * 1.3) * (36 + (i % 6) * 9);
      const g = ctx.createRadialGradient(x, y, 2, x, y, 28 + (i % 4) * 6);
      g.addColorStop(0, 'rgba(180,255,160,0.85)');
      g.addColorStop(0.45, 'rgba(40,180,70,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    }
    tex.update();
  };
  paint(0);
  return { tex, paint };
};

export const createB3Horror = (scene: BABYLON.Scene, opts: B3HorrorOptions) => {
  const owned: { dispose: () => void }[] = [];
  const powers = !!opts.powers;
  let clock = 0;
  let shadowGen: BABYLON.ShadowGenerator | null = null;
  let vls: BABYLON.VolumetricLightScatteringPostProcess | null = null;
  let vlsMesh: BABYLON.Mesh | null = null;
  let buzz: ClipHandle | null = null;
  let buzzWant = false;
  let rim: BABYLON.SpotLight | null = null;
  let causticLight: BABYLON.SpotLight | null = null;
  let caustic: ReturnType<typeof causticCookie> | null = null;
  let bubbles: BABYLON.ParticleSystem | null = null;
  let flickerBases = new Map<BABYLON.PointLight, number>();
  let landmarkLights: { id: string; light: BABYLON.Light }[] = [];
  let lastCasterCount = 0;
  let casterPoll = 0;
  let beamOn = false;
  let fpsEma = 60;
  let radioLeft = 2;
  let radioCooldown = 0;
  let playerAt: (() => { x: number; z: number } | null) | null = null;

  const spot = () => {
    const light = scene.getLightByName('phoneFlash');
    return light instanceof BABYLON.SpotLight ? light : null;
  };

  const ensureShadows = () => {
    const flash = spot();
    if (!flash || shadowGen) return;
    const tier = opts.tier();
    const size = tier === 'high' ? 1024 : tier === 'medium' ? 512 : 256;
    flash.shadowEnabled = true;
    const gen = new BABYLON.ShadowGenerator(size, flash);
    gen.usePercentageCloserFiltering = true;
    gen.filteringQuality = tier === 'low'
      ? BABYLON.ShadowGenerator.QUALITY_LOW
      : tier === 'medium'
        ? BABYLON.ShadowGenerator.QUALITY_MEDIUM
        : BABYLON.ShadowGenerator.QUALITY_HIGH;
    gen.bias = 0.0008;
    gen.normalBias = 0.02;
    gen.darkness = 0.55;
    gen.transparencyShadow = false;
    const map = gen.getShadowMap();
    if (map) {
      map.renderListPredicate = (mesh) => {
        const ok = isFlashCaster(mesh);
        return ok;
      };
      // Low tier: every other frame keeps the beam and fog under 30 fps on a phone.
      map.refreshRate = tier === 'low'
        ? BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYTWOFRAMES
        : BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME;
    }
    shadowGen = gen;
    owned.push({ dispose: () => { gen.dispose(); if (shadowGen === gen) shadowGen = null; } });
  };

  const setReceivers = () => {
    for (const mesh of scene.meshes) {
      const meta = mesh.metadata as { assetKind?: string; sceneAssetId?: string } | null;
      const kind = meta?.assetKind ?? '';
      const id = meta?.sceneAssetId ?? mesh.name;
      if (kind === 'ground' || kind === 'wall' || /puddle|floor-|interior-dress|vat-shell|vat-glass/.test(id)) {
        mesh.receiveShadows = true;
      }
    }
  };

  const ensureVolumetric = (camera: BABYLON.Camera) => {
    if (powers || opts.tier() !== 'high' || vls) return;
    const flash = spot();
    if (!flash) return;
    vlsMesh = BABYLON.MeshBuilder.CreateSphere('b3-flash-vls', { diameter: 0.12, segments: 6 }, scene);
    vlsMesh.isPickable = false;
    vlsMesh.isVisible = true;
    const mat = new BABYLON.StandardMaterial('b3-flash-vls-mat', scene);
    mat.disableLighting = true;
    mat.emissiveColor = new BABYLON.Color3(1, 0.95, 0.85);
    mat.diffuseColor = BABYLON.Color3.Black();
    vlsMesh.material = mat;
    vlsMesh.position.copyFrom(flash.getAbsolutePosition());
    try {
      vls = new BABYLON.VolumetricLightScatteringPostProcess(
        'b3-flash-vls-pp',
        0.6,
        camera,
        vlsMesh,
        60,
        BABYLON.Texture.BILINEAR_SAMPLINGMODE,
        scene.getEngine(),
        false,
      );
      vls.exposure = 0.22;
      vls.decay = 0.95;
      vls.weight = 0.55;
      vls.density = 0.7;
      const vlsRef = vls;
      const camRef = camera;
      owned.push({
        dispose: () => {
          try { vlsRef.dispose(camRef); } catch { /* already gone */ }
          if (vls === vlsRef) vls = null;
        },
      }, vlsMesh, mat);
    } catch (error) {
      console.warn('B3 volumetric beam unavailable', error);
      vlsMesh.dispose();
      vlsMesh = null;
      mat.dispose();
    }
  };

  const ensureVat = () => {
    if (powers || causticLight) return;
    caustic = causticCookie(scene);
    owned.push(caustic.tex);
    causticLight = new BABYLON.SpotLight(
      'b3-vat-caustic',
      new BABYLON.Vector3(VAT.x, 3.4, VAT.z),
      new BABYLON.Vector3(0, -1, 0),
      Math.PI * 0.7,
      1.4,
      scene,
    );
    causticLight.diffuse = new BABYLON.Color3(0.25, 1, 0.35);
    causticLight.specular = new BABYLON.Color3(0.1, 0.35, 0.12);
    causticLight.intensity = 2.4;
    causticLight.range = 14;
    causticLight.projectionTexture = caustic.tex;
    owned.push(causticLight);

    const vatLight = scene.getLightByName('light-vat');
    if (vatLight instanceof BABYLON.PointLight) {
      vatLight.intensity = Math.max(vatLight.intensity, 1.35);
      vatLight.range = Math.max(vatLight.range || 0, 18);
      vatLight.diffuse = new BABYLON.Color3(0.35, 1, 0.42);
    }

    for (const mesh of scene.meshes) {
      const id = (mesh.metadata as { sceneAssetId?: string } | null)?.sceneAssetId ?? mesh.name;
      if (id !== 'vat-acid' && !id.startsWith('b3-side-vat')) continue;
      const mat = mesh.material;
      if (mat instanceof BABYLON.StandardMaterial) {
        mat.emissiveColor = new BABYLON.Color3(0.22, 0.95, 0.28);
        mat.diffuseColor = new BABYLON.Color3(0.08, 0.55, 0.14);
        mat.specularColor = new BABYLON.Color3(0.35, 0.85, 0.4);
        mat.specularPower = 64;
      }
    }

    const puff = new BABYLON.DynamicTexture('b3-vat-bubble', { width: 32, height: 32 }, scene, false);
    const ctx = puff.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 14);
    g.addColorStop(0, 'rgba(200,255,210,0.7)');
    g.addColorStop(1, 'rgba(200,255,210,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    puff.update();
    puff.hasAlpha = true;
    owned.push(puff);

    bubbles = new BABYLON.ParticleSystem('b3-vat-bubbles', powers ? 20 : 80, scene);
    bubbles.particleTexture = puff;
    bubbles.emitter = new BABYLON.Vector3(VAT.x, 0.4, VAT.z);
    bubbles.minEmitBox = new BABYLON.Vector3(-0.55, 0, -0.55);
    bubbles.maxEmitBox = new BABYLON.Vector3(0.55, 0.2, 0.55);
    bubbles.color1 = new BABYLON.Color4(0.35, 1, 0.45, 0.35);
    bubbles.color2 = new BABYLON.Color4(0.15, 0.7, 0.25, 0.15);
    bubbles.colorDead = new BABYLON.Color4(0.1, 0.4, 0.15, 0);
    bubbles.minSize = 0.04;
    bubbles.maxSize = 0.12;
    bubbles.minLifeTime = 1.2;
    bubbles.maxLifeTime = 2.8;
    bubbles.emitRate = powers ? 6 : 22;
    bubbles.direction1 = new BABYLON.Vector3(-0.05, 0.55, -0.05);
    bubbles.direction2 = new BABYLON.Vector3(0.05, 1.1, 0.05);
    bubbles.minEmitPower = 0.2;
    bubbles.maxEmitPower = 0.55;
    bubbles.updateSpeed = 0.01;
    bubbles.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
    bubbles.start();
    owned.push(bubbles);
  };

  const ensureRim = () => {
    if (rim) return;
    rim = new BABYLON.SpotLight(
      'b3-creature-rim',
      new BABYLON.Vector3(0, 1.4, 0),
      new BABYLON.Vector3(0, 0, 1),
      0.85,
      2,
      scene,
    );
    rim.diffuse = new BABYLON.Color3(0.85, 1, 0.95);
    rim.specular = new BABYLON.Color3(0.4, 0.5, 0.45);
    rim.intensity = 0;
    rim.range = 6;
    rim.setEnabled(true);
    owned.push(rim);
  };

  const ensureFlicker = () => {
    if (powers || flickerBases.size) return;
    for (const light of scene.lights) {
      if (!(light instanceof BABYLON.PointLight)) continue;
      const id = (light.metadata as { sceneAssetId?: string } | null)?.sceneAssetId ?? light.name;
      if (!/^light-/.test(id) || id === 'light-vat') continue;
      flickerBases.set(light, light.intensity);
    }
    landmarkLights = [];
    for (const light of scene.lights) {
      const id = (light.metadata as { sceneAssetId?: string } | null)?.sceneAssetId ?? light.name;
      if (id === 'light-vat' || /exit|beacon|junction|h2-a|h1-a/i.test(id)) {
        landmarkLights.push({ id, light });
      }
    }
    // Emergency EXIT / beacon markers from the interior kit are emissive; track vat + a few practicals as landmarks.
    if (!landmarkLights.some((l) => l.id === 'light-vat')) {
      const vat = scene.getLightByName('light-vat');
      if (vat) landmarkLights.push({ id: 'light-vat', light: vat });
    }
  };

  const syncBuzz = (want: boolean) => {
    if (want === buzzWant) return;
    buzzWant = want;
    if (!want) {
      buzz?.stop();
      buzz = null;
      return;
    }
    buzz = playClip(BUZZ, 0.16, { loop: true, world: { at: { x: 30, y: 2.8, z: 38 }, cls: 'machinery' } });
  };

  const countVatWallsLit = () => {
    // Walls within the vat green pool (~12 m of light-vat / caustic).
    let n = 0;
    for (const mesh of scene.meshes) {
      const meta = mesh.metadata as { assetKind?: string; sceneAssetId?: string } | null;
      if (meta?.assetKind !== 'wall') continue;
      const id = meta.sceneAssetId ?? '';
      if (/lift|glass|door/.test(id)) continue;
      mesh.computeWorldMatrix(true);
      const c = mesh.getBoundingInfo().boundingBox.centerWorld;
      const dx = c.x - VAT.x;
      const dz = c.z - VAT.z;
      if (dx * dx + dz * dz < 12 * 12) n += 1;
    }
    return n;
  };

  // Exponential fog: far corridor ends go black. Interior shader reads density via fogInfo.
  if (!powers) {
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.055;
    scene.fogColor = new BABYLON.Color3(0.008, 0.01, 0.009);
    scene.fogStart = 0;
    scene.fogEnd = 28;
  }

  playerAt = opts.playerAt ?? null;

  // Badge on the Hall B drum — a quiet life landmark without a new verb.
  if (!powers) {
    const badge = BABYLON.MeshBuilder.CreateBox('b3-guard-badge', { width: 0.08, height: 0.002, depth: 0.05 }, scene);
    badge.position.set(RADIO_AT.x + 0.12, 0.9, RADIO_AT.z + 0.1);
    badge.rotation.y = 0.4;
    badge.isPickable = false;
    badge.checkCollisions = false;
    const badgeMat = new BABYLON.StandardMaterial('b3-guard-badge-mat', scene);
    badgeMat.diffuseColor = new BABYLON.Color3(0.55, 0.48, 0.22);
    badgeMat.emissiveColor = new BABYLON.Color3(0.08, 0.06, 0.02);
    badgeMat.specularColor = new BABYLON.Color3(0.4, 0.35, 0.15);
    badge.material = badgeMat;
    badge.metadata = { castShadow: true };
    owned.push(badge, badgeMat);
  }

  ensureShadows();
  setReceivers();
  ensureVat();
  ensureRim();
  ensureFlicker();

  return {
    step: (dt: number) => {
      clock += dt;
      const engine = scene.getEngine();
      fpsEma = fpsEma * 0.9 + engine.getFps() * 0.1;
      const flash = spot();
      beamOn = !!(flash && flash.isEnabled() && flash.intensity > 0.5);
      if (beamOn) ensureShadows();
      if (shadowGen) {
        const map = shadowGen.getShadowMap();
        if (map) map.refreshRate = beamOn
          ? (opts.tier() === 'low'
            ? BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYTWOFRAMES
            : BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME)
          : BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
        casterPoll -= dt;
        if (beamOn && casterPoll <= 0) {
          casterPoll = 0.5;
          let n = 0;
          for (const mesh of scene.meshes) if (isFlashCaster(mesh)) n += 1;
          lastCasterCount = n;
        } else if (!beamOn) {
          lastCasterCount = 0;
        }
      }

      const camera = scene.activeCamera;
      if (camera && beamOn) ensureVolumetric(camera);
      if (vls) {
        const want = beamOn && opts.tier() === 'high' && !powers;
        // Weight 0 effectively hides the pass without detaching the post-process each frame.
        vls.weight = want ? 0.55 : 0;
      }
      if (vlsMesh && flash) {
        vlsMesh.position.copyFrom(flash.getAbsolutePosition());
        vlsMesh.setEnabled(beamOn && opts.tier() === 'high' && !powers);
      }

      if (caustic) caustic.paint(clock);
      if (causticLight) {
        const pulse = 0.85 + 0.15 * Math.sin(clock * 1.7);
        causticLight.intensity = powers ? 0.4 : 2.4 * pulse;
      }
      for (const mesh of scene.meshes) {
        const id = (mesh.metadata as { sceneAssetId?: string } | null)?.sceneAssetId ?? mesh.name;
        if (id !== 'vat-acid') continue;
        const mat = mesh.material;
        if (mat instanceof BABYLON.StandardMaterial) {
          const pulse = 0.85 + 0.15 * Math.sin(clock * 2.1);
          mat.emissiveColor.set(0.18 * pulse, 0.9 * pulse, 0.24 * pulse);
        }
      }

      // Fluorescent flicker script (intensity only — phone spot stays alone).
      let anyFlicker = false;
      if (!powers && flickerBases.size) {
        for (const [light, base] of flickerBases) {
          const id = (light.metadata as { sceneAssetId?: string } | null)?.sceneAssetId ?? light.name;
          // Stable hash so each tube has its own phase.
          let h = 0;
          for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
          const phase = (h % 1000) / 1000;
          const slow = 0.92 + 0.08 * Math.sin(clock * 1.3 + phase * 6);
          const stutter = Math.sin(clock * (11 + phase * 7) + phase * 20);
          const dip = stutter > 0.92 ? 0.25 + 0.2 * Math.random() : stutter > 0.78 ? 0.55 : 1;
          light.intensity = base * slow * dip;
          if (dip < 0.95) anyFlicker = true;
        }
      }
      syncBuzz(anyFlicker && !powers);

      // Dead-guard radio: crackles twice when Pierce walks past the Hall B drum (tone only).
      if (!powers && radioLeft > 0) {
        radioCooldown = Math.max(0, radioCooldown - dt);
        const p = playerAt?.();
        if (p && radioCooldown <= 0) {
          const dx = p.x - RADIO_AT.x;
          const dz = p.z - RADIO_AT.z;
          if (dx * dx + dz * dz < 3.2 * 3.2) {
            playClip(RADIO, 0.38, { world: { at: RADIO_AT, cls: 'machinery' } });
            radioLeft -= 1;
            radioCooldown = 2.4;
          }
        }
      }

      // Creature rim: when the beam points at it, a short cool rim reads the silhouette.
      ensureRim();
      if (rim) {
        let creature: BABYLON.AbstractMesh | null = null;
        for (const mesh of scene.meshes) {
          const id = (mesh.metadata as { sceneAssetId?: string } | null)?.sceneAssetId ?? mesh.name;
          if (id === 'b3-creature' || /parasite-starkie/.test(id)) {
            creature = mesh;
            break;
          }
        }
        let on = false;
        if (beamOn && flash && creature && creature.isEnabled() && creature.isVisible) {
          creature.computeWorldMatrix(true);
          const at = creature.getBoundingInfo().boundingBox.centerWorld;
          const to = at.subtract(flash.getAbsolutePosition());
          const dist = to.length();
          to.scaleInPlace(1 / Math.max(dist, 0.001));
          const aim = BABYLON.Vector3.Dot(flash.direction.normalize(), to);
          if (dist < 14 && aim > 0.72) {
            on = true;
            // Rim from the far side of the creature, toward the camera a little.
            const cam = scene.activeCamera?.globalPosition ?? flash.getAbsolutePosition();
            const away = at.subtract(flash.getAbsolutePosition()).normalize();
            rim.position.copyFrom(at).addInPlace(away.scale(1.1));
            rim.position.y += 0.4;
            rim.direction.copyFrom(at.subtract(rim.position).normalize());
            // Bias slightly toward camera so the rim catches.
            const toCam = cam.subtract(at).normalize();
            rim.direction = rim.direction.add(toCam.scale(0.35)).normalize();
            rim.intensity = 4.2 * Math.min(1, (aim - 0.72) / 0.2);
          }
        }
        if (!on) rim.intensity = 0;
      }

      // Expose flash shadow matrix for the interior shader (bound from dress.step).
      const flashShadow = scene.metadata as { b3FlashShadow?: B3FlashShadowBind } | null;
      if (flashShadow) {
        /* filled below via getBind */
      }
    },
    /** Bind data the interior dress samples for flashlight shadows. */
    flashShadowBind: (): B3FlashShadowBind => {
      const flash = spot();
      const map = shadowGen?.getShadowMap() ?? null;
      const matrix = shadowGen?.getTransformMatrix() ?? null;
      return {
        enabled: beamOn && !!map && !!matrix && !!flash,
        map,
        matrix,
        strength: 0.72,
      };
    },
    stats: (): B3HorrorStats => {
      const landmarks = [
        { id: 'light-vat', lit: true },
        { id: 'exit-beacons', lit: landmarkLights.length >= 2 },
        { id: 'hall-practicals', lit: flickerBases.size >= 2 },
      ];
      return {
        active: true,
        flashlightShadows: !!shadowGen && beamOn,
        shadowCasters: lastCasterCount,
        beamVisible: beamOn,
        volumetric: !!vls && beamOn && opts.tier() === 'high',
        fogMode: scene.fogMode === BABYLON.Scene.FOGMODE_EXP2 ? 'exp2' : scene.fogMode === BABYLON.Scene.FOGMODE_LINEAR ? 'linear' : 'none',
        landmarks,
        vatWallsLit: countVatWallsLit(),
        flickerOn: buzzWant,
        creatureRim: !!(rim && rim.intensity > 0.2),
        fpsHint: Math.round(fpsEma * 10) / 10,
      };
    },
    dispose: () => {
      syncBuzz(false);
      for (const [light, base] of flickerBases) light.intensity = base;
      flickerBases.clear();
      for (const d of owned) {
        try { d.dispose(); } catch { /* already gone */ }
      }
      owned.length = 0;
      shadowGen = null;
      vls = null;
      vlsMesh = null;
      rim = null;
      causticLight = null;
      caustic = null;
      bubbles = null;
    },
  };
};

export type B3FlashShadowBind = {
  enabled: boolean;
  map: BABYLON.RenderTargetTexture | null;
  matrix: BABYLON.Matrix | null;
  strength: number;
};

export type B3Horror = ReturnType<typeof createB3Horror>;
