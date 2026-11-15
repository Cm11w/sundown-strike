// SUNDOWN STRIKE — bootstrap + fixed-step game loop.
//
// The sim runs at a fixed 60 Hz, decoupled from rendering: an accumulator
// steps the simulation (rounds, bots, grenades, combat) while rendering draws
// the latest state each animation frame. Full flow: menu -> team select ->
// freeze/buy -> live rounds -> halftime -> match end, with every system
// (economy, bomb, bots, grenades, stats) live.
// Import order is deliberate: the gameplay systems first, presentation last,
// so a reader meets the game before its rendering.
import * as THREE from 'three';
import { createState, playerOf, currentWeapon } from './state.js';
import { fireWeapon, meleeSwing, startReload, switchSlot, updateWeaponState, eyePos } from './combat.js';
import { updateMovement } from './player.js';
import { initBots, updateBots } from './bots.js';
import { startMatch, updateRounds } from './rounds.js';
import { buildHud, updateHud, showHitmarker, showDamageFrom, showBanner, renderScoreboard, noteEnemyShot } from './hud.js';
import { buildUi } from './ui.js';
import { Input } from './input.js';
import { buildEffects } from './effects.js';
import { buildViewmodelRig } from './viewmodel.js';
import { buildTextures } from './textures.js';
import { buildWorld, buildAgentMesh, buildBombMesh } from './world.js';
import { AudioSys } from './audio.js';
import { updateGrenades, throwGrenade } from './grenades.js';
import { updateBombAction as bombAction } from './bomb.js';
import { buyItem, canBuy } from './economy.js';
import { WEAPONS, MATCH } from './config.js';
import { clamp, DEG } from './mathx.js';

// --- URL params ------------------------------------------------------------
const params = new URLSearchParams(location.search);
const SEED = parseInt(params.get('seed') || '20261115', 10) || 1;
const SHOT = params.get('shot'); // start | play | site | buy
const QUALITY_PARAM = params.get('quality');

// --- Renderer --------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);
// Dim camera fill: keeps the viewmodel gun + hands readable when the low sun
// leaves them in shadow. Short range, so the world is barely touched.
const camLight = new THREE.PointLight(0xffd9b0, 0.7, 3.5, 2);
camera.add(camLight);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Game objects ----------------------------------------------------------
const audio = new AudioSys();
const input = new Input();
const T = buildTextures();
let quality = QUALITY_PARAM || 'high';
function applyQuality(q) {
  quality = q;
  renderer.setPixelRatio(q === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2));
}
applyQuality(quality);
const world = buildWorld(scene, T, quality);
const fx = buildEffects(scene, T, quality);
const vm = buildViewmodelRig(camera, T);

let s = createState(SEED, { quality });
initBots(s);

// Agent meshes (bots only — the player is first-person).
const agentMeshes = new Map();
for (const a of s.agents) {
  if (a.isPlayer) continue;
  const m = buildAgentMesh(a.squad, T);
  scene.add(m.group);
  agentMeshes.set(a.id, m);
  a.mesh = m;
}
const bombMesh = buildBombMesh(T);
bombMesh.group.visible = false;
scene.add(bombMesh.group);
// Thrown-grenade meshes (pool).
const nadeMeshes = [];
{
  const geo = new THREE.SphereGeometry(0.11, 10, 8);
  const mats = {
    frag: new THREE.MeshStandardMaterial({ color: 0x2a2c28, roughness: 0.5, metalness: 0.5 }),
    smoke: new THREE.MeshStandardMaterial({ color: 0x5a6258, roughness: 0.6 }),
    flash: new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.6 }),
  };
  for (let i = 0; i < 8; i++) {
    const grp = new THREE.Group();
    const m = new THREE.Mesh(geo, mats.frag);
    grp.add(m);
    grp.visible = false;
    scene.add(grp);
    nadeMeshes.push({ grp, mesh: m, mats });
  }
}

// --- HUD / UI ---------------------------------------------------------------
const H = buildHud();
let playing = false; // sim is running (a match is in progress)
let paused = false;
let buyOpen = false;
let prevFire = false, prevAds = false;
let lookVel = [0, 0];
let shake = 0;
let deathCamT = 0;

