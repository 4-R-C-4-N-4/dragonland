import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { buildWorldData, createWar, issueOrder, joinDivision, leaveAsGarrison, rawWorldData, resolveTurn } from '../../src/world';
import { fightPool } from '../../src/world/army';

const data = buildWorldData(rawWorldData);
const make = (seed: number) => createWar(data, { seed, heroId: 'eagle', heroName: 'Ivy' });

describe('opening troop accounting', () => {
  it('starts every hero with all three class mates and 150 unique troops', () => {
    for (const profile of getGameData().generals) {
      const war = createWar(data, { seed: 17, heroId: profile.id, heroName: 'Ivy' });
      const division = war.divisions.find(d => d.factionId === 'player')!;
      expect(division.generals, profile.id).toHaveLength(3);
      expect(fightPool(war, division.generals[0]!), profile.id).toHaveLength(150);
      expect(new Set(fightPool(war, division.generals[0]!).map(t => t.id)).size).toBe(150);
    }
  });

  it('keeps Eagle’s 100 field troops unchanged through two searches finding nothing', () => {
    // Find a deterministic pair of failed searches; no AI orders are issued in this
    // fixture, so combat cannot obscure whether searching removes troops.
    let checked = false;
    for (let seed = 1; seed < 100 && !checked; seed++) {
      const war = make(seed);
      const division = war.divisions.find(d => d.factionId === 'player')!;
      const keeper = war.generals.find(g => division.generals.includes(g.id) && !g.isHero)!;
      leaveAsGarrison(war, division.id, keeper.id);
      const ids = fightPool(war, division.generals[0]!).map(t => t.id).sort();
      expect(ids).toHaveLength(100);
      expect(keeper.troops).toHaveLength(50);
      issueOrder(war, { type: 'march', division: division.id, toNode: 'reedhaven' });
      resolveTurn(war);
      let nothing = 0;
      for (let i = 0; i < 2 && war.phase === 'orders'; i++) {
        issueOrder(war, { type: 'search', division: division.id });
        resolveTurn(war);
        if (war.events.some(e => e.type === 'searchedNothing')) nothing++;
        expect(fightPool(war, division.generals[0]!).map(t => t.id).sort()).toEqual(ids);
      }
      if (nothing !== 2) continue;
      checked = true;
      expect(division.generals).toHaveLength(2);
      issueOrder(war, { type: 'march', division: division.id, toNode: 'dawnkeep' });
      resolveTurn(war);
      expect(fightPool(war, division.generals[0]!).map(t => t.id).sort()).toEqual(ids);
      // A guard is separate until explicitly rejoined (and may recruit while home).
      const guardTroops = keeper.troops.length;
      joinDivision(war, division.id, keeper.id);
      expect(division.generals).toHaveLength(3);
      expect(fightPool(war, division.generals[0]!)).toHaveLength(100 + guardTroops);
    }
    expect(checked).toBe(true);
  });
});
