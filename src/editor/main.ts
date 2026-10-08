import { createEditorViewport, type SelectionTarget } from './viewport';
import { fetchProjectTree, saveJsonFile, importModel, importFbxFile, importTextureFile, type FsTreeNode } from './fsApi';
import { renderProjectTree, inferAssetKind, type DraggableAssetPayload } from './projectPanel';
import { getAssetLibrary, invalidateAssetLibrary, resolveLibraryEntry, resolveModelPath } from '../game/modelLoader';
import { LEVEL_LIBRARY_PATH } from '../game/levels';
import { applyMaterialToMesh, getMaterialDefs, invalidateMaterials, parseUvScale, resolveMeshUvScale, warmupMaterials, type MaterialDef } from '../game/materials';
import {
  CLIP_TRIMS_PATH,
  clipFps,
  clipFullDurationSec,
  clipPlayRange,
  clipTail,
  loadClipTrims,
  lookupClipTrim,
  rememberClipTrims,
  upsertClipTrim,
  type ClipTrim,
  type ClipTrimsFile,
} from '../game/clipTrims';
import { getSceneTheme } from '../game/scene';
import { toSceneAssetKind, type SceneAssetInstance, type SceneData, type SceneNodeMetadata, type SceneTrigger } from '../game/sceneData';
import { MUSIC_TRIGGER_TYPE, isMusicTrigger, musicTriggerAudio } from '../game/triggers';
import { createUnlockedAudio, installAudioUnlock, unlockAudio } from '../game/audioUnlock';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $('viewportCanvas') as HTMLCanvasElement;
const dropZone = $('sceneDropZone') as HTMLDivElement;
const projectTreeEl = $('projectTree') as HTMLDivElement;
const hierarchyTreeEl = $('hierarchyTree') as HTMLDivElement;
const hierarchySearchEl = $('hierarchySearch') as HTMLInputElement;
const inspectorEl = $('inspectorContent') as HTMLDivElement;
const consoleEl = $('consoleOutput') as HTMLTextAreaElement;
const levelSelectEl = $('levelSelect') as HTMLSelectElement;
const saveStatusEl = $('saveStatus') as HTMLSpanElement;

const log = (message: string) => {
  const stamp = new Date().toLocaleTimeString();
  consoleEl.value = `[${stamp}] ${message}\n${consoleEl.value}`.slice(0, 8000);
};

type LevelManifestEntry = { id: string; name?: string; path: string; theme?: string; difficulty?: number; comingSoon?: boolean };

// Known component tags an asset can carry. Purely descriptive metadata today
// (not yet wired to gameplay behavior), shown/edited in the Inspector like a
// Unity component list.
const KNOWN_COMPONENTS = ['Transform', 'Collider', 'AudioSource', 'Light', 'Renderer', 'Trigger'];

const TRIGGER_TYPES: { value: string; label: string }[] = [
  { value: 'enter_zone', label: 'Enter Zone' },
  { value: 'checkpoint', label: 'Checkpoint' },
  { value: 'cutscene', label: 'Cutscene' },
  { value: 'npc_exit', label: 'NPC Exit' },
  { value: MUSIC_TRIGGER_TYPE, label: 'Music' },
];

let currentLevelPath = '/levels/apex-peak.json';
let sceneData: SceneData | null = null;
let selection: SelectionTarget | null = null;
let saveTimer: number | undefined;
let materialOptions: MaterialDef[] = [];
let projectAudioPaths: string[] = [];
let previewAudio: HTMLAudioElement | null = null;

const viewport = createEditorViewport(canvas, {
  onSelect: (target) => {
    selection = target;
    renderHierarchy();
    renderInspector();
    if (!animTrimPanel.hidden && target?.kind === 'asset') void openAnimTrimPanel(target.id);
  },
  onTransformChange: (target) => {
    commitNodeTransformToData(target);
    renderInspector();
    scheduleSave();
  },
});

const findAsset = (id: string): SceneAssetInstance | undefined => sceneData?.assets.find((a) => a.id === id);
const findTrigger = (id: string): SceneTrigger | undefined => sceneData?.triggers.find((t) => t.id === id);

const readAssetPosition = (asset: SceneAssetInstance) => ({
  x: asset.position?.x ?? asset.x ?? 0,
  y: asset.position?.y ?? asset.y ?? 0,
  z: asset.position?.z ?? asset.z ?? 0,
});

/** Keep `position` and `x/y/z` identical. Load prefers `position`, so a gizmo write to `x` alone is discarded on refresh. */
const writeAssetPosition = (asset: SceneAssetInstance, x: number, y: number, z: number) => {
  asset.x = x;
  asset.y = y;
  asset.z = z;
  asset.position = { x, y, z };
};

const writeTriggerPosition = (trigger: SceneTrigger, x: number, y: number, z: number) => {
  trigger.x = x;
  trigger.y = y;
  trigger.z = z;
  trigger.position = { x, y, z };
};

const commitNodeTransformToData = (target: SelectionTarget) => {
  if (!sceneData) return;
  if (target.kind === 'asset') {
    const asset = findAsset(target.id);
    const node = viewport.getAssetNode(target.id);
    if (!asset || !node) return;
    const transformNode = node as import('@babylonjs/core').TransformNode;
    if (transformNode.position) {
      writeAssetPosition(asset, transformNode.position.x, transformNode.position.y, transformNode.position.z);
    }
    if (transformNode.rotation) {
      asset.rotation = { x: transformNode.rotation.x, y: transformNode.rotation.y, z: transformNode.rotation.z };
    }
    if (transformNode.scaling) {
      asset.scale = { x: transformNode.scaling.x, y: transformNode.scaling.y, z: transformNode.scaling.z };
    }
  } else {
    const trigger = findTrigger(target.id);
    const node = viewport.getTriggerNode(target.id);
    if (!trigger || !node) return;
    const transformNode = node as import('@babylonjs/core').TransformNode;
    writeTriggerPosition(trigger, transformNode.position.x, transformNode.position.y, transformNode.position.z);
  }
};

const scheduleSave = (immediate = false): Promise<void> => {
  if (!sceneData) return Promise.resolve();
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  const run = async () => {
    saveStatusEl.textContent = 'Saving…';
    const ok = await saveJsonFile(currentLevelPath, sceneData);
    saveStatusEl.textContent = ok ? 'Saved' : 'Save failed (is npm run dev active?)';
    log(ok ? `Saved ${currentLevelPath}` : `Failed to save ${currentLevelPath}`);
  };
  if (immediate) return run();
  return new Promise((resolve) => {
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined;
      void run().then(resolve);
    }, 450);
  });
};

const flushSceneSave = async () => {
  if (!saveTimer) return;
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  await scheduleSave(true);
};

const degToRad = (deg: number) => (deg * Math.PI) / 180;
const radToDeg = (rad: number) => (rad * 180) / Math.PI;

const makeField = (label: string, value: number, onChange: (next: number) => void): HTMLElement => {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.1';
  input.value = value.toFixed(2);
  input.addEventListener('change', () => onChange(Number(input.value) || 0));
  wrap.appendChild(labelEl);
  wrap.appendChild(input);
  return wrap;
};

const collectAudioPaths = (nodes: FsTreeNode[], acc: string[] = []): string[] => {
  nodes.forEach((node) => {
    if (node.isDir) collectAudioPaths(node.children ?? [], acc);
    else if (inferAssetKind(node.name) === 'audio') acc.push(node.path);
  });
  return acc;
};

const stopPreviewAudio = () => {
  if (!previewAudio) return;
  previewAudio.pause();
  previewAudio.src = '';
  previewAudio = null;
};

const playPreviewAudio = (url: string, fadeSeconds: number) => {
  stopPreviewAudio();
  if (!url) return;
  unlockAudio();
  const element = createUnlockedAudio(url);
  element.loop = true;
  element.volume = 0;
  previewAudio = element;
  const started = performance.now();
  const fade = Math.max(0.05, fadeSeconds);
  const tick = () => {
    if (previewAudio !== element) return;
    const t = Math.min(1, (performance.now() - started) / (fade * 1000));
    element.volume = t;
    if (t < 1) requestAnimationFrame(tick);
  };
  void element.play().then(() => requestAnimationFrame(tick)).catch(() => {});
};

const ensureTriggerData = (trigger: SceneTrigger): Record<string, unknown> => {
  if (!trigger.data) trigger.data = {};
  return trigger.data;
};

const renderNumberRow = (label: string, value: number, onChange: (next: number) => void): HTMLElement => {
  const group = document.createElement('div');
  group.className = 'inspector-row';
  const title = document.createElement('div');
  title.className = 'label';
  title.innerHTML = `<span>${label}</span>`;
  group.appendChild(title);
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.1';
  input.min = '0.01';
  input.value = value.toFixed(2);
  input.addEventListener('change', () => onChange(Number(input.value) || 0));
  group.appendChild(input);
  return group;
};