const U = buildUi({
  audio,
  onStart(settings) {
    audio.ensure();
    audio.startAmbience();
    startNewMatch(settings);
  },
  onBuy(item) {
    const p = playerOf(s);
    const res = buyItem(s, p, item);
    if (res.ok) { audio.buy(); U.renderBuy(s); }
    else { audio.deny(); U.buyMessage(res.reason, false); }
  },
  onBuyClose() { closeBuy(); },
  onResume() { resumeGame(); },
  onRestart() { startNewMatch(U.getSettings()); },
  onQuitToMenu() {
    playing = false; paused = false; buyOpen = false;
    U.hideBuy(); U.showMenu();
    H.root.style.display = 'none';
    input.releaseLock();
    s.phase = 'menu';
  },
  onSettings(settings) {
    s.settings.sensitivity = settings.sensitivity;
    s.settings.volume = settings.volume;
    audio.setVolume(settings.volume);
    if (settings.quality !== quality) applyQuality(settings.quality);
  },
});

function startNewMatch(settings) {
  const seed = SHOT ? SEED : (Date.now() % 100000000);
  s = createState(seed, {
    sensitivity: settings.sensitivity, volume: settings.volume,
    quality: settings.quality, difficulty: settings.difficulty,
    startsDefending: settings.startsDefending,
  });
  initBots(s);
  audio.setVolume(settings.volume);
  applyQuality(settings.quality);
  // Rebind meshes to the fresh agents (same squads, same ids).
  for (const a of s.agents) {
    if (a.isPlayer) continue;
    const m = agentMeshes.get(a.id);
    if (m) { a.mesh = m; m.group.visible = true; m.group.rotation.set(0, 0, 0); }
  }
  startMatch(s);
  playing = true; paused = false; buyOpen = false;
  U.hideAll();
  H.root.style.display = 'block';
  input.requestLock();
  showBanner(H, `ROUND 1`, s.settings.startsDefending ? 'Defend the sites' : 'Plant the bomb', 2200);
}

function resumeGame() {
  paused = false;
  U.hideAll();
  input.requestLock();
}

function openBuy() {
  if (!canBuy(s, playerOf(s))) { audio.deny(); return; }
  buyOpen = true;
  U.showBuy(s);
  input.releaseLock();
}
function closeBuy() {
  buyOpen = false;
  U.hideBuy();
  if (playing && !paused) input.requestLock();
}

input.onLockLoss = () => {
  if (playing && !paused && !buyOpen && s.phase !== 'matchEnd' && s.phase !== 'menu' && !SHOT) {
    paused = true;
    U.showPause();
  }
};

// Click-to-lock fallback: if a lock request is ever rejected (Chrome refuses
// re-locks within ~1.25s of an exit, or when the document lacks focus), the
// game must never sit unpaused and input-dead. Clicking the game re-captures
// the mouse; menu clicks are excluded so buttons keep working.
document.addEventListener('click', (e) => {
  if (!playing || paused || buyOpen || input.locked) return;
  if (s.phase !== 'freeze' && s.phase !== 'live') return;
  if (e.target instanceof Element && e.target.closest('button, .overlay, select, input, a')) return;
  input.requestLock();
});

// Buy menu number keys.
const BUY_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
const BUY_IDS = ['rifle', 'smg', 'shotgun', 'sniper', 'handcannon', 'armor', 'helmet', 'defuseKit', 'frag', 'smoke', 'flash', 'ammo'];

// --- Audio spatial helpers ---------------------------------------------------
function spatialFor(p, pos) {
  const dx = pos[0] - p.pos[0], dy = (pos[1] || 0) - p.pos[1], dz = pos[2] - p.pos[2];
  const dist = Math.hypot(dx, dy, dz);
  const right = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)];
  const len = Math.hypot(dx, dz) || 1;
  const pan = (right[0] * dx + right[2] * dz) / len;
  return { dist, pan: clamp(pan, -1, 1) };
}

