import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders';

import { applyTheme } from '../game/scene';
import {
  createSceneAssetNode,
  createSceneTriggerNode,
  loadSceneFromJson,
  type SceneAssetInstance,
  type SceneData,
  type SceneTrigger,
} from '../game/sceneData';

export type GizmoMode = 'position' | 'rotation' | 'scale';

export type SelectionTarget = {
  kind: 'asset' | 'trigger';
  id: string;
};

export type ViewportCallbacks = {
  onSelect: (target: SelectionTarget | null) => void;
  onTransformChange: (target: SelectionTarget) => void;
};

// Wraps a live Babylon.js scene that mirrors exactly what the game renders
// (via the shared game/sceneData helpers), plus a Unity-style fly camera and
// gizmo-driven object manipulation for the level editor.
export const createEditorViewport = (canvas: HTMLCanvasElement, callbacks: ViewportCallbacks) => {
  const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  const scene = new BABYLON.Scene(engine);

  const camera = new BABYLON.UniversalCamera('editorCamera', new BABYLON.Vector3(0, 8, -22), scene);
  camera.setTarget(new BABYLON.Vector3(0, 0, 0));
  camera.minZ = 0.05;
  camera.maxZ = 600;
  camera.fov = 0.9;
  camera.speed = 0.6;
  camera.angularSensibility = 1900;
  camera.inertia = 0.55;
  // Fly cam: while the right mouse button is held, the pointer is locked and
  // mouse movement looks around; W/A/S/D/Q/E move (Shift = faster).
  camera.inputs.clear();
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const heldKeys = new Set<string>();
  let flying = false;
  const lookSensitivity = 0.003;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 2) return;
    flying = true;
    canvas.focus();
    void canvas.requestPointerLock?.();
  });
  window.addEventListener('pointerup', (e) => {
    if (e.button !== 2 || !flying) return;
    flying = false;
    heldKeys.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  });
  window.addEventListener('blur', () => {
    flying = false;
    heldKeys.clear();
  });
  window.addEventListener('mousemove', (e) => {
    if (!flying) return;
    camera.rotation.y += e.movementX * lookSensitivity;
    camera.rotation.x = Math.max(-1.55, Math.min(1.55, camera.rotation.x + e.movementY * lookSensitivity));
  });
  window.addEventListener('keydown', (e) => {
    if (flying) {
      heldKeys.add(e.code);
      if (e.code.startsWith('Key')) e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => heldKeys.delete(e.code));

  const baseFlySpeed = 12;
  scene.onBeforeRenderObservable.add(() => {
    if (!flying || heldKeys.size === 0) return;
    const dt = engine.getDeltaTime() / 1000;
    const speed = baseFlySpeed * dt * (heldKeys.has('ShiftLeft') || heldKeys.has('ShiftRight') ? 3 : 1);
    const forward = camera.getDirection(BABYLON.Vector3.Forward());
    const right = camera.getDirection(BABYLON.Vector3.Right());
    const move = BABYLON.Vector3.Zero();
    if (heldKeys.has('KeyW')) move.addInPlace(forward);
    if (heldKeys.has('KeyS')) move.subtractInPlace(forward);
    if (heldKeys.has('KeyD')) move.addInPlace(right);
    if (heldKeys.has('KeyA')) move.subtractInPlace(right);
    if (heldKeys.has('KeyE')) move.y += 1;
    if (heldKeys.has('KeyQ')) move.y -= 1;
    if (move.lengthSquared() > 0) camera.position.addInPlace(move.normalize().scale(speed));
  });
  const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.8;
  const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -2, 1), scene);
  sun.position = new BABYLON.Vector3(12, 18, 6);
  sun.intensity = 0.9;

  const utilityLayer = new BABYLON.UtilityLayerRenderer(scene);
  const gizmoManager = new BABYLON.GizmoManager(scene, undefined, utilityLayer);
  gizmoManager.usePointerToAttachGizmos = false;
  gizmoManager.positionGizmoEnabled = true;
  gizmoManager.attachToMesh(null);

  const assetNodes = new Map<string, BABYLON.Node>();
  const triggerNodes = new Map<string, BABYLON.Node>();
  let selected: SelectionTarget | null = null;

  const metadataToTarget = (metadata: { sceneAssetId?: string; sceneTriggerId?: string } | undefined): SelectionTarget | null => {
    if (metadata?.sceneAssetId) return { kind: 'asset', id: metadata.sceneAssetId };
    if (metadata?.sceneTriggerId) return { kind: 'trigger', id: metadata.sceneTriggerId };
    return null;
  };

  // Walks up the parent chain to find the metadata-bearing node: imported
  // model meshes are children of the metadata-carrying root TransformNode,
  // not metadata-bearing themselves.
  const findOwningNode = (node: BABYLON.Node | null): BABYLON.Node | null => {
    let current: BABYLON.Node | null = node;
    while (current) {
      if (metadataToTarget(current.metadata)) return current;
      current = current.parent;
    }
    return null;
  };

  const findTarget = (node: BABYLON.Node | null): SelectionTarget | null => metadataToTarget(findOwningNode(node)?.metadata);

  const notifyTransformChange = () => {
    if (selected) callbacks.onTransformChange(selected);
  };

  let isGizmoDragging = false;
  const wireDragObservers = () => {
    const posGizmo = gizmoManager.gizmos.positionGizmo;
    const rotGizmo = gizmoManager.gizmos.rotationGizmo;
    const scaleGizmo = gizmoManager.gizmos.scaleGizmo;
    [posGizmo, rotGizmo, scaleGizmo].forEach((gizmo) => {
      gizmo?.onDragStartObservable.add(() => { isGizmoDragging = true; });
      gizmo?.onDragEndObservable.add(() => {
        isGizmoDragging = false;
        notifyTransformChange();
      });
    });
  };
  wireDragObservers();

  const selectNode = (node: BABYLON.Node | null) => {
    const owner = findOwningNode(node);
    const target = metadataToTarget(owner?.metadata);
    selected = target;
    gizmoManager.attachToNode(owner ?? null);
    callbacks.onSelect(target);
  };

  scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
    if (pointerInfo.event.button !== 0) return;
    if (isGizmoDragging) return;
    const pick = pointerInfo.pickInfo;
    if (pick?.hit && pick.pickedMesh && findTarget(pick.pickedMesh)) {
      selectNode(pick.pickedMesh);
    } else if (pick?.hit === false) {
      selectNode(null);
    }
  });

  const clearSceneNodes = () => {
    assetNodes.forEach((node) => node.dispose());
    triggerNodes.forEach((node) => node.dispose());
    assetNodes.clear();
    triggerNodes.clear();
  };

  let currentTheme = 'Neon Drift';

  // Ground/walls/pillars are now regular scene assets (kind 'ground'/'wall'/
  // 'pillar'), so rebuilding just means clearing and re-loading from data —
  // no separate procedural arena step is needed anymore.
  const rebuildFromScene = (sceneData: SceneData) => {
    selectNode(null);
    clearSceneNodes();
    currentTheme = sceneData.theme;
    applyTheme(scene, sceneData.theme);
    const created = loadSceneFromJson(scene, sceneData);
    created.forEach((node) => {
      const metadata = node.metadata as { sceneAssetId?: string; sceneTriggerId?: string } | undefined;
      if (metadata?.sceneAssetId) assetNodes.set(metadata.sceneAssetId, node);
      if (metadata?.sceneTriggerId) triggerNodes.set(metadata.sceneTriggerId, node);
    });
  };

  const addAssetNode = (asset: SceneAssetInstance): BABYLON.Node => {
    const node = createSceneAssetNode(scene, asset, currentTheme);
    assetNodes.set(asset.id, node);
    const parent = asset.parentId ? assetNodes.get(asset.parentId) : undefined;
    if (parent && parent !== node) node.parent = parent;
    return node;
  };

  const addTriggerNode = (trigger: SceneTrigger): BABYLON.Node => {
    const node = createSceneTriggerNode(scene, trigger);
    triggerNodes.set(trigger.id, node);
    const parent = trigger.parentId ? assetNodes.get(trigger.parentId) : undefined;
    if (parent) node.parent = parent;
    return node;
  };

  const removeAsset = (id: string) => {
    const node = assetNodes.get(id);
    node?.dispose();
    assetNodes.delete(id);
    if (selected?.kind === 'asset' && selected.id === id) selectNode(null);
  };

  const removeTrigger = (id: string) => {
    const node = triggerNodes.get(id);
    node?.dispose();
    triggerNodes.delete(id);
    if (selected?.kind === 'trigger' && selected.id === id) selectNode(null);
  };

  // Reparents a node while keeping its world transform, so dragging an object
  // under another in the Hierarchy doesn't make it jump in the viewport.
  const reparent = (child: SelectionTarget, parentAssetId: string | null) => {
    const node = child.kind === 'asset' ? assetNodes.get(child.id) : triggerNodes.get(child.id);
    const parent = parentAssetId ? assetNodes.get(parentAssetId) ?? null : null;
    if (!node) return;
    if (node instanceof BABYLON.TransformNode && (parent === null || parent instanceof BABYLON.TransformNode)) {
      if (!node.rotationQuaternion) node.rotationQuaternion = BABYLON.Quaternion.FromEulerVector(node.rotation);
      node.setParent(parent);
      node.rotation = node.rotationQuaternion!.toEulerAngles();
      node.rotationQuaternion = null;
    } else {
      node.parent = parent;
    }
  };

  const getAssetNode = (id: string) => assetNodes.get(id);
  const getTriggerNode = (id: string) => triggerNodes.get(id);

  const setGizmoMode = (mode: GizmoMode) => {
    gizmoManager.positionGizmoEnabled = mode === 'position';
    gizmoManager.rotationGizmoEnabled = mode === 'rotation';
    gizmoManager.scaleGizmoEnabled = mode === 'scale';
    wireDragObservers();
    const node = selected?.kind === 'asset' ? assetNodes.get(selected.id) : selected ? triggerNodes.get(selected.id) : null;
    gizmoManager.attachToNode(node ?? null);
  };

  // Projects a screen-space point onto the ground plane so dropped assets
  // land at a sensible 3D position under the cursor.
  const screenToGroundPoint = (x: number, y: number): BABYLON.Vector3 | null => {
    const groundPick = scene.pick(x, y, (mesh) => mesh.name.toLowerCase() === 'ground');
    if (groundPick?.hit && groundPick.pickedPoint) return groundPick.pickedPoint.clone();

    const ray = scene.createPickingRay(x, y, BABYLON.Matrix.Identity(), camera);
    const plane = BABYLON.Plane.FromPositionAndNormal(new BABYLON.Vector3(0, -0.5, 0), BABYLON.Vector3.Up());
    const distance = ray.intersectsPlane(plane);
    if (distance === null) return null;
    return ray.origin.add(ray.direction.scale(distance));
  };

  const cameraLookGroundPoint = (): BABYLON.Vector3 | null => {
    const forward = camera.getForwardRay(30);
    const plane = BABYLON.Plane.FromPositionAndNormal(new BABYLON.Vector3(0, -0.5, 0), BABYLON.Vector3.Up());
    const distance = forward.intersectsPlane(plane);
    if (distance === null || distance <= 0) return camera.position.add(camera.getDirection(BABYLON.Vector3.Forward()).scale(6));
    return forward.origin.add(forward.direction.scale(distance));
  };

  // Moves the camera so the selected object fills the view, looking at it.
  const focusSelected = () => {
    if (!selected) return;
    const node = selected.kind === 'asset' ? assetNodes.get(selected.id) : triggerNodes.get(selected.id);
    if (!node) return;
    const meshes = [node, ...node.getChildMeshes()].filter((n): n is BABYLON.AbstractMesh => n instanceof BABYLON.AbstractMesh);
    let center: BABYLON.Vector3;
    let radius = 1;
    if (meshes.length > 0) {
      let min = new BABYLON.Vector3(Infinity, Infinity, Infinity);
      let max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
      meshes.forEach((m) => {
        m.computeWorldMatrix(true);
        const box = m.getBoundingInfo().boundingBox;
        min = BABYLON.Vector3.Minimize(min, box.minimumWorld);
        max = BABYLON.Vector3.Maximize(max, box.maximumWorld);
      });
      center = min.add(max).scale(0.5);
      radius = Math.max(0.5, max.subtract(min).length() / 2);
    } else {
      center = (node as BABYLON.TransformNode).getAbsolutePosition().clone();
    }
    const distance = radius / Math.sin(camera.fov / 2) * 1.1;
    const dir = camera.getDirection(BABYLON.Vector3.Forward());
    camera.position = center.subtract(dir.scale(distance));
    camera.setTarget(center);
  };

  engine.runRenderLoop(() => scene.render());

  const resizeObserver = new ResizeObserver(() => engine.resize());
  resizeObserver.observe(canvas);
  window.addEventListener('resize', () => engine.resize());

  const dispose = () => {
    resizeObserver.disconnect();
    engine.dispose();
  };

  return {
    scene,
    engine,
    camera,
    gizmoManager,
    rebuildFromScene,
    addAssetNode,
    addTriggerNode,
    removeAsset,
    removeTrigger,
    reparent,
    getAssetNode,
    getTriggerNode,
    selectNode,
    setGizmoMode,
    screenToGroundPoint,
    cameraLookGroundPoint,
    focusSelected,
    isFlying: () => flying,
    dispose,
  };
};

export type EditorViewport = ReturnType<typeof createEditorViewport>;
