import { describe, it, expect } from 'vitest';
import { clampCamera, clampZoom, fitCamera, worldToScreen, screenToWorld } from '../../src/battle/camera';

const opts = { fieldW: 1600, fieldH: 600, viewportW: 800, viewportH: 400, minZoom: 0.3, maxZoom: 3 };

describe('clampZoom', () => {
  it('clamps within range', () => {
    expect(clampZoom(10, opts)).toBe(3);
    expect(clampZoom(0.01, opts)).toBe(0.3);
    expect(clampZoom(1, opts)).toBe(1);
  });
});

describe('clampCamera', () => {
  it('keeps camera within field bounds', () => {
    const cam = clampCamera({ x: -1000, y: -1000, zoom: 1 }, opts);
    expect(cam.x).toBeGreaterThanOrEqual(0);
    expect(cam.y).toBeGreaterThanOrEqual(0);
    const cam2 = clampCamera({ x: 100000, y: 100000, zoom: 1 }, opts);
    expect(cam2.x).toBeLessThanOrEqual(opts.fieldW);
    expect(cam2.y).toBeLessThanOrEqual(opts.fieldH);
  });

  it('centers when viewport exceeds field at low zoom', () => {
    const cam = clampCamera({ x: 0, y: 0, zoom: 0.3 }, opts);
    expect(cam.x).toBeCloseTo(opts.fieldW / 2, 5);
  });
});

describe('fitCamera', () => {
  it('frames the whole field', () => {
    const cam = fitCamera(opts);
    expect(cam.zoom).toBeGreaterThan(0);
    expect(cam.zoom).toBeLessThanOrEqual(opts.maxZoom);
  });
});

describe('world/screen conversion round-trip', () => {
  it('round-trips a point', () => {
    const cam = { x: 800, y: 300, zoom: 1.5 };
    const [sx, sy] = worldToScreen(500, 200, cam, 800, 400);
    const [wx, wy] = screenToWorld(sx, sy, cam, 800, 400);
    expect(wx).toBeCloseTo(500, 5);
    expect(wy).toBeCloseTo(200, 5);
  });
});
