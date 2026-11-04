import { describe, expect, it } from 'vitest';
import { getGameData } from '../src/data';
import { uniqueName } from '../src/data/names';
import { createRng, nextFloat } from '../src/sim/rng';

describe('rng + names', () => {
  it('rng is deterministic per seed', () => {
    const a = createRng(42), b = createRng(42);
    const xs = Array.from({ length: 5 }, () => nextFloat(a));
    expect(Array.from({ length: 5 }, () => nextFloat(b))).toEqual(xs);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });
  it('generates unique names', () => {
    const rng = createRng(1), taken = new Set<string>();
    const names = Array.from({ length: 500 }, () => uniqueName(rng, getGameData().names, taken));
    expect(new Set(names).size).toBe(500);
  });
});
