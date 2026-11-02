import { describe, expect, it } from 'vitest';
import { createProjection, projectGround, unprojectGround, depthScale, projectedBounds } from '../../src/render/projection';

describe('shallow battlefield perspective', () => {
  it('keeps the near edge full width and narrows the far edge symmetrically', () => {
    const p = createProjection(1600, 600);
    const farLeft = projectGround(p, 0, 0), farRight = projectGround(p, 1600, 0);
    expect(farLeft[0]).toBeGreaterThan(0);
    expect(farRight[0]).toBeLessThan(1600);
    expect(farLeft[0] + farRight[0]).toBeCloseTo(1600);
    expect(projectGround(p, 0, 600)[0]).toBe(0);
    expect(projectGround(p, 1600, 600)[0]).toBe(1600);
  });

  it('round-trips corners, centres, arbitrary points and nearby off-field points', () => {
    const p = createProjection(1200, 600);
    for (const x of [-100, 0, 175, 600, 1200, 1300]) for (const y of [-50, 0, 75, 300, 600, 650]) {
      const actual = unprojectGround(p, ...projectGround(p, x, y));
      expect(actual[0]).toBeCloseTo(x, 8);
      expect(actual[1]).toBeCloseTo(y, 8);
    }
  });

  it('scales upright sprites subtly by depth, without changing simulation coordinates', () => {
    const p = createProjection(1600, 600);
    expect(depthScale(p, 0)).toBeLessThan(depthScale(p, 600));
    expect(depthScale(p, -1000)).toBe(depthScale(p, 0));
    expect(depthScale(p, 2000)).toBe(depthScale(p, 600));
    expect(projectGround(p, 800, 300)[0]).toBe(800);
  });

  it('exposes projected bounds for fit camera and validates geometry', () => {
    const p = createProjection(1600, 600);
    expect(projectedBounds(p)).toEqual({ x: 0, y: 0, width: 1600, height: 450 });
    expect(() => createProjection(0, 600)).toThrow();
    expect(() => createProjection(1600, NaN)).toThrow();
  });
});
