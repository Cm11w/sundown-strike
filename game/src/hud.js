// HUD: DOM overlay driven from the single state store. The crosshair gap is
// computed from the same spread model the sim shoots with, so it never lies.
// The radar is north-up with a rotating player arrow; it shows teammates, the
// bomb, and enemies only briefly after they fire (sound intel).
import { WEAPONS, SQUADS } from './config.js';
import { SOLIDS, MAP } from './mapdata.js';
import { spreadDeg } from './combat.js';
import { currentWeapon, squadOf, playerOf } from './state.js';
import { roundClock } from './rounds.js';

export function buildHud() {
  const el = (id) => document.getElementById(id);
  const H = {
    root: el('hud'), hp: el('hp-num'), hpBar: el('hp-bar'), armor: el('armor-ico'),
    ammoMag: el('ammo-mag'), ammoRes: el('ammo-res'), weaponName: el('weapon-name'),
    money: el('money'), timer: el('timer'), timerLabel: el('timer-label'),
    scoreA: el('score-a'), scoreB: el('score-b'),
    killfeed: el('killfeed'), cross: el('crosshair'),
    hitmark: el('hitmarker'), dmgDir: el('dmg-dir'),
    radar: el('radar'), radarCtx: el('radar').getContext('2d'),
    bombBox: el('bomb-box'), bombText: el('bomb-text'), bombBar: el('bomb-bar'),
    actionBox: el('action-box'), actionBar: el('action-bar'), actionText: el('action-text'),
    nades: el('nades'), banner: el('banner'), bannerSub: el('banner-sub'),
    flash: el('flash-overlay'), vignette: el('dmg-vignette'),
    scope: el('scope-overlay'), scoreboard: el('scoreboard'), sbBody: el('sb-body'),
    history: el('round-history'), stats: el('stats-line'),
    buyHint: el('buy-hint'), reloadHint: el('reload-hint'),
    halfLabel: el('half-label'), roundLabel: el('round-label'),
    hitT: 0, hitKill: false, dmgT: 0, feedSig: '', sbSig: '', histSig: '',
    enemyBlips: new Map(), // agentId -> expiry time
  };
  // Crosshair pieces.
  H.crossLines = [...H.cross.querySelectorAll('.ch-line')];
  H.crossDot = H.cross.querySelector('.ch-dot');
  return H;
}

function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function noteEnemyShot(H, s, agent) {
  if (agent.squad !== playerOf(s).squad) H.enemyBlips.set(agent.id, s.time + 1.6);
}

