// First-person viewmodels: detailed guns from primitives (receivers, barrels,
// magazines, stocks, sights) plus gloved hands and sleeves. Procedural
// animation: sway, bob, lean, recoil kick, reload dips, switching, pump/bolt
// cycling, knife swings. Parented to the camera; ADS centres the sights.
import * as THREE from 'three';

const M = {};
function mats() {
  if (M.gun) return M;
  M.gun = new THREE.MeshStandardMaterial({ color: 0x453f38, roughness: 0.42, metalness: 0.62 });
  M.gunDark = new THREE.MeshStandardMaterial({ color: 0x332f2a, roughness: 0.5, metalness: 0.55 });
  M.polymer = new THREE.MeshStandardMaterial({ color: 0x4a463f, roughness: 0.8, metalness: 0.1 });
  M.wood = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.7 });
  M.brass = new THREE.MeshStandardMaterial({ color: 0xb08d3e, roughness: 0.35, metalness: 0.8 });
  M.steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.3, metalness: 0.85 });
  M.glove = new THREE.MeshStandardMaterial({ color: 0x38302a, roughness: 0.95 });
  M.sleeve = new THREE.MeshStandardMaterial({ color: 0x2e3833, roughness: 0.95 });
  M.lens = new THREE.MeshStandardMaterial({ color: 0x2a4a5a, roughness: 0.1, metalness: 0.9, emissive: 0x0a2530 });
  return M;
}
const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
function part(parent, geo, mat, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}
// A gloved hand: palm + curled fingers + thumb + sleeve cuff.
function hand(parent, mat, x, y, z, grip = 0) {
  const g = new THREE.Group();
  part(g, box, mat, 0.068, 0.082, 0.1, 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    part(g, box, mat, 0.015, 0.045, 0.028, -0.024 + i * 0.016, -0.04, -0.05 + grip * 0.01, 0.5 + grip, 0, 0);
  }
  part(g, box, mat, 0.018, 0.045, 0.023, 0.038, -0.018, -0.027, 0, 0, -0.6);
  part(g, cyl, mats().sleeve, 0.04, 0.09, 0.04, 0, 0.07, 0.015, 0.35, 0, 0);
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function buildRifle(T) {
  const m = mats();
  const g = new THREE.Group();
  part(g, box, m.gun, 0.07, 0.09, 0.42, 0, 0, -0.1); // receiver
  part(g, box, m.polymer, 0.065, 0.07, 0.3, 0, -0.01, -0.42); // handguard
  for (let i = 0; i < 4; i++) part(g, box, m.gunDark, 0.07, 0.012, 0.02, 0, -0.048, -0.3 - i * 0.07); // rail slots
  part(g, cyl, m.gunDark, 0.016, 0.22, 0.016, 0, 0.01, -0.66, Math.PI / 2, 0, 0); // barrel
  part(g, cyl, m.gunDark, 0.024, 0.06, 0.024, 0, 0.01, -0.76, Math.PI / 2, 0, 0); // muzzle brake
  part(g, box, m.gunDark, 0.05, 0.16, 0.08, 0, -0.12, -0.08, 0.12, 0, 0); // magazine
  part(g, box, m.polymer, 0.06, 0.12, 0.16, 0, -0.02, 0.18); // stock
  part(g, box, m.polymer, 0.045, 0.1, 0.06, 0, -0.09, 0.06, 0.25, 0, 0); // grip
  part(g, box, m.gunDark, 0.02, 0.04, 0.1, 0, 0.065, -0.18); // red-dot sight
  part(g, cyl, m.lens, 0.014, 0.02, 0.014, 0, 0.065, -0.23, Math.PI / 2, 0, 0);
  part(g, box, m.gunDark, 0.03, 0.02, 0.05, -0.045, 0.05, 0.08); // charging handle
  part(g, box, m.gunDark, 0.012, 0.05, 0.09, 0, -0.075, -0.02); // trigger guard
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.01, -0.8);
  g.add(muzzle);
  return { group: g, muzzle, gripL: [-0.02, -0.1, -0.42], gripR: [0, -0.13, 0.06], adsY: 0.062 };
}

