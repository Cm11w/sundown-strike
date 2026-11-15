// Hitscan combat. Rays are tested against the same AABBs movement collides
// with, plus per-agent hit spheres — a shot can never hit what the eye cannot
// see, and registration is deterministic and testable in Node. Hit zones:
// head (r=0.24, headshot multiplier, helmet halves it), chest (r=0.34),
// pelvis (r=0.30), limb (inside the body box, 75% damage). Armor lerps body
// damage from 50% to 100% by the weapon's armor penetration.
import { V3, rayAabb, raySphere, clamp, DEG } from './mathx.js';
import { WEAPONS, RECOIL_PATTERNS, MOVEMENT, ECONOMY } from './config.js';
import { SOLIDS } from './mapdata.js';
import { currentWeapon, pushEvent, pushKillfeed } from './state.js';

const _dir = [0, 0, 0];
const _eye = [0, 0, 0];
const _to = [0, 0, 0];

export function eyeHeight(a) {
  return MOVEMENT.eyeStanding + (MOVEMENT.eyeCrouch - MOVEMENT.eyeStanding) * a.crouchAmt;
}
export function bodyHeight(a) {
  return MOVEMENT.height + (MOVEMENT.heightCrouch - MOVEMENT.height) * a.crouchAmt;
}
export function eyePos(out, a) {
  out[0] = a.pos[0]; out[1] = a.pos[1] + eyeHeight(a); out[2] = a.pos[2];
  return out;
}
// Aim direction from yaw/pitch + live recoil offset. yaw=0 faces -Z (north);
// yaw grows counter-clockwise seen from above.
export function aimDir(out, a) {
  const yaw = a.yaw + a.recoil[1] * DEG;
  const pitch = a.pitch + a.recoil[0] * DEG;
  const cp = Math.cos(pitch);
  out[0] = -Math.sin(yaw) * cp;
  out[1] = Math.sin(pitch);
  out[2] = -Math.cos(yaw) * cp;
  return out;
}

