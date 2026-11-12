# Rendering pipeline

One module, `src/render/pipeline.ts`, renders every chapter. `main.ts` makes it right after the cameras, and
`src/game/grade.ts` drives it per theme (exposure, bloom weight and threshold, vignette, colour curves, the B3 fear
vignette).

## What it holds

| Piece | Where | Notes |
|---|---|---|
| DefaultRenderingPipeline | `pipeline.ts` | HDR, FXAA, ACES tonemapping, exposure, vignette. |
| Bloom | `grade.ts` sets weight and threshold per theme; the tier caps kernel and scale | Thresholds sit above lit walls (0.48 in B3's dark, 0.84-0.9 elsewhere), so practicals, screens, neon and the vat glow bloom. The changed-body grades bloom lower on purpose. |
| Chromatic aberration, grain | `pipeline.ts`, per chapter (`CHAPTER_LOOKS`) | A whisper: 4-7 px at the frame edge only (radial), grain 4-9. Medium and High only. |
| Chapter LUT | `assets/lut/<chapter>.3dl`, made by `node tools/genLuts.mjs` | 17³, applied after tonemapping. Edit the recipe in the tool and run it again, never the files. White keeps its brightest channel at full (Babylon normalises a `.3dl` by its largest value). The Train's level flickers with the tubes. |
| SSAO2 | `pipeline.ts`, strength and radius from `grade.ts` | High tier only. Disposed (not just detached) below High so its geometry pass stops. |
| Cascaded shadows | `pipeline.ts` (light, generator), `keyShadow.ts` (receivers) | See below. |
| Image-based environment | not yet: panoramas queued in Hawkes Gen (`.hawkes/pending-gpu.txt`) | `CHAPTER_LOOKS[*].env` names which one each chapter takes. AGENTS.md's "do not assign scene.environmentTexture" still holds; the chapter environment will feed the shared prop/character probe in `modelLoader.ts`. |

## Shadows

The key light is its own `DirectionalLight` (`key-shadow`): intensity 0 and `includedOnlyMeshes` set to an empty
anchor, so it lights nothing and never takes one of a material's four light slots. Each chapter's fill, sun and
practicals are unchanged; the shadow is the key's occlusion.

- **Casters** (`isCaster` in `pipeline.ts`): meshes whose material is tagged `character` or `prop` by
  `modelLoader.ts` (Pierce, NPCs, the creature, every GLB prop), or any mesh with `metadata.castShadow = true`
  (The Morning's furniture; `render.castShadow(mesh)` for new runtime furniture). Hidden, faded (shadow mode),
  other-layer (the mirror double), colliders and anything over 9 m radius do not cast.
- **Receivers** do not use Babylon's `receiveShadows`. Most floors and walls are custom ShaderMaterials (interior
  kit, city ground, station, train) that never see scene lights, so every receiver samples the same cascade array
  with `KEY_SHADOW_GLSL` and multiplies its lit colour by `keyShadow(world)` (1 lit, `1 - strength` in shadow).
  Standard and PBR materials get it from a material plugin registered at scene creation; a custom shader splices
  `${KEY_SHADOW_GLSL}`, merges `keyShadowShaderOptions(scene)` into its options and calls `attachKeyShadow`.
  Without a pipeline (Dev Tools, the Node checks, WebGL1) the define is off and `keyShadow` returns 1.
- **Characters cast but do not receive** (an overhead key turns faces into masks).
- **No acne by construction**: architecture never casts, so floors and walls compare against furniture and people
  only. Casters self-shadow with `bias` 0.0018 and `normalBias` 0.018, small enough that contact shadows stay
  under the feet (no peter-panning). Soft PCF: 4 (Low) or 8 (Medium, High) hardware-compared taps, kernel 1.4-2.6
  texels; the last cascade fades out at its rim.
- Per chapter (`CHAPTER_LOOKS`): direction (steep, overhead practicals; The Morning slants from the window; The Desk
  throws long from the lamp), strength 0.42-0.55, range 22-40 m. Quiet chapters may override the key with
  `render.setKeyDir` (`src/game/quietLight.ts`: Return clinical wash + buzzing tube, Desk lamp + city rim, Morning
  dawn shafts / VLS-or-meshes + TV spill). Playtest `quiet-light`.

## Tiers

| | Low | Medium | High |
|---|---|---|---|
| Cascades / map | 1 / 1024 | 2 / 1024 | 3 / 2048 |
| PCF taps | 4 | 8 | 8 |
| SSAO2 | off | off | on |
| Aberration, grain | off | on | on |
| Bloom cap (kernel / scale) | 24 / 0.3 | 48 / 0.5 | theme |
| Render size | ~1 MP | ~1.8 MP | native CSS px |

ACES, the LUT, bloom, vignette and one shadow cascade are on at every tier. Pick order: `?quality=low|medium|high`,
then Settings (`hawkes.settings.graphics`), then the device (`lowPowerGraphics`: phones, tablets and the low-memory
tier get Low). Settings > Graphics switches at once (`render.setTier`): the shadow generator is rebuilt, SSAO is
made or disposed, the post passes toggle and the render size changes in the same frame.

Engine-level choices made at boot (MSAA on the canvas, preserved drawing buffer, texture cap, fewer NPCs on
phones) still follow the device, not the Settings tier.

## Checks

- Probe `render()` (tier, LUT, shadows, casters, SSAO, passes) and `frameColor()` (mean colour of a finished frame).
- Playtest `graphics`: the Settings row, Low/Medium/High switch time (`graphicsSwitchMs`), Level 1 fps on High
  (`fpsL1High`), each chapter's look and colour fingerprint (`distinctGrades`). Option `phone`: 390x844 touch,
  Low, Level 1 fps (`fpsL1Low`).
- GLSL: the custom shaders compile as ESSL 3.00 with and without `KEY_SHADOW` (glslangValidator on the shader
  text converted the way Babylon does for WebGL2).