function buildSmg(T) {
  const m = mats();
  const g = new THREE.Group();
  part(g, box, m.gun, 0.06, 0.08, 0.34, 0, 0, -0.08);
  part(g, cyl, m.gunDark, 0.02, 0.16, 0.02, 0, 0.005, -0.34, Math.PI / 2, 0, 0);
  part(g, cyl, m.gunDark, 0.028, 0.1, 0.028, 0, 0.005, -0.45, Math.PI / 2, 0, 0); // suppressor shroud
  part(g, box, m.gunDark, 0.045, 0.18, 0.06, 0, -0.13, -0.06, 0.06, 0, 0); // long mag
  part(g, box, m.polymer, 0.05, 0.09, 0.05, 0, -0.08, 0.06, 0.3, 0, 0);
  part(g, box, m.polymer, 0.04, 0.05, 0.14, 0, 0, 0.2); // folding stock
  part(g, box, m.gunDark, 0.018, 0.03, 0.06, 0, 0.055, -0.14);
  part(g, box, m.gunDark, 0.012, 0.045, 0.08, 0, -0.065, 0.0);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.005, -0.52);
  g.add(muzzle);
  return { group: g, muzzle, gripL: [-0.02, -0.08, -0.28], gripR: [0, -0.11, 0.06], adsY: 0.055 };
}

function buildShotgun(T) {
  const m = mats();
  const g = new THREE.Group();
  part(g, cyl, m.gunDark, 0.02, 0.52, 0.02, 0, 0.02, -0.4, Math.PI / 2, 0, 0); // barrel
  part(g, cyl, m.gunDark, 0.016, 0.4, 0.016, 0, -0.035, -0.36, Math.PI / 2, 0, 0); // tube
  const pump = part(g, box, m.wood, 0.06, 0.06, 0.14, 0, -0.03, -0.42); // pump (animated)
  part(g, box, m.gun, 0.06, 0.08, 0.3, 0, 0, -0.02);
  part(g, box, m.wood, 0.055, 0.09, 0.2, 0, -0.02, 0.2, -0.08, 0, 0); // stock
  part(g, box, m.gunDark, 0.014, 0.03, 0.03, 0, 0.045, -0.6); // bead sight
  part(g, box, m.gunDark, 0.012, 0.045, 0.08, 0, -0.06, 0.04);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.68);
  g.add(muzzle);
  return { group: g, muzzle, pump, gripL: [-0.02, -0.09, -0.42], gripR: [0, -0.09, 0.1], adsY: 0.045 };
}

function buildSniper(T) {
  const m = mats();
  const g = new THREE.Group();
  part(g, box, m.gun, 0.07, 0.08, 0.4, 0, 0, -0.05);
  part(g, cyl, m.gunDark, 0.014, 0.55, 0.014, 0, 0.01, -0.55, Math.PI / 2, 0, 0);
  part(g, cyl, m.gunDark, 0.022, 0.07, 0.022, 0, 0.01, -0.84, Math.PI / 2, 0, 0);
  part(g, box, m.polymer, 0.05, 0.1, 0.06, 0, -0.1, -0.02, 0.08, 0, 0);
  part(g, box, m.polymer, 0.055, 0.11, 0.2, 0, -0.02, 0.22, -0.06, 0, 0);
  part(g, box, m.polymer, 0.04, 0.09, 0.05, 0, -0.08, 0.08, 0.3, 0, 0);
  // Scope: tube + mounts + lenses.
  part(g, cyl, m.gunDark, 0.026, 0.24, 0.026, 0, 0.085, -0.1, Math.PI / 2, 0, 0);
  part(g, cyl, m.lens, 0.024, 0.012, 0.024, 0, 0.085, -0.225, Math.PI / 2, 0, 0);
  part(g, cyl, m.lens, 0.02, 0.012, 0.02, 0, 0.085, 0.02, Math.PI / 2, 0, 0);
  part(g, box, m.gunDark, 0.02, 0.03, 0.03, 0, 0.05, -0.18);
  part(g, box, m.gunDark, 0.02, 0.03, 0.03, 0, 0.05, -0.02);
  const bolt = part(g, cyl, m.steel, 0.012, 0.09, 0.012, 0.07, 0.03, 0.02, 0, 0, Math.PI / 2.4); // bolt (animated)
  part(g, box, m.gunDark, 0.012, 0.045, 0.08, 0, -0.06, 0.05);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.01, -0.9);
  g.add(muzzle);
  return { group: g, muzzle, bolt, gripL: [-0.02, -0.08, -0.32], gripR: [0, -0.11, 0.08], adsY: 0.085 };
}

