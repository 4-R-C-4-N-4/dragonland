import { describe, expect, it } from 'vitest';
import { buildWorldData, rawWorldData, createWar, issueOrder, resolveTurn } from '../../src/world';
import { moveDivisions, retreatNode } from '../../src/world/movement';
const data = buildWorldData(rawWorldData);
const make = () => createWar(data, { seed: 17, heroId: 'paladin', heroName: 'Ivy' });
const player = (war: ReturnType<typeof make>) => war.divisions.find(d => d.factionId === 'player')!;
describe('movement', () => {
  it('records every previous node, moves generals and captures undefended nodes', () => {
    const war = make(); const d = player(war);
    for (const toNode of ['reedhaven', 'stoneford']) {
      const from = d.atNode;
      issueOrder(war, { type: 'march', division: d.id, toNode }); resolveTurn(war);
      expect(d.previousNode).toBe(from); expect(d.atNode).toBe(toNode);
      expect(war.generals.filter(g => d.generals.includes(g.id)).every(g => g.nodeId === toNode)).toBe(true);
      expect(war.nodes.find(n => n.id === toNode)!.owner).toBe('player');
      expect(war.events).toContainEqual({ type: 'captured', nodeId: toNode, factionId: 'player' });
    }
  });
  it.each(['missing', 'nightspire', 'dawnkeep'])('illegal target %s mutates no movement state', toNode => {
    const war = make(); const before = structuredClone(war);
    moveDivisions(war, [{ type: 'march', division: player(war).id, toNode }]);
    expect(war).toEqual(before);
  });
  it('holds a division with no generals', () => {
    const war = make(); const d = player(war); d.generals = [];
    const before = structuredClone(war);
    moveDivisions(war, [{ type: 'march', division: d.id, toNode: 'reedhaven' }]); expect(war).toEqual(before);
  });
  it('captures an undefended enemy town', () => {
    const war = make(); const d = player(war);
    d.atNode = 'pinewatch'; issueOrder(war, { type: 'march', division: d.id, toNode: 'eastgate' }); resolveTurn(war);
    expect(war.nodes.find(n => n.id === 'eastgate')!.owner).toBe('player');
  });
  it('returns previous node or null with no arrival path', () => {
    const war = make(); const d = player(war);
    expect(retreatNode(war, d)).toBeNull();
    issueOrder(war, { type: 'march', division: d.id, toNode: 'reedhaven' }); resolveTurn(war);
    expect(retreatNode(war, d)).toBe('dawnkeep');
  });
  it('walks actual arrival history past hostile occupancy and stops when no fallback remains', () => {
    const war = make(); const d = player(war); const enemy = war.divisions.find(x => x.factionId !== d.factionId)!;
    for (const toNode of ['reedhaven', 'stoneford']) { issueOrder(war, { type: 'march', division: d.id, toNode }); resolveTurn(war); }
    enemy.atNode = 'reedhaven';
    expect(retreatNode(war, d)).toBe('dawnkeep');
    const copy = structuredClone(enemy); copy.id = 'blocker'; copy.atNode = 'dawnkeep'; war.divisions.push(copy);
    expect(retreatNode(war, d)).toBeNull();
  });
});

it('retreat skips a hostile castle garrison on the arrival path', () => {
  const war = make(); const d = player(war);
  war.divisions.find(x => x.factionId === 'invader')!.atNode = 'highpass';
  d.atNode = 'eastgate'; d.previousNode = 'nightspire';
  expect(retreatNode(war, d)).toBeNull();
});
