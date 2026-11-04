import { describe, expect, it, vi } from 'vitest';
// Text measurement belongs to the browser; retain real Pixi containers, graphics and events.
vi.mock('pixi.js', async (original) => {
  const pixi = await original<typeof import('pixi.js')>();
  class Text extends pixi.Container {
    text: string;
    style: Record<string, unknown>;
    anchor = { set: vi.fn() };
    constructor(options: { text: string; style: Record<string, unknown> }) {
      super(); this.text = options.text; this.style = options.style;
    }
    override get width() { return this.text.length * Number(this.style.fontSize ?? 12) * 0.6; }
  }
  return { ...pixi, Text };
});
import { Text, Container, Graphics, FederatedPointerEvent, EventBoundary } from 'pixi.js';
import { Hud, type HudCallbacks } from '../../src/render/hud';
import { getGameData } from '../../src/data';
import { getHudLayout } from '../../src/battle/hudLayout';
import { createBattle, issueCommand, issueApproach, setPaused, step } from '../../src/sim';

function fixture(onQuit?: () => void) {
  const data = getGameData();
  const world = createBattle(data, { seed: 1, sides: [
    { generalId: 'paladin', formationId: 'line', squads: ['mixed', 'guard', 'fierce', 'mixed'].map((disposition, i) => ({ id: `s${i}`, name: `Squad ${i}`, disposition: disposition as 'mixed' | 'guard' | 'fierce', troops: [] })) },
    { generalId: 'dragon', formationId: 'line', squads: [] },
  ] });
  const cb: HudCallbacks = { onQuit, onSelectSquad: vi.fn(), onSelectAll: vi.fn(), onCommand: vi.fn(), onApproach: vi.fn(), onSpecial: vi.fn(), onPauseToggle: vi.fn(), onSpeedToggle: vi.fn() };
  const colors = { team: '#336699', squads: [] };
  const hud = new Hud(data, { player: 'Player', enemy: 'Enemy' }, [colors, colors], cb);
  hud.layout(800, 600);
  return { hud, world, cb };
}
function texts(root: Container): string[] {
  return textNodes(root).map((t) => t.text);
}
function textNodes(root: Container): Text[] {
  return root.children.flatMap((c) => c instanceof Text ? [c] : c instanceof Container ? textNodes(c) : []);
}
function button(root: Container, label: string): Container {
  const found = [...root.children].reverse().find((c) => c instanceof Container && c.children.some((t) => t instanceof Text && t.text === label));
  if (!(found instanceof Container)) throw new Error(`missing ${label}`);
  return found;
}