function buildPistol(T, big) {
  const m = mats();
  const g = new THREE.Group();
  const s = big ? 1.25 : 1;
  part(g, box, m.gun, 0.045 * s, 0.05 * s, 0.2 * s, 0, 0.01, -0.06);
  part(g, box, m.gunDark, 0.04 * s, 0.035 * s, 0.2 * s, 0, -0.02, -0.06);
  part(g, box, m.polymer, 0.04 * s, 0.11 * s, 0.055 * s, 0, -0.085, 0.03, 0.18, 0, 0);
  part(g, box, m.gunDark, 0.008, 0.018, 0.012, 0, 0.045 * s, -0.15 * s);
  part(g, box, m.gunDark, 0.02, 0.015, 0.012, 0, 0.042 * s, 0.03);
  if (big) part(g, cyl, m.steel, 0.012, 0.05, 0.012, 0, 0.01, -0.19, Math.PI / 2, 0, 0);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.01, -0.18 * s);
  g.add(muzzle);
  return { group: g, muzzle, gripL: null, gripR: [0, -0.11, 0.03], adsY: 0.04 * s };
}

function buildKnife(T) {
  const m = mats();
  const g = new THREE.Group();
  part(g, box, m.steel, 0.008, 0.028, 0.26, 0, 0.01, -0.2);
  part(g, box, m.steel, 0.01, 0.012, 0.05, 0, 0.008, -0.06);
  part(g, cyl, m.polymer, 0.016, 0.11, 0.016, 0, 0, 0.03, Math.PI / 2, 0, 0);
  part(g, box, m.brass, 0.03, 0.02, 0.015, 0, 0, -0.035);
  const muzzle = new THREE.Object3D();
  g.add(muzzle);
  return { group: g, muzzle, gripL: null, gripR: [0, -0.05, 0.03], adsY: 0 };
}

function buildGrenadeVM(T, kind) {
  const m = mats();
  const g = new THREE.Group();
  const bodyMat = kind === 'frag' ? m.gunDark : kind === 'smoke' ? new THREE.MeshStandardMaterial({ color: 0x5a6258, roughness: 0.6, metalness: 0.3 }) : new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.6 });
  part(g, cyl, bodyMat, 0.035, 0.09, 0.035, 0, 0, 0);
  part(g, cyl, m.steel, 0.02, 0.03, 0.02, 0, 0.06, 0);
  part(g, box, m.steel, 0.012, 0.05, 0.02, 0.03, 0.04, 0, 0, 0, -0.2); // lever
  part(g, cyl, m.brass, 0.008, 0.02, 0.008, -0.02, 0.055, 0, 0, 0, Math.PI / 2); // pin
  const muzzle = new THREE.Object3D();
  g.add(muzzle);
  return { group: g, muzzle, gripL: null, gripR: [0, -0.06, 0], adsY: 0 };
}

const BUILDERS = {
  rifle: buildRifle, smg: buildSmg, shotgun: buildShotgun, sniper: buildSniper,
  sidearm: (T) => buildPistol(T, false), handcannon: (T) => buildPistol(T, true),
  knife: buildKnife,
};

