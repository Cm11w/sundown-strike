// Round + match state machine: freeze (5s) -> live (115s, or 40s fuse once
// planted) -> roundEnd (4s) -> next freeze; halftime swap after round 12;
// matchEnd at 13 rounds won, or after sudden-death round 25. Win conditions:
// elimination (attackers all dead + bomb unplanted -> defenders; defenders
// all dead + bomb planted -> attackers), time (clock 0, bomb unplanted ->
// defenders), explosion (-> attackers), defuse (-> defenders). The asymmetry
// matters: wiping the defenders does NOT end the round if the bomb is not
// planted — the attackers must still plant. That rule creates retakes, saves
// and clutch defusals.
import { MATCH, ECONOMY } from './config.js';
import { MAP } from './mapdata.js';
import { placeAtSpawn } from './player.js';
import { giveStarterKit, makeWeaponState, squadOf, aliveOf, roleOf, attackingSquad, defendingSquad, playerOf, pushEvent } from './state.js';
import { awardRoundEnd, squadBuyPlan, botBuy } from './economy.js';
import { updateBombFuse, updateBombPickup } from './bomb.js';
import { onRoundStartBot } from './bots.js';

export function startMatch(s) {
  s.round = 0;
  s.half = 0;
  s.score = { alpha: 0, bravo: 0 };
  s.lossStreak = { alpha: 0, bravo: 0 };
  s.roundHistory = [];
  s.winner = null;
  s.mvp = null;
  for (const a of s.agents) {
    a.money = ECONOMY.startMoney;
    a.kills = 0; a.deaths = 0; a.assists = 0; a.headshots = 0; a.damage = 0;
    a.shotsFired = 0; a.shotsHit = 0; a.plants = 0; a.defuses = 0;
    giveStarterKit(a);
  }
  startRound(s);
}

function assignRoles(s) {
  for (const a of s.agents) a.role = roleOf(s, a.squad);
}

function stripDead(s) {
  // Death is expensive: the dead lose primary, sidearm upgrade, grenades,
  // armor and kit. Survivors keep everything — saving is profitable.
  for (const a of s.agents) {
    if (a.alive) continue;
    a.primary = null;
    a.secondary = makeWeaponState('sidearm');
    a.melee = makeWeaponState('knife');
    a.slot = 'secondary';
    a.grenades = { frag: 0, smoke: 0, flash: 0 };
    a.armor = false; a.helmet = false; a.defuseKit = false;
  }
}

export function startRound(s) {
  s.round += 1;
  assignRoles(s);
  stripDead(s);
  s.bombPlanted = false;
  s.bombSite = null;
  s.bombPos = null;
  s.bombFuse = 0;
  s.bombDropped = null;
  s.grenades = [];
  s.smokes = [];
  s.roundKills = [];
  s.roundWinner = null;
  s.roundReason = '';
  s.roundLiveT = 0;
  // Spawns: each squad lines up at its role's spawn points.
  const counters = { guard: 0, raider: 0 };
  for (const a of s.agents) {
    const list = MAP.spawns[a.role];
    const spawn = list[counters[a.role] % list.length];
    counters[a.role] += 1;
    placeAtSpawn(a, spawn);
    a.roundKills = 0;
  }
  // Enter freeze BEFORE buying: canBuy requires the freeze/buy window, and
  // the bots stand in their buy zones at spawn.
  s.phase = 'freeze';
  s.phaseT = MATCH.freezeTime;
  // Squad buy plans first: strategy picks (eco -> default, full -> execute)
  // depend on the same plan the bots will spend by.
  const plans = { alpha: squadBuyPlan(s, 'alpha'), bravo: squadBuyPlan(s, 'bravo') };
  for (const a of s.agents) if (a.bot) a.bot.plan = plans[a.squad];
  for (const a of s.agents) if (a.bot) onRoundStartBot(s, a);
  // Bomb carrier: a random living attacker (the player can carry too).
  const attackers = squadOf(s, attackingSquad(s));
  const carrier = attackers[Math.floor(s.rng.next() * attackers.length)];
  carrier.hasBomb = true;
  s.bombCarrierId = carrier.id;
  // Bots buy as squads, following the shared plan.
  for (const squad of ['alpha', 'bravo']) {
    for (const a of squadOf(s, squad)) {
      if (!a.isPlayer && a.bot) botBuy(s, a, plans[squad]);
    }
  }
  pushEvent(s, { type: 'roundStart', round: s.round });
}

