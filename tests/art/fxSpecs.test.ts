import { describe, expect, it } from 'vitest';
import { listFxIds, loadFxSpec, loadFxStyle, buildFxPrompt, fxPickKey } from '../../tools/art/config';

describe('fx spec loading', () => {
  it('finds all 15 generals-linked fx ids and each parses with a valid kind/frames/heroes', () => {
    const ids = listFxIds();
    expect(ids.length).toBeGreaterThanOrEqual(15);
    for (const id of ids) {
      const spec = loadFxSpec(id);
      expect(['overlay', 'wave', 'strike', 'aura']).toContain(spec.kind);
      expect(spec.frames).toBeGreaterThanOrEqual(4);
      expect(spec.heroes.length).toBeGreaterThan(0);
      expect(spec.description.length).toBeGreaterThan(10);
    }
  });

  it('builds a prompt that includes the fx description and frame count', () => {
    const spec = loadFxSpec('dragon-breath');
    const style = loadFxStyle();
    const prompt = buildFxPrompt(spec, style);
    expect(prompt).toContain('Dragon Breath');
    expect(prompt).toContain(`${spec.frames}`);
    expect(prompt).toContain('#FF00FF');
  });

  it('throws a clear error for an unknown fx id', () => {
    expect(() => loadFxSpec('not-a-real-fx')).toThrow(/no fx spec/);
  });

  it('namespaces fx picks under fx/<id>', () => {
    expect(fxPickKey('inferno')).toBe('fx/inferno');
  });
});
