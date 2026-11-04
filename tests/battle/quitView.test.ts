import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LoopOptions } from '../../src/battle/loop';
import { dom, ElementMock, key } from '../helpers/dom';
const calls = vi.hoisted(() => ({ loop: null as LoopOptions | null, stop: vi.fn(), speed: vi.fn(), appDestroy: vi.fn(), init: vi.fn(), preload: vi.fn(), battlefieldDestroy: vi.fn(), ensureSprites: vi.fn(), loopStart: vi.fn(), raf: new Map<number, FrameRequestCallback>(), stage: null as import('pixi.js').Container | null }));
vi.mock('pixi.js', async original => {
  const pixi = await original<typeof import('pixi.js')>();
  class Text extends pixi.Container {
    text: string;
    style: Record<string, unknown>;
    anchor = { set: vi.fn() };
    constructor(opts: { text: string; style: Record<string, unknown> }) { super(); this.text = opts.text; this.style = opts.style; }
    override get width() { return this.text.length * Number(this.style.fontSize ?? 12) * 0.6; }
  }
  class Application {
    stage = new pixi.Container();
    renderer!: { width: number; height: number };
    canvas = document.createElement('canvas');
    constructor() { calls.stage = this.stage; }
    async init() { await calls.init(); this.renderer = { width: 800, height: 600 }; }
    destroy() { calls.appDestroy(); this.canvas.remove(); this.stage.destroy({ children: true }); }
  }
  return { ...pixi, Text, Application };
});
vi.mock('../../src/render/battlefield', async () => {
  const { Container } = await import('pixi.js');
  const { createProjection } = await import('../../src/render/projection');
  return { Battlefield: class {
    projection = createProjection(1600, 600);
    world2screen = new Container();
    async preloadSheetImages() { await calls.preload(); }
    ensureSprites() { calls.ensureSprites(); } applyEvents() {} render() {} destroy() { calls.battlefieldDestroy(); this.world2screen.destroy({ children: true }); }
  } };
});
vi.mock('../../src/battle/loop', async original => {
  const { startLoop } = await original<typeof import('../../src/battle/loop')>();
  return { startLoop: (opts: LoopOptions) => {
    calls.loop = opts; calls.loopStart();
    const loop = startLoop(opts);
    return { ...loop, stop: () => { calls.stop(); loop.stop(); }, setSpeed: calls.speed };
  } };
});
import { startBattleView } from '../../src/battle/view';
import { getGameData } from '../../src/data';
const data = getGameData();
beforeEach(() => {
  vi.stubGlobal('document', dom); vi.stubGlobal('window', Object.assign(new EventTarget(), { document: dom }));
  calls.loop = null; calls.raf.clear();
  for (const mock of [calls.stop, calls.speed, calls.appDestroy, calls.init, calls.preload, calls.battlefieldDestroy, calls.ensureSprites, calls.loopStart]) mock.mockReset();
  let rafId = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => { calls.raf.set(++rafId, cb); return rafId; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { calls.raf.delete(id); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function startup() {
  const root = new ElementMock(), onFinished = vi.fn(), onQuit = vi.fn();
  const pending = startBattleView(root as unknown as HTMLElement, { data, setup: { seed: 1, sides: [
    { generalId: 'paladin', formationId: 'line', squads: [] }, { generalId: 'dragon', formationId: 'line', squads: [] },
  ] }, labels: { player: 'Player', enemy: 'Enemy' }, onFinished, onQuit });
  return { root, pending, onFinished, onQuit };
}
async function fixture() {
  const { root, pending, onFinished, onQuit } = startup();
  const view = await pending;
  return { root, view, onFinished, onQuit, world: calls.loop!.world };
}
it('blocks window keyboard controls while modal is open and keeps keyboard Continue usable', async () => {
  const { root, view, world } = await fixture();
  const parentKey = vi.fn();
  const e = new Event('keydown', { cancelable: true });
  Object.defineProperty(e, 'key', { value: 'Escape' }); dom.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(true); expect(world.paused).toBe(true);
  // A document input listener must stop propagation to other app/window keyboard shortcuts.
  const blocked = new Event('keydown', { cancelable: true });
  Object.defineProperty(blocked, 'key', { value: ' ' });
  blocked.stopPropagation = parentKey;
  dom.dispatchEvent(blocked);
  expect(parentKey).toHaveBeenCalled(); expect(blocked.defaultPrevented).toBe(false);
  key(dom, 'f'); expect(calls.speed).not.toHaveBeenCalled();
  root.querySelectorAll('button')[0]!.click(); expect(world.paused).toBe(false);
  view.destroy();
});
it('confirms quit at most once and destroys the modal/input without unpausing the abandoned view', async () => {
  const { root, view, world, onQuit, onFinished } = await fixture();
  key(dom, 'Escape'); root.querySelectorAll('button')[1]!.click();
  key(dom, 'Escape'); root.querySelectorAll('button')[1]!.click();
  expect(onQuit).toHaveBeenCalledExactlyOnceWith(world); expect(onFinished).not.toHaveBeenCalled();
  view.destroy(); view.destroy(); expect(calls.stop).toHaveBeenCalledOnce(); expect(calls.appDestroy).toHaveBeenCalledOnce(); expect(calls.battlefieldDestroy).toHaveBeenCalledOnce(); expect(calls.raf.size).toBe(0);
  expect(root.querySelector('dialog')).toBeNull(); key(dom, ' '); expect(world.paused).toBe(true);
});
it('ignores quitting once a result exists and delivers normal finish only once', async () => {
  const { root, view, world, onQuit, onFinished } = await fixture();
  world.result = { winner: 1 } as never;
  key(dom, 'Escape'); expect(root.querySelector('dialog')!.open).toBe(false);
  let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
  calls.loop!.onFrame!(world, 0, 0); now = 3000;
  calls.loop!.onFrame!(world, 0, 0); calls.loop!.onFrame!(world, 0, 0);
  expect(onFinished).toHaveBeenCalledExactlyOnceWith(world); expect(onQuit).not.toHaveBeenCalled(); view.destroy();
});

// Track actual input/resize registrations, including listeners left behind by failed setup.
function trackListeners() {
  const live: { target: EventTarget; type: string; listener: unknown }[] = [];
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (this: EventTarget, type, listener, options) {
    live.push({ target: this, type, listener }); add.call(this, type, listener, options);
  });
  vi.spyOn(EventTarget.prototype, 'removeEventListener').mockImplementation(function (this: EventTarget, type, listener, options) {
    const i = live.findIndex(item => item.target === this && item.type === type && item.listener === listener);
    if (i >= 0) live.splice(i, 1);
    remove.call(this, type, listener, options);
  });
  return live;
}
it('cleans initialized resources when sheet preload rejects before a view can be returned', async () => {
  const live = trackListeners(), failure = new Error('sheet preload failed');
  let rejectPreload!: (error: Error) => void;
  calls.preload.mockImplementation(() => new Promise<void>((_, reject) => { rejectPreload = reject; }));
  const { root, pending, onFinished, onQuit } = startup();
  const rejected = expect(pending).rejects.toBe(failure);
  await vi.waitFor(() => expect(calls.preload).toHaveBeenCalledOnce());
  const canvas = root.querySelector('canvas')!;
  const removeCanvas = vi.spyOn(canvas, 'remove');
  rejectPreload(failure); await rejected;
  expect(calls.init).toHaveBeenCalledOnce(); expect(calls.battlefieldDestroy).toHaveBeenCalledOnce();
  expect(calls.appDestroy).toHaveBeenCalledOnce(); expect(removeCanvas).toHaveBeenCalledOnce();
  expect(root.children).toEqual([]); expect(live).toEqual([]); expect(calls.raf.size).toBe(0);
  expect(calls.loopStart).not.toHaveBeenCalled(); expect(calls.stop).not.toHaveBeenCalled();
  expect(onFinished).not.toHaveBeenCalled(); expect(onQuit).not.toHaveBeenCalled();
});

it('releases only the stage when application init rejects before a renderer exists', async () => {
  const live = trackListeners(), failure = new Error('renderer unavailable');
  calls.init.mockRejectedValueOnce(failure);
  const { root, pending } = startup();
  const destroyStage = vi.spyOn(calls.stage!, 'destroy');
  await expect(pending).rejects.toBe(failure);
  expect(destroyStage).toHaveBeenCalledOnce(); expect(calls.appDestroy).not.toHaveBeenCalled();
  expect(calls.preload).not.toHaveBeenCalled(); expect(calls.battlefieldDestroy).not.toHaveBeenCalled();
  expect(root.children).toEqual([]); expect(live).toEqual([]); expect(calls.raf.size).toBe(0);
});
it.each(['sprites', 'loop'] as const)('cleans acquired resources after synchronous %s setup failure', async stage => {
  const live = trackListeners(), failure = new Error(`${stage} setup failed`);
  (stage === 'sprites' ? calls.ensureSprites : calls.loopStart).mockImplementationOnce(() => { throw failure; });
  const { root, pending, onFinished, onQuit } = startup();
  await expect(pending).rejects.toBe(failure);
  expect(calls.battlefieldDestroy).toHaveBeenCalledOnce(); expect(calls.appDestroy).toHaveBeenCalledOnce();
  expect(root.children).toEqual([]); expect(live).toEqual([]); expect(calls.raf.size).toBe(0);
  expect(calls.stop).not.toHaveBeenCalled();
  expect(key(dom, ' ').defaultPrevented).toBe(false); expect(key(dom, 'Escape').defaultPrevented).toBe(false);
  expect(onFinished).not.toHaveBeenCalled(); expect(onQuit).not.toHaveBeenCalled();
});
it.each(['battlefield', 'app'] as const)('preserves startup rejection and removes canvas even if %s cleanup throws', async resource => {
  const live = trackListeners(), failure = new Error('preload failed'), cleanupFailure = new Error('cleanup failed');
  calls.preload.mockRejectedValueOnce(failure);
  (resource === 'battlefield' ? calls.battlefieldDestroy : calls.appDestroy).mockImplementationOnce(() => { throw cleanupFailure; });
  const { root, pending } = startup();
  await expect(pending).rejects.toBe(failure);
  expect(calls.battlefieldDestroy).toHaveBeenCalledOnce(); expect(calls.appDestroy).toHaveBeenCalledOnce();
  expect(root.children).toEqual([]); expect(live).toEqual([]); expect(calls.raf.size).toBe(0);
});
it('continues normal destruction after a cleanup error and remains idempotent', async () => {
  const live = trackListeners();
  const { root, view } = await fixture();
  expect(calls.raf.size).toBe(1);
  const failure = new Error('battlefield destroy failed');
  calls.battlefieldDestroy.mockImplementationOnce(() => { throw failure; });
  expect(() => view.destroy()).toThrow(failure); expect(() => view.destroy()).not.toThrow();
  expect(calls.stop).toHaveBeenCalledOnce(); expect(calls.battlefieldDestroy).toHaveBeenCalledOnce();
  expect(calls.appDestroy).toHaveBeenCalledOnce(); expect(root.children).toEqual([]); expect(live).toEqual([]); expect(calls.raf.size).toBe(0);
});
