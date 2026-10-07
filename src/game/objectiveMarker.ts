import * as BABYLON from '@babylonjs/core';

export type ObjectiveTarget = {
  x: number;
  y?: number;
  z: number;
  title: string;
  text: string;
};

const ACCENT = new BABYLON.Color3(0.48, 0.94, 0.79);

export const createObjectiveMarker = (scene: BABYLON.Scene) => {
  const root = new BABYLON.TransformNode('objectiveMarker', scene);
  root.setEnabled(false);

  const diamond = BABYLON.MeshBuilder.CreatePolyhedron('objectiveDiamond', { type: 1, size: 0.32 }, scene);
  diamond.parent = root;
  diamond.isPickable = false;
  diamond.checkCollisions = false;
  const material = new BABYLON.StandardMaterial('objectiveDiamondMat', scene);
  material.diffuseColor = ACCENT;
  material.emissiveColor = ACCENT.scale(0.85);
  material.specularColor = BABYLON.Color3.Black();
  diamond.material = material;

  const glow = BABYLON.MeshBuilder.CreateDisc('objectiveGlow', { radius: 0.55, tessellation: 24 }, scene);
  glow.parent = root;
  glow.rotation.x = Math.PI / 2;
  glow.position.y = -0.55;
  glow.isPickable = false;
  glow.checkCollisions = false;
  const glowMat = new BABYLON.StandardMaterial('objectiveGlowMat', scene);
  glowMat.diffuseColor = ACCENT;
  glowMat.emissiveColor = ACCENT.scale(0.55);
  glowMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
  glowMat.alpha = 0.35;
  glowMat.backFaceCulling = false;
  glowMat.disableDepthWrite = true;
  glow.material = glowMat;

  let target: ObjectiveTarget | null = null;
  let elapsed = 0;
  let visible = false;

  const setTarget = (next: ObjectiveTarget | null) => {
    target = next ? { x: next.x, y: next.y, z: next.z, title: next.title, text: next.text } : null;
    visible = Boolean(target);
    root.parent = null;
    root.setEnabled(visible);
    if (target) {
      root.position.set(target.x, target.y ?? 2.15, target.z);
    }
  };

  const hide = () => {
    visible = false;
    root.setEnabled(false);
  };

  const show = () => {
    if (!target) return;
    visible = true;
    root.setEnabled(true);
  };

  const update = (delta: number) => {
    if (!visible || !target) return;
    elapsed += delta;
    const bob = Math.sin(elapsed * 2.4) * 0.16;
    root.position.set(target.x, (target.y ?? 2.15) + bob, target.z);
    diamond.rotation.y += delta * 1.6;
    const pulse = 0.28 + 0.12 * (0.5 + 0.5 * Math.sin(elapsed * 4.2));
    glowMat.alpha = pulse;
    const scale = 0.92 + 0.08 * Math.sin(elapsed * 3.1);
    glow.scaling.set(scale, scale, scale);
  };

  const distanceTo = (x: number, z: number) => {
    if (!target) return 0;
    return Math.hypot(target.x - x, target.z - z);
  };

  const getTarget = () => target;
  const isVisible = () => visible;

  return { setTarget, hide, show, update, distanceTo, getTarget, isVisible };
};

export type ObjectiveMarker = ReturnType<typeof createObjectiveMarker>;
