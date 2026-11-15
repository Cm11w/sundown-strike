// Menus and overlays: main menu, team select, buy menu, pause, settings,
// match-end screen. DOM only; game logic stays in the sim modules. The buy
// menu is the macro decision surface: prices against the player's money plus
// the squad plan hint (eco / force / full) so the economy game is legible.
import { ECONOMY, SQUADS } from './config.js';
import { buyItem, buyBlockedReason, squadBuyPlan } from './economy.js';
import { playerOf } from './state.js';

const BUY_ITEMS = [
  { id: 'rifle', name: 'KR-7 Carbine', desc: 'Auto rifle · 30 rd · the workhorse', cat: 'primary' },
  { id: 'smg', name: 'VK-9 Ripper', desc: 'Fast SMG · 32 rd · close quarters', cat: 'primary' },
  { id: 'shotgun', name: 'SG-12 Scattergun', desc: '8 pellets · devastating up close', cat: 'primary' },
  { id: 'sniper', name: 'LR-50 Longshot', desc: 'Bolt sniper · 1-shot body · scope', cat: 'primary' },
  { id: 'handcannon', name: 'DH-44 Handcannon', desc: 'Heavy pistol · 7 rd · 45 dmg', cat: 'secondary' },
  { id: 'armor', name: 'Kevlar Vest', desc: 'Halves body damage (by penetration)', cat: 'gear' },
  { id: 'helmet', name: 'Helmet', desc: 'Halves headshot bonus · needs vest', cat: 'gear' },
  { id: 'defuseKit', name: 'Defuse Kit', desc: 'Defuse in 5s instead of 10s · defenders', cat: 'gear' },
  { id: 'frag', name: 'Frag Charge', desc: '95 dmg blast · 1.6s fuse', cat: 'grenade' },
  { id: 'smoke', name: 'Smoke Canister', desc: 'Blocks vision 16s · 4.2m cloud', cat: 'grenade' },
  { id: 'flash', name: 'Flash Charge', desc: 'Blinds on line of sight · look away!', cat: 'grenade' },
  { id: 'ammo', name: 'Refill Ammo', desc: 'Top up reserve ammunition', cat: 'gear' },
];

