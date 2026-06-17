/**
 * Deterministic, dependency-free pseudo-random helpers.
 *
 * Reproducibility is a hard requirement of the benchmark (rerun variance < 2%),
 * so every stochastic decision in mock providers and human-review sampling is
 * derived from a stable string seed rather than `Math.random`.
 */

/** FNV-1a string hash → 32-bit unsigned integer. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG factory. Returns a function yielding floats in [0, 1). */
export function mulberry32(seedInt: number): () => number {
  let a = seedInt >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience: a deterministic float in [0, 1) for a given seed string. */
export function seededFloat(seed: string): number {
  return mulberry32(hashSeed(seed))();
}

/** Deterministic boolean that is true with probability `p` for a given seed. */
export function seededChance(seed: string, p: number): boolean {
  return seededFloat(seed) < p;
}