const renderVectorRow = (
  label: string,
  vec: { x: number; y: number; z: number },
  onChange: (next: { x: number; y: number; z: number }) => void,
  convert: { toUi: (n: number) => number; fromUi: (n: number) => number } = { toUi: (n) => n, fromUi: (n) => n },
): HTMLElement => {
  const group = document.createElement('div');
  group.className = 'inspector-row';
  const title = document.createElement('div');
  title.className = 'label';
  title.innerHTML = `<span>${label}</span>`;
  group.appendChild(title);
  const row = document.createElement('div');
  row.className = 'field-row';
  row.style.gridTemplateColumns = '1fr 1fr 1fr';
  (['x', 'y', 'z'] as const).forEach((axis) => {
    row.appendChild(
      makeField(axis.toUpperCase(), convert.toUi(vec[axis]), (next) => {
        onChange({ ...vec, [axis]: convert.fromUi(next) });
      }),
    );
  });
  group.appendChild(row);
  return group;
};

// Renders the Unity-style "attached components" list for an asset: a chip
// per component with a remove button, plus a dropdown to add any known
// component type that isn't already attached.
const renderComponentsRow = (asset: SceneAssetInstance): HTMLElement => {
  const group = document.createElement('div');
  group.className = 'inspector-row';
  const title = document.createElement('div');
  title.className = 'label';
  title.innerHTML = '<span>Components</span>';
  group.appendChild(title);

  const chipsWrap = document.createElement('div');
  chipsWrap.className = 'component-chips';
  const components = asset.components ?? [];
  if (components.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'component-empty';
    empty.textContent = 'No components attached.';
    chipsWrap.appendChild(empty);
  }
  components.forEach((comp) => {
    const chip = document.createElement('span');
    chip.className = 'component-chip';
    const label = document.createElement('span');
    label.textContent = comp;
    chip.appendChild(label);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'component-chip-remove';
    removeBtn.textContent = '\u00d7';
    removeBtn.title = `Remove ${comp}`;
    removeBtn.addEventListener('click', () => {
      asset.components = components.filter((c) => c !== comp);
      renderInspector();
      scheduleSave();
    });
    chip.appendChild(removeBtn);
    chipsWrap.appendChild(chip);
  });
  group.appendChild(chipsWrap);

  const addWrap = document.createElement('div');
  addWrap.className = 'component-add';
  const available = KNOWN_COMPONENTS.filter((c) => !components.includes(c));
  const select = document.createElement('select');
  available.forEach((comp) => {
    const option = document.createElement('option');
    option.value = comp;
    option.textContent = comp;
    select.appendChild(option);
  });
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+ Add';
  if (available.length === 0) {
    select.disabled = true;
    addBtn.disabled = true;
  }
  addBtn.addEventListener('click', () => {
    if (!select.value) return;
    asset.components = [...components, select.value];
    renderInspector();
    scheduleSave();
  });
  addWrap.appendChild(select);
  addWrap.appendChild(addBtn);
  group.appendChild(addWrap);

  return group;
};

const applyAssetEdit = (asset: SceneAssetInstance, patch: Partial<SceneAssetInstance>) => {
  Object.assign(asset, patch);
  if (patch.uvScale) {
    delete asset.uScale;
    delete asset.vScale;
  }
  const node = viewport.getAssetNode(asset.id);
  if (node) {
    const t = node as import('@babylonjs/core').TransformNode;
    if (patch.x !== undefined || patch.y !== undefined || patch.z !== undefined) {
      writeAssetPosition(asset, asset.x ?? asset.position?.x ?? 0, asset.y ?? asset.position?.y ?? 0, asset.z ?? asset.position?.z ?? 0);
      t.position?.set(asset.x ?? 0, asset.y ?? 0, asset.z ?? 0);
    }
    if (patch.rotation && t.rotation) {
      t.rotation.set(patch.rotation.x ?? 0, patch.rotation.y ?? 0, patch.rotation.z ?? 0);
    }
    if (patch.scale && t.scaling) {
      t.scaling.set(patch.scale.x ?? 1, patch.scale.y ?? 1, patch.scale.z ?? 1);
    }
    if (patch.materialId !== undefined) {
      void applyMaterialLive(asset);
    } else if ((patch.scale || patch.uvScale) && asset.materialId) {
      const mesh = meshFromAssetNode(t);
      if (mesh) {
        mesh.metadata = { ...(mesh.metadata ?? {}), sceneAssetId: asset.id, materialId: asset.materialId, uvScale: parseUvScale(asset) };
        applyMaterialToMesh(viewport.scene, mesh, asset);
      }
    }
  }
  renderHierarchy();
  scheduleSave();
};

const meshFromAssetNode = (node: import('@babylonjs/core').Node | undefined) => {
  if (!node) return null;
  const asMesh = node as import('@babylonjs/core').AbstractMesh;
  if (typeof asMesh.getClassName === 'function' && asMesh.getClassName().includes('Mesh')) return asMesh;
  const child = (node as import('@babylonjs/core').TransformNode).getChildMeshes?.(false)?.[0];
  return child ?? null;
};

const applyMaterialLive = async (asset: SceneAssetInstance) => {
  const node = viewport.getAssetNode(asset.id);
  if (!asset.materialId) {
    const wasSelected = selection?.kind === 'asset' && selection.id === asset.id;
    viewport.removeAsset(asset.id);
    const created = viewport.addAssetNode(asset);
    if (wasSelected) viewport.selectNode(created);
    return;
  }
  const mesh = meshFromAssetNode(node);
  if (!mesh) return;
  mesh.metadata = {
    ...(mesh.metadata ?? {}),
    sceneAssetId: asset.id,
    materialId: asset.materialId,
    assetKind: asset.kind ?? asset.type,
    uvScale: parseUvScale(asset),
  };
  await warmupMaterials(viewport.scene);
  applyMaterialToMesh(viewport.scene, mesh, asset);
};

const refreshMaterialOptions = async () => {
  invalidateMaterials();
  materialOptions = await getMaterialDefs();
};

const animTrimPanel = $('animTrimPanel');
const animTrimClipSelect = $('animTrimClipSelect') as HTMLSelectElement;
const animTrimHint = $('animTrimHint');
const animTrimMeta = $('animTrimMeta');
const animTrimStatus = $('animTrimStatus');
const animTrimStartRange = $('animTrimStartRange') as HTMLInputElement;
const animTrimEndRange = $('animTrimEndRange') as HTMLInputElement;
const animTrimStartNum = $('animTrimStartNum') as HTMLInputElement;
const animTrimEndNum = $('animTrimEndNum') as HTMLInputElement;
const animTrimStartFrame = $('animTrimStartFrame');
const animTrimEndFrame = $('animTrimEndFrame');

let clipTrims: ClipTrimsFile = { version: 1, clips: {}, assets: {} };
let trimAssetId: string | null = null;
let trimPreviewClipName: string | null = null;
let trimSaveTimer: number | undefined;
let trimUiSyncing = false;

const animationGroupsForAsset = (assetId: string) => {
  const node = viewport.getAssetNode(assetId);
  if (!node) return [];
  const meta = node.metadata as SceneNodeMetadata | undefined;
  const stored = (meta?.clipGroups ?? []).filter((clip) => clip && viewport.scene.animationGroups.includes(clip));
  if (stored.length) return stored;
  const ids = new Set<number>();
  const add = (item: { uniqueId?: number } | null | undefined) => {
    if (item && typeof item.uniqueId === 'number') ids.add(item.uniqueId);
  };
  add(node);
  node.getChildMeshes?.(true)?.forEach(add);
  node.getDescendants?.(true)?.forEach(add);
  return viewport.scene.animationGroups.filter((group) =>
    group.targetedAnimations.some((ta) => ta.target && ids.has((ta.target as { uniqueId: number }).uniqueId)),
  );
};

const glbPathForAsset = async (asset: SceneAssetInstance) => {
  const node = viewport.getAssetNode(asset.id);
  const metaPath = (node?.metadata as SceneNodeMetadata | undefined)?.modelPath;
  if (metaPath) return metaPath;
  const library = await getAssetLibrary();
  return resolveModelPath(library, asset.assetId) ?? '';
};

const waitForAssetClips = async (assetId: string, timeoutMs = 8000) => {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const clips = animationGroupsForAsset(assetId);
    if (clips.length) return clips;
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  return animationGroupsForAsset(assetId);
};

const selectedTrimClip = () => {
  if (!trimAssetId) return null;
  const name = animTrimClipSelect.value;
  return animationGroupsForAsset(trimAssetId).find((clip) => clip.name === name) ?? null;
};

