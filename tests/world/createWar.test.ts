import { describe, expect, it } from 'vitest';
import { buildWorldData, rawWorldData } from '../../src/world/data';
import { createWar } from '../../src/world/engine';
const data = buildWorldData(rawWorldData);
const setup = { seed: 17, heroId: 'paladin' as const, heroName: 'Ivy' };
describe('createWar', () => {
  it('places the hero and two companions at the player castle with 100 evenly split troops', () => {
    const war = createWar(data, setup);
    const generals = war.generals.filter(g => g.factionId === 'player');
    expect(generals).toHaveLength(3);
    expect(generals.map(g => g.troops.length)).toEqual([34, 33, 33]);
    expect(generals[0]).toMatchObject({ name: 'Ivy', generalId: 'paladin', isHero: true, nodeId: 'dawnkeep' });
    expect(war).toMatchObject({ turn: 1, week: 1, phase: 'orders' });
    expect(war.factions.every(f => f.gold === 100)).toBe(true);
    expect(war.divisions.find(d => d.factionId === 'player')).toMatchObject({ atNode: 'dawnkeep', previousNode: null });
    expect(war.generals.filter(g => g.factionId === 'invader')).toHaveLength(6);
    for (const d of war.divisions) {
      expect(data.nodeById.has(d.atNode)).toBe(true);
      expect(d.generals.length).toBeLessThanOrEqual(data.constants.MAX_DIVISION_GENERALS);
    }
  });
  it('honours custom splits', () => {
    expect(createWar(data, { ...setup, split: [50, 30, 20] }).generals.filter(g => g.factionId === 'player').map(g => g.troops.length)).toEqual([50, 30, 20]);
  });
  it.each([[51, 29, 20], [30, 30, 30], [50, 50], [-1, 50, 51], [33.5, 33.5, 33]])('rejects invalid split %j', (...split) => {
    expect(() => createWar(data, { ...setup, split })).toThrow(/split/i);
  });
  it('is deterministic and seed dependent without mutating data', () => {
    const before = structuredClone(data);
    expect(createWar(data, setup)).toEqual(createWar(data, setup));
    expect(createWar(data, setup)).not.toEqual(createWar(data, { ...setup, seed: 18 }));
    expect(data).toEqual(before);
  });
});