describe('responsive HUD', () => {
  it('redraws the MP ready color even when the final fill change is tiny', () => {
    const { hud, world } = fixture();
    world.phase = 'fight';
    world.generals[0].mp = 99.9;
    hud.update(world, 'all');
    const bars = (hud as unknown as { generalMp: { fg: Graphics }[] }).generalMp;
    const fill = vi.spyOn(bars[0]!.fg, 'fill');
    world.generals[0].mp = 100;
    hud.update(world, 'all');
    expect(fill).toHaveBeenCalledWith({ color: 0x00ff66 });
    hud.root.destroy({ children: true });
  });
  it('ellipsizes very long squad names without compressing names or planning status', () => {
    const { hud, world } = fixture();
    const longName = 'W'.repeat(1000);
    world.squads[0]!.name = longName;
    setPaused(world, true);
    issueCommand(world, 0, 's0', 'fallBack');
    issueApproach(world, 0, 's0', 'nearFlank');
    for (const [width, height] of [[800, 600], [1024, 768], [1280, 800]]) {
      hud.layout(width!, height!);
      hud.update(world, [0]);
      const layout = getHudLayout(width!, height!);
      const title = textNodes(hud.root).find((t) => t.text.includes('Disposition:'))!;
      const intent = textNodes(hud.root).find((t) => t.text.includes('Pending on resume'))!;
      const name = textNodes(hud.root).find((t) => t.text.startsWith('W') && !t.text.includes('Disposition:'))!;
      expect(title.text).toContain('… · Disposition: Mixed (fixed)');
      expect(name.text).toMatch(/^W+…$/);
      expect(name.text.length).toBeLessThanOrEqual(33); // 32 characters plus ellipsis
      expect(intent.text).toBe('Order: Fall Back · Approach: Near Flank · Pending on resume');
      // The measurement stub cannot prove browser font readability. Enforce the
      // structural guarantee: native font size/aspect ratio and measured bounds.
      for (const [label, available] of [[name, layout.cards[0]!.width - 40], [title, layout.detail.width], [intent, layout.detail.width]] as const) {
        expect(label.scale.x).toBe(1);
        expect(label.scale.y).toBe(1);
        expect(Number(label.style.fontSize)).toBeGreaterThanOrEqual(12);
        expect(label.width).toBeLessThanOrEqual(available);
      }
      if (!layout.compact) {
        const card = name.parent!;
        for (const value of ['Mixed (fixed)', 'Fall Back', 'Near Flank']) {
          const status = textNodes(card).find((t) => t.text === value)!;
          expect(status.visible).toBe(true);
          expect(status.scale.x).toBe(1);
          expect(Number(status.style.fontSize)).toBeGreaterThanOrEqual(11);
          expect(status.x + status.width).toBeLessThanOrEqual(layout.cards[0]!.width);
        }
      }
    }
    world.squads[0]!.name = 'Short';
    hud.update(world, [0]);
    expect(texts(hud.root)).toContain('Short · Disposition: Mixed (fixed)');
  });
  it('reuses geometry and cached card chrome on repeated same-size layout', () => {
    const { hud, world } = fixture();
    hud.update(world, [0]);
    const card = button(hud.root, 'Squad 0');
    const chrome = card.children[0] as Graphics;
    const clear = vi.spyOn(chrome, 'clear');
    const topClear = vi.spyOn(hud.root.children[0] as Graphics, 'clear');
    const hit = card.hitArea;
    hud.layout(800, 600);
    hud.update(world, [0]);
    expect(clear).not.toHaveBeenCalled();
    expect(topClear).not.toHaveBeenCalled();
    expect(card.hitArea).toBe(hit);
    hud.layout(1280, 800);
    hud.update(world, [0]);
    expect(clear).toHaveBeenCalledOnce();
    expect(topClear).toHaveBeenCalledOnce();
  });
  it('dims only the battlefield and centers pause instructions in that field', () => {
    const { hud, world } = fixture();
    setPaused(world, true);
    for (const [width, height] of [[800, 600], [1280, 800]]) {
      hud.layout(width!, height!);
      hud.update(world, [0]);
      const title = textNodes(hud.root).find((t) => t.text.startsWith('PAUSED'))!;
      const overlay = title.parent!;
      const bounds = (overlay.children[0] as Graphics).getLocalBounds();
      const bottom = height! - hud.getBottomBandHeight();
      expect(bounds.minX).toBe(0);
      expect(bounds.maxX).toBe(width);
      expect(bounds.minY).toBe(68);
      expect(bounds.maxY).toBe(bottom);
      expect(title.y).toBe((68 + bottom) / 2 - 14);
      const hint = textNodes(overlay).find((t) => t.text.startsWith('SPACE'))!;
      expect(hint.y).toBe((68 + bottom) / 2 + 20);
    }
  });
  it('uses the pure layout for every real pointer target after resizing', () => {
    const { hud, world } = fixture(vi.fn());
    for (const [width, height] of [[1280, 800], [1024, 768], [800, 600], [1280, 800]]) {
      hud.layout(width!, height!); hud.update(world, [0]);
      const layout = getHudLayout(width!, height!);
      const rectangles = [...layout.cards, ...Object.values(layout.buttons)];
      const targets = hud.root.children.filter((c) => c.eventMode === 'static');
      expect(targets).toHaveLength(rectangles.length);
      for (const r of rectangles) {
        const target = targets.find((c) => c.x === r.x && c.y === r.y);
        expect(target).toBeDefined();
        expect(target!.hitArea!.contains(r.width, r.height)).toBe(true);
        expect(target!.hitArea!.contains(r.width + 1, r.height)).toBe(false);
        expect(target!.hitArea!.contains(r.width, r.height + 1)).toBe(false);
      }
      const card = button(hud.root, 'Squad 0');
      const order = card.children.find((c) => c instanceof Text && c.text === 'Advance');
      expect(order!.visible).toBe(!layout.compact);
    }
  });
  it('reports the reservation after resizing', () => {
    const { hud } = fixture();
    expect(hud.getBottomBandHeight()).toBe(230);
    hud.layout(1280, 800);
    expect(hud.getBottomBandHeight()).toBe(256);
    hud.layout(1024, 768);
    expect(hud.getBottomBandHeight()).toBe(230);
  });
  it('shows readable pending and mixed selection details without applying paused edits', () => {
    const { hud, world } = fixture();
    setPaused(world, true);
    issueCommand(world, 0, 's0', 'hold');
    issueApproach(world, 0, 's0', 'farFlank');
    hud.update(world, [0, 1]);
    const labels = texts(hud.root).join('\n');
    expect(labels).toContain('Order: Mixed orders');
    expect(labels).toContain('Approach: Mixed approaches');
    expect(labels).toContain('Disposition: Mixed dispositions (fixed)');
    expect(labels).toContain('Pending on resume');
    hud.update(world, [0]);
    expect(texts(hud.root).join('\n')).toContain('Order: Hold');
    expect(texts(hud.root).join('\n')).toContain('Approach: Far Flank');
    expect(world.squads[0]!.command).toBe('advance');
    setPaused(world, false); step(world); hud.update(world, [0]);
    expect(texts(hud.root).join('\n')).not.toContain('Pending on resume');
  });
  it('retains mouse callbacks and modifier selection while paused', () => {
    const { hud, world, cb } = fixture();
    setPaused(world, true); hud.update(world, 'all');
    for (const label of ['All', 'Advance', 'Hold', 'Fall Back', 'Direct', 'Far Flank', 'Near Flank', 'Pause', '1x', 'Recharge MP']) button(hud.root, label).emit('pointertap', new FederatedPointerEvent(new EventBoundary()));
    expect(cb.onSelectAll).toHaveBeenCalledOnce();
    expect(cb.onCommand).toHaveBeenNthCalledWith(3, 'fallBack');
    expect(cb.onApproach).toHaveBeenNthCalledWith(3, 'nearFlank');
    expect(cb.onPauseToggle).toHaveBeenCalledOnce();
    expect(cb.onSpeedToggle).toHaveBeenCalledOnce();
    expect(cb.onSpecial).toHaveBeenCalledOnce();
    const event = new FederatedPointerEvent(new EventBoundary());
    event.shiftKey = true;
    button(hud.root, 'Squad 0').emit('pointertap', event);
    expect(cb.onSelectSquad).toHaveBeenCalledWith(0, true);
  });
});

