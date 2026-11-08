/**
 * Animation trace check (quality rule 5), Node + Babylon NullEngine, no browser. Built and run by tools/animCheck.mjs.
 * 1. Physics: a hop, a long fall and a step down run through updateVerticalMotion and the jump poser; the pose must
 *    show the whole time he is off the floor, never while he stands (outside the windup and landing settle), only move
 *    forward, and let go on landing (at once when moving, after the settle when standing).
 * 2. Rig: the player avatar plays the jump clip at the frame each pose asks for, and the walk loop at the rate the
 *    ground speed needs, so the planted foot does not slide.
 * Prints `fail <message>` lines; the runner exits 1 on any.
 */
import * as BABYLON from '@babylonjs/core';
import { readGlbsFromDisk } from '../leakcheck/nodeEnv';

const { createPlayerState, requestJump, updateVerticalMotion, PLAYER_STAND_Y } = await import('../../src/game/player');
const { createJumpPoser, LAND_SETTLE } = await import('../../src/game/jumpPose');
const { createPlayerAvatar } = await import('../../src/game/playerAvatar');
const { JUMP_KEYS, STRIDE_MPS } = await import('../../src/game/stride');

const fails: string[] = [];
const fail = (message: string) => fails.push(message);
const DT = 1 / 60;

// 1. Physics against pose.
const hop = (moving: boolean, label: string) => {
  const player = createPlayerState();
  const poser = createJumpPoser();
  let last = -1;
  let wasAir = false;
  let settle = 0;
  let landed = false;
  requestJump(player);
  for (let frame = 0; frame < 240; frame += 1) {
    updateVerticalMotion(player, DT);
    const pose = poser.step(player, DT, moving);
    if (!player.grounded) {
      wasAir = true;
      if (pose === null) fail(`${label}: no jump pose at frame ${frame} while ${(player.y - PLAYER_STAND_Y).toFixed(2)} m up`);
    } else if (pose !== null && pose < 3 && player.jumpWindup <= 0) {
      fail(`${label}: jump pose ${pose.toFixed(2)} while standing at frame ${frame}`);
    }
    if (pose !== null) {
      if (pose + 1e-6 < last) fail(`${label}: pose went back from ${last.toFixed(2)} to ${pose.toFixed(2)} at frame ${frame}`);
      last = pose;
    }
    if (wasAir && player.grounded) {
      if (!landed) {
        landed = true;
        if (moving && pose !== null) fail(`${label}: landing while moving kept the jump pose`);
      }
      if (pose !== null) settle += DT;
      else break;
    }
  }
  if (!wasAir) fail(`${label}: never left the floor`);
  if (!landed) fail(`${label}: never landed`);
  if (last < 2) fail(`${label}: pose never reached the apex (max ${last.toFixed(2)})`);
  if (settle > LAND_SETTLE + 2 * DT) fail(`${label}: landing settle held ${settle.toFixed(2)} s`);
};
hop(false, 'hop standing');
hop(true, 'hop moving');

{
  // A step down a stair (0.08 s off the floor) keeps walking; a 1 s fall shows the pose.
  const poser = createJumpPoser();
  const p = { grounded: false, velocityY: 0, jumpWindup: 0 };
  for (let t = 0; t < 0.08; t += DT) {
    p.velocityY -= 22 * DT;
    if (poser.step(p, DT, true) !== null) fail('step down: jump pose on a stair step');
  }
  p.grounded = true;
  p.velocityY = 0;
  if (poser.step(p, DT, true) !== null) fail('step down: pose after the step');
  p.grounded = false;
  let shown = false;
  for (let t = 0; t < 1; t += DT) {
    p.velocityY -= 22 * DT;
    shown ||= poser.step(p, DT, false) !== null;
  }
  if (!shown) fail('fall: a 1 s fall never showed the jump pose');
}

// 2. The rig follows.
const engine = new BABYLON.NullEngine();
const scene = new BABYLON.Scene(engine);
new BABYLON.FreeCamera('cam', new BABYLON.Vector3(0, 2, -5), scene);
readGlbsFromDisk();
const avatar = createPlayerAvatar(scene);
avatar.setShown(true);
await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('player rig never loaded')), 60000);
  avatar.whenReady(() => { clearTimeout(timer); resolve(); });
});
const frames = (n: number) => { for (let i = 0; i < n; i += 1) scene.render(); };
const group = (tail: string) => scene.animationGroups.find((g) => g.name.toLowerCase().endsWith(tail.toLowerCase()) && g.isPlaying) ?? null;
const frameOf = (g: BABYLON.AnimationGroup) => g.animatables[0]?.masterFrame ?? NaN;

avatar.setLocomotion(true, true);
avatar.setStride(3.05);
frames(3);
{
  const walk = group('walk');
  const want = 3.05 / STRIDE_MPS.walk;
  if (!walk) fail('walk loop not playing while moving');
  else if (Math.abs(walk.speedRatio - want) > 0.05) fail(`walk plays at ${walk.speedRatio.toFixed(2)}x, 3.05 m/s needs ${want.toFixed(2)}x`);
  if (avatar.locomotion().clip !== 'walk') fail(`locomotion reports ${avatar.locomotion().clip} while walking`);
}
avatar.setStride(null);
avatar.setLocomotion(false, false);
const keys = JUMP_KEYS.jump;
for (const pose of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) {
  avatar.setJumpPose(pose);
  frames(1);
  avatar.setJumpPose(pose);
  const jump = group('jump');
  if (!jump) { fail(`jump clip not playing at pose ${pose}`); break; }
  const i = Math.min(3, Math.floor(pose));
  const seconds = keys[i] + (keys[i + 1] - keys[i]) * (pose - i);
  const fps = jump.targetedAnimations[0]?.animation.framePerSecond ?? 30;
  const want = jump.from + seconds * fps;
  const got = frameOf(jump);
  // One render of lead at most (the clip keeps its clock between scrubs).
  if (!(Math.abs(got - want) <= fps * 0.05 + 1)) fail(`jump pose ${pose}: clip at ${(got / fps).toFixed(2)} s, wanted ${seconds.toFixed(2)} s`);
}
avatar.setJumpPose(null);
avatar.setLocomotion(false, true);
frames(2);
if (avatar.locomotion().clip !== 'idle') fail(`after landing the rig plays ${avatar.locomotion().clip}, not idle`);

for (const message of fails) console.log(`fail ${message}`);
console.log(`anim ${fails.length ? 'FAILED' : 'ok'}`);
scene.dispose();
