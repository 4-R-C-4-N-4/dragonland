import { describe, expect, it } from 'vitest';
import { buildWorldData, createWar, rawWorldData } from '../../src/world';
import { rivalsTakeTheField } from '../../src/world/rivals';

const data = buildWorldData(rawWorldData);
const make = () => createWar(data, { seed: 17, heroId: 'warg', heroName: 'Ivy' });
const garrison = (war: ReturnType<typeof make>, factionId: string) =>
  war.generals.filter(g => g.factionId === factionId && g.hp > 0 && g.injuredTurns === 0 && !war.divisions.some(d => d.generals.includes(g.id)));

describe('rivals take the field again', () => {
  it('forms a two-general division from a castle garrison when a rival has no field force', () => {
    const war = make();
    const rival = war.factions.find(f => !f.isPlayer)!;
    for (const d of war.divisions.filter(x => x.factionId === rival.id)) d.generals = [];
    const before = garrison(war, rival.id).length;
    expect(before).toBeGreaterThanOrEqual(3);
    rivalsTakeTheField(war);
    const field = war.divisions.filter(d => d.factionId === rival.id && d.generals.length);
    expect(field).toHaveLength(1);
    expect(field[0]!.generals).toHaveLength(2);
    expect(garrison(war, rival.id)).toHaveLength(before - 2);
    const castle = war.nodes.find(n => n.id === field[0]!.atNode)!;
    expect(castle.kind).toBe('castle');
    expect(castle.owner).toBe(rival.id);
    // Idempotent while the new division stands.
    rivalsTakeTheField(war);
    expect(war.divisions.filter(d => d.factionId === rival.id && d.generals.length)).toHaveLength(1);
  });

  it('keeps at least one general home and never moves the player', () => {
    const war = make();
    const rival = war.factions.find(f => !f.isPlayer)!;
    for (const d of war.divisions.filter(x => x.factionId === rival.id)) d.generals = [];
    const home = garrison(war, rival.id);
    for (const g of home.slice(2)) g.hp = 0;
    const playerBefore = structuredClone(war.divisions.filter(d => d.factionId === 'player'));
    rivalsTakeTheField(war);
    expect(war.divisions.filter(d => d.factionId === rival.id && d.generals.length)).toHaveLength(0);
    expect(war.divisions.filter(d => d.factionId === 'player')).toEqual(playerBefore);
  });

  it('leaves a rival that still has a field division alone', () => {
    const war = make();
    const before = structuredClone(war.divisions);
    rivalsTakeTheField(war);
    expect(war.divisions).toEqual(before);
  });
});
