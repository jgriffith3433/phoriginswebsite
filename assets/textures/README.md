# Texture pipeline

Drop **source** photos/maps in `C:\Projects\phoriginsassets\textures` (outside this repo), or import from the editor. This folder only holds **runtime WebP** plus `materials.json`.

Do not copy 4k/8k PNG/JPEG sources into git. Editor imports land in `assets/textures/source/` (gitignored) and emit compressed WebP here.

## Add a pack (editor)

1. Open Dev Tools (`devtools.html`). Top bar **Tools → Add Textures**.
2. Pick one or more PNG/JPG/WebP files. ffmpeg compresses them (max 1024) and registers `mat-…` ids.
3. Select a mesh. Inspector **Material** dropdown lists converted maps. Pick one — the viewport updates immediately and `materialId` is saved on the level JSON.

## Add a pack (CLI)

1. Put tileable albedos in `phoriginsassets/textures`.
2. Add a `converts` row and a `materials` id in `tools/texture-pipeline.json` (editor imports do this for you).
3. Run `npm run textures`.

## Runtime rules

- Albedo WebP, max **1024** (tiles) or **512** for small props. Hero maps can use `maxDim: 2048` in the pipeline job.
- Babylon `StandardMaterial`. UVs tile from world size / `tileMeters` so boxes don’t stretch.
- Glass: leave windows without a photo, or use `mat-wired-glass` (`transparent: true`). Keep `alpha` so glass stays see-through.

Material catalog: `assets/textures/materials.json` (generated).
