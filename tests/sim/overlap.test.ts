import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { buildSideSetupFromLoadout } from '../../src/ai/commit';
import { createBattle, createRng, step } from '../../src/sim';

// Regression: the spatial grid was never populated, so separation did nothing and squads
// collapsed onto a single point (DECISIONS D17).
describe('body overlap', () => {
  it('keeps same-domain bodies from overlapping during a melee', () => {
    const data = getGameData();
    const rng = createRng(7);
    const world = createBattle(data, {
      seed: 7,
      sides: [
        buildSideSetupFromLoadout(data, data.aiLoadoutById.get('human-legion')!, rng),
        buildSideSetupFromLoadout(data, data.aiLoadoutById.get('beast-horde')!, rng),
      ],
    });
    const radius = (e: number) => data.units[world.ents.unit[e]!]!.bodyRadius;
    const flying = (e: number) => data.units[world.ents.unit[e]!]!.flying;
    let worst = 0;
    for (let t = 0; t < 30 * data.constants.SIM_HZ && !world.result; t++) {
      step(world);
      if (t % 20 !== 0) continue;
      const n = world.ents.count;
      for (let a = 2; a < n; a++) {
        if (!world.ents.alive[a]) continue;
        for (let b = a + 1; b < n; b++) {
          if (!world.ents.alive[b] || flying(a) !== flying(b)) continue;
          const d = Math.hypot(world.ents.x[a]! - world.ents.x[b]!, world.ents.y[a]! - world.ents.y[b]!);
          worst = Math.max(worst, radius(a) + radius(b) - d);
        }
      }
    }
    // Allow a little residual overlap from the bounded number of resolution passes.
    expect(worst).toBeLessThan(4);
  });
});
