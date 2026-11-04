import { describe, expect, it } from 'vitest';
import { buildWorldData, rawWorldData, createWar, issueOrder } from '../../src/world';
import { planFactionOrders, visibleNodes, STRATEGY_TUNING } from '../../src/ai/strategy';
import type { War } from '../../src/world/types';

const data = buildWorldData(rawWorldData);
const make = (seed = 23): War => createWar(data, { seed, heroId: 'paladin', heroName: 'Ivy' });
const playerDivisions = (war: War) => war.divisions.filter(d => d.factionId === 'player');
const setPersonality = (war: War, personality: 'aggressive' | 'defensive' | 'opportunist') => {
  war.factions.find(f => f.id === 'player')!.personality = personality;
};
const neighbours = (war: War, from: string) => war.routes.flatMap(r => r.from === from ? [r.to] : r.to === from ? [r.from] : []);

describe('strategic order planning', () => {
  it('exposes owned nodes and their adjacent nodes as visible', () => {
    const war = make();
    expect(visibleNodes(war, 'player')).toEqual(new Set(['dawnkeep', 'westmere', 'reedhaven', 'greenfield']));
  });

  it('extends visibility from occupied nodes without revealing unrelated nodes', () => {
    const war = make();
    const d = playerDivisions(war)[0]!;
    d.atNode = 'eastgate';
    const neighbors = neighbours(war, 'eastgate');
    expect(visibleNodes(war, 'player')).toEqual(new Set(['dawnkeep', 'westmere', 'reedhaven', 'greenfield', 'eastgate', ...neighbors]));
    expect(visibleNodes(war, 'player')).not.toContain('deepfen');
  });

  it('returns one stable, legal one-edge order for each nonempty owned division', () => {
    const war = make();
    const orders = planFactionOrders(war, 'player');
    expect(orders.map(o => o.division)).toEqual(playerDivisions(war).filter(d => d.generals.length).map(d => d.id).sort());
    for (const order of orders) {
      if (order.type === 'march') expect(neighbours(war, playerDivisions(war).find(d => d.id === order.division)!.atNode)).toContain(order.toNode);
      else expect(['rest', 'hold']).toContain(order.type);
    }
  });

  it('advances aggressively toward the hostile castle by shortest routes', () => {
    const war = make(); setPersonality(war, 'aggressive');
    for (const d of playerDivisions(war)) d.atNode = 'westmere';
    const orders = planFactionOrders(war, 'player');
    expect(orders.every(o => o.type === 'march' && o.toNode === 'greenfield')).toBe(true);
  });

  it('defense responds to a visible enemy threatening a friendly castle', () => {
    const war = make(); setPersonality(war, 'defensive');
    const ours = playerDivisions(war); ours.forEach(d => { d.atNode = 'westmere'; });
    const enemy = war.divisions.find(d => d.factionId === 'invader')!; enemy.atNode = 'reedhaven';
    const orders = planFactionOrders(war, 'player');
    expect(orders.every(o => o.type === 'march' && o.toNode === 'dawnkeep')).toBe(true);
  });

  it('opportunists prefer an accessible undefended visible economic node', () => {
    const war = make(); setPersonality(war, 'opportunist');
    const d = playerDivisions(war)[0]!; d.atNode = 'westmere';
    const order = planFactionOrders(war, 'player').find(o => o.division === d.id);
    expect(order).toEqual({ type: 'march', division: d.id, toNode: 'greenfield' });
  });

  it('opportunists avoid a visibly superior hostile division on the selected route', () => {
    const war = make(); setPersonality(war, 'opportunist');
    const own = playerDivisions(war)[0]!; own.atNode = 'westmere';
    const enemy = war.divisions.find(d => d.factionId === 'invader')!; enemy.atNode = 'greenfield';
    for (const g of war.generals.filter(g => enemy.generals.includes(g.id))) g.troops = g.troops.concat(g.troops, g.troops, g.troops);
    const order = planFactionOrders(war, 'player').find(o => o.division === own.id)!;
    expect(order.type === 'march' && order.toNode === 'greenfield').toBe(false);
  });

  it('opportunists assess all hostiles on a route independently of division order', () => {
    const a = make(); const b = make();
    for (const war of [a, b]) {
      setPersonality(war, 'opportunist');
      const own = playerDivisions(war)[0]!; own.atNode = 'westmere';
      const enemies = war.divisions.filter(d => d.factionId === 'invader');
      const first = enemies[0]!;
      first.atNode = 'greenfield';
      const extraGeneral = war.generals.find(g => g.factionId === 'invader' && !first.generals.includes(g.id))!;
      const second = { ...structuredClone(first), id: `${first.id}-second`, generals: [extraGeneral.id] };
      war.divisions.push(second);
      const general = extraGeneral;
      general.troops = general.troops.concat(general.troops, general.troops, general.troops);
    }
    b.divisions.reverse();
    const orderA = planFactionOrders(a, 'player').find(o => o.division === playerDivisions(a)[0]!.id)!;
    const orderB = planFactionOrders(b, 'player').find(o => o.division === playerDivisions(b)[0]!.id)!;
    expect(orderA.type === 'march' && orderA.toNode === 'greenfield').toBe(false);
    expect(orderB).toEqual(orderA);
  });

  it('does not rest depleted-only divisions when the weekly supply budget is empty', () => {
    const war = make();
    const d = playerDivisions(war)[0]!; d.atNode = 'dawnkeep';
    for (const g of war.generals.filter(g => d.generals.includes(g.id))) g.troops = [];
    const state = war._internal as { supply: Record<string, number> };
    state.supply.dawnkeep = 0;
    const order = planFactionOrders(war, 'player').find(o => o.division === d.id);
    expect(order?.type).not.toBe('rest');
  });

  it('rests an injured division at friendly supply, but marches off a neutral node toward supply', () => {
    const war = make(); setPersonality(war, 'aggressive');
    const d = playerDivisions(war)[0]!;
    const general = war.generals.find(g => d.generals.includes(g.id))!;
    d.atNode = 'westmere';
    for (const g of war.generals.filter(g => d.generals.includes(g.id))) g.hp = 1;
    expect(planFactionOrders(war, 'player').find(o => o.division === d.id)).toEqual({ type: 'rest', division: d.id });
    d.atNode = 'stoneford'; general.nodeId = 'stoneford';
    expect(planFactionOrders(war, 'player').find(o => o.division === d.id)).toEqual({ type: 'march', division: d.id, toNode: 'reedhaven' });
  });

  it('does not vary with array insertion order and repeats for the same seed', () => {
    const a = make(91); const b = make(91);
    setPersonality(a, 'opportunist'); setPersonality(b, 'opportunist');
    b.nodes.reverse(); b.routes.reverse(); b.divisions.reverse(); b.generals.reverse(); b.factions.reverse();
    expect(planFactionOrders(a, 'player')).toEqual(planFactionOrders(b, 'player'));
    expect(planFactionOrders(make(91), 'player')).toEqual(planFactionOrders(make(91), 'player'));
  });

  it('does not mutate world state, including pending engine orders and RNG', () => {
    const war = make();
    const d = playerDivisions(war)[0]!;
    issueOrder(war, { type: 'hold', division: d.id });
    const before = structuredClone(war);
    planFactionOrders(war, 'player');
    expect(war).toEqual(before);
  });

  it('ignores changes to enemy divisions and strength in still-invisible territory', () => {
    const a = make(); const b = make();
    const invisibleEnemyA = a.divisions.find(d => d.factionId === 'invader')!;
    const invisibleEnemyB = b.divisions.find(d => d.factionId === 'invader')!;
    invisibleEnemyA.atNode = 'nightspire'; invisibleEnemyB.atNode = 'eastgate';
    for (const g of a.generals.filter(g => invisibleEnemyA.generals.includes(g.id))) g.troops = [];
    for (const g of b.generals.filter(g => invisibleEnemyB.generals.includes(g.id))) g.troops = g.troops.concat(g.troops, g.troops);
    expect(planFactionOrders(a, 'player')).toEqual(planFactionOrders(b, 'player'));
  });

  it('heals at an owned castle even when authored and weekly troop supply are zero', () => {
    const war = make();
    const d = playerDivisions(war)[0]!;
    const castle = war.nodes.find(n => n.kind === 'castle' && n.owner === 'player')!;
    d.atNode = castle.id;
    castle.supplyPerWeek = 0;
    (war._internal as { supply: Record<string, number> }).supply[castle.id] = 0;
    for (const g of war.generals.filter(g => d.generals.includes(g.id))) { g.hp = 1; g.nodeId = castle.id; }
    expect(planFactionOrders(war, 'player').find(o => o.division === d.id)).toEqual({ type: 'rest', division: d.id });
  });

  it.each(['battle', 'admin', 'won', 'lost'] as const)('issues no orders during %s phase', phase => {
    const war = make(); war.phase = phase;
    expect(planFactionOrders(war, 'player')).toEqual([]);
  });
});
