import * as BABYLON from '@babylonjs/core';

/**
 * Wanted posters for the station gate, hung on the south wall by the turnstiles once the ledger is at SIREN_KILLS
 * (docs/story/ledger.md). Public-safe: a dark silhouette, "questioning", no name, nothing about B3.
 * A plane's readable side faces -Z before rotation, so turning it by pi makes it read from the hall (+Z).
 */
export const createWantedPosters = (scene: BABYLON.Scene, spots: { x: number; y: number; z: number }[]) => {
  const owned: { dispose: () => void }[] = [];
  spots.forEach((spot, index) => {
    const tex = new BABYLON.DynamicTexture(`wanted-poster-${index}`, { width: 256, height: 384 }, scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = '#d9cfb4';
    ctx.fillRect(0, 0, 256, 384);
    ctx.fillStyle = '#7a1a1a';
    ctx.fillRect(0, 0, 256, 74);
    ctx.fillStyle = '#f4ecd6';
    ctx.font = 'bold 54px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('WANTED', 128, 56);
    // The silhouette: head and shoulders of a man in a dark suit, face left empty.
    ctx.fillStyle = '#1d2230';
    ctx.fillRect(36, 92, 184, 170);
    ctx.fillStyle = '#0a0d14';
    ctx.beginPath();
    ctx.arc(128, 158, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(66, 200, 124, 62);
    ctx.fillStyle = '#222';
    ctx.font = 'bold 26px Arial, sans-serif';
    ctx.fillText('FOR QUESTIONING', 128, 298);
    ctx.font = '19px Arial, sans-serif';
    ctx.fillText('Disturbance on the avenue', 128, 326);
    ctx.fillText('Tell any officer', 128, 352);
    tex.update();
    const material = new BABYLON.StandardMaterial(`wanted-poster-mat-${index}`, scene);
    material.diffuseTexture = tex;
    material.emissiveTexture = tex;
    material.emissiveColor = new BABYLON.Color3(0.25, 0.25, 0.25);
    material.specularColor = BABYLON.Color3.Black();
    material.backFaceCulling = true;
    const plane = BABYLON.MeshBuilder.CreatePlane(`wanted-poster-${index}`, { width: 0.62, height: 0.93 }, scene);
    plane.position.set(spot.x, spot.y, spot.z);
    plane.rotation.y = Math.PI;
    plane.material = material;
    plane.isPickable = false;
    owned.push(plane, material, tex);
  });
  return {
    dispose: () => {
      for (const item of owned) item.dispose();
      owned.length = 0;
    },
  };
};
