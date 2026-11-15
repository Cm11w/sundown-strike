// Movement controller shared by player and bots: acceleration + friction
// (not instant velocity), crouch, jump, gravity, fall damage, lean, footsteps.
// Axis-separated AABB sliding against map solids, so agents hug walls.
// MICRO: high friction (12/s) stops you in ~0.3s — counter-strafing works:
// tap the opposite key and you are accurate almost instantly.
import { V3, clamp } from './mathx.js';
import { MOVEMENT, WEAPONS } from './config.js';
import { SOLIDS, MAP } from './mapdata.js';
import { currentWeapon, pushEvent } from './state.js';
import { killAgent } from './combat.js';

// Does the agent's box at `pos` (feet) with height `h` overlap any solid?
function collides(pos, h, r) {
  const minX = pos[0] - r, maxX = pos[0] + r;
  const minY = pos[1], maxY = pos[1] + h;
  const minZ = pos[2] - r, maxZ = pos[2] + r;
  for (let i = 0; i < SOLIDS.length; i++) {
    const b = SOLIDS[i];
    if (maxX > b.min[0] && minX < b.max[0] && maxY > b.min[1] && minY < b.max[1] && maxZ > b.min[2] && minZ < b.max[2]) {
      return true;
    }
  }
  return false;
}

// Move along one axis with binary-search backoff when blocked. Returns the
// distance actually travelled.
function moveAxis(a, axis, delta, h, r) {
  if (delta === 0) return 0;
  const start = a.pos[axis];
  a.pos[axis] = start + delta;
  if (!collides(a.pos, h, r)) return delta;
  // Binary search the furthest free position.
  let lo = 0, hi = 1;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    a.pos[axis] = start + delta * mid;
    if (collides(a.pos, h, r)) hi = mid; else lo = mid;
  }
  a.pos[axis] = start + delta * lo;
  return delta * lo;
}

