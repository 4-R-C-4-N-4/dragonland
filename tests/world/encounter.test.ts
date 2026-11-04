import { describe, expect, it } from 'vitest';
import { buildWorldData, rawWorldData, createWar, issueOrder, resolveTurn } from '../../src/world';
import { detectEncounters } from '../../src/world/encounter';
const data = buildWorldData(rawWorldData);
const make = () => createWar(data, { seed: 17, heroId: 'paladin', heroName: 'Ivy' });
describe('encounters', () => {
  it('detects hostile node contact, once', () => {
    const war = make(); war.divisions.forEach(d => { d.atNode = 'greenfield'; });
    detectEncounters(war);
    expect(war.pendingBattle).toMatchObject({ cause: 'contact', nodeId: 'greenfield', wild: [], processedSkirmishIds: [] });
    expect(war.phase).toBe('battle'); expect(war.events.filter(e => e.type === 'battleTriggered')).toHaveLength(1);
    const before = structuredClone(war); detectEncounters(war); expect(war).toEqual(before);
    war.phase = 'orders'; const frozen = structuredClone(war); resolveTurn(war); expect(war).toEqual(frozen);
  });
  it('detects swaps from this turn snapshot, never from stale previousNode', () => {
    const war = make(); const [a, b] = war.divisions;
    a!.atNode = 'greenfield'; b!.atNode = 'pinewatch'; a!.previousNode = 'pinewatch'; b!.previousNode = 'greenfield';
    detectEncounters(war); expect(war.pendingBattle).toBeNull();
    detectEncounters(war, new Map([[a!.id, 'pinewatch'], [b!.id, 'greenfield']]));
    expect(war.pendingBattle?.cause).toBe('swap');
  });
  it('triggers castle assault against actual reserves and preserves ownership', () => {
    const war = make(); const d = war.divisions.find(d => d.factionId === 'player')!;
    war.divisions.find(x => x.factionId === 'invader')!.atNode = 'highpass';
    d.atNode = 'eastgate'; issueOrder(war, { type: 'march', division: d.id, toNode: 'nightspire' }); resolveTurn(war);
    expect(war.pendingBattle).toMatchObject({ cause: 'assault', attacker: d.id, defender: null, nodeId: 'nightspire' });
    expect(war.nodes.find(n => n.id === 'nightspire')!.owner).toBe('invader');
  });
  it('allows capturing an empty castle even when its capacity is positive', () => {
    const war = make(); const d = war.divisions.find(d => d.factionId === 'player')!;
    war.generals.filter(g => g.factionId === 'invader').forEach(g => { g.nodeId = 'highpass'; });
    war.divisions.find(x => x.factionId === 'invader')!.atNode = 'highpass';
    d.atNode = 'eastgate'; issueOrder(war, { type: 'march', division: d.id, toNode: 'nightspire' }); resolveTurn(war);
    expect(war.pendingBattle).toBeNull(); expect(war.nodes.find(n => n.id === 'nightspire')!.owner).toBe('player');
  });
  it('allied or empty divisions sharing nodes never fight', () => {
    const war = make(); war.divisions.forEach(d => { d.atNode = 'greenfield'; d.factionId = 'player'; });
    detectEncounters(war); expect(war.pendingBattle).toBeNull();
    war.divisions[1]!.factionId = 'invader'; war.divisions[1]!.generals = [];
    detectEncounters(war); expect(war.pendingBattle).toBeNull();
  });
  it('has deterministic turn/node ids independent of faction and division ordering', () => {
    const war = make(); war.divisions.forEach(d => { d.atNode = 'greenfield'; }); const copy = structuredClone(war);
    copy.factions.reverse(); copy.divisions.reverse(); copy.generals.reverse();
    detectEncounters(war); detectEncounters(copy);
    expect(copy.pendingBattle).toEqual(war.pendingBattle);
    expect(war.pendingBattle!.id).toBe('battle-1-greenfield');
  });
  it('captures an unrelated undefended arrival even when another pair clashes', () => {
    const war = make(); const [a, b] = war.divisions;
    a!.atNode = 'greenfield'; b!.atNode = 'greenfield';
    const extra = { ...a!, id: 'extra', atNode: 'reedhaven', generals: [war.generals.find(g => g.factionId === a!.factionId)!.id] };
    war.divisions.push(extra);
    issueOrder(war, { type: 'march', division: extra.id, toNode: 'stoneford' }); resolveTurn(war);
    expect(war.phase).toBe('battle'); expect(war.nodes.find(n => n.id === 'stoneford')!.owner).toBe(extra.factionId);
  });
});
