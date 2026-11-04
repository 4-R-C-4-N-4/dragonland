import { describe, expect, it } from 'vitest';
import { getGameData, withConstants } from '../../src/data';
import { computeDamage, damageMultiplier } from '../../src/sim/combat';

const data = getGameData();

describe('damage formula (§2.4 worked examples)', () => {
  it('A-line Archer (human) hits M-line Wyrm (beast): 1.45x', () => {
    const mult = damageMultiplier(data, { classId: 'human', line: 'A' }, { classId: 'beast', line: 'M' });
    expect(mult).toBeCloseTo(1.45, 10);
  });

  it('M-line Spy (human) hits A-line Raven (beast): 1.35x', () => {
    const mult = damageMultiplier(data, { classId: 'human', line: 'M' }, { classId: 'beast', line: 'A' });
    expect(mult).toBeCloseTo(1.35, 10);
  });

  it('Z-line Dog (beast) hits Z-line Soldier (human): 0.45x', () => {
    const mult = damageMultiplier(data, { classId: 'beast', line: 'Z' }, { classId: 'human', line: 'Z' });
    expect(mult).toBeCloseTo(0.45, 10);
  });

  it('clamps the multiplier to MIN_DAMAGE_MULT', () => {
    // Push the mods harder than the shipped data allows to exercise the clamp directly.
    const harsh = withConstants(data, { CLASS_MOD: 0.6, LINE_DEAL_MOD: 0.6, LINE_TAKE_MOD: 0.6 });
    const mult = damageMultiplier(harsh, { classId: 'mage', line: 'Z' }, { classId: 'beast', line: 'Z' });
    expect(mult).toBeCloseTo(harsh.constants.MIN_DAMAGE_MULT, 10);
  });

  it('computeDamage applies BASE_DAMAGE and statMult on top of the multiplier', () => {
    const dmg = computeDamage(data, { classId: 'human', line: 'A', statMult: 1 }, { classId: 'beast', line: 'M' });
    expect(dmg).toBeCloseTo(data.constants.BASE_DAMAGE * 1.45, 10);
  });
});

describe('class cycle (§2.1)', () => {
  it('each class is strong against exactly one and weak against exactly one', () => {
    for (const c of data.classes) {
      const strongAgainst = data.classes.filter((o) => o.strongAgainst === c.id);
      expect(strongAgainst.length).toBe(1);
      const target = data.classById.get(c.strongAgainst)!;
      expect(target).toBeDefined();
      expect(c.strongAgainst).not.toBe(c.id);
    }
  });
});
