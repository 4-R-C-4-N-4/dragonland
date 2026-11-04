import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle, step } from '../../src/sim';
import { chooseTarget } from '../../src/sim/behavior';
import type { BattleSetup, World } from '../../src/sim';
import type { Disposition } from '../../src/data/schemas';

const data = getGameData();

/** Player squad of 2 soldiers with the given disposition vs 2 enemy dogs; positions set by hand. */
function world(disposition: Disposition): World {
  const setup: BattleSetup = {
    seed: 1,
    sides: [
      { generalId: 'paladin', formationId: 'line', squads: [{ id: 'p', name: 'P', disposition, troops: [
        { troopId: 'a', name: 'A', unitId: 'soldier' }, { troopId: 'b', name: 'B', unitId: 'soldier' },
      ] }] },
      { generalId: 'dragon', formationId: 'line', squads: [{ id: 'e', name: 'E', disposition: 'mixed', troops: [
        { troopId: 'x', name: 'X', unitId: 'dog' }, { troopId: 'y', name: 'Y', unitId: 'dog' },
      ] }] },
    ],
  };
  const w = createBattle(data, setup);
  w.phase = 'fight';
  return w;
}
const idx = (w: World, id: string) => w.ents.troopId.indexOf(id);
function place(w: World, id: string | number, x: number, y: number) {
  const e = typeof id === 'number' ? id : idx(w, id);
  w.ents.x[e] = x;
  w.ents.y[e] = y;
}
/** Own general at x=100, enemy general at x=1500, everything on y=300. */
function layout(w: World) {
  place(w, w.generals[0].entity, 100, 300);
  place(w, w.generals[1].entity, 1500, 300);
}

describe('disposition targeting (MVP2)', () => {
  it('Fierce on Advance goes for the enemy general, unless a troop blocks its path', () => {
    const w = world('fierce');
    layout(w);
    place(w, 'a', 800, 300);
    place(w, 'x', 700, 300); // behind/near-ish but outside block radius
    place(w, 'y', 600, 300);
    expect(chooseTarget(w, idx(w, 'a'))).toBe(w.generals[1].entity);
    place(w, 'x', 800 + data.behaviors.fierce.blockRadius - 5, 300);
    expect(chooseTarget(w, idx(w, 'a'))).toBe(idx(w, 'x'));
  });

  it('Mixed fights enemy troops and ignores the general while troops remain', () => {
    const w = world('mixed');
    layout(w);
    place(w, 'a', 1450, 300); // right next to the enemy general
    place(w, 'x', 400, 300);
    place(w, 'y', 300, 300);
    expect(chooseTarget(w, idx(w, 'a'))).toBe(idx(w, 'x'));
    w.ents.alive[idx(w, 'x')] = 0;
    w.ents.alive[idx(w, 'y')] = 0;
    expect(chooseTarget(w, idx(w, 'a'))).toBe(w.generals[1].entity);
  });

  it('Guard prioritises threats to its general over nearer enemies', () => {
    const w = world('guard');
    layout(w);
    place(w, 'a', 600, 300);
    place(w, 'x', 620, 300); // right next to the guard
    place(w, 'y', 100 + data.behaviors.guard.threatRadius - 10, 300); // near our general
    expect(chooseTarget(w, idx(w, 'a'))).toBe(idx(w, 'y'));
  });

  it('Guard follows commands: Advance fights forward, Hold stays with the general', () => {
    const w = world('guard');
    layout(w);
    place(w, 'a', 300, 300);
    place(w, 'x', 900, 300);
    place(w, 'y', 1000, 300);
    w.squads[0]!.command = 'advance';
    expect(chooseTarget(w, idx(w, 'a'))).toBe(idx(w, 'x'));
    w.squads[0]!.command = 'hold';
    expect(chooseTarget(w, idx(w, 'a'))).toBe(-1);
  });

  it('Fierce flanks along a field edge while far from the enemy general', () => {
    const w = world('fierce');
    w.deployRemainingS = 0;
    layout(w);
    for (const id of ['x', 'y']) w.ents.alive[idx(w, id)] = 0;
    place(w, 'a', 300, 300);
    place(w, 'b', 300, 340);
    const y0 = w.ents.y[idx(w, 'a')]!;
    for (let t = 0; t < 40; t++) step(w);
    // slot 0 flanks along the top edge: moves up while advancing
    expect(w.ents.y[idx(w, 'a')]!).toBeLessThan(y0 - 10);
    expect(w.ents.x[idx(w, 'a')]!).toBeGreaterThan(300);
  });

  it('measures guard threats from the general current position', () => {
    const w = world('guard');
    layout(w);
    place(w, w.generals[0].entity, 400, 300); // general drifted from its start
    place(w, 'a', 1200, 300);
    place(w, 'x', 400 + data.behaviors.guard.threatRadius - 10, 300);
    place(w, 'y', 1250, 300);
    w.squads[0]!.command = 'hold';
    expect(chooseTarget(w, idx(w, 'a'))).toBe(idx(w, 'x'));
  });
});