const stopTrimPreview = () => {
  if (!trimAssetId) return;
  animationGroupsForAsset(trimAssetId).forEach((clip) => clip.stop(true));
};

const playTrimPreview = (loop: boolean) => {
  const clip = selectedTrimClip();
  if (!clip || !trimAssetId) return;
  const trim: ClipTrim = {
    start: Number(animTrimStartNum.value) || 0,
    end: Number(animTrimEndNum.value) || 0,
  };
  const { from, to } = clipPlayRange(clip, trim);
  stopTrimPreview();
  clip.start(loop, 1, from, to, false);
  trimPreviewClipName = clip.name;
};

const frameLabel = (seconds: number, fps: number, origin: number) =>
  `fr ${Math.round(origin + seconds * fps)}`;

const refreshTrimFields = () => {
  const clip = selectedTrimClip();
  const asset = trimAssetId ? findAsset(trimAssetId) : undefined;
  if (!clip || !asset) {
    animTrimMeta.textContent = '';
    return;
  }
  const fps = clipFps(clip);
  const duration = clipFullDurationSec(clip);
  const start = Number(animTrimStartNum.value) || 0;
  const end = Number(animTrimEndNum.value) || 0;
  animTrimMeta.textContent = `${clipTail(clip.name)} · ${duration.toFixed(2)}s full · ${fps} fps · local frames ${clip.from.toFixed(0)}–${clip.to.toFixed(0)}`;
  animTrimStartFrame.textContent = frameLabel(start, fps, clip.from);
  animTrimEndFrame.textContent = frameLabel(end, fps, clip.from);
};

const applyTrimToInputs = (clip: import('@babylonjs/core').AnimationGroup, glbPath: string) => {
  const duration = Math.max(clipFullDurationSec(clip), 0.01);
  const stored = lookupClipTrim(clipTrims, clipTail(clip.name), glbPath);
  const start = stored?.start ?? 0;
  const end = stored?.end ?? duration;
  trimUiSyncing = true;
  [animTrimStartRange, animTrimEndRange, animTrimStartNum, animTrimEndNum].forEach((input) => {
    input.min = '0';
    input.max = duration.toFixed(3);
    input.step = '0.01';
  });
  animTrimStartRange.value = String(start);
  animTrimEndRange.value = String(end);
  animTrimStartNum.value = start.toFixed(2);
  animTrimEndNum.value = end.toFixed(2);
  trimUiSyncing = false;
  refreshTrimFields();
};

const persistTrim = (immediate = false): Promise<void> => {
  const clip = selectedTrimClip();
  const asset = trimAssetId ? findAsset(trimAssetId) : undefined;
  if (!clip || !asset) return Promise.resolve();
  window.clearTimeout(trimSaveTimer);
  trimSaveTimer = undefined;
  const run = async () => {
    const glbPath = await glbPathForAsset(asset);
    const duration = clipFullDurationSec(clip);
    const start = Math.max(0, Math.min(Number(animTrimStartNum.value) || 0, duration));
    const end = Math.max(start + 1 / clipFps(clip), Math.min(Number(animTrimEndNum.value) || duration, duration));
    const isFull = start <= 0.0005 && Math.abs(end - duration) <= 0.0005;
    clipTrims = upsertClipTrim(clipTrims, clipTail(clip.name), isFull ? null : { start, end }, glbPath);
    rememberClipTrims(clipTrims);
    animTrimStatus.textContent = 'Saving trims…';
    const ok = await saveJsonFile(CLIP_TRIMS_PATH, clipTrims);
    animTrimStatus.textContent = ok
      ? `Saved ${clipTail(clip.name)}${isFull ? ' (full clip)' : ''} → ${CLIP_TRIMS_PATH}`
      : 'Trim save failed (is npm run dev active?)';
    if (ok) log(`Saved animation trim for ${clipTail(clip.name)}`);
  };
  if (immediate) return run();
  return new Promise((resolve) => {
    trimSaveTimer = window.setTimeout(() => {
      trimSaveTimer = undefined;
      void run().then(resolve);
    }, 400);
  });
};

const flushTrimSave = async () => {
  if (!trimSaveTimer) return;
  window.clearTimeout(trimSaveTimer);
  trimSaveTimer = undefined;
  await persistTrim(true);
};

const fillTrimClipSelect = (clips: import('@babylonjs/core').AnimationGroup[], keepName?: string | null) => {
  const previous = keepName ?? animTrimClipSelect.value;
  animTrimClipSelect.innerHTML = '';
  const sorted = [...clips].sort((a, b) => clipTail(a.name).localeCompare(clipTail(b.name)));
  sorted.forEach((clip) => {
    const option = document.createElement('option');
    option.value = clip.name;
    option.textContent = clipTail(clip.name);
    animTrimClipSelect.appendChild(option);
  });
  const match = sorted.find((clip) => clip.name === previous) ?? sorted[0];
  if (match) animTrimClipSelect.value = match.name;
};

const openAnimTrimPanel = async (assetId?: string) => {
  animTrimPanel.hidden = false;
  let id = assetId ?? (selection?.kind === 'asset' ? selection.id : null);
  if (!id && sceneData) {
    const player = sceneData.assets.find((asset) => asset.assetId === 'asset-ch33-hero' || /player|hero|ch33/i.test(asset.name ?? ''));
    id = player?.id ?? sceneData.assets.find((asset) => (asset.kind ?? asset.type) === 'model')?.id ?? null;
    if (id) {
      const node = viewport.getAssetNode(id);
      if (node) viewport.selectNode(node);
    }
  }
  trimAssetId = id;
  if (!id) {
    animTrimHint.textContent = 'Select a character in the Hierarchy, then open Animation trim.';
    animTrimClipSelect.innerHTML = '';
    return;
  }
  animTrimHint.textContent = 'Loading clips…';
  const clips = await waitForAssetClips(id);
  if (trimAssetId !== id) return;
  if (!clips.length) {
    animTrimHint.textContent = 'No AnimationGroups on this object yet (still importing, or not a skinned character).';
    animTrimClipSelect.innerHTML = '';
    return;
  }
  const asset = findAsset(id);
  animTrimHint.textContent = asset ? `${asset.name ?? asset.assetId} · exact clip tails` : 'Exact clip tails';
  fillTrimClipSelect(clips, trimPreviewClipName);
  const clip = selectedTrimClip();
  if (clip && asset) applyTrimToInputs(clip, await glbPathForAsset(asset));
};

const onTrimInput = (source: 'start' | 'end', value: number) => {
  if (trimUiSyncing) return;
  const clip = selectedTrimClip();
  const duration = clip ? clipFullDurationSec(clip) : Number(animTrimEndRange.max) || 1;
  const minGap = clip ? 1 / clipFps(clip) : 0.01;
  let start = source === 'start' ? value : Number(animTrimStartNum.value) || 0;
  let end = source === 'end' ? value : Number(animTrimEndNum.value) || duration;
  start = Math.max(0, Math.min(start, duration - minGap));
  end = Math.max(start + minGap, Math.min(end, duration));
  trimUiSyncing = true;
  animTrimStartRange.value = String(start);
  animTrimStartNum.value = start.toFixed(2);
  animTrimEndRange.value = String(end);
  animTrimEndNum.value = end.toFixed(2);
  trimUiSyncing = false;
  refreshTrimFields();
  persistTrim();
};

const renderAmbientRow = (): HTMLElement => {
  const theme = getSceneTheme(sceneData?.theme ?? '');
  const value = sceneData?.ambient ?? theme.hemiIntensity;
  const group = document.createElement('div');
  group.className = 'inspector-row';
  const title = document.createElement('div');
  title.className = 'label';
  title.innerHTML = `<span>Ambient</span><span>${value.toFixed(2)}</span>`;
  group.appendChild(title);
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = '2.5';
  range.step = '0.05';
  range.value = String(Math.min(2.5, value));
  const number = document.createElement('input');
  number.type = 'number';
  number.min = '0';
  number.step = '0.05';
  number.value = value.toFixed(2);
  const readout = title.querySelector('span:last-child');
  const apply = (next: number) => {
    if (!sceneData || !Number.isFinite(next)) return;
    const fill = Math.max(0, next);
    sceneData.ambient = fill;
    viewport.setAmbient(fill);
    if (readout) readout.textContent = fill.toFixed(2);
    void scheduleSave();
  };
  range.addEventListener('input', () => {
    const next = Number(range.value);
    number.value = next.toFixed(2);
    apply(next);
  });
  number.addEventListener('change', () => {
    const next = Number(number.value) || 0;
    range.value = String(Math.min(2.5, Math.max(0, next)));
    apply(next);
  });
  group.appendChild(range);
  group.appendChild(number);
  const hint = document.createElement('div');
  hint.className = 'value';
  hint.textContent = 'Level fill. Raises the hemispheric light. Saved on this level.';
  group.appendChild(hint);
  return group;
};

