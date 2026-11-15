// Bot brains. Bots play MACRO: squads pick a round plan together (execute A/B,
// split, mid control, fake), regroup before site hits, rotate on shared intel,
// save rifles when a round is lost, and retake as a group after a plant.
// Perception is fair — line-of-sight + field of view + range + smoke + flash
// blindness + reaction delay — the same information a player has, which is
// what makes peeking work against them. Defenders run a 2-1-2 default.
import { V3, clamp, DEG } from './mathx.js';
import { DIFFICULTY, WEAPONS } from './config.js';
import { MAP, findPath, nearestWaypoint, zoneAt, siteAt } from './mapdata.js';
import { canSee, eyePos, aimDir, fireWeapon, meleeSwing, startReload, updateWeaponState, switchSlot, bodyHeight } from './combat.js';
import { updateMovement } from './player.js';
import { throwGrenade } from './grenades.js';
import { updateBombAction } from './bomb.js';
import { squadBuyPlan } from './economy.js';
import { currentWeapon, squadOf, aliveOf, attackingSquad } from './state.js';

const SCAN_DT = 0.12;

export function makeBot() {
  return {
    path: [], pathIdx: 0, dest: -1,
    hold: null, // {x, z, yaw, until} — holding an angle
    scanT: 0, targetId: 0, seenT: -99, lastSeen: [0, 0, 0], lostT: 0,
    burstLeft: 0, burstPause: 0, strafeDir: 0, strafeT: 0,
    aimErr: [0, 0], aimErrT: 0,
    alertPos: null, alertT: -99,
    plan: 'eco', strat: 'default', lane: 0,
    regrouped: false, executed: false, usedUtility: false,
    saveMode: false, stuckT: 0, lastPos: [0, 0, 0], repathT: 0,
    wantAction: false, rotateTo: null, postPlant: null,
    siteTarget: 'A', fakeDone: false,
  };
}

export function initBots(s) {
  for (const a of s.agents) if (!a.isPlayer) a.bot = makeBot();
  s.intel = { alpha: { zone: null, time: -99, pos: null }, bravo: { zone: null, time: -99, pos: null } };
  s.noises = [];
}

function diff(s) { return DIFFICULTY[s.settings.difficulty]; }
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function turnToward(a, targetYaw, targetPitch, rate, dt) {
  a.yaw += clamp(wrapAngle(targetYaw - a.yaw), -rate * dt, rate * dt);
  a.pitch += clamp(targetPitch - a.pitch, -rate * dt * 0.7, rate * dt * 0.7);
  a.pitch = clamp(a.pitch, -1.45, 1.45);
}
function lookAtPoint(a, p, rate, dt, errPitch = 0, errYaw = 0) {
  const eye = eyePos([0, 0, 0], a);
  const dx = p[0] - eye[0], dy = p[1] - eye[1], dz = p[2] - eye[2];
  const yaw = Math.atan2(-dx, -dz) + errYaw;
  const pitch = Math.atan2(dy, Math.hypot(dx, dz)) + errPitch;
  turnToward(a, yaw, pitch, rate, dt);
}

// Shared squad intel: the freshest known enemy position per squad.
export function shareIntel(s, squad, pos) {
  const zn = zoneAt(pos[0], pos[2]);
  s.intel[squad] = { zone: zn.id, time: s.time, pos: [pos[0], pos[1], pos[2]] };
}

function setPath(s, a, destId) {
  const from = nearestWaypoint(a.pos[0], a.pos[2]);
  const path = findPath(from, destId);
  a.bot.path = path;
  a.bot.pathIdx = path.length > 1 ? 1 : 0;
  a.bot.dest = destId;
}

// --- Round planning -------------------------------------------------------