function drawRadar(H, s, p) {
  const ctx = H.radarCtx, W = 148, pad = 6;
  const b = MAP.bounds;
  const sx = (W - pad * 2) / (b.maxX - b.minX);
  const sz = (W - pad * 2) / (b.maxZ - b.minZ);
  const X = (x) => pad + (x - b.minX) * sx;
  const Z = (z) => pad + (z - b.minZ) * sz;
  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = 'rgba(12,16,22,0.72)';
  ctx.fillRect(0, 0, W, W);
  // Walls.
  ctx.fillStyle = 'rgba(150,140,120,0.55)';
  for (const sld of SOLIDS) {
    ctx.fillRect(X(sld.min[0]), Z(sld.min[2]), (sld.max[0] - sld.min[0]) * sx, (sld.max[2] - sld.min[2]) * sz);
  }
  // Sites.
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  for (const key of ['A', 'B']) {
    const site = MAP.sites[key];
    ctx.fillStyle = s.bombPlanted && s.bombSite === key ? '#ff5544' : 'rgba(232,220,190,0.85)';
    ctx.fillText(key, X(site.center[0]), Z(site.center[1]) + 4);
  }
  // Bomb (dropped or planted).
  const bombPos = s.bombPlanted ? s.bombPos : s.bombDropped;
  if (bombPos) {
    ctx.fillStyle = '#ff5544';
    ctx.beginPath();
    ctx.arc(X(bombPos[0]), Z(bombPos[2]), 3.5, 0, 7);
    ctx.fill();
  }
  // Agents.
  for (const a of s.agents) {
    if (!a.alive) continue;
    const x = X(a.pos[0]), z = Z(a.pos[2]);
    if (a.isPlayer) {
      // Player arrow, rotated to face the view direction.
      ctx.save();
      ctx.translate(x, z);
      ctx.rotate(Math.atan2(-Math.sin(a.yaw), -Math.cos(a.yaw)) + Math.PI / 2 + Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -5); ctx.lineTo(3.5, 4); ctx.lineTo(-3.5, 4);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (a.squad === p.squad) {
      ctx.fillStyle = SQUADS[a.squad].css;
      ctx.beginPath(); ctx.arc(x, z, 3, 0, 7); ctx.fill();
      if (a.hasBomb) { ctx.fillStyle = '#ff5544'; ctx.fillRect(x - 1.5, z - 1.5, 3, 3); }
    } else if (H.enemyBlips.has(a.id) && s.time < H.enemyBlips.get(a.id)) {
      ctx.fillStyle = '#ff4444';
      ctx.beginPath(); ctx.arc(x, z, 3, 0, 7); ctx.fill();
    }
  }
}

export function updateHud(H, s, dt) {
  const p = playerOf(s);
  if (!p) return;
  // Health / armor.
  H.hp.textContent = Math.max(0, Math.ceil(p.hp));
  H.hpBar.style.width = `${Math.max(0, p.hp)}%`;
  H.hpBar.className = 'hp-fill' + (p.hp <= 30 ? ' low' : '');
  H.armor.textContent = p.armor ? (p.helmet ? '⛨+H' : '⛨') : '';
  H.armor.style.opacity = p.armor ? 1 : 0.25;
  // Weapon / ammo.
  const ws = currentWeapon(p);
  if (p.slot === 'grenade') {
    H.weaponName.textContent = { frag: 'Frag Charge', smoke: 'Smoke Canister', flash: 'Flash Charge' }[p.grenadeSel];
    H.ammoMag.textContent = p.grenades[p.grenadeSel];
    H.ammoRes.textContent = '';
  } else if (ws) {
    const w = WEAPONS[ws.id];
    H.weaponName.textContent = w.name;
    H.ammoMag.textContent = ws.mag === Infinity ? '—' : ws.mag;
    H.ammoRes.textContent = ws.reserve === Infinity ? '' : `/ ${ws.reserve}`;
    H.reloadHint.style.opacity = (ws.mag === 0 && ws.reserve > 0) ? 1 : 0;
  }
  H.nades.textContent = `💣${p.grenades.frag} 🌫${p.grenades.smoke} ✨${p.grenades.flash}${p.hasBomb ? '  ◉ BOMB' : ''}${p.defuseKit ? '  🛠 KIT' : ''}`;
  // Money / timer / score.
  H.money.textContent = `$${p.money}`;
  const clock = roundClock(s);
  H.timerLabel.textContent = clock.label;
  H.timer.textContent = fmtTime(clock.t);
  H.timer.className = 'timer-num' + (clock.urgent ? ' urgent' : '');
  H.scoreA.textContent = s.score.alpha;
  H.scoreB.textContent = s.score.bravo;
  H.halfLabel.textContent = s.half === 0 ? '1ST HALF' : '2ND HALF';
  H.roundLabel.textContent = `ROUND ${Math.max(1, s.round)}/25`;
  // Round history pips.
  const histSig = s.roundHistory.map((r) => r.winner[0] + r.reason[0]).join(',');
  if (histSig !== H.histSig) {
    H.histSig = histSig;
    H.history.innerHTML = s.roundHistory.map((r) =>
      `<span class="pip ${r.winner}" title="R${r.round}: ${r.reason}"></span>`).join('');
  }
  // Crosshair: gap from the live spread model.
  if (ws && ws.id !== 'knife') {
    const w = WEAPONS[ws.id];
    const gap = 4 + spreadDeg(p, { ...w, id: ws.id }) * 7;
    const len = 7;
    H.cross.style.opacity = p.ads > 0.7 && w.scopedOnly ? 0 : 1;
    const [t, r, b, l] = H.crossLines;
    t.style.transform = `translate(-50%, calc(-100% - ${gap}px))`;
    b.style.transform = `translate(-50%, ${gap}px)`;
    l.style.transform = `translate(calc(-100% - ${gap}px), -50%)`;
    r.style.transform = `translate(${gap}px, -50%)`;
    t.style.height = b.style.height = `${len}px`;
    l.style.width = r.style.width = `${len}px`;
  } else {
    H.cross.style.opacity = 0.6;
  }
  // Hitmarker decay.
  if (H.hitT > 0) {
    H.hitT -= dt;
    H.hitmark.style.opacity = Math.max(0, H.hitT / 0.14);
    if (H.hitT <= 0) H.hitmark.style.opacity = 0;
  }
  // Damage direction decay.
  if (H.dmgT > 0) {
    H.dmgT -= dt;
    H.dmgDir.style.opacity = Math.max(0, H.dmgT / 0.9) * 0.9;
  }
  // Killfeed.
  const feedSig = s.roundKills.map((k) => k.killer + k.victim + k.time).join('|');
  if (feedSig !== H.feedSig) {
    H.feedSig = feedSig;
    H.killfeed.innerHTML = s.roundKills.map((k) => {
      const kc = k.killerSquad ? SQUADS[k.killerSquad].css : '#888';
      const vc = k.victimSquad ? SQUADS[k.victimSquad].css : '#888';
      const wname = k.weapon === 'frag' ? '💣' : k.weapon === 'bomb' ? '💥' : k.weapon === 'fall' ? '▼' : (WEAPONS[k.weapon] ? WEAPONS[k.weapon].name : k.weapon);
      return `<div class="feed-row"><span style="color:${kc}">${k.killer || '—'}</span> <span class="feed-w">${wname}${k.headshot ? ' ⌖' : ''}</span> <span style="color:${vc}">${k.victim}</span></div>`;
    }).join('');
  }
  // Bomb box.
  if (s.bombPlanted) {
    H.bombBox.style.display = 'block';
    H.bombText.textContent = `💣 BOMB AT ${s.bombSite} — ${s.bombFuse.toFixed(1)}s`;
    H.bombBar.style.width = `${(s.bombFuse / 40) * 100}%`;
    H.bombBox.className = 'bomb-box planted';
  } else if (p.hasBomb) {
    H.bombBox.style.display = 'block';
    H.bombText.textContent = '◉ YOU CARRY THE BOMB — plant at A or B (hold F)';
    H.bombBar.style.width = '100%';
    H.bombBox.className = 'bomb-box carry';
  } else if (s.bombDropped) {
    H.bombBox.style.display = 'block';
    H.bombText.textContent = '◉ BOMB DROPPED — pick it up';
    H.bombBar.style.width = '100%';
    H.bombBox.className = 'bomb-box dropped';
  } else {
    H.bombBox.style.display = 'none';
  }
  // Action progress (plant/defuse).
  if (p.action) {
    H.actionBox.style.display = 'block';
    H.actionText.textContent = p.action.kind === 'plant' ? `PLANTING at ${p.action.site}…` : 'DEFUSING…';
    H.actionBar.style.width = `${(p.action.t / p.action.total) * 100}%`;
  } else {
    H.actionBox.style.display = 'none';
  }
  // Flash + damage vignettes.
  const flashA = p.flashT > 0 ? Math.min(1, (p.flashT / 2.8) * 1.6) * (p.flashPeak || 1) : 0;
  H.flash.style.opacity = flashA;
  H.vignette.style.opacity = p.hp < 35 ? 0.35 + 0.15 * Math.sin(performance.now() * 0.006) : 0;
  // Scope overlay for the sniper.
  const scoped = ws && ws.id === 'sniper' && p.ads > 0.7;
  H.scope.style.opacity = scoped ? 1 : 0;
  // Buy hint.
  H.buyHint.style.opacity = (s.phase === 'freeze' || (s.phase === 'live' && s.roundLiveT < 15)) ? 1 : 0;
  // Stats line.
  const acc = p.shotsFired > 0 ? Math.min(100, Math.round((p.shotsHit / p.shotsFired) * 100)) : 0;
  H.stats.textContent = `K ${p.kills}  D ${p.deaths}  A ${p.assists}  HS ${p.headshots}  DMG ${Math.round(p.damage)}  ACC ${acc}%`;
  drawRadar(H, s, p);
}

export function showHitmarker(H, killed, headshot) {
  H.hitT = 0.14;
  H.hitmark.className = 'hitmarker show' + (killed ? ' kill' : '') + (headshot ? ' head' : '');
  H.hitmark.style.opacity = 1;
}

export function showDamageFrom(H, s, p, fromPos) {
  if (!fromPos) return;
  // Bearing of the attacker relative to the view direction.
  const dx = fromPos[0] - p.pos[0], dz = fromPos[2] - p.pos[2];
  const worldAng = Math.atan2(-dx, -dz);
  const rel = worldAng - p.yaw;
  H.dmgDir.style.transform = `translate(-50%,-50%) rotate(${rel}rad)`;
  H.dmgT = 0.9;
  H.dmgDir.style.opacity = 0.9;
}

export function showBanner(H, text, sub, ms = 2600) {
  H.banner.textContent = text;
  H.bannerSub.textContent = sub || '';
  H.banner.parentElement.style.opacity = 1;
  clearTimeout(H._bannerT);
  H._bannerT = setTimeout(() => { H.banner.parentElement.style.opacity = 0; }, ms);
}

export function renderScoreboard(H, s, show) {
  H.scoreboard.style.display = show ? 'block' : 'none';
  if (!show) return;
  const sig = s.agents.map((a) => `${a.kills}/${a.deaths}/${a.assists}/${a.money}`).join('|') + s.score.alpha + s.score.bravo;
  if (sig === H.sbSig) return;
  H.sbSig = sig;
  const row = (a) => `<tr class="${a.isPlayer ? 'me' : ''}"><td>${a.name}${a.hasBomb ? ' ◉' : ''}</td><td>${a.kills}</td><td>${a.deaths}</td><td>${a.assists}</td><td>${Math.round(a.damage)}</td><td>$${a.money}</td></tr>`;
  const mk = (squad) => `<h3 style="color:${SQUADS[squad].css}">${SQUADS[squad].name} — ${s.score[squad]}</h3>
    <table><tr><th>Player</th><th>K</th><th>D</th><th>A</th><th>DMG</th><th>$</th></tr>
    ${squadOf(s, squad).sort((x, y) => y.kills - x.kills).map(row).join('')}</table>`;
  H.sbBody.innerHTML = mk('alpha') + mk('bravo');
}
