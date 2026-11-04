// Seeded PRNG (mulberry32). The ONLY randomness source allowed in sim/ai/roster generation.
// State is a plain number so it can live inside world state and be hashed/cloned.

export interface Rng {
  state: number;
}

export function createRng(seed: number): Rng {
  return { state: seed >>> 0 };
}

/** Uniform float in [0, 1). Advances rng.state. */
export function nextFloat(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform integer in [0, n). */
export function nextInt(rng: Rng, n: number): number {
  return Math.floor(nextFloat(rng) * n);
}

/** Uniform float in [min, max). */
export function nextRange(rng: Rng, min: number, max: number): number {
  return min + nextFloat(rng) * (max - min);
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick from empty array');
  return items[nextInt(rng, items.length)]!;
}

/** Deterministic id string, e.g. for troops. */
export function nextId(rng: Rng, prefix: string): string {
  const a = Math.floor(nextFloat(rng) * 0x100000000).toString(16).padStart(8, '0');
  const b = Math.floor(nextFloat(rng) * 0x100000000).toString(16).padStart(8, '0');
  return `${prefix}-${a}${b}`;
}
