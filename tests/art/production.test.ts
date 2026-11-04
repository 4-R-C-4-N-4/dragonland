import { describe, expect, it } from 'vitest';
import { productionOrder } from '../../tools/art/production';

describe('art production queue', () => {
  it('orders new species after their evolution references without regenerating selected sources', () => {
    const specs = [
      { id: 'final', evolvesFrom: 'mid' },
      { id: 'mid', evolvesFrom: 'base' },
      { id: 'base' },
      { id: 'approved' },
    ];
    expect(productionOrder(specs, { approved: 'old.png' })).toEqual(['base', 'mid', 'final']);
  });
  it('rejects missing references and cyclic chains rather than generating unreferenced evolutions', () => {
    expect(() => productionOrder([{ id: 'mid', evolvesFrom: 'absent' }], {})).toThrow(/reference/);
    expect(() => productionOrder([{ id: 'a', evolvesFrom: 'b' }, { id: 'b', evolvesFrom: 'a' }], {})).toThrow(/cycle/);
  });
});
