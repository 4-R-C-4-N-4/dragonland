import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { companySquads } from '../../src/world/squads';
import type { ProgressTroop } from '../../src/progression';

const game = getGameData();
const { MAX_SQUADS, MIN_SQUAD } = game.constants;
let next = 0;
const troops = (unitId: string, n: number): ProgressTroop[] => Array.from({ length: n }, () => ({ id: `t${next++}`, name: `T${next}`, unitId, xp: 0, level: 1 }));
const ids = (squads: ReturnType<typeof companySquads>) => squads.flatMap(s => s.troops.map(t => t.troopId)).sort();

describe('companySquads', () => {
  it('never exceeds MAX_SQUADS and keeps every troop exactly once', () => {
    const company = [...troops('dog', 8), ...troops('golem', 5), ...troops('sprite', 3), ...troops('imp', 4), ...troops('cherub', 8),
      ...troops('automata', 7), ...troops('zombie', 3), ...troops('wyrm', 10), ...troops('raven', 2)];
    const squads = companySquads(company, 'side0-g');
    expect(squads.length).toBe(MAX_SQUADS);
    expect(ids(squads)).toEqual(company.map(t => t.id).sort());
    expect(squads.every(s => s.troops.length >= MIN_SQUAD)).toBe(true);
  });

  it('keeps one species per squad when there are few enough species', () => {
    const company = [...troops('dog', 20), ...troops('raven', 15), ...troops('wyrm', 15)];
    const squads = companySquads(company, 'x');
    expect(squads).toHaveLength(3);
    expect(squads.every(s => new Set(s.troops.map(t => t.unitId)).size === 1)).toBe(true);
    expect(squads.map(s => s.name)).toEqual(expect.arrayContaining(['Dog', 'Raven', 'Wyrm']));
  });

  it('never splits a species across squads', () => {
    const company = [...troops('dog', 9), ...troops('raven', 7), ...troops('wyrm', 6), ...troops('golem', 5), ...troops('imp', 4), ...troops('sprite', 3)];
    const squads = companySquads(company, 'x');
    for (const unitId of ['dog', 'raven', 'wyrm', 'golem', 'imp', 'sprite']) {
      expect(squads.filter(s => s.troops.some(t => t.unitId === unitId))).toHaveLength(1);
    }
  });

  it('folds a lone troop into another squad instead of fielding a squad below MIN_SQUAD', () => {
    const squads = companySquads([...troops('dog', 10), ...troops('raven', 1)], 'x');
    expect(squads).toHaveLength(1);
    expect(squads[0]!.troops).toHaveLength(11);
  });

  it('handles empty and tiny companies', () => {
    expect(companySquads([], 'x')).toEqual([]);
    expect(companySquads(troops('dog', 1), 'x')).toHaveLength(1);
  });

  it('is deterministic, input-order independent and does not mutate the company', () => {
    const company = [...troops('dog', 6), ...troops('raven', 6), ...troops('wyrm', 6), ...troops('golem', 6), ...troops('imp', 6)];
    const before = structuredClone(company);
    const a = companySquads(company, 'x');
    expect(company).toEqual(before);
    expect(companySquads([...company].reverse(), 'x').map(s => s.troops.map(t => t.troopId).sort())).toEqual(a.map(s => s.troops.map(t => t.troopId).sort()));
    expect(new Set(a.map(s => s.id)).size).toBe(a.length);
  });
});
