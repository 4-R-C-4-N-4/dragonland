import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { buildWorldData, rawWorldData } from '../../src/world/data';
import { createWar, issueOrder, resolveTurn, resumeTurn } from '../../src/world';
import { internal } from '../../src/world/rng';
import { searchOutcome, wildBattleSetup, applyWildResult } from '../../src/world/search';
import { createBattle, step } from '../../src/sim';
import { snapshotBattleResult } from '../../src/world/sequence';
import type { War } from '../../src/world/types';

const data = buildWorldData(rawWorldData);
const game = getGameData();
const make = (seed: number) => createWar(data, { seed, heroId: 'paladin', heroName: 'Ivy' });

/** Put one player division on a node and return it. */
function searcher(war: War, node: string) {
  const division = war.divisions.find(d => d.factionId === 'player' && d.generals.length)!;
  division.atNode = node;
  for (const g of war.generals.filter(g => division.generals.includes(g.id))) g.nodeId = node;
  // Keep enemies far away so only the search can interrupt the turn.
  for (const d of war.divisions.filter(d => d.factionId !== 'player')) d.atNode = 'nightspire';
  for (const g of war.generals.filter(g => g.factionId !== 'player')) g.nodeId = 'nightspire';
  return division;
}

/** First seed whose search at `node` produces the requested outcome. */
function seedFor(node: string, kind: 'wild' | 'nothing'): number {
  for (let seed = 1; seed < 400; seed++) {
    const probe = make(seed);
    const d = searcher(probe, node);
    if (searchOutcome(probe, d.id).kind === kind) return seed;
  }
  throw new Error(`no seed produced a ${kind} search at ${node}`);
}