// --- Event consumption (sim -> audio/FX/HUD) ----------------------------------
const _v = [0, 0, 0];
function consumeEvents() {
  const p = playerOf(s);
  for (const ev of s.events) {
    switch (ev.type) {
      case 'shot': {
        const { dist, pan } = spatialFor(p, ev.agent.pos);
        audio.shot(ev.weapon, ev.agent === p ? 0 : dist, ev.agent === p ? 0 : pan);
        if (ev.agent === p) {
          vm.onFire(ev.weapon);
          if (ev.weapon !== 'knife') {
            const right = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)];
            fx.shell([p.pos[0] + right[0] * 0.3, p.pos[1] + 1.35, p.pos[2] + right[2] * 0.3], right);
          }
        } else {
          const m = agentMeshes.get(ev.agent.id);
          if (m) m.flash.material.opacity = 0.9;
          noteEnemyShot(H, s, ev.agent);
          if (dist < 18) {
            world.muzzleLight.position.set(ev.agent.pos[0], ev.agent.pos[1] + 1.35, ev.agent.pos[2]);
            world.muzzleLight.intensity = 14;
          }
        }
        s.noises.push({ pos: [...ev.agent.pos], team: ev.agent.squad, loud: ev.weapon === 'knife' ? 0.3 : 1, time: s.time });
        break;
      }
      case 'impact': {
        fx.impact(ev.pos, ev.dir || [0, 0, 1]);
        break;
      }
      case 'hitmark': {
        if (ev.attacker === p) {
          showHitmarker(H, ev.killed, ev.part === 'head');
          audio.hitmark(ev.part === 'head');
        }
        if (ev.victim && ev.victim !== p) {
          fx.blood([ev.victim.pos[0], ev.victim.pos[1] + 1.2, ev.victim.pos[2]]);
        }
        break;
      }
      case 'damaged': {
        if (ev.victim === p) {
          showDamageFrom(H, s, p, ev.from);
          audio.hurt();
          shake = Math.min(1, shake + 0.35);
        }
        break;
      }
      case 'kill': {
        if (ev.victim) fx.blood([ev.victim.pos[0], ev.victim.pos[1] + 1.0, ev.victim.pos[2]]);
        if (ev.victim === p) { deathCamT = 0; shake = Math.min(1, shake + 0.5); }
        break;
      }
      case 'step': {
        if (ev.agent !== p) {
          const { dist, pan } = spatialFor(p, ev.agent.pos);
          audio.step(dist, pan, ev.loud);
        }
        s.noises.push({ pos: [...ev.agent.pos], team: ev.agent.squad, loud: ev.loud, time: s.time });
        break;
      }
      case 'jump': {
        if (ev.agent !== p) { const { dist, pan } = spatialFor(p, ev.agent.pos); audio.step(dist, pan, 0.5); }
        break;
      }
      case 'throw': {
        const { dist, pan } = spatialFor(p, ev.agent.pos);
        audio.noise({ dur: 0.12, freq: 900, type: 'bandpass', gain: 0.2, dist, pan, q: 1.5 });
        break;
      }
      case 'explosion': {
        fx.explosion(ev.pos, !!ev.big);
        const { dist, pan } = spatialFor(p, ev.pos);
        audio.explosion(dist, pan, !!ev.big);
        if (dist < 20) shake = Math.min(1, shake + (1 - dist / 20) * (ev.big ? 1 : 0.6));
        s.noises.push({ pos: ev.pos, team: '', loud: 1.5, time: s.time });
        break;
      }
      case 'smokePop': fx.smokePop(ev.pos); break;
      case 'flashPop': {
        if (p.flashT > 0.3) audio.flashRing();
        break;
      }
      case 'beep': {
        const { dist, pan } = spatialFor(p, ev.pos);
        audio.beep(ev.frac, dist, pan);
        break;
      }
      case 'plantStart': audio.plantTick(); break;
      case 'defuseStart': audio.plantTick(); break;
      case 'planted': {
        audio.plantDone();
        showBanner(H, 'BOMB PLANTED', `Site ${ev.site} — ${s.settings.startsDefending ? 'defenders' : 'attackers'} hold!`, 2400);
        break;
      }
      case 'defused': {
        audio.defuseDone();
        showBanner(H, 'BOMB DEFUSED', `${ev.agent.name} saved the harbor`, 2400);
        break;
      }
      case 'bombPickup': if (ev.agent === p) audio.click(); break;
      case 'roundStart': {
        if (s.round > 1) showBanner(H, `ROUND ${s.round}`, '', 1600);
        break;
      }
      case 'roundEnd': {
        const won = ev.winner === p.squad;
        const reasonText = { elimination: 'Elimination', time: 'Time expired', explosion: 'Bomb detonated', defuse: 'Bomb defused' }[ev.reason] || ev.reason;
        showBanner(H, won ? 'ROUND WON' : 'ROUND LOST', `${reasonText} — ${won ? `+$${ev.pays.winPay}` : `+$${ev.pays.lossPay}`}`, 3000);
        audio.stinger(won);
        break;
      }
      case 'halftime': showBanner(H, 'HALFTIME', 'Sides swap — attack/defend roles reverse', 3200); break;
      case 'matchEnd': {
        U.renderEnd(s);
        U.showEnd();
        H.root.style.display = 'none';
        input.releaseLock();
        playing = false;
        break;
      }
      case 'buy': if (ev.agent === p) audio.buy(); break;
      default: break;
    }
  }
  s.events.length = 0;
  // Tracers from the sim become line effects.
  for (const t of s.tracers) fx.tracer(t.from, t.to);
  s.tracers.length = 0;
  s.decals.length = 0;
}

