// Seeded deterministic RNG (mulberry32). One stream drives the whole match so a
// ?seed= value reproduces bot decisions, spread rolls and screenshot staging.
export function makeRng(seed) {
  let a = seed >>> 0 || 0x9e3779b9;
  return {
    next() {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(lo, hi) { return lo + this.next() * (hi - lo); },
    int(lo, hi) { return Math.floor(this.range(lo, hi + 1)); },
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; },
    chance(p) { return this.next() < p; },
    // Box-Muller gaussian, mean 0, stddev 1. Used for aim error and spread so
    // shots cluster realistically instead of spreading uniformly.
    gauss() {
      let u = 0, v = 0;
      while (u === 0) u = this.next();
      v = this.next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}
