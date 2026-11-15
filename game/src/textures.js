// Procedural textures: every surface painted on a canvas at load — no
// external files, no network. A fixed seed keeps them identical every run.
// Multi-octave value noise for grain/stains, per-brick/per-plank variation,
// edge wear, rust streaks, cracks, stencils. 512px hero, 256px props.
import * as THREE from 'three';
import { makeRng } from './rng.js';

const rng = makeRng(0xC0FFEE);

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function tex(c, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Smooth value noise in [0,1] — cheap, tileable-ish at the scales we use.
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const h = (a, b) => {
    let n = (a * 374761393 + b * 668265263) | 0;
    n = Math.imul(n ^ (n >> 13), 1274126177);
    return ((n ^ (n >> 16)) >>> 0) / 4294967296;
  };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 4) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += amp * noise(x * f, y * f); amp *= 0.5; f *= 2.03; }
  return v;
}
function grain(ctx, w, h, base, amp, scale = 3) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = fbm(x / w * scale, y / h * scale) - 0.5;
    const i = (y * w + x) * 4;
    d[i] += n * amp; d[i + 1] += n * amp; d[i + 2] += n * amp;
  }
  ctx.putImageData(img, 0, 0);
}
function stains(ctx, w, h, n, color, rMin, rMax, alpha) {
  for (let i = 0; i < n; i++) {
    const x = rng.next() * w, y = rng.next() * h, r = rMin + rng.next() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace('A', String(alpha)));
    g.addColorStop(1, color.replace('A', '0'));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((n >> 8) & 255) * f) | 0;
  const b = Math.min(255, (n & 255) * f) | 0;
  return `rgb(${r},${g},${b})`;
}

function paintBrick() {
  const w = 512, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#989081'; ctx.fillRect(0, 0, w, h); // mortar
  const bh = 32, bw = 84;
  for (let row = 0; row * bh < h; row++) {
    const off = (row % 2) * bw / 2;
    for (let col = -1; col * bw < w + bw; col++) {
      const x = col * bw + off, y = row * bh;
      const v = 0.82 + rng.next() * 0.36;
      ctx.fillStyle = shade(rng.chance(0.12) ? '#74503f' : '#a06249', v);
      ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      // Top highlight + bottom shade = depth; per-brick speckle.
      ctx.fillStyle = 'rgba(255,235,210,0.10)'; ctx.fillRect(x + 2, y + 2, bw - 4, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x + 2, y + bh - 6, bw - 4, 4);
      for (let s = 0; s < 14; s++) {
        ctx.fillStyle = `rgba(0,0,0,${0.05 + rng.next() * 0.12})`;
        ctx.fillRect(x + 3 + rng.next() * (bw - 6), y + 3 + rng.next() * (bh - 6), 2, 2);
      }
    }
  }
  grain(ctx, w, h, 0, 26, 5);
  stains(ctx, w, h, 7, 'rgba(30,25,20,A)', 40, 130, 0.16);
  stains(ctx, w, h, 4, 'rgba(60,50,35,A)', 60, 160, 0.12);
  return c;
}

function paintConcrete() {
  const w = 512, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#a8a398'; ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0, 34, 4);
  // Formwork seams + tie holes.
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2;
  for (let y = 128; y < h; y += 128) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 64; y < h; y += 128) for (let x = 64; x < w; x += 128) { ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); }
  // Hairline cracks: short random walks.
  ctx.strokeStyle = 'rgba(40,38,34,0.5)'; ctx.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    let x = rng.next() * w, y = rng.next() * h, a = rng.next() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 22; s++) { a += (rng.next() - 0.5) * 0.9; x += Math.cos(a) * 7; y += Math.sin(a) * 7; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  stains(ctx, w, h, 8, 'rgba(50,48,40,A)', 50, 150, 0.14);
  stains(ctx, w, h, 3, 'rgba(90,70,40,A)', 30, 80, 0.18); // rust weeps
  return c;
}