const EXEC_ROUTES = {
  A: { regroup: 20, entry: [11, 12], site: [12, 13, 38], lanes: [[4, 7, 8, 9, 10, 11], [5, 16, 17, 18, 19, 20, 21, 15, 14], [5, 16, 40, 41, 20, 21, 15, 14]] },
  B: { regroup: 20, entry: [29, 30], site: [30, 31, 39], lanes: [[6, 25, 26, 27, 28, 29], [5, 16, 17, 18, 19, 20, 22, 23, 32], [5, 16, 40, 41, 20, 22, 23, 32]] },
};
const DEFEND_SPOTS = {
  A: [{ wp: 13, yaw: 2.6 }, { wp: 38, yaw: 2.9 }, { wp: 14, yaw: 1.8 }],
  mid: [{ wp: 20, yaw: 1.57 }, { wp: 41, yaw: 1.9 }],
  B: [{ wp: 31, yaw: -2.6 }, { wp: 39, yaw: -2.9 }, { wp: 32, yaw: -1.8 }],
};

function pickStrategy(s, squad) {
  const r = s.rng;
  const plan = squadBuyPlan(s, squad);
  const roll = r.next();
  if (plan === 'eco') return 'default'; // eco rounds: play for picks, don't force
  if (roll < 0.3) return 'execA';
  if (roll < 0.6) return 'execB';
  if (roll < 0.75) return 'split';
  if (roll < 0.88) return 'mid';
  return 'fake';
}

function planRound(s, a) {
  const b = a.bot;
  b.regrouped = false; b.executed = false; b.usedUtility = false;
  b.saveMode = false; b.rotateTo = null; b.postPlant = null; b.fakeDone = false;
  b.targetId = 0; b.hold = null; b.alertPos = null;
  if (a.role === 'raider') {
    const mates = aliveOf(s, a.squad);
    const idx = mates.indexOf(a);
    // Squad strategy is shared: derive it from the squad, not per bot.
    if (!s.strat || s.stratRound !== s.round) {
      s.strat = pickStrategy(s, a.squad);
      s.stratRound = s.round;
      s.stratSite = s.strat === 'execB' || s.strat === 'fake' ? 'B' : 'A';
    }
    b.strat = s.strat;
    b.siteTarget = s.stratSite;
    if (b.strat === 'split') b.siteTarget = idx < 3 ? 'A' : 'B';
    if (b.strat === 'fake') b.siteTarget = idx < 2 ? 'A' : 'B';
    b.lane = idx % 3;
    const route = EXEC_ROUTES[b.siteTarget];
    // Route: follow the lane waypoints to the regroup/entry point.
    const lane = route.lanes[b.lane];
    b.route = lane;
    b.routeIdx = 0;
    setPath(s, a, lane[0]);
  } else {
    // Defenders: 2 A / 1 mid / 2 B by squad order.
    const mates = aliveOf(s, a.squad);
    const idx = mates.indexOf(a);
    const spots = idx < 2 ? DEFEND_SPOTS.A : idx === 2 ? DEFEND_SPOTS.mid : DEFEND_SPOTS.B;
    const spot = spots[idx % spots.length];
    b.holdSpot = spot;
    setPath(s, a, spot.wp);
  }
}

// --- Perception -----------------------------------------------------------

function scanForEnemies(s, a) {
  const b = a.bot, d = diff(s);
  const eye = eyePos([0, 0, 0], a);
  let best = null, bestD = Infinity;
  for (const e of s.agents) {
    if (!e.alive || e.squad === a.squad) continue;
    const dist = V3.dist(eye, e.pos);
    if (dist > 48) continue;
    // Field of view: front 200 degrees, peripheral vision is worse.
    const to = V3.norm([0, 0, 0], V3.sub([0, 0, 0], e.pos, eye));
    const fwd = aimDir([0, 0, 0], a);
    const dot = V3.dot(fwd, to);
    if (dot < -0.35) continue; // behind
    if (a.flashT > 0.4) continue; // blinded
    if (!canSee(s, a, e)) continue;
    if (dist < bestD) { bestD = dist; best = e; }
  }
  if (best) {
    if (b.targetId !== best.id) { b.seenT = s.time; b.targetId = best.id; }
    b.lastSeen = [best.pos[0], best.pos[1], best.pos[2]];
    b.lostT = 0;
    shareIntel(s, a.squad, best.pos);
  } else {
    if (b.targetId) {
      b.lostT += SCAN_DT;
      if (b.lostT > 1.2) b.targetId = 0; // lost track: stop prefiring the spot
    }
  }
  // Hearing: enemy noises inside the hearing radius raise an alert.
  for (const n of s.noises) {
    if (n.team === a.squad || s.time - n.time > 1.2) continue;
    const dist = V3.dist(a.pos, n.pos);
    if (dist < d.hearRadius * n.loud) {
      b.alertPos = [n.pos[0], n.pos[1], n.pos[2]];
      b.alertT = s.time;
      shareIntel(s, a.squad, n.pos);
    }
  }
}

