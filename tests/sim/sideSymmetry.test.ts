import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle, step } from '../../src/sim';
import { packAroundSlot } from '../../src/sim/formations';
import { checkFightEnd } from '../../src/sim/skirmish';
import { buildSideSetupFromLoadout } from '../../src/ai/commit';
import { createRng } from '../../src/sim/rng';
import type { BattleSetup, SideSetup } from '../../src/sim';

const data = getGameData();

/** Exact copy of one side for the other, with distinct ids. */
function mirror(id: string, seed: number): BattleSetup {
  const a = buildSideSetupFromLoadout(data, data.aiLoadoutById.get(id)!, createRng(seed));
  const b: SideSetup = structuredClone(a);
  b.squads = b.squads.map(s => ({ ...s, id: `b-${s.id}`, troops: s.troops.map(t => ({ ...t, troopId: `b-${t.troopId}` })) }));
  return { seed, sides: [a, b] };
}

describe('side symmetry', () => {
  it('packs each squad as a mirror image, so the same troop leads on both sides', () => {
    const left = packAroundSlot({ x: 100, y: 50 }, 7, 10, 1);
    const right = packAroundSlot({ x: 900, y: 50 }, 7, 10, -1);
    left.forEach((p, i) => {
      expect(p.x - 100).toBeCloseTo(-(right[i]!.x - 900));
      expect(p.y).toBeCloseTo(right[i]!.y);
    });
  });

  it('deploys mirrored armies with every troop facing the enemy from the same relative spot', () => {
    const world = createBattle(data, mirror('even', 3));
    const W = data.constants.FIELD_W;
    const per = (world.ents.count - 2) / 2;
    for (let i = 0; i < per; i++) {
      const a = 2 + i, b = 2 + per + i;
      // Jitter is seeded per troop, so compare against the jitter bound rather than exactly.
      const bound = data.constants.TROOP_SPACING * data.constants.JITTER_FRAC * 2 + 1e-9;
      expect(Math.abs(world.ents.x[a]! - (W - world.ents.x[b]!))).toBeLessThanOrEqual(bound);
    }
  });

  it('trades lethal blows simultaneously: two troops that kill each other in one tick both die', () => {
    const one = (side: number): SideSetup => ({
      generalId: 'paladin', formationId: data.formations[0]!.id,
      squads: [{ id: `s${side}`, name: 'S', disposition: 'mixed', troops: [{ troopId: `t${side}`, name: 'T', unitId: 'soldier' }] }],
    });
    for (const tick of [0, 1]) {
      const world = createBattle(data, { seed: 1, sides: [one(0), one(1)] });
      world.phase = 'fight';
      world.tick = tick; // both iteration directions
      const [a, b] = [2, 3];
      const cx = data.constants.FIELD_W / 2, cy = data.constants.FIELD_H / 2;
      world.ents.x[a] = cx - 5; world.ents.y[a] = cy;
      world.ents.x[b] = cx + 5; world.ents.y[b] = cy;
      world.ents.target[a] = b; world.ents.target[b] = a;
      world.ents.cooldown[a] = 0; world.ents.cooldown[b] = 0;
      world.ents.hp[a] = 1; world.ents.hp[b] = 1; // one blow kills either
      step(world);
      expect([world.ents.alive[a], world.ents.alive[b]], `tick parity ${tick}`).toEqual([0, 0]);
    }
  });

  it('settles commanders falling in the same tick by seed, not by side', () => {
    const one = (side: number): SideSetup => ({ generalId: 'paladin', formationId: data.formations[0]!.id, squads: [{ id: `s${side}`, name: 'S', disposition: 'mixed', troops: [{ troopId: `t${side}`, name: 'T', unitId: 'soldier' }] }] });
    const winners = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const run = () => {
        const world = createBattle(data, { seed, sides: [one(0), one(1)] });
        world.phase = 'fight';
        world.ents.alive[world.generals[0].entity] = 0;
        world.ents.alive[world.generals[1].entity] = 0;
        checkFightEnd(world);
        return world.result!;
      };
      const r = run();
      expect(r.reason).toBe('generalDefeated');
      expect(run().winner).toBe(r.winner); // deterministic per seed
      winners.add(r.winner);
    }
    expect([...winners].sort()).toEqual([0, 1]);
  });

  it('breaks exact duel ties with a seeded draw, so all-odd or all-even seeds still split', () => {
    const one = (side: number): SideSetup => ({ generalId: 'paladin', formationId: data.formations[0]!.id, squads: [{ id: `s${side}`, name: 'S', disposition: 'mixed', troops: [{ troopId: `t${side}`, name: 'T', unitId: 'soldier' }] }] });
    for (const parity of [0, 1]) {
      const winners = new Set<number>();
      for (let k = 0; k < 20; k++) {
        const world = createBattle(data, { seed: 2 * k + parity + 2, sides: [one(0), one(1)] });
        world.phase = 'duel';
        // Identical generals at 1 HP: the first blow kills both.
        world.ents.hp[world.generals[0].entity] = 1;
        world.ents.hp[world.generals[1].entity] = 1;
        for (let t = 0; t < 1000 && !world.result; t++) step(world);
        expect(world.result!.reason).toBe('duel');
        winners.add(world.result!.winner);
      }
      expect([...winners].sort(), `seeds of parity ${parity}`).toEqual([0, 1]);
    }
  });

  // Statistical guard: the same army against itself must not favour either side by much.
  it('wins mirror fights for side 0 near half the time', () => {
    let side0 = 0; const runs = 100;
    for (let seed = 1; seed <= runs; seed++) {
      const world = createBattle(data, mirror('even', seed));
      for (let t = 0; t < 100_000 && !world.result; t++) step(world);
      if (world.result!.winner === 0) side0++;
    }
    // Before the fix this exact ensemble gave side 0 67%; fixed seeds make the result exact.
    expect(side0 / runs).toBeGreaterThan(0.4);
    expect(side0 / runs).toBeLessThan(0.6);
  }, 180_000);
});
