import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { listUnits, loadSizes, loadUnit } from '../../tools/art/config';

// Guards art specs against drifting from the game roster (review follow-up).
describe('art unit specs', () => {
  const data = getGameData();
  const sizes = loadSizes();
  it('cover every species with a matching evolution reference and a known size', () => {
    expect(listUnits().sort()).toEqual(data.units.map((u) => u.id).sort());
    for (const unit of data.units) {
      const spec = loadUnit(unit.id);
      expect(spec.name, unit.id).toBe(unit.name);
      expect(sizes.height[spec.size], `${unit.id} size ${spec.size}`).toBeGreaterThan(0);
      const from = data.units.find((u) => u.evolvesTo === unit.id)?.id;
      expect(spec.evolvesFrom, unit.id).toBe(from);
      expect(spec.description.length).toBeGreaterThan(20);
    }
  });
});