// Distance from origin along dir to the nearest solid, or Infinity.
export function rayWorld(ox, oy, oz, dx, dy, dz, tMax) {
  let best = tMax;
  for (let i = 0; i < SOLIDS.length; i++) {
    const t = rayAabb(ox, oy, oz, dx, dy, dz, SOLIDS[i], best);
    if (t < best) best = t;
  }
  // Ground plane y=0.
  if (dy < -1e-9) {
    const t = -oy / dy;
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

// Line of sight between two points, ignoring agents. Used by bots (vision,
// hearing occlusion, flash checks) and by frag damage.
export function hasLineOfSight(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const t = rayWorld(ax, ay, az, dx / len, dy / len, dz / len, len);
  return t >= len - 0.05;
}

// Smoke blocks vision: the segment between the points passes through any
// active smoke sphere (with a small margin).
export function smokeBlocks(s, ax, ay, az, bx, by, bz) {
  for (const sm of s.smokes) {
    if (s.time > sm.until) continue;
    // Closest approach of the segment to the smoke centre.
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const apx = sm.pos[0] - ax, apy = sm.pos[1] - ay, apz = sm.pos[2] - az;
    const ab2 = abx * abx + aby * aby + abz * abz || 1;
    let t = (apx * abx + apy * aby + apz * abz) / ab2;
    t = clamp(t, 0, 1);
    const cx = ax + abx * t - sm.pos[0], cy = ay + aby * t - sm.pos[1], cz = az + abz * t - sm.pos[2];
    if (cx * cx + cy * cy + cz * cz < (sm.radius - 0.3) * (sm.radius - 0.3)) return true;
  }
  return false;
}

export function canSee(s, a, b) {
  eyePos(_eye, a);
  const by = b.pos[1] + bodyHeight(b) * 0.7;
  if (!hasLineOfSight(_eye[0], _eye[1], _eye[2], b.pos[0], by, b.pos[2])) return false;
  return !smokeBlocks(s, _eye[0], _eye[1], _eye[2], b.pos[0], by, b.pos[2]);
}

// Test one ray against one agent's hit spheres. Returns {t, part} or null.
function rayAgent(ox, oy, oz, dx, dy, dz, target, tMax) {
  const h = bodyHeight(target);
  const x = target.pos[0], y = target.pos[1], z = target.pos[2];
  // Head sphere.
  let t = raySphere(ox, oy, oz, dx, dy, dz, x, y + h - 0.2, z, 0.24, tMax);
  if (t !== Infinity) return { t, part: 'head' };
  t = raySphere(ox, oy, oz, dx, dy, dz, x, y + h * 0.65, z, 0.34, tMax);
  if (t !== Infinity) return { t, part: 'chest' };
  t = raySphere(ox, oy, oz, dx, dy, dz, x, y + h * 0.4, z, 0.3, tMax);
  if (t !== Infinity) return { t, part: 'pelvis' };
  // Limb: inside the body box.
  const bt = rayAabb(ox, oy, oz, dx, dy, dz,
    { min: [x - 0.35, y, z - 0.35], max: [x + 0.35, y + h, z + 0.35] }, tMax);
  if (bt !== Infinity) return { t: bt, part: 'limb' };
  return null;
}

// Full shot resolution: nearest of (world, any living enemy agent).
// Friendly fire is OFF: teammates are transparent to bullets.
export function raycastShot(s, shooter, dir, tMax) {
  eyePos(_eye, shooter);
  const ox = _eye[0], oy = _eye[1], oz = _eye[2];
  const wallT = rayWorld(ox, oy, oz, dir[0], dir[1], dir[2], tMax);
  let best = null, bestT = wallT;
  for (const a of s.agents) {
    if (!a.alive || a === shooter || a.squad === shooter.squad) continue;
    const hit = rayAgent(ox, oy, oz, dir[0], dir[1], dir[2], a, bestT);
    if (hit && hit.t < bestT) { bestT = hit.t; best = { agent: a, part: hit.part, t: hit.t }; }
  }
  const px = ox + dir[0] * bestT, py = oy + dir[1] * bestT, pz = oz + dir[2] * bestT;
  if (best) return { ...best, point: [px, py, pz], hitWall: false };
  return { agent: null, part: null, t: bestT, point: [px, py, pz], hitWall: bestT < tMax };
}

export function damageAtDistance(w, dist) {
  if (dist <= w.falloffNear) return w.damage;
  if (dist >= w.falloffFar) return w.damage * w.falloffFrac;
  const f = (dist - w.falloffNear) / (w.falloffFar - w.falloffNear);
  return w.damage * (1 + (w.falloffFrac - 1) * f);
}

// Spread in degrees for the shooter's current state. This is the MICRO core:
// still + crouched + ADS is a laser; sprinting + airborne is a hose. The
// crosshair gap in the HUD is computed from this same value, so it never lies.
export function spreadDeg(a, w) {
  if (w.id === 'knife') return 0;
  let sp = w.spread;
  sp *= a.crouching ? w.crouchBonus : 1;
  sp *= 1 - (1 - w.adsBonus) * a.ads;
  sp += a.bloom;
  sp += w.movePenalty * a.speedFrac;
  if (!a.onGround) sp += w.airPenalty;
  if (w.scopedOnly && a.ads < 0.7) sp = Math.max(sp, w.unscopedSpread);
  return sp;
}

// Apply one gaussian spread sample to a direction (in place, out param).
export function applySpread(out, dir, spreadDegVal, rng) {
  if (spreadDegVal <= 0.001) { V3.copy(out, dir); return out; }
  const s = spreadDegVal * DEG;
  // Build a perpendicular basis.
  let rx = -dir[2], ry = 0, rz = dir[0];
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  const ux = dir[1] * rz - dir[2] * ry, uy = dir[2] * rx - dir[0] * rz, uz = dir[0] * ry - dir[1] * rx;
  const gx = rng.gauss() * s, gy = rng.gauss() * s;
  out[0] = dir[0] + rx * gx + ux * gy;
  out[1] = dir[1] + ry * gx + uy * gy;
  out[2] = dir[2] + rz * gx + uz * gy;
  return V3.norm(out, out);
}

// Fire the currently equipped gun once (one trigger pull = one shot, or one
// pellet cloud for the shotgun). Returns the list of hit results.
export function fireWeapon(s, shooter) {
  const ws = currentWeapon(shooter);
  if (!ws) return [];
  const w = WEAPONS[ws.id];
  if (ws.mag <= 0 || shooter.reloadT > 0 || shooter.cooldown > 0 || shooter.switchT > 0) return [];
  if (shooter.action) return []; // planting/defusing: hands are busy
  ws.mag -= 1;
  shooter.shotsFired += 1;
  shooter.cooldown = 60 / w.rpm;
  if (w.kind === 'bolt' || w.kind === 'pump') shooter.cooldown = Math.max(shooter.cooldown, 0.55);
  // Recoil: deterministic pattern kick + jitter. Part of the kick lands
  // permanently on pitch/yaw (the player pulls down to control the spray);
  // the rest is a decaying offset.
  const pattern = RECOIL_PATTERNS[ws.id] || [[w.recoil, 0]];
  const kick = pattern[Math.min(shooter.patternIdx, pattern.length - 1)];
  shooter.patternIdx += 1;
  const jitP = s.rng.gauss() * w.recoil * 0.18;
  const jitY = s.rng.gauss() * w.recoilYaw * 0.6;
  const kp = kick[0] + jitP, ky = kick[1] + jitY;
  shooter.recoil[0] += kp * 0.55;
  shooter.recoil[1] += ky * 0.55;
  shooter.pitch = clamp(shooter.pitch + kp * 0.45 * DEG, -1.45, 1.45);
  shooter.yaw += ky * 0.45 * DEG;
  shooter.bloom = Math.min(shooter.bloom + w.bloom, 6);
  shooter.muzzleT = 0.05;
  shooter.moving = true;
  const spread = spreadDeg(shooter, { ...w, id: ws.id });
  const hits = [];
  aimDir(_dir, shooter);
  const pellets = w.pellets;
  for (let p = 0; p < pellets; p++) {
    const d = [0, 0, 0];
    applySpread(d, _dir, pellets > 1 ? Math.max(spread, w.spread * 1.6) : spread, s.rng);
    const res = raycastShot(s, shooter, d, w.range);
    // Tracer start: the shooter's muzzle, approximated at eye level forward.
    const start = [0, 0, 0];
    eyePos(start, shooter);
    V3.madd(start, start, d, 0.6);
    s.tracers.push({ from: start, to: res.point, t: 0, life: 0.07, shooter });
    if (res.agent) {
      const dmg = computeDamage(w, res, shooter);
      applyDamage(s, shooter, res.agent, dmg, res.part, ws.id);
      hits.push(res);
    } else if (res.hitWall) {
      s.decals.push({ pos: res.point, t: 0, life: 6 });
      pushEvent(s, { type: 'impact', pos: res.point, dist: res.t, dir: d });
    }
  }
  pushEvent(s, { type: 'shot', agent: shooter, weapon: ws.id, pellets });
  // Recoil pattern resets when the trigger is released (tracked in update).
  return hits;
}

export function computeDamage(w, res, shooter) {
  let dmg = damageAtDistance(w, res.t);
  const target = res.agent;
  if (res.part === 'head') {
    let hs = w.hs;
    if (target.helmet) hs = 1 + (hs - 1) * 0.5; // helmet halves the bonus
    dmg *= hs;
  } else if (res.part === 'limb') {
    dmg *= 0.75;
  }
  if (target.armor && res.part !== 'head') {
    dmg *= 0.5 + 0.5 * w.armorPen;
  } else if (target.armor && res.part === 'head' && target.helmet) {
    dmg *= 0.5 + 0.5 * w.armorPen;
  }
  return Math.max(1, Math.round(dmg));
}

export function applyDamage(s, attacker, victim, dmg, part, weaponId) {
  if (!victim.alive) return;
  victim.hp -= dmg;
  victim.lastHitBy = attacker ? attacker.id : 0;
  victim.lastHitTime = s.time;
  if (attacker) {
    attacker.damage += dmg;
    attacker.shotsHit += 1;
    if (part === 'head') attacker.headshots += 1;
    victim.damageTaken[attacker.id] = (victim.damageTaken[attacker.id] || 0) + dmg;
    pushEvent(s, { type: 'hitmark', attacker, victim, part, killed: victim.hp <= 0 });
  }
  pushEvent(s, { type: 'damaged', victim, from: attacker ? attacker.pos : null, dmg });
  if (victim.hp <= 0) killAgent(s, attacker, victim, weaponId, part);
}

export function killAgent(s, attacker, victim, weaponId, part) {
  victim.alive = false;
  victim.hp = 0;
  victim.deaths += 1;
  victim.deadT = 0;
  victim.action = null;
  victim.flashT = 0;
  if (victim.hasBomb) {
    victim.hasBomb = false;
    s.bombDropped = [victim.pos[0], victim.pos[1] + 0.2, victim.pos[2]];
    pushEvent(s, { type: 'bombDropped', pos: s.bombDropped });
  }
  if (attacker && attacker !== victim) {
    attacker.kills += 1;
    attacker.roundKills += 1;
    const reward = weaponId === 'knife' ? ECONOMY.knifeReward : ECONOMY.killReward;
    attacker.money = Math.min(ECONOMY.maxMoney, attacker.money + reward);
    // Assist: the biggest contributor besides the killer, if >= 40 damage.
    let bestId = 0, bestDmg = 40;
    for (const k of Object.keys(victim.damageTaken)) {
      const id = Number(k);
      if (id !== attacker.id && victim.damageTaken[k] >= bestDmg) { bestDmg = victim.damageTaken[k]; bestId = id; }
    }
    if (bestId) {
      const helper = s.agents.find((a) => a.id === bestId);
      if (helper) helper.assists += 1;
    }
    pushKillfeed(s, { killer: attacker.name, killerSquad: attacker.squad, victim: victim.name, victimSquad: victim.squad, weapon: weaponId, headshot: part === 'head', time: s.time });
  } else {
    pushKillfeed(s, { killer: '', killerSquad: '', victim: victim.name, victimSquad: victim.squad, weapon: weaponId || 'world', headshot: false, time: s.time });
  }
  pushEvent(s, { type: 'kill', attacker, victim, weapon: weaponId });
}

// Melee swing: short range, generous cone, no spread.
export function meleeSwing(s, attacker) {
  const w = WEAPONS.knife;
  if (attacker.cooldown > 0 || attacker.reloadT > 0 || attacker.action) return;
  attacker.cooldown = 60 / w.rpm;
  attacker.shotsFired += 1;
  aimDir(_dir, attacker);
  eyePos(_eye, attacker);
  let best = null, bestT = w.range;
  for (const a of s.agents) {
    if (!a.alive || a === attacker || a.squad === attacker.squad) continue;
    V3.sub(_to, a.pos, _eye);
    const d = V3.len(_to);
    if (d > w.range + 0.6) continue;
    // Within a 50-degree cone of the aim.
    const dot = V3.dot(_dir, V3.norm(_to, _to));
    if (dot < 0.6) continue;
    if (d < bestT) { bestT = d; best = a; }
  }
  pushEvent(s, { type: 'shot', agent: attacker, weapon: 'knife', pellets: 1 });
  if (best) {
    const res = { agent: best, part: 'chest', t: bestT };
    applyDamage(s, attacker, best, w.damage, 'chest', 'knife');
    return res;
  }
  return null;
}

// Per-tick weapon state upkeep: cooldowns, bloom decay, recoil recovery,
// pattern reset when the player stops firing.
export function updateWeaponState(a, dt, firing) {
  if (a.cooldown > 0) a.cooldown -= dt;
  if (a.switchT > 0) a.switchT -= dt;
  const w = currentWeapon(a) ? WEAPONS[currentWeapon(a).id] : null;
  if (w) {
    a.bloom = Math.max(0, a.bloom - w.bloomDecay * dt);
    // Recoil offset recovers; the permanent pitch part stays (pull-down).
    a.recoil[0] = dampTo(a.recoil[0], 0, w.recoilRecover, dt);
    a.recoil[1] = dampTo(a.recoil[1], 0, w.recoilRecover, dt);
    if (!firing && a.cooldown <= 0) a.patternIdx = 0;
  }
  if (a.reloadT > 0) {
    a.reloadT -= dt;
    if (a.reloadT <= 0) finishReload(a);
  }
  // ADS smoothing.
  a.ads += (a.adsTarget - a.ads) * Math.min(1, dt * 12);
  if (Math.abs(a.ads - a.adsTarget) < 0.01) a.ads = a.adsTarget;
}

function dampTo(v, target, rate, dt) {
  return v + (target - v) * (1 - Math.exp(-rate * dt));
}

export function startReload(a) {
  const ws = currentWeapon(a);
  if (!ws || a.reloadT > 0 || a.action) return false;
  const w = WEAPONS[ws.id];
  if (w.mag === Infinity || ws.mag >= w.mag || ws.reserve <= 0) return false;
  a.reloadT = w.reload;
  a.reloadSlot = a.slot;
  return true;
}

export function finishReload(a) {
  const ws = a.reloadSlot === 'primary' ? a.primary : a.reloadSlot === 'secondary' ? a.secondary : null;
  if (!ws) { a.reloadT = 0; return; }
  const w = WEAPONS[ws.id];
  const need = w.mag - ws.mag;
  const take = Math.min(need, ws.reserve);
  ws.mag += take;
  ws.reserve -= take;
  a.reloadT = 0;
}

export function switchSlot(a, slot) {
  if (a.slot === slot || a.reloadT > 0 || a.action) return false;
  if (slot === 'primary' && !a.primary) return false;
  if (slot === 'grenade') {
    const g = a.grenades;
    if (g.frag + g.smoke + g.flash <= 0) return false;
  }
  a.slot = slot;
  a.switchT = slot === 'melee' ? 0.25 : 0.4;
  a.adsTarget = 0;
  return true;
}
