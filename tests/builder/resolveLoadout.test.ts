import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import type { Loadout, Troop } from '../../src/data/schemas';
import { generateRoster } from '../../src/persist/roster';
import {
  addUnitRow,
  availableByUnit,
  pinTroop,
  removeUnitRow,
  resolveLoadout,
  setUnitCount,
  unpinTroop,
} from '../../src/ui/builder/logic';

const data = getGameData();

function makeRoster(): Troop[] {
  return generateRoster(data, 11);
}

function baseLoadout(squads: Loadout['squads']): Loadout {
  return { id: 'l1', name: 'Test', generalId: 'paladin', squads };
}

describe('resolveLoadout', () => {
  it('fills composition from the roster deterministically', () => {
    const roster = makeRoster();
    const unitId = roster[0]!.unitId;
    const loadout = baseLoadout([{ id: 'sq1', name: 'Squad 1', troopIds: [], disposition: 'mixed', composition: { [unitId]: 4 } }]);
    const { loadout: resolved, shortfalls, replaced } = resolveLoadout(loadout, roster, data);
    expect(resolved.squads[0]!.troopIds.length).toBe(4);
    expect(shortfalls).toEqual([]);
    expect(replaced).toBe(0);
    for (const id of resolved.squads[0]!.troopIds) {
      expect(roster.find((t) => t.id === id)?.unitId).toBe(unitId);
    }
  });

  it('is stable: raising one unit count does not reshuffle another unit in the same squad', () => {
    const roster = makeRoster();
    const unitA = roster[0]!.unitId;
    const unitB = roster.find((t) => t.unitId !== unitA)!.unitId;
    const loadout = baseLoadout([{ id: 'sq1', name: 'Squad 1', troopIds: [], disposition: 'mixed', composition: { [unitA]: 3, [unitB]: 3 } }]);
    const first = resolveLoadout(loadout, roster, data).loadout;
    const bIds1 = first.squads[0]!.troopIds.filter((id) => roster.find((t) => t.id === id)?.unitId === unitB);

    const bumped = setUnitCount(first, 'sq1', unitA, 6);
    const second = resolveLoadout(bumped, roster, data).loadout;
    const bIds2 = second.squads[0]!.troopIds.filter((id) => roster.find((t) => t.id === id)?.unitId === unitB);

    expect(bIds2.sort()).toEqual(bIds1.sort());
  });

  it('keeps pinned troops and moves them between squads', () => {
    const roster = makeRoster();
    const troop = roster[0]!;
    const loadout = baseLoadout([
      { id: 'sq1', name: 'Squad 1', troopIds: [troop.id], disposition: 'mixed', composition: { [troop.unitId]: 1 }, pinned: [troop.id] },
      { id: 'sq2', name: 'Squad 2', troopIds: [], disposition: 'mixed', composition: {} },
    ]);
    const pinned = pinTroop(loadout, 'sq2', troop.id, roster);
    expect(pinned.squads[0]!.pinned).not.toContain(troop.id);
    expect(pinned.squads[1]!.pinned).toContain(troop.id);
    const { loadout: resolved } = resolveLoadout(pinned, roster, data);
    expect(resolved.squads[1]!.troopIds).toContain(troop.id);
    expect(resolved.squads[0]!.troopIds).not.toContain(troop.id);
  });

  it('raises the count when pinned troops exceed the stated composition', () => {
    const roster = makeRoster();
    const unitId = roster[0]!.unitId;
    const sameUnit = roster.filter((t) => t.unitId === unitId).slice(0, 3);
    const loadout = baseLoadout([
      {
        id: 'sq1',
        name: 'Squad 1',
        troopIds: sameUnit.map((t) => t.id),
        disposition: 'mixed',
        composition: { [unitId]: 1 },
        pinned: sameUnit.map((t) => t.id),
      },
    ]);
    const { loadout: resolved } = resolveLoadout(loadout, roster, data);
    expect(resolved.squads[0]!.troopIds.length).toBe(3);
    expect(resolved.squads[0]!.composition![unitId]).toBe(3);
  });

  it('refills slots when a previously assigned troop died, and counts them as replaced', () => {
    const fullRoster = makeRoster();
    const unitId = fullRoster[0]!.unitId;
    const sameUnit = fullRoster.filter((t) => t.unitId === unitId);
    const loadout = baseLoadout([
      { id: 'sq1', name: 'Squad 1', troopIds: sameUnit.slice(0, 3).map((t) => t.id), disposition: 'mixed', composition: { [unitId]: 3 } },
    ]);
    // Simulate one of the three dying.
    const survivingRoster = fullRoster.filter((t) => t.id !== sameUnit[0]!.id);
    const { loadout: resolved, replaced, shortfalls } = resolveLoadout(loadout, survivingRoster, data);
    expect(resolved.squads[0]!.troopIds.length).toBe(3);
    expect(resolved.squads[0]!.troopIds).toContain(sameUnit[1]!.id);
    expect(resolved.squads[0]!.troopIds).toContain(sameUnit[2]!.id);
    expect(resolved.squads[0]!.troopIds).not.toContain(sameUnit[0]!.id);
    expect(replaced).toBe(1);
    expect(shortfalls).toEqual([]);
  });

  it('reports a shortfall when the roster cannot fill the composition', () => {
    const roster = makeRoster();
    const unitId = roster[0]!.unitId;
    const available = roster.filter((t) => t.unitId === unitId).length;
    const loadout = baseLoadout([{ id: 'sq1', name: 'Squad 1', troopIds: [], disposition: 'mixed', composition: { [unitId]: available + 10 } }]);
    const { shortfalls } = resolveLoadout(loadout, roster, data);
    expect(shortfalls.length).toBe(1);
    expect(shortfalls[0]!.missing).toBe(10);
  });

  it('never assigns the same troop to two squads', () => {
    const roster = makeRoster();
    const unitId = roster[0]!.unitId;
    const available = roster.filter((t) => t.unitId === unitId).length;
    const half = Math.ceil(available / 2);
    const loadout = baseLoadout([
      { id: 'sq1', name: 'Squad 1', troopIds: [], disposition: 'mixed', composition: { [unitId]: half } },
      { id: 'sq2', name: 'Squad 2', troopIds: [], disposition: 'mixed', composition: { [unitId]: half } },
    ]);
    const { loadout: resolved } = resolveLoadout(loadout, roster, data);
    const a = resolved.squads[0]!.troopIds;
    const b = resolved.squads[1]!.troopIds;
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  it('derives composition for legacy squads without one', () => {
    const roster = makeRoster();
    const ids = roster.slice(0, 3).map((t) => t.id);
    const loadout = baseLoadout([{ id: 'sq1', name: 'Squad 1', troopIds: ids, disposition: 'mixed' }]);
    const { loadout: resolved } = resolveLoadout(loadout, roster, data);
    expect(resolved.squads[0]!.troopIds.sort()).toEqual(ids.sort());
    const total = Object.values(resolved.squads[0]!.composition!).reduce((a, b) => a + b, 0);
    expect(total).toBe(3);
  });
});

describe('composition helpers', () => {
  it('setUnitCount clamps negative values to zero and removes the row', () => {
    const loadout = baseLoadout([{ id: 'sq1', name: 'Squad 1', troopIds: [], disposition: 'mixed', composition: { unitX: 5 } }]);
    const updated = setUnitCount(loadout, 'sq1', 'unitX', -3);
    expect(updated.squads[0]!.composition).toEqual({});
  });

  it('addUnitRow and removeUnitRow manage composition keys', () => {
    const loadout = baseLoadout([{ id: 'sq1', name: 'Squad 1', troopIds: [], disposition: 'mixed', composition: {} }]);
    const added = addUnitRow(loadout, 'sq1', 'unitX', 1);
    expect(added.squads[0]!.composition).toEqual({ unitX: 1 });
    const removed = removeUnitRow(added, 'sq1', 'unitX');
    expect(removed.squads[0]!.composition).toEqual({});
  });

  it('unpinTroop removes a troop from the pinned list without touching composition', () => {
    const loadout = baseLoadout([{ id: 'sq1', name: 'Squad 1', troopIds: ['t1'], disposition: 'mixed', composition: { u1: 1 }, pinned: ['t1'] }]);
    const updated = unpinTroop(loadout, 'sq1', 't1');
    expect(updated.squads[0]!.pinned).toEqual([]);
    expect(updated.squads[0]!.composition).toEqual({ u1: 1 });
  });

  it('availableByUnit counts unassigned roster troops per unit', () => {
    const roster = makeRoster();
    const unitId = roster[0]!.unitId;
    const totalForUnit = roster.filter((t) => t.unitId === unitId).length;
    const loadout = baseLoadout([{ id: 'sq1', name: 'Squad 1', troopIds: [roster[0]!.id], disposition: 'mixed', composition: { [unitId]: 1 } }]);
    const avail = availableByUnit(loadout, roster);
    expect(avail[unitId]).toBe(totalForUnit - 1);
  });
});
