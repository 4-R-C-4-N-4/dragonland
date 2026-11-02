import { describe, expect, it, vi } from 'vitest';
import { FxTimeline, fxSize, timedWavePoints } from '../../src/render/fx';

describe('render-driven FX lifecycle', () => {
  it('advances using supplied time, keeps delayed waves ordered, and cancels every callback on destroy', () => {
    const clock = new FxTimeline();
    const frames = vi.fn();
    const later = vi.fn();
    clock.add(1, frames);
    clock.schedule(0.5, later);
    clock.update(0.25);
    expect(frames).toHaveBeenLastCalledWith(0.25);
    expect(later).not.toHaveBeenCalled();
    clock.update(0); // paused render
    expect(later).not.toHaveBeenCalled();
    clock.update(0.25);
    expect(later).toHaveBeenCalledOnce();
    clock.schedule(0.1, later);
    clock.destroy();
    const calls = frames.mock.calls.length;
    clock.update(10);
    clock.schedule(0, later);
    expect(frames).toHaveBeenCalledTimes(calls);
    expect(later).toHaveBeenCalledOnce();
  });

  it('crosses forward from the caster with later starts farther along the wave', () => {
    const points = timedWavePoints(100, 200, 1, 0, 30, 800, 400, 1);
    expect(points[0]!.delayS).toBe(0);
    expect(points.at(-1)!.x).toBe(800);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.x).toBeGreaterThan(points[i - 1]!.x);
      expect(points[i]!.delayS).toBeGreaterThan(points[i - 1]!.delayS);
    }
    expect(points.every((p) => p.x >= 100 && p.x <= 800 && p.y >= 0 && p.y <= 400 && Math.abs(p.y - 200) <= 30)).toBe(true);
  });

  it.each([
    [1, 1, 300, 400], [1, -1, 300, 0], [-1, 1, 0, 300], [-1, -1, 0, 100],
    [0, 1, 100, 400], [0, -1, 100, 0], [-1, 0, 0, 200],
  ])('clips diagonal and band jitter to the field for direction (%s, %s)', (dx, dy, endX, endY) => {
    const points = timedWavePoints(100, 200, dx!, dy!, 1000, 800, 400, 7);
    expect(points.at(-1)!.x).toBeCloseTo(endX!);
    expect(points.at(-1)!.y).toBeCloseTo(endY!);
    let previous = -1e-9;
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(800);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(400);
      const forward = (p.x - 100) * dx! + (p.y - 200) * dy!;
      expect(forward + 1e-9).toBeGreaterThanOrEqual(previous);
      previous = forward;
    }
  });

  it('sizes art in game units regardless of raw sheet resolution, retaining aspect ratio', () => {
    expect(fxSize('strike', 1000, 500)).toEqual(fxSize('strike', 100, 50));
    const size = fxSize('strike', 1000, 500);
    expect(size.width).toBe(64);
    expect(size.height).toBe(32);
  });
});
