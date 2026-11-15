// DUSK HARBOR — a coastal freight terminal at sunset. Three lanes (A-main,
// mid rail corridor, B-alley), two bomb sites, two rotation corridors.
// Raiders spawn west, Guards east. X east, Z south, Y up, metres, ground y=0.
// Every solid is an AABB used for BOTH movement collision and bullet
// occlusion — what blocks your body blocks your shots, no invisible walls.
// Waypoints are validated by the simtest: every link clears every solid with
// 0.45m padding, so bots never path through geometry.

export const MAP = {
  name: 'Dusk Harbor',
  bounds: { minX: -38, maxX: 38, minZ: -28, maxZ: 28 },
  // Solids: [minX, minY, minZ, maxX, maxY, maxZ, kind, material]
  // kind: wall | crate | barrel | train | container | block | post
  solids: [
    // Perimeter (height 4, brick/concrete)
    [-38, 0, -28, 38, 4, -26.5, 'wall', 'brick'],
    [-38, 0, 26.5, 38, 4, 28, 'wall', 'brick'],
    [-38, 0, -28, -36.5, 4, 28, 'wall', 'concrete'],
    [36.5, 0, -28, 38, 4, 28, 'wall', 'concrete'],
    // Interior dividers with connector gaps at x 8..14
    [-26, 0, -13, 8, 4, -12, 'wall', 'concrete'],
    [14, 0, -13, 26, 4, -12, 'wall', 'concrete'],
    [-26, 0, 12, 8, 4, 13, 'wall', 'concrete'],
    [14, 0, 12, 26, 4, 13, 'wall', 'concrete'],
    // A warehouse (east back wall of A site, tall)
    [26, 0, -24, 35, 6, -14, 'block', 'warehouse'],
    // A site crates / barrels
    [18, 0, -23, 20, 1.2, -21, 'crate', 'wood'],
    [24, 0, -22, 26, 1.2, -20, 'crate', 'wood'],
    [19, 0, -17, 21, 2.4, -15, 'crate', 'woodDark'],
    [15.5, 0, -13.5, 16.5, 1.1, -12.5, 'barrel', 'rust'],
    [28, 0, -21, 30, 1.2, -19, 'crate', 'wood'],
    // A-main crates
    [-15, 0, -25.5, -13, 1.2, -23.5, 'crate', 'wood'],
    [-5, 0, -25, -3, 1.2, -23, 'crate', 'wood'],
    [3, 0, -26, 5, 1.2, -24, 'crate', 'woodDark'],
    // Mid: two rail cars (full cover, cannot be shot through)
    [-10, 0, -1.6, -4, 3.2, 1.6, 'train', 'railcar'],
    [3, 0, -1.6, 9, 3.2, 1.6, 'train', 'railcar2'],
    [-19, 0, -4, -17, 1.2, -2, 'crate', 'wood'],
    [16, 0, 2, 18, 1.2, 4, 'crate', 'wood'],
    // B site: container row + crates
    [28, 0, 15, 33, 2.8, 18, 'container', 'containerBlue'],
    [19, 0, 14, 21, 1.2, 16, 'crate', 'wood'],
    [24, 0, 19, 26, 1.2, 21, 'crate', 'woodDark'],
    [18, 0, 21, 20, 1.2, 23, 'crate', 'wood'],
    [16, 0, 17, 17, 1.1, 18, 'barrel', 'rust'],
    // B-alley crates
    [-15, 0, 23.5, -13, 1.2, 25.5, 'crate', 'wood'],
    [-3, 0, 23, -1, 1.2, 25, 'crate', 'wood'],
    [5, 0, 24, 7, 1.2, 26, 'crate', 'woodDark'],
    // Spawn cover
    [-36, 0, -9, -34.5, 1.2, -7, 'crate', 'wood'],
    [-36, 0, 7, -34.5, 1.2, 9, 'crate', 'wood'],
    [31, 0, -5, 33, 1.2, -3, 'crate', 'wood'],
    [31, 0, 3, 33, 1.2, 5, 'crate', 'wood'],
    // Connector door posts (visual frames, thin blockers)
    [8, 0, -13, 8.6, 3.4, -12, 'post', 'metal'],
    [13.4, 0, -13, 14, 3.4, -12, 'post', 'metal'],
    [8, 0, 12, 8.6, 3.4, 13, 'post', 'metal'],
    [13.4, 0, 12, 14, 3.4, 13, 'post', 'metal'],
  ],
  sites: {
    A: { min: [16, -24], max: [28, -14], center: [22, -19], label: 'A' },
    B: { min: [16, 14], max: [28, 24], center: [22, 19], label: 'B' },
  },
  spawns: {
    raider: [
      [-34, -6, -Math.PI / 2], [-34, -2, -Math.PI / 2], [-34, 2, -Math.PI / 2],
      [-34, 6, -Math.PI / 2], [-32, 0, -Math.PI / 2],
    ],
    guard: [
      [34, -6, Math.PI / 2], [34, -2, Math.PI / 2], [34, 2, Math.PI / 2],
      [34, 6, Math.PI / 2], [32, 0, Math.PI / 2],
    ],
  },
  // Waypoint graph: [x, z, [neighbour ids...]]. Bots path with Dijkstra.
  // Node ids are array indices; keep this list stable.
  waypoints: [
    [-33, 0, [1, 2, 3]],          // 0 raider spawn
    [-30, -6, [0, 4]],            // 1
    [-30, 0, [0, 5]],             // 2
    [-30, 6, [0, 6]],             // 3
    [-28, -14, [1, 7]],           // 4 A-main west
    [-24, 0, [2, 16]],            // 5 mid west
    [-28, 14, [3, 25]],           // 6 B-alley west
    [-22, -22, [4, 8]],           // 7 A-main
    [-12, -23, [7, 9]],           // 8 A-main
    [-2, -22, [8, 10, 24]],       // 9 A-main
    [6, -23, [9, 11]],            // 10 A-main east
    [14, -21, [10, 12]],          // 11 A yard entry
    [21, -19, [11, 13, 38]],      // 12 A site
    [24, -15, [12, 38]],          // 13 A site back
    [18, -14, [15]],              // 14 A yard south (divider blocks the corridor)
    [11, -16, [14, 21, 24]],      // 15 A connector north
    [-16, 0, [5, 17, 40]],        // 16 mid
    [-7, 4.5, [16, 18]],          // 17 mid south of west car
    [-1, 1, [17, 19]],            // 18 mid gap between cars
    [7, 4, [18, 20]],             // 19 mid south of east car
    [14, 0, [19, 21, 22, 33, 41]],// 20 mid east hub
    [11, -9, [15, 20]],           // 21 A connector south
    [11, 9, [20, 23]],            // 22 B connector south
    [11, 16, [22, 32]],           // 23 B connector north
    [0, -14, [9, 15]],            // 24 north shortcut: A-main to connector
    [-22, 22, [6, 26]],           // 25 B-alley
    [-12, 23, [25, 27]],          // 26 B-alley
    [-2, 22, [26, 28]],           // 27 B-alley
    [6, 23, [27, 29]],            // 28 B-alley east
    [14, 21, [28, 30]],           // 29 B yard entry
    [20, 19, [29, 31, 39]],       // 30 B site
    [23, 14, [30, 39]],           // 31 B site back
    [17, 14, [23]],               // 32 B yard north (divider blocks the corridor)
    [30, 0, [20, 34, 35]],        // 33 guard spawn
    [30, -6, [33, 36]],           // 34
    [30, 6, [33, 37]],            // 35
    [22, -10, [34]],              // 36 rotation corridor north (holding spot)
    [22, 10, [35]],               // 37 rotation corridor south (holding spot)
    [23, -19, [12, 13]],          // 38 A site east
    [27, 18, [31, 30]],           // 39 B site east
    [-7, -3.6, [16, 41]],         // 40 mid north of west car
    [7, -3.8, [40, 20]],          // 41 mid north of east car
  ],
  // Callout zones for bot intel sharing and radar labels.
  zones: [
    { id: 'asite', label: 'A Site', min: [14, -26], max: [30, -12] },
    { id: 'amain', label: 'A Main', min: [-28, -26], max: [14, -13] },
    { id: 'mid', label: 'Mid', min: [-26, -8], max: [16, 8] },
    { id: 'balley', label: 'B Alley', min: [-28, 13], max: [14, 26] },
    { id: 'bsite', label: 'B Site', min: [14, 12], max: [30, 26] },
    { id: 'conn', label: 'Connector', min: [8, -12], max: [14, 12] },
    { id: 'rspawn', label: 'Raider Spawn', min: [-38, -12], max: [-26, 12] },
    { id: 'gspawn', label: 'Guard Spawn', min: [28, -8], max: [38, 8] },
    { id: 'rotN', label: 'North Corridor', min: [14, -12], max: [28, -8] },
    { id: 'rotS', label: 'South Corridor', min: [14, 8], max: [28, 12] },
  ],
  // Decorative placements (no collision): lighthouse, crane, stacks, lamps.
  decor: [
    { kind: 'lighthouse', pos: [30, -34] },
    { kind: 'crane', pos: [42, 16] },
    { kind: 'cranesmall', pos: [-42, -20] },
    { kind: 'stack', pos: [-42, 18] },
    { kind: 'stack', pos: [44, -14] },
    { kind: 'ship', pos: [58, -6] },
    { kind: 'lamp', pos: [-20, -18] },
    { kind: 'lamp', pos: [20, -8] },
    { kind: 'lamp', pos: [-20, 18] },
    { kind: 'lamp', pos: [20, 8] },
    { kind: 'lamp', pos: [0, -20] },
    { kind: 'lamp', pos: [0, 20] },
  ],
};

