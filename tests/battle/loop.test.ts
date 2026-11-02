import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle } from '../../src/sim';
import { startLoop } from '../../src/battle/loop';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('render elapsed time', () => {
  function harness() {
    let pending: FrameRequestCallback | undefined;
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { pending = cb; return ++id; });
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const data = getGameData();
    const world = createBattle(data, { seed: 1, sides: [
      { generalId: 'paladin', formationId: 'line', squads: [] },
      { generalId: 'dragon', formationId: 'line', squads: [] },
    ] });
    const deltas: number[] = [];
    const loop = startLoop({ world, data, ai: { update: vi.fn() }, onFrame: (_w, _alpha, elapsedS) => deltas.push(elapsedS) });
    return { loop, world, deltas, cancel, frame: (now: number) => pending!(now) };
  }

  it.each([30, 60, 144])('passes one second of elapsed rendering time at %i FPS', (fps) => {
    const h = harness();
    for (let i = 1; i <= fps; i++) h.frame(i * 1000 / fps);
    expect(h.deltas.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
    h.loop.stop();
  });

  it('freezes render-time progression while paused and follows game speed after resume', () => {
    const h = harness();
    h.world.paused = true;
    h.frame(50);
    expect(h.deltas.at(-1)).toBe(0);
    h.world.paused = false;
    h.loop.setSpeed(2);
    h.frame(100);
    expect(h.deltas.at(-1)).toBeCloseTo(0.1);
    h.loop.stop();
    const count = h.deltas.length;
    h.frame(150);
    expect(h.deltas).toHaveLength(count);
    expect(h.cancel).toHaveBeenCalledTimes(1);
  });
});