// --- Player tick ---------------------------------------------------------------
// Buy-menu keys work while the pointer is unlocked (mouse is on the menu).
function handleBuyKeys() {
  const p = playerOf(s);
  if (input.wasPressed('KeyB') || input.wasPressed('Escape')) closeBuy();
  for (let i = 0; i < BUY_KEYS.length; i++) {
    if (input.wasPressed(BUY_KEYS[i])) {
      const res = buyItem(s, p, BUY_IDS[i]);
      if (res.ok) { audio.buy(); U.renderBuy(s); }
      else { audio.deny(); U.buyMessage(res.reason, false); }
    }
  }
}

function playerTick(dt) {
  const p = playerOf(s);
  if (!p || !p.alive) return;
  // Look.
  const [mdx, mdy] = input.consumeMouse();
  const sens = 0.0022 * s.settings.sensitivity;
  lookVel = [mdx, mdy];
  p.yaw -= mdx * sens;
  p.pitch = clamp(p.pitch - mdy * sens, -1.45, 1.45);
  const live = s.phase === 'live';
  // Freeze time: look around and buy, but nobody moves or shoots.
  const mi = live ? input.moveInput() : { f: 0, s: 0, jump: false, crouch: false, walk: false, sprint: false, lean: 0 };
  // Fire / ADS (live only).
  const ws = currentWeapon(p);
  const firing = input.fireHeld && live;
  const fireEdge = firing && !prevFire;
  const adsEdge = input.adsHeld && !prevAds && live;
  if (p.slot === 'grenade') {
    if (fireEdge) throwGrenade(s, p, p.grenadeSel, 'throw');
    if (adsEdge) throwGrenade(s, p, p.grenadeSel, 'lob');
    p.adsTarget = 0;
  } else if (ws) {
    const w = WEAPONS[ws.id];
    p.adsTarget = input.adsHeld && w.kind !== 'melee' ? 1 : 0;
    if (ws.id === 'knife') {
      if (fireEdge) meleeSwing(s, p);
    } else if (w.kind === 'auto') {
      if (firing) {
        const before = ws.mag;
        fireWeapon(s, p);
        if (ws.mag === 0 && before === 0) audio.dryFire();
      }
    } else if (fireEdge) {
      const before = ws.mag;
      fireWeapon(s, p);
      if (ws.mag === 0 && before === 0) audio.dryFire();
    }
  }
  prevFire = input.fireHeld;
  prevAds = input.adsHeld;
  // Keys.
  if (input.wasPressed('KeyR')) { if (startReload(p)) audio.reload(); }
  if (input.wasPressed('Digit1')) switchSlot(p, 'primary');
  if (input.wasPressed('Digit2')) switchSlot(p, 'secondary');
  if (input.wasPressed('Digit3')) switchSlot(p, 'melee');
  if (input.wasPressed('Digit4')) switchSlot(p, 'grenade');
  if (input.wasPressed('KeyG')) {
    const order = ['frag', 'smoke', 'flash'];
    const idx = order.indexOf(p.grenadeSel);
    for (let k = 1; k <= 3; k++) {
      const next = order[(idx + k) % 3];
      if (p.grenades[next] > 0) { p.grenadeSel = next; break; }
    }
    if (p.grenades[p.grenadeSel] > 0) switchSlot(p, 'grenade');
  }
  if (input.wheelDelta !== 0) {
    const slots = ['primary', 'secondary', 'melee', 'grenade'];
    const cur = slots.indexOf(p.slot);
    const dir = input.wheelDelta > 0 ? 1 : -1;
    for (let k = 1; k <= 4; k++) {
      const next = slots[(cur + dir * k + 4) % 4];
      if (switchSlot(p, next)) break;
    }
  }
  if (input.wasPressed('KeyB')) openBuy();
  // Bomb action (hold F).
  const wantAction = input.keys.has('KeyF');
  bombAction(s, p, wantAction, dt);
  updateWeaponState(p, dt, firing);
  updateMovement(s, p, mi, dt);
  // Viewmodel sync.
  const vmId = p.slot === 'grenade' ? `grenade:${p.grenadeSel}` : (ws ? ws.id : 'knife');
  vm.show(vmId);
  // Flash decay (sim-side timer).
  if (p.flashT > 0) {
    p.flashT -= dt;
    if (p.flashT <= 0) p.flashPeak = 0;
  }
  // Reload sound trigger is on keypress; bots' reloads are silent-ish by design.
  input.endTick();
}

