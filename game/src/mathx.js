// Allocation-free 3D helpers on plain [x, y, z] arrays. Hot paths reuse
// scratch vectors; functions take an `out` target.
export const V3 = {
  make(x = 0, y = 0, z = 0) { return [x, y, z]; },
  copy(out, a) { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out; },
  set(out, x, y, z) { out[0] = x; out[1] = y; out[2] = z; return out; },
  add(out, a, b) { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2]; return out; },
  sub(out, a, b) { out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2]; return out; },
  scale(out, a, s) { out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s; return out; },
  madd(out, a, b, s) { out[0] = a[0] + b[0] * s; out[1] = a[1] + b[1] * s; out[2] = a[2] + b[2] * s; return out; },
  dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
  len(a) { return Math.hypot(a[0], a[1], a[2]); },
  dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); },
  dist2(a, b) { const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]; return dx * dx + dy * dy + dz * dz; },
  norm(out, a) { const l = V3.len(a) || 1; out[0] = a[0] / l; out[1] = a[1] / l; out[2] = a[2] / l; return out; },
  lerp(out, a, b, t) { out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t; return out; },
};

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent exponential approach: rate ~ how fast (1/s).
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
export const DEG = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

// Ray vs axis-aligned box. Box is {min:[x,y,z], max:[x,y,z]}. Returns the
// smallest t >= 0 along origin + t*dir, or Infinity. Slab method, no alloc.
export function rayAabb(ox, oy, oz, dx, dy, dz, b, tMax) {
  let tmin = 0, tmax = tMax;
  const mn = b.min, mx = b.max;
  // X slab
  if (Math.abs(dx) < 1e-9) { if (ox < mn[0] || ox > mx[0]) return Infinity; }
  else {
    let t1 = (mn[0] - ox) / dx, t2 = (mx[0] - ox) / dx;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < mn[1] || oy > mx[1]) return Infinity; }
  else {
    let t1 = (mn[1] - oy) / dy, t2 = (mx[1] - oy) / dy;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < mn[2] || oz > mx[2]) return Infinity; }
  else {
    let t1 = (mn[2] - oz) / dz, t2 = (mx[2] - oz) / dz;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

// Ray vs sphere. Returns t or Infinity.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, tMax) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  const t = tca - Math.sqrt(r2 - d2);
  return t >= 0 && t <= tMax ? t : Infinity;
}

// Segment vs AABB (for grenade sweep and link validation). True if the
// segment from p0 to p1 touches the box expanded by `pad`.
export function segmentHitsBox(p0, p1, b, pad) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) {
    return p0[0] >= b.min[0] - pad && p0[0] <= b.max[0] + pad &&
      p0[1] >= b.min[1] - pad && p0[1] <= b.max[1] + pad &&
      p0[2] >= b.min[2] - pad && p0[2] <= b.max[2] + pad;
  }
  const t = rayAabb(p0[0], p0[1], p0[2], dx / len, dy / len, dz / len,
    { min: [b.min[0] - pad, b.min[1] - pad, b.min[2] - pad], max: [b.max[0] + pad, b.max[1] + pad, b.max[2] + pad] }, len);
  return t !== Infinity;
}
