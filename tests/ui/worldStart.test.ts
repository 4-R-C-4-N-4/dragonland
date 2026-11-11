import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { getRunConfig } from '../../src/run/config';
import { huntOrder, huntRelations, startingArmySummary, validateWarStart, vertex } from '../../src/ui/world/startLogic';

const game = getGameData();
const run = getRunConfig();
const strong = (c: string) => game.classById.get(c as never)!.strongAgainst;

describe('hunt star layout', () => {
  it('orders the five classes so every quarry is two points away (the star) and every ally adjacent (the pentagon)', () => {
    const order = huntOrder(game);
    expect(new Set(order)).toEqual(new Set(game.classes.map(c => c.id)));
    order.forEach((c, i) => {
      expect(order[(i + 2) % 5]).toBe(strong(c));
      const partner = run.startingPartners[c]!;
      const j = order.indexOf(partner);
      expect([1, 4]).toContain((j - i + 5) % 5);
    });
  });

  it('names quarry, nemesis and ally for a class', () => {
    expect(huntRelations(game, run, 'human')).toEqual({ quarry: 'beast', nemesis: 'construct', ally: 'mage' });
    expect(huntRelations(game, run, 'beast')).toEqual({ quarry: 'mage', nemesis: 'human', ally: 'ethereal' });
  });

  it('places the first point at the top and the rest clockwise', () => {
    const [x0, y0] = vertex(0, 5, 300, 300, 100);
    expect(x0).toBeCloseTo(300); expect(y0).toBeCloseTo(200);
    const [x1] = vertex(1, 5, 300, 300, 100);
    expect(x1).toBeGreaterThan(300);
  });
});

describe('war start', () => {
  it('summarises the starting army from the same data the war uses', () => {
    expect(startingArmySummary('paladin')).toEqual({ classes: ['human', 'mage'], troops: 150, perKind: 25 });
  });

  it('needs a real hero and a name, and nothing else', () => {
    expect(validateWarStart(game, 'paladin', 'Ivy')).toEqual({ valid: true, errors: [] });
    expect(validateWarStart(game, 'paladin', '   ').valid).toBe(false);
    expect(validateWarStart(game, 'missing' as never, 'Ivy').valid).toBe(false);
  });

  it('provides a real mounted browser QA fixture', async () => {
    const { createWarStartBrowserFixture } = await import('../../src/ui/world/start');
    expect(createWarStartBrowserFixture).toBeTypeOf('function');
  });
});
