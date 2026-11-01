import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import type { Loadout } from '../../src/data/schemas';
import { createStore, type StorageLike } from '../../src/persist/store';

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

const data = getGameData();

describe('createStore roster', () => {
  it('generates a roster on first access', () => {
    const store = createStore(memoryStorage(), data);
    const roster = store.getRoster();
    expect(roster.length).toBe(data.constants.ROSTER_SIZE);
  });

  it('persists the roster across calls', () => {
    const storage = memoryStorage();
    const store = createStore(storage, data);
    const a = store.getRoster();
    const b = store.getRoster();
    expect(a).toEqual(b);
  });

  it('resetRoster regenerates deterministically for a seed', () => {
    const store = createStore(memoryStorage(), data);
    const a = store.resetRoster(5);
    const b = store.resetRoster(5);
    expect(a).toEqual(b);
    expect(store.getRoster()).toEqual(b);
  });

  it('falls back to a fresh roster on corrupt stored data', () => {
    const storage = memoryStorage();
    storage.setItem('dragonland.v1.roster', '{not json');
    const store = createStore(storage, data);
    const roster = store.getRoster();
    expect(roster.length).toBe(data.constants.ROSTER_SIZE);
  });
});

describe('createStore loadouts', () => {
  function loadout(id: string, troopIds: string[]): Loadout {
    return { id, name: `Loadout ${id}`, generalId: 'paladin', squads: [{ id: `${id}-sq1`, name: 'Squad 1', troopIds, disposition: 'mixed' }] };
  }

  it('saves and lists loadouts', () => {
    const store = createStore(memoryStorage(), data);
    const roster = store.getRoster();
    const l = loadout('l1', roster.slice(0, 2).map((t) => t.id));
    store.saveLoadout(l);
    expect(store.listLoadouts().length).toBe(1);
    expect(store.getLoadout('l1')).toEqual(l);
  });

  it('updates an existing loadout on re-save', () => {
    const store = createStore(memoryStorage(), data);
    const roster = store.getRoster();
    const l = loadout('l1', roster.slice(0, 2).map((t) => t.id));
    store.saveLoadout(l);
    store.saveLoadout({ ...l, name: 'Renamed' });
    expect(store.listLoadouts().length).toBe(1);
    expect(store.getLoadout('l1')!.name).toBe('Renamed');
  });

  it('renames a loadout', () => {
    const store = createStore(memoryStorage(), data);
    const roster = store.getRoster();
    store.saveLoadout(loadout('l1', roster.slice(0, 2).map((t) => t.id)));
    store.renameLoadout('l1', 'New Name');
    expect(store.getLoadout('l1')!.name).toBe('New Name');
  });

  it('duplicates a loadout with new ids', () => {
    const store = createStore(memoryStorage(), data);
    const roster = store.getRoster();
    const l = loadout('l1', roster.slice(0, 2).map((t) => t.id));
    store.saveLoadout(l);
    const copy = store.duplicateLoadout('l1');
    expect(copy).toBeDefined();
    expect(copy!.id).not.toBe('l1');
    expect(copy!.squads[0]!.id).not.toBe(l.squads[0]!.id);
    expect(copy!.squads[0]!.troopIds).toEqual(l.squads[0]!.troopIds);
    expect(store.listLoadouts().length).toBe(2);
  });

  it('deletes a loadout', () => {
    const store = createStore(memoryStorage(), data);
    const roster = store.getRoster();
    store.saveLoadout(loadout('l1', roster.slice(0, 2).map((t) => t.id)));
    store.deleteLoadout('l1');
    expect(store.listLoadouts().length).toBe(0);
  });

  it('applyBattleResult removes dead troops from roster and loadouts', () => {
    const store = createStore(memoryStorage(), data);
    const roster = store.getRoster();
    const deadId = roster[0]!.id;
    const survivorId = roster[1]!.id;
    store.saveLoadout(loadout('l1', [deadId, survivorId]));

    store.applyBattleResult([deadId]);

    const newRoster = store.getRoster();
    expect(newRoster.some((t) => t.id === deadId)).toBe(false);
    expect(newRoster.some((t) => t.id === survivorId)).toBe(true);

    const l = store.getLoadout('l1')!;
    expect(l.squads[0]!.troopIds).toEqual([survivorId]);
  });

  it('falls back to empty list on corrupt loadouts data', () => {
    const storage = memoryStorage();
    storage.setItem('dragonland.v1.loadouts', '{"not":"an array"}');
    const store = createStore(storage, data);
    expect(store.listLoadouts()).toEqual([]);
  });
});

describe('createStore lastComposition', () => {
  it('round-trips a composition', () => {
    const store = createStore(memoryStorage(), data);
    expect(store.getLastComposition()).toEqual({});
    store.setLastComposition({ human: 10, beast: 5 });
    expect(store.getLastComposition()).toEqual({ human: 10, beast: 5 });
  });

  it('falls back to {} on corrupt data', () => {
    const storage = memoryStorage();
    storage.setItem('dragonland.v1.lastComposition', 'not json');
    const store = createStore(storage, data);
    expect(store.getLastComposition()).toEqual({});
  });
});
