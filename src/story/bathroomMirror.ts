import * as BABYLON from '@babylonjs/core';

/**
 * Bathroom mirror for The Return and The Desk.
 * The pass draws the bathroom and Pierce only. An explicit MirrorTexture list is
 * not frustum culled, and the office scene also holds the city under the windows.
 * The texture refreshes every other frame, and only while the camera is inside the
 * bathroom and the glass is in its frustum. From the hall the frustum test alone
 * passes through the walls, and an every-frame pass ran the room at 2-3 FPS on a T4.
 */

const GLASS = { x: 20.22, y: 1.5, z: 28.15 };

const assetId = (mesh: BABYLON.AbstractMesh) =>
  (mesh.metadata as { sceneAssetId?: string } | null)?.sceneAssetId ?? '';

const isBathroom = (mesh: BABYLON.AbstractMesh) => {
  const id = assetId(mesh);
  return id === 'floor-bath' || id.startsWith('bath-');
};

/** Mirror pass size. The glass is 1.24 m wide, so 512 holds up even close to it. */
const SIZE = 512;
/** Margin past the bathroom floor that still counts as inside (the doorway). */
const ROOM_PAD = 0.6;
/** Without a bathroom floor, the camera must be this close to the glass. */
const NEAR_GLASS = 6;

const shown = (mesh: BABYLON.AbstractMesh) =>
  !mesh.isDisposed() && mesh.isEnabled() && mesh.isVisible && mesh.getTotalVertices() > 0;

export type BathroomMirror = {
  dispose: () => void;
};

export const mountBathroomMirror = (scene: BABYLON.Scene, name: string): BathroomMirror => {
  const frame = BABYLON.MeshBuilder.CreateBox(`${name}-frame`, { width: 0.04, height: 0.98, depth: 1.4 }, scene);
  frame.position.set(GLASS.x + 0.025, GLASS.y, GLASS.z);
  frame.isPickable = false;
  frame.checkCollisions = false;
  const frameMat = new BABYLON.StandardMaterial(`${name}-frame-mat`, scene);
  frameMat.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.055);
  frameMat.specularColor = new BABYLON.Color3(0.55, 0.56, 0.58);
  frame.material = frameMat;

  const glass = BABYLON.MeshBuilder.CreatePlane(name, {
    width: 1.24,
    height: 0.84,
    sideOrientation: BABYLON.Mesh.DOUBLESIDE,
  }, scene);
  glass.position.set(GLASS.x, GLASS.y, GLASS.z);
  glass.rotation.y = -Math.PI / 2;
  glass.isPickable = false;
  glass.checkCollisions = false;
  glass.computeWorldMatrix(true);
  const bounds = glass.getBoundingInfo();
  const min = bounds.minimum.clone();
  const max = bounds.maximum.clone();
  // Local Z is the thin axis. A little depth keeps the frustum test stable.
  min.z -= 0.25;
  max.z += 0.25;
  glass.setBoundingInfo(new BABYLON.BoundingInfo(min, max, glass.getWorldMatrix()));
  glass.freezeWorldMatrix();

  const glassMat = new BABYLON.StandardMaterial(`${name}-mat`, scene);
  glassMat.disableLighting = true;
  glassMat.diffuseColor = BABYLON.Color3.Black();
  glassMat.specularColor = new BABYLON.Color3(0.22, 0.22, 0.24);
  glassMat.specularPower = 64;
  glassMat.emissiveColor = BABYLON.Color3.Black();
  // 8-bit is enough at level 0.45, and half the bandwidth of a half-float target.
  const tex = new BABYLON.MirrorTexture(
    `${name}-tex`,
    { width: SIZE, height: SIZE },
    scene,
    false,
    BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE,
  );
  tex.mirrorPlane = BABYLON.Plane.FromPositionAndNormal(glass.position, new BABYLON.Vector3(1, 0, 0));
  tex.level = 0.45;
  tex.renderParticles = false;
  tex.renderSprites = false;
  glassMat.reflectionTexture = tex;
  glass.material = glassMat;

  const bathroom: BABYLON.AbstractMesh[] = [];
  for (const mesh of scene.meshes) {
    if (isBathroom(mesh)) bathroom.push(mesh);
  }

  const floor = bathroom.find((mesh) => assetId(mesh) === 'floor-bath') ?? null;
  let room: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  if (floor) {
    floor.computeWorldMatrix(true);
    const box = floor.getBoundingInfo().boundingBox;
    room = {
      minX: box.minimumWorld.x - ROOM_PAD,
      maxX: box.maximumWorld.x + ROOM_PAD,
      minZ: box.minimumWorld.z - ROOM_PAD,
      maxZ: box.maximumWorld.z + ROOM_PAD,
    };
  }

  const cameraInRoom = () => {
    const camera = scene.activeCamera;
    if (!camera) return false;
    const at = camera.globalPosition;
    if (room) return at.x >= room.minX && at.x <= room.maxX && at.z >= room.minZ && at.z <= room.maxZ;
    return Math.hypot(at.x - GLASS.x, at.z - GLASS.z) < NEAR_GLASS;
  };

  const pushNode = (next: BABYLON.AbstractMesh[], node: BABYLON.Node | null) => {
    if (!node) return;
    for (const mesh of node.getChildMeshes(false)) {
      if (shown(mesh)) next.push(mesh);
    }
  };

  const collect = () => {
    const next: BABYLON.AbstractMesh[] = [];
    for (const mesh of bathroom) {
      if (shown(mesh)) next.push(mesh);
    }
    pushNode(next, scene.getTransformNodeByName('playerAvatarRoot'));
    pushNode(next, scene.getTransformNodeByName('pistolRoot'));
    pushNode(next, scene.getTransformNodeByName('phoneRoot'));
    return next;
  };

  let list = collect();
  tex.renderList = list;

  const sync = () => {
    const planes = scene.frustumPlanes;
    const seen = planes.length > 0 && cameraInRoom() && glass.isInFrustum(planes);
    if (seen) {
      const next = collect();
      let same = next.length === list.length;
      for (let i = 0; same && i < next.length; i += 1) same = next[i] === list[i];
      if (!same) {
        list = next;
        tex.renderList = list;
      }
    }
    const rate = seen ? 2 : 0;
    if (tex.refreshRate !== rate) tex.refreshRate = rate;
  };

  tex.refreshRate = 0;
  const observer = scene.onBeforeRenderObservable.add(sync);

  return {
    dispose: () => {
      scene.onBeforeRenderObservable.remove(observer);
      tex.dispose();
      if (!frame.isDisposed()) frame.dispose(false, true);
      if (!glass.isDisposed()) glass.dispose(false, true);
    },
  };
};
