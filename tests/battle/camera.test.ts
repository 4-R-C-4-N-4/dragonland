import { describe, it, expect } from 'vitest';
import { clampCamera, clampZoom, duelCamera, fitCamera, worldToScreen, screenToWorld, groundToScreen, screenToGround } from '../../src/battle/camera';
import { createProjection, projectedBounds } from '../../src/render/projection';

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

describe('perspective camera composition', () => {
  it('round-trips ground points after pan, zoom and HUD offset', () => {
    const p = createProjection(1600, 600);
    const cam = { x: 730, y: 220, zoom: 1.7 };
    for (const x of [0, 100, 800, 1600]) for (const y of [0, 75, 300, 600]) {
      const screen = groundToScreen(x, y, p, cam, 1024, 768, -81);
      const point = screenToGround(...screen, p, cam, 1024, 768, -81);
      expect(point[0]).toBeCloseTo(x, 8);
      expect(point[1]).toBeCloseTo(y, 8);
    }
  });

  it.each([[1280, 800, 150], [1024, 768, 190], [800, 600, 256]])('fits the trapezoid between HUD bands at %i×%i', (width, height, bottom) => {
    const p = createProjection(1600, 600);
    const b = projectedBounds(p);
    const top = 68;
    const cam = fitCamera({ ...opts, fieldW: b.width, fieldH: b.height, viewportW: width, viewportH: height - top - bottom });
    for (const x of [0, 1600]) for (const y of [0, 600]) {
      const [sx, sy] = groundToScreen(x, y, p, cam, width, height, (top - bottom) / 2);
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sx).toBeLessThanOrEqual(width);
      expect(sy).toBeGreaterThanOrEqual(top);
      expect(sy).toBeLessThanOrEqual(height - bottom);
    }
  });
});

describe('projected camera pan bounds', () => {
  it('clamps dragging in projected coordinates and retains the HUD offset', () => {
    const p = createProjection(1600, 600), b = projectedBounds(p);
    const projectedOpts = { ...opts, fieldW: b.width, fieldH: b.height };
    for (const direction of [-1, 1]) {
      const cam = clampCamera({ x: direction * 1e6, y: direction * 1e6, zoom: 2 }, projectedOpts);
      expect(cam.x).toBe(direction < 0 ? 200 : 1400);
      expect(cam.y).toBe(direction < 0 ? 100 : 350);
      const screen = groundToScreen(123, 234, p, cam, 800, 600, -94);
      expect(screenToGround(...screen, p, cam, 800, 600, -94)[0]).toBeCloseTo(123);
      expect(screenToGround(...screen, p, cam, 800, 600, -94)[1]).toBeCloseTo(234);
    }
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

describe('duelCamera', () => {
  const onScreen = (cam: ReturnType<typeof duelCamera>, p: [number, number]) => {
    const [sx, sy] = worldToScreen(p[0], p[1], cam, opts.viewportW, opts.viewportH);
    return sx >= 0 && sx <= opts.viewportW && sy >= 0 && sy <= opts.viewportH;
  };
  // The old duel camera zoomed 2x on the midpoint, which left far-apart generals off screen.
  it('keeps both generals in view when they are far apart', () => {
    const a: [number, number] = [100, 300], b: [number, number] = [1400, 280];
    const cam = duelCamera(a, b, opts);
    expect(onScreen(cam, a)).toBe(true);
    expect(onScreen(cam, b)).toBe(true);
  });
  it('closes in to 2x once they meet', () => {
    const cam = duelCamera([790, 300], [810, 300], opts);
    expect(cam.zoom).toBe(2);
    expect(onScreen(cam, [790, 300])).toBe(true);
  });
});
