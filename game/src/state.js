// Single state store. Everything the sim needs lives in one object from
// createState; rendering reads it, never duplicates it. The fixed-step sim is
// the only writer during a round; UI writes only through action functions
// (buy, plant, settings) exported by their own modules.
import { makeRng } from './rng.js';
import { MATCH, ECONOMY, WEAPONS, BOT_NAMES } from './config.js';

let nextAgentId = 1;

export function makeAgent(squad, isPlayer, name) {
  const a = {
    id: nextAgentId++, name, squad, isPlayer,
    role: 'guard', // set per half by rounds.js
    pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0,
    hp: 100, armor: false, helmet: false, alive: true,
    crouching: false, crouchAmt: 0, onGround: true, lean: 0, leanTarget: 0,
    slot: 'primary', // 'primary' | 'secondary' | 'melee' | 'grenade'
    primary: null, secondary: null, melee: null,
    grenades: { frag: 0, smoke: 0, flash: 0 }, grenadeSel: 'frag',
    defuseKit: false, hasBomb: false,
    money: ECONOMY.startMoney,
    // Weapon runtime state
    cooldown: 0, reloadT: 0, reloadSlot: null, bloom: 0, patternIdx: 0,
    recoil: [0, 0], ads: 0, adsTarget: 0, switchT: 0,
    // Effects on this agent
    flashT: 0, flashPeak: 0, shake: 0,
    // Movement animation + audio
    bobPhase: 0, stepAcc: 0, fallVy: 0, moving: false, speedFrac: 0,
    // Bomb interaction
    action: null, // {kind:'plant'|'defuse', t, total, site}
    // Stats (match totals)
    kills: 0, deaths: 0, assists: 0, headshots: 0, damage: 0,
    shotsFired: 0, shotsHit: 0, plants: 0, defuses: 0, roundKills: 0,
    damageTaken: {}, // agentId -> damage this round (assist tracking)
    lastHitBy: 0, lastHitTime: -99,
    // Bot brain (null for the player)
    bot: null,
    // Render handles (set by world.js / viewmodel.js, never read by the sim)
    mesh: null, gunMesh: null, deadT: 0, deathYaw: 0,
    muzzleT: 0,
  };
  return a;
}

export function makeWeaponState(id) {
  const w = WEAPONS[id];
  return { id, mag: w.mag === Infinity ? Infinity : w.mag, reserve: w.reserve };
}

export function giveStarterKit(a) {
  a.secondary = makeWeaponState('sidearm');
  a.melee = makeWeaponState('knife');
  a.primary = null;
  a.slot = 'secondary';
  a.armor = false; a.helmet = false; a.defuseKit = false;
  a.grenades = { frag: 0, smoke: 0, flash: 0 };
}

export function createState(seed, opts = {}) {
  // Agent ids restart per match: behaviour must not depend on how many
  // matches this process has created (determinism across runs).
  nextAgentId = 1;
  const rng = makeRng(seed);
  const s = {
    seed, rng,
    time: 0, // sim seconds since match start
    tick: 0,
    settings: {
      sensitivity: opts.sensitivity ?? 1.0,
      volume: opts.volume ?? 0.8,
      quality: opts.quality ?? 'high', // high | low (shadows, particles)
      difficulty: opts.difficulty ?? 'regular',
      playerSquad: opts.playerSquad ?? 'alpha',
      startsDefending: opts.startsDefending ?? true,
      fov: 75,
    },
    agents: [],
    // Match + round
    phase: 'menu', // menu | freeze | live | roundEnd | halftime | matchEnd
    phaseT: 0,     // time left in the current phase
    roundLiveT: 0, // seconds since the round went live (drives buy time)
    round: 0,      // 1-based once the match starts
    half: 0,
    score: { alpha: 0, bravo: 0 },
    lossStreak: { alpha: 0, bravo: 0 },
    roundHistory: [], // {round, winner, reason, scoreA, scoreB}
    roundWinner: null, roundReason: '',
    bombPlanted: false, bombSite: null, bombPos: null, bombFuse: 0,
    bombCarrierId: 0,
    bombDropped: null, // [x,y,z] when the carrier died holding it
    roundKills: [],    // killfeed entries, newest first (capped)
    events: [],        // transient sim events for audio/FX/HUD this tick
    grenades: [],      // live thrown grenades
    smokes: [],        // active smoke volumes {pos, radius, until}
    flashes: [],       // visual flash pops {pos, t}
    tracers: [],       // visual tracer segments (render-owned, sim fills)
    decals: [],        // impact decals (render-owned)
    mvp: null,
    winner: null,
    shotMode: null,    // screenshot staging mode (null in normal play)
  };
  // Squads: 5 each. The player is index 0 of their squad; bots fill the rest.
  const names = [...BOT_NAMES];
  const mkSquad = (squad, withPlayer) => {
    for (let i = 0; i < MATCH.teamSize; i++) {
      const isPlayer = withPlayer && i === 0;
      const name = isPlayer ? 'You' : names.splice(Math.floor(rng.next() * names.length), 1)[0];
      const a = makeAgent(squad, isPlayer, name);
      giveStarterKit(a);
      s.agents.push(a);
    }
  };
  mkSquad('alpha', s.settings.playerSquad === 'alpha');
  mkSquad('bravo', s.settings.playerSquad === 'bravo');
  return s;
}

export function playerOf(s) { return s.agents.find((a) => a.isPlayer); }
export function squadOf(s, squad) { return s.agents.filter((a) => a.squad === squad); }
export function aliveOf(s, squad) { return s.agents.filter((a) => a.squad === squad && a.alive); }
export function roleOf(s, squad) {
  // Half 0: alpha defends if the player starts defending, else attacks.
  const alphaDefends = s.half === 0 ? s.settings.startsDefending : !s.settings.startsDefending;
  const defends = squad === 'alpha' ? alphaDefends : !alphaDefends;
  return defends ? 'guard' : 'raider';
}
export function attackingSquad(s) {
  return roleOf(s, 'alpha') === 'raider' ? 'alpha' : 'bravo';
}
export function defendingSquad(s) {
  return roleOf(s, 'alpha') === 'guard' ? 'alpha' : 'bravo';
}
export function currentWeapon(a) {
  if (a.slot === 'primary') return a.primary;
  if (a.slot === 'secondary') return a.secondary;
  if (a.slot === 'melee') return a.melee;
  return null;
}
export function pushEvent(s, ev) { s.events.push(ev); }
export function pushKillfeed(s, entry) {
  s.roundKills.unshift(entry);
  if (s.roundKills.length > 6) s.roundKills.length = 6;
}
