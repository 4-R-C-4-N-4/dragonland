import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { buildWorldData, rawWorldData } from '../../src/world';
import { defaultStartingSplit, validateWarStart } from '../../src/ui/world/startLogic';

const game = getGameData();
const world = buildWorldData(rawWorldData);

describe('new war setup logic', () => {
  it('derives the balanced default from world constants', () => {
    expect(defaultStartingSplit(world)).toEqual([50, 50, 50]);
    expect(defaultStartingSplit(world).reduce((a, b) => a + b, 0)).toBe(world.constants.STARTING_TROOPS);
    expect(game.generals).toHaveLength(15);
  });
  it('accepts custom allocation and rejects invalid values without rounding', () => {
    expect(validateWarStart(game, world, 'paladin', 'Ivy', [70, 50, 30]).valid).toBe(true);
    for (const split of [[-1, 81, 70], [NaN, 80, 70], [1.5, 79.5, 69], [71, 50, 29], [50, 50, 49]])
      expect(validateWarStart(game, world, 'paladin', 'Ivy', split).valid).toBe(false);
  });
  it('requires an actual hero and a nonblank name and keeps catalog data intact', () => {
    const before = structuredClone(game.generals);
    expect(validateWarStart(game, world, 'missing' as never, 'Ivy', [50, 50, 50]).valid).toBe(false);
    expect(validateWarStart(game, world, 'paladin', '  ', [50, 50, 50]).valid).toBe(false);
    expect(game.generals).toEqual(before);
  });
  it('does not mutate allocations and rejects incorrect lengths and capacity overflow', () => {
    const split = [70, 50, 30]; const before = split.slice();
    expect(validateWarStart(game, world, 'paladin', '<img src=x>', split).valid).toBe(true);
    expect(split).toEqual(before);
    expect(validateWarStart(game, world, 'paladin', 'Ivy', [75, 75]).valid).toBe(false);
    expect(validateWarStart(game, world, 'paladin', 'Ivy', [71, 50, 29]).valid).toBe(false);
  });
  it('provides a real mounted browser QA fixture', async () => {
    const { createWarStartBrowserFixture } = await import('../../src/ui/world/start');
    expect(createWarStartBrowserFixture).toBeTypeOf('function');
  });
});
