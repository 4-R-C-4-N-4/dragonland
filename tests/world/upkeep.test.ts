import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { buildWorldData, rawWorldData, createWar, issueOrder, resolveTurn } from '../../src/world';
import { applyRest, applyUpkeep, resetWeeklySupply } from '../../src/world/upkeep';
const data = buildWorldData(rawWorldData);
const make = () => createWar(data, { seed: 17, heroId: 'paladin', heroName: 'Ivy' });
function force() { const war = make(); const d = war.divisions.find(d => d.factionId === 'player')!; return { war, d, generals: war.generals.filter(g => d.generals.includes(g.id)) }; }
describe('node actions and upkeep', () => {
  it('heals by the configured fraction, clamps HP, and supplies stage-1 unlocked troops', () => {
    const { war, d, generals } = force();
    generals[0]!.hp = generals[0]!.maxHp - 10; generals[1]!.hp = 0;
    applyRest(war, d);
    expect(generals[0]!.hp).toBe(generals[0]!.maxHp);
    expect(generals[1]!.hp).toBe(generals[1]!.maxHp * .25);
    expect(generals.map(g => g.troops.length)).toEqual([40, 39, 39]);
    for (const g of generals) for (const troop of g.troops) {
      const unit = getGameData().unitById.get(troop.unitId)!;
      expect(unit.stage).toBe(1);
      expect(war.factions.find(f => f.id === d.factionId)!.classes).toContain(unit.classId);
    }
    expect(war.events).toContainEqual({ type: 'resupplied', general: generals[0]!.id, troops: 6 });
  });
  it('respects each capacity and the shared remaining weekly budget', () => {
    const { war, d, generals } = force(); generals[0]!.capacity = 35;
    applyRest(war, d); expect(generals[0]!.troops).toHaveLength(35);
    applyRest(war, d); applyRest(war, d);
    expect(generals.reduce((sum, g) => sum + g.troops.length, 0)).toBe(120);
    const before = generals.map(g => g.troops.length); applyRest(war, d);
    expect(generals.map(g => g.troops.length)).toEqual(before);
  });
  it('resets budgets on weekly rollover', () => {
    const { war, d, generals } = force();
    generals.forEach(g => { g.troops = []; });
    for (let i = 0; i < 7; i++) { issueOrder(war, { type: 'rest', division: d.id }); resolveTurn(war); }
    expect(generals.reduce((n, g) => n + g.troops.length, 0)).toBe(20);
    expect(war.phase).toBe('admin'); war.phase = 'orders';
    issueOrder(war, { type: 'rest', division: d.id }); resolveTurn(war);
    expect(generals.reduce((n, g) => n + g.troops.length, 0)).toBe(38);
  });
  it('explicit budget reset restores original supply', () => {
    const { war, d, generals } = force(); generals.forEach(g => { g.troops = []; });
    applyRest(war, d); applyRest(war, d); resetWeeklySupply(war); applyRest(war, d);
    expect(generals.reduce((n, g) => n + g.troops.length, 0)).toBe(38);
  });
  it.each(['reedhaven', 'stoneford', 'nightspire'])('rest at unfriendly or non-settlement %s does nothing', node => {
    const { war, d, generals } = force(); d.atNode = node; generals[0]!.hp = 1;
    const before = structuredClone(war); applyRest(war, d); expect(war).toEqual(before);
  });
  it('collects income per owned node and decrements injuries to zero', () => {
    const war = make(); const g = war.generals[0]!; g.injuredTurns = 2;
    const gold = war.factions.map(f => f.gold);
    applyUpkeep(war); applyUpkeep(war); applyUpkeep(war);
    expect(g.injuredTurns).toBe(0);
    war.factions.forEach((f, i) => expect(f.gold).toBe(gold[i]! + 3 * war.nodes.filter(n => n.owner === f.id).reduce((sum, n) => sum + n.incomePerTurn, 0)));
  });
  it('integrates rest and upkeep once per resolved turn; search consumes a turn', () => {
    const { war, d, generals } = force(); generals[0]!.hp = 1; generals[0]!.injuredTurns = 1;
    issueOrder(war, { type: 'rest', division: d.id }); resolveTurn(war);
    expect(generals[0]!.hp).toBe(1 + generals[0]!.maxHp * .25); expect(generals[0]!.injuredTurns).toBe(0);
    issueOrder(war, { type: 'search', division: d.id }); resolveTurn(war);
    expect(war.events).toContainEqual({ type: 'searchedNothing', division: d.id, nodeId: d.atNode }); expect(war.turn).toBe(3);
  });
});

it('a turn resting on a neutral town neither captures nor heals it', () => {
  const { war, d, generals } = force();
  d.atNode = 'stoneford'; generals[0]!.hp = 1;
  const counts = generals.map(g => g.troops.length);
  issueOrder(war, { type: 'rest', division: d.id }); resolveTurn(war);
  expect(war.nodes.find(n => n.id === 'stoneford')!.owner).toBeNull();
  expect(generals[0]!.hp).toBe(1); expect(generals.map(g => g.troops.length)).toEqual(counts);
});