const renderInspector = () => {
  inspectorEl.innerHTML = '';
  if (sceneData) inspectorEl.appendChild(renderAmbientRow());

  if (!selection || !sceneData) {
    const empty = document.createElement('div');
    empty.className = 'inspector-row';
    empty.innerHTML = `
      <div class="label"><span>Selected</span></div>
      <div class="value">Nothing selected. Click an object in the viewport or Hierarchy, or drag an asset from Project into the scene.</div>`;
    inspectorEl.appendChild(empty);
    return;
  }

  if (selection.kind === 'asset') {
    const asset = findAsset(selection.id);
    if (!asset) return;

    const nameRow = document.createElement('div');
    nameRow.className = 'inspector-row';
    nameRow.innerHTML = `<div class="label"><span>Name</span></div>`;
    const nameInput = document.createElement('input');
    nameInput.value = asset.name ?? asset.assetId ?? asset.id;
    nameInput.addEventListener('change', () => applyAssetEdit(asset, { name: nameInput.value }));
    nameRow.appendChild(nameInput);
    inspectorEl.appendChild(nameRow);

    const kindRow = document.createElement('div');
    kindRow.className = 'inspector-row';
    kindRow.innerHTML = `<div class="label"><span>Kind</span></div><div class="value"><span class="type-tag">${asset.kind ?? asset.type ?? 'model'}</span> ${asset.assetId ?? ''}</div>`;
    inspectorEl.appendChild(kindRow);

    inspectorEl.appendChild(
      renderVectorRow('Position', readAssetPosition(asset), (next) =>
        applyAssetEdit(asset, { x: next.x, y: next.y, z: next.z }),
      ),
    );
    inspectorEl.appendChild(
      renderVectorRow(
        'Rotation (°)',
        { x: asset.rotation?.x ?? 0, y: asset.rotation?.y ?? 0, z: asset.rotation?.z ?? 0 },
        (next) => applyAssetEdit(asset, { rotation: next }),
        { toUi: radToDeg, fromUi: degToRad },
      ),
    );
    inspectorEl.appendChild(
      renderVectorRow('Scale', { x: asset.scale?.x ?? 1, y: asset.scale?.y ?? 1, z: asset.scale?.z ?? 1 }, (next) =>
        applyAssetEdit(asset, { scale: next }),
      ),
    );

    const matRow = document.createElement('div');
    matRow.className = 'inspector-row';
    matRow.innerHTML = `<div class="label"><span>Material</span></div>`;
    const matSelect = document.createElement('select');
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'None (theme color)';
    matSelect.appendChild(noneOpt);
    materialOptions.forEach((mat) => {
      const option = document.createElement('option');
      option.value = mat.id;
      option.textContent = mat.name ? `${mat.name} (${mat.id})` : mat.id;
      matSelect.appendChild(option);
    });
    if (asset.materialId && !materialOptions.some((mat) => mat.id === asset.materialId)) {
      const orphan = document.createElement('option');
      orphan.value = asset.materialId;
      orphan.textContent = `${asset.materialId} (missing file)`;
      matSelect.appendChild(orphan);
    }
    matSelect.value = asset.materialId ?? '';
    matSelect.addEventListener('change', () =>
      applyAssetEdit(asset, { materialId: matSelect.value.trim() || undefined }),
    );
    matRow.appendChild(matSelect);
    inspectorEl.appendChild(matRow);

    const def = materialOptions.find((mat) => mat.id === asset.materialId);
    const scaleVec = { x: asset.scale?.x ?? 1, y: asset.scale?.y ?? 1, z: asset.scale?.z ?? 1 };
    const override = parseUvScale(asset);
    const uv = override
      ? { u: override[0], v: override[1] }
      : def
        ? resolveMeshUvScale(asset, scaleVec, def)
        : { u: 1, v: 1 };

    inspectorEl.appendChild(
      renderNumberRow('U scale', uv.u, (next) => {
        const current = parseUvScale(asset) ?? [uv.u, uv.v];
        applyAssetEdit(asset, { uvScale: [Math.max(0.01, next), current[1]] });
      }),
    );
    inspectorEl.appendChild(
      renderNumberRow('V scale', uv.v, (next) => {
        const current = parseUvScale(asset) ?? [uv.u, uv.v];
        applyAssetEdit(asset, { uvScale: [current[0], Math.max(0.01, next)] });
      }),
    );

    inspectorEl.appendChild(renderComponentsRow(asset));

    const clips = animationGroupsForAsset(asset.id);
    if (clips.length > 0 || (asset.kind ?? asset.type) === 'model') {
      const trimRow = document.createElement('div');
      trimRow.className = 'inspector-row';
      trimRow.innerHTML = `<div class="label"><span>Animation</span></div>`;
      const trimBtn = document.createElement('button');
      trimBtn.type = 'button';
      trimBtn.textContent = clips.length ? `Trim clips (${clips.length})` : 'Animation trim';
      trimBtn.addEventListener('click', () => void openAnimTrimPanel(asset.id));
      trimRow.appendChild(trimBtn);
      inspectorEl.appendChild(trimRow);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete Object';
    deleteBtn.className = 'danger';
    deleteBtn.addEventListener('click', () => {
      if (!sceneData) return;
      const doomed = new Set([...collectDescendantAssetIds(asset.id), asset.id]);
      sceneData.triggers = sceneData.triggers.filter((t) => {
        if (t.parentId && doomed.has(t.parentId)) {
          viewport.removeTrigger(t.id);
          return false;
        }
        return true;
      });
      doomed.forEach((id) => viewport.removeAsset(id));
      sceneData.assets = sceneData.assets.filter((a) => !doomed.has(a.id));
      selection = null;
      renderHierarchy();
      renderInspector();
      scheduleSave(true);
      log(`Deleted ${asset.name ?? asset.id}`);
    });
    inspectorEl.appendChild(deleteBtn);
    return;
  }

  const trigger = findTrigger(selection.id);
  if (!trigger) return;

  const labelRow = document.createElement('div');
  labelRow.className = 'inspector-row';
  labelRow.innerHTML = `<div class="label"><span>Label</span></div>`;
  const labelInput = document.createElement('input');
  labelInput.value = trigger.label ?? trigger.type;
  labelInput.addEventListener('change', () => {
    trigger.label = labelInput.value;
    renderHierarchy();
    scheduleSave();
  });
  labelRow.appendChild(labelInput);
  inspectorEl.appendChild(labelRow);

  const typeRow = document.createElement('div');
  typeRow.className = 'inspector-row';
  typeRow.innerHTML = `<div class="label"><span>Type</span></div>`;
  const typeSelect = document.createElement('select');
  const typeValues = TRIGGER_TYPES.map((entry) => entry.value);
  TRIGGER_TYPES.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.value;
    option.textContent = entry.label;
    typeSelect.appendChild(option);
  });
  if (trigger.type && !typeValues.includes(trigger.type)) {
    const option = document.createElement('option');
    option.value = trigger.type;
    option.textContent = trigger.type;
    typeSelect.appendChild(option);
  }
  typeSelect.value = trigger.type || 'enter_zone';
  typeSelect.addEventListener('change', () => {
    trigger.type = typeSelect.value;
    if (isMusicTrigger(trigger)) {
      const data = ensureTriggerData(trigger);
      if (data.audio == null && data.path == null) data.audio = '';
      if (data.radius == null) data.radius = 8;
      if (data.loop == null) data.loop = true;
      if (data.fadeSeconds == null) data.fadeSeconds = 2;
      if (!trigger.label || trigger.label === 'New Trigger') trigger.label = 'Music';
    }
    renderHierarchy();
    renderInspector();
    scheduleSave();
  });
  typeRow.appendChild(typeSelect);
  inspectorEl.appendChild(typeRow);

  inspectorEl.appendChild(
    renderNumberRow('Radius', Number(trigger.data?.radius ?? (isMusicTrigger(trigger) ? 8 : 1.7)), (next) => {
      ensureTriggerData(trigger).radius = Math.max(0.01, next);
      scheduleSave();
    }),
  );

  if (isMusicTrigger(trigger)) {
    const audioPath = musicTriggerAudio(trigger);
    const audioRow = document.createElement('div');
    audioRow.className = 'inspector-row';
    audioRow.innerHTML = `<div class="label"><span>Audio</span></div>`;
    const audioWrap = document.createElement('div');
    audioWrap.style.display = 'grid';
    audioWrap.style.gap = '6px';
    const audioSelect = document.createElement('select');
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Custom path…';
    audioSelect.appendChild(blank);
    const paths = [...projectAudioPaths];
    if (audioPath && !paths.includes(audioPath)) paths.unshift(audioPath);
    paths.forEach((path) => {
      const option = document.createElement('option');
      option.value = path;
      option.textContent = path.replace(/^\/assets\//, '');
      audioSelect.appendChild(option);
    });
    audioSelect.value = paths.includes(audioPath) ? audioPath : '';
    const audioInput = document.createElement('input');
    audioInput.type = 'text';
    audioInput.placeholder = '/assets/audio/loop.wav';
    audioInput.value = audioPath;
    const commitAudio = (value: string) => {
      const data = ensureTriggerData(trigger);
      data.audio = value;
      delete data.path;
      scheduleSave();
    };
    audioSelect.addEventListener('change', () => {
      if (audioSelect.value) {
        audioInput.value = audioSelect.value;
        commitAudio(audioSelect.value);
      }
    });
    audioInput.addEventListener('change', () => commitAudio(audioInput.value.trim()));
    audioWrap.appendChild(audioSelect);
    audioWrap.appendChild(audioInput);
    audioRow.appendChild(audioWrap);
    inspectorEl.appendChild(audioRow);

    const loopRow = document.createElement('div');
    loopRow.className = 'inspector-row';
    loopRow.innerHTML = `<div class="label"><span>Loop</span></div>`;
    const loopInput = document.createElement('input');
    loopInput.type = 'checkbox';
    loopInput.checked = trigger.data?.loop !== false;
    loopInput.addEventListener('change', () => {
      ensureTriggerData(trigger).loop = loopInput.checked;
      scheduleSave();
    });
    loopRow.appendChild(loopInput);
    inspectorEl.appendChild(loopRow);

    inspectorEl.appendChild(
      renderNumberRow('Fade (s)', Number(trigger.data?.fadeSeconds ?? 2), (next) => {
        ensureTriggerData(trigger).fadeSeconds = Math.max(0, next);
        scheduleSave();
      }),
    );

    const previewRow = document.createElement('div');
    previewRow.className = 'inspector-row';
    previewRow.innerHTML = `<div class="label"><span>Preview</span></div>`;
    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.textContent = 'Play';
    previewBtn.addEventListener('click', () => {
      const url = musicTriggerAudio(trigger);
      if (!url) {
        log('Set an audio path before previewing.');
        return;
      }
      playPreviewAudio(url, Number(trigger.data?.fadeSeconds ?? 2));
      log(`Preview ${url}`);
    });
    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.textContent = 'Stop';
    stopBtn.addEventListener('click', () => stopPreviewAudio());
    const btnWrap = document.createElement('div');
    btnWrap.className = 'field-row';
    btnWrap.appendChild(previewBtn);
    btnWrap.appendChild(stopBtn);
    previewRow.appendChild(btnWrap);
    inspectorEl.appendChild(previewRow);
  }

  inspectorEl.appendChild(
    renderVectorRow('Position', { x: trigger.position?.x ?? trigger.x ?? 0, y: trigger.position?.y ?? trigger.y ?? 0, z: trigger.position?.z ?? trigger.z ?? 0 }, (next) => {
      writeTriggerPosition(trigger, next.x, next.y, next.z);
      const node = viewport.getTriggerNode(trigger.id);
      (node as import('@babylonjs/core').TransformNode)?.position?.set(next.x, next.y, next.z);
      scheduleSave();
    }),
  );

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete Trigger';
  deleteBtn.className = 'danger';
  deleteBtn.addEventListener('click', () => {
    if (!sceneData) return;
    sceneData.triggers = sceneData.triggers.filter((t) => t.id !== trigger.id);
    viewport.removeTrigger(trigger.id);
    selection = null;
    renderHierarchy();
    renderInspector();
    scheduleSave(true);
    log(`Deleted trigger ${trigger.label ?? trigger.id}`);
  });
  inspectorEl.appendChild(deleteBtn);
};

