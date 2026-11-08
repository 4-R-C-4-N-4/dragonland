import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { getRunConfig } from '../../src/run/config';
import { buildWorldData, rawWorldData } from '../../src/world/data';
import { createWar } from '../../src/world/engine';
const data = buildWorldData(rawWorldData);
const game = getGameData();
const run = getRunConfig();
const setup = { seed: 17, heroId: 'paladin' as const, heroName: 'Ivy' };
const classOf = (unitId: string) => game.unitById.get(unitId)!.classId;

describe('createWar', () => {
  it('starts the hero alone with the Skirmish demo army: hero class plus partner, ten per line', () => {
    const war = createWar(data, setup);
    const mine = war.generals.filter(g => g.factionId === 'player');
    expect(mine).toHaveLength(1);
    const hero = mine[0]!;
    expect(hero).toMatchObject({ name: 'Ivy', generalId: 'paladin', isHero: true, nodeId: 'dawnkeep', capacity: data.constants.PLAYER_STARTING_CAPACITY });
    // Paladin is Human; the configured partner is Mage.
    expect(run.startingPartners.human).toBe('mage');
    expect(war.factions.find(f => f.id === 'player')!.classes).toEqual(['human', 'mage']);
    expect(hero.troops).toHaveLength(run.startingTroopsPerLine * 6);
    const perUnit = new Map<string, number>();
    for (const t of hero.troops) perUnit.set(t.unitId, (perUnit.get(t.unitId) ?? 0) + 1);
    expect([...perUnit.values()]).toEqual(Array(6).fill(run.startingTroopsPerLine));
    expect([...perUnit.keys()].every(u => game.unitById.get(u)!.stage === 1 && ['human', 'mage'].includes(classOf(u)))).toBe(true);
    expect(new Set([...perUnit.keys()].map(u => game.unitById.get(u)!.line + classOf(u))).size).toBe(6);
    expect(war.divisions.filter(d => d.factionId === 'player')).toEqual([expect.objectContaining({ atNode: 'dawnkeep', previousNode: null, generals: [hero.id] })]);
    expect(war).toMatchObject({ turn: 1, week: 1, phase: 'orders' });
  });

  it('takes the partner class from the hero, not from the authored faction', () => {
    const war = createWar(data, { ...setup, heroId: 'warg' });
    const beast = 'beast';
    expect(war.factions.find(f => f.id === 'player')!.classes).toEqual([beast, run.startingPartners[beast]]);
  });

  it('fields only the opening rival force and garrisons the rest at the rival castle', () => {
    const war = createWar(data, setup);
    const rival = war.factions.find(f => !f.isPlayer)!;
    const theirs = war.generals.filter(g => g.factionId === rival.id);
    expect(theirs).toHaveLength(6);
    expect(theirs.every(g => g.capacity === data.constants.STARTING_CAPACITY && g.troops.length === data.constants.STARTING_CAPACITY)).toBe(true);
    const divisions = war.divisions.filter(d => d.factionId === rival.id);
    const field = divisions.flatMap(d => d.generals);
    expect(field).toHaveLength(data.constants.RIVAL_OPENING_FIELD[rival.personality]);
    // One general per division: a solo hero meets them one at a time.
    expect(divisions.every(d => d.generals.length <= data.constants.RIVAL_OPENING_DIVISION_SIZE)).toBe(true);
    expect(divisions).toHaveLength(Math.ceil(field.length / data.constants.RIVAL_OPENING_DIVISION_SIZE));
    const castle = war.nodes.find(n => n.kind === 'castle' && n.owner === rival.id)!;
    expect(theirs.filter(g => !field.includes(g.id)).every(g => g.nodeId === castle.id)).toBe(true);
  });

  it('is deterministic and seed dependent without mutating data', () => {
    const before = structuredClone(data);
    expect(createWar(data, setup)).toEqual(createWar(data, setup));
    expect(createWar(data, setup)).not.toEqual(createWar(data, { ...setup, seed: 18 }));
    expect(data).toEqual(before);
  });
});