// --- Movement -------------------------------------------------------------

function followPath(s, a, dt, input) {
  const b = a.bot;
  if (b.pathIdx >= b.path.length) return true; // arrived
  const wp = MAP.waypoints[b.path[b.pathIdx]];
  const dx = wp[0] - a.pos[0], dz = wp[1] - a.pos[2];
  const dist = Math.hypot(dx, dz);
  if (dist < 1.1) { b.pathIdx += 1; return b.pathIdx >= b.path.length; }
  const heading = Math.atan2(-dx, -dz);
  const yawDiff = wrapAngle(heading - a.yaw);
  turnToward(a, heading, 0, 4.5, dt);
  input.f = Math.cos(yawDiff);
  input.s = -Math.sin(yawDiff);
  // Slow down for sharp turns so bots don't orbit waypoints.
  if (Math.abs(yawDiff) > 1.2) { input.f *= 0.3; }
  // Separation from teammates.
  for (const m of s.agents) {
    if (m === a || !m.alive || m.squad !== a.squad) continue;
    const ddx = a.pos[0] - m.pos[0], ddz = a.pos[2] - m.pos[2];
    const dd = Math.hypot(ddx, ddz);
    if (dd < 0.9 && dd > 0.01) {
      input.f += (ddx / dd) * 0.4;
      input.s += (ddz / dd) * 0.4;
    }
  }
  // Stuck detection: barely moved while trying to. Not while waiting for
  // teammates (regroup/retake holds are deliberate stands).
  if (b.waiting) { b.stuckT = 0; return false; }
  const moved = Math.hypot(a.pos[0] - b.lastPos[0], a.pos[2] - b.lastPos[2]);
  if (moved < 0.05 && (Math.abs(input.f) > 0.3 || Math.abs(input.s) > 0.3)) {
    b.stuckT += dt;
    if (b.stuckT > 1.0) {
      input.jump = true;
      b.stuckT = 0;
      if (b.dest >= 0) setPath(s, a, b.dest);
    }
  } else b.stuckT = 0;
  return false;
}

function moveToPoint(s, a, dt, input, x, z) {
  const dx = x - a.pos[0], dz = z - a.pos[2];
  const dist = Math.hypot(dx, dz);
  if (dist < 0.8) return true;
  const heading = Math.atan2(-dx, -dz);
  const yawDiff = wrapAngle(heading - a.yaw);
  turnToward(a, heading, 0, 4.5, dt);
  input.f = Math.cos(yawDiff);
  input.s = -Math.sin(yawDiff);
  return false;
}

// --- Combat ---------------------------------------------------------------

