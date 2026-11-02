import { describe, expect, it } from 'vitest';
import { getGameData } from '../src/data';

describe('game data', () => {
  it('loads and validates all JSON', () => {
    const d = getGameData();
    expect(d.units).toHaveLength(45);
    expect(d.units.filter((u) => u.stage !== 3)).toHaveLength(30);
    expect(d.generals.map((g) => g.id).sort()).toEqual(['dragon', 'paladin']);
    expect(d.formations.map((f) => f.id).sort()).toEqual(['guard', 'line', 'wedge']);
  });
});
