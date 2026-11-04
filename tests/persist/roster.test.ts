import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { generateRoster, rosterEligibleUnitIds } from '../../src/persist/roster';

describe('generateRoster', () => {
  const data = getGameData();

  it('produces ROSTER_SIZE troops', () => {
    const roster = generateRoster(data, 1);
    expect(roster.length).toBe(data.constants.ROSTER_SIZE);
  });

  it('covers all 30 stage-1/2 units', () => {
    const roster = generateRoster(data, 1);
    const eligible = rosterEligibleUnitIds(data);
    expect(eligible.length).toBe(30);
    const used = new Set(roster.map((t) => t.unitId));
    for (const id of eligible) expect(used.has(id)).toBe(true);
  });

  it('never includes stage-3 units', () => {
    const roster = generateRoster(data, 1);
    for (const t of roster) {
      const unit = data.unitById.get(t.unitId);
      expect(unit?.stage).not.toBe(3);
    }
  });

  it('has unique names', () => {
    const roster = generateRoster(data, 1);
    const names = new Set(roster.map((t) => t.name));
    expect(names.size).toBe(roster.length);
  });

  it('has unique ids', () => {
    const roster = generateRoster(data, 1);
    const ids = new Set(roster.map((t) => t.id));
    expect(ids.size).toBe(roster.length);
  });

  it('is deterministic for a given seed', () => {
    const a = generateRoster(data, 42);
    const b = generateRoster(data, 42);
    expect(a).toEqual(b);
  });

  it('differs for different seeds', () => {
    const a = generateRoster(data, 1);
    const b = generateRoster(data, 2);
    expect(a).not.toEqual(b);
  });

  it('distributes a finite sandbox roster evenly across eligible species', () => {
    const roster = generateRoster(data, 1);
    const counts = new Map<string, number>();
    for (const t of roster) counts.set(t.unitId, (counts.get(t.unitId) ?? 0) + 1);
    const minimum = Math.floor(data.constants.ROSTER_SIZE / rosterEligibleUnitIds(data).length);
    for (const n of counts.values()) expect(n).toBeGreaterThanOrEqual(minimum);
    expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(1);
  });
});
