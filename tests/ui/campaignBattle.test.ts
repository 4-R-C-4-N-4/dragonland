import { expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle, step } from '../../src/sim';
import { buildWorldData, rawWorldData, createWar } from '../../src/world';
import { applySkirmishResult, commitAttacker, commitDefender, sequenceEncounter, snapshotBattleResult } from '../../src/world/sequence';
import { campaignBattlePerspective } from '../../src/ui/world/battlePerspective';

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