type HierarchyEntry = { target: SelectionTarget; label: string; tag: string; parentId?: string };

let dragged: SelectionTarget | null = null;

const isDescendantOf = (candidateId: string, ancestorId: string): boolean => {
  let current = findAsset(candidateId);
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    if (current.parentId === ancestorId) return true;
    seen.add(current.id);
    current = findAsset(current.parentId);
  }
  return false;
};

const collectDescendantAssetIds = (id: string): string[] => {
  const children = sceneData?.assets.filter((a) => a.parentId === id) ?? [];
  return children.flatMap((c) => [...collectDescendantAssetIds(c.id), c.id]);
};

const setParentOf = (child: SelectionTarget, parentId: string | null) => {
  if (!sceneData) return;
  if (parentId && child.kind === 'asset' && (parentId === child.id || isDescendantOf(parentId, child.id))) {
    log('Cannot parent an object under itself or its own child.');
    return;
  }
  const entry = child.kind === 'asset' ? findAsset(child.id) : findTrigger(child.id);
  if (!entry || (entry.parentId ?? null) === parentId) return;
  viewport.reparent(child, parentId);
  if (parentId) entry.parentId = parentId;
  else delete entry.parentId;
  commitNodeTransformToData(child);
  renderHierarchy();
  renderInspector();
  scheduleSave(true);
  log(parentId ? `Parented ${child.id} under ${parentId}.` : `Unparented ${child.id}.`);
};

const renderHierarchy = () => {
  hierarchyTreeEl.innerHTML = '';
  if (!sceneData) {
    hierarchyTreeEl.innerHTML = '<div class="hierarchy-item">No scene loaded</div>';
    return;
  }

  const entries: HierarchyEntry[] = [
    ...sceneData.assets.map((asset) => ({
      target: { kind: 'asset' as const, id: asset.id },
      label: asset.name ?? asset.assetId ?? asset.id,
      tag: asset.kind ?? asset.type ?? 'model',
      parentId: asset.parentId,
    })),
    ...sceneData.triggers.map((trigger) => ({
      target: { kind: 'trigger' as const, id: trigger.id },
      label: trigger.label ?? trigger.type,
      tag: trigger.type || 'trigger',
      parentId: trigger.parentId,
    })),
  ];
  const needle = hierarchySearchEl.value.trim().toLowerCase();
  const matchesQuery = (entry: HierarchyEntry) => {
    if (!needle) return true;
    return [entry.label, entry.tag, entry.target.id].some((value) => String(value).toLowerCase().includes(needle));
  };
  const assetIds = new Set(sceneData.assets.map((a) => a.id));
  const byId = new Map(entries.map((entry) => [entry.target.id, entry]));
  const visible = new Set<string>();
  if (!needle) {
    entries.forEach((entry) => visible.add(entry.target.id));
  } else {
    entries.forEach((entry) => {
      if (!matchesQuery(entry)) return;
      let current: string | undefined = entry.target.id;
      const seen = new Set<string>();
      while (current && !seen.has(current)) {
        seen.add(current);
        visible.add(current);
        const parent: string | undefined = byId.get(current)?.parentId;
        current = parent && assetIds.has(parent) ? parent : undefined;
      }
    });
  }

  const childrenOf = new Map<string | undefined, HierarchyEntry[]>();
  entries.forEach((entry) => {
    const key = entry.parentId && assetIds.has(entry.parentId) ? entry.parentId : undefined;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), entry]);
  });

  if (needle && visible.size === 0) {
    hierarchyTreeEl.innerHTML = '<div class="hierarchy-empty">No matching objects</div>';
    return;
  }

  const renderLevel = (parentKey: string | undefined, depth: number, visited: Set<string>) => {
    (childrenOf.get(parentKey) ?? []).forEach((entry) => {
      if (visited.has(entry.target.id) || !visible.has(entry.target.id)) return;
      const row = document.createElement('div');
      const isActive = selection?.kind === entry.target.kind && selection.id === entry.target.id;
      row.className = `hierarchy-item${isActive ? ' active' : ''}`;
      row.style.paddingLeft = `${10 + depth * 16}px`;
      row.draggable = true;
      const prefix = depth > 0 ? '? ' : '';
      row.innerHTML = `<div class="name"><span></span><span class="type-tag">${entry.tag}</span></div>`;
      row.querySelector('span')!.textContent = prefix + entry.label;
      row.addEventListener('click', () => {
        const node = entry.target.kind === 'asset' ? viewport.getAssetNode(entry.target.id) : viewport.getTriggerNode(entry.target.id);
        viewport.selectNode(node ?? null);
      });
      row.addEventListener('dragstart', (e) => {
        dragged = entry.target;
        e.dataTransfer?.setData('application/x-ph-hierarchy', entry.target.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => {
        dragged = null;
        hierarchyTreeEl.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
      });
      // Only assets can be parents.
      if (entry.target.kind === 'asset') {
        row.addEventListener('dragover', (e) => {
          if (!dragged) return;
          e.preventDefault();
          e.stopPropagation();
          row.classList.add('drop-target');
        });
        row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          row.classList.remove('drop-target');
          if (dragged) setParentOf(dragged, entry.target.id);
          dragged = null;
        });
      }
      hierarchyTreeEl.appendChild(row);
      const nextVisited = new Set(visited).add(entry.target.id);
      if (entry.target.kind === 'asset') renderLevel(entry.target.id, depth + 1, nextVisited);
    });
  };
  renderLevel(undefined, 0, new Set());
};

