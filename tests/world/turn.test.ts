import { describe, expect, it } from 'vitest';
import { buildWorldData, rawWorldData, createWar, issueOrder } from '../../src/world';
import { resolveTurn } from '../../src/world/turn';
const data = buildWorldData(rawWorldData);
const make = () => createWar(data, { seed: 17, heroId: 'paladin', heroName: 'Ivy' });
describe('turn resolution', () => {
  it('advances once, clears events and queues, logs explicit and default holds', () => {
    const war = make(); const positions = war.divisions.map(d => d.atNode);
    war.events.push({ type: 'weekPassed', week: 99 });
    issueOrder(war, { type: 'hold', division: war.divisions[0]!.id });
    resolveTurn(war);
    expect(war.turn).toBe(2);
    expect(war.divisions.map(d => d.atNode)).toEqual(positions);
    expect(war.events).toEqual([{ type: 'turnPassed', turn: 2 }]);
    expect(war.turnLog[0]!.orders).toHaveLength(war.divisions.length);
    expect((war._internal as { pending: unknown[] }).pending).toEqual([]);
  });
  it('moves both hostile divisions from a single snapshot and clashes on a swap', () => {
    const war = make(); const [a, b] = war.divisions;
    a!.atNode = 'greenfield'; b!.atNode = 'pinewatch';
    issueOrder(war, { type: 'march', division: a!.id, toNode: 'pinewatch' });
    issueOrder(war, { type: 'march', division: b!.id, toNode: 'greenfield' });
    resolveTurn(war);
    expect(a!.atNode).toBe('pinewatch'); expect(b!.atNode).toBe('greenfield');
    expect(war.pendingBattle?.cause).toBe('swap'); expect(war.phase).toBe('battle');
    expect(war.turn).toBe(1); expect(war.turnLog).toEqual([]);
  });
  it('ends exactly seven turns at one weekly admin boundary', () => {
    const war = make();
    for (let i = 0; i < 6; i++) resolveTurn(war);
    expect(war).toMatchObject({ turn: 7, week: 1, phase: 'orders' });
    resolveTurn(war);
    expect(war).toMatchObject({ turn: 8, week: 2, phase: 'admin' });
    expect(war.events.filter(e => e.type === 'weekPassed')).toEqual([{ type: 'weekPassed', week: 2 }]);
    const before = structuredClone(war); resolveTurn(war); expect(war).toEqual(before);
  });
  it.each(['battle', 'admin', 'won', 'lost'] as const)('blocks resolution during %s', phase => {
    const war = make(); war.phase = phase; const before = structuredClone(war);
    resolveTurn(war); expect(war).toEqual(before);
  });
});