function fightTarget(s, a, dt, input) {
  const b = a.bot, d = diff(s);
  const target = s.agents.find((e) => e.id === b.targetId);
  if (!target || !target.alive) { b.targetId = 0; return false; }
  const eye = eyePos([0, 0, 0], a);
  const dist = V3.dist(eye, target.pos);
  // Aim error refreshes a few times per second; veterans track tighter.
  b.aimErrT -= dt;
  if (b.aimErrT <= 0) {
    b.aimErrT = 0.22;
    const errScale = d.aimErr * (target.speedFrac > 0.5 ? 1.4 : 1) * (dist > 25 ? 1.3 : 1);
    b.aimErr = [s.rng.gauss() * errScale * DEG, s.rng.gauss() * errScale * DEG];
  }
  // Aim at the upper chest; veterans bias toward the head.
  const h = bodyHeight(target);
  const headBias = s.settings.difficulty === 'veteran' ? 0.35 : 0.15;
  const aimY = target.pos[1] + h * (0.68 + headBias * 0.25);
  lookAtPoint(a, [target.pos[0], aimY, target.pos[2]], 5.5, dt, b.aimErr[0], b.aimErr[1]);
  // Reaction time: no shots until the bot has "processed" the sighting.
  const reacted = s.time - b.seenT >= d.reaction;
  // Strafe in duels: sidestep, pause to shoot, sidestep back.
  b.strafeT -= dt;
  if (b.strafeT <= 0) {
    b.strafeT = s.rng.range(0.35, 0.8);
    b.strafeDir = s.rng.pick([-1, 0, 1]);
  }
  const ws = currentWeapon(a);
  const w = ws ? WEAPONS[ws.id] : null;
  if (reacted && w) {
    // Knife when very close and the gun is empty or the target is unaware.
    if (dist < 1.6 && (ws.id === 'knife' || ws.mag === 0)) {
      if (ws.id !== 'knife') switchSlot(a, 'melee');
      meleeSwing(s, a);
      return true;
    }
    if (ws.id === 'knife' && dist > 2) switchSlot(a, a.primary ? 'primary' : 'secondary');
    // Burst discipline: fire in bursts, pause, re-aim.
    if (b.burstLeft <= 0 && b.burstPause <= 0) {
      b.burstLeft = s.rng.int(d.burstLen[0], d.burstLen[1]);
    }
    if (b.burstPause > 0) {
      b.burstPause -= dt;
      input.s = b.strafeDir * 0.8; // strafe during the pause
    } else if (b.burstLeft > 0) {
      // Stand still while firing (accuracy), strafe between bursts.
      input.s = 0; input.f = 0;
      if (ws.mag > 0) {
        const before = ws.mag;
        fireWeapon(s, a);
        if (ws.mag < before) b.burstLeft -= 1;
        if (b.burstLeft <= 0) b.burstPause = s.rng.range(0.25, 0.5);
      } else {
        startReload(a);
        b.burstPause = 0.4;
      }
    }
    // Crouch sometimes when duelling at range (accuracy + smaller target).
    if (dist > 12 && !b.crouchHold && s.rng.chance(0.004)) b.crouchHold = true;
    if (b.crouchHold && s.rng.chance(0.008)) b.crouchHold = false;
    input.crouch = !!b.crouchHold;
  } else {
    // Not reacted yet: keep moving to the last known spot / strafe.
    input.s = b.strafeDir * 0.6;
  }
  return true;
}

function reloadIfSafe(s, a) {
  const ws = currentWeapon(a);
  if (!ws) return;
  const w = WEAPONS[ws.id];
  if (w.mag === Infinity) return;
  if (ws.mag <= w.mag * 0.3 && ws.reserve > 0 && !a.bot.targetId && a.reloadT <= 0) {
    startReload(a);
  }
}

// --- Utility --------------------------------------------------------------

function maybeThrowUtility(s, a) {
  const b = a.bot;
  if (b.usedUtility) return;
  const site = MAP.sites[b.siteTarget];
  const dist = Math.hypot(a.pos[0] - site.center[0], a.pos[2] - site.center[1]);
  if (dist > 18) return;
  b.usedUtility = true;
  // Look at the site and throw a smoke or flash over the entry.
  lookAtPoint(a, [site.center[0], 1.5, site.center[1]], 6, 0.1);
  if (a.grenades.smoke > 0 && s.rng.chance(0.6)) {
    a.grenadeSel = 'smoke';
    throwGrenade(s, a, 'smoke', 'throw');
  } else if (a.grenades.flash > 0) {
    a.grenadeSel = 'flash';
    throwGrenade(s, a, 'flash', 'throw');
  } else if (a.grenades.frag > 0 && s.rng.chance(0.5)) {
    a.grenadeSel = 'frag';
    throwGrenade(s, a, 'frag', 'throw');
  }
}