hierarchySearchEl.addEventListener('input', () => {
  renderHierarchy();
});

hierarchyTreeEl.addEventListener('dragover', (e) => {
  if (!dragged) return;
  e.preventDefault();
});
// Dropping on empty hierarchy space moves the object back to the scene root.
hierarchyTreeEl.addEventListener('drop', (e) => {
  if (!dragged) return;
  e.preventDefault();
  setParentOf(dragged, null);
  dragged = null;
});
const loadLevel = async (levelPath: string) => {
  try {
    const response = await fetch(levelPath, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as SceneData;
    data.assets = Array.isArray(data.assets) ? data.assets : [];
    data.triggers = Array.isArray(data.triggers) ? data.triggers : [];
    sceneData = data;
    currentLevelPath = levelPath;
    selection = null;
    viewport.rebuildFromScene(sceneData);
    renderHierarchy();
    renderInspector();
    log(`Loaded level: ${sceneData.name ?? levelPath}`);
  } catch (error) {
    log(`Failed to load level ${levelPath}: ${error}`);
  }
};

const populateLevelSelect = async () => {
  try {
    const response = await fetch(LEVEL_LIBRARY_PATH, { cache: 'no-store' });
    const manifest = response.ok ? await response.json() : null;
    const levels: LevelManifestEntry[] = Array.isArray(manifest?.levels) ? manifest.levels : [];
    levelSelectEl.innerHTML = '';
    levels.forEach((level) => {
      const option = document.createElement('option');
      option.value = level.path;
      option.textContent = level.comingSoon ? 'Coming soon' : (level.name || level.id);
      levelSelectEl.appendChild(option);
    });
    levelSelectEl.value = currentLevelPath;
  } catch (error) {
    log(`Failed to load level manifest: ${error}`);
  }
};

const collectAssetFiles = (nodes: FsTreeNode[], acc: FsTreeNode[] = []): FsTreeNode[] => {
  nodes.forEach((node) => {
    if (node.isDir) collectAssetFiles(node.children ?? [], acc);
    else acc.push(node);
  });
  return acc;
};

const loadProjectTree = async () => {
  invalidateAssetLibrary();
  const tree = await fetchProjectTree();
  if (!tree) {
    projectTreeEl.innerHTML = '<div class="fs-row">Unable to read project files. Run with `npm run dev`.</div>';
    return;
  }
  projectAudioPaths = collectAudioPaths(tree.assets ?? []).sort();
  renderProjectTree(
    projectTreeEl,
    [
      { label: 'Assets', nodes: tree.assets ?? [] },
      { label: 'Levels', nodes: tree.levels ?? [] },
    ],
    {
      onFileClick: (node) => {
        if (node.name.endsWith('.json') && node.path.startsWith('/levels/')) {
          void loadLevel(node.path);
          levelSelectEl.value = node.path;
        }
      },
    },
  );
};

const nextId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const inferClipName = (fileName: string) => {
  const lower = fileName.toLowerCase();
  if (lower.includes('jump')) return 'Jump';
  if (lower.includes('walk')) return 'Walk';
  if (lower.includes('idle')) return 'Idle';
  return fileName.replace(/\.fbx$/i, '').replace(/[^a-zA-Z0-9]+/g, '-') || 'Clip';
};

const fbxOverlay = $('fbxImportOverlay') as HTMLDivElement;
const fbxFileNameEl = $('fbxImportFileName') as HTMLParagraphElement;
const fbxClipNameInput = $('fbxClipName') as HTMLInputElement;
const fbxTargetInput = $('fbxTargetName') as HTMLInputElement;
const fbxCharacterInput = $('fbxCharacterName') as HTMLInputElement;
const fbxClipField = $('fbxClipField') as HTMLDivElement;
const fbxTargetField = $('fbxTargetField') as HTMLDivElement;
const fbxCharacterField = $('fbxCharacterField') as HTMLDivElement;
const fbxStatusEl = $('fbxImportStatus') as HTMLDivElement;
const fbxSubmitBtn = $('fbxImportSubmitBtn') as HTMLButtonElement;
let pendingFbxFile: File | null = null;

const fbxImportMode = () =>
  (document.querySelector('input[name="fbxImportMode"]:checked') as HTMLInputElement | null)?.value === 'character'
    ? 'character'
    : 'animation';

const syncFbxModeFields = () => {
  const animation = fbxImportMode() === 'animation';
  fbxClipField.hidden = !animation;
  fbxTargetField.hidden = !animation;
  fbxCharacterField.hidden = animation;
};

const closeFbxModal = () => {
  fbxOverlay.hidden = true;
  pendingFbxFile = null;
};

const openFbxModal = (file: File) => {
  pendingFbxFile = file;
  fbxFileNameEl.textContent = file.name;
  fbxClipNameInput.value = inferClipName(file.name);
  fbxCharacterInput.value = file.name.replace(/\.fbx$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '-') || 'character';
  fbxTargetInput.value = 'ch33-hero';
  fbxStatusEl.textContent = '';
  fbxStatusEl.className = 'import-model-status';
  fbxSubmitBtn.disabled = false;
  fbxSubmitBtn.textContent = 'Convert & Import';
  const animationRadio = document.querySelector('input[name="fbxImportMode"][value="animation"]') as HTMLInputElement;
  animationRadio.checked = true;
  syncFbxModeFields();
  fbxOverlay.hidden = false;
};

const collectFbxFiles = (transfer: DataTransfer | null) =>
  Array.from(transfer?.files ?? []).filter((file) => file.name.toLowerCase().endsWith('.fbx'));

const handleOsFbxDrop = (event: DragEvent) => {
  const files = collectFbxFiles(event.dataTransfer);
  if (!files.length) return false;
  event.preventDefault();
  dropZone.classList.remove('dragover');
  projectTreeEl.classList.remove('dragover');
  openFbxModal(files[0]);
  if (files.length > 1) log(`Queued ${files[0].name}. Drop remaining FBX files one at a time.`);
  return true;
};

document.querySelectorAll('input[name="fbxImportMode"]').forEach((input) => {
  input.addEventListener('change', syncFbxModeFields);
});
$('fbxImportCloseBtn').addEventListener('click', closeFbxModal);
$('fbxImportCancelBtn').addEventListener('click', closeFbxModal);
fbxOverlay.addEventListener('click', (event) => {
  if (event.target === fbxOverlay) closeFbxModal();
});

fbxSubmitBtn.addEventListener('click', async () => {
  if (!pendingFbxFile) return;
  const mode = fbxImportMode();
  const name = mode === 'animation' ? fbxClipNameInput.value.trim() : fbxCharacterInput.value.trim();
  if (!name) {
    fbxStatusEl.textContent = mode === 'animation' ? 'Clip name is required.' : 'Asset name is required.';
    fbxStatusEl.className = 'import-model-status error';
    return;
  }

  fbxSubmitBtn.disabled = true;
  fbxSubmitBtn.textContent = 'Converting...';
  fbxStatusEl.className = 'import-model-status';
  fbxStatusEl.textContent = 'Blender is baking the FBX. This can take a minute...';

  const result = await importFbxFile(pendingFbxFile, {
    mode,
    name,
    target: fbxTargetInput.value.trim() || 'ch33-hero',
  });

  if (!result.ok || !result.asset) {
    fbxStatusEl.textContent = result.error ?? 'Import failed.';
    fbxStatusEl.className = 'import-model-status error';
    fbxSubmitBtn.disabled = false;
    fbxSubmitBtn.textContent = 'Convert & Import';
    if (result.log) log(`FBX import failed: ${result.error}`);
    return;
  }

  fbxStatusEl.textContent = mode === 'animation'
    ? `Applied ${name} to ${result.asset.name}${result.clipNames?.length ? ` (${result.clipNames.join(', ')})` : ''}.`
    : `Imported ${result.asset.name}.`;
  fbxStatusEl.className = 'import-model-status success';
  log(fbxStatusEl.textContent);
  await loadProjectTree();
  if (sceneData) viewport.rebuildFromScene(sceneData);
  fbxSubmitBtn.disabled = false;
  fbxSubmitBtn.textContent = 'Convert & Import';
  setTimeout(closeFbxModal, 1000);
});

const handleDrop = async (event: DragEvent) => {
  event.preventDefault();
  dropZone.classList.remove('dragover');
  if (handleOsFbxDrop(event)) return;
  if (!sceneData) return;
  const raw = event.dataTransfer?.getData('application/json');
  if (!raw) return;

  let payload: DraggableAssetPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const point = viewport.screenToGroundPoint(x, y);
  if (!point) {
    log('Could not resolve a drop position in the scene.');
    return;
  }

  const library = await getAssetLibrary();
  const entry = resolveLibraryEntry(library, payload.path);
  const asset: SceneAssetInstance = {
    id: nextId('scene'),
    assetId: entry?.id ?? payload.path,
    kind: toSceneAssetKind(entry?.type, payload.kind === 'other' ? 'model' : payload.kind),
    name: (entry?.name ?? payload.name).replace(/\.(glb|gltf)$/i, ''),
    x: point.x,
    y: point.y,
    z: point.z,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    components: ['Transform'],
  };

  sceneData.assets.push(asset);
  viewport.addAssetNode(asset);
  renderHierarchy();
  scheduleSave(true);
  log(`Placed ${asset.name} (${asset.kind}) into the scene.`);
};

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', (event) => {
  if (event.target === dropZone) dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', handleDrop);

projectTreeEl.addEventListener('dragover', (event) => {
  if (!collectFbxFiles(event.dataTransfer).length) return;
  event.preventDefault();
  projectTreeEl.classList.add('dragover');
});
projectTreeEl.addEventListener('dragleave', () => projectTreeEl.classList.remove('dragover'));
projectTreeEl.addEventListener('drop', (event) => {
  projectTreeEl.classList.remove('dragover');
  handleOsFbxDrop(event);
});

$('refreshAssetsBtn').addEventListener('click', () => void loadProjectTree());

$('saveJsonBtn').addEventListener('click', () => scheduleSave(true));

$('playSceneBtn').addEventListener('click', () => {
  void (async () => {
    await Promise.all([flushSceneSave(), flushTrimSave()]);
    window.location.href = '/game.html?dev=1';
  })();
});

$('exportSceneBtn').addEventListener('click', () => {
  if (!sceneData) return;
  const blob = new Blob([JSON.stringify(sceneData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${(sceneData.name || 'scene').toLowerCase().replace(/\s+/g, '-')}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  log('Exported scene JSON.');
});

$('importSceneBtn').addEventListener('click', () => ($('sceneImportInput') as HTMLInputElement).click());
($('sceneImportInput') as HTMLInputElement).addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const json = JSON.parse(await file.text()) as SceneData;
    json.assets = Array.isArray(json.assets) ? json.assets : [];
    json.triggers = Array.isArray(json.triggers) ? json.triggers : [];
    sceneData = json;
    selection = null;
    viewport.rebuildFromScene(sceneData);
    renderHierarchy();
    renderInspector();
    scheduleSave(true);
    log(`Imported file: ${file.name}`);
  } catch {
    log('Invalid JSON file. Please import a valid scene export.');
  }
  input.value = '';
});

$('addTriggerBtn').addEventListener('click', () => {
  if (!sceneData) return;
  const point = viewport.cameraLookGroundPoint() ?? { x: 0, y: 0, z: 0 } as import('@babylonjs/core').Vector3;
  const trigger: SceneTrigger = {
    id: nextId('trigger'),
    type: 'enter_zone',
    label: 'New Trigger',
    x: point.x,
    y: Math.max(point.y, 0),
    z: point.z,
  };
  sceneData.triggers.push(trigger);
  const node = viewport.addTriggerNode(trigger);
  viewport.selectNode(node);
  renderHierarchy();
  scheduleSave(true);
  log('Added trigger to scene. Set Type to Music for ambience.');
});

$('addObjectBtn').addEventListener('click', () => {
  if (!sceneData || selection?.kind !== 'asset') {
    log('Select an object first to duplicate it.');
    return;
  }
  const source = findAsset(selection.id);
  if (!source) return;
  const clone: SceneAssetInstance = {
    ...source,
    id: nextId('scene'),
    x: (source.x ?? 0) + 1.5,
    z: (source.z ?? 0) + 1.5,
  };
  sceneData.assets.push(clone);
  viewport.addAssetNode(clone);
  renderHierarchy();
  scheduleSave(true);
  log(`Duplicated ${clone.name ?? clone.id}.`);
});

const STRUCTURE_DEFAULTS: Record<'wall' | 'pillar' | 'ground', { name: string; scale: { x: number; y: number; z: number }; y: number }> = {
  wall: { name: 'Wall', scale: { x: 4, y: 4, z: 1 }, y: 2 },
  pillar: { name: 'Pillar', scale: { x: 1.2, y: 5, z: 1.2 }, y: 2.5 },
  ground: { name: 'Ground', scale: { x: 20, y: 1, z: 20 }, y: -0.5 },
};

$('addStructureBtn').addEventListener('click', () => {
  if (!sceneData) return;
  const kind = (document.getElementById('addStructureKind') as HTMLSelectElement).value as 'wall' | 'pillar' | 'ground';
  const defaults = STRUCTURE_DEFAULTS[kind];
  const point = viewport.cameraLookGroundPoint() ?? { x: 0, y: 0, z: 0 } as import('@babylonjs/core').Vector3;
  const asset: SceneAssetInstance = {
    id: nextId('struct'),
    assetId: `structure-${kind}`,
    kind,
    name: defaults.name,
    x: point.x,
    y: defaults.y,
    z: point.z,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...defaults.scale },
    components: ['Transform'],
  };
  sceneData.assets.push(asset);
  viewport.addAssetNode(asset);
  renderHierarchy();
  scheduleSave(true);
  log(`Added ${defaults.name} structure to scene.`);
});