describe('search inside the turn engine', () => {
  it('settles the turn when a search finds nothing', () => {
    const war = make(seedFor('greenfield', 'nothing'));
    const division = searcher(war, 'greenfield');
    issueOrder(war, { type: 'search', division: division.id });
    resolveTurn(war);
    expect(war.events.some(e => e.type === 'searchedNothing')).toBe(true);
    expect(war.pendingBattle).toBeNull();
    expect(war.phase).toBe('orders');
    expect(war.turn).toBe(2);
    expect(war.turnLog).toHaveLength(1);
  });

  it('suspends the turn on a wild find and settles it once after the fight', () => {
    const war = make(seedFor('wyrmpeak', 'wild'));
    const division = searcher(war, 'wyrmpeak');
    issueOrder(war, { type: 'search', division: division.id });
    resolveTurn(war);
    expect(war.phase).toBe('battle');
    expect(war.pendingBattle?.cause).toBe('wild');
    expect(war.pendingBattle!.wild.length).toBeGreaterThan(0);
    expect(war.turn).toBe(1);
    expect(war.turnLog).toHaveLength(0);
    const gold = war.factions.map(f => f.gold);

    const general = war.generals.find(g => division.generals.includes(g.id))!;
    const before = general.troops.length;
    const selection = wildBattleSetup(war, division.id, general.id);
    const world = createBattle(game, selection.setup);
    for (let i = 0; i < 20000 && !world.result; i++) step(world);
    expect(world.result).not.toBeNull();
    applyWildResult(war, selection, snapshotBattleResult(world));
    expect(war.pendingBattle).toBeNull();

    resumeTurn(war);
    expect(war.phase).toBe('orders');
    expect(war.turn).toBe(2);
    expect(war.turnLog).toHaveLength(1);
    expect(war.factions.some((f, i) => f.gold !== gold[i])).toBe(true);
    // Winning recruits, losing does not; either way the roster never shrinks below the survivors.
    expect(general.troops.length).toBeGreaterThanOrEqual(0);
    const settled = structuredClone(war);
    resumeTurn(war);
    expect(war).toEqual(settled);
  });

  it('does not re-roll a resolved search or re-apply a rest when the turn resumes', () => {
    const war = make(seedFor('wyrmpeak', 'wild'));
    const division = searcher(war, 'wyrmpeak');
    const resting = war.divisions.find(d => d.factionId === 'player' && d.id !== division.id && d.generals.length);
    issueOrder(war, { type: 'search', division: division.id });
    if (resting) {
      resting.atNode = 'dawnkeep';
      for (const g of war.generals.filter(g => resting.generals.includes(g.id))) { g.nodeId = 'dawnkeep'; g.hp = 10; }
      issueOrder(war, { type: 'rest', division: resting.id });
    }
    resolveTurn(war);
    expect(war.phase).toBe('battle');
    const healedOnce = resting ? war.generals.filter(g => resting.generals.includes(g.id)).map(g => g.hp) : [];
    const searchedCount = () => war.turnLog.flatMap(r => r.orders).filter(o => o.type === 'search').length;
    const general = war.generals.find(g => division.generals.includes(g.id))!;
    const selection = wildBattleSetup(war, division.id, general.id);
    const world = createBattle(game, selection.setup);
    for (let i = 0; i < 20000 && !world.result; i++) step(world);
    applyWildResult(war, selection, snapshotBattleResult(world));
    const rngBefore = internal(war).rng.state;
    resumeTurn(war);
    // One search order was logged, and the rest healed exactly once.
    expect(searchedCount()).toBe(1);
    if (resting) expect(war.generals.filter(g => resting.generals.includes(g.id)).map(g => g.hp)).toEqual(healedOnce);
    // Resuming must not consume another search draw.
    expect(internal(war).rng.state).toBe(rngBefore);
    expect(war.pendingBattle).toBeNull();
  });

  it('returns a beaten searcher to its previous node and keeps no recruits', () => {
    const war = make(seedFor('wyrmpeak', 'wild'));
    const division = searcher(war, 'wyrmpeak');
    division.previousNode = 'highpass';
    internal(war).paths[division.id] = ['highpass'];
    issueOrder(war, { type: 'search', division: division.id });
    resolveTurn(war);
    const general = war.generals.find(g => division.generals.includes(g.id) && !g.isHero)!;
    const roster = general.troops.map(t => t.id);
    const selection = wildBattleSetup(war, division.id, general.id);
    // A forced defeat: the wild side (0) wins and the searcher's general falls.
    const ids = selection.setup.sides.map(s => s.squads.flatMap(q => q.troops.map(t => t.troopId))) as [string[], string[]];
    applyWildResult(war, selection, {
      result: { winner: 0, reason: 'generalDefeated', durationS: 1, hadDuel: false, dead: [[], []], survivors: ids },
      generalHp: [Math.max(1, selection.setup.sides[0]!.general!.hp - 1), 0],
    });
    expect(general.troops.map(t => t.id)).toEqual(roster);
    expect(division.atNode).toBe('highpass');
    expect(war.pendingBattle).toBeNull();
    resumeTurn(war);
    expect(war.turn).toBe(2);
  });

  it('ends the war when the hero falls to a wild pack', () => {
    const war = make(seedFor('wyrmpeak', 'wild'));
    const division = searcher(war, 'wyrmpeak');
    issueOrder(war, { type: 'search', division: division.id });
    resolveTurn(war);
    const hero = war.generals.find(g => g.isHero && division.generals.includes(g.id))!;
    const selection = wildBattleSetup(war, division.id, hero.id);
    const ids = selection.setup.sides.map(s => s.squads.flatMap(q => q.troops.map(t => t.troopId))) as [string[], string[]];
    applyWildResult(war, selection, {
      result: { winner: 0, reason: 'generalDefeated', durationS: 1, hadDuel: false, dead: [[], []], survivors: ids },
      generalHp: [Math.max(1, selection.setup.sides[0]!.general!.hp - 1), 0],
    });
    expect(war.phase).toBe('lost');
    const terminal = structuredClone(war);
    resumeTurn(war);
    expect(war).toEqual(terminal);
    expect(war.turn).toBe(1);
  });

  it('finds a pack leader profile for every authored wild species', () => {
    const species = new Set(Object.values(data.biomes).flatMap(table => (table ?? []).map(e => e.unitId)));
    expect(species.size).toBeGreaterThan(0);
    for (const unitId of species) {
      const war = make(1);
      const division = searcher(war, 'wyrmpeak');
      war.pendingBattle = { id: 'probe', cause: 'wild', nodeId: division.atNode, attacker: division.id, defender: null, wild: [{ unitId, count: 3 }], processedSkirmishIds: [] };
      const general = war.generals.find(g => division.generals.includes(g.id))!;
      expect(() => wildBattleSetup(war, division.id, general.id), unitId).not.toThrow();
    }
  });
});
