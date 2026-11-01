import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { commitEnemy } from '../../src/ai/commit';
import { generateRoster } from '../../src/persist/roster';

// Regression: commitEnemy and generateRoster both used createRng(seed), so with the same seed the
// enemy company was named after the player's own troops.
describe('enemy commit vs roster seed', () => {
  it('does not reproduce roster names when seeded identically', () => {
    const data = getGameData();
    for (const seed of [1, 2, 3]) {
      const roster = new Set(generateRoster(data, seed).map((t) => t.name));
      const enemy = commitEnemy(data, null, seed).side.squads.flatMap((s) => s.troops.map((t) => t.name));
      const shared = enemy.filter((n) => roster.has(n)).length;
      // Some overlap is natural (finite syllable space); a replayed stream overlaps ~100%.
      expect(shared / enemy.length).toBeLessThan(0.5);
    }
  });
});
