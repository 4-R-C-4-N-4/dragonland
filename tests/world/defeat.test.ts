import { describe, expect, it } from 'vitest';
import { buildWorldData, createWar, rawWorldData, resolveTurn } from '../../src/world';

const base = buildWorldData(rawWorldData);
const withRule = (LOSE_WITHOUT_CASTLES: boolean) => ({ ...base, constants: { ...base.constants, LOSE_WITHOUT_CASTLES } });
const make = (data: typeof base) => {
  const war = createWar(data, { seed: 17, heroId: 'paladin', heroName: 'Ivy' });
  // The rival has walked into an empty Dawnkeep: the player holds no castle.
  war.nodes.find(n => n.id === 'dawnkeep')!.owner = 'invader';
  return war;
};

describe('defeat rule', () => {
  it('keeps the war going without castles while the hero lives (shipped default)', () => {
    expect(base.constants.LOSE_WITHOUT_CASTLES).toBe(false);
    const war = make(base);
    resolveTurn(war);
    expect(war.phase).toBe('orders');
  });

  it('still loses on castles when the rule is switched on', () => {
    const war = make(withRule(true));
    resolveTurn(war);
    expect(war.phase).toBe('lost');
  });

  it('always loses when the hero falls', () => {
    const war = createWar(base, { seed: 17, heroId: 'paladin', heroName: 'Ivy' });
    war.generals.find(g => g.isHero)!.hp = 0;
    resolveTurn(war);
    expect(war.phase).toBe('lost');
  });
});