// --- Role behaviours ------------------------------------------------------

function attackerThink(s, a, dt, input) {
  const b = a.bot;
  const mates = aliveOf(s, a.squad);
  const foes = aliveOf(s, a.squad === 'alpha' ? 'bravo' : 'alpha');
  // SAVE: outnumbered 1v3+ with the bomb unplanted and the clock low — hide
  // and keep the rifle instead of dying for nothing.
  if (!s.bombPlanted && mates.length === 1 && foes.length >= 3 && s.phaseT < 30 && a.primary) {
    b.saveMode = true;
  }
  if (b.saveMode) {
    if (b.dest !== 4) setPath(s, a, 4);
    if (followPath(s, a, dt, input)) {
      turnToward(a, Math.PI / 2, 0, 3, dt); // hold an angle, don't peek
      input.f = 0; input.s = 0;
    }
    return;
  }
  // Post-plant: take a post-plant position and hold the site.
  if (s.bombPlanted) {
    if (!b.postPlant) {
      const spots = EXEC_ROUTES[s.bombSite].site;
      b.postPlant = spots[mates.indexOf(a) % spots.length];
      setPath(s, a, b.postPlant);
    }
    if (followPath(s, a, dt, input)) {
      // Face the most likely retake entry.
      const entry = s.bombSite === 'A' ? MAP.waypoints[15] : MAP.waypoints[23];
      lookAtPoint(a, [entry[0], 1.4, entry[1]], 3, dt);
      input.f = 0; input.s = 0;
    }
    return;
  }
  // Carrier with the bomb dropped nearby: go pick it up.
  if (s.bombDropped && !a.hasBomb && !mates.some((m) => m.hasBomb)) {
    const dx = s.bombDropped[0] - a.pos[0], dz = s.bombDropped[2] - a.pos[2];
    if (Math.hypot(dx, dz) < 6) { moveToPoint(s, a, dt, input, s.bombDropped[0], s.bombDropped[2]); return; }
  }
  // Fake: the two A players make noise, then fall back and rotate to B.
  if (b.strat === 'fake' && b.siteTarget === 'A' && !b.fakeDone) {
    const site = MAP.sites.A;
    const dSite = Math.hypot(a.pos[0] - site.center[0], a.pos[2] - site.center[1]);
    if (dSite < 12) {
      maybeThrowUtility(s, a);
      b.fakeDone = true;
      b.siteTarget = 'B';
      setPath(s, a, 20); // fall back to mid, then to B
      return;
    }
  }
  if (b.strat === 'fake' && b.fakeDone && b.siteTarget === 'B' && b.dest === 20 && b.pathIdx >= b.path.length) {
    setPath(s, a, 29);
  }
  // Follow the lane route; regroup at the entry, then execute together.
  const route = EXEC_ROUTES[b.siteTarget];
  if (!b.executed) {
    // Walk the lane waypoints in order.
    if (b.route && b.routeIdx < b.route.length) {
      if (b.pathIdx >= b.path.length) {
        b.routeIdx += 1;
        if (b.routeIdx < b.route.length) setPath(s, a, b.route[b.routeIdx]);
      }
      followPath(s, a, dt, input);
      // Regroup: wait at the last lane waypoint until nearby mates arrive.
      const lastWp = MAP.waypoints[b.route[b.route.length - 1]];
      const dLast = Math.hypot(a.pos[0] - lastWp[0], a.pos[2] - lastWp[1]);
      if (dLast < 4 && b.routeIdx >= b.route.length - 1) {
        const near = mates.filter((m) => Math.hypot(m.pos[0] - lastWp[0], m.pos[2] - lastWp[1]) < 8).length;
        const expected = b.strat === 'split' ? 3 : mates.length;
        if (near >= Math.min(expected, mates.length) || s.phaseT < 45) {
          b.executed = true;
          b.waiting = false;
        } else {
          b.waiting = true;
          input.f = 0; input.s = 0; // hold for the team
          return;
        }
      }
      return;
    }
    b.executed = true;
  }
  // Execute: utility, then push the site.
  maybeThrowUtility(s, a);
  const siteWp = route.site[mates.indexOf(a) % route.site.length];
  if (b.dest !== siteWp) setPath(s, a, siteWp);
  if (followPath(s, a, dt, input)) {
    // On site: the carrier plants, others hold entries.
    if (a.hasBomb && siteAt(a.pos[0], a.pos[2]) === b.siteTarget) {
      b.wantAction = true;
    } else {
      const entry = b.siteTarget === 'A' ? MAP.waypoints[15] : MAP.waypoints[23];
      lookAtPoint(a, [entry[0], 1.4, entry[1]], 3, dt);
      input.f = 0; input.s = 0;
    }
  }
}

