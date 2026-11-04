import legacyGenerals from './fixtures/legacy-generals.json';
import { describe, expect, it } from 'vitest';
import { getGameData, SpecialDefSchema } from '../src/data';

describe('game data', () => {
  it('loads and validates all JSON', () => {
    const d = getGameData();
    expect(d.units).toHaveLength(45);
    expect(d.units.filter((u) => u.stage !== 3)).toHaveLength(30);
    expect(d.generals.map((g) => g.id).sort()).toEqual(d.units.filter((u) => u.stage === 3).map((u) => u.id).sort());
    expect(d.formations.map((f) => f.id).sort()).toEqual(['guard', 'line', 'wedge']);
  });
});

it('normalizes legacy specials and strips obsolete fields', () => {
  const legacy = legacyGenerals[0]!.special;
  const parsed = SpecialDefSchema.parse(legacy);
  expect(parsed).toMatchObject({ rechargeS: legacy.cooldownS });
  expect(parsed).not.toHaveProperty('cooldownS');
  expect(parsed).not.toHaveProperty('mpCost');
});

it.each([0, -1, null, '2', Number.NaN, Infinity, undefined])('rejects explicit invalid rechargeS %s even with legacy cooldownS', (rechargeS) => {
  expect(SpecialDefSchema.safeParse({ ...legacyGenerals[0]!.special, rechargeS }).success).toBe(false);
});

it('accepts current specials without obsolete fields and prefers explicit rechargeS', () => {
  const legacy = legacyGenerals[0]!.special;
  const { cooldownS, mpCost, ...fields } = legacy;
  void cooldownS; void mpCost;
  const parsed = SpecialDefSchema.parse({ ...fields, rechargeS: 3 });
  expect(parsed.rechargeS).toBe(3);
  expect(SpecialDefSchema.parse({ ...legacy, rechargeS: 4 })).toEqual({ ...parsed, rechargeS: 4 });
});
