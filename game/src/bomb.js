// The bomb: plant / defuse / explode — the objective that makes the game
// tactical instead of a deathmatch. Plant: carrier holds F for 3.0s inside
// site A or B (+$300 per attacker; the 40s fuse replaces the round timer).
// Beeps accelerate as the fuse runs down (1.0s -> 0.12s) — the sound itself
// is the defenders' countdown. Defuse: hold F 10s (5s with a kit) within
// 2.5m; releasing F or leaving range cancels. The carrier drops the bomb
// where they die; any attacker picks it up by walking over it.
import { MATCH, ECONOMY } from './config.js';
import { siteAt } from './mapdata.js';
import { hasLineOfSight, applyDamage } from './combat.js';
import { pushEvent, squadOf, attackingSquad, defendingSquad } from './state.js';
import { V3 } from './mathx.js';

export function canPlant(s, a) {
  return a.alive && a.hasBomb && !s.bombPlanted && s.phase === 'live' &&
    siteAt(a.pos[0], a.pos[2]) !== null;
}
export function canDefuse(s, a) {
  if (!a.alive || !s.bombPlanted || a.role !== 'guard' || s.phase !== 'live') return false;
  return V3.dist(a.pos, s.bombPos) < 2.5;
}

// Begin or continue a hold-E action. Called every tick with the agent's
// current intent (wantAction true while E is held). Returns progress 0..1.
export function updateBombAction(s, a, wantAction, dt) {
  if (!a.alive) { a.action = null; return 0; }
  if (wantAction && !a.action) {
    if (canPlant(s, a)) {
      a.action = { kind: 'plant', t: 0, total: MATCH.plantTime, site: siteAt(a.pos[0], a.pos[2]) };
      pushEvent(s, { type: 'plantStart', agent: a });
    } else if (canDefuse(s, a)) {
      const total = a.defuseKit ? MATCH.defuseTimeKit : MATCH.defuseTime;
      a.action = { kind: 'defuse', t: 0, total, site: s.bombSite };
      pushEvent(s, { type: 'defuseStart', agent: a });
    }
  }
  if (a.action) {
    const ok = wantAction && (a.action.kind === 'plant' ? canPlant(s, a) : canDefuse(s, a));
    if (!ok) {
      pushEvent(s, { type: 'actionCancel', agent: a, kind: a.action.kind });
      a.action = null;
      return 0;
    }
    a.action.t += dt;
    if (a.action.t >= a.action.total) {
      const kind = a.action.kind;
      a.action = null;
      if (kind === 'plant') completePlant(s, a);
      else completeDefuse(s, a);
      return 1;
    }
    return a.action.t / a.action.total;
  }
  return 0;
}

function completePlant(s, a) {
  const site = siteAt(a.pos[0], a.pos[2]);
  s.bombPlanted = true;
  s.bombSite = site;
  s.bombPos = [a.pos[0], 0.15, a.pos[2]];
  s.bombFuse = MATCH.bombTime;
  s.beepT = 0;
  a.hasBomb = false;
  a.plants += 1;
  s.bombCarrierId = 0;
  for (const m of squadOf(s, attackingSquad(s))) {
    m.money = Math.min(ECONOMY.maxMoney, m.money + ECONOMY.plantBonus);
  }
  pushEvent(s, { type: 'planted', agent: a, site });
}

function completeDefuse(s, a) {
  s.bombPlanted = false;
  a.defuses += 1;
  a.money = Math.min(ECONOMY.maxMoney, a.money + ECONOMY.defuseBonus);
  pushEvent(s, { type: 'defused', agent: a });
  s.roundWinner = defendingSquad(s);
  s.roundReason = 'defuse';
}

export function updateBombFuse(s, dt, onExplode) {
  if (!s.bombPlanted) return;
  s.bombFuse -= dt;
  // Accelerating beeps: interval shrinks from 1.0s to 0.12s.
  const frac = 1 - s.bombFuse / MATCH.bombTime;
  const interval = 1.0 - frac * 0.88;
  s.beepT = (s.beepT || 0) - dt;
  if (s.beepT <= 0) {
    s.beepT = interval;
    pushEvent(s, { type: 'beep', pos: s.bombPos, frac });
  }
  if (s.bombFuse <= 0) {
    // Blast: lethal within 6m, heavy to 12m, blocked by walls.
    pushEvent(s, { type: 'explosion', pos: s.bombPos, radius: 12, big: true });
    for (const a of s.agents) {
      if (!a.alive) continue;
      const d = V3.dist(s.bombPos, [a.pos[0], a.pos[1] + 0.9, a.pos[2]]);
      if (d > 12) continue;
      if (!hasLineOfSight(s.bombPos[0], 0.5, s.bombPos[2], a.pos[0], a.pos[1] + 0.9, a.pos[2])) continue;
      const dmg = Math.round(220 * (1 - d / 13));
      if (dmg > 0) applyDamage(s, null, a, dmg, 'chest', 'bomb');
    }
    s.bombPlanted = false;
    onExplode();
  }
}

// Dropped-bomb pickup: any living attacker walking over it takes it.
export function updateBombPickup(s) {
  if (!s.bombDropped || s.bombPlanted) return;
  for (const a of s.agents) {
    if (!a.alive || a.role !== 'raider') continue;
    if (V3.dist(a.pos, s.bombDropped) < 1.3) {
      a.hasBomb = true;
      s.bombCarrierId = a.id;
      s.bombDropped = null;
      pushEvent(s, { type: 'bombPickup', agent: a });
      return;
    }
  }
}