function defenderThink(s, a, dt, input) {
  const b = a.bot;
  const mates = aliveOf(s, a.squad);
  const intel = s.intel[a.squad];
  // RETAKE: bomb planted — regroup, then push together; defuse when clear.
  if (s.bombPlanted) {
    const site = MAP.sites[s.bombSite];
    const dSite = Math.hypot(a.pos[0] - site.center[0], a.pos[2] - site.center[1]);
    // Save: 1v4 with no kit and <12s on the fuse — unwinnable, keep the gun.
    if (mates.length === 1 && aliveOf(s, attackingSquad(s)).length >= 4 && s.bombFuse < 12 && !a.defuseKit) {
      b.saveMode = true;
    }
    if (b.saveMode) {
      if (b.dest !== 33) setPath(s, a, 33);
      followPath(s, a, dt, input);
      return;
    }
    if (dSite < 2.5 && !b.targetId) {
      b.wantAction = true; // defuse
      input.f = 0; input.s = 0;
      return;
    }
    // Regroup near the site entry, then go in together.
    const entry = s.bombSite === 'A' ? 15 : 23;
    const entryWp = MAP.waypoints[entry];
    const dEntry = Math.hypot(a.pos[0] - entryWp[0], a.pos[2] - entryWp[1]);
    if (dEntry > 3) {
      if (b.dest !== entry) setPath(s, a, entry);
      followPath(s, a, dt, input);
      return;
    }
    const near = mates.filter((m) => Math.hypot(m.pos[0] - entryWp[0], m.pos[2] - entryWp[1]) < 9).length;
    if (near >= 2 || s.bombFuse < 15 || mates.length === 1) {
      const siteWp = EXEC_ROUTES[s.bombSite].site[mates.indexOf(a) % 3];
      if (b.dest !== siteWp) setPath(s, a, siteWp);
      followPath(s, a, dt, input);
    } else {
      b.waiting = true;
      input.f = 0; input.s = 0; // wait for the team
      lookAtPoint(a, [site.center[0], 1.4, site.center[1]], 3, dt);
    }
    return;
  }
  // ROTATE: fresh intel of a push at the other site pulls one defender over.
  if (intel.zone && s.time - intel.time < 6) {
    const pushedSite = intel.zone === 'asite' || intel.zone === 'amain' ? 'A' : intel.zone === 'bsite' || intel.zone === 'balley' ? 'B' : null;
    const mySpot = b.holdSpot ? (b.holdSpot.wp === 13 || b.holdSpot.wp === 38 || b.holdSpot.wp === 14 ? 'A' : b.holdSpot.wp === 31 || b.holdSpot.wp === 39 || b.holdSpot.wp === 32 ? 'B' : 'mid') : 'mid';
    if (pushedSite && mySpot !== pushedSite && mySpot !== 'mid' && !b.rotateTo) {
      // Only one defender rotates: the one furthest from their own site mates.
      const others = mates.filter((m) => m !== a && m.bot && m.bot.holdSpot && ((m.bot.holdSpot.wp === 13 || m.bot.holdSpot.wp === 38 || m.bot.holdSpot.wp === 14) ? 'A' : 'B') === mySpot);
      if (others.length >= 1) {
        b.rotateTo = pushedSite;
        const dest = pushedSite === 'A' ? 14 : 32;
        setPath(s, a, dest);
      }
    }
  }
  if (b.rotateTo) {
    if (followPath(s, a, dt, input)) {
      const spot = b.rotateTo === 'A' ? DEFEND_SPOTS.A[0] : DEFEND_SPOTS.B[0];
      b.holdSpot = spot;
      b.rotateTo = null;
    }
    return;
  }
  // Default: go to the hold spot and hold the angle.
  if (b.holdSpot && b.dest !== b.holdSpot.wp && !b.hold) setPath(s, a, b.holdSpot.wp);
  if (followPath(s, a, dt, input)) {
    // At the spot: hold the assigned angle, with small scans.
    const spot = b.holdSpot;
    if (spot) {
      const scanYaw = spot.yaw + Math.sin(s.time * 0.35 + a.id) * 0.25;
      turnToward(a, scanYaw, 0, 2.5, dt);
    }
    input.f = 0; input.s = 0;
    // Investigate fresh alerts (noise) briefly.
    if (b.alertPos && s.time - b.alertT < 2.5) {
      lookAtPoint(a, [b.alertPos[0], 1.4, b.alertPos[2]], 4, dt);
    }
  }
}

