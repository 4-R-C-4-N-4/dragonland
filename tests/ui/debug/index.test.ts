import { describe, expect, it } from 'vitest';
import { ConstantsSchema, getGameData } from '../../../src/data';
import { loadConstantOverrides } from '../../../src/ui/debug';

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => map.set(k, v),
  } as Pick<Storage, 'getItem' | 'setItem'>;
}

const data = getGameData();

describe('loadConstantOverrides', () => {
  it('returns {} when nothing is stored', () => {
    expect(loadConstantOverrides(memoryStorage())).toEqual({});
  });

  it('returns {} on corrupt JSON', () => {
    const storage = memoryStorage({ 'dragonland.v1.constOverrides': 'not json' });
    expect(loadConstantOverrides(storage)).toEqual({});
  });

  it('round-trips a valid override', () => {
    const storage = memoryStorage({ 'dragonland.v1.constOverrides': JSON.stringify({ BASE_DAMAGE: 20 }) });
    expect(loadConstantOverrides(storage)).toEqual({ BASE_DAMAGE: 20 });
  });
});

describe('ConstantsSchema validation (applied by the debug panel)', () => {
  it('accepts a valid merged override', () => {
    expect(() => ConstantsSchema.parse({ ...data.constants, BASE_DAMAGE: 15 })).not.toThrow();
  });

  it('rejects a negative/invalid value for a positive-only constant', () => {
    expect(() => ConstantsSchema.parse({ ...data.constants, BASE_DAMAGE: -5 })).toThrow();
  });

  it('rejects a non-integer for an int-only constant', () => {
    expect(() => ConstantsSchema.parse({ ...data.constants, MAX_SQUADS: 2.5 })).toThrow();
  });
});