it('shows MP recharge and full state for both sides within their HUD cards', () => {
  const { hud, world } = fixture();
  world.phase = 'fight';
  world.generals[0].maxMp = 75;
  world.generals[0].mp = 37.5;
  world.generals[1].maxMp = 240;
  world.generals[1].mp = 240;
  hud.update(world, []);
  expect(texts(hud.root)).toContain('MP 37/75 · Recharging');
  expect(texts(hud.root)).toContain('MP 240/240 · FULL');
  expect(texts(hud.root)).toContain('Recharge MP');
  for (const label of textNodes(hud.root).filter((t) => t.text.startsWith('MP '))) {
    expect(Number(label.style.fontSize)).toBeGreaterThanOrEqual(11);
    expect(label.x + label.width).toBeLessThanOrEqual(260);
  }
  world.generals[0].mp = 75;
  hud.update(world, []);
  expect(texts(hud.root)).toContain('Cast Special');
  world.generals[0].mp = 0;
  setPaused(world, true);
  hud.update(world, []);
  expect(texts(hud.root)).toContain('MP 0/75 · Paused');
});

it('shows Quit battle only with an opt-in callback and keeps its hit area responsive', () => {
  const bare = fixture();
  expect(texts(bare.hud.root)).not.toContain('Quit battle');
  bare.hud.root.destroy({ children: true });
  const onQuit = vi.fn();
  const { hud } = fixture(onQuit);
  for (const [w, h] of [[800, 600], [1024, 768], [1280, 800]]) {
    hud.layout(w!, h!);
    const quit = button(hud.root, 'Quit battle');
    expect(quit.x).toBe(w! - 218);
    expect(quit.hitArea!.contains(96, 40)).toBe(true);
    expect(quit.hitArea!.contains(97, 40)).toBe(false);
    expect(quit.hitArea!.contains(96, 41)).toBe(false);
    quit.emit('pointertap', {} as FederatedPointerEvent);
  }
  expect(onQuit).toHaveBeenCalledTimes(3);
  hud.root.destroy({ children: true });
});