function paintWood(dark) {
  const w = 512, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
  const base = dark ? '#735031' : '#a37c50';
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  const ph = 64;
  for (let row = 0; row * ph < h; row++) {
    const y = row * ph;
    ctx.fillStyle = shade(base, 0.88 + rng.next() * 0.24);
    ctx.fillRect(0, y + 1, w, ph - 2);
    // Grain: long wavy darker lines.
    ctx.strokeStyle = 'rgba(60,38,18,0.35)'; ctx.lineWidth = 1.4;
    for (let g = 0; g < 7; g++) {
      const gy = y + 6 + rng.next() * (ph - 12);
      ctx.beginPath(); ctx.moveTo(0, gy);
      for (let x = 0; x <= w; x += 32) ctx.lineTo(x, gy + Math.sin(x * 0.02 + g) * 2.5 + (rng.next() - 0.5) * 2);
      ctx.stroke();
    }
    // Knot.
    if (rng.chance(0.7)) {
      const kx = rng.next() * w, ky = y + ph / 2;
      ctx.strokeStyle = 'rgba(50,30,12,0.55)'; ctx.lineWidth = 2;
      for (let r = 3; r < 11; r += 3) { ctx.beginPath(); ctx.ellipse(kx, ky, r * 1.6, r, 0, 0, 7); ctx.stroke(); }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, y, w, 2);
    ctx.fillStyle = 'rgba(255,240,210,0.08)'; ctx.fillRect(0, y + 2, w, 2);
    // Nails.
    ctx.fillStyle = 'rgba(30,28,26,0.8)';
    ctx.beginPath(); ctx.arc(14, y + ph / 2, 3, 0, 7); ctx.arc(w - 14, y + ph / 2, 3, 0, 7); ctx.fill();
  }
  grain(ctx, w, h, 0, 18, 6);
  stains(ctx, w, h, 4, 'rgba(40,28,14,A)', 40, 110, 0.14);
  return c;
}

function paintMetal(base, rusty) {
  const w = 512, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  // Corrugation: vertical light/dark bands.
  for (let x = 0; x < w; x += 16) {
    const g = ctx.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.28)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.14)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = g; ctx.fillRect(x, 0, 16, h);
  }
  grain(ctx, w, h, 0, 20, 5);
  if (rusty) {
    // Rust streaks running down from the top edge.
    for (let i = 0; i < 26; i++) {
      const x = rng.next() * w, len = 60 + rng.next() * 300, wd = 3 + rng.next() * 9;
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(122,66,30,0.55)');
      g.addColorStop(1, 'rgba(122,66,30,0)');
      ctx.fillStyle = g; ctx.fillRect(x, 0, wd, len);
    }
    stains(ctx, w, h, 8, 'rgba(110,58,26,A)', 20, 70, 0.3);
  }
  // Rivets along the edges.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let x = 8; x < w; x += 32) { ctx.beginPath(); ctx.arc(x, 10, 3, 0, 7); ctx.arc(x, h - 10, 3, 0, 7); ctx.fill(); }
  return c;
}

function paintAsphalt() {
  const w = 512, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#69635b'; ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0, 30, 7);
  // Aggregate speckle.
  for (let i = 0; i < 2600; i++) {
    const v = rng.next();
    ctx.fillStyle = v > 0.5 ? 'rgba(255,250,240,0.10)' : 'rgba(0,0,0,0.14)';
    ctx.fillRect(rng.next() * w, rng.next() * h, 2, 2);
  }
  // Patches + cracks + oil stains.
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = 'rgba(30,28,26,0.25)';
    ctx.fillRect(rng.next() * w, rng.next() * h, 60 + rng.next() * 120, 40 + rng.next() * 80);
  }
  ctx.strokeStyle = 'rgba(20,18,16,0.5)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) {
    let x = rng.next() * w, y = rng.next() * h, a = rng.next() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 18; s++) { a += (rng.next() - 0.5) * 1.1; x += Math.cos(a) * 8; y += Math.sin(a) * 8; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  stains(ctx, w, h, 6, 'rgba(15,14,12,A)', 30, 90, 0.25);
  return c;
}