export function buildViewmodelRig(camera, T) {
  const rig = new THREE.Group();
  camera.add(rig);
  const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: T.glow, color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  flashSprite.scale.set(0.34, 0.34, 1);
  const models = {};
  let current = null;
  let hands = null;

  function getModel(id) {
    if (models[id]) return models[id];
    const built = id.startsWith('grenade:')
      ? buildGrenadeVM(T, id.slice(8))
      : BUILDERS[id](T);
    built.group.visible = false;
    rig.add(built.group);
    models[id] = built;
    return built;
  }

  // Hands are rebuilt per weapon (grip positions differ).
  function setHands(built) {
    if (hands) { rig.remove(hands); }
    hands = new THREE.Group();
    const m = mats();
    if (built.gripR) {
      const hr = hand(hands, m.glove, built.gripR[0] + 0.02, built.gripR[1], built.gripR[2], 0.6);
      hr.rotation.x = -0.55;
    }
    if (built.gripL) {
      const hl = hand(hands, m.glove, built.gripL[0] - 0.03, built.gripL[1], built.gripL[2], 0.4);
      hl.rotation.set(-0.5, 0.3, 0.2);
    }
    hands.visible = false;
    rig.add(hands);
  }

  const vm = {
    rig, flashSprite,
    kick: 0, kickRot: 0, swayX: 0, swayY: 0,
    cycleT: -1, // pump/bolt animation timer
    swingT: -1, // knife swing timer
    switchT: 0, reloadDip: 0,
    show(id) {
      if (current === id && models[id] && models[id].group.visible) return;
      for (const k of Object.keys(models)) models[k].group.visible = false;
      const built = getModel(id);
      built.group.visible = true;
      setHands(built);
      hands.visible = true;
      current = id;
      vm.switchT = 0.32;
      // Muzzle flash sprite follows the active gun's muzzle.
      if (flashSprite.parent) flashSprite.parent.remove(flashSprite);
      built.muzzle.add(flashSprite);
      flashSprite.position.set(0, 0, -0.03);
    },
    hide() {
      for (const k of Object.keys(models)) models[k].group.visible = false;
      if (hands) hands.visible = false;
      current = null;
    },
    onFire(weaponId) {
      vm.kick = Math.min(1, vm.kick + 0.7);
      vm.kickRot = Math.min(1, vm.kickRot + 0.8);
      flashSprite.material.opacity = 0.95;
      flashSprite.material.rotation = Math.random() * Math.PI;
      if (weaponId === 'shotgun' || weaponId === 'sniper') vm.cycleT = 0;
      if (weaponId === 'knife') vm.swingT = 0;
    },
    update(dt, a, lookVel, time) {
      if (!current || !models[current]) return;
      const built = models[current];
      const g = built.group;
      const ads = a.ads;
      // Hip vs ADS pose.
      const hipPos = [0.26, -0.245, -0.48];
      const adsPos = [0, -built.adsY - 0.004, -0.38];
      const px = hipPos[0] + (adsPos[0] - hipPos[0]) * ads;
      const py = hipPos[1] + (adsPos[1] - hipPos[1]) * ads;
      const pz = hipPos[2] + (adsPos[2] - hipPos[2]) * ads;
      // Walk bob + idle breathing.
      const bobAmp = (a.moving ? 0.014 : 0.004) * (1 - ads * 0.7);
      const bx = Math.sin(a.bobPhase) * bobAmp;
      const by = Math.abs(Math.cos(a.bobPhase)) * bobAmp * 0.8 + Math.sin(time * 1.4) * 0.0015;
      // Sway from look velocity (lag).
      vm.swayX += ((-lookVel[0] * 0.02) - vm.swayX) * Math.min(1, dt * 10);
      vm.swayY += ((-lookVel[1] * 0.02) - vm.swayY) * Math.min(1, dt * 10);
      // Switch dip.
      let dip = 0;
      if (vm.switchT > 0) { vm.switchT -= dt; dip = Math.sin((vm.switchT / 0.32) * Math.PI) * 0.12; }
      // Reload dip: gun tilts down and rolls while reloading.
      let reloadRot = 0;
      if (a.reloadT > 0) { reloadRot = 0.5; dip += 0.05; }
      // Recoil kick decay.
      vm.kick = Math.max(0, vm.kick - dt * 5);
      vm.kickRot = Math.max(0, vm.kickRot - dt * 6);
      g.position.set(px + bx + vm.swayX, py + by + vm.swayY - dip, pz + vm.kick * 0.05);
      g.rotation.set(
        vm.kickRot * 0.09 + reloadRot * 0.4 - a.lean * 0.06,
        vm.swayX * 1.4,
        reloadRot * 0.35 + a.lean * 0.1 + Math.sin(a.bobPhase) * 0.008,
      );
      // Pump / bolt cycle.
      if (vm.cycleT >= 0) {
        vm.cycleT += dt;
        const t = vm.cycleT / 0.45;
        if (t >= 1) { vm.cycleT = -1; if (built.pump) built.pump.position.z = -0.42; if (built.bolt) built.bolt.position.set(0.07, 0.03, 0.02); }
        else {
          const k = Math.sin(t * Math.PI);
          if (built.pump) built.pump.position.z = -0.42 + k * 0.07;
          if (built.bolt) { built.bolt.position.z = 0.02 + k * 0.05; built.bolt.rotation.z = Math.PI / 2.4 + k * 0.5; }
        }
      }
      // Knife swing.
      if (vm.swingT >= 0) {
        vm.swingT += dt;
        const t = vm.swingT / 0.28;
        if (t >= 1) vm.swingT = -1;
        else {
          const k = Math.sin(t * Math.PI);
          g.rotation.z -= k * 0.9;
          g.rotation.x -= k * 0.3;
          g.position.x += k * 0.06;
        }
      }
      // Hands follow the gun group.
      if (hands) {
        hands.position.copy(g.position);
        hands.rotation.copy(g.rotation);
      }
      // Muzzle flash decay.
      flashSprite.material.opacity = Math.max(0, flashSprite.material.opacity - dt * 22);
    },
    muzzleWorld(out) {
      if (!current || !models[current]) return out.set(0, 0, 0);
      return models[current].muzzle.getWorldPosition(out);
    },
  };
  return vm;
}
