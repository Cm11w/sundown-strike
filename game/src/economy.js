// Economy: the MACRO engine. Win +$3,250; loss +$1,900/2,400/2,900/3,400 on
// the streak ladder; kill +$300 (knife +$600); plant +$300 per attacker. A
// full buy (rifle+armor+helmet+utility) costs ~$4,500, so force-buying after
// a loss and losing again leaves the squad broke for two rounds, while an
// eco ($0-500) funds a full buy next round. Bots follow the same rules and
// buy together from the squad's average money, never per-bot.
import { ECONOMY, WEAPONS, GRENADES, MATCH } from './config.js';
import { makeWeaponState, squadOf, pushEvent } from './state.js';
import { MAP } from './mapdata.js';

export function buyWindowOpen(s) {
  if (s.phase === 'freeze') return true;
  // Buy time runs from round start: freeze + buyTime total.
  if (s.phase === 'live' && s.roundLiveT < MATCH.buyTime) return true;
  return false;
}

export function inBuyZone(s, a) {
  const spawn = a.role === 'raider' ? MAP.spawns.raider[0] : MAP.spawns.guard[0];
  const dx = a.pos[0] - spawn[0], dz = a.pos[2] - spawn[1];
  return dx * dx + dz * dz < 14 * 14;
}

export function canBuy(s, a) {
  return buyWindowOpen(s) && inBuyZone(s, a) && a.alive;
}

// Why an item cannot be bought right now (null = available). Pure predicate:
// the buy menu shows exactly the rules the purchase enforces, so no button
// ever looks buyable and then denies.
export function buyBlockedReason(s, a, item) {
  if (!canBuy(s, a)) return 'Buy zone / buy time only';
  const price = item === 'ammo' ? 200 : ECONOMY.prices[item];
  if (price === undefined) return 'Unknown item';
  if (item === 'armor' && a.armor) return 'Already armored';
  if (item === 'helmet' && !a.armor) return 'Buy armor first';
  if (item === 'helmet' && a.helmet) return 'Already have a helmet';
  if (item === 'defuseKit' && a.role !== 'guard') return 'Defenders only';
  if (item === 'defuseKit' && a.defuseKit) return 'Already have a kit';
  if ((item === 'frag' || item === 'smoke' || item === 'flash') && a.grenades[item] >= GRENADES[item].maxCarry) return 'Carry limit';
  if (item === 'ammo') {
    const ws = a.primary || a.secondary;
    if (!ws) return 'No weapon';
    const w = WEAPONS[ws.id];
    if (w.mag === Infinity || ws.reserve >= w.reserve) return 'Ammo full';
  }
  if (a.money < price) return 'Not enough money';
  return null;
}

// Buy one item. Returns {ok, reason}. No refunds: buying a primary replaces
// the old one, which is the trade-off that makes saving matter.
export function buyItem(s, a, item) {
  const blocked = buyBlockedReason(s, a, item);
  if (blocked) return { ok: false, reason: blocked };
  const P = ECONOMY.prices;
  a.money -= item === 'ammo' ? 200 : P[item];
  if (item === 'rifle' || item === 'smg' || item === 'shotgun' || item === 'sniper') {
    a.primary = makeWeaponState(item);
    a.slot = 'primary';
  } else if (item === 'handcannon') {
    a.secondary = makeWeaponState('handcannon');
    a.slot = 'secondary';
  } else if (item === 'armor') {
    a.armor = true;
  } else if (item === 'helmet') {
    a.helmet = true;
  } else if (item === 'defuseKit') {
    a.defuseKit = true;
  } else if (item === 'frag' || item === 'smoke' || item === 'flash') {
    a.grenades[item] += 1;
  } else if (item === 'ammo') {
    const ws = a.primary || a.secondary;
    ws.reserve = WEAPONS[ws.id].reserve;
  }
  a.switchT = 0.25;
  pushEvent(s, { type: 'buy', agent: a, item });
  return { ok: true };
}

