import * as BABYLON from '@babylonjs/core';

import { capSimultaneousLights } from './modelLoader';

export const importAssetFile = (
  scene: BABYLON.Scene,
  file: File | null,
  onLoad?: (rootNode: BABYLON.TransformNode) => void,
) => {
  if (!file) return null;

  const objectUrl = URL.createObjectURL(file);
  const rootNode = new BABYLON.TransformNode('customPlayer', scene);

  BABYLON.SceneLoader.Append('', objectUrl, scene, () => {
    capSimultaneousLights(scene);
    const imported = scene.meshes.filter((mesh) => mesh.name !== 'ground' && !mesh.name.startsWith('wall-') && !mesh.name.startsWith('enemy'));
    if (imported.length > 0) {
      for (const mesh of imported) {
        if (mesh.parent === null) {
          mesh.parent = rootNode;
        } else if (mesh.parent.name === 'root') {
          mesh.parent = rootNode;
        }
      }

      rootNode.scaling = new BABYLON.Vector3(0.7, 0.7, 0.7);
      rootNode.position = new BABYLON.Vector3(0, 0.6, 1.3);
      rootNode.rotation.y = Math.PI;
    }

    if (onLoad) {
      onLoad(rootNode);
    }

    URL.revokeObjectURL(objectUrl);
  });

  return rootNode;
};
