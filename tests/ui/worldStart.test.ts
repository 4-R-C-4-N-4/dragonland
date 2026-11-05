import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { buildWorldData, rawWorldData } from '../../src/world';
import { defaultStartingSplit, validateWarStart } from '../../src/ui/world/startLogic';

const game = getGameData();
const world = buildWorldData(rawWorldData);

describe('new war setup logic', () => {
  it('derives the balanced default from world constants', () => {
    expect(defaultStartingSplit(world)).toEqual([34, 33, 33]);
    expect(defaultStartingSplit(world).reduce((a, b) => a + b, 0)).toBe(world.constants.STARTING_TROOPS);
    expect(game.generals).toHaveLength(15);
  });
  it('accepts custom allocation and rejects invalid values without rounding', () => {
    expect(validateWarStart(game, world, 'paladin', 'Ivy', [50, 30, 20]).valid).toBe(true);
    for (const split of [[-1, 51, 50], [NaN, 50, 50], [1.5, 49.5, 49], [51, 25, 24], [30, 30, 30]])
      expect(validateWarStart(game, world, 'paladin', 'Ivy', split).valid).toBe(false);
  });
  it('requires an actual hero and a nonblank name and keeps catalog data intact', () => {
    const before = structuredClone(game.generals);
    expect(validateWarStart(game, world, 'missing' as never, 'Ivy', [34, 33, 33]).valid).toBe(false);
    expect(validateWarStart(game, world, 'paladin', '  ', [34, 33, 33]).valid).toBe(false);
    expect(game.generals).toEqual(before);
  });
  it('does not mutate allocations and rejects incorrect lengths and capacity overflow', () => {
    const split = [50, 30, 20]; const before = split.slice();
    expect(validateWarStart(game, world, 'paladin', '<img src=x>', split).valid).toBe(true);
    expect(split).toEqual(before);
    expect(validateWarStart(game, world, 'paladin', 'Ivy', [50, 50]).valid).toBe(false);
    expect(validateWarStart(game, world, 'paladin', 'Ivy', [51, 25, 24]).valid).toBe(false);
  });
  it('provides a real mounted browser QA fixture', async () => {
    const { createWarStartBrowserFixture } = await import('../../src/ui/world/start');
    expect(createWarStartBrowserFixture).toBeTypeOf('function');
  });
});