// -- Import Model modal: converts a base FBX (+ optional Mixamo animation
// FBX files) into a GLB via the dev server, registers it in the asset
// library, and drops an instance into the scene at the camera look-point.
const importOverlay = $('importModelOverlay') as HTMLDivElement;
const importNameInput = $('importModelName') as HTMLInputElement;
const importBasePathInput = $('importModelBasePath') as HTMLInputElement;
const importAnimList = $('importModelAnimList') as HTMLDivElement;
const importStatusEl = $('importModelStatus') as HTMLDivElement;
const importSubmitBtn = $('importModelSubmitBtn') as HTMLButtonElement;

const addImportAnimRow = (clipName = '') => {
  const row = document.createElement('div');
  row.className = 'import-anim-row';
  row.innerHTML = `
    <input class="anim-name" type="text" placeholder="Clip name (e.g. Walk)" />
    <input class="anim-path" type="text" placeholder="C:\\path\\to\\animation.fbx" />
    <button type="button" class="anim-remove">Remove</button>
  `;
  (row.querySelector('.anim-name') as HTMLInputElement).value = clipName;
  row.querySelector('.anim-remove')!.addEventListener('click', () => row.remove());
  importAnimList.appendChild(row);
};

const resetImportModal = () => {
  importNameInput.value = '';
  importBasePathInput.value = '';
  importAnimList.innerHTML = '';
  importStatusEl.textContent = '';
  importStatusEl.className = 'import-model-status';
  importSubmitBtn.disabled = false;
  importSubmitBtn.textContent = 'Convert & Import';
};

const openImportModal = () => {
  resetImportModal();
  addImportAnimRow('Idle');
  addImportAnimRow('Walk');
  importOverlay.hidden = false;
};

const closeImportModal = () => { importOverlay.hidden = true; };

$('importModelBtn').addEventListener('click', openImportModal);
$('importModelCloseBtn').addEventListener('click', closeImportModal);
$('importModelCancelBtn').addEventListener('click', closeImportModal);
$('importModelAddAnimBtn').addEventListener('click', () => addImportAnimRow());
importOverlay.addEventListener('click', (event) => {
  if (event.target === importOverlay) closeImportModal();
});