export function updateMovement(s, a, input, dt) {
  // input: {f, s, jump, crouch, walk, sprint, lean} — f/s in [-1, 1].
  const w = currentWeapon(a) ? WEAPONS[currentWeapon(a).id] : WEAPONS.knife;
  const speedMul = w.speed;
  let maxSpeed;
  if (input.crouch) maxSpeed = MOVEMENT.crouchSpeed;
  else if (input.walk) maxSpeed = MOVEMENT.walkSpeed;
  else if (input.sprint) maxSpeed = MOVEMENT.sprintSpeed;
  else maxSpeed = MOVEMENT.runSpeed;
  maxSpeed *= speedMul;

  // Wish direction in world space from yaw.
  const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
  // Forward = (-sin yaw, 0, -cos yaw); right = (cos yaw, 0, -sin yaw)... check:
  // right = forward x up? Use right = (-cos yaw * -1?) — derive: right is
  // forward rotated -90 deg: right = ( -cos(yaw)... ) — verify with yaw=0:
  // forward (0,0,-1), right must be (1,0,0). right = (cy, 0, -sy) gives (1,0,0). Good.
  let wx = -sy * input.f + cy * input.s;
  let wz = -cy * input.f - sy * input.s;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) { wx /= wl; wz /= wl; }
  const wishX = wx * maxSpeed, wishZ = wz * maxSpeed;

  const accel = a.onGround ? MOVEMENT.accel : MOVEMENT.airAccel;
  if (a.onGround) {
    // Ground: accelerate toward the wish velocity; friction when idle.
    const dvx = wishX - a.vel[0], dvz = wishZ - a.vel[2];
    const dl = Math.hypot(dvx, dvz);
    const step = (wl > 0.01 ? accel : MOVEMENT.friction * maxSpeed * 0.9) * dt;
    if (dl <= step) { a.vel[0] = wishX; a.vel[2] = wishZ; }
    else { a.vel[0] += (dvx / dl) * step; a.vel[2] += (dvz / dl) * step; }
  } else {
    // Air: limited steering, no friction.
    const dvx = wishX - a.vel[0], dvz = wishZ - a.vel[2];
    const dl = Math.hypot(dvx, dvz);
    const step = accel * dt;
    if (dl > 0) {
      const k = Math.min(1, step / dl);
      a.vel[0] += dvx * k; a.vel[2] += dvz * k;
    }
  }

  // Jump.
  if (input.jump && a.onGround && !input.crouch) {
    a.vel[1] = MOVEMENT.jumpVel;
    a.onGround = false;
    pushEvent(s, { type: 'jump', agent: a });
  }

  // Gravity.
  a.vel[1] -= MOVEMENT.gravity * dt;
  if (a.vel[1] < -30) a.vel[1] = -30;

  // Crouch transitions.
  a.crouching = !!input.crouch;
  const targetCrouch = a.crouching ? 1 : 0;
  a.crouchAmt += clamp(targetCrouch - a.crouchAmt, -dt * 8, dt * 8);
  const h = MOVEMENT.height + (MOVEMENT.heightCrouch - MOVEMENT.height) * a.crouchAmt;
  const r = MOVEMENT.radius;

  // Integrate with collision.
  const dx = a.vel[0] * dt, dz = a.vel[2] * dt, dy = a.vel[1] * dt;
  const movedX = moveAxis(a, 0, dx, h, r);
  const movedZ = moveAxis(a, 2, dz, h, r);
  if (Math.abs(movedX) < Math.abs(dx) * 0.5) a.vel[0] = 0;
  if (Math.abs(movedZ) < Math.abs(dz) * 0.5) a.vel[2] = 0;
  const prevVy = a.vel[1];
  const movedY = moveAxis(a, 1, dy, h, r);
  if (a.pos[1] <= 0) {
    // Landing.
    if (!a.onGround && prevVy < -MOVEMENT.fallSafe) {
      const dmg = Math.round(((-prevVy) - MOVEMENT.fallSafe) * MOVEMENT.fallScale);
      if (dmg > 0) {
        a.hp -= dmg;
        pushEvent(s, { type: 'damaged', victim: a, from: null, dmg, fall: true });
        if (a.hp <= 0) killAgent(s, null, a, 'fall', 'limb');
      }
    }
    a.pos[1] = 0;
    a.vel[1] = 0;
    a.onGround = true;
  } else if (Math.abs(movedY) < Math.abs(dy) * 0.5 && dy < 0) {
    a.vel[1] = 0;
    a.onGround = true;
  } else if (dy > 0 && Math.abs(movedY) < Math.abs(dy) * 0.5) {
    a.vel[1] = 0; // bonked head
  } else {
    a.onGround = false;
  }

  // Clamp to the map bounds.
  a.pos[0] = clamp(a.pos[0], MAP.bounds.minX + r, MAP.bounds.maxX - r);
  a.pos[2] = clamp(a.pos[2], MAP.bounds.minZ + r, MAP.bounds.maxZ - r);

  // Speed fraction for the spread model (0 = still, 1 = full run).
  const hSpeed = Math.hypot(a.vel[0], a.vel[2]);
  a.speedFrac = clamp(hSpeed / MOVEMENT.runSpeed, 0, 1.25);
  a.moving = hSpeed > 0.5;

  // Lean.
  a.leanTarget = input.lean || 0;
  a.lean += clamp(a.leanTarget - a.lean, -dt * 6, dt * 6);

  // Weapon bob + footsteps.
  if (a.onGround && hSpeed > 0.5) {
    a.bobPhase += dt * hSpeed * 1.6;
    a.stepAcc += hSpeed * dt;
    const stepLen = a.crouching ? 1.6 : 2.3;
    if (a.stepAcc >= stepLen) {
      a.stepAcc = 0;
      const loud = input.sprint ? 1.0 : input.walk ? 0.0 : 0.55;
      if (loud > 0) pushEvent(s, { type: 'step', agent: a, loud });
    }
  }
}

// Spawn an agent at a spawn point: pos [x, z, yaw].
export function placeAtSpawn(a, spawn) {
  a.pos[0] = spawn[0]; a.pos[1] = 0; a.pos[2] = spawn[1];
  a.vel[0] = 0; a.vel[1] = 0; a.vel[2] = 0;
  a.yaw = spawn[2]; a.pitch = 0;
  a.hp = 100; a.alive = true;
  a.crouchAmt = 0; a.crouching = false; a.lean = 0;
  a.recoil[0] = 0; a.recoil[1] = 0; a.bloom = 0; a.patternIdx = 0;
  a.cooldown = 0; a.reloadT = 0; a.switchT = 0; a.ads = 0; a.adsTarget = 0;
  a.flashT = 0; a.flashPeak = 0; a.action = null; a.damageTaken = {};
  a.deadT = 0;
}
