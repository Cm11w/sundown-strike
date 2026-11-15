// Headless verification for SUNDOWN STRIKE. No browser, no three.js: the pure
// sim modules (map, economy, combat, grenades, rounds, bots) run in Node.
// Run: node tests/simtest.mjs   (exit 0 = all green)
import { createState, squadOf, aliveOf, playerOf } from '../game/src/state.js';
import { initBots, updateBots } from '../game/src/bots.js';
import { updateRounds, startMatch, endRound } from '../game/src/rounds.js';
import { updateGrenades, throwGrenade, pointInSmoke } from '../game/src/grenades.js';
import { buyItem, awardRoundEnd, squadBuyPlan, canBuy } from '../game/src/economy.js';
import { damageAtDistance, spreadDeg, computeDamage, canSee, hasLineOfSight, fireWeapon, raycastShot, aimDir } from '../game/src/combat.js';
import { WEAPONS, ECONOMY, MATCH, DIFFICULTY } from '../game/src/config.js';
import { MAP, SOLIDS, findPath, nearestWaypoint, siteAt } from '../game/src/mapdata.js';
import { segmentHitsBox } from '../game/src/mathx.js';
import { updateBombAction } from '../game/src/bomb.js';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL: ${name} ${extra}`); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// --- 1. Map validation ----------------------------------------------------
{
  const pad = 0.45;
  let badLinks = 0, badNodes = 0;
  const wps = MAP.waypoints;
  for (let i = 0; i < wps.length; i++) {
    const [x, z] = wps[i];
    // Node outside every solid (with padding).
    for (const b of SOLIDS) {
      if (x > b.min[0] - pad && x < b.max[0] + pad && z > b.min[2] - pad && z < b.max[2] + pad && 0.9 > b.min[1] - pad && 0.9 < b.max[1] + pad) { badNodes++; }
    }
    for (const j of wps[i][2]) {
      const [x2, z2] = wps[j];
      for (const b of SOLIDS) {
        if (segmentHitsBox([x, 0.9, z], [x2, 0.9, z2], b, pad)) { badLinks++; break; }
      }
    }
  }
  check('map: all waypoint nodes clear of solids', badNodes === 0, `bad=${badNodes}`);
  check('map: all waypoint links clear of solids', badLinks === 0, `bad=${badLinks}`);
  // Full connectivity: every node reachable from node 0.
  let unreachable = 0;
  for (let i = 0; i < wps.length; i++) if (findPath(0, i).length === 0) unreachable++;
  check('map: graph fully connected', unreachable === 0, `unreachable=${unreachable}`);
  // Spawns outside solids, sites inside bounds.
  let badSpawn = 0;
  for (const role of ['raider', 'guard']) for (const sp of MAP.spawns[role]) {
    for (const b of SOLIDS) if (sp[0] > b.min[0] - 0.4 && sp[0] < b.max[0] + 0.4 && sp[1] > b.min[2] - 0.4 && sp[1] < b.max[2] + 0.4) badSpawn++;
  }
  check('map: spawns clear of solids', badSpawn === 0, `bad=${badSpawn}`);
  check('map: siteAt finds both sites', siteAt(22, -19) === 'A' && siteAt(22, 19) === 'B' && siteAt(0, 0) === null);
}

// --- 2. Economy -----------------------------------------------------------
{
  const s = createState(7);
  initBots(s);
  startMatch(s);
  const p = playerOf(s);
  check('economy: player starts with $800', p.money === 800);
  check('economy: buy window open in freeze at spawn', canBuy(s, p));
  const r1 = buyItem(s, p, 'rifle');
  check('economy: cannot afford rifle on $800', !r1.ok);
  const r2 = buyItem(s, p, 'flash');
  check('economy: flash costs $200', r2.ok && p.money === 600 && p.grenades.flash === 1);
  const r3 = buyItem(s, p, 'helmet');
  check('economy: helmet requires armor', !r3.ok);
  p.money = 5000;
  buyItem(s, p, 'armor');
  const r4 = buyItem(s, p, 'helmet');
  check('economy: armor+helmet stack', r4.ok && p.armor && p.helmet);
  // Loss ladder.
  s.lossStreak = { alpha: 0, bravo: 0 };
  let pays = awardRoundEnd(s, 'alpha');
  check('economy: first loss pays $1900', pays.lossPay === 1900);
  pays = awardRoundEnd(s, 'alpha');
  check('economy: second loss pays $2400', pays.lossPay === 2400);
  pays = awardRoundEnd(s, 'alpha');
  check('economy: third loss pays $2900', pays.lossPay === 2900);
  pays = awardRoundEnd(s, 'alpha');
  check('economy: loss ladder caps at $3400', pays.lossPay === 3400);
  check('economy: win pays $3250', pays.winPay === 3250);
  // Squad plans.
  for (const a of s.agents) a.money = 5000;
  check('economy: rich squad full-buys', squadBuyPlan(s, 'alpha') === 'full');
  for (const a of s.agents) a.money = 2600;
  check('economy: mid squad force-buys', squadBuyPlan(s, 'alpha') === 'force');
  for (const a of s.agents) a.money = 300;
  check('economy: broke squad ecos', squadBuyPlan(s, 'alpha') === 'eco');
  // Defuse kit is defenders-only.
  const att = squadOf(s, 'bravo')[0];
  att.role = 'raider'; att.money = 5000;
  check('economy: attackers cannot buy a defuse kit', !buyItem(s, att, 'defuseKit').ok);
}

// --- 3. Combat math -------------------------------------------------------
{
  const rifle = WEAPONS.rifle;
  check('combat: rifle close damage 26', damageAtDistance(rifle, 5) === 26);
  check('combat: rifle far damage falls off', approx(damageAtDistance(rifle, 100), 26 * 0.72, 0.01));
  check('combat: shotgun collapses at range', damageAtDistance(WEAPONS.shotgun, 30) < damageAtDistance(WEAPONS.shotgun, 3) * 0.4);
  check('combat: sniper has no falloff', damageAtDistance(WEAPONS.sniper, 150) === 110);
  // Headshot / helmet / armor via computeDamage.
  const mkTarget = (armor, helmet) => ({ armor, helmet });
  const headRes = { agent: mkTarget(false, false), part: 'head', t: 10 };
  check('combat: rifle headshot x4', computeDamage(rifle, headRes, null) === 104);
  const headHelm = { agent: mkTarget(true, true), part: 'head', t: 10 };
  check('combat: helmet halves headshot bonus', computeDamage(rifle, headHelm, null) === Math.round(26 * 2.5 * (0.5 + 0.5 * 0.75)));
  const bodyArmor = { agent: mkTarget(true, false), part: 'chest', t: 10 };
  check('combat: armor reduces body damage', computeDamage(rifle, bodyArmor, null) === Math.round(26 * (0.5 + 0.5 * 0.75)));
  const limb = { agent: mkTarget(false, false), part: 'limb', t: 10 };
  check('combat: limb shots deal 75%', computeDamage(rifle, limb, null) === Math.round(26 * 0.75));
  // Spread model: still < moving < sprinting; crouch + ADS help; air is worst.
  const mkA = (o) => ({ crouching: false, ads: 0, bloom: 0, speedFrac: 0, onGround: true, ...o });
  const still = spreadDeg(mkA({}), { ...rifle, id: 'rifle' });
  const moving = spreadDeg(mkA({ speedFrac: 1 }), { ...rifle, id: 'rifle' });
  const sprint = spreadDeg(mkA({ speedFrac: 1.25 }), { ...rifle, id: 'rifle' });
  const crouched = spreadDeg(mkA({ crouching: true }), { ...rifle, id: 'rifle' });
  const ads = spreadDeg(mkA({ ads: 1 }), { ...rifle, id: 'rifle' });
  const air = spreadDeg(mkA({ onGround: false }), { ...rifle, id: 'rifle' });
  check('combat: moving spreads more than still', moving > still);
  check('combat: sprinting spreads more than running', sprint > moving);
  check('combat: crouching tightens spread', crouched < still);
  check('combat: ADS tightens spread', ads < still);
  check('combat: airborne is worst', air > moving);
  const sniper = WEAPONS.sniper;
  const unscoped = spreadDeg(mkA({}), { ...sniper, id: 'sniper' });
  const scoped = spreadDeg(mkA({ ads: 1 }), { ...sniper, id: 'sniper' });
  check('combat: unscoped sniper is wild, scoped is precise', unscoped > 5 && scoped < 0.2);
  // Line of sight: across the map through the warehouse is blocked.
  check('combat: LOS blocked by warehouse', !hasLineOfSight(20, 1.5, -19, 33, 1.5, -19));
  check('combat: LOS open down mid', hasLineOfSight(-20, 1.5, 0, -12, 1.5, 0));
}

// --- 4. Grenades ----------------------------------------------------------
{
  const s = createState(11);
  initBots(s);
  startMatch(s);
  const p = playerOf(s);
  p.pos = [-20, 0, 0]; p.yaw = -Math.PI / 2; p.pitch = 0.1;
  p.grenades.frag = 1;
  throwGrenade(s, p, 'frag', 'throw');
  check('grenade: throw consumes inventory', p.grenades.frag === 0 && s.grenades.length === 1);
  // Step physics until detonation; grenade must rest on the ground, not tunnel.
  let minY = 99;
  for (let i = 0; i < 200; i++) {
    updateGrenades(s, 1 / 60);
    for (const g of s.grenades) minY = Math.min(minY, g.pos[1]);
  }
  check('grenade: never falls through the floor', minY >= 0.1);
  check('grenade: fuse detonates', s.grenades.length === 0);
  // Smoke blocks vision.
  const s2 = createState(12);
  initBots(s2);
  startMatch(s2);
  const a = squadOf(s2, 'alpha')[0], b = squadOf(s2, 'bravo')[0];
  // z=5 lane is open ground (the rail cars sit on z=0).
  a.pos = [-10, 0, 5]; b.pos = [10, 0, 5];
  a.yaw = -Math.PI / 2; b.yaw = Math.PI / 2;
  s2.smokes.push({ pos: [0, 1, 5], radius: 4.2, until: 999, born: 0 });
  check('grenade: smoke blocks vision', !canSee(s2, a, b));
  s2.smokes.length = 0;
  check('grenade: clear air sees through', canSee(s2, a, b));
  check('grenade: pointInSmoke', pointInSmoke(s2, [0, 1, 5]) === false);
  s2.smokes.push({ pos: [0, 1, 5], radius: 4.2, until: 999, born: 0 });
  check('grenade: pointInSmoke true inside', pointInSmoke(s2, [0, 1, 5]) === true);
  // Flash: facing the pop blinds, looking away barely does.
  const s3 = createState(13);
  initBots(s3);
  startMatch(s3);
  const f1 = squadOf(s3, 'alpha')[0], f2 = squadOf(s3, 'bravo')[0];
  f1.pos = [0, 0, 5]; f1.yaw = -Math.PI / 2; // facing +X (toward the flash)
  f2.pos = [0, 0, 5]; f2.yaw = Math.PI / 2; // facing away
  f1.grenades.flash = 1;
  // Detonate a flash 5m in front of both (z=5 lane: clear of the rail cars).
  s3.grenades.push({ type: 'flash', pos: [5, 1.5, 5], vel: [0, 0, 0], fuse: 0.01, owner: f1, team: f1.squad, rest: true });
  updateGrenades(s3, 0.05);
  check('grenade: facing the flash blinds hard', f1.flashT > 1.5);
  check('grenade: looking away softens the flash', f2.flashT < f1.flashT * 0.6);
}

// --- 5. Round flow --------------------------------------------------------
{
  const s = createState(21);
  initBots(s);
  startMatch(s);
  check('rounds: match starts in freeze, round 1', s.phase === 'freeze' && s.round === 1);
  check('rounds: one bomb carrier assigned', s.agents.filter((a) => a.hasBomb).length === 1);
  // Fast-forward through freeze.
  for (let i = 0; i < 400; i++) updateRounds(s, 1 / 60);
  check('rounds: freeze ends into live', s.phase === 'live');
  // Script 12 round wins for alpha, check halftime swap.
  for (let r = 0; r < 12; r++) {
    endRound(s, 'alpha', 'elimination');
    for (let i = 0; i < 700; i++) updateRounds(s, 1 / 60);
  }
  // Tick until round 13 has actually started (roundEnd 4s + halftime 5s).
  let guardH = 0;
  while (s.round < 13 && guardH++ < 1200) updateRounds(s, 1 / 60);
  check('rounds: halftime after round 12', s.half === 1 && s.round === 13);
  // Roles swapped: alpha defended first (default), so now attacks.
  const alphaRole = squadOf(s, 'alpha')[0].role;
  check('rounds: sides swap at halftime', alphaRole === 'raider');
  // Win the match: alpha needs 13.
  let guard = 0;
  while (s.phase !== 'matchEnd' && guard++ < 40) {
    endRound(s, 'alpha', 'elimination');
    for (let i = 0; i < 400; i++) updateRounds(s, 1 / 60);
  }
  check('rounds: match ends at 13 wins', s.phase === 'matchEnd' && s.winner === 'alpha' && s.score.alpha === 13);
  check('rounds: MVP selected', !!s.mvp);
}

// --- 6. Full bot match (headless) -----------------------------------------
function runBotMatch(seed, maxTicks) {
  const s = createState(seed);
  // Everyone is a bot for the headless match (including the "player" slot).
  for (const a of s.agents) a.isPlayer = false;
  initBots(s);
  startMatch(s);
  const dt = 1 / 60;
  let plants = 0, kills = 0, roundsDone = 0, maxAgents = 0;
  let nanFound = false, wallStuck = 0;
  const seenPlants = new Set();
  for (let t = 0; t < maxTicks && s.phase !== 'matchEnd'; t++) {
    updateRounds(s, dt);
    updateBots(s, dt);
    updateGrenades(s, dt);
    for (const ev of s.events) {
      if (ev.type === 'planted') plants++;
      if (ev.type === 'kill') kills++;
      if (ev.type === 'roundEnd') roundsDone++;
      if (ev.type === 'shot') s.noises.push({ pos: [...ev.agent.pos], team: ev.agent.squad, loud: 1, time: s.time });
      if (ev.type === 'step') s.noises.push({ pos: [...ev.agent.pos], team: ev.agent.squad, loud: ev.loud, time: s.time });
      if (ev.type === 'explosion') s.noises.push({ pos: ev.pos, team: '', loud: 1.5, time: s.time });
    }
    s.events.length = 0;
    s.tracers.length = 0;
    s.decals.length = 0;
    s.time += dt; s.tick++;
    if (s.bombPlanted) seenPlants.add(s.round);
    for (const a of s.agents) {
      if (!Number.isFinite(a.pos[0]) || !Number.isFinite(a.pos[1]) || !Number.isFinite(a.pos[2])) nanFound = true;
      // Agent centres must never be inside a solid.
      for (const b of SOLIDS) {
        if (a.pos[0] > b.min[0] && a.pos[0] < b.max[0] && a.pos[2] > b.min[2] && a.pos[2] < b.max[2] && a.pos[1] + 0.9 > b.min[1] && a.pos[1] + 0.9 < b.max[1]) { wallStuck++; break; }
      }
    }
    maxAgents = Math.max(maxAgents, s.agents.filter((a) => a.alive).length);
  }
  return { s, plants, kills, roundsDone, nanFound, wallStuck, seenPlants: seenPlants.size, maxAgents };
}
{
  const r = runBotMatch(42, 60 * 400);
  check('botmatch: rounds complete', r.roundsDone >= 2, `rounds=${r.roundsDone}`);
  check('botmatch: kills happen', r.kills >= 5, `kills=${r.kills}`);
  check('botmatch: no NaN positions', !r.nanFound);
  check('botmatch: nobody ends up inside a wall', r.wallStuck === 0, `stuck=${r.wallStuck}`);
  check('botmatch: bomb gets planted', r.seenPlants >= 1, `plants=${r.plants} roundsWithPlant=${r.seenPlants}`);
  check('botmatch: scores advance', r.s.score.alpha + r.s.score.bravo >= 2);
}
// Determinism: same seed, same story.
{
  const r1 = runBotMatch(99, 60 * 200);
  const r2 = runBotMatch(99, 60 * 200);
  const sig = (r) => JSON.stringify([r.s.score, r.kills, r.plants, r.s.agents.map((a) => [a.kills, a.deaths, Math.round(a.pos[0] * 100), Math.round(a.pos[2] * 100)])]);
  check('botmatch: deterministic for a fixed seed', sig(r1) === sig(r2));
}

console.log(`\nsimtest: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