function paintContainer(base, label) {
  const c = paintMetal(base, true);
  const ctx = c.getContext('2d');
  // Faded stencil label.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#e8e2d4';
  ctx.font = 'bold 64px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, 256, 180);
  ctx.font = 'bold 30px Arial, sans-serif';
  ctx.fillText('DUSK HARBOR  •  22G1', 256, 230);
  ctx.restore();
  // Wear the paint back with streaks.
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(${base === '#346683' ? '52,102,131' : '122,62,32'},${0.1 + rng.next() * 0.2})`;
    ctx.fillRect(rng.next() * 512, 120 + rng.next() * 140, 4 + rng.next() * 14, 20 + rng.next() * 60);
  }
  return c;
}

function paintRailcar(base, num) {
  const c = paintMetal(base, true);
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = '#ddd6c4';
  ctx.font = 'bold 52px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(num, 256, 140);
  ctx.font = '24px Arial, sans-serif';
  ctx.fillText('HARBOUR FREIGHT', 256, 180);
  ctx.restore();
  // Panel seams.
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 3;
  for (let x = 86; x < 512; x += 86) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke(); }
  return c;
}

function paintWarehouse() {
  const w = 512, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#857562'; ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0, 26, 4);
  // Big faded panels + a roller door.
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 3;
  for (let x = 0; x <= w; x += 128) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  ctx.fillStyle = '#655c50';
  ctx.fillRect(156, 200, 200, 312);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2;
  for (let y = 210; y < 512; y += 18) { ctx.beginPath(); ctx.moveTo(156, y); ctx.lineTo(356, y); ctx.stroke(); }
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#e8dfc8';
  ctx.font = 'bold 58px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TERMINAL 7', 256, 120);
  ctx.restore();
  stains(ctx, w, h, 9, 'rgba(40,34,26,A)', 40, 140, 0.18);
  return c;
}

function paintHazard() {
  const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#c9a227'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#221f1c';
  for (let x = -256; x < 512; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 256); ctx.lineTo(x + 32, 256); ctx.lineTo(x + 32 + 256, 0); ctx.lineTo(x + 256, 0);
    ctx.closePath(); ctx.fill();
  }
  grain(ctx, w, h, 0, 30, 5);
  stains(ctx, w, h, 4, 'rgba(20,18,14,A)', 30, 80, 0.25);
  return c;
}

function paintLetter(letter, color) {
  const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.font = 'bold 190px Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 134);
  // Worn paint: punch holes.
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 130; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.25 + rng.next() * 0.5})`;
    ctx.fillRect(30 + rng.next() * 196, 30 + rng.next() * 196, 2 + rng.next() * 5, 2 + rng.next() * 5);
  }
  return c;
}

function paintGlow() {
  const w = 128, h = 128, c = canvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,220,160,0.55)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  return c;
}

function paintSmokePuff() {
  const w = 128, h = 128, c = canvas(w, h), ctx = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const a = rng.next() * Math.PI * 2, r = rng.next() * 34;
    const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r, rad = 16 + rng.next() * 22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(235,232,226,0.55)');
    g.addColorStop(1, 'rgba(235,232,226,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return c;
}

function paintGrass() {
  const w = 128, h = 128, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < 46; i++) {
    const x = 6 + rng.next() * (w - 12), lean = (rng.next() - 0.5) * 26;
    const hgt = 40 + rng.next() * 70;
    const g = 0.45 + rng.next() * 0.3;
    ctx.strokeStyle = `rgba(${120 + rng.next() * 40 | 0},${130 * g + 60 | 0},${40 + rng.next() * 20 | 0},0.95)`;
    ctx.lineWidth = 2 + rng.next() * 2;
    ctx.beginPath(); ctx.moveTo(x, 128);
    ctx.quadraticCurveTo(x + lean * 0.3, 128 - hgt * 0.6, x + lean, 128 - hgt);
    ctx.stroke();
  }
  return c;
}

function paintRust() {
  const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#82522e'; ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0, 44, 4);
  stains(ctx, w, h, 10, 'rgba(60,30,12,A)', 20, 70, 0.35);
  stains(ctx, w, h, 6, 'rgba(150,90,40,A)', 15, 50, 0.3);
  // Barrel ribs.
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 60, w, 8); ctx.fillRect(0, 186, w, 8);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, 68, w, 4); ctx.fillRect(0, 194, w, 4);
  return c;
}

// One shared roughness variation map (grayscale noise) reused by materials.
function paintRough() {
  const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#8a8a8a'; ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0, 60, 6);
  return c;
}

export function buildTextures() {
  const rough = tex(paintRough());
  const T = {
    brick: tex(paintBrick(), 2, 1),
    concrete: tex(paintConcrete(), 2, 1),
    wood: tex(paintWood(false)),
    woodDark: tex(paintWood(true)),
    metal: tex(paintMetal('#767b7f', true)),
    asphalt: tex(paintAsphalt(), 10, 8),
    railcar: tex(paintRailcar('#82412d', 'HF-2214')),
    railcar2: tex(paintRailcar('#436270', 'HF-0907')),
    containerBlue: tex(paintContainer('#346683', 'NORDLYS')),
    warehouse: tex(paintWarehouse()),
    hazard: tex(paintHazard()),
    rust: tex(paintRust()),
    letterA: tex(paintLetter('A', 'rgba(232,220,190,0.85)')),
    letterB: tex(paintLetter('B', 'rgba(232,220,190,0.85)')),
    glow: tex(paintGlow()),
    smoke: tex(paintSmokePuff()),
    grass: tex(paintGrass()),
    rough,
  };
  return T;
}
