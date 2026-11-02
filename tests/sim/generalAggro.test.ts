import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle, hashWorld, setPaused, step, type Side } from '../../src/sim';
import { runGenerals } from '../../src/sim/behavior';

const data = getGameData();
function arena(side: Side = 0) {
  const w = createBattle(data, {
    seed: 17,
    sides: [0, 1].map((s) => ({
      generalId: 'paladin' as const, formationId: 'line',
      squads: s === side ? [] : [{ id: 'imps', name: 'Imps', disposition: 'mixed' as const,
        troops: [{ troopId: 'imp', name: 'Imp', unitId: 'imp' }] }],
    })) as Parameters<typeof createBattle>[1]['sides'],
  });
  w.phase = 'fight';
  const g = w.generals[side];
  const e = g.entity;
  const imp = w.ents.troopId.indexOf('imp');
  const direction = side === 0 ? 1 : -1;
  g.startX = side === 0 ? 100 : 1500;
  g.startY = 300;
  w.ents.x[e] = g.startX;
  w.ents.y[e] = g.startY;
  w.ents.x[imp] = g.startX + direction * 115;
  w.ents.y[imp] = 300;
  // Keep the other general out of this isolated endgame exchange.
  const other = w.generals[side === 0 ? 1 : 0];
  other.startX = side === 0 ? 1500 : 100;
  other.startY = 50;
  w.ents.x[other.entity] = other.startX;
  w.ents.y[other.entity] = other.startY;
  return { w, g, e, imp, direction };
}
function advance(w: ReturnType<typeof createBattle>, seconds: number) {
  for (let t = 0; t < seconds * data.constants.SIM_HZ; t++) step(w);
}

describe('general retaliation and return home', () => {
  it.each([0, 1] as const)('side %i reaches and kills a ranged imp beyond the old leash', (side) => {
    const { w, g, e, imp } = arena(side);
    advance(w, 8);
    expect(w.ents.alive[imp]).toBe(0);
    expect(w.ents.alive[e]).toBe(1);
    // With both armies wiped, normal duel entry is expected, not a timeout.
    expect(w.phase).toBe('duel');
    expect(w.fightTimeS).toBeLessThan(8);
    expect(w.generals[side].startX).toBe(g.startX);
  });

  it('returns exactly to its original stable position when the attacker dies', () => {
    const { w, g, e } = arena();
    advance(w, 8);
    // Exercise the movement AI independently: a double wipe otherwise enters
    // the duel immediately, where normal battlefield movement is suspended.
    for (let t = 0; t < 8 * data.constants.SIM_HZ; t++) { runGenerals(w); w.tick++; }
    expect(w.ents.x[e]).toBeCloseTo(g.startX, 8);
    expect(w.ents.y[e]).toBeCloseTo(g.startY, 8);
    expect(w.ents.target[e]).toBe(-1);
    advance(w, 2);
    expect(w.ents.x[e]).toBeCloseTo(g.startX, 8);
  });

  it('follows a known attacker outside its acquisition radius rather than dropping aggro', () => {
    const { w, g, e, imp } = arena();
    advance(w, 1); // allow the staggered troop retarget, then an actual imp hit
    expect(w.ents.hp[e]).toBeLessThan(w.ents.maxHp[e]!);
    w.ents.x[imp] = 1000;
    advance(w, 3);
    expect(w.ents.x[e]).toBeGreaterThan(g.startX + data.constants.GENERAL_LEASH);
    expect(w.ents.target[e]).toBe(imp);
  });

  it('drops aggro after an attacker stops focusing the hero, then returns home', () => {
    const { w, g, e, imp } = arena();
    advance(w, 1);
    expect(g.aggro.map((a) => a.entity)).toContain(imp);
    w.ents.x[imp] = 1000;
    w.ents.target[imp] = -1;
    // Isolate the general AI so the imp does not immediately reacquire the hero.
    const seconds = data.behaviors.generalAggroMemoryS * 2 + 3;
    for (let t = 0; t < seconds * data.constants.SIM_HZ; t++) { runGenerals(w); w.tick++; }
    expect(w.ents.alive[imp]).toBe(1);
    expect(g.aggro).toEqual([]);
    expect(w.ents.target[e]).toBe(-1);
    expect(w.ents.x[e]).toBeCloseTo(g.startX, 8);
    expect(w.ents.y[e]).toBeCloseTo(g.startY, 8);
    expect(w.ents.vx[e]).toBe(0);
    expect(w.ents.vy[e]).toBe(0);
  });

  it('does not chase an unprovoked distant enemy', () => {
    const { w, g, e, imp } = arena();
    w.ents.x[imp] = 1000;
    advance(w, 1);
    expect(w.ents.x[e]).toBe(g.startX);
  });

  it('is deterministic and pause freezes movement', () => {
    const a = arena(), b = arena();
    advance(a.w, 6);
    advance(b.w, 6);
    expect(hashWorld(a.w)).toBe(hashWorld(b.w));
    setPaused(a.w, true);
    const before = hashWorld(a.w);
    advance(a.w, 2);
    expect(hashWorld(a.w)).toBe(before);
  });
});
