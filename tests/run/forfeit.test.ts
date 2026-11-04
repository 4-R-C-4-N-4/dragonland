import { expect, it } from 'vitest';
import { awardHeroXp, pendingMilestones } from '../../src/progression';
import { getGameData } from '../../src/data';
import { applyBattleResult, chooseEncounter, forfeitBattle, loadRun, newRun, saveRun, startBattle } from '../../src/run';

const data = getGameData();
function battle() {
  const run = newRun(data, { seed: 17, generalId: 'paladin' });
  const prepared = chooseEncounter(run, run.offers[0]!.id);
  return startBattle(data, prepared, { formationId: 'line', squads: [{ name: 'A', disposition: 'mixed', troopIds: run.roster.slice(0, 4).map(t => t.id) }] });
}
it('forfeits with only actual deployed losses, preserves living/bench and all progress without rewards', () => {
  const s = battle(), id = s.battle!.id;
  const lost = forfeitBattle(s, id, [s.roster[0]!.id, s.roster[4]!.id, 'enemy', s.roster[0]!.id]);
  expect(s.phase).toBe('battle');
  expect(lost).toMatchObject({ phase: 'lost', battle: null, encounter: null, recruitOffers: [], depth: s.depth, hero: s.hero, unlockedClasses: s.unlockedClasses, pendingMilestones: s.pendingMilestones, processedBattleIds: [id] });
  expect(lost.roster).toEqual(s.roster.slice(1));
  expect(lost.lastSummary).toMatchObject({ forfeited: true, won: false, xpAwarded: 0, levelUps: 0, recovered: [], evolutions: [], dead: [{ id: s.roster[0]!.id }], survived: s.roster.slice(1, 4).map(({ id, name, unitId }) => ({ id, name, unitId })), benched: 56 });
  expect(forfeitBattle(lost, id, [])).toBe(lost);
  expect(applyBattleResult(data, lost, id, { winner: 0, dead: [[], []], survivors: [[], []] })).toBe(lost);
  expect(() => forfeitBattle(s, 'other', [])).toThrow(/active battle/);
});
it('reloads forfeiture as terminal; optional marker keeps legacy v2 summaries compatible', () => {
  const s = battle();
  const lost = forfeitBattle(s, s.battle!.id, []);
  let raw = '';
  const storage = { getItem: () => raw, setItem: (_k: string, v: string) => { raw = v; }, removeItem() {} };
  saveRun(storage, lost);
  expect(loadRun(storage, data)).toEqual({ kind: 'ok', state: lost });
  const legacy = structuredClone(lost);
  delete legacy.lastSummary!.forfeited;
  saveRun(storage, legacy);
  expect(loadRun(storage, data)).toEqual({ kind: 'ok', state: legacy });
});

it('retains valid earned pending milestones through terminal reload', () => {
  const s = battle();
  s.hero = awardHeroXp(s.hero, 300);
  s.pendingMilestones = pendingMilestones(s.hero);
  expect(s.pendingMilestones.length).toBeGreaterThan(0);
  const lost = forfeitBattle(s, s.battle!.id, []);
  let raw = '';
  const storage = { getItem: () => raw, setItem: (_k: string, v: string) => { raw = v; }, removeItem() {} };
  saveRun(storage, lost);
  expect(loadRun(storage, data)).toEqual({ kind: 'ok', state: lost });
});