// --- Camera + mesh sync ---------------------------------------------------------
const _eye = new THREE.Vector3();
function syncRender(dt, time) {
  const p = playerOf(s);
  // Menu backdrop: slow orbit over the harbor (agents hidden until a match).
  if (!playing && s.phase === 'menu') {
    camera.position.set(-26 + Math.sin(time * 0.05) * 4, 7.5, -14 + Math.cos(time * 0.04) * 4);
    camera.lookAt(22, 1.5, -10);
    camera.fov = 60;
    camera.updateProjectionMatrix();
    for (const [, m] of agentMeshes) m.group.visible = false;
    vm.rig.visible = false;
    world.update(dt, time);
    fx.update(dt, s.time, s.smokes);
    return;
  }
  // Agents.
  for (const a of s.agents) {
    if (a.isPlayer) continue;
    const m = agentMeshes.get(a.id);
    if (!m) continue;
    const g = m.group;
    g.visible = true;
    g.position.set(a.pos[0], a.pos[1], a.pos[2]);
    g.rotation.y = a.yaw; // model forward is -Z; rotation.y = yaw faces the aim
    const crouchScale = 1 - a.crouchAmt * 0.22;
    g.scale.set(1, crouchScale, 1);
    if (!a.alive) {
      a.deadT += dt;
      const f = Math.min(1, a.deadT / 0.45);
      g.rotation.x = -Math.PI / 2 * f * 0.9;
      g.position.y = a.pos[1] + Math.sin(f * Math.PI) * 0.1 - f * 0.25;
      m.flash.material.opacity = 0;
      continue;
    }
    g.rotation.x = 0;
    // Walk cycle.
    const swing = a.moving ? Math.sin(a.bobPhase) * 0.55 : 0;
    m.legL.rotation.x = swing;
    m.legR.rotation.x = -swing;
    m.armL.rotation.x = -swing * 0.5 - 0.5;
    m.armR.rotation.x = swing * 0.5 - 0.5;
    m.head.rotation.x = a.pitch * 0.6;
    m.gun.rotation.x = a.pitch * 0.5;
    m.flash.material.opacity = Math.max(0, m.flash.material.opacity - dt * 20);
    if (a.muzzleT > 0) a.muzzleT -= dt;
  }
  // Bomb mesh.
  if (s.bombPlanted || s.bombDropped) {
    const bp = s.bombPlanted ? s.bombPos : s.bombDropped;
    bombMesh.group.visible = true;
    bombMesh.group.position.set(bp[0], bp[1] || 0, bp[2]);
    const blink = s.bombPlanted ? (Math.sin(time * (6 + (1 - s.bombFuse / MATCH.bombTime) * 18)) > 0 ? 1 : 0.15) : 0.7;
    bombMesh.glow.material.opacity = blink * 0.8;
  } else {
    bombMesh.group.visible = false;
  }
  // Thrown grenades.
  for (let i = 0; i < nadeMeshes.length; i++) {
    const nm = nadeMeshes[i];
    const g = s.grenades[i];
    if (g) {
      nm.grp.visible = true;
      nm.grp.position.set(g.pos[0], g.pos[1], g.pos[2]);
      nm.mesh.material = nm.mats[g.type];
    } else nm.grp.visible = false;
  }
  // Camera (first person).
  if (p) {
    eyePos(_v, p);
    const leanOff = p.lean * 0.34;
    const right = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)];
    shake = Math.max(0, shake - dt * 2.2);
    const shx = (Math.random() - 0.5) * shake * 0.06;
    const shy = (Math.random() - 0.5) * shake * 0.06;
    let camY = _v[1];
    if (!p.alive) {
      deathCamT += dt;
      camY = Math.max(0.45, _v[1] - Math.min(1, deathCamT / 0.6) * 1.0);
    }
    camera.position.set(_v[0] + right[0] * leanOff + shx, camY + Math.sin(p.bobPhase) * 0.012 * (p.moving ? 1 : 0) + shy, _v[2] + right[2] * leanOff);
    camera.rotation.y = p.yaw + p.recoil[1] * DEG;
    camera.rotation.x = p.pitch + p.recoil[0] * DEG;
    camera.rotation.z = p.lean * 0.14;
    // FOV: ADS narrows; sniper scope narrows hard and hides the viewmodel.
    const ws = currentWeapon(p);
    let targetFov = s.settings.fov;
    if (ws && p.slot !== 'grenade') {
      const w = WEAPONS[ws.id];
      targetFov = s.settings.fov + (w.adsFov - s.settings.fov) * p.ads;
    }
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
      camera.updateProjectionMatrix();
    }
    const scoped = ws && ws.id === 'sniper' && p.ads > 0.7;
    vm.rig.visible = !scoped && p.alive;
    // Muzzle light follows the player's shots.
    if (world.muzzleLight.intensity > 0) world.muzzleLight.intensity = Math.max(0, world.muzzleLight.intensity - dt * 160);
  }
  world.update(dt, time);
  fx.update(dt, s.time, s.smokes);
  vm.update(dt, p, lookVel, time);
  lookVel = [0, 0];
}

