import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { newRun, chooseEncounter, buildPlayerSide } from '../../src/run';
import { autoPlan, planToArmy, planIssues, speciesGroups } from '../../src/ui/run/logic';

const data = getGameData();

describe('run army planning', () => {
  const run = chooseEncounter(newRun(data, { seed: 3, generalId: 'paladin', startClass: 'human' }), 'enc-0-0');

  it('groups the roster by species with veterans first', () => {
    const roster = run.roster.map((t, i) => (i === 59 ? { ...t, xp: 250, level: 3, unitId: data.unitById.get(t.unitId)!.evolvesTo! } : t));
    const groups = speciesGroups(data, roster);
    expect(groups.reduce((n, g) => n + g.troops.length, 0)).toBe(60);
    const vetGroup = groups.find((g) => g.unit.stage === 2)!;
    expect(vetGroup.troops[0]!.level).toBe(3);
    expect(groups[0]!.unit.stage).toBe(2); // higher stage species listed first
  });

  it('auto-plans by line into squads and produces a valid side', () => {
    const plan = autoPlan(data, run.roster);
    expect(planIssues(data, run.roster, plan)).toEqual([]);
    const army = planToArmy(data, run.roster, plan);
    expect(army.squads.flatMap((s) => s.troopIds)).toHaveLength(60);
    expect(army.squads).toHaveLength(3);
    expect(() => buildPlayerSide(data, run, army)).not.toThrow();
  });

  it('caps the company at MAX_COMPANY and deploys the highest-level troops of a species first', () => {
    const big = [...run.roster, ...run.roster.map((t) => ({ ...t, id: `${t.id}x`, name: `${t.name}x` }))];
    big[0] = { ...big[0]!, xp: 100, level: 2 };
    const plan = autoPlan(data, big);
    const army = planToArmy(data, big, plan);
    expect(army.squads.flatMap((s) => s.troopIds)).toHaveLength(data.constants.MAX_COMPANY);
    expect(army.squads.flatMap((s) => s.troopIds)).toContain(big[0]!.id);
  });

  it('reports overdeployment, lonely squads and an oversized company', () => {
    const plan = autoPlan(data, run.roster);
    const first = Object.keys(plan.assignment)[0]!;
    plan.assignment[first] = { count: 99, squad: 0 };
    expect(planIssues(data, run.roster, plan).join()).toMatch(/only 20/);
    const lonely = autoPlan(data, run.roster);
    for (const k of Object.keys(lonely.assignment)) lonely.assignment[k] = { count: 0, squad: 0 };
    lonely.assignment[first] = { count: 1, squad: 3 };
    expect(planIssues(data, run.roster, lonely).join()).toMatch(/at least/);
    const none = autoPlan(data, run.roster);
    for (const k of Object.keys(none.assignment)) none.assignment[k] = { count: 0, squad: 0 };
    expect(planIssues(data, run.roster, none).join()).toMatch(/Deploy/);
  });
});
