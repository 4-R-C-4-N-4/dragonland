import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle, fireSpecial, canFireSpecial, step } from '../../src/sim';
import type { BattleSetup, SideSetup } from '../../src/sim/types';

const data = getGameData();

function sideFromLoadout(id: string): SideSetup {
  const l = data.aiLoadoutById.get(id)!;
  let n = 0;
  return {
    generalId: l.generalId,
    formationId: l.formation,
    squads: l.squads.map((sq, si) => ({
      id: `${id}-${si}`,
      name: sq.name,
      disposition: sq.disposition,
      troops: sq.units.flatMap((u) =>
        Array.from({ length: u.count }, () => {
          n++;
          return { troopId: `${id}-t${n}`, name: `T${n}`, unitId: u.unitId };
        }),
      ),
    })),
  };
}

function setup(): BattleSetup {
  return { seed: 1, sides: [sideFromLoadout('lean-human'), sideFromLoadout('lean-beast')] };
}

describe('special meter / MP / cooldown (D2)', () => {
  it('cannot fire until the meter is full', () => {
    const world = createBattle(data, setup());
    while (world.phase === 'deploy') step(world);
    expect(canFireSpecial(world, 0)).toBe(false);
  });

  it('firing spends the full meter and MP, and sets a cooldown that restores MP on expiry', () => {
    const world = createBattle(data, setup());
    while (world.phase === 'deploy') step(world);
    world.generals[0].meter = data.constants.SPECIAL_METER_MAX;
    expect(canFireSpecial(world, 0)).toBe(true);
    const canBefore = fireSpecial(world, 0);
    expect(canBefore).toBe(true);
    step(world); // pending command applies at the start of this step
    const g = world.generals[0];
    const dt = 1 / data.constants.SIM_HZ;
    // The passive per-second meter charge runs later in the same executed tick.
    expect(g.meter).toBeCloseTo(data.constants.SPECIAL_CHARGE_PER_S * dt, 10);
    expect(g.mp).toBe(g.maxMp - g.special.mpCost);
    expect(g.specialCooldown).toBeCloseTo(g.special.cooldownS - dt, 5);

    const ticksNeeded = Math.ceil(g.special.cooldownS / dt) + 2;
    for (let i = 0; i < ticksNeeded; i++) step(world);
    expect(world.generals[0].specialCooldown).toBe(0);
    expect(world.generals[0].mp).toBe(world.generals[0].maxMp);
  });
});
