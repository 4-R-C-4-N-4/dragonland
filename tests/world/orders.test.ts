import { describe, expect, it } from 'vitest';
import { buildWorldData, cancelOrder, createWar, issueOrder, queuedOrders, rawWorldData, resolveTurn } from '../../src/world';
import { internal } from '../../src/world/rng';

const data = buildWorldData(rawWorldData);
const make = () => createWar(data, { seed: 17, heroId: 'paladin', heroName: 'Ivy' });
const own = (war: ReturnType<typeof make>) => war.divisions.find(d => d.factionId === 'player')!;

describe('queued order view', () => {
  it('returns copies, so callers cannot rewrite the queue', () => {
    const war = make(); const d = own(war);
    issueOrder(war, { type: 'march', division: d.id, toNode: 'reedhaven' });
    const view = queuedOrders(war);
    expect(view).toEqual([{ type: 'march', division: d.id, toNode: 'reedhaven' }]);
    (view[0] as { toNode: string }).toNode = 'westmere';
    view.push({ type: 'hold', division: 'x' });
    expect(queuedOrders(war)).toEqual([{ type: 'march', division: d.id, toNode: 'reedhaven' }]);
  });

  it('shows a replaced order once', () => {
    const war = make(); const d = own(war);
    issueOrder(war, { type: 'march', division: d.id, toNode: 'reedhaven' });
    issueOrder(war, { type: 'search', division: d.id });
    expect(queuedOrders(war)).toEqual([{ type: 'search', division: d.id }]);
  });
});

describe('cancelOrder', () => {
  it('removes only that division\'s order, and the turn then holds it', () => {
    const war = make(); const d = own(war);
    const enemy = war.divisions.find(x => x.factionId !== 'player')!;
    issueOrder(war, { type: 'march', division: d.id, toNode: 'reedhaven' });
    issueOrder(war, { type: 'hold', division: enemy.id });
    cancelOrder(war, d.id);
    expect(queuedOrders(war)).toEqual([{ type: 'hold', division: enemy.id }]);
    resolveTurn(war);
    expect(d.atNode).toBe('dawnkeep');
  });

  it('is a no-op for a division with no order', () => {
    const war = make(); const before = structuredClone(war);
    cancelOrder(war, own(war).id);
    expect(war).toEqual(before);
  });

  it.each(['battle', 'admin', 'won', 'lost'] as const)('does nothing during %s', phase => {
    const war = make(); const d = own(war);
    issueOrder(war, { type: 'search', division: d.id });
    war.phase = phase;
    cancelOrder(war, d.id);
    expect(queuedOrders(war)).toEqual([{ type: 'search', division: d.id }]);
  });

  it('does nothing while a committed turn frame is active', () => {
    const war = make(); const d = own(war);
    issueOrder(war, { type: 'search', division: d.id });
    internal(war).activeTurn = { turn: 1, orders: [], starts: {}, resolved: [], ordinal: 0, current: null, applied: [] };
    cancelOrder(war, d.id);
    expect(queuedOrders(war)).toEqual([{ type: 'search', division: d.id }]);
  });
});
