import { describe, expect, it } from 'vitest';
import { getGameData, SpecialDefSchema } from '../../src/data';
import { createBattle, fireSpecial, canFireSpecial, step, setPaused, replay } from '../../src/sim';
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

// Keep recharge tests short enough that combat cannot end the battle.
function rechargeWorld() {
  const world = createBattle(data, setup());
  for (const g of world.generals) {
    g.maxMp = g.side === 0 ? 75 : 240;
    g.special = SpecialDefSchema.parse({ ...g.special, rechargeS: 2 });
  }
  return world;
}
function ticks(world: ReturnType<typeof createBattle>, n: number) {
  for (let i = 0; i < n; i++) step(world);
}

describe('MP-only specials', () => {
  it('starts both sides at zero and never recharges during deployment', () => {
    const w = rechargeWorld();
    expect(w.generals.map((g) => g.mp)).toEqual([0, 0]);
    expect(canFireSpecial(w, 0)).toBe(false);
    expect(canFireSpecial(w, 1)).toBe(false);
    while (w.phase === 'deploy') {
      step(w);
      expect(w.generals.map((g) => g.mp)).toEqual([0, 0]);
    }
  });

  it.each(['fight', 'duel'] as const)('recharges linearly to half/full in %s for both non-100 capacities', (phase) => {
    const w = rechargeWorld();
    w.phase = phase;
    // Avoid the duel's automatic cast at a cadence boundary.
    w.generals.forEach((g) => { g.special = SpecialDefSchema.parse({ ...g.special, rechargeS: 0.4 }); });
    ticks(w, data.constants.SIM_HZ / 5);
    for (const g of w.generals) {
      expect(g.mp).toBeCloseTo(g.maxMp / 2, 9);
      expect(canFireSpecial(w, g.side)).toBe(false);
    }
    ticks(w, data.constants.SIM_HZ / 5);
    for (const g of w.generals) {
      expect(g.mp).toBe(g.maxMp);
      expect(canFireSpecial(w, g.side)).toBe(true);
    }
    step(w);
    for (const g of w.generals) expect(g.mp).toBe(g.maxMp);
  });

  it('pause freezes MP and queued casts until resume; duplicate casts execute once', () => {
    const w = rechargeWorld();
    w.phase = 'fight';
    for (const g of w.generals) g.mp = g.maxMp;
    setPaused(w, true);
    expect(fireSpecial(w, 0)).toBe(true);
    fireSpecial(w, 0);
    fireSpecial(w, 1);
    ticks(w, 10);
    expect(w.tick).toBe(0);
    for (const g of w.generals) expect(g.mp).toBe(g.maxMp);
    setPaused(w, false);
    step(w);
    expect(w.events.filter((e) => e.type === 'special').map((e) => e.side)).toEqual([0, 1]);
    for (const g of w.generals) {
      expect(g.mp).toBeCloseTo(g.maxMp / 2 / data.constants.SIM_HZ, 10);
      expect(canFireSpecial(w, g.side)).toBe(false);
    }
    const mp = w.generals.map((g) => g.mp);
    setPaused(w, true);
    ticks(w, 10);
    expect(w.generals.map((g) => g.mp)).toEqual(mp);
  });

  it('combat hits give no extra MP', () => {
    const w = rechargeWorld();
    w.phase = 'fight';
    // Put every unit in contact so this tick includes actual attacks.
    for (let i = 0; i < w.ents.count; i++) { w.ents.x[i] = 800; w.ents.y[i] = 300; }
    step(w);
    expect(w.events.some((e) => e.type === 'hit')).toBe(true);
    for (const g of w.generals) expect(g.mp).toBeCloseTo(g.maxMp / 2 / data.constants.SIM_HZ, 10);
  });

  it('requires positive capacity and full MP within floating point epsilon', () => {
    const w = rechargeWorld();
    w.phase = 'fight';
    const g = w.generals[0];
    g.mp = g.maxMp - 1e-10;
    expect(canFireSpecial(w, 0)).toBe(true);
    g.mp = g.maxMp - 0.001;
    expect(canFireSpecial(w, 0)).toBe(false);
    g.maxMp = g.mp = 0;
    expect(canFireSpecial(w, 0)).toBe(false);
  });
});

it('replays queued duplicate specials with identical MP and effects', () => {
  const input = setup();
  const w = createBattle(data, input);
  while (w.phase === 'deploy') step(w);
  while (!canFireSpecial(w, 0) && w.result === null && w.tick < 2000) step(w);
  expect(canFireSpecial(w, 0)).toBe(true);
  fireSpecial(w, 0);
  fireSpecial(w, 0);
  step(w);
  expect(w.events.filter((e) => e.type === 'special')).toHaveLength(1);
  const copy = replay(data, input, w.commandLog, w.tick);
  expect(copy.generals.map((g) => g.mp)).toEqual(w.generals.map((g) => g.mp));
  expect(copy.events).toEqual(w.events);
  expect(copy.ents.hp).toEqual(w.ents.hp);
});
