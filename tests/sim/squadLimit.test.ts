import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle } from '../../src/sim';
import type { BattleSetup, SquadSetup } from '../../src/sim';

const data = getGameData();
const squad = (side: number, i: number): SquadSetup => ({
  id: `s${side}-${i}`, name: `S${i}`, disposition: 'mixed',
  troops: [0, 1, 2].map(k => ({ troopId: `t${side}-${i}-${k}`, name: `T${k}`, unitId: 'dog' })),
});
const setup = (left: number, right: number): BattleSetup => ({
  seed: 1,
  sides: [
    { generalId: 'paladin', formationId: data.formations[0]!.id, squads: Array.from({ length: left }, (_, i) => squad(0, i)) },
    { generalId: 'warg', formationId: data.formations[0]!.id, squads: Array.from({ length: right }, (_, i) => squad(1, i)) },
  ],
});

describe('battle setup squad limit', () => {
  it('accepts up to MAX_SQUADS squads per side', () => {
    expect(() => createBattle(data, setup(data.constants.MAX_SQUADS, 1))).not.toThrow();
  });

  // Extra squads used to wrap onto occupied formation slots and stack, which biased mirror
  // fights toward side 0. An illegal side must fail loudly, not deploy.
  it.each([[0], [1]] as const)('rejects a side %i with more squads than formation slots', side => {
    const over = data.constants.MAX_SQUADS + 1;
    expect(() => createBattle(data, side === 0 ? setup(over, 1) : setup(1, over))).toThrow(/squads/);
  });
});
