import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle, step } from '../../src/sim';
import type { SideSetup, World } from '../../src/sim';

const data = getGameData();
const side = (generalId: 'paladin' | 'warg' | 'deadeye'): SideSetup => ({ generalId, formationId: data.formations[0]!.id, squads: [{ id: `s-${generalId}`, name: 'S', disposition: 'mixed', troops: [{ troopId: `t-${generalId}`, name: 'T', unitId: 'soldier' }] }] });
const gap = (w: World) => Math.hypot(w.ents.x[w.generals[0].entity]! - w.ents.x[w.generals[1].entity]!, w.ents.y[w.generals[0].entity]! - w.ents.y[w.generals[1].entity]!);

/** Enter the duel with both generals where they deployed, far apart, as real battles often do. */
function farDuel(a: 'paladin' | 'warg' | 'deadeye', b: 'paladin' | 'warg' | 'deadeye'): World {
  const world = createBattle(data, { seed: 7, sides: [side(a), side(b)] });
  world.phase = 'duel';
  for (const e of [2, 3]) world.ents.alive[e] = 0;
  return world;
}

describe('duel approach', () => {
  it('walks the generals together before any blow lands', () => {
    const world = farDuel('paladin', 'warg');
    const start = gap(world);
    expect(start).toBeGreaterThan(800);
    let firstBlowGap = -1;
    for (let t = 0; t < 20_000 && !world.result && firstBlowGap < 0; t++) {
      step(world);
      if (world.events.some(e => e.type === 'duelBlow')) firstBlowGap = gap(world);
    }
    const range = (id: 'paladin' | 'warg') => data.unitById.get(data.generalById.get(id)!.unitId)!.attackRange;
    expect(firstBlowGap).toBeGreaterThanOrEqual(0);
    expect(firstBlowGap).toBeLessThanOrEqual(Math.max(range('paladin'), range('warg')) + 1e-6);
  });

  it('meets near the middle of the field and stays deterministic', () => {
    const run = () => { const w = farDuel('paladin', 'paladin'); for (let t = 0; t < 20_000 && !w.result; t++) step(w); return w; };
    const a = run(), b = run();
    expect(a.result).toEqual(b.result);
    const mid = (a.ents.x[a.generals[0].entity]! + a.ents.x[a.generals[1].entity]!) / 2;
    expect(Math.abs(mid - data.constants.FIELD_W / 2)).toBeLessThan(data.constants.FIELD_W * 0.1);
  });

  it('does not change who wins a duel between identical generals at different distances', () => {
    // The approach only delays the first blow; the blow sequence itself is unchanged.
    const near = farDuel('paladin', 'warg');
    near.ents.x[near.generals[1].entity] = near.ents.x[near.generals[0].entity]! + 20;
    near.ents.y[near.generals[1].entity] = near.ents.y[near.generals[0].entity]!;
    const far = farDuel('paladin', 'warg');
    for (const w of [near, far]) for (let t = 0; t < 40_000 && !w.result; t++) step(w);
    expect(far.result!.winner).toBe(near.result!.winner);
  });
});
