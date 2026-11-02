import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle, hashWorld } from '../../src/sim';
import type { BattleSetup } from '../../src/sim';

const data = getGameData();

function setup(extra: Partial<BattleSetup['sides'][0]> = {}, troopMult?: number): BattleSetup {
  return {
    seed: 3,
    sides: [
      {
        generalId: 'paladin',
        formationId: 'line',
        squads: [{
          id: 's1', name: 'S1', disposition: 'mixed',
          troops: [
            { troopId: 'p1', name: 'Vet', unitId: 'paladin' },
            { troopId: 'k1', name: 'Kit', unitId: 'knight', ...(troopMult ? { statMult: troopMult } : {}) },
          ],
        }],
        ...extra,
      },
      { generalId: 'dragon', formationId: 'line', squads: [{ id: 'e1', name: 'E1', disposition: 'fierce', troops: [
        { troopId: 'd1', name: 'A', unitId: 'dog' }, { troopId: 'd2', name: 'B', unitId: 'dog' },
      ] }] },
    ],
  };
}

const entityOf = (w: ReturnType<typeof createBattle>, troopId: string) => w.ents.troopId.indexOf(troopId);

describe('individual troop profiles', () => {
  it('keeps a stage-3 troop on troop stats even when its species is also a general', () => {
    const w = createBattle(data, setup());
    const vet = entityOf(w, 'p1');
    expect(w.ents.isGeneral[vet]).toBe(0);
    expect(w.ents.maxHp[vet]).toBeCloseTo(data.constants.TROOP_HP * data.constants.STAGE3_STAT_MULT);
    expect(w.ents.statMult[vet]).toBeCloseTo(data.constants.STAGE3_STAT_MULT);
    expect(w.ents.maxHp[w.generals[0].entity]).toBe(data.generalById.get('paladin')!.hp);
  });

  it('applies a per-troop progression multiplier to HP and damage', () => {
    const w = createBattle(data, setup({}, 1.5));
    const kit = entityOf(w, 'k1');
    expect(w.ents.maxHp[kit]).toBeCloseTo(data.constants.TROOP_HP * 1.5);
    expect(w.ents.statMult[kit]).toBeCloseTo(1.5);
    expect(hashWorld(createBattle(data, setup({}, 1.5)))).toBe(hashWorld(w));
  });

  it('uses a provided derived general definition (hero progression)', () => {
    const base = data.generalById.get('paladin')!;
    const hero = { ...base, level: 4, hp: base.hp * 1.2, attack: base.attack * 1.1 };
    const w = createBattle(data, setup({ general: hero }));
    expect(w.ents.maxHp[w.generals[0].entity]).toBeCloseTo(base.hp * 1.2);
    expect(w.ents.statMult[w.generals[0].entity]).toBeCloseTo(base.attack * 1.1);
    expect(w.generals[0].def.level).toBe(4);
  });

  it('rejects a general override that does not match the side general', () => {
    const dragon = data.generalById.get('dragon')!;
    expect(() => createBattle(data, setup({ general: dragon }))).toThrow(/general/);
  });

  it('rejects non-positive troop multipliers', () => {
    expect(() => createBattle(data, setup({}, -1))).toThrow(/statMult/);
  });
});