// --- Fixed-step loop -------------------------------------------------------------
const DT = 1 / 60;
let acc = 0, last = performance.now();
let shotFrozen = false;
function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (playing && !paused && !shotFrozen) {
    acc += elapsed;
    let steps = 0;
    while (acc >= DT && steps < 4) {
      tick(DT);
      acc -= DT;
      steps++;
    }
    if (steps === 4) acc = 0;
  }
  const p = playerOf(s);
  if (p && playing) {
    updateHud(H, s, elapsed);
    renderScoreboard(H, s, input.keys.has('Tab'));
  }
  // Once a screenshot is staged, the 3D frame stays exactly as staged (muzzle
  // flash, tracers, particles frozen); only the DOM HUD keeps refreshing.
  if (shotFrozen) { renderer.render(scene, camera); return; }
  syncRender(elapsed, now / 1000);
  renderer.render(scene, camera);
}

function tick(dt) {
  // Freeze: no movement, but timers + buy run.
  if (s.phase === 'freeze' || s.phase === 'live') {
    if (buyOpen) { handleBuyKeys(); input.endTick(); }
    else if (input.locked || SHOT) playerTick(dt);
    else input.endTick();
  }
  updateBots(s, dt);
  updateGrenades(s, dt);
  updateRounds(s, dt);
  // Bot flash decay.
  for (const a of s.agents) {
    if (!a.isPlayer && a.flashT > 0) {
      a.flashT -= dt;
      if (a.flashT <= 0) a.flashPeak = 0;
    }
  }
  consumeEvents();
  s.time += dt;
  s.tick++;
}