export function buildUi(hooks) {
  // hooks: {onStart(settings), onBuy(item), onResume(), onRestart(), onQuitToMenu(), onSettings(settings), audio}
  const el = (id) => document.getElementById(id);
  const U = {
    menu: el('menu'), teamSelect: el('team-select'), buyMenu: el('buy-menu'),
    pause: el('pause-menu'), settings: el('settings-menu'), endScreen: el('end-screen'),
    buyGrid: el('buy-grid'), buyMoney: el('buy-money'), buyPlan: el('buy-plan'),
    buyMsg: el('buy-msg'), endBody: el('end-body'),
  };
  let settings = { sensitivity: 1.0, volume: 0.8, quality: 'high', difficulty: 'regular', startsDefending: true };

  function showOnly(...panels) {
    for (const p of [U.menu, U.teamSelect, U.buyMenu, U.pause, U.settings, U.endScreen]) {
      p.style.display = panels.includes(p) ? 'flex' : 'none';
    }
  }
  U.showMenu = () => showOnly(U.menu);
  U.showTeamSelect = () => showOnly(U.teamSelect);
  U.showPause = () => showOnly(U.pause);
  U.showEnd = () => showOnly(U.endScreen);
  U.hideAll = () => showOnly();
  U.showBuy = (s) => { renderBuy(s); U.buyMenu.style.display = 'flex'; };
  U.hideBuy = () => { U.buyMenu.style.display = 'none'; };
  U.buyOpen = () => U.buyMenu.style.display === 'flex';

  // Main menu buttons.
  el('btn-play').addEventListener('click', () => { hooks.audio.ensure(); hooks.audio.click(); U.showTeamSelect(); });
  el('btn-settings').addEventListener('click', () => { hooks.audio.ensure(); hooks.audio.click(); openSettings('menu'); });
  el('btn-howto').addEventListener('click', () => { hooks.audio.click(); el('howto').style.display = el('howto').style.display === 'block' ? 'none' : 'block'; });

  // Team select: which side first + difficulty.
  for (const btn of document.querySelectorAll('[data-side]')) {
    btn.addEventListener('click', () => {
      settings.startsDefending = btn.dataset.side === 'defend';
      document.querySelectorAll('[data-side]').forEach((b) => b.classList.toggle('sel', b === btn));
      hooks.audio.click();
    });
  }
  for (const btn of document.querySelectorAll('[data-diff]')) {
    btn.addEventListener('click', () => {
      settings.difficulty = btn.dataset.diff;
      document.querySelectorAll('[data-diff]').forEach((b) => b.classList.toggle('sel', b === btn));
      hooks.audio.click();
    });
  }
  el('btn-start').addEventListener('click', () => { hooks.audio.click(); hooks.onStart({ ...settings }); });
  el('btn-back-menu').addEventListener('click', () => { hooks.audio.click(); U.showMenu(); });

  // Settings (shared by menu + pause).
  let settingsReturn = 'menu';
  function openSettings(from) {
    settingsReturn = from;
    el('set-sens').value = settings.sensitivity;
    el('set-sens-val').textContent = settings.sensitivity.toFixed(2);
    el('set-vol').value = settings.volume;
    el('set-vol-val').textContent = Math.round(settings.volume * 100) + '%';
    el('set-quality').value = settings.quality;
    U.settings.style.display = 'flex';
    if (from === 'menu') U.menu.style.display = 'none';
    else U.pause.style.display = 'none';
  }
  U.openSettings = openSettings;
  el('set-sens').addEventListener('input', (e) => {
    settings.sensitivity = parseFloat(e.target.value);
    el('set-sens-val').textContent = settings.sensitivity.toFixed(2);
    hooks.onSettings({ ...settings });
  });
  el('set-vol').addEventListener('input', (e) => {
    settings.volume = parseFloat(e.target.value);
    el('set-vol-val').textContent = Math.round(settings.volume * 100) + '%';
    hooks.onSettings({ ...settings });
  });
  el('set-quality').addEventListener('change', (e) => {
    settings.quality = e.target.value;
    hooks.onSettings({ ...settings });
  });
  el('btn-settings-done').addEventListener('click', () => {
    hooks.audio.click();
    U.settings.style.display = 'none';
    if (settingsReturn === 'menu') U.menu.style.display = 'flex';
    else U.pause.style.display = 'flex';
  });

  // Pause.
  el('btn-resume').addEventListener('click', () => { hooks.audio.click(); hooks.onResume(); });
  el('btn-pause-settings').addEventListener('click', () => { hooks.audio.click(); openSettings('pause'); });
  el('btn-quit-menu').addEventListener('click', () => { hooks.audio.click(); hooks.onQuitToMenu(); });

  // End screen.
  el('btn-again').addEventListener('click', () => { hooks.audio.click(); hooks.onRestart(); });
  el('btn-end-menu').addEventListener('click', () => { hooks.audio.click(); hooks.onQuitToMenu(); });

  // Buy menu grid (built once, refreshed per open).
  U.buyGrid.innerHTML = BUY_ITEMS.map((it, i) => {
    const price = it.id === 'ammo' ? 200 : ECONOMY.prices[it.id];
    return `<button class="buy-item" data-item="${it.id}">
      <span class="buy-key">${i + 1}</span>
      <span class="buy-name">${it.name}</span>
      <span class="buy-desc">${it.desc}</span>
      <span class="buy-price">$${price}</span>
    </button>`;
  }).join('');
  U.buyGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.buy-item');
    if (btn) hooks.onBuy(btn.dataset.item);
  });
  el('btn-buy-close').addEventListener('click', () => { hooks.audio.click(); U.hideBuy(); hooks.onBuyClose(); });

  function renderBuy(s) {
    const p = playerOf(s);
    U.buyMoney.textContent = `$${p.money}`;
    const plan = squadBuyPlan(s, p.squad);
    const planText = { full: 'FULL BUY — squad is rich, spend it', force: 'FORCE BUY — spend, but keep it lean', light: 'LIGHT FORCE — pistol + utility', eco: 'ECO — save for a full buy next round' }[plan];
    U.buyPlan.textContent = `Squad plan: ${planText}`;
    for (const btn of U.buyGrid.querySelectorAll('.buy-item')) {
      const id = btn.dataset.item;
      const owned = (id === 'armor' && p.armor) || (id === 'helmet' && p.helmet) || (id === 'defuseKit' && p.defuseKit) ||
        (id === 'rifle' && p.primary?.id === 'rifle') || (id === 'smg' && p.primary?.id === 'smg') ||
        (id === 'shotgun' && p.primary?.id === 'shotgun') || (id === 'sniper' && p.primary?.id === 'sniper') ||
        (id === 'handcannon' && p.secondary?.id === 'handcannon');
      btn.classList.toggle('cant', !!buyBlockedReason(s, p, id));
      btn.classList.toggle('owned', !!owned);
    }
  }
  U.renderBuy = renderBuy;
  U.buyMessage = (msg, ok) => {
    U.buyMsg.textContent = msg;
    U.buyMsg.style.color = ok ? '#8fd98f' : '#ff8a7a';
  };
  U.getSettings = () => ({ ...settings });

  U.renderEnd = (s) => {
    const p = playerOf(s);
    const won = s.winner === p.squad;
    const mvp = s.mvp;
    el('end-title').textContent = won ? 'VICTORY' : 'DEFEAT';
    el('end-title').className = won ? 'end-title win' : 'end-title loss';
    el('end-score').textContent = `${SQUADS.alpha.name} ${s.score.alpha} — ${s.score.bravo} ${SQUADS.bravo.name}`;
    const acc = p.shotsFired > 0 ? Math.min(100, Math.round((p.shotsHit / p.shotsFired) * 100)) : 0;
    U.endBody.innerHTML = `
      <div class="mvp-card">★ MVP — <b style="color:${SQUADS[mvp.squad].css}">${mvp.name}</b>
        · ${mvp.kills}K / ${mvp.deaths}D / ${mvp.assists}A · ${Math.round(mvp.damage)} dmg · ${mvp.plants} plants · ${mvp.defuses} defuses</div>
      <div class="end-stats">Your line: <b>${p.kills}K / ${p.deaths}D / ${p.assists}A</b> · ${p.headshots} headshots · ${Math.round(p.damage)} damage · ${acc}% accuracy · ${p.plants} plants · ${p.defuses} defuses</div>
      <div class="end-hist">${s.roundHistory.map((r) => `<span class="pip ${r.winner}" title="R${r.round}: ${r.reason}"></span>`).join('')}</div>`;
  };
  return U;
}
