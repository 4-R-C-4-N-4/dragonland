import { describe, expect, it } from 'vitest';
import { getHudLayout, type HudRect } from '../../src/battle/hudLayout';

const contains = (outer: HudRect, r: HudRect) => r.x >= outer.x && r.y >= outer.y && r.x + r.width <= outer.x + outer.width && r.y + r.height <= outer.y + outer.height;
const intersects = (a: HudRect, b: HudRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('HUD screen layout', () => {
  for (const [width, height] of [[1280, 800], [1024, 768], [800, 600]]) {
    it(`contains all displays and nonoverlapping hit rectangles at ${width}×${height}`, () => {
      const layout = getHudLayout(width!, height!);
      const screen = { x: 0, y: 0, width: width!, height: height! };
      const displays = [...layout.generals, layout.timer, layout.detail, layout.orderHeading, layout.approachHeading];
      const hits = [...layout.cards, ...Object.values(layout.buttons)];
      for (const r of [...displays, ...hits]) expect(contains(screen, r)).toBe(true);
      for (const r of [...hits, layout.detail, layout.orderHeading, layout.approachHeading]) expect(contains(layout.bottomBand, r)).toBe(true);
      const all = [...displays, ...hits];
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(intersects(all[i]!, all[j]!)).toBe(false);
      for (const r of hits) expect(r.height).toBeGreaterThanOrEqual(40);
      expect(layout.bottomBand.height).toBeLessThan(height! / 2);
    });
  }
  it('expands selection details and groups compact squad selectors', () => {
    const compact = getHudLayout(800, 600);
    expect(compact.compact).toBe(true);
    expect(compact.detail.height).toBeGreaterThanOrEqual(40);
    expect(compact.cards.every((r) => r.y === compact.cards[0]!.y)).toBe(true);
    expect(getHudLayout(1280, 800).compact).toBe(false);
  });
});

it('reserves a visible 96px Quit battle control in the bottom row', () => {
  for (const [w, h] of [[800, 600], [1024, 768], [1280, 800]]) {
    const { buttons: b } = getHudLayout(w!, h!);
    expect(b.quit).toMatchObject({ x: w! - 218, width: 96, y: b.special.y });
    expect(intersects(b.quit, b.nearFlank)).toBe(false);
    expect(intersects(b.quit, b.special)).toBe(false);
  }
});
