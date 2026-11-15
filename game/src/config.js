// SUNDOWN STRIKE — every tuning number in one place; no magic numbers hide
// in the sim. MACRO: rifle+armor+utility costs ~$3,850 vs a $3,250 win payout,
// so force-buy / eco / full-buy is a real decision and saving a rifle beats
// chasing a $300 kill. MICRO: spread/recoil/damage reward standing still and
// counter-strafing over spraying on the run; headshots pay 3-4x.

export const MATCH = {
  roundsPerHalf: 12,      // MR12: first to 13 wins, sides swap after round 12
  winRounds: 13,
  maxRounds: 24,          // 12-12 goes to one sudden-death round (round 25)
  teamSize: 5,
  freezeTime: 5.0,        // seconds: buy + plan, nobody moves
  buyTime: 15.0,          // buy menu stays open this long after freeze ends
  roundTime: 115.0,       // seconds until defenders win on time (bomb not planted)
  bombTime: 40.0,         // fuse after plant
  plantTime: 3.0,
  defuseTime: 10.0,
  defuseTimeKit: 5.0,
  roundEndDelay: 4.0,     // banner + freeze before the next round starts
  spawnProtect: 0.0,
};

export const ECONOMY = {
  startMoney: 800,
  maxMoney: 16000,
  killReward: 300,
  knifeReward: 600,       // knife kills pay double: high risk, high reward
  winReward: 3250,
  lossBase: 1900,
  lossStep: 500,          // consecutive-loss ladder: 1900 / 2400 / 2900 / 3400
  lossCap: 3400,
  plantBonus: 300,        // every attacker gets this when the bomb goes down
  defuseBonus: 300,
  prices: {
    rifle: 2700, smg: 1500, shotgun: 1200, sniper: 4750,
    sidearm: 0, handcannon: 700, knife: 0,
    armor: 650, helmet: 350, defuseKit: 400,
    frag: 300, smoke: 300, flash: 200,
  },
};

