import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle, step } from '../../src/sim';
import { applyBattleResult, chooseEncounter, chooseRecruitOffer, newRun, startBattle, validateRun, type RunState } from '../../src/run';

const data = getGameData();

function simulate(state: RunState) {
  const world = createBattle(data, state.battle!.setup);
  for (let t = 0; t < 20 * 60 * 6 && !world.result; t++) step(world);
  expect(world.result).not.toBeNull();
  return world.result!;
}

describe('run with the real simulation', () => {
  it('plays frozen battles through the sim and applies their results once', () => {
    let s = newRun(data, { seed: 77, generalId: 'paladin', startClass: 'human' });
    for (let round = 0; round < 2 && s.phase !== 'lost'; round++) {
      s = chooseEncounter(s, s.offers[0]!.id);
      const ids = s.roster.slice(0, 60).map((t) => t.id);
      s = startBattle(data, s, {
        formationId: 'line',
        squads: [0, 1, 2].map((i) => ({ name: `S${i}`, disposition: 'mixed' as const, troopIds: ids.slice(Math.floor((i * ids.length) / 3), Math.floor(((i + 1) * ids.length) / 3)) })),
      });
      const replay = createBattle(data, s.battle!.setup);
      expect(replay.ents.count).toBe(2 + ids.length + s.encounter!.side.squads.reduce((n, q) => n + q.troops.length, 0));
      const result = simulate(s);
      const before = s.roster.length;
      s = applyBattleResult(data, s, s.battle!.id, result);
      validateRun(data, s);
      expect(s.roster.length).toBe(before - s.lastSummary!.dead.length);
      expect(s.lastSummary!.dead.length + s.lastSummary!.recovered.length).toBe(result.dead[0].length);
      if (s.phase === 'rewards') s = chooseRecruitOffer(data, s, s.recruitOffers[0]!.id);
    }
    expect(['select', 'lost']).toContain(s.phase);
  });
});