// Parsed solids as {min:[x,y,z], max:[x,y,z], kind, mat} — built once.
export const SOLIDS = MAP.solids.map((s) => ({
  min: [s[0], s[1], s[2]], max: [s[3], s[4], s[5]], kind: s[6], mat: s[7],
}));

export function zoneAt(x, z) {
  for (const zn of MAP.zones) {
    if (x >= zn.min[0] && x <= zn.max[0] && z >= zn.min[1] && z <= zn.max[1]) return zn;
  }
  return MAP.zones[2];
}

export function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = MAP.sites[key];
    if (x >= s.min[0] && x <= s.max[0] && z >= s.min[1] && z <= s.max[1]) return key;
  }
  return null;
}

// Dijkstra over the waypoint graph. Returns an array of waypoint ids from
// `from` to `to` (inclusive), or [] if unreachable. Pure + allocation-light.
export function findPath(from, to) {
  const n = MAP.waypoints.length;
  if (from === to) return [from];
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int16Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[from] = 0;
  for (let iter = 0; iter < n; iter++) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u === -1) break;
    done[u] = 1;
    if (u === to) break;
    const wp = MAP.waypoints[u];
    for (const v of wp[2]) {
      const w2 = MAP.waypoints[v];
      const d = dist[u] + Math.hypot(w2[0] - wp[0], w2[1] - wp[1]);
      if (d < dist[v]) { dist[v] = d; prev[v] = u; }
    }
  }
  if (prev[to] === -1 && to !== from) return [];
  const path = [];
  let cur = to;
  while (cur !== -1) { path.push(cur); cur = prev[cur]; }
  path.reverse();
  return path;
}

export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < MAP.waypoints.length; i++) {
    const w = MAP.waypoints[i];
    const d = (w[0] - x) * (w[0] - x) + (w[1] - z) * (w[1] - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