// Round-end payouts. `winner` is a squad id. Loss streaks drive the ladder.
export function awardRoundEnd(s, winner) {
  const loser = winner === 'alpha' ? 'bravo' : 'alpha';
  s.lossStreak[winner] = 0;
  s.lossStreak[loser] += 1;
  const lossPay = Math.min(ECONOMY.lossCap, ECONOMY.lossBase + ECONOMY.lossStep * (s.lossStreak[loser] - 1));
  for (const a of s.agents) {
    const pay = a.squad === winner ? ECONOMY.winReward : lossPay;
    a.money = Math.min(ECONOMY.maxMoney, a.money + pay);
  }
  return { winPay: ECONOMY.winReward, lossPay };
}

// Squad buy strategy, decided ONCE per round from the squad's average money:
//   avg >= 4200  -> full buy (rifle + armor + helmet + utility)
//   avg >= 2400  -> force buy (SMG/shotgun + armor, or rifle if one bot affords)
//   avg >= 1200  -> light force (pistol upgrade + a grenade)
//   else         -> eco (save everything)
// Match point and round 1 override toward force: losing the match point round
// ends the game, so there is nothing to save for.
export function squadBuyPlan(s, squad) {
  const members = squadOf(s, squad);
  const avg = members.reduce((t, a) => t + a.money, 0) / members.length;
  const matchPoint = s.score[squad] >= MATCH.winRounds - 1;
  const lastRound = s.round >= MATCH.maxRounds;
  if (avg >= 4200 || matchPoint || lastRound) return 'full';
  if (avg >= 2400) return 'force';
  if (avg >= 1200) return 'light';
  return 'eco';
}

// Execute a bot's buy for the round following the squad plan. Bots spend in
// priority order: primary -> armor -> helmet -> utility, and never spend the
// squad into a broken next round on an eco.
export function botBuy(s, a, plan) {
  const P = ECONOMY.prices;
  const tryBuy = (item) => buyItem(s, a, item).ok;
  if (plan === 'eco') {
    // Eco: at most a flash, keep the rest. Pistol round discipline.
    if (a.money >= 900) tryBuy('flash');
    return;
  }
  if (plan === 'light') {
    if (!a.primary && a.money >= P.smg + 200) tryBuy('smg');
    else if (a.money >= P.handcannon + 200) tryBuy('handcannon');
    if (a.money >= P.flash + 100) tryBuy('flash');
    return;
  }
  if (plan === 'force') {
    if (!a.primary) {
      if (a.money >= P.rifle + P.armor) tryBuy('rifle');
      else if (a.money >= P.smg) tryBuy('smg');
      else if (a.money >= P.shotgun) tryBuy('shotgun');
    }
    if (a.money >= P.armor) tryBuy('armor');
    if (a.money >= P.flash) tryBuy('flash');
    return;
  }
  // full buy
  if (!a.primary) {
    // One bot per squad takes the sniper when the squad is rich.
    const mates = squadOf(s, a.squad);
    const hasSniper = mates.some((m) => m.primary && m.primary.id === 'sniper');
    if (!hasSniper && a.money >= P.sniper + P.armor + P.helmet && s.rng.chance(0.5)) tryBuy('sniper');
    else if (a.money >= P.rifle) tryBuy('rifle');
    else if (a.money >= P.smg) tryBuy('smg');
  }
  if (a.money >= P.armor) tryBuy('armor');
  if (a.money >= P.helmet) tryBuy('helmet');
  if (a.role === 'guard' && a.money >= P.defuseKit) tryBuy('defuseKit');
  if (a.money >= P.frag) tryBuy('frag');
  if (a.money >= P.smoke) tryBuy('smoke');
  if (a.money >= P.flash) tryBuy('flash');
  if (a.money >= P.flash && a.grenades.flash < 2) tryBuy('flash');
}
