import { afterEach, describe, expect, it, vi } from 'vitest';
import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { Battlefield, Y_SQUASH } from '../../src/render/battlefield';
import { createProjection } from '../../src/render/projection';
import { FxTimeline, parseFxSheet, type ParsedFx } from '../../src/render/fx';
import { createBattle } from '../../src/sim';
import type { World } from '../../src/sim';
import { getGameData } from '../../src/data';

type Special = Extract<World['events'][number], { type: 'special' }>;
// Exercise FX methods without allocating a GPU renderer or touching other render streams.
interface FxHarness {
  fx: Container;
  world2screen: Container;
  fxSheets: Map<string, ParsedFx>;
  fxTextures: Map<string, Texture[]>;
  fxLoading: Map<string, Promise<Texture[] | null>>;
  fxTimeline: FxTimeline;
  destroyed: boolean;
  lastWorld: World | null;
  spawnFxInstance(x: number, y: number, id: string, kind: string, color: number): void;
  spawnSpecialFx(ev: Special): void;
  preloadSheetImages(): Promise<void>;
  render: Battlefield['render'];
  applyEvents: Battlefield['applyEvents'];
  destroy(): void;
}
function harness(): FxHarness {
  const fx = new Container();
  const world2screen = new Container();
  world2screen.addChild(fx);
  return Object.assign(Object.create(Battlefield.prototype) as FxHarness, {
    // Preserve the reviewed vertical-only FX expectations; projectionBattlefield tests the live perspective.
    projection: { ...createProjection(800, 400), farWidthScale: 1, verticalScale: Y_SQUASH },
    routeGuide: new Graphics(), routeSignature: '', routeAge: 0, routePaths: [],
    fx, world2screen, fxSheets: new Map(), fxTextures: new Map(), fxLoading: new Map(), fxTimeline: new FxTimeline(),
    destroyed: false, lastWorld: null, sprites: [], damageNumbers: [], sheets: new Map(), fxSeed: 1, fieldW: 800, fieldH: 400,
    debugLayer: new Container(), screenShakeT: 0,
  });
}
function world(): World {
  const side = (id: string): World['setup']['sides'][number] => ({ generalId: 'dragon', formationId: 'line', squads: [{ id, name: 'test', disposition: 'mixed', troops: [] }] });
  return createBattle(getGameData(), { seed: 1, sides: [side('0'), side('1')] });
}
function sheet(): ParsedFx {
  return parseFxSheet('test', 'test.png', { frames: [0, 1].map((x) => ({ frame: { x, y: 0, w: 1, h: 1 }, duration: 100 })) });
}
async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
afterEach(() => vi.restoreAllMocks());

