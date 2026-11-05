import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { buildWorldData, rawWorldData } from '../../src/world/data';
import { createWar, issueOrder, resolveTurn } from '../../src/world';
import { garrisonAt, joinDivision, leaveAsGarrison } from '../../src/world/garrison';
import { sequenceEncounter } from '../../src/world/sequence';
import type { War } from '../../src/world/types';

const data = buildWorldData(rawWorldData);
const game = getGameData();
const make = () => createWar(data, { seed: 23, heroId: 'paladin', heroName: 'Ivy' });
const playerDivision = (war: War) => war.divisions.find(d => d.factionId === 'player' && d.generals.length)!;

describe('garrisons', () => {
  it('leaves a general holding its castle and takes it back again', () => {
    const war = make();
    const division = playerDivision(war);
    const keeper = war.generals.find(g => division.generals.includes(g.id) && !g.isHero)!;
    expect(garrisonAt(war, division.atNode, 'player')).toEqual([]);
    leaveAsGarrison(war, division.id, keeper.id);
    expect(division.generals).not.toContain(keeper.id);
    expect(garrisonAt(war, division.atNode, 'player')).toEqual([keeper.id]);
    expect(keeper.troops.length).toBeGreaterThan(0);
    joinDivision(war, division.id, keeper.id);
    expect(division.generals).toContain(keeper.id);
    expect(garrisonAt(war, division.atNode, 'player')).toEqual([]);
  });

  it('refuses a garrison on ground you do not hold, and rejects illegal transfers without mutation', () => {
    const war = make();
    const division = playerDivision(war);
    const keeper = war.generals.find(g => division.generals.includes(g.id) && !g.isHero)!;
    const enemy = war.generals.find(g => g.factionId !== 'player')!;
    division.atNode = 'greenfield';
    for (const g of war.generals.filter(g => division.generals.includes(g.id))) g.nodeId = 'greenfield';
    const before = structuredClone(war);
    expect(() => leaveAsGarrison(war, division.id, keeper.id)).toThrow(/node you hold/);
    expect(war).toEqual(before);
    expect(() => leaveAsGarrison(war, division.id, 'general-ghost')).toThrow();
    expect(() => joinDivision(war, division.id, enemy.id)).toThrow(/another faction/);
    expect(() => joinDivision(war, division.id, keeper.id)).toThrow(/already serves/);
    expect(war).toEqual(before);
  });

  it('keeps a garrison out of the marching division', () => {
    const war = make();
    const division = playerDivision(war);
    const keeper = war.generals.find(g => division.generals.includes(g.id) && !g.isHero)!;
    const home = division.atNode;
    leaveAsGarrison(war, division.id, keeper.id);
    issueOrder(war, { type: 'march', division: division.id, toNode: 'westmere' });
    resolveTurn(war);
    expect(division.atNode).toBe('westmere');
    expect(keeper.nodeId).toBe(home);
    expect(garrisonAt(war, home, 'player')).toEqual([keeper.id]);
  });

  it('makes a held castle cost the enemy a real assault instead of a free capture', () => {
    const war = make();
    const division = playerDivision(war);
    const home = division.atNode;
    const keeper = war.generals.find(g => division.generals.includes(g.id) && !g.isHero)!;
    leaveAsGarrison(war, division.id, keeper.id);
    issueOrder(war, { type: 'march', division: division.id, toNode: 'westmere' });
    // An enemy division walks onto the now garrisoned castle.
    const enemy = war.divisions.find(d => d.factionId !== 'player' && d.generals.length)!;
    enemy.atNode = 'reedhaven';
    for (const g of war.generals.filter(g => enemy.generals.includes(g.id))) g.nodeId = 'reedhaven';
    issueOrder(war, { type: 'march', division: enemy.id, toNode: home });
    resolveTurn(war);
    expect(war.nodes.find(n => n.id === home)!.owner).toBe('player');
    expect(war.phase).toBe('battle');
    expect(war.pendingBattle?.cause).toBe('assault');
    const seq = sequenceEncounter(war, war.pendingBattle!);
    expect(seq.defenderGeneralIds).toEqual([keeper.id]);
  });

  it('would have lost the castle for free with nobody left behind', () => {
    const war = make();
    const division = playerDivision(war);
    const home = division.atNode;
    issueOrder(war, { type: 'march', division: division.id, toNode: 'westmere' });
    const enemy = war.divisions.find(d => d.factionId !== 'player' && d.generals.length)!;
    enemy.atNode = 'reedhaven';
    for (const g of war.generals.filter(g => enemy.generals.includes(g.id))) g.nodeId = 'reedhaven';
    issueOrder(war, { type: 'march', division: enemy.id, toNode: home });
    resolveTurn(war);
    // This is the trap the garrison exists to avoid: an empty castle simply changes hands.
    expect(war.nodes.find(n => n.id === home)!.owner).toBe(enemy.factionId);
  });

  it('honours the garrison cap and the division cap', () => {
    const war = make();
    const division = playerDivision(war);
    const cap = data.constants.GARRISON_CAP;
    // The player starts with three generals, so clone records to fill a full garrison.
    const standing = war.generals.filter(g => g.factionId === 'player' && !division.generals.includes(g.id));
    const template = war.generals.find(g => g.factionId === 'player')!;
    for (let i = standing.length; i < cap; i++) {
      const clone = { ...structuredClone(template), id: `garrison-${i}`, name: `Keeper ${i}`, troops: [], nodeId: division.atNode, isHero: false };
      war.generals.push(clone);
      standing.push(clone);
    }
    for (const g of standing) g.nodeId = division.atNode;
    expect(garrisonAt(war, division.atNode, 'player')).toHaveLength(cap);
    const newcomer = war.generals.find(g => division.generals.includes(g.id))!;
    expect(() => leaveAsGarrison(war, division.id, newcomer.id)).toThrow(new RegExp(`${cap} generals`));
    expect(division.generals).toContain(newcomer.id);

    const max = data.constants.MAX_DIVISION_GENERALS;
    division.generals = standing.slice(0, max).map(g => g.id);
    const spare = standing[max];
    if (spare) expect(() => joinDivision(war, division.id, spare.id)).toThrow(/at most/);
  });

  it('only changes garrisons during the orders phase', () => {
    const war = make();
    const division = playerDivision(war);
    const keeper = war.generals.find(g => division.generals.includes(g.id) && !g.isHero)!;
    war.phase = 'battle';
    expect(() => leaveAsGarrison(war, division.id, keeper.id)).toThrow(/orders phase/);
    expect(() => joinDivision(war, division.id, keeper.id)).toThrow(/orders phase/);
  });
});

void game;
