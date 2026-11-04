import { describe, expect, it } from 'vitest';
import { collectFx, kindForArea, overlayPoints, overlayScatterCount, parseFxSheet, perEntityPoints, seededRandom, wavePoints } from '../../src/render/fx';

describe('fx sheet discovery (tolerant of missing files)', () => {
  it('pairs json+png by basename and reports an error for an orphan json', () => {
    const errors: string[] = [];
    const sheets = collectFx(
      { 'a/dragon-breath.json': { default: { frames: [{ frame: { x: 0, y: 0, w: 10, h: 10 } }], meta: { frameTags: [{ name: 'play', from: 0, to: 0 }] } } }, 'a/orphan.json': { default: {} } },
      { 'a/dragon-breath.png': 'url://dragon-breath.png' },
      (m) => errors.push(m),
    );
    expect(sheets.has('dragon-breath')).toBe(true);
    expect(sheets.get('dragon-breath')!.frames).toHaveLength(1);
    expect(errors.some((e) => e.includes('orphan'))).toBe(true);
  });

  it('is a no-op (no throw, empty map) when nothing is discovered', () => {
    expect(collectFx({}, {}).size).toBe(0);
  });

  it('parseFxSheet throws on malformed json rather than silently rendering garbage', () => {
    expect(() => parseFxSheet('x', 'x.png', {})).toThrow();
    expect(() => parseFxSheet('x', 'x.png', { frames: [] })).toThrow();
  });
});

describe('placement helpers (pure, deterministic)', () => {
  it('seededRandom is deterministic for a given seed and varies by seed', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const c = seededRandom(7);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual([c(), c(), c()]);
  });

  it('overlayScatterCount scales with field area but stays within sane bounds', () => {
    expect(overlayScatterCount(100, 100)).toBeGreaterThanOrEqual(6);
    expect(overlayScatterCount(100, 100)).toBeLessThanOrEqual(overlayScatterCount(4000, 4000));
    expect(overlayScatterCount(10000, 10000)).toBeLessThanOrEqual(40);
  });

  it('overlayPoints stays within the field bounds and is reproducible for the same seed', () => {
    const pts = overlayPoints(800, 400, 123, 20);
    expect(pts).toHaveLength(20);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(800);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(400);
    }
    expect(overlayPoints(800, 400, 123, 20)).toEqual(pts);
    expect(overlayPoints(800, 400, 999, 20)).not.toEqual(pts);
  });

  it('wavePoints spans the full field along the direction, perpendicular offsets bounded by width', () => {
    const pts = wavePoints(400, 200, 1, 0, 50, 800, 400, 1, 10);
    const xs = pts.map(([x]) => x);
    expect(Math.min(...xs)).toBeLessThan(0); // overshoots the left edge
    expect(Math.max(...xs)).toBeGreaterThan(800); // overshoots the right edge
    for (const [, y] of pts) expect(Math.abs(y - 200)).toBeLessThanOrEqual(50);
  });

  it('perEntityPoints resolves only entities whose position lookup succeeds', () => {
    const pos = (e: number): [number, number] | null => (e === 2 ? null : [e * 10, e * 20]);
    expect(perEntityPoints([1, 2, 3], pos)).toEqual([[10, 20], [30, 60]]);
  });

  it('kindForArea maps every SpecialArea to one of the four playback kinds', () => {
    expect(kindForArea('field')).toBe('overlay');
    expect(kindForArea('wave')).toBe('wave');
    expect(kindForArea('random')).toBe('strike');
    expect(kindForArea('general')).toBe('strike');
    expect(kindForArea('heal')).toBe('aura');
    expect(kindForArea('buff')).toBe('aura');
    expect(kindForArea('debuff')).toBe('aura');
  });
});