describe('battlefield FX integration', () => {
  it('preloads actual sheet frames for the first cast; an early cast waits without a placeholder', async () => {
    const b = harness();
    b.fxSheets.set('test', sheet());
    let resolve!: (texture: Texture) => void;
    const loaded = new Promise<Texture>((r) => { resolve = r; });
    const load = vi.spyOn(Assets, 'load').mockReturnValue(loaded as unknown as ReturnType<typeof Assets.load>);
    const ready = b.preloadSheetImages();
    b.spawnFxInstance(20, 30, 'test', 'strike', 0);
    expect(b.fx.children).toHaveLength(0);
    resolve(Texture.EMPTY);
    await ready;
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(b.fx.children[0]).toBeInstanceOf(Sprite);
    expect((b.fx.children[0] as Sprite).texture).toBe(b.fxTextures.get('test')![0]);
    b.spawnFxInstance(40, 50, 'test', 'strike', 0);
    expect(b.fx.children).toHaveLength(2);
    b.destroy();
  });

  it.each(['cast', 'preload'] as const)('recovers from a transient sheet failure on a later %s', async (retry) => {
    const b = harness();
    const metadata = sheet();
    b.fxSheets.set('test', metadata);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const load = vi.spyOn(Assets, 'load')
      .mockRejectedValueOnce(new Error('transient'))
      .mockReturnValue(Promise.resolve(Texture.EMPTY) as unknown as ReturnType<typeof Assets.load>);
    await b.preloadSheetImages();
    expect(b.fxSheets.get('test')).toBe(metadata);
    expect(b.fxLoading.has('test')).toBe(false);
    if (retry === 'preload') await b.preloadSheetImages();
    b.spawnFxInstance(20, 30, 'test', 'strike', 0);
    await b.fxLoading.get('test');
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(b.fx.children[0]).toBeInstanceOf(Sprite);
    expect(b.fxTextures.get('test')).toHaveLength(2);
    b.destroy();
  });

  it('ignores pending texture continuations, queued effects and subsequent calls after destroy', async () => {
    const b = harness();
    b.fxSheets.set('test', sheet());
    let resolve!: (texture: Texture) => void;
    const loaded = new Promise<Texture>((r) => { resolve = r; });
    vi.spyOn(Assets, 'load').mockReturnValue(loaded as unknown as ReturnType<typeof Assets.load>);
    b.spawnFxInstance(20, 30, 'test', 'strike', 0);
    const later = vi.fn();
    b.fxTimeline.schedule(0.5, later);
    b.destroy();
    resolve(Texture.EMPTY);
    await flush();
    b.fxTimeline.update(10);
    b.spawnFxInstance(20, 30, 'test', 'strike', 0);
    b.applyEvents(world());
    expect(b.fxTextures.size).toBe(0);
    expect(b.fxLoading.size).toBe(0);
    expect(later).not.toHaveBeenCalled();
    expect(b.fx.children).toHaveLength(0);
    b.destroy();
  });

  it('plays strikes at event snapshots even after death/movement, keeping ally auras separate', () => {
    const b = harness();
    const w = world();
    b.lastWorld = w;
    const spawn = vi.spyOn(b, 'spawnFxInstance').mockImplementation(() => {});
    const ally = w.generals[0].entity, enemy = w.generals[1].entity;
    w.ents.alive[enemy] = 0;
    b.spawnSpecialFx({ type: 'special', side: 0, specialId: 'mixed', fx: 'test', x: 0, y: 0, dirX: 1, dirY: 0, width: 0,
      areas: ['general', 'heal'], affected: [enemy, ally], areaTargets: [
        { area: 'general', targets: [{ entity: enemy, x: 123, y: 456 }] },
        { area: 'heal', targets: [{ entity: ally, x: 20, y: 30 }] },
      ],
    });
    expect(spawn.mock.calls.map((c) => c.slice(0, 4))).toEqual([[123, 456 * Y_SQUASH, 'test', 'strike'], [20, 30 * Y_SQUASH, 'test', 'aura']]);
    b.destroy();
  });

  it('keeps legacy hostile impacts off allies and animates buff/debuff-only events on their own sides', () => {
    const b = harness();
    const w = world();
    b.lastWorld = w;
    const spawn = vi.spyOn(b, 'spawnFxInstance').mockImplementation(() => {});
    const ally = w.generals[0].entity, enemy = w.generals[1].entity;
    w.ents.x[ally] = 20; w.ents.x[enemy] = 80;
    b.spawnSpecialFx({ type: 'special', side: 0, specialId: 'legacy', fx: 'test', x: 0, y: 0, dirX: 1, dirY: 0, width: 0,
      areas: ['general', 'heal', 'buff', 'debuff'], affected: [enemy, ally],
    });
    expect(spawn.mock.calls.map((c) => [c[0], c[3]])).toEqual([[80, 'strike'], [20, 'aura'], [80, 'aura']]); // Heal+buff shares the ally aura.
    b.destroy();
  });

  it('starts a crossing wave progressively and cancels the remaining starts on destroy', () => {
    const b = harness();
    const spawn = vi.spyOn(b, 'spawnFxInstance').mockImplementation(() => {});
    b.spawnSpecialFx({ type: 'special', side: 0, specialId: 'wave', fx: 'test', x: 100, y: 200, dirX: 1, dirY: 0, width: 30, areas: ['wave'], affected: [] });
    expect(spawn).toHaveBeenCalledTimes(1);
    b.fxTimeline.update(0.2);
    expect(spawn.mock.calls.length).toBeGreaterThan(1);
    expect(spawn.mock.calls.length).toBeLessThan(14);
    const xs = spawn.mock.calls.map((c) => c[0]);
    expect(xs).toEqual([...xs].sort((a, z) => a - z));
    const starts = spawn.mock.calls.length;
    b.destroy();
    b.fxTimeline.update(10);
    expect(spawn).toHaveBeenCalledTimes(starts);
  });

  it.each([false, true])('waits for wave art before scheduling the crossing (destroy pending: %s)', async (destroyPending) => {
    const b = harness();
    const w = world();
    b.lastWorld = w;
    b.fxSheets.set('test', sheet());
    let resolve!: (texture: Texture) => void;
    vi.spyOn(Assets, 'load').mockReturnValue(new Promise<Texture>((r) => { resolve = r; }) as unknown as ReturnType<typeof Assets.load>);
    const draw = (dt: number) => b.render(w, { x: 0, y: 0, zoom: 1 } as Parameters<Battlefield['render']>[1], 0, 800, 400, dt, 'all');
    b.spawnSpecialFx({ type: 'special', side: 0, specialId: 'wave', fx: 'test', x: 100, y: 200, dirX: 1, dirY: 0, width: 30, areas: ['wave'], affected: [] });
    draw(1); // Loading takes longer than the entire crossing.
    expect(b.fx.children.filter((c) => c instanceof Sprite)).toHaveLength(0);
    if (destroyPending) b.destroy();
    w.paused = true;
    resolve(Texture.EMPTY);
    await b.fxLoading.get('test');
    await flush();
    draw(1);
    expect(b.fx.children.filter((c) => c instanceof Sprite)).toHaveLength(0);
    w.paused = false;
    draw(0.01);
    if (destroyPending) {
      expect(b.fx.children).toHaveLength(0);
      return;
    }
    expect(b.fx.children.filter((c) => c instanceof Sprite)).toHaveLength(1);
    draw(0.1);
    const sprites = b.fx.children.filter((c) => c instanceof Sprite);
    expect(sprites.length).toBeGreaterThan(1);
    expect(sprites.length).toBeLessThan(14);
    expect(sprites.map((c) => c.x)).toEqual(sprites.map((c) => c.x).sort((a, z) => a - z));
    const starts = vi.spyOn(b.fx, 'addChild');
    b.destroy();
    b.fxTimeline.update(10);
    expect(starts).not.toHaveBeenCalled();
  });

  it('uses render dt for sheet frames, freezes while paused and destroys completed FX', () => {
    const b = harness();
    const w = world();
    b.fxSheets.set('test', sheet());
    b.fxTextures.set('test', [new Texture(), new Texture()]);
    b.spawnFxInstance(0, 0, 'test', 'strike', 0);
    const sp = b.fx.children[0] as Sprite;
    const draw = (dt: number) => b.render(w, { x: 0, y: 0, zoom: 1 } as Parameters<Battlefield['render']>[1], 0, 800, 400, dt, 'all');
    w.paused = true;
    draw(10);
    expect(sp.destroyed).toBe(false);
    expect(sp.texture).toBe(b.fxTextures.get('test')![0]);
    w.paused = false;
    draw(0.11);
    expect(sp.texture).toBe(b.fxTextures.get('test')![1]);
    draw(0.1);
    expect(sp.destroyed).toBe(true);
    b.destroy();
  });
});
