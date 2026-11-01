import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import type { Loadout, Troop } from '../../src/data/schemas';
import { generateRoster } from '../../src/persist/roster';
import {
  autoFillSquad,
  companyComposition,
  cycleDisposition,
  loadoutToSideSetup,
  matchupSummary,
  sanitizeLoadout,
  selectAllOfUnit,
  validateLoadout,
} from '../../src/ui/builder/logic';

const data = getGameData();

function makeRoster(): Troop[] {
  return generateRoster(data, 7);
}

function squadOf(troopIds: string[], id = 'sq1', name = 'Squad 1'): Loadout['squads'][number] {
  return { id, name, troopIds, disposition: 'mixed' };
}

function emptyLoadout(): Loadout {
  return { id: 'l1', name: 'Test', generalId: 'paladin', squads: [] };
}

describe('validateLoadout', () => {
  it('rejects zero squads', () => {
    const roster = makeRoster();
    const result = validateLoadout(emptyLoadout(), roster, data);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'tooFewSquads')).toBe(true);
  });

  it('rejects squads below MIN_SQUAD', () => {
    const roster = makeRoster();
    const loadout: Loadout = { ...emptyLoadout(), squads: [squadOf([roster[0]!.id])] };
    const result = validateLoadout(loadout, roster, data);
    expect(result.errors.some((e) => e.code === 'squadTooSmall')).toBe(true);
  });

  it('rejects more than MAX_SQUADS squads', () => {
    const roster = makeRoster();
    const squads = Array.from({ length: data.constants.MAX_SQUADS + 1 }, (_, i) =>
      squadOf(roster.slice(i * 2, i * 2 + 2).map((t) => t.id), `sq${i}`),
    );
    const loadout: Loadout = { ...emptyLoadout(), squads };
    const result = validateLoadout(loadout, roster, data);
    expect(result.errors.some((e) => e.code === 'tooManySquads')).toBe(true);
  });

  it('rejects company larger than MAX_COMPANY', () => {
    const roster = makeRoster();
    const ids = roster.slice(0, data.constants.MAX_COMPANY + 5).map((t) => t.id);
    const loadout: Loadout = { ...emptyLoadout(), squads: [squadOf(ids)] };
    const result = validateLoadout(loadout, roster, data);
    expect(result.errors.some((e) => e.code === 'companyTooLarge')).toBe(true);
  });

  it('rejects a troop assigned to two squads', () => {
    const roster = makeRoster();
    const shared = roster[0]!.id;
    const loadout: Loadout = {
      ...emptyLoadout(),
      squads: [squadOf([shared, roster[1]!.id], 'sq1'), squadOf([shared, roster[2]!.id], 'sq2')],
    };
    const result = validateLoadout(loadout, roster, data);
    expect(result.errors.some((e) => e.code === 'duplicateTroop')).toBe(true);
  });

  it('rejects a missing troop id', () => {
    const roster = makeRoster();
    const loadout: Loadout = { ...emptyLoadout(), squads: [squadOf([roster[0]!.id, 'does-not-exist'])] };
    const result = validateLoadout(loadout, roster, data);
    expect(result.errors.some((e) => e.code === 'missingTroop')).toBe(true);
  });

  it('rejects a stage-3 troop', () => {
    const roster: Troop[] = [...makeRoster(), { id: 'gen-1', name: 'Fake Paladin', unitId: 'paladin' }];
    const loadout: Loadout = { ...emptyLoadout(), squads: [squadOf(['gen-1', roster[0]!.id])] };
    const result = validateLoadout(loadout, roster, data);
    expect(result.errors.some((e) => e.code === 'stage3Troop')).toBe(true);
  });

  it('accepts a valid loadout', () => {
    const roster = makeRoster();
    const loadout: Loadout = { ...emptyLoadout(), squads: [squadOf(roster.slice(0, 4).map((t) => t.id))] };
    const result = validateLoadout(loadout, roster, data);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('sanitizeLoadout', () => {
  it('drops troops no longer in the roster', () => {
    const roster = makeRoster();
    const keep = roster.slice(0, 2).map((t) => t.id);
    const loadout: Loadout = { ...emptyLoadout(), squads: [squadOf([...keep, 'ghost-1', 'ghost-2'])] };
    const { loadout: sanitized, removed } = sanitizeLoadout(loadout, roster);
    expect(removed.sort()).toEqual(['ghost-1', 'ghost-2']);
    expect(sanitized.squads[0]!.troopIds.sort()).toEqual(keep.sort());
  });
});

describe('loadoutToSideSetup', () => {
  it('converts troops into TroopSetup entries', () => {
    const roster = makeRoster();
    const ids = roster.slice(0, 3).map((t) => t.id);
    const loadout: Loadout = { ...emptyLoadout(), squads: [squadOf(ids)] };
    const setup = loadoutToSideSetup(loadout, roster, 'line');
    expect(setup.generalId).toBe('paladin');
    expect(setup.formationId).toBe('line');
    expect(setup.squads[0]!.troops.length).toBe(3);
    expect(setup.squads[0]!.troops[0]!.unitId).toBe(roster[0]!.unitId);
  });
});

describe('companyComposition', () => {
  it('counts troops per class', () => {
    const roster = makeRoster();
    const humanTroop = roster.find((t) => data.unitById.get(t.unitId)?.classId === 'human')!;
    const loadout: Loadout = { ...emptyLoadout(), squads: [squadOf([humanTroop.id, roster[0]!.id === humanTroop.id ? roster[1]!.id : roster[0]!.id])] };
    const comp = companyComposition(loadout, roster, data);
    const total = Object.values(comp).reduce((a: number, b) => a + (b ?? 0), 0);
    expect(total).toBe(2);
  });
});

describe('matchupSummary', () => {
  it('reports strong when our class counters theirs', () => {
    // human is strongAgainst beast (D9 mirror test uses this pair)
    const ourUnit = data.units.find((u) => u.classId === 'human' && u.stage !== 3)!.id;
    const theirUnit = data.units.find((u) => u.classId === 'beast' && u.stage !== 3)!.id;
    expect(matchupSummary([ourUnit], [theirUnit], data)).toBe('strong');
  });

  it('reports weak when their class counters ours', () => {
    const ourUnit = data.units.find((u) => u.classId === 'beast' && u.stage !== 3)!.id;
    const theirUnit = data.units.find((u) => u.classId === 'human' && u.stage !== 3)!.id;
    expect(matchupSummary([ourUnit], [theirUnit], data)).toBe('weak');
  });

  it('reports neutral for empty input', () => {
    expect(matchupSummary([], [], data)).toBe('neutral');
  });
});

describe('autoFillSquad / selectAllOfUnit', () => {
  it('adds up to count unassigned troops matching a unit', () => {
    const roster = makeRoster();
    const unitId = roster[0]!.unitId;
    const loadout: Loadout = { ...emptyLoadout(), squads: [{ id: 'sq1', name: 'Squad 1', troopIds: [], disposition: 'mixed' }] };
    const filled = autoFillSquad(loadout, 'sq1', roster, data, { by: 'unit', value: unitId, count: 5 });
    expect(filled.squads[0]!.troopIds.length).toBe(5);
    for (const id of filled.squads[0]!.troopIds) {
      const t = roster.find((r) => r.id === id);
      expect(t?.unitId).toBe(unitId);
    }
  });

  it('does not reassign troops already in a squad', () => {
    const roster = makeRoster();
    const unitId = roster[0]!.unitId;
    const sameUnit = roster.filter((t) => t.unitId === unitId);
    const loadout: Loadout = {
      ...emptyLoadout(),
      squads: [
        { id: 'sq1', name: 'Squad 1', troopIds: [sameUnit[0]!.id], disposition: 'mixed' },
        { id: 'sq2', name: 'Squad 2', troopIds: [], disposition: 'mixed' },
      ],
    };
    const filled = autoFillSquad(loadout, 'sq2', roster, data, { by: 'unit', value: unitId, count: 100 });
    expect(filled.squads[1]!.troopIds).not.toContain(sameUnit[0]!.id);
    expect(filled.squads[1]!.troopIds.length).toBe(sameUnit.length - 1);
  });

  it('selectAllOfUnit grabs every unassigned troop of a unit', () => {
    const roster = makeRoster();
    const unitId = roster[0]!.unitId;
    const expectedCount = roster.filter((t) => t.unitId === unitId).length;
    const loadout: Loadout = { ...emptyLoadout(), squads: [{ id: 'sq1', name: 'Squad 1', troopIds: [], disposition: 'mixed' }] };
    const filled = selectAllOfUnit(loadout, 'sq1', roster, data, unitId);
    expect(filled.squads[0]!.troopIds.length).toBe(expectedCount);
  });
});

describe('cycleDisposition', () => {
  it('cycles fierce -> mixed -> guard -> fierce', () => {
    expect(cycleDisposition('fierce')).toBe('mixed');
    expect(cycleDisposition('mixed')).toBe('guard');
    expect(cycleDisposition('guard')).toBe('fierce');
  });
});
