// Grenades: predictable bounce physics, real smoke occlusion, fair flashes.
// Fixed restitution (0.45) + ground friction make throws learnable — the same
// throw lands in the same place. Smoke spheres genuinely block bot vision
// (see combat.canSee) and the player's view. Flash scales with distance AND
// facing: turning away (counterplay) cuts it to a quarter.
import { V3, clamp } from './mathx.js';
import { GRENADES } from './config.js';
import { SOLIDS } from './mapdata.js';
import { aimDir, eyePos, hasLineOfSight, applyDamage } from './combat.js';
import { pushEvent } from './state.js';

const R = 0.12; // grenade radius
const REST = 0.45;
const GRAV = 14.5;

export function throwGrenade(s, a, type, power) {
  if (a.grenades[type] <= 0 || a.action) return false;
  a.grenades[type] -= 1;
  const dir = aimDir([0, 0, 0], a);
  const pos = eyePos([0, 0, 0], a);
  V3.madd(pos, pos, dir, 0.5);
  const speed = power === 'lob' ? 8.5 : 17;
  const vel = [
    dir[0] * speed + a.vel[0] * 0.6,
    dir[1] * speed + a.vel[1] * 0.6 + 1.2,
    dir[2] * speed + a.vel[2] * 0.6,
  ];
  s.grenades.push({ type, pos, vel, fuse: GRENADES[type].fuse, owner: a, team: a.squad, rest: false });
  pushEvent(s, { type: 'throw', agent: a, grenade: type });
  // Auto-switch back to the previous weapon slot when out of this grenade.
  if (a.grenades[type] <= 0 && a.slot === 'grenade') {
    a.slot = a.primary ? 'primary' : 'secondary';
    a.switchT = 0.3;
  }
  return true;
}

function hitsSolid(p) {
  for (let i = 0; i < SOLIDS.length; i++) {
    const b = SOLIDS[i];
    if (p[0] > b.min[0] - R && p[0] < b.max[0] + R &&
        p[1] > b.min[1] - R && p[1] < b.max[1] + R &&
        p[2] > b.min[2] - R && p[2] < b.max[2] + R) return b;
  }
  return null;
}

function stepPhysics(g, dt) {
  g.vel[1] -= GRAV * dt;
  // Per-axis integration with bounce: move, test, reflect the blocked axis.
  g.pos[0] += g.vel[0] * dt;
  if (hitsSolid(g.pos)) { g.pos[0] -= g.vel[0] * dt; g.vel[0] *= -REST; g.vel[1] *= 0.8; g.vel[2] *= 0.8; }
  g.pos[2] += g.vel[2] * dt;
  if (hitsSolid(g.pos)) { g.pos[2] -= g.vel[2] * dt; g.vel[2] *= -REST; g.vel[0] *= 0.8; g.vel[1] *= 0.8; }
  g.pos[1] += g.vel[1] * dt;
  if (g.pos[1] < R) {
    g.pos[1] = R;
    if (Math.abs(g.vel[1]) > 1.2) g.vel[1] *= -REST;
    else { g.vel[1] = 0; g.vel[0] *= 0.85; g.vel[2] *= 0.85; g.rest = true; }
  } else if (hitsSolid(g.pos)) {
    g.pos[1] -= g.vel[1] * dt;
    if (Math.abs(g.vel[1]) > 1.2) g.vel[1] *= -REST;
    else g.vel[1] = 0;
    g.vel[0] *= 0.8; g.vel[2] *= 0.8;
  }
  if (Math.abs(g.vel[0]) < 0.05 && Math.abs(g.vel[2]) < 0.05 && g.pos[1] <= R + 0.01) g.rest = true;
}

export function updateGrenades(s, dt) {
  for (let i = s.grenades.length - 1; i >= 0; i--) {
    const g = s.grenades[i];
    g.fuse -= dt;
    // Substep so fast grenades cannot tunnel through thin walls.
    const steps = 4;
    for (let k = 0; k < steps; k++) stepPhysics(g, dt / steps);
    if (g.fuse <= 0) {
      s.grenades.splice(i, 1);
      detonate(s, g);
    }
  }
  // Expire smokes.
  for (let i = s.smokes.length - 1; i >= 0; i--) {
    if (s.time > s.smokes[i].until) s.smokes.splice(i, 1);
  }
}

function detonate(s, g) {
  if (g.type === 'frag') {
    const { radius, damage } = GRENADES.frag;
    pushEvent(s, { type: 'explosion', pos: g.pos, radius });
    for (const a of s.agents) {
      if (!a.alive) continue;
      const d = V3.dist(g.pos, [a.pos[0], a.pos[1] + 0.9, a.pos[2]]);
      if (d > radius) continue;
      // No damage through walls; teammates take half (grenade discipline).
      const los = hasLineOfSight(g.pos[0], g.pos[1], g.pos[2], a.pos[0], a.pos[1] + 0.9, a.pos[2]);
      if (!los) continue;
      let dmg = Math.round(damage * (1 - (d / radius) * 0.85));
      if (a.squad === g.team) dmg = Math.round(dmg * 0.5);
      if (dmg > 0) applyDamage(s, g.owner, a, dmg, 'chest', 'frag');
      a.shake = Math.min(1, a.shake + 0.7 * (1 - d / radius));
    }
  } else if (g.type === 'smoke') {
    const sm = { pos: [g.pos[0], Math.max(0.6, g.pos[1]), g.pos[2]], radius: GRENADES.smoke.radius, until: s.time + GRENADES.smoke.duration, born: s.time };
    s.smokes.push(sm);
    pushEvent(s, { type: 'smokePop', pos: sm.pos });
  } else if (g.type === 'flash') {
    const { radius } = GRENADES.flash;
    s.flashes.push({ pos: [...g.pos], t: 0 });
    pushEvent(s, { type: 'flashPop', pos: g.pos, radius });
    for (const a of s.agents) {
      if (!a.alive) continue;
      const eye = eyePos([0, 0, 0], a);
      const d = V3.dist(g.pos, eye);
      if (d > radius) continue;
      if (!hasLineOfSight(g.pos[0], g.pos[1], g.pos[2], eye[0], eye[1], eye[2])) continue;
      // Facing factor: looking at the pop = full effect, looking away = 25%.
      const fwd = aimDir([0, 0, 0], a);
      const toFlash = V3.norm([0, 0, 0], V3.sub([0, 0, 0], g.pos, eye));
      const dot = V3.dot(fwd, toFlash);
      const facing = dot > 0.3 ? 1 : dot < -0.3 ? 0.25 : 0.6;
      const falloff = 1 - (d / radius) * 0.7;
      const dur = 2.8 * facing * falloff;
      if (dur > 0.15) {
        a.flashT = Math.max(a.flashT, dur);
        a.flashPeak = Math.max(a.flashPeak, clamp(facing * falloff, 0, 1));
      }
    }
  }
}

// Is a point inside any active smoke? (used by the renderer for the player's
// own vision and by bots deciding whether a route is covered)
export function pointInSmoke(s, p) {
  for (const sm of s.smokes) {
    if (s.time > sm.until) continue;
    if (V3.dist(p, sm.pos) < sm.radius) return true;
  }
  return false;
}
