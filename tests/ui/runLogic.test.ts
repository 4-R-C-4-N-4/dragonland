import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { newRun, chooseEncounter, buildPlayerSide } from '../../src/run';
import { autoPlan, planToArmy, planIssues, speciesGroups } from '../../src/ui/run/logic';

const data = getGameData();

describe('run army planning', () => {
  const run = chooseEncounter(newRun(data, { seed: 3, generalId: 'paladin' }), 'enc-0-0');

  it('groups the roster by species with veterans first', () => {
    const roster = run.roster.map((t, i) => (i === run.roster.length - 1 ? { ...t, xp: 250, level: 3, unitId: data.unitById.get(t.unitId)!.evolvesTo! } : t));
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

  it('merges an understrength line into another squad without losing or recruiting troops', () => {
    const a = run.roster.filter((t) => data.unitById.get(t.unitId)!.line === 'A').slice(0, 2);
    const m = run.roster.filter((t) => data.unitById.get(t.unitId)!.line === 'M').slice(0, 1);
    const roster = [...a, ...m];
    const before = structuredClone(roster);
    const plan = autoPlan(data, roster);
    expect(planIssues(data, roster, plan)).toEqual([]);
    const army = planToArmy(data, roster, plan);
    expect(army.squads.flatMap((s) => s.troopIds).sort()).toEqual(roster.map((t) => t.id).sort());
    expect(() => buildPlayerSide(data, { ...run, roster }, army)).not.toThrow();
    expect(roster).toEqual(before);
  });

  it('combines lonely lines when their total can form a legal squad', () => {
    const roster = ['A', 'M', 'Z'].map((line) => run.roster.find((t) => data.unitById.get(t.unitId)!.line === line)!);
    const plan = autoPlan(data, roster);
    expect(planIssues(data, roster, plan)).toEqual([]);
    expect(planToArmy(data, roster, plan).squads).toHaveLength(1);
  });

  it('still reports a roster too small to form even one legal squad', () => {
    const roster = run.roster.slice(0, data.constants.MIN_SQUAD - 1);
    expect(planIssues(data, roster, autoPlan(data, roster)).join()).toMatch(/at least/);
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
    expect(planIssues(data, run.roster, plan).join()).toMatch(/only 10/);
    const lonely = autoPlan(data, run.roster);
    for (const k of Object.keys(lonely.assignment)) lonely.assignment[k] = { count: 0, squad: 0 };
    lonely.assignment[first] = { count: 1, squad: 3 };
    expect(planIssues(data, run.roster, lonely).join()).toMatch(/at least/);
    const none = autoPlan(data, run.roster);
    for (const k of Object.keys(none.assignment)) none.assignment[k] = { count: 0, squad: 0 };
    expect(planIssues(data, run.roster, none).join()).toMatch(/Deploy/);
  });
});

describe('fight validation', () => {
  const run = chooseEncounter(newRun(data, { seed: 3, generalId: 'paladin' }), 'enc-0-0');
  it.each([NaN, Infinity, -1, 1.5])('blocks invalid count %s', (count) => {
    const plan = autoPlan(data, run.roster);
    plan.assignment[Object.keys(plan.assignment)[0]!]!.count = count;
    expect(planIssues(data, run.roster, plan).length).toBeGreaterThan(0);
  });
  it.each([-1, 4, 0.5, NaN])('blocks invalid squad destination %s', (squad) => {
    const plan = autoPlan(data, run.roster);
    plan.assignment[Object.keys(plan.assignment)[0]!]!.squad = squad;
    expect(planIssues(data, run.roster, plan).join(' ')).toMatch(/invalid squad/);
  });
});