// --- Main update ----------------------------------------------------------

export function updateBots(s, dt) {
  // Expire old noises.
  if (s.noises.length > 40) s.noises.splice(0, s.noises.length - 40);
  for (const a of s.agents) {
    if (a.isPlayer || !a.alive || !a.bot) continue;
    if (s.phase !== 'live') {
      // Freeze: stand still, face the planned direction.
      if (s.phase === 'freeze' && a.bot.holdSpot) turnToward(a, a.bot.holdSpot.yaw, 0, 3, dt);
      continue;
    }
    const b = a.bot;
    const input = { f: 0, s: 0, jump: false, crouch: false, walk: false, sprint: false, lean: 0 };
    b.wantAction = false;
    b.waiting = false;
    // Perception on a stagger.
    b.scanT -= dt;
    if (b.scanT <= 0) { b.scanT = SCAN_DT; scanForEnemies(s, a); }
    // Combat overrides movement planning.
    const fighting = b.targetId && fightTarget(s, a, dt, input);
    if (!fighting) {
      if (a.role === 'raider') attackerThink(s, a, dt, input);
      else defenderThink(s, a, dt, input);
      // When idle-moving, look where we're going (handled in followPath) or
      // toward the last known enemy position.
      if (b.targetId) {
        const t = s.agents.find((e) => e.id === b.targetId);
        if (t && t.alive) lookAtPoint(a, [t.pos[0], 1.4, t.pos[2]], 4, dt);
      } else if (b.alertPos && s.time - b.alertT < 3) {
        lookAtPoint(a, [b.alertPos[0], 1.4, b.alertPos[2]], 3, dt);
      }
    }
    reloadIfSafe(s, a);
    updateBombAction(s, a, b.wantAction, dt);
    updateWeaponState(a, dt, !!b.targetId);
    updateMovement(s, a, input, dt);
    b.lastPos = [a.pos[0], a.pos[1], a.pos[2]];
    // Flash recovery: bots don't act while heavily flashed (fightTarget
    // already skips scanning; movement continues to the last plan).
  }
}

// Called by rounds.js when a new round starts.
export function onRoundStartBot(s, a) {
  if (!a.bot) return;
  planRound(s, a);
}