// damage = close-range body damage; falloff lerps it from falloffNear to
// falloffFar. hs = headshot multiplier. spread = degrees (1-sigma gaussian
// cone); bloom adds per shot and decays. movePenalty = extra spread degrees
// at full run speed. Patterns live in RECOIL_PATTERNS below.
export const WEAPONS = {
  rifle: {
    name: 'KR-7 Carbine', slot: 'primary', kind: 'auto', price: 2700,
    damage: 26, hs: 4.0, falloffNear: 20, falloffFar: 42, falloffFrac: 0.72,
    rpm: 600, mag: 30, reserve: 90, reload: 2.5, pellets: 1,
    spread: 0.35, bloom: 0.42, bloomDecay: 9.0, movePenalty: 2.6, airPenalty: 4.5,
    crouchBonus: 0.55, adsBonus: 0.5, adsFov: 52, recoil: 0.42, recoilYaw: 0.14,
    recoilRecover: 7.0, armorPen: 0.75, speed: 0.94, kick: 0.9,
    range: 120, sound: 'rifle',
  },
  smg: {
    name: 'VK-9 Ripper', slot: 'primary', kind: 'auto', price: 1500,
    damage: 22, hs: 3.5, falloffNear: 12, falloffFar: 30, falloffFrac: 0.55,
    rpm: 750, mag: 32, reserve: 96, reload: 2.2, pellets: 1,
    spread: 0.5, bloom: 0.38, bloomDecay: 10.0, movePenalty: 1.9, airPenalty: 4.0,
    crouchBonus: 0.6, adsBonus: 0.55, adsFov: 56, recoil: 0.32, recoilYaw: 0.16,
    recoilRecover: 8.0, armorPen: 0.6, speed: 0.98, kick: 0.7,
    range: 90, sound: 'smg',
  },
  shotgun: {
    name: 'SG-12 Scattergun', slot: 'primary', kind: 'pump', price: 1200,
    damage: 9, hs: 2.0, falloffNear: 6, falloffFar: 18, falloffFrac: 0.3,
    rpm: 68, mag: 6, reserve: 24, reload: 2.9, pellets: 8,
    spread: 2.4, bloom: 0.9, bloomDecay: 6.0, movePenalty: 1.6, airPenalty: 3.5,
    crouchBonus: 0.7, adsBonus: 0.7, adsFov: 60, recoil: 1.6, recoilYaw: 0.3,
    recoilRecover: 5.0, armorPen: 0.5, speed: 0.96, kick: 2.2,
    range: 45, sound: 'shotgun',
  },
  sniper: {
    name: 'LR-50 Longshot', slot: 'primary', kind: 'bolt', price: 4750,
    damage: 110, hs: 2.0, falloffNear: 999, falloffFar: 1000, falloffFrac: 1.0,
    rpm: 42, mag: 5, reserve: 15, reload: 3.5, pellets: 1,
    spread: 0.05, bloom: 0.0, bloomDecay: 8.0, movePenalty: 6.0, airPenalty: 9.0,
    crouchBonus: 0.5, adsBonus: 0.1, adsFov: 22, recoil: 2.4, recoilYaw: 0.2,
    recoilRecover: 4.0, armorPen: 0.95, speed: 0.90, kick: 3.0,
    range: 200, sound: 'sniper', scopedOnly: true, unscopedSpread: 7.0,
  },
  sidearm: {
    name: 'P9 Sidearm', slot: 'secondary', kind: 'semi', price: 0,
    damage: 20, hs: 3.0, falloffNear: 15, falloffFar: 35, falloffFrac: 0.65,
    rpm: 340, mag: 12, reserve: 48, reload: 1.8, pellets: 1,
    spread: 0.4, bloom: 0.5, bloomDecay: 10.0, movePenalty: 2.2, airPenalty: 4.0,
    crouchBonus: 0.6, adsBonus: 0.6, adsFov: 60, recoil: 0.5, recoilYaw: 0.15,
    recoilRecover: 9.0, armorPen: 0.55, speed: 1.0, kick: 0.6,
    range: 80, sound: 'pistol',
  },
  handcannon: {
    name: 'DH-44 Handcannon', slot: 'secondary', kind: 'semi', price: 700,
    damage: 45, hs: 3.0, falloffNear: 18, falloffFar: 40, falloffFrac: 0.7,
    rpm: 170, mag: 7, reserve: 21, reload: 2.2, pellets: 1,
    spread: 0.35, bloom: 0.9, bloomDecay: 7.0, movePenalty: 2.0, airPenalty: 4.0,
    crouchBonus: 0.55, adsBonus: 0.55, adsFov: 58, recoil: 1.1, recoilYaw: 0.2,
    recoilRecover: 6.0, armorPen: 0.8, speed: 0.98, kick: 1.4,
    range: 100, sound: 'handcannon',
  },
  knife: {
    name: 'Trench Blade', slot: 'melee', kind: 'melee', price: 0,
    damage: 55, hs: 1.0, falloffNear: 999, falloffFar: 1000, falloffFrac: 1.0,
    rpm: 150, mag: Infinity, reserve: Infinity, reload: 0, pellets: 1,
    spread: 0, bloom: 0, bloomDecay: 1, movePenalty: 0, airPenalty: 0,
    crouchBonus: 1, adsBonus: 1, adsFov: 70, recoil: 0, recoilYaw: 0,
    recoilRecover: 1, armorPen: 1.0, speed: 1.06, kick: 0, range: 1.35, sound: 'knife',
  },
};

