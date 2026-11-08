import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle, step } from '../../src/sim';
import { buildWorldData, rawWorldData, createWar, wildEncounter, wildBattleSetup, applyWildResult, WILD_SEARCHER_SIDE } from '../../src/world';
import { applySkirmishResult, commitAttacker, commitDefender, sequenceEncounter, snapshotBattleResult } from '../../src/world/sequence';
import { campaignBattlePerspective, playerSideOf } from '../../src/ui/world/battlePerspective';

function battle() {
  const war = createWar(buildWorldData(rawWorldData), { seed: 1, heroId: 'warg', heroName: 'Ivy' });
  const attacker = war.divisions.find(d => war.factions.find(f => f.id === d.factionId)!.isPlayer)!;
  const defender = war.divisions.find(d => d.factionId !== attacker.factionId)!;
  const hero = war.generals.find(g => g.isHero)!;
  const enemy = war.generals.find(g => defender.generals.includes(g.id))!;
  enemy.generalId = 'dragon';
  war.pendingBattle = { id: 'perspective', cause: 'contact', nodeId: attacker.atNode, attacker: attacker.id, defender: defender.id, wild: [], processedSkirmishIds: [] };
  const seq = sequenceEncounter(war, war.pendingBattle);
  commitDefender(war, seq, enemy.id);
  return { war, seq, selection: commitAttacker(war, seq, hero.id) };
}

it('puts the attacking Warg on the human-controlled side, not the defending Dragon', () => {
  const { selection: { setup } } = battle();
  const view = campaignBattlePerspective(setup, 1);
  const world = createBattle(getGameData(), view.setup);
  expect(view.setup.sides[0].generalId).toBe('warg');
  expect(world.generals[0].def.id).toBe('warg');
  expect(view.setup.sides[1].generalId).toBe('dragon');
  expect(setup.sides[0].generalId).toBe('dragon');
});

it.each([0, 1] as const)('maps real terminal results back to strategic sides for player side %i', playerSide => {
  const { war, seq, selection } = battle();
  const view = campaignBattlePerspective(selection.setup, playerSide);
  const sim = createBattle(getGameData(), view.setup);
  for (let i = 0; i < 100_000 && !sim.result; i++) step(sim);
  expect(sim.result).not.toBeNull();
  const tactical = snapshotBattleResult(sim);
  const strategic = view.snapshot(sim);
  for (const side of [0, 1] as const) {
    const tacticalSide = playerSide === 0 ? side : side === 0 ? 1 : 0;
    expect(strategic.generalHp[side]).toBe(tactical.generalHp[tacticalSide]);
    expect(strategic.result.dead[side]).toEqual(tactical.result.dead[tacticalSide]);
    expect(strategic.result.survivors[side]).toEqual(tactical.result.survivors[tacticalSide]);
  }
  expect(strategic.result.winner).toBe(playerSide === 0 ? tactical.result.winner : 1 - tactical.result.winner);
  expect(() => applySkirmishResult(war, seq, selection.id, strategic)).not.toThrow();
  const winner = war.generals.find(g => g.id === selection.generalIds[strategic.result.winner])!;
  expect(winner.hp).toBe(strategic.generalHp[strategic.result.winner]);
});

// A search fight puts the wild pack on side 0 and the searching general on side 1. The tactical
// view controls side 0, so without the perspective the player commanded the wild pack.
it('puts the searching general, not the wild pack, under the player\'s control', () => {
  const war = createWar(buildWorldData(rawWorldData), { seed: 3, heroId: 'warg', heroName: 'Ivy' });
  const own = war.divisions.find(d => war.factions.find(f => f.id === d.factionId)!.isPlayer)!;
  const hero = war.generals.find(g => g.isHero)!;
  own.atNode = 'reedhaven';
  war.pendingBattle = wildEncounter(war, own.id, [{ unitId: 'dog', count: 6 }]);
  war.phase = 'battle';
  const selection = wildBattleSetup(war, own.id, hero.id);
  expect(WILD_SEARCHER_SIDE).toBe(1);
  const view = campaignBattlePerspective(selection.setup, WILD_SEARCHER_SIDE);
  expect(view.setup.sides[0].generalId).toBe('warg');
  const heroTroops = new Set(hero.troops.map(t => t.id));
  expect(view.setup.sides[0].squads.flatMap(q => q.troops).every(t => heroTroops.has(t.troopId))).toBe(true);
  expect(view.setup.sides[1].squads.flatMap(q => q.troops).some(t => heroTroops.has(t.troopId))).toBe(false);

  const sim = createBattle(getGameData(), view.setup);
  for (let i = 0; i < 100_000 && !sim.result; i++) step(sim);
  const tactical = snapshotBattleResult(sim);
  const outcome = applyWildResult(war, selection, view.snapshot(sim));
  expect(outcome.applied).toBe(true);
  // The player's tactical side 0 is what lands on the hero.
  expect(outcome.won).toBe(tactical.result.winner === 0);
  expect(hero.hp).toBe(tactical.generalHp[0]);
  // Original troops that remain are exactly the tactical side-0 survivors (a win also adds recruits).
  expect(hero.troops.filter(t => heroTroops.has(t.id)).map(t => t.id).sort()).toEqual([...tactical.result.survivors[0]].sort());
  if (!outcome.won) expect(hero.troops.every(t => heroTroops.has(t.id))).toBe(true);
});

describe('playerSideOf', () => {
  const side = (ids: string[]) => ({ generalId: 'paladin' as const, formationId: 'line', squads: [{ id: 'q', name: 'Q', disposition: 'mixed' as const, troops: ids.map(id => ({ troopId: id, name: id, unitId: 'dog' })) }] });
  it('finds the player by troop ownership, whatever side the caller claimed', () => {
    const setup = { seed: 1, sides: [side(['e1', 'e2']), side(['p1', 'p2'])] as [ReturnType<typeof side>, ReturnType<typeof side>] };
    expect(playerSideOf(setup, new Set(['p1', 'p2', 'p3']), 0)).toBe(1);
    expect(playerSideOf(setup, new Set(['p1']), 1)).toBe(1);
    const flipped = { ...setup, sides: [setup.sides[1], setup.sides[0]] as typeof setup.sides };
    expect(playerSideOf(flipped, new Set(['p1']), 1)).toBe(0);
  });
  it('keeps the claimed side when troops cannot tell (no troops, or both sides match)', () => {
    const empty = { seed: 1, sides: [side([]), side([])] as [ReturnType<typeof side>, ReturnType<typeof side>] };
    expect(playerSideOf(empty, new Set(['p1']), 1)).toBe(1);
    const both = { seed: 1, sides: [side(['p1']), side(['p2'])] as [ReturnType<typeof side>, ReturnType<typeof side>] };
    expect(playerSideOf(both, new Set(['p1', 'p2']), 0)).toBe(0);
  });
});