importSubmitBtn.addEventListener('click', async () => {
  const name = importNameInput.value.trim();
  const basePath = importBasePathInput.value.trim();
  if (!name || !basePath) {
    importStatusEl.textContent = 'Asset name and base FBX path are required.';
    importStatusEl.className = 'import-model-status error';
    return;
  }
  const animations = Array.from(importAnimList.querySelectorAll('.import-anim-row')).map((row) => ({
    name: (row.querySelector('.anim-name') as HTMLInputElement).value.trim(),
    path: (row.querySelector('.anim-path') as HTMLInputElement).value.trim(),
  })).filter((a) => a.path);

  importSubmitBtn.disabled = true;
  importSubmitBtn.textContent = 'Converting...';
  importStatusEl.className = 'import-model-status';
  importStatusEl.textContent = 'Running Blender conversion, this can take a minute for large models...';

  const result = await importModel(name, basePath, animations);

  if (!result.ok || !result.asset) {
    importStatusEl.textContent = result.error ?? 'Import failed.';
    importStatusEl.className = 'import-model-status error';
    importSubmitBtn.disabled = false;
    importSubmitBtn.textContent = 'Convert & Import';
    if (result.log) log(`Import failed: ${result.error}`);
    return;
  }

  importStatusEl.textContent = `Imported ${result.asset.name}${result.clipNames?.length ? ` with clips: ${result.clipNames.join(', ')}` : ''}.`;
  importStatusEl.className = 'import-model-status success';
  log(`Imported model ${result.asset.name} as ${result.asset.id}.`);

  await loadProjectTree();

  if (sceneData) {
    const point = viewport.cameraLookGroundPoint() ?? { x: 0, y: 0, z: 0 } as import('@babylonjs/core').Vector3;
    const asset: SceneAssetInstance = {
      id: nextId('model'),
      assetId: result.asset.id,
      kind: 'model',
      name: result.asset.name.replace(/\.glb$/, ''),
      x: point.x,
      y: 0,
      z: point.z,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      components: ['Transform'],
    };
    sceneData.assets.push(asset);
    viewport.addAssetNode(asset);
    renderHierarchy();
    scheduleSave(true);
    log(`Placed ${asset.name} into the scene.`);
  }

  importSubmitBtn.disabled = false;
  importSubmitBtn.textContent = 'Convert & Import';
  setTimeout(closeImportModal, 1200);
});

document.querySelectorAll('[data-gizmo-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-gizmo-mode]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    viewport.setGizmoMode(btn.getAttribute('data-gizmo-mode') as 'position' | 'rotation' | 'scale');
  });
});

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
  if (e.ctrlKey || e.metaKey || e.altKey || viewport.isFlying()) return;
  const modes: Record<string, string> = { KeyW: 'position', KeyE: 'rotation', KeyR: 'scale' };
  if (modes[e.code]) {
    document.querySelector<HTMLElement>(`[data-gizmo-mode="${modes[e.code]}"]`)?.click();
  } else if (e.code === 'KeyF') {
    viewport.focusSelected();
  }
});

levelSelectEl.addEventListener('change', () => void loadLevel(levelSelectEl.value));

const toolsMenuBtn = $('toolsMenuBtn');
const toolsMenuDropdown = $('toolsMenuDropdown');
const textureImportInput = $('textureImportInput') as HTMLInputElement;
const textureImportOverlay = $('textureImportOverlay');
const textureImportList = $('textureImportList');
const textureImportStatus = $('textureImportStatus');
const textureImportPickBtn = $('textureImportPickBtn') as HTMLButtonElement;

const setToolsMenuOpen = (open: boolean) => {
  toolsMenuDropdown.hidden = !open;
  toolsMenuBtn.classList.toggle('active', open);
};

toolsMenuBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  setToolsMenuOpen(toolsMenuDropdown.hidden);
});
document.addEventListener('click', () => setToolsMenuOpen(false));
toolsMenuDropdown.addEventListener('click', (event) => event.stopPropagation());

$('animTrimBtn').addEventListener('click', () => {
  setToolsMenuOpen(false);
  void openAnimTrimPanel();
});
$('animTrimCloseBtn').addEventListener('click', () => {
  stopTrimPreview();
  animTrimPanel.hidden = true;
});
animTrimClipSelect.addEventListener('change', () => {
  const clip = selectedTrimClip();
  const asset = trimAssetId ? findAsset(trimAssetId) : undefined;
  if (!clip || !asset) return;
  void glbPathForAsset(asset).then((path) => applyTrimToInputs(clip, path));
});
animTrimStartRange.addEventListener('input', () => onTrimInput('start', Number(animTrimStartRange.value)));
animTrimEndRange.addEventListener('input', () => onTrimInput('end', Number(animTrimEndRange.value)));
animTrimStartNum.addEventListener('change', () => onTrimInput('start', Number(animTrimStartNum.value)));
animTrimEndNum.addEventListener('change', () => onTrimInput('end', Number(animTrimEndNum.value)));
$('animTrimPreviewBtn').addEventListener('click', () => playTrimPreview(false));
$('animTrimLoopBtn').addEventListener('click', () => playTrimPreview(true));
$('animTrimStopBtn').addEventListener('click', () => stopTrimPreview());
$('animTrimResetBtn').addEventListener('click', () => {
  const clip = selectedTrimClip();
  if (!clip) return;
  onTrimInput('start', 0);
  onTrimInput('end', clipFullDurationSec(clip));
  persistTrim(true);
});

const closeTextureImport = () => {
  textureImportOverlay.hidden = true;
  textureImportPickBtn.disabled = false;
};

const openTextureImport = () => {
  setToolsMenuOpen(false);
  textureImportList.innerHTML = '';
  textureImportStatus.textContent = '';
  textureImportStatus.className = 'import-model-status';
  textureImportOverlay.hidden = false;
};

const pickTextureFiles = async (): Promise<File[]> => {
  const picker = (window as Window & {
    showOpenFilePicker?: (opts: unknown) => Promise<Array<{ getFile: () => Promise<File> }>>;
  }).showOpenFilePicker;
  if (typeof picker === 'function') {
    try {
      const handles = await picker({
        multiple: true,
        types: [{
          description: 'Textures',
          accept: {
            'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'],
          },
        }],
      });
      return Promise.all(handles.map((handle) => handle.getFile()));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return [];
    }
  }
  return new Promise((resolve) => {
    const onChange = () => {
      textureImportInput.removeEventListener('change', onChange);
      resolve(Array.from(textureImportInput.files ?? []));
      textureImportInput.value = '';
    };
    textureImportInput.addEventListener('change', onChange);
    textureImportInput.click();
  });
};

const importTextureFiles = async (files: File[]) => {
  const images = files.filter((file) => /\.(jpe?g|png|webp|tif{1,2}|bmp|gif)$/i.test(file.name));
  if (images.length === 0) {
    textureImportStatus.textContent = 'No supported images in that selection.';
    textureImportStatus.className = 'import-model-status error';
    return;
  }
  textureImportPickBtn.disabled = true;
  textureImportStatus.className = 'import-model-status';
  let okCount = 0;
  for (let i = 0; i < images.length; i++) {
    const file = images[i];
    textureImportStatus.textContent = `Compressing ${i + 1} / ${images.length}: ${file.name}`;
    const result = await importTextureFile(file, { maxDim: 1024 });
    const row = document.createElement('li');
    if (result.ok && result.material) {
      okCount += 1;
      const kb = result.bytes ? `${(result.bytes / 1024).toFixed(1)} KB` : 'webp';
      row.textContent = `${result.material.id} ← ${file.name} (${kb})`;
    } else {
      row.textContent = `${file.name}: ${result.error ?? 'failed'}`;
    }
    textureImportList.appendChild(row);
  }
  invalidateAssetLibrary();
  await refreshMaterialOptions();
  await warmupMaterials(viewport.scene);
  await loadProjectTree();
  renderInspector();
  textureImportPickBtn.disabled = false;
  if (okCount > 0) {
    textureImportStatus.textContent = `Imported ${okCount} material${okCount === 1 ? '' : 's'}. Select a mesh and pick it in Inspector → Material.`;
    textureImportStatus.className = 'import-model-status success';
    log(`Imported ${okCount} texture material${okCount === 1 ? '' : 's'}.`);
  } else {
    textureImportStatus.textContent = 'No textures imported. Is npm run dev running, and is ffmpeg installed?';
    textureImportStatus.className = 'import-model-status error';
  }
};

$('addTexturesBtn').addEventListener('click', async () => {
  openTextureImport();
  const files = await pickTextureFiles();
  if (files.length) await importTextureFiles(files);
});
textureImportPickBtn.addEventListener('click', async () => {
  const files = await pickTextureFiles();
  if (files.length) await importTextureFiles(files);
});
$('textureImportCloseBtn').addEventListener('click', closeTextureImport);
$('textureImportCloseFooterBtn').addEventListener('click', closeTextureImport);
textureImportOverlay.addEventListener('click', (event) => {
  if (event.target === textureImportOverlay) closeTextureImport();
});

installAudioUnlock();

(async function init() {
  clipTrims = await loadClipTrims();
  await populateLevelSelect();
  await loadProjectTree();
  await refreshMaterialOptions();
  await loadLevel(currentLevelPath);
  log('Editor ready. Tools → Animation trim to set clip start/end. Tools → Add Textures to import maps.');
})();

// Exposed for debugging in the browser console.
(window as unknown as { phEditor: unknown }).phEditor = { viewport, getSceneData: () => sceneData };
