import { describe, expect, it } from 'vitest';
import { bumpBattleCounter, getBattleCounter, type CounterStorage } from '../../../src/ui/flow/battleCounter';

function memoryStorage(): CounterStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => map.set(k, v),
  };
}

describe('battleCounter', () => {
  it('starts at 0 when nothing is stored', () => {
    expect(getBattleCounter(memoryStorage())).toBe(0);
  });

  it('bumps and persists monotonically', () => {
    const storage = memoryStorage();
    expect(bumpBattleCounter(storage)).toBe(1);
    expect(bumpBattleCounter(storage)).toBe(2);
    expect(getBattleCounter(storage)).toBe(2);
  });

  it('falls back to 0 on corrupt stored data', () => {
    const storage = memoryStorage();
    storage.setItem('dragonland.v1.battleCounter', 'not-a-number');
    expect(getBattleCounter(storage)).toBe(0);
  });
});