// Recoil patterns: deterministic per-shot kick (pitch, yaw) in degrees —
// the rifle climbs and drifts right, then settles into an S-curve, so
// pulling down-left compensates. Small random jitter is added at fire time.
export const RECOIL_PATTERNS = {
  rifle: [[0.42, 0], [0.42, 0.05], [0.44, 0.1], [0.44, 0.12], [0.46, 0.08], [0.46, -0.02], [0.44, -0.1], [0.44, -0.12], [0.42, -0.08], [0.42, 0], [0.4, 0.06], [0.4, 0.1], [0.38, 0.06], [0.38, -0.04], [0.36, -0.08]],
  smg: [[0.32, 0], [0.32, 0.08], [0.34, 0.12], [0.34, 0.06], [0.32, -0.06], [0.32, -0.1], [0.3, -0.04], [0.3, 0.06], [0.3, 0.1], [0.28, 0.04]],
  shotgun: [[1.6, 0]],
  sniper: [[2.4, 0]],
  sidearm: [[0.5, 0], [0.5, 0.06], [0.52, -0.04], [0.5, 0.02]],
  handcannon: [[1.1, 0], [1.1, 0.08], [1.12, -0.06]],
  knife: [[0, 0]],
};

export const GRENADES = {
  frag: { name: 'Frag Charge', price: 300, fuse: 1.6, radius: 8.5, damage: 95, maxCarry: 1 },
  smoke: { name: 'Smoke Canister', price: 300, fuse: 1.2, radius: 4.2, duration: 16.0, maxCarry: 1 },
  flash: { name: 'Flash Charge', price: 200, fuse: 1.5, radius: 22.0, maxCarry: 2 },
};

export const MOVEMENT = {
  walkSpeed: 2.8,     // hold ALT: slow, footsteps silent
  runSpeed: 4.6,      // default: tactical pace, normal footstep volume
  sprintSpeed: 6.2,   // hold SHIFT: loud steps, large spread penalty
  crouchSpeed: 2.2,
  accel: 60,          // m/s^2 ground acceleration (snappy stops = counter-strafe)
  airAccel: 22,
  friction: 12,       // ground friction: releasing keys stops you in ~0.3s
  jumpVel: 5.4,
  gravity: 14.5,
  eyeStanding: 1.62,
  eyeCrouch: 1.1,
  radius: 0.38,       // capsule radius for collision
  height: 1.78,
  heightCrouch: 1.25,
  fallSafe: 7.0,      // landing speed (m/s) below this: no damage
  fallScale: 9.0,     // damage per m/s over the safe speed
  stepInterval: 0.42, // seconds between footstep sounds at run speed
  leanOffset: 0.34,
  leanRoll: 0.14,
};

// Reaction time = delay between seeing an enemy and the first shot. It is
// what makes jiggle-peeking work: bots cannot punish a 150ms exposure.
export const DIFFICULTY = {
  recruit: { label: 'Recruit', reaction: 0.48, aimErr: 4.2, burstLen: [2, 4], hearRadius: 22, aggression: 0.35, holdChance: 0.55 },
  regular: { label: 'Regular', reaction: 0.33, aimErr: 2.8, burstLen: [3, 5], hearRadius: 30, aggression: 0.55, holdChance: 0.4 },
  veteran: { label: 'Veteran', reaction: 0.22, aimErr: 1.7, burstLen: [3, 6], hearRadius: 38, aggression: 0.7, holdChance: 0.3 },
};

// Squads keep their identity, colours and score for the whole match; ROLES
// (attack/defend) swap at halftime, like real tactical FPS. An agent has a
// persistent `squad` and a per-half `role`: 'guard' defends the sites,
// 'raider' carries the bomb. Spawns in mapdata are keyed by role.
export const SQUADS = {
  alpha: { name: 'Harbor Guard', short: 'GRD', color: 0x3fa7c4, css: '#46b8d8' },
  bravo: { name: 'Dusk Raiders', short: 'RSK', color: 0xd88a3a, css: '#e89a4a' },
};
export const ROLES = { guard: 'guard', raider: 'raider' };

export const BOT_NAMES = [
  'Mara', 'Kestrel', 'Bram', 'Sable', 'Onyx', 'Rook', 'Tarn', 'Vesper', 'Juno', 'Falk',
];
