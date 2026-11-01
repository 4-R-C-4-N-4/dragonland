import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { commitEnemy } from '../../src/ai/commit';

const data = getGameData();

describe('enemy commit (§8)', () => {
  it('never picks a test-only loadout', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { loadout } = commitEnemy(data, null, seed);
      expect(loadout.test).not.toBe(true);
    }
  });

  it('counter-picks a human-heavy loadout against an all-beast previous composition', () => {
    const { loadout } = commitEnemy(data, { beast: 100 }, 1);
    // The chosen loadout should field more human troops than beast troops: it leans into the
    // human > beast advantage rather than reinforcing beast-vs-beast neutrality.
    let human = 0;
    let beast = 0;
    for (const sq of loadout.squads) {
      for (const u of sq.units) {
        const unit = data.unitById.get(u.unitId)!;
        if (unit.classId === 'human') human += u.count;
        if (unit.classId === 'beast') beast += u.count;
      }
    }
    expect(human).toBeGreaterThan(beast);
  });

  it('is deterministic for a given seed', () => {
    const a = commitEnemy(data, null, 5);
    const b = commitEnemy(data, null, 5);
    expect(a.loadout.id).toBe(b.loadout.id);
  });
});