export function endRound(s, winner, reason) {
  if (s.phase === 'roundEnd' || s.phase === 'matchEnd') return;
  s.roundWinner = winner;
  s.roundReason = reason;
  s.score[winner] += 1;
  const pays = awardRoundEnd(s, winner);
  s.roundHistory.push({ round: s.round, winner, reason, scoreA: s.score.alpha, scoreB: s.score.bravo });
  // The bomb stops mattering the moment the round ends.
  s.bombPlanted = false;
  pushEvent(s, { type: 'roundEnd', winner, reason, pays });
  // Match decided?
  const decided = s.score[winner] >= MATCH.winRounds || s.round >= MATCH.maxRounds + 1;
  if (decided) {
    s.phase = 'matchEnd';
    s.phaseT = 0;
    s.winner = winner;
    s.mvp = computeMvp(s);
    pushEvent(s, { type: 'matchEnd', winner, mvp: s.mvp });
    return;
  }
  s.phase = 'roundEnd';
  s.phaseT = MATCH.roundEndDelay;
}

function computeMvp(s) {
  let best = null, bestScore = -1;
  for (const a of s.agents) {
    const sc = a.kills * 2 + a.assists + a.plants * 3 + a.defuses * 3 + a.damage / 120;
    if (sc > bestScore) { bestScore = sc; best = a; }
  }
  return best;
}

export function updateRounds(s, dt) {
  if (s.phase === 'freeze') {
    s.phaseT -= dt;
    if (s.phaseT <= 0) {
      s.phase = 'live';
      s.phaseT = MATCH.roundTime;
      pushEvent(s, { type: 'live' });
    }
    return;
  }
  if (s.phase === 'live') {
    s.roundLiveT += dt;
    updateBombPickup(s);
    if (s.bombPlanted) {
      updateBombFuse(s, dt, () => endRound(s, attackingSquad(s), 'explosion'));
      s.phaseT = Math.max(0, s.bombFuse);
    } else {
      s.phaseT -= dt;
    }
    if (s.phase !== 'live') return; // bomb decided the round
    // A completed defuse sets roundWinner directly (see bomb.js).
    if (s.roundWinner) { endRound(s, s.roundWinner, s.roundReason); return; }
    const attAlive = aliveOf(s, attackingSquad(s)).length;
    const defAlive = aliveOf(s, defendingSquad(s)).length;
    if (attAlive === 0 && !s.bombPlanted) {
      endRound(s, defendingSquad(s), 'elimination');
      return;
    }
    if (defAlive === 0 && s.bombPlanted) {
      endRound(s, attackingSquad(s), 'elimination');
      return;
    }
    if (!s.bombPlanted && s.phaseT <= 0) {
      endRound(s, defendingSquad(s), 'time');
      return;
    }
    return;
  }
  if (s.phase === 'roundEnd') {
    s.phaseT -= dt;
    if (s.phaseT <= 0) {
      if (s.round === MATCH.roundsPerHalf && s.half === 0) {
        // Halftime: sides swap, loss streaks reset, money carries over.
        s.half = 1;
        s.lossStreak = { alpha: 0, bravo: 0 };
        s.phase = 'halftime';
        s.phaseT = 5.0;
        pushEvent(s, { type: 'halftime' });
      } else {
        startRound(s);
      }
    }
    return;
  }
  if (s.phase === 'halftime') {
    s.phaseT -= dt;
    if (s.phaseT <= 0) startRound(s);
  }
}

// Human-readable round timer: the fuse replaces the clock once planted.
export function roundClock(s) {
  if (s.phase === 'freeze') return { label: 'BUY', t: Math.max(0, s.phaseT), urgent: false };
  if (s.phase === 'live') {
    if (s.bombPlanted) return { label: 'BOMB', t: Math.max(0, s.bombFuse), urgent: s.bombFuse < 10 };
    return { label: 'ROUND', t: Math.max(0, s.phaseT), urgent: s.phaseT < 15 };
  }
  if (s.phase === 'roundEnd') return { label: s.roundReason.toUpperCase(), t: s.phaseT, urgent: false };
  if (s.phase === 'halftime') return { label: 'HALFTIME', t: s.phaseT, urgent: false };
  return { label: '', t: 0, urgent: false };
}
