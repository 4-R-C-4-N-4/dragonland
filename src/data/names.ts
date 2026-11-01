// Troop name generation from data/names.json syllables. Pure + seeded.
import type { Names } from './schemas';
import { pick, type Rng } from '../sim/rng';

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** One random name (may collide; use uniqueName for roster uniqueness). */
export function randomName(rng: Rng, names: Names): string {
  return capitalize(pick(rng, names.first) + pick(rng, names.middle) + pick(rng, names.last));
}

/**
 * A name not in `taken`. Falls back to a numeric suffix once the syllable space is crowded,
 * so this always terminates. Adds the result to `taken`.
 */
export function uniqueName(rng: Rng, names: Names, taken: Set<string>): string {
  for (let i = 0; i < 50; i++) {
    const n = randomName(rng, names);
    if (!taken.has(n)) {
      taken.add(n);
      return n;
    }
  }
  const base = randomName(rng, names);
  let k = 2;
  while (taken.has(`${base} ${k}`)) k++;
  const n = `${base} ${k}`;
  taken.add(n);
  return n;
}
