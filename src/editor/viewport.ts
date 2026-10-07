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
  // W/A/S/D fly controls, moving along the camera's full look direction
  // (including pitch) so looking up/down and pressing forward flies the
  // camera through the scene like Unity's scene view.
  camera.keysUp = [87];
  camera.keysDown = [83];
  camera.keysLeft = [65];
  camera.keysRight = [68];
  camera.attachControl(canvas, true);

  // Only rotate the view while the right mouse button is held, so the left
  // button stays free for object selection and gizmo dragging.
  const mouseInput = camera.inputs.attached.mouse as BABYLON.FreeCameraMouseInput | undefined;
  if (mouseInput) {
    mouseInput.buttons = [2];
  }

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
    return node;
  };

  const addTriggerNode = (trigger: SceneTrigger): BABYLON.Node => {
    const node = createSceneTriggerNode(scene, trigger);
    triggerNodes.set(trigger.id, node);
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
    getAssetNode,
    getTriggerNode,
    selectNode,
    setGizmoMode,
    screenToGroundPoint,
    cameraLookGroundPoint,
    dispose,
  };
};

export type EditorViewport = ReturnType<typeof createEditorViewport>;
