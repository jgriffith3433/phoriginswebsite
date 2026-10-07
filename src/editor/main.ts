import { createEditorViewport, type SelectionTarget } from './viewport';
import { fetchProjectTree, saveJsonFile, importModel, importFbxFile, importTextureFile, type FsTreeNode } from './fsApi';
import { renderProjectTree, inferAssetKind, type DraggableAssetPayload } from './projectPanel';
import { getAssetLibrary, invalidateAssetLibrary, resolveLibraryEntry } from '../game/modelLoader';
import { LEVEL_LIBRARY_PATH } from '../game/levels';
import { applyMaterialToMesh, getMaterialDefs, invalidateMaterials, parseUvScale, resolveMeshUvScale, warmupMaterials, type MaterialDef } from '../game/materials';
import { toSceneAssetKind, type SceneAssetInstance, type SceneData, type SceneTrigger } from '../game/sceneData';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $('viewportCanvas') as HTMLCanvasElement;
const dropZone = $('sceneDropZone') as HTMLDivElement;
const projectTreeEl = $('projectTree') as HTMLDivElement;
const hierarchyTreeEl = $('hierarchyTree') as HTMLDivElement;
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

let currentLevelPath = '/levels/apex-peak.json';
let sceneData: SceneData | null = null;
let selection: SelectionTarget | null = null;
let saveTimer: number | undefined;
let materialOptions: MaterialDef[] = [];

const viewport = createEditorViewport(canvas, {
  onSelect: (target) => {
    selection = target;
    renderHierarchy();
    renderInspector();
  },
  onTransformChange: (target) => {
    commitNodeTransformToData(target);
    renderInspector();
    scheduleSave();
  },
});

const findAsset = (id: string): SceneAssetInstance | undefined => sceneData?.assets.find((a) => a.id === id);
const findTrigger = (id: string): SceneTrigger | undefined => sceneData?.triggers.find((t) => t.id === id);

const commitNodeTransformToData = (target: SelectionTarget) => {
  if (!sceneData) return;
  if (target.kind === 'asset') {
    const asset = findAsset(target.id);
    const node = viewport.getAssetNode(target.id);
    if (!asset || !node) return;
    const transformNode = node as import('@babylonjs/core').TransformNode;
    if (transformNode.position) {
      asset.x = transformNode.position.x;
      asset.y = transformNode.position.y;
      asset.z = transformNode.position.z;
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
    trigger.x = transformNode.position.x;
    trigger.y = transformNode.position.y;
    trigger.z = transformNode.position.z;
  }
};

const scheduleSave = (immediate = false) => {
  if (!sceneData) return;
  window.clearTimeout(saveTimer);
  const run = async () => {
    saveStatusEl.textContent = 'Saving…';
    const ok = await saveJsonFile(currentLevelPath, sceneData);
    saveStatusEl.textContent = ok ? 'Saved' : 'Save failed (is npm run dev active?)';
    log(ok ? `Saved ${currentLevelPath}` : `Failed to save ${currentLevelPath}`);
  };
  if (immediate) {
    void run();
  } else {
    saveTimer = window.setTimeout(run, 450);
  }
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

const renderInspector = () => {
  inspectorEl.innerHTML = '';

  if (!selection || !sceneData) {
    inspectorEl.innerHTML = `
      <div class="inspector-row">
        <div class="label"><span>Selected</span></div>
        <div class="value">Nothing selected. Click an object in the viewport or Hierarchy, or drag an asset from Project into the scene.</div>
      </div>`;
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
      renderVectorRow('Position', { x: asset.x ?? 0, y: asset.y ?? 0, z: asset.z ?? 0 }, (next) =>
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

  inspectorEl.appendChild(
    renderVectorRow('Position', { x: trigger.x ?? 0, y: trigger.y ?? 0, z: trigger.z ?? 0 }, (next) => {
      trigger.x = next.x;
      trigger.y = next.y;
      trigger.z = next.z;
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
      tag: 'trigger',
      parentId: trigger.parentId,
    })),
  ];
  const assetIds = new Set(sceneData.assets.map((a) => a.id));
  const childrenOf = new Map<string | undefined, HierarchyEntry[]>();
  entries.forEach((entry) => {
    const key = entry.parentId && assetIds.has(entry.parentId) ? entry.parentId : undefined;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), entry]);
  });

  const renderLevel = (parentKey: string | undefined, depth: number, visited: Set<string>) => {
    (childrenOf.get(parentKey) ?? []).forEach((entry) => {
      if (visited.has(entry.target.id)) return;
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
  window.location.href = '/game.html?dev=1';
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
  viewport.addTriggerNode(trigger);
  renderHierarchy();
  scheduleSave(true);
  log('Added trigger to scene.');
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

(async function init() {
  await populateLevelSelect();
  await loadProjectTree();
  await refreshMaterialOptions();
  await loadLevel(currentLevelPath);
  log('Editor ready. Tools → Add Textures to import maps. Select a mesh to assign a material.');
})();

// Exposed for debugging in the browser console.
(window as unknown as { phEditor: unknown }).phEditor = { viewport, getSceneData: () => sceneData };
