import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { buildWorldData, createWar, rawWorldData } from '../../src/world';
import { fightPool } from '../../src/world/army';
import { fairShare, initialPlan, planProblems, planWarnings, troopsByClass } from '../../src/ui/world/prepareLogic';
import { planToArmy } from '../../src/ui/run/logic';

const game = getGameData();
const data = buildWorldData(rawWorldData);
const war = () => createWar(data, { seed: 17, heroId: 'paladin', heroName: 'Ivy' });
const total = (plan: ReturnType<typeof initialPlan>) => Object.values(plan.assignment).reduce((n, a) => n + a.count, 0);

describe('fight preparation logic', () => {
  it('starts from the Skirmish auto-arrange, capped at the general\\u2019s command', () => {
    const w = war(); const hero = w.generals.find(g => g.isHero)!;
    const pool = fightPool(w, hero.id);
    expect(total(initialPlan(game, pool, 100))).toBe(100);
    const capped = initialPlan(game, pool, 25);
    expect(total(capped)).toBe(25);
    expect(planProblems(game, pool, capped, 25)).toEqual([]);
    expect(planToArmy(game, pool, capped).squads.flatMap(q => q.troopIds)).toHaveLength(25);
  });

  it('lets a general fight alone, but says so', () => {
    const w = war(); const hero = w.generals.find(g => g.isHero)!;
    const empty = initialPlan(game, [], 100);
    expect(planProblems(game, [], empty, 100)).toEqual([]);
    expect(planWarnings(game, [], empty)).toEqual([expect.stringMatching(/alone/)]);
    const pool = fightPool(w, hero.id);
    const none = initialPlan(game, pool, 0);
    expect(planProblems(game, pool, none, 100)).toEqual([]);
    expect(planWarnings(game, pool, none)).toEqual([expect.stringMatching(/alone/)]);
    expect(planWarnings(game, pool, initialPlan(game, pool, 20))).toEqual([]);
  });

  it('shares the pool between the generals who can still fight', () => {
    expect(fairShare(60, 3, 100)).toBe(20);
    expect(fairShare(61, 3, 100)).toBe(21);
    expect(fairShare(60, 1, 100)).toBe(60);
    expect(fairShare(300, 2, 100)).toBe(100);
    expect(fairShare(0, 3, 100)).toBe(0);
  });

  it('deploys enough to outnumber a known enemy when the pool allows', () => {
    expect(fairShare(60, 3, 100, 50)).toBe(60);
    expect(fairShare(150, 3, 100, 50)).toBe(60);
    expect(fairShare(150, 3, 100, 10)).toBe(50);
    expect(fairShare(150, 3, 40, 50)).toBe(40);
  });

  it('warns when auto-arrange commits the entire shared pool', () => {
    const w = war(); const hero = w.generals.find(g => g.isHero)!;
    const pool = fightPool(w, hero.id).slice(0, 40);
    const plan = initialPlan(game, pool, fairShare(40, 2, 100, 50));
    expect(total(plan)).toBe(40);
    expect(planWarnings(game, pool, plan)).toEqual([expect.stringMatching(/All 40.*no troops.*another general/i)]);
  });

  it('reports a company over the command limit', () => {
    const w = war(); const hero = w.generals.find(g => g.isHero)!;
    const pool = fightPool(w, hero.id);
    expect(planProblems(game, pool, initialPlan(game, pool, 100), 40)).toEqual(expect.arrayContaining([expect.stringMatching(/command.*40/)]));
  });

  it('counts an enemy force by class for the counter hints', () => {
    const counts = troopsByClass(game, [{ unitId: 'dog' }, { unitId: 'dog' }, { unitId: 'soldier' }]);
    expect(counts).toEqual(new Map([['beast', 2], ['human', 1]]));
  });
});
