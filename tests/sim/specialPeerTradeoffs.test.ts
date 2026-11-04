import { describe, expect, it } from 'vitest';
import { getGameData, type GeneralId } from '../../src/data';

const data = getGameData();
const special = (id: GeneralId) => data.generalById.get(id)!.special;
describe('special peer trade-offs', () => {
  it('gives every hero an explicit positive recharge and no second resource cost', () => {
    expect(data.generals).toHaveLength(15);
    for (const g of data.generals) {
      expect(g.special.rechargeS).toBeGreaterThan(0);
      expect(g.special).not.toHaveProperty('mpCost');
      expect(g.special).not.toHaveProperty('cooldownS');
    }
  });
  it('does not let one wave dominate another in damage, width AND recharge', () => {
    const waves = (['dragon', 'diabolist', 'archangel'] as const).map(id => {
      const s = special(id), d = s.effects.find(e => e.type === 'damage')!;
      if (d.type !== 'damage') throw new Error('not damage');
      return { id, damage: d.amount, width: d.width!, recharge: s.rechargeS };
    });
    for (const a of waves) for (const b of waves) if (a.id !== b.id) {
      const dominates = a.damage >= b.damage && a.width >= b.width && a.recharge <= b.recharge;
      expect(dominates, `${a.id} strictly dominates ${b.id}`).toBe(false);
    }
  });
  it('compensates Shepherd mobility with the strongest healing throughput', () => {
    const throughput = (id: GeneralId) => {
      const s = special(id), heal = s.effects.find(e => e.type === 'heal');
      if (!heal || heal.type !== 'heal') throw new Error('not healer');
      return heal.fraction / s.rechargeS;
    };
    expect(throughput('shepherd')).toBeGreaterThan(throughput('paladin'));
    expect(throughput('shepherd')).toBeGreaterThan(throughput('hierophant'));
  });
  it('trades Warg offense and frequency against Anima protection', () => {
    const w = special('warg'), a = special('anima');
    const wb = w.effects.find(e => e.type === 'buff')!, ab = a.effects.find(e => e.type === 'buff')!;
    if (wb.type !== 'buff' || ab.type !== 'buff') throw new Error('not buffs');
    expect(wb.damageMult).toBeGreaterThan(ab.damageMult);
    expect(w.rechargeS).toBeLessThan(a.rechargeS);
    expect(ab.defenseMult).toBeLessThan(wb.defenseMult);
  });
});
