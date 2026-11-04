import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { recruitTroops } from '../../src/persist/roster';
import { createStore } from '../../src/persist/store';

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('demo auto-recruit (D20)', () => {
  it('recruits the requested units with names unique against the roster', () => {
    const data = getGameData();
    const existing = [{ id: 'a', name: 'Pelvik', unitId: 'dog' }];
    const fresh = recruitTroops(data, existing, { dog: 30, archer: 5, paladin: 3 }, 9);
    expect(fresh.filter((t) => t.unitId === 'dog')).toHaveLength(30);
    expect(fresh.filter((t) => t.unitId === 'archer')).toHaveLength(5);
    expect(fresh.some((t) => t.unitId === 'paladin')).toBe(false); // stage 3 never a troop
    const names = new Set([...existing, ...fresh].map((t) => t.name));
    expect(names.size).toBe(36);
  });

  it('store.recruit persists and keeps ids unique across calls', () => {
    const data = getGameData();
    const store = createStore(memStorage(), data);
    const before = store.getRoster().length;
    store.recruit({ wolf: 20 });
    const after = store.recruit({ wolf: 20 });
    expect(after).toHaveLength(before + 40);
    expect(new Set(after.map((t) => t.id)).size).toBe(after.length);
    expect(store.getRoster()).toHaveLength(before + 40);
  });
});