// --- Screenshot staging -----------------------------------------------------------
function stageShot() {
  // Deterministic scenes for the 4 screenshots. The sim runs a fixed number
  // of ticks from the seed, then the camera is placed and the frame freezes.
  const settings = { sensitivity: 1, volume: 0, quality: 'high', difficulty: 'regular', startsDefending: false };
  s = createState(SEED, settings);
  initBots(s);
  for (const a of s.agents) {
    if (a.isPlayer) continue;
    const m = agentMeshes.get(a.id);
    if (m) { a.mesh = m; m.group.visible = true; }
  }
  if (SHOT === 'start') {
    // Real menu state: no match, HUD hidden, menu over the orbit backdrop,
    // exactly as a player sees it on load.
    H.root.style.display = 'none';
    U.showMenu();
    syncRender(0, 1);
    renderer.render(scene, camera);
    renderer.render(scene, camera);
    shotFrozen = true;
    window.__shotReady = true;
    return;
  }
  startMatch(s);
  playing = true;
  H.root.style.display = 'block';
  U.hideAll();
  const p = playerOf(s);
  const runTicks = (n) => { for (let i = 0; i < n; i++) tick(DT); };
  if (SHOT === 'play') {
    // Mid fight: run the sim into the round, then stage a duel.
    runTicks(60 * 9);
    // The player stages at full health with a clean sheet: staging ticks are
    // scene-setting, not the player's story.
    p.hp = 100; p.alive = true; p.vel = [0, 0, 0]; p.flashT = 0; p.flashPeak = 0;
    p.kills = 0; p.deaths = 0; p.assists = 0; p.headshots = 0; p.damage = 0; p.shotsFired = 0; p.shotsHit = 0;
    p.pos = [-13, 0, 4.5]; p.yaw = -Math.PI / 2; p.pitch = 0;
    p.primary = { id: 'rifle', mag: 30, reserve: 90 }; p.slot = 'primary';
    const foe = s.agents.find((a) => a.squad !== p.squad && a.alive);
    if (foe) { foe.pos = [2, 0, 3.5]; foe.yaw = Math.PI / 2; foe.hp = 100; foe.bot.targetId = 0; foe.bot.seenT = -99; }
    const mate = s.agents.find((a) => a.squad === p.squad && !a.isPlayer && a.alive);
    if (mate) { mate.pos = [-9, 0, -2]; mate.yaw = -Math.PI / 2; mate.bot.targetId = 0; mate.bot.seenT = -99; }
    runTicks(20);
    // Freeze a muzzle flash + tracer in frame.
    fireWeapon(s, p);
    consumeEvents();
    runTicks(2);
  } else if (SHOT === 'site') {
    // A site at sunset with the bomb planted and defenders closing in.
    runTicks(60 * 12);
    p.hp = 100; p.alive = true; p.vel = [0, 0, 0]; p.flashT = 0; p.flashPeak = 0;
    s.roundLiveT = 20; // stage the moment after the buy window has closed
    p.pos = [13, 0, -10]; p.yaw = -Math.PI / 2 - 0.7; p.pitch = 0.02;
    s.bombPlanted = true; s.bombSite = 'A'; s.bombPos = [22, 0.15, -19]; s.bombFuse = 32;
    const foe = s.agents.find((a) => a.squad !== p.squad && a.alive);
    if (foe) { foe.pos = [20, 0, -17]; foe.yaw = Math.PI * 0.75; foe.bot.targetId = 0; foe.bot.seenT = -99; }
    runTicks(10);
  } else if (SHOT === 'buy') {
    // Freeze time at spawn with the buy menu open.
    runTicks(30);
    p.money = 4700;
    U.showBuy(s);
  }
  syncRender(0, 1);
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  shotFrozen = true;
  window.__shotReady = true;
}

// --- Boot --------------------------------------------------------------------------
if (SHOT) {
  stageShot();
} else {
  U.showMenu();
}
requestAnimationFrame(frame);
